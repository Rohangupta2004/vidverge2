export type ImageStyle = 'Cinematic' | 'Minimalist' | 'Bold' | 'Neon' | 'Corporate';

export type OverlayType = 'seedance_motion' | 'static_image' | 'text_fact' | 'comparison_card';
export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'sidebar-left' | 'sidebar-right';

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TranscriptResult {
  words: TranscriptWord[];
  language: string;
  fullText: string;
  duration: number;
}

export interface Cut {
  start: number;
  end: number;
  label: string;
}

export interface ComparisonItem {
  id: string;
  label: string;
  value: string;
  highlight: boolean;
}

export interface Overlay {
  id: string;
  type: OverlayType;
  startSec: number;
  durationSec: number;
  position: OverlayPosition;
  imagePrompt: string | null;
  textContent: string | null;
  motionPrompt: string | null;
  items: ComparisonItem[] | null;
  imageUrl?: string;
  videoUrl?: string;
}

export interface EditPlan {
  cuts: Cut[];
  overlays: Overlay[];
}

export type WorkflowView = 'input' | 'analyzing' | 'review' | 'generating' | 'result';
export type PipelineStepId = 'transcribe' | 'plan' | 'images' | 'motion' | 'render';
export type PipelineStepStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  status: PipelineStepStatus;
  detail?: string;
}

export interface RenderInput {
  heygenVideoUrl: string;
  aspectRatio: '16:9' | '9:16';
  duration: number;
  overlays: Overlay[];
}
