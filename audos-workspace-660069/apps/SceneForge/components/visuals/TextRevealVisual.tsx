// TEXT REVEAL — the number or phrase IS the point. "365 DAYS". "1947".
// "₹14,641". Everything else on screen defers to it.
import { DIRECTOR_THEME, clamp01, displayLabel, easeOut, fitHeadline, formatNumber, parseNumericLabel, springValue, window01, type VisualProps } from './visualTheme';

export default function TextRevealVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const seconds = progress * Math.max(0.1, spec.durationSec);
  const label = String(spec.visual.label || spec.visual.elements[0] || spec.caption || spec.narration || '').trim();
  const numeric = parseNumericLabel(label);

  // Entrance: one spring carrying scale and lift together, so the headline
  // arrives with weight instead of fading in.
  const enter = springValue(seconds, { damping: 13, stiffness: 110 });
  const scale = 0.68 + 0.32 * enter;
  const lift = (1 - enter) * 46;
  const opacity = clamp01(seconds / 0.26);

  // The number counts UP over the first half of the segment — the viewer
  // watches the quantity accumulate rather than being handed it.
  const countK = easeOut(window01(progress, 0.04, 0.55));
  const shown = numeric
    ? `${numeric.prefix}${formatNumber(numeric.value * countK, numeric.decimals, numeric.grouped)}${numeric.suffix}`
    : label;
  const size = fitHeadline(shown, 190, 56);

  // With no number in the headline the LAST word takes the accent instead,
  // so every text_reveal still has one thing the eye lands on.
  const words = numeric ? [] : shown.split(/\s+/).filter(Boolean);
  const head = numeric ? '' : words.slice(0, -1).join(' ');
  const tail = numeric ? '' : words[words.length - 1] || '';

  const sub = displayLabel(spec.visual.elements[1] || (spec.visual.label ? spec.caption || '' : ''));
  const subK = window01(progress, 0.28, 0.5);
  const arrowK = window01(progress, 0.42, 0.68);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: DIRECTOR_THEME.font }}>
      <div
        style={{
          transform: `scale(${scale}) translateY(${lift}px)`,
          opacity,
          fontSize: size,
          fontWeight: 800,
          letterSpacing: '-0.025em',
          lineHeight: 1.02,
          color: DIRECTOR_THEME.text,
          textAlign: 'center',
          maxWidth: 1560,
          textShadow: `0 24px 80px ${accent}33`,
        }}
      >
        {numeric ? (
          <span style={{ color: accent }}>{shown}</span>
        ) : (
          <>
            {head ? `${head} ` : ''}
            <span style={{ color: accent }}>{tail}</span>
          </>
        )}
      </div>

      {/* The arrow is a beat of its own: it lands after the headline has
          settled and points the eye back at it. */}
      <svg width={220} height={120} viewBox="0 0 220 120" style={{ marginTop: 18, opacity: arrowK, overflow: 'visible' }}>
        <path
          d="M110 112 L110 26"
          stroke={accent}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={90}
          strokeDashoffset={90 * (1 - easeOut(arrowK))}
        />
        <path
          d="M88 48 L110 24 L132 48"
          fill="none"
          stroke={accent}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={window01(progress, 0.58, 0.72)}
        />
      </svg>

      {sub ? (
        <div
          style={{
            marginTop: 6,
            opacity: subK,
            transform: `translateY(${(1 - easeOut(subK)) * 24}px)`,
            fontSize: 44,
            fontWeight: 500,
            color: DIRECTOR_THEME.muted,
            maxWidth: 1200,
            textAlign: 'center',
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}
