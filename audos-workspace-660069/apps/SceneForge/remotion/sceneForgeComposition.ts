// THE SCENEFORGE COMPOSITION — props in, renderable TSX out.
//
// The platform's Remotion endpoint compiles ONE standalone TSX string, so the
// composition cannot import anything from this workspace. It is therefore
// generated: the component source lives in ./sceneForgeBody and the props it
// consumes are built here.
//
// ALL STRING PARSING HAPPENS HERE, before the render — the number pulled out
// of a label so it can count up, the date pulled off an event, the icon split
// from a node name, the keyword a highlight should flare. That keeps the
// generated source free of regular expressions (which are easy to corrupt
// when code is assembled as text) and keeps the logic in typed code where it
// can be read and changed safely.
import { displayLabel, parseEvent, parseNumericLabel, splitHighlight, splitIcon } from '../components/visuals/visualTheme';
import type { SceneSpec } from '../lib/sceneSpec';
import { COMPOSITION_BODY } from './sceneForgeBody';

/** The render service is fixed at 1920x1080 / 30fps. */
export const FPS = 30;
export const FRAME_W = 1920;
export const FRAME_H = 1080;
export const DEFAULT_ACCENT = '#4FC3F7';
/** The endpoint accepts 1..18000 frames — 10 minutes at 30fps. */
export const MAX_FRAMES = 18000;

function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `${(value / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export interface CompositionScene {
  scene: number;
  startFrame: number;
  frames: number;
  avatar: SceneSpec['avatar'];
  caption: string;
  visual: Record<string, unknown>;
}

export interface CompositionProps {
  accent: string;
  avatarVideoUrl: string;
  scenes: CompositionScene[];
  totalFrames: number;
}

export interface BuildPropsOptions {
  specs: SceneSpec[];
  avatarVideoUrl?: string;
  accent?: string;
  fps?: number;
}

export function compositionDurationInFrames(specs: SceneSpec[], fps = FPS): number {
  const seconds = specs.reduce((sum, spec) => sum + spec.durationSec, 0);
  return Math.max(30, Math.min(MAX_FRAMES, Math.round(seconds * fps)));
}

/**
 * Turn the director's plan into the flat, pre-parsed props the composition
 * consumes. Scenes are laid end to end on exact frame boundaries so no scene
 * can be a frame short of the next one.
 */
export function buildCompositionProps(options: BuildPropsOptions): CompositionProps {
  const fps = options.fps || FPS;
  const accent = options.accent || DEFAULT_ACCENT;
  let cursor = 0;
  const scenes: CompositionScene[] = options.specs.map((spec) => {
    const frames = Math.max(1, Math.round(spec.durationSec * fps));
    const startFrame = cursor;
    cursor += frames;
    const visual = spec.visual;
    const source = visual.elements.length ? visual.elements : [visual.label || spec.caption || ''];
    const nodes = source.map(splitIcon).map((node) => ({ icon: node.icon, label: displayLabel(node.label) }));
    const points = (visual.dataPoints && visual.dataPoints.length >= 2 ? visual.dataPoints : []).slice(0, 12);
    const unit = parseNumericLabel(visual.label || '');
    const direction = String(visual.direction || '').toLowerCase();
    return {
      scene: spec.scene,
      startFrame,
      frames,
      avatar: spec.avatar,
      caption: spec.caption || '',
      visual: {
        type: visual.type,
        label: visual.label || '',
        sub: displayLabel(visual.elements[1] || ''),
        numeric: parseNumericLabel(visual.label || ''),
        nodes,
        events: source.slice(0, 6).map(parseEvent),
        points,
        valueLabels: points.map((value) => `${unit?.prefix || ''}${compactNumber(value)}`),
        pointLabels: points.map((_, index) => displayLabel(visual.elements[index] || '')),
        asLine: /line|curve|trend|exponential|growth/i.test(String(visual.animation || '')) || points.length > 7,
        highlight: splitHighlight(spec.caption || spec.narration, visual.label || visual.elements[0]),
        imageUrl: visual.imageUrl || '',
        imageCredit: visual.imageCredit || '',
        reversed: /right_to_left|backward|left\b/.test(direction),
        vertical: /top_to_bottom|vertical|down/.test(direction),
        counter: /counter|anti|ccw|right_to_left/.test(direction),
        animationLabel: visual.animation ? displayLabel(String(visual.animation).replace(/_/g, ' ')) : '',
      },
    };
  });
  return { accent, avatarVideoUrl: options.avatarVideoUrl || '', scenes, totalFrames: cursor || fps };
}

/**
 * The composition source. `totalFrames` is baked into
 * `calculateDemoVideoDuration` so the render knows the film's length even if
 * the submit body's `durationInFrames` is ever dropped.
 */
export function createSceneForgeSource(totalFrames: number): string {
  const duration = Math.max(30, Math.min(MAX_FRAMES, Math.round(totalFrames) || 300));
  return [
    "import React from 'react';",
    "import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';",
    '',
    COMPOSITION_BODY,
    '',
    `export const calculateDemoVideoDuration = function () { return ${duration}; };`,
    '',
  ].join('\n');
}
