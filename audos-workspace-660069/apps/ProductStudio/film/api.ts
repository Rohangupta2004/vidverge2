/**
 * AI PRODUCT ADVERTISEMENT DIRECTOR — shared types, DB access and platform
 * helpers for the agentic ad pipeline (Sep 2026 Ad Director rebuild):
 *
 *   Website URL (+ optional screenshots/goal)
 *     → Claude Opus 5: PRODUCT UNDERSTANDING (extract, never invent)
 *     → Opus: AD STRATEGY (hook type, structure, tone)
 *     → Opus: COMPLETE VOICEOVER SCRIPT — written FIRST, scene by scene,
 *       before any visual generation
 *     → TTS per scene (ElevenLabs voiceover, tts-1 fallback) — REAL audio,
 *       measured; every visual duration is DERIVED from the voice timing
 *     → Opus: VISUAL STORYBOARD — per scene the most understandable visual
 *       type (TEXT | PRODUCT_UI | UI_ANIMATION | AI_VIDEO | B_ROLL | IMAGE |
 *       MOTION_GRAPHIC | EDUCATIONAL_DIAGRAM | COMPARISON | PROCESS |
 *       TIMELINE | BEFORE_AFTER | PRODUCT_MOCKUP | SPLIT_SCREEN)
 *     → per-scene generation: real-screenshot device mockups with cursor
 *       animation (never AI-recreated UI), Omni Flash generative video for
 *       B-roll/lifestyle/cinematic only, GSAP+SVG motion graphics and
 *       educational diagrams, cached Asset Generator images
 *     → Opus quality control (regenerates only weak scenes)
 *     → FFmpeg.wasm composition: voice + captions + ducked music (+ optional
 *       subtle SFX bed) → one downloadable MP4 → ad variations reusing assets
 *
 * No Remotion anywhere. Browser-orchestrated; every step persists to
 * WorkspaceDB (product_films / product_film_scenes / product_film_assets)
 * the moment it lands, so a reload resumes mid-run. Each scene is
 * independent — own narration, visual type, spec, status, layers, clip and
 * fingerprint — so regenerating one scene never touches the rest.
 */

import type { GraphicSpec, MockupSpec } from '../../ScriptToVideo/api';

// ---------------------------------------------------------------------------
// Session / auth plumbing
// ---------------------------------------------------------------------------

export function sessionId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__spaceSessionId || '');
}

export function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

function wdb(): any {
  const db = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  if (!db) throw new Error('Your workspace session is still loading — try again in a moment.');
  return db;
}

export function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type Aspect = '16:9' | '9:16';

/** CREATIVE VISUAL STRATEGY — chosen by the user right after the product
 * inputs, BEFORE the director starts. It biases every storyboard decision:
 *   story_driven    — AI video / cinematic B-roll leads; motion graphics are
 *                     reserved for accurate information (numbers, pricing,
 *                     product names, CTA, comparisons, precise diagrams).
 *   product_focused — real product UI, screenshots and motion graphics lead;
 *                     AI video supports the problem, context and outcome.
 * Persisted with the project (product_films.video_style). */
export type VideoStyle = 'story_driven' | 'product_focused';

export const VIDEO_STYLES: { id: VideoStyle; label: string; blurb: string }[] = [
  {
    id: 'story_driven',
    label: 'Story-Driven',
    blurb: 'Cinematic storytelling with AI-generated visuals. Motion graphics are mainly used for accurate information, numbers, labels and important product details.',
  },
  {
    id: 'product_focused',
    label: 'Product-Focused',
    blurb: 'The product stays at the center with UI, screenshots, feature graphics and demonstrations. AI video is used to support the problem, use case and outcome.',
  },
];

export type FilmStatus =
  | 'draft' | 'understanding' | 'strategizing' | 'scripting' | 'voicing'
  | 'storyboarding' | 'producing' | 'quality' | 'composing' | 'ready' | 'error';

/** THE SCENE STATE MACHINE the pipeline and the UI share:
 *
 *   pending (PLANNING) → generating (GENERATING) → validating (VALIDATING)
 *   → qa_checking (QA_CHECKING) → ready (READY)
 *
 * with retrying (RETRYING) between failed attempts and failed (FAILED) after
 * the last allowed attempt. 'error' is the legacy failed value and is treated
 * exactly like 'failed'. READY is ONLY reachable after the rendered file
 * passed hard media validation AND visual QA — an API returning a URL is
 * never READY. */
export type SceneStatus =
  | 'pending' | 'generating' | 'validating' | 'qa_checking'
  | 'ready' | 'retrying' | 'failed' | 'error';

/** Scene statuses that mean work is actively in flight. */
export const SCENE_IN_FLIGHT: SceneStatus[] = ['generating', 'validating', 'qa_checking', 'retrying'];

export function sceneInFlight(status: string | null | undefined): boolean {
  return SCENE_IN_FLIGHT.includes(String(status || '') as SceneStatus);
}

export function sceneFailed(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'error';
}

/** Human-readable label for a scene status — the UI always shows the ACTUAL
 * pipeline state, never a guess. */
export function sceneStatusLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    pending: 'PLANNING', generating: 'GENERATING', validating: 'VALIDATING',
    qa_checking: 'QA CHECKING', ready: 'READY', retrying: 'RETRYING',
    failed: 'FAILED', error: 'FAILED',
  };
  return labels[String(status || '')] || String(status || 'PLANNING').toUpperCase();
}
/** RENDER ENGINE for a scene. 'veo' is the generative-video engine slot — it
 * now runs Google Omni Flash by default (B-roll/lifestyle/cinematic ONLY,
 * never product UI). The stored value stays 'veo' for row compatibility. */
export type SceneSource = 'veo' | 'mockup' | 'graphic' | 'asset';
export type TransitionKind = 'cut' | 'fade' | 'match_cut' | 'whip_pan';

/** The director-facing VISUAL TYPE taxonomy — Opus picks the most
 * understandable visual representation of each narration line. Each type maps
 * deterministically onto one render engine (see visualTypeToSource). */
export type VisualType =
  | 'TEXT' | 'PRODUCT_UI' | 'UI_ANIMATION' | 'AI_VIDEO' | 'B_ROLL' | 'IMAGE'
  | 'MOTION_GRAPHIC' | 'EDUCATIONAL_DIAGRAM' | 'COMPARISON' | 'PROCESS'
  | 'TIMELINE' | 'BEFORE_AFTER' | 'PRODUCT_MOCKUP' | 'SPLIT_SCREEN';

export const VISUAL_TYPES: VisualType[] = [
  'TEXT', 'PRODUCT_UI', 'UI_ANIMATION', 'AI_VIDEO', 'B_ROLL', 'IMAGE',
  'MOTION_GRAPHIC', 'EDUCATIONAL_DIAGRAM', 'COMPARISON', 'PROCESS',
  'TIMELINE', 'BEFORE_AFTER', 'PRODUCT_MOCKUP', 'SPLIT_SCREEN',
];

/** visual type → render engine. Real screenshots for anything UI; Omni Flash
 * generative video ONLY for B-roll/lifestyle/cinematic; GSAP+SVG for every
 * idea-explaining graphic; generated stills for IMAGE. */
export function visualTypeToSource(t: VisualType): SceneSource {
  if (t === 'PRODUCT_UI' || t === 'UI_ANIMATION' || t === 'PRODUCT_MOCKUP') return 'mockup';
  if (t === 'AI_VIDEO' || t === 'B_ROLL') return 'veo';
  if (t === 'IMAGE') return 'asset';
  return 'graphic';
}

export function visualTypeLabel(t: VisualType | string | null | undefined): string {
  const labels: Record<string, string> = {
    TEXT: 'Text card', PRODUCT_UI: 'Product UI', UI_ANIMATION: 'UI animation',
    AI_VIDEO: 'AI video', B_ROLL: 'B-roll', IMAGE: 'Image',
    MOTION_GRAPHIC: 'Motion graphic', EDUCATIONAL_DIAGRAM: 'Educational diagram',
    COMPARISON: 'Comparison', PROCESS: 'Process flow', TIMELINE: 'Timeline',
    BEFORE_AFTER: 'Before / After', PRODUCT_MOCKUP: 'Product mockup', SPLIT_SCREEN: 'Split screen',
  };
  return labels[String(t || '')] || 'Scene';
}

// ---------------------------------------------------------------------------
// Ad strategy + script (written BEFORE any visual generation)
// ---------------------------------------------------------------------------

export type HookType = 'problem' | 'outcome' | 'curiosity' | 'demo';

/** The Opus ad strategy — decided after understanding, before the script. */
export interface AdStrategy {
  hook_type: HookType;
  hook_line: string;              // the opening line concept
  /** The beats Opus chose from HOOK→PROBLEM→AGITATION→SOLUTION→DEMO→MECHANISM→FEATURES→BENEFIT→PROOF→CTA (adapted, not all). */
  structure: string[];
  tone: string;                   // e.g. "confident, direct, developer-native"
  target_emotion: string;
  music_style: string;            // energetic startup / modern tech / cinematic / minimal / premium
  music_brief: string;            // one-sentence instrumental brief for the music bed
  cta: string;                    // the exact call-to-action ask
  rationale?: string;
}

/** One scripted scene — narration first, visuals later. */
export interface ScriptScene {
  beat: string;                   // which structure beat this line serves
  narration: string;              // the EXACT voiceover line
  product_action?: string;        // what the product is shown doing
  on_screen_text?: string;        // minimal — only when needed
  visual_hint?: string;           // early visual intuition (storyboard may refine)
}

export interface AdScript {
  scenes: ScriptScene[];
  full_text: string;              // the whole voiceover, in order
  estimated_s?: number;
}

/** An ad variation built after the main ad — reuses existing scene clips. */
export interface AdVariation {
  id: string;
  name: string;
  kind: 'alt_hook' | 'fast' | 'cinematic' | 'educational' | 'social_short';
  note?: string;
  /** Ordered scene_keys reused from the main ad (an alt hook may point at a
   * regenerated hook scene stored with idx >= 100). */
  scene_keys: string[];
  video_url?: string | null;
  duration_s?: number | null;
  status: 'planned' | 'building' | 'ready' | 'error';
  error?: string | null;
}

/** Motion-design layer: ambient branded motion behind/around the main content.
 * Captured scenes get it as an injected backdrop; Veo scenes get a separately
 * recorded overlay composited with a screen blend at `opacity` in FFmpeg. */
export interface MotionSpec {
  kind: 'none' | 'gradient_flow' | 'ambient_glow' | 'particles' | 'lines' | 'grid';
  /** 0..1 — how busy the layer is. Motion supports the story, never noise. */
  intensity?: number;
  /** 0..1 — blend opacity when composited over Veo footage. */
  opacity?: number;
}

/** Veo cinematic scene — Opus writes the concept here; the full production
 * prompt (subject/placement/environment/camera/lens/lighting/… + negative)
 * is written at render time so the previous scene's continuity snapshot can
 * be folded in. */
export interface VeoSceneSpec {
  visual_concept: string;      // subject, exact placement, action, setting
  environment?: string;
  characters?: string;         // appearance, wardrobe — or 'none'
  camera?: string;             // type + movement (dolly push, overhead pan…)
  lens_framing?: string;       // wide establishing, macro close-up…
  lighting?: string;           // golden hour, soft box, neon glow…
  style?: string;              // photorealistic, high-end commercial…
  mood?: string;
  must_not_appear?: string;    // hard exclusions beyond the standard negative
  seed_from_previous?: boolean;
  duration_s?: number;
}

/** Asset scene — a (usually generated) product-related image treated with
 * cinematic motion and optional exact labels. `asset_prompt` goes through the
 * cached Asset Generator; `asset_url` reuses an existing asset directly. */
export interface AssetSceneSpec {
  asset_prompt?: string;       // detailed art-directed brief for the Asset Generator
  asset_url?: string;          // an already-available asset to reuse instead
  headline?: string;           // exact on-screen text (deterministic)
  labels?: { text: string }[];
  palette?: Partial<{ bg: string; ink: string; accent: string; accent2: string }>;
  duration_s?: number;
}

export type SceneSpec = VeoSceneSpec | MockupSpec | GraphicSpec | AssetSceneSpec;

export interface PlanScene {
  scene_key: string;
  idx: number;
  source: SceneSource;
  beat_title: string;
  purpose: string;             // the story beat this scene must communicate
  rationale?: string;
  duration_s: number;
  continuity_group: string | null;
  transition_in?: TransitionKind;
  transition_out?: TransitionKind;
  motion?: MotionSpec;
  spec: SceneSpec;
  /** Required-content manifest — what the RENDERED output must contain. */
  required_content?: RequiredContent | null;
  // ---- Ad Director fields (script-first pipeline) ----
  narration?: string;          // the exact voiceover line this scene serves
  visual_type?: VisualType;
  visual_prompt?: string;      // detailed generator brief
  on_screen_text?: string;     // minimal; '' = none
  product_action?: string;     // what the product is shown doing
  music_mood?: string;
  sfx?: string;
}

// ---------------------------------------------------------------------------
// Required-content manifests + rendered-output QA
//
// THE ACTUAL RENDERED FILE IS THE SOURCE OF TRUTH. When the storyboard is
// planned, every scene stores exactly what its final output must contain
// (required_content). QA then extracts frames from the ACTUAL rendered clip
// and the ACTUAL final MP4, runs OCR + vision inspection on them, and
// compares against this manifest. QA never passes because an API succeeded,
// a URL exists, or the prompt mentions the required text.
// ---------------------------------------------------------------------------

export type QaSeverity = 'critical' | 'important' | 'optional';

export interface RequiredTextItem {
  /** The EXACT string that must be readable in the rendered output. */
  value: string;
  critical: boolean;
}

export interface RequiredVisualItem {
  type: 'product_ui' | 'motion_graphic' | 'ai_video' | 'image' | 'diagram';
  /** What the rendered frames must plausibly show — the vision inspector's reference. */
  description: string;
  required: boolean;
}

export interface RequiredContent {
  text: RequiredTextItem[];
  visuals: RequiredVisualItem[];
}

export interface QaFailure {
  requirement: 'text' | 'visual' | 'integrity' | 'timing' | 'composite' | 'audio';
  expected: string;
  detected: string;
  cause: string;
  fix: string;
  severity: QaSeverity;
  sceneIdx?: number;
}

/** Hard validation of a rendered video FILE (never trust that a URL exists). */
export interface ClipIntegrity {
  ok: boolean;
  decodable: boolean;
  duration_s: number;
  width: number;
  height: number;
  /** True when the sampled frames are a uniform blank/black field. */
  blank: boolean;
  reason?: string;
}

export interface SceneQaReport {
  pass: boolean;
  method: string;               // 'frames_ocr_vision'
  checkedAt: string;
  integrity?: ClipIntegrity | null;
  /** Everything OCR actually read in the sampled frames (evidence). */
  detected_text?: string;
  failures: QaFailure[];
}

export interface FinalQaReport {
  pass: boolean;
  checkedAt: string;
  duration_s: number;
  failures: QaFailure[];
  /** Aspects that could not be verified in this browser (never silent). */
  notes: string[];
}

export interface FilmPlan {
  title: string;
  creative_direction: string;  // one-paragraph visual north star
  visual_world?: string;       // recurring motifs, grade, lighting language
  music_brief?: string;        // the ElevenLabs music-bed prompt
  assumptions?: string[];
  scenes: PlanScene[];
}

/** The structured Product Brief — Opus references it for every downstream
 * decision (storyboard, prompts, palettes, asset briefs). */
export interface ProductBrief {
  product_name: string;
  tagline?: string;
  /** The problem the product solves, in the site's own framing. Extracted, never invented. */
  problem?: string;
  key_features?: string[];
  /** Benefits as stated/derivable from the site — never invented. */
  benefits?: string[];
  /** Real pricing found on the site, or '' when none was found (never invented). */
  pricing?: string;
  /** The site's actual call-to-action wording, or '' when none was found. */
  cta_text?: string;
  audience?: string;
  positioning?: string;
  tone?: string;
  use_cases?: string[];
  differentiators?: string[];
  brand?: {
    colors?: { primary?: string | null; secondary?: string | null; accent?: string | null; background?: string | null; text?: string | null };
    typography?: { style?: string | null; heading_font?: string | null };
    tone_of_voice?: string | null;
  } | null;
  ui_notes?: string;           // what the uploaded screenshots actually show
  screenshot_summaries?: { url: string; shows: string }[];
  source_url?: string | null;
  site_screenshot_url?: string | null; // mobile capture from the crawler
}

export interface Film {
  id: number;
  title: string | null;
  source_url: string | null;
  goal: string | null;
  /** Creative visual strategy — story_driven | product_focused. */
  video_style: VideoStyle | null;
  /** Final-video QA report from inspecting the ACTUAL composed MP4. */
  final_qa: FinalQaReport | null;
  aspect_ratio: Aspect | null;
  screenshots: string[] | null;
  brief: ProductBrief | null;
  /** Ad strategy — hook type, structure, tone, music style, CTA. */
  strategy: AdStrategy | null;
  /** The complete voiceover script, written before any visual generation. */
  ad_script: AdScript | null;
  /** Ad variations built after the main ad (reusing existing scene clips). */
  variations: AdVariation[] | null;
  plan: FilmPlan | null;
  status: FilmStatus | null;
  stage_note: string | null;
  continuity: Record<string, { keyframe_url?: string; snapshot?: any }> | null;
  music_url: string | null;
  music_note: string | null;
  /** Optional generated subtle SFX bed — cached so re-composes never re-bill. */
  sfx_url: string | null;
  /** Optional voiceover: the generated tts-1 narration audio URL, the voice it
   * was recorded with, and the director-written script (reused on re-compose
   * and when only the voice changes). */
  narration_url: string | null;
  narration_voice: string | null;
  narration_text: string | null;
  final_video_url: string | null;
  final_thumb_url: string | null;
  duration_s: number | null;
  error: string | null;
  /** AUTO GENERATE (default ON): one Generate click runs the whole pipeline —
   * scenes, QA, retries, quality control, composition — with no further
   * clicks. OFF pauses after storyboarding until the user starts generation. */
  auto_generate: boolean | null;
  /** AUTO MIX (default ON): once all scenes are verified, the music bed and
   * subtle SFX bed are generated automatically and ducked under narration.
   * OFF composes with narration only (existing music is still used). */
  auto_mix: boolean | null;
  /** Video engine registry id the AI-video scenes render on (see
   * ScriptToVideo/pipeline/videoModelService VIDEO_MODELS — e.g. 'omni-flash',
   * 'veo-3.1', 'sora-2'). Null = Omni Flash (pre-picker films, no regression). */
  video_model: string | null;
  created_at: string;
  updated_at: string;
}

/** Auto flags read with their ON defaults (null/undefined = ON). */
export function autoGenerateOn(film: Pick<Film, 'auto_generate'>): boolean {
  return film.auto_generate !== false;
}
export function autoMixOn(film: Pick<Film, 'auto_mix'>): boolean {
  return film.auto_mix !== false;
}

export interface FilmScene {
  id: number;
  film_id: number;
  idx: number;
  scene_key: string;
  source: SceneSource;
  beat_title: string | null;
  purpose: string | null;
  rationale: string | null;
  spec: SceneSpec;
  motion: MotionSpec | null;
  transition_in: string | null;
  transition_out: string | null;
  status: SceneStatus;
  error: string | null;
  /** The exact voiceover line this scene's visual must serve. */
  narration: string | null;
  /** This scene's rendered TTS audio (durable URL). */
  narration_url: string | null;
  /** Measured narration duration (s) — the master clock for the visual. */
  narration_s: number | null;
  /** Director visual taxonomy (see VisualType). */
  visual_type: string | null;
  /** Detailed brief for the scene's visual generator. */
  visual_prompt: string | null;
  /** Minimal exact on-screen text ('' / null = none). Support, never the visual. */
  on_screen_text: string | null;
  /** What the product is shown DOING (feature = action, not label). */
  product_action: string | null;
  music_mood: string | null;
  sfx: string | null;
  /** Reference assets for generation: screenshots, continuity frames. */
  reference_assets: { role: 'first_frame' | 'reference'; url: string }[] | null;
  /** Required-content manifest stored at storyboard time — QA's reference. */
  required_content: RequiredContent | null;
  /** Rendered-output QA verdict for this scene (frames + OCR + vision). */
  qa_report: SceneQaReport | null;
  /** MANUAL PROMPT OVERRIDE — when the user edits the prompt, their EXACT
   * text is stored here and used verbatim as the generation prompt (AI-video
   * scenes). It is never silently replaced by a new Opus prompt; auto-fix
   * retries may only append a bracketed [Fix] clause after it. */
  user_prompt_override: string | null;
  /** The latest Opus-written production prompt (informational). The effective
   * prompt = user_prompt_override when set, else this generated prompt. */
  generated_prompt: string | null;
  clip_url: string | null;
  layer_urls: { motion_overlay?: string; asset?: string; captions?: string; text_overlay?: string } | null;
  clip_fingerprint: string | null;
  veo_operation_id: string | null;
  veo_prompt: { prompt?: string; negative?: string; fields?: any } | null;
  first_frame_url: string | null;
  keyframe_url: string | null;
  continuity: any;
  inspection: { pass?: boolean; issues?: string; method?: string; attempts?: number } | null;
  attempts: number | null;
  duration_s: number | null;
  continuity_group: string | null;
}

export interface FilmAsset {
  id: number;
  film_id: number | null;
  kind: 'generated' | 'upload' | 'keyframe';
  name: string | null;
  description: string | null;
  prompt: string | null;
  fingerprint: string | null;
  url: string;
  aspect: string | null;
}

// ---------------------------------------------------------------------------
// WorkspaceDB access (browser SDK — session-scoped rows)
// ---------------------------------------------------------------------------

export const db = {
  async listFilms(): Promise<Film[]> {
    const { data } = await wdb().from('product_films').orderBy('created_at', 'desc').limit(100).get();
    return Array.isArray(data) ? data : [];
  },
  async getFilm(id: number): Promise<Film | null> {
    const { data } = await wdb().from('product_films').getById(id);
    return (data as Film) || null;
  },
  async createFilm(row: Partial<Film>): Promise<Film> {
    const res = await wdb().from('product_films').insert(row);
    const created = res?.data?.[0] || res?.data || res;
    if (!created?.id) {
      const all = await this.listFilms();
      if (all[0]?.id) return all[0];
      throw new Error('The film row could not be created.');
    }
    return created as Film;
  },
  async updateFilm(id: number, patch: Partial<Film>): Promise<void> {
    await wdb().from('product_films').update(id, patch);
  },
  async deleteFilm(id: number): Promise<void> {
    await wdb().from('product_films').delete(id);
  },
  async listScenes(filmId: number): Promise<FilmScene[]> {
    const { data } = await wdb().from('product_film_scenes').eq('film_id', filmId).orderBy('idx', 'asc').limit(200).get();
    return Array.isArray(data) ? data : [];
  },
  async insertScene(row: Partial<FilmScene>): Promise<void> {
    await wdb().from('product_film_scenes').insert(row);
  },
  async updateScene(id: number, patch: Partial<FilmScene>): Promise<void> {
    await wdb().from('product_film_scenes').update(id, patch);
  },
  async deleteScene(id: number): Promise<void> {
    await wdb().from('product_film_scenes').delete(id);
  },
  async listAssets(filmId?: number | null): Promise<FilmAsset[]> {
    const { data } = await wdb().from('product_film_assets').orderBy('created_at', 'desc').limit(200).get();
    const rows: FilmAsset[] = Array.isArray(data) ? data : [];
    return filmId == null ? rows : rows.filter((a) => a.film_id == null || a.film_id === filmId);
  },
  async addAsset(row: Partial<FilmAsset>): Promise<FilmAsset | null> {
    try {
      const res = await wdb().from('product_film_assets').insert(row);
      return (res?.data?.[0] || res?.data || null) as FilmAsset | null;
    } catch { return null; }
  },
};

// ---------------------------------------------------------------------------
// Uploads (file-storage integration)
// ---------------------------------------------------------------------------

export async function uploadDataUrl(dataUrl: string, fileName: string): Promise<string> {
  const res = await fetch('/api/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
    body: JSON.stringify({ imageData: dataUrl, fileName }),
  });
  const data = await res.json().catch(() => null);
  const url = data && (data.imageUrl || data.url);
  if (!res.ok || typeof url !== 'string') throw new Error(String(data?.error || `Image upload failed (HTTP ${res.status}).`));
  return url;
}

export async function uploadBlob(blob: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append('file', new File([blob], fileName, { type: blob.type || 'application/octet-stream' }));
  form.append('folder', 'product-film');
  const res = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(String(data?.error || `File upload failed (HTTP ${res.status}).`));
  return String(data.url);
}

/** Read a user-picked File and park it on durable storage as an image. */
export async function uploadImageFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  if (!dataUrl.startsWith('data:image/')) throw new Error(`${file.name} is not an image file.`);
  return uploadDataUrl(dataUrl, file.name.replace(/[^\w.-]+/g, '_'));
}

// ---------------------------------------------------------------------------
// Server-function calls (browser → registered hooks)
// ---------------------------------------------------------------------------

/** POST a registered server function and unwrap the { response, _meta } envelope. */
export async function callHook(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/hooks/execute/${appId()}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}),
      ...(sessionId() ? { 'X-Session-Id': sessionId() } : {}),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  if (!res.ok) throw new Error(String(data?.error || `The ${name} service answered HTTP ${res.status}.`));
  return data;
}

// ---------------------------------------------------------------------------
// Fingerprints (cache identity) + misc
// ---------------------------------------------------------------------------

export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) || '';
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return `pf:${hash.toString(36)}:${text.length.toString(36)}`;
}

export function sceneFingerprint(
  scene: Pick<FilmScene, 'source' | 'spec' | 'motion'> & Partial<Pick<FilmScene, 'narration' | 'visual_type' | 'narration_url'>>,
  aspect: Aspect,
): string {
  // Legacy scenes (pre–Ad Director, no narration/visual type) keep the old
  // fingerprint shape so opening an old film never re-renders finished clips.
  if (!scene.narration && !scene.visual_type) {
    return fingerprint({ s: scene.source, p: scene.spec, m: scene.motion, a: aspect });
  }
  // Narration is part of the identity: an edited line re-times and re-renders
  // the scene; the narration audio URL changes when the voice is re-recorded.
  // A user prompt override is part of the identity too — but only when set,
  // so existing scenes' fingerprints (and their cached clips) are untouched.
  const override = (scene as Partial<FilmScene>).user_prompt_override || '';
  return fingerprint({
    s: scene.source, p: scene.spec, m: scene.motion, a: aspect,
    n: scene.narration || '', v: scene.visual_type || '', u: scene.narration_url || '',
    ...(override ? { o: override } : {}),
  });
}

/** The prompt a scene actually generates from: the user's exact override when
 * one exists, else the latest Opus-generated production prompt. */
export function effectivePrompt(scene: Pick<FilmScene, 'user_prompt_override' | 'generated_prompt' | 'visual_prompt'>): string {
  return String(scene.user_prompt_override || scene.generated_prompt || scene.visual_prompt || '').trim();
}

export function newSceneKey(): string {
  return `pf_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function frameSize(aspect: Aspect): { W: number; H: number } {
  return aspect === '9:16' ? { W: 1080, H: 1920 } : { W: 1920, H: 1080 };
}

export function sourceLabel(s: SceneSource): string {
  return s === 'veo' ? 'AI video (Omni Flash)'
    : s === 'mockup' ? 'Real-UI mockup'
    : s === 'graphic' ? 'Motion graphic'
    : 'Generated image';
}

/** The agentic stages the progress UI mirrors. */
export const STAGES: { id: FilmStatus; label: string }[] = [
  { id: 'understanding', label: 'Understanding Product' },
  { id: 'strategizing', label: 'Ad Strategy' },
  { id: 'scripting', label: 'Voiceover Script' },
  { id: 'voicing', label: 'Recording Voice' },
  { id: 'storyboarding', label: 'Visual Storyboard' },
  { id: 'producing', label: 'Generating Scenes' },
  { id: 'quality', label: 'Quality Check' },
  { id: 'composing', label: 'Composing Final Ad' },
];

export function stageIndex(status: FilmStatus | null): number {
  const i = STAGES.findIndex((s) => s.id === status);
  if (i >= 0) return i;
  return status === 'ready' ? STAGES.length : -1;
}

/** Scenes with idx >= this belong to ad VARIATIONS (e.g. a regenerated alt
 * hook) and are excluded from the main ad's storyboard and composition. */
export const VARIATION_IDX_BASE = 100;

// Design tokens — matches the Product Studio dark-editor surfaces.
export const T = {
  canvas: '#121214',
  raised: '#1B1B1F',
  line: '#2A2A30',
  lineStrong: '#3A3A42',
  bone: '#F4F2EE',
  muted: '#8D8B94',
  dim: '#55535C',
  coral: '#FF6B4A',
  gold: '#E8A33C',
  done: '#7FD4B4',
  fault: '#E2726F',
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
  sans: "'Inter', system-ui, sans-serif",
} as const;
