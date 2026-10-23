/**
 * SceneForge (Oct 2026 rebuild) — shared client types and catalogs.
 *
 * The product: long HeyGen avatar videos with ElevenLabs sound, then
 * post-production — voice-synced motion graphics written by an expert Remotion
 * coder agent, meaningful Veo 3.1 Fast B-roll in between, ElevenLabs music and
 * SFX — delivered as BOTH 16:9 and a native 9:16 layout from ONE set of
 * choices made before generation.
 */

export type ForgeStatus =
  | 'draft'
  | 'voicing'
  | 'avatar'
  | 'transcribe'
  | 'direct'
  | 'assets'
  | 'code'
  | 'drafts'
  | 'draft_pick'
  | 'final_render'
  | 'portrait_finish'
  | 'done'
  | 'failed';

export interface ForgeChunk {
  i: number;
  has_audio: boolean;
  audio_url: string | null;
  video_id?: string | null;
  video_url: string | null;
  duration_sec: number;
  gesture: string | null;
  emotion: string | null;
  error?: string | null;
}

export interface ForgeDraft {
  variation: number;
  label: string;
  operation_id?: string;
  video_url?: string | null;
  status: string;
  error?: string | null;
  scrapped?: boolean;
}

export interface ForgeChoices {
  voiceId?: string;
  voiceName?: string;
  avatarId?: string;
  avatarName?: string;
  style?: string;
  niche?: string;
  musicMood?: string;
  brollAmount?: 'none' | 'light' | 'medium' | 'rich';
  transparentBg?: boolean;
  transparent_fallback?: boolean;
  bgColor?: string;
  avatarGestures?: string[];
  avatarEmotions?: string[];
  avatar_script?: Array<{ text: string; emotion: string; gesture: string; startSec?: number; endSec?: number }>;
}

export interface ForgeProject {
  id: string;
  status: ForgeStatus;
  stage_note: string | null;
  topic: string;
  niche: string | null;
  style: string | null;
  script: string | null;
  studio_config: ForgeChoices;
  target_length_sec: number;
  estimated_duration_sec: number | null;
  avatar_duration_sec: number | null;
  heygen_video_url: string | null;
  heygen_chunks: ForgeChunk[];
  word_count: number;
  director_plan: any;
  drafts: ForgeDraft[] | null;
  chosen_draft: number | null;
  coder_model: string | null;
  music_url: string | null;
  final_video_url: string | null;
  portrait_video_url: string | null;
  charged_seconds: number | null;
  failed_step?: string | null;
  review_step?: string | null;
  approved_steps?: Record<string, { approved_at: string }>;
  portrait_preview_url?: string | null;
  created_at: string;
  updated_at: string;
}

/** The style picker — professional motion-graphics looks per the founder's spec. */
export const FORGE_STYLES: Array<{ id: string; name: string; blurb: string }> = [
  { id: 'doc', name: 'Doc', blurb: 'Archival documentary — serif headlines, paper-texture cards, quote plates, datelines.' },
  { id: 'tech', name: 'Tech', blurb: 'Product-grade SaaS motion — crisp type, thin-line UI frames, glowing accents, stat cards.' },
  { id: 'crime', name: 'Crime', blurb: 'True-crime noir — high-contrast red/black, evidence tags, typewriter captions.' },
  { id: 'vox', name: 'Vox', blurb: 'Editorial explainer — highlighter sweeps on key words, big counters, clean charts.' },
  { id: 'br', name: 'BR', blurb: 'B-roll led — minimal graphics; meaningful full-frame footage carries the story.' },
  { id: 'modern', name: 'Modern', blurb: 'Fashionable kinetic type — oversized voice-synced words, split layouts, spring motion.' },
];

export const MUSIC_MOODS = ['confident', 'inspiring', 'dramatic', 'calm', 'energetic', 'dark', 'playful', 'cinematic'];

export const BROLL_AMOUNTS: Array<{ id: 'none' | 'light' | 'medium' | 'rich'; name: string; blurb: string }> = [
  { id: 'none', name: 'None', blurb: 'Avatar + graphics only' },
  { id: 'light', name: 'A few', blurb: '~2 meaningful inserts' },
  { id: 'medium', name: 'Some', blurb: '~3 inserts' },
  { id: 'rich', name: 'Rich', blurb: 'Up to 5 inserts' },
];

/** HeyGen avatar entry as the picker uses it. */
export interface ForgeAvatar {
  id: string;
  name: string;
  gender: string;
  age: string;
  region: string;
  ethnicity: string;
  style: string;
  category: string;
  description: string;
  tags: string[];
  previewImage: string;
  previewVideo: string;
  gestures: string[];
  emotions: string[];
  supportedEngines: string[];
}

/** Avatars bundled by presenter name — the different looks of one person grouped together. */
export interface ForgeAvatarBundle {
  key: string;
  name: string;
  looks: ForgeAvatar[];
}
