// All SDK component prop types.
// Opus writes against these — they are the reliability layer.

export type AssetHandle = string;

// ── UI ────────────────────────────────────────────────
export interface BrowserFrameProps {
  screenshot: AssetHandle;
  url?: string;
  zoom?: number;               // 0.5–2.0
  animateIn?: boolean;
  highlight?: { x: number; y: number; width: number; height: number; label?: string };
  theme?: 'light' | 'dark';
}

export interface DashboardProps {
  screenshot?: AssetHandle;
  metrics?: Array<{ label: string; value: string | number; trend?: 'up' | 'down' | 'flat' }>;
  animateCounters?: boolean;
  highlightRegion?: 'top-left' | 'top-right' | 'center' | 'full';
}

export interface CursorProps {
  path: Array<{ x: number; y: number; frame: number }>;
  clickFrames?: number[];
  style?: 'default' | 'pointer' | 'text';
}

export interface HighlightProps {
  target: { x: number; y: number; width: number; height: number };
  color?: string;
  pulse?: boolean;
  label?: string;
}

export interface TooltipProps {
  text: string;
  position: { x: number; y: number };
  appearsAtFrame?: number;
}

export interface SemanticUIProps {
  referenceId: string;
  screenName: string;
  elements: Array<{
    id: string;
    type: 'navbar' | 'sidebar' | 'heading' | 'text' | 'button' | 'card' | 'metric' | 'chart' | 'table' | 'input' | 'badge' | 'image';
    label: string;
    value?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  background?: string;
  surface?: string;
  textColor?: string;
  accent?: string;
  focusId?: string;
  beatReactive?: boolean;
}

// ── TYPOGRAPHY ───────────────────────────────────────────
export interface MassiveTypeProps {
  text: string;
  scale?: 'viewport' | 'massive' | 'editorial' | 'display';
  weight?: 100 | 400 | 700 | 900;
  color?: string;
  animateIn?: 'rise' | 'fall' | 'scale' | 'reveal' | 'none';
  tracking?: 'tight' | 'normal' | 'wide' | 'ultra';
  align?: 'left' | 'center' | 'right';
}

export interface KineticTextProps {
  lines: string[];
  staggerFrames?: number;
  motion?: 'rise' | 'fall' | 'split' | 'cascade' | 'typewriter';
  emphasis?: string[];
  color?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface WordRevealProps {
  text: string;
  revealStyle?: 'word' | 'char' | 'line';
  color?: string;
  durationFrames?: number;
}

export interface SplitTextProps {
  text: string;
  splitAxis?: 'horizontal' | 'vertical';
  gapPx?: number;
  animateDirection?: 'apart' | 'together';
}

export interface TypeOnProps {
  text: string;
  cursorVisible?: boolean;
  charsPerFrame?: number;
}

// ── MOTION ─────────────────────────────────────────────
export interface ParallaxProps {
  depth?: number;              // 0–1
  direction?: 'up' | 'down' | 'left' | 'right';
  children?: React.ReactNode;
}

export interface CameraProps {
  motion: 'push-in' | 'pull-back' | 'drift-left' | 'drift-right' | 'orbit';
  intensity?: 'subtle' | 'moderate' | 'dramatic';
  durationFrames?: number;
  children?: React.ReactNode;
}

export interface ZoomProps {
  from: number;
  to: number;
  origin?: { x: number; y: number };
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'spring' | 'snap';
  children?: React.ReactNode;
}

export interface BlurMaskProps {
  intensity?: number;          // 0–20px
  animateIn?: boolean;
  durationFrames?: number;
  children?: React.ReactNode;
}

export interface MorphProps {
  fromScreenshot: AssetHandle;
  toScreenshot: AssetHandle;
  durationFrames?: number;
  style?: 'crossfade' | 'wipe' | 'distort';
}

export interface ParticleProps {
  density?: 'sparse' | 'medium' | 'dense';
  behavior?: 'drift' | 'explode' | 'orbit' | 'rain';
  color?: string;
  size?: number;
}

// ── COMPOSITION ─────────────────────────────────────────
export interface SplitScreenProps {
  direction?: 'horizontal' | 'vertical';
  ratio?: number;              // 0–1
  gap?: number;
  labelLeft?: string;
  labelRight?: string;
  children?: [React.ReactNode, React.ReactNode];
}

export interface FloatingUIProps {
  screenshot: AssetHandle;
  float?: 'subtle' | 'breathing' | 'drift';
  shadow?: boolean;
  cornerRadius?: number;
}

export interface PerspectiveProps {
  rotateX?: number;
  rotateY?: number;
  depth?: number;
  children?: React.ReactNode;
}

export interface GridProps {
  columns: number;
  gap?: number;
  items: AssetHandle[];
  animateIn?: 'stagger' | 'simultaneous';
}

export interface FullBleedProps {
  screenshot: AssetHandle;
  overlay?: string;            // 'rgba(0,0,0,0.4)'
  blur?: number;
}

// ── MEDIA ──────────────────────────────────────────────
export interface ScreenshotProps {
  src: AssetHandle;
  fit?: 'cover' | 'contain' | 'fill';
  cornerRadius?: number;
  shadow?: boolean;
  border?: string;
}

export interface LogoProps {
  src: AssetHandle;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animateIn?: 'fade' | 'scale' | 'none';
}

export interface ProductImageProps {
  src: AssetHandle;
  fit?: 'cover' | 'contain';
  cornerRadius?: number;
  shadow?: boolean;
  uiId?: string;
}

export interface MetricCounterProps {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  durationFrames?: number;
  color?: string;
}

// ── RENDER CONSTRAINTS (enforced — Opus does not choose these) ───────
export const RENDER_CONSTRAINTS = {
  width: 1920,
  height: 1080,
  fps: 30,
  maxDurationFrames: 1800,     // 60s hard cap
  audioSampleRate: 44100,
} as const;

// ── SDK COMPONENT REGISTRY ──────────────────────────────────
// Opus must only reference names from this list.
export const SDK_COMPONENTS = [
  // UI
  'BrowserFrame', 'Dashboard', 'Cursor', 'Highlight', 'Tooltip', 'SemanticUI',
  // Typography
  'MassiveType', 'KineticText', 'WordReveal', 'SplitText', 'TypeOn',
  // Motion
  'Parallax', 'Camera', 'Zoom', 'BlurMask', 'Morph', 'Particle',
  // Composition
  'SplitScreen', 'FloatingUI', 'Perspective', 'Grid', 'FullBleed',
  // Media
  'Screenshot', 'Logo', 'ProductImage', 'MetricCounter',
] as const;

export type SDKComponentName = typeof SDK_COMPONENTS[number];

/** True when a name Opus wrote is actually a component this SDK ships. */
export function isSDKComponent(name: string): name is SDKComponentName {
  return (SDK_COMPONENTS as readonly string[]).indexOf(name) >= 0;
}

/** The components that accept children, so a plan can nest layers inside them. */
export const CONTAINER_COMPONENTS: SDKComponentName[] = [
  'Parallax', 'Camera', 'Zoom', 'BlurMask', 'Perspective', 'SplitScreen',
];
