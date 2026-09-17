/**
 * VidVerge — MOTION UI: the premium template showcase on the studio landing.
 *
 * A high-end, topview.ai-style "Motion templates" surface that sits at the top
 * of the Motion UI input screen. It is a two-column SPLIT preview — an animated
 * headline + one-line explanation on the LEFT, a cropped product screenshot
 * shown as a simulated browser window on the RIGHT with an animated cursor
 * tracing a path over the UI — plus a template gallery and a live mini-editor.
 *
 * STATE SYNC (the important bit). The templates are held in local reactive
 * `useState`, seeded from motionTemplates.ts. The editor writes to the ACTIVE
 * template through `patchActive`, and BOTH the preview and the gallery read from
 * that same state, so editing the headline, sub-copy or colors updates the
 * preview instantly with no reload. Nothing here feeds the Remotion render — it
 * is a self-contained showcase, so it never touches the Motion Plan, the runtime
 * math or the render composition.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pencil, Sparkles } from 'lucide-react';
import { MOTION_TEMPLATES, type MotionTemplate } from './motionTemplates';
import { FONT, T } from './ui';

const SHOWCASE_CSS = `
@keyframes mts-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes mts-rise-sm { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes mts-slide { from { opacity: 0; transform: translateX(28px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes mts-ripple { from { opacity: 0.55; transform: translate(-50%, -50%) scale(0.35); } to { opacity: 0; transform: translate(-50%, -50%) scale(1.7); } }
.mts-rise { animation: mts-rise 0.62s cubic-bezier(0.22, 0.61, 0.36, 1) both; }
.mts-rise-2 { animation: mts-rise-sm 0.62s cubic-bezier(0.22, 0.61, 0.36, 1) 0.08s both; }
.mts-rise-3 { animation: mts-rise-sm 0.62s cubic-bezier(0.22, 0.61, 0.36, 1) 0.16s both; }
.mts-slide { animation: mts-slide 0.62s cubic-bezier(0.22, 0.61, 0.36, 1) both; }
@media (max-width: 760px) {
  .mts-split { flex-direction: column !important; }
  .mts-left, .mts-right { width: 100% !important; }
  .mts-left { padding: 22px !important; }
}
`;

/** The animated pointer that traces each template's cursor path. */
function CursorOverlay({ template }: { template: MotionTemplate }) {
  const wps = template.cursorWaypoints.length
    ? template.cursorWaypoints
    : [{ x: 0.5, y: 0.5, durationMs: 0 }];
  const [idx, setIdx] = useState(0);

  // Restart the path whenever the active template changes.
  useEffect(() => {
    setIdx(0);
  }, [template.id]);

  useEffect(() => {
    const current = wps[idx] || wps[0];
    const moveMs = Math.max(0, current.durationMs || 0);
    const dwell = 480;
    const timer = window.setTimeout(() => {
      setIdx((i) => (i + 1) % wps.length);
    }, moveMs + dwell);
    return () => window.clearTimeout(timer);
  }, [idx, template.id]);

  const point = wps[idx] || wps[0];
  const prev = idx > 0 ? wps[idx - 1] : null;
  const clicking = !!prev && prev.x === point.x && prev.y === point.y;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: `${point.x * 100}%`,
          top: `${point.y * 100}%`,
          transform: `translate(-10%, -8%) scale(${clicking ? 0.82 : 1})`,
          transition: `left ${point.durationMs || 0}ms cubic-bezier(0.4, 0, 0.2, 1), top ${
            point.durationMs || 0
          }ms cubic-bezier(0.4, 0, 0.2, 1), transform 180ms ease-out`,
          willChange: 'left, top, transform',
        }}
      >
        {/* Click ripple, re-triggered on each pause via the key. */}
        {clicking ? (
          <span
            key={`ripple-${idx}`}
            style={{
              position: 'absolute',
              left: 3,
              top: 2,
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: `2px solid ${template.accentColor}`,
              transform: 'translate(-50%, -50%)',
              animation: 'mts-ripple 0.5s ease-out forwards',
            }}
          />
        ) : null}
        <svg width="20" height="28" viewBox="0 0 20 28" fill="none" style={{ display: 'block', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))' }}>
          <path
            d="M4 2 L4 22.5 L8.7 18 L11.7 25 L14.6 23.7 L11.6 16.9 L17.5 16.7 Z"
            fill="#ffffff"
            stroke="#0b0f18"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

/** The right column: a cropped screenshot inside a simulated browser window. */
function ScreenWindow({ template }: { template: MotionTemplate }) {
  return (
    <div
      key={`screen-${template.id}`}
      className="mts-slide"
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: 14,
        overflow: 'hidden',
        background: '#0b1220',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: `0 30px 70px -30px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.03), 0 20px 60px -30px ${template.accentColor}`,
      }}
    >
      {/* Dark chrome bezel */}
      <div
        style={{
          height: 34,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 13px',
          background: 'rgba(255,255,255,0.05)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5f57' }} />
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#febc2e' }} />
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#28c840' }} />
        <span
          style={{
            marginLeft: 12,
            flex: 1,
            height: 18,
            borderRadius: 6,
            background: 'rgba(255,255,255,0.06)',
          }}
        />
      </div>
      {/* The screenshot, cropped to the most important part of the UI. */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', background: template.bgColor }}>
        <img
          src={template.screenshot}
          alt={`${template.name} preview`}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'top center',
            display: 'block',
          }}
        />
        <CursorOverlay template={template} />
      </div>
    </div>
  );
}

function fieldStyle(): CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 11px',
    borderRadius: 9,
    border: `1px solid ${T.border}`,
    background: 'rgba(255,255,255,0.04)',
    color: T.text,
    fontSize: 13,
    fontFamily: FONT,
  };
}

export default function MotionTemplateShowcase() {
  // The single source of truth: a reactive copy of the built-in templates the
  // editor mutates and the preview + gallery read from.
  const [templates, setTemplates] = useState<MotionTemplate[]>(() =>
    MOTION_TEMPLATES.map((t) => ({ ...t, cursorWaypoints: t.cursorWaypoints.map((w) => ({ ...w })) })),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [editing, setEditing] = useState(false);

  const active = templates[activeIndex] || templates[0];

  const patchActive = (patch: Partial<MotionTemplate>) => {
    setTemplates((prev) => prev.map((t, i) => (i === activeIndex ? { ...t, ...patch } : t)));
  };

  // Auto-advance through the slides, unless the visitor is hovering or editing.
  const pausedRef = useRef(false);
  pausedRef.current = paused || editing;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      setActiveIndex((i) => (i + 1) % templates.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [templates.length]);

  return (
    <div
      style={{ width: '100%', marginBottom: 26 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="motion-template-showcase"
    >
      <style>{SHOWCASE_CSS}</style>

      {/* THE SPLIT PREVIEW */}
      <div
        className="mts-split"
        style={{
          display: 'flex',
          width: '100%',
          minHeight: 320,
          borderRadius: 20,
          overflow: 'hidden',
          border: `1px solid ${T.border}`,
          background: active.bgColor,
          transition: 'background 0.6s ease',
        }}
      >
        {/* LEFT 40% — animated headline + explanation */}
        <div
          className="mts-left"
          style={{
            width: '40%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 16,
            padding: '34px 30px',
            position: 'relative',
            backgroundImage: `radial-gradient(520px 320px at 0% 0%, ${active.accentColor}22, transparent 62%)`,
          }}
        >
          <span
            key={`pill-${active.id}`}
            className="mts-rise"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-start',
              padding: '5px 11px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: '#fff',
              background: `color-mix(in srgb, ${active.accentColor} 30%, transparent)`,
              border: `1px solid color-mix(in srgb, ${active.accentColor} 55%, transparent)`,
            }}
          >
            <Sparkles size={12} /> {active.name}
          </span>
          <h2
            key={`h-${active.id}`}
            className="mts-rise-2"
            style={{
              margin: 0,
              fontFamily: FONT,
              fontWeight: 800,
              fontSize: 'clamp(26px, 3.4vw, 40px)',
              lineHeight: 1.06,
              letterSpacing: -1,
              color: '#fff',
            }}
          >
            {active.headline}
          </h2>
          <p
            key={`s-${active.id}`}
            className="mts-rise-3"
            style={{
              margin: 0,
              maxWidth: 360,
              fontSize: 14.5,
              lineHeight: 1.6,
              color: 'rgba(255,255,255,0.72)',
            }}
          >
            {active.subline}
          </p>
        </div>

        {/* RIGHT 60% — simulated screen + animated cursor */}
        <div
          className="mts-right"
          style={{
            width: '60%',
            display: 'flex',
            alignItems: 'center',
            padding: '28px 30px',
            background: 'rgba(0,0,0,0.28)',
          }}
        >
          <ScreenWindow template={active} />
        </div>
      </div>

      {/* TEMPLATE GALLERY */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        {templates.map((t, i) => {
          const sel = i === activeIndex;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveIndex(i)}
              data-testid={`motion-template-${t.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '9px 13px',
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: FONT,
                textAlign: 'left',
                color: sel ? '#fff' : T.sub,
                border: `1px solid ${sel ? 'transparent' : T.border}`,
                background: sel
                  ? `color-mix(in srgb, ${t.accentColor} 22%, transparent)`
                  : 'rgba(255,255,255,0.02)',
                boxShadow: sel ? `inset 0 0 0 1px ${t.accentColor}` : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.accentColor, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t.name}</span>
            </button>
          );
        })}
      </div>

      {/* LIVE MINI-EDITOR */}
      <div
        style={{
          marginTop: 14,
          padding: 16,
          borderRadius: 14,
          border: `1px solid ${T.border}`,
          background: 'rgba(255,255,255,0.02)',
        }}
        onFocusCapture={() => setEditing(true)}
        onBlurCapture={() => setEditing(false)}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: T.muted,
          }}
        >
          <Pencil size={13} /> Customize “{active.name}” — changes preview live
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12, marginTop: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: T.muted }}>Headline</span>
            <input
              value={active.headline}
              onChange={(e) => patchActive({ headline: e.target.value })}
              data-testid="motion-template-edit-headline"
              style={fieldStyle()}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: T.muted }}>Sub-copy</span>
            <input
              value={active.subline}
              onChange={(e) => patchActive({ subline: e.target.value })}
              data-testid="motion-template-edit-subline"
              style={fieldStyle()}
            />
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11, color: T.muted }}>Accent</span>
              <input
                type="color"
                value={active.accentColor}
                onChange={(e) => patchActive({ accentColor: e.target.value })}
                data-testid="motion-template-edit-accent"
                style={{ width: 46, height: 38, padding: 2, borderRadius: 9, border: `1px solid ${T.border}`, background: 'transparent', cursor: 'pointer' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11, color: T.muted }}>Background</span>
              <input
                type="color"
                value={active.bgColor}
                onChange={(e) => patchActive({ bgColor: e.target.value })}
                data-testid="motion-template-edit-bg"
                style={{ width: 46, height: 38, padding: 2, borderRadius: 9, border: `1px solid ${T.border}`, background: 'transparent', cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
