/**
 * OPUS 5 — the single AI brain of the Script-to-Video pipeline.
 *
 * Every AI decision in this pipeline goes through claude-opus-5 on the
 * platform Anthropic proxy (POST /proxy/anthropic/v1/messages, authenticated
 * with X-Workspace-DB-Token): script understanding, scene planning, per-scene
 * visual decisions, Veo prompt generation, graphic/diagram specs, asset
 * selection, continuity management, timing, and post-render validation.
 *
 * Contract notes (platform docs): Opus 5 cannot disable thinking — pair
 * thinking:{type:'adaptive'} with output_config:{effort}. max_tokens ≤ 8192.
 * Never send temperature/top_p/top_k. `system` is a top-level string.
 */

import {
  AssetRow, AudioMusicPlan, AudioNarrationEntry, AudioSfxItem, Film,
  FilmCharacter, FilmPlan, FilmScene, FilmStyle, PlanScene, ReferenceType,
  SceneDialogue, SceneType, VeoSpec, VoicePlan, newSceneKey, wsToken,
} from '../api';

const MODEL = 'claude-opus-5';

interface OpusCall {
  system: string;
  user: string;
  /** Public https image URLs attached as vision inputs. */
  images?: string[];
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export async function askOpus({ system, user, images = [], maxTokens = 4096, effort = 'medium' }: OpusCall): Promise<string> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const content: any[] = images
    .filter((u) => typeof u === 'string' && u.startsWith('https://'))
    .map((url) => ({ type: 'image', source: { type: 'url', url } }));
  content.push({ type: 'text', text: user });
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: Math.min(8192, maxTokens),
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const detail = String(data?.error?.message || data?.error || `The director did not answer (HTTP ${res.status})`);
    // Provider-account failures (exhausted credit, invalidated key) are the
    // PLATFORM's shared AI account — not this workspace, the wallet, or a
    // usage limit in this app. Say that instead of relaying the provider's
    // misleading "go to Plans & Billing" instruction.
    if (/credit balance is too low|api key is invalid|api key has been invalidated|authentication_error|token_invalidated/i.test(detail)) {
      throw new Error(`The AI provider behind Audos is temporarily unavailable (provider answered: ${detail.slice(0, 120)}). This is a platform-side account issue — not your account, your wallet, or a limit in this app. Try again shortly.`);
    }
    const code = data?.code ? ` [${data.code}]` : '';
    throw new Error(`${detail}${code}`);
  }
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => String(b.text || ''))
    .join('');
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
  const text = await askOpus(call);
  try {
    return extractJson<T>(text);
  } catch (first: any) {
    const strict = await askOpus({
      ...call,
      system: call.system + '\n\nCRITICAL OUTPUT RULE: reply with ONE complete, syntactically valid JSON value and NOTHING else — no markdown fences, no commentary, no trailing commas. If space is tight, shorten string values rather than cutting the JSON off.',
    });
    try {
      return extractJson<T>(strict);
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

const VALIDATE_SYSTEM = `You are the quality judge of a script-to-video pipeline. You see 1-2 frames from a rendered scene plus the script segment it must illustrate. Reply with ONE JSON object: { "pass": bool, "issues": str }.
Fail ONLY on real errors: the frame clearly shows the wrong subject/scene for the segment, a broken/black/empty frame, garbled or misspelled on-screen text, or a different person than the segment implies. Reasonable artistic interpretation, staging variation and abstract b-roll PASS. "issues" is one short sentence (empty when pass).`;

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

export interface SegmentedPlan {
  title: string;
  story_summary: string;
  world: string;
  visual_style: string;
  characters: { id: string; name: string; appearance: string }[];
  scenes: { script_segment: string; summary: string; visual_goal: string; duration_s: number; characters: string[]; dialogue: SceneDialogue | null }[];
}

const SEGMENT_SYSTEM = `You are the director of a sequential script-to-video pipeline. You read the ENTIRE script first and understand the complete story — characters, world, arc, tone — BEFORE splitting anything. Then you break the script into video clips by STORY LOGIC, never mechanical time slices. Reply with ONE JSON object and nothing else.

RULES:
- Every clip is AI-generated video footage. There are no graphics, text cards or overlays — pure visual storytelling.
- Clip durations are EXACTLY 4, 6, 8 or 10 seconds (the video model's supported lengths). Pick the duration that fits the beat.
- A long continuous action becomes MULTIPLE consecutive clips (e.g. a player dribbling up the court and scoring = dribble start → drive → jump → ball through hoop — each its own clip that will later continue from the previous clip's extracted final frame).
- The script is the source of truth. Never rewrite it. Split it into contiguous script_segment slices that together cover the whole script in order.
- 2–12 clips. Do not pad; do not compress several distinct beats into one clip.
- CHARACTERS: identify every recurring character and write a LOCKED, exhaustively specific appearance (age, build, face, hair, skin tone, exact clothing with colors, shoes, distinguishing details). Every clip that shows the character reuses this exact description verbatim — it is the continuity contract. Never use a real person's name or likeness; invent a generic character that fits the story.
- DIALOGUE (do not skip): read the script for SPOKEN LINES. A line a character speaks ON CAMERA in the scene (quoted dialogue attributed to a character who is visibly present) becomes that scene's "dialogue" object with the EXACT words from the script — never paraphrased, never invented, in the script's own language. Voice-over / narrator (VO) lines are NOT dialogue — they are narration, delivered later by the narration layer, so leave dialogue null for them. A scene with no one speaking on camera gets dialogue null.
- No readable on-screen text, UI, logos or captions in any clip — the video model cannot render text reliably. (Spoken dialogue is allowed and encouraged where the script has it — text on screen is not.)

OUTPUT SHAPE:
{ "title": str, "story_summary": str (the complete story in 3-6 sentences), "world": str (the shared setting/world), "visual_style": str (film-wide look: palette, lens language, lighting, mood), "characters": [{ "id": snake_case str, "name": str, "appearance": str }], "scenes": [{ "script_segment": str, "summary": str (what happens — one line), "visual_goal": str (the image this clip must land), "duration_s": 4|6|8|10, "characters": [character ids appearing], "dialogue": null | { "line": str (EXACT spoken words from the script), "speaker": character id, "delivery": str (tone/emotion/energy), "language": str, "accent": str } }] }`;

/** Stage 1 — Opus reads the WHOLE script, understands the full story, then
 * segments it into sequential clips at supported durations. */
export async function segmentScript(params: {
  script: string;
  aspect: string;
  note?: string | null;
  referenceImageUrl?: string | null;
}): Promise<SegmentedPlan> {
  const user = [
    `ASPECT RATIO: ${params.aspect}`,
    params.referenceImageUrl ? `A USER-PROVIDED REFERENCE IMAGE exists (a character/product/scene visual the clips can reference): ${params.referenceImageUrl}` : 'REFERENCE IMAGE: none provided.',
    params.note ? `DIRECTOR NOTE FROM THE USER: ${params.note}` : '',
    `SCRIPT (source of truth — read it COMPLETELY before segmenting; never rewrite it):\n"""\n${params.script}\n"""`,
  ].filter(Boolean).join('\n\n');
  const raw = await askOpusJson<any>({ system: SEGMENT_SYSTEM, user, maxTokens: 8192, effort: 'high' });
  const characters = (Array.isArray(raw?.characters) ? raw.characters : [])
    .filter((c: any) => c && (c.id || c.name))
    .map((c: any, i: number) => ({
      id: String(c.id || `char_${i + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      name: String(c.name || `Character ${i + 1}`).slice(0, 80),
      appearance: String(c.appearance || '').slice(0, 800),
    }));
  const snap = (n: unknown) => [4, 6, 8, 10].sort((a, b) => Math.abs(a - (Number(n) || 6)) - Math.abs(b - (Number(n) || 6)))[0];
  const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : [])
    .filter((s: any) => s && String(s.script_segment || '').trim())
    .map((s: any) => ({
      script_segment: String(s.script_segment),
      summary: String(s.summary || '').slice(0, 300),
      visual_goal: String(s.visual_goal || '').slice(0, 400),
      duration_s: snap(s.duration_s),
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
  if (!scenes.length) throw new Error('The director produced an empty clip plan — try again.');
  return {
    title: String(raw?.title || 'Untitled film').slice(0, 120),
    story_summary: String(raw?.story_summary || '').slice(0, 1500),
    world: String(raw?.world || '').slice(0, 800),
    visual_style: String(raw?.visual_style || '').slice(0, 800),
    characters,
    scenes,
  };
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

  const user = [
    `=== GLOBAL CONTEXT (the whole story) ===`,
    `TITLE: ${film.title || plan.title || ''}`,
    `STORY: ${plan.story_summary || ''}`,
    `WORLD: ${plan.world || ''}`,
    `VISUAL STYLE (applies to every clip): ${plan.visual_style || plan.style_direction || ''}`,
    charLines ? `CHARACTERS (locked appearances — reuse verbatim):\n${charLines}` : 'CHARACTERS: none recurring.',
    film.product_screenshot_url ? `SCENE/PRODUCT REFERENCE IMAGE available: ${film.product_screenshot_url}` : '',
    `FULL SCRIPT:\n"""\n${String(film.script || '').slice(0, 6000)}\n"""`,
    `\n=== SCENE CONTEXT (this clip) ===`,
    `CLIP ${scene.idx + 1}, duration ${scene.duration_s || planScene?.duration_s || 6}s, aspect ${film.aspect_ratio || '16:9'}.`,
    `SCRIPT SEGMENT: "${scene.script_segment}"`,
    (spec.summary || planScene?.summary) ? `WHAT HAPPENS: ${spec.summary || planScene?.summary}` : '',
    (spec.visual_goal || planScene?.visual_goal) ? `VISUAL GOAL: ${spec.visual_goal || planScene?.visual_goal}` : '',
    dialogue
      ? `ON-CAMERA DIALOGUE (the character speaks this line in this clip — stage the delivery; the exact Dialogue block is appended automatically): speaker=${dialogue.speaker || 'the character'}, delivery=${dialogue.delivery}, language=${dialogue.language}${dialogue.accent ? `, accent=${dialogue.accent}` : ''}. Line: "${dialogue.line}"`
      : 'ON-CAMERA DIALOGUE: none — nobody speaks to camera in this clip (the narration layer carries the words).',
    `\n=== CONTINUITY CONTEXT ===`,
    continuity,
    params.revisionNote ? `\nREVISION NOTE (the previous attempt failed or must improve — address this directly): ${params.revisionNote}` : '',
  ].filter(Boolean).join('\n');

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
  if (dialogue) {
    const block = buildDialogueBlock(dialogue, film);
    prompt = `${prompt.replace(/\s*Dialogue:\s*"[\s\S]*$/i, '').trim().slice(0, Math.max(200, 1000 - block.length - 2))}\n${block}`;
  } else {
    const noTalk = 'speaking to camera, talking, moving lips as if speaking, voice-over';
    if (!/speaking to camera/i.test(negative)) negative = `${negative}, ${noTalk}`.slice(0, 500);
  }

  return {
    continuation,
    reference_type: referenceType,
    needs_character: out?.needs_character ? String(out.needs_character) : null,
    prompt: prompt.slice(0, 1000),
    negative,
    reasoning: String(out?.reasoning || '').slice(0, 300),
  };
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

const AUDIO_PLAN_SYSTEM = `You are the sound director of a script-to-video pipeline. The video clips are ALREADY generated — you plan the complete audio experience for them: one narration voice, per-scene narration lines, a music bed, and sparse sound effects. Reply with ONE JSON object and nothing else.

THE ORIGINAL SCRIPT IS THE SOURCE OF TRUTH (hard rules):
- The narration preserves the meaning of the original script. NEVER invent product claims, statistics, features, numbers or promises that are not in the script. Names, numbers and technical terms are preserved EXACTLY.
- You MAY rewrite wording so it sounds natural SPOKEN aloud (drop markdown/stage directions/"Scene 3" labels, smooth written-language phrasing into speech), but the story and facts stay the script's.
- Keep the script's own language: a Hindi/Hinglish script is narrated in Hindi/Hinglish, not translated.

VOICE PLAN (one consistent voice for the whole film):
- Decide tone, energy, pace, emotion, language and accent from the script's content and mood.
- Choose ONE voice from the AVAILABLE VOICES list whose name/labels best match. Use its exact id. The same voice is reused for every line and every regeneration.

NARRATION (one entry PER SCENE, in order — every scene_key exactly once):
- voice_source "elevenlabs": the scene gets a narration line — write "text" as the natural spoken wording of THAT scene's script segment (its VO/narration content).
- voice_source "video_native": the scene has ON-CAMERA DIALOGUE (marked in the scene list) — the clip's own generated voice carries it. text = "". Never narrate over on-camera dialogue.
- voice_source "none": the scene genuinely has no words (pure visual beat). text = "".
- TIMING (hard rule): a comfortable narrator speaks ~2.3 words per second. Each scene's text must fit INSIDE its real duration (listed): duration 6s → at most ~13 words. Better slightly short than long. Never pad to fill.
- Split the script's narration across scenes so that, read in order, it covers the whole script's meaning without repeating lines.

MUSIC (respond to the script, not a constant loop):
- Decide whether music serves this film (required true/false — most films: true).
- preset: one of corporate | tech | uplifting | calm | energetic | playful | cinematic | lofi (the closest base).
- customPrompt: a 1-3 sentence instrumental brief — style, energy, tempo, mood, and the ARC (stronger opening hook, lower under explanation, controlled rise at the reveal, clean finish for the CTA). Instrumental only, no vocals.
- volume: 0.1–0.3 (music SUPPORTS — narration always takes priority and the mixer ducks music under speech automatically).

SFX (subtle, sparse — quality over quantity):
- 0–6 total for the whole film, ONLY where a sound genuinely lands a visual event (whoosh on a fast reveal, soft impact on a landing, UI tick on an interface moment, rising swell into the climax). Most scenes get NONE. Never place SFX over an on-camera dialogue line.
- Each: scene_key, description (what visual event it marks), prompt (a short sound-design brief: "short airy whoosh, fast transient, no music, no melody"), at_s (seconds from that scene's start, before the scene ends), volume 0.15–0.4.

OUTPUT SHAPE:
{ "voice_plan": { "tone": str, "energy": str, "pace": str, "emotion": str, "language": str, "accent": str, "voice_id": str (exact id from the list), "voice_name": str },
  "narration": [{ "scene_key": str, "voice_source": "elevenlabs"|"video_native"|"none", "text": str }],
  "music": { "required": bool, "preset": str, "custom_prompt": str, "mood": str, "volume": num },
  "sfx": [{ "scene_key": str, "description": str, "prompt": str, "at_s": num, "volume": num }] }`;

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
  const sceneLines = scenes.map((s) => {
    const d = s.dialogue && String((s.dialogue as any).line || '').trim() ? s.dialogue : null;
    return [
      `- scene_key=${s.scene_key} · scene ${s.idx + 1} · real duration ${Number(s.duration_s) || 6}s`,
      `  segment: "${String(s.script_segment || '').replace(/\s+/g, ' ').slice(0, 500)}"`,
      d ? `  ON-CAMERA DIALOGUE (voice_source must be video_native): ${d.speaker || 'character'} says "${d.line}"` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');
  const voiceLines = params.voices.slice(0, 40)
    .map((v) => `- id=${v.id} · ${v.name}${v.labels ? ` · ${Object.entries(v.labels).map(([k, val]) => `${k}:${val}`).join(' ')}` : ''}`)
    .join('\n');
  const user = [
    `FILM: ${film.title || 'Untitled'} · ${scenes.length} scenes · total ~${Math.round(scenes.reduce((n, s) => n + (Number(s.duration_s) || 6), 0))}s`,
    `STORY: ${film.plan?.story_summary || ''}`,
    `VISUAL STYLE / MOOD: ${film.plan?.visual_style || film.plan?.style_direction || ''}`,
    `SCENES (in order, with REAL durations):\n${sceneLines}`,
    voiceLines ? `AVAILABLE VOICES (choose one id):\n${voiceLines}` : 'AVAILABLE VOICES: none listed — set voice_id to "" and voice_name to "default".',
    `ORIGINAL SCRIPT (source of truth — preserve its meaning, names and numbers exactly):\n"""\n${String(film.script || '').slice(0, 9000)}\n"""`,
  ].join('\n\n');
  const raw = await askOpusJson<any>({ system: AUDIO_PLAN_SYSTEM, user, maxTokens: 8192, effort: 'high' });

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
  for (const n of (Array.isArray(raw?.narration) ? raw.narration : [])) {
    const key = String(n?.scene_key || '');
    if (!byKey.has(key) || seen.has(key)) continue;
    seen.add(key);
    const source = ['elevenlabs', 'video_native', 'none'].includes(n?.voice_source) ? n.voice_source : 'elevenlabs';
    narration.push({ scene_key: key, voice_source: source, text: String(n?.text || '').replace(/\s+/g, ' ').trim().slice(0, 900) });
  }
  // Every scene gets exactly one entry — a scene Opus forgot becomes an
  // explicit gap the caller can see, never a silent omission.
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
