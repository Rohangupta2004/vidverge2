import React from 'react';
import { COLORS, RADIUS, SHADOW } from '../theme';

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
  const glow = tone === 'cyan' ? SHADOW.glowCyan : SHADOW.glow;

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
        background: active ? COLORS.surfaceAlt : COLORS.surface,
        border: '1px solid ' + (lit ? COLORS.borderHover : COLORS.border),
        borderRadius: RADIUS.lg,
        padding,
        color: COLORS.text,
        boxShadow: lit ? SHADOW.card + ', ' + glow : SHADOW.card,
        transition: 'border-color 180ms ease, box-shadow 220ms ease, background 180ms ease, transform 180ms ease',
        transform: interactive && hover ? 'translateY(-1px)' : 'none',
        cursor: interactive ? 'pointer' : undefined,
        opacity: disabled ? 0.5 : 1,
        outline: 'none',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export default Card;
