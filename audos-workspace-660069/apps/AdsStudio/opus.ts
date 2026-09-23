/**
 * ADS STUDIO — Claude Opus 5, the single creative brain of the ad engine.
 * Every AI decision goes through claude-opus-5 on the platform Anthropic proxy
 * (POST /proxy/anthropic/v1/messages, X-Workspace-DB-Token auth):
 *
 *   RESEARCH  — product-site content → structured direct-response research
 *   ANGLES    — 8–12 genuinely different reasons-to-buy
 *   SCRIPT    — 4–7 clip ad script with HARD per-duration word limits
 *   SCENE PLAN— full per-clip production plan, ONE locked voice description
 *   INSPECTION— vision on rendered frames vs the plan, with adjusted prompts
 *   CONTINUITY— vision on each clip's last frame → note for the next prompt
 *   VARIATIONS— alternative hooks / bodies / CTAs for the matrix
 *
 * Contract notes (platform docs): Opus 5 cannot disable thinking — pair
 * thinking:{type:'adaptive'} with output_config:{effort}. max_tokens ≤ 8192.
 * Never send temperature/top_p/top_k. `system` is a top-level string.
 */

import {
  AdAngle, ANGLE_TYPES, ClipDuration, GeneratedAssetNeed, MockupDevice,
  OverlayType, ProductResearch, ScenePlan, ScriptClip, UploadedAsset,
  VariationMatrix, WORD_LIMITS, callHook, newId, wordCount, wsToken,
} from './api';

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
    const code = data?.code ? ` [${data.code}]` : '';
    throw new Error(`${data?.error?.message || data?.error || `The strategist did not answer (HTTP ${res.status})`}${code}`);
  }
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => String(b.text || ''))
    .join('');
}

/** Parse the first balanced JSON value out of a model reply — robust to
 * fences, commentary and mid-value truncation (repaired, not rejected). */
export function extractJson<T = any>(text: string): T {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error('The strategist returned no JSON.');
  const tryParse = (raw: string): T | undefined => {
    try { return JSON.parse(raw) as T; } catch { /* try sanitized */ }
    try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')) as T; } catch { return undefined; }
  };
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
        break;
      }
    }
  }
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
  throw new Error('The strategist returned malformed JSON.');
}

export async function askOpusJson<T = any>(call: OpusCall): Promise<T> {
  const text = await askOpus(call);
  try {
    return extractJson<T>(text);
  } catch (first: any) {
    const strict = await askOpus({
      ...call,
      system: call.system + '\n\nCRITICAL OUTPUT RULE: reply with ONE complete, syntactically valid JSON value and NOTHING else — no markdown fences, no commentary, no trailing commas. If space is tight, shorten string values rather than cutting the JSON off.',
    });
    try { return extractJson<T>(strict); }
    catch { throw new Error(String(first?.message || first) + ' A stricter retry also returned unparseable JSON — try again.'); }
  }
}

// ---------------------------------------------------------------------------
// STEP 2 — web research (scrape-website server function + Opus)
// ---------------------------------------------------------------------------

export interface SiteResearchData {
  main: any | null;
  subpages: { path: string; data: any }[];
  failure: string | null;
}

/** Crawl the product URL (full crawl + brand kit) and best-effort the classic
 * proof/pricing subpaths. Every failure is non-fatal — research can proceed on
 * the founder's own description alone. */
export async function fetchSiteResearch(url: string, say: (n: string) => void): Promise<SiteResearchData> {
  let main: any = null;
  let failure: string | null = null;
  try {
    say('Crawling the product website…');
    main = await callHook('scrape-website', { url });
    if (main && main.success === false) { failure = String(main.error || 'The crawler returned no usable content.'); main = null; }
  } catch (e: any) {
    failure = String(e?.message || e);
  }
  const subpages: { path: string; data: any }[] = [];
  if (main) {
    const origin = (() => { try { return new URL(url).origin; } catch { return ''; } })();
    if (origin) {
      say('Checking /reviews, /testimonials, /pricing and /about…');
      const paths = ['/reviews', '/testimonials', '/pricing', '/about'];
      const settled = await Promise.allSettled(paths.map((p) => callHook('scrape-website', { url: origin + p, skip_brand_kit: true })));
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value && r.value.success !== false) subpages.push({ path: paths[i], data: r.value });
      });
    }
  }
  return { main, subpages, failure };
}

const RESEARCH_SYSTEM = `You are an elite direct-response creative strategist and product researcher.

You will receive raw product website content and the founder's optional description.
Your job is to deeply understand this product so you can later create high-converting short-form video ads.

Analyze and extract:
1. Product name and one-sentence description
2. Core features / capabilities (verified from site only)
3. Pricing / offer structure (verified from site only)
4. Stated target audience
5. Key pain points the product solves
6. Key desires / outcomes customers want
7. Primary objections a prospect would have
8. Product mechanism (HOW it solves the problem)
9. Awareness level of the target audience (problem-aware / solution-aware / product-aware)
10. Real customer language (exact phrases from reviews or testimonials if present)
11. Positioning vs competitors (if stated on site)
12. Any proof elements (numbers, results, testimonials) — ONLY if present on the site

IMPORTANT RULES:
- NEVER invent reviews, statistics, testimonials, features, prices or claims
- Clearly label anything as [VERIFIED] if from the site, [INFERRED] if a reasonable creative hypothesis
- If something is unknown, say Unknown — do not guess
- Do not copy competitor ads
- Use competitor info only to understand positioning gaps

Return ONE JSON object with EXACTLY these fields (arrays of strings where plural):
{ "product_name": str, "one_liner": str, "core_features": [str], "pricing": str, "target_audience": str, "pain_points": [str], "desires": [str], "objections": [str], "mechanism": str, "awareness_level": str, "customer_language": [str], "positioning": str, "proof_elements": [str] }`;

const strArr = (v: any, cap = 12): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, cap) : []);

export async function researchProduct(params: {
  url: string;
  description: string;
  offerCta: string;
  site: SiteResearchData;
}): Promise<ProductResearch> {
  const raw = await askOpusJson<any>({
    system: RESEARCH_SYSTEM,
    user: [
      `PRODUCT URL: ${params.url || 'none provided'}`,
      params.description ? `FOUNDER'S OWN DESCRIPTION:\n${params.description}` : 'FOUNDER DESCRIPTION: none.',
      params.offerCta ? `CURRENT OFFER / CTA: ${params.offerCta}` : '',
      params.site.main ? `WEBSITE CONTENT (crawled extraction of the main page):\n${JSON.stringify(params.site.main).slice(0, 14000)}` : `WEBSITE CONTENT: the crawl failed (${params.site.failure || 'unknown reason'}) — rely on the founder's description and mark everything not from it as [INFERRED].`,
      ...params.site.subpages.map((s) => `ADDITIONAL PAGE ${s.path}:\n${JSON.stringify(s.data).slice(0, 5000)}`),
    ].filter(Boolean).join('\n\n'),
    maxTokens: 6000,
    effort: 'high',
  });
  return {
    product_name: String(raw?.product_name || 'Unknown').slice(0, 120),
    one_liner: String(raw?.one_liner || '').slice(0, 300),
    core_features: strArr(raw?.core_features),
    pricing: String(raw?.pricing || 'Unknown').slice(0, 400),
    target_audience: String(raw?.target_audience || 'Unknown').slice(0, 400),
    pain_points: strArr(raw?.pain_points),
    desires: strArr(raw?.desires),
    objections: strArr(raw?.objections),
    mechanism: String(raw?.mechanism || 'Unknown').slice(0, 600),
    awareness_level: String(raw?.awareness_level || 'Unknown').slice(0, 120),
    customer_language: strArr(raw?.customer_language),
    positioning: String(raw?.positioning || 'Unknown').slice(0, 600),
    proof_elements: strArr(raw?.proof_elements),
  };
}

// ---------------------------------------------------------------------------
// STEP 3 — angles
// ---------------------------------------------------------------------------

const ANGLES_SYSTEM = `You are an elite direct-response creative strategist generating AD ANGLES for short-form video ads (TikTok/Reels/Shorts style, 24–40 seconds, one presenter talking to camera with product overlays).

Generate 8–12 angles. Each angle must GENUINELY differ in the REASON TO BUY — a different pain, identity, mechanism, fear, or value equation — not the same hook rewritten with different words.

Each angle object:
{ "angle_name": str, "angle_type": one of [${ANGLE_TYPES.map((t) => `"${t}"`).join(', ')}], "core_idea": str (1–2 sentences), "target_audience_state": str (the specific emotional/situational state of the viewer at the moment they see this ad), "hook": str (the exact opening line — must create an immediate pattern interrupt), "problem": str (the specific problem this angle addresses), "mechanism": str (what solution/approach the ad reveals), "desired_outcome": str (concrete result the viewer wants), "proof_opportunity": str (what kind of proof would make this believable — grounded in the ACTUAL proof elements from research, never invented), "creative_direction": str (what the opening visual looks like; what makes this feel different from a template) }

RULES:
- Ground every claim in the research. Never invent statistics, reviews or features.
- Hooks are spoken lines — conversational, punchy, no hashtags, no emojis.
- Respect the audience's awareness level from the research.

Return ONE JSON object: { "angles": [ ...8–12 angle objects... ] }`;

export async function generateAngles(research: ProductResearch, offerCta: string): Promise<AdAngle[]> {
  const raw = await askOpusJson<any>({
    system: ANGLES_SYSTEM,
    user: `PRODUCT RESEARCH:\n${JSON.stringify(research)}\n\n${offerCta ? `OFFER / CTA: ${offerCta}` : 'OFFER / CTA: none specified — default to a soft try-it CTA.'}`,
    maxTokens: 8192,
    effort: 'high',
  });
  const angles: AdAngle[] = (Array.isArray(raw?.angles) ? raw.angles : []).map((a: any) => ({
    id: newId('angle'),
    angle_name: String(a?.angle_name || 'Untitled angle').slice(0, 90),
    angle_type: (ANGLE_TYPES as readonly string[]).includes(a?.angle_type) ? a.angle_type : 'Benefit/Result',
    core_idea: String(a?.core_idea || '').slice(0, 400),
    target_audience_state: String(a?.target_audience_state || '').slice(0, 300),
    hook: String(a?.hook || '').slice(0, 220),
    problem: String(a?.problem || '').slice(0, 300),
    mechanism: String(a?.mechanism || '').slice(0, 300),
    desired_outcome: String(a?.desired_outcome || '').slice(0, 300),
    proof_opportunity: String(a?.proof_opportunity || '').slice(0, 300),
    creative_direction: String(a?.creative_direction || '').slice(0, 400),
  })).filter((a: AdAngle) => a.hook);
  if (angles.length < 4) throw new Error('The strategist produced too few usable angles — try again.');
  return angles.slice(0, 12);
}

export async function pickBestAngle(research: ProductResearch, angles: AdAngle[]): Promise<{ angleId: string; reason: string }> {
  const raw = await askOpusJson<any>({
    system: 'You are an elite direct-response media buyer. From the numbered list of ad angles, pick the SINGLE strongest one for a cold short-form audience, weighing pattern-interrupt strength, audience awareness fit, believability of available proof, and clarity of the reason-to-buy. Reply with ONE JSON object: { "index": num (1-based), "reason": str (2–3 sentences, plain language) }.',
    user: `PRODUCT RESEARCH:\n${JSON.stringify(research)}\n\nANGLES:\n${angles.map((a, i) => `${i + 1}. [${a.angle_type}] ${a.angle_name} — hook: "${a.hook}" — ${a.core_idea}`).join('\n')}`,
    maxTokens: 1200,
    effort: 'medium',
  });
  const idx = Math.min(angles.length, Math.max(1, Number(raw?.index) || 1)) - 1;
  return { angleId: angles[idx].id, reason: String(raw?.reason || '').slice(0, 500) };
}

// ---------------------------------------------------------------------------
// STEP 4 — script
// ---------------------------------------------------------------------------

const SCRIPT_SYSTEM = `You write short-form video ad scripts (24–40 seconds total) for one on-camera presenter. The ad is built from 4–7 clips following this structure (compress to 4 when the angle is simple: Hook → Problem/Solution → Proof → CTA):
Clip 1: Hook · Clip 2: Problem · Clip 3: Agitate · Clip 4: Solution/Mechanism · Clip 5: Proof/Demo · Clip 6: Concrete Benefit · Clip 7: Single CTA

HARD WORD LIMITS by clip duration — NEVER exceed them (count every word):
4s → max 9 words · 6s → max 13 words · 8s → max 17 words · 10s → max 22 words

Each clip object:
{ "clip_number": num, "clip_role": str, "duration_seconds": 4|6|8|10, "spoken_line": str, "word_count": num, "visual_concept": str (what the viewer sees — one dominant image/action), "overlay_idea": str (optional text or product element shown during this clip; empty string if none), "emotion": str (the ONE emotion this clip creates) }

RULES:
- Conversational spoken language — the presenter says these lines to camera.
- The hook line must be the angle's hook (tightened if needed for the word limit).
- Exactly ONE call to action, in the final clip only.
- Ground every claim in the research — no invented numbers or reviews.
- Total runtime 24–40 seconds.

Return ONE JSON object: { "clips": [ ... ] }`;

const DUR_OK: ClipDuration[] = [4, 6, 8, 10];

function cleanClip(c: any, i: number): ScriptClip {
  const duration = (DUR_OK.includes(Number(c?.duration_seconds) as ClipDuration) ? Number(c.duration_seconds) : 6) as ClipDuration;
  const line = String(c?.spoken_line || '').trim();
  return {
    clip_number: i + 1,
    clip_role: String(c?.clip_role || `Clip ${i + 1}`).slice(0, 40),
    duration_seconds: duration,
    spoken_line: line,
    word_count: wordCount(line),
    visual_concept: String(c?.visual_concept || '').slice(0, 400),
    overlay_idea: String(c?.overlay_idea || '').slice(0, 300),
    emotion: String(c?.emotion || '').slice(0, 60),
  };
}

export async function writeScript(research: ProductResearch, angle: AdAngle, offerCta: string): Promise<ScriptClip[]> {
  const raw = await askOpusJson<any>({
    system: SCRIPT_SYSTEM,
    user: [
      `PRODUCT RESEARCH:\n${JSON.stringify(research)}`,
      `SELECTED ANGLE:\n${JSON.stringify(angle)}`,
      offerCta ? `OFFER / CTA (use in the final clip): ${offerCta}` : 'OFFER / CTA: none specified — write a natural try-it CTA.',
    ].join('\n\n'),
    maxTokens: 6000,
    effort: 'high',
  });
  const clips = (Array.isArray(raw?.clips) ? raw.clips : []).slice(0, 7).map(cleanClip);
  if (clips.length < 4) throw new Error('The script came back with fewer than 4 clips — try again.');
  return clips;
}

// ---------------------------------------------------------------------------
// STEP 5 — scene plan (+ deterministic Veo prompt assembly)
// ---------------------------------------------------------------------------

const CAMERA_MOVES = ['static', 'slow zoom in', 'slow zoom out', 'push-in', 'tracking left', 'tracking right', 'orbit', 'pull-back', 'handheld', 'bokeh', 'slow motion', 'dolly'];
const OVERLAY_TYPES: OverlayType[] = ['none', 'screenshot_mockup', 'text_callout', 'review_card', 'stat_counter', 'cta_button', 'arrow_highlight'];
const DEVICES: MockupDevice[] = ['phone', 'laptop', 'browser', 'tablet', 'monitor'];

const SCENE_PLAN_SYSTEM = `You are the director of photography + creative director for a short-form UGC-style video ad. One presenter (the uploaded avatar reference) speaks every clip to camera. For EACH script clip you produce a full production plan.

VOICE RULE: produce ONE "voice_description" (plus one "accent") at the top level and it is reused VERBATIM for every clip — never vary the voice between clips.

Each clip plan object:
{ "clip_number": num, "camera_movement": one of [${CAMERA_MOVES.map((c) => `"${c}"`).join(', ')}], "framing": str (e.g. "medium close-up"), "subject_position": str, "micro_action": str (small physical action synced to the line), "gesture": str, "expression": str, "environment": str, "lighting": str, "visual_style": str, "product_interaction": str ("none" or a concrete interaction), "continuity_notes": str (what must match the previous clip — outfit, background, lighting), "do_not_show": str (hard exclusions), "overlay_type": one of [${OVERLAY_TYPES.map((o) => `"${o}"`).join(', ')}], "overlay_text": str (the COMPLETE overlay text when relevant — the full key phrase, full stat, full review quote or CTA, written out in full with exact product/feature names and numbers from the research; never truncated, never elided with "…" or "etc"; empty when none), "overlay_assets": [str] (file names from the AVAILABLE ASSETS list to composite; empty when none), "use_screenshot_mockup": bool, "screenshot_mockup_type": one of [${DEVICES.map((d) => `"${d}"`).join(', ')}], "generated_assets_needed": [{ "description": str, "purpose": str }] (ONLY visuals genuinely missing from the uploads — icons, illustrations, background elements; usually empty) }

HARD RULES:
- The SAME person, outfit, environment family and lighting across all clips (state it in continuity_notes).
- VISUAL HOOK RULE: clip 1 must open on a specific action/expression/visual that creates a pattern interrupt in the FIRST SECOND — never a static talking head.
- Screenshot/UI moments: NEVER plan for the video model to recreate UI — set use_screenshot_mockup true and the real screenshot is composited in an animated device mockup afterwards. In those clips the presenter gestures toward empty space or holds a device casually.
- do_not_show must always include on-screen text and captions (the overlay layer owns all text).
- Proof overlays (stats, review quotes) may ONLY use text present in the research — never invented.
- Overlay text must be COMPLETE and ACCURATE: write the full phrase, stat or quote (no ellipsis, no "etc", no cut-off lists) and copy product names, feature names and numbers exactly from the research.

Return ONE JSON object: { "voice_description": str (e.g. "warm, confident American male, mid-30s, conversational"), "accent": str, "clips": [ ...one plan per script clip, same order... ] }`;

function cleanPlan(raw: any, script: ScriptClip, voice: string, accent: string): ScenePlan {
  const overlayType: OverlayType = OVERLAY_TYPES.includes(raw?.overlay_type) ? raw.overlay_type : 'none';
  const useMock = raw?.use_screenshot_mockup === true || overlayType === 'screenshot_mockup';
  return {
    clip_number: script.clip_number,
    camera_movement: CAMERA_MOVES.includes(raw?.camera_movement) ? raw.camera_movement : 'slow zoom in',
    framing: String(raw?.framing || 'medium close-up').slice(0, 120),
    subject_position: String(raw?.subject_position || 'centered').slice(0, 160),
    micro_action: String(raw?.micro_action || '').slice(0, 240),
    gesture: String(raw?.gesture || '').slice(0, 160),
    spoken_line: script.spoken_line,
    voice_description: voice,
    accent,
    expression: String(raw?.expression || '').slice(0, 160),
    environment: String(raw?.environment || '').slice(0, 240),
    lighting: String(raw?.lighting || '').slice(0, 200),
    visual_style: String(raw?.visual_style || 'cinematic, shallow depth of field').slice(0, 200),
    product_interaction: String(raw?.product_interaction || 'none').slice(0, 200),
    continuity_notes: String(raw?.continuity_notes || '').slice(0, 300),
    do_not_show: String(raw?.do_not_show || 'no on-screen text, no captions, no watermarks').slice(0, 240),
    overlay_assets: Array.isArray(raw?.overlay_assets) ? raw.overlay_assets.map(String).slice(0, 4) : [],
    overlay_type: useMock ? 'screenshot_mockup' : overlayType,
    overlay_text: String(raw?.overlay_text || '').slice(0, 240),
    veo_prompt: '',
    use_screenshot_mockup: useMock,
    screenshot_mockup_type: DEVICES.includes(raw?.screenshot_mockup_type) ? raw.screenshot_mockup_type : 'phone',
    generated_assets_needed: Array.isArray(raw?.generated_assets_needed)
      ? raw.generated_assets_needed.slice(0, 3).map((g: any): GeneratedAssetNeed => ({ description: String(g?.description || '').slice(0, 300), purpose: String(g?.purpose || '').slice(0, 200) })).filter((g: GeneratedAssetNeed) => g.description)
      : [],
  };
}

/** Deterministic Veo prompt assembly — the exact production template, with an
 * optional continuity note from the previous clip's final frame folded in. */
export function assembleVeoPrompt(plan: ScenePlan, durationS: number, continuityNote?: string | null): string {
  const lines = [
    `[Camera]: ${plan.camera_movement}, ${plan.framing}`,
    `[Action]: ${plan.subject_position}, ${plan.micro_action}${plan.gesture ? `, ${plan.gesture}` : ''}${plan.expression ? `, ${plan.expression}` : ''}`,
    `[Script]: Person says exactly: "${plan.spoken_line}"`,
    `[Voice]: ${plan.voice_description}`,
    `[Accent]: ${plan.accent}`,
    `[Environment]: ${plan.environment}`,
    `[Lighting]: ${plan.lighting}`,
    `[Style]: ${plan.visual_style}, ${Math.min(8, Math.max(4, durationS))}s duration`,
    `[Continuity]: ${[plan.continuity_notes, continuityNote].filter(Boolean).join(' ') || 'opening clip'}`,
    `[Avoid]: ${plan.do_not_show}`,
  ];
  if (plan.product_interaction && plan.product_interaction !== 'none') lines.splice(2, 0, `[Product]: ${plan.product_interaction}`);
  return lines.join('\n');
}

export async function buildScenePlan(params: {
  research: ProductResearch;
  angle: AdAngle;
  script: ScriptClip[];
  assets: UploadedAsset[];
  hasAvatar: boolean;
}): Promise<{ voiceDescription: string; accent: string; plans: ScenePlan[] }> {
  const assetLines = params.assets.map((a) => `- ${a.name} — ${a.url}`).join('\n');
  const raw = await askOpusJson<any>({
    system: SCENE_PLAN_SYSTEM,
    user: [
      `PRODUCT RESEARCH:\n${JSON.stringify(params.research)}`,
      `SELECTED ANGLE:\n${JSON.stringify(params.angle)}`,
      `APPROVED SCRIPT (one plan per clip, same order):\n${JSON.stringify(params.script)}`,
      params.hasAvatar ? 'AVATAR: an uploaded reference image seeds every clip — the presenter must match it.' : 'AVATAR: none uploaded — describe one consistent presenter and keep them identical across clips.',
      assetLines ? `AVAILABLE ASSETS (screenshots/images/logo the overlay layer can composite):\n${assetLines}` : 'AVAILABLE ASSETS: none uploaded.',
    ].join('\n\n'),
    maxTokens: 8192,
    effort: 'high',
  });
  const voice = String(raw?.voice_description || 'warm, confident, conversational presenter voice').slice(0, 220);
  const accent = String(raw?.accent || 'neutral American').slice(0, 80);
  const rows: any[] = Array.isArray(raw?.clips) ? raw.clips : [];
  const plans = params.script.map((sc, i) => {
    const plan = cleanPlan(rows[i] || {}, sc, voice, accent);
    plan.veo_prompt = assembleVeoPrompt(plan, sc.duration_seconds, null);
    return plan;
  });
  return { voiceDescription: voice, accent, plans };
}

/** Regenerate the production plan for ONE clip (per-card "Regenerate"). */
export async function regenerateScenePlanForClip(params: {
  research: ProductResearch;
  angle: AdAngle;
  script: ScriptClip[];
  clipNumber: number;
  voiceDescription: string;
  accent: string;
  assets: UploadedAsset[];
  note?: string;
}): Promise<ScenePlan> {
  const script = params.script.find((c) => c.clip_number === params.clipNumber)!;
  const raw = await askOpusJson<any>({
    system: SCENE_PLAN_SYSTEM + '\n\nSPECIAL MODE: you are re-planning ONE clip only. Return { "voice_description": str, "accent": str, "clips": [ one plan object ] } and reuse the LOCKED voice description verbatim.',
    user: [
      `LOCKED VOICE DESCRIPTION (reuse verbatim): ${params.voiceDescription}`,
      `LOCKED ACCENT (reuse verbatim): ${params.accent}`,
      `PRODUCT RESEARCH:\n${JSON.stringify(params.research)}`,
      `ANGLE:\n${JSON.stringify(params.angle)}`,
      `FULL SCRIPT (for continuity context):\n${JSON.stringify(params.script)}`,
      `RE-PLAN CLIP NUMBER: ${params.clipNumber}`,
      params.note ? `DIRECTOR NOTE: ${params.note}` : '',
      params.assets.length ? `AVAILABLE ASSETS:\n${params.assets.map((a) => `- ${a.name} — ${a.url}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n'),
    maxTokens: 4096,
    effort: 'medium',
  });
  const row = Array.isArray(raw?.clips) ? raw.clips[0] : raw;
  const plan = cleanPlan(row || {}, script, params.voiceDescription, params.accent);
  plan.veo_prompt = assembleVeoPrompt(plan, script.duration_seconds, null);
  return plan;
}

// ---------------------------------------------------------------------------
// STEP 6 — inspection + continuity (vision)
// ---------------------------------------------------------------------------

const INSPECT_SYSTEM = `You are the quality-control director of a short-form ad pipeline. You see 1–2 frames from a generated clip plus the plan it must serve. Checklist:
- Does the action match the planned micro-action and gesture?
- Is the framing correct?
- Does the clip feel like it flows from the previous clip?
- Is the character the same (clothing, appearance)?
- Are there unwanted text overlays or visual clutter?
- Is the composition strong for an ad?
- Would a viewer immediately understand what's happening?
Reasonable artistic interpretation PASSES — fail only on real production errors (wrong subject/setting, broken or black frame, garbled on-screen text, a visibly different person, framing that contradicts the plan).
Reply with ONE JSON object: { "accepted": bool, "issues": [str] (empty when accepted), "regenerate_reason": str (empty when accepted), "adjusted_prompt": str (a full rewritten Veo prompt in the same [Camera]/[Action]/[Script]/... template that concretely fixes the issues; empty when accepted) }`;

export interface Inspection { accepted: boolean; issues: string[]; regenerate_reason: string; adjusted_prompt: string; method: string }

export async function inspectClip(params: {
  plan: ScenePlan;
  script: ScriptClip;
  veoPrompt: string;
  frameUrls: string[];
  previousFrameUrl?: string | null;
}): Promise<Inspection> {
  const frames = params.frameUrls.filter((u) => typeof u === 'string' && u.startsWith('https://')).slice(0, 2);
  if (!frames.length) return { accepted: true, issues: ['No frame could be captured for review — accepted on trust.'], regenerate_reason: '', adjusted_prompt: '', method: 'trust' };
  try {
    const out = await askOpusJson<any>({
      system: INSPECT_SYSTEM,
      user: [
        `SCRIPT LINE: "${params.script.spoken_line}" (${params.script.clip_role}, emotion: ${params.script.emotion})`,
        `SCENE PLAN:\n${JSON.stringify(params.plan)}`,
        `VEO PROMPT USED:\n${params.veoPrompt}`,
        params.previousFrameUrl ? 'The FIRST image is the END of the PREVIOUS clip (continuity reference); the rest are frames from THIS clip.' : 'The images are frames from this clip.',
        'Evaluate the generated clip against the plan.',
      ].join('\n\n'),
      images: [params.previousFrameUrl, ...frames].filter((u): u is string => !!u && u.startsWith('https://')).slice(0, 3),
      maxTokens: 2000,
      effort: 'low',
    });
    return {
      accepted: out?.accepted !== false,
      issues: Array.isArray(out?.issues) ? out.issues.map(String).slice(0, 6) : [],
      regenerate_reason: String(out?.regenerate_reason || ''),
      adjusted_prompt: String(out?.adjusted_prompt || ''),
      method: 'opus_vision',
    };
  } catch (e: any) {
    return { accepted: true, issues: [`Inspector unavailable (${String(e?.message || e).slice(0, 80)}) — accepted on trust.`], regenerate_reason: '', adjusted_prompt: '', method: 'trust' };
  }
}

/** Read the final frame of clip N → one continuity sentence injected into
 * clip N+1's [Continuity] clause. */
export async function continuityNoteFromFrame(frameUrl: string): Promise<string> {
  try {
    const out = await askOpusJson<{ note: string }>({
      system: 'You describe the visual end-state of an ad clip so the NEXT clip stays consistent. Reply with ONE JSON object: { "note": str } — one dense sentence covering character appearance (hair, clothing colors), environment, lighting direction/quality, and spatial context. Literal, no speculation.',
      user: 'Describe what must remain consistent in the next clip.',
      images: [frameUrl],
      maxTokens: 600,
      effort: 'low',
    });
    return String(out?.note || '').slice(0, 400);
  } catch {
    return ''; // continuity degrades gracefully
  }
}

// ---------------------------------------------------------------------------
// STEP 8 — variation matrix
// ---------------------------------------------------------------------------

export async function generateVariationMatrix(params: {
  research: ProductResearch;
  angle: AdAngle;
  script: ScriptClip[];
}): Promise<VariationMatrix> {
  const hookClip = params.script[0];
  const ctaClip = params.script[params.script.length - 1];
  const middle = params.script.slice(1, -1);
  const raw = await askOpusJson<any>({
    system: `You write VARIATIONS of a proven short-form ad script for A/B testing. The original angle and structure stay fixed — you vary the words.
Produce:
- 2 ALTERNATIVE hooks (different pattern interrupts for the same angle) — respect the hook clip's word limit of ${WORD_LIMITS[hookClip.duration_seconds]} words.
- 1 ALTERNATIVE body: a replacement spoken line for EACH middle clip (same meaning arc, fresh wording), each respecting that clip's own word limit (4s→9, 6s→13, 8s→17, 10s→22 words).
- 1 ALTERNATIVE CTA line — respect the CTA clip's word limit of ${WORD_LIMITS[ctaClip.duration_seconds]} words.
Ground everything in the research — no invented claims.
Reply with ONE JSON object: { "hooks": [str, str], "body": { "<clip_number>": str, ... }, "cta": str }`,
    user: [
      `PRODUCT RESEARCH:\n${JSON.stringify(params.research)}`,
      `ANGLE:\n${JSON.stringify(params.angle)}`,
      `ORIGINAL SCRIPT:\n${JSON.stringify(params.script)}`,
      `MIDDLE CLIP NUMBERS NEEDING BODY ALTERNATIVES: ${middle.map((c) => c.clip_number).join(', ') || 'none'}`,
    ].join('\n\n'),
    maxTokens: 4096,
    effort: 'high',
  });
  const altHooks = (Array.isArray(raw?.hooks) ? raw.hooks : []).map(String).filter(Boolean).slice(0, 2);
  const originalBody: Record<string, string> = {};
  middle.forEach((c) => { originalBody[String(c.clip_number)] = c.spoken_line; });
  const altBody: Record<string, string> = {};
  if (raw?.body && typeof raw.body === 'object') {
    middle.forEach((c) => { altBody[String(c.clip_number)] = String(raw.body[String(c.clip_number)] || c.spoken_line); });
  }
  return {
    hooks: [hookClip.spoken_line, ...altHooks],
    bodies: Object.keys(altBody).length ? [originalBody, altBody] : [originalBody],
    ctas: [ctaClip.spoken_line, ...(raw?.cta ? [String(raw.cta)] : [])],
  };
}
