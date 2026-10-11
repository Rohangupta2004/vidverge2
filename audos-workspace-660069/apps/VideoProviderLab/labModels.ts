/**
 * VIDEO PROVIDER LAB — the model catalog.
 *
 * Every entry below is one selectable row in the lab's model grid, and every
 * `modelId` is the EXACT string the platform proxy accepts — a typo answers
 * 400 rather than falling back. The Kling, Higgsfield and native Runway
 * rosters plus most Group A entries are DERIVED from lib/videoEngines.ts. The
 * two OpenRouter-hosted Runway ids are lab-local because this app reaches them
 * through the unified proxy rather than the native Runway route. This file adds
 * the facts the lab itself needs: which platform plugin powers an entry, which
 * parameters it accepts, how many images it takes, and how long to wait.
 *
 * AVAILABILITY IS HONEST. An entry the platform cannot run ships
 * `available: false` with the reason and a working alternative instead of
 * being offered as a choice that only buys a 400 at submit time. That is why
 * Luma Dream Machine and Pika appear greyed out, and why the Runway roster
 * entries the proxy does not list stay disabled.
 *
 * LAST VERIFIED 9 Oct 2026 by a live end-to-end sweep (one minimal paid
 * generation per entry, 4s / 720p / audio off, prompt "A red ball bouncing on
 * a white floor."). Every outcome is recorded in LAB_VERIFIED at the bottom of
 * this file and shown on the cards, so the grid states what the platform
 * actually did rather than what it is documented to do. Three ids turned out
 * to be rejected outright by the proxy's model enum and are now disabled:
 * openrouter/bytedance/seedance-2.5-fast, runwayml/gen3a-turbo and
 * runwayml/gen4-turbo.
 *
 * Provider contracts, read from the platform integration docs:
 *   image-and-video-generation  POST /api/veo/generate/video    -> GET /api/veo/status/:operationId
 *   google-veo3 (managed)       POST /api/generate/video        -> GET /api/veo/status/:operationId
 *   kling-video                 POST /api/generate/kling/{text-to-video,image-to-video,multi-image}
 *                                                               -> GET /api/generate/kling/status/:taskId
 *   higgsfield-media            POST /api/generate/higgsfield/{video,image-to-video}
 *                                                               -> GET /api/generate/higgsfield/status/:requestId
 *   heygen-video                POST …/heygen/proxy/v3/{videos,video-agents}
 *                                                               -> GET …/heygen/proxy/v3/videos/:videoId
 *   runway-recipes              POST /api/generate/runway/video -> GET /api/generate/runway/status/:taskId
 */

import {
  GROUP_A_MODELS,
  KLING_MODELS,
  HIGGSFIELD_VIDEO_MODELS,
  RUNWAY_MODELS,
} from '../../lib/videoEngines';
import type { GroupAModel, KlingModel, HiggsfieldVideoModel, RunwayModel } from '../../lib/videoEngines';

/** The installed platform plugin an entry is powered by. */
export type LabPlugin =
  | 'image-and-video-generation'
  | 'google-veo3'
  | 'kling-video'
  | 'higgsfield-media'
  | 'heygen-video'
  | 'runway-recipes';

/** Which submit/poll pair in labClient.ts drives the entry. */
export type LabRunner =
  | 'group-a'
  | 'veo-managed'
  | 'kling'
  | 'higgsfield-text'
  | 'higgsfield-image'
  | 'heygen-avatar'
  | 'heygen-agent'
  | 'runway'
  | 'unavailable';

export type LabGroupId =
  | 'bytedance' | 'google' | 'openai' | 'kling' | 'higgsfield' | 'heygen' | 'runway' | 'missing';

/** 'multi' = 0 images runs text-to-video, 1 animates it, 2+ uses the
 *  multi-image/reference path where the model has one. */
export type LabImageMode = 'none' | 'optional' | 'required' | 'multi';

export interface LabGroup {
  id: LabGroupId;
  label: string;
  note: string;
}

export const LAB_GROUPS: LabGroup[] = [
  { id: 'bytedance', label: 'ByteDance · Seedance', note: 'OpenRouter-hosted Seedance on the unified video proxy.' },
  { id: 'google', label: 'Google · Veo & Gemini', note: 'Veo 3.1 / 3.0 / 2.0, the OpenRouter Veo variants, and Gemini Omni Flash.' },
  { id: 'openai', label: 'OpenAI · Sora', note: 'Sora 2 and Sora 2 Pro through the same schema-validated proxy.' },
  { id: 'kling', label: 'Kling AI', note: 'Text-to-video, image-to-video and Elements, plus extend and lip-sync on a finished clip.' },
  { id: 'higgsfield', label: 'Higgsfield · MiniMax', note: 'MiniMax Hailuo 02 text-to-video and the DoP camera-motion image-to-video models.' },
  { id: 'heygen', label: 'HeyGen', note: 'Avatar-led renders and the prompt-driven Video Agent.' },
  { id: 'runway', label: 'Runway (OpenRouter + native)', note: 'Gen-3 Alpha Turbo and Gen-4 Turbo use the unified OpenRouter proxy; Gen 4.5 and native Gen 4 Turbo use the Runway proxy.' },
  { id: 'missing', label: 'Requested, but not on this platform', note: 'No platform route exists for these, so the lab will not pretend to call one.' },
];

export interface LabModeOption { id: string; label: string }

/** The parameter controls the lab renders for one entry. */
export interface LabParams {
  /** Selectable clip lengths in seconds. Empty = the provider decides. */
  durations: number[];
  /** Aspect ratios exactly as the endpoint wants them (Runway takes pixel pairs). */
  aspectRatios: string[];
  resolutions: string[];
  audio: boolean;
  negativePrompt: boolean;
  modes: LabModeOption[];
  /** Kling cameraControl presets. */
  camera: boolean;
  cfgScale: boolean;
  seed: boolean;
  /** Veo 3.1 / Omni Flash: the attached image can ride as a reference ingredient. */
  imageRole: boolean;
  /** Reference images this model accepts at once. */
  maxRefs: number;
  /** HeyGen framing + voice speed. */
  fit: boolean;
  voiceSpeed: boolean;
  /** Omni Flash: accepts a source video for direct video editing. */
  videoUpload: boolean;
}

const P = (over: Partial<LabParams> = {}): LabParams => ({
  durations: [],
  aspectRatios: [],
  resolutions: [],
  audio: false,
  negativePrompt: false,
  modes: [],
  camera: false,
  cfgScale: false,
  seed: false,
  imageRole: false,
  maxRefs: 0,
  fit: false,
  voiceSpeed: false,
  videoUpload: false,
  ...over,
});

export interface LabModel {
  /** Unique within the lab — two entries can share a provider model id. */
  key: string;
  /** The exact provider model string, or '' when the route has no model field. */
  modelId: string;
  name: string;
  provider: string;
  group: LabGroupId;
  plugins: LabPlugin[];
  runner: LabRunner;
  submitPath: string;
  statusPath: string;
  blurb: string;
  /** Short chips on the card: duration, resolution, style, inputs. */
  specs: string[];
  image: LabImageMode;
  maxImages: number;
  params: LabParams;
  /** How long the lab polls before it stops waiting (the job keeps running). */
  capMs: number;
  costHint: string;
  available: boolean;
  unavailableReason?: string;
}

// ---------------------------------------------------------------------------
// Group A — POST /api/veo/generate/video
// ---------------------------------------------------------------------------

const GROUP_A_PLUGINS_BOTH: LabPlugin[] = ['image-and-video-generation', 'google-veo3'];
const GROUP_A_PLUGINS_UNIFIED: LabPlugin[] = ['image-and-video-generation'];

interface GroupAExtra {
  group: LabGroupId;
  plugins: LabPlugin[];
  capMs: number;
  /** Reference-image cap: 10 on Omni, 3 on Veo 3.1, 0 everywhere else. */
  maxRefs: number;
  /** An extra chip worth seeing in a lab. */
  styleNote: string;
  /** Whether this model accepts an uploaded video for editing. */
  videoUpload?: boolean;
  /** Set when the proxy's model enum rejects this id outright, so the entry
   *  is greyed out instead of buying the customer a guaranteed 400. */
  unavailableReason?: string;
}

/** Only the Veo / Sora / Omni ids are documented in BOTH video plugins; the
 *  OpenRouter-hosted ids appear only in the unified `image-and-video-generation`
 *  model enum, so they are attributed to that plugin alone. */
const GROUP_A_EXTRA: Record<string, GroupAExtra> = {
  'gemini-omni-flash-preview': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 300000, maxRefs: 10,
    styleNote: 'character consistency',
    videoUpload: true,
  },
  'veo-3.1-generate-preview': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 360000, maxRefs: 3,
    styleNote: 'ingredients + last frame',
  },
  'veo-3.1-fast-generate-preview': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 300000, maxRefs: 3,
    styleNote: 'ingredients + last frame',
  },
  'veo-3.0-generate-001': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 300000, maxRefs: 0,
    styleNote: 'cinematic realism',
  },
  'veo-3.0-fast-generate-001': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 240000, maxRefs: 0,
    styleNote: 'quick turnaround',
  },
  'veo-2.0-generate-001': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 240000, maxRefs: 0,
    styleNote: 'legacy / enhancePrompt',
  },
  'sora-2': {
    group: 'openai', plugins: GROUP_A_PLUGINS_BOTH, capMs: 360000, maxRefs: 0,
    styleNote: 'surreal + stylized',
  },
  'sora-2-pro': {
    group: 'openai', plugins: GROUP_A_PLUGINS_BOTH, capMs: 420000, maxRefs: 0,
    styleNote: 'showcase tier',
  },
  'openrouter/bytedance/seedance-2.0-fast': {
    group: 'bytedance', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 300000, maxRefs: 0,
    styleNote: 'fast B-roll',
  },
  // Probed live 9 Oct 2026: the unified proxy answers 400 invalid_request for
  // this id. It is catalogued in lib/videoEngines.ts but was never in the
  // proxy's model enum, so offering it only buys a rejection at submit time.
  'openrouter/bytedance/seedance-2.5-fast': {
    group: 'bytedance', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 300000, maxRefs: 0,
    styleNote: 'not in the proxy enum',
    unavailableReason:
      'POST /api/veo/generate/video answers 400 "Invalid request parameters" for '
      + 'openrouter/bytedance/seedance-2.5-fast — the id is in this workspace\u2019s catalog but not in the '
      + 'platform proxy\u2019s model enum (verified 9 Oct 2026). Use Seedance 2.0 Fast, which runs today on the '
      + 'same route, and this entry unlocks the moment the platform adds 2.5 to the enum.',
  },
  'openrouter/google/veo-3.1': {
    group: 'google', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 300000, maxRefs: 0,
    styleNote: 'OpenRouter route',
  },
  'openrouter/google/veo-3.1-fast': {
    group: 'google', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 300000, maxRefs: 0,
    styleNote: 'OpenRouter route',
  },
  'openrouter/google/veo-3.1-lite': {
    group: 'google', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 300000, maxRefs: 0,
    styleNote: 'cheapest Veo route',
  },
};

/** The proxy normalizes `duration` to the nearest value the model supports,
 *  so the lab only offers lengths at or under the model's documented ceiling. */
function groupADurations(maxDurationS: number): number[] {
  return [4, 5, 6, 8, 10, 12].filter((seconds) => seconds <= maxDurationS);
}

function fromGroupA(model: GroupAModel): LabModel {
  const extra: GroupAExtra = GROUP_A_EXTRA[model.id] || {
    group: 'google', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 300000, maxRefs: 0, styleNote: model.tier,
  };
  const resolutions = model.supports4k ? ['720p', '1080p', '4k'] : ['720p', '1080p'];
  return {
    key: `groupa:${model.id}`,
    modelId: model.id,
    name: model.name,
    provider: model.provider,
    group: extra.group,
    unavailableReason: extra.unavailableReason,
    plugins: extra.plugins,
    runner: 'group-a',
    submitPath: 'POST /api/veo/generate/video',
    statusPath: 'GET /api/veo/status/:operationId',
    blurb: model.blurb,
    specs: [
      `${model.defaultDurationS}s default · ${model.maxDurationS}s max`,
      model.supports4k ? 'up to 4K' : '720p / 1080p',
      model.supportsAudio ? 'native audio' : 'silent',
      extra.maxRefs > 0 ? `${extra.maxRefs} reference images` : 'seed image only',
      extra.styleNote,
    ],
    image: 'optional',
    maxImages: Math.max(1, Math.min(4, extra.maxRefs || 1)),
    params: P({
      durations: groupADurations(model.maxDurationS),
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions,
      audio: model.supportsAudio,
      negativePrompt: model.supportsNegativePrompt,
      imageRole: extra.maxRefs > 0,
      maxRefs: extra.maxRefs,
      videoUpload: extra.videoUpload ?? false,
    }),
    capMs: extra.capMs,
    costHint: model.costHint,
    available: !extra.unavailableReason,
  };
}

/** The platform-managed convenience proxy. It takes no `model` field — the
 *  server pins veo-3.1-generate-preview — so it is its own lab entry rather
 *  than a Group A row. */
const VEO_MANAGED: LabModel = {
  key: 'veo-managed',
  modelId: '',
  name: 'Veo 3.1 (platform-managed)',
  provider: 'Google',
  group: 'google',
  plugins: ['google-veo3', 'image-and-video-generation'],
  runner: 'veo-managed',
  submitPath: 'POST /api/generate/video',
  statusPath: 'GET /api/veo/status/:operationId',
  blurb: 'The convenience proxy: no model field, the server pins veo-3.1-generate-preview. Useful for proving the platform default end to end without naming an id.',
  specs: ['server-pinned model', '8s', '720p / 1080p', 'seed image only', 'platform default'],
  image: 'optional',
  maxImages: 1,
  params: P({
    durations: [4, 5, 6, 8],
    aspectRatios: ['16:9', '9:16', '1:1'],
    audio: true,
  }),
  capMs: 360000,
  costHint: '≈ $0.40–0.80 / clip',
  available: true,
};

/** Probed live 9 Oct 2026: POST /api/veo/generate/video answers 400
 *  "Invalid request parameters" for BOTH OpenRouter-hosted Runway ids. They
 *  were catalogued here as runnable, which meant picking one bought a
 *  guaranteed rejection, so they now carry the reason and a working
 *  alternative. Nothing else about them changed — if the platform adds them to
 *  the unified proxy's model enum, flipping `available` back is a one-word
 *  edit and the runner already works. */
const OPENROUTER_RUNWAY_UNAVAILABLE =
  'The unified video proxy answers 400 "Invalid request parameters" for this id (verified 9 Oct 2026) — '
  + 'OpenRouter-hosted Runway models are not in its model enum. Runway IS reachable on this platform, '
  + 'just by its native route: use Runway Gen 4.5 or Runway Gen 4 Turbo in this same group, which go to '
  + 'POST /api/generate/runway/video and are priced by the live Runway quote.';

const OPENROUTER_RUNWAY_MODELS: LabModel[] = [
  {
    key: 'groupa:runwayml/gen3a-turbo',
    modelId: 'runwayml/gen3a-turbo',
    name: 'Runway Gen-3 Alpha Turbo',
    provider: 'Runway (OpenRouter)',
    group: 'runway',
    plugins: ['image-and-video-generation'],
    runner: 'group-a',
    submitPath: 'POST /api/veo/generate/video',
    statusPath: 'GET /api/veo/status/:operationId',
    blurb: 'Runway Gen-3 Alpha Turbo routed through OpenRouter on the unified image-and-video generation proxy.',
    specs: ['OpenRouter route', 'up to 10s', '720p / 1080p', 'text or seed image', 'fast tier'],
    image: 'optional',
    maxImages: 1,
    params: P({
      durations: [4, 5, 6, 8, 10],
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
    }),
    capMs: 300000,
    costHint: 'OpenRouter pricing',
    available: false,
    unavailableReason: OPENROUTER_RUNWAY_UNAVAILABLE,
  },
  {
    key: 'groupa:runwayml/gen4-turbo',
    modelId: 'runwayml/gen4-turbo',
    name: 'Runway Gen-4 Turbo',
    provider: 'Runway (OpenRouter)',
    group: 'runway',
    plugins: ['image-and-video-generation'],
    runner: 'group-a',
    submitPath: 'POST /api/veo/generate/video',
    statusPath: 'GET /api/veo/status/:operationId',
    blurb: 'Runway Gen-4 Turbo routed through OpenRouter on the unified image-and-video generation proxy.',
    specs: ['OpenRouter route', 'up to 10s', '720p / 1080p', 'text or seed image', 'fast tier'],
    image: 'optional',
    maxImages: 1,
    params: P({
      durations: [4, 5, 6, 8, 10],
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
    }),
    capMs: 300000,
    costHint: 'OpenRouter pricing',
    available: false,
    unavailableReason: OPENROUTER_RUNWAY_UNAVAILABLE,
  },
];

export function isOpenRouterRunwayModel(modelId: string): boolean {
  return OPENROUTER_RUNWAY_MODELS.some((model) => model.modelId === modelId);
}

// ---------------------------------------------------------------------------
// Kling — POST /api/generate/kling/*
// ---------------------------------------------------------------------------

const KLING_STD: LabModeOption[] = [{ id: 'std', label: 'Standard' }];
const KLING_STD_PRO: LabModeOption[] = [{ id: 'std', label: 'Standard' }, { id: 'pro', label: 'Pro' }];

interface KlingExtra { modes: LabModeOption[]; elements: boolean; masks: boolean }

/** From the integration's own model table: v2-master is std-only, Elements
 *  needs v1-5 or later, and motion-brush masks stop at v1-6. */
const KLING_EXTRA: Record<string, KlingExtra> = {
  'kling-v2-master': { modes: KLING_STD, elements: true, masks: false },
  'kling-v1-6': { modes: KLING_STD_PRO, elements: true, masks: true },
  'kling-v1-5': { modes: KLING_STD_PRO, elements: true, masks: true },
  'kling-v1': { modes: KLING_STD_PRO, elements: false, masks: true },
};

function fromKling(model: KlingModel): LabModel {
  const extra = KLING_EXTRA[model.id] || { modes: KLING_STD_PRO, elements: false, masks: false };
  return {
    key: `kling:${model.id}`,
    modelId: model.id,
    name: model.name,
    provider: 'Kling AI',
    group: 'kling',
    plugins: ['kling-video'],
    runner: 'kling',
    submitPath: extra.elements
      ? 'POST /api/generate/kling/{text-to-video, image-to-video, multi-image}'
      : 'POST /api/generate/kling/{text-to-video, image-to-video}',
    statusPath: 'GET /api/generate/kling/status/:taskId',
    blurb: `${model.blurb} The lab picks the route from the images you attach: none runs text-to-video, one runs image-to-video${extra.elements ? ', two to four runs Elements (multi-image)' : ''}.`,
    specs: [
      '5s or 10s',
      extra.modes.length > 1 ? 'std or pro' : 'std only',
      extra.elements ? 'Elements 2–4 refs' : 'text + single image',
      'camera control',
      'extend +5s · lip-sync',
    ],
    image: extra.elements ? 'multi' : 'optional',
    maxImages: extra.elements ? 4 : 1,
    params: P({
      durations: [5, 10],
      aspectRatios: ['16:9', '9:16', '1:1'],
      negativePrompt: true,
      modes: extra.modes,
      camera: true,
      cfgScale: true,
      seed: true,
    }),
    capMs: 420000,
    costHint: '$0.25–$1.25 / clip · extend + lip-sync $0.25 each',
    available: true,
  };
}

/** Kling's documented camera presets, plus the no-op the proxy defaults to. */
export const KLING_CAMERA_PRESETS: LabModeOption[] = [
  { id: '', label: 'Provider default' },
  { id: 'zoom_in', label: 'Zoom in' },
  { id: 'zoom_out', label: 'Zoom out' },
  { id: 'pan_left', label: 'Pan left' },
  { id: 'pan_right', label: 'Pan right' },
  { id: 'tilt_up', label: 'Tilt up' },
  { id: 'tilt_down', label: 'Tilt down' },
  { id: 'push_in', label: 'Push in' },
  { id: 'pull_out', label: 'Pull out' },
];

// ---------------------------------------------------------------------------
// Higgsfield — POST /api/generate/higgsfield/*
// ---------------------------------------------------------------------------

function fromHiggsfield(model: HiggsfieldVideoModel): LabModel {
  const textToVideo = model.mode === 'text-to-video';
  return {
    key: `higgsfield:${model.id}`,
    modelId: model.id,
    name: model.name,
    provider: textToVideo ? 'MiniMax · Higgsfield' : 'Higgsfield',
    group: 'higgsfield',
    plugins: ['higgsfield-media'],
    runner: textToVideo ? 'higgsfield-text' : 'higgsfield-image',
    submitPath: textToVideo
      ? 'POST /api/generate/higgsfield/video'
      : 'POST /api/generate/higgsfield/image-to-video',
    statusPath: 'GET /api/generate/higgsfield/status/:requestId',
    blurb: textToVideo
      ? `${model.blurb} Moderation can answer status "nsfw" — the lab reports that as its own outcome rather than a generic failure.`
      : `${model.blurb} An image is required; the endpoint has no duration or aspect-ratio field, so the source image decides the frame.`,
    specs: textToVideo
      ? ['1–15s', '16:9 / 9:16', 'MiniMax Hailuo 02', 'cinematic', 'text → video']
      : ['DoP camera motion', 'image → video', 'provider-set length', model.tier, 'seed supported'],
    image: textToVideo ? 'none' : 'required',
    maxImages: textToVideo ? 0 : 1,
    params: P({
      // Probed live 9 Oct 2026: Hailuo answers 400 "duration: 3 is not one of
      // [6, 10]" for anything else, so only the two lengths it accepts are
      // offered. The old [4, 5, 6, 8, 10] list made three of five picks fail.
      durations: textToVideo ? [6, 10] : [],
      aspectRatios: textToVideo ? ['16:9', '9:16', '1:1'] : [],
      seed: true,
    }),
    capMs: 420000,
    costHint: '$1.00 / clip',
    available: true,
  };
}

// ---------------------------------------------------------------------------
// HeyGen — the workspace credential proxy
// ---------------------------------------------------------------------------

const HEYGEN_AVATAR: LabModel = {
  key: 'heygen:avatar',
  modelId: 'heygen-avatar-v3',
  name: 'HeyGen Avatar (v3)',
  provider: 'HeyGen',
  group: 'heygen',
  plugins: ['heygen-video'],
  runner: 'heygen-avatar',
  submitPath: 'POST …/heygen/proxy/v3/videos',
  statusPath: 'GET …/heygen/proxy/v3/videos/:videoId',
  blurb: 'An avatar speaks your prompt. The lab reads the live look catalog, picks a look that carries both a default voice and a v3 engine, and reports which look and engine it used — no avatar or voice id is ever invented.',
  specs: ['avatar-led', '720p / 1080p', '16:9 · 9:16 · 4:5 · 5:4 · 1:1', 'cover or contain', 'script ≤ 500 chars'],
  image: 'none',
  maxImages: 0,
  params: P({
    aspectRatios: ['16:9', '9:16', '4:5', '5:4', '1:1'],
    resolutions: ['720p', '1080p'],
    fit: true,
    voiceSpeed: true,
  }),
  capMs: 480000,
  costHint: 'billed against the workspace HeyGen plan',
  available: true,
};

const HEYGEN_AGENT: LabModel = {
  key: 'heygen:agent',
  modelId: 'heygen-video-agent',
  name: 'HeyGen Video Agent (prompt)',
  provider: 'HeyGen',
  group: 'heygen',
  plugins: ['heygen-video'],
  runner: 'heygen-agent',
  submitPath: 'POST …/heygen/proxy/v3/video-agents',
  statusPath: 'GET …/heygen/proxy/v3/videos/:videoId',
  blurb: 'The prompt-driven Video Agent API: it takes a brief plus an orientation and composes the presenter video itself. The integration doc gives its request shape but not its response or poll shape, so the lab prints the raw creation response and then polls v3/videos/:id when an id is present.',
  specs: ['prompt → presenter', 'portrait or landscape', 'mode generate', 'different API from v3/videos', 'response shape undocumented'],
  image: 'none',
  maxImages: 0,
  params: P({ aspectRatios: ['16:9', '9:16'] }),
  capMs: 480000,
  costHint: 'billed against the workspace HeyGen plan',
  available: true,
};

// ---------------------------------------------------------------------------
// Runway — POST /api/generate/runway/video
// ---------------------------------------------------------------------------

function runwayDurations(model: RunwayModel): number[] {
  const min = model.minDurationS ?? 2;
  const max = model.maxDurationS ?? 10;
  return [2, 4, 5, 8, 10].filter((seconds) => seconds >= min && seconds <= max);
}

function fromRunway(model: RunwayModel): LabModel {
  const imageOnly = model.inputType === 'image';
  return {
    key: `runway:${model.id}`,
    modelId: model.id,
    name: model.label,
    provider: 'Runway',
    group: 'runway',
    plugins: ['runway-recipes'],
    runner: model.available ? 'runway' : 'unavailable',
    submitPath: 'POST /api/generate/runway/video',
    statusPath: 'GET /api/generate/runway/status/:taskId',
    blurb: `${model.blurb} The lab quotes the request first — the quote endpoint is free and unauthenticated — so an invalid body or a disabled provider is found before the wallet is touched.`,
    specs: [
      imageOnly ? 'image → video' : 'text or image → video',
      `${model.minDurationS ?? 2}–${model.maxDurationS ?? 10}s`,
      'pixel-pair ratios',
      model.speed === 'fast' ? 'fast tier' : 'standard tier',
      'quoted before billing',
    ],
    image: imageOnly ? 'required' : 'optional',
    maxImages: 1,
    params: P({
      durations: runwayDurations(model),
      aspectRatios: model.ratios.length ? model.ratios : ['1280:720', '720:1280'],
    }),
    capMs: 480000,
    costHint: model.priceNote,
    available: model.available,
    unavailableReason: model.unavailableReason,
  };
}

// ---------------------------------------------------------------------------
// Requested providers with no platform route
// ---------------------------------------------------------------------------

// Re-probed live 9 Oct 2026: runwayml/gen3a-turbo, runwayml/gen4-turbo and
// openrouter/bytedance/seedance-2.5-fast all answer 400, so they are NOT in
// the enum and are no longer listed here as if they were.
const GROUP_A_ENUM_NOTE =
  'the POST /api/veo/generate/video model enum is gemini-omni-flash-preview, veo-3.1-generate-preview, '
  + 'veo-3.1-fast-generate-preview, veo-3.0-generate-001, veo-3.0-fast-generate-001, veo-2.0-generate-001, '
  + 'sora-2, sora-2-pro, openrouter/bytedance/seedance-2.0-fast, openrouter/google/veo-3.1, '
  + 'openrouter/google/veo-3.1-fast and openrouter/google/veo-3.1-lite';

const MISSING_MODELS: LabModel[] = [
  {
    key: 'missing:luma',
    modelId: '',
    name: 'Luma Dream Machine',
    provider: 'Luma AI',
    group: 'missing',
    plugins: [],
    runner: 'unavailable',
    submitPath: '—',
    statusPath: '—',
    blurb: 'Luma Dream Machine / Ray text-to-video and image-to-video.',
    specs: ['no platform endpoint'],
    image: 'none',
    maxImages: 0,
    params: P(),
    capMs: 0,
    costHint: '—',
    available: false,
    unavailableReason:
      `No Luma integration exists in the platform catalog and no /api/generate/luma/* route is published, so there is nothing for the lab to call. The unified plugin cannot stand in either: ${GROUP_A_ENUM_NOTE} — a Luma id answers 400. Closest equivalents that run today: Veo 3.1 for cinematic text-to-video, or Kling v1.5 / Runway Gen 4 Turbo for image-to-video.`,
  },
  {
    key: 'missing:pika',
    modelId: '',
    name: 'Pika',
    provider: 'Pika Labs',
    group: 'missing',
    plugins: [],
    runner: 'unavailable',
    submitPath: '—',
    statusPath: '—',
    blurb: 'Pika text-to-video and Pikaffects-style image animation.',
    specs: ['no platform endpoint'],
    image: 'none',
    maxImages: 0,
    params: P(),
    capMs: 0,
    costHint: '—',
    available: false,
    unavailableReason:
      `No Pika integration exists in the platform catalog and no /api/generate/pika/* route is published. The unified plugin does not carry a Pika id either: ${GROUP_A_ENUM_NOTE}. Closest equivalents that run today: Seedance 2.0 Fast for quick stylized clips, or Higgsfield DoP Turbo for camera-motion image animation.`,
  },
];

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export const LAB_MODELS: LabModel[] = [
  ...GROUP_A_MODELS.filter((model) => GROUP_A_EXTRA[model.id]?.group === 'bytedance').map(fromGroupA),
  ...GROUP_A_MODELS.filter((model) => (GROUP_A_EXTRA[model.id]?.group || 'google') === 'google').map(fromGroupA),
  VEO_MANAGED,
  ...GROUP_A_MODELS.filter((model) => GROUP_A_EXTRA[model.id]?.group === 'openai').map(fromGroupA),
  ...KLING_MODELS.map(fromKling),
  ...HIGGSFIELD_VIDEO_MODELS.map(fromHiggsfield),
  HEYGEN_AVATAR,
  HEYGEN_AGENT,
  ...OPENROUTER_RUNWAY_MODELS,
  ...RUNWAY_MODELS.filter((model) => model.type === 'video').map(fromRunway),
  ...MISSING_MODELS,
];

/** Seedance is the entry the founder has already seen produce a clip, so the
 *  lab opens on it rather than on an untested engine. */
export const DEFAULT_LAB_MODEL_KEY = 'groupa:openrouter/bytedance/seedance-2.0-fast';

export function labModel(key: string | null | undefined): LabModel | null {
  return LAB_MODELS.find((model) => model.key === String(key || '')) || null;
}

export function labModelsInGroup(group: LabGroupId): LabModel[] {
  return LAB_MODELS.filter((model) => model.group === group);
}

/** 'Text → video' / 'Image → video' / 'Text or image → video' for a card. */
export function labInputLabel(model: LabModel): string {
  if (model.image === 'required') return 'Image → video';
  if (model.image === 'none') return 'Text → video';
  if (model.image === 'multi') return `Text, image or ${model.maxImages} refs → video`;
  return 'Text or image → video';
}

export function pluginLabel(plugin: LabPlugin): string {
  switch (plugin) {
    case 'image-and-video-generation': return 'image-and-video-generation';
    case 'google-veo3': return 'google-veo3';
    case 'kling-video': return 'kling-video';
    case 'higgsfield-media': return 'higgsfield-media';
    case 'heygen-video': return 'heygen-video';
    case 'runway-recipes': return 'runway-recipes';
    default: return String(plugin);
  }
}

// ---------------------------------------------------------------------------
// LAST VERIFIED SWEEP
//
// Recorded from a live end-to-end run on 9 Oct 2026: one minimal paid
// generation per entry (shortest legal duration, 720p, audio off, prompt
// "A red ball bouncing on a white floor."), then polled to a terminal state.
// This is what the platform DID, not what it is documented to do — the two
// had drifted apart in both directions.
//
// 'inconclusive' means the endpoint could not be reached from the server-side
// harness because it requires a browser credential the harness cannot mint.
// Those entries are proven live by other means (the free Runway quote answered
// 200 with a real price) and the Run All Tests panel re-checks them in the
// browser, where the credential exists.
// ---------------------------------------------------------------------------

export type VerifiedOutcome = 'pass' | 'fail' | 'inconclusive' | 'no-endpoint';

export interface VerifiedResult {
  outcome: VerifiedOutcome;
  /** What actually happened, in one sentence a human can act on. */
  note: string;
}

export const LAB_VERIFIED_AT = '2026-10-09';

export const LAB_VERIFIED: Record<string, VerifiedResult> = {
  'groupa:gemini-omni-flash-preview': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:veo-3.1-generate-preview': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:veo-3.1-fast-generate-preview': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:veo-3.0-generate-001': { outcome: 'fail', note: 'The proxy answered 200 with the synthetic id veo_video_error_…, which means the upstream Veo submission was refused. Platform-side and likely transient — Veo 3.1 and 3.1 Fast both work.' },
  'groupa:veo-3.0-fast-generate-001': { outcome: 'fail', note: 'The proxy answered 200 with the synthetic id veo_video_error_…, which means the upstream Veo submission was refused. Platform-side and likely transient — Veo 3.1 Fast is the working stand-in.' },
  'groupa:veo-2.0-generate-001': { outcome: 'fail', note: 'The proxy answered 200 with the synthetic id veo_video_error_…, which means the upstream Veo submission was refused. Platform-side and likely transient.' },
  'groupa:sora-2': { outcome: 'fail', note: 'The proxy answered 200 with the synthetic id sora_error_…, which means the upstream Sora submission was refused. Platform-side — no request shape fixes it from here.' },
  'groupa:sora-2-pro': { outcome: 'fail', note: 'The proxy answered 200 with the synthetic id sora_error_…, which means the upstream Sora submission was refused. Platform-side — no request shape fixes it from here.' },
  'groupa:openrouter/bytedance/seedance-2.0-fast': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:openrouter/bytedance/seedance-2.5-fast': { outcome: 'fail', note: '400 "Invalid request parameters" — this id is not in the unified proxy\u2019s model enum. Disabled here; use Seedance 2.0 Fast.' },
  'groupa:openrouter/google/veo-3.1': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:openrouter/google/veo-3.1-fast': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:openrouter/google/veo-3.1-lite': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:runwayml/gen3a-turbo': { outcome: 'fail', note: '400 "Invalid request parameters" — not in the unified proxy\u2019s model enum. Disabled here; use native Runway Gen 4.5.' },
  'groupa:runwayml/gen4-turbo': { outcome: 'fail', note: '400 "Invalid request parameters" — not in the unified proxy\u2019s model enum. Disabled here; use native Runway Gen 4 Turbo.' },
  'veo-managed': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4 from the server-pinned Veo 3.1.' },
  'kling:kling-v2-master': { outcome: 'fail', note: '503 — “Kling is not configured on this platform (KLING_API_KEY missing).” The models catalogue still answers 200 with a static list, so only a submit reveals this.' },
  'kling:kling-v1-6': { outcome: 'fail', note: '503 — “Kling is not configured on this platform (KLING_API_KEY missing).” The models catalogue still answers 200 with a static list, so only a submit reveals this.' },
  'kling:kling-v1-5': { outcome: 'fail', note: '503 — “Kling is not configured on this platform (KLING_API_KEY missing).” The models catalogue still answers 200 with a static list, so only a submit reveals this.' },
  'kling:kling-v1': { outcome: 'fail', note: '503 — “Kling is not configured on this platform (KLING_API_KEY missing).” The models catalogue still answers 200 with a static list, so only a submit reveals this.' },
  'higgsfield:minimax-hailuo-02': { outcome: 'pass', note: 'Submitted at 6s, rendered and returned a playable MP4. Durations other than 6 and 10 are refused.' },
  'higgsfield:dop-turbo': { outcome: 'pass', note: 'Submitted from a public image URL, rendered and returned a playable MP4.' },
  'higgsfield:dop-standard': { outcome: 'pass', note: 'Submitted from a public image URL, rendered and returned a playable MP4.' },
  'higgsfield:dop-lite': { outcome: 'pass', note: 'Submitted from a public image URL, rendered and returned a playable MP4.' },
  'runway:gen4.5': { outcome: 'inconclusive', note: 'The free quote answered 200 and priced a 2s clip at $0.24, so the model and the proxy are live. The paid submit needs the browser X-Workspace-DB-Token, which the server-side harness cannot mint — run it from this panel to confirm end to end.' },
  'runway:gen4_turbo': { outcome: 'inconclusive', note: 'The free quote answered 200 and priced a 2s clip at $0.10, so the model and the proxy are live. The paid submit needs the browser X-Workspace-DB-Token — run it from this panel to confirm end to end.' },
  'heygen:avatar': { outcome: 'inconclusive', note: 'The HeyGen credential proxy answered 401 “Same-origin request required” to the server-side harness. It is reachable only from this page — run it from this panel to confirm.' },
  'heygen:agent': { outcome: 'inconclusive', note: 'Same as the HeyGen avatar entry: the credential proxy is same-origin only, so it can only be verified from this panel.' },
  'missing:luma': { outcome: 'no-endpoint', note: 'No Luma route exists on this platform, so nothing was called.' },
  'missing:pika': { outcome: 'no-endpoint', note: 'No Pika route exists on this platform, so nothing was called.' },
};

export function labVerified(key: string): VerifiedResult | null {
  return LAB_VERIFIED[key] || null;
}

/** Every run carries the full parameter set; the UI only shows the controls
 *  the selected entry declares, and each runner reads only what it supports. */
export interface LabRunInput {
  prompt: string;
  negativePrompt: string;
  duration: number;
  aspectRatio: string;
  resolution: string;
  audio: boolean;
  mode: string;
  camera: string;
  cfgScale: number;
  seed: string;
  /** 'seed' sends the first image as imageData; 'reference' sends the
   *  attached images as referenceImages ingredients. */
  imageRole: 'seed' | 'reference';
  fit: 'cover' | 'contain';
  voiceSpeed: number;
  /** Attached images as data URLs, in the order the user added them. */
  images: string[];
  /** Uploaded source video as a data URL, for Omni Flash video-to-video editing. */
  videoInput: string;
}

/** Defaults for one entry: the first legal value of every control it shows. */
export function defaultRunInput(model: LabModel, prompt: string): LabRunInput {
  const params = model.params;
  return {
    prompt,
    negativePrompt: '',
    duration: params.durations[0] ?? 5,
    aspectRatio: params.aspectRatios[0] ?? '16:9',
    resolution: params.resolutions[0] ?? '720p',
    audio: false,
    mode: params.modes[0]?.id ?? '',
    camera: '',
    cfgScale: 0.5,
    seed: '',
    imageRole: 'seed',
    fit: 'cover',
    voiceSpeed: 1,
    images: [],
    videoInput: '',
  };
}

/**
 * Re-point a run input at a different entry, keeping every value the new
 * entry can also use. Attached images are deliberately NOT dropped here: one
 * image stays attached while the user walks the grid, and each run slices it
 * down to what its own model accepts (see effectiveRunInput).
 */
export function retargetRunInput(input: LabRunInput, model: LabModel): LabRunInput {
  const params = model.params;
  const keep = <T,>(current: T, allowed: T[], fallback: T): T =>
    (allowed.length === 0 ? fallback : allowed.indexOf(current) >= 0 ? current : allowed[0]);
  return {
    ...input,
    duration: keep(input.duration, params.durations, params.durations[0] ?? input.duration),
    aspectRatio: keep(input.aspectRatio, params.aspectRatios, params.aspectRatios[0] ?? input.aspectRatio),
    resolution: keep(input.resolution, params.resolutions, params.resolutions[0] ?? input.resolution),
    audio: params.audio ? input.audio : false,
    mode: keep(input.mode, params.modes.map((option) => option.id), params.modes[0]?.id ?? ''),
    camera: params.camera ? input.camera : '',
    negativePrompt: params.negativePrompt ? input.negativePrompt : '',
    imageRole: params.imageRole ? input.imageRole : 'seed',
    videoInput: model.params.videoUpload ? input.videoInput : '',
  };
}

/** Exactly what gets sent for one entry: the shared controls, with the image
 *  list narrowed to the number this endpoint actually takes. */
export function effectiveRunInput(model: LabModel, input: LabRunInput): LabRunInput {
  return { ...input, images: input.images.slice(0, Math.max(0, model.maxImages)) };
}

/** Said out loud when attachments will not all travel — a notice, not a block,
 *  so switching from an image model to a text-only one is never a dead end. */
export function describeImageNotice(model: LabModel, input: LabRunInput): string | null {
  const attached = input.images.length;
  if (attached === 0) return null;
  if (model.maxImages === 0) {
    return `${model.name} takes no image input, so ${attached === 1 ? 'the attached image is' : `all ${attached} attached images are`} ignored on this run.`;
  }
  if (attached > model.maxImages) {
    return `${model.name} accepts ${model.maxImages} image${model.maxImages === 1 ? '' : 's'}, so only the first ${model.maxImages} of your ${attached} will be sent.`;
  }
  if (model.runner === 'runway') {
    return 'Runway refuses anything but a public HTTPS reference, so the lab uploads this image to workspace storage first and sends that address.';
  }
  return null;
}

/** Why a run cannot start yet, or null when it can. Checked before submit so
 *  the lab never spends the wallet on a request the endpoint would reject.
 *  Call it with effectiveRunInput(model, input), not the raw shared input. */
export function describeRunBlock(model: LabModel, input: LabRunInput): string | null {
  if (!model.available) return model.unavailableReason || `${model.name} is not available on this platform.`;
  const prompt = input.prompt.trim();
  const needsPrompt = model.runner !== 'higgsfield-image';
  if (needsPrompt && prompt.length < 10) return 'This endpoint needs a prompt of at least 10 characters.';
  if (model.image === 'required' && input.images.length === 0) {
    return `${model.name} is an image-to-video model — attach one image to run it.`;
  }
  if (input.images.length > model.maxImages) {
    return model.maxImages === 0
      ? `${model.name} takes no image input — it would be ignored.`
      : `${model.name} accepts at most ${model.maxImages} image${model.maxImages === 1 ? '' : 's'}.`;
  }
  if (model.runner === 'kling' && input.images.length >= 2 && model.image !== 'multi') {
    return `${model.name} has no Elements route — use Kling v1.5 or later for 2–4 reference images.`;
  }
  return null;
}
