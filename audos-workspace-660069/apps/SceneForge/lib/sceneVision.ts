// SCENE VISION — after a scene's clip (or still) lands, its FIRST FRAME is
// shown to Gemini Vision (`POST /api/generate/vision`, the
// gemini-vision-transform platform capability) and the answer becomes three
// concrete things the rest of the studio uses:
//
//   * SCENE CONTEXT    — detected objects, mood and setting, shown in the
//                        right sidebar so the customer can see what the model
//                        actually produced without scrubbing the clip.
//   * LOWER-THIRD COPY — a short branded caption the Remotion post-processing
//                        layer burns over the scene ('Auto-apply graphics').
//   * B-ROLL TERMS     — search phrases for the Pexels B-roll picker, so the
//                        overlay footage actually matches what is on screen.
//
// Plus a colour palette sampled from the frame, used as the accent for the
// scene's graphics so the brand elements sit in the shot's own colour world.
//
// Frame extraction reuses the proven <video> + canvas path from lib/visualQa
// (the platform /api/video/frames endpoint answers 402 on this workspace, so
// browser decoding is the only route). Vision NEVER blocks production: every
// failure returns null and the scene ships exactly as it rendered.

import { extractClipFrames } from './visualQa';
import { extractJsonPayload } from './proxy';
import { isVideoUrl } from './sceneState';
import { updateScene, type Scene } from './supabase';

// A type alias rather than an interface on purpose: the Scene row types this
// column as Record<string, unknown>, and only an alias carries the implicit
// index signature that makes the assignment check out without a cast.
export type SceneVisionContext = {
  summary: string;
  objects: string[];
  mood: string;
  setting: string;
  /** Up to five hex colours sampled from the frame. */
  palette: string[];
  /** AI-suggested Pexels search phrases for complementary B-roll. */
  broll_terms: string[];
  lower_third: { text: string; subtext: string };
  analyzed_at: string;
  model: string;
  source_url: string;
};

const VISION_MODEL = 'gemini-vision';

const VISION_TASK = [
  'You are a broadcast motion-graphics supervisor looking at ONE still frame taken from a generated video scene.',
  'Describe only what is visibly in the frame — never invent objects that are not there.',
  'Then propose the on-screen graphics this shot should carry.',
  'Reply with PURE JSON only, no prose and no markdown fence, in exactly this shape:',
  '{"summary":"one sentence describing the shot","objects":["up to 6 concrete nouns visible in frame"],"mood":"two or three words","setting":"where this appears to be","palette":["#RRGGBB","#RRGGBB","#RRGGBB"],"broll_terms":["3 short stock-footage search phrases that would cut well against this shot"],"lower_third":{"text":"max 6 words, title case, no trailing period","subtext":"max 10 words of supporting detail"}}',
].join(' ');

function hexes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => String(entry || '').trim())
    .filter((entry) => /^#[0-9a-fA-F]{6}$/.test(entry))
    .slice(0, 5);
}

function phrases(raw: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => String(entry || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((entry) => entry.slice(0, cap))
    .slice(0, max);
}

/** The still a vision pass should look at: the clip's first frame, or the scene's own image. */
async function frameBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  if (isVideoUrl(url)) {
    // 6% in, not 0% — frame zero of a generated clip is often the fade-up.
    const { frames } = await extractClipFrames(url, [0.06]);
    const first = frames[0];
    return first ? { data: first.data, mediaType: first.mediaType || 'image/jpeg' } : null;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > 4_000_000) return null;
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
    const data = dataUrl.split(',')[1] || '';
    return data ? { data, mediaType: blob.type || 'image/jpeg' } : null;
  } catch {
    return null;
  }
}

/**
 * Run Gemini Vision over one scene's first frame. Returns null (never throws)
 * when the frame cannot be read or the vision endpoint refuses — analysis is
 * an enhancement, never a gate on shipping the film.
 */
export async function analyzeSceneFrame(scene: Scene): Promise<SceneVisionContext | null> {
  const sourceUrl = String(scene.render_url || '');
  if (!sourceUrl) return null;
  const frame = await frameBase64(sourceUrl);
  if (!frame) return null;
  try {
    const response = await fetch('/api/generate/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `${VISION_TASK}\nThe scene's own description, for context only: ${String(scene.description || '').slice(0, 300)}`,
        image: frame.data,
        mimeType: frame.mediaType,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.success === false) return null;
    const text = String(payload.result || '');
    const json = extractJsonPayload(text);
    if (!json) return null;
    const parsed = JSON.parse(json) as Record<string, any>;
    const lower = (parsed.lower_third && typeof parsed.lower_third === 'object' ? parsed.lower_third : {}) as Record<string, any>;
    return {
      summary: String(parsed.summary || '').slice(0, 280),
      objects: phrases(parsed.objects, 6, 40),
      mood: String(parsed.mood || '').slice(0, 60),
      setting: String(parsed.setting || '').slice(0, 80),
      palette: hexes(parsed.palette),
      broll_terms: phrases(parsed.broll_terms, 3, 60),
      lower_third: {
        text: String(lower.text || '').slice(0, 60),
        subtext: String(lower.subtext || '').slice(0, 90),
      },
      analyzed_at: new Date().toISOString(),
      model: VISION_MODEL,
      source_url: sourceUrl,
    };
  } catch {
    return null;
  }
}

/** The stored analysis for a scene, if one has been run against its CURRENT visual. */
export function visionOf(scene: Scene): SceneVisionContext | null {
  const raw = (scene as any).vision_context;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const context = raw as SceneVisionContext;
  if (!context.summary && !context.objects?.length) return null;
  return context;
}

/** True when the scene has a visual that vision has not looked at yet. */
export function visionIsStale(scene: Scene): boolean {
  if (!scene.render_url) return false;
  const stored = visionOf(scene);
  return !stored || stored.source_url !== scene.render_url;
}

/**
 * Analyze a scene and persist the result through the server function (the
 * scene tables are server-write-only). Returns the context, or null when the
 * pass could not run. Safe to call repeatedly — an unchanged visual is not
 * re-analyzed unless `force` is set.
 */
export async function runSceneVision(scene: Scene, options: { force?: boolean } = {}): Promise<SceneVisionContext | null> {
  if (!options.force && !visionIsStale(scene)) return visionOf(scene);
  const context = await analyzeSceneFrame(scene);
  if (!context) return null;
  await updateScene(scene.id, { vision_context: context } as any, scene.project_id).catch(() => undefined);
  return context;
}

/** The accent colour a scene's graphics should use: its own palette first, then the film's. */
export function sceneAccent(scene: Scene, fallback: string): string {
  const palette = visionOf(scene)?.palette || [];
  // The second swatch is usually the subject colour; the first is often the
  // dominant background, which makes a low-contrast accent.
  return palette[1] || palette[0] || fallback;
}

/** The B-roll search phrases to offer for a scene: vision's first, then the scene text. */
export function brollSuggestions(scene: Scene): string[] {
  const fromVision = visionOf(scene)?.broll_terms || [];
  if (fromVision.length) return fromVision;
  const words = String(scene.description || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 4);
  return words.length ? [words.join(' ')] : [];
}
