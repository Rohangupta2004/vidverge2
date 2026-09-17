/**
 * VidVerge Create — the API layer between the wizard and the platform.
 *
 * Everything the app talks to, in one place:
 *   - POST /api/hooks/execute/<space>/generate-video       (start an Omni Flash render)
 *   - POST /api/hooks/execute/<space>/check-video-status   (poll a render)
 *   - POST /api/hooks/execute/<space>/fetch-website-images (Product Ad: scrape product shots)
 *   - POST /api/hooks/execute/<space>/generate-character-image (portrait — falls back to /api/generate/image
 *     when the hook is not registered)
 *   - POST /proxy/openai/v1/chat/completions               (AI script writing — falls back to templates)
 *   - POST /api/generate/image                             (storyboard scene stills, portrait fallback)
 *   - POST /api/analyze-document                           (image entry point: vision read of an upload)
 *   - POST /api/apify/run                                  (Product Ad: real page scrape, `web-scraping`)
 *   - POST /api/web-search                                 (Product Ad: brief fallback when Apify is off)
 *   - window.__workspaceDb                                 (characters + video_jobs, session-scoped)
 *
 * SESSION RULE: every WorkspaceDB write carries session_id, and every read is
 * re-filtered to session_id === current session — unfiltered reads would show
 * all workspace data to all visitors.
 */
import {
  aiProxyHeaders,
  contentRefusalReason,
  generateImage,
  uploadImage,
  describeImage,
  CHARACTER_VISION_PROMPT,
  FULL_NEGATIVE_PROMPT,
  PHONE_OK_NEGATIVE_PROMPT,
  PORTRAIT_NEGATIVE_PROMPT,
  resolveOwnedSessions,
  rowIsOwnedBy,
  waitForDbSession,
} from '../../lib/reelioStudio';
import {
  BoardScene,
  BuiltScript,
  buildFallbackScript,
  characterDescriptionFor,
  characterSeedLine,
  clampText,
  DIALOGUE_MAX,
  getLength,
  getTone,
  getVideoModel,
  getVideoType,
  makeScene,
  MIN_SCENES,
  SCENE_MAX,
  scenePlanFor,
  ScriptBrief,
  DEFAULT_VIDEO_MODEL,
} from './videoTypes';
import type { CharacterRef } from './videoTypes';

export { generateImage, uploadImage, describeImage, CHARACTER_VISION_PROMPT };

// ---------------------------------------------------------------------------
// Runtime identity
// ---------------------------------------------------------------------------
export function scopedSpaceId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  const w = window as any;
  const id = w.__SPACE_ID__ || w.__APP_ID__ || (w.__SPACE_CONFIG__ && w.__SPACE_CONFIG__.id) || 'workspace-660069';
  return String(id).startsWith('workspace-') ? String(id) : `workspace-${id}`;
}

export function sessionId(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  if (typeof w.__spaceSessionId === 'string' && w.__spaceSessionId) return w.__spaceSessionId;
  const db = w.__workspaceDb;
  if (db && typeof db.sessionId === 'string' && db.sessionId) return db.sessionId;
  return null;
}

function db(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

/** Public workspace data-plane credential required by provider proxies such as Kling. */
export function workspaceDbToken(): string {
  const client = db();
  return client && typeof client.token === 'string' ? client.token : '';
}

function hookHeaders(sid: string | null = sessionId()): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sid) headers['X-Session-Id'] = sid;
  const token = workspaceDbToken();
  if (token) headers['X-Workspace-DB-Token'] = token;
  return headers;
}

/**
 * RETRIES ARE BOUNDED AND SPACED — 3 attempts, 1s then 2s, and only for the
 * failures a second attempt can actually fix.
 *
 * A 4xx means the request itself is wrong, so retrying it is pure latency and
 * wasted spend; a 5xx, a 429 or a dropped connection is the network or the
 * upstream having a moment, and those succeed on a retry often enough to be
 * worth the wait. Nothing anywhere in this app retries without a ceiling: a
 * loop that keeps trying forever is how a render used to look like it was
 * still working hours after it had stopped.
 */
const HOOK_MAX_ATTEMPTS = 3;
const HOOK_RETRY_DELAYS_MS = [1000, 2000];
/**
 * Hard per-attempt timeout (Sep 12 2026): a hook fetch that never answers used
 * to hang its caller's await forever — which is how the Sports pipeline froze
 * mid-scene with every later scene stuck on "Queued". An attempt that exceeds
 * this is aborted and counted as a transient failure, so the bounded retry
 * ladder above still applies and no poller can stall on one dead request.
 */
const HOOK_FETCH_TIMEOUT_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientHookFailure(status: number, message: string): boolean {
  if (status >= 500 || status === 429 || status === 408 || status === 0) return true;
  return /network|failed to fetch|timeout|timed out|temporar|try again/i.test(message);
}

/**
 * Database and SDK internals are useful in the console but never customer copy.
 * Hook failures can contain PostgreSQL relation/column names, SQLSTATE codes or
 * WorkspaceDB policy text; collapse those to a stable, actionable message at
 * the API boundary before any screen, toast or agent progress card sees them.
 */
const DATABASE_ERROR_TEXT =
  /database|workspace\s*db|postgres|sqlstate|\b(?:42p01|42703|2350[235])\b|relation\s+.+\s+does not exist|column\s+.+\s+does not exist|permission denied for (?:table|relation|schema|sequence)|constraint|db\.(?:query|insert|update|delete)|write_policy_denied|verified session/i;

export function userSafeVideoError(value: unknown, fallback: string): string {
  const raw = value as any;
  const message = String((raw && (raw.message || raw.error)) || raw || '').trim();
  if (!message || DATABASE_ERROR_TEXT.test(message)) return fallback;
  return message;
}

/** POST a workspace hook with the current verified session. */
async function postHook(
  name: string,
  body: Record<string, unknown>,
  sid: string | null = sessionId(),
): Promise<any> {
  const payload = body;

  let lastError = `Request failed (${name}).`;
  for (let attempt = 1; attempt <= HOOK_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(HOOK_RETRY_DELAYS_MS[attempt - 2]);
    let status = 0;
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), HOOK_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/hooks/execute/${scopedSpaceId()}/${name}`, {
        method: 'POST',
        headers: hookHeaders(sid),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      status = res.status;
      const data = await res.json().catch(() => null);
      if (res.ok) return data;
      lastError = userSafeVideoError(
        data && data.error,
        'The video service could not complete that request. Please try again.',
      );
    } catch (e: any) {
      lastError = userSafeVideoError(
        controller.signal.aborted ? 'The request timed out. Please try again.' : e,
        'The video service is temporarily unavailable. Please try again.',
      );
    } finally {
      clearTimeout(abortTimer);
    }
    if (!isTransientHookFailure(status, lastError)) break;
  }
  throw new Error(lastError);
}

/**
 * Best-effort ping of the video-reconciler safety net. The Create app calls
 * this on every render-room refresh; the helper self-throttles to ~60s. The
 * reconciler re-polls any clip the provider has not been seen for 90s and
 * enforces the 15-minute no-output hard cap (auto-fail + credit release +
 * session notice). Failures are swallowed — the background watcher schedules
 * cover the same ground.
 */
let lastReconcilerPingAt = 0;
export async function pingVideoReconciler(): Promise<void> {
  const now = Date.now();
  if (now - lastReconcilerPingAt < 55_000) return;
  lastReconcilerPingAt = now;
  try {
    await postHook('video-reconciler', {});
  } catch {
    // Best-effort: the watcher sweeps are the fallback.
  }
}

// ---------------------------------------------------------------------------
// Product Ad: website scrape (images + brief)
// ---------------------------------------------------------------------------
export interface WebsiteImage {
  url: string;
  alt: string;
}

export interface WebsiteBrief {
  name: string;
  tagline: string;
  features: string;
  tone: string;
}

/** Scrape candidate product/hero images off the user's page. Non-fatal on failure. */
export async function fetchWebsiteImages(websiteUrl: string): Promise<WebsiteImage[]> {
  try {
    const data = await postHook('fetch-website-images', { website_url: websiteUrl });
    if (data && data.success && Array.isArray(data.images)) return data.images;
    return [];
  } catch {
    return [];
  }
}

function normalizeSiteUrl(websiteUrl: string): string {
  const raw = (websiteUrl || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Read a brief out of whatever shape the Apify run answered with. */
function briefFromApifyRun(data: any): WebsiteBrief | null {
  const candidates: any[] = [];
  // The GPT parse arrives as { parsedData: "```json\n{...}```", format: "text" }
  // — a fenced JSON STRING nested under parsedData.parsedData (verified live,
  // Aug 15 2026) — so unwrap it before treating it as the brief object.
  let parsed = data && data.parsedData;
  if (parsed && typeof parsed === 'object' && typeof parsed.parsedData === 'string') {
    parsed = extractJson(parsed.parsedData);
  } else if (typeof parsed === 'string') {
    parsed = extractJson(parsed);
  }
  if (parsed && typeof parsed === 'object') candidates.push(Array.isArray(parsed) ? parsed[0] : parsed);
  const results: any[] = data && Array.isArray(data.results) ? data.results : [];
  if (results.length > 0) {
    candidates.push(results[0]);
    // website-content-crawler nests title/description under metadata.
    const meta = results[0] && results[0].metadata;
    if (meta && typeof meta === 'object') {
      candidates.push({
        title: meta.title,
        metaDescription: meta.description,
        text: results[0].text,
        markdown: results[0].markdown,
      });
    }
  }

  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const name = String(c.name || c.productName || c.title || '').trim();
    const tagline = String(c.tagline || c.description || c.metaDescription || '').trim();
    const featureSource = Array.isArray(c.features) ? c.features.join(' ') : c.features || c.text || c.markdown || '';
    const features = String(featureSource).trim();
    if (!name && !tagline && !features) continue;
    return {
      name: clampText(name, 80),
      tagline: clampText(tagline, 160),
      features: clampText(features, 600),
      tone: clampText(String(c.tone || '').trim() || 'confident, modern', 60),
    };
  }
  return null;
}

/**
 * REAL PAGE SCRAPE — the platform `web-scraping` integration (Apify).
 *
 * POST /api/apify/run executes the actor server-side, so this reads the pages
 * the indexed-title guess below cannot: JS-rendered landing pages, anything
 * behind a bot check, and sites too new to be indexed. GPT parsing turns the
 * crawled page into the same four brief fields the intake card edits.
 *
 * Best-effort on purpose. Apify answers 503 when APIFY_API_TOKEN is not
 * configured, 502 when the actor fails and 504 on timeout, so every caller
 * keeps its old fallback and the intake never blocks on this.
 */
export async function scrapeSiteBrief(websiteUrl: string): Promise<WebsiteBrief | null> {
  const url = normalizeSiteUrl(websiteUrl);
  if (!url) return null;
  try {
    const res = await fetch('/api/apify/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorId: 'apify/website-content-crawler',
        input: {
          startUrls: [{ url }],
          maxCrawlPages: 1,
          maxCrawlDepth: 0,
          saveMarkdown: true,
          saveHtml: false,
        },
        timeout: 3,
        // The actor's default playwright crawler needs ~4GB; at the platform's
        // 512MB default the run "succeeds" with itemCount 0 (verified live,
        // Aug 15 2026), which is why this rides along.
        memory: 4096,
        parseWithGPT: true,
        targetFormat: 'json',
        dataDescription:
          'A product or brand landing page. Return one JSON object with: "name" (the product or brand name), ' +
          '"tagline" (one line on what it does and who it is for), "features" (two or three sentences on the key ' +
          "features or benefits, in the page's own language), and \"tone\" (how the brand talks, e.g. playful, " +
          'technical, premium). Use only what the page actually says.',
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return null;
    return briefFromApifyRun(data);
  } catch {
    return null;
  }
}

/**
 * Guess the brief from the site's INDEXED title + description via web search.
 * Kept as the fallback for when the Apify scrape is unavailable or comes back
 * empty — it needs no actor token but only sees what a search engine indexed.
 */
async function fetchIndexedBrief(websiteUrl: string): Promise<WebsiteBrief | null> {
  try {
    let host = websiteUrl.trim();
    if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
    const u = new URL(host);
    const hostname = u.hostname.replace(/^www\./i, '');
    const res = await fetch('/api/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `site:${hostname}` }),
    });
    const data = await res.json().catch(() => null);
    const results: any[] = data && Array.isArray(data.results) ? data.results : [];
    if (results.length === 0) return null;
    const top = results.find((r) => typeof r.link === 'string' && r.link.includes(hostname)) || results[0];
    const title: string = String(top.title || '');
    // "Name | Tagline", "Name — Tagline", "Name: Tagline"
    const m = title.split(/\s*[|\u2013\u2014\-:\u00b7]\s+/);
    const name = (m[0] || hostname.split('.')[0]).trim();
    const tagline = (m.slice(1).join(' — ') || '').trim();
    const snippets = results
      .slice(0, 3)
      .map((r) => String(r.snippet || '').trim())
      .filter(Boolean);
    return {
      name,
      tagline,
      features: snippets.join(' '),
      tone: 'confident, modern',
    };
  } catch {
    return null;
  }
}

/**
 * Auto-fetch product name / tagline / features from a URL: the real Apify page
 * scrape first, the indexed-search guess second. Best-effort either way —
 * returns null when nothing usable comes back, and the user edits the card.
 */
export async function fetchWebsiteBrief(websiteUrl: string): Promise<WebsiteBrief | null> {
  const scraped = await scrapeSiteBrief(websiteUrl);
  if (scraped && (scraped.name || scraped.tagline || scraped.features)) return scraped;
  return fetchIndexedBrief(websiteUrl);
}

// ---------------------------------------------------------------------------
// Image entry point: vision read of an uploaded product / brand image
// ---------------------------------------------------------------------------
export const PRODUCT_VISION_PROMPT =
  'You are building a short-video brief from a single product or brand image. ' +
  'Respond with ONLY valid JSON, no markdown fences, in this exact shape: ' +
  '{"name": string, "tagline": string, "features": string, "visual_reference": string}. ' +
  '"name" is the product or brand name if it is visible or clearly implied, otherwise a short descriptive ' +
  'name for what is shown. "tagline" is one short line on what it is and who it is for. ' +
  '"features" is one to three sentences on what it does or what stands out about it. ' +
  '"visual_reference" is a concrete visual description of the product itself — form, materials, colors, ' +
  'finish, packaging, logo placement — written so an image or video model can reproduce the same product in ' +
  'another shot. Never mention the photograph, the background, or that this is an image.';

export interface ProductImageRead {
  brief: WebsiteBrief;
  /** The look every storyboard scene and render prompt matches. */
  visualReference: string;
}

/**
 * The image entry point's answer to the URL fetch: read an uploaded product /
 * brand image with vision and turn it into the same editable brief, plus the
 * visual-reference line the storyboard and the render reuse. Best-effort —
 * returns null when vision is unavailable, so the user just fills the card in.
 */
export async function describeProductImage(imageUrl: string): Promise<ProductImageRead | null> {
  try {
    const raw = await describeImage(imageUrl, PRODUCT_VISION_PROMPT);
    const parsed = extractJson(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const visual = String(parsed.visual_reference || '').trim();
      return {
        brief: {
          name: String(parsed.name || '').trim(),
          tagline: String(parsed.tagline || '').trim(),
          features: String(parsed.features || '').trim(),
          tone: 'confident, modern',
        },
        visualReference: visual || clampText(raw, 400),
      };
    }
    // Vision answered in prose — keep it as the reference and let the user name it.
    const text = clampText(raw, 400);
    if (!text) return null;
    return {
      brief: { name: '', tagline: '', features: text, tone: 'confident, modern' },
      visualReference: text,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Character portrait generation
// ---------------------------------------------------------------------------
export type PortraitStyle = 'Photorealistic' | 'Cinematic' | 'Animated';

export const PORTRAIT_STYLES: PortraitStyle[] = ['Photorealistic', 'Cinematic', 'Animated'];

function portraitFallbackPrompt(description: string, style: PortraitStyle): string {
  const styleWords =
    style === 'Animated'
      ? 'stylized 3D animated character render, expressive, clean shapes, rich color'
      : style === 'Cinematic'
        ? 'cinematic film lighting, shallow depth of field, filmic color grade'
        : 'photorealistic, professional studio lighting, sharp focus';
  return (
    `Professional portrait of a video character: ${description}. ` +
    `${styleWords}, clean neutral background, face clearly visible, shown from the shoulders up, ` +
    'looking at the camera, high quality. An original fictional character who does not resemble any ' +
    'real, famous or recognisable person.'
  );
}

/**
 * Generate a portrait for the video's character. Primary path is the
 * generate-character-image hook; if it is unavailable (404 / not registered)
 * the app calls the platform image endpoint directly, so the result arrives
 * either way.
 */
export async function generateCharacterPortrait(
  description: string,
  style: PortraitStyle = 'Photorealistic',
): Promise<string> {
  try {
    const data = await postHook('generate-character-image', {
      character_description: description,
      aspect_ratio: '1:1',
      style: style.toLowerCase(),
      // A portrait is the ONE generation that carries the likeness steer
      // (PORTRAIT_NEGATIVE_PROMPT = adult-content + likeness + artifact
      // terms): a photoreal face is what Google's likeness check screens.
      // Scene stills and renders no longer carry it — see
      // SAFETY_NEGATIVE_PROMPT in lib/reelioStudio.ts.
      // Unknown fields are ignored by an un-patched hook, so it is additive.
      negative_prompt: PORTRAIT_NEGATIVE_PROMPT,
    });
    if (data && data.success && typeof data.image_url === 'string' && data.image_url) {
      return data.image_url;
    }
  } catch {
    /* hook not registered yet — fall through to the direct endpoint */
  }
  return generateImage({
    prompt: portraitFallbackPrompt(description, style),
    aspectRatio: '1:1',
    quality: 'high',
    negativePrompt: PORTRAIT_NEGATIVE_PROMPT,
  });
}

/** One storyboard scene still. Aspect matches the video's selected ratio. */
export async function generateScenePreview(prompt: string, aspectRatio: '16:9' | '9:16'): Promise<string> {
  return generateImage({ prompt, aspectRatio, quality: 'medium' });
}

// ---------------------------------------------------------------------------
// AI script generation (platform OpenAI proxy) with deterministic fallback
// ---------------------------------------------------------------------------
export function extractJson(raw: string): any | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Try the whole string, then the outermost {...} or [...] slice.
  const candidates = [cleaned];
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) candidates.push(cleaned.slice(objStart, objEnd + 1));
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push(cleaned.slice(arrStart, arrEnd + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next slice */
    }
  }
  return null;
}

/**
 * Write the script with AI: a structured JSON array of scenes
 * ({ scene_number, shot_type, description, dialogue, duration_seconds }),
 * minimum 3 scenes, scene count and per-scene duration set by the selected
 * length. Falls back to the deterministic per-type templates on any failure
 * so the user always lands on a real storyboard.
 */
export async function generateScript(brief: ScriptBrief): Promise<BuiltScript> {
  const type = getVideoType(brief.typeId);
  const tone = getTone(brief.toneId);
  // THE LENGTH IS A PROMISE: the scene count comes from Omni Flash's ~8s clips,
  // not from a fixed number — which is why a 60s brief used to come back shorter.
  const plan = scenePlanFor(brief.lengthId, brief.model || DEFAULT_VIDEO_MODEL);
  const sceneCount = Math.max(MIN_SCENES, plan.sceneCount);

  const contextLines: string[] = [
    `Video type: ${type ? type.name : brief.typeId} — ${type ? type.blurb : ''}`,
    `Tone: ${tone.label} (${tone.visual})`,
    `Aspect ratio: ${brief.aspect}`,
    `Scenes: exactly ${sceneCount} (never fewer than ${MIN_SCENES}), about ${plan.sceneSeconds} seconds each — that is ${sceneCount * plan.sceneSeconds}s of finished video.`,
  ];
  if (brief.productBrief) {
    contextLines.push(
      `Product: ${brief.productBrief.name}`,
      brief.productBrief.tagline ? `Tagline: ${brief.productBrief.tagline}` : '',
      brief.productBrief.features ? `Key features: ${clampText(brief.productBrief.features, 300)}` : '',
    );
    if (brief.hasProductImages) {
      contextLines.push(
        'Real product reference images are provided — every scene showing the product must say it matches the provided reference image exactly.',
      );
    }
  }
  if (brief.visualReference) {
    contextLines.push(
      `The user started from an uploaded product/brand image. It shows: ${clampText(brief.visualReference, 400)}. ` +
        'Every scene that shows the product must describe it matching that exactly.',
    );
  }
  if (brief.topic) contextLines.push(`Topic / brief from the user: ${clampText(brief.topic, 500)}`);
  contextLines.push(
    brief.character
      ? `On-camera character (keep them visually identical in every scene, refer to them by name): ${brief.character.name} — ${clampText(brief.character.description, 300)}`
      : 'No recurring on-camera character — describe visuals without inventing a presenter.',
  );

  const system =
    'You are an expert short-video director writing production-ready scripts for an AI video generator. ' +
    'Respond with ONLY valid JSON, no markdown fences, in this exact shape: ' +
    '{"title": string, "scenes": [{"scene_number": number, "shot_type": string, "description": string, "dialogue": string, "duration_seconds": number}]}. ' +
    `Rules: at least ${MIN_SCENES} scenes; "shot_type" is a short camera label like "Close-up", "Wide shot", "Macro detail"; ` +
    `"description" is a concrete visual description of the shot (setting, action, camera move, lighting) under ${SCENE_MAX} characters, written so an image/video model can render it; ` +
    `"dialogue" is a short punchy line spoken on camera, under ${DIALOGUE_MAX} characters (empty string only for pure-visual beats); ` +
    'the first scene must hook the viewer in the first 2 seconds and the last scene must close with a clear call-to-action or resolution; ' +
    'NOTHING WRITTEN EVER APPEARS ON SCREEN — the video model cannot spell, so any words it is asked for come out as garbled nonsense: never mention text, captions, subtitles, titles, end cards, signs, labels, logos or a wordmark, and never describe a shot whose point is something written.';

  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      // The token is required: an anonymous proxy call is refused with 401
      // no_credentials, which this function would silently read as "no script"
      // and answer with the deterministic template instead.
      headers: aiProxyHeaders(),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: contextLines.filter(Boolean).join('\n') },
        ],
        max_tokens: 1600,
        temperature: 0.8,
      }),
    });
    const data = await res.json().catch(() => null);
    const raw: string | undefined =
      data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!res.ok || !raw) throw new Error('script generation returned no content');

    const parsed = extractJson(raw);
    const rawScenes: any[] = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.scenes)
        ? parsed.scenes
        : [];
    const scenes: BoardScene[] = rawScenes
      .filter((s) => s && typeof s.description === 'string' && s.description.trim())
      .map((s) =>
        makeScene(
          String(s.shot_type || 'Medium shot'),
          String(s.description),
          typeof s.dialogue === 'string' ? s.dialogue : '',
          // The engine's clip length wins over whatever the writer guessed:
          // a scene can only be as long as a clip the renderer really cuts.
          plan.sceneSeconds,
          brief.model,
        ),
      );
    if (scenes.length < MIN_SCENES) throw new Error(`script came back with ${scenes.length} scene(s)`);

    const fallbackTitle = buildFallbackScript(brief).title;
    return {
      title:
        parsed && !Array.isArray(parsed) && typeof parsed.title === 'string' && parsed.title.trim()
          ? clampText(parsed.title, 60)
          : fallbackTitle,
      scenes,
      characterDescription: characterDescriptionFor(brief.character, type ? type.styleWord : 'cinematic'),
    };
  } catch (e) {
    console.warn('[Create] AI script generation fell back to templates:', e);
    return buildFallbackScript(brief);
  }
}

// ---------------------------------------------------------------------------
// Characters table (session-scoped)
// ---------------------------------------------------------------------------
export interface SavedCharacter {
  id: number;
  name: string;
  image_url?: string | null;
  description?: string | null;
  session_id?: string | null;
  created_at?: string;
}

export async function listSavedCharacters(): Promise<SavedCharacter[]> {
  try {
    // CharacterStep mounts before the asynchronously injected DB session on a
    // fresh visit. Wait for it, then read shared scope so this browser's saved
    // characters from earlier verified sessions are available immediately.
    const owned = await resolveOwnedSessions();
    const client = db();
    if (!client || typeof client.from !== 'function') return [];
    const rows: SavedCharacter[] = [];
    const pageSize = 100;
    let offset = 0;
    while (true) {
      const res = await client
        .from('characters', { shared: true })
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset(offset)
        .get();
      const page = Array.isArray(res && res.data) ? (res.data as SavedCharacter[]) : [];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return rows.filter((r: any) => rowIsOwnedBy(r, owned));
  } catch (e) {
    console.warn('[Create] listSavedCharacters failed:', e);
    return [];
  }
}

export async function saveCharacter(input: {
  name: string;
  description: string;
  image_url?: string;
}): Promise<void> {
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  // Session guard: a write fired before the platform's async session check
  // completes carries no verified X-Session-Id and is refused with "A verified
  // session ID is required for private writes". Wait for the session the SDK
  // will actually send, and stamp THAT id on the row so the owner column
  // always matches the header; fall back to the legacy id only on timeout.
  const sid = (await waitForDbSession()) || sessionId();
  try {
    await client.from('characters').insert({
      name: input.name,
      description: input.description,
      image_url: input.image_url || null,
      session_id: sid,
    });
  } catch (e) {
    console.warn('[Create] saveCharacter failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Video jobs: submit + poll + list
// ---------------------------------------------------------------------------
export interface SubmitStudioVideoInput {
  scenes: BoardScene[];
  character: CharacterRef | null;
  characterDescription: string;
  productImages?: string[];
  tone: string;
  aspectRatio: '16:9' | '9:16';
  title: string;
  /** 15 | 30 | 60 — forwarded to the hook as target_duration_seconds. */
  targetDurationSeconds?: number;
  /**
   * The approved scene-1 storyboard still. Becomes the job's image anchor —
   * i.e. the render's opening frame — instead of the character portrait. See
   * the OPENING-FRAME ANCHOR note on submitStudioVideo().
   */
  openingFrameUrl?: string;
  /**
   * An App Mockup the visitor picked as an optional add-on. Forwarded as
   * `mockup_image_url` so the render can weave that exact screen into the
   * phone-in-hand beat, AND as `phone_shot: true` — the phone beat is opt-in at
   * the hook, so an explicitly chosen mockup is the only thing that asks for
   * one. Its presence also swaps the negative prompt to the PHONE_OK list: the
   * default one steers away from held phones, which would fight the shot the
   * visitor deliberately asked for.
   */
  mockupImageUrl?: string;
  /** Legacy caller value; normalized to the only supported engine, Omni Flash. */
  model?: string;
  /**
   * FRAME CHAINING: the last frame of the most recently completed render (or
   * the live series anchor). Used as the character reference for Omni Flash
   * image-to-video when no explicit character photo is attached.
   */
  chainReferenceUrl?: string;
  /**
   * Optional desired LAST frame for this clip (Sports & Events keyframe
   * chaining). Sent as additive body fields the hook is free to ignore when
   * the engine has no last-frame input.
   */
  endFrameUrl?: string;
}

export interface SubmitResult {
  success: boolean;
  jobId?: string;
  error?: string;
  /** Optional informational line returned by the render service. */
  notice?: string;
  /** The model the render service reports it started on. */
  modelUsed?: string;
}

/**
 * Kick off a render through the existing generate-video hook — the exact
 * body shape the pipeline already consumes. `script` (stringified JSON) is
 * the documented parameter; `script_json` (the full structured storyboard),
 * `product_images`, `character_image_url`, `character_data`, `dialogues` and
 * `reference_image_url` / `referenceImageUrl` ride along for the hook's
 * parser (unknown fields are ignored, so this is safe and additive).
 *
 * `reference_image_url` is an additional visual ingredient. Omni Flash receives
 * the same character and scene/product references on every clip, while the
 * saved character portrait remains the identity source and never becomes frame 0.
 * Both key spellings are sent so the registered hook receives the reference.
 */
export async function submitStudioVideo(input: SubmitStudioVideoInput): Promise<SubmitResult> {
  const kept = input.scenes.filter((s) => (s.description || '').trim().length > 0);
  if (kept.length === 0) {
    return { success: false, error: 'Add at least one scene with a visual description.' };
  }

  // CHARACTER-CONSISTENCY FIX: bake the character reference into EVERY
  // scene description (not just scene 1). With a portrait the seed line ties
  // each scene back to the reference image the clip carries; with a text-only
  // character it restates the appearance per scene. The combined text stays
  // inside SCENE_MAX so the hook's ~1000-char per-scene cap is never at risk.
  const seed = characterSeedLine(input.character);
  const sceneText = (desc: string) => clampText(seed ? `${seed} ${desc}` : desc, SCENE_MAX);

  const hookScenes = kept.map((s) => ({
    scene_description: sceneText(s.description),
    dialogue: clampText(s.dialogue, DIALOGUE_MAX),
  }));
  const structuredScenes = kept.map((s, i) => ({
    scene_number: i + 1,
    shot_type: s.shotType,
    description: sceneText(s.description),
    dialogue: clampText(s.dialogue, DIALOGUE_MAX),
    duration_seconds: s.durationSec,
  }));

  // SESSION ATTRIBUTION: wait for the verified session before submitting, so
  // the video_jobs row the hook inserts is owned from birth. A render fired
  // during the platform's async session bootstrap used to carry no
  // X-Session-Id and could land as an unowned row that NO visitor can ever
  // see (My Videos filters strictly on session_id).
  const sid = (await waitForDbSession()) || sessionId();
  const durationSeconds = kept.reduce((sum, s) => sum + (s.durationSec || 10), 0);
  const negativeList = input.mockupImageUrl ? PHONE_OK_NEGATIVE_PROMPT : FULL_NEGATIVE_PROMPT;

  const body: Record<string, unknown> = {
    script: JSON.stringify(hookScenes),
    script_json: structuredScenes,
    character_description: input.characterDescription,
    tone: input.tone,
    aspect_ratio: input.aspectRatio,
    title: input.title,
    duration_seconds: durationSeconds,
    target_duration_seconds: input.targetDurationSeconds || durationSeconds,
    dialogues: hookScenes.map((s) => s.dialogue),
    // Negative prompt (safety + quality + phone terms), both key spellings —
    // the hook forwards it to Omni Flash's native negativePrompt parameter.
    negative_prompt: negativeList,
    negativePrompt: negativeList,
    // PHONE / APP-MOCKUP BEAT — OPT-IN, said out loud on every render. It used
    // to be the hook's default, which is why a phone showing an app screen kept
    // appearing in the opening shot of videos that never asked for one. Only a
    // mockup the visitor actually chose on the add-ons row turns it on.
    phone_shot: !!input.mockupImageUrl,
    phoneShot: !!input.mockupImageUrl,
  };
  if (sid) body.session_id = sid;
  // The optional App Mockup add-on — the screen the character is shown using.
  if (input.mockupImageUrl) body.mockup_image_url = input.mockupImageUrl;

  // CHARACTER REFERENCE AND OPENING FRAME ARE DIFFERENT INPUTS. The saved
  // character's own photo always travels as the identity ingredient on every
  // scene — falling back to the FRAME-CHAIN reference (the previous render's
  // last frame / the series anchor) when no photo was attached. It must never
  // be substituted with a storyboard still or product shot: doing that silently
  // discarded the user's saved face reference. A scene-1 still/product image,
  // when present, travels separately as the general visual reference.
  const openingFrame = (input.openingFrameUrl || '').trim();
  const characterPhoto = ((input.character && input.character.imageUrl) || '').trim();
  const chainReference = (input.chainReferenceUrl || '').trim();
  const productHero =
    Array.isArray(input.productImages) && input.productImages.length > 0 ? input.productImages[0] : '';
  const characterReferenceUrl = /^https?:\/\//.test(characterPhoto)
    ? characterPhoto
    : /^https?:\/\//.test(chainReference)
      ? chainReference
      : '';
  const sceneReferenceUrl =
    [openingFrame, productHero].find((url) => /^https?:\/\//.test(url || '')) || '';
  const endFrame = (input.endFrameUrl || '').trim();

  if (Array.isArray(input.productImages) && input.productImages.length > 0) {
    body.product_images = input.productImages;
  }
  // This is deliberately not the character portrait. The hook keeps it as an
  // additional scene/product ingredient while character_image_url remains the identity source.
  if (sceneReferenceUrl) {
    body.reference_image_url = sceneReferenceUrl;
    body.referenceImageUrl = sceneReferenceUrl;
  }
  // Scene keyframe chaining (Sports & Events): the desired LAST frame of this
  // clip. Additive — a hook build that has no last-frame input ignores it.
  if (/^https?:\/\//.test(endFrame)) {
    body.end_frame_image_url = endFrame;
    body.endFrameImageUrl = endFrame;
    body.last_frame_image_url = endFrame;
  }

  // Keep the concrete engine fields explicit for persisted render metadata,
  // even though the registered hook enforces Omni Flash server-side.
  const applyModelToBody = (def: ReturnType<typeof getVideoModel>): void => {
    body.provider = def.provider;
    body.video_provider = def.provider;
    body.model = def.model;
    body.video_model = def.model;
    const carryCharacterImage = !!characterReferenceUrl;
    if (carryCharacterImage) body.character_image_url = characterReferenceUrl;
    if (input.character) {
      body.character_data = {
        name: input.character.name,
        description: input.character.description,
        image_url: carryCharacterImage ? characterReferenceUrl : undefined,
      };
    } else if (carryCharacterImage) {
      // Chained frame with no named character: still hand Omni the identity
      // image so the person carries over between renders.
      body.character_data = {
        name: 'Recurring character',
        description: 'Same character as the reference image.',
        image_url: characterReferenceUrl,
      };
    }
  };
  const picked = getVideoModel(input.model || DEFAULT_VIDEO_MODEL);
  applyModelToBody(picked);

  /** One submit attempt. Throws on anything that stopped the render starting. */
  const start = async (): Promise<{ jobId: string; notice?: string; modelUsed?: string }> => {
    const data = await postHook('generate-video', body, sid);
    if (!data || !data.success || !data.job_id) {
      throw new Error(
        userSafeVideoError(data && data.error, 'The render could not be started. Please try again.'),
      );
    }
    return {
      jobId: data.job_id,
      notice: typeof data.notice === 'string' ? data.notice : undefined,
      modelUsed: typeof data.model_used === 'string' ? data.model_used : undefined,
    };
  };

  try {
    const started = await start();
    // The in-chat progress card listens for this and starts polling too.
    window.dispatchEvent(
      new CustomEvent('vidverge:video-submitted', {
        detail: { jobId: started.jobId, notice: started.notice, modelUsed: started.modelUsed },
      }),
    );
    return {
      success: true,
      jobId: started.jobId,
      notice: started.notice,
      modelUsed: started.modelUsed,
    };
  } catch (e: any) {
    return { success: false, error: (e && e.message) || 'Network error starting the render.' };
  }
}

export interface RenderStatus {
  success: boolean;
  status?: string;
  stage?: 'generating' | 'stitching' | 'ready' | 'failed' | string;
  progress?: number;
  job_id?: string;
  download_url?: string;
  /** Omni Flash returns native audio; pending means multi-clip remux is underway. */
  audio?: 'ready' | 'pending' | 'none' | string;
  clip_urls?: string[];
  workspace_uuid?: string;
  user_message?: string;
  error?: string;
  /** Set by the pipeline when the video service refused the job outright. */
  blocked?: boolean;
}

/**
 * A REFUSAL IS AN ENDING — the studio's door onto the shared detector in
 * lib/reelioStudio.ts (contentRefusalReason), which the in-chat progress card
 * reads too. When the service says no on content grounds the job will never
 * become a video, so every poller here treats a match as terminal: the loop
 * stops, the progress bar stops, and the customer gets an answer instead of a
 * bar creeping on forever behind an error.
 *
 * Returns the line to show, or null when this status is not a refusal.
 */
export function contentBlockReason(status: RenderStatus | null): string | null {
  return contentRefusalReason(status);
}

/**
 * A LOST JOB IS AN ENDING TOO — true when a status answer means the render
 * job is GONE at the provider (an HTTP 404 / "not found" from the status
 * endpoint, or the hook's own "no video job" answer). Re-polling a lost job
 * can never succeed: the provider forgot it, so every further ask returns the
 * same 404. The pollers treat ONE of these as an instant hard failure with a
 * fresh-submit Retry, instead of burning their consecutive-failure budget
 * re-asking a question whose answer cannot change.
 */
export function isJobLostStatus(message?: string | null): boolean {
  return /\b(not[ _-]?found|no video job|job (was )?lost|does not exist|http 404)\b/i.test(String(message || ''));
}

export async function checkVideoStatus(jobId?: string): Promise<RenderStatus> {
  const body: Record<string, unknown> = {};
  if (jobId) body.job_id = jobId;
  try {
    const status = (await postHook('check-video-status', body)) as RenderStatus;
    if (status && status.error) {
      status.error = userSafeVideoError(status.error, 'The render could not be completed. Please try again.');
    }
    if (status && status.user_message) {
      status.user_message = userSafeVideoError(
        status.user_message,
        'The render service hit a temporary problem. Please try again.',
      );
    }
    return status;
  } catch (e: any) {
    return {
      success: false,
      error: userSafeVideoError(e, 'The render status is temporarily unavailable. Please try again.'),
    };
  }
}

/**
 * SCENE REGENERATION — re-render exactly one clip of a finished video through
 * the registered regenerate-video-clip hook (always Omni Flash, reusing the
 * job's own immutable character reference). The render watcher then advances
 * the clip like any other render, so the Delivery screen's poll loop shows
 * live progress for it.
 */
export interface RegenerateClipResult {
  success: boolean;
  operationId?: string;
  error?: string;
}

export async function regenerateClip(jobId: string, clipId: number): Promise<RegenerateClipResult> {
  try {
    const data = await postHook('regenerate-video-clip', { job_id: jobId, clip_id: clipId });
    if (data && data.success) {
      return {
        success: true,
        operationId: typeof data.operation_id === 'string' ? data.operation_id : undefined,
      };
    }
    return {
      success: false,
      error: userSafeVideoError(data && data.error, 'That scene could not be regenerated. Please try again.'),
    };
  } catch (e: any) {
    return {
      success: false,
      error: userSafeVideoError(e, 'That scene could not be regenerated. Please try again.'),
    };
  }
}

/**
 * AUTO-FINALIZE a render parked in the one-minute review window
 * ('awaiting_approval'): approve every clip, then ask the status hook to build
 * the final cut — the same two calls the library's Approve button makes. Used
 * by the automatic pipelines so no render ever waits on a manual approval;
 * individual scenes stay regenerable from My Videos afterwards.
 */
export async function approveAndFinalizeJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const approved = await postHook('approve-video-clip', { job_id: jobId });
    if (approved && approved.success === false) {
      return {
        success: false,
        error: userSafeVideoError(approved.error, 'The video could not be approved automatically.'),
      };
    }
    const finalized = await postHook('check-video-status', { job_id: jobId, finalize_approved: true });
    if (finalized && finalized.success === false) {
      return {
        success: false,
        error: userSafeVideoError(finalized.error, 'The final cut could not be started.'),
      };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: userSafeVideoError(e, 'The video could not be approved automatically.') };
  }
}

/**
 * The finished clip files of one job, straight from video_clips (the shared
 * read scope the library uses). A single-scene job's finished clip IS its
 * video, so pollers use this as the fallback when the status hook has not yet
 * assembled a final download URL. QA-flagged clips count as finished — they
 * have a playable file and only carry advisory flags.
 */
export async function fetchJobClipUrls(jobId: string): Promise<string[]> {
  if (!jobId) return [];
  try {
    const client = db();
    if (!client || typeof client.from !== 'function') return [];
    const res = await client
      .from('video_clips', { shared: true })
      .eq('job_id', jobId)
      .orderBy('clip_index', 'asc')
      .limit(100)
      .get();
    const rows: any[] = Array.isArray(res && res.data) ? res.data : [];
    return rows
      .filter((row) => {
        const clipStatus = String((row && row.status) || '').toLowerCase();
        const done = clipStatus === 'completed' || clipStatus === 'done' || clipStatus === 'qa_flagged';
        return done && typeof row.video_url === 'string' && /^https?:\/\//.test(row.video_url);
      })
      .map((row) => String(row.video_url));
  } catch (e) {
    console.warn('[Create] fetchJobClipUrls failed:', e);
    return [];
  }
}

export interface VideoJobRow {
  id: number;
  job_id?: string | null;
  title?: string | null;
  status: string;
  video_url?: string | null;
  tone?: string | null;
  duration_seconds?: number | null;
  scene_count?: number | null;
  aspect_ratio?: string | null;
  error?: string | null;
  session_id?: string | null;
  created_at?: string;
}

/**
 * MY VIDEOS IS PER-USER (Sep 12 2026, founder requirement): the library shows
 * the caller's OWN renders — every session id this browser has ever held
 * (resolveOwnedSessions remembers them, so a returning visitor on a fresh
 * session still sees yesterday's videos) — plus workspace-shared rows that
 * have no owner at all (session_id NULL: server-seeded renders and pipeline
 * deliveries that belong to the workspace, not to another visitor). Rows owned
 * by a DIFFERENT visitor's session are never shown. The founder's own view of
 * their workspace still sees everything (rowIsOwnedBy allows all rows in
 * entrepreneur mode).
 *
 * Results are paged rather than capped at 100 so the library remains complete
 * as the workspace grows, and are ordered created_at DESC.
 */
export async function listOwnVideos(
  options: { throwOnError?: boolean } = {},
): Promise<VideoJobRow[]> {
  const client = db();
  if (!client || typeof client.from !== 'function') {
    const error = new Error('WorkspaceDB is not available in this context.');
    if (options.throwOnError) throw error;
    return [];
  }
  try {
    // Await the verified session (and remember it as owned) so the ownership
    // filter below never runs against a null id on a cold mount.
    const owned = await resolveOwnedSessions();
    const rows: VideoJobRow[] = [];
    const pageSize = 100;
    let offset = 0;

    while (true) {
      const res = await client
        .from('video_jobs', { shared: true })
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset(offset)
        .get();
      const page = Array.isArray(res && res.data) ? (res.data as VideoJobRow[]) : [];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    return rows.filter((row) => rowIsOwnedBy(row, owned) || !row.session_id);
  } catch (e) {
    console.warn('[Create] listOwnVideos failed:', e);
    if (options.throwOnError) throw e;
    return [];
  }
}
