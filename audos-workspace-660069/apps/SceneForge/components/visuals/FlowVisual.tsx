// FLOW — A to B to C. Nodes appear in order, the connecting line draws
// between them, and particles travel the path so the viewer sees the thing
// MOVE: oxygen through blood, water through a cycle, cash through a chain.
import { DIRECTOR_THEME, clamp01, displayLabel, easeInOut, easeOut, splitIcon, springValue, window01, type VisualProps } from './visualTheme';

const PARTICLES = 5;

export default function FlowVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const vertical = /top_to_bottom|vertical|down/i.test(String(spec.visual.direction || ''));
  const nodes = (spec.visual.elements.length >= 2 ? spec.visual.elements : [spec.visual.elements[0] || 'Start', spec.visual.label || 'End'])
    .slice(0, 5)
    .map(splitIcon);
  const count = nodes.length;

  const centreOf = (index: number) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return vertical
      ? { x: 960, y: 260 + (640) * t }
      : { x: 300 + 1320 * t, y: 560 };
  };

  const nodeR = vertical ? 86 : Math.min(130, 520 / count);
  // The particle travels the WHOLE chain, looping twice across the segment,
  // so a four-second scene still shows the flow repeat.
  const travel = (progress * 2) % 1;

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: DIRECTOR_THEME.font, color: DIRECTOR_THEME.text }}>
      {spec.visual.label && count > 1 ? (
        <div style={{ position: 'absolute', top: 96, left: 0, right: 0, textAlign: 'center', fontSize: 50, fontWeight: 700, letterSpacing: '-0.02em', opacity: window01(progress, 0, 0.14) }}>
          {spec.visual.label}
        </div>
      ) : null}

      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {nodes.slice(0, -1).map((_, index) => {
          const from = centreOf(index);
          const to = centreOf(index + 1);
          const segStart = 0.12 + (0.5 / Math.max(1, count - 1)) * index;
          const k = easeInOut(window01(progress, segStart, segStart + 0.18));
          const x2 = from.x + (to.x - from.x) * k;
          const y2 = from.y + (to.y - from.y) * k;
          return (
            <g key={`edge-${index}`}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={DIRECTOR_THEME.line} strokeWidth={3} strokeDasharray="10 14" />
              <line x1={from.x} y1={from.y} x2={x2} y2={y2} stroke={accent} strokeWidth={6} strokeLinecap="round" opacity={0.85} />
            </g>
          );
        })}

        {/* Particles: evenly spaced along the whole chain, each one a small
            glowing dot that carries whatever the director named. */}
        {count > 1 && progress > 0.2
          ? Array.from({ length: PARTICLES }).map((_, p) => {
            const t = (travel + p / PARTICLES) % 1;
            const segment = Math.min(count - 2, Math.floor(t * (count - 1)));
            const local = t * (count - 1) - segment;
            const from = centreOf(segment);
            const to = centreOf(segment + 1);
            const x = from.x + (to.x - from.x) * local;
            const y = from.y + (to.y - from.y) * local;
            const fade = Math.sin(Math.PI * t);
            return <circle key={`p-${p}`} cx={x} cy={y} r={13} fill={accent} opacity={0.25 + 0.75 * fade} />;
          })
          : null}
      </svg>

      {nodes.map((node, index) => {
        const appearAt = 0.04 + (0.5 / Math.max(1, count)) * index;
        const k = window01(progress, appearAt, appearAt + 0.16);
        if (k <= 0) return null;
        const pop = springValue(k * 0.8, { damping: 13, stiffness: 130 });
        const centre = centreOf(index);
        return (
          <div key={`node-${index}`} style={{ position: 'absolute', left: centre.x, top: centre.y, transform: `translate(-50%, -50%) scale(${0.5 + 0.5 * pop})`, opacity: clamp01(k * 1.4) }}>
            <div
              style={{
                width: nodeR * 2,
                height: nodeR * 2,
                borderRadius: '50%',
                background: `radial-gradient(circle at 35% 30%, ${accent}2e, rgba(255,255,255,0.03))`,
                border: `3px solid ${accent}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: nodeR * 0.72,
                boxShadow: `0 0 ${34 * pop}px ${accent}33`,
              }}
            >
              {node.icon || displayLabel(node.label).slice(0, 1).toUpperCase()}
            </div>
            <div style={{ position: 'absolute', top: nodeR * 2 + 20, left: '50%', transform: 'translateX(-50%)', width: 320, marginLeft: -160, textAlign: 'center', fontSize: 32, fontWeight: 700, letterSpacing: '0.02em', lineHeight: 1.2 }}>
              {displayLabel(node.label)}
            </div>
          </div>
        );
      })}

      {spec.visual.animation ? (
        <div style={{ position: 'absolute', bottom: 190, left: 0, right: 0, textAlign: 'center', fontSize: 28, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: accent, opacity: easeOut(window01(progress, 0.45, 0.6)) }}>
          {displayLabel(spec.visual.animation.replace(/_/g, ' '))}
        </div>
      ) : null}
    </div>
  );
}
