// Product Videos — the AI Ad Director: ingestion & director brief.
//
// The director turns ONE input — a product URL — into everything the
// SaaSHeroMotion composition needs:
//   1. INGESTION   web-scraping (direct fetch, falling back to the platform's
//                  Apify browser runner for JavaScript-built pages) pulls the
//                  product title, tagline, value proposition and the
//                  screenshot / hero asset off the submitted page. SCREENSHOTS
//                  ARE REAL ONLY: the page's own og/hero image, a headless-
//                  browser capture of the live page (apify/screenshot-url), or
//                  a founder upload — AI-generated mockups are never used, and
//                  the pipeline refuses to start without a real screenshot.
//   2. SCRIPT      POST /proxy/openai/v1/chat/completions (gpt-5.6-terra,
//                  X-Workspace-DB-Token header) writes the 3-beat
//                  Problem-First commercial script:
//                    Beat 1 (0–5s)   relatable frustration hook
//                    Beat 2 (5–18s)  solution reveal over the SaaS UI card
//                    Beat 3 (18–25s) value payoff & call-to-action
//   3. VOICEOVER   ElevenLabs (per-beat segments — the platform voiceover
//                  endpoint, which measures each MP3's real duration).
//   4. TIMESTAMPS  Deepgram nova-3 word-level millisecond stamps on that
//                  audio, with a measured-duration estimation fallback when
//                  no Deepgram path is reachable (audio.timestampSource says
//                  which one produced the stamps).
//   → returns { script, voiceover, timestamps, screenshot_url, title, tagline }
//
// WHERE IT RUNS: the whole director stage executes inside the pv-ad-director
// SERVER FUNCTION (steps 'directing' → 'voiceover' of the pipeline), so no
// open browser is needed after submission — this module is the browser-side
// contract + client for it. The hook inlines the same logic; hook code cannot
// import workspace files, so change both together.

import { resolveSessionId } from './pipeline';

export const AD_HOOK_ENDPOINT = '/api/hooks/execute/workspace-660069/pv-ad-director';

// ---------------------------------------------------------------------------
// Types — the director bundle, exactly as stored on pv_projects (plan/audio).
// ---------------------------------------------------------------------------

export interface AdScriptBeat {
  id: 'hook' | 'solution' | 'cta';
  /** The spoken line for this beat. */
  narration: string;
  /** The short on-screen line for this beat (≤ 6 words). */
  subtitle: string;
}

export interface AdScript {
  title: string;
  tagline: string;
  ctaText: string;
  ctaUrl: string;
  musicTrack: number; // 0 Inspiring · 1 Cinematic Dark · 2 Energetic · 3 Calm · 4 Luxury
  beats: AdScriptBeat[];
}

export interface AdWord {
  word: string;
  /** Milliseconds from the start of the FILM. */
  startMs: number;
  endMs: number;
}

export interface DirectorResult {
  script: AdScript;
  /** Per-beat voiceover MP3s with measured durations. */
  voiceover: Array<{ beat: string; audioUrl: string; durationMs: number }>;
  /** Word-level millisecond timestamps across the film. */
  timestamps: AdWord[];
  timestampSource: 'deepgram' | 'deepgram-byok' | 'estimated';
  screenshot_url: string;
  title: string;
  tagline: string;
}

/** What the scout returns for the confirm card — cheap, nothing is stored. */
export interface AdProductSummary {
  url: string;
  title: string;
  tagline: string;
  valueProp: string;
  /** A REAL screenshot: page hero/og image, live browser capture, or upload. */
  screenshotUrl: string | null;
  /** Where the screenshot came from: 'page' | 'capture' | 'upload' | null. */
  screenshotSource?: string | null;
  logoUrl: string | null;
  accent: string;
}

// ---------------------------------------------------------------------------
// Hook client — shared by director + renderJob.
// ---------------------------------------------------------------------------

function runtime(): any {
  return typeof window === 'undefined' ? {} : (window as any);
}

export function workspaceToken(): string {
  return String(runtime().__workspaceDb?.token || '');
}

export async function callAdHook<T>(payload: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = workspaceToken();
  const sessionId = resolveSessionId();
  if (token) headers['X-Workspace-DB-Token'] = token;
  if (sessionId) headers['X-Session-Id'] = sessionId;
  const response = await fetch(AD_HOOK_ENDPOINT, {
    method: 'POST',
    headers,
    // `wt` is the page's own public workspace token, forwarded so the server
    // pipeline can reach the voiceover + Deepgram endpoints (which refuse a
    // tokenless call). The hook never stores or returns it.
    body: JSON.stringify({ ...payload, wt: token || undefined }),
  });
  const raw = await response.json().catch(() => null);
  const data = raw && typeof raw === 'object' && ('success' in raw || 'error' in raw) ? raw : (raw?.response ?? raw);
  if (!response.ok || !data || data.success === false || data.error) {
    throw new Error(String(data?.error || `The ad director could not be reached (HTTP ${response.status}).`));
  }
  return data as T;
}

/**
 * Read the submitted URL and come back with the summary card: title, tagline,
 * value proposition, the best screenshot/hero asset, logo and accent colour.
 * Costs one small GPT call; generates no audio, no video, and stores nothing.
 */
export async function scoutProduct(url: string): Promise<AdProductSummary> {
  const data = await callAdHook<{ summary: AdProductSummary }>({ op: 'scout', url: url.trim() });
  if (!data?.summary?.title) throw new Error('That page could not be read — check the URL and try again.');
  return data.summary;
}
