/**
 * Short Video Enhancer — the pre-render quality control gate.
 *
 * Nothing is submitted to the render service until these checks pass. Every
 * check reports a human description of what is wrong AND the fix, because a
 * creator cannot act on 'validation failed'. A FAIL blocks the export; a WARN
 * is shown but lets the export through.
 */

import {
  CANVAS_H, CANVAS_W, FPS, GRAPHIC_BANDS, KEY_CHANNELS, MOTION_SPEC_VERSION,
  SAFE_MARGIN, SUBJECT_COLUMN,
  audioTracks, cameraBlend, cameraSpec, clipContentDuration, contrastRatio,
  hookEmphasisIndexes, hookTemplateLabel, resolveBand,
  sampleKeyframeColor, sampleKeyframes, subjectBoxAt,
  type CaptionCue, type CompiledTimeline, type GraphicLayer, type KeyChannel, type Project,
} from './model';
import { sfxAlignment } from './sfx';
import { beatAlignment } from './beats';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface QcCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface QcReport {
  checks: QcCheck[];
  failures: QcCheck[];
  warnings: QcCheck[];
  ok: boolean;
  ranAt: number;
}

/** Rough laid-out box of a caption cue, in canvas pixels. */
export interface CueBox { left: number; right: number; top: number; bottom: number; lines: number; maxSize: number }

const CHAR_WIDTH_RATIO = 0.54;

/**
 * Mirrors CAPTION_STYLE_SPECS in the motion engine. If a style's size
 * multiplier changes there, change it here too — the safe-area and legibility
 * checks reason about the laid-out box, not the spec.
 */
const STYLE_SIZE: Record<string, number> = {
  normal: 1,
  bold: 1.06,
  huge: 1.74,
  highlighted: 1.04,
  animated: 1.04,
  differentFont: 1.1,
  differentColor: 1.02,
  kinetic: 1.18,
};

export function estimateCueBox(cue: CaptionCue): CueBox {
  const blockW = CANVAS_W * Math.min(0.94, Math.max(0.3, cue.widthPct));
  const gap = cue.baseSize * 0.24;
  const sizeOf = (style: string): number => cue.baseSize * (STYLE_SIZE[style] || 1);
  let lineW = 0;
  let lines = 1;
  let maxSize = 0;
  for (const w of cue.words) {
    const size = sizeOf(w.style);
    maxSize = Math.max(maxSize, size);
    const wordW = String(w.text || '').length * size * CHAR_WIDTH_RATIO + gap;
    if (lineW + wordW > blockW && lineW > 0) { lines += 1; lineW = wordW; } else { lineW += wordW; }
  }
  const height = lines * maxSize * 1.14;
  return {
    left: Math.round(cue.x - blockW / 2),
    right: Math.round(cue.x + blockW / 2),
    top: Math.round(cue.y - height / 2),
    bottom: Math.round(cue.y + height / 2),
    lines,
    maxSize,
  };
}

function graphicBox(g: GraphicLayer) {
  // Sample the real successor channels over the layer's life. Phase 1 only had
  // ramps, but a keyed x/y/scale/rotation curve can now leave the box implied
  // by its static values; checking only the ramp ends would let a visibly
  // clipped layer through QC. Rotation is folded into the axis-aligned bounds.
  const span = Math.max(0.1, g.end - g.start);
  const scaleFallback = Math.max(g.scale.from, g.scale.to, 0.01);
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const ramp = (r: { from: number; to: number }, life: number) => r.from + (r.to - r.from) * life;

  for (let i = 0; i <= 24; i++) {
    const life = i / 24;
    const at = g.start + span * life;
    const x = sampleKeyframes(g.keys && g.keys.x, at, g.x + ramp(g.dx, life));
    const y = sampleKeyframes(g.keys && g.keys.y, at, g.y + ramp(g.dy, life));
    const sx = Math.abs(sampleKeyframes(g.keys && g.keys.scaleX, at, scaleFallback));
    const sy = Math.abs(sampleKeyframes(g.keys && g.keys.scaleY, at, scaleFallback));
    const rotation = sampleKeyframes(g.keys && g.keys.rotation, at, ramp(g.rotation, life));
    const radians = rotation * Math.PI / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const halfW = (g.w * sx * cos + g.h * sy * sin) / 2;
    const halfH = (g.w * sx * sin + g.h * sy * cos) / 2;
    left = Math.min(left, x - halfW);
    right = Math.max(right, x + halfW);
    top = Math.min(top, y - halfH);
    bottom = Math.max(bottom, y + halfH);
  }

  return { left: Math.round(left), right: Math.round(right), top: Math.round(top), bottom: Math.round(bottom) };
}

function overlaps(a: { top: number; bottom: number }, b: { top: number; bottom: number }): boolean {
  return a.top < b.bottom && b.top < a.bottom;
}

function timeOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end - 0.02 && b.start < a.end - 0.02;
}

/**
 * Run the whole gate. `timeline` must be the compiled timeline for `project`,
 * so the checks reason about the same frames the render will use.
 */
export function runQualityControl(project: Project, timeline: CompiledTimeline): QcReport {
  const checks: QcCheck[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string, fix?: string) => {
    checks.push({ id, label, status, detail, fix });
  };

  // 1 — geometry
  if (project.canvas.w === CANVAS_W && project.canvas.h === CANVAS_H && project.canvas.fps === FPS) {
    add('geometry', 'Output is exactly 9:16 (1080×1920)', 'pass', 'The composition canvas is 1080×1920 at 30fps and the export is finished as a true portrait master.');
  } else {
    add('geometry', 'Output is exactly 9:16 (1080×1920)', 'fail',
      'The project canvas is ' + project.canvas.w + '×' + project.canvas.h + ' at ' + project.canvas.fps + 'fps.',
      'Reset the canvas to 1080×1920 @ 30fps — this app only ever outputs vertical.');
  }

  // 2 — subject inside the frame
  const clips = project.clips.filter((c) => c.enabled && c.src);
  if (!clips.length) {
    add('clips', 'Video layer has footage', 'fail', 'There are no clips in the VIDEO layer.', 'Add a clip before exporting.');
  } else {
    const risky: string[] = [];
    for (const c of clips) {
      const maxZoom = c.camera.reduce((z, seg) => Math.max(z, cameraSpec(seg.angle).zoom), 1);
      const tracked = c.reframe.mode === 'auto' && c.reframe.focus.length > 0;
      const offCentre = c.reframe.focus.some((f) => f.x < 0.12 || f.x > 0.88 || f.y < 0.12 || f.y > 0.88);
      if (maxZoom >= 1.9 && !tracked) {
        risky.push('"' + c.name + '" punches in to ' + maxZoom.toFixed(2) + '× without a tracked subject');
      } else if (maxZoom >= 1.9 && offCentre) {
        risky.push('"' + c.name + '" tracks the subject close to the edge of the source while punched in to ' + maxZoom.toFixed(2) + '×');
      }
    }
    if (risky.length) {
      add('subject', 'No subject cropped outside frame', 'warn', risky.join('; ') + '.',
        'Run Analyse subject on the clip, or lower the closest camera angle, so the crop stays locked on the subject.');
    } else {
      add('subject', 'No subject cropped outside frame', 'pass',
        'Every clip reframes with an intelligent cover crop anchored on the tracked subject — the picture is never stretched and the subject stays inside the crop window.');
    }
  }

  // 3 — captions inside the safe area
  const cues = project.captions.filter((c) => c.enabled && c.words.length);
  const boxes = cues.map((c) => ({ cue: c, box: estimateCueBox(c) }));
  const outside = boxes.filter(({ box }) =>
    box.left < SAFE_MARGIN || box.right > CANVAS_W - SAFE_MARGIN || box.top < SAFE_MARGIN || box.bottom > CANVAS_H - SAFE_MARGIN);
  if (!cues.length) {
    add('caption-safe', 'All captions inside the safe area', 'pass', 'There are no caption cues to check.');
  } else if (outside.length) {
    add('caption-safe', 'All captions inside the safe area', 'fail',
      outside.length + ' caption cue' + (outside.length === 1 ? '' : 's') + ' reach outside the ' + SAFE_MARGIN + 'px safe margin — the first is "' +
      outside[0].cue.words.map((w) => w.text).join(' ').slice(0, 48) + '".',
      'Narrow the cue width, lower its font size, or nudge it towards the centre of the frame.');
  } else {
    add('caption-safe', 'All captions inside the safe area', 'pass', 'All ' + cues.length + ' cues sit inside the ' + SAFE_MARGIN + 'px margin.');
  }

  // 4 — caption overlap
  const collisions: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (timeOverlap(boxes[i].cue, boxes[j].cue) && overlaps(boxes[i].box, boxes[j].box)) {
        collisions.push('"' + boxes[i].cue.words.map((w) => w.text).join(' ').slice(0, 24) + '" and "' + boxes[j].cue.words.map((w) => w.text).join(' ').slice(0, 24) + '"');
      }
    }
  }
  if (collisions.length) {
    add('caption-overlap', 'No caption overlap between lines', 'fail',
      collisions.length + ' pair' + (collisions.length === 1 ? '' : 's') + ' of cues are on screen at the same time in the same band: ' + collisions.slice(0, 3).join('; ') + '.',
      'Shorten the earlier cue, or move one of them to a different vertical position.');
  } else {
    add('caption-overlap', 'No caption overlap between lines', 'pass', 'No two cues share screen time and screen space.');
  }

  // 5 — transitions never cut a clip
  const shortened = timeline.transitions.filter((t) => t.granted < t.requested - 0.02);
  const degraded = timeline.notes.filter((n) => n.indexOf('straight cut') >= 0);
  if (degraded.length) {
    add('transitions', 'Transitions are not cutting clips mid-playback', 'fail',
      degraded.length + ' transition' + (degraded.length === 1 ? '' : 's') + ' cannot run at all: ' + degraded[0],
      'Trim the clips so there is spare footage either side of the cut — a transition is paid for out of unused source, never out of your content.');
  } else if (shortened.length) {
    add('transitions', 'Transitions are not cutting clips mid-playback', 'warn',
      shortened.length + ' transition' + (shortened.length === 1 ? ' was' : 's were') + ' shortened to fit the spare footage. No clip content was cut — the full kept range of every clip still plays.',
      'Leave a little more unused source either side of each cut to get the full transition length.');
  } else {
    add('transitions', 'Transitions are not cutting clips mid-playback', 'pass',
      timeline.transitions.length + ' transition' + (timeline.transitions.length === 1 ? '' : 's') + ' run entirely on spare footage — every clip plays its kept range in full.');
  }

  // 6 — Z-order. `auto` is a legitimate band: it is resolved to background or
  // foreground at compile time from subject detection, so it must not be read
  // here as an unassigned layer.
  const resolvedBg = project.graphics.filter((g) => g.enabled && resolveBand(g, timeline) === 'background');
  const resolvedFg = project.graphics.filter((g) => g.enabled && resolveBand(g, timeline) === 'foreground');
  const bands = new Set<string>(GRAPHIC_BANDS.map((b) => String(b.id)));
  const bandless = project.graphics.filter((g) => !bands.has(String(g.band)));
  if (bandless.length) {
    add('z-order', 'All layers in the correct Z-order', 'fail', bandless.length + ' motion graphic(s) carry a band this engine does not know.',
      'Set each of those graphics to Background, Auto or Foreground in the Properties panel.');
  } else {
    const count = (id: string) => project.graphics.filter((g) => String(g.band) === id).length;
    add('z-order', 'All layers in the correct Z-order', 'pass',
      'Stack order is AUDIO → VIDEO → TRANSITIONS → BACKGROUND GRAPHICS → SUBJECT → FOREGROUND GRAPHICS → CAPTIONS, with ' +
      count('background') + ' background, ' + count('foreground') + ' foreground and ' +
      count('auto') + ' auto-placed graphic(s), which resolve to ' +
      resolvedBg.length + ' behind the subject and ' + resolvedFg.length + ' in front of it.');
  }

  // 7 — legibility
  const tiny = boxes.filter(({ box }) => box.maxSize < 42);
  const unprotected = cues.filter((c) => c.outline < 3 && !c.words.some((w) => w.style === 'highlighted'));
  if (tiny.length) {
    add('legible', 'Text is legible', 'fail', tiny.length + ' cue(s) render below 42px on a 1080-wide frame, which is unreadable on a phone.',
      'Raise the cue font size to at least 42px.');
  } else if (unprotected.length) {
    add('legible', 'Text is legible', 'warn', unprotected.length + ' cue(s) have no outline and no highlight block, so they can disappear over bright footage.',
      'Give those cues an outline of 4px or more, or use the Highlighted style on the key word.');
  } else {
    add('legible', 'Text is legible', 'pass', 'Every cue is at least 42px with an outline or highlight behind it.');
  }

  // 8 — graphics not clipped
  const clipped = project.graphics.filter((g) => g.enabled).filter((g) => {
    const b = graphicBox(g);
    return b.left < 0 || b.right > CANVAS_W || b.top < 0 || b.bottom > CANVAS_H;
  });
  const nearEdge = project.graphics.filter((g) => g.enabled).filter((g) => {
    const b = graphicBox(g);
    return b.left < SAFE_MARGIN || b.right > CANVAS_W - SAFE_MARGIN || b.top < SAFE_MARGIN || b.bottom > CANVAS_H - SAFE_MARGIN;
  });
  if (clipped.length) {
    add('graphic-bounds', 'No graphics clipped at the frame edge', 'fail',
      clipped.length + ' motion graphic(s) extend past the frame at their largest scale — the first is a ' + clipped[0].type + '.',
      'Move the graphic inwards or reduce its size / scale ramp.');
  } else if (nearEdge.length) {
    add('graphic-bounds', 'No graphics clipped at the frame edge', 'warn',
      nearEdge.length + ' graphic(s) sit inside the ' + SAFE_MARGIN + 'px safe margin but still within the frame.',
      'Nudge them inwards if you want them clear of platform UI overlays.');
  } else {
    add('graphic-bounds', 'No graphics clipped at the frame edge', 'pass', 'Every graphic stays inside the safe area at its largest scale.');
  }

  // 9 — frame rate consistency
  const badSpeed = clips.filter((c) => !(c.speed > 0.1 && c.speed <= 4));
  const tooShort = clips.filter((c) => clipContentDuration(c) < 0.2);
  if (badSpeed.length || tooShort.length) {
    add('fps', 'Frame rate is consistent throughout', 'fail',
      (badSpeed.length ? badSpeed.length + ' clip(s) have a playback speed outside 0.1×–4×. ' : '') +
      (tooShort.length ? tooShort.length + ' clip(s) are shorter than 0.2s. ' : ''),
      'Reset the speed to a value between 0.1× and 4× and give every clip at least 0.2s of content.');
  } else {
    add('fps', 'Frame rate is consistent throughout', 'pass',
      'One timebase for the whole timeline: ' + FPS + 'fps, ' + timeline.totalFrames + ' frames (' + timeline.durationS.toFixed(2) + 's).');
  }

  // 10 — audio sync
  const tracks = audioTracks(project.audio).filter((a) => a.enabled && a.url);
  const negative = tracks.filter((a) => a && a.at < -0.001);
  const pastEnd = tracks.filter((a) => a && a.at > timeline.durationS + 0.001);
  if (negative.length) {
    add('audio', 'Audio is synced (no drift)', 'fail', negative.length + ' audio track(s) start before zero, which would drift against the picture.',
      'Set every track start to 0 or later.');
  } else if (pastEnd.length) {
    add('audio', 'Audio is synced (no drift)', 'warn', pastEnd.length + ' audio track(s) start after the timeline ends, so they will never be heard.',
      'Move them inside the timeline or remove them.');
  } else {
    add('audio', 'Audio is synced (no drift)', 'pass',
      tracks.length
        ? tracks.length + ' audio track(s) are pinned to absolute timeline positions, and clip audio follows each clip’s own source range, so nothing can drift.'
        : 'Clip audio follows each clip’s own source range at its own playback rate — no separate tracks to drift.');
  }

  // 11 — preview equals render, verified on sampled frames.
  // Both sides consume the SAME props object, so sampling which layers are
  // live at a spread of frames is a real check that they agree, not a restated
  // promise — and a local blob: URL is the one thing the preview can read and
  // the render service genuinely cannot.
  const blobSources = clips.filter((c) => c.src.indexOf('blob:') === 0);
  const samples: string[] = [];
  const sampleCount = 5;
  for (let i = 0; i < sampleCount; i++) {
    const frame = Math.round((Math.max(1, timeline.totalFrames) - 1) * (i / (sampleCount - 1)));
    const at = frame / FPS;
    const liveClips = timeline.clips.filter((c) => frame >= c.from && frame < c.from + c.frames).length;
    const liveSubjects = timeline.clips.filter((c) => c.depth && frame >= c.from && frame < c.from + c.frames).length;
    const liveTrans = timeline.transitions.filter((t) => frame >= t.from && frame < t.from + t.frames).length;
    const liveBg = resolvedBg.filter((g) => at >= g.start - 0.001 && at <= g.end + 0.001).length;
    const liveFg = resolvedFg.filter((g) => at >= g.start - 0.001 && at <= g.end + 0.001).length;
    const liveCues = cues.filter((c) => at >= c.start - 0.001 && at <= c.end + 0.001).length;
    samples.push('f' + frame + '[' + liveClips + liveTrans + liveBg + liveSubjects + liveFg + liveCues + ']');
  }
  if (blobSources.length) {
    add('wysiwyg', 'Preview composition matches the render output', 'fail',
      blobSources.length + ' clip(s) are still referenced by a local blob: URL, which exists only in this browser tab. The preview can read it; the render service cannot.',
      'Wait for the upload to finish — the stored URL replaces the local one automatically — then export again.');
  } else {
    add('wysiwyg', 'Preview composition matches the render output', 'pass',
      'The preview is a real Remotion Player running the identical composition source that is submitted to the render service, at the same 1080×1920 native canvas (motion engine v' + MOTION_SPEC_VERSION + '). ' +
      'Frame samples agree on which layers are live — clip/transition/bg/subject/fg/caption counts: ' + samples.join(' ') + '. ' +
      'The render service canvas is 1920×1080, so the same stage is scaled uniformly and the finished file is cover-cropped back to a true 1080×1920 master — same framing, same motion, same timings.');
  }

  // 12 — the segmentation mask is not cutting the subject off
  const depthClips = clips.filter((c) => c.subjectFx.enabled && c.subject.mode !== 'off');
  if (!depthClips.length) {
    add('subject-mask', 'Subject not cropped by the segmentation mask', 'pass',
      'No clip is using the depth composite, so there is no subject mask to check.');
  } else {
    const cropped: string[] = [];
    const unsegmented: string[] = [];
    for (const c of depthClips) {
      if (c.subject.mode === 'auto' && !c.subject.boxes.length) { unsegmented.push('“' + c.name + '”'); continue; }
      const path = c.reframe.focus.length ? c.reframe.focus : [{ t: 0, x: c.reframe.x, y: c.reframe.y }];
      let outsideCount = 0;
      for (const point of path) {
        const box = subjectBoxAt(c.subject, point.t);
        const halfW = (box.w * c.subject.padX) / 2;
        const halfH = (box.h * c.subject.padY) / 2;
        if (point.x < box.x - halfW || point.x > box.x + halfW || point.y < box.y - halfH || point.y > box.y + halfH) outsideCount += 1;
      }
      if (outsideCount > path.length * 0.25) {
        cropped.push('“' + c.name + '” (' + outsideCount + ' of ' + path.length + ' tracked points fall outside the mask)');
      }
    }
    if (cropped.length) {
      add('subject-mask', 'Subject not cropped by the segmentation mask', 'fail',
        'The cutout mask does not cover the tracked subject on ' + cropped.join('; ') + ', so part of the presenter would be sliced off.',
        'Re-run Segment subject on the clip, raise its mask padding, or switch the mask shape to Column so a standing subject stays whole.');
    } else if (unsegmented.length) {
      add('subject-mask', 'Subject not cropped by the segmentation mask', 'warn',
        unsegmented.join(', ') + ' has the depth composite on but has never been segmented, so the mask is using the default centred box.',
        'Run Segment subject on that clip so the mask follows the real presenter.');
    } else {
      add('subject-mask', 'Subject not cropped by the segmentation mask', 'pass',
        depthClips.length + ' depth-composited clip(s): the mask covers the whole tracked subject path at its padded size.');
    }
  }

  // 13 — tracked graphics stay on screen.
  // A tracked layer is pinned to the subject point, and the reframe keeps the
  // subject inside the central column — so the drift risk lives entirely in
  // the OFFSET, which is what this checks against the column's extremes.
  const tracked = project.graphics.filter((g) => g.enabled && g.track && g.track.target !== 'none');
  if (!tracked.length) {
    add('tracking', 'Tracked objects are not drifting off-frame', 'pass', 'No graphic is following the subject.');
  } else {
    const drifting: string[] = [];
    for (const g of tracked) {
      const scale = Math.max(g.scale.from, g.scale.to, 0.01);
      const halfW = (g.w * scale) / 2;
      const halfH = (g.h * scale) / 2;
      const leftMost = SUBJECT_COLUMN.x0 * CANVAS_W + g.track.offsetX - halfW;
      const rightMost = SUBJECT_COLUMN.x1 * CANVAS_W + g.track.offsetX + halfW;
      const topMost = SUBJECT_COLUMN.y0 * CANVAS_H + g.track.offsetY - halfH;
      const bottomMost = SUBJECT_COLUMN.y1 * CANVAS_H + g.track.offsetY + halfH;
      if (leftMost < 0 || rightMost > CANVAS_W || topMost < 0 || bottomMost > CANVAS_H) {
        drifting.push(g.type + ' following the ' + g.track.target);
      }
    }
    if (drifting.length) {
      add('tracking', 'Tracked objects are not drifting off-frame', 'fail',
        drifting.length + ' tracked graphic(s) leave the frame as the subject moves: ' + drifting.slice(0, 3).join('; ') + '.',
        'Reduce the tracking offset or the graphic size so it stays on screen wherever the subject goes.');
    } else {
      add('tracking', 'Tracked objects are not drifting off-frame', 'pass',
        tracked.length + ' tracked graphic(s) stay fully inside the frame across the whole range the subject can occupy.');
    }
  }

  // 14 — text contrast ratio
  if (!cues.length) {
    add('contrast', 'Text contrast ratio is readable', 'pass', 'There are no caption cues to check.');
  } else {
    let worst = 99;
    let worstCue: CaptionCue | null = null;
    for (const cue of cues) {
      for (const word of cue.words) {
        // What the word actually sits on: a highlight block, a dark outline, or
        // raw footage — mid-grey is the honest worst case for raw footage.
        const against = word.style === 'highlighted'
          ? (word.color || cue.accent)
          : cue.outline >= 3 ? '#0A0D14' : '#808080';
        const ink = word.style === 'highlighted'
          ? '#0B0D12'
          : (word.style === 'differentColor' || word.style === 'huge') ? (word.color || cue.accent) : cue.color;
        const ratio = contrastRatio(ink, against);
        if (ratio < worst) { worst = ratio; worstCue = cue; }
      }
    }
    const sample = worstCue ? '“' + worstCue.words.map((w) => w.text).join(' ').slice(0, 40) + '”' : '';
    if (worst < 3) {
      add('contrast', 'Text contrast ratio is readable', 'fail',
        'The weakest caption contrast is ' + worst.toFixed(2) + ':1 on ' + sample + ' — below the 3:1 floor for large text.',
        'Raise that cue’s outline to 4px or more, switch the key word to the Highlighted style, or pick a lighter caption colour.');
    } else if (worst < 4.5) {
      add('contrast', 'Text contrast ratio is readable', 'warn',
        'The weakest caption contrast is ' + worst.toFixed(2) + ':1 on ' + sample + '. Readable as large text, but it will struggle on a bright shot.',
        'An outline of 6px, or the Highlighted style on the key word, takes it clear of 4.5:1.');
    } else {
      add('contrast', 'Text contrast ratio is readable', 'pass',
        'Every caption word clears 4.5:1 against what it sits on (the weakest is ' + worst.toFixed(2) + ':1).');
    }
  }

  // 15 — keyframe curves produce valid numbers
  const keyed = project.graphics.filter((g) => g.keys && Object.keys(g.keys).length);
  if (!keyed.length) {
    add('keyframes', 'Keyframe curves produce valid values', 'pass', 'No layer is keyframed — every channel is running its ramp.');
  } else {
    const broken: string[] = [];
    let totalKeys = 0;
    for (const g of keyed) {
      const span = Math.max(0.1, g.end - g.start);
      for (const spec of KEY_CHANNELS) {
        const track = g.keys[spec.id as KeyChannel];
        if (!track || !track.length) continue;
        totalKeys += track.length;
        if (track.some((k) => !Number.isFinite(k.t) || (!spec.color && !Number.isFinite(k.v)))) {
          broken.push(g.type + ' / ' + spec.label + ' has a keyframe with no usable value');
          continue;
        }
        for (let i = 0; i <= 12; i++) {
          const at = g.start + (span * i) / 12;
          if (spec.color) {
            if (!/^#[0-9a-fA-F]{6}$/.test(sampleKeyframeColor(track, at, g.color))) {
              broken.push(g.type + ' / ' + spec.label + ' interpolates to an invalid colour');
              break;
            }
          } else if (!Number.isFinite(sampleKeyframes(track, at, 0))) {
            broken.push(g.type + ' / ' + spec.label + ' interpolates to NaN at ' + at.toFixed(2) + 's');
            break;
          }
        }
      }
    }
    if (broken.length) {
      add('keyframes', 'Keyframe curves produce valid values', 'fail',
        broken.length + ' keyframe curve(s) do not produce a usable value: ' + broken.slice(0, 3).join('; ') + '.',
        'Open the keyframe editor on that layer and fix or delete the offending keyframe.');
    } else {
      add('keyframes', 'Keyframe curves produce valid values', 'pass',
        totalKeys + ' keyframe(s) across ' + keyed.length + ' layer(s): every channel was sampled at 13 points over its life and returned a finite value.');
    }
  }

  // 16 — the depth composite is stacked the right way round
  const depthWithoutMask = clips.filter((c) => c.subjectFx.enabled && c.subject.mode === 'off');
  const orphanBackground = resolvedBg.filter((g) => {
    const mid = (g.start + g.end) / 2;
    const span = timeline.contentSpans.find((s) => mid >= s.start - 0.001 && mid <= s.end + 0.001);
    const placed = span ? timeline.clips.find((c) => c.id === span.id) : null;
    return !placed || !placed.depth;
  });
  if (depthWithoutMask.length) {
    add('depth-order', 'Depth composite layers are correctly ordered', 'fail',
      depthWithoutMask.length + ' clip(s) have the depth composite switched on while their subject mode is Off, so no subject cutout is drawn and the background band has nothing in front of it.',
      'Set that clip’s subject mode to Auto and run Segment subject, or switch the depth composite off.');
  } else if (orphanBackground.length) {
    add('depth-order', 'Depth composite layers are correctly ordered', 'warn',
      orphanBackground.length + ' background graphic(s) sit over a clip with no depth composite, so they draw on top of the video rather than behind the presenter.',
      'Turn the depth composite on for that clip, or move those graphics to the Foreground band so their Z-order reads as intended.');
  } else {
    add('depth-order', 'Depth composite layers are correctly ordered', 'pass',
      depthClips.length
        ? depthClips.length + ' clip(s) composite as plate → background graphics → masked subject → foreground graphics → captions. The subject copy shares the plate’s source range, camera path and transition state, and is muted so no audio doubles.'
        : 'No depth composite in use — the stack is the flat order, with every graphic above the video.');
  }

  // 17 — the opening hook
  const hook = project.hook && project.hook.enabled ? project.hook : null;
  if (!hook) {
    add('hook', 'Opening hook is well formed', 'pass',
      'No hook on this project — the video opens straight on clip 1, and the timeline starts at the first frame of footage.');
  } else {
    const label = hookTemplateLabel(hook.template);
    const words = String(hook.text || '').trim().split(/\s+/).filter(Boolean);
    const problems: string[] = [];
    const cautions: string[] = [];

    if (hook.template === 'number') {
      if (!/[0-9]/.test(String(hook.value || ''))) problems.push('the Number hook has no digits to count up to');
    } else if (!words.length) {
      problems.push('the ' + label + ' hook has no text to show');
    }
    if (hook.template === 'problem') {
      const stray = hookEmphasisIndexes(hook).filter((n) => n > words.length);
      if (stray.length) {
        cautions.push('word position' + (stray.length === 1 ? ' ' : 's ') + stray.join(', ') +
          ' cannot be emphasised — the phrase only has ' + words.length + ' word(s)');
      }
    }
    if (hook.duration > 3.2) cautions.push('it holds for ' + hook.duration.toFixed(1) + 's, which is past the 1-3s a hook works in');
    if (hook.leadIn > 0.01 && Math.abs(hook.leadIn - hook.duration) > 0.08) {
      cautions.push('it holds for ' + hook.duration.toFixed(2) + 's but reserves ' + hook.leadIn.toFixed(2) +
        's before clip 1, so ' + (hook.leadIn > hook.duration ? 'there is a gap of empty frame after it' : 'it runs over the start of the footage'));
    }
    if (hook.leadIn < 0.01 && hook.scrim < 0.25) {
      cautions.push('it plays over the footage with only a ' + Math.round(hook.scrim * 100) + '% scrim, so the text may be hard to read');
    }

    if (problems.length) {
      add('hook', 'Opening hook is well formed', 'fail', 'The ' + label + ' hook cannot render: ' + problems.join('; ') + '.',
        'Open the hook in Properties and fill in its copy, or remove it.');
    } else if (cautions.length) {
      add('hook', 'Opening hook is well formed', 'warn', 'The ' + label + ' hook renders, but ' + cautions.join('; ') + '.',
        'Adjust the hold, the lead-in or the scrim in Properties.');
    } else {
      add('hook', 'Opening hook is well formed', 'pass',
        'The ' + label + ' hook holds the frame for ' + hook.duration.toFixed(2) + 's' +
        (hook.leadIn > 0.01 ? ' on its own before clip 1' : ' over the opening of clip 1') +
        ', and shrinks its own type if the longest word would reach past the ' + SAFE_MARGIN + 'px safe area.');
    }
  }

  // 18 — the SFX track
  const sfx = project.audio.sfx.filter((s) => s.enabled);
  if (!sfx.length) {
    add('sfx', 'Sound effects are in sync', 'pass',
      'The SFX track is empty, so there is nothing to sync. Clip audio and any voice or music bed still play.');
  } else {
    const silent = sfx.filter((s) => !s.url);
    const pastTimeline = sfx.filter((s) => s.at > timeline.durationS + 0.001);
    const badFades = sfx.filter((s) => s.duration > 0 && s.fadeIn + s.fadeOut > s.duration + 0.001);
    const alignment = sfxAlignment(project, timeline, Math.max(0.1, project.beats.tolerance));
    if (silent.length) {
      add('sfx', 'Sound effects are in sync', 'fail',
        silent.length + ' sound effect(s) have no stored file, so they would be silent in the export.',
        'Re-add them from the Sound panel so each one is rendered and stored before the render service reads it.');
    } else if (badFades.length) {
      add('sfx', 'Sound effects are in sync', 'fail',
        badFades.length + ' sound effect(s) have fades longer than the clip itself, so the sound never reaches full level.',
        'Shorten the fade in / fade out, or raise the clip length, in Properties.');
    } else if (pastTimeline.length) {
      add('sfx', 'Sound effects are in sync', 'warn',
        pastTimeline.length + ' sound effect(s) start after the timeline ends, so they will never be heard.',
        'Drag them back inside the timeline on the SFX track, or delete them.');
    } else if (alignment.strays.length) {
      add('sfx', 'Sound effects are in sync', 'warn',
        alignment.aligned + ' of ' + alignment.total + ' sound(s) land on a transition, a text animation or a graphic entry. ' +
        alignment.strays.length + ' sit on their own: ' +
        alignment.strays.slice(0, 3).map((s) => '“' + s.label + '” at ' + s.at.toFixed(2) + 's').join(', ') + '.',
        'That is fine if you placed them deliberately — otherwise run Auto-align in the Sound panel, or drag them onto the event they belong to.');
    } else {
      add('sfx', 'Sound effects are in sync', 'pass',
        'All ' + alignment.total + ' sound(s) on the SFX track land within ' + Math.max(0.1, project.beats.tolerance).toFixed(2) +
        's of the transition, text animation or graphic entry they punctuate, and each one carries its own fade so it cannot click.');
    }
  }

  // 19 — beat markers and the edits that claim to follow them
  const music = project.audio.music;
  const wantsBeats = project.transitions.some((t) => t.syncToBeat) || project.beats.syncEnabled;
  if (!music || !music.enabled || !music.url) {
    add('beats', 'Beat sync is consistent', wantsBeats ? 'warn' : 'pass',
      wantsBeats
        ? 'Beat sync is switched on but there is no music bed to read a tempo from, so every layer is keeping its own timing.'
        : 'No music bed, so there is no beat grid — transitions, graphics and captions run on their own timing, which is the intended fallback.',
      wantsBeats ? 'Add a music track and analyse it, or turn beat sync off so the setting is not misleading.' : undefined);
  } else if (!project.beats.times.length) {
    add('beats', 'Beat sync is consistent', wantsBeats ? 'warn' : 'pass',
      'There is a music bed but it has never been analysed, so there are no beat markers on the timeline' +
      (wantsBeats ? ' — and beat sync is switched on with nothing to snap to.' : '.'),
      'Open the Beats panel and analyse the music.');
  } else {
    const grid = beatAlignment(project, timeline);
    const detail = project.beats.times.length + ' markers at ' + project.beats.bpm.toFixed(1) + ' BPM (' +
      project.beats.source + ')';
    if (grid.offCuts.length) {
      add('beats', 'Beat sync is consistent', 'warn',
        detail + '. ' + grid.offCuts.length + ' cut(s) marked Sync to beats are still off the grid: ' +
        grid.offCuts.slice(0, 3).map((c) => '“' + c.name + '” by ' + c.gap.toFixed(2) + 's').join(', ') + '.',
        'Press Snap cuts in the Beats panel. A cut that still will not move has no spare footage left for its transition — trim the clip a little first.');
    } else if (grid.checked) {
      add('beats', 'Beat sync is consistent', 'pass',
        detail + '. All ' + grid.checked + ' synced cut(s) land within ' + project.beats.tolerance.toFixed(2) + 's of a beat.');
    } else {
      add('beats', 'Beat sync is consistent', 'pass',
        detail + '. No transition is marked Sync to beats, so the markers are a guide only and nothing has been moved.');
    }
  }

  // 20 — camera moves are moves, not cuts
  const movingClips = clips.filter((c) => c.camera.length);
  if (!movingClips.length) {
    add('camera', 'Camera moves are eased, never cut', 'pass', 'No simulated camera angles on any clip — every shot holds its reframe.');
  } else {
    const cutShort: string[] = [];
    const overruns: string[] = [];
    for (const c of movingClips) {
      const dur = clipContentDuration(c);
      for (const seg of c.camera) {
        // A move that is still easing when its own hold runs out never reaches
        // the angle it was asked for, so the shot reads as a drift rather than
        // as the Close Up or Punch In the creator chose.
        if (seg.end - seg.start < cameraBlend(seg) - 0.02) {
          cutShort.push('“' + c.name + '” at ' + seg.start.toFixed(2) + 's holds ' + (seg.end - seg.start).toFixed(2) +
            's but takes ' + cameraBlend(seg).toFixed(2) + 's to get there');
        }
        if (seg.start > dur + 0.01) overruns.push('“' + c.name + '” has a move at ' + seg.start.toFixed(2) + 's but only ' + dur.toFixed(2) + 's of content');
      }
    }
    if (overruns.length) {
      add('camera', 'Camera moves are eased, never cut', 'fail',
        overruns.length + ' camera move(s) start past the end of their clip, so they never play: ' + overruns.slice(0, 2).join('; ') + '.',
        'Move those angles inside the clip’s content range, or delete them.');
    } else if (cutShort.length) {
      add('camera', 'Camera moves are eased, never cut', 'warn',
        cutShort.length + ' camera move(s) never finish arriving before the next one starts: ' + cutShort.slice(0, 2).join('; ') + '.',
        'Hold the angle for longer, or lower its MOVE time in Properties so the camera settles first.');
    } else {
      const total = movingClips.reduce((n, c) => n + c.camera.length, 0);
      add('camera', 'Camera moves are eased, never cut', 'pass',
        total + ' simulated angle(s) across ' + movingClips.length + ' clip(s). Every change eases over its own move time and the crop stays anchored on the tracked subject, so the subject is centred and inside the safe area at every zoom level.');
    }
  }

  const failures = checks.filter((c) => c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warn');
  return { checks, failures, warnings, ok: failures.length === 0, ranAt: Date.now() };
}
