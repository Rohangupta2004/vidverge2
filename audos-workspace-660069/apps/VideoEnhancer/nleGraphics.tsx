/**
 * Video Enhancer NLE — kinetic motion-graphic PREVIEW renderer.
 *
 * Mirrors the export composition inside the veh-render server function: the
 * same five presets, the same easeOutBack / easeOutCubic progress math, so
 * the preview is a faithful picture of the final render. Pure React + inline
 * styles — styles are computed from the local time `t`, no animation library.
 */
import type { MotionGraphic } from './nleCore';
import { clamp01, easeOutBack, easeOutCubic } from './nleCore';

const SANS = 'Inter, system-ui, -apple-system, sans-serif';

/**
 * @param g   the graphic
 * @param t   seconds since the graphic's start (0..duration)
 * @param sw  stage width in px (font sizes scale off it, like the render)
 */
export default function GraphicOverlay({ g, t, sw }: { g: MotionGraphic; t: number; sw: number }) {
  const dur = Math.max(0.6, g.duration || 2);
  if (t < 0 || t > dur) return null;
  const p = clamp01(t / 0.5);
  const q = clamp01((dur - t) / 0.35);
  const accent = g.accent || '#f59e0b';
  const topPct = g.position === 'top' ? '9%' : g.position === 'center' ? '36%' : '66%';
  const base: React.CSSProperties = {
    position: 'absolute', left: 0, right: 0, top: topPct, display: 'flex',
    flexDirection: 'column', alignItems: g.kind === 'lowerthird' ? 'flex-start' : 'center',
    padding: g.kind === 'lowerthird' ? `0 ${Math.round(sw * 0.06)}px` : `0 ${Math.round(sw * 0.05)}px`,
    opacity: q, pointerEvents: 'none', fontFamily: SANS, textAlign: 'center',
  };

  if (g.kind === 'hook') {
    const words = String(g.text || '').split(/\s+/).filter(Boolean).slice(0, 10);
    const underline = clamp01((t - words.length * 0.12) / 0.35);
    return (
      <div style={base}>
        <div>
          {words.map((w, i) => {
            const wp = clamp01((t - i * 0.12) / 0.34);
            return (
              <span key={i} style={{ display: 'inline-block', margin: `0 ${Math.round(sw * 0.008)}px`, color: i % 3 === 2 ? accent : '#fff', fontSize: Math.round(sw * 0.075), fontWeight: 900, letterSpacing: -1, textTransform: 'uppercase', opacity: wp, transform: `scale(${0.3 + easeOutBack(wp) * 0.7}) rotate(${(1 - wp) * (i % 2 ? 4 : -4)}deg)`, textShadow: '0 6px 30px rgba(0,0,0,0.85)' }}>{w}</span>
            );
          })}
        </div>
        <div style={{ height: Math.max(3, Math.round(sw * 0.006)), width: underline * sw * 0.34, background: accent, borderRadius: 999, marginTop: Math.round(sw * 0.012), boxShadow: `0 0 18px ${accent}` }} />
      </div>
    );
  }

  if (g.kind === 'pop') {
    return (
      <div style={base}>
        <span style={{ display: 'inline-block', color: '#fff', fontSize: Math.round(sw * 0.095), fontWeight: 900, letterSpacing: -2, textTransform: 'uppercase', transform: `scale(${0.25 + easeOutBack(p) * 0.75}) rotate(${(1 - easeOutCubic(p)) * -5}deg)`, opacity: clamp01(p * 2), textShadow: `0 0 34px ${accent}, 0 8px 30px rgba(0,0,0,0.9)`, WebkitTextStroke: '2px rgba(0,0,0,0.35)' }}>{g.text}</span>
      </div>
    );
  }

  if (g.kind === 'lowerthird') {
    const bar = easeOutCubic(clamp01(t / 0.3));
    const slide = easeOutBack(clamp01((t - 0.16) / 0.4));
    return (
      <div style={base}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: Math.round(sw * 0.012), transform: `translateX(${(1 - slide) * -sw * 0.08}px)`, opacity: clamp01(p * 2) }}>
          <div style={{ width: Math.max(4, Math.round(sw * 0.007)), background: accent, borderRadius: 3, transform: `scaleY(${bar})`, transformOrigin: 'top', boxShadow: `0 0 14px ${accent}` }} />
          <div style={{ textAlign: 'left', background: 'rgba(0,0,0,0.45)', borderRadius: Math.round(sw * 0.008), padding: `${Math.round(sw * 0.012)}px ${Math.round(sw * 0.02)}px` }}>
            <div style={{ color: '#fff', fontSize: Math.round(sw * 0.032), fontWeight: 800 }}>{g.text}</div>
            {g.sub ? <div style={{ color: accent, fontSize: Math.round(sw * 0.02), fontWeight: 600, marginTop: 2, opacity: clamp01((t - 0.3) / 0.3) }}>{g.sub}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  if (g.kind === 'stat') {
    const target = Number(g.value) || 0;
    const shown = Math.round(target * easeOutCubic(clamp01(t / (dur * 0.6))));
    return (
      <div style={base}>
        <div style={{ transform: `scale(${0.5 + easeOutBack(p) * 0.5})`, opacity: clamp01(p * 2), background: 'rgba(0,0,0,0.4)', border: `${Math.max(2, Math.round(sw * 0.004))}px solid ${accent}`, borderRadius: 999, padding: `${Math.round(sw * 0.03)}px ${Math.round(sw * 0.05)}px`, boxShadow: `0 0 30px rgba(0,0,0,0.5), 0 0 22px ${accent}` }}>
          <div style={{ color: accent, fontSize: Math.round(sw * 0.085), fontWeight: 900, letterSpacing: -2, lineHeight: 1 }}>{shown.toLocaleString()}{g.text && /^[%xX+]/.test(g.text) ? g.text[0] : ''}</div>
          {g.sub ? <div style={{ color: '#fff', fontSize: Math.round(sw * 0.022), fontWeight: 700, marginTop: 6 }}>{g.sub}</div> : null}
        </div>
      </div>
    );
  }

  // cta
  const rise = easeOutBack(clamp01(t / 0.45));
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  return (
    <div style={base}>
      <div style={{ transform: `translateY(${(1 - rise) * 90}px)`, opacity: clamp01(p * 2), background: `linear-gradient(135deg, ${accent} 0%, #d97706 100%)`, color: '#1a1205', fontSize: Math.round(sw * 0.032), fontWeight: 900, padding: `${Math.round(sw * 0.016)}px ${Math.round(sw * 0.04)}px`, borderRadius: 999, boxShadow: `0 0 ${18 + pulse * 30}px rgba(245,158,11,0.65)` }}>
        {g.text} {g.sub ? <span style={{ fontWeight: 600 }}>· {g.sub}</span> : null}
      </div>
    </div>
  );
}
