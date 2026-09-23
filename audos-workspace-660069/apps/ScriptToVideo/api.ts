/**
 * Script-to-Video — shared types, design tokens and platform helpers for the
 * rebuilt pipeline (Sep 2026):
 *
 *   Script → Claude Opus 5 (single orchestrator brain) → Scene plan
 *          → Veo (cinematic) / HTML+SVG+GSAP (graphics & product mockups) / assets
 *          → FFmpeg.wasm (browser assembly) → Final MP4
 *
 * No Remotion. No HeyGen. The pipeline is browser-orchestrated; every step is
 * persisted to WorkspaceDB (s2v_films / s2v_film_scenes / s2v_asset_registry)
 * the moment it lands, so a reload or tab close resumes instead of restarting.
 * Each scene is independent: it has its own type, spec, status, clip and
 * fingerprint, so regenerating one scene never touches the others.
 */

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

export type FilmStatus = 'draft' | 'planning' | 'plan_ready' | 'producing' | 'assembling' | 'ready' | 'error';
/** Sequential pipeline vocabulary (waiting/ready/generating/completed/failed/skipped).
 * The legacy values (pending/error, and 'ready' meaning "clip done") still exist on
 * rows written before the rebuild — normalizeScene() maps them on read. */
export type SceneStatus = 'waiting' | 'ready' | 'generating' | 'completed' | 'failed' | 'skipped' | 'pending' | 'error';
export type SceneType = 'video_clip' | 'veo_cinematic' | 'web_graphic' | 'product_mockup' | 'asset_overlay';
export type Aspect = '16:9' | '9:16';

// ---- Sequential pipeline (Sep 2026 rebuild) ----

/** Explicit pipeline state machine. Stored on films.machine_state. */
export type MachineState =
  | 'SCRIPT_RECEIVED' | 'ANALYZING_SCRIPT' | 'SEGMENTING_SCRIPT'
  | 'PREPARING_SCENE' | 'PROMPT_READY' | 'GENERATING_VIDEO' | 'VIDEO_COMPLETED'
  | 'EXTRACTING_FINAL_FRAME' | 'FRAME_READY' | 'DETERMINE_NEXT_REFERENCE' | 'PREPARE_NEXT_SCENE'
  | 'ALL_SCENES_COMPLETED' | 'AUDIO_PLANNING' | 'AUDIO_GENERATING' | 'AUDIO_READY'
  | 'FFMPEG_ASSEMBLY' | 'FINAL_VIDEO';

export type ReferenceType = 'previous_final_frame' | 'character_reference' | 'scene_reference' | 'none';

/** One reference asset attached to a generation request. The previous scene's
 * final frame travels as the seed first frame; character/scene references
 * travel as reference images. */
export interface ReferenceAsset { role: 'first_frame' | 'reference'; url: string }

/** A film character with a LOCKED appearance. The reference image is generated
 * once by the image model (model-made portraits are never rejected by the
 * provider's real-person filter) and reused on every scene that needs it. */
export interface FilmCharacter { id: string; name: string; appearance: string; url: string | null }

// ---- Audio layer (narration / music / SFX — Sep 2026 audio completion) ----

/** On-camera spoken line extracted from the ORIGINAL script at segmentation.
 * When present, the prepared video prompt MUST carry an explicit
 * Dialogue/Speaker/Delivery block so the video model actually voices the line,
 * and the scene keeps its native audio as the authoritative voice at assembly
 * (ElevenLabs narration is skipped for it — exactly one voice per scene). */
export interface SceneDialogue {
  /** The exact spoken words, copied from the script — never invented. */
  line: string;
  /** Character id of the speaker (from plan.characters). */
  speaker: string;
  /** Tone / emotion / energy of the delivery. */
  delivery: string;
  language: string;
  accent?: string;
}

/** Per-scene ElevenLabs narration produced by the audio stage. */
export interface SceneNarration {
  text: string;
  voiceId: string;
  audioUrl: string;
  duration_s: number;
}

/** One consistent voice identity for the whole film, chosen by Opus before any
 * narration is generated. Reused verbatim when a single line is regenerated so
 * the new take never sounds like a different person. */
export interface VoicePlan {
  tone: string;
  energy: string;
  pace: string;
  emotion: string;
  language: string;
  accent: string;
  voiceId: string;
  voiceName: string;
}

export interface AudioNarrationEntry {
  scene_key: string;
  /** Natural spoken wording for this scene — faithful to the original script. */
  text: string;
  /** 'elevenlabs' = ElevenLabs narration is this scene's authoritative voice;
   * 'video_native' = the clip's own generated dialogue is (narration skipped);
   * 'none' = the scene carries no words. */
  voice_source: 'elevenlabs' | 'video_native' | 'none';
  voiceId?: string;
  audioUrl?: string;
  duration_s?: number;
  status: 'pending' | 'ready' | 'failed';
  error?: string;
}

export interface AudioMusicPlan {
  required: boolean;
  preset: string;
  /** Optional richer brief for the custom music endpoint (style, energy,
   * tempo, mood, arc). Preset is the fallback. */
  customPrompt?: string;
  mood?: string;
  /** Music bed volume under the mix (0..1) — narration always ducks it further. */
  volume?: number;
  audioUrl?: string;
  duration_s?: number;
  status: 'pending' | 'ready' | 'failed' | 'skipped';
  error?: string;
}

export interface AudioSfxItem {
  scene_key: string;
  /** What the sound is for (e.g. 'whoosh on the reveal'). */
  description: string;
  /** Sound-design brief sent to the audio engine. */
  prompt: string;
  /** Offset in seconds from the START of the scene. */
  at_s: number;
  volume: number;
  audioUrl?: string;
  duration_s?: number;
  status: 'pending' | 'ready' | 'failed';
  error?: string;
}

/** The film's whole audio production state — persisted on films.audio after
 * every layer so a reload resumes. Regenerating any of it NEVER touches the
 * generated video clips. */
export interface FilmAudio {
  version: 1;
  voice_plan: VoicePlan | null;
  narration: AudioNarrationEntry[];
  music: AudioMusicPlan | null;
  sfx: AudioSfxItem[];
  sfx_status: 'pending' | 'ready' | 'failed' | 'skipped' | 'none';
  /** Fingerprint of scene keys + segments + durations the plan was made for —
   * a mismatch means scenes changed and narration must be re-planned. */
  planned_fingerprint: string;
  planned_at: string;
}

export interface Palette { bg: string; ink: string; accent: string; accent2: string }

/** Veo scene: Opus writes the visual brief; the final prompt is assembled at
 * render time so continuity attributes from the previous scene can be folded in. */
export interface VeoSpec {
  visual_brief: string;          // subject, action, setting, composition
  style: string;                 // e.g. "documentary handheld, natural light"
  camera: string;                // framing + movement
  mood: string;                  // color mood / lighting
  seed_from_previous?: boolean;  // chain from prior scene's last frame
  duration_s?: number;           // 4–8
}

export type GraphicTreatment =
  | 'kinetic_type' | 'documentary_card' | 'flow' | 'stat' | 'bars'
  | 'list' | 'compare' | 'timeline' | 'node_map' | 'quote' | 'annotated';

export interface GraphicItem { label: string; sublabel?: string; value?: number; imageUrl?: string }

export interface GraphicSpec {
  treatment: GraphicTreatment;
  title?: string;
  subtitle?: string;
  items?: GraphicItem[];
  leftTitle?: string; rightTitle?: string;
  leftItems?: string[]; rightItems?: string[];
  stat?: { value: number; prefix?: string; suffix?: string; label?: string };
  backdropUrl?: string;          // asset image behind the graphic (any treatment; dimmed behind text)
  /** AI image brief for a contextual backdrop (subject, setting, mood — no
   * text). When set and backdropUrl is empty, the pipeline generates the
   * image once via the workspace image engine and persists it as backdropUrl. */
  backdrop_prompt?: string;
  footnote?: string;
  palette?: Partial<Palette>;    // Opus varies this per scene — never the same card twice
  texture?: 'grid' | 'dots' | 'diagonal' | 'none';
  duration_s?: number;
}

export interface MockupSpec {
  device: 'phone' | 'laptop' | 'browser';
  screenshot_url: string;        // the REAL product screenshot — never AI-recreated
  headline?: string;
  caption?: string;
  motion: 'scroll' | 'zoom' | 'pan' | 'highlight';
  /** Fractional region of the screenshot to zoom to / spotlight (0..1). */
  focus?: { x: number; y: number; w: number; h: number };
  url_bar_text?: string;         // browser device only
  palette?: Partial<Palette>;
  duration_s?: number;
}

export interface OverlaySpec {
  asset_url: string;             // existing project asset (image)
  motion: 'kenburns_in' | 'kenburns_out' | 'pan_left' | 'pan_right';
  labels?: { text: string; at?: number }[]; // deterministic on-screen labels
  palette?: Partial<Palette>;
  duration_s?: number;
}

/** Sequential-pipeline scene spec: prep context stored beside the prompt.
 * The prompt itself lives in the scene row's `prompt` column. */
export interface VideoClipSpec {
  summary?: string;              // what happens in this clip (director's one-liner)
  visual_goal?: string;          // the visual outcome this clip must land
  negative?: string;             // negative prompt sent with the generation
  reasoning?: string;            // Opus's continuation/reference reasoning
  characters?: string[];         // character ids appearing in this clip
  duration_s?: number;
}

export type SceneSpec = VideoClipSpec | VeoSpec | GraphicSpec | MockupSpec | OverlaySpec;

export interface PlanScene {
  scene_key: string;
  idx: number;
  type: SceneType;
  script_segment: string;
  duration_s: number;
  continuity_group: string | null;
  rationale?: string;
  spec: SceneSpec;
  /** Sequential pipeline: on-camera dialogue extracted from the script. */
  dialogue?: SceneDialogue | null;
  /** Sequential pipeline: director's one-line summary of the clip. */
  summary?: string;
  /** Sequential pipeline: the visual outcome this clip must land. */
  visual_goal?: string;
  /** Sequential pipeline: character ids appearing in this clip. */
  characters?: string[];
}

/** Film-level visual identity the director chooses from the script's tone and
 * subject matter — typography, base palette and mood. The renderer applies
 * these verbatim; the old hardcoded font/palette constants only serve films
 * planned before this field existed. */
export interface FilmStyle {
  /** CSS font stack of LOCALLY AVAILABLE system fonts — the SVG capture path
   * rasterizes through an <img> and cannot load webfonts. */
  font_family: string;
  heading_weight: number;
  body_weight: number;
  colors: { primary: string; secondary: string; accent: string; background: string; text: string };
  visual_mood: string;
}

export interface FilmPlan {
  title: string;
  style_direction: string;       // one-paragraph visual north star for the film
  /** Director-chosen typography + palette + mood, matched to the script (legacy pipeline). */
  style?: FilmStyle;
  scenes: PlanScene[];
  assumptions?: string[];
  // ---- Sequential pipeline GLOBAL CONTEXT (layer 1 of the three-layer prompt system) ----
  /** What the whole story is — Opus writes this after reading the ENTIRE script. */
  story_summary?: string;
  /** The world/setting shared by every scene. */
  world?: string;
  /** The film-wide visual style (look, palette, lens language, mood). */
  visual_style?: string;
  /** Characters with locked appearances (reference image URLs live on film.character_refs). */
  characters?: { id: string; name: string; appearance: string }[];
}

export interface FilmFinishState {
  settings: {
    narration: boolean;
    voiceId?: string;
    music: boolean;
    musicPreset: string;
    captions: boolean;
  };
  source_fingerprint: string;
  narration_urls?: string[];
  music_url?: string;
  captions_srt?: string;
  completed_at?: string;
}

export interface Film {
  id: number;
  title: string | null;
  script: string | null;
  aspect_ratio: Aspect | null;
  status: FilmStatus | null;
  stage_note: string | null;
  plan: FilmPlan | null;
  continuity: Record<string, { keyframe_url?: string; attributes?: any }> | null;
  brand: any;
  product_screenshot_url: string | null;
  final_video_url: string | null;
  final_thumb_url: string | null;
  duration_s: number | null;
  error: string | null;
  finish: FilmFinishState | null;
  /** Sequential pipeline state machine state (null on pre-rebuild films). */
  machine_state: MachineState | null;
  /** Locked character reference images: [{ id, name, appearance, url }]. */
  character_refs: FilmCharacter[] | null;
  /** Audio production state: voice plan, per-scene narration, music, SFX. */
  audio: FilmAudio | null;
  /** Video model id this film's clips render on ('omni-flash' | 'seedance-2.0'
   * | 'kling-v2-master'). Null = omni-flash (pre-picker films). */
  video_model: string | null;
  created_at: string;
  updated_at: string;
}

export interface FilmScene {
  id: number;
  film_id: number;
  idx: number;
  scene_key: string;
  type: SceneType;
  script_segment: string;
  spec: SceneSpec;
  status: SceneStatus;
  error: string | null;
  asset_url: string | null;
  /** ElevenLabs narration for CAPTURED (motion-graphic / mockup / overlay)
   * scenes only — Veo cinematic scenes keep their native dialogue/ambient
   * audio and never carry one. Mixed into the scene's segment at assembly. */
  narration_url?: string | null;
  clip_fingerprint: string | null;
  veo_operation_id: string | null;
  first_frame_url: string | null;
  keyframe_url: string | null;
  visual_attributes: any;
  validation: { pass?: boolean; issues?: string; method?: string } | null;
  duration_s: number | null;
  continuity_group: string | null;
  /** Sequential pipeline: the production-ready prompt Opus prepared for this clip
   * (three-layer context). Null until the scene is prepared. */
  prompt: string | null;
  /** Opus's continuation decision: true = continue from the previous scene's final
   * frame; false = independent scene that must NOT receive the previous frame. */
  continuation: boolean | null;
  reference_type: ReferenceType | null;
  reference_assets: ReferenceAsset[] | null;
  /** On-camera spoken line from the ORIGINAL script (null = no on-camera speech). */
  dialogue: SceneDialogue | null;
  /** ElevenLabs narration attached to this scene by the audio stage. */
  narration: SceneNarration | null;
}

/**
 * Map legacy scene rows (pre-rebuild vocabulary) onto the sequential pipeline
 * vocabulary at READ time. Never written back — writes always use new values.
 *   pending → waiting · error → failed
 *   ready without a prepared prompt = a legacy FINISHED clip → completed
 */
export function normalizeScene(row: FilmScene): FilmScene {
  const s = String(row.status || '');
  let status: SceneStatus;
  if (s === 'pending') status = 'waiting';
  else if (s === 'error') status = 'failed';
  else if (s === 'ready' && !row.prompt) status = row.asset_url ? 'completed' : 'waiting';
  else status = (s as SceneStatus) || 'waiting';
  return status === row.status ? row : { ...row, status };
}

export interface AssetRow {
  id: number;
  film_id: number | null;
  kind: 'character' | 'icon' | 'product' | 'screenshot' | 'generated_image' | 'keyframe' | 'clip';
  name: string;
  description: string | null;
  url: string;
  tags: string[] | null;
  fingerprint: string | null;
}

// ---------------------------------------------------------------------------
// WorkspaceDB access (browser SDK — session-scoped rows)
// ---------------------------------------------------------------------------

export const db = {
  async listFilms(): Promise<Film[]> {
    const { data } = await wdb().from('s2v_films').orderBy('created_at', 'desc').limit(100).get();
    return Array.isArray(data) ? data : [];
  },
  async getFilm(id: number): Promise<Film | null> {
    const { data } = await wdb().from('s2v_films').getById(id);
    return (data as Film) || null;
  },
  async createFilm(row: Partial<Film>): Promise<Film> {
    const res = await wdb().from('s2v_films').insert(row);
    const created = res?.data?.[0] || res?.data || res;
    if (!created?.id) {
      // Some SDK builds return only { success } — re-read the newest row.
      const all = await this.listFilms();
      if (all[0]?.id) return all[0];
      throw new Error('The film row could not be created.');
    }
    return created as Film;
  },
  async updateFilm(id: number, patch: Partial<Film>): Promise<void> {
    await wdb().from('s2v_films').update(id, patch);
  },
  async listScenes(filmId: number): Promise<FilmScene[]> {
    const { data } = await wdb().from('s2v_film_scenes').eq('film_id', filmId).orderBy('idx', 'asc').limit(200).get();
    return (Array.isArray(data) ? data : []).map(normalizeScene);
  },
  async insertScene(row: Partial<FilmScene>): Promise<void> {
    await wdb().from('s2v_film_scenes').insert(row);
  },
  async updateScene(id: number, patch: Partial<FilmScene>): Promise<void> {
    await wdb().from('s2v_film_scenes').update(id, patch);
  },
  async deleteScene(id: number): Promise<void> {
    await wdb().from('s2v_film_scenes').delete(id);
  },
  async listAssets(filmId?: number | null): Promise<AssetRow[]> {
    const q = wdb().from('s2v_asset_registry').orderBy('created_at', 'desc').limit(200);
    const { data } = await q.get();
    const rows: AssetRow[] = Array.isArray(data) ? data : [];
    // Session-wide assets (film_id null) are always reusable; film assets only for their film.
    return filmId == null ? rows : rows.filter((a) => a.film_id == null || a.film_id === filmId);
  },
  async addAsset(row: Partial<AssetRow>): Promise<void> {
    try { await wdb().from('s2v_asset_registry').insert(row); } catch { /* registry is best-effort */ }
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
  form.append('folder', 's2v');
  const res = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(String(data?.error || `File upload failed (HTTP ${res.status}).`));
  return String(data.url);
}

// ---------------------------------------------------------------------------
// AI image generation (asset-image-gen server function → Omni Flash → GCS)
// ---------------------------------------------------------------------------

/** Generate a bespoke backdrop/contextual image through the workspace's
 * cached Asset Generator server function — the same engine the other apps in
 * this workspace use. The platform AI proxy exposes no image-generation
 * endpoint (only chat and speech), so images always route through this hook,
 * which returns a durable public GCS URL. */
export async function generateBackdropImage(prompt: string, aspect: Aspect | '1:1'): Promise<string> {
  const res = await fetch(`/api/hooks/execute/${appId()}/asset-image-gen`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}),
      ...(sessionId() ? { 'X-Session-Id': sessionId() } : {}),
    },
    body: JSON.stringify({ op: 'generate', prompt, aspect }),
  });
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  const url = data?.imageUrl;
  if (!res.ok || typeof url !== 'string' || !url) throw new Error(String(data?.error || `The image engine answered HTTP ${res.status}.`));
  return url;
}

// ---------------------------------------------------------------------------
// Fingerprints (clip cache identity) + misc
// ---------------------------------------------------------------------------

export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) || '';
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return `s2v:${hash.toString(36)}:${text.length.toString(36)}`;
}

export function sceneFingerprint(scene: Pick<FilmScene, 'type' | 'spec'>, aspect: Aspect): string {
  return fingerprint({ t: scene.type, s: scene.spec, a: aspect });
}

export function newSceneKey(): string {
  return `sc_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(m)}:${two(s % 60)}`;
}

export function sceneTypeLabel(t: SceneType): string {
  return t === 'video_clip' ? 'AI video clip'
    : t === 'veo_cinematic' ? 'Cinematic (Veo)'
    : t === 'web_graphic' ? 'Motion graphic'
    : t === 'product_mockup' ? 'Product mockup'
    : 'Asset overlay';
}

/** Frame size the graphics/mockup captures render at, per aspect. */
export function frameSize(aspect: Aspect): { W: number; H: number } {
  return aspect === '9:16' ? { W: 1080, H: 1920 } : { W: 1920, H: 1080 };
}

// ---------------------------------------------------------------------------
// Design tokens — this app's own dark-editor surface palette (unchanged from
// the previous S2V app so the shell experience stays consistent).
// ---------------------------------------------------------------------------

export const T = {
  canvas: '#131316',
  raised: '#1C1C21',
  bone: '#EDEBE8',
  muted: '#77757F',
  dim: '#4A4852',
  live: '#E8A33C',
  done: '#7FD4B4',
  fault: '#E2726F',
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
  sans: "'Inter', system-ui, sans-serif",
} as const;
