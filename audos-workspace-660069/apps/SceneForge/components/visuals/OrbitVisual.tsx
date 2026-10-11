// ORBIT — one body circling another. The path draws, the body travels it,
// and the duration label lands once a full circuit has been shown.
import { DIRECTOR_THEME, clamp01, displayLabel, easeInOut, easeOut, splitIcon, springValue, window01, type VisualProps } from './visualTheme';

const CX = 960;
const CY = 545;
const RX = 520;
const RY = 250;

export default function OrbitVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const counter = /counter|anti|ccw|right_to_left/i.test(String(spec.visual.direction || ''));
  const centre = splitIcon(spec.visual.elements[0] || 'Sun');
  const orbiter = splitIcon(spec.visual.elements[1] || 'Earth');

  // One full circuit per segment, starting once the path has drawn. A single
  // clean lap reads as "a year"; two laps read as decoration.
  const pathK = easeInOut(window01(progress, 0.04, 0.42));
  const travelK = window01(progress, 0.18, 1);
  const angle = (counter ? -1 : 1) * travelK * Math.PI * 2 - Math.PI / 2;
  const ox = CX + Math.cos(angle) * RX;
  const oy = CY + Math.sin(angle) * RY;
  // Behind the centre body for the top half of the ellipse — the cheapest
  // honest depth cue there is.
  const behind = Math.sin(angle) < 0;

  const ellipseLength = Math.PI * (3 * (RX + RY) - Math.sqrt((3 * RX + RY) * (RX + 3 * RY)));
  const coreK = springValue(progress * Math.max(0.1, spec.durationSec), { damping: 14, stiffness: 120 });
  const labelK = window01(progress, 0.55, 0.72);

  const Body = ({ node, size, glow }: { node: { icon: string; label: string }; size: number; glow: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `radial-gradient(circle at 34% 30%, ${glow}, rgba(255,255,255,0.05))`,
          border: `3px solid ${glow}`,
          boxShadow: `0 0 ${size * 0.5}px ${glow}55`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.52,
        }}
      >
        {node.icon}
      </div>
      <div style={{ marginTop: 14, fontSize: 30, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{displayLabel(node.label)}</div>
    </div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: DIRECTOR_THEME.font, color: DIRECTOR_THEME.text }}>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke={DIRECTOR_THEME.line} strokeWidth={2} strokeDasharray="6 14" opacity={0.5} />
        <ellipse
          cx={CX}
          cy={CY}
          rx={RX}
          ry={RY}
          fill="none"
          stroke={accent}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={ellipseLength}
          strokeDashoffset={ellipseLength * (1 - pathK)}
          transform={counter ? `scale(-1,1) translate(${-2 * CX},0)` : undefined}
          opacity={0.9}
        />
        {/* Direction arrow, parked on the near side of the path. */}
        <g opacity={easeOut(window01(progress, 0.4, 0.55))} transform={`translate(${CX + (counter ? -RX : RX) * 0.52}, ${CY + RY - 6})`}>
          <path d={counter ? 'M22 -18 L-4 0 L22 18' : 'M-22 -18 L4 0 L-22 18'} fill="none" stroke={accent} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>

      {behind ? <div style={{ position: 'absolute', left: ox, top: oy, transform: 'translate(-50%,-50%)', opacity: 0.55 }}><Body node={orbiter} size={118} glow={accent} /></div> : null}

      <div style={{ position: 'absolute', left: CX, top: CY, transform: `translate(-50%,-50%) scale(${0.6 + 0.4 * clamp01(coreK)})` }}>
        <Body node={{ icon: centre.icon || '☀️', label: centre.label }} size={210} glow="#FFB74D" />
      </div>

      {!behind ? <div style={{ position: 'absolute', left: ox, top: oy, transform: 'translate(-50%,-50%)' }}><Body node={{ icon: orbiter.icon || '🌍', label: orbiter.label }} size={118} glow={accent} /></div> : null}

      {spec.visual.label ? (
        <div
          style={{
            position: 'absolute',
            bottom: 168,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 76,
            fontWeight: 800,
            letterSpacing: '0.04em',
            color: accent,
            opacity: labelK,
            transform: `scale(${0.86 + 0.14 * easeOut(labelK)})`,
            textShadow: `0 18px 60px ${accent}33`,
          }}
        >
          {spec.visual.label}
        </div>
      ) : null}
    </div>
  );
}
