/**
 * Short Video Enhancer — the SHORT-FORM PACING ENGINE.
 *
 * Short-form dies on a static shot. This module reads what is actually being
 * said (the caption cues, or the raw word timestamps when there are no cues
 * yet) alongside the compiled clip timings, and writes a PACING PLAN: a list of
 * specific decisions, each one saying what effect goes where, how hard it hits,
 * and WHICH RULE fired.
 *
 * The plan is deliberately a separate document from the project. Nothing is
 * applied until the creator says so, every item can be unticked, and anything
 * they have locked is never touched — a plan that silently overwrote hand-placed
 * work would be worse than no plan at all.
 *
 * The rules, in the order they are evaluated:
 *   speech emphasis        -> zoom punch-in, or a caption emphasis beat
 *   scene-change keyword   -> transition trigger on the nearest cut
 *   question phrase        -> caption style switch for that cue
 *   strong statement       -> hook-style caption treatment
 *   static shot over 3s    -> camera move or zoom, to break the stillness
 *
 * Two identical effects never land back to back: when the same kind wins twice
 * in a row the second one is swapped for its alternative, and dropped entirely
 * if the alternative does not fit either.
 */

import {
  clamp, clipContentDuration, nearestBeat, newGraphic, round3, uid,
  type CameraSegment, type CompiledTimeline, type PacingItem, type PacingKind,
  type PacingPlan, type Project,
} from './model';
import { emphasisScore, type PresetPack } from './presets';
import { promoteCueToHook } from './hookTemplates';

/** A word on the TIMELINE, with the cue it belongs to when there is one. */
interface PacedWord { text: string; start: number; end: number; cueId: string | null; index: number }

interface PacedCue { id: string | null; start: number; end: number; text: string; words: PacedWord[]; locked: boolean }

/** Words that announce a new beat in the script. */
const SCENE_CHANGE_WORDS = [
  'second', 'secondly', 'third', 'thirdly', 'next', 'then', 'but', 'however', 'now',
  'meanwhile', 'finally', 'lastly', 'also', 'plus', 'instead', 'suddenly', 'anyway', 'so',
];

/** Phrases that do the same job across two or three words. */
const SCENE_CHANGE_PHRASES = [
  "here's", 'here is', 'watch this', 'look at', 'check this', 'the trick', 'the problem',
  'step one', 'step two', 'which means', 'the result',
];

const QUESTION_OPENERS = [
  'why', 'how', 'what', 'when', 'where', 'who', 'which',
  'can', 'should', 'could', 'would', 'does', 'do', 'did', 'is', 'are', 'was', 'have', 'will',
];

/** Openers that carry a claim — the hook treatment exists for these. */
const STRONG_OPENERS = [
  'never', 'always', 'everyone', 'everybody', 'nobody', 'stop', 'listen', 'most people',
  'the truth', 'nobody tells', 'this is why', 'you are', 'do not', "don't", 'the reason',
];

/** A static stretch longer than this wants a visual change. */
export const STATIC_LIMIT_S = 3;

function normalise(raw: string): string {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9'%$ ]/g, '').trim();
}

/**
 * The spoken words, on the timeline.
 *
 * Caption cues are preferred because they are already in timeline seconds and
 * already grouped the way the viewer will read them. Raw transcript words are
 * the fallback for a project that has not been captioned yet, mapped through
 * clip 1's in-point and speed exactly as the caption builder does.
 */
function pacedCues(project: Project, timelineDuration: number): PacedCue[] {
  const cues = project.captions.filter((c) => c.enabled && c.words.length);
  if (cues.length) {
    return cues.map((c) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      text: c.words.map((w) => w.text).join(' '),
      locked: !!c.locked,
      words: c.words.map((w, i) => ({ text: w.text, start: w.start, end: w.end, cueId: c.id, index: i })),
    }));
  }

  const clip = project.clips[0];
  const words = project.transcript.filter((w) => w && typeof w.word === 'string' && w.word.trim());
  // Clip 1 starts after the hook's lead-in, so the words it carries do too.
  const leadIn = project.hook && project.hook.enabled ? Math.max(0, project.hook.leadIn) : 0;
  const timed: PacedWord[] = [];
  if (clip && words.length) {
    for (const w of words) {
      if (w.start < clip.in - 0.001 || w.start > clip.out + 0.001) continue;
      const s = round3(leadIn + (w.start - clip.in) / Math.max(0.1, clip.speed));
      const e = round3(leadIn + (Math.max(w.start + 0.08, w.end) - clip.in) / Math.max(0.1, clip.speed));
      timed.push({ text: w.word.trim(), start: s, end: Math.max(s + 0.08, e), cueId: null, index: timed.length });
    }
  } else if (project.transcriptText.trim()) {
    const tokens = project.transcriptText.trim().split(/\s+/).slice(0, 400);
    const per = Math.max(0.5, timelineDuration - leadIn) / Math.max(1, tokens.length);
    tokens.forEach((text, i) => {
      timed.push({ text, start: round3(leadIn + i * per), end: round3(leadIn + (i + 1) * per), cueId: null, index: i });
    });
  }
  if (!timed.length) return [];

  // Group on sentence ends and long pauses so the question / hook rules have
  // something sentence-shaped to test.
  const out: PacedCue[] = [];
  let current: PacedWord[] = [];
  for (let i = 0; i < timed.length; i++) {
    current.push(timed[i]);
    const next = timed[i + 1];
    const gap = next ? next.start - timed[i].end : 999;
    const sentence = /[.!?]\s*$/.test(timed[i].text);
    if (!next || current.length >= 8 || gap > 0.62 || (sentence && current.length >= 2)) {
      out.push({
        id: null,
        start: current[0].start,
        end: current[current.length - 1].end,
        text: current.map((w) => w.text).join(' '),
        locked: false,
        words: current.slice(),
      });
      current = [];
    }
  }
  if (current.length) {
    out.push({
      id: null,
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((w) => w.text).join(' '),
      locked: false,
      words: current.slice(),
    });
  }
  return out;
}

function item(fields: {
  kind: PacingKind; at: number; end: number; intensity: number; reason: string;
  trigger: string; clipId: string | null; blockedBy?: string;
}): PacingItem {
  return {
    id: uid('pace'),
    kind: fields.kind,
    at: round3(fields.at),
    end: round3(Math.max(fields.at + 0.2, fields.end)),
    intensity: clamp(fields.intensity, 0.1, 1),
    reason: fields.reason,
    trigger: fields.trigger,
    clipId: fields.clipId,
    enabled: true,
    applied: false,
    blockedBy: fields.blockedBy || '',
  };
}

/**
 * Pull camera decisions onto the nearest measured music beat. With no enabled
 * music bed (or no measured grid yet) the original speech timing is returned
 * byte-for-byte, which preserves the pre-beat-sync behaviour.
 */
function cameraDecisionTime(project: Project, speechTime: number): number {
  if (!project.audio.music || !project.audio.music.enabled || !project.beats.times.length) return speechTime;
  const beats = project.beats.times;
  let halfStep = 0.6;
  if (beats.length > 1) halfStep = Math.max(0.08, Math.abs(beats[1] - beats[0]) / 2 + 0.01);
  const beat = nearestBeat(project.beats, speechTime, halfStep);
  return beat === null ? speechTime : beat;
}

/** Which clip covers an absolute timeline second, and where inside it. */
function clipAt(timeline: CompiledTimeline, at: number): { id: string; local: number; duration: number } | null {
  for (const span of timeline.contentSpans) {
    if (at >= span.start - 0.001 && at <= span.end + 0.001) {
      return { id: span.id, local: round3(at - span.start), duration: round3(span.end - span.start) };
    }
  }
  const last = timeline.contentSpans[timeline.contentSpans.length - 1];
  if (!last) return null;
  return { id: last.id, local: round3(Math.max(0, at - last.start)), duration: round3(last.end - last.start) };
}

/** The alternative effect for a kind, used when the same kind repeats. */
const ALTERNATIVE: Partial<Record<PacingKind, PacingKind>> = {
  zoomPunch: 'captionEmphasis',
  captionEmphasis: 'zoomPunch',
  cameraMove: 'graphicAccent',
  graphicAccent: 'cameraMove',
  hookCaption: 'captionEmphasis',
};

/**
 * Build the plan. Nothing in the project is changed — the caller shows this
 * list, lets the creator edit it, and only then calls applyPacingPlan.
 */
export function buildPacingPlan(project: Project, timeline: CompiledTimeline, pack: PresetPack): PacingPlan {
  const duration = Math.max(0.5, timeline.durationS);
  const cues = pacedCues(project, duration);
  const raw: PacingItem[] = [];

  // --- rule 1: speech emphasis -------------------------------------------
  let lastPunch = -999;
  for (const cue of cues) {
    let best: PacedWord | null = null;
    let bestScore = 0;
    for (const w of cue.words) {
      const score = emphasisScore(w.text);
      if (score > bestScore) { bestScore = score; best = w; }
    }
    if (!best || bestScore < 2) continue;
    const where = clipAt(timeline, best.start);
    const spacedOut = best.start - lastPunch >= pack.punchInEvery;
    if (spacedOut) lastPunch = best.start;
    const decisionAt = spacedOut ? cameraDecisionTime(project, best.start) : best.start;
    const musicSnapped = spacedOut && Math.abs(decisionAt - best.start) > 0.001;
    raw.push(item({
      kind: spacedOut ? 'zoomPunch' : 'captionEmphasis',
      // A zoom decision marks the IMPACT beat; applyPacingPlan starts the move
      // 120ms earlier so the camera arrives on this exact timestamp.
      at: spacedOut && project.audio.music && project.beats.times.length ? decisionAt : best.start - (spacedOut ? 0.12 : 0),
      end: decisionAt + (spacedOut ? 1 : 0.6),
      intensity: clamp(bestScore / 3, 0.4, 1),
      reason: spacedOut
        ? 'Stressed word — a punch-in lands the emphasis without a cut.' + (musicSnapped ? ' Its impact is snapped to the nearest music beat.' : '')
        : 'Stressed word, but a punch-in ' + pack.punchInEvery.toFixed(1) + 's ago would read as jitter, so the caption carries it instead.',
      trigger: best.text,
      clipId: where ? where.id : null,
      blockedBy: cue.locked && !spacedOut ? 'the caption cue is locked' : '',
    }));
  }

  // --- rule 2: scene-change keyword --------------------------------------
  const cutTimes = timeline.contentSpans.slice(0, -1).map((s) => s.end);
  for (const cue of cues) {
    const opening = normalise(cue.words.slice(0, 2).map((w) => w.text).join(' '));
    const head = normalise(cue.words.length ? cue.words[0].text : '');
    const phrase = SCENE_CHANGE_PHRASES.find((p) => opening.indexOf(p) === 0);
    const keyword = SCENE_CHANGE_WORDS.indexOf(head) >= 0 ? head : '';
    if (!phrase && !keyword) continue;
    const nearestCut = cutTimes.reduce<number | null>((acc, t) => {
      if (Math.abs(t - cue.start) > 0.8) return acc;
      if (acc === null || Math.abs(t - cue.start) < Math.abs(acc - cue.start)) return t;
      return acc;
    }, null);
    const where = clipAt(timeline, cue.start);
    const cameraAt = nearestCut === null ? cameraDecisionTime(project, cue.start) : nearestCut;
    raw.push(item({
      kind: nearestCut === null ? 'cameraMove' : 'transitionTrigger',
      at: cameraAt,
      end: cameraAt + 1.2,
      intensity: 0.7,
      reason: nearestCut === null
        ? 'Scene-change word with no cut nearby — a new camera angle gives the handoff instead.' + (Math.abs(cameraAt - cue.start) > 0.001 ? ' The move starts on the nearest music beat.' : '')
        : 'Scene-change word right on a cut — this is where a transition belongs.',
      trigger: phrase || keyword,
      clipId: where ? where.id : null,
    }));
  }

  // --- rule 3: question phrase -------------------------------------------
  for (const cue of cues) {
    const text = normalise(cue.text);
    const head = text.split(' ')[0] || '';
    const asked = /\?/.test(cue.text) || QUESTION_OPENERS.indexOf(head) >= 0;
    if (!asked) continue;
    raw.push(item({
      kind: 'captionStyleSwitch',
      at: cue.start,
      end: cue.end,
      intensity: 0.55,
      reason: 'This cue asks a question — switching its caption treatment signals the change of mode.',
      trigger: cue.words.slice(0, 4).map((w) => w.text).join(' '),
      clipId: null,
      blockedBy: cue.locked ? 'the caption cue is locked' : (cue.id ? '' : 'there is no caption cue here yet — caption the clip first'),
    }));
  }

  // --- rule 4: strong statement ------------------------------------------
  for (const cue of cues) {
    const text = normalise(cue.text);
    const opener = STRONG_OPENERS.find((o) => text.indexOf(o) === 0);
    const shouted = cue.words.some((w) => /^[A-Z]{3,}$/.test(w.text));
    if (!opener && !shouted) continue;
    raw.push(item({
      kind: 'hookCaption',
      at: cue.start,
      end: cue.end,
      intensity: 0.9,
      reason: opener
        ? 'Strong statement — hook-style caption so the claim is the frame.'
        : 'Shouted word in the transcript — treat the line as a hook.',
      trigger: opener || (cue.words.find((w) => /^[A-Z]{3,}$/.test(w.text)) || { text: '' }).text,
      clipId: null,
      blockedBy: cue.locked ? 'the caption cue is locked' : (cue.id ? '' : 'there is no caption cue here yet — caption the clip first'),
    }));
  }

  // --- rule 5: long static shot ------------------------------------------
  // Anything that changes the picture counts as an event: a camera move, a
  // graphic appearing, or a cut. A gap longer than STATIC_LIMIT_S between two
  // events is a stretch where nothing at all happens on screen.
  let cursor = timeline.leadInS;
  for (let i = 0; i < project.clips.length; i++) {
    const clip = project.clips[i];
    if (!clip.enabled || !clip.src) continue;
    const dur = clipContentDuration(clip);
    const events: number[] = [0, dur];
    for (const seg of clip.camera) events.push(clamp(seg.start, 0, dur));
    for (const g of project.graphics) {
      if (g.start >= cursor && g.start <= cursor + dur) events.push(round3(g.start - cursor));
    }
    events.sort((a, b) => a - b);
    for (let k = 0; k < events.length - 1; k++) {
      const gap = events[k + 1] - events[k];
      if (gap <= STATIC_LIMIT_S) continue;
      const steps = Math.floor(gap / STATIC_LIMIT_S);
      for (let s = 1; s <= steps; s++) {
        const local = events[k] + (gap * s) / (steps + 1);
        if (local < 0.4 || local > dur - 0.6) continue;
        const speechAt = round3(cursor + local);
        const moveAt = cameraDecisionTime(project, speechAt);
        raw.push(item({
          kind: 'cameraMove',
          at: moveAt,
          end: round3(moveAt + Math.max(1.2, pack.segmentLength * 0.7)),
          intensity: 0.5,
          reason: gap.toFixed(1) + 's with nothing changing on screen — a camera move keeps the shot alive.' +
            (Math.abs(moveAt - speechAt) > 0.001 ? ' It starts on the nearest music beat.' : ''),
          trigger: 'static shot',
          clipId: clip.id,
          blockedBy: clip.locked ? 'the clip is locked' : '',
        }));
      }
    }
    cursor += dur;
  }

  // --- de-duplicate, space out, and break up repeated effects ------------
  raw.sort((a, b) => a.at - b.at);
  const items: PacingItem[] = [];
  for (const next of raw) {
    const previous = items[items.length - 1];
    // Two decisions on top of each other is one decision.
    if (previous && Math.abs(previous.at - next.at) < 0.25 && previous.kind === next.kind) continue;
    if (previous && previous.kind === next.kind && next.at - previous.at < 1.2) {
      const swap = ALTERNATIVE[next.kind];
      if (!swap) continue;
      items.push({
        ...next,
        kind: swap,
        reason: next.reason + ' Swapped to a ' + swap + ' so the same effect does not fire twice in a row.',
      });
      continue;
    }
    items.push(next);
  }

  const blocked = items.filter((i) => i.blockedBy).length;
  return {
    items,
    generatedAt: Date.now(),
    note: items.length
      ? items.length + ' decision' + (items.length === 1 ? '' : 's') + ' across ' + duration.toFixed(1) + 's' +
        (blocked ? ', ' + blocked + ' held back by a locked layer' : '') +
        '. Untick anything you do not want, then apply.'
      : 'Nothing to change — the cut already varies often enough, or there is no transcript to read yet.',
  };
}

// ---------------------------------------------------------------------------
// Applying the plan
// ---------------------------------------------------------------------------

export interface ApplyPacingResult {
  project: Project;
  applied: number;
  skipped: number;
  notes: string[];
}

function addCameraSegment(clip: Project['clips'][number], seg: CameraSegment): Project['clips'][number] {
  return { ...clip, camera: [...clip.camera, seg].sort((a, b) => a.start - b.start) };
}

/**
 * Write the ticked decisions into the project as ordinary, editable layers.
 *
 * Locked layers are never written to: the item is left in the plan with a
 * `blockedBy` note instead, so the creator can see exactly what was held back
 * and why. Everything this writes is a normal layer afterwards — there is no
 * 'pacing mode' to leave.
 */
export function applyPacingPlan(project: Project, pack: PresetPack, timeline: CompiledTimeline): ApplyPacingResult {
  let next: Project = { ...project };
  const notes: string[] = [];
  let applied = 0;
  let skipped = 0;
  let angleCursor = 0;

  const items = next.pacing.items.map((raw) => {
    const it = { ...raw, blockedBy: '' };
    if (!it.enabled || it.applied) { return it; }
    const where = clipAt(timeline, it.at);
    const clipId = it.clipId || (where ? where.id : null);
    const clip = clipId ? next.clips.find((c) => c.id === clipId) : null;
    const local = where ? where.local : 0;

    if (it.kind === 'zoomPunch' || it.kind === 'cameraMove') {
      if (!clip) { skipped += 1; it.blockedBy = 'no clip covers this point'; return it; }
      if (clip.locked) { skipped += 1; it.blockedBy = 'the clip is locked'; return it; }
      const dur = clipContentDuration(clip);
      const start = clamp(local - (it.kind === 'zoomPunch' ? 0.12 : 0), 0, Math.max(0.1, dur - 0.5));
      const hold = it.kind === 'zoomPunch' ? 0.7 + 0.5 * it.intensity : Math.max(1.2, pack.segmentLength * 0.8);
      const angle = it.kind === 'zoomPunch'
        ? 'punchIn' as const
        : pack.camera[angleCursor++ % pack.camera.length];
      next = {
        ...next,
        clips: next.clips.map((c) => (c.id === clip.id
          ? addCameraSegment(c, { id: uid('cam'), angle, start: round3(start), end: round3(Math.min(dur, start + hold)), locked: false })
          : c)),
      };
      applied += 1;
      return { ...it, applied: true };
    }

    if (it.kind === 'captionEmphasis' || it.kind === 'hookCaption') {
      const cue = next.captions.find((c) => it.at >= c.start - 0.3 && it.at <= c.end + 0.3);
      if (!cue) { skipped += 1; it.blockedBy = 'no caption cue covers this point'; return it; }
      if (cue.locked) { skipped += 1; it.blockedBy = 'the caption cue is locked'; return it; }
      let bestIndex = 0;
      let bestScore = -1;
      cue.words.forEach((w, i) => {
        const score = w.text.toLowerCase() === it.trigger.toLowerCase() ? 9 : emphasisScore(w.text);
        if (score > bestScore) { bestScore = score; bestIndex = i; }
      });
      const hook = it.kind === 'hookCaption';
      next = {
        ...next,
        captions: next.captions.map((c) => {
          if (c.id !== cue.id) return c;
          if (hook) return promoteCueToHook(c, pack, it.trigger);
          return {
            ...c,
            words: c.words.map((w, i) => (i === bestIndex
              ? {
                  ...w,
                  style: pack.emphasisStyle,
                  anim: pack.emphasisAnim,
                  shake: pack.shakeEmphasis,
                  ...(pack.emphasisStyle === 'differentColor' ? { color: pack.accent } : {}),
                }
              : w)),
          };
        }),
      };
      applied += 1;
      return { ...it, applied: true };
    }

    if (it.kind === 'captionStyleSwitch') {
      const cue = next.captions.find((c) => it.at >= c.start - 0.3 && it.at <= c.end + 0.3);
      if (!cue) { skipped += 1; it.blockedBy = 'no caption cue covers this point'; return it; }
      if (cue.locked) { skipped += 1; it.blockedBy = 'the caption cue is locked'; return it; }
      next = {
        ...next,
        captions: next.captions.map((c) => (c.id === cue.id
          ? {
              ...c,
              font: pack.switchFont,
              words: c.words.map((w) => ({ ...w, anim: pack.switchAnim, style: w.style === 'normal' ? 'differentFont' as const : w.style, font: pack.switchFont })),
            }
          : c)),
      };
      applied += 1;
      return { ...it, applied: true };
    }

    if (it.kind === 'transitionTrigger') {
      // A transition can only be strengthened where a cut already exists — the
      // engine never invents a cut inside a clip.
      const span = timeline.contentSpans.find((s) => Math.abs(s.end - it.at) < 0.8);
      const tr = span ? next.transitions.find((t) => t.afterClipId === span.id) : null;
      if (!tr) { skipped += 1; it.blockedBy = 'there is no cut at this point to put a transition on'; return it; }
      if (tr.locked) { skipped += 1; it.blockedBy = 'the transition is locked'; return it; }
      next = {
        ...next,
        transitions: next.transitions.map((t) => (t.id === tr.id
          ? { ...t, type: pack.transitions[0], duration: pack.transitionDuration, easing: pack.easing }
          : t)),
      };
      applied += 1;
      return { ...it, applied: true };
    }

    if (it.kind === 'graphicAccent') {
      const type = pack.graphics[angleCursor++ % pack.graphics.length];
      const g = newGraphic(type, it.at, it.at + pack.graphicDuration, pack.accent, pack.accent2);
      g.easing = pack.easing === 'easeInOut' ? 'expoOut' : pack.easing;
      g.band = 'auto';
      next = { ...next, graphics: [...next.graphics, g] };
      applied += 1;
      return { ...it, applied: true };
    }

    skipped += 1;
    return it;
  });

  const blocked = items.filter((i) => i.blockedBy);
  if (blocked.length) {
    notes.push(blocked.length + ' decision' + (blocked.length === 1 ? ' was' : 's were') + ' held back: ' +
      blocked.slice(0, 3).map((i) => i.kind + ' at ' + i.at.toFixed(1) + 's (' + i.blockedBy + ')').join('; ') + '.');
  }

  return {
    project: {
      ...next,
      pacing: {
        ...next.pacing,
        items,
        note: applied + ' applied, ' + skipped + ' skipped. Applied decisions are ordinary layers now — edit or delete any of them.',
      },
    },
    applied,
    skipped,
    notes,
  };
}
