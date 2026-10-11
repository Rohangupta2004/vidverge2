/**
 * MotionType — the CSS engine.
 *
 * One generator produces both the stylesheet the preview injects and the
 * stylesheet Copy CSS hands over, so what a user pastes into their own page is
 * the same animation they just watched. The two differ only in their selector
 * prefix and in a suffix on every @keyframes name:
 *
 *   preview  .mt-stage-k3 .mt-word-2 { animation: mt-in-fadeUp-k3 ... }
 *   export   .mt-word-2             { animation: mt-in-fadeUp ... }
 *
 * The suffix is what keeps two generations from fighting over one global
 * keyframe name, and the prefix is what keeps these rules from leaking into
 * the rest of the VidVerge workspace.
 *
 * Font sizes and letter spacing are emitted in stage pixels multiplied by
 * `--mt-scale`. The plan's own units (rem, em, px, vw) are resolved into that
 * one space by the layout pass, which is the only way the absolute positions
 * and the type sizes can be guaranteed to agree.
 */

import type { Entrance, Exit, MotionPlan } from './motionPlan';
import { ENTER_EASING, EXIT_EASING, wordTimings } from './motionLayout';
import type { PlacedWord, WordTiming } from './motionLayout';

/** Base transform every keyframe restates, since it also centres the span. */
const BASE = 'translate(-50%, -50%)';

const ENTRANCE_KEYFRAMES: Record<Entrance, string> = {
  fadeUp:
    '0% { opacity: 0; transform: ' + BASE + ' translate3d(0, 34px, 0); }\n' +
    '100% { opacity: 1; transform: ' + BASE + ' translate3d(0, 0, 0); }',
  fadeIn:
    '0% { opacity: 0; }\n' +
    '100% { opacity: 1; }',
  scaleIn:
    '0% { opacity: 0; transform: ' + BASE + ' scale(0.72); }\n' +
    '100% { opacity: 1; transform: ' + BASE + ' scale(1); }',
  slideLeft:
    '0% { opacity: 0; transform: ' + BASE + ' translate3d(-78px, 0, 0); }\n' +
    '100% { opacity: 1; transform: ' + BASE + ' translate3d(0, 0, 0); }',
  slideRight:
    '0% { opacity: 0; transform: ' + BASE + ' translate3d(78px, 0, 0); }\n' +
    '100% { opacity: 1; transform: ' + BASE + ' translate3d(0, 0, 0); }',
  glitch:
    '0% { opacity: 0; transform: ' + BASE + ' translate3d(-12px, 0, 0) skewX(16deg); }\n' +
    '18% { opacity: 1; transform: ' + BASE + ' translate3d(14px, -2px, 0) skewX(-12deg); }\n' +
    '34% { opacity: 0.45; transform: ' + BASE + ' translate3d(-9px, 3px, 0) skewX(9deg); }\n' +
    '52% { opacity: 1; transform: ' + BASE + ' translate3d(7px, -3px, 0) skewX(-5deg); }\n' +
    '74% { opacity: 0.8; transform: ' + BASE + ' translate3d(-3px, 1px, 0) skewX(2deg); }\n' +
    '100% { opacity: 1; transform: ' + BASE + ' translate3d(0, 0, 0) skewX(0deg); }',
  typewriter:
    '0% { opacity: 1; clip-path: inset(0 100% 0 0); }\n' +
    '100% { opacity: 1; clip-path: inset(0 0 0 0); }',
  blur:
    '0% { opacity: 0; filter: blur(16px); }\n' +
    '100% { opacity: 1; filter: blur(0); }',
};

const EXIT_KEYFRAMES: Record<Exclude<Exit, 'none'>, string> = {
  fadeOut:
    '0% { opacity: 1; }\n' +
    '100% { opacity: 0; }',
  scaleOut:
    '0% { opacity: 1; transform: ' + BASE + ' scale(1); }\n' +
    '100% { opacity: 0; transform: ' + BASE + ' scale(1.24); }',
  slideUp:
    '0% { opacity: 1; transform: ' + BASE + ' translate3d(0, 0, 0); }\n' +
    '100% { opacity: 0; transform: ' + BASE + ' translate3d(0, -52px, 0); }',
};

export interface CssOptions {
  /** Placed before every selector, e.g. `'.mt-stage-k3 '`. Empty for the export. */
  prefix?: string;
  /** Appended to every @keyframes name so concurrent scenes never collide. */
  suffix?: string;
  /** Emit the `.mt-scene` box rules. The preview styles its own box in React. */
  sceneBox?: boolean;
}

function indent(block: string): string {
  return block
    .split('\n')
    .map(function pad(line) {
      return '  ' + line;
    })
    .join('\n');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The animation shorthand for one word.
 *
 * Fill modes are not interchangeable here. The entrance takes `both` so the
 * word sits in its pre-entrance state before its delay elapses and holds the
 * end state afterwards. The exit takes `forwards`, NOT `both`: a backwards
 * fill would apply the exit's own 0% frame from time zero and, being later in
 * the list, would override the entrance for the whole sequence.
 */
function animationValue(word: PlacedWord['word'], timing: WordTiming, suffix: string): string {
  const enterDuration = Math.max(1, Math.round(timing.enterEnd - timing.enterStart));
  const parts = [
    'mt-in-' + word.entrance + suffix + ' ' + enterDuration + 'ms ' + ENTER_EASING +
      ' ' + Math.round(timing.enterStart) + 'ms both',
  ];
  if (word.exit !== 'none') {
    const exitDuration = Math.max(1, Math.round(timing.exitEnd - timing.exitStart));
    parts.push(
      'mt-out-' + word.exit + suffix + ' ' + exitDuration + 'ms ' + EXIT_EASING +
        ' ' + Math.round(timing.exitStart) + 'ms forwards',
    );
  }
  return parts.join(', ');
}

/**
 * Build the stylesheet for a plan. Only the keyframes the plan actually uses
 * are emitted, so a four-word scene does not ship eight unused rules.
 */
export function buildCss(plan: MotionPlan, placed: PlacedWord[], options: CssOptions = {}): string {
  const prefix = options.prefix || '';
  const suffix = options.suffix || '';
  const timings = wordTimings(plan);
  const blocks: string[] = [];

  if (options.sceneBox) {
    blocks.push(
      prefix + '.mt-scene {\n' +
        '  /* Set --mt-scale to sceneWidthInPx / 1600 to keep the type proportional. */\n' +
        '  --mt-scale: 1;\n' +
        '  position: relative;\n' +
        '  width: 100%;\n' +
        '  aspect-ratio: 16 / 9;\n' +
        '  overflow: hidden;\n' +
        '  background: ' + plan.background + ';\n' +
        "  font-family: 'Inter', system-ui, sans-serif;\n" +
        '}',
    );
  }

  blocks.push(
    prefix + '.mt-word {\n' +
      '  position: absolute;\n' +
      '  margin: 0;\n' +
      '  white-space: pre;\n' +
      '  transform: ' + BASE + ';\n' +
      '  transform-origin: 50% 50%;\n' +
      '  will-change: transform, opacity;\n' +
      '}',
  );

  placed.forEach(function rule(entry) {
    const word = entry.word;
    const timing = timings[entry.index];
    const declarations = [
      'left: ' + round(entry.leftPct) + '%',
      'top: ' + round(entry.topPct) + '%',
      'font-size: calc(' + round(entry.fontPx) + 'px * var(--mt-scale))',
      'font-weight: ' + word.fontWeight,
      'color: ' + word.color,
      'letter-spacing: calc(' + round(entry.trackingPx) + 'px * var(--mt-scale))',
      'text-transform: ' + word.textTransform,
    ];
    if (word.emphasis) {
      declarations.push(
        'text-shadow: 0 0 calc(' + round(entry.fontPx * 0.5) + 'px * var(--mt-scale)) ' +
          'color-mix(in srgb, ' + word.color + ' 45%, transparent)',
      );
    }
    declarations.push('animation: ' + animationValue(word, timing, suffix));
    blocks.push(
      prefix + '.mt-word-' + (entry.index + 1) + ' {\n' +
        declarations
          .map(function line(d) {
            return '  ' + d + ';';
          })
          .join('\n') +
        '\n}',
    );
  });

  const entrances: Entrance[] = [];
  const exits: Exclude<Exit, 'none'>[] = [];
  plan.words.forEach(function collect(word) {
    if (entrances.indexOf(word.entrance) < 0) entrances.push(word.entrance);
    if (word.exit !== 'none' && exits.indexOf(word.exit) < 0) exits.push(word.exit);
  });

  entrances.forEach(function keyframe(name) {
    blocks.push('@keyframes mt-in-' + name + suffix + ' {\n' + indent(ENTRANCE_KEYFRAMES[name]) + '\n}');
  });
  exits.forEach(function keyframe(name) {
    blocks.push('@keyframes mt-out-' + name + suffix + ' {\n' + indent(EXIT_KEYFRAMES[name]) + '\n}');
  });

  return blocks.join('\n\n');
}

/**
 * The standalone stylesheet behind Copy CSS: no workspace classes, no CSS
 * variables from the shell, nothing that only resolves inside this app. Paste
 * it next to a `<div class="mt-scene">` of `<span class="mt-word mt-word-N">`
 * children and it runs anywhere.
 */
export function exportCss(plan: MotionPlan, placed: PlacedWord[]): string {
  const seconds = (plan.durationMs / 1000).toFixed(1);
  const markup = placed
    .map(function span(entry) {
      return '     <span class="mt-word mt-word-' + (entry.index + 1) + '">' + entry.word.word + '</span>';
    })
    .join('\n');

  const header =
    '/* ' + plan.animationName + ' — MotionType kinetic typography (' + seconds + 's)\n' +
    ' *\n' +
    ' * Markup this stylesheet expects:\n' +
    ' *\n' +
    ' *   <div class="mt-scene">\n' +
    markup.replace(/^/gm, ' * ') + '\n' +
    ' *   </div>\n' +
    ' *\n' +
    ' * The sequence runs once. To loop it, remove and re-add the .mt-scene\n' +
    ' * element (or its children) every ' + plan.durationMs + 'ms.\n' +
    ' */';

  return header + '\n\n' + buildCss(plan, placed, { sceneBox: true }) + '\n';
}
