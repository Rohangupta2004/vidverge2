// SESSION PERSISTENCE for the Director.
//
// A film is expensive to assemble — an LLM plan, a paid narration render and
// a paid composition render — so losing it to a refresh would be the worst
// kind of bug. This cache makes the current film instant to restore; the
// WorkspaceDB mirror in directorStore.ts is the durable system of record.
import { WORKSPACE_ID } from './supabase';
import type { SceneSpec } from './sceneSpec';
import type { CustomVoice } from './directorNarration';
import type { HeyGenApiVersion } from './heygenStudio';

export type ImagePreference = 'stock' | 'generated';

export interface DirectorSession {
  filmId: number | null;
  ownerKey: string;
  title: string;
  script: string;
  notes: string;
  avatarId: string;
  avatarName: string;
  voiceId: string;
  voiceName: string;
  speed: number;
  useCustomVoice: boolean;
  customVoice: CustomVoice | null;
  accent: string;
  imageSource: ImagePreference;
  specs: SceneSpec[];
  narrationVideoId: string;
  narrationApi: HeyGenApiVersion | '';
  narrationUrl: string;
  narrationSec: number;
  renderOperationId: string;
  filmUrl: string;
  status: 'draft' | 'analyzing' | 'narrating' | 'assets' | 'rendering' | 'done' | 'failed';
  updatedAt: string;
}

export const EMPTY_SESSION: DirectorSession = {
  filmId: null,
  ownerKey: '',
  title: '',
  script: '',
  notes: '',
  avatarId: '',
  avatarName: '',
  voiceId: '',
  voiceName: '',
  speed: 1,
  useCustomVoice: false,
  customVoice: null,
  accent: '#4FC3F7',
  imageSource: 'stock',
  specs: [],
  narrationVideoId: '',
  narrationApi: '',
  narrationUrl: '',
  narrationSec: 0,
  renderOperationId: '',
  filmUrl: '',
  status: 'draft',
  updatedAt: '',
};

const KEY = `sceneforge_director_v1:${WORKSPACE_ID}`;

export function loadSession(): DirectorSession {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_SESSION };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_SESSION };
    return { ...EMPTY_SESSION, ...parsed, specs: Array.isArray(parsed.specs) ? parsed.specs : [] };
  } catch {
    return { ...EMPTY_SESSION };
  }
}

export function saveSession(session: DirectorSession): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...session, updatedAt: new Date().toISOString() }));
  } catch {
    // Private mode or a full quota. The session still works for this tab; it
    // simply will not survive a reload, which is better than throwing.
  }
}

export function clearSession(): void {
  try { window.localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Replace one scene in a plan, keeping the rest untouched. */
export function replaceSpec(specs: SceneSpec[], scene: number, patch: Partial<SceneSpec>): SceneSpec[] {
  return specs.map((spec) => (spec.scene === scene ? { ...spec, ...patch, visual: { ...spec.visual, ...(patch.visual || {}) } } : spec));
}
