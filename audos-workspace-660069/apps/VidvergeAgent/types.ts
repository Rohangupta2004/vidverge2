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
  progress: number;
  app: string;
  appId: string;
  state: 'active' | 'waiting' | 'completed' | 'failed';
  updatedAt: string;
}

/** The six studios a brief can be routed to. Mirrors the app registry in config.json. */
export const TARGET_APPS: TargetApp[] = [
  { id: 'sceneforge', name: 'SceneForge', tagline: 'Avatar films + motion graphics' },
  { id: 'faceless-content', name: 'Faceless Content', tagline: 'Faceless long-form for YouTube' },
  { id: 'script-to-video', name: 'Script-to-Video', tagline: 'Your script, shot for shot' },
  { id: 'saas-verger', name: 'SaaS Verger', tagline: 'One URL, one product video' },
  { id: 'video-enhancer', name: 'Video Enhancer', tagline: 'Edit and enhance footage' },
  { id: 'ads-studio', name: 'Ads Studio', tagline: 'Short-form ads and recipes' },
];

export const IDLE_STATUS = 'Ready to create';
