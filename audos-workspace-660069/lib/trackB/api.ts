/**
 * Track B (Product Video / HyperFrames) client — the ONLY way the in-space
 * Product Editor talks to the project store. Every mutation goes through the
 * `trackb-project` server function, which enforces the safe mutation contract
 * (field ownership, validation, credits, undo/redo, user-wins conflicts).
 * The canonical contract lives at track-b/editor/mutation-contract.json and
 * track-b/schema/project.schema.json; the constants here mirror it.
 *
 * Track A (produce_video / generate-video) is a completely separate flow and
 * is not touched by anything in this file.
 */

export const TRACKB_HOOK_ENDPOINT = '/api/hooks/execute/workspace-660069/trackb-project';
export const SCRAPE_WEBSITE_HOOK_ENDPOINT = '/api/hooks/execute/workspace-660069/scrape-website';
export const TRACKB_RENDER_ENDPOINT = '/api/hooks/execute/workspace-660069/trackb-render';
export const AUDOS_WORKSPACE_UUID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

export type SceneState = 'EDITABLE' | 'BAKED' | 'REGENERATING' | 'ERROR' | 'LOCKED';

/**
 * Brand kit (PRD 1.1) — extracted by a dedicated claude-opus-5 step inside the
 * scrape-website function from the page's REAL colour/typography evidence, then
 * reviewed (and optionally edited) by the user on the confirmation card before
 * generation. It is the single source of colour + typography for the film.
 */
export interface BrandKit {
  colors: {
    primary?: string | null;
    secondary?: string | null;
    accent?: string | null;
    background?: string | null;
    text?: string | null;
  };
  typography?: {
    style?: string | null;
    font_stack?: string | null;
    heading_font?: string | null;
  };
  tone_of_voice?: string | null;
  product_name?: string | null;
  tagline?: string | null;
}

export interface TrackBScene {
  id: string;
  state: SceneState;
  version: number;
  intent: string | null;      // PLANNER
  motion: string | null;      // PLANNER
  /** PLANNER — concrete cinematography direction from the scene-planning step. */
  visual_direction?: string | null;
  /** PLANNER — this scene must present the product screenshot in a device mockup. */
  show_product_screenshot?: boolean;
  /** Narration beat assigned to this scene by timestamp/script pacing. */
  narration_text?: string | null;
  narration_timing?: { start_s: number; end_s: number; anchor_words: string[] } | null;
  timing_range: { min_s: number; max_s: number } | null; // PLANNER
  duration_s: number;         // USER
  headline: string | null;    // USER
  caption: string | null;     // USER
  asset_refs: string[];
  composition_file?: string | null;
  error?: string;
  thumbnail_url?: string | null;
  /** Resolved by the smart image chain: user upload > Apify scrape > opt-in AI gen > Apify fallback. Null with image_source 'brand_tile' renders a brand-colour tile. */
  image_url?: string | null;
  image_source?: 'user_upload' | 'apify_scrape' | 'ai_generated' | 'apify_fallback' | 'brand_tile' | null;
  generated_image_url?: string | null;
}

export interface NarrationWordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TrackBNarrationPlan {
  source: 'voice_track' | 'user_script' | 'ai';
  transcript: string | null;
  words: NarrationWordTiming[];
  duration_s: number | null;
  audio_url: string | null;
  transcription_status?: 'pending' | 'completed' | 'not_required';
}

export interface TrackBProjectInner {
  id: number | null;
  schema_version: string;
  version: number;
  updated_at: string;
  last_render_version: number | null;
  track: 'product';
  status: string;
  title: string;
  route: string | null;
  source: { kind: string; url: string | null; captured_at: string | null };
  brand: { tokens: Record<string, string>; primary_token: string; accent_token: string };
  scenes: TrackBScene[];
  voice: { plan: TrackBNarrationPlan | null; voice_id: string | null; seed: number | null; stability: number | null; audio_url?: string | null; duration_s?: number | null };
  /** Additive Product Video mode metadata. Existing projects may omit it. */
  generation?: {
    mode: 'mockup_to_motion';
    source_screenshots: string[];
    user_script: string | null;
    voice_track_url: string | null;
  };
  music: { track: string | null; volume: number };
  frozen_audio: { id: string; label?: string }[];
  renders: { render_id: string; project_version: number; output: string; sha256: string; docker: boolean; rendered_at: string }[];
  /** SYSTEM — pipeline checklist: brand kit, style guide, product brief, etc. */
  checklist?: {
    brand_kit?: BrandKit | null;
    style_guide?: string | null;
    narrative_arc?: string | null;
    music_brief?: string | null;
    motion_style?: string | null;
    product_brief?: { product_name?: string; tagline?: string; key_features?: string[]; tone?: string | null } | null;
    [key: string]: unknown;
  } | null;
}

export interface TrackBProjectRow {
  id: number;
  session_id: string;
  title: string;
  track: 'product';
  status: string;
  route: string | null;
  project: TrackBProjectInner;
  version: number;
  schema_version: string;
  last_render_version: number | null;
  preview_video_url: string | null;
  player_src_url: string | null;
  undo_stack: unknown[];
  redo_stack: unknown[];
  activity_log: ActivityEntry[];
  credits_spent: number;
  regen_requests: { request_id: string; scene_id: string; status: string; requested_at: string }[];
  /** User-uploaded screenshots — highest-priority scene image source. */
  user_screenshots?: string[] | null;
  /** 'Generate scene images with AI' toggle (default OFF). */
  ai_image_enabled?: boolean;
  /** PRD 2.2 — style chosen on the brand card: cinematic | social_ad | explainer | documentary. */
  product_video_style?: string | null;
  /** Soft-delete timestamp — deleted projects are hidden from every surface (recoverable server-side). */
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityEntry {
  at: string;
  actor: 'user' | 'agent' | 'system';
  action: string;
  operation?: string;
  scene_id?: string | null;
  intent?: string | null;
  detail?: string;
  version?: number;
  credits?: number;
}

export interface CreditTier { min: number; max: number; default: number; label: string }
export interface TrackBConfig {
  credits: {
    tiers: Record<string, CreditTier>;
    expensive_threshold: number;
    regeneration_budget: { max_attempts_per_scene: number; max_credits_per_scene: number; max_credits_per_project: number; escalation_threshold: number };
  };
  scene_duration_bounds_s: { min: number; max: number };
  operations: Record<string, { scope: 'scene' | 'project'; field: string; tier: string }>;
}

export interface MutationRejection { ok: false; code: string; error: string; explain?: string }

/** Human explanations for why a non-EDITABLE scene's controls are unavailable. */
export const STATE_EXPLAIN: Record<Exclude<SceneState, 'EDITABLE'>, string> = {
  BAKED: 'Baked footage (Track A AI video) — it has no editable text, timing, or colour layers. Only Track B product scenes are editable.',
  REGENERATING: 'This scene is being regenerated. Controls unlock when the new version lands, or the previous version is restored on failure.',
  ERROR: 'The last regeneration failed. The previous valid version is preserved — retry or restore an earlier version.',
  LOCKED: 'This scene was locked by the planner and cannot be edited.',
};

/** Resolve this visitor's space session id (same source the rest of the space uses). */
export function resolveSessionId(): string {
  if (typeof window === 'undefined') return '';
  const w = window as any;
  const direct = w.__workspaceDb?.sessionId || w.__SESSION_ID__ || w.__WORKSPACE_SESSION_ID__;
  if (typeof direct === 'string' && direct) return direct;
  const spaceId = w.__APP_ID__ || w.__SPACE_ID__ || 'workspace-660069';
  try {
    const raw = window.localStorage.getItem(`space_session_${spaceId}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const fromJson = parsed?.sessionId || parsed?.session_id || parsed?.id;
        if (typeof fromJson === 'string' && fromJson) return fromJson;
      } catch {
        return raw;
      }
    }
  } catch {
    /* storage unavailable — fall through */
  }
  return '';
}

export interface ScrapedProductBrief {
  success: boolean;
  error?: string;
  url?: string;
  product_name?: string;
  tagline?: string;
  key_features?: string[];
  pain_points_addressed?: string[];
  target_audience_language?: string;
  social_proof?: string[];
  cta_phrases?: string[];
  tone?: string;
  pricing_hints?: string[];
  unique_differentiators?: string[];
  use_cases?: string[];
  mockup_screenshot_url?: string | null;
  /** Extracted by the discrete brand-extraction step; null when extraction failed. */
  brand_kit?: BrandKit | null;
  brand_evidence?: { palette?: { hex: string; count: number }[]; theme_color?: string | null; font_families?: string[] } | null;
}

function workspaceToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

/** The visitor's workspace token — required by every platform proxy call (e.g. /proxy/anthropic/v1/messages). */
export function getWorkspaceToken(): string {
  return workspaceToken();
}

async function call<T>(body: Record<string, unknown>, endpoint = TRACKB_HOOK_ENDPOINT): Promise<T> {
  const token = workspaceToken();
  const sessionId = resolveSessionId();
  if (!token || !sessionId) throw new Error('Your verified workspace session is still loading. Please wait a moment and try again.');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': token,
      'X-Session-Id': sessionId,
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  // Hook responses are wrapped: the hook's respond() body may sit at the top
  // level or under `response` depending on the execute path.
  const data = (payload && typeof payload === 'object' && ('ok' in payload || 'success' in payload))
    ? payload
    : (payload?.response ?? payload);
  if (!res.ok && (!data || typeof data !== 'object')) {
    throw new Error(`Request failed (HTTP ${res.status}).`);
  }
  return data as T;
}

export const trackB = {
  config: () => call<{ ok: boolean } & TrackBConfig>({ op: 'config' }),
  create: (title: string, sourceUrl?: string, opts?: {
    aiImageEnabled?: boolean;
    userScreenshots?: string[];
    userScript?: string | null;
    voiceTrackUrl?: string | null;
    voiceTranscript?: string | null;
    voiceWords?: NarrationWordTiming[];
    voiceDuration?: number | null;
  }) =>
    call<{ ok: boolean; project: TrackBProjectRow } | MutationRejection>({
      op: 'create', session_id: resolveSessionId(), title, source_url: sourceUrl || null,
      ai_image_enabled: opts?.aiImageEnabled === true,
      user_screenshots: opts?.userScreenshots ?? [],
      sourceScreenshots: opts?.userScreenshots ?? [],
      userScript: opts?.userScript?.trim() || null,
      voiceTrackUrl: opts?.voiceTrackUrl || null,
      voiceTranscript: opts?.voiceTranscript?.trim() || null,
      voiceWords: opts?.voiceWords ?? [],
      voiceDuration: opts?.voiceDuration ?? null,
      generationMode: 'mockup_to_motion',
    }),
  scrapeWebsite: (sourceUrl: string) =>
    call<ScrapedProductBrief>({ website_url: sourceUrl }, SCRAPE_WEBSITE_HOOK_ENDPOINT),
  /** Upload a voice track through the workspace-scoped public file-storage route. */
  uploadVoiceTrack: async (file: File): Promise<{ success: boolean; url?: string; error?: string }> => {
    try {
      const token = workspaceToken();
      if (!token) return { success: false, error: 'Your workspace session is still loading — try again in a moment.' };
      const form = new FormData();
      form.append('file', file, file.name || 'voice-track.webm');
      form.append('workspaceId', AUDOS_WORKSPACE_UUID);
      form.append('folder', 'product-video-voice');
      const res = await fetch('/api/upload/file', {
        method: 'POST',
        headers: { 'X-Workspace-DB-Token': token },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.url) return { success: true, url: String(data.url) };
      return { success: false, error: (data?.error as string) || `Voice upload failed (HTTP ${res.status}).` };
    } catch {
      return { success: false, error: 'Voice upload failed — please try again.' };
    }
  },
  /** Timestamped transcription anchors visual cut points to the narration rhythm. */
  transcribeVoiceTrack: async (file: File): Promise<{ success: boolean; transcript?: string; words?: NarrationWordTiming[]; duration?: number; error?: string }> => {
    try {
      const token = workspaceToken();
      if (!token) return { success: false, error: 'Your workspace session is still loading — try again in a moment.' };
      const form = new FormData();
      form.append('audio', file, file.name || 'voice-track.webm');
      const res = await fetch(`/api/workspaces/${AUDOS_WORKSPACE_UUID}/audio/transcribe-timestamped`, {
        method: 'POST',
        headers: { 'X-Workspace-DB-Token': token },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.transcript) {
        return {
          success: true,
          transcript: String(data.transcript),
          words: Array.isArray(data.words) ? data.words : [],
          duration: Number(data.duration) || 0,
        };
      }
      return { success: false, error: (data?.error as string) || `Transcription failed (HTTP ${res.status}).` };
    } catch {
      return { success: false, error: 'Transcription failed — please try a different audio file.' };
    }
  },
  /** Image-source preferences: the AI toggle (default OFF) and uploaded screenshots. Free — no credits. */
  setImagePrefs: (id: number, prefs: { aiImageEnabled?: boolean; userScreenshots?: string[] }) =>
    call<{ ok: boolean; applied: boolean; project?: TrackBProjectRow } | MutationRejection>({
      op: 'set_image_prefs', session_id: resolveSessionId(), id,
      ...(prefs.aiImageEnabled !== undefined ? { ai_image_enabled: prefs.aiImageEnabled } : {}),
      ...(prefs.userScreenshots !== undefined ? { user_screenshots: prefs.userScreenshots } : {}),
    }),
  /** Upload one screenshot via the platform file-storage integration; returns its public URL. */
  uploadScreenshot: async (file: File): Promise<{ success: boolean; url?: string; error?: string }> => {
    try {
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Id': String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || '') },
        body: JSON.stringify({ imageData, fileName: file.name }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.imageUrl) return { success: true, url: data.imageUrl as string };
      return { success: false, error: (data?.error as string) || `Upload failed (HTTP ${res.status}).` };
    } catch {
      return { success: false, error: 'Upload failed — please try again.' };
    }
  },
  generate: (id: number, sourceCapture: ScrapedProductBrief, productVideoStyle?: string) =>
    call<{ ok: boolean; project: TrackBProjectRow; message?: string } | MutationRejection>({
      op: 'plan_render', session_id: resolveSessionId(), id, source_capture: sourceCapture,
      product_video_style: productVideoStyle || 'social_ad',
    }),
  list: () => call<{ ok: boolean; projects: Partial<TrackBProjectRow>[] }>({ op: 'list', session_id: resolveSessionId() }),
  get: (id: number) =>
    call<{ ok: boolean; project: TrackBProjectRow; versions: { id: number; version: number; scene_id: string | null; reason: string; created_at: string }[]; credit_events: unknown[] } | MutationRejection>({ op: 'get', session_id: resolveSessionId(), id }),
  quote: (operation: string) =>
    call<{ ok: boolean; cost: number; label: string; requires_confirmation: boolean } | MutationRejection>({ op: 'quote', operation }),
  mutate: (id: number, operation: string, value: unknown, sceneId?: string, baseVersion?: number, opts?: { actor?: 'user' | 'agent'; intent?: string }) =>
    call<{ ok: boolean; applied: boolean; project?: TrackBProjectRow; cost?: number; version?: number; code?: string; message?: string } | MutationRejection>({
      op: 'mutate', session_id: resolveSessionId(), id, operation, value, scene_id: sceneId, base_version: baseVersion,
      actor: opts?.actor ?? 'user', intent: opts?.intent,
    }),
  /** Reorder the film's scenes (the array order IS the play order). A restorable snapshot is kept server-side. */
  reorderScenes: (id: number, sceneIds: string[], opts?: { actor?: 'user' | 'agent'; intent?: string }) =>
    call<{ ok: boolean; applied: boolean; project?: TrackBProjectRow; cost?: number } | MutationRejection>({
      op: 'reorder_scenes', session_id: resolveSessionId(), id, scene_ids: sceneIds, actor: opts?.actor ?? 'user', intent: opts?.intent,
    }),
  /** Soft-delete a project (hidden everywhere, recoverable server-side via restore_project). */
  deleteProject: (id: number) =>
    call<{ ok: boolean; applied: boolean; deleted_at?: string } | MutationRejection>({ op: 'delete_project', session_id: resolveSessionId(), id }),
  undo: (id: number) => call<{ ok: boolean; applied: boolean; project?: TrackBProjectRow }>({ op: 'undo', session_id: resolveSessionId(), id }),
  redo: (id: number) => call<{ ok: boolean; applied: boolean; project?: TrackBProjectRow }>({ op: 'redo', session_id: resolveSessionId(), id }),
  regenerateScene: (id: number, sceneId: string, confirm: boolean, note?: string) =>
    call<{ ok: boolean; applied: boolean; requires_confirmation?: boolean; cost?: number; message?: string; project?: TrackBProjectRow; request_id?: string } | MutationRejection>({
      op: 'regenerate_scene', session_id: resolveSessionId(), id, scene_id: sceneId, confirm, note,
    }),
  /** Start the film render for a fully-planned project (the trackb-render hook). */
  renderFilm: (id: number) =>
    call<{ ok: boolean; applied?: boolean; job_id?: string; project?: TrackBProjectRow; message?: string } | MutationRejection>({ op: 'start', session_id: resolveSessionId(), id }, TRACKB_RENDER_ENDPOINT),
  /** Poll + sync the in-flight render; sets preview_video_url on the row when it completes. `progress` is the provider-reported render % the watcher persists on the job row (null before the first sweep). */
  renderStatus: (id: number) =>
    call<{ ok: boolean; rendering: boolean; completed?: boolean; failed?: boolean; error?: string; progress?: number | null; progress_at?: string | null; job_status?: string; preview_video_url?: string | null; project?: TrackBProjectRow } | MutationRejection>({ op: 'status', session_id: resolveSessionId(), id }, TRACKB_RENDER_ENDPOINT),
  restoreVersion: (id: number, versionId: number) =>
    call<{ ok: boolean; applied: boolean; project?: TrackBProjectRow } | MutationRejection>({ op: 'restore_version', session_id: resolveSessionId(), id, version_id: versionId }),
  /** Quick cut: remove one scene from the film (a restorable snapshot is kept server-side). */
  cutScene: (id: number, sceneId: string, confirm: boolean) =>
    call<{ ok: boolean; applied: boolean; requires_confirmation?: boolean; message?: string; project?: TrackBProjectRow; cost?: number } | MutationRejection>({ op: 'cut_scene', session_id: resolveSessionId(), id, scene_id: sceneId, confirm }),
  /** Add a custom or generated music track to THIS project's approved catalog. */
  addMusicTrack: (id: number, track: { id?: string; label: string; url: string; script_matched?: boolean }) =>
    call<{ ok: boolean; applied: boolean; track_id?: string; project?: TrackBProjectRow } | MutationRejection>({ op: 'add_music_track', session_id: resolveSessionId(), id, track }),
  /**
   * Compose a bespoke ElevenLabs score in the browser (uses the visitor's own
   * workspace token — required by the platform's audio endpoints) and return
   * its durable URL. Pair with addMusicTrack + set_music_track to use it.
   */
  composeCustomScore: async (prompt: string, lengthMs: number): Promise<{ success: boolean; audioUrl?: string; error?: string }> => {
    try {
      const token = workspaceToken();
      if (!token) return { success: false, error: 'Your workspace session is still loading — try again in a moment.' };
      const res = await fetch(`/api/workspaces/${AUDOS_WORKSPACE_UUID}/audio/music/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
        body: JSON.stringify({ prompt, lengthMs, instrumental: true }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.audioUrl) return { success: true, audioUrl: data.audioUrl as string };
      return { success: false, error: (data?.error as string) || `Music generation failed (HTTP ${res.status}).` };
    } catch {
      return { success: false, error: 'Music generation failed — please try again.' };
    }
  },
};
