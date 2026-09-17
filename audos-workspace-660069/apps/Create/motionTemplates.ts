/**
 * VidVerge — MOTION UI: the built-in Motion Studio TEMPLATES.
 *
 * These power the premium split-layout showcase on the Motion UI landing
 * (MotionTemplateShowcase.tsx): a two-column preview — an animated headline and
 * one-line explanation on the left, a cropped product screenshot presented as a
 * simulated browser window on the right, with an animated cursor tracing a path
 * over the UI. Each template is a self-contained slide the showcase cycles
 * through and the mini-editor can tweak live.
 *
 * KEEP IT ADDITIVE / DATA-ONLY. A template is a plain description of a slide —
 * copy, colors, a screenshot URL and a cursor path. It carries no behaviour and
 * is never rendered into the final Remotion video, so it is safe to extend with
 * new optional fields without touching the Motion Plan schema, the runtime math
 * (motionUiRuntime.ts) or the render composition (motionUiComposition.ts).
 */

/**
 * A single cursor waypoint, in coordinates RELATIVE to the screenshot frame:
 * x/y are 0..1 (0,0 = top-left, 1,1 = bottom-right) and durationMs is how long
 * the cursor takes to glide to this point from the previous one. A short
 * durationMs with the same x/y as the previous point reads as a "pause".
 */
export interface CursorWaypoint {
  x: number;
  y: number;
  durationMs: number;
}

/** One Motion Studio template slide. */
export interface MotionTemplate {
  id: string;
  name: string;
  /** Bold left-column headline. */
  headline: string;
  /** Smaller left-column explanation under the headline. */
  subline: string;
  /** Accent color, e.g. '#7C3AED'. Drives the pill, cursor glow and highlights. */
  accentColor: string;
  /** Cropped product screenshot shown in the right column. */
  screenshot: string;
  /** The cursor path for this slide, relative 0..1 coords. */
  cursorWaypoints: CursorWaypoint[];
  /** Dark background hex for the slide. */
  bgColor: string;
}

const SHOTS = 'https://storage.googleapis.com/audos-images/generated-images/agent/workspace-660069';

/**
 * THE BUILT-IN TEMPLATES. VidVerge is purple-forward, so the flagship slide
 * leads with the brand purple; the others fan out into amber, teal and rose so
 * the showcase reads as a range of looks rather than one repeated card.
 */
export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: 'brief_to_video',
    name: 'Brief to Video',
    headline: 'Paste a URL. Get a video.',
    subline: 'Drop a product link and watch VidVerge write, shoot and cut it — no timeline wrangling.',
    accentColor: '#7C3AED',
    screenshot: `${SHOTS}/img-1788427241801-fnlby9.png`,
    bgColor: '#0B0F1E',
    cursorWaypoints: [
      { x: 0.18, y: 0.5, durationMs: 0 },
      { x: 0.44, y: 0.22, durationMs: 900 },
      { x: 0.44, y: 0.22, durationMs: 220 },
      { x: 0.78, y: 0.3, durationMs: 1000 },
      { x: 0.62, y: 0.68, durationMs: 900 },
      { x: 0.3, y: 0.6, durationMs: 850 },
    ],
  },
  {
    id: 'consistent_characters',
    name: 'Consistent Characters',
    headline: 'Same face. Every scene.',
    subline: 'Lock a character once and VidVerge keeps them consistent across every shot and lighting change.',
    accentColor: '#F59E0B',
    screenshot: `${SHOTS}/img-1788427263434-8lzeu3.png`,
    bgColor: '#100B04',
    cursorWaypoints: [
      { x: 0.16, y: 0.4, durationMs: 0 },
      { x: 0.32, y: 0.35, durationMs: 800 },
      { x: 0.32, y: 0.35, durationMs: 220 },
      { x: 0.58, y: 0.45, durationMs: 900 },
      { x: 0.8, y: 0.55, durationMs: 850 },
      { x: 0.5, y: 0.7, durationMs: 900 },
    ],
  },
  {
    id: 'one_pipeline',
    name: 'One Pipeline',
    headline: 'Script. Generate. Download.',
    subline: 'One connected pipeline takes your idea from words to a finished, downloadable clip.',
    accentColor: '#14B8A6',
    screenshot: `${SHOTS}/img-1788427285093-ofekql.png`,
    bgColor: '#04100E',
    cursorWaypoints: [
      { x: 0.2, y: 0.45, durationMs: 0 },
      { x: 0.2, y: 0.45, durationMs: 220 },
      { x: 0.5, y: 0.45, durationMs: 950 },
      { x: 0.5, y: 0.45, durationMs: 220 },
      { x: 0.8, y: 0.45, durationMs: 950 },
      { x: 0.8, y: 0.45, durationMs: 240 },
    ],
  },
  {
    id: 'creator_speed',
    name: 'Creator Speed',
    headline: '60-second video in 60 seconds.',
    subline: 'From blank canvas to a share-ready video in about a minute — built for creators who ship daily.',
    accentColor: '#F43F5E',
    screenshot: `${SHOTS}/img-1788427303529-d24nt3.png`,
    bgColor: '#12070B',
    cursorWaypoints: [
      { x: 0.22, y: 0.6, durationMs: 0 },
      { x: 0.5, y: 0.4, durationMs: 850 },
      { x: 0.5, y: 0.4, durationMs: 220 },
      { x: 0.5, y: 0.78, durationMs: 800 },
      { x: 0.72, y: 0.78, durationMs: 700 },
      { x: 0.3, y: 0.7, durationMs: 800 },
    ],
  },
];

export function motionTemplateById(id: string): MotionTemplate {
  return MOTION_TEMPLATES.find((t) => t.id === id) || MOTION_TEMPLATES[0];
}
