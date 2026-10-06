import { useState, useEffect, useRef } from 'react';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import type { DesktopThemeTokens } from '../types';

// Version marker for auto-upgrade detection
// Increment this when making breaking changes that stale copies need
export const EMAIL_GATE_VERSION = 108; // v108: curated public showcase endpoint with a privacy-safe 6-video seed fallback

type ParsedResponseBody = { data: unknown; rawText: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCanonicalWorkspaceSession(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('wses_');
}

/**
 * Hand a freshly server-accepted session to the injected data runtime before
 * rendering any app. The marker prevents stale localStorage values from being
 * mistaken for authenticated sessions on later reads in the same tab.
 */
function acceptDataSession(sessionId: string): void {
  const runtimeWindow = window as Window & {
    __audosAcceptedSessionId?: string;
    __workspaceDb?: { setSessionId?: (id: string) => void };
  };
  runtimeWindow.__audosAcceptedSessionId = sessionId;
  runtimeWindow.__workspaceDb?.setSessionId?.(sessionId);
}

// Parses a fetch Response body safely so a 5xx HTML page (proxy timeout,
// memory-crash restart, etc.) does not throw inside `response.json()` and
// get swallowed into the generic "Connection error" copy. Always returns
// an object instead of throwing — callers inspect `response.ok` themselves.
async function parseResponseBody(response: Response): Promise<ParsedResponseBody> {
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    return { data: null, rawText: '' };
  }

  if (!rawText) {
    return { data: null, rawText: '' };
  }

  try {
    return { data: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { data: null, rawText };
  }
}

// Pick the most informative error message we can show to the user given
// what came back over the wire. Server-provided `error` always wins; for
// unparseable / non-JSON responses we expose the HTTP status so the bug
// is debuggable instead of being hidden behind "Connection error".
function describeResponseFailure(
  response: Response,
  body: unknown,
  rawText: string,
  fallback: string,
): string {
  if (isRecord(body)) {
    const errField = body.error;
    if (typeof errField === 'string' && errField.trim()) return errField;
    const msgField = body.message;
    if (typeof msgField === 'string' && msgField.trim()) return msgField;
  }

  const status = response.status;
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is temporarily unavailable. Please try again in a moment.';
  }
  if (status >= 500) return `Server error (${status}). Please try again.`;
  if (status === 404) return 'This space could not be found. Please contact support.';
  if (status === 403) return 'This email is not authorized to access this space.';
  if (status === 400 && rawText) {
    // Sometimes the server returns a plain text 400; surface a trimmed copy
    const snippet = rawText.trim().slice(0, 140);
    if (snippet) return snippet;
  }

  return fallback;
}

// Snapshot of the JSON envelope returned by /api/space/:spaceId/register.
// All fields are optional because the server has historically added/removed
// keys; the client narrows individually before use.
interface SpaceRegisterResponseBody {
  success?: boolean;
  workspaceSessionId?: string | null;
  provisionalSessionToken?: string;
  otpRequired?: boolean;
  contactId?: string;
  email?: string;
  isReturningUser?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  visitorId?: string | null;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

// Snapshot of the JSON envelope returned by /api/auth/otp/space/{send,verify}.
interface OtpResponseBody {
  success?: boolean;
  resendCooldown?: number;
  attemptsRemaining?: number;
  expiresIn?: number;
  // Server signals that the most recent previous code for this address
  // failed delivery (the send is still retried); `message` carries the
  // honest user-facing explanation.
  previousDeliveryFailed?: boolean;
  message?: string;
  // Verify only: the canonical contact-linked session for the now-proven
  // email. May differ from the pending session the client sent (stale or
  // forked pending session) — adopt it so history stays on one session.
  canonicalSessionId?: string;
  workspaceSessionId?: string;
  sessionVerified?: boolean;
}

interface EmailGateProps {
  spaceId: string;
  branding?: {
    name?: string;
    tagline?: string;
    logoUrl?: string;
  };
  themeTokens?: DesktopThemeTokens;
}

type GateStep = 'loading' | 'email' | 'code' | 'complete';

// Derive a usable color set from a single hex primary color
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// ── Prismatic Refraction landing: tokens and media ──────────────────────
// Everything below this line is presentation for the SIGNED-OUT view only.
// None of it participates in session, OTP, or registration logic.

const PRISM_CANVAS = '#06060f';
const PRISM_BORDER = 'rgba(255,255,255,0.08)';
const PRISM_TEXT = '#ffffff';
const PRISM_TEXT_SECONDARY = 'rgba(255,255,255,0.62)';
const PRISM_TEXT_MUTED = 'rgba(255,255,255,0.38)';
const PRISM_GRADIENT =
  'linear-gradient(135deg, #ff6090 0%, #ff9060 18%, #ffd060 36%, #60ffa0 54%, #60c0ff 72%, #9060ff 100%)';
const PRISM_MONO = "ui-monospace, SFMono-Regular, Menlo, 'SF Mono', monospace";
const PRISM_EDGE_GLOW = '0 0 60px rgba(144,96,255,0.12), 0 0 120px rgba(255,96,144,0.08)';

// Every clip on the landing page is a finished VidVerge render.
const PRISM_REEL = 'https://storage.googleapis.com/audos-images/runway/f24710e5-7c6d-4db4-92b4-c2c235877575';

const HERO_VIDEO_URL = `${PRISM_REEL}/rw_3aa8ef7b-8559-471e-bb2a-47e43fac334f-0.mp4`;

type ShowcaseVideo = { url: string; label: string; category: string };

// The "Made with VidVerge" fallback wall — six renders, one per output style.
// The public showcase replaces these only when it returns a complete six-clip set.
const SEED_VIDEOS: ShowcaseVideo[] = [
  { url: `${PRISM_REEL}/rw_3aa8ef7b-8559-471e-bb2a-47e43fac334f-0.mp4`, label: 'Product Ad', category: 'product-ad' },
  { url: `${PRISM_REEL}/rw_daaac5c0-4177-4db7-b414-9d6b3165b86c-0.mp4`, label: 'AI Video', category: 'ai-video' },
  { url: `${PRISM_REEL}/rw_09ca17c2-948f-46fa-b49d-6116f230d5bf-0.mp4`, label: 'VFX', category: 'vfx' },
  { url: `${PRISM_REEL}/rw_ca185c15-4ae7-46d9-a226-69e9b8d3fdb6-0.mp4`, label: 'Motion', category: 'motion' },
  { url: `${PRISM_REEL}/rw_a0ee6086-1793-43b1-9afd-42f61c24479e-0.mp4`, label: 'UGC', category: 'ugc' },
  { url: `${PRISM_REEL}/rw_e8145bf3-c59b-460b-a43e-94d6e5605b46-0.mp4`, label: 'Creative', category: 'creative' },
];

// Capability strips: one render each, alternating video-left / video-right.
const PRISM_STRIPS: Array<{ label: string; desc: string; detail: string; url: string }> = [
  {
    label: 'Generate',
    desc: 'Large cinematic examples.',
    detail: 'Brief to video in one shot.',
    url: `${PRISM_REEL}/rw_eeb8bba1-5bc1-4211-ac95-523e72137659-0.mp4`,
  },
  {
    label: 'Transform',
    desc: 'Before and after comparisons.',
    detail: 'Raw footage to a refined cut.',
    url: `${PRISM_REEL}/rw_5c1b96af-332c-4a1e-bc89-7e1c6ce5b574-0.mp4`,
  },
  {
    label: 'VFX',
    desc: 'Transformation clips.',
    detail: 'Cinematic effects, instantly.',
    url: `${PRISM_REEL}/rw_dd29ff27-75bd-4b33-a88b-87eadd2ab14b-0.mp4`,
  },
  {
    label: 'Ads',
    desc: 'UGC and product advertisements.',
    detail: 'Scroll-stopping every time.',
    url: `${PRISM_REEL}/rw_078709f5-9dbb-4a68-b7eb-d136562d75cf-0.mp4`,
  },
  {
    label: 'Edit',
    desc: 'Before and after editing examples.',
    detail: 'Precision, with no timeline.',
    url: `${PRISM_REEL}/rw_5c9b9d09-4d85-4e6d-941f-4545ed692996-0.mp4`,
  },
  {
    label: 'Create',
    desc: 'Creative experimental videos.',
    detail: 'Push every boundary.',
    url: `${PRISM_REEL}/rw_30a8d769-ba8f-4b9d-8292-7c1ef94381fe-0.mp4`,
  },
];

// ── Motion sections: placeholder media ─────────────────────────────────
// PLACEHOLDER CLIPS — public royalty-free sample MP4s standing in for
// finished VidVerge renders. The five motion sections (motion hero, feature
// strip, how-it-works, results reel, final CTA) all resolve their video
// through this list by `slot`, so swapping a clip is a one-line edit here
// and nothing in the JSX needs to change.
const SAMPLE_CLIP_BASE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample';
const sampleClip = (name: string) => ({
  url: `${SAMPLE_CLIP_BASE}/${name}.mp4`,
  poster: `${SAMPLE_CLIP_BASE}/images/${name}.jpg`,
});

type MotionClipSlot =
  | 'hero'
  | 'feature-consistency'
  | 'feature-script'
  | 'feature-vfx'
  | 'step-1'
  | 'step-2'
  | 'step-3'
  | 'reel-1'
  | 'reel-2'
  | 'reel-3'
  | 'reel-4'
  | 'reel-5'
  | 'reel-6'
  | 'final-cta';

type PlaceholderClip = { slot: MotionClipSlot; url: string; poster?: string };

export const PLACEHOLDER_CLIPS: PlaceholderClip[] = [
  { slot: 'hero', ...sampleClip('ForBiggerBlazes') },
  { slot: 'feature-consistency', ...sampleClip('ForBiggerEscapes') },
  { slot: 'feature-script', ...sampleClip('ForBiggerFun') },
  { slot: 'feature-vfx', ...sampleClip('ForBiggerMeltdowns') },
  { slot: 'step-1', ...sampleClip('ForBiggerJoyrides') },
  { slot: 'step-2', url: 'https://www.w3schools.com/html/mov_bbb.mp4' },
  { slot: 'step-3', url: 'https://www.w3schools.com/html/movie.mp4' },
  { slot: 'reel-1', ...sampleClip('ForBiggerBlazes') },
  { slot: 'reel-2', ...sampleClip('ForBiggerEscapes') },
  { slot: 'reel-3', ...sampleClip('ForBiggerFun') },
  { slot: 'reel-4', ...sampleClip('ForBiggerJoyrides') },
  { slot: 'reel-5', ...sampleClip('ForBiggerMeltdowns') },
  { slot: 'reel-6', url: 'https://www.w3schools.com/html/mov_bbb.mp4' },
  { slot: 'final-cta', ...sampleClip('ForBiggerEscapes') },
];

const clipFor = (slot: MotionClipSlot): PlaceholderClip =>
  PLACEHOLDER_CLIPS.find((clip) => clip.slot === slot) ?? PLACEHOLDER_CLIPS[0];

// Feature strip: three columns, one looping clip each.
const FEATURE_COLUMNS: Array<{ slot: MotionClipSlot; title: string; copy: string }> = [
  {
    slot: 'feature-consistency',
    title: 'Character consistency',
    copy: 'The same face, wardrobe and lighting from the first shot to the last.',
  },
  {
    slot: 'feature-script',
    title: 'Script to video',
    copy: 'Paste a script and get scenes, voice and cuts timed to every line.',
  },
  {
    slot: 'feature-vfx',
    title: 'VFX effects',
    copy: 'Fire, smoke, particles and camera moves dropped onto plain footage.',
  },
];

// How-it-works: alternating text / video rows for the three product steps.
const WORKFLOW_STEPS: Array<{ slot: MotionClipSlot; title: string; copy: string }> = [
  {
    slot: 'step-1',
    title: 'Describe it',
    copy: 'Type a brief or paste a script. VidVerge drafts the shot list, the characters and the pacing before a single frame renders.',
  },
  {
    slot: 'step-2',
    title: 'Generate and direct',
    copy: 'Render every scene, then swap an angle, restyle a character or drop in an effect with one plain-language note.',
  },
  {
    slot: 'step-3',
    title: 'Export and publish',
    copy: 'Download in every aspect ratio with captions baked in, ready for TikTok, Reels, YouTube and paid placements.',
  },
];

// Results reel: the horizontally scrolling strip of sample outputs.
const RESULTS_REEL: Array<{ slot: MotionClipSlot; label: string }> = [
  { slot: 'reel-1', label: 'Product launch' },
  { slot: 'reel-2', label: 'Explainer' },
  { slot: 'reel-3', label: 'Trailer' },
  { slot: 'reel-4', label: 'UGC spot' },
  { slot: 'reel-5', label: 'Music visual' },
  { slot: 'reel-6', label: 'Brand film' },
];

export default function EmailGate({
  spaceId,
  branding,
  themeTokens,
}: EmailGateProps) {
  const { sessionId, setSessionId, subscriptionReady, updateSubscription } = useSpaceRuntime();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<GateStep>('loading');
  const [resendCooldown, setResendCooldown] = useState(0);
  // Honest-delivery notice: set when the server reports the previous code
  // failed to deliver to this address (instead of faking another success).
  const [deliveryNotice, setDeliveryNotice] = useState('');
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [showcaseVideos, setShowcaseVideos] = useState<ShowcaseVideo[]>(SEED_VIDEOS);
  // Reduced-motion visitors get poster stills: the placeholder clips in the
  // motion sections autoplay only while this is false.
  const [reduceMotion, setReduceMotion] = useState(false);

  // Signed-out landing presentation refs (no bearing on authentication).
  const videoWallRef = useRef<HTMLElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const bottomCtaRef = useRef<HTMLDivElement | null>(null);
  const bottomEmailInputRef = useRef<HTMLInputElement | null>(null);
  // One <video> handle per wall tile / capability strip, so hovering a card
  // starts exactly that clip and clicking it can go fullscreen.
  const videoWallRefs = useRef<Array<HTMLVideoElement | null>>(Array(6).fill(null));
  const capabilityRefs = useRef<Array<HTMLVideoElement | null>>(Array(6).fill(null));

  // Get workspaceId from window context
  const workspaceId = (window as any).__WORKSPACE_ID__ || null;
  const gdprEnabled = !!(window as any).__GDPR_ENABLED__;
  const guestModeEnabled = !!(window as any).__GUEST_MODE_ENABLED__;
  const rawSocialProviders = (window as any).__SOCIAL_PROVIDERS__;
  const socialProviders: string[] = Array.isArray(rawSocialProviders) ? rawSocialProviders : [];

  useEffect(() => {
    storeAttribution();
    checkExistingSession();
  }, [spaceId]);

  // The server function exposes only founder-approved saved_videos rows. Keep
  // the complete seed reel unless all six public showcase slots are available.
  useEffect(() => {
    let cancelled = false;
    setShowcaseVideos(SEED_VIDEOS);

    const loadShowcase = async () => {
      try {
        const response = await fetch(
          `/api/hooks/execute/${encodeURIComponent(spaceId)}/public-video-showcase`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            body: '{}',
          },
        );
        if (!response.ok) return;

        const payload: unknown = await response.json();
        const rows = isRecord(payload) && Array.isArray(payload.videos) ? payload.videos : [];
        const videos: ShowcaseVideo[] = [];

        for (const row of rows) {
          if (!isRecord(row) || typeof row.url !== 'string' || !row.url.startsWith('https://')) continue;
          videos.push({
            url: row.url,
            label: typeof row.label === 'string' && row.label.trim() ? row.label : 'Made with VidVerge',
            category: typeof row.category === 'string' && row.category.trim() ? row.category : 'video',
          });
        }

        if (!cancelled && videos.length >= SEED_VIDEOS.length) {
          setShowcaseVideos(videos.slice(0, SEED_VIDEOS.length));
        }
      } catch (error) {
        console.warn('[EmailGate] Public showcase unavailable; using the seed reel.', error);
      }
    };

    void loadShowcase();
    return () => { cancelled = true; };
  }, [spaceId]);

  // `autoPlay` ignores prefers-reduced-motion, so the preference is tracked
  // here and the motion-section clips read it. Older Safari lacks
  // addEventListener on MediaQueryList, hence the guarded calls.
  useEffect(() => {
    let media: MediaQueryList | null = null;
    try {
      media = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    if (!media) return;
    setReduceMotion(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches);
    try {
      media.addEventListener?.('change', onChange);
    } catch {}
    return () => {
      try {
        media?.removeEventListener?.('change', onChange);
      } catch {}
    };
  }, []);

  // SpaceRuntime clears subscription state for email-less sessions. Restore the
  // intentional workspace-wide Pro entitlement after that initialization pass.
  useEffect(() => {
    if (!sessionId || !subscriptionReady) return;
    updateSubscription({
      status: 'active',
      planTier: 'pro',
      email: null,
      stripeCustomerId: null,
      subscriptionId: null,
      trialDaysRemaining: 0,
      trialDays: 0,
      trialExpired: false,
      hasPaymentMethod: true,
      contactId: null,
      manualOverride: null,
    });
  }, [sessionId, subscriptionReady, updateSubscription]);

  // Pre-fill email from localStorage when loaded inside the onboarding walkthrough
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('walkthrough') === 'true') {
      const storedEmail = localStorage.getItem('user_email');
      if (storedEmail) setEmail(storedEmail);
    }
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const checkExistingSession = async () => {
    const sessionKey = `space_session_${spaceId}`;
    try {
      const existingSession = localStorage.getItem(sessionKey);
      const parsed = existingSession ? JSON.parse(existingSession) : null;
      const storedSessionId = isRecord(parsed)
        ? parsed.workspaceSessionId || parsed.sessionId || parsed.id
        : null;
      const session = parsed as any;

      if (
        typeof storedSessionId === 'string' &&
        storedSessionId.startsWith('wses_') &&
        session.verified === true
      ) {
        acceptDataSession(storedSessionId);
        setSessionId(storedSessionId);
        setStep('complete');
        return;
      }

      // Guest sessions don’t need OTP, so allow those too.
      if (
        typeof storedSessionId === 'string' &&
        storedSessionId.startsWith('guest_')
      ) {
        acceptDataSession(storedSessionId);
        setSessionId(storedSessionId);
        setStep('complete');
        return;
      }

      // Remove ids created only in the browser (notably the old pro_* flow).
      // They suppress the gate but can never authenticate a WorkspaceDB call.
      if (existingSession) localStorage.removeItem(sessionKey);
    } catch (e) {
      console.warn('[EmailGate] Could not reuse the stored session; asking the visitor to sign in again.', e);
      try { localStorage.removeItem(sessionKey); } catch {}
    }

    setStep('email');
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const normalizedEmail = email.toLowerCase().trim();

      if (workspaceId) {
        const attribution = getAttribution();
        const visitorId = getVisitorId();
        const sessionId = `csess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

        const registerRes = await fetch(`/api/space/${spaceId}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: normalizedEmail,
            sessionId,
            visitorId,
            attribution,
            metadata: {},
            workspaceId,
            marketingConsent,
          }),
        });

        const { data: registerResult, rawText: registerRawText } =
          await parseResponseBody(registerRes);

        if (!registerRes.ok) {
          console.error('[EmailGate] register failed', {
            status: registerRes.status,
            body: registerResult ?? registerRawText.slice(0, 200),
          });
          setError(
            describeResponseFailure(
              registerRes,
              registerResult,
              registerRawText,
              'Failed to create session. Please try again.',
            ),
          );
          setLoading(false);
          return;
        }

        if (!isRecord(registerResult)) {
          console.error('[EmailGate] register returned an unparseable body', {
            status: registerRes.status,
            rawText: registerRawText.slice(0, 200),
          });
          setError('The server returned an unexpected response. Please try again.');
          setLoading(false);
          return;
        }

        const registerBody = registerResult as SpaceRegisterResponseBody;
        const resolvedWorkspaceId = typeof registerBody.workspaceId === 'string' ? registerBody.workspaceId : workspaceId;
        const provisionalSessionToken = typeof registerBody.provisionalSessionToken === 'string' ? registerBody.provisionalSessionToken : '';

        // Case 1: server already authenticated the user (no OTP needed)
        if (
          typeof registerBody.workspaceSessionId === 'string' &&
          registerBody.workspaceSessionId.startsWith('wses_')
        ) {
          await completeVerifiedSession(registerBody.workspaceSessionId);
          return;
        }

        // Case 2: OTP flow — server returned a provisional token
        if (!resolvedWorkspaceId || !provisionalSessionToken) {
          setError('Email verification is required, but this workspace did not return an OTP challenge. Please contact the workspace owner.');
          setLoading(false);
          return;
        }
        setPendingSessionId(provisionalSessionToken);
        setPendingWorkspaceId(resolvedWorkspaceId);

        if (typeof (window as any).fbq === 'function' && (window as any).__META_PIXEL_ID__) {
          (window as any).fbq('init', (window as any).__META_PIXEL_ID__, { em: normalizedEmail.toLowerCase().trim() });
        }
        fireLeadEventWithRetry(normalizedEmail);

        const response = await fetch('/api/auth/otp/space/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: normalizedEmail, workspaceId: resolvedWorkspaceId, spaceId, sessionUuid: provisionalSessionToken }),
        });

        const { data: otpResult, rawText: otpRawText } = await parseResponseBody(response);

        if (!response.ok) {
          console.error('[EmailGate] otp send failed', {
            status: response.status,
            body: otpResult ?? otpRawText.slice(0, 200),
          });
          setError(
            describeResponseFailure(
              response,
              otpResult,
              otpRawText,
              'Failed to send code. Please try again.',
            ),
          );
          setLoading(false);
          return;
        }

        const otpBody: OtpResponseBody = isRecord(otpResult) ? otpResult : {};
        setResendCooldown(otpBody.resendCooldown ?? 60);
        setDeliveryNotice(
          otpBody.previousDeliveryFailed
            ? (typeof otpBody.message === 'string' && otpBody.message
                ? otpBody.message
                : "We had trouble delivering your last code to this address. We’re trying again - also check your spam folder, or try a different email.")
            : ''
        );
        setStep('code');
      } else {
        setError('Email verification is unavailable because the workspace identity is missing.');
      }
    } catch (err) {
      console.error('[EmailGate] Network error in handleEmailSubmit:', err);
      setError('Connection error. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (code.length !== 4) {
      setError('Please enter the 4-digit code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      if (!pendingSessionId || !pendingWorkspaceId) {
        setError('Verification expired. Please start over.');
        setStep('email');
        setLoading(false);
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const response = await fetch('/api/auth/otp/space/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail, code, workspaceId: pendingWorkspaceId, spaceId, sessionUuid: pendingSessionId }),
      });

      const { data: verifyResult, rawText: verifyRawText } = await parseResponseBody(response);
      const verifyBody: OtpResponseBody = isRecord(verifyResult) ? verifyResult : {};

      if (!response.ok || verifyBody.success !== true || verifyBody.sessionVerified !== true) {
        console.error('[EmailGate] otp verify failed', {
          status: response.status,
          body: verifyResult ?? verifyRawText.slice(0, 200),
        });
        if (typeof verifyBody.attemptsRemaining === 'number') {
          setError(`Invalid code. ${verifyBody.attemptsRemaining} attempts remaining.`);
        } else {
          setError(
            describeResponseFailure(
              response,
              verifyResult,
              verifyRawText,
              'Invalid code. Please try again.',
            ),
          );
        }
        setLoading(false);
        return;
      }

      // Adopt only the server-corrected canonical session returned after the
      // one-time code proves ownership of the email address.
      const canonicalSessionId =
        (typeof verifyBody.canonicalSessionId === 'string' && verifyBody.canonicalSessionId.startsWith('wses_')
          ? verifyBody.canonicalSessionId
          : undefined) ||
        (typeof verifyBody.workspaceSessionId === 'string' && verifyBody.workspaceSessionId.startsWith('wses_')
          ? verifyBody.workspaceSessionId
          : undefined);
      await completeVerifiedSession(canonicalSessionId);
    } catch (err) {
      console.error('[EmailGate] Network error in handleCodeSubmit:', err);
      setError('Connection error. Please check your internet connection and try again.');
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0 || !pendingSessionId || !pendingWorkspaceId) return;

    setLoading(true);
    setError('');

    try {
      const normalizedEmail = email.toLowerCase().trim();
      const response = await fetch('/api/auth/otp/space/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail, workspaceId: pendingWorkspaceId, spaceId, sessionUuid: pendingSessionId }),
      });

      const { data: resendResult, rawText: resendRawText } = await parseResponseBody(response);

      if (response.ok) {
        const resendBody: OtpResponseBody = isRecord(resendResult) ? resendResult : {};
        setResendCooldown(resendBody.resendCooldown ?? 60);
        setDeliveryNotice(
          resendBody.previousDeliveryFailed
            ? (typeof resendBody.message === 'string' && resendBody.message
                ? resendBody.message
                : "We had trouble delivering your last code to this address. We’re trying again - also check your spam folder, or try a different email.")
            : ''
        );
        setCode('');
      } else {
        console.error('[EmailGate] otp resend failed', {
          status: response.status,
          body: resendResult ?? resendRawText.slice(0, 200),
        });
        setError(
          describeResponseFailure(
            response,
            resendResult,
            resendRawText,
            'Failed to resend code. Please try again.',
          ),
        );
      }
    } catch (err) {
      console.error('[EmailGate] Network error in handleResendCode:', err);
      setError('Connection error. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const completeVerifiedSession = async (adoptedSessionId?: string) => {
    // Prefer the server-corrected canonical session (returned by OTP verify)
    // over the client’s pending session, so a returning member always lands
    // on the session their history lives under.
    const finalSessionId = adoptedSessionId;
    if (!isCanonicalWorkspaceSession(finalSessionId)) {
      setError('Your session could not be verified. Please sign in again.');
      setPendingSessionId(null);
      setStep('email');
      setLoading(false);
      return;
    }
    const sessionKey = `space_session_${spaceId}`;
    const normalizedEmail = email.toLowerCase().trim();
    let verifiedMetadata: Record<string, unknown> = {};
    try {
      const existingSession = localStorage.getItem(sessionKey);
      if (existingSession) {
        const parsed = JSON.parse(existingSession);
        if (parsed.metadata) verifiedMetadata = parsed.metadata;
      }
    } catch {}
    const session = {
      id: finalSessionId,
      workspaceSessionId: finalSessionId,
      email: normalizedEmail,
      timestamp: Date.now(),
      verified: true,
      isReturningUser: true,
      metadata: verifiedMetadata,
    };
    localStorage.setItem(sessionKey, JSON.stringify(session));
    acceptDataSession(finalSessionId);

    try {
      window.dispatchEvent(new CustomEvent('audos:session-established', {
        detail: {
          workspaceSessionId: finalSessionId,
          email: normalizedEmail,
          verified: true,
        }
      }));
    } catch (e) {}

    setSessionId(finalSessionId);
    completeGateEntry();
    setLoading(false);
  };

  const handleGuestMode = async () => {
    setError('');
    setLoading(true);

    try {
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const sessionKey = `space_session_${spaceId}`;
      const guestSession = {
        id: guestId,
        workspaceSessionId: guestId,
        email: null,
        isGuest: true,
        timestamp: Date.now(),
        verified: true,
        metadata: {},
      };
      localStorage.setItem(sessionKey, JSON.stringify(guestSession));
      acceptDataSession(guestId);

      try {
        window.dispatchEvent(new CustomEvent('audos:session-established', {
          detail: { workspaceSessionId: guestId, isGuest: true },
        }));
      } catch (e) {}

      setSessionId(guestId);
      completeGateEntry();
    } catch (err) {
      setError('Could not continue as guest. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // `?as=visitor` preview forces the signed-out view even after a real
  // sign-in: the gate would render nothing and the visitor would land on the
  // blank-screen lock instead of the space. The session write is real (only
  // reads are shadowed under the forced-visitor preview), so drop the
  // as=visitor param and reload — the fresh session is adopted and the
  // signed-in space opens.
  const completeGateEntry = () => {
    try {
      if (typeof window !== 'undefined' && (window as any).__AUDOS_FORCE_VISITOR__ === true) {
        const url = new URL(window.location.href);
        url.searchParams.delete('as');
        window.location.replace(url.toString());
        return;
      }
    } catch (e) {}
    setStep('complete');
  };

  const handleSocialLogin = (provider: string) => {
    // Strip the forced-visitor preview flag from the OAuth return URL so the
    // visitor comes back to the signed-in space, not the forced signed-out view.
    let socialReturnTo = window.location.href;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('as');
      socialReturnTo = url.toString();
    } catch (e) {}
    const returnUrl = encodeURIComponent(socialReturnTo);
    const url = workspaceId
      ? `/api/auth/social/${provider}?workspaceId=${workspaceId}&spaceId=${spaceId}&returnUrl=${returnUrl}`
      : `/api/auth/social/${provider}?spaceId=${spaceId}&returnUrl=${returnUrl}`;
    window.location.href = url;
  };

  function getVisitorId(): string {
    const key = 'audos_visitor_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `v_${Math.random().toString(36).substring(2)}_${Date.now()}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  function getAttrCookie(): Record<string, string> | null {
    try {
      const raw = localStorage.getItem('audos_attribution');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setAttrCookie(jsonStr: string) {
    const ATTR_COOKIE_NAME = 'audos_attr';
    const MULTI_LEVEL_TLDS = ['co.uk','co.za','co.in','co.jp','co.kr','co.nz','com.au','com.br','com.cn','com.mx','com.sg','com.hk','com.tw','com.ar','com.co','com.eg','com.my','com.ng','com.pe','com.ph','com.pk','com.tr','com.ua','com.vn','org.uk','org.au','net.au','net.uk','ac.uk','gov.uk','gov.au','edu.au','ne.jp','or.jp'];
    const hostname = window.location.hostname;
    const platformDomains = [
      'replit.dev', 'replit.app', 'repl.co',
      'github.io', 'herokuapp.com', 'netlify.app', 'vercel.app',
      'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
      'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
      'ngrok.io', 'ngrok.app', 'railway.app', 'render.com',
      'fly.dev', 'deno.dev', 'glitch.me'
    ];
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
    let isPlatform = false;
    for (let i = 0; i < platformDomains.length; i++) {
      if (hostname.endsWith('.' + platformDomains[i]) || hostname === platformDomains[i]) {
        isPlatform = true;
        break;
      }
    }
    let domainPart = '';
    if (!isLocalhost && !isIP && !isPlatform) {
      const parts = hostname.split('.');
      const lastTwo = parts.slice(-2).join('.');
      if (MULTI_LEVEL_TLDS.indexOf(lastTwo) !== -1 && parts.length >= 3) {
        domainPart = '; domain=.' + parts.slice(-3).join('.');
      } else if (parts.length >= 2) {
        domainPart = '; domain=.' + parts.slice(-2).join('.');
      }
    }
    const isSecure = window.location.protocol === 'https:';
    const secureFlag = isSecure ? '; Secure' : '';
    document.cookie = ATTR_COOKIE_NAME + '=' + encodeURIComponent(jsonStr) + '; max-age=86400; path=/' + domainPart + '; SameSite=Lax' + secureFlag;
  }

  function storeAttribution() {
    const params = new URLSearchParams(window.location.search);
    const hasUtm = params.has('utm_source') || params.has('utm_medium') || params.has('utm_campaign') || params.has('fbclid') || params.has('gclid') || params.has('ref');
    if (!hasUtm) return;

    const attr: Record<string, string> = { capturedAt: Date.now().toString() };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref'].forEach(p => {
      const v = params.get(p);
      if (v) attr[p === 'ref' ? 'referrer' : p.replace('utm_', 'utm').replace('_', '')] = v;
    });
    if (document.referrer) attr.httpReferrer = document.referrer;

    try {
      localStorage.setItem('audos_attribution', JSON.stringify(attr));
    } catch {}

    const cookieAttr: Record<string, string> = { capturedAt: new Date().toISOString() };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref'].forEach(p => {
      const v = params.get(p);
      if (v) cookieAttr[p] = v;
    });
    if (document.referrer) cookieAttr.httpReferrer = document.referrer;
    try {
      setAttrCookie(JSON.stringify(cookieAttr));
      console.log('[EmailGate] Attribution stored in cookie:', cookieAttr);
    } catch {}
  }

  async function fireLeadEventWithRetry(emailAddr: string, attempt = 0) {
    const normalizedEmail = emailAddr.toLowerCase().trim();
    // Task #1480: stable conversion id used for both client-side rdt('track','Lead', …)
    // and server-side Reddit CAPI so they dedupe.
    const conversionId = `lead_${spaceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tryFireFbq = (): boolean => {
      const trackMeta = (window as any).__audosTrackMetaEvent;
      if (typeof trackMeta === 'function') {
        const eventId = trackMeta('Lead', {
          content_name: 'Email Capture',
          content_category: 'space',
        });
        if (eventId) {
          console.log('[EmailGate] Meta Pixel Lead event fired for:', emailAddr, 'eventId:', eventId);
          return true;
        }
      }
      if (typeof (window as any).fbq === 'function') {
        const pixelId = (window as any).__META_PIXEL_ID__;
        if (!pixelId) return false;
        const eventId = `meta_lead_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        (window as any).fbq('trackSingle', String(pixelId), 'Lead', {
          content_name: 'Email Capture',
          content_category: 'space',
        }, {
          eventID: eventId
        });
        console.log('[EmailGate] Meta Pixel Lead event fired for:', emailAddr, 'eventId:', eventId);
        return true;
      }
      return false;
    };

    if (!tryFireFbq()) {
      console.log('[EmailGate] fbq not ready, will retry with exponential backoff...');
      const maxRetries = 5;
      const delays = [100, 200, 400, 800, 1600];

      const retryWithBackoff = (retryAttempt: number) => {
        if (retryAttempt >= maxRetries) {
          console.warn('[EmailGate] Failed to fire Lead event - fbq never loaded after 5 retries');
          return;
        }
        setTimeout(() => {
          if (tryFireFbq()) {
            console.log(`[EmailGate] Lead event fired after ${retryAttempt + 1} retries`);
          } else {
            retryWithBackoff(retryAttempt + 1);
          }
        }, delays[retryAttempt]);
      };

      retryWithBackoff(0);
    }

    // Task #1480: Reddit Pixel Lead (parallel to Meta). We call window.rdt
    // directly — the queue stub installed by the injected PageVisit snippet
    // (Task #1456, already live) handles late pixel.js loads, so we don’t
    // need the exponential-backoff retry the Meta path uses. Re-running
    // rdt('init', …, { email, externalId }) propagates advanced matching for
    // the subsequent Lead event (Reddit "Step 3: Set up match keys").
    try {
      const rdt = (window as any).rdt;
      const pixelId = (window as any).__REDDIT_PIXEL_ID__;
      if (typeof rdt === 'function') {
        if (pixelId) {
          rdt('init', pixelId, { email: normalizedEmail, externalId: getVisitorId() });
        }
        rdt('track', 'Lead', { conversionId });
        console.log('[EmailGate] Reddit Pixel Lead event fired (conversionId=' + conversionId + ')');
      }
    } catch (e) {
      console.warn('[EmailGate] Reddit Pixel Lead failed:', e);
    }

    if (!workspaceId) return;
    try {
      await fetch(`/api/space/${spaceId}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'lead',
          sessionId: `lead_${Date.now()}`,
          visitorId: getVisitorId(),
          // Task #1480: include conversionId so server-side Reddit CAPI dedupes
          // with the client-side rdt('track','Lead',…) fired above.
          conversionId,
          metadata: { email: emailAddr, conversionId, ...getAttribution() },
          workspaceId,
        }),
      });
    } catch {
      if (attempt < 2) setTimeout(() => fireLeadEventWithRetry(emailAddr, attempt + 1), 2000);
    }
  }

  const getAttribution = () => {
    const params = new URLSearchParams(window.location.search);

    const urlAttribution: Record<string, string | null> = {};
    if (params.get('utm_source')) urlAttribution.utmSource = params.get('utm_source');
    if (params.get('utm_medium')) urlAttribution.utmMedium = params.get('utm_medium');
    if (params.get('utm_campaign')) urlAttribution.utmCampaign = params.get('utm_campaign');
    if (params.get('utm_content')) urlAttribution.utmContent = params.get('utm_content');
    if (params.get('utm_term')) urlAttribution.utmTerm = params.get('utm_term');
    if (params.get('fbclid')) urlAttribution.fbclid = params.get('fbclid');
    if (params.get('gclid')) urlAttribution.gclid = params.get('gclid');
    if (params.get('ref')) urlAttribution.referrer = params.get('ref');
    if (document.referrer) urlAttribution.httpReferrer = document.referrer;

    const storedAttr = getAttrCookie();

    const merged: Record<string, string | null> = {};
    if (storedAttr) {
      for (const [key, value] of Object.entries(storedAttr)) {
        if (value && key !== 'capturedAt') merged[key] = value;
      }
    }
    for (const [key, value] of Object.entries(urlAttribution)) {
      if (value) merged[key] = value;
    }

    return Object.keys(merged).length > 0 ? merged : null;
  };

  // ── Prismatic Refraction palette ───────────────────────────────────────
  // The landing / gate deliberately uses a fixed dark-glass palette (rather
  // than the per-space light tokens) so it reads like a high-end video tool.
  // The OTP screen below shares these tokens so both states match.
  const brandName = branding?.name || 'VidVerge';
  const tagline = branding?.tagline || 'Create. Transform. Publish.';
  const logoUrl = branding?.logoUrl || 'https://storage.googleapis.com/audos-images/attachments/general/c0902809-6dc4-4e0c-b04e-1f60e01b31e6.png';

  const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const bodyFontStack = FONT;
  const headingFontStack = FONT;

  const panelColor = colorWithAlpha('#FFFFFF', 0.04);
  const borderColor = PRISM_BORDER;
  const textPrimary = PRISM_TEXT;
  const textMuted = PRISM_TEXT_SECONDARY;
  const textSubtle = PRISM_TEXT_MUTED;

  // Injected CSS for the things inline styles cannot express: keyframes, the
  // spectral edge glow on hover, focus rings, and the responsive grids.
  // rlo-* rules dress the OTP screen; prism-* rules dress the landing page.
  const RLO_STYLES = `
@keyframes rloBrandDrift { 0%,100%{transform:translate(-50%,-52%) scale(1) rotate(0deg);opacity:.07;} 50%{transform:translate(-46%,-48%) scale(1.05) rotate(2deg);opacity:.13;} }
.rlo-cta { transition: transform .2s ease, box-shadow .3s ease, filter .2s ease; }
.rlo-cta:hover { transform: translateY(-2px); filter: brightness(1.06); box-shadow: 0 0 40px rgba(144,96,255,0.45); }
.rlo-input::placeholder { color: rgba(255,255,255,0.36); }
.rlo-input:focus { border-color: rgba(144,96,255,0.7) !important; box-shadow: 0 0 0 3px rgba(144,96,255,0.22) !important; outline: none; }
@keyframes prismShift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes prismaticEdge {
  0%,100% { box-shadow: 0 0 0 1.5px rgba(255,96,144,0.7), 0 0 28px rgba(255,96,144,0.22); }
  16.6%   { box-shadow: 0 0 0 1.5px rgba(255,144,96,0.7), 0 0 28px rgba(255,144,96,0.22); }
  33.3%   { box-shadow: 0 0 0 1.5px rgba(255,208,96,0.7), 0 0 28px rgba(255,208,96,0.22); }
  50%     { box-shadow: 0 0 0 1.5px rgba(96,255,160,0.7), 0 0 28px rgba(96,255,160,0.22); }
  66.6%   { box-shadow: 0 0 0 1.5px rgba(96,192,255,0.7), 0 0 28px rgba(96,192,255,0.22); }
  83.3%   { box-shadow: 0 0 0 1.5px rgba(144,96,255,0.7), 0 0 28px rgba(144,96,255,0.22); }
}
@keyframes prismFadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
@keyframes prismGlow { 0%,100% { opacity:.18; } 50% { opacity:.32; } }
.prism-fade { animation: prismFadeUp .9s cubic-bezier(.16,1,.3,1) both; }
.prism-glow { animation: prismGlow 7s ease-in-out infinite; }
.prism-btn {
  background: linear-gradient(135deg, #ff6090, #9060ff);
  background-size: 200% 200%;
  animation: prismShift 5s ease infinite;
  transition: transform .2s ease, box-shadow .25s ease;
}
.prism-btn:hover { transform: translateY(-2px); box-shadow: 0 0 40px rgba(144,96,255,0.55), 0 12px 32px rgba(255,96,144,0.35); }
.prism-ghost {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.22);
  transition: background .2s ease, border-color .2s ease;
}
.prism-ghost:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.44); }
.prism-card { transition: transform .3s ease; }
.prism-card:hover { transform: translateY(-5px) scale(1.015); }
.prism-video-card { position: relative; overflow: hidden; border-radius: 12px; cursor: pointer; transition: transform .35s cubic-bezier(.16,1,.3,1); }
.prism-video-card:hover, .prism-video-card:focus-visible { transform: scale(1.04); animation: prismaticEdge 3s linear infinite; outline: none; z-index: 3; }
.prism-video-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(6,6,15,0.82) 0%, transparent 55%); opacity: 0; transition: opacity .3s ease; display: flex; flex-direction: column; justify-content: flex-end; padding: 16px; }
.prism-video-card:hover .prism-video-overlay, .prism-video-card:focus-visible .prism-video-overlay { opacity: 1; }
.prism-input::placeholder { color: rgba(255,255,255,0.36); }
.prism-input:focus { border-color: rgba(144,96,255,0.7) !important; box-shadow: 0 0 0 3px rgba(144,96,255,0.22) !important; outline: none; }
.prism-label-text {
  background: linear-gradient(135deg, #ff6090, #ff9060, #ffd060, #60ffa0, #60c0ff, #9060ff);
  background-size: 300% 300%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: prismShift 8s ease infinite;
}
.prism-link { transition: color .2s ease; }
.prism-link:hover { color: #ffffff; }
.prism-wall { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.prism-strip { display: flex; flex-direction: row; gap: 48px; align-items: center; position: relative; }
.prism-strip-reverse { flex-direction: row-reverse; }
.prism-strip::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, #ff6090, #9060ff); }
.prism-strip-media { width: 40%; flex-shrink: 0; }
.prism-strip-text { width: 60%; }
.prism-form-row { display: flex; align-items: stretch; gap: 12px; }
.prism-form-row > input { flex: 1 1 auto; min-width: 0; }
.prism-motion-clip { width: 100%; height: 100%; object-fit: cover; display: block; }
.prism-feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.prism-step { display: flex; flex-direction: row; gap: 56px; align-items: center; }
.prism-step-reverse { flex-direction: row-reverse; }
.prism-step-media, .prism-step-text { width: 50%; flex-shrink: 0; min-width: 0; }
.prism-reel { display: flex; gap: 16px; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding: 4px 24px 20px; }
.prism-reel::-webkit-scrollbar { display: none; }
.prism-reel-item { position: relative; flex: 0 0 min(72vw, 300px); aspect-ratio: 9 / 16; scroll-snap-align: center; border-radius: 14px; overflow: hidden; background: #0d0d1a; border: 1px solid rgba(255,255,255,0.06); }
@media (max-width: 900px) {
  .prism-wall { grid-template-columns: repeat(2, 1fr); }
  .prism-strip, .prism-strip-reverse { flex-direction: column; gap: 20px; }
  .prism-strip-media, .prism-strip-text { width: 100%; }
  .prism-feature-grid { grid-template-columns: 1fr; }
  .prism-step, .prism-step-reverse { flex-direction: column; gap: 24px; }
  .prism-step-media, .prism-step-text { width: 100%; }
}
@media (max-width: 600px) { .prism-wall { grid-template-columns: 1fr; } .prism-form-row { flex-direction: column; } }
@media (prefers-reduced-motion: reduce) {
  .prism-fade, .prism-btn, .prism-label-text, .prism-glow, .rlo-brand-motion { animation: none !important; }
  .prism-video-card:hover, .prism-video-card:focus-visible, .prism-card:hover { transform: none; animation: none !important; }
}
`;

  // Brand logo mark
  const BrandMark = ({ size = 40 }: { size?: number }) => {
    if (logoUrl) {
      return (
        <img
          src={logoUrl}
          alt={brandName}
          style={{ width: size * 1.4, height: size, objectFit: 'cover', objectPosition: 'center', mixBlendMode: 'screen', filter: 'drop-shadow(0 0 16px rgba(144,96,255,0.45))' }}
        />
      );
    }
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.28,
          background: PRISM_GRADIENT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#06060f',
          fontWeight: 800,
          fontSize: size * 0.42,
          fontFamily: FONT,
          flexShrink: 0,
          boxShadow: PRISM_EDGE_GLOW,
        }}
      >
        {brandName.charAt(0).toUpperCase()}
      </div>
    );
  };

  if (step === 'loading' || step === 'complete') {
    return null;
  }

  // OTP Code verification screen
  if (step === 'code') {
    return (
      <div
        className="min-h-screen flex flex-col overflow-y-auto"
        style={{ fontFamily: bodyFontStack, background: `radial-gradient(900px 520px at 50% -10%, rgba(144,96,255,0.12), transparent 62%), radial-gradient(760px 480px at 8% 108%, rgba(255,96,144,0.08), transparent 64%), ${PRISM_CANVAS}` }}
      >
        <style>{RLO_STYLES}</style>
        {/* Animated brand-icon motion background — fixed, behind all content,
            pointer-events off so it can never trap a tap or cause scroll. */}
        <div aria-hidden style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          <img
            className="rlo-brand-motion"
            src={logoUrl}
            alt=""
            style={{ position: 'absolute', left: '50%', top: '50%', width: 'min(56vmax, 900px)', height: 'min(56vmax, 900px)', objectFit: 'contain', transform: 'translate(-50%,-52%)', mixBlendMode: 'screen', opacity: 0.12, animation: 'rloBrandDrift 24s ease-in-out infinite', willChange: 'transform, opacity' }}
          />
        </div>
        <div className="flex-1 flex items-center justify-center px-6 py-12" style={{ position: 'relative', zIndex: 1 }}>
          <div className="w-full max-w-sm">
            <div className="text-center mb-10">
              <div className="flex justify-center mb-4">
                <BrandMark size={48} />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight" style={{ color: textPrimary, fontFamily: headingFontStack }}>
                Check your inbox
              </h1>
              <p className="mt-2 text-sm" style={{ color: textMuted }}>
                We sent a 4-digit code to<br />
                <span className="font-medium" style={{ color: textPrimary }}>{email}</span>
              </p>
              <p className="mt-3 text-xs" style={{ color: textSubtle }}>
                can’t find it? Check your spam or junk folder.
              </p>
            </div>

            <form onSubmit={handleCodeSubmit} className="space-y-5">
              <div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={code}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setCode(val);
                    setError('');
                  }}
                  placeholder="0000"
                  className="w-full px-4 py-3.5 text-center text-2xl tracking-[0.5em] font-mono rounded-xl focus:outline-none transition-all rlo-input"
                  style={{
                    background: panelColor,
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: `1px solid ${error ? 'rgba(255,96,144,0.6)' : borderColor}`,
                    color: textPrimary,
                  }}
                  disabled={loading}
                  autoFocus
                  data-testid="input-code"
                />
                {error && (
                  <p className="mt-2 text-xs" style={{ color: '#ff8fae' }} data-testid="text-error">
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || code.length !== 4}
                className="w-full py-3.5 rounded-xl font-semibold text-base transition-all rlo-cta"
                style={{
                  background: loading || code.length !== 4 ? 'rgba(240,240,244,0.14)' : PRISM_GRADIENT,
                  color: loading || code.length !== 4 ? textSubtle : '#06060f',
                  border: 'none',
                  cursor: loading || code.length !== 4 ? 'not-allowed' : 'pointer',
                  boxShadow: loading || code.length !== 4 ? 'none' : PRISM_EDGE_GLOW,
                }}
                data-testid="button-verify"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>
            </form>

            {deliveryNotice && (
              <div
                className="mt-4 rounded-xl px-4 py-3 text-sm"
                style={{
                  background: 'rgba(255,217,61,0.08)',
                  border: '1px solid rgba(255,217,61,0.22)',
                  color: '#FFD93D',
                }}
                data-testid="text-delivery-notice"
              >
                {deliveryNotice}
              </div>
            )}

            <div className="text-center mt-6 space-x-4">
              <button
                onClick={handleResendCode}
                disabled={resendCooldown > 0 || loading}
                className="text-sm transition-colors"
                style={{ color: resendCooldown > 0 ? textSubtle : textPrimary }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
              <span style={{ color: textSubtle }}>|</span>
              <button
                onClick={() => { setStep('email'); setCode(''); setError(''); setDeliveryNotice(''); }}
                className="text-sm transition-colors"
                style={{ color: textMuted }}
              >
                Change email
              </button>
            </div>
          </div>
        </div>

        <div className="pb-8 text-center">
          <p className="text-xs" style={{ color: textSubtle }}>
            Your data is private and secure
          </p>
        </div>
      </div>
    );
  }

  // ── Prismatic Refraction signed-out landing ─────────────────────────────
  // A void-dark canvas, translucent glass surfaces, and spectral edge glows:
  // light bending through a prism. Presentation only — every CTA routes into
  // the untouched email / OTP flow above.
  const scrollToGate = () => {
    try {
      bottomCtaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {}
    window.setTimeout(() => {
      try {
        bottomEmailInputRef.current?.focus({ preventScroll: true });
      } catch {}
    }, 600);
  };

  const scrollToWall = () => {
    try {
      videoWallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {}
  };

  const previewPlay = (el: HTMLVideoElement | null) => {
    if (!el) return;
    try {
      const played = el.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    } catch {}
  };

  const previewStop = (el: HTMLVideoElement | null) => {
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {}
  };

  // iOS Safari only exposes fullscreen on the video element itself, so try
  // every vendor entry point and stay silent when none of them is allowed.
  const openFullscreen = (el: HTMLVideoElement | null) => {
    if (!el) return;
    const candidate = el as any;
    const request =
      candidate.requestFullscreen || candidate.webkitRequestFullscreen || candidate.webkitEnterFullscreen;
    if (typeof request !== 'function') return;
    try {
      previewPlay(el);
      const result = request.call(el);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  };

  const wordmarkStyle = {
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: '0.22em',
    textTransform: 'uppercase' as const,
    color: textPrimary,
  };

  // One form, rendered twice: the hero copy is primary and the bottom-CTA
  // copy is what every "Start Creating" button scrolls to. Both submit
  // through the same untouched handleEmailSubmit.
  const renderEmailForm = (variant: 'hero' | 'bottom') => {
    const isBottom = variant === 'bottom';
    const suffix = isBottom ? '-bottom' : '';

    return (
      <form onSubmit={handleEmailSubmit} style={{ width: '100%', maxWidth: 540, margin: '0 auto' }}>
        <div className="prism-form-row">
          <input
            ref={isBottom ? bottomEmailInputRef : emailInputRef}
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            placeholder="you@email.com"
            className="prism-input"
            disabled={loading}
            autoComplete="email"
            data-testid={`input-email${suffix}`}
            style={{
              padding: '16px 18px',
              fontSize: 16,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${error ? 'rgba(255,96,144,0.6)' : 'rgba(255,255,255,0.12)'}`,
              color: textPrimary,
              outline: 'none',
              fontFamily: bodyFontStack,
            }}
          />
          <button
            type="submit"
            disabled={loading}
            className="prism-btn"
            data-testid={`button-get-started${suffix}`}
            style={{
              padding: '16px 28px',
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '0.03em',
              borderRadius: 12,
              whiteSpace: 'nowrap',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              color: PRISM_TEXT,
              opacity: loading ? 0.65 : 1,
            }}
          >
            {loading ? 'Sending…' : 'Start Free →'}
          </button>
        </div>

        {error && (
          <p
            style={{ marginTop: 12, fontSize: 13, color: '#ff8fae', textAlign: 'center' }}
            data-testid={`text-error${suffix}`}
          >
            {error}
          </p>
        )}

        {gdprEnabled && (
          <div style={{ marginTop: 16, textAlign: 'left' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: textMuted, lineHeight: 1.6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                style={{ marginTop: 3, width: 16, height: 16, accentColor: '#9060ff', flexShrink: 0 }}
                data-testid={`checkbox-consent${suffix}`}
              />
              <span>
                I agree to receive marketing emails and accept the{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="prism-link" style={{ color: textPrimary, textDecoration: 'underline' }}>
                  privacy policy
                </a>
                . Unsubscribe anytime.
              </span>
            </label>
          </div>
        )}

        <p style={{ margin: '18px 0 0', fontSize: 11.5, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: PRISM_MONO, color: textSubtle, textAlign: 'center' }}>
          No credit card · 30 free credits · Instant access
        </p>

        {(socialProviders.length > 0 || guestModeEnabled) && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {socialProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => handleSocialLogin(provider)}
                className="prism-ghost"
                style={{
                  width: '100%',
                  padding: '13px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 12,
                  color: textMuted,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                Continue with {provider}
              </button>
            ))}
            {guestModeEnabled && (
              <button
                type="button"
                onClick={handleGuestMode}
                className="prism-link"
                style={{ background: 'none', border: 'none', color: textSubtle, fontSize: 13, cursor: 'pointer', marginTop: 2 }}
              >
                Continue as guest
              </button>
            )}
          </div>
        )}
      </form>
    );
  };

  // ── Motion sections ─────────────────────────────────────────────────────
  // Five autoplay-video blocks between the capability strips and the bottom
  // gate. Every clip is a PLACEHOLDER_CLIPS slot; muted + playsInline is what
  // lets iOS Safari and Chrome start them unattended, and `reduceMotion`
  // turns each one into its poster still.
  const renderMotionClip = (slot: MotionClipSlot, style?: React.CSSProperties) => {
    const clip = clipFor(slot);
    return (
      <video
        className="prism-motion-clip"
        src={clip.url}
        poster={clip.poster}
        autoPlay={!reduceMotion}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden
        tabIndex={-1}
        style={style}
      />
    );
  };

  const sectionLabelStyle = {
    display: 'block',
    marginBottom: 16,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.22em',
    textTransform: 'uppercase' as const,
  };

  const sectionHeadingStyle = {
    margin: '0 0 12px',
    fontFamily: headingFontStack,
    fontSize: 'clamp(32px, 5vw, 48px)',
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    color: textPrimary,
  };

  const renderMotionHero = () => (
    <section style={{ position: 'relative', minHeight: '72vh', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        {renderMotionClip('hero')}
      </div>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          background:
            'linear-gradient(to bottom, rgba(6,6,15,0.97) 0%, rgba(6,6,15,0.55) 35%, rgba(6,6,15,0.6) 65%, rgba(6,6,15,0.97) 100%)',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          width: '100%',
          maxWidth: 900,
          margin: '0 auto',
          padding: '96px 24px',
          textAlign: 'center',
        }}
      >
        <span className="prism-label-text" style={sectionLabelStyle}>
          Direct the whole thing
        </span>
        <h2
          style={{
            margin: '0 0 18px',
            fontFamily: headingFontStack,
            fontSize: 'clamp(40px, 7vw, 72px)',
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 0.98,
            color: textPrimary,
          }}
        >
          Every frame, on your terms.
        </h2>
        <p style={{ margin: '0 auto 32px', maxWidth: 560, fontSize: 18, lineHeight: 1.6, color: textMuted }}>
          Characters that stay in character, scripts that cut themselves, effects that land on the first render.
        </p>
        <button
          type="button"
          onClick={scrollToGate}
          className="prism-btn"
          data-testid="button-motion-hero-start"
          style={{
            padding: '15px 32px',
            borderRadius: 999,
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.03em',
            border: 'none',
            cursor: 'pointer',
            color: PRISM_TEXT,
          }}
        >
          Start Creating
        </button>
      </div>
    </section>
  );

  const renderFeatureStrip = () => (
    <section style={{ padding: '80px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <span className="prism-label-text" style={sectionLabelStyle}>
            Built for the hard parts
          </span>
          <h2 style={sectionHeadingStyle}>Three things other tools get wrong.</h2>
        </div>

        <div className="prism-feature-grid">
          {FEATURE_COLUMNS.map((feature) => (
            <div
              key={feature.slot}
              className="prism-card"
              style={{
                borderRadius: 16,
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div style={{ aspectRatio: '4 / 3', background: '#0d0d1a' }}>
                {renderMotionClip(feature.slot)}
              </div>
              <div style={{ padding: '22px 24px 26px' }}>
                <h3
                  style={{
                    margin: '0 0 8px',
                    fontFamily: headingFontStack,
                    fontSize: 19,
                    fontWeight: 700,
                    letterSpacing: '-0.01em',
                    color: textPrimary,
                  }}
                >
                  {feature.title}
                </h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: textMuted }}>{feature.copy}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const renderHowItWorks = () => (
    <section style={{ padding: '80px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="prism-label-text" style={sectionLabelStyle}>
            How it works
          </span>
          <h2 style={sectionHeadingStyle}>Brief in. Video out.</h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 64 }}>
          {WORKFLOW_STEPS.map((workflowStep, i) => (
            <div
              key={workflowStep.slot}
              className={`prism-step${i % 2 === 1 ? ' prism-step-reverse' : ''}`}
            >
              <div
                className="prism-step-media"
                style={{
                  borderRadius: 16,
                  overflow: 'hidden',
                  aspectRatio: '16 / 10',
                  background: '#0d0d1a',
                  border: '1px solid rgba(255,255,255,0.06)',
                  boxShadow: PRISM_EDGE_GLOW,
                }}
              >
                {renderMotionClip(workflowStep.slot)}
              </div>

              <div className="prism-step-text">
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    marginBottom: 18,
                    background: PRISM_GRADIENT,
                    color: PRISM_CANVAS,
                    fontFamily: PRISM_MONO,
                    fontSize: 14,
                    fontWeight: 800,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3
                  style={{
                    margin: '0 0 12px',
                    fontFamily: headingFontStack,
                    fontSize: 'clamp(24px, 3.2vw, 32px)',
                    fontWeight: 800,
                    letterSpacing: '-0.025em',
                    lineHeight: 1.1,
                    color: textPrimary,
                  }}
                >
                  {workflowStep.title}
                </h3>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: textMuted }}>{workflowStep.copy}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const renderResultsReel = () => (
    <section style={{ padding: '80px 0' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto 36px', padding: '0 24px', textAlign: 'center' }}>
        <span className="prism-label-text" style={sectionLabelStyle}>
          Results reel
        </span>
        <h2 style={sectionHeadingStyle}>Straight out of the render queue.</h2>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: textMuted }}>
          Untouched exports. Scroll sideways.
        </p>
      </div>

      <div className="prism-reel" aria-label="Sample VidVerge outputs">
        {RESULTS_REEL.map((item) => (
          <div key={item.slot} className="prism-reel-item">
            {renderMotionClip(item.slot)}
            <div
              style={{
                position: 'absolute',
                left: 12,
                bottom: 12,
                padding: '5px 10px',
                borderRadius: 999,
                background: 'rgba(6,6,15,0.7)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontFamily: PRISM_MONO,
                color: 'rgba(255,255,255,0.75)',
              }}
            >
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const renderFinalCta = () => (
    <section style={{ position: 'relative', overflow: 'hidden', padding: '140px 24px', background: PRISM_CANVAS }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, opacity: 0.55 }}>
        {renderMotionClip('final-cta', { filter: 'saturate(0.7) blur(2px)', transform: 'scale(1.06)' })}
      </div>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          background: `radial-gradient(ellipse at center, rgba(6,6,15,0.35) 0%, rgba(6,6,15,0.92) 70%, ${PRISM_CANVAS} 100%)`,
        }}
      />
      <div style={{ position: 'relative', zIndex: 2, maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
        <h2
          style={{
            margin: '0 0 16px',
            fontFamily: headingFontStack,
            fontSize: 'clamp(36px, 6vw, 64px)',
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            color: textPrimary,
          }}
        >
          Your first video is one brief away.
        </h2>
        <p style={{ margin: '0 auto 36px', maxWidth: 520, fontSize: 17, lineHeight: 1.6, color: textMuted }}>
          Join the creators already shipping with VidVerge. Early access is free.
        </p>
        <button
          type="button"
          onClick={scrollToGate}
          className="prism-btn"
          data-testid="button-get-early-access"
          style={{
            padding: '17px 40px',
            borderRadius: 999,
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.03em',
            border: 'none',
            cursor: 'pointer',
            color: PRISM_TEXT,
            boxShadow: PRISM_EDGE_GLOW,
          }}
        >
          Get Early Access
        </button>
      </div>
    </section>
  );

  return (
    <div
      className="min-h-screen"
      style={{ fontFamily: bodyFontStack, background: PRISM_CANVAS, color: textPrimary }}
    >
      <style>{RLO_STYLES}</style>

      {/* ===== 1 · STICKY NAV ===== */}
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '0 24px',
          background: 'rgba(6,6,15,0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <BrandMark size={28} />
          <span style={wordmarkStyle}>{brandName}</span>
        </div>
        <button
          type="button"
          onClick={scrollToGate}
          className="prism-btn"
          data-testid="button-nav-start"
          style={{
            padding: '10px 20px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            border: 'none',
            cursor: 'pointer',
            color: PRISM_TEXT,
          }}
        >
          Start Creating
        </button>
      </nav>

      {/* ===== 2 · HERO ===== */}
      <section style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', display: 'flex' }}>
        <video
          src={HERO_VIDEO_URL}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
          tabIndex={-1}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            background:
              'linear-gradient(to bottom, rgba(6,6,15,0.35) 0%, rgba(6,6,15,0.55) 50%, rgba(6,6,15,0.97) 100%)',
          }}
        />

        <div
          style={{
            position: 'relative',
            zIndex: 2,
            width: '100%',
            maxWidth: 980,
            margin: '0 auto',
            padding: '120px 24px 100px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div className="prism-fade" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 30 }}>
            <BrandMark size={36} />
            <span style={{ ...wordmarkStyle, fontSize: 16 }}>{brandName}</span>
          </div>

          <h1
            className="prism-fade"
            style={{
              margin: '0 0 18px',
              fontFamily: headingFontStack,
              fontWeight: 900,
              letterSpacing: '-0.045em',
              lineHeight: 0.92,
              fontSize: 'clamp(64px, 11vw, 104px)',
              color: textPrimary,
            }}
          >
            {brandName.toUpperCase()}
          </h1>

          {/* Fixed three-beat line, not `tagline` — the brand tagline is a
              full sentence and reads as noise at this letter-spacing. */}
          <p
            className="prism-fade"
            style={{
              margin: '0 0 20px',
              fontSize: 18,
              fontWeight: 300,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.72)',
            }}
          >
            Create. Transform. Publish.
          </p>

          <p
            className="prism-fade"
            style={{ margin: '0 auto', maxWidth: 540, fontSize: 18, lineHeight: 1.6, color: textMuted }}
          >
            AI-powered video tools for turning ideas into scroll-stopping videos.
          </p>

          <div
            className="prism-fade"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', margin: '36px 0 40px' }}
          >
            <button
              type="button"
              onClick={scrollToGate}
              className="prism-btn"
              data-testid="button-start-creating"
              style={{
                padding: '15px 32px',
                borderRadius: 999,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: '0.03em',
                border: 'none',
                cursor: 'pointer',
                color: PRISM_TEXT,
              }}
            >
              Start Creating
            </button>
            <button
              type="button"
              onClick={scrollToWall}
              className="prism-ghost"
              data-testid="button-watch-video"
              style={{
                padding: '15px 30px',
                borderRadius: 999,
                fontSize: 15,
                fontWeight: 600,
                color: textPrimary,
                cursor: 'pointer',
              }}
            >
              Explore Videos ↓
            </button>
          </div>

          <div className="prism-fade" style={{ width: '100%' }}>
            {renderEmailForm('hero')}
          </div>
        </div>

        {/* Refracted light spilling out of the bottom edge of the hero. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 3,
            height: 4,
            opacity: 0.3,
            background: PRISM_GRADIENT,
          }}
        />
      </section>

      {/* ===== 3 · MADE WITH VIDVERGE ===== */}
      <section id="video-wall" ref={videoWallRef} style={{ padding: '96px 24px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <span
              className="prism-label-text"
              style={{
                display: 'block',
                marginBottom: 16,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
              }}
            >
              Made with VidVerge
            </span>
            <h2
              style={{
                margin: '0 0 12px',
                fontFamily: headingFontStack,
                fontSize: 'clamp(36px, 6vw, 56px)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1.05,
                color: textPrimary,
              }}
            >
              {'Don\u2019t take our word for it.'}
            </h2>
            <p style={{ margin: 0, fontSize: 19, lineHeight: 1.6, color: textMuted }}>
              Look at what VidVerge makes.
            </p>
          </div>

          <div className="prism-wall">
            {showcaseVideos.map((item, i) => (
              <div
                key={item.url}
                className="prism-video-card"
                role="button"
                tabIndex={0}
                aria-label={`Play ${item.label}`}
                onMouseEnter={() => previewPlay(videoWallRefs.current[i])}
                onMouseLeave={() => previewStop(videoWallRefs.current[i])}
                onFocus={() => previewPlay(videoWallRefs.current[i])}
                onBlur={() => previewStop(videoWallRefs.current[i])}
                onClick={() => openFullscreen(videoWallRefs.current[i])}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openFullscreen(videoWallRefs.current[i]);
                  }
                }}
                style={{
                  aspectRatio: '16 / 9',
                  background: '#0d0d1a',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <video
                  ref={(el) => { videoWallRefs.current[i] = el; }}
                  src={item.url}
                  muted
                  loop
                  playsInline
                  preload="none"
                  tabIndex={-1}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />

                <div className="prism-video-overlay">
                  <p
                    style={{
                      margin: '0 0 6px',
                      fontSize: 11,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      fontFamily: PRISM_MONO,
                      color: 'rgba(255,255,255,0.55)',
                    }}
                  >
                    Created with VidVerge
                  </p>
                  <span className="prism-label-text" style={{ fontSize: 13, fontWeight: 700 }}>Try this →</span>
                </div>

                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    left: 10,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(6,6,15,0.7)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    fontFamily: PRISM_MONO,
                    color: 'rgba(255,255,255,0.75)',
                  }}
                >
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 4 · CAPABILITIES ===== */}
      <section style={{ padding: '80px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2
            style={{
              margin: '0 0 56px',
              textAlign: 'center',
              fontFamily: headingFontStack,
              fontSize: 'clamp(32px, 5vw, 48px)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              color: textPrimary,
            }}
          >
            One App. Every Kind of Video.
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {PRISM_STRIPS.map((cap, i) => (
              <div
                key={cap.label}
                className={`prism-card prism-strip${i % 2 === 1 ? ' prism-strip-reverse' : ''}`}
                onMouseEnter={() => previewPlay(capabilityRefs.current[i])}
                onMouseLeave={() => previewStop(capabilityRefs.current[i])}
                style={{
                  padding: '28px 32px',
                  borderRadius: 16,
                  overflow: 'hidden',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div
                  className="prism-strip-media"
                  style={{ borderRadius: 10, overflow: 'hidden', aspectRatio: '16 / 9', background: '#0d0d1a' }}
                >
                  <video
                    ref={(el) => { capabilityRefs.current[i] = el; }}
                    src={cap.url}
                    muted
                    loop
                    playsInline
                    preload="none"
                    tabIndex={-1}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>

                <div className="prism-strip-text">
                  <span
                    className="prism-label-text"
                    style={{
                      display: 'block',
                      marginBottom: 10,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {cap.label}
                  </span>
                  <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600, color: textPrimary }}>{cap.desc}</p>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: textMuted }}>{cap.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 5 · MOTION HERO ===== */}
      {renderMotionHero()}

      {/* ===== 6 · FEATURE STRIP ===== */}
      {renderFeatureStrip()}

      {/* ===== 7 · HOW IT WORKS ===== */}
      {renderHowItWorks()}

      {/* ===== 8 · RESULTS REEL ===== */}
      {renderResultsReel()}

      {/* ===== 9 · FINAL CTA ===== */}
      {renderFinalCta()}

      {/* ===== 10 · BOTTOM CTA ===== */}
      <section style={{ position: 'relative', padding: '80px 24px' }}>
        <div
          aria-hidden
          className="prism-glow"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(90vw, 760px)',
            height: 'min(60vw, 460px)',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(144,96,255,0.45), transparent 68%)',
            filter: 'blur(80px)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        <div
          ref={bottomCtaRef}
          style={{
            position: 'relative',
            zIndex: 1,
            maxWidth: 640,
            margin: '0 auto',
            padding: '48px 40px',
            borderRadius: 24,
            textAlign: 'center',
            background: 'rgba(255,255,255,0.04)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: PRISM_EDGE_GLOW,
          }}
        >
          <h2
            style={{
              margin: '0 0 10px',
              fontFamily: headingFontStack,
              fontSize: 'clamp(28px, 4vw, 40px)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              color: textPrimary,
            }}
          >
            Start creating for free.
          </h2>
          <p style={{ margin: '0 0 28px', fontSize: 15, color: textMuted }}>
            No credit card required. First video on us.
          </p>

          {renderEmailForm('bottom')}
        </div>
      </section>

      {/* ===== 11 · FOOTER ===== */}
      <footer
        style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '32px 24px 48px',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
          <BrandMark size={22} />
          <span style={wordmarkStyle}>{brandName}</span>
        </div>

        <p style={{ margin: '0 0 10px', fontSize: 13, color: textMuted }}>{tagline}</p>

        <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.08em', fontFamily: PRISM_MONO, color: textSubtle }}>
          © 2026 {brandName}. All rights reserved. ·{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="prism-link" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</a>
          {' · '}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="prism-link" style={{ color: 'inherit', textDecoration: 'none' }}>Terms</a>
        </p>
      </footer>
    </div>
  );

}
