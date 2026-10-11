// runtime-source — the SDK, as source text.
//
// WHY A STRING AND NOT A MODULE: the generated Film.tsx has to run in two
// places that cannot share a module graph — the in-app Remotion <Player>
// (compiled by sucrase inside a sandboxed iframe) and the platform render
// service (POST /api/render/remotion, which takes `compositionTsx` as a single
// self-contained source string that may import only 'react' and 'remotion').
// pipeline/render.ts concatenates this text, the asset registry literal and
// the generated film body into one module, which is what guarantees the MP4 is
// the same film the preview showed.
//
// AUTHORING RULES for the literal below, learned the hard way: no backticks,
// no dollar-brace, and no backslashes — the template literal would eat them
// before the render service ever saw the source. So strings are concatenated,
// newlines inside rendered text are expressed as separate elements, and there
// are no regular expressions.
//
// CONTRACT: the bundle must define ASSET_MAP, resolveAsset and FILM_THEME
// BEFORE this text. pipeline/render.ts emits them; buildFilmBundle() is the
// only supported way to assemble the three parts.

export const SDK_RUNTIME_SOURCE = `
const FONT = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const FRAME_W = 1920;
const FRAME_H = 1080;

// ── shared helpers ─────────────────────────────────────────

// A layer prop may carry either a raw handle or a URL resolveAsset already
// returned. Both are accepted so a film that inlines a resolved URL still
// draws, instead of rendering an empty box nobody can explain.
function assetUrl(value) {
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (raw.indexOf('http') === 0 || raw.indexOf('data:') === 0 || raw.indexOf('//') === 0) return raw;
  try { return resolveAsset(raw); } catch (err) { return ''; }
}

function clamp01(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function easeOutCubic(t) {
  var x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function easeInCubic(t) {
  var x = clamp01(t);
  return x * x * x;
}

function applyEasing(name, t) {
  var x = clamp01(t);
  if (name === 'linear') return x;
  if (name === 'ease-in') return easeInCubic(x);
  if (name === 'snap') return x < 0.35 ? easeOutCubic(x / 0.35) : 1;
  return easeOutCubic(x);
}

// Coordinates in a ComponentPlan are 0-100 percentages of the frame, so a plan
// never has to know the render geometry.
function pctX(value) { return (Number(value) || 0) / 100 * FRAME_W; }
function pctY(value) { return (Number(value) || 0) / 100 * FRAME_H; }

function justifyFor(align) {
  if (align === 'left') return 'flex-start';
  if (align === 'right') return 'flex-end';
  return 'center';
}

// Deterministic pseudo-random: the same frame must draw the same picture on
// the preview and on the render farm, so Math.random is never used.
function hashAt(index, salt) {
  var n = Math.sin((index + 1) * 127.1 + (salt || 0) * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function useEnter(durationFrames) {
  var frame = useCurrentFrame();
  var span = Math.max(1, Number(durationFrames) || 18);
  return easeOutCubic(frame / span);
}

// spring() is a pure function, not a hook, so springAt can be called inside a
// map callback where useSpringIn could not be.
function springAt(frame, fps, delayFrames) {
  return spring({
    frame: frame - (Number(delayFrames) || 0),
    fps: fps || 30,
    config: { stiffness: 180, damping: 22, mass: 0.9 },
  });
}

function useSpringIn(delayFrames) {
  var cfg = useVideoConfig();
  return springAt(useCurrentFrame(), cfg.fps, delayFrames);
}

/** Progress across the layer's own Sequence, 0 to 1. */
function useSpan(durationFrames) {
  var frame = useCurrentFrame();
  var cfg = useVideoConfig();
  var span = Math.max(1, Number(durationFrames) || cfg.durationInFrames || 90);
  return clamp01(frame / span);
}

function Centered(props) {
  return React.createElement(AbsoluteFill, {
    style: {
      display: 'flex',
      alignItems: props.alignItems || 'center',
      justifyContent: props.justifyContent || 'center',
      padding: props.padding === undefined ? '0 110px' : props.padding,
    },
  }, props.children);
}

// ── TYPOGRAPHY ───────────────────────────────────────────

const TYPE_SCALE = { viewport: 236, massive: 170, editorial: 114, display: 86 };
const TRACKING = { tight: '-0.045em', normal: '0em', wide: '0.08em', ultra: '0.2em' };
const TEXT_SIZE = { sm: 36, md: 54, lg: 76, xl: 104 };

function MassiveType(props) {
  var p = useSpringIn(0);
  var anim = props.animateIn || 'rise';
  var size = TYPE_SCALE[props.scale] || TYPE_SCALE.massive;
  var rise = anim === 'rise' ? (1 - p) * 96 : 0;
  var fall = anim === 'fall' ? (p - 1) * 96 : 0;
  var scale = anim === 'scale' ? 0.84 + p * 0.16 : 1;
  var clip = anim === 'reveal' ? 'inset(' + String((1 - p) * 100) + '% 0 0 0)' : undefined;
  return React.createElement(Centered, { justifyContent: justifyFor(props.align) },
    React.createElement('div', {
      'data-ui-id': 'massive-type',
      style: {
        fontFamily: FONT,
        fontSize: size,
        lineHeight: 0.94,
        fontWeight: Number(props.weight) || 900,
        letterSpacing: TRACKING[props.tracking] || '-0.035em',
        color: props.color || FILM_THEME.text,
        textAlign: props.align || 'center',
        opacity: anim === 'none' ? 1 : clamp01(p),
        transform: 'translateY(' + String(rise + fall) + 'px) scale(' + String(scale) + ')',
        clipPath: clip,
        maxWidth: '100%',
        wordBreak: 'break-word',
      },
    }, String(props.text || '')));
}

function KineticLine(props) {
  var p = useSpringIn(props.delay);
  var motion = props.motion || 'rise';
  var dy = 0;
  var dx = 0;
  if (motion === 'rise') dy = (1 - p) * 64;
  if (motion === 'fall') dy = (p - 1) * 64;
  if (motion === 'cascade') { dy = (1 - p) * 40; dx = (1 - p) * 30; }
  if (motion === 'split') dx = (1 - p) * (props.index % 2 === 0 ? -70 : 70);
  var words = String(props.text || '').split(' ');
  var emphasis = props.emphasis || [];
  return React.createElement('div', {
    style: {
      opacity: clamp01(p),
      transform: 'translate(' + String(dx) + 'px,' + String(dy) + 'px)',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0 0.32em',
      justifyContent: 'center',
    },
  }, words.map(function (word, i) {
    var bare = word.replace('*', '').replace('*', '');
    var starred = word.indexOf('*') >= 0;
    var listed = emphasis.indexOf(bare) >= 0;
    return React.createElement('span', {
      key: 'w' + String(i),
      style: { color: starred || listed ? FILM_THEME.accent : 'inherit' },
    }, bare);
  }));
}

function KineticText(props) {
  var lines = Array.isArray(props.lines) ? props.lines : [];
  var stagger = Number(props.staggerFrames) || 7;
  var typewriter = props.motion === 'typewriter';
  return React.createElement(Centered, null,
    React.createElement('div', {
      'data-ui-id': 'kinetic-text',
      style: {
        fontFamily: FONT,
        fontSize: TEXT_SIZE[props.size] || TEXT_SIZE.lg,
        fontWeight: 800,
        lineHeight: 1.12,
        letterSpacing: '-0.025em',
        color: props.color || FILM_THEME.text,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      },
    }, lines.map(function (line, index) {
      if (typewriter) {
        return React.createElement(TypeOn, {
          key: 'k' + String(index),
          text: line,
          cursorVisible: index === lines.length - 1,
          charsPerFrame: 1.4,
          inline: true,
          delay: index * stagger,
        });
      }
      return React.createElement(KineticLine, {
        key: 'k' + String(index),
        text: line,
        index: index,
        delay: index * stagger,
        motion: props.motion,
        emphasis: props.emphasis,
      });
    })));
}

function WordReveal(props) {
  var frame = useCurrentFrame();
  var span = Math.max(1, Number(props.durationFrames) || 45);
  var style = props.revealStyle || 'word';
  var text = String(props.text || '');
  var units = style === 'char' ? text.split('') : style === 'line' ? text.split(' | ') : text.split(' ');
  var shown = Math.ceil(clamp01(frame / span) * units.length);
  return React.createElement(Centered, null,
    React.createElement('div', {
      'data-ui-id': 'word-reveal',
      style: {
        fontFamily: FONT,
        fontSize: style === 'char' ? 96 : 84,
        fontWeight: 800,
        letterSpacing: '-0.03em',
        lineHeight: 1.15,
        color: props.color || FILM_THEME.text,
        textAlign: 'center',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: style === 'char' ? '0' : '0 0.3em',
      },
    }, units.map(function (unit, index) {
      var visible = index < shown;
      var local = clamp01((frame - (index / Math.max(1, units.length)) * span) / 10);
      return React.createElement('span', {
        key: 'u' + String(index),
        style: {
          opacity: visible ? easeOutCubic(local) : 0,
          transform: 'translateY(' + String((1 - (visible ? easeOutCubic(local) : 0)) * 26) + 'px)',
          display: style === 'line' ? 'block' : 'inline-block',
          width: style === 'line' ? '100%' : undefined,
        },
      }, unit === ' ' ? '\u00a0' : unit);
    })));
}

function SplitText(props) {
  var p = useSpringIn(0);
  var horizontal = (props.splitAxis || 'horizontal') === 'horizontal';
  var gap = Number(props.gapPx) || 40;
  var together = props.animateDirection === 'together';
  var travel = together ? (1 - p) * gap * 3 : p * gap;
  var text = String(props.text || '');
  var mid = Math.ceil(text.length / 2);
  var halves = [text.slice(0, mid), text.slice(mid)];
  return React.createElement(Centered, null,
    React.createElement('div', {
      'data-ui-id': 'split-text',
      style: {
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        fontSize: 132,
        fontWeight: 900,
        letterSpacing: '-0.04em',
        color: FILM_THEME.text,
        opacity: clamp01(p),
      },
    }, halves.map(function (half, index) {
      var sign = index === 0 ? -1 : 1;
      var offset = sign * travel;
      return React.createElement('span', {
        key: 'h' + String(index),
        style: {
          transform: horizontal
            ? 'translateX(' + String(offset) + 'px)'
            : 'translateY(' + String(offset) + 'px)',
        },
      }, half);
    })));
}

function TypeOn(props) {
  var frame = useCurrentFrame() - (Number(props.delay) || 0);
  var rate = Number(props.charsPerFrame) || 1.2;
  var text = String(props.text || '');
  var shown = Math.max(0, Math.min(text.length, Math.floor(frame * rate)));
  var caretOn = props.cursorVisible !== false && Math.floor(frame / 15) % 2 === 0;
  var body = React.createElement('div', {
    'data-ui-id': 'type-on',
    style: {
      fontFamily: MONO,
      fontSize: props.inline ? 'inherit' : 68,
      fontWeight: 600,
      letterSpacing: '-0.01em',
      color: FILM_THEME.text,
      textAlign: 'center',
      whiteSpace: 'pre-wrap',
    },
  }, text.slice(0, shown), caretOn
    ? React.createElement('span', { style: { color: FILM_THEME.accent } }, '_')
    : null);
  return props.inline ? body : React.createElement(Centered, null, body);
}

// ── MEDIA ──────────────────────────────────────────────

// An asset that could not be resolved draws its handle on a panel rather than
// a blank rectangle: a missing asset has to be visible to the critic.
function MissingAsset(props) {
  return React.createElement('div', {
    'data-ui-id': 'missing-asset',
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: FILM_THEME.panel,
      border: '2px dashed ' + FILM_THEME.border,
      borderRadius: 18,
      fontFamily: MONO,
      fontSize: 26,
      color: FILM_THEME.muted,
      textAlign: 'center',
      padding: 30,
    },
  }, 'missing asset: ' + String(props.handle || 'unknown'));
}

function Screenshot(props) {
  var url = assetUrl(props.src);
  var p = useSpringIn(0);
  var inner = url
    ? React.createElement(Img, {
      src: url,
      style: {
        width: '100%',
        height: '100%',
        objectFit: props.fit || 'cover',
        borderRadius: Number(props.cornerRadius) || 0,
        border: props.border || 'none',
        display: 'block',
      },
    })
    : React.createElement(MissingAsset, { handle: props.src });
  return React.createElement(Centered, { padding: '70px' },
    React.createElement('div', {
      'data-ui-id': 'screenshot',
      style: {
        width: '100%',
        height: '100%',
        borderRadius: Number(props.cornerRadius) || 0,
        overflow: 'hidden',
        boxShadow: props.shadow === false ? 'none' : '0 50px 120px rgba(0,0,0,0.55)',
        opacity: clamp01(p),
        transform: 'scale(' + String(0.96 + clamp01(p) * 0.04) + ')',
      },
    }, inner));
}

const LOGO_SIZE = { sm: 110, md: 180, lg: 280, xl: 420 };

function Logo(props) {
  var url = assetUrl(props.src);
  var p = useSpringIn(0);
  var anim = props.animateIn || 'fade';
  var size = LOGO_SIZE[props.size] || LOGO_SIZE.md;
  return React.createElement(Centered, null,
    React.createElement('div', {
      'data-ui-id': 'logo',
      style: {
        width: size,
        height: size * 0.42,
        opacity: anim === 'none' ? 1 : clamp01(p),
        transform: anim === 'scale' ? 'scale(' + String(0.8 + clamp01(p) * 0.2) + ')' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    }, url
      ? React.createElement(Img, { src: url, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } })
      : React.createElement(MissingAsset, { handle: props.src })));
}

function MetricCounter(props) {
  var span = Math.max(1, Number(props.durationFrames) || 40);
  var p = easeOutCubic(useCurrentFrame() / span);
  var target = Number(props.value) || 0;
  var shown = target % 1 === 0
    ? String(Math.round(target * p))
    : (target * p).toFixed(1);
  return React.createElement(Centered, null,
    React.createElement('div', {
      'data-ui-id': 'metric-counter',
      style: { textAlign: 'center', fontFamily: FONT },
    },
      React.createElement('div', {
        style: {
          fontSize: 210,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: '-0.05em',
          color: props.color || FILM_THEME.accent,
        },
      }, String(props.prefix || '') + shown + String(props.suffix || '')),
      React.createElement('div', {
        style: {
          marginTop: 22,
          fontSize: 38,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: FILM_THEME.muted,
        },
      }, String(props.label || ''))));
}

// ── UI ────────────────────────────────────────────────

function BrowserChrome(props) {
  var dark = props.theme !== 'light';
  return React.createElement('div', {
    style: {
      height: 58,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '0 22px',
      background: dark ? 'rgba(255,255,255,0.06)' : '#EDEFF3',
      borderBottom: '1px solid ' + (dark ? 'rgba(255,255,255,0.09)' : 'rgba(10,12,17,0.08)'),
    },
  },
    ['#FF5F57', '#FEBC2E', '#28C840'].map(function (dot, index) {
      return React.createElement('span', {
        key: 'd' + String(index),
        style: { width: 13, height: 13, borderRadius: 7, background: dot, display: 'inline-block' },
      });
    }),
    React.createElement('div', {
      style: {
        marginLeft: 18,
        flex: 1,
        height: 30,
        borderRadius: 15,
        background: dark ? 'rgba(255,255,255,0.07)' : '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        fontFamily: MONO,
        fontSize: 17,
        color: dark ? 'rgba(255,255,255,0.55)' : 'rgba(10,12,17,0.5)',
      },
    }, String(props.url || '')));
}

function BrowserFrame(props) {
  var p = useSpringIn(0);
  var url = assetUrl(props.screenshot);
  var zoom = Math.max(0.5, Math.min(2, Number(props.zoom) || 1));
  var entering = props.animateIn === false ? 1 : clamp01(p);
  var hi = props.highlight;
  return React.createElement(Centered, { padding: '84px 140px' },
    React.createElement('div', {
      'data-ui-id': 'browser-frame',
      style: {
        width: '100%',
        height: '100%',
        borderRadius: 22,
        overflow: 'hidden',
        background: props.theme === 'light' ? '#FFFFFF' : FILM_THEME.panel,
        border: '1px solid ' + FILM_THEME.border,
        boxShadow: '0 60px 140px rgba(0,0,0,0.6)',
        opacity: entering,
        transform: 'translateY(' + String((1 - entering) * 70) + 'px) scale('
          + String(0.95 + entering * 0.05) + ')',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      },
    },
      React.createElement(BrowserChrome, { url: props.url, theme: props.theme }),
      React.createElement('div', { style: { flex: 1, overflow: 'hidden', position: 'relative' } },
        url
          ? React.createElement(Img, {
            src: url,
            style: {
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'top center',
              transform: 'scale(' + String(zoom) + ')',
              transformOrigin: 'top center',
            },
          })
          : React.createElement(MissingAsset, { handle: props.screenshot }),
        hi
          ? React.createElement('div', {
            style: {
              position: 'absolute',
              left: String(Number(hi.x) || 0) + '%',
              top: String(Number(hi.y) || 0) + '%',
              width: String(Number(hi.width) || 10) + '%',
              height: String(Number(hi.height) || 10) + '%',
              border: '3px solid ' + FILM_THEME.accent,
              borderRadius: 10,
              boxShadow: '0 0 0 9999px rgba(5,6,10,0.45)',
            },
          }, hi.label
            ? React.createElement('span', {
              style: {
                position: 'absolute',
                top: -44,
                left: 0,
                padding: '6px 12px',
                borderRadius: 8,
                background: FILM_THEME.accent,
                color: FILM_THEME.onAccent,
                fontFamily: FONT,
                fontSize: 20,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              },
            }, String(hi.label))
            : null)
          : null)));
}

function Dashboard(props) {
  var url = assetUrl(props.screenshot);
  var metrics = Array.isArray(props.metrics) ? props.metrics.slice(0, 4) : [];
  var region = props.highlightRegion || 'full';
  var frame = useCurrentFrame();
  var fps = useVideoConfig().fps;
  var p = springAt(frame, fps, 0);
  return React.createElement(Centered, { padding: '70px 120px' },
    React.createElement('div', {
      'data-ui-id': 'dashboard',
      style: {
        width: '100%',
        height: '100%',
        borderRadius: 22,
        overflow: 'hidden',
        position: 'relative',
        background: FILM_THEME.panel,
        border: '1px solid ' + FILM_THEME.border,
        opacity: clamp01(p),
      },
    },
      url
        ? React.createElement(Img, {
          src: url,
          style: {
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: metrics.length ? 0.42 : 1,
            filter: region === 'full' ? 'none' : 'saturate(0.8)',
          },
        })
        : null,
      metrics.length
        ? React.createElement('div', {
          style: {
            position: 'absolute',
            inset: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(' + String(Math.min(4, metrics.length)) + ', 1fr)',
            gap: 28,
            padding: 60,
            alignContent: 'center',
          },
        }, metrics.map(function (metric, index) {
          var enter = springAt(frame, fps, index * 6);
          var raw = Number(metric.value);
          var counted = props.animateCounters !== false && isFinite(raw)
            ? String(Math.round(raw * clamp01(enter)))
            : String(metric.value == null ? '' : metric.value);
          var trend = metric.trend === 'down' ? '-' : metric.trend === 'flat' ? '=' : '+';
          return React.createElement('div', {
            key: 'm' + String(index),
            style: {
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid ' + FILM_THEME.border,
              borderRadius: 18,
              padding: '28px 26px',
              opacity: clamp01(enter),
              transform: 'translateY(' + String((1 - clamp01(enter)) * 26) + 'px)',
              fontFamily: FONT,
            },
          },
            React.createElement('div', {
              style: { fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase', color: FILM_THEME.muted },
            }, String(metric.label || '')),
            React.createElement('div', {
              style: { marginTop: 12, fontSize: 72, fontWeight: 900, letterSpacing: '-0.04em', color: FILM_THEME.text },
            }, counted),
            metric.trend
              ? React.createElement('div', {
                style: { marginTop: 6, fontSize: 24, fontWeight: 700, color: FILM_THEME.accent },
              }, trend)
              : null);
        }))
        : null,
      url ? null : React.createElement(MissingAsset, { handle: props.screenshot })));
}

function Cursor(props) {
  var frame = useCurrentFrame();
  var path = Array.isArray(props.path) && props.path.length ? props.path : [{ x: 50, y: 50, frame: 0 }];
  var point = path[0];
  for (var i = 0; i < path.length; i += 1) {
    var next = path[i + 1];
    if (!next) { point = path[i]; break; }
    if (frame >= Number(path[i].frame) && frame <= Number(next.frame)) {
      var t = applyEasing('ease-out',
        (frame - Number(path[i].frame)) / Math.max(1, Number(next.frame) - Number(path[i].frame)));
      point = {
        x: Number(path[i].x) + (Number(next.x) - Number(path[i].x)) * t,
        y: Number(path[i].y) + (Number(next.y) - Number(path[i].y)) * t,
      };
      break;
    }
    point = next;
  }
  var clicks = Array.isArray(props.clickFrames) ? props.clickFrames : [];
  var ripple = 0;
  for (var c = 0; c < clicks.length; c += 1) {
    var age = frame - Number(clicks[c]);
    if (age >= 0 && age < 16) ripple = Math.max(ripple, 1 - age / 16);
  }
  return React.createElement(AbsoluteFill, { 'data-ui-id': 'cursor', style: { pointerEvents: 'none' } },
    ripple > 0
      ? React.createElement('div', {
        style: {
          position: 'absolute',
          left: pctX(point.x) - 46,
          top: pctY(point.y) - 46,
          width: 92,
          height: 92,
          borderRadius: 46,
          border: '3px solid ' + FILM_THEME.accent,
          opacity: ripple * 0.8,
          transform: 'scale(' + String(1.4 - ripple * 0.6) + ')',
        },
      })
      : null,
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: pctX(point.x),
        top: pctY(point.y),
        width: 0,
        height: 0,
        borderLeft: '16px solid #FFFFFF',
        borderTop: '10px solid transparent',
        borderBottom: '10px solid transparent',
        transform: 'rotate(' + String(props.style === 'text' ? 90 : 38) + 'deg)',
        filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.6))',
      },
    }));
}

function Highlight(props) {
  var frame = useCurrentFrame();
  var target = props.target || { x: 40, y: 40, width: 20, height: 20 };
  var pulse = props.pulse === false ? 1 : 0.55 + 0.45 * Math.sin(frame / 7);
  return React.createElement(AbsoluteFill, { 'data-ui-id': 'highlight' },
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: pctX(target.x),
        top: pctY(target.y),
        width: pctX(target.width),
        height: pctY(target.height),
        border: '4px solid ' + (props.color || FILM_THEME.accent),
        borderRadius: 14,
        opacity: pulse,
        boxShadow: '0 0 60px ' + (props.color || FILM_THEME.accent),
      },
    }, props.label
      ? React.createElement('span', {
        style: {
          position: 'absolute',
          bottom: -54,
          left: 0,
          padding: '8px 16px',
          borderRadius: 10,
          background: props.color || FILM_THEME.accent,
          color: FILM_THEME.onAccent,
          fontFamily: FONT,
          fontSize: 24,
          fontWeight: 700,
          whiteSpace: 'nowrap',
        },
      }, String(props.label))
      : null));
}

function Tooltip(props) {
  var frame = useCurrentFrame();
  var at = Number(props.appearsAtFrame) || 0;
  var p = easeOutCubic((frame - at) / 12);
  if (frame < at) return null;
  var position = props.position || { x: 50, y: 50 };
  return React.createElement(AbsoluteFill, { 'data-ui-id': 'tooltip' },
    React.createElement('div', {
      style: {
        position: 'absolute',
        left: pctX(position.x),
        top: pctY(position.y),
        padding: '16px 24px',
        borderRadius: 14,
        background: FILM_THEME.panel,
        border: '1px solid ' + FILM_THEME.border,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        fontFamily: FONT,
        fontSize: 30,
        fontWeight: 600,
        color: FILM_THEME.text,
        maxWidth: 560,
        opacity: clamp01(p),
        transform: 'translateY(' + String((1 - clamp01(p)) * 16) + 'px)',
      },
    }, String(props.text || '')));
}

// ── MOTION ──────────────────────────────────────────────

function Parallax(props) {
  var t = useSpan(props.durationFrames);
  var depth = clamp01(props.depth === undefined ? 0.4 : props.depth);
  var travel = depth * 140;
  var dir = props.direction || 'up';
  var dx = dir === 'left' ? -travel * t : dir === 'right' ? travel * t : 0;
  var dy = dir === 'up' ? -travel * t : dir === 'down' ? travel * t : 0;
  return React.createElement(AbsoluteFill, {
    'data-ui-id': 'parallax',
    style: { transform: 'translate(' + String(dx) + 'px,' + String(dy) + 'px)' },
  }, props.children);
}

const CAMERA_INTENSITY = { subtle: 0.05, moderate: 0.12, dramatic: 0.26 };

function Camera(props) {
  var t = useSpan(props.durationFrames);
  var eased = easeOutCubic(t);
  var amount = CAMERA_INTENSITY[props.intensity] || CAMERA_INTENSITY.moderate;
  var motion = props.motion || 'push-in';
  var scale = 1;
  var dx = 0;
  var dy = 0;
  var rotate = 0;
  if (motion === 'push-in') scale = 1 + amount * eased;
  if (motion === 'pull-back') scale = 1 + amount - amount * eased;
  if (motion === 'drift-left') { scale = 1 + amount * 0.5; dx = -amount * 420 * eased; }
  if (motion === 'drift-right') { scale = 1 + amount * 0.5; dx = amount * 420 * eased; }
  if (motion === 'orbit') {
    scale = 1 + amount * 0.6;
    dx = Math.sin(eased * Math.PI * 2) * amount * 220;
    dy = Math.cos(eased * Math.PI * 2) * amount * 120;
    rotate = Math.sin(eased * Math.PI * 2) * amount * 4;
  }
  return React.createElement(AbsoluteFill, {
    'data-ui-id': 'camera',
    style: {
      transform: 'translate(' + String(dx) + 'px,' + String(dy) + 'px) scale(' + String(scale)
        + ') rotate(' + String(rotate) + 'deg)',
      transformOrigin: 'center center',
    },
  }, props.children);
}

function Zoom(props) {
  var frame = useCurrentFrame();
  var cfg = useVideoConfig();
  var span = Math.max(1, cfg.durationInFrames);
  var from = Number(props.from);
  var to = Number(props.to);
  var start = isFinite(from) ? from : 1;
  var end = isFinite(to) ? to : 1;
  var t = props.easing === 'spring'
    ? spring({ frame: frame, fps: cfg.fps, config: { stiffness: 140, damping: 20 } })
    : applyEasing(props.easing, frame / span);
  var scale = start + (end - start) * clamp01(t);
  var origin = props.origin || { x: 50, y: 50 };
  return React.createElement(AbsoluteFill, {
    'data-ui-id': 'zoom',
    style: {
      transform: 'scale(' + String(scale) + ')',
      transformOrigin: String(Number(origin.x) || 50) + '% ' + String(Number(origin.y) || 50) + '%',
    },
  }, props.children);
}

function BlurMask(props) {
  var span = Math.max(1, Number(props.durationFrames) || 24);
  var p = easeOutCubic(useCurrentFrame() / span);
  var peak = Number(props.intensity);
  var max = isFinite(peak) ? Math.max(0, Math.min(20, peak)) : 12;
  var blur = props.animateIn === false ? max : max * (1 - p);
  return React.createElement(AbsoluteFill, {
    'data-ui-id': 'blur-mask',
    style: {
      filter: 'blur(' + String(blur) + 'px)',
      opacity: props.animateIn === false ? 1 : clamp01(0.35 + p * 0.65),
    },
  }, props.children);
}

function Morph(props) {
  var span = Math.max(1, Number(props.durationFrames) || 40);
  var p = easeOutCubic(useCurrentFrame() / span);
  var fromUrl = assetUrl(props.fromScreenshot);
  var toUrl = assetUrl(props.toScreenshot);
  var style = props.style || 'crossfade';
  var layer = function (url, handle, top) {
    var clip;
    var opacity = 1;
    var filter = 'none';
    if (style === 'crossfade') opacity = top ? clamp01(p) : 1;
    if (style === 'wipe' && top) clip = 'inset(0 ' + String((1 - p) * 100) + '% 0 0)';
    if (style === 'distort') {
      opacity = top ? clamp01(p) : 1;
      filter = 'blur(' + String((top ? 1 - p : p) * 16) + 'px) saturate('
        + String(1 + (top ? 1 - p : p) * 1.4) + ')';
    }
    return React.createElement('div', {
      style: { position: 'absolute', inset: 0, opacity: opacity, clipPath: clip, filter: filter },
    }, url
      ? React.createElement(Img, { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' } })
      : React.createElement(MissingAsset, { handle: handle }));
  };
  return React.createElement(Centered, { padding: '70px' },
    React.createElement('div', {
      'data-ui-id': 'morph',
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 50px 120px rgba(0,0,0,0.55)',
      },
    }, layer(fromUrl, props.fromScreenshot, false), layer(toUrl, props.toScreenshot, true)));
}

const PARTICLE_COUNT = { sparse: 28, medium: 70, dense: 150 };

function Particle(props) {
  var frame = useCurrentFrame();
  var count = PARTICLE_COUNT[props.density] || PARTICLE_COUNT.medium;
  var behavior = props.behavior || 'drift';
  var size = Number(props.size) || 4;
  var color = props.color || FILM_THEME.accent;
  var dots = [];
  for (var i = 0; i < count; i += 1) {
    var bx = hashAt(i, 1) * FRAME_W;
    var by = hashAt(i, 2) * FRAME_H;
    var speed = 0.35 + hashAt(i, 3) * 1.2;
    var x = bx;
    var y = by;
    var opacity = 0.25 + hashAt(i, 4) * 0.55;
    if (behavior === 'drift') {
      x = bx + Math.sin((frame + i * 9) / 55) * 40;
      y = by - frame * speed * 0.35;
      if (y < -20) y = FRAME_H + ((y + 20) % FRAME_H);
    }
    if (behavior === 'rain') {
      y = (by + frame * speed * 7) % (FRAME_H + 60) - 30;
    }
    if (behavior === 'explode') {
      var angle = hashAt(i, 5) * Math.PI * 2;
      var reach = easeOutCubic(frame / 45) * (260 + hashAt(i, 6) * 560);
      x = FRAME_W / 2 + Math.cos(angle) * reach;
      y = FRAME_H / 2 + Math.sin(angle) * reach;
      opacity = opacity * (1 - clamp01(frame / 60));
    }
    if (behavior === 'orbit') {
      var radius = 180 + hashAt(i, 7) * 420;
      var phase = hashAt(i, 8) * Math.PI * 2 + frame / 70;
      x = FRAME_W / 2 + Math.cos(phase) * radius;
      y = FRAME_H / 2 + Math.sin(phase) * radius * 0.52;
    }
    dots.push(React.createElement('span', {
      key: 'p' + String(i),
      style: {
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size,
        background: color,
        opacity: opacity,
      },
    }));
  }
  return React.createElement(AbsoluteFill, {
    'data-ui-id': 'particle',
    style: { pointerEvents: 'none' },
  }, dots);
}

// ── COMPOSITION ──────────────────────────────────────────

function SplitScreen(props) {
  var p = useSpringIn(0);
  var horizontal = (props.direction || 'horizontal') === 'horizontal';
  var ratio = props.ratio === undefined ? 0.5 : Math.max(0.1, Math.min(0.9, Number(props.ratio)));
  var gap = Number(props.gap) || 0;
  var kids = React.Children.toArray(props.children);
  var labelStyle = {
    position: 'absolute',
    bottom: 34,
    left: 36,
    padding: '8px 16px',
    borderRadius: 999,
    background: 'rgba(5,6,10,0.65)',
    border: '1px solid ' + FILM_THEME.border,
    fontFamily: FONT,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: FILM_THEME.text,
  };
  var pane = function (child, index, label) {
    var enter = clamp01(p);
    var slide = (1 - enter) * (index === 0 ? -80 : 80);
    return React.createElement('div', {
      key: 's' + String(index),
      style: {
        position: 'relative',
        flex: index === 0 ? ratio : 1 - ratio,
        overflow: 'hidden',
        opacity: enter,
        transform: horizontal
          ? 'translateX(' + String(slide) + 'px)'
          : 'translateY(' + String(slide) + 'px)',
      },
    }, child || null, label ? React.createElement('span', { style: labelStyle }, String(label)) : null);
  };
  return React.createElement(AbsoluteFill, {
    'data-ui-id': 'split-screen',
    style: { display: 'flex', flexDirection: horizontal ? 'row' : 'column', gap: gap },
  }, pane(kids[0], 0, props.labelLeft), pane(kids[1], 1, props.labelRight));
}

function FloatingUI(props) {
  var frame = useCurrentFrame();
  var p = useSpringIn(0);
  var mode = props.float || 'subtle';
  var amp = mode === 'drift' ? 30 : mode === 'breathing' ? 16 : 9;
  var bob = Math.sin(frame / (mode === 'breathing' ? 38 : 54)) * amp;
  var sway = mode === 'drift' ? Math.cos(frame / 72) * 24 : 0;
  var url = assetUrl(props.screenshot);
  return React.createElement(Centered, { padding: '110px 180px' },
    React.createElement('div', {
      'data-ui-id': 'floating-ui',
      style: {
        width: '100%',
        height: '100%',
        borderRadius: Number(props.cornerRadius) || 24,
        overflow: 'hidden',
        border: '1px solid ' + FILM_THEME.border,
        boxShadow: props.shadow === false ? 'none' : '0 70px 160px rgba(0,0,0,0.62)',
        opacity: clamp01(p),
        transform: 'translate(' + String(sway) + 'px,' + String(bob + (1 - clamp01(p)) * 60) + 'px)',
      },
    }, url
      ? React.createElement(Img, { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' } })
      : React.createElement(MissingAsset, { handle: props.screenshot })));
}

function Perspective(props) {
  var p = useSpringIn(0);
  var rx = Number(props.rotateX) || 0;
  var ry = Number(props.rotateY) || 0;
  var depth = Number(props.depth) || 1200;
  var settle = clamp01(p);
  return React.createElement(AbsoluteFill, {
    'data-ui-id': 'perspective',
    style: { perspective: String(depth) + 'px', perspectiveOrigin: 'center center' },
  }, React.createElement(AbsoluteFill, {
    style: {
      transform: 'rotateX(' + String(rx * settle) + 'deg) rotateY(' + String(ry * settle) + 'deg)',
      transformStyle: 'preserve-3d',
    },
  }, props.children));
}

function Grid(props) {
  var items = Array.isArray(props.items) ? props.items : [];
  var columns = Math.max(1, Math.min(6, Number(props.columns) || 3));
  var gap = Number(props.gap) || 26;
  var stagger = props.animateIn !== 'simultaneous';
  var frame = useCurrentFrame();
  var fps = useVideoConfig().fps;
  return React.createElement(Centered, { padding: '90px 130px' },
    React.createElement('div', {
      'data-ui-id': 'grid',
      style: {
        width: '100%',
        height: '100%',
        display: 'grid',
        gridTemplateColumns: 'repeat(' + String(columns) + ', 1fr)',
        gap: gap,
      },
    }, items.map(function (handle, index) {
      var enter = springAt(frame, fps, stagger ? index * 5 : 0);
      var url = assetUrl(handle);
      return React.createElement('div', {
        key: 'g' + String(index),
        style: {
          borderRadius: 16,
          overflow: 'hidden',
          border: '1px solid ' + FILM_THEME.border,
          opacity: clamp01(enter),
          transform: 'translateY(' + String((1 - clamp01(enter)) * 34) + 'px)',
        },
      }, url
        ? React.createElement(Img, { src: url, style: { width: '100%', height: '100%', objectFit: 'cover' } })
        : React.createElement(MissingAsset, { handle: handle }));
    })));
}

function FullBleed(props) {
  var url = assetUrl(props.screenshot);
  var blur = Number(props.blur) || 0;
  return React.createElement(AbsoluteFill, { 'data-ui-id': 'full-bleed' },
    url
      ? React.createElement(Img, {
        src: url,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: blur ? 'blur(' + String(blur) + 'px)' : 'none',
          transform: blur ? 'scale(1.06)' : 'none',
        },
      })
      : React.createElement(MissingAsset, { handle: props.screenshot }),
    props.overlay
      ? React.createElement(AbsoluteFill, { style: { background: String(props.overlay) } })
      : null);
}

// ── STAGE ──────────────────────────────────────────────
// Every scene sits on the film's own background so a layer that draws nothing
// still lands on brand instead of on black.
function Stage(props) {
  return React.createElement(AbsoluteFill, {
    'data-ui-id': 'stage',
    style: { background: props.background || FILM_THEME.bg },
  }, props.children);
}
`;

/** Names the runtime defines, so the compile gate knows what the film may call. */
export const RUNTIME_GLOBALS = [
  'Stage', 'Centered', 'MissingAsset', 'assetUrl', 'resolveAsset', 'hasAsset',
  'FILM_THEME', 'ASSET_MAP', 'FONT', 'MONO', 'FRAME_W', 'FRAME_H',
  'clamp01', 'easeOutCubic', 'easeInCubic', 'applyEasing', 'pctX', 'pctY',
  'justifyFor', 'hashAt', 'useEnter', 'useSpringIn', 'useSpan', 'springAt',
];

/** The Remotion names the bundle imports once, at the top. */
export const REMOTION_IMPORTS = [
  'AbsoluteFill', 'Audio', 'Img', 'Sequence', 'Series',
  'interpolate', 'spring', 'useCurrentFrame', 'useVideoConfig',
];
