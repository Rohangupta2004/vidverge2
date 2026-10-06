/**
 * Short Video Enhancer — the SOUND DESIGN layer.
 *
 * Short-form motion without sound design reads as a silent animation. This
 * module owns the dedicated SFX track that sits on top of the stack:
 *
 *   VIDEO → BACKGROUND MG → FOREGROUND MG → CAPTIONS → AUDIO SFX
 *
 * WHERE THE SOUNDS COME FROM. There is no royalty-free sample library on the
 * platform and hotlinking someone else's CDN would be a broken dependency, so
 * the nine effects are SYNTHESISED here, deterministically, and uploaded once
 * to the workspace's own file storage. A server-owned registry makes the first
 * stored URL visible to every visitor. If that shared route is unavailable,
 * the same browser synthesis and session cache remain the fallback, so sound
 * design never depends on the registry being healthy. The durable URL is also
 * what the render service reads; nothing is generated at render time, so the
 * preview and the export hear the same audio.
 *
 * WHERE THE SOUNDS GO. `planSoundDesign` reads the compiled timeline and
 * proposes a placement for every transition, every emphasised caption word and
 * every graphic entry — the three moments that carry a short-form edit. The
 * plan is reviewable: nothing is added until it is applied, a placement can be
 * unticked, and an applied clip is an ordinary draggable audio layer
 * afterwards with its own volume and fades.
 */

import {
  clamp, nearestBeat, newAudioTrack, round3, uid,
  type AudioTrack, type CompiledTimeline, type Project, type SfxAnchor, type TransitionId,
} from './model';
import { findAsset, recordAsset, recordSharedSfxAsset, uploadAsset } from './api';

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

export type SfxId =
  | 'whoosh' | 'pop' | 'click' | 'impact' | 'riser'
  | 'bassHit' | 'uiClick' | 'transition' | 'textEmphasis';

export interface SfxSpec {
  id: SfxId;
  label: string;
  blurb: string;
  /** Length of the rendered sound, in seconds. */
  duration: number;
  /** Sensible level for this sound against a voice track. */
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export const SFX_LIBRARY: SfxSpec[] = [
  { id: 'whoosh', label: 'Whoosh', blurb: 'Air pass for a pan, a push or a slide.', duration: 0.55, volume: 0.5, fadeIn: 0.01, fadeOut: 0.08 },
  { id: 'pop', label: 'Pop', blurb: 'Short blip for a graphic appearing.', duration: 0.16, volume: 0.45, fadeIn: 0.004, fadeOut: 0.04 },
  { id: 'click', label: 'Click', blurb: 'Dry tick for a cut or a hard change.', duration: 0.06, volume: 0.4, fadeIn: 0.002, fadeOut: 0.02 },
  { id: 'impact', label: 'Impact', blurb: 'Weighted hit for a zoom, a scale or a burst.', duration: 0.52, volume: 0.6, fadeIn: 0.004, fadeOut: 0.1 },
  { id: 'riser', label: 'Riser', blurb: 'Builds tension into the first cut or the hook.', duration: 1.4, volume: 0.42, fadeIn: 0.05, fadeOut: 0.06 },
  { id: 'bassHit', label: 'Bass Hit', blurb: 'Low drop under a statement or a reveal.', duration: 0.68, volume: 0.55, fadeIn: 0.004, fadeOut: 0.16 },
  { id: 'uiClick', label: 'UI Click', blurb: 'Interface tick for a cursor, a card or a toggle.', duration: 0.08, volume: 0.38, fadeIn: 0.002, fadeOut: 0.025 },
  { id: 'transition', label: 'Transition', blurb: 'Whoosh with a bright tail, for a scene handoff.', duration: 0.7, volume: 0.5, fadeIn: 0.01, fadeOut: 0.12 },
  { id: 'textEmphasis', label: 'Text Emphasis', blurb: 'Bright accent for a stressed caption word.', duration: 0.24, volume: 0.4, fadeIn: 0.003, fadeOut: 0.06 },
];

export function sfxSpec(id: string): SfxSpec {
  return SFX_LIBRARY.find((s) => s.id === id) || SFX_LIBRARY[0];
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44100;

/**
 * A deterministic noise source. The browser's own RNG would give a different
 * sound every time the asset was regenerated; this gives byte-identical audio
 * for the same effect on every machine, which is what makes caching the
 * uploaded file honest.
 */
function noiseSource(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

function synthesise(id: SfxId): Float32Array {
  const spec = sfxSpec(id);
  const n = Math.max(16, Math.ceil(spec.duration * SAMPLE_RATE));
  const out = new Float32Array(n);
  const rnd = noiseSource(0x5f3a + id.length * 977);
  let phase = 0;
  let lowpass = 0;
  let previous = 0;

  for (let i = 0; i < n; i++) {
    const t = i / n;
    const sec = i / SAMPLE_RATE;
    let sample = 0;

    if (id === 'whoosh' || id === 'transition') {
      // Band-swept noise: the cutoff opens through the middle of the sound and
      // closes again, which is what reads as air moving past the mic.
      const cut = 0.03 + 0.46 * Math.sin(Math.PI * Math.pow(t, 0.8));
      lowpass += cut * (rnd() - lowpass);
      const thin = lowpass - previous;
      previous = lowpass;
      const env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 1.5);
      sample = thin * env * 2.6;
      if (id === 'transition' && t > 0.46) {
        // The bright tail that says 'and now we are somewhere else'.
        const tail = (t - 0.46) / 0.54;
        phase += (2 * Math.PI * (2400 - 1500 * tail)) / SAMPLE_RATE;
        sample += Math.sin(phase) * 0.22 * Math.pow(1 - tail, 2.4);
      }
    } else if (id === 'pop') {
      phase += (2 * Math.PI * (880 - 620 * t)) / SAMPLE_RATE;
      sample = Math.sin(phase) * Math.exp(-sec * 26);
      sample += rnd() * 0.16 * Math.exp(-sec * 90);
    } else if (id === 'click') {
      const raw = rnd();
      const thin = raw - previous;
      previous = raw;
      sample = thin * Math.exp(-sec * 150) * 1.4;
    } else if (id === 'uiClick') {
      phase += (2 * Math.PI * (t < 0.4 ? 2300 : 3200)) / SAMPLE_RATE;
      sample = Math.sin(phase) * Math.exp(-sec * 110) * 0.8;
    } else if (id === 'impact') {
      phase += (2 * Math.PI * (150 - 100 * Math.pow(t, 0.4))) / SAMPLE_RATE;
      sample = Math.sin(phase) * Math.exp(-sec * 7.5);
      lowpass += 0.22 * (rnd() - lowpass);
      sample += lowpass * 0.85 * Math.exp(-sec * 24);
    } else if (id === 'bassHit') {
      phase += (2 * Math.PI * (92 - 54 * Math.pow(t, 0.35))) / SAMPLE_RATE;
      // A touch of saturation gives the fundamental something to carry on a
      // phone speaker, which cannot reproduce 40Hz at all.
      sample = Math.tanh(Math.sin(phase) * 1.8) * Math.exp(-sec * 5);
    } else if (id === 'riser') {
      const cut = 0.02 + 0.42 * Math.pow(t, 2.1);
      lowpass += cut * (rnd() - lowpass);
      phase += (2 * Math.PI * (220 + 1180 * Math.pow(t, 2))) / SAMPLE_RATE;
      sample = (lowpass * 1.5 + Math.sin(phase) * 0.3) * Math.pow(t, 1.3);
    } else {
      // textEmphasis — a bright accent with its octave, so it cuts through
      // speech without having to be loud.
      phase += (2 * Math.PI * (700 + 420 * t)) / SAMPLE_RATE;
      sample = (Math.sin(phase) + Math.sin(phase * 2) * 0.34) * Math.exp(-sec * 17);
    }

    out[i] = sample;
  }

  // Normalise to a fixed peak rather than clamping to it. Several of these
  // voices (the whoosh, the riser, the impact) naturally overshoot full scale,
  // and clamping them would render as hard distortion instead of a loud sound.
  // Scaling the whole buffer keeps the shape and makes every effect arrive at
  // the same headroom, so the per-clip volume in the editor means something.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(out[i]);
    if (Number.isFinite(a) && a > peak) peak = a;
  }
  const gain = peak > 0.0001 ? 0.89 / peak : 0;
  for (let i = 0; i < n; i++) out[i] = Number.isFinite(out[i]) ? out[i] * gain : 0;

  // A short head and tail ramp, so no effect can ever start or end on a click.
  const ramp = Math.min(96, Math.floor(n / 8));
  for (let i = 0; i < ramp; i++) {
    out[i] *= i / ramp;
    out[n - 1 - i] *= i / ramp;
  }
  return out;
}

/** 16-bit mono WAV of a rendered effect. */
function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// ---------------------------------------------------------------------------
// Durable URLs
// ---------------------------------------------------------------------------

const ASSET_KIND = 'sfx-library';
const memoryCache = new Map<string, string>();

/**
 * The stored URL for one effect, rendering and uploading it the first time it
 * is ever asked for. Cached three deep: this tab, the workspace-wide server
 * registry, then this visitor's asset rows. The render service always reads a
 * real stored file rather than anything generated at render time.
 *
 * The shared route is deliberately non-fatal. If lookup or registration fails,
 * synthesis, upload, and the original session-owned row still run exactly as
 * before; deterministic synthesis makes that replacement byte-identical.
 */
export async function sfxUrl(id: SfxId): Promise<string> {
  const cached = memoryCache.get(id);
  if (cached) return cached;

  const stored = await findAsset(ASSET_KIND, id);
  if (stored) {
    memoryCache.set(id, stored);
    return stored;
  }

  const spec = sfxSpec(id);
  const blob = encodeWav(synthesise(id));
  const file = new File([blob], 'sve-sfx-' + id + '.wav', { type: 'audio/wav' });
  const up = await uploadAsset(file, 'short-video-enhancer/sfx');
  const fields = {
    kind: ASSET_KIND,
    label: id,
    url: up.url,
    mime: 'audio/wav',
    bytes: up.bytes,
    duration_s: spec.duration,
    meta: { synthesised: true, sampleRate: SAMPLE_RATE },
  };

  let resolvedUrl = up.url;
  try {
    const sharedUrl = await recordSharedSfxAsset(fields);
    if (sharedUrl) resolvedUrl = sharedUrl;
    else void recordAsset(fields);
  } catch (e) {
    console.warn('[ShortVideoEnhancer] shared SFX registration failed; keeping the local asset row:', e);
    void recordAsset(fields);
  }

  memoryCache.set(id, resolvedUrl);
  return resolvedUrl;
}

/** An SFX layer for one library sound at one timestamp. */
export function newSfxTrack(id: SfxId, url: string, at: number, anchor: SfxAnchor = 'manual', anchorNote = ''): AudioTrack {
  const spec = sfxSpec(id);
  const track = newAudioTrack('sfx', spec.label, url, Math.max(0, at));
  return {
    ...track,
    sfxId: id,
    duration: spec.duration,
    volume: spec.volume,
    fadeIn: spec.fadeIn,
    fadeOut: spec.fadeOut,
    anchor,
    anchorNote,
  };
}

// ---------------------------------------------------------------------------
// Auto-alignment
// ---------------------------------------------------------------------------

/** Which effect a transition type wants under it. */
const TRANSITION_SFX: Record<TransitionId, SfxId> = {
  zoom: 'impact',
  whipPan: 'whoosh',
  motionBlur: 'whoosh',
  push: 'whoosh',
  slide: 'whoosh',
  scale: 'impact',
  spin: 'transition',
  glitch: 'click',
  lightSweep: 'transition',
  maskReveal: 'transition',
};

/** Which effect a graphic entry wants, by how heavy the primitive is. */
function graphicSfx(type: string): SfxId {
  if (type === 'confetti' || type === 'radialBurst' || type === 'fireSparks') return 'impact';
  if (type === 'uiCard' || type === 'browserMockup' || type === 'phoneMockup'
    || type === 'featureCard' || type === 'notification' || type === 'cursorClick') return 'uiClick';
  if (type === 'lightStreak' || type === 'speedLines' || type === 'glowRing') return 'whoosh';
  return 'pop';
}

/** The caption styles that read as an emphasis beat worth punctuating. */
const EMPHASIS_STYLES = ['huge', 'highlighted', 'differentColor', 'kinetic'];

export interface SfxPlacement {
  id: string;
  sfxId: SfxId;
  /** Absolute timeline seconds. */
  at: number;
  anchor: SfxAnchor;
  note: string;
  /** True when the placement was pulled onto a detected music beat. */
  onBeat: boolean;
  enabled: boolean;
}

export interface SoundPlan {
  placements: SfxPlacement[];
  note: string;
  generatedAt: number;
}

/**
 * Propose where the SFX track should be punctuated.
 *
 * A sound lands slightly BEFORE the event it belongs to — a whoosh that starts
 * on the cut is already late by the time the ear registers it — so each
 * placement carries its own small pre-roll. With beat sync on, a placement is
 * then pulled onto the nearest detected beat when one is within tolerance.
 */
export function planSoundDesign(project: Project, timeline: CompiledTimeline): SoundPlan {
  const fps = project.canvas.fps || 30;
  const duration = Math.max(0.5, timeline.durationS);
  const beatsOn = project.beats.syncEnabled && project.beats.times.length > 0;
  const raw: SfxPlacement[] = [];

  const push = (sfxId: SfxId, at: number, anchor: SfxAnchor, note: string) => {
    let when = round3(clamp(at, 0, Math.max(0, duration - 0.05)));
    let onBeat = false;
    if (beatsOn) {
      const snap = nearestBeat(project.beats, when);
      if (snap !== null) { when = snap; onBeat = true; }
    }
    raw.push({ id: uid('sfx'), sfxId, at: when, anchor, note, onBeat, enabled: true });
  };

  // 1 — the hook. A riser into the opening and a hit on the handover.
  const hook = project.hook && project.hook.enabled ? project.hook : null;
  if (hook) {
    const riserLength = sfxSpec('riser').duration;
    push('riser', Math.max(0, hook.duration - riserLength * 0.82), 'hook', 'Builds into the end of the ' + hook.template + ' hook.');
    push('bassHit', Math.max(0, hook.duration - 0.06), 'hook', 'Lands the hook as the footage takes over.');
  }

  // 2 — transitions. Only the ones that actually run: a cut with no footage to
  // animate on gets no whoosh, because there is nothing to whoosh over.
  for (const tr of timeline.transitions) {
    const at = tr.from / fps;
    push(TRANSITION_SFX[tr.type] || 'whoosh', at - 0.05, 'transition',
      'Under the ' + tr.type + ' handoff at ' + at.toFixed(2) + 's.');
  }

  // 3 — text animations, on the emphasised word of each cue only. One accent
  // per spoken word would be a machine gun, not sound design.
  for (const cue of project.captions) {
    if (!cue.enabled) continue;
    const hit = cue.words.find((w) => EMPHASIS_STYLES.indexOf(w.style) >= 0);
    if (!hit) continue;
    push('textEmphasis', hit.start - 0.03, 'textAnimation', 'Accents the stressed word \u201c' + hit.text + '\u201d.');
  }

  // 4 — graphic entries.
  for (const g of project.graphics) {
    if (!g.enabled) continue;
    push(graphicSfx(g.type), g.start - 0.04, 'graphicEntry', 'Marks the ' + g.type + ' entering at ' + g.start.toFixed(2) + 's.');
  }

  // Two effects on top of each other is mud, not emphasis: keep the first of
  // any cluster and drop the rest.
  raw.sort((a, b) => a.at - b.at);
  const placements: SfxPlacement[] = [];
  for (const next of raw) {
    const previous = placements[placements.length - 1];
    if (previous && next.at - previous.at < 0.11) continue;
    placements.push(next);
  }

  const onBeat = placements.filter((p) => p.onBeat).length;
  return {
    placements,
    generatedAt: Date.now(),
    note: placements.length
      ? placements.length + ' placement' + (placements.length === 1 ? '' : 's') + ' across ' + duration.toFixed(1) + 's' +
        (beatsOn ? ', ' + onBeat + ' pulled onto a detected beat' : '') +
        '. Untick anything you do not want, then add them to the SFX track.'
      : 'Nothing to punctuate yet \u2014 add a transition, a caption or a motion graphic and plan again.',
  };
}

/**
 * Turn the ticked placements into real SFX layers.
 *
 * Every sound the plan needs is resolved to its stored URL first, so a single
 * apply uploads at most one copy of each effect no matter how many times it is
 * used. A placement whose sound could not be stored is reported rather than
 * added as a silent layer.
 */
export async function applySoundPlan(project: Project, plan: SoundPlan): Promise<{ project: Project; added: number; note: string }> {
  const wanted = plan.placements.filter((p) => p.enabled);
  if (!wanted.length) return { project, added: 0, note: 'Nothing was ticked, so the SFX track is unchanged.' };

  const urls = new Map<string, string>();
  const failed: string[] = [];
  const unique = Array.from(new Set(wanted.map((p) => p.sfxId)));
  for (const id of unique) {
    try {
      urls.set(id, await sfxUrl(id as SfxId));
    } catch (e) {
      failed.push(sfxSpec(id).label + ' (' + (e instanceof Error ? e.message : String(e)) + ')');
    }
  }

  const existing = project.audio.sfx;
  const tracks: AudioTrack[] = [];
  for (const placement of wanted) {
    const url = urls.get(placement.sfxId);
    if (!url) continue;
    // Never stack a second copy of the same sound on a moment that already has
    // one — re-planning after an edit must be safe to apply twice.
    const clash = existing.some((s) => s.sfxId === placement.sfxId && Math.abs(s.at - placement.at) < 0.06);
    if (clash) continue;
    tracks.push(newSfxTrack(placement.sfxId, url, placement.at, placement.anchor, placement.note));
  }

  const note = [
    tracks.length ? tracks.length + ' sound(s) added to the SFX track.' : 'Every ticked placement was already on the track.',
    failed.length ? 'Could not store: ' + failed.join('; ') + '.' : '',
  ].filter(Boolean).join(' ');

  return {
    project: {
      ...project,
      audio: { ...project.audio, sfx: [...existing, ...tracks].sort((a, b) => a.at - b.at) },
    },
    added: tracks.length,
    note,
  };
}

/**
 * How well the SFX track is actually aligned, for the quality gate and the
 * sound panel. An effect counts as aligned when it sits within `tolerance` of
 * a transition, an emphasised caption word, a graphic entry or the hook.
 */
export function sfxAlignment(project: Project, timeline: CompiledTimeline, tolerance = 0.14): {
  total: number; aligned: number; strays: { at: number; label: string }[];
} {
  const fps = project.canvas.fps || 30;
  const events: number[] = [];
  for (const tr of timeline.transitions) events.push(tr.from / fps);
  for (const cue of project.captions) {
    if (!cue.enabled) continue;
    for (const w of cue.words) if (EMPHASIS_STYLES.indexOf(w.style) >= 0) events.push(w.start);
  }
  for (const g of project.graphics) if (g.enabled) events.push(g.start);
  const hook = project.hook && project.hook.enabled ? project.hook : null;
  if (hook) { events.push(0); events.push(hook.duration); }

  const strays: { at: number; label: string }[] = [];
  let aligned = 0;
  const live = project.audio.sfx.filter((s) => s.enabled && s.url);
  for (const s of live) {
    // A sound is deliberately placed a little ahead of its event, so the window
    // reaches further forward than back.
    const hit = events.some((e) => s.at >= e - tolerance - 0.1 && s.at <= e + tolerance);
    if (hit) aligned += 1;
    else strays.push({ at: s.at, label: s.label });
  }
  return { total: live.length, aligned, strays };
}
