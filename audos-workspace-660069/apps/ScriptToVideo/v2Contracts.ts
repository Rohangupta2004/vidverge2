import type { Aspect, ReferenceAsset } from './api';

/** V2 uses the connected adapter contracts as evidence, never marketing limits. */
export const S2V_CAPABILITY_REGISTRY_VERSION = '2026-10-22.1';

export type VideoOperation = 'generate' | 'edit-existing';
export type JobPattern = 'async-poll';
export type CapabilityEvidence = 'live-adapter-and-test' | 'live-adapter' | 'catalog-only';

export interface VideoCapability {
  key: string;
  modelId: string;
  label: string;
  operation: VideoOperation;
  minDurationSec: number;
  maxDurationSec: number;
  durationStepSec: number | null;
  supportedDurations?: number[];
  maxReferences: number;
  referenceTypes: Array<'first-frame' | 'last-frame' | 'asset' | 'source-video'>;
  maxReferenceBytes: number | null;
  aspectRatios: Aspect[];
  resolutions: string[];
  nativeAudio: boolean;
  firstFrame: boolean;
  lastFrame: boolean;
  /** Continuity input selected deterministically for scene N>1. */
  continuityMode: 'video-reference' | 'last-frame' | 'none';
  /** Prompt Director adapter family. */
  promptFamily: 'seedance-2.5' | 'kling-3' | 'generic';
  supportsNegativePrompt: boolean;
  editWindowSec: number | null;
  jobPattern: JobPattern;
  price: { kind: 'per-second' | 'usage-receipt'; usdPerSecond?: number; note: string };
  latency: string;
  available: boolean;
  evidence: CapabilityEvidence;
  notes: string[];
}

export const S2V_VIDEO_CAPABILITIES: VideoCapability[] = [
  {
    key: 'seedance-2.5:generate', modelId: 'openrouter/bytedance/seedance-2.5', label: 'Seedance 2.5', operation: 'generate',
    minDurationSec: 4, maxDurationSec: 30, durationStepSec: 1, maxReferences: 3,
    referenceTypes: ['first-frame', 'last-frame', 'asset'], maxReferenceBytes: 10_000_000,
    aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['480p', '720p'], nativeAudio: true,
    firstFrame: true, lastFrame: true, continuityMode: 'last-frame', promptFamily: 'seedance-2.5', supportsNegativePrompt: false, editWindowSec: null, jobPattern: 'async-poll',
    price: { kind: 'usage-receipt', note: 'OpenRouter usage.cost is authoritative; the admission estimate is shown before approval.' },
    latency: 'Often several minutes; no fixed ETA is promised.', available: true, evidence: 'live-adapter-and-test',
    notes: ['Frames and asset references cannot be combined.', 'Every integer duration from 4 through 30 is legal.'],
  },
  {
    key: 'seedance-2.0-fast:generate', modelId: 'openrouter/bytedance/seedance-2.0-fast', label: 'Seedance 2.0 Fast', operation: 'generate',
    minDurationSec: 4, maxDurationSec: 8, durationStepSec: 1, maxReferences: 1,
    referenceTypes: ['first-frame'], maxReferenceBytes: 10_000_000,
    aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['720p'], nativeAudio: false,
    firstFrame: true, lastFrame: false, continuityMode: 'last-frame', promptFamily: 'generic', supportsNegativePrompt: true, editWindowSec: null, jobPattern: 'async-poll',
    price: { kind: 'usage-receipt', note: 'Provider receipt is authoritative.' }, latency: 'Fast draft route; no fixed ETA.',
    available: true, evidence: 'live-adapter-and-test', notes: ['This is Fast, not Seedance 2.0 Standard.', 'Three real 10s requests in film #68 each produced 8.041667s; 8s is the measured planning ceiling until the adapter proves longer output.'],
  },
  {
    key: 'kling-3.0-omni:generate', modelId: 'kling-3.0-omni', label: 'Kling 3.0 Omni', operation: 'generate',
    minDurationSec: 5, maxDurationSec: 10, durationStepSec: null, supportedDurations: [5, 10], maxReferences: 4,
    referenceTypes: ['first-frame', 'last-frame', 'asset'], maxReferenceBytes: null,
    aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['720p', '1080p'], nativeAudio: false,
    firstFrame: true, lastFrame: true, continuityMode: 'last-frame', promptFamily: 'kling-3', supportsNegativePrompt: false, editWindowSec: null, jobPattern: 'async-poll',
    price: { kind: 'per-second', usdPerSecond: 0.084, note: 'Standard 720p price; provider receipt is authoritative.' },
    latency: 'Asynchronous provider job; no fixed ETA.', available: true, evidence: 'live-adapter-and-test',
    notes: ['The connected proxy is silent and accepts only 5s or 10s.', 'Multi-image accepts 2–4 asset references.'],
  },
  {
    key: 'kling-3.0:generate', modelId: 'kling-3.0', label: 'Kling 3.0', operation: 'generate',
    minDurationSec: 5, maxDurationSec: 10, durationStepSec: null, supportedDurations: [5, 10], maxReferences: 1,
    referenceTypes: ['first-frame', 'last-frame'], maxReferenceBytes: null,
    aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['720p', '1080p'], nativeAudio: false,
    firstFrame: true, lastFrame: true, continuityMode: 'last-frame', promptFamily: 'kling-3', supportsNegativePrompt: true, editWindowSec: null, jobPattern: 'async-poll',
    price: { kind: 'per-second', usdPerSecond: 0.084, note: 'Standard 720p price; provider receipt is authoritative.' },
    latency: 'Asynchronous provider job; no fixed ETA.', available: true, evidence: 'live-adapter',
    notes: ['The connected proxy is silent and accepts only 5s or 10s.'],
  },
  {
    key: 'omni-1.1-flash:generate', modelId: 'gemini-omni-1.1-flash', label: 'Gemini Omni 1.1 Flash', operation: 'generate',
    minDurationSec: 2, maxDurationSec: 8, durationStepSec: 1, maxReferences: 10,
    referenceTypes: ['first-frame', 'last-frame', 'asset'], maxReferenceBytes: 10_000_000,
    aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['720p'], nativeAudio: true,
    firstFrame: true, lastFrame: true, continuityMode: 'last-frame', promptFamily: 'generic', supportsNegativePrompt: true, editWindowSec: null, jobPattern: 'async-poll',
    price: { kind: 'usage-receipt', note: 'Wallet/provider receipt is authoritative.' },
    latency: 'Usually shorter than premium long-form routes; no fixed ETA.', available: true, evidence: 'live-adapter-and-test',
    notes: ['Seed plus asset references may be combined.', 'Generation and existing-video edit are separate capabilities.'],
  },
  {
    key: 'omni-1.1-flash:edit-existing', modelId: 'gemini-omni-1.1-flash', label: 'Gemini Omni 1.1 Flash AI Edit', operation: 'edit-existing',
    minDurationSec: 2, maxDurationSec: 8, durationStepSec: 1, maxReferences: 1,
    referenceTypes: ['source-video'], maxReferenceBytes: null,
    aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['720p'], nativeAudio: true,
    firstFrame: false, lastFrame: false, continuityMode: 'video-reference', promptFamily: 'generic', supportsNegativePrompt: true, editWindowSec: 8, jobPattern: 'async-poll',
    price: { kind: 'usage-receipt', note: 'Billable AI edit; provider receipt is authoritative.' },
    latency: 'Asynchronous edit job; no fixed ETA.', available: true, evidence: 'live-adapter-and-test',
    notes: ['The working adapter accepts an existing source video only up to 8s.', 'Longer clips are trimmed, edited, then spliced with the untouched remainder.'],
  },
];

export function capabilityFor(modelId: string, operation: VideoOperation = 'generate'): VideoCapability | null {
  const key = String(modelId || '');
  return S2V_VIDEO_CAPABILITIES.find((item) => item.operation === operation && (item.modelId === key || item.key.startsWith(`${key}:`) || (key === 'seedance-2.5' && item.modelId.endsWith('/seedance-2.5')) || (key === 'omni-1.1-flash' && item.modelId === 'gemini-omni-1.1-flash'))) || null;
}

export const VIDEO_STYLE_PRESETS = [
  ['cinematic-live-action', 'Cinematic Live Action', 'cinematic live action, motivated camera, natural performances, controlled filmic contrast'],
  ['photoreal-commercial', 'Photorealistic / Commercial', 'photoreal premium commercial, precise product light, crisp materials, polished camera movement'],
  ['3d-animation', '3D Animation', 'stylized high-end 3D animation, dimensional lighting, expressive materials, physically coherent motion'],
  ['2d-animation', '2D Animation', 'clean authored 2D animation, graphic shapes, expressive poses, consistent line and color design'],
  ['anime', 'Anime', 'cinematic anime, expressive character acting, controlled linework, dynamic composition and lighting'],
  ['hand-drawn-sketch', 'Hand-Drawn Sketch', 'hand-drawn sketch animation, tactile pencil and ink texture, deliberate imperfect line movement'],
  ['motion-graphics', 'Motion Graphics', 'bold motion-graphics language, precise composition, kinetic geometry, readable visual hierarchy'],
  ['documentary-natural', 'Documentary / Natural Camera', 'observational documentary, available light, natural camera, honest human detail'],
  ['comic-graphic-novel', 'Comic / Graphic Novel', 'graphic-novel panels in motion, bold inks, halftone texture, dramatic framing'],
  ['watercolor-painterly', 'Watercolor / Painterly Illustration', 'watercolor and painterly illustration, visible pigment, soft edge blooms, restrained organic motion'],
] as const;

export type VideoStyleId = typeof VIDEO_STYLE_PRESETS[number][0] | 'custom';
export function styleDirection(style: VideoStyleId, custom = ''): string {
  if (style === 'custom') return String(custom || '').trim();
  return VIDEO_STYLE_PRESETS.find((item) => item[0] === style)?.[2] || VIDEO_STYLE_PRESETS[0][2];
}

export type AudioPolicy = 'native-dialogue-effects' | 'narration-voiceover' | 'music-ambience' | 'no-narration' | 'fully-silent';
export const AUDIO_POLICIES: Array<{ id: AudioPolicy; label: string; description: string }> = [
  { id: 'native-dialogue-effects', label: 'Native dialogue + effects', description: 'Keep model-native speech, lip sync, ambience and effects.' },
  { id: 'narration-voiceover', label: 'Narration / voiceover', description: 'Add one consistent narrator while preserving scene ambience.' },
  { id: 'music-ambience', label: 'Music / ambience', description: 'No narrator; keep supported ambience and add a music bed.' },
  { id: 'no-narration', label: 'No narration', description: 'No narrator. Native character speech and effects are still allowed.' },
  { id: 'fully-silent', label: 'Fully silent', description: 'Generate and export with all audio removed.' },
];

export function audioPolicyFlags(policy: AudioPolicy) {
  return {
    audioEnabled: policy !== 'fully-silent',
    narrationEnabled: policy === 'narration-voiceover',
    charactersSpeak: policy === 'native-dialogue-effects' || policy === 'no-narration',
    musicEnabled: policy === 'music-ambience' || policy === 'narration-voiceover' || policy === 'native-dialogue-effects',
  };
}

export type OrchestratorIntent = 'create' | 'refine' | 'override' | 'plan' | 'generate' | 'edit' | 'retry' | 'approve' | 'cancel' | 'export';
export type ProjectState = 'draft' | 'analyzing' | 'planning' | 'assets_preparing' | 'storyboard_ready' | 'awaiting_approval' | 'auto_authorized' | 'queued' | 'generating' | 'assembling' | 'quality_review' | 'ready' | 'optional_editing' | 'rendering' | 'exported' | 'blocked' | 'failed' | 'cancelled' | 'resumable';
export type ControlMode = 'agentic' | 'manual';
export type EntryType = 'idea' | 'script';
export type ExecutionMode = 'review' | 'automatic';

export interface LongFormSection {
  id: string;
  index: number;
  title: string;
  startSec: number;
  endSec: number;
  targetDurationSec: number;
  clipIndexes: number[];
  status: 'waiting' | 'active' | 'complete' | 'failed' | 'paused';
  summary: string;
}

export function buildLongFormSections(totalSec: number, clipDurations: number[]): LongFormSection[] {
  const total = Math.max(1, Math.min(1800, Math.round(totalSec || 0)));
  const sectionTarget = total > 600 ? 300 : total > 120 ? 120 : total;
  const sections: LongFormSection[] = [];
  let start = 0;
  let clipCursor = 0;
  while (start < total) {
    const end = Math.min(total, start + sectionTarget);
    const indexes: number[] = [];
    let sectionCursor = start;
    while (clipCursor < clipDurations.length && sectionCursor < end) {
      indexes.push(clipCursor);
      sectionCursor += Number(clipDurations[clipCursor]) || 0;
      clipCursor += 1;
    }
    sections.push({ id: `section_${sections.length + 1}`, index: sections.length, title: `Section ${sections.length + 1}`, startSec: start, endSec: end, targetDurationSec: end - start, clipIndexes: indexes, status: 'waiting', summary: '' });
    start = end;
  }
  return sections;
}

export interface RankedReferences {
  included: ReferenceAsset[];
  excludedOptional: ReferenceAsset[];
  criticalOverflow: ReferenceAsset[];
}

export const REFERENCE_SCORE: Record<string, number> = {
  'continuity-frame': 600,
  character: 500,
  product: 400,
  environment: 200,
  style: 100,
  storyboard: 0,
};

/** Continuity always leads. Character inputs are limited to one best sheet per
 * on-screen character before the provider cap is applied; lower roles then
 * fall off from style upward. Array order is the tie-breaker so the stored
 * proof exactly matches the payload order. */
export function rankReferences(assets: ReferenceAsset[], max: number): RankedReferences {
  const candidates = (assets || []).filter((asset) => !asset.storyboardOnly && asset.type !== 'storyboard');
  const seenCharacters = new Set<string>();
  const deduped = candidates.filter((asset) => {
    if (asset.type !== 'character') return true;
    const key = String(asset.characterId || asset.label || asset.url || '').trim();
    if (!key || seenCharacters.has(key)) return false;
    seenCharacters.add(key);
    return true;
  });
  const sorted = deduped
    .map((asset, index) => ({ asset, index }))
    .sort((a, b) => {
      const scoreA = REFERENCE_SCORE[a.asset.type || 'style'] || 0;
      const scoreB = REFERENCE_SCORE[b.asset.type || 'style'] || 0;
      return scoreB - scoreA || a.index - b.index;
    })
    .map(({ asset }) => asset);
  const included = sorted.slice(0, Math.max(0, max));
  const excluded = sorted.slice(Math.max(0, max));
  return {
    included,
    excludedOptional: excluded.filter((asset) => !asset.critical),
    criticalOverflow: excluded.filter((asset) => asset.critical),
  };
}

export function parseDurationInput(minutes: number, seconds: number): number {
  const total = Math.round(Math.max(0, minutes || 0) * 60 + Math.max(0, seconds || 0));
  if (total < 2) throw new Error('Choose at least 2 seconds.');
  if (total > 1800) throw new Error('The maximum assembled project duration is 30:00.');
  return total;
}

export function formatDuration(totalSec: number): string {
  const total = Math.max(0, Math.round(totalSec || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
