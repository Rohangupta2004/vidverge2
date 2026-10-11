// DIAGRAM — a thing and its parts. The subject sits at the centre, the parts
// radiate around it, and a highlight ring walks from part to part in the
// order the narrator names them.
import { DIRECTOR_THEME, clamp01, displayLabel, easeOut, splitIcon, springValue, window01, type VisualProps } from './visualTheme';

const CX = 960;
const CY = 560;
const CORE_R = 165;
const ORBIT_R = 330;

export default function DiagramVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const all = spec.visual.elements.length ? spec.visual.elements : [spec.visual.label || spec.caption || 'Subject'];
  const core = splitIcon(all[0]);
  const parts = all.slice(1, 7).map(splitIcon);
  const count = parts.length;

  const coreK = springValue(progress * Math.max(0.1, spec.durationSec), { damping: 14, stiffness: 120 });

  // Parts sit on a circle starting at the top and going clockwise, which
  // keeps labels off each other at every count from one to six.
  const angleOf = (index: number) => (-Math.PI / 2) + (2 * Math.PI * index) / Math.max(1, count);
  const posOf = (index: number) => {
    const a = angleOf(index);
    return { x: CX + Math.cos(a) * ORBIT_R, y: CY + Math.sin(a) * ORBIT_R * 0.86 };
  };

  // Which part is "being narrated" right now: the segment is divided evenly
  // across the parts after the core has landed.
  const focusWindow = window01(progress, 0.22, 0.98);
  const focusIndex = count ? Math.min(count - 1, Math.floor(focusWindow * count)) : -1;

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: DIRECTOR_THEME.font, color: DIRECTOR_THEME.text }}>
      {spec.visual.label && count ? (
        <div style={{ position: 'absolute', top: 86, left: 0, right: 0, textAlign: 'center', fontSize: 48, fontWeight: 700, letterSpacing: '-0.02em', opacity: window01(progress, 0, 0.14) }}>
          {spec.visual.label}
        </div>
      ) : null}

      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {parts.map((_, index) => {
          const to = posOf(index);
          const appearAt = 0.16 + (0.45 / Math.max(1, count)) * index;
          const k = easeOut(window01(progress, appearAt, appearAt + 0.14));
          const a = angleOf(index);
          const x1 = CX + Math.cos(a) * CORE_R;
          const y1 = CY + Math.sin(a) * CORE_R * 0.86;
          return (
            <line
              key={`spoke-${index}`}
              x1={x1}
              y1={y1}
              x2={x1 + (to.x - x1) * k}
              y2={y1 + (to.y - y1) * k}
              stroke={index === focusIndex ? accent : DIRECTOR_THEME.line}
              strokeWidth={index === focusIndex ? 5 : 3}
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      <div
        style={{
          position: 'absolute',
          left: CX,
          top: CY,
          transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * clamp01(coreK)})`,
          width: CORE_R * 2,
          height: CORE_R * 2 * 0.9,
          borderRadius: '46% 54% 50% 50% / 50%',
          background: `radial-gradient(circle at 38% 32%, ${accent}3a, rgba(255,255,255,0.04))`,
          border: `4px solid ${accent}`,
          boxShadow: `0 0 70px ${accent}2e`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: 20,
        }}
      >
        {core.icon ? <div style={{ fontSize: 86, lineHeight: 1 }}>{core.icon}</div> : null}
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.1 }}>{displayLabel(core.label)}</div>
      </div>

      {parts.map((part, index) => {
        const appearAt = 0.16 + (0.45 / Math.max(1, count)) * index;
        const k = window01(progress, appearAt + 0.08, appearAt + 0.22);
        if (k <= 0) return null;
        const pos = posOf(index);
        const focused = index === focusIndex;
        const pulse = focused ? 1 + 0.05 * Math.sin(progress * Math.PI * 12) : 1;
        return (
          <div
            key={`part-${index}`}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, -50%) scale(${(0.8 + 0.2 * easeOut(k)) * pulse})`,
              opacity: clamp01(k) * (focused ? 1 : 0.78),
              padding: '16px 26px',
              borderRadius: 20,
              background: focused ? `${accent}26` : 'rgba(255,255,255,0.05)',
              border: `2px solid ${focused ? accent : DIRECTOR_THEME.line}`,
              maxWidth: 360,
              textAlign: 'center',
              backdropFilter: 'blur(6px)',
            }}
          >
            {part.icon ? <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 4 }}>{part.icon}</div> : null}
            <div style={{ fontSize: 32, fontWeight: 700, color: focused ? DIRECTOR_THEME.text : DIRECTOR_THEME.muted, lineHeight: 1.2 }}>{displayLabel(part.label)}</div>
          </div>
        );
      })}
    </div>
  );
}
