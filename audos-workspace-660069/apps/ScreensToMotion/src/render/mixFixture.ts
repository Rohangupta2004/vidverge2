/**
 * T6 fixture — the Phase 2 "done when": a mixed composition with TWO clips,
 * FOUR screenshots and ONE music bed, cut on a 96bpm beat grid, with motion
 * carry at every footage boundary, one blank-plate corner pin, and a ducked
 * presenter-style clip. buildMixFixture() quantises itself through the same
 * applyBeatGrid/settleUiOnBeats passes production plans use, and
 * verifyMixFixture() asserts the acceptance criteria that are checkable
 * without a render:
 *   - every cut within ±1 frame of a beat
 *   - integer source-frame step per composition frame on every clip (0 judder)
 *   - every clip scene fits inside its trim (never looped)
 *   - out.carry present at every footage boundary
 *   - plate keyframes within 2–4
 * The gate acceptance test (a clip deliberately containing visible UI is
 * rejected) is runGateSelfTest in ../clips/gate — it needs a real clip URL.
 */
import { applyBeatGrid, settleUiOnBeats, checkBeatAlignment } from '../sync/grid';
import { conformClips, availableCompFrames, COMPOSITION_FPS } from '../clips/conform';
import { validateAndRepairPlan } from '../plan/validate';
import type { VideoPlan, ScreenAnalysis, IngestedScreen, IngestedClip, CompositionProps, ClipSceneSpec } from '../types';

export interface MixFixtureInput {
  /** Four screenshot URLs (1920x1080 or larger). */
  screenUrls: [string, string, string, string];
  /** Two clip descriptors — use the TRUE probed values for real URLs. */
  clipA: { url: string; fps: number; durationSeconds: number; width: number; height: number };
  clipB: { url: string; fps: number; durationSeconds: number; width: number; height: number };
  musicUrl: string;
}

// s3 carries the highest salience so the strongest screenshot lands 60–70%
// through the video (the rhythm rule the validator enforces).
const SCREEN_META = [
  { kind: 'dashboard', accent: '#3B82F6', salience: 0.6 },
  { kind: 'list', accent: '#22C55E', salience: 0.65 },
  { kind: 'detail', accent: '#8B5CF6', salience: 0.9 },
  { kind: 'marketing', accent: '#F59E0B', salience: 0.7 },
] as const;

export function buildMixFixture(input: MixFixtureInput): CompositionProps {
  const images: IngestedScreen[] = input.screenUrls.map((url, i) => ({
    screenId: `s${i + 1}`, url, width: 1920, height: 1080, filename: `fixture-s${i + 1}.png`,
  }));
  const analyses: ScreenAnalysis[] = images.map((img, i) => ({
    screenId: img.screenId,
    kind: SCREEN_META[i].kind as ScreenAnalysis['kind'],
    summary: `Fixture screen ${i + 1}.`,
    palette: { dominant: '#0B1020', ink: '#F8FAFC', accent: SCREEN_META[i].accent, isDark: true },
    regions: [
      { id: `r${i + 1}-metric`, role: 'metric', bbox: [0.08, 0.18, 0.22, 0.12], text: '84%', salience: SCREEN_META[i].salience, plateColor: '#101830' },
      { id: `r${i + 1}-list`, role: 'row', bbox: [0.4, 0.24, 0.5, 0.5], text: null, salience: 0.55, plateColor: '#101830' },
    ],
    scrollable: i === 1,
    safeCrops: [[0.05, 0.12, 0.9, 0.75]],
  }));

  const clips: IngestedClip[] = [
    { clipId: 'c1', url: input.clipA.url, width: input.clipA.width, height: input.clipA.height, fps: input.clipA.fps, durationSeconds: input.clipA.durationSeconds, source: 'veo', filename: 'fixture-atmosphere.mp4', playbackRate: 1, stats: null },
    { clipId: 'c2', url: input.clipB.url, width: input.clipB.width, height: input.clipB.height, fps: input.clipB.fps, durationSeconds: input.clipB.durationSeconds, source: 'heygen', filename: 'fixture-presenter.mp4', playbackRate: 1, stats: null },
  ];
  conformClips(clips);

  // Trims leave headroom beyond the planned scene length: bar alignment may
  // extend a clip scene by up to half a bar, and re-timed sources (24/25fps)
  // yield fewer composition frames per second of trim.
  const trimA: [number, number] = [0.4, Math.min(input.clipA.durationSeconds, 6.0)];
  const trimB: [number, number] = [0.2, Math.min(input.clipB.durationSeconds, 7.0)];

  const plan: VideoPlan = {
    meta: { title: 'Screens to Motion — mixed fixture', fps: 30, width: 1920, height: 1080 },
    motion: 'snappy',
    theme: { source: 'derived', accent: '#3B82F6', isDark: true },
    ground: { style: 'mesh', from: 'palette', grain: 0.03, vignette: 0.04 },
    sync: { bpm: 96, offsetMs: 120, snap: 'beat', landOn: 'settle' },
    music: { url: input.musicUrl },
    scenes: [
      {
        id: 'sc0', kind: 'clip', src: 'c1', duration: 75, trim: trimA, grade: 'auto', audio: 'strip',
        overlay: { size: 'headline', text: 'Every release, one view', side: 'bottom', at: 8 },
        out: { carry: 'left' },
      },
      {
        id: 'sc1', screenId: 's1', duration: 150,
        bed: { op: 'push', params: { from: 1.0, to: 1.06, origin: [0.5, 0.42] } },
        accents: [{ op: 'highlight', params: { regionId: 'r1-metric', dim: 0.4, style: 'ring' }, from: 30, to: 120 }],
        ui: [{ op: 'countUp', regionId: 'r1-metric', params: {}, at: 24, duration: 60 }],
        overlay: { size: 'caption', text: 'Real numbers, straight from the product', side: 'top', at: 14 },
        out: { carry: 'in' },
      },
      {
        id: 'sc2', kind: 'clip', src: 'c2', duration: 120, trim: trimB, grade: 'auto', audio: 'duck',
        plate: {
          screenId: 's3',
          corners: [
            { at: 0, tl: [0.31, 0.22], tr: [0.68, 0.25], br: [0.66, 0.61], bl: [0.29, 0.58] },
            { at: 48, tl: [0.33, 0.21], tr: [0.7, 0.24], br: [0.68, 0.6], bl: [0.31, 0.57] },
          ],
          blur: 1.4, glow: 0.18, reflection: 0.06,
        },
        out: { carry: 'right' },
      },
      {
        id: 'sc3', screenId: 's2', duration: 165,
        bed: { op: 'scrollSim', params: {} },
        accents: [],
        ui: [{ op: 'listStagger', regionId: 'r2-list', params: { rows: 4 }, at: 20, duration: 70 }],
        overlay: null,
      },
      {
        id: 'sc4', screenId: 's3', duration: 135,
        bed: { op: 'pan', params: { fromX: -0.4, toX: 0.4, scale: 1.1 } },
        accents: [{ op: 'callout', params: { regionId: 'r3-metric', text: 'One-tap sync', side: 'right', icon: 'bolt' }, from: 40, to: 120 }],
        ui: [],
        overlay: null,
      },
      {
        id: 'sc5', screenId: 's4', duration: 160,
        bed: { op: 'push', params: { from: 1.04, to: 1.0, origin: [0.5, 0.5] } },
        accents: [],
        ui: [],
        overlay: { size: 'eyebrow', text: 'SCREENS TO MOTION', side: 'bottom', icon: 'spark', at: 24 },
      },
    ],
  };

  applyBeatGrid(plan, COMPOSITION_FPS);
  settleUiOnBeats(plan, COMPOSITION_FPS);
  return { plan, images, analyses, clips };
}

export interface MixVerification { ok: boolean; failures: string[]; }

/** Assert the render-independent Phase 2 acceptance criteria on any mix props. */
export function verifyMixFixture(props: CompositionProps): MixVerification {
  const failures: string[] = [];
  const { plan, analyses, clips = [] } = props;
  const clipsById = new Map(clips.map((c) => [c.clipId, c] as const));

  for (const issue of checkBeatAlignment(plan, COMPOSITION_FPS)) {
    failures.push(`beat: [${issue.scene}] ${issue.message}`);
  }
  for (const clip of clips) {
    const step = (clip.playbackRate / COMPOSITION_FPS) * clip.fps;
    if (Math.abs(step - Math.round(step)) > 0.005 || Math.round(step) < 1) {
      failures.push(`judder: clip ${clip.clipId} steps ${step.toFixed(4)} source frames per composition frame — must be a whole number`);
    }
  }
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i] as ClipSceneSpec;
    if (scene.kind !== 'clip') continue;
    const clip = clipsById.get(scene.src);
    if (!clip) { failures.push(`clip: scene ${scene.id} references unknown clip ${scene.src}`); continue; }
    const available = availableCompFrames(clip, scene.trim);
    if (scene.duration > available) failures.push(`loop: scene ${scene.id} needs ${scene.duration} frames but the trim provides ${available} — clips are never looped`);
    if (scene.plate && (scene.plate.corners.length < 2 || scene.plate.corners.length > 4)) failures.push(`plate: scene ${scene.id} has ${scene.plate.corners.length} keyframes — 2–4 required`);
  }
  for (let i = 0; i < plan.scenes.length - 1; i++) {
    const a = plan.scenes[i] as any;
    const b = plan.scenes[i + 1] as any;
    if ((a.kind === 'clip') !== (b.kind === 'clip') && !(a.out && a.out.carry)) {
      failures.push(`carry: footage boundary ${a.id} → ${b.id} has no out.carry on the outgoing scene`);
    }
  }
  const { issues } = validateAndRepairPlan(plan, analyses, clips);
  for (const issue of issues) failures.push(`plan: [${issue.scene}] ${issue.message}`);

  return { ok: failures.length === 0, failures };
}
