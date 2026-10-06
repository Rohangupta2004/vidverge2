// The Motion Graphics Editor's bridge to the platform's real media services.
//
// Division of labour, deliberately:
//   * THIS FILE (browser) produces artwork and compiles the edit manifest into
//     a render plan — a flat list of timed assets with directives. It draws
//     plates, uploads them, asks the AI proxy for copy, generates the music
//     bed, and uploads the base audio for timestamped transcription (only the
//     browser can post multipart form data).
//   * THE SERVER FUNCTIONS do the compositing and own the privileged writes:
//     `sceneforge-composite-video` runs the export pipeline,
//     `sceneforge-stitch-hyperframes` cuts card clips INTO the film, and
//     `sceneforge-caption-generate` turns word timings into caption segments.
//
// No ffmpeg runs in the browser and no canvas recording is ever passed off as
// an export: the finished MP4 always comes back from the platform.
import { WORKSPACE_ID } from './supabase';
import { workspaceToken } from './proxy';
import { renderBrandPlate, renderCaptionPlate, renderGrainPlate, renderLightLeakPlate, renderTextPlate, type PlateStepOptions } from './motionPlates';
import { atmosphereOf } from './motionPresets';
import {
  FRAME,
  layerEnd,
  type AspectRatio,
  type BrandLayer,
  type CaptionSegment,
  type EditorJob,
  type RenderJob,
  type TextLayer,
} from './motionEditor';

export const COMPOSITE_HOOK = 'sceneforge-composite-video';
export const STITCH_HOOK = 'sceneforge-stitch-hyperframes';
export const CAPTION_HOOK = 'sceneforge-caption-generate';

/**
 * How many timed assets one export may composite. Every overlay is another
 * ffmpeg input, and a server function's outbound request is cut off at 90
 * seconds, so a 200-plate export would fail after doing the work. The editor
 * reports the count before the customer presses Export instead.
 */
export const MAX_EXPORT_OVERLAYS = 28;

/** Each entrance is burned as a short sequence of plates, 0.12s per step. */
const STEP_SEC = 0.12;
const STEPS = 4;
const TYPE_STEPS = 6;

/**
 * Slots held back for film grain and the light leak. They are full-frame
 * plates that run the whole film, so they must still fit after every timed
 * layer has been placed — reserving them up front is what stops a busy
 * export from spending its last two inputs on a caption and silently
 * dropping the look the customer chose.
 */
const ATMOSPHERE_SLOTS = 2;

function hookUrl(name: string): string {
  return `/api/hooks/execute/workspace-660069/${name}`;
}
function sessionId(): string {
  return String((window as any).__spaceSessionId || '');
}
function unwrap(payload: any): any {
  if (payload && typeof payload === 'object' && payload.response !== undefined && payload._meta !== undefined) return payload.response;
  return payload;
}

export async function callEditorHook<T = any>(name: string, payload: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let token = '';
  try { token = workspaceToken(); } catch { token = ''; }
  if (token) headers['X-Workspace-DB-Token'] = token;
  const sid = sessionId();
  if (sid) headers['X-Session-Id'] = sid;
  const response = await fetch(hookUrl(name), { method: 'POST', headers, body: JSON.stringify({ session_id: sid, ...payload }) });
  const data = unwrap(await response.json().catch(() => null));
  if (!response.ok || !data || data.success === false || data.error) {
    throw new Error(String((data && data.error) || `${name} did not answer (HTTP ${response.status}).`));
  }
  return data as T;
}

// ——— AI copy suggestions ———

export interface CopySuggestion { headline: string; subheadline: string; caption: string }

/**
 * Ask the platform's text model for overlay copy drawn from the script the
 * avatar actually speaks. A refusal or an unparsable answer leaves the
 * customer's own copy untouched — it never writes placeholder text.
 */
export async function suggestOverlayCopy(script: string, brief: string): Promise<CopySuggestion> {
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 600,
      stream: false,
      messages: [
        {
          role: 'system',
          content: [
            'You write on-screen text for a short vertical video where a presenter is already speaking.',
            'The overlay must NOT repeat the spoken line word for word — it reinforces the point in far fewer words.',
            'Headline: at most 6 words. Subheadline: at most 12 words. Caption: at most 10 words, written as the closing line or call to action.',
            'No emoji, no hashtags, no quotation marks, no markdown.',
            'Reply with JSON only: {"headline":"...","subheadline":"...","caption":"..."}',
          ].join(' '),
        },
        { role: 'user', content: `Product brief: ${brief || '(none given)'}\n\nSpoken script:\n${script.slice(0, 4000)}` },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `The copy assistant is unavailable (${response.status}).`;
    throw new Error(String(detail));
  }
  const text = String(payload?.choices?.[0]?.message?.content || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The copy assistant did not return usable text. Your overlays are unchanged.');
  let parsed: any = {};
  try { parsed = JSON.parse(match[0]); } catch { throw new Error('The copy assistant returned an invalid answer. Your overlays are unchanged.'); }
  return {
    headline: String(parsed.headline || '').trim(),
    subheadline: String(parsed.subheadline || '').trim(),
    caption: String(parsed.caption || '').trim(),
  };
}

// ——— Music bed ———

export interface MusicResult { url: string; durationMs: number }

export async function generateMusicBed(prompt: string, seconds: number): Promise<MusicResult> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/audio/music/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({ prompt, lengthMs: Math.round(Math.max(5, Math.min(240, seconds)) * 1000), instrumental: true }),
  });
  const payload = await response.json().catch(() => null);
  const url = String(payload?.audioUrl || '');
  if (!response.ok || !url) {
    throw new Error(`The music bed could not be generated: ${String(payload?.error || payload?.code || `HTTP ${response.status}`).slice(0, 180)}`);
  }
  return { url, durationMs: Number(payload?.durationMs) || Math.round(seconds * 1000) };
}

// ——— Captions ———

export interface TranscriptWord { word: string; start: number; end: number }

/**
 * Pull the base video's audio and have Deepgram time it word by word. The
 * bytes have to be read in the browser because the transcription endpoints
 * take multipart form data, which a server function cannot build.
 */
export async function transcribeBaseAudio(baseVideoUrl: string): Promise<{ words: TranscriptWord[]; transcript: string; duration: number }> {
  let blob: Blob;
  try {
    const source = await fetch(baseVideoUrl);
    if (!source.ok) throw new Error(`the video answered HTTP ${source.status}`);
    blob = await source.blob();
  } catch (e: any) {
    throw new Error(`The video file could not be read for transcription (${String(e?.message || e).slice(0, 120)}). Press "Re-host base video" and try again — that copies the master onto workspace storage, which this browser can always read.`);
  }
  const form = new FormData();
  form.append('audio', blob, 'avatar-master.mp4');
  form.append('language', 'en');
  const response = await fetch(`/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}/audio/transcribe-timestamped`, {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(String(payload?.error || `Timestamped transcription failed (HTTP ${response.status}).`).slice(0, 200));
  }
  const words = Array.isArray(payload?.words) ? payload.words.map((entry: any) => ({ word: String(entry?.word || ''), start: Number(entry?.start) || 0, end: Number(entry?.end) || 0 })).filter((entry: TranscriptWord) => entry.word) : [];
  return { words, transcript: String(payload?.transcript || ''), duration: Number(payload?.duration) || 0 };
}

/** Word timings in, caption segments out — the grouping lives in the hook. */
export async function captionsFromWords(words: TranscriptWord[], maxCharsPerLine: number, videoId: string): Promise<CaptionSegment[]> {
  const result = await callEditorHook<{ segments: CaptionSegment[] }>(CAPTION_HOOK, {
    video_id: videoId,
    words,
    max_chars: maxCharsPerLine,
  });
  return Array.isArray(result?.segments) ? result.segments : [];
}

// ——— Render plan ———

export interface PlanOverlay {
  asset_url: string;
  start_time: number;
  end_time: number;
  layer: 'graphic' | 'broll';
  slot?: number;
  fade_out?: boolean;
  /** Only used by the 16:9 Remotion pass. */
  transition?: 'fade' | 'zoom-in' | 'slide';
  fit?: 'cover' | 'contain';
}

export interface RenderPlan {
  aspectRatio: AspectRatio;
  frame: { width: number; height: number };
  durationSec: number;
  overlays: PlanOverlay[];
  inserts: { clip_url: string; at_sec: number; duration_sec: number }[];
  assembly: Record<string, unknown> | null;
  music: { url: string; volume: number; fadeInSec: number; fadeOutSec: number; replaceOriginalAudio: boolean } | null;
  warnings: string[];
}

function ease(progress: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 3);
}

/** The entrance steps for one layer, as plate options plus their time window. */
function entranceSteps(anim: TextLayer['anim'] | BrandLayer['anim'], text: string): { options: PlateStepOptions; offset: number }[] {
  if (anim === 'none') return [];
  if (anim === 'clip-reveal' || anim === 'mask-wipe') {
    // A reveal is a MOVING EDGE, so each step is a wider (or taller) clip of
    // the same artwork rather than a different opacity. The slight alpha ramp
    // alongside it keeps the first sliver from popping.
    const steps: { options: PlateStepOptions; offset: number }[] = [];
    for (let i = 0; i < STEPS; i += 1) {
      const progress = ease((i + 1) / (STEPS + 1));
      steps.push({ options: { clipProgress: progress, alpha: 0.55 + 0.45 * progress }, offset: i * STEP_SEC });
    }
    return steps;
  }
  if (anim === 'typewriter') {
    const letters = String(text || '');
    if (!letters.trim()) return [];
    const steps: { options: PlateStepOptions; offset: number }[] = [];
    for (let i = 0; i < TYPE_STEPS; i += 1) {
      const shown = Math.max(1, Math.round((letters.length * (i + 1)) / (TYPE_STEPS + 1)));
      steps.push({ options: { textOverride: letters.slice(0, shown) }, offset: i * STEP_SEC });
    }
    return steps;
  }
  const steps: { options: PlateStepOptions; offset: number }[] = [];
  for (let i = 0; i < STEPS; i += 1) {
    const progress = ease((i + 1) / (STEPS + 1));
    if (anim === 'slide-up') steps.push({ options: { alpha: progress, offsetY: (1 - progress) * 0.05 }, offset: i * STEP_SEC });
    else if (anim === 'pop') steps.push({ options: { alpha: progress, scale: 0.82 + 0.18 * progress }, offset: i * STEP_SEC });
    else steps.push({ options: { alpha: progress }, offset: i * STEP_SEC });
  }
  return steps;
}

export interface PlanProgress { done: number; total: number; label: string }

/**
 * Turn the manifest into the flat, timed plan the compositor understands:
 * every text / brand / caption layer becomes uploaded PNG artwork, every
 * image and overlay-placed card becomes a timed B-roll slot, and the cards
 * the customer chose to CUT IN are listed separately for the stitch pass.
 */
export async function compileRenderPlan(job: EditorJob, onProgress?: (progress: PlanProgress) => void): Promise<RenderPlan> {
  const aspect = job.aspectRatio;
  const frame = FRAME[aspect];
  const duration = Math.max(1, job.durationSec || 0);
  const manifest = job.manifest;
  const warnings: string[] = [];
  const overlays: PlanOverlay[] = [];
  // Kept apart from the timed layers so the final sort can put them FIRST
  // among everything that starts at 0. Pushed into the same array they would
  // land after a title that also starts at 0, i.e. on top of it.
  const atmosphereOverlays: PlanOverlay[] = [];
  const inserts: { clip_url: string; at_sec: number; duration_sec: number }[] = [];

  const visibleText = manifest.text.filter((layer) => !layer.hidden && layer.text.trim());
  const visibleBrand = manifest.brand.filter((layer) => !layer.hidden);
  const visibleImages = manifest.images.filter((layer) => !layer.hidden && layer.url);
  const overlayCards = manifest.cards.filter((layer) => !layer.hidden && layer.clipUrl && layer.placement === 'overlay');
  const insertCards = manifest.cards.filter((layer) => !layer.hidden && layer.clipUrl && layer.placement === 'insert');
  const captions = manifest.captionStyle.enabled && manifest.captionStyle.burnIn ? job.captions : [];

  const steady = visibleText.length + visibleBrand.length;
  const captionCount = captions.length;
  const animated = [...visibleText, ...visibleBrand].filter((layer) => layer.anim !== 'none' && layer.duration > 0.8);
  const cinematic = manifest.cinematic;
  const atmosphere = atmosphereOf(cinematic);
  const wantsAtmosphere = Boolean(cinematic?.enabled) && (atmosphere.grainOpacity > 0 || atmosphere.lightLeak);
  const reserved = wantsAtmosphere ? ATMOSPHERE_SLOTS : 0;

  let total = steady + captionCount + reserved;
  // Entrance steps are the first thing dropped when the budget is tight: a
  // plate that appears on a cut is still the right copy at the right second.
  let animateEntrances = true;
  const animatedSteps = animated.reduce((sum, layer) => sum + ((layer as TextLayer).anim === 'typewriter' ? TYPE_STEPS : STEPS), 0);
  if (total + animatedSteps + visibleImages.length + overlayCards.length > MAX_EXPORT_OVERLAYS) {
    animateEntrances = false;
    if (animated.length) warnings.push(`This export has more layers than one compositing pass can animate, so entrance animations are burned as clean cuts. They still appear at the right time. (Preview keeps the animation.)`);
  } else {
    total += animatedSteps;
  }

  let done = 0;
  const tick = (label: string) => {
    done += 1;
    if (onProgress) onProgress({ done, total: Math.max(total, done), label });
  };

  for (const layer of visibleText) {
    const end = Math.min(duration, layerEnd(layer));
    const steps = animateEntrances ? entranceSteps(layer.anim, layer.text) : [];
    for (const step of steps) {
      const start = layer.start + step.offset;
      if (start + STEP_SEC >= end) continue;
      const url = await renderTextPlate(layer, aspect, step.options);
      overlays.push({ asset_url: url, start_time: start, end_time: start + STEP_SEC, layer: 'graphic' });
      tick(`Rendering “${layer.text.slice(0, 20)}” entrance`);
    }
    const steadyStart = layer.start + (steps.length ? steps.length * STEP_SEC : 0);
    const url = await renderTextPlate(layer, aspect);
    overlays.push({ asset_url: url, start_time: Math.min(steadyStart, Math.max(0, end - 0.2)), end_time: end, layer: 'graphic' });
    tick(`Rendering “${layer.text.slice(0, 20)}”`);
  }

  for (const layer of visibleBrand) {
    const end = Math.min(duration, layerEnd(layer));
    const steps = animateEntrances ? entranceSteps(layer.anim, layer.name) : [];
    for (const step of steps) {
      const start = layer.start + step.offset;
      if (start + STEP_SEC >= end) continue;
      const url = await renderBrandPlate(layer, aspect, step.options);
      overlays.push({ asset_url: url, start_time: start, end_time: start + STEP_SEC, layer: 'graphic' });
      tick(`Rendering ${layer.kind.replace('-', ' ')} entrance`);
    }
    const steadyStart = layer.start + (steps.length ? steps.length * STEP_SEC : 0);
    const url = await renderBrandPlate(layer, aspect);
    overlays.push({ asset_url: url, start_time: Math.min(steadyStart, Math.max(0, end - 0.2)), end_time: end, layer: 'graphic' });
    tick(`Rendering ${layer.kind.replace('-', ' ')}`);
  }

  for (const segment of captions) {
    if (segment.start >= duration) continue;
    const url = await renderCaptionPlate(segment, manifest.captionStyle, aspect);
    overlays.push({ asset_url: url, start_time: segment.start, end_time: Math.min(duration, Math.max(segment.start + 0.4, segment.end)), layer: 'graphic' });
    tick('Rendering captions');
  }

  // B-roll slots are numbered in start order, which is what the assembly
  // directives bind their transitions and clip effects to.
  const broll = [
    ...visibleImages.map((layer) => ({ asset_url: layer.url, start: layer.start, end: Math.min(duration, layerEnd(layer)), transition: layer.transition, fit: layer.fit, kind: 'image' as const })),
    ...overlayCards.map((layer) => ({ asset_url: layer.clipUrl, start: layer.start, end: Math.min(duration, layerEnd(layer)), transition: 'fade' as const, fit: 'cover' as const, kind: 'card' as const })),
  ].sort((a, b) => a.start - b.start);

  const transitions: Record<string, unknown>[] = [];
  const clipEffects: Record<string, unknown>[] = [];
  broll.forEach((entry, index) => {
    const slot = index + 1;
    overlays.push({ asset_url: entry.asset_url, start_time: entry.start, end_time: entry.end, layer: 'broll', slot, fade_out: entry.transition === 'fade', transition: entry.transition, fit: entry.fit });
    if (entry.transition === 'zoom-in') {
      transitions.push({ before_slot: slot, type: 'zoom_transition' });
      clipEffects.push({ slot, effect: 'ken_burns' });
    } else if (entry.transition === 'slide') {
      transitions.push({ before_slot: slot, type: 'whip_pan' });
    } else {
      transitions.push({ before_slot: slot, type: 'cross_dissolve' });
    }
  });

  insertCards.forEach((card) => {
    inserts.push({ clip_url: card.clipUrl, at_sec: card.start, duration_sec: card.duration });
  });

  // ——— Atmosphere ———
  // Grain and the light leak are not timed elements; they are two full-frame
  // plates held across the whole film. start_time 0 sorts them to the front
  // of the overlay list, which is exactly where they belong: above the
  // presenter, below every word of type, so nothing the customer wrote is
  // ever read through noise. A plate that cannot be drawn costs the look and
  // says so — it never fails the export.
  if (wantsAtmosphere) {
    if (atmosphere.grainOpacity > 0) {
      try {
        const url = await renderGrainPlate(aspect, atmosphere.grainOpacity);
        atmosphereOverlays.push({ asset_url: url, start_time: 0, end_time: duration, layer: 'graphic' });
        tick('Rendering film grain');
      } catch (e) {
        warnings.push(`The film grain could not be rendered, so this export has none: ${String((e as any)?.message || e).slice(0, 140)}`);
      }
    }
    if (atmosphere.lightLeak) {
      try {
        const url = await renderLightLeakPlate(aspect, atmosphere.accent);
        atmosphereOverlays.push({ asset_url: url, start_time: 0, end_time: duration, layer: 'graphic' });
        tick('Rendering the light leak');
      } catch (e) {
        warnings.push(`The light leak could not be rendered, so this export has none: ${String((e as any)?.message || e).slice(0, 140)}`);
      }
    }
  }

  // Array#sort is stable, so prepending the atmosphere keeps it under every
  // timed layer that also starts at 0 rather than painting over it.
  const composited = [...atmosphereOverlays, ...overlays].sort((a, b) => a.start_time - b.start_time);

  if (composited.length > MAX_EXPORT_OVERLAYS) {
    warnings.push(`${composited.length} timed assets is above the ${MAX_EXPORT_OVERLAYS} one compositing pass can take reliably. Hide a layer, shorten the caption track, or export in two passes.`);
  }
  if (job.aspectRatio === '9:16' && manifest.music.enabled && manifest.music.url) {
    warnings.push('The portrait compositor keeps the presenter\u2019s own audio, so the music bed is delivered as a separate track rather than mixed into the 9:16 MP4. A 16:9 export mixes it in.');
  }

  const assembly = broll.length || manifest.directives.colorGrade !== 'neutral'
    ? {
      color_grade: manifest.directives.colorGrade,
      pacing: manifest.directives.pacing,
      ...(transitions.length ? { transitions } : {}),
      ...(clipEffects.length ? { clip_effects: clipEffects } : {}),
    }
    : null;

  return {
    aspectRatio: aspect,
    frame: { width: frame.w, height: frame.h },
    durationSec: duration,
    overlays: composited,
    inserts,
    assembly,
    music: manifest.music.enabled && manifest.music.url
      ? { url: manifest.music.url, volume: manifest.music.volume, fadeInSec: manifest.music.fadeInSec, fadeOutSec: manifest.music.fadeOutSec, replaceOriginalAudio: manifest.music.replaceOriginalAudio }
      : null,
    warnings,
  };
}

// ——— Export ———

export interface ExportResponse { render: RenderJob }

export async function startExport(job: EditorJob, plan: RenderPlan): Promise<RenderJob> {
  const result = await callEditorHook<ExportResponse>(COMPOSITE_HOOK, {
    op: 'render',
    video_id: job.videoId,
    row_id: job.rowId,
    base_video_url: job.baseVideoUrl,
    aspect_ratio: plan.aspectRatio,
    duration_sec: plan.durationSec,
    overlays: plan.overlays,
    inserts: plan.inserts,
    assembly: plan.assembly,
    music: plan.music,
    speech: job.captions.map((segment) => [segment.start, segment.end]),
  });
  return result.render;
}

export async function pollExport(job: EditorJob): Promise<RenderJob> {
  const result = await callEditorHook<ExportResponse>(COMPOSITE_HOOK, { op: 'status', video_id: job.videoId, row_id: job.rowId });
  return result.render;
}

/**
 * Copy the HeyGen master onto workspace storage as a verified 1080×1920 MP4.
 * HeyGen serves signed URLs that expire and that a browser often cannot read
 * for transcription; a re-hosted base fixes both without regenerating it.
 */
export async function rehostBase(job: EditorJob): Promise<string> {
  const result = await callEditorHook<{ baseVideoUrl: string }>(COMPOSITE_HOOK, {
    op: 'normalize',
    video_id: job.videoId,
    row_id: job.rowId,
    base_video_url: job.baseVideoUrl,
    aspect_ratio: job.aspectRatio,
    duration_sec: job.durationSec,
  });
  return String(result?.baseVideoUrl || '');
}
