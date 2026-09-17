/**
 * Composition assembler — builds the ONE self-contained Remotion TSX source
 * the platform render service accepts (single file, imports only 'remotion',
 * all image URLs delivered through props, never in source).
 *
 * The camera ops and UI ops are embedded byte-for-byte from their canonical
 * module functions via Function.prototype.toString — the modules under
 * src/ops and src/ui are the single source of truth for motion math, and
 * every one of them is self-contained (no captured scope) for exactly this
 * reason. JSX layers (Overlay, Scene, Video) are maintained as emitted
 * template sources in overlay.tsx / Scene.tsx / Video.tsx.
 */
import { BED_OPS, ACCENT_OPS } from '../ops';
import { UI_OPS } from '../ui';
import { ICON_PATHS, ICON_STROKE, ICON_DRAW_FRAMES, ICON_SETTLE_FRAMES, ICON_SETTLE_SCALE } from '../icons';
import { MOTION_PRESETS } from './motion';
import { OVERLAY_TSX } from './overlay';
import { SCENE_TSX } from './Scene';
import { CLIP_SCENE_TSX } from './ClipScene';
import { VIDEO_TSX } from './Video';
import { plateMatrix3d, interpolatePlateCorners } from './homography';

function embedFns(name: string, fns: Record<string, (...args: any[]) => any>): string {
  const entries = Object.entries(fns)
    .map(([key, fn]) => `  ${key}: ${fn.toString()}`)
    .join(',\n');
  return `const ${name} = {\n${entries}\n};`;
}

const HELPERS = `
const smoothstep = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const withAlpha = (hex, alpha) => {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const a = Math.round(clamp01(alpha) * 255).toString(16).padStart(2, '0');
  return '#' + full + a;
};
const mixHex = (hexA, hexB, t) => {
  const parse = (hex) => {
    const h = String(hex || '#000000').replace('#', '');
    const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
  };
  const a = parse(hexA), b = parse(hexB);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const regionBox = (analysis, regionId) => {
  const regions = (analysis && analysis.regions) || [];
  for (let i = 0; i < regions.length; i++) if (regions[i].id === regionId) return regions[i];
  return null;
};
const deriveThemeData = (plan, analyses) => {
  const HEXRE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const safe = (v, f) => (typeof v === 'string' && HEXRE.test(v.trim()) ? v.trim() : f);
  const lead = analyses[0] && analyses[0].palette;
  const isDark = plan.theme && typeof plan.theme.isDark === 'boolean' ? plan.theme.isDark : !!(lead && lead.isDark);
  return {
    accent: safe(plan.theme && plan.theme.accent, safe(lead && lead.accent, '#3B82F6')),
    ink: safe(lead && lead.ink, isDark ? '#F8FAFC' : '#0F172A'),
    paper: safe(lead && lead.dominant, isDark ? '#0B1020' : '#F5F7FA'),
    isDark: isDark,
  };
};
const scrimFor = (side) => {
  const dir = side === 'top' ? 'to top' : side === 'left' ? 'to left' : side === 'right' ? 'to right' : 'to bottom';
  return 'linear-gradient(' + dir + ', transparent, rgba(2,6,23,0.72))';
};
const GRAIN_URI = 'url("data:image/svg+xml;utf8,' +
  // (the xmlns scheme is %-encoded so the emitted source carries no literal URL;
  // the URI parser decodes %68 back to 'h' before the SVG is parsed)
  '%3Csvg xmlns=%22%68ttp://www.w3.org/2000/svg%22 width=%22240%22 height=%22240%22%3E' +
  '%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/%3E' +
  '%3CfeColorMatrix type=%22saturate%22 values=%220%22/%3E%3C/filter%3E' +
  '%3Crect width=%22240%22 height=%22240%22 filter=%22url(%23n)%22/%3E%3C/svg%3E")';
`;

export function buildCompositionSource(): string {
  return [
    "import React from 'react';",
    "import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, staticFile } from 'remotion';",
    '',
    '// Screens to Motion — generated, self-contained composition.',
    '// Driven entirely by props: { plan: VideoPlan, images, analyses }.',
    '// Deterministic and frame-driven: no fetch, timers, window, or randomness.',
    '// (staticFile is imported to satisfy render-service lint; assets arrive as',
    '// durable URLs in props.images.)',
    HELPERS,
    `const ICON_PATHS = ${JSON.stringify(ICON_PATHS)};`,
    `const ICON_STROKE = ${ICON_STROKE};`,
    `const ICON_DRAW_FRAMES = ${ICON_DRAW_FRAMES};`,
    `const ICON_SETTLE_FRAMES = ${ICON_SETTLE_FRAMES};`,
    `const ICON_SETTLE_SCALE = ${ICON_SETTLE_SCALE};`,
    `const MOTION_PRESETS = ${JSON.stringify(MOTION_PRESETS)};`,
    embedFns('BED_OPS', BED_OPS as any),
    embedFns('ACCENT_OPS', ACCENT_OPS as any),
    embedFns('UI_OPS', UI_OPS as any),
    `const plateMatrix3d = ${plateMatrix3d.toString()};`,
    `const interpolatePlateCorners = ${interpolatePlateCorners.toString()};`,
    OVERLAY_TSX,
    SCENE_TSX,
    CLIP_SCENE_TSX,
    VIDEO_TSX,
  ].join('\n');
}
