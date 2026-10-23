export type AgentState = 'idle' | 'working' | 'completed' | 'error';

export interface TargetApp {
  id: string;
  name: string;
  tagline: string;
}

export interface QueueJob {
  id: string;
  projectId: string | number;
  name: string;
  stage: string;
  app: string;
  appId: string;
  surface?: 'director';
  state: 'active' | 'waiting' | 'completed' | 'failed';
  updatedAt: string;
}

/** Visible studios a brief can be routed to. Navigation-hidden apps remain
 * registered in config.json but are deliberately absent from this launcher. */
export const TARGET_APPS: TargetApp[] = [
  { id: 'sceneforge', name: 'SceneForge', tagline: 'Presenter, voice and script' },
  { id: 'script-to-video', name: 'Script-to-Video', tagline: 'Your script, shot for shot' },
  { id: 'faceless', name: 'Faceless', tagline: 'Narration-led film, no presenter' },
  { id: 'video-enhancer', name: 'Video Enhancer', tagline: 'Edit and enhance footage you shot' },
  { id: 'ads-studio', name: 'Vergeye Ads Studio', tagline: 'Brand research through to an ad' },
];

/**
 * Registered studios Verger does NOT route a brief to yet, and why. Keeping
 * this explicit stops the list above from quietly growing a target that opens
 * the studio but drops the brief on the floor.
 *
 * - 'cineagent' (Studio): no consumeVidvergeHandoff call, so a routed brief
 *   would be discarded. Video Enhancer covers the same "edit my footage"
 *   intent and does accept the handoff.
 * - 'brand-context' (Brand Kit): a setup surface, not a generation workflow.
 */
export const UNROUTED_APP_IDS = ['cineagent', 'brand-context'] as const;

export const IDLE_STATUS = 'Ready to create';
