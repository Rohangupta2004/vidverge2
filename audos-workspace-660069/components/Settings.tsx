import { useState, useEffect } from 'react';
import { Save, CreditCard, Coins, Crown, LogOut, Clock, CheckCircle2, AlertCircle, Loader2, ExternalLink, CalendarX } from 'lucide-react';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import { settingsStyles } from '../lib/colors';
import { isPaidTier, isProTier, openPricing, useUserTier } from '../lib/plans';
import { formatCredits, useCredits } from '../lib/credits';
import { scopedSpaceSessionStorageKey } from '../lib/tenant-delegation-scope';

interface SettingsProps {
  spaceId: string;
}

interface SubscriptionStatus {
  status: 'not_registered' | 'registered' | 'trial' | 'trialing' | 'trial_expired' | 'active' | 'canceled' | 'past_due';
  trialDaysRemaining: number;
  trialDays: number;
  trialExpired: boolean;
  trialStartDate: string | null;
  hasPaymentMethod: boolean;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  contactId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

interface PaymentConfig {
  enabled: boolean;
  mode: 'platform' | 'connect';
  defaultTrialDays: number;
  defaultPriceCents: number;
}

interface StoredSession {
  id?: string;
  sessionId?: string;
  workspaceSessionId?: string;
  email?: string;
  createdAt?: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
  isReturningUser?: boolean;
  workspaceId?: string;
}

function getPaymentAppId(spaceId: string) {
  const runtimeWindow = window as Window & {
    __APP_ID__?: string;
    __SPACE_ID__?: string;
  };
  return runtimeWindow.__APP_ID__ || runtimeWindow.__SPACE_ID__ || spaceId;
}

function getSessionStorageKey(spaceId: string) {
  return scopedSpaceSessionStorageKey(spaceId);
}

export default function Settings({ spaceId }: SettingsProps) {
  const { setSessionId, sessionId: contextSessionId } = useSpaceRuntime();
  // VidVerge access tier from the `subscriptions` table (email -> tier +
  // video_limit). This is separate from the platform's Stripe subscription
  // state below: a row here grants access directly, so it is shown first, and
  // a granted account is never shown a checkout or an upgrade nudge.
  const {
    tier: userTier,
    loading: tierLoading,
  } = useUserTier(spaceId, contextSessionId);
  // Credits are the product's only meter (1 credit = 1 second of finished
  // video), so the account panel shows a balance rather than a video count.
  const { credits } = useCredits();
  const subscriber = isPaidTier(userTier);
  const tierLabel = isProTier(userTier)
    ? 'Pro'
    : userTier === 'creator'
      ? 'Creator'
      : userTier === 'payg'
        ? 'Pay-as-you-go'
        : 'Free Trial';
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [managingPortal, setManagingPortal] = useState(false);
  const [portalMessage, setPortalMessage] = useState('');

  useEffect(() => {
    // Use localStorage for cross-browser persistence (matching EmailGate.tsx)
    // Re-read when spaceId or contextSessionId changes (session update trigger)
    const sessionKey = getSessionStorageKey(spaceId);
    const existingSession = localStorage.getItem(sessionKey);
    console.log('[Settings] Loading session for:', spaceId, 'session:', existingSession, 'contextSessionId:', contextSessionId);
    
    if (existingSession) {
      try {
        const session = JSON.parse(existingSession);
        console.log('[Settings] Found session email:', session.email);
        setEmail(session.email || '');
      } catch (e) {
        console.error('Failed to parse session:', e);
      }
    }
    
    loadPaymentConfig();
  }, [spaceId, contextSessionId]);

  useEffect(() => {
    console.log('[Settings] Email effect triggered, email:', email, 'spaceId:', spaceId);
    if (email && email.includes('@')) {
      console.log('[Settings] Loading subscription status for:', email);
      loadSubscriptionStatus();
    }
  }, [email, spaceId]);

  const loadPaymentConfig = async () => {
    try {
      const response = await fetch('/api/space-data/payment-config.json');
      if (response.ok) {
        const config = await response.json();
        setPaymentConfig(config);
      }
    } catch (e) {
      console.log('Payment config not found');
    }
  };

  const loadSubscriptionStatus = async (targetEmail = email) => {
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (!normalizedEmail) return;
    
    setStatusLoading(true);
    try {
      const response = await fetch(`/api/space/${spaceId}/subscription-status?email=${encodeURIComponent(normalizedEmail)}`);
      if (response.ok) {
        const status = await response.json();
        setSubscriptionStatus(status);
      }
    } catch (e) {
      console.error('Failed to load subscription status:', e);
    } finally {
      setStatusLoading(false);
    }
  };

  const syncSessionIdentity = async (rawEmail: string) => {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new Error('Please enter a valid email address');
    }

    const sessionKey = getSessionStorageKey(spaceId);
    const existingSessionRaw = localStorage.getItem(sessionKey);
    const existingSession: StoredSession | null = existingSessionRaw
      ? JSON.parse(existingSessionRaw)
      : null;

    const existingSessionId =
      existingSession?.workspaceSessionId ||
      existingSession?.sessionId ||
      existingSession?.id ||
      `anon_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const visitorId = document.cookie.match(/audos_vid=([^;]+)/)?.[1] || null;
    const response = await fetch(`/api/space/${spaceId}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        sessionId: existingSessionId,
        visitorId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to save settings');
    }

    const registerData = await response.json();
    const workspaceSessionId =
      registerData.workspaceSessionId ||
      registerData.sessionId ||
      existingSession?.workspaceSessionId ||
      existingSession?.sessionId ||
      existingSessionId;

    const nextSession: StoredSession = {
      ...existingSession,
      id: workspaceSessionId,
      sessionId: workspaceSessionId,
      workspaceSessionId,
      email: normalizedEmail,
      createdAt: existingSession?.createdAt || new Date().toISOString(),
      timestamp: Date.now(),
      metadata: registerData.metadata || existingSession?.metadata,
      isReturningUser: registerData.isReturningUser === true,
      workspaceId: registerData.workspaceId || existingSession?.workspaceId,
    };

    localStorage.setItem(sessionKey, JSON.stringify(nextSession));
    setSessionId(workspaceSessionId);
    setEmail(normalizedEmail);

    return { email: normalizedEmail, workspaceSessionId };
  };

  const handleSave = async () => {
    setError('');
    setLoading(true);
    
    try {
      const synced = await syncSessionIdentity(email);

      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 2000);

      // Reload subscription status after registration
      await loadSubscriptionStatus(synced.email);
    } catch (e) {
      console.error('Failed to save session:', e);
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    const sessionKey = getSessionStorageKey(spaceId);
    localStorage.removeItem(sessionKey);
    setEmail('');
    setSubscriptionStatus(null);
    setSessionId('');
    window.location.reload();
  };

  const handleSubscribe = async () => {
    setSubscribing(true);
    try {
      const synced = await syncSessionIdentity(email);
      const appId = getPaymentAppId(spaceId);
      const response = await fetch('/api/payments/subscribe', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-App-Id': appId
        },
        body: JSON.stringify({
          // The entry-level locked plan. Pro and pay-as-you-go are chosen on
          // the Plans screen; this button is the one-tap Creator path.
          billingPlanId: 'creator-monthly',
          customerEmail: synced.email,
          successUrl: window.location.origin + window.location.pathname + '?subscription_success=true&vv_checkout=subscription&session_id={CHECKOUT_SESSION_ID}',
          cancelUrl: window.location.href,
          // Stamped onto the subscription so `subscription-events` can find
          // this credit wallet again on a renewal or a cancellation.
          metadata: {
            spaceId,
            vvEmail: synced.email,
            vvPlan: 'creator',
          },
        })
      });

      const data = await response.json();
      console.log('[Settings] Subscribe response:', data);
      
      if (data.checkoutUrl) {
        // Task #1480: Reddit Pixel InitiateCheckout — fired immediately before
        // we redirect to Stripe Checkout. No server-side CAPI for this event
        // (Reddit treats it as top-of-funnel and we don't have a "checkout
        // started" webhook). Calls window.rdt directly — the queue stub
        // installed by the live PageVisit snippet (Task #1456) handles late
        // pixel.js loads.
        try {
          const rdt = (window as any).rdt;
          const pixelId = (window as any).__REDDIT_PIXEL_ID__;
          if (typeof rdt === 'function') {
            if (pixelId && synced?.email) {
              rdt('init', pixelId, { email: String(synced.email).toLowerCase().trim() });
            }
            const conversionId = `checkout_${spaceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            rdt('track', 'InitiateCheckout', { conversionId });
            console.log('[Settings] Reddit Pixel InitiateCheckout fired (conversionId=' + conversionId + ')');
          }
        } catch (e) {
          console.warn('[Settings] Reddit Pixel InitiateCheckout failed:', e);
        }

        window.location.href = data.checkoutUrl;
      } else {
        setError(data.error || 'Failed to start subscription');
      }
    } catch (e) {
      console.error('Failed to create subscription:', e);
      setError('Failed to start subscription');
    } finally {
      setSubscribing(false);
    }
  };

  const handleManageSubscription = async () => {
    setManagingPortal(true);
    setError('');
    setPortalMessage('');
    try {
      const synced = await syncSessionIdentity(email);
      const appId = getPaymentAppId(spaceId);
      const response = await fetch('/api/payments/portal/request-link', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-App-Id': appId
        },
        body: JSON.stringify({
          customerEmail: synced.email,
        })
      });

      if (response.status === 404) {
        const legacyResponse = await fetch('/api/payments/portal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Id': appId,
          },
          body: JSON.stringify({
            customerEmail: synced.email,
            returnUrl: window.location.origin + window.location.pathname,
          }),
        });
        const legacyData = await legacyResponse.json().catch(() => ({}));
        if (!legacyResponse.ok || !legacyData.url) {
          throw new Error(legacyData.error || 'Failed to open subscription management');
        }
        window.location.href = legacyData.url;
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to send secure account link');
      setPortalMessage('Check your email for a secure subscription-management link.');
    } catch (e) {
      console.error('Failed to open billing portal:', e);
      setError(e instanceof Error ? e.message : 'Failed to open subscription management');
    } finally {
      setManagingPortal(false);
    }
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  };

  const getStatusBadge = () => {
    if (!subscriptionStatus) return null;

    switch (subscriptionStatus.status) {
      case 'active':
        return (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${subscriptionStatus.cancelAtPeriodEnd ? 'bg-amber-500/15 text-amber-400' : 'bg-green-500/15 text-green-400'}`}>
            {subscriptionStatus.cancelAtPeriodEnd ? (
              <>
                <CalendarX className="w-4 h-4" />
                Cancels {subscriptionStatus.currentPeriodEnd
                  ? new Date(subscriptionStatus.currentPeriodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  : 'at period end'}
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Active Subscription
              </>
            )}
          </div>
        );
      case 'trial':
      case 'trialing':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/15 text-blue-400 rounded-full text-sm font-medium">
            <Clock className="w-4 h-4" />
            {subscriptionStatus.trialDaysRemaining} days left in trial
          </div>
        );
      case 'trial_expired':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 text-amber-400 rounded-full text-sm font-medium">
            <AlertCircle className="w-4 h-4" />
            Trial expired
          </div>
        );
      case 'past_due':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 text-red-400 rounded-full text-sm font-medium">
            <AlertCircle className="w-4 h-4" />
            Payment past due
          </div>
        );
      case 'canceled':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] rounded-full text-sm font-medium">
            <AlertCircle className="w-4 h-4" />
            Subscription canceled
          </div>
        );
      case 'registered':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] rounded-full text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" />
            Registered
          </div>
        );
      default:
        return null;
    }
  };

  // Granted accounts are excluded: their access does not come from Stripe, so
  // prompting them to pay would be asking for money they don't owe.
  const showPaymentCTA = subscriptionStatus && !subscriber &&
    ['trial', 'trialing', 'trial_expired', 'canceled', 'past_due', 'registered'].includes(subscriptionStatus.status);

  return (
    <div className={`${settingsStyles.container} bg-[radial-gradient(ellipse_70%_38%_at_50%_-8%,color-mix(in_srgb,var(--space-brand-primary-500)_10%,transparent),transparent_66%),var(--space-surface-bg)]`}>
      <div className={`${settingsStyles.innerContainer} mx-auto max-w-3xl`}>
        <div className="mb-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--space-text-brand)]">VidVerge account</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--space-text-primary)]">Your studio, plan and credits</h2>
          <p className="mt-2 text-sm text-[var(--space-text-secondary)]">Manage the identity and production balance shared by every VidVerge engine.</p>
        </div>
        {/* Account Section */}
        <div className={`${settingsStyles.section} rounded-2xl border border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-card)_94%,transparent)] p-6 shadow-[0_18px_48px_rgba(0,0,0,0.26)]`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--space-text-primary)]">
              Your Account
            </h3>
            {email && (
              <button
                onClick={handleSignOut}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--space-text-secondary)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                data-testid="button-sign-out"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            )}
          </div>

          <div>
            <label htmlFor="settings-email" className={settingsStyles.label}>
              Email Address
            </label>
            <input
              type="email"
              id="settings-email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="you@example.com"
              className={settingsStyles.input(!!error)}
              data-testid="input-settings-email"
            />
            {error && (
              <p className={settingsStyles.errorText} data-testid="text-settings-error">
                {error}
              </p>
            )}
            {portalMessage && (
              <p className="text-sm text-green-400" role="status">
                {portalMessage}
              </p>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={loading || !email || saved}
            className={settingsStyles.saveButton(loading || !email || saved)}
            data-testid="button-save-settings"
          >
            {saved ? (
              <>
                <Save className="w-4 h-4" />
                Saved
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>

        {/* Subscription Section */}
        {email && (
          <div className="mt-6 rounded-2xl border border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-card)_94%,transparent)] p-6 shadow-[0_18px_48px_rgba(0,0,0,0.26)]" style={{ minHeight: 185 }}>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[var(--space-text-muted)]" />
                <h3 className="text-sm font-semibold text-[var(--space-text-primary)]">
                  Subscription
                </h3>
              </div>
              <button
                onClick={() => openPricing('nav')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--space-brand-highlight)] bg-[color-mix(in_srgb,var(--space-brand-primary)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--space-brand-primary)_20%,transparent)] border border-[color-mix(in_srgb,var(--space-brand-primary)_40%,transparent)] rounded-lg transition-colors"
                data-testid="button-settings-plans"
              >
                <Crown className="w-3.5 h-3.5" />
                {subscriber ? 'Your VidVerge plan' : 'See VidVerge plans'}
              </button>
            </div>

            {credits && (
              <div
                className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] px-4 py-3"
                data-testid="settings-credit-row"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--space-text-primary)]">
                    <Coins className="w-4 h-4 text-[var(--space-text-brand)]" />
                    {formatCredits(credits.balance)} credits
                  </span>
                  <span className="text-xs text-[var(--space-text-muted)]">
                    {formatCredits(credits.balance)} seconds of video · 1 credit = 1 second, every engine
                  </span>
                </span>
                <button
                  onClick={() => openPricing('nav')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all hover:brightness-110 text-[var(--space-text-on-primary)] bg-[var(--space-brand-primary)]"
                  data-testid="button-settings-topup"
                >
                  Top up
                </button>
              </div>
            )}

            {!tierLoading && (
              <div
                className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3"
                style={{
                  borderColor: subscriber ? 'color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)' : 'var(--space-border-default)',
                  background: subscriber
                    ? 'linear-gradient(90deg, color-mix(in srgb, var(--space-brand-primary-500) 16%, transparent) 0%, color-mix(in srgb, var(--space-brand-highlight-500) 8%, transparent) 100%)'
                    : 'var(--space-surface-muted)',
                }}
                data-testid="settings-tier-row"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm text-[var(--space-text-secondary)]">VidVerge access</span>
                  <span className="text-xs text-[var(--space-text-muted)]">
                    {credits && credits.rollover && credits.monthlyCredits > 0
                      ? `${formatCredits(credits.monthlyCredits)} credits a month, rolling over`
                      : 'Credits never expire — top up in $9 blocks any time'}
                  </span>
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                  style={{
                    color: subscriber ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)',
                    background: subscriber
                      ? 'linear-gradient(135deg, var(--space-brand-primary, #D6AB4A) 0%, var(--space-brand-highlight, #F3D58B) 100%)'
                      : 'var(--space-surface-panel-strong)',
                  }}
                  data-testid="badge-settings-tier"
                >
                  <Crown className="w-3.5 h-3.5" />
                  {tierLabel}
                </span>
              </div>
            )}

            {statusLoading ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-[var(--space-text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading subscription status...
                </div>
                <div className="h-12 rounded-xl bg-[var(--space-surface-muted)]" aria-hidden="true" />
                <div className="mx-auto h-3 w-44 rounded-full bg-[var(--space-surface-muted)]" aria-hidden="true" />
              </div>
            ) : subscriber && subscriptionStatus?.status !== 'active' ? (
              // Access comes from the `subscriptions` list, so the Stripe trial
              // and checkout blocks below would be nonsense for this account.
              // An account that DOES hold a live Stripe subscription keeps the
              // normal panel, so it never loses its manage-billing link.
              <div
                className="p-4 rounded-xl border border-[color-mix(in_srgb,var(--space-brand-primary)_30%,transparent)] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--space-brand-primary)_15%,transparent),color-mix(in_srgb,var(--space-brand-highlight)_5%,transparent))]"
                data-testid="settings-granted-access"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <span className="text-sm font-medium text-[var(--space-text-primary)]">
                    VidVerge {tierLabel} access is active
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--space-text-secondary)]">
                  {`This account is on VidVerge ${tierLabel}${
                    credits && credits.monthlyCredits > 0
                      ? ` — ${formatCredits(credits.monthlyCredits)} credits a month, rolling over`
                      : ''
                  }. The access was granted directly, so there is no subscription to buy.`}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Status Badge */}
                {getStatusBadge()}

                {/* Trial Progress */}
                {(subscriptionStatus?.status === 'trial' || subscriptionStatus?.status === 'trialing') && (
                  <div className="p-4 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--space-brand-primary)_15%,transparent),color-mix(in_srgb,var(--space-brand-highlight)_10%,transparent))] rounded-xl border border-[color-mix(in_srgb,var(--space-brand-primary)_30%,transparent)]">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-[var(--space-text-primary)]">
                        Free Trial
                      </span>
                      <span className="text-sm text-[var(--space-text-secondary)]">
                        {subscriptionStatus.trialDaysRemaining} of {subscriptionStatus.trialDays} days remaining
                      </span>
                    </div>
                    <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-[var(--space-brand-primary)] to-[var(--space-brand-highlight)] rounded-full transition-all"
                        style={{ 
                          width: `${((subscriptionStatus.trialDays - subscriptionStatus.trialDaysRemaining) / subscriptionStatus.trialDays) * 100}%` 
                        }}
                      />
                    </div>
                    <p className="mt-3 text-xs text-[var(--space-text-secondary)]">
                      Add your payment method now to continue access after your trial ends.
                    </p>
                    {subscriptionStatus.hasPaymentMethod && (
                      <button
                        onClick={handleManageSubscription}
                        disabled={managingPortal}
                        className="mt-3 flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--space-text-secondary)] hover:text-[var(--space-text-primary)] hover:bg-white/10 border border-[var(--space-border-strong)] rounded-lg transition-colors disabled:opacity-50"
                      >
                        {managingPortal ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        Manage Billing
                      </button>
                    )}
                  </div>
                )}

                {/* Active Subscription Info */}
                {subscriptionStatus?.status === 'active' && (
                  <div className={`p-4 bg-gradient-to-r ${subscriptionStatus.cancelAtPeriodEnd ? 'from-amber-500/10 to-orange-500/5 border-amber-500/30' : 'from-green-500/10 to-emerald-500/5 border-green-500/30'} rounded-xl border`}>
                    {subscriptionStatus.cancelAtPeriodEnd ? (
                      <>
                        <div className="flex items-center gap-2">
                          <CalendarX className="w-5 h-5 text-amber-400" />
                          <span className="text-sm font-medium text-[var(--space-text-primary)]">
                            Subscription ending
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--space-text-secondary)]">
                          Your subscription will end on{' '}
                          <span className="font-semibold text-[var(--space-text-primary)]">
                            {subscriptionStatus.currentPeriodEnd
                              ? new Date(subscriptionStatus.currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
                              : 'the end of the current billing period'}
                          </span>. You will continue to have full access until then.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-green-400" />
                          <span className="text-sm font-medium text-[var(--space-text-primary)]">
                            You have full access
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--space-text-secondary)]">
                          Your subscription is active. Thank you for your support!
                        </p>
                      </>
                    )}
                    <button
                      onClick={handleManageSubscription}
                      disabled={managingPortal}
                      className="mt-3 flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--space-text-primary)] bg-[var(--space-surface-panel-strong)] hover:bg-white/10 border border-[var(--space-border-strong)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {managingPortal ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Opening...
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4" />
                          Manage Subscription
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Trial Expired Warning */}
                {subscriptionStatus?.status === 'trial_expired' && (
                  <div className="p-4 bg-gradient-to-r from-amber-500/10 to-orange-500/5 rounded-xl border border-amber-500/30">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-amber-400" />
                      <span className="text-sm font-medium text-[var(--space-text-primary)]">
                        Your trial has ended
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--space-text-secondary)]">
                      Subscribe now to continue accessing all features.
                    </p>
                  </div>
                )}

                {/* Payment CTA - show if in trial or expired, regardless of payment config */}
                {showPaymentCTA && (
                  <div className="space-y-3">
                    {paymentConfig && (
                      <div className="p-4 bg-[var(--space-surface-muted)] rounded-xl">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-[var(--space-text-primary)]">
                            Monthly Subscription
                          </span>
                          <span className="text-lg font-bold text-[var(--space-text-primary)]">
                            {formatPrice(paymentConfig.defaultPriceCents)}/mo
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[var(--space-text-secondary)]">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                            Full access
                          </span>
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                            Cancel anytime
                          </span>
                        </div>
                      </div>
                    )}

                    <button
                      onClick={handleSubscribe}
                      disabled={subscribing}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[var(--space-brand-primary)] to-[var(--space-brand-highlight)] hover:brightness-110 text-[var(--space-text-on-primary)] font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="button-subscribe"
                    >
                      {subscribing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Redirecting to checkout...
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4" />
                          {(subscriptionStatus?.status === 'trial' || subscriptionStatus?.status === 'trialing')
                            ? 'Add Payment Method' 
                            : 'Subscribe Now'}
                        </>
                      )}
                    </button>

                    <p className="text-center text-xs text-[var(--space-text-muted)]">
                      Secure payment powered by Stripe
                    </p>
                  </div>
                )}

                {/* Not registered yet */}
                {(!subscriptionStatus || subscriptionStatus.status === 'not_registered') && (
                  <div className="p-4 bg-[var(--space-surface-muted)] rounded-xl text-center">
                    <p className="text-sm text-[var(--space-text-secondary)]">
                      Save your email to start your free trial
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
