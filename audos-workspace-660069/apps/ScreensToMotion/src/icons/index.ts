/**
 * The 20-icon stroke set. 24px grid, 1.8px strokes, round caps and joins,
 * scaled only by whole multiples of 24.
 *
 * DRAW-ON ENTRANCE: stroke-dashoffset animates full → zero over 14 frames,
 * then a 6-frame settle at 1.03 scale. Fills (none of these paths fill, but
 * a badge circle behind one may) fade in over the last 40% of the draw.
 * An icon enters ONE STAGGER STEP BEFORE its label, never sits on interface
 * pixels, appears at most once per callout, and is coloured with the theme
 * accent or ink at 60%.
 */
export const ICON_GRID = 24;
export const ICON_STROKE = 1.8;
export const ICON_DRAW_FRAMES = 14;
export const ICON_SETTLE_FRAMES = 6;
export const ICON_SETTLE_SCALE = 1.03;

/** name → SVG path data on the 24px grid (stroke only, round caps/joins). */
export const ICON_PATHS: Record<string, string> = {
  check: 'M5 12.5l4.5 4.5L19 7',
  arrow: 'M4 12h16M13 5l7 7-7 7',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18',
  bolt: 'M13 3L5 13.5h6L11 21l8-10.5h-6L13 3z',
  shield: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z',
  lock: 'M6 11h12v9H6v-9zM9 11V8a3 3 0 0 1 6 0v3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3M20 16V6',
  users: 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3 2.5-5 6-5s6 2 6 5M16 5.5a3.5 3.5 0 0 1 0 6.5M17.5 15.2c2.1.6 3.5 2.2 3.5 4.8',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21',
  bell: 'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z',
  plus: 'M12 5v14M5 12h14',
  filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5z',
  sync: 'M20 6v5h-5M4 18v-5h5M19.5 11a8 8 0 0 0-14-4.5M4.5 13a8 8 0 0 0 14 4.5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z',
  doc: 'M7 3h7l4 4v14H7V3zM14 3v4h4M10 12h5M10 16h5',
  card: 'M3 6h18v12H3V6zM3 10h18M6 15h4',
  flag: 'M5 21V4M5 5c4-2 7 2 14 0v9c-7 2-10-2-14 0',
  seal: 'M12 3l2.2 2 3-.4 1 2.8 2.8 1-.4 3 2 2.2-2 2.2.4 3-2.8 1-1 2.8-3-.4-2.2 2-2.2-2-3 .4-1-2.8-2.8-1 .4-3-2-2.2 2-2.2-.4-3 2.8-1 1-2.8 3 .4L12 3zM9.5 12.5l2 2 3.5-4',
};

export const ICON_NAMES = Object.keys(ICON_PATHS);
