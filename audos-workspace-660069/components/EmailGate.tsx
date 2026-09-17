import { useState, useEffect } from 'react';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import type { DesktopThemeTokens } from '../types';
import LandingShowcase from './LandingShowcase';

// Version marker for auto-upgrade detection
// Increment this when making breaking changes that stale copies need
export const EMAIL_GATE_VERSION = 104; // v104: Fix session persistence across page loads; fix OTP detection (undefined vs null)

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

  // ── Veo-inspired dark cinematic theme ──────────────────────────────────
  // The landing / gate deliberately uses a fixed premium dark palette (rather
  // than the per-space light tokens) so it reads like a high-end video tool.
  const brandName = branding?.name || 'VidVerge';
  const tagline = branding?.tagline || 'Turn any idea into a publish-ready video — brief to video in one shot';
  const logoUrl = branding?.logoUrl;

  const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const bodyFontStack = FONT;
  const headingFontStack = FONT;

  const BLUE = '#2563eb';
  const INDIGO = '#1d4ed8';
  const CYAN = '#0891b2';

  const primaryColor = '#062842';
  const highlightColor = BLUE;
  const contrastColor = BLUE;
  const pageBackground = '#041d32';
  const sectionBackground = '#062842';
  const panelColor = '#0a3050';
  const panelStrongColor = '#082742';
  const borderColor = 'rgba(255,255,255,0.10)';
  const bgLight = colorWithAlpha(BLUE, 0.06);
  const bgMedium = colorWithAlpha(BLUE, 0.12);
  const textPrimary = '#ffffff';
  const textMuted = '#9ca3af';
  const textSubtle = '#6b7280';
  const onPrimary = '#ffffff';
  const heroTextPrimary = '#ffffff';
  const heroTextMuted = '#9ca3af';
  const gateGradient =
    'radial-gradient(1200px 620px at 50% -12%, rgba(37,99,235,0.18), transparent 62%), #041d32';

  // Injected CSS for things inline styles can’t express: keyframes, hover
  // glow, focus rings, and scrollbar styling for the showcase carousel.
  const RLO_STYLES = `
@keyframes rloMeshA { 0%{transform:translate(0,0) scale(1);} 50%{transform:translate(-6%,4%) scale(1.15);} 100%{transform:translate(0,0) scale(1);} }
@keyframes rloMeshB { 0%{transform:translate(0,0) scale(1);} 50%{transform:translate(6%,-5%) scale(1.12);} 100%{transform:translate(0,0) scale(1);} }
@keyframes rloFadeUp { from{opacity:0;transform:translateY(18px);} to{opacity:1;transform:translateY(0);} }
.rlo-fade { animation: rloFadeUp .8s cubic-bezier(.16,1,.3,1) both; }
.rlo-cta { transition: transform .2s ease, box-shadow .3s ease, filter .2s ease; }
.rlo-cta:hover { transform: translateY(-1px); box-shadow: 0 0 34px rgba(37,99,235,.6), 0 10px 28px rgba(29,78,216,.35); filter: brightness(1.06); }
.rlo-card { transition: transform .3s ease, box-shadow .3s ease, border-color .3s ease; }
.rlo-card:hover { transform: translateY(-5px) scale(1.02); border-color: rgba(37,99,235,.55); box-shadow: 0 20px 50px rgba(37,99,235,.28); }
.rlo-card:hover .rlo-play { transform: scale(1.1); background: rgba(255,255,255,.98); }
.rlo-play { transition: transform .3s ease, background .3s ease; }
.rlo-input::placeholder { color: #6b7280; }
.rlo-input:focus { border-color: #2563eb !important; box-shadow: 0 0 0 3px rgba(37,99,235,.28); }
.rlo-social:hover { background: rgba(255,255,255,.06) !important; border-color: rgba(255,255,255,.24) !important; }
.rlo-link { transition: color .2s ease; }
.rlo-link:hover { color: #60a5fa; }
.rlo-scroll { scrollbar-width: thin; scrollbar-color: #2a2a2a transparent; }
.rlo-scroll::-webkit-scrollbar { height: 8px; }
.rlo-scroll::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 999px; }
`;

  // Brand logo mark
  const BrandMark = ({ size = 40 }: { size?: number }) => {
    if (logoUrl) {
      return (
        <img
          src={logoUrl}
          alt={brandName}
          style={{ width: size, height: size, objectFit: 'contain', borderRadius: 8 }}
        />
      );
    }
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.28,
          background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          fontWeight: 700,
          fontSize: size * 0.42,
          fontFamily: FONT,
          flexShrink: 0,
          boxShadow: '0 6px 18px rgba(37,99,235,0.45)',
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
        style={{ fontFamily: bodyFontStack, background: 'radial-gradient(900px 500px at 50% -10%, rgba(37,99,235,0.16), transparent 60%), #041d32' }}
      >
        <style>{RLO_STYLES}</style>
        <div className="flex-1 flex items-center justify-center px-6 py-12">
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
                    backgroundColor: panelColor,
                    border: `2px solid ${error ? '#DC2626' : borderColor}`,
                    color: textPrimary,
                  }}
                  disabled={loading}
                  autoFocus
                  data-testid="input-code"
                />
                {error && (
                  <p className="mt-2 text-xs" style={{ color: '#f87171' }} data-testid="text-error">
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || code.length !== 4}
                className="w-full py-3.5 rounded-xl font-semibold text-base transition-all rlo-cta"
                style={{
                  background: loading || code.length !== 4 ? 'rgba(37,99,235,0.4)' : 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: loading || code.length !== 4 ? 'not-allowed' : 'pointer',
                  boxShadow: loading || code.length !== 4 ? 'none' : '0 8px 24px rgba(37,99,235,0.45)',
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
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  color: '#fbbf24',
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

  // Premium signed-out product showcase. Authentication state and handlers
  // above remain unchanged; the showcase only owns presentation and CTA routing.
  return (
    <LandingShowcase
      brandName={brandName}
      tagline={tagline}
      logoUrl={logoUrl}
      email={email}
      loading={loading}
      error={error}
      gdprEnabled={gdprEnabled}
      marketingConsent={marketingConsent}
      socialProviders={socialProviders}
      guestModeEnabled={guestModeEnabled}
      onEmailChange={(value: string) => {
        setEmail(value);
        setError('');
      }}
      onMarketingConsentChange={setMarketingConsent}
      onEmailSubmit={handleEmailSubmit}
      onSocialLogin={handleSocialLogin}
      onGuestMode={handleGuestMode}
    />
  );

  // Legacy landing markup remains unreachable below to keep the authentication
  // implementation untouched; the premium showcase is the only rendered surface.
  // Main email entry screen - Full landing page
  return (
    <div
      className="min-h-screen overflow-y-auto"
      style={{ fontFamily: bodyFontStack, backgroundColor: pageBackground }}
    >

      {/* ===== HERO SECTION ===== */}
      <section
        className="min-h-screen flex flex-col justify-center px-6 py-16 relative"
        style={{ background: gateGradient }}
      >
        <style>{RLO_STYLES}</style>
        <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: '-18%', left: '-12%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, rgba(37,99,235,0.5), transparent 62%)', filter: 'blur(90px)', animation: 'rloMeshA 18s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', top: '-8%', right: '-14%', width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle at 50% 50%, rgba(29,78,216,0.42), transparent 60%)', filter: 'blur(100px)', animation: 'rloMeshB 22s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', bottom: '-24%', left: '32%', width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle at 50% 50%, rgba(8,145,178,0.3), transparent 62%)', filter: 'blur(100px)', animation: 'rloMeshA 26s ease-in-out infinite' }} />
        </div>

        <div className="max-w-lg mx-auto w-full">
          {/* Brand mark */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <BrandMark size={36} />
            <span className="text-xl font-semibold" style={{ color: textPrimary }}>
              {brandName}
            </span>
          </div>

          {/* Hero headline */}
          <div className="text-center mb-8">
            <span
              className="inline-flex items-center gap-2 mb-5 px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase"
              style={{
                color: '#93c5fd',
                background: 'rgba(37,99,235,0.12)',
                border: '1px solid rgba(37,99,235,0.28)',
                letterSpacing: '0.12em',
              }}
            >
              AI video production, end to end
            </span>
            <h1
              className="font-bold mb-4"
              style={{
                color: heroTextPrimary,
                fontFamily: headingFontStack,
                letterSpacing: '-0.035em',
                fontSize: 'clamp(38px, 7vw, 56px)',
                lineHeight: 1.06,
              }}
            >
              Brief to video —
              <br />
              <span
                style={{
                  background: 'linear-gradient(90deg, #60a5fa 0%, #5eead4 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                in one shot.
              </span>
            </h1>
            <p className="text-lg leading-relaxed max-w-md mx-auto" style={{ color: heroTextMuted }}>
              Describe your idea or drop a product URL. Vidverge scripts, generates, and delivers a
              consistent-character video, ready to download.
            </p>
          </div>

          {/* Feature pills */}
          <div className="mb-8">
            <div className="flex justify-center gap-2.5 flex-wrap">
              {[
                { name: 'Verger, your AI producer', dot: '#60a5fa' },
                { name: 'Same character, every shot', dot: '#5eead4' },
                { name: 'Sound built in', dot: '#93c5fd' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${borderColor}`,
                    color: '#d1d5db',
                  }}
                >
                  <span
                    aria-hidden
                    style={{ width: 6, height: 6, borderRadius: 999, background: item.dot, boxShadow: `0 0 10px ${item.dot}` }}
                  />
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Email form card */}
          <div
            className="rounded-2xl p-6 sm:p-8"
            style={{
              backgroundColor: panelColor,
              boxShadow: '0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(37,99,235,0.14), 0 10px 44px rgba(37,99,235,0.14)',
              border: `1px solid ${borderColor}`,
            }}
          >
            <div className="text-center mb-5">
              <p className="text-base font-semibold" style={{ color: textPrimary }}>
                Make your first video free
              </p>
              <p className="mt-1 text-sm" style={{ color: textMuted }}>
                Drop your email and start briefing Verger — no card, no setup.
              </p>
            </div>
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="you@work.com"
                  className="w-full px-4 py-4 text-base rounded-xl focus:outline-none transition-all rlo-input"
                  style={{
                    backgroundColor: sectionBackground,
                    border: `2px solid ${error ? '#DC2626' : borderColor}`,
                    color: textPrimary,
                  }}
                  disabled={loading}
                  required
                  autoFocus
                  data-testid="input-email"
                />
                {error && (
                  <p className="mt-2 text-xs" style={{ color: '#f87171' }} data-testid="text-error">
                    {error}
                  </p>
                )}
              </div>

              {gdprEnabled && (
                <div
                  className="space-y-2 rounded-lg px-3 py-2 text-xs"
                  style={{ backgroundColor: bgLight, color: textMuted }}
                >
                  <p>
                    By entering your email, you agree to our{' '}
                    <a href="/privacy" className="font-medium underline" style={{ color: textPrimary }}>
                      Privacy Policy
                    </a>.
                  </p>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={marketingConsent}
                      onChange={(e) => setMarketingConsent(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300"
                    />
                    <span>I want to receive marketing emails and updates (optional)</span>
                  </label>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-4 rounded-xl font-semibold text-base transition-all rlo-cta"
                style={{
                  background: loading || !email ? 'rgba(37,99,235,0.4)' : 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: loading || !email ? 'not-allowed' : 'pointer',
                  boxShadow: loading || !email ? 'none' : '0 8px 24px rgba(37,99,235,0.45)',
                }}
                data-testid="button-continue"
              >
                {loading ? 'Just a moment...' : 'Create my first video →'}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-4 flex-wrap">
              {['Free first video', 'No credit card', 'Yours to keep'].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5 text-xs" style={{ color: textSubtle }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {item}
                </span>
              ))}
            </div>

            {/* Social Login */}
            {socialProviders.length > 0 && (
              <div className="mt-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px" style={{ backgroundColor: borderColor }} />
                  <span className="text-xs font-medium" style={{ color: textSubtle }}>or continue with</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: borderColor }} />
                </div>
                <div className={`grid gap-2 ${socialProviders.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {socialProviders.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => handleSocialLogin(provider)}
                      disabled={loading}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                      style={{
                        backgroundColor: panelColor,
                        border: `1px solid ${borderColor}`,
                        color: textPrimary,
                        cursor: loading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {provider === 'google' && (
                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      )}
                      {provider === 'facebook' && (
                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="#1877F2">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                      )}
                      {provider === 'apple' && (
                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>
                        </svg>
                      )}
                      {provider === 'linkedin' && (
                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="#0A66C2">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                      )}
                      <span className="capitalize">{provider}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Guest Mode */}
            {guestModeEnabled && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={handleGuestMode}
                  disabled={loading}
                  className="text-sm transition-colors"
                  style={{ color: textSubtle, cursor: loading ? 'not-allowed' : 'pointer' }}
                  data-testid="button-guest-mode"
                >
                  Continue as guest →
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
          <svg className="w-6 h-6" fill="none" stroke={textSubtle} strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* ===== SEE IT IN ACTION — real generated demo videos ===== */}
      {/* These are real finished renders from this workspace’s own video
          pipeline (completed video_jobs rows on the platform’s durable GCS
          bucket) — actual product output, not stock or placeholder loops. */}
      <section style={{ padding: '84px 24px', background: '#041d32', borderTop: '1px solid rgba(202,222,238,0.10)' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <h2 style={{ margin: 0, textAlign: 'center', fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 700, letterSpacing: '-0.02em', color: '#ffffff' }}>
            See it in action
          </h2>
          <p style={{ margin: '12px auto 44px', textAlign: 'center', maxWidth: 500, fontSize: 15, color: '#a7c8e4' }}>
            Straight out of Vidverge — real briefs rendered end to end, with the same character in every shot.
          </p>
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {[
              {
                src: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/uploads/videos/c860b676-a28b-4148-bb95-5bec11c80011.mp4',
                label: 'Product Ad — True Haven',
                sub: 'A pasted URL, rendered into a vertical ad',
              },
              {
                src: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/uploads/videos/fbf27888-57f3-45a6-a2a1-f87b8edf7387.mp4',
                label: 'Product Ad — VicharakAI',
                sub: 'One consistent presenter, every scene',
              },
              {
                src: 'https://storage.googleapis.com/audos-images/videos/f24710e5-7c6d-4db4-92b4-c2c235877575_stitched_1787991241820.mp4',
                label: 'Social Reel — Study Routine',
                sub: 'Multi-scene script, chained character',
              },
            ].map((demo, i) => (
              <div
                key={i}
                className="rlo-card"
                style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #12456d', background: '#0a3050' }}
              >
                <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 13', background: '#03192b' }}>
                  <video
                    src={demo.src}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    aria-label={demo.label}
                  />
                </div>
                <div style={{ padding: '12px 14px 14px' }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: '#ffffff' }}>{demo.label}</p>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: '#a7c8e4' }}>{demo.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FEATURE STRIP ===== */}
      <section style={{ padding: '84px 24px', background: '#041d32', borderTop: '1px solid rgba(202,222,238,0.10)' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <h2 style={{ margin: 0, textAlign: 'center', fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 700, letterSpacing: '-0.02em', color: '#ffffff' }}>
            Brief to video in three steps
          </h2>
          <p style={{ margin: '12px auto 44px', textAlign: 'center', maxWidth: 500, fontSize: 15, color: '#a7c8e4' }}>
            One conversation covers the whole pipeline — no editing suite, no camera crew.
          </p>
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {[
              { icon: '🔗', title: 'Drop a URL or brief', desc: 'Paste your product link or describe the idea in a sentence — Vidverge reads it and builds the brief.' },
              { icon: '✨', title: 'Agent scripts & generates', desc: 'Vidverge writes the scene-by-scene script and renders it with the same character in every shot.' },
              { icon: '⬇️', title: 'Download a publish-ready video', desc: 'Your finished MP4 lands in My Videos, ready to post — one click to download.' },
            ].map((item, i) => (
              <div
                key={i}
                style={{ borderRadius: 16, padding: '24px 22px', background: '#0a3050', border: '1px solid #12456d' }}
              >
                <div style={{ width: 48, height: 48, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: 'rgba(37,99,235,0.16)', border: '1px solid rgba(37,99,235,0.35)', marginBottom: 14 }}>
                  {item.icon}
                </div>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600, color: '#ffffff' }}>
                  {item.title}
                </h3>
                <p style={{ margin: '7px 0 0', fontSize: 14, lineHeight: 1.55, color: '#a7c8e4' }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== VIDEO SHOWCASE SECTION ===== */}
      <section style={{ padding: '80px 0', background: '#041d32', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px' }}>
          <h2 style={{ margin: 0, textAlign: 'center', fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 700, letterSpacing: '-0.02em', color: '#ffffff' }}>
            See what creators are making
          </h2>
          <p style={{ margin: '12px auto 0', textAlign: 'center', maxWidth: 460, fontSize: 15, color: '#9ca3af' }}>
            Real briefs, turned into finished videos — characters consistent across every shot.
          </p>
        </div>
        <div
          className="rlo-scroll"
          style={{ marginTop: 36, display: 'flex', gap: 18, overflowX: 'auto', padding: '4px 24px 20px', scrollSnapType: 'x mandatory' }}
        >
          {[
            { label: 'Product Ad • 30s', grad: 'linear-gradient(135deg, #2563eb 0%, #0a1a33 60%, #03192b 100%)' },
            { label: 'Character Intro • 15s', grad: 'linear-gradient(135deg, #0891b2 0%, #072a33 60%, #03192b 100%)' },
            { label: 'Explainer • 45s', grad: 'linear-gradient(135deg, #1d4ed8 0%, #0d1b47 60%, #03192b 100%)' },
            { label: 'Social Teaser • 10s', grad: 'linear-gradient(135deg, #db2777 0%, #3a0a24 60%, #03192b 100%)' },
            { label: 'Founder Story • 60s', grad: 'linear-gradient(135deg, #0d9488 0%, #06312d 60%, #03192b 100%)' },
            { label: 'Brand Verger • 20s', grad: 'linear-gradient(135deg, #2563eb 0%, #0c1f3f 60%, #03192b 100%)' },
          ].map((card, i) => (
            <div
              key={i}
              className="rlo-card"
              style={{ flex: '0 0 auto', width: 236, scrollSnapAlign: 'start', borderRadius: 16, overflow: 'hidden', border: '1px solid #12456d', background: '#0a3050' }}
            >
              <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 12', background: card.grad }}>
                <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,0.10), transparent 55%), linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.72) 100%)' }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span
                    className="rlo-play"
                    style={{ width: 52, height: 52, borderRadius: 999, background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#062842" style={{ marginLeft: 3 }}>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </div>
                <span style={{ position: 'absolute', left: 12, bottom: 12, fontSize: 12.5, fontWeight: 600, color: '#ffffff', textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}>
                  {card.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== VALUE PROPS SECTION ===== */}
      <section className="px-6 py-16" style={{ backgroundColor: sectionBackground }}>
        <div className="max-w-lg mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3" style={{ color: textPrimary, fontFamily: headingFontStack }}>
            Your AI video production crew
          </h2>
          <p className="text-center mb-10" style={{ color: textMuted }}>
            From a one-line idea to a publish-ready video — all in one conversation.
          </p>

          <div className="space-y-4">
            {[
              {
                icon: '🎬',
                title: 'From brief to finished video',
                desc: 'Describe the idea, the character, and the vibe. Verger scripts it, directs it, and renders it for you.'
              },
              {
                icon: '🎭',
                title: 'The same character in every shot',
                desc: "VidVerge locks your character’s look — face, hair, wardrobe — so every scene cuts together like one production."
              },
              {
                icon: '📝',
                title: 'Approve the script before rendering',
                desc: 'Verger writes a scene-by-scene script and confirms it with you before a single frame is generated.'
              },
              {
                icon: '📥',
                title: 'Yours to download',
                desc: 'Every finished video lands in your My Videos library as a ready-to-post MP4 with a download link.'
              }
            ].map((item, i) => (
              <div
                key={i}
                className="flex gap-4 p-5 rounded-xl"
                style={{ backgroundColor: panelColor, border: `1px solid ${borderColor}` }}
              >
                <div className="text-2xl flex-shrink-0">{item.icon}</div>
                <div>
                  <h3 className="font-semibold mb-1" style={{ color: textPrimary }}>
                    {item.title}
                  </h3>
                  <p className="text-sm" style={{ color: textMuted }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS SECTION ===== */}
      <section style={{ padding: '84px 24px', background: '#062842', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ margin: 0, textAlign: 'center', fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 700, letterSpacing: '-0.02em', color: '#ffffff' }}>
            How it works
          </h2>
          <p style={{ margin: '12px auto 44px', textAlign: 'center', maxWidth: 460, fontSize: 15, color: '#9ca3af' }}>
            Three steps from a one-line idea to a finished, downloadable video.
          </p>
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {[
              { icon: '💬', title: 'Describe your idea', desc: 'Tell Verger what you want: character, tone, length.' },
              { icon: '🎬', title: 'Verger writes the script', desc: 'AI generates a scene-by-scene script in seconds.' },
              { icon: '⬇️', title: 'Download your video', desc: 'Consistent characters, ready to ship.' },
            ].map((item, i) => (
              <div
                key={i}
                style={{ position: 'relative', borderRadius: 18, padding: '26px 22px', background: '#0a3050', border: '1px solid #12456d' }}
              >
                <div style={{ position: 'absolute', top: 18, right: 20, fontSize: 13, fontWeight: 700, color: 'rgba(37,99,235,0.55)' }}>
                  0{i + 1}
                </div>
                <div style={{ width: 52, height: 52, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.25)', marginBottom: 16 }}>
                  {item.icon}
                </div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ffffff' }}>
                  {item.title}
                </h3>
                <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5, color: '#9ca3af' }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SOCIAL PROOF SECTION ===== */}
      <section className="px-6 py-16" style={{ backgroundColor: sectionBackground }}>
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3" style={{ color: textPrimary, fontFamily: headingFontStack }}>
            Made for storytellers
          </h2>
          <p className="mb-8" style={{ color: textMuted }}>
            Join creators turning ideas into videos without a camera crew.
          </p>

          <div className="space-y-4">
            {[
              { quote: `"I described my ad in two sentences and got a video with the same presenter in every shot. Wild."`, name: 'Alex M.' },
              { quote: `"The script step is the killer feature — I tweak a line, approve it, and the video just shows up."`, name: 'Jordan T.' },
              { quote: `"It’s like having a producer, a director, and an editor in one chat window."`, name: 'Sam R.' }
            ].map((testimonial, i) => (
              <div
                key={i}
                className="p-5 rounded-xl text-left"
                style={{ backgroundColor: panelStrongColor, border: `1px solid ${borderColor}` }}
              >
                <p className="italic mb-2" style={{ color: textPrimary }}>
                  {testimonial.quote}
                </p>
                <p className="text-sm font-medium" style={{ color: textMuted }}>
                  — {testimonial.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA SECTION ===== */}
      <section
        className="px-6 py-16"
        style={{ backgroundColor: primaryColor, color: onPrimary }}
      >
        <div className="max-w-lg mx-auto text-center">
          <div className="flex justify-center mb-6">
            <BrandMark size={48} />
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold mb-3" style={{ fontFamily: headingFontStack }}>
            Ready to make your first video?
          </h2>
          <p className="mb-8 opacity-80">
            Brief Verger today — free to start, no credit card, no camera crew.
          </p>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="Enter your email"
              className="w-full px-4 py-4 text-base rounded-xl focus:outline-none"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                color: onPrimary,
                border: '1px solid rgba(255, 255, 255, 0.3)',
              }}
              disabled={loading}
              required
            />
            {error && (
              <p className="text-xs text-red-300">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-4 rounded-xl font-semibold text-base transition-all rlo-cta"
              style={{
                background: loading || !email ? 'rgba(37,99,235,0.4)' : 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                border: 'none',
                cursor: loading || !email ? 'not-allowed' : 'pointer',
                boxShadow: loading || !email ? 'none' : '0 8px 24px rgba(37,99,235,0.45)',
              }}
            >
              {loading ? 'Just a moment...' : 'Start making videos →'}
            </button>
          </form>

          {guestModeEnabled && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleGuestMode}
                disabled={loading}
                className="text-sm transition-colors"
                style={{ color: 'rgba(255,255,255,0.6)', cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                Continue as guest →
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ===== PRICING SECTION ===== */}
      <section style={{ padding: '84px 24px', background: '#062842', borderTop: '1px solid rgba(202,222,238,0.10)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <h2 style={{ margin: 0, textAlign: 'center', fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 700, letterSpacing: '-0.02em', color: '#ffffff' }}>
            Simple, credit-based pricing
          </h2>
          <p style={{ margin: '12px auto 44px', textAlign: 'center', maxWidth: 520, fontSize: 15, color: '#a7c8e4' }}>
            Start free — no card required. Upgrade when you are ready, or top up as you go.
          </p>
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', alignItems: 'stretch' }}>
            {[
              { name: 'Free Trial', price: '$0', unit: '', credits: '30 credits', note: 'No card required', featured: false, cta: 'Start free' },
              { name: 'Creator', price: '$35', unit: '/mo', credits: '250 credits / mo', note: 'For regular creators', featured: true, cta: 'Choose Creator' },
              { name: 'Pro', price: '$70', unit: '/mo', credits: '500 credits / mo', note: 'For teams shipping often', featured: false, cta: 'Choose Pro' },
              { name: 'Pay-as-you-go', price: '$9', unit: '', credits: '60 credits', note: 'One-off top-up, anytime', featured: false, cta: 'Buy credits' },
            ].map((tier, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 16,
                  padding: '26px 22px',
                  background: tier.featured ? 'linear-gradient(180deg, rgba(37,99,235,0.18), rgba(10,48,80,0.6))' : '#0a3050',
                  border: tier.featured ? '1px solid rgba(59,130,246,0.6)' : '1px solid #12456d',
                  boxShadow: tier.featured ? '0 18px 44px rgba(37,99,235,0.28)' : 'none',
                }}
              >
                {tier.featured ? (
                  <span style={{ alignSelf: 'flex-start', marginBottom: 12, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#ffffff', background: '#2563eb' }}>
                    Most popular
                  </span>
                ) : null}
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#ffffff' }}>{tier.name}</h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '10px 0 2px' }}>
                  <span style={{ fontSize: 34, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>{tier.price}</span>
                  <span style={{ fontSize: 14, color: '#a7c8e4' }}>{tier.unit}</span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 600, color: '#93c5fd' }}>{tier.credits}</p>
                <p style={{ margin: '6px 0 20px', fontSize: 13, color: '#a7c8e4' }}>{tier.note}</p>
                <button
                  type="button"
                  onClick={() => { const el = document.querySelector('[data-testid="input-email"]'); if (el) { (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' }); (el as HTMLInputElement).focus(); } }}
                  className="rlo-cta"
                  style={{
                    marginTop: 'auto',
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: bodyFontStack,
                    cursor: 'pointer',
                    color: '#ffffff',
                    border: tier.featured ? 'none' : '1px solid rgba(59,130,246,0.5)',
                    background: tier.featured ? 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)' : 'rgba(37,99,235,0.16)',
                  }}
                >
                  {tier.cta}
                </button>
              </div>
            ))}
          </div>
          <p style={{ margin: '28px auto 0', textAlign: 'center', maxWidth: 520, fontSize: 12.5, color: '#6f9dc0' }}>
            Credits are spent when you generate a video — longer videos use more credits.
          </p>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="px-6 py-8" style={{ backgroundColor: sectionBackground }}>
        <div className="max-w-lg mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <BrandMark size={24} />
            <span className="font-semibold" style={{ color: textPrimary }}>
              {brandName}
            </span>
          </div>
          <p className="text-sm mb-2" style={{ color: textMuted }}>
            {tagline}
          </p>
          <p className="text-xs" style={{ color: textSubtle }}>
            © 2026 {brandName}
          </p>
        </div>
      </footer>
    </div>
  );
}
