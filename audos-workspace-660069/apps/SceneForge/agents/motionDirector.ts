// MOTION DIRECTOR — the Opus 5 pass that turns one planned scene into a
// structured Visual Timeline JSON (lib/visualTimeline). This is the SAME
// single model the orchestrator runs (claude-opus-5) doing one more task in
// the pipeline: it never writes new copy — the MotionSpec stays the exact
// text source — it decides HIERARCHY, TIMING, SPACE and POLISH:
//   * what the viewer must see, and which layer is dominant,
//   * entrance/exit timing per layer, camera move, pacing,
//   * typography treatment (kinetic vs static),
//   * how the scene transitions in and out (content-aware, no default
//     crossfades),
//   * whether the beat is served by a baked GSAP capture or by assembly-level
//     Remotion composition choreography, and
//   * spatial zones for every layer (the spatial system then enforces
//     collision- and face-safety and logs any auto-shift).
// A failed or unusable director call NEVER breaks production: the
// deterministic fallbackDirection() derives a directed timeline straight from
// the MotionSpec, so every scene renders with the upgraded motion language.

import { claudeJson, isTransientAiError } from '../lib/proxy';
import { motionFingerprint, type MotionSpec } from '../lib/motionSpec';
import { normalizeSceneDirection, type DirectedLayer, type SceneDirection, type ZoneId } from '../lib/visualTimeline';

export const DIRECTOR_MODEL = 'claude-opus-5';
const DIRECTOR_TIMEOUT_MS = 90_000;

const DIRECTOR_PERSONA = "You are SceneForge's MOTION DIRECTOR — a highly skilled motion designer directing one scene of a documentary-style explainer. You are the same single model that planned this film; now you direct one scene's motion. You decide hierarchy, purpose, timing, spatial relationships and polish. You never invent copy: every string and number you reference must be copied EXACTLY from the provided spec — paraphrasing or inventing text is a hard failure.";

const DIRECTOR_TASK = `CURRENT TASK: direct one visual scene. Input: the scene's description, narration segment, exact content spec (title, subtitle, items, stat, comparison sides, imageUrl), duration in seconds, aspect ratio, composition mode against the presenter, and the visual kinds of the neighboring scenes. Return the scene's Visual Timeline JSON — the single source of truth that drives the GSAP animation layer and the Remotion composition.
PRINCIPLES (hard):
- VISUAL FIRST: the visual carries the story; text explains or reinforces it. If the spec has numbers, a chart or metric is the anchor; if it has structure, a diagram/flowchart/timeline is; if it has an image, an ImageCard/DeviceMockup is. A scene may be text-only ONLY when the spec is genuinely a pure headline or quote — then make the typography itself the visual (KineticHeadline + Glow), never a flat text card.
- HIERARCHY: exactly ONE layer has role "main" (emphasis "dominant"). Supporting layers are visibly secondary (smaller zones, later entrances). Every layer carries a one-sentence "purpose" — if you cannot justify a layer, omit it; fewer, purposeful layers beat clutter.
- TIMING: stagger entrances deliberately (main first or a background beat first, supports 0.3-0.8s apart); nothing enters after 60% of the duration; use "exit" only for elements that should leave early. Pacing: "energetic" tightens gaps, "contemplative" spreads them.
- ENTRANCES: choose per role — hero: spring (overshoot) or mask; data: countup/draw; supports: rise or slide_fade; images: mask or blur_in. A bare fade or bare slide does not exist in this vocabulary.
- SPACE: assign zones so layers never collide. 9:16 zones: top (headline), upper (secondary stat), center (dominant visual), lower (supporting/callout), bottom_safe (captions only), left/right (side elements). 16:9: left (text/diagrams/callouts), center (main visual), right (supporting stats), top (headline), bottom_safe (captions). When the presenter stays visible (composition overlay/central), NEVER place anything in the face band — prefer lower/left/right zones.
- CALLOUTS: a Callout/Arrow/Highlight/Pointer/Glow must name targetLayerId of the layer it explains; callouts never overlap each other.
- CAMERA: choose one move (push_in for focus, pull_back for reveals, drift for atmosphere, none only for dense data) with intensity 0.5-1.5.
- RENDERER: "gsap" for scenes whose life is inside the graphic (diagrams, charts, kinetic type); "remotion" for scenes that live as composited cards over the presenter where assembly-level frame-accurate choreography matters most.
- TRANSITIONS: read prevKind/nextKind and pick transitionIn/transitionOut from: zoom_match_cut (footage<->graphics), spatial_collapse (problem->solution, comparisons), push_through (after a big number), slide_context (narrative forward=right/back=left), layer_reveal (stills, before/after), wipe_directional (footage->footage). Crossfade is allowed only when nothing else fits. Duration 0.3-0.6s.
CONTENT RULE (hard): layer.content carries ONLY strings/numbers copied verbatim from the spec (or omit content entirely to inherit the spec). Include EVERY item the spec lists — never truncate or summarize.
Return STRICT JSON only:
{"duration":number,"renderer":"gsap"|"remotion","camera":{"move":"push_in"|"pull_back"|"drift_left"|"drift_right"|"none","intensity":number},"pacing":"contemplative"|"balanced"|"energetic","ambient":boolean,"layers":[{"id":string,"role":"background"|"main"|"support"|"typography"|"callout"|"caption","type":"SmartText"|"KineticHeadline"|"Metric"|"Chart"|"TimelineRail"|"Comparison"|"Callout"|"Arrow"|"Pointer"|"Highlight"|"Glow"|"Diagram"|"FlowChart"|"DeviceMockup"|"BrowserMockup"|"ProductUI"|"ImageCard"|"VideoLayer"|"ProgressIndicator"|"Map"|"Logo"|"Caption","zone":"top"|"upper"|"center"|"lower"|"bottom_safe"|"left"|"right"|"full","zIndex":number,"entrance":{"at":number,"style":"spring"|"rise"|"mask"|"draw"|"pop"|"slide_fade"|"blur_in"|"countup","from"?:"left"|"right"|"top"|"bottom"|"center","overshoot"?:boolean},"exit"?:{"at":number,"style":"settle"|"collapse"|"drift"},"emphasis"?:"dominant"|"supporting","targetLayerId"?:string,"purpose":string,"content"?:object}],"transitionIn"?:{"type":string,"duration":number,"direction"?:string},"transitionOut"?:{"type":string,"duration":number,"direction"?:string}}`;

export interface DirectorSceneInput {
  description: string;
  narrationSegment?: string;
  motionNotes?: string;
  visualKind: string;
  spec: MotionSpec;
  durationSec: number;
  aspect: '16:9' | '9:16';
  compositionMode?: string | null;
  prevKind?: string | null;
  nextKind?: string | null;
}

/**
 * Ask Opus for the scene's Visual Timeline. One automatic retry covers a
 * transient failure; anything else falls through to fallbackDirection so the
 * pipeline keeps moving with a deterministic, still-directed timeline.
 */
export async function directScene(input: DirectorSceneInput, model = DIRECTOR_MODEL): Promise<SceneDirection> {
  const payload = {
    description: input.description,
    narration_segment: input.narrationSegment || '',
    motion_notes: input.motionNotes || '',
    visual_kind: input.visualKind,
    spec: input.spec,
    duration_sec: input.durationSec,
    aspect: input.aspect,
    composition_mode: input.compositionMode || 'fullscreen',
    prevKind: input.prevKind || 'heygen',
    nextKind: input.nextKind || 'heygen',
  };
  let raw: unknown;
  try {
    raw = await claudeJson<unknown>(`${DIRECTOR_PERSONA} ${DIRECTOR_TASK}`, payload, model, 4096, DIRECTOR_TIMEOUT_MS);
  } catch (firstError) {
    if (!isTransientAiError(firstError)) throw firstError;
    raw = await claudeJson<unknown>(`${DIRECTOR_PERSONA} ${DIRECTOR_TASK}`, payload, model, 4096, DIRECTOR_TIMEOUT_MS);
  }
  const direction = normalizeSceneDirection(raw);
  if (!direction) throw new Error('The motion director returned no usable layers.');
  direction.duration = input.durationSec;
  direction.spec_fingerprint = motionFingerprint(input.spec);
  return direction;
}

// ---------------------------------------------------------------------------
// QA REVISION — the auto-fix half of the visual QA loop. The director gets
// its own timeline back plus the vision inspector's concrete failures and
// returns a REVISED timeline that fixes exactly those issues.
// ---------------------------------------------------------------------------

const REVISE_TASK = `CURRENT TASK: fix one directed scene that FAILED visual QA. Input: the scene's content spec, its current Visual Timeline JSON, and the inspector's concrete issues (overflowing text, collisions, unreadable sizes, covered faces, wrong z-order, mistimed elements, mechanical motion…). Return the COMPLETE revised Visual Timeline JSON in the same schema — change only what the issues require (move zones apart, shrink or re-zone colliding layers, retime entrances, drop a cluttering layer, raise contrast by moving text onto panel zones), keep everything that passed, and never change the text/numbers themselves.`;

export async function reviseSceneDirection(input: { spec: MotionSpec; direction: SceneDirection; issues: { code: string; severity: string; detail: string }[]; aspect: '16:9' | '9:16'; durationSec: number }, model = DIRECTOR_MODEL): Promise<SceneDirection> {
  const raw = await claudeJson<unknown>(`${DIRECTOR_PERSONA} ${REVISE_TASK}`, {
    spec: input.spec,
    current_timeline: input.direction,
    qa_issues: input.issues,
    aspect: input.aspect,
    duration_sec: input.durationSec,
  }, model, 4096, DIRECTOR_TIMEOUT_MS);
  const revised = normalizeSceneDirection(raw);
  if (!revised) throw new Error('The motion director returned no usable revision.');
  revised.duration = input.durationSec;
  revised.spec_fingerprint = motionFingerprint(input.spec);
  return revised;
}

// ---------------------------------------------------------------------------
// DETERMINISTIC FALLBACK — a directed timeline derived straight from the
// MotionSpec. Used when the director call fails, so the upgraded motion
// language (springs, staggers, camera, ambient life) still applies.
// ---------------------------------------------------------------------------

const KIND_PRIMITIVE: Record<string, DirectedLayer['type']> = {
  bar_chart: 'Chart',
  big_stat: 'Metric',
  timeline: 'TimelineRail',
  comparison: 'Comparison',
  branching_diagram: 'Diagram',
  node_graph: 'Diagram',
  flowchart: 'FlowChart',
  list_reveal: 'FlowChart',
  annotated_image: 'ImageCard',
  text_reveal: 'KineticHeadline',
};

export function fallbackDirection(spec: MotionSpec, durationSec: number, aspect: '16:9' | '9:16'): SceneDirection {
  const portrait = aspect === '9:16';
  const mainType = KIND_PRIMITIVE[spec.kind] || 'SmartText';
  const headerless = spec.kind === 'text_reveal' || spec.kind === 'big_stat';
  const layers: DirectedLayer[] = [];
  if (spec.imageUrl && spec.kind !== 'annotated_image') {
    layers.push({ id: 'backdrop', role: 'background', type: 'ImageCard', zone: 'full', zIndex: 0, entrance: { at: 0, style: 'blur_in' }, purpose: 'Contextual atmosphere behind the graphic.', content: { imageUrl: spec.imageUrl } });
  }
  if (!headerless && spec.title) {
    layers.push({ id: 'headline', role: 'typography', type: 'KineticHeadline', zone: 'top', zIndex: 3, entrance: { at: 0.15, style: 'spring', overshoot: true }, purpose: 'Names what the viewer is looking at before the data lands.', content: { text: spec.title, ...(spec.subtitle ? { subtext: spec.subtitle } : {}) } });
  }
  layers.push({
    id: 'main', role: 'main', type: mainType, zone: headerless ? 'center' : (portrait ? 'center' : 'center'), zIndex: 2,
    emphasis: 'dominant',
    entrance: { at: headerless ? 0.2 : 0.55, style: mainType === 'Metric' ? 'countup' : mainType === 'Chart' || mainType === 'TimelineRail' || mainType === 'Diagram' || mainType === 'FlowChart' ? 'draw' : mainType === 'ImageCard' ? 'mask' : 'spring', overshoot: true },
    purpose: 'The dominant visual carrying this beat.',
  });
  return {
    version: 1,
    duration: Math.min(20, Math.max(2.5, durationSec)),
    renderer: 'gsap',
    camera: { move: 'push_in', intensity: 0.8 },
    pacing: 'balanced',
    ambient: true,
    layers,
    spec_fingerprint: motionFingerprint(spec),
  };
}
