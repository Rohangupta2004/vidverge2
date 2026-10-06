/**
 * Short Video Enhancer — the five-tier caption style system.
 *
 * One short does NOT get one caption treatment. A premium edit mixes a small
 * number of deliberate looks, and the ratio between them is what makes it
 * read as intentional rather than as a filter switched on over the whole
 * track. The brief this file implements:
 *
 *   TIER 1  clean      70%  ordinary dialogue. White, medium, STATIC — the
 *                           whole line is simply there. Nothing animates.
 *   TIER 2  kinetic    20%  one key word in the line pops and takes the
 *                           accent. The rest of the line stays clean and
 *                           static, exactly as a clean line would draw.
 *   TIER 3  cinematic  ~10% a hook moment. Large, pulled toward frame
 *                           centre, with a fade-scale entrance.
 *   TIER 4  beat       ~10% a drop moment. Huge, snaps down from oversize,
 *                           then HARD CUTS — no tail fade at all.
 *   TIER 5  ui         ~10% numbers, steps and feature lines. Tracked-out
 *                           tabular type that walks in like a timeline.
 *
 * THE KEY PRINCIPLE is that not every word animates. `pop` is non-zero on
 * exactly one tier (kinetic) and applies to exactly one word in that line;
 * every other tier earns its character from size, position and how the BLOCK
 * enters, never from per-word motion.
 *
 * THE SPLIT. Content wins first — a row of numbers is a timeline line and a
 * shouted line is a beat line whatever the ratio says — and the 70/20/10
 * ratio then governs every line left over, so an ordinary dialogue track
 * lands on the brief's mix without anyone counting.
 *
 * THE CREATOR ALWAYS WINS. `tierOverrides` is a per-line assignment made in
 * the caption editor and it beats both the content rules and the ratio;
 * `emphasisOverrides` does the same for WHICH word a kinetic or cinematic
 * line pops. Both are keyed by `cueKey` so they survive re-grouping.
 *
 * MIRROR WARNING. `CAPTION_TIERS` is consumed twice: by the live preview in
 * `components/SveStage.tsx`, which imports it, and by the Remotion
 * composition in `lib/sveComposition.ts`, which is a STRING compiled in
 * isolation by the render service and therefore carries its own copy. If you
 * change a number here, change the matching line in that string's
 * `TIER_TABLE` in the same commit — otherwise the preview and the exported
 * file stop agreeing, which is the one thing this pipeline exists to prevent.
 */

import {
  CAPTION_SAFE_X, DESIGN_W,
  type CaptionCue, type CaptionLanguage, type CaptionTier, type CaptionTierMode,
  type CaptionWord,
} from './sveTypes';
import { HI_PUNCH_WORDS, isStopWord } from './sveHinglish';

/** 70 / 20 / 10, exactly as the caption brief specifies. */
export const TIER_SPLIT = { clean: 0.7, kinetic: 0.2, display: 0.1 } as const;

export const CAPTION_TIER_IDS: CaptionTier[] = ['clean', 'kinetic', 'cinematic', 'beat', 'ui'];

export interface CaptionTierStyle {
  /** Font-size multiplier on the auto-fitted caption size. */
  size: number;
  weight: number;
  /** Letter spacing, in em. */
  tracking: number;
  /** Horizontal margin per word, in em. */
  gap: number;
  /**
   * Extra scale the EMPHASISED word gains when it is spoken, on top of 1.
   * Zero means nothing in this line animates — which is true of four of the
   * five tiers, and is the whole point of the system.
   */
  pop: number;
  /** Seconds that pop takes. */
  popS: number;
  /** 0..1 blend of the creator's posY toward the frame centre. */
  centre: number;
  /** Seconds of block entrance — the fade and the scale both ride on it. */
  enterS: number;
  /** Upward travel during the entrance, in em. */
  enterRise: number;
  /** Block scale at the start of the entrance. */
  enterScale: number;
  /** Seconds between each word appearing (the UI tier's timeline feel). */
  stagger: number;
  /** Distance a staggered word slides in from, in em. */
  slide: number;
  /** Seconds of fade after the cue ends. 0 is a hard cut. */
  tailS: number;
  /** Lock digits to the same advance width. */
  tabular: boolean;
}

export const CAPTION_TIERS: Record<CaptionTier, CaptionTierStyle> = {
  // Tier 1 — a plain subtitle. Medium, white, present for the whole cue and
  // completely still, so the tiers that DO move have something to be louder
  // than.
  clean: {
    size: 1, weight: 800, tracking: -0.012, gap: 0.14,
    pop: 0, popS: 0, centre: 0,
    enterS: 0, enterRise: 0, enterScale: 1,
    stagger: 0, slide: 0, tailS: 0.2, tabular: false,
  },
  // Tier 2 — identical geometry to clean on purpose. The ONLY difference a
  // viewer sees is the one key word growing 12% and taking the accent at the
  // moment it is spoken.
  kinetic: {
    size: 1, weight: 800, tracking: -0.012, gap: 0.14,
    pop: 0.12, popS: 0.16, centre: 0,
    enterS: 0, enterRise: 0, enterScale: 1,
    stagger: 0, slide: 0, tailS: 0.2, tabular: false,
  },
  // Tier 3 — the hook. Large, near frame centre, fading and scaling up out
  // of 0.82 over a third of a second.
  cinematic: {
    size: 1.46, weight: 900, tracking: -0.03, gap: 0.1,
    pop: 0, popS: 0, centre: 0.85,
    enterS: 0.42, enterRise: 0.12, enterScale: 0.82,
    stagger: 0, slide: 0, tailS: 0.36, tabular: false,
  },
  // Tier 4 — the drop. Lands oversize, snaps down in 0.12s, then cuts on the
  // frame its cue ends rather than fading.
  beat: {
    size: 1.9, weight: 900, tracking: -0.04, gap: 0.08,
    pop: 0, popS: 0, centre: 1,
    enterS: 0.12, enterRise: 0, enterScale: 1.34,
    stagger: 0, slide: 0, tailS: 0, tabular: false,
  },
  // Tier 5 — numbers and features. Tracked out, tabular, one token at a time
  // so "1 → 3 → 7 → 14 DAYS" reads as a sequence rather than a sentence.
  ui: {
    size: 1, weight: 700, tracking: 0.08, gap: 0.2,
    pop: 0, popS: 0, centre: 0.42,
    enterS: 0.16, enterRise: 0, enterScale: 1,
    stagger: 0.14, slide: 0.35, tailS: 0.26, tabular: true,
  },
};

export function tierStyle(tier?: CaptionTier): CaptionTierStyle {
  return (tier && CAPTION_TIERS[tier]) || CAPTION_TIERS.clean;
}

/** What each tier is called in the editor. */
export const TIER_LABELS: Record<CaptionTier, string> = {
  clean: 'Clean',
  kinetic: 'Kinetic',
  cinematic: 'Cinematic',
  beat: 'Impact',
  ui: 'Timeline',
};

/** The swatch each tier is drawn with in the editor and on the timeline. */
export const TIER_COLORS: Record<CaptionTier, string> = {
  clean: '#9CA3AF',
  kinetic: '#3B82F6',
  cinematic: '#A855F7',
  beat: '#F43F5E',
  ui: '#22D3EE',
};

export const CAPTION_TIER_OPTIONS: { id: CaptionTier; label: string; hint: string }[] = [
  { id: 'clean', label: 'Clean', hint: 'Tier 1 — plain white subtitle, nothing animates' },
  { id: 'kinetic', label: 'Kinetic', hint: 'Tier 2 — one key word pops and takes the accent' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Tier 3 — large hook line, fade-scale entrance' },
  { id: 'beat', label: 'Impact', hint: 'Tier 4 — huge, snaps down, then hard cuts' },
  { id: 'ui', label: 'Timeline', hint: 'Tier 5 — tracked-out numbers that walk in one at a time' },
];

export const CAPTION_TIER_MODES: { id: CaptionTierMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto mix', hint: 'Spread the lines 70% clean / 20% kinetic / 10% display' },
  { id: 'manual', label: 'All clean', hint: 'Every line starts on Tier 1 — you assign the rest by hand' },
];

/**
 * Average advance per character of the heavy sans stack at weight 900, in em.
 * Measured, and deliberately a touch wide so the estimate errs toward never
 * clipping. The same number has to hold in the browser preview and in the
 * render container, where no measuring DOM exists.
 */
export const CAPTION_CHAR_ADVANCE = 0.56;

/**
 * A pill already pads each word, so the gap between pills tightens to match.
 * 0.643 is the ratio that turns the clean tier's 0.14em into the 0.09em the
 * pill stylesheet has always used, so switching a pill on changes nothing.
 */
export const PILL_GAP_RATIO = 0.643;

/**
 * A tier's own font size, capped so its line still clears the safe margins.
 *
 * The caption size is auto-fitted for ordinary dialogue, and a beat line then
 * asks for 1.9x of it. Rather than shrinking every clean line in the track to
 * make room for the one big one, the big one gives back whatever it cannot
 * have — down to the clean size, never below it.
 */
export function fitTierSize(baseSize: number, tier: CaptionTierStyle, lineLength: number): number {
  const wanted = baseSize * tier.size;
  if (tier.size <= 1 || lineLength <= 0) return wanted;
  const safeWidth = DESIGN_W * (1 - CAPTION_SAFE_X * 2);
  const fits = safeWidth / (lineLength * CAPTION_CHAR_ADVANCE);
  return Math.max(baseSize, Math.min(wanted, fits));
}

/**
 * The stable identity of a cue, used as the key for a creator's per-line
 * assignment.
 *
 * A cue's id is its position in the list, which shifts the moment "words per
 * line" changes. Its START is a word boundary in the transcript, so an
 * assignment keyed by it survives re-grouping: a line that still begins at
 * that moment keeps its tier, and one that no longer exists quietly falls
 * back to the automatic mix instead of landing on the wrong sentence.
 */
export function cueKey(cue: { start: number }): string {
  return (Number(cue.start) || 0).toFixed(3);
}

// ---------------------------------------------------------------------------
// Token tests
// ---------------------------------------------------------------------------

function bare(text: string): string {
  return String(text || '').toLowerCase().replace(/[^a-z0-9']/g, '');
}

/** A token the creator shouted: three or more letters, written in capitals. */
function isShout(text: string): boolean {
  const letters = String(text || '').replace(/[^A-Za-z'\u2019]/g, '');
  return letters.length >= 3 && /[A-Z]/.test(letters) && letters === letters.toUpperCase();
}

function hasDigit(text: string): boolean {
  return /\d/.test(String(text || ''));
}

function isArrow(text: string): boolean {
  return /\u2192|\u279C|\u2794|->/.test(String(text || ''));
}

/** Units that turn a number into a feature line rather than a spoken digit. */
const UI_UNIT_WORDS = new Set([
  'min', 'mins', 'minute', 'minutes', 'sec', 'secs', 'second', 'seconds',
  'hour', 'hours', 'hr', 'hrs', 'day', 'days', 'din', 'dino', 'dinon',
  'week', 'weeks', 'hafte', 'hafta', 'month', 'months', 'mahine', 'mahina',
  'year', 'years', 'saal', 'rs', 'inr', 'percent', 'marks', 'baar', 'times',
  'step', 'steps', 'level', 'levels', 'daily', 'roz', 'rozana',
]);

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

/** Numbers, arrows and units — the "1 / 3 / 7 / 14 DAYS" family. */
function isUiLine(tokens: string[]): boolean {
  if (!tokens.length || !tokens.some(hasDigit)) return false;
  if (tokens.some(isArrow)) return true;
  if (tokens.filter(hasDigit).length / tokens.length >= 0.4) return true;
  return tokens.some((t) => UI_UNIT_WORDS.has(bare(t)));
}

/** A short shouted line — "FORGOTTEN." or "BRAIN ISN'T THE PROBLEM." */
function isBeatLine(tokens: string[]): boolean {
  if (!tokens.length || tokens.length > 4) return false;
  const shouts = tokens.filter(isShout).length;
  return shouts >= 1 && shouts / tokens.length >= 0.5;
}

/**
 * How much this line wants to be big. Shouting, an exclamation, landing in the
 * opening hook window and carrying punch words all push it up; a long line
 * pushes it back down, because a nine-word sentence cannot be a hook.
 */
function lineScore(cue: CaptionCue, tokens: string[], durationS: number): number {
  let score = 0;
  if (tokens.some(isShout)) score += 3;
  if (/[!?]$/.test(tokens.join(' ').trim())) score += 2;
  if (cue.start <= Math.max(3, durationS * 0.15)) score += 2;
  for (const token of tokens) if (HI_PUNCH_WORDS.has(bare(token))) score += 1;
  if (tokens.length <= 3) score += 1;
  if (tokens.length >= 6) score -= 1;
  return score;
}

/**
 * The one word in a line worth colouring and popping. The last shout wins,
 * then the last punch word (the payoff usually lands late), then the longest
 * word that is not filler.
 *
 * It ALWAYS returns a word on a non-empty line. A kinetic line whose every
 * token is filler would otherwise have nothing to pop and nothing to accent,
 * and would render identically to a clean one — a tier that silently does
 * nothing is worse than no tier at all. In that case the longest token is
 * still the most interesting thing in the line, so it takes the accent.
 */
export function keyWordIndex(words: CaptionWord[], language: CaptionLanguage): number {
  if (!words.length) return -1;
  for (let i = words.length - 1; i >= 0; i -= 1) if (isShout(words[i].text)) return i;
  for (let i = words.length - 1; i >= 0; i -= 1) if (HI_PUNCH_WORDS.has(bare(words[i].text))) return i;
  let best = -1;
  let bestLength = 3;
  for (let i = 0; i < words.length; i += 1) {
    const w = bare(words[i].text);
    if (w.length > bestLength && !isStopWord(w, language)) {
      best = i;
      bestLength = w.length;
    }
  }
  if (best >= 0) return best;
  let longest = 0;
  for (let i = 1; i < words.length; i += 1) {
    if (bare(words[i].text).length > bare(words[longest].text).length) longest = i;
  }
  return longest;
}

/**
 * Flag the words that take the accent colour.
 *
 * A clean line accents nothing — it is the baseline. A beat line is the
 * impact itself, so it stays white and lets its size do the work. A timeline
 * line accents its numbers. A kinetic or cinematic line accents its one key
 * word, which is also the word the kinetic pop scales.
 */
function markEmphasis(
  words: CaptionWord[],
  tier: CaptionTier,
  language: CaptionLanguage,
  override?: number,
): CaptionWord[] {
  if (tier === 'clean' || tier === 'beat') {
    return words.map((w) => (w.emphasis ? { ...w, emphasis: false } : w));
  }
  if (tier === 'ui') {
    return words.map((w) => ({ ...w, emphasis: hasDigit(w.text) }));
  }
  const asked = Number(override);
  const picked = Number.isInteger(asked) && asked >= 0 && asked < words.length
    ? asked
    : keyWordIndex(words, language);
  return words.map((w, i) => ({ ...w, emphasis: i === picked }));
}

/** Which word a kinetic or cinematic line will pop, for the editor to show. */
export function emphasisIndex(cue: CaptionCue): number {
  for (let i = 0; i < cue.words.length; i += 1) if (cue.words[i].emphasis) return i;
  return -1;
}

export interface TierResolveOptions {
  /** `auto` runs the 70/20/10 mix; `manual` starts every line on Tier 1. */
  mode: CaptionTierMode;
  language: CaptionLanguage;
  durationS: number;
  /** Per-line assignments from the caption editor, keyed by `cueKey`. */
  tierOverrides: Record<string, CaptionTier>;
  /** Per-line emphasis word index, keyed by `cueKey`. */
  emphasisOverrides: Record<string, number>;
}

/**
 * Give every cue its treatment.
 *
 * The order is content rules, then the ratio, then the creator — so a line
 * the creator assigned by hand is never reshuffled by a later re-render, and
 * a transcript that has not been touched always produces the SAME mix. A
 * caption track that reshuffled between renders would make the preview and
 * the export disagree.
 */
export function resolveCaptionTiers(cues: CaptionCue[], options: TierResolveOptions): CaptionCue[] {
  if (!cues.length) return cues;
  const { mode, language, durationS, tierOverrides, emphasisOverrides } = options;

  const tokens = cues.map((cue) => cue.words.map((w) => String(w.text || '')));
  const tiers: (CaptionTier | null)[] = cues.map((_, i) => (
    mode === 'manual' ? 'clean'
      : isUiLine(tokens[i]) ? 'ui'
        : isBeatLine(tokens[i]) ? 'beat'
          : null
  ));

  if (mode === 'auto') {
    // Everything content did not already claim is ranked and split 70/20/10.
    // Ties break toward the earlier line so the same transcript always
    // produces the same edit.
    const open = cues.map((_, i) => i).filter((i) => tiers[i] === null);
    const ranked = open.slice().sort((a, b) => {
      const byScore = lineScore(cues[b], tokens[b], durationS) - lineScore(cues[a], tokens[a], durationS);
      return byScore !== 0 ? byScore : a - b;
    });

    // Rounding alone would give a short track no hook at all, so as soon as
    // there are two lines to choose between, one of them is the cinematic one
    // and one is kinetic. On a real transcript the rounding dominates and the
    // mix lands on 70/20/10.
    const floor = open.length >= 2 ? 1 : 0;
    const cinematic = Math.min(
      ranked.length,
      Math.max(floor, Math.round(open.length * TIER_SPLIT.display)),
    );
    const kinetic = Math.min(
      ranked.length - cinematic,
      Math.max(floor, Math.round(open.length * TIER_SPLIT.kinetic)),
    );

    ranked.forEach((index, rank) => {
      tiers[index] = rank < cinematic ? 'cinematic' : rank < cinematic + kinetic ? 'kinetic' : 'clean';
    });
  }

  return cues.map((cue, i) => {
    const key = cueKey(cue);
    const chosen = tierOverrides[key];
    const tier: CaptionTier = (chosen && CAPTION_TIERS[chosen]) ? chosen : (tiers[i] || 'clean');
    return { ...cue, tier, words: markEmphasis(cue.words, tier, language, emphasisOverrides[key]) };
  });
}

/** What the mixed track actually came out as, for the editor to report. */
export function tierBreakdown(cues: CaptionCue[]): { tier: CaptionTier; count: number }[] {
  return CAPTION_TIER_IDS
    .map((tier) => ({ tier, count: cues.filter((c) => (c.tier || 'clean') === tier).length }))
    .filter((row) => row.count > 0);
}

/**
 * The mix as fractions against the 70/20/10 target, so the editor can say how
 * close this track is without the creator counting lines.
 */
export function tierMix(cues: CaptionCue[]): {
  total: number;
  clean: number;
  kinetic: number;
  display: number;
  onBrief: boolean;
} {
  const total = cues.length;
  if (!total) return { total: 0, clean: 0, kinetic: 0, display: 0, onBrief: false };
  const count = (tier: CaptionTier) => cues.filter((c) => (c.tier || 'clean') === tier).length;
  const clean = count('clean') / total;
  const kinetic = count('kinetic') / total;
  const display = (count('cinematic') + count('beat') + count('ui')) / total;
  return {
    total,
    clean,
    kinetic,
    display,
    // Within ten points of the brief on every band reads as "intentional".
    onBrief: Math.abs(clean - TIER_SPLIT.clean) <= 0.1
      && Math.abs(kinetic - TIER_SPLIT.kinetic) <= 0.1
      && Math.abs(display - TIER_SPLIT.display) <= 0.1,
  };
}
