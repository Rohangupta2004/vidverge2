/**
 * Overlay type layer — emitted verbatim into the rendered composition.
 *
 * Rules implemented here:
 * - Overlay type NEVER sits on interface pixels: it occupies the margin band
 *   (above/below/beside the device stage) over a scrim.
 * - Four sizes only: eyebrow, headline, body, caption.
 * - headline <= 42 chars and caption <= 90 chars (also enforced by schema).
 * - theme.source 'derived': accent + ink come from the analysed palette.
 * - The optional icon (20-icon set) draws on over 14 frames with a 6-frame
 *   settle at 1.03 scale, enters one stagger step before the label, and is
 *   coloured accent or ink at 60%.
 *
 * The emitted code avoids template literals so this file can hold it inside
 * one. It references ICON_PATHS, smoothstep and clamp01 from the assembled
 * composition scope.
 */
export const OVERLAY_TSX = `
const OVERLAY_SIZES = {
  eyebrow:  { size: 26, weight: 800, spacing: 4.5, transform: 'uppercase' },
  headline: { size: 64, weight: 830, spacing: -1.6, transform: 'none' },
  body:     { size: 34, weight: 560, spacing: -0.3, transform: 'none' },
  caption:  { size: 24, weight: 600, spacing: 0.2, transform: 'none' },
};

const DrawIcon = ({ name, t, color, box }) => {
  const path = ICON_PATHS[name];
  if (!path || t <= 0) return null;
  // draw-on: dashoffset full -> zero over 14 frames, 6-frame settle at 1.03
  const drawT = clamp01(t * (ICON_DRAW_FRAMES + ICON_SETTLE_FRAMES) / ICON_DRAW_FRAMES);
  const settleT = clamp01((t * (ICON_DRAW_FRAMES + ICON_SETTLE_FRAMES) - ICON_DRAW_FRAMES) / ICON_SETTLE_FRAMES);
  const scale = 1 + (ICON_SETTLE_SCALE - 1) * Math.sin(settleT * Math.PI);
  const dash = 100;
  const fillFade = clamp01((drawT - 0.6) / 0.4);
  return (
    <svg
      width={box} height={box} viewBox={'0 0 24 24'} fill={'none'}
      style={{ flex: '0 0 auto', transform: 'scale(' + scale + ')', opacity: Math.min(1, t * 2.5) }}
    >
      <path
        d={path} stroke={color} strokeWidth={ICON_STROKE}
        strokeLinecap={'round'} strokeLinejoin={'round'}
        pathLength={dash}
        strokeDasharray={dash}
        strokeDashoffset={dash * (1 - smoothstep(drawT))}
        opacity={0.4 + 0.6 * fillFade}
      />
    </svg>
  );
};

const Overlay = ({ spec, theme, preset, frame, sceneDuration, width, height }) => {
  if (!spec || !spec.text) return null;
  const at = typeof spec.at === 'number' ? spec.at : 10;
  const local = frame - at;
  if (local < -1) return null;
  const style = OVERLAY_SIZES[spec.size] || OVERLAY_SIZES.caption;
  const iconLead = preset.stagger; // icon enters one stagger step before label
  const iconT = clamp01((local) / (ICON_DRAW_FRAMES + ICON_SETTLE_FRAMES));
  const textT = smoothstep(clamp01((local - iconLead) / 16));
  const outT = smoothstep(clamp01((frame - (sceneDuration - 16)) / 10));
  const alive = 1 - outT;
  const side = spec.side || 'bottom';
  const horizontal = side === 'top' || side === 'bottom';
  const pad = Math.round(height * 0.055);
  const anchor = {};
  if (side === 'top') { anchor.top = 0; anchor.left = 0; anchor.right = 0; }
  if (side === 'bottom') { anchor.bottom = 0; anchor.left = 0; anchor.right = 0; }
  if (side === 'left') { anchor.left = 0; anchor.top = 0; anchor.bottom = 0; }
  if (side === 'right') { anchor.right = 0; anchor.top = 0; anchor.bottom = 0; }
  const iconColor = spec.size === 'eyebrow' ? theme.accent : withAlpha(theme.ink, 0.6);
  return (
    <div style={Object.assign({
      position: 'absolute', display: 'flex', alignItems: 'center',
      justifyContent: horizontal ? 'flex-start' : 'center',
      flexDirection: horizontal ? 'row' : 'column',
      gap: 18,
      padding: pad,
      width: horizontal ? undefined : Math.round(width * 0.24),
      background: scrimFor(side),
      pointerEvents: 'none',
      opacity: alive,
    }, anchor)}>
      {spec.icon ? <DrawIcon name={spec.icon} t={iconT * alive} color={iconColor} box={Math.round(style.size * 0.9)} /> : null}
      <div style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: style.size,
        fontWeight: style.weight,
        letterSpacing: style.spacing,
        textTransform: style.transform,
        color: spec.size === 'eyebrow' ? theme.accent : '#FFFFFF',
        maxWidth: Math.round(width * 0.62),
        lineHeight: 1.08,
        opacity: textT * alive,
        transform: 'translateY(' + ((1 - textT) * 14) + 'px)',
        textShadow: '0 4px 26px rgba(0,0,0,0.45)',
        fontVariantNumeric: 'tabular-nums',
      }}>{spec.text}</div>
    </div>
  );
};
`;
