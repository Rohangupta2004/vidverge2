// sdk/components — the SDK as plain React, for the app's own UI.
//
// These are NOT what renders the MP4. The film runs on sdk/runtime-source.ts,
// which is Remotion source text concatenated into a single composition module
// by pipeline/render.ts. These components are the still, frame-zero twin of
// that runtime: they take the same props and draw a recognisable approximation
// inside an ordinary <div>, which is what lets FilmSpecViewer show a real
// storyboard of a plan before a single frame has been rendered.
//
// They also make '../sdk/components' a real import path — the path the
// generated Film.tsx imports from.

import type {
  BrowserFrameProps, DashboardProps, CursorProps, HighlightProps, TooltipProps, SemanticUIProps,
  MassiveTypeProps, KineticTextProps, WordRevealProps, SplitTextProps, TypeOnProps,
  ParallaxProps, CameraProps, ZoomProps, BlurMaskProps, MorphProps, ParticleProps,
  SplitScreenProps, FloatingUIProps, PerspectiveProps, GridProps, FullBleedProps,
  ScreenshotProps, LogoProps, ProductImageProps, MetricCounterProps,
} from '../component-sdk.types';

const FONT = "'Inter', system-ui, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export interface PreviewTheme {
  bg: string;
  text: string;
  muted: string;
  accent: string;
  panel: string;
  border: string;
}

export const DEFAULT_PREVIEW_THEME: PreviewTheme = {
  bg: '#05060A',
  text: '#F3F6FB',
  muted: 'rgba(243,246,251,0.58)',
  accent: '#F59E0B',
  panel: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.12)',
};

/**
 * The preview cannot reach the asset registry (it runs before a render), so a
 * handle is drawn as a labelled plate. That is deliberate: the storyboard
 * should make a missing asset obvious, not paper over it.
 */
function Plate(props: { label?: string; radius?: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02))',
        border: '1px solid ' + DEFAULT_PREVIEW_THEME.border,
        borderRadius: props.radius === undefined ? 10 : props.radius,
        fontFamily: MONO,
        fontSize: 10,
        color: DEFAULT_PREVIEW_THEME.muted,
        textAlign: 'center',
        padding: 6,
        overflow: 'hidden',
      }}
    >
      {props.label || 'asset'}
    </div>
  );
}

function Fill(props: { children?: React.ReactNode; pad?: number; justify?: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: props.justify || 'center',
        padding: props.pad === undefined ? 14 : props.pad,
      }}
    >
      {props.children}
    </div>
  );
}

// ── UI ──

export function BrowserFrame(props: BrowserFrameProps) {
  return (
    <Fill pad={10}>
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid ' + DEFAULT_PREVIEW_THEME.border,
          display: 'flex',
          flexDirection: 'column',
          background: props.theme === 'light' ? '#FFFFFF' : DEFAULT_PREVIEW_THEME.panel,
        }}
      >
        <div
          style={{
            height: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            padding: '0 6px',
            background: 'rgba(255,255,255,0.07)',
          }}
        >
          {['#FF5F57', '#FEBC2E', '#28C840'].map((dot) => (
            <span key={dot} style={{ width: 4, height: 4, borderRadius: 2, background: dot }} />
          ))}
          <span style={{ marginLeft: 6, fontFamily: MONO, fontSize: 7, color: DEFAULT_PREVIEW_THEME.muted }}>
            {props.url || ''}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Plate label={props.screenshot} radius={0} />
        </div>
      </div>
    </Fill>
  );
}

export function Dashboard(props: DashboardProps) {
  const metrics = (props.metrics || []).slice(0, 4);
  return (
    <Fill pad={10}>
      <div style={{ width: '100%', height: '100%', position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
        <Plate label={props.screenshot || 'dashboard'} radius={8} />
        {metrics.length ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(' + Math.min(4, metrics.length) + ', 1fr)',
              gap: 5,
              padding: 10,
              alignContent: 'center',
            }}
          >
            {metrics.map((metric, index) => (
              <div
                key={'m' + index}
                style={{
                  background: 'rgba(5,6,10,0.72)',
                  border: '1px solid ' + DEFAULT_PREVIEW_THEME.border,
                  borderRadius: 6,
                  padding: '5px 6px',
                  fontFamily: FONT,
                }}
              >
                <div style={{ fontSize: 6, textTransform: 'uppercase', color: DEFAULT_PREVIEW_THEME.muted }}>
                  {metric.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 900, color: DEFAULT_PREVIEW_THEME.text }}>
                  {String(metric.value)}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Fill>
  );
}

export function Cursor(props: CursorProps) {
  const point = (props.path && props.path[0]) || { x: 50, y: 50, frame: 0 };
  return (
    <div
      style={{
        position: 'absolute',
        left: point.x + '%',
        top: point.y + '%',
        width: 0,
        height: 0,
        borderLeft: '7px solid #FFFFFF',
        borderTop: '4px solid transparent',
        borderBottom: '4px solid transparent',
        transform: 'rotate(' + (props.style === 'text' ? 90 : 38) + 'deg)',
      }}
    />
  );
}

export function Highlight(props: HighlightProps) {
  const target = props.target || { x: 40, y: 40, width: 20, height: 20 };
  return (
    <div
      style={{
        position: 'absolute',
        left: target.x + '%',
        top: target.y + '%',
        width: target.width + '%',
        height: target.height + '%',
        border: '1.5px solid ' + (props.color || DEFAULT_PREVIEW_THEME.accent),
        borderRadius: 5,
      }}
    />
  );
}

export function Tooltip(props: TooltipProps) {
  const position = props.position || { x: 50, y: 50 };
  return (
    <div
      style={{
        position: 'absolute',
        left: position.x + '%',
        top: position.y + '%',
        padding: '3px 6px',
        borderRadius: 5,
        background: DEFAULT_PREVIEW_THEME.panel,
        border: '1px solid ' + DEFAULT_PREVIEW_THEME.border,
        fontFamily: FONT,
        fontSize: 8,
        color: DEFAULT_PREVIEW_THEME.text,
        maxWidth: '55%',
      }}
    >
      {props.text}
    </div>
  );
}

export function SemanticUI(props: SemanticUIProps) {
  return (
    <Fill pad={10}>
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 8, background: props.background || '#0B1020', border: '1px solid ' + DEFAULT_PREVIEW_THEME.border }}>
        {(props.elements || []).map((element) => (
          <div
            key={element.id}
            data-ui-id={element.id}
            style={{
              position: 'absolute', left: element.x + '%', top: element.y + '%', width: element.width + '%', height: element.height + '%',
              borderRadius: element.type === 'button' || element.type === 'badge' ? 999 : 4,
              background: element.type === 'button' ? (props.accent || DEFAULT_PREVIEW_THEME.accent) : (props.surface || 'rgba(255,255,255,0.07)'),
              color: element.type === 'button' ? '#07111F' : (props.textColor || '#F8FAFC'),
              border: '1px solid rgba(255,255,255,0.1)', fontFamily: FONT, fontSize: 6, fontWeight: element.type === 'heading' ? 800 : 600,
              display: 'flex', alignItems: 'center', padding: '0 4px', overflow: 'hidden',
              outline: props.focusId === element.id ? '2px solid ' + (props.accent || DEFAULT_PREVIEW_THEME.accent) : 'none',
            }}
          >
            {element.value || element.label}
          </div>
        ))}
      </div>
    </Fill>
  );
}

// ── TYPOGRAPHY ──

const PREVIEW_TYPE_SCALE: Record<string, number> = {
  viewport: 30, massive: 24, editorial: 18, display: 15,
};

const PREVIEW_TRACKING: Record<string, string> = {
  tight: '-0.045em', normal: '0em', wide: '0.08em', ultra: '0.2em',
};

export function MassiveType(props: MassiveTypeProps) {
  const justify = props.align === 'left' ? 'flex-start' : props.align === 'right' ? 'flex-end' : 'center';
  return (
    <Fill justify={justify}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: PREVIEW_TYPE_SCALE[props.scale || 'massive'] || 24,
          fontWeight: props.weight || 900,
          lineHeight: 0.95,
          letterSpacing: PREVIEW_TRACKING[props.tracking || 'tight'],
          color: props.color || DEFAULT_PREVIEW_THEME.text,
          textAlign: props.align || 'center',
          wordBreak: 'break-word',
        }}
      >
        {props.text}
      </div>
    </Fill>
  );
}

const PREVIEW_TEXT_SIZE: Record<string, number> = { sm: 8, md: 11, lg: 14, xl: 18 };

export function KineticText(props: KineticTextProps) {
  const emphasis = props.emphasis || [];
  return (
    <Fill>
      <div
        style={{
          fontFamily: FONT,
          fontSize: PREVIEW_TEXT_SIZE[props.size || 'lg'] || 14,
          fontWeight: 800,
          lineHeight: 1.18,
          letterSpacing: '-0.025em',
          color: props.color || DEFAULT_PREVIEW_THEME.text,
          textAlign: 'center',
        }}
      >
        {(props.lines || []).map((line, index) => (
          <div key={'l' + index}>
            {line.split(' ').map((word, wordIndex) => {
              const bare = word.split('*').join('');
              const hot = word.indexOf('*') >= 0 || emphasis.indexOf(bare) >= 0;
              return (
                <span key={'w' + wordIndex} style={{ color: hot ? DEFAULT_PREVIEW_THEME.accent : 'inherit' }}>
                  {bare + ' '}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </Fill>
  );
}

export function WordReveal(props: WordRevealProps) {
  return (
    <Fill>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: props.color || DEFAULT_PREVIEW_THEME.text,
          textAlign: 'center',
        }}
      >
        {props.text}
      </div>
    </Fill>
  );
}

export function SplitText(props: SplitTextProps) {
  const text = props.text || '';
  const mid = Math.ceil(text.length / 2);
  const horizontal = (props.splitAxis || 'horizontal') === 'horizontal';
  return (
    <Fill>
      <div
        style={{
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          gap: Math.min(10, (props.gapPx || 40) / 8),
          fontFamily: FONT,
          fontSize: 20,
          fontWeight: 900,
          letterSpacing: '-0.04em',
          color: DEFAULT_PREVIEW_THEME.text,
        }}
      >
        <span>{text.slice(0, mid)}</span>
        <span>{text.slice(mid)}</span>
      </div>
    </Fill>
  );
}

export function TypeOn(props: TypeOnProps) {
  return (
    <Fill>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 12,
          fontWeight: 600,
          color: DEFAULT_PREVIEW_THEME.text,
          textAlign: 'center',
        }}
      >
        {props.text}
        {props.cursorVisible === false ? null : <span style={{ color: DEFAULT_PREVIEW_THEME.accent }}>_</span>}
      </div>
    </Fill>
  );
}

// ── MOTION ──

export function Parallax(props: ParallaxProps) {
  return <div style={{ position: 'absolute', inset: 0 }}>{props.children}</div>;
}

export function Camera(props: CameraProps) {
  return <div style={{ position: 'absolute', inset: 0 }}>{props.children}</div>;
}

export function Zoom(props: ZoomProps) {
  const scale = Number(props.from) || 1;
  const origin = props.origin || { x: 50, y: 50 };
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: 'scale(' + scale + ')',
        transformOrigin: origin.x + '% ' + origin.y + '%',
      }}
    >
      {props.children}
    </div>
  );
}

export function BlurMask(props: BlurMaskProps) {
  const blur = Math.min(20, Math.max(0, Number(props.intensity) || 0));
  return (
    <div style={{ position: 'absolute', inset: 0, filter: 'blur(' + blur / 4 + 'px)' }}>{props.children}</div>
  );
}

export function Morph(props: MorphProps) {
  return (
    <Fill pad={10}>
      <div style={{ display: 'flex', gap: 4, width: '100%', height: '100%' }}>
        <Plate label={props.fromScreenshot} />
        <Plate label={props.toScreenshot} />
      </div>
    </Fill>
  );
}

const PREVIEW_PARTICLES: Record<string, number> = { sparse: 10, medium: 22, dense: 44 };

function noiseAt(index: number, salt: number): number {
  const value = Math.sin((index + 1) * salt) * 43758.5453;
  return value - Math.floor(value);
}

export function Particle(props: ParticleProps) {
  const count = PREVIEW_PARTICLES[props.density || 'medium'] || 22;
  const dots = [];
  for (let i = 0; i < count; i += 1) {
    dots.push(
      <span
        key={'p' + i}
        style={{
          position: 'absolute',
          left: noiseAt(i, 127.1) * 100 + '%',
          top: noiseAt(i, 311.7) * 100 + '%',
          width: Math.max(1, (props.size || 4) / 3),
          height: Math.max(1, (props.size || 4) / 3),
          borderRadius: 4,
          background: props.color || DEFAULT_PREVIEW_THEME.accent,
          opacity: 0.5,
        }}
      />,
    );
  }
  return <div style={{ position: 'absolute', inset: 0 }}>{dots}</div>;
}

// ── COMPOSITION ──

export function SplitScreen(props: SplitScreenProps) {
  const kids = props.children || [null, null];
  const horizontal = (props.direction || 'horizontal') === 'horizontal';
  const ratio = props.ratio === undefined ? 0.5 : props.ratio;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        gap: Math.min(6, props.gap || 0),
      }}
    >
      <div style={{ position: 'relative', flex: ratio, overflow: 'hidden' }}>{kids[0]}</div>
      <div style={{ position: 'relative', flex: 1 - ratio, overflow: 'hidden' }}>{kids[1]}</div>
    </div>
  );
}

export function FloatingUI(props: FloatingUIProps) {
  return (
    <Fill pad={16}>
      <Plate label={props.screenshot} radius={props.cornerRadius === undefined ? 10 : props.cornerRadius} />
    </Fill>
  );
}

export function Perspective(props: PerspectiveProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, perspective: (props.depth || 1200) + 'px' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: 'rotateX(' + (props.rotateX || 0) + 'deg) rotateY(' + (props.rotateY || 0) + 'deg)',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export function Grid(props: GridProps) {
  return (
    <Fill pad={12}>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          gridTemplateColumns: 'repeat(' + Math.max(1, props.columns || 3) + ', 1fr)',
          gap: Math.min(6, (props.gap || 26) / 4),
        }}
      >
        {(props.items || []).map((handle, index) => (
          <Plate key={'g' + index} label={handle} radius={6} />
        ))}
      </div>
    </Fill>
  );
}

export function FullBleed(props: FullBleedProps) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Plate label={props.screenshot} radius={0} />
      {props.overlay ? <div style={{ position: 'absolute', inset: 0, background: props.overlay }} /> : null}
    </div>
  );
}

// ── MEDIA ──

export function Screenshot(props: ScreenshotProps) {
  return (
    <Fill pad={12}>
      <Plate label={props.src} radius={props.cornerRadius === undefined ? 8 : props.cornerRadius} />
    </Fill>
  );
}

const PREVIEW_LOGO_SIZE: Record<string, number> = { sm: 28, md: 44, lg: 66, xl: 92 };

export function Logo(props: LogoProps) {
  const size = PREVIEW_LOGO_SIZE[props.size || 'md'] || 44;
  return (
    <Fill>
      <div style={{ width: size, height: size * 0.42 }}>
        <Plate label={props.src} radius={4} />
      </div>
    </Fill>
  );
}

export function ProductImage(props: ProductImageProps) {
  return <Fill pad={12}><Plate label={props.src} radius={props.cornerRadius === undefined ? 8 : props.cornerRadius} /></Fill>;
}

export function MetricCounter(props: MetricCounterProps) {
  return (
    <Fill>
      <div style={{ textAlign: 'center', fontFamily: FONT }}>
        <div
          style={{
            fontSize: 34,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: '-0.05em',
            color: props.color || DEFAULT_PREVIEW_THEME.accent,
          }}
        >
          {(props.prefix || '') + String(props.value) + (props.suffix || '')}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 7,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: DEFAULT_PREVIEW_THEME.muted,
          }}
        >
          {props.label}
        </div>
      </div>
    </Fill>
  );
}

export type PreviewComponent = React.ComponentType<Record<string, unknown>>;

function asPreview(component: unknown): PreviewComponent {
  return component as PreviewComponent;
}

/** Name -> preview component, so a ComponentPlan layer can be drawn by string. */
export const PREVIEW_REGISTRY: Record<string, PreviewComponent> = {
  BrowserFrame: asPreview(BrowserFrame),
  Dashboard: asPreview(Dashboard),
  Cursor: asPreview(Cursor),
  Highlight: asPreview(Highlight),
  Tooltip: asPreview(Tooltip),
  SemanticUI: asPreview(SemanticUI),
  MassiveType: asPreview(MassiveType),
  KineticText: asPreview(KineticText),
  WordReveal: asPreview(WordReveal),
  SplitText: asPreview(SplitText),
  TypeOn: asPreview(TypeOn),
  Parallax: asPreview(Parallax),
  Camera: asPreview(Camera),
  Zoom: asPreview(Zoom),
  BlurMask: asPreview(BlurMask),
  Morph: asPreview(Morph),
  Particle: asPreview(Particle),
  SplitScreen: asPreview(SplitScreen),
  FloatingUI: asPreview(FloatingUI),
  Perspective: asPreview(Perspective),
  Grid: asPreview(Grid),
  FullBleed: asPreview(FullBleed),
  Screenshot: asPreview(Screenshot),
  Logo: asPreview(Logo),
  ProductImage: asPreview(ProductImage),
  MetricCounter: asPreview(MetricCounter),
};
