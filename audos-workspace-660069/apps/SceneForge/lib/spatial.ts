// SPATIAL AWARENESS SYSTEM — layout zones, face safety and collision
// avoidance for directed scenes. Every directed layer names a ZoneId; this
// module resolves those zones into concrete pixel rects for the frame being
// rendered, keeps graphics off the presenter's face band when the presenter
// stays visible, enforces the 5% typography safe margin, and AUTO-SHIFTS any
// layer that would collide with an already-placed layer to the nearest free
// zone — logging every adjustment instead of fixing things silently.

import type { DirectedLayer, ZoneId } from './visualTimeline';

export interface FracRect { x: number; y: number; w: number; h: number }
export interface PlacedLayer { layer: DirectedLayer; rect: FracRect; zone: ZoneId }
export interface PlacementResult { placed: PlacedLayer[]; adjustments: string[] }

// Zone maps (fractions of the frame). 9:16 follows the vertical/mobile chart:
// TOP 0–15% headline/logo · UPPER CENTER 15–35% · CENTER 35–65% dominant
// visual · LOWER CENTER 65–80% supporting/callout · BOTTOM SAFE 80–95%
// captions only · 95–100% never used (device navigation).
const PORTRAIT_ZONES: Record<ZoneId, FracRect> = {
  top: { x: 0.05, y: 0.03, w: 0.9, h: 0.12 },
  upper: { x: 0.05, y: 0.16, w: 0.9, h: 0.18 },
  center: { x: 0.05, y: 0.36, w: 0.9, h: 0.28 },
  lower: { x: 0.05, y: 0.66, w: 0.9, h: 0.13 },
  bottom_safe: { x: 0.07, y: 0.81, w: 0.86, h: 0.12 },
  left: { x: 0.05, y: 0.4, w: 0.42, h: 0.32 },
  right: { x: 0.53, y: 0.4, w: 0.42, h: 0.32 },
  full: { x: 0.05, y: 0.05, w: 0.9, h: 0.88 },
};

// 16:9: LEFT text/diagrams/callouts · CENTER main visual · RIGHT supporting
// stats/secondary visual · BOTTOM captions. Top band carries the headline.
const LANDSCAPE_ZONES: Record<ZoneId, FracRect> = {
  top: { x: 0.08, y: 0.05, w: 0.84, h: 0.14 },
  upper: { x: 0.08, y: 0.2, w: 0.84, h: 0.16 },
  center: { x: 0.28, y: 0.22, w: 0.44, h: 0.56 },
  lower: { x: 0.28, y: 0.72, w: 0.44, h: 0.14 },
  bottom_safe: { x: 0.2, y: 0.86, w: 0.6, h: 0.09 },
  left: { x: 0.05, y: 0.22, w: 0.24, h: 0.56 },
  right: { x: 0.71, y: 0.22, w: 0.24, h: 0.56 },
  full: { x: 0.05, y: 0.06, w: 0.9, h: 0.86 },
};

/** Where a centered talking head keeps its face — graphics that ride OVER the
 * visible presenter must never intersect this band. */
export const FACE_BAND: { portrait: FracRect; landscape: FracRect } = {
  portrait: { x: 0.22, y: 0.08, w: 0.56, h: 0.3 },
  landscape: { x: 0.32, y: 0.06, w: 0.36, h: 0.52 },
};

/** Minimum edge margin for anything carrying text (the 5% rule). */
export const SAFE_MARGIN = 0.05;

export function zoneRect(zone: ZoneId, portrait: boolean): FracRect {
  const table = portrait ? PORTRAIT_ZONES : LANDSCAPE_ZONES;
  return { ...(table[zone] || table.center) };
}

export function rectsOverlap(a: FracRect, b: FracRect, tolerance = 0.005): boolean {
  return a.x < b.x + b.w - tolerance && a.x + a.w > b.x + tolerance && a.y < b.y + b.h - tolerance && a.y + a.h > b.y + tolerance;
}

function clampToSafeMargins(rect: FracRect): FracRect {
  const w = Math.min(rect.w, 1 - SAFE_MARGIN * 2);
  const h = Math.min(rect.h, 1 - SAFE_MARGIN * 2);
  return {
    x: Math.min(1 - SAFE_MARGIN - w, Math.max(SAFE_MARGIN, rect.x)),
    y: Math.min(1 - SAFE_MARGIN - h, Math.max(SAFE_MARGIN, rect.y)),
    w, h,
  };
}

// The shift order tried when a zone is occupied or face-blocked: nearest
// visually sensible alternatives first, caption strip only for captions.
const SHIFT_ORDER: Record<ZoneId, ZoneId[]> = {
  top: ['upper', 'left', 'right'],
  upper: ['top', 'left', 'right', 'lower'],
  center: ['lower', 'upper', 'left', 'right'],
  lower: ['upper', 'left', 'right', 'center'],
  bottom_safe: ['lower'],
  left: ['right', 'lower', 'upper'],
  right: ['left', 'lower', 'upper'],
  full: ['center'],
};

/**
 * Resolve every directed layer's zone into a collision-free rect.
 *  - Layers place in zIndex order (background first); background and 'full'
 *    layers never block others.
 *  - When `avoidFace` is set (the presenter stays visible under the graphic),
 *    a layer whose zone intersects the face band is auto-shifted.
 *  - A layer colliding with an already-placed non-background layer is shifted
 *    to the nearest free zone; when nothing is free its rect is shrunk inside
 *    its own zone instead of overlapping.
 * Every adjustment is logged into the result so the director timeline records
 * what the spatial system changed.
 */
export function resolvePlacements(layers: DirectedLayer[], options: { portrait: boolean; avoidFace?: boolean }): PlacementResult {
  const { portrait, avoidFace } = options;
  const face = portrait ? FACE_BAND.portrait : FACE_BAND.landscape;
  const adjustments: string[] = [];
  const placed: PlacedLayer[] = [];
  const occupied: FracRect[] = [];
  const ordered = [...layers].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  ordered.forEach((layer) => {
    const passthrough = layer.role === 'background' || layer.zone === 'full';
    let zone = layer.zone;
    let rect = clampToSafeMargins(zoneRect(zone, portrait));
    if (!passthrough) {
      const blocked = (candidate: FracRect) => (avoidFace && rectsOverlap(candidate, face)) || occupied.some((existing) => rectsOverlap(candidate, existing));
      if (blocked(rect)) {
        const alternatives = (SHIFT_ORDER[zone] || ['lower']).filter((candidate) => candidate !== 'bottom_safe' || layer.role === 'caption');
        const free = alternatives.find((candidate) => !blocked(clampToSafeMargins(zoneRect(candidate, portrait))));
        if (free) {
          adjustments.push(`Layer "${layer.id}" (${layer.type}) auto-shifted ${zone} → ${free}: ${avoidFace && rectsOverlap(rect, face) ? 'it would cover the presenter\'s face band' : 'it collided with another layer'}.`);
          zone = free;
          rect = clampToSafeMargins(zoneRect(free, portrait));
        } else {
          // Nothing free: shrink in place rather than overlap or cover a face.
          const shrunk: FracRect = { x: rect.x + rect.w * 0.18, y: rect.y + rect.h * 0.18, w: rect.w * 0.64, h: rect.h * 0.64 };
          adjustments.push(`Layer "${layer.id}" (${layer.type}) shrunk inside ${zone}: every alternative zone was occupied.`);
          rect = shrunk;
        }
      }
      occupied.push(rect);
    }
    placed.push({ layer, rect, zone });
  });
  return { placed, adjustments };
}

/** Fraction rect → pixel rect for the frame being rendered. */
export function toPixels(rect: FracRect, width: number, height: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(rect.x * width), y: Math.round(rect.y * height), w: Math.round(rect.w * width), h: Math.round(rect.h * height) };
}
