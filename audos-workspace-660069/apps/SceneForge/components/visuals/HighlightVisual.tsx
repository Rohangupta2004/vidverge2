// HIGHLIGHT — the spoken words carry the weight and ONE of them should flare.
// The line sets, then an accent bar wipes in behind the key word and the word
// itself lifts onto it.
import { DIRECTOR_THEME, clamp01, easeInOut, easeOut, fitHeadline, splitHighlight, window01, type VisualProps } from './visualTheme';

export default function HighlightVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const text = spec.caption || spec.narration || '';
  const { before, word, after } = splitHighlight(text, spec.visual.label || spec.visual.elements[0]);
  const size = fitHeadline(text, 104, 42);

  const lineK = easeOut(window01(progress, 0, 0.22));
  const wipeK = easeInOut(window01(progress, 0.26, 0.5));
  const liftK = window01(progress, 0.3, 0.52);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 180px', fontFamily: DIRECTOR_THEME.font }}>
      <div
        style={{
          fontSize: size,
          fontWeight: 700,
          lineHeight: 1.22,
          letterSpacing: '-0.02em',
          color: DIRECTOR_THEME.text,
          textAlign: 'center',
          opacity: clamp01(lineK * 1.2),
          transform: `translateY(${(1 - lineK) * 28}px)`,
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.86)' }}>{before}</span>
        {word ? (
          <span style={{ position: 'relative', display: 'inline-block', padding: '0 0.12em' }}>
            <span
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '0.1em',
                bottom: '0.08em',
                background: accent,
                borderRadius: 12,
                transformOrigin: 'left center',
                transform: `scaleX(${wipeK})`,
                boxShadow: `0 10px 44px ${accent}44`,
              }}
            />
            <span
              style={{
                position: 'relative',
                color: wipeK > 0.45 ? '#0D0D0D' : accent,
                fontWeight: 900,
                display: 'inline-block',
                transform: `translateY(${(1 - easeOut(liftK)) * -8}px)`,
              }}
            >
              {word}
            </span>
          </span>
        ) : null}
        <span style={{ color: 'rgba(255,255,255,0.86)' }}>{after}</span>
      </div>
    </div>
  );
}
