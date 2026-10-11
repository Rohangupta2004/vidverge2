/**
 * GradientOrb — the animated Vidverge agent brand icon.
 * A slowly rotating amber→pink→gold conic gradient sphere with a gentle
 * breathe/pulse. `thinking` adds a fast spinning dashed ring around the orb;
 * `idle` slows the breathe right down.
 */

export interface GradientOrbProps {
  size?: 'sm' | 'md' | 'lg';
  thinking?: boolean;
  idle?: boolean;
  onClick?: () => void;
}

const SIZES: Record<'sm' | 'md' | 'lg', number> = { sm: 32, md: 48, lg: 64 };

const ORB_CSS = `
@keyframes vvOrbSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes vvOrbPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
@keyframes vvOrbRing { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.vv-orb-pulse { animation: vvOrbPulse 3s ease-in-out infinite; }
.vv-orb-pulse-idle { animation: vvOrbPulse 5.5s ease-in-out infinite; }
.vv-orb-core { border-radius: 50%; animation: vvOrbSpin 7s linear infinite; background: conic-gradient(from 20deg, #D97706, #EC4899, #F59E0B, #EC4899, #D97706); }
.vv-orb-ring { position: absolute; inset: -17%; animation: vvOrbRing 1.4s linear infinite; }
`;

export function GradientOrb({ size = 'md', thinking = false, idle = false, onClick }: GradientOrbProps) {
  const px = SIZES[size];
  return (
    <span
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? 'Vidverge Agent' : undefined}
      className={idle && !thinking ? 'vv-orb-pulse-idle' : 'vv-orb-pulse'}
      style={{ position: 'relative', display: 'inline-flex', width: px, height: px, flexShrink: 0, cursor: onClick ? 'pointer' : undefined }}
    >
      <style>{ORB_CSS}</style>
      <span
        aria-hidden
        className="vv-orb-core"
        style={{
          width: px,
          height: px,
          boxShadow: `0 0 ${Math.round(px * 0.45)}px rgba(236, 72, 153, 0.45), inset 0 0 ${Math.round(px * 0.3)}px rgba(255, 255, 255, 0.22)`,
        }}
      />
      {thinking ? (
        <svg aria-hidden className="vv-orb-ring" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" stroke="url(#vvOrbRingGrad)" strokeWidth="2.4" strokeDasharray="9 7" strokeLinecap="round" />
          <defs>
            <linearGradient id="vvOrbRingGrad" x1="0" y1="0" x2="48" y2="48">
              <stop offset="0" stopColor="#D97706" />
              <stop offset="0.5" stopColor="#EC4899" />
              <stop offset="1" stopColor="#F59E0B" />
            </linearGradient>
          </defs>
        </svg>
      ) : null}
    </span>
  );
}

export default GradientOrb;
