// CineAgent — plan validation, timing math, and caption baking.
//
// The director authors intent; THIS file makes it executable. Every timestamp
// is clamped to real footage, every overlay is clamped to the output timeline,
// asset references are checked, and captions are computed deterministically
// from the transcript + the final cut — the model never hand-times captions.

import type {
  AnalysisReport, AssetSpec, CaptionCue, EditPlan, GeneratedAsset, Overlay,
  RenderPlan, Segment, SourceVideo, TranscriptWord, UserPrefs,
} from './types';
import { FPS, MAX_IMAGE_ASSETS, MAX_RENDER_SEC, MAX_VIDEO_ASSETS } from './types';

const HEX = /^#[0-9a-fA-F]{6}$/;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fixColor(value: unknown, fallback: string): string {
  const raw = String(value || '').trim();
  return HEX.test(raw) ? raw : fallback;
}

let idCounter = 0;
function freshId(prefix: string): string {
  idCounter += 1;
  return prefix + '_' + Date.now().toString(36) + '_' + idCounter;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export interface NormalizeResult {
  plan: EditPlan;
  warnings: string[];
}

export function normalizePlan(
  raw: EditPlan,
  source: SourceVideo,
  prefs: UserPrefs | null,
): NormalizeResult {
  const warnings: string[] = [];
  const plan: EditPlan = JSON.parse(JSON.stringify(raw || {}));

  plan.title = String(plan.title || source.name || 'Untitled cut').slice(0, 120);
  plan.logline = String(plan.logline || '').slice(0, 400);
  plan.contentType = String(plan.contentType || 'video');
  plan.direction = String(plan.direction || '');

  const id = plan.identity || ({} as EditPlan['identity']);
  plan.identity = {
    primary: fixColor(id.primary, '#f59e0b'),
    secondary: fixColor(id.secondary, '#111120'),
    accent: fixColor(id.accent, '#22d3ee'),
    bg: fixColor(id.bg, '#0a0a12'),
    text: fixColor(id.text, '#ffffff'),
    fontStyle: (['modern', 'editorial', 'bold', 'mono', 'elegant'] as const).includes(id.fontStyle as any)
      ? id.fontStyle : 'modern',
    tone: String(id.tone || ''),
  };

  const frameMode = prefs?.framing && prefs.framing !== 'auto'
    ? prefs.framing
    : (plan.frame?.mode === 'cover' ? 'cover' : 'fit');
  plan.frame = { mode: frameMode, bgBlur: plan.frame?.bgBlur !== false };

  // --- assets: cap counts, require prompts, unique ids ----------------------
  const assetSpecs: AssetSpec[] = [];
  let videoCount = 0;
  let imageCount = 0;
  (Array.isArray(plan.assets) ? plan.assets : []).forEach((a) => {
    if (!a || !a.prompt || !a.id) return;
    if (a.kind === 'video') {
      if (videoCount >= MAX_VIDEO_ASSETS) { warnings.push('Dropped video asset ' + a.id + ' (budget cap)'); return; }
      videoCount += 1;
      assetSpecs.push({
        id: String(a.id), kind: 'video', prompt: String(a.prompt).slice(0, 2500),
        model: (['seedance', 'veo-fast', 'veo', 'omni'] as const).includes(a.model as any) ? a.model : 'seedance',
        durationSec: clamp(Number(a.durationSec || 6), 4, 8),
        referenceFrameT: a.referenceFrameT != null ? clamp(Number(a.referenceFrameT), 0, source.duration) : undefined,
        style: a.style ? String(a.style).slice(0, 300) : undefined,
      });
    } else {
      if (imageCount >= MAX_IMAGE_ASSETS) { warnings.push('Dropped image asset ' + a.id + ' (budget cap)'); return; }
      imageCount += 1;
      assetSpecs.push({ id: String(a.id), kind: 'image', prompt: String(a.prompt).slice(0, 2500), style: a.style ? String(a.style).slice(0, 300) : undefined });
    }
  });
  plan.assets = assetSpecs;
  const assetIds = new Set(assetSpecs.map((a) => a.id));

  // --- timeline --------------------------------------------------------------
  const segments: Segment[] = [];
  (Array.isArray(plan.timeline) ? plan.timeline : []).forEach((seg) => {
    if (!seg) return;
    const s: Segment = { ...seg, id: String(seg.id || freshId('seg')) };
    if (s.transitionIn) {
      s.transitionIn = {
        type: (['cut', 'fade', 'dip', 'slide', 'zoom', 'whip'] as const).includes(s.transitionIn.type as any)
          ? s.transitionIn.type : 'fade',
        duration: clamp(Number(s.transitionIn.duration || 0.4), 0.1, 1.2),
      };
      if (s.transitionIn.type === 'cut') delete s.transitionIn;
    }
    if (s.kind === 'source') {
      const start = clamp(Number(s.src?.start ?? 0), 0, Math.max(0, source.duration - 0.2));
      const end = clamp(Number(s.src?.end ?? 0), start + 0.2, source.duration);
      if (end - start < 0.25) { warnings.push('Dropped segment ' + s.id + ' (too short)'); return; }
      s.src = { start: round2(start), end: round2(end), volume: clamp(Number(s.src?.volume ?? 1), 0, 1) };
      delete s.duration;
      segments.push(s);
    } else if (s.kind === 'generated') {
      if (!s.assetId || !assetIds.has(s.assetId)) { warnings.push('Dropped segment ' + s.id + ' (unknown asset)'); return; }
      s.duration = clamp(Number(s.duration || 6), 1.5, 10);
      segments.push(s);
    } else if (s.kind === 'board') {
      if (!s.board || !s.board.type) { warnings.push('Dropped board segment ' + s.id + ' (no spec)'); return; }
      s.board = sanitizeSpec(s.board, assetIds);
      if (!s.board) { warnings.push('Dropped board segment ' + s.id + ' (invalid spec)'); return; }
      s.duration = clamp(Number(s.duration || 4), 1.5, 12);
      segments.push(s);
    }
  });
  if (!segments.length) {
    // Never ship an empty cut — fall back to the whole source.
    warnings.push('The plan had no usable segments; keeping the full footage.');
    segments.push({ id: freshId('seg'), kind: 'source', src: { start: 0, end: source.duration, volume: 1 } });
  }
  // First segment never opens on a transition.
  if (segments[0].transitionIn) delete segments[0].transitionIn;
  plan.timeline = segments;

  const timing = computeTiming(plan);

  // --- overlays --------------------------------------------------------------
  const overlays: Overlay[] = [];
  (Array.isArray(plan.overlays) ? plan.overlays : []).forEach((ov) => {
    if (!ov || !ov.spec) return;
    const spec = sanitizeSpec(ov.spec, assetIds);
    if (!spec) { warnings.push('Dropped overlay ' + (ov.id || '?') + ' (invalid spec)'); return; }
    const at = clamp(Number(ov.at || 0), 0, Math.max(0, timing.duration - 0.8));
    const duration = clamp(Number(ov.duration || 3), 0.8, Math.max(1, timing.duration - at));
    overlays.push({
      id: String(ov.id || freshId('ov')),
      at: round2(at),
      duration: round2(duration),
      anchor: (['lower-third', 'center', 'top', 'left-panel', 'right-panel', 'full', 'corner'] as const).includes(ov.anchor as any)
        ? ov.anchor : 'lower-third',
      spec,
      note: ov.note ? String(ov.note).slice(0, 300) : undefined,
    });
  });
  overlays.sort((a, b) => a.at - b.at);
  plan.overlays = overlays;

  // --- captions / audio ------------------------------------------------------
  const capPref = prefs?.captions || 'auto';
  const capEnabled = capPref === 'on' ? true : capPref === 'off' ? false : plan.captions?.enabled !== false;
  plan.captions = {
    enabled: capEnabled,
    style: {
      preset: (['clean', 'bold', 'karaoke', 'minimal', 'editorial'] as const).includes(plan.captions?.style?.preset as any)
        ? plan.captions.style.preset : 'clean',
      position: (['bottom', 'lower', 'center'] as const).includes(plan.captions?.style?.position as any)
        ? plan.captions.style.position : 'bottom',
    },
  };

  const musicPref = prefs?.music || 'auto';
  const audio = plan.audio || ({} as EditPlan['audio']);
  plan.audio = {
    keepOriginal: audio.keepOriginal !== false,
    originalVolume: clamp(Number(audio.originalVolume ?? 1), 0, 1),
    music: musicPref === 'off' ? null : (audio.music && audio.music.prompt ? {
      prompt: String(audio.music.prompt).slice(0, 800),
      volume: clamp(Number(audio.music.volume ?? 0.18), 0.02, 0.5),
      duckTo: clamp(Number(audio.music.duckTo ?? 0.06), 0, 0.3),
    } : (musicPref === 'on' ? { prompt: 'Subtle modern underscore that supports the story without drawing attention', volume: 0.16, duckTo: 0.05 } : null)),
    narration: audio.narration && Array.isArray(audio.narration.segments) && audio.narration.segments.length
      ? {
        voiceId: audio.narration.voiceId ? String(audio.narration.voiceId) : undefined,
        segments: audio.narration.segments.slice(0, 20).map((s) => ({
          text: String(s.text || '').slice(0, 600),
          at: clamp(Number(s.at || 0), 0, Math.max(0, timing.duration - 1)),
        })).filter((s) => s.text.trim().length > 0),
      }
      : null,
  };

  return { plan, warnings };
}

/** Validates one MotionSpec; returns null when it cannot be rendered. */
function sanitizeSpec(spec: any, assetIds: Set<string>): any | null {
  if (!spec || typeof spec !== 'object' || !spec.type) return null;
  const t = String(spec.type);
  const str = (v: unknown, max = 300) => String(v == null ? '' : v).slice(0, max);
  switch (t) {
    case 'kineticTitle':
      if (!spec.text) return null;
      return { type: t, text: str(spec.text, 140), subtext: spec.subtext ? str(spec.subtext, 200) : undefined, style: ['rise', 'split', 'assemble', 'typeOn', 'blur', 'punch'].includes(spec.style) ? spec.style : 'rise', size: ['sm', 'md', 'lg', 'xl'].includes(spec.size) ? spec.size : 'lg' };
    case 'lowerThird':
      if (!spec.title) return null;
      return { type: t, title: str(spec.title, 90), subtitle: spec.subtitle ? str(spec.subtitle, 120) : undefined };
    case 'callout':
      if (!spec.text) return null;
      return { type: t, text: str(spec.text, 160), x: clamp(Number(spec.x ?? 50), 2, 98), y: clamp(Number(spec.y ?? 50), 2, 98), pointerTo: spec.pointerTo ? { x: clamp(Number(spec.pointerTo.x ?? 50), 0, 100), y: clamp(Number(spec.pointerTo.y ?? 50), 0, 100) } : undefined };
    case 'stat':
      if (!Number.isFinite(Number(spec.value))) return null;
      return { type: t, value: Number(spec.value), prefix: spec.prefix ? str(spec.prefix, 8) : undefined, suffix: spec.suffix ? str(spec.suffix, 12) : undefined, label: str(spec.label, 90) };
    case 'barChart': {
      const items = (Array.isArray(spec.items) ? spec.items : []).slice(0, 8)
        .map((i: any) => ({ label: str(i?.label, 40), value: Number(i?.value) }))
        .filter((i: any) => i.label && Number.isFinite(i.value));
      if (items.length < 2) return null;
      return { type: t, title: spec.title ? str(spec.title, 90) : undefined, items, unit: spec.unit ? str(spec.unit, 12) : undefined };
    }
    case 'list': {
      const items = (Array.isArray(spec.items) ? spec.items : []).slice(0, 7).map((i: any) => str(i, 90)).filter(Boolean);
      if (!items.length) return null;
      return { type: t, title: spec.title ? str(spec.title, 90) : undefined, items };
    }
    case 'quote':
      if (!spec.text) return null;
      return { type: t, text: str(spec.text, 280), attribution: spec.attribution ? str(spec.attribution, 80) : undefined };
    case 'chapter':
      if (!spec.title) return null;
      return { type: t, index: Number.isFinite(Number(spec.index)) ? Number(spec.index) : undefined, title: str(spec.title, 90), subtitle: spec.subtitle ? str(spec.subtitle, 140) : undefined };
    case 'badge':
      if (!spec.text) return null;
      return { type: t, text: str(spec.text, 48) };
    case 'image':
      if (!spec.assetId || !assetIds.has(String(spec.assetId))) return null;
      return { type: t, assetId: String(spec.assetId), motion: ['kenburns', 'parallax', 'pop'].includes(spec.motion) ? spec.motion : 'kenburns', caption: spec.caption ? str(spec.caption, 120) : undefined };
    case 'progress':
      return { type: t, label: spec.label ? str(spec.label, 80) : undefined, from: Number(spec.from || 0), to: Number(spec.to || 100), suffix: spec.suffix ? str(spec.suffix, 10) : undefined };
    case 'timeline': {
      const items = (Array.isArray(spec.items) ? spec.items : []).slice(0, 6)
        .map((i: any) => ({ label: str(i?.label, 50), detail: i?.detail ? str(i.detail, 90) : undefined }))
        .filter((i: any) => i.label);
      if (items.length < 2) return null;
      return { type: t, title: spec.title ? str(spec.title, 90) : undefined, items };
    }
    case 'keyword': {
      const words = (Array.isArray(spec.words) ? spec.words : []).slice(0, 6).map((w: any) => str(w, 32)).filter(Boolean);
      if (!words.length) return null;
      return { type: t, words };
    }
    case 'custom': {
      const layers = (Array.isArray(spec.layers) ? spec.layers : []).slice(0, 16).map((l: any) => sanitizeLayer(l, assetIds)).filter(Boolean);
      if (!layers.length) return null;
      return { type: t, bg: spec.bg && HEX.test(String(spec.bg)) ? String(spec.bg) : undefined, layers };
    }
    default:
      return null;
  }
}

function sanitizeLayer(l: any, assetIds: Set<string>): any | null {
  if (!l || !['text', 'rect', 'ellipse', 'line', 'image'].includes(l.kind)) return null;
  if (l.kind === 'text' && !l.text) return null;
  if (l.kind === 'image' && (!l.assetId || !assetIds.has(String(l.assetId)))) return null;
  const state = (s: any) => ({
    x: s?.x != null ? clamp(Number(s.x), -30, 130) : undefined,
    y: s?.y != null ? clamp(Number(s.y), -30, 130) : undefined,
    w: s?.w != null ? clamp(Number(s.w), 0.2, 120) : undefined,
    h: s?.h != null ? clamp(Number(s.h), 0.2, 120) : undefined,
    scale: s?.scale != null ? clamp(Number(s.scale), 0.05, 6) : undefined,
    rotate: s?.rotate != null ? clamp(Number(s.rotate), -360, 360) : undefined,
    opacity: s?.opacity != null ? clamp(Number(s.opacity), 0, 1) : undefined,
    blur: s?.blur != null ? clamp(Number(s.blur), 0, 40) : undefined,
  });
  const start = clamp(Number(l.start || 0), 0, 60);
  return {
    kind: l.kind,
    text: l.text ? String(l.text).slice(0, 200) : undefined,
    assetId: l.assetId ? String(l.assetId) : undefined,
    color: l.color && HEX.test(String(l.color)) ? String(l.color) : undefined,
    fontSize: l.fontSize != null ? clamp(Number(l.fontSize), 12, 220) : undefined,
    weight: l.weight != null ? clamp(Number(l.weight), 300, 900) : undefined,
    radius: l.radius != null ? clamp(Number(l.radius), 0, 200) : undefined,
    start,
    end: clamp(Number(l.end || start + 2), start + 0.1, 90),
    ease: ['linear', 'out', 'inOut', 'spring'].includes(l.ease) ? l.ease : 'out',
    from: state(l.from),
    to: state(l.to),
  };
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface SegmentTiming {
  id: string;
  outStart: number;
  outDuration: number;
  segment: Segment;
}

export interface PlanTiming {
  duration: number;
  segments: SegmentTiming[];
}

export function segmentDuration(seg: Segment): number {
  if (seg.kind === 'source' && seg.src) return Math.max(0.2, seg.src.end - seg.src.start);
  return Math.max(0.5, Number(seg.duration || 4));
}

export function computeTiming(plan: EditPlan): PlanTiming {
  let cursor = 0;
  const segments: SegmentTiming[] = plan.timeline.map((seg) => {
    const d = segmentDuration(seg);
    const t = { id: seg.id, outStart: round2(cursor), outDuration: round2(d), segment: seg };
    cursor += d;
    return t;
  });
  return { duration: round2(cursor), segments };
}

/** Map a SOURCE timestamp to OUTPUT time, or null when that moment was cut. */
export function sourceToOutput(timing: PlanTiming, srcT: number): number | null {
  for (const st of timing.segments) {
    const seg = st.segment;
    if (seg.kind !== 'source' || !seg.src) continue;
    if (srcT >= seg.src.start && srcT < seg.src.end) {
      return round2(st.outStart + (srcT - seg.src.start));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Captions — baked from the transcript through the final cut
// ---------------------------------------------------------------------------

export function buildCaptionCues(words: TranscriptWord[], plan: EditPlan): CaptionCue[] {
  const timing = computeTiming(plan);
  // Collect surviving words with output timestamps.
  const survivors: { w: string; at: number; d: number }[] = [];
  words.forEach((word) => {
    const mid = (word.s + word.e) / 2;
    const at = sourceToOutput(timing, mid);
    if (at == null) return;
    survivors.push({ w: word.w, at: round2(at - (mid - word.s)), d: round2(Math.max(0.08, word.e - word.s)) });
  });
  survivors.sort((a, b) => a.at - b.at);

  const cues: CaptionCue[] = [];
  let current: { at: number; words: { w: string; t: number; d: number }[]; lastEnd: number; chars: number } | null = null;
  const flush = () => {
    if (!current || !current.words.length) { current = null; return; }
    cues.push({
      at: round2(current.at),
      duration: round2(Math.max(0.6, current.lastEnd - current.at + 0.12)),
      words: current.words,
    });
    current = null;
  };
  survivors.forEach((word) => {
    const gap = current ? word.at - current.lastEnd : 0;
    const wordEndsSentence = /[.!?]$/.test(word.w);
    if (!current) {
      current = { at: word.at, words: [], lastEnd: word.at, chars: 0 };
    } else if (gap > 0.8 || current.chars > 34 || current.words.length >= 6) {
      flush();
      current = { at: word.at, words: [], lastEnd: word.at, chars: 0 };
    }
    current.words.push({ w: word.w, t: round2(Math.max(0, word.at - current.at)), d: word.d });
    current.lastEnd = Math.max(current.lastEnd, word.at + word.d);
    current.chars += word.w.length + 1;
    if (wordEndsSentence) flush();
  });
  flush();
  return cues;
}

/** Per-output-second speech presence, derived from the baked captions. */
export function outputSpeechEnvelope(cues: CaptionCue[], duration: number): number[] {
  const seconds = Math.max(1, Math.ceil(duration));
  const env = new Array(seconds).fill(0);
  cues.forEach((cue) => {
    for (let s = Math.floor(cue.at); s < Math.min(seconds, Math.ceil(cue.at + cue.duration)); s += 1) env[s] = 1;
  });
  return env;
}

// ---------------------------------------------------------------------------
// Render plan assembly + chunking
// ---------------------------------------------------------------------------

export function assembleRenderPlan(
  plan: EditPlan,
  source: SourceVideo,
  analysis: AnalysisReport | null,
  assets: Record<string, GeneratedAsset>,
  musicUrl: string | null,
  narration: RenderPlan['narration'],
): RenderPlan {
  const timing = computeTiming(plan);
  const cues = plan.captions.enabled && analysis?.words?.length ? buildCaptionCues(analysis.words, plan) : [];
  return {
    plan,
    assets,
    captionCues: cues,
    musicUrl,
    narration,
    speechEnvelope: outputSpeechEnvelope(cues, timing.duration),
    source: { url: source.url, width: source.width, height: source.height, duration: source.duration },
    durationSec: timing.duration,
    fps: FPS,
    portrait: source.height > source.width,
  };
}

export interface RenderChunk {
  renderPlan: RenderPlan;
  durationSec: number;
  index: number;
}

/** Split a long plan into ≤9.5-minute chunks at segment boundaries. */
export function splitIntoChunks(full: RenderPlan): RenderChunk[] {
  if (full.durationSec <= MAX_RENDER_SEC) return [{ renderPlan: full, durationSec: full.durationSec, index: 0 }];
  const timing = computeTiming(full.plan);
  const chunks: RenderChunk[] = [];
  let group: SegmentTiming[] = [];
  let groupStart = 0;
  let groupDur = 0;
  const flush = () => {
    if (!group.length) return;
    const start = groupStart;
    const dur = groupDur;
    const sub: EditPlan = {
      ...full.plan,
      timeline: group.map((g, i) => {
        const seg = { ...g.segment };
        if (i === 0 && seg.transitionIn) delete seg.transitionIn;
        return seg;
      }),
      overlays: full.plan.overlays
        .filter((o) => o.at >= start - 0.01 && o.at < start + dur)
        .map((o) => ({ ...o, at: round2(o.at - start), duration: Math.min(o.duration, dur - (o.at - start)) })),
    };
    chunks.push({
      index: chunks.length,
      durationSec: round2(dur),
      renderPlan: {
        ...full,
        plan: sub,
        captionCues: full.captionCues
          .filter((c) => c.at >= start - 0.01 && c.at < start + dur)
          .map((c) => ({ ...c, at: round2(c.at - start) })),
        narration: full.narration ? {
          segments: full.narration.segments
            .filter((s) => s.at >= start - 0.01 && s.at < start + dur)
            .map((s) => ({ ...s, at: round2(s.at - start) })),
        } : null,
        speechEnvelope: full.speechEnvelope.slice(Math.floor(start), Math.ceil(start + dur) + 1),
        // The music track is one file: each chunk starts it at its own offset.
        musicStartSec: round2(start),
        durationSec: round2(dur),
      } as RenderPlan & { musicStartSec: number },
    });
    group = [];
    groupDur = 0;
  };
  timing.segments.forEach((st) => {
    if (groupDur > 0 && groupDur + st.outDuration > MAX_RENDER_SEC) flush();
    if (!group.length) groupStart = st.outStart;
    group.push(st);
    groupDur += st.outDuration;
  });
  flush();
  return chunks;
}

export function framesFor(durationSec: number): number {
  return Math.max(30, Math.round(durationSec * FPS));
}
