/**
 * Video Studio — the guided layer.
 *
 * Everything in here exists for one reason: someone who has never edited a
 * video should be able to open the app and get something good out of it in
 * under three minutes. The editor underneath is unchanged — this is the
 * scaffolding around it:
 *
 *   · a single drop zone and three sample-use cards before any footage exists
 *   · a five-step rail (Trim → Effects → Captions → Music → Export) that ticks
 *     itself off as the work actually gets done, and never locks anyone in
 *   · one-tap style presets, an AI suggestion banner, a "preview updating"
 *     pill, friendly toasts and a finish state that says “Video Ready!”
 *   · a phone layout: scrollable tabs, full-width preview, and a bottom-sheet
 *     drawer instead of a side panel
 *
 * Design tokens live in VE below and mirror the shared Vidverge warm-gold
 * palette (components/theme.ts): #FFFDF4 canvas, #FFFFFF cards, gold
 * hairline borders, #C8920A accent with a deep-gold secondary, Inter 14px, 16px
 * cards / 8px buttons, 44px minimum tap target. Every surface here reads from
 * them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AlertCircle, Check, ChevronRight, Download, Film, Loader2, Share2,
  Sliders, Undo2, UploadCloud, X,
} from 'lucide-react';
import { HelpTip } from './uiControls';
import { COLORS, FONT, GRADIENT, RADIUS } from '../../components/theme';
import type { StudioPreset } from './studioPresets';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

export const VE = {
  bg: COLORS.bg,
  card: COLORS.surface,
  cardSoft: COLORS.raised,
  border: COLORS.border,
  borderHover: COLORS.controlBorder,
  accent: COLORS.accent,
  accentHover: COLORS.accentHover,
  accentSoft: COLORS.accentSoft,
  accentLine: COLORS.controlBorder,
  cyan: COLORS.info,
  cyanBright: COLORS.info,
  text: COLORS.text,
  textSecondary: COLORS.secondary,
  textMuted: COLORS.muted,
  good: COLORS.success,
  goodSoft: COLORS.successBg,
  bad: COLORS.danger,
  badSoft: COLORS.dangerBg,
  font: FONT.body,
  size: 14,
  radiusCard: RADIUS.card,
  radiusBtn: RADIUS.sm,
  tap: 44,
} as const;

/** Every interactive element clears the 44px thumb target. */
export const tapTarget: CSSProperties = { minHeight: VE.tap, minWidth: VE.tap };

export const vePrimary: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  background: GRADIENT.action,
  color: COLORS.onAccent, border: 'none', borderRadius: VE.radiusBtn,
  padding: '0 18px', minHeight: VE.tap, fontSize: VE.size, fontWeight: 600,
  boxShadow: 'none',
  cursor: 'pointer', fontFamily: VE.font,
};

export const veGhost: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  background: 'transparent', color: VE.textSecondary, border: `1px solid ${VE.border}`,
  borderRadius: VE.radiusBtn, padding: '0 16px', minHeight: VE.tap, fontSize: 13.5,
  fontWeight: 600, cursor: 'pointer', fontFamily: VE.font,
};

export const veCard: CSSProperties = {
  background: VE.card, border: `1px solid ${VE.border}`, borderRadius: VE.radiusCard,
};

/**
 * The marching-ants drop zone, the bottom sheet, the toast and the horizontal
 * tab strips. Injected once by the app next to its own <style> block.
 */
export const GUIDE_CSS = `
.ve-drop {
  position: relative;
  border-radius: ${VE.radiusCard}px;
  background-image:
    repeating-linear-gradient(90deg, ${VE.accent} 0 14px, transparent 14px 28px),
    repeating-linear-gradient(90deg, ${VE.accent} 0 14px, transparent 14px 28px),
    repeating-linear-gradient(0deg, ${VE.accent} 0 14px, transparent 14px 28px),
    repeating-linear-gradient(0deg, ${VE.accent} 0 14px, transparent 14px 28px);
  background-size: 100% 2px, 100% 2px, 2px 100%, 2px 100%;
  background-position: 0 0, 0 100%, 0 0, 100% 0;
  background-repeat: no-repeat;
  animation: none;
}
@keyframes ve-march {
  from { background-position: 0 0, 0 100%, 0 0, 100% 0; }
  to   { background-position: 28px 0, -28px 100%, 0 -28px, 100% 28px; }
}
.ve-drop-hot { background-color: rgba(200,146,10,0.10); }
.ve-scroll-x { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
.ve-scroll-x::-webkit-scrollbar { display: none; }
@keyframes ve-rise { from { transform: translateY(14px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.ve-rise { animation: none; }
@keyframes ve-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.ve-sheet { animation: ve-sheet-up .22s ease-out; }
@keyframes ve-breathe { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
.ve-breathe { animation: none; }
.ve-tap { transition: background .15s ease, border-color .15s ease, color .15s ease, transform .12s ease; }
.ve-tap:active:not(:disabled) { transform: scale(0.98); }
.ve-tap:disabled { opacity: .5; cursor: default; }
@media (prefers-reduced-motion: reduce) {
  .ve-drop, .ve-rise, .ve-sheet, .ve-breathe { animation: none !important; }
  .ve-tap { transition: none !important; }
}
`;

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

/** True on a phone-width viewport. Drives the single-column + drawer layout. */
export function useIsMobile(breakpoint = 1199): boolean {
  const [mobile, setMobile] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth <= breakpoint
  ));
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const sync = () => setMobile(query.matches);
    sync();
    // Safari below 14 only has the deprecated listener pair.
    if (query.addEventListener) {
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, [breakpoint]);
  return mobile;
}

// ---------------------------------------------------------------------------
// 1 — Guided empty state
// ---------------------------------------------------------------------------

export function GuidedEmptyState(props: {
  onFile: (file: File | null) => void;
  samples: StudioPreset[];
  activeSampleId: string;
  onSample: (preset: StudioPreset) => void;
  brief: string;
  onBrief: (value: string) => void;
}) {
  const [hot, setHot] = useState(false);
  const active = props.samples.find((s) => s.id === props.activeSampleId) || null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <label
        onDragOver={(e) => { e.preventDefault(); setHot(true); }}
        onDragLeave={() => setHot(false)}
        onDrop={(e) => { e.preventDefault(); setHot(false); props.onFile(e.dataTransfer.files?.[0] || null); }}
        className={`ve-drop${hot ? ' ve-drop-hot' : ''}`}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, minHeight: 300, padding: '36px 20px', textAlign: 'center', cursor: 'pointer',
          background: hot ? VE.accentSoft : VE.card,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: VE.radiusCard,
            background: VE.accentSoft, border: `1px solid ${VE.accentLine}`,
          }}
        >
          <UploadCloud size={30} color={VE.accent} />
        </span>
        <span style={{ fontSize: 22, fontWeight: 800, color: VE.text, letterSpacing: '-0.01em' }}>
          Drop your video here to start
        </span>
        <span style={{ fontSize: VE.size, color: VE.textSecondary, maxWidth: 480, lineHeight: 1.6 }}>
          Or tap to choose a file. MP4, MOV or WebM up to 500&nbsp;MB.
        </span>
        {active ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 2,
            background: VE.accentSoft, border: `1px solid ${VE.accentLine}`, color: VE.accent,
            borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 600,
          }}>
            <Check size={14} /> {active.label} style is ready
          </span>
        ) : null}
        <input
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => { props.onFile(e.target.files?.[0] || null); e.target.value = ''; }}
        />
      </label>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ color: VE.text, fontSize: 15, fontWeight: 700 }}>Not sure where to start?</span>
          <HelpTip text="Pick a look now; we apply it the moment your video lands." />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {props.samples.map((sample) => {
            const on = sample.id === props.activeSampleId;
            return (
              <button
                key={sample.id}
                type="button"
                className="ve-tap"
                onClick={() => props.onSample(sample)}
                aria-pressed={on}
                style={{
                  ...veCard,
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
                  padding: '14px 14px', textAlign: 'left', cursor: 'pointer', minHeight: 96,
                  borderColor: on ? VE.accentLine : VE.border,
                  background: on ? VE.accentSoft : VE.card,
                  fontFamily: VE.font,
                }}
              >
                <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden>{sample.emoji}</span>
                <span style={{ color: VE.text, fontSize: VE.size, fontWeight: 750 }}>{sample.label}</span>
                <span style={{ color: VE.textMuted, fontSize: 12.5, lineHeight: 1.5 }}>{sample.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: VE.textSecondary, fontSize: 12.5, fontWeight: 650 }}>
          What is this video for? (optional)
          <HelpTip text="One line of context makes the AI cut plan much sharper." />
        </span>
        <input
          value={props.brief}
          onChange={(e) => props.onBrief(e.target.value)}
          placeholder="e.g. a 30-second promo for my coffee subscription"
          style={{
            background: VE.bg, border: `1px solid ${VE.borderHover}`, borderRadius: VE.radiusBtn,
            padding: '0 14px', minHeight: VE.tap, color: VE.text, fontSize: VE.size,
            fontFamily: VE.font, boxSizing: 'border-box', width: '100%',
          }}
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 — Step flow
// ---------------------------------------------------------------------------

export type StepId = 'trim' | 'effects' | 'captions' | 'music' | 'export';
export type StepTab = 'overlays' | 'motion' | 'vfx' | 'captions' | 'music' | 'export';

export const STUDIO_STEPS: { id: StepId; label: string; tab: StepTab; help: string }[] = [
  { id: 'trim', label: 'Trim & Clips', tab: 'motion', help: 'Cut the boring bits and order your clips.' },
  { id: 'effects', label: 'Effects', tab: 'vfx', help: 'Colour, filters and motion that set the mood.' },
  { id: 'captions', label: 'Captions', tab: 'captions', help: 'Add on-screen words so silent viewers still watch.' },
  { id: 'music', label: 'Music', tab: 'music', help: 'Pick a soundtrack that matches the energy.' },
  { id: 'export', label: 'Export', tab: 'export', help: 'Render the finished MP4 and download it.' },
];

export function StepRail(props: {
  current: StepId;
  done: Record<StepId, boolean>;
  onPick: (id: StepId) => void;
}) {
  return (
    <div
      className="ve-scroll-x"
      role="tablist"
      aria-label="Editing steps"
      style={{ display: 'flex', gap: 8, padding: 4, ...veCard, alignItems: 'stretch' }}
    >
      {STUDIO_STEPS.map((step, i) => {
        const on = props.current === step.id;
        const complete = props.done[step.id];
        return (
          <button
            key={step.id}
            type="button"
            role="tab"
            aria-selected={on}
            title={step.help}
            className="ve-tap"
            onClick={() => props.onPick(step.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, flex: '1 0 auto',
              whiteSpace: 'nowrap', padding: '0 14px', minHeight: VE.tap, cursor: 'pointer',
              borderRadius: VE.radiusBtn, fontFamily: VE.font, fontSize: 13.5, fontWeight: 700,
              border: `1px solid ${on ? VE.accentLine : 'transparent'}`,
              background: on ? VE.accentSoft : 'transparent',
              color: on ? '#B4720A' : complete ? VE.textSecondary : VE.textMuted,
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: 999, fontSize: 11.5, fontWeight: 800,
                background: complete ? VE.good : on ? VE.accent : 'rgba(180,120,0,0.14)',
                color: complete || on ? '#FFFFFF' : VE.textMuted,
              }}
            >
              {complete ? <Check size={13} /> : i + 1}
            </span>
            {step.label}
          </button>
        );
      })}
    </div>
  );
}

export function StepBottomBar(props: {
  current: StepId;
  exporting: boolean;
  canExport: boolean;
  onNext: () => void;
  onExport: () => void;
  extra?: ReactNode;
}) {
  const index = Math.max(0, STUDIO_STEPS.findIndex((s) => s.id === props.current));
  const step = STUDIO_STEPS[index];
  const last = index === STUDIO_STEPS.length - 1;
  return (
    <div
      style={{
        position: 'sticky', bottom: 0, zIndex: 20, display: 'flex', alignItems: 'center',
        gap: 12, flexWrap: 'wrap', padding: '10px 14px', marginTop: 4,
        background: 'rgba(255,255,255,0.96)', borderTop: `1px solid ${VE.border}`,
        borderRadius: `${VE.radiusCard}px ${VE.radiusCard}px 0 0`,
        boxShadow: '0 -10px 28px rgba(120,80,0,0.14)', fontFamily: VE.font,
      }}
    >
      <span style={{ color: VE.textMuted, fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
        STEP {index + 1} OF {STUDIO_STEPS.length}
      </span>
      <span style={{ color: VE.text, fontSize: 15, fontWeight: 750 }}>{step.label}</span>
      <HelpTip text={step.help} />
      {props.extra}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
        {last ? null : (
          <button type="button" className="ve-tap" onClick={props.onNext} style={vePrimary}>
            Next <ChevronRight size={16} />
          </button>
        )}
        {last ? (
          <button
            type="button"
            className="ve-tap"
            disabled={!props.canExport || props.exporting}
            onClick={props.onExport}
            style={vePrimary}
          >
            {props.exporting ? <Loader2 size={16} className="vs-spin" /> : <Download size={16} />}
            {props.exporting ? 'Exporting…' : 'Export Video'}
          </button>
        ) : null}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4 — One-tap style presets
// ---------------------------------------------------------------------------

export function StylePresetRow(props: {
  presets: StudioPreset[];
  activeId: string;
  onPick: (preset: StudioPreset) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: VE.textSecondary, fontSize: 12.5, fontWeight: 700 }}>
        One-tap style
        <HelpTip text="Sets captions, colour, music and speed in a single tap." />
      </span>
      <div className="ve-scroll-x" style={{ display: 'flex', gap: 8, paddingBottom: 2 }}>
        {props.presets.map((preset) => {
          const on = preset.id === props.activeId;
          return (
            <button
              key={preset.id}
              type="button"
              className="ve-tap"
              title={preset.blurb}
              aria-pressed={on}
              onClick={() => props.onPick(preset)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 0 auto',
                whiteSpace: 'nowrap', padding: '0 16px', minHeight: VE.tap, cursor: 'pointer',
                borderRadius: 999, fontFamily: VE.font, fontSize: 13.5, fontWeight: 700,
                border: `1px solid ${on ? VE.accentLine : VE.border}`,
                background: on ? VE.accentSoft : VE.card,
                color: on ? '#B4720A' : VE.textSecondary,
              }}
            >
              <span aria-hidden style={{ fontSize: 16 }}>{preset.emoji}</span>
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5 — AI auto-suggest banner
// ---------------------------------------------------------------------------

export function AiSuggestBar(props: {
  sentence: string;
  applied: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="ve-rise"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 10px 8px 14px', borderRadius: VE.radiusCard,
        background: VE.accentSoft, border: `1px solid ${VE.accentLine}`, fontFamily: VE.font,
      }}
    >
      <span style={{ color: '#B4720A', fontSize: 13.5, lineHeight: 1.5, flex: 1, minWidth: 180 }}>
        <span aria-hidden>✨</span> AI suggests: {props.sentence}
      </span>
      <button
        type="button"
        className="ve-tap"
        onClick={props.onApply}
        disabled={props.applied}
        style={{ ...vePrimary, minHeight: 40, padding: '0 16px', fontSize: 13.5 }}
      >
        {props.applied ? <Check size={15} /> : null} {props.applied ? 'Applied' : 'Apply'}
      </button>
      <button
        type="button"
        className="ve-tap"
        aria-label="Dismiss the suggestion"
        onClick={props.onDismiss}
        style={{ ...veGhost, minHeight: 40, minWidth: 40, padding: 0, border: 'none', color: VE.textMuted }}
      >
        <X size={15} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6 — Live preview feedback
// ---------------------------------------------------------------------------

export function UpdatingPill({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      role="status"
      className="ve-rise"
      style={{
        position: 'absolute', top: 10, left: 10, zIndex: 6,
        display: 'inline-flex', alignItems: 'center', gap: 7,
        background: 'rgba(255,255,255,0.9)', border: `1px solid ${VE.accentLine}`,
        color: '#B4720A', borderRadius: 999, padding: '5px 11px',
        fontSize: 12, fontWeight: 650, fontFamily: VE.font, pointerEvents: 'none',
      }}
    >
      <span className="ve-breathe" aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: VE.accent }} />
      Preview updating…
    </span>
  );
}

/**
 * Flash the pill whenever anything that changes what the player shows moves.
 * The preview itself is already live — this only tells the creator that the
 * frame they are looking at has just been recomposited.
 */
export function usePreviewPulse(signature: string, ms = 520): boolean {
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    setBusy(true);
    const timer = setTimeout(() => setBusy(false), ms);
    return () => clearTimeout(timer);
  }, [signature, ms]);
  return busy;
}

// ---------------------------------------------------------------------------
// 7 — Export finish state
// ---------------------------------------------------------------------------

export function ExportProgress(props: { progress: number; etaS: number; stage: string }) {
  const pct = Math.round(Math.max(0.02, Math.min(1, props.progress)) * 100);
  const eta = props.etaS > 0
    ? props.etaS < 90 ? `~${Math.max(5, Math.round(props.etaS / 5) * 5)} seconds` : `~${Math.ceil(props.etaS / 60)} minutes`
    : '';
  return (
    <div style={{ marginTop: 12, fontFamily: VE.font }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: VE.text, fontSize: VE.size, fontWeight: 700 }}>
          Exporting… {eta}
        </span>
        <span style={{ marginLeft: 'auto', color: VE.textMuted, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: 'rgba(180,120,0,0.14)', overflow: 'hidden', marginTop: 8 }}>
        <div
          className="vs-progress"
          style={{ width: `${pct}%`, height: '100%', background: VE.accent, borderRadius: 999, transition: 'width .8s ease' }}
        />
      </div>
      {props.stage ? <div style={{ color: VE.textMuted, fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>{props.stage}</div> : null}
    </div>
  );
}

export function ExportReady(props: {
  results: { aspect: string; url: string; geometry: string }[];
  onShare: (url: string) => void;
}) {
  if (!props.results.length) return null;
  return (
    <div
      className="ve-rise"
      style={{
        marginTop: 12, padding: 16, borderRadius: VE.radiusCard, fontFamily: VE.font,
        background: VE.goodSoft, border: `1px solid rgba(22,101,52,0.4)`,
      }}
    >
      <div style={{ color: '#166534', fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em' }}>
        <span aria-hidden>✅</span> Video Ready!
      </div>
      <div style={{ color: VE.textSecondary, fontSize: 13, lineHeight: 1.55, marginTop: 5 }}>
        Your download starts automatically. Share the link with anyone — it stays live.
      </div>
      {props.results.map((result) => (
        <div key={result.aspect} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a
              className="ve-tap"
              href={result.url}
              download
              target="_blank"
              rel="noreferrer"
              style={{ ...vePrimary, flex: '1 1 150px', textDecoration: 'none' }}
            >
              <Download size={16} /> Download
            </a>
            <button
              type="button"
              className="ve-tap"
              onClick={() => props.onShare(result.url)}
              style={{ ...veGhost, flex: '1 1 150px', color: VE.text, borderColor: VE.border, background: VE.card }}
            >
              <Share2 size={16} /> Share
            </button>
          </div>
          <div style={{ color: VE.textMuted, fontSize: 11.5, marginTop: 6 }}>
            {result.aspect}{result.geometry ? ` · ${result.geometry}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8 — Mobile bottom-sheet drawer
// ---------------------------------------------------------------------------

export function BottomSheet(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!props.open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onClick={props.onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(26,16,0,0.35)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        className="ve-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: '84vh', overflowY: 'auto', background: VE.bg,
          borderTop: `1px solid ${VE.border}`, borderRadius: '16px 16px 0 0',
          padding: '10px 12px 24px', fontFamily: VE.font,
        }}
      >
        <div style={{ width: 42, height: 4, borderRadius: 999, background: VE.border, margin: '0 auto 10px' }} aria-hidden />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Sliders size={16} color={VE.accent} />
          <span style={{ color: VE.text, fontSize: 16, fontWeight: 750 }}>{props.title}</span>
          <button
            type="button"
            className="ve-tap"
            aria-label="Close"
            onClick={props.onClose}
            style={{ ...veGhost, marginLeft: 'auto', padding: 0, minWidth: VE.tap, border: 'none' }}
          >
            <X size={18} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function SheetTrigger(props: { label: string; onOpen: () => void }) {
  return (
    <button type="button" className="ve-tap" onClick={props.onOpen} style={{ ...veGhost, width: '100%', background: VE.card }}>
      <Sliders size={16} /> {props.label}
    </button>
  );
}

/**
 * The inspector rail is a side panel on a desktop and a bottom-sheet drawer on
 * a phone — same children either way, so nothing in the editor has to know
 * which one it is living in.
 */
export function RailHost(props: {
  mobile: boolean;
  open: boolean;
  title: string;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!props.mobile) {
    return (
      <div
        className="vs-rail"
        style={{ display: 'grid', gap: 10, maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', paddingRight: 2 }}
      >
        {props.children}
      </div>
    );
  }
  return (
    <>
      <SheetTrigger label={props.title} onOpen={props.onOpen} />
      <BottomSheet open={props.open} title={props.title} onClose={props.onClose}>
        <div style={{ display: 'grid', gap: 10 }}>{props.children}</div>
      </BottomSheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// 9 / 10 — Toasts and friendly errors
// ---------------------------------------------------------------------------

export interface StudioToast {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'good' | 'bad';
}

/** One toast queue for the whole studio: undo, copy confirmations, failures. */
export function useToasts(): {
  toasts: StudioToast[];
  push: (toast: Omit<StudioToast, 'id'> & { ttlMs?: number }) => void;
  dismiss: (id: string) => void;
} {
  const [toasts, setToasts] = useState<StudioToast[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((toast: Omit<StudioToast, 'id'> & { ttlMs?: number }) => {
    const id = `toast_${Math.random().toString(36).slice(2, 9)}`;
    const { ttlMs, ...rest } = toast;
    setToasts((list) => [...list.slice(-2), { ...rest, id }]);
    const timer = window.setTimeout(() => dismiss(id), ttlMs || 4000);
    timers.current = [...timers.current.slice(-8), timer];
  }, [dismiss]);

  return { toasts, push, dismiss };
}

export function ToastStack(props: { toasts: StudioToast[]; onDismiss: (id: string) => void }) {
  if (!props.toasts.length) return null;
  return (
    <div
      style={{
        position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 120,
        display: 'grid', gap: 8, width: 'min(420px, calc(100vw - 32px))', fontFamily: VE.font,
      }}
    >
      {props.toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="ve-rise"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px 10px 14px',
            borderRadius: VE.radiusCard, background: VE.card,
            border: `1px solid ${toast.tone === 'bad' ? 'rgba(153,27,27,0.45)' : toast.tone === 'good' ? 'rgba(22,101,52,0.45)' : VE.border}`,
            boxShadow: '0 14px 34px rgba(120,80,0,0.16)',
          }}
        >
          {toast.tone === 'bad' ? <AlertCircle size={16} color={VE.bad} style={{ flexShrink: 0 }} /> : null}
          {toast.tone === 'good' ? <Check size={16} color={VE.good} style={{ flexShrink: 0 }} /> : null}
          <span style={{ flex: 1, color: VE.text, fontSize: 13.5, lineHeight: 1.5 }}>{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              className="ve-tap"
              onClick={() => { toast.onAction?.(); props.onDismiss(toast.id); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent',
                border: 'none', color: '#B4720A', fontWeight: 800, fontSize: 13.5,
                cursor: 'pointer', minHeight: 40, padding: '0 10px', fontFamily: VE.font,
              }}
            >
              <Undo2 size={14} /> {toast.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="ve-tap"
            aria-label="Dismiss"
            onClick={() => props.onDismiss(toast.id)}
            style={{ background: 'transparent', border: 'none', color: VE.textMuted, cursor: 'pointer', minHeight: 40, minWidth: 36, padding: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function FriendlyError(props: { message: string; onRetry?: () => void; onDismiss: () => void }) {
  if (!props.message) return null;
  return (
    <div
      role="alert"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 10px 10px 14px', borderRadius: VE.radiusCard, fontFamily: VE.font,
        background: VE.badSoft, border: '1px solid rgba(153,27,27,0.38)',
      }}
    >
      <AlertCircle size={16} color={VE.bad} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 180, color: '#991B1B', fontSize: 13.5, lineHeight: 1.55 }}>{props.message}</span>
      {props.onRetry ? (
        <button type="button" className="ve-tap" onClick={props.onRetry} style={{ ...veGhost, minHeight: 40, color: '#991B1B', borderColor: 'rgba(153,27,27,0.4)' }}>
          Try again
        </button>
      ) : null}
      <button
        type="button"
        className="ve-tap"
        aria-label="Dismiss"
        onClick={props.onDismiss}
        style={{ background: 'transparent', border: 'none', color: '#991B1B', cursor: 'pointer', minHeight: 40, minWidth: 36, padding: 0 }}
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** Copy a URL and report honestly when the browser refuses. */
export async function copyLink(url: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // Falls through to the textarea path below.
  }
  try {
    const field = document.createElement('textarea');
    field.value = url;
    field.setAttribute('readonly', 'true');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

export function ClipCountBadge(props: { count: number }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, color: VE.textMuted,
        fontSize: 12, fontFamily: VE.font,
      }}
    >
      <Film size={13} /> {props.count} clip{props.count === 1 ? '' : 's'}
    </span>
  );
}
