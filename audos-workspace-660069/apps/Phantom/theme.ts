import { COLORS, FONT } from '../../components/theme';

/**
 * VERGEYE — surface tokens.
 *
 * Two deliberate differences from the rest of the space, both of them product
 * decisions rather than drift:
 *
 *   1. The canvas is a literal hex of the Vidverge dark-cosmic ground rather
 *      than the shell's --space-surface-* variables, because Vergeye is a
 *      research surface the customer exports screenshots out of and the export
 *      has to look the same everywhere it is pasted.
 *   2. The accent is DATA, not a token. It is read off the customer's own
 *      website in Screen 1 and threaded through every surface from there, so
 *      the comparison table and the generated video wear their brand, not ours.
 *      Until a site has been analysed the accent is the workspace's own brand
 *      primary, so an un-analysed Vergeye still matches the dock it opened from.
 *
 * Everything here is a literal hex or rgba() string on purpose. html2canvas —
 * which is what Export PNG runs on — cannot parse color-mix() or a CSS
 * variable, and silently drops the colour, so a token-styled table exports as
 * a grey ghost of itself. rgba() computed from the accent hex is the one form
 * that survives the capture.
 */

export const INK = COLORS.bg;
export const INK_DEEP = COLORS.bg;
export const PANEL = COLORS.raised;
export const CARD = COLORS.surface;
export const CARD_HI = COLORS.hover;
export const LINE = COLORS.border;
export const LINE_HI = COLORS.controlBorder;
export const TEXT = COLORS.text;
export const TEXT_DIM = COLORS.secondary;
export const TEXT_MUTED = COLORS.muted;
export const DANGER = COLORS.danger;
export const SUCCESS = COLORS.success;
export const WARN = COLORS.warning;

export const MONO = FONT.mono;

/** The workspace's own brand primary, so a fresh Vergeye matches the shell. */
export const DEFAULT_ACCENT = COLORS.accent;

export function normalizeHex(value: unknown): string {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  const short = raw.match(/^#([0-9a-f]{3})$/);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const long = raw.match(/^#([0-9a-f]{6})$/);
  return long ? `#${long[1]}` : '';
}

function channels(hex: string): { r: number; g: number; b: number } {
  const safe = normalizeHex(hex) || DEFAULT_ACCENT;
  return {
    r: parseInt(safe.slice(1, 3), 16),
    g: parseInt(safe.slice(3, 5), 16),
    b: parseInt(safe.slice(5, 7), 16),
  };
}

/** A translucent wash of any hex. The ONE tinting form html2canvas honours. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = channels(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

/** Shifts a hex towards black or white, for hover and gradient stops. */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = channels(hex);
  const mix = (channel: number) => {
    const target = amount < 0 ? 0 : 255;
    const ratio = Math.abs(amount);
    return Math.round(channel + (target - channel) * ratio);
  };
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

/** Black or white text, whichever stays legible on the given accent. */
export function readableOn(hex: string): string {
  const { r, g, b } = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? COLORS.onAccent : COLORS.text;
}

export function hostOf(url: unknown): string {
  const match = String(url == null ? '' : url).match(/^https?:\/\/([^/?#]+)/i);
  return match ? match[1].toLowerCase().replace(/^www\./, '') : '';
}

export function monogram(name: unknown): string {
  const words = String(name == null ? '' : name).trim().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** A stable colour per competitor name, so monogram tiles stay recognisable. */
export function tileColor(name: unknown): string {
  const text = String(name == null ? '' : name);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  // Deliberately varied rather than on-brand: these tiles stand in for OTHER
  // companies, so they have to be told apart at a glance. Each one is picked
  // to stay legible against the dark card it sits on.
  const palette = ['#3b82f6', '#D4920A', '#d946a8', '#22c55e', '#F0B429', '#ef4444', '#06b6d4', '#f59e0b'];
  return palette[hash % palette.length];
}

export function relativeTime(value?: string | null): string {
  if (!value) return '\u2014';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '\u2014';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.round(seconds / 86400)}d ago`;
  return new Date(then).toLocaleDateString();
}

export const SPIN_CSS = `
@keyframes vergeye-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes vergeye-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes vergeye-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.85; } }
.vergeye-rise { animation: vergeye-rise 0.18s cubic-bezier(.2,0,0,1) both; }
.vergeye-pulse { animation: none; }
.vergeye-app button, .vergeye-app a { transition: background-color 0.12s cubic-bezier(.2,0,0,1), border-color 0.12s cubic-bezier(.2,0,0,1), opacity 0.12s cubic-bezier(.2,0,0,1); }
.vergeye-app button:active:not(:disabled) { transform: translateY(1px); }
.vergeye-app input:focus, .vergeye-app textarea:focus { outline: 2px solid ${COLORS.focus}; outline-offset: 3px; }
.vergeye-scroll { scrollbar-color: ${COLORS.border} transparent; scrollbar-width: thin; }
.vergeye-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.vergeye-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 6px; }
.vergeye-scroll::-webkit-scrollbar-thumb:hover { background: ${COLORS.controlBorder}; }
.vergeye-scroll::-webkit-scrollbar-track { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .vergeye-app *, .vergeye-app *::before, .vergeye-app *::after { animation: none !important; transition-duration: 0.01ms !important; }
}
@media (max-width: 860px) {
  .vergeye-crumbs { overflow-x: auto; }
  .vergeye-hero-input { flex-direction: column !important; align-items: stretch !important; }
  .vergeye-two-col { grid-template-columns: 1fr !important; }
}
`;
