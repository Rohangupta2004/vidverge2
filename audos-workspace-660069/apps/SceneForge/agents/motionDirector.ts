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
//   * how the beat is served by assembly-level Remotion composition
//     choreography, and
//   * spatial zones for every layer (the spatial system then enforces
//     collision- and face-safety and logs any auto-shift).
// A failed or unusable director call NEVER breaks production: the
// deterministic fallbackDirection() derives a directed timeline straight from
// the MotionSpec, so every scene renders with the upgraded motion language.

//
// THE VISUAL BUDGET. The director's one chronic failure is generosity: left to
// itself it layers text + card + glow + arrow + circle onto a four-second beat
// and the viewer has nowhere to look. The rule is now stated in the prompt AND
// enforced after the call — one dominant visual, one supporting layer, a
// re-prompt when the plan breaks it, and a deterministic trim if it still does
// (lib/visualBudget).

import { claudeJson, isTransientAiError } from '../lib/proxy';
import { motionFingerprint, type MotionSpec } from '../lib/motionSpec';
import { auditVisualBudget, budgetConstraintPrompt, enforceVisualBudget, VISUAL_BUDGET_RULE } from '../lib/visualBudget';
import { normalizeSceneDirection, type DirectedLayer, type SceneDirection, type ZoneId } from '../lib/visualTimeline';
import { fallbackElementComposition, normalizeElementComposition, type ElementComposition } from '../lib/elementComposition';

export const DIRECTOR_MODEL = 'claude-opus-5';
const DIRECTOR_TIMEOUT_MS = 90_000;

const DIRECTOR_PERSONA = "You are SceneForge's MOTION DIRECTOR — a highly skilled motion designer directing one scene of a documentary-style explainer. You are the same single model that planned this film; now you direct one scene's motion. You decide hierarchy, purpose, timing, spatial relationships and polish. You never invent copy: every string and number you reference must be copied EXACTLY from the provided spec — paraphrasing or inventing text is a hard failure.";

const DIRECTOR_TASK = `CURRENT TASK: direct one visual scene. Input: the scene's description, narration segment, exact content spec (title, subtitle, items, stat, comparison sides, imageUrl), duration in seconds, aspect ratio, composition mode against the presenter, and the visual kinds of the neighboring scenes. Return the scene's Visual Timeline JSON — the single source of truth that drives the Remotion composition.
PRINCIPLES (hard):
- VISUAL FIRST: the visual carries the story; text explains or reinforces it. If the spec has numbers, a chart or metric is the anchor; if it has structure, a diagram/flowchart/timeline is; if it has an image, an ImageCard/DeviceMockup is. A scene may be text-only ONLY when the spec is genuinely a pure headline or quote — then make the typography itself the visual (KineticHeadline + Glow), never a flat text card.
- HIERARCHY — THE VISUAL BUDGET (HARD): ONE dominant visual + ONE supporting layer. More than two layers is a production error, not a creative choice. Exactly ONE layer carries role "main" with emphasis "dominant", and AT MOST ONE other content layer supports it — visibly secondary: smaller zone, later entrance. A background plate (role "background") and a bottom-safe caption (role "caption") do not count against the budget; EVERYTHING else does, including typography and every callout. Never stack text + card + glow + arrow + circle on one beat: a plan carrying three competing content layers is REJECTED and sent back to you with the count. Every layer carries a one-sentence "purpose" — if you cannot justify a layer, DELETE it rather than shrink it.
- PURPOSEFUL MOTION ONLY (HARD): every entrance, exit and camera move must serve this beat's editorial purpose. Motion that exists because motion is available is clutter with a timeline on it — a still, well-composed beat beats a busy one.
- TIMING: stagger entrances deliberately (main first or a background beat first, supports 0.3-0.8s apart); nothing enters after 60% of the duration; use "exit" only for elements that should leave early. Pacing: "energetic" tightens gaps, "contemplative" spreads them.
- ENTRANCES: choose per role — hero: spring (overshoot) or mask; data: countup/draw; supports: rise or slide_fade; images: mask or blur_in. A bare fade or bare slide does not exist in this vocabulary.
- SPACE: assign zones so layers never collide. 9:16 zones: top (headline), upper (secondary stat), center (dominant visual), lower (supporting/callout), bottom_safe (captions only), left/right (side elements). 16:9: left (text/diagrams/callouts), center (main visual), right (supporting stats), top (headline), bottom_safe (captions). When the presenter stays visible (composition overlay/central), NEVER place anything in the face band — prefer lower/left/right zones.
- CALLOUTS: a Callout/Arrow/Highlight/Pointer/Glow must name targetLayerId of the layer it explains; callouts never overlap each other.
- CAMERA: choose one move (push_in for focus, pull_back for reveals, drift for atmosphere, none only for dense data) with intensity 0.1-0.4 for video_backed_graphic (subtle depth), otherwise 0.5-1.5.
- DEPTH PLANES: assign EVERY layer depth_z from 0.0 (foreground, full camera speed) to 1.0 (background, 20% camera speed). Typography/callouts 0.0-0.1; subject cutouts 0.2-0.35; panels/charts 0.4-0.55; atmosphere 0.65-0.8; fullscreen background footage uses depth_z 1.0. For video_backed_graphic include top-level background_prompt — a 60-120 word, text-free, motion-rich cinematic shot brief with subject, action, camera, depth, lighting, palette and the negative constraints no words/no logos/no watermark.
- RENDERER: use "remotion". Diagrams, charts, kinetic type and presenter cards all render frame-accurately in the server-side assembly; never request a browser capture.
- TRANSITIONS: read prevKind/nextKind and pick transitionIn/transitionOut from: zoom_match_cut (footage<->graphics), spatial_collapse (problem->solution, comparisons), push_through (after a big number), slide_context (narrative forward=right/back=left), layer_reveal (stills, before/after), wipe_directional (footage->footage). Crossfade is allowed only when nothing else fits. Duration 0.3-0.6s.
CONTENT RULE (hard): layer.content carries ONLY strings/numbers copied verbatim from the spec (or omit content entirely to inherit the spec). Include EVERY item the spec lists — never truncate or summarize.
Return STRICT JSON only:
{"duration":number,"renderer":"gsap"|"remotion","camera":{"move":"push_in"|"pull_back"|"drift_left"|"drift_right"|"none","intensity":number},"pacing":"contemplative"|"balanced"|"energetic","ambient":boolean,"background_prompt"?:string,"layers":[{"id":string,"role":"background"|"main"|"support"|"typography"|"callout"|"caption","type":"SmartText"|"KineticHeadline"|"Metric"|"Chart"|"TimelineRail"|"Comparison"|"Callout"|"Arrow"|"Pointer"|"Highlight"|"Glow"|"Diagram"|"FlowChart"|"DeviceMockup"|"BrowserMockup"|"ProductUI"|"ImageCard"|"VideoLayer"|"ProgressIndicator"|"Map"|"Logo"|"Caption","zone":"top"|"upper"|"center"|"lower"|"bottom_safe"|"left"|"right"|"full","zIndex":number,"entrance":{"at":number,"style":"spring"|"rise"|"mask"|"draw"|"pop"|"slide_fade"|"blur_in"|"countup","from"?:"left"|"right"|"top"|"bottom"|"center","overshoot"?:boolean},"exit"?:{"at":number,"style":"settle"|"collapse"|"drift"},"emphasis"?:"dominant"|"supporting","targetLayerId"?:string,"purpose":string,"depth_z"?:number,"content"?:object}],"transitionIn"?:{"type":string,"duration":number,"direction"?:string},"transitionOut"?:{"type":string,"duration":number,"direction"?:string}}`;

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
  const budgeted = await withinVisualBudget(direction, payload, model);
  budgeted.duration = input.durationSec;
  budgeted.spec_fingerprint = motionFingerprint(input.spec);
  return budgeted;
}

/**
 * Hold a plan to the visual budget before it is allowed to render.
 *
 * The director gets ONE chance to fix its own over-layered plan — re-prompted
 * with the concrete count and the rule, because a model told exactly what it
 * broke usually composes something better than a trim would. If the revision is
 * still over budget (or the call fails), `enforceVisualBudget` cuts it down
 * deterministically and records every cut on the direction, so a trimmed scene
 * can explain itself instead of quietly losing elements.
 */
async function withinVisualBudget(direction: SceneDirection, payload: unknown, model: string): Promise<SceneDirection> {
  const verdict = auditVisualBudget(direction);
  if (verdict.ok) return direction;
  try {
    const raw = await claudeJson<unknown>(
      `${DIRECTOR_PERSONA} ${DIRECTOR_TASK}\n\n${budgetConstraintPrompt(verdict)}`,
      { ...(payload && typeof payload === 'object' ? payload : {}), rejected_plan: direction },
      model,
      4096,
      DIRECTOR_TIMEOUT_MS,
    );
    const revised = normalizeSceneDirection(raw);
    if (revised) return auditVisualBudget(revised).ok ? revised : enforceVisualBudget(revised);
  } catch (e) {
    console.warn(`[SceneForge] The visual-budget re-prompt failed, so the over-layered plan is trimmed deterministically. ${VISUAL_BUDGET_RULE}`, e);
  }
  return enforceVisualBudget(direction);
}

// ---------------------------------------------------------------------------
// QA REVISION — the auto-fix half of the visual QA loop. The director gets
// its own timeline back plus the vision inspector's concrete failures and
// returns a REVISED timeline that fixes exactly those issues.
// ---------------------------------------------------------------------------

const REVISE_TASK = `CURRENT TASK: fix one directed scene that FAILED visual QA. Input: the scene's content spec, its current Visual Timeline JSON, and the inspector's concrete issues (overflowing text, collisions, unreadable sizes, covered faces, wrong z-order, mistimed elements, mechanical motion, too many competing layers…). Return the COMPLETE revised Visual Timeline JSON in the same schema — change only what the issues require (move zones apart, shrink or re-zone colliding layers, retime entrances, drop a cluttering layer, raise contrast by moving text onto panel zones), keep everything that passed, and never change the text/numbers themselves. The visual budget still applies to your revision: ${VISUAL_BUDGET_RULE} A COMPLEXITY_VIOLATION issue is fixed by DELETING layers, never by making them smaller.`;

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
  // A revision that answers one QA issue by adding two more layers is not a fix.
  const budgeted = enforceVisualBudget(revised);
  budgeted.duration = input.durationSec;
  budgeted.spec_fingerprint = motionFingerprint(input.spec);
  return budgeted;
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
    layers.push({ id: 'backdrop', role: 'background', type: 'ImageCard', zone: 'full', zIndex: 0, depth_z: 1, entrance: { at: 0, style: 'blur_in' }, purpose: 'Contextual atmosphere behind the graphic.', content: { imageUrl: spec.imageUrl } });
  }
  // The ONE supporting layer the budget allows: typography naming what the
  // viewer is about to look at. Explicitly 'supporting' so the budget audit and
  // the renderer agree about which layer is secondary.
  if (!headerless && spec.title) {
    layers.push({ id: 'headline', role: 'typography', type: 'KineticHeadline', zone: 'top', zIndex: 3, depth_z: 0.05, emphasis: 'supporting', entrance: { at: 0.15, style: 'spring', overshoot: true }, purpose: 'Names what the viewer is looking at before the data lands.', content: { text: spec.title, ...(spec.subtitle ? { subtext: spec.subtitle } : {}) } });
  }
  layers.push({
    id: 'main', role: 'main', type: mainType, zone: headerless ? 'center' : (portrait ? 'center' : 'center'), zIndex: 2,
    emphasis: 'dominant', depth_z: mainType === 'ImageCard' ? 0.3 : 0.45,
    entrance: { at: headerless ? 0.2 : 0.55, style: mainType === 'Metric' ? 'countup' : mainType === 'Chart' || mainType === 'TimelineRail' || mainType === 'Diagram' || mainType === 'FlowChart' ? 'draw' : mainType === 'ImageCard' ? 'mask' : 'spring', overshoot: true },
    purpose: 'The dominant visual carrying this beat.',
  });
  // The deterministic fallback is built to the budget, but it is passed through
  // the same enforcement so there is exactly one definition of "in budget" in
  // the pipeline rather than two that can drift apart.
  return enforceVisualBudget({
    version: 1,
    duration: Math.min(20, Math.max(2.5, durationSec)),
    renderer: 'remotion',
    camera: { move: 'push_in', intensity: 0.8 },
    pacing: 'balanced',
    ambient: true,
    layers,
    spec_fingerprint: motionFingerprint(spec),
  });
}

// ---------------------------------------------------------------------------
// STRUCTURED ELEMENT COMPOSER — video_backed_graphic scenes never collapse
// their infographic into one baked clip. The same Director converts the exact
// MotionSpec + Visual Timeline into independently animated composition layers;
// Remotion then renders those layers above the generated footage.
// ---------------------------------------------------------------------------

const ELEMENT_COMPOSER_TASK = `CURRENT TASK: convert one directed video-backed documentary scene into an ElementComposition. The background footage is rendered separately, so return ONLY the independently animated infographic layers above it. Copy every string and number exactly from spec/direction; never invent copy. Use 2-8 purposeful elements and one focus element. Every element needs x/y/w/z, depth_z (0 foreground to 1 background), start/end, anchor, enter and exit. Keep z between 1 and 4. Use text/stat/card/pill/arrow/line/underline/highlight/chart/progress; do not return image elements because no isolated image asset is generated in this path. Depth defaults: typography/callouts 0.0-0.1, subject/data 0.25-0.45, panels 0.55-0.7. Stagger entrances, preserve safe margins, and keep background visible. Return strict JSON only: {"version":1,"type":"multi_element","duration":number,"background":"transparent","camera":{"move":"none"|"push_in"|"pull_back"|"drift_left"|"drift_right","intensity":number},"elements":[{"id":string,"kind":"text"|"stat"|"card"|"pill"|"arrow"|"line"|"underline"|"highlight"|"chart"|"progress","x":number,"y":number,"w":number,"h"?:number,"z":1|2|3|4,"depth_z":number,"start":number,"end":number,"anchor":"center"|"top_left"|"top_right"|"bottom_left"|"bottom_right"|"top"|"bottom"|"left"|"right","enter":{"style":"fade"|"slide_up"|"slide_down"|"slide_left"|"slide_right"|"scale_in"|"spring_in"|"mask_reveal"|"wipe"|"draw"|"blur_in"|"pop"|"countup"|"none","duration":number},"exit":{"style":"fade"|"slide_up"|"slide_down"|"scale_out"|"drift"|"none","duration":number},"text"?:string,"subtext"?:string,"variant"?:"headline"|"subhead"|"label"|"stat"|"caption","value"?:number,"prefix"?:string,"suffix"?:string,"items"?:array,"tx"?:number,"ty"?:number,"accent"?:string,"bg"?:string,"focus"?:boolean}]}.`;

export async function directElementComposition(input: {
  spec: MotionSpec;
  direction: SceneDirection;
  durationSec: number;
  aspect: '16:9' | '9:16';
  backgroundPrompt: string;
}, model = DIRECTOR_MODEL): Promise<ElementComposition> {
  try {
    const raw = await claudeJson<unknown>(`${DIRECTOR_PERSONA} ${ELEMENT_COMPOSER_TASK}`, {
      spec: input.spec,
      direction: input.direction,
      duration_sec: input.durationSec,
      aspect: input.aspect,
      background_prompt: input.backgroundPrompt,
    }, model, 4096, DIRECTOR_TIMEOUT_MS);
    const composition = normalizeElementComposition(raw);
    if (composition) {
      composition.duration = input.durationSec;
      composition.background = 'transparent';
      composition.camera = input.direction.camera;
      composition.spec_fingerprint = motionFingerprint(input.spec);
      return composition;
    }
  } catch (error) {
    console.warn('[SceneForge] Element composition direction failed — using the deterministic composition.', error);
  }
  const fallback = fallbackElementComposition(input.spec, input.durationSec);
  fallback.background = 'transparent';
  fallback.camera = input.direction.camera;
  fallback.elements = fallback.elements.map((element, index) => ({
    ...element,
    z: Math.min(4, Math.max(1, element.z > 4 ? Math.ceil(((index + 1) / fallback.elements.length) * 4) : element.z)),
    depth_z: element.depth_z ?? (element.kind === 'text' || element.kind === 'stat' || element.kind === 'underline' ? 0.08 : element.kind === 'card' ? 0.65 : 0.4),
  }));
  return fallback;
}
