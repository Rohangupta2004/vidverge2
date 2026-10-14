// Rive Scene Generator — the Rive-compatible canvas renderer.
//
// This file owns TWO things and nothing else:
//
//   1. MACHINES — the registry of the five bundled Rive state machines and the
//      exact inputs each one exposes. This registry is the single source of
//      truth: lib/claude.ts formats it into the system prompt, the parser
//      validates the model's steps against it, and lib/riveRuntime.ts applies
//      the same input names to a real .riv. Nothing may drift.
//
//   2. A deterministic renderer. buildTimeline() folds the model's step list
//      into a resolved timeline, and drawScene() paints the frame for any given
//      millisecond. Because drawScene is a pure function of (timeline, nowMs),
//      playback is fully scrubbable and MediaRecorder capture is frame-exact.
//
// THERE IS NO BUILT-IN SEQUENCE HERE. Every reveal, move, click, chart point
// and badge in the output exists because a step in the model's plan asked for
// it. An empty step list paints an empty stage.

export type InputKind = 'trigger' | 'number' | 'string';

export interface MachineInputSpec {
  name: string;
  kind: InputKind;
  range?: [number, number];
  description: string;
}

export interface MachineSpec {
  name: string;
  summary: string;
  inputs: MachineInputSpec[];
}

/* ----------------------- the bundled state machines ----------------------- */

export const MACHINES: MachineSpec[] = [
  {
    name: 'dashboard',
    summary: 'Dark glass dashboard panel — the scene shell and background.',
    inputs: [
      { name: 'startLoad', kind: 'trigger', description: 'Bring the dashboard shell in and run its loading sweep.' },
      { name: 'showCards', kind: 'trigger', description: 'Reveal the metric card row.' },
      { name: 'drawChart', kind: 'trigger', description: 'Reveal the chart area and draw the line.' },
      { name: 'showSuccess', kind: 'trigger', description: 'Switch the shell into its success state.' },
    ],
  },
  {
    name: 'metricCard',
    summary: 'A row of three KPI cards that slide and fade in.',
    inputs: [
      { name: 'cardIndex', kind: 'number', range: [0, 2], description: 'Select which of the three cards the next animateIn / setValue targets.' },
      { name: 'animateIn', kind: 'trigger', description: 'Slide the selected card in. Fire three times for a one-by-one reveal.' },
      { name: 'setValue', kind: 'number', description: 'The KPI number shown on the selected card; it counts up to this value.' },
    ],
  },
  {
    name: 'cursor',
    summary: 'An animated pointer that travels across the UI and clicks.',
    inputs: [
      { name: 'moveToButton', kind: 'trigger', description: 'Glide the cursor to the next UI target (button, card row, chart, badge).' },
      { name: 'clickButton', kind: 'trigger', description: 'Play a click ripple at the cursor position.' },
    ],
  },
  {
    name: 'chartLine',
    summary: 'An area/line chart that draws itself from left to right.',
    inputs: [
      { name: 'startDraw', kind: 'trigger', description: 'Start the self-drawing stroke animation.' },
      { name: 'setValue', kind: 'number', range: [0, 100], description: 'A data point. Send one for the peak, or several to shape the whole series.' },
    ],
  },
  {
    name: 'successBadge',
    summary: 'A green success badge with an animated checkmark.',
    inputs: [
      { name: 'show', kind: 'trigger', description: 'Pop the badge in with a ring burst.' },
      { name: 'messageText', kind: 'string', description: 'The label drawn inside the badge.' },
    ],
  },
];

export const MACHINE_MAP: Record<string, MachineSpec> = MACHINES.reduce(
  (acc, m) => ((acc[m.name] = m), acc),
  {} as Record<string, MachineSpec>,
);

export function isKnownMachine(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(MACHINE_MAP, name);
}

export function findInput(machine: string, input: string): MachineInputSpec | null {
  return MACHINE_MAP[machine]?.inputs.find((i) => i.name === input) || null;
}

/** "cardIndex (number 0-2)" — the exact shape advertised in the system prompt. */
export function describeInput(i: MachineInputSpec): string {
  const range = i.kind === 'number' && i.range ? ` ${i.range[0]}-${i.range[1]}` : '';
  return `${i.name} (${i.kind}${range})`;
}

/* --------------------------------- theme --------------------------------- */

export const THEME = {
  bg0: '#0D0B05',
  bg1: '#110E07',
  panel: 'rgba(17,14,7,0.88)',
  panelStrong: 'rgba(24,21,10,0.95)',
  card: 'rgba(28,24,8,0.92)',
  border: 'rgba(158,139,85,0.18)',
  borderStrong: 'rgba(252,211,77,0.34)',
  text: '#F5E9C8',
  muted: '#9E8B55',
  violet: '#f59e0b',
  violetBright: '#fcd34d',
  violetDeep: '#b45309',
  green: '#22c55e',
  greenBright: '#4ade80',
  red: '#ef4444',
};

/* -------------------------------- layout --------------------------------- */

export const STAGE_W = 1280;
export const STAGE_H = 720;

export const LAYOUT = {
  panel: { x: 64, y: 48, w: 1152, h: 624 },
  headerH: 72,
  /** The primary action the cursor aims at, drawn in the shell header. */
  button: { x: 1044, y: 66, w: 148, h: 36 },
  cards: { x: 112, y: 152, w: 1056, h: 140, gap: 24 },
  chart: { x: 112, y: 324, w: 1056, h: 236 },
  badge: { cx: 640, cy: 612, h: 60 },
};

export interface Pt {
  x: number;
  y: number;
}

/** Where the cursor rests before its first move. */
export const CURSOR_START: Pt = { x: 288, y: 648 };

/** moveToButton walks this list in order, cycling if fired more times. */
export const CURSOR_TARGETS: Pt[] = [
  { x: LAYOUT.button.x + LAYOUT.button.w / 2, y: LAYOUT.button.y + LAYOUT.button.h / 2 },
  { x: 640, y: LAYOUT.cards.y + LAYOUT.cards.h / 2 },
  { x: 640, y: LAYOUT.chart.y + LAYOUT.chart.h / 2 },
  { x: LAYOUT.badge.cx, y: LAYOUT.badge.cy },
];

const CURSOR_MOVE_MS = 620;
const CARD_LABELS = ['Revenue', 'Active Users', 'Conversion'];
const CARD_DELTAS = ['+18.4%', '+9.1%', '+2.3%'];
/** Template content shown when the plan reveals a card but never sets its value. */
const CARD_FALLBACK_VALUES = [48200, 12840, 7.4];

/* ------------------------------ math helpers ------------------------------ */

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOutCubic = (t: number) =>
  (t = clamp(t, 0, 1)) < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  t = clamp(t, 0, 1);
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/* ------------------------------- timeline -------------------------------- */

/** One validated step from the model, already in milliseconds. */
export interface TimedStep {
  atMs: number;
  machine: string;
  input: string;
  kind: InputKind;
  value?: number | string | boolean;
}

export interface CardState {
  revealAt: number | null;
  value: number | null;
  valueAt: number | null;
}

export interface CursorMove {
  atMs: number;
  from: Pt;
  to: Pt;
}

export interface Timeline {
  durationMs: number;
  shell: { loadAt: number | null; cardsAt: number | null; chartAt: number | null; successAt: number | null };
  cards: CardState[];
  cursor: { firstAt: number | null; moves: CursorMove[]; clicks: number[] };
  chart: { drawAt: number | null; series: number[]; headline: number | null };
  badge: { showAt: number | null; text: string };
  /** Machine names the plan actually drove — shown in the UI. */
  machines: string[];
  stepCount: number;
  /**
   * The validated steps, ascending, exactly as the model sent them. The real
   * Rive layer (lib/riveRuntime.ts) replays these by name so the .riv and the
   * canvas renderer are driven by one and the same plan.
   */
  riveSteps: TimedStep[];
}

/**
 * Shape a chart series out of however many setValue points the model sent.
 * One point reads as "the peak"; three or more are used as the series itself.
 */
function seriesFrom(values: number[]): number[] {
  if (values.length >= 3) return values.slice(0, 24);
  const peak = values.length ? values[values.length - 1] : 88;
  const curve = [0.18, 0.3, 0.26, 0.44, 0.38, 0.58, 0.52, 0.74, 1];
  return curve.map((f) => clamp(peak * f, 1.5, 100));
}

/**
 * Fold the model's steps into a resolved timeline.
 *
 * Two interpretive rules keep real model output playable without inventing
 * motion the plan never asked for:
 *   - metricCard's animateIn / setValue fall through to the next untouched card
 *     when the plan fires them repeatedly without re-selecting cardIndex.
 *   - a dashboard trigger stands in for the element machine it names when the
 *     plan never drove that element directly (showCards with no animateIn,
 *     drawChart with no startDraw, showSuccess with no successBadge.show).
 */
export function buildTimeline(steps: TimedStep[], requestedDurationMs: number): Timeline {
  const sorted = [...steps].sort((a, b) => a.atMs - b.atMs);

  const shell: Timeline['shell'] = { loadAt: null, cardsAt: null, chartAt: null, successAt: null };
  const cards: CardState[] = [0, 1, 2].map(() => ({ revealAt: null, value: null, valueAt: null }));
  const moves: CursorMove[] = [];
  const clicks: number[] = [];
  const chartValues: number[] = [];
  let cursorFirstAt: number | null = null;
  let chartDrawAt: number | null = null;
  let badgeShowAt: number | null = null;
  let badgeText = '';

  const hasStep = (machine: string, input: string) =>
    sorted.some((s) => s.machine === machine && s.input === input);
  const explicitCardReveal = hasStep('metricCard', 'animateIn');
  const usesCardIndex = hasStep('metricCard', 'cardIndex');

  let selected = 0;
  let revealCursor = 0;
  let valueCursor = 0;
  let lastRevealed = -1;

  /** Pick a card index, falling through to the next untouched one. */
  const pickCard = (preferred: number, taken: (c: CardState) => boolean) => {
    let idx = clamp(preferred, 0, 2);
    if (taken(cards[idx])) {
      const next = cards.findIndex((c) => !taken(c));
      if (next >= 0) idx = next;
    }
    return idx;
  };

  for (const s of sorted) {
    const at = s.atMs;
    switch (s.machine) {
      case 'dashboard': {
        if (s.input === 'startLoad' && shell.loadAt === null) shell.loadAt = at;
        else if (s.input === 'showCards' && shell.cardsAt === null) shell.cardsAt = at;
        else if (s.input === 'drawChart' && shell.chartAt === null) shell.chartAt = at;
        else if (s.input === 'showSuccess' && shell.successAt === null) shell.successAt = at;
        break;
      }
      case 'metricCard': {
        if (s.input === 'cardIndex') {
          selected = clamp(Math.round(Number(s.value) || 0), 0, 2);
        } else if (s.input === 'animateIn') {
          const idx = pickCard(usesCardIndex ? selected : revealCursor, (c) => c.revealAt !== null);
          cards[idx].revealAt = at;
          revealCursor = Math.min(2, idx + 1);
          lastRevealed = idx;
        } else if (s.input === 'setValue') {
          const preferred = usesCardIndex ? selected : lastRevealed >= 0 ? lastRevealed : valueCursor;
          const idx = pickCard(preferred, (c) => c.value !== null);
          cards[idx].value = Number(s.value) || 0;
          cards[idx].valueAt = at;
          valueCursor = Math.min(2, idx + 1);
          // A plan that only sets values (never animateIn) still reveals the card.
          if (!explicitCardReveal && cards[idx].revealAt === null) cards[idx].revealAt = at;
        }
        break;
      }
      case 'cursor': {
        if (cursorFirstAt === null) cursorFirstAt = at;
        if (s.input === 'moveToButton') {
          const from = moves.length ? moves[moves.length - 1].to : CURSOR_START;
          moves.push({ atMs: at, from, to: CURSOR_TARGETS[moves.length % CURSOR_TARGETS.length] });
        } else if (s.input === 'clickButton') {
          clicks.push(at);
        }
        break;
      }
      case 'chartLine': {
        if (s.input === 'startDraw') {
          if (chartDrawAt === null) chartDrawAt = at;
        } else if (s.input === 'setValue') {
          chartValues.push(clamp(Number(s.value) || 0, 0, 100));
        }
        break;
      }
      case 'successBadge': {
        if (s.input === 'show') {
          if (badgeShowAt === null) badgeShowAt = at;
        } else if (s.input === 'messageText') {
          badgeText = String(s.value ?? '').slice(0, 48);
        }
        break;
      }
      default:
        break;
    }
  }

  // A dashboard trigger drives the element it names when nothing else did.
  if (!explicitCardReveal && shell.cardsAt !== null) {
    for (let i = 0; i < 3; i++) {
      if (cards[i].revealAt === null) cards[i].revealAt = shell.cardsAt + i * 260;
    }
  }
  if (chartDrawAt === null && shell.chartAt !== null) chartDrawAt = shell.chartAt;
  if (badgeShowAt === null && shell.successAt !== null) badgeShowAt = shell.successAt;

  const lastAt = sorted.length ? sorted[sorted.length - 1].atMs : 0;
  const durationMs = Math.max(requestedDurationMs, lastAt + 1400);

  return {
    durationMs,
    shell,
    cards,
    cursor: { firstAt: cursorFirstAt, moves, clicks },
    chart: {
      drawAt: chartDrawAt,
      series: seriesFrom(chartValues),
      headline: chartValues.length ? chartValues[chartValues.length - 1] : null,
    },
    badge: { showAt: badgeShowAt, text: badgeText },
    machines: Array.from(new Set(sorted.map((s) => s.machine))),
    stepCount: sorted.length,
    riveSteps: sorted,
  };
}

/** Cursor position at nowMs, interpolated across its queued moves. */
export function cursorPosAt(tl: Timeline, nowMs: number): Pt {
  let pos = CURSOR_START;
  for (const m of tl.cursor.moves) {
    if (nowMs <= m.atMs) break;
    const k = easeInOutCubic((nowMs - m.atMs) / CURSOR_MOVE_MS);
    pos = { x: m.from.x + (m.to.x - m.from.x) * k, y: m.from.y + (m.to.y - m.from.y) * k };
    if (k < 1) break;
  }
  return pos;
}

/* ----------------------------- draw helpers ------------------------------ */

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function glass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { fill?: string; border?: string; glow?: string } = {},
) {
  ctx.save();
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = 44;
  }
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = opts.fill || THEME.panel;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = opts.border || THEME.border;
  ctx.stroke();
  ctx.restore();
}

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${Math.round(v / 100_000) / 10}M`;
  if (abs >= 1000) return `${Math.round(v / 100) / 10}K`;
  return `${Math.round(v * 10) / 10}`;
}

function formatCardValue(index: number, v: number): string {
  if (index === 0) return `$${compactNumber(v)}`;
  if (index === 1) return Math.round(v).toLocaleString('en-US');
  return `${Math.round(v * 10) / 10}%`;
}

/* ------------------------------- the scene ------------------------------- */

export function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, nowMs: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.06, 0, w / 2, h * 0.06, h * 1.15);
  g.addColorStop(0, 'rgba(245,158,11,0.16)');
  g.addColorStop(0.45, THEME.bg1);
  g.addColorStop(1, THEME.bg0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.strokeStyle = '#C8AA6E';
  ctx.lineWidth = 1;
  const step = 48;
  const off = (nowMs / 70) % step;
  for (let x = -off; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = -off; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawEmptyStage(ctx: CanvasRenderingContext2D, w: number, h: number, nowMs: number) {
  drawBackdrop(ctx, w, h, nowMs);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(245,233,200,0.82)';
  ctx.font = '600 30px Inter, system-ui, sans-serif';
  ctx.fillText('Describe an animation, then press Generate Animation', w / 2, h / 2 - 6);
  ctx.fillStyle = THEME.muted;
  ctx.font = '400 17px Inter, system-ui, sans-serif';
  ctx.fillText('Every frame below is built from the step list Claude returns.', w / 2, h / 2 + 30);
  ctx.restore();
}

function drawShell(ctx: CanvasRenderingContext2D, tl: Timeline, nowMs: number, buttonFlash: number) {
  const { loadAt, successAt } = tl.shell;
  if (loadAt === null || nowMs < loadAt) return;
  const p = easeOutCubic((nowMs - loadAt) / 700);
  const P = LAYOUT.panel;
  const succeeded = successAt !== null && nowMs >= successAt;

  ctx.save();
  ctx.globalAlpha = p;
  const cx = P.x + P.w / 2;
  const cy = P.y + P.h / 2;
  const sc = 0.965 + 0.035 * p;
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  ctx.translate(-cx, -cy);

  glass(ctx, P.x, P.y, P.w, P.h, 24, {
    fill: THEME.panelStrong,
    border: succeeded ? 'rgba(74,222,128,0.42)' : THEME.borderStrong,
    glow: succeeded ? 'rgba(34,197,94,0.22)' : 'rgba(245,158,11,0.20)',
  });

  // header band
  ctx.save();
  roundRect(ctx, P.x, P.y, P.w, LAYOUT.headerH, 24);
  ctx.clip();
  ctx.fillStyle = 'rgba(245,158,11,0.08)';
  ctx.fillRect(P.x, P.y, P.w, LAYOUT.headerH);
  ctx.restore();
  ctx.strokeStyle = THEME.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(P.x, P.y + LAYOUT.headerH);
  ctx.lineTo(P.x + P.w, P.y + LAYOUT.headerH);
  ctx.stroke();

  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(P.x + 30 + i * 21, P.y + LAYOUT.headerH / 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });

  ctx.textBaseline = 'middle';
  ctx.fillStyle = THEME.text;
  ctx.font = '600 19px Inter, system-ui, sans-serif';
  ctx.fillText('Analytics', P.x + 118, P.y + LAYOUT.headerH / 2);

  // the cursor's click target
  const B = LAYOUT.button;
  ctx.save();
  if (buttonFlash > 0) {
    ctx.shadowColor = 'rgba(252,211,77,0.9)';
    ctx.shadowBlur = 26 * buttonFlash;
  }
  roundRect(ctx, B.x, B.y, B.w, B.h, 10);
  const bg = ctx.createLinearGradient(B.x, B.y, B.x + B.w, B.y + B.h);
  bg.addColorStop(0, buttonFlash > 0 ? '#fde68a' : THEME.violetBright);
  bg.addColorStop(1, buttonFlash > 0 ? THEME.violetBright : THEME.violet);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#1f1306';
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Generate', B.x + B.w / 2, B.y + B.h / 2 + 1);
  ctx.textAlign = 'left';

  // loading sweep — runs until the shell has something else to show
  const nextBeat = [tl.shell.cardsAt, tl.shell.chartAt, tl.shell.successAt, tl.chart.drawAt, tl.cards[0].revealAt]
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)[0];
  const loadEnd = nextBeat !== undefined ? Math.min(nextBeat, loadAt + 2600) : loadAt + 1400;
  if (nowMs < loadEnd) {
    const k = clamp((nowMs - loadAt) / Math.max(320, loadEnd - loadAt), 0, 1);
    const barW = P.w - 56;
    ctx.save();
    ctx.globalAlpha = 0.9 * (1 - easeInOutCubic(Math.max(0, (nowMs - loadEnd + 260) / 260)));
    roundRect(ctx, P.x + 28, P.y + LAYOUT.headerH + 18, barW, 4, 999);
    ctx.fillStyle = 'rgba(158,139,85,0.18)';
    ctx.fill();
    roundRect(ctx, P.x + 28, P.y + LAYOUT.headerH + 18, Math.max(6, barW * easeOutCubic(k)), 4, 999);
    ctx.fillStyle = THEME.violetBright;
    ctx.fill();
    ctx.fillStyle = THEME.muted;
    ctx.font = '500 13px Inter, system-ui, sans-serif';
    ctx.fillText('Loading workspace…', P.x + 28, P.y + LAYOUT.headerH + 44);
    ctx.restore();
  }

  ctx.restore();
}

function drawCards(ctx: CanvasRenderingContext2D, tl: Timeline, nowMs: number) {
  const C = LAYOUT.cards;
  const cardW = (C.w - C.gap * 2) / 3;
  for (let i = 0; i < 3; i++) {
    const card = tl.cards[i];
    if (card.revealAt === null || nowMs < card.revealAt) continue;
    const dt = nowMs - card.revealAt;
    const op = easeOutCubic(dt / 420);
    const pop = easeOutBack(dt / 540);
    const x = C.x + i * (cardW + C.gap);
    const y = C.y + (1 - op) * 26;

    ctx.save();
    ctx.globalAlpha = clamp(op, 0, 1);
    const sc = 0.93 + 0.07 * clamp(pop, 0, 1.06);
    ctx.translate(x + cardW / 2, y + C.h / 2);
    ctx.scale(sc, sc);
    ctx.translate(-(x + cardW / 2), -(y + C.h / 2));

    glass(ctx, x, y, cardW, C.h, 16, {
      fill: THEME.card,
      border: THEME.border,
      glow: 'rgba(245,158,11,0.16)',
    });

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = THEME.muted;
    ctx.font = '500 14px Inter, system-ui, sans-serif';
    ctx.fillText(CARD_LABELS[i], x + 22, y + 34);

    const target = card.value !== null ? card.value : CARD_FALLBACK_VALUES[i];
    const countFrom = card.valueAt !== null ? card.valueAt : card.revealAt;
    const k = easeOutCubic((nowMs - countFrom) / 820);
    ctx.fillStyle = THEME.text;
    ctx.font = '700 36px Inter, system-ui, sans-serif';
    ctx.fillText(formatCardValue(i, target * k), x + 22, y + 82);

    ctx.fillStyle = THEME.greenBright;
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillText(CARD_DELTAS[i], x + 22, y + C.h - 22);

    ctx.strokeStyle = 'rgba(252,211,77,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const sw = 84;
    const sx = x + cardW - sw - 22;
    const sy = y + C.h - 24;
    for (let n = 0; n <= 8; n++) {
      const px = sx + (sw * n) / 8;
      const py = sy - Math.abs(Math.sin(n * 0.92 + i * 1.3)) * 28;
      if (n === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawChart(ctx: CanvasRenderingContext2D, tl: Timeline, nowMs: number) {
  const drawAt = tl.chart.drawAt;
  if (drawAt === null || nowMs < drawAt) return;
  const R = LAYOUT.chart;
  const frame = easeOutCubic((nowMs - drawAt) / 420);

  ctx.save();
  ctx.globalAlpha = frame;
  glass(ctx, R.x, R.y, R.w, R.h, 16, { fill: 'rgba(17,14,7,0.9)', border: THEME.border });

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = THEME.muted;
  ctx.font = '500 14px Inter, system-ui, sans-serif';
  ctx.fillText('Weekly Growth', R.x + 22, R.y + 30);

  const gx0 = R.x + 22;
  const gx1 = R.x + R.w - 22;
  const gy0 = R.y + 52;
  const gy1 = R.y + R.h - 26;
  ctx.strokeStyle = 'rgba(158,139,85,0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = gy0 + ((gy1 - gy0) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(gx0, gy);
    ctx.lineTo(gx1, gy);
    ctx.stroke();
  }

  const series = tl.chart.series;
  const peak = Math.max(10, ...series);
  const pts = series.map((v, i) => ({
    x: gx0 + ((gx1 - gx0) * i) / Math.max(1, series.length - 1),
    y: gy1 - (gy1 - gy0) * (clamp(v, 0, peak) / peak) * 0.94,
  }));

  const prog = easeInOutCubic((nowMs - drawAt) / 1400);
  const edge = (pts.length - 1) * prog;
  const vis: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i <= Math.floor(edge)) vis.push(pts[i]);
    else if (i - 1 < edge) {
      const f = edge - (i - 1);
      vis.push({
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
      });
      break;
    } else break;
  }

  if (vis.length > 1) {
    const grad = ctx.createLinearGradient(0, gy0, 0, gy1);
    grad.addColorStop(0, 'rgba(245,158,11,0.42)');
    grad.addColorStop(1, 'rgba(245,158,11,0.02)');
    ctx.beginPath();
    ctx.moveTo(vis[0].x, gy1);
    vis.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(vis[vis.length - 1].x, gy1);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    vis.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = THEME.violetBright;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(252,211,77,0.65)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const head = vis[vis.length - 1];
    ctx.beginPath();
    ctx.arc(head.x, head.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  if (tl.chart.headline !== null) {
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.violetBright;
    ctx.font = '700 26px Inter, system-ui, sans-serif';
    ctx.fillText(`${Math.round(tl.chart.headline * prog)}`, gx1, R.y + 34);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function drawBadge(ctx: CanvasRenderingContext2D, tl: Timeline, nowMs: number) {
  const showAt = tl.badge.showAt;
  if (showAt === null || nowMs < showAt) return;
  const t = (nowMs - showAt) / 1000;
  const label = tl.badge.text || 'Success';
  const B = LAYOUT.badge;

  ctx.save();
  ctx.font = '700 19px Inter, system-ui, sans-serif';
  const textW = ctx.measureText(label).width;
  const w = clamp(textW + 112, 220, 760);
  const x = B.cx - w / 2;
  const y = B.cy - B.h / 2;

  if (t < 0.95) {
    const rb = easeOutCubic(t / 0.95);
    ctx.save();
    ctx.globalAlpha = (1 - rb) * 0.75;
    ctx.strokeStyle = THEME.greenBright;
    ctx.lineWidth = 4;
    roundRect(ctx, x - rb * 46, y - rb * 26, w + rb * 92, B.h + rb * 52, 999);
    ctx.stroke();
    ctx.restore();
  }

  const pop = easeOutBack(clamp(t / 0.52, 0, 1));
  ctx.globalAlpha = clamp(t / 0.28, 0, 1);
  ctx.translate(B.cx, B.cy);
  ctx.scale(pop, pop);
  ctx.translate(-B.cx, -B.cy);

  ctx.shadowColor = 'rgba(34,197,94,0.6)';
  ctx.shadowBlur = 42;
  roundRect(ctx, x, y, w, B.h, 999);
  const g = ctx.createLinearGradient(x, y, x + w, y + B.h);
  g.addColorStop(0, 'rgba(34,197,94,0.26)');
  g.addColorStop(1, 'rgba(34,197,94,0.14)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(74,222,128,0.65)';
  ctx.stroke();

  // checkmark disc + stroke
  const r = 18;
  const ccx = x + 34;
  const ccy = B.cy;
  ctx.beginPath();
  ctx.arc(ccx, ccy, r, 0, Math.PI * 2);
  ctx.fillStyle = THEME.green;
  ctx.fill();

  const ck = easeOutCubic(clamp((t - 0.18) / 0.42, 0, 1));
  ctx.strokeStyle = '#04230f';
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p0 = { x: ccx - 8, y: ccy + 0.5 };
  const p1 = { x: ccx - 2.5, y: ccy + 6.5 };
  const p2 = { x: ccx + 9, y: ccy - 6.5 };
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  if (ck < 0.5) {
    const f = ck / 0.5;
    ctx.lineTo(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f);
  } else {
    ctx.lineTo(p1.x, p1.y);
    const f = (ck - 0.5) / 0.5;
    ctx.lineTo(p1.x + (p2.x - p1.x) * f, p1.y + (p2.y - p1.y) * f);
  }
  ctx.stroke();

  ctx.globalAlpha *= clamp((t - 0.2) / 0.35, 0, 1);
  ctx.fillStyle = '#eafff1';
  ctx.font = '700 19px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, ccx + r + 16, ccy + 1);
  ctx.restore();
}

function drawCursor(ctx: CanvasRenderingContext2D, tl: Timeline, nowMs: number) {
  if (tl.cursor.firstAt === null || nowMs < tl.cursor.firstAt) return;
  const pos = cursorPosAt(tl, nowMs);
  const appear = easeOutCubic((nowMs - tl.cursor.firstAt) / 320);

  for (const at of tl.cursor.clicks) {
    const t = (nowMs - at) / 620;
    if (t < 0 || t > 1) continue;
    const rp = cursorPosAt(tl, at);
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.7;
    ctx.strokeStyle = THEME.violetBright;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, 7 + t * 38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = appear;
  ctx.translate(pos.x, pos.y);
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 23);
  ctx.lineTo(6.3, 16.8);
  ctx.lineTo(10.5, 25);
  ctx.lineTo(13.6, 23);
  ctx.lineTo(9.4, 14.7);
  ctx.lineTo(16.8, 14.7);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#0D0B05';
  ctx.stroke();
  ctx.restore();
}

/** How hard the header button is lit right now, 0..1. */
function buttonFlashAt(tl: Timeline, nowMs: number): number {
  const B = LAYOUT.button;
  let flash = 0;
  for (const at of tl.cursor.clicks) {
    const dt = nowMs - at;
    if (dt < 0 || dt > 300) continue;
    const p = cursorPosAt(tl, at);
    const inside = p.x >= B.x - 12 && p.x <= B.x + B.w + 12 && p.y >= B.y - 12 && p.y <= B.y + B.h + 12;
    if (inside) flash = Math.max(flash, 1 - dt / 300);
  }
  return flash;
}

/**
 * Paint one frame. Pure in (timeline, nowMs) so scrubbing and recording are
 * frame-exact, and so a given plan always renders identically.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  tl: Timeline,
  nowMs: number,
  w = STAGE_W,
  h = STAGE_H,
) {
  drawBackdrop(ctx, w, h, nowMs);
  drawShell(ctx, tl, nowMs, buttonFlashAt(tl, nowMs));
  drawCards(ctx, tl, nowMs);
  drawChart(ctx, tl, nowMs);
  drawBadge(ctx, tl, nowMs);
  drawCursor(ctx, tl, nowMs);
}
