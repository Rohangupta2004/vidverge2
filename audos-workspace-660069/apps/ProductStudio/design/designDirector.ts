/**
 * DESIGN WITH AI — the AI Visual Director (Claude Opus 5).
 *
 * Every AI decision goes through claude-opus-5 on the platform Anthropic
 * proxy (POST /proxy/anthropic/v1/messages with X-Workspace-DB-Token —
 * askOpus handles auth):
 *
 *   1. TALKING-HEAD DETECTION — Opus vision on sampled frames finds where
 *      the presenter sits so graphics never cover the face.
 *   2. BRAND CONTEXT — optional product URL through the scrape-website hook
 *      (brief + brand kit extracted server-side, also on claude-opus-5).
 *   3. VISUAL PLAN — per-timestamp overlay decisions: what graphic appears,
 *      when, where, why. Graphics-first: icons, diagrams, charts, callouts,
 *      product screenshots — text only for key points, numbers, short
 *      emphasis. Never a presentation of text cards.
 *   4. SINGLE-GRAPHIC REGENERATION — redesign one graphic without touching
 *      the rest.
 *   5. AGENTIC QUALITY CHECK — Opus vision inspects composited preview
 *      frames for occlusion, sync, over-text, over-animation and brand
 *      consistency; only the flagged graphics get fixed.
 */

import { askOpusJson } from '../../ScriptToVideo/pipeline/opus';
import {
  Density, DesignAsset, DesignBrand, DesignGraphic, DesignPalette, DesignPlan,
  DesignSegment, HeadInfo, ICON_NAMES, LayoutPref, QaIssue, StylePref,
  callHook, clamp, newGraphicId, paletteFromBrand,
} from './api';

// Malformed-JSON replies are repaired (fences stripped, truncation closed)
// and retried once with stricter output instructions inside askOpusJson.
async function opusJson<T = any>(call: { system: string; user: string; images?: string[]; maxTokens?: number; effort?: 'low' | 'medium' | 'high' }): Promise<T> {
  return askOpusJson<T>(call);
}

const httpsOnly = (urls: (string | null | undefined)[]) =>
  urls.filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));

// ---------------------------------------------------------------------------
// Brand context from the product URL
// ---------------------------------------------------------------------------

export async function readBrand(url: string, onNote?: (n: string) => void): Promise<{ brand: DesignBrand | null; screenshotUrl: string | null }> {
  try {
    onNote?.('Reading the product website for brand context…');
    const site = await callHook('scrape-website', { url });
    if (!site || site.success === false) { onNote?.('The website read came back empty — continuing with defaults.'); return { brand: null, screenshotUrl: null }; }
    const brand: DesignBrand = {
      colors: site.brand_kit?.colors || null,
      typography: site.brand_kit?.typography || null,
      tone_of_voice: site.brand_kit?.tone_of_voice || site.tone || null,
      product_name: site.product_name || site.name || null,
    };
    return { brand, screenshotUrl: typeof site.mockup_screenshot_url === 'string' ? site.mockup_screenshot_url : null };
  } catch (e: any) {
    onNote?.(`The website could not be read (${String(e?.message || e).slice(0, 100)}) — continuing with defaults.`);
    return { brand: null, screenshotUrl: null };
  }
}

// ---------------------------------------------------------------------------
// Talking-head detection (Opus vision on sampled frames)
// ---------------------------------------------------------------------------

const HEAD_SYSTEM = `You analyse frames of a talking video for an overlay-graphics compositor. Find the PRESENTER (talking head / person on camera) so graphics can avoid their face. Reply with ONE JSON object:
{ "position": "left"|"center"|"right"|"top"|"none" (where the person mostly sits across the frames — "none" if no person is visible),
  "box": { "x": num, "y": num, "w": num, "h": num } | null (tight fraction-of-frame bounding box around the person incl. head and shoulders, 0..1),
  "confidence": 0..1,
  "notes": str (one line: framing, background, lighting — useful for styling decisions) }
If the person moves between frames, report the UNION box that covers them across frames. Be literal.`;

export async function detectTalkingHead(frameUrls: string[]): Promise<HeadInfo> {
  const frames = httpsOnly(frameUrls).slice(0, 3);
  if (!frames.length) return { position: 'right', box: null, confidence: 0, notes: 'No frames could be sampled — defaulting to a right-side talking head.' };
  try {
    const out = await opusJson<any>({ system: HEAD_SYSTEM, user: 'Locate the presenter across these frames.', images: frames, maxTokens: 700, effort: 'low' });
    const pos = ['left', 'center', 'right', 'top', 'none'].includes(out?.position) ? out.position : 'right';
    const b = out?.box;
    const box = b && Number.isFinite(b.x) && Number.isFinite(b.w)
      ? { x: clamp(Number(b.x), 0, 1), y: clamp(Number(b.y), 0, 1), w: clamp(Number(b.w), 0, 1), h: clamp(Number(b.h), 0, 1) }
      : null;
    return { position: pos, box, confidence: clamp(Number(out?.confidence) || 0.5, 0, 1), notes: String(out?.notes || '').slice(0, 300) };
  } catch {
    return { position: 'right', box: null, confidence: 0, notes: 'Head detection unavailable — defaulting to a right-side talking head.' };
  }
}

// ---------------------------------------------------------------------------
// The Visual Plan
// ---------------------------------------------------------------------------

const TREATMENTS = ['kinetic_type', 'lower_third', 'stat', 'bar_chart', 'decay_chart', 'list_reveal', 'callout', 'arrow_flow', 'icon_badge', 'diagram', 'progress', 'compare', 'quote_card', 'image_card', 'broll'] as const;
const POSITIONS = ['left_third', 'right_third', 'top_third', 'bottom_third', 'lower_third', 'center', 'full'] as const;
const ANIMS_IN = ['fade', 'fade_slide_left', 'fade_slide_right', 'fade_slide_up', 'fade_slide_down', 'pop', 'wipe'] as const;
const ANIMS_OUT = ['fade', 'slide_left', 'slide_right', 'slide_down', 'shrink'] as const;

const PLAN_SYSTEM = `You are an elite MOTION-DESIGN DIRECTOR designing overlay graphics for a real uploaded talking video (the original footage is never modified — every graphic is a compositable overlay). You receive the word-timed transcript, where the talking head sits, brand context and available real assets. You decide, per timestamp, WHAT graphic appears, WHEN, WHERE and WHY. Reply with ONE JSON object and nothing else.

GRAPHICS-FIRST RULE (hard): prefer icons, diagrams, charts, arrows, callouts, animated objects, product screenshots and kinetic typography. Use text minimally — only key points, labels, numbers, short emphasis, CTAs, definitions. NEVER turn the video into a presentation of text cards. A graphic must add information or emphasis the narration alone cannot.

TREATMENTS (deterministic GSAP/SVG renderers — every string renders EXACTLY as written):
- "kinetic_type": 1-6 punchy words, big type. spec: { title, subtitle? }
- "lower_third": label bar at the bottom (intros, names, section titles). spec: { title, subtitle? }
- "stat": one spoken number, animated count-up + ring. spec: { stat: { value:num, prefix?, suffix?, label? } }
- "bar_chart": compare 2-5 spoken values. spec: { title?, items: [{label, value:num}] }
- "decay_chart": a declining trend (e.g. memory/retention over time). spec: { title?, items: [{label, value:num}] (descending) }
- "list_reveal": checklist of 2-5 SHORT items. spec: { title?, items: [{label, sublabel?}] }
- "callout": small pill + drawn pointer line for one concept. spec: { title, subtitle? }
- "arrow_flow": 2-4 step process with drawn arrows. spec: { title?, items: [{label}] }
- "icon_badge": 1-3 large animated icons with tiny labels — the most graphics-first choice. spec: { title?, icons: [icon names], items: [{label}] (same order) }
- "diagram": hub-and-spoke concept map. spec: { title (hub), items: [{label}] (2-5 spokes) }
- "progress": animated progress/percentage bar. spec: { title?, percent: 0-100 }
- "compare": two mini panels A vs B. spec: { title?, leftTitle, rightTitle, leftItems: [str], rightItems: [str] }
- "quote_card": short quote emphasis (definitions, claims). spec: { title (the quote), subtitle? (attribution) }
- "image_card": a REAL screenshot/asset in a floating card with a slow pan — MANDATORY for any product-UI moment; never describe UI with text when a real screenshot is listed. spec: { title? (caption), imageUrl (verbatim from the asset list) }
- "broll": REAL AI-GENERATED FOOTAGE (Omni) composited over the video for this window — the ONLY treatment that is actual video, and it is EXPENSIVE. Use it ONLY when a moment genuinely needs real footage: a cinematic product shot, a visual metaphor, an environmental or product-in-use shot, missing B-roll that graphics cannot represent. NEVER use it for anything the treatments above render more accurately (text, numbers, charts, diagrams, UI). Most videos need 0-2 broll cues, 4-8s each. Set "use_omni": true on the graphic and write a detailed "omni_prompt" (subject, action, setting, camera move, lighting, mood — never request on-screen text, captions or logos). spec: { title? (small caption) }

ICON NAMES (icon_badge / items[].icon must come from this list): ${ICON_NAMES.join(', ')}.

POSITIONS: ${POSITIONS.join(' | ')}. THE TALKING-HEAD SAFE AREA IS LAW: never place a graphic over the person — put graphics in the OPPOSITE third (head right → graphics left_third; head left → right_third; head top → bottom_third). "lower_third" is always safe. "full" ONLY when the concept genuinely requires the whole frame (the renderer keeps it translucent). Switch layout dynamically with the content — do not glue every graphic to one spot.

ANIMATIONS: anim_in ∈ ${ANIMS_IN.join(' | ')}; anim_out ∈ ${ANIMS_OUT.join(' | ')}. Slide direction should come FROM the graphic's side of frame (left_third → fade_slide_right means slide in rightward from the left edge).

TIMING RULES:
- "start"/"end" in seconds, snapped to when the referenced words are actually spoken (use the transcript timestamps). 2.5s minimum, 10s maximum per graphic.
- "narration_ref": the EXACT words (verbatim substring of the transcript) the graphic supports — used to hard-sync timing.
- Graphics must NOT overlap each other in time (one on screen at a time; a lower_third may overlap one other graphic). Leave breathing room — not every sentence needs a graphic.
- DENSITY BUDGET (respect it): minimal ≈ 1 graphic per 12s of video; balanced ≈ 1 per 7s; rich ≈ 1 per 4.5s.

BRAND: derive the palette from the brand kit when given (panel bg dark unless the brand is light; ink readable on it; accent = brand primary). Product name and on-screen strings must be spelled exactly. Avoid generic AI-looking graphics — the output should feel like a professionally designed explainer.

OUTPUT SHAPE:
{ "creative_direction": str (2-3 sentences — the design north star for this exact video),
  "palette": { "bg", "ink", "accent", "accent2" } (hex),
  "graphics": [ { "start": num, "end": num, "narration_ref": str, "visual_concept": str (what it communicates + why), "treatment": str, "position": str, "anim_in": str, "anim_out": str, "use_omni": bool (true only on broll cues), "omni_prompt": str (broll cues only), "spec": {...} } ] }`;

export interface PlanParams {
  segments: DesignSegment[];
  videoDuration: number;
  brand: DesignBrand | null;
  head: HeadInfo | null;
  style: StylePref;
  density: Density;
  layoutPref: LayoutPref;
  assets: DesignAsset[];
  /** Design-control directive (e.g. "make it more dynamic") on regeneration. */
  directive?: string | null;
  keepGraphics?: DesignGraphic[] | null;
}

function transcriptLines(segments: DesignSegment[]): string {
  return segments.slice(0, 90)
    .map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}s]${s.speaker ? ` (${s.speaker})` : ''} ${s.text}`)
    .join('\n').slice(0, 9000);
}

function headLine(head: HeadInfo | null, layoutPref: LayoutPref): string {
  const pref = layoutPref && layoutPref !== 'auto'
    ? `USER LAYOUT OVERRIDE: ${layoutPref.replace('head_', 'the talking head is treated as ')} — honor it over the detection.`
    : '';
  if (!head) return `TALKING HEAD: not analysed — assume a centered presenter; prefer lower_third and top_third. ${pref}`;
  return [
    `TALKING HEAD: position=${head.position}${head.box ? `, box=${JSON.stringify(head.box)}` : ''}${head.notes ? ` — ${head.notes}` : ''}`,
    pref,
  ].filter(Boolean).join('\n');
}

function cleanGraphic(raw: any, i: number, videoDuration: number): DesignGraphic {
  const treatment = (TREATMENTS as readonly string[]).includes(raw?.treatment) ? raw.treatment : 'kinetic_type';
  const position = (POSITIONS as readonly string[]).includes(raw?.position) ? raw.position : 'lower_third';
  const start = clamp(Number(raw?.start) || i * 8, 0, Math.max(0, videoDuration - 1));
  const end = clamp(Number(raw?.end) || start + 4, start + 1.2, Math.min(videoDuration, start + 12));
  const spec = (raw?.spec && typeof raw.spec === 'object') ? raw.spec : {};
  return {
    id: newGraphicId(),
    start: Math.round(start * 100) / 100,
    end: Math.round(end * 100) / 100,
    narration_ref: String(raw?.narration_ref || '').slice(0, 400),
    visual_concept: String(raw?.visual_concept || '').slice(0, 400),
    treatment,
    position,
    anim_in: (ANIMS_IN as readonly string[]).includes(raw?.anim_in) ? raw.anim_in : 'fade',
    anim_out: (ANIMS_OUT as readonly string[]).includes(raw?.anim_out) ? raw.anim_out : 'fade',
    use_omni: treatment === 'broll' || raw?.use_omni === true,
    omni_prompt: (treatment === 'broll' || raw?.use_omni === true)
      ? (String(raw?.omni_prompt || raw?.spec?.omniPrompt || '').slice(0, 900) || null)
      : null,
    clip_url: null,
    clip_error: null,
    scale: 1,
    opacity: 1,
    spec,
    enabled: true,
    rev: 0,
  };
}

export async function buildVisualPlan(p: PlanParams): Promise<{ plan: DesignPlan; graphics: DesignGraphic[] }> {
  const assetLines = p.assets.slice(0, 12).map((a) => `- ${a.shows || 'asset'} — ${a.url}`).join('\n');
  const styleLine = p.style === 'minimal'
    ? 'STYLE: MINIMAL — restrained, clean, few elements, generous whitespace, muted palette, subtle motion.'
    : p.style === 'cinematic'
    ? 'STYLE: CINEMATIC — dramatic contrast, filmic palette, bolder type, confident motion.'
    : 'STYLE: AUTO BRAND — derive everything from the brand context and the video itself.';
  const raw = await opusJson<any>({
    system: PLAN_SYSTEM,
    user: [
      `VIDEO DURATION: ${p.videoDuration.toFixed(1)}s`,
      headLine(p.head, p.layoutPref),
      styleLine,
      `DENSITY: ${p.density}`,
      p.brand ? `BRAND CONTEXT:\n${JSON.stringify(p.brand)}` : 'BRAND CONTEXT: none — design a tasteful neutral system from the video.',
      assetLines ? `AVAILABLE REAL ASSETS (image_card imageUrl must be one of these, verbatim):\n${assetLines}` : 'AVAILABLE REAL ASSETS: none — do not plan image_card graphics.',
      p.directive ? `DESIGN DIRECTIVE FROM THE USER (this regeneration must honor it): ${p.directive}` : '',
      p.keepGraphics?.length ? `EXISTING GRAPHICS BEING REPLACED (for reference — improve on them per the directive):\n${JSON.stringify(p.keepGraphics.map((g) => ({ start: g.start, end: g.end, treatment: g.treatment, concept: g.visual_concept })))}` : '',
      `WORD-TIMED TRANSCRIPT:\n${transcriptLines(p.segments)}`,
    ].filter(Boolean).join('\n\n'),
    maxTokens: 8192,
    effort: 'high',
  });

  const fallback = paletteFromBrand(p.brand);
  const hex = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fb);
  const palette: DesignPalette = {
    bg: hex(raw?.palette?.bg, fallback.bg),
    ink: hex(raw?.palette?.ink, fallback.ink),
    accent: hex(raw?.palette?.accent, fallback.accent),
    accent2: hex(raw?.palette?.accent2, fallback.accent2),
  };
  const graphics = (Array.isArray(raw?.graphics) ? raw.graphics : [])
    .map((g: any, i: number) => cleanGraphic(g, i, p.videoDuration))
    .sort((a: DesignGraphic, b: DesignGraphic) => a.start - b.start);
  if (!graphics.length) throw new Error('The visual director produced an empty plan — try again or add brand context.');
  return {
    plan: {
      creative_direction: String(raw?.creative_direction || '').slice(0, 800),
      palette,
      notes: Array.isArray(raw?.notes) ? raw.notes.map(String) : [],
    },
    graphics,
  };
}

// ---------------------------------------------------------------------------
// Single-graphic regeneration (never touches the rest)
// ---------------------------------------------------------------------------

const REGEN_SYSTEM = `You redesign ONE overlay graphic of a designed talking video. Use the same treatment vocabulary, spec shapes, icon names, positions and animation names as the planner, and keep every rule (graphics-first, exact strings, talking-head safe area, 2.5–10s duration). The time window and narration reference stay unless the instruction says otherwise. Reply with ONE JSON object: { "start": num, "end": num, "narration_ref": str, "visual_concept": str, "treatment": str, "position": str, "anim_in": str, "anim_out": str, "use_omni": bool, "omni_prompt": str|null, "spec": {...} } — a "broll" cue (real Omni footage) keeps use_omni true with a fresh, detailed omni_prompt (subject, action, setting, camera, lighting — no on-screen text); its footage is regenerated after your redesign.`;

export async function regenerateGraphic(
  g: DesignGraphic,
  ctx: { plan: DesignPlan | null; head: HeadInfo | null; brand: DesignBrand | null; assets: DesignAsset[]; videoDuration: number; segments: DesignSegment[] },
  note?: string | null,
): Promise<DesignGraphic> {
  const nearby = ctx.segments.filter((s) => s.end > g.start - 6 && s.start < g.end + 6);
  const assetLines = ctx.assets.slice(0, 12).map((a) => `- ${a.shows || 'asset'} — ${a.url}`).join('\n');
  const raw = await opusJson<any>({
    system: REGEN_SYSTEM + `\nICON NAMES: ${ICON_NAMES.join(', ')}.`,
    user: [
      ctx.plan ? `CREATIVE DIRECTION: ${ctx.plan.creative_direction}\nPALETTE: ${JSON.stringify(ctx.plan.palette)}` : '',
      headLine(ctx.head, 'auto'),
      ctx.brand ? `BRAND: ${JSON.stringify(ctx.brand)}` : '',
      assetLines ? `AVAILABLE REAL ASSETS:\n${assetLines}` : 'AVAILABLE REAL ASSETS: none.',
      `NARRATION AROUND THIS GRAPHIC:\n${transcriptLines(nearby)}`,
      `CURRENT GRAPHIC:\n${JSON.stringify({ start: g.start, end: g.end, narration_ref: g.narration_ref, visual_concept: g.visual_concept, treatment: g.treatment, position: g.position, spec: g.spec })}`,
      note ? `USER INSTRUCTION: ${note}` : 'USER INSTRUCTION: produce a fresh, stronger take on the same moment.',
    ].filter(Boolean).join('\n\n'),
    maxTokens: 4096,
    effort: 'medium',
  });
  const next = cleanGraphic({ ...raw, start: raw?.start ?? g.start, end: raw?.end ?? g.end }, 0, ctx.videoDuration);
  return { ...next, id: g.id, scale: g.scale, opacity: g.opacity, enabled: g.enabled, rev: g.rev + 1 };
}

// ---------------------------------------------------------------------------
// Agentic quality check (Opus vision on composited preview frames)
// ---------------------------------------------------------------------------

const QA_SYSTEM = `You are the quality-control director of an overlay-graphics design pipeline. You see composited preview frames of a talking video with generated overlay graphics, each frame labelled with the graphic active at that moment. Judge the DESIGN SYSTEM, not the person. Reply with ONE JSON object:
{ "pass": bool, "summary": str (one sentence), "issues": [ { "graphic_id": str, "issue": str (one sentence), "fix_hint": str (one concrete instruction for the redesign) } ] }
FLAG a graphic ONLY on real problems: it covers/occludes the presenter's face; it is unreadable over the footage; it is mostly a wall of text (violates text minimalism); it is unrelated to what is being said; it looks broken/empty/clipped; it clashes hard with the brand palette. Reasonable design variation PASSES. Return at most 4 issues, worst first.`;

export async function qualityCheck(
  frames: { url: string; graphicId: string; note: string }[],
  plan: DesignPlan | null,
  head: HeadInfo | null,
): Promise<{ pass: boolean; summary: string; issues: QaIssue[] }> {
  const usable = frames.filter((f) => f.url.startsWith('https://')).slice(0, 4);
  if (!usable.length) return { pass: true, summary: 'No frames could be captured for review — accepted on trust.', issues: [] };
  try {
    const out = await opusJson<any>({
      system: QA_SYSTEM,
      user: [
        plan ? `CREATIVE DIRECTION: ${plan.creative_direction}\nPALETTE: ${JSON.stringify(plan.palette)}` : '',
        head ? `TALKING HEAD: ${head.position}${head.box ? ` box=${JSON.stringify(head.box)}` : ''}` : '',
        `FRAMES (in order): ${usable.map((f, i) => `frame ${i + 1} → graphic_id=${f.graphicId} (${f.note})`).join('; ')}`,
        'Inspect each frame against its graphic.',
      ].filter(Boolean).join('\n\n'),
      images: usable.map((f) => f.url),
      maxTokens: 1500,
      effort: 'low',
    });
    const issues: QaIssue[] = (Array.isArray(out?.issues) ? out.issues : [])
      .filter((i: any) => i && typeof i.graphic_id === 'string' && i.issue)
      .slice(0, 4)
      .map((i: any) => ({ graphic_id: String(i.graphic_id), issue: String(i.issue).slice(0, 300), fix_hint: String(i.fix_hint || '').slice(0, 300), fixed: false }));
    return { pass: out?.pass !== false && !issues.length, summary: String(out?.summary || '').slice(0, 300), issues };
  } catch (e: any) {
    return { pass: true, summary: `Inspector unavailable (${String(e?.message || e).slice(0, 80)}) — accepted on trust.`, issues: [] };
  }
}
