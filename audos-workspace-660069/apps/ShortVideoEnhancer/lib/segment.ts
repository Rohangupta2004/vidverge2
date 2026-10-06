/**
 * Short Video Enhancer — SUBJECT SEGMENTATION.
 *
 * The depth stack needs to know where the presenter / product is on every
 * frame, so a graphic can be placed BEHIND them. This module produces that
 * answer, in normalised source coordinates, with three levels of fidelity and
 * no silent failures between them:
 *
 *   1. The platform vision model (`gemini-vision-transform`) reads a handful of
 *      sampled frames and returns a bounding box for the main subject.
 *   2. If the vision pass is unavailable — or the frames cannot be read at all,
 *      which happens when the canvas is tainted by a cross-origin source — the
 *      local face / saliency track from lib/analyze.ts is promoted into boxes.
 *   3. If there is no track either, a single centred box is returned and the
 *      creator adjusts it by hand (the manual front/back toggle on each graphic
 *      keeps working regardless).
 *
 * Whatever path was taken is reported verbatim in `note` and shown in the
 * editor, because a depth composite built on a guess the creator cannot see is
 * the most expensive kind of wrong.
 */

import { clamp, round3, type Clip, type SubjectBox, type SubjectState } from './model';
import { sampleFrames } from './analyze';
import { locateSubject } from './api';

export interface SegmentResult {
  boxes: SubjectBox[];
  box: { x: number; y: number; w: number; h: number };
  source: SubjectState['source'];
  confidence: number;
  note: string;
}

/** The box used when nothing at all could be detected: a centred talking head. */
export const FALLBACK_BOX = { x: 0.5, y: 0.56, w: 0.64, h: 0.9 };

/** How many frames the vision pass reads. More is slower and barely better. */
const VISION_SAMPLES = 4;

/**
 * Smooth and rate-limit a raw box track so the mask glides instead of
 * chattering between samples — a mask that snaps is far more visible than a
 * mask that lags.
 */
function smoothBoxes(raw: SubjectBox[]): SubjectBox[] {
  if (raw.length < 2) return raw.map((b) => ({ ...b }));
  const out: SubjectBox[] = [];
  let lastX = raw[0].x;
  let lastY = raw[0].y;
  let lastW = raw[0].w;
  let lastH = raw[0].h;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(raw.length - 1, i + 1)];
    const mx = (a.x + b.x * 2 + c.x) / 4;
    const my = (a.y + b.y * 2 + c.y) / 4;
    const mw = (a.w + b.w * 2 + c.w) / 4;
    const mh = (a.h + b.h * 2 + c.h) / 4;
    lastX = clamp(lastX + clamp(mx - lastX, -0.08, 0.08), 0.08, 0.92);
    lastY = clamp(lastY + clamp(my - lastY, -0.08, 0.08), 0.08, 0.95);
    lastW = clamp(lastW + clamp(mw - lastW, -0.1, 0.1), 0.12, 1);
    lastH = clamp(lastH + clamp(mh - lastH, -0.1, 0.1), 0.12, 1);
    out.push({ t: b.t, x: round3(lastX), y: round3(lastY), w: round3(lastW), h: round3(lastH) });
  }
  return out;
}

/** Promote the existing face / saliency focus path into subject boxes. */
function boxesFromFocus(clip: Clip): SubjectBox[] {
  const focus = clip.reframe.focus || [];
  if (!focus.length) return [];
  // The focus track is a POINT, not an extent: a face detector point sits on
  // the face, so the body below it is included by biasing the box downward.
  const faceTracked = clip.reframe.source === 'face-detector';
  const w = faceTracked ? 0.58 : 0.66;
  const h = faceTracked ? 0.88 : 0.92;
  return focus.map((f) => ({
    t: f.t,
    x: round3(clamp(f.x, 0.1, 0.9)),
    y: round3(clamp(f.y + (faceTracked ? 0.16 : 0.08), 0.1, 0.94)),
    w: w,
    h: h,
  }));
}

/**
 * Find the subject across a clip. Never throws: every failure path returns a
 * usable box plus the reason it had to fall back.
 */
export async function segmentSubject(clip: Clip): Promise<SegmentResult> {
  const fallbackTrack = boxesFromFocus(clip);
  const fallback = (note: string): SegmentResult => {
    if (fallbackTrack.length) {
      return {
        boxes: smoothBoxes(fallbackTrack),
        box: { ...fallbackTrack[Math.floor(fallbackTrack.length / 2)] },
        source: clip.reframe.source === 'face-detector' ? 'face-detector' : 'saliency',
        confidence: round3(clamp(clip.reframe.confidence * 0.7, 0.1, 0.8)),
        note: note + ' Using the local ' +
          (clip.reframe.source === 'face-detector' ? 'face track' : 'saliency track') +
          ' instead — ' + fallbackTrack.length + ' box(es) across the clip.',
      };
    }
    return {
      boxes: [],
      box: { ...FALLBACK_BOX },
      source: 'manual',
      confidence: 0,
      note: note + ' There is no subject track to fall back on either, so a centred box is in place — adjust it by hand, ' +
        'or run Analyse subject on the clip first and try again.',
    };
  };

  if (!clip.src) return fallback('There is no footage on this clip.');

  const sampled = await sampleFrames(clip.src, clip.srcDuration, VISION_SAMPLES);
  if (!sampled.frames.length) return fallback(sampled.note || 'No frames could be sampled.');

  const raw: SubjectBox[] = [];
  let lastNote = '';
  for (const frame of sampled.frames) {
    const found = await locateSubject(frame.base64, frame.mimeType);
    if (found.note) lastNote = found.note;
    if (!found.found) continue;
    raw.push({
      t: frame.t,
      x: round3(clamp(found.x, 0.08, 0.92)),
      y: round3(clamp(found.y, 0.08, 0.95)),
      w: round3(clamp(found.w, 0.12, 1)),
      h: round3(clamp(found.h, 0.12, 1)),
    });
  }

  if (!raw.length) {
    return fallback('The vision model did not find a subject' + (lastNote ? ' (' + lastNote + ')' : '') + '.');
  }

  const hitRate = raw.length / sampled.frames.length;
  const boxes = smoothBoxes(raw);
  return {
    boxes,
    box: { ...boxes[Math.floor(boxes.length / 2)] },
    source: 'gemini-vision',
    confidence: round3(clamp(hitRate, 0.2, 1)),
    note: 'Subject segmented by the vision model in ' + raw.length + ' of ' + sampled.frames.length +
      ' sampled frames. The mask follows these boxes, so background graphics sit genuinely behind the subject.',
  };
}
