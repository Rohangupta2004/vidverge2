/**
 * Vidverge Pro — the export dialog and the two browser-side encoders.
 *
 * MP4 is the real deliverable: the whole composite (grade, captions, text,
 * overlays, cutaways, music) is rendered server-side from the same descriptors
 * the preview used. GIF and WebM are encoded here in the browser from the
 * graded picture, which is why the dialog says plainly that they carry the
 * colour work but not the overlay stack — a loop or a thumbnail does not need
 * them, and promising otherwise would be a lie the file itself would expose.
 *
 * Every control the render service cannot honour (4K, 60 fps, a bitrate dial)
 * is shown disabled with the reason, rather than quietly ignored.
 */
import { useMemo } from 'react';
import { AlertTriangle, Check, Copy, Download, Film, Loader2, Play } from 'lucide-react';
import { ASPECTS, AspectId, RESOLUTIONS, ResolutionId, outputDims } from './studioModel';
import { Modal, Pills, Section } from './proUi';

export type ExportFormat = 'mp4' | 'webm' | 'gif';

export interface ExportSpec {
  format: ExportFormat;
  resolution: ResolutionId;
  aspects: AspectId[];
  fps: 24 | 30 | 60;
  bitrate: 'auto' | 'high';
}

export interface ExportResult {
  aspect: AspectId | 'local';
  url: string;
  geometry: string;
  label: string;
}

export interface ExportProps {
  spec: ExportSpec;
  onSpec: (patch: Partial<ExportSpec>) => void;
  hasFootage: boolean;
  durationS: number;
  busy: boolean;
  progress: number;
  stage: string;
  etaS: number;
  error: string;
  warning: string;
  results: ExportResult[];
  onClose: () => void;
  onExport: () => void;
  onDownload: (r: ExportResult) => void;
  onShare: (url: string) => void;
}

const FORMATS: { id: ExportFormat; label: string; blurb: string }[] = [
  { id: 'mp4', label: 'MP4', blurb: 'Full composite, rendered on the server' },
  { id: 'webm', label: 'WebM', blurb: 'Encoded in this browser from the graded picture' },
  { id: 'gif', label: 'GIF', blurb: 'Looping 216-colour clip, built in this browser' },
];

export default function ProExport(props: ExportProps) {
  const { spec } = props;
  const serverSide = spec.format === 'mp4';

  const geometry = useMemo(() => {
    const a = spec.aspects[0] || '16:9';
    const d = outputDims(a, spec.resolution);
    return `${d.width}×${d.height}`;
  }, [spec.aspects, spec.resolution]);

  const done = props.results.length > 0 && !props.busy;

  return (
    <Modal
      title="Export video"
      icon={<Film size={16} color="#A78BFA" />}
      onClose={props.onClose}
      footer={(
        <>
          <button type="button" className="vp-btn ghost" onClick={props.onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
          <span className="vp-spread" />
          <span className="vp-note vp-mono">{geometry} · {spec.fps} fps</span>
          <button
            type="button"
            className="vp-btn primary"
            disabled={!props.hasFootage || props.busy}
            onClick={props.onExport}
          >
            {props.busy ? <Loader2 size={14} className="vp-spin" /> : <Play size={14} />}
            {props.busy ? 'Exporting…' : 'Export now'}
          </button>
        </>
      )}
    >
      <Section title="Format">
        <div className="vp-grid c3">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`vp-tile pad${spec.format === f.id ? ' on' : ''}`}
              onClick={() => props.onSpec({ format: f.id })}
              disabled={props.busy}
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
            the colour work but not burnt-in captions, text layers or cutaway overlays. Export MP4 for the full
            composite.
          </p>
        ) : null}
      </Section>

      <Section title="Quality">
        <div className="vp-pills">
          {RESOLUTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`vp-pill${spec.resolution === r.id ? ' on' : ''}`}
              disabled={!r.available || props.busy}
              title={r.note || `${r.label} output`}
              onClick={() => props.onSpec({ resolution: r.id })}
            >
              {r.label}{!r.available ? ' · n/a' : ''}
            </button>
          ))}
        </div>
        <p className="vp-note">The platform render service is pinned to a 1920×1080 canvas, so 720p and 4K are off.</p>
      </Section>

      <Section title="Aspect" hint={serverSide ? 'Tick more than one to export several' : 'Single output'}>
        <div className="vp-pills">
          {ASPECTS.map((a) => {
            const on = spec.aspects.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                className={`vp-pill${on ? ' on' : ''}`}
                title={a.blurb}
                disabled={props.busy}
                onClick={() => {
                  if (!serverSide) { props.onSpec({ aspects: [a.id] }); return; }
                  const next = on ? spec.aspects.filter((x) => x !== a.id) : [...spec.aspects, a.id];
                  props.onSpec({ aspects: next.length ? next : [a.id] });
                }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </Section>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#777' }}>
          Advanced
        </summary>
        <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span className="vp-label">Frame rate</span>
            <Pills
              options={[
                { id: '24', label: '24', title: serverSide ? 'The render service runs at 30 fps' : 'Browser encode' },
                { id: '30', label: '30' },
                { id: '60', label: '60', title: serverSide ? 'The render service runs at 30 fps' : 'Browser encode' },
              ]}
              value={String(spec.fps)}
              onPick={(id) => {
                if (serverSide) return;
                props.onSpec({ fps: Number(id) as 24 | 30 | 60 });
              }}
            />
            {serverSide ? <p className="vp-note">MP4 renders at a fixed 30 fps.</p> : null}
          </div>
          <div>
            <span className="vp-label">Bitrate</span>
            <Pills
              options={[{ id: 'auto', label: 'Auto' }, { id: 'high', label: 'High' }]}
              value={spec.bitrate}
              onPick={(id) => props.onSpec({ bitrate: id as 'auto' | 'high' })}
            />
            {serverSide ? (
              <p className="vp-note">The MP4 encoder picks its own rate — this setting applies to WebM only.</p>
            ) : null}
          </div>
        </div>
      </details>

      {props.warning ? <p className="vp-note warn">{props.warning}</p> : null}

      {props.busy ? (
        <div>
          <div className="vp-bar"><i style={{ width: `${Math.round(props.progress * 100)}%` }} /></div>
          <p className="vp-note" style={{ marginTop: 6 }}>
            {props.stage || 'Working…'}
            {props.etaS > 0 ? ` · about ${Math.ceil(props.etaS)}s left` : ''}
          </p>
        </div>
      ) : null}

      {props.error ? <p className="vp-note bad">{props.error}</p> : null}

      {props.results.length ? (
        <Section title="Download ready" hint={`${props.results.length} file${props.results.length === 1 ? '' : 's'}`}>
          {props.results.map((r) => (
            <div key={`${r.aspect}-${r.url}`} className="vp-row">
              <Check size={13} color="#34D399" />
              <span style={{ fontSize: 12, fontWeight: 650 }}>{r.label}</span>
              <span className="vp-note vp-mono">{r.geometry}</span>
              <span className="vp-spread" />
              <button type="button" className="vp-btn sm" onClick={() => props.onShare(r.url)} title="Copy a shareable link">
                <Copy size={11} />
              </button>
              <button type="button" className="vp-btn sm primary" onClick={() => props.onDownload(r)}>
                <Download size={11} /> Download
              </button>
            </div>
          ))}
        </Section>
      ) : null}
    </Modal>
  );
}

// ===========================================================================
// Browser-side encoders
// ===========================================================================

function fitBox(aspect: AspectId, longEdge: number): { w: number; h: number } {
  const ratio = (ASPECTS.find((a) => a.id === aspect) || ASPECTS[0]).ratio;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1
    ? { w: even(longEdge), h: even(longEdge / ratio) }
    : { w: even(longEdge * ratio), h: even(longEdge) };
}

/** Draw one cover-cropped, graded frame of `video` into `ctx`. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
  filter: string,
) {
  ctx.save();
  ctx.filter = filter && filter !== 'none' ? filter : 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    try { video.currentTime = t; } catch { done(); }
    window.setTimeout(done, 1200);
  });
}

// ---- GIF89a ---------------------------------------------------------------

/** 6×6×6 colour cube — 216 entries, padded to a full 256-entry table. */
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

export interface ClientExportOptions {
  video: HTMLVideoElement;
  aspect: AspectId;
  /** CSS filter chain applied to each frame, e.g. the clip's grade. */
  filter: string;
  startS: number;
  endS: number;
  fps: number;
  onProgress: (p: number) => void;
}

/**
 * Sample the clip and encode a looping GIF. Deliberately capped: a GIF is an
 * indexed-colour format, and a 20-second 1080p one is a 100 MB file nobody
 * can post, so the long edge is held at 480 px and the clip at 10 seconds.
 */
export async function encodeGif(opts: ClientExportOptions): Promise<Blob> {
  const { w, h } = fitBox(opts.aspect, 480);
  const fps = Math.max(5, Math.min(20, Math.round(opts.fps / 2)));
  const span = Math.max(0.3, Math.min(10, opts.endS - opts.startS));
  const frameCount = Math.max(2, Math.min(200, Math.round(span * fps)));
  const delay = Math.max(2, Math.round(100 / fps)); // hundredths of a second

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
  out.push(0xf7, 0, 0);               // global table, 8-bit, 256 entries
  cubePalette().forEach((v) => out.push(v));
  str('!');
  out.push(0xff, 11);
  str('NETSCAPE2.0');
  out.push(3, 1, 0, 0, 0);            // loop forever

  for (let i = 0; i < frameCount; i += 1) {
    const t = opts.startS + (span * i) / frameCount;
    await seek(opts.video, t);
    drawFrame(ctx, opts.video, w, h, opts.filter);
    const { data } = ctx.getImageData(0, 0, w, h);
    const indices = new Uint8Array(w * h);
    for (let p = 0, q = 0; p < indices.length; p += 1, q += 4) {
      indices[p] = Math.round(data[q] / 51) * 36 + Math.round(data[q + 1] / 51) * 6 + Math.round(data[q + 2] / 51);
    }
    out.push(0x21, 0xf9, 4, 0x04);    // graphic control, do-not-dispose
    u16(delay);
    out.push(0, 0);
    out.push(0x2c);                   // image descriptor
    u16(0); u16(0); u16(w); u16(h);
    out.push(0);
    out.push(8);                      // LZW minimum code size
    pushSubBlocks(out, lzwEncode(indices, 8));
    opts.onProgress((i + 1) / frameCount);
  }
  out.push(0x3b);

  if (!wasPaused) void opts.video.play().catch(() => undefined);
  return new Blob([new Uint8Array(out)], { type: 'image/gif' });
}

/**
 * Record the graded picture into a WebM with MediaRecorder. The canvas is
 * driven frame by frame rather than mirrored in real time, so the output is
 * the full clip even if the tab is throttled mid-encode.
 */
export async function encodeWebm(opts: ClientExportOptions & { bitrate: 'auto' | 'high' }): Promise<Blob> {
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
    await seek(opts.video, opts.startS + (span * i) / frames);
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

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 20000);
}
