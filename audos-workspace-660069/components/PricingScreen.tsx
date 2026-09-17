/**
 * PricingScreen — VidVerge's plans, full frame.
 *
 * Mounted by the shell and rendered as an overlay above everything (dock,
 * agent panel, app windows) so the plans always get the whole screen whatever
 * state the shell is in. It opens from the crown button in the shell chrome,
 * the Plans button in My Videos, or the first time a free-trial visitor
 * reaches for a second video (`trigger: 'trial-limit'`).
 *
 * Checkout is not connected yet (Stripe is a separate task). The CTAs log the
 * chosen plan and say so plainly instead of pretending to take money.
 */
import { useEffect, useState } from 'react';
import { Check, Clapperboard, Crown, Sparkles, X } from 'lucide-react';
import { hasUnlimitedVideos, isPaidTier, isProTier, REELIO_PLANS } from '../lib/plans';
import type { PlanId, PricingTrigger, ReelioPlan } from '../lib/plans';

interface PricingScreenProps {
  trigger?: PricingTrigger;
  /** Plan the visitor is on today — marked "Current plan" on its card. */
  currentPlanId?: PlanId;
  onClose: () => void;
}

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const STYLES = `
@keyframes rlpFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes rlpRise { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: none } }
@keyframes rlpBreathe { 0%, 100% { opacity: .5 } 50% { opacity: .85 } }
.rlp-root { animation: rlpFade .26s ease both; }
.rlp-rise { animation: rlpRise .55s cubic-bezier(.16,1,.3,1) both; }
.rlp-breathe { animation: rlpBreathe 9s ease-in-out infinite; }
.rlp-card { transition: transform .32s cubic-bezier(.16,1,.3,1), border-color .32s ease, box-shadow .32s ease; }
.rlp-card:hover { transform: translateY(-6px); }
@media (min-width: 1024px) {
  .rlp-feat { transform: translateY(-8px); }
  .rlp-feat:hover { transform: translateY(-14px); }
}
.rlp-cta { transition: transform .18s ease, filter .18s ease, box-shadow .28s ease, border-color .2s ease, background .2s ease; }
.rlp-cta:hover { transform: translateY(-1px); filter: brightness(1.08); }
.rlp-ghost { transition: color .2s ease, border-color .2s ease, background .2s ease; }
.rlp-ghost:hover { color: #fff; border-color: rgba(255,255,255,.26); background: rgba(255,255,255,.06); }
.rlp-scroll::-webkit-scrollbar { width: 9px; }
.rlp-scroll::-webkit-scrollbar-track { background: transparent; }
.rlp-scroll::-webkit-scrollbar-thumb { background: #262626; border-radius: 999px; }
`;

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function PlanCard({
  plan,
  index,
  isCurrent,
  unlimitedQuota,
  onChoose,
  chosen,
}: {
  plan: ReelioPlan;
  index: number;
  isCurrent: boolean;
  /** This is the visitor's own plan and their row lifts the monthly cap. */
  unlimitedQuota?: boolean;
  onChoose: (plan: ReelioPlan) => void;
  chosen: boolean;
}) {
  const featured = !!plan.featured;

  return (
    <div
      className={`rlp-card rlp-rise${featured ? ' rlp-feat' : ''}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 20,
        padding: featured ? '30px 24px 26px' : '26px 22px 24px',
        background: featured
          ? `linear-gradient(180deg, ${hexToRgba(plan.accent, 0.16)} 0%, #101010 46%, #0d0d0d 100%)`
          : '#101010',
        border: `1px solid ${featured ? hexToRgba(plan.accent, 0.5) : '#212121'}`,
        boxShadow: featured
          ? `0 0 0 1px ${hexToRgba(plan.accent, 0.18)}, 0 28px 74px ${hexToRgba(plan.accent, 0.3)}`
          : '0 14px 40px rgba(0,0,0,0.45)',
        animationDelay: `${120 + index * 80}ms`,
      }}
      data-testid={`plan-card-${plan.id}`}
    >
      {plan.badge && (
        <span
          style={{
            position: 'absolute',
            top: -11,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            padding: '5px 13px',
            borderRadius: 999,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: '#fff',
            background: 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)',
            boxShadow: '0 8px 22px rgba(37,99,235,0.5)',
          }}
        >
          {plan.badge}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: plan.accent,
            boxShadow: `0 0 12px ${hexToRgba(plan.accent, 0.9)}`,
          }}
        />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#fff', letterSpacing: 0.1 }}>
          {plan.name}
        </h3>
        {isCurrent && (
          <span
            style={{
              marginLeft: 'auto',
              padding: '3px 8px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 0.3,
              color: '#9ca3af',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            Current
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontSize: featured ? 44 : 40,
            fontWeight: 700,
            letterSpacing: -1.4,
            color: '#fff',
            lineHeight: 1,
          }}
        >
          {plan.price}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: '#6b7280' }}>{plan.cadence}</span>
      </div>

      <div
        style={{
          marginTop: 14,
          display: 'inline-flex',
          alignSelf: 'flex-start',
          alignItems: 'center',
          gap: 7,
          padding: '6px 11px',
          borderRadius: 999,
          fontSize: 12.5,
          fontWeight: 600,
          color: plan.accent,
          background: hexToRgba(plan.accent, 0.1),
          border: `1px solid ${hexToRgba(plan.accent, 0.26)}`,
        }}
      >
        <Clapperboard size={13} />
        {unlimitedQuota ? 'Unlimited videos' : plan.quota}
      </div>

      <p style={{ margin: '16px 0 0', fontSize: 13.5, lineHeight: 1.55, color: '#9ca3af' }}>{plan.pitch}</p>

      <ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'grid', gap: 10 }}>
        {plan.features.map((feature) => (
          <li key={feature} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <span
              style={{
                flex: '0 0 auto',
                marginTop: 1,
                width: 16,
                height: 16,
                borderRadius: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: hexToRgba(plan.accent, 0.14),
              }}
            >
              <Check size={10} color={plan.accent} strokeWidth={3} />
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: '#d1d5db' }}>{feature}</span>
          </li>
        ))}
      </ul>

      <div style={{ flex: 1, minHeight: 22 }} />

      <button
        type="button"
        onClick={() => onChoose(plan)}
        className="rlp-cta"
        style={{
          width: '100%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '12px 16px',
          borderRadius: 12,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: 'pointer',
          color: '#fff',
          border: featured ? 'none' : `1px solid ${hexToRgba(plan.accent, 0.4)}`,
          background: featured
            ? 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)'
            : hexToRgba(plan.accent, 0.1),
          boxShadow: featured ? '0 12px 32px rgba(37,99,235,0.45)' : 'none',
        }}
        data-testid={`button-plan-${plan.id}`}
      >
        {chosen || isCurrent ? <Check size={15} /> : null}
        {isCurrent && plan.id !== 'free' ? 'Your plan' : chosen ? 'Noted' : plan.cta}
        {!chosen && !isCurrent && featured ? <span aria-hidden style={{ marginLeft: 2 }}>→</span> : null}
      </button>

      {chosen && (
        <p style={{ margin: '9px 0 0', fontSize: 11.5, lineHeight: 1.45, textAlign: 'center', color: '#6b7280' }}>
          {plan.id === 'free'
            ? 'Go tell Verger your idea — your first video is on us.'
            : "Checkout isn't live yet — we've logged that this is the plan you want."}
        </p>
      )}
    </div>
  );
}

export default function PricingScreen({ trigger = 'nav', currentPlanId = 'free', onClose }: PricingScreenProps) {
  const [chosenPlanId, setChosenPlanId] = useState<PlanId | null>(null);
  // A paid tier comes from the `subscriptions` access list, so this screen is
  // a receipt for them rather than an upgrade pitch — and the trial-wall copy
  // must never appear for someone who is already entitled.
  const subscriber = isPaidTier(currentPlanId);
  // A row with video_limit NULL means no monthly cap at all, so the card and
  // the banner say "unlimited" instead of quoting the published quota.
  const unlimited = subscriber && hasUnlimitedVideos(currentPlanId);
  const tierLabel = isProTier(currentPlanId)
    ? 'Pro'
    : currentPlanId === 'creator'
      ? 'Creator'
      : 'Pay-as-you-go';
  const atTrialWall = trigger === 'trial-limit' && !subscriber;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const choosePlan = (plan: ReelioPlan) => {
    console.log('[VidVerge] plan selected', {
      planId: plan.id,
      plan: plan.name,
      price: `${plan.price}${plan.cadence}`,
      trigger,
      note: 'payments not integrated yet — intent only',
    });
    setChosenPlanId(plan.id);

    // The free tier needs no checkout: send them straight back to Reel.
    if (plan.id === 'free') {
      window.setTimeout(() => {
        onClose();
        window.dispatchEvent(new CustomEvent('openAgentChat'));
      }, 650);
    }
  };

  return (
    <div
      className="rlp-root rlp-scroll"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        overflowY: 'auto',
        background: '#080808',
        color: '#fff',
        fontFamily: FONT,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="VidVerge plans"
      data-testid="pricing-screen"
    >
      <style>{STYLES}</style>

      {/* Cinematic wash — blue over the middle, teal creeping in from the edge */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div
          className="rlp-breathe"
          style={{
            position: 'absolute',
            top: '-26%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 900,
            height: 640,
            background: 'radial-gradient(circle at 50% 50%, rgba(37,99,235,0.34), transparent 62%)',
            filter: 'blur(90px)',
          }}
        />
        <div
          className="rlp-breathe"
          style={{
            position: 'absolute',
            bottom: '-22%',
            left: '-12%',
            width: 620,
            height: 620,
            background: 'radial-gradient(circle at 50% 50%, rgba(13,148,136,0.26), transparent 62%)',
            filter: 'blur(100px)',
            animationDelay: '3s',
          }}
        />
        <div
          className="rlp-breathe"
          style={{
            position: 'absolute',
            bottom: '-18%',
            right: '-14%',
            width: 560,
            height: 560,
            background: 'radial-gradient(circle at 50% 50%, rgba(29,78,216,0.26), transparent 60%)',
            filter: 'blur(100px)',
            animationDelay: '6s',
          }}
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="rlp-ghost"
        aria-label="Close plans"
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          zIndex: 3,
          width: 38,
          height: 38,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 999,
          cursor: 'pointer',
          color: '#9ca3af',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}
        data-testid="button-close-pricing"
      >
        <X size={17} />
      </button>

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          padding: '64px 24px 56px',
        }}
      >
        {/* Header */}
        {subscriber && (
          <div
            className="rlp-rise"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              maxWidth: 620,
              margin: '0 auto 26px',
              padding: '12px 18px',
              borderRadius: 14,
              textAlign: 'center',
              border: '1px solid rgba(37,99,235,0.4)',
              background:
                'linear-gradient(90deg, rgba(37,99,235,0.18) 0%, rgba(29,78,216,0.10) 100%), #0d0d0d',
            }}
            data-testid="banner-active-plan"
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: '#fff',
                background: 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)',
              }}
            >
              <Crown size={12} /> {tierLabel}
            </span>
            <span style={{ fontSize: 13.5, color: '#d1d5db' }}>
              {unlimited ? (
                <>
                  You&apos;re on VidVerge {tierLabel} with unlimited videos — no monthly cap, no trial
                  limit, and nothing to buy.
                </>
              ) : (
                <>
                  You&apos;re on VidVerge {tierLabel} — everything below is already unlocked, and
                  there&apos;s no trial limit on your account.
                </>
              )}
            </span>
          </div>
        )}

        <div className="rlp-rise" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 46px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 13px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              color: '#93c5fd',
              background: 'rgba(37,99,235,0.12)',
              border: '1px solid rgba(37,99,235,0.28)',
            }}
          >
            {atTrialWall ? <Sparkles size={12} /> : <Crown size={12} />}
            {atTrialWall ? 'Free trial used' : 'VidVerge plans'}
          </span>

          <h1
            style={{
              margin: '20px 0 0',
              fontSize: 'clamp(30px, 5vw, 46px)',
              fontWeight: 700,
              letterSpacing: -1.4,
              lineHeight: 1.08,
              color: '#fff',
            }}
          >
            {atTrialWall ? (
              <>
                That one&apos;s in the can.
                <br />
                <span
                  style={{
                    background: 'linear-gradient(90deg, #60a5fa 0%, #5eead4 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  Make your next video.
                </span>
              </>
            ) : (
              <>
                Make your next video.
                <br />
                <span
                  style={{
                    background: 'linear-gradient(90deg, #60a5fa 0%, #5eead4 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                  }}
                >
                  And the ten after it.
                </span>
              </>
            )}
          </h1>

          <p style={{ margin: '18px auto 0', maxWidth: 540, fontSize: 15.5, lineHeight: 1.6, color: '#9ca3af' }}>
            {atTrialWall
              ? 'Your free video is yours to keep. Pick the pace you want to post at and Verger keeps rolling — same character, same voice, every time.'
              : 'Every plan runs the full pipeline: your brief becomes a script, a character who stays the same in every shot and speaks your lines on camera, and a finished MP4 with sound. The only question is how often you ship.'}
          </p>
        </div>

        {/* Plans */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(238px, 1fr))',
            gap: 20,
            alignItems: 'stretch',
            paddingTop: 12,
          }}
        >
          {REELIO_PLANS.map((plan, index) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              index={index}
              isCurrent={plan.id === currentPlanId}
              unlimitedQuota={unlimited && plan.id === currentPlanId}
              chosen={chosenPlanId === plan.id}
              onChoose={choosePlan}
            />
          ))}
        </div>

        {/* Reassurance */}
        <div
          className="rlp-rise"
          style={{
            marginTop: 40,
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '10px 26px',
            animationDelay: '440ms',
          }}
        >
          {['No watermarks, ever', 'Cancel any time', 'Your videos stay yours', 'Sound built in'].map((item) => (
            <span key={item} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#6b7280' }}>
              <Check size={12} color="#5eead4" strokeWidth={3} />
              {item}
            </span>
          ))}
        </div>

        <p style={{ margin: '22px auto 0', maxWidth: 560, textAlign: 'center', fontSize: 12, lineHeight: 1.6, color: '#4b5563' }}>
          Every video: 15–60 seconds, up to eight scenes, one character who looks the same in all of them, with sound.
          {subscriber
            ? unlimited
              ? ` Your ${tierLabel} access is already active on this account, with no cap on how many you make — nothing to buy.`
              : ` Your ${tierLabel} access is already active on this account — nothing to buy.`
            : ' Payments aren\u2019t switched on yet — picking a plan just tells us where you\u2019re headed.'}
        </p>

        <div style={{ marginTop: 26, textAlign: 'center' }}>
          <button
            type="button"
            onClick={onClose}
            className="rlp-ghost"
            style={{
              padding: '10px 20px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              color: '#9ca3af',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
            data-testid="button-dismiss-pricing"
          >
            {atTrialWall ? 'Not right now — back to my videos' : 'Back to making videos'}
          </button>
        </div>
      </div>
    </div>
  );
}
