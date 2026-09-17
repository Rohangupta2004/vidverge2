/**
 * VidVerge — MOTION UI: the module-scope store.
 *
 * Same pattern as videoStore.ts and agenticRunner.ts: the whole Motion UI flow
 * (assets, options, the Motion Plan, the undo/redo history and the render job)
 * lives here in module scope, NOT in React state, so switching apps or tabs
 * cannot lose a plan or a render in flight. Components subscribe with
 * useMotionUi() and are pure projections of this state.
 *
 * The store never renders anything itself — it orchestrates the Director
 * (motionUiDirector), the composition renderer (motionUiComposition) and the
 * validator, and keeps a persisted snapshot in localStorage.
 */
import { useEffect, useState } from 'react';
import {
  FULL_NEGATIVE_PROMPT,
  PHONE_OK_NEGATIVE_PROMPT,
  getGenerationOptions,
  insertRow,
  uploadImage,
  waitForDbSession,
  workspaceUuid,
} from '../../lib/reelioStudio';
import {
  analyzeAssetVision,
  directMotionPlan,
  distillReferenceNotes,
  editMotionPlan,
  readImageMeta,
  validateAndRepair,
} from './motionUiDirector';
import { renderMotionVideo } from './motionUiComposition';
import { DEFAULT_PRESET_ID } from './motionUiPresets';
import { checkVideoStatus, scopedSpaceId, sessionId, workspaceDbToken } from './studioApi';
import { DEFAULT_VIDEO_MODEL, getVideoModel } from './videoTypes';
import {
  clamp,
  uid,
  type AssetLayer,
  type AssetType,
  type MotionAsset,
  type MotionAspect,
  type MotionIssue,
  type MotionPlan,
  type TextCue,
} from './motionUiTypes';

export type MotionPhase = 'input' | 'generating' | 'preview' | 'rendering' | 'done';

export interface MotionRenderJob {
  phase: 'idle' | 'rendering' | 'ready' | 'failed';
  message: string;
  videoUrl: string | null;
  operationId: string | null;
  error: string | null;
  startedAt: number;
}

export interface MotionUiState {
  phase: MotionPhase;
  // --- Inputs ---
  brief: string;
  assets: MotionAsset[];
  presetId: string;
  styleWord: string;
  duration: number;
  aspect: MotionAspect;
  music: string; // 'none' or an ElevenLabs preset id
  musicUrl: string;
  musicBusy: boolean;
  allowAiVideo: boolean;
  useAvatar: boolean;
  avatarUrl: string;
  referenceNotes: string;
  // --- Working state ---
  uploading: boolean;
  analyzing: boolean;
  generating: boolean;
  stage: string | null;
  plan: MotionPlan | null;
  usedAi: boolean;
  issues: MotionIssue[];
  editing: boolean;
  // --- History (undo/redo for edits + quick editor) ---
  history: MotionPlan[];
  future: MotionPlan[];
  // --- Render ---
  job: MotionRenderJob | null;
  error: string | null;
}

const EMPTY: MotionUiState = {
  phase: 'input',
  brief: '',
  assets: [],
  presetId: DEFAULT_PRESET_ID,
  styleWord: '',
  duration: 15,
  aspect: '16:9',
  music: 'none',
  musicUrl: '',
  musicBusy: false,
  allowAiVideo: false,
  useAvatar: false,
  avatarUrl: '',
  referenceNotes: '',
  uploading: false,
  analyzing: false,
  generating: false,
  stage: null,
  plan: null,
  usedAi: false,
  issues: [],
  editing: false,
  history: [],
  future: [],
  job: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Store plumbing
// ---------------------------------------------------------------------------
const STORE_KEY = 'vidverge.motionui.v1';

function persistable(s: MotionUiState): Partial<MotionUiState> {
  return {
    ...s,
    uploading: false,
    analyzing: false,
    generating: false,
    editing: false,
    stage: null,
    history: [],
    future: [],
  };
}

function load(): MotionUiState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    return { ...EMPTY, ...parsed, uploading: false, analyzing: false, generating: false, editing: false, stage: null, history: [], future: [] };
  } catch {
    return EMPTY;
  }
}

let state: MotionUiState = load();
const listeners = new Set<() => void>();

export function getMotionState(): MotionUiState {
  return state;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function save(s: MotionUiState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(persistable(s)));
  } catch {
    /* storage disabled */
  }
}

function set(patch: Partial<MotionUiState>): void {
  state = { ...state, ...patch };
  save(state);
  listeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[MotionUI] listener failed:', e);
    }
  });
}

export function useMotionUi(): MotionUiState {
  const [snap, setSnap] = useState<MotionUiState>(getMotionState);
  useEffect(() => {
    setSnap(getMotionState());
    return subscribe(() => setSnap(getMotionState()));
  }, []);
  return snap;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// Input actions
// ---------------------------------------------------------------------------
export function setBrief(brief: string): void {
  set({ brief });
}
export function setPreset(presetId: string): void {
  set({ presetId });
}
export function setStyleWord(styleWord: string): void {
  set({ styleWord });
}
export function setDuration(duration: number): void {
  set({ duration: clamp(duration, 5, 60) });
}
export function setAspect(aspect: MotionAspect): void {
  set({ aspect });
}
export function setAllowAiVideo(allowAiVideo: boolean): void {
  set({ allowAiVideo });
}
export function setUseAvatar(useAvatar: boolean): void {
  const selected = getGenerationOptions();
  set({
    useAvatar,
    avatarUrl:
      useAvatar && !state.avatarUrl && selected.characterEnabled
        ? selected.characterImageUrl || ''
        : state.avatarUrl,
  });
}
export function setAvatarUrl(avatarUrl: string): void {
  set({ avatarUrl });
}
export async function uploadAvatar(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return;
  set({ uploading: true, error: null });
  try {
    const avatarUrl = await uploadImage(file, 'motionui-presenters');
    set({ avatarUrl, uploading: false, useAvatar: true });
  } catch (e: any) {
    set({ uploading: false, error: (e && e.message) || 'That presenter image could not be uploaded.' });
  }
}
export function setMusic(music: string, musicUrl = ''): void {
  set({ music, musicUrl });
}

/**
 * MUSIC (optional): generate a background track via the ElevenLabs preset
 * endpoint. Best-effort - on any failure the video simply stays silent. When a
 * plan already exists, the track is attached so the preview + render play it.
 */
export async function chooseMusic(mood: string): Promise<void> {
  if (mood === 'none') {
    set({ music: 'none', musicUrl: '' });
    if (state.plan) set({ plan: { ...state.plan, audio: { ...state.plan.audio, musicUrl: undefined, muted: true } } });
    return;
  }
  const uuid = workspaceUuid();
  const token = typeof window !== 'undefined' ? (window as any).__workspaceDb?.token : '';
  if (!uuid || !token) {
    set({ music: mood, error: 'Music needs a verified session - try again in a moment.' });
    return;
  }
  set({ music: mood, musicBusy: true, error: null });
  try {
    const lengthMs = Math.round(clamp(state.duration || 15, 5, 60) * 1000);
    const res = await fetch('/api/workspaces/' + uuid + '/audio/music/preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify({ preset: mood, lengthMs }),
    });
    const data = await res.json().catch(() => null);
    const url = data && typeof data.audioUrl === 'string' ? data.audioUrl : '';
    if (!res.ok || !url) throw new Error((data && data.error) || 'Music generation failed.');
    set({ musicUrl: url, musicBusy: false });
    if (state.plan) set({ plan: { ...state.plan, audio: { ...state.plan.audio, musicUrl: url, muted: false } } });
  } catch (e: any) {
    set({ musicBusy: false, music: 'none', musicUrl: '', error: (e && e.message) || 'Music could not be generated - continuing silent.' });
  }
}

/** Guess an asset type from filename / dimensions before vision runs. */
function guessType(filename: string, aspect: number): AssetType {
  const f = filename.toLowerCase();
  if (/logo|wordmark|brandmark/.test(f)) return 'logo';
  if (/mobile|phone|iphone|android|screen-?\d/.test(f)) return 'mobile';
  if (/product|packshot|hero/.test(f)) return 'product';
  if (/site|landing|web|home/.test(f)) return 'website';
  if (aspect > 0 && aspect < 0.8) return 'mobile';
  return 'ui_screenshot';
}

const REFERENCE_VIDEO_PROMPT =
  'Analyze this reference video as motion-design inspiration. In 3-5 concise sentences describe: pacing and beat density; camera movement and framing; transition language; typography placement, scale and reveal style; and overall rhythm. Do not describe or reproduce individual frames, people, brands, or written copy. The result will guide an original composition, never a frame-copy.';

/** Analyze one uploaded reference file with Gemini Video Understanding. */
async function analyzeReferenceVideo(file: File): Promise<string> {
  try {
    const form = new FormData();
    form.append('file', file, file.name || 'reference.mp4');
    form.append('prompt', REFERENCE_VIDEO_PROMPT);
    const res = await fetch('/api/generate/video-analysis', { method: 'POST', body: form });
    const data = await res.json().catch(() => null);
    return res.ok && data && data.success && typeof data.result === 'string'
      ? data.result.trim().slice(0, 1600)
      : '';
  } catch {
    return '';
  }
}

/** Upload screenshots or one/more style-only reference videos, then analyze. */
export async function addAssets(files: File[]): Promise<void> {
  const accepted = files
    .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
    .slice(0, Math.max(0, 12 - state.assets.length));
  if (accepted.length === 0) return;
  set({ uploading: true, error: null });
  try {
    const uploaded = await Promise.all(
      accepted.map(async (file) => {
        const isVideo = file.type.startsWith('video/');
        const [url, referenceNotes] = await Promise.all([
          uploadImage(file, isVideo ? 'motionui-references' : 'motionui'),
          isVideo ? analyzeReferenceVideo(file) : Promise.resolve(''),
        ]);
        const asset: MotionAsset = {
          id: uid('a'),
          url,
          filename: file.name || (isVideo ? 'reference.mp4' : 'screenshot.png'),
          type: isVideo ? 'reference_video' : guessType(file.name || '', 1),
          analyzed: isVideo,
          locked: false,
          width: 0,
          height: 0,
          aspect: 1,
          colors: [],
          theme: '',
          role: isVideo ? 'motion reference' : '',
          summary: isVideo ? 'Style and pacing reference only — never copied frame-for-frame.' : '',
          structure: [],
          referenceNotes: isVideo ? referenceNotes : undefined,
        };
        return asset;
      }),
    );
    set({
      assets: [...state.assets, ...uploaded],
      uploading: false,
      referenceNotes: uploaded.some((a) => a.type === 'reference_video') ? '' : state.referenceNotes,
    });
    const imageIds = uploaded.filter((a) => a.type !== 'reference_video').map((a) => a.id);
    if (imageIds.length > 0) void analyzeAssets(imageIds);
  } catch (e: any) {
    set({ uploading: false, error: (e && e.message) || 'Those files could not be uploaded — try again.' });
  }
}

/** Read dimensions/colors + ask vision what each asset is. Best-effort. */
export async function analyzeAssets(ids?: string[]): Promise<void> {
  const targets = state.assets.filter((a) => (ids ? ids.includes(a.id) : !a.analyzed));
  if (targets.length === 0) return;
  set({ analyzing: true });
  await Promise.all(
    targets.map(async (asset) => {
      try {
        const meta = await readImageMeta(asset.url);
        let patch: Partial<MotionAsset> = {
          width: meta.width,
          height: meta.height,
          aspect: meta.aspect || 1,
          colors: meta.colors,
          theme: meta.theme,
          type: guessType(asset.filename, meta.aspect || 1),
        };
        // Logos and reference videos skip the heavier vision call.
        if (asset.type !== 'logo' && asset.type !== 'reference_video') {
          const vision = await analyzeAssetVision(asset.url);
          patch = {
            ...patch,
            role: vision.role,
            summary: vision.summary,
            structure: vision.structure,
            theme: (vision.theme || meta.theme) as MotionAsset['theme'],
            type:
              vision.kind === 'logo'
                ? 'logo'
                : vision.kind === 'mobile'
                  ? 'mobile'
                  : vision.kind === 'product'
                    ? 'product'
                    : vision.kind === 'website'
                      ? 'website'
                      : patch.type,
          };
        }
        updateAsset(asset.id, { ...patch, analyzed: true });
      } catch {
        updateAsset(asset.id, { analyzed: true });
      }
    }),
  );
  set({ analyzing: false });
}

export function updateAsset(id: string, patch: Partial<MotionAsset>): void {
  set({ assets: state.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
}

export function removeAsset(id: string): void {
  const removed = state.assets.find((a) => a.id === id);
  set({
    assets: state.assets.filter((a) => a.id !== id),
    referenceNotes: removed?.type === 'reference_video' ? '' : state.referenceNotes,
  });
}

export function toggleLock(id: string): void {
  updateAsset(id, { locked: !state.assets.find((a) => a.id === id)?.locked });
}

export function setAssetType(id: string, type: AssetType): void {
  updateAsset(id, { type });
}

/** Replace an asset's file in place (keeps its id + lock, re-analyzes). */
export async function replaceAsset(id: string, file: File): Promise<void> {
  const isVideo = file.type.startsWith('video/');
  if (!file.type.startsWith('image/') && !isVideo) return;
  set({ uploading: true });
  try {
    const [url, referenceNotes] = await Promise.all([
      uploadImage(file, isVideo ? 'motionui-references' : 'motionui'),
      isVideo ? analyzeReferenceVideo(file) : Promise.resolve(''),
    ]);
    updateAsset(id, {
      url,
      filename: file.name || (isVideo ? 'reference.mp4' : 'screenshot.png'),
      type: isVideo ? 'reference_video' : guessType(file.name || '', 1),
      analyzed: isVideo,
      colors: [],
      role: isVideo ? 'motion reference' : '',
      summary: isVideo ? 'Style and pacing reference only — never copied frame-for-frame.' : '',
      structure: [],
      referenceNotes: isVideo ? referenceNotes : undefined,
    });
    set({ uploading: false, referenceNotes: isVideo ? '' : state.referenceNotes });
    if (!isVideo) void analyzeAssets([id]);
  } catch (e: any) {
    set({ uploading: false, error: (e && e.message) || 'That file could not be uploaded.' });
  }
}

export function reorderAsset(id: string, dir: -1 | 1): void {
  const idx = state.assets.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const next = idx + dir;
  if (next < 0 || next >= state.assets.length) return;
  const arr = [...state.assets];
  const [item] = arr.splice(idx, 1);
  arr.splice(next, 0, item);
  set({ assets: arr });
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------
let genRun = 0;

/** Build (or rebuild) the Motion Plan from the current inputs. */
export async function generatePlan(): Promise<void> {
  const screens = state.assets.filter((a) => a.type !== 'reference_video');
  if (screens.length === 0) {
    set({ error: 'Add at least one screenshot or product image first.' });
    return;
  }
  const run = ++genRun;
  set({ phase: 'generating', generating: true, error: null, stage: 'Analyzing assets…' });

  // Make sure everything is analyzed before planning.
  if (state.assets.some((a) => !a.analyzed)) {
    await analyzeAssets();
    if (run !== genRun) return;
  }

  // Distill reference-video notes when present.
  let referenceNotes = state.referenceNotes;
  const refAsset = state.assets.find((a) => a.type === 'reference_video');
  if (refAsset && refAsset.referenceNotes && !referenceNotes) {
    referenceNotes = await distillReferenceNotes(refAsset.referenceNotes);
    if (run !== genRun) return;
    set({ referenceNotes });
  }

  set({ stage: 'Planning motion…' });
  try {
    const { plan, usedAi, issues } = await directMotionPlan({
      brief: state.brief,
      assets: state.assets,
      presetId: state.presetId,
      styleWord: state.styleWord,
      duration: state.duration,
      aspect: state.aspect,
      referenceNotes,
      allowAiVideo: state.allowAiVideo,
      useAvatar: state.useAvatar,
      avatarUrl: state.useAvatar ? state.avatarUrl : undefined,
    });
    if (run !== genRun) return;
    const withAudio: MotionPlan = {
      ...plan,
      audio: { ...plan.audio, musicUrl: state.musicUrl || plan.audio.musicUrl, muted: state.music === 'none' && !state.musicUrl },
    };
    set({
      phase: 'preview',
      generating: false,
      stage: null,
      plan: withAudio,
      usedAi,
      issues,
      history: [],
      future: [],
    });
  } catch (e: any) {
    if (run !== genRun) return;
    set({ phase: 'input', generating: false, stage: null, error: (e && e.message) || 'Could not plan the motion. Try again.' });
  }
}

export function regeneratePlan(): void {
  void generatePlan();
}

/** Apply a natural-language edit to the current plan. */
export async function applyAiEdit(instruction: string): Promise<void> {
  if (!state.plan || !instruction.trim()) return;
  set({ editing: true, error: null });
  const before = state.plan;
  try {
    const { plan, changed, issues } = await editMotionPlan(before, instruction.trim(), state.assets);
    if (changed) {
      set({
        plan,
        issues,
        editing: false,
        history: [...state.history, before].slice(-30),
        future: [],
      });
    } else {
      set({ editing: false, issues });
    }
  } catch (e: any) {
    set({ editing: false, error: (e && e.message) || 'That edit could not be applied.' });
  }
}

// ---------------------------------------------------------------------------
// Quick Editor — direct plan mutations with undo/redo
// ---------------------------------------------------------------------------
function mutatePlan(fn: (plan: MotionPlan) => void): void {
  if (!state.plan) return;
  const before = state.plan;
  const draft = clone(before);
  fn(draft);
  const { plan, issues } = validateAndRepair(draft, state.assets);
  set({ plan, issues, history: [...state.history, before].slice(-30), future: [] });
}

export function undo(): void {
  if (state.history.length === 0 || !state.plan) return;
  const prev = state.history[state.history.length - 1];
  set({ plan: prev, history: state.history.slice(0, -1), future: [state.plan, ...state.future].slice(0, 30) });
}

export function redo(): void {
  if (state.future.length === 0 || !state.plan) return;
  const next = state.future[0];
  set({ plan: next, future: state.future.slice(1), history: [...state.history, state.plan].slice(-30) });
}

export function canUndo(): boolean {
  return state.history.length > 0;
}
export function canRedo(): boolean {
  return state.future.length > 0;
}

export function trimLayer(layerId: string, start: number, end: number): void {
  mutatePlan((plan) => {
    const l = plan.layers.find((x) => x.id === layerId);
    if (!l) return;
    l.start = clamp(start, 0, plan.duration);
    l.end = clamp(end, l.start + 0.5, plan.duration);
  });
}

export function deleteLayer(layerId: string): void {
  mutatePlan((plan) => {
    plan.layers = plan.layers.filter((l) => l.id !== layerId);
  });
}

export function duplicateLayer(layerId: string): void {
  mutatePlan((plan) => {
    const l = plan.layers.find((x) => x.id === layerId);
    if (!l) return;
    const span = l.end - l.start;
    plan.layers.push({
      ...clone(l),
      id: uid('l'),
      start: clamp(l.end, 0, plan.duration),
      end: clamp(l.end + span, 0, plan.duration),
      worldX: clamp(l.worldX + 0.2, -1.5, 1.5),
    });
  });
}

/** Split a layer at time t into two adjacent layers over the same asset. */
export function splitLayer(layerId: string, t: number): void {
  mutatePlan((plan) => {
    const l = plan.layers.find((x) => x.id === layerId);
    if (!l || t <= l.start + 0.3 || t >= l.end - 0.3) return;
    const second = { ...clone(l), id: uid('l'), start: t };
    l.end = t;
    plan.layers.push(second);
  });
}

export function moveLayerOrder(layerId: string, dir: -1 | 1): void {
  mutatePlan((plan) => {
    const idx = plan.layers.findIndex((l) => l.id === layerId);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= plan.layers.length) return;
    const [item] = plan.layers.splice(idx, 1);
    plan.layers.splice(next, 0, item);
  });
}

export function replaceLayerAsset(layerId: string, assetId: string): void {
  mutatePlan((plan) => {
    const l = plan.layers.find((x) => x.id === layerId);
    if (!l) return;
    l.assetId = assetId;
  });
}

export function addTextCue(content: string): void {
  mutatePlan((plan) => {
    const start = clamp(plan.duration * 0.4, 0, plan.duration - 2);
    const cue: TextCue = {
      id: uid('t'),
      content: content.trim().slice(0, 48) || 'New headline',
      start,
      end: clamp(start + 2.5, start + 1, plan.duration),
      anchor: 'center',
      level: 2,
      weight: 700,
      animation: 'slide_up',
      align: 'center',
    };
    plan.text.push(cue);
  });
}

export function updateTextCue(id: string, patch: Partial<TextCue>): void {
  mutatePlan((plan) => {
    const c = plan.text.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch);
  });
}

export function deleteTextCue(id: string): void {
  mutatePlan((plan) => {
    plan.text = plan.text.filter((c) => c.id !== id);
  });
}

export function setAudioMuted(muted: boolean): void {
  mutatePlan((plan) => {
    plan.audio = { ...plan.audio, muted };
  });
}

export function setAudioVolume(volume: number): void {
  mutatePlan((plan) => {
    plan.audio = { ...plan.audio, volume: clamp(volume, 0, 1) };
  });
}

/** Rescale the whole plan (all times + duration) by a factor. Speed control. */
export function rescalePlanDuration(newDuration: number): void {
  mutatePlan((plan) => {
    const target = clamp(newDuration, 5, 60);
    const factor = target / Math.max(0.5, plan.duration);
    plan.duration = target;
    plan.camera = plan.camera.map((k) => ({ ...k, t: clamp(k.t * factor, 0, target) }));
    plan.layers = plan.layers.map((l) => ({ ...l, start: clamp(l.start * factor, 0, target), end: clamp(l.end * factor, 0, target) }));
    plan.text = plan.text.map((c) => ({ ...c, start: clamp(c.start * factor, 0, target), end: clamp(c.end * factor, 0, target) }));
  });
}

/** Trim the last N seconds off the video. */
export function trimEnd(seconds: number): void {
  if (!state.plan) return;
  rescaleClip(clamp(state.plan.duration - seconds, 5, 60));
}

function rescaleClip(newDuration: number): void {
  mutatePlan((plan) => {
    const target = clamp(newDuration, 5, 60);
    plan.duration = target;
    plan.camera = plan.camera.map((k) => ({ ...k, t: clamp(k.t, 0, target) }));
    plan.layers = plan.layers
      .filter((l) => l.start < target)
      .map((l) => ({ ...l, end: clamp(l.end, l.start + 0.5, target) }));
    plan.text = plan.text.filter((c) => c.start < target).map((c) => ({ ...c, end: clamp(c.end, c.start + 0.5, target) }));
  });
}

/** Update the brand and re-derive it into the plan. */
export function setBrandColor(key: 'primary' | 'secondary' | 'accent' | 'background' | 'text', value: string): void {
  mutatePlan((plan) => {
    plan.brand = { ...plan.brand, [key]: value };
    plan.background = { ...plan.background, colors: [plan.brand.background, plan.brand.primary, plan.brand.secondary] };
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const GENERATED_LAYER_POLL_MS = 8000;
const GENERATED_LAYER_MAX_TICKS = 75;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate one optional AI-video/avatar layer through VidVerge's existing
 * generate-video hook and check-video-status path. This keeps provider routing,
 * wallet accounting and durable clip storage in the same path as other shots.
 */
async function generateLayerClip(input: {
  layer: AssetLayer;
  plan: MotionPlan;
  assets: MotionAsset[];
  onStage: (message: string) => void;
  isAborted: () => boolean;
}): Promise<string> {
  const prompt = (input.layer.prompt || '').trim();
  if (!prompt) return '';
  const sid = (await waitForDbSession()) || sessionId();
  if (input.isAborted()) return '';

  const selected = getGenerationOptions();
  const presenterUrl = state.avatarUrl || (selected.characterEnabled ? selected.characterImageUrl : '');
  const presenterDescription =
    (selected.characterEnabled && selected.characterDescription) ||
    'A confident, natural on-camera presenter with a polished, approachable presence.';
  const duration = clamp(input.layer.end - input.layer.start, 2, 8);
  const aspectRatio = input.plan.aspectRatio === '1:1' ? '16:9' : input.plan.aspectRatio;
  const picked = getVideoModel(DEFAULT_VIDEO_MODEL);
  const isAvatar = input.layer.kind === 'avatar';
  const showsScreen = !!input.layer.screenAssetId;
  const dialogue = '';
  const scene = { scene_description: prompt, dialogue };
  const body: Record<string, unknown> = {
    script: JSON.stringify([scene]),
    script_json: [
      {
        scene_number: 1,
        shot_type: isAvatar ? 'Presenter' : 'Cinematic insert',
        description: prompt,
        dialogue,
        duration_seconds: duration,
      },
    ],
    character_description: isAvatar
      ? presenterDescription
      : 'No recurring on-camera character. Maintain the Motion UI composition look and lighting.',
    dialogues: [dialogue],
    tone: 'cinematic, polished',
    aspect_ratio: aspectRatio,
    title: `[Motion UI layer] ${input.plan.title}`,
    duration_seconds: duration,
    target_duration_seconds: duration,
    phone_shot: showsScreen,
    phoneShot: showsScreen,
    negative_prompt: showsScreen ? PHONE_OK_NEGATIVE_PROMPT : FULL_NEGATIVE_PROMPT,
    negativePrompt: showsScreen ? PHONE_OK_NEGATIVE_PROMPT : FULL_NEGATIVE_PROMPT,
    provider: picked.provider,
    video_provider: picked.provider,
    model: picked.model,
    video_model: picked.model,
  };
  if (sid) body.session_id = sid;
  if (isAvatar && /^https?:\/\//.test(presenterUrl)) {
    body.character_image_url = presenterUrl;
    body.character_data = {
      name: selected.characterName || 'Presenter',
      description: presenterDescription,
      image_url: presenterUrl,
    };
  }
  if (!isAvatar) {
    const productRefs = input.assets
      .filter((a) => a.type === 'product' && /^https?:\/\//.test(a.url))
      .map((a) => a.url)
      .slice(0, 3);
    if (productRefs.length > 0) {
      body.reference_images = productRefs;
      body.reference_image_url = productRefs[0];
      body.referenceImageUrl = productRefs[0];
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sid) headers['X-Session-Id'] = sid;
  const token = workspaceDbToken();
  if (token) headers['X-Workspace-DB-Token'] = token;

  input.onStage(isAvatar ? 'Generating the presenter segment…' : 'Generating a cinematic AI shot…');
  let jobId = '';
  try {
    const res = await fetch(`/api/hooks/execute/${scopedSpaceId()}/generate-video`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    jobId = res.ok && data && data.success && data.job_id ? String(data.job_id) : '';
    if (!jobId) return '';
  } catch {
    return '';
  }

  for (let tick = 0; tick < GENERATED_LAYER_MAX_TICKS; tick++) {
    if (input.isAborted()) return '';
    const status = await checkVideoStatus(jobId);
    const ready = status.success &&
      (status.stage === 'ready' || status.status === 'completed' || status.status === 'partial');
    const clip = Array.isArray(status.clip_urls) && status.clip_urls.length > 0
      ? status.clip_urls[0]
      : status.download_url;
    if (ready && /^https?:\/\//.test(clip || '')) return String(clip);
    if (status.stage === 'failed' || status.status === 'failed' || status.blocked) return '';
    input.onStage(isAvatar ? 'Generating the presenter segment…' : 'Generating a cinematic AI shot…');
    await sleep(GENERATED_LAYER_POLL_MS);
  }
  return '';
}

/** Generate optional layers one at a time, then repair failures natively. */
async function prepareGeneratedLayers(
  plan: MotionPlan,
  assets: MotionAsset[],
  onStage: (message: string) => void,
  isAborted: () => boolean,
): Promise<{ plan: MotionPlan; issues: MotionIssue[] }> {
  const generatedIssues: MotionIssue[] = [];
  const nextLayers: AssetLayer[] = [];
  for (const original of plan.layers) {
    if (original.kind !== 'ai_video' && original.kind !== 'avatar') {
      nextLayers.push(original);
      continue;
    }
    if (original.clipUrl && /^https?:\/\//.test(original.clipUrl)) {
      nextLayers.push(original);
      continue;
    }
    const clipUrl = await generateLayerClip({ layer: original, plan, assets, onStage, isAborted });
    if (isAborted()) return { plan, issues: generatedIssues };
    if (clipUrl) {
      nextLayers.push({ ...original, clipUrl });
      continue;
    }

    if (original.kind === 'ai_video') {
      const existingForeground = original.screenAssetId
        ? plan.layers.some((l) => l.kind === 'ui' && l.assetId === original.screenAssetId)
        : false;
      const fallback =
        (original.screenAssetId ? assets.find((a) => a.id === original.screenAssetId) : undefined) ||
        assets.find((a) => a.type !== 'reference_video' && a.type !== 'logo');
      if (!existingForeground && fallback) {
        nextLayers.push({
          ...original,
          assetId: fallback.id,
          kind: fallback.type === 'product' ? 'product' : 'ui',
          frameStyle: fallback.type === 'mobile' ? 'device' : fallback.type === 'website' ? 'browser' : 'card',
          clipUrl: undefined,
          prompt: undefined,
          screenAssetId: undefined,
          screenComposite: undefined,
        });
      }
      generatedIssues.push({
        level: 'warning',
        code: 'ai_video_fallback',
        message: 'An AI shot was unavailable, so the real product asset stayed animated in Remotion.',
      });
    } else {
      generatedIssues.push({
        level: 'warning',
        code: 'avatar_fallback',
        message: 'The presenter segment was unavailable and was skipped without stopping the video.',
      });
    }
  }
  const repaired = validateAndRepair({ ...plan, layers: nextLayers }, assets);
  return { plan: repaired.plan, issues: [...generatedIssues, ...repaired.issues] };
}

async function saveFinishedMotionVideo(plan: MotionPlan, videoUrl: string, operationId: string): Promise<void> {
  try {
    const sid = (await waitForDbSession()) || sessionId();
    await insertRow('video_jobs', {
      job_id: `motion-ui:${operationId}`,
      title: `${plan.title || 'Motion UI'} · Motion UI`,
      status: 'completed',
      video_url: videoUrl,
      delivery_url: videoUrl,
      source: 'remotion',
      phase_mode: false,
      script_json: {
        mode: 'motion-ui',
        version: plan.version,
        presetId: plan.presetId,
        text: plan.text.map((cue) => cue.content),
      },
      character_description: plan.layers.some((l) => l.kind === 'avatar') ? 'Motion UI presenter segment' : null,
      tone: plan.styleWord || plan.presetId,
      duration_seconds: Math.round(plan.duration),
      scene_count: 1,
      aspect_ratio: plan.aspectRatio,
      session_id: sid,
      model_used: 'remotion',
    });
  } catch (e) {
    console.warn('[MotionUI] final video could not be added to My Videos:', e);
  }
}

let renderRun = 0;
let aborted = false;

export async function renderVideo(): Promise<void> {
  if (!state.plan) return;
  if (state.job && state.job.phase === 'rendering') {
    set({ phase: 'rendering' });
    return;
  }
  const run = ++renderRun;
  aborted = false;
  set({
    phase: 'rendering',
    error: null,
    job: { phase: 'rendering', message: 'Building the composition…', videoUrl: null, operationId: null, error: null, startedAt: Date.now() },
  });
  try {
    const prepared = await prepareGeneratedLayers(
      state.plan,
      state.assets,
      (message) => {
        if (run === renderRun && !aborted) set({ job: state.job ? { ...state.job, message } : state.job });
      },
      () => aborted || run !== renderRun,
    );
    if (run !== renderRun || aborted) return;
    set({ plan: prepared.plan, issues: [...state.issues, ...prepared.issues] });
    const result = await renderMotionVideo({
      plan: prepared.plan,
      assets: state.assets,
      onStage: (message) => {
        if (run === renderRun && !aborted) set({ job: state.job ? { ...state.job, message } : state.job });
      },
      isAborted: () => aborted || run !== renderRun,
    });
    if (run !== renderRun) return;
    if (result.success && result.videoUrl) {
      if (result.operationId) {
        await saveFinishedMotionVideo(prepared.plan, result.videoUrl, result.operationId);
      }
      if (run !== renderRun) return;
      set({
        phase: 'done',
        job: { phase: 'ready', message: 'Your motion video is ready', videoUrl: result.videoUrl, operationId: result.operationId || null, error: null, startedAt: state.job?.startedAt || Date.now() },
      });
    } else {
      set({
        phase: 'preview',
        job: { phase: 'failed', message: 'The render did not complete', videoUrl: null, operationId: result.operationId || null, error: result.error || 'The render failed. Try again.', startedAt: state.job?.startedAt || Date.now() },
      });
    }
  } catch (e: any) {
    if (run !== renderRun) return;
    set({
      phase: 'preview',
      job: { phase: 'failed', message: 'The render did not start', videoUrl: null, operationId: null, error: (e && e.message) || 'Something went wrong.', startedAt: Date.now() },
    });
  }
}

export function cancelRender(): void {
  aborted = true;
  renderRun += 1;
  set({ phase: 'preview', job: state.job ? { ...state.job, phase: 'failed', message: 'Render cancelled', error: null } : null });
}

export function backToPreview(): void {
  set({ phase: 'preview' });
}

export function backToInput(): void {
  set({ phase: 'input' });
}

/** Wipe everything and start a fresh Motion UI project. */
export function resetMotionUi(): void {
  set({ ...EMPTY });
}
