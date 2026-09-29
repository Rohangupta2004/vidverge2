/**
 * Shell — the shared LightBeam layout wrapper.
 *
 * Deep black surface, the VidVerge mark, one consistent nav rail, and a
 * LightBeamTransition sweep whenever the active view changes.
 *
 * The `lb-shell` class is what scopes the global reset (box-sizing, focus
 * ring, 4px gold scrollbar) to this subtree. Applying those rules to the
 * document would also restyle the dock, the agent chat and Settings, so the
 * reset travels with the wrapper instead.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colors, tint } from '../tokens/colors';
import { radii } from '../tokens/radii';
import { typography } from '../tokens/typography';
import { useBeamStyles } from '../animations/useBeamAnimation';
import LightBeamTransition from './LightBeamTransition';
import LightBeamLogo from './LightBeamLogo';

export interface ShellNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  testId?: string;
  disabled?: boolean;
}

export interface ShellProps {
  riveSrc?: string;
  /** Drives the transition sweep — usually the active view id. */
  routeKey: string | number;
  children?: ReactNode;
  /** Product name beside the mark. Defaults to the VidVerge wordmark. */
  title?: ReactNode;
  subtitle?: string;
  nav?: ShellNavItem[];
  activeNavId?: string;
  onNav?: (id: string) => void;
  /** Right-hand header controls. */
  actions?: ReactNode;
  /** Show the animated mark as working. */
  busy?: boolean;
  maxWidth?: number;
  /** Drop the header entirely and keep only the surface + transition. */
  bare?: boolean;
  className?: string;
  style?: CSSProperties;
  contentStyle?: CSSProperties;
}

export default function Shell({
  riveSrc, routeKey, children, title, subtitle, nav, activeNavId, onNav, actions,
  busy, maxWidth, bare, className, style, contentStyle,
}: ShellProps) {
  useBeamStyles();

  return (
    <div
      className={'lb-shell' + (className ? ' ' + className : '')}
      style={{
        height: '100%', minHeight: 0, overflowY: 'auto',
        background: colors.bgPrimary,
        color: colors.textPrimary,
        fontFamily: typography.fontSans,
        ...style,
      }}
    >
      <LightBeamTransition riveSrc={riveSrc} routeKey={routeKey} style={{ minHeight: '100%' }}>
        {!bare ? (
          <header
            style={{
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              padding: '14px clamp(14px, 3vw, 26px)',
              borderBottom: '1px solid ' + colors.borderSubtle,
              background: colors.bgSurface,
            }}
          >
            {title ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <LightBeamLogo state={busy ? 'active' : 'idle'} size={26} showWordmark={false} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: typography.lg, fontWeight: typography.semibold, letterSpacing: typography.tight, color: colors.textPrimary }}>{title}</div>
                  {subtitle ? (
                    <div style={{ fontFamily: typography.fontMono, fontSize: typography.xs, letterSpacing: typography.wide, color: colors.textSecondary, marginTop: 3 }}>{subtitle}</div>
                  ) : null}
                </div>
              </div>
            ) : (
              <LightBeamLogo state={busy ? 'active' : 'idle'} tagline={subtitle} />
            )}

            {nav && nav.length ? (
              <nav role='tablist' style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: radii.lg, border: '1px solid ' + colors.borderSubtle, background: colors.bgGlass, flexWrap: 'wrap' }}>
                {nav.map((item) => {
                  const on = item.id === activeNavId;
                  return (
                    <button
                      key={item.id}
                      type='button'
                      role='tab'
                      aria-selected={on}
                      disabled={item.disabled}
                      data-testid={item.testId}
                      onClick={() => onNav?.(item.id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                        padding: '7px 14px', borderRadius: radii.md,
                        border: '1px solid ' + (on ? colors.borderActive : 'transparent'),
                        background: on ? tint(colors.beamPrimary, 12) : 'transparent',
                        color: on ? colors.beamPrimary : colors.textSecondary,
                        fontFamily: typography.fontSans, fontSize: typography.sm, fontWeight: typography.medium,
                        cursor: item.disabled ? 'not-allowed' : 'pointer',
                        opacity: item.disabled ? 0.45 : 1,
                        transition: 'color 0.18s ease, background 0.18s ease, border-color 0.18s ease',
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            ) : null}

            {actions ? <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{actions}</div> : null}
          </header>
        ) : null}

        <main style={{ maxWidth, margin: maxWidth ? '0 auto' : undefined, padding: bare ? 0 : 'clamp(16px, 3vw, 28px)', ...contentStyle }}>
          {children}
        </main>
      </LightBeamTransition>
    </div>
  );
}
