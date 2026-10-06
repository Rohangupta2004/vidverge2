/**
 * Short Video Enhancer — the LAYER source: every drawable in the stack.
 *
 * Like lib/motionSource.ts this is one shared text, so the preview Player and
 * the server render draw from exactly the same components. Layer order here IS
 * the product's Z-order, bottom to top:
 *
 *   AUDIO (voice / music / sfx)  — no pixels, mounted at the root
 *   VIDEO (clip 1..n, each with its own reframe + simulated camera move)
 *   TRANSITIONS (only ever between clips, inside the overlap window)
 *   BACKGROUND MOTION GRAPHICS   — behind the presenter
 *   SUBJECT (the segmented presenter / product, masked out of the same clip)
 *   FOREGROUND MOTION GRAPHICS   — in front of the presenter
 *   CAPTIONS
 *   HOOK                         — the opening 1-3 seconds, above everything
 *
 * The SUBJECT band is what makes the stack depth-aware. When a clip has depth
 * compositing on, the clip is drawn twice: once as a full background plate
 * (optionally blurred and dimmed) and again as a masked cutout ABOVE the
 * background graphics, so text and graphics can genuinely sit behind the
 * presenter. The two copies share one source range, one camera path and one
 * transition state, so they can never separate; only the plate carries audio.
 *
 * Nothing is baked into video pixels: each layer is an independent element and
 * removing it from the props removes it from the frame.
 */

export const SVE_LAYER_SOURCE = `
function dirRotation(dir) {
  if (dir === 'down') return 90;
  if (dir === 'left') return 180;
  if (dir === 'up') return 270;
  return 0;
}

/** Pipe-separated graphic text, e.g. '3.4x|conversion lift'. */
function textParts(raw, fallback) {
  const parts = String(raw == null ? '' : raw).split('|')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
  return parts.length ? parts : fallback;
}

/**
 * Count a numeric label up to its final value. '3.4x' animates the 3.4 and
 * keeps the 'x'; a label with no number in it is shown exactly as written.
 */
function countUp(raw, p) {
  const text = String(raw == null ? '' : raw);
  const m = text.match(/-?[0-9][0-9,]*(\\.[0-9]+)?/);
  if (!m) return text;
  const target = Number(String(m[0]).replace(/,/g, ''));
  if (!Number.isFinite(target)) return text;
  const decimals = m[1] ? Math.min(2, m[1].length - 1) : 0;
  return text.slice(0, m.index) + (target * clamp01(p)).toFixed(decimals) + text.slice(m.index + m[0].length);
}

// Built-in vector glyphs, stroke-drawn on a 24x24 grid. The engine cannot
// import an icon font, so the shapes live here as path data.
const ICON_PATHS = {
  spark: ['M12 3 L13.8 9.6 L20.5 11.4 L13.8 13.2 L12 19.8 L10.2 13.2 L3.5 11.4 L10.2 9.6 Z'],
  bulb: ['M12 2.8 a6 6 0 0 1 3.5 10.9 L15 16.6 h-6 l-0.5 -2.9 A6 6 0 0 1 12 2.8 Z', 'M9.4 19 h5.2', 'M10.4 21.4 h3.2'],
  gear: ['M12 8.4 a3.6 3.6 0 1 0 0 7.2 a3.6 3.6 0 0 0 0 -7.2 Z', 'M12 2.6 v2.3', 'M12 19.1 v2.3', 'M2.6 12 h2.3', 'M19.1 12 h2.3', 'M5.4 5.4 l1.6 1.6', 'M17 17 l1.6 1.6', 'M18.6 5.4 l-1.6 1.6', 'M7 17 l-1.6 1.6'],
  check: ['M4 12.8 l5.2 5.2 L20 6.4'],
  bolt: ['M13.6 2 L5 13.6 h5.4 L9.6 22 L19 9.8 h-5.6 Z'],
  chart: ['M4 20 h16', 'M7 20 v-5.6', 'M12 20 v-10', 'M17 20 v-14'],
  lock: ['M6 10.6 h12 v10 h-12 Z', 'M8.6 10.6 V7.9 a3.4 3.4 0 0 1 6.8 0 v2.7'],
  cloud: ['M7 18.2 h10.2 a3.9 3.9 0 0 0 0 -7.8 a5.7 5.7 0 0 0 -10.9 1.5 A3.2 3.2 0 0 0 7 18.2 Z'],
  target: ['M12 3.4 a8.6 8.6 0 1 0 0 17.2 a8.6 8.6 0 0 0 0 -17.2 Z', 'M12 8 a4 4 0 1 0 0 8 a4 4 0 0 0 0 -8 Z'],
  rocket: ['M12 2.6 c3.4 3 5 7.1 5 11.3 l-3.2 2.6 h-3.6 L7 13.9 c0 -4.2 1.6 -8.3 5 -11.3 Z', 'M10.2 19.1 l1.8 2.5 l1.8 -2.5', 'M12 9.4 a1.5 1.5 0 1 0 0 3 a1.5 1.5 0 0 0 0 -3 Z'],
};

function iconPaths(id) { return ICON_PATHS[id] || ICON_PATHS.spark; }

// --- motion graphic primitives ---------------------------------------------
// Every primitive is given the layer spec, its live state, and its box. Draw
// animations use SVG pathLength=1 so the reveal is exact at any size.

function Primitive(props) {
  const g = props.g;
  const s = props.s;
  const w = props.w;
  const h = props.h;
  const th = Math.max(1, num(g.thickness, 10));
  const col = g.color || '#F59E0B';
  const col2 = g.color2 || '#FBBF24';
  const draw = clamp01(s.draw);
  const box = { position: 'absolute', inset: 0, overflow: 'visible' };

  if (g.type === 'arrow') {
    const tip = Math.max(th * 2.6, 34);
    const midY = h / 2;
    return (
      <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>
        <path d={'M ' + th + ' ' + midY + ' L ' + (w - tip) + ' ' + midY} stroke={col} strokeWidth={th} strokeLinecap="round" fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        <polygon
          points={(w - tip) + ',' + (midY - tip * 0.62) + ' ' + w + ',' + midY + ' ' + (w - tip) + ',' + (midY + tip * 0.62)}
          fill={col}
          opacity={clamp01((draw - 0.72) / 0.28)}
        />
      </svg>
    );
  }
  if (g.type === 'circle' || g.type === 'ring') {
    const r = Math.max(6, Math.min(w, h) / 2 - th);
    const pulse = g.type === 'ring' ? 1 + 0.035 * Math.sin(s.life * Math.PI * 4) : 1;
    return (
      <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>
        <g transform={'translate(' + (w / 2) + ' ' + (h / 2) + ') scale(' + pulse.toFixed(4) + ') translate(' + (-w / 2) + ' ' + (-h / 2) + ')'}>
          <circle cx={w / 2} cy={h / 2} r={r} stroke={col} strokeWidth={th} strokeLinecap="round" fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} transform={'rotate(-90 ' + (w / 2) + ' ' + (h / 2) + ')'} />
          {g.type === 'ring' ? (
            <circle cx={w / 2} cy={h / 2} r={Math.max(4, r - th * 1.9)} stroke={col2} strokeWidth={Math.max(1, th * 0.45)} fill="none" opacity={clamp01((draw - 0.3) / 0.6) * 0.8} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01((draw - 0.2) / 0.8)} transform={'rotate(-90 ' + (w / 2) + ' ' + (h / 2) + ')'} />
          ) : null}
        </g>
      </svg>
    );
  }
  if (g.type === 'underline') {
    return (
      <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>
        <path
          d={'M ' + th + ' ' + (h * 0.74) + ' Q ' + (w / 2) + ' ' + (h * 0.08) + ' ' + (w - th) + ' ' + (h * 0.74)}
          stroke={col}
          strokeWidth={th}
          strokeLinecap="round"
          fill="none"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
        />
      </svg>
    );
  }
  if (g.type === 'box') {
    const r = Math.min(26, Math.min(w, h) * 0.12);
    return (
      <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>
        <rect x={th / 2} y={th / 2} width={Math.max(1, w - th)} height={Math.max(1, h - th)} rx={r} stroke={col} strokeWidth={th} fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
      </svg>
    );
  }
  if (g.type === 'line') {
    const d = g.curved
      ? 'M ' + th + ' ' + (h - th) + ' Q ' + (w * 0.2) + ' ' + (h * 0.1) + ' ' + (w - th) + ' ' + th
      : 'M ' + th + ' ' + (h - th) + ' L ' + (w - th) + ' ' + th;
    return (
      <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>
        <path d={d} stroke={col} strokeWidth={th} strokeLinecap="round" fill="none" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        <circle cx={w - th} cy={th} r={th * 1.1} fill={col2} opacity={clamp01((draw - 0.8) / 0.2)} />
      </svg>
    );
  }
  if (g.type === 'dots') {
    const n = 5;
    const gap = w / (n + 1);
    const r = Math.max(5, th * 0.9);
    const items = [];
    for (let i = 0; i < n; i++) {
      const at = clamp01((draw - i / n) * n);
      items.push(
        <circle key={'d' + i} cx={gap * (i + 1)} cy={h / 2} r={r * (0.4 + 0.6 * at)} fill={i % 2 === 0 ? col : col2} opacity={at} />,
      );
    }
    return <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>{items}</svg>;
  }
  if (g.type === 'progressBar') {
    const barH = Math.max(14, h * 0.42);
    const fill = clamp01(num(g.fill, 0.72)) * draw;
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: Math.round(h * 0.14) }}>
        <div style={{ position: 'relative', width: '100%', height: barH, borderRadius: barH, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (fill * 100).toFixed(2) + '%', borderRadius: barH, background: 'linear-gradient(90deg,' + col + ',' + col2 + ')' }} />
        </div>
        {g.text ? (
          <div style={{ fontFamily: fontCss('inter'), fontWeight: 800, fontSize: Math.round(h * 0.34), color: '#FFFFFF', letterSpacing: -0.5, textShadow: '0 4px 18px rgba(0,0,0,0.55)' }}>{g.text}</div>
        ) : null}
      </div>
    );
  }
  if (g.type === 'label') {
    const pop = 0.82 + 0.18 * draw;
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          transform: 'scale(' + pop.toFixed(4) + ')',
          background: col,
          color: '#0B0D12',
          fontFamily: fontCss('inter'),
          fontWeight: 900,
          fontSize: Math.round(h * 0.42),
          letterSpacing: -0.5,
          padding: Math.round(h * 0.18) + 'px ' + Math.round(h * 0.34) + 'px',
          borderRadius: Math.round(h * 0.26),
          boxShadow: '0 18px 46px rgba(0,0,0,0.45)',
          whiteSpace: 'nowrap',
        }}>{g.text || 'Label'}</div>
      </div>
    );
  }
  if (g.type === 'callout') {
    const r = Math.round(Math.min(h * 0.34, 34));
    const tail = Math.round(h * 0.22);
    const pop = 0.86 + 0.14 * draw;
    return (
      <div style={{ position: 'absolute', inset: 0, transform: 'scale(' + pop.toFixed(4) + ')', transformOrigin: 'center bottom' }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: tail,
          background: 'rgba(10,13,22,0.88)',
          border: '3px solid ' + col,
          borderRadius: r,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 ' + Math.round(h * 0.22) + 'px',
          boxShadow: '0 22px 60px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontFamily: fontCss('inter'), fontWeight: 800, fontSize: Math.round((h - tail) * 0.4), color: '#FFFFFF', textAlign: 'center', lineHeight: 1.16 }}>{g.text || 'Callout'}</div>
        </div>
        <svg style={{ position: 'absolute', left: '50%', bottom: 0, width: tail * 2, height: tail, transform: 'translateX(-50%)' }} viewBox={'0 0 ' + (tail * 2) + ' ' + tail}>
          <polygon points={'0,0 ' + (tail * 2) + ',0 ' + tail + ',' + tail} fill={col} />
        </svg>
      </div>
    );
  }
  if (g.type === 'icon') {
    const paths = iconPaths(g.icon);
    const stroke = Math.max(0.7, (th / Math.max(1, Math.min(w, h))) * 24 * 1.5);
    return (
      <svg style={box} viewBox="0 0 24 24" width={w} height={h}>
        <g transform={'translate(12 12) scale(' + (0.86 + 0.14 * draw).toFixed(4) + ') translate(-12 -12)'}>
          {paths.map(function (d, i) {
            const at = clamp01((draw - (i * 0.5) / Math.max(1, paths.length)) / 0.6);
            return (
              <path key={'ip' + i} d={d} stroke={i === 0 ? col : col2} strokeWidth={stroke}
                strokeLinecap="round" strokeLinejoin="round" fill="none"
                pathLength={1} strokeDasharray={1} strokeDashoffset={1 - at} opacity={clamp01(at * 1.4)} />
            );
          })}
        </g>
      </svg>
    );
  }
  if (g.type === 'statCard') {
    const parts = textParts(g.text, ['100%', 'metric']);
    const value = countUp(parts[0], draw);
    const label = parts[1] || '';
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(165deg, rgba(12,16,26,0.93), rgba(12,16,26,0.76))',
        border: '2px solid ' + col,
        borderRadius: Math.round(Math.min(w, h) * 0.14),
        boxShadow: '0 26px 70px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: Math.round(h * 0.05), overflow: 'hidden',
        transform: 'translateY(' + ((1 - draw) * 18).toFixed(2) + 'px)',
      }}>
        <div style={{
          fontFamily: fontCss('inter'), fontWeight: 900, letterSpacing: -2,
          fontSize: Math.round(h * 0.42), lineHeight: 1,
          background: 'linear-gradient(92deg,' + col + ',' + col2 + ')',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        }}>{value}</div>
        {label ? (
          <div style={{
            fontFamily: fontCss('inter'), fontWeight: 700, fontSize: Math.round(h * 0.13),
            color: 'rgba(255,255,255,0.84)', letterSpacing: 0.4, textAlign: 'center',
            padding: '0 ' + Math.round(w * 0.06) + 'px',
          }}>{label}</div>
        ) : null}
      </div>
    );
  }
  if (g.type === 'arrowDiagram') {
    const steps = textParts(g.text, ['Step 1', 'Step 2', 'Step 3']).slice(0, 4);
    const n = steps.length;
    const gap = Math.round(w * 0.05);
    const nodeW = Math.max(40, (w - gap * Math.max(0, n - 1)) / n);
    const arrowH = Math.round(h * 0.26);
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: gap }}>
        {steps.map(function (label, i) {
          const at = clamp01((draw - (i / Math.max(1, n)) * 0.8) / 0.35);
          return (
            <div key={'st' + i} style={{ position: 'relative', width: nodeW, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{
                width: '100%', height: Math.round(h * 0.62),
                background: 'rgba(10,13,22,0.88)',
                border: '2px solid ' + (i === n - 1 ? col2 : col),
                borderRadius: Math.round(h * 0.18),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: at, transform: 'scale(' + (0.9 + 0.1 * at).toFixed(4) + ')',
                padding: '0 8px', overflow: 'hidden',
              }}>
                <span style={{ fontFamily: fontCss('inter'), fontWeight: 800, fontSize: Math.round(h * 0.17), color: '#FFFFFF', whiteSpace: 'nowrap' }}>{label}</span>
              </div>
              {i < n - 1 ? (
                <svg style={{ position: 'absolute', right: -gap, top: '50%', width: gap, height: arrowH, transform: 'translateY(-50%)' }}
                  viewBox={'0 0 ' + gap + ' ' + arrowH}>
                  <path d={'M 0 ' + (arrowH / 2) + ' L ' + (gap * 0.66) + ' ' + (arrowH / 2)} stroke={col}
                    strokeWidth={Math.max(2, th * 0.5)} strokeLinecap="round" fill="none"
                    pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01((draw - (i + 0.5) / n) * n)} />
                  <polygon points={(gap * 0.58) + ',' + (arrowH * 0.18) + ' ' + gap + ',' + (arrowH / 2) + ' ' + (gap * 0.58) + ',' + (arrowH * 0.82)}
                    fill={col} opacity={clamp01((draw - (i + 0.8) / n) * n)} />
                </svg>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }
  if (g.type === 'browserMockup') {
    const headH = Math.round(h * 0.13);
    const url = String(g.text || 'yourapp.com');
    const nav = [0.74, 0.5, 0.92, 0.36];
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(170deg, rgba(16,21,34,0.96), rgba(9,12,20,0.94))',
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: Math.round(Math.min(w, h) * 0.05),
        boxShadow: '0 44px 100px rgba(0,0,0,0.55)',
        overflow: 'hidden',
        transform: 'translateY(' + ((1 - draw) * 22).toFixed(2) + 'px)',
      }}>
        <div style={{ height: headH, display: 'flex', alignItems: 'center', gap: 8, padding: '0 ' + Math.round(w * 0.03) + 'px', background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ width: headH * 0.2, height: headH * 0.2, borderRadius: '50%', background: '#FF5F57' }} />
          <div style={{ width: headH * 0.2, height: headH * 0.2, borderRadius: '50%', background: '#FEBC2E' }} />
          <div style={{ width: headH * 0.2, height: headH * 0.2, borderRadius: '50%', background: '#28C840' }} />
          <div style={{ flex: 1, marginLeft: 10, height: headH * 0.56, borderRadius: 999, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', paddingLeft: 12, overflow: 'hidden' }}>
            <span style={{ fontFamily: fontCss('mono'), fontSize: Math.round(headH * 0.34), color: 'rgba(255,255,255,0.78)', whiteSpace: 'pre' }}>
              {url.slice(0, Math.max(1, Math.ceil(url.length * clamp01(draw / 0.7))))}
            </span>
          </div>
        </div>
        <div style={{ padding: Math.round(w * 0.035), display: 'flex', gap: Math.round(w * 0.03), height: 'calc(100% - ' + headH + 'px)' }}>
          <div style={{ width: '26%', display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.035) }}>
            {nav.map(function (f, i) {
              return <div key={'nv' + i} style={{ height: Math.round(h * 0.055), borderRadius: 8, background: i === 0 ? 'linear-gradient(90deg,' + col + ',' + col2 + ')' : 'rgba(255,255,255,0.12)', opacity: clamp01((draw - i * 0.1) / 0.5) }} />;
            })}
          </div>
          <div style={{ flex: 1, borderRadius: Math.round(h * 0.03), background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', padding: Math.round(h * 0.045), display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.05), justifyContent: 'flex-end' }}>
            {[0.4, 0.68, 0.52, 0.86].map(function (f, i) {
              return (
                <div key={'bar' + i} style={{ height: Math.round(h * 0.07), borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: (clamp01((draw - 0.2 - i * 0.12) / 0.5) * f * 100).toFixed(2) + '%', borderRadius: 999, background: i % 2 === 0 ? 'linear-gradient(90deg,' + col + ',' + col2 + ')' : 'rgba(255,255,255,0.42)' }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  if (g.type === 'phoneMockup') {
    const bezel = Math.max(6, Math.round(Math.min(w, h) * 0.028));
    const radius = Math.round(Math.min(w, h) * 0.12);
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(160deg, #2A3040, #11141C)',
        borderRadius: radius,
        padding: bezel,
        boxShadow: '0 50px 110px rgba(0,0,0,0.6)',
        transform: 'translateY(' + ((1 - draw) * 30).toFixed(2) + 'px) rotate(' + ((1 - draw) * -2).toFixed(2) + 'deg)',
      }}>
        <div style={{
          position: 'relative', width: '100%', height: '100%',
          borderRadius: Math.max(4, radius - bezel),
          background: 'linear-gradient(180deg, rgba(255,255,255,0.1), rgba(0,0,0,0.32))',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          padding: Math.round(w * 0.08),
          gap: Math.round(h * 0.02),
        }}>
          <div style={{ position: 'absolute', left: '50%', top: Math.round(h * 0.016), width: Math.round(w * 0.3), height: Math.round(h * 0.014), borderRadius: 999, background: 'rgba(0,0,0,0.72)', transform: 'translateX(-50%)' }} />
          {[0.9, 0.62, 0.74].map(function (f, i) {
            return (
              <div key={'pl' + i} style={{ height: Math.round(h * 0.035), width: (f * 100).toFixed(0) + '%', borderRadius: 999, background: i === 0 ? 'linear-gradient(90deg,' + col + ',' + col2 + ')' : 'rgba(255,255,255,0.26)', opacity: clamp01((draw - 0.25 - i * 0.12) / 0.5) }} />
            );
          })}
          {g.text ? (
            <div style={{ fontFamily: fontCss('inter'), fontWeight: 800, fontSize: Math.round(h * 0.05), color: '#FFFFFF', opacity: clamp01((draw - 0.5) / 0.4), marginTop: Math.round(h * 0.02) }}>{g.text}</div>
          ) : null}
          <div style={{ height: Math.round(h * 0.072), borderRadius: Math.round(h * 0.03), background: 'linear-gradient(90deg,' + col + ',' + col2 + ')', opacity: clamp01((draw - 0.6) / 0.4) }} />
        </div>
      </div>
    );
  }
  if (g.type === 'gridOverlay') {
    const step = 10;
    const sweep = clamp01(draw) * 100;
    const grad = 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) ' + sweep.toFixed(1) + '%, rgba(0,0,0,0) ' + Math.min(100, sweep + 8).toFixed(1) + '%)';
    return (
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(to right, ' + col + '2E 1px, transparent 1px), linear-gradient(to bottom, ' + col + '2E 1px, transparent 1px)',
        backgroundSize: step + '% ' + step + '%',
        WebkitMaskImage: grad,
        maskImage: grad,
      }} />
    );
  }
  if (g.type === 'glow') {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 50% 50%, ' + col + 'AA 0%, ' + col2 + '55 ' + (30 + 40 * draw).toFixed(0) + '%, rgba(0,0,0,0) 72%)',
        filter: 'blur(' + Math.round(Math.min(w, h) * 0.06) + 'px)',
      }} />
    );
  }
  // --- Phase 2: particles --------------------------------------------------
  // Every scattered primitive reads its field from the layer's seed, never
  // from Math.random, so the preview and the render draw the same frame.
  if (g.type === 'confetti') {
    const n = particleCount(g, 26);
    const pieces = [];
    for (let i = 0; i < n; i++) {
      const delay = rand01(g.seed, i, 1) * 0.28;
      const p = clamp01((s.life - delay) / Math.max(0.12, 1 - delay));
      const burst = ease('expoOut', p);
      const size = randRange(g.seed, i, 4, 14, 32);
      const x = w / 2 + (rand01(g.seed, i, 2) - 0.5) * w * 1.05 * burst;
      const y = h * 0.52 - randRange(g.seed, i, 3, 0.2, 0.54) * h * burst + h * 0.95 * p * p;
      const spin = randRange(g.seed, i, 5, -540, 540) * p;
      const tone = i % 3 === 0 ? col : i % 3 === 1 ? col2 : '#FFFFFF';
      pieces.push(
        <div key={'cf' + i} style={{
          position: 'absolute', left: x - size / 2, top: y - size / 4,
          width: size, height: Math.max(4, size * 0.4), borderRadius: 2, background: tone,
          opacity: clamp01(Math.min(p * 7, (1 - p) * 3.4)),
          transform: 'rotate(' + spin.toFixed(1) + 'deg)',
        }} />,
      );
    }
    return <div style={box}>{pieces}</div>;
  }
  if (g.type === 'sparkles') {
    const n = particleCount(g, 22);
    const stars = [];
    for (let i = 0; i < n; i++) {
      const cx = randRange(g.seed, i, 1, 0.07, 0.93) * w;
      const cy = randRange(g.seed, i, 2, 0.07, 0.93) * h;
      const r = randRange(g.seed, i, 3, 11, 34);
      const phase = rand01(g.seed, i, 4);
      const twinkle = Math.max(0, Math.sin((s.life * 2.6 + phase) * Math.PI * 2));
      const k = 0.34 + 0.66 * twinkle;
      // A four-point star: each arm pinches back to the centre.
      const d = 'M ' + cx + ' ' + (cy - r) +
        ' Q ' + cx + ' ' + cy + ' ' + (cx + r) + ' ' + cy +
        ' Q ' + cx + ' ' + cy + ' ' + cx + ' ' + (cy + r) +
        ' Q ' + cx + ' ' + cy + ' ' + (cx - r) + ' ' + cy +
        ' Q ' + cx + ' ' + cy + ' ' + cx + ' ' + (cy - r) + ' Z';
      stars.push(
        <path key={'sp' + i} d={d} fill={i % 2 === 0 ? col : col2} opacity={twinkle * draw}
          transform={'translate(' + cx + ' ' + cy + ') scale(' + k.toFixed(3) + ') translate(' + (-cx) + ' ' + (-cy) + ')'} />,
      );
    }
    return <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>{stars}</svg>;
  }
  if (g.type === 'fireSparks') {
    const n = particleCount(g, 30);
    const embers = [];
    for (let i = 0; i < n; i++) {
      const phase = rand01(g.seed, i, 1);
      const speed = randRange(g.seed, i, 2, 0.5, 1.3);
      const rise = (s.life * speed + phase) % 1;
      const sway = Math.sin((rise + phase) * Math.PI * 3) * w * 0.07;
      const size = randRange(g.seed, i, 4, 4, 12) * (1 - rise * 0.55);
      const x = randRange(g.seed, i, 3, 0.14, 0.86) * w + sway;
      const y = h * (1 - rise);
      embers.push(
        <div key={'fs' + i} style={{
          position: 'absolute', left: x - size / 2, top: y - size / 2,
          width: size, height: size, borderRadius: '50%',
          background: mixHex(col, col2, rise),
          boxShadow: '0 0 ' + Math.round(size * 2.4) + 'px ' + col,
          opacity: clamp01(Math.min(rise * 6, (1 - rise) * 2.6)) * draw,
        }} />,
      );
    }
    return <div style={box}>{embers}</div>;
  }
  if (g.type === 'speedLines') {
    const n = particleCount(g, 18);
    const vertical = g.direction === 'up' || g.direction === 'down';
    const backwards = g.direction === 'left' || g.direction === 'up';
    const lines = [];
    for (let i = 0; i < n; i++) {
      const phase = rand01(g.seed, i, 1);
      const speed = randRange(g.seed, i, 2, 0.8, 2);
      const travel = (s.life * speed + phase) % 1;
      const pos = backwards ? 1 - travel : travel;
      const across = randRange(g.seed, i, 3, 0.02, 0.98);
      const len = randRange(g.seed, i, 4, 0.14, 0.46);
      const thick = randRange(g.seed, i, 5, 2, Math.max(3, th));
      const fade = clamp01(Math.min(travel * 5, (1 - travel) * 3.5)) * draw;
      const axis = vertical ? 'to bottom' : 'to right';
      const style = vertical
        ? { left: across * w - thick / 2, top: (pos * (1 + len) - len) * h, width: thick, height: len * h }
        : { left: (pos * (1 + len) - len) * w, top: across * h - thick / 2, width: len * w, height: thick };
      lines.push(
        <div key={'sl' + i} style={Object.assign({
          position: 'absolute', borderRadius: 999, opacity: fade,
          background: 'linear-gradient(' + axis + ', rgba(255,255,255,0) 0%, ' + (i % 3 === 0 ? col2 : col) + ' 50%, rgba(255,255,255,0) 100%)',
        }, style)} />,
      );
    }
    return <div style={Object.assign({}, box, { overflow: 'hidden' })}>{lines}</div>;
  }

  // --- Phase 2: glow and light ---------------------------------------------
  if (g.type === 'glowRing') {
    const r = Math.max(10, Math.min(w, h) / 2 - th * 1.4);
    const pulse = 1 + 0.045 * Math.sin(s.life * Math.PI * 4);
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <div style={{
          position: 'absolute', inset: '10%', borderRadius: '50%',
          background: 'radial-gradient(circle, ' + col + '4D 0%, rgba(0,0,0,0) 72%)',
          filter: 'blur(' + Math.round(Math.min(w, h) * 0.05) + 'px)', opacity: draw,
        }} />
        <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>
          <g transform={'translate(' + (w / 2) + ' ' + (h / 2) + ') scale(' + pulse.toFixed(4) + ') translate(' + (-w / 2) + ' ' + (-h / 2) + ')'}>
            <circle cx={w / 2} cy={h / 2} r={r} stroke={col} strokeWidth={th} fill="none" strokeLinecap="round"
              pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw}
              transform={'rotate(-90 ' + (w / 2) + ' ' + (h / 2) + ')'}
              style={{ filter: 'drop-shadow(0 0 ' + Math.round(th * 2) + 'px ' + col + ')' }} />
            <circle cx={w / 2} cy={h / 2} r={Math.max(5, r - th * 2.2)} stroke={col2} strokeWidth={Math.max(1, th * 0.35)} fill="none"
              opacity={clamp01((draw - 0.25) / 0.6) * 0.85}
              pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01((draw - 0.15) / 0.85)}
              transform={'rotate(-90 ' + (w / 2) + ' ' + (h / 2) + ')'} />
          </g>
        </svg>
      </div>
    );
  }
  if (g.type === 'lightStreak') {
    const sweep = ease('easeInOut', s.life);
    const left = -45 + sweep * 190;
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', mixBlendMode: 'screen' }}>
        <div style={{
          position: 'absolute', top: '-25%', bottom: '-25%', left: left.toFixed(2) + '%', width: '38%',
          background: 'linear-gradient(100deg, rgba(255,255,255,0) 0%, ' + col + ' 40%, #FFFFFF 50%, ' + col2 + ' 60%, rgba(255,255,255,0) 100%)',
          filter: 'blur(' + Math.round(Math.max(8, th * 2)) + 'px)',
          transform: 'rotate(-14deg)',
          opacity: clamp01(Math.min(sweep * 5, (1 - sweep) * 4)) * draw,
        }} />
      </div>
    );
  }
  if (g.type === 'radialBurst') {
    const n = particleCount(g, 20);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2;
    const out = ease('expoOut', draw);
    const rays = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rand01(g.seed, i, 1) * 0.1;
      const inner = maxR * (0.1 + 0.52 * out);
      const outer = inner + maxR * randRange(g.seed, i, 2, 0.14, 0.44) * (0.3 + 0.7 * out);
      rays.push(
        <line key={'rb' + i}
          x1={cx + Math.cos(ang) * inner} y1={cy + Math.sin(ang) * inner}
          x2={cx + Math.cos(ang) * outer} y2={cy + Math.sin(ang) * outer}
          stroke={i % 2 === 0 ? col : col2} strokeWidth={Math.max(2, th * 0.6)} strokeLinecap="round"
          opacity={clamp01(1 - s.life * 0.85)} />,
      );
    }
    return <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>{rays}</svg>;
  }

  // --- Phase 2: UI surfaces and interaction --------------------------------
  if (g.type === 'featureCard') {
    const parts = textParts(g.text, ['Feature', '']);
    const paths = iconPaths(g.icon);
    const badge = Math.round(h * 0.46);
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(150deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05))',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid ' + col + '66',
        borderRadius: Math.round(Math.min(w, h) * 0.18),
        boxShadow: '0 30px 78px rgba(0,0,0,0.48)',
        display: 'flex', alignItems: 'center', gap: Math.round(w * 0.04),
        padding: '0 ' + Math.round(w * 0.05) + 'px',
        transform: 'translateX(' + ((1 - draw) * -36).toFixed(2) + 'px)',
      }}>
        <div style={{
          width: badge, height: badge, borderRadius: Math.round(badge * 0.3), flexShrink: 0,
          background: 'linear-gradient(140deg,' + col + ',' + col2 + ')',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg viewBox="0 0 24 24" width={Math.round(badge * 0.6)} height={Math.round(badge * 0.6)}>
            {paths.map(function (d, i) {
              return <path key={'fi' + i} d={d} stroke="#0B0D12" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none"
                pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01((draw - i * 0.12) / 0.6)} />;
            })}
          </svg>
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.05) }}>
          <div style={{ fontFamily: fontCss('inter'), fontWeight: 900, fontSize: Math.round(h * 0.23), color: '#FFFFFF', letterSpacing: -0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts[0]}</div>
          {parts[1] ? (
            <div style={{ fontFamily: fontCss('inter'), fontWeight: 600, fontSize: Math.round(h * 0.14), color: 'rgba(255,255,255,0.74)', opacity: clamp01((draw - 0.3) / 0.5), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts[1]}</div>
          ) : null}
        </div>
      </div>
    );
  }
  if (g.type === 'cursorClick') {
    const travel = ease('easeInOut', clamp01(draw / 0.74));
    const x = lerp(w * 0.14, w * 0.6, travel);
    const y = lerp(h * 0.86, h * 0.4, travel);
    const click = clamp01((draw - 0.74) / 0.26);
    const ripple = click * Math.min(w, h) * 0.46;
    const tip = Math.max(22, Math.min(w, h) * 0.12);
    return (
      <svg style={box} viewBox={'0 0 ' + w + ' ' + h} width={w} height={h}>
        <circle cx={x} cy={y} r={Math.max(0.1, ripple)} fill="none" stroke={col} strokeWidth={Math.max(2, th * 0.5)} opacity={(1 - click) * 0.9} />
        <circle cx={x} cy={y} r={Math.max(0.1, ripple * 0.55)} fill={col} opacity={(1 - click) * 0.22} />
        <g transform={'translate(' + x + ' ' + y + ') scale(' + (1 - click * 0.16).toFixed(3) + ')'}>
          <polygon points={'0,0 0,' + (tip * 1.32) + ' ' + (tip * 0.36) + ',' + (tip * 0.98) + ' ' + (tip * 0.6) + ',' + (tip * 1.48) + ' ' + (tip * 0.82) + ',' + (tip * 1.36) + ' ' + (tip * 0.58) + ',' + (tip * 0.88) + ' ' + (tip * 0.96) + ',' + (tip * 0.84)}
            fill="#FFFFFF" stroke="#0B0D12" strokeWidth={Math.max(1, tip * 0.07)} strokeLinejoin="round" />
        </g>
      </svg>
    );
  }
  if (g.type === 'notification') {
    const parts = textParts(g.text, ['Notification', '']);
    const enter = ease('back', draw);
    const dot = Math.round(h * 0.38);
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(14,18,28,0.92)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: Math.round(h * 0.26),
        boxShadow: '0 26px 64px rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', gap: Math.round(w * 0.028),
        padding: '0 ' + Math.round(w * 0.035) + 'px',
        transform: 'translateY(' + ((1 - enter) * -h * 1.1).toFixed(1) + 'px)',
      }}>
        <div style={{ width: dot, height: dot, borderRadius: Math.round(dot * 0.28), flexShrink: 0, background: 'linear-gradient(140deg,' + col + ',' + col2 + ')' }} />
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.04) }}>
          <div style={{ fontFamily: fontCss('inter'), fontWeight: 800, fontSize: Math.round(h * 0.26), color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts[0]}</div>
          {parts[1] ? (
            <div style={{ fontFamily: fontCss('inter'), fontWeight: 600, fontSize: Math.round(h * 0.18), color: 'rgba(255,255,255,0.7)', opacity: clamp01((draw - 0.3) / 0.5), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts[1]}</div>
          ) : null}
        </div>
        <div style={{ fontFamily: fontCss('mono'), fontSize: Math.round(h * 0.15), color: 'rgba(255,255,255,0.4)' }}>now</div>
      </div>
    );
  }
  if (g.type === 'animatedBorder') {
    const radius = Math.round(Math.min(w, h) * 0.09);
    const angle = (s.life * 720) % 360;
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: radius, padding: Math.max(2, th * 0.5),
        background: 'conic-gradient(from ' + angle.toFixed(1) + 'deg, rgba(255,255,255,0.06), ' + col + ', ' + col2 + ', rgba(255,255,255,0.06))',
        opacity: draw,
      }}>
        <div style={{
          width: '100%', height: '100%',
          borderRadius: Math.max(0, radius - Math.max(2, th * 0.5)),
          background: 'rgba(7,10,17,0.74)',
        }} />
      </div>
    );
  }

  if (g.type === 'uiCard') {
    const headH = Math.round(h * 0.17);
    const rows = [0.62, 0.9, 0.46];
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05))',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.22)',
        borderRadius: Math.round(Math.min(w, h) * 0.07),
        boxShadow: '0 40px 90px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        transform: 'translateY(' + ((1 - draw) * 26).toFixed(2) + 'px)',
      }}>
        <div style={{ height: headH, display: 'flex', alignItems: 'center', gap: 10, padding: '0 ' + Math.round(w * 0.04) + 'px', background: 'rgba(0,0,0,0.26)' }}>
          <div style={{ width: headH * 0.22, height: headH * 0.22, borderRadius: '50%', background: '#FF5F57' }} />
          <div style={{ width: headH * 0.22, height: headH * 0.22, borderRadius: '50%', background: '#FEBC2E' }} />
          <div style={{ width: headH * 0.22, height: headH * 0.22, borderRadius: '50%', background: '#28C840' }} />
          <div style={{ marginLeft: 14, fontFamily: fontCss('inter'), fontWeight: 700, fontSize: Math.round(headH * 0.42), color: 'rgba(255,255,255,0.86)' }}>{g.text || 'Dashboard'}</div>
        </div>
        <div style={{ padding: Math.round(w * 0.05), display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.07) }}>
          {rows.map((frac, i) => (
            <div key={'r' + i} style={{ height: Math.round(h * 0.075), borderRadius: 999, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: (clamp01((draw - i * 0.18) / 0.6) * frac * 100).toFixed(2) + '%', borderRadius: 999, background: i === 1 ? 'linear-gradient(90deg,' + col + ',' + col2 + ')' : 'rgba(255,255,255,0.4)' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

function GraphicView(props) {
  const g = props.g;
  const t = props.t;
  if (!g || t < num(g.start, 0) - 0.001 || t > num(g.end, 0) + 0.001) return null;
  const s = graphicState(g, t);
  const w = Math.max(8, num(g.w, 320));
  const h = Math.max(8, num(g.h, 200));
  const cw = num(props.cw, DESIGN_W);
  const ch = num(props.ch, DESIGN_H);
  const pos = graphicPosition(g, s, t, num(props.frame, 0), num(props.fps, 30), props.clips || [], cw, ch);
  // The colour channel can be keyframed, so the primitive is handed the LIVE
  // colour rather than reading the layer's static one.
  const live = Object.assign({}, g, { color: s.color });
  return (
    <div style={{
      position: 'absolute',
      left: Math.round(pos.x - w / 2),
      top: Math.round(pos.y - h / 2),
      width: w,
      height: h,
      opacity: clamp01(s.opacity),
      transform: 'rotate(' + (s.rotation + dirRotation(g.direction)).toFixed(2) + 'deg) scale(' + s.scaleX.toFixed(4) + ',' + s.scaleY.toFixed(4) + ')',
      filter: s.blur > 0.4 ? 'blur(' + s.blur.toFixed(2) + 'px)' : 'none',
      pointerEvents: 'none',
    }}>
      <Primitive g={live} s={s} w={w} h={h} />
    </div>
  );
}

// --- video clip -------------------------------------------------------------
function ClipLayer(props) {
  const c = props.clip;
  const local = useCurrentFrame();
  const cfg = useVideoConfig();
  const fps = cfg.fps || 30;
  const abs = num(c.from, 0) + local;
  const srcT = (num(c.startFrom, 0) + local * num(c.speed, 1)) / fps;
  const contentT = clampN((local - num(c.contentOffset, 0)) / fps, 0, num(c.contentFrames, fps) / fps);
  const cam = cameraAt(c.camera, contentT);
  const f = focusAt(c.reframe, srcT);
  const px = clampN(f.x + cam.dx, 0.06, 0.94) * 100;
  const py = clampN(f.y + cam.dy, 0.06, 0.94) * 100;

  let st = { opacity: 1, transform: '', filter: '', clipPath: '' };
  const ti = c.inTrans;
  const to = c.outTrans;
  if (ti && abs >= ti.from - 0.5 && abs <= ti.from + ti.frames + 0.5) {
    st = transitionState(ti.type, 'in', ease(ti.easing, windowProgress(abs, ti.from, ti.frames)), ti.direction, ti.shape);
  } else if (to && abs >= to.from - 0.5 && abs <= to.from + to.frames + 0.5) {
    st = transitionState(to.type, 'out', ease(to.easing, windowProgress(abs, to.from, to.frames)), to.direction, to.shape);
  }

  // With depth compositing on, THIS copy is the background plate: it can be
  // blurred and dimmed, because the sharp subject is drawn again above the
  // background graphics band by SubjectLayer.
  const fx = c.subjectFx || {};
  const depthBlur = c.depth ? Math.max(0, num(fx.depthBlur, 0)) : 0;
  const depthDim = c.depth ? clamp01(num(fx.backgroundDim, 0)) : 0;
  const plate = [
    gradeFilter(c.grade),
    depthBlur > 0.2 ? 'blur(' + depthBlur.toFixed(1) + 'px)' : '',
    depthDim > 0.01 ? 'brightness(' + (1 - depthDim * 0.62).toFixed(3) + ')' : '',
  ].filter(function (part) { return !!part; }).join(' ');

  return (
    <AbsoluteFill style={{
      opacity: clamp01(st.opacity),
      transform: st.transform || undefined,
      filter: st.filter || undefined,
      clipPath: st.clipPath || undefined,
      overflow: 'hidden',
      background: '#000',
    }}>
      <OffthreadVideo
        src={c.src}
        startFrom={num(c.startFrom, 0)}
        endAt={Math.max(num(c.startFrom, 0) + 1, num(c.endAt, 1))}
        playbackRate={Math.max(0.1, num(c.speed, 1))}
        volume={clamp01(num(c.volume, 1))}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: px.toFixed(2) + '% ' + py.toFixed(2) + '%',
          transform: 'scale(' + Math.max(1, cam.zoom).toFixed(4) + ')',
          transformOrigin: px.toFixed(2) + '% ' + py.toFixed(2) + '%',
          filter: plate || undefined,
        }}
      />
    </AbsoluteFill>
  );
}

// --- subject layer: the depth composite ------------------------------------
/**
 * The same clip, the same frame, the same camera move - masked down to the
 * segmented subject and drawn ABOVE the background graphics band, so text and
 * graphics can sit genuinely behind the presenter.
 *
 * This copy is always silent: the plate below owns the clip's audio, so
 * nothing doubles. It reads the same transition state as the plate, so the two
 * can never drift apart mid-handoff.
 */
function SubjectLayer(props) {
  const c = props.clip;
  const cw = num(props.cw, DESIGN_W);
  const ch = num(props.ch, DESIGN_H);
  const local = useCurrentFrame();
  const cfg = useVideoConfig();
  const fps = cfg.fps || 30;
  const abs = num(c.from, 0) + local;
  const fs = clipFrameState(c, abs, fps);
  const px = fs.px * 100;
  const py = fs.py * 100;

  let st = { opacity: 1, transform: '', filter: '', clipPath: '' };
  const ti = c.inTrans;
  const to = c.outTrans;
  if (ti && abs >= ti.from - 0.5 && abs <= ti.from + ti.frames + 0.5) {
    st = transitionState(ti.type, 'in', ease(ti.easing, windowProgress(abs, ti.from, ti.frames)), ti.direction, ti.shape);
  } else if (to && abs >= to.from - 0.5 && abs <= to.from + to.frames + 0.5) {
    st = transitionState(to.type, 'out', ease(to.easing, windowProgress(abs, to.from, to.frames)), to.direction, to.shape);
  }

  const subject = c.subject || {};
  const box = subjectCanvasBox(c, fs, cw, ch);
  const mask = subjectMaskStyle(subject.shape || 'ellipse', box, num(subject.feather, 0.3), cw, ch);
  const treatment = subjectFxFilter(c.subjectFx || {}, props.accent || '#FBBF24');
  const outer = [st.filter, treatment].filter(function (part) { return !!part; }).join(' ');

  return (
    <AbsoluteFill style={{
      opacity: clamp01(st.opacity),
      transform: st.transform || undefined,
      filter: outer || undefined,
      clipPath: st.clipPath || undefined,
      pointerEvents: 'none',
      overflow: 'hidden',
    }}>
      <AbsoluteFill style={Object.assign({ overflow: 'hidden' }, mask)}>
        <OffthreadVideo
          src={c.src}
          startFrom={num(c.startFrom, 0)}
          endAt={Math.max(num(c.startFrom, 0) + 1, num(c.endAt, 1))}
          playbackRate={Math.max(0.1, num(c.speed, 1))}
          muted
          volume={0}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: px.toFixed(2) + '% ' + py.toFixed(2) + '%',
            transform: 'scale(' + fs.zoom.toFixed(4) + ')',
            transformOrigin: px.toFixed(2) + '% ' + py.toFixed(2) + '%',
            filter: gradeFilter(c.grade) || undefined,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// --- transition flourishes (only inside the overlap window) -----------------
function TransitionFX(props) {
  const tr = props.tr;
  const local = useCurrentFrame();
  const p = clamp01(local / Math.max(1, num(tr.frames, 1)));
  const peak = 1 - Math.abs(p - 0.5) * 2;
  const col = props.accent || '#FBBF24';

  if (tr.type === 'glitch') {
    const slices = [0.12, 0.34, 0.52, 0.71, 0.88];
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen' }}>
        <AbsoluteFill style={{ background: 'rgba(255,0,64,0.22)', transform: 'translateX(' + (peak * 1.8).toFixed(2) + '%)' }} />
        <AbsoluteFill style={{ background: 'rgba(0,220,255,0.22)', transform: 'translateX(' + (-peak * 1.8).toFixed(2) + '%)' }} />
        {slices.map((s, i) => (
          <div key={'sl' + i} style={{
            position: 'absolute', left: 0, right: 0,
            top: (s * 100).toFixed(1) + '%',
            height: (2 + 5 * peak).toFixed(1) + '%',
            background: i % 2 === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.55)',
            transform: 'translateX(' + (Math.sin((p + i) * 23) * 6 * peak).toFixed(2) + '%)',
            opacity: peak,
          }} />
        ))}
        <AbsoluteFill style={{ background: '#FFFFFF', opacity: (peak > 0.92 ? 0.5 : 0) }} />
      </AbsoluteFill>
    );
  }
  if (tr.type === 'lightSweep') {
    const pos = -40 + p * 180;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '-20%', bottom: '-20%', left: pos.toFixed(2) + '%', width: '46%',
          background: 'linear-gradient(100deg, rgba(255,255,255,0) 0%, ' + col + ' 42%, rgba(255,255,255,0.98) 52%, ' + col + ' 62%, rgba(255,255,255,0) 100%)',
          filter: 'blur(22px)',
          transform: 'rotate(-12deg)',
          opacity: 0.9,
        }} />
        <AbsoluteFill style={{ background: '#FFFFFF', opacity: (peak * 0.3).toFixed(3) }} />
      </AbsoluteFill>
    );
  }
  if (tr.type === 'zoom' || tr.type === 'scale') {
    return <AbsoluteFill style={{ pointerEvents: 'none', background: '#FFFFFF', opacity: (peak * 0.16).toFixed(3) }} />;
  }
  if (tr.type === 'whipPan' || tr.type === 'motionBlur') {
    const horizontal = tr.direction === 'left' || tr.direction === 'right' || !tr.direction;
    return (
      <AbsoluteFill style={{
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        opacity: (peak * 0.5).toFixed(3),
        background: horizontal
          ? 'repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0px, rgba(255,255,255,0) 14px)'
          : 'repeating-linear-gradient(0deg, rgba(255,255,255,0.14) 0px, rgba(255,255,255,0) 14px)',
      }} />
    );
  }
  return null;
}

// --- captions ---------------------------------------------------------------
function CaptionWordView(props) {
  const cue = props.cue;
  const w = props.w;
  const s = wordState(cue, w, props.t);
  const raw = String(w.text || '');
  const text = s.upper ? raw.toUpperCase() : raw;
  const shown = s.charReveal < 1 ? text.slice(0, Math.max(0, Math.ceil(text.length * s.charReveal))) : text;
  const outline = Math.max(0, num(cue.outline, 6));
  const motion = {
    display: 'inline-block',
    opacity: clamp01(s.opacity),
    transform: 'translate(' + s.tx.toFixed(2) + 'px,' + s.ty.toFixed(2) + 'px) scale(' + s.scale.toFixed(4) + ') rotate(' + s.rotate.toFixed(2) + 'deg)',
    filter: s.blur > 0.4 ? 'blur(' + s.blur.toFixed(2) + 'px)' : 'none',
  };
  const type = {
    fontFamily: s.fontFamily,
    fontSize: Math.round(s.fontSize),
    fontWeight: s.fontWeight,
    letterSpacing: s.tracking,
    lineHeight: 1.08,
    color: s.color,
    whiteSpace: 'pre',
  };
  if (s.highlight > 0) {
    return (
      <span style={Object.assign({ position: 'relative' }, motion)}>
        <span style={{
          position: 'absolute', left: '-0.14em', right: '-0.14em', top: '0.02em', bottom: '0.06em',
          background: s.background, borderRadius: 12,
          transformOrigin: 'left center',
          transform: 'scaleX(' + clamp01(s.highlight).toFixed(4) + ')',
        }} />
        <span style={Object.assign({ position: 'relative' }, type)}>{shown}</span>
      </span>
    );
  }
  return (
    <span style={Object.assign({}, motion, type, {
      WebkitTextStroke: outline > 0 ? outline + 'px rgba(5,7,12,0.82)' : undefined,
      paintOrder: 'stroke fill',
      textShadow: '0 8px 30px rgba(0,0,0,0.55)',
    })}>{shown}</span>
  );
}

function CaptionCueView(props) {
  const cue = props.cue;
  const canvasW = props.canvasW;
  const width = Math.round(canvasW * clampN(cue.widthPct, 0.3, 0.94));
  const justify = cue.align === 'left' ? 'flex-start' : cue.align === 'right' ? 'flex-end' : 'center';
  const words = Array.isArray(cue.words) ? cue.words : [];
  // The gap has to be derived from the CUE size in canvas pixels: an em value
  // here would resolve against the container's inherited 16px font-size, which
  // collapses the word spacing to a few pixels on a 1080-wide frame.
  const base = num(cue.baseSize, 74);
  const colGap = Math.round(base * 0.24);
  const rowGap = Math.round(base * 0.16);
  return (
    <div style={{
      position: 'absolute',
      left: Math.round(num(cue.x, canvasW / 2) - width / 2),
      top: Math.round(num(cue.y, 0)),
      width: width,
      transform: 'translateY(-50%)',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      justifyContent: justify,
      columnGap: colGap,
      rowGap: rowGap,
      textAlign: cue.align || 'center',
      pointerEvents: 'none',
    }}>
      {words.map((w, i) => <CaptionWordView key={'w' + i} cue={cue} w={w} t={props.t} />)}
    </div>
  );
}

// --- the opening hook -------------------------------------------------------
/**
 * The first layer on the timeline, drawn above everything else for the first
 * 1-3 seconds.
 *
 * With a lead-in the hook owns the frame on its own and clip 1 starts after it
 * (the compiler reserves that time at the head); with no lead-in it plays over
 * the opening of clip 1 behind a scrim. All three templates share the same
 * gentle camera push, so they read as one family rather than three effects.
 */
function hookFontSize(hook, words, cw) {
  const asked = Math.max(28, num(hook.fontSize, 120));
  let longest = 1;
  for (let i = 0; i < words.length; i++) longest = Math.max(longest, String(words[i]).length);
  // 0.56 is the same average glyph-width ratio the quality gate measures cue
  // boxes with, so what fits here is what the gate agrees fits.
  const fits = Math.floor((cw * 0.84) / Math.max(1, longest * 0.56));
  return Math.max(34, Math.min(asked, fits));
}

function HookLayer(props) {
  const hook = props.hook;
  if (!hook) return null;
  const t = num(props.t, 0);
  const s = hookState(hook, t);
  if (!s.live) return null;

  const cw = num(props.cw, DESIGN_W);
  const safe = num(props.safeMargin, 90);
  const font = fontCss(hook.font);
  const color = hook.color || '#FFFFFF';
  const accent = hook.accent || '#F59E0B';
  // With a lead-in the hook is the whole picture, so it carries a full plate;
  // over the footage it only darkens what is behind it.
  const plate = num(hook.leadIn, 0) > 0.01 ? 1 : clamp01(num(hook.scrim, 0.55));

  let body = null;

  if (hook.template === 'number') {
    const raw = String(hook.value == null ? '' : hook.value) || '0';
    const countP = ease('expoOut', clamp01(s.local / Math.max(0.3, s.dur * 0.6)));
    const shown = hook.countUp ? countUp(raw, countP) : raw;
    const size = hookFontSize(hook, [raw], cw);
    const pop = hook.countUp ? 0.94 + 0.06 * s.intro : 0.42 + 0.58 * s.intro;
    const supportA = ease('expoOut', clamp01((s.local - s.dur * 0.34) / Math.max(0.2, s.dur * 0.4)));
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(size * 0.16), padding: '0 ' + safe + 'px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', transform: 'scale(' + pop.toFixed(4) + ')' }}>
          {hook.currency ? (
            <span style={{ fontFamily: font, fontWeight: 900, fontSize: Math.round(size * 0.62), color: accent, letterSpacing: -2 }}>{hook.currency}</span>
          ) : null}
          <span style={{ fontFamily: font, fontWeight: 900, fontSize: size, color: color, letterSpacing: -3, lineHeight: 1, textShadow: '0 14px 48px rgba(0,0,0,0.6)' }}>{shown}</span>
        </div>
        {hook.support ? (
          <div style={{
            fontFamily: fontCss('inter'), fontWeight: 800, fontSize: Math.round(size * 0.24),
            color: accent, letterSpacing: 0.4, textAlign: 'center',
            opacity: supportA, transform: 'translateY(' + ((1 - supportA) * 40).toFixed(1) + 'px)',
          }}>{hook.support}</div>
        ) : null}
      </div>
    );
  } else if (hook.template === 'problem') {
    const words = String(hook.text || '').split(' ').filter(function (x) { return x.length > 0; });
    const hot = Array.isArray(hook.emphasisIndexes) ? hook.emphasisIndexes : [];
    const size = hookFontSize(hook, words, cw);
    body = (
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        columnGap: Math.round(size * 0.22), rowGap: Math.round(size * 0.08),
        padding: '0 ' + safe + 'px', maxWidth: cw,
      }}>
        {words.map(function (word, i) {
          const ws = hookWordState(i, words.length, s);
          const lit = hot.indexOf(i + 1) >= 0;
          return (
            <span key={'hw' + i} style={{
              display: 'inline-block',
              fontFamily: font, fontWeight: 900, letterSpacing: -2, lineHeight: 1.05,
              fontSize: lit ? Math.round(size * 1.06) : size,
              color: lit ? (hook.emphasisColor || '#EF4444') : color,
              opacity: ws.opacity,
              transform: 'translateY(' + ws.ty.toFixed(1) + 'px) scale(' + ws.scale.toFixed(3) + ')',
              textShadow: '0 12px 40px rgba(0,0,0,0.6)',
            }}>{word}</span>
          );
        })}
      </div>
    );
  } else {
    const text = String(hook.text || 'STOP SCROLLING').toUpperCase();
    const size = hookFontSize(hook, text.split(' '), cw);
    const scaleIn = 0.5 + 0.5 * s.intro;
    const barW = Math.round(cw * 0.66);
    const barH = Math.max(10, Math.round(size * 0.14));
    const sweep = ease('expoOut', clamp01((s.local - s.dur * 0.26) / Math.max(0.18, s.dur * 0.46)));
    body = (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(size * 0.2),
        padding: '0 ' + safe + 'px', transform: 'scale(' + scaleIn.toFixed(4) + ')',
      }}>
        <div style={{
          fontFamily: font, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: -2,
          color: color, textAlign: 'center', textShadow: '0 14px 48px rgba(0,0,0,0.62)',
        }}>{text}</div>
        <svg width={barW} height={barH} viewBox={'0 0 ' + barW + ' ' + barH}>
          <path d={'M ' + (barH / 2) + ' ' + (barH / 2) + ' L ' + (barW - barH / 2) + ' ' + (barH / 2)}
            stroke={accent} strokeWidth={barH} strokeLinecap="round" fill="none"
            pathLength={1} strokeDasharray={1} strokeDashoffset={1 - sweep} />
        </svg>
      </div>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: clamp01(s.opacity), overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: hook.background || '#05070C', opacity: plate }} />
      <AbsoluteFill style={{
        alignItems: 'center', justifyContent: 'center',
        transform: 'scale(' + s.push.toFixed(4) + ')',
      }}>{body}</AbsoluteFill>
    </AbsoluteFill>
  );
}
`;
