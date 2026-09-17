/**
 * VidVerge plan catalog + entitlement helpers.
 *
 * OPEN ENROLLMENT WINDOW (self-expiring) — open until Sep 9 2026, 23:59 UTC.
 * `SUBSCRIPTION_GATE_DISABLED` (below) is no longer a hand-flipped boolean: it
 * is derived from `OPEN_ENROLLMENT_UNTIL`. While the window is open everything
 * behaves as it did under the old flag — the `subscriptions` lookup is skipped,
 * every visitor reads as Pro with an unlimited allowance, and no paywall /
 * trial wall / upgrade prompt can fire — AND every signed-in visitor without a
 * `subscriptions` row gets one inserted (tier 'pro', video_limit 999999) so
 * the access they were granted during the window survives its close. Once the
 * window expires the original tier logic below resumes on its own; nothing
 * needs flipping back. Nothing was deleted — the table, the lookup and the
 * plan catalog are all still here, and the notes below describe them again.
 *
 * Two sources decide what a visitor is entitled to, in this order:
 *   1. The `subscriptions` WorkspaceDB table — email -> tier ('free' |
 *      'creator' | 'pro' | 'payg') plus an optional `video_limit`. This is the
 *      real access list: rows are granted by the founder and looked up once
 *      the visitor's email is known. `video_limit` is that account's video
 *      cap; NULL means UNLIMITED, and the video-count gate is skipped
 *      entirely for it.
 *   2. A local `reelio.plan` marker, kept as the fallback seam for the
 *      not-yet-wired Stripe checkout.
 *
 * Checkout is still not connected, so plan selection on the Plans screen only
 * logs intent — but a row in `subscriptions` DOES entitle: paid tiers skip the
 * free-trial wall and get the Pro badge everywhere the shell shows plan state.
 */
import { useEffect, useState } from 'react';
import { scopedSpaceSessionStorageKey } from './tenant-delegation-scope';

export type PlanId = 'free' | 'creator' | 'pro' | 'payg';

export interface ReelioPlan {
  id: PlanId;
  name: string;
  /** Headline price, already formatted. */
  price: string;
  /** What the price buys — rendered next to it, e.g. "/mo". */
  cadence: string;
  /** Videos included, the number people actually compare on. */
  quota: string;
  /** One line of creator-facing positioning. */
  pitch: string;
  cta: string;
  features: string[];
  /** Card glow / accent colour. */
  accent: string;
  badge?: string;
  featured?: boolean;
}

export const REELIO_PLANS: ReelioPlan[] = [
  {
    id: 'free',
    name: 'Free Trial',
    price: '$0',
    cadence: 'no card',
    quota: '1 video',
    pitch: 'Run one idea through the whole pipeline and see it come out finished.',
    cta: 'Get started free',
    accent: '#2dd4bf',
    features: [
      'One finished, downloadable video',
      'Sound built in — your character speaks the script on camera',
      'Your character, identical in every shot',
      'No credit card, no countdown',
    ],
  },
  {
    id: 'creator',
    name: 'Creator',
    price: '$29',
    cadence: '/mo',
    quota: '5 videos / month',
    pitch: 'For the creator shipping something every week.',
    cta: 'Subscribe',
    accent: '#3b82f6',
    features: [
      '5 finished videos every month',
      '15–60 seconds, up to 3 scenes',
      'Character consistency across the cut',
      'Dialogue, music & ambience on every video',
      'Your landing page as the closing shot',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$79',
    cadence: '/mo',
    quota: '15 videos / month',
    pitch: 'For the series, the campaign, the whole content calendar.',
    cta: 'Subscribe',
    accent: '#2563eb',
    badge: 'Most popular',
    featured: true,
    features: [
      '15 finished videos every month',
      'Everything in Creator',
      'Priority spot in the render queue',
      'Bring a recurring character back, video after video',
      'First access to new looks and formats',
    ],
  },
  {
    id: 'payg',
    name: 'Pay-as-you-go',
    price: '$9',
    cadence: '/video',
    quota: '1 video, whenever',
    pitch: 'For the one-off drop. No subscription, no calendar.',
    cta: 'Pay per video',
    accent: '#22d3ee',
    features: [
      '$9 per finished video',
      'No monthly commitment',
      'Same pipeline, same quality',
      'Buy one the moment the idea lands',
    ],
  },
];

/** Videos a free-trial visitor gets before the plans screen shows up. */
export const FREE_TRIAL_VIDEOS = 1;

// ---------------------------------------------------------------------------
// OPEN ENROLLMENT WINDOW — remove after Sep 9 2026
//
// On the founder's direction, the previous unconditional "gate disabled" flag
// is now a dated window: while `OPEN_ENROLLMENT_UNTIL` is in the future,
// everyone gets everything (video generation, characters, mockups) with no
// subscription check, exactly as before. While the window is open:
//   - the `subscriptions` email -> tier lookup is never performed,
//   - every visitor resolves as `FULL_ACCESS_TIER` with videoLimit null,
//   - isTrialSpent() / videoLimitFor() / hasUnlimitedVideos() never gate, so no
//     surface can raise a paywall or a "you've reached your limit" message,
//   - AND any signed-in visitor without a `subscriptions` row gets one
//     inserted (tier 'pro', video_limit 999999) — see `ensureOpenEnrollmentRow`
//     below — so access granted during the window survives its close.
// The flag is evaluated once at module load, so a tab already open when the
// window closes keeps full access until its next reload; every fresh page load
// after Sep 9 2026 resumes the original tier logic below on its own. No flag
// needs flipping back.
// ---------------------------------------------------------------------------
export const OPEN_ENROLLMENT_UNTIL = new Date('2026-09-09T23:59:00.000Z');

/** True while the open-enrollment window is still open. */
export function isOpenEnrollmentActive(): boolean {
  return Date.now() < OPEN_ENROLLMENT_UNTIL.getTime();
}

export const SUBSCRIPTION_GATE_DISABLED: boolean = isOpenEnrollmentActive();

/** The tier every visitor is treated as while the gate is disabled. */
export const FULL_ACCESS_TIER: PlanId = 'pro';

// ---------------------------------------------------------------------------
// Admin / founder bypass
//
// Accounts on this whitelist are never gated: every video-count cap (free
// trial today; Creator/Pro monthly caps when they get enforced) and every
// paywall check must consult `isAdminUser()` BEFORE firing, so these accounts
// generate videos without ever seeing a limit screen. `isTrialSpent` below
// already does this — any future limit logic must do the same.
//
// These are the internal founder/team accounts. Every one of them ALSO has a
// row in `subscriptions` (tier 'pro', video_limit NULL = unlimited), and that
// row is what actually grants the tier badge and the unlimited allowance. The
// array is the offline mirror of those rows: when the lookup can't run — the
// database is unreachable, storage is disabled — these accounts still get
// unlimited access instead of being dropped onto the free trial. Grant a NEW
// account access by adding a `subscriptions` row, not by editing this list.
// ---------------------------------------------------------------------------
export const ADMIN_EMAILS = [
  'grohan24102004@gmail.com',
  'nicholas@audos.com',
  'andres@audos.com',
];

/** Email the visitor signed in with (EmailGate / Settings), if any. */
export function currentUserEmail(spaceId?: string): string | null {
  if (typeof window === 'undefined') return null;
  const scope = spaceId || currentSpaceId();
  if (!scope) return null;
  try {
    const stored = window.localStorage.getItem(scopedSpaceSessionStorageKey(scope));
    if (stored && stored.startsWith('{')) {
      const parsed = JSON.parse(stored);
      if (typeof parsed.email === 'string' && parsed.email) return parsed.email;
    }
  } catch {
    /* no readable session — treated as a regular visitor */
  }
  return null;
}

/** True when the signed-in email is whitelisted for unlimited access. */
export function isAdminUser(spaceId?: string): boolean {
  const email = currentUserEmail(spaceId);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Subscription tier lookup (`subscriptions` WorkspaceDB table)
//
// The table is an email -> tier access list, NOT visitor-scoped data: rows are
// seeded by the founder and read by whichever visitor signs in with that
// email. Reads therefore go through `{ shared: true }` so the SDK does not
// append its `session_id=eq.<sid>` filter and hide every row.
//
// The resolved tier AND the row's `video_limit` are cached in localStorage
// (keyed by email, so signing in as somebody else never inherits the previous
// tier) and broadcast on TIER_EVENT, which lets synchronous callers like
// `getPlanId()` and `isTrialSpent()` stay correct without every surface
// awaiting its own query.
// ---------------------------------------------------------------------------
export const SUBSCRIPTIONS_TABLE = 'subscriptions';
export const TIER_EVENT = 'vidverge:tier-resolved';
const TIER_CACHE_KEY = 'reelio.userTier';

export interface SubscriptionRow {
  email: string;
  tier: PlanId;
  /** Video cap for the account. NULL/absent means unlimited. */
  video_limit?: number | null;
  created_at?: string | null;
}

/** What the access list grants: a tier plus a video cap (null = unlimited). */
export interface SubscriptionAccess {
  email: string;
  tier: PlanId;
  videoLimit: number | null;
}

function normalizeTier(value: unknown): PlanId | null {
  const tier = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (tier === 'free' || tier === 'creator' || tier === 'pro' || tier === 'payg') {
    return tier as PlanId;
  }
  return null;
}

function normalizeEmail(email: string | null | undefined): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * A row's `video_limit`. null means unlimited — the documented meaning of NULL
 * in that column, and what the founder/team rows carry. Unparseable values are
 * read as unlimited too: never invent a cap out of bad data.
 */
function normalizeVideoLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const limit = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(limit) || limit < 0) return null;
  return Math.floor(limit);
}

/** Tiers that carry paid entitlement — no trial wall, no upgrade nudges. */
export function isPaidTier(tier: PlanId | null | undefined): boolean {
  return tier === 'creator' || tier === 'pro' || tier === 'payg';
}

/** Pro specifically — what the "Pro" badge is shown for. */
export function isProTier(tier: PlanId | null | undefined): boolean {
  return tier === 'pro';
}

function readCachedAccess(): SubscriptionAccess | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TIER_CACHE_KEY);
    if (!raw || !raw.startsWith('{')) return null;
    const parsed = JSON.parse(raw);
    const tier = normalizeTier(parsed?.tier);
    const email = normalizeEmail(parsed?.email);
    if (!tier || !email) return null;
    // Caches written before `video_limit` existed simply carry no cap.
    return { email, tier, videoLimit: normalizeVideoLimit(parsed?.videoLimit) };
  } catch {
    /* storage disabled — the tier is simply unknown until the next lookup */
  }
  return null;
}

function writeCachedAccess(access: SubscriptionAccess): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIER_CACHE_KEY, JSON.stringify(access));
  } catch {
    /* storage disabled — callers still get the value they just resolved */
  }
  window.dispatchEvent(new CustomEvent(TIER_EVENT, { detail: access }));
}

/**
 * The access already resolved for the signed-in email, or null when it is not
 * known yet (nobody signed in, or the lookup hasn't come back). Never guesses.
 */
export function getUserAccess(spaceId?: string): SubscriptionAccess | null {
  // OPEN ENROLLMENT WINDOW — all users have full access while it is open
  if (SUBSCRIPTION_GATE_DISABLED) {
    return {
      email: normalizeEmail(currentUserEmail(spaceId)) || 'all-access',
      tier: FULL_ACCESS_TIER,
      videoLimit: null,
    };
  }
  const email = normalizeEmail(currentUserEmail(spaceId));
  if (!email) return null;
  const cached = readCachedAccess();
  if (!cached || cached.email !== email) return null;
  return cached;
}

/** The tier half of `getUserAccess()`. */
export function getUserTier(spaceId?: string): PlanId | null {
  const access = getUserAccess(spaceId);
  return access ? access.tier : null;
}

/**
 * One row lookup against the access list. Returns null when there is no row —
 * and also when the query itself fails, so a database hiccup can never do more
 * than leave the visitor on their normal (free-trial) footing.
 */
export async function fetchSubscriptionAccess(
  email: string,
): Promise<{ tier: PlanId; videoLimit: number | null } | null> {
  if (typeof window === 'undefined') return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const db = (window as any).__workspaceDb;
  if (!db || typeof db.from !== 'function') return null;
  try {
    const result = await db
      .from(SUBSCRIPTIONS_TABLE, { shared: true })
      .eq('email', normalized)
      .limit(1)
      .get();
    const rows = Array.isArray(result?.data) ? result.data : [];
    const match = rows.find((row: any) => normalizeEmail(row?.email) === normalized);
    if (!match) return null;
    const tier = normalizeTier(match.tier);
    if (!tier) return null;
    return { tier, videoLimit: normalizeVideoLimit(match.video_limit) };
  } catch (e) {
    console.warn('[VidVerge] subscription lookup failed:', e);
    return null;
  }
}

/** Tier-only form of the lookup, for callers that don't need the cap. */
export async function fetchSubscriptionTier(email: string): Promise<PlanId | null> {
  const access = await fetchSubscriptionAccess(email);
  return access ? access.tier : null;
}

// ---------------------------------------------------------------------------
// Open enrollment auto-grant
//
// Open enrollment window — remove after Sep 9 2026. While the window is open,
// a signed-in visitor with NO `subscriptions` row gets one inserted (tier
// 'pro', video_limit 999999) so what the window granted them keeps working
// after it closes. Existing rows are never modified — existing users are
// unaffected — and the insert is written to the shared scope (session_id
// NULL), the same shape as the founder-seeded rows, so the normal
// `fetchSubscriptionAccess` lookup finds it from any of the visitor's
// sessions. A localStorage marker keeps repeat visits from re-checking, and a
// unique-email violation from a racing tab is swallowed: the row it wanted
// already exists.
// ---------------------------------------------------------------------------
const ENROLLMENT_MARKER_KEY = 'vidverge.openEnrollment.granted';
let enrollmentInFlight: string | null = null;

async function ensureOpenEnrollmentRow(email: string): Promise<void> {
  if (typeof window === 'undefined' || !isOpenEnrollmentActive()) return;
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  try {
    if (window.localStorage.getItem(ENROLLMENT_MARKER_KEY) === normalized) return;
  } catch {
    /* storage disabled — the existing-row check below still dedupes */
  }
  if (enrollmentInFlight === normalized) return;
  enrollmentInFlight = normalized;
  try {
    const db = (window as any).__workspaceDb;
    if (!db || typeof db.from !== 'function') return;
    // Never touch an existing row: the window only ENROLLS, it never upgrades
    // or downgrades anybody who already has a tier.
    const existing = await fetchSubscriptionAccess(normalized);
    if (!existing) {
      await db.from(SUBSCRIPTIONS_TABLE, { shared: true }).insert({
        email: normalized,
        tier: 'pro',
        video_limit: 999999,
        created_at: new Date().toISOString(),
      });
      // Cache it too, so the tier survives the window even before the next
      // full lookup runs.
      writeCachedAccess({ email: normalized, tier: 'pro', videoLimit: 999999 });
    }
    try {
      window.localStorage.setItem(ENROLLMENT_MARKER_KEY, normalized);
    } catch {
      /* storage disabled — worst case the row check runs again next visit */
    }
  } catch (e) {
    // A failed grant only means the visitor stays on the window's full access
    // for now; the next mount retries.
    console.warn('[VidVerge] open-enrollment grant failed:', e);
  } finally {
    enrollmentInFlight = null;
  }
}

let accessLookupInFlight: Promise<SubscriptionAccess | null> | null = null;

/**
 * Resolve the signed-in visitor's access (tier + video cap) and cache it.
 * Concurrent callers (the shell, My Videos and the chat all ask on mount)
 * share one request.
 */
export async function refreshUserAccess(spaceId?: string): Promise<SubscriptionAccess | null> {
  // OPEN ENROLLMENT WINDOW — all users have full access until it closes.
  // The lookup itself is skipped, but the visitor's grant is persisted as a
  // real `subscriptions` row (fire-and-forget) so it outlives the window.
  if (SUBSCRIPTION_GATE_DISABLED) {
    const email = normalizeEmail(currentUserEmail(spaceId));
    if (email) void ensureOpenEnrollmentRow(email);
    return getUserAccess(spaceId);
  }
  const email = normalizeEmail(currentUserEmail(spaceId));
  if (!email) return null;
  if (accessLookupInFlight) return accessLookupInFlight;

  accessLookupInFlight = (async () => {
    const found = await fetchSubscriptionAccess(email);
    // No row is a real answer ("you're on the free trial"), and a failed
    // lookup lands here too — which is why the founder/team whitelist stays
    // as the offline mirror of their rows.
    const access: SubscriptionAccess = found
      ? { email, tier: found.tier, videoLimit: found.videoLimit }
      : ADMIN_EMAILS.includes(email)
        ? { email, tier: 'pro', videoLimit: null }
        : { email, tier: 'free', videoLimit: null };
    writeCachedAccess(access);
    return access;
  })();

  try {
    return await accessLookupInFlight;
  } finally {
    accessLookupInFlight = null;
  }
}

/** Tier-only form of `refreshUserAccess()`. */
export async function refreshUserTier(spaceId?: string): Promise<PlanId | null> {
  const access = await refreshUserAccess(spaceId);
  return access ? access.tier : null;
}

/**
 * React binding: resolves the tier on mount (and again when the session is
 * established after the email gate), and re-renders when it lands so paywalls
 * and badges reflect the access list without a page reload.
 *
 * Pass the current session id as `resolveKey` from surfaces that hold one —
 * signing in as a different email inside the same mount then re-resolves
 * instead of waiting for a reload.
 */
export function useUserTier(
  spaceId?: string,
  resolveKey?: string | null,
): { tier: PlanId | null; loading: boolean; videoLimit: number | null; unlimited: boolean } {
  const [access, setAccess] = useState<SubscriptionAccess | null>(() => getUserAccess(spaceId));
  const [loading, setLoading] = useState<boolean>(() => getUserAccess(spaceId) === null);

  useEffect(() => {
    let cancelled = false;

    const resolve = () => {
      if (cancelled) return;
      const email = currentUserEmail(spaceId);
      if (!email) {
        setAccess(null);
        setLoading(false);
        return;
      }
      setAccess(getUserAccess(spaceId));
      setLoading(true);
      void refreshUserAccess(spaceId).then((next) => {
        if (cancelled) return;
        setAccess(next);
        setLoading(false);
      });
    };

    const onTierEvent = () => {
      if (!cancelled) setAccess(getUserAccess(spaceId));
    };

    resolve();
    window.addEventListener(TIER_EVENT, onTierEvent as EventListener);
    window.addEventListener('audos:session-established', resolve as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(TIER_EVENT, onTierEvent as EventListener);
      window.removeEventListener('audos:session-established', resolve as EventListener);
    };
  }, [spaceId, resolveKey]);

  // OPEN ENROLLMENT WINDOW — while it is open, every surface that reads this
  // hook (the shell's plan chrome, My Videos, the chat badge, Settings) sees a
  // resolved, uncapped Pro entitlement.
  if (SUBSCRIPTION_GATE_DISABLED) {
    return { tier: FULL_ACCESS_TIER, loading: false, videoLimit: null, unlimited: true };
  }

  return {
    tier: access ? access.tier : null,
    loading,
    videoLimit: access ? access.videoLimit : null,
    // Unlimited is a real entitlement (video_limit NULL on a paid row), not
    // merely "cap unknown", so it needs a resolved paid tier behind it.
    unlimited: !!access && access.videoLimit === null && isPaidTier(access.tier),
  };
}

// ---------------------------------------------------------------------------
// Opening the plans screen
//
// The screen is mounted once by the shell (Desktop.tsx) and opened by event so
// any surface — an app, the agent chat, settings — can raise it without
// threading props through the shell.
// ---------------------------------------------------------------------------
export const PRICING_EVENT = 'vidverge:open-pricing';

/** 'nav' = the visitor asked for plans. 'trial-limit' = they hit the trial wall. */
export type PricingTrigger = 'nav' | 'trial-limit';

export function openPricing(trigger: PricingTrigger = 'nav'): void {
  if (typeof window === 'undefined') return;
  // OPEN ENROLLMENT WINDOW — while it is open, plans stay reachable as
  // navigation, but never as a wall: a 'trial-limit' open is downgraded to
  // 'nav' so its "free trial used" copy cannot appear.
  const effective: PricingTrigger = SUBSCRIPTION_GATE_DISABLED ? 'nav' : trigger;
  window.dispatchEvent(new CustomEvent(PRICING_EVENT, { detail: { trigger: effective } }));
}

const PLAN_STORAGE_KEY = 'reelio.plan';

export function getPlanId(): PlanId {
  if (typeof window === 'undefined') return 'free';
  // OPEN ENROLLMENT WINDOW — all users have full access while it is open
  if (SUBSCRIPTION_GATE_DISABLED) return FULL_ACCESS_TIER;
  // A paid row on the `subscriptions` access list is the only entitlement the
  // product actually grants today, so it outranks the local checkout marker.
  const subscribed = getUserTier();
  if (subscribed && subscribed !== 'free') return subscribed;
  try {
    const stored = window.localStorage.getItem(PLAN_STORAGE_KEY);
    if (stored === 'creator' || stored === 'pro' || stored === 'payg') return stored;
  } catch {
    /* private mode / storage disabled — everyone is on the trial */
  }
  // Founder/team accounts read as Pro even before the lookup lands, so the
  // Plans screen never presents the trial as their current plan.
  if (isAdminUser()) return 'pro';
  return 'free';
}

// ---------------------------------------------------------------------------
// Trial usage
//
// A visitor's videos are their rows in `video_jobs`. WorkspaceDB scopes reads
// to the visitor's session already, but the table also holds seeded rows with
// a null session_id, so the count is re-filtered against the known session id
// rather than trusting the row set to be clean.
// ---------------------------------------------------------------------------

/** The space this bundle is serving, for callers that aren't handed the id. */
function currentSpaceId(): string | null {
  if (typeof window === 'undefined') return null;
  const runtime = window as any;
  return runtime.__SPACE_ID__ || runtime.__APP_ID__ || runtime.__SPACE_CONFIG__?.id || null;
}

export function spaceSessionId(spaceId?: string): string | null {
  if (typeof window === 'undefined') return null;
  const scope = spaceId || currentSpaceId();
  try {
    const injected = (window as any).__spaceSessionId;
    if (typeof injected === 'string' && injected) return injected;
    if (!scope) return null;
    const stored = window.localStorage.getItem(scopedSpaceSessionStorageKey(scope));
    if (stored && stored.startsWith('{')) {
      const parsed = JSON.parse(stored);
      return parsed.workspaceSessionId || parsed.sessionId || parsed.id || null;
    }
  } catch {
    /* no session — treated as a fresh visitor */
  }
  return null;
}

/** Videos this visitor has actually spent. Failed renders don't count. */
export function countOwnVideos(rows: any[], sessionId: string | null): number {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    if (!row || row.status === 'failed') return false;
    // Without a session id there is nothing to check against, so trust the
    // session-scoped read; with one, seeded rows (null session_id) are not ours.
    if (!sessionId) return true;
    return row.session_id === sessionId;
  }).length;
}

/** Returns null when the count can't be established — never gate on a guess. */
export async function fetchOwnVideoCount(spaceId?: string): Promise<number | null> {
  if (typeof window === 'undefined') return null;
  const db = (window as any).__workspaceDb;
  if (!db || typeof db.from !== 'function') return null;
  try {
    const result = await db.from('video_jobs').orderBy('created_at', 'desc').limit(100).get();
    const rows = Array.isArray(result?.data) ? result.data : [];
    return countOwnVideos(rows, spaceSessionId(spaceId));
  } catch (e) {
    console.warn('[VidVerge] could not read video usage:', e);
    return null;
  }
}

/**
 * How many videos this account may make before the count gate fires, or null
 * for unlimited. Resolution order:
 *   1. An explicit numeric `video_limit` on the visitor's `subscriptions` row.
 *   2. NULL `video_limit` on a paid row (or a paid plan from the checkout
 *      marker) — unlimited. The Creator/Pro monthly caps are only enforced
 *      once a row spells one out as a number, which is what lets the
 *      founder/team rows run without a cap.
 *   3. Otherwise the free-trial allowance, exactly as before — so a visitor
 *      with no row is gated the way they always were.
 */
export function videoLimitFor(planId: PlanId = getPlanId(), spaceId?: string): number | null {
  // OPEN ENROLLMENT WINDOW — all users have full access while it is open
  // (null = unlimited, so the video-count gate never fires for anybody).
  if (SUBSCRIPTION_GATE_DISABLED) return null;
  const access = getUserAccess(spaceId);
  if (access && typeof access.videoLimit === 'number') return access.videoLimit;
  if (planId !== 'free') return null;
  if (access && isPaidTier(access.tier)) return null;
  return FREE_TRIAL_VIDEOS;
}

/** True when nothing caps this account's video count. */
export function hasUnlimitedVideos(planId: PlanId = getPlanId(), spaceId?: string): boolean {
  // OPEN ENROLLMENT WINDOW — all users have full access while it is open
  if (SUBSCRIPTION_GATE_DISABLED) return true;
  if (isAdminUser(spaceId)) return true;
  return videoLimitFor(planId, spaceId) === null;
}

export function isTrialSpent(planId: PlanId, videosUsed: number | null): boolean {
  // OPEN ENROLLMENT WINDOW — while it is open no visitor is ever "out of
  // videos" and no trial wall can be raised.
  if (SUBSCRIPTION_GATE_DISABLED) return false;
  // Whitelisted founder/team accounts are never gated, whatever the count says.
  if (isAdminUser()) return false;
  const limit = videoLimitFor(planId);
  // Unlimited (video_limit NULL on a paid row) skips the count gate entirely.
  if (limit === null) return false;
  if (typeof videosUsed !== 'number') return false;
  return videosUsed >= limit;
}
