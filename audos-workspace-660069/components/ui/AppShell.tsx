import React from 'react';
import { COLORS, CONTENT_MAX_WIDTH, FONT, GRADIENT } from '../theme';
import BeamBackground from '../BeamBackground';
import GridOverlay from '../GridOverlay';
import GlobalStyles from './GlobalStyles';
import SectionHeader from './SectionHeader';

/**
 * The frame every Vidverge app sits in.
 *
 *   beams + dot grid behind  ->  SectionHeader  ->  centered content column
 *   ->  faint brand watermark
 *
 * Layout notes
 *   - `maxWidth="full"` turns off the centered column for the dense studio
 *     apps (editor timelines, inspectors) whose panels need the whole width.
 *   - `scroll={false}` hands height management back to the app, for apps that
 *     run their own internal scroll panes.
 */

export interface AppShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  eyebrow?: string;
  /** Right-aligned header controls. */
  actions?: React.ReactNode;
  /** Content column width. 'full' removes the column entirely. */
  maxWidth?: number | 'full';
  /** Beam origin. MotionLaunch uses 'center'. */
  beamVariant?: 'center' | 'bottom';
  /** Peak beam opacity. 0.12 everywhere except MotionLaunch (0.28). */
  beamIntensity?: number;
  /** Hide the dot grid. */
  grid?: boolean;
  /** Hide the bottom watermark (for apps that pin their own footer bar). */
  watermark?: boolean;
  /** Let the shell own vertical scrolling. */
  scroll?: boolean;
  /** Drop the header entirely (app renders its own). */
  header?: boolean;
  /** Outer padding in px. */
  padding?: number;
  className?: string;
  style?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
  children?: React.ReactNode;
}

const AppShell: React.FC<AppShellProps> = function AppShell({
  title,
  subtitle,
  icon,
  eyebrow,
  actions,
  maxWidth = CONTENT_MAX_WIDTH,
  beamVariant = 'bottom',
  beamIntensity = 0,
  grid = false,
  watermark = true,
  scroll = true,
  header = true,
  padding,
  className,
  style,
  contentStyle,
  children,
}) {
  const [narrow, setNarrow] = React.useState(false);

  React.useEffect(function trackWidth() {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia('(max-width: 767px)');
    function sync() {
      setNarrow(query.matches);
    }
    sync();
    if (query.addEventListener) {
      query.addEventListener('change', sync);
      return function cleanup() {
        query.removeEventListener('change', sync);
      };
    }
    query.addListener(sync);
    return function cleanup() {
      query.removeListener(sync);
    };
  }, []);

  const pad = padding == null ? (narrow ? 16 : (typeof window !== 'undefined' && window.innerWidth < 1200 ? 24 : 32)) : padding;

  return (
    <div
      className={'vv-app-shell' + (className ? ' ' + className : '')}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '100%',
        background: `${GRADIENT.ambient}, ${COLORS.bg}`,
        color: COLORS.text,
        fontFamily: FONT.body,
        overflowX: 'hidden',
        overflowY: scroll ? 'auto' : 'hidden',
        display: 'flex',
        flexDirection: 'column',
        isolation: 'isolate',
        ...style,
      }}
    >
      <GlobalStyles />

      {/* Absolutely positioned, never fixed: a fixed layer is laid out against
          the viewport, so it would spill out of the app window and across the
          dock and agent panel beside it. */}
      {beamIntensity > 0 ? (
        <BeamBackground variant={beamVariant} intensity={beamIntensity} count={beamVariant === 'center' ? 13 : 11} />
      ) : null}
      {grid ? <GridOverlay /> : null}

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          width: '100%',
          maxWidth: maxWidth === 'full' ? '100%' : maxWidth,
          margin: maxWidth === 'full' ? 0 : '0 auto',
          padding: pad + 'px ' + pad + 'px ' + (watermark ? pad + 26 : pad) + 'px',
          ...contentStyle,
        }}
      >
        {header ? (
          <SectionHeader
            title={title}
            subtitle={subtitle}
            icon={icon}
            eyebrow={eyebrow}
            actions={actions}
          />
        ) : null}

        <div style={{ flex: '1 1 auto', minHeight: 0 }}>
          {children}
        </div>
      </div>

      {watermark ? (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 10,
            left: 0,
            right: 0,
            zIndex: 1,
            textAlign: 'center',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 3.2,
            textTransform: 'uppercase',
            color: COLORS.textFaint,
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        >
          Vidverge
        </div>
      ) : null}
    </div>
  );
};

export default AppShell;
