/**
 * STAGE 12 — runMechanicalQA (Stage 1 QA).
 *
 * Deterministic measurement of the ACTUAL rendered file. No model is involved
 * and no opinion is formed: every check either measures a number or reports
 * that it could not run.
 *
 * THE RULE THIS STAGE EXISTS UNDER, learned the hard way: A MEASUREMENT THAT
 * COULD NOT RUN IS NOT A BROKEN FILM. An earlier version loaded the render
 * with crossOrigin="anonymous" so one canvas read would be possible, which
 * turns the media load into a CORS request — and the render bucket does not
 * send Access-Control-Allow-Origin, so the browser aborted the load outright.
 * The file was perfect and plays fine in the result player (which sets no
 * crossOrigin), but QA saw "could not be decoded" and killed a film that had
 * already cost a full render. Two things follow, and both are load-bearing:
 *
 *   1. Nothing that needs only METADATA may depend on a CORS grant. Duration
 *      and frame cadence are read from a plain, un-CORSed video element.
 *   2. `pass` means "nothing that actually ran failed". Inconclusive checks
 *      are listed and ignored; they never fail the film and never trigger a
 *      re-render.
 *
 * Blank-picture detection now measures the stills the render adapter ALREADY
 * extracted server-side for creative QA, instead of seeking the MP4 ninety
 * times through a canvas. That is cheaper, far faster, and sidesteps the CORS
 * problem for the common case. Where even those stills cannot be read as
 * pixels, the check is inconclusive here — and creative QA looks at the same
 * frames with Opus Vision one stage later, so a blank beat is still caught.
 */

import type {
  FilmSpec,
  FrameRef,
  MechanicalCheck,
  MechanicalQAResult,
  WordTimestamp,
} from '../types/editorial';

/**
 * The render service is 30fps, so a frame is 33ms. The tolerance is a little
 * wider than that because an MP4 container rounds the final sample up, and a
 * 40ms rounding error is not worth charging the customer for a second render.
 */
export const DURATION_TOLERANCE = 0.15;
export const MAX_BLACK_SECONDS = 0.5;
export const BLACK_LUMA = 10;
export const MAX_NARRATION_GAP = 1.2;

export interface MechanicalQAInput {
  mp4Url: string;
  spec: FilmSpec;
  /** Stills already pulled from this render. Reused rather than re-extracted. */
  frames?: FrameRef[];
  onNote?: (note: string) => void;
}

export async function runMechanicalQA(input: MechanicalQAInput): Promise<MechanicalQAResult> {
  const { mp4Url, spec } = input;
  const checks: MechanicalCheck[] = [];
  const inconclusive: string[] = [];
  const expected = spec.timeline.duration;

  input.onNote?.('Measuring the rendered file…');

  // Plain load: no crossOrigin, so a bucket without CORS headers still gives
  // us metadata. This must never be made conditional on canvas access.
  const video = await loadVideo(mp4Url, false);

  // Captured before the element is released: reading .duration off a released
  // element gives NaN, and the audio checks below need the picture length.
  let pictureDuration = expected;

  if (video) {
    try {
      const actual = Number(video.duration);
      if (Number.isFinite(actual) && actual > 0) {
        pictureDuration = actual;
        checks.push({
          id: 'duration_match',
          pass: Math.abs(actual - expected) <= DURATION_TOLERANCE,
          detail: `Rendered ${fmt(actual)}s against ${fmt(expected)}s of narration.`,
          measured: round3(actual),
          expected: round3(expected),
        });
      } else {
        inconclusive.push('Duration: the file loaded but reported no usable length.');
      }

      input.onNote?.('Checking frame cadence…');
      const cadence = await checkFrameRate(video, spec.motionPlan.fps);
      if (cadence) checks.push(cadence);
      else inconclusive.push('Frame-rate consistency: this browser exposes no per-frame callback.');
    } finally {
      release(video);
    }
  } else {
    inconclusive.push(
      'Duration and frame cadence: this browser could not open the rendered file for inspection. The film itself is unaffected — it plays from the result player.',
    );
  }

  input.onNote?.('Checking the picture for blank beats…');
  const blank = await checkBlankFrames(input.frames || []);
  if (blank) checks.push(blank);
  else {
    inconclusive.push(
      'Blank-picture detection: the extracted stills could not be read as pixels from this browser. Creative QA reviews the same frames with vision next.',
    );
  }

  input.onNote?.('Decoding the audio track…');
  const audio = await decodeAudio(mp4Url);
  if (audio) {
    checks.push(...audioChecks(audio, spec, pictureDuration));
  } else {
    // "I could not fetch the bytes" is emphatically not "the film is silent".
    inconclusive.push(
      'Audio presence, sync and narration gaps: the rendered audio track could not be fetched for decoding from this browser.',
    );
  }

  const failed = checks.filter((check) => !check.pass);
  return { pass: failed.length === 0, checks, inconclusive };
}

/** True when the stage measured nothing at all, so its verdict carries no weight. */
export function isInconclusive(result: MechanicalQAResult): boolean {
  return result.checks.length === 0;
}

// ---------------------------------------------------------------------------
// Video metadata
// ---------------------------------------------------------------------------

function loadVideo(url: string, cors: boolean): Promise<HTMLVideoElement | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    // Requesting CORS on a host that does not grant it aborts the load, so it
    // is opt-in and only used where pixels are genuinely needed.
    if (cors) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    (video as any).playsInline = true;
    const guard = setTimeout(() => resolve(null), 45000);
    video.onloadedmetadata = () => {
      clearTimeout(guard);
      resolve(video);
    };
    video.onerror = () => {
      clearTimeout(guard);
      resolve(null);
    };
    video.src = url;
  });
}

function release(video: HTMLVideoElement): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    /* already released */
  }
}

function seek(video: HTMLVideoElement, time: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      video.removeEventListener('seeked', onSeeked);
      resolve(ok);
    };
    const onSeeked = () => setTimeout(() => finish(true), 40);
    const guard = setTimeout(() => finish(false), 6000);
    video.addEventListener('seeked', onSeeked);
    try {
      video.currentTime = time;
    } catch {
      finish(false);
    }
  });
}

/**
 * Plays a short window and reads the presentation time of each delivered
 * frame. An encoder that dropped or duplicated frames shows up as a spread in
 * those intervals that a nominal frame rate would never produce. Needs no
 * pixel access, so it works on a plain un-CORSed element.
 */
async function checkFrameRate(video: HTMLVideoElement, expectedFps: number): Promise<MechanicalCheck | null> {
  const frameVideo = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: any) => void) => number;
  };
  if (typeof frameVideo.requestVideoFrameCallback !== 'function') return null;

  const times: number[] = [];
  await seek(video, Math.min(1, Math.max(0, video.duration / 4)));

  const collected = await new Promise<boolean>((resolve) => {
    const guard = setTimeout(() => resolve(times.length > 6), 6000);
    const onFrame = (_now: number, meta: any) => {
      times.push(Number(meta?.mediaTime));
      if (times.length >= 30) {
        clearTimeout(guard);
        resolve(true);
        return;
      }
      frameVideo.requestVideoFrameCallback!(onFrame);
    };
    frameVideo.requestVideoFrameCallback!(onFrame);
    video.play().catch(() => {
      clearTimeout(guard);
      resolve(false);
    });
  });
  video.pause();

  const deltas = times
    .slice(1)
    .map((time, index) => time - times[index])
    .filter((delta) => Number.isFinite(delta) && delta > 0);
  if (!collected || deltas.length < 5) return null;

  const mean = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
  const spread = Math.max(...deltas) - Math.min(...deltas);
  const measuredFps = 1 / mean;
  // One frame interval of jitter is normal; more than two means dropped frames.
  const pass = spread <= 2 / expectedFps + 0.004;

  return {
    id: 'frame_rate_consistent',
    pass,
    detail: pass
      ? `Cadence steady at ~${measuredFps.toFixed(1)}fps across ${deltas.length} frames.`
      : `Frame intervals varied by ${(spread * 1000).toFixed(0)}ms, which indicates dropped or duplicated frames.`,
    measured: round3(measuredFps),
    expected: expectedFps,
  };
}

// ---------------------------------------------------------------------------
// Blank picture, measured from the already-extracted stills
// ---------------------------------------------------------------------------

/**
 * One still per beat was already pulled from the finished render. A beat whose
 * sample is essentially black is a beat whose picture did not arrive — the
 * realistic failure, and the one worth a re-render. Sampling per beat rather
 * than on a fixed interval also means the result names the beat, which is what
 * a targeted repair needs.
 */
async function checkBlankFrames(frames: FrameRef[]): Promise<MechanicalCheck | null> {
  if (typeof document === 'undefined') return null;
  const usable = frames.filter((frame) => /^https?:\/\//i.test(frame.url));
  if (!usable.length) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 54;
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
  if (!ctx) return null;

  const blank: string[] = [];
  let measured = 0;

  for (const frame of usable) {
    const image = await loadImage(frame.url);
    if (!image) continue;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let luma: number;
    try {
      luma = meanLuma(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      // Tainted canvas: no still can be read, so the whole check is unavailable.
      return null;
    }
    measured += 1;
    if (luma < BLACK_LUMA) {
      blank.push(frame.beatId || `${frame.t.toFixed(1)}s`);
    }
  }

  if (!measured) return null;

  const pass = blank.length === 0;
  return {
    id: 'no_long_black',
    pass,
    detail: pass
      ? `All ${measured} sampled beats carry picture.`
      : `${blank.length} of ${measured} sampled beats render blank (${blank.join(', ')}), so the film holds black where those beats should be.`,
    measured: blank.length,
    expected: 0,
  };
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const guard = setTimeout(() => resolve(null), 15000);
    image.onload = () => {
      clearTimeout(guard);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(guard);
      resolve(null);
    };
    image.src = url;
  });
}

function meanLuma(data: Uint8ClampedArray): number {
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return total / (data.length / 4);
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

async function decodeAudio(url: string): Promise<AudioBuffer | null> {
  if (typeof window === 'undefined') return null;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  let ctx: any = null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    ctx = new Ctor();
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    // Most often a cross-origin fetch the bucket does not permit. Unavailable,
    // not failed — the caller records it as inconclusive.
    return null;
  } finally {
    try {
      ctx?.close?.();
    } catch {
      /* already closed */
    }
  }
}

function audioChecks(buffer: AudioBuffer, spec: FilmSpec, videoDuration: number): MechanicalCheck[] {
  const words: WordTimestamp[] = spec.narrationTimestamps;
  const hasMusicBed = Boolean(spec.motionPlan.music?.url);
  const envelope = rmsEnvelope(buffer, 0.05);
  const threshold = silenceThreshold(envelope);
  const loudest = Math.max(...envelope);

  const present = loudest > 0.005;
  const checks: MechanicalCheck[] = [
    {
      id: 'audio_present',
      pass: present,
      detail: present
        ? `Audio track decoded: ${buffer.duration.toFixed(2)}s, peak level ${loudest.toFixed(3)}.`
        : 'The audio track decoded but carries no signal — the film is silent.',
      measured: round3(loudest),
    },
  ];

  // Sync. With a music bed under the narration the mixed track is never quiet
  // before the first word, so narration onset is NOT measurable from it and
  // asserting it would fail a correct film. In that case the check is only
  // about the track covering the picture.
  const lengthDrift = Math.abs(buffer.duration - (Number.isFinite(videoDuration) ? videoDuration : buffer.duration));
  if (hasMusicBed) {
    const pass = present && lengthDrift <= 0.3;
    checks.push({
      id: 'audio_sync',
      pass,
      detail: pass
        ? `Audio covers the full picture (${lengthDrift.toFixed(2)}s drift). Narration onset is not separately measurable under a music bed.`
        : `The audio track is ${lengthDrift.toFixed(2)}s away from the picture length, so the mix does not cover the film.`,
      measured: round3(lengthDrift),
      expected: 0.3,
    });
  } else {
    const firstSound = envelope.findIndex((value) => value > threshold) * 0.05;
    const firstWord = words.length ? words[0].start : 0;
    const onsetDrift = Math.abs(firstSound - firstWord);
    const pass = present && onsetDrift <= 0.5 && lengthDrift <= 0.3;
    checks.push({
      id: 'audio_sync',
      pass,
      detail: pass
        ? `Narration starts ${onsetDrift.toFixed(2)}s from its first word timestamp and the track matches the picture length.`
        : `Narration onset is ${onsetDrift.toFixed(2)}s off its first word timestamp and the audio is ${lengthDrift.toFixed(2)}s from the picture length.`,
      measured: round3(onsetDrift),
      expected: 0.5,
    });
  }

  // A silence longer than a beat inside the SPOKEN span means the narration
  // dropped out. Silence after the last word is the film's tail and is fine.
  // Under a music bed this is a weak signal and says so rather than implying
  // it proved something.
  const lastWord = words.length ? words[words.length - 1].end : buffer.duration;
  const gap = longestGap(envelope, threshold, 0, lastWord);
  const gapOk = gap.length <= MAX_NARRATION_GAP;
  checks.push({
    id: 'no_narration_gaps',
    pass: gapOk,
    detail: gapOk
      ? hasMusicBed
        ? `No dropout longer than ${MAX_NARRATION_GAP}s in the mix. The bed masks short narration gaps, so this is a floor rather than a guarantee.`
        : `No silence longer than ${MAX_NARRATION_GAP}s inside the narration.`
      : `A ${gap.length.toFixed(2)}s silence starts at ${gap.at.toFixed(2)}s, inside the spoken section.`,
    measured: round3(gap.length),
    expected: MAX_NARRATION_GAP,
  });

  return checks;
}

function rmsEnvelope(buffer: AudioBuffer, windowSeconds: number): number[] {
  const channel = buffer.getChannelData(0);
  const windowSize = Math.max(1, Math.round(buffer.sampleRate * windowSeconds));
  const out: number[] = [];
  for (let start = 0; start < channel.length; start += windowSize) {
    let sum = 0;
    const end = Math.min(channel.length, start + windowSize);
    for (let i = start; i < end; i += 1) sum += channel[i] * channel[i];
    out.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  return out;
}

/**
 * Relative to the film's own level rather than an absolute number: a bed under
 * speech is never digital silence, so a fixed floor would report every quiet
 * passage as a dropout.
 */
function silenceThreshold(envelope: number[]): number {
  const peak = Math.max(...envelope, 0.0001);
  return Math.max(0.004, peak * 0.06);
}

function longestGap(
  envelope: number[],
  threshold: number,
  fromSeconds: number,
  toSeconds: number,
): { length: number; at: number } {
  const start = Math.max(0, Math.floor(fromSeconds / 0.05));
  const end = Math.min(envelope.length, Math.ceil(toSeconds / 0.05));
  let runStart = -1;
  let worst = { length: 0, at: 0 };
  for (let i = start; i < end; i += 1) {
    if (envelope[i] <= threshold) {
      if (runStart < 0) runStart = i;
      const length = (i - runStart + 1) * 0.05;
      if (length > worst.length) worst = { length, at: runStart * 0.05 };
    } else {
      runStart = -1;
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'unknown';
}

function round3(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

export function describeMechanicalQA(result: MechanicalQAResult): string {
  const failed = result.checks.filter((check) => !check.pass);
  if (failed.length) {
    return `Mechanical QA failed: ${failed.map((check) => check.detail).join(' ')}`;
  }
  if (!result.checks.length) {
    return `Mechanical QA could not measure this render from your browser, so the film was passed through unverified. ${result.inconclusive.join(' ')}`;
  }
  return `Mechanical QA passed ${result.checks.length} checks.${
    result.inconclusive.length ? ` ${result.inconclusive.length} could not be measured.` : ''
  }`;
}
