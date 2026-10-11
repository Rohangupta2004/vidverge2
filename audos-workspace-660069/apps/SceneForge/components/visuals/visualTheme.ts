// THE DIRECTOR LOOK — one palette and one set of motion curves shared by every
// visual component, so a film built out of ten different grammars still reads
// as one film.
//
// KEEP IN SYNC with remotion/sceneForgeSource.ts. The components in this
// folder are the BROWSER preview of the plan; the generated composition is
// what the render farm actually executes. Both draw the same picture from the
// same SceneSpec, so a change to a colour, a size or a curve belongs in both
// places or the preview stops telling the truth.

export const DIRECTOR_THEME = {
  bg: '#0D0D0D',
  bgSoft: '#141414',
  accent: '#4FC3F7',
  accentSoft: 'rgba(79,195,247,0.18)',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.62)',
  line: 'rgba(255,255,255,0.22)',
  font: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

export const lerp = (from: number, to: number, t: number) => from + (to - from) * clamp01(t);

export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t: number) => Math.pow(clamp01(t), 3);
export const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/**
 * The closed-form under-damped spring Remotion's `spring()` solves for.
 * `t` is seconds since the spring started. Default config matches Remotion's
 * default (mass 1, stiffness 100, damping 10), so the preview overshoots and
 * settles the way the rendered film does.
 */
export function springValue(t: number, config: { stiffness?: number; damping?: number; mass?: number } = {}): number {
  const stiffness = config.stiffness ?? 100;
  const damping = config.damping ?? 10;
  const mass = config.mass ?? 1;
  const time = Math.max(0, t);
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * time) * (Math.cos(wd * time) + ((zeta * w0) / wd) * Math.sin(wd * time));
  }
  return 1 - Math.exp(-w0 * time) * (1 + w0 * time);
}

/**
 * Remap a scene-wide 0..1 progress onto a sub-window of it. Every staggered
 * entrance in this library is expressed this way instead of with delays, so
 * scrubbing the preview backwards is exact.
 */
export function window01(progress: number, start: number, end: number): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

/** Stagger helper: the local progress of item `i` of `count`. */
export function stagger01(progress: number, index: number, count: number, span = 0.55, from = 0.08): number {
  const total = Math.max(1, count);
  const step = span / total;
  return window01(progress, from + step * index, from + step * index + Math.max(step, 0.18));
}

export interface NumericLabel {
  /** Everything before the digits, e.g. '₹' or '$'. */
  prefix: string;
  /** Everything after, e.g. ' DAYS' or '%'. */
  suffix: string;
  value: number;
  decimals: number;
  /** True when the original string used thousands separators. */
  grouped: boolean;
}

/**
 * Pull the first number out of a dramatic label so it can count up. Returns
 * null for a label with no number in it — "INDEPENDENCE" simply scales in.
 */
export function parseNumericLabel(label: string): NumericLabel | null {
  const text = String(label || '');
  const match = text.match(/(-?\d[\d,\s]*(?:\.\d+)?)/);
  if (!match) return null;
  const raw = match[1];
  const cleaned = raw.replace(/[,\s]/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  const dot = cleaned.indexOf('.');
  return {
    prefix: text.slice(0, match.index || 0),
    suffix: text.slice((match.index || 0) + raw.length),
    value,
    decimals: dot >= 0 ? Math.min(2, cleaned.length - dot - 1) : 0,
    grouped: /[,\s]/.test(raw.trim()),
  };
}

export function formatNumber(value: number, decimals: number, grouped: boolean): string {
  const fixed = value.toFixed(decimals);
  if (!grouped) return fixed;
  const [whole, fraction] = fixed.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${withCommas}.${fraction}` : withCommas;
}

// A FLAG IS TWO CODE POINTS. Country flags are a pair of regional indicators
// (🇮 + 🇳), so the pair is matched FIRST — matching a single character
// would lift half a flag out of the label and render the other half as text.
const FLAG = /([\u{1F1E6}-\u{1F1FF}]{2})/u;
// The trailing \u{FE0F} is the emoji variation selector. Without it "☀️ Sun"
// leaves an invisible character stranded at the front of the label.
const GLYPH = /([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\u{FE0F}?)/u;

function extractIcon(text: string): string {
  const flag = text.match(FLAG);
  if (flag) return flag[1];
  const glyph = text.match(GLYPH);
  return glyph ? glyph[1] : '';
}

/**
 * Split "1947 Independence 🇮🇳" into its parts. Timeline events arrive as one
 * string because that is the least error-prone thing to ask a model for.
 */
export function parseEvent(entry: string): { date: string; label: string; icon: string } {
  const text = String(entry || '').trim();
  const icon = extractIcon(text);
  const withoutIcon = icon ? text.replace(icon, '').trim() : text;
  const dateMatch = withoutIcon.match(/^((?:c\.?\s*)?-?\d{3,4}(?:\s*(?:BCE?|AD|CE))?|\d{1,2}\/\d{1,2}\/\d{2,4})\s*[–—:,-]?\s*/i);
  if (dateMatch) {
    return { date: dateMatch[1].trim(), label: withoutIcon.slice(dateMatch[0].length).trim(), icon };
  }
  return { date: '', label: withoutIcon, icon };
}

/** Pull a leading emoji off a node/element label so it can be drawn separately. */
export function splitIcon(entry: string): { icon: string; label: string } {
  const text = String(entry || '').trim();
  const icon = extractIcon(text.slice(0, 4));
  if (!icon || !text.startsWith(icon)) return { icon: '', label: text };
  return { icon, label: text.slice(icon.length).trim() };
}

/** Title-case-ish display text for element labels, without mangling acronyms. */
export function displayLabel(entry: string): string {
  const text = String(entry || '').trim().replace(/_/g, ' ');
  if (!text) return '';
  if (text === text.toUpperCase()) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The one word a highlight scene should flare, and the caption split around
 * it. Falls back to the longest word when the director named none.
 */
export function splitHighlight(caption: string, keyword?: string): { before: string; word: string; after: string } {
  const text = String(caption || '').trim();
  const target = String(keyword || '').trim()
    || text.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0]
    || '';
  if (!target) return { before: text, word: '', after: '' };
  const index = text.toLowerCase().indexOf(target.toLowerCase());
  if (index < 0) return { before: '', word: target, after: text ? ` — ${text}` : '' };
  return { before: text.slice(0, index), word: text.slice(index, index + target.length), after: text.slice(index + target.length) };
}

/** Font size that keeps a headline inside the frame without measuring text. */
export function fitHeadline(text: string, max = 150, min = 48): number {
  const length = Math.max(1, String(text || '').length);
  if (length <= 8) return max;
  if (length <= 14) return Math.round(max * 0.76);
  if (length <= 22) return Math.round(max * 0.56);
  if (length <= 34) return Math.round(max * 0.42);
  return Math.max(min, Math.round(max * 0.3));
}

export interface VisualProps {
  /** The segment being drawn. */
  spec: import('../../lib/sceneSpec').SceneSpec;
  /** 0..1 through this segment. */
  progress: number;
  /** Brand accent; defaults to the director's electric blue. */
  accent?: string;
}
