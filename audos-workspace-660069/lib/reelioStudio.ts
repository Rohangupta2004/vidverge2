/**
 * VidVerge Studio — shared client helpers around the core
 * "brief → script → video" flow: script editing, autonomous character
 * creation, and automatic URL mockups. Character consistency comes from the
 * render pipeline's reusable generated anchor, not a user-selected image.
 *
 * Everything here is browser-side and talks to the SAME platform endpoints the
 * rest of VidVerge already uses:
 *   - POST /api/upload/file                              (durable image upload)
 *   - POST /api/generate/image                           (AI image generation)
 *   - POST /api/analyze-document                         (GPT-4 vision describe)
 *   - POST /api/hooks/execute/<space>/generate-video     (kick off a render)
 *   - window.__workspaceDb                               (WorkspaceDB read/write)
 *
 * Mockup selection state and the composer's generation options are broadcast
 * with a window CustomEvent so every active surface stays in sync. Character
 * images are single optional uploads for the current visit; the MOCKUP pick and
 * the options are also per visit, because a remembered mockup used to end
 * up in videos nobody asked for (see SELECTED_MOCKUP_KEY below).
 */
import { DEFAULT_VIDEO_MODEL, getVideoModel } from '../apps/Create/videoTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Character {
  id: number;
  name: string;
  image_url?: string | null;
  description?: string | null;
  /** Visual style for videos featuring this character, e.g. '3D animated', 'cartoon', 'realistic'. */
  style?: string | null;
  /** Default scene environment/setting, e.g. 'basketball court', 'studio', 'outdoor park'. */
  environment?: string | null;
  session_id?: string | null;
  created_at?: string;
}

/**
 * Structured character payload forwarded to the generate-video hook as
 * `character_data`. The (patched) hook builds a CHARACTER_BLOCK from it that
 * is prepended to every scene prompt; until the hook patch lands it ignores
 * unknown body fields, so sending it is safe and additive.
 */
export interface CharacterData {
  name: string;
  description: string;
  image_url?: string;
  environment?: string;
  style?: string;
}

export interface Mockup {
  id: number;
  name: string;
  screen?: string | null;
  platform?: string | null;
  image_url?: string | null;
  prompt?: string | null;
  session_id?: string | null;
  created_at?: string;
}

export interface ScriptScene {
  scene_description: string;
  dialogue: string;
  /** Optional mockup woven into this scene (the device the character holds). */
  mockupId?: number | null;
}

/**
 * An image the visitor uploaded in chat (a product screenshot, a UI mockup, a
 * slide) that the render should treat as a VISUAL REFERENCE for one scene.
 * The image is interpreted by Omni Flash, never reconstructed as UI. Captured from the chat
 * composer's attachments; see the "Screenshots & mockups" section of
 * agent/customer-prompt.md for how Reel talks about it.
 */
export interface SceneReference {
  url: string;
  name?: string;
}

export interface SubmitVideoInput {
  scenes: ScriptScene[];
  characterDescription?: string;
  characterImageUrl?: string;
  mockupImageUrl?: string;
  tone?: string;
  aspectRatio?: '16:9' | '9:16';
  title?: string;
  durationSeconds?: number;
  websiteUrl?: string;
  websitePlacement?: 'start' | 'end';
  /** Uploaded product, UI, brand, and inspiration references, in priority order. */
  referenceImageUrls?: string[];
  /** Uploaded screenshot/mockup used as a scene's visual reference frame. */
  referenceImageUrl?: string;
  /** 1-based index of the scene the reference image belongs to (default 1). */
  referenceImageScene?: number;
  /** Structured character payload (generic character-consistency system). */
  characterData?: CharacterData;
  /** One voiceover/dialogue line per scene, appended to that scene's prompt. */
  dialogues?: string[];
  /** A VIDEO_MODELS picker id. Defaults to the options bar's current pick. */
  model?: string;
}

// ---------------------------------------------------------------------------
// Events + storage keys — every surface listens to SELECTION_CHANGED so the
// "Using: <character>" chips stay in sync, and to the OPEN_* events so the chat
// toolbar can raise the shell-mounted studio panels.
// ---------------------------------------------------------------------------
export const STUDIO_EVENTS = {
  openCharacters: 'vidverge:open-characters',
  openMockups: 'vidverge:open-mockups',
  openScriptStudio: 'vidverge:open-script-studio',
  /** Raise the Create app's Long Series builder (N episodes, 4 clips each). */
  openEpisodeSeries: 'vidverge:open-episode-series',
  selectionChanged: 'vidverge:selection-changed',
  videoSubmitted: 'vidverge:video-submitted',
  dataChanged: 'vidverge:studio-data-changed',
  optionsChanged: 'vidverge:generation-options-changed',
} as const;

const SELECTED_CHARACTER_KEY = 'reelio.selectedCharacterId';
/**
 * SESSION-SCOPED ON PURPOSE: a chosen mockup used to live in localStorage, so
 * one tap on "Use this" (or simply generating one, which auto-selected it)
 * attached that phone screen to every video the visitor made from then on — the
 * mockup nobody asked for, turning up in the opening shot. Keeping the pick to
 * the visit it was made in is half the fix; getEffectiveMockupId() is the other
 * half, and only honours it while the mockup option is switched on.
 */
const SELECTED_MOCKUP_KEY = 'reelio.selectedMockupId';
const SCENE_REFERENCE_KEY = 'reelio.sceneReference';
const DEFAULT_CHARACTER_KEY = 'reelio.defaultCharacterId';
const GENERATION_OPTIONS_KEY = 'reelio.generationOptions';

/** Keys whose value describes THIS video rather than a standing preference. */
const PER_VISIT_KEYS: string[] = [SELECTED_MOCKUP_KEY, GENERATION_OPTIONS_KEY];

function storeFor(key: string): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return PER_VISIT_KEYS.indexOf(key) === -1 ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Runtime identity helpers
// ---------------------------------------------------------------------------
export function spaceId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  const w = window as any;
  return w.__SPACE_ID__ || w.__APP_ID__ || w.__SPACE_CONFIG__?.id || 'workspace-660069';
}

export function scopedSpaceId(): string {
  const id = spaceId();
  return id.startsWith('workspace-') ? id : `workspace-${id}`;
}

export function workspaceUuid(): string | null {
  if (typeof window === 'undefined') return null;
  return (window as any).__WORKSPACE_ID__ || null;
}

export function studioSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  const injected = (window as any).__spaceSessionId;
  if (typeof injected === 'string' && injected) return injected;
  const db = (window as any).__workspaceDb;
  if (db && typeof db.sessionId === 'string' && db.sessionId) return db.sessionId;
  return null;
}

// ---------------------------------------------------------------------------
// Selection store
// ---------------------------------------------------------------------------
function readNumber(key: string): number | null {
  const store = storeFor(key);
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function getSelectedCharacterId(): number | null {
  return readNumber(SELECTED_CHARACTER_KEY);
}

export function getSelectedMockupId(): number | null {
  return readNumber(SELECTED_MOCKUP_KEY);
}

function writeSelection(key: string, id: number | null): void {
  if (typeof window === 'undefined') return;
  const store = storeFor(key);
  try {
    if (!store) throw new Error('storage unavailable');
    if (id == null) store.removeItem(key);
    else store.setItem(key, String(id));
  } catch {
    /* storage disabled — selection is best-effort */
  }
  window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.selectionChanged));
}

export function setSelectedCharacterId(id: number | null): void {
  writeSelection(SELECTED_CHARACTER_KEY, id);
}

export function setSelectedMockupId(id: number | null): void {
  writeSelection(SELECTED_MOCKUP_KEY, id);
}

/** The character pre-selected whenever a video's character picker opens. */
export function getDefaultCharacterId(): number | null {
  return readNumber(DEFAULT_CHARACTER_KEY);
}

export function setDefaultCharacterId(id: number | null): void {
  writeSelection(DEFAULT_CHARACTER_KEY, id);
}

/** The screenshot most recently attached in chat, if the visitor kept it. */
export function getSceneReference(): SceneReference | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SCENE_REFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.url === 'string' ? (parsed as SceneReference) : null;
  } catch {
    return null;
  }
}

export function setSceneReference(ref: SceneReference | null): void {
  if (typeof window === 'undefined') return;
  const current = getSceneReference();
  if (current?.url === ref?.url) return;
  try {
    if (!ref) window.localStorage.removeItem(SCENE_REFERENCE_KEY);
    else window.localStorage.setItem(SCENE_REFERENCE_KEY, JSON.stringify(ref));
  } catch {
    /* storage disabled — the reference is best-effort */
  }
  window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.selectionChanged));
}

// ---------------------------------------------------------------------------
// Generation options — what the composer's options bar sets
// ---------------------------------------------------------------------------
/**
 * The choices a visitor makes BEFORE (or while) typing their prompt: which
 * model renders it, whether a URL is read for context, whether one optional
 * character image was uploaded, whether the video speaks, and whether it carries an
 * app-screen mockup.
 *
 * components/GenerationOptionsBar owns the UI; the answers live here so every
 * surface reads the same ones, and generationOptionsContext() turns them into
 * the block appended to the visitor's message — which is how Reel knows them
 * without asking about any of it in conversation.
 *
 * THE MOCKUP IS OPT-IN. `mockupEnabled` false (the default, and the value on
 * every fresh visit) means NO phone / app-screen beat anywhere in the render:
 * the prompt says so, and every submit path sends phone_shot: false.
 */
export interface GenerationOptions {
  /** A VIDEO_MODELS picker id (see apps/Create/videoTypes). */
  model: string;
  /** Read a page the visitor names and build the brief from it. */
  websiteEnabled: boolean;
  websiteUrl: string;
  /** Whether the visitor supplied one optional character image. */
  characterEnabled: boolean;
  characterId: number | null;
  characterName: string;
  /** The one optional uploaded image passed as character_image_url. */
  characterImageUrl: string;
  characterDescription: string;
  /** Spoken dialogue / voiceover in the finished video. */
  dialogueEnabled: boolean;
  /** Show an app-screen mockup on a phone in ONE shot. Off unless asked for. */
  mockupEnabled: boolean;
  mockupId: number | null;
  mockupName: string;
  mockupImageUrl: string;
}

export const DEFAULT_GENERATION_OPTIONS: GenerationOptions = {
  model: DEFAULT_VIDEO_MODEL,
  websiteEnabled: false,
  websiteUrl: '',
  characterEnabled: false,
  characterId: null,
  characterName: '',
  characterImageUrl: '',
  characterDescription: '',
  dialogueEnabled: true,
  mockupEnabled: false,
  mockupId: null,
  mockupName: '',
  mockupImageUrl: '',
};

export function getGenerationOptions(): GenerationOptions {
  const store = storeFor(GENERATION_OPTIONS_KEY);
  if (!store) return DEFAULT_GENERATION_OPTIONS;
  try {
    const raw = store.getItem(GENERATION_OPTIONS_KEY);
    if (!raw) return DEFAULT_GENERATION_OPTIONS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_GENERATION_OPTIONS;
    return { ...DEFAULT_GENERATION_OPTIONS, ...parsed };
  } catch {
    return DEFAULT_GENERATION_OPTIONS;
  }
}

/**
 * Patch the options and tell every surface. Switching an option OFF clears what
 * it carried — a mockup, a character, a URL — so nothing downstream can find a
 * value belonging to a switch the visitor has since turned off.
 */
export function setGenerationOptions(patch: Partial<GenerationOptions>): GenerationOptions {
  const next: GenerationOptions = { ...getGenerationOptions(), ...patch };
  if (!next.mockupEnabled) {
    next.mockupId = null;
    next.mockupName = '';
    next.mockupImageUrl = '';
    if (getSelectedMockupId() != null) setSelectedMockupId(null);
  }
  if (!next.characterEnabled) {
    next.characterId = null;
    next.characterName = '';
    next.characterImageUrl = '';
    next.characterDescription = '';
  }
  if (!next.websiteEnabled) next.websiteUrl = '';
  const store = storeFor(GENERATION_OPTIONS_KEY);
  try {
    if (store) store.setItem(GENERATION_OPTIONS_KEY, JSON.stringify(next));
  } catch {
    /* storage disabled — the options still work, they just forget on reload */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.optionsChanged, { detail: next }));
    window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.selectionChanged));
    // A model pick has to survive the trip to a render this browser never
    // starts itself - see syncVideoModelPreference.
    if (patch.model !== undefined) void syncVideoModelPreference(next.model);
  }
  return next;
}

/**
 * The mockup a render may ACTUALLY use: the visitor's explicit pick, and only
 * while the mockup option is on. Every surface that attaches a mockup to a
 * video goes through this rather than reading the raw selection — that is what
 * makes the app-screen beat opt-in instead of sticky.
 */
export function getEffectiveMockupId(): number | null {
  const options = getGenerationOptions();
  if (!options.mockupEnabled) return null;
  return options.mockupId != null ? options.mockupId : getSelectedMockupId();
}

// ---------------------------------------------------------------------------
// The model pick, mirrored where a server-started render can read it
// ---------------------------------------------------------------------------
/**
 * WHY THE PICKER USED NOT TO CARRY THROUGH CHAT.
 *
 * Every render the Create app submits puts the chosen model in its own request
 * body, so the picker is honoured there by construction. A render Reel starts
 * in conversation does not go that way: the agent's produce_video tool runs
 * platform-side, and the model the visitor picked lives only in this browser.
 * Chat renders therefore came out on the pipeline's default whatever the
 * options bar said, and Reel had to warn people about it before generating.
 *
 * So the pick is mirrored into WorkspaceDB - one row per visitor session,
 * updated in place - and the generate-video hook reads it whenever the caller
 * passes no explicit model. An explicit model on the call still wins, so the
 * app's own submits behave exactly as before and the two paths cannot drift.
 *
 * Entirely best-effort: if the write fails the hook simply falls back to its
 * own default, so a send is never blocked or delayed waiting for it.
 */
const MODEL_PREF_TABLE = 'video_model_prefs';

/** The row this browser owns, so a change updates instead of piling up rows. */
let modelPrefRowId: number | null = null;
let lastMirroredModel = '';

export async function syncVideoModelPreference(modelId?: string): Promise<void> {
  const picked = getVideoModel(modelId || getGenerationOptions().model);
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  if (lastMirroredModel === picked.id && modelPrefRowId != null) return;
  const row = {
    model_id: picked.id,
    provider_model: picked.model,
    engine: picked.engine,
    surface: 'chat-options-bar',
  };
  try {
    // Same session guard every other private write uses: the row is worthless
    // if it lands before the platform has accepted the visitor's session,
    // because the hook finds it by exactly that id.
    await waitForDbSession();
    if (modelPrefRowId == null) {
      // A default read is already scoped to this visitor, so the newest row
      // here is this browser's own from an earlier visit.
      const existing = await client.from(MODEL_PREF_TABLE).orderBy('updated_at', 'desc').limit(1).get();
      const found = Array.isArray(existing?.data) ? existing.data[0] : null;
      if (found && typeof found.id === 'number') modelPrefRowId = found.id;
    }
    if (modelPrefRowId != null) {
      try {
        await client.from(MODEL_PREF_TABLE).update(modelPrefRowId, row);
      } catch {
        // The remembered row belongs to a session this visitor no longer has
        // (ids rotate), so it is not ours to edit any more. Start a fresh one
        // rather than leaving the hook reading a row nobody updates.
        modelPrefRowId = null;
      }
    }
    if (modelPrefRowId == null) {
      const res = await client.from(MODEL_PREF_TABLE).insert(row);
      const data = (res && (res.data || res)) as any;
      const inserted = Array.isArray(data) ? data[0] : data;
      if (inserted && typeof inserted.id === 'number') modelPrefRowId = inserted.id;
    }
    lastMirroredModel = picked.id;
  } catch (e) {
    console.warn('[ReelioStudio] could not mirror the picked model:', e);
  }
}

/**
 * The marker the options block starts with. The chat strips everything from it
 * onwards before showing a visitor their own message, so the block is context
 * for Reel and never wording the visitor has to read back.
 */
export const GENERATION_OPTIONS_MARKER = '[VIDEO OPTIONS';

/** The options as instructions for Reel, appended to the visitor's message. */
export function generationOptionsContext(
  options: GenerationOptions = getGenerationOptions(),
): string {
  const model = getVideoModel(options.model);
  const url = (options.websiteUrl || '').trim();
  const soundNote = model.sound
    ? 'it generates its own sound (dialogue spoken on camera, plus music and ambience). Its clips are ~8s each, so match the scene count to the length they ask for: ~30s = 4 scenes, ~60s = 8.'
    : 'it renders silent clips. Its clips are ~8s each, so match the scene count to the length they ask for: ~30s = 4 scenes, ~60s = 8.';
  const lines = [
    `- Model: ${model.label} — provider id "${model.model}", ${soundNote} THIS IS THE MODEL THAT RENDERS. Pass it as the model parameter when produce_video lists it; when it does not, the render pipeline reads this same pick server-side and generates on it anyway. So never warn them that a render you start here comes out on something else, and never ask which model they want — the picker above the composer already answered that.`,
    options.websiteEnabled
      ? url
        ? `- Website context: ON — ${url}. Read that page for the brief and pass it as website_url. The pipeline silently captures a mobile screenshot after extraction; if capture fails, it removes device scenes and continues without a mockup.`
        : '- Website context: ON, but no URL yet — ask for the link once, then use it as website_url. The pipeline handles the mobile screenshot automatically.'
      : '- Website context: OFF — do not ask for a website URL and do not add a device or app-screen shot.',
    '- Character: AUTO — infer the recurring character from the confirmed brief and pass only character_description. Never ask for, select, or pass a custom character image; the pipeline generates the seed image at job start.',
    options.dialogueEnabled
      ? '- Dialogue: ON — every scene gets a short spoken line.'
      : '- Dialogue: OFF — no spoken dialogue or voiceover. Write visual-only scenes and leave every dialogue line empty.',
  ];
  return (
    `${GENERATION_OPTIONS_MARKER} — set by the user in the options bar next to the composer. ` +
    'Model and optional website context are already answered. Character and mobile mockup handling are autonomous.]\n' +
    lines.join('\n')
  );
}

/** Everything from the options block onwards, removed for display. */
export function stripGenerationOptionsContext(text: string): string {
  const idx = text.indexOf(GENERATION_OPTIONS_MARKER);
  return idx === -1 ? text : text.slice(0, idx).trimEnd();
}

/** A visitor's message with the current options attached for Reel to read. */
export function withGenerationOptions(message: string): string {
  const text = (message || '').trim();
  const options = getGenerationOptions();
  // Mirror the pick BEFORE the turn starts: the produce_video call it leads to
  // happens seconds later, server-side, and reads the row this write leaves.
  void syncVideoModelPreference(options.model);
  const block = generationOptionsContext(options);
  return text ? `${text}\n\n${block}` : block;
}

// ---------------------------------------------------------------------------
// WorkspaceDB helpers (write path — reads mostly go through useWorkspaceDB)
// ---------------------------------------------------------------------------
function db(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

/**
 * The session id the injected WorkspaceDB SDK will actually send as its
 * X-Session-Id header on the next request. The SDK adopts a session ONLY from
 * the platform's tab-scoped, server-verified marker
 * (window.__audosAcceptedSessionId) or a verified `audos:session-established`
 * event — NOT from window.__spaceSessionId or localStorage, which may hold a
 * stale or unverified id. That verification is asynchronous, so early in the
 * page's life this is null even for a signed-in visitor.
 */
export function dbSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  const client = w.__workspaceDb;
  if (client && typeof client.sessionId === 'string' && client.sessionId) return client.sessionId;
  const accepted = w.__audosAcceptedSessionId;
  if (typeof accepted === 'string' && (accepted.indexOf('wses_') === 0 || accepted.indexOf('guest_') === 0)) {
    return accepted;
  }
  return null;
}

/**
 * SESSION GUARD FOR PRIVATE WRITES — wait for the verified session before the
 * first WorkspaceDB write.
 *
 * The guarded tables (`video_projects`, `video_series`, and any table whose
 * write policy verifies the owner) refuse a write whose request carries no
 * verified X-Session-Id header: "A verified session ID is required for private
 * writes". The SDK always sends the X-Workspace-DB-Token header, but it only
 * sends X-Session-Id once the platform's asynchronous session check has
 * accepted the visitor's session — so a write fired during that window fails
 * even though the visitor IS signed in. Awaiting this before every write
 * closes that race.
 *
 * Resolves with the session id as soon as one is accepted (usually instantly
 * for a warm session), or with null after `timeoutMs` — callers then proceed
 * exactly as before, and a genuinely session-less visitor still gets the
 * plain-language writeFailureNotice explanation instead of a hang.
 */
export async function waitForDbSession(timeoutMs = 8000): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const existing = dbSessionId();
  if (existing) return existing;
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('audos:session-established', onEstablished);
      window.clearInterval(poll);
      window.clearTimeout(timer);
      resolve(value);
    };
    const check = () => {
      const sid = dbSessionId();
      if (sid) finish(sid);
    };
    // The SDK adopts the session in its own listener for this same event, so
    // re-check on the next tick — after the SDK has had its turn.
    const onEstablished = () => window.setTimeout(check, 0);
    window.addEventListener('audos:session-established', onEstablished);
    const poll = window.setInterval(check, 250);
    const timer = window.setTimeout(() => finish(dbSessionId()), timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// WHO OWNS A ROW (the My Videos fix, Aug 16 2026)
// ---------------------------------------------------------------------------
/**
 * THE BUG: My Videos filtered on `session_id === studioSessionId()` and nothing
 * else, which lost the founder's library twice over.
 *
 *  1. TIMING. studioSessionId() is null until the platform's asynchronous
 *     session check has accepted the visitor, and the library called it the
 *     moment it mounted — so a strict `sid ? filter : []` answered "you have no
 *     videos" to someone with a hundred, purely because the page was two
 *     seconds old. resolveOwnedSessions() awaits the verified session first.
 *
 *  2. A SESSION IS NOT A PERSON. A new session id is issued far more often than
 *     a visitor changes: 14 distinct ids had generated videos in this workspace
 *     by August, so all but the newest were invisible to the person who made
 *     them. This browser now remembers every session id it has been given, and
 *     a row belonging to ANY of them is theirs.
 *
 * Still deliberately strict for a stranger: a row owned by a session this
 * browser has never held is never shown. The one exception is the founder's own
 * view of their space (__SPACE_MODE__ 'entrepreneur'), where the library is the
 * workspace's, not a visitor's.
 */
const OWNED_SESSIONS_KEY = 'vidverge.ownedSessions';
const OWNED_SESSIONS_MAX = 60;

/** 'customer' on the published space, 'entrepreneur' in the founder's view. */
export function spaceMode(): string {
  if (typeof window === 'undefined') return 'customer';
  return String((window as any).__SPACE_MODE__ || 'customer');
}

/** True when the person looking is the founder, viewing their own workspace. */
export function isFounderView(): boolean {
  return spaceMode() === 'entrepreneur';
}

/** Every session id this browser has ever been given, newest first. */
export function ownedSessionIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OWNED_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string' && s) : [];
  } catch {
    return [];
  }
}

/** Record a session id as this browser's own. Idempotent, newest first. */
export function rememberOwnedSession(sessionId: string | null | undefined): void {
  if (typeof window === 'undefined' || !sessionId) return;
  try {
    const next = [sessionId, ...ownedSessionIds().filter((s) => s !== sessionId)].slice(
      0,
      OWNED_SESSIONS_MAX,
    );
    window.localStorage.setItem(OWNED_SESSIONS_KEY, JSON.stringify(next));
  } catch {
    /* storage disabled — the current session still works, history does not */
  }
}

/**
 * The set of session ids whose rows belong to the person looking at the screen.
 * Awaits the verified session first, so nothing is filtered against a null id,
 * and records it on the way past so the NEXT visit still recognises today's
 * work as theirs.
 */
export async function resolveOwnedSessions(): Promise<Set<string>> {
  const verified = (await waitForDbSession()) || studioSessionId();
  rememberOwnedSession(verified);
  const ids = ownedSessionIds();
  if (verified) ids.push(verified);
  return new Set(ids);
}

/** Does this row belong to the person looking? */
export function rowIsOwnedBy(row: any, owned: Set<string>): boolean {
  // The founder's own view of their workspace is the whole workspace.
  if (isFounderView()) return true;
  const sid = row && row.session_id;
  if (!sid || typeof sid !== 'string') return false;
  return owned.has(sid);
}

export async function listRows<T = any>(table: string): Promise<T[]> {
  try {
    // The SDK and verified session arrive asynchronously. Waiting here avoids
    // the first-mount race where Characters briefly saw no client/session and
    // permanently rendered an empty saved list until the app was reopened.
    const owned = await resolveOwnedSessions();
    const client = db();
    if (!client || typeof client.from !== 'function') return [];
    const rows: any[] = [];
    const pageSize = 100;
    let offset = 0;
    while (true) {
      const res = await client
        .from(table, { shared: true })
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset(offset)
        .get();
      const page = Array.isArray(res?.data) ? res.data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    // Shared scope restores this browser's rows from earlier verified sessions;
    // the ownership filter still excludes every other visitor and all unowned
    // rows (except in the founder view, where rowIsOwnedBy deliberately allows all).
    return rows.filter((r: any) => rowIsOwnedBy(r, owned));
  } catch (e) {
    console.warn('[ReelioStudio] listRows failed:', e);
    return [];
  }
}

export async function insertRow(table: string, row: Record<string, unknown>): Promise<any | null> {
  const client = db();
  if (!client || typeof client.from !== 'function') {
    throw new Error('WorkspaceDB is not available in this context.');
  }
  // Session guard: never race the platform's session verification — see
  // waitForDbSession. Without this, an early insert is refused with
  // "A verified session ID is required for private writes".
  await waitForDbSession();
  const res = await client.from(table).insert(row);
  window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.dataChanged, { detail: { table } }));
  const data = (res && (res.data || res)) as any;
  return Array.isArray(data) ? data[0] : data;
}

export async function deleteRow(table: string, id: number): Promise<void> {
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  // Deletes are owner-checked like inserts — same session guard applies.
  await waitForDbSession();
  try {
    await client.from(table).delete(id);
    window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.dataChanged, { detail: { table } }));
  } catch (e) {
    console.warn('[ReelioStudio] deleteRow failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Platform media helpers
// ---------------------------------------------------------------------------

/** Upload an image file to durable GCS storage; returns the public URL. */
export async function uploadImage(file: File, folder = 'characters'): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name || 'upload.png');
  const uuid = workspaceUuid();
  if (uuid) form.append('workspaceId', uuid);
  form.append('folder', folder);
  const res = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || typeof data.url !== 'string') {
    throw new Error(data?.error || `Upload failed (HTTP ${res.status}).`);
  }
  return data.url;
}

/**
 * SAFETY NEGATIVE PROMPT — SENSUAL / ADULT CONTENT ONLY.
 *
 * THE POLICY (Aug 15 2026): the only thing VidVerge steers a generation away
 * from is sexual or sensual material. Everything else goes through exactly as
 * the customer wrote it — sport, physical contact, stunts, action, violence in
 * a sports or gaming context, any other subject at all. Nothing is ever
 * matched against their words either: there is no keyword list anywhere in
 * this app, so a football brief full of "tackle", "hit" and "attack" is not a
 * special case, it is simply an ordinary brief.
 *
 * Why it changed: this list used to carry "gore, violence" alongside
 * photorealism and likeness terms, and generateImage() pushes it into the
 * prompt itself as an "Avoid: …" clause. Ordinary briefs paid for that — a
 * football video reads very differently to an upstream filter once our own
 * words for gore and violence are sitting in the same prompt — and negating
 * photorealistic skin and faces fought the look most customers are asking for.
 * The likeness terms still exist, but they now travel ONLY with a character
 * portrait (LIKENESS_NEGATIVE_PROMPT below), which is the one place Google's
 * likeness check actually rejects work.
 *
 * Two delivery channels, because the two endpoints differ:
 *   - VIDEO: sent to the generate-video hook as `negative_prompt` AND
 *     `negativePrompt` (both spellings) by every submit path — the value is
 *     FULL_NEGATIVE_PROMPT (safety + quality + phone terms below), or
 *     PHONE_OK_NEGATIVE_PROMPT when the render deliberately shows a held
 *     phone. The hook forwards it as Omni Flash's native `negativePrompt`.
 *     It is deliberately NOT pasted into scene prompts: the per-scene budget
 *     is tight and negative wording belongs in the parameter, not the prompt.
 *   - IMAGE: /api/generate/image has no negative-prompt parameter, so
 *     generateImage() appends the negative list as an in-prompt "Avoid:"
 *     clause — live immediately for portraits and storyboard stills, which
 *     are the anchor images whose safety rejections fail whole renders.
 */
export const SAFETY_NEGATIVE_PROMPT =
  'nudity, sexually explicit content, sensual or suggestive posing, lingerie or underwear';

/**
 * QUALITY / ARTIFACT NEGATIVES: the models' common failure modes — watermarks,
 * anatomy glitches, soft or blown-out frames, doubled faces. The text terms used
 * to live here as a bare "text"; they are their own list now (below), because a
 * render that deliberately shows an app screen needs the lighter version.
 */
export const QUALITY_NEGATIVE_PROMPT =
  'watermarks, extra limbs, deformed hands, blurry, duplicate faces, overexposed';

/**
 * TEXT NEGATIVES — the fix for garbled writing in finished videos.
 *
 * Video models cannot spell: every word they invent lands as warped
 * pseudo-lettering, and "text" on its own was nowhere near enough steering. So
 * nothing in this app asks for readable words any more (no product URL in a
 * prompt, no "legible labels" on a phone screen, no end cards or wordmarks in a
 * script) and this list rides along on every render.
 */
export const TEXT_NEGATIVE_PROMPT =
  'text, on-screen text, captions, subtitles, title cards, logos, signage, gibberish lettering, misspelled words';

/**
 * The lighter version, for a render that deliberately shows an app screen: a UI
 * IS lettering, so negating text outright would fight the shot — but garbled
 * captions burned over the video are never wanted.
 */
export const CAPTION_NEGATIVE_PROMPT =
  'captions, subtitles, title cards, gibberish lettering, misspelled words';

/**
 * PHONE NEGATIVES: steer renders away from an uninvited phone-in-hand beat.
 * Since Aug 15 2026 the phone beat is OPT-IN at the hook — nothing is injected
 * and no screen block is appended unless the render asked for one — so this list
 * is belt-and-braces steering rather than the primary defence. NEVER sent on a
 * render that deliberately shows a held phone — the chosen phone-shot scene of a Long
 * Video project and a video that embeds an App Mockup use
 * PHONE_OK_NEGATIVE_PROMPT instead, so the negative prompt cannot fight the
 * shot the user asked for.
 */
export const PHONE_NEGATIVE_PROMPT =
  'phone in hand, holding phone, phone screen, chat interface on phone';

/**
 * FRAMING NEGATIVES — the face-visibility fix (Sep 11 2026). Generated videos
 * and stills were cropping a character's head/face at the frame edge; these
 * terms steer every render and character image away from that. The
 * generate-video hook keeps its own FRAMING_NEGATIVE with the same terms and
 * guarantees them server-side even when a caller sends its own list.
 */
export const FRAMING_NEGATIVE_PROMPT =
  'face cut off, head cut off, partial face, cropped head, face out of frame, decapitated';

/** The default negative prompt for video renders and character/scene images. */
export const FULL_NEGATIVE_PROMPT = `${SAFETY_NEGATIVE_PROMPT}, ${QUALITY_NEGATIVE_PROMPT}, ${TEXT_NEGATIVE_PROMPT}, ${PHONE_NEGATIVE_PROMPT}, ${FRAMING_NEGATIVE_PROMPT}`;

/** For renders that deliberately show a held phone (mockup beat / phone-shot scene). */
export const PHONE_OK_NEGATIVE_PROMPT = `${SAFETY_NEGATIVE_PROMPT}, ${QUALITY_NEGATIVE_PROMPT}, ${CAPTION_NEGATIVE_PROMPT}, ${FRAMING_NEGATIVE_PROMPT}`;

/**
 * For App Mockup generation: a mockup IS a phone/desktop screen full of UI
 * text, so the 'text' and phone negatives would fight the medium itself —
 * only the safety list plus the artifact terms that still apply travel.
 */
export const MOCKUP_NEGATIVE_PROMPT = `${SAFETY_NEGATIVE_PROMPT}, watermarks, blurry, overexposed`;

/**
 * LIKENESS NEGATIVES — the celebrity-likeness mitigation, and ONLY for a
 * character PORTRAIT. Google's likeness check screens the face in a
 * photorealistic portrait (see isContentFilterError in
 * apps/Create/projectApi.ts); that was never a reason to negate photorealism
 * in every storyboard still and every render, which is what the old combined
 * safety list did.
 */
export const LIKENESS_NEGATIVE_PROMPT =
  'photorealistic skin texture, hyperrealistic face, celebrity likeness, real person likeness';

/** For drawing a character's portrait: adult-content steer + likeness steer + face-in-frame steer. */
export const PORTRAIT_NEGATIVE_PROMPT = `${SAFETY_NEGATIVE_PROMPT}, ${LIKENESS_NEGATIVE_PROMPT}, ${QUALITY_NEGATIVE_PROMPT}, ${TEXT_NEGATIVE_PROMPT}, ${FRAMING_NEGATIVE_PROMPT}`;

/**
 * The in-prompt form of the adult-content steer, for endpoints with no
 * negative-prompt parameter — and it is phrased POSITIVELY on purpose.
 * Spelling the sexual terms out inside an otherwise ordinary prompt ("Avoid:
 * nudity, sexually explicit content…") puts that vocabulary in front of the
 * image service's own prompt screening, which is a fine way to have a football
 * still refused over words we added ourselves.
 */
export const SAFETY_AVOID_CLAUSE =
  ' Keep it non-sexual: subjects fully clothed, no suggestive posing.';

/** The adult-content list as individual terms, so an image prompt can drop them. */
const SAFETY_TERMS = SAFETY_NEGATIVE_PROMPT.split(',').map((term) => term.trim());

/**
 * The "Avoid: …" half of an image prompt: the artifact and framing terms only.
 * Anything from the adult-content list is stripped and carried by
 * SAFETY_AVOID_CLAUSE instead — same steer, none of the vocabulary.
 */
function imageAvoidList(negative: string): string {
  return negative
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term && SAFETY_TERMS.indexOf(term) === -1)
    .join(', ');
}

/** Generate an AI image; returns the durable public URL. */
export async function generateImage(opts: {
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  quality?: 'low' | 'medium' | 'high';
  /**
   * Negative terms appended as an in-prompt "Avoid:" clause —
   * /api/generate/image has no native negative-prompt parameter. Defaults to
   * FULL_NEGATIVE_PROMPT (safety + quality + phone); pass
   * MOCKUP_NEGATIVE_PROMPT for UI screenshots, which are text and phone
   * screens by design.
   */
  negativePrompt?: string;
}): Promise<string> {
  // Every image prompt carries the negative steer once — the image endpoint
  // has no separate negative-prompt parameter, so it rides in the prompt. The
  // artifact terms are listed; the adult-content steer is the positive clause
  // (see SAFETY_AVOID_CLAUSE) rather than a list of sexual words.
  const negative = (opts.negativePrompt || FULL_NEGATIVE_PROMPT).trim();
  const avoid = imageAvoidList(negative);
  const prompt = opts.prompt.includes(' Avoid: ')
    ? opts.prompt
    : `${opts.prompt}${avoid ? ` Avoid: ${avoid}.` : ''}${SAFETY_AVOID_CLAUSE}`;
  const res = await fetch('/api/generate/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      aspectRatio: opts.aspectRatio || '9:16',
      quality: opts.quality || 'high',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || typeof data.imageUrl !== 'string') {
    throw new Error(data?.error || `Image generation failed (HTTP ${res.status}).`);
  }
  return data.imageUrl;
}

/** Describe an image with GPT-4 vision; returns a plain-text description. */
export async function describeImage(imageUrl: string, analysisPrompt: string): Promise<string> {
  const res = await fetch('/api/analyze-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentUrl: imageUrl, analysisPrompt }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || typeof data.analysis !== 'string') {
    throw new Error(data?.error || `Could not analyze image (HTTP ${res.status}).`);
  }
  return data.analysis.trim();
}

// ---------------------------------------------------------------------------
// ✨ AI EXPAND — the sparkle button next to every text field
// ---------------------------------------------------------------------------
/**
 * Turn a few words into a usable description. "basketball player" becomes the
 * kind of paragraph a video model can actually render, and the customer edits
 * it before anything is spent.
 *
 * One small model call through the platform's OpenAI proxy — the same endpoint
 * the script writer already uses, so no new credential and no new integration.
 * It NEVER throws for the caller's benefit: an expansion that cannot be made
 * returns the original text unchanged, and the field is left exactly as typed.
 */
export interface ExpandFieldOptions {
  /** What this field is, in the product's own words: "Scene description". */
  field: string;
  /** What the customer typed. Returned untouched when it cannot be expanded. */
  text: string;
  /** Anything that makes the expansion specific: the product, the tone. */
  context?: string;
  /** Roughly how long the answer should be. Default 55 words. */
  words?: number;
}

/**
 * HEADERS FOR THE PLATFORM'S AI PROXY — and the token is NOT optional.
 *
 * `POST /proxy/openai/v1/chat/completions` rejects an anonymous request with
 * `401 { code: "no_credentials" }` BEFORE it reaches a provider, so a call
 * without the workspace data-plane token never generates anything. Every caller
 * in this app treats a failed AI call as "use the deterministic template", which
 * means a missing header does not look like a bug — it looks like the templates
 * are simply what the product writes. Anything in this workspace that talks to
 * the proxy goes through here so that cannot happen again.
 */
export function aiProxyHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const client = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  const token = client && typeof client.token === 'string' ? client.token : '';
  if (token) headers['X-Workspace-DB-Token'] = token;
  return headers;
}

export async function expandFieldText(options: ExpandFieldOptions): Promise<string> {
  const text = (options.text || '').trim();
  if (!text) return text;
  const words = options.words || 55;
  const system =
    'You expand short notes into rich, concrete copy for an AI video brief. ' +
    'Answer with the expanded text ONLY: no preamble, no quotes, no markdown, no bullet points, ' +
    'no explanation of what you did. Keep the writer\u2019s meaning and voice, add specific sensory and ' +
    'visual detail, and stay under ' + words + ' words. ' +
    'Never invent a brand name, a price, a statistic or a claim that was not given to you. ' +
    'Never describe words, captions, logos or lettering appearing on screen — video models cannot spell.';
  const user = [
    `Field: ${options.field}`,
    options.context ? `Context: ${clampText(options.context, 500)}` : '',
    `Text to expand: ${clampText(text, 600)}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: aiProxyHeaders(),
      body: JSON.stringify({
        model: 'gpt-5.6-terra',
        reasoning_effort: 'none',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_completion_tokens: 320,
      }),
    });
    const data = await res.json().catch(() => null);
    const raw =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? String(data.choices[0].message.content || '')
        : '';
    const cleaned = raw.trim().replace(/^["“']+|["”']+$/g, '').trim();
    return cleaned || text;
  } catch (e) {
    console.warn('[ReelioStudio] expandFieldText failed, keeping the original text:', e);
    return text;
  }
}

/** Local copy of the clamp helper, so this file stays import-light. */
function clampText(value: string, max: number): string {
  const t = (value || '').trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** The vision prompt used to derive a character description from an image. */
export const CHARACTER_VISION_PROMPT =
  'You are casting a recurring on-camera character for an AI-generated video. ' +
  'Describe the SUBJECT of this image as a reusable character reference in 2-3 sentences: ' +
  'gender presentation, approximate age, skin tone, hair (color, length, style), notable facial ' +
  'features, wardrobe, build, and overall vibe/personality. Write it as a single descriptive ' +
  'paragraph that could be pasted into a video prompt to reproduce the same person in every shot. ' +
  'Do not mention the background, the photo itself, or that it is an image.';

/** Build a structured UI-screenshot prompt for the mockup generator. */
export function buildMockupPrompt(input: {
  appName: string;
  screen: string;
  platform: 'phone' | 'desktop';
  style?: string;
}): string {
  const device =
    input.platform === 'desktop'
      ? 'a modern desktop/web app screen shown edge-to-edge (no browser chrome, no window frame)'
      : 'a modern smartphone app screen shown edge-to-edge (no phone bezel, no hand, no background)';
  const style =
    input.style?.trim() ||
    'clean, contemporary, high-fidelity product design; crisp typography; realistic spacing, ' +
      'icons and imagery; subtle depth and shadows';
  return (
    `A pixel-perfect, photorealistic UI screenshot of ${device}. ` +
    `App/product: "${input.appName}". Screen: ${input.screen}. ` +
    `Design language: ${style}. ` +
    'Render it as an actual app interface a real user would see — navigation, buttons, cards, ' +
    'and content laid out convincingly with legible (but not gibberish) labels. ' +
    'Fill the entire frame with the interface only. No device frame, no hands, no watermark, no caption text outside the UI.'
  );
}

// ---------------------------------------------------------------------------
// Content refusals from the video service
// ---------------------------------------------------------------------------

/** A render status, loosely typed — every poller in the app answers this shape. */
export interface RenderStatusLike {
  stage?: string;
  status?: string;
  user_message?: string;
  error?: string;
  /** Set by the pipeline when the video service refused the job outright. */
  blocked?: boolean;
}

/**
 * Terms that only ever appear when the VIDEO SERVICE refused a job on content
 * grounds. Deliberately narrow, and never applied to anything the customer
 * typed — VidVerge does not screen briefs (see SAFETY_NEGATIVE_PROMPT above:
 * sexual content is the only thing we steer a generation away from).
 */
const SERVICE_REFUSAL_RE =
  /content filter|content_filter|safety filter|blocked by safety|flagged as containing|celebrity likeness|real people(?:'s)? names|names or likenesses|real person likeness|risk control|content policy/i;

/**
 * A REFUSAL IS AN ENDING. When the service says no on content grounds, that job
 * will never become a video — so every poller treats a match here as terminal:
 * the loop stops, the progress bar stops, and the customer gets an answer
 * instead of a bar animating on forever behind an error.
 *
 * Returns the line to show, or null when this status is not a refusal.
 */
export function contentRefusalReason(status: RenderStatusLike | null | undefined): string | null {
  if (!status) return null;
  const stage = String(status.stage || '');
  const state = String(status.status || '');
  const flagged =
    status.blocked === true ||
    stage === 'blocked' ||
    stage === 'rejected' ||
    state === 'blocked' ||
    state === 'rejected';
  const text = `${status.user_message || ''} ${status.error || ''}`.trim();
  if (!flagged && !(text && SERVICE_REFUSAL_RE.test(text))) return null;
  return (
    status.user_message ||
    status.error ||
    'The video service turned this render down on content grounds.'
  );
}

// ---------------------------------------------------------------------------
// WorkspaceDB write refusals
// ---------------------------------------------------------------------------

/**
 * True when a WorkspaceDB write was refused because this visitor has no
 * VERIFIED workspace session.
 *
 * The guarded tables (`video_projects`, `video_series`) declare a write policy
 * of `{ ownerColumn: 'session_id', allowSharedWrites: false,
 * requireVerifiedOwner: true }`, so the platform rejects any insert whose owner
 * it cannot verify against the workspace's real sessions — answering
 * `403 WRITE_POLICY_DENIED` with "A verified session ID is required for private
 * writes". A visitor browsing without a signed-in session has no such owner, so
 * the write can NEVER succeed: retrying it, or stamping our own session id onto
 * the row, changes nothing.
 *
 * That is deliberate platform hardening, not a fault in the render pipeline.
 * The video still generates and still lands in My Videos; only the saved row —
 * i.e. Resume — is lost. Callers use this to say so plainly instead of leaking
 * the platform's wording into the product.
 */
export function isUnverifiedSessionWriteError(error: unknown): boolean {
  const raw = (error || {}) as any;
  const text = String(raw.message || raw.error || error || '').toLowerCase();
  if (!text) return false;
  if (text.includes('verified session')) return true;
  return text.includes('write_policy_denied') && text.includes('session');
}

/**
 * Customer-facing wording for a row we could not save. "A verified session ID
 * is required for private writes" means nothing to someone who is just trying to
 * make a video, so that one refusal is explained properly; anything else falls
 * through to the caller's own message.
 */
export function writeFailureNotice(error: unknown, what: string, fallback?: string): string {
  if (isUnverifiedSessionWriteError(error)) {
    return `${what} won't be saved to your account because you are not signed in on this device. Everything still renders and lands in My Videos — only Resume is unavailable. Sign in to keep your work.`;
  }
  return fallback || `${what} could not be saved just now.`;
}

/** Keep database/SDK internals out of customer-facing render errors. */
function safeRenderFailure(error: unknown, fallback: string): string {
  const raw = error as any;
  const message = String((raw && (raw.message || raw.error)) || raw || '').trim();
  const databaseError =
    /database|workspace\s*db|postgres|sqlstate|\b(?:42p01|42703|2350[235])\b|relation\s+.+\s+does not exist|column\s+.+\s+does not exist|permission denied for (?:table|relation|schema|sequence)|constraint|db\.(?:query|insert|update|delete)|write_policy_denied|verified session/i;
  return !message || databaseError.test(message) ? fallback : message;
}

// ---------------------------------------------------------------------------
// Kick off a render directly (Script Studio "Generate Video" button)
// ---------------------------------------------------------------------------
export interface SubmitVideoResult {
  success: boolean;
  jobId?: string;
  error?: string;
  /** Optional informational line returned by the render service. */
  notice?: string;
  /** The model the render actually started on. */
  modelUsed?: string;
}

export async function submitVideo(input: SubmitVideoInput): Promise<SubmitVideoResult> {
  // SESSION ATTRIBUTION: wait for the verified session before submitting, so
  // the hook's video_jobs insert is owned from birth — an unowned row is
  // invisible to every visitor (My Videos filters strictly on session_id).
  const sessionId = (await waitForDbSession()) || studioSessionId();
  // The composer's options, read once: the optional upload and picked model
  // both come from here.
  const composerOptions = getGenerationOptions();
  const scenes = input.scenes
    .map((s) => ({
      scene_description: (s.scene_description || '').trim(),
      dialogue: (s.dialogue || '').trim(),
    }))
    .filter((s) => s.scene_description.length > 0);
  if (scenes.length === 0) {
    return { success: false, error: 'Add at least one scene with a visual description.' };
  }

  const body: Record<string, unknown> = {
    script: JSON.stringify(scenes),
    character_description:
      (input.characterDescription || '').trim() ||
      (composerOptions.characterEnabled ? (composerOptions.characterDescription || '').trim() : '') ||
      'A single consistent on-camera presenter, identical in every scene.',
    tone: input.tone || 'cinematic',
    aspect_ratio: input.aspectRatio || '16:9',
    duration_seconds: input.durationSeconds || scenes.length * 8,
  };
  if (input.title) body.title = input.title;
  // THE MODEL THE VISITOR PICKED IN THE OPTIONS BAR, sent with the render — it
  // used to be set on screen and then silently dropped here, so every in-chat
  // render came out on the hook's own default whatever the bar said.
  const pickedModel = getVideoModel(input.model || composerOptions.model);
  body.provider = pickedModel.provider;
  body.video_provider = pickedModel.provider;
  body.model = pickedModel.model;
  body.video_model = pickedModel.model;
  // Negative prompt for the video model (safety + quality + phone terms),
  // under both key spellings so whichever one the (patched) hook reads lands.
  // A video that embeds an App Mockup deliberately shows a held phone, so it
  // sends the PHONE_OK list — the phone negatives would fight that shot.
  const negativeList = input.mockupImageUrl ? PHONE_OK_NEGATIVE_PROMPT : FULL_NEGATIVE_PROMPT;
  body.negative_prompt = negativeList;
  body.negativePrompt = negativeList;
  // PHONE / APP-MOCKUP BEAT — OPT-IN, and stated out loud on every submit
  // rather than left to a default: a mockup the visitor explicitly picked turns
  // it on, and nothing else does. Both key spellings, like the fields above.
  const wantsMockupBeat = !!input.mockupImageUrl;
  body.phone_shot = wantsMockupBeat;
  body.phoneShot = wantsMockupBeat;
  // Write-side session attribution (My Videos scoping): the platform stamps
  // session_id on the hook's video_jobs insert from the forwarded X-Session-Id
  // header; this body copy is the redundant second channel so the row can still
  // be attributed if the header is ever stripped. The current hook ignores
  // unknown body fields (safe, additive) — see SESSION ATTRIBUTION ON WRITES in
  // tools/generate-video.ts.
  if (sessionId) body.session_id = sessionId;
  if (input.websiteUrl) {
    body.website_url = input.websiteUrl;
    body.website_placement = input.websitePlacement || 'end';
  }
  // Forward the one optional upload. The hook may use it to guide the generated
  // first-frame anchor; when no URL is present it creates the anchor itself.
  const effectiveCharacterImageUrl = (
    input.characterImageUrl ||
    (input.characterData && input.characterData.image_url) ||
    (composerOptions.characterEnabled ? composerOptions.characterImageUrl : '') ||
    ''
  ).trim();
  if (effectiveCharacterImageUrl) body.character_image_url = effectiveCharacterImageUrl;
  // The chosen mockup: named in the render's phone-screen block, never attached
  // as a reference image (on the single-reference path a reference is
  // effectively frame 0, which would open the video on a screenshot).
  if (input.mockupImageUrl) body.mockup_image_url = input.mockupImageUrl;
  // Uploaded screenshot -> Veo image reference for one scene. Same deal: the
  // hook ignores it until it learns to attach scene reference images (see the
  // SCENE REFERENCE IMAGES note in tools/generate-video.ts), and until then the
  // look is carried by the description Reel writes into that scene's text.
  const referenceImages = (input.referenceImageUrls || [])
    .filter((url, index, all) => /^https?:\/\//i.test(url) && all.indexOf(url) === index)
    .slice(0, 10);
  if (input.referenceImageUrl && referenceImages.indexOf(input.referenceImageUrl) === -1) {
    referenceImages.unshift(input.referenceImageUrl);
  }
  if (referenceImages.length > 0) body.reference_images = referenceImages.slice(0, 10);
  if (input.referenceImageUrl || referenceImages[0]) {
    body.reference_image_url = input.referenceImageUrl || referenceImages[0];
    body.reference_image_scene = Math.max(1, input.referenceImageScene || 1);
  }
  // Generic character description + per-scene dialogue lines. The optional
  // image remains character_image_url only; the hook owns first-frame anchoring.
  if (input.characterData && input.characterData.name) {
    body.character_data = input.characterData;
  }
  if (Array.isArray(input.dialogues) && input.dialogues.length > 0) {
    body.dialogues = input.dialogues.map((d) => (d || '').trim());
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['X-Session-Id'] = sessionId;

  const start = async (): Promise<{ jobId: string; notice?: string; modelUsed?: string }> => {
    const res = await fetch(`/api/hooks/execute/${scopedSpaceId()}/generate-video`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.job_id) {
      throw new Error(
        safeRenderFailure(data?.error, 'The render could not be started. Please try again.'),
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
    // Tell the in-chat progress card to start polling immediately.
    window.dispatchEvent(
      new CustomEvent(STUDIO_EVENTS.videoSubmitted, {
        detail: { jobId: started.jobId, notice: started.notice, modelUsed: started.modelUsed },
      }),
    );
    return { success: true, jobId: started.jobId, notice: started.notice, modelUsed: started.modelUsed };
  } catch (e: any) {
    return {
      success: false,
      error: safeRenderFailure(e, 'The video service is temporarily unavailable. Please try again.'),
    };
  }
}

// ---------------------------------------------------------------------------
// Small open-panel helpers so any surface can raise a studio panel.
// ---------------------------------------------------------------------------
export function openCharacters(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.openCharacters));
}
export function openMockups(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.openMockups));
}
export function openScriptStudio(detail?: { scenes?: ScriptScene[] }): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.openScriptStudio, { detail: detail || {} }));
}

/**
 * Open the Create app AND switch it to the Long Series builder. Reel uses this
 * from chat (a `series://build` link in its answer): the series runner is the
 * one thing the agent's own produce_video tool cannot do, so handing the
 * visitor over in a single tap is the whole point.
 */
export function openEpisodeSeries(): void {
  if (typeof window === 'undefined') return;
  // The event alone would be lost when the app is not mounted yet (its
  // listener is registered in an effect that has not run), so the intent is
  // ALSO left as a flag the app reads on mount and clears. Whichever arrives
  // first wins; neither can be missed.
  (window as any).__vidvergeOpenSeries = true;
  window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'create' } }));
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(STUDIO_EVENTS.openEpisodeSeries));
  }, 60);
}

/** True once, when a `series://build` hand-off is waiting to be honoured. */
export function takeEpisodeSeriesRequest(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  if (!w.__vidvergeOpenSeries) return false;
  w.__vidvergeOpenSeries = false;
  return true;
}
