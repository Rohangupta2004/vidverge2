/**
 * Short Video Enhancer — the motion design director.
 *
 * A preset pack is not a filter: it is a set of decisions about PACING,
 * EMPHASIS, CAPTIONS, MOTION GRAPHICS and TRANSITIONS. Applying one walks the
 * hierarchy the product is built on and writes real, individually editable
 * layers into the project — camera segments, transitions on each cut, caption
 * cues with per-word styles, and motion graphics on the emphasis beats.
 *
 * Everything it writes is an ordinary layer afterwards: the creator can change
 * or delete any of it without re-applying or losing the rest.
 */

import {
  CANVAS_H, CANVAS_W, SAFE_MARGIN,
  clamp, clipContentDuration, newCaptionCue, newGraphic, newKeyframe, newTransition, round3, uid,
  type CameraAngle, type CameraSegment, type CaptionAnimId, type CaptionCue, type CaptionStyleId,
  type CaptionWord, type EasingId, type FontId, type GradeId, type GraphicLayer, type GraphicType,
  type PresetId, type Project, type SubjectFx, type TransitionId,
} from './model';

/** One word with its timeline (not source) window, before cues are grouped. */
interface TimedWord { text: string; start: number; end: number }

export interface PresetPack {
  id: PresetId;
  name: string;
  blurb: string;
  pacing: string;
  transitions: TransitionId[];
  transitionDuration: number;
  easing: EasingId;
  captionFont: FontId;
  captionSize: number;
  captionY: number;
  captionWidthPct: number;
  captionOutline: number;
  baseStyle: CaptionStyleId;
  emphasisStyle: CaptionStyleId;
  baseAnim: CaptionAnimId;
  emphasisAnim: CaptionAnimId;
  shakeEmphasis: boolean;
  wordsPerCue: number;
  graphics: GraphicType[];
  camera: CameraAngle[];
  /** Seconds each simulated camera angle holds before the next one eases in. */
  segmentLength: number;
  /** Insert a PunchIn on an emphasis beat at most this often, in seconds. */
  punchInEvery: number;
  graphicDuration: number;
  accent: string;
  accent2: string;
  /** Caption treatment the pacing engine switches to on a question cue. */
  switchFont: FontId;
  switchAnim: CaptionAnimId;
  /** Colour grade the pack puts on unlocked clips. */
  grade: GradeId;
  /** The depth composite this pack ships with (Phase 4). */
  depth: Pick<SubjectFx, 'enabled' | 'depthBlur' | 'backgroundDim' | 'outline' | 'glow' | 'shadow'>;
}

export const PRESETS: PresetPack[] = [
  {
    id: 'clean-saas',
    name: 'Clean SaaS',
    blurb: 'Measured, product-led motion. Slides and light sweeps, calm captions, UI surfaces.',
    pacing: 'Smooth and measured — long holds, soft handoffs.',
    transitions: ['slide', 'lightSweep', 'maskReveal'],
    transitionDuration: 0.5,
    easing: 'easeInOut',
    captionFont: 'inter',
    captionSize: 66,
    captionY: Math.round(CANVAS_H * 0.77),
    captionWidthPct: 0.78,
    captionOutline: 0,
    baseStyle: 'normal',
    emphasisStyle: 'bold',
    baseAnim: 'slideUp',
    emphasisAnim: 'slideUp',
    shakeEmphasis: false,
    wordsPerCue: 7,
    graphics: ['browserMockup', 'featureCard', 'progressBar', 'cursorClick'],
    camera: ['wide', 'medium', 'wide', 'sideCropRight'],
    segmentLength: 3.6,
    punchInEvery: 9,
    graphicDuration: 2.6,
    accent: '#38BDF8',
    accent2: '#A5F3FC',
    switchFont: 'dmsans',
    switchAnim: 'blurIn',
    grade: 'none',
    depth: { enabled: false, depthBlur: 0, backgroundDim: 0, outline: 0, glow: 0, shadow: 0 },
  },
  {
    id: 'high-energy',
    name: 'High Energy',
    blurb: 'Fast zooms, glitches and whip pans with huge kinetic keywords.',
    pacing: 'Fast — frequent punch-ins and hard accents.',
    transitions: ['zoom', 'glitch', 'whipPan'],
    transitionDuration: 0.32,
    easing: 'expoOut',
    captionFont: 'anton',
    captionSize: 84,
    captionY: Math.round(CANVAS_H * 0.7),
    captionWidthPct: 0.84,
    captionOutline: 8,
    baseStyle: 'bold',
    emphasisStyle: 'huge',
    baseAnim: 'punchIn',
    emphasisAnim: 'punchIn',
    shakeEmphasis: true,
    wordsPerCue: 4,
    graphics: ['speedLines', 'radialBurst', 'glowRing', 'confetti'],
    camera: ['medium', 'closeUp', 'sideCropLeft', 'medium'],
    segmentLength: 1.7,
    punchInEvery: 3.2,
    graphicDuration: 1.5,
    accent: '#F43F5E',
    accent2: '#FB923C',
    switchFont: 'bebas',
    switchAnim: 'highlightSweep',
    grade: 'vivid',
    depth: { enabled: false, depthBlur: 0, backgroundDim: 0, outline: 0, glow: 0, shadow: 0 },
  },
  {
    id: 'creator',
    name: 'Creator',
    blurb: 'Talking-head friendly. Pushes and scales, bold highlighted captions, callouts.',
    pacing: 'Frequent punch-ins, conversational rhythm.',
    transitions: ['push', 'scale'],
    transitionDuration: 0.45,
    easing: 'easeOut',
    captionFont: 'inter',
    captionSize: 76,
    captionY: Math.round(CANVAS_H * 0.74),
    captionWidthPct: 0.82,
    captionOutline: 7,
    baseStyle: 'bold',
    emphasisStyle: 'highlighted',
    baseAnim: 'pop',
    emphasisAnim: 'bounce',
    shakeEmphasis: false,
    wordsPerCue: 5,
    graphics: ['notification', 'callout', 'icon', 'confetti'],
    camera: ['medium', 'closeUp', 'medium', 'sideCropRight'],
    segmentLength: 2.3,
    punchInEvery: 4.5,
    graphicDuration: 2,
    accent: '#F59E0B',
    accent2: '#FBBF24',
    switchFont: 'montserrat',
    switchAnim: 'slideIn',
    grade: 'none',
    depth: { enabled: false, depthBlur: 0, backgroundDim: 0, outline: 0, glow: 0, shadow: 0 },
  },
  {
    id: 'educational',
    name: 'Educational',
    blurb: 'Deliberate pauses, slides and mask reveals, terms picked out in an accent colour.',
    pacing: 'Slower and deliberate — room to read.',
    transitions: ['slide', 'maskReveal'],
    transitionDuration: 0.55,
    easing: 'easeInOut',
    captionFont: 'dmsans',
    captionSize: 68,
    captionY: Math.round(CANVAS_H * 0.78),
    captionWidthPct: 0.8,
    captionOutline: 5,
    baseStyle: 'normal',
    emphasisStyle: 'differentColor',
    baseAnim: 'blurIn',
    emphasisAnim: 'trackingReveal',
    shakeEmphasis: false,
    wordsPerCue: 8,
    graphics: ['arrowDiagram', 'statCard', 'icon', 'featureCard', 'progressBar'],
    camera: ['wide', 'medium', 'wide'],
    segmentLength: 4.4,
    punchInEvery: 12,
    graphicDuration: 3.2,
    accent: '#34D399',
    accent2: '#A7F3D0',
    switchFont: 'oswald',
    switchAnim: 'trackingReveal',
    grade: 'none',
    depth: { enabled: false, depthBlur: 0, backgroundDim: 0, outline: 0, glow: 0, shadow: 0 },
  },

  // --- Phase 4 packs: these three lead with the depth composite -----------
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Slow operated camera, elegant serif typography, depth-blurred background behind the subject.',
    pacing: 'Slow and composed \u2014 long holds, soft reveals.',
    transitions: ['maskReveal', 'lightSweep'],
    transitionDuration: 0.6,
    easing: 'easeInOut',
    captionFont: 'playfair',
    captionSize: 62,
    captionY: Math.round(CANVAS_H * 0.8),
    captionWidthPct: 0.74,
    captionOutline: 0,
    baseStyle: 'normal',
    emphasisStyle: 'differentColor',
    baseAnim: 'blurIn',
    emphasisAnim: 'trackingReveal',
    shakeEmphasis: false,
    wordsPerCue: 7,
    graphics: ['line', 'label', 'glow', 'lightStreak'],
    camera: ['wide', 'medium', 'wide'],
    segmentLength: 5.2,
    punchInEvery: 14,
    graphicDuration: 3.4,
    accent: '#E8D9B5',
    accent2: '#C9A96A',
    switchFont: 'playfair',
    switchAnim: 'blurIn',
    grade: 'cinematic',
    depth: { enabled: true, depthBlur: 11, backgroundDim: 0.24, outline: 0, glow: 0, shadow: 28 },
  },
  {
    id: 'ugc-ad',
    name: 'UGC Ad',
    blurb: 'Fast cuts, bold captions, product callouts and a phone mockup \u2014 built to sell.',
    pacing: 'Very fast \u2014 something changes on every beat.',
    transitions: ['zoom', 'whipPan', 'glitch'],
    transitionDuration: 0.3,
    easing: 'expoOut',
    captionFont: 'montserrat',
    captionSize: 82,
    captionY: Math.round(CANVAS_H * 0.68),
    captionWidthPct: 0.86,
    captionOutline: 9,
    baseStyle: 'bold',
    emphasisStyle: 'huge',
    baseAnim: 'pop',
    emphasisAnim: 'punchIn',
    shakeEmphasis: true,
    wordsPerCue: 4,
    graphics: ['phoneMockup', 'notification', 'statCard', 'confetti'],
    camera: ['closeUp', 'medium', 'punchIn', 'sideCropLeft'],
    segmentLength: 1.5,
    punchInEvery: 2.8,
    graphicDuration: 1.8,
    accent: '#FF4D6D',
    accent2: '#FFD166',
    switchFont: 'anton',
    switchAnim: 'highlightSweep',
    grade: 'vivid',
    depth: { enabled: true, depthBlur: 0, backgroundDim: 0.1, outline: 5, glow: 0, shadow: 18 },
  },
  {
    id: 'tech',
    name: 'Tech',
    blurb: 'UI cards, grid overlays, glowing elements and browser mockups around the presenter.',
    pacing: 'Even and precise \u2014 the graphics carry the rhythm.',
    transitions: ['slide', 'glitch', 'lightSweep'],
    transitionDuration: 0.4,
    easing: 'expoOut',
    captionFont: 'mono',
    captionSize: 60,
    captionY: Math.round(CANVAS_H * 0.79),
    captionWidthPct: 0.8,
    captionOutline: 4,
    baseStyle: 'normal',
    emphasisStyle: 'highlighted',
    baseAnim: 'slideUp',
    emphasisAnim: 'highlightSweep',
    shakeEmphasis: false,
    wordsPerCue: 6,
    graphics: ['browserMockup', 'gridOverlay', 'cursorClick', 'glowRing', 'animatedBorder'],
    camera: ['medium', 'wide', 'sideCropRight', 'medium'],
    segmentLength: 3,
    punchInEvery: 7,
    graphicDuration: 2.8,
    accent: '#22D3EE',
    accent2: '#818CF8',
    switchFont: 'mono',
    switchAnim: 'trackingReveal',
    grade: 'cool',
    depth: { enabled: true, depthBlur: 7, backgroundDim: 0.18, outline: 0, glow: 24, shadow: 0 },
  },
];

export function presetPack(id: PresetId): PresetPack {
  return PRESETS.find((p) => p.id === id) || PRESETS[2];
}

// ---------------------------------------------------------------------------
// EMPHASIS — which words carry the beat
// ---------------------------------------------------------------------------

const PUNCH_WORDS = new Set([
  'not', 'never', 'no', 'nothing', 'everything', 'everyone', 'nobody', 'stop', 'wrong', 'right',
  'only', 'all', 'every', 'most', 'best', 'worst', 'free', 'now', 'today', 'instantly', 'instant',
  'double', 'triple', 'half', 'zero', 'secret', 'truth', 'actually', 'because', 'why', 'how',
  'must', 'need', 'fastest', 'biggest', 'huge', 'massive', 'tiny', 'first', 'last', 'forever',
  'proven', 'guaranteed', 'exactly', 'literally', 'completely', 'totally', 'always',
]);

function cleanWord(raw: string): string {
  return String(raw || '').replace(/[^A-Za-z0-9%$.'-]/g, '');
}

/** How strongly a word wants emphasis. 0 means leave it alone. */
export function emphasisScore(raw: string): number {
  const w = cleanWord(raw);
  if (!w) return 0;
  if (/^[A-Z]{2,}$/.test(w)) return 3;
  if (/[0-9]/.test(w) || w.indexOf('%') >= 0 || w.indexOf('$') >= 0) return 2.5;
  if (PUNCH_WORDS.has(w.toLowerCase())) return 2;
  if (w.length >= 9) return 1;
  return 0;
}

const SENTENCE_END = /[.!?]\s*$/;

// ---------------------------------------------------------------------------
// Timing: source seconds -> timeline seconds
// ---------------------------------------------------------------------------

/**
 * Word timestamps arrive in the SOURCE time of the footage they were
 * transcribed from (clip 1). Captions live on the TIMELINE, so every timestamp
 * is mapped through the clip's in-point and speed, and then past the hook's
 * lead-in — clip 1 starts after the hook, so the words it carries do too.
 * Words outside the kept range are dropped rather than clamped onto the edges,
 * where they would stack up.
 */
function mapToTimeline(project: Project, srcT: number, leadIn: number): number | null {
  const clip = project.clips[0];
  if (!clip) return null;
  if (srcT < clip.in - 0.001 || srcT > clip.out + 0.001) return null;
  return round3(leadIn + (srcT - clip.in) / Math.max(0.1, clip.speed));
}

/** Seconds the hook holds the frame before clip 1 starts. */
export function presetLeadIn(project: Project): number {
  return project.hook && project.hook.enabled ? Math.max(0, project.hook.leadIn) : 0;
}

// ---------------------------------------------------------------------------
// CAPTIONS
// ---------------------------------------------------------------------------

export interface CaptionBuildResult { cues: CaptionCue[]; beats: number[] }

/**
 * Turn word timestamps into cues with MIXED per-word styling. The base style
 * carries the sentence; the strongest word in each cue is promoted to the
 * pack's emphasis style and animation, which is what produces the
 * '...are NOT leaving because of price' treatment.
 *
 * With no word timestamps available the words are distributed evenly across the
 * timeline instead, so captions still work on silent footage.
 */
export function buildCaptions(project: Project, pack: PresetPack, timelineDuration: number): CaptionBuildResult {
  const words = project.transcript.filter((w) => w && typeof w.word === 'string' && w.word.trim());
  const leadIn = presetLeadIn(project);
  const timed: TimedWord[] = [];

  if (words.length) {
    for (const w of words) {
      const s = mapToTimeline(project, w.start, leadIn);
      const e = mapToTimeline(project, Math.max(w.start + 0.08, w.end), leadIn);
      if (s === null) continue;
      timed.push({ text: w.word.trim(), start: s, end: e === null ? s + 0.24 : Math.max(s + 0.08, e) });
    }
  } else if (project.transcriptText.trim()) {
    const tokens = project.transcriptText.trim().split(/\s+/).slice(0, 400);
    const span = Math.max(0.5, timelineDuration - leadIn);
    const per = span / Math.max(1, tokens.length);
    tokens.forEach((text, i) => { timed.push({ text, start: round3(leadIn + i * per), end: round3(leadIn + (i + 1) * per) }); });
  }

  if (!timed.length) return { cues: [], beats: [] };

  // Group into cues: on the word budget, on a long pause, or at a sentence end.
  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (let i = 0; i < timed.length; i++) {
    current.push(timed[i]);
    const next = timed[i + 1];
    const gap = next ? next.start - timed[i].end : 999;
    const full = current.length >= pack.wordsPerCue;
    const sentence = SENTENCE_END.test(timed[i].text);
    if (!next || full || gap > 0.62 || (sentence && current.length >= 2)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);

  const cues: CaptionCue[] = [];
  const beats: number[] = [];
  groups.forEach((group, gi) => {
    let bestIndex = -1;
    let bestScore = 0;
    group.forEach((w, i) => {
      const score = emphasisScore(w.text);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    });
    const cueWords: CaptionWord[] = group.map((w, i) => {
      const emphasised = i === bestIndex && bestScore >= 2;
      return {
        id: uid('w'),
        text: w.text,
        start: w.start,
        end: w.end,
        style: emphasised ? pack.emphasisStyle : pack.baseStyle,
        anim: emphasised ? pack.emphasisAnim : pack.baseAnim,
        shake: emphasised && pack.shakeEmphasis,
        ...(emphasised && pack.emphasisStyle === 'differentColor' ? { color: pack.accent } : {}),
      };
    });
    if (bestIndex >= 0 && bestScore >= 2) beats.push(group[bestIndex].start);

    const start = group[0].start;
    const nextGroup = groups[gi + 1];
    const naturalEnd = group[group.length - 1].end + 0.4;
    const end = Math.min(
      nextGroup ? nextGroup[0].start - 0.02 : timelineDuration,
      naturalEnd,
      timelineDuration,
    );
    cues.push(newCaptionCue(start, Math.max(start + 0.3, end), cueWords, {
      font: pack.captionFont,
      baseSize: pack.captionSize,
      y: pack.captionY,
      widthPct: pack.captionWidthPct,
      outline: pack.captionOutline,
      accent: pack.accent,
      color: '#FFFFFF',
    }));
  });

  return { cues, beats };
}

// ---------------------------------------------------------------------------
// PACING — simulated camera plan
// ---------------------------------------------------------------------------

/**
 * Lay simulated angles across a single talking-head clip. Angles are held for
 * the pack's segment length and every change is eased (see cameraAt in the
 * motion engine), so this reads as one operated camera rather than a cut list.
 * Emphasis beats get a short PunchIn, spaced by the pack's own rule so the
 * footage is never jittery.
 */
export function buildCameraPlan(
  pack: PresetPack,
  contentDuration: number,
  beatsLocal: number[],
  musicBeatsLocal: number[] = [],
): CameraSegment[] {
  const segments: CameraSegment[] = [];
  if (contentDuration < 1.2) return segments;
  const len = Math.max(0.9, pack.segmentLength);
  const nearestMusicBeat = (at: number): number => {
    if (!musicBeatsLocal.length) return at;
    return musicBeatsLocal.reduce((best, beat) => Math.abs(beat - at) < Math.abs(best - at) ? beat : best, musicBeatsLocal[0]);
  };

  // Build the operated-camera boundaries first, then phase-lock every internal
  // change to the music. Keeping the shared boundary means adjacent angles do
  // not leave a gap when a beat sits either side of the unsnapped timestamp.
  const boundaries: number[] = [0];
  for (let at = len; at < contentDuration - 0.4; at += len) {
    const snapped = round3(clamp(nearestMusicBeat(at), boundaries[boundaries.length - 1] + 0.45, contentDuration - 0.4));
    if (snapped - boundaries[boundaries.length - 1] >= 0.45) boundaries.push(snapped);
  }
  boundaries.push(contentDuration);
  for (let i = 0; i < boundaries.length - 1; i++) {
    segments.push({
      id: uid('cam'), angle: pack.camera[i % pack.camera.length],
      start: round3(boundaries[i]), end: round3(boundaries[i + 1]),
    });
  }

  // Speech decides WHICH words deserve a punch-in; music decides the exact
  // frame the impact lands on. With no music grid this is the original speech
  // beat behaviour.
  let lastPunch = -999;
  for (const speechBeat of beatsLocal) {
    const beat = round3(nearestMusicBeat(speechBeat));
    if (beat < 0.5 || beat > contentDuration - 0.8) continue;
    if (beat - lastPunch < pack.punchInEvery) continue;
    lastPunch = beat;
    segments.push({ id: uid('cam'), angle: 'punchIn', start: round3(beat - 0.12), end: round3(Math.min(contentDuration, beat + 1)) });
  }
  return segments.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// MOTION GRAPHICS — one per beat, placed clear of the captions
// ---------------------------------------------------------------------------

const GRAPHIC_SLOTS: { x: number; y: number }[] = [
  { x: Math.round(CANVAS_W * 0.5), y: Math.round(CANVAS_H * 0.3) },
  { x: Math.round(CANVAS_W * 0.34), y: Math.round(CANVAS_H * 0.42) },
  { x: Math.round(CANVAS_W * 0.66), y: Math.round(CANVAS_H * 0.36) },
  { x: Math.round(CANVAS_W * 0.5), y: Math.round(CANVAS_H * 0.48) },
];

export function buildGraphics(pack: PresetPack, beats: number[], timelineDuration: number): GraphicLayer[] {
  const layers: GraphicLayer[] = [];
  const picked = beats.slice(0, 8);
  // With no spoken beats to hang graphics on, place a few on an even rhythm so
  // the preset still shows its graphic language.
  const points = picked.length
    ? picked
    : [0.6, 0.35, 0.68].map((f) => round3(timelineDuration * f)).filter((v) => v > 0.3 && v < timelineDuration - 0.8);

  points.forEach((at, i) => {
    const type = pack.graphics[i % pack.graphics.length];
    const slot = GRAPHIC_SLOTS[i % GRAPHIC_SLOTS.length];
    const start = round3(Math.max(0, at - 0.12));
    const end = round3(Math.min(timelineDuration, start + pack.graphicDuration));
    if (end - start < 0.5) return;
    const g = newGraphic(type, start, end, pack.accent, pack.accent2);
    // Preset graphics use the successor engine's adaptive band. On a flat
    // clip Auto resolves to foreground (the Phase 1 look); once depth is on,
    // a layer that crosses the presenter drops behind the subject cutout.
    g.band = 'auto';
    g.x = slot.x;
    g.y = slot.y;
    g.easing = pack.easing === 'easeInOut' ? 'expoOut' : pack.easing;
    if (type === 'uiCard') { g.x = Math.round(CANVAS_W * 0.5); g.y = Math.round(CANVAS_H * 0.36); g.scale = { from: 0.96, to: 1.02 }; }
    if (type === 'arrow') { g.direction = i % 2 === 0 ? 'right' : 'left'; g.rotation = { from: -8, to: 0 }; }
    if (type === 'label' || type === 'callout') g.text = i % 2 === 0 ? 'Watch this' : 'Here';
    if (type === 'progressBar') { g.fill = 0.55 + (i % 3) * 0.15; g.text = Math.round((0.55 + (i % 3) * 0.15) * 100) + '%'; }
    if (type === 'dots') g.dy = { from: 0, to: -18 };
    // Phase 3 / Phase 4 primitives: these want their own framing.
    if (type === 'statCard') { g.y = Math.round(CANVAS_H * 0.32); g.text = (2 + i) + '.' + ((i * 3) % 9) + 'x|' + (i % 2 === 0 ? 'faster' : 'more replies'); }
    if (type === 'arrowDiagram') { g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.3); g.text = 'Brief|Draft|Ship'; }
    if (type === 'icon') {
      const glyphs = ['bulb', 'bolt', 'target', 'check'] as const;
      g.w = 230;
      g.h = 230;
      g.y = Math.round(CANVAS_H * 0.28);
      g.scale = { from: 0.9, to: 1 };
      g.icon = glyphs[i % glyphs.length];
    }
    if (type === 'browserMockup') { g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.33); g.w = 840; g.h = 530; }
    if (type === 'phoneMockup') { g.w = 420; g.h = 820; g.x = Math.round(CANVAS_W * (i % 2 === 0 ? 0.68 : 0.32)); g.y = Math.round(CANVAS_H * 0.38); }
    if (type === 'gridOverlay') { g.w = CANVAS_W; g.h = CANVAS_H; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H / 2); g.opacity = { from: 0.5, to: 0.26 }; g.start = round3(Math.max(0, at - 0.4)); }
    if (type === 'glow') { g.w = 820; g.h = 820; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.44); g.opacity = { from: 0.55, to: 0.3 }; g.scale = { from: 0.9, to: 1.08 }; }
    // Phase 2 primitives: particles, light and the new UI surfaces.
    if (type === 'confetti') { g.w = 900; g.h = 940; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.42); g.count = 30; g.seed = 7 + i * 11; }
    if (type === 'sparkles') { g.w = 760; g.h = 760; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.36); g.count = 22; g.seed = 13 + i * 7; }
    if (type === 'fireSparks') { g.w = 620; g.h = 880; g.y = Math.round(CANVAS_H * 0.56); g.count = 30; g.seed = 23 + i * 5; }
    if (type === 'speedLines') { g.w = CANVAS_W; g.h = CANVAS_H; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H / 2); g.count = 18; g.seed = 31 + i * 9; g.direction = i % 2 === 0 ? 'right' : 'left'; g.opacity = { from: 0.7, to: 0.3 }; }
    if (type === 'radialBurst') { g.w = 900; g.h = 900; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.4); g.count = 20; g.seed = 41 + i * 3; g.inDur = 0.26; }
    if (type === 'glowRing') { g.w = 620; g.h = 620; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.36); g.thickness = 14; }
    if (type === 'lightStreak') { g.w = CANVAS_W; g.h = 520; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.38); g.opacity = { from: 0.9, to: 0.55 }; }
    if (type === 'featureCard') { g.w = 740; g.h = 290; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.3); g.icon = i % 2 === 0 ? 'bolt' : 'check'; g.text = (i % 2 === 0 ? 'Built in minutes' : 'Captions included') + '|' + (i % 2 === 0 ? 'No editing experience needed' : 'Word-perfect timing'); }
    if (type === 'notification') { g.w = 820; g.h = 220; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.22); g.text = 'New sale|Another order just landed'; }
    if (type === 'cursorClick') { g.w = 520; g.h = 440; g.x = Math.round(CANVAS_W * 0.5); g.y = Math.round(CANVAS_H * 0.42); }
    if (type === 'animatedBorder') { g.w = 820; g.h = 480; g.x = Math.round(CANVAS_W / 2); g.y = Math.round(CANVAS_H * 0.34); g.thickness = 8; }
    // Keep every graphic box fully inside the safe area — unless it is a
    // full-frame layer (a grid, a streak, speed lines), which is MEANT to
    // reach the edges and would otherwise be shoved off centre by the clamp.
    centreOrClamp(g);

    // The original four packs now exercise real per-channel tracks rather than
    // stopping at Phase 1 ramps. These are intentionally restrained: the pack
    // still supplies a useful first cut, while every key remains editable.
    const settle = round3(Math.min(end, start + Math.min(0.58, (end - start) * 0.38)));
    if (g.w < CANVAS_W && g.h < CANVAS_H) {
      if (pack.id === 'clean-saas') {
        g.keys.y = [
          newKeyframe(start, g.y + 28, g.color, 'easeOut'),
          newKeyframe(settle, g.y, g.color, 'easeInOut'),
          newKeyframe(end, g.y, g.color, 'linear'),
        ];
      } else if (pack.id === 'high-energy') {
        g.keys.scaleX = [newKeyframe(start, 0.82, g.color, 'spring'), newKeyframe(settle, 1, g.color, 'easeInOut')];
        g.keys.scaleY = [newKeyframe(start, 0.82, g.color, 'spring'), newKeyframe(settle, 1, g.color, 'easeInOut')];
      } else if (pack.id === 'creator') {
        g.keys.rotation = [newKeyframe(start, -4, g.color, 'easeOut'), newKeyframe(settle, 0, g.color, 'easeInOut')];
      } else if (pack.id === 'educational') {
        g.keys.x = [
          newKeyframe(start, g.x - 24, g.color, 'easeOut'),
          newKeyframe(settle, g.x, g.color, 'easeInOut'),
          newKeyframe(end, g.x, g.color, 'linear'),
        ];
      }
    }
    layers.push(g);
  });
  return layers;
}

/**
 * Keep a layer inside the safe area, or dead centre when it is larger than the
 * safe area in that axis. Clamping a full-frame layer against a margin it can
 * never satisfy would push it off centre instead of leaving it alone.
 */
export function centreOrClamp(g: GraphicLayer): void {
  const minX = Math.round(SAFE_MARGIN + g.w / 2);
  const maxX = Math.round(CANVAS_W - SAFE_MARGIN - g.w / 2);
  const minY = Math.round(SAFE_MARGIN + g.h / 2);
  const maxY = Math.round(CANVAS_H - SAFE_MARGIN - g.h / 2);
  g.x = minX <= maxX ? clamp(g.x, minX, maxX) : Math.round(CANVAS_W / 2);
  g.y = minY <= maxY ? clamp(g.y, minY, maxY) : Math.round(CANVAS_H / 2);
}

// ---------------------------------------------------------------------------
// Applying the pack
// ---------------------------------------------------------------------------

export interface ApplyPresetOptions {
  /** Leave the creator's hand-placed captions / graphics alone. */
  keepCaptions?: boolean;
  keepGraphics?: boolean;
  keepCamera?: boolean;
}

/**
 * Rewrite the designed layers of a project for one preset pack. Clips, source
 * trims, audio and the transcript are never touched — only the design.
 *
 * LOCKS ARE ABSOLUTE HERE. A locked transition, cue, graphic, camera move or
 * clip survives a pack switch untouched, and a freshly generated cue that would
 * land on top of a locked one is dropped rather than stacked. Graphics created
 * by accepting a visual insert are kept too: the creator said yes to those, so
 * a change of pack must not quietly throw them away.
 */
export function applyPreset(project: Project, presetId: PresetId, options: ApplyPresetOptions = {}): Project {
  const pack = presetPack(presetId);
  const next: Project = {
    ...project,
    presetId,
    accent: pack.accent,
    accent2: pack.accent2,
  };

  const leadIn = presetLeadIn(next);
  const contentDurations = next.clips.map((c) => clipContentDuration(c));
  const timelineDuration = leadIn + contentDurations.reduce((a, b) => a + b, 0);

  // TRANSITIONS — one on every cut, cycling through the pack's library.
  const lockedTransitions = next.transitions.filter((t) => t.locked);
  const rebuilt: typeof next.transitions = [];
  for (let i = 0; i < next.clips.length - 1; i++) {
    const afterClipId = next.clips[i].id;
    if (lockedTransitions.some((t) => t.afterClipId === afterClipId)) continue;
    const type = pack.transitions[i % pack.transitions.length];
    const tr = newTransition(afterClipId, type);
    tr.duration = pack.transitionDuration;
    tr.easing = pack.easing;
    tr.direction = i % 2 === 0 ? 'left' : 'right';
    tr.shape = i % 3 === 0 ? 'circle' : i % 3 === 1 ? 'bar' : 'diagonal';
    rebuilt.push(tr);
  }
  next.transitions = [...lockedTransitions, ...rebuilt]
    .sort((a, b) => next.clips.findIndex((c) => c.id === a.afterClipId) - next.clips.findIndex((c) => c.id === b.afterClipId));

  // CAPTIONS + the emphasis beats everything else hangs off.
  const lockedCues = next.captions.filter((c) => c.locked);
  let beats: number[] = [];
  if (options.keepCaptions) {
    beats = next.captions
      .map((c) => {
        const hit = c.words.find((w) => w.style === 'huge' || w.style === 'highlighted' || w.style === 'differentColor');
        return hit ? hit.start : -1;
      })
      .filter((v) => v >= 0);
  } else {
    const built = buildCaptions(next, pack, timelineDuration);
    const fresh = built.cues.filter((cue) => !lockedCues.some((locked) => cue.start < locked.end - 0.02 && locked.start < cue.end - 0.02));
    next.captions = [...lockedCues, ...fresh].sort((a, b) => a.start - b.start);
    beats = built.beats;
  }

  // PACING — camera plan per clip, beats translated into clip-local time.
  // The pack's grade and depth look land here too: they are design decisions,
  // not source edits, so they follow the pack on every unlocked clip.
  let cursor = leadIn;
  next.clips = next.clips.map((clip, i) => {
    const dur = contentDurations[i];
    const localBeats = beats.filter((b) => b >= cursor && b <= cursor + dur).map((b) => round3(b - cursor));
    const musicBeats = next.audio.music && next.audio.music.enabled
      ? next.beats.times.filter((b) => b >= cursor && b <= cursor + dur).map((b) => round3(b - cursor))
      : [];
    cursor += dur;
    if (clip.locked) return clip;
    const lockedMoves = clip.camera.filter((seg) => seg.locked);
    const camera = options.keepCamera
      ? clip.camera
      : [...lockedMoves, ...buildCameraPlan(pack, dur, localBeats, musicBeats).filter(
          (seg) => !lockedMoves.some((locked) => seg.start < locked.end - 0.02 && locked.start < seg.end - 0.02),
        )].sort((a, b) => a.start - b.start);
    return {
      ...clip,
      camera,
      grade: pack.grade,
      subjectFx: { ...clip.subjectFx, ...pack.depth },
      // A pack that wants depth needs a mask to work with; segmentation still
      // has to run before the subject layer has real boxes to follow.
      subject: pack.depth.enabled && clip.subject.mode === 'off'
        ? { ...clip.subject, mode: 'auto' as const }
        : clip.subject,
    };
  });

  // MOTION GRAPHICS — locked layers and accepted inserts are carried over.
  if (!options.keepGraphics) {
    const acceptedIds = new Set(next.inserts.filter((i) => i.status === 'accepted' && i.graphicId).map((i) => i.graphicId as string));
    const kept = next.graphics.filter((g) => g.locked || acceptedIds.has(g.id));
    next.graphics = [...kept, ...buildGraphics(pack, beats, timelineDuration)];
  }

  if (next.audio.music) {
    next.audio.music = {
      ...next.audio.music,
      volume: presetId === 'high-energy' || presetId === 'ugc-ad' ? 0.34 : presetId === 'cinematic' ? 0.2 : 0.24,
    };
  }

  // THE HOOK follows the pack's LOOK only. Its duration and lead-in are left
  // exactly as they are: changing those would move every other layer on the
  // timeline, and a preset switch is a design decision, not a re-time.
  if (next.hook && !next.hook.locked) {
    next.hook = {
      ...next.hook,
      font: pack.captionFont === 'inter' || pack.captionFont === 'dmsans' ? 'anton' : pack.captionFont,
      accent: pack.accent,
      emphasisColor: next.hook.template === 'problem' ? next.hook.emphasisColor : pack.accent,
    };
  }

  return next;
}
