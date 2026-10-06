// filmSource — THE launch film. One composition, two mounts.
//
// WHY THIS IS A STRING AND NOT A .tsx MODULE: the film has to run in two
// places that cannot share a module — the in-app Remotion <Player> (compiled
// in a sandboxed iframe) and the platform render service (POST
// /api/render/remotion, which takes `compositionTsx` as source text). Shipping
// it once as source is the only way to guarantee the MP4 is the thing the
// creator approved in the preview. Keep it dependency-free: it may import only
// 'react' and 'remotion'.
//
// IT CONTAINS NO CONTENT. Every word, colour, duration and image comes in as a
// prop built from the creator's intake and the Claude Opus 5 script. Mounted
// with empty props it renders an empty film, which is the correct behaviour —
// there is nothing to fall back to because there is no template.
//
// Authoring rules for this literal: no backticks, no dollar-brace, and no
// backslashes (they would be eaten by the template literal before the render
// service ever sees them) — so strings are concatenated and there are no
// regular expressions below.

export const LAUNCH_FILM_TSX = `
import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const FONT_STACK = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Motion blur: every animated word is drawn four times along its own sub-frame
// path, each copy further back in time, blurrier and fainter. The trail is
// dropped the moment the word settles, so held type stays razor sharp.
const SUBFRAMES = 4;

function hueFromText(text) {
  var value = String(text || 'launch');
  var hash = 0;
  for (var i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 360;
  return hash;
}

function hslToRgb(h, s, l) {
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var hp = ((h % 360) + 360) % 360 / 60;
  var x = c * (1 - Math.abs((hp % 2) - 1));
  var r = 0;
  var g = 0;
  var b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  var m = l - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// The accent is the colour Opus picked for this product. When it hands back
// something unreadable the hue is derived from the product's own name, so the
// film still has an identity of its own rather than a house default.
function toRgb(color, seed) {
  var raw = String(color || '').trim();
  var hex = raw.charAt(0) === '#' ? raw.slice(1) : raw;
  var valid = hex.length === 6;
  for (var i = 0; i < hex.length && valid; i += 1) {
    var ch = hex.charAt(i).toLowerCase();
    var isDigit = ch >= '0' && ch <= '9';
    var isHexLetter = ch >= 'a' && ch <= 'f';
    if (!isDigit && !isHexLetter) valid = false;
  }
  if (valid) {
    var n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  return hslToRgb(hueFromText(seed), 0.8, 0.58);
}

function rgba(c, a) {
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}

function paletteFor(tone, accent) {
  var key = String(tone || 'cinematic').toLowerCase();
  if (key === 'minimal') {
    return {
      bg: '#F4F5F7',
      glow: rgba(accent, 0.2),
      text: '#0A0C11',
      muted: 'rgba(10,12,17,0.55)',
      panel: 'rgba(255,255,255,0.88)',
      border: 'rgba(10,12,17,0.1)',
      shadow: 'rgba(10,12,17,0.14)',
    };
  }
  if (key === 'professional') {
    return {
      bg: '#0D1320',
      glow: rgba(accent, 0.3),
      text: '#F3F6FB',
      muted: 'rgba(243,246,251,0.6)',
      panel: 'rgba(255,255,255,0.05)',
      border: 'rgba(255,255,255,0.1)',
      shadow: 'rgba(0,0,0,0.5)',
    };
  }
  if (key === 'energetic') {
    return {
      bg: '#07070C',
      glow: rgba(accent, 0.5),
      text: '#FFFFFF',
      muted: 'rgba(255,255,255,0.68)',
      panel: 'rgba(255,255,255,0.07)',
      border: rgba(accent, 0.35),
      shadow: 'rgba(0,0,0,0.6)',
    };
  }
  return {
    bg: '#05060A',
    glow: rgba(accent, 0.36),
    text: '#F7F8FB',
    muted: 'rgba(247,248,251,0.62)',
    panel: 'rgba(255,255,255,0.05)',
    border: 'rgba(255,255,255,0.09)',
    shadow: 'rgba(0,0,0,0.55)',
  };
}

// A word wrapped in stars is an accent word. Opus is told to mark the one or
// two words a line turns on; everything else inherits the body colour.
function parseWord(raw) {
  var text = String(raw);
  var emphasised = text.indexOf('*') >= 0;
  return { text: text.split('*').join(''), emphasised: emphasised };
}

function splitWords(line) {
  var parts = String(line || '').split(' ');
  var out = [];
  for (var i = 0; i < parts.length; i += 1) {
    if (parts[i].length > 0) out.push(parts[i]);
  }
  return out;
}

var PRODUCT_WORDS = [
  'dashboard', 'screenshot', 'ui', 'interface', 'app', 'screen', 'screens',
  'mockup', 'demo', 'device', 'browser', 'website', 'site', 'software', 'platform',
];

function letterStream(text) {
  var lower = String(text || '').toLowerCase();
  var out = '';
  for (var i = 0; i < lower.length; i += 1) {
    var ch = lower.charAt(i);
    out += (ch >= 'a' && ch <= 'z') ? ch : ' ';
  }
  return ' ' + out + ' ';
}

function mentionsProduct(text) {
  var haystack = letterStream(text);
  for (var i = 0; i < PRODUCT_WORDS.length; i += 1) {
    if (haystack.indexOf(' ' + PRODUCT_WORDS[i] + ' ') >= 0) return true;
  }
  return false;
}

function Backdrop(props) {
  var frame = useCurrentFrame();
  var config = useVideoConfig();
  var palette = props.palette;
  var seed = props.seed || 0;
  var t = frame / config.fps;
  var ax = 50 + Math.sin(t * 0.33 + seed) * 15;
  var ay = 30 + Math.cos(t * 0.27 + seed) * 11;
  var bx = 50 + Math.cos(t * 0.21 + seed * 1.7) * 21;
  var by = 74 + Math.sin(t * 0.19 + seed * 1.3) * 13;
  var layers = 'radial-gradient(ellipse 72% 58% at ' + ax.toFixed(2) + '% ' + ay.toFixed(2) + '%, '
    + palette.glow + ' 0%, transparent 64%), '
    + 'radial-gradient(ellipse 64% 52% at ' + bx.toFixed(2) + '% ' + by.toFixed(2) + '%, '
    + palette.glow + ' 0%, transparent 60%)';
  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg }}>
      <AbsoluteFill style={{ background: layers }} />
      <AbsoluteFill
        style={{
          background: 'repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, rgba(0,0,0,0) 0% 50%)',
          backgroundSize: '5px 5px',
          opacity: 0.55,
        }}
      />
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse 85% 70% at 50% 50%, rgba(0,0,0,0) 45%, ' + palette.shadow + ' 100%)',
        }}
      />
    </AbsoluteFill>
  );
}

function TrailWord(props) {
  var frame = useCurrentFrame();
  var config = useVideoConfig();
  var local = frame - props.delay;
  var size = props.size;
  var copies = [];
  for (var s = SUBFRAMES - 1; s >= 0; s -= 1) {
    var sampled = Math.max(0, local - s * 0.25);
    var progress = spring({
      frame: sampled,
      fps: config.fps,
      config: { stiffness: 200, damping: 20 },
    });
    var settled = progress > 0.985;
    if (s > 0 && (settled || local < 0)) continue;
    var shift = (1 - progress) * size * 0.52;
    var alpha = local < 0 ? 0 : Math.min(1, Math.max(0, progress));
    copies.push(
      <span
        key={'s' + s}
        style={{
          position: s === 0 ? 'relative' : 'absolute',
          left: 0,
          top: 0,
          display: 'inline-block',
          whiteSpace: 'pre',
          transform: 'translateY(' + shift.toFixed(2) + 'px)',
          opacity: s === 0 ? alpha : alpha * (0.2 / s),
          filter: s === 0 ? 'none' : 'blur(' + (s * 1.6).toFixed(1) + 'px)',
          color: props.color,
        }}
      >
        {props.text}
      </span>,
    );
  }
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        fontSize: size,
        fontWeight: props.weight,
        lineHeight: 1.06,
        letterSpacing: '-0.025em',
      }}
    >
      {copies}
    </span>
  );
}

function WordReveal(props) {
  var config = useVideoConfig();
  var lines = Array.isArray(props.lines) ? props.lines : [];
  var stagger = Math.max(2, Math.round(config.fps / 15));
  var size = props.size;
  var counter = 0;
  var centred = props.align === 'center';
  return (
    <div
      data-ui-id={props.uiId || 'WordReveal'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: Math.round(size * 0.16),
        alignItems: centred ? 'center' : 'flex-start',
        width: '100%',
      }}
    >
      {lines.map(function renderLine(line, lineIndex) {
        var words = splitWords(line);
        return (
          <div
            key={'l' + lineIndex}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: centred ? 'center' : 'flex-start',
              columnGap: Math.round(size * 0.26),
              rowGap: Math.round(size * 0.1),
            }}
          >
            {words.map(function renderWord(raw, wordIndex) {
              var parsed = parseWord(raw);
              var delay = props.startFrame + counter * stagger;
              counter += 1;
              return (
                <TrailWord
                  key={'w' + lineIndex + '-' + wordIndex}
                  text={parsed.text}
                  delay={delay}
                  size={size}
                  weight={props.weight || 800}
                  color={parsed.emphasised ? props.accentColor : props.color}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function FeatureCard(props) {
  var frame = useCurrentFrame();
  var config = useVideoConfig();
  var local = Math.max(0, frame - props.startFrame);
  var rise = spring({ frame: local, fps: config.fps, config: { stiffness: 150, damping: 22 } });
  if (!props.text) return null;
  return (
    <div
      data-ui-id="FeatureCard"
      style={{
        marginTop: 34,
        padding: '22px 34px',
        borderRadius: 18,
        background: props.palette.panel,
        border: '1px solid ' + props.palette.border,
        color: props.palette.muted,
        fontSize: 40,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        maxWidth: 1180,
        textAlign: props.align === 'center' ? 'center' : 'left',
        opacity: rise,
        transform: 'translateY(' + ((1 - rise) * 26).toFixed(2) + 'px)',
      }}
    >
      {props.text}
    </div>
  );
}

function ProductShot(props) {
  var frame = useCurrentFrame();
  var config = useVideoConfig();
  var local = Math.max(0, frame - props.startFrame);
  var slideFrames = Math.max(1, Math.round(config.fps / 1.5));
  var slide = interpolate(local, [0, slideFrames], [200, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  var fade = interpolate(local, [0, Math.max(1, Math.round(config.fps / 4))], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  var float = Math.sin((local / config.fps) * 0.9) * 5;
  var tilt = interpolate(local, [0, slideFrames], [5, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      data-ui-id="ProductShot"
      style={{
        width: '100%',
        maxWidth: 1180,
        borderRadius: 16,
        overflow: 'hidden',
        border: '1px solid ' + props.palette.border,
        boxShadow: '0 50px 120px ' + props.palette.shadow + ', 0 0 0 1px rgba(255,255,255,0.04)',
        background: props.palette.panel,
        opacity: fade,
        transform: 'perspective(1800px) translateX(' + slide.toFixed(2) + 'px) translateY('
          + float.toFixed(2) + 'px) rotateY(' + tilt.toFixed(2) + 'deg)',
      }}
    >
      <div
        data-ui-id="Navbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 18px',
          background: 'rgba(0,0,0,0.35)',
          borderBottom: '1px solid ' + props.palette.border,
        }}
      >
        <span style={{ width: 11, height: 11, borderRadius: 6, background: 'rgba(255,255,255,0.22)' }} />
        <span style={{ width: 11, height: 11, borderRadius: 6, background: 'rgba(255,255,255,0.22)' }} />
        <span style={{ width: 11, height: 11, borderRadius: 6, background: props.accentColor }} />
        <span
          style={{
            marginLeft: 16,
            fontSize: 20,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.72)',
            letterSpacing: '-0.01em',
          }}
        >
          {props.label}
        </span>
      </div>
      {/* A product page is far taller than the frame, so the shot is cropped
          to its top rather than letting a long screenshot dictate the layout. */}
      <Img
        src={props.src}
        style={{
          display: 'block',
          width: '100%',
          height: 470,
          objectFit: 'cover',
          objectPosition: 'top center',
        }}
      />
    </div>
  );
}

function CTAButton(props) {
  var frame = useCurrentFrame();
  var config = useVideoConfig();
  var local = Math.max(0, frame - props.startFrame);
  var pop = spring({ frame: local, fps: config.fps, config: { stiffness: 190, damping: 18 } });
  if (!props.text) return null;
  return (
    <div
      data-ui-id="CTAButton"
      style={{
        marginTop: 30,
        padding: '18px 40px',
        borderRadius: 999,
        background: props.accentColor,
        color: '#07070C',
        fontSize: 32,
        fontWeight: 800,
        letterSpacing: '-0.015em',
        opacity: pop,
        transform: 'scale(' + (0.86 + pop * 0.14).toFixed(3) + ')',
        boxShadow: '0 24px 70px ' + props.glow,
      }}
    >
      {props.text}
    </div>
  );
}

function transitionStyle(transition, local, fps) {
  if (transition === 'crossfade') {
    var cf = Math.max(1, Math.round(0.34 * fps));
    return {
      opacity: interpolate(local, [0, cf], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    };
  }
  if (transition === 'whip') {
    var wf = Math.max(1, Math.round(0.18 * fps));
    var away = interpolate(local, [0, wf], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return {
      opacity: interpolate(local, [0, wf], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      transform: 'translateX(' + (away * 160).toFixed(2) + 'px)',
      filter: 'blur(' + (away * 18).toFixed(2) + 'px)',
    };
  }
  return {};
}

function FlashLayer(props) {
  var frame = useCurrentFrame();
  var config = useVideoConfig();
  var span = Math.max(2, Math.round(config.fps * 0.07));
  var alpha = interpolate(frame, [0, span], [0.9, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (alpha <= 0.001) return null;
  return <AbsoluteFill style={{ background: '#FFFFFF', opacity: alpha }} />;
}

function SceneView(props) {
  var frame = useCurrentFrame();
  var config = useVideoConfig();
  var scene = props.scene;
  var palette = props.palette;
  var accentColor = rgba(props.accent, 1);
  var duration = Math.max(1, props.durationInFrames);
  var push = interpolate(frame, [0, duration], [1, 1.055], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  var enter = transitionStyle(scene.transitionType, frame, config.fps);
  var withShot = Boolean(props.screenshotUrl)
    && mentionsProduct(String(scene.visualDirection || '') + ' ' + String(scene.headline || ''));
  var headlineLines = scene.headline ? [scene.headline] : [];
  var kinetic = Array.isArray(scene.wordRevealLines) ? scene.wordRevealLines : [];
  var headlineSize = withShot ? 58 : (props.isHero ? 116 : 104);
  var kineticSize = withShot ? 34 : 76;
  var headlineWords = splitWords(scene.headline).length;
  var stagger = Math.max(2, Math.round(config.fps / 15));
  var kineticStart = Math.round(config.fps * 0.18) + headlineWords * stagger;

  return (
    <AbsoluteFill style={enter}>
      <Backdrop palette={palette} seed={props.index * 1.7} />
      <AbsoluteFill
        style={{
          padding: withShot ? '52px 110px' : '90px 140px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: withShot ? 'center' : 'flex-start',
          justifyContent: 'center',
          overflow: 'hidden',
          fontFamily: FONT_STACK,
          transform: 'scale(' + push.toFixed(4) + ')',
        }}
      >
        <div
          data-ui-id={props.isHero ? 'Hero' : 'SceneTitle'}
          style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: withShot ? 'center' : 'flex-start' }}
        >
          {headlineLines.length ? (
            <WordReveal
              uiId="SceneTitle"
              lines={headlineLines}
              startFrame={0}
              size={headlineSize}
              weight={850}
              color={palette.text}
              accentColor={accentColor}
              align={withShot ? 'center' : 'left'}
            />
          ) : null}

          {kinetic.length ? (
            <div style={{ marginTop: withShot ? 18 : 30, width: '100%' }}>
              <WordReveal
                uiId="WordReveal"
                lines={kinetic}
                startFrame={kineticStart}
                size={kineticSize}
                weight={700}
                color={palette.text}
                accentColor={accentColor}
                align={withShot ? 'center' : 'left'}
              />
            </div>
          ) : null}

          {withShot ? (
            <div style={{ marginTop: 26, width: '100%', display: 'flex', justifyContent: 'center' }}>
              <ProductShot
                src={props.screenshotUrl}
                startFrame={Math.round(config.fps * 0.3)}
                palette={palette}
                accentColor={accentColor}
                label={props.productName}
              />
            </div>
          ) : (
            <FeatureCard
              text={scene.subtext}
              startFrame={kineticStart + Math.round(config.fps * 0.3)}
              palette={palette}
              align="left"
            />
          )}

          {props.isFinalScene && props.cta ? (
            <CTAButton
              text={props.cta}
              startFrame={kineticStart + Math.round(config.fps * 0.5)}
              accentColor={accentColor}
              glow={rgba(props.accent, 0.45)}
            />
          ) : null}
        </div>
      </AbsoluteFill>
      {scene.transitionType === 'flash' ? <FlashLayer /> : null}
    </AbsoluteFill>
  );
}

function OutroCard(props) {
  var frame = useCurrentFrame();
  var config = useVideoConfig();
  var accentColor = rgba(props.accent, 1);
  var grow = spring({ frame: frame, fps: config.fps, config: { stiffness: 120, damping: 24 } });
  var scale = 0.8 + grow * 0.2;
  var taglineStart = Math.round(config.fps * 0.55);
  var taglineFade = interpolate(frame, [taglineStart, taglineStart + Math.round(config.fps * 0.6)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  var ruleStart = Math.round(config.fps * 0.35);
  var ruleWidth = interpolate(frame, [ruleStart, ruleStart + Math.round(config.fps * 0.8)], [0, 360], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  var fadeIn = interpolate(frame, [0, Math.max(1, Math.round(config.fps * 0.34))], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a', opacity: fadeIn }}>
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 50%, ' + rgba(props.accent, 0.22) + ' 0%, rgba(0,0,0,0) 65%)',
        }}
      />
      <AbsoluteFill
        data-ui-id="OutroCard"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT_STACK,
          textAlign: 'center',
          padding: '0 140px',
        }}
      >
        <div
          style={{
            fontSize: 132,
            fontWeight: 850,
            letterSpacing: '-0.035em',
            color: '#FFFFFF',
            transform: 'scale(' + scale.toFixed(4) + ')',
          }}
        >
          {props.productName}
        </div>
        <div
          style={{
            height: 3,
            width: ruleWidth.toFixed(1) + 'px',
            marginTop: 26,
            borderRadius: 2,
            background: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, ' + accentColor + ' 50%, rgba(0,0,0,0) 100%)',
          }}
        />
        <div
          style={{
            marginTop: 30,
            fontSize: 42,
            fontWeight: 500,
            letterSpacing: '-0.015em',
            color: 'rgba(255,255,255,0.74)',
            opacity: taglineFade,
            maxWidth: 1320,
          }}
        >
          {props.tagline}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export default function LaunchFilm(props) {
  var scenes = Array.isArray(props.scenes) ? props.scenes : [];
  var timing = props.timing || { scenes: [], outro: { from: 0, durationInFrames: 1 }, totalFrames: 1 };
  var planned = Array.isArray(timing.scenes) ? timing.scenes : [];
  var accent = toRgb(props.brandColor, props.productName || props.title);
  var palette = paletteFor(props.tone, accent);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, fontFamily: FONT_STACK }}>
      {props.audioUrl ? <Audio src={props.audioUrl} volume={0.65} /> : null}

      {scenes.map(function renderScene(scene, index) {
        var slot = planned[index];
        if (!slot) return null;
        return (
          <Sequence key={'scene' + index} from={slot.from} durationInFrames={slot.durationInFrames}>
            <SceneView
              scene={scene}
              index={index}
              isHero={index === 0}
              isFinalScene={index === scenes.length - 1}
              durationInFrames={slot.durationInFrames}
              palette={palette}
              accent={accent}
              screenshotUrl={props.screenshotUrl}
              productName={props.productName}
              cta={props.cta}
            />
          </Sequence>
        );
      })}

      <Sequence from={timing.outro.from} durationInFrames={timing.outro.durationInFrames}>
        <OutroCard productName={props.productName} tagline={props.cta} accent={accent} />
      </Sequence>
    </AbsoluteFill>
  );
}
`;
