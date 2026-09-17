/**
 * VidVerge — the agentic video system: THE ENGINES.
 *
 * Four ways a shot can be made, one frame analyzer, and one continuity check.
 * Every function here takes a GenerationDecision and returns a finished clip
 * URL (or an honest error) — nothing above this file knows how any engine works.
 *
 *   VEO (veo_i2v / veo_t2v)
 *     Goes through the workspace's OWN generate-video hook rather than calling
 *     the provider proxy directly. That is deliberate: the hook is what inserts
 *     the video_jobs / video_clips rows the whole product reads (My Videos, the
 *     live render room, the watcher, credit accounting), and it already carries
 *     the negative prompt, the safety level and the reference-image plumbing
 *     that 117 completed renders in this workspace were made with. Calling the
 *     proxy directly would produce a clip that no other surface can see.
 *
 *   HEYGEN
 *     Also through generate-video, as `provider: 'heygen-video'`. The registered
 *     hook already routes a scene to HeyGen and already falls back to Omni on a
 *     HeyGen error, and the watcher already polls it — so an avatar shot needs no
 *     second poll loop in the browser and lands in My Videos like every other
 *     clip. The ONLY thing this file talks to the HeyGen proxy for is the
 *     availability PROBE, because whether a workspace has a usable key cannot be
 *     read any other way: it is probed once, the verdict is LATCHED for the whole
 *     page, and the Avatar button disables itself off that latch rather than
 *     failing several minutes into a render.
 *
 *   REMOTION
 *     Deterministic. It renders the exact composition it is handed, which is the
 *     only honest way to put real product UI on screen — a generative model
 *     cannot spell, so it cannot draw your app. Fixed geometry (1920x1080 @
 *     30fps) is a platform constraint, so a portrait production degrades its UI
 *     beats to Veo image-to-video over the screenshot instead of shipping a
 *     letterboxed shot.
 *
 *   FRAME ANALYZER
 *     Picks the BEST USABLE still out of a finished clip — not the last frame.
 *     A clip that ends mid-blink, mid-whip-pan or on a motion-blurred hand is a
 *     terrible thing to seed the next shot with, and blindly chaining the last
 *     frame is how a series drifts. Bounded: one frame-extraction call and at
 *     most three vision calls per shot.
 */
import {
  checkVideoStatus,
  extractJson,
  generateScenePreview,
  scopedSpaceId,
  sessionId,
  workspaceDbToken,
} from './studioApi';
import { waitForSceneRender } from './projectApi';
import { clampText, getTone, getVideoModel, type AspectRatio } from './videoTypes';
import {
  describeImage,
  FULL_NEGATIVE_PROMPT,
  PHONE_OK_NEGATIVE_PROMPT,
  waitForDbSession,
  workspaceUuid,
} from '../../lib/reelioStudio';
import { buildShotPrompt, referencesFor } from './agenticRouter';
import {
  CONTINUITY_PASS_SCORE,
  SHOT_DIALOGUE_MAX,
  type CharacterMaster,
  type ContinuityVerdict,
  type GenerationDecision,
  type MotionSpec,
  type ProductionMemory,
  type ShotState,
  type StoryPlan,
  type UIState,
  type VisualBible,
} from './agenticTypes';

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ShotRenderResult {
  success: boolean;
  clipUrl?: string;
  jobId?: string;
  operationId?: string;
  error?: string;
  /** A calm, non-error line: "HeyGen was unavailable, rendered on Veo." */
  notice?: string;
  /** True when the engine that actually ran was not the one routed. */
  degraded?: boolean;
}

// ---------------------------------------------------------------------------
// VEO — through the workspace's own render hook
// ---------------------------------------------------------------------------
export interface VeoShotInput {
  shot: ShotState;
  decision: GenerationDecision;
  memory: ProductionMemory;
  plan: StoryPlan | null;
  shotTotal: number;
  productionTitle: string;
  aspect: AspectRatio;
  model: string;
  toneId: string;
  /** Set when the shot deliberately shows a product screen in-frame. */
  showsScreen?: boolean;
  /** Persist the job id before the long poll, so the server can adopt it. */
  onSubmitted?: (jobId: string) => void | Promise<void>;
  onTick?: (message: string) => void;
  isAborted?: () => boolean;
}

/**
 * Submit ONE Veo shot and wait for its clip.
 *
 * The payload is the shape this workspace's generate-video hook has been
 * rendering successfully all along — script + script_json, the character block,
 * both spellings of every reference key, the negative prompt, an explicit
 * `phone_shot: false` so the hook's opt-in phone beat stays off — with the
 * agentic system's own references dropped into the three slots the hook reads:
 *
 *   character_image_url  → identity (the character master). NEVER a scene still.
 *   first_frame_url      → continuity (the previous BEST frame), i2v only.
 *   reference_image_url  → place (the environment plate), when it is not the
 *                          same image as one of the two above.
 */
export async function renderVeoShot(input: VeoShotInput): Promise<ShotRenderResult> {
  const prompt = buildShotPrompt({
    shot: input.shot,
    decision: input.decision,
    memory: input.memory,
    plan: input.plan,
    shotTotal: input.shotTotal,
  });
  if (prompt.length < 10) {
    return { success: false, error: 'This shot has no visual description to render from yet.' };
  }

  const dialogue = clampText(input.shot.dialogue, SHOT_DIALOGUE_MAX);
  const beats = [{ scene_description: prompt, dialogue }];
  const master: CharacterMaster | null = input.memory.characterMasters[0] || null;
  const refs = referencesFor(input.decision, input.memory);
  // A shot that deliberately shows a product screen must not carry the negative
  // terms that steer away from screens and lettering — they would fight it.
  const negative = input.showsScreen ? PHONE_OK_NEGATIVE_PROMPT : FULL_NEGATIVE_PROMPT;

  // SESSION ATTRIBUTION: wait for the verified session before submitting, so
  // the video_jobs row the hook inserts is owned from birth. An unowned row is
  // invisible to every visitor, because My Videos filters strictly on session.
  const sid = (await waitForDbSession()) || sessionId();

  const body: Record<string, unknown> = {
    script: JSON.stringify(beats),
    script_json: [
      {
        scene_number: 1,
        shot_type: input.shot.label,
        description: prompt,
        dialogue,
        duration_seconds: input.shot.seconds,
      },
    ],
    character_description:
      (master && master.description) ||
      `No recurring on-camera character. Hold one consistent look, grade and lighting: ${clampText(
        (input.plan && input.plan.look) || input.memory.anchors.style || 'cinematic',
        160,
      )}`,
    dialogues: [dialogue],
    tone: getTone(input.toneId).prompt,
    aspect_ratio: input.aspect,
    title: `${clampText(input.productionTitle, 34)} · Shot ${input.shot.index}/${input.shotTotal} — ${clampText(
      input.shot.label,
      20,
    )}`,
    duration_seconds: input.shot.seconds,
    target_duration_seconds: input.shot.seconds,
    // The hook's phone/app-mockup beat is opt-in; an agentic shot that wants a
    // screen on camera says so through showsScreen, and every other shot
    // refuses it outright rather than leaving it to a default.
    phone_shot: !!input.showsScreen,
    phoneShot: !!input.showsScreen,
    negative_prompt: negative,
    negativePrompt: negative,
  };
  if (sid) body.session_id = sid;
  if (master) {
    body.character_data = {
      name: master.name,
      description: master.description,
      image_url: refs.identity || undefined,
    };
  }

  const picked = getVideoModel(input.model);
  body.provider = picked.provider;
  body.video_provider = picked.provider;
  body.model = picked.model;
  body.video_model = picked.model;

  if (refs.identity) body.character_image_url = refs.identity;
  // Only an image-to-video decision seeds a first frame. A text-to-video shot
  // that quietly received one would not be text-to-video any more.
  if (input.decision.engine === 'veo_i2v' && refs.firstFrame) {
    body.first_frame_url = refs.firstFrame;
    body.firstFrameUrl = refs.firstFrame;
  }
  const place = refs.place && refs.place !== refs.identity && refs.place !== refs.firstFrame ? refs.place : '';
  if (place) {
    body.reference_image_url = place;
    body.referenceImageUrl = place;
  }
  if (refs.visualReferences.length > 0) {
    const at = Math.max(0, (input.shot.index - 1) % refs.visualReferences.length);
    const ordered = [
      refs.visualReferences[at],
      ...refs.visualReferences.filter((_, index) => index !== at),
    ];
    body.reference_images = ordered;
    // Backward-compatible single-image path while the hook also reads the array.
    body.reference_image_url = ordered[0];
    body.referenceImageUrl = ordered[0];
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sid) headers['X-Session-Id'] = sid;
  const token = workspaceDbToken();
  if (token) headers['X-Workspace-DB-Token'] = token;

  let jobId = input.shot.jobId;
  if (!jobId) {
    try {
      const res = await fetch(`/api/hooks/execute/${scopedSpaceId()}/generate-video`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success || !data.job_id) {
        return {
          success: false,
          error: (data && data.error) || `This shot could not be started (HTTP ${res.status}).`,
        };
      }
      jobId = String(data.job_id);
    } catch (e: any) {
      return { success: false, error: (e && e.message) || 'Network error starting this shot.' };
    }
  }

  if (jobId && input.onSubmitted) {
    try {
      await input.onSubmitted(jobId);
    } catch (e) {
      console.warn('[Agentic] could not persist the submitted job id yet:', e);
    }
  }

  try {
    const result = await waitForSceneRender(jobId, {
      onTick: (message) => input.onTick && input.onTick(message),
      isAborted: input.isAborted,
    });
    const clipUrl = result.clipUrls.length > 0 ? result.clipUrls[0] : '';
    if (!isHttpUrl(clipUrl)) {
      return { success: false, jobId, error: 'The render finished without a clip file.' };
    }
    return { success: true, jobId, clipUrl };
  } catch (e: any) {
    return { success: false, jobId, error: (e && e.message) || 'This shot failed to render.' };
  }
}

// ---------------------------------------------------------------------------
// HEYGEN — probed once, latched, and degraded from
// ---------------------------------------------------------------------------
/**
 * The latch. Availability of a workspace secret CANNOT be read from app code:
 * the only way to learn anything about it is to use it. So the probe below is a
 * real request, the verdict is recorded here, and nothing re-probes for the
 * rest of the page's life — per-shot probing would spend a round trip a shot
 * to re-learn the same answer.
 */
let heygenVerdict: boolean | null = null;
let heygenProbe: Promise<boolean> | null = null;
let heygenLook: { avatarId: string; voiceId: string; engine: string } | null = null;

function heygenPath(path: string): string {
  const uuid = workspaceUuid();
  return `/api/workspaces/${uuid}/provider-credentials/heygen/proxy/${path.replace(/^\/+/, '')}`;
}

async function heygenFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(heygenPath(path), {
    ...(init || {}),
    headers: { 'Content-Type': 'application/json', ...((init && init.headers) || {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && data.error && (data.error.message || data.error)) ||
      (data && data.message) ||
      `HeyGen request failed (HTTP ${res.status}).`;
    const error = new Error(typeof message === 'string' ? message : 'HeyGen request failed.');
    (error as any).status = res.status;
    throw error;
  }
  return data;
}

/**
 * ONE probe: ask HeyGen for a single avatar look. It answers three questions at
 * once — is there a usable key, does the proxy reach HeyGen, and is there an
 * avatar/voice/engine triple this workspace could actually render with (the docs
 * are explicit that an avatar id must be resolved from the live catalog and its
 * engine read off `supported_api_engines`, never invented).
 *
 * A workspace with no uuid, no key, or a rejected key latches `false` and the
 * Avatar mode disables itself. Never throws.
 *
 * This is the only HeyGen call the browser makes. The render itself goes
 * through the workspace's generate-video hook, which owns the avatar/voice
 * selection server-side and never exposes the key.
 */
export async function probeHeyGen(): Promise<boolean> {
  if (heygenVerdict !== null) return heygenVerdict;
  if (heygenProbe) return heygenProbe;
  heygenProbe = (async () => {
    if (!workspaceUuid()) {
      heygenVerdict = false;
      return false;
    }
    try {
      const data = await heygenFetch('v3/avatars/looks?limit=20');
      const looks: any[] = Array.isArray(data && data.data) ? data.data : [];
      const engines = ['avatar_iv', 'avatar_v', 'avatar_iii'];
      for (const look of looks) {
        const supported: string[] = Array.isArray(look && look.supported_api_engines)
          ? look.supported_api_engines
          : [];
        const engine = engines.find((candidate) => supported.indexOf(candidate) !== -1);
        const avatarId = String((look && (look.id || look.avatar_id)) || '');
        const voiceId = String((look && look.default_voice_id) || '');
        if (engine && avatarId && voiceId) {
          heygenLook = { avatarId, voiceId, engine };
          heygenVerdict = true;
          return true;
        }
      }
      // The key works but no look is renderable, which is the same practical
      // answer as no key: Avatar cannot run here.
      heygenVerdict = false;
      return false;
    } catch (e) {
      console.warn('[Agentic] HeyGen is unavailable on this workspace; Avatar will render on Veo:', e);
      heygenVerdict = false;
      return false;
    }
  })();
  return heygenProbe;
}

/** The latched verdict without probing. null means "not asked yet". */
export function heygenAvailability(): boolean | null {
  return heygenVerdict;
}

/**
 * The picker id an avatar shot is submitted under. The registered hook branches
 * on it, picks the avatar/voice pair from the job's own DNA, and silently
 * re-routes the scene to Omni if HeyGen refuses it — which is why there is no
 * HeyGen render function in this file to go wrong.
 */
export const HEYGEN_MODEL_ID = 'heygen-video';

/** True when the resolved look is known, purely for the UI's tooltip copy. */
export function heygenLookResolved(): boolean {
  return !!heygenLook;
}

// ---------------------------------------------------------------------------
// REMOTION — deterministic UI motion
// ---------------------------------------------------------------------------
/** Platform-fixed render geometry. Not a preference — anything else is refused. */
const REMOTION_FPS = 30;
const REMOTION_WIDTH = 1920;
const REMOTION_HEIGHT = 1080;
const REMOTION_POLL_MS = 2000;
const REMOTION_MAX_TICKS = 240; // 8 minutes.

/**
 * TRUE when a Remotion shot can be delivered at all. The endpoint renders only
 * at 1920x1080, so a portrait production would get a letterboxed shot in the
 * middle of otherwise vertical footage — worse than the alternative, which is
 * animating the same screenshot with Veo image-to-video. So portrait
 * productions route their UI beats away from Remotion (see the router).
 */
export function remotionUsable(aspect: AspectRatio): boolean {
  return aspect === '16:9' && !!workspaceUuid();
}

/**
 * The composition, as source. Everything that varies is a PROP — the source
 * string itself is constant, so it is easy to reason about and cheap to send.
 *
 * What it draws: the outgoing screen, then the incoming screen easing in, with
 * a slow camera move over the top and the Motion Agent's per-element specs
 * driving staggered highlight panels. Optional match-frame values place the
 * incoming screen exactly where the previous AI shot left it, so a cinematic
 * shot can hand over to real UI without a visible cut.
 */
const UI_MOTION_COMPOSITION = `
import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

function ease(frame, fps, delayMs, durationMs) {
  const from = (delayMs / 1000) * fps;
  const span = Math.max(1, (durationMs / 1000) * fps);
  return interpolate(frame, [from, from + span], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

export default function Composition(props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const elements = Array.isArray(props.elements) ? props.elements : [];
  const camera = props.camera || 'push_in';
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: 'clamp' });

  const zoom =
    camera === 'push_in' ? 1 + progress * 0.14 : camera === 'pull_back' ? 1.16 - progress * 0.14 : 1.04;
  const panX = camera === 'pan_left' ? -progress * 60 : camera === 'pan_right' ? progress * 60 : 0;

  const crossfade = ease(frame, fps, props.transitionDelayMs || 500, props.transitionMs || 900);
  const match = props.matchFrame || null;
  const matchEase = match ? ease(frame, fps, 0, props.transitionMs || 900) : 1;
  const matchScale = match ? interpolate(matchEase, [0, 1], [match.screenScale || 0.4, 1]) : 1;
  const matchRotate = match ? interpolate(matchEase, [0, 1], [match.screenRotation || 0, 0]) : 0;
  const matchX = match ? interpolate(matchEase, [0, 1], [((match.screenPosition?.x ?? 0.5) - 0.5) * width, 0]) : 0;
  const matchY = match ? interpolate(matchEase, [0, 1], [((match.screenPosition?.y ?? 0.5) - 0.5) * height, 0]) : 0;

  return (
    <AbsoluteFill style={{ background: props.background || '#05080f', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          transform: 'translateX(' + panX + 'px) scale(' + zoom + ')',
          transformOrigin: '50% 45%',
        }}
      >
        {props.fromImage ? (
          <Img
            src={props.fromImage}
            style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 1 - crossfade }}
          />
        ) : null}
        {props.toImage ? (
          <AbsoluteFill
            style={{
              opacity: props.fromImage ? crossfade : 1,
              transform:
                'translate(' + matchX + 'px, ' + matchY + 'px) scale(' + matchScale + ') rotate(' + matchRotate + 'deg)',
              perspective: (match && match.perspective) || undefined,
            }}
          >
            <Img src={props.toImage} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>

      {elements.map((el, i) => {
        const from = ((el.delay || 0) / 1000) * fps;
        const span = Math.max(1, ((el.duration || 450) / 1000) * fps);
        const s = spring({ frame: Math.max(0, frame - from), fps, config: { damping: 18, mass: 0.7 } });
        const appear = interpolate(frame, [from, from + span], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const rise = el.entrance === 'spring_up' ? (1 - s) * 42 : 0;
        const slide =
          el.entrance === 'slide_left' ? (1 - appear) * 60 : el.entrance === 'slide_right' ? (appear - 1) * 60 : 0;
        const scale = el.entrance === 'scale_in' ? 0.92 + appear * 0.08 : el.emphasis === 'scale_105' ? 1 + s * 0.05 : 1;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 72,
              bottom: 96 + i * 104,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '18px 30px',
              borderRadius: 20,
              opacity: appear * 0.96,
              transform: 'translate(' + slide + 'px, ' + rise + 'px) scale(' + scale + ')',
              background: 'rgba(8,14,28,0.74)',
              border:
                el.emphasis === 'outline' || el.emphasis === 'glow'
                  ? '1px solid ' + (props.accent || '#3b82f6')
                  : '1px solid rgba(255,255,255,0.14)',
              boxShadow: el.emphasis === 'glow' ? '0 0 48px -12px ' + (props.accent || '#3b82f6') : 'none',
              backdropFilter: 'blur(14px)',
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: props.accent || '#3b82f6',
                flexShrink: 0,
              }}
            />
            <span style={{ color: '#f8fafc', fontSize: 34, fontWeight: 600, letterSpacing: -0.4 }}>{el.element}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
`;

/**
 * Render one UI Motion shot. Returns `degraded: true` on any failure so the
 * caller can fall back to Veo image-to-video over the same screenshot rather
 * than losing the shot.
 */
export async function renderRemotionShot(input: {
  shot: ShotState;
  fromState: UIState | null;
  toState: UIState | null;
  motion: MotionSpec[];
  accentHex: string;
  backgroundHex: string;
  onTick?: (message: string) => void;
  isAborted?: () => boolean;
}): Promise<ShotRenderResult> {
  const uuid = workspaceUuid();
  if (!uuid) {
    return { success: false, degraded: true, error: 'This session cannot reach the Remotion renderer.' };
  }
  const toImage = input.toState && isHttpUrl(input.toState.imageUrl) ? input.toState.imageUrl : '';
  const fromImage =
    input.fromState && isHttpUrl(input.fromState.imageUrl) && input.fromState.imageUrl !== toImage
      ? input.fromState.imageUrl
      : '';
  if (!toImage && !fromImage) {
    return { success: false, degraded: true, error: 'There is no product screen for this shot to animate.' };
  }

  const durationInFrames = Math.max(30, Math.round(input.shot.seconds * REMOTION_FPS));
  const camera = (input.motion[0] && input.motion[0].camera) || 'push_in';

  let operationId = input.shot.operationId || '';
  if (!operationId) {
    try {
      const res = await fetch('/api/render/remotion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: uuid,
          compositionTsx: UI_MOTION_COMPOSITION,
          props: {
            fromImage: fromImage || undefined,
            toImage: toImage || fromImage,
            elements: input.motion.slice(0, 4),
            camera,
            accent: input.accentHex,
            background: input.backgroundHex,
            transitionMs: 900,
            transitionDelayMs: 500,
          },
          durationInFrames,
          fps: REMOTION_FPS,
          width: REMOTION_WIDTH,
          height: REMOTION_HEIGHT,
        }),
      });
      const data = await res.json().catch(() => null);
      operationId = String((data && data.operationId) || '');
      if (!res.ok || !operationId) {
        return {
          success: false,
          degraded: true,
          error: (data && data.error) || `The UI render could not be started (HTTP ${res.status}).`,
        };
      }
    } catch (e: any) {
      return { success: false, degraded: true, error: (e && e.message) || 'Network error starting the UI render.' };
    }
  }

  for (let tick = 0; tick < REMOTION_MAX_TICKS; tick++) {
    if (input.isAborted && input.isAborted()) return { success: false, error: 'aborted' };
    try {
      const res = await fetch(`/api/render/remotion/${encodeURIComponent(operationId)}`);
      const data = await res.json().catch(() => null);
      const status = String((data && data.status) || '').toLowerCase();
      if (status === 'complete' && isHttpUrl(data && data.videoUrl)) {
        return { success: true, operationId, clipUrl: String(data.videoUrl) };
      }
      if (status === 'failed') {
        return {
          success: false,
          degraded: true,
          operationId,
          error: (data && data.error) || 'The UI render failed.',
        };
      }
      if (input.onTick) input.onTick('Animating your product screens…');
    } catch {
      if (input.onTick) input.onTick('Reconnecting to the UI renderer…');
    }
    await sleep(REMOTION_POLL_MS);
  }
  return { success: false, degraded: true, operationId, error: 'The UI render did not land in time.' };
}

// ---------------------------------------------------------------------------
// FRAME ANALYZER — the best usable frame, not the last one
// ---------------------------------------------------------------------------
export interface FrameAnalysis {
  /** The frame the next shot should continue from. */
  bestFrameUrl: string;
  /** The clip's true tail, kept separately for the record. */
  lastFrameUrl: string;
  /** 0–1 usability score for the chosen frame. */
  score: number;
  reason: string;
  /** How many candidates had to be examined. Useful in the console. */
  examined: number;
}

/** Pull candidate stills out of a finished clip. One request, up to 20 stamps. */
async function extractFrames(clipUrl: string, timestamps: number[]): Promise<{ timestamp: number; url: string }[]> {
  try {
    const res = await fetch('/api/video/frames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: clipUrl,
        timestamps: timestamps.slice(0, 20),
        workspaceId: workspaceUuid() || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    const frames = data && Array.isArray(data.frames) ? data.frames : [];
    return frames
      .filter((f: any) => f && isHttpUrl(f.url))
      .map((f: any) => ({ timestamp: Number(f.timestamp) || 0, url: String(f.url) }));
  } catch (e) {
    console.warn('[Agentic] frame extraction failed (the run continues):', e);
    return [];
  }
}

const FRAME_USABILITY_PROMPT =
  'You are a continuity supervisor choosing the still that the NEXT shot of a video will be generated from. ' +
  'Judge ONLY whether this frame is a clean, usable starting point. Respond with ONLY valid JSON, no markdown ' +
  'fences: {"score": number, "reason": string}. "score" is 0 to 1. Score LOW for motion blur, a subject caught ' +
  'mid-blink or mid-speech with a distorted mouth, a limb or face cut awkwardly by the frame edge, a whip-pan or ' +
  'transition smear, a near-black or blown-out frame, or a composition with no clear subject. Score HIGH for a ' +
  'sharp, well-composed frame with the subject clearly readable. "reason" is one short sentence.';

/**
 * THE FRAME ANALYZER. Three candidates are pulled from the tail of the clip in
 * one request, then examined newest-first and the first genuinely usable one
 * wins — so the common case costs a single vision call, and the worst case is
 * bounded at three.
 *
 * Why not just take the last frame: because the last frame of an 8-second
 * generated clip is very often the worst frame in it. Chaining it is how a
 * character's face slowly becomes someone else's over a long series.
 *
 * Never throws. With no vision and no frames it returns empty strings, and the
 * caller simply chains nothing — a run must not stop over a still.
 */
export async function analyzeClipFrames(input: {
  clipUrl: string;
  seconds: number;
  /** Skip the vision pass when continuity does not matter for this shot. */
  quick?: boolean;
}): Promise<FrameAnalysis> {
  const end = Math.max(0.4, input.seconds);
  // Just inside the end: asking for the exact final second regularly lands past
  // the last decodable frame and returns nothing at all.
  const stamps = [end - 0.5, end - 1.4, end - 2.6]
    .map((t) => Math.max(0.2, Math.round(t * 10) / 10))
    .filter((t, i, all) => all.indexOf(t) === i);
  const frames = await extractFrames(input.clipUrl, stamps);
  if (frames.length === 0) {
    return { bestFrameUrl: '', lastFrameUrl: '', score: 0, reason: 'No frame could be pulled from this clip.', examined: 0 };
  }
  const ordered = frames.slice().sort((a, b) => b.timestamp - a.timestamp);
  const lastFrameUrl = ordered[0].url;

  if (input.quick) {
    return { bestFrameUrl: lastFrameUrl, lastFrameUrl, score: 1, reason: 'Continuity is not carried out of this shot.', examined: 0 };
  }

  let fallback = { url: lastFrameUrl, score: 0, reason: 'No frame scored well; using the clip tail.' };
  for (let i = 0; i < ordered.length; i++) {
    try {
      const raw = await describeImage(ordered[i].url, FRAME_USABILITY_PROMPT);
      const parsed = extractJson(raw);
      const score = Number(parsed && parsed.score);
      const reason = clampText(String((parsed && parsed.reason) || raw), 200);
      if (Number.isFinite(score)) {
        if (score > fallback.score) fallback = { url: ordered[i].url, score, reason };
        if (score >= 0.7) {
          return { bestFrameUrl: ordered[i].url, lastFrameUrl, score, reason, examined: i + 1 };
        }
      }
    } catch (e) {
      console.warn('[Agentic] frame usability check failed for one candidate:', e);
      break;
    }
  }
  return {
    bestFrameUrl: fallback.url,
    lastFrameUrl,
    score: fallback.score,
    reason: fallback.reason,
    examined: ordered.length,
  };
}

// ---------------------------------------------------------------------------
// CONTINUITY CHECK
// ---------------------------------------------------------------------------
/**
 * Does the frame we just saved still match the masters?
 *
 * Every generated shot is read against the visual bible, including pure B-roll.
 * Character and product masters add stricter locks when present; descriptions of
 * adjacent shots add sequence context during the final pass. A fail sends only
 * this shot back through the router with a bridge frame instead of restarting
 * the production.
 */
export async function runContinuityCheck(input: {
  frameUrl: string;
  master: CharacterMaster | null;
  productName: string;
  mustPersist: string[];
  visualBible: VisualBible | null;
  previousVisualDescription?: string;
  nextVisualDescription?: string;
  cameraDistance?: string;
  cameraMovement?: string;
  /** A hard cut may change action, but it still keeps the production's visual bible. */
  deliberateBreak: boolean;
}): Promise<ContinuityVerdict> {
  if (!isHttpUrl(input.frameUrl)) {
    return { passed: true, score: 1, reason: 'No frame was available for the continuity check.' };
  }

  const checks: string[] = [];
  if (input.visualBible) {
    checks.push(
      `VISUAL BIBLE — color/grade: ${clampText(input.visualBible.colorGrade, 160)}; ` +
        `lighting: ${clampText(input.visualBible.lighting, 140)}; camera style: ${clampText(input.visualBible.cameraStyle, 140)}; ` +
        `primary environment: ${clampText(input.visualBible.environment, 180)}; atmosphere: ${clampText(input.visualBible.atmosphere, 140)}.`,
    );
  }
  if (input.previousVisualDescription) {
    checks.push(`Previous shot looked like: ${clampText(input.previousVisualDescription, 240)}.`);
  }
  if (input.nextVisualDescription) {
    checks.push(`Following shot looks like: ${clampText(input.nextVisualDescription, 240)}.`);
  }
  if (input.cameraDistance || input.cameraMovement) {
    checks.push(`Planned camera: ${input.cameraDistance || 'medium'} distance, ${input.cameraMovement || 'static'} movement.`);
  }
  if (input.master) {
    checks.push(
      `The recurring character must look exactly like this: ${clampText(input.master.description, 400)}` +
        (input.master.hair ? ` Hair: ${clampText(input.master.hair, 80)}.` : '') +
        (input.master.age ? ` Age: ${clampText(input.master.age, 40)}.` : '') +
        (input.master.outfitReference ? ' Their outfit must be unchanged.' : ''),
    );
  }
  if (input.productName) checks.push(`The product shown must be recognisably ${clampText(input.productName, 80)}.`);
  input.mustPersist.slice(0, 4).forEach((p) => checks.push(`This must have carried over: ${p}`));

  const prompt =
    'You are a continuity supervisor comparing one rendered shot against the established production style and its neighbours. ' +
    'Check lighting, color grade, environment consistency, camera style, and atmosphere, plus any character or product locks. ' +
    'Respond with ONLY valid JSON, no markdown fences: ' +
    '{"passed": boolean, "score": number, "reason": string, "visual_description": string, ' +
    '"dimensions": {"identity": number, "wardrobe": number, "lighting": number, "color_grade": number, "environment": number, "camera_style": number, "atmosphere": number}}. ' +
    'Every number is 0 to 1. "passed" must be false for a jarring mismatch in any visual-bible dimension. Be strict: a ' +
    'different face, hairstyle, outfit, location, lighting setup, grade, lens language, or atmosphere fails even when the frame looks good alone. ' +
    'A deliberate hard cut may change action or framing, but not the visual bible. "reason" is one short sentence. ' +
    '"visual_description" is a factual one-sentence description of this frame for continuity into the next shot.\n\nRequirements:\n' +
    checks.join('\n');

  try {
    const raw = await describeImage(input.frameUrl, prompt);
    const parsed = extractJson(raw);
    const score = Number(parsed && parsed.score);
    if (!Number.isFinite(score)) {
      // Vision answered in prose. That is not evidence of a continuity failure,
      // so it must not spend a regeneration: pass, and say why.
      return { passed: true, score: 1, reason: 'Continuity could not be scored, so this shot was accepted as is.' };
    }
    const dimensions =
      parsed && parsed.dimensions && typeof parsed.dimensions === 'object'
        ? (parsed.dimensions as Record<string, number>)
        : undefined;
    return {
      passed: parsed.passed !== false && score >= CONTINUITY_PASS_SCORE,
      score,
      reason: clampText(String((parsed && parsed.reason) || ''), 200) || 'Compared against the production masters.',
      dimensions,
      visualDescription: clampText(String((parsed && parsed.visual_description) || ''), 300) || undefined,
    };
  } catch (e) {
    console.warn('[Agentic] continuity check unavailable; accepting the shot:', e);
    return { passed: true, score: 1, reason: 'Continuity could not be checked, so this shot was accepted as is.' };
  }
}

// ---------------------------------------------------------------------------
// Reference images the system draws for itself
// ---------------------------------------------------------------------------
/**
 * Draw a master reference. Used when the visitor gave us nothing to work from:
 * the script is read for recurring people, places and props, and each one is
 * drawn ONCE here so every shot afterwards can point at the same image.
 *
 * A character reference is deliberately a FULL-BODY, in-situation still rather
 * than a studio headshot: on an image-to-video path the reference behaves like
 * frame zero, and a headshot makes every shot open on the same portrait.
 */
export async function drawReference(input: {
  kind: 'character' | 'environment' | 'object';
  description: string;
  look: string;
  aspect: AspectRatio;
}): Promise<string> {
  const style = clampText(input.look, 120);
  const prompt =
    input.kind === 'character'
      ? clampText(
          `Cinematic film still, full-body wide shot of an original fictional character: ${clampText(
            input.description,
            420,
          )}. Shown standing in a real setting, not a studio portrait and not a plain backdrop. ${style}, ` +
            'professional cinematography, high detail. An original fictional person who does not resemble any real, ' +
            'famous or recognisable person.',
          900,
        )
      : input.kind === 'environment'
        ? clampText(
            `Cinematic establishing film still of an empty location, no people in frame: ${clampText(
              input.description,
              420,
            )}. ${style}, professional cinematography, high detail.`,
            900,
          )
        : clampText(
            `Cinematic product still, close-up on a single object against a clean surface: ${clampText(
              input.description,
              420,
            )}. ${style}, crisp directional lighting, high detail.`,
            900,
          );
  try {
    return await generateScenePreview(prompt, input.aspect);
  } catch (e) {
    console.warn(`[Agentic] could not draw the ${input.kind} reference (the run continues):`, e);
    return '';
  }
}

/** Poll a job that was already submitted — used when resuming after a reload. */
export async function adoptRunningShot(jobId: string): Promise<{ clipUrl: string; failed: boolean }> {
  try {
    const status = await checkVideoStatus(jobId);
    const ready = status.success && (status.stage === 'ready' || status.status === 'completed' || status.status === 'partial');
    const clip = Array.isArray(status.clip_urls) && status.clip_urls.length > 0 ? status.clip_urls[0] : status.download_url;
    if (ready && isHttpUrl(clip)) return { clipUrl: String(clip), failed: false };
    const failed = !!status.success && (status.stage === 'failed' || status.status === 'failed');
    return { clipUrl: '', failed };
  } catch {
    return { clipUrl: '', failed: false };
  }
}
