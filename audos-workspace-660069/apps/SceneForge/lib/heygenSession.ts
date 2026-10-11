// The consistency lock.
//
// Character drift is the failure this file exists to prevent. A multi-scene
// video only looks like one film if EVERY generation call carries the same
// avatar, the same brand kit, the same glossary and the same voice — so those
// five ids are held in one place, written once, and read by every call site
// instead of being passed down through component props where one scene can
// quietly disagree with another.
//
// "Locked" here is a real constraint, not a label: `lockAvatar` refuses to
// move an avatar that is already set. Changing it is a separate, explicit
// `replaceAvatar` call, which is what the warning modal in the UI is wired to.
// Nothing in the app can silently override a locked id.
import { useEffect, useState } from 'react';

export type Orientation = 'landscape' | 'portrait';

export interface BrandKitSummary {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  websiteUrl: string;
  fonts: string[];
}

export interface HeyGenSession {
  /** The locked presenter. Every generation call carries this. */
  avatarId: string;
  /** The specific look of that presenter, when the account exposes looks. */
  avatarLookId: string;
  avatarName: string;
  avatarPreviewUrl: string;
  /** How the avatar was obtained — shown on the lock badge. */
  avatarOrigin: 'stock' | 'photo' | 'prompt' | 'cinematic';
  voiceId: string;
  voiceName: string;
  /** True when the voice is this customer's own clone. */
  voiceCloned: boolean;
  brandKitId: string;
  brandKit: BrandKitSummary | null;
  brandGlossaryId: string;
  glossaryTerms: string[];
  orientation: Orientation;
  transparentBackground: boolean;
  cinematicMode: boolean;
  storyboardReview: boolean;
}

export const EMPTY_SESSION: HeyGenSession = {
  avatarId: '',
  avatarLookId: '',
  avatarName: '',
  avatarPreviewUrl: '',
  avatarOrigin: 'stock',
  voiceId: '',
  voiceName: '',
  voiceCloned: false,
  brandKitId: '',
  brandKit: null,
  brandGlossaryId: '',
  glossaryTerms: [],
  orientation: 'portrait',
  transparentBackground: false,
  cinematicMode: false,
  storyboardReview: false,
};

const KEY = 'sceneforge_heygen_session_v1';

function read(): HeyGenSession {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_SESSION;
    const parsed = JSON.parse(raw);
    // Merged onto EMPTY_SESSION so a session stored by an older build gains
    // new fields with safe defaults instead of arriving half-undefined.
    return parsed && typeof parsed === 'object' ? { ...EMPTY_SESSION, ...parsed } : EMPTY_SESSION;
  } catch { return EMPTY_SESSION; }
}
function write(value: HeyGenSession) {
  try { window.localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode — the lock still holds for this tab */ }
}

let session: HeyGenSession = read();
const listeners = new Set<(value: HeyGenSession) => void>();

function commit(next: HeyGenSession) {
  session = next;
  write(next);
  listeners.forEach((listener) => { try { listener(next); } catch { /* a bad listener must not break a render */ } });
}

export function getSession(): HeyGenSession {
  return session;
}

/** Subscribe to lock changes. Returns the unsubscribe function. */
export function subscribe(listener: (value: HeyGenSession) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding: re-renders whenever any locked id changes. */
export function useHeyGenSession(): HeyGenSession {
  const [value, setValue] = useState<HeyGenSession>(session);
  useEffect(() => subscribe(setValue), []);
  return value;
}

export function avatarLocked(): boolean {
  return Boolean(session.avatarId);
}
export function brandLocked(): boolean {
  return Boolean(session.brandKitId);
}

export interface AvatarLock {
  avatarId: string;
  avatarLookId?: string;
  avatarName?: string;
  avatarPreviewUrl?: string;
  origin?: HeyGenSession['avatarOrigin'];
  /** A new avatar usually brings its own default voice. */
  defaultVoiceId?: string;
}

/**
 * Set the presenter for the session. REFUSED when an avatar is already locked
 * and the id differs — the caller must go through `replaceAvatar`, which is
 * only reachable from the warning modal. Re-locking the SAME avatar is a
 * no-op, so an idle re-click never trips the warning.
 */
export function lockAvatar(lock: AvatarLock): boolean {
  if (!lock.avatarId) return false;
  if (session.avatarId && session.avatarId !== lock.avatarId) return false;
  applyAvatar(lock);
  return true;
}

/** Change the locked presenter after the customer confirmed the warning. */
export function replaceAvatar(lock: AvatarLock) {
  applyAvatar(lock);
}

function applyAvatar(lock: AvatarLock) {
  commit({
    ...session,
    avatarId: lock.avatarId,
    avatarLookId: lock.avatarLookId || lock.avatarId,
    avatarName: lock.avatarName || session.avatarName || lock.avatarId,
    avatarPreviewUrl: lock.avatarPreviewUrl ?? session.avatarPreviewUrl,
    avatarOrigin: lock.origin || 'stock',
    // The avatar's own default voice is adopted only when the customer has
    // not chosen or cloned one — a cloned voice outranks any stock default.
    voiceId: session.voiceCloned || session.voiceId ? session.voiceId : (lock.defaultVoiceId || ''),
  });
}

export function setVoice(voiceId: string, voiceName: string, cloned = false) {
  commit({ ...session, voiceId, voiceName, voiceCloned: cloned });
}

export function setBrandKit(kit: BrandKitSummary | null) {
  commit({ ...session, brandKitId: kit?.id || '', brandKit: kit });
}

export function setGlossary(id: string, terms: string[]) {
  commit({ ...session, brandGlossaryId: id, glossaryTerms: terms });
}

export function setOrientation(orientation: Orientation) {
  commit({ ...session, orientation });
}

export function setToggles(patch: Partial<Pick<HeyGenSession, 'transparentBackground' | 'cinematicMode' | 'storyboardReview'>>) {
  commit({ ...session, ...patch });
}

/** Clear every lock — the "start a new character" escape hatch. */
export function resetSession() {
  commit({ ...EMPTY_SESSION });
}

/**
 * The locked ids, shaped for a generation request body. Empty ids are OMITTED
 * rather than sent as '' — `POST v3/video-agents` rejects unknown and empty
 * fields, so an absent brand kit must not appear in the payload at all.
 */
export function lockedFields(options: { includeVoice?: boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (session.avatarId) out.avatar_id = session.avatarId;
  if (session.avatarLookId && session.avatarLookId !== session.avatarId) out.avatar_look_id = session.avatarLookId;
  // An audio-driven request must carry the finished track INSTEAD OF a
  // `voice_id`. Sending both asks HeyGen to use two mutually exclusive voice
  // sources and turns an otherwise valid capability probe into a schema 400.
  if (options.includeVoice !== false && session.voiceId) out.voice_id = session.voiceId;
  if (session.brandKitId) out.brand_kit_id = session.brandKitId;
  if (session.brandGlossaryId) out.brand_glossary_id = session.brandGlossaryId;
  return out;
}

/** Plain-language list of what is currently locked, for the lock badge. */
export function lockSummary(): string[] {
  const out: string[] = [];
  if (session.avatarId) out.push(`Character: ${session.avatarName || session.avatarId}`);
  if (session.voiceId) out.push(`Voice: ${session.voiceName || session.voiceId}${session.voiceCloned ? ' (your clone)' : ''}`);
  if (session.brandKitId) out.push(`Brand: ${session.brandKit?.name || 'imported kit'}`);
  if (session.brandGlossaryId) out.push(`Glossary: ${session.glossaryTerms.length} term${session.glossaryTerms.length === 1 ? '' : 's'}`);
  return out;
}
