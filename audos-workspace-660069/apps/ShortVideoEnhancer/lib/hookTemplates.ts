/**
 * Short Video Enhancer — the OPENING HOOK.
 *
 * The first one to three seconds decide whether the rest of the video is ever
 * watched, so the hook is a first-class layer rather than a caption with a big
 * font. Three templates ship, each one a different shape of opening:
 *
 *   STATEMENT  one line scales in hard, the camera pushes, an underline sweeps
 *   NUMBER     a figure counts up (or pops in) with a line sliding in beneath
 *   PROBLEM    the words land one at a time, the key phrase takes the contrast
 *
 * LEAD-IN IS THE ONLY THING THAT MOVES TIME. A hook with a lead-in plays on
 * its own BEFORE clip 1: the compiler reserves that time at the head and every
 * clip starts after it. Captions, graphics, audio and insert suggestions are
 * all timed in absolute timeline seconds, so changing the lead-in has to move
 * them by the same amount or the whole edit would desync behind the hook —
 * which is exactly what `withHookLeadIn` below does, in one atomic step.
 *
 * A hook with a lead-in of zero overlays the opening of clip 1 behind a scrim
 * instead, and nothing on the timeline moves at all.
 */

import {
  CANVAS_H, CANVAS_W, KEY_CHANNELS,
  clamp, newCaptionCue, newGraphic, newHook, round3, uid,
  type AudioTrack, type CameraAngle, type CameraSegment, type CaptionCue, type CaptionWord,
  type GraphicType, type HookState, type HookTemplateId, type KeyframeTracks, type Project,
} from './model';
import type { PresetPack } from './presets';

/** The look a hook inherits from the motion design pack it is created under. */
export function hookLook(pack: PresetPack, template: HookTemplateId): HookState {
  const base = newHook(template);
  return {
    ...base,
    font: pack.captionFont === 'inter' || pack.captionFont === 'dmsans' ? 'anton' : pack.captionFont,
    accent: pack.accent,
    emphasisColor: template === 'problem' ? '#EF4444' : pack.accent,
    // A fast pack wants a shorter hook: three seconds of statement in front of
    // a High Energy cut would be the slowest thing in the video.
    duration: round3(clamp(pack.segmentLength * 0.7, 1, 3)),
    leadIn: round3(clamp(pack.segmentLength * 0.7, 1, 3)),
    push: pack.id === 'cinematic' ? 0.08 : 0.14,
  };
}

/** Seed a hook's copy from the transcript, so it opens on the creator's words. */
export function hookCopyFrom(transcriptText: string, template: HookTemplateId): Partial<HookState> {
  const text = String(transcriptText || '').trim();
  if (!text) return {};
  const firstSentence = text.split(/[.!?]/)[0].trim();
  const words = firstSentence.split(/\s+/).filter(Boolean);

  if (template === 'number') {
    const figure = words.find((w) => /[0-9]/.test(w));
    if (!figure) return {};
    return {
      value: figure.replace(/[^0-9.,]/g, '') || figure,
      currency: figure.indexOf('$') >= 0 ? '$' : figure.indexOf('%') >= 0 ? '' : '',
      support: words.slice(0, 5).join(' ').slice(0, 42),
    };
  }

  const line = words.slice(0, template === 'problem' ? 6 : 4).join(' ');
  if (!line) return {};
  if (template === 'problem') {
    // The longest word is almost always the one carrying the problem.
    let index = 1;
    let longest = 0;
    line.split(' ').forEach((w, i) => { if (w.length > longest) { longest = w.length; index = i + 1; } });
    return { text: line.toUpperCase(), emphasisWords: String(index) };
  }
  return { text: line.toUpperCase() };
}

// ---------------------------------------------------------------------------
// Moving the timeline under a changing lead-in
// ---------------------------------------------------------------------------

function shiftKeys(keys: KeyframeTracks, delta: number): KeyframeTracks {
  const out: KeyframeTracks = {};
  for (const spec of KEY_CHANNELS) {
    const track = keys[spec.id];
    if (track && track.length) out[spec.id] = track.map((k) => ({ ...k, t: round3(k.t + delta) }));
  }
  return out;
}

function shiftTrack(track: AudioTrack | null, delta: number): AudioTrack | null {
  if (!track) return null;
  return { ...track, at: round3(Math.max(0, track.at + delta)) };
}

/**
 * Move every layer that is timed in ABSOLUTE timeline seconds by `delta`.
 *
 * Clip trims and camera moves are deliberately untouched: those are in SOURCE
 * and clip-local seconds, so the lead-in does not affect them. The transcript
 * is untouched for the same reason.
 */
export function shiftTimelineLayers(project: Project, delta: number): Project {
  if (!delta) return project;
  return {
    ...project,
    captions: project.captions.map((c) => ({
      ...c,
      start: round3(Math.max(0, c.start + delta)),
      end: round3(Math.max(0.2, c.end + delta)),
      words: c.words.map((w) => ({ ...w, start: round3(Math.max(0, w.start + delta)), end: round3(Math.max(0.05, w.end + delta)) })),
    })),
    graphics: project.graphics.map((g) => ({
      ...g,
      start: round3(Math.max(0, g.start + delta)),
      end: round3(Math.max(0.2, g.end + delta)),
      keys: shiftKeys(g.keys, delta),
      track: {
        ...g.track,
        from: g.track.from == null ? null : round3(Math.max(0, g.track.from + delta)),
        to: g.track.to == null ? null : round3(Math.max(0, g.track.to + delta)),
      },
    })),
    audio: {
      voice: shiftTrack(project.audio.voice, delta),
      music: shiftTrack(project.audio.music, delta),
      sfx: project.audio.sfx.map((s) => shiftTrack(s, delta) as AudioTrack),
    },
    inserts: project.inserts.map((i) => ({
      ...i,
      at: round3(Math.max(0, i.at + delta)),
      end: round3(Math.max(0.2, i.end + delta)),
    })),
    pacing: {
      ...project.pacing,
      items: project.pacing.items.map((i) => ({
        ...i,
        at: round3(Math.max(0, i.at + delta)),
        end: round3(Math.max(0.2, i.end + delta)),
      })),
    },
    // The beat grid is measured against the music, and the music just moved.
    beats: {
      ...project.beats,
      times: project.beats.times.map((t) => round3(Math.max(0, t + delta))).filter((t) => t >= 0),
    },
  };
}

/**
 * Put a hook on the project (or replace the one already there).
 *
 * The incoming hook's lead-in is honoured exactly: the difference against the
 * lead-in currently in force is applied to every absolute-timed layer, so the
 * captions stay on the words they belong to.
 */
export function setHook(project: Project, hook: HookState): Project {
  const currentLead = project.hook && project.hook.enabled ? project.hook.leadIn : 0;
  const wanted = round3(clamp(hook.leadIn, 0, 6));
  // A hidden hook reserves nothing, so the timeline closes back up around it —
  // but the hook KEEPS the lead-in it was given, so switching it on again
  // restores the same opening instead of quietly losing it.
  const inForce = hook.enabled ? wanted : 0;
  const shifted = shiftTimelineLayers(project, round3(inForce - currentLead));
  return { ...shifted, hook: { ...hook, leadIn: wanted } };
}

/** Patch the hook in place, moving the timeline only when the lead-in changes. */
export function patchHook(project: Project, patch: Partial<HookState>): Project {
  if (!project.hook) return project;
  return setHook(project, { ...project.hook, ...patch });
}

/** Remove the hook and give the lead-in time back to the timeline. */
export function removeHook(project: Project): Project {
  const currentLead = project.hook && project.hook.enabled ? project.hook.leadIn : 0;
  const shifted = shiftTimelineLayers(project, round3(-currentLead));
  return { ...shifted, hook: null };
}

/** A one-line description of what the hook will do, for the editor. */
export function hookSummary(hook: HookState): string {
  const where = hook.leadIn > 0.01
    ? 'plays on its own for ' + hook.leadIn.toFixed(1) + 's before clip 1'
    : 'plays over the opening of clip 1';
  if (hook.template === 'number') {
    return (hook.countUp ? 'Counts up to ' : 'Pops in on ') + (hook.currency || '') + hook.value +
      (hook.support ? ' over \u201c' + hook.support + '\u201d' : '') + ' \u2014 ' + where + '.';
  }
  if (hook.template === 'problem') {
    return 'Lands \u201c' + hook.text + '\u201d one word at a time, word ' + (hook.emphasisWords || '1') +
      ' in the contrast colour \u2014 ' + where + '.';
  }
  return 'Scales \u201c' + hook.text + '\u201d in with a camera push and an underline sweep \u2014 ' + where + '.';
}

// ---------------------------------------------------------------------------
// Phase 2 opening-hook layer bundles
// ---------------------------------------------------------------------------

/**
 * Unlike the legacy title-card hook above, these templates write ordinary
 * caption, graphic and camera layers. Once inserted there is no special mode:
 * every part can be moved, restyled, locked or deleted in the normal editors.
 */
export type OpeningHookTemplateId =
  | 'questionHook' | 'boldClaim' | 'patternInterrupt' | 'statDrop' | 'beforeAfter';

export interface OpeningHookTemplate {
  id: OpeningHookTemplateId;
  label: string;
  blurb: string;
  graphic: GraphicType | null;
  camera: CameraAngle;
  duration: number;
}

export const OPENING_HOOK_TEMPLATES: OpeningHookTemplate[] = [
  { id: 'questionHook', label: 'Question hook', blurb: 'Open on a direct question with an oversized keyword.', graphic: 'ring', camera: 'closeUp', duration: 1.8 },
  { id: 'boldClaim', label: 'Bold claim', blurb: 'Make the first claim own the frame, then sweep an underline beneath it.', graphic: 'underline', camera: 'punchIn', duration: 1.7 },
  { id: 'patternInterrupt', label: 'Pattern interrupt', blurb: 'A hard WAIT beat, radial burst and fast punch-in break the scroll.', graphic: 'radialBurst', camera: 'punchIn', duration: 1.35 },
  { id: 'statDrop', label: 'Stat drop', blurb: 'Lead on the first number in the script with a supporting stat card.', graphic: 'statCard', camera: 'medium', duration: 1.9 },
  { id: 'beforeAfter', label: 'Before / after', blurb: 'Frame the transformation as a two-part promise with a directional diagram.', graphic: 'arrowDiagram', camera: 'sideCropRight', duration: 2 },
];

export function openingHookTemplate(id: OpeningHookTemplateId): OpeningHookTemplate {
  return OPENING_HOOK_TEMPLATES.find((template) => template.id === id) || OPENING_HOOK_TEMPLATES[0];
}

function openingCopy(project: Project, id: OpeningHookTemplateId): string {
  const source = String(project.transcriptText || '').trim();
  const first = source.split(/[.!?]/)[0].trim().split(/\s+/).filter(Boolean);
  const short = first.slice(0, 5).join(' ');
  if (id === 'questionHook') {
    const question = source.match(/[^.!?]{2,80}\?/);
    return (question ? question[0] : 'What if ' + (first.slice(0, 4).join(' ') || 'this changed everything') + '?').toUpperCase();
  }
  if (id === 'patternInterrupt') return ('WAIT \u2014 ' + (first.slice(0, 3).join(' ') || 'WATCH THIS')).toUpperCase();
  if (id === 'statDrop') {
    const numberIndex = first.findIndex((word) => /[0-9%$\u20b9]/.test(word));
    return (numberIndex >= 0 ? first.slice(numberIndex, numberIndex + 4).join(' ') : '3X FASTER RESULTS').toUpperCase();
  }
  if (id === 'beforeAfter') return short ? ('BEFORE \u2192 ' + short).toUpperCase() : 'BEFORE \u2192 AFTER';
  return (short || 'THE RESULT CHANGES EVERYTHING').toUpperCase();
}

/**
 * The one hook-caption treatment shared by templates and the pacing engine.
 * Pacing promotes an existing cue; a template creates a cue and then runs the
 * exact same treatment over it.
 */
export function promoteCueToHook(cue: CaptionCue, pack: PresetPack, trigger = ''): CaptionCue {
  const wanted = trigger.toLowerCase().replace(/[^a-z0-9%$\u20b9]/g, '');
  let strongest = 0;
  let score = -1;
  cue.words.forEach((word, index) => {
    const clean = word.text.toLowerCase().replace(/[^a-z0-9%$\u20b9]/g, '');
    const next = wanted && clean === wanted ? 20 : /[0-9%$\u20b9]/.test(word.text) ? 10 : word.text.length;
    if (next > score) { score = next; strongest = index; }
  });
  return {
    ...cue,
    x: CANVAS_W / 2,
    y: Math.round(CANVAS_H * 0.34),
    widthPct: 0.86,
    font: pack.captionFont === 'inter' || pack.captionFont === 'dmsans' ? 'anton' : pack.captionFont,
    baseSize: Math.max(108, Math.min(142, Math.round(pack.captionSize * 1.55))),
    outline: Math.max(6, pack.captionOutline),
    accent: pack.accent,
    words: cue.words.map((word, index) => ({
      ...word,
      style: index === strongest ? 'huge' as const : 'bold' as const,
      anim: index === strongest ? 'punchIn' as const : 'pop' as const,
      shake: index === strongest,
      ...(index === strongest ? { color: pack.accent } : {}),
    })),
  };
}

function overlaps(start: number, end: number, a: number, b: number): boolean {
  return start < b - 0.02 && a < end - 0.02;
}

export interface ApplyOpeningHookResult {
  project: Project;
  added: number;
  skipped: string[];
}

/** Insert or replace an opening-hook bundle without touching locked work. */
export function applyOpeningHookTemplate(project: Project, id: OpeningHookTemplateId, pack: PresetPack): ApplyOpeningHookResult {
  const template = openingHookTemplate(id);
  const start = project.hook && project.hook.enabled ? Math.max(0, project.hook.leadIn) : 0;
  const end = round3(start + template.duration);
  const skipped: string[] = [];
  let added = 0;

  // The template owns the opening window just like a preset owns its generated
  // design layers: replace unlocked caption/graphic work in that window, while
  // a creator who locked a layer has explicitly taken ownership of it and wins.
  const lockedCaption = project.captions.some((cue) => cue.locked && overlaps(start, end, cue.start, cue.end));
  const lockedGraphic = project.graphics.some((graphic) => graphic.locked && overlaps(start, end, graphic.start, graphic.end));
  const captions = project.captions.filter((cue) => cue.locked || !overlaps(start, end, cue.start, cue.end));
  const graphics = project.graphics.filter((graphic) => graphic.locked || !overlaps(start, end, graphic.start, graphic.end));

  let nextCaptions = lockedCaption ? project.captions : captions;
  if (lockedCaption) {
    skipped.push('caption (a locked cue already covers the opening)');
  } else {
    const copy = openingCopy(project, id);
    const tokens = copy.split(/\s+/).filter(Boolean).slice(0, 8);
    const per = template.duration / Math.max(1, tokens.length);
    const words: CaptionWord[] = tokens.map((text, index) => ({
      id: uid('hookword'), text,
      start: round3(start + index * per),
      end: round3(start + (index + 1) * per),
      style: 'bold', anim: 'pop',
    }));
    let cue = newCaptionCue(start, end, words, { accent: pack.accent, color: '#FFFFFF', locked: false });
    cue = promoteCueToHook(cue, pack, id === 'statDrop' ? (tokens.find((word) => /[0-9]/.test(word)) || '') : '');
    cue.id = uid('hookcap');
    nextCaptions = [...captions, cue].sort((a, b) => a.start - b.start);
    added += 1;
  }

  let nextGraphics = lockedGraphic ? project.graphics : graphics;
  if (template.graphic) {
    if (lockedGraphic) {
      skipped.push('motion graphic (a locked graphic already covers the opening)');
    } else {
      const graphic = newGraphic(template.graphic, start, end, pack.accent, pack.accent2);
      graphic.id = uid('hookgfx');
      graphic.x = Math.round(CANVAS_W / 2);
      graphic.y = id === 'boldClaim' ? Math.round(CANVAS_H * 0.47) : Math.round(CANVAS_H * 0.35);
      graphic.easing = 'expoOut';
      graphic.inDur = Math.min(0.28, template.duration * 0.2);
      if (id === 'statDrop') graphic.text = openingCopy(project, id) + '|THE NUMBER TO REMEMBER';
      if (id === 'beforeAfter') graphic.text = 'BEFORE|AFTER';
      if (id === 'patternInterrupt') { graphic.opacity = { from: 0.85, to: 0.25 }; graphic.count = 24; }
      nextGraphics = [...graphics, graphic].sort((a, b) => a.start - b.start);
      added += 1;
    }
  }

  let nextClips = project.clips;
  const first = project.clips[0];
  if (first) {
    const keptCamera = first.camera.filter((segment) => segment.locked || !overlaps(0, template.duration, segment.start, segment.end));
    const blocked = first.locked || keptCamera.some((segment) => segment.locked && overlaps(0, template.duration, segment.start, segment.end));
    if (blocked) {
      skipped.push('camera angle (' + (first.locked ? 'the opening clip is locked' : 'a locked camera move covers the opening') + ')');
    } else {
      const camera: CameraSegment = {
        id: uid('hookcam'), angle: template.camera, start: 0,
        end: round3(Math.min(template.duration, Math.max(0.4, (first.out - first.in) / Math.max(0.1, first.speed)))),
        blend: id === 'patternInterrupt' ? 0.16 : 0.24,
        locked: false,
      };
      nextClips = project.clips.map((clip, index) => index === 0
        ? { ...clip, camera: [...keptCamera, camera].sort((a, b) => a.start - b.start) }
        : clip);
      added += 1;
    }
  } else {
    skipped.push('camera angle (add a clip first)');
  }

  return {
    project: { ...project, captions: nextCaptions, graphics: nextGraphics, clips: nextClips },
    added,
    skipped,
  };
}
