/**
 * VERGE LOADER — Vidverge's branded loading motion.
 *
 * The mark is the logo itself: a shallow "V" drawn from swooping light
 * filaments. While something is loading, a bright spark sweeps in from the
 * outer tips, dives through the vertex and runs out the far side, so the wait
 * is carried by the brand shape instead of a generic spinner.
 *
 * WHY THIS IS CODED MOTION RATHER THAN A RIVE ARTBOARD
 * Rive renders `.riv` files, which are binaries exported from the Rive editor;
 * no `.riv` ships with this workspace and one cannot be authored from source.
 * Pointing the Rive runtime at a file that does not exist renders a blank
 * canvas, so the motion is hand-coded here as SVG + CSS keyframes, which is
 * dependency-free and animates on the compositor. To move to Rive later, keep
 * this component's props and swap the <svg> for the runtime's <RiveComponent>
 * (the rive-animation integration pins the runtime and the required wasm URL).
 */
import { useId } from 'react';
import type { CSSProperties } from 'react';

/** The house tone: gold filaments with a deep-gold spark, per components/theme.ts. */
const BRAND_TONE = { edge: '#C8920A', mid: '#B4720A', spark: '#B4720A' } as const;

/**
 * Drawn on top of a brand-filled surface — a gold-gradient button — where a
 * gold mark would disappear into its own background.
 */
const ON_BRAND_TONE = { edge: 'rgba(255,255,255,0.45)', mid: '#FFFFFF', spark: '#FFFFFF' } as const;

// `amber` and `ink` are the names the existing call sites pass; they now point
// at the two tones above rather than the retired gold palette.
const TONES = {
  brand: BRAND_TONE,
  onBrand: ON_BRAND_TONE,
  amber: BRAND_TONE,
  ink: ON_BRAND_TONE,
} as const;

export type VergeLoaderTone = keyof typeof TONES;

// Three filaments at different depths, each sparking slightly out of phase so
// the light cascades through the V rather than pulsing all at once.
const FILAMENTS: Array<{ d: string; w: number; delay: string }> = [
  { d: 'M 2 27 C 52 29, 72 47, 100 85 C 128 47, 148 29, 198 27', w: 1.5, delay: '0s' },
  { d: 'M 2 36 C 54 38, 74 56, 100 94 C 126 56, 146 38, 198 36', w: 2.3, delay: '-0.6s' },
  { d: 'M 2 45 C 56 47, 76 64, 100 102 C 124 64, 144 47, 198 45', w: 1.5, delay: '-1.2s' },
];

// `pathLength=100` normalises every filament to 100 units, so one dash cycle
// is exactly one trip along the path regardless of the curve's real length.
const LOADER_CSS = `
@keyframes vvlSpark { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes vvlBloom { 0%, 100% { opacity: .1; } 50% { opacity: .3; } }
.vvl-spark { animation: vvlSpark 1.9s linear infinite; }
.vvl-bloom { animation: vvlBloom 1.9s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .vvl-spark { animation: none; stroke-dasharray: none; stroke-dashoffset: 0; opacity: .45; }
  .vvl-bloom { animation: none; opacity: .18; }
}
`;

export interface VergeLoaderProps {
  /** Width in pixels. Height follows the 5:3 artboard. */
  size?: number;
  /** Visible text under the mark. Omit for a bare mark. */
  caption?: string;
  /** Screen-reader text announcing what is loading. */
  label?: string;
  tone?: VergeLoaderTone;
  style?: CSSProperties;
}

export default function VergeLoader({
  size = 120,
  caption,
  label = 'Loading',
  tone = 'brand',
  style,
}: VergeLoaderProps) {
  // Unique per instance so several loaders on one page never share gradients.
  const uid = useId().replace(/:/g, '');
  const gradId = `vvlGrad-${uid}`;
  const glowId = `vvlGlow-${uid}`;
  const bloomId = `vvlBloom-${uid}`;
  const colors = TONES[tone];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: caption ? 16 : 0,
        ...style,
      }}
    >
      <style>{LOADER_CSS}</style>

      <svg
        width={size}
        height={Math.round(size * 0.6)}
        viewBox="0 0 200 120"
        aria-hidden
        focusable="false"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={colors.edge} stopOpacity="0" />
            <stop offset="20%" stopColor={colors.edge} stopOpacity="0.55" />
            <stop offset="50%" stopColor={colors.mid} stopOpacity="1" />
            <stop offset="80%" stopColor={colors.edge} stopOpacity="0.55" />
            <stop offset="100%" stopColor={colors.edge} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} x="-25%" y="-70%" width="150%" height="240%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id={bloomId} x="-70%" y="-160%" width="240%" height="420%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* Gold haze at the vertex, where the filaments converge. */}
        <ellipse
          className="vvl-bloom"
          cx="100"
          cy="94"
          rx="30"
          ry="12"
          fill={colors.mid}
          filter={`url(#${bloomId})`}
        />

        {FILAMENTS.map((filament) => (
          <g key={filament.d}>
            {/* Dim rail so the V reads even between sparks. */}
            <path
              d={filament.d}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={filament.w}
              strokeLinecap="round"
              opacity={0.35}
            />
            {/* Blurred halo trailing the spark. */}
            <path
              className="vvl-spark"
              d={filament.d}
              pathLength={100}
              strokeDasharray="13 87"
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={filament.w * 3}
              strokeLinecap="round"
              filter={`url(#${glowId})`}
              opacity={0.55}
              style={{ animationDelay: filament.delay }}
            />
            {/* Hot core of the spark. */}
            <path
              className="vvl-spark"
              d={filament.d}
              pathLength={100}
              strokeDasharray="9 91"
              fill="none"
              stroke={colors.spark}
              strokeWidth={filament.w}
              strokeLinecap="round"
              style={{ animationDelay: filament.delay }}
            />
          </g>
        ))}
      </svg>

      {caption ? (
        <span
          style={{
            fontSize: 13,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: tone === 'ink' || tone === 'onBrand' ? '#FFFFFF' : '#7A6030',
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, 'SF Mono', monospace",
          }}
        >
          {caption}
        </span>
      ) : null}

      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}
