// The cinematic layer of the Motion Graphics Editor.
//
// WHY THIS EXISTS. The editor already had a perfectly good LAYER model — a
// timed stack of text, brand and image layers that the platform compositor
// burns into the MP4. What it did not have was a LOOK: every title was flat
// type with a drop shadow, every lower-third was a dark box, and the only
// entrances were fade and slide. This file is the art direction on top of
// that model.
//
// THE RULE IT FOLLOWS. A preset never becomes a second, parallel rendering
// path. `buildCinematicLayers` compiles the five story fields into ORDINARY
// TextLayer / BrandLayer objects in the same manifest, so the existing
// export pipeline (motionPlates → compileRenderPlan → the composite hook)
// composites them unchanged. What the customer previews is what renders,
// and nothing here can drift away from the exporter.
//
// Atmosphere — film grain, the warm light leak, the black intro fade — is the
// one thing that is NOT a text layer, because it covers the whole frame for
// the whole film. It is described here and rasterised by motionPlates as two
// full-frame plates at export time.
import type { Anim, BrandLayer, BrandKit, TextLayer } from './motionEditor';

export type MotionPresetId = 'cinematic' | 'bold' | 'minimal' | 'neon';

/**
 * Loaded by the editor with one @import. Poppins carries the headings and
 * Inter the body, per the brief; both are also what motionPlates asks the
 * font loader for before it rasterises a plate, so the canvas and the DOM
 * preview draw the same letterforms.
 */
export const GOOGLE_FONTS_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800;900&family=Inter:wght@400;500;600;700;800&display=swap');";

/** Every family a plate may be asked to draw, for `document.fonts.load`. */
export const PRELOAD_FONT_SPECS = ['900 92px Poppins', '800 64px Poppins', '700 48px Poppins', '700 48px Inter', '600 40px Inter', '500 36px Inter'];

export interface MotionPreset {
  id: MotionPresetId;
  name: string;
  blurb: string;
  /** Headings. */
  displayFont: string;
  /** Body copy, lower-third roles, captions. */
  bodyFont: string;
  accent: string;
  textColor: string;
  /** Backdrop behind a lower-third or a plated line. */
  plateFrom: string;
  plateTo: string;
  titleWeight: number;
  titleSizePx: number;
  subtitleSizePx: number;
  titleAnim: Anim;
  bodyAnim: Anim;
  /** Title case treatment — 'upper' sets the headline in capitals. */
  titleCase: 'as-typed' | 'upper';
  letterSpacingEm: number;
  /** 0–1; the brief asks for a 3–5% film grain. */
  grainOpacity: number;
  lightLeak: boolean;
  /** Alignment and vertical anchor of the title block. */
  titleY: number;
  align: TextLayer['align'];
  /** A plated title reads as a card; an unplated one reads as pure type. */
  titlePlate: TextLayer['plate'];
  /** Extra glow under the type, used by Neon. */
  glow: boolean;
}

export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Wide letter-spaced title, warm amber leak, heavy grain. Feels like a trailer card.',
    displayFont: 'Poppins',
    bodyFont: 'Inter',
    accent: '#F97316',
    textColor: '#F8FAFC',
    plateFrom: 'rgba(8,12,20,0.88)',
    plateTo: 'rgba(8,12,20,0.00)',
    titleWeight: 700,
    titleSizePx: 86,
    subtitleSizePx: 44,
    titleAnim: 'clip-reveal',
    bodyAnim: 'fade',
    titleCase: 'upper',
    letterSpacingEm: 0.14,
    grainOpacity: 0.05,
    lightLeak: true,
    titleY: 0.42,
    align: 'center',
    titlePlate: 'none',
    glow: false,
  },
  {
    id: 'bold',
    name: 'Bold',
    blurb: 'Huge stacked headline on a hard accent bar. Built to stop a thumb.',
    displayFont: 'Poppins',
    bodyFont: 'Inter',
    accent: '#F97316',
    textColor: '#FFFFFF',
    plateFrom: '#F97316',
    plateTo: '#EA580C',
    titleWeight: 900,
    titleSizePx: 112,
    subtitleSizePx: 50,
    titleAnim: 'mask-wipe',
    bodyAnim: 'slide-up',
    titleCase: 'upper',
    letterSpacingEm: -0.02,
    grainOpacity: 0.03,
    lightLeak: false,
    titleY: 0.2,
    align: 'left',
    titlePlate: 'bar',
    glow: false,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    blurb: 'Small, quiet type low in the frame. Nothing competes with the presenter.',
    displayFont: 'Inter',
    bodyFont: 'Inter',
    accent: '#E2E8F0',
    textColor: '#F8FAFC',
    plateFrom: 'rgba(8,12,20,0.55)',
    plateTo: 'rgba(8,12,20,0.00)',
    titleWeight: 600,
    titleSizePx: 56,
    subtitleSizePx: 34,
    titleAnim: 'fade',
    bodyAnim: 'fade',
    titleCase: 'as-typed',
    letterSpacingEm: 0.01,
    grainOpacity: 0.03,
    lightLeak: false,
    titleY: 0.76,
    align: 'center',
    titlePlate: 'none',
    glow: false,
  },
  {
    id: 'neon',
    name: 'Neon',
    blurb: 'Electric accent, glowing edges, hard clip reveals. Night-city energy.',
    displayFont: 'Poppins',
    bodyFont: 'Inter',
    accent: '#22D3EE',
    textColor: '#F0FDFF',
    plateFrom: 'rgba(32,22,6,0.86)',
    plateTo: 'rgba(34,211,238,0.18)',
    titleWeight: 800,
    titleSizePx: 94,
    subtitleSizePx: 46,
    titleAnim: 'clip-reveal',
    bodyAnim: 'pop',
    titleCase: 'upper',
    letterSpacingEm: 0.06,
    grainOpacity: 0.04,
    lightLeak: true,
    titleY: 0.3,
    align: 'center',
    titlePlate: 'none',
    glow: true,
  },
];

export function presetOf(id: MotionPresetId | string): MotionPreset {
  return MOTION_PRESETS.find((preset) => preset.id === id) || MOTION_PRESETS[0];
}

// ——— The story spec ———

/**
 * The five fields Otto asked for, plus the look and the timing that apply to
 * all of them. This is what the Cinematic panel edits; `buildCinematicLayers`
 * is the only thing that reads it.
 */
export interface CinematicSpec {
  enabled: boolean;
  preset: MotionPresetId;
  /** Overrides the preset's accent. Default is the brief's warm orange. */
  accent: string;
  title: string;
  subtitle: string;
  lowerThirdName: string;
  lowerThirdRole: string;
  cta: string;
  outro: string;
  /** Seconds before the title card appears, 0–5. */
  entryDelaySec: number;
  /** Seconds each element holds, 1–10. */
  durationSec: number;
  /** Seconds of air left after the outro clears, 0–5. */
  exitDelaySec: number;
  /** Black fade-in into the title card, with a light-leak sweep across it. */
  intro: boolean;
  grain: boolean;
  lightLeak: boolean;
}

export const DEFAULT_ACCENT = '#F97316';

export function defaultCinematicSpec(kit?: Partial<BrandKit>): CinematicSpec {
  return {
    enabled: false,
    preset: 'cinematic',
    accent: DEFAULT_ACCENT,
    title: '',
    subtitle: '',
    lowerThirdName: String(kit?.name || ''),
    lowerThirdRole: 'Founder',
    cta: '',
    outro: '',
    entryDelaySec: 0.6,
    durationSec: 3.2,
    exitDelaySec: 0.8,
    intro: true,
    grain: true,
    lightLeak: true,
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed * 100) / 100));
}
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A spec read back from the database may predate any field below. */
export function normalizeCinematicSpec(raw: unknown, kit?: Partial<BrandKit>): CinematicSpec {
  const base = defaultCinematicSpec(kit);
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Record<string, any>;
  return {
    enabled: Boolean(input.enabled),
    preset: (MOTION_PRESETS.some((preset) => preset.id === input.preset) ? input.preset : base.preset) as MotionPresetId,
    accent: /^#[0-9a-f]{6}$/i.test(String(input.accent || '')) ? String(input.accent) : base.accent,
    title: text(input.title),
    subtitle: text(input.subtitle),
    lowerThirdName: text(input.lowerThirdName, base.lowerThirdName),
    lowerThirdRole: text(input.lowerThirdRole, base.lowerThirdRole),
    cta: text(input.cta),
    outro: text(input.outro),
    entryDelaySec: clamp(input.entryDelaySec, 0, 5, base.entryDelaySec),
    durationSec: clamp(input.durationSec, 1, 10, base.durationSec),
    exitDelaySec: clamp(input.exitDelaySec, 0, 5, base.exitDelaySec),
    intro: input.intro !== false,
    grain: input.grain !== false,
    lightLeak: input.lightLeak !== false,
  };
}

// ——— Atmosphere ———

export interface Atmosphere {
  grainOpacity: number;
  lightLeak: boolean;
  accent: string;
  /** Seconds of black the film fades up from. 0 when the intro is off. */
  introFadeSec: number;
}

/**
 * Tolerates a missing spec on purpose: a manifest persisted before the
 * cinematic block existed reaches the compositor through the same path, and
 * an export must not die on a look the customer never configured.
 */
export function atmosphereOf(spec?: CinematicSpec | null): Atmosphere {
  const safe = spec && typeof spec === 'object' ? spec : defaultCinematicSpec();
  const preset = presetOf(safe.preset);
  const enabled = Boolean(safe.enabled);
  return {
    grainOpacity: enabled && safe.grain ? preset.grainOpacity : 0,
    lightLeak: enabled && safe.lightLeak && preset.lightLeak,
    accent: safe.accent || preset.accent,
    introFadeSec: enabled && safe.intro ? Math.min(1.4, Math.max(0.5, safe.entryDelaySec || 0.6)) : 0,
  };
}

// ——— Compilation ———

function uid(prefix: string, slot: string): string {
  // Deterministic per slot, so recompiling after a field edit REPLACES that
  // element instead of stacking a second copy of it on the timeline.
  return `cine-${prefix}-${slot}`;
}

/** True for a layer this module owns, so a recompile can clear its own work. */
export function isCinematicLayerId(id: string): boolean {
  return String(id || '').startsWith('cine-');
}

export interface CinematicLayers {
  text: TextLayer[];
  brand: BrandLayer[];
}

/**
 * Compile the story fields into real manifest layers.
 *
 * Timing is derived, not asked for field by field: one entry delay, one hold
 * and one exit delay describe the whole sequence, and each element is placed
 * against the film's own length. Everything is clamped inside the video so a
 * long hold on a short master cannot schedule an overlay past the last frame,
 * which the compositor would silently drop.
 */
export function buildCinematicLayers(spec: CinematicSpec, kit: BrandKit, videoDurationSec: number): CinematicLayers {
  const preset = presetOf(spec.preset);
  const accent = spec.accent || preset.accent;
  const film = Math.max(2, Number(videoDurationSec) || 0);
  const hold = Math.max(1, Math.min(10, spec.durationSec));
  const entry = Math.max(0, Math.min(5, spec.entryDelaySec));
  const exit = Math.max(0, Math.min(5, spec.exitDelaySec));

  // Never schedule past the end: `at` clamps a start so the element still
  // gets at least 0.6s on screen inside the film.
  const at = (seconds: number) => Math.max(0, Math.min(Math.max(0, film - 0.6), Math.round(seconds * 100) / 100));
  const fit = (start: number, want: number) => Math.max(0.6, Math.min(want, film - start));

  const textLayers: TextLayer[] = [];
  const brandLayers: BrandLayer[] = [];

  const title = spec.title.trim();
  const subtitle = spec.subtitle.trim();
  const cta = spec.cta.trim();
  const outro = spec.outro.trim();
  const lowerName = spec.lowerThirdName.trim();

  if (title) {
    const start = at(entry);
    textLayers.push({
      id: uid('text', 'title'),
      kind: 'headline',
      start,
      duration: fit(start, hold),
      text: preset.titleCase === 'upper' ? title.toUpperCase() : title,
      font: preset.displayFont,
      sizePx: preset.titleSizePx,
      weight: preset.titleWeight,
      color: preset.textColor,
      align: preset.align,
      x: preset.align === 'left' ? 0.5 : 0.5,
      y: preset.titleY,
      width: 0.86,
      anim: preset.titleAnim,
      plate: preset.titlePlate,
      plateColor: preset.plateFrom,
      plateGradientTo: preset.titlePlate === 'none' ? '' : preset.plateTo,
      trackingEm: preset.letterSpacingEm,
      glow: preset.glow,
    });
  }

  if (subtitle) {
    // 0.35s behind the title: a staggered pair reads as one move, two
    // simultaneous reveals read as a glitch.
    const start = at(entry + 0.35);
    textLayers.push({
      id: uid('text', 'subtitle'),
      kind: 'subheadline',
      start,
      duration: fit(start, hold - 0.35),
      text: subtitle,
      font: preset.bodyFont,
      sizePx: preset.subtitleSizePx,
      weight: 600,
      color: accent,
      align: preset.align,
      x: 0.5,
      y: Math.min(0.92, preset.titleY + 0.11),
      width: 0.8,
      anim: preset.bodyAnim,
      plate: 'none',
      plateColor: preset.plateFrom,
      trackingEm: Math.max(0, preset.letterSpacingEm * 0.4),
      glow: preset.glow,
    });
  }

  if (lowerName) {
    const start = at(entry + hold + 0.5);
    brandLayers.push({
      id: uid('brand', 'lower-third'),
      kind: 'lower-third',
      start,
      duration: fit(start, Math.min(hold, 4.5)),
      corner: 'bottom-left',
      logoUrl: kit.logoUrl,
      scale: 0.18,
      opacity: 1,
      color: preset.textColor,
      accentColor: accent,
      name: lowerName,
      role: spec.lowerThirdRole.trim(),
      // The brief's lower-third: wipes in from the LEFT behind an accent
      // gradient, not a plain box. 'clip-reveal' is the horizontal reveal in
      // both the preview and renderBrandPlate, so the name matches the move.
      anim: 'clip-reveal',
      gradient: true,
    });
  }

  if (cta) {
    // Just past the midpoint, but never before the lower third has cleared.
    const start = at(Math.max(entry + hold + 1.2, film * 0.55));
    textLayers.push({
      id: uid('text', 'cta'),
      kind: 'caption-box',
      start,
      duration: fit(start, Math.min(hold, 4)),
      text: cta,
      font: preset.bodyFont,
      sizePx: Math.round(preset.subtitleSizePx * 0.92),
      weight: 700,
      color: preset.id === 'bold' ? '#0B0F19' : preset.textColor,
      align: 'center',
      x: 0.5,
      y: 0.82,
      width: 0.78,
      anim: 'pop',
      plate: 'pill',
      plateColor: preset.id === 'bold' ? accent : preset.plateFrom,
      plateGradientTo: preset.id === 'bold' ? accent : preset.plateTo,
      glow: preset.glow,
    });
  }

  if (outro) {
    // The last card, held against the END of the film with the exit delay as
    // breathing room after it clears.
    const want = Math.min(hold, Math.max(1.2, film * 0.25));
    const start = at(Math.max(0, film - want - exit));
    textLayers.push({
      id: uid('text', 'outro'),
      kind: 'headline',
      start,
      duration: fit(start, want),
      text: preset.titleCase === 'upper' ? outro.toUpperCase() : outro,
      font: preset.displayFont,
      sizePx: Math.round(preset.titleSizePx * 0.78),
      weight: preset.titleWeight,
      color: preset.textColor,
      align: 'center',
      x: 0.5,
      y: 0.5,
      width: 0.84,
      anim: preset.titleAnim,
      plate: 'none',
      plateColor: preset.plateFrom,
      trackingEm: preset.letterSpacingEm,
      glow: preset.glow,
    });
  }

  return { text: textLayers, brand: brandLayers };
}

/**
 * A one-line account of what the current spec will put on screen and when,
 * so the panel can show the schedule instead of making the customer press
 * Export to find out.
 */
export function describeSchedule(spec: CinematicSpec, kit: BrandKit, videoDurationSec: number): string[] {
  const { text, brand } = buildCinematicLayers(spec, kit, videoDurationSec);
  return [...text, ...brand]
    .sort((a, b) => a.start - b.start)
    .map((layer) => {
      const label = 'text' in layer ? String((layer as TextLayer).text).slice(0, 34) : `${(layer as BrandLayer).name} \u2014 lower third`;
      return `${layer.start.toFixed(1)}s \u2192 ${(layer.start + layer.duration).toFixed(1)}s \u00b7 ${label}`;
    });
}

/**
 * The downloadable overlay spec. Otto's brief allows the export to be "the
 * MP4 plus an overlay spec JSON"; this is that JSON, and it is also the
 * honest record of what the compositor was asked to burn in.
 */
export function overlaySpecJson(spec: CinematicSpec, kit: BrandKit, videoDurationSec: number, aspectRatio: string): string {
  const preset = presetOf(spec.preset);
  const { text, brand } = buildCinematicLayers(spec, kit, videoDurationSec);
  return JSON.stringify({
    generator: 'SceneForge Motion Graphics Editor',
    version: 1,
    aspectRatio,
    durationSec: Math.round(videoDurationSec * 100) / 100,
    preset: { id: preset.id, name: preset.name, displayFont: preset.displayFont, bodyFont: preset.bodyFont },
    accent: spec.accent || preset.accent,
    atmosphere: atmosphereOf(spec),
    timing: { entryDelaySec: spec.entryDelaySec, durationSec: spec.durationSec, exitDelaySec: spec.exitDelaySec },
    elements: [...text, ...brand].sort((a, b) => a.start - b.start),
  }, null, 2);
}
