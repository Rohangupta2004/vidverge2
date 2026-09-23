// VISUAL TIMELINE JSON — the structured scene direction the Opus Motion
// Director writes (agents/motionDirector) and every renderer obeys. It is the
// single source of truth for HOW a scene moves:
//   * the GSAP layer (lib/motionPrimitives → components/MotionGraphicPlayer)
//     renders each directed layer with its entrance/exit timing,
//   * the Remotion assembly (remotion/AssemblyComp) reads the scene's
//     transitions and composition choreography frame-accurately, and
//   * the spatial system (lib/spatial) resolves each layer's zone into a
//     collision-free rect before anything is drawn.
// The director timeline never invents CONTENT — every string and number it
// references comes from the scene's MotionSpec, which stays the deterministic
// text source. Direction = hierarchy, purpose, timing, spatial relationship
// and polish; MotionSpec = the exact words and figures on screen.

export type DirectedRole = 'background' | 'main' | 'support' | 'typography' | 'callout' | 'caption';

/** The composable primitive library (lib/motionPrimitives) the director can cast per layer. */
export type PrimitiveType =
  | 'SmartText'         // auto-sized text block, never overflows its rect
  | 'KineticHeadline'   // word-by-word kinetic entrance
  | 'Metric'            // animated counter + unit + label
  | 'Chart'             // bar chart with animated build-in + counters
  | 'TimelineRail'      // dated beats along an animated rail
  | 'Comparison'        // two contrasting panels, animated reveal
  | 'Callout'           // pill label connected via animated path to a target layer
  | 'Arrow'             // directional animated draw
  | 'Pointer'           // cursor-like pulsing attention dot
  | 'Highlight'         // animated box drawn around a target layer
  | 'Glow'              // ambient glow behind a focal layer
  | 'Diagram'           // hub + node graph with animated build
  | 'FlowChart'         // sequential steps with drawn connectors
  | 'DeviceMockup'      // phone frame containing a product image
  | 'BrowserMockup'     // browser chrome containing a product image
  | 'ProductUI'         // direct product screenshot card
  | 'ImageCard'         // image in a framed card with Ken Burns drift
  | 'VideoLayer'        // AI footage layer (assembly-level; GSAP capture renders its poster image)
  | 'ProgressIndicator' // segmented step/progress fill
  | 'Map'               // abstract geography: pins + drawn connection arcs
  | 'Logo'              // masked logo/wordmark reveal
  | 'Caption';          // bottom-safe caption pill

/** Entrance styles — every one combines transform + opacity; a bare fade or
 * bare slide is deliberately NOT in this vocabulary (banned as defaults). */
export type EntranceStyle = 'spring' | 'rise' | 'mask' | 'draw' | 'pop' | 'slide_fade' | 'blur_in' | 'countup';
export type EntranceFrom = 'left' | 'right' | 'top' | 'bottom' | 'center';

export type CameraMove = 'push_in' | 'pull_back' | 'drift_left' | 'drift_right' | 'none';
export type PacingStyle = 'contemplative' | 'balanced' | 'energetic';

/** Spatial zones resolved by lib/spatial per aspect ratio. */
export type ZoneId = 'top' | 'upper' | 'center' | 'lower' | 'bottom_safe' | 'left' | 'right' | 'full';

export type TransitionType = 'zoom_match_cut' | 'spatial_collapse' | 'push_through' | 'slide_context' | 'layer_reveal' | 'wipe_directional' | 'crossfade';

export interface EntranceSpec {
  /** Seconds from scene start (clamped into the scene window at render). */
  at: number;
  style: EntranceStyle;
  from?: EntranceFrom;
  /** Extra back.out overshoot on spring/pop entrances. */
  overshoot?: boolean;
}

export interface ExitSpec { at?: number; style?: 'settle' | 'collapse' | 'drift' }

export interface DirectedLayerContent {
  text?: string;
  subtext?: string;
  value?: number;
  prefix?: string;
  suffix?: string;
  items?: { label: string; sublabel?: string; value?: number; imageUrl?: string }[];
  leftTitle?: string;
  rightTitle?: string;
  leftItems?: string[];
  rightItems?: string[];
  imageUrl?: string;
}

export interface DirectedLayer {
  id: string;
  role: DirectedRole;
  type: PrimitiveType;
  zone: ZoneId;
  zIndex: number;
  entrance: EntranceSpec;
  exit?: ExitSpec;
  /** 'dominant' gets scale priority in its zone; supports shrink around it. */
  emphasis?: 'dominant' | 'supporting';
  /** Callout / Arrow / Highlight / Pointer / Glow aim at this layer. */
  targetLayerId?: string;
  /** One sentence: why this layer is on screen. Required by the director. */
  purpose?: string;
  content?: DirectedLayerContent;
}

export interface TransitionSpec {
  type: TransitionType;
  /** Seconds. */
  duration: number;
  direction?: 'left' | 'right' | 'up' | 'down';
}

export interface SceneDirection {
  version: 1;
  /** Seconds; informative — the scene window stays authoritative. */
  duration: number;
  /** 'gsap' = baked browser capture (smooth in-layer animation);
   * 'remotion' = the scene prefers assembly-level composition choreography
   * (overlay/central card entrances timed frame-accurately by Remotion).
   * GSAP still animates WITHIN layers either way. */
  renderer: 'gsap' | 'remotion';
  camera: { move: CameraMove; intensity?: number };
  pacing: PacingStyle;
  ambient: boolean;
  layers: DirectedLayer[];
  transitionIn?: TransitionSpec;
  transitionOut?: TransitionSpec;
  /** Spatial auto-shift log — every collision fix is recorded, not silent. */
  adjustments?: string[];
  /** Fingerprint of the MotionSpec this direction was written for; a changed
   * spec re-directs instead of reusing stale direction. */
  spec_fingerprint?: string;
}

const ROLES: DirectedRole[] = ['background', 'main', 'support', 'typography', 'callout', 'caption'];
const PRIMITIVES: PrimitiveType[] = ['SmartText', 'KineticHeadline', 'Metric', 'Chart', 'TimelineRail', 'Comparison', 'Callout', 'Arrow', 'Pointer', 'Highlight', 'Glow', 'Diagram', 'FlowChart', 'DeviceMockup', 'BrowserMockup', 'ProductUI', 'ImageCard', 'VideoLayer', 'ProgressIndicator', 'Map', 'Logo', 'Caption'];
const ENTRANCES: EntranceStyle[] = ['spring', 'rise', 'mask', 'draw', 'pop', 'slide_fade', 'blur_in', 'countup'];
const ZONES: ZoneId[] = ['top', 'upper', 'center', 'lower', 'bottom_safe', 'left', 'right', 'full'];
const TRANSITIONS: TransitionType[] = ['zoom_match_cut', 'spatial_collapse', 'push_through', 'slide_context', 'layer_reveal', 'wipe_directional', 'crossfade'];
const CAMERAS: CameraMove[] = ['push_in', 'pull_back', 'drift_left', 'drift_right', 'none'];

const str = (value: unknown, max = 240) => String(value == null ? '' : value).trim().slice(0, max);
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : undefined; };

function normalizeEntrance(raw: any, fallbackAt: number): EntranceSpec {
  const source = raw && typeof raw === 'object' ? raw : {};
  const style = ENTRANCES.includes(source.style) ? source.style : (ENTRANCES.includes(source.easing) ? source.easing : 'spring');
  const at = num(source.at);
  const from = ['left', 'right', 'top', 'bottom', 'center'].includes(source.from) ? source.from : undefined;
  return { at: at === undefined ? fallbackAt : Math.max(0, at), style, ...(from ? { from } : {}), ...(source.overshoot === true ? { overshoot: true } : {}) };
}

function normalizeContent(raw: any): DirectedLayerContent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: DirectedLayerContent = {};
  if (raw.text != null && str(raw.text)) out.text = str(raw.text);
  if (raw.subtext != null && str(raw.subtext)) out.subtext = str(raw.subtext, 300);
  const value = num(raw.value); if (value !== undefined) out.value = value;
  if (raw.prefix) out.prefix = str(raw.prefix, 12);
  if (raw.suffix) out.suffix = str(raw.suffix, 16);
  if (Array.isArray(raw.items)) {
    out.items = raw.items.slice(0, 8).map((item: any) => {
      if (item == null) return null;
      if (typeof item !== 'object') { const label = str(item, 120); return label ? { label } : null; }
      const label = str(item.label ?? item.text ?? '', 120);
      if (!label) return null;
      const entry: { label: string; sublabel?: string; value?: number; imageUrl?: string } = { label };
      const sub = str(item.sublabel ?? item.detail ?? '', 160); if (sub) entry.sublabel = sub;
      const v = num(item.value); if (v !== undefined) entry.value = v;
      const image = str(item.imageUrl ?? item.image_url ?? '', 500); if (/^(https?:|data:image)/i.test(image)) entry.imageUrl = image;
      return entry;
    }).filter(Boolean) as DirectedLayerContent['items'];
    if (!out.items?.length) delete out.items;
  }
  ['leftTitle', 'rightTitle'].forEach((key) => { if ((raw as any)[key]) (out as any)[key] = str((raw as any)[key], 80); });
  ['leftItems', 'rightItems'].forEach((key) => {
    if (Array.isArray((raw as any)[key])) {
      const list = (raw as any)[key].slice(0, 6).map((entry: any) => str(typeof entry === 'object' && entry ? entry.label ?? entry.text ?? '' : entry, 120)).filter(Boolean);
      if (list.length) (out as any)[key] = list;
    }
  });
  const image = str(raw.imageUrl ?? raw.image_url ?? '', 500);
  if (/^(https?:|data:image)/i.test(image)) out.imageUrl = image;
  return Object.keys(out).length ? out : undefined;
}

function normalizeTransition(raw: any): TransitionSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const type = TRANSITIONS.includes(raw.type) ? raw.type : undefined;
  if (!type) return undefined;
  const duration = Math.min(1.2, Math.max(0.2, num(raw.duration) ?? 0.4));
  const direction = ['left', 'right', 'up', 'down'].includes(raw.direction) ? raw.direction : undefined;
  return { type, duration, ...(direction ? { direction } : {}) };
}

/**
 * Coerce whatever the director (or a stored row) returned into a renderable
 * SceneDirection. Returns null when there is no usable direction at all, so
 * callers can fall back to the classic kind renderer.
 */
export function normalizeSceneDirection(raw: any): SceneDirection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw.scene && typeof raw.scene === 'object' ? raw.scene : raw;
  const rawLayers = Array.isArray(source.layers) ? source.layers : [];
  const layers: DirectedLayer[] = [];
  rawLayers.slice(0, 10).forEach((entry: any, index: number) => {
    if (!entry || typeof entry !== 'object') return;
    const type = PRIMITIVES.includes(entry.type) ? entry.type : undefined;
    if (!type) return;
    const role = ROLES.includes(entry.role) ? entry.role : (type === 'Caption' ? 'caption' : type === 'Callout' || type === 'Arrow' || type === 'Highlight' || type === 'Pointer' || type === 'Glow' ? 'callout' : type === 'KineticHeadline' || type === 'SmartText' ? 'typography' : index === 0 ? 'main' : 'support');
    const zone = ZONES.includes(entry.zone) ? entry.zone : (role === 'caption' ? 'bottom_safe' : role === 'typography' ? 'top' : 'center');
    const layer: DirectedLayer = {
      id: str(entry.id, 40) || `layer_${index + 1}`,
      role,
      type,
      zone,
      zIndex: Math.max(0, Math.min(20, Math.round(num(entry.zIndex) ?? index + 1))),
      entrance: normalizeEntrance(entry.entrance, 0.2 + index * 0.35),
    };
    if (entry.exit && typeof entry.exit === 'object') {
      const exitAt = num(entry.exit.at);
      const exitStyle = ['settle', 'collapse', 'drift'].includes(entry.exit.style) ? entry.exit.style : undefined;
      if (exitAt !== undefined || exitStyle) layer.exit = { ...(exitAt !== undefined ? { at: exitAt } : {}), ...(exitStyle ? { style: exitStyle } : {}) };
    }
    if (entry.emphasis === 'dominant' || entry.emphasis === 'supporting') layer.emphasis = entry.emphasis;
    if (entry.targetLayerId) layer.targetLayerId = str(entry.targetLayerId, 40);
    if (entry.purpose) layer.purpose = str(entry.purpose, 300);
    const content = normalizeContent(entry.content);
    if (content) layer.content = content;
    layers.push(layer);
  });
  if (!layers.length) return null;
  const direction: SceneDirection = {
    version: 1,
    duration: Math.min(20, Math.max(2, num(source.duration) ?? 6)),
    renderer: source.renderer === 'remotion' ? 'remotion' : 'gsap',
    camera: { move: CAMERAS.includes(source.camera?.move) ? source.camera.move : 'push_in', intensity: Math.min(2, Math.max(0.25, num(source.camera?.intensity) ?? 1)) },
    pacing: ['contemplative', 'balanced', 'energetic'].includes(source.pacing) ? source.pacing : 'balanced',
    ambient: source.ambient !== false,
    layers,
  };
  const tin = normalizeTransition(source.transitionIn ?? source.transition_in ?? source.transition);
  const tout = normalizeTransition(source.transitionOut ?? source.transition_out);
  if (tin) direction.transitionIn = tin;
  if (tout) direction.transitionOut = tout;
  if (Array.isArray(source.adjustments)) direction.adjustments = source.adjustments.slice(0, 12).map((entry: any) => str(entry, 200)).filter(Boolean);
  if (source.spec_fingerprint) direction.spec_fingerprint = str(source.spec_fingerprint, 60);
  return direction;
}

/** Stable fingerprint of a direction — combined with the spec fingerprint it
 * decides whether a stored capture is still a capture of THIS direction. */
export function directionFingerprint(direction: SceneDirection | null): string {
  if (!direction) return '';
  const ordered = JSON.stringify(direction, Object.keys(direction as unknown as Record<string, unknown>).sort());
  let hash = 5381;
  for (let i = 0; i < ordered.length; i += 1) hash = ((hash << 5) + hash + ordered.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// ---------------------------------------------------------------------------
// CONTENT-AWARE TRANSITIONS. When the director did not specify a transition,
// the assembly derives one from what the outgoing and incoming scenes ARE —
// generic crossfade is the last resort, never the default.
// ---------------------------------------------------------------------------

export interface TransitionContext {
  /** 'heygen' | VisualKind of the segment on each side of the cut. */
  fromKind: string;
  toKind: string;
  /** MotionSpec.kind when the segment is a motion graphic. */
  fromMotionKind?: string | null;
  toMotionKind?: string | null;
  /** Preferred lateral direction (from the scene's effect setting). */
  direction?: 'left' | 'right' | 'up' | 'down';
}

/**
 * Choose the cinematic transition for a cut. Reads the scene content on both
 * sides — a stat that just counted up pushes THROUGH into the next shot, a
 * comparison collapses spatially, footage match-cuts into graphics via a zoom,
 * stills reveal by layer — and falls back to a narrative slide, never to a
 * bare crossfade.
 */
export function chooseTransition(ctx: TransitionContext): TransitionSpec {
  const from = String(ctx.fromKind || 'heygen');
  const to = String(ctx.toKind || 'heygen');
  const fromMotion = String(ctx.fromMotionKind || '');
  const toMotion = String(ctx.toMotionKind || '');
  const dir = ctx.direction || 'right';
  // A big number that just finished counting up: the camera pushes through it.
  if (fromMotion === 'big_stat') return { type: 'push_through', duration: 0.45 };
  // Cutting between real footage and graphics: zoom match cut keeps the
  // visual energy moving in one direction across the cut.
  if (from === 'ai_video' && (to === 'motion_graphic' || to === 'text_overlay')) return { type: 'zoom_match_cut', duration: 0.45 };
  if ((from === 'motion_graphic' || from === 'text_overlay') && to === 'ai_video') return { type: 'zoom_match_cut', duration: 0.45 };
  // Problem/solution and A-vs-B structures replace each other in place.
  if (toMotion === 'comparison' || fromMotion === 'comparison') return { type: 'spatial_collapse', duration: 0.5 };
  // A still reveals what is underneath (good for before/after and portraits).
  if (from === 'image' || to === 'image') return { type: 'layer_reveal', duration: 0.45 };
  // Footage-to-footage keeps subject momentum with a directional wipe.
  if (from === 'ai_video' && to === 'ai_video') return { type: 'wipe_directional', duration: 0.4, direction: dir };
  // Default: the narrative slides forward (right = forward, left = back).
  return { type: 'slide_context', duration: 0.4, direction: dir };
}
