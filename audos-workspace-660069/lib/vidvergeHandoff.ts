export const VIDVERGE_HANDOFF_KEY = 'vidverge_agent_handoff_v1';

export interface VidvergeAttachment {
  url: string;
  name: string;
  type: string;
}

export interface ScriptToVideoHandoff {
  schemaVersion: 'vergeye.s2v-handoff.v1';
  source: 'vergeye-ads-studio';
  campaignId: string;
  originatingAngleId: string;
  creativeBrief: unknown;
  generatedScript: string;
  styleId: string;
  styleConfiguration: Record<string, unknown>;
  brandKit: Record<string, unknown>;
  campaignReferences: string[];
  routerMode: 'automatic' | 'manual' | 'hybrid';
  recommendedModel: string;
  routingReason: string;
  aspectRatio: '16:9' | '9:16';
  durationSeconds: number;
  storyboardRequired: boolean;
  claimReview: 'clear' | 'needs_human_review';
  productionNotes: string[];
}

export interface VidvergeHandoff {
  version: 1 | 2;
  appId: string;
  prompt?: string;
  attachment?: VidvergeAttachment | null;
  projectId?: string | number;
  /** Optional named surface inside a multi-surface studio. */
  surface?: 'director';
  /** Native Audos video integration slug for the target studio. */
  videoIntegration?: string;
  /** Model id within that integration (Group A string, kling-*, runway id, etc.). */
  videoModel?: string;
  /** Structured Vergeye Phase 3 intake for the shared five-stage engine. */
  scriptToVideo?: ScriptToVideoHandoff;
  ts: number;
}

const MAX_AGE_MS = 30 * 60 * 1000;

export function saveVidvergeHandoff(handoff: Omit<VidvergeHandoff, 'version' | 'ts'>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VIDVERGE_HANDOFF_KEY, JSON.stringify({ ...handoff, version: 2, ts: Date.now() }));
}

export function consumeVidvergeHandoff(appId: string): VidvergeHandoff | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(VIDVERGE_HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as VidvergeHandoff;
    if (!value || (value.version !== 1 && value.version !== 2) || value.appId !== appId || !value.ts || Date.now() - value.ts > MAX_AGE_MS) {
      if (!value?.ts || Date.now() - Number(value.ts) > MAX_AGE_MS) window.localStorage.removeItem(VIDVERGE_HANDOFF_KEY);
      return null;
    }
    window.localStorage.removeItem(VIDVERGE_HANDOFF_KEY);
    return value;
  } catch {
    window.localStorage.removeItem(VIDVERGE_HANDOFF_KEY);
    return null;
  }
}

export function openVidvergeStudio(appId: string): void {
  window.dispatchEvent(new CustomEvent('openApp', { detail: { appId } }));
}
