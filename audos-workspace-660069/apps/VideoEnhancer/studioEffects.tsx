/**
 * Video Studio — the effects sidebar.
 *
 * Six tabs, one mental model each:
 *   OVERLAYS  b-roll clips composited over the footage, and the chroma key
 *   MOTION    what the camera and the clock do — speed ramps, match cuts, shake
 *   VFX       what is painted on top — leaks, VHS, glitch, glow, displacement
 *   CAPTIONS  generate, design and edit the caption track line by line
 *   MUSIC     subject-aware AI soundtrack generation and preview
 *   EXPORT    render settings, progress and finished masters
 *
 * Motion is per-clip (it belongs to a shot), VFX and the key are whole-video.
 * Every control writes straight into the EditDoc, so the stage and the export
 * see the change on the next frame with no apply step in between.
 */
import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AlertCircle, Clapperboard, Download, Film, Layers, Loader2, Plus, RefreshCw,
  Scissors, Sparkles, Trash2, Type as TypeIcon, UploadCloud, Wand2, Zap,
} from 'lucide-react';
import { Chip, ColorField, Section, SelectField, Slider, Toggle } from './uiControls';
import { MODEL_CHOICES } from '../../lib/appIds';
import { colors, tint } from '../../components/design-system/index';
import {
  CAPTION_ANIMATIONS, CAPTION_BACKGROUNDS, CAPTION_FONTS, CameraShake,
  CaptionAnimationId, CaptionBackgroundId, CaptionCue, CaptionSettings,
  CaptionStyleId, ChromaKeyState, DisplacePresetId, GlowState, LB, LeakPresetId,
  LeakState, SpeedCurveId, SpeedRamp, StudioClip, VideoOverlay, VfxState,
  ZoomCut, ZoomIntensityId, clipMotion, fmtTimecode, fontCss,
} from './studioModel';
import { CAPTION_STYLES } from './studioStyles';
import {
  DISPLACE_PRESETS, LIGHT_LEAKS, OVERLAY_POSITIONS, SHAKE_FREQUENCIES,
  SPEED_CURVES, ZOOM_INTENSITIES, rampRange, warpRate,
} from './studioFx';
import { languageLabel } from './studioCaptionKit';
import { engineAvailabilityBadge, engineHealthWarning, isEngineAvailable } from '../../lib/videoEngines';
import VideoErrorCard from '../../components/video/VideoErrorCard';
import VideoGeneratingState from '../../components/video/VideoGeneratingState';

const rowWrap: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 };
const hint: CSSProperties = { color: LB.textMuted, fontSize: 11, lineHeight: 1.55, marginTop: 6 };
const miniBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, background: '#2A2410',
  border: '1px solid rgba(255,255,255,0.07)', color: LB.textSecondary, borderRadius: 7,
  padding: '5px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
};
const primaryBtn: CSSProperties = {
  ...miniBtn, background: LB.accentGradient, color: '#ffffff', border: 'none', fontWeight: 800,
};
const numInput: CSSProperties = {
  background: '#18150A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7,
  padding: '5px 7px', color: LB.textPrimary, fontSize: 12, width: '100%', boxSizing: 'border-box',
};
const groupTitle: CSSProperties = { color: LB.textSecondary, fontSize: 12, fontWeight: 650 };
const divider: CSSProperties = { marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' };

function Notice({ tone, children }: { tone: 'info' | 'warn'; children: ReactNode }) {
  const warn = tone === 'warn';
  return (
    <div
      style={{
        display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 9, padding: '7px 9px',
        borderRadius: 8, fontSize: 11, lineHeight: 1.55,
        background: warn ? 'rgba(180,83,9,0.10)' : 'rgba(180,120,0,0.06)',
        border: `1px solid ${warn ? 'rgba(180,83,9,0.3)' : 'rgba(180,120,0,0.14)'}`,
        color: warn ? '#B45309' : LB.textMuted,
      }}
    >
      {warn ? <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> : null}
      <span>{children}</span>
    </div>
  );
}

function NumBox({ label, value, min, max, step = 0.1, onChange, onFocus }: {
  label: string; value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void; onFocus?: () => void;
}) {
  return (
    <label style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: LB.textSecondary }}>
      {label}
      <input
        type="number" value={Number(value.toFixed(2))} min={min} max={max} step={step}
        className="ve-input vs-input"
        onFocus={onFocus}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        style={numInput}
      />
    </label>
  );
}

// ===========================================================================
// Tab 1 — Overlays: b-roll compositing + chroma key
// ===========================================================================

function BrollPanel(props: {
  overlays: VideoOverlay[];
  selectedId: string | null;
  duration: number;
  playhead: number;
  uploading: boolean;
  omniPrompt: string;
  omniGenerating: boolean;
  omniProgress: number;
  omniError: string;
  omniNote: string;
  onOmniPrompt: (value: string) => void;
  onGenerateOmni: () => void;
  brollModel: string;
  onBrollModel: (id: string) => void;
  onSelect: (id: string | null) => void;
  onAddFiles: (files: File[]) => void;
  onChange: (id: string, patch: Partial<VideoOverlay>) => void;
  onDelete: (id: string) => void;
  onSeek: (t: number) => void;
  onCheckpoint: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const selected = props.overlays.find((o) => o.id === props.selectedId) || null;

  return (
    <Section title="B-roll overlays" icon={<Clapperboard size={14} color="#166534" />} defaultOpen>
      <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(22,101,52,0.07)', border: '1px solid rgba(22,101,52,0.24)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Sparkles size={13} color="#166534" />
          <span style={groupTitle}>Generate subject-matched B-roll</span>
          <select
            className="vs-input"
            aria-label="Video model"
            value={props.brollModel}
            disabled={props.omniGenerating}
            onChange={(e) => props.onBrollModel(e.target.value)}
            style={{
              marginLeft: 'auto', background: colors.bgPrimary, color: colors.beamPrimary,
              border: `1px solid ${tint(colors.beamPrimary, 40)}`, borderRadius: 7, padding: '3px 6px',
              fontSize: 10, fontWeight: 800, cursor: props.omniGenerating ? 'not-allowed' : 'pointer',
            }}
          >
            {MODEL_CHOICES.map((m) => {
              const badge = engineAvailabilityBadge(m.id);
              return <option key={m.id} value={m.id} disabled={!isEngineAvailable(m.id)} title={engineHealthWarning(m.id) || undefined}>{m.label}{badge ? ` — ${badge.label}` : ''}</option>;
            })}
          </select>
        </div>
        <textarea
          className="ve-input vs-input"
          value={props.omniPrompt}
          disabled={props.omniGenerating}
          onChange={(e) => props.onOmniPrompt(e.target.value)}
          rows={3}
          maxLength={10000}
          placeholder="Optional: describe the subject or scene. Leave blank to infer it from the transcript and current footage."
          style={{ ...numInput, marginTop: 8, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45 }}
        />
        <button
          type="button"
          className="vs-btn"
          disabled={props.omniGenerating}
          onClick={props.onGenerateOmni}
          data-testid="generate-omni-broll"
          style={{ ...primaryBtn, marginTop: 8, width: '100%', justifyContent: 'center', padding: '8px 12px' }}
        >
          {props.omniGenerating ? <Loader2 size={13} className="vs-spin" /> : <Sparkles size={13} />}
          {props.omniGenerating ? `Generating${props.omniProgress ? ` · ${Math.round(props.omniProgress)}%` : '…'}` : 'Generate B-roll'}
        </button>
        {props.omniGenerating ? (
          <VideoGeneratingState
            label="Generating subject-matched B-roll"
            progress={props.omniProgress}
            compact
            style={{ marginTop: 8 }}
          />
        ) : null}
        {props.omniNote ? <div style={{ ...hint, color: '#4ade80' }}>{props.omniNote}</div> : null}
        {props.omniError ? (
          <VideoErrorCard
            error={props.omniError}
            subject="this cutaway"
            engineId={props.brollModel}
            onRetry={props.onGenerateOmni}
            compact
            style={{ marginTop: 8 }}
          />
        ) : null}
        <div style={hint}>Uses the main footage as a visual reference when available. Each result lands at the playhead as an editable overlay, so you can generate several and keep the best.</div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('video/'));
          if (files.length) props.onAddFiles(files);
        }}
        style={{ marginTop: 8 }}
      >
        <label
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            padding: '16px 12px', textAlign: 'center', cursor: 'pointer', borderRadius: 10,
            border: dragOver ? '2px dashed #166534' : '2px dashed rgba(180,120,0,0.28)',
            background: dragOver ? 'rgba(22,101,52,0.08)' : 'rgba(180,120,0,0.04)',
          }}
        >
          {props.uploading ? <Loader2 size={18} className="vs-spin" color="#166534" /> : <UploadCloud size={18} color="#166534" />}
          <span style={{ color: LB.textPrimary, fontSize: 12.5, fontWeight: 650 }}>
            {props.uploading ? 'Uploading cutaways…' : 'Drop B-roll clips here'}
          </span>
          <span style={{ color: LB.textMuted, fontSize: 11, lineHeight: 1.5 }}>
            Several at once is fine. Each one lands at the playhead and you set where it sits in frame.
          </span>
          <input
            type="file"
            accept="video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length) props.onAddFiles(files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {props.overlays.length ? (
        <div style={{ display: 'grid', gap: 4, marginTop: 9 }}>
          {props.overlays.map((o) => {
            const active = o.id === props.selectedId;
            return (
              <div
                key={o.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  background: active ? 'rgba(22,101,52,0.14)' : 'rgba(180,120,0,0.05)',
                  border: `1px solid ${active ? 'rgba(22,101,52,0.5)' : 'rgba(180,120,0,0.14)'}`,
                  borderRadius: 7, padding: '2px 3px 2px 8px',
                }}
              >
                <button
                  type="button"
                  className="vs-btn"
                  onClick={() => { props.onSelect(active ? null : o.id); props.onSeek(o.start); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', padding: '4px 0' }}
                >
                  <Film size={12} color="#166534" style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, color: LB.textPrimary, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
                  <span style={{ color: LB.textMuted, fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                    {fmtTimecode(o.start)}–{fmtTimecode(o.end)}
                  </span>
                </button>
                <button
                  type="button"
                  className="vs-btn"
                  onClick={() => props.onDelete(o.id)}
                  title={`Delete ${o.label}`}
                  aria-label={`Delete ${o.label}`}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, flexShrink: 0, background: 'transparent', border: 'none', color: '#991B1B', borderRadius: 6, cursor: 'pointer', padding: 0 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={hint}>No cutaways yet. Drop a clip above, or generate one from the B-roll slots on the left rail.</div>
      )}

      {selected ? (
        <div style={divider}>
          <div style={groupTitle}>Where it sits in frame</div>
          <div style={rowWrap}>
            {OVERLAY_POSITIONS.map((p) => (
              <Chip
                key={p.id}
                active={selected.position === p.id}
                title={p.hint}
                onClick={() => { props.onCheckpoint(); props.onChange(selected.id, { position: p.id as VideoOverlay['position'] }); }}
              >
                {p.label}
              </Chip>
            ))}
          </div>
          {selected.position !== 'full' ? (
            <>
              <Slider label="Inset size" value={Math.round(selected.scale * 100)} min={12} max={70} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(selected.id, { scale: v / 100 })} unit="% of frame" />
              <Slider label="Corner rounding" value={selected.radius} min={0} max={60} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(selected.id, { radius: v })} unit="px" />
            </>
          ) : null}
          <Slider label="Opacity" value={Math.round(selected.opacity * 100)} min={10} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(selected.id, { opacity: v / 100 })} unit="%" />

          <div style={divider}>
            <div style={groupTitle}>When it plays</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <NumBox
                label="In (timeline s)"
                value={selected.start}
                min={0}
                max={props.duration}
                onFocus={props.onCheckpoint}
                onChange={(v) => props.onChange(selected.id, { start: Math.max(0, Math.min(selected.end - 0.2, v)) })}
              />
              <NumBox
                label="Out (timeline s)"
                value={selected.end}
                min={selected.start + 0.2}
                onFocus={props.onCheckpoint}
                onChange={(v) => props.onChange(selected.id, { end: Math.max(selected.start + 0.2, v) })}
              />
            </div>
            <div style={rowWrap}>
              <button
                type="button"
                className="vs-btn"
                style={miniBtn}
                onClick={() => {
                  props.onCheckpoint();
                  const len = selected.end - selected.start;
                  props.onChange(selected.id, { start: props.playhead, end: props.playhead + len });
                }}
              >
                Move to playhead
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <NumBox
                label="Clip in (source s)"
                value={selected.sourceIn}
                min={0}
                max={Math.max(0, selected.sourceOut - 0.2)}
                onFocus={props.onCheckpoint}
                onChange={(v) => props.onChange(selected.id, { sourceIn: Math.max(0, Math.min(selected.sourceOut - 0.2, v)) })}
              />
              <NumBox
                label="Clip out (source s)"
                value={selected.sourceOut}
                min={selected.sourceIn + 0.2}
                max={selected.sourceDuration}
                onFocus={props.onCheckpoint}
                onChange={(v) => props.onChange(selected.id, { sourceOut: Math.max(selected.sourceIn + 0.2, Math.min(selected.sourceDuration, v)) })}
              />
            </div>
            <div style={hint}>
              The cutaway loops from its in-point if the slot on the timeline is longer than the trimmed clip.
            </div>
          </div>

          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <Toggle on={!selected.muted} label="Include B-roll audio" onChange={(v) => props.onChange(selected.id, { muted: !v })} />
            <Toggle on={selected.duckMain} label="Duck main audio" onChange={(v) => props.onChange(selected.id, { duckMain: v })} />
            <Toggle on={selected.fadeOut} label="Dip video out at the end" onChange={(v) => props.onChange(selected.id, { fadeOut: v })} />
          </div>
          {!selected.muted && selected.duckMain ? (
            <Slider
              label="Main audio while B-roll plays"
              value={Math.round(selected.duckVolume * 100)}
              min={10}
              max={50}
              onBegin={props.onCheckpoint}
              onChange={(v) => props.onChange(selected.id, { duckVolume: v / 100 })}
              unit="%"
            />
          ) : null}
          <div style={hint}>B-roll audio fades in over 0.3s and out over 0.5s. Main audio ramps back over 0.5s after the cutaway.</div>

          <div style={rowWrap}>
            <button type="button" className="vs-btn" onClick={() => props.onDelete(selected.id)} style={{ ...miniBtn, color: '#991B1B' }}>
              <Trash2 size={12} /> Remove cutaway
            </button>
          </div>
          {!/^https:\/\//i.test(selected.url) ? (
            <Notice tone="warn">
              This cutaway is still local to your browser. The export needs the durable copy — give the upload a moment.
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function ChromaPanel(props: {
  chroma: ChromaKeyState;
  onChange: (patch: Partial<ChromaKeyState>) => void;
  onPickBackground: (file: File) => void;
  onCheckpoint: () => void;
}) {
  const c = props.chroma;
  return (
    <Section title="Chroma key" icon={<Wand2 size={14} color="#166534" />}>
      <div style={{ ...rowWrap, alignItems: 'center' }}>
        <Toggle on={c.enabled} label="Remove the green / blue screen" onChange={(v) => { props.onCheckpoint(); props.onChange({ enabled: v }); }} />
      </div>

      {c.enabled ? (
        <>
          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <ColorField label="Key colour" value={c.color} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ color: v })} />
            <Chip active={c.color.toLowerCase() === '#00ff00'} onClick={() => props.onChange({ color: '#00ff00' })}>Green</Chip>
            <Chip active={c.color.toLowerCase() === '#0047ff'} onClick={() => props.onChange({ color: '#0047ff' })}>Blue</Chip>
          </div>

          <Slider label="Tolerance" value={Math.round(c.tolerance * 100)} min={0} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ tolerance: v / 100 })} unit="%" />
          <Slider label="Softness" value={Math.round(c.softness * 100)} min={0} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ softness: v / 100 })} unit="%" />
          <Slider label="Spill removal" value={Math.round(c.spill * 100)} min={0} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ spill: v / 100 })} unit="%" />
          <div style={hint}>
            Raise tolerance until the screen disappears, then soften the edge. Spill removal pulls the colour
            back out of hair and shoulders where it bounced.
          </div>

          <div style={divider}>
            <div style={groupTitle}>What shows through</div>
            <div style={rowWrap}>
              <Chip active={c.background === 'color'} onClick={() => props.onChange({ background: 'color' })}>Solid colour</Chip>
              <Chip active={c.background === 'image'} onClick={() => props.onChange({ background: 'image' })}>Image</Chip>
            </div>
            {c.background === 'color' ? (
              <div style={{ ...rowWrap, alignItems: 'center' }}>
                <ColorField label="Background" value={c.backgroundColor} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ backgroundColor: v })} />
              </div>
            ) : (
              <div style={rowWrap}>
                <label className="vs-btn" style={{ ...miniBtn, cursor: 'pointer' }}>
                  <Plus size={11} /> {c.backgroundUrl ? 'Replace image' : 'Upload image'}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onPickBackground(f); e.target.value = ''; }}
                  />
                </label>
                {c.backgroundUrl ? (
                  <img src={c.backgroundUrl} alt="" style={{ width: 54, height: 32, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(180,120,0,0.14)' }} />
                ) : null}
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={hint}>
          Turn this on for footage shot against a green or blue screen. The key runs on the live preview and in
          the export from the same settings, so what you tune here is what renders.
        </div>
      )}
    </Section>
  );
}

// ===========================================================================
// Tab 2 — Motion
// ===========================================================================

function SpeedCurveGraph({ ramp }: { ramp: SpeedRamp }) {
  const w = 232;
  const h = 56;
  const pts: string[] = [];
  for (let i = 0; i <= 48; i += 1) {
    const p = i / 48;
    const rate = warpRate(ramp, p);
    pts.push(`${(p * w).toFixed(1)},${(h - ((rate - 0.2) / 2.6) * h).toFixed(1)}`);
  }
  const range = rampRange(ramp);
  return (
    <div style={{ marginTop: 9 }}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 7 }}>
        <line x1={0} y1={h - ((1 - 0.2) / 2.6) * h} x2={w} y2={h - ((1 - 0.2) / 2.6) * h} stroke="rgba(180,120,0,0.28)" strokeDasharray="3 3" strokeWidth={1} />
        <polyline points={pts.join(' ')} fill="none" stroke="#C8920A" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ ...hint, marginTop: 4 }}>
        Speed runs {range.min.toFixed(2)}× → {range.max.toFixed(2)}×. The clip keeps the same length on the
        timeline — a ramp redistributes the time inside it, so nothing downstream moves.
      </div>
    </div>
  );
}

function MotionTab(props: {
  clips: StudioClip[];
  selected: StudioClip[];
  onRamp: (patch: Partial<SpeedRamp>, all: boolean) => void;
  onZoomCut: (patch: Partial<ZoomCut>, all: boolean) => void;
  onShake: (patch: Partial<CameraShake>, all: boolean) => void;
  onCheckpoint: () => void;
}) {
  const [applyAll, setApplyAll] = useState(false);
  const target = props.selected.length ? props.selected : props.clips.slice(0, 1);
  const clip = target[0] || null;

  if (!clip) {
    return <div style={hint}>Upload footage first — motion is set per clip.</div>;
  }

  const m = clipMotion(clip);
  const scopeLabel = applyAll
    ? `every clip (${props.clips.length})`
    : props.selected.length > 1
      ? `${props.selected.length} selected clips`
      : clip.label.slice(0, 24);

  return (
    <>
      <div style={{ ...rowWrap, alignItems: 'center' }}>
        <Toggle on={applyAll} label="Apply to every clip" onChange={setApplyAll} />
      </div>
      <div style={{ ...hint, color: LB.accent }}>Editing: {scopeLabel}</div>

      <Section title="Speed ramping" icon={<Zap size={14} color={LB.accent} />} defaultOpen>
        <div style={{ ...rowWrap, alignItems: 'center' }}>
          <Toggle on={m.ramp.enabled} label="Ramp the speed through this shot" onChange={(v) => { props.onCheckpoint(); props.onRamp({ enabled: v }, applyAll); }} />
        </div>
        {m.ramp.enabled ? (
          <>
            <div style={rowWrap}>
              {SPEED_CURVES.map((c) => (
                <Chip
                  key={c.id}
                  active={m.ramp.curve === c.id}
                  title={c.hint}
                  onClick={() => { props.onCheckpoint(); props.onRamp({ curve: c.id as SpeedCurveId }, applyAll); }}
                >
                  {c.label}
                </Chip>
              ))}
            </div>
            {m.ramp.curve === 'custom' ? (
              <>
                <Slider label="Start speed" value={m.ramp.startSpeed} min={0.25} max={4} step={0.05} onBegin={props.onCheckpoint} onChange={(v) => props.onRamp({ startSpeed: v }, applyAll)} format={(v) => `${v.toFixed(2)}×`} />
                <Slider label="Middle speed" value={m.ramp.midSpeed} min={0.25} max={4} step={0.05} onBegin={props.onCheckpoint} onChange={(v) => props.onRamp({ midSpeed: v }, applyAll)} format={(v) => `${v.toFixed(2)}×`} />
                <Slider label="End speed" value={m.ramp.endSpeed} min={0.25} max={4} step={0.05} onBegin={props.onCheckpoint} onChange={(v) => props.onRamp({ endSpeed: v }, applyAll)} format={(v) => `${v.toFixed(2)}×`} />
              </>
            ) : (
              <Slider label="Curve strength" value={Math.round(m.ramp.intensity * 100)} min={0} max={85} onBegin={props.onCheckpoint} onChange={(v) => props.onRamp({ intensity: v / 100 }, applyAll)} unit="%" />
            )}
            <SpeedCurveGraph ramp={m.ramp} />
            <Notice tone="info">
              A ramped shot is rendered silently — pitching the audio with the picture would make the voice
              unusable. Keep the music bed or an unramped clip for the sound.
            </Notice>
          </>
        ) : (
          <div style={hint}>Ramps move between slow motion and fast without changing where the next cut lands.</div>
        )}
      </Section>

      <div style={{ marginTop: 10 }}>
        <Section title="Match cut & zoom" icon={<Zap size={14} color="#B45309" />}>
          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <Toggle on={m.zoomCut.enabled} label="Punch in on the cut" onChange={(v) => { props.onCheckpoint(); props.onZoomCut({ enabled: v }, applyAll); }} />
          </div>
          {m.zoomCut.enabled ? (
            <>
              <div style={rowWrap}>
                {ZOOM_INTENSITIES.map((z) => (
                  <Chip
                    key={z.id}
                    active={m.zoomCut.intensity === z.id}
                    onClick={() => { props.onCheckpoint(); props.onZoomCut({ intensity: z.id as ZoomIntensityId }, applyAll); }}
                  >
                    {z.label}
                  </Chip>
                ))}
              </div>
              <div style={rowWrap}>
                <Chip active={m.zoomCut.direction === 'in'} onClick={() => props.onZoomCut({ direction: 'in' }, applyAll)} title="Slam in and settle">Zoom in</Chip>
                <Chip active={m.zoomCut.direction === 'out'} onClick={() => props.onZoomCut({ direction: 'out' }, applyAll)} title="Pull back and settle">Zoom out</Chip>
              </div>
              <div style={hint}>
                The shot arrives scaled and blurred and settles with a slight overshoot over the first few
                frames — the spring the eye reads as a match cut.
              </div>
            </>
          ) : (
            <div style={hint}>Scales the incoming shot with motion blur across the cut point.</div>
          )}
        </Section>
      </div>

      <div style={{ marginTop: 10 }}>
        <Section title="Camera shake" icon={<Film size={14} color="#C8920A" />}>
          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <Toggle on={m.shake.enabled} label="Hand-held shake" onChange={(v) => { props.onCheckpoint(); props.onShake({ enabled: v }, applyAll); }} />
          </div>
          {m.shake.enabled ? (
            <>
              <Slider label="Intensity" value={m.shake.intensity} min={0} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onShake({ intensity: v }, applyAll)} unit="%" />
              <div style={rowWrap}>
                {SHAKE_FREQUENCIES.map((f) => (
                  <Chip
                    key={f.id}
                    active={m.shake.frequency === f.id}
                    title={`${f.hz} Hz`}
                    onClick={() => { props.onCheckpoint(); props.onShake({ frequency: f.id }, applyAll); }}
                  >
                    {f.label}
                  </Chip>
                ))}
              </div>
              <div style={rowWrap}>
                <button
                  type="button"
                  className="vs-btn"
                  style={miniBtn}
                  onClick={() => { props.onCheckpoint(); props.onShake({ seed: Math.floor(Math.random() * 9000) + 1 }, applyAll); }}
                >
                  <Sparkles size={11} /> New shake pattern
                </button>
              </div>
              <div style={hint}>
                The shake is seeded noise, not live randomness — the export reproduces the exact movement you
                are watching. Reroll the seed for a different take on it.
              </div>
            </>
          ) : (
            <div style={hint}>Adds a seeded translate and rotate per frame, with a slight scale-up so the edges never show.</div>
          )}
        </Section>
      </div>
    </>
  );
}

// ===========================================================================
// Tab 3 — VFX
// ===========================================================================

function VfxTab(props: {
  vfx: VfxState;
  textLayerCount: number;
  onChange: (patch: Partial<VfxState>) => void;
  onCheckpoint: () => void;
}) {
  const v = props.vfx;
  const patchLeak = (p: Partial<LeakState>) => props.onChange({ leak: { ...v.leak, ...p } });
  const patchGlow = (p: Partial<GlowState>) => props.onChange({ textGlow: { ...v.textGlow, ...p } });

  return (
    <>
      <Section title="Light leaks & flares" icon={<Sparkles size={14} color="#C8920A" />} defaultOpen>
        <div style={{ ...rowWrap, alignItems: 'center' }}>
          <Toggle on={v.leak.enabled} label="Add a light leak" onChange={(x) => { props.onCheckpoint(); patchLeak({ enabled: x }); }} />
        </div>
        {v.leak.enabled ? (
          <>
            <div style={rowWrap}>
              {LIGHT_LEAKS.map((l) => (
                <Chip key={l.id} active={v.leak.presetId === l.id} title={l.hint} onClick={() => patchLeak({ presetId: l.id as LeakPresetId })}>
                  {l.label}
                </Chip>
              ))}
            </div>
            <div style={{ ...groupTitle, marginTop: 12 }}>When it fires</div>
            <div style={rowWrap}>
              {(['start', 'mid', 'end', 'loop'] as LeakState['trigger'][]).map((t) => (
                <Chip key={t} active={v.leak.trigger === t} onClick={() => patchLeak({ trigger: t })}>
                  {t === 'start' ? 'Scene start' : t === 'mid' ? 'Middle' : t === 'end' ? 'Scene end' : 'Repeating'}
                </Chip>
              ))}
            </div>
            <div style={rowWrap}>
              <Chip active={v.leak.blend === 'screen'} onClick={() => patchLeak({ blend: 'screen' })} title="Softer — keeps the highlights">Screen</Chip>
              <Chip active={v.leak.blend === 'add'} onClick={() => patchLeak({ blend: 'add' })} title="Hotter — blows the highlights out">Add</Chip>
            </div>
            <Slider label="Intensity" value={v.leak.intensity} min={0} max={100} onBegin={props.onCheckpoint} onChange={(x) => patchLeak({ intensity: x })} unit="%" />
            <div style={hint}>
              The leaks are gradient plates rather than bundled PNGs, so they stay sharp at any output size and
              render into the MP4 from the same description the preview is drawing.
            </div>
          </>
        ) : null}
      </Section>

      <div style={{ marginTop: 10 }}>
        <Section title="VHS & glitch" icon={<Zap size={14} color="#B4720A" />}>
          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <Toggle on={v.vhs.enabled} label="VHS tape" onChange={(x) => { props.onCheckpoint(); props.onChange({ vhs: { ...v.vhs, enabled: x } }); }} />
          </div>
          {v.vhs.enabled ? (
            <>
              <Slider label="VHS intensity" value={v.vhs.intensity} min={0} max={100} onBegin={props.onCheckpoint} onChange={(x) => props.onChange({ vhs: { ...v.vhs, intensity: x } })} unit="%" />
              <div style={hint}>Scanlines, an edge colour shift and the vertical tracking wobble of a worn tape.</div>
            </>
          ) : null}

          <div style={{ ...rowWrap, alignItems: 'center', marginTop: 12 }}>
            <Toggle on={v.glitch.enabled} label="Digital glitch" onChange={(x) => { props.onCheckpoint(); props.onChange({ glitch: { ...v.glitch, enabled: x } }); }} />
          </div>
          {v.glitch.enabled ? (
            <>
              <Slider label="Glitch intensity" value={v.glitch.intensity} min={0} max={100} onBegin={props.onCheckpoint} onChange={(x) => props.onChange({ glitch: { ...v.glitch, intensity: x } })} unit="%" />
              <div style={hint}>
                Fires in short bursts rather than running constantly. Each burst tears the frame into
                horizontal slices that slide independently, with a red/cyan split on the hardest hits.
              </div>
            </>
          ) : null}
        </Section>
      </div>

      <div style={{ marginTop: 10 }}>
        <Section title="Deep glow & rays" icon={<TypeIcon size={14} color="#C8920A" />}>
          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <Toggle on={v.textGlow.enabled} label="Glow every text layer" onChange={(x) => { props.onCheckpoint(); patchGlow({ enabled: x }); }} />
          </div>
          {v.textGlow.enabled ? (
            <>
              <Slider label="Glow strength" value={v.textGlow.intensity} min={0} max={100} onBegin={props.onCheckpoint} onChange={(x) => patchGlow({ intensity: x })} unit="%" />
              <div style={{ ...rowWrap, alignItems: 'center' }}>
                <ColorField label="Glow colour" value={v.textGlow.color} onBegin={props.onCheckpoint} onChange={(x) => patchGlow({ color: x })} />
                <Toggle on={v.textGlow.rays} label="Pulsing rays" onChange={(x) => patchGlow({ rays: x })} />
              </div>
              <div style={hint}>
                {props.textLayerCount
                  ? `Applied to ${props.textLayerCount} text layer${props.textLayerCount === 1 ? '' : 's'}. A layer with its own glow set in the Text panel keeps that instead.`
                  : 'No text layers yet — add one from the Text panel and it picks this up automatically.'}
              </div>
            </>
          ) : (
            <div style={hint}>A three-stage halo behind the type, plus optional rays that pulse with the frame.</div>
          )}
        </Section>
      </div>

      <div style={{ marginTop: 10 }}>
        <Section title="Turbulent displace" icon={<Layers size={14} color="#1D4ED8" />}>
          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <Toggle on={v.displace.enabled} label="Distort the picture" onChange={(x) => { props.onCheckpoint(); props.onChange({ displace: { ...v.displace, enabled: x } }); }} />
          </div>
          {v.displace.enabled ? (
            <>
              <div style={rowWrap}>
                {DISPLACE_PRESETS.map((p) => (
                  <Chip
                    key={p.id}
                    active={v.displace.presetId === p.id}
                    title={p.hint}
                    onClick={() => props.onChange({ displace: { ...v.displace, presetId: p.id as DisplacePresetId } })}
                  >
                    {p.label}
                  </Chip>
                ))}
              </div>
              <Slider label="Intensity" value={v.displace.intensity} min={0} max={100} onBegin={props.onCheckpoint} onChange={(x) => props.onChange({ displace: { ...v.displace, intensity: x } })} unit="%" />
              <div style={hint}>
                A Perlin noise field is generated once and slid across the frame, so the distortion flows
                instead of boiling. High intensity on a long video makes the render noticeably slower.
              </div>
            </>
          ) : (
            <div style={hint}>Heat haze, water caustics or a heavy liquid roll, driven by a real noise field.</div>
          )}
        </Section>
      </div>
    </>
  );
}

// ===========================================================================
// Tab 4 — Captions
// ===========================================================================

const CAPTION_MIX_PRESETS: { name: string; swatch: string; patch: Partial<CaptionSettings> }[] = [
  { name: 'Bold TikTok', swatch: '#FFE500', patch: { styleId: 'tiktok', fontId: 'montserrat', sizeScale: 0.62, color: '#FFE500', activeColor: '#FFE500', background: 'none', position: 'bottom', offsetY: 0.07, animation: 'pop', uppercase: true, italic: false, outlineWidth: 0, shadowBlur: 20 } },
  { name: 'Minimal', swatch: '#FFFFFF', patch: { styleId: 'minimal', fontId: 'inter', sizeScale: 0.7, color: '#FFFFFF', activeColor: '#FFFFFF', background: 'none', position: 'bottom', offsetY: 0.12, animation: 'fade', uppercase: false, italic: false, outlineWidth: 0, shadowBlur: 10 } },
  { name: 'Karaoke', swatch: '#22D3EE', patch: { styleId: 'karaoke', fontId: 'roboto', sizeScale: 0.74, color: '#FFFFFF', activeColor: '#22D3EE', background: 'pill', backgroundColor: '#000000', backgroundOpacity: 0.65, position: 'bottom', offsetY: 0.1, animation: 'karaoke', uppercase: false, italic: false, outlineWidth: 0, shadowBlur: 14 } },
  { name: 'Cinematic', swatch: '#CBD5E1', patch: { styleId: 'cinematic', fontId: 'playfair', sizeScale: 0.93, color: '#FFFFFF', activeColor: '#FFFFFF', background: 'bar', backgroundColor: '#000000', backgroundOpacity: 0.86, position: 'bottom', offsetY: 0.14, animation: 'dissolve', uppercase: false, italic: true, outlineWidth: 0, shadowBlur: 8 } },
  { name: 'Street Bold', swatch: '#F8FAFC', patch: { styleId: 'tiktok', fontId: 'impact', sizeScale: 0.67, color: '#FFFFFF', activeColor: '#FFFFFF', background: 'none', position: 'bottom', offsetY: 0, animation: 'bounce', uppercase: true, italic: false, outlineColor: '#000000', outlineWidth: 3, shadowBlur: 16 } },
  { name: 'Creator Punch', swatch: '#FFD66E', patch: { styleId: 'creator', fontId: 'montserrat', sizeScale: 0.78, color: '#FFFFFF', activeColor: '#FFD66E', background: 'preset', position: 'bottom', offsetY: 0.04, animation: 'preset', uppercase: true, italic: false, outlineColor: '#06090E', outlineWidth: 2, shadowBlur: 22 } },
  { name: 'Newsroom', swatch: '#FB7185', patch: { styleId: 'newsroom', fontId: 'inter', sizeScale: 0.9, color: '#F8FAFC', activeColor: '#FB7185', background: 'preset', position: 'bottom', offsetY: 0.13, animation: 'karaoke', uppercase: false, italic: false, outlineWidth: 0, shadowBlur: 12 } },
  { name: 'Desi Bold', swatch: '#FFB21A', patch: { styleId: 'desi', fontId: 'notoDevanagari', sizeScale: 0.84, color: '#FFFFFF', activeColor: '#FFB21A', background: 'preset', position: 'bottom', offsetY: 0.08, animation: 'karaoke', uppercase: false, italic: false, outlineColor: '#241503', outlineWidth: 1, shadowBlur: 18 } },
];

function captionMixActive(settings: CaptionSettings, patch: Partial<CaptionSettings>): boolean {
  return Object.entries(patch).every(([key, value]) => settings[key as keyof CaptionSettings] === value);
}

function CaptionsTab(props: {
  cues: CaptionCue[];
  settings: CaptionSettings;
  language: string;
  hasWords: boolean;
  hasFootage: boolean;
  busy: boolean;
  note: string;
  playhead: number;
  onGenerate: () => void;
  onRebuild: () => void;
  onSettings: (patch: Partial<CaptionSettings>) => void;
  onEditCue: (id: string, text: string) => void;
  onRetimeCue: (id: string, start: number, end: number) => void;
  onDeleteCue: (id: string) => void;
  onSplitCue: (id: string) => void;
  onMergeUp: (id: string) => void;
  onSeek: (t: number) => void;
  onDownloadSrt: () => void;
  onCheckpoint: () => void;
}) {
  const s = props.settings;
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  return (
    <>
      <Section title="Generate" icon={<Wand2 size={14} color="#C8920A" />} defaultOpen>
        <div style={rowWrap}>
          <button type="button" className="vs-btn" disabled={!props.hasFootage || props.busy} onClick={props.onGenerate} style={primaryBtn}>
            {props.busy ? <Loader2 size={12} className="vs-spin" /> : <Sparkles size={12} />}
            {props.cues.length ? 'Regenerate captions' : 'Add captions'}
          </button>
          {props.hasWords ? (
            <button type="button" className="vs-btn" onClick={props.onRebuild} style={miniBtn}>
              Rebuild from transcript
            </button>
          ) : null}
        </div>
        <Slider
          label="Words per line"
          value={s.maxWords}
          min={2}
          max={12}
          onBegin={props.onCheckpoint}
          onChange={(v) => props.onSettings({ maxWords: v })}
        />
        <div style={hint}>
          Lines still break on a pause or a comma first; the limit only applies when the speaker never gives
          one. Change it and press Rebuild to re-cut the track.
        </div>
        <div style={{ ...hint, color: props.language && props.language !== 'auto' ? '#166534' : LB.textMuted }}>
          Language: {languageLabel(props.language)}
          {props.cues.length ? ` · ${props.cues.length} line${props.cues.length === 1 ? '' : 's'}` : ''}
        </div>
        {props.note ? <div style={hint}>{props.note}</div> : null}
      </Section>

      <div style={{ marginTop: 10 }}>
        <Section title="Design" icon={<TypeIcon size={14} color="#C8920A" />} defaultOpen>
          <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 700, marginTop: 6 }}>One-tap style bundles</div>
          <div style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '8px 1px 9px', scrollbarWidth: 'thin' }}>
            {CAPTION_MIX_PRESETS.map((preset) => {
              const active = captionMixActive(s, preset.patch);
              return (
                <button
                  key={preset.name}
                  type="button"
                  className="vs-btn"
                  onClick={() => { props.onCheckpoint(); props.onSettings(preset.patch); }}
                  style={{
                    flex: '0 0 128px', textAlign: 'left', padding: 9, borderRadius: 10, cursor: 'pointer',
                    background: active ? 'rgba(200,146,10,0.18)' : 'rgba(180,120,0,0.05)',
                    border: `2px solid ${active ? '#C8920A' : 'rgba(180,120,0,0.14)'}`,
                  }}
                >
                  <span style={{ display: 'block', height: 32, borderRadius: 7, background: '#09090b', color: preset.swatch, fontSize: 17, fontWeight: 900, padding: '6px 8px', boxSizing: 'border-box', overflow: 'hidden' }}>Aa</span>
                  <span style={{ display: 'block', color: active ? '#B4720A' : LB.textSecondary, fontSize: 11, fontWeight: 750, marginTop: 6 }}>{preset.name}</span>
                </button>
              );
            })}
          </div>
          <div style={{ ...hint, marginTop: 0 }}>A bundle sets font, size, color, background, position and animation together. Every control below stays editable.</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
            {CAPTION_STYLES.map((style) => {
              const active = s.styleId === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  className="vs-btn"
                  onClick={() => { props.onCheckpoint(); props.onSettings({ styleId: style.id as CaptionStyleId, fontId: style.fontId, uppercase: style.uppercase }); }}
                  title={style.hint}
                  style={{
                    textAlign: 'left', cursor: 'pointer', borderRadius: 9, padding: '7px 9px',
                    border: `1px solid ${active ? 'rgba(200,146,10,0.6)' : 'rgba(180,120,0,0.14)'}`,
                    background: active ? 'rgba(200,146,10,0.14)' : 'rgba(180,120,0,0.05)',
                  }}
                >
                  <div
                    style={{
                      fontFamily: fontCss(style.fontId), fontWeight: style.weight,
                      fontSize: 13, color: style.mode === 'karaoke' || style.mode === 'word' ? style.activeColor : style.color,
                      textTransform: style.uppercase ? 'uppercase' : 'none',
                      textShadow: style.shadow === 'none' ? undefined : style.shadow,
                      background: style.background, borderRadius: 4,
                      padding: style.background === 'transparent' ? 0 : '1px 5px',
                      display: 'inline-block', maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap',
                    }}
                  >
                    Aa
                  </div>
                  <div style={{ color: active ? LB.accent : LB.textSecondary, fontSize: 11, fontWeight: 700, marginTop: 3 }}>{style.label}</div>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <SelectField label="Font" value={s.fontId} options={CAPTION_FONTS.map((f) => ({ id: f.id, label: f.label }))} onChange={(v) => props.onSettings({ fontId: v })} />
            <SelectField label="Animation" value={s.animation} options={CAPTION_ANIMATIONS.map((a) => ({ id: a.id, label: a.label }))} onChange={(v) => props.onSettings({ animation: v as CaptionAnimationId })} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <SelectField label="Background" value={s.background} options={CAPTION_BACKGROUNDS.map((b) => ({ id: b.id, label: b.label }))} onChange={(v) => props.onSettings({ background: v as CaptionBackgroundId })} />
            <SelectField label="Position" value={s.position} options={[{ id: 'top', label: 'Top' }, { id: 'center', label: 'Middle' }, { id: 'bottom', label: 'Bottom' }]} onChange={(v) => props.onSettings({ position: v as CaptionSettings['position'] })} />
          </div>

          {s.background === 'pill' || s.background === 'bar' ? (
            <div style={{ ...rowWrap, alignItems: 'center' }}>
              <ColorField label="Plate" value={s.backgroundColor} onBegin={props.onCheckpoint} onChange={(v) => props.onSettings({ backgroundColor: v })} />
              <div style={{ flex: 1, minWidth: 130 }}>
                <Slider label="Plate opacity" value={Math.round(s.backgroundOpacity * 100)} min={10} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onSettings({ backgroundOpacity: v / 100 })} unit="%" />
              </div>
            </div>
          ) : null}

          <Slider label="Size" value={Math.round(s.sizeScale * 100)} min={60} max={180} onBegin={props.onCheckpoint} onChange={(v) => props.onSettings({ sizeScale: v / 100 })} unit="%" />
          <Slider label="Vertical position" value={Math.round(s.offsetY * 100)} min={-30} max={30} onBegin={props.onCheckpoint} onChange={(v) => props.onSettings({ offsetY: v / 100 })} unit="%" />
          <Slider label="Outline" value={s.outlineWidth} min={0} max={8} onBegin={props.onCheckpoint} onChange={(v) => props.onSettings({ outlineWidth: v })} unit="px" />
          <Slider label="Shadow" value={s.shadowBlur} min={0} max={40} onBegin={props.onCheckpoint} onChange={(v) => props.onSettings({ shadowBlur: v })} unit="px" />

          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <ColorField label="Text" value={s.color} onBegin={props.onCheckpoint} onChange={(v) => props.onSettings({ color: v })} />
            <ColorField label="Outline" value={s.outlineColor} onBegin={props.onCheckpoint} onChange={(v) => props.onSettings({ outlineColor: v })} />
            <Toggle on={s.uppercase} label="Uppercase" onChange={(v) => props.onSettings({ uppercase: v })} />
          </div>

          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <Toggle on={s.burnIn} label="Burn into the video" onChange={(v) => props.onSettings({ burnIn: v })} />
            <button type="button" className="vs-btn" disabled={!props.cues.length} onClick={props.onDownloadSrt} style={miniBtn}>
              <Download size={12} /> Download .srt
            </button>
          </div>
          <div style={hint}>
            {s.burnIn
              ? 'Captions are rendered into the exported MP4, and the .srt comes down alongside it.'
              : 'The MP4 exports clean — captions come out only as the .srt file.'}
          </div>
        </Section>
      </div>

      <div style={{ marginTop: 10 }}>
        <Section title={`Lines (${props.cues.length})`} icon={<Scissors size={14} color="#C8920A" />} defaultOpen>
          {props.cues.length ? (
            <div ref={listRef} style={{ display: 'grid', gap: 5, marginTop: 8, maxHeight: 340, overflowY: 'auto' }} className="vs-rail">
              {props.cues.map((cue, i) => {
                const live = props.playhead >= cue.start && props.playhead <= cue.end;
                const open = editing === cue.id;
                return (
                  <div
                    key={cue.id}
                    style={{
                      borderRadius: 8, padding: '6px 8px',
                      background: live ? 'rgba(200,146,10,0.16)' : 'rgba(180,120,0,0.05)',
                      border: `1px solid ${live ? 'rgba(200,146,10,0.45)' : 'rgba(180,120,0,0.14)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="vs-btn"
                        onClick={() => props.onSeek(cue.start + 0.02)}
                        title="Jump the playhead here"
                        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: LB.textMuted, fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                      >
                        {fmtTimecode(cue.start)}
                      </button>
                      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
                        {open ? (
                          <button type="button" className="vs-btn" title="Finish editing this line" onClick={() => setEditing(null)} style={{ ...primaryBtn, padding: '3px 8px' }}>
                            Done
                          </button>
                        ) : null}
                        <button type="button" className="vs-btn" title="Split this line in two" disabled={cue.words.length < 2} onClick={() => props.onSplitCue(cue.id)} style={{ ...miniBtn, padding: '3px 6px' }}>
                          <Scissors size={10} />
                        </button>
                        <button type="button" className="vs-btn" title="Join onto the line above" disabled={i === 0} onClick={() => props.onMergeUp(cue.id)} style={{ ...miniBtn, padding: '3px 6px' }}>
                          <Plus size={10} />
                        </button>
                        <button type="button" className="vs-btn" title="Delete this line" onClick={() => props.onDeleteCue(cue.id)} style={{ ...miniBtn, padding: '3px 6px', color: '#991B1B' }}>
                          <Trash2 size={10} />
                        </button>
                      </span>
                    </div>

                    {open ? (
                      <>
                        <textarea
                          autoFocus
                          className="ve-input vs-input"
                          value={cue.text}
                          rows={2}
                          onFocus={props.onCheckpoint}
                          onChange={(e) => props.onEditCue(cue.id, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); setEditing(null); } }}
                          style={{ ...numInput, marginTop: 5, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45 }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <NumBox label="In (s)" value={cue.start} min={0} onFocus={props.onCheckpoint} onChange={(v) => props.onRetimeCue(cue.id, v, cue.end)} />
                          <NumBox label="Out (s)" value={cue.end} min={cue.start + 0.2} onFocus={props.onCheckpoint} onChange={(v) => props.onRetimeCue(cue.id, cue.start, v)} />
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="vs-btn"
                        onClick={() => setEditing(cue.id)}
                        title="Click to edit this line"
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                          border: 'none', padding: '3px 0 0', cursor: 'text',
                          color: LB.textPrimary, fontSize: 12, lineHeight: 1.5, fontFamily: 'inherit',
                        }}
                      >
                        {cue.text || <span style={{ color: LB.textMuted }}>(empty line)</span>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={hint}>
              No caption lines yet. Press Add captions above — the transcript is read with word-level timing,
              so every line lands on the exact frame it is spoken.
            </div>
          )}
          {props.cues.length ? (
            <div style={hint}>Click any line to rewrite it. Words you leave alone keep their measured timing, so karaoke highlighting does not drift.</div>
          ) : null}
        </Section>
      </div>
    </>
  );
}

// ===========================================================================
// The sidebar
// ===========================================================================

export type EffectsTabId = 'overlays' | 'motion' | 'vfx' | 'captions' | 'music' | 'export';

const TABS: { id: EffectsTabId; label: string }[] = [
  { id: 'overlays', label: 'Overlays' },
  { id: 'motion', label: 'Motion' },
  { id: 'vfx', label: 'VFX' },
  { id: 'captions', label: 'Captions' },
  { id: 'music', label: 'Music' },
  { id: 'export', label: 'Export' },
];

export interface EffectsSidebarProps {
  tab: EffectsTabId;
  onTab: (t: EffectsTabId) => void;
  playhead: number;
  duration: number;
  onSeek: (t: number) => void;
  onCheckpoint: () => void;
  /** Shown at the top when the current stack will make the render slow. */
  renderWarning: string;

  videoOverlays: VideoOverlay[];
  selectedBrollId: string | null;
  uploadingBroll: boolean;
  onSelectBroll: (id: string | null) => void;
  onAddBrollFiles: (files: File[]) => void;
  onChangeBroll: (id: string, patch: Partial<VideoOverlay>) => void;
  onDeleteBroll: (id: string) => void;
  omniPrompt: string;
  omniGenerating: boolean;
  omniProgress: number;
  omniError: string;
  omniNote: string;
  onOmniPrompt: (value: string) => void;
  onGenerateOmni: () => void;
  brollModel: string;
  onBrollModel: (id: string) => void;

  chroma: ChromaKeyState;
  onChroma: (patch: Partial<ChromaKeyState>) => void;
  onChromaBackgroundFile: (file: File) => void;

  clips: StudioClip[];
  selectedClips: StudioClip[];
  onRamp: (patch: Partial<SpeedRamp>, all: boolean) => void;
  onZoomCut: (patch: Partial<ZoomCut>, all: boolean) => void;
  onShake: (patch: Partial<CameraShake>, all: boolean) => void;

  vfx: VfxState;
  textLayerCount: number;
  onVfx: (patch: Partial<VfxState>) => void;

  captions: CaptionCue[];
  captionSettings: CaptionSettings;
  captionLanguage: string;
  captionNote: string;
  captionsBusy: boolean;
  hasWords: boolean;
  hasFootage: boolean;
  onGenerateCaptions: () => void;
  onRebuildCaptions: () => void;
  onCaptionSettings: (patch: Partial<CaptionSettings>) => void;
  onEditCue: (id: string, text: string) => void;
  onRetimeCue: (id: string, start: number, end: number) => void;
  onDeleteCue: (id: string) => void;
  onSplitCue: (id: string) => void;
  onMergeCueUp: (id: string) => void;
  onDownloadSrt: () => void;
  musicPanel: ReactNode;
  exportPanel: ReactNode;
}

export default function EffectsSidebar(props: EffectsSidebarProps) {
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 12, padding: 10 }}>
      <div
        role="tablist"
        aria-label="Effects and overlays"
        className="ve-scroll-x"
        style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 10, background: 'rgba(180,120,0,0.06)' }}
      >
        {TABS.map((t) => {
          const active = props.tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => props.onTab(t.id)}
              className="vs-btn ve-tap"
              data-testid={`ve-fx-tab-${t.id}`}
              style={{
                flex: '1 0 auto', whiteSpace: 'nowrap', padding: '0 14px', minHeight: 44,
                borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700,
                background: active ? '#C8920A' : 'transparent',
                color: active ? '#FFFFFF' : LB.textSecondary,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {props.renderWarning ? <Notice tone="warn">{props.renderWarning}</Notice> : null}

      <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
        {props.tab === 'overlays' ? (
          <>
            <BrollPanel
              overlays={props.videoOverlays}
              selectedId={props.selectedBrollId}
              duration={props.duration}
              playhead={props.playhead}
              uploading={props.uploadingBroll}
              omniPrompt={props.omniPrompt}
              omniGenerating={props.omniGenerating}
              omniProgress={props.omniProgress}
              omniError={props.omniError}
              omniNote={props.omniNote}
              onOmniPrompt={props.onOmniPrompt}
              onGenerateOmni={props.onGenerateOmni}
              brollModel={props.brollModel}
              onBrollModel={props.onBrollModel}
              onSelect={props.onSelectBroll}
              onAddFiles={props.onAddBrollFiles}
              onChange={props.onChangeBroll}
              onDelete={props.onDeleteBroll}
              onSeek={props.onSeek}
              onCheckpoint={props.onCheckpoint}
            />
            <ChromaPanel
              chroma={props.chroma}
              onChange={props.onChroma}
              onPickBackground={props.onChromaBackgroundFile}
              onCheckpoint={props.onCheckpoint}
            />
          </>
        ) : null}

        {props.tab === 'motion' ? (
          <MotionTab
            clips={props.clips}
            selected={props.selectedClips}
            onRamp={props.onRamp}
            onZoomCut={props.onZoomCut}
            onShake={props.onShake}
            onCheckpoint={props.onCheckpoint}
          />
        ) : null}

        {props.tab === 'vfx' ? (
          <VfxTab
            vfx={props.vfx}
            textLayerCount={props.textLayerCount}
            onChange={props.onVfx}
            onCheckpoint={props.onCheckpoint}
          />
        ) : null}

        {props.tab === 'captions' ? (
          <CaptionsTab
            cues={props.captions}
            settings={props.captionSettings}
            language={props.captionLanguage}
            hasWords={props.hasWords}
            hasFootage={props.hasFootage}
            busy={props.captionsBusy}
            note={props.captionNote}
            playhead={props.playhead}
            onGenerate={props.onGenerateCaptions}
            onRebuild={props.onRebuildCaptions}
            onSettings={props.onCaptionSettings}
            onEditCue={props.onEditCue}
            onRetimeCue={props.onRetimeCue}
            onDeleteCue={props.onDeleteCue}
            onSplitCue={props.onSplitCue}
            onMergeUp={props.onMergeCueUp}
            onSeek={props.onSeek}
            onDownloadSrt={props.onDownloadSrt}
            onCheckpoint={props.onCheckpoint}
          />
        ) : null}

        {props.tab === 'music' ? props.musicPanel : null}
        {props.tab === 'export' ? props.exportPanel : null}
      </div>
    </div>
  );
}
