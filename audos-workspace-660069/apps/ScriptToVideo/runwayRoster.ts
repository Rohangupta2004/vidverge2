/**
 * RUNWAY MODEL ROSTER — Script-to-Video's single source of truth for which
 * Runway video models exist, what each one is called, and which id string the
 * platform proxy actually accepts.
 *
 * WHY THIS EXISTS. The shared catalog in lib/videoEngines.ts spells several
 * Runway models differently from the platform ('veo3.1' vs 'veo3_1',
 * 'hailuo3' vs 'h3', 'grok_imagine_1_5' vs 'grok_imagine1_5', and it is
 * missing Seedance 2.0 Fast/Mini, H3 Max, WAN 3.0 Prime, HappyHorse 1.0 and
 * Gemini Omni Flash 1.1 altogether). A spelling that does not match the live
 * capabilities list is never matched, so the model stays greyed out forever
 * and any submit that slips past answers 400 invalid_request. Every entry
 * below therefore carries its alternative spellings, and matching runs on a
 * normalized form, so a roster entry binds to whatever the platform calls it.
 *
 * GET /api/generate/runway/capabilities is authoritative. syncRunwayRoster()
 * folds it in, records the EXACT id the platform listed (liveId) and that is
 * what gets submitted. When the catalog cannot be read the roster stays
 * OPTIMISTIC — the submit goes out and the proxy answers for itself — because
 * refusing a model on a stale local guess is the bug this module fixes.
 *
 * WHAT THE PLATFORM ACTUALLY ENABLES (probed live 29 Sep 2026 against
 * capabilities + the free quote endpoint): exactly `gen4.5` (text-to-video and
 * image-to-video, 12 credits/second) and `gen4_turbo` (image-to-video only,
 * 5 credits/second). EVERY other id on this roster — and every alternative
 * spelling of them, including `gen4_5` — answers
 *   400 {"error":"model must be one of: gen4.5, gen4_turbo."}
 * Those entries are still listed, greyed out with the reason, so the roster is
 * honest about the gap instead of hiding it, and each one turns selectable on
 * its own the moment the platform's capabilities response names it.
 * Note the dot: the proxy accepts `gen4.5`, never `gen4_5`.
 *
 * lib/videoEngines.ts is deliberately untouched: SceneForge and the other
 * studio apps read it, and this file is scoped to Script-to-Video.
 */

import { wsToken } from './api';

export type RosterInput = 'text' | 'image' | 'both';
export type RosterSpeed = 'fast' | 'standard' | 'cinematic';

export interface RunwayRosterModel {
  /** Canonical id. Submitted unless the live catalog spells it differently. */
  id: string;
  label: string;
  /** Short family word for the grid badge row ("Seedance", "WAN", …). */
  family: string;
  blurb: string;
  inputType: RosterInput;
  speed: RosterSpeed;
  /** Other spellings the platform has used for the same model. */
  aliases: string[];
  minDurationS: number;
  maxDurationS: number;
  defaultDurationS: number;
  /** Pixel-pair ratios valid for text-to-video / image-to-video. */
  t2vRatios: string[];
  i2vRatios: string[];
  priceNote: string;
  // ---- live state, refreshed by syncRunwayRoster() ----
  available: boolean;
  /** The exact id the live catalog listed — always submit this when present. */
  liveId: string | null;
  /** Empty when the model is selectable. */
  unavailableReason: string;
}

/** Runway wants pixel pairs, never '16:9' shorthand. */
export const RW_ALL_RATIOS = ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'];
/** Text-to-video accepts only the two landscape/portrait pairs. */
export const RW_T2V_RATIOS = ['1280:720', '720:1280'];

const SHORTHAND: Record<string, string> = {
  '16:9': '1280:720', '9:16': '720:1280', '1:1': '960:960',
  '4:3': '1104:832', '3:4': '832:1104', '21:9': '1584:672',
  '4:5': '832:1104', '5:4': '1104:832',
};

interface RosterSeed {
  id: string;
  label: string;
  family: string;
  blurb: string;
  aliases: string[];
  inputType?: RosterInput;
  speed?: RosterSpeed;
  min?: number;
  max?: number;
  def?: number;
}

function seed(s: RosterSeed): RunwayRosterModel {
  return {
    id: s.id,
    label: s.label,
    family: s.family,
    blurb: s.blurb,
    inputType: s.inputType || 'both',
    speed: s.speed || 'standard',
    aliases: s.aliases,
    minDurationS: s.min ?? 2,
    maxDurationS: s.max ?? 10,
    defaultDurationS: s.def ?? 5,
    t2vRatios: [...RW_T2V_RATIOS],
    i2vRatios: [...RW_ALL_RATIOS],
    priceNote: 'Priced by Runway per second — the exact cost comes from the live quote.',
    // Optimistic until the live catalog says otherwise: a model is only ever
    // refused because the PLATFORM did not list it, never because this file
    // guessed.
    available: true,
    liveId: null,
    unavailableReason: '',
  };
}

/**
 * The full Runway text-to-video roster, in picker order. Gen 4.5 leads because
 * it is the default everywhere in this app.
 */
export const RUNWAY_ROSTER: RunwayRosterModel[] = [
  seed({
    id: 'gen4.5', label: 'Gen 4.5', family: 'Runway', speed: 'cinematic',
    aliases: ['gen4_5', 'gen4-5', 'gen45', 'gen4.5_turbo'],
    blurb: 'Runway flagship. The most reliable all-rounder for a written prompt, and the default for every new film.',
    def: 5,
  }),
  seed({
    id: 'veo3_1', label: 'Veo 3.1', family: 'Google', speed: 'cinematic',
    aliases: ['veo3.1', 'veo3-1', 'veo31', 'veo_3_1'],
    blurb: 'Google Veo 3.1 served through Runway — the richest cinematic look with native audio.',
    max: 8, def: 8,
  }),
  seed({
    id: 'seedance2', label: 'Seedance 2.0', family: 'Seedance',
    aliases: ['seedance2_0', 'seedance2.0', 'seedance_2', 'seedance-2'],
    blurb: 'ByteDance Seedance 2.0 — strong physical motion and camera moves at a moderate price.',
    def: 5,
  }),
  seed({
    id: 'seedance2_fast', label: 'Seedance 2.0 Fast', family: 'Seedance', speed: 'fast',
    aliases: ['seedance2.0_fast', 'seedance2_0_fast', 'seedance2fast', 'seedance-2-fast'],
    blurb: 'The quick Seedance tier — the volume pick when you need many cutaways in a hurry.',
    def: 5,
  }),
  seed({
    id: 'seedance2_mini', label: 'Seedance 2.0 Mini', family: 'Seedance', speed: 'fast',
    aliases: ['seedance2.0_mini', 'seedance2_0_mini', 'seedance2mini', 'seedance-2-mini'],
    blurb: 'The smallest, cheapest Seedance tier — ideal for drafts and storyboard passes.',
    def: 5,
  }),
  seed({
    id: 'seedance2_5', label: 'Seedance 2.5', family: 'Seedance', speed: 'cinematic',
    aliases: ['seedance2.5', 'seedance25', 'seedance_2_5', 'seedance-2-5'],
    blurb: 'The newest Seedance tier — sharper detail and steadier motion than Seedance 2.0.',
    def: 5,
  }),
  seed({
    id: 'h3', label: 'MiniMax H3', family: 'MiniMax',
    aliases: ['hailuo3', 'minimax_h3', 'minimax-h3', 'hailuo_3', 'h3_standard'],
    blurb: 'MiniMax Hailuo 3 — expressive characters and lively human motion.',
    def: 5,
  }),
  seed({
    id: 'h3_max', label: 'MiniMax H3 Max', family: 'MiniMax', speed: 'cinematic',
    aliases: ['hailuo3_max', 'minimax_h3_max', 'h3max', 'hailuo_3_max'],
    blurb: 'The top MiniMax tier — the same character strength at the highest fidelity.',
    def: 5,
  }),
  seed({
    id: 'wan3_prime', label: 'WAN 3.0 Prime', family: 'WAN', speed: 'cinematic',
    aliases: ['wan3prime', 'wan3.0_prime', 'wan3_0_prime', 'wan-3-prime'],
    blurb: 'The premium WAN 3.0 tier — clean, stable footage with strong prompt adherence.',
    def: 5,
  }),
  seed({
    id: 'wan3', label: 'WAN 3.0', family: 'WAN',
    aliases: ['wan3_0', 'wan3.0', 'wan-3', 'wan_3'],
    blurb: 'Standard WAN 3.0 — a dependable general-purpose clip engine.',
    def: 5,
  }),
  seed({
    id: 'grok_imagine1_5', label: 'Grok Imagine Video 1.5', family: 'xAI',
    aliases: ['grok_imagine_1_5', 'grok_imagine1.5', 'grok_imagine_video_1_5', 'grokimagine15', 'grok_imagine'],
    blurb: 'xAI Grok Imagine 1.5 — playful, stylized and surreal footage.',
    def: 5,
  }),
  seed({
    id: 'happyhorse1_0', label: 'HappyHorse 1.0', family: 'HappyHorse',
    aliases: ['happyhorse1.0', 'happyhorse_1_0', 'happyhorse', 'happy_horse1_0', 'happy-horse-1-0'],
    blurb: 'HappyHorse 1.0 — characterful, illustrative motion with a hand-made feel.',
    def: 5,
  }),
  seed({
    id: 'gemini_omni_flash1_1', label: 'Gemini Omni Flash 1.1', family: 'Google', speed: 'fast',
    aliases: ['gemini_omni_flash_1_1', 'gemini_omni_flash1.1', 'geminiomniflash11', 'gemini-omni-flash-1-1'],
    blurb: 'The newer Omni Flash revision — fast turnaround with better subject consistency.',
    def: 5,
  }),
  seed({
    id: 'gemini_omni_flash', label: 'Gemini Omni Flash', family: 'Google', speed: 'fast',
    aliases: ['gemini-omni-flash', 'geminiomniflash', 'gemini_omniflash'],
    blurb: 'Gemini Omni Flash through Runway — the quickest way to a usable clip.',
    def: 5,
  }),
  // Image-to-video only. Not offered on the text-to-video grid, but the film
  // pipeline can hand it a continuation scene's seed frame.
  seed({
    id: 'gen4_turbo', label: 'Gen 4 Turbo', family: 'Runway', speed: 'fast',
    aliases: ['gen4turbo', 'gen4-turbo', 'gen_4_turbo'],
    inputType: 'image',
    blurb: 'Image-to-video only, and the cheapest way to animate a still — it needs a seed frame.',
    def: 5,
  }),
];

/** The default model everywhere in Script-to-Video. */
export const DEFAULT_RUNWAY_MODEL_ID = 'gen4.5';

function normalizeId(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BY_NORM = new Map<string, RunwayRosterModel>();
RUNWAY_ROSTER.forEach((m) => {
  [m.id, ...m.aliases].forEach((spelling) => {
    const key = normalizeId(spelling);
    if (key && !BY_NORM.has(key)) BY_NORM.set(key, m);
  });
});

/** Resolve any spelling — canonical, alias or live — onto its roster entry. */
export function rosterModel(id: string | null | undefined): RunwayRosterModel | null {
  return BY_NORM.get(normalizeId(id)) || null;
}

/** The models the text-to-video grid offers (everything except image-only). */
export function textToVideoRoster(): RunwayRosterModel[] {
  return RUNWAY_ROSTER.filter((m) => m.inputType !== 'image');
}

/** The id string to put in the request body. */
export function submitModelId(model: RunwayRosterModel): string {
  return model.liveId || model.id;
}

/** Plain-English wording for what a model accepts. */
export function rosterInputLabel(model: RunwayRosterModel): string {
  if (model.inputType === 'both') return 'Text or image \u2192 video';
  if (model.inputType === 'text') return 'Text \u2192 video';
  return 'Image \u2192 video';
}

/** Clip lengths the grid offers for a model. */
export function rosterDurations(model: RunwayRosterModel | null): number[] {
  const min = model?.minDurationS ?? 2;
  const max = model?.maxDurationS ?? 10;
  const choices = [4, 5, 6, 8, 10].filter((d) => d >= min && d <= max);
  return choices.length ? choices : [Math.max(min, Math.min(max, 5))];
}

export function clampRosterDuration(seconds: number | null | undefined, model: RunwayRosterModel | null): number {
  const min = model?.minDurationS ?? 2;
  const max = model?.maxDurationS ?? 10;
  const fallback = model?.defaultDurationS ?? 5;
  const n = Math.round(Number(seconds));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * The ratio to send. Accepts '16:9'/'9:16' shorthand or a pixel pair, and
 * always returns something the chosen model allows in the chosen mode — a
 * text-to-video submit on a wide ratio answers 400 otherwise.
 */
export function rosterRatio(aspect: string | null | undefined, model: RunwayRosterModel | null, imageToVideo: boolean): string {
  const allowed = (imageToVideo ? model?.i2vRatios : model?.t2vRatios) || (imageToVideo ? RW_ALL_RATIOS : RW_T2V_RATIOS);
  const list = allowed.length ? allowed : RW_T2V_RATIOS;
  const raw = String(aspect || '').trim();
  if (list.indexOf(raw) >= 0) return raw;
  const mapped = SHORTHAND[raw];
  if (mapped && list.indexOf(mapped) >= 0) return mapped;
  const parts = raw.split(':').map(Number);
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    const portrait = parts[1] > parts[0];
    const square = Math.abs(parts[0] - parts[1]) / Math.max(parts[0], parts[1]) < 0.05;
    const guesses = square ? ['960:960', '1280:720'] : portrait ? ['720:1280'] : ['1280:720'];
    for (const guess of guesses) if (list.indexOf(guess) >= 0) return guess;
  }
  return list[0];
}

// ---------------------------------------------------------------------------
// Live capabilities sync
// ---------------------------------------------------------------------------

export type RosterState = 'loading' | 'live' | 'offline';

let state: RosterState = 'loading';
let syncedAt = 0;
let revision = 0;
let inflight: Promise<RosterState> | null = null;
let note = 'Checking which Runway models are live\u2026';
const listeners = new Set<() => void>();

/** Bumps on every applied catalog — a cheap re-render key for pickers. */
export function rosterRevision(): number { return revision; }
export function rosterState(): RosterState { return state; }
/** One sentence a picker can show under the grid. */
export function rosterNote(): string { return note; }

export function subscribeRunwayRoster(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(): void {
  revision += 1;
  listeners.forEach((fn) => { try { fn(); } catch { /* one listener never blocks the rest */ } });
}

function modeRatios(mode: any): string[] {
  const raw = Array.isArray(mode?.ratios) ? mode.ratios : [];
  return raw.map((r: any) => (typeof r === 'string' ? r : String(r?.value || r?.id || ''))).filter(Boolean);
}

function applyCapabilities(raw: any): boolean {
  const nodes: any[] = Array.isArray(raw?.models) ? raw.models : [];
  if (!nodes.length) return false;
  const matched = new Set<RunwayRosterModel>();
  const liveIds: string[] = [];

  nodes.forEach((node) => {
    const id = typeof node === 'string' ? node : String(node?.id || node?.model || '');
    if (!id) return;
    liveIds.push(id);
    const model = BY_NORM.get(normalizeId(id));
    if (!model) return;
    matched.add(model);
    model.available = true;
    model.liveId = id;
    model.unavailableReason = '';

    const modes: any[] = Array.isArray(node?.modes) ? node.modes : [];
    const t2v: string[] = [];
    const i2v: string[] = [];
    let min: number | undefined;
    let max: number | undefined;
    let def: number | undefined;
    let sawText = false;
    let sawImage = false;
    modes.forEach((mode) => {
      const modeId = String(mode?.id || mode || '');
      const ratios = modeRatios(mode);
      if (/text/i.test(modeId)) {
        sawText = true;
        ratios.forEach((r) => { if (t2v.indexOf(r) < 0) t2v.push(r); });
      }
      if (/image|video-to-video/i.test(modeId)) {
        sawImage = true;
        ratios.forEach((r) => { if (i2v.indexOf(r) < 0) i2v.push(r); });
      }
      const d = mode?.duration || {};
      if (Number.isFinite(Number(d.min))) min = min === undefined ? Number(d.min) : Math.min(min, Number(d.min));
      if (Number.isFinite(Number(d.max))) max = max === undefined ? Number(d.max) : Math.max(max, Number(d.max));
      if (Number.isFinite(Number(d.default))) def = Number(d.default);
    });
    if (t2v.length) model.t2vRatios = t2v;
    if (i2v.length) model.i2vRatios = i2v;
    if (sawText && sawImage) model.inputType = 'both';
    else if (sawText) model.inputType = 'text';
    else if (sawImage) model.inputType = 'image';
    if (min !== undefined) model.minDurationS = min;
    if (max !== undefined) model.maxDurationS = max;
    if (def !== undefined) model.defaultDurationS = clampRosterDuration(def, model);
    const cps = Number(node?.creditsPerSecond);
    if (Number.isFinite(cps) && cps > 0) model.priceNote = `${cps} credits / second (\u2248 $${(cps * 0.01).toFixed(2)}/s)`;
  });

  const liveList = liveIds.join(', ') || 'none';
  RUNWAY_ROSTER.forEach((m) => {
    if (matched.has(m)) return;
    m.available = false;
    m.liveId = null;
    m.unavailableReason = `The Audos Runway proxy is not listing ${m.label} right now (live models: ${liveList}). It unlocks here by itself the moment the platform adds it \u2014 no app update needed.`;
  });
  return true;
}

/**
 * Read the platform's live Runway catalog and fold it into the roster.
 * Cached for five minutes; concurrent callers share one in-flight fetch.
 * A failed read leaves every model SELECTABLE on purpose — see the file header.
 */
export function syncRunwayRoster(opts: { force?: boolean } = {}): Promise<RosterState> {
  const fresh = syncedAt > 0 && Date.now() - syncedAt < 5 * 60 * 1000;
  if (!opts.force) {
    if (inflight) return inflight;
    if (fresh) return Promise.resolve(state);
  }
  const attempt = (async (): Promise<RosterState> => {
    try {
      const token = wsToken();
      const res = await fetch('/api/generate/runway/capabilities', {
        headers: token ? { 'X-Workspace-DB-Token': token } : undefined,
      });
      if (!res.ok) throw new Error(`capabilities answered HTTP ${res.status}`);
      const raw = await res.json().catch(() => null);
      if (!applyCapabilities(raw)) throw new Error('the capabilities response listed no models');
      state = 'live';
      syncedAt = Date.now();
      const enabled = RUNWAY_ROSTER.filter((m) => m.available).map((m) => m.label);
      note = enabled.length
        ? `Live Runway catalog \u00b7 enabled right now: ${enabled.join(', ')}`
        : 'Live Runway catalog \u00b7 the platform is not enabling any Runway model right now';
    } catch {
      state = 'offline';
      RUNWAY_ROSTER.forEach((m) => { m.available = true; m.liveId = null; m.unavailableReason = ''; });
      note = 'Live Runway catalog unreachable \u2014 every model stays selectable and Runway answers for itself on submit.';
    } finally {
      inflight = null;
      notify();
    }
    return state;
  })();
  inflight = attempt;
  return attempt;
}
