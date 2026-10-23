import React from 'react';
import { Check } from 'lucide-react';
import { COLORS, GRADIENT, RADIUS } from '../theme';

/**
 * Dark surface card: amber hairline border, 16px radius, and an amber glow on
 * hover. Interactive only when an onClick is supplied.
 */

export interface CardProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Draws the selected state: brighter border and a persistent glow. */
  active?: boolean;
  /** Dim + block interaction. */
  disabled?: boolean;
  /** Inner padding in px. */
  padding?: number;
  /** Accent the glow with cyan instead of amber. */
  tone?: 'brand' | 'cyan';
  title?: string;
}

const Card: React.FC<CardProps> = function Card({
  children,
  className,
  style,
  onClick,
  active = false,
  disabled = false,
  padding = 20,
  tone = 'brand',
  title,
}) {
  const [hover, setHover] = React.useState(false);
  const interactive = Boolean(onClick) && !disabled;
  const lit = active || (interactive && hover);

  return (
    <div
      className={className}
      title={title}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={
        interactive
          ? function onKey(e) {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (onClick) onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
              }
            }
          : undefined
      }
      onMouseEnter={function onEnter() {
        setHover(true);
      }}
      onMouseLeave={function onLeave() {
        setHover(false);
      }}
      style={{
        position: 'relative',
        background: active ? GRADIENT.selected : COLORS.surface,
        border: '1px solid ' + (lit ? COLORS.controlBorder : COLORS.border),
        borderRadius: RADIUS.card,
        padding,
        color: COLORS.text,
        boxShadow: 'none',
        transition: 'border-color 180ms cubic-bezier(.2,0,0,1), background 180ms cubic-bezier(.2,0,0,1)',
        transform: 'none',
        cursor: interactive ? 'pointer' : undefined,
        opacity: disabled ? 0.5 : 1,
        outline: 'none',
        ...style,
      }}
    >
      {active ? (
        <span aria-label="Selected" title="Selected" style={{ position: 'absolute', top: 12, right: 12, display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 6, background: COLORS.accent, color: COLORS.onAccent }}>
          <Check size={15} strokeWidth={2.4} />
        </span>
      ) : null}
      {children}
    </div>
  );
};

export default Card;
