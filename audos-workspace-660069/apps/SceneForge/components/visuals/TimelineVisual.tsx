// TIMELINE — dated events drawn left to right. The line is the argument: it
// draws first, markers land on it as it passes them, and each date arrives
// over its own marker.
import { DIRECTOR_THEME, clamp01, easeInOut, easeOut, parseEvent, springValue, window01, type VisualProps } from './visualTheme';

const LEFT = 220;
const RIGHT = 1700;
const AXIS_Y = 620;

export default function TimelineVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  // Same rule the render uses (sceneForgeComposition's visual.reversed).
  const reversed = /right_to_left|backward|left\b/.test(String(spec.visual.direction || '').toLowerCase());
  const events = (spec.visual.elements.length ? spec.visual.elements : [spec.visual.label || spec.caption || 'Event'])
    .slice(0, 6)
    .map(parseEvent);
  const span = RIGHT - LEFT;
  const count = events.length;
  const xOf = (index: number) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return LEFT + span * (reversed ? 1 - t : t);
  };

  // The line draws across the first 45% of the segment; a marker becomes
  // visible the moment the line reaches its position, never before.
  const drawK = easeInOut(window01(progress, 0.03, 0.48));
  const lineWidth = span * drawK;
  const lineX = reversed ? RIGHT - lineWidth : LEFT;

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: DIRECTOR_THEME.font, color: DIRECTOR_THEME.text }}>
      {spec.visual.label ? (
        <div style={{ position: 'absolute', top: 120, left: 0, right: 0, textAlign: 'center', fontSize: 52, fontWeight: 700, letterSpacing: '-0.02em', opacity: window01(progress, 0, 0.14) }}>
          {spec.visual.label}
        </div>
      ) : null}

      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <line x1={LEFT} y1={AXIS_Y} x2={RIGHT} y2={AXIS_Y} stroke={DIRECTOR_THEME.line} strokeWidth={3} />
        <line x1={lineX} y1={AXIS_Y} x2={lineX + lineWidth} y2={AXIS_Y} stroke={accent} strokeWidth={7} strokeLinecap="round" />
        {/* The travelling head of the line, so the draw reads as motion. */}
        {drawK > 0 && drawK < 1 ? (
          <circle cx={reversed ? lineX : lineX + lineWidth} cy={AXIS_Y} r={13} fill={accent} opacity={0.9} />
        ) : null}
      </svg>

      {events.map((event, index) => {
        const reachedAt = 0.03 + 0.45 * (count === 1 ? 0.5 : index / (count - 1));
        const k = window01(progress, reachedAt, reachedAt + 0.16);
        if (k <= 0) return null;
        const pop = springValue(k * 0.85, { damping: 12, stiffness: 140 });
        const x = xOf(index);
        const above = index % 2 === 0;
        return (
          <div key={`${event.date}-${event.label}-${index}`} style={{ position: 'absolute', left: x, top: AXIS_Y, transform: 'translate(-50%, -50%)' }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: accent,
                boxShadow: `0 0 0 ${8 * pop}px ${accent}22`,
                transform: `scale(${0.4 + 0.6 * pop})`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                ...(above ? { bottom: 44 } : { top: 44 }),
                width: 340,
                marginLeft: -170,
                textAlign: 'center',
                opacity: clamp01(pop),
              }}
            >
              {above ? null : <div style={{ width: 2, height: 26, background: DIRECTOR_THEME.line, margin: '0 auto 10px' }} />}
              {event.icon ? <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 6, transform: `scale(${0.6 + 0.4 * pop})` }}>{event.icon}</div> : null}
              {event.date ? (
                <div style={{ fontSize: 60, fontWeight: 800, color: accent, letterSpacing: '-0.02em', transform: `translateY(${(1 - easeOut(k)) * 16}px)` }}>{event.date}</div>
              ) : null}
              {event.label ? (
                <div style={{ marginTop: 6, fontSize: 30, fontWeight: 600, color: DIRECTOR_THEME.text, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.25 }}>{event.label}</div>
              ) : null}
              {above ? <div style={{ width: 2, height: 26, background: DIRECTOR_THEME.line, margin: '10px auto 0' }} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
