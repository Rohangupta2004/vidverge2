/**
 * BRAND REEL — the one place the flow talks to the platform.
 *
 * Four services, each behind a single function so the UI never hand-rolls a
 * fetch:
 *   scrapeBrand()        ps-brand-scrape       the page is CORS-blocked from
 *                                              the browser, so the harvest
 *                                              runs server-side
 *   askModel()           /proxy/anthropic      claude-sonnet-5 first (the
 *                        /proxy/openai         brief's model), automatically
 *                                              retried on gpt-5.6-terra so a
 *                                              provider outage degrades
 *                                              instead of dead-ending
 *   generateMockup()     vv-image-generate     scene mockups; the hook owns
 *                                              the model ladder
 *   submitRender()       pv-render-composition the existing server-side
 *                                              Remotion render pipeline
 */
import {
  BrandObject, CompositionSettings, FALLBACK_PRIMARY, FALLBACK_SECONDARY, REEL_FPS,
  REEL_HEIGHT, REEL_WIDTH, SCENE_VISUAL_KINDS, SceneVisual, SceneVisualKind, ScrapedImage,
  ScrapedVideo, ScriptVariant, StoryboardScene, emptySceneVisual, framesFor, inferSceneVisual,
  normalizeHex, transitionForStyle, usableAccent,
} from './types';

// ---------------------------------------------------------------------------
// Platform plumbing
// ---------------------------------------------------------------------------

export function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const named = raw
    .replace(/claude-sonnet-5/g, 'the primary writer')
    .replace(/gpt-5\.6-terra/g, 'the backup writer')
    .replace(/gemini-omni-flash-preview/g, 'Gemini Omni Flash')
    .replace(/veo-3\.1-fast-generate-preview/g, 'Veo 3.1 Fast')
    .replace(/veo-3\.1-generate-preview/g, 'Veo 3.1');
  if (/no_credentials|workspace token|\b401\b/i.test(named)) return 'Your workspace session is not ready yet. Reload the page and try again.';
  if (/insufficient|payment|required|\b402\b/i.test(named)) return 'This generation needs more workspace credits before it can start.';
  if (/rate.?limit|\b429\b/i.test(named)) return 'The production service is busy right now. Wait a moment, then try again.';
  if (/provider[_ -]?error|\b50[0234]\b|service unavailable/i.test(named)) return 'A production service is temporarily unavailable. Your work is safe; retry this step shortly.';
  return named && named !== '[object Object]' ? named : 'Something went wrong.';
}

export async function callHook(name: string, payload: Record<string, unknown>): Promise<any> {
  const token = wsToken();
  const res = await fetch(`/api/hooks/execute/${appId()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Workspace-DB-Token': token } : {}) },
    body: JSON.stringify(payload),
  });
  const raw = await res.json().catch(() => null);
  // Hook responses are wrapped as { response, _meta } unless respondRaw was used.
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  if (!res.ok) throw new Error(String(data?.error || `The ${name} service answered HTTP ${res.status}.`));
  if (data && data.success === false && data.error) throw new Error(String(data.error));
  return data || {};
}

// ---------------------------------------------------------------------------
// LLM — Claude Sonnet 5, falling back to GPT Terra
// ---------------------------------------------------------------------------

export const PRIMARY_LLM = 'claude-sonnet-5';
export const FALLBACK_LLM = 'gpt-5.6-terra';

export interface ModelAnswer {
  text: string;
  model: string;
  /** Set when the primary model failed and the fallback answered instead. */
  degradedFrom: string;
}

async function callAnthropic(system: string, user: string, maxTokens: number, signal?: AbortSignal): Promise<string> {
  const token = wsToken();
  if (!token) throw new Error('This space has no workspace token, so the AI proxy will refuse the call. Reload the page and try again.');
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: PRIMARY_LLM,
      max_tokens: Math.min(8000, maxTokens),
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(String(data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`));
  }
  const text = Array.isArray(data?.content)
    ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text || '')).join('')
    : '';
  if (!text.trim()) throw new Error('Claude returned an empty response.');
  return text;
}

async function callOpenAI(system: string, user: string, maxTokens: number, signal?: AbortSignal): Promise<string> {
  const token = wsToken();
  if (!token) throw new Error('This space has no workspace token, so the AI proxy will refuse the call. Reload the page and try again.');
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: FALLBACK_LLM,
      reasoning_effort: 'none',
      max_completion_tokens: Math.min(8000, maxTokens),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(String(data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`));
  }
  const text = String(data?.choices?.[0]?.message?.content || '');
  if (!text.trim()) throw new Error('The model returned an empty response.');
  return text;
}

/**
 * The brief names claude-sonnet-5, so that is what runs first. The platform's
 * Anthropic account is a shared one that has run out of credit before, so a
 * failure there retries on the approved OpenAI model rather than stranding the
 * customer mid-flow — callers surface `degradedFrom` when it happens.
 */
export async function askModel(system: string, user: string, maxTokens = 4000, signal?: AbortSignal): Promise<ModelAnswer> {
  let primaryError: unknown;
  try {
    return { text: await callAnthropic(system, user, maxTokens, signal), model: PRIMARY_LLM, degradedFrom: '' };
  } catch (e) {
    if (signal?.aborted) throw e;
    primaryError = e;
  }
  try {
    return { text: await callOpenAI(system, user, maxTokens, signal), model: FALLBACK_LLM, degradedFrom: PRIMARY_LLM };
  } catch (fallbackError) {
    throw new Error(
      `Both AI models refused this request. ${PRIMARY_LLM}: ${errorText(primaryError)} — ${FALLBACK_LLM}: ${errorText(fallbackError)}`,
    );
  }
}

/** Pull the first JSON object or array out of a model answer. */
export function parseJson<T>(text: string): T {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const candidates: Array<[number, number]> = [];
  const obj: [number, number] = [cleaned.indexOf('{'), cleaned.lastIndexOf('}')];
  const arr: [number, number] = [cleaned.indexOf('['), cleaned.lastIndexOf(']')];
  if (obj[0] >= 0 && obj[1] > obj[0]) candidates.push(obj);
  if (arr[0] >= 0 && arr[1] > arr[0]) candidates.push(arr);
  candidates.sort((a, b) => a[0] - b[0]);
  for (const [start, end] of candidates) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      /* try the next shape */
    }
  }
  throw new Error('The AI response was not valid JSON. Try again — the same request usually succeeds on a retry.');
}

// ---------------------------------------------------------------------------
// Step 1 — scrape + structure
// ---------------------------------------------------------------------------

export interface ScrapeResult {
  url: string;
  origin: string;
  siteName: string;
  title: string;
  description: string;
  headlines: string[];
  bullets: string[];
  ctas: string[];
  ogImage: string;
  logoUrl: string;
  images: ScrapedImage[];
  videos: ScrapedVideo[];
  palette: Array<{ hex: string; count: number }>;
  themeColor: string;
  fonts: string[];
  screenshotUrl: string;
  screenshotSource: string;
  text: string;
  notes: string[];
}

export async function scrapeBrand(url: string): Promise<ScrapeResult> {
  const data = await callHook('ps-brand-scrape', { url, screenshot: true });
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    url: String(data.url || url),
    origin: String(data.origin || ''),
    siteName: String(data.siteName || ''),
    title: String(data.title || ''),
    description: String(data.description || ''),
    headlines: strings(data.headlines),
    bullets: strings(data.bullets),
    ctas: strings(data.ctas),
    ogImage: String(data.ogImage || ''),
    logoUrl: String(data.logoUrl || ''),
    images: (Array.isArray(data.images) ? data.images : [])
      .map((i: any) => ({ url: String(i?.url || ''), alt: String(i?.alt || '') }))
      .filter((i: ScrapedImage) => Boolean(i.url)),
    videos: (Array.isArray(data.videos) ? data.videos : [])
      .map((v: any) => ({
        kind: (['file', 'youtube', 'vimeo', 'linkedin'].indexOf(String(v?.kind)) >= 0 ? String(v.kind) : 'file') as ScrapedVideo['kind'],
        url: String(v?.url || ''),
        thumbnail: String(v?.thumbnail || ''),
      }))
      .filter((v: ScrapedVideo) => Boolean(v.url)),
    palette: (Array.isArray(data.palette) ? data.palette : [])
      .map((p: any) => ({ hex: String(p?.hex || ''), count: Number(p?.count) || 0 })),
    themeColor: String(data.themeColor || ''),
    fonts: strings(data.fonts),
    screenshotUrl: String(data.screenshotUrl || ''),
    screenshotSource: String(data.screenshotSource || ''),
    text: String(data.text || ''),
    notes: strings(data.notes),
  };
}

/** Grey-ish, near-white and near-black hexes are page chrome, not brand colour. */
function isSignatureColour(hex: string): boolean {
  const h = normalizeHex(hex, '');
  if (!h) return false;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 26) return false;
  return max > 40 && min < 236;
}

function heuristicColours(scrape: ScrapeResult): { primary: string; secondary: string } {
  const candidates = scrape.palette.map((p) => p.hex).filter(isSignatureColour);
  const theme = isSignatureColour(scrape.themeColor) ? normalizeHex(scrape.themeColor, '') : '';
  const primary = theme || candidates[0] || FALLBACK_PRIMARY;
  const secondary = candidates.find((c) => c !== primary) || normalizeHex(scrape.themeColor, FALLBACK_SECONDARY);
  return { primary, secondary };
}

const BRAND_SYSTEM = `You are a brand strategist reading one product page. You receive that page's real harvested evidence: copy, headlines, list items, call-to-action labels, the hex colours that actually appear in its markup with usage counts, its declared fonts and its images.

Return STRICT JSON only — no prose, no markdown fence — with exactly these keys:
{"name":string,"tagline":string,"features":string[],"cta":string,"primaryColor":"#rrggbb","secondaryColor":"#rrggbb","fontFamily":string,"audience":string,"problem":string,"toneOfVoice":string}

Rules:
- name is the PRODUCT name only, with no tagline, separator or company suffix.
- tagline is one sentence, under 90 characters, in the brand's own voice.
- features: 3 to 6 real value propositions taken from the page, each under 60 characters and phrased as a benefit. Never invent a feature, a price, a statistic or a testimonial.
- cta is the real call-to-action label from the page, e.g. "Start free trial". Write a short plausible one only when the page has none.
- primaryColor MUST be one of the supplied hex values: the saturated signature colour the brand uses for buttons, links and highlights — never a grey, near-white or near-black page-chrome colour. secondaryColor is a supporting colour from the same list, or the page canvas colour.
- fontFamily is the single display typeface the page declares, or "Inter" when nothing usable is declared.
- audience: who this is for, one short phrase. problem: the pain it removes, one sentence.
- toneOfVoice: two or three concrete adjectives.`;

function pickHero(scrape: ScrapeResult): string {
  if (scrape.screenshotUrl) return scrape.screenshotUrl;
  if (scrape.ogImage) return scrape.ogImage;
  const nonLogo = scrape.images.find((i) => i.url !== scrape.logoUrl);
  return nonLogo?.url || scrape.images[0]?.url || '';
}

export async function buildBrandObject(
  scrape: ScrapeResult,
  signal?: AbortSignal,
): Promise<{ brand: BrandObject; answer: ModelAnswer }> {
  const evidence = {
    url: scrape.url,
    site_name: scrape.siteName,
    title: scrape.title,
    meta_description: scrape.description,
    headlines: scrape.headlines.slice(0, 10),
    list_items: scrape.bullets.slice(0, 24),
    call_to_action_labels: scrape.ctas,
    declared_fonts: scrape.fonts,
    theme_color: scrape.themeColor,
    hex_colours_with_usage_counts: scrape.palette.slice(0, 18),
    page_text: scrape.text.slice(0, 9000),
  };

  const answer = await askModel(BRAND_SYSTEM, JSON.stringify(evidence), 1600, signal);
  const parsed = parseJson<Record<string, any>>(answer.text);
  const fallbackColours = heuristicColours(scrape);

  const features = (Array.isArray(parsed.features) ? parsed.features : [])
    .map((f: unknown) => String(f || '').trim())
    .filter(Boolean)
    .slice(0, 6);

  const brand: BrandObject = {
    url: scrape.url,
    name: String(parsed.name || scrape.siteName || scrape.title || 'This product').trim().slice(0, 60),
    tagline: String(parsed.tagline || scrape.description || '').trim().slice(0, 120),
    features: features.length ? features : scrape.headlines.slice(0, 4),
    heroImageUrl: pickHero(scrape),
    logoUrl: scrape.logoUrl,
    primaryColor: usableAccent(normalizeHex(parsed.primaryColor, fallbackColours.primary)),
    secondaryColor: normalizeHex(parsed.secondaryColor, fallbackColours.secondary),
    fontFamily: String(parsed.fontFamily || scrape.fonts[0] || 'Inter').trim().slice(0, 60),
    cta: String(parsed.cta || scrape.ctas[0] || 'Get started').trim().slice(0, 40),
    scrapedVideos: scrape.videos,
    screenshotUrl: scrape.screenshotUrl,
    images: scrape.images,
    audience: String(parsed.audience || '').trim().slice(0, 120),
    problem: String(parsed.problem || '').trim().slice(0, 220),
    toneOfVoice: String(parsed.toneOfVoice || '').trim().slice(0, 120),
  };
  return { brand, answer };
}

// ---------------------------------------------------------------------------
// Step 2 — script variants
// ---------------------------------------------------------------------------

export const VARIANT_STYLE_MENU = [
  'Pain → Solution',
  'Demo-first',
  'Social Proof',
  'Founder Story',
  'Feature Walkthrough',
  'Fast Cuts',
  'Cinematic Reveal',
];

const SCRIPT_SYSTEM = `You are a SaaS video creative director writing short-form product ads.

Write SIX distinct script variants for the product described by the user. Each variant is a genuinely different creative approach, not the same script reworded.

Return STRICT JSON only — no prose, no markdown fence:
{"variants":[{"styleLabel":string,"styleSummary":string,"scenes":[{"sceneNumber":number,"durationSeconds":number,"headline":string,"bodyText":string,"visualDescription":string,"cameraNote":string,"voiceover":string,"visual":{"kind":string,"label":string,"value":string,"items":string[],"itemsB":string[],"compareFrom":string,"compareTo":string}}]}]}

Rules:
- styleLabel is one of: Pain → Solution, Demo-first, Social Proof, Founder Story, Feature Walkthrough, Fast Cuts, Cinematic Reveal. Use six different ones.
- styleSummary: one sentence on what this cut does differently, under 90 characters.
- 3 or 4 scenes per variant, numbered from 1. The LAST scene is always the call to action.
- durationSeconds is between 3 and 12, and one variant's scenes must total between 15 and 60 seconds.
- headline: the on-screen line, under 48 characters, no trailing period.
- bodyText: the supporting line under the headline, under 90 characters. May be an empty string.
- visualDescription: one short art-direction note for the human reading the storyboard. Advisory only.
- visual: HOW the scene is actually drawn. THE WHOLE VIDEO IS BUILT IN CODE — there is no image model and nothing is invented, so instead of describing a picture you pick a SHAPE and fill in its strings. kind is exactly one of:
  "product-ui"     the customer's OWN screenshot inside a browser frame. label = the window title. items = up to 3 short callout chips.
  "stat"           one number that matters. value = the number exactly as it should read ("3x", "40%", "12 hrs"). label = what it measures.
  "checklist"      items = 3 or 4 things that tick off one by one. label = the list heading.
  "process"        items = exactly 3 steps in order. label = the heading.
  "feature-cards"  items = 3 features. label = the heading.
  "comparison"     compareFrom / compareTo = the two column headings. items = the left column, itemsB = the right. 2 or 3 each.
  "quote"          value = the sentence, label = who said it.
  "kinetic"        the headline on its own, no graphic.
  Every string under 42 characters. Leave unused fields as "" or [].
  Use "product-ui" for AT MOST two scenes, and only when has_product_screenshot is true. Use "quote" ONLY if the page itself gave you a real quote — never invent a customer, a company or a testimonial. The final call-to-action scene is always "kinetic".
- cameraNote: the move, e.g. "slow push in", "locked off", "whip pan left", "rack focus to the CTA".
- voiceover: the spoken line for that scene, 8 to 28 words, conversational.
- Use ONLY facts the user supplies. Never invent a price, a customer count, a rating or a testimonial; a Social Proof cut speaks about the outcome rather than quoting a fabricated review.
- The CTA scene must use the product's real call-to-action wording.`;

const shortList = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : [])
    .map((s) => String(s || '').trim().slice(0, 42))
    .filter(Boolean)
    .slice(0, max);

function sanitizeVisual(raw: any, scene: { visualDescription: string; headline: string; bodyText: string }, hasImage: boolean): SceneVisual {
  const kind = String(raw?.kind || '') as SceneVisualKind;
  if (SCENE_VISUAL_KINDS.indexOf(kind) < 0) return inferSceneVisual(scene, hasImage);
  const visual = emptySceneVisual(kind);
  visual.label = String(raw?.label || '').trim().slice(0, 42);
  visual.value = String(raw?.value || '').trim().slice(0, kind === 'quote' ? 160 : 42);
  visual.items = shortList(raw?.items, 4);
  visual.itemsB = shortList(raw?.itemsB, 4);
  visual.compareFrom = String(raw?.compareFrom || '').trim().slice(0, 42);
  visual.compareTo = String(raw?.compareTo || '').trim().slice(0, 42);

  // A shape with nothing to draw is worse than the honest fallback.
  if (kind === 'stat' && !visual.value) return inferSceneVisual(scene, hasImage);
  if (kind === 'quote' && !visual.value) return inferSceneVisual(scene, hasImage);
  if (kind === 'comparison' && (!visual.items.length || !visual.itemsB.length)) return inferSceneVisual(scene, hasImage);
  if ((kind === 'checklist' || kind === 'process' || kind === 'feature-cards') && visual.items.length < 2) {
    return inferSceneVisual(scene, hasImage);
  }
  // Asking for the product's interface without a screenshot of it is exactly
  // the invented-UI failure we are removing.
  if (kind === 'product-ui' && !hasImage) return emptySceneVisual('kinetic');
  return visual;
}

function sanitizeScene(raw: any, index: number, hasImage: boolean): StoryboardScene {
  const seconds = Number(raw?.durationSeconds);
  const base = {
    headline: String(raw?.headline || '').trim().slice(0, 64),
    bodyText: String(raw?.bodyText || '').trim().slice(0, 120),
    visualDescription: String(raw?.visualDescription || '').trim().slice(0, 400),
  };
  return {
    sceneNumber: Number(raw?.sceneNumber) > 0 ? Number(raw.sceneNumber) : index + 1,
    durationSeconds: Math.min(12, Math.max(3, Number.isFinite(seconds) ? Math.round(seconds) : 5)),
    ...base,
    cameraNote: String(raw?.cameraNote || '').trim().slice(0, 90),
    voiceover: String(raw?.voiceover || '').trim().slice(0, 240),
    visual: sanitizeVisual(raw?.visual, base, hasImage),
  };
}

function compositionFor(styleLabel: string, totalSeconds: number, aspect: '16:9' | '9:16'): CompositionSettings {
  return {
    width: REEL_WIDTH,
    height: REEL_HEIGHT,
    fps: REEL_FPS,
    totalFrames: framesFor(totalSeconds),
    aspect,
    transition: transitionForStyle(styleLabel),
  };
}

export async function writeScriptVariants(
  brand: BrandObject,
  aspect: '16:9' | '9:16',
  signal?: AbortSignal,
): Promise<{ variants: ScriptVariant[]; answer: ModelAnswer }> {
  const briefing = {
    product_name: brand.name,
    tagline: brand.tagline,
    features: brand.features,
    audience: brand.audience,
    problem_it_removes: brand.problem,
    tone_of_voice: brand.toneOfVoice,
    call_to_action: brand.cta,
    format: aspect === '9:16' ? 'vertical 9:16 social cut' : 'widescreen 16:9 product ad',
    has_product_screenshot: Boolean(brand.heroImageUrl),
    has_existing_footage: brand.scrapedVideos.length > 0,
  };

  const answer = await askModel(SCRIPT_SYSTEM, JSON.stringify(briefing), 8000, signal);
  const parsed = parseJson<{ variants?: any[] }>(answer.text);
  const rawVariants = Array.isArray(parsed?.variants) ? parsed.variants : Array.isArray(parsed) ? (parsed as any[]) : [];

  const hasImage = Boolean(brand.heroImageUrl || brand.images.length);
  const variants: ScriptVariant[] = [];
  rawVariants.forEach((v: any, vi: number) => {
    const scenes = (Array.isArray(v?.scenes) ? v.scenes : [])
      .slice(0, 4)
      .map((s: any, si: number) => sanitizeScene(s, si, hasImage));
    if (scenes.length < 2) return;
    const styleLabel = String(v?.styleLabel || VARIANT_STYLE_MENU[vi % VARIANT_STYLE_MENU.length]).trim().slice(0, 40);
    // The closing scene is always the CTA plate, never a graphic.
    const numbered = scenes.map((s: StoryboardScene, si: number) => ({
      ...s,
      sceneNumber: si + 1,
      visual: si === scenes.length - 1 ? emptySceneVisual('kinetic') : s.visual,
    }));
    const totalSeconds = numbered.reduce((sum: number, s: StoryboardScene) => sum + s.durationSeconds, 0);
    variants.push({
      id: `variant-${vi + 1}`,
      styleLabel,
      styleSummary: String(v?.styleSummary || '').trim().slice(0, 140),
      totalSeconds,
      scenes: numbered,
      composition: compositionFor(styleLabel, totalSeconds, aspect),
    });
  });

  if (variants.length < 2) {
    throw new Error('The director came back with too few usable scripts. Try Regenerate — the same brief usually lands on the second pass.');
  }
  return { variants, answer };
}

// ---------------------------------------------------------------------------
// Step 4 — Remotion render
//
// There is no step-3 image generation any more. Scene visuals are DRAWN IN
// CODE — a browser frame around the customer's own screenshot, or a Remotion
// motion graphic built from their brand tokens (see composition.ts and
// sceneGraphics.tsx). Asking an image model for "the product's dashboard"
// returned a convincing interface that was not the customer's, so that path
// was removed rather than prompt-tuned.
// ---------------------------------------------------------------------------

export interface RenderProgress {
  status: 'rendering' | 'complete' | 'failed';
  renderUrl?: string;
  operationId?: string;
  error?: string;
}

/**
 * pv-render-composition submits the TSX to the platform render service and
 * polls it inside its own budget. A budget expiry comes back as
 * status:'rendering' plus the operation id — re-calling with just that id
 * keeps waiting, which is also how a render resumes after a reload.
 */
export async function submitRender(
  compositionTsx: string,
  props: Record<string, unknown>,
  durationInFrames: number,
): Promise<RenderProgress> {
  return callHook('pv-render-composition', {
    compositionTsx,
    props,
    durationInFrames,
    fps: REEL_FPS,
    width: REEL_WIDTH,
    height: REEL_HEIGHT,
    // A short first budget lands the operation id fast so it can be persisted
    // before anything else has a chance to go wrong.
    budgetMs: 20000,
  });
}

export async function pollRender(operationId: string): Promise<RenderProgress> {
  return callHook('pv-render-composition', { operationId });
}
