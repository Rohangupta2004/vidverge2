/**
 * REMOTION KIT — the SECONDARY rendering engine for Product Video scenes.
 *
 * GSAP + SVG browser capture remains the DEFAULT engine for graphics/mockup
 * scenes (fast, interactive, preview-identical). Remotion is available for
 * complex, frame-accurate, multi-layer compositions: set `engine: "remotion"`
 * on a captured scene's spec and the scene renders server-side through the
 * platform's Remotion pipeline (POST /api/render/remotion) instead of the
 * MediaRecorder capture. Any Remotion failure falls back to the GSAP capture
 * path automatically — a scene never dies because the secondary engine did.
 *
 * BOTH engines consume the SAME normalized scene spec (treatment, title,
 * subtitle, items, stat, palette, screenshot_url, device, …): this module
 * maps that spec onto a reusable in-composition component library — no
 * arbitrary per-scene Remotion code is ever generated.
 *
 * Reusable primitives (defined once inside the composition source):
 *   Background, VideoLayer, ImageLayer, TextLayer, CaptionLayer,
 *   ProductScreenshot, BrowserMockup, PhoneMockup, Diagram, Chart, Callout,
 *   Arrow, Highlight, AudioLayer, Transition
 *
 * PLATFORM GEOMETRY: the render service is locked to 1920×1080 @ 30fps, so
 * the Remotion engine is offered for 16:9 films only — 9:16 scenes always
 * use the GSAP capture engine (remotionAvailable() reports this).
 * AUDIO: compositions render VIDEO ONLY — narration, music and SFX are mixed
 * by the shared FFmpeg composition stage, exactly like every other scene, so
 * preview and final render stay on one composition path.
 */

import { Aspect, Film, FilmScene, appId } from './api';
import { brandPalette } from './scenes';

export const REMOTION_FPS = 30;

/** Does this scene ask for the Remotion engine? (normalized-spec flag) */
export function sceneWantsRemotion(scene: Pick<FilmScene, 'spec' | 'source'>): boolean {
  return (scene.source === 'graphic' || scene.source === 'mockup')
    && String((scene.spec as any)?.engine || '').toLowerCase() === 'remotion';
}

/** The platform render service is locked to 1920×1080 — 16:9 films only. */
export function remotionAvailable(aspect: Aspect): boolean {
  return aspect === '16:9';
}

// ---------------------------------------------------------------------------
// The reusable component library — ONE source string shared by every scene.
// Compositions are built from these primitives + props; never bespoke code.
// ---------------------------------------------------------------------------

const PRIMITIVES = `
import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const FPS = 30;
const ease = (frame, from, to, outFrom = 1, outTo = 1) =>
  interpolate(frame, [from, to], [outFrom, outTo], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

export const Background = ({ color, texture, children }) => (
  <AbsoluteFill style={{ background: color }}>
    {texture === 'grid' && (
      <AbsoluteFill style={{ opacity: 0.08, backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
    )}
    {texture === 'dots' && (
      <AbsoluteFill style={{ opacity: 0.1, backgroundImage: 'radial-gradient(#fff 1.5px, transparent 1.5px)', backgroundSize: '42px 42px' }} />
    )}
    {children}
  </AbsoluteFill>
);

export const VideoLayer = ({ src, style }) => <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />;
export const ImageLayer = ({ src, style }) => <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />;
export const AudioLayer = ({ src, volume = 1 }) => (src ? <Audio src={src} volume={volume} /> : null);

export const TextLayer = ({ text, sub, ink, accent, at = 0, size = 84 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - at, fps, config: { damping: 200 } });
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 120, textAlign: 'center' }}>
      <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: size, lineHeight: 1.12, color: ink, letterSpacing: -1.5, opacity: pop, transform: 'translateY(' + (1 - pop) * 30 + 'px)' }}>{text}</div>
      {sub ? <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: size * 0.38, color: accent, marginTop: 28, opacity: ease(frame, at + 12, at + 30) }}>{sub}</div> : null}
    </div>
  );
};

export const CaptionLayer = ({ text, ink, bg, at = 0 }) => {
  const frame = useCurrentFrame();
  if (!text) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 72, display: 'flex', justifyContent: 'center', opacity: ease(frame, at, at + 14) }}>
      <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 34, color: ink, background: bg, borderRadius: 14, padding: '14px 30px', maxWidth: 1200 }}>{text}</div>
    </div>
  );
};

export const Highlight = ({ x, y, w, h, accent, at = 0 }) => {
  const frame = useCurrentFrame();
  const on = ease(frame, at, at + 12);
  return <div style={{ position: 'absolute', left: (x * 100) + '%', top: (y * 100) + '%', width: (w * 100) + '%', height: (h * 100) + '%', border: '3px solid ' + accent, borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,' + 0.28 * on + ')', opacity: on }} />;
};

export const Callout = ({ text, xPct = 62, yPct = 20, accent, ink, at = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - at, fps, config: { damping: 16 } });
  if (!text) return null;
  return (
    <div style={{ position: 'absolute', left: xPct + '%', top: yPct + '%', transform: 'scale(' + pop + ')', transformOrigin: 'left center', background: accent, color: ink, fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 28, borderRadius: 12, padding: '10px 20px', boxShadow: '0 10px 34px rgba(0,0,0,0.35)' }}>{text}</div>
  );
};

export const Arrow = ({ fromX, fromY, toX, toY, accent, at = 0 }) => {
  const frame = useCurrentFrame();
  const p = ease(frame, at, at + 18);
  const x2 = fromX + (toX - fromX) * p; const y2 = fromY + (toY - fromY) * p;
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 1920 1080">
      <line x1={fromX} y1={fromY} x2={x2} y2={y2} stroke={accent} strokeWidth="6" strokeLinecap="round" />
      {p > 0.95 ? <circle cx={toX} cy={toY} r="12" fill={accent} /> : null}
    </svg>
  );
};

const DeviceFrame = ({ kind, src, ink }) => {
  const frame = useCurrentFrame();
  const drift = ease(frame, 0, 240, 1, 1.06);
  const shell = { position: 'relative', borderRadius: kind === 'phone' ? 44 : 18, background: '#0B0B0E', border: '2px solid rgba(255,255,255,0.14)', boxShadow: '0 40px 120px rgba(0,0,0,0.5)', overflow: 'hidden' };
  const size = kind === 'phone' ? { width: 380, height: 800 } : { width: 1280, height: 800 };
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...shell, ...size }}>
        {kind === 'browser' ? (
          <div style={{ height: 46, background: '#17171C', display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px' }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />)}
          </div>
        ) : null}
        <div style={{ position: 'absolute', top: kind === 'browser' ? 46 : 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
          <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', transform: 'scale(' + drift + ')', transformOrigin: 'center 20%' }} />
        </div>
      </div>
    </div>
  );
};
export const ProductScreenshot = (p) => <DeviceFrame kind="browser" {...p} />;
export const BrowserMockup = (p) => <DeviceFrame kind="browser" {...p} />;
export const PhoneMockup = (p) => <DeviceFrame kind="phone" {...p} />;

export const Diagram = ({ items, ink, accent, accent2, at = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const list = (items || []).slice(0, 5);
  const n = list.length || 1;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 38, padding: '0 120px' }}>
      {list.map((it, i) => {
        const start = at + i * 16;
        const pop = spring({ frame: frame - start, fps, config: { damping: 100 } });
        return (
          <React.Fragment key={i}>
            <div style={{ flex: 1, maxWidth: 1500 / n, background: 'rgba(255,255,255,0.06)', border: '2px solid ' + accent2, borderRadius: 20, padding: '34px 28px', textAlign: 'center', opacity: pop, transform: 'translateY(' + (1 - pop) * 26 + 'px)' }}>
              <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 38, color: ink }}>{it.label}</div>
              {it.sublabel ? <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 24, color: accent2, marginTop: 12 }}>{it.sublabel}</div> : null}
              {it.value ? <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 52, color: accent, marginTop: 12 }}>{it.value}</div> : null}
            </div>
            {i < n - 1 ? <div style={{ color: accent, fontSize: 54, fontWeight: 800, opacity: ease(frame, start + 12, start + 24) }}>→</div> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const Chart = ({ items, ink, accent, accent2, at = 0 }) => {
  const frame = useCurrentFrame();
  const list = (items || []).slice(0, 6);
  const max = Math.max(...list.map((i) => Number(i.value) || 1), 1);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 44, padding: '160px 180px 200px' }}>
      {list.map((it, i) => {
        const grow = ease(frame, at + i * 10, at + i * 10 + 26);
        const hPct = Math.max(0.08, (Number(it.value) || 1) / max) * grow;
        return (
          <div key={i} style={{ flex: 1, maxWidth: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 34, color: accent, marginBottom: 12, opacity: grow }}>{it.value}</div>
            <div style={{ width: '100%', height: (hPct * 100) + '%', background: i === list.length - 1 ? accent : accent2, borderRadius: '12px 12px 0 0' }} />
            <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 24, color: ink, marginTop: 14 }}>{it.label}</div>
          </div>
        );
      })}
    </div>
  );
};

export const Transition = ({ kind, durationInFrames, children }) => {
  const frame = useCurrentFrame();
  const inO = kind === 'fade' ? ease(frame, 0, 14) : 1;
  const outO = kind === 'fade' ? ease(frame, durationInFrames - 14, durationInFrames, 1, 0) : 1;
  return <AbsoluteFill style={{ opacity: Math.min(inO, outO) }}>{children}</AbsoluteFill>;
};
`;

// ---------------------------------------------------------------------------
// Spec → composition mapping (the same normalized spec the GSAP engine reads)
// ---------------------------------------------------------------------------

export interface RemotionBuild {
  compositionTsx: string;
  props: Record<string, unknown>;
  durationInFrames: number;
}

export function buildRemotionComposition(film: Film, scene: FilmScene, durationS: number): RemotionBuild {
  const spec: any = scene.spec || {};
  const pal = brandPalette(film);
  const durationInFrames = Math.max(REMOTION_FPS * 2, Math.round(durationS * REMOTION_FPS));
  const props = {
    palette: { bg: spec.palette?.bg || '#101014', ink: spec.palette?.ink || '#F4F2EE', accent: spec.palette?.accent || pal.accent, accent2: spec.palette?.accent2 || '#8D8B94' },
    texture: spec.texture || 'none',
    treatment: String(spec.treatment || (scene.source === 'mockup' ? 'mockup' : 'kinetic_type')),
    title: String(spec.title || spec.headline || scene.on_screen_text || '').slice(0, 120),
    subtitle: String(spec.subtitle || spec.caption || '').slice(0, 160),
    items: Array.isArray(spec.items) ? spec.items.slice(0, 6) : [],
    stat: spec.stat || null,
    screenshotUrl: String(spec.screenshot_url || spec.backdropUrl || '').startsWith('https://') ? String(spec.screenshot_url || spec.backdropUrl) : '',
    device: spec.device === 'phone' ? 'phone' : 'browser',
    focus: spec.focus && typeof spec.focus === 'object' ? spec.focus : null,
    callout: String(spec.cursor?.callout || '').slice(0, 60),
    transitionIn: scene.transition_in === 'fade' ? 'fade' : 'cut',
  };
  const compositionTsx = `${PRIMITIVES}

export default function Composition(props) {
  const p = props && props.palette ? props : ${JSON.stringify(props)};
  const { palette, texture, treatment, title, subtitle, items, stat, screenshotUrl, device, focus, callout, transitionIn } = p;
  const isChart = treatment === 'bars';
  const isFlow = treatment === 'flow' || treatment === 'node_map' || treatment === 'timeline' || treatment === 'compare';
  const isMock = (treatment === 'mockup' || screenshotUrl) && !!screenshotUrl && !isFlow && !isChart;
  return (
    <Transition kind={transitionIn} durationInFrames={${durationInFrames}}>
      <Background color={palette.bg} texture={texture}>
        {isMock ? (
          <>
            {device === 'phone'
              ? <PhoneMockup src={screenshotUrl} ink={palette.ink} />
              : <BrowserMockup src={screenshotUrl} ink={palette.ink} />}
            {focus ? <Highlight x={focus.x} y={focus.y} w={focus.w} h={focus.h} accent={palette.accent} at={26} /> : null}
            {callout ? <Callout text={callout} accent={palette.accent} ink={palette.bg} at={40} /> : null}
            {title ? <CaptionLayer text={title} ink={palette.bg} bg={palette.ink} at={10} /> : null}
          </>
        ) : isChart ? (
          <>
            <div style={{ position: 'absolute', top: 90, left: 0, right: 0, textAlign: 'center', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 56, color: palette.ink }}>{title}</div>
            <Chart items={items} ink={palette.ink} accent={palette.accent} accent2={palette.accent2} at={10} />
          </>
        ) : isFlow ? (
          <>
            <div style={{ position: 'absolute', top: 100, left: 0, right: 0, textAlign: 'center', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 56, color: palette.ink }}>{title}</div>
            {subtitle ? <div style={{ position: 'absolute', top: 178, left: 0, right: 0, textAlign: 'center', fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 30, color: palette.accent2 }}>{subtitle}</div> : null}
            <Diagram items={items} ink={palette.ink} accent={palette.accent} accent2={palette.accent2} at={16} />
          </>
        ) : stat && stat.value ? (
          <TextLayer text={String(stat.prefix || '') + String(stat.value) + String(stat.suffix || '')} sub={stat.label || subtitle} ink={palette.accent} accent={palette.ink} size={160} at={6} />
        ) : (
          <TextLayer text={title} sub={subtitle} ink={palette.ink} accent={palette.accent} at={6} />
        )}
      </Background>
    </Transition>
  );
}

export const calculateDemoVideoDuration = () => ${durationInFrames};
`;
  return { compositionTsx, props, durationInFrames };
}

// ---------------------------------------------------------------------------
// Submit + poll — the platform render pipeline (1920×1080 @ 30fps, fixed)
// ---------------------------------------------------------------------------

export async function renderRemotionScene(
  film: Film,
  scene: FilmScene,
  durationS: number,
  onNote?: (n: string) => void,
): Promise<string> {
  const say = (n: string) => { try { onNote?.(n); } catch { /* UI only */ } };
  const build = buildRemotionComposition(film, scene, durationS);
  say('submitting the Remotion composition…');
  const res = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
    body: JSON.stringify({
      workspaceId: appId(),
      compositionTsx: build.compositionTsx,
      props: build.props,
      durationInFrames: build.durationInFrames,
      fps: REMOTION_FPS,
      width: 1920,
      height: 1080,
    }),
  });
  const data = await res.json().catch(() => null);
  const operationId = data && (data.operationId || data.operation_id);
  if (!res.ok || typeof operationId !== 'string' || !operationId) {
    throw new Error(String(data?.error || `Remotion submit failed (HTTP ${res.status}).`));
  }
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(`/api/render/remotion/${encodeURIComponent(operationId)}`, { headers: { 'X-App-Id': appId() } });
    const body = await st.json().catch(() => null);
    const status = String(body?.status || '').toLowerCase();
    if ((status === 'complete' || status === 'completed') && body?.videoUrl) return String(body.videoUrl);
    if (status === 'failed' || status === 'error') throw new Error(String(body?.error || 'The Remotion render failed.'));
  }
  throw new Error('The Remotion render took too long (6 minutes) — falling back to the browser engine.');
}
