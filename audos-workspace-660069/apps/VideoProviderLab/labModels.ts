/**
 * VIDEO PROVIDER LAB — the model catalog.
 *
 * Every entry below is one selectable row in the lab's model grid, and every
 * `modelId` is the EXACT string the platform proxy accepts — a typo answers
 * 400 rather than falling back. The Group A, native Runway and Higgsfield
 * rosters are DERIVED from lib/videoEngines.ts; this file adds the facts the
 * lab itself needs: which platform plugin powers an entry, which parameters
 * it accepts, how many images it takes, and how long to wait.
 *
 * THE CATALOG LISTS ONLY WHAT RUNS. An engine the platform has been seen
 * refusing is removed rather than shipped greyed out — a disabled row is still
 * a row a customer reads, compares and asks about. The 9 Oct 2026 live sweep
 * (one minimal paid generation per entry, 4s / 720p / audio off, prompt "A red
 * ball bouncing on a white floor.") is what decided which entries survived;
 * LAB_VERIFIED at the bottom records each survivor's outcome and the cards
 * show it, so the grid states what the platform actually did rather than what
 * it is documented to do.
 *
 * Dropped as confirmed broken or shut down: Sora 2 and Sora 2 Pro, Veo 3.0,
 * Veo 3.0 Fast and Veo 2.0 (the proxy answers 200 with a synthetic *_error_*
 * id instead of a real job), both OpenRouter-hosted Runway ids (not in the
 * proxy's model enum), HeyGen, and the Luma / Pika placeholders.
 *
 * KLING is live, and the roster is the current generation only — kling-3.0-omni,
 * kling-3.0, kling-2.6 and kling-2.5-turbo. The lab used to also list
 * kling-v2-master and the kling-v1* ids so the founder could see what the
 * proxy did with them; Kling has since shut all four down and the platform now
 * answers a retired id by SUBSTITUTING the operation default and disclosing it
 * in `modelFallback`, so running one tests the substitution rather than the
 * model. They are gone from lib/videoEngines.ts and therefore from this grid.
 * Cards still print the model actually used, because that substitution is real
 * and a card that named the requested model would be stating something untrue.
 *
 * For live endpoint status, open the owner-only HEALTH view in the lab header:
 * it reads the provider catalogs on demand and costs nothing. Higgsfield is IN the lab:
 * Hailuo 02 and the three DoP models were re-verified live on 13 Oct 2026.
 * Six Higgsfield marketplace ids were trialled the same day and removed
 * again — the proxy answers 200 but silently falls back to
 * minimax-hailuo-02 and bills for it, so listing them would sell the wrong
 * model. This catalog lists ONLY runnable entries: the greyed Runway roster
 * placeholders stay in lib/videoEngines.ts for the other apps' pickers but
 * are filtered out of the lab.
 *
 * Provider contracts, read from the platform integration docs:
 *   image-and-video-generation  POST /api/veo/generate/video    -> GET /api/veo/status/:operationId
 *   google-veo3 (managed)       POST /api/generate/video        -> GET /api/veo/status/:operationId
 *   runway-recipes              POST /api/generate/runway/video -> GET /api/generate/runway/status/:taskId
 *   higgsfield-media            POST /api/generate/higgsfield/video (text-to-video)
 *                               POST /api/generate/higgsfield/image-to-video (image attached)
 *                               -> GET /api/generate/higgsfield/status/:requestId
 *                               Wallet attribution needs x-app-id or workspaceId —
 *                               the token alone answers 400 "no billable workspace".
 *   kling-video                 POST /api/generate/kling/text-to-video
 *                               POST /api/generate/kling/image-to-video (image attached)
 *                               POST /api/generate/kling/multi-image (2-4 reference images, "Elements")
 *                               POST /api/generate/kling/extend (lengthen a finished clip by ~5s)
 *                               POST /api/generate/kling/lip-sync (add speech to a finished clip)
 *                               -> GET /api/generate/kling/status/:taskId
 *                               X-Workspace-DB-Token resolves the billable workspace.
 */

import { GROUP_A_MODELS, HIGGSFIELD_VIDEO_MODELS, KLING_MODELS, RUNWAY_MODELS } from '../../lib/videoEngines';
import type { GroupAModel, HiggsfieldVideoModel, KlingModel, RunwayModel } from '../../lib/videoEngines';

/** The installed platform plugin an entry is powered by. */
export type LabPlugin =
  | 'image-and-video-generation'
  | 'google-veo3'
  | 'runway-recipes'
  | 'higgsfield-media'
  | 'kling-video';

/** Which submit/poll pair in labClient.ts drives the entry. */
export type LabRunner =
  | 'group-a'
  | 'veo-managed'
  | 'runway'
  | 'higgsfield'
  | 'kling'
  | 'unavailable';

export type LabGroupId = 'bytedance' | 'google' | 'runway' | 'higgsfield' | 'kling';

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
  { id: 'google', label: 'Google · Veo & Gemini', note: 'Veo 3.1, the OpenRouter Veo 3.1 variants, and Gemini Omni Flash.' },
  { id: 'runway', label: 'Runway', note: 'Gen 4.5 and Gen 4 Turbo on the native Runway proxy.' },
  { id: 'higgsfield', label: 'Higgsfield', note: 'Native Audos Higgsfield proxy — MiniMax Hailuo text-to-video and the DoP camera-motion image-to-video models.' },
  { id: 'kling', label: 'Kling AI', note: 'Current generation only: Kling 2.5 Turbo, 2.6, 3.0 and 3.0 Omni. Each result reports the model that actually rendered.' },
];

export interface LabModeOption { id: string; label: string }

/** The parameter controls the lab renders for one entry. */
export interface LabParams {
  /** Selectable clip lengths in seconds. Empty = the provider decides. */
  durations: number[];
  /** Preferred initial duration when the entry is first selected. Null = fall back to durations[0] or durationMin. */
  defaultDuration: number | null;
  /** A continuous whole-second range. When set, the UI renders a stepper instead of a fixed list. */
  durationMin: number | null;
  durationMax: number | null;
  durationStep: number;
  /** Aspect ratios exactly as the endpoint wants them (Runway takes pixel pairs). */
  aspectRatios: string[];
  resolutions: string[];
  audio: boolean;
  negativePrompt: boolean;
  modes: LabModeOption[];
  /** Camera-motion preset dropdown. Declared by the standard Kling entries only. */
  camera: boolean;
  /** Prompt-adherence slider (0-1). Kling generation entries. */
  cfgScale: boolean;
  /** Optional integer seed for reproducibility. Kling generation entries. */
  seed: boolean;
  /** Kling Elements: character consistency from 2-4 reference images. */
  multiImage: boolean;
  /** Kling Video Extend tool: lengthens a finished clip, identified by task ID. */
  extend: boolean;
  /** Kling Lip Sync tool: adds speech to a finished clip, identified by task ID. */
  lipSync: boolean;
  /** Veo 3.1 / Omni Flash: the attached image can ride as a reference ingredient. */
  imageRole: boolean;
  /** Reference images this model accepts at once. */
  maxRefs: number;
  /** Presenter framing + voice speed. Unused by the current roster. */
  fit: boolean;
  voiceSpeed: boolean;
  /** Omni Flash: accepts a source video for direct video editing. */
  videoUpload: boolean;
}

const P = (over: Partial<LabParams> = {}): LabParams => ({
  durations: [],
  defaultDuration: null,
  durationMin: null,
  durationMax: null,
  durationStep: 1,
  aspectRatios: [],
  resolutions: [],
  audio: false,
  negativePrompt: false,
  modes: [],
  camera: false,
  cfgScale: false,
  seed: false,
  multiImage: false,
  extend: false,
  lipSync: false,
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
  /** Selectable clip lengths, for a model whose legal range is not the shared
   *  Group A ladder clipped to maxDurationS. */
  durations?: number[];
  /** Continuous whole-second duration range. */
  durationMin?: number;
  durationMax?: number;
  /** Set when the proxy's model enum rejects this id outright, so the entry
   *  is greyed out instead of buying the customer a guaranteed 400. */
  unavailableReason?: string;
}

/** The Veo 3.1 and Omni ids are documented in BOTH video plugins; the
 *  OpenRouter-hosted ids appear only in the unified `image-and-video-generation`
 *  model enum, so they are attributed to that plugin alone. */
const GROUP_A_EXTRA: Record<string, GroupAExtra> = {
  'gemini-omni-flash-preview': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 1_800_000, maxRefs: 10,
    styleNote: 'character consistency',
    videoUpload: true,
  },
  'veo-3.1-generate-preview': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 1_800_000, maxRefs: 3,
    styleNote: 'ingredients + last frame',
  },
  'veo-3.1-fast-generate-preview': {
    group: 'google', plugins: GROUP_A_PLUGINS_BOTH, capMs: 1_800_000, maxRefs: 3,
    styleNote: 'ingredients + last frame',
  },
  'openrouter/bytedance/seedance-2.0-fast': {
    group: 'bytedance', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 1_800_000, maxRefs: 0,
    styleNote: 'fast B-roll · verified provider ceiling 10s',
    durationMin: 4,
    durationMax: 10,
  },
  'openrouter/bytedance/seedance-2.5': {
    group: 'bytedance', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 1_800_000, maxRefs: 3,
    styleNote: 'premium · 4–30s · 3 refs',
    // Founder-confirmed 30s result on the exact model id and request path below.
    // The proxy accepts every whole second in this range; there is no fixed ladder.
    durationMin: 4,
    durationMax: 30,
  },
  'openrouter/google/veo-3.1': {
    group: 'google', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 1_800_000, maxRefs: 0,
    styleNote: 'OpenRouter route',
  },
  'openrouter/google/veo-3.1-fast': {
    group: 'google', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 1_800_000, maxRefs: 0,
    styleNote: 'OpenRouter route',
  },
  'openrouter/google/veo-3.1-lite': {
    group: 'google', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 1_800_000, maxRefs: 0,
    styleNote: 'cheapest Veo route',
  },
};

/** The proxy normalizes `duration` to the nearest value the model supports,
 *  so the lab only offers lengths at or under the model's documented ceiling. */
function groupADurations(maxDurationS: number): number[] {
  return [4, 5, 6, 8, 10, 12, 15, 20, 25, 30].filter((seconds) => seconds <= maxDurationS);
}

function fromGroupA(model: GroupAModel): LabModel {
  const extra: GroupAExtra = GROUP_A_EXTRA[model.id] || {
    group: 'google', plugins: GROUP_A_PLUGINS_UNIFIED, capMs: 1_800_000, maxRefs: 0, styleNote: model.tier,
  };
  const resolutions = model.resolutions?.length
    ? [...model.resolutions]
    : (model.supports4k ? ['720p', '1080p', '4k'] : ['720p', '1080p']);
  const aspectRatios = model.id === 'openrouter/bytedance/seedance-2.5'
    ? ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']
    : ['16:9', '9:16', '1:1'];
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
      durations: extra.durationMin !== undefined ? [] : (extra.durations ?? groupADurations(model.maxDurationS)),
      defaultDuration: model.defaultDurationS,
      durationMin: extra.durationMin ?? null,
      durationMax: extra.durationMax ?? null,
      durationStep: 1,
      aspectRatios,
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
  capMs: 1_800_000,
  costHint: '≈ $0.40–0.80 / clip',
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
    capMs: 1_800_000,
    costHint: model.priceNote,
    available: model.available,
    unavailableReason: model.unavailableReason,
  };
}

// ---------------------------------------------------------------------------
// Higgsfield — POST /api/generate/higgsfield/video
// ---------------------------------------------------------------------------

/** Per-second prices read from the founder's Higgsfield API page (9 Oct 2026).
 *  The DoP models are priced per clip by the proxy. */
const HIGGSFIELD_COST_HINT: Record<string, string> = {
  'minimax-hailuo-02': '$0.065 / second',
  'dop-turbo': 'per-clip DoP pricing — fast tier',
  'dop-standard': 'per-clip DoP pricing — standard tier',
  'dop-lite': 'per-clip DoP pricing — cheapest tier',
};

/** Clip lengths per model. MiniMax Hailuo accepts ONLY 6 or 10 seconds — any
 *  other value answers 400 "duration: N is not one of [6, 10]" upstream, which
 *  the proxy surfaces as a 502 with the wallet charge auto-refunded (hit live
 *  13 Oct 2026 with duration 4). The DoP image-to-video route takes no
 *  duration at all — the provider decides — so those entries offer no length
 *  control. */
const HIGGSFIELD_DURATIONS: Record<string, number[]> = {
  'minimax-hailuo-02': [6, 10],
};

function fromHiggsfield(model: HiggsfieldVideoModel): LabModel {
  const imageRequired = model.mode === 'image-to-video';
  const durations = imageRequired ? [] : (HIGGSFIELD_DURATIONS[model.id] || [4, 6, 8]);
  return {
    key: `higgsfield:${model.id}`,
    modelId: model.id,
    name: model.name,
    provider: 'Higgsfield',
    group: 'higgsfield',
    plugins: ['higgsfield-media'],
    runner: 'higgsfield',
    // Text-to-video and image-to-video are separate endpoints on this proxy;
    // the runner switches to image-to-video whenever an image is attached.
    submitPath: imageRequired
      ? 'POST /api/generate/higgsfield/image-to-video'
      : 'POST /api/generate/higgsfield/video',
    statusPath: 'GET /api/generate/higgsfield/status/:requestId',
    blurb: model.blurb,
    specs: [
      imageRequired ? 'image → video' : 'text or image → video',
      durations.length ? `${durations.join(' / ')}s` : 'provider-set length',
      'provider-set resolution',
      model.tier,
    ],
    image: imageRequired ? 'required' : 'optional',
    maxImages: 1,
    params: P({
      durations,
      aspectRatios: ['16:9', '9:16', '1:1'],
    }),
    capMs: 1_800_000,
    costHint: HIGGSFIELD_COST_HINT[model.id] || 'per-second Higgsfield pricing',
    available: true,
  };
}

// ---------------------------------------------------------------------------
// Kling — POST /api/generate/kling/text-to-video
//         POST /api/generate/kling/image-to-video
// ---------------------------------------------------------------------------

function fromKling(model: KlingModel): LabModel {
  // Modes come from the current proxy roster. Camera control, cfgScale and
  // seed are deliberately absent because the proxy rejects them before billing.
  const modes: LabModeOption[] = (model.modes || []).map((mode) => (
    mode === 'pro' ? { id: 'pro', label: 'Pro' } : { id: 'std', label: 'Standard' }
  ));
  const durations = model.durations || [5, 10];
  return {
    key: `kling:${model.id}`,
    modelId: model.id,
    name: model.name,
    provider: 'Kling AI',
    group: 'kling',
    plugins: ['kling-video'],
    runner: 'kling',
    submitPath: 'POST /api/generate/kling/text-to-video',
    statusPath: 'GET /api/generate/kling/status/:taskId',
    blurb: model.blurb,
    specs: [
      durations.map((seconds) => `${seconds}s`).join(' / '),
      '16:9 / 9:16 / 1:1',
      'text or image → video',
      model.tier,
      ...(modes.length ? ['std / pro modes'] : []),
      ...(model.audio ? ['native audio upstream'] : []),
      ...(model.discontinued ? ['DISCONTINUED upstream'] : []),
    ],
    image: 'optional',
    maxImages: 1,
    params: P({
      durations,
      aspectRatios: ['16:9', '9:16', '1:1'],
      negativePrompt: model.id !== 'kling-3.0-omni',
      modes,
    }),
    capMs: 1_800_000,
    costHint: 'proxy billing from $0.25 / 5s clip (std t2v); i2v from $0.28',
    available: true,
  };
}

// ---------------------------------------------------------------------------
// Kling camera control — sent as `cameraControl` on text-to-video and
// image-to-video. Each preset moves exactly one axis; "Static" holds the
// camera still. Whether a given model honours it is the proxy's call — a
// refusal is shown verbatim on the card.
// ---------------------------------------------------------------------------

export interface KlingCameraConfig {
  horizontal: number;
  vertical: number;
  pan: number;
  tilt: number;
  roll: number;
  zoom: number;
}

export interface LabCameraPreset {
  id: string;
  label: string;
  /** null = send no cameraControl at all. */
  config: KlingCameraConfig | null;
}

export const KLING_CAMERA_CONTROL_TYPE = 'preset';

const CAMERA_AXES: KlingCameraConfig = { horizontal: 0, vertical: 0, pan: 0, tilt: 0, roll: 0, zoom: 0 };

export const CAMERA_PRESETS: LabCameraPreset[] = [
  { id: 'none', label: 'None', config: null },
  { id: 'zoom_in', label: 'Zoom In', config: { ...CAMERA_AXES, zoom: -5 } },
  { id: 'zoom_out', label: 'Zoom Out', config: { ...CAMERA_AXES, zoom: 5 } },
  { id: 'pan_left', label: 'Pan Left', config: { ...CAMERA_AXES, pan: -5 } },
  { id: 'pan_right', label: 'Pan Right', config: { ...CAMERA_AXES, pan: 5 } },
  { id: 'tilt_up', label: 'Tilt Up', config: { ...CAMERA_AXES, tilt: 5 } },
  { id: 'tilt_down', label: 'Tilt Down', config: { ...CAMERA_AXES, tilt: -5 } },
  { id: 'static', label: 'Static', config: { ...CAMERA_AXES } },
];

/** The `cameraControl` body field for a preset id, or null when none applies. */
export function klingCameraControl(presetId: string | null | undefined): { type: string; config: KlingCameraConfig } | null {
  const preset = CAMERA_PRESETS.find((item) => item.id === String(presetId || ''));
  if (!preset || !preset.config) return null;
  return { type: KLING_CAMERA_CONTROL_TYPE, config: { ...preset.config } };
}

// ---------------------------------------------------------------------------
// Kling Elements — POST /api/generate/kling/multi-image
// ---------------------------------------------------------------------------

/** The models the proxy takes on the multi-image route, in display order.
 * The kling-v1-5 / kling-v1-6 ids this list used to carry were shut down by
 * Kling and are no longer catalogued, so they are gone from here too. */
const KLING_MULTI_IMAGE_IDS = ['kling-2.6', 'kling-3.0', 'kling-3.0-omni'];

function fromKlingMultiImage(model: KlingModel): LabModel {
  const modes: LabModeOption[] = (model.modes || []).map((mode) => (
    mode === 'pro' ? { id: 'pro', label: 'Pro' } : { id: 'std', label: 'Standard' }
  ));
  return {
    key: `kling-multi:${model.id}`,
    modelId: model.id,
    name: `${model.name} \u2014 Elements (Multi-image)`,
    provider: 'Kling AI',
    group: 'kling',
    plugins: ['kling-video'],
    runner: 'kling',
    submitPath: 'POST /api/generate/kling/multi-image',
    statusPath: 'GET /api/generate/kling/status/:taskId',
    blurb: 'Character consistency from 2\u20134 reference images. Ideal for series and ad creative where the same character must appear across scenes.',
    specs: [
      '2\u20134 reference images',
      '5s / 10s',
      '16:9 / 9:16 / 1:1',
      model.tier,
      ...(modes.length ? ['std / pro modes'] : []),
    ],
    image: 'multi',
    maxImages: 4,
    params: P({
      multiImage: true,
      durations: [5, 10],
      aspectRatios: ['16:9', '9:16', '1:1'],
      negativePrompt: true,
      modes,
    }),
    capMs: 1_800_000,
    costHint: 'per-clip Kling proxy billing',
    available: true,
  };
}

// ---------------------------------------------------------------------------
// Kling tools — act on a clip that already finished, identified by task ID
// ---------------------------------------------------------------------------

const KLING_EXTEND: LabModel = {
  key: 'kling-extend',
  modelId: '',
  name: 'Kling \u2014 Video Extend',
  provider: 'Kling AI',
  group: 'kling',
  plugins: ['kling-video'],
  runner: 'kling',
  submitPath: 'POST /api/generate/kling/extend',
  statusPath: 'GET /api/generate/kling/status/:taskId',
  blurb: 'Paste the task ID of an older compatible Kling clip to lengthen it by ~5 seconds. Current 2.5/2.6/3.0 sources are refused by the proxy before billing. Costs $0.25 when accepted.',
  specs: ['+~5s per extend', 'older compatible task ID', 'current-model sources refused', 'optional prompt'],
  image: 'none',
  maxImages: 0,
  params: P({ extend: true }),
  capMs: 1_800_000,
  costHint: '$0.25 / extend',
  available: true,
};

const KLING_LIPSYNC: LabModel = {
  key: 'kling-lipsync',
  modelId: '',
  name: 'Kling \u2014 Lip Sync',
  provider: 'Kling AI',
  group: 'kling',
  plugins: ['kling-video'],
  runner: 'kling',
  submitPath: 'POST /api/generate/kling/lip-sync',
  statusPath: 'GET /api/generate/kling/status/:taskId',
  blurb: 'Add speech to any finished Kling clip. Type text for TTS, or paste an audio URL. Costs $0.25 per sync.',
  specs: ['finished clip task ID', 'text-to-speech or audio URL', 'current proxy fields only', 'no model selector'],
  image: 'none',
  maxImages: 0,
  params: P({ lipSync: true }),
  capMs: 1_800_000,
  costHint: '$0.25 / sync',
  available: true,
};

/** True for the entries that act on a finished clip rather than generate one. */
export function isKlingTool(model: LabModel): boolean {
  return model.params.extend || model.params.lipSync;
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export const LAB_MODELS: LabModel[] = [
  // ByteDance · Seedance
  ...GROUP_A_MODELS.filter((model) => GROUP_A_EXTRA[model.id]?.group === 'bytedance').map(fromGroupA),
  // Google · the Veo 3.1 family and Omni Flash. An id GROUP_A_EXTRA no longer
  // carries was dropped from this catalog deliberately, so the empty-string
  // default keeps it out rather than letting it fall through to Google.
  ...GROUP_A_MODELS.filter((model) => (GROUP_A_EXTRA[model.id]?.group || '') === 'google').map(fromGroupA),
  VEO_MANAGED,
  // Runway (native) — only the ids the proxy actually accepts. The greyed-out
  // roster placeholders stay in lib/videoEngines.ts for the other apps' pickers
  // (they auto-unlock via the live capabilities sync), but this catalog lists
  // only what runs.
  ...RUNWAY_MODELS.filter((model) => model.type === 'video' && model.available).map(fromRunway),
  // Higgsfield — the 4 models verified working live on 13 Oct 2026.
  ...HIGGSFIELD_VIDEO_MODELS.map(fromHiggsfield),
  // Kling AI — live, and the roster is the current generation only. The ids
  // Kling shut down (v2-master and the whole v1 line) are no longer catalogued
  // anywhere: the proxy answers a retired id by substituting its own default,
  // so running one would test the substitution rather than the model. The
  // comingSoon flag is still ignored HERE on purpose, so a genuine future
  // preview can be tested before general pickers offer it. Cards print the
  // model actually used, because that substitution is real.
  ...KLING_MODELS.map(fromKling),
  // Kling Elements — character consistency from 2-4 reference images.
  ...KLING_MULTI_IMAGE_IDS
    .map((id) => KLING_MODELS.find((model) => model.id === id))
    .filter((model): model is KlingModel => Boolean(model))
    .map(fromKlingMultiImage),
  // Kling tools — shown last in the Kling group under a "Tools" separator.
  KLING_EXTEND,
  KLING_LIPSYNC,
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
  if (model.params.extend) return 'Task ID → longer clip';
  if (model.params.lipSync) return 'Task ID + text or audio → lip-synced clip';
  if (model.params.multiImage) return `2\u2013${model.maxImages} reference images → video`;
  if (model.image === 'none') return 'Text → video';
  if (model.image === 'multi') return `Text, image or ${model.maxImages} refs → video`;
  return 'Text or image → video';
}

export function pluginLabel(plugin: LabPlugin): string {
  switch (plugin) {
    case 'image-and-video-generation': return 'image-and-video-generation';
    case 'google-veo3': return 'google-veo3';
    case 'runway-recipes': return 'runway-recipes';
    case 'higgsfield-media': return 'higgsfield-media';
    case 'kling-video': return 'kling-video';
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

export const LAB_VERIFIED_AT = '2026-10-21';

export const LAB_VERIFIED: Record<string, VerifiedResult> = {
  'groupa:gemini-omni-flash-preview': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:veo-3.1-generate-preview': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:veo-3.1-fast-generate-preview': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:openrouter/bytedance/seedance-2.0-fast': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:openrouter/bytedance/seedance-2.5': {
    outcome: 'pass',
    note: 'Founder-verified at 30 seconds on POST /api/veo/generate/video with model openrouter/bytedance/seedance-2.5; the returned MP4 was playable. Every whole second from 4 through 30 is accepted.'
  },
  'groupa:openrouter/google/veo-3.1': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:openrouter/google/veo-3.1-fast': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'groupa:openrouter/google/veo-3.1-lite': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4.' },
  'veo-managed': { outcome: 'pass', note: 'Submitted, rendered and returned a playable MP4 from the server-pinned Veo 3.1.' },
  'runway:gen4.5': { outcome: 'inconclusive', note: 'The free quote answered 200 and priced a 2s clip at $0.24, so the model and the proxy are live. The paid submit needs the browser X-Workspace-DB-Token, which the server-side harness cannot mint — run it from this panel to confirm end to end.' },
  'runway:gen4_turbo': { outcome: 'inconclusive', note: 'The free quote answered 200 and priced a 2s clip at $0.10, so the model and the proxy are live. The paid submit needs the browser X-Workspace-DB-Token — run it from this panel to confirm end to end.' },
  'higgsfield:minimax-hailuo-02': { outcome: 'pass', note: 'Re-verified live 13 Oct 2026 — a 6s submit rendered and returned a playable MP4. Durations other than 6 or 10 answer 400.' },
  'higgsfield:dop-turbo': { outcome: 'pass', note: 'Re-verified live 13 Oct 2026 — rendered a playable MP4 from a source image. Higgsfield refuses inline images today, so the lab stages the attachment to workspace storage first.' },
  'higgsfield:dop-standard': { outcome: 'pass', note: 'Re-verified live 13 Oct 2026 — rendered a playable MP4 from a source image (staged to workspace storage first).' },
  'higgsfield:dop-lite': { outcome: 'pass', note: 'Re-verified live 13 Oct 2026 — rendered a playable MP4 from a source image (staged to workspace storage first).' },
  'kling:kling-2.5-turbo': { outcome: 'inconclusive', note: 'Current id in Kling\u2019s own API docs (read 14 Oct 2026). The platform proxy\u2019s static catalogue does not list it yet — if the proxy substitutes its default, this card will name the model that actually rendered.' },
  'kling:kling-2.6': { outcome: 'inconclusive', note: 'Current id in Kling\u2019s own API docs (read 14 Oct 2026) — text/image → video with native audio upstream. Unlisted in the proxy\u2019s static catalogue; the card reports the model actually used.' },
  'kling:kling-3.0': { outcome: 'inconclusive', note: 'Kling\u2019s current flagship per the 14 Oct 2026 API docs (multi-shot prompts, up to 4K / 3–15s upstream). Unlisted in the proxy\u2019s static catalogue; the card reports the model actually used.' },
  'kling:kling-3.0-omni': { outcome: 'inconclusive', note: 'Kling\u2019s omni multi-modal id per the 14 Oct 2026 API docs. Unlisted in the proxy\u2019s static catalogue; the card reports the model actually used.' },
};

KLING_MULTI_IMAGE_IDS.forEach((id) => {
  LAB_VERIFIED[`kling-multi:${id}`] = {
    outcome: 'inconclusive',
    note: 'Elements (multi-image) route added 14 Oct 2026 — not yet run end to end. Needs 2\u20134 reference images, so the smoke sweep skips it; run it from the chat with images attached.',
  };
});
LAB_VERIFIED['kling-extend'] = {
  outcome: 'inconclusive',
  note: 'Added 14 Oct 2026 — needs the task ID of a finished Kling clip, so the smoke sweep skips it; paste an ID in the Kling controls to run it ($0.25).',
};
LAB_VERIFIED['kling-lipsync'] = {
  outcome: 'inconclusive',
  note: 'Added 14 Oct 2026 — needs the task ID of a finished Kling clip plus text or an audio URL, so the smoke sweep skips it; run it from the Kling controls ($0.25).',
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
  /** 'none' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'static' */
  cameraPreset: string;
  /** Kling prompt adherence, 0-1. */
  cfgScale: number;
  /** Kling reproducibility seed; null = random. */
  seed: number | null;
  /** Extend and Lip Sync: the task ID of the finished clip to act on. */
  sourceTaskId: string;
  /** Lip Sync: text for text-to-speech. */
  lipSyncText: string;
  /** Lip Sync: audio URL, used instead of text. */
  lipSyncAudioUrl: string;
  voiceId: string;
  language: string;
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
    duration: params.defaultDuration ?? params.durations[0] ?? params.durationMin ?? 5,
    aspectRatio: params.aspectRatios[0] ?? '16:9',
    resolution: params.resolutions[0] ?? '720p',
    audio: false,
    mode: params.modes[0]?.id ?? '',
    camera: '',
    cameraPreset: 'none',
    cfgScale: 0.5,
    seed: null,
    sourceTaskId: '',
    lipSyncText: '',
    lipSyncAudioUrl: '',
    voiceId: '',
    language: '',
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
  const rangedDuration = params.durationMin !== null && params.durationMax !== null
    ? Math.max(params.durationMin, Math.min(params.durationMax, Math.round(input.duration)))
    : null;
  return {
    ...input,
    // A length the new entry also accepts is kept; continuous ranges preserve
    // any legal whole-second value instead of snapping it to a stale ladder.
    duration: rangedDuration ?? keep(input.duration, params.durations, params.defaultDuration ?? params.durations[0] ?? input.duration),
    aspectRatio: keep(input.aspectRatio, params.aspectRatios, params.aspectRatios[0] ?? input.aspectRatio),
    resolution: keep(input.resolution, params.resolutions, params.resolutions[0] ?? input.resolution),
    audio: params.audio ? input.audio : false,
    mode: keep(input.mode, params.modes.map((option) => option.id), params.modes[0]?.id ?? ''),
    camera: params.camera ? input.camera : '',
    cameraPreset: params.camera ? input.cameraPreset : 'none',
    cfgScale: params.cfgScale ? input.cfgScale : 0.5,
    seed: params.seed ? input.seed : null,
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
  if (model.params.extend || model.params.lipSync) {
    if (!input.sourceTaskId.trim()) {
      return `${model.name} acts on a finished clip — paste its Kling task ID first.`;
    }
    if (model.params.lipSync && !input.lipSyncText.trim() && !input.lipSyncAudioUrl.trim()) {
      return 'Lip Sync needs either text to speak or an audio URL.';
    }
    return null;
  }
  const prompt = input.prompt.trim();
  if (prompt.length < 10) return 'This endpoint needs a prompt of at least 10 characters.';
  if (!Number.isInteger(input.duration)) return `${model.name} duration must be a whole number of seconds.`;
  if (model.params.durationMin !== null && model.params.durationMax !== null
    && (input.duration < model.params.durationMin || input.duration > model.params.durationMax)) {
    return `${model.name} accepts ${model.params.durationMin}–${model.params.durationMax} seconds.`;
  }
  if (model.params.durations.length && model.params.durations.indexOf(input.duration) < 0) {
    return `${model.name} accepts ${model.params.durations.join(' / ')} seconds.`;
  }
  if (model.image === 'required' && input.images.length === 0) {
    return `${model.name} is an image-to-video model — attach one image to run it.`;
  }
  if (input.images.length > model.maxImages) {
    return model.maxImages === 0
      ? `${model.name} takes no image input — it would be ignored.`
      : `${model.name} accepts at most ${model.maxImages} image${model.maxImages === 1 ? '' : 's'}.`;
  }
  if (model.params.multiImage && input.images.length < 2) {
    return `${model.name} needs 2\u2013${model.maxImages} reference images — attach at least 2.`;
  }
  return null;
}
