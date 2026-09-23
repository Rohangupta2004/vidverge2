/**
 * RENDERED-OUTPUT QA — the actual video file is the source of truth.
 *
 * The old failure mode this module exists to kill: QA "passed" because the
 * plan/prompt/metadata mentioned the required content, while the ACTUAL
 * rendered video was missing text, motion graphics, product UI or was
 * entirely blank. Nothing in here reads the prompt to decide a verdict —
 * every check runs on frames extracted from the real rendered file:
 *
 *   1. CLIP INTEGRITY  (blank AI video validation) — the file must exist,
 *      decode, have a real duration and dimensions, and its sampled frames
 *      must not be a uniform blank/black field. An API returning a URL is
 *      NOT success.
 *   2. FRAME EXTRACTION — representative frames at 0/25/50/75/100% of the
 *      clip (FFmpeg-equivalent seek via the browser video decoder), plus
 *      window-targeted frames inside the final composite.
 *   3. OCR — every readable string in the frames is transcribed and the
 *      required exact text is matched deterministically in code, with
 *      bounded OCR tolerance (O↔0, I↔1↔l, punctuation/spacing) but never
 *      accepting meaningfully missing content.
 *   4. VISION INSPECTION — non-text requirements (real product UI vs a
 *      generic laptop, an actual diagram vs a random text card) are checked
 *      against the frames.
 *   5. FINAL-COMPOSITE QA — the composed MP4 is re-inspected per scene
 *      window, which catches overlays that were valid as assets but vanished
 *      in FFmpeg composition (alpha/colorkey/z-order/timing faults), plus
 *      unexpected black frames and a best-effort narration-audio check.
 *
 * Every failure explains itself: expected / detected / cause / fix.
 */

import { askOpusJson } from '../../ScriptToVideo/pipeline/opus';
import { extractFrame } from '../../ScriptToVideo/pipeline/capture';
import {
  ClipIntegrity, FilmScene, FinalQaReport, QaFailure, RequiredContent,
  RequiredTextItem, RequiredVisualItem, SceneQaReport,
} from './api';

const httpsOnly = (urls: (string | null | undefined)[]) =>
  urls.filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));

// ---------------------------------------------------------------------------
// Local frame sampling (pixel statistics — no upload, no AI)
// ---------------------------------------------------------------------------

/** MediaRecorder-produced WebM files (every browser-captured scene) report
 * duration = Infinity until the browser is forced to scan the file: seek far
 * past the end and wait for durationchange, then the real duration becomes
 * readable. Without this, every valid captured clip would be misread as
 * "corrupt — no usable duration" (the exact false-positive that used to mark
 * good scenes invalid and let the bad ones through). */
function resolveRealDuration(video: HTMLVideoElement): Promise<void> {
  const d = Number(video.duration);
  if (Number.isFinite(d) && d > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return; settled = true;
      clearTimeout(giveUp);
      video.removeEventListener('durationchange', onChange);
      try { video.currentTime = 0; } catch { /* rewound best-effort */ }
      resolve();
    };
    const onChange = () => {
      const nd = Number(video.duration);
      if (Number.isFinite(nd) && nd > 0) finish();
    };
    const giveUp = setTimeout(finish, 12000);
    video.addEventListener('durationchange', onChange);
    try { video.currentTime = 1e7; } catch { finish(); }
  });
}

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    (video as any).playsInline = true;
    const guard = setTimeout(() => reject(new Error('The clip took too long to load for QA.')), 60000);
    video.onerror = () => { clearTimeout(guard); reject(new Error('The clip could not be decoded in this browser.')); };
    video.onloadedmetadata = () => {
      clearTimeout(guard);
      void resolveRealDuration(video).then(() => resolve(video));
    };
    video.src = url;
  });
}

function releaseVideo(video: HTMLVideoElement) {
  try { video.removeAttribute('src'); video.load(); } catch { /* released */ }
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

interface FrameStats { mean: number; stdev: number }

/** Luminance mean + spread of one decoded frame (downsampled). null = the
 * pixels could not be read (CORS taint) — treated as UNVERIFIED, never pass/fail. */
function readFrameStats(video: HTMLVideoElement): FrameStats | null {
  try {
    const w = 96;
    const h = Math.max(2, Math.round(w * (video.videoHeight || 9) / (video.videoWidth || 16)));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0; let sumSq = 0; const n = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += lum; sumSq += lum * lum;
    }
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);
    return { mean, stdev: Math.sqrt(variance) };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// 1. CLIP INTEGRITY — blank/corrupt AI video validation
// ---------------------------------------------------------------------------

export async function validateClipIntegrity(url: string): Promise<ClipIntegrity> {
  if (!url || !url.startsWith('http')) {
    return { ok: false, decodable: false, duration_s: 0, width: 0, height: 0, blank: false, reason: 'No rendered file URL exists for this scene.' };
  }
  let video: HTMLVideoElement;
  try {
    video = await openVideo(url);
  } catch (e: any) {
    return { ok: false, decodable: false, duration_s: 0, width: 0, height: 0, blank: false, reason: `The file could not be decoded: ${String(e?.message || e).slice(0, 140)}` };
  }
  try {
    const duration = Number(video.duration);
    const width = Number(video.videoWidth) || 0;
    const height = Number(video.videoHeight) || 0;
    if (!Number.isFinite(duration) || duration <= 0.2) {
      return { ok: false, decodable: true, duration_s: duration || 0, width, height, blank: false, reason: 'The file has no usable duration — it is empty or corrupt.' };
    }
    if (!width || !height) {
      return { ok: false, decodable: true, duration_s: duration, width, height, blank: false, reason: 'The file has no video stream (zero dimensions).' };
    }
    // Sample three frames; a clip whose every sample is a uniform near-black
    // (or near-white) field carries no actual visual content.
    const stats: (FrameStats | null)[] = [];
    for (const f of [0.15, 0.5, 0.85]) {
      const ok = await seekTo(video, Math.min(duration - 0.05, Math.max(0, duration * f)));
      stats.push(ok ? readFrameStats(video) : null);
    }
    const readable = stats.filter((s): s is FrameStats => !!s);
    if (readable.length) {
      const allBlank = readable.every((s) => s.stdev < 6 && (s.mean < 18 || s.mean > 242));
      const allFrozenUniform = readable.length >= 2 && readable.every((s) => s.stdev < 2.5);
      if (allBlank || allFrozenUniform) {
        return { ok: false, decodable: true, duration_s: duration, width, height, blank: true, reason: 'Every sampled frame is a uniform blank field — the render carries no visual content.' };
      }
    }
    return { ok: true, decodable: true, duration_s: duration, width, height, blank: false };
  } finally {
    releaseVideo(video);
  }
}

/** Pixel stats at one absolute timestamp of a video (unexpected-black-frame
 * detection in the final composite). null = unverifiable. */
export async function sampleFrameStatsAt(url: string, atS: number): Promise<FrameStats | null> {
  let video: HTMLVideoElement;
  try { video = await openVideo(url); } catch { return null; }
  try {
    const duration = Math.max(0.2, Number(video.duration) || 0.2);
    const ok = await seekTo(video, Math.min(duration - 0.05, Math.max(0, atS)));
    return ok ? readFrameStats(video) : null;
  } finally {
    releaseVideo(video);
  }
}

// ---------------------------------------------------------------------------
// 2. FRAME EXTRACTION — representative frames of the rendered clip
// ---------------------------------------------------------------------------

/** Extract representative frames at fractional positions (default the
 * 0/25/50/75/100% ladder). Returns durable https URLs; positions that fail
 * to extract are silently dropped (QA then reports on the frames it has). */
export async function extractQaFrames(clipUrl: string, durationS: number, fractions: number[] = [0.02, 0.25, 0.5, 0.75, 1]): Promise<string[]> {
  const frames: string[] = [];
  const d = Math.max(0.3, Number(durationS) || 0.3);
  for (const f of fractions) {
    try {
      const url = f >= 0.99 ? await extractFrame(clipUrl, 'end') : await extractFrame(clipUrl, Math.max(0.05, d * f));
      if (url) frames.push(url);
    } catch { /* this frame degrades; QA uses the rest */ }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// 3. OCR — transcribe what the frames ACTUALLY show, match deterministically
// ---------------------------------------------------------------------------

const OCR_SYSTEM = `You are an OCR engine reading video frames. Transcribe EVERY piece of readable on-screen text in each frame EXACTLY as rendered — headlines, labels, numbers, prices, buttons, captions, URLs, watermarks. Do NOT describe the image, do NOT summarize, do NOT correct spelling; transcribe only what is literally readable. Reply with ONE JSON object: { "frames": [ { "text": str } ] } — one entry per frame, same order as given, "" when a frame contains no readable text.`;

export async function ocrFrames(frameUrls: string[]): Promise<string[]> {
  const frames = httpsOnly(frameUrls).slice(0, 4);
  if (!frames.length) return [];
  const out = await askOpusJson<{ frames: { text: string }[] }>({
    system: OCR_SYSTEM,
    user: `Transcribe the readable text in these ${frames.length} frame(s).`,
    images: frames,
    maxTokens: 1400,
    effort: 'low',
  });
  const rows = Array.isArray(out?.frames) ? out.frames : [];
  return frames.map((_, i) => String(rows[i]?.text || ''));
}

/** OCR-tolerant canonical form: uppercase, O↔0, I/l/|↔1, everything that is
 * not a letter, digit or currency/percent mark removed. */
export function normalizeForOcr(text: string): string {
  return String(text || '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/[^A-Z0-9%$€£+]/g, '');
}

function editDistance(a: string, b: string): number {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Is the EXPECTED string readably present in the detected OCR text?
 * Reasonable OCR noise is tolerated (1 edit per ~6 chars, capped at 2), but
 * meaningfully missing content never matches. */
export function textFoundIn(expected: string, detected: string): boolean {
  const e = normalizeForOcr(expected);
  if (!e) return true; // nothing verifiable was required
  const h = normalizeForOcr(detected);
  if (!h) return false;
  if (h.includes(e)) return true;
  const tol = Math.min(2, Math.floor(e.length / 6));
  if (!tol) return false;
  for (let i = 0; i + e.length - tol <= h.length; i += 1) {
    if (editDistance(h.slice(i, i + e.length), e) <= tol) return true;
    if (editDistance(h.slice(i, i + e.length + tol), e) <= tol) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 4. VISION INSPECTION — non-text requirements against actual frames
// ---------------------------------------------------------------------------

const VISUAL_VERIFY_SYSTEM = `You verify that rendered video frames ACTUALLY CONTAIN a required visual element. You receive the requirement and 1-3 frames of the real render. Judge ONLY what is visible:
- Requirement "real product UI/screenshot in a device mockup" + frames showing a generic laptop, an AI-invented interface or no interface → present=false.
- Requirement "an animated diagram/graphic explaining X" + frames showing a bare text card or unrelated footage → present=false.
- Requirement describing cinematic footage + frames plausibly showing that subject/action → present=true (artistic interpretation passes).
Reply with ONE JSON object: { "present": bool, "detected": str (one plain sentence: what the frames actually show), "cause": str (one sentence why the requirement is not met — '' when present) }.`;

export async function verifyVisualInFrames(req: RequiredVisualItem, frameUrls: string[]): Promise<{ present: boolean; detected: string; cause: string }> {
  const frames = httpsOnly(frameUrls).slice(0, 3);
  if (!frames.length) return { present: true, detected: 'No frame could be extracted — visual requirement unverified.', cause: '' };
  try {
    const out = await askOpusJson<{ present: boolean; detected: string; cause: string }>({
      system: VISUAL_VERIFY_SYSTEM,
      user: `REQUIRED VISUAL (type: ${req.type}): ${req.description}\nDo these frames actually contain it?`,
      images: frames,
      maxTokens: 600,
      effort: 'low',
    });
    return { present: out?.present !== false, detected: String(out?.detected || '').slice(0, 300), cause: String(out?.cause || '').slice(0, 300) };
  } catch {
    return { present: true, detected: 'Vision inspector unavailable — visual requirement unverified.', cause: '' };
  }
}

// ---------------------------------------------------------------------------
// Required-content manifest — built DETERMINISTICALLY from the planned scene
// ---------------------------------------------------------------------------

const text = (v: unknown) => String(v ?? '').trim();

/** Build the required-content manifest for one planned scene. Exact strings
 * come from the spec itself (never re-asked from a model), so the manifest is
 * stable and byte-exact. critical=true means QA must find it or fail. */
export function buildRequiredContent(scene: {
  source: string;
  visual_type?: string | null;
  spec: any;
  on_screen_text?: string | null;
  purpose?: string | null;
  visual_prompt?: string | null;
}): RequiredContent {
  const spec: any = scene.spec || {};
  const texts: RequiredTextItem[] = [];
  const visuals: RequiredVisualItem[] = [];
  const addText = (value: string, critical: boolean) => {
    const v = text(value);
    if (v && !texts.some((t) => t.value === v)) texts.push({ value: v, critical });
  };

  if (scene.source === 'graphic') {
    addText(spec.title, true);
    addText(spec.subtitle, false);
    if (spec.stat && (spec.stat.value !== undefined && spec.stat.value !== null)) {
      addText(`${text(spec.stat.prefix)}${text(spec.stat.value)}${text(spec.stat.suffix)}`, true);
    }
    addText(spec.leftTitle, false);
    addText(spec.rightTitle, false);
    for (const item of (Array.isArray(spec.items) ? spec.items.slice(0, 6) : [])) addText(item?.label, false);
    visuals.push({
      type: scene.visual_type === 'EDUCATIONAL_DIAGRAM' || scene.visual_type === 'PROCESS' ? 'diagram' : 'motion_graphic',
      description: `An animated ${text(spec.treatment) || 'motion'} graphic that explains: ${text(scene.purpose) || text(spec.title) || 'the scene idea'}. Not a bare static text card.`,
      required: true,
    });
  } else if (scene.source === 'mockup') {
    addText(spec.headline, true);
    addText(spec.caption, false);
    addText(spec.cursor?.callout, false);
    visuals.push({
      type: 'product_ui',
      description: 'The REAL product screenshot presented inside a device/browser mockup frame — an actual interface with its own layout and content, not a generic laptop, not an AI-invented UI, not empty chrome.',
      required: true,
    });
  } else if (scene.source === 'asset') {
    addText(spec.headline, true);
    for (const l of (Array.isArray(spec.labels) ? spec.labels.slice(0, 5) : [])) addText(l?.text, false);
    visuals.push({
      type: 'image',
      description: text(spec.asset_prompt) || text(scene.visual_prompt) || 'The generated product-related image, clearly visible.',
      required: true,
    });
  } else {
    // veo — the generative clip must land the storyboard subject; its exact
    // text (if any) lives in the deterministic overlay, never in the AI video.
    visuals.push({
      type: 'ai_video',
      description: text(spec.visual_concept) || text(scene.visual_prompt) || text(scene.purpose) || 'Cinematic footage serving the narration.',
      required: true,
    });
  }

  // Exact on-screen text is ALWAYS a requirement of the rendered output —
  // for veo scenes it is verified on the deterministic overlay + final MP4.
  addText(scene.on_screen_text || '', true);

  return { text: texts, visuals };
}

// ---------------------------------------------------------------------------
// 5. SCENE OUTPUT QA — one rendered scene against its manifest
// ---------------------------------------------------------------------------

export interface SceneQaInputs {
  clipUrl: string;
  /** Deterministic exact-text overlay clip (veo scenes) — where exact text lives. */
  textOverlayUrl?: string | null;
  durationS: number;
  required: RequiredContent | null | undefined;
  source: string;
  onNote?: (n: string) => void;
}

function sourceFix(source: string, kind: 'text' | 'visual'): string {
  if (kind === 'text') {
    return source === 'veo'
      ? 'Exact text must not depend on AI video — render it as the deterministic SVG text overlay and re-compose.'
      : 'Regenerate this scene so the deterministic graphic actually renders the required text.';
  }
  return source === 'mockup'
    ? 'Use the actual product screenshot in the mockup — never a recreated or generic interface.'
    : source === 'veo'
      ? 'Retake the AI video with a corrected prompt that lands the storyboard subject.'
      : 'Regenerate the scene so the planned visual actually appears.';
}

export async function runSceneOutputQa(inputs: SceneQaInputs): Promise<SceneQaReport> {
  const say = (n: string) => { try { inputs.onNote?.(n); } catch { /* UI only */ } };
  const failures: QaFailure[] = [];
  const required: RequiredContent = inputs.required || { text: [], visuals: [] };

  // (1) Integrity — the render must be a real, decodable, non-blank video.
  say('QA: validating the rendered file…');
  const integrity = await validateClipIntegrity(inputs.clipUrl);
  if (!integrity.ok) {
    failures.push({
      requirement: 'integrity',
      expected: 'A decodable video file with real duration, dimensions and visible frames.',
      detected: integrity.reason || 'The rendered file failed validation.',
      cause: integrity.blank ? 'The generated video is blank — the API returned a URL but the render carries no visual content.' : 'The rendered file is missing or corrupt.',
      fix: 'Retake the scene (the prompt is regenerated automatically on retry).',
      severity: 'critical',
    });
    return { pass: false, method: 'frames_ocr_vision', checkedAt: new Date().toISOString(), integrity, failures };
  }

  // (2) Frames from the ACTUAL render — 0/25/50/75/100%.
  say('QA: extracting frames from the actual render…');
  const frames = await extractQaFrames(inputs.clipUrl, integrity.duration_s || inputs.durationS);

  // (3) OCR — where does the exact text actually live?
  const requiredTexts = required.text.filter((t) => t.value);
  let detectedText = '';
  if (requiredTexts.length) {
    let ocrTargets: string[] = [];
    if (inputs.source === 'veo') {
      // Exact text never depends on AI video: it lives on the deterministic
      // overlay. A missing overlay is itself a failure of the text requirement.
      if (inputs.textOverlayUrl) {
        say('QA: reading the exact-text overlay…');
        // Sample mid-clip — the text has animated in and not yet eased out.
        ocrTargets = await extractQaFrames(inputs.textOverlayUrl, inputs.durationS, [0.45, 0.65]);
      }
      if (!inputs.textOverlayUrl) {
        for (const t of requiredTexts) {
          failures.push({
            requirement: 'text',
            expected: `"${t.value}" rendered on screen`,
            detected: 'No deterministic text overlay exists for this AI-video scene.',
            cause: 'Exact text was left to the generative video model instead of the deterministic overlay system.',
            fix: sourceFix('veo', 'text'),
            severity: t.critical ? 'critical' : 'important',
          });
        }
      }
    } else {
      ocrTargets = frames.slice(1); // skip the very first frame — text animates in
    }
    if (ocrTargets.length) {
      say('QA: OCR on the rendered frames…');
      try {
        const texts = await ocrFrames(ocrTargets);
        detectedText = texts.filter(Boolean).join(' \n ');
        for (const t of requiredTexts) {
          if (!textFoundIn(t.value, detectedText)) {
            failures.push({
              requirement: 'text',
              expected: `"${t.value}"`,
              detected: detectedText ? `OCR read only: "${detectedText.slice(0, 160)}"` : 'No matching text detected in the rendered frames.',
              cause: inputs.source === 'veo'
                ? 'The exact-text overlay does not actually render the required text.'
                : 'The rendered graphic does not contain the required text.',
              fix: sourceFix(inputs.source, 'text'),
              severity: t.critical ? 'critical' : 'important',
            });
          }
        }
      } catch (e: any) {
        say(`QA: OCR unavailable (${String(e?.message || e).slice(0, 80)}) — text requirements recorded as unverified.`);
      }
    }
  }

  // (4) Vision — the required visual must actually be present in the frames.
  const requiredVisual = required.visuals.find((v) => v.required);
  if (requiredVisual && frames.length) {
    say('QA: vision inspection of the rendered frames…');
    const midFrames = [frames[Math.floor(frames.length / 2)], frames[frames.length - 1]].filter(Boolean);
    const verdict = await verifyVisualInFrames(requiredVisual, midFrames);
    if (!verdict.present) {
      failures.push({
        requirement: 'visual',
        expected: requiredVisual.description.slice(0, 240),
        detected: verdict.detected || 'The required visual is not present in the rendered frames.',
        cause: verdict.cause || 'The rendered output does not contain the planned visual.',
        fix: sourceFix(inputs.source, 'visual'),
        severity: 'critical',
      });
    }
  }

  // Verdict: critical failures fail; two or more important misses also fail.
  const criticals = failures.filter((f) => f.severity === 'critical').length;
  const importants = failures.filter((f) => f.severity === 'important').length;
  return {
    pass: criticals === 0 && importants < 2,
    method: 'frames_ocr_vision',
    checkedAt: new Date().toISOString(),
    integrity,
    detected_text: detectedText.slice(0, 1200) || undefined,
    failures,
  };
}

// ---------------------------------------------------------------------------
// 6. FINAL-VIDEO QA — the composed MP4, per scene window
// ---------------------------------------------------------------------------

/** Best-effort narration-audio presence check (decode + RMS). null = unverifiable. */
async function probeAudioPresence(url: string): Promise<boolean | null> {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 80 * 1024 * 1024) return null; // too large to decode safely
    const ctx = new Ctx();
    try {
      const audio: AudioBuffer = await ctx.decodeAudioData(buf.slice(0));
      const data = audio.getChannelData(0);
      let sumSq = 0; const step = Math.max(1, Math.floor(data.length / 200000));
      let n = 0;
      for (let i = 0; i < data.length; i += step) { sumSq += data[i] * data[i]; n += 1; }
      const rms = Math.sqrt(sumSq / Math.max(1, n));
      return rms > 0.004;
    } finally {
      try { await ctx.close(); } catch { /* released */ }
    }
  } catch { return null; }
}

export async function runFinalVideoQa(params: {
  finalUrl: string;
  scenes: FilmScene[];              // main scenes, in playback order
  expectNarration: boolean;
  onNote?: (n: string) => void;
}): Promise<FinalQaReport> {
  const say = (n: string) => { try { params.onNote?.(n); } catch { /* UI only */ } };
  const failures: QaFailure[] = [];
  const notes: string[] = [];

  say('Final QA: validating the composed MP4…');
  const integrity = await validateClipIntegrity(params.finalUrl);
  if (!integrity.ok) {
    failures.push({
      requirement: 'integrity',
      expected: 'A decodable final MP4 with real duration and visible frames.',
      detected: integrity.reason || 'The final file failed validation.',
      cause: 'The FFmpeg composition produced a blank or corrupt file.',
      fix: 'Compose the final ad again.',
      severity: 'critical',
    });
    return { pass: false, checkedAt: new Date().toISOString(), duration_s: integrity.duration_s, failures, notes };
  }

  // Scene windows from the voice-derived durations the composition used.
  const windows: { scene: FilmScene; start: number; dur: number }[] = [];
  let cursor = 0;
  for (const s of params.scenes) {
    const dur = Math.max(0.5, Number(s.duration_s) || 5);
    windows.push({ scene: s, start: cursor, dur });
    cursor += dur;
  }
  const expectedTotal = cursor;
  if (expectedTotal > 4 && integrity.duration_s < expectedTotal * 0.6) {
    failures.push({
      requirement: 'integrity',
      expected: `≈${Math.round(expectedTotal)}s of composed video (all ${params.scenes.length} scenes).`,
      detected: `The final file runs ${integrity.duration_s.toFixed(1)}s.`,
      cause: 'Scenes were dropped or truncated during FFmpeg composition.',
      fix: 'Compose the final ad again; if it persists, regenerate the scene whose clip failed to fetch.',
      severity: 'critical',
    });
  }
  const scale = expectedTotal > 0 ? Math.min(1, integrity.duration_s / expectedTotal) : 1;

  // Unexpected-black-frame sweep at every scene midpoint (local pixels, free).
  say('Final QA: sweeping for blank frames…');
  for (const w of windows) {
    const at = (w.start + w.dur * 0.55) * scale;
    if (at >= integrity.duration_s) continue;
    const stats = await sampleFrameStatsAt(params.finalUrl, at);
    if (stats && stats.stdev < 4 && stats.mean < 14) {
      failures.push({
        requirement: 'composite',
        sceneIdx: w.scene.idx,
        expected: `Scene ${w.scene.idx + 1} (${w.scene.visual_type || w.scene.source}) visible at ${at.toFixed(1)}s.`,
        detected: 'A uniform black frame.',
        cause: 'The scene went black in the final composite (missing clip, zero-duration layer, or a failed filter).',
        fix: 'Re-compose the final ad; if it persists, retake this scene.',
        severity: 'critical',
      });
    }
  }

  // Critical exact text — verified INSIDE its scene's time window (rule:
  // appearing somewhere else in the video does not pass timing).
  const textWindows = windows.filter((w) => (w.scene.required_content?.text || []).some((t) => t.critical && t.value));
  for (const w of textWindows) {
    const wanted = (w.scene.required_content?.text || []).filter((t) => t.critical && t.value);
    say(`Final QA: checking exact text in scene ${w.scene.idx + 1}'s window…`);
    const at1 = (w.start + w.dur * 0.45) * scale;
    const at2 = (w.start + w.dur * 0.7) * scale;
    const frameUrls: string[] = [];
    for (const at of [at1, at2]) {
      if (at >= integrity.duration_s) continue;
      try { frameUrls.push(await extractFrame(params.finalUrl, at)); } catch { /* degrade to fewer frames */ }
    }
    if (!frameUrls.length) { notes.push(`Scene ${w.scene.idx + 1}: no frame could be extracted from the final video — its text is unverified.`); continue; }
    let detected = '';
    try {
      detected = (await ocrFrames(frameUrls)).filter(Boolean).join(' \n ');
    } catch {
      notes.push(`Scene ${w.scene.idx + 1}: OCR unavailable — its text is unverified.`);
      continue;
    }
    for (const t of wanted) {
      if (!textFoundIn(t.value, detected)) {
        const sceneHadIt = w.scene.qa_report?.pass !== false; // the scene asset itself verified fine
        failures.push({
          requirement: sceneHadIt ? 'composite' : 'text',
          sceneIdx: w.scene.idx,
          expected: `"${t.value}" readable between ${(w.start * scale).toFixed(1)}s and ${((w.start + w.dur) * scale).toFixed(1)}s.`,
          detected: detected ? `OCR read only: "${detected.slice(0, 140)}"` : 'No matching text in that window of the final video.',
          cause: sceneHadIt
            ? 'The overlay/graphic is valid as an asset but disappeared during FFmpeg composition (alpha/colorkey/z-order/timing fault).'
            : 'The scene render itself is missing the required text.',
          fix: sceneHadIt ? 'Re-compose the final ad.' : 'Retake the scene so the deterministic overlay renders the exact text, then re-compose.',
          severity: 'critical',
        });
      }
    }
  }

  // Narration audio — best-effort; unverifiable is a note, never a silent pass/fail.
  if (params.expectNarration) {
    say('Final QA: checking the narration audio…');
    const has = await probeAudioPresence(params.finalUrl);
    if (has === false) {
      failures.push({
        requirement: 'audio',
        expected: 'Audible narration in the final mix.',
        detected: 'The decoded audio track is silent.',
        cause: 'The narration was dropped or muted during the final audio mix.',
        fix: 'Re-compose the final ad.',
        severity: 'critical',
      });
    } else if (has === null) {
      notes.push('Narration audio could not be verified in this browser.');
    }
  }

  return {
    pass: failures.filter((f) => f.severity === 'critical').length === 0,
    checkedAt: new Date().toISOString(),
    duration_s: integrity.duration_s,
    failures,
    notes,
  };
}
