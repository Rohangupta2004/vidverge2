// ELEMENT COMPOSITION VIEW — the browser preview of a structured element
// composition, driven by the EXACT same math the production Remotion render
// uses (lib/elementComposition.elementStateAt / resolveElementStates — the
// generated source in remotion/AssemblyComp embeds the plain-JS mirror).
// Preview → final render consistency is a product guarantee: if it looks
// right here, the server render interprets the same numbers the same way.
//
// Sizing note: the render draws text in px at 1080p; this preview draws in em
// against the stage's container-scaled font size (the same convention the
// caption/overlay previews use), with 1em ≈ 21.25px at 1080p.

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { anchorOrigin, cameraStateAt, elementEase, resolveElementStates, type CompositionCamera, type CompositionElement, type ElementComposition } from '../lib/elementComposition';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const em = (px: number) => `${(px / 21.25).toFixed(2)}em`;
const FONT: Record<string, number> = { headline: 64, subhead: 44, label: 30, stat: 96, caption: 24 };

function anchorTranslate(anchor?: string): string {
  let tx = '-50%'; let ty = '-50%';
  if (anchor === 'top_left' || anchor === 'left' || anchor === 'bottom_left') tx = '0%';
  if (anchor === 'top_right' || anchor === 'right' || anchor === 'bottom_right') tx = '-100%';
  if (anchor === 'top_left' || anchor === 'top' || anchor === 'top_right') ty = '0%';
  if (anchor === 'bottom_left' || anchor === 'bottom' || anchor === 'bottom_right') ty = '-100%';
  return `translate(${tx},${ty})`;
}

export default function ElementCompositionView({ elements, tSec, durationSec, camera, background, backdropUrl, enableDepth = false }: {
  elements: CompositionElement[];
  /** Seconds inside the SCENE window. */
  tSec: number;
  durationSec: number;
  camera?: CompositionCamera | null;
  background?: string;
  backdropUrl?: string;
  /** CSS 3D is enabled for the Remotion-style video-backed compositor preview. */
  enableDepth?: boolean;
}) {
  const states = resolveElementStates(elements, tSec);
  const ordered = [...elements].sort((a, b) => (a.z || 0) - (b.z || 0));
  return <div className="compositor" style={{ position: 'absolute', inset: 0, background: background || 'transparent', overflow: 'hidden', ...(enableDepth ? { perspective: '1200px', transformStyle: 'preserve-3d' as const } : {}) }}> 
    {backdropUrl ? <div style={{ position: 'absolute', inset: '-2%', opacity: 0.3 }}><img src={backdropUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div> : null}
    <div style={{ position: 'absolute', inset: 0, ...(enableDepth ? { transformStyle: 'preserve-3d' as const } : {}) }}> 
      {ordered.map((el) => {
        const depth = el.depth_z ?? 0.5;
        const cam = cameraStateAt(camera || undefined, tSec, durationSec, depth);
        const zOffset = enableDepth ? depth * -300 : 0;
        const parallaxX = enableDepth ? cam.x * 1920 : 0;
        const parallaxY = enableDepth ? cam.y * 1080 : 0;
        const st = states.get(el.id);
        if (!st || !st.visible || st.opacity <= 0.004) return null;
        // LightBeam default: an element with no accent of its own reads as
        // beam gold, never the old blue.
        const accent = el.accent || '#F5B936';
        const dxp = st.x - el.x; const dyp = st.y - el.y;
        if (el.kind === 'arrow' || el.kind === 'line') {
          const x1 = st.x * 1920; const y1 = st.y * 1080;
          const x2 = ((el.tx ?? st.x) + dxp) * 1920; const y2 = ((el.ty ?? st.y) + dyp) * 1080;
          const ddx = x2 - x1; const ddy = y2 - y1; const len = Math.max(1, Math.sqrt(ddx * ddx + ddy * ddy));
          const hx = x2 - (ddx / len) * 30; const hy = y2 - (ddy / len) * 30;
          const px = -(ddy / len) * 17; const py = (ddx / len) * 17;
          return <div key={el.id} style={{ position: 'absolute', inset: 0, zIndex: 10 + (el.z || 0), opacity: st.opacity, pointerEvents: 'none' }}>
            <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <line x1={x1} y1={y1} x2={x1 + ddx * st.draw} y2={y1 + ddy * st.draw} stroke={accent} strokeWidth={7} strokeLinecap="round" />
              {el.kind === 'arrow' && st.draw > 0.94 ? <polygon points={`${x2},${y2} ${hx + px},${hy + py} ${hx - px},${hy - py}`} fill={accent} /> : null}
            </svg>
          </div>;
        }
        const wrap: Record<string, any> = {
          position: 'absolute',
          left: `${st.x * 100}%`,
          top: `${st.y * 100}%`,
          width: `${(el.w || 0.3) * 100}%`,
          height: el.h !== undefined ? `${el.h * 100}%` : undefined,
          zIndex: 10 + (el.z || 0),
          opacity: st.opacity,
          transform: `translateX(${parallaxX}px) translateY(${parallaxY}px) translateZ(${zOffset}px) ${anchorTranslate(el.anchor)} rotate(${st.rotation}deg) scale(${st.scale * cam.scale})`,
          transformOrigin: anchorOrigin(el.anchor || 'center'),
          clipPath: st.clipPath || undefined,
          filter: st.blur ? `blur(${st.blur}px)` : undefined,
          pointerEvents: 'none',
          fontFamily: "'Inter', system-ui, sans-serif",
        };
        if (el.kind === 'image') {
          return <div key={el.id} style={{ ...wrap, borderRadius: el.radius ?? 14, overflow: 'hidden', boxShadow: '0 20px 55px rgba(0,0,0,0.45)' }}>
            <img src={el.asset_url} alt="" style={{ width: '100%', height: el.h !== undefined ? '100%' : 'auto', objectFit: el.fit || 'contain', display: 'block' }} />
          </div>;
        }
        if (el.kind === 'card') {
          return <div key={el.id} style={{ ...wrap, background: el.bg || 'rgba(8,12,24,0.82)', borderRadius: el.radius ?? 20, border: '1.5px solid rgba(255,255,255,0.12)', boxShadow: '0 22px 60px rgba(0,0,0,0.5)' }} />;
        }
        if (el.kind === 'highlight') {
          return <div key={el.id} style={{ ...wrap, height: wrap.height || '8%', background: el.accent || 'rgba(245,158,11,0.55)', borderRadius: el.radius ?? 10, opacity: st.opacity * 0.55 }} />;
        }
        if (el.kind === 'underline') {
          return <div key={el.id} style={{ ...wrap, height: '0.4em', width: `${(el.w || 0.2) * st.draw * 100}%`, background: accent, borderRadius: 4 }} />;
        }
        if (el.kind === 'stat') {
          const target = el.value || 0;
          const shown = Math.abs(target) >= 10 ? Math.round(target * st.count) : Math.round(target * st.count * 10) / 10;
          return <div key={el.id} style={{ ...wrap, textAlign: 'center' }}>
            <div style={{ fontSize: em(FONT.stat), fontWeight: 900, lineHeight: 1, color: accent, textShadow: '0 6px 30px rgba(0,0,0,0.7)' }}>{`${el.prefix || ''}${shown}${el.suffix || ''}`}</div>
            {el.text ? <div style={{ marginTop: '0.4em', fontSize: em(26), fontWeight: 600, color: 'rgba(255,255,255,0.92)', textShadow: '0 3px 16px rgba(0,0,0,0.7)' }}>{el.text}</div> : null}
          </div>;
        }
        if (el.kind === 'chart') {
          const items = el.items || [];
          const maxVal = Math.max(1, ...items.map((item) => Number(item.value) || 0));
          return <div key={el.id} style={{ ...wrap, height: wrap.height || '30%', display: 'flex', alignItems: 'flex-end', gap: '6%', padding: '2%' }}>
            {items.map((item, i) => {
              const bp = clamp01(st.draw * items.length - i);
              const v = Number.isFinite(Number(item.value)) ? Number(item.value) : maxVal * 0.6;
              return <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                {bp > 0.9 && Number.isFinite(Number(item.value)) ? <div style={{ fontSize: em(24), fontWeight: 800, color: '#fff', marginBottom: '0.25em' }}>{item.value}</div> : null}
                <div style={{ width: '70%', height: `${Math.max(0.02, (v / maxVal) * elementEase(bp, 'ease-out')) * 78}%`, background: accent, borderRadius: 6, boxShadow: '0 8px 26px rgba(0,0,0,0.4)' }} />
                <div style={{ marginTop: '0.35em', fontSize: em(20), fontWeight: 600, color: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>{item.label}</div>
              </div>;
            })}
          </div>;
        }
        if (el.kind === 'progress') {
          const steps = el.items || [];
          return <div key={el.id} style={{ ...wrap, display: 'flex', flexDirection: 'column', gap: '0.5em', justifyContent: 'center' }}>
            {steps.map((_, i) => {
              const sp = clamp01(st.draw * steps.length - i);
              return <div key={i} style={{ height: '0.5em', width: `${elementEase(sp, 'ease-out') * 100}%`, background: el.accent || accent, borderRadius: 4, opacity: 0.5 + 0.5 * sp }} />;
            })}
          </div>;
        }
        if (el.kind === 'pill') {
          return <div key={el.id} style={{ ...wrap, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: el.bg || 'rgba(8,12,24,0.82)', border: '1.5px solid rgba(255,255,255,0.14)', borderLeft: `0.25em solid ${accent}`, borderRadius: el.radius ?? 12, padding: '0.55em 0.85em', textAlign: 'center', boxShadow: '0 12px 36px rgba(0,0,0,0.45)' }}>
            <div style={{ fontSize: em(28), fontWeight: 800, lineHeight: 1.2, color: '#fff' }}>{el.text}</div>
            {el.subtext ? <div style={{ marginTop: '0.2em', fontSize: em(20), fontWeight: 500, color: 'rgba(255,255,255,0.82)' }}>{el.subtext}</div> : null}
          </div>;
        }
        const variant = el.variant || 'label';
        const fsize = FONT[variant] || FONT.label;
        return <div key={el.id} style={{ ...wrap, textAlign: 'center' }}>
          {el.text ? <div style={{ fontSize: em(fsize), fontWeight: variant === 'headline' ? 800 : 700, lineHeight: 1.16, color: '#fff', textShadow: '0 4px 24px rgba(0,0,0,0.75)' }}>{el.text}</div> : null}
          {el.subtext ? <div style={{ marginTop: '0.45em', fontSize: em(Math.round(fsize * 0.52)), fontWeight: 500, lineHeight: 1.3, color: 'rgba(255,255,255,0.9)', textShadow: '0 3px 16px rgba(0,0,0,0.7)' }}>{el.subtext}</div> : null}
        </div>;
      })}
    </div>
  </div>;
}

/**
 * Self-clocked looping player for a standalone composition — used by the
 * Settings panel's motion-system acceptance test. Purely a preview: nothing
 * here records anything.
 */
export function ElementCompositionPlayer({ composition }: { composition: ElementComposition }) {
  const [tSec, setTSec] = useState(0);
  const [playing, setPlaying] = useState(true);
  const raf = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setTSec((t) => (t + dt) % Math.max(1, composition.duration));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, composition.duration]);
  return <div>
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 14, overflow: 'hidden', background: '#05070f', containerType: 'inline-size', fontSize: 'clamp(6px, 1.6cqw, 22px)' } as Record<string, any>}>
      <ElementCompositionView elements={composition.elements} tSec={tSec} durationSec={composition.duration} camera={composition.camera} background={composition.background} backdropUrl={composition.backdrop_url} enableDepth />
    </div>
    <div className="mt-2 flex items-center gap-3">
      <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--space-brand-primary-600)] text-white">{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
      <input type="range" min={0} max={composition.duration} step={0.05} value={tSec} onChange={(event) => { setPlaying(false); setTSec(Number(event.target.value)); }} className="h-1.5 flex-1 accent-[var(--space-brand-primary-500)]" aria-label="Scrub the composition" />
      <span className="font-mono text-xs text-[var(--space-text-muted)]">{tSec.toFixed(1)}s / {composition.duration.toFixed(1)}s</span>
    </div>
  </div>;
}
