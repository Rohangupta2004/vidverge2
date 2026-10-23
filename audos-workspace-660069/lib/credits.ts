/**
 * VidVerge credits — the client side of the locked pricing meter.
 *
 * ONE RULE, EVERYWHERE: 1 credit = 1 second of finished video, on every
 * provider, no exceptions. Which engine a shot is routed to is a backend
 * decision the customer never sees and never pays differently for.
 *
 * FREE: every new verified user receives 60 starter credits; scripting,
 * briefing, storyboards, brand reads, and agent conversation remain free.
 * Only video GENERATION spends credits.
 *
 * The balance itself is server-owned. This module never computes it — it asks
 * the `vv-credits` server function, which is the only writer of
 * `vv_credit_accounts` / `vv_credit_ledger`. A published space bundle carries
 * a public workspace token, so anything the browser could write, anyone could
 * forge; the wallet therefore lives behind a session-gated function.
 *
 * Wallets are keyed on the signed-in EMAIL, so a balance follows the person
 * across devices and sessions rather than dying with a tab.
 */
import { useEffect, useState } from 'react';
import { openPricing } from './plans';
import type { PlanId } from './plans';
import { callHook, getSessionId, hookUrl, spaceId } from './workspace';

export const CREDITS_HOOK_ENDPOINT = hookUrl('vv-credits');

/** Fired whenever the cached balance moves, so every surface re-renders. */
export const CREDITS_EVENT = 'vidverge:credits';

/** The locked meter. */
export const SECONDS_PER_CREDIT = 1;
export const FREE_TRIAL_CREDITS = 60;
export const PAYG_BLOCK_PRICE_CENTS = 900;
export const PAYG_BLOCK_CREDITS = 60;

/** Monthly allowance per plan. Creator and Pro roll over; the others don't accrue. */
export const PLAN_MONTHLY_CREDITS: Record<PlanId, number> = {
  free: 0,
  creator: 250,
  pro: 500,
  payg: 0,
};

export interface CreditState {
  email: string;
  plan: PlanId;
  planLabel: string;
  /** Credits available to spend right now. */
  balance: number;
  monthlyCredits: number;
  /** True on Creator/Pro, where an unspent balance carries into next month. */
  rollover: boolean;
  nextGrantAt: string | null;
  lastGrantAt: string | null;
  lifetimeGranted: number;
  lifetimeSpent: number;
  trialGranted: boolean;
}

/** Thrown when a generation is blocked because the wallet is short. */
export class InsufficientCreditsError extends Error {
  code = 'insufficient_credits';
  required: number;
  balance: number;
  shortfall: number;
  seconds: number;
  plan: PlanId;
  constructor(detail: { required: number; balance: number; seconds: number; plan: PlanId }) {
    super(
      `This video needs ${detail.required} credits (${detail.seconds}s of video) and you have ${detail.balance}. ` +
        'Top up or upgrade to keep generating.',
    );
    this.name = 'InsufficientCreditsError';
    this.required = detail.required;
    this.balance = detail.balance;
    this.shortfall = Math.max(0, detail.required - detail.balance);
    this.seconds = detail.seconds;
    this.plan = detail.plan;
  }
}

export function isInsufficientCreditsError(e: unknown): e is InsufficientCreditsError {
  return e instanceof InsufficientCreditsError;
}

/** A wallet authorization failure that is not a balance shortfall. */
export class CreditAuthorizationError extends Error {
  code: string;
  status: number;
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message);
    this.name = 'CreditAuthorizationError';
    this.code = opts.code || 'credit_authorization_failed';
    this.status = opts.status || 0;
  }
}

export function isCreditAuthorizationError(e: unknown): e is CreditAuthorizationError {
  return e instanceof CreditAuthorizationError;
}

/** A part-second still costs a whole credit — the meter never bills fractions. */
export function creditsForSeconds(seconds: number): number {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.max(1, Math.ceil(s));
}

export function formatCredits(value: number): string {
  const n = Math.max(0, Math.round(Number(value) || 0));
  return n.toLocaleString();
}

/** "18s · 18 credits" — the line shown next to a generate button. */
export function describeCost(seconds: number): string {
  const cost = creditsForSeconds(seconds);
  if (!cost) return 'No credits';
  return `${Math.round(seconds)}s · ${formatCredits(cost)} credit${cost === 1 ? '' : 's'}`;
}

/** Whole $9 blocks needed to cover a shortfall, minimum one. */
export function paygBlocksFor(credits: number): number {
  const needed = Math.max(1, Math.ceil(Number(credits) || 0));
  return Math.max(1, Math.ceil(needed / PAYG_BLOCK_CREDITS));
}

function normalizePlan(value: unknown): PlanId {
  const plan = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return plan === 'creator' || plan === 'pro' || plan === 'payg' ? (plan as PlanId) : 'free';
}

function toState(data: any): CreditState | null {
  if (!data || typeof data !== 'object' || typeof data.email !== 'string') return null;
  const plan = normalizePlan(data.plan);
  return {
    email: data.email,
    plan,
    planLabel: String(data.planLabel || plan),
    balance: Math.max(0, Math.round(Number(data.balance) || 0)),
    monthlyCredits: Math.max(0, Math.round(Number(data.monthlyCredits) || 0)),
    rollover: data.rollover === true,
    nextGrantAt: data.nextGrantAt ? String(data.nextGrantAt) : null,
    lastGrantAt: data.lastGrantAt ? String(data.lastGrantAt) : null,
    lifetimeGranted: Math.max(0, Math.round(Number(data.lifetimeGranted) || 0)),
    lifetimeSpent: Math.max(0, Math.round(Number(data.lifetimeSpent) || 0)),
    trialGranted: data.trialGranted === true,
  };
}

let cached: CreditState | null = null;

/** The last balance this tab resolved, or null before the first read lands. */
export function getCachedCredits(): CreditState | null {
  return cached;
}

function publish(state: CreditState | null): CreditState | null {
  cached = state;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CREDITS_EVENT, { detail: state }));
  }
  return state;
}

/**
 * One call to the wallet function. Returns null when there is nobody to bill
 * yet (no session, storage disabled, the function unreachable) — callers must
 * treat null as "unknown", never as "zero".
 */
async function callCredits(payload: Record<string, unknown>): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  if (!getSessionId()) return null;
  try {
    return await callHook('vv-credits', payload);
  } catch (e) {
    console.warn('[VidVerge] credit wallet unreachable:', e);
    return null;
  }
}

let refreshInFlight: Promise<CreditState | null> | null = null;

/** Resolve the signed-in visitor's balance and cache it. Concurrent callers share one request. */
export async function refreshCredits(): Promise<CreditState | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const data = await callCredits({ op: 'balance' });
    const state = toState(data);
    return publish(state);
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** A fresh idempotency key for one generation attempt. */
export function newChargeKey(prefix = 'gen'): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${rand}`;
}

export interface ChargeRequest {
  /** Length of the video being generated, in seconds. */
  seconds: number;
  /** Idempotency key — reuse it on a retry so the same clip is billed once. */
  entryKey: string;
  /** Which surface is spending (group-a, runway, …) — ledger context only. */
  source?: string;
  note?: string;
}

export interface ChargeResult {
  /** False when the meter could not run at all (signed out, wallet offline). */
  metered: boolean;
  charged: number;
  state: CreditState | null;
}

/**
 * Spend credits for one generation, BEFORE the provider is called.
 *
 * Two failure modes, deliberately treated differently:
 *   - The wallet answers "not enough" → the generation is blocked, the plans
 *     screen opens on the credit wall, and this throws InsufficientCreditsError.
 *   - The wallet cannot be reached at all (offline, 500, signed-out session) →
 *     the generation proceeds unmetered. A ledger outage must never be the
 *     reason a paying customer cannot make their video; the miss is logged.
 */
export async function authorizeCredits(request: ChargeRequest): Promise<ChargeResult> {
  const cost = creditsForSeconds(request.seconds);
  if (!cost) return { metered: false, charged: 0, state: cached };
  if (typeof window === 'undefined' || !getSessionId()) {
    throw new CreditAuthorizationError('Sign-in session expired — refresh and retry.', { code: 'session_expired', status: 401 });
  }

  let data: any;
  try {
    data = await callHook('vv-credits', {
      op: 'charge',
      entryKey: request.entryKey,
      seconds: Math.round(request.seconds),
      source: request.source || 'app',
      note: request.note,
    });
  } catch (e: any) {
    const status = Math.round(Number(e?.status) || 0);
    const auth = status === 401 || status === 403;
    throw new CreditAuthorizationError(
      auth ? 'Sign-in session expired — refresh and retry.' : `Credit authorization could not be confirmed${e?.message ? `: ${String(e.message)}` : '.'}`,
      { code: auth ? 'session_expired' : 'credit_authorization_unavailable', status },
    );
  }

  const state = toState(data);
  if (state) publish(state);
  if (data?.code === 'insufficient_credits') {
    const balance = state ? state.balance : 0;
    const plan = state ? state.plan : 'free';
    openPricing('credits', { required: cost, balance, seconds: Math.round(request.seconds) });
    throw new InsufficientCreditsError({ required: cost, balance, seconds: Math.round(request.seconds), plan });
  }
  if (data?.ok !== true) {
    throw new CreditAuthorizationError(String(data?.error || 'Credit authorization was refused.'), {
      code: String(data?.code || 'credit_authorization_refused'),
    });
  }
  return { metered: true, charged: Math.max(0, Math.round(Number(data.charged) || 0)), state };
}

export async function chargeCredits(request: ChargeRequest): Promise<ChargeResult> {
  const cost = creditsForSeconds(request.seconds);
  if (!cost) return { metered: false, charged: 0, state: cached };

  const data = await callCredits({
    op: 'charge',
    entryKey: request.entryKey,
    seconds: Math.round(request.seconds),
    source: request.source || 'app',
    note: request.note,
  });
  if (!data) {
    console.warn('[VidVerge] credits not metered for this render — the wallet did not answer.');
    return { metered: false, charged: 0, state: cached };
  }

  const state = toState(data);
  if (state) publish(state);

  if (data.code === 'insufficient_credits') {
    const balance = state ? state.balance : 0;
    const plan = state ? state.plan : 'free';
    openPricing('credits', { required: cost, balance, seconds: Math.round(request.seconds) });
    throw new InsufficientCreditsError({ required: cost, balance, seconds: Math.round(request.seconds), plan });
  }

  if (data.ok !== true) {
    // A refusal we don't recognise (no verified email, bad payload) leaves the
    // render unmetered rather than blocking it.
    console.warn('[VidVerge] credits not metered:', data.code || data.error || 'unknown');
    return { metered: false, charged: 0, state };
  }

  return { metered: true, charged: Math.max(0, Math.round(Number(data.charged) || 0)), state };
}

/** Hand credits back when the provider never actually started the render. */
export async function refundCredits(entryKey: string, note?: string): Promise<void> {
  const data = await callCredits({ op: 'refund', entryKey, note });
  const state = toState(data);
  if (state) publish(state);
}

/** Authenticated refund variant for flows that must prove reconciliation. */
export async function refundCreditsStrict(entryKey: string, note?: string): Promise<void> {
  if (typeof window === 'undefined' || !getSessionId()) {
    throw new CreditAuthorizationError('Sign-in session expired — refresh and retry.', { code: 'session_expired', status: 401 });
  }
  let data: any;
  try {
    data = await callHook('vv-credits', { op: 'refund', entryKey, note });
  } catch (e: any) {
    const status = Math.round(Number(e?.status) || 0);
    throw new CreditAuthorizationError(
      status === 401 || status === 403 ? 'Sign-in session expired — refresh and retry.' : `Credit refund could not be confirmed${e?.message ? `: ${String(e.message)}` : '.'}`,
      { code: status === 401 || status === 403 ? 'session_expired' : 'credit_refund_unavailable', status },
    );
  }
  const state = toState(data);
  if (state) publish(state);
  if (data?.ok !== true) throw new CreditAuthorizationError(String(data?.error || 'Credit refund was refused.'), { code: String(data?.code || 'credit_refund_refused') });
}

/**
 * Ask what a render would cost without spending anything. Returns null when
 * the wallet is unknown, so a caller can tell "can't afford" apart from
 * "don't know yet".
 */
export async function quoteCredits(
  seconds: number,
): Promise<{ cost: number; balance: number; affordable: boolean; shortfall: number; state: CreditState | null } | null> {
  const data = await callCredits({ op: 'quote', seconds: Math.round(seconds) });
  if (!data || data.ok !== true) return null;
  const state = toState(data);
  if (state) publish(state);
  return {
    cost: Math.max(0, Math.round(Number(data.cost) || 0)),
    balance: state ? state.balance : 0,
    affordable: data.affordable === true,
    shortfall: Math.max(0, Math.round(Number(data.shortfall) || 0)),
    state,
  };
}

/**
 * React binding. Resolves on mount, re-renders on every balance movement, and
 * re-resolves when a session is established after the email gate.
 */
export function useCredits(): { credits: CreditState | null; loading: boolean; refresh: () => void } {
  const [credits, setCredits] = useState<CreditState | null>(() => getCachedCredits());
  const [loading, setLoading] = useState<boolean>(() => getCachedCredits() === null);

  useEffect(() => {
    let cancelled = false;

    const resolve = () => {
      if (cancelled) return;
      setLoading(true);
      void refreshCredits().then((next) => {
        if (cancelled) return;
        setCredits(next);
        setLoading(false);
      });
    };

    const onCreditsEvent = (event: Event) => {
      if (cancelled) return;
      setCredits(((event as CustomEvent).detail as CreditState | null) ?? getCachedCredits());
    };

    resolve();
    window.addEventListener(CREDITS_EVENT, onCreditsEvent as EventListener);
    window.addEventListener('audos:session-established', resolve as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(CREDITS_EVENT, onCreditsEvent as EventListener);
      window.removeEventListener('audos:session-established', resolve as EventListener);
    };
  }, []);

  return { credits, loading, refresh: () => void refreshCredits() };
}

// ---------------------------------------------------------------------------
// Checkout — native Audos payments (`stripe-payments`)
//
// Subscription pricing is server-authoritative: the amount, currency and
// cadence come from the `plans` array in data/payment-config.json, selected by
// `billingPlanId`. Nothing the browser sends can change what is charged.
// Pay-as-you-go is a one-time customer sale in whole $9 blocks.
//
// Both flows return to the app with `?vv_checkout=…&session_id=…`, which
// `consumeCheckoutReturn()` below hands to the wallet function — and the wallet
// re-reads the payment from the platform before crediting anything, so a
// hand-typed return URL buys nothing.
// ---------------------------------------------------------------------------

export const BILLING_PLAN_IDS: Partial<Record<PlanId, string>> = {
  creator: 'creator-monthly',
  pro: 'pro-monthly',
};

function returnUrl(kind: 'subscription' | 'credits'): string {
  const base = window.location.origin + window.location.pathname;
  // `subscription_success` is the platform's own post-checkout marker; the
  // shell already bootstraps a session from it, so it stays on the URL.
  const legacy = kind === 'subscription' ? 'subscription_success=true&' : '';
  return `${base}?${legacy}vv_checkout=${kind}&session_id={CHECKOUT_SESSION_ID}`;
}

export interface CheckoutStart {
  ok: boolean;
  error?: string;
}

/** Send the customer to checkout for Creator or Pro. */
export async function startSubscriptionCheckout(plan: 'creator' | 'pro', email: string): Promise<CheckoutStart> {
  const billingPlanId = BILLING_PLAN_IDS[plan];
  if (!billingPlanId) return { ok: false, error: 'That plan is not set up for checkout yet.' };
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Add your email in Settings first so the subscription has an account to attach to.' };
  }
  try {
    const res = await fetch('/api/payments/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': spaceId() },
      body: JSON.stringify({
        billingPlanId,
        customerEmail: email,
        successUrl: returnUrl('subscription'),
        cancelUrl: window.location.href,
        // Stamped onto the subscription so the `subscription-events` function
        // can find this wallet again on a renewal or a cancellation made on
        // the provider's own billing page.
        metadata: { vvEmail: email, vvPlan: plan, spaceId: spaceId() },
      }),
    });
    const data = await res.json().catch(() => null);
    if (data && data.checkoutUrl) {
      window.location.href = String(data.checkoutUrl);
      return { ok: true };
    }
    return { ok: false, error: String(data?.error || 'Checkout could not be opened. Try again in a moment.') };
  } catch (e: any) {
    return { ok: false, error: `Checkout could not be reached: ${String(e?.message || e)}` };
  }
}

/** Buy pay-as-you-go credits in whole $9 blocks (60 credits each). */
export async function startCreditPackCheckout(blocks: number, email: string): Promise<CheckoutStart> {
  const count = Math.max(1, Math.round(Number(blocks) || 1));
  const credits = count * PAYG_BLOCK_CREDITS;
  const amount = count * PAYG_BLOCK_PRICE_CENTS;
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Add your email in Settings first so the credits have an account to land in.' };
  }
  try {
    const res = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': spaceId() },
      body: JSON.stringify({
        amount,
        productName: `VidVerge — ${credits} credits`,
        productDescription: `${credits} video credits (${credits} seconds of video). Credits never expire.`,
        customerEmail: email,
        successUrl: returnUrl('credits'),
        cancelUrl: window.location.href,
        metadata: { vvEmail: email, vvCredits: String(credits), vvBlocks: String(count) },
      }),
    });
    const data = await res.json().catch(() => null);
    if (data && data.checkoutUrl) {
      window.location.href = String(data.checkoutUrl);
      return { ok: true };
    }
    return { ok: false, error: String(data?.error || 'Checkout could not be opened. Try again in a moment.') };
  } catch (e: any) {
    return { ok: false, error: `Checkout could not be reached: ${String(e?.message || e)}` };
  }
}

let checkoutReturnHandled = false;

/**
 * Finish a checkout the customer just came back from. Mounted once by the
 * shell: it hands the checkout session id to the wallet function, which
 * verifies the payment server-side before any credits move, then clears the
 * query string so a refresh cannot look like a second purchase.
 */
export async function consumeCheckoutReturn(): Promise<CreditState | null> {
  if (typeof window === 'undefined' || checkoutReturnHandled) return null;
  const params = new URLSearchParams(window.location.search);
  const kind = params.get('vv_checkout');
  const checkoutSessionId = params.get('session_id');
  if (!kind || !checkoutSessionId || checkoutSessionId.startsWith('{')) return null;
  checkoutReturnHandled = true;

  const data = await callCredits({ op: 'redeem_checkout', checkoutSessionId });
  const state = toState(data);
  if (state) publish(state);
  if (data && data.ok !== true) {
    console.warn('[VidVerge] checkout not applied yet:', data.code || data.error);
  }

  params.delete('vv_checkout');
  params.delete('session_id');
  const query = params.toString();
  window.history.replaceState(
    {},
    '',
    window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
  );
  return state;
}
