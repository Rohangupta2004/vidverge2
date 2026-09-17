/**
 * Video Enhancer — editor tool panels.
 *
 * One component per tool tab (Analyze, Trim, Effects, Text, Frame, Music,
 * Export). All state lives in App.tsx; panels receive it as props. Styling
 * follows the shared dark editor palette in editSuite.ts and the .ve-* CSS
 * classes App.tsx injects (hover / active / disabled states).
 */
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Sparkles, Loader2, AlertCircle, Check, Scissors, SlidersHorizontal, Type,
  Crop, Music, Download, Play, Eye, EyeOff, Trash2, Plus, Gauge, Lightbulb,
  ArrowRight, Info, ListOrdered, Volume2, VolumeX, Split, RotateCcw, Target,
  Clapperboard, Film, MoveUpRight, MessageSquare, Tag, Workflow, Wand2, Brain,
} from 'lucide-react';
import type { OverlayElement, OverlayKind, AnalysisInsight } from './overlayEngine';
import { OVERLAY_COLORS, OVERLAY_KIND_LABELS } from './overlayEngine';
import { formatTime } from './enhancerCore';
import {
  P, clamp, EffectsState, DEFAULT_EFFECTS, SPEED_OPTIONS,
  TextOverlayItem, TEXT_COLORS, AspectPreset, ASPECT_PRESETS, TrimSegmentInfo,
  ExportFormat, ExportQuality, QUALITY_OPTIONS, mp4Supported,
} from './editSuite';
import { MUSIC_PRESETS } from './musicSuite';
import type { GeneratedMusic } from './musicSuite';

const KIND_ICONS: Record<OverlayKind, any> = {
  arrow: MoveUpRight,
  callout: MessageSquare,
  highlight: Target,
  step: ListOrdered,
  label: Tag,
  diagram: Workflow,
};

export const panelCard: CSSProperties = {
  background: 'linear-gradient(160deg, ' + P.panel + ', ' + P.card + ')',
  border: '1px solid ' + P.border,
  borderRadius: 14,
  padding: 14,
};

export function ErrLine({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5, color: P.coral, marginTop: 8, lineHeight: 1.5 }}>
      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span style={{ overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

export function PanelHeader({ icon, color, title, right }: { icon: ReactNode; color: string; title: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ color, display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 800 }}>{title}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

export function Chip({ active, disabled, onClick, title, color, children }: {
  active?: boolean; disabled?: boolean; onClick?: () => void; title?: string; color?: string; children: ReactNode;
}) {
  const accent = color || P.blue;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="ve-chip ve-btn"
      style={{
        fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '6px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: active ? '#06080F' : disabled ? P.muted : P.sub,
        background: active ? accent : P.panelSoft,
        border: '1px solid ' + (active ? accent : P.border),
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function SliderRow({ label, value, min, max, step, display, accent, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; accent: string; disabled?: boolean; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 10, opacity: disabled ? 0.45 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: P.sub, fontWeight: 700 }}>{label}</span>
        <span style={{ color: P.muted, fontVariantNumeric: 'tabular-nums' }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: accent, cursor: disabled ? 'not-allowed' : 'pointer', height: 18 }}
      />
    </div>
  );
}

export function PrimaryButton({ onClick, disabled, busy, gradient, shadow, children }: {
  onClick: () => void; disabled?: boolean; busy?: boolean; gradient: string; shadow: string; children: ReactNode;
}) {
  const off = disabled || busy;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={off}
      className="ve-btn"
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 13.5, fontWeight: 800, padding: '12px 14px', borderRadius: 11, border: 'none',
        cursor: off ? 'not-allowed' : 'pointer',
        background: off ? P.panelSoft : gradient,
        color: off ? P.muted : '#fff',
        boxShadow: off ? 'none' : shadow,
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Analysis insights — conditional graphics
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  return score < 50 ? P.coral : score < 75 ? P.amber : P.mint;
}

/** PRD 3.2 — every finding shows a title, before/after chips and a confidence
 *  score with its scale ("x.x / 10") — never a naked number. The extra
 *  structures (score bar, steps, recommendation) render when present. */
function confColor(c: number): string {
  return c < 5 ? P.coral : c < 7.5 ? P.amber : P.mint;
}

function BeforeAfterChips({ before, after }: { before?: string; after?: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 7 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: P.coral, background: 'rgba(255,107,107,0.10)', border: '1px solid rgba(255,107,107,0.35)', borderRadius: 7, padding: '3px 9px' }}>{before || 'Before: not identified'}</span>
      <ArrowRight size={12} style={{ color: P.muted, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: P.mint, background: 'rgba(52,224,176,0.10)', border: '1px solid rgba(52,224,176,0.35)', borderRadius: 7, padding: '3px 9px' }}>{after || 'After: not identified'}</span>
    </div>
  );
}

function InsightRow({ ins }: { ins: AnalysisInsight }) {
  const before = ins.before || ins.compare?.before;
  const after = ins.after || ins.compare?.after;
  const conf = typeof ins.confidence === 'number' && Number.isFinite(ins.confidence) ? Math.min(10, Math.max(0, ins.confidence)) : null;
  const hasScore = typeof ins.score === 'number' && Number.isFinite(ins.score);
  const scoreC = hasScore ? scoreColor(ins.score as number) : P.mint;
  const verdict = hasScore ? ((ins.score as number) < 50 ? 'below average' : (ins.score as number) < 75 ? 'average' : 'strong') : '';
  return (
    <div style={{ padding: '9px 11px', borderRadius: 10, background: P.panelSoft, border: '1px solid ' + P.borderSoft }}>
      {/* Title + confidence — the confidence always carries its scale */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: P.text }}>{ins.title || ins.text}</span>
        {conf != null && (
          <span title="How confident the AI is in this finding" style={{ fontSize: 10.5, fontWeight: 800, color: confColor(conf), background: 'rgba(7,10,18,0.6)', border: '1px solid ' + confColor(conf) + '55', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {conf.toFixed(1)} / 10 confidence
          </span>
        )}
      </div>
      {ins.title && ins.title !== ins.text ? (
        <div style={{ fontSize: 12, color: P.sub, lineHeight: 1.5, marginTop: 4 }}>{ins.text}</div>
      ) : null}
      {/* Before → after chips — the one pattern for every finding type */}
      <BeforeAfterChips before={before} after={after} />
      {hasScore && (
        <div style={{ marginTop: 8 }}>
          <div style={{ height: 6, borderRadius: 999, background: 'rgba(7,10,18,0.7)', overflow: 'hidden', border: '1px solid ' + P.borderSoft }}>
            <div style={{ height: '100%', width: (ins.score as number) + '%', borderRadius: 999, background: 'linear-gradient(90deg, ' + scoreC + 'AA, ' + scoreC + ')', transition: 'width .4s ease' }} />
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: scoreC, marginTop: 4, display: 'flex', gap: 5, alignItems: 'center' }}>
            <Gauge size={11} /> {ins.score}/100 — {verdict}
          </div>
        </div>
      )}
      {Array.isArray(ins.steps) && ins.steps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {ins.steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
              <span style={{ width: 16, height: 16, borderRadius: 999, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800, color: '#06080F', background: P.violet, marginTop: 1 }}>{i + 1}</span>
              <span style={{ fontSize: 11.5, color: P.muted, lineHeight: 1.45 }}>{s}</span>
            </div>
          ))}
        </div>
      )}
      {ins.recommendation && ins.recommendation !== ins.text && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8, fontSize: 12, fontWeight: 700, color: P.amber }}>
          <Lightbulb size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{ins.recommendation}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analyze panel
// ---------------------------------------------------------------------------

/** The wait is long enough (frame sampling, then a vision pass over them) that
 *  it needs to read as deliberate work rather than a hung spinner. */
function AnalyzingState({ note }: { note: string }) {
  return (
    <div
      className="ve-fade"
      style={{
        marginTop: 12, padding: '16px 14px', borderRadius: 12, textAlign: 'center',
        background: 'linear-gradient(150deg, rgba(61,139,255,0.12), rgba(167,139,250,0.10))',
        border: '1px solid rgba(61,139,255,0.3)',
      }}
    >
      <div style={{ position: 'relative', width: 46, height: 46, margin: '0 auto 10px' }}>
        <span
          className="ve-pulse"
          style={{
            position: 'absolute', inset: 0, borderRadius: 999,
            background: 'radial-gradient(circle, rgba(61,139,255,0.55), transparent 68%)',
            filter: 'blur(3px)',
          }}
        />
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.blue }}>
          <Brain size={24} />
        </span>
        <Loader2 size={46} className="animate-spin" style={{ position: 'absolute', inset: 0, color: 'rgba(167,139,250,0.45)' }} />
      </div>
      <div className="ve-gradient-text" style={{ fontSize: 14, fontWeight: 800 }}>The AI is analyzing your video…</div>
      <div className="ve-pulse" style={{ fontSize: 12, color: P.sub, marginTop: 5, lineHeight: 1.5 }}>
        {note || 'Sampling frames and designing the overlay direction.'}
      </div>
    </div>
  );
}

export function AnalyzePanel({
  analyzing, analyzeNote, analyzeErr, summary, insights, elements, canAnalyze,
  onAnalyze, onToggleElement, onDeleteElement, onSeek, exporting,
}: {
  analyzing: boolean; analyzeNote: string; analyzeErr: string; summary: string;
  insights: AnalysisInsight[]; elements: OverlayElement[]; canAnalyze: boolean;
  onAnalyze: () => void; onToggleElement: (id: string) => void; onDeleteElement: (id: string) => void;
  onSeek: (t: number) => void; exporting: boolean;
}) {
  const enabledCount = elements.filter((e) => e.enabled).length;
  const kindCounts: Partial<Record<OverlayKind, number>> = {};
  for (const e of elements) kindCounts[e.kind] = (kindCounts[e.kind] || 0) + 1;
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader
          icon={<Clapperboard size={15} />}
          color={P.amber}
          title="AI scene analysis"
          right={<span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: P.violet, background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 999, padding: '3px 9px' }}>AI vision</span>}
        />
        <div style={{ fontSize: 12.5, color: P.muted, lineHeight: 1.55, marginBottom: 12 }}>
          Frames are sampled from your footage; the AI reports what it sees and designs graphic overlays that fit the content. Findings show a supporting chart only when they actually need one — plain findings stay plain text.
        </div>
        <PrimaryButton
          onClick={onAnalyze}
          disabled={!canAnalyze || exporting}
          busy={analyzing}
          gradient={'linear-gradient(100deg, ' + P.blue + ', ' + P.violet + ')'}
          shadow="0 12px 30px -14px rgba(61,139,255,0.8)"
        >
          {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {analyzing ? 'Enhancing your footage…' : elements.length ? 'Re-enhance the footage' : 'Enhance video'}
        </PrimaryButton>
        {analyzing && <AnalyzingState note={analyzeNote} />}
        {analyzeErr && <ErrLine>{analyzeErr}</ErrLine>}
        {summary && !analyzing && (
          <div className="ve-fade" style={{ fontSize: 12.5, color: P.sub, lineHeight: 1.55, marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(61,139,255,0.07)', border: '1px solid rgba(61,139,255,0.22)' }}>
            <span style={{ fontWeight: 800, color: P.blue }}>What the AI saw:</span> {summary}
          </div>
        )}
      </div>

      {insights.length > 0 && !analyzing && (
        <div className="ve-fade" style={{ ...panelCard, marginTop: 12 }}>
          <PanelHeader icon={<Info size={15} />} color={P.cyan} title="Smart analysis" right={<span style={{ fontSize: 11, color: P.muted }}>graphics only where needed</span>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insights.map((ins) => <InsightRow key={ins.id} ins={ins} />)}
          </div>
        </div>
      )}

      {elements.length > 0 && (
        <div className="ve-fade" style={{ ...panelCard, marginTop: 12 }}>
          <PanelHeader
            icon={<Target size={15} />}
            color={P.coral}
            title="Overlay elements"
            right={<span style={{ fontSize: 11, color: P.muted }}>{enabledCount} of {elements.length} on</span>}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {(Object.keys(kindCounts) as OverlayKind[]).map((k) => (
              <span key={k} className="ve-chip" style={{ fontSize: 10.5, fontWeight: 800, color: OVERLAY_COLORS[k], background: 'rgba(7,10,18,0.55)', border: '1px solid ' + OVERLAY_COLORS[k] + '66', borderRadius: 999, padding: '3px 9px' }}>
                {kindCounts[k]} × {OVERLAY_KIND_LABELS[k]}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 330, overflowY: 'auto', paddingRight: 2 }}>
            {elements.map((el) => {
              const Icon = KIND_ICONS[el.kind];
              return (
                <div
                  key={el.id}
                  className="ve-elcard"
                  onClick={() => onSeek(el.start)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 11,
                    background: P.panelSoft, border: '1px solid ' + (el.enabled ? el.color + '55' : P.borderSoft),
                    opacity: el.enabled ? 1 : 0.5,
                  }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: el.color, background: el.color + '1E', border: '1px solid ' + el.color + '55' }}>
                    <Icon size={14} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: el.color }}>{OVERLAY_KIND_LABELS[el.kind]}{el.kind === 'step' && el.step ? ' ' + el.step : ''}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: P.muted, fontVariantNumeric: 'tabular-nums' }}>{formatTime(el.start)} → {formatTime(el.end)}</span>
                    </span>
                    {el.text && <span style={{ display: 'block', fontSize: 11.5, color: P.sub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.text}</span>}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleElement(el.id); }}
                    title={el.enabled ? 'Disable this element' : 'Enable this element'}
                    className="ve-btn"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, border: '1px solid ' + P.border, background: 'transparent', color: el.enabled ? P.mint : P.muted, cursor: 'pointer', flexShrink: 0 }}
                  >
                    {el.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteElement(el.id); }}
                    title="Remove this element"
                    className="ve-btn"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, border: '1px solid ' + P.border, background: 'transparent', color: P.coral, cursor: 'pointer', flexShrink: 0 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trim panel
// ---------------------------------------------------------------------------

export function TrimPanel({
  duration, inPoint, outPoint, playheadT, segments, splits, keptSeconds, disabled,
  onSetIn, onSetOut, onResetTrim, onSplit, onClearSplits, onToggleSegment, onSeek,
}: {
  duration: number; inPoint: number; outPoint: number; playheadT: number;
  segments: TrimSegmentInfo[]; splits: number[]; keptSeconds: number; disabled: boolean;
  onSetIn: () => void; onSetOut: () => void; onResetTrim: () => void;
  onSplit: () => void; onClearSplits: () => void; onToggleSegment: (key: string) => void; onSeek: (t: number) => void;
}) {
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader
          icon={<Scissors size={15} />}
          color={P.blue}
          title="Trim & cut"
          right={<span style={{ fontSize: 11, color: P.mint, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatTime(keptSeconds)} kept</span>}
        />
        <div style={{ fontSize: 12.5, color: P.muted, lineHeight: 1.55, marginBottom: 12 }}>
          Drag the handles on the timeline below the player, or set in/out points at the playhead. Split at the playhead to cut a middle section out.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <Chip disabled={disabled} onClick={onSetIn} title="Set the in point at the playhead">⇤ In at {formatTime(playheadT)}</Chip>
          <Chip disabled={disabled} onClick={onSetOut} title="Set the out point at the playhead">Out at {formatTime(playheadT)} ⇥</Chip>
          <Chip disabled={disabled} onClick={onSplit} color={P.amber} title="Split the clip at the playhead"><Split size={12} style={{ display: 'inline', verticalAlign: -2 }} /> Split here</Chip>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: P.muted, marginBottom: 10, fontVariantNumeric: 'tabular-nums' }}>
          <span>In <b style={{ color: P.sub }}>{formatTime(inPoint)}</b></span>
          <span>Out <b style={{ color: P.sub }}>{formatTime(outPoint || duration)}</b></span>
          <span>Splits <b style={{ color: P.sub }}>{splits.length}</b></span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip disabled={disabled || splits.length === 0} onClick={onClearSplits}>Clear splits</Chip>
          <Chip disabled={disabled} onClick={onResetTrim}><RotateCcw size={11} style={{ display: 'inline', verticalAlign: -1 }} /> Reset trim</Chip>
        </div>
      </div>

      <div style={{ ...panelCard, marginTop: 12 }}>
        <PanelHeader icon={<Film size={15} />} color={P.violet} title="Segments" right={<span style={{ fontSize: 11, color: P.muted }}>tap the scissors to cut one</span>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 300, overflowY: 'auto' }}>
          {segments.map((seg, i) => (
            <div
              key={seg.key}
              className="ve-elcard"
              onClick={() => onSeek(seg.start)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
                background: P.panelSoft, border: '1px solid ' + (seg.kept ? 'rgba(61,139,255,0.35)' : P.borderSoft),
                opacity: seg.kept ? 1 : 0.5,
              }}
            >
              <span style={{ width: 24, height: 24, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 800, color: seg.kept ? '#06080F' : P.muted, background: seg.kept ? P.blue : 'transparent', border: '1px solid ' + (seg.kept ? P.blue : P.border) }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 12, color: seg.kept ? P.sub : P.muted, fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(seg.start)} → {formatTime(seg.end)}
                <span style={{ color: P.muted }}> · {(seg.end - seg.start).toFixed(1)}s</span>
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, color: seg.kept ? P.mint : P.coral }}>{seg.kept ? 'KEPT' : 'CUT'}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSegment(seg.key); }}
                title={seg.kept ? 'Cut this segment' : 'Restore this segment'}
                className="ve-btn"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, border: '1px solid ' + P.border, background: 'transparent', color: seg.kept ? P.coral : P.mint, cursor: 'pointer', flexShrink: 0 }}
              >
                {seg.kept ? <Scissors size={13} /> : <RotateCcw size={13} />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Effects panel
// ---------------------------------------------------------------------------

export function EffectsPanel({ effects, disabled, onChange }: {
  effects: EffectsState; disabled: boolean; onChange: (fx: EffectsState) => void;
}) {
  const set = (patch: Partial<EffectsState>) => onChange({ ...effects, ...patch });
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader
          icon={<SlidersHorizontal size={15} />}
          color={P.mint}
          title="Filters"
          right={
            <button type="button" className="ve-btn" onClick={() => onChange({ ...DEFAULT_EFFECTS, speed: effects.speed })} style={{ fontSize: 11, fontWeight: 700, color: P.sub, background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
              Reset
            </button>
          }
        />
        <SliderRow label="Brightness" value={effects.brightness} min={40} max={180} step={1} display={effects.brightness + '%'} accent={P.blue} disabled={disabled} onChange={(v) => set({ brightness: v })} />
        <SliderRow label="Contrast" value={effects.contrast} min={40} max={180} step={1} display={effects.contrast + '%'} accent={P.amber} disabled={disabled} onChange={(v) => set({ contrast: v })} />
        <SliderRow label="Saturation" value={effects.saturation} min={0} max={200} step={1} display={effects.saturation + '%'} accent={P.coral} disabled={disabled} onChange={(v) => set({ saturation: v })} />
        <SliderRow label="Blur" value={effects.blur} min={0} max={8} step={0.5} display={effects.blur + 'px'} accent={P.violet} disabled={disabled} onChange={(v) => set({ blur: v })} />
        <SliderRow label="Vignette" value={effects.vignette} min={0} max={100} step={1} display={effects.vignette + '%'} accent={P.cyan} disabled={disabled} onChange={(v) => set({ vignette: v })} />
      </div>
      <div style={{ ...panelCard, marginTop: 12 }}>
        <PanelHeader icon={<Play size={15} />} color={P.amber} title="Playback speed" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SPEED_OPTIONS.map((s) => (
            <Chip key={s} active={effects.speed === s} disabled={disabled} onClick={() => set({ speed: s })} color={P.amber}>
              {s}×
            </Chip>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: P.muted, marginTop: 10, lineHeight: 1.5 }}>
          Speed applies to the preview and the export. Original audio speeds up with the footage; generated music stays at normal tempo.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text panel
// ---------------------------------------------------------------------------

export function TextPanel({ texts, selectedId, duration, playheadT, disabled, onSelect, onAdd, onUpdate, onRemove }: {
  texts: TextOverlayItem[]; selectedId: string | null; duration: number; playheadT: number; disabled: boolean;
  onSelect: (id: string | null) => void; onAdd: () => void;
  onUpdate: (id: string, patch: Partial<TextOverlayItem>) => void; onRemove: (id: string) => void;
}) {
  const sel = texts.find((t) => t.id === selectedId) || null;
  // A range input silently clamps a `value` outside [min, max], so a bound
  // derived from an unknown duration used to snap a text overlay's timing to
  // a fraction of a second the moment the slider was touched. Widen the
  // bounds to cover whatever the overlay already holds.
  const timeMax = Math.max(duration, sel ? sel.end : 0, 1);
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader
          icon={<Type size={15} />}
          color={P.violet}
          title="Text overlays"
          right={
            <button type="button" className="ve-btn" onClick={onAdd} disabled={disabled} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 800, color: '#fff', background: disabled ? P.panelSoft : P.violet, border: 'none', borderRadius: 8, padding: '5px 11px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
              <Plus size={12} /> Add text
            </button>
          }
        />
        <div style={{ fontSize: 12.5, color: P.muted, lineHeight: 1.55 }}>
          New text drops in at the playhead. Select it below, then <b style={{ color: P.sub }}>drag it on the player</b> to position it.
        </div>
        {texts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10, maxHeight: 180, overflowY: 'auto' }}>
            {texts.map((t) => (
              <div
                key={t.id}
                className="ve-elcard"
                onClick={() => onSelect(t.id === selectedId ? null : t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 10,
                  background: t.id === selectedId ? 'rgba(167,139,250,0.10)' : P.panelSoft,
                  border: '1px solid ' + (t.id === selectedId ? 'rgba(167,139,250,0.5)' : P.borderSoft),
                }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 4, flexShrink: 0, background: t.color, border: '1px solid rgba(255,255,255,0.25)' }} />
                <span style={{ flex: 1, fontSize: 12, color: P.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>{t.text || '(empty)'}</span>
                <span style={{ fontSize: 10.5, color: P.muted, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatTime(t.start)}–{formatTime(t.end)}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(t.id); }}
                  title="Delete this text"
                  className="ve-btn"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 7, border: '1px solid ' + P.border, background: 'transparent', color: P.coral, cursor: 'pointer', flexShrink: 0 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {sel && (
        <div className="ve-fade" style={{ ...panelCard, marginTop: 12 }}>
          <PanelHeader icon={<Type size={15} />} color={P.violet} title="Edit selected text" />
          <input
            type="text"
            value={sel.text}
            maxLength={80}
            onChange={(e) => onUpdate(sel.id, { text: e.target.value })}
            placeholder="Your text"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontWeight: 700, color: P.text, background: 'rgba(7,10,18,0.6)', border: '1px solid ' + P.border, borderRadius: 10, padding: '10px 12px', outline: 'none', marginBottom: 12 }}
          />
          <SliderRow label="Font size" value={Math.min(0.14, Math.max(0.025, sel.size))} min={0.025} max={0.14} step={0.005} display={Math.round(sel.size * 1000) / 10 + '%'} accent={P.violet} disabled={disabled} onChange={(v) => onUpdate(sel.id, { size: v })} />
          <div style={{ fontSize: 12, color: P.sub, fontWeight: 700, marginBottom: 6 }}>Color</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="ve-btn"
                onClick={() => onUpdate(sel.id, { color: c })}
                title={c}
                style={{ width: 26, height: 26, borderRadius: 8, background: c, cursor: 'pointer', border: sel.color === c ? '2px solid #fff' : '2px solid transparent', boxShadow: sel.color === c ? '0 0 0 2px ' + P.violet : 'none' }}
              />
            ))}
          </div>
          <SliderRow label="Starts at" value={Math.min(sel.start, timeMax - 0.3)} min={0} max={Math.max(0.1, timeMax - 0.3)} step={0.1} display={formatTime(sel.start)} accent={P.blue} disabled={disabled} onChange={(v) => onUpdate(sel.id, { start: Math.min(v, sel.end - 0.3) })} />
          <SliderRow label="Ends at" value={Math.max(0.3, Math.min(sel.end, timeMax))} min={0.3} max={timeMax} step={0.1} display={formatTime(sel.end)} accent={P.blue} disabled={disabled} onChange={(v) => onUpdate(sel.id, { end: Math.max(v, sel.start + 0.3) })} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Chip onClick={() => onUpdate(sel.id, { start: Math.min(Math.round(playheadT * 10) / 10, sel.end - 0.3) })}>Start at playhead</Chip>
            <Chip onClick={() => onUpdate(sel.id, { end: Math.max(Math.round(playheadT * 10) / 10, sel.start + 0.3) })}>End at playhead</Chip>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frame panel (aspect ratio + audio)
// ---------------------------------------------------------------------------

export function FramePanel({ aspect, muteOriginal, originalVolume, disabled, onAspect, onMute, onVolume }: {
  aspect: AspectPreset; muteOriginal: boolean; originalVolume: number; disabled: boolean;
  onAspect: (a: AspectPreset) => void; onMute: (m: boolean) => void; onVolume: (v: number) => void;
}) {
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader icon={<Crop size={15} />} color={P.cyan} title="Aspect ratio" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {ASPECT_PRESETS.map((a) => (
            <button
              key={a.id}
              type="button"
              className="ve-btn"
              disabled={disabled}
              onClick={() => onAspect(a.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 8px',
                borderRadius: 11, cursor: disabled ? 'not-allowed' : 'pointer',
                background: aspect === a.id ? 'rgba(34,211,238,0.12)' : P.panelSoft,
                border: '1px solid ' + (aspect === a.id ? P.cyan : P.border),
              }}
            >
              <span style={{
                display: 'block',
                width: a.ratio === null ? 30 : a.ratio >= 1 ? 30 : 30 * a.ratio,
                height: a.ratio === null ? 20 : a.ratio >= 1 ? 30 / a.ratio : 30,
                maxHeight: 26, borderRadius: 3,
                border: '1.5px solid ' + (aspect === a.id ? P.cyan : P.muted),
                background: aspect === a.id ? 'rgba(34,211,238,0.15)' : 'transparent',
              }} />
              <span style={{ fontSize: 11.5, fontWeight: 800, color: aspect === a.id ? P.cyan : P.sub }}>{a.label}</span>
              <span style={{ fontSize: 9.5, color: P.muted }}>{a.hint}</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: P.muted, marginTop: 10, lineHeight: 1.5 }}>
          The frame is center-cropped to the chosen ratio — the preview shows exactly what exports.
        </div>
      </div>

      <div style={{ ...panelCard, marginTop: 12 }}>
        <PanelHeader icon={muteOriginal ? <VolumeX size={15} /> : <Volume2 size={15} />} color={P.amber} title="Original audio" />
        <button
          type="button"
          className="ve-btn"
          onClick={() => onMute(!muteOriginal)}
          disabled={disabled}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 11,
            cursor: disabled ? 'not-allowed' : 'pointer', marginBottom: 12,
            background: muteOriginal ? 'rgba(255,107,107,0.09)' : 'rgba(52,224,176,0.08)',
            border: '1px solid ' + (muteOriginal ? 'rgba(255,107,107,0.4)' : 'rgba(52,224,176,0.4)'),
          }}
        >
          <span style={{
            width: 34, height: 20, borderRadius: 999, position: 'relative', flexShrink: 0,
            background: muteOriginal ? 'rgba(255,107,107,0.35)' : P.mint, transition: 'background .18s ease',
          }}>
            <span style={{ position: 'absolute', top: 2, left: muteOriginal ? 2 : 16, width: 16, height: 16, borderRadius: 999, background: '#fff', transition: 'left .18s ease' }} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: muteOriginal ? P.coral : P.mint }}>
            {muteOriginal ? 'Original audio muted' : 'Original audio on'}
          </span>
        </button>
        <SliderRow
          label="Original volume"
          value={Math.round(originalVolume * 100)}
          min={0} max={100} step={1}
          display={Math.round(originalVolume * 100) + '%'}
          accent={P.amber}
          disabled={disabled || muteOriginal}
          onChange={(v) => onVolume(v / 100)}
        />
        <div style={{ fontSize: 11.5, color: P.muted, lineHeight: 1.5 }}>
          Applies to the export. Add a music bed in the Music tab and balance the two there.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Music panel
// ---------------------------------------------------------------------------

export function MusicPanel({
  track, trackUrl, musicVolume, busy, note, err, prompt, keptSeconds, disabled,
  onPrompt, onGenerate, onVolume, onRemove,
}: {
  track: GeneratedMusic | null; trackUrl: string; musicVolume: number; busy: boolean;
  note: string; err: string; prompt: string; keptSeconds: number; disabled: boolean;
  onPrompt: (p: string) => void; onGenerate: () => void; onVolume: (v: number) => void; onRemove: () => void;
}) {
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader
          icon={<Music size={15} />}
          color={P.mint}
          title="Music bed"
          right={<span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: P.mint, background: 'rgba(52,224,176,0.10)', border: '1px solid rgba(52,224,176,0.35)', borderRadius: 999, padding: '3px 9px' }}>AI music</span>}
        />
        <div style={{ fontSize: 12.5, color: P.muted, lineHeight: 1.55, marginBottom: 10 }}>
          Describe a mood or pick a style — the track is generated to fit your video ({Math.round(keptSeconds)}s kept) and mixed into the export under the original audio.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {MUSIC_PRESETS.map((p) => (
            <Chip key={p.label} active={prompt === p.prompt} disabled={busy} onClick={() => onPrompt(p.prompt)} color={P.mint} title={p.prompt}>
              {p.label}
            </Chip>
          ))}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          rows={2}
          maxLength={400}
          placeholder="e.g. upbeat lo-fi with warm keys, or cinematic dramatic strings…"
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 12.5, color: P.text, background: 'rgba(7,10,18,0.6)', border: '1px solid ' + P.border, borderRadius: 10, padding: '10px 12px', outline: 'none', marginBottom: 10, fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <PrimaryButton
          onClick={onGenerate}
          disabled={disabled || !prompt.trim()}
          busy={busy}
          gradient={'linear-gradient(100deg, ' + P.mint + ', ' + P.cyan + ')'}
          shadow="0 12px 30px -14px rgba(52,224,176,0.7)"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {busy ? 'Composing your track…' : track ? 'Regenerate music' : 'Generate music'}
        </PrimaryButton>
        {busy && note && (
          <div className="ve-pulse" style={{ fontSize: 12, color: P.mint, marginTop: 9, display: 'flex', gap: 7, alignItems: 'center' }}>
            <Loader2 size={12} className="animate-spin" /> {note}
          </div>
        )}
        {err && <ErrLine>{err}</ErrLine>}
      </div>

      {track && trackUrl && (
        <div className="ve-fade" style={{ ...panelCard, marginTop: 12 }}>
          <PanelHeader
            icon={<Check size={15} />}
            color={P.mint}
            title="Track ready"
            right={
              <button type="button" className="ve-btn" onClick={onRemove} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: P.coral, background: 'transparent', border: '1px solid ' + P.border, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
                <Trash2 size={11} /> Remove
              </button>
            }
          />
          <audio src={trackUrl} controls style={{ width: '100%', height: 34, marginBottom: 12 }} />
          <SliderRow
            label="Music volume (vs original audio)"
            value={Math.round(musicVolume * 100)}
            min={0} max={100} step={1}
            display={Math.round(musicVolume * 100) + '%'}
            accent={P.mint}
            onChange={(v) => onVolume(v / 100)}
          />
          <div style={{ fontSize: 11.5, color: track.source === 'byok' ? P.mint : P.sub, lineHeight: 1.55, padding: '8px 10px', borderRadius: 9, background: 'rgba(7,10,18,0.5)', border: '1px solid ' + P.borderSoft }}>
            {track.note}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export panel
// ---------------------------------------------------------------------------

export function ExportPanel({
  format, quality, exporting, progress, note, err, outputUrl, canExport, disabled,
  keptSeconds, speed, overlayCount, textCount, hasMusic, aspect, downloadExt,
  hasCaptions, sfxCount,
  onFormat, onQuality, onExport,
}: {
  format: ExportFormat; quality: ExportQuality; exporting: boolean; progress: number;
  note: string; err: string; outputUrl: string; canExport: boolean; disabled: boolean;
  keptSeconds: number; speed: number; overlayCount: number; textCount: number;
  hasMusic: boolean; aspect: AspectPreset; downloadExt: string;
  hasCaptions: boolean; sfxCount: number;
  onFormat: (f: ExportFormat) => void; onQuality: (q: ExportQuality) => void; onExport: () => void;
}) {
  const [mp4Ok] = useState(() => mp4Supported());
  const outSeconds = speed > 0 ? keptSeconds / speed : keptSeconds;
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader icon={<Download size={15} />} color={P.mint} title="Download" />
        <div style={{ fontSize: 12, color: P.sub, fontWeight: 700, marginBottom: 6 }}>Format</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Chip active={format === 'auto'} disabled={exporting} onClick={() => onFormat('auto')} color={P.mint} title={mp4Ok ? 'Best available — MP4 on this browser' : 'Best available — WebM on this browser'}>Auto {mp4Ok ? '(MP4)' : '(WebM)'}</Chip>
          <Chip active={format === 'mp4'} disabled={exporting || !mp4Ok} onClick={() => onFormat('mp4')} color={P.mint} title={mp4Ok ? 'MP4 / H.264' : 'This browser cannot record MP4 — use Auto or WebM'}>MP4</Chip>
          <Chip active={format === 'webm'} disabled={exporting} onClick={() => onFormat('webm')} color={P.mint} title="WebM / VP9">WebM</Chip>
        </div>
        {!mp4Ok && (
          <div style={{ fontSize: 11, color: P.muted, marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>
            This browser cannot record MP4 directly — exports fall back to WebM (plays everywhere modern).
          </div>
        )}
        <div style={{ fontSize: 12, color: P.sub, fontWeight: 700, marginBottom: 6 }}>Quality</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {QUALITY_OPTIONS.map((q) => (
            <Chip key={q.id} active={quality === q.id} disabled={exporting} onClick={() => onQuality(q.id)} color={P.cyan} title={q.hint}>{q.label}</Chip>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: P.muted, lineHeight: 1.7, padding: '9px 11px', borderRadius: 10, background: 'rgba(7,10,18,0.5)', border: '1px solid ' + P.borderSoft, marginBottom: 12 }}>
          <b style={{ color: P.sub }}>{formatTime(outSeconds)}</b> output ({formatTime(keptSeconds)} kept{speed !== 1 ? ' at ' + speed + '×' : ''})
          · <b style={{ color: P.sub }}>{aspect === 'original' ? 'original frame' : aspect}</b>
          · {overlayCount} AI overlay{overlayCount === 1 ? '' : 's'}
          · {textCount} text{textCount === 1 ? '' : 's'}
          · {hasCaptions ? 'captions burned in' : 'no captions'}
          · {hasMusic ? 'music bed mixed in' : 'no music bed'}
          · {sfxCount} sound effect{sfxCount === 1 ? '' : 's'}
        </div>
        <PrimaryButton
          onClick={onExport}
          disabled={disabled || !canExport}
          busy={exporting}
          gradient={'linear-gradient(100deg, ' + P.mint + ', ' + P.cyan + ')'}
          shadow="0 14px 34px -14px rgba(52,224,176,0.75)"
        >
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {exporting ? 'Preparing ' + Math.round(progress * 100) + '%…' : 'Download video'}
        </PrimaryButton>
        {exporting && (
          <div style={{ marginTop: 10 }}>
            <div style={{ height: 7, borderRadius: 999, background: P.panelSoft, overflow: 'hidden', border: '1px solid ' + P.borderSoft }}>
              <div style={{ height: '100%', width: Math.round(progress * 100) + '%', background: 'linear-gradient(90deg, ' + P.mint + ', ' + P.cyan + ')', borderRadius: 999, transition: 'width .3s ease' }} />
            </div>
            {note && <div style={{ fontSize: 12, color: P.sub, marginTop: 7, lineHeight: 1.5 }}>{note}</div>}
            <div style={{ fontSize: 11, color: P.muted, marginTop: 5, lineHeight: 1.5 }}>
              The footage plays through once while it renders — keep this tab in the foreground.
            </div>
          </div>
        )}
        {!exporting && note && outputUrl && <div style={{ fontSize: 12, color: P.sub, marginTop: 8, lineHeight: 1.5 }}>{note}</div>}
        {err && <ErrLine>{err}</ErrLine>}
        {outputUrl && !exporting && !err && (
          <div className="ve-fade" style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: P.mint, fontWeight: 700, marginBottom: 10 }}>
              <Check size={14} /> Enhanced video ready — playing in the player now.
            </div>
            <a
              href={outputUrl}
              target="_blank"
              rel="noreferrer"
              download={'enhanced.' + (downloadExt || 'webm')}
              className="ve-btn"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 12.5, fontWeight: 800, color: '#06231A', background: P.mint, borderRadius: 10, padding: '10px 14px', textDecoration: 'none' }}
            >
              <Download size={14} /> Download enhanced video
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
