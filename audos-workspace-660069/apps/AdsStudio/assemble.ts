/**
 * ADS STUDIO — final assembly with FFmpeg.wasm (@ffmpeg/ffmpeg + @ffmpeg/util)
 * running entirely in the browser. NO Remotion, no server renderer.
 *
 * Pipeline per ad:
 *   1. Download every Veo clip into the FFmpeg virtual FS.
 *   2. Write each clip's recorded overlay WebM (GSAP/SVG capture on the
 *      magenta chroma key) and composite it with colorkey + overlay — opaque
 *      overlay content (screenshots in device mockups, captions, cards)
 *      survives, magenta vanishes.
 *   3. Normalize every segment to one geometry/fps/codec (keeping each Veo
 *      clip's native audio — that audio IS the ad's voice track).
 *   4. Concat into the final MP4 (h264 + aac, faststart) and hand back a blob
 *      URL for instant download plus a durable uploaded URL.
 *
 * Loaded lazily — nothing FFmpeg-related is fetched until the first assembly.
 * The ESM core + same-origin worker bootstrap mirrors the platform-proven
 * pattern: the FFmpeg class spawns a MODULE worker, and a module worker
 * cannot importScripts() the UMD build, while the class's own worker URL
 * resolves cross-origin — both fixed below.
 */

import { FFmpeg } from 'https://esm.sh/@ffmpeg/ffmpeg@0.12.10';
import { fetchFile, toBlobURL } from 'https://esm.sh/@ffmpeg/util@0.12.1';
import { uploadBlob } from './api';
import { KEY_COLOR } from './overlays';

const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
const WORKER_ENTRY = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js';

let instance: any = null;
let logSink: ((line: string) => void) | null = null;

async function loadFFmpeg(): Promise<any> {
  if (instance) return instance;
  const ff = new FFmpeg();
  ff.on('log', (e: any) => { try { logSink?.(String(e?.message || '')); } catch { /* UI only */ } });
  const classWorkerURL = URL.createObjectURL(new Blob([`import "${WORKER_ENTRY}";`], { type: 'text/javascript' }));
  try {
    await ff.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
      classWorkerURL,
    } as any);
    instance = ff;
    return ff;
  } catch (e: any) {
    throw new Error(`FFmpeg could not start in this browser: ${String(e?.message || e).slice(0, 160)}`);
  } finally {
    URL.revokeObjectURL(classWorkerURL);
  }
}

function frameSize(aspect: '9:16' | '16:9' | '1:1'): { W: number; H: number } {
  // 720-class output keeps browser encoding fast and the wasm heap bounded.
  if (aspect === '9:16') return { W: 720, H: 1280 };
  if (aspect === '1:1') return { W: 960, H: 960 };
  return { W: 1280, H: 720 };
}
export { frameSize as adFrameSize };

function extOf(url: string): string {
  const m = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.exec(url);
  return m ? m[1].toLowerCase() : 'mp4';
}

export interface AssemblyClip {
  clipNumber: number;
  url: string;
  /** Recorded chroma-key overlay for this clip (or null for a clean clip). */
  overlayBlob: Blob | null;
  durationS: number | null;
}

export interface AssemblyResult {
  /** Durable uploaded URL of the final ad. */
  url: string;
  /** Local object URL for the instant download button. */
  blobUrl: string;
  bytes: number;
}

export async function assembleAd(
  clips: AssemblyClip[],
  aspect: '9:16' | '16:9' | '1:1',
  opts: { onProgress?: (note: string, fraction: number) => void; onLog?: (line: string) => void; fileTag?: string } = {},
): Promise<AssemblyResult> {
  if (!clips.length) throw new Error('No clips to assemble yet.');
  const say = (note: string, f: number) => { try { opts.onProgress?.(note, f); } catch { /* UI only */ } };
  logSink = opts.onLog || null;

  const ff = await loadFFmpeg();
  const { W, H } = frameSize(aspect);
  const key = KEY_COLOR.replace('#', '0x');
  const names: string[] = [];

  try {
    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i];
      say(`Compositing clip ${i + 1} of ${clips.length}…`, (i / (clips.length + 2)) * 0.85);
      const inName = `in_${i}.${extOf(clip.url)}`;
      const outName = `seg_${i}.mp4`;
      await ff.writeFile(inName, await fetchFile(clip.url));

      const dur = Number(clip.durationS) || 0;
      const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
      const common = ['-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2'];
      const bound = dur > 0 ? ['-t', dur.toFixed(2)] : [];

      let rc = 1;
      let ovName = '';
      if (clip.overlayBlob && clip.overlayBlob.size) {
        try {
          ovName = `ov_${i}.webm`;
          await ff.writeFile(ovName, await fetchFile(clip.overlayBlob));
          // Chroma-key the overlay and lay it over the normalized base; the
          // clip's own audio (the spoken line Veo generated) is preserved.
          const fc = `[0:v]${vf}[b];[1:v]scale=${W}:${H},setsar=1,fps=30,colorkey=${key}:0.28:0.12[ov];[b][ov]overlay=0:0:shortest=0[v]`;
          rc = await ff.exec(['-i', inName, '-i', ovName, '-filter_complex', fc, ...common, ...bound, '-map', '[v]', '-map', '0:a:0', outName]);
          if (rc !== 0) {
            rc = await ff.exec(['-i', inName, '-i', ovName, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-filter_complex', fc, ...common, ...bound, '-map', '[v]', '-map', '2:a:0', '-shortest', outName]);
          }
        } catch { rc = 1; }
        if (rc !== 0) say(`Clip ${i + 1}: the overlay composite failed — shipping the plain clip.`, (i / (clips.length + 2)) * 0.85);
      }
      if (rc !== 0) {
        rc = await ff.exec(['-i', inName, '-vf', vf, ...common, ...bound, '-map', '0:v:0', '-map', '0:a:0', outName]);
        if (rc !== 0) rc = await ff.exec(['-i', inName, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-vf', vf, ...common, ...bound, '-map', '0:v:0', '-map', '1:a:0', '-shortest', outName]);
      }
      if (rc !== 0) throw new Error(`Clip ${i + 1} could not be normalized for assembly.`);
      try { await ff.deleteFile(inName); } catch { /* fs cleanup */ }
      if (ovName) { try { await ff.deleteFile(ovName); } catch { /* fs cleanup */ } }
      names.push(outName);
    }

    say('Joining clips…', 0.9);
    const list = names.map((n) => `file '${n}'`).join('\n');
    await ff.writeFile('list.txt', new TextEncoder().encode(list));
    const rc = await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'final.mp4']);
    if (rc !== 0) throw new Error('The final join failed inside FFmpeg.');

    const bytes = await ff.readFile('final.mp4');
    const blob = new Blob([bytes], { type: 'video/mp4' });
    if (!blob.size) throw new Error('FFmpeg produced an empty file.');

    say('Publishing the ad…', 0.96);
    const url = await uploadBlob(blob, `ads-studio-${opts.fileTag || 'ad'}-${Date.now()}.mp4`);
    return { url, blobUrl: URL.createObjectURL(blob), bytes: blob.size };
  } finally {
    logSink = null;
    for (const n of [...names, 'list.txt', 'final.mp4']) { try { await ff.deleteFile(n); } catch { /* fs cleanup */ } }
  }
}
