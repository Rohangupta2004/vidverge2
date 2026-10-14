/**
 * CREATIVE DIRECTOR — the reasoning brain of the Script-to-Video pipeline.
 *
 * Every browser-side planning decision runs through the shared interactive
 * OpenAI planner (gpt-6.1-sol, medium reasoning, 6,000 completion tokens):
 * script understanding, scene division, per-scene visual decisions, prompt
 * generation, continuity management, timing and post-render validation.
 *
 * The exported askOpus* names remain as compatibility aliases for callers;
 * provider choice lives in lib/creativePlanner.ts, not in this feature.
 */

import {
  AssetRow, AudioMusicPlan, AudioNarrationEntry, AudioSfxItem, Film,
  FilmCharacter, FilmPlan, FilmScene, FilmStyle, PlanScene, ReferenceType,
  SceneDialogue, SceneType, VeoSpec, VoicePlan, newSceneKey,
} from '../api';
import { askCreativePlanner } from '../../../lib/creativePlanner';
import {
  DEFAULT_MAX_SCENES, OMNI_MODEL_ID, planScenes, resolveEngineId,
  routeShotIntent, splitSegmentForModel, validateSceneDurations,
  type ShotIntent,
} from '../../../lib/videoEngines';
import { resolveVideoModel } from './videoModelService';

interface OpusCall {
  system: string;
  user: string;
  /** Public https image URLs attached as vision inputs. */
  images?: string[];
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface OpusReply {
  text: string;
  /** Anthropic `stop_reason`; 'max_tokens' means the platform's 8,192-token
   * ceiling cut the reply off and its tail is missing. */
  stopReason: string;
}

/** The director's text reply (every director surface uses this). */
export async function askOpus(call: OpusCall): Promise<string> {
  return (await askOpusRaw(call)).text;
}

/** askOpus plus the completion state. The shared planner checks truncation
 * before returning, so a partial JSON object can never be repaired and kept. */
export async function askOpusRaw({ system, user, images = [] }: OpusCall): Promise<OpusReply> {
  const reply = await askCreativePlanner({ system, user, images });
  return { text: reply.text, stopReason: reply.finishReason };
}

/**
 * Parse the first balanced JSON object/array out of a model reply.
 * Robust to markdown code fences, commentary around the JSON, trailing
 * commas, and replies truncated mid-value (e.g. when the token budget ran
 * out): a truncated reply is repaired by closing the open string/brackets
 * and dropping the trailing partial fragment instead of being rejected.
 */
export function extractJson<T = any>(text: string): T {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error('The director returned no JSON.');

  const tryParse = (raw: string): T | undefined => {
    try { return JSON.parse(raw) as T; } catch { /* try sanitized */ }
    try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')) as T; } catch { return undefined; }
  };
  // What is still open at the end of `raw`: bracket stack + unterminated string.
  const openState = (raw: string): { closers: string; inStr: boolean } => {
    const stack: string[] = [];
    let str = false; let bs = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (str) { if (bs) bs = false; else if (ch === '\\') bs = true; else if (ch === '"') str = false; continue; }
      if (ch === '"') str = true;
      else if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    return { closers: stack.reverse().join(''), inStr: str };
  };

  // The first balanced value, when the reply contains one.
  const stack: string[] = [];
  let inStr = false; let esc = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) {
        const parsed = tryParse(cleaned.slice(start, i + 1));
        if (parsed !== undefined) return parsed;
        break; // balanced but unparseable — fall through to the repair path
      }
    }
  }

  // Truncated (or locally broken) reply: close what is open and progressively
  // drop the trailing partial fragment until a parseable value emerges.
  let candidate = cleaned.slice(start).trimEnd();
  for (let attempt = 0; attempt < 5 && candidate; attempt += 1) {
    const state = openState(candidate);
    let repaired = state.inStr ? candidate + '"' : candidate;
    repaired = repaired.replace(/,\s*("[^"]*"?\s*:?\s*)?$/, '');
    const parsed = tryParse(repaired + openState(repaired).closers);
    if (parsed !== undefined) return parsed;
    const lastComma = candidate.lastIndexOf(',');
    if (lastComma <= 0) break;
    candidate = candidate.slice(0, lastComma);
  }
  throw new Error('The director returned malformed JSON.');
}

/**
 * Ask the director for JSON. When the first reply cannot be parsed even after
 * repair, ONE retry is made with stricter output instructions appended to the
 * system prompt — shared by every director surface (S2V, Product Film, Design
 * with AI).
 */
export async function askOpusJson<T = any>(call: OpusCall): Promise<T> {
  return (await askOpusJsonDetailed<T>(call)).value;
}

export interface OpusJsonReply<T> {
  value: T;
  /** True when the reply hit the token ceiling: `value` was repaired from a
   * cut-off reply and may be missing its tail (last array items, later keys). */
  truncated: boolean;
}

/** askOpusJson plus the truncation signal — for callers whose output grows
 * with the input (clip plans, narration plans) and who continue in a
 * follow-up call instead of silently keeping a shortened result. */
export async function askOpusJsonDetailed<T = any>(call: OpusCall): Promise<OpusJsonReply<T>> {
  const reply = await askOpusRaw(call);
  try {
    return { value: extractJson<T>(reply.text), truncated: reply.stopReason === 'max_tokens' };
  } catch (first: any) {
    const strict = await askOpusRaw({
      ...call,
      system: call.system + '\n\nCRITICAL OUTPUT RULE: reply with ONE complete, syntactically valid JSON value and NOTHING else — no markdown fences, no commentary, no trailing commas. If space is tight, shorten string values rather than cutting the JSON off.',
    });
    try {
      return { value: extractJson<T>(strict.text), truncated: strict.stopReason === 'max_tokens' };
    } catch {
      throw new Error(String(first?.message || first) + ' A stricter retry also returned unparseable JSON — try again.');
    }
  }
}

async function opusJson<T = any>(call: OpusCall): Promise<T> {
  return askOpusJson<T>(call);
}

// ---------------------------------------------------------------------------
// Stage 1 — scene planning
// ---------------------------------------------------------------------------

const PLAN_SYSTEM = `You are the director-orchestrator of a script-to-video pipeline. You break a narration script into INDEPENDENT SCENES and decide exactly how each will be produced. Reply with ONE JSON object and nothing else.

SCENE TYPES (choose per scene):
- "veo_cinematic": AI-generated live-action/cinematic footage (Veo). Use for people, places, atmosphere, physical action. NEVER for readable text, UI, charts or logos — Veo cannot render text reliably.
- "web_graphic": deterministic browser-rendered motion graphic (HTML/SVG/GSAP). Use for ANY scene needing exact readable text, numbers, diagrams, flowcharts, labels, charts, lists, comparisons or brand statements. Every string you write is rendered EXACTLY.
- "product_mockup": the user's REAL product screenshot inside a phone/laptop/browser frame with camera motion. Use whenever the script shows an app, UI, website or product screen. NEVER ask Veo to recreate a UI.
- "asset_overlay": an existing project asset (image) with cinematic motion and optional exact labels.

RULES:
- The script is the source of truth. Never rewrite it; split it into contiguous script_segment slices that together cover the whole script in order.
- 3–10 scenes. Cinematic beats ≤ 8 seconds each (Veo hard cap). Graphics/mockups 4–10 seconds. duration_s must fit the words spoken in the segment (~2.5 words/second).
- CONTINUITY: consecutive veo_cinematic scenes that share characters/location get the SAME continuity_group string (they render sequentially, each seeded from the previous scene's last frame, and set spec.seed_from_previous=true on every scene after the group's first). Unrelated scenes get continuity_group null (they render in parallel).
- ASSET REUSE: an "AVAILABLE ASSETS" list may be provided. Prefer reusing a listed asset (asset_overlay with its url, a graphic backdropUrl, or item imageUrl) over describing a new generation, when it genuinely fits the segment.
- PRODUCT: if a product screenshot URL is provided and the script refers to the product/app/UI, you MUST use product_mockup with screenshot_url set to that exact URL.
- VISUAL QUALITY: no generic cards, no filler. Vary the treatment and palette per scene — documentary, infographic, data viz, kinetic type, product demo, cinematic. Every visual must serve the narration it accompanies. Palettes are hex colors chosen to fit the content mood; do NOT default every scene to blue.
- COMPLETENESS (hard rule): a web_graphic carries the FULL text its segment promises — write every item in full, never truncate, never compress a list, and never use ellipsis ("…"/"...") or "etc". If the script names N features/steps/rows, the spec carries ALL N: a compare fills BOTH leftItems AND rightItems with every compared row, a list carries every bullet, a timeline every beat. When content genuinely exceeds one card (~6 items), SPLIT it into consecutive web_graphic scenes covering adjacent segments rather than dropping items.
- ACCURACY (hard rule): product names, feature names, numbers and comparison values are copied EXACTLY from the script — never rounded, renamed, abbreviated or invented.
- DESIGN DIRECTION: make graphics BOLD and eye-catching, never flat — punchy high-contrast titles (strong short wording in "title", detail in "subtitle"), a deliberate accent per scene varied across the film inside the film style, a texture ("grid"/"dots"/"diagonal") unless the scene needs calm, and a "backdrop_prompt" on scenes that benefit from atmosphere (stat callouts, quotes, kinetic type, documentary cards): a vivid contextual image brief (subject, setting, light, mood — NO words or lettering) that the renderer generates and dims BEHIND the graphic, so text always stays on top. Use the treatment that best DRAMATIZES the content: compare for A-vs-B, bars/stat for numbers, list for feature lists, timeline for chronology, flow for how-it-works steps, quote for testimonials.
- FILM STYLE (required): also output a film-level "style" object that matches the visual language to the TONE AND SUBJECT MATTER of the script — a tense investigative script must not look like a pastel product explainer, and a playful kids topic must not look like a fintech deck. You decide: "font_family" (a CSS font stack of LOCALLY AVAILABLE system fonts only — the renderer cannot load webfonts; lead with the family that fits the tone, e.g. Inter, 'Helvetica Neue', Arial, 'Arial Black', Verdana, 'Trebuchet MS', Tahoma, Georgia, 'Times New Roman', Palatino, Garamond, 'Courier New', Impact — and always end the stack with sans-serif, serif or monospace), "heading_weight" (600–900) and "body_weight" (400–600) as NUMBERS, "colors" (hex: primary, secondary, accent, background, text — the film's base palette), and "visual_mood" (one line describing the intended look). Per-scene palettes still vary by content but must live inside this film style — the renderer applies exactly what you return.

SPEC SHAPES:
- veo_cinematic: { "visual_brief": str (subject, action, setting, composition — concrete and filmable), "style": str, "camera": str, "mood": str, "seed_from_previous": bool, "duration_s": num }
- web_graphic: { "treatment": "kinetic_type"|"documentary_card"|"flow"|"stat"|"bars"|"list"|"compare"|"timeline"|"node_map"|"quote"|"annotated", "title": str, "subtitle": str?, "items": [{"label","sublabel"?,"value"?,"imageUrl"?}], "leftTitle"?/"rightTitle"?/"leftItems"?/"rightItems"? (compare), "stat": {"value","prefix"?,"suffix"?,"label"?}? , "backdropUrl"?: str, "backdrop_prompt"?: str (AI image brief for a contextual backdrop — generated by the pipeline when no existing asset fits), "palette": {"bg","ink","accent","accent2"}, "texture": "grid"|"dots"|"diagonal"|"none", "duration_s": num }
- product_mockup: { "device": "phone"|"laptop"|"browser", "screenshot_url": str, "headline"?: str, "caption"?: str, "motion": "scroll"|"zoom"|"pan"|"highlight", "focus"?: {"x","y","w","h" fractions 0..1}, "url_bar_text"?: str, "palette"?: {...}, "duration_s": num }
- asset_overlay: { "asset_url": str (MUST be an available asset url), "motion": "kenburns_in"|"kenburns_out"|"pan_left"|"pan_right", "labels"?: [{"text", "at"? seconds}], "palette"?: {...}, "duration_s": num }

OUTPUT SHAPE:
{ "title": str, "style_direction": str, "style": { "font_family": str, "heading_weight": num, "body_weight": num, "colors": {"primary","secondary","accent","background","text"}, "visual_mood": str }, "assumptions": [str], "scenes": [ { "type", "script_segment", "duration_s", "continuity_group": str|null, "rationale": str, "spec": {...} } ] }`;

export async function planFilm(params: {
  script: string;
  aspect: string;
  assets: AssetRow[];
  productScreenshotUrl?: string | null;
  note?: string;
}): Promise<FilmPlan> {
  const assetLines = params.assets.slice(0, 30)
    .map((a) => `- [${a.kind}] ${a.name || 'asset'} — ${a.description || ''} — ${a.url}`)
    .join('\n');
  const user = [
    `ASPECT RATIO: ${params.aspect}`,
    params.productScreenshotUrl ? `PRODUCT SCREENSHOT URL (use for any UI/product scene): ${params.productScreenshotUrl}` : 'PRODUCT SCREENSHOT: none provided.',
    assetLines ? `AVAILABLE ASSETS (reuse before generating new):\n${assetLines}` : 'AVAILABLE ASSETS: none yet.',
    params.note ? `DIRECTOR NOTE FROM THE USER: ${params.note}` : '',
    `SCRIPT (source of truth — never rewrite it):\n"""\n${params.script}\n"""`,
  ].filter(Boolean).join('\n\n');
  const raw = await opusJson<any>({ system: PLAN_SYSTEM, user, maxTokens: 8192, effort: 'high' });
  const scenes: PlanScene[] = (Array.isArray(raw?.scenes) ? raw.scenes : []).map((s: any, i: number) => ({
    scene_key: newSceneKey(),
    idx: i,
    type: (['veo_cinematic', 'web_graphic', 'product_mockup', 'asset_overlay'].includes(s?.type) ? s.type : 'web_graphic') as SceneType,
    script_segment: String(s?.script_segment || ''),
    duration_s: Math.min(12, Math.max(3, Number(s?.duration_s) || 6)),
    continuity_group: s?.continuity_group ? String(s.continuity_group) : null,
    rationale: s?.rationale ? String(s.rationale) : undefined,
    spec: (s?.spec && typeof s.spec === 'object') ? s.spec : { treatment: 'kinetic_type', title: String(s?.script_segment || '').slice(0, 90) },
  }));
  if (!scenes.length) throw new Error('The director produced an empty scene plan.');
  // The film style is the director's decision and the renderer applies it
  // verbatim — the checks below only guard hex/number SHAPE, never taste. A
  // plan without a style is refused so nothing silently falls back to the
  // renderer's legacy hardcoded look.
  const rawStyle = raw?.style;
  if (!rawStyle || typeof rawStyle !== 'object' || !String(rawStyle.font_family || '').trim()) {
    throw new Error('The director returned no film style (typography/palette) — plan the film again.');
  }
  const hexOr = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : fb);
  const style: FilmStyle = {
    font_family: String(rawStyle.font_family).slice(0, 220),
    heading_weight: Math.min(900, Math.max(300, Number(rawStyle.heading_weight) || 800)),
    body_weight: Math.min(700, Math.max(300, Number(rawStyle.body_weight) || 500)),
    colors: {
      primary: hexOr(rawStyle.colors?.primary, '#E8A33C'),
      secondary: hexOr(rawStyle.colors?.secondary, '#7FD4B4'),
      accent: hexOr(rawStyle.colors?.accent, hexOr(rawStyle.colors?.secondary, '#7FD4B4')),
      background: hexOr(rawStyle.colors?.background, '#101418'),
      text: hexOr(rawStyle.colors?.text, '#F5F3EE'),
    },
    visual_mood: String(rawStyle.visual_mood || '').slice(0, 300),
  };
  return {
    title: String(raw?.title || 'Untitled film').slice(0, 120),
    style_direction: String(raw?.style_direction || ''),
    style,
    assumptions: Array.isArray(raw?.assumptions) ? raw.assumptions.map(String) : [],
    scenes,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — Veo prompt generation (with continuity fold-in)
// ---------------------------------------------------------------------------

const VEO_PROMPT_SYSTEM = `You write production-ready prompts for the Veo text/image-to-video model. Reply with ONE JSON object: { "prompt": str, "negative": str }.
Rules:
- Concrete and filmable: subject, action, setting, composition, camera movement, lighting, color mood, pacing. Explicit motion language (direction, speed, weight, ground contact).
- NEVER request on-screen text, captions, subtitles, logos, UI or numbers — the negative must forbid text and watermarks.
- If CONTINUITY ATTRIBUTES are provided, the new shot must continue seamlessly: same character appearance and wardrobe, same environment, same lighting and palette, camera picking up from the described end state. The clip starts exactly where the previous one ended — no greeting, no reset, no recap.
- Keep it under 160 words.`;

export async function buildVeoPrompt(scene: FilmScene, film: Film, continuityAttrs: any | null): Promise<{ prompt: string; negative: string }> {
  const spec = scene.spec as VeoSpec;
  const user = [
    `FILM STYLE DIRECTION: ${film.plan?.style_direction || 'cinematic, natural'}`,
    `SCRIPT SEGMENT THIS SHOT COVERS (for meaning — do not put these words on screen): "${scene.script_segment}"`,
    `VISUAL BRIEF: ${spec.visual_brief || ''}`,
    `STYLE: ${spec.style || ''} | CAMERA: ${spec.camera || ''} | MOOD: ${spec.mood || ''}`,
    continuityAttrs ? `CONTINUITY ATTRIBUTES FROM THE PREVIOUS SHOT'S FINAL FRAME (continue from this exact state):\n${JSON.stringify(continuityAttrs)}` : 'CONTINUITY: this shot opens fresh (no previous state).',
  ].join('\n\n');
  const out = await opusJson<{ prompt: string; negative: string }>({ system: VEO_PROMPT_SYSTEM, user, maxTokens: 4096, effort: 'medium' });
  return {
    prompt: String(out?.prompt || spec.visual_brief || scene.script_segment).slice(0, 1800),
    negative: String(out?.negative || 'on-screen text, captions, subtitles, watermarks, logos, UI elements'),
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — continuity attribute extraction (vision on the last frame)
// ---------------------------------------------------------------------------

const ATTRS_SYSTEM = `You describe the exact visual end-state of a film frame so the NEXT shot can continue seamlessly. Reply with ONE JSON object:
{ "characters": [str], "wardrobe": str, "environment": str, "lighting": str, "palette": str, "camera": str, "action_in_progress": str, "time_of_day": str }
Be specific and literal about what is visible. No speculation beyond the frame.`;

export async function extractVisualAttributes(frameUrl: string): Promise<any> {
  try {
    return await opusJson({ system: ATTRS_SYSTEM, user: 'Describe this frame\u2019s end state.', images: [frameUrl], maxTokens: 1024, effort: 'low' });
  } catch {
    return null; // continuity degrades gracefully — the seed frame still chains
  }
}

// ---------------------------------------------------------------------------
// Stage 4 — post-render validation
// ---------------------------------------------------------------------------

const VALIDATE_SYSTEM = `You are the semantic quality judge of a script-to-video pipeline. The original script is the source of truth. You see 1-2 frames from a rendered scene plus the script segment it must illustrate. Reply with ONE JSON object: { "pass": bool, "issues": str }.
Fail ONLY on real errors: wrong product/brand/character identity, wrong visible numbers or statistics, a dropped key concept, the wrong subject/scene, a different recurring person, a broken/black/empty frame, or garbled on-screen text. Paraphrased staging with the same meaning, reasonable artistic interpretation, and minor framing/lighting/timing variation PASS. "issues" is one short sentence naming the concrete mismatch (empty when pass).`;

export async function validateScene(scene: FilmScene, frameUrls: string[]): Promise<{ pass: boolean; issues: string; method: string }> {
  try {
    const out = await opusJson<{ pass: boolean; issues: string }>({
      system: VALIDATE_SYSTEM,
      user: `SCENE TYPE: ${scene.type}\nSCRIPT SEGMENT: "${scene.script_segment}"\nDo these frames plausibly illustrate that segment?`,
      images: frameUrls.slice(0, 2),
      maxTokens: 512,
      effort: 'low',
    });
    return { pass: out?.pass !== false, issues: String(out?.issues || ''), method: 'opus_vision' };
  } catch (e: any) {
    return { pass: true, issues: `Judge unavailable (${String(e?.message || e).slice(0, 80)}) — accepted on trust.`, method: 'trust' };
  }
}

// ---------------------------------------------------------------------------
// Stage 5 — scene revision (the Director panel)
// ---------------------------------------------------------------------------

const REVISE_SYSTEM = `You revise ONE scene of a script-to-video plan according to the user's instruction. Reply with ONE JSON object: { "type": scene type, "spec": {...}, "duration_s": num, "note": str }.
Use the same scene type vocabulary and spec shapes as the planner (veo_cinematic / web_graphic / product_mockup / asset_overlay — web_graphic treatments: kinetic_type, documentary_card, flow, stat, bars, list, compare, timeline, node_map, quote, annotated; a web_graphic spec may carry "backdrop_prompt", an AI image brief for a contextual backdrop the pipeline generates and dims behind the text). The script segment is immutable. Keep every rule: no text in Veo scenes, real screenshots only in mockups, varied non-generic palettes, and COMPLETE text — every item written in full, exact names and numbers from the script, no ellipsis, no "etc", no dropped rows.`;

export async function reviseScene(scene: FilmScene, film: Film, instruction: string, assets: AssetRow[]): Promise<{ type: SceneType; spec: any; duration_s: number; note: string }> {
  const assetLines = assets.slice(0, 20).map((a) => `- [${a.kind}] ${a.name} — ${a.url}`).join('\n');
  const out = await opusJson<any>({
    system: REVISE_SYSTEM,
    user: [
      `FILM STYLE: ${film.plan?.style_direction || ''}`,
      `SCENE (idx ${scene.idx}, type ${scene.type})\nSCRIPT SEGMENT: "${scene.script_segment}"\nCURRENT SPEC: ${JSON.stringify(scene.spec)}`,
      assetLines ? `AVAILABLE ASSETS:\n${assetLines}` : '',
      film.product_screenshot_url ? `PRODUCT SCREENSHOT URL: ${film.product_screenshot_url}` : '',
      `USER INSTRUCTION: ${instruction}`,
    ].filter(Boolean).join('\n\n'),
    maxTokens: 4096,
    effort: 'medium',
  });
  const type: SceneType = (['veo_cinematic', 'web_graphic', 'product_mockup', 'asset_overlay'].includes(out?.type) ? out.type : scene.type);
  return {
    type,
    spec: (out?.spec && typeof out.spec === 'object') ? out.spec : scene.spec,
    duration_s: Math.min(12, Math.max(3, Number(out?.duration_s) || Number(scene.duration_s) || 6)),
    note: String(out?.note || 'Scene updated.'),
  };
}

// ===========================================================================
// SEQUENTIAL PIPELINE (Sep 2026 rebuild) — whole-story segmentation, one
// prompt at a time, continuation decisions. Everything below is the director
// brain of the sequential clip pipeline; the legacy planners above remain for
// films made before the rebuild and for the other director surfaces.
// ===========================================================================

/** The proxy's REAL per-request ceilings (platform contract): at most 200,000
 * characters of conversation input and a 256 KB body. They are the only size
 * limits this pipeline honours — never an app-side cap. A prompt that would
 * exceed them is split across requests (segmentation passes, narration
 * chunks, a scene's script neighbourhood) so nothing about the film is cut. */
const PROXY_INPUT_CHARS = 200000;
const PROXY_BODY_BYTES = 256 * 1024;
/** Room kept for JSON encoding, the reply envelope and small prompt parts. */
const PROXY_HEADROOM_CHARS = 12000;
/** Keeps one agent response within the interactive planner's 6,000-token cap;
 * coverage-driven continuation plans the rest, so no script text is dropped. */
const PLANNER_SCRIPT_CHUNK_CHARS = 12000;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** How many characters of `text` still fit in one request next to `fixed`
 * (the system prompt plus the rest of the user message), honouring both the
 * character and the byte ceiling. */
function scriptBudgetChars(text: string, fixed: string): number {
  const chars = PROXY_INPUT_CHARS - PROXY_HEADROOM_CHARS - fixed.length;
  const bytes = PROXY_BODY_BYTES - PROXY_HEADROOM_CHARS - utf8Length(fixed);
  const textBytes = utf8Length(text) || 1;
  // Bytes → characters at this text's own average width.
  const charsByBytes = Math.floor(bytes * (text.length / textBytes));
  return Math.max(0, Math.min(chars, charsByBytes));
}

/** Whether `text` fits whole in one request next to `fixed`. */
const fitsRequest = (text: string, fixed: string) => text.length <= scriptBudgetChars(text, fixed);

/** The longest prefix of `text` within `max` characters that ends at a
 * paragraph, sentence or line boundary — used to split a script ACROSS
 * requests, never to shorten the film. */
function excerptAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(0, max));
  const cut = Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('. '), head.lastIndexOf('\n'));
  return cut > max * 0.5 ? head.slice(0, cut + 1) : head;
}

export interface SegmentedPlan {
  title: string;
  story_summary: string;
  world: string;
  visual_style: string;
  characters: { id: string; name: string; appearance: string }[];
  scenes: {
    script_segment: string; summary: string; visual_goal: string;
    duration_s: number; characters: string[]; dialogue: SceneDialogue | null;
    shot_intent: ShotIntent; workflow_kind: 'engine' | 'recipe' | 'code' | 'unavailable';
    engine_id: string | null; engine_reason: string; duration_notes: string[];
  }[];
  notes: string[];
}

const SEGMENT_RULES = `RULES:
- Every clip is AI-generated video footage. There are no graphics, text cards or overlays — pure visual storytelling.
- For every clip choose one shot_intent from: cinematic_hero, fast_broll, character_consistency, product_consistency, motion_background, stills_to_motion, surreal_stylized. Choose the INTENT from the shot's job; shared routeShotIntent() resolves the actual engine.
- MODEL FACTS: Gemini Omni 1.1 Flash is the platform default and the ONLY engine here that accepts reference images (up to ten, combinable with a seed frame, plus last-frame interpolation); it is the character/product consistency engine and caps output at 720p. Retired preview ids are aliases of Omni, not engines. Real Veo 3.1 exists only at openrouter/google/veo-3.1, -fast and -lite; those accept one seed image and no references. openrouter/bytedance/seedance-2.0-fast works; Seedance 2.5 Fast is a hard 400. No engine is confirmed to deliver 4K — never promise it.
- Clip durations are WHOLE seconds. Choose the duration the beat needs; the shared model-duration contract will split an over-long beat at sentence/clause boundaries rather than dropping words. Return at most ${DEFAULT_MAX_SCENES} clips in one response; continuation passes will plan any remainder.
- A long continuous action becomes MULTIPLE consecutive clips (e.g. a player dribbling up the court and scoring = dribble start → drive → jump → ball through hoop — each its own clip that will later continue from the previous clip's extracted final frame).
- The script is the source of truth. Never rewrite it. Split it into contiguous script_segment slices that together cover the whole script in order.
- VERBATIM AND CONTIGUOUS (the pipeline verifies this against the script text): every script_segment is copied character-for-character from the script — never paraphrased, cleaned up, summarized or reordered. The first clip starts at the script's very first words and each next clip starts exactly where the previous one ended, so no word of the script is skipped; the last clip ends at the script's very last words. Title lines, headings, speaker labels and stage directions are part of the script and belong inside the clips' segments (they inform the visuals; they are never shown as text). A segment that cannot be found verbatim in the script is rejected and re-planned.
- There is NO cap on the number of clips — the script decides. A 30-second script may need 3 clips; an 8-minute story typically needs 50–100. Every distinct beat gets its own clip. Do not pad; do not compress several distinct beats into one clip; never stop early — the clip list must run all the way to the script's final words. Keep "summary" and "visual_goal" to ONE tight line each so a long script still fits in your reply.
- CHARACTERS: identify every recurring character and write a LOCKED, exhaustively specific appearance (age, build, face, hair, skin tone, exact clothing with colors, shoes, distinguishing details). Every clip that shows the character reuses this exact description verbatim — it is the continuity contract. Never use a real person's name or likeness; invent a generic character that fits the story.
- DIALOGUE (do not skip): read the script for SPOKEN LINES. A line a character speaks ON CAMERA in the scene (quoted dialogue attributed to a character who is visibly present) becomes that scene's "dialogue" object with the EXACT words from the script — never paraphrased, never invented, in the script's own language. Voice-over / narrator (VO) lines are NOT dialogue — they are narration, delivered later by the narration layer, so leave dialogue null for them. A scene with no one speaking on camera gets dialogue null.
- No readable on-screen text, UI, logos or captions in any clip — the video model cannot render text reliably. (Spoken dialogue is allowed and encouraged where the script has it — text on screen is not.)`;

const SEGMENT_SYSTEM = `You are the director of a sequential script-to-video pipeline. You read the ENTIRE script first and understand the complete story — characters, world, arc, tone — BEFORE splitting anything. Then you break the script into video clips by STORY LOGIC, never mechanical time slices. Reply with ONE JSON object and nothing else.

${SEGMENT_RULES}

OUTPUT SHAPE:
{ "title": str, "story_summary": str (the complete story in 3-6 sentences), "world": str (the shared setting/world), "visual_style": str (film-wide look: palette, lens language, lighting, mood), "characters": [{ "id": snake_case str, "name": str, "appearance": str }], "scenes": [{ "script_segment": str, "summary": str (what happens — one line), "visual_goal": str (the image this clip must land), "shot_intent": str, "duration_s": whole seconds, "characters": [character ids appearing], "dialogue": null | { "line": str (EXACT spoken words from the script), "speaker": character id, "delivery": str (tone/emotion/energy), "language": str, "accent": str } }] }`;

const SEGMENT_CONTINUE_SYSTEM = `You are the director of a sequential script-to-video pipeline, CONTINUING a clip plan that is already underway. The story, world, visual style and characters are decided and given to you, and the earlier clips are already planned. Segment ONLY the REMAINING SCRIPT into further clips, continuing the sequence exactly where it left off. Reply with ONE JSON object and nothing else.

${SEGMENT_RULES}
- Start with the first words of the REMAINING SCRIPT and run to its last words — never re-segment text the earlier clips already cover, never skip ahead. Reuse the given character ids verbatim; put a character in "new_characters" ONLY when a genuinely new recurring character first appears in the remaining script.
- Never stop early and never answer with an empty "scenes" list: every word of the REMAINING SCRIPT lands in a clip — a one-word line, a closing sentence, credits or an end marker included (film those as a brief closing shot). The pipeline checks the clips against the script text and rejects a plan that leaves any of it uncovered.

OUTPUT SHAPE:
{ "new_characters": [{ "id": snake_case str, "name": str, "appearance": str }], "scenes": [{ "script_segment": str, "summary": str (what happens — one line), "visual_goal": str (the image this clip must land), "shot_intent": str, "duration_s": whole seconds, "characters": [character ids appearing], "dialogue": null | { "line": str (EXACT spoken words from the script), "speaker": character id, "delivery": str (tone/emotion/energy), "language": str, "accent": str } }] }`;

/** Consecutive clips may overlap by a few words (the model repeats a phrase
 * at a boundary): a clip may begin up to this many source words BEFORE the
 * coverage cursor. It may never begin after it — that would skip words — and
 * its whole text is verified from wherever it begins, so overlap can neither
 * hide an omission nor move the cursor backwards. */
const OVERLAP_TOKENS = 12;
/** Word characters: ASCII letters/digits plus every non-ASCII letter block,
 * with the Unicode punctuation blocks (general/supplemental punctuation, CJK
 * symbols, fullwidth forms) treated as separators like ASCII punctuation. */
const WORD_CLASS = 'A-Za-z0-9\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u1FFF\\u2070-\\u2DFF\\u2E80-\\u2FFF\\u3040-\\uFEFF\\uFF10-\\uFF19\\uFF21-\\uFF3A\\uFF41-\\uFF5A\\uFF66-\\uFFDC';
const WORD_RE = new RegExp(`[${WORD_CLASS}]+`, 'g');

/** Typographic variants the model tends to straighten, mapped 1:1 so offsets
 * into the normalised text are valid in the original script. */
function normalizeForMatch(s: string): string {
  return String(s || '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/\u00A0/g, ' ');
}

/** One word of the script, lower-cased, with its offsets in the normalised
 * text (identical to offsets in the original — the normalisation is 1:1). */
interface SourceToken { text: string; start: number; end: number }

/** The script's COMPLETE word sequence, in order. */
function tokenizeSource(norm: string): SourceToken[] {
  const out: SourceToken[] = [];
  const re = new RegExp(`[${WORD_CLASS}]+`, 'g');
  for (let m = re.exec(norm); m; m = re.exec(norm)) out.push({ text: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}

/** A segment's complete word sequence, normalised and lower-cased the same way. */
const segmentWords = (s: string) => (normalizeForMatch(s).match(WORD_RE) || []).map((t) => t.toLowerCase());

/** Whether `words` equal the source words from index `at` on, one for one. */
function matchesAt(source: SourceToken[], at: number, words: string[]): boolean {
  if (at < 0 || at + words.length > source.length) return false;
  for (let j = 0; j < words.length; j += 1) if (source[at + j].text !== words[j]) return false;
  return true;
}

/** EXACT COVERAGE CHECK — the invariant behind every returned plan.
 *
 * Walks the clips in order against the script's COMPLETE word sequence,
 * keeping a cursor k = the index of the first source word not yet covered.
 * A clip is accepted only when its segment's ENTIRE word sequence equals the
 * source words one for one, contiguously, starting at k or at most
 * OVERLAP_TOKENS words before k (repeating a few already-covered words). It
 * may not start after k — that would skip source words — and no word inside
 * it may be missing, added, changed or reordered. On acceptance k moves to
 * the word after the segment, so the cursor only ever advances. A clip whose
 * words all lie before k, or that has no words, covers nothing new: it is
 * dropped and is not progress. The first clip that fails verification ends
 * the chain — it and everything after it are unproven and are re-planned
 * from the source.
 *
 * Words are compared, not characters: case, whitespace and punctuation
 * differences are ignored and typographic quotes/dashes are normalised 1:1.
 * Nothing else is forgiven. */
function locateCoverage<S extends { script_segment: string }>(source: SourceToken[], scenes: S[]): { kept: S[]; nextToken: number; cursor: number } {
  const kept: S[] = [];
  let k = 0;
  for (const scene of scenes) {
    const words = segmentWords(scene.script_segment);
    if (!words.length) continue; // no words → covers nothing; not a clip of this film
    let at = -1;
    for (let cand = k; cand >= Math.max(0, k - OVERLAP_TOKENS); cand -= 1) {
      if (matchesAt(source, cand, words)) { at = cand; break; }
    }
    if (at < 0) break; // paraphrased, altered, reordered, or skipping source words
    if (at + words.length <= k) continue; // only repeats covered words → dropped, no progress
    k = at + words.length;
    kept.push(scene);
  }
  return { kept, nextToken: k, cursor: k > 0 ? source[k - 1].end : 0 };
}

/** Stage 1 — Opus reads the WHOLE script, understands the full story, then
 * segments it into sequential clips at supported durations. */
export async function segmentScript(params: {
  script: string;
  aspect: string;
  note?: string | null;
  referenceImageUrl?: string | null;
}): Promise<SegmentedPlan> {
  const script = String(params.script || '');
  const header = [
    `ASPECT RATIO: ${params.aspect}`,
    params.referenceImageUrl ? `A USER-PROVIDED REFERENCE IMAGE exists (a character/product/scene visual the clips can reference): ${params.referenceImageUrl}` : 'REFERENCE IMAGE: none provided.',
    params.note ? `DIRECTOR NOTE FROM THE USER: ${params.note}` : '',
  ].filter(Boolean).join('\n\n');
  // The whole script goes in one request whenever the proxy allows it. A
  // script longer than one request may carry is not cut: the first pass reads
  // as much as fits and the coverage loop below brings the rest, so the plan
  // still ends at the script's final words.
  const firstExcerpt = excerptAt(script, Math.min(PLANNER_SCRIPT_CHUNK_CHARS, scriptBudgetChars(script, SEGMENT_SYSTEM + header)));
  const user = [
    header,
    firstExcerpt.length < script.length
      ? `SCRIPT (source of truth — never rewrite it). It is longer than one request may carry, so this is its FIRST PART (${firstExcerpt.length} of ${script.length} characters); the remainder is segmented in follow-up passes. Understand the story from what you see and segment this part completely, to its last words:\n"""\n${firstExcerpt}\n"""`
      : `SCRIPT (source of truth — read it COMPLETELY before segmenting; never rewrite it):\n"""\n${script}\n"""`,
  ].join('\n\n');
  const first = await askOpusJsonDetailed<any>({ system: SEGMENT_SYSTEM, user, maxTokens: 8192, effort: 'high' });
  const raw = first.value;
  const title = String(raw?.title || 'Untitled film').slice(0, 120);
  const story_summary = String(raw?.story_summary || '').slice(0, 1500);
  const world = String(raw?.world || '').slice(0, 800);
  const visual_style = String(raw?.visual_style || '').slice(0, 800);
  const characters = normalizeSegmentCharacters(raw?.characters);
  const planningNotes: string[] = [];
  const scenes = guardAgentBatch(normalizeSegmentScenes(raw?.scenes), planningNotes);
  // A cut-off reply's last clip may be half-written — re-plan it from the script.
  if (first.truncated && scenes.length > 1) scenes.pop();

  // COVERAGE-DRIVEN, UNCAPPED AND EXACT: the clip count is decided by the
  // script alone. Every pass verifies the planned clips word for word against
  // the script's complete word sequence (locateCoverage), keeps only the
  // verified contiguous chain, and asks for the words that follow it. The
  // plan is returned ONLY when every word of the script is covered — what
  // remains after the last clip may be whitespace and punctuation, nothing
  // else; no marker, credit or closing word is exempt. Unverifiable clips are
  // never kept as coverage: they are re-planned with verbatim instructions,
  // and a director that covers no new word twice in a row is a loud error,
  // not a shorter film.
  const source = tokenizeSource(normalizeForMatch(script));
  let lastToken = 0;
  let stalls = 0;
  for (;;) {
    const cov = locateCoverage(source, scenes);
    scenes.splice(0, scenes.length, ...cov.kept);
    if (cov.nextToken >= source.length) break; // every source word is covered
    const remaining = script.slice(cov.cursor);
    const remainingWords = source.length - cov.nextToken;
    if (cov.nextToken <= lastToken) {
      stalls += 1;
      if (stalls > 1) {
        const reached = cov.nextToken > 0
          ? `${scenes.length} clip${scenes.length === 1 ? '' : 's'} are verified word for word up to “…${script.slice(Math.max(0, cov.cursor - 60), cov.cursor).trim()}”, and the ${remainingWords} words that follow`
          : `none of its ${remainingWords} words`;
        throw new Error(`The director could not plan the script as verbatim clips: ${reached} stayed unplanned after repeated attempts (the clips returned were paraphrased, skipped words, or only repeated text already covered) — try again.`);
      }
    } else {
      stalls = 0;
    }
    lastToken = cov.nextToken;
    const recent = scenes.slice(-4);
    const context = [
      header,
      '=== THE FILM SO FAR (decided — do not change) ===',
      `TITLE: ${title}`,
      `STORY: ${story_summary}`,
      `WORLD: ${world}`,
      `VISUAL STYLE: ${visual_style}`,
      characters.length
        ? `CHARACTERS (reuse these ids verbatim):\n${characters.map((c) => `- [${c.id}] ${c.name}: ${c.appearance}`).join('\n')}`
        : 'CHARACTERS: none recurring so far.',
      `CLIPS ALREADY PLANNED: ${scenes.length}.${recent.length ? ` The most recent ones:\n${recent.map((s, i) => `- clip ${scenes.length - recent.length + i + 1} (${s.duration_s}s): ${s.summary || s.visual_goal}`).join('\n')}` : ''}`,
      cov.cursor > 0 ? `SCRIPT ALREADY COVERED — its tail, for orientation only (do NOT segment it again):\n"""\n…${script.slice(Math.max(0, cov.cursor - 500), cov.cursor)}\n"""` : '',
      stalls ? 'NOTE: the previous attempt was REJECTED — its clips could not be verified word for word as contiguous slices of the text below (words were paraphrased, changed or dropped inside a clip, text was skipped before the first clip or between clips, or the clips only repeated text already covered). Plan it again: copy every script_segment CHARACTER-FOR-CHARACTER from the text below, start the first clip at its very first words, start each next clip exactly where the previous one ended, and end the last clip at its very last words.' : '',
    ].filter(Boolean).join('\n\n');
    // The remainder goes whole whenever the proxy allows it; otherwise this
    // pass takes as much as one request may carry and the next pass continues
    // from wherever coverage reaches.
    const part = excerptAt(remaining, Math.min(PLANNER_SCRIPT_CHUNK_CHARS, scriptBudgetChars(remaining, SEGMENT_CONTINUE_SYSTEM + context)));
    const label = part.length < remaining.length
      ? `REMAINING SCRIPT — NEXT PART (${part.length} of ${remaining.length} remaining characters; the rest follows in a later pass). Segment ALL of this part, in order, from its first words to its last:`
      : 'REMAINING SCRIPT (segment ALL of it, in order, from its first words to its last):';
    const more = await askOpusJsonDetailed<any>({
      system: SEGMENT_CONTINUE_SYSTEM,
      user: `${context}\n\n${label}\n"""\n${part}\n"""`,
      maxTokens: 8192,
      effort: 'medium',
    });
    const added = guardAgentBatch(normalizeSegmentScenes(more.value?.scenes), planningNotes);
    if (more.truncated && added.length > 1) added.pop(); // half-written last clip — re-planned next pass
    // Nothing the director SAYS ends the plan — only the coverage check at the
    // top of the loop does, against the script text. An empty or unverifiable
    // reply is simply no progress: one more attempt with the NOTE, then an error.
    scenes.push(...added);
    for (const c of normalizeSegmentCharacters(more.value?.new_characters)) {
      if (!characters.some((k) => k.id === c.id)) characters.push(c);
    }
  }
  if (!scenes.length) throw new Error('The director produced an empty clip plan — try again.');
  return { title, story_summary, world, visual_style, characters, scenes, notes: Array.from(new Set(planningNotes)) };
}

function normalizeSegmentCharacters(list: unknown): SegmentedPlan['characters'] {
  return (Array.isArray(list) ? list : [])
    .filter((c: any) => c && (c.id || c.name))
    .map((c: any, i: number) => ({
      id: String(c.id || `char_${i + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      name: String(c.name || `Character ${i + 1}`).slice(0, 80),
      appearance: String(c.appearance || '').slice(0, 800),
    }));
}

function normalizeSegmentScenes(list: unknown): SegmentedPlan['scenes'] {
  // CLAMP, never snap: every provider this app runs on renders any whole
  // number of seconds in this range, so the director's chosen beat length is
  // kept as written. videoModelService.resolveDuration applies the specific
  // model's own floor and ceiling later.
  const snap = (n: unknown) => Math.min(10, Math.max(4, Math.round(Number(n) || 6)));
  return (Array.isArray(list) ? list : [])
    .filter((s: any) => s && String(s.script_segment || '').trim())
    .map((s: any) => ({
      script_segment: String(s.script_segment),
      summary: String(s.summary || '').slice(0, 300),
      visual_goal: String(s.visual_goal || '').slice(0, 400),
      duration_s: snap(s.duration_s),
      shot_intent: (['cinematic_hero', 'fast_broll', 'character_consistency', 'product_consistency', 'motion_background', 'stills_to_motion', 'surreal_stylized'].includes(s.shot_intent)
        ? s.shot_intent
        : 'cinematic_hero') as ShotIntent,
      workflow_kind: 'engine' as const,
      engine_id: null,
      engine_reason: '',
      duration_notes: [],
      characters: (Array.isArray(s.characters) ? s.characters : []).map(String),
      dialogue: s?.dialogue && String(s.dialogue.line || '').trim()
        ? {
            line: String(s.dialogue.line).slice(0, 400),
            speaker: String(s.dialogue.speaker || '').slice(0, 80),
            delivery: String(s.dialogue.delivery || 'natural, conversational').slice(0, 160),
            language: String(s.dialogue.language || 'English').slice(0, 60),
            accent: s.dialogue.accent ? String(s.dialogue.accent).slice(0, 60) : undefined,
          } as SceneDialogue
        : null,
    }));
}

/** Apply shared routing and duration contracts to one model response. The
 * planner owns the creative choice; these functions only bound it. */
function guardAgentBatch(
  input: SegmentedPlan['scenes'],
  notes: string[],
): SegmentedPlan['scenes'] {
  if (!input.length) return [];
  const total = input.reduce((sum, scene) => sum + scene.duration_s, 0);
  const countGuard = planScenes({
    modelId: 'openrouter/bytedance/seedance-2.0-fast',
    totalDurationS: total,
    requestedSceneCount: input.length,
    minScenes: 1,
    maxScenes: DEFAULT_MAX_SCENES,
  });
  notes.push(...countGuard.notes);
  const bounded = input.slice(0, countGuard.scenes.length);

  return bounded.flatMap((scene) => {
    const route = routeShotIntent(scene.shot_intent);
    const engineId = resolveEngineId(route.kind === 'engine' && route.engineId ? route.engineId : OMNI_MODEL_ID);
    const durationPlan = planScenes({
      modelId: engineId,
      totalDurationS: scene.duration_s,
      requestedSceneCount: 1,
      minScenes: 1,
      maxScenes: DEFAULT_MAX_SCENES,
    });
    const parts = splitSegmentForModel(engineId, scene.script_segment, scene.duration_s);
    const sourceWords = segmentWords(scene.script_segment);
    const splitWords = parts.flatMap((part) => segmentWords(part.text));
    if (sourceWords.length !== splitWords.length || sourceWords.some((word, index) => word !== splitWords[index])) {
      throw new Error(`The duration guard could not split “${scene.summary || 'this beat'}” without duplicating or dropping words. Re-plan that beat with a cleaner sentence or clause boundary.`);
    }
    const problems = validateSceneDurations(engineId, parts.map((part) => part.durationS), {
      expectedTotalS: durationPlan.totalDurationS,
      maxScenes: DEFAULT_MAX_SCENES,
    });
    const durationNotes = Array.from(new Set([...durationPlan.notes, ...problems]));
    notes.push(...durationNotes.map((note) => `“${scene.summary || 'Scene'}”: ${note}`));

    const dialogueParts = scene.dialogue
      ? splitSegmentForModel(engineId, scene.dialogue.line, scene.duration_s)
      : [];
    if (scene.dialogue) {
      const dialogueWords = segmentWords(scene.dialogue.line);
      const splitDialogueWords = dialogueParts.flatMap((part) => segmentWords(part.text));
      if (dialogueWords.length !== splitDialogueWords.length || dialogueWords.some((word, index) => word !== splitDialogueWords[index])) {
        throw new Error(`The duration guard could not split ${scene.dialogue.speaker}'s dialogue without duplicating or dropping words. Re-plan the line with a sentence or clause boundary.`);
      }
    }

    return parts.map((part, index) => {
      const dialogue = scene.dialogue && dialogueParts[index]?.text
        ? { ...scene.dialogue, line: dialogueParts[index].text }
        : null;
      return {
        ...scene,
        script_segment: part.text,
        summary: parts.length > 1 ? `${scene.summary} (part ${index + 1}/${parts.length})` : scene.summary,
        duration_s: part.durationS,
        dialogue,
        workflow_kind: route.kind,
        engine_id: route.engineId ? resolveEngineId(route.engineId) : null,
        engine_reason: route.reason,
        duration_notes: durationNotes,
      };
    });
  });
}

export interface PreparedScene {
  continuation: boolean;
  reference_type: ReferenceType;
  needs_character: string | null;
  prompt: string;
  negative: string;
  reasoning: string;
}

const PREPARE_SYSTEM = `You prepare ONE clip of a sequential script-to-video pipeline: you decide how it connects to the previous clip and write its production-ready video prompt. You are given three context layers: GLOBAL (whole story, characters, world, style), SCENE (this clip's segment, action, visual goal), and CONTINUITY (the previous completed clip: its summary, its extracted FINAL FRAME — attached as an image when available — and its visual end-state attributes). Reply with ONE JSON object and nothing else.

CONTINUATION DECISION (the most important call you make):
- "continuation": true ONLY when this clip directly continues the previous clip's visible state — same character in the same position/clothing/pose, same environment and camera space, a continuing action, object or movement (walking→still walking, dribbling→shooting, opening a door→stepping through). The generated clip will literally START from the previous final frame.
- "continuation": false when this clip cuts to a new location, time, subject or framing that does not flow from that exact frame. Passing the previous frame into an unrelated scene contaminates it visually — that is a bug, never a bonus.

REFERENCE PRIORITY:
1. continuation true → reference_type "previous_final_frame" (the frame becomes the clip's seed; ALSO set needs_character when the recurring character's locked reference image should ride along for identity).
2. independent clip WITH a recurring character → reference_type "character_reference" and needs_character = that character's id.
3. independent clip where the provided scene/product reference image genuinely fits → "scene_reference".
4. otherwise → "none" with needs_character null.

DIALOGUE (when the scene context includes an ON-CAMERA DIALOGUE line):
- Stage the delivery VISUALLY: the speaking character faces or addresses the scene naturally, mouth clearly visible where the framing allows, gestures and expression matching the line's delivery and emotion.
- Do NOT write the spoken words into your prompt text — the pipeline appends an explicit, exactly-worded Dialogue block (speaker, delivery, language, lip-sync) after your prompt. Your job is the staging; leave roughly 300 characters of budget for that block (keep your prompt ≤ 650 characters on dialogue scenes).
- A scene WITHOUT a dialogue line must not show anyone talking to camera: the narration layer carries the words, so the "negative" must additionally forbid: speaking to camera, moving lips as if talking, voice-over.

PROMPT QUALITY (hard rules):
- 500–950 characters. NEVER generic: "A man playing basketball" is a defect; "The young player in the black #7 jersey and white high-tops continues dribbling right from the exact position established in the reference frame, driving hard toward the hoop…" is the standard.
- Cover: subject & character (reuse the LOCKED appearance verbatim wherever a character appears), environment, the action and its progression across the clip, camera framing & movement, lens/look, composition, lighting & time of day, motion physics (weight, speed, direction, ground contact), background/foreground detail, visual style & mood — and, when continuation is true, an explicit instruction that the clip continues seamlessly from the reference frame's exact state (no reset, no greeting, no recap).
- NEVER request on-screen text, captions, subtitles, logos, UI or numbers. "negative" must forbid text and watermarks.
- End the action on a clean, holdable state — the clip's final frame may seed the next clip.

OUTPUT SHAPE:
{ "continuation": bool, "reference_type": "previous_final_frame"|"character_reference"|"scene_reference"|"none", "needs_character": str|null, "prompt": str, "negative": str, "reasoning": str (one line: why continuation or not) }`;

/** Stage 2 — prepare ONE scene: continuation decision + reference choice +
 * the production-ready prompt, from all three context layers. */
export async function prepareScenePrompt(params: {
  film: Film;
  scene: FilmScene;
  /** The nearest COMPLETED earlier scene (continuity source), or null. */
  prevScene: FilmScene | null;
  characterRefs: FilmCharacter[];
  /** Failure context or a user instruction driving a prompt revision. */
  revisionNote?: string | null;
  /** Character-reference fallback: forbid the previous frame entirely. */
  forceIndependent?: boolean;
}): Promise<PreparedScene> {
  const { film, scene, prevScene, characterRefs } = params;
  const plan = film.plan || ({} as FilmPlan);
  const planScene = (Array.isArray(plan.scenes) ? plan.scenes : []).find((p) => p.scene_key === scene.scene_key) || null;
  const spec: any = scene.spec || {};

  const charLines = (plan.characters || []).map((c) => {
    const ref = characterRefs.find((r) => r.id === c.id);
    return `- [${c.id}] ${c.name}: ${c.appearance}${ref?.url ? ' (locked reference image AVAILABLE)' : ''}`;
  }).join('\n');

  const continuity = params.forceIndependent
    ? 'CONTINUITY: the previous-frame path is DISABLED for this clip (fallback requested). Set continuation=false and rely on the character reference.'
    : prevScene
      ? [
          `CONTINUITY — the previous completed clip (scene ${prevScene.idx + 1}):`,
          `Its segment: "${String(prevScene.script_segment || '').slice(0, 400)}"`,
          prevScene.prompt ? `Its prompt (how it was staged): ${String(prevScene.prompt).slice(0, 400)}` : '',
          prevScene.visual_attributes ? `Its final-frame end state: ${JSON.stringify(prevScene.visual_attributes)}` : '',
          prevScene.keyframe_url ? 'Its extracted FINAL FRAME is attached as an image — study it before deciding.' : 'No usable final frame could be extracted from it.',
        ].filter(Boolean).join('\n')
      : 'CONTINUITY: this is the FIRST clip — no previous state exists. continuation must be false.';

  const dialogue: SceneDialogue | null = (scene.dialogue && String((scene.dialogue as any).line || '').trim())
    ? scene.dialogue
    : (planScene?.dialogue && String((planScene.dialogue as any).line || '').trim()) ? planScene.dialogue! : null;

  const globalLines = [
    `=== GLOBAL CONTEXT (the whole story) ===`,
    `TITLE: ${film.title || plan.title || ''}`,
    `STORY: ${plan.story_summary || ''}`,
    `WORLD: ${plan.world || ''}`,
    `VISUAL STYLE (applies to every clip): ${plan.visual_style || plan.style_direction || ''}`,
    charLines ? `CHARACTERS (locked appearances — reuse verbatim):\n${charLines}` : 'CHARACTERS: none recurring.',
    film.product_screenshot_url ? `SCENE/PRODUCT REFERENCE IMAGE available: ${film.product_screenshot_url}` : '',
  ];
  const sceneLines = [
    `\n=== SCENE CONTEXT (this clip) ===`,
    `CLIP ${scene.idx + 1}, duration ${scene.duration_s || planScene?.duration_s || 6}s, aspect ${film.aspect_ratio || '16:9'}.`,
    spec.shot_intent ? `SHOT INTENT: ${spec.shot_intent}. SHARED ROUTE: ${spec.workflow_kind || 'engine'}${spec.engine_id ? ` on ${spec.engine_id}` : ''}. ${spec.engine_reason || ''}` : '',
    `SCRIPT SEGMENT: "${scene.script_segment}"`,
    (spec.summary || planScene?.summary) ? `WHAT HAPPENS: ${spec.summary || planScene?.summary}` : '',
    (spec.visual_goal || planScene?.visual_goal) ? `VISUAL GOAL: ${spec.visual_goal || planScene?.visual_goal}` : '',
    dialogue
      ? `ON-CAMERA DIALOGUE (the character speaks this line in this clip — stage the delivery; the exact Dialogue block is appended automatically): speaker=${dialogue.speaker || 'the character'}, delivery=${dialogue.delivery}, language=${dialogue.language}${dialogue.accent ? `, accent=${dialogue.accent}` : ''}. Line: "${dialogue.line}"`
      : 'ON-CAMERA DIALOGUE: none — nobody speaks to camera in this clip (the narration layer carries the words).',
    `\n=== CONTINUITY CONTEXT ===`,
    continuity,
    params.revisionNote ? `\nREVISION NOTE (the previous attempt failed or must improve — address this directly): ${params.revisionNote}` : '',
  ];
  // The whole script rides along whenever the proxy allows it. A script too
  // long for one request is not cut: the clip gets the passage around it (its
  // neighbouring clips' segments) instead — relevant source context for every
  // scene, however deep into the script it sits.
  const fullScript = String(film.script || '');
  const fixed = PREPARE_SYSTEM + globalLines.join('\n') + sceneLines.join('\n');
  const neighbourhood = (Array.isArray(plan.scenes) ? plan.scenes : [])
    .filter((p) => Math.abs(p.idx - scene.idx) <= 3)
    .sort((a, b) => a.idx - b.idx)
    .map((p) => p.script_segment)
    .join('\n');
  const scriptContext = fitsRequest(fullScript, fixed)
    ? `FULL SCRIPT:\n"""\n${fullScript}\n"""`
    : `SCRIPT PASSAGE AROUND THIS CLIP (the full script is ${fullScript.length} characters — more than one request may carry — so here are the neighbouring clips' segments, in order):\n"""\n${neighbourhood || scene.script_segment}\n"""`;
  const user = [...globalLines, scriptContext, ...sceneLines].filter(Boolean).join('\n');

  const images = !params.forceIndependent && prevScene?.keyframe_url ? [prevScene.keyframe_url] : [];
  const out = await askOpusJson<any>({ system: PREPARE_SYSTEM, user, images, maxTokens: 4096, effort: 'high' });

  const refVocab: ReferenceType[] = ['previous_final_frame', 'character_reference', 'scene_reference', 'none'];
  let continuation = out?.continuation === true;
  let referenceType: ReferenceType = refVocab.includes(out?.reference_type) ? out.reference_type : 'none';
  // Hard guards — a wrong flag here contaminates the next clip visually.
  if (params.forceIndependent || !prevScene?.keyframe_url || scene.idx === 0) {
    continuation = false;
    if (referenceType === 'previous_final_frame') referenceType = 'character_reference';
  }
  if (!continuation && referenceType === 'previous_final_frame') referenceType = 'character_reference';
  if (continuation) referenceType = 'previous_final_frame';

  let prompt = String(out?.prompt || '').trim();
  if (prompt.length < 80) throw new Error('The director returned an unusably short prompt — prepare the scene again.');
  let negative = String(out?.negative || 'on-screen text, captions, subtitles, watermarks, logos, UI elements, warped anatomy').slice(0, 500);

  // DIALOGUE PROPAGATION (deterministic — never trust the model to remember):
  // a scene with an on-camera line ALWAYS carries an explicit Dialogue block in
  // the video prompt, with the exact words, speaker, delivery and language. A
  // scene without one must not have the model inventing speech that would
  // double-talk the ElevenLabs narration layer.
  // THE PROMPT BUDGET IS THE MODEL'S OWN LIMIT, not a fixed 1000 characters:
  // Seedance carries 2500, and trimming its prompts to Omni Flash's ceiling
  // was cutting prepared scenes off mid-sentence.
  const maxChars = Math.max(500, resolveVideoModel(spec.engine_id || film.video_model).promptMaxChars);

  if (dialogue) {
    const block = buildDialogueBlock(dialogue, film);
    prompt = `${prompt.replace(/\s*Dialogue:\s*"[\s\S]*$/i, '').trim().slice(0, Math.max(200, maxChars - block.length - 2))}\n${block}`;
  } else {
    const noTalk = 'speaking to camera, talking, moving lips as if speaking, voice-over';
    if (!/speaking to camera/i.test(negative)) negative = `${negative}, ${noTalk}`.slice(0, 500);
  }

  return {
    continuation,
    reference_type: referenceType,
    needs_character: out?.needs_character ? String(out.needs_character) : null,
    prompt: prompt.slice(0, maxChars),
    negative,
    reasoning: String(out?.reasoning || '').slice(0, 300),
  };
}

const STYLE_LOCK_SYSTEM = `You are the director of photography of a film being generated clip by clip. Scene 1 has just rendered, and its look is now the film's contract. Read scene 1's production prompt and write the film's VISUAL STYLE FINGERPRINT: 2-3 sentences of plain prose, no preamble, no lists, no headings, no quotation marks.

Name ONLY what must stay identical in every later clip: the color palette, the lighting (sources, contrast, time of day), the lens language (focal length, depth of field, camera behaviour), the film stock / grain / texture, and the overall mood.

NEVER describe the scene's subject, action, location, characters or dialogue — those change from clip to clip, and repeating them here would force every later clip to re-film scene 1. Never mention scene numbers.`;

/**
 * STYLE LOCK — the film's visual fingerprint, read from the clip that
 * actually rendered first. Scene 1 defines the look; the orchestrator then
 * prepends this text to every later prompt so the film cannot drift in
 * palette, lighting or lens language halfway through. Deliberately short:
 * it shares a hard character budget with the scene's own prompt.
 */
export async function extractStyleFingerprint(params: { film: Film; prompt: string }): Promise<string> {
  const plan = params.film.plan || ({} as FilmPlan);
  const user = [
    `FILM-WIDE STYLE DIRECTION: ${plan.visual_style || plan.style_direction || '(none recorded)'}`,
    `SCENE 1'S PRODUCTION PROMPT (the clip that just rendered — the look to lock):\n"""\n${String(params.prompt || '').slice(0, 2000)}\n"""`,
  ].join('\n\n');
  const text = await askOpus({ system: STYLE_LOCK_SYSTEM, user, maxTokens: 700, effort: 'low' });
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
}

/** The explicit dialogue block appended to every dialogue scene's video
 * prompt. Exact spoken line, speaker identity, delivery, language, accent,
 * timing and lip-sync — never assumed from the script's mere existence. */
export function buildDialogueBlock(dialogue: SceneDialogue, film: Film): string {
  const chars = Array.isArray(film.plan?.characters) ? film.plan!.characters! : [];
  const speaker = chars.find((c) => c.id === dialogue.speaker);
  const speakerLabel = speaker ? `${speaker.name} (${speaker.appearance.slice(0, 90)})` : (dialogue.speaker || 'the main character');
  return [
    `Dialogue: "${dialogue.line}"`,
    `Speaker: ${speakerLabel}`,
    `Delivery: ${dialogue.delivery || 'natural, conversational'}`,
    `Language: ${dialogue.language || 'English'}${dialogue.accent ? ` | Accent: ${dialogue.accent}` : ''}`,
    'Timing: the line is spoken naturally within this clip, finishing before the clip ends.',
    'Lip-sync: the speaker visibly says this exact line on camera, lips synchronized to the words. No other speech, no subtitles.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// AUDIO PLANNING — voice plan + narration script + music + SFX, planned
// TOGETHER with the scenes (never an afterthought). ElevenLabs is the
// authoritative narration source for the standard workflow; scenes with
// on-camera dialogue keep the video model's own voice instead (exactly one
// voice per scene, never both).
// ---------------------------------------------------------------------------

export interface PlannedFilmAudio {
  voice_plan: VoicePlan;
  narration: Pick<AudioNarrationEntry, 'scene_key' | 'text' | 'voice_source'>[];
  music: Pick<AudioMusicPlan, 'required' | 'preset' | 'customPrompt' | 'mood' | 'volume'>;
  sfx: Pick<AudioSfxItem, 'scene_key' | 'description' | 'prompt' | 'at_s' | 'volume'>[];
}

const SCRIPT_TRUTH_RULES = `THE ORIGINAL SCRIPT IS THE SOURCE OF TRUTH (hard rules):
- The narration preserves the meaning of the original script. NEVER invent product claims, statistics, features, numbers or promises that are not in the script. Names, numbers and technical terms are preserved EXACTLY.
- You MAY rewrite wording so it sounds natural SPOKEN aloud (drop markdown/stage directions/"Scene 3" labels, smooth written-language phrasing into speech), but the story and facts stay the script's.
- Keep the script's own language: a Hindi/Hinglish script is narrated in Hindi/Hinglish, not translated.`;

const NARRATION_RULES = `NARRATION (one entry PER SCENE, in order — every scene_key exactly once):
- voice_source "elevenlabs": the scene gets a narration line — write "text" as the natural spoken wording of THAT scene's script segment (its VO/narration content).
- voice_source "video_native": the scene has ON-CAMERA DIALOGUE (marked in the scene list) — the clip's own generated voice carries it. text = "". Never narrate over on-camera dialogue.
- voice_source "none": the scene genuinely has no words (pure visual beat). text = "".
- TIMING (hard rule): a comfortable narrator speaks ~2.3 words per second. Each scene's text must fit INSIDE its real duration (listed): duration 6s → at most ~13 words. Better slightly short than long. Never pad to fill.
- Split the script's narration across scenes so that, read in order, it covers the whole script's meaning without repeating lines.`;

const AUDIO_PLAN_SYSTEM = `You are the sound director of a script-to-video pipeline. The video clips are ALREADY generated — you plan the complete audio experience for them: one narration voice, per-scene narration lines, a music bed, and sparse sound effects. Reply with ONE JSON object and nothing else.

${SCRIPT_TRUTH_RULES}

VOICE PLAN (one consistent voice for the whole film):
- Decide tone, energy, pace, emotion, language and accent from the script's content and mood.
- Choose ONE voice from the AVAILABLE VOICES list whose name/labels best match. Use its exact id. The same voice is reused for every line and every regeneration.

${NARRATION_RULES}

MUSIC (respond to the script, not a constant loop):
- Decide whether music serves this film (required true/false — most films: true).
- preset: one of corporate | tech | uplifting | calm | energetic | playful | cinematic | lofi (the closest base).
- customPrompt: a 1-3 sentence instrumental brief — style, energy, tempo, mood, and the ARC (stronger opening hook, lower under explanation, controlled rise at the reveal, clean finish for the CTA). Instrumental only, no vocals.
- volume: 0.1–0.3 (music SUPPORTS — narration always takes priority and the mixer ducks music under speech automatically).

SFX (subtle, sparse — quality over quantity):
- 0–6 total for the whole film, ONLY where a sound genuinely lands a visual event (whoosh on a fast reveal, soft impact on a landing, UI tick on an interface moment, rising swell into the climax). Most scenes get NONE. Never place SFX over an on-camera dialogue line.
- Each: scene_key, description (what visual event it marks), prompt (a short sound-design brief: "short airy whoosh, fast transient, no music, no melody"), at_s (seconds from that scene's start, before the scene ends), volume 0.15–0.4.

OUTPUT SHAPE (keys in exactly this order — narration LAST, because it is the longest part: if the reply runs out of room only narration entries go missing, and those are completed in a follow-up pass):
{ "voice_plan": { "tone": str, "energy": str, "pace": str, "emotion": str, "language": str, "accent": str, "voice_id": str (exact id from the list), "voice_name": str },
  "music": { "required": bool, "preset": str, "custom_prompt": str, "mood": str, "volume": num },
  "sfx": [{ "scene_key": str, "description": str, "prompt": str, "at_s": num, "volume": num }],
  "narration": [{ "scene_key": str, "voice_source": "elevenlabs"|"video_native"|"none", "text": str }] }`;

const NARRATION_FILL_SYSTEM = `You are the sound director of a script-to-video pipeline, COMPLETING a narration plan that is already underway: the voice plan is decided and the earlier scenes already have their lines (the most recent ones are shown for continuity). Write the narration entry for EVERY scene listed under SCENES TO NARRATE — each scene_key exactly once, in order, and nothing else. Reply with ONE JSON object and nothing else.

${SCRIPT_TRUTH_RULES}

${NARRATION_RULES}
- Continue where the earlier lines left off: never repeat what they already said; narrate the script content that belongs to the listed scenes only.

OUTPUT SHAPE:
{ "narration": [{ "scene_key": str, "voice_source": "elevenlabs"|"video_native"|"none", "text": str }] }`;

/** Request granularity for the narration fill passes — small enough that a
 * chunk's entries always fit inside one 8,192-token reply. It is a batch
 * size, not a limit: passes continue until every scene has its entry. */
const NARRATION_FILL_CHUNK = 30;

/** Opus plans the film's complete audio: voice plan, scene-level narration
 * script, music brief and sparse SFX — all from the ORIGINAL script and the
 * scenes' REAL durations. */
export async function planFilmAudio(params: {
  film: Film;
  scenes: FilmScene[];
  voices: { id: string; name: string; labels?: Record<string, string> }[];
}): Promise<PlannedFilmAudio> {
  const { film } = params;
  const scenes = [...params.scenes].sort((a, b) => a.idx - b.idx);
  const sceneLine = (s: FilmScene) => {
    const d = s.dialogue && String((s.dialogue as any).line || '').trim() ? s.dialogue : null;
    return [
      `- scene_key=${s.scene_key} · scene ${s.idx + 1} · real duration ${Number(s.duration_s) || 6}s`,
      `  segment: "${String(s.script_segment || '').replace(/\s+/g, ' ')}"`,
      d ? `  ON-CAMERA DIALOGUE (voice_source must be video_native): ${d.speaker || 'character'} says "${d.line}"` : '',
    ].filter(Boolean).join('\n');
  };
  const voiceLines = params.voices.slice(0, 40)
    .map((v) => `- id=${v.id} · ${v.name}${v.labels ? ` · ${Object.entries(v.labels).map(([k, val]) => `${k}:${val}`).join(' ')}` : ''}`)
    .join('\n');
  const filmLine = `FILM: ${film.title || 'Untitled'} · ${scenes.length} scenes · total ~${Math.round(scenes.reduce((n, s) => n + (Number(s.duration_s) || 6), 0))}s`;
  const storyLine = `STORY: ${film.plan?.story_summary || ''}`;
  const styleLine = `VISUAL STYLE / MOOD: ${film.plan?.visual_style || film.plan?.style_direction || ''}`;
  const voicesBlock = voiceLines ? `AVAILABLE VOICES (choose one id):\n${voiceLines}` : 'AVAILABLE VOICES: none listed — set voice_id to "" and voice_name to "default".';
  const fullScript = String(film.script || '');
  // The original script rides along whole whenever the proxy allows it. The
  // scene list already carries every segment (the segments ARE the script, in
  // order), so a script too long for one request is referenced through them
  // instead of being cut.
  const scriptBlockFor = (fixed: string) => (fitsRequest(fullScript, fixed)
    ? `ORIGINAL SCRIPT (source of truth — preserve its meaning, names and numbers exactly):\n"""\n${fullScript}\n"""`
    : `ORIGINAL SCRIPT: ${fullScript.length} characters — longer than one request may carry. The scene segments listed above ARE that script, verbatim and in order; treat them as the source of truth.`);

  // One request must stay inside the proxy's ceilings, so the main plan lists
  // as many scenes as fit; every scene it could not list is narrated by the
  // fill passes below — all scenes, never a shortened list.
  const fixedHead = [AUDIO_PLAN_SYSTEM, filmLine, storyLine, styleLine, voicesBlock].join('\n\n');
  const allLines = scenes.map(sceneLine);
  let listed = allLines.length;
  let sceneList = allLines.join('\n');
  while (listed > 1 && !fitsRequest(sceneList, fixedHead)) {
    listed = Math.max(1, Math.floor(listed * 0.8));
    sceneList = allLines.slice(0, listed).join('\n');
  }
  const user = [
    filmLine,
    storyLine,
    styleLine,
    `SCENES (in order, with REAL durations)${listed < scenes.length ? ` — the first ${listed} of ${scenes.length}; the rest are narrated in follow-up passes` : ''}:\n${sceneList}`,
    voicesBlock,
    scriptBlockFor(fixedHead + sceneList),
  ].join('\n\n');
  const first = await askOpusJsonDetailed<any>({ system: AUDIO_PLAN_SYSTEM, user, maxTokens: 8192, effort: 'high' });
  const raw = first.value;

  const vp = raw?.voice_plan || {};
  const voiceId = String(vp.voice_id || vp.voiceId || '').trim();
  const known = params.voices.find((v) => v.id === voiceId) || null;
  const voice_plan: VoicePlan = {
    tone: String(vp.tone || 'confident').slice(0, 80),
    energy: String(vp.energy || 'medium').slice(0, 80),
    pace: String(vp.pace || 'conversational').slice(0, 80),
    emotion: String(vp.emotion || 'optimistic').slice(0, 80),
    language: String(vp.language || 'English').slice(0, 60),
    accent: String(vp.accent || 'neutral').slice(0, 60),
    voiceId: known ? known.id : (params.voices[0]?.id || ''),
    voiceName: known ? known.name : String(vp.voice_name || params.voices[0]?.name || 'default').slice(0, 80),
  };

  const byKey = new Map(scenes.map((s) => [s.scene_key, s]));
  const seen = new Set<string>();
  const narration: PlannedFilmAudio['narration'] = [];
  const accept = (entries: unknown, truncated: boolean) => {
    const list: any[] = Array.isArray(entries) ? [...entries] : [];
    // A cut-off reply's last entry may be a half-written line — re-request it.
    if (truncated && list.length > 1) list.pop();
    for (const n of list) {
      const key = String(n?.scene_key || '');
      if (!byKey.has(key) || seen.has(key)) continue;
      seen.add(key);
      const source = ['elevenlabs', 'video_native', 'none'].includes(n?.voice_source) ? n.voice_source : 'elevenlabs';
      narration.push({ scene_key: key, voice_source: source, text: String(n?.text || '').replace(/\s+/g, ' ').trim().slice(0, 900) });
    }
  };
  accept(raw?.narration, first.truncated);

  // Every scene the main plan did not reach is narrated in follow-up chunks
  // until none is missing. There is no pass limit — the loop is driven by the
  // missing scenes alone — and a sound director that stops making progress is
  // a loud error, never a film whose tail goes quiet.
  let stalls = 0;
  for (;;) {
    const missing = scenes.filter((s) => !seen.has(s.scene_key));
    if (!missing.length) break;
    const chunk = missing.slice(0, NARRATION_FILL_CHUNK);
    const firstIdx = chunk[0]?.idx ?? 0;
    const lastIdx = chunk[chunk.length - 1]?.idx ?? firstIdx;
    const earlier = narration
      .filter((n) => n.text && (byKey.get(n.scene_key)?.idx ?? 0) < firstIdx)
      .sort((a, b) => (byKey.get(a.scene_key)?.idx ?? 0) - (byKey.get(b.scene_key)?.idx ?? 0))
      .slice(-3)
      .map((n) => `- scene ${(byKey.get(n.scene_key)?.idx ?? 0) + 1}: "${n.text}"`)
      .join('\n');
    const parts = [
      filmLine,
      storyLine,
      `VOICE PLAN (decided): ${voice_plan.tone} · ${voice_plan.energy} energy · ${voice_plan.pace} pace · ${voice_plan.emotion} · language ${voice_plan.language} · accent ${voice_plan.accent}`,
      earlier ? `EARLIER LINES (already narrated — continue after them, never repeat them):\n${earlier}` : '',
      `SCENES TO NARRATE (in order, with REAL durations — one entry each):\n${chunk.map(sceneLine).join('\n')}`,
      stalls ? 'NOTE: the previous attempt returned no entry for these scene_keys. Answer with one entry per listed scene_key, copied exactly.' : '',
    ].filter(Boolean);
    const fill = await askOpusJsonDetailed<any>({
      system: NARRATION_FILL_SYSTEM,
      user: [...parts, scriptBlockFor(NARRATION_FILL_SYSTEM + parts.join('\n\n'))].join('\n\n'),
      maxTokens: 8192,
      effort: 'medium',
    });
    const covered = seen.size;
    accept(fill.value?.narration, fill.truncated);
    if (seen.size === covered) {
      stalls += 1;
      if (stalls > 1) {
        throw new Error(`The sound director returned no narration for scenes ${firstIdx + 1}–${lastIdx + 1} after repeated attempts (${missing.length} of ${scenes.length} scenes still have no entry) — plan the audio again.`);
      }
    } else {
      stalls = 0;
    }
  }
  // Every scene has exactly one entry: the loop above only ends when none is
  // missing. This fallback merely keeps the shape honest if a scene key ever
  // slipped through; it is not a place where scenes go quiet.
  for (const s of scenes) {
    if (seen.has(s.scene_key)) continue;
    const hasDialogue = !!(s.dialogue && String((s.dialogue as any).line || '').trim());
    narration.push({ scene_key: s.scene_key, voice_source: hasDialogue ? 'video_native' : 'none', text: '' });
  }
  narration.sort((a, b) => (byKey.get(a.scene_key)?.idx ?? 0) - (byKey.get(b.scene_key)?.idx ?? 0));
  // Guard the one-voice rule: a dialogue scene never gets ElevenLabs narration.
  for (const n of narration) {
    const s = byKey.get(n.scene_key)!;
    if (s.dialogue && String((s.dialogue as any).line || '').trim() && n.voice_source === 'elevenlabs') {
      n.voice_source = 'video_native';
      n.text = '';
    }
    if (n.voice_source === 'elevenlabs' && !n.text) n.voice_source = 'none';
  }
  if (!narration.some((n) => n.voice_source !== 'none')) {
    throw new Error('The sound director produced an empty narration plan — plan the audio again.');
  }

  const m = raw?.music || {};
  const PRESETS = ['corporate', 'tech', 'uplifting', 'calm', 'energetic', 'playful', 'cinematic', 'lofi'];
  const music: PlannedFilmAudio['music'] = {
    required: m.required !== false,
    preset: PRESETS.includes(String(m.preset)) ? String(m.preset) : 'cinematic',
    customPrompt: String(m.custom_prompt || m.customPrompt || '').slice(0, 800) || undefined,
    mood: String(m.mood || '').slice(0, 200) || undefined,
    volume: Math.min(0.35, Math.max(0.08, Number(m.volume) || 0.22)),
  };

  const sfx: PlannedFilmAudio['sfx'] = (Array.isArray(raw?.sfx) ? raw.sfx : [])
    .filter((f: any) => f && byKey.has(String(f.scene_key)) && String(f.prompt || f.description || '').trim())
    .slice(0, 6)
    .map((f: any) => {
      const scene = byKey.get(String(f.scene_key))!;
      const dur = Number(scene.duration_s) || 6;
      return {
        scene_key: String(f.scene_key),
        description: String(f.description || 'sound effect').slice(0, 160),
        prompt: String(f.prompt || f.description).slice(0, 300),
        at_s: Math.min(Math.max(0, Number(f.at_s) || 0), Math.max(0, dur - 0.5)),
        volume: Math.min(0.45, Math.max(0.1, Number(f.volume) || 0.25)),
      };
    });

  return { voice_plan, narration, music, sfx };
}

const TIGHTEN_SYSTEM = `You shorten ONE narration line so it fits its scene duration when spoken aloud (~2.3 words/second), preserving the meaning, all names, numbers and technical terms exactly. Natural spoken wording, same language as the input. Reply with ONE JSON object: { "text": str }.`;

/** Timing mismatch resolver: rewrite a narration line to fit the scene's real
 * duration while preserving meaning — never speed the voice up unnaturally. */
export async function tightenNarrationLine(text: string, targetSeconds: number): Promise<string> {
  const out = await askOpusJson<{ text: string }>({
    system: TIGHTEN_SYSTEM,
    user: `TARGET: at most ${Math.max(2, Math.floor(targetSeconds * 2.3))} words (~${targetSeconds.toFixed(1)}s spoken).\nLINE:\n"""\n${text}\n"""`,
    maxTokens: 1024,
    effort: 'low',
  });
  const tightened = String(out?.text || '').replace(/\s+/g, ' ').trim();
  return tightened.length >= 3 ? tightened.slice(0, 900) : text;
}

/** Build the one-off portrait brief for a character's locked reference image.
 * Model-made portraits are never rejected by the provider's real-person filter. */
export function characterPortraitBrief(character: { name: string; appearance: string }, visualStyle: string): string {
  return [
    `Full-body studio reference portrait of a fictional character: ${character.appearance}.`,
    'Neutral standing pose, arms relaxed, facing camera, full figure visible head to shoes.',
    'Plain seamless mid-grey backdrop, soft even lighting, photorealistic, sharp focus.',
    visualStyle ? `Rendered in the film's visual style: ${visualStyle}.` : '',
    'No text, no logos, no watermark.',
  ].filter(Boolean).join(' ');
}
