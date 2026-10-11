// CALLOUT — pointing at one thing and naming it. A pulsing target, an arrow
// that draws from the label to the target, and the label box springing in at
// the arrow's tail.
import { DIRECTOR_THEME, clamp01, displayLabel, easeOut, splitIcon, springValue, window01, type VisualProps } from './visualTheme';

export default function CalloutVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const subject = splitIcon(spec.visual.elements[0] || spec.visual.label || 'This');
  const label = spec.visual.label || displayLabel(spec.visual.elements[1] || subject.label);
  const note = displayLabel(spec.visual.elements[2] || '');

  // The target sits opposite the label so the arrow has room to travel. The
  // director's direction decides which way round that is.
  const fromLeft = /right_to_left|backward|left\b/.test(String(spec.visual.direction || '').toLowerCase());
  const target = { x: fromLeft ? 1340 : 620, y: 520 };
  const box = { x: fromLeft ? 520 : 1300, y: 760 };

  const targetK = springValue(progress * Math.max(0.1, spec.durationSec), { damping: 12, stiffness: 150 });
  const armK = easeOut(window01(progress, 0.18, 0.46));
  const boxK = window01(progress, 0.38, 0.58);
  const boxPop = springValue(boxK * 0.8, { damping: 13, stiffness: 140 });
  const pulse = 1 + 0.08 * Math.sin(progress * Math.PI * 10);

  const headX = target.x + (box.x - target.x) * armK;
  const headY = target.y + (box.y - target.y) * armK;

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: DIRECTOR_THEME.font, color: DIRECTOR_THEME.text }}>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <line x1={target.x} y1={target.y} x2={headX} y2={headY} stroke={accent} strokeWidth={5} strokeLinecap="round" />
        <circle cx={target.x} cy={target.y} r={26 * clamp01(targetK) * pulse} fill="none" stroke={accent} strokeWidth={5} />
        <circle cx={target.x} cy={target.y} r={62 * clamp01(targetK) * pulse} fill="none" stroke={accent} strokeWidth={2} opacity={0.45} />
        <circle cx={target.x} cy={target.y} r={10 * clamp01(targetK)} fill={accent} />
      </svg>

      {subject.icon || subject.label ? (
        <div
          style={{
            position: 'absolute',
            left: target.x,
            top: target.y - 150,
            transform: `translate(-50%, -50%) scale(${0.7 + 0.3 * clamp01(targetK)})`,
            opacity: clamp01(targetK),
            textAlign: 'center',
          }}
        >
          {subject.icon ? <div style={{ fontSize: 110, lineHeight: 1 }}>{subject.icon}</div> : null}
          <div style={{ fontSize: 34, fontWeight: 600, color: DIRECTOR_THEME.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{displayLabel(subject.label)}</div>
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          transform: `translate(-50%, -50%) scale(${0.72 + 0.28 * clamp01(boxPop)})`,
          opacity: clamp01(boxK * 1.6),
          padding: '26px 38px',
          borderRadius: 24,
          background: 'rgba(16,16,16,0.86)',
          border: `2.5px solid ${accent}`,
          boxShadow: `0 24px 70px rgba(0,0,0,0.6), 0 0 48px ${accent}26`,
          maxWidth: 640,
          textAlign: 'center',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.15 }}>{label}</div>
        {note ? <div style={{ marginTop: 10, fontSize: 28, fontWeight: 500, color: DIRECTOR_THEME.muted, lineHeight: 1.3 }}>{note}</div> : null}
      </div>
    </div>
  );
}
