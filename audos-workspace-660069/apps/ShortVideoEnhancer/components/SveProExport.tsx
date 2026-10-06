/**
 * Short Video Enhancer — the export dialog, plus the two browser encoders.
 *
 * MP4 is the real deliverable: the whole composite (grade, camera move,
 * captions, cards, B-roll, music, fades) is rendered server-side from the
 * same document the preview used, then finished to a true 1080x1920 master.
 * GIF and WebM are encoded here in the browser from the graded picture, so
 * the dialog says plainly that they carry the colour work but not the overlay
 * stack — a loop preview does not need it, and claiming otherwise would be a
 * lie the file itself would expose.
 */
import { AlertTriangle, Captions, Check, Clock3, Copy, Download, Film, Loader2, Play } from 'lucide-react';
import { SHORT_ASPECTS, formatBytes, type CaptionLanguage, type ShortAspect } from '../lib/sveTypes';
import { Modal, Pills, Section } from '../lib/sveProUi';

export type SveExportFormat = 'mp4' | 'webm' | 'gif';
export type ExportPhase = 'idle' | 'uploading' | 'submitting' | 'rendering' | 'sizing' | 'ready' | 'failed';

export interface SveExportSpec {
  format: SveExportFormat;
  /** Which platform frame the creator is delivering for. */
  target: ShortAspect;
  fps: 24 | 30 | 60;
  bitrate: 'auto' | 'high';
}

export interface SveExportVariant { url: string; bytes: number }

export interface SveExportProps {
  spec: SveExportSpec;
  onSpec: (patch: Partial<SveExportSpec>) => void;
  phase: ExportPhase;
  elapsedS: number;
  geometry: string;
  error: string;
  blockedReason: string;
  canExport: boolean;
  downloading: string;
  master: SveExportVariant | null;
  compressed: SveExportVariant | null;
  smaller: boolean;
  note: string;
  /** Browser-encoded GIF / WebM, when one has been built. */
  localUrl: string;
  localBytes: number;
  localProgress: number;
  /** Cues available for the sidecar subtitle file. */
  cueCount: number;
  captionLanguage: CaptionLanguage;
  onClose: () => void;
  onExport: () => void;
  onDownload: (which: 'master' | 'compressed' | 'local') => void;
  onDownloadCaptions: (format: 'srt' | 'vtt') => void;
  onShare: (url: string) => void;
}

const PLATFORM_PRESETS: { id: ShortAspect; label: string; blurb: string }[] = [
  { id: '9:16', label: 'TikTok', blurb: '9:16 vertical' },
  { id: '9:16', label: 'Reels', blurb: '9:16 vertical' },
  { id: '9:16', label: 'Shorts', blurb: '9:16 vertical' },
  { id: '1:1', label: 'Square', blurb: '1:1 feed post' },
];

const PHASE_LABEL: Record<ExportPhase, string> = {
  idle: '',
  uploading: 'Uploading the source clip…',
  submitting: 'Submitting the composition…',
  rendering: 'Rendering frame by frame…',
  sizing: 'Measuring and building the share size…',
  ready: 'Export complete',
  failed: 'Export failed',
};

const PHASE_PROGRESS: Record<ExportPhase, number> = {
  idle: 0, uploading: 0.12, submitting: 0.25, rendering: 0.68, sizing: 0.9, ready: 1, failed: 1,
};

export default function SveProExport(props: SveExportProps) {
  const { spec } = props;
  const serverSide = spec.format === 'mp4';
  const busy = props.phase !== 'idle' && props.phase !== 'ready' && props.phase !== 'failed';
  const progress = serverSide ? PHASE_PROGRESS[props.phase] : props.localProgress;

  return (
    <Modal
      title="Export short"
      icon={<Film size={16} color="#A78BFA" />}
      onClose={props.onClose}
      footer={(
        <>
          <button type="button" className="vp-btn ghost" onClick={props.onClose}>Close</button>
          <span className="vp-spread" />
          <span className="vp-note vp-mono">{serverSide ? '1080×1920 · 30 fps' : `${spec.fps} fps`}</span>
          <button
            type="button"
            className="vp-btn primary"
            disabled={!props.canExport || busy}
            onClick={props.onExport}
            title={props.blockedReason || undefined}
          >
            {busy ? <Loader2 size={14} className="vp-spin" /> : <Play size={14} />}
            {busy ? 'Exporting…' : 'Export now'}
          </button>
        </>
      )}
    >
      <Section title="Platform" hint="Quick presets">
        <div className="vp-grid c2">
          {PLATFORM_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`vp-tile pad${spec.target === p.id ? ' on' : ''}`}
              disabled={busy}
              onClick={() => props.onSpec({ target: p.id })}
            >
              <b style={{ fontSize: 12, display: 'block', color: '#E2E2E2' }}>{p.label}</b>
              <small style={{ fontSize: 10, color: '#6A6A6A' }}>{p.blurb}</small>
            </button>
          ))}
        </div>
        <p className="vp-note">
          Every master renders 1080×1920 — the render service accepts no other geometry. TikTok, Reels and Shorts all
          take that file as-is; Square tells the editor to keep the action inside a centred 1:1 safe frame.
        </p>
      </Section>

      <Section title="Format">
        <div className="vp-grid c3">
          {([
            { id: 'mp4' as const, label: 'MP4', blurb: 'Full composite, rendered on the server' },
            { id: 'webm' as const, label: 'WebM', blurb: 'Browser encode of the graded picture' },
            { id: 'gif' as const, label: 'GIF', blurb: 'Looping 216-colour clip, in your browser' },
          ]).map((f) => (
            <button
              key={f.id}
              type="button"
              className={`vp-tile pad${spec.format === f.id ? ' on' : ''}`}
              disabled={busy}
              onClick={() => props.onSpec({ format: f.id })}
            >
              <b style={{ fontSize: 12.5, display: 'block', color: '#E2E2E2' }}>{f.label}</b>
              <small style={{ fontSize: 10, color: '#6A6A6A', lineHeight: 1.4 }}>{f.blurb}</small>
            </button>
          ))}
        </div>
        {!serverSide ? (
          <p className="vp-note warn">
            <AlertTriangle size={11} style={{ marginRight: 4 }} />
            {spec.format === 'gif' ? 'GIF' : 'WebM'} is built in your browser from the graded picture, so it carries
            the colour work but not burnt-in captions, cards or cutaways. Export MP4 for the full composite.
          </p>
        ) : null}
      </Section>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#777' }}>
          Advanced
        </summary>
        <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span className="vp-label">Frame rate</span>
            <Pills
              options={[{ id: '24', label: '24' }, { id: '30', label: '30' }, { id: '60', label: '60' }]}
              value={String(spec.fps)}
              onPick={(id) => { if (!serverSide) props.onSpec({ fps: Number(id) as 24 | 30 | 60 }); }}
            />
            {serverSide ? <p className="vp-note">The MP4 master renders at a fixed 30 fps.</p> : null}
          </div>
          <div>
            <span className="vp-label">Bitrate</span>
            <Pills
              options={[{ id: 'auto', label: 'Auto' }, { id: 'high', label: 'High' }]}
              value={spec.bitrate}
              onPick={(id) => props.onSpec({ bitrate: id as 'auto' | 'high' })}
            />
            {serverSide ? <p className="vp-note">Applies to the browser WebM encode only.</p> : null}
          </div>
        </div>
      </details>

      <Section title="Caption file" hint={props.cueCount ? props.cueCount + ' cues' : 'No captions yet'}>
        <div className="vp-row">
          <Captions size={13} color={props.cueCount ? '#A78BFA' : '#5A5A5A'} />
          <span style={{ fontSize: 12, fontWeight: 650 }}>
            {props.captionLanguage === 'hinglish' ? 'Hinglish subtitles' : 'English subtitles'}
          </span>
          <span className="vp-spread" />
          <button
            type="button"
            className="vp-btn sm"
            disabled={!props.cueCount}
            title={props.cueCount ? 'Download an .srt sidecar of this caption track' : 'Generate captions first'}
            onClick={() => props.onDownloadCaptions('srt')}
          >
            <Download size={11} /> SRT
          </button>
          <button
            type="button"
            className="vp-btn sm"
            disabled={!props.cueCount}
            title={props.cueCount ? 'Download a .vtt sidecar of this caption track' : 'Generate captions first'}
            onClick={() => props.onDownloadCaptions('vtt')}
          >
            <Download size={11} /> VTT
          </button>
        </div>
        <p className="vp-note">
          The captions are already burnt into the MP4. This is the same track as a separate file for platforms
          that want one — written in the transcript's own casing, because UPPERCASE is a look rather than part of
          the words. Romanized Hindi is Latin script, so a Hinglish track needs nothing beyond the UTF-8 both
          formats already are.
        </p>
      </Section>

      {props.blockedReason ? <p className="vp-note warn">{props.blockedReason}</p> : null}

      {busy || (!serverSide && props.localProgress > 0 && props.localProgress < 1) ? (
        <div>
          <div className="vp-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <p className="vp-note" style={{ marginTop: 6 }}>
            <Clock3 size={11} style={{ marginRight: 4 }} />
            {serverSide ? PHASE_LABEL[props.phase] : 'Encoding in your browser…'}
            {props.elapsedS > 0 ? ` · ${props.elapsedS}s elapsed` : ''}
          </p>
        </div>
      ) : null}

      {props.error ? <p className="vp-note bad">{props.error}</p> : null}
      {props.note ? <p className="vp-note">{props.note}</p> : null}

      {props.master ? (
        <Section title="Download ready" hint={props.geometry || '1080×1920 · H.264'}>
          <div className="vp-row">
            <Check size={13} color="#34D399" />
            <span style={{ fontSize: 12, fontWeight: 650 }}>Master MP4</span>
            <span className="vp-note vp-mono">{formatBytes(props.master.bytes)}</span>
            <span className="vp-spread" />
            <button type="button" className="vp-btn sm" title="Copy a shareable link" onClick={() => props.onShare(props.master!.url)}>
              <Copy size={11} />
            </button>
            <button type="button" className="vp-btn sm primary" disabled={props.downloading === 'master'} onClick={() => props.onDownload('master')}>
              {props.downloading === 'master' ? <Loader2 size={11} className="vp-spin" /> : <Download size={11} />} Download
            </button>
          </div>
          {props.compressed && props.smaller ? (
            <div className="vp-row">
              <Check size={13} color="#34D399" />
              <span style={{ fontSize: 12, fontWeight: 650 }}>Share size</span>
              <span className="vp-note vp-mono">{formatBytes(props.compressed.bytes)}</span>
              <span className="vp-spread" />
              <button type="button" className="vp-btn sm" onClick={() => props.onShare(props.compressed!.url)}>
                <Copy size={11} />
              </button>
              <button type="button" className="vp-btn sm" disabled={props.downloading === 'compressed'} onClick={() => props.onDownload('compressed')}>
                {props.downloading === 'compressed' ? <Loader2 size={11} className="vp-spin" /> : <Download size={11} />} Download
              </button>
            </div>
          ) : null}
        </Section>
      ) : null}

      {props.localUrl ? (
        <Section title="Browser encode" hint={spec.format.toUpperCase()}>
          <div className="vp-row">
            <Check size={13} color="#34D399" />
            <span style={{ fontSize: 12, fontWeight: 650 }}>{spec.format.toUpperCase()} ready</span>
            <span className="vp-note vp-mono">{formatBytes(props.localBytes)}</span>
            <span className="vp-spread" />
            <button type="button" className="vp-btn sm primary" onClick={() => props.onDownload('local')}>
              <Download size={11} /> Download
            </button>
          </div>
        </Section>
      ) : null}
    </Modal>
  );
}

// ===========================================================================
// Browser-side encoders
// ===========================================================================

function fitBox(aspect: ShortAspect, longEdge: number): { w: number; h: number } {
  const ratio = (SHORT_ASPECTS.find((a) => a.id === aspect) || SHORT_ASPECTS[0]).ratio;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1
    ? { w: even(longEdge), h: even(longEdge / ratio) }
    : { w: even(longEdge * ratio), h: even(longEdge) };
}

function drawFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h: number, filter: string) {
  ctx.save();
  ctx.filter = filter && filter !== 'none' ? filter : 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  ctx.drawImage(video, (w - vw * scale) / 2, (h - vh * scale) / 2, vw * scale, vh * scale);
  ctx.restore();
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    try { video.currentTime = t; } catch { done(); }
    window.setTimeout(done, 1200);
  });
}

/** 6x6x6 colour cube — 216 entries, padded to a full 256-entry table. */
function cubePalette(): number[] {
  const table: number[] = [];
  for (let r = 0; r < 6; r += 1) {
    for (let g = 0; g < 6; g += 1) {
      for (let b = 0; b < 6; b += 1) table.push(r * 51, g * 51, b * 51);
    }
  }
  while (table.length < 256 * 3) table.push(0);
  return table;
}

function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = EOI + 1;
  let dict = new Map<number, number>();
  const bytes: number[] = [];
  let acc = 0;
  let accBits = 0;
  const write = (code: number) => {
    acc |= code << accBits;
    accBits += codeSize;
    while (accBits >= 8) { bytes.push(acc & 255); acc >>>= 8; accBits -= 8; }
  };

  write(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    write(prefix);
    if (nextCode < 4096) {
      dict.set(key, nextCode);
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      nextCode += 1;
    } else {
      write(CLEAR);
      dict = new Map();
      codeSize = minCodeSize + 1;
      nextCode = EOI + 1;
    }
    prefix = k;
  }
  write(prefix);
  write(EOI);
  if (accBits > 0) bytes.push(acc & 255);
  return bytes;
}

function pushSubBlocks(out: number[], data: number[]) {
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    out.push(chunk.length);
    for (let j = 0; j < chunk.length; j += 1) out.push(chunk[j]);
  }
  out.push(0);
}

export interface SveClientExport {
  video: HTMLVideoElement;
  aspect: ShortAspect;
  filter: string;
  startS: number;
  endS: number;
  fps: number;
  onProgress: (p: number) => void;
}

/**
 * A looping GIF of the graded picture. Deliberately capped at a 480 px long
 * edge and ten seconds: GIF is an indexed-colour format and a full-length
 * 1080p one is a file nobody can post.
 */
export async function encodeSveGif(opts: SveClientExport): Promise<Blob> {
  const { w, h } = fitBox(opts.aspect, 480);
  const fps = Math.max(5, Math.min(20, Math.round(opts.fps / 2)));
  const span = Math.max(0.3, Math.min(10, opts.endS - opts.startS));
  const frameCount = Math.max(2, Math.min(200, Math.round(span * fps)));
  const delay = Math.max(2, Math.round(100 / fps));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser would not give the exporter a 2D canvas.');

  const wasPaused = opts.video.paused;
  opts.video.pause();

  const out: number[] = [];
  const str = (s: string) => { for (let i = 0; i < s.length; i += 1) out.push(s.charCodeAt(i)); };
  const u16 = (n: number) => { out.push(n & 255, (n >> 8) & 255); };

  str('GIF89a');
  u16(w);
  u16(h);
  out.push(0xf7, 0, 0);
  cubePalette().forEach((v) => out.push(v));
  str('!');
  out.push(0xff, 11);
  str('NETSCAPE2.0');
  out.push(3, 1, 0, 0, 0);

  for (let i = 0; i < frameCount; i += 1) {
    await seekTo(opts.video, opts.startS + (span * i) / frameCount);
    drawFrame(ctx, opts.video, w, h, opts.filter);
    const { data } = ctx.getImageData(0, 0, w, h);
    const indices = new Uint8Array(w * h);
    for (let p = 0, q = 0; p < indices.length; p += 1, q += 4) {
      indices[p] = Math.round(data[q] / 51) * 36 + Math.round(data[q + 1] / 51) * 6 + Math.round(data[q + 2] / 51);
    }
    out.push(0x21, 0xf9, 4, 0x04);
    u16(delay);
    out.push(0, 0);
    out.push(0x2c);
    u16(0); u16(0); u16(w); u16(h);
    out.push(0);
    out.push(8);
    pushSubBlocks(out, lzwEncode(indices, 8));
    opts.onProgress((i + 1) / frameCount);
  }
  out.push(0x3b);

  if (!wasPaused) void opts.video.play().catch(() => undefined);
  return new Blob([new Uint8Array(out)], { type: 'image/gif' });
}

/** WebM of the graded picture, driven frame by frame through MediaRecorder. */
export async function encodeSveWebm(opts: SveClientExport & { bitrate: 'auto' | 'high' }): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser has no MediaRecorder, so WebM cannot be encoded here. Export MP4 instead.');
  }
  const { w, h } = fitBox(opts.aspect, 1080);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser would not give the exporter a 2D canvas.');

  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('This browser cannot encode WebM. Export MP4 instead.');

  const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(0);
  const track = stream.getVideoTracks()[0] as unknown as { requestFrame?: () => void };
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: opts.bitrate === 'high' ? 12000000 : 6000000,
  });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const wasPaused = opts.video.paused;
  opts.video.pause();
  recorder.start();

  const fps = Math.max(12, Math.min(60, opts.fps));
  const span = Math.max(0.3, opts.endS - opts.startS);
  const frames = Math.max(2, Math.round(span * fps));
  for (let i = 0; i < frames; i += 1) {
    await seekTo(opts.video, opts.startS + (span * i) / frames);
    drawFrame(ctx, opts.video, w, h, opts.filter);
    track.requestFrame?.();
    opts.onProgress((i + 1) / frames);
  }

  const blob: Blob = await new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    recorder.stop();
  });
  stream.getTracks().forEach((t) => t.stop());
  if (!wasPaused) void opts.video.play().catch(() => undefined);
  return blob;
}
