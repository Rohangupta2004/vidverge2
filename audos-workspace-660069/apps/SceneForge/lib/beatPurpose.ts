// EDITORIAL BEAT PURPOSE — what a scene is FOR, and how the presenter carries it.
//
// The orchestrator already decides a `scene_type` per scene and an editorial
// `treatment` (lib/directorPlan), but neither of those ever reached the avatar:
// every HeyGen render was submitted with the same neutral delivery, so the hook
// and the transition were performed identically. An AI presenter that gestures
// the same way through a whole film is the single thing a viewer notices, so
// this module resolves the beat's PURPOSE — once, deterministically — and turns
// it into the gesture/expression direction each render carries.
//
// THE MAPPING IS THE POINT. A hook and a CTA are expressive, an explanation and
// a proof are measured, an emotional beat is open, and a transition is
// deliberately still because the VISUAL carries that beat. Nothing here is a
// single hardcoded gesture: the purpose is derived per scene and the fields
// change with it.
//
// WHY THE FIELDS ARE SENT OPTIMISTICALLY AND THE VERDICT REMEMBERED.
// `POST v3/videos` rejects every unknown field with a 400, and HeyGen documents
// the gesture controls for some engines and plans but not all. So a render is
// submitted WITH the gesture fields, and a 400 that names one of them retries
// once WITHOUT them and records the verdict for this browser — the same shape as
// the Video Agent's mode negotiation in lib/heygenAgent. No render is ever lost
// to a field HeyGen will not take, and an account that does take them gets the
// performance on every beat.

import type { Scene } from './supabase';

export type BeatPurpose = 'hook' | 'explanation' | 'proof' | 'emotion' | 'cta' | 'transition';

export const BEAT_PURPOSES: BeatPurpose[] = ['hook', 'explanation', 'proof', 'emotion', 'cta', 'transition'];

/** How much the presenter moves. 'minimal' is a decision, not an absence. */
export type GestureIntensity = 'expressive' | 'moderate' | 'minimal';

export interface GestureDirection {
  purpose: BeatPurpose;
  intensity: GestureIntensity;
  /** HeyGen's `gesture_control` scale. */
  gestureControl: 'high' | 'medium' | 'low';
  /** HeyGen's `expression` value. */
  expression: 'energetic' | 'confident' | 'explanatory' | 'serious' | 'empathetic' | 'neutral';
  /** Posture hint — HeyGen's `pose`, and the wording the Video Agent brief carries. */
  pose: 'open' | 'forward_lean' | 'measured' | 'pointing' | 'open_hands' | 'neutral';
  /** One sentence a panel can show and a text brief can carry verbatim. */
  note: string;
}

/**
 * Gesture intensity per editorial purpose. This table IS the feature — every
 * call site reads it rather than choosing its own delivery, so the hook in the
 * Avatar Studio and the hook in the HeyGen Suite are performed the same way.
 */
export const GESTURE_BY_PURPOSE: Record<BeatPurpose, GestureDirection> = {
  hook: {
    purpose: 'hook',
    intensity: 'expressive',
    gestureControl: 'high',
    expression: 'energetic',
    pose: 'open',
    note: 'High energy and an open posture \u2014 the hook has to earn the next five seconds.',
  },
  cta: {
    purpose: 'cta',
    intensity: 'expressive',
    gestureControl: 'high',
    expression: 'confident',
    pose: 'forward_lean',
    note: 'A forward lean and one emphasis gesture \u2014 the ask is delivered, not mumbled.',
  },
  explanation: {
    purpose: 'explanation',
    intensity: 'moderate',
    gestureControl: 'medium',
    expression: 'explanatory',
    pose: 'measured',
    note: 'Measured, illustrative gestures that follow the shape of the explanation.',
  },
  proof: {
    purpose: 'proof',
    intensity: 'moderate',
    gestureControl: 'medium',
    expression: 'serious',
    pose: 'pointing',
    note: 'A pointing / reference gesture, so the evidence is pointed AT rather than talked over.',
  },
  emotion: {
    purpose: 'emotion',
    intensity: 'expressive',
    gestureControl: 'high',
    expression: 'empathetic',
    pose: 'open_hands',
    note: 'Empathy and open hands \u2014 this beat is felt rather than argued.',
  },
  transition: {
    purpose: 'transition',
    intensity: 'minimal',
    gestureControl: 'low',
    expression: 'neutral',
    pose: 'neutral',
    note: 'Neutral and still: the visual carries this beat, so the presenter gets out of its way.',
  },
};

// The orchestrator writes `scene_type` as free text, so the vocabulary is read
// rather than enumerated. Order matters: the first pattern that matches wins,
// and the most specific editorial words lead.
const PURPOSE_WORDS: { purpose: BeatPurpose; pattern: RegExp }[] = [
  { purpose: 'cta', pattern: /(\bcta\b|call[_\s-]?to[_\s-]?action|sign[_\s-]?up|free[_\s-]?trial|\boffer\b|\bclosing\b|\bcloser\b|\boutro\b|\bconclusion\b)/i },
  { purpose: 'hook', pattern: /(\bhook\b|cold[_\s-]?open|\bopening\b|\bopener\b|\bintro\b|\bteaser\b|\battention\b)/i },
  { purpose: 'proof', pattern: /(\bproof\b|\bevidence\b|\bdata\b|\bstat\b|\bstatistic|\bmetric|\bnumber|\bresult|case[_\s-]?study|\btestimonial\b|\bquote\b|\bcitation\b|\bsource\b|\bchart\b|\bbenchmark\b|\bcomparison\b)/i },
  { purpose: 'emotion', pattern: /(\bemotion|\bstory\b|\banecdote\b|\bempathy\b|\bpain\b|\bfrustration\b|\brelief\b|\bhuman\b|\bfeel\b)/i },
  { purpose: 'transition', pattern: /(\btransition\b|\bbridge\b|\bsegue\b|\binterstitial\b|\bpivot\b|\bchapter\b|\bdivider\b|title[_\s-]?card)/i },
  { purpose: 'explanation', pattern: /(\bexplain|\bexplanation\b|\bexplainer\b|how[_\s-]?it[_\s-]?works|\bprocess\b|\bmechanism\b|\bdetail|\bbody\b|\bfeature|\bdemo\b|\bwalkthrough\b|\bcontext\b|\bbackground\b)/i },
];

/** Read a purpose off any string the plan or a stored row might carry. */
export function normalizeBeatPurpose(raw: unknown): BeatPurpose | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  const exact = value.replace(/[\s-]+/g, '_');
  if ((BEAT_PURPOSES as string[]).includes(exact)) return exact as BeatPurpose;
  const matched = PURPOSE_WORDS.find((entry) => entry.pattern.test(value));
  return matched ? matched.purpose : null;
}

// What a motion-graphic layout implies about the beat when nothing more
// explicit is available: exact figures and A-vs-B are evidence, structure is
// explanation, a pure headline between sections is a transition.
const SPEC_PURPOSE: Record<string, BeatPurpose> = {
  big_stat: 'proof',
  bar_chart: 'proof',
  comparison: 'proof',
  annotated_image: 'proof',
  timeline: 'explanation',
  flowchart: 'explanation',
  branching_diagram: 'explanation',
  node_graph: 'explanation',
  list_reveal: 'explanation',
  text_reveal: 'transition',
};

export interface BeatContext {
  /** 0-based position among the scenes that make up the film. */
  index?: number;
  total?: number;
  /** MotionSpec.kind when the beat is a motion graphic. */
  specKind?: string | null;
  visualKind?: string | null;
  /** Narration or description — consulted only when nothing explicit exists. */
  text?: string;
}

/**
 * The purpose THIS beat serves, in order of authority: an explicit purpose on
 * the row, the orchestrator's `scene_type`, the film's own shape (first beat
 * hooks, last beat asks), the motion-graphic layout, then the words themselves.
 * Falls back to 'explanation' — the one purpose that is never wrong for a
 * middle beat.
 */
export function beatPurposeOf(scene: Partial<Scene> | null | undefined, context: BeatContext = {}): BeatPurpose {
  const explicit = normalizeBeatPurpose((scene as any)?.beat_purpose);
  if (explicit) return explicit;

  const fromType = normalizeBeatPurpose(scene?.scene_type);
  if (fromType) return fromType;

  const index = Number(context.index);
  const total = Number(context.total);
  if (Number.isFinite(index) && Number.isFinite(total) && total > 1) {
    if (index === 0) return 'hook';
    if (index === total - 1) return 'cta';
  }

  const specKind = String(context.specKind || (scene?.spec as any)?.kind || '').trim();
  if (specKind && SPEC_PURPOSE[specKind]) return SPEC_PURPOSE[specKind];

  const fromWords = normalizeBeatPurpose(context.text || scene?.description || '');
  if (fromWords) return fromWords;

  return 'explanation';
}

export function gestureFor(purpose: BeatPurpose): GestureDirection {
  return GESTURE_BY_PURPOSE[purpose] || GESTURE_BY_PURPOSE.explanation;
}

/** The gesture direction for one scene, resolved from its editorial purpose. */
export function gestureForScene(scene: Partial<Scene> | null | undefined, context: BeatContext = {}): GestureDirection {
  return gestureFor(beatPurposeOf(scene, context));
}

// ——— Negotiating the fields with HeyGen ———

const GESTURE_FIELD_KEY = 'sceneforge_heygen_gesture_fields_v1';

/** False once HeyGen has rejected the gesture fields on this account. */
export function gestureFieldsSupported(): boolean {
  try { return window.localStorage.getItem(GESTURE_FIELD_KEY) !== 'no'; } catch { return true; }
}

export function rememberGestureFieldSupport(supported: boolean) {
  try { window.localStorage.setItem(GESTURE_FIELD_KEY, supported ? 'yes' : 'no'); } catch { /* private mode — this session still honours it */ }
}

/** Forget the verdict, so a plan or engine change is picked up on the next render. */
export function resetGestureFieldSupport() {
  try { window.localStorage.removeItem(GESTURE_FIELD_KEY); } catch { /* ignore */ }
}

/**
 * True when a rejection is HeyGen saying "I do not take these fields" rather
 * than "this request was wrong". Only a 400/422 that NAMES one of the fields
 * (or complains about extra inputs) counts — anything else is a real bug and
 * must keep surfacing as one.
 */
export function isGestureFieldRejection(error: unknown): boolean {
  const status = Number((error as any)?.status) || 0;
  if (status !== 400 && status !== 422) return false;
  return /gesture|expression|\bpose\b|extra\s+inputs|unknown\s+field|unexpected\s+(?:field|key)|not\s+permitted/i
    .test(String((error as any)?.message || ''));
}

/**
 * The request fragment carrying this beat's delivery. Empty once the account
 * has refused the fields, so a caller can spread it unconditionally.
 */
export function gesturePayload(direction: GestureDirection | null | undefined): Record<string, string> {
  if (!direction || !gestureFieldsSupported()) return {};
  return {
    gesture_control: direction.gestureControl,
    expression: direction.expression,
    pose: direction.pose,
  };
}

/**
 * The same direction as PROSE, for an endpoint that takes a brief rather than
 * structured fields (the Video Agent). Always safe to send — it is just words.
 */
export function gestureBriefLine(direction: GestureDirection): string {
  return `Presenter delivery (${direction.purpose} beat, ${direction.intensity}): ${direction.note}`;
}

/**
 * Submit a request that WANTS the gesture fields.
 *
 * `send(withGesture)` is called with the fields first; a rejection that names
 * one of them retries once without, and the verdict is remembered so the next
 * render goes straight to the shape this account accepts.
 */
export async function withGestureFallback<T>(send: (withGesture: boolean) => Promise<T>): Promise<T> {
  const wanted = gestureFieldsSupported();
  try {
    const result = await send(wanted);
    if (wanted) rememberGestureFieldSupport(true);
    return result;
  } catch (e) {
    if (!wanted || !isGestureFieldRejection(e)) throw e;
    rememberGestureFieldSupport(false);
    console.warn('[SceneForge] HeyGen refused the per-beat gesture fields on this account \u2014 resubmitting without them. Delivery will be HeyGen\u2019s default from here.', e);
    return send(false);
  }
}
