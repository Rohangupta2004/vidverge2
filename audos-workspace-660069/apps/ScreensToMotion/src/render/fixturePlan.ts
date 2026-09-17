/**
 * T1 fixture — a hand-written VideoPlan that exercises the renderer skeleton
 * without any AI stage: three scenes, varied durations, alternating beds,
 * one accent + one UI op, an overlay, and a >= 20-frame final hold.
 * Used by the render smoke test and by the CLI's --fixture mode.
 */
import type { VideoPlan, ScreenAnalysis, IngestedScreen } from '../types';

export const FIXTURE_PLAN: VideoPlan = {
  meta: { title: 'Screens to Motion — fixture', fps: 30, width: 1920, height: 1080 },
  motion: 'snappy',
  theme: { source: 'derived', accent: '#3B82F6', isDark: true },
  ground: { style: 'mesh', from: 'palette', grain: 0.03, vignette: 0.04 },
  scenes: [
    {
      id: 'sc1', screenId: 's1', duration: 150,
      bed: { op: 'push', params: { from: 1.0, to: 1.06, origin: [0.5, 0.42] } },
      accents: [{ op: 'highlight', params: { regionId: 'r-metric', dim: 0.4, style: 'ring' }, from: 40, to: 130 }],
      ui: [{ op: 'countUp', regionId: 'r-metric', params: {}, at: 24, duration: 80 }],
      overlay: { size: 'headline', text: 'Numbers that move themselves', side: 'bottom', icon: 'chart', at: 12 },
    },
    {
      id: 'sc2', screenId: 's2', duration: 210,
      bed: { op: 'deviceTilt', params: { angle: 7, sweepAt: 90 } },
      accents: [{ op: 'callout', params: { regionId: 'r-cta', text: 'One-tap checkout', side: 'right', icon: 'bolt' }, from: 60, to: 200 }],
      ui: [{ op: 'listStagger', regionId: 'r-list', params: { rows: 4 }, at: 30, duration: 90 }],
      overlay: { size: 'caption', text: 'Real rows, re-entering one by one', side: 'top', at: 20 },
    },
    {
      id: 'sc3', screenId: 's1', duration: 180,
      bed: { op: 'pan', params: { fromX: -0.4, toX: 0.4, scale: 1.1 } },
      accents: [],
      ui: [],
      overlay: { size: 'eyebrow', text: 'SCREENS TO MOTION', side: 'bottom', icon: 'spark', at: 30 },
    },
  ],
};

export const FIXTURE_ANALYSES: ScreenAnalysis[] = [
  {
    screenId: 's1', kind: 'dashboard',
    summary: 'Analytics dashboard with one hero metric and a chart.',
    palette: { dominant: '#0B1020', ink: '#F8FAFC', accent: '#3B82F6', isDark: true },
    regions: [
      { id: 'r-metric', role: 'metric', bbox: [0.08, 0.18, 0.22, 0.12], text: '84%', salience: 0.9, plateColor: '#101830' },
      { id: 'r-chart', role: 'media', bbox: [0.38, 0.2, 0.5, 0.42], text: null, salience: 0.7, plateColor: '#0E1526' },
    ],
    scrollable: false,
    safeCrops: [[0.05, 0.12, 0.9, 0.75]],
  },
  {
    screenId: 's2', kind: 'list',
    summary: 'Orders list with a checkout call to action.',
    palette: { dominant: '#0B1020', ink: '#F8FAFC', accent: '#22C55E', isDark: true },
    regions: [
      { id: 'r-list', role: 'row', bbox: [0.1, 0.24, 0.62, 0.5], text: null, salience: 0.8, plateColor: '#101830' },
      { id: 'r-cta', role: 'cta', bbox: [0.76, 0.42, 0.16, 0.09], text: 'Checkout', salience: 0.85, plateColor: '#101830' },
    ],
    scrollable: true,
    safeCrops: [[0.06, 0.18, 0.88, 0.68]],
  },
];

/** Placeholder image descriptors for smoke tests — URLs are substituted by the caller. */
export function fixtureImages(urlA: string, urlB: string): IngestedScreen[] {
  return [
    { screenId: 's1', url: urlA, width: 1920, height: 1080, filename: 'fixture-a.png' },
    { screenId: 's2', url: urlB, width: 1920, height: 1080, filename: 'fixture-b.png' },
  ];
}
