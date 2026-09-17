/**
 * VidVerge — MOTION UI: presets, aspect ratios, durations and visual styles.
 *
 * A PRESET is a bundle of motion defaults — typography behaviour, camera
 * behaviour, transition style, background treatment, animation density and
 * easing. The AI Motion Director is handed the selected preset's guidance and
 * bakes it into the Motion Plan; the deterministic fallback reads the same
 * numbers so a plan is always coherent even with no model available.
 *
 * These are additive knobs, not templates: the flagship "Product Launch" preset
 * suggests a beat STRUCTURE, but the Director adapts timing to the actual
 * product and asset count rather than forcing a fixed length.
 */
import type { Easing, MotionAspect, MotionBackground } from './motionUiTypes';

export interface MotionPreset {
  id: string;
  name: string;
  blurb: string;
  /** Director-facing sentence describing the look, injected into the prompt. */
  guidance: string;
  /** 0..1 — how busy the graphics / how many text cues. */
  density: number;
  /** How far the camera travels overall. */
  cameraEnergy: 'calm' | 'medium' | 'bold';
  easing: Easing;
  /** Default background treatment for this preset. */
  background: MotionBackground['type'];
  backgroundAnimation: MotionBackground['animation'];
  /** Preferred text animation family. */
  textAnimation: 'fade' | 'slide_up' | 'word_reveal' | 'char_reveal' | 'tracking_expand' | 'scale_reveal';
  /** A default two-color palette used when no brand colors are detected. */
  palette: { primary: string; secondary: string; background: string; text: string; accent: string };
}

export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: 'premium_saas',
    name: 'Premium SaaS',
    blurb: 'Clean, confident, blue-forward product motion.',
    guidance:
      'Premium SaaS: restrained, confident motion. Long slow camera pushes and lateral pans between UI screens, ' +
      'generous negative space, crisp headline typography that slides up, subtle depth and soft shadows.',
    density: 0.5,
    cameraEnergy: 'medium',
    easing: 'smooth',
    background: 'gradient',
    backgroundAnimation: 'slow_drift',
    textAnimation: 'slide_up',
    palette: { primary: '#2563eb', secondary: '#60a5fa', background: '#0A0F1E', text: '#F8FAFC', accent: '#2dd4bf' },
  },
  {
    id: 'futuristic',
    name: 'Futuristic',
    blurb: 'Neon rings, grids and light beams.',
    guidance:
      'Futuristic: energetic camera with orbits and scale changes, glowing rings and grid lines, light beams ' +
      'sweeping the background, tracking-expanded headlines, high contrast neon accents.',
    density: 0.85,
    cameraEnergy: 'bold',
    easing: 'ease_out',
    background: 'mesh',
    backgroundAnimation: 'pan',
    textAnimation: 'tracking_expand',
    palette: { primary: '#7c3aed', secondary: '#22d3ee', background: '#05060f', text: '#F8FAFC', accent: '#22d3ee' },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    blurb: 'Almost still. Type and one screen at a time.',
    guidance:
      'Minimal: very calm motion, one UI on screen at a time, tiny camera drift only, monochrome background, ' +
      'a single clean headline per beat that fades. Restraint over spectacle.',
    density: 0.2,
    cameraEnergy: 'calm',
    easing: 'smooth',
    background: 'solid',
    backgroundAnimation: 'none',
    textAnimation: 'fade',
    palette: { primary: '#111827', secondary: '#6b7280', background: '#0b0b0d', text: '#f5f5f7', accent: '#9ca3af' },
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Deep focus, filmic pushes, dramatic reveals.',
    guidance:
      'Cinematic: deliberate, dramatic camera pushes and pull-backs, deep shadows and vignetting, spotlight ' +
      'background, mask-revealed headlines with wide tracking, slow confident pacing.',
    density: 0.45,
    cameraEnergy: 'bold',
    easing: 'ease_in',
    background: 'spotlight',
    backgroundAnimation: 'pulse',
    textAnimation: 'scale_reveal',
    palette: { primary: '#0ea5e9', secondary: '#f59e0b', background: '#07080c', text: '#fafafa', accent: '#f59e0b' },
  },
  {
    id: 'energetic',
    name: 'Energetic',
    blurb: 'Fast cuts, punchy word reveals, lots of motion.',
    guidance:
      'Energetic: quick, snappy transitions, springy entrances, word-by-word headline reveals, bright saturated ' +
      'palette, particles and quick camera whips between screens. High animation density.',
    density: 0.95,
    cameraEnergy: 'bold',
    easing: 'spring',
    background: 'gradient',
    backgroundAnimation: 'pan',
    textAnimation: 'word_reveal',
    palette: { primary: '#ec4899', secondary: '#f97316', background: '#0c0713', text: '#ffffff', accent: '#f97316' },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    blurb: 'Type-led, magazine composition, calm grids.',
    guidance:
      'Editorial: typography leads, large headlines that word-reveal, off-centre asymmetric composition, thin ' +
      'ruled lines, muted paper-like palette, gentle horizontal camera pans. Type is the hero, UI supports it.',
    density: 0.4,
    cameraEnergy: 'calm',
    easing: 'ease_out',
    background: 'solid',
    backgroundAnimation: 'none',
    textAnimation: 'word_reveal',
    palette: { primary: '#1f2937', secondary: '#b45309', background: '#111014', text: '#f4f1ea', accent: '#b45309' },
  },
  {
    id: 'dark_tech',
    name: 'Dark Tech',
    blurb: 'Near-black, dot matrix, cold precise motion.',
    guidance:
      'Dark Tech: near-black background, faint dot-matrix and grid, cold precise camera moves that lock onto UI ' +
      'detail, mono/technical headline type, thin accent lines and a single cool accent color.',
    density: 0.6,
    cameraEnergy: 'medium',
    easing: 'smooth',
    background: 'mesh',
    backgroundAnimation: 'slow_drift',
    textAnimation: 'char_reveal',
    palette: { primary: '#22c55e', secondary: '#334155', background: '#04060a', text: '#e2e8f0', accent: '#22c55e' },
  },
  {
    id: 'clean_launch',
    name: 'Clean Product Launch',
    blurb: 'Bright, friendly, approachable launch energy.',
    guidance:
      'Clean Product Launch: bright airy background, friendly rounded framing around UI, soft floating cards, ' +
      'clear slide-up headlines, gentle springy camera pushes. Approachable and optimistic.',
    density: 0.55,
    cameraEnergy: 'medium',
    easing: 'spring',
    background: 'gradient',
    backgroundAnimation: 'slow_drift',
    textAnimation: 'slide_up',
    palette: { primary: '#2563eb', secondary: '#38bdf8', background: '#0b1220', text: '#f8fafc', accent: '#38bdf8' },
  },
];

export const DEFAULT_PRESET_ID = 'premium_saas';

export function getPreset(id: string): MotionPreset {
  return MOTION_PRESETS.find((p) => p.id === id) || MOTION_PRESETS[0];
}

/**
 * THE FLAGSHIP "PRODUCT LAUNCH" beat structure. An EXAMPLE arc the Director may
 * follow and stretch/compress to the real product and asset count — never a
 * fixed template. Handed to the Director as guidance for the premium presets.
 */
export const PRODUCT_LAUNCH_ARC = [
  'Brand introduction / problem statement',
  'First UI screenshot enters',
  'Camera moves through the first UI, highlighting a detail',
  'A second feature / UI appears, connected by a continuous camera move',
  'Multiple UI cards compose together in the same world',
  'Workspace / product overview — the camera pulls back to show the whole',
  'A feature / value-proposition headline',
  'Product + call to action',
  'Final brand / slogan frame',
].join(' → ');

// ---------------------------------------------------------------------------
// Aspect ratios and durations
// ---------------------------------------------------------------------------
export interface AspectOption {
  id: MotionAspect;
  label: string;
  /** Ratio w/h for the safe frame inside the fixed 1920×1080 render canvas. */
  ratio: number;
}

export const MOTION_ASPECTS: AspectOption[] = [
  { id: '16:9', label: '16:9 · Landscape', ratio: 16 / 9 },
  { id: '9:16', label: '9:16 · Vertical', ratio: 9 / 16 },
  { id: '1:1', label: '1:1 · Square', ratio: 1 },
];

export function aspectRatioValue(aspect: MotionAspect): number {
  return MOTION_ASPECTS.find((a) => a.id === aspect)?.ratio || 16 / 9;
}

export interface DurationOption {
  id: string;
  label: string;
  seconds: number;
}

export const MOTION_DURATIONS: DurationOption[] = [
  { id: 'd10', label: '10s', seconds: 10 },
  { id: 'd15', label: '15s', seconds: 15 },
  { id: 'd20', label: '20s', seconds: 20 },
  { id: 'd30', label: '30s', seconds: 30 },
];

/** Min/max custom duration the engine will plan. */
export const MIN_DURATION = 5;
export const MAX_DURATION = 60;

// ---------------------------------------------------------------------------
// Visual style words (a light layer on top of the preset)
// ---------------------------------------------------------------------------
export const MOTION_STYLES = [
  'Sleek',
  'Bold',
  'Playful',
  'Elegant',
  'Technical',
  'Warm',
] as const;

export type MotionStyleWord = (typeof MOTION_STYLES)[number];
