/**
 * Video Enhancer — extended server-side export.
 *
 * Same Remotion render service as enhancerCore (POST /api/render/remotion),
 * but with a richer composition: EDL silence cuts, playback speed, transitions,
 * duotone / letterbox / vignette(intensity+radius) / grain, text layers with
 * animation presets, emoji stickers, a watermark image, a background music
 * track, aspect-ratio reframes, selectable output resolution and — the default
 * caption treatment — concept MOTION GRAPHICS at each caption moment (animated
 * SVG from captionGraphics.MOTION_GRAPHICS_LIB) instead of burned-in text.
 */
import { workspaceToken, WORKSPACE_UUID } from './enhancerCore';
import { MOTION_GRAPHICS_LIB } from './captionGraphics';

export async function submitRenderV2(props: Record<string, unknown>, durationInFrames: number, width: number, height: number): Promise<string> {
  const res = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      workspaceId: WORKSPACE_UUID,
      compositionTsx: ENHANCER_COMPOSITION_V2,
      props,
      durationInFrames,
      fps: 30,
      width,
      height,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.operationId) {
    throw new Error((data?.error as string) || ('Render submission failed (HTTP ' + res.status + ').'));
  }
  return String(data.operationId);
}

/**
 * Export composition v2. All overlay timings arrive in SOURCE seconds; the
 * composition maps them to output time through the EDL + speed. Font sizes are
 * pixels at a 1080-tall reference frame and scale with the render height.
 * The render service probes the bundle with EMPTY props first — nothing here
 * may throw on an empty props object.
 */
export const ENHANCER_COMPOSITION_V2 = `
import React from 'react';
import { AbsoluteFill, OffthreadVideo, Audio, Img, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

const FONT_IMPORT = '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;700;900&family=Montserrat:wght@300;400;700;900&family=Roboto+Slab:wght@300;400;700&family=Playfair+Display:wght@400;700;900&family=JetBrains+Mono:wght@300;400;700&family=Bebas+Neue&family=Anton&family=Oswald:wght@300;400;700&family=DM+Sans:wght@400;500;700;900&family=Geist:wght@400;500;700;900&display=swap");';

const FONT_FAMILIES = {
  inter: "'Inter', system-ui, sans-serif",
  montserrat: "'Montserrat', 'Inter', sans-serif",
  robotoslab: "'Roboto Slab', Georgia, serif",
  playfair: "'Playfair Display', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  bebas: "'Bebas Neue', Impact, sans-serif",
  anton: "'Anton', Impact, sans-serif",
  oswald: "'Oswald', 'Inter', sans-serif",
  dmsans: "'DM Sans', 'Inter', sans-serif",
  geist: "'Geist', 'Inter', sans-serif",
  // Handwriting fonts are retired: legacy ids map to clean modern sans.
  pacifico: "'Inter', system-ui, sans-serif",
  caveat: "'Inter', system-ui, sans-serif",
};

const GRAIN_BG = 'url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27240%27 height=%27240%27><filter id=%27n%27><feTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%272%27 stitchTiles=%27stitch%27/></filter><rect width=%27240%27 height=%27240%27 filter=%27url(%23n)%27/></svg>")';

function hexToRgba(hex, alpha) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full || '000000', 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, alpha)) + ')';
}

function srcToOut(t, keeps, speed) {
  let acc = 0;
  for (const k of keeps) {
    if (t <= k.from) break;
    if (t <= k.to) { acc += t - k.from; break; }
    acc += k.to - k.from;
  }
  return acc / Math.max(0.01, speed);
}

function outToSrc(t, keeps, speed) {
  let remain = t * Math.max(0.01, speed);
  for (const k of keeps) {
    const len = k.to - k.from;
    if (remain <= len) return k.from + remain;
    remain -= len;
  }
  const last = keeps[keeps.length - 1];
  return last ? last.to : t;
}
${MOTION_GRAPHICS_LIB}
function CaptionLine({ seg, t, preset, accent, scale }) {
  const words = seg.words || [];
  const isBold = preset === 'boldpop';
  const isNeon = preset === 'neon';
  const isKaraoke = preset === 'karaoke';
  const isClean = preset === 'clean';
  const containerStyle = {
    maxWidth: '82%',
    textAlign: 'center',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    lineHeight: 1.18,
  };
  if (isClean) {
    Object.assign(containerStyle, { background: 'rgba(10,15,30,0.72)', borderRadius: 18 * scale, padding: (14 * scale) + 'px ' + (30 * scale) + 'px', fontSize: 44 * scale, fontWeight: 600, color: '#F8FAFC' });
  } else if (isBold) {
    Object.assign(containerStyle, { fontSize: 62 * scale, fontWeight: 900, textTransform: 'uppercase', color: '#FFFFFF', WebkitTextStroke: (2.5 * scale) + 'px rgba(0,0,0,0.85)', textShadow: '0 6px 24px rgba(0,0,0,0.55)' });
  } else if (isKaraoke) {
    Object.assign(containerStyle, { fontSize: 50 * scale, fontWeight: 800, color: 'rgba(255,255,255,0.92)', textShadow: '0 4px 18px rgba(0,0,0,0.6)' });
  } else if (isNeon) {
    Object.assign(containerStyle, { fontSize: 54 * scale, fontWeight: 800, color: '#FFFFFF' });
  }
  return (
    <div style={containerStyle}>
      {words.map((w, i) => {
        const spoken = t >= w.s;
        const activeNow = t >= w.s && t <= w.e + 0.05;
        const style = { display: 'inline-block', margin: '0 0.14em' };
        if (w.em) style.color = accent;
        if (isBold && activeNow) { style.transform = 'scale(1.12)'; style.color = w.em ? accent : '#FFD84D'; }
        if (isKaraoke) { style.color = spoken ? accent : 'rgba(255,255,255,0.55)'; }
        if (isNeon) {
          style.textShadow = spoken ? ('0 0 18px ' + accent + ', 0 0 42px ' + accent) : '0 2px 12px rgba(0,0,0,0.7)';
          if (activeNow) style.color = accent;
        }
        return <span key={i} style={style}>{w.t}</span>;
      })}
    </div>
  );
}

function SegVideo({ src, seg, speed, filter, cutStyle, volume }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const styleId = cutStyle || 'cut';
  const inDur = styleId === 'dissolve' ? 10 : 6;
  const t = styleId === 'cut' ? 1 : interpolate(frame, [0, inDur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = styleId === 'fade' || styleId === 'dissolve' ? t : 1;
  const tx = styleId === 'slide' ? (1 - t) * 100 : 0;
  return (
    <AbsoluteFill style={{ opacity, background: '#000', transform: 'translateX(' + tx + '%)' }}>
      <OffthreadVideo
        src={src}
        startFrom={Math.round(seg.from * fps)}
        endAt={Math.max(Math.round(seg.from * fps) + 1, Math.round(seg.to * fps))}
        playbackRate={speed}
        volume={volume}
        style={{ width: '100%', height: '100%', objectFit: 'cover', filter }}
      />
    </AbsoluteFill>
  );
}

function BrollClip({ url, dur, filter }) {
  const frame = useCurrentFrame();
  const src = typeof url === 'string' ? url : '';
  const fade = 8;
  const opacity = interpolate(frame, [0, fade, Math.max(fade + 1, dur - fade), dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity, background: '#000' }}>
      {src.length > 0 ? <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter }} /> : null}
    </AbsoluteFill>
  );
}

function GraphicPop({ text, kind, accent, dur, scale, pos }) {
  const frame = useCurrentFrame();
  const clampOpt = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
  const fadeIn = interpolate(frame, [0, 10], [0, 1], clampOpt);
  const out = interpolate(frame, [Math.max(1, dur - 8), dur], [1, 0], clampOpt);
  const rise = interpolate(frame, [0, 10], [24, 0], clampOpt);
  const isTitle = kind === 'title';
  // All keyword/title pops live in the bottom band of the frame (never the
  // center of the image), at a per-cue horizontal anchor that alternates
  // bottom-left / bottom-center / bottom-right for variety.
  const align = pos === 'left' ? 'flex-start' : pos === 'right' ? 'flex-end' : 'center';
  return (
    <AbsoluteFill style={{ alignItems: align, justifyContent: 'flex-end', padding: '0 ' + (64 * scale) + 'px ' + (170 * scale) + 'px', pointerEvents: 'none' }}>
      <div style={{
        transform: 'translateY(' + (rise * scale) + 'px)',
        opacity: Math.min(fadeIn, out),
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        fontWeight: 900,
        textTransform: 'uppercase',
        fontSize: (isTitle ? 54 : 40) * scale,
        letterSpacing: 2,
        color: '#FFFFFF',
        textShadow: '0 6px 24px rgba(0,0,0,0.65)',
        background: 'rgba(8, 10, 20, 0.66)',
        borderBottom: (4 * scale) + 'px solid ' + accent,
        padding: (8 * scale) + 'px ' + (22 * scale) + 'px',
        borderRadius: 12 * scale,
        maxWidth: '60%',
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
}

function TextLayerEl({ l, scale }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame / fps;
  const anim = l.anim || 'none';
  const inDur = 0.5;
  let opacity = 1, tx = 0, ty = 0, sc = 1;
  let text = String(l.text || '');
  const clampOpt = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
  if (anim === 'fadeIn') opacity = interpolate(local, [0, inDur], [0, 1], clampOpt);
  if (anim === 'slideUp') { ty = interpolate(local, [0, inDur], [46, 0], clampOpt); opacity = interpolate(local, [0, inDur], [0, 1], clampOpt); }
  if (anim === 'slideLeft') { tx = interpolate(local, [0, inDur], [-90, 0], clampOpt); opacity = interpolate(local, [0, inDur], [0, 1], clampOpt); }
  if (anim === 'slideRight') { tx = interpolate(local, [0, inDur], [90, 0], clampOpt); opacity = interpolate(local, [0, inDur], [0, 1], clampOpt); }
  if (anim === 'bounceIn') { const s = spring({ frame, fps, config: { damping: 9, stiffness: 180 } }); sc = 0.4 + 0.6 * s; opacity = Math.min(1, s * 1.4); }
  if (anim === 'zoomIn') { sc = interpolate(local, [0, inDur], [0.55, 1], clampOpt); opacity = interpolate(local, [0, inDur], [0, 1], clampOpt); }
  if (anim === 'typewriter') {
    const revealDur = Math.max(0.4, Math.min(2.5, text.length * 0.045));
    const chars = Math.floor(interpolate(local, [0, revealDur], [0, text.length], clampOpt));
    text = text.slice(0, chars);
  }
  const style = {
    position: 'absolute',
    left: (Number(l.x) || 0) + '%',
    top: (Number(l.y) || 0) + '%',
    transform: 'translate(-50%, -50%) translate(' + tx * scale + 'px,' + ty * scale + 'px) scale(' + sc + ')',
    opacity,
    maxWidth: '88%',
    whiteSpace: 'pre-wrap',
    fontFamily: FONT_FAMILIES[l.font] || FONT_FAMILIES.inter,
    fontSize: (Number(l.size) || 44) * scale,
    fontWeight: Number(l.weight) || 700,
    color: l.color || '#FFFFFF',
    textAlign: l.align || 'center',
    letterSpacing: (Number(l.letterSpacing) || 0) * scale,
    lineHeight: Number(l.lineHeight) || 1.2,
    pointerEvents: 'none',
  };
  if (Number(l.bgOpacity) > 0) {
    style.background = hexToRgba(l.bg || '#000000', Number(l.bgOpacity) / 100);
    style.padding = (8 * scale) + 'px ' + (18 * scale) + 'px';
    style.borderRadius = 10 * scale;
  }
  if (Number(l.outlineWidth) > 0) style.WebkitTextStroke = (Number(l.outlineWidth) * scale) + 'px ' + (l.outlineColor || '#000000');
  if (Number(l.shadowBlur) > 0 || Number(l.shadowX) !== 0 || Number(l.shadowY) !== 0) {
    style.textShadow = ((Number(l.shadowX) || 0) * scale) + 'px ' + ((Number(l.shadowY) || 0) * scale) + 'px ' + ((Number(l.shadowBlur) || 0) * scale) + 'px ' + (l.shadowColor || '#000000');
  }
  return <div style={style}>{text}</div>;
}

function StickerEl({ s, scale }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sp = spring({ frame, fps, config: { damping: 11, stiffness: 170 } });
  return (
    <div style={{
      position: 'absolute',
      left: (Number(s.x) || 0) + '%',
      top: (Number(s.y) || 0) + '%',
      transform: 'translate(-50%, -50%) scale(' + (0.5 + 0.5 * sp) + ')',
      fontSize: (Number(s.size) || 96) * scale,
      lineHeight: 1,
      pointerEvents: 'none',
      filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))',
    }}>{s.emoji}</div>
  );
}

export default function Composition(props) {
  const { srcUrl, accent, captionPreset, captionMode, captions, motionCues, graphics, broll, filter, letterbox, vignette, grain, grainAmount, duotone, punchIn, blurRadial, blurBackground, speed: speedRaw, transIn, transOut, cutStyle, edl, layers, stickers, watermark, music, originalVolume, srcDuration } = props || {};
  const src = typeof srcUrl === 'string' ? srcUrl : '';
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const scale = height / 1080;
  const speed = Number(speedRaw) > 0 ? Number(speedRaw) : 1;
  const dur = Number(srcDuration) > 0 ? Number(srcDuration) : (durationInFrames / fps) * speed;
  const keeps = (Array.isArray(edl) && edl.length ? edl : [{ from: 0, to: dur }]).filter((k) => k && Number(k.to) > Number(k.from));
  const t = frame / fps;                    // output time (seconds)
  const srcT = outToSrc(t, keeps, speed);   // matching source time
  const fil = typeof filter === 'string' && filter ? filter : 'none';
  const vol = Number(originalVolume) >= 0 ? Math.min(1, Number(originalVolume)) : 1;
  const grainShift = (frame % 6) * 17;
  // Caption treatment: concept motion graphics (default) or classic text lines.
  const capMode = captionMode === 'text' ? 'text' : 'motion';

  // Video segments laid out on the output timeline per the EDL
  let acc = 0;
  const segs = keeps.map((k) => {
    const from = Math.round(acc * fps);
    const df = Math.max(1, Math.round(((k.to - k.from) / speed) * fps));
    acc += (k.to - k.from) / speed;
    return { k, from, df };
  });

  // Global transform: slow punch-in plus zoom transitions
  let zoom = punchIn ? interpolate(frame, [0, Math.max(1, durationInFrames)], [1, 1.06]) : 1;
  if (transIn === 'zoom') zoom *= interpolate(frame, [0, 20], [1.14, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (transOut === 'zoom') zoom *= interpolate(frame, [Math.max(0, durationInFrames - 20), durationInFrames], [1, 1.12], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  let slideX = 0;
  if (transIn === 'slide') slideX += interpolate(frame, [0, 18], [100, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (transOut === 'slide') slideX += interpolate(frame, [Math.max(0, durationInFrames - 18), durationInFrames], [0, -100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const activeCaption = (captions || []).find((c) => srcT >= c.start && srcT < c.end) || null;
  const vin = vignette && vignette.on ? vignette : null;
  const duo = duotone && duotone.on ? duotone : null;
  const barPct = letterbox ? Math.max(0, (1 - (width / height) / 2.35) / 2) * 100 : 0;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <style>{FONT_IMPORT}</style>

      <AbsoluteFill style={{ transform: 'translateX(' + slideX + '%) scale(' + zoom + ')' }}>
        {src.length > 0 ? segs.map((s, i) => (
          <Sequence key={'seg-' + i} from={s.from} durationInFrames={s.df}>
            <SegVideo src={src} seg={s.k} speed={speed} filter={fil} cutStyle={i > 0 ? (cutStyle || 'dissolve') : 'cut'} volume={vol} />
          </Sequence>
        )) : null}

        {(broll || []).map((b, i) => {
          if (!b || typeof b.url !== 'string' || !b.url) return null;
          const os = srcToOut(b.at, keeps, speed);
          const oe = srcToOut(b.at + b.duration, keeps, speed);
          if (oe - os < 0.08) return null;
          const from = Math.round(os * fps);
          const dseg = Math.max(1, Math.round((oe - os) * fps));
          return (
            <Sequence key={'broll-' + i} from={from} durationInFrames={dseg}>
              <BrollClip url={b.url} dur={dseg} filter={fil} />
            </Sequence>
          );
        })}
      </AbsoluteFill>

      {duo ? (
        <>
          <AbsoluteFill style={{ pointerEvents: 'none', background: duo.dark, mixBlendMode: 'lighten', opacity: 0.9 }} />
          <AbsoluteFill style={{ pointerEvents: 'none', background: duo.light, mixBlendMode: 'darken', opacity: 0.9 }} />
        </>
      ) : null}

      {vin ? (
        <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) ' + Math.round(vin.radius) + '%, rgba(0,0,0,' + (Math.min(100, Math.max(0, vin.intensity)) / 100 * 0.85).toFixed(3) + ') 100%)' }} />
      ) : null}
      {grain ? (
        <AbsoluteFill style={{ pointerEvents: 'none', opacity: 0.02 + Math.max(0, Math.min(100, Number(grainAmount) >= 0 ? Number(grainAmount) : 50)) / 100 * 0.16, backgroundImage: GRAIN_BG, backgroundPosition: grainShift + 'px ' + grainShift + 'px' }} />
      ) : null}

      {Number(blurRadial) > 0 ? (
        <AbsoluteFill style={{ pointerEvents: 'none', backdropFilter: 'blur(' + Number(blurRadial) + 'px)', WebkitBackdropFilter: 'blur(' + Number(blurRadial) + 'px)', WebkitMaskImage: 'radial-gradient(circle at center, transparent 28%, black 62%)', maskImage: 'radial-gradient(circle at center, transparent 28%, black 62%)' }} />
      ) : null}
      {Number(blurBackground) > 0 ? (
        <AbsoluteFill style={{ pointerEvents: 'none', backdropFilter: 'blur(' + Number(blurBackground) + 'px)', WebkitBackdropFilter: 'blur(' + Number(blurBackground) + 'px)', WebkitMaskImage: 'radial-gradient(ellipse 44% 60% at center, transparent 58%, black 78%)', maskImage: 'radial-gradient(ellipse 44% 60% at center, transparent 58%, black 78%)' }} />
      ) : null}

      {(graphics || []).map((g, i) => {
        const os = srcToOut(g.at, keeps, speed);
        const oe = srcToOut(g.at + g.duration, keeps, speed);
        if (oe - os < 0.08) return null;
        const from = Math.round(os * fps);
        const dseg = Math.max(1, Math.round((oe - os) * fps));
        return (
          <Sequence key={'gfx-' + i} from={from} durationInFrames={dseg}>
            <GraphicPop text={g.text} kind={g.kind} accent={accent || '#3B82F6'} dur={dseg} scale={scale} pos={['left', 'center', 'right'][i % 3]} />
          </Sequence>
        );
      })}

      {(stickers || []).map((s, i) => {
        if (!s || !s.emoji) return null;
        const os = srcToOut(s.start, keeps, speed);
        const oe = srcToOut(s.end, keeps, speed);
        if (oe - os < 0.08) return null;
        return (
          <Sequence key={'stk-' + i} from={Math.round(os * fps)} durationInFrames={Math.max(1, Math.round((oe - os) * fps))}>
            <StickerEl s={s} scale={scale} />
          </Sequence>
        );
      })}

      {(layers || []).map((l, i) => {
        if (!l || !l.text) return null;
        const os = srcToOut(l.start, keeps, speed);
        const oe = srcToOut(l.end, keeps, speed);
        if (oe - os < 0.08) return null;
        return (
          <Sequence key={'txt-' + i} from={Math.round(os * fps)} durationInFrames={Math.max(1, Math.round((oe - os) * fps))}>
            <TextLayerEl l={l} scale={scale} />
          </Sequence>
        );
      })}

      {capMode === 'motion' ? (motionCues || []).map((m, i) => {
        if (!m || typeof m.archetype !== 'string') return null;
        const os = srcToOut(m.start, keeps, speed);
        const oe = srcToOut(m.end, keeps, speed);
        if (oe - os < 0.12) return null;
        const dseg = Math.max(1, Math.round((oe - os) * fps));
        return (
          <Sequence key={'mcue-' + i} from={Math.round(os * fps)} durationInFrames={dseg}>
            <MotionCueFx label={m.label} kind={m.archetype} dir={m.dir} color={m.color || accent || '#3B82F6'} dur={dseg} scale={scale} />
          </Sequence>
        );
      }) : null}

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 84 * scale }}>
        {capMode === 'text' && activeCaption ? <CaptionLine seg={activeCaption} t={srcT} preset={captionPreset || 'boldpop'} accent={accent || '#3B82F6'} scale={scale} /> : null}
      </AbsoluteFill>

      {barPct > 0.5 ? (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barPct + '%', background: '#000' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: barPct + '%', background: '#000' }} />
        </>
      ) : null}

      {watermark && typeof watermark.url === 'string' && watermark.url ? (
        <Img
          src={watermark.url}
          style={{
            position: 'absolute',
            width: Math.min(60, Math.max(3, Number(watermark.size) || 14)) + '%',
            opacity: Math.min(1, Math.max(0, (Number(watermark.opacity) || 80) / 100)),
            ...(watermark.corner === 'tl' ? { top: 24 * scale, left: 24 * scale } : {}),
            ...(watermark.corner === 'tr' ? { top: 24 * scale, right: 24 * scale } : {}),
            ...(watermark.corner === 'bl' ? { bottom: 24 * scale, left: 24 * scale } : {}),
            ...(!watermark.corner || watermark.corner === 'br' ? { bottom: 24 * scale, right: 24 * scale } : {}),
          }}
        />
      ) : null}

      {transIn === 'fade' ? (
        <AbsoluteFill style={{ pointerEvents: 'none', background: '#000', opacity: interpolate(frame, [0, 16], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }} />
      ) : null}
      {transOut === 'fade' ? (
        <AbsoluteFill style={{ pointerEvents: 'none', background: '#000', opacity: interpolate(frame, [Math.max(0, durationInFrames - 16), durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }} />
      ) : null}

      {music && typeof music.url === 'string' && music.url ? (
        <Audio src={music.url} volume={Math.min(1, Math.max(0, Number(music.volume) || 0.35))} loop />
      ) : null}
    </AbsoluteFill>
  );
}
`;
