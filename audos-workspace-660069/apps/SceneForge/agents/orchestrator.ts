import { claudeJson, isTransientAiError } from '../lib/proxy';
import type { WordTimestamp } from '../lib/supabase';
import { normalizeMotionSpec } from '../lib/motionSpec';
import { normalizeComposition } from '../lib/effects';
import { getEditingPreset } from '../styles/registry';

/**
 * THE SINGLE LLM. SceneForge runs on exactly ONE language model, and this
 * module is the only place in the app that talks to it. Across the pipeline
 * the same model:
 *   1. researches and writes the full scene-by-scene script (plus one image
 *      brief per beat, so the writer decides both the words and the pictures),
 *   2. plans the scene manifest against the avatar's word timestamps —
 *      writing every image-generation prompt, every AI-video prompt, the
 *      Remotion scene data for text/graphics scenes (text, asset use, preset
 *      effect, timing) and every text-overlay spec (copy, position, timing,
 *      animation), and
 *   3. routes plain-language change requests from the Verger panel.
 *
 * Everything downstream is a TOOL that executes what this LLM specified: the
 * image model (lib/imageTool) draws the prompts it wrote, the video model
 * (lib/videoTool) films the prompts it wrote, and the Remotion assembly
 * composition (remotion/AssemblyComp) deterministically composes the scene
 * data and overlays it returned. None of those tools makes a creative
 * decision, and no second LLM exists anywhere in this app — there is no
 * separate script model, scene-decider model, coding model or router model.
 * The MOTION DIRECTOR (agents/motionDirector) and the VISUAL QA inspector
 * (lib/visualQa) are additional TASKS run on this same single model
 * (claude-opus-5): per-scene motion direction and rendered-frame review —
 * not other models.
 */
export const DEFAULT_LLM_MODEL = 'claude-opus-5';

// One persona shared by every call, so the model always knows it is the sole
// orchestrator driving tools rather than one specialist among many.
const ORCHESTRATOR_PERSONA = "You are SceneForge's orchestrator — the single LLM behind the entire pipeline. You write the script, decide every supporting scene, write every image-generation prompt and every video-generation prompt, produce the Remotion scene data for text/graphics scenes, and specify every text overlay. The image model, the video model and the Remotion compositor are tools that execute exactly what you return; they make no creative decisions and no other language model exists in this product.";

// ---------------------------------------------------------------------------
// Task 1 — script + per-beat image briefs (the seed of the scene manifest).
// ---------------------------------------------------------------------------

export interface SceneImageBrief { scene: number; brief: string }
export interface ScriptResult { script: string; sources: string[]; estimated_duration_sec: number; scene_image_briefs: SceneImageBrief[] }

export const SCRIPT_TASK = [
  'CURRENT TASK: deep research and scriptwriting. Given a topic, audience, language and target length, research deeply: establish facts, dates, narrative context, comparisons and surprising angles.',
  'Write only words a human presenter would naturally speak. Use plain paragraphs with natural paragraph breaks: no stage directions, markdown headings, lists or production notes.',
  'Aim for 130 spoken words per minute; use 110 words per minute for Hindi or Hinglish. End with a strong call to action or memorable final line.',
  'During drafting, place citations in an internal sources block after the script so they are never spoken; then move those URLs into the JSON sources array and omit the block from the final script value.',
  'You must ALSO return scene_image_briefs: one entry per beat of the script, in script order, each naming the single supporting image that beat needs (subject, setting, framing, light and mood) with no on-screen words, no lettering and no watermark. You will turn these same briefs into final image prompts during scene planning.',
  'Return strict JSON only: {"script":string,"sources":string[],"estimated_duration_sec":number,"scene_image_briefs":[{"scene":number,"brief":string}]}.',
].join(' ');

export async function writeScript(input: { topic: string; audience?: string; language: string; targetLengthSec: number; direction?: string }, model = DEFAULT_LLM_MODEL): Promise<ScriptResult> {
  const rate = /hindi|hinglish|hi\b/i.test(input.language) ? 110 : 130;
  const result = await claudeJson<Partial<ScriptResult>>(`${ORCHESTRATOR_PERSONA} ${SCRIPT_TASK}`, {
    ...input,
    target_word_count: Math.round(rate * input.targetLengthSec / 60),
    instruction: input.direction || 'Write the strongest complete script.',
  }, model, 8192);
  const briefs = Array.isArray(result.scene_image_briefs) ? result.scene_image_briefs : [];
  return {
    script: String(result.script || ''),
    sources: Array.isArray(result.sources) ? result.sources : [],
    estimated_duration_sec: Number(result.estimated_duration_sec) || input.targetLengthSec,
    scene_image_briefs: briefs
      .map((entry: any, index: number) => ({ scene: Number((entry && entry.scene) || index + 1), brief: String((entry && (entry.brief || entry.text)) || entry || '').trim() }))
      .filter((entry) => entry.brief.length > 3)
      .slice(0, 60),
  };
}

// ---------------------------------------------------------------------------
// Task 2 — the scene manifest. The SAME model that wrote the script now times
// every supporting scene, writes the image prompts (for the image tool), the
// video prompts (for the video tool), and the Remotion scene data + text
// overlay spec (for the assembly compositor).
// ---------------------------------------------------------------------------

export const SCENE_PLAN_TASK = `CURRENT TASK: the full video blueprint. Input includes the full script, word-level timestamps, visual style, requested middle-visual share, user uploads, an editingPreset with explicit planningBias, and optionally referenceStyleAnalysis. EDITING PRESET: treat planningBias as a real editing strategy — it controls graphic density, B-roll frequency, text-overlay usage and pacing, not merely colors. Follow it unless it conflicts with factual accuracy, exact-text requirements, presenter safety or the requested middle-visual share. REFERENCE VIDEO LANGUAGE: when referenceStyleAnalysis exists, transfer only its abstract cut frequency, graphic density, caption behavior, pacing, framing and transition rules. Never copy or mention its people, footage, words, music, logos, products or other assets. The film alternates between the HeyGen talking head (the avatar master, always on screen by default) and MIDDLE VISUAL SECTIONS that replace the picture while the presenter's narration continues underneath, documentary style. Structure rules: the first 5 seconds stay on the talking head; the final segment before the end returns to the talking head (the CTA is delivered on camera); never place two middle sections back-to-back without a talking-head return, unless one continuous sentence spans that gap; default to alternating talking head → middle visual → talking head for any topic that benefits from visual explanation. Keep total middle-section duration near low=30%, medium=50%, or high=65%. For every middle scene include narration_segment: the exact script text the scene covers. CHOOSE visual_kind per scene from four types: "ai_video" ONLY for beats needing real filmed motion (a place, an action, physical footage; NEVER for text, names, numbers or lists — AI video hallucinates lettering); "motion_graphic" whenever structure or accuracy serves the beat — processes, relationships, timelines, comparisons, lists, charts, exact numbers, maps, node networks (this is the documentary explainer layer; prefer it when in doubt); "text_overlay" for a pure emphasized headline, key phrase or quote; "image" for one strong still (a portrait, artifact, place establishing shot). FOR motion_graphic SCENES return layout — the deterministic spec the GSAP motion engine renders EXACTLY (every string and number is shown verbatim on screen, so copy them precisely from the script; never invent figures): {"kind":one of branching_diagram|flowchart|timeline|comparison|list_reveal|big_stat|bar_chart|node_graph|annotated_image|text_reveal,"title"?:string<=90 chars,"subtitle"?:string,"root"?:central node label (branching_diagram/node_graph),"items":[{"label":string<=40 chars,"sublabel"?:string<=60,"value"?:number (bar_chart)}] max 6,"leftTitle"?+"rightTitle"?+"leftItems"?+"rightItems"? (comparison),"stat"?:{"value":number,"prefix"?,"suffix"?,"label"?} (big_stat)}. FOR text_overlay SCENES return overlay {"text":exact headline<=90 chars,"subtext"?:one supporting line,"overAvatar":true,"position"?:"lower_third"|"bottom_left"|"bottom_right"|"top_left"|"top_right"} — exact strings only. TEXT RIDES ON THE PRESENTER, NOT BETWEEN CUTS: a text_overlay composites ON TOP of the talking head — the avatar keeps playing full-frame while the label fades in and out in a safe zone (lower third by default, never over the face), synced to the narration segment's timestamps. Always set "overAvatar":true, and use text_overlay callouts liberally to reinforce key phrases, names and numbers WHILE the presenter speaks instead of cutting away to a full-screen card. FOR ai_video SCENES include video_prompt, sent VERBATIM to the video model. Write it as a DETAILED PRODUCTION SHOT BRIEF of 60-120 words, never a generic one-liner ("Create cinematic footage of a factory" is a failure). The brief states what the shot must COMMUNICATE for its narration beat, not merely what object exists, and covers: SUBJECT (who/what, specific appearance), CONTEXT/ENVIRONMENT (place, era, weather, set dressing), ACTION (what unfolds during the clip), CAMERA MOVEMENT (slow dolly-in, lateral track, handheld drift, static tripod, aerial drift…), FRAMING & COMPOSITION (wide establishing / medium / close-up; foreground and background elements; depth of field), LENS/LOOK (e.g. 35mm documentary, shallow focus, natural film grain), LIGHTING & COLOR (golden hour, practical lamps, cool overcast; the palette), MOTION PACING (contemplative vs energetic) and VISUAL STYLE matching the film's documentary tone. Close every prompt with negative constraints: no on-screen text, no lettering, no logos, no watermark, no distorted faces. FOR image SCENES each image prompt describes one cinematic full-frame picture and is sent VERBATIM to the image model: subject, setting, framing, light and mood, no words or lettering. When the input carries imageBriefs from your scriptwriting pass, treat them as the intended visual for their beat. Reuse a fitting upload by naming it in suggested_user_uploads. VISUAL VARIETY RULES: vary motion_graphic layout kinds across the film — never give two consecutive motion_graphic scenes the same kind when another kind fits the content; match each scene's optional layout "accent" (a hex color) to its subject (data/science → cyan #06B6D4, money/growth → emerald #10B981, history → amber #F59E0B, risk/warning → rose #F43F5E, product/tech → violet #8B5CF6) instead of defaulting everything to one blue. COMPARISON RULE: a comparison layout MUST fill BOTH leftItems AND rightItems (1-5 entries each) — never return a comparison with an empty side. COMPLETENESS RULE (hard): motion_graphic and text_overlay content carries the FULL text the script promises — write every item in full, never truncate, never summarize a list down, and never use ellipsis ("…"/"...") or "etc". If the script names N things, the layout carries ALL N: a comparison includes EVERY compared row on BOTH sides, a list_reveal includes EVERY bullet, a timeline EVERY beat. When content genuinely exceeds one card's 6-item ceiling, SPLIT it across consecutive motion_graphic scenes covering adjacent narration — never drop items. ACCURACY RULE (hard): every product name, feature name, number and comparison value is copied EXACTLY from the script — never rounded, renamed, abbreviated or invented. DESIGN RULES: motion graphics must look bold and premium, never generic — punchy high-contrast titles (short strong wording in "title", detail in "subtitle"), a deliberate accent per scene (vary hues across the film), and the layout kind that best DRAMATIZES the content (big_stat for one number, bar_chart for magnitudes, comparison for A-vs-B, timeline for chronology, flowchart for how-it-works steps, list_reveal for feature lists, quote-style text_reveal for testimonials). BACKDROP IMAGES: for a motion_graphic scene that benefits from atmosphere (stats, quotes, headlines, documentary beats), ALSO include ONE image prompt in its image_prompts describing a vivid contextual backdrop picture (subject, setting, framing, light, mood — no words, no lettering, no watermark); the engine generates it and dims it behind the graphic so the exact text always stays on top. ASSET CONTINUITY: when a beat revisits a subject an earlier scene already visualized (the same character, product or icon), repeat that subject's core wording in the new scene's image prompt so the existing asset is reused and the film stays visually consistent. COMPOSITED AI VIDEO: for an ai_video scene whose beat is analytical (data, product, UI, a detail worth annotating) you may return overlay {"text":short caption,"mediaLayout":"inset_left"|"inset_right"|"circle"|"card"} to composite the clip as an element beside its caption instead of a full-bleed takeover. SHOT CONTINUITY (ai_video): when consecutive ai_video scenes cover one continuing subject, location or sequence, carry the SAME subject appearance, environment, lighting, color grade and camera language descriptors across their prompts — word them as one filmed sequence so the shots cut together; when the film moves to a new subject, establish it cleanly instead of echoing the previous shot. COMPOSITION DIRECTION (hard): you are the editor — the avatar video is the BASE LAYER of the whole film and every supporting visual is COMPOSITED AGAINST the presenter, never parked as an isolated card. For EVERY middle scene also return "composition": {"mode":"overlay"|"central"|"fullscreen","position"?:"lower_third"|"left"|"right"|"top_left"|"top_right"|"bottom_left"|"bottom_right","scale"?:number 0.2-0.95 (fraction of frame width),"keepAvatarVisible":boolean,"purpose":one sentence answering WHY this visual is on screen}. Decide the visual hierarchy per beat — never give every visual the same treatment, never make everything an overlay, never make everything full-screen: a small statistic, lower third, label, keyword, small icon/callout or supporting reference image → "overlay" (the presenter stays fully visible; the graphic rides a face-safe zone on a transparent background); a 3-step process, flow diagram, detailed chart, comparison, timeline or map → "central" (the diagram becomes the main focus at generous scale while the presenter stays partially visible — never force a real diagram into a tiny corner just because the presenter exists); cinematic AI B-roll, a complex demonstration, a historical scene, or a large chart/map/product UI that needs the viewer's full attention → "fullscreen" cutaway (avatar → visual → avatar). PURPOSE RULE: if you cannot justify a visual's purpose in one sentence, do not create that scene — the presenter alone is better than clutter. AVATAR SAFE AREAS: never place an overlay over the presenter's face, mouth or key gestures — the face sits in the upper-center band, so prefer the lower third and side zones; when the presenter would naturally look or gesture toward one side, place the graphic on that side (position "left" or "right") so the composition feels directed rather than random. 9:16 films are mobile-first: use generous scale (overlay ≥0.45, central ≥0.8) so labels stay readable, and ai_video always plays as a fullscreen cutaway in 9:16. TEXT SUPPORTS THE VISUAL, IT IS NEVER THE VISUAL: when narration describes structure, quantity, chronology, geography or comparison, choose the real diagram kind with real items — narration "the process has three stages" must become a flowchart with the three actual stages animating in sequence, never a text card saying "THREE STAGES"; "versus / before-after / old-new / faster-slower" narration becomes a comparison with BOTH sides filled; counted growth ("from three employees to more than one hundred") becomes big_stat or bar_chart with the exact numbers; chronology becomes a timeline; geography becomes a node_graph map with real locations as nodes. Reserve text_reveal for a genuinely pure headline or quote. CHANGE REQUESTS: when the input carries changeRequest, it is the user's plain-language edit to an EXISTING plan — apply exactly what it asks (plus whatever it implies for adjacent scenes), keep every other scene's timing, kind and content as close to the current plan as the request allows, and never reinterpret the whole film. Set audio_strategy to "continuous_heygen_voiceover" — the talking-head narration keeps playing under every middle section. Return strict JSON only: {"scenes":[{"scene_index":number,"script_start_sec":number,"script_end_sec":number,"scene_type":string,"visual_kind":"ai_video"|"image"|"motion_graphic"|"text_overlay","description":string,"narration_segment":string,"image_prompts":string[],"motion_notes":string,"video_prompt"?:string,"layout"?:object,"overlay"?:object,"composition"?:{"mode":"overlay"|"central"|"fullscreen","position"?:string,"scale"?:number,"keepAvatarVisible":boolean,"purpose":string},"suggested_user_uploads"?:string[]}],"audio_strategy":"continuous_heygen_voiceover","total_scene_sec":number,"total_avatar_sec":number}.`;

const PLAN_KINDS = ['ai_video', 'image', 'motion_graphic', 'text_overlay', 'text_graphics'];

// One scene-planning attempt gets 90 seconds — enough for the orchestrator to
// write a full manifest, short enough that a hung or dropped request surfaces
// quickly instead of leaving the "timing supporting scenes" screen up forever.
const PLAN_TIMEOUT_MS = 90_000;

export async function planScenes(input: { script: string; wordTimestamps: WordTimestamp[]; style: string; sceneShare: 'low' | 'medium' | 'high'; uploads: string[]; durationSec: number; imageBriefs?: SceneImageBrief[]; changeRequest?: string; editingPreset?: string; referenceStyleAnalysis?: Record<string, unknown> | null }, model = DEFAULT_LLM_MODEL) {
  const remembered = typeof window !== 'undefined' ? ((window as any).__sceneForgePlanningContext || {}) : {};
  const preset = getEditingPreset(input.editingPreset || remembered.editingPreset);
  const planningInput = { ...input, editingPreset: { id: preset.id, name: preset.name, planningBias: preset.planningBias }, referenceStyleAnalysis: input.referenceStyleAnalysis || remembered.referenceStyleAnalysis || null };
  // This call is the step behind the "timing supporting scenes against the
  // avatar" screen. Each attempt is bounded, and one automatic retry covers a
  // transient failure (timeout, rate limit, dropped connection, truncated
  // JSON) — so planScenes always settles: it resolves with a plan or throws an
  // error the UI can show, never hangs.
  let result: any;
  try {
    result = await claudeJson<any>(`${ORCHESTRATOR_PERSONA} ${SCENE_PLAN_TASK}`, planningInput, model, 8192, PLAN_TIMEOUT_MS);
  } catch (firstError) {
    if (!isTransientAiError(firstError)) throw firstError;
    result = await claudeJson<any>(`${ORCHESTRATOR_PERSONA} ${SCENE_PLAN_TASK}`, planningInput, model, 8192, PLAN_TIMEOUT_MS);
  }
  const duration = Math.max(6, input.durationSec);
  const sorted = (Array.isArray(result.scenes) ? result.scenes : [])
    .map((s: any, i: number) => {
      const layout = s.layout && typeof s.layout === 'object' ? s.layout : (s.spec && typeof s.spec === 'object' ? s.spec : null);
      // Kind fallbacks read the scene's own evidence: a layout means a motion
      // graphic, a video prompt means AI video, otherwise a text beat.
      const kind = PLAN_KINDS.includes(s.visual_kind) ? s.visual_kind : (layout ? 'motion_graphic' : (typeof s.video_prompt === 'string' && s.video_prompt ? 'ai_video' : 'text_overlay'));
      // The composition decision (overlay / central / fullscreen + position,
      // scale, purpose) rides on the overlay_config so it persists with the
      // scene and stays editable; assembly falls back to kind-aware defaults
      // when a plan predates this field.
      const composition = normalizeComposition(s.composition || (s.overlay && typeof s.overlay === 'object' ? (s.overlay as any).composition : null));
      const baseOverlay = s.overlay && typeof s.overlay === 'object'
        ? (kind === 'text_overlay' ? { ...s.overlay, overAvatar: s.overlay.overAvatar !== false } : s.overlay)
        : (kind === 'text_overlay'
          ? { text: String(s.description || s.narration_segment || '').split(/[.!?]/)[0]?.trim().slice(0, 90) || '', position: 'lower_third', overAvatar: true }
          : null);
      return {
        ...s,
        scene_index: i + 1,
        script_start_sec: Math.max(5, Number(s.script_start_sec || 5)),
        script_end_sec: Math.min(duration - 1, Number(s.script_end_sec || 6)),
        image_prompts: Array.isArray(s.image_prompts) ? s.image_prompts : [],
        visual_kind: kind,
        video_prompt: typeof s.video_prompt === 'string' ? s.video_prompt : '',
        // text_overlay beats default to compositing ON the presenter (the
        // avatar keeps playing; the label rides a safe zone) unless the model
        // explicitly opted out — full-screen text cards are no longer the
        // default for pure text beats.
        overlay_config: composition ? { ...(baseOverlay || {}), composition } : baseOverlay,
        // Normalized once here so what lands in the database is exactly what
        // the motion engine will draw — deterministic strings, no rework.
        spec: kind === 'motion_graphic' || (kind === 'text_overlay' && layout) ? normalizeMotionSpec(layout || {}, String(s.description || '')) : null,
        description: String(s.description || s.narration_segment || 'Middle visual'),
      };
    })
    .filter((s: any) => s.script_end_sec > s.script_start_sec)
    .sort((a: any, b: any) => a.script_start_sec - b.script_start_sec);
  const separated = sorted.filter((s: any, i: number) => i === 0 || s.script_start_sec - sorted[i - 1].script_end_sec >= 0.4);
  const total = separated.reduce((n: number, s: any) => n + s.script_end_sec - s.script_start_sec, 0);
  const audioStrategy = String(result.audio_strategy || 'continuous_heygen_voiceover');
  return { scenes: separated, audio_strategy: audioStrategy, total_scene_sec: total, total_avatar_sec: Math.max(0, duration - total) };
}

// ---------------------------------------------------------------------------
// Task 3 — one post-assembly Opus QC pass. It compares the stored plan with
// the media that actually exists. It advises; it never regenerates or mutates
// unrelated scenes. The editor's existing per-scene retry executes a flag.
// ---------------------------------------------------------------------------

export interface QcSuggestion { scene_id?: string; scene_index: number; weak: boolean; suggestion: string }
export interface AssemblyQcResult { summary: string; gaps: string[]; overlaps: string[]; speaker_visibility: string[]; suggestions: QcSuggestion[] }
export const ASSEMBLY_QC_TASK = `CURRENT TASK: post-assembly quality control. Compare the planned scene windows against the produced media manifest. Check duration fit, missing media, timeline gaps, overlaps, visual-kind correctness, repeated weak visuals, and speaker visibility: small callouts marked overAvatar must keep the presenter visible and avoid the face. Also check composition hierarchy: an overlay/central visual must keep the presenter visible and clear of the face band, a fullscreen cutaway must genuinely need the whole frame, and consecutive scenes should not all share one composition mode. HeyGen narration is the uninterrupted master audio. Return strict JSON only: {"summary":string,"gaps":string[],"overlaps":string[],"speaker_visibility":string[],"suggestions":[{"scene_id"?:string,"scene_index":number,"weak":boolean,"suggestion":string}]}. Every suggestion must name one concrete weakness and one isolated improvement for that scene. Never recommend changing or regenerating another scene as a side effect.`;

export async function reviewAssembly(input: { durationSec: number; scenes: Array<Record<string, unknown>>; assembledVideoUrl: string; editingPreset?: string }, model = DEFAULT_LLM_MODEL): Promise<AssemblyQcResult> {
  const preset = getEditingPreset(input.editingPreset);
  const result = await claudeJson<Partial<AssemblyQcResult>>(`${ORCHESTRATOR_PERSONA} ${ASSEMBLY_QC_TASK}`, { ...input, editingPreset: { id: preset.id, planningBias: preset.planningBias } }, model, 4096);
  const suggestions = (Array.isArray(result.suggestions) ? result.suggestions : []).map((item: any) => ({ scene_id: item.scene_id ? String(item.scene_id) : undefined, scene_index: Number(item.scene_index) || 0, weak: item.weak === true, suggestion: String(item.suggestion || '').trim() })).filter((item) => item.scene_index > 0 && item.suggestion).slice(0, input.scenes.length);
  return { summary: String(result.summary || 'Assembly reviewed.'), gaps: Array.isArray(result.gaps) ? result.gaps.map(String) : [], overlaps: Array.isArray(result.overlaps) ? result.overlaps.map(String) : [], speaker_visibility: Array.isArray(result.speaker_visibility) ? result.speaker_visibility.map(String) : [], suggestions };
}

// ---------------------------------------------------------------------------
// Task 4 — plain-language change requests from the Verger panel. Same single
// model: this routes a request to a pipeline STAGE (script / scene / style /
// assembly), never to another LLM — there is no other LLM to route to.
// ---------------------------------------------------------------------------

export type ChangeRoute = 'script' | 'scene' | 'style' | 'assembly';

export const CHANGE_ROUTE_TASK = `CURRENT TASK: change-request routing. Route the user's change request to the pipeline stage that handles it, without doing unrelated work. Script wording or intro changes route to script. A numbered/timed visual change routes to scene. Global visual treatment routes to style. Timing, trim, logo, overlay or final-video changes route to assembly. Return strict JSON {"route":"script|scene|style|assembly","action":string,"affected_scene_indexes":number[]}. Never overwrite an active user edit: the caller will queue your intent until the user saves.`;

export async function routeChangeRequest(request: string, context: unknown, model = DEFAULT_LLM_MODEL) {
  return claudeJson<{ route: ChangeRoute; action: string; affected_scene_indexes: number[] }>(`${ORCHESTRATOR_PERSONA} ${CHANGE_ROUTE_TASK}`, { request, context }, model, 1200);
}

// ---------------------------------------------------------------------------
// Deterministic helper (no LLM): evenly spread word timings for scripts whose
// avatar render returned none.
// ---------------------------------------------------------------------------

export function approximateWordTimestamps(script: string, durationSec: number): WordTimestamp[] {
  const words = script.trim().split(/\s+/).filter(Boolean); const usable = Math.max(1, durationSec);
  return words.map((word, i) => ({ word, start: i * usable / words.length, end: (i + 1) * usable / words.length }));
}
