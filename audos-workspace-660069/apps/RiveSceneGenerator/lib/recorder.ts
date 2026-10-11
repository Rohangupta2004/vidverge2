// Canvas recording → MP4 export via the MediaRecorder API.
//
// MediaRecorder produces MP4/H.264 in modern Chrome and Safari; where only WebM
// is available we fall back to it and label the download honestly. If the API is
// missing entirely, isRecordingSupported() is false and the UI shows a notice.

export interface RecordingFormat {
  mimeType: string;
  ext: 'mp4' | 'webm';
}

const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=h264',
  'video/mp4;codecs=avc1',
  'video/mp4',
];
const WEBM_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof (HTMLCanvasElement.prototype as any).captureStream === 'function'
  );
}

export function pickFormat(): RecordingFormat | null {
  if (!isRecordingSupported()) return null;
  const canUse = (m: string) => {
    try {
      return (window as any).MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  };
  for (const m of MP4_CANDIDATES) if (canUse(m)) return { mimeType: m, ext: 'mp4' };
  for (const m of WEBM_CANDIDATES) if (canUse(m)) return { mimeType: m, ext: 'webm' };
  return { mimeType: '', ext: 'webm' };
}

export interface RecordingResult {
  blob: Blob;
  url: string;
  format: RecordingFormat;
  filename: string;
}

export class SceneRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private format: RecordingFormat | null = null;
  startedAt = 0;

  get isRecording(): boolean {
    return !!this.recorder && this.recorder.state === 'recording';
  }

  start(canvas: HTMLCanvasElement, fps: number): boolean {
    if (!isRecordingSupported()) return false;
    this.format = pickFormat();
    if (!this.format) return false;
    let stream: MediaStream;
    try {
      stream = (canvas as any).captureStream(fps);
    } catch (e) {
      console.warn('[recorder] captureStream failed', e);
      return false;
    }
    try {
      const opts: MediaRecorderOptions = { videoBitsPerSecond: 8_000_000 };
      if (this.format.mimeType) opts.mimeType = this.format.mimeType;
      this.recorder = new MediaRecorder(stream, opts);
    } catch (e) {
      console.warn('[recorder] MediaRecorder construction failed', e);
      return false;
    }
    this.chunks = [];
    this.recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
    };
    this.startedAt = performance.now();
    this.recorder.start(100);
    return true;
  }

  stop(): Promise<RecordingResult | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === 'inactive') {
        resolve(null);
        return;
      }
      rec.onstop = () => {
        const fmt = this.format || { mimeType: 'video/webm', ext: 'webm' as const };
        const blob = new Blob(this.chunks, { type: fmt.mimeType || `video/${fmt.ext}` });
        const url = URL.createObjectURL(blob);
        const ts = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .replace('T', '_')
          .slice(0, 19);
        const filename = `rive-scene-${ts}.${fmt.ext}`;
        this.recorder = null;
        resolve({ blob, url, format: fmt, filename });
      };
      try {
        rec.stop();
      } catch (e) {
        console.warn('[recorder] stop failed', e);
        resolve(null);
      }
    });
  }
}

export function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
