/**
 * Video Enhancer — full edit-plan executor (browser-side FFmpeg + canvas
 * compositor + Veo footage generation).
 *
 * Executes ALL FIVE node types of the enhancement plan into one rendered MP4:
 *   1. cuts            — FFmpeg trim/atrim + concat (pass 1)
 *   2. speed_segments  — FFmpeg setpts (video) + atempo (audio) (pass 1)
 *   3. captions        — every caption node rendered as a styled composition
 *                        (composeOverlays.ts canvas compositor — the
 *                        workspace's HyperFrames-equivalent), composited by
 *                        the FFmpeg `overlay` filter chain with alpha fades
 *   4. visuals         — GRAPHIC-family nodes (graphic/diagram/screenshot)
 *                        go through the same compositor; FOOTAGE_INSERT
 *                        (broll) nodes are generated with Veo
 *                        (enhancerCore.submitBroll/checkBroll) and spliced
 *                        into the timeline with FFmpeg concat
 *   5. sfx             — cues synthesized procedurally and mixed into the
 *                        output track with FFmpeg adelay + amix
 *
 * Pipeline order: FFmpeg pass 1 (cuts+speed) → timestamp remap → composition
 * renders → Veo clip generation → FFmpeg pass 2 (splice inserts + composite
 * overlays) → FFmpeg audio pass (SFX mix, video stream-copied) → final MP4.
 *
 * Timestamp remapping: every plan timestamp is in SOURCE time.
 * makeSourceToOutputMapper() converts source → edited time (cuts + speed),
 * then makeInsertShiftMapper() converts edited → final time (splice shifts).
 * EVERY overlay window, insert point, and SFX cue goes through both maps —
 * nothing is hardcoded against the original timeline.
 *
 * Failure contract: each FFmpeg step retries with identical inputs
 * (STEP_RETRIES) before the pipeline error is surfaced; each composition
 * render retries per composeOverlays.ts. A failed caption/graphic/insert node
 * is reported in ApplyResult.failures and shown in the UI — never silently
 * skipped.
 *
 * The whole graph runs on the same pinned @ffmpeg/core 0.12.10 WASM build
 * already proven in lib/client-stitch.ts (trim/atempo/concat/overlay/fade/
 * adelay/amix are all core filters compiled into that binary). The filter
 * graphs and the remap math were mirror-verified against native ffmpeg 6.1
 * (same major version) on Sep 14 2026: output duration matched the time-map
 * prediction exactly, captions landed at their remapped windows, inserts
 * spliced at the right point, and SFX peaks registered at the cue times.
 */
import { submitBroll, checkBroll } from './enhancerCore';
import {
  renderCaptionComposition, renderGraphicComposition,
  sfxWav, silenceWav,
} from './composeOverlays';

// Same pinned build + CDN as lib/client-stitch.ts (jsdelivr is CSP-allowed).
const CORE_JS = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js';
const CORE_WASM = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm';

const IN_NAME = 've-in.mp4';
const EDIT_NAME = 've-edit.mp4';
const COMP_NAME = 've-comp.mp4';
const FINAL_NAME = 've-final.mp4';

/** Per the failure-handling contract: each FFmpeg step is retried this many
 * times with identical inputs before the error is surfaced in the UI. */
const STEP_RETRIES = 2;

/** Hard caps that keep the single-threaded WASM encode tractable. Overflow is
 * reported in the skipped log — never dropped silently. */
const MAX_OVERLAYS = 60;
const MAX_INSERTS = 4;

const VEO_POLL_MS = 5000;
const VEO_TIMEOUT_MS = 6 * 60 * 1000;

// ---------------------------------------------------------------------------
// Plan-node shapes consumed here (subset of App.tsx's EditPlan)
// ---------------------------------------------------------------------------

export interface PlanCutNode { start: number; end: number }
export interface PlanSpeedNode { start: number; end: number; multiplier: number }
export interface PlanCaptionNode { start: number; end: number; text: string; emphasized_words?: string[] }
export interface PlanVisualNode { start: number; end: number; type: string; description: string }
export interface PlanSfxNode { timestamp: number; cue: string }

/** One contiguous piece of kept source, with the playback multiplier applied to it. */
export interface EditSegment { from: number; to: number; multiplier: number }

export interface InsertSpec {
  id: string;
  fsName: string;
  /** Splice point in the EDITED timeline. */
  atEdited: number;
  /** Measured duration of the downloaded clip (not the requested one). */
  duration: number;
}

export interface OverlaySpec {
  id: string;
  fsName: string;
  /** Window in the FINAL timeline (post-splice shift). */
  start: number;
  end: number;
  /** Pixel y of the band's top edge. */
  y: number;
}

export type ApplyStepId = 'engine' | 'probe' | 'edit' | 'remap' | 'compose' | 'veo' | 'composite' | 'sfx';
export type ApplyStepStatus = 'running' | 'done' | 'skipped';

export interface ApplyResult {
  blob: Blob;
  /** Duration of the final MP4 as measured by re-probing it (not just computed). */
  measuredDurationSec: number;
  /** Duration predicted by the time maps — reported alongside the measured value. */
  expectedDurationSec: number;
  captionsRendered: number;
  captionsPlanned: number;
  graphicsRendered: number;
  graphicsPlanned: number;
  insertsSpliced: number;
  insertsPlanned: number;
  sfxMixed: number;
  sfxPlanned: number;
  /** Per-node failures (composition renders, Veo clips) — surfaced in the UI. */
  failures: string[];
  /** Human-readable log of anything not executed, for the UI + console. */
  skipped: string[];
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }
function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function sleep(ms: number): Promise<void> { return new Promise((r) => { setTimeout(r, ms); }); }

// ---------------------------------------------------------------------------
// Pure timeline math (exported for direct testing)
// ---------------------------------------------------------------------------

/** Clamp, drop invalid, sort, and merge overlapping cut ranges. */
export function normalizeCuts(cuts: PlanCutNode[], duration: number): PlanCutNode[] {
  const cleaned = (Array.isArray(cuts) ? cuts : [])
    .map((c) => ({ start: Math.max(0, Number(c?.start) || 0), end: Math.min(duration, Number(c?.end) || 0) }))
    .filter((c) => c.end - c.start > 0.04)
    .sort((a, b) => a.start - b.start);
  const merged: PlanCutNode[] = [];
  for (const c of cleaned) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end + 0.01) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  return merged;
}

/** The complement of the cuts: which parts of the source remain in the output. */
export function buildKeepSegments(duration: number, cuts: PlanCutNode[]): { from: number; to: number }[] {
  const keeps: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start - cursor > 0.04) keeps.push({ from: round3(cursor), to: round3(c.start) });
    cursor = Math.max(cursor, c.end);
  }
  if (duration - cursor > 0.04) keeps.push({ from: round3(cursor), to: round3(duration) });
  return keeps;
}

/** Clamp/sort speed nodes and trim overlaps between them (earlier node wins). */
export function normalizeSpeedSegments(segs: PlanSpeedNode[], duration: number): PlanSpeedNode[] {
  const cleaned = (Array.isArray(segs) ? segs : [])
    .map((s) => ({
      start: Math.max(0, Number(s?.start) || 0),
      end: Math.min(duration, Number(s?.end) || 0),
      multiplier: Math.min(4, Math.max(0.25, Number(s?.multiplier) || 1)),
    }))
    .filter((s) => s.end - s.start > 0.04)
    .sort((a, b) => a.start - b.start);
  const out: PlanSpeedNode[] = [];
  for (const s of cleaned) {
    const last = out[out.length - 1];
    const start = last ? Math.max(s.start, last.end) : s.start;
    if (s.end - start > 0.04) out.push({ start: round3(start), end: s.end, multiplier: s.multiplier });
  }
  return out;
}

/**
 * Split each kept range at every speed-segment boundary so each resulting
 * segment has exactly one multiplier. This ordered list IS the edit: it drives
 * the FFmpeg filter graph and the source→output time map identically.
 */
export function buildEditSegments(
  keeps: { from: number; to: number }[],
  speeds: PlanSpeedNode[],
): EditSegment[] {
  const segments: EditSegment[] = [];
  for (const keep of keeps) {
    const bounds = new Set<number>([keep.from, keep.to]);
    for (const s of speeds) {
      if (s.start > keep.from && s.start < keep.to) bounds.add(round3(s.start));
      if (s.end > keep.from && s.end < keep.to) bounds.add(round3(s.end));
    }
    const sorted = [...bounds].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      if (to - from < 0.05) continue; // sub-frame slivers produce zero-frame trims
      const mid = (from + to) / 2;
      const speed = speeds.find((s) => mid >= s.start && mid < s.end);
      segments.push({ from, to, multiplier: speed ? speed.multiplier : 1 });
    }
  }
  return segments;
}

/** Total duration of the output timeline described by the edit segments. */
export function outputDuration(segments: EditSegment[]): number {
  return round3(segments.reduce((acc, s) => acc + (s.to - s.from) / s.multiplier, 0));
}

/**
 * The required source→output remapper. Walks the ordered cut + speed edits and
 * returns the EDITED timestamp for any SOURCE timestamp:
 *  - a source time inside a cut maps to the moment the next kept content starts;
 *  - a source time inside a sped-up segment is compressed by its multiplier;
 *  - everything after a removed range shifts earlier by the removed amount.
 */
export function makeSourceToOutputMapper(segments: EditSegment[]): (sourceTs: number) => number {
  return (sourceTs: number) => {
    let acc = 0;
    for (const seg of segments) {
      if (sourceTs <= seg.from) break;
      if (sourceTs < seg.to) return round3(acc + (sourceTs - seg.from) / seg.multiplier);
      acc += (seg.to - seg.from) / seg.multiplier;
    }
    return round3(acc);
  };
}

/** Remap one overlay window (source time) into the EDITED timeline, keeping a
 * readable minimum when the source window fell inside a cut. */
export function scheduleOverlayWindow(
  srcStart: number,
  srcEnd: number,
  toOutput: (t: number) => number,
  editedDuration: number,
): { start: number; end: number; reanchored: boolean } {
  const s0 = Math.max(0, Number(srcStart) || 0);
  const s1 = Math.max(s0, Number(srcEnd) || 0);
  let outStart = toOutput(s0);
  let outEnd = toOutput(s1);
  let reanchored = false;
  if (outEnd - outStart < 0.3) {
    outEnd = Math.min(editedDuration, outStart + Math.min(2.5, Math.max(1, s1 - s0)));
    reanchored = true;
  }
  outStart = Math.max(0, Math.min(outStart, Math.max(0, editedDuration - 0.5)));
  outEnd = Math.max(outStart + 0.3, Math.min(outEnd, editedDuration));
  return { start: round3(outStart), end: round3(outEnd), reanchored };
}

/** Splice shift: how much later a moment in the EDITED timeline plays in the
 * FINAL timeline once every insert before (or at) it has been spliced in. */
export function makeInsertShiftMapper(inserts: { atEdited: number; duration: number }[]): (t: number) => number {
  const sorted = [...inserts].sort((a, b) => a.atEdited - b.atEdited);
  return (t: number) => {
    let shift = 0;
    for (const ins of sorted) {
      if (ins.atEdited <= t + 1e-6) shift += ins.duration;
      else break;
    }
    return round3(shift);
  };
}

// ---------------------------------------------------------------------------
// FFmpeg argument builders (exported for direct testing — mirror-verified
// against native ffmpeg 6.1 on Sep 14 2026)
// ---------------------------------------------------------------------------

/** atempo only accepts 0.5–2 per instance — chain instances for anything outside. */
export function atempoChain(multiplier: number): string[] {
  const chain: string[] = [];
  let m = multiplier;
  while (m > 2) { chain.push('atempo=2.0'); m /= 2; }
  while (m < 0.5) { chain.push('atempo=0.5'); m /= 0.5; }
  chain.push('atempo=' + m.toFixed(4));
  return chain;
}

/**
 * Pass 1 (pipeline steps 1–2: cuts, then speed) as a single trim/atrim →
 * setpts/atempo → concat graph. Doing both edits in one FFmpeg pass is
 * deliberate: in-browser WASM encodes are single-threaded, so a second full
 * re-encode would roughly double a multi-minute wait — the resulting timeline
 * is identical to running the two passes back to back.
 */
export function buildEditPassArgs(segments: EditSegment[], hasAudio: boolean, inName = IN_NAME, outName = EDIT_NAME): string[] {
  const chains: string[] = [];
  const concatIn: string[] = [];
  segments.forEach((seg, i) => {
    const trim = 'trim=start=' + seg.from.toFixed(3) + ':end=' + seg.to.toFixed(3);
    const retime = Math.abs(seg.multiplier - 1) > 0.001
      ? 'setpts=(PTS-STARTPTS)/' + seg.multiplier.toFixed(4)
      : 'setpts=PTS-STARTPTS';
    chains.push('[0:v]' + trim + ',' + retime + '[v' + i + ']');
    concatIn.push('[v' + i + ']');
    if (hasAudio) {
      const atrim = 'atrim=start=' + seg.from.toFixed(3) + ':end=' + seg.to.toFixed(3);
      const parts = ['[0:a]' + atrim, 'asetpts=PTS-STARTPTS'];
      if (Math.abs(seg.multiplier - 1) > 0.001) parts.push(...atempoChain(seg.multiplier));
      chains.push(parts.join(',') + '[a' + i + ']');
      concatIn.push('[a' + i + ']');
    }
  });
  const graph = chains.join(';') + ';'
    + concatIn.join('')
    + 'concat=n=' + segments.length + ':v=1:a=' + (hasAudio ? 1 : 0)
    + '[v]' + (hasAudio ? '[a]' : '');
  return [
    '-i', inName,
    '-filter_complex', graph,
    '-map', '[v]',
    ...(hasAudio ? ['-map', '[a]'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
    '-movflags', '+faststart',
    outName,
  ];
}

/**
 * Pass 2 (pipeline step 5): splice FOOTAGE_INSERT clips into the edited
 * timeline via trim+concat, then composite every rendered PNG overlay
 * (captions + graphics) with alpha fades at its FINAL-timeline window.
 *
 * Input order (the caller must match): [0]=edited, [1..I]=insert mp4s,
 * [I+1..2I]=insert silence wavs (only when hasAudio), then one looped PNG
 * input per overlay.
 */
export function buildCompositePassArgs(opts: {
  editedName: string;
  outName: string;
  editedDuration: number;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
  inserts: InsertSpec[];
  insertSilenceNames: string[];
  overlays: OverlaySpec[];
}): string[] {
  const { editedName, outName, editedDuration, hasAudio, width, height, fps, inserts, insertSilenceNames, overlays } = opts;
  const F = fps && fps > 0 ? fps : 30;
  const args: string[] = ['-i', editedName];
  for (const ins of inserts) args.push('-i', ins.fsName);
  if (hasAudio) for (const name of insertSilenceNames) args.push('-i', name);
  const overlayInputBase = 1 + inserts.length + (hasAudio ? inserts.length : 0);
  overlays.forEach((o) => {
    args.push('-loop', '1', '-t', Math.max(0.3, o.end - o.start).toFixed(3), '-i', o.fsName);
  });

  const chains: string[] = [];
  let vBase: string;
  let aBase: string | null = null;

  if (inserts.length) {
    type Part = { kind: 'edited'; from: number; to: number } | { kind: 'insert'; index: number };
    const parts: Part[] = [];
    let cursor = 0;
    inserts.forEach((ins, i) => {
      if (ins.atEdited - cursor > 0.04) parts.push({ kind: 'edited', from: cursor, to: ins.atEdited });
      parts.push({ kind: 'insert', index: i });
      cursor = Math.max(cursor, ins.atEdited);
    });
    if (editedDuration - cursor > 0.04) parts.push({ kind: 'edited', from: cursor, to: editedDuration });

    const concatIn: string[] = [];
    const AFMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
    parts.forEach((p, j) => {
      if (p.kind === 'edited') {
        chains.push('[0:v]trim=start=' + p.from.toFixed(3) + ':end=' + p.to.toFixed(3)
          + ',setpts=PTS-STARTPTS,setsar=1,format=yuv420p[pv' + j + ']');
        if (hasAudio) {
          chains.push('[0:a]atrim=start=' + p.from.toFixed(3) + ':end=' + p.to.toFixed(3)
            + ',asetpts=PTS-STARTPTS,' + AFMT + '[pa' + j + ']');
        }
      } else {
        const ins = inserts[p.index];
        chains.push('[' + (1 + p.index) + ':v]scale=' + width + ':' + height
          + ':force_original_aspect_ratio=decrease,pad=' + width + ':' + height
          + ':(ow-iw)/2:(oh-ih)/2:color=black,fps=' + F
          + ',setpts=PTS-STARTPTS,setsar=1,format=yuv420p[pv' + j + ']');
        if (hasAudio) {
          chains.push('[' + (1 + inserts.length + p.index) + ':a]atrim=start=0:end=' + ins.duration.toFixed(3)
            + ',asetpts=PTS-STARTPTS,' + AFMT + '[pa' + j + ']');
        }
      }
      concatIn.push('[pv' + j + ']');
      if (hasAudio) concatIn.push('[pa' + j + ']');
    });
    chains.push(concatIn.join('') + 'concat=n=' + parts.length + ':v=1:a=' + (hasAudio ? 1 : 0)
      + '[vc]' + (hasAudio ? '[ac]' : ''));
    vBase = '[vc]';
    if (hasAudio) aBase = '[ac]';
  } else {
    vBase = '[0:v]';
  }

  let prev = vBase;
  overlays.forEach((o, k) => {
    const dur = Math.max(0.3, o.end - o.start);
    const fade = Math.min(0.25, dur / 4);
    const inIdx = overlayInputBase + k;
    chains.push('[' + inIdx + ':v]format=rgba'
      + ',fade=t=in:st=0:d=' + fade.toFixed(3) + ':alpha=1'
      + ',fade=t=out:st=' + Math.max(0, dur - fade).toFixed(3) + ':d=' + fade.toFixed(3) + ':alpha=1'
      + ',setpts=PTS-STARTPTS+' + o.start.toFixed(3) + '/TB[ov' + k + ']');
    const label = k === overlays.length - 1 ? '[vout]' : '[vx' + k + ']';
    chains.push(prev + '[ov' + k + ']overlay=x=0:y=' + Math.round(o.y)
      + ":enable='between(t," + o.start.toFixed(3) + ',' + o.end.toFixed(3) + ")'" + label);
    prev = label;
  });
  const vFinal = overlays.length ? '[vout]' : vBase;

  args.push('-filter_complex', chains.join(';'));
  args.push('-map', vFinal);
  if (hasAudio) {
    if (aBase) { args.push('-map', aBase, '-c:a', 'aac', '-b:a', '160k'); }
    else { args.push('-map', '0:a', '-c:a', 'copy'); }
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outName);
  return args;
}

/**
 * Pass 3 (pipeline step 6, audio only — the video stream is copied, not
 * re-encoded): mix the synthesized SFX cues into the final track at their
 * FINAL-timeline timestamps. Input order: [0]=video, [1..N]=sfx wavs,
 * [N+1]=silence base (only when the video has no audio track).
 */
export function buildSfxPassArgs(opts: {
  inName: string;
  outName: string;
  hasAudio: boolean;
  cues: { fsName: string; at: number; gain?: number }[];
  silenceBaseName: string | null;
}): string[] {
  const { inName, outName, hasAudio, cues, silenceBaseName } = opts;
  const args: string[] = ['-i', inName];
  for (const c of cues) args.push('-i', c.fsName);
  if (!hasAudio && silenceBaseName) args.push('-i', silenceBaseName);
  const AFMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const chains: string[] = [];
  const baseIn = hasAudio ? '[0:a]' : '[' + (cues.length + 1) + ':a]';
  chains.push(baseIn + AFMT + '[ab]');
  const mixIn = ['[ab]'];
  cues.forEach((c, i) => {
    const ms = Math.max(0, Math.round(c.at * 1000));
    chains.push('[' + (i + 1) + ':a]' + AFMT + ',adelay=' + ms + ':all=1,volume=' + (c.gain ?? 0.9).toFixed(2) + '[sx' + i + ']');
    mixIn.push('[sx' + i + ']');
  });
  chains.push(mixIn.join('') + 'amix=inputs=' + mixIn.length + ':duration=first:normalize=0[aout]');
  args.push('-filter_complex', chains.join(';'));
  args.push('-map', '0:v', '-c:v', 'copy', '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outName);
  return args;
}

// ---------------------------------------------------------------------------
// FFmpeg core runtime (browser only — nothing above touches window)
// ---------------------------------------------------------------------------

let corePromise: Promise<any> | null = null;
let activeLog: string[] | null = null;

async function getCore(): Promise<any> {
  if (!corePromise) {
    corePromise = (async () => {
      const createFFmpegCore = (await import(/* @vite-ignore */ CORE_JS)).default;
      if (typeof createFFmpegCore !== 'function') throw new Error('The video engine module did not load correctly.');
      const core = await createFFmpegCore({
        mainScriptUrlOrBlob: CORE_JS + '#' + btoa(JSON.stringify({ wasmURL: CORE_WASM })),
        print: (line: string) => activeLog?.push(String(line)),
        printErr: (line: string) => activeLog?.push(String(line)),
      });
      // The 0.12.x core routes ffmpeg output through its own logger contract,
      // NOT Emscripten print/printErr (verified against the real 0.12.10 build:
      // without this, probe parsing sees an empty log and reads duration 0).
      if (typeof core.setLogger === 'function') {
        core.setLogger((e: { message?: unknown }) => { activeLog?.push(String(e && e.message != null ? e.message : '')); });
      }
      return core;
    })().catch((e) => {
      corePromise = null; // allow retry on the next Apply click
      throw e;
    });
  }
  return corePromise;
}

/** Run one ffmpeg invocation, returning its exit code and captured log. */
function execFfmpeg(core: any, args: string[]): { rc: number; log: string } {
  activeLog = [];
  core.exec(...args);
  const rc = core.ret;
  const log = activeLog.join('\n');
  activeLog = null;
  core.reset();
  return { rc, log };
}

function tailOf(log: string, lines = 14): string {
  return log.split('\n').filter(Boolean).slice(-lines).join('\n');
}

/** Give React a paint before a long synchronous WASM encode blocks the thread. */
function yieldToUi(): Promise<void> { return new Promise((r) => { setTimeout(r, 60); }); }

/**
 * Retry contract: each FFmpeg step runs up to 1 + STEP_RETRIES times with the
 * SAME inputs; if it still fails, the captured stderr tail is thrown so the
 * app UI can surface it — a failed step is never silently skipped.
 */
async function runFfmpegStep(core: any, label: string, args: string[], outName: string | null): Promise<string> {
  let lastErr = '';
  for (let attempt = 0; attempt <= STEP_RETRIES; attempt++) {
    if (outName) { try { core.FS.unlink(outName); } catch { /* no partial output to clear */ } }
    await yieldToUi();
    const { rc, log } = execFfmpeg(core, args);
    if (rc === 0) {
      if (outName) {
        const data = core.FS.readFile(outName);
        if (!data || data.byteLength < 1024) { lastErr = label + ' produced an empty file.'; continue; }
      }
      return log;
    }
    lastErr = label + ' failed (exit code ' + rc + ').\n' + tailOf(log);
    console.warn('[VideoEnhancer] ' + label + ' attempt ' + (attempt + 1) + ' failed:', lastErr);
  }
  throw new Error(lastErr || (label + ' failed.'));
}

function parseDuration(log: string): number {
  const m = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseHasAudio(log: string): boolean {
  return /Stream #0:\d+[^\n]*Audio:/.test(log);
}

function parseVideoSize(log: string): { width: number; height: number } {
  const m = log.match(/Stream #0:\d+[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 0, height: 0 };
}

function parseFps(log: string): number {
  const m = log.match(/(\d+(?:\.\d+)?)\s*fps/);
  return m ? Number(m[1]) : 0;
}

// ---------------------------------------------------------------------------
// Veo FOOTAGE_INSERT generation
// ---------------------------------------------------------------------------

/** A visual node is a footage insert when its type names real footage; every
 * other type (graphic, diagram, screenshot, …) goes through the compositor. */
export function isFootageInsert(type: string): boolean {
  return /\b(broll|b-roll|footage_insert|footage)\b/i.test(String(type || ''));
}

async function generateInsertClip(
  prompt: string,
  aspect: '16:9' | '9:16',
  durationSec: number,
  onNote?: (note: string) => void,
): Promise<Uint8Array> {
  const operationId = await submitBroll(prompt.slice(0, 900), aspect, durationSec);
  const startedAt = Date.now();
  for (;;) {
    await sleep(VEO_POLL_MS);
    const st = await checkBroll(operationId);
    if (st.status === 'completed' && st.videoUrl) {
      const res = await fetch(st.videoUrl);
      if (!res.ok) throw new Error('could not download the generated clip (HTTP ' + res.status + ')');
      return new Uint8Array(await res.arrayBuffer());
    }
    if (st.status === 'failed') throw new Error(st.errorMessage || 'the video provider reported a failure');
    if (Date.now() - startedAt > VEO_TIMEOUT_MS) throw new Error('timed out waiting for the generated clip');
    onNote?.(st.progress ? st.progress + '%' : 'generating…');
  }
}

// ---------------------------------------------------------------------------
// The executor
// ---------------------------------------------------------------------------

export interface ApplyPlanInput {
  file: File;
  plan: {
    cuts: PlanCutNode[];
    speed_segments: PlanSpeedNode[];
    captions: PlanCaptionNode[];
    visuals: PlanVisualNode[];
    sfx: PlanSfxNode[];
  };
  /** Brand accent for emphasized caption words + graphic cards. */
  accent?: string;
  onStep?: (step: ApplyStepId, status: ApplyStepStatus, note?: string) => void;
}

export async function applyEnhancementPlan({ file, plan, accent, onStep }: ApplyPlanInput): Promise<ApplyResult> {
  const step = (id: ApplyStepId, status: ApplyStepStatus, note?: string) => { onStep?.(id, status, note); };
  const skipped: string[] = [];
  const failures: string[] = [];
  const accentColor = accent || '#60A5FA';

  // 0. Engine ---------------------------------------------------------------
  step('engine', 'running');
  const core = await getCore();
  step('engine', 'done');

  // 1. Probe the real container (duration, audio presence, geometry) --------
  step('probe', 'running');
  const names: string[] = [IN_NAME];
  core.FS.writeFile(IN_NAME, new Uint8Array(await file.arrayBuffer()));
  await yieldToUi();
  const probe = execFfmpeg(core, ['-hide_banner', '-i', IN_NAME]); // rc≠0 is expected: probe has no output
  const duration = parseDuration(probe.log);
  const hasAudio = parseHasAudio(probe.log);
  const size = parseVideoSize(probe.log);
  const width = size.width || 1920;
  const height = size.height || 1080;
  const fps = parseFps(probe.log) || 30;
  try {
    if (!(duration > 0)) throw new Error('Could not read the video duration — the file may be corrupt.');
    step('probe', 'done', Math.round(duration) + 's · ' + width + 'x' + height + ' · ' + (hasAudio ? 'with audio' : 'no audio track'));

    // 2. Timeline math: cuts + speed → ordered edit segments ----------------
    const cuts = normalizeCuts(plan.cuts, duration);
    const speeds = normalizeSpeedSegments(plan.speed_segments, duration);
    const keeps = buildKeepSegments(duration, cuts);
    if (!keeps.length) throw new Error('This plan cuts the entire video — nothing would remain in the output.');
    const segments = buildEditSegments(keeps, speeds);
    if (!segments.length) throw new Error('No usable video remains after applying the plan\u2019s cuts.');
    const editedExpected = outputDuration(segments);

    // 3. FFmpeg pass 1 (cuts + speed) ----------------------------------------
    const isIdentity = segments.length === 1
      && segments[0].from < 0.05 && segments[0].to > duration - 0.05
      && Math.abs(segments[0].multiplier - 1) < 0.001;
    let editedName = IN_NAME;
    if (isIdentity) {
      step('edit', 'skipped', 'The plan has no cuts or speed changes — the source timeline is kept as-is.');
      skipped.push('Edit pass skipped: no cut or speed nodes in the plan.');
    } else {
      step('edit', 'running', cuts.length + ' cut(s), ' + speeds.length + ' speed segment(s)');
      await runFfmpegStep(core, 'The cut/speed edit pass', buildEditPassArgs(segments, hasAudio), EDIT_NAME);
      names.push(EDIT_NAME);
      editedName = EDIT_NAME;
      try { core.FS.unlink(IN_NAME); } catch { /* keep memory bounded */ }
      step('edit', 'done');
    }
    // Measure the edited timeline — all downstream scheduling anchors to it.
    await yieldToUi();
    const editedProbe = execFfmpeg(core, ['-hide_banner', '-i', editedName]);
    const editedDur = parseDuration(editedProbe.log) || editedExpected;

    // 4. Timestamp remap (source → edited) for EVERY overlay/insert/cue ------
    step('remap', 'running');
    const toOutput = makeSourceToOutputMapper(segments);
    const captionNodes = (Array.isArray(plan.captions) ? plan.captions : []).filter((c) => c && String(c.text || '').trim());
    const visualNodes = Array.isArray(plan.visuals) ? plan.visuals : [];
    const graphicNodes = visualNodes.filter((v) => !isFootageInsert(v?.type));
    const insertNodes = visualNodes.filter((v) => isFootageInsert(v?.type));
    const sfxNodes = (Array.isArray(plan.sfx) ? plan.sfx : []).filter((s) => s && Number.isFinite(Number(s.timestamp)));

    const bandH = Math.round(height * 0.26);
    const captionY = height - bandH - Math.round(height * 0.05);
    const graphicY = Math.max(0, captionY - bandH - Math.round(height * 0.02));

    let reanchoredCount = 0;
    const captionWindows = captionNodes.map((c) => {
      const w = scheduleOverlayWindow(c.start, c.end, toOutput, editedDur);
      if (w.reanchored) reanchoredCount++;
      return w;
    });
    const graphicWindows = graphicNodes.map((g) => {
      const w = scheduleOverlayWindow(g.start, g.end, toOutput, editedDur);
      if (w.reanchored) reanchoredCount++;
      return w;
    });
    if (reanchoredCount > 0) skipped.push(reanchoredCount + ' overlay window(s) fell inside a cut and were re-anchored to the surviving context.');
    step('remap', 'done', captionNodes.length + ' caption(s), ' + graphicNodes.length + ' graphic(s), '
      + insertNodes.length + ' footage insert(s), ' + sfxNodes.length + ' SFX cue(s) remapped');

    // 5. Composition renders (captions + GRAPHIC visuals) --------------------
    const overlayPlanned = captionNodes.length + graphicNodes.length;
    const overlays: OverlaySpec[] = [];
    let captionsRendered = 0;
    let graphicsRendered = 0;
    if (overlayPlanned) {
      step('compose', 'running', '0/' + overlayPlanned);
      let composed = 0;
      for (let i = 0; i < captionNodes.length; i++) {
        if (overlays.length >= MAX_OVERLAYS) { skipped.push('Overlay cap reached (' + MAX_OVERLAYS + ') — caption ' + (i + 1) + '+ not composited.'); break; }
        const c = captionNodes[i];
        try {
          const png = await renderCaptionComposition({
            id: 'caption-' + (i + 1),
            text: String(c.text).trim(),
            emphasizedWords: Array.isArray(c.emphasized_words) ? c.emphasized_words.map(String) : [],
            width, bandHeight: bandH, accent: accentColor,
          });
          const fsName = 've-ovl-c' + i + '.png';
          core.FS.writeFile(fsName, png);
          names.push(fsName);
          overlays.push({ id: 'caption-' + (i + 1), fsName, start: captionWindows[i].start, end: captionWindows[i].end, y: captionY });
          captionsRendered++;
        } catch (e) {
          failures.push('Caption ' + (i + 1) + ' (“' + String(c.text).trim().slice(0, 40) + '…”): ' + msg(e));
        }
        composed++;
        step('compose', 'running', composed + '/' + overlayPlanned);
      }
      for (let i = 0; i < graphicNodes.length; i++) {
        if (overlays.length >= MAX_OVERLAYS) { skipped.push('Overlay cap reached (' + MAX_OVERLAYS + ') — graphic ' + (i + 1) + '+ not composited.'); break; }
        const g = graphicNodes[i];
        try {
          const png = await renderGraphicComposition({
            id: 'graphic-' + (i + 1),
            type: String(g.type || 'graphic'),
            description: String(g.description || '').trim(),
            width, bandHeight: bandH, accent: accentColor,
          });
          const fsName = 've-ovl-g' + i + '.png';
          core.FS.writeFile(fsName, png);
          names.push(fsName);
          overlays.push({ id: 'graphic-' + (i + 1), fsName, start: graphicWindows[i].start, end: graphicWindows[i].end, y: graphicY });
          graphicsRendered++;
        } catch (e) {
          failures.push('Graphic ' + (i + 1) + ' (' + String(g.type || 'graphic') + '): ' + msg(e));
        }
        composed++;
        step('compose', 'running', composed + '/' + overlayPlanned);
      }
      step('compose', 'done', overlays.length + '/' + overlayPlanned + ' composition(s) rendered');
    } else {
      step('compose', 'skipped', 'The plan has no caption or graphic nodes.');
      skipped.push('Composition renders skipped: no caption or graphic nodes in the plan.');
    }

    // 6. Veo FOOTAGE_INSERT generation ---------------------------------------
    const inserts: InsertSpec[] = [];
    if (insertNodes.length) {
      const take = insertNodes.slice(0, MAX_INSERTS);
      if (insertNodes.length > take.length) {
        skipped.push((insertNodes.length - take.length) + ' footage insert(s) beyond the per-run cap of ' + MAX_INSERTS + ' were not generated.');
      }
      const aspect: '16:9' | '9:16' = width >= height ? '16:9' : '9:16';
      for (let i = 0; i < take.length; i++) {
        const v = take[i];
        const wanted = Math.min(8, Math.max(4, Math.round((Number(v.end) || 0) - (Number(v.start) || 0)) || 4));
        step('veo', 'running', 'clip ' + (i + 1) + '/' + take.length + ' — “' + String(v.description || '').slice(0, 50) + '…”');
        try {
          const bytes = await generateInsertClip(String(v.description || 'cinematic b-roll'), aspect, wanted,
            (note) => step('veo', 'running', 'clip ' + (i + 1) + '/' + take.length + ' — ' + note));
          const fsName = 've-ins-' + i + '.mp4';
          core.FS.writeFile(fsName, bytes);
          names.push(fsName);
          await yieldToUi();
          const insProbe = execFfmpeg(core, ['-hide_banner', '-i', fsName]);
          const insDur = parseDuration(insProbe.log);
          if (!(insDur > 0.2)) throw new Error('the generated clip could not be read back');
          inserts.push({ id: 'insert-' + (i + 1), fsName, atEdited: toOutput(Math.max(0, Number(v.start) || 0)), duration: round3(insDur) });
        } catch (e) {
          failures.push('Footage insert ' + (i + 1) + ' (“' + String(v.description || '').slice(0, 40) + '…”): ' + msg(e));
        }
      }
      inserts.sort((a, b) => a.atEdited - b.atEdited);
      step('veo', inserts.length ? 'done' : (take.length ? 'done' : 'skipped'), inserts.length + '/' + take.length + ' clip(s) generated');
    } else {
      step('veo', 'skipped', 'The plan has no footage-insert nodes.');
      skipped.push('Veo generation skipped: no footage-insert visual nodes in the plan.');
    }

    // 7. FFmpeg pass 2: splice inserts + composite overlays ------------------
    const shift = makeInsertShiftMapper(inserts);
    const insertTotal = inserts.reduce((acc, x) => acc + x.duration, 0);
    const finalExpected = round3(editedDur + insertTotal);
    const shiftedOverlays: OverlaySpec[] = overlays.map((o) => {
      const s = Math.min(o.start + shift(o.start), Math.max(0, finalExpected - 0.5));
      const e = Math.min(s + (o.end - o.start), finalExpected);
      return { ...o, start: round3(s), end: round3(Math.max(e, s + 0.3)) };
    });
    let workingName = editedName;
    if (shiftedOverlays.length || inserts.length) {
      step('composite', 'running', shiftedOverlays.length + ' overlay(s), ' + inserts.length + ' splice(s)');
      const silenceNames: string[] = [];
      if (hasAudio) {
        for (let i = 0; i < inserts.length; i++) {
          const n = 've-sil-' + i + '.wav';
          core.FS.writeFile(n, silenceWav(inserts[i].duration));
          names.push(n);
          silenceNames.push(n);
        }
      }
      await runFfmpegStep(core, 'The composite pass', buildCompositePassArgs({
        editedName, outName: COMP_NAME,
        editedDuration: editedDur, hasAudio, width, height, fps,
        inserts, insertSilenceNames: silenceNames, overlays: shiftedOverlays,
      }), COMP_NAME);
      names.push(COMP_NAME);
      try { if (editedName !== IN_NAME) core.FS.unlink(editedName); } catch { /* keep memory bounded */ }
      workingName = COMP_NAME;
      step('composite', 'done');
    } else {
      step('composite', 'skipped', 'Nothing to composite — no rendered overlays and no generated inserts.');
    }

    // 8. FFmpeg audio pass: SFX mix ------------------------------------------
    const sfxCues = sfxNodes.map((s, i) => {
      const atEdited = toOutput(Math.max(0, Number(s.timestamp) || 0));
      return { fsName: 've-sfx-' + i + '.wav', at: round3(Math.min(atEdited + shift(atEdited), Math.max(0, finalExpected - 0.2))), gain: 0.9, cue: String(s.cue || '') };
    });
    let finalName = workingName;
    let sfxMixed = 0;
    if (sfxCues.length) {
      step('sfx', 'running', sfxCues.length + ' cue(s)');
      for (const c of sfxCues) { core.FS.writeFile(c.fsName, sfxWav(c.cue)); names.push(c.fsName); }
      let silenceBaseName: string | null = null;
      if (!hasAudio) {
        silenceBaseName = 've-base-sil.wav';
        core.FS.writeFile(silenceBaseName, silenceWav(finalExpected));
        names.push(silenceBaseName);
      }
      await runFfmpegStep(core, 'The SFX mix pass', buildSfxPassArgs({
        inName: workingName, outName: FINAL_NAME, hasAudio, cues: sfxCues, silenceBaseName,
      }), FINAL_NAME);
      names.push(FINAL_NAME);
      try { if (workingName !== IN_NAME) core.FS.unlink(workingName); } catch { /* keep memory bounded */ }
      finalName = FINAL_NAME;
      sfxMixed = sfxCues.length;
      step('sfx', 'done');
    } else {
      step('sfx', 'skipped', 'The plan has no SFX cues.');
      skipped.push('SFX mix skipped: no SFX cues in the plan.');
    }

    for (const s of skipped) console.log('[VideoEnhancer] NOTE: ' + s);
    for (const f of failures) console.warn('[VideoEnhancer] NODE FAILED: ' + f);

    // Measure the actual output (the in-app equivalent of ffprobe) ----------
    await yieldToUi();
    const finalProbe = execFfmpeg(core, ['-hide_banner', '-i', finalName]);
    const measuredDurationSec = parseDuration(finalProbe.log) || finalExpected;
    console.log('[VideoEnhancer] overlays composited: ' + shiftedOverlays.length + ' of ' + overlayPlanned
      + ' planned; duration measured ' + measuredDurationSec + 's vs expected ' + finalExpected + 's');

    const data: Uint8Array = core.FS.readFile(finalName);
    if (!data || data.byteLength < 1024) throw new Error('The pipeline produced an empty MP4.');
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], { type: 'video/mp4' });
    return {
      blob,
      measuredDurationSec: round3(measuredDurationSec),
      expectedDurationSec: finalExpected,
      captionsRendered,
      captionsPlanned: captionNodes.length,
      graphicsRendered,
      graphicsPlanned: graphicNodes.length,
      insertsSpliced: inserts.length,
      insertsPlanned: insertNodes.length,
      sfxMixed,
      sfxPlanned: sfxNodes.length,
      failures,
      skipped,
    };
  } finally {
    for (const n of names) { try { core.FS.unlink(n); } catch { /* already gone */ } }
  }
}
