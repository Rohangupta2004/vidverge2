/**
 * DESIGN WITH AI — compositing, preview-frame capture and export.
 *
 * The original video is NEVER modified: graphics are compositable overlays.
 * - captureCompositeFrames(): photographs the video + active overlay at
 *   chosen timestamps (for the agentic quality check's vision pass).
 * - exportDesign(): plays the video once through a canvas, rasterizing the
 *   overlay SVGs in step with playback (the same GSAP timelines the preview
 *   seeks — preview and export render the identical thing), records with
 *   MediaRecorder (original audio carried via WebAudio), then FFmpeg.wasm
 *   turns the recording into a downloadable MP4. If FFmpeg cannot start,
 *   the WebM recording (which already carries the audio) ships instead.
 */

import { FFmpeg } from 'https://esm.sh/@ffmpeg/ffmpeg@0.12.10';
import { fetchFile, toBlobURL } from 'https://esm.sh/@ffmpeg/util@0.12.1';
import {
  DesignGraphic, DesignPalette, DesignProject, HeadInfo, designFrameSize,
  paletteFromBrand, uploadBlob, uploadDataUrl,
} from './api';
import { BuiltOverlay, SlotRegion, buildOverlayGraphic, slotRegion } from './overlayGraphics';

const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
let ffInstance: any = null;
let ffFailed = '';

async function loadFFmpeg(): Promise<any> {
  if (ffInstance) return ffInstance;
  if (ffFailed) throw new Error(ffFailed);
  try {
    const ff = new FFmpeg();
    await ff.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffInstance = ff;
    return ff;
  } catch (e: any) {
    ffFailed = `FFmpeg could not start in this browser: ${String(e?.message || e).slice(0, 140)}`;
    throw new Error(ffFailed);
  }
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = false;
    video.preload = 'auto';
    (video as any).playsInline = true;
    const guard = setTimeout(() => reject(new Error('The video took too long to load.')), 60000);
    video.onerror = () => { clearTimeout(guard); reject(new Error('The video could not be decoded in this browser.')); };
    video.onloadedmetadata = () => { clearTimeout(guard); resolve(video); };
    video.src = url;
  });
}

function releaseVideo(video: HTMLVideoElement) {
  try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* released */ }
}

function seekTo(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(giveUp); video.removeEventListener('seeked', onSeeked); resolve(ok); };
    const onSeeked = () => setTimeout(() => finish(true), 80);
    const giveUp = setTimeout(() => finish(false), 8000);
    video.addEventListener('seeked', onSeeked);
    try { video.currentTime = t; } catch { finish(false); }
  });
}

/** Rasterize an overlay SVG's current pose to an Image (awaited — QA path). */
function rasterize(svg: SVGSVGElement): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const markup = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export interface PreparedOverlay { g: DesignGraphic; built: BuiltOverlay }

export async function prepareOverlays(
  graphics: DesignGraphic[],
  W: number,
  H: number,
  palette: DesignPalette,
  head: HeadInfo | null,
): Promise<PreparedOverlay[]> {
  const out: PreparedOverlay[] = [];
  for (const g of graphics.filter((x) => x.enabled && !x.use_omni)) {
    try { out.push({ g, built: await buildOverlayGraphic(g, W, H, palette, head) }); }
    catch { /* one broken graphic must not sink the run — it simply won't render */ }
  }
  return out;
}

const activeAt = (o: PreparedOverlay, t: number) => t >= o.g.start && t < o.g.end;

// ---------------------------------------------------------------------------
// Broll (Omni footage) layers — video cutaways composited like overlays
// ---------------------------------------------------------------------------

export interface BrollLayer { g: DesignGraphic; video: HTMLVideoElement; region: SlotRegion }

/** Open every generated footage cutaway as a muted video layer with its slot. */
export async function prepareBrollLayers(graphics: DesignGraphic[], head: HeadInfo | null): Promise<BrollLayer[]> {
  const out: BrollLayer[] = [];
  for (const g of graphics.filter((x) => x.enabled && x.use_omni && x.clip_url)) {
    try {
      const video = await openVideo(String(g.clip_url));
      video.muted = true;
      out.push({ g, video, region: slotRegion(g.position, head) });
    } catch { /* a missing clip must not sink the run — the cue simply won't render */ }
  }
  return out;
}

/** Cover-fit draw of a video into a canvas rectangle (center crop). */
function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, x: number, y: number, w: number, h: number): void {
  const vw = Number(video.videoWidth) || 16;
  const vh = Number(video.videoHeight) || 9;
  const s = Math.max(w / vw, h / vh);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h);
}

function releaseBroll(layers: BrollLayer[]): void {
  layers.forEach((b) => releaseVideo(b.video));
}

// ---------------------------------------------------------------------------
// Composite frame capture (agentic quality check + thumbnails)
// ---------------------------------------------------------------------------

export interface QaFrame { url: string; graphicId: string; note: string; t: number }

/**
 * Photograph the composited result (video + active overlays) at each graphic's
 * midpoint and upload the frames — the quality inspector's vision inputs.
 */
export async function captureCompositeFrames(
  project: DesignProject,
  graphics: DesignGraphic[],
  head: HeadInfo | null,
  palette: DesignPalette,
  pickIds?: string[] | null,
  maxFrames = 4,
): Promise<QaFrame[]> {
  if (!project.video_url) return [];
  const { W, H } = designFrameSize(project);
  const wanted = graphics.filter((g) => g.enabled && (!pickIds || pickIds.includes(g.id))).slice(0, maxFrames);
  if (!wanted.length) return [];
  const overlays = await prepareOverlays(wanted, W, H, palette, head);
  const brolls = await prepareBrollLayers(wanted, head);
  const video = await openVideo(project.video_url);
  video.muted = true;
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(W, 1280);
  canvas.height = Math.round(canvas.width * (H / W));
  const ctx = canvas.getContext('2d');
  const frames: QaFrame[] = [];
  try {
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    const shots = wanted.filter((g) => overlays.some((o) => o.g.id === g.id) || brolls.some((b) => b.g.id === g.id));
    for (const shot of shots) {
      const t = Math.min((shot.start + shot.end) / 2, Math.max(0.1, (Number(project.video_duration_s) || shot.end) - 0.1));
      const ok = await seekTo(video, t);
      if (!ok) continue;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      for (const b of brolls) {
        if (!(t >= b.g.start && t < b.g.end)) continue;
        await seekTo(b.video, Math.max(0.05, Math.min(t - b.g.start, Math.max(0.1, (Number(b.video.duration) || 8) - 0.1))));
        ctx.globalAlpha = Math.min(1, Math.max(0.2, Number(b.g.opacity) || 1));
        drawCover(ctx, b.video, b.region.x * canvas.width, b.region.y * canvas.height, b.region.w * canvas.width, b.region.h * canvas.height);
        ctx.globalAlpha = 1;
      }
      for (const other of overlays) {
        if (!activeAt(other, t)) continue;
        other.built.timeline.seek(Math.max(0.01, t - other.g.start), false);
        const img = await rasterize(other.built.svg);
        if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      let dataUrl = '';
      try { dataUrl = canvas.toDataURL('image/jpeg', 0.82); }
      catch { throw new Error('The video host blocked frame capture (CORS-tainted canvas).'); }
      try {
        const url = await uploadDataUrl(dataUrl, `design-qa-${project.id}-${shot.id}.jpg`);
        frames.push({ url, graphicId: shot.id, note: `${shot.treatment} @ ${t.toFixed(1)}s — ${shot.visual_concept || shot.narration_ref}`.slice(0, 160), t });
      } catch { /* skip an unuploadable frame — QA degrades gracefully */ }
    }
  } finally {
    overlays.forEach((o) => { try { o.built.timeline.kill(); } catch { /* released */ } });
    releaseBroll(brolls);
    releaseVideo(video);
  }
  return frames;
}

/** One composited thumbnail (first graphic moment, or 25% in). */
export async function captureThumbnail(project: DesignProject, graphics: DesignGraphic[], head: HeadInfo | null, palette: DesignPalette): Promise<string | null> {
  try {
    const frames = await captureCompositeFrames(project, graphics.slice(0, 1), head, palette, null, 1);
    return frames[0]?.url || null;
  } catch { return null; }
}

/** Sample raw video frames (no overlays) for talking-head detection. */
export async function sampleVideoFrames(videoUrl: string, durationS: number, count = 3): Promise<string[]> {
  const video = await openVideo(videoUrl);
  video.muted = true;
  const canvas = document.createElement('canvas');
  const w = Number(video.videoWidth) || 1280;
  const h = Number(video.videoHeight) || 720;
  const scale = Math.min(1, 1024 / Math.max(w, h));
  canvas.width = Math.max(2, Math.round(w * scale));
  canvas.height = Math.max(2, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  const urls: string[] = [];
  try {
    if (!ctx) return [];
    const dur = Math.max(0.5, durationS || Number(video.duration) || 1);
    const times = Array.from({ length: count }, (_, i) => Math.min(dur - 0.1, dur * ((i + 1) / (count + 1))));
    for (const t of times) {
      const ok = await seekTo(video, t);
      if (!ok) continue;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        urls.push(await uploadDataUrl(dataUrl, `design-head-${Date.now()}-${Math.round(t)}.jpg`));
      } catch { /* CORS-tainted or upload failure — detection degrades to default */ }
    }
  } finally {
    releaseVideo(video);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Export — realtime canvas composite → MediaRecorder → FFmpeg → MP4
// ---------------------------------------------------------------------------

function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export interface ExportResult { url: string; format: 'mp4' | 'webm'; note?: string }

export async function exportDesign(
  project: DesignProject,
  graphics: DesignGraphic[],
  head: HeadInfo | null,
  onProgress?: (note: string, fraction: number) => void,
): Promise<ExportResult> {
  if (!project.video_url) throw new Error('This project has no uploaded video.');
  const say = (n: string, f: number) => { try { onProgress?.(n, f); } catch { /* UI only */ } };
  const mime = recorderMime();
  if (!mime) throw new Error('This browser cannot record the composite (MediaRecorder unavailable).');

  const { W, H } = designFrameSize(project);
  const palette = project.plan?.palette || paletteFromBrand(project.brand);

  say('Preparing graphics…', 0.02);
  const overlays = await prepareOverlays(graphics, W, H, palette, head);
  const brolls = await prepareBrollLayers(graphics, head);

  say('Loading the original video…', 0.05);
  const video = await openVideo(project.video_url);
  const durationS = Math.max(0.5, Number(project.video_duration_s) || Number(video.duration) || 1);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) { releaseVideo(video); throw new Error('Canvas 2D is unavailable in this browser.'); }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  // Original audio travels into the recording through WebAudio — the source
  // footage itself is never touched.
  const stream = canvas.captureStream(30);
  let audioCtx: AudioContext | null = null;
  let audioNote = '';
  try {
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AC();
    const src = audioCtx.createMediaElementSource(video);
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  } catch {
    audioNote = 'The original audio could not be captured in this browser — the export is silent.';
    video.muted = true;
  }

  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  // Per-overlay raster cache: the video paints every frame; each active
  // overlay refreshes its raster as fast as serialization allows and the
  // freshest pose is drawn on top.
  const rasterCache = new Map<string, { img: HTMLImageElement | null; busy: boolean }>();
  const serializer = new XMLSerializer();
  const refresh = (o: PreparedOverlay, t: number) => {
    const entry = rasterCache.get(o.g.id) || { img: null, busy: false };
    rasterCache.set(o.g.id, entry);
    if (entry.busy) return;
    entry.busy = true;
    o.built.timeline.seek(Math.max(0.001, t - o.g.start), false);
    const markup = serializer.serializeToString(o.built.svg);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => { entry.img = img; entry.busy = false; URL.revokeObjectURL(url); };
    img.onerror = () => { entry.busy = false; URL.revokeObjectURL(url); };
    img.src = url;
  };

  let stopped = false;
  let raf = 0;
  const paint = () => {
    if (stopped) return;
    const t = video.currentTime;
    try { ctx.drawImage(video, 0, 0, W, H); } catch { /* transient decode gap */ }
    for (const b of brolls) {
      const active = t >= b.g.start && t < b.g.end;
      if (!active) { if (!b.video.paused) { try { b.video.pause(); } catch { /* released */ } } continue; }
      if (b.video.paused) {
        try {
          b.video.currentTime = Math.max(0, Math.min(t - b.g.start, Math.max(0.1, (Number(b.video.duration) || 8) - 0.05)));
          void b.video.play().catch(() => undefined);
        } catch { /* decode race */ }
      }
      try {
        ctx.globalAlpha = Math.min(1, Math.max(0.2, Number(b.g.opacity) || 1));
        drawCover(ctx, b.video, b.region.x * W, b.region.y * H, b.region.w * W, b.region.h * H);
      } catch { /* transient decode gap */ }
      ctx.globalAlpha = 1;
    }
    for (const o of overlays) {
      if (!activeAt(o, t)) { rasterCache.delete(o.g.id); continue; }
      refresh(o, t);
      const entry = rasterCache.get(o.g.id);
      if (entry?.img) { try { ctx.drawImage(entry.img, 0, 0, W, H); } catch { /* skip a bad raster */ } }
    }
    say(`Rendering composite… ${Math.round(Math.min(1, t / durationS) * 100)}%`, 0.08 + Math.min(1, t / durationS) * 0.62);
    raf = requestAnimationFrame(paint);
  };

  say('Rendering composite…', 0.08);
  try {
    video.currentTime = 0;
    await new Promise((r) => setTimeout(r, 150));
    try { if (audioCtx?.state === 'suspended') await audioCtx.resume(); } catch { /* audio best-effort */ }
    recorder.start(500);
    await video.play();
    raf = requestAnimationFrame(paint);
    await new Promise<void>((resolve) => {
      const onEnd = () => resolve();
      video.addEventListener('ended', onEnd, { once: true });
      // Hard stop guard in case 'ended' never fires.
      setTimeout(() => resolve(), (durationS + 5) * 1000);
    });
  } finally {
    stopped = true;
    cancelAnimationFrame(raf);
    try { recorder.state !== 'inactive' && recorder.stop(); } catch { /* already stopped */ }
    await done.catch(() => undefined);
    stream.getTracks().forEach((tr) => tr.stop());
    overlays.forEach((o) => { try { o.built.timeline.kill(); } catch { /* released */ } });
    releaseBroll(brolls);
    releaseVideo(video);
    try { audioCtx?.close(); } catch { /* released */ }
  }

  const webm = new Blob(chunks, { type: 'video/webm' });
  if (!webm.size) throw new Error('The composite recording came back empty — keep the tab focused during export and try again.');

  // FFmpeg pass: WebM recording → H.264/AAC MP4 with faststart.
  say('Encoding MP4…', 0.74);
  try {
    const ff = await loadFFmpeg();
    await ff.writeFile('rec.webm', await fetchFile(webm));
    const common = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    let rc = await ff.exec(['-i', 'rec.webm', ...common, '-c:a', 'aac', '-ar', '44100', '-ac', '2', 'out.mp4']);
    if (rc !== 0) rc = await ff.exec(['-i', 'rec.webm', ...common, '-an', 'out.mp4']);
    if (rc !== 0) throw new Error('FFmpeg could not encode the MP4.');
    const bytes = await ff.readFile('out.mp4');
    const mp4 = new Blob([bytes], { type: 'video/mp4' });
    for (const n of ['rec.webm', 'out.mp4']) { try { await ff.deleteFile(n); } catch { /* fs cleanup */ } }
    if (!mp4.size) throw new Error('FFmpeg produced an empty MP4.');
    say('Publishing the video…', 0.92);
    const url = await uploadBlob(mp4, `design-video-${project.id}-${Date.now()}.mp4`);
    return { url, format: 'mp4', note: audioNote || undefined };
  } catch (ffErr: any) {
    // The WebM already carries video + audio — ship it rather than fail.
    say('FFmpeg unavailable — publishing the WebM recording…', 0.9);
    const url = await uploadBlob(webm, `design-video-${project.id}-${Date.now()}.webm`);
    return { url, format: 'webm', note: [`MP4 encoding unavailable (${String(ffErr?.message || ffErr).slice(0, 120)}) — exported as WebM.`, audioNote].filter(Boolean).join(' ') };
  }
}
