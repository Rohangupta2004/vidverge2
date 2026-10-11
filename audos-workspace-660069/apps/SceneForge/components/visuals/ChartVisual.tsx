// CHART — quantities that change. The axis draws first so the viewer knows
// what they are looking at, then the data fills in, point by point, in the
// order the narrator says it.
import { DIRECTOR_THEME, clamp01, displayLabel, easeInOut, easeOut, formatNumber, parseNumericLabel, springValue, stagger01, window01, type VisualProps } from './visualTheme';

const PLOT = { left: 260, right: 1700, top: 250, bottom: 840 };

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${formatNumber(value / 1_000_000, abs >= 10_000_000 ? 0 : 1, false)}M`;
  if (abs >= 1_000) return `${formatNumber(value / 1_000, abs >= 10_000 ? 0 : 1, false)}k`;
  return formatNumber(value, Number.isInteger(value) ? 0 : 1, false);
}

export default function ChartVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const points = (spec.visual.dataPoints && spec.visual.dataPoints.length >= 2 ? spec.visual.dataPoints : [1, 2, 3, 4]).slice(0, 12);
  const labels = spec.visual.elements;
  const unit = parseNumericLabel(spec.visual.label || '');
  const prefix = unit?.prefix || '';

  // Same rule the render uses (sceneForgeComposition's visual.asLine).
  const asLine = /line|curve|trend|exponential|growth/i.test(String(spec.visual.animation || '')) || points.length > 7;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(1e-6, max - min);
  const width = PLOT.right - PLOT.left;
  const height = PLOT.bottom - PLOT.top;

  const xOf = (index: number) => PLOT.left + (points.length === 1 ? width / 2 : (width * index) / (points.length - 1));
  const yOf = (value: number) => PLOT.bottom - ((value - min) / range) * height * 0.92;

  // Axes draw across the first fifth of the segment; nothing plots until the
  // frame they sit in exists.
  const axisK = easeInOut(window01(progress, 0, 0.2));
  const dataK = easeOut(window01(progress, 0.18, 0.88));

  const linePath = points.map((value, index) => `${index === 0 ? 'M' : 'L'}${xOf(index)} ${yOf(value)}`).join(' ');
  // An approximate path length is enough for a dash-offset reveal and avoids
  // measuring the DOM, which the render farm cannot do mid-frame anyway.
  const pathLength = points.reduce((sum, value, index) => {
    if (index === 0) return 0;
    const dx = xOf(index) - xOf(index - 1);
    const dy = yOf(value) - yOf(points[index - 1]);
    return sum + Math.sqrt(dx * dx + dy * dy);
  }, 0) || 1;

  const barGap = Math.min(42, width / (points.length * 4));
  const barWidth = (width - barGap * (points.length - 1)) / points.length;

  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: DIRECTOR_THEME.font, color: DIRECTOR_THEME.text }}>
      {spec.visual.label ? (
        <div style={{ position: 'absolute', top: 110, left: 0, right: 0, textAlign: 'center', fontSize: 54, fontWeight: 700, letterSpacing: '-0.02em', opacity: window01(progress, 0, 0.14) }}>
          {spec.visual.label}
        </div>
      ) : null}

      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <line x1={PLOT.left - 40} y1={PLOT.bottom} x2={PLOT.left - 40 + (width + 80) * axisK} y2={PLOT.bottom} stroke={DIRECTOR_THEME.line} strokeWidth={4} strokeLinecap="round" />
        <line x1={PLOT.left - 40} y1={PLOT.bottom} x2={PLOT.left - 40} y2={PLOT.bottom - (height + 40) * axisK} stroke={DIRECTOR_THEME.line} strokeWidth={4} strokeLinecap="round" />

        {asLine ? (
          <>
            <path
              d={`${linePath} L${xOf(points.length - 1)} ${PLOT.bottom} L${xOf(0)} ${PLOT.bottom} Z`}
              fill={`${accent}1f`}
              opacity={clamp01(dataK * 1.4)}
            />
            <path
              d={linePath}
              fill="none"
              stroke={accent}
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={pathLength}
              strokeDashoffset={pathLength * (1 - dataK)}
            />
          </>
        ) : (
          points.map((value, index) => {
            const k = springValue(stagger01(progress, index, points.length, 0.6, 0.18) * 0.7, { damping: 16, stiffness: 120 });
            const barHeight = Math.max(0, (yOf(min) - yOf(value))) * clamp01(k);
            return (
              <rect
                key={index}
                x={PLOT.left + index * (barWidth + barGap)}
                y={PLOT.bottom - barHeight}
                width={barWidth}
                height={barHeight}
                rx={Math.min(18, barWidth / 3)}
                fill={accent}
                opacity={0.55 + 0.45 * (index / Math.max(1, points.length - 1))}
              />
            );
          })
        )}
      </svg>

      {points.map((value, index) => {
        const k = window01(progress, 0.2 + 0.58 * (index / Math.max(1, points.length - 1)), 0.26 + 0.58 * (index / Math.max(1, points.length - 1)));
        if (k <= 0) return null;
        const x = asLine ? xOf(index) : PLOT.left + index * (barWidth + barGap) + barWidth / 2;
        const y = asLine ? yOf(value) : PLOT.bottom - Math.max(0, yOf(min) - yOf(value));
        return (
          <div key={index} style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%, -100%)', opacity: k, textAlign: 'center' }}>
            {asLine ? (
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: accent, margin: '0 auto 10px', boxShadow: `0 0 0 ${7 * k}px ${accent}22`, transform: 'translateY(32px)' }} />
            ) : null}
            <div style={{ fontSize: 36, fontWeight: 800, color: DIRECTOR_THEME.text, marginBottom: 14, transform: `translateY(${(1 - easeOut(k)) * 14}px)` }}>
              {prefix}{compact(value)}
            </div>
          </div>
        );
      })}

      {points.map((value, index) => {
        const label = displayLabel(labels[index] || '');
        if (!label) return null;
        const k = window01(progress, 0.22 + 0.58 * (index / Math.max(1, points.length - 1)), 0.3 + 0.58 * (index / Math.max(1, points.length - 1)));
        const x = asLine ? xOf(index) : PLOT.left + index * (barWidth + barGap) + barWidth / 2;
        return (
          <div key={`label-${index}`} style={{ position: 'absolute', left: x, top: PLOT.bottom + 24, transform: 'translateX(-50%)', opacity: k, fontSize: 26, fontWeight: 600, color: DIRECTOR_THEME.muted, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {label}
          </div>
        );
      })}
    </div>
  );
}
