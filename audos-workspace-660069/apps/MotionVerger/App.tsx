/**
 * MotionVerger — the dedicated SaaS LAUNCH VIDEO studio (a VidVerge app).
 *
 * Built per the founder's master directive (28 Sep 2026; variety rework
 * 29 Sep 2026): a standalone app whose ONE job is turning a product URL into a
 * 15–45s SaaS product-demo film — no narration, strong music, kinetic
 * typography, a real-screenshot showcase of the product BEING USED, feature
 * reveals, a result beat and a CTA plate — rendered deterministically on the
 * platform Remotion service. Code-first visuals: NO image model is ever
 * called, so nothing invented can appear in the film.
 *
 * NO TWO CUTS ARE ALIKE. There is no scene blueprint any more: the composition
 * engine below rolls the arc, the scene count, the shot lengths, the camera
 * move, the transition and the colour grade from a per-generation seed — and
 * the camera is limited to zoom-OUT and PAN moves, so nothing ever zooms in.
 *
 * REUSED INFRASTRUCTURE (never duplicated — see docs/IMPLEMENTATION_MAP.md):
 *   · ps-brand-scrape        server-side URL harvest (name, tagline, copy,
 *                            CTAs, logo, screenshot, real brand colours)
 *   · /proxy/openai proxy    gpt-5.6-terra writes the launch script (strict
 *                            JSON); a deterministic fallback script means an
 *                            AI hiccup can never dead-end a run
 *   · pv_music_tracks        the shared cached ElevenLabs music beds
 *   · pv-render-composition  server-side Remotion render + resumable polling
 *   · mv_projects            WorkspaceDB persistence — a reload SHOWS an
 *                            in-flight render; polling reconnects from its
 *                            operation id only on an explicit user click
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Download, Globe, Loader2, Music, Play, RefreshCw, Rocket, Shuffle, X, Zap } from 'lucide-react';
import { LB } from '../../components/LightBeam';
import { EnginePicker, usePersistentEngine } from '../../components/EngineSelector';
import { generateWithRunway } from '../../lib/runwayAdapter';
import { capPromptText, isRunwayModel, runwayModel } from '../../lib/videoEngines';
import { pollGroupA, submitGroupA } from '../../lib/videoEngineClient';

const T = {
  canvas: LB.bg,
  card: LB.bgCard,
  raised: 'rgba(255,255,255,0.06)',
  line: 'rgba(255,255,255,0.08)',
  bone: '#EDEBE8',
  muted: '#8A93A6',
  dim: '#4C5568',
  live: LB.accent,
  done: '#7FD4B4',
  fault: '#E2726F',
  sans: "'Inter', system-ui, sans-serif",
} as const;

const FPS = 30;

// ---------------------------------------------------------------------------
// Platform plumbing (same contracts as the sibling apps)
// ---------------------------------------------------------------------------

function sessionId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__spaceSessionId || '');
}
function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}
function wdb(): any {
  const db = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  if (!db) throw new Error('Your workspace session is still loading — try again in a moment.');
  return db;
}
function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

async function callHook(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch('/api/hooks/execute/' + appId() + '/' + name, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}),
      ...(sessionId() ? { 'X-Session-Id': sessionId() } : {}),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  if (!res.ok) throw new Error(String(data?.error || 'The ' + name + ' service answered HTTP ' + res.status + '.'));
  return data || {};
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface Brand {
  name: string;
  tagline: string;
  description: string;
  headlines: string[];
  bullets: string[];
  cta: string;
  logoUrl: string;
  screenshotUrl: string;
  primary: string;
  secondary: string;
  host: string;
  pageText: string;
}

type SceneKind = 'hook' | 'value' | 'feature' | 'usecase' | 'proof' | 'social' | 'outcome' | 'cta';

/** Camera moves the film is allowed to use. Founder ruling (29 Sep 2026): the
 *  camera zooms OUT or PANS — a zoom-IN never appears in a launch film again. */
type CameraMove = 'zoom-out' | 'push-out' | 'pan-left' | 'pan-right' | 'diagonal-pan' | 'drift' | 'parallax';

type TransitionKind = 'cut' | 'fade' | 'wipe' | 'slide' | 'flash';
type OpeningStyle = 'text-first' | 'image-first' | 'motion-first';
type Pacing = 'fast-cut' | 'balanced' | 'cinematic';
type Tone = 'energetic' | 'confident' | 'calm';
type GradeId = 'clean' | 'warm-film' | 'cool-tech' | 'high-contrast' | 'soft-pastel';
type SceneLook = 'punch' | 'light';

/**
 * One camera move, as a start/end transform pair the composition interpolates.
 * INVARIANT enforced in shotFor(): toScale <= fromScale, so the frame only ever
 * pulls back. Pans carry scale headroom (>= 1.02) so a translate never exposes
 * the edge of the canvas.
 */
interface CameraShot {
  move: CameraMove;
  fromScale: number;
  toScale: number;
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  /** How much further the background travels than the foreground (1 = locked). */
  parallax: number;
  ease: 'linear' | 'out';
}

interface MVScene {
  kind: SceneKind;
  headline: string;
  sub: string;
  duration_s: number;
  /** Camera work, cut style and slide treatment — re-cast on every render. */
  shot?: CameraShot;
  transition?: TransitionKind;
  look?: SceneLook;
}

/** Real lines harvested from the page (and the AI pass over that page), kept on
 *  the script so a re-shuffle needs no scrape and no second AI call. */
interface CopyPool {
  hooks: string[];
  features: string[];
  useCases: string[];
  proofs: string[];
  outcomes: string[];
}

interface MVVariant {
  seed: string;
  opening: OpeningStyle;
  pacing: Pacing;
  tone: Tone;
  grade: GradeId;
  /** How many feature/use-case scenes sit in the body of this cut (2–5). */
  bodyScenes: number;
  label: string;
}

interface MVScript { title: string; scenes: MVScene[]; variant?: MVVariant; pool?: CopyPool }

// ---------------------------------------------------------------------------
// THE COMPOSITION ENGINE — the reason two runs never look alike
//
// There is no scene blueprint in this app. Everything structural is rolled from
// a per-generation seed: the arc, how many scenes, their order, each shot's
// length, its camera move, how it cuts to the next one, and the colour grade.
// Copy is still FACTS ONLY — the engine decides STRUCTURE, never claims.
// ---------------------------------------------------------------------------

interface GradeSpec { id: GradeId; label: string; filter: string; tint: string; tintOpacity: number; vignette: number }

const GRADES: GradeSpec[] = [
  { id: 'clean', label: 'clean', filter: 'none', tint: '', tintOpacity: 0, vignette: 0 },
  { id: 'warm-film', label: 'warm film', filter: 'saturate(1.07) contrast(1.05)', tint: '#ff9a3c', tintOpacity: 0.1, vignette: 0.16 },
  { id: 'cool-tech', label: 'cool tech', filter: 'saturate(1.03) contrast(1.07)', tint: '#4c7cff', tintOpacity: 0.1, vignette: 0.12 },
  { id: 'high-contrast', label: 'high contrast', filter: 'saturate(1.12) contrast(1.12) brightness(1.01)', tint: '', tintOpacity: 0, vignette: 0.2 },
  { id: 'soft-pastel', label: 'soft pastel', filter: 'saturate(0.94) brightness(1.03)', tint: '#ffd9ec', tintOpacity: 0.12, vignette: 0.06 },
];

function gradeSpec(id: string | undefined): GradeSpec {
  return GRADES.filter((g) => g.id === id)[0] || GRADES[0];
}

/** Deterministic PRNG (mulberry32 over an FNV-1a hash of the seed): one seed
 *  reproduces one cut exactly, and a new seed changes every choice below. */
class Rng {
  private state: number;

  constructor(seed: string) {
    let h = 2166136261;
    const text = String(seed || 'motionverger');
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    this.state = (h >>> 0) || 1;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min: number, max: number): number { return min + (max - min) * this.next(); }
  int(min: number, max: number): number { return Math.min(max, min + Math.floor(this.next() * (max - min + 1))); }
  bool(p = 0.5): boolean { return this.next() < p; }

  weighted<T>(entries: Array<[T, number]>): T {
    const live = entries.filter((e) => e[1] > 0);
    if (!live.length) return entries[0][0];
    let roll = this.next() * live.reduce((sum, e) => sum + e[1], 0);
    for (const entry of live) {
      roll -= entry[1];
      if (roll <= 0) return entry[0];
    }
    return live[live.length - 1][0];
  }

  shuffle<T>(items: T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }
}

/** A new seed per generation — the same URL never renders the same film twice. */
function makeSeed(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// --- Real-copy mining -------------------------------------------------------

/**
 * Real-copy guard. A scraped page's readable text routinely contains the site's
 * own minified JS bundle, so anything that smells like code — or like nav,
 * legal or cookie furniture — never becomes a line in the film.
 */
function isProse(line: string): boolean {
  const s = String(line || '').trim();
  if (s.length < 8 || s.length > 70) return false;
  if (!/\s/.test(s)) return false;
  if (/[{}<>[\]=;`$\\|~^]/.test(s)) return false;
  if (/\b(var|let|const|function|return|await|async|import|export|typeof|null|undefined)\b/.test(s)) return false;
  if (/(https?:|www\.|=>|::|\.js\b|\.tsx?\b|@[a-z]|\(\))/i.test(s)) return false;
  if (/^(skip|log ?in|sign|cookie|privacy|terms|menu|home|about|contact|faq|pricing)\b/i.test(s)) return false;
  const letters = s.replace(/[^a-zA-Z ]/g, '').length;
  return letters >= s.length * 0.7;
}

function tidyLine(line: string): string {
  return String(line || '').replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim().slice(0, 58);
}

/** Lines that read like a use case: who it is for, what they use it for. */
const USE_CASE_RE = /\b(for (teams|founders|marketers|agencies|creators|developers|students|freelancers|startups|enterprises|businesses)|perfect for|ideal for|built for|designed for|made for|whether you|use it to|great for|works with)\b/i;

/** Social proof signals — a number of users, a rating, a named customer, a quote. */
const PROOF_RE = /(\b\d[\d,.]*\s*(k|m|\+)?\s*(users|customers|teams|creators|businesses|companies|people|downloads|videos|projects|reviews|ratings|hours)\b|trusted by|loved by|used by|join \d|rated\b|\d(\.\d)?\s*\/\s*5|\bstars?\b|\bbacked by\b|\bfeatured in\b|\btestimonial|\bcase study\b)/i;

/** Outcome signals — the result the customer walks away with. */
const OUTCOME_RE = /\b(in (seconds|minutes|one|a single)|saves?|saved|no more|stop|never again|instantly|automatically|10x|2x|3x|twice as|faster|in half|without|ready before|done)\b/i;

/**
 * Sort the page's real copy into the pools the composer draws from. Priority
 * matters: a line that reads like social proof is proof first, a use case
 * second, an outcome third, and a plain capability last.
 */
function minePool(brand: Brand): CopyPool {
  const candidates: string[] = ([] as string[])
    .concat(brand.bullets)
    .concat(brand.headlines)
    .concat(realFeatureLines(brand, 16));
  const seen: Record<string, boolean> = {};
  const features: string[] = [];
  const useCases: string[] = [];
  const proofs: string[] = [];
  const outcomes: string[] = [];
  for (const candidate of candidates) {
    const line = tidyLine(candidate);
    const key = line.toLowerCase();
    if (!line || seen[key] || !isProse(line)) continue;
    seen[key] = true;
    if (PROOF_RE.test(line) && proofs.length < 4) proofs.push(line);
    else if (USE_CASE_RE.test(line) && useCases.length < 4) useCases.push(line);
    else if (OUTCOME_RE.test(line) && outcomes.length < 5) outcomes.push(line);
    else features.push(line);
  }
  // Hooks are the shortest, punchiest real lines the page shows.
  const hooks: string[] = [];
  for (const candidate of ([] as string[]).concat(brand.headlines).concat(outcomes).concat(features)) {
    const line = tidyLine(candidate);
    if (line && line.length <= 44 && isProse(line) && hooks.indexOf(line) < 0) hooks.push(line);
    if (hooks.length >= 4) break;
  }
  return { hooks, features: features.slice(0, 10), useCases, proofs, outcomes };
}

/** AI-written lines first, the page's own mined lines behind them. */
function mergePools(ai: CopyPool, base: CopyPool): CopyPool {
  const merge = (first: string[], second: string[]): string[] => {
    const out: string[] = [];
    const seen: Record<string, boolean> = {};
    for (const candidate of ([] as string[]).concat(first).concat(second)) {
      const line = tidyLine(candidate);
      const key = line.toLowerCase();
      if (!line || seen[key] || !isProse(line)) continue;
      seen[key] = true;
      out.push(line);
      if (out.length >= 10) break;
    }
    return out;
  };
  return {
    hooks: merge(ai.hooks, base.hooks),
    features: merge(ai.features, base.features),
    useCases: merge(ai.useCases, base.useCases),
    proofs: merge(ai.proofs, base.proofs),
    outcomes: merge(ai.outcomes, base.outcomes),
  };
}

/** The chip that lands when the showcase scene finishes its job. It is only
 *  ever a REAL outcome line off the page; otherwise it is a plain 'Done'. */
function proofChipLabel(pool?: CopyPool | null): string {
  for (const line of pool?.outcomes || []) {
    const label = tidyLine(line);
    if (label && label.length <= 26) return label;
  }
  return 'Done';
}

// --- The dice roll ----------------------------------------------------------

interface ArcContext { hasScreenshot: boolean; hasProof: boolean; hasUseCase: boolean; hasOutcome: boolean; hasLogo: boolean }

function variantContext(brand: Brand, pool: CopyPool | null): ArcContext {
  return {
    hasScreenshot: Boolean(brand.screenshotUrl),
    hasProof: pool ? pool.proofs.length > 0 : true,
    hasUseCase: pool ? pool.useCases.length > 0 : true,
    hasOutcome: pool ? pool.outcomes.length > 0 : true,
    hasLogo: Boolean(brand.logoUrl),
  };
}

function variantLabel(v: MVVariant): string {
  return [v.pacing, v.tone, v.opening, gradeSpec(v.grade).label, v.bodyScenes + ' body scenes'].join(' · ');
}

function chooseVariant(seed: string, ctx: ArcContext): MVVariant {
  const rng = new Rng(seed + ':variant');
  const variant: MVVariant = {
    seed,
    opening: rng.weighted<OpeningStyle>([['text-first', 4], ['image-first', ctx.hasScreenshot ? 3 : 0], ['motion-first', 4]]),
    pacing: rng.weighted<Pacing>([['fast-cut', 4], ['balanced', 4], ['cinematic', 3]]),
    tone: rng.weighted<Tone>([['energetic', 4], ['confident', 4], ['calm', 2]]),
    grade: rng.weighted<GradeId>([['clean', 3], ['warm-film', 3], ['cool-tech', 3], ['high-contrast', 2], ['soft-pastel', 2]]),
    bodyScenes: rng.weighted<number>([[2, 2], [3, 4], [4, 4], [5, 3]]),
    label: '',
  };
  variant.label = variantLabel(variant);
  return variant;
}

function rollGrade(seed: string): GradeSpec {
  const rng = new Rng(seed + ':grade');
  return gradeSpec(rng.weighted<GradeId>([['clean', 3], ['warm-film', 3], ['cool-tech', 3], ['high-contrast', 2], ['soft-pastel', 2]]));
}

/**
 * Build the arc for ONE cut. The only fixed points are a hook to open and a CTA
 * to close; everything between is rolled. The product story holds though: they
 * watch it being used (proof) BEFORE they see the result it produced (outcome).
 */
function buildArc(rng: Rng, ctx: ArcContext, bodyScenes: number): SceneKind[] {
  const fillers: SceneKind[] = [];
  for (let i = 0; i < bodyScenes; i += 1) {
    fillers.push(rng.weighted<SceneKind>([['feature', 6], ['usecase', ctx.hasUseCase ? 4 : 0]]));
  }
  if (!fillers.some((k) => k === 'feature')) fillers[0] = 'feature';
  const split = rng.int(1, fillers.length);
  const valueSlot = rng.weighted<string>([['early', 5], ['mid', 2], ['none', 3]]);
  const arc: SceneKind[] = ['hook'];
  if (valueSlot === 'early') arc.push('value');
  for (const kind of fillers.slice(0, split)) arc.push(kind);
  if (valueSlot === 'mid') arc.push('value');
  if (ctx.hasScreenshot) arc.push('proof');
  if (ctx.hasOutcome && rng.bool(0.8)) arc.push('outcome');
  for (const kind of fillers.slice(split)) arc.push(kind);
  if (ctx.hasProof && rng.bool(0.75)) arc.push('social');
  arc.push('cta');
  // Eight cuts is the ceiling — trim body scenes from the tail, never the story.
  while (arc.length > 8) {
    const idx = Math.max(arc.lastIndexOf('feature'), arc.lastIndexOf('usecase'));
    if (idx <= 0) break;
    arc.splice(idx, 1);
  }
  return arc;
}

const PACE: Record<Pacing, { min: number; max: number; base: number }> = {
  'fast-cut': { min: 2, max: 3.5, base: 2.4 },
  balanced: { min: 2, max: 4, base: 3 },
  cinematic: { min: 2.5, max: 5, base: 3.6 },
};

/** Some kinds need a beat longer than others — the showcase most of all. */
const KIND_HOLD: Record<SceneKind, number> = {
  hook: 1, value: 1, feature: 0.92, usecase: 1, proof: 1.3, social: 1.05, outcome: 1.1, cta: 0.95,
};

function halfStep(n: number): number { return Math.round(n * 2) / 2; }

/**
 * Shot lengths: jittered per scene (some 2s, some 5s — never the same rhythm),
 * then nudged until the whole film lands inside the 15–45s window.
 */
function timeScenes(rng: Rng, scenes: MVScene[], pacing: Pacing): void {
  const pace = PACE[pacing];
  for (const scene of scenes) {
    const raw = halfStep(pace.base * KIND_HOLD[scene.kind] * rng.float(0.78, 1.3));
    scene.duration_s = Math.max(2, Math.min(5, Math.max(pace.min, Math.min(pace.max, raw))));
  }
  let total = scenes.reduce((sum, s) => sum + s.duration_s, 0);
  // A thin page can leave so few scenes that even 5s each undershoots the 15s
  // floor — then, and only then, shots are allowed to hold up to 7s.
  const ceiling = scenes.length * 5 >= 15 ? 5 : 7;
  for (let guard = 0; guard < 240 && total < 15; guard += 1) {
    const room = scenes.filter((s) => s.duration_s < ceiling);
    if (!room.length) break;
    const scene = room[rng.int(0, room.length - 1)];
    scene.duration_s = halfStep(scene.duration_s + 0.5);
    total += 0.5;
  }
  for (let guard = 0; guard < 240 && total > 45; guard += 1) {
    const room = scenes.filter((s) => s.duration_s > 2);
    if (!room.length) break;
    const scene = room[rng.int(0, room.length - 1)];
    scene.duration_s = halfStep(scene.duration_s - 0.5);
    total -= 0.5;
  }
}

// --- Camera work ------------------------------------------------------------

const MOVES: CameraMove[] = ['zoom-out', 'push-out', 'pan-left', 'pan-right', 'diagonal-pan', 'drift', 'parallax'];
const TRANSITIONS: TransitionKind[] = ['cut', 'fade', 'wipe', 'slide', 'flash'];

/** Every move pulls back or holds: toScale is ALWAYS <= fromScale. */
function shotFor(move: CameraMove, rng: Rng, pacing: Pacing): CameraShot {
  const energy = pacing === 'fast-cut' ? 1.25 : pacing === 'cinematic' ? 0.8 : 1;
  const travel = rng.float(2.6, 4.4) * energy;
  let shot: CameraShot = { move, fromScale: 1.1, toScale: 1.02, fromX: 0, toX: 0, fromY: 0, toY: 0, parallax: 1, ease: 'out' };
  if (move === 'zoom-out') shot = { ...shot, fromScale: rng.float(1.16, 1.24), toScale: 1.02, ease: 'out' };
  else if (move === 'push-out') shot = { ...shot, fromScale: rng.float(1.07, 1.12), toScale: 1, ease: 'linear' };
  else if (move === 'pan-left') shot = { ...shot, fromScale: 1.12, toScale: 1.06, fromX: travel, toX: -travel, ease: 'linear' };
  else if (move === 'pan-right') shot = { ...shot, fromScale: 1.12, toScale: 1.06, fromX: -travel, toX: travel, ease: 'linear' };
  else if (move === 'diagonal-pan') shot = { ...shot, fromScale: 1.14, toScale: 1.06, fromX: -travel * 0.9, toX: travel * 0.9, fromY: travel * 0.5, toY: -travel * 0.5, ease: 'linear' };
  else if (move === 'drift') shot = { ...shot, fromScale: 1.09, toScale: 1.05, fromX: -travel * 0.4, toX: travel * 0.4, fromY: rng.float(0.4, 1.2), toY: -rng.float(0.4, 1.2), ease: 'linear' };
  else shot = { ...shot, fromScale: 1.13, toScale: 1.05, fromX: travel, toX: -travel, parallax: rng.float(2, 2.8), ease: 'linear' };
  shot.toScale = Math.min(shot.toScale, shot.fromScale);
  return shot;
}

/**
 * Cast the camera, the cut style and the slide treatment. Runs at RENDER time
 * from a fresh seed, so even re-rendering an unchanged script produces a new
 * cut. No move and no transition is ever used twice in a row.
 */
function assignCameraWork(scenes: MVScene[], seed: string, variant: MVVariant): MVScene[] {
  const rng = new Rng(seed + ':camera');
  let lastMove = '';
  let lastTransition = '';
  let punchRun = 0;
  return scenes.map((scene) => {
    const move = rng.weighted<CameraMove>(MOVES.map((m) => {
      if (m === lastMove) return [m, 0] as [CameraMove, number];
      let weight = 3;
      if (variant.pacing === 'fast-cut' && (m === 'pan-left' || m === 'pan-right' || m === 'parallax')) weight += 2;
      if (variant.pacing === 'cinematic' && (m === 'push-out' || m === 'drift' || m === 'zoom-out')) weight += 2;
      if (scene.kind === 'proof' && (m === 'zoom-out' || m === 'push-out' || m === 'parallax')) weight += 3;
      if (scene.kind === 'cta' && (m === 'push-out' || m === 'zoom-out')) weight += 2;
      return [m, weight] as [CameraMove, number];
    }));
    lastMove = move;
    const transition = rng.weighted<TransitionKind>(TRANSITIONS.map((t) => {
      if (t === lastTransition) return [t, 0] as [TransitionKind, number];
      let weight = 3;
      if (t === 'cut') weight += variant.pacing === 'fast-cut' ? 3 : 1;
      if (t === 'flash') weight = variant.tone === 'energetic' ? 3 : 1;
      if (t === 'wipe') weight = variant.pacing === 'cinematic' ? 1 : 3;
      return [t, weight] as [TransitionKind, number];
    }));
    lastTransition = transition;
    let look: SceneLook = 'light';
    if (scene.kind === 'cta') look = 'punch';
    else if (scene.kind === 'feature' || scene.kind === 'usecase') look = rng.bool(punchRun >= 2 ? 0.1 : 0.5) ? 'punch' : 'light';
    punchRun = look === 'punch' ? punchRun + 1 : 0;
    return { ...scene, shot: shotFor(move, rng, variant.pacing), transition, look };
  });
}

// --- Composition ------------------------------------------------------------

/**
 * Turn real page copy into a cut. The arc, the scene count, the order, the shot
 * lengths and the camera work all come from `seed`; every headline comes from
 * `pool`, which only ever holds lines the page (or the AI pass over it) wrote.
 * A pool that runs dry simply yields a shorter film — nothing is invented.
 */
function composeScript(brand: Brand, pool: CopyPool, seed: string, title?: string): MVScript {
  const ctx = variantContext(brand, pool);
  const variant = chooseVariant(seed, ctx);
  const rng = new Rng(seed + ':compose');
  const arc = buildArc(rng, ctx, variant.bodyScenes);
  const bag = {
    hooks: rng.shuffle(pool.hooks),
    features: rng.shuffle(pool.features),
    useCases: rng.shuffle(pool.useCases),
    proofs: rng.shuffle(pool.proofs),
    outcomes: rng.shuffle(pool.outcomes),
  };
  const used: Record<string, boolean> = {};
  const take = (lists: string[][]): string => {
    for (const list of lists) {
      for (const line of list) {
        const key = line.toLowerCase();
        if (line && !used[key]) {
          used[key] = true;
          return line;
        }
      }
    }
    return '';
  };
  const scenes: MVScene[] = [];
  for (const kind of arc) {
    let headline = '';
    let sub = '';
    if (kind === 'hook') {
      headline = take([bag.hooks, bag.outcomes, bag.features]) || 'Meet ' + brand.name;
      sub = rng.bool(0.4) ? tidyLine(brand.tagline) : '';
    } else if (kind === 'value') {
      headline = brand.name;
      sub = tidyLine(brand.tagline);
      used[headline.toLowerCase()] = true;
    } else if (kind === 'feature') {
      headline = take([bag.features, bag.useCases, bag.outcomes]);
      sub = rng.bool(0.3) ? take([bag.features]) : '';
    } else if (kind === 'usecase') {
      headline = take([bag.useCases, bag.features]);
    } else if (kind === 'proof') {
      // The showcase beat narrates the product doing the work.
      headline = take([bag.outcomes]) || 'Watch it work';
      sub = brand.host;
    } else if (kind === 'social') {
      headline = take([bag.proofs]);
      sub = brand.host;
    } else if (kind === 'outcome') {
      headline = take([bag.outcomes, bag.features]);
    } else {
      headline = brand.cta || 'Get started';
      sub = brand.host;
    }
    // Nothing real left to say for this slot: drop the scene rather than pad it.
    if (!headline && kind !== 'hook' && kind !== 'cta') continue;
    scenes.push({ kind, headline: headline.slice(0, 58), sub: String(sub || '').slice(0, 90), duration_s: 3 });
  }
  timeScenes(rng, scenes, variant.pacing);
  return {
    title: (title || brand.name + ' — Launch').slice(0, 80),
    scenes: assignCameraWork(scenes, seed, variant),
    variant,
    pool,
  };
}

function cutTimeline(script: MVScript): string {
  return script.scenes.map((s) => s.kind + ':' + (s.shot ? s.shot.move : 'static') + ':' + s.transition + ':' + s.duration_s + 's').join(' | ');
}

/** The founder asked to be able to SEE which variant a generation picked. */
function logCut(stage: string, script: MVScript): void {
  const v = script.variant;
  console.log('[MotionVerger] ' + stage + ' —', {
    seed: v?.seed || '',
    opening: v?.opening || '',
    pacing: v?.pacing || '',
    tone: v?.tone || '',
    grade: v?.grade || '',
    scenes: script.scenes.length,
    seconds: Math.round(script.scenes.reduce((sum, s) => sum + s.duration_s, 0)),
    timeline: cutTimeline(script),
  });
}

interface MVProject {
  id: number;
  title: string | null;
  url: string | null;
  brand: Brand | null;
  script: MVScript | null;
  status: 'draft' | 'rendering' | 'completed' | 'failed' | null;
  stage: string | null;
  operation_id: string | null;
  video_url: string | null;
  music_url: string | null;
  error: string | null;
  created_at: string;
}

const db = {
  async list(): Promise<MVProject[]> {
    const { data } = await wdb().from('mv_projects').orderBy('created_at', 'desc').limit(50).get();
    return Array.isArray(data) ? data : [];
  },
  async create(row: Partial<MVProject>): Promise<MVProject> {
    const res = await wdb().from('mv_projects').insert(row);
    const created = res?.data?.[0] || res?.data || res;
    if (created?.id) return created as MVProject;
    const all = await this.list();
    if (all[0]?.id) return all[0];
    throw new Error('The launch project could not be saved.');
  },
  async update(id: number, patch: Partial<MVProject>): Promise<void> {
    await wdb().from('mv_projects').update(id, patch);
  },
};

// ---------------------------------------------------------------------------
// Brand extraction (ps-brand-scrape → Brand)
// ---------------------------------------------------------------------------

function pickAccent(scrape: any): string {
  const candidates: string[] = [String(scrape?.themeColor || '')];
  if (Array.isArray(scrape?.palette)) for (const p of scrape.palette) candidates.push(String(p?.hex || ''));
  for (const hex of candidates) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = (max + min) / 2 / 255;
    if (lum > 0.92 || lum < 0.08) continue; // near white / black
    if (max - min < 24) continue;           // grey
    return hex;
  }
  return '#f59e0b';
}

function toBrand(url: string, s: any): Brand {
  let host = '';
  try { host = new URL(/^https?:\/\//.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { host = url; }
  const headlines: string[] = Array.isArray(s?.headlines) ? s.headlines.map((h: any) => String(h)).filter(Boolean) : [];
  const bullets: string[] = Array.isArray(s?.bullets) ? s.bullets.map((b: any) => String(b)).filter(Boolean) : [];
  const ctas: string[] = Array.isArray(s?.ctas) ? s.ctas.map((c: any) => String(c)).filter(Boolean) : [];
  // 'VicharakAI — AI Study Companion for JEE…' is an SEO title, not a name:
  // the product name is the segment before the first title separator.
  const rawName = String(s?.siteName || s?.title || host || 'Your product');
  const name = ((rawName.split(/\s+[—|·]\s+|\s+[-–]\s+/)[0] || rawName).trim() || rawName).slice(0, 60);
  return {
    name,
    tagline: String(s?.description || headlines[0] || '').slice(0, 140),
    description: String(s?.description || '').slice(0, 400),
    headlines,
    bullets,
    cta: (ctas[0] || 'Get started today').slice(0, 40),
    logoUrl: String(s?.logoUrl || ''),
    screenshotUrl: String(s?.screenshotUrl || s?.ogImage || ''),
    primary: pickAccent(s),
    secondary: '#0b1120',
    host,
    pageText: String(s?.text || '').slice(0, 3000),
  };
}

// ---------------------------------------------------------------------------
// Launch copy — gpt-5.6-terra writes a LIBRARY of real lines and the
// composition engine above cuts it into a film. An AI hiccup only costs the
// AI's lines: the pool mined from the page still composes a complete cut.
// ---------------------------------------------------------------------------

// FACTS ONLY: candidate lines come exclusively from the page's real copy —
// bullets first, then headlines, then whole sentences of the site's own text.
// If the page gave fewer real lines the film simply has fewer scenes. NOTHING
// is ever invented and no line repeats.
function realFeatureLines(brand: Brand, limit = 3): string[] {
  const pool: string[] = [...brand.bullets, ...brand.headlines.slice(1)];
  const sentences = (brand.description + '. ' + brand.pageText)
    .split(/[.!?]+\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 18 && s.length <= 80 && !/^(skip|log ?in|sign|cookie|privacy|terms)/i.test(s));
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  for (const raw of [...pool, ...sentences]) {
    const line = raw.replace(/[.\s]+$/, '').slice(0, 60).trim();
    const key = line.toLowerCase();
    if (!line || line.length < 6 || seen[key]) continue;
    seen[key] = true;
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

async function writeScript(brand: Brand, seed: string): Promise<MVScript> {
  const variant = chooseVariant(seed, variantContext(brand, null));
  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': wsToken() },
      body: JSON.stringify({
        model: 'gpt-5.6-terra',
        reasoning_effort: 'none',
        max_completion_tokens: 1500,
        messages: [
          { role: 'system', content: 'You write the copy for SILENT SaaS product-demo films: kinetic typography over a real screenshot of the product being used, strong music, 15-45 seconds total. You write LINES, not an edit — the app composes the edit itself. Reply with STRICT JSON only — no prose, no code fences.' },
          { role: 'user', content: 'Product: ' + brand.name + '\nTagline: ' + brand.tagline + '\nDescription: ' + brand.description + '\nHeadlines: ' + brand.headlines.slice(0, 6).join(' | ') + '\nFeature bullets: ' + brand.bullets.slice(0, 8).join(' | ') + '\nCTA: ' + brand.cta + '\nPage copy (verbatim from the site): ' + brand.pageText.slice(0, 2200) + copyBrief(variant) + '\n\nWrite {"title":string,"lines":[{"kind":"hook"|"feature"|"usecase"|"outcome"|"social","headline":string,"sub":string}]} — a LIBRARY of candidate lines for a SaaS product-demo film, NOT a finished edit (the app composes the edit itself, so send no durations and no order): 2 hook lines (punchy pattern-interrupts, max 7 words), 3-4 feature lines that each name a DIFFERENT real capability, 1-2 usecase lines (who it is for and what they use it for), 2 outcome lines stating the RESULT the user walks away with — the problem solved, the thing now done in seconds — and 1-2 social lines ONLY when the material carries real social proof (a number of users, a rating, a named customer, a testimonial). Every headline is a FACT from the material above: never invent a capability, a number or a customer, and never repeat a line. Max 58 characters per headline; sub is an optional shorter support line.' },
        ],
      }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(String(data?.error?.message || 'HTTP ' + res.status));
    let text = String(data?.choices?.[0]?.message?.content || '');
    text = text.replace(/```json/gi, '').replace(/```/g, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no JSON');
    const parsed = JSON.parse(text.slice(start, end + 1));
    const raw: any[] = Array.isArray(parsed?.lines) ? parsed.lines : Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    if (raw.length < 3) throw new Error('too few lines');
    const ai: CopyPool = { hooks: [], features: [], useCases: [], proofs: [], outcomes: [] };
    for (const entry of raw.slice(0, 16)) {
      const line = tidyLine(String(entry?.headline || ''));
      const support = tidyLine(String(entry?.sub || ''));
      const kind = String(entry?.kind || 'feature');
      const bucket = kind === 'hook' ? ai.hooks
        : kind === 'usecase' ? ai.useCases
          : kind === 'social' || kind === 'proof' ? ai.proofs
            : kind === 'outcome' ? ai.outcomes
              : ai.features;
      if (line) bucket.push(line);
      if (support) ai.features.push(support);
    }
    const pool = mergePools(ai, minePool(brand));
    if (!pool.hooks.length && !pool.features.length) throw new Error('no usable lines');
    return composeScript(brand, pool, seed, String(parsed?.title || '').slice(0, 80));
  } catch {
    // The page's own copy still composes a complete film without the AI pass.
    return composeScript(brand, minePool(brand), seed);
  }
}

/** The variant is handed to the writer so its lines match the cut's tone, and
 *  the seed makes a second pass over the same page produce different lines. */
function copyBrief(v: MVVariant): string {
  return '\n\nThis cut is ' + v.tone + ' in tone, ' + v.pacing + ' in pace, and opens ' + v.opening
    + '. Creative seed ' + v.seed + ' — write DIFFERENT lines than any earlier pass over this page.';
}

// ---------------------------------------------------------------------------
// Music beds — the shared pv_music_tracks cache (schema-agnostic read)
// ---------------------------------------------------------------------------

interface MusicBed { label: string; url: string }

// The five cached workspace music beds (generated once as durable GCS MP3s —
// rows in pv_music_tracks with session_id NULL). The runtime SDK read is
// session-scoped and can return zero of those shared rows, which left the
// picker stuck on 'Loading…' — so these exact cached URLs are the fallback.
const KNOWN_BEDS: MusicBed[] = [
  { label: 'Inspiring', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352381300.mp3' },
  { label: 'Cinematic Dark', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352397219.mp3' },
  { label: 'Energetic', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352412992.mp3' },
  { label: 'Calm/Ambient', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352426863.mp3' },
  { label: 'Brand Luxury', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352446075.mp3' },
];

async function loadMusicBeds(): Promise<MusicBed[]> {
  try {
    const { data } = await wdb().from('pv_music_tracks').orderBy('track_index', 'asc').limit(10).get();
    const rows: any[] = Array.isArray(data) ? data : [];
    const beds: MusicBed[] = [];
    for (const r of rows) {
      let url = '';
      for (const v of Object.values(r || {})) {
        if (typeof v === 'string' && /^https?:\/\//.test(v) && /\.mp3(\?|$)/i.test(v)) { url = v; break; }
      }
      if (!url) continue;
      const label = String(r?.name || r?.label || r?.title || r?.mood || ('Track ' + (beds.length + 1)));
      beds.push({ label: label.slice(0, 30), url });
    }
    return beds.length ? beds : KNOWN_BEDS.slice();
  } catch { return KNOWN_BEDS.slice(); }
}

// ---------------------------------------------------------------------------
// The deterministic Remotion launch composition (code-first — §12/§14)
// ---------------------------------------------------------------------------

interface RenderData {
  scenes: MVScene[];
  brand: Pick<Brand, 'name' | 'tagline' | 'logoUrl' | 'screenshotUrl' | 'primary' | 'secondary' | 'host' | 'cta'>;
  musicUrl: string;
  /** Optional generated plate behind the hook. Empty keeps the film 100%
   * code-rendered, which is still the default. */
  openerUrl: string;
  totalFrames: number;
  /** The colour grade rolled for this generation. */
  grade: GradeSpec;
  /** The creative dice roll this cut was rendered with (also console-logged). */
  variant: { seed: string; opening: OpeningStyle; pacing: Pacing; tone: Tone; label: string };
  /** Short REAL line for the "it worked" chip in the showcase scene. */
  proofChip: string;
}

function totalFramesOf(scenes: MVScene[]): number {
  return scenes.reduce((sum, s) => sum + Math.round(s.duration_s * FPS), 0);
}

function buildCompositionTsx(data: RenderData): string {
  return `import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame } from 'remotion';

const DATA = ${JSON.stringify(data)};
const FPS = 30;
const G = DATA.grade || { filter: 'none', tint: '', tintOpacity: 0, vignette: 0 };
const V = DATA.variant || { opening: 'text-first', pacing: 'balanced', tone: 'confident' };

function clamp(f, a, b, from, to) {
  return interpolate(f, [a, b], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

const INK = '#16181d';
const MUTE = '#6a7180';

// Reveal speeds follow the tone this cut was rolled with. Nothing in the film
// waits longer than 9 frames (0.3s) before it starts moving.
const REVEAL = V.tone === 'energetic' ? 1.9 : V.tone === 'calm' ? 1.15 : 1.5;
const WORD_STEP = V.tone === 'energetic' ? 1.8 : V.tone === 'calm' ? 3.2 : 2.3;

function shotProgress(shot, dur, frame) {
  const span = Math.max(1, Number(dur) || 1);
  const raw = Math.min(1, Math.max(0, frame / span));
  return shot && shot.ease === 'out' ? 1 - Math.pow(1 - raw, 2.1) : raw;
}

// THE CAMERA. Zoom-OUT and PAN only: fromScale is always >= toScale, so the
// frame pulls back or holds — it never pushes in. Pans keep >= 1.02 of scale
// headroom so a translate cannot expose the edge of the canvas.
function Cam(props) {
  const frame = useCurrentFrame();
  const shot = props.shot || {};
  const depth = props.depth === undefined ? 1 : props.depth;
  const t = shotProgress(shot, props.dur, frame);
  const from = shot.fromScale === undefined ? 1.06 : shot.fromScale;
  const to = Math.min(shot.toScale === undefined ? 1 : shot.toScale, from);
  const scale = from + (to - from) * t;
  const x = ((shot.fromX || 0) + (((shot.toX || 0) - (shot.fromX || 0)) * t)) * depth;
  const y = ((shot.fromY || 0) + (((shot.toY || 0) - (shot.fromY || 0)) * t)) * depth;
  return (
    <AbsoluteFill style={{ transform: 'translate(' + x.toFixed(3) + '%, ' + y.toFixed(3) + '%) scale(' + scale.toFixed(4) + ')', transformOrigin: '50% 50%' }}>
      {props.children}
    </AbsoluteFill>
  );
}

// Parallax: the background carries the EXTRA travel on top of the shared camera
// move, so the plate slides behind the type instead of with it.
function camOffset(shot, dur, frame) {
  if (!shot || !shot.parallax || shot.parallax <= 1) return { x: 0, y: 0 };
  const extra = shot.parallax - 1;
  const t = shotProgress(shot, dur, frame);
  const x = ((shot.fromX || 0) + (((shot.toX || 0) - (shot.fromX || 0)) * t)) * extra;
  const y = ((shot.fromY || 0) + (((shot.toY || 0) - (shot.fromY || 0)) * t)) * extra;
  return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
}

// Transitions are capped at 9 frames (0.3s) and overlap the outgoing scene, so
// a cut is a cut and a crossfade is genuinely a crossfade.
function Trans(props) {
  const frame = useCurrentFrame();
  const enter = Math.max(0, Number(props.enter) || 0);
  const kind = props.kind || 'cut';
  if (!enter || kind === 'cut') return <AbsoluteFill>{props.children}</AbsoluteFill>;
  const p = clamp(frame, 0, enter, 0, 1);
  const style = {
    opacity: kind === 'fade' ? p : kind === 'slide' ? Math.min(1, p * 1.5) : 1,
    transform: 'translateX(' + (kind === 'slide' ? ((1 - p) * 4).toFixed(2) : '0') + '%)',
    clipPath: kind === 'wipe' ? 'inset(0 ' + ((1 - p) * 100).toFixed(1) + '% 0 0)' : undefined,
  };
  return (
    <AbsoluteFill style={style}>
      {props.children}
      {kind === 'flash' ? <AbsoluteFill style={{ background: '#ffffff', opacity: 1 - p }} /> : null}
      {kind === 'wipe' && p < 1 ? <div style={{ position: 'absolute', top: 0, bottom: 0, width: 12, left: (p * 100).toFixed(1) + '%', background: DATA.brand.primary }} /> : null}
    </AbsoluteFill>
  );
}

// The colour grade rolled for this generation, laid over every scene.
function Grade() {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {G.tint ? <AbsoluteFill style={{ background: G.tint, opacity: G.tintOpacity, mixBlendMode: 'soft-light' }} /> : null}
      {G.vignette ? <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.9) 135%)', opacity: G.vignette }} /> : null}
    </AbsoluteFill>
  );
}

// Light canvas: white with a soft drifting brand-tint wash (reference frames 1/3/4).
function Wash(props) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 80) * 60;
  const px = camOffset(props.shot, props.dur, frame);
  return (
    <AbsoluteFill style={{ background: '#ffffff', transform: 'translate(' + px.x + '%, ' + px.y + '%)' }}>
      <div style={{ position: 'absolute', width: 1100, height: 1100, borderRadius: 9999, filter: 'blur(170px)', opacity: 0.22, background: DATA.brand.primary, top: -430 + drift, left: -330 - drift }} />
      <div style={{ position: 'absolute', width: 820, height: 820, borderRadius: 9999, filter: 'blur(180px)', opacity: 0.13, background: DATA.brand.primary, bottom: -370 - drift, right: -260 + drift }} />
    </AbsoluteFill>
  );
}

// Full-bleed living brand gradient for punch slides (reference frame 2: 'Fast.').
function PunchBg(props) {
  const frame = useCurrentFrame();
  const shift = Math.sin(frame / 60) * 10;
  const px = camOffset(props.shot, props.dur, frame);
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(' + (115 + shift) + 'deg, color-mix(in srgb, ' + DATA.brand.primary + ' 78%, #000000) 0%, ' + DATA.brand.primary + ' 48%, color-mix(in srgb, ' + DATA.brand.primary + ' 68%, #ffffff) 100%)', transform: 'translate(' + px.x + '%, ' + px.y + '%)' }}>
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: 9999, filter: 'blur(150px)', opacity: 0.45, background: 'rgba(255,255,255,0.35)', top: '16%', left: '38%', transform: 'translate(' + shift * 4 + 'px, ' + -shift * 3 + 'px)' }} />
    </AbsoluteFill>
  );
}

// Typewriter with a blinking caret — the launch-video signature move
// (reference frames 1 and 4: 'Buil|', 'Launch turns|').
function Type(props) {
  const frame = useCurrentFrame();
  const text = String(props.text || '');
  const shown = text.slice(0, Math.max(0, Math.floor((frame - (props.delay || 0)) * REVEAL)));
  const on = frame % 16 < 9;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: 1560, flexWrap: 'wrap' }}>
      <span style={{ fontSize: props.size, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.06, color: props.color, textAlign: 'center', whiteSpace: 'pre-wrap' }}>{shown}</span>
      <span style={{ display: 'inline-block', width: Math.max(8, Math.round(props.size / 11)), height: Math.round(props.size * 0.88), marginLeft: 12, borderRadius: 4, background: props.caret, opacity: on ? 1 : 0 }} />
    </div>
  );
}

// Brand-gradient tinted headline on the light canvas (reference frame 3).
function GradText(props) {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps: FPS, config: { damping: 15, stiffness: 130 } });
  return (
    <div style={{ fontSize: props.size, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.08, textAlign: 'center', maxWidth: 1500, backgroundImage: 'linear-gradient(100deg, color-mix(in srgb, ' + DATA.brand.primary + ' 80%, #000000), ' + DATA.brand.primary + ', color-mix(in srgb, ' + DATA.brand.primary + ' 62%, #ffffff))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent', opacity: s, transform: 'translateY(' + (26 - s * 26) + 'px)' }}>{props.text}</div>
  );
}

function Frame(props) {
  const frame = useCurrentFrame();
  const fade = clamp(frame, 0, 6, 0, 1);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 120, opacity: fade }}>
      {props.kicker ? (
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 6, textTransform: 'uppercase', color: DATA.brand.primary, marginBottom: 34 }}>{props.kicker}</div>
      ) : null}
      {props.children}
    </AbsoluteFill>
  );
}

function ProofScene(props) {
  const frame = useCurrentFrame();
  const dur = Math.max(30, Number(props.dur) || 60);
  // The product IN USE: the cursor travels to a control, clicks, the job runs
  // and the result lands. Push-OUT only — the card settles back, never grows.
  const scale = clamp(frame, 0, Math.round(dur * 0.85), 1.04, 1);
  const sweep = clamp(frame, 4, dur - 6, -30, 130);
  const clickAt = Math.max(7, Math.round(dur * 0.3));
  const doneAt = Math.min(dur - 4, clickAt + Math.max(8, Math.round(dur * 0.22)));
  const cx = clamp(frame, 3, clickAt, 17, 57);
  const cy = clamp(frame, 3, clickAt, 76, 38);
  const ring = clamp(frame, clickAt, clickAt + 11, 0, 1);
  const working = clamp(frame, clickAt + 1, doneAt, 0, 100);
  const landed = clamp(frame, doneAt, doneAt + 6, 0, 1);
  return (
    <AbsoluteFill>
      <Wash shot={props.shot} dur={props.dur} />
      <Frame kicker={props.scene.headline}>
        <div style={{ position: 'relative', width: 1280, borderRadius: 18, overflow: 'hidden', border: '1px solid #e6e8ee', boxShadow: '0 44px 100px rgba(23,25,35,0.18), 0 16px 44px color-mix(in srgb, ' + DATA.brand.primary + ' 14%, transparent)', transform: 'scale(' + scale + ')', background: '#ffffff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', background: '#f6f7fa', borderBottom: '1px solid #e6e8ee' }}>
            <div style={{ width: 12, height: 12, borderRadius: 9999, background: '#f87171' }} />
            <div style={{ width: 12, height: 12, borderRadius: 9999, background: '#fbbf24' }} />
            <div style={{ width: 12, height: 12, borderRadius: 9999, background: '#4ade80' }} />
            <div style={{ marginLeft: 14, padding: '5px 16px', borderRadius: 8, background: '#eceef4', color: '#5b6270', fontSize: 17 }}>{DATA.brand.host}</div>
          </div>
          {DATA.brand.screenshotUrl ? (
            <Img src={DATA.brand.screenshotUrl} style={{ width: '100%', display: 'block' }} />
          ) : (
            <div style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 18, height: 560 }}>
              <div style={{ height: 34, width: '45%', borderRadius: 9, background: DATA.brand.primary, opacity: 0.9 }} />
              <div style={{ height: 18, width: '70%', borderRadius: 6, background: '#e9ebf1' }} />
              <div style={{ height: 18, width: '60%', borderRadius: 6, background: '#eef0f5' }} />
              <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
                <div style={{ flex: 1, height: 220, borderRadius: 14, background: '#f3f4f8', border: '1px solid #e6e8ee' }} />
                <div style={{ flex: 1, height: 220, borderRadius: 14, background: '#f3f4f8', border: '1px solid #e6e8ee' }} />
                <div style={{ flex: 1, height: 220, borderRadius: 14, background: '#f3f4f8', border: '1px solid #e6e8ee' }} />
              </div>
            </div>
          )}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: sweep + '%', width: '18%', transform: 'skewX(-14deg)', background: 'linear-gradient(105deg, transparent, rgba(255,255,255,0.55), transparent)' }} />
          {/* The product WORKING: the job runs, then the result lands. */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 9, background: 'rgba(20,22,30,0.08)' }}>
            <div style={{ height: '100%', width: working.toFixed(1) + '%', background: DATA.brand.primary }} />
          </div>
          <div style={{ position: 'absolute', top: 78, right: 28, display: 'flex', alignItems: 'center', gap: 12, padding: '13px 22px', borderRadius: 13, background: '#ffffff', border: '1px solid color-mix(in srgb, ' + DATA.brand.primary + ' 35%, #e6e8ee)', boxShadow: '0 18px 44px rgba(23,25,35,0.18)', opacity: landed, transform: 'translateY(' + ((1 - landed) * 12).toFixed(1) + 'px)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 9999, background: '#22c55e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800 }}>✓</span>
            <span style={{ fontSize: 23, fontWeight: 700, color: INK }}>{DATA.proofChip}</span>
          </div>
          <div style={{ position: 'absolute', left: cx.toFixed(2) + '%', top: cy.toFixed(2) + '%' }}>
            {ring > 0 && ring < 1 ? <div style={{ position: 'absolute', left: -36, top: -36, width: 72, height: 72, borderRadius: 9999, border: '3px solid ' + DATA.brand.primary, opacity: 1 - ring, transform: 'scale(' + (0.35 + ring * 1.15).toFixed(3) + ')' }} /> : null}
            <svg width="36" height="36" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 3px 9px rgba(0,0,0,0.35))' }}>
              <path d="M5 2 L5 19 L9.5 14.5 L12.5 21.5 L15.5 20 L12.5 13.5 L19 13 Z" fill="#ffffff" stroke="#16181d" strokeWidth="1.3" />
            </svg>
          </div>
        </div>
      </Frame>
    </AbsoluteFill>
  );
}

// Features alternate: PUNCH slides (huge white word on the full brand
// gradient) and LIGHT slides (gradient-tinted type on the white wash).
function FeatureScene(props) {
  const frame = useCurrentFrame();
  if (props.variant === 'punch') {
    const s = spring({ frame, fps: FPS, config: { damping: 14, stiffness: 150 } });
    const line = String(props.scene.headline || '');
    const size = line.length <= 12 ? 170 : line.length <= 26 ? 122 : 88;
    return (
      <AbsoluteFill>
        <PunchBg shot={props.shot} dur={props.dur} />
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 100 }}>
          <div style={{ fontSize: size, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, color: '#ffffff', textAlign: 'center', maxWidth: 1560, transform: 'scale(' + (1.05 - s * 0.05) + ')', opacity: clamp(frame, 0, 6, 0, 1), textShadow: '0 6px 60px rgba(0,0,0,0.18)' }}>{line}</div>
          {props.scene.sub ? <div style={{ marginTop: 30, fontSize: 34, color: 'rgba(255,255,255,0.88)', textAlign: 'center', opacity: clamp(frame, 4, 12, 0, 1) }}>{props.scene.sub}</div> : null}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <Wash shot={props.shot} dur={props.dur} />
      <Frame kicker={props.kicker}>
        <GradText text={props.scene.headline} size={headlineSize(props.scene.headline, 150)} />
        {props.scene.sub ? <div style={{ marginTop: 28, fontSize: 32, color: MUTE, textAlign: 'center', maxWidth: 1300, lineHeight: 1.45, opacity: clamp(frame, 4, 12, 0, 1) }}>{props.scene.sub}</div> : null}
      </Frame>
    </AbsoluteFill>
  );
}

// Rounded outline card with logo + typed product name (reference frame 1).
function ValueScene(props) {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps: FPS, config: { damping: 16, stiffness: 120 } });
  return (
    <AbsoluteFill>
      <Wash shot={props.shot} dur={props.dur} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, padding: '58px 84px', borderRadius: 44, border: '2.5px solid color-mix(in srgb, ' + DATA.brand.primary + ' 55%, #f0f0f0)', background: 'rgba(255,255,255,0.7)', boxShadow: '0 30px 90px color-mix(in srgb, ' + DATA.brand.primary + ' 16%, transparent)', transform: 'scale(' + (1.06 - s * 0.06) + ')', opacity: clamp(frame, 0, 6, 0, 1) }}>
          {DATA.brand.logoUrl ? <Img src={DATA.brand.logoUrl} style={{ height: 118, objectFit: 'contain' }} /> : null}
          <Type text={props.scene.headline} size={118} color={INK} caret={DATA.brand.primary} delay={2} />
        </div>
        {props.scene.sub ? (
          <div style={{ marginTop: 42, fontSize: 34, color: MUTE, textAlign: 'center', maxWidth: 1200, lineHeight: 1.45, opacity: clamp(frame, 6, 16, 0, 1) }}>{props.scene.sub}</div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// Closing punch: full brand gradient, typed white CTA, host below.
function CtaScene(props) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <PunchBg shot={props.shot} dur={props.dur} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 100 }}>
        {DATA.brand.logoUrl ? <Img src={DATA.brand.logoUrl} style={{ height: 86, objectFit: 'contain', marginBottom: 46, filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.25))' }} /> : null}
        <Type text={props.scene.headline} size={112} color={'#ffffff'} caret={'#ffffff'} />
        <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', gap: 14, padding: '18px 38px', borderRadius: 9999, background: '#ffffff', opacity: clamp(frame, 5, 13, 0, 1), transform: 'scale(' + (1.03 - clamp(frame, 5, 18, 0, 1) * 0.03) + ')', boxShadow: '0 18px 50px rgba(0,0,0,0.18)' }}>
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 1, color: INK }}>{DATA.brand.host}</span>
          <span style={{ fontSize: 30, fontWeight: 800, color: DATA.brand.primary }}>{'\u2192'}</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// Word-by-word kinetic reveal — the motion-first opener and the boldest plates.
function Words(props) {
  const frame = useCurrentFrame();
  const words = String(props.text || '').split(' ');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', maxWidth: 1600, columnGap: 22, rowGap: 2 }}>
      {words.map((w, i) => {
        const at = i * WORD_STEP;
        const o = clamp(frame, at, at + 5, 0, 1);
        return (
          <span key={i} style={{ display: 'inline-block', fontSize: props.size, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.06, color: props.color, opacity: o, transform: 'translateY(' + ((1 - o) * 26).toFixed(1) + 'px)' }}>{w}</span>
        );
      })}
    </div>
  );
}

function headlineSize(text, big) {
  const len = String(text || '').length;
  if (len <= 12) return big;
  if (len <= 26) return Math.round(big * 0.74);
  if (len <= 44) return Math.round(big * 0.58);
  return Math.round(big * 0.46);
}

// The real screenshot, far back and faint — the plate the result beat sits on.
function GhostShot(props) {
  const frame = useCurrentFrame();
  const px = camOffset(props.shot, props.dur, frame);
  if (!DATA.brand.screenshotUrl) return null;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: 'translate(' + px.x + '%, ' + px.y + '%)' }}>
      <Img src={DATA.brand.screenshotUrl} style={{ width: 1500, borderRadius: 22, opacity: 0.14, filter: 'blur(2px)' }} />
    </AbsoluteFill>
  );
}

// The opener has three faces, rolled per generation: text-first types the line
// on the wash (the default at the end of SceneBody), image-first sets it over
// the real product screenshot, motion-first slams it word-by-word onto the
// brand gradient.
function HookAlt(props) {
  const frame = useCurrentFrame();
  const px = camOffset(props.shot, props.dur, frame);
  const line = String(props.scene.headline || '');
  if (V.opening === 'motion-first') {
    return (
      <AbsoluteFill>
        <PunchBg shot={props.shot} dur={props.dur} />
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 110 }}>
          <Words text={line} size={headlineSize(line, 168)} color={'#ffffff'} />
          {props.scene.sub ? <div style={{ marginTop: 28, fontSize: 34, color: 'rgba(255,255,255,0.88)', textAlign: 'center', opacity: clamp(frame, 6, 14, 0, 1) }}>{props.scene.sub}</div> : null}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: 'translate(' + px.x + '%, ' + px.y + '%)' }}>
        {DATA.brand.screenshotUrl ? <Img src={DATA.brand.screenshotUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(3px)' }} /> : null}
        <AbsoluteFill style={{ background: 'rgba(255,255,255,0.66)' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 110 }}>
        <div style={{ padding: '38px 54px', borderRadius: 28, background: 'rgba(255,255,255,0.86)', border: '1px solid color-mix(in srgb, ' + DATA.brand.primary + ' 30%, #e9ebf1)', boxShadow: '0 34px 90px rgba(23,25,35,0.2)' }}>
          <Words text={line} size={headlineSize(line, 142)} color={INK} />
        </div>
        {props.scene.sub ? <div style={{ marginTop: 26, fontSize: 32, color: MUTE, textAlign: 'center', opacity: clamp(frame, 6, 14, 0, 1) }}>{props.scene.sub}</div> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// Social proof, verbatim from the page — never a number this app made up.
function SocialScene(props) {
  const frame = useCurrentFrame();
  const o = clamp(frame, 0, 8, 0, 1);
  return (
    <AbsoluteFill>
      <Wash shot={props.shot} dur={props.dur} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 120 }}>
        <div style={{ position: 'relative', maxWidth: 1420, padding: '74px 96px', borderRadius: 34, background: 'rgba(255,255,255,0.8)', border: '1px solid color-mix(in srgb, ' + DATA.brand.primary + ' 28%, #e9ebf1)', boxShadow: '0 34px 90px rgba(23,25,35,0.12)', opacity: o, transform: 'translateY(' + ((1 - o) * 14).toFixed(1) + 'px)' }}>
          <div style={{ position: 'absolute', top: -34, left: 46, fontSize: 150, lineHeight: 1, fontWeight: 800, color: 'color-mix(in srgb, ' + DATA.brand.primary + ' 34%, transparent)' }}>{'“'}</div>
          <div style={{ fontSize: 60, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.22, color: INK, textAlign: 'center' }}>{props.scene.headline}</div>
          {props.scene.sub ? <div style={{ marginTop: 24, fontSize: 27, color: MUTE, textAlign: 'center', letterSpacing: 2 }}>{props.scene.sub}</div> : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// The result the customer walks away with — the problem-solved beat.
function OutcomeScene(props) {
  const frame = useCurrentFrame();
  const o = clamp(frame, 0, 7, 0, 1);
  return (
    <AbsoluteFill>
      <Wash shot={props.shot} dur={props.dur} />
      <GhostShot shot={props.shot} dur={props.dur} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 120 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 34, padding: '13px 26px', borderRadius: 9999, background: 'color-mix(in srgb, ' + DATA.brand.primary + ' 12%, #ffffff)', border: '1px solid color-mix(in srgb, ' + DATA.brand.primary + ' 42%, transparent)', opacity: o }}>
          <span style={{ width: 30, height: 30, borderRadius: 9999, background: '#22c55e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✓</span>
          <span style={{ fontSize: 23, fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase', color: INK }}>The result</span>
        </div>
        <GradText text={props.scene.headline} size={headlineSize(props.scene.headline, 150)} />
        {props.scene.sub ? <div style={{ marginTop: 26, fontSize: 32, color: MUTE, textAlign: 'center', maxWidth: 1300, lineHeight: 1.45, opacity: clamp(frame, 5, 13, 0, 1) }}>{props.scene.sub}</div> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// Every scene is a body on a camera, inside a transition, under the grade.
function SceneView(props) {
  return (
    <Trans kind={props.scene.transition} enter={props.enter}>
      <AbsoluteFill style={{ filter: G.filter }}>
        <Cam shot={props.scene.shot} dur={props.dur}>
          <SceneBody scene={props.scene} dur={props.dur} shot={props.scene.shot} />
        </Cam>
        <Grade />
      </AbsoluteFill>
    </Trans>
  );
}

function SceneBody(props) {
  const kind = props.scene.kind;
  if (kind === 'proof') return <ProofScene scene={props.scene} dur={props.dur} shot={props.shot} />;
  if (kind === 'feature' || kind === 'usecase') return <FeatureScene scene={props.scene} dur={props.dur} shot={props.shot} variant={props.scene.look === 'punch' ? 'punch' : 'light'} kicker={kind === 'usecase' ? 'Built for' : ''} />;
  if (kind === 'cta') return <CtaScene scene={props.scene} dur={props.dur} shot={props.shot} />;
  if (kind === 'value') return <ValueScene scene={props.scene} dur={props.dur} shot={props.shot} />;
  if (kind === 'social') return <SocialScene scene={props.scene} dur={props.dur} shot={props.shot} />;
  if (kind === 'outcome') return <OutcomeScene scene={props.scene} dur={props.dur} shot={props.shot} />;
  if (kind === 'hook' && V.opening !== 'text-first') return <HookAlt scene={props.scene} dur={props.dur} shot={props.shot} />;
  // Hook: big dark typewriter on the light wash (reference frame 4). A
  // generated opening plate, when one exists, sits behind it under a white
  // scrim so the dark type keeps its contrast.
  return (
    <AbsoluteFill>
      {DATA.openerUrl ? (
        <AbsoluteFill>
          <OffthreadVideo src={DATA.openerUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ background: 'rgba(255,255,255,0.72)' }} />
        </AbsoluteFill>
      ) : (
        <Wash shot={props.shot} dur={props.dur} />
      )}
      <Frame>
        <Type text={props.scene.headline} size={128} color={INK} caret={DATA.brand.primary} />
        {props.scene.sub ? <div style={{ fontSize: 32, color: MUTE, marginTop: 30, textAlign: 'center' }}>{props.scene.sub}</div> : null}
      </Frame>
    </AbsoluteFill>
  );
}

export default function MotionVergerLaunch() {
  const frame = useCurrentFrame();
  let offset = 0;
  // A transition overlaps the outgoing scene by its own length (9 frames max),
  // so a crossfade really crosses and the total runtime is unchanged.
  const seqs = DATA.scenes.map((sc) => {
    const at = offset;
    const dur = Math.max(1, Math.round(sc.duration_s * FPS));
    offset += dur;
    const lead = at > 0 && sc.transition && sc.transition !== 'cut' ? Math.min(9, Math.round(dur * 0.22)) : 0;
    return { sc, from: at - lead, dur: dur + lead, enter: lead };
  });
  const total = Math.max(1, offset);
  return (
    <AbsoluteFill style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: '#ffffff' }}>
      {seqs.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.dur}>
          <SceneView scene={s.sc} dur={s.dur} enter={s.enter} />
        </Sequence>
      ))}
      <div style={{ position: 'absolute', left: 0, bottom: 0, height: 7, width: (Math.min(1, frame / total) * 100) + '%', background: DATA.brand.primary, zIndex: 5 }} />
      {DATA.musicUrl ? <Audio src={DATA.musicUrl} volume={0.45} /> : null}
    </AbsoluteFill>
  );
}
`;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<SceneKind, string> = { hook: 'Hook', value: 'Product', feature: 'Feature', usecase: 'Use case', proof: 'In use', social: 'Social proof', outcome: 'The result', cta: 'Call to action' };

export default function App() {
  const [projects, setProjects] = useState<MVProject[]>([]);
  const [active, setActive] = useState<MVProject | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [beds, setBeds] = useState<MusicBed[]>([]);
  // Energetic (index 2) is the launch-film default bed.
  const [bedIdx, setBedIdx] = useState<number>(2);
  const [musicOn, setMusicOn] = useState(true);
  // Optional generated opening plate. Runway Gen 4.5 is the default engine;
  // nothing is generated and nothing changes until the founder asks for it.
  // Persists for the browser session — the last-used engine stays selected.
  const [openerEngine, setOpenerEngine] = usePersistentEngine('motion-verger:opener-engine', 'gen4.5');
  const [openerUrl, setOpenerUrl] = useState('');
  const [openerOn, setOpenerOn] = useState(false);
  const [openerBusy, setOpenerBusy] = useState(false);
  const [openerErr, setOpenerErr] = useState('');
  // Which project this session is actively polling (drives the spinner and
  // the explicit "Check render status" affordance). loopSeq keeps ONE live
  // loop per project: a newer loop (e.g. Re-render) supersedes the old one.
  const [pollingId, setPollingId] = useState<number | null>(null);
  const loopSeq = useRef<Record<number, number>>({});

  const refresh = async () => {
    try {
      const rows = await db.list();
      setProjects(rows);
      return rows;
    } catch { return [] as MVProject[]; }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The workspace session token arrives a beat after mount.
      for (let i = 0; i < 20 && !(window as any).__workspaceDb; i += 1) await new Promise((r) => setTimeout(r, 500));
      if (cancelled) return;
      const rows = await refresh();
      loadMusicBeds().then((b) => { if (!cancelled) setBeds(b); });
      // BUG FIX: never auto-start or auto-resume a render on load. An
      // in-flight project is only SHOWN — polling reconnects solely from the
      // explicit "Check render status" button in its card.
      const inflight = rows.find((p) => p.status === 'rendering');
      if (inflight) setActive(inflight);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scan = async () => {
    const target = url.trim();
    if (!target) return;
    setErr('');
    setBusy('Reading your product page…');
    try {
      const scrape = await callHook('ps-brand-scrape', { url: /^https?:\/\//.test(target) ? target : 'https://' + target });
      const brand = toBrand(target, scrape);
      setBusy('Writing your launch script…');
      const script = await writeScript(brand, makeSeed());
      logCut('new cut', script);
      const row = await db.create({ title: script.title, url: target, brand, script, status: 'draft', stage: 'Script ready — review and generate' } as any);
      const project = { ...row, brand, script, status: 'draft' } as MVProject;
      setActive(project);
      refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally { setBusy(''); }
  };

  // A fresh roll of the dice on the SAME page material — new scene count, new
  // order, new shot lengths, new camera work. No scrape and no AI call.
  const reshuffle = async () => {
    if (!active?.brand || !active.script) return;
    const pool = active.script.pool || minePool(active.brand);
    const next = composeScript(active.brand, pool, makeSeed(), active.script.title);
    logCut('reshuffled cut', next);
    setActive({ ...active, script: next });
    try { await db.update(active.id, { script: next } as any); } catch { /* draft edits are best-effort */ }
  };

  const patchScene = (idx: number, patch: Partial<MVScene>) => {
    if (!active?.script) return;
    const scenes = active.script.scenes.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setActive({ ...active, script: { ...active.script, scenes } });
  };

  const persistScript = async (p: MVProject) => {
    try { await db.update(p.id, { script: p.script } as any); } catch { /* draft edits are best-effort */ }
  };

  const runRenderLoop = async (project: MVProject, first: Record<string, unknown>) => {
    // One live loop per project: a newer loop for the SAME project (e.g. the
    // Re-render button) supersedes this one, which then exits without writing.
    const seq = (loopSeq.current[project.id] || 0) + 1;
    loopSeq.current[project.id] = seq;
    const superseded = () => loopSeq.current[project.id] !== seq;
    setPollingId(project.id);
    // BUG FIX: persistence is deliberately NOT tied to the card being open.
    // The old loop bailed out before its DB writes whenever the user closed
    // the card or clicked a past launch — a completed render's video URL was
    // silently dropped. Now every terminal state is saved to mv_projects no
    // matter what the UI is showing; only the setActive updates are scoped.
    const persist = async (patch: Partial<MVProject>) => {
      try { await db.update(project.id, patch as any); return true; } catch { return false; }
    };
    const applyUi = (patch: Partial<MVProject>) => {
      setActive((a) => (a && a.id === project.id ? { ...a, ...patch } : a));
    };
    let payload: Record<string, unknown> = first;
    let consecutiveErrors = 0;
    // Remotion renders take minutes — the old 6-poll (~24s) budget marked
    // still-running renders as failed and their finished videos were lost.
    const deadline = Date.now() + 12 * 60 * 1000;
    try {
      while (Date.now() < deadline) {
        let out: any;
        try {
          out = await callHook('pv-render-composition', payload);
          consecutiveErrors = 0;
        } catch (e: any) {
          if (superseded()) return;
          // One dropped poll must not kill a render that is still running
          // server-side — only three failures in a row are terminal.
          consecutiveErrors += 1;
          if (consecutiveErrors >= 3) {
            const reason = String(e?.message || e);
            await persist({ status: 'failed', error: reason, stage: 'Render failed' } as any);
            applyUi({ status: 'failed', error: reason } as any);
            refresh();
            return;
          }
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        if (superseded()) return;
        if (out?.status === 'complete' && out?.renderUrl) {
          const videoUrl = String(out.renderUrl);
          const done = { status: 'completed', video_url: videoUrl, stage: 'Done', error: null } as Partial<MVProject>;
          const saved = (await persist(done)) || (await persist(done));
          if (!saved) setErr('Your launch film finished, but saving it to your history failed — download it from the open project now.');
          applyUi({ status: 'completed', video_url: videoUrl, error: null } as any);
          refresh();
          return;
        }
        if (out?.status === 'failed') {
          const reason = String(out?.error || 'The render failed.');
          await persist({ status: 'failed', error: reason, stage: 'Render failed' } as any);
          applyUi({ status: 'failed', error: reason } as any);
          refresh();
          return;
        }
        const opId = String(out?.operationId || payload.operationId || '');
        if (opId && payload.operationId !== opId) {
          await persist({ operation_id: opId, stage: 'Rendering your launch film…' } as any);
          applyUi({ operation_id: opId } as any);
        }
        payload = { operationId: opId };
        await new Promise((r) => setTimeout(r, 4000));
      }
      // Out of patience, NOT out of render: the server job may still finish.
      // The row stays 'rendering' (never falsely failed) so "Check render
      // status" can reconnect to it later.
      await persist({ stage: 'Still rendering — press "Check render status" to reconnect.' } as any);
      applyUi({ stage: 'Still rendering' } as any);
    } finally {
      if (!superseded()) setPollingId((id) => (id === project.id ? null : id));
    }
  };

  const resumeRender = (project: MVProject) => {
    if (!project.operation_id) return;
    runRenderLoop(project, { operationId: project.operation_id });
  };

  // Escape hatch for a render that was interrupted before it was submitted
  // (status 'rendering' with no operation id): hand the project back to the
  // editable script instead of leaving it stuck on a spinner forever.
  const backToScript = async () => {
    if (!active) return;
    const patch = { status: 'draft' as const, stage: 'Script ready — review and generate', error: null };
    try { await db.update(active.id, patch as any); } catch { /* the local reset still applies */ }
    setActive((a) => (a && a.id === active.id ? { ...a, ...patch } : a));
    refresh();
  };

  const makeOpener = async () => {
    if (!active?.script || !active.brand) return;
    const hook = active.script.scenes.filter((s) => s.kind === 'hook')[0] || active.script.scenes[0];
    const prompt = capPromptText(
      `Cinematic live-action opening shot for the ${active.brand.name} launch film. ${hook?.headline || active.brand.tagline}. `
      + 'Slow camera pull-back or lateral pan ONLY — never a push-in and never a zoom-in. '
      + 'Soft natural light, shallow depth of field, premium editorial mood. '
      + 'No text, no logos and no user interface anywhere in frame.',
    );
    setOpenerErr('');
    setOpenerBusy(true);
    try {
      // Image-to-video-only Runway models have no text-only path — the brand
      // screenshot becomes the seed frame so they stay usable here.
      const rw = runwayModel(openerEngine);
      const seedImage = rw && rw.inputType === 'image' ? (String(active.brand.screenshotUrl || '') || null) : null;
      const url = isRunwayModel(openerEngine)
        ? (await generateWithRunway({ model: openerEngine, prompt, image: seedImage, duration: 5, aspectRatio: '16:9' })).mediaUrls[0]
        : await pollGroupA((await submitGroupA({ model: openerEngine, prompt, aspectRatio: '16:9', duration: 8 })).operationId);
      setOpenerUrl(url);
      setOpenerOn(true);
    } catch (e: any) {
      setOpenerErr(String(e?.message || e));
    } finally {
      setOpenerBusy(false);
    }
  };

  const generate = async () => {
    if (!active?.script || !active.brand) return;
    setErr('');
    const bed = beds[bedIdx] || beds[0] || null;
    const musicUrl = musicOn && bed ? bed.url : '';
    // Every render rolls a FRESH seed, so camera moves, transitions and grade
    // are re-cast even when the script itself did not change.
    const renderSeed = makeSeed();
    const variant: MVVariant = { ...(active.script.variant || chooseVariant(renderSeed, variantContext(active.brand, active.script.pool || null))), seed: renderSeed };
    const grade = rollGrade(renderSeed);
    variant.grade = grade.id;
    variant.label = variantLabel(variant);
    const scenes = assignCameraWork(active.script.scenes, renderSeed, variant);
    const cutScript: MVScript = { ...active.script, scenes, variant };
    logCut('rendering', cutScript);
    const data: RenderData = {
      scenes,
      brand: { name: active.brand.name, tagline: active.brand.tagline, logoUrl: active.brand.logoUrl, screenshotUrl: active.brand.screenshotUrl, primary: active.brand.primary, secondary: active.brand.secondary, host: active.brand.host, cta: active.brand.cta },
      musicUrl,
      openerUrl: openerOn && openerUrl ? openerUrl : '',
      totalFrames: totalFramesOf(scenes),
      grade,
      variant: { seed: renderSeed, opening: variant.opening, pacing: variant.pacing, tone: variant.tone, label: variant.label },
      proofChip: proofChipLabel(active.script.pool),
    };
    const tsx = buildCompositionTsx(data);
    try {
      await persistScript({ ...active, script: cutScript });
      await db.update(active.id, { status: 'rendering', stage: 'Submitting the render…', music_url: musicUrl || null, error: null, video_url: null } as any);
    } catch (e: any) {
      // Surfaced instead of dying as an unhandled rejection — the user must
      // know the render did not start.
      setErr('The render could not be started: ' + String(e?.message || e));
      return;
    }
    const project = { ...active, script: cutScript, status: 'rendering' as const, video_url: null, error: null };
    setActive(project);
    runRenderLoop(project, { compositionTsx: tsx, durationInFrames: data.totalFrames, props: {} });
  };

  const totalS = active?.script ? active.script.scenes.reduce((s, x) => s + x.duration_s, 0) : 0;
  const inputStyle = { background: T.raised, border: '1px solid ' + T.line, borderRadius: 8, color: T.bone, fontSize: 13, padding: '9px 12px', outline: 'none', width: '100%' } as const;

  return (
    <div style={{ minHeight: '100%', background: T.canvas, fontFamily: T.sans, padding: '28px 24px 80px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div>
            <div style={{ color: T.bone, fontSize: 24, fontWeight: 800, letterSpacing: -0.4 }}>MotionVerger</div>
            <div style={{ color: T.muted, fontSize: 13 }}>Your SaaS launch video: paste your URL — get a 15–45s product-demo film in your brand. Every run is a different cut.</div>
          </div>
        </div>

        {/* URL intake */}
        <div style={{ display: 'flex', gap: 10, marginTop: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 280 }}>
            <Globe size={15} color={T.dim} style={{ position: 'absolute', left: 13, top: 13 }} />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourproduct.com"
              style={{ ...inputStyle, padding: '11px 14px 11px 38px', fontSize: 14 }}
            />
          </div>
          <button onClick={scan} disabled={!!busy || !url.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: busy ? T.raised : T.live, color: busy ? T.dim : '#1A1205', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} {busy || 'Build my launch video'}
          </button>
        </div>
        {err ? <div style={{ marginTop: 12, color: T.fault, fontSize: 12.5, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>{err}</div> : null}

        {/* Active project */}
        {active?.brand && active?.script ? (
          <div style={{ marginTop: 26, border: '1px solid ' + T.line, borderRadius: 14, background: T.card, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {active.brand.logoUrl ? <img src={active.brand.logoUrl} alt="" style={{ height: 34, objectFit: 'contain' }} /> : null}
              <div style={{ minWidth: 0 }}>
                <div style={{ color: T.bone, fontSize: 16, fontWeight: 800 }}>{active.brand.name}</div>
                <div style={{ color: T.muted, fontSize: 12.5 }}>{active.brand.tagline || active.brand.host}</div>
              </div>
              <span title="Brand accent read from the page" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, color: T.muted, fontSize: 11.5 }}>
                <span style={{ width: 16, height: 16, borderRadius: 5, background: active.brand.primary, border: '1px solid rgba(255,255,255,0.2)' }} /> brand colour
              </span>
              <button onClick={() => setActive(null)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: 4 }} title="Close"><X size={16} /></button>
            </div>

            {active.status === 'completed' && active.video_url ? (
              <div style={{ marginTop: 18 }}>
                <video src={active.video_url} controls style={{ width: '100%', borderRadius: 12, border: '1px solid ' + T.line, background: '#000' }} />
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <a href={active.video_url} download target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.live, color: '#1A1205', borderRadius: 10, padding: '10px 20px', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}><Download size={14} /> Download MP4</a>
                  <button onClick={generate} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.raised, color: T.bone, border: '1px solid ' + T.line, borderRadius: 10, padding: '10px 20px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}><RefreshCw size={14} /> Render a new cut</button>
                </div>
              </div>
            ) : active.status === 'rendering' ? (
              <div style={{ marginTop: 18, background: T.raised, border: '1px solid ' + T.line, borderRadius: 11, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Loader2 size={17} className={pollingId === active.id ? 'animate-spin' : undefined} color={T.live} />
                  <div>
                    <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 700 }}>{pollingId === active.id ? 'Rendering your launch film…' : 'A render for this project is in flight.'}</div>
                    <div style={{ color: T.muted, fontSize: 12 }}>{pollingId === active.id ? 'Server-side render — the finished film is saved to your launch videos below.' : 'Nothing starts on its own — check its status or go back to the script.'}</div>
                  </div>
                </div>
                {pollingId !== active.id ? (
                  <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                    {active.operation_id ? (
                      <button onClick={() => resumeRender(active)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.live, color: '#1A1205', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}><RefreshCw size={14} /> Check render status</button>
                    ) : null}
                    <button onClick={backToScript} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.raised, color: T.bone, border: '1px solid ' + T.line, borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Back to script</button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                {active.status === 'failed' && active.error ? (
                  <div style={{ marginTop: 14, color: T.fault, fontSize: 12.5, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>{active.error}</div>
                ) : null}
                <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 }}>
                  Launch script · <span style={{ color: totalS >= 15 && totalS <= 45 ? T.done : T.live }}>{Math.round(totalS)}s</span>
                  {active.script.variant ? (
                    <span style={{ color: T.dim, fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}> · {active.script.variant.label}</span>
                  ) : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {active.script.scenes.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: T.raised, border: '1px solid ' + T.line, borderRadius: 10, padding: '10px 12px', flexWrap: 'wrap' }}>
                      <span style={{ width: 96, flexShrink: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: s.kind === 'cta' ? T.live : T.muted }}>{KIND_LABEL[s.kind]}</span>
                      <input value={s.headline} onChange={(e) => patchScene(i, { headline: e.target.value.slice(0, 60) })} style={{ ...inputStyle, flex: 2, minWidth: 180, fontWeight: 700 }} />
                      <input value={s.sub} onChange={(e) => patchScene(i, { sub: e.target.value.slice(0, 90) })} placeholder="supporting line (optional)" style={{ ...inputStyle, flex: 2, minWidth: 160 }} />
                      <select value={s.duration_s} onChange={(e) => patchScene(i, { duration_s: Number(e.target.value) })} style={{ ...inputStyle, width: 64, flexShrink: 0 }}>
                        {[2, 2.5, 3, 3.5, 4, 4.5, 5].map((d) => <option key={d} value={d}>{d}s</option>)}
                      </select>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 16, background: T.raised, border: '1px solid ' + T.line, borderRadius: 10, padding: '12px 13px' }}>
                  <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 8 }}>Opening shot · optional</div>
                  <div style={{ color: T.dim, fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
                    Generate a cinematic plate to sit behind the hook. Skip it and the film stays entirely code-rendered.
                  </div>
                  <EnginePicker
                    value={openerEngine}
                    onChange={setOpenerEngine}
                    includeRunway
                    includeKling={false}
                    groupAIds={['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview', 'gemini-omni-flash-preview', 'sora-2']}
                    disabled={openerBusy}
                    note={runwayModel(openerEngine)?.inputType === 'image' ? 'This model is image-to-video — your brand screenshot is used as the seed frame for the plate.' : undefined}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      onClick={makeOpener}
                      disabled={openerBusy}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: T.raised, color: T.bone, border: '1px solid ' + T.line, borderRadius: 9, padding: '8px 15px', fontSize: 12.5, fontWeight: 700, cursor: openerBusy ? 'default' : 'pointer', opacity: openerBusy ? 0.6 : 1 }}
                    >
                      {openerBusy ? <Loader2 size={13} /> : <Zap size={13} />}
                      {openerBusy ? 'Generating the plate…' : openerUrl ? 'Regenerate plate' : 'Generate opening shot'}
                    </button>
                    {openerUrl ? (
                      <>
                        <video src={openerUrl} muted style={{ width: 118, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 7, background: '#000' }} />
                        <button
                          onClick={() => setOpenerOn(!openerOn)}
                          style={{ background: openerOn ? 'rgba(245,158,11,0.14)' : T.raised, color: openerOn ? T.live : T.muted, border: '1px solid ' + (openerOn ? 'rgba(245,158,11,0.4)' : T.line), borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                        >
                          {openerOn ? 'Plate on' : 'Plate off'}
                        </button>
                        <button
                          onClick={() => { setOpenerUrl(''); setOpenerOn(false); }}
                          style={{ background: 'transparent', color: T.dim, border: '1px solid ' + T.line, borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      </>
                    ) : null}
                  </div>
                  {openerErr ? <div style={{ marginTop: 9, color: T.fault, fontSize: 12, lineHeight: 1.5 }}>{openerErr}</div> : null}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                  <Music size={14} color={T.muted} />
                  <button onClick={() => setMusicOn(!musicOn)} style={{ background: musicOn ? 'rgba(245,158,11,0.14)' : T.raised, color: musicOn ? T.live : T.muted, border: '1px solid ' + (musicOn ? 'rgba(245,158,11,0.4)' : T.line), borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{musicOn ? 'Music on' : 'Music off'}</button>
                  {musicOn && beds.length ? (
                    <select value={bedIdx} onChange={(e) => setBedIdx(Number(e.target.value))} style={{ ...inputStyle, width: 200 }}>
                      {beds.map((b, i) => <option key={i} value={i}>{b.label}</option>)}
                    </select>
                  ) : musicOn ? <span style={{ color: T.dim, fontSize: 12 }}>Loading the music library…</span> : null}
                  <button onClick={reshuffle} title="Roll a new cut from the same page — new scene count, order, timing and camera work" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, background: T.raised, color: T.bone, border: '1px solid ' + T.line, borderRadius: 9, padding: '10px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                    <Shuffle size={13} /> Shuffle the cut
                  </button>
                  <button onClick={generate} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: T.live, color: '#1A1205', border: 'none', borderRadius: 10, padding: '12px 26px', fontSize: 14, fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 14px rgba(245,158,11,0.3)' }}>
                    <Play size={15} /> Generate launch video
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* Past launches */}
        {projects.filter((p) => p.status === 'completed' && p.video_url).length ? (
          <>
            <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 34, marginBottom: 12 }}>Your launch videos</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {projects.filter((p) => p.status === 'completed' && p.video_url).map((p) => (
                <button key={p.id} onClick={() => setActive(p)} style={{ textAlign: 'left', background: T.card, border: '1px solid ' + T.line, borderRadius: 12, padding: 0, overflow: 'hidden', cursor: 'pointer' }}>
                  <video src={p.video_url || undefined} muted style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', background: '#000', display: 'block' }} />
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ color: T.bone, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title || p.url}</div>
                    <div style={{ color: T.dim, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}><Check size={11} color={T.done} /> Launch film</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {!active && !projects.length && !busy ? (
          <div style={{ marginTop: 40, textAlign: 'center', color: T.dim, fontSize: 13, lineHeight: 1.7 }}>
            <ArrowRight size={18} style={{ transform: 'rotate(90deg)' }} /><br />
            Paste your product URL above. MotionVerger reads your real page — name, copy, features, use cases, proof, colours, logo, screenshot —<br />
            composes a fresh cut you can edit, and renders a 15–45s product-demo film with music. Every run is a different edit.
          </div>
        ) : null}
      </div>
    </div>
  );
}
