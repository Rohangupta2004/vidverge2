// KEN BURNS — a still photograph given motion. Slow push in, slight drift,
// soft vignette, and the caption sitting on a dark gradient so it stays
// readable over any picture.
//
// With no resolved image the scene degrades to a typographic plate rather
// than rendering an empty black frame — a missing stock photo must never
// cost the viewer a beat of the film.
import { DIRECTOR_THEME, clamp01, easeOut, window01, fitHeadline, type VisualProps } from './visualTheme';

export default function ImageKenBurnsVisual({ spec, progress, accent = DIRECTOR_THEME.accent }: VisualProps) {
  const url = spec.visual.imageUrl || '';
  const caption = spec.visual.label || spec.visual.elements[0] || '';
  const fade = clamp01(progress / 0.12) * clamp01((1 - progress) / 0.1 + 0.9);

  // Direction decides which way the frame drifts; the push is always inward
  // so the shot feels like it is being entered rather than left. `left\b`
  // deliberately does not match "left_to_right" — underscore is a word
  // character — which is the same rule the render uses via visual.reversed.
  const direction = String(spec.visual.direction || '').toLowerCase();
  const dx = /right_to_left|backward|left\b/.test(direction) ? -1 : 0.4;
  const k = easeOut(progress);
  const scale = 1.08 + 0.14 * progress;
  const shift = `${dx * 2.6 * k}%, ${-0.66 * k}%`;

  if (!url) {
    const text = caption || spec.caption || spec.narration;
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DIRECTOR_THEME.font, padding: 160 }}>
        <div style={{ textAlign: 'center', opacity: fade, transform: `scale(${0.94 + 0.06 * k})` }}>
          <div style={{ fontSize: fitHeadline(text, 96, 44), fontWeight: 700, color: DIRECTOR_THEME.text, lineHeight: 1.15, letterSpacing: '-0.02em' }}>{text}</div>
          <div style={{ marginTop: 28, height: 5, width: 180, borderRadius: 3, background: accent, margin: '28px auto 0' }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', fontFamily: DIRECTOR_THEME.font }}>
      <img
        src={url}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${shift})`,
          opacity: fade,
        }}
      />
      {/* Vignette: a soft inner shadow plus a bottom gradient for the text. */}
      <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 300px rgba(0,0,0,0.75)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '46%', background: 'linear-gradient(to top, rgba(8,8,8,0.92), rgba(8,8,8,0))', pointerEvents: 'none' }} />

      {caption ? (
        <div
          style={{
            position: 'absolute',
            left: 120,
            right: 120,
            bottom: 190,
            opacity: window01(progress, 0.1, 0.3),
            transform: `translateY(${(1 - easeOut(window01(progress, 0.1, 0.3))) * 26}px)`,
          }}
        >
          <div style={{ width: 84, height: 5, background: accent, borderRadius: 3, marginBottom: 20 }} />
          <div style={{ fontSize: 56, fontWeight: 700, color: '#fff', letterSpacing: '-0.015em', lineHeight: 1.18, textShadow: '0 6px 30px rgba(0,0,0,0.8)' }}>{caption}</div>
        </div>
      ) : null}

      {spec.visual.imageCredit ? (
        <div style={{ position: 'absolute', right: 36, top: 32, fontSize: 20, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}>{spec.visual.imageCredit}</div>
      ) : null}
    </div>
  );
}
