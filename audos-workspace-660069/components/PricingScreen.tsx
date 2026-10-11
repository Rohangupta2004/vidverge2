/**
 * PricingScreen — VidVerge's plans, full frame.
 *
 * Mounted by the shell and rendered as an overlay above everything (dock,
 * agent panel, app windows) so the plans always get the whole screen whatever
 * state the shell is in. It opens from the crown button in the shell chrome,
 * the credit pill, the Plans button in Settings, and automatically whenever a
 * generation is blocked for want of credits (`trigger: 'credits'`).
 *
 * The prices and credit amounts are LOCKED — they come from REELIO_PLANS in
 * lib/plans.ts and are never restated here. Checkout is live and runs through
 * native Audos payments: Creator and Pro are subscriptions resolved
 * server-side from data/payment-config.json, pay-as-you-go is a one-time sale
 * in whole $9 blocks.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Coins, Crown, Minus, Plus, Sparkles, X, Zap } from 'lucide-react';
import { currentUserEmail, REELIO_PLANS } from '../lib/plans';
import type { PlanId, PricingRequest, PricingTrigger, ReelioPlan } from '../lib/plans';
import {
  PAYG_BLOCK_CREDITS,
  PAYG_BLOCK_PRICE_CENTS,
  formatCredits,
  paygBlocksFor,
  startCreditPackCheckout,
  startSubscriptionCheckout,
  useCredits,
} from '../lib/credits';

interface PricingScreenProps {
  trigger?: PricingTrigger;
  /** Extra context when a generation was blocked (credits needed vs held). */
  request?: PricingRequest | null;
  /** Plan the visitor is on today — marked "Current" on its card. */
  currentPlanId?: PlanId;
  onClose: () => void;
}

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** The brand amber. The plans screen is the one place money is discussed, so
 *  it stays on the shell's accent rather than inventing a second palette. */
const BRAND = '#C8920A';

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
.rlp-cta:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.08); }
.rlp-cta:disabled { opacity: .6; cursor: default; }
.rlp-ghost { transition: color .2s ease, border-color .2s ease, background .2s ease; }
.rlp-ghost:hover { color: #1A1000; border-color: rgba(180,120,0,.36); background: rgba(180,120,0,.08); }
.rlp-step { transition: background .18s ease, border-color .18s ease; }
.rlp-step:not(:disabled):hover { background: rgba(180,120,0,.10); }
.rlp-step:disabled { opacity: .35; cursor: default; }
.rlp-scroll::-webkit-scrollbar { width: 9px; }
.rlp-scroll::-webkit-scrollbar-track { background: transparent; }
.rlp-scroll::-webkit-scrollbar-thumb { background: rgba(180,120,0,0.28); border-radius: 999px; }
`;

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function formatGrantDate(iso: string | null): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The four rules that define the meter, said once, in plain language. */
const CREDIT_RULES = [
  '1 credit = 1 second of finished video',
  'Same price on every engine — we pick it, you never think about it',
  'Scripting, briefs and talking to the agent are free',
  'Subscription credits roll over month to month',
];

function PlanCard({
  plan,
  index,
  isCurrent,
  highlighted,
  busy,
  error,
  paygBlocks,
  onPaygBlocksChange,
  onChoose,
}: {
  plan: ReelioPlan;
  index: number;
  isCurrent: boolean;
  /** The card this visitor should look at first. */
  highlighted: boolean;
  busy: boolean;
  error: string | null;
  paygBlocks: number;
  onPaygBlocksChange: (blocks: number) => void;
  onChoose: (plan: ReelioPlan) => void;
}) {
  const isPayg = plan.id === 'payg';
  const paygCredits = paygBlocks * PAYG_BLOCK_CREDITS;
  const paygPrice = paygBlocks * PAYG_BLOCK_PRICE_CENTS;

  return (
    <div
      className={`rlp-card rlp-rise${highlighted ? ' rlp-feat' : ''}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 20,
        padding: highlighted ? '30px 24px 26px' : '26px 22px 24px',
        background: highlighted
          ? `linear-gradient(180deg, ${hexToRgba(plan.accent, 0.16)} 0%, #FFFFFF 46%, #FFFDF4 100%)`
          : '#FFFFFF',
        border: `1px solid ${highlighted ? hexToRgba(plan.accent, 0.5) : 'rgba(180,120,0,0.14)'}`,
        boxShadow: highlighted
          ? `0 0 0 1px ${hexToRgba(plan.accent, 0.18)}, 0 28px 74px ${hexToRgba(plan.accent, 0.3)}`
          : '0 14px 40px rgba(120,80,0,0.12)',
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
            color: '#FFFFFF',
            background: `linear-gradient(90deg, ${plan.accent} 0%, ${hexToRgba(plan.accent, 0.75)} 100%)`,
            boxShadow: `0 8px 22px ${hexToRgba(plan.accent, 0.45)}`,
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
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1A1000', letterSpacing: 0.1 }}>
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
              color: '#7A6030',
              border: '1px solid rgba(180,120,0,0.14)',
            }}
            data-testid={`plan-current-${plan.id}`}
          >
            Current
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontSize: highlighted ? 44 : 40,
            fontWeight: 700,
            letterSpacing: -1.4,
            color: '#1A1000',
            lineHeight: 1,
          }}
        >
          {isPayg ? dollars(paygPrice) : plan.price}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: '#7A6030' }}>{plan.cadence}</span>
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
        data-testid={`plan-credits-${plan.id}`}
      >
        <Coins size={13} />
        {isPayg ? `${formatCredits(paygCredits)} credits` : plan.quota}
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5, color: hexToRgba(plan.accent, 0.85) }}>
        {plan.creditNote}
      </p>

      <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.55, color: '#7A6030' }}>{plan.pitch}</p>

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
            <span style={{ fontSize: 13, lineHeight: 1.5, color: '#3D2800' }}>{feature}</span>
          </li>
        ))}
      </ul>

      <div style={{ flex: 1, minHeight: 22 }} />

      {isPayg && (
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 12,
            border: '1px solid rgba(180,120,0,0.14)',
            background: 'rgba(180,120,0,0.06)',
          }}
        >
          <span style={{ fontSize: 11.5, color: '#7A6030' }}>$9 blocks</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="rlp-step"
              onClick={() => onPaygBlocksChange(paygBlocks - 1)}
              disabled={paygBlocks <= 1}
              aria-label="One block fewer"
              style={stepStyle}
              data-testid="button-payg-less"
            >
              <Minus size={13} />
            </button>
            <span style={{ minWidth: 20, textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#1A1000' }}>
              {paygBlocks}
            </span>
            <button
              type="button"
              className="rlp-step"
              onClick={() => onPaygBlocksChange(paygBlocks + 1)}
              disabled={paygBlocks >= 50}
              aria-label="One block more"
              style={stepStyle}
              data-testid="button-payg-more"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onChoose(plan)}
        disabled={busy || (plan.id === 'free' && isCurrent)}
        className="rlp-cta"
        style={{
          width: '100%',
          marginTop: 14,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '12px 16px',
          borderRadius: 12,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: 'pointer',
          color: highlighted ? '#FFFFFF' : '#1A1000',
          border: highlighted ? 'none' : `1px solid ${hexToRgba(plan.accent, 0.4)}`,
          background: highlighted
            ? `linear-gradient(90deg, ${plan.accent} 0%, ${hexToRgba(plan.accent, 0.8)} 100%)`
            : hexToRgba(plan.accent, 0.1),
          boxShadow: highlighted ? `0 12px 32px ${hexToRgba(plan.accent, 0.4)}` : 'none',
        }}
        data-testid={`button-plan-${plan.id}`}
      >
        {busy
          ? 'Opening checkout…'
          : plan.id === 'free'
            ? isCurrent
              ? 'Your current plan'
              : 'Included on every plan'
            : isPayg
              ? `Buy ${formatCredits(paygCredits)} credits — ${dollars(paygPrice)}`
              : isCurrent
                ? 'Manage in Settings'
                : plan.cta}
      </button>

      {error && (
        <p style={{ margin: '9px 0 0', fontSize: 11.5, lineHeight: 1.45, textAlign: 'center', color: '#991B1B' }}>
          {error}
        </p>
      )}
    </div>
  );
}

const stepStyle: CSSProperties = {
  width: 26,
  height: 26,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  cursor: 'pointer',
  color: '#3D2800',
  background: 'rgba(180,120,0,0.06)',
  border: '1px solid rgba(180,120,0,0.14)',
};

export default function PricingScreen({
  trigger = 'nav',
  request = null,
  currentPlanId = 'free',
  onClose,
}: PricingScreenProps) {
  const { credits } = useCredits();
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PlanId, string>>>({});

  // A credit wall knows exactly what it blocked, so it can say so instead of
  // showing a generic upsell.
  const atCreditWall = trigger === 'credits';
  const required = Math.max(0, Math.round(Number(request?.required) || 0));
  const seconds = Math.max(0, Math.round(Number(request?.seconds) || 0));
  const balance = credits ? credits.balance : Math.max(0, Math.round(Number(request?.balance) || 0));
  const shortfall = Math.max(0, required - balance);

  const plan: PlanId = credits ? credits.plan : currentPlanId;
  const [paygBlocks, setPaygBlocks] = useState(() => (shortfall > 0 ? paygBlocksFor(shortfall) : 1));

  useEffect(() => {
    if (shortfall > 0) setPaygBlocks(paygBlocksFor(shortfall));
  }, [shortfall]);

  // Free Trial leads for anyone who has not paid yet — it is the front door,
  // and a first-time visitor should see "start free" before they see a price.
  // Once they are paying (or out of credits) Pro leads instead.
  const highlightId: PlanId = useMemo(() => {
    if (plan === 'creator' || plan === 'pro' || plan === 'payg') return 'pro';
    if (atCreditWall) return 'creator';
    return 'free';
  }, [plan, atCreditWall]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const choosePlan = async (chosen: ReelioPlan) => {
    setErrors((prev) => ({ ...prev, [chosen.id]: '' }));

    if (chosen.id === 'free') {
      onClose();
      window.dispatchEvent(new CustomEvent('openAgentChat'));
      return;
    }

    const email = currentUserEmail() || (credits ? credits.email : '');
    setBusyPlan(chosen.id);
    try {
      const result =
        chosen.id === 'payg'
          ? await startCreditPackCheckout(paygBlocks, email)
          : await startSubscriptionCheckout(chosen.id as 'creator' | 'pro', email);
      // A successful start navigates away; only a refusal comes back here.
      if (!result.ok) setErrors((prev) => ({ ...prev, [chosen.id]: result.error || 'Checkout could not be opened.' }));
    } finally {
      setBusyPlan(null);
    }
  };

  const nextGrant = credits && credits.rollover ? formatGrantDate(credits.nextGrantAt) : '';

  return (
    <div
      className="rlp-root rlp-scroll"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        overflowY: 'auto',
        background: '#FFFDF4',
        color: '#1A1000',
        fontFamily: FONT,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="VidVerge plans"
      data-testid="pricing-screen"
    >
      <style>{STYLES}</style>

      {/* Cinematic wash — brand amber over the middle, teal creeping in at the edge */}
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
            background: 'radial-gradient(circle at 50% 50%, rgba(200,146,10,0.22), transparent 62%)',
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
            background: 'radial-gradient(circle at 50% 50%, rgba(224,163,58,0.22), transparent 62%)',
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
            background: 'radial-gradient(circle at 50% 50%, rgba(232,183,55,0.24), transparent 60%)',
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
          color: '#7A6030',
          background: 'rgba(180,120,0,0.06)',
          border: '1px solid rgba(180,120,0,0.14)',
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
        {/* The credit wall: what was blocked, what it cost, what is missing. */}
        {atCreditWall && required > 0 && (
          <div
            className="rlp-rise"
            style={{
              maxWidth: 660,
              margin: '0 auto 26px',
              padding: '14px 20px',
              borderRadius: 14,
              textAlign: 'center',
              border: `1px solid ${hexToRgba(BRAND, 0.45)}`,
              background: `linear-gradient(90deg, ${hexToRgba(BRAND, 0.18)} 0%, ${hexToRgba(BRAND, 0.06)} 100%), #FFFFFF`,
            }}
            data-testid="banner-credit-wall"
          >
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: '#1A1000' }}>
              <strong style={{ color: BRAND }}>{formatCredits(shortfall)} credits short.</strong>{' '}
              {seconds > 0 ? `That ${seconds}-second video costs ${formatCredits(required)} credits` : `That video costs ${formatCredits(required)} credits`}
              {' '}and you have {formatCredits(balance)}. Top up below and your render picks up where it left off.
            </p>
          </div>
        )}

        {/* Live balance — the same number the shell pill shows. */}
        {credits && (
          <div
            className="rlp-rise"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              maxWidth: 660,
              margin: '0 auto 26px',
              padding: '12px 18px',
              borderRadius: 14,
              textAlign: 'center',
              border: '1px solid rgba(180,120,0,0.14)',
              background: '#FFFFFF',
            }}
            data-testid="banner-credit-balance"
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
                color: '#FFFFFF',
                background: `linear-gradient(90deg, ${BRAND} 0%, #B4720A 100%)`,
              }}
            >
              <Crown size={12} /> {credits.planLabel}
            </span>
            <span style={{ fontSize: 13.5, color: '#3D2800' }}>
              You have <strong style={{ color: '#1A1000' }}>{formatCredits(credits.balance)} credits</strong>
              {' '}— {formatCredits(credits.balance)} seconds of video
              {credits.rollover && credits.monthlyCredits > 0
                ? `. Another ${formatCredits(credits.monthlyCredits)} land${nextGrant ? ` on ${nextGrant}` : ' next month'}, on top of whatever is left.`
                : '.'}
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
              color: '#B4720A',
              background: hexToRgba(BRAND, 0.12),
              border: `1px solid ${hexToRgba(BRAND, 0.28)}`,
            }}
          >
            {atCreditWall ? <Zap size={12} /> : <Sparkles size={12} />}
            {atCreditWall ? 'Out of credits' : 'VidVerge plans'}
          </span>

          <h1
            style={{
              margin: '20px 0 0',
              fontSize: 'clamp(30px, 5vw, 46px)',
              fontWeight: 700,
              letterSpacing: -1.4,
              lineHeight: 1.08,
              color: '#1A1000',
            }}
          >
            One credit.
            <br />
            <span
              style={{
                background: 'linear-gradient(90deg, #C8920A 0%, #B4720A 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              One second of video.
            </span>
          </h1>

          <p style={{ margin: '18px auto 0', maxWidth: 560, fontSize: 15.5, lineHeight: 1.6, color: '#7A6030' }}>
            That is the whole pricing model. Every engine costs the same, we pick the right one behind the
            scenes, and the only thing you ever spend on is the video itself.
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
          {REELIO_PLANS.map((entry, index) => (
            <PlanCard
              key={entry.id}
              plan={entry}
              index={index}
              isCurrent={entry.id === plan}
              highlighted={entry.id === highlightId}
              busy={busyPlan === entry.id}
              error={errors[entry.id] || null}
              paygBlocks={paygBlocks}
              onPaygBlocksChange={(next) => setPaygBlocks(Math.min(50, Math.max(1, next)))}
              onChoose={choosePlan}
            />
          ))}
        </div>

        {/* How credits work */}
        <div
          className="rlp-rise"
          style={{
            marginTop: 40,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 14,
            animationDelay: '440ms',
          }}
          data-testid="credit-rules"
        >
          {CREDIT_RULES.map((rule) => (
            <div
              key={rule}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                padding: '13px 15px',
                borderRadius: 14,
                border: '1px solid rgba(180,120,0,0.14)',
                background: '#FFFFFF',
              }}
            >
              <Coins size={14} color={BRAND} style={{ flex: '0 0 auto', marginTop: 2 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#3D2800' }}>{rule}</span>
            </div>
          ))}
        </div>

        <p style={{ margin: '22px auto 0', maxWidth: 580, textAlign: 'center', fontSize: 12, lineHeight: 1.6, color: '#7A6030' }}>
          A {PAYG_BLOCK_CREDITS}-credit block is {dollars(PAYG_BLOCK_PRICE_CENTS)} and buys a full minute of video — buy as many as
          you want, whenever you want, on any plan. Cancel a subscription any time; credits you already
          have stay yours.
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
              color: '#7A6030',
              background: 'transparent',
              border: '1px solid rgba(180,120,0,0.14)',
            }}
            data-testid="button-dismiss-pricing"
          >
            {atCreditWall ? 'Not right now — back to my videos' : 'Back to making videos'}
          </button>
        </div>
      </div>
    </div>
  );
}
