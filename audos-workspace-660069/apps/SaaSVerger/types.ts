export type ProductTone = 'enterprise' | 'startup' | 'creator' | 'dev-tool';

export type ProductIdentity = {
  name: string;
  tagline: string;
  primaryColor: string;
  secondaryColor: string;
  bgColor: string;
  features: string[];
  ctaText: string;
  tone: ProductTone;
  targetUser: string;
};

export type ScreenKey = 'screen1' | 'screen2' | 'screen3' | 'cta';

export type SceneVisualKind = 'image' | 'video';

/** The visual a scene is locked to, denormalised so a persisted script can be
 * reopened without the in-memory asset pool. */
export type SceneVisual = {
  assetId: string;
  name: string;
  kind: SceneVisualKind;
  previewUrl: string;
  url: string | null;
};

export type ScriptAct = {
  text: string;
  durationSeconds: number;
  screenKey: ScreenKey;
  narration?: string;
  visual?: SceneVisual | null;
};

export type Script = {
  acts: ScriptAct[];
  fullText: string;
  totalSeconds: number;
};

/** A screenshot, image or clip the narration can be matched against: either a
 * browser upload (public URL minted at render time) or a workspace library clip. */
export type VisualAsset = {
  id: string;
  name: string;
  kind: SceneVisualKind;
  source: 'upload' | 'library';
  previewUrl: string;
  url: string | null;
  description: string;
  tags: string;
  file?: File | null;
};

export type VisualMatch = {
  asset: VisualAsset;
  score: number;
  matched: string[];
};

export type SceneAudio = {
  audioUrl: string;
  durationMs: number;
};

export type PipelineStage = 'analyzing' | 'scripting' | 'voiceover' | 'mockups' | 'rendering';
export type StageState = 'pending' | 'active' | 'done' | 'error' | 'skipped';

/** One step that did not finish. Collected during a run and shown in the
 * completion summary instead of being swallowed. */
export type StageFailure = {
  stage: PipelineStage;
  message: string;
  at: string;
};

export type SaaSProject = {
  id: number;
  url: string;
  product_identity: ProductIdentity | null;
  script: Script | null;
  render_url: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  /** Optional customer-pasted script — overrides the auto-written narration. */
  script_text?: string | null;
  /** Optional uploaded voiceover — used instead of generated narration. */
  voiceover_url?: string | null;
  /** Optional B-roll screenshots published for this run. */
  screenshot_urls?: string[] | null;
  /** Per-stage progress, written after every completed step so a reopened run
   * can be resumed instead of restarted. */
  stage_state?: Partial<Record<PipelineStage, StageState>> | null;
  /** Steps that failed during the run, surfaced after it finishes. */
  stage_errors?: StageFailure[] | null;
};
