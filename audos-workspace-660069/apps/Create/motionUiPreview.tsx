/**
 * VidVerge — MOTION UI: the in-browser live preview player.
 *
 * Animates a Motion Plan client-side from the SAME runtime math the server
 * composition mirrors (motionUiRuntime / motionUiComposition), so what the
 * visitor scrubs is what renders. It is a faithful approximation, not a
 * pixel-exact render: fonts, shadows and easing match closely enough to review,
 * regenerate, edit and approve before spending a render.
 *
 * The preview box IS the safe frame (its aspect matches the plan), so there is
 * no letterboxing here — the background fills the box, the world is transformed
 * by the single global camera inside it, and text sits in screen space on top.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import {
  anchorPosition,
  revealText,
  sampleCamera,
  sampleLayer,
  sampleText,
} from './motionUiRuntime';
import { aspectRatioValue } from './motionUiPresets';
import {
  clamp,
  type AssetLayer,
  type MotionAsset,
  type MotionGraphic,
  type MotionPlan,
  type TextCue,
} from './motionUiTypes';

// A tiny local helper (avoids importing from the runtime module for one value).
function planSecs(plan: MotionPlan): number {
  return clamp(plan.duration || 1, 1, 600);
}

function Graphic({ g, t, W, H }: { g: MotionGraphic; t: number; W: number; H: number }) {
  const op = clamp(g.intensity || 0.3, 0.05, 1);
  if (g.kind === 'glow') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(${W * 0.5}px ${W * 0.5}px at ${30 + Math.sin(t * 0.3) * 10}% ${
            40 + Math.cos(t * 0.25) * 10
          }%, ${g.color}${Math.round(op * 40).toString(16).padStart(2, '0')}, transparent 60%)`,
        }}
      />
    );
  }
  if (g.kind === 'grid') {
    const off = (t * 10) % 40;
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: op,
          backgroundImage: `linear-gradient(${g.color}22 1px, transparent 1px), linear-gradient(90deg, ${g.color}22 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          backgroundPosition: `${off}px ${off}px`,
        }}
      />
    );
  }
  if (g.kind === 'dots') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: op,
          backgroundImage: `radial-gradient(${g.color}55 1.5px, transparent 1.5px)`,
          backgroundSize: '30px 30px',
          backgroundPosition: `${(t * 6) % 30}px 0px`,
        }}
      />
    );
  }
  if (g.kind === 'beams') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: op * 0.6,
          transform: `rotate(${t * 8}deg) scale(1.6)`,
          transformOrigin: 'center',
          backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, transparent 90px, ${g.color}22 92px, transparent 98px)`,
        }}
      />
    );
  }
  if (g.kind === 'rings') {
    const scale = 1 + Math.sin(t * 0.6) * 0.06;
    return (
      <div style={{ position: 'absolute', inset: 0, opacity: op }}>
        {[0, 1, 2, 3].map((i) => {
          const size = W * 0.2 + i * W * 0.16;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: size,
                height: size,
                marginLeft: -size / 2,
                marginTop: -size / 2,
                borderRadius: '50%',
                border: `1px solid ${g.color}33`,
                transform: `scale(${scale + i * 0.02})`,
              }}
            />
          );
        })}
      </div>
    );
  }
  if (g.kind === 'lines') {
    return (
      <div style={{ position: 'absolute', inset: 0, opacity: op }}>
        {[0, 1, 2, 3, 4].map((j) => {
          const y = ((j + 1) / 6) * H;
          const dx = (((t * 30 + j * 80) % (W + 200)) - 100);
          return <div key={j} style={{ position: 'absolute', left: dx, top: y, width: 90, height: 2, background: `${g.color}55` }} />;
        })}
      </div>
    );
  }
  if (g.kind === 'particles') {
    return (
      <div style={{ position: 'absolute', inset: 0, opacity: op }}>
        {Array.from({ length: 26 }).map((_, k) => {
          const seedX = ((k * 97) % 100) / 100;
          const seedY = ((k * 57) % 100) / 100;
          const sp = 0.2 + (k % 5) * 0.08;
          const py = (((seedY - t * sp * 0.05) % 1) + 1) % 1;
          const sz = 3 + (k % 3);
          return (
            <div
              key={k}
              style={{ position: 'absolute', left: seedX * W, top: py * H, width: sz, height: sz, borderRadius: '50%', background: g.color, opacity: 0.4 + (k % 4) * 0.1 }}
            />
          );
        })}
      </div>
    );
  }
  return null;
}

function LayerView({
  layer,
  url,
  screenUrl,
  t,
  brand,
  W,
  H,
}: {
  layer: AssetLayer;
  url?: string;
  screenUrl?: string;
  t: number;
  brand: MotionPlan['brand'];
  W: number;
  H: number;
}) {
  const s = sampleLayer(layer, t);
  if (!s.visible) return null;
  const w = layer.worldScale * W;
  const cx = W / 2 + (layer.worldX + s.dx) * W;
  const cy = H / 2 + (layer.worldY + s.dy) * H;
  const radius = layer.frameStyle === 'device' ? 22 : layer.frameStyle === 'none' ? 0 : 12;

  let media: JSX.Element;
  if (url && (layer.kind === 'ai_video' || layer.kind === 'avatar')) {
    media = <video src={url} autoPlay muted loop playsInline style={{ width: '100%', aspectRatio: `${W} / ${H}`, objectFit: 'cover', display: 'block', borderRadius: radius }} />;
  } else if (url) {
    media = <img src={url} alt="" style={{ width: '100%', height: 'auto', display: 'block', borderRadius: layer.frameStyle === 'browser' ? 0 : radius }} />;
  } else {
    media = <div style={{ width: '100%', paddingBottom: '60%', background: `linear-gradient(135deg, ${brand.primary}33, ${brand.secondary}22)` }} />;
  }

  let inner: JSX.Element = media;
  const tracked = layer.screenComposite;
  if (layer.kind === 'ai_video' && tracked && tracked.trackingConfidence >= 0.85 && screenUrl) {
    inner = (
      <div style={{ position: 'relative', width: '100%', aspectRatio: `${W} / ${H}`, overflow: 'hidden', borderRadius: radius }}>
        {media}
        <img
          src={screenUrl}
          alt=""
          style={{
            position: 'absolute',
            left: `${tracked.x * 100}%`,
            top: `${tracked.y * 100}%`,
            width: `${tracked.width * 100}%`,
            height: `${tracked.height * 100}%`,
            objectFit: 'fill',
            transform: `translate(-50%,-50%) perspective(1200px) rotateX(${tracked.rotateX || 0}deg) rotateY(${tracked.rotateY || 0}deg) rotateZ(${tracked.rotateZ || 0}deg) skew(${tracked.skewX || 0}deg, ${tracked.skewY || 0}deg)`,
            transformOrigin: 'center',
            borderRadius: tracked.borderRadius || 0,
          }}
        />
      </div>
    );
  }
  if (layer.frameStyle === 'browser') {
    inner = (
      <div style={{ borderRadius: radius, overflow: 'hidden', background: '#0b1220', border: '1px solid rgba(255,255,255,0.12)' }}>
        <div style={{ height: 22, display: 'flex', alignItems: 'center', gap: 5, padding: '0 9px', background: 'rgba(255,255,255,0.06)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff5f57' }} />
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#febc2e' }} />
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#28c840' }} />
        </div>
        {media}
      </div>
    );
  } else if (layer.frameStyle === 'device') {
    inner = <div style={{ borderRadius: radius, overflow: 'hidden', border: '5px solid #0b0f18', background: '#0b0f18' }}>{media}</div>;
  } else if (layer.frameStyle === 'card') {
    inner = <div style={{ borderRadius: radius, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>{media}</div>;
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: cx,
        top: cy,
        width: w,
        transform: `translate(-50%,-50%) scale(${s.scale}) rotate(${layer.rotate || 0}deg)`,
        opacity: s.opacity,
        filter: layer.shadow ? 'drop-shadow(0 24px 48px rgba(0,0,0,0.5))' : 'none',
      }}
    >
      {inner}
    </div>
  );
}

function TextView({ cue, t, brand, W, H }: { cue: TextCue; t: number; brand: MotionPlan['brand']; W: number; H: number }) {
  const s = sampleText(cue, t);
  if (!s.visible) return null;
  const pos = anchorPosition(cue.anchor);
  const px = (pos.x + (cue.x || 0)) * W;
  const py = (pos.y + (cue.y || 0)) * H;
  const base = cue.level === 3 ? 0.11 : cue.level === 2 ? 0.062 : 0.032;
  const fontSize = base * H;
  const shown = revealText(cue.content, cue.animation, s.reveal);
  const color = cue.color || brand.text || '#fff';
  const wrap: CSSProperties = {
    position: 'absolute',
    left: px,
    top: py,
    maxWidth: W * 0.8,
    transform: `translate(-50%,-50%) translateY(${s.dy * H}px) scale(${s.scale})`,
    opacity: s.opacity,
    textAlign: cue.align || 'center',
  };
  if (cue.emphasis) {
    return (
      <div style={wrap}>
        <span
          style={{
            display: 'inline-block',
            padding: `${fontSize * 0.28}px ${fontSize * 0.6}px`,
            borderRadius: 999,
            background: brand.primary || '#2563eb',
            color: '#fff',
            fontFamily: brand.font,
            fontWeight: 800,
            fontSize,
            letterSpacing: `${s.tracking}em`,
          }}
        >
          {shown}
        </span>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <p
        style={{
          margin: 0,
          fontFamily: brand.font,
          fontWeight: cue.weight || 700,
          fontSize,
          lineHeight: 1.08,
          letterSpacing: `${(cue.level === 3 ? -0.02 : 0) + s.tracking}em`,
          color,
          clipPath: cue.animation === 'mask_reveal' ? `inset(0 ${Math.round((1 - s.mask) * 100)}% 0 0)` : 'none',
          whiteSpace: 'pre-wrap',
        }}
      >
        {shown}
      </p>
    </div>
  );
}

function backgroundStyle(plan: MotionPlan, t: number): CSSProperties {
  const bg = plan.background;
  const brand = plan.brand;
  const colors = bg.colors && bg.colors.length ? bg.colors : [brand.background, brand.primary];
  const base = colors[0] || '#0A0F1E';
  const drift = bg.animation === 'slow_drift' ? Math.sin(t * 0.25) * 8 : bg.animation === 'pan' ? (t * 6) % 100 : 0;
  const pulse = bg.animation === 'pulse' ? 0.5 + Math.sin(t * 0.8) * 0.14 : 0.5;
  if (bg.type === 'gradient') {
    return {
      backgroundImage: `radial-gradient(1200px 700px at ${30 + drift}% ${10 + drift}%, ${colors[1] || '#2563eb'}55, transparent 60%), radial-gradient(1000px 650px at ${80 - drift}% 90%, ${colors[2] || colors[1] || '#60a5fa'}33, transparent 62%), linear-gradient(145deg, ${base}, ${base})`,
    };
  }
  if (bg.type === 'mesh') {
    return {
      backgroundImage: `radial-gradient(700px 700px at ${20 + drift}% 30%, ${colors[1] || '#2563eb'}44, transparent 55%), radial-gradient(650px 650px at ${78 - drift}% 68%, ${colors[2] || '#22d3ee'}3a, transparent 58%), ${base}`,
    };
  }
  if (bg.type === 'spotlight') {
    return {
      backgroundImage: `radial-gradient(900px 900px at 50% ${36 + drift}%, ${colors[1] || '#2563eb'}${Math.round(pulse * 60).toString(16)}, transparent 55%), ${base}`,
    };
  }
  return { background: base };
}

/**
 * The player. Owns its own playhead (rAF), exposes play/pause + a scrubber, and
 * loops. `stage` overlays a generation-stage line while a plan is being built.
 */
export default function MotionPreview({
  plan,
  assets,
  stage,
  onApproxTime,
}: {
  plan: MotionPlan | null;
  assets: MotionAsset[];
  stage?: string | null;
  onApproxTime?: (t: number) => void;
}) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);

  const duration = plan ? planSecs(plan) : 1;
  const ratio = aspectRatioValue(plan?.aspectRatio || '16:9');

  useLayoutEffect(() => {
    const measure = () => {
      const el = boxRef.current;
      if (!el) return;
      const w = el.clientWidth;
      setBox({ w, h: w / ratio });
    };
    measure();
    if (typeof ResizeObserver !== 'undefined' && boxRef.current) {
      const ro = new ResizeObserver(measure);
      ro.observe(boxRef.current);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ratio]);

  useEffect(() => {
    if (!playing || !plan) return;
    lastRef.current = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      setTime((prev) => {
        const next = prev + dt;
        return next >= duration ? 0 : next;
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, plan, duration]);

  // Report the playhead to the parent (for the Quick Editor), throttled so a
  // 60fps preview does not re-render the whole studio on every frame.
  const reportedRef = useRef(0);
  useEffect(() => {
    if (!onApproxTime) return;
    if (Math.abs(time - reportedRef.current) < 0.12) return;
    reportedRef.current = time;
    onApproxTime(time);
  }, [time, onApproxTime]);

  if (!plan) {
    return (
      <div
        ref={boxRef}
        style={{ width: '100%', aspectRatio: `${ratio}`, borderRadius: 16, background: '#0A0F1E', border: '1px solid rgba(255,255,255,0.08)' }}
      />
    );
  }

  const { w: W, h: H } = box;
  const cam = sampleCamera(plan.camera, time);
  const graphics = plan.graphics || [];
  const back = graphics.filter((g) => g.depth !== 'front');
  const front = graphics.filter((g) => g.depth === 'front');
  const urlFor = (assetId: string) => assets.find((a) => a.id === assetId)?.url;

  return (
    <div style={{ width: '100%' }}>
      <div
        ref={boxRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${ratio}`,
          borderRadius: 16,
          overflow: 'hidden',
          background: plan.brand.background,
          border: '1px solid rgba(255,255,255,0.1)',
          fontFamily: plan.brand.font,
        }}
        data-testid="motion-preview"
      >
        <div style={{ position: 'absolute', inset: 0, ...backgroundStyle(plan, time) }} />
        <div style={{ position: 'absolute', inset: 0 }}>
          {back.map((g, i) => (
            <Graphic key={g.id || i} g={g} t={time} W={W} H={H} />
          ))}
        </div>
        {/* The single global camera transforms the shared world. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${cam.x * W}px, ${cam.y * H}px) scale(${cam.scale}) rotate(${cam.rotate || 0}deg)`,
            transformOrigin: 'center center',
          }}
        >
          {plan.layers.map((l, i) => {
            const screenId = l.screenComposite?.assetId || l.screenAssetId || '';
            return (
              <LayerView
                key={l.id || i}
                layer={l}
                url={l.clipUrl || urlFor(l.assetId)}
                screenUrl={screenId ? urlFor(screenId) : undefined}
                t={time}
                brand={plan.brand}
                W={W}
                H={H}
              />
            );
          })}
        </div>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {front.map((g, i) => (
            <Graphic key={g.id || i} g={g} t={time} W={W} H={H} />
          ))}
        </div>
        <div style={{ position: 'absolute', inset: 0 }}>
          {plan.text.map((c, i) => (
            <TextView key={c.id || i} cue={c} t={time} brand={plan.brand} W={W} H={H} />
          ))}
        </div>
        {stage ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(4,10,20,0.55)',
              backdropFilter: 'blur(2px)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: 0.2,
              textAlign: 'center',
              padding: 20,
            }}
            data-testid="motion-preview-stage"
          >
            {stage}
          </div>
        ) : null}
      </div>

      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="motion-preview-playpause"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.16)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={time}
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
          aria-label="Scrub"
          data-testid="motion-preview-scrub"
          style={{ flex: 1, accentColor: plan.brand.primary || '#2563eb' }}
        />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', minWidth: 74, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {time.toFixed(1)}s / {duration.toFixed(0)}s
        </span>
      </div>
    </div>
  );
}
