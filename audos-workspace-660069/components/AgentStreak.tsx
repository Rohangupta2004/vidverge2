/**
 * AgentStreak — VidVerge's gold light-streak brand mark as the agent's visual
 * "thinking" signal, shared by every studio surface.
 *
 * Steady slow pulse while idle, faster + brighter while the agent is actively
 * working, so users can tell WORKING from WAITING at a glance. The asset is
 * the founder's gold streak on black; mix-blend screen melts the black into
 * any dark surface. Pure CSS keyframes — no animation libraries.
 */

export const STREAK_URL = 'https://storage.googleapis.com/audos-images/attachments/general/f584e75c-7262-40d0-b190-9fd05d8a3e4a.png';

const STREAK_CSS = `
@keyframes vv-streak-idle { 0%, 100% { opacity: 0.5; transform: scaleX(0.97); filter: brightness(0.95); } 50% { opacity: 0.85; transform: scaleX(1); filter: brightness(1.05); } }
@keyframes vv-streak-work { 0%, 100% { opacity: 0.75; transform: scaleX(0.94); filter: brightness(1); } 50% { opacity: 1; transform: scaleX(1.06); filter: brightness(1.45); } }
@media (prefers-reduced-motion: reduce) { .vv-streak { animation: none !important; } }
`;

export default function AgentStreak({ working = false, size = 32 }: { working?: boolean; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', overflow: 'hidden', flexShrink: 0 }} aria-hidden="true">
      <style>{STREAK_CSS}</style>
      <img
        className="vv-streak"
        src={STREAK_URL}
        alt=""
        style={{
          height: size,
          width: size * 2.4,
          objectFit: 'cover',
          objectPosition: 'left center',
          mixBlendMode: 'screen',
          pointerEvents: 'none',
          transformOrigin: 'left center',
          animation: working ? 'vv-streak-work 0.85s ease-in-out infinite' : 'vv-streak-idle 2.6s ease-in-out infinite',
        }}
      />
    </span>
  );
}
