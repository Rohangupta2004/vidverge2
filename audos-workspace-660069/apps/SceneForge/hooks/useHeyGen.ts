import { useCallback, useEffect, useState } from 'react';
import { WORKSPACE_ID, updateProject, type Project, type WordTimestamp } from '../lib/supabase';
import { sleep } from '../lib/proxy';
import { approximateWordTimestamps } from '../agents/orchestrator';
import { sortAvatars } from '../lib/heygenCatalog';

const base = `/api/workspaces/${WORKSPACE_ID}/provider-credentials/heygen/proxy`;
// Content-Type is only sent when there IS a body: a bare GET carrying
// `Content-Type: application/json` makes some transports forward an empty {}
// body, which HeyGen v3 rejects with "Extra inputs are not permitted".
async function heygen(path: string, init?: RequestInit) { const response = await fetch(`${base}/${path.replace(/^\/+/, '')}`, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data?.error?.message || data?.message || data?.error || `HeyGen failed (${response.status})`); return data; }
// A terminal render verdict (HeyGen answered status 'failed') is not a polling
// hiccup: that render id is dead and must not be resumed or re-polled. The
// message is already written for humans; `code` keeps the machine-readable
// failure for logs.
export class HeyGenRenderError extends Error {
  readonly terminal = true;
  code: string;
  constructor(message: string, code: string) { super(message); this.name = 'HeyGenRenderError'; this.code = code; }
}
export function isTerminalRenderFailure(error: unknown): boolean {
  return Boolean(error) && (error as any).terminal === true;
}
// HeyGen's raw failure codes read as jargon in a red banner. The Sep 22 2026
// incident surfaced literally as "SPACE_ENCRYPTION_DISABLED: this workspace's
// customer-managed encryption key has been disabled" — a HeyGen-account-side
// condition that passed on its own and had nothing to do with the user's
// choices (verified through the proxy that day: catalogs and submits kept
// working, the render itself failed at HeyGen, and a later test render
// completed). Translate the verdict to plain language and always say what to
// do next.
function describeRenderFailure(code: string, message: string): string {
  if (code === 'SPACE_ENCRYPTION_DISABLED') return 'The HeyGen video service reported a temporary account-side issue (its workspace encryption key was disabled), so it refused to finish this render. Your script, avatar and voice are fine — press "Generate Avatar Video" to submit the render again. If it keeps failing, the video service is still recovering; try again a little later.';
  const detail = [code, message].filter(Boolean).join(': ');
  return `HeyGen could not finish this avatar render${detail ? ` — ${detail}` : ''}. Press "Generate Avatar Video" to try again.`;
}
function cueTime(value: string) { const parts = value.trim().replace(',', '.').split(':').map(Number); return parts.reduce((sum, part) => sum * 60 + part, 0); }
async function wordsFromSubtitle(url?: string): Promise<WordTimestamp[]> {
  if (!url) return [];
  try {
    const text = await fetch(url).then((response) => response.text()); const lines = text.split(/\r?\n/); const words: WordTimestamp[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/); if (!match) continue;
      const start = cueTime(match[1]); const end = cueTime(match[2]); const cueWords = String(lines[i + 1] || '').replace(/<[^>]+>/g, '').trim().split(/\s+/).filter(Boolean);
      cueWords.forEach((word, index) => words.push({ word, start: start + (end - start) * index / cueWords.length, end: start + (end - start) * (index + 1) / cueWords.length }));
    }
    return words;
  } catch { return []; }
}
// ——— Live catalog (avatars + voices) ———
// The whole catalog is paged out of the API rather than truncated at one
// page, so the picker never hides avatars or voices that actually exist —
// and never shows ones that don't. Paging follows the response's next_token
// ONLY: v3 has no offset paging, and any extra query param is rejected.
const CATALOG_CACHE_KEY = 'sceneforge_heygen_catalog_v1';
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
let catalogMemory: { at: number; avatars: any[]; voices: any[] } | null = null;
function readCatalogCache(): { at: number; avatars: any[]; voices: any[] } | null {
  if (catalogMemory && Date.now() - catalogMemory.at < CATALOG_TTL_MS) return catalogMemory;
  try {
    const raw = sessionStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // A half-empty cache (one list loaded, the other blank) must never hide a
    // list for six hours — require BOTH lists to be present before trusting it.
    if (!parsed || Date.now() - Number(parsed.at) > CATALOG_TTL_MS || !Array.isArray(parsed.avatars) || !Array.isArray(parsed.voices) || !parsed.avatars.length || !parsed.voices.length) return null;
    catalogMemory = parsed;
    return parsed;
  } catch { return null; }
}
function writeCatalogCache(avatars: any[], voices: any[]) {
  catalogMemory = { at: Date.now(), avatars, voices };
  // A catalog too large for sessionStorage still lives in module memory.
  try { sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalogMemory)); } catch { /* quota — memory cache still covers this session */ }
}
// Warm the browser cache for the thumbnails the picker shows first (the
// sorted order puts them at the top of the grid). This runs the moment the
// first avatar page lands — usually while the customer is still on the topic
// or script step — so Step 3 opens with its above-the-fold images already
// downloaded instead of firing a dozen fresh requests on arrival.
let thumbnailsWarmed = false;
function preloadAvatarThumbnails(avatars: any[]) {
  if (thumbnailsWarmed || typeof window === 'undefined' || typeof window.Image === 'undefined') return;
  const top = sortAvatars(avatars).filter((view) => view.image).slice(0, 12);
  if (!top.length) return;
  thumbnailsWarmed = true;
  for (const view of top) { const img = new window.Image(); img.decoding = 'async'; img.src = view.image; }
}
function pageItems(payload: any): any[] {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  for (const key of ['avatars', 'looks', 'voices', 'items', 'list']) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
function pageToken(payload: any): string {
  const token = payload?.next_token ?? payload?.data?.next_token ?? payload?.next_page_token ?? payload?.data?.next_page_token ?? payload?.pagination?.next_token ?? '';
  return token ? String(token) : '';
}
// One catalog page, with retries. The crawl issues dozens of sequential
// requests, so a single transient failure (a 429 rate-limit burst, a 5xx, a
// dropped connection) must not abandon the whole catalog — that is exactly
// how the pickers used to come up empty. Deterministic rejections (400 bad
// parameter…) still throw immediately.
async function heygenPage(query: string): Promise<any> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await heygen(query); }
    catch (e) {
      const message = String((e as any)?.message || e);
      if (attempt >= 3 || !/(^|\D)(429|5\d\d)(\D|$)|rate.?limit|network|timed?\s*out|timeout|fetch/i.test(message)) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
}
interface CatalogPageout { items: any[]; complete: boolean }
async function fetchWholeCatalog(path: string, limit: number, onProgress?: (items: any[]) => void): Promise<CatalogPageout> {
  // HeyGen's v3 catalog endpoints accept `limit` plus the paging `token` from
  // the previous response's next_token, and NOTHING else: any other query
  // param (offset, page, gender, keyword…) is rejected with 400 "Extra inputs
  // are not permitted". The page-size ceiling differs per endpoint (verified
  // 22 Sep 2026 through the workspace proxy): avatars/looks caps at 50
  // (limit=100 answers 400 "Input should be less than or equal to 50") while
  // voices accepts 100 — so the caller passes the right limit per endpoint.
  const all: any[] = [];
  const seen = new Set<string>();
  let token = '';
  for (let page = 0; page < 80; page += 1) {
    const query = token ? `${path}?limit=${limit}&token=${encodeURIComponent(token)}` : `${path}?limit=${limit}`;
    let payload: any;
    try { payload = await heygenPage(query); }
    catch (e) {
      // A page that still fails after retries costs the TAIL of the catalog,
      // not all of it — a partial list keeps the picker usable. Only a
      // failure with nothing fetched at all surfaces as an error.
      if (all.length) return { items: all, complete: false };
      throw e;
    }
    const items = pageItems(payload);
    let added = 0;
    for (const item of items) {
      const id = String(item?.id ?? item?.avatar_id ?? item?.voice_id ?? item?.look_id ?? JSON.stringify(item));
      if (seen.has(id)) continue;
      seen.add(id); all.push(item); added += 1;
    }
    token = pageToken(payload);
    // Progressive delivery: each page is surfaced as it lands, so a caller
    // can paint the first page immediately while the crawl keeps going —
    // v3 paging is next_token only, so pages cannot be fetched in parallel.
    if (added && onProgress) onProgress([...all]);
    if (!token || added === 0) return { items: all, complete: true };
  }
  // The 80-page ceiling was reached with a next_token still in hand.
  return { items: all, complete: !token };
}
export interface HeyGenOptions { avatar_id: string; voice_id: string; engine?: string; resolution: '720p' | '1080p' | '4k'; aspect_ratio: '16:9' | '9:16'; fit: 'cover' | 'contain'; background: { type: 'color' | 'image'; value?: string; url?: string }; voice_settings: { speed: number; pitch?: number; emotion?: string }; captions: boolean; caption_style?: Record<string, unknown>; gestures: boolean; gesture_style?: string; pose?: string; expression?: string; camera?: string; output_format?: 'mp4' | 'webm'; advanced?: Record<string, unknown> }
export function useHeyGen() {
  // Cache-first state: a cached catalog paints on the very first render (no
  // skeleton flash at all) and the fetch effect below is skipped entirely.
  const [avatars, setAvatars] = useState<any[]>(() => readCatalogCache()?.avatars || []); const [voices, setVoices] = useState<any[]>(() => readCatalogCache()?.voices || []); const [progress, setProgress] = useState('');
  const [catalogLoading, setCatalogLoading] = useState<boolean>(() => !readCatalogCache()); const [catalogError, setCatalogError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const cached = readCatalogCache();
    if (cached) { preloadAvatarThumbnails(cached.avatars); return; }
    // The two lists load independently AND progressively: every page is
    // pushed into state as it arrives, so the picker shows its first avatars
    // within one round-trip instead of waiting out the whole multi-page
    // crawl (catalogLoading stays true until the crawl settles, letting the
    // UI mark the tail as still loading). A failure in one list does not
    // blank the other (Promise.all used to reject both, so a voices error
    // also emptied the avatar picker). The cache is only written when BOTH
    // lists loaded — caching a partial catalog would hide the missing half
    // for six hours.
    Promise.allSettled([
      fetchWholeCatalog('v3/avatars/looks', 50, (items) => { if (!cancelled) { setAvatars(items); preloadAvatarThumbnails(items); } }),
      fetchWholeCatalog('v3/voices', 100, (items) => { if (!cancelled) setVoices(items); }),
    ])
      .then(([avatarsResult, voicesResult]) => {
        if (cancelled) return;
        const avatarCatalog = avatarsResult.status === 'fulfilled' ? avatarsResult.value : { items: [], complete: false };
        const voiceCatalog = voicesResult.status === 'fulfilled' ? voicesResult.value : { items: [], complete: false };
        setAvatars(avatarCatalog.items);
        setVoices(voiceCatalog.items);
        const failed = [avatarsResult, voicesResult].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
        if (failed) setCatalogError(String((failed.reason as any)?.message || failed.reason || 'The HeyGen catalog could not be loaded.'));
        // Only a COMPLETE two-sided catalog is cached — caching a truncated or
        // half-loaded crawl would hide the missing entries for six hours.
        if (avatarCatalog.complete && voiceCatalog.complete && avatarCatalog.items.length && voiceCatalog.items.length) writeCatalogCache(avatarCatalog.items, voiceCatalog.items);
      })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, []);
  // One poll loop shared by a fresh render and a resumed one. A transient
  // status failure (dropped connection, 5xx) is tolerated for a while instead
  // of abandoning a paid render mid-flight, and the ceiling is an hour so a
  // long script's avatar master is waited out rather than timed out.
  const pollUntilReady = useCallback(async (videoId: string, project: Project) => {
    let misses = 0;
    for (let i = 0; i < 240; i += 1) {
      setProgress(`HeyGen is rendering · ${i * 15}s`);
      await sleep(15000);
      let video: any = null;
      try { const status = await heygen(`v3/videos/${encodeURIComponent(videoId)}`); video = status.data || status; misses = 0; }
      catch (e) { misses += 1; if (misses >= 6) throw e; continue; }
      if (video.status === 'completed') {
        const duration = Number(video.duration || project.estimated_duration_sec || project.target_length_sec);
        const subtitleWords = await wordsFromSubtitle(video.subtitle_url || video.caption_url);
        const words: WordTimestamp[] = Array.isArray(video.word_timestamps) && video.word_timestamps.length ? video.word_timestamps : subtitleWords.length ? subtitleWords : approximateWordTimestamps(project.script || '', duration);
        setProgress('Avatar video ready');
        return { videoId, videoUrl: video.video_url, duration, words, raw: video };
      }
      if (video.status === 'failed') throw new HeyGenRenderError(describeRenderFailure(String(video.failure_code || ''), String(video.failure_message || '')), String(video.failure_code || 'render_failed'));
    }
    throw new Error('HeyGen render timed out. Reopen this project to resume the render.');
  }, []);
  const generate = useCallback(async (project: Project, options: HeyGenOptions) => {
    // Pre-validation is ADVISORY. A failed look-detail read or a voice-detail
    // 404 used to throw HERE — before any submission — which silently stranded
    // the project at avatar_render with no heygen_video_id and no paid render.
    // Now a failed lookup degrades to sensible defaults and the POST /v3/videos
    // submission itself is the real arbiter; only a genuine catalog verdict
    // (the look exists but supports no v3 engine) still stops the run.
    setProgress('Validating avatar and voice');
    let engine = '';
    let verdict = false;
    try {
      const detail = await heygen(`v3/avatars/looks/${encodeURIComponent(options.avatar_id)}`);
      const supported: string[] = detail.data?.supported_api_engines || [];
      if (supported.length) {
        verdict = true;
        engine = options.engine && supported.includes(options.engine) ? options.engine : (['avatar_iv', 'avatar_v', 'avatar_iii'].find((v) => supported.includes(v)) || '');
        if (!engine) throw new Error('This avatar has no supported v3 engine.');
      }
    } catch (e) {
      if (verdict) throw e; // a real catalog verdict, not a lookup hiccup
    }
    if (!engine) engine = options.engine || 'avatar_iv';
    try { await heygen(`v3/voices/${encodeURIComponent(options.voice_id)}`); } catch { /* advisory only — the submit validates the voice for real */ }
    // POST /v3/videos rejects every unknown key. Keep this payload aligned with
    // the documented avatar-video contract instead of forwarding advanced UI
    // controls or the unsupported pitch/emotion voice settings.
    const speed = Math.min(1.5, Math.max(0.5, Number(options.voice_settings?.speed) || 1));
    const background = options.background.type === 'image' && options.background.url
      ? { type: 'image' as const, url: options.background.url }
      : { type: 'color' as const, value: options.background.value || '#0f172a' };
    const body = {
      type: 'avatar',
      avatar_id: options.avatar_id,
      engine: { type: engine },
      script: project.script,
      voice_id: options.voice_id,
      voice_settings: { speed },
      resolution: options.resolution,
      aspect_ratio: options.aspect_ratio,
      // Portrait masters must FILL the vertical frame full-face: a 'contain'
      // fit letterboxes the presenter into a small talking head with wasted
      // canvas, and those bars are burned into the pixels forever (the
      // platform's portrait compositor cover-scales but cannot remove baked-in
      // letterboxing). 9:16 therefore always submits fit 'cover'.
      fit: options.aspect_ratio === '9:16' ? 'cover' : options.fit,
      ...(options.output_format === 'webm' ? {} : { background }),
      output_format: options.output_format || 'mp4',
    };
    setProgress('Submitting avatar render');
    // A transient submit failure is retried; a deterministic rejection is not.
    let created: any = null;
    for (let attempt = 0; ; attempt += 1) {
      try { created = await heygen('v3/videos', { method: 'POST', body: JSON.stringify(body) }); break; }
      catch (e) {
        const message = String((e as any)?.message || e);
        if (attempt >= 2 || !/(^|\D)(429|5\d\d)(\D|$)|network|timed?\s*out|timeout|fetch/i.test(message)) throw e;
        await sleep(3000 * (attempt + 1));
      }
    }
    const videoId = created.data?.video_id; if (!videoId) throw new Error('HeyGen did not return a video id.');
    // Persisted the moment it exists: this is paid work, and the id is what
    // lets a reload resume the poll instead of losing the render. A failed
    // write is RETRIED instead of silently swallowed — the old .catch(() =>
    // undefined) meant a tab close during the hour-long poll stranded the
    // project at avatar_render with no id and nothing to resume.
    let persisted = false;
    for (let attempt = 0; attempt < 3 && !persisted; attempt += 1) {
      try { await updateProject(project.id, { heygen_video_id: videoId }); persisted = true; }
      catch { await sleep(1500 * (attempt + 1)); }
    }
    if (!persisted) setProgress('HeyGen is rendering — the render id could not be saved yet, so keep this tab open until the avatar video finishes.');
    return pollUntilReady(videoId, project);
  }, [pollUntilReady]);
  /** Reattach to a render that was submitted before a reload or tab close. */
  const resume = useCallback(async (project: Project) => {
    const videoId = project.heygen_video_id;
    if (!videoId) throw new Error('There is no avatar render to resume.');
    setProgress('Reconnecting to the avatar render already in flight');
    return pollUntilReady(videoId, project);
  }, [pollUntilReady]);
  return { avatars, voices, catalogLoading, catalogError, progress, generate, resume };
}
