/**
 * CreditBalance — the customer's credit balance, always in view.
 *
 * Credits are the only meter in VidVerge (1 credit = 1 second of finished
 * video), so the number belongs in the shell chrome next to Plans rather than
 * buried in Settings. Tapping it opens the plans screen, which is also where
 * topping up happens.
 *
 * It renders nothing at all until a balance is actually known: a visitor who
 * has not signed in yet has no wallet, and "0 credits" would be a lie.
 */
import { Coins } from 'lucide-react';
import { openPricing } from '../lib/plans';
import { formatCredits, useCredits } from '../lib/credits';

/** Below this the pill turns amber — not enough left for a short clip. */
const LOW_BALANCE = 30;

interface CreditBalanceProps {
  /** 'chrome' = the desktop top bar pill, 'dock' = the compact mobile dock button. */
  variant?: 'chrome' | 'dock';
  className?: string;
}

export default function CreditBalance({ variant = 'chrome', className = '' }: CreditBalanceProps) {
  const { credits } = useCredits();
  if (!credits) return null;

  const low = credits.balance < LOW_BALANCE;
  const title = low
    ? `${formatCredits(credits.balance)} credits left — about ${formatCredits(credits.balance)} seconds of video. Tap to top up.`
    : `${formatCredits(credits.balance)} credits — ${formatCredits(credits.balance)} seconds of video on ${credits.planLabel}`;

  if (variant === 'dock') {
    return (
      <button
        onClick={() => openPricing('nav')}
        aria-label={title}
        title={title}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold transition-all ${className}`}
        style={{
          color: low ? '#180f02' : 'var(--space-text-brand)',
          background: low ? 'var(--space-brand-primary)' : 'var(--space-surface-accent-soft)',
        }}
        data-testid="button-credit-balance-mobile"
        data-credit-balance={credits.balance}
      >
        <Coins className="w-4 h-4" />
        {formatCredits(credits.balance)}
      </button>
    );
  }

  return (
    <button
      onClick={() => openPricing('nav')}
      title={title}
      className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-all hover:scale-105 ${className}`}
      style={{
        color: '#fff',
        background: 'linear-gradient(90deg, #10141f 0%, #0b0e16 100%)',
        border: low ? '1px solid rgba(245,158,11,0.6)' : '1px solid rgba(148,163,184,0.28)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
      }}
      data-testid="button-credit-balance"
      data-credit-balance={credits.balance}
    >
      <Coins className="w-4 h-4" style={{ color: low ? '#f59e0b' : '#fbbf24' }} />
      {formatCredits(credits.balance)}
      <span style={{ color: '#94a3b8', fontWeight: 500 }}>{low ? 'left — top up' : 'credits'}</span>
    </button>
  );
}
