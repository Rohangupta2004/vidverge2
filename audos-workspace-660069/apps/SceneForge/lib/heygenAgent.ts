// The Video Agent: SceneForge's primary generation path.
//
// One brief in, a finished film out. Two modes:
//   * one-shot  — HeyGen plans and renders without stopping.
//   * storyboard — HeyGen plans, PAUSES, and returns the scene breakdown for
//     the customer to read and edit before any render credit is spent. The
//     approval message then releases the render.
//
// Every submission carries the locked ids from lib/heygenSession, so scene 1
// and scene 9 are the same character, in the same brand, saying product names
// the same way. That is the whole point of the lock.
//
// THE VOICE. SceneForge's default pipeline narrates with ElevenLabs and hands
// HeyGen a finished track to lip-sync to (lib/voicePipeline). `POST v2/video/generate`
// documents that audio voice source; `POST v3/video-agents` does not, and the
// platform catalog does not say whether it accepts one. So the Video Agent's
// support for `voice: { type: 'audio', audio_url }` is PROBED — see
// `submitVideoAgent` — recorded in the capability registry, and never asked
// again. When the answer is no, the suite stops using the Video Agent for a
// voiced film and renders each storyboard scene through the audio-driven avatar
// endpoint instead (`renderStoryboardWithAudio`), and SAYS SO: silently letting
// the Video Agent read the script in HeyGen's own voice is the one outcome the
// ElevenLabs pipeline exists to prevent.
import {
  body,
  capabilityState,
  errorOf,
  get,
  jobIdOf,
  listOf,
  markCapability,
  pollJob,
  post,
  probe,
  sleep,
  statusOf,
  urlOf,
  registerAudioAsset,
  type Capability,
  type CapabilityState,
  type PollOptions,
} from './heygenApi';
import { HeyGenError, createAvatarVideo, fetchVideoStatus } from './heygenStudio';
import { getSession, lockedFields } from './heygenSession';
import { PRESENTER_VOICE_SETTINGS, speakSegments } from './elevenLabs';
import { voicePipeline } from './voicePipeline';
import { beatPurposeOf, gestureBriefLine, gestureFor, type GestureDirection } from './beatPurpose';

/** The webhook HeyGen calls when a job finishes. */
export function callbackUrl(): string {
  try {
    const spaceId = String((window as any).__SPACE_ID__ || (window as any).__APP_ID__ || '');
    if (!spaceId) return '';
    return `${window.location.origin}/api/hooks/execute/${spaceId}/sceneforge-heygen-webhook`;
  } catch { return ''; }
}

export interface StoryboardScene {
  id: string;
  index: number;
  title: string;
  description: string;
  /** Spoken line for the scene, when HeyGen separated it from the visual. */
  script: string;
  durationSec: number;
}

export interface AgentSubmission {
  /** The agent session/job id every later call references. */
  jobId: string;
  /** Populated in storyboard mode once HeyGen has planned the film. */
  storyboard: StoryboardScene[];
  /** Set when the render finished inside the first response (rare). */
  videoUrl: string;
  raw: any;
}

function storyboardFrom(payload: any): StoryboardScene[] {
  const data = body(payload);
  const raw = Array.isArray(data.scenes) ? data.scenes
    : Array.isArray(data.storyboard) ? data.storyboard
      : Array.isArray(data.storyboard?.scenes) ? data.storyboard.scenes
        : Array.isArray(data.plan?.scenes) ? data.plan.scenes
          : listOf(payload).filter((entry) => entry && (entry.description || entry.script || entry.title));
  return (raw || []).map((scene: any, index: number) => ({
    id: String(scene?.id || scene?.scene_id || `scene-${index + 1}`),
    index: Number(scene?.index ?? scene?.scene_index ?? index) || index,
    title: String(scene?.title || scene?.name || `Scene ${index + 1}`),
    description: String(scene?.description || scene?.visual || scene?.visual_description || scene?.prompt || ''),
    script: String(scene?.script || scene?.narration || scene?.voiceover || scene?.text || ''),
    durationSec: Number(scene?.duration || scene?.duration_sec || 0) || 0,
  }));
}

// ——— The audio voice source ———

export const AGENT_AUDIO_CAPABILITY: Capability = 'video-agent-audio';

/** What the registry knows about the Video Agent's audio voice source. */
export function videoAgentAudioState(): CapabilityState {
  return capabilityState(AGENT_AUDIO_CAPABILITY);
}

/** True once HeyGen has told us this account's Video Agent will not take one. */
export function videoAgentAudioRuledOut(): boolean {
  return videoAgentAudioState() === 'unavailable';
}

/** What the suite tells the customer when the Video Agent refuses the track. */
export const AGENT_AUDIO_UNSUPPORTED_NOTE = 'HeyGen\u2019s Video Agent will not accept a ready-made voice track on this account, so it cannot lip-sync your ElevenLabs narration. SceneForge renders each storyboard scene through the audio-driven avatar endpoint instead \u2014 the same ElevenLabs voice ends up on the finished lips, but it is one render per scene rather than one for the whole film, so it takes longer.';

/**
 * True when a rejection is HeyGen refusing the audio VOICE FIELD rather than the
 * brief. A 400/422 that names the voice/audio field, or complains about extra
 * inputs, is the field being refused; anything else is a real request bug and
 * must keep surfacing as one.
 */
export function isAudioVoiceRejection(error: unknown): boolean {
  const status = Number((error as HeyGenError)?.status) || 0;
  if (status !== 400 && status !== 422) return false;
  return /\bvoice\b|\baudio\b|extra\s+inputs|unknown\s+field|unexpected\s+(?:field|key)|not\s+permitted|valid\s+dictionary/i
    .test(String((error as any)?.message || ''));
}

/**
 * Thrown when the Video Agent refuses a ready-made voice track.
 *
 * Deliberately an error rather than a quiet downgrade: the caller has to choose
 * the per-scene route and tell the customer why the film is being assembled
 * scene by scene.
 */
export class AgentAudioUnsupported extends HeyGenError {
  constructor() {
    super(AGENT_AUDIO_UNSUPPORTED_NOTE, 0, false);
    this.name = 'AgentAudioUnsupported';
  }
}

export interface AgentVoiceSource {
  /** A PUBLIC audio url HeyGen can fetch from its own servers. */
  audioUrl: string;
  /** HeyGen's own asset id for the same bytes, when the account registers them. */
  audioAssetId?: string;
}

/** The `voice` object for an audio-driven submission, or nothing usable. */
function audioVoiceFields(voice?: AgentVoiceSource | null): Record<string, unknown> {
  const assetId = String(voice?.audioAssetId || '').trim();
  const url = String(voice?.audioUrl || '').trim();
  if (!assetId && !/^https?:\/\//i.test(url)) return {};
  // Probe the URL form first: it is the caller-audio shape shared with the
  // working v2 path. An account may expose asset registration while the Video
  // Agent still does not understand `audio_asset_id`, which would otherwise
  // create a false negative for caller audio as a whole.
  return { voice: /^https?:\/\//i.test(url)
    ? { type: 'audio', audio_url: url }
    : { type: 'audio', audio_asset_id: assetId } };
}

/**
 * Whether THIS submission should carry an audio voice source: there is one, the
 * workspace is on the ElevenLabs pipeline, and HeyGen has not already refused.
 */
export function wantsAudioVoice(voice?: AgentVoiceSource | null): boolean {
  if (!Object.keys(audioVoiceFields(voice)).length) return false;
  return voicePipeline() === 'elevenlabs_heygen' && !videoAgentAudioRuledOut();
}

export interface GenerateInput {
  prompt: string;
  /** Asset handles for product shots / screenshots the film should use. */
  files: string[];
  /** Overrides the session orientation for this one submission. */
  orientation?: 'landscape' | 'portrait';
  /** An ElevenLabs track this film should be lip-synced to, when there is one. */
  voice?: AgentVoiceSource | null;
  /**
   * How the presenter should deliver this beat. The Video Agent is a
   * brief-driven endpoint, so the direction is carried as PROSE in the prompt —
   * its native language, and a sentence can never be rejected as an unknown
   * field. The structured gesture fields go to `createAvatarVideo`, which is
   * where HeyGen actually exposes them.
   */
  gesture?: GestureDirection | null;
}

/**
 * Submit a brief to the Video Agent.
 *
 * MODE NAMES. The workspace proxy documents `generate` for a finished film;
 * storyboard planning uses the suite's existing `chat` mode. The audio probe
 * never uses the older `one_shot` guess, so a mode error cannot be mistaken
 * for an audio-field verdict.
 */
let acceptedMode: Record<string, string> = {};

export async function submitVideoAgent(input: GenerateInput, storyboardMode: boolean): Promise<AgentSubmission> {
  const session = getSession();
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Write the brief first — what should this video say?');
  if (!session.avatarId) throw new Error('Lock a presenter first so every scene uses the same character.');

  // `generate` is the mode documented by the workspace proxy for a finished
  // Video Agent render. Using an undocumented `one_shot` value during the
  // audio probe would confound two questions: a mode rejection could be
  // mistaken for a voice-field rejection.
  const requested = storyboardMode ? 'chat' : 'generate';
  const fallback = requested;
  const callback = callbackUrl();
  const withAudio = wantsAudioVoice(input.voice);
  const briefed = input.gesture ? `${prompt}\n\n${gestureBriefLine(input.gesture)}` : prompt;

  const payloadFor = (mode: string, audio: boolean) => ({
    prompt: briefed,
    mode,
    orientation: input.orientation || session.orientation,
    // A caller track replaces HeyGen TTS; never send its mutually exclusive
    // `voice_id` beside the audio source.
    ...lockedFields({ includeVoice: !audio }),
    ...(input.files.length ? { files: input.files } : {}),
    ...(session.transparentBackground ? { background: 'transparent' } : {}),
    ...(session.cinematicMode ? { cinematic: true } : {}),
    ...(callback ? { callback_url: callback } : {}),
    ...(audio ? audioVoiceFields(input.voice) : {}),
  });

  const send = (mode: string) => probe('video-agents', 'The HeyGen Video Agent', () => post('v3/video-agents', payloadFor(mode, false)));

  /**
   * The audio attempt deliberately bypasses `probe`: a 400 reading "voice: extra
   * inputs are not permitted" would otherwise teach the registry that the whole
   * Video Agent is missing, when in fact only the field was refused.
   *
   * This attempt IS the probe the voice pipeline needs. A throwaway "minimal
   * one-scene brief" submitted only to ask the question is a real, billed Video
   * Agent job, so the first brief the customer actually submits asks it instead:
   * one answer, recorded once, never retried, and no credit spent on an
   * experiment.
   */
  const sendVoiced = async (mode: string) => {
    const created = await post('v3/video-agents', payloadFor(mode, true));
    markCapability('video-agents', 'available');
    const acceptedId = jobIdOf(created);
    markCapability(AGENT_AUDIO_CAPABILITY, 'available', {
      detail: acceptedId
        ? `POST v3/video-agents accepted the audio voice source and returned job ${acceptedId}.`
        : 'POST v3/video-agents accepted the audio voice source.',
    });
    return created;
  };

  const attempt = async (mode: string) => {
    if (!withAudio) return send(mode);
    try {
      return await sendVoiced(mode);
    } catch (e) {
      if (!isAudioVoiceRejection(e)) throw e;
      markCapability(AGENT_AUDIO_CAPABILITY, 'unavailable', {
        status: Number((e as HeyGenError)?.status) || 0,
        detail: String((e as any)?.message || 'HeyGen rejected the audio voice source.'),
      });
      throw new AgentAudioUnsupported();
    }
  };

  let created: any;
  const known = acceptedMode[requested];
  try {
    created = await attempt(known || requested);
    acceptedMode = { ...acceptedMode, [requested]: known || requested };
  } catch (e) {
    if (e instanceof AgentAudioUnsupported) throw e;
    const message = String((e as any)?.message || '');
    const modeRejected = Number((e as HeyGenError)?.status) === 400 && /mode/i.test(message);
    if (!modeRejected || known === fallback || requested === fallback) throw e;
    created = await attempt(fallback);
    acceptedMode = { ...acceptedMode, [requested]: fallback };
  }

  const jobId = jobIdOf(created);
  const storyboard = storyboardFrom(created);
  if (!jobId && !storyboard.length && !urlOf(created)) {
    throw new HeyGenError('HeyGen accepted the brief but returned nothing to track it by.');
  }
  return { jobId, storyboard, videoUrl: urlOf(created), raw: created };
}

/**
 * Read the agent session again — how a storyboard is collected when HeyGen
 * plans asynchronously rather than answering the submit call with scenes.
 */
export async function fetchAgentState(jobId: string): Promise<AgentSubmission> {
  const payload = await get(`v3/video-agents/${encodeURIComponent(jobId)}`);
  return { jobId, storyboard: storyboardFrom(payload), videoUrl: urlOf(payload), raw: payload };
}

/**
 * Wait for the storyboard in chat mode. HeyGen may return the scene plan in
 * the submit response or shortly after, so the session is re-read until
 * scenes appear.
 */
export async function awaitStoryboard(jobId: string, onTick?: (seconds: number) => void): Promise<StoryboardScene[]> {
  const started = Date.now();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await fetchAgentState(jobId);
    if (state.storyboard.length) return state.storyboard;
    if (state.videoUrl) return [];
    onTick?.(Math.round((Date.now() - started) / 1000));
    await new Promise((resolve) => window.setTimeout(resolve, 4000));
  }
  throw new HeyGenError('HeyGen did not return a storyboard in time. Try the plan again; SceneForge will not substitute HeyGen text-to-speech while ElevenLabs is selected.');
}

/**
 * Approve the plan and release the render.
 *
 * The edited scene descriptions are sent back with the approval so the
 * customer's edits are what gets rendered — approving a storyboard the
 * customer has rewritten and then rendering the original would be the worst
 * possible outcome of this feature.
 */
export async function approveStoryboard(jobId: string, scenes: StoryboardScene[], note: string): Promise<void> {
  const edited = scenes.map((scene) => ({
    id: scene.id,
    index: scene.index,
    title: scene.title,
    description: scene.description,
    ...(scene.script ? { script: scene.script } : {}),
  }));
  await probe('video-agents', 'The HeyGen Video Agent', () => post(`v3/video-agents/${encodeURIComponent(jobId)}/messages`, {
    message: note.trim() || 'Approved. Render this storyboard now.',
    action: 'approve',
    scenes: edited,
  }));
}

/**
 * ONE status read for an agent job.
 *
 * This is what lib/sfJobs calls as its direct fallback while it watches the
 * database row: a single request per cycle, so the webhook stays the fast
 * path and this only guarantees the job can never stall forever (a draft
 * preview origin HeyGen cannot call back into, for instance).
 */
export async function agentStatus(jobId: string): Promise<{ status: string; videoUrl: string; error: string }> {
  const payload = await get(`v3/video-agents/${encodeURIComponent(jobId)}`);
  const videoUrl = urlOf(payload);
  return {
    status: videoUrl ? 'completed' : (statusOf(payload) || 'processing'),
    videoUrl,
    error: errorOf(payload),
  };
}

/** Poll an agent job to its finished MP4. */
export function awaitAgentVideo(jobId: string, options: PollOptions = {}) {
  return pollJob(`v3/video-agents/${encodeURIComponent(jobId)}`, {
    label: 'Your video',
    intervalMs: 6000,
    timeoutMs: 25 * 60 * 1000,
    ...options,
  });
}

// ——— Batch ———

export interface BatchItem {
  /** Caller's own key, so a result can be matched back to its scene. */
  key: string;
  prompt: string;
  files?: string[];
  /** This scene's own ElevenLabs segment, when the film is voiced. */
  voice?: AgentVoiceSource | null;
  /** How the presenter delivers THIS beat; carried as prose in the brief. */
  gesture?: GestureDirection | null;
}

export interface BatchSubmission {
  batchId: string;
  /** Per-item job ids, in the order submitted, when HeyGen returned them. */
  jobIds: string[];
}

export const BATCH_LIMIT = 100;

/**
 * Submit several scenes as ONE request.
 *
 * Used when a brief is broken into scenes: one round trip instead of N, which
 * is both faster and far less likely to trip HeyGen's rate limit. The caller
 * keeps the returned ids aligned with its own scene list by index.
 */
export async function submitBatch(items: BatchItem[], storyboardMode: boolean): Promise<BatchSubmission> {
  if (!items.length) throw new Error('There are no scenes to generate.');
  if (items.length > BATCH_LIMIT) throw new Error(`A batch holds at most ${BATCH_LIMIT} scenes — this one has ${items.length}.`);
  const session = getSession();
  if (!session.avatarId) throw new Error('Lock a presenter first so every scene in the batch uses the same character.');
  const callback = callbackUrl();

  // PER-SCENE VOICE. Each request in the batch carries its OWN ElevenLabs
  // segment, so scene 3 is lip-synced to scene 3's narration rather than to the
  // whole film's. The field is only sent once the Video Agent has been shown to
  // accept it — a batch is the worst place to discover it does not, because one
  // refused field would take every scene down with it.
  const voiced = videoAgentAudioState() === 'available' && voicePipeline() === 'elevenlabs_heygen';
  const created = await probe('batch', 'Batch generation', () => post('v3/batch', {
    requests: items.map((item) => ({
      method: 'POST',
      path: '/v3/video-agents',
      body: {
        prompt: item.gesture ? `${item.prompt}\n\n${gestureBriefLine(item.gesture)}` : item.prompt,
        mode: storyboardMode ? 'chat' : 'generate',
        orientation: session.orientation,
        // Every voiced batch item carries its own finished ElevenLabs track
        // instead of the locked HeyGen text-to-speech voice.
        ...lockedFields({ includeVoice: !voiced }),
        ...(item.files?.length ? { files: item.files } : {}),
        ...(session.transparentBackground ? { background: 'transparent' } : {}),
        ...(session.cinematicMode ? { cinematic: true } : {}),
        ...(callback ? { callback_url: callback } : {}),
        ...(voiced ? audioVoiceFields(item.voice) : {}),
      },
    })),
  }));

  const data = body(created);
  const responses = Array.isArray(data.responses) ? data.responses : Array.isArray(data.results) ? data.results : listOf(created);
  return {
    batchId: String(data.batch_id || data.id || ''),
    jobIds: responses.map((entry: any) => jobIdOf(entry?.body ? entry : { data: entry })).map(String),
  };
}

// ——— The route taken when the Video Agent will not take a voice track ———

/** HeyGen quotes 60–120s for a short render; the queue is shared, so be generous. */
const SCENE_POLL_MS = 8000;
const SCENE_TIMEOUT_MS = 12 * 60 * 1000;
const SCENE_LANES = 2;

export interface StoryboardAudioOptions {
  /** The ElevenLabs voice every scene is narrated with. */
  voiceId: string;
  aspectRatio: '9:16' | '16:9';
  /** The film's language — picks the ElevenLabs model for every segment. */
  language?: string | null;
  onStage?: (message: string) => void;
  signal?: AbortSignal;
}

export interface StoryboardAudioRender {
  /** One finished clip per scene that rendered, in storyboard order. */
  clips: { id: string; index: number; title: string; videoUrl: string }[];
  failed: { id: string; title: string; reason: string }[];
  /** Why the film was assembled this way — shown to the customer verbatim. */
  note: string;
}

/**
 * Render every storyboard scene as its own audio-driven avatar clip.
 *
 * This is the route the suite takes when `videoAgentAudioRuledOut()` is true:
 * ElevenLabs narrates the whole board in ONE billed segments call, then each
 * scene's clip is lip-synced to its own segment through the same audio-driven
 * endpoint the Avatar Studio uses (`createAvatarVideo` → `POST v2/video/generate`
 * with `voice: { type: 'audio' }`). It is slower than one Video Agent job and
 * makes more requests, but the voice on the finished lips is the voice the
 * customer chose, which is the entire point.
 *
 * A scene HeyGen cannot render is recorded with its reason rather than failing
 * the film — the scenes that did render are still a film.
 */
export async function renderStoryboardWithAudio(scenes: StoryboardScene[], options: StoryboardAudioOptions): Promise<StoryboardAudioRender> {
  const session = getSession();
  if (!session.avatarId) throw new Error('Lock a presenter first so every scene uses the same character.');
  const voiceId = String(options.voiceId || '').trim();
  if (!voiceId) throw new Error('Pick an ElevenLabs voice before rendering the storyboard scene by scene.');

  const ordered = [...scenes]
    .map((scene, index) => ({ scene, index, line: String(scene.script || scene.description || '').trim() }))
    .filter((entry) => entry.line)
    .sort((a, b) => a.scene.index - b.scene.index || a.index - b.index);
  if (!ordered.length) throw new Error('None of these scenes has a line to speak yet.');

  options.onStage?.(`Narrating ${ordered.length} scene${ordered.length === 1 ? '' : 's'} with ElevenLabs`);
  const spoken = await speakSegments(ordered.map((entry) => entry.line), voiceId, PRESENTER_VOICE_SETTINGS, { language: options.language });

  const clips: StoryboardAudioRender['clips'] = [];
  const failed: StoryboardAudioRender['failed'] = [];
  const queue = ordered.map((entry, position) => ({ ...entry, audioUrl: spoken.segments[position]?.audioUrl || '' }));
  let settled = 0;

  const renderOne = async (entry: typeof queue[number]) => {
    const audioAssetId = await registerAudioAsset(entry.audioUrl, 'audio/mpeg');
    // Per-beat delivery: the storyboard's own scene titles and position in the
    // film decide how the presenter performs each one (lib/beatPurpose).
    const gesture = gestureFor(beatPurposeOf(
      { scene_type: entry.scene.title, description: entry.scene.description } as any,
      { index: entry.index, total: ordered.length, text: entry.line },
    ));
    const created = await createAvatarVideo({
      avatarId: session.avatarId,
      voiceId: '',
      script: entry.line,
      speed: 1,
      resolution: '1080p',
      aspectRatio: options.aspectRatio,
      backgroundMode: 'color',
      // The suite's own backdrop, so the clips cut together as one film.
      backgroundColor: '#0A0F1E',
      backgroundImageUrl: '',
      audioUrl: entry.audioUrl,
      audioAssetId,
      gesture,
    });
    const startedAt = Date.now();
    let misses = 0;
    for (;;) {
      if (options.signal?.aborted) throw new Error('Rendering was cancelled.');
      await sleep(SCENE_POLL_MS);
      let status: Awaited<ReturnType<typeof fetchVideoStatus>> | null = null;
      try {
        status = await fetchVideoStatus(created.videoId, created.apiVersion);
        misses = 0;
      } catch (e) {
        if (e instanceof HeyGenError && e.missingCredential) throw e;
        // A dropped status read is a hiccup, not a dead render.
        misses += 1;
        if (misses >= 5) throw e;
      }
      if (status?.status === 'completed' && status.videoUrl) return status.videoUrl;
      if (status?.status === 'failed') throw new HeyGenError(status.error || 'HeyGen could not finish this scene.');
      if (Date.now() - startedAt > SCENE_TIMEOUT_MS) {
        throw new Error('HeyGen did not finish this scene in time. It may still complete in your HeyGen library.');
      }
    }
  };

  const lane = async () => {
    for (;;) {
      const entry = queue.shift();
      if (!entry || options.signal?.aborted) return;
      options.onStage?.(`Lip-syncing scene ${entry.scene.index + 1} of ${ordered.length}`);
      try {
        const videoUrl = await renderOne(entry);
        clips.push({ id: entry.scene.id, index: entry.scene.index, title: entry.scene.title, videoUrl });
      } catch (e: any) {
        failed.push({ id: entry.scene.id, title: entry.scene.title, reason: String(e?.message || 'HeyGen could not render this scene.').slice(0, 300) });
      }
      settled += 1;
      options.onStage?.(`${settled} of ${ordered.length} scenes finished`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(SCENE_LANES, queue.length) }, lane));
  clips.sort((a, b) => a.index - b.index);

  return {
    clips,
    failed,
    note: [
      AGENT_AUDIO_UNSUPPORTED_NOTE,
      failed.length ? `${failed.length} scene${failed.length === 1 ? '' : 's'} did not render: ${failed.map((entry) => `${entry.title} (${entry.reason})`).join('; ')}` : '',
    ].filter(Boolean).join(' '),
  };
}
