/**
 * Short Video Enhancer — the Phase 2 export composition.
 *
 * This string IS the graphics layer. Every caption, card, lower third and
 * B-roll placement is drawn by Remotion in the render container, not by a
 * browser canvas, which is what makes the exported text frame-accurate,
 * anti-aliased and free of the tearing a canvas overlay produced.
 *
 * GEOMETRY. The platform render service is pinned to a 1920x1080 / 30fps
 * canvas (a 1080x1920 submit is refused). So the composition lays every layer
 * out on a native 1080x1920 DESIGN STAGE and scales that whole stage uniformly
 * into whatever canvas it is handed; `sve-render` then cover-crops the centred
 * vertical column back out to a true 1080x1920 portrait master. Because the
 * layout maths never changes, the preview frame and the rendered frame are the
 * same picture.
 *
 * CONSTRAINTS this text must respect, because it travels inside a JSON body
 * and is compiled in isolation by the render service:
 *   - no template literals,
 *   - no imports beyond `react` and `remotion`,
 *   - no optional chaining on possibly-absent globals,
 *   - NEVER `<Sequence layout="none">`. Verified against the live render
 *     service on 3 Oct 2026: a Sequence carrying that prop makes the service
 *     emit frames containing nothing but the root background — the whole
 *     stage subtree disappears, the job still reports `status: complete`, and
 *     there is no error anywhere to find it by. The identical composition
 *     with a plain `<Sequence>` renders correctly. Leave the prop off.
 *
 * Layer order, bottom to top:
 *   base video -> B-roll -> graphic cards -> captions -> (audio has no pixels)
 */

const FONT_CSS =
  '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Montserrat:wght@700;800;900&display=swap");';

const HELPERS = `
const DESIGN_W = 1080;
const DESIGN_H = 1920;
const FONT_CSS = '${FONT_CSS}';
const SANS = "'Inter','Montserrat',system-ui,-apple-system,'Segoe UI',sans-serif";

function num(v, fb) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function clamp01(v) { return Math.max(0, Math.min(1, num(v, 0))); }
function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, num(v, lo))); }

/** Overshoot curve for the word pop: 0.8 -> 1.0 with a touch of back-ease. */
function popEase(raw) {
  const t = clamp01(raw);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function easeOut(raw) { const t = clamp01(raw); return 1 - Math.pow(1 - t, 3); }

/** Symmetric fade for anything with a start and an end on the timeline. */
function envelope(t, start, end, ramp) {
  const r = Math.max(0.0001, num(ramp, 0.3));
  if (t < start || t > end) return 0;
  return Math.min(easeOut((t - start) / r), easeOut((end - t) / r), 1);
}

function hexToRgb(hex) {
  const h = String(hex || '#FFFFFF').replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex, alpha) {
  const c = hexToRgb(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp01(alpha) + ')';
}

/**
 * A real outline, built from eight shadow offsets rather than
 * -webkit-text-stroke. The stroke property draws CENTRED on the glyph edge and
 * eats into thin strokes at render scale; stacked shadows sit entirely outside
 * the fill, so the letterform stays intact.
 */
function outlineShadow(width, color) {
  const w = Math.max(1, num(width, 6));
  const d = w * 0.7071;
  const parts = [
    w + 'px 0 0 ' + color, (-w) + 'px 0 0 ' + color,
    '0 ' + w + 'px 0 ' + color, '0 ' + (-w) + 'px 0 ' + color,
    d.toFixed(1) + 'px ' + d.toFixed(1) + 'px 0 ' + color,
    (-d).toFixed(1) + 'px ' + d.toFixed(1) + 'px 0 ' + color,
    d.toFixed(1) + 'px ' + (-d).toFixed(1) + 'px 0 ' + color,
    (-d).toFixed(1) + 'px ' + (-d).toFixed(1) + 'px 0 ' + color,
  ];
  parts.push('0 ' + (w * 1.4).toFixed(1) + 'px ' + (w * 2.2).toFixed(1) + 'px rgba(0,0,0,0.55)');
  return parts.join(',');
}

/** Interpolate the camera-animation keys at \`t\`. */
function keyAt(keys, t) {
  const list = Array.isArray(keys) ? keys : [];
  if (!list.length) return null;
  if (list.length === 1 || t <= num(list[0].t, 0)) return list[0];
  if (t >= num(list[list.length - 1].t, 0)) return list[list.length - 1];
  for (let i = 1; i < list.length; i++) {
    if (t <= num(list[i].t, 0)) {
      const a = list[i - 1];
      const b = list[i];
      const span = Math.max(0.0001, num(b.t, 0) - num(a.t, 0));
      const p = clamp01((t - num(a.t, 0)) / span);
      return {
        opacity: num(a.opacity, 1) + (num(b.opacity, 1) - num(a.opacity, 1)) * p,
        scale: num(a.scale, 1) + (num(b.scale, 1) - num(a.scale, 1)) * p,
        x: num(a.x, 0) + (num(b.x, 0) - num(a.x, 0)) * p,
        y: num(a.y, 0) + (num(b.y, 0) - num(a.y, 0)) * p,
      };
    }
  }
  return list[list.length - 1];
}

/** Head/tail fade gain for the whole mix, 0..1. */
function fadeGain(t, total, fadeIn, fadeOut) {
  const fi = Math.max(0, num(fadeIn, 0));
  const fo = Math.max(0, num(fadeOut, 0));
  let g = 1;
  if (fi > 0) g = Math.min(g, clamp01(t / fi));
  if (fo > 0 && total > 0) g = Math.min(g, clamp01((total - t) / fo));
  return g;
}

function gradeFilter(g) {
  if (!g) return 'none';
  const parts = [];
  const b = clampN(num(g.brightness, 0), -50, 50);
  const c = clampN(num(g.contrast, 0), -50, 50);
  const s = clampN(num(g.saturation, 0), -50, 50);
  const highlights = clampN(num(g.highlights, 0), -50, 50);
  const shadows = clampN(num(g.shadows, 0), -50, 50);
  const temperature = clampN(num(g.temperature, 0), -50, 50);
  const tint = clampN(num(g.tint, 0), -50, 50);
  if (b) parts.push('brightness(' + (1 + b / 200).toFixed(3) + ')');
  if (c) parts.push('contrast(' + (1 + c / 150).toFixed(3) + ')');
  if (s) parts.push('saturate(' + (1 + s / 150).toFixed(3) + ')');
  // CSS cannot isolate luma ranges, so highlights and shadows use opposing
  // brightness/contrast layers: highlights expand together; shadows lift as
  // contrast falls. Keeping both primitives makes each control reversible.
  if (highlights) {
    parts.push('brightness(' + (1 + highlights / 500).toFixed(3) + ')');
    parts.push('contrast(' + (1 + highlights / 250).toFixed(3) + ')');
  }
  if (shadows) {
    parts.push('brightness(' + (1 + shadows / 250).toFixed(3) + ')');
    parts.push('contrast(' + (1 - shadows / 500).toFixed(3) + ')');
  }
  // A small sepia blend supplies the warm/cool chroma body; hue rotation
  // steers temperature toward amber/blue and tint toward magenta/green.
  const chromaMix = Math.min(0.35, (Math.abs(temperature) + Math.abs(tint)) * 0.0035);
  const hue = temperature * -0.24 + tint * 0.36;
  if (chromaMix > 0.0001) parts.push('sepia(' + chromaMix.toFixed(3) + ')');
  if (Math.abs(hue) > 0.001) parts.push('hue-rotate(' + hue.toFixed(2) + 'deg)');
  const preset = String(g.filterCss || 'none');
  if (preset && preset !== 'none') parts.push(preset);
  return parts.length ? parts.join(' ') : 'none';
}
`;

const CAPTIONS = `
/**
 * MIRROR of CAPTION_TIERS in lib/sveCaptionTiers.ts.
 *
 * This file is a STRING compiled in isolation by the render service, so it
 * cannot import the table the editor uses. If you change a number there,
 * change the matching line here in the same commit. Otherwise the preview and
 * the exported file stop agreeing, which is the one thing this whole
 * composition exists to prevent.
 *
 * Four of the five tiers are completely still. \`pop\` is non-zero on
 * 'kinetic' alone, and even there it moves exactly one word in the line.
 */
var TIER_TABLE = {
  clean: { size: 1, weight: 800, tracking: -0.012, gap: 0.14, pop: 0, popS: 0, centre: 0, enterS: 0, enterRise: 0, enterScale: 1, stagger: 0, slide: 0, tailS: 0.2, tabular: false },
  kinetic: { size: 1, weight: 800, tracking: -0.012, gap: 0.14, pop: 0.12, popS: 0.16, centre: 0, enterS: 0, enterRise: 0, enterScale: 1, stagger: 0, slide: 0, tailS: 0.2, tabular: false },
  cinematic: { size: 1.46, weight: 900, tracking: -0.03, gap: 0.1, pop: 0, popS: 0, centre: 0.85, enterS: 0.42, enterRise: 0.12, enterScale: 0.82, stagger: 0, slide: 0, tailS: 0.36, tabular: false },
  beat: { size: 1.9, weight: 900, tracking: -0.04, gap: 0.08, pop: 0, popS: 0, centre: 1, enterS: 0.12, enterRise: 0, enterScale: 1.34, stagger: 0, slide: 0, tailS: 0, tabular: false },
  ui: { size: 1, weight: 700, tracking: 0.08, gap: 0.2, pop: 0, popS: 0, centre: 0.42, enterS: 0.16, enterRise: 0, enterScale: 1, stagger: 0.14, slide: 0.35, tailS: 0.26, tabular: true },
};

/** A pill already pads each word, so the gap between pills tightens to match. */
var PILL_GAP_RATIO = 0.643;

/** Average advance per character of the heavy sans stack at weight 900, in em. */
var CAPTION_CHAR_ADVANCE = 0.56;

function tierOf(name) {
  var found = TIER_TABLE[String(name || 'clean')];
  return found || TIER_TABLE.clean;
}

/**
 * A tier's own font size, capped so its line still clears the safe margins.
 * MIRROR of fitTierSize in lib/sveCaptionTiers.ts.
 */
function fitTierSize(baseSize, tier, lineLength) {
  var wanted = baseSize * tier.size;
  if (tier.size <= 1 || lineLength <= 0) return wanted;
  var safeWidth = DESIGN_W * 0.84;
  var fits = safeWidth / (lineLength * CAPTION_CHAR_ADVANCE);
  return Math.max(baseSize, Math.min(wanted, fits));
}

/**
 * ONE word.
 *
 * Every word of every tier is drawn at full strength for the whole cue. The
 * single exception is a kinetic line's emphasised word, which grows by the
 * tier's \`pop\` at the moment it is spoken — that one movement is the entire
 * per-word animation budget of the system.
 */
function Word(props) {
  const w = props.word;
  const d = props.design;
  const tier = props.tier;
  const size = props.size;
  const appear = props.appear;

  const scale = props.popping ? 1 + tier.pop * popEase(props.pop) : 1;

  // White is the base; the accent is reserved for the words the tier marked
  // as the emphasis moment, and nothing else ever takes it.
  const fill = w.emphasis ? d.accent : d.color;
  const outlineWidth = Math.max(3, size * 0.055);
  const gap = props.pill ? tier.gap * PILL_GAP_RATIO : tier.gap;
  const slide = 'translateX(' + (-tier.slide * size * (1 - appear)).toFixed(2) + 'px)';
  // MIRROR of the .sve-caption-track line-height rules in lib/sveStyles.ts.
  const leading = tier.size >= 1.4 ? 1.04 : (tier.tabular ? 1.26 : 1.14);

  const base = {
    display: 'inline-block',
    margin: '0 ' + (size * gap).toFixed(1) + 'px',
    fontFamily: SANS,
    fontWeight: tier.weight,
    fontSize: size,
    lineHeight: leading,
    letterSpacing: (size * tier.tracking).toFixed(2) + 'px',
    fontVariantNumeric: tier.tabular ? 'tabular-nums' : 'normal',
    transform: slide + ' scale(' + scale.toFixed(4) + ')',
    transformOrigin: 'center bottom',
    opacity: appear,
    WebkitFontSmoothing: 'antialiased',
    textRendering: 'geometricPrecision',
  };

  let style = base;
  if (d.preset === 'gradient') {
    style = Object.assign({}, base, {
      backgroundImage: w.emphasis
        ? 'linear-gradient(180deg,' + d.accent + ' 0%,' + d.accent + ' 100%)'
        : 'linear-gradient(180deg,' + d.color + ' 8%,' + d.accent + ' 100%)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
      filter: 'drop-shadow(0 ' + (size * 0.05).toFixed(1) + 'px ' + (size * 0.08).toFixed(1) + 'px rgba(0,0,0,0.6))',
    });
  } else if (d.preset === 'outline') {
    style = Object.assign({}, base, {
      color: fill,
      textShadow: outlineShadow(outlineWidth, '#07070C'),
    });
  } else {
    style = Object.assign({}, base, {
      color: fill,
      textShadow: '0 ' + (size * 0.055).toFixed(1) + 'px ' + (size * 0.1).toFixed(1) + 'px rgba(0,0,0,0.72), 0 0 ' + (size * 0.03).toFixed(1) + 'px rgba(0,0,0,0.5)',
    });
  }

  // A pill is a PER-WORD badge, never a block behind the whole line.
  if (!props.pill) return <span style={style}>{props.text}</span>;

  return (
    <span style={{
      display: 'inline-block',
      margin: '0 ' + (size * gap).toFixed(1) + 'px',
      padding: (size * 0.08).toFixed(1) + 'px ' + (size * 0.22).toFixed(1) + 'px',
      borderRadius: (size * 0.26).toFixed(1) + 'px',
      background: 'rgba(10,10,16,0.4)',
      transform: slide + ' scale(' + scale.toFixed(4) + ')',
      transformOrigin: 'center bottom',
      opacity: appear,
    }}>
      <span style={Object.assign({}, style, { margin: 0, transform: 'none', opacity: 1 })}>{props.text}</span>
    </span>
  );
}

/**
 * The caption block. There is deliberately NO background plate behind the
 * line — the words sit straight on the picture and earn their legibility from
 * the shadow/outline treatment, which is what the redesign asked for.
 *
 * The cue's tier decides the size, where on the frame it sits, how it enters
 * and whether it fades out or cuts. A beat line has no tail at all.
 */
function CaptionLayer(props) {
  const cue = props.cue;
  const d = props.design;
  const t = props.t;
  if (!cue) return null;

  const tier = tierOf(cue.tier);
  const line = cue.words
    .map(function (w) { return d.uppercase ? String(w.text).toUpperCase() : String(w.text); })
    .join(' ');
  const size = fitTierSize(num(props.size, 86), tier, line.length);

  // Every tier draws the whole line from the frame its cue opens. The
  // entrance carries both the fade and the scale; a tail of 0 is the beat
  // tier cutting on the frame rather than fading.
  const age = Math.max(0, t - num(cue.start, 0));
  const enter = tier.enterS > 0 ? easeOut(age / tier.enterS) : 1;
  const out = tier.tailS > 0
    ? easeOut((num(cue.end, 0) + tier.tailS - t) / tier.tailS)
    : (t <= num(cue.end, 0) ? 1 : 0);

  const posY = clamp01(num(d.posY, 0.74));
  const rise = tier.enterRise * size * (1 - enter);
  const blockScale = tier.enterScale + (1 - tier.enterScale) * enter;
  const pill = d.preset === 'boxed' || d.pill;

  return (
    <div style={{
      position: 'absolute',
      left: DESIGN_W * 0.08,
      width: DESIGN_W * 0.84,
      top: (posY + (0.5 - posY) * tier.centre) * DESIGN_H,
      transform: 'translateY(-50%) translateY(' + rise.toFixed(2) + 'px) scale(' + blockScale.toFixed(4) + ')',
      textAlign: 'center',
      opacity: Math.max(0, Math.min(1, Math.min(enter, out))),
      pointerEvents: 'none',
    }}>
      {cue.words.map(function (w, i) {
        const appear = tier.stagger > 0 ? easeOut((age - i * tier.stagger) / 0.18) : 1;
        if (appear <= 0) return null;
        const popping = tier.pop > 0 && w.emphasis === true;
        const pop = (popping && tier.popS > 0)
          ? clamp01((t - num(w.start, 0)) / tier.popS)
          : 0;
        const text = d.uppercase ? String(w.text).toUpperCase() : String(w.text);
        return (
          <Word
            key={'w-' + i}
            word={w}
            text={text}
            design={d}
            tier={tier}
            pill={pill}
            size={size}
            appear={appear}
            pop={pop}
            popping={popping}
          />
        );
      })}
    </div>
  );
}
`;

const CARDS = `
/** Title-card hook, end CTA and lower third — all three share one envelope. */
function CardLayer(props) {
  const c = props.card;
  const t = props.t;
  const a = envelope(t, num(c.start, 0), num(c.end, 0), 0.32);
  if (a <= 0.001) return null;

  const rise = (1 - easeOut(clamp01((t - num(c.start, 0)) / 0.45))) * 44;
  const accent = c.color || '#A855F7';

  if (c.kind === 'lower') {
    return (
      <div style={{
        position: 'absolute', left: DESIGN_W * 0.08, bottom: DESIGN_H * 0.14,
        opacity: a, transform: 'translateX(' + (-(1 - a) * 60).toFixed(1) + 'px)',
        display: 'flex', alignItems: 'stretch', gap: 20,
      }}>
        <div style={{ width: 10, borderRadius: 6, background: accent, boxShadow: '0 0 36px ' + rgba(accent, 0.7) }} />
        <div style={{
          padding: '22px 34px', borderRadius: 18,
          background: 'rgba(8,8,14,0.62)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}>
          <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 56, color: '#FFFFFF', letterSpacing: -0.8 }}>{c.title}</div>
          {c.subtitle ? <div style={{ marginTop: 8, fontFamily: SANS, fontWeight: 600, fontSize: 34, color: rgba(accent, 0.95) }}>{c.subtitle}</div> : null}
        </div>
      </div>
    );
  }

  // A CTA sits at 38% rather than mid-frame: captions live at ~74%, and a
  // card centred lower than this lands on top of the word track.
  const isCta = c.kind === 'cta';
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0,
      top: isCta ? DESIGN_H * 0.38 : DESIGN_H * 0.2,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0 ' + DESIGN_W * 0.09 + 'px',
      opacity: a, transform: 'translateY(' + rise.toFixed(1) + 'px)',
    }}>
      <div style={{
        padding: isCta ? '40px 56px' : '34px 48px',
        borderRadius: 30,
        textAlign: 'center',
        background: isCta
          ? 'linear-gradient(135deg,' + accent + ',' + rgba(accent, 0.72) + ')'
          : 'rgba(8,8,14,0.5)',
        border: isCta ? 'none' : '2px solid ' + rgba(accent, 0.55),
        boxShadow: '0 28px 90px rgba(0,0,0,0.5), 0 0 70px ' + rgba(accent, isCta ? 0.42 : 0.2),
      }}>
        <div style={{
          fontFamily: SANS, fontWeight: 900,
          fontSize: isCta ? 84 : 76, lineHeight: 1.05,
          color: '#FFFFFF', letterSpacing: -1.6,
          textShadow: '0 6px 20px rgba(0,0,0,0.45)',
          WebkitFontSmoothing: 'antialiased',
        }}>{c.title}</div>
        {c.subtitle ? (
          <div style={{
            marginTop: 16, fontFamily: SANS, fontWeight: 700, fontSize: 40,
            color: isCta ? 'rgba(255,255,255,0.92)' : rgba(accent, 0.95), letterSpacing: 0.4,
          }}>{c.subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}
`;

const BROLL = `
/**
 * B-roll is VISUAL ONLY. It is mounted muted in every layout, so the original
 * audio is never interrupted — the brief's hard rule.
 */
function BrollLayer(props) {
  const b = props.broll;
  const t = props.t;
  const start = num(b.start, 0);
  const end = num(b.end, 0);
  if (t < start || t > end) return null;
  const a = envelope(t, start, end, 0.3);
  const layout = String(b.layout || 'corner');

  if (layout === 'blend') {
    return (
      <div style={{ position: 'absolute', inset: 0, opacity: a * clamp01(num(b.opacity, 0.6)) }}>
        <OffthreadVideo src={b.url} muted volume={0} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  if (layout === 'split') {
    return (
      <div style={{
        position: 'absolute', left: 0, right: 0, top: DESIGN_H / 2, height: DESIGN_H / 2,
        opacity: a, overflow: 'hidden',
        borderTop: '4px solid rgba(255,255,255,0.16)',
        transform: 'translateY(' + ((1 - a) * 40).toFixed(1) + 'px)',
      }}>
        <OffthreadVideo src={b.url} muted volume={0} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  const w = DESIGN_W * 0.38;
  const h = w * 9 / 16;
  return (
    <div style={{
      position: 'absolute', right: DESIGN_W * 0.055, top: DESIGN_H * 0.08,
      width: w, height: h, borderRadius: 26, overflow: 'hidden',
      border: '4px solid rgba(255,255,255,0.2)',
      boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
      opacity: a,
      transform: 'scale(' + (0.9 + 0.1 * a).toFixed(3) + ')',
    }}>
      <OffthreadVideo src={b.url} muted volume={0} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  );
}
`;

const ROOT = `
export default function Composition(inputProps) {
  const p = inputProps || {};
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const fps = cfg.fps || 30;
  const t = frame / fps;

  // Uniform fit — never a non-uniform scale, so nothing is ever distorted.
  const stageScale = Math.min((cfg.width || DESIGN_W) / DESIGN_W, (cfg.height || DESIGN_H) / DESIGN_H);

  const base = p.base || {};
  const design = p.captionDesign || {};
  const cues = Array.isArray(p.cues) ? p.cues : [];
  const broll = Array.isArray(p.broll) ? p.broll : [];
  const cards = Array.isArray(p.cards) ? p.cards : [];
  const music = p.music || {};
  const captionSize = clampN(num(p.captionSize, 86), 28, 220);

  const totalS = num(cfg.durationInFrames, 0) / fps;
  const audio = p.audio || {};
  const mixGain = fadeGain(t, totalS, audio.fadeIn, audio.fadeOut);
  const kf = keyAt(p.keyframes, t);
  // A smooth loop is a short dip at both ends, so a player that restarts the
  // file never shows a hard jump between the last frame and the first.
  const loopFade = p.smoothLoop
    ? Math.min(easeOut(t / 0.3), easeOut((totalS - t) / 0.45), 1)
    : 1;
  const baseTransform = kf
    ? 'translate(' + (num(kf.x, 0) * 100).toFixed(3) + '%,' + (num(kf.y, 0) * 100).toFixed(3) + '%) scale('
      + clampN(num(kf.scale, 1), 0.5, 3).toFixed(4) + ')'
    : 'none';

  // The window a cue stays on screen for runs past its end by its own tier's
  // tail fade, so a beat line disappears on the frame its cue ends.
  let liveCue = null;
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (t >= num(c.start, 0) - 0.0001 && t <= num(c.end, 0) + tierOf(c.tier).tailS) liveCue = c;
  }

  return (
    <AbsoluteFill style={{ background: '#05050A', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <style>{FONT_CSS}</style>

      {/* MUSIC — mixed UNDER the original audio, which stays on the base clip. */}
      {music && music.url ? (
        <Audio src={music.url} volume={clamp01(num(music.volume, 0.25)) * mixGain} loop />
      ) : null}

      <div style={{
        position: 'relative',
        width: DESIGN_W,
        height: DESIGN_H,
        flexShrink: 0,
        overflow: 'hidden',
        background: '#05050A',
        transform: 'scale(' + stageScale.toFixed(6) + ')',
      }}>
        {/* BASE — keeps its own audio at the creator's chosen level. */}
        {base.url ? (
          <AbsoluteFill style={{
            filter: gradeFilter(p.grade),
            transform: baseTransform,
            opacity: (kf ? clamp01(num(kf.opacity, 1)) : 1) * loopFade,
          }}>
            <OffthreadVideo
              src={base.url}
              volume={clamp01(num(base.volume, 1)) * mixGain}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </AbsoluteFill>
        ) : null}

        {/* B-ROLL — overlaid, never cut in, never carrying audio.
            Each clip is mounted in its own Sequence so the overlay plays from
            ITS first frame when the window opens, rather than from whatever
            moment of the source happens to line up with the main timeline. */}
        {broll.map(function (b, i) {
          if (!b || !b.url) return null;
          const from = Math.max(0, Math.round(num(b.start, 0) * fps));
          const span = Math.max(1, Math.round((num(b.end, 0) - num(b.start, 0)) * fps));
          return (
            <Sequence key={'br-' + i} from={from} durationInFrames={span}>
              <BrollLayer broll={b} t={t} />
            </Sequence>
          );
        })}

        {/* GRAPHIC CARDS — hook, lower thirds, end CTA. */}
        {cards.map(function (c, i) {
          if (!c || !c.title) return null;
          return <CardLayer key={'cd-' + i} card={c} t={t} />;
        })}

        {/* CAPTIONS — word by word, no plate behind the line. */}
        {p.captionsEnabled === false ? null : (
          <CaptionLayer cue={liveCue} design={design} t={t} size={captionSize} />
        )}
      </div>
    </AbsoluteFill>
  );
}
`;

const HEADER = `
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
`;

/** The exact TSX submitted to the platform render service. */
export const SVE_PHASE2_COMPOSITION = HEADER + HELPERS + CAPTIONS + CARDS + BROLL + ROOT;

/** Stable digest of the engine build, shown next to the preview. */
export function compositionBuildId(): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < SVE_PHASE2_COMPOSITION.length; i++) {
    h = ((h ^ SVE_PHASE2_COMPOSITION.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 8);
}
