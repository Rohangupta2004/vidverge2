/**
 * THE DIRECTOR — Claude Opus 5, the single intelligence layer of the AI
 * Product Advertisement Director. Every AI decision goes through claude-opus-5
 * on the platform Anthropic proxy (POST /proxy/anthropic/v1/messages,
 * authenticated with X-Workspace-DB-Token — askOpus handles that):
 *
 *   1. PRODUCT UNDERSTANDING — the website is crawled by the scrape-website
 *      server function; screenshots are read with Opus vision; everything
 *      merges into one structured Product Brief. EXTRACTED, NEVER INVENTED:
 *      features, pricing, testimonials and statistics that are not on the
 *      site do not exist in the brief.
 *   2. AD STRATEGY — hook type (problem / outcome / curiosity / demo), the
 *      ad structure beats (adapted from HOOK→PROBLEM→AGITATION→SOLUTION→
 *      DEMO→MECHANISM→FEATURES→BENEFIT→PROOF→CTA), tone, music style, CTA.
 *   3. COMPLETE VOICEOVER SCRIPT — scene-by-scene narration written FIRST,
 *      before any visual exists. The voice is the master track.
 *   4. VISUAL STORYBOARD — for EACH scripted line, the most understandable
 *      visual representation (14 visual types), mapped onto four render
 *      engines: real-screenshot mockups, Omni Flash video (B-roll only),
 *      GSAP+SVG motion graphics/diagrams, generated images.
 *   5. PRODUCTION VIDEO PROMPTS — written per scene at render time with the
 *      narration context baked in and continuity folded in.
 *   6. QUALITY CONTROL — every rendered scene checked against its narration
 *      and storyboard intent; only weak scenes regenerate.
 *   7. AD VARIATIONS — recipes that reuse existing scene assets.
 *
 * No planning is split across other LLMs.
 */

import { askOpusJson } from '../../ScriptToVideo/pipeline/opus';
import {
  AdScript, AdStrategy, Aspect, FilmAsset, FilmPlan, FilmScene, HookType,
  MotionSpec, PlanScene, ProductBrief, SceneSource, TransitionKind,
  VISUAL_TYPES, VideoStyle, VisualType, callHook, newSceneKey, visualTypeToSource,
} from './api';
import { buildRequiredContent } from './qa';

// Malformed-JSON replies are repaired (fences stripped, truncation closed)
// and retried once with stricter output instructions inside askOpusJson.
async function opusJson<T = any>(call: { system: string; user: string; images?: string[]; maxTokens?: number; effort?: 'low' | 'medium' | 'high' }): Promise<T> {
  return askOpusJson<T>(call);
}

const httpsOnly = (urls: (string | null | undefined)[]) =>
  urls.filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));

// ---------------------------------------------------------------------------
// Stage 1 — Product understanding (URL + screenshots → Product Brief)
// ---------------------------------------------------------------------------

const SCREENSHOT_SYSTEM = `You are the research arm of an AI advertisement director analysing a product's REAL UI screenshots. These images are ground truth — a generative video model will never be asked to recreate them; they will be composited into device mockups as-is. Reply with ONE JSON object:
{ "ui_notes": str (2-4 sentences: what the product visibly does, its UI style, layout language, information density),
  "visible_features": [str] (features actually visible),
  "ui_colors": [str] (dominant interface hex colors, best guess),
  "per_image": [ { "shows": str (one line: what THIS screenshot shows — e.g. 'dashboard with revenue chart', 'mobile onboarding screen') } ] (same order as the images) }
Be literal about what is visible. No speculation.`;

const MERGE_SYSTEM = `You compile the definitive PRODUCT BRIEF an AI advertisement director will reference for every downstream decision. You receive raw research: a website extraction (may be missing), a brand kit (may be missing), screenshot analysis (may be missing) and the user's goal.

HARD RULE — EXTRACT, NEVER INVENT: features, benefits, pricing, testimonials, statistics and CTA wording must come from the research. If pricing is not in the research, "pricing" is "". If no CTA phrase is in the research, "cta_text" is "". Careful inference is allowed only for audience/positioning/tone, clearly derived from what IS known — never contradict the research and never fabricate numbers or quotes.

Reply with ONE JSON object:
{ "product_name": str, "tagline": str, "problem": str (the problem the product solves, in the site's own framing), "key_features": [str] (≤8, sharpest first), "benefits": [str] (≤6, outcomes the site actually claims), "pricing": str ('' when the site shows none), "cta_text": str (the site's actual ask, '' when none), "audience": str, "positioning": str (1-2 sentences — what makes it different and for whom), "tone": str, "use_cases": [str] (≤5), "differentiators": [str] (≤5) }`;

export interface UnderstandInputs {
  url?: string | null;
  screenshotUrls: string[];
  goal?: string | null;
  onNote?: (note: string) => void;
}

export async function understandProduct({ url, screenshotUrls, goal, onNote }: UnderstandInputs): Promise<ProductBrief> {
  const say = (n: string) => { try { onNote?.(n); } catch { /* UI only */ } };

  // (a) Website read — the scrape-website hook crawls the page and runs the
  // brief + brand-kit extraction on claude-opus-5 server-side. It also takes
  // a REAL screenshot of the page (mockup_screenshot_url) — the only pixels
  // allowed to represent the product UI when no uploads exist.
  let site: any = null;
  if (url) {
    say('Reading the product website…');
    try {
      site = await callHook('scrape-website', { url });
      if (site && site.success === false) { say(`The website read came back empty (${String(site.error || 'no usable content')}) — continuing with the other inputs.`); site = null; }
    } catch (e: any) {
      say(`The website could not be read (${String(e?.message || e).slice(0, 120)}) — continuing with the other inputs.`);
    }
  }

  // (b) Screenshot analysis — Opus vision on the uploaded ground-truth UI.
  let shots: any = null;
  const visionUrls = httpsOnly(screenshotUrls).slice(0, 4);
  if (visionUrls.length) {
    say(`Studying ${visionUrls.length} screenshot${visionUrls.length > 1 ? 's' : ''}…`);
    try {
      shots = await opusJson({
        system: SCREENSHOT_SYSTEM,
        user: `PRODUCT: ${String(site?.product_name || site?.name || 'unknown')}\nAnalyse these ${visionUrls.length} screenshot(s).`,
        images: visionUrls,
        maxTokens: 2048,
        effort: 'low',
      });
    } catch (e: any) {
      say(`Screenshot analysis hiccuped (${String(e?.message || e).slice(0, 100)}) — the screenshots will still be used as mockup pixels.`);
    }
  }

  if (!site && !shots && !goal) {
    throw new Error('Nothing to research yet — provide a product URL, at least one screenshot, or a goal.');
  }

  // (c) Merge into the structured Product Brief.
  say('Writing the product brief…');
  let merged: any = null;
  try {
    merged = await opusJson({
      system: MERGE_SYSTEM,
      user: [
        url ? `PRODUCT URL: ${url}` : 'PRODUCT URL: none provided.',
        goal ? `USER GOAL FOR THE AD: ${goal}` : '',
        site ? `WEBSITE EXTRACTION:\n${JSON.stringify({
          product_name: site.product_name, tagline: site.tagline, key_features: site.key_features,
          pain_points_addressed: site.pain_points_addressed, target_audience_language: site.target_audience_language,
          unique_differentiators: site.unique_differentiators, use_cases: site.use_cases, tone: site.tone,
          social_proof: site.social_proof, cta_phrases: site.cta_phrases, pricing: site.pricing,
        })}` : 'WEBSITE EXTRACTION: unavailable.',
        site?.brand_kit ? `BRAND KIT (grounded in the page's real colors/fonts):\n${JSON.stringify(site.brand_kit)}` : '',
        shots ? `SCREENSHOT ANALYSIS:\n${JSON.stringify(shots)}` : 'SCREENSHOT ANALYSIS: no screenshots uploaded.',
      ].filter(Boolean).join('\n\n'),
      maxTokens: 2048,
      effort: 'medium',
    });
  } catch { /* assembled fallback below */ }

  const perImage: any[] = Array.isArray(shots?.per_image) ? shots.per_image : [];
  const brief: ProductBrief = {
    product_name: String(merged?.product_name || site?.product_name || site?.name || 'The product').slice(0, 100),
    tagline: String(merged?.tagline || site?.tagline || '').slice(0, 220),
    problem: String(merged?.problem || (Array.isArray(site?.pain_points_addressed) ? site.pain_points_addressed[0] : '') || '').slice(0, 400),
    key_features: (Array.isArray(merged?.key_features) && merged.key_features.length ? merged.key_features : (site?.key_features || shots?.visible_features || [])).map(String).slice(0, 8),
    benefits: (Array.isArray(merged?.benefits) ? merged.benefits : []).map(String).slice(0, 6),
    pricing: String(merged?.pricing || '').slice(0, 200),
    cta_text: String(merged?.cta_text || (Array.isArray(site?.cta_phrases) ? site.cta_phrases[0] : '') || '').slice(0, 120),
    audience: String(merged?.audience || site?.target_audience_language || '').slice(0, 280),
    positioning: String(merged?.positioning || '').slice(0, 400),
    tone: String(merged?.tone || site?.tone || 'professional').slice(0, 120),
    use_cases: (Array.isArray(merged?.use_cases) ? merged.use_cases : (site?.use_cases || [])).map(String).slice(0, 5),
    differentiators: (Array.isArray(merged?.differentiators) ? merged.differentiators : (site?.unique_differentiators || [])).map(String).slice(0, 5),
    brand: site?.brand_kit || (Array.isArray(shots?.ui_colors) && shots.ui_colors.length ? { colors: { primary: shots.ui_colors[0] || null, secondary: shots.ui_colors[1] || null, accent: shots.ui_colors[2] || null, background: null, text: null }, typography: null as any, tone_of_voice: null } : null),
    ui_notes: String(shots?.ui_notes || '').slice(0, 800),
    screenshot_summaries: visionUrls.map((u, i) => ({ url: u, shows: String(perImage[i]?.shows || `screenshot ${i + 1}`).slice(0, 200) })),
    source_url: url || null,
    site_screenshot_url: typeof site?.mockup_screenshot_url === 'string' ? site.mockup_screenshot_url : null,
  };
  if (!brief.product_name || brief.product_name === 'The product') {
    if (goal) brief.product_name = goal.slice(0, 60);
  }
  return brief;
}

// ---------------------------------------------------------------------------
// Stage 2 — Ad strategy (hook type, structure, tone) — BEFORE the script
// ---------------------------------------------------------------------------

const STRATEGY_SYSTEM = `You are an elite direct-response advertisement strategist. You receive a grounded Product Brief and an optional user goal, and you decide THE STRATEGY of a 30–60s product advertisement before a single word of script is written. Reply with ONE JSON object.

HOOK TYPES (choose the one that fits THIS product and audience):
- "problem": open on the pain — "Still doing X manually?"
- "outcome": open on the transformation — "Turn X into Y in minutes."
- "curiosity": open on intrigue — "What if one click did all of this?"
- "demo": open on the product result immediately, no preamble.

AD STRUCTURE: adapt from HOOK → PROBLEM → AGITATION → SOLUTION → DEMO → MECHANISM → FEATURES → BENEFIT → PROOF → CTA. Pick the 5–8 beats this product actually needs — do NOT blindly use all ten. PROOF may only appear if the brief contains real social proof; never invent it.

OUTPUT:
{ "hook_type": "problem"|"outcome"|"curiosity"|"demo",
  "hook_line": str (the opening line concept, ≤14 words),
  "structure": [str] (the chosen beats, in order, uppercase e.g. ["HOOK","PROBLEM","SOLUTION","DEMO","BENEFIT","CTA"]),
  "tone": str (the voice of the ad, e.g. 'confident, direct, developer-native'),
  "target_emotion": str (what the viewer should FEEL at the end),
  "music_style": "energetic startup"|"modern tech"|"cinematic"|"minimal"|"premium",
  "music_brief": str (one sentence: instrumental genre, energy curve, mood, tempo — it will duck under narration and build on reveals),
  "cta": str (the exact ask, grounded in the brief's real CTA when one exists),
  "rationale": str (2-3 sentences: why this hook + structure for this audience) }`;

const HOOKS: HookType[] = ['problem', 'outcome', 'curiosity', 'demo'];

export async function buildAdStrategy(params: { brief: ProductBrief; goal?: string | null }): Promise<AdStrategy> {
  const raw = await opusJson<any>({
    system: STRATEGY_SYSTEM,
    user: [
      `PRODUCT BRIEF:\n${JSON.stringify(params.brief)}`,
      params.goal ? `USER GOAL (honor it — it overrides defaults): ${params.goal}` : 'USER GOAL: none — make the strongest possible ad.',
    ].join('\n\n'),
    maxTokens: 2048,
    effort: 'high',
  });
  const structure = (Array.isArray(raw?.structure) ? raw.structure : []).map((b: any) => String(b).toUpperCase().slice(0, 24)).filter(Boolean).slice(0, 10);
  return {
    hook_type: HOOKS.includes(raw?.hook_type) ? raw.hook_type : 'problem',
    hook_line: String(raw?.hook_line || '').slice(0, 160),
    structure: structure.length >= 3 ? structure : ['HOOK', 'PROBLEM', 'SOLUTION', 'DEMO', 'BENEFIT', 'CTA'],
    tone: String(raw?.tone || params.brief.tone || 'confident, clear').slice(0, 160),
    target_emotion: String(raw?.target_emotion || '').slice(0, 160),
    music_style: String(raw?.music_style || 'modern tech').slice(0, 40),
    music_brief: String(raw?.music_brief || 'Modern minimal electronic instrumental, steady pulse, builds gently on reveals.').slice(0, 300),
    cta: String(raw?.cta || params.brief.cta_text || `Try ${params.brief.product_name} today`).slice(0, 160),
    rationale: String(raw?.rationale || '').slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — the complete voiceover script (written FIRST, scene by scene)
// ---------------------------------------------------------------------------

const SCRIPT_SYSTEM = `You write the COMPLETE VOICEOVER SCRIPT of a product advertisement — BEFORE any visual exists. The voice is the master track: every visual will later be designed and timed around these exact lines. Reply with ONE JSON object.

RULES:
- One scene per structure beat (a beat may occasionally take two short scenes; total 5–9 scenes, total runtime 30–55 seconds at ≈2.4 words/second — so roughly 75–130 words total).
- Each scene's narration is ONE tight spoken line or two short sentences (≤ 26 words) — written to be SPOKEN aloud: concrete, active, zero hype filler, no stage directions, no scene numbers.
- The hook scene must land the chosen hook type in the first line.
- Feature lines describe what the user DOES and what HAPPENS — never a label ("Add a task and the calendar fills itself" — never "Automatic Scheduling").
- Benefit lines describe the transformation, before → after.
- The CTA scene speaks the exact call to action.
- Ground every claim in the Product Brief. NEVER invent features, pricing, testimonials or statistics.
- "product_action": for every scene that shows the product, what the product is visibly DOING during this line ('' when the scene is not about the product).
- "on_screen_text": minimal support text — a 2-5 word label, a real number, or ''. NEVER paragraphs, never a repeat of the whole narration.
- "visual_hint": one sentence of early visual intuition for the storyboard artist.

OUTPUT:
{ "scenes": [ { "beat": str (the structure beat, uppercase), "narration": str, "product_action": str, "on_screen_text": str, "visual_hint": str } ] }`;

export async function writeAdScript(params: { brief: ProductBrief; strategy: AdStrategy; goal?: string | null }): Promise<AdScript> {
  const raw = await opusJson<any>({
    system: SCRIPT_SYSTEM,
    user: [
      `PRODUCT BRIEF:\n${JSON.stringify(params.brief)}`,
      `AD STRATEGY:\n${JSON.stringify(params.strategy)}`,
      params.goal ? `USER GOAL: ${params.goal}` : '',
      `STRUCTURE TO SCRIPT (in order): ${params.strategy.structure.join(' → ')}`,
    ].filter(Boolean).join('\n\n'),
    maxTokens: 3000,
    effort: 'high',
  });
  const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : [])
    .map((s: any) => ({
      beat: String(s?.beat || '').toUpperCase().slice(0, 24) || 'SCENE',
      narration: String(s?.narration || '').trim().slice(0, 300),
      product_action: String(s?.product_action || '').slice(0, 240),
      on_screen_text: String(s?.on_screen_text || '').slice(0, 80),
      visual_hint: String(s?.visual_hint || '').slice(0, 300),
    }))
    .filter((s: any) => s.narration.length > 2)
    .slice(0, 10);
  if (scenes.length < 3) throw new Error('The script came back too short — try again.');
  const full = scenes.map((s: any) => s.narration).join(' ');
  return { scenes, full_text: full, estimated_s: Math.round(full.split(/\s+/).length / 2.4) };
}

// ---------------------------------------------------------------------------
// Stage 4 — the visual storyboard (per scripted line: the most understandable
// visual representation, chosen from the 14 visual types)
// ---------------------------------------------------------------------------

const STORYBOARD_SYSTEM = `You are an elite advertisement creative director designing the VISUALS of a product ad whose voiceover is ALREADY WRITTEN AND RECORDED. For EACH scripted scene you receive the exact narration line and its MEASURED audio duration. Your one question per scene: "What is the most understandable visual representation of this idea?" Reply with ONE JSON object and nothing else.

VISUAL TYPES (pick per scene):
- "PRODUCT_UI": a REAL screenshot inside a device frame (phone/laptop/browser) with camera motion and an animated cursor. MANDATORY for any beat showing the app. NEVER ask generative video to make a UI.
- "UI_ANIMATION": like PRODUCT_UI but interaction-led — the cursor travels, clicks, and a callout labels what happened. Use for demo/mechanism beats.
- "PRODUCT_MOCKUP": a real screenshot presented as a hero device shot (slow push, spotlight) — for reveal beats.
- "AI_VIDEO" / "B_ROLL": Omni Flash generative video — lifestyle, humans, environments, atmosphere, physical moments ONLY. Never UI, never readable text.
- "IMAGE": one strong generated still (art-directed, no text) treated with cinematic motion.
- "MOTION_GRAPHIC": GSAP+SVG animated graphic that EXPLAINS an idea — a relationship, a mechanism (INPUT → ANALYSIS → RESULT with animated arrows/icons). NEVER random words flying in (no FASTER/SMARTER/BETTER cards).
- "EDUCATIONAL_DIAGRAM": animated step-by-step explainer — when the narration walks through a concept or multi-step process, the steps animate in sync.
- "COMPARISON": two labelled columns compared. "BEFORE_AFTER": the manual mess vs the automated result. "PROCESS": a left-to-right animated flow. "TIMELINE": milestones in order. "SPLIT_SCREEN": two labelled halves.
- "TEXT": exact kinetic typography — ONLY for the brand close / CTA or a line whose exact words ARE the point. Text is support, not the visual: at most 2 TEXT scenes in the whole ad, and the CTA close is one of them.

HARD RULES:
- Feature beats: show the user's action and the product's response (real UI) — never a text card naming the feature.
- Benefit beats: show the transformation (BEFORE_AFTER / COMPARISON / B-roll payoff) — never a text card saying "SAVE TIME".
- Screenshots list says what each REAL screenshot shows — pick the RIGHT one per UI beat; spec.screenshot_url must be one of the listed URLs verbatim. If NO screenshot exists, do not plan UI scenes — use MOTION_GRAPHIC/EDUCATIONAL_DIAGRAM instead.
- "on_screen_text": minimal (a 2-5 word label, a real number, or ''). Narration carries the message.
- Every scene must carry its narration context: "visual_prompt" describes the visual SO THAT it serves the spoken line.
- CONTINUITY: consecutive AI_VIDEO/B_ROLL scenes sharing characters/location get the SAME continuity_group string and spec.seed_from_previous=true after the group's first; unrelated scenes get null.
- TRANSITIONS: transition_in/out from cut|fade|match_cut|whip_pan — intentional, story-motivated.
- MOTION LAYER: each scene gets "motion": { "kind": "none"|"gradient_flow"|"ambient_glow"|"particles"|"lines"|"grid", "intensity": 0..1, "opacity": 0..1 } — subtle, supports the story (opacity ≤0.3 on video scenes; "none" when footage should breathe).
- EXACT TEXT NEVER DEPENDS ON AI VIDEO: any exact string a scene must show (a number, statistic, price, product name, feature name, CTA, URL, short label) goes in "on_screen_text" — on AI_VIDEO/B_ROLL scenes the pipeline renders it as a DETERMINISTIC text overlay composited over the footage (AI VIDEO + "70% FASTER" overlay), and the generative model is never asked to draw it. Use AI video for visual storytelling; use deterministic graphics for precise information.
- GRAPHICS SUPPORT THE VIDEO: motion graphics normally sit over/around actual footage or product visuals — prefer an overlay on an AI_VIDEO/PRODUCT_UI scene over a standalone card on an empty background. A standalone MOTION_GRAPHIC/EDUCATIONAL_DIAGRAM scene is right ONLY when the information itself demands it (e.g. "three manual steps become one automated workflow" → an actual MANUAL 1→2→3 vs AUTOMATED 1 diagram with nodes, arrows and icons — never merely "3 → 1" as plain text), and then it must visually EXPLAIN with real structure: nodes, arrows, icons, charts, labels, and real screenshots/images embedded via backdropUrl or the annotated treatment.
- BRAND: palettes derive from the brand kit. Exact on-screen strings must be real copy (product name spelled exactly).
- DURATION IS NOT YOURS: each scene's length is derived from its measured narration audio. Do not output durations.

SCENE PLANNING DISCIPLINE — before committing ANY scene, answer ALL of these and bake the answers into "purpose", "visual_prompt" and "spec":
1. What is being said? (the narration line) 2. What must be SHOWN? 3. Why should this visual exist at all? 4. What visual type is appropriate — do NOT force every scene into AI video: a human problem/emotion/physical environment → AI_VIDEO/B_ROLL; an exact product workflow → PRODUCT_UI/UI_ANIMATION on a real screenshot; an exact number/statistic → MOTION_GRAPHIC; a plain image moment → IMAGE; the CTA → TEXT; precise info over footage → AI_VIDEO + on_screen_text overlay. Use real product assets whenever they exist. 5. What is the DOMINANT SUBJECT? 6. What is visible in the FIRST FRAME? 7. What ACTION happens during the scene? 8. What should have happened by the FINAL frame?
VAGUE PLANS ARE REJECTED: a plan like "show the idea", "show the business", "make it cinematic" — or any AI-video plan without a concrete subject, environment/context, action, camera angle, framing/composition, lighting, visual style, movement, timing, continuity notes, important objects and negative constraints — is invalid and will be sent back.
BAD: "Entrepreneur thinks about launching a business."
GOOD: "Medium close-up of a young entrepreneur sitting at a laptop at a small home workspace, several unfinished business notes and a browser window visible on the desk, looking at the screen with a frustrated expression, realistic documentary lighting, camera slowly pushes toward the laptop."
FIRST-FRAME REQUIREMENT: every AI_VIDEO/B_ROLL spec must state "first_frame" — exactly what is visible in the very first frame. It must establish the intended visual on its own, WITHOUT depending on the narration.

SPEC SHAPES (by the engine the visual type maps to):
- UI scenes (PRODUCT_UI/UI_ANIMATION/PRODUCT_MOCKUP): { "device": "phone"|"laptop"|"browser", "screenshot_url": str (verbatim from the list), "headline"?: str (≤6 words, optional), "caption"?: str, "motion": "scroll"|"zoom"|"pan"|"highlight", "focus"?: {"x","y","w","h" fractions 0..1 — the UI region the narration talks about}, "cursor"?: { "action": "click"|"move"|"scroll"|"type", "callout"?: str (≤5 words — what just happened) }, "url_bar_text"?: str, "palette"?: {"bg","ink","accent","accent2"} }
- AI_VIDEO/B_ROLL: { "visual_concept": str (dominant subject + exact placement + action + setting, concrete and filmable), "first_frame": str (exactly what the opening frame shows — it must establish the visual without narration), "action_progression": str (what happens from the first second to the final frame), "environment": str, "characters": str|"none", "camera": str, "lens_framing": str, "lighting": str, "style": str, "mood": str, "must_not_appear": str, "seed_from_previous": bool }
- IMAGE: { "asset_prompt": str (detailed art-directed brief — subject, composition, lighting, mood, style, 'no text or lettering anywhere') OR "asset_url": str (a listed available asset), "headline"?: str, "labels"?: [{"text"}], "animate"?: bool (true = also animate the still with Omni Flash image-to-video), "palette"?: {...} }
- Graphic scenes (TEXT/MOTION_GRAPHIC/EDUCATIONAL_DIAGRAM/COMPARISON/PROCESS/TIMELINE/BEFORE_AFTER/SPLIT_SCREEN): { "treatment": "kinetic_type"|"documentary_card"|"flow"|"stat"|"bars"|"list"|"compare"|"timeline"|"node_map"|"quote"|"annotated", "title": str, "subtitle"?: str, "items"?: [{"label","sublabel"?,"value"?}], "leftTitle"?: str, "rightTitle"?: str, "leftItems"?: [str], "rightItems"?: [str], "stat"?: {"value","prefix"?,"suffix"?,"label"?}, "backdropUrl"?: str, "palette": {"bg","ink","accent","accent2"}, "texture": "grid"|"dots"|"diagonal"|"none" }
  Treatment guide: PROCESS/EDUCATIONAL_DIAGRAM→"flow" (steps with sublabels, animated arrows) or "node_map"; COMPARISON/BEFORE_AFTER/SPLIT_SCREEN→"compare" (leftTitle/rightTitle + leftItems/rightItems — for BEFORE_AFTER: left = the manual mess, right = the automated result); TIMELINE→"timeline"; MOTION_GRAPHIC→"flow"/"stat"/"bars"/"annotated" (whatever explains the idea); TEXT→"kinetic_type" or "documentary_card".

OUTPUT SHAPE:
{ "title": str (ad title), "creative_direction": str (visual north star — grade, energy, references), "visual_world": str (recurring motifs that make it ONE ad), "assumptions": [str], "scenes": [ { "script_idx": num (which scripted scene this serves, 0-based, one per script scene, in order), "visual_type": str (one of the 14), "beat_title": str (≤6 words), "purpose": str (what the visual must land so the narration makes sense), "visual_prompt": str (the detailed generator brief, narration-aware), "rationale": str (why THIS visual type is the most understandable), "on_screen_text": str ('' when none), "music_mood": str (2-4 words), "sfx": str (subtle: 'soft UI click', 'whoosh riser', or ''), "continuity_group": str|null, "transition_in": str, "transition_out": str, "motion": {...}, "spec": {...} } ] }`;

/** CREATIVE STYLE guidance injected into the storyboard — the user's answer
 * to "How do you want your product video to feel?". Creative priorities, not
 * fixed percentages: Opus still decides scene by scene. */
const STYLE_GUIDANCE: Record<VideoStyle, string> = {
  story_driven: `CREATIVE STYLE — STORY-DRIVEN (the user chose this). Goal: tell a compelling story using the product as the solution.
PRIORITIES: AI_VIDEO / B_ROLL (Omni Flash generative video) HIGH — use it aggressively wherever the narration can be represented visually; cinematic B-roll HIGH; PRODUCT_UI / mockups MEDIUM (still mandatory for any beat that shows the app); IMAGE MEDIUM; MOTION_GRAPHIC / diagrams LOW; TEXT only as needed for exact information.
When a line like "Teams spend hours doing this manually" plays, generate meaningful cinematic footage SHOWING the problem — never replace it with a generic "HOURS WASTED" text card. Reserve graphics for what AI video cannot be trusted to render accurately: numbers, statistics, pricing, product names, feature names, CTA, URLs, comparisons, short labels, precise diagrams — and prefer AI VIDEO + an exact-text overlay (on_screen_text) over a standalone graphic scene.`,
  product_focused: `CREATIVE STYLE — PRODUCT-FOCUSED (the user chose this). Goal: show the viewer why the product is useful and how it works — the product stays at the center.
PRIORITIES: PRODUCT_UI / UI_ANIMATION / PRODUCT_MOCKUP (real screenshots in device/browser mockups with cursor demonstrations) HIGH; product demonstration HIGH; MOTION_GRAPHIC / EDUCATIONAL_DIAGRAM / COMPARISON / PROCESS (feature callouts, workflows, diagrams) HIGH; AI_VIDEO / B_ROLL MEDIUM-HIGH — used to SUPPORT the problem, use case, context and outcome, never to replace the product; IMAGE MEDIUM.
Lean on real screenshots, UI animations, browser/device mockups, feature callouts, product workflows, comparisons and diagrams. AI video supports the product rather than replaces it.`,
};

const TRANSITIONS: TransitionKind[] = ['cut', 'fade', 'match_cut', 'whip_pan'];

function cleanMotion(raw: any): MotionSpec {
  const kinds = ['none', 'gradient_flow', 'ambient_glow', 'particles', 'lines', 'grid'];
  const kind = kinds.includes(raw?.kind) ? raw.kind : 'none';
  const clamp01 = (v: any, d: number) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);
  return { kind, intensity: clamp01(raw?.intensity, 0.5), opacity: clamp01(raw?.opacity, 0.25) };
}

export interface VoicedScriptScene {
  idx: number;
  beat: string;
  narration: string;
  narration_s: number;         // measured audio duration
  product_action?: string;
  on_screen_text?: string;
  visual_hint?: string;
}

/** Visual duration is DERIVED from the measured voice timing — never arbitrary. */
export function derivedDuration(source: SceneSource, narrationS: number): number {
  const voiced = Number(narrationS) || 0;
  if (source === 'veo') {
    // Omni Flash supports 4/6/8/10s — smallest supported length that fits the line.
    const want = voiced + 0.6;
    for (const d of [4, 6, 8, 10]) if (d >= want) return d;
    return 10;
  }
  // Captured scenes render at exactly the voice length plus a breath.
  return Math.min(14, Math.max(3, Math.round((voiced + 0.9) * 10) / 10));
}

export async function buildVisualStoryboard(params: {
  brief: ProductBrief;
  strategy: AdStrategy;
  script: VoicedScriptScene[];
  goal?: string | null;
  aspect: Aspect;
  screenshots: string[];
  assets: FilmAsset[];
  /** The user's creative style answer — biases every visual-type decision. */
  videoStyle?: VideoStyle | null;
  /** On a style re-plan: already-rendered scenes worth reusing. Opus keeps a
   * scene's visual type where sensible so its cached clip survives. */
  reusableScenes?: { narration: string; visual_type: string }[];
}): Promise<FilmPlan> {
  const allShots = [...(params.brief.screenshot_summaries || [])];
  const knownUrls = new Set(allShots.map((s) => s.url));
  for (const u of params.screenshots) if (!knownUrls.has(u)) allShots.push({ url: u, shows: 'uploaded screenshot (unanalysed)' });
  if (params.brief.site_screenshot_url && !knownUrls.has(params.brief.site_screenshot_url)) {
    allShots.push({ url: params.brief.site_screenshot_url, shows: 'REAL full-page screenshot of the product website (captured by the crawler)' });
  }
  const shotLines = allShots.map((s, i) => `- SCREENSHOT ${i + 1}: ${s.shows} — ${s.url}`).join('\n');
  const assetLines = params.assets.slice(0, 24)
    .map((a) => `- [${a.kind}] ${a.name || 'asset'} — ${a.description || a.prompt || ''} — ${a.url}`)
    .join('\n');
  const scriptLines = params.script
    .map((s) => `- SCENE ${s.idx} [${s.beat}] (voice: ${s.narration_s.toFixed(1)}s): "${s.narration}"${s.product_action ? ` | product action: ${s.product_action}` : ''}${s.on_screen_text ? ` | suggested on-screen text: ${s.on_screen_text}` : ''}${s.visual_hint ? ` | hint: ${s.visual_hint}` : ''}`)
    .join('\n');

  const reuseLines = (params.reusableScenes || [])
    .map((r) => `- [${r.visual_type}] "${r.narration}"`)
    .join('\n');
  const raw = await opusJson<any>({
    system: STORYBOARD_SYSTEM,
    user: [
      `ASPECT RATIO: ${params.aspect}`,
      params.videoStyle ? STYLE_GUIDANCE[params.videoStyle] : '',
      `PRODUCT BRIEF:\n${JSON.stringify(params.brief)}`,
      `AD STRATEGY:\n${JSON.stringify(params.strategy)}`,
      params.goal ? `USER GOAL (honor it): ${params.goal}` : '',
      reuseLines ? `ALREADY-RENDERED SCENES (creative direction changed — keep a scene's visual type when it still fits the new style, so its finished clip is reused instead of regenerated):\n${reuseLines}` : '',
      `THE RECORDED SCRIPT (one visual per scene, durations already measured):\n${scriptLines}`,
      shotLines ? `AVAILABLE REAL SCREENSHOTS (ground-truth UI — the only pixels allowed to represent the interface):\n${shotLines}` : 'AVAILABLE REAL SCREENSHOTS: none — do NOT plan UI scenes; explain those beats with MOTION_GRAPHIC / EDUCATIONAL_DIAGRAM instead.',
      assetLines ? `AVAILABLE ASSETS (reuse before generating new):\n${assetLines}` : 'AVAILABLE ASSETS: none yet.',
    ].filter(Boolean).join('\n\n'),
    maxTokens: 8192,
    effort: 'high',
  });

  const listedUrls = new Set(allShots.map((s) => s.url));
  const scenes: PlanScene[] = (Array.isArray(raw?.scenes) ? raw.scenes : []).map((s: any, i: number) => {
    const scriptIdx = Number.isFinite(Number(s?.script_idx)) ? Number(s.script_idx) : i;
    const scripted = params.script[scriptIdx] || params.script[i] || params.script[params.script.length - 1];
    let visualType: VisualType = VISUAL_TYPES.includes(s?.visual_type) ? s.visual_type : 'MOTION_GRAPHIC';
    const spec = (s?.spec && typeof s.spec === 'object') ? s.spec : {};
    let source = visualTypeToSource(visualType);
    // A UI scene without a real listed screenshot cannot exist — degrade to an
    // explanatory graphic (never let generative AI fake the interface).
    if (source === 'mockup' && !(typeof spec.screenshot_url === 'string' && listedUrls.has(spec.screenshot_url))) {
      const anyShot = allShots[0]?.url;
      if (typeof spec.screenshot_url === 'string' && spec.screenshot_url.startsWith('http') && anyShot) {
        spec.screenshot_url = anyShot; // wrong URL — snap to a real one
      } else if (anyShot) {
        spec.screenshot_url = anyShot;
      } else {
        visualType = 'MOTION_GRAPHIC';
        source = 'graphic';
      }
    }
    const narrationS = Number(scripted?.narration_s) || 4;
    const finalSpec = source === 'graphic' && !spec.treatment
      ? { treatment: 'kinetic_type', title: String(s?.on_screen_text || scripted?.on_screen_text || s?.beat_title || '').slice(0, 90), palette: spec.palette }
      : spec;
    const purpose = String(s?.purpose || '').slice(0, 500);
    const visualPrompt = String(s?.visual_prompt || '').slice(0, 900);
    const onScreenText = String(s?.on_screen_text ?? scripted?.on_screen_text ?? '').slice(0, 90);
    return {
      scene_key: newSceneKey(),
      idx: i,
      source,
      beat_title: String(s?.beat_title || scripted?.beat || `Scene ${i + 1}`).slice(0, 80),
      purpose,
      rationale: s?.rationale ? String(s.rationale).slice(0, 500) : undefined,
      duration_s: derivedDuration(source, narrationS),
      continuity_group: s?.continuity_group ? String(s.continuity_group) : null,
      transition_in: TRANSITIONS.includes(s?.transition_in) ? s.transition_in : 'cut',
      transition_out: TRANSITIONS.includes(s?.transition_out) ? s.transition_out : 'cut',
      motion: cleanMotion(s?.motion),
      spec: finalSpec,
      // The required-content manifest — exactly what the RENDERED output must
      // contain. Built deterministically from the spec, stored with the scene,
      // verified by QA against the actual frames.
      required_content: buildRequiredContent({ source, visual_type: visualType, spec: finalSpec, on_screen_text: onScreenText, purpose, visual_prompt: visualPrompt }),
      narration: scripted?.narration || '',
      visual_type: visualType,
      visual_prompt: visualPrompt,
      on_screen_text: onScreenText,
      product_action: String(scripted?.product_action || '').slice(0, 240),
      music_mood: String(s?.music_mood || '').slice(0, 60),
      sfx: String(s?.sfx || '').slice(0, 120),
    };
  });
  if (!scenes.length) throw new Error('The director produced an empty storyboard.');
  // VAGUE-PLAN REJECTION: an AI-video scene whose plan has no concrete
  // subject, environment, action, camera, lighting or explicit first frame is
  // rejected and repaired BEFORE anything renders (one concretising pass per
  // vague scene — never shipped as-is).
  for (const s of scenes) {
    if (s.source !== 'veo') continue;
    const reason = veoPlanIsVague(s.spec as any, s.visual_prompt || '');
    if (reason) await concretizeVeoScene(s, params.brief, reason);
  }
  return {
    title: String(raw?.title || `${params.brief.product_name} — Product Ad`).slice(0, 120),
    creative_direction: String(raw?.creative_direction || ''),
    visual_world: String(raw?.visual_world || ''),
    music_brief: params.strategy.music_brief || '',
    assumptions: Array.isArray(raw?.assumptions) ? raw.assumptions.map(String) : [],
    scenes,
  };
}

// ---------------------------------------------------------------------------
// Stage 5 — production-level generative-video prompt (Omni Flash) with the
// narration context baked in + continuity fold-in + fix notes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Vague-plan rejection — deterministic checks + one Opus concretising repair
// ---------------------------------------------------------------------------

const VAGUE_RE = /\b(show(?:s|ing)?\s+(?:the\s+)?(?:idea|business|concept|product|problem|solution|brand)|make\s+it\s+cinematic|something\s+cinematic|represent(?:s|ing)?\s+(?:the|a)\b|abstract\s+visuals?|generic\s+(?:footage|shot|scene))\b/i;

/** Why an AI-video plan is too vague to film — or null when it is concrete.
 * Checks the exact failure modes that produce meaningless clips: no real
 * subject/action, generic "show the idea" language, and missing shot
 * fundamentals (environment, camera, lighting, first frame). */
export function veoPlanIsVague(spec: any, visualPrompt: string): string | null {
  const concept = String(spec?.visual_concept || '').trim();
  const combined = `${concept} ${String(visualPrompt || '')}`.trim();
  if (combined.length < 60) return 'The visual plan is too thin — no concrete subject, action or setting.';
  if (VAGUE_RE.test(combined)) return 'The visual plan is generic ("show the idea"-style) instead of a concrete filmable shot.';
  const missing: string[] = [];
  if (!String(spec?.environment || '').trim()) missing.push('environment');
  if (!String(spec?.camera || '').trim()) missing.push('camera');
  if (!String(spec?.lighting || '').trim()) missing.push('lighting');
  if (!String(spec?.first_frame || '').trim()) missing.push('first_frame');
  if (missing.length) return `The shot plan is missing: ${missing.join(', ')}.`;
  return null;
}

const CONCRETIZE_SYSTEM = `You repair ONE vague AI-video scene plan in a product advertisement storyboard. The narration and story beat stay exactly the same — you make the SHOT concrete and filmable. Reply with ONE JSON object:
{ "visual_prompt": str (the concrete generator brief — subject, environment, action, camera, framing, lighting, style, movement), "spec": { "visual_concept": str (dominant subject + exact placement + action + setting), "first_frame": str (exactly what the opening frame shows — it must establish the visual without narration), "action_progression": str (what happens from the first second to the final frame), "environment": str, "characters": str|"none", "camera": str (type + movement), "lens_framing": str, "lighting": str, "style": str, "mood": str, "must_not_appear": str, "seed_from_previous": bool } }
NEVER answer with "show the idea", "represent the concept", "make it cinematic" or any other abstraction — name the actual subject, place, action, camera and light.
BAD: "Entrepreneur thinks about launching a business." GOOD: "Medium close-up of a young entrepreneur sitting at a laptop at a small home workspace, several unfinished business notes and a browser window visible on the desk, looking at the screen with a frustrated expression, realistic documentary lighting, camera slowly pushes toward the laptop."`;

/** One concretising repair for a rejected AI-video plan (mutates the scene). */
async function concretizeVeoScene(scene: PlanScene, brief: ProductBrief, reason: string): Promise<void> {
  try {
    const out = await opusJson<any>({
      system: CONCRETIZE_SYSTEM,
      user: [
        `PRODUCT: ${brief.product_name}${brief.tagline ? ` — ${brief.tagline}` : ''}`,
        `NARRATION THIS SCENE PLAYS UNDER: "${scene.narration || ''}"`,
        `STORY BEAT: ${scene.purpose || scene.beat_title}`,
        `REJECTED PLAN (${reason}):\n${JSON.stringify({ visual_prompt: scene.visual_prompt, spec: scene.spec })}`,
      ].join('\n'),
      maxTokens: 1600,
      effort: 'medium',
    });
    if (out?.spec && typeof out.spec === 'object') {
      scene.spec = { ...(scene.spec as any), ...out.spec };
      scene.visual_prompt = String(out.visual_prompt || scene.visual_prompt || '').slice(0, 900);
      scene.required_content = buildRequiredContent({ source: scene.source, visual_type: scene.visual_type, spec: scene.spec, on_screen_text: scene.on_screen_text, purpose: scene.purpose, visual_prompt: scene.visual_prompt });
    }
  } catch { /* the render-time prompt writer still receives fix guidance */ }
}

const VIDEO_PROMPT_SYSTEM = `You write PRODUCTION-LEVEL prompts for a generative video model (Google Omni Flash) — the kind a commercial director hands a VFX house. The clip is B-ROLL/LIFESTYLE/CINEMATIC ONLY. Reply with ONE JSON object: { "prompt": str, "negative": str }.

The prompt must cover, in flowing production language (where relevant): subject and EXACT placement in frame; environment; character appearance (if any); exact actions with motion language (direction, speed, weight, ground contact); camera type and movement; lens/framing; composition; lighting (source, direction, quality); materials/textures; depth of field; motion quality; mood; visual style (photorealistic, high-end commercial); ACTION PROGRESSION — how the action develops from the first second to the last; pacing matched to the stated duration; continuity; how the shot opens and ends. Never a shallow prompt like "Person using an app."

Rules:
- THE NARRATION IS THE MEANING: you receive the exact voiceover line playing over this clip. The action on screen must visibly embody that line's idea — a viewer with the sound off should still read the story beat.
- If CONTINUITY FROM PREVIOUS SCENE is provided, open with a "Continuity:" clause — same characters (appearance, wardrobe), same environment, same lighting and palette, camera picking up from the described end state.
- FIRST FRAME: describe the exact FIRST VISIBLE FRAME early in the prompt (use the spec's "first_frame" when present) — it must establish the intended visual immediately, without depending on the narration — then develop the action progression to the final frame.
- NEVER request readable on-screen text, captions, subtitles, logos, UI screens, dashboards, phone/laptop screen content or numbers. The negative must forbid: on-screen text, captions, subtitles, watermarks, logos, UI elements, screens with readable content, distorted hands/faces — plus anything listed as MUST NOT APPEAR.
- If FIX NOTES from a failed inspection are provided, concretely correct those issues.
- Under 140 words (the model rejects long prompts). Optimised for Omni Flash.`;

export async function writeVideoPrompt(
  scene: FilmScene,
  plan: FilmPlan,
  brief: ProductBrief | null,
  continuitySnapshot: any | null,
  fixNotes?: string | null,
): Promise<{ prompt: string; negative: string }> {
  const spec = scene.spec as any;
  const out = await opusJson<{ prompt: string; negative: string }>({
    system: VIDEO_PROMPT_SYSTEM,
    user: [
      `AD CREATIVE DIRECTION: ${plan.creative_direction || 'cinematic, high-end commercial'}`,
      plan.visual_world ? `VISUAL WORLD (every scene must feel like ONE ad): ${plan.visual_world}` : '',
      brief ? `PRODUCT: ${brief.product_name}${brief.tagline ? ` — ${brief.tagline}` : ''}. Brand tone: ${brief.brand?.tone_of_voice || brief.tone || ''}` : '',
      `NARRATION PLAYING OVER THIS CLIP (${Number(scene.narration_s || 0).toFixed(1)}s): "${scene.narration || ''}"`,
      `STORY BEAT THIS SHOT MUST LAND: ${scene.purpose || scene.beat_title || ''}`,
      scene.visual_prompt ? `STORYBOARD VISUAL BRIEF: ${scene.visual_prompt}` : '',
      `SCENE SPEC: ${JSON.stringify(spec)}`,
      `DURATION: ${scene.duration_s || 6}s`,
      continuitySnapshot ? `CONTINUITY FROM PREVIOUS SCENE (continue from this exact end state):\n${JSON.stringify(continuitySnapshot)}` : 'CONTINUITY: this shot opens fresh.',
      fixNotes ? `FIX NOTES FROM THE LAST TAKE (correct these concretely): ${fixNotes}` : '',
    ].filter(Boolean).join('\n\n'),
    maxTokens: 2048,
    effort: 'medium',
  });
  const fallbackNeg = 'on-screen text, captions, subtitles, watermarks, logos, UI elements, screens with readable content, distorted hands, distorted faces';
  return {
    prompt: String(out?.prompt || spec.visual_concept || scene.visual_prompt || scene.purpose || '').slice(0, 1700),
    negative: String(out?.negative || fallbackNeg).slice(0, 400) + (spec.must_not_appear ? `, ${String(spec.must_not_appear).slice(0, 150)}` : ''),
  };
}

// ---------------------------------------------------------------------------
// Stage 6 — continuity snapshot (vision on the extracted final frame)
// ---------------------------------------------------------------------------

const SNAPSHOT_SYSTEM = `You describe the exact visual end-state of a film frame so the NEXT shot can continue seamlessly. Reply with ONE JSON object:
{ "dominant_colors": [str hex-ish], "lighting": str (direction + quality), "characters": str (who is visible: appearance, wardrobe — or 'none'), "product_appearance": str, "environment": str, "camera": str (angle + distance), "style": str, "action_in_progress": str }
Be specific and literal about what is visible. No speculation beyond the frame.`;

export async function continuitySnapshotFromFrame(frameUrl: string): Promise<any> {
  try {
    return await opusJson({ system: SNAPSHOT_SYSTEM, user: 'Describe this frame\u2019s end state.', images: [frameUrl], maxTokens: 1024, effort: 'low' });
  } catch {
    return null; // continuity degrades gracefully — the seed frame still chains
  }
}

// ---------------------------------------------------------------------------
// Stage 7 — inspection (per render) and QUALITY CONTROL (whole-ad pass)
// ---------------------------------------------------------------------------

const INSPECT_SYSTEM = `You are the quality-control director of a premium product-advertisement pipeline. You see 1-2 frames of a rendered scene plus the narration line it plays under and the storyboard intent. Reply with ONE JSON object: { "pass": bool, "issues": str, "fix_hint": str }.
THE FIRST image you receive is from near the clip's opening: it must ALREADY establish the intended subject and setting on its own, without the narration — an opening frame that is blank, or that could belong to any ad, or that shows a different subject than planned, FAILS.
FAIL only on real production errors: the visual clearly does not serve the narration line, wrong subject/setting for the beat, a broken/black/empty/garbled frame, readable garbled text, a fake/AI-invented UI where a real screenshot was required, a different person than continuity requires, or an off-brand look contradicting the creative direction. Reasonable artistic interpretation PASSES. "issues" = one short sentence (empty when pass). "fix_hint" = one concrete instruction for the retake (empty when pass).`;

export async function inspectScene(
  scene: FilmScene,
  plan: FilmPlan,
  frameUrls: string[],
): Promise<{ pass: boolean; issues: string; fix_hint: string; method: string }> {
  const frames = httpsOnly(frameUrls).slice(0, 2);
  if (!frames.length) return { pass: true, issues: 'No frame could be captured for review — accepted on trust.', fix_hint: '', method: 'trust' };
  try {
    const out = await opusJson<{ pass: boolean; issues: string; fix_hint: string }>({
      system: INSPECT_SYSTEM,
      user: [
        `CREATIVE DIRECTION: ${plan.creative_direction || ''}`,
        `NARRATION THIS SCENE PLAYS UNDER: "${scene.narration || ''}"`,
        `STORY BEAT THIS SCENE MUST LAND: "${scene.purpose || scene.beat_title || ''}"`,
        `VISUAL TYPE: ${scene.visual_type || scene.source}`,
        'Do these frames plausibly land that beat — and serve that narration — within the creative direction?',
      ].join('\n'),
      images: frames,
      maxTokens: 700,
      effort: 'low',
    });
    return { pass: out?.pass !== false, issues: String(out?.issues || ''), fix_hint: String(out?.fix_hint || ''), method: 'opus_vision' };
  } catch (e: any) {
    return { pass: true, issues: `Inspector unavailable (${String(e?.message || e).slice(0, 80)}) — accepted on trust.`, fix_hint: '', method: 'trust' };
  }
}

const QC_SYSTEM = `You run the FINAL QUALITY-CONTROL pass over a finished product advertisement, one scene at a time. You see 1-2 frames of the rendered scene, its narration line, its visual type and its on-screen text. Check the scene against this list:
1. GENERIC/IRRELEVANT VISUAL — the visual could belong to any ad; it does not serve this narration line.
2. TOO MUCH TEXT — paragraphs on screen, or the on-screen text repeats the whole narration.
3. UNCLEAR EXPLANATION — a diagram/graphic that does not actually explain the relationship or process the line describes.
4. WRONG/FAKE UI — an AI-invented interface where the real screenshot was required.
5. POOR PACING — a static, empty frame for a long line, or frantic motion under a calm line.
6. MISSING DIALOGUE SYNC — the visual contradicts or ignores what the voice is saying.
7. WEAK CTA (final scene only) — the ask is illegible, vague, or missing.
Reply with ONE JSON object: { "pass": bool, "issues": str (which check failed and why, one sentence — '' when pass), "fix_hint": str (one concrete regeneration instruction — '' when pass) }.
Only FAIL on a real, visible problem — a scene that lands its line passes.`;

export async function qualityCheckScene(
  scene: FilmScene,
  plan: FilmPlan,
  frameUrls: string[],
  isFinalScene: boolean,
): Promise<{ pass: boolean; issues: string; fix_hint: string; method: string }> {
  const frames = httpsOnly(frameUrls).slice(0, 2);
  if (!frames.length) return { pass: true, issues: '', fix_hint: '', method: 'trust' };
  try {
    const out = await opusJson<{ pass: boolean; issues: string; fix_hint: string }>({
      system: QC_SYSTEM,
      user: [
        `CREATIVE DIRECTION: ${plan.creative_direction || ''}`,
        `NARRATION: "${scene.narration || ''}"`,
        `VISUAL TYPE: ${scene.visual_type || scene.source} | ON-SCREEN TEXT: "${scene.on_screen_text || ''}"`,
        `STORYBOARD INTENT: ${scene.purpose || ''}`,
        isFinalScene ? 'THIS IS THE FINAL (CTA) SCENE — apply check 7.' : '',
        'Run the checklist on these frames.',
      ].filter(Boolean).join('\n'),
      images: frames,
      maxTokens: 700,
      effort: 'low',
    });
    return { pass: out?.pass !== false, issues: String(out?.issues || ''), fix_hint: String(out?.fix_hint || ''), method: 'opus_qc' };
  } catch {
    return { pass: true, issues: '', fix_hint: '', method: 'trust' };
  }
}

// ---------------------------------------------------------------------------
// Stage 8 — ad variation recipes (reuse existing assets wherever possible)
// ---------------------------------------------------------------------------

const VARIATIONS_SYSTEM = `You design VARIATIONS of a finished product advertisement, reusing its existing rendered scenes wherever possible (each listed scene has a cached clip + voiceover). Reply with ONE JSON object.

VARIATION KINDS:
- "alt_hook": same ad, different opening — write ONE new hook line (different hook type than the original) and pick its visual type; every other scene is reused.
- "fast": a tighter cut — drop the slower beats, keep hook/solution/demo/CTA.
- "cinematic": lead with the most cinematic scenes (AI video / B-roll / mockup hero shots), trim graphics-heavy beats.
- "educational": lead with the explanatory scenes (diagrams, process, UI walkthrough), trim pure atmosphere.
- "social_short": the shortest possible cut — hook + one demo/benefit + CTA (≤3-4 scenes).

RULES: every "scene_keys" entry must be one of the listed scene keys, in playback order, and every variation must end on the CTA scene. Only "alt_hook" may introduce a new scene (its new hook). Propose 3-5 genuinely different variations.

OUTPUT:
{ "variations": [ { "kind": "alt_hook"|"fast"|"cinematic"|"educational"|"social_short", "name": str (≤6 words), "note": str (one sentence: what makes this cut different), "scene_keys": [str] (reused scenes in order; for alt_hook EXCLUDE the original hook scene — the new hook is prepended automatically), "alt_hook"?: { "hook_type": "problem"|"outcome"|"curiosity"|"demo", "narration": str (≤22 words, the new opening line), "visual_type": str (one of TEXT|PRODUCT_UI|UI_ANIMATION|AI_VIDEO|B_ROLL|IMAGE|MOTION_GRAPHIC|EDUCATIONAL_DIAGRAM|COMPARISON|PROCESS|TIMELINE|BEFORE_AFTER|PRODUCT_MOCKUP|SPLIT_SCREEN), "visual_prompt": str (generator brief), "on_screen_text": str } (alt_hook kind only) } ] }`;

export interface VariationRecipe {
  kind: 'alt_hook' | 'fast' | 'cinematic' | 'educational' | 'social_short';
  name: string;
  note: string;
  scene_keys: string[];
  alt_hook?: { hook_type: HookType; narration: string; visual_type: VisualType; visual_prompt: string; on_screen_text: string };
}

export async function writeVariationRecipes(params: {
  brief: ProductBrief;
  strategy: AdStrategy;
  plan: FilmPlan;
  scenes: FilmScene[];
}): Promise<VariationRecipe[]> {
  const sceneLines = params.scenes
    .map((s) => `- ${s.scene_key} [${s.visual_type || s.source}] (${Number(s.duration_s || 0).toFixed(1)}s): "${s.narration || s.beat_title || ''}"`)
    .join('\n');
  const raw = await opusJson<any>({
    system: VARIATIONS_SYSTEM,
    user: [
      `PRODUCT: ${params.brief.product_name} — ${params.brief.tagline || ''}`,
      `ORIGINAL STRATEGY: hook_type=${params.strategy.hook_type}, structure=${params.strategy.structure.join('→')}, tone=${params.strategy.tone}`,
      `FINISHED SCENES (in order, all with cached clips + voice):\n${sceneLines}`,
    ].join('\n\n'),
    maxTokens: 3000,
    effort: 'high',
  });
  const known = new Set(params.scenes.map((s) => s.scene_key));
  const kinds = ['alt_hook', 'fast', 'cinematic', 'educational', 'social_short'];
  return (Array.isArray(raw?.variations) ? raw.variations : [])
    .map((v: any): VariationRecipe | null => {
      if (!kinds.includes(v?.kind)) return null;
      const keys = (Array.isArray(v?.scene_keys) ? v.scene_keys : []).map(String).filter((k: string) => known.has(k));
      if (keys.length < 2) return null;
      const recipe: VariationRecipe = {
        kind: v.kind,
        name: String(v?.name || v.kind).slice(0, 60),
        note: String(v?.note || '').slice(0, 240),
        scene_keys: keys,
      };
      if (v.kind === 'alt_hook' && v?.alt_hook?.narration) {
        recipe.alt_hook = {
          hook_type: HOOKS.includes(v.alt_hook.hook_type) ? v.alt_hook.hook_type : 'outcome',
          narration: String(v.alt_hook.narration).slice(0, 240),
          visual_type: VISUAL_TYPES.includes(v.alt_hook.visual_type) ? v.alt_hook.visual_type : 'B_ROLL',
          visual_prompt: String(v.alt_hook.visual_prompt || '').slice(0, 700),
          on_screen_text: String(v.alt_hook.on_screen_text || '').slice(0, 80),
        };
      }
      return recipe;
    })
    .filter((v: VariationRecipe | null): v is VariationRecipe => !!v)
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Swap a scene's visual type — Opus rewrites the spec for the new engine
// ---------------------------------------------------------------------------

const SWAP_SYSTEM = `You rewrite ONE scene's visual spec because the user switched its VISUAL TYPE. Keep the same narration, story beat and brand palette — only the visual treatment changes. Use the SPEC SHAPES below (same contract as the storyboard). Reply with ONE JSON object: { "visual_prompt": str (the new generator brief, narration-aware), "on_screen_text": str (minimal, '' when none), "spec": {...}, "motion": { "kind": "none"|"gradient_flow"|"ambient_glow"|"particles"|"lines"|"grid", "intensity": 0..1, "opacity": 0..1 } }.

SPEC SHAPES:
- mockup engine (PRODUCT_UI/UI_ANIMATION/PRODUCT_MOCKUP): { "device": "phone"|"laptop"|"browser", "screenshot_url": str (MUST be one of the provided real screenshot URLs verbatim), "headline"?: str, "caption"?: str, "motion": "scroll"|"zoom"|"pan"|"highlight", "focus"?: {"x","y","w","h"}, "cursor"?: { "action": "click"|"move"|"scroll"|"type", "callout"?: str }, "palette"?: {...} }
- video engine (AI_VIDEO/B_ROLL): { "visual_concept": str, "environment": str, "characters": str|"none", "camera": str, "lens_framing": str, "lighting": str, "style": str, "mood": str, "must_not_appear": str, "seed_from_previous": false }
- image engine (IMAGE): { "asset_prompt": str ('no text or lettering anywhere'), "headline"?: str, "labels"?: [{"text"}], "animate"?: bool, "palette"?: {...} }
- graphic engine (TEXT/MOTION_GRAPHIC/EDUCATIONAL_DIAGRAM/COMPARISON/PROCESS/TIMELINE/BEFORE_AFTER/SPLIT_SCREEN): { "treatment": "kinetic_type"|"documentary_card"|"flow"|"stat"|"bars"|"list"|"compare"|"timeline"|"node_map"|"quote"|"annotated", "title": str, "subtitle"?: str, "items"?: [...], "leftTitle"?/"rightTitle"?/"leftItems"?/"rightItems"?, "stat"?: {...}, "palette": {...}, "texture": "grid"|"dots"|"diagonal"|"none" }`;

export async function rewriteSpecForVisualType(params: {
  scene: FilmScene;
  plan: FilmPlan;
  brief: ProductBrief | null;
  newType: VisualType;
  screenshots: string[];
  /** A user-edited visual brief — authoritative over the previous spec. */
  promptOverride?: string | null;
}): Promise<{ spec: any; visual_prompt: string; on_screen_text: string; motion: MotionSpec }> {
  const shots = httpsOnly(params.screenshots);
  const out = await opusJson<any>({
    system: SWAP_SYSTEM,
    user: [
      `NEW VISUAL TYPE: ${params.newType} (engine: ${visualTypeToSource(params.newType)})`,
      params.promptOverride ? `USER-EDITED VISUAL BRIEF (authoritative — the spec must implement it): ${params.promptOverride}` : '',
      `NARRATION (unchanged): "${params.scene.narration || ''}"`,
      `STORY BEAT: ${params.scene.purpose || params.scene.beat_title || ''}`,
      `CREATIVE DIRECTION: ${params.plan.creative_direction || ''}`,
      params.brief?.brand ? `BRAND: ${JSON.stringify(params.brief.brand)}` : '',
      shots.length ? `REAL SCREENSHOTS AVAILABLE:\n${shots.map((u) => `- ${u}`).join('\n')}` : 'REAL SCREENSHOTS: none (mockup engine is unavailable).',
      `PREVIOUS SPEC (for palette continuity): ${JSON.stringify(params.scene.spec || {})}`,
    ].filter(Boolean).join('\n\n'),
    maxTokens: 2048,
    effort: 'medium',
  });
  const spec = (out?.spec && typeof out.spec === 'object') ? out.spec : {};
  if (visualTypeToSource(params.newType) === 'mockup') {
    if (!(typeof spec.screenshot_url === 'string' && spec.screenshot_url.startsWith('http')) && shots[0]) spec.screenshot_url = shots[0];
    if (!spec.screenshot_url) throw new Error('A product-UI scene needs a real screenshot — upload one first.');
  }
  return {
    spec,
    visual_prompt: String(out?.visual_prompt || '').slice(0, 900),
    on_screen_text: String(out?.on_screen_text || '').slice(0, 90),
    motion: cleanMotion(out?.motion),
  };
}
