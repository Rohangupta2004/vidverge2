/**
 * MODEL GRID — the sleek card grid every Script-to-Video surface uses to pick
 * a video model. One component so the Agent Studio and the film Create screen
 * can never drift apart, and so a model is always presented with its name, its
 * family, what it accepts and why it is disabled when it is.
 */
import { Check, Lock, Zap } from 'lucide-react';
import { T } from './api';

export interface ModelGridOption {
  id: string;
  label: string;
  /** Provider/family word shown above the name ("Runway", "Seedance", …). */
  family?: string;
  /** One line of what the model is good for. */
  blurb?: string;
  /** Small line under the name — accepted inputs, price, clip length. */
  meta?: string;
  /** Corner badge: 'Fast' | 'Cinematic' | 'Default' … */
  badge?: string;
  available: boolean;
  /** Shown in the tooltip and under the name when the model is disabled. */
  unavailableReason?: string;
}

export default function ModelGrid(props: {
  options: ModelGridOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Tighter cards for the composer strip. */
  compact?: boolean;
}) {
  const { options, value, onChange, disabled, compact } = props;
  const minWidth = compact ? 158 : 196;

  return (
    <div
      role="radiogroup"
      aria-label="Video model"
      style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap: 9 }}
    >
      {options.map((option) => {
        const active = option.id === value;
        const locked = !option.available;
        const clickable = !locked && !disabled;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={locked || disabled}
            title={locked ? (option.unavailableReason || `${option.label} is not available right now.`) : (option.blurb || option.label)}
            onClick={() => { if (clickable) onChange(option.id); }}
            className={clickable ? 's2v-lift' : undefined}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 3,
              textAlign: 'left',
              background: active
                ? 'linear-gradient(160deg, rgba(245,158,11,0.16), rgba(245,158,11,0.05))'
                : 'rgba(255,255,255,0.035)',
              border: `1px solid ${active ? T.live : 'rgba(255,255,255,0.09)'}`,
              boxShadow: active ? '0 0 0 1px rgba(245,158,11,0.35), 0 8px 24px rgba(0,0,0,0.35)' : 'none',
              borderRadius: 13,
              padding: compact ? '10px 12px' : '12px 14px',
              cursor: clickable ? 'pointer' : 'not-allowed',
              opacity: locked ? 0.42 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
              <span style={{ color: active ? T.live : T.dim, fontSize: 9.5, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase' }}>
                {option.family || 'Model'}
              </span>
              {option.badge ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: T.muted, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', border: `1px solid ${T.dim}`, borderRadius: 999, padding: '1px 6px' }}>
                  {option.badge === 'Fast' ? <Zap size={8} /> : null}{option.badge}
                </span>
              ) : null}
              <span style={{ marginLeft: 'auto', color: active ? T.live : 'transparent', display: 'flex' }}>
                {locked ? <Lock size={12} color={T.dim} /> : <Check size={13} />}
              </span>
            </div>
            <div style={{ color: active ? T.bone : '#D6DAE3', fontSize: compact ? 13 : 13.5, fontWeight: 700, letterSpacing: -0.1 }}>
              {option.label}
            </div>
            {option.meta ? (
              <div style={{ color: T.muted, fontSize: 10.5, lineHeight: 1.45 }}>{option.meta}</div>
            ) : null}
            {!compact && option.blurb && !locked ? (
              <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.5 }}>{option.blurb}</div>
            ) : null}
            {locked && option.unavailableReason ? (
              <div style={{ color: T.dim, fontSize: 10, lineHeight: 1.45 }}>Not enabled on the platform yet</div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
