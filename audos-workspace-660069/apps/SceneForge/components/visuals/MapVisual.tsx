// MAP — a place matters. No geographic data ships with this app and inventing
// a coastline would be a lie, so the map is an honest abstraction: a latitude
// grid, a pin dropping on it, and the place named large.
import { DIRECTOR_THEME, clamp01, displayLabel, easeOut, springValue, window01, type VisualProps } from './visualTheme';

const CX = 960;
const CY = 540;
const R = 300;

export default function MapVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const place = displayLabel(spec.visual.elements[0] || spec.visual.label || 'Location');
  const detail = displayLabel(spec.visual.elements[1] || '');
  const globeK = easeOut(window01(progress, 0, 0.3));
  const dropK = springValue(Math.max(0, progress - 0.25) * Math.max(0.1, spec.durationSec), { damping: 11, stiffness: 160 });
  const ripple = window01(progress, 0.38, 1);
  const labelK = window01(progress, 0.42, 0.6);

  const pin = { x: CX + 96, y: CY - 62 };

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: DIRECTOR_THEME.font, color: DIRECTOR_THEME.text }}>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <circle cx={CX} cy={CY} r={R} fill={`${accent}0d`} stroke={DIRECTOR_THEME.line} strokeWidth={2} opacity={globeK} />
        {[-0.66, -0.33, 0, 0.33, 0.66].map((t, index) => (
          <ellipse key={`lat-${index}`} cx={CX} cy={CY + R * t} rx={R * Math.sqrt(Math.max(0.02, 1 - t * t))} ry={26} fill="none" stroke={DIRECTOR_THEME.line} strokeWidth={1.5} opacity={globeK * 0.7} />
        ))}
        {[0.3, 0.62, 1].map((t, index) => (
          <ellipse key={`lon-${index}`} cx={CX} cy={CY} rx={R * t} ry={R} fill="none" stroke={DIRECTOR_THEME.line} strokeWidth={1.5} opacity={globeK * 0.6} />
        ))}

        {/* Ripples out of the pin — the "here" gesture. */}
        {[0, 0.33, 0.66].map((offset, index) => {
          const t = (ripple + offset) % 1;
          return <circle key={`ripple-${index}`} cx={pin.x} cy={pin.y} r={20 + 120 * t} fill="none" stroke={accent} strokeWidth={3} opacity={(1 - t) * 0.6 * clamp01(dropK)} />;
        })}
      </svg>

      <div
        style={{
          position: 'absolute',
          left: pin.x,
          top: pin.y,
          transform: `translate(-50%, -100%) translateY(${(1 - clamp01(dropK)) * -140}px) scale(${0.6 + 0.4 * clamp01(dropK)})`,
          opacity: clamp01(dropK * 1.6),
          fontSize: 86,
          lineHeight: 1,
          filter: `drop-shadow(0 12px 26px ${accent}55)`,
        }}
      >
        📍
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 190, textAlign: 'center', opacity: labelK, transform: `translateY(${(1 - easeOut(labelK)) * 26}px)` }}>
        <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: '-0.02em', color: DIRECTOR_THEME.text }}>{place}</div>
        {detail ? <div style={{ marginTop: 10, fontSize: 32, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: accent }}>{detail}</div> : null}
      </div>
    </div>
  );
}
