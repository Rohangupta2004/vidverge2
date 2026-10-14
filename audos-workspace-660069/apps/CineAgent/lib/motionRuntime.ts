// CineAgent — the Remotion composition runtime, as source text. DESIGN V2.
//
// This string is submitted to POST /api/render/remotion as compositionTsx and
// compiled SERVER-SIDE, so it must be fully self-contained: it imports only
// 'react' and 'remotion', and reads everything else off `props`. No
// model-generated code ever enters the render path — Claude authors JSON,
// this runtime interprets it.
//
// V2 raises the craft to a premium-launch-film bar: a real type hierarchy
// (eyebrow / display / support), glass panels with layered shadows, gradient
// accents derived from the plan's identity, a cinematic grade + vignette over
// footage, readability scrims under center graphics, slow push-in on long
// shots, per-word settle animations with blur, and refined caption presets.
//
// IMPORTANT: keep this template literal free of backticks and dollar-brace
// sequences — it is shipped verbatim.

export const MOTION_RUNTIME_TSX = `
import React from 'react';
import {
  AbsoluteFill, Sequence, OffthreadVideo, Audio, Img,
  useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
} from 'remotion';

// ---------- helpers ----------

const clamp01 = (n) => Math.max(0, Math.min(1, n));

const FONT_STACKS = {
  modern: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  editorial: "Georgia, 'Times New Roman', serif",
  bold: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
  elegant: "'Playfair Display', Didot, Georgia, serif",
};

function fontFor(identity) {
  return FONT_STACKS[identity && identity.fontStyle] || FONT_STACKS.modern;
}

/** Derived design tokens — every primitive drinks from this one well. */
function themeOf(identity) {
  return {
    grad: 'linear-gradient(135deg, ' + identity.primary + ' 0%, ' + identity.accent + ' 100%)',
    glass: {
      background: 'linear-gradient(165deg, rgba(17,14,7,0.90) 0%, rgba(13,11,5,0.82) 100%)',
      border: '1px solid rgba(255,255,255,0.10)',
      boxShadow: '0 32px 90px rgba(0,0,0,0.55), 0 4px 18px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.07)',
      backdropFilter: 'blur(16px)',
    },
    eyebrow: {
      fontSize: 21,
      fontWeight: 700,
      letterSpacing: '0.30em',
      textTransform: 'uppercase',
      color: identity.accent,
    },
    displayShadow: '0 2px 10px rgba(0,0,0,0.45), 0 14px 50px rgba(0,0,0,0.55)',
    radius: 24,
  };
}

function GradText({ theme, style, children }) {
  return (
    <span style={{
      backgroundImage: theme.grad,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      color: 'transparent',
      ...style,
    }}>{children}</span>
  );
}

function easeFn(name) {
  if (name === 'linear') return (t) => t;
  if (name === 'inOut') return Easing.inOut(Easing.cubic);
  return Easing.out(Easing.cubic);
}

function segDuration(seg) {
  if (seg.kind === 'source' && seg.src) return Math.max(0.2, seg.src.end - seg.src.start);
  return Math.max(0.5, Number(seg.duration || 4));
}

function segmentFrames(plan, fps) {
  const out = [];
  let cursor = 0;
  (plan.timeline || []).forEach((seg) => {
    const frames = Math.max(6, Math.round(segDuration(seg) * fps));
    out.push({ seg, from: cursor, frames });
    cursor += frames;
  });
  return { list: out, total: cursor };
}

// ---------- entrance/exit wrapper ----------

function InOut({ children, durationFrames, inFrames, outFrames, style }) {
  const frame = useCurrentFrame();
  const fIn = Math.max(1, inFrames || 11);
  const fOut = Math.max(1, outFrames || 9);
  const opacity = interpolate(
    frame,
    [0, fIn, Math.max(fIn + 1, durationFrames - fOut), durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const rise = interpolate(frame, [0, fIn], [18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const settle = interpolate(frame, [0, fIn], [0.975, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ opacity, transform: 'translateY(' + rise + 'px) scale(' + settle + ')', ...style }}>
      {children}
    </div>
  );
}

// ---------- motion primitives (V2 design system) ----------

function KineticTitle({ spec, identity, theme, durationFrames, stageW = 1920 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = String(spec.text || '').split(/\\s+/).filter(Boolean);
  const sizes = { sm: 48, md: 70, lg: 100, xl: 138 };
  const fontSize = sizes[spec.size] || 100;
  const styleName = spec.style || 'rise';
  const perWord = Math.max(2, Math.min(7, Math.floor((durationFrames * 0.42) / Math.max(1, words.length))));
  const exitStart = Math.max(10, durationFrames - 10);
  const exitOpacity = interpolate(frame, [exitStart, durationFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exitRise = interpolate(frame, [exitStart, durationFrames], [0, -16], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const barGrow = interpolate(frame, [words.length * perWord + 2, words.length * perWord + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ textAlign: 'center', opacity: exitOpacity, transform: 'translateY(' + exitRise + 'px)' }}>
      {spec.subtext ? (
        <div style={{
          ...theme.eyebrow,
          marginBottom: 26,
          opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}>{spec.subtext}</div>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.26em', maxWidth: Math.min(1540, stageW - 100), margin: '0 auto' }}>
        {words.map((w, i) => {
          const start = i * perWord;
          const p = spring({ frame: frame - start, fps, config: { damping: 17, mass: 0.7, stiffness: 150 } });
          let transform = 'translateY(' + (1 - p) * 70 + 'px)';
          let opacity = p;
          let filter = p < 0.98 ? 'blur(' + (1 - p) * 10 + 'px)' : 'none';
          if (styleName === 'split') {
            transform = 'translateX(' + (i % 2 === 0 ? -1 : 1) * (1 - p) * 130 + 'px)';
          } else if (styleName === 'assemble') {
            const angle = ((i * 47) % 360) * (Math.PI / 180);
            transform = 'translate(' + Math.cos(angle) * (1 - p) * 240 + 'px,' + Math.sin(angle) * (1 - p) * 170 + 'px) scale(' + (0.5 + p * 0.5) + ')';
          } else if (styleName === 'typeOn') {
            opacity = frame >= start ? 1 : 0;
            transform = 'none';
            filter = 'none';
          } else if (styleName === 'blur') {
            filter = 'blur(' + (1 - p) * 16 + 'px)';
            transform = 'scale(' + (1.18 - p * 0.18) + ')';
          } else if (styleName === 'punch') {
            transform = 'scale(' + (p < 1 ? 1.65 - p * 0.65 : 1) + ')';
            filter = 'none';
          }
          const emphasized = words.length > 2 && i === words.length - 1;
          const wordStyle = {
            display: 'inline-block', fontSize, fontWeight: 840,
            letterSpacing: '-0.025em', lineHeight: 1.04, opacity, transform, filter,
            textShadow: theme.displayShadow,
          };
          return emphasized ? (
            <span key={i} style={{ ...wordStyle, textShadow: 'none' }}>
              <GradText theme={theme}>{w}</GradText>
            </span>
          ) : (
            <span key={i} style={{ ...wordStyle, color: identity.text }}>{w}</span>
          );
        })}
      </div>
      <div style={{ width: 240 * barGrow, height: 5, borderRadius: 3, backgroundImage: theme.grad, margin: '30px auto 0', opacity: barGrow }} />
    </div>
  );
}

function LowerThird({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 19, stiffness: 140 } });
  const exit = interpolate(frame, [durationFrames - 10, durationFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const lineGrow = interpolate(frame, [5, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ transform: 'translateX(' + ((1 - p) * -70 - exit * 50) + 'px)', opacity: p * (1 - exit), display: 'inline-block' }}>
      <div style={{ ...theme.glass, borderRadius: 18, overflow: 'hidden', display: 'flex', alignItems: 'stretch' }}>
        <div style={{ width: 7, backgroundImage: theme.grad, transform: 'scaleY(' + lineGrow + ')', transformOrigin: 'top' }} />
        <div style={{ padding: '20px 34px 20px 28px' }}>
          {spec.subtitle ? (
            <div style={{ ...theme.eyebrow, fontSize: 17, marginBottom: 7, opacity: Math.min(1, p * 1.4) }}>{spec.subtitle}</div>
          ) : null}
          <div style={{ fontSize: 42, fontWeight: 780, color: identity.text, lineHeight: 1.08, letterSpacing: '-0.01em' }}>{spec.title}</div>
        </div>
      </div>
    </div>
  );
}

function Callout({ spec, identity, theme, durationFrames, stageW = 1920, stageH = 1080 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 16, stiffness: 170 } });
  const hasPointer = spec.pointerTo && typeof spec.pointerTo.x === 'number';
  const lineLen = interpolate(frame, [6, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const pulse = 1 + Math.sin(frame / 7) * 0.12;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {hasPointer ? (
        <svg width={stageW} height={stageH} style={{ position: 'absolute', inset: 0 }}>
          <line
            x1={spec.x * (stageW / 100)} y1={spec.y * (stageH / 100)}
            x2={spec.x * (stageW / 100) + (spec.pointerTo.x - spec.x) * (stageW / 100) * lineLen}
            y2={spec.y * (stageH / 100) + (spec.pointerTo.y - spec.y) * (stageH / 100) * lineLen}
            stroke={identity.accent} strokeWidth="3.5" strokeLinecap="round" strokeDasharray="2 10" />
          <circle
            cx={spec.x * (stageW / 100) + (spec.pointerTo.x - spec.x) * (stageW / 100) * lineLen}
            cy={spec.y * (stageH / 100) + (spec.pointerTo.y - spec.y) * (stageH / 100) * lineLen}
            r={9 * lineLen * pulse} fill="none" stroke={identity.accent} strokeWidth="3" />
          <circle
            cx={spec.x * (stageW / 100) + (spec.pointerTo.x - spec.x) * (stageW / 100) * lineLen}
            cy={spec.y * (stageH / 100) + (spec.pointerTo.y - spec.y) * (stageH / 100) * lineLen}
            r={3.5 * lineLen} fill={identity.accent} />
        </svg>
      ) : null}
      <div style={{
        position: 'absolute', left: spec.x + '%', top: spec.y + '%',
        transform: 'translate(-50%, -112%) scale(' + p + ')', opacity: p,
        ...theme.glass, borderRadius: 16, padding: '16px 24px', maxWidth: 560,
        borderLeft: '4px solid ' + identity.accent,
      }}>
        <div style={{ fontSize: 29, fontWeight: 640, color: identity.text, lineHeight: 1.3 }}>{spec.text}</div>
      </div>
    </AbsoluteFill>
  );
}

function formatStat(n, decimals) {
  const parts = n.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return parts.join('.');
}

function StatCounter({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 26, stiffness: 55 } });
  const target = Number(spec.value || 0);
  const decimals = Math.abs(target) < 10 && target !== Math.round(target) ? 1 : 0;
  const shown = formatStat(target * Math.min(1, p), decimals);
  const scale = 0.88 + Math.min(1, p) * 0.12;
  return (
    <InOut durationFrames={durationFrames} inFrames={9} outFrames={9}>
      <div style={{ textAlign: 'center', transform: 'scale(' + scale + ')' }}>
        <div style={{ fontSize: 172, fontWeight: 870, lineHeight: 1, letterSpacing: '-0.035em' }}>
          <GradText theme={theme}>{(spec.prefix || '') + shown + (spec.suffix || '')}</GradText>
        </div>
        <div style={{ width: 84, height: 4, borderRadius: 2, backgroundImage: theme.grad, margin: '26px auto 18px', opacity: Math.min(1, p * 1.3) }} />
        <div style={{ ...theme.eyebrow, fontSize: 24 }}>{spec.label}</div>
      </div>
    </InOut>
  );
}

function BarChart({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const items = spec.items || [];
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <InOut durationFrames={durationFrames} inFrames={9} outFrames={9}>
      <div style={{ ...theme.glass, borderRadius: theme.radius, padding: '40px 50px', minWidth: 820 }}>
        {spec.title ? (
          <div style={{ marginBottom: 30 }}>
            <div style={{ ...theme.eyebrow, fontSize: 16, marginBottom: 8 }}>By the numbers</div>
            <div style={{ fontSize: 36, fontWeight: 780, color: identity.text, letterSpacing: '-0.01em' }}>{spec.title}</div>
          </div>
        ) : null}
        {items.map((item, i) => {
          const grow = interpolate(frame, [8 + i * 6, 30 + i * 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ width: 210, fontSize: 24, fontWeight: 560, color: identity.text, opacity: 0.88, paddingRight: 20, textAlign: 'right' }}>{item.label}</div>
              <div style={{ flex: 1, height: 30, background: 'rgba(255,255,255,0.07)', borderRadius: 15, overflow: 'hidden' }}>
                <div style={{
                  width: Math.max(2, (Math.abs(item.value) / max) * 100 * grow) + '%', height: '100%',
                  backgroundImage: i === 0 ? theme.grad : 'none',
                  background: i === 0 ? undefined : 'rgba(255,255,255,0.22)',
                  borderRadius: 15,
                }} />
              </div>
              <div style={{ width: 140, fontSize: 26, fontWeight: 800, color: i === 0 ? identity.accent : identity.text, paddingLeft: 18, opacity: grow }}>
                {item.value + (spec.unit || '')}
              </div>
            </div>
          );
        })}
      </div>
    </InOut>
  );
}

function ListReveal({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = spec.items || [];
  return (
    <InOut durationFrames={durationFrames} inFrames={9} outFrames={9}>
      <div style={{ ...theme.glass, borderRadius: theme.radius, padding: '40px 52px', minWidth: 680, maxWidth: 1040 }}>
        {spec.title ? (
          <div style={{ fontSize: 38, fontWeight: 790, color: identity.text, marginBottom: 28, letterSpacing: '-0.01em' }}>{spec.title}</div>
        ) : null}
        {items.map((item, i) => {
          const p = spring({ frame: frame - 7 - i * 7, fps, config: { damping: 18, stiffness: 160 } });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: i === items.length - 1 ? 0 : 20, opacity: p, transform: 'translateX(' + (1 - p) * 46 + 'px)' }}>
              <div style={{
                width: 38, height: 38, borderRadius: 12, backgroundImage: theme.grad, marginRight: 22, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 19, fontWeight: 840, color: '#0D0B05',
              }}>{i + 1}</div>
              <div style={{ fontSize: 30, fontWeight: 560, color: identity.text, lineHeight: 1.3 }}>{item}</div>
            </div>
          );
        })}
      </div>
    </InOut>
  );
}

function QuoteCard({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 21, stiffness: 95 } });
  return (
    <InOut durationFrames={durationFrames} inFrames={11} outFrames={10}>
      <div style={{ display: 'flex', alignItems: 'stretch', maxWidth: 1240, transform: 'scale(' + (0.94 + p * 0.06) + ')' }}>
        <div style={{ width: 7, borderRadius: 4, backgroundImage: theme.grad, marginRight: 46, transform: 'scaleY(' + p + ')', transformOrigin: 'top' }} />
        <div>
          <div style={{ fontSize: 120, lineHeight: 0.5, fontFamily: 'Georgia, serif', marginBottom: 18 }}>
            <GradText theme={theme}>“</GradText>
          </div>
          <div style={{ fontSize: 50, fontWeight: 620, fontStyle: 'italic', color: identity.text, lineHeight: 1.32, letterSpacing: '-0.01em', textShadow: theme.displayShadow }}>{spec.text}</div>
          {spec.attribution ? (
            <div style={{ marginTop: 30, ...theme.eyebrow, fontSize: 22 }}>— {spec.attribution}</div>
          ) : null}
        </div>
      </div>
    </InOut>
  );
}

function ChapterCard({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 20, stiffness: 115 } });
  const lineGrow = interpolate(frame, [9, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const drift = interpolate(frame, [0, durationFrames], [0, -14], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: identity.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 85% 70% at 50% 38%, ' + identity.primary + '2a 0%, transparent 62%)' }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 60% 50% at 80% 90%, ' + identity.accent + '14 0%, transparent 60%)' }} />
      {typeof spec.index === 'number' ? (
        <div style={{
          position: 'absolute', right: 70, bottom: -80, fontSize: 560, fontWeight: 870, lineHeight: 1,
          color: 'transparent', WebkitTextStroke: '2px rgba(255,255,255,0.07)',
          transform: 'translateY(' + drift + 'px)',
        }}>{String(spec.index).padStart(2, '0')}</div>
      ) : null}
      <div style={{ textAlign: 'center', opacity: Math.min(1, p * 1.2), maxWidth: 1400, padding: '0 80px' }}>
        {typeof spec.index === 'number' ? (
          <div style={{ ...theme.eyebrow, marginBottom: 26 }}>{'Chapter ' + String(spec.index).padStart(2, '0')}</div>
        ) : null}
        <div style={{ fontSize: 108, fontWeight: 850, color: identity.text, letterSpacing: '-0.03em', lineHeight: 1.02, transform: 'translateY(' + (1 - p) * 46 + 'px)' }}>{spec.title}</div>
        <div style={{ width: 300 * lineGrow, height: 5, borderRadius: 3, backgroundImage: theme.grad, margin: '34px auto 0' }} />
        {spec.subtitle ? (
          <div style={{ marginTop: 28, fontSize: 32, fontWeight: 460, color: identity.text, opacity: 0.72, lineHeight: 1.4 }}>{spec.subtitle}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

function Badge({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 14, stiffness: 200 } });
  return (
    <InOut durationFrames={durationFrames} inFrames={6} outFrames={8}>
      <div style={{
        display: 'inline-block', transform: 'scale(' + p + ') rotate(' + (1 - p) * -4 + 'deg)',
        backgroundImage: theme.grad, color: '#0D0B05', fontWeight: 830, fontSize: 27,
        padding: '14px 32px', borderRadius: 999, letterSpacing: '0.05em', textTransform: 'uppercase',
        boxShadow: '0 14px 44px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.25)',
      }}>{spec.text}</div>
    </InOut>
  );
}

function ImagePanel({ spec, identity, theme, durationFrames, assets }) {
  const frame = useCurrentFrame();
  const asset = assets[spec.assetId];
  if (!asset) return null;
  const motion = spec.motion || 'kenburns';
  const t = clamp01(frame / Math.max(1, durationFrames));
  let transform = 'scale(' + (1.05 + t * 0.09) + ')';
  if (motion === 'parallax') transform = 'scale(1.13) translateX(' + (t - 0.5) * 54 + 'px)';
  if (motion === 'pop') {
    const p = Math.min(1, frame / 13);
    transform = 'scale(' + (0.82 + p * 0.22 + t * 0.04) + ')';
  }
  return (
    <InOut durationFrames={durationFrames} inFrames={9} outFrames={10} style={{ width: '100%', height: '100%' }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: 26, overflow: 'hidden', position: 'relative',
        boxShadow: '0 36px 110px rgba(0,0,0,0.6), 0 6px 24px rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.12)',
      }}>
        <Img src={asset.url} style={{ width: '100%', height: '100%', objectFit: 'cover', transform }} />
        <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 120px rgba(0,0,0,0.35)', borderRadius: 26 }} />
        {spec.caption ? (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '60px 34px 26px', background: 'linear-gradient(transparent, rgba(0,0,0,0.82))' }}>
            <div style={{ ...theme.eyebrow, fontSize: 15, marginBottom: 6 }}>Featured</div>
            <div style={{ color: identity.text, fontSize: 27, fontWeight: 660 }}>{spec.caption}</div>
          </div>
        ) : null}
      </div>
    </InOut>
  );
}

function ProgressArc({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [6, durationFrames * 0.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const value = spec.from + (spec.to - spec.from) * t;
  const frac = clamp01(Math.abs(value) / Math.max(Math.abs(spec.to), Math.abs(spec.from), 1));
  const circumference = 2 * Math.PI * 150;
  return (
    <InOut durationFrames={durationFrames} inFrames={9} outFrames={9}>
      <div style={{ position: 'relative', width: 400, height: 400 }}>
        <svg width="400" height="400">
          <defs>
            <linearGradient id="cineArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={identity.primary} />
              <stop offset="100%" stopColor={identity.accent} />
            </linearGradient>
          </defs>
          <circle cx="200" cy="200" r="150" stroke="rgba(255,255,255,0.09)" strokeWidth="24" fill="none" />
          <circle cx="200" cy="200" r="150" stroke="url(#cineArcGrad)" strokeWidth="24" fill="none" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - frac)} transform="rotate(-90 200 200)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 82, fontWeight: 860, letterSpacing: '-0.02em' }}>
            <GradText theme={theme}>{Math.round(value) + (spec.suffix || '')}</GradText>
          </div>
          {spec.label ? <div style={{ ...theme.eyebrow, fontSize: 19, marginTop: 10 }}>{spec.label}</div> : null}
        </div>
      </div>
    </InOut>
  );
}

function TimelineStrip({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = spec.items || [];
  const lineGrow = interpolate(frame, [8, 8 + items.length * 7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <InOut durationFrames={durationFrames} inFrames={9} outFrames={9}>
      <div style={{ ...theme.glass, borderRadius: theme.radius, padding: '42px 56px', minWidth: 1140 }}>
        {spec.title ? (
          <div style={{ fontSize: 36, fontWeight: 790, color: identity.text, marginBottom: 36, letterSpacing: '-0.01em' }}>{spec.title}</div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 12, left: '4%', right: '4%', height: 4, background: 'rgba(255,255,255,0.10)', borderRadius: 2 }} />
          <div style={{ position: 'absolute', top: 12, left: '4%', width: lineGrow * 92 + '%', height: 4, backgroundImage: theme.grad, borderRadius: 2 }} />
          {items.map((item, i) => {
            const p = spring({ frame: frame - 9 - i * 7, fps, config: { damping: 16, stiffness: 170 } });
            return (
              <div key={i} style={{ flex: 1, textAlign: 'center', opacity: p, transform: 'translateY(' + (1 - p) * 26 + 'px)' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 14, backgroundImage: theme.grad, margin: '0 auto',
                  border: '5px solid rgba(13,11,5,0.95)', boxShadow: '0 0 18px ' + identity.accent + '66',
                }} />
                <div style={{ fontSize: 25, fontWeight: 740, color: identity.text, marginTop: 16 }}>{item.label}</div>
                {item.detail ? <div style={{ fontSize: 20, color: identity.text, opacity: 0.6, marginTop: 7, padding: '0 12px', lineHeight: 1.35 }}>{item.detail}</div> : null}
              </div>
            );
          })}
        </div>
      </div>
    </InOut>
  );
}

function KeywordPop({ spec, identity, theme, durationFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = spec.words || [];
  const per = Math.max(8, Math.floor(durationFrames / Math.max(1, words.length)));
  return (
    <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 1500 }}>
      {words.map((w, i) => {
        const p = spring({ frame: frame - i * per * 0.55, fps, config: { damping: 13, stiffness: 210 } });
        const primary = i % 2 === 0;
        return (
          <div key={i} style={{
            opacity: p, transform: 'scale(' + (0.65 + p * 0.35) + ') rotate(' + (1 - p) * (i % 2 ? 5 : -5) + 'deg)',
            backgroundImage: primary ? theme.grad : 'none',
            background: primary ? undefined : 'rgba(17,14,7,0.88)',
            border: primary ? 'none' : '1px solid rgba(255,255,255,0.14)',
            color: primary ? '#0D0B05' : identity.text,
            fontSize: 42, fontWeight: 830, padding: '16px 34px', borderRadius: 18,
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          }}>{w}</div>
        );
      })}
    </div>
  );
}

function CustomComposition({ spec, identity, theme, durationFrames, assets, stageW = 1920, stageH = 1080 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  return (
    <AbsoluteFill style={{ background: spec.bg || 'transparent' }}>
      {(spec.layers || []).map((layer, i) => {
        const t0 = Number(layer.start || 0);
        const t1 = Math.max(t0 + 0.1, Number(layer.end || t0 + 2));
        if (sec < t0 || sec > t1 + 0.5) return null;
        let t = clamp01((sec - t0) / (t1 - t0));
        if (layer.ease === 'spring') {
          t = spring({ frame: frame - Math.round(t0 * fps), fps, config: { damping: 17, stiffness: 150 } });
        } else {
          t = easeFn(layer.ease)(t);
        }
        const from = layer.from || {};
        const to = layer.to || {};
        const lerp = (a, b, fallback) => {
          const va = a != null ? a : (b != null ? b : fallback);
          const vb = b != null ? b : va;
          return va + (vb - va) * t;
        };
        const x = lerp(from.x, to.x, 50);
        const y = lerp(from.y, to.y, 50);
        const w = lerp(from.w, to.w, layer.kind === 'line' ? 30 : 20);
        const h = lerp(from.h, to.h, layer.kind === 'line' ? 0.5 : 12);
        const scale = lerp(from.scale, to.scale, 1);
        const rotate = lerp(from.rotate, to.rotate, 0);
        const opacity = lerp(from.opacity, to.opacity, 1);
        const blur = lerp(from.blur, to.blur, 0);
        const base = {
          position: 'absolute', left: x + '%', top: y + '%',
          transform: 'translate(-50%, -50%) scale(' + scale + ') rotate(' + rotate + 'deg)',
          opacity, filter: blur > 0.2 ? 'blur(' + blur + 'px)' : 'none',
        };
        if (layer.kind === 'text') {
          return (
            <div key={i} style={{ ...base, fontSize: layer.fontSize || 48, fontWeight: layer.weight || 720, color: layer.color || identity.text, whiteSpace: 'pre-wrap', textAlign: 'center', maxWidth: '86%', lineHeight: 1.18, letterSpacing: '-0.015em', textShadow: theme.displayShadow }}>
              {layer.text}
            </div>
          );
        }
        if (layer.kind === 'rect') {
          return <div key={i} style={{ ...base, width: w * (stageW / 100), height: h * (stageH / 100), background: layer.color || identity.primary, borderRadius: layer.radius != null ? layer.radius : 16, boxShadow: '0 18px 60px rgba(0,0,0,0.4)' }} />;
        }
        if (layer.kind === 'ellipse') {
          return <div key={i} style={{ ...base, width: w * (stageW / 100), height: h * (stageH / 100), background: layer.color || identity.accent, borderRadius: '50%' }} />;
        }
        if (layer.kind === 'line') {
          return <div key={i} style={{ ...base, width: w * (stageW / 100), height: Math.max(3, h * (stageH / 100)), backgroundImage: layer.color ? 'none' : theme.grad, background: layer.color || undefined, borderRadius: 3 }} />;
        }
        if (layer.kind === 'image') {
          const asset = assets[layer.assetId];
          if (!asset) return null;
          return <Img key={i} src={asset.url} style={{ ...base, width: w * (stageW / 100), height: h * (stageH / 100), objectFit: 'cover', borderRadius: layer.radius != null ? layer.radius : 20, boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }} />;
        }
        return null;
      })}
    </AbsoluteFill>
  );
}

function MotionGraphic({ spec, identity, theme, durationFrames, assets, stageW = 1920, stageH = 1080 }) {
  if (!spec || !spec.type) return null;
  const common = { spec, identity, theme, durationFrames, assets, stageW, stageH };
  switch (spec.type) {
    case 'kineticTitle': return <KineticTitle {...common} />;
    case 'lowerThird': return <LowerThird {...common} />;
    case 'callout': return <Callout {...common} />;
    case 'stat': return <StatCounter {...common} />;
    case 'barChart': return <BarChart {...common} />;
    case 'list': return <ListReveal {...common} />;
    case 'quote': return <QuoteCard {...common} />;
    case 'chapter': return <ChapterCard {...common} />;
    case 'badge': return <Badge {...common} />;
    case 'image': return <ImagePanel {...common} />;
    case 'progress': return <ProgressArc {...common} />;
    case 'timeline': return <TimelineStrip {...common} />;
    case 'keyword': return <KeywordPop {...common} />;
    case 'custom': return <CustomComposition {...common} />;
    default: return null;
  }
}

/** Center/full overlays over footage get a soft scrim so type always reads. */
function OverlayScrim({ anchor, durationFrames }) {
  const frame = useCurrentFrame();
  if (anchor !== 'center' && anchor !== 'full') return null;
  const opacity = interpolate(
    frame,
    [0, 8, Math.max(9, durationFrames - 8), durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(ellipse 72% 62% at 50% 50%, rgba(4,4,8,0.55) 0%, rgba(4,4,8,0.18) 55%, transparent 78%)',
      opacity,
      pointerEvents: 'none',
    }} />
  );
}

function AnchorWrap({ anchor, children }) {
  const styles = {
    'lower-third': { justifyContent: 'flex-end', alignItems: 'flex-start', padding: '0 0 160px 96px' },
    center: { justifyContent: 'center', alignItems: 'center' },
    top: { justifyContent: 'flex-start', alignItems: 'center', paddingTop: 86 },
    'left-panel': { justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 86 },
    'right-panel': { justifyContent: 'center', alignItems: 'flex-end', paddingRight: 86 },
    corner: { justifyContent: 'flex-start', alignItems: 'flex-end', padding: '74px 86px 0 0' },
    full: {},
  };
  const s = styles[anchor] || styles.center;
  if (anchor === 'full') return <AbsoluteFill>{children}</AbsoluteFill>;
  if (anchor === 'left-panel') {
    return (
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', ...s }}>
        <div style={{ maxWidth: 840 }}>{children}</div>
      </AbsoluteFill>
    );
  }
  return <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', ...s }}>{children}</AbsoluteFill>;
}

// ---------- segments ----------

function TransitionWrap({ transition, children }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!transition) return <AbsoluteFill>{children}</AbsoluteFill>;
  const d = Math.max(3, Math.round((transition.duration || 0.4) * fps));
  const t = clamp01(frame / d);
  const e = Easing.out(Easing.cubic)(t);
  let style = {};
  let veil = null;
  if (transition.type === 'fade') {
    style = { opacity: e, transform: 'scale(' + (1.02 - e * 0.02) + ')' };
  } else if (transition.type === 'dip') {
    veil = <AbsoluteFill style={{ background: '#000', opacity: 1 - e, pointerEvents: 'none' }} />;
  } else if (transition.type === 'slide') {
    style = { transform: 'translateX(' + (1 - e) * 100 + '%)' };
  } else if (transition.type === 'zoom') {
    style = { transform: 'scale(' + (1.16 - e * 0.16) + ')', opacity: Math.min(1, e * 1.7) };
  } else if (transition.type === 'whip') {
    const eh = Easing.inOut(Easing.cubic)(t);
    style = { transform: 'translateX(' + (1 - eh) * 58 + '%)', filter: t < 1 ? 'blur(' + (1 - eh) * 18 + 'px)' : 'none' };
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {veil}
    </AbsoluteFill>
  );
}

/** Cinematic finish over footage: vignette + a whisper of top/bottom grade. */
function FilmGrade() {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ boxShadow: 'inset 0 0 220px rgba(0,0,0,0.42)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.16) 0%, transparent 14%, transparent 84%, rgba(0,0,0,0.22) 100%)' }} />
    </AbsoluteFill>
  );
}

function SourceSegment({ seg, source, frameMode, bgBlur, masterVolume, durationFrames, stageW = 1920, stageH = 1080 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrom = Math.round(seg.src.start * fps);
  const endAt = Math.round(seg.src.end * fps);
  const vol = (seg.src.volume != null ? seg.src.volume : 1) * masterVolume;
  // Cover when the footage roughly matches the stage's own aspect; otherwise
  // contain over a blurred fill. Works for both landscape and portrait stages.
  const stageAspect = stageW / stageH;
  const srcAspect = source.width / Math.max(1, source.height);
  const fills = srcAspect >= stageAspect * 0.9 && srcAspect <= stageAspect * 1.3;
  const useCover = frameMode === 'cover' || fills;
  // Slow push-in on longer shots — the quiet thing that makes a cut feel filmed.
  const longShot = durationFrames > fps * 4;
  const push = longShot ? 1 + (frame / Math.max(1, durationFrames)) * 0.035 : 1;
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      {!useCover && bgBlur ? (
        <OffthreadVideo
          src={source.url} startFrom={startFrom} endAt={endAt} muted
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(46px) brightness(0.4) saturate(1.15)', transform: 'scale(1.22)' }}
        />
      ) : null}
      <OffthreadVideo
        src={source.url} startFrom={startFrom} endAt={endAt}
        volume={vol}
        muted={vol <= 0.001}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: useCover ? 'cover' : 'contain', transform: useCover ? 'scale(' + push + ')' : 'none' }}
      />
      <FilmGrade />
    </AbsoluteFill>
  );
}

function GeneratedSegment({ seg, assets, durationFrames }) {
  const asset = assets[seg.assetId];
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!asset) return <AbsoluteFill style={{ background: '#110E07' }} />;
  if (asset.kind === 'video') {
    const maxFrames = asset.durationSec ? Math.max(6, Math.floor(asset.durationSec * fps) - 2) : durationFrames;
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        <OffthreadVideo src={asset.url} endAt={Math.min(durationFrames + 2, maxFrames)} muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <FilmGrade />
      </AbsoluteFill>
    );
  }
  const t = clamp01(frame / Math.max(1, durationFrames));
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <Img src={asset.url} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(' + (1.04 + t * 0.08) + ')' }} />
      <FilmGrade />
    </AbsoluteFill>
  );
}

// ---------- captions ----------

function CaptionTrack({ cues, style, identity, theme, fps, stageW = 1920 }) {
  const preset = style.preset || 'clean';
  const posStyle = style.position === 'center'
    ? { top: '58%' }
    : style.position === 'lower'
    ? { bottom: 216 }
    : { bottom: 100 };
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {cues.map((cue, i) => (
        <Sequence key={i} from={Math.round(cue.at * fps)} durationInFrames={Math.max(8, Math.round(cue.duration * fps))}>
          <CaptionCueView cue={cue} preset={preset} posStyle={posStyle} identity={identity} theme={theme} stageW={stageW} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function CaptionCueView({ cue, preset, posStyle, identity, theme, stageW = 1920 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;
  const fadeIn = interpolate(frame, [0, 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const riseIn = interpolate(frame, [0, 5], [8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const base = {
    position: 'absolute', left: '50%', transform: 'translateX(-50%) translateY(' + riseIn + 'px)',
    maxWidth: Math.min(1380, stageW - 130), textAlign: 'center', opacity: fadeIn, ...posStyle,
  };
  const fontBase = {
    clean: { fontSize: 44, fontWeight: 680 },
    bold: { fontSize: 58, fontWeight: 860, textTransform: 'uppercase', letterSpacing: '0.005em' },
    karaoke: { fontSize: 50, fontWeight: 800 },
    minimal: { fontSize: 36, fontWeight: 540 },
    editorial: { fontSize: 42, fontWeight: 520, fontStyle: 'italic', fontFamily: 'Georgia, serif' },
  }[preset] || { fontSize: 44, fontWeight: 680 };
  const pill = preset === 'minimal' || preset === 'editorial'
    ? { textShadow: '0 3px 20px rgba(0,0,0,0.9)' }
    : {
      background: 'linear-gradient(165deg, rgba(13,11,5,0.82), rgba(9,7,3,0.72))',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 18, padding: '14px 32px', backdropFilter: 'blur(10px)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    };
  const highlight = preset === 'karaoke' || preset === 'bold';
  return (
    <div style={{ ...base }}>
      <div style={{ display: 'inline-block', ...pill }}>
        {cue.words.map((w, i) => {
          const active = sec >= w.t && sec <= w.t + Math.max(0.14, w.d) + 0.08;
          const past = sec > w.t + Math.max(0.14, w.d) + 0.08;
          const color = highlight
            ? (active ? identity.accent : past ? identity.text : 'rgba(255,255,255,0.62)')
            : identity.text;
          const lift = highlight && active ? -3 : 0;
          const scale = highlight && active && preset === 'karaoke' ? 1.09 : 1;
          return (
            <span key={i} style={{ ...fontBase, color, display: 'inline-block', transform: 'translateY(' + lift + 'px) scale(' + scale + ')', marginRight: '0.3em', lineHeight: 1.38 }}>
              {w.w}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------- audio ----------

function MusicTrack({ url, volume, duckTo, envelope, startSec, fps }) {
  if (!url) return null;
  const volumeAt = (f) => {
    const sec = f / fps;
    const idx = Math.max(0, Math.floor(sec));
    const cur = envelope[Math.min(idx, envelope.length - 1)] ? duckTo : volume;
    const next = envelope[Math.min(idx + 1, envelope.length - 1)] ? duckTo : volume;
    const frac = sec - idx;
    const fadeOutStart = envelope.length - 2;
    const base = frac > 0.7 ? cur + (next - cur) * ((frac - 0.7) / 0.3) : cur;
    const intro = Math.min(1, sec / 1.5);
    const outro = sec > fadeOutStart ? Math.max(0, 1 - (sec - fadeOutStart) / 2) : 1;
    return Math.max(0, base * intro * Math.max(0.2, outro));
  };
  return <Audio src={url} volume={volumeAt} startFrom={Math.round((startSec || 0) * fps)} />;
}

// ---------- stage ----------

/** Landscape renders natively. Portrait films are composed on a virtual
 * 1080x1920 canvas centered in the fixed 1920x1080 render frame; the platform
 * portrait re-encode then cover-crops the master to a TRUE 1080x1920 MP4, so
 * the delivered file keeps the source orientation. */
function Stage({ portrait, fontFamily, children }) {
  if (!portrait) {
    return <AbsoluteFill style={{ background: '#000', fontFamily }}>{children}</AbsoluteFill>;
  }
  return (
    <AbsoluteFill style={{ background: '#000', fontFamily, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 1080, height: 1920, transform: 'scale(0.5625)', transformOrigin: 'center center', position: 'relative', overflow: 'hidden', flexShrink: 0, background: '#000' }}>
        {children}
      </div>
    </AbsoluteFill>
  );
}

// ---------- the film ----------

export default function CineAgentFilm(props) {
  const plan = props.plan || { timeline: [], overlays: [], identity: {}, captions: { enabled: false, style: {} }, audio: {} };
  const assets = props.assets || {};
  const identity = {
    primary: plan.identity.primary || '#f59e0b',
    secondary: plan.identity.secondary || '#110E07',
    accent: plan.identity.accent || '#22d3ee',
    bg: plan.identity.bg || '#0D0B05',
    text: plan.identity.text || '#ffffff',
    fontStyle: plan.identity.fontStyle || 'modern',
  };
  const theme = themeOf(identity);
  const { fps } = useVideoConfig();
  const portrait = Boolean(props.portrait);
  const stageW = portrait ? 1080 : 1920;
  const stageH = portrait ? 1920 : 1080;
  const frames = segmentFrames(plan, fps);
  const source = props.source || { url: '', width: 1920, height: 1080 };
  const masterVolume = plan.audio && plan.audio.keepOriginal !== false ? (plan.audio.originalVolume != null ? plan.audio.originalVolume : 1) : 0;
  const envelope = props.speechEnvelope || [];
  const musicStartSec = props.musicStartSec || 0;

  return (
    <Stage portrait={portrait} fontFamily={fontFor(identity)}>
      {frames.list.map(({ seg, from, frames: df }) => (
        <Sequence key={seg.id} from={from} durationInFrames={df}>
          <TransitionWrap transition={seg.transitionIn}>
            {seg.kind === 'source' && seg.src ? (
              <SourceSegment seg={seg} source={source} frameMode={(plan.frame && plan.frame.mode) || 'fit'} bgBlur={!plan.frame || plan.frame.bgBlur !== false} masterVolume={masterVolume} durationFrames={df} stageW={stageW} stageH={stageH} />
            ) : seg.kind === 'generated' ? (
              <GeneratedSegment seg={seg} assets={assets} durationFrames={df} />
            ) : seg.kind === 'board' && seg.board ? (
              <AbsoluteFill style={{ background: identity.bg }}>
                <AbsoluteFill style={{ background: 'radial-gradient(ellipse 80% 65% at 50% 38%, ' + identity.primary + '22 0%, transparent 62%)' }} />
                <AbsoluteFill style={{ background: 'radial-gradient(ellipse 55% 45% at 82% 88%, ' + identity.accent + '11 0%, transparent 58%)' }} />
                <AnchorWrap anchor="center">
                  <MotionGraphic spec={seg.board} identity={identity} theme={theme} durationFrames={df} assets={assets} stageW={stageW} stageH={stageH} />
                </AnchorWrap>
              </AbsoluteFill>
            ) : null}
          </TransitionWrap>
        </Sequence>
      ))}

      {(plan.overlays || []).map((ov) => {
        const df = Math.max(10, Math.round(ov.duration * fps));
        return (
          <Sequence key={ov.id} from={Math.round(ov.at * fps)} durationInFrames={df}>
            {ov.spec && ov.spec.type !== 'chapter' && ov.spec.type !== 'custom' ? (
              <OverlayScrim anchor={ov.anchor || 'center'} durationFrames={df} />
            ) : null}
            <AnchorWrap anchor={ov.anchor || 'center'}>
              <MotionGraphic spec={ov.spec} identity={identity} theme={theme} durationFrames={df} assets={assets} stageW={stageW} stageH={stageH} />
            </AnchorWrap>
          </Sequence>
        );
      })}

      {plan.captions && plan.captions.enabled && props.captionCues && props.captionCues.length ? (
        <CaptionTrack cues={props.captionCues} style={plan.captions.style || {}} identity={identity} theme={theme} fps={fps} stageW={stageW} />
      ) : null}

      {plan.audio && plan.audio.music && props.musicUrl ? (
        <MusicTrack url={props.musicUrl} volume={plan.audio.music.volume != null ? plan.audio.music.volume : 0.16}
          duckTo={plan.audio.music.duckTo != null ? plan.audio.music.duckTo : 0.05}
          envelope={envelope} startSec={musicStartSec} fps={fps} />
      ) : null}

      {props.narration && props.narration.segments ? props.narration.segments.map((n, i) => (
        <Sequence key={'narr' + i} from={Math.round(n.at * fps)}>
          <Audio src={n.url} volume={0.95} />
        </Sequence>
      )) : null}
    </Stage>
  );
}

export const calculateDemoVideoDuration = (props) => {
  const plan = (props && props.plan) || { timeline: [] };
  let total = 0;
  (plan.timeline || []).forEach((seg) => {
    total += Math.max(6, Math.round(segDuration(seg) * 30));
  });
  return Math.max(30, total);
};
`;

/**
 * Mirror of the runtime's frame math — render.ts uses this so the
 * durationInFrames submitted to the service always matches what the
 * composition itself computes.
 */
export function runtimeFrames(plan: { timeline: { kind: string; src?: { start: number; end: number }; duration?: number }[] }, fps = 30): number {
  let total = 0;
  (plan.timeline || []).forEach((seg) => {
    const d = seg.kind === 'source' && seg.src
      ? Math.max(0.2, seg.src.end - seg.src.start)
      : Math.max(0.5, Number(seg.duration || 4));
    total += Math.max(6, Math.round(d * fps));
  });
  return Math.max(30, total);
}
