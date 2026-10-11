/**
 * Video Studio — the inspector rail.
 *
 * Every editing control that is not the timeline or the cut plan: auto-reframe
 * with its side-by-side proof, the per-clip panel (crop, adjust, speed, trim,
 * effects, transition, batch edits), the caption designer with its eight
 * presets, animated text layers, the overlay system (mask, blend, tracking)
 * and the export sheet.
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Crop, Download, Eye, Image as ImageIcon, Layers, Loader2, Lock, Plus,
  Scissors, Sparkles, Trash2, Type as TypeIcon, Unlock, Wand2,
} from 'lucide-react';
import { Chip, ColorField, Section, SelectField, Slider, Toggle } from './uiControls';
import {
  ASPECTS, AspectId, Adjust, BLEND_MODES, CAPTION_FONTS, CaptionSettings,
  CaptionStyleId, CropRect, ENTRANCE_ANIMS, EXIT_ANIMS, EntranceAnim,
  ExitAnim, GRADES, GradeId, LB, MaskShape, Overlay, ResolutionId,
  RESOLUTIONS, ReframeState, StudioClip, TRANSITIONS, TextLayer,
  VISUAL_EFFECTS, VisualEffectId, aspectRatio, clamp01, fmtTimecode,
  focusAt, focusObjectPosition, fontCss, outputDims,
} from './studioModel';
import { CAPTION_STYLES } from './studioStyles';
import { ExportProgress, ExportReady, vePrimary } from './studioGuide';

const rowWrap: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 };
const hint: CSSProperties = { color: LB.textMuted, fontSize: 11, lineHeight: 1.55, marginTop: 6 };
const miniBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(180,120,0,0.06)',
  border: '1px solid rgba(180,120,0,0.14)', color: LB.textSecondary, borderRadius: 7,
  padding: '5px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
};
const primaryBtn: CSSProperties = {
  ...miniBtn, background: LB.accentGradient, color: '#241503', border: 'none', fontWeight: 800,
};

// ---------------------------------------------------------------------------
// Auto-reframe
// ---------------------------------------------------------------------------

export function ReframeInspector(props: {
  aspect: AspectId;
  exportAspects: AspectId[];
  reframe: ReframeState;
  sourceT: number;
  thumbUrl: string;
  detecting: boolean;
  onAspect: (a: AspectId) => void;
  onToggleExportAspect: (a: AspectId) => void;
  onMode: (m: ReframeState['mode']) => void;
  onManual: (x: number, y: number) => void;
  onDetect: () => void;
  onFocusPanel: (open: boolean) => void;
}) {
  const focus = focusAt(props.reframe, props.sourceT);
  const confidence = props.reframe.focus.length
    ? props.reframe.focus.reduce((n, f) => n + f.confidence, 0) / props.reframe.focus.length
    : 0;

  return (
    <Section title="Reframe" icon={<Crop size={14} color={LB.accent} />} defaultOpen>
      <div style={rowWrap}>
        {ASPECTS.map((a) => (
          <Chip key={a.id} active={props.aspect === a.id} onClick={() => props.onAspect(a.id)} title={a.blurb}>
            {a.label}
          </Chip>
        ))}
      </div>

      {/* Side-by-side proof: the source frame, and the same frame as the
          selected format will crop it with the detected subject centred. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, alignItems: 'end' }}>
        <div>
          <div style={{ color: LB.textMuted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>ORIGINAL</div>
          <div style={{ width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(180,120,0,0.14)' }}>
            {props.thumbUrl ? <img src={props.thumbUrl} alt="Original framing" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
          </div>
        </div>
        <div>
          <div style={{ color: LB.accent, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>{props.aspect} OUTPUT</div>
          <div style={{ width: '100%', aspectRatio: `${aspectRatio(props.aspect)}`, maxHeight: 128, margin: '0 auto', background: '#000', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(180,120,0,0.36)', position: 'relative' }}>
            {props.thumbUrl ? (
              <img
                src={props.thumbUrl}
                alt="Reframed output"
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: focusObjectPosition(focus) }}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div style={rowWrap}>
        <button type="button" className="vs-btn" disabled={props.detecting} onClick={props.onDetect} style={primaryBtn}>
          {props.detecting ? <Loader2 size={12} className="vs-spin" /> : <Wand2 size={12} />}
          {props.reframe.focus.length ? 'Re-detect subject' : 'Detect subject'}
        </button>
        <button type="button" className="vs-btn" onMouseEnter={() => props.onFocusPanel(true)} onMouseLeave={() => props.onFocusPanel(false)} style={miniBtn}>
          <Eye size={12} /> Show focus
        </button>
      </div>

      {props.reframe.note ? <div style={hint}>{props.reframe.note}</div> : null}
      {props.reframe.focus.length ? (
        <div style={{ ...hint, color: confidence > 0.4 ? '#166534' : '#B45309' }}>
          {props.reframe.detector === 'face' ? 'Face tracking' : 'Saliency tracking'} · {props.reframe.focus.length} keyframes · confidence {(confidence * 100).toFixed(0)}%
        </div>
      ) : null}

      <div style={rowWrap}>
        {(['auto', 'center', 'manual'] as ReframeState['mode'][]).map((m) => (
          <Chip key={m} active={props.reframe.mode === m} onClick={() => props.onMode(m)} title={m === 'auto' ? 'Follow the detected subject' : m === 'center' ? 'Always centre-crop' : 'Lock the frame where you put it'}>
            {m === 'auto' ? 'Follow subject' : m === 'center' ? 'Centre' : 'Manual'}
          </Chip>
        ))}
      </div>

      {props.reframe.mode === 'manual' ? (
        <>
          <Slider label="Focus X" value={Math.round(props.reframe.manualX * 100)} min={0} max={100} onChange={(v) => props.onManual(v / 100, props.reframe.manualY)} unit="%" />
          <Slider label="Focus Y" value={Math.round(props.reframe.manualY * 100)} min={0} max={100} onChange={(v) => props.onManual(props.reframe.manualX, v / 100)} unit="%" />
        </>
      ) : null}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
        <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650 }}>Export these formats</div>
        <div style={rowWrap}>
          {ASPECTS.map((a) => (
            <Chip key={`ex-${a.id}`} active={props.exportAspects.includes(a.id)} onClick={() => props.onToggleExportAspect(a.id)} title={`Render a ${a.label} master too`}>
              {a.label}
            </Chip>
          ))}
        </div>
        <div style={hint}>Every selected format renders from the same edit in one go, each with its own reframe.</div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Clip inspector
// ---------------------------------------------------------------------------

const CROP_PRESETS: { id: AspectId | 'free'; label: string }[] = [
  { id: 'free', label: 'Freeform' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
];

/** A crop rect that matches `target` and stays inside the frame. */
export function cropForAspect(target: AspectId | 'free', current: CropRect, sourceAspect: number): CropRect {
  if (target === 'free') return current;
  const want = aspectRatio(target);
  // Normalised crop space is already squashed by the source aspect, so the
  // rect's w/h must compensate for it to read as the asked-for ratio.
  let w = 1;
  let h = sourceAspect / want;
  if (h > 1) { h = 1; w = want / sourceAspect; }
  const cx = clamp01(current.x + current.w / 2);
  const cy = clamp01(current.y + current.h / 2);
  return {
    w: Math.min(1, w),
    h: Math.min(1, h),
    x: clamp01(Math.min(1 - Math.min(1, w), Math.max(0, cx - w / 2))),
    y: clamp01(Math.min(1 - Math.min(1, h), Math.max(0, cy - h / 2))),
  };
}

export function ClipInspector(props: {
  clips: StudioClip[];
  selected: StudioClip[];
  playhead: number;
  canSplit: boolean;
  sourceAspect: number;
  onAdjust: (patch: Partial<Adjust>) => void;
  onTrim: (id: string, nextIn: number, nextOut: number) => void;
  onOpacity: (v: number) => void;
  onCrop: (patch: Partial<CropRect>) => void;
  onCropPreset: (id: AspectId | 'free') => void;
  onCropLock: (locked: boolean) => void;
  onToggleEffect: (id: VisualEffectId) => void;
  onSplit: () => void;
  onDelete: () => void;
  onCheckpoint: () => void;
}) {
  const multi = props.selected.length > 1;
  const clip = props.selected[0] || null;

  if (!clip) {
    return (
      <Section title="Clip" icon={<Layers size={14} color={LB.accent} />} defaultOpen>
        <div style={hint}>Click a block on the Video track to edit it. Shift-click more blocks to change them together.</div>
      </Section>
    );
  }

  const a = clip.adjust;
  return (
    <Section
      title={multi ? `${props.selected.length} clips` : clip.label.slice(0, 26)}
      icon={<Layers size={14} color={LB.accent} />}
      defaultOpen
      right={(
        <span style={{ display: 'inline-flex', gap: 5 }}>
          <button type="button" className="vs-btn" disabled={!props.canSplit || multi} onClick={props.onSplit} title="Split at the playhead (S)" style={{ ...miniBtn, padding: '4px 8px' }}>
            <Scissors size={11} />
          </button>
          <button type="button" className="vs-btn" onClick={props.onDelete} title="Delete the selection (Delete)" style={{ ...miniBtn, padding: '4px 8px', color: '#991B1B' }}>
            <Trash2 size={11} />
          </button>
        </span>
      )}
    >
      {multi ? <div style={{ ...hint, color: LB.accent }}>Batch edit — adjustments, effects and crop apply to all {props.selected.length} clips.</div> : null}

      {!multi ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: LB.textSecondary }}>
            In
            <input
              type="number" step={0.1} min={0} max={Math.max(0, clip.out - 0.15)} value={Number(clip.in.toFixed(2))}
              className="ve-input vs-input"
              onFocus={props.onCheckpoint}
              onChange={(e) => props.onTrim(clip.id, Math.max(0, Math.min(clip.out - 0.15, Number(e.target.value) || 0)), clip.out)}
              style={{ background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 7, padding: '5px 7px', color: LB.textPrimary, fontSize: 12 }}
            />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: LB.textSecondary }}>
            Out
            <input
              type="number" step={0.1} min={clip.in + 0.15} max={clip.sourceDuration} value={Number(clip.out.toFixed(2))}
              className="ve-input vs-input"
              onFocus={props.onCheckpoint}
              onChange={(e) => props.onTrim(clip.id, clip.in, Math.max(clip.in + 0.15, Math.min(clip.sourceDuration, Number(e.target.value) || 0)))}
              style={{ background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 7, padding: '5px 7px', color: LB.textPrimary, fontSize: 12 }}
            />
          </label>
        </div>
      ) : null}

      <Slider label="Speed" value={a.speed} min={0.25} max={4} step={0.05} onBegin={props.onCheckpoint} onChange={(v) => props.onAdjust({ speed: v })} format={(v) => `${v.toFixed(2)}×`} />
      <div style={rowWrap}>
        {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
          <Chip key={s} active={Math.abs(a.speed - s) < 0.01} onClick={() => { props.onCheckpoint(); props.onAdjust({ speed: s }); }}>{s}×</Chip>
        ))}
        <Chip active={a.reverse} onClick={() => { props.onCheckpoint(); props.onAdjust({ reverse: !a.reverse }); }} title="Play this clip backwards in the export">Reverse</Chip>
      </div>
      {a.reverse ? <div style={hint}>Reverse is applied in the render. The browser preview still plays forward.</div> : null}

      <Slider label="Brightness" value={a.brightness} min={50} max={160} onBegin={props.onCheckpoint} onChange={(v) => props.onAdjust({ brightness: v })} unit="%" />
      <Slider label="Contrast" value={a.contrast} min={50} max={160} onBegin={props.onCheckpoint} onChange={(v) => props.onAdjust({ contrast: v })} unit="%" />
      <Slider label="Saturation" value={a.saturation} min={0} max={200} onBegin={props.onCheckpoint} onChange={(v) => props.onAdjust({ saturation: v })} unit="%" />
      <Slider label="Opacity" value={Math.round(clip.opacity * 100)} min={0} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onOpacity(v / 100)} unit="%" />

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650 }}>Crop &amp; resize</span>
          <button
            type="button"
            className="vs-btn"
            onClick={() => props.onCropLock(!clip.cropLocked)}
            title={clip.cropLocked ? 'Aspect locked — width and height stay in ratio' : 'Freeform — width and height move independently'}
            style={{ ...miniBtn, marginLeft: 'auto', padding: '4px 8px' }}
          >
            {clip.cropLocked ? <Lock size={11} /> : <Unlock size={11} />} {clip.cropLocked ? 'Locked' : 'Free'}
          </button>
        </div>
        <div style={rowWrap}>
          {CROP_PRESETS.map((p) => (
            <Chip key={p.id} active={clip.cropAspect === p.id} onClick={() => { props.onCheckpoint(); props.onCropPreset(p.id); }}>{p.label}</Chip>
          ))}
        </div>
        <Slider label="Crop width" value={Math.round(clip.crop.w * 100)} min={10} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onCrop({ w: v / 100 })} unit="%" />
        {!clip.cropLocked ? (
          <Slider label="Crop height" value={Math.round(clip.crop.h * 100)} min={10} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onCrop({ h: v / 100 })} unit="%" />
        ) : null}
        <Slider label="Crop X" value={Math.round(clip.crop.x * 100)} min={0} max={Math.max(0, Math.round((1 - clip.crop.w) * 100))} onBegin={props.onCheckpoint} onChange={(v) => props.onCrop({ x: v / 100 })} unit="%" />
        <Slider label="Crop Y" value={Math.round(clip.crop.y * 100)} min={0} max={Math.max(0, Math.round((1 - clip.crop.h) * 100))} onBegin={props.onCheckpoint} onChange={(v) => props.onCrop({ y: v / 100 })} unit="%" />
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
        <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650 }}>Effects on {multi ? 'these clips' : 'this clip'}</div>
        <div style={rowWrap}>
          {VISUAL_EFFECTS.map((e) => (
            <Chip key={e.id} active={clip.effects.includes(e.id)} onClick={() => { props.onCheckpoint(); props.onToggleEffect(e.id); }} title={e.hint}>
              {e.label}
            </Chip>
          ))}
        </div>
      </div>

      {!multi && clip.transitionIn ? (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
          <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650 }}>
            Incoming transition — {TRANSITIONS.find((t) => t.id === clip.transitionIn?.id)?.label}
          </div>
          <div style={hint}>Set the duration on the FX track badge, or swap the transition there.</div>
          <div style={{ color: LB.accent, fontSize: 11.5, fontWeight: 700, marginTop: 4 }}>{clip.transitionIn.duration.toFixed(2)}s</div>
        </div>
      ) : null}

      {!multi ? (
        <div style={hint}>
          On the timeline: {fmtTimecode(props.playhead)} · source {clip.in.toFixed(1)}–{clip.out.toFixed(1)}s of {clip.sourceDuration.toFixed(1)}s
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export function CaptionInspector(props: {
  settings: CaptionSettings;
  cueCount: number;
  hasWords: boolean;
  onChange: (patch: Partial<CaptionSettings>) => void;
  onRebuild: () => void;
  onDownloadSrt: () => void;
  onCheckpoint: () => void;
}) {
  const s = props.settings;
  return (
    <Section title="Captions" icon={<TypeIcon size={14} color="#C8920A" />}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
        {CAPTION_STYLES.map((style) => {
          const active = s.styleId === style.id;
          return (
            <button
              key={style.id}
              type="button"
              className="vs-btn"
              onClick={() => { props.onCheckpoint(); props.onChange({ styleId: style.id as CaptionStyleId, fontId: style.fontId, uppercase: style.uppercase }); }}
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
                  background: style.background, borderRadius: 4, padding: style.background === 'transparent' ? 0 : '1px 5px',
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
        <SelectField label="Font" value={s.fontId} options={CAPTION_FONTS.map((f) => ({ id: f.id, label: f.label }))} onChange={(v) => props.onChange({ fontId: v })} />
        <SelectField label="Position" value={s.position} options={[{ id: 'top', label: 'Top' }, { id: 'center', label: 'Centre' }, { id: 'bottom', label: 'Bottom' }]} onChange={(v) => props.onChange({ position: v as CaptionSettings['position'] })} />
      </div>

      <Slider label="Size" value={Math.round(s.sizeScale * 100)} min={60} max={180} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ sizeScale: v / 100 })} unit="%" />
      <Slider label="Vertical nudge" value={Math.round(s.offsetY * 100)} min={-30} max={30} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ offsetY: v / 100 })} unit="%" />
      <Slider label="Outline" value={s.outlineWidth} min={0} max={8} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ outlineWidth: v })} unit="px" />
      <Slider label="Shadow" value={s.shadowBlur} min={0} max={40} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ shadowBlur: v })} unit="px" />

      <div style={{ ...rowWrap, alignItems: 'center' }}>
        <ColorField label="Text" value={s.color} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ color: v })} />
        <ColorField label="Outline" value={s.outlineColor} onBegin={props.onCheckpoint} onChange={(v) => props.onChange({ outlineColor: v })} />
        <Toggle on={s.uppercase} label="Uppercase" onChange={(v) => props.onChange({ uppercase: v })} />
      </div>

      <div style={{ ...rowWrap, alignItems: 'center' }}>
        <Toggle on={s.burnIn} label="Burn into the video" onChange={(v) => props.onChange({ burnIn: v })} />
      </div>
      <div style={hint}>
        {s.burnIn
          ? 'Captions are rendered into the exported MP4. You can still download the SRT as well.'
          : 'The MP4 exports clean — captions come out as a separate SRT file.'}
      </div>

      <div style={rowWrap}>
        <button type="button" className="vs-btn" disabled={!props.hasWords} onClick={props.onRebuild} style={miniBtn}>
          <Wand2 size={12} /> Rebuild from transcript
        </button>
        <button type="button" className="vs-btn" disabled={!props.cueCount} onClick={props.onDownloadSrt} style={miniBtn}>
          <Download size={12} /> Download SRT
        </button>
      </div>
      <div style={hint}>{props.cueCount} caption cue{props.cueCount === 1 ? '' : 's'} on the timeline. Click a word in the transcript to retime from there.</div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Text layers
// ---------------------------------------------------------------------------

export function TextInspector(props: {
  layers: TextLayer[];
  selectedId: string | null;
  playhead: number;
  /** True once the subject has a real matte — today that means the key is on. */
  depthAvailable: boolean;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<TextLayer>) => void;
  onDelete: (id: string) => void;
  onCheckpoint: () => void;
}) {
  const layer = props.layers.find((l) => l.id === props.selectedId) || null;
  return (
    <Section
      title="Text layers"
      icon={<TypeIcon size={14} color="#C8920A" />}
      right={(
        <button type="button" className="vs-btn" onClick={props.onAdd} title="Add a text layer at the playhead" style={{ ...miniBtn, padding: '4px 9px' }}>
          <Plus size={11} /> Add
        </button>
      )}
    >
      {props.layers.length ? (
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {props.layers.map((l) => (
            <button
              key={l.id}
              type="button"
              className="vs-btn"
              onClick={() => props.onSelect(l.id === props.selectedId ? null : l.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', cursor: 'pointer',
                background: l.id === props.selectedId ? 'rgba(200,146,10,0.16)' : 'rgba(180,120,0,0.05)',
                border: `1px solid ${l.id === props.selectedId ? 'rgba(200,146,10,0.5)' : 'rgba(180,120,0,0.14)'}`,
                borderRadius: 7, padding: '6px 8px',
              }}
            >
              <span style={{ flex: 1, minWidth: 0, color: LB.textPrimary, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.text || '(empty)'}</span>
              <span style={{ color: LB.textMuted, fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{fmtTimecode(l.start)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div style={hint}>Add a text layer at the playhead, then drag it on the stage or on the amber Overlay track.</div>
      )}

      {layer ? (
        <div style={{ marginTop: 11, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
          <textarea
            className="ve-input vs-input"
            value={layer.text}
            rows={2}
            onFocus={props.onCheckpoint}
            onChange={(e) => props.onChange(layer.id, { text: e.target.value })}
            style={{ width: '100%', background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 8, padding: 8, color: LB.textPrimary, fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <SelectField label="Font" value={layer.fontId} options={CAPTION_FONTS.map((f) => ({ id: f.id, label: f.label }))} onChange={(v) => props.onChange(layer.id, { fontId: v })} />
            <SelectField label="Entrance" value={layer.entrance} options={ENTRANCE_ANIMS.map((x) => ({ id: x.id, label: x.label }))} onChange={(v) => props.onChange(layer.id, { entrance: v as EntranceAnim })} />
            <SelectField label="Exit" value={layer.exit} options={EXIT_ANIMS.map((x) => ({ id: x.id, label: x.label }))} onChange={(v) => props.onChange(layer.id, { exit: v as ExitAnim })} />
          </div>
          <Slider label="Size" value={layer.size} min={24} max={220} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { size: v })} unit="px" />
          <Slider label="Weight" value={layer.weight} min={300} max={900} step={100} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { weight: v })} />
          <Slider label="Outline" value={layer.outlineWidth} min={0} max={10} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { outlineWidth: v })} unit="px" />
          <Slider label="Shadow" value={layer.shadowBlur} min={0} max={60} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { shadowBlur: v })} unit="px" />
          <Slider label="Animation speed" value={layer.animDuration} min={0.15} max={1.6} step={0.05} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { animDuration: v })} format={(v) => `${v.toFixed(2)}s`} />
          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <ColorField label="Colour" value={layer.color} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { color: v })} />
            <ColorField label="Outline" value={layer.outlineColor} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { outlineColor: v })} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: LB.textSecondary }}>
              In (s)
              <input
                type="number" step={0.1} min={0} value={Number(layer.start.toFixed(2))}
                className="ve-input vs-input"
                onFocus={props.onCheckpoint}
                onChange={(e) => props.onChange(layer.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                style={{ background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 7, padding: '5px 7px', color: LB.textPrimary, fontSize: 12 }}
              />
            </label>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: LB.textSecondary }}>
              Out (s)
              <input
                type="number" step={0.1} min={layer.start + 0.2} value={Number(layer.end.toFixed(2))}
                className="ve-input vs-input"
                onFocus={props.onCheckpoint}
                onChange={(e) => props.onChange(layer.id, { end: Math.max(layer.start + 0.2, Number(e.target.value) || 0) })}
                style={{ background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 7, padding: '5px 7px', color: LB.textPrimary, fontSize: 12 }}
              />
            </label>
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
            <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650 }}>Depth</div>
            <div
              style={{ ...rowWrap, alignItems: 'center', opacity: props.depthAvailable ? 1 : 0.55 }}
              title={props.depthAvailable
                ? 'Draws this layer behind the keyed subject'
                : 'Text depth requires AI subject detection — coming soon'}
            >
              <Toggle
                on={layer.behindSubject}
                label="Behind subject"
                onChange={(v) => { props.onCheckpoint(); props.onChange(layer.id, { behindSubject: v }); }}
              />
              {!props.depthAvailable ? (
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: '#B4720A', background: 'color-mix(in srgb, #C8920A 16%, transparent)', border: '1px solid color-mix(in srgb, #C8920A 38%, transparent)', borderRadius: 999, padding: '2px 7px' }}>
                  COMING SOON
                </span>
              ) : null}
            </div>
            <div style={hint}>
              {props.depthAvailable
                ? 'The key gives the subject a real matte, so this layer is composited underneath it: background → text → subject.'
                : 'Text depth requires AI subject detection — coming soon. It already works on keyed footage: turn the chroma key on in the Overlays tab and the subject’s matte is used.'}
            </div>
          </div>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
            <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650 }}>Glow override</div>
            <div style={{ ...rowWrap, alignItems: 'center' }}>
              <Toggle
                on={layer.glow.enabled}
                label="Glow just this layer"
                onChange={(v) => { props.onCheckpoint(); props.onChange(layer.id, { glow: { ...layer.glow, enabled: v } }); }}
              />
            </div>
            {layer.glow.enabled ? (
              <>
                <Slider label="Glow strength" value={layer.glow.intensity} min={0} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { glow: { ...layer.glow, intensity: v } })} unit="%" />
                <div style={{ ...rowWrap, alignItems: 'center' }}>
                  <ColorField label="Glow" value={layer.glow.color} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(layer.id, { glow: { ...layer.glow, color: v } })} />
                  <Toggle on={layer.glow.rays} label="Rays" onChange={(v) => props.onChange(layer.id, { glow: { ...layer.glow, rays: v } })} />
                </div>
              </>
            ) : (
              <div style={hint}>Off means this layer follows the whole-video glow set in the VFX tab.</div>
            )}
          </div>

          <div style={rowWrap}>
            <button type="button" className="vs-btn" onClick={() => props.onDelete(layer.id)} style={{ ...miniBtn, color: '#991B1B' }}>
              <Trash2 size={12} /> Delete layer
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

function PolyEditor({ points, onChange }: { points: { x: number; y: number }[]; onChange: (p: { x: number; y: number }[]) => void }) {
  const size = 120;
  return (
    <div style={{ marginTop: 8 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        onClick={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          onChange([...points, { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }]);
        }}
        style={{ background: 'rgba(255,250,235,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 7, cursor: 'crosshair' }}
      >
        {points.length >= 3 ? (
          <polygon points={points.map((p) => `${p.x * size},${p.y * size}`).join(' ')} fill="rgba(200,146,10,0.25)" stroke="#C8920A" strokeWidth={1.2} />
        ) : null}
        {points.map((p, i) => (
          <circle
            key={`p-${i}`}
            cx={p.x * size}
            cy={p.y * size}
            r={4}
            fill="#C8920A"
            onClick={(e) => { e.stopPropagation(); onChange(points.filter((_, k) => k !== i)); }}
            style={{ cursor: 'pointer' }}
          />
        ))}
      </svg>
      <div style={hint}>Click to add a point, click a point to remove it. Three points or more make the mask.</div>
    </div>
  );
}

export function OverlayInspector(props: {
  overlays: Overlay[];
  selectedId: string | null;
  duration: number;
  trackingId: string | null;
  trackingProgress: number;
  onSelect: (id: string | null) => void;
  onAddFile: (file: File, asLogo: boolean) => void;
  onAddWorkspaceLogo: () => void;
  onChange: (id: string, patch: Partial<Overlay>) => void;
  onDelete: (id: string) => void;
  onTrack: (id: string) => void;
  onCheckpoint: () => void;
}) {
  const overlay = props.overlays.find((o) => o.id === props.selectedId) || null;
  return (
    <Section
      title="Overlays"
      icon={<ImageIcon size={14} color="#C8920A" />}
      right={(
        <span style={{ display: 'inline-flex', gap: 5 }}>
          <button type="button" className="vs-btn" onClick={props.onAddWorkspaceLogo} title="Add the workspace logo as an overlay" style={{ ...miniBtn, padding: '4px 8px' }}>Logo</button>
          <label className="vs-btn" style={{ ...miniBtn, padding: '4px 8px', cursor: 'pointer' }}>
            <Plus size={11} /> Image
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onAddFile(f, false); e.target.value = ''; }}
            />
          </label>
        </span>
      )}
    >
      {props.overlays.length ? (
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {props.overlays.map((o) => (
            <div
              key={o.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 3,
                background: o.id === props.selectedId ? 'rgba(200,146,10,0.16)' : 'rgba(180,120,0,0.05)',
                border: `1px solid ${o.id === props.selectedId ? 'rgba(200,146,10,0.5)' : 'rgba(180,120,0,0.14)'}`,
                borderRadius: 7, padding: '2px 3px 2px 8px',
              }}
            >
              <button
                type="button"
                className="vs-btn"
                onClick={() => props.onSelect(o.id === props.selectedId ? null : o.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', padding: '4px 0' }}
              >
                <img src={o.url} alt="" style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4, background: 'rgba(180,120,0,0.10)' }} />
                <span style={{ flex: 1, minWidth: 0, color: LB.textPrimary, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
                {o.track.enabled ? <span style={{ color: '#166534', fontSize: 9.5, fontWeight: 800 }}>TRACKED</span> : null}
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
          ))}
        </div>
      ) : (
        <div style={hint}>Add your logo or any image. Drag it on the stage, resize it, mask it, blend it, and let it follow the subject.</div>
      )}

      {overlay ? (
        <div style={{ marginTop: 11, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
          <Slider label="Size" value={Math.round(overlay.w * 100)} min={3} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(overlay.id, { w: v / 100 })} unit="% of frame" />
          <Slider label="Opacity" value={Math.round(overlay.opacity * 100)} min={0} max={100} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(overlay.id, { opacity: v / 100 })} unit="%" />
          <Slider label="Rotation" value={overlay.rotation} min={-180} max={180} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(overlay.id, { rotation: v })} unit="°" />

          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <SelectField label="Blend mode" value={overlay.blend} options={BLEND_MODES.map((b) => ({ id: b.id, label: b.label }))} onChange={(v) => props.onChange(overlay.id, { blend: v as Overlay['blend'] })} />
          </div>

          <div style={{ ...rowWrap, alignItems: 'center' }}>
            <Toggle on={overlay.alwaysOn} label="Always on screen" onChange={(v) => props.onChange(overlay.id, { alwaysOn: v })} />
          </div>
          {!overlay.alwaysOn ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: LB.textSecondary }}>
                In (s)
                <input
                  type="number" step={0.1} min={0} max={props.duration} value={Number(overlay.start.toFixed(2))}
                  className="ve-input vs-input"
                  onChange={(e) => props.onChange(overlay.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                  style={{ background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 7, padding: '5px 7px', color: LB.textPrimary, fontSize: 12 }}
                />
              </label>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, fontWeight: 600, color: LB.textSecondary }}>
                Out (s)
                <input
                  type="number" step={0.1} min={overlay.start + 0.2} value={Number(overlay.end.toFixed(2))}
                  className="ve-input vs-input"
                  onChange={(e) => props.onChange(overlay.id, { end: Math.max(overlay.start + 0.2, Number(e.target.value) || 0) })}
                  style={{ background: 'rgba(255,253,244,0.9)', border: '1px solid rgba(180,120,0,0.14)', borderRadius: 7, padding: '5px 7px', color: LB.textPrimary, fontSize: 12 }}
                />
              </label>
            </div>
          ) : null}

          {/* Masking */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
            <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650 }}>Mask</div>
            <div style={rowWrap}>
              {(['none', 'rect', 'ellipse', 'poly'] as MaskShape[]).map((shape) => (
                <Chip
                  key={shape}
                  active={overlay.mask.shape === shape}
                  onClick={() => { props.onCheckpoint(); props.onChange(overlay.id, { mask: { ...overlay.mask, shape } }); }}
                  title={shape === 'none' ? 'No mask' : shape === 'poly' ? 'Freehand polygon' : `${shape} mask`}
                >
                  {shape === 'none' ? 'None' : shape === 'rect' ? 'Rectangle' : shape === 'ellipse' ? 'Ellipse' : 'Freehand'}
                </Chip>
              ))}
            </div>
            {overlay.mask.shape !== 'none' ? (
              <>
                <Slider label="Feather" value={overlay.mask.feather} min={0} max={40} onBegin={props.onCheckpoint} onChange={(v) => props.onChange(overlay.id, { mask: { ...overlay.mask, feather: v } })} unit="%" />
                <div style={{ ...rowWrap, alignItems: 'center' }}>
                  <Toggle on={overlay.mask.invert} label="Invert — hide inside the shape" onChange={(v) => props.onChange(overlay.id, { mask: { ...overlay.mask, invert: v } })} />
                </div>
                {overlay.mask.shape === 'poly' ? (
                  <PolyEditor
                    points={overlay.mask.points}
                    onChange={(points) => props.onChange(overlay.id, { mask: { ...overlay.mask, points } })}
                  />
                ) : (
                  <>
                    <Slider label="Shape left" value={Math.round((overlay.mask.points[0]?.x ?? 0.1) * 100)} min={0} max={95} onChange={(v) => props.onChange(overlay.id, { mask: { ...overlay.mask, points: [{ x: v / 100, y: overlay.mask.points[0]?.y ?? 0.1 }, overlay.mask.points[1] || { x: 0.9, y: 0.9 }] } })} unit="%" />
                    <Slider label="Shape top" value={Math.round((overlay.mask.points[0]?.y ?? 0.1) * 100)} min={0} max={95} onChange={(v) => props.onChange(overlay.id, { mask: { ...overlay.mask, points: [{ x: overlay.mask.points[0]?.x ?? 0.1, y: v / 100 }, overlay.mask.points[1] || { x: 0.9, y: 0.9 }] } })} unit="%" />
                    <Slider label="Shape right" value={Math.round((overlay.mask.points[1]?.x ?? 0.9) * 100)} min={5} max={100} onChange={(v) => props.onChange(overlay.id, { mask: { ...overlay.mask, points: [overlay.mask.points[0] || { x: 0.1, y: 0.1 }, { x: v / 100, y: overlay.mask.points[1]?.y ?? 0.9 }] } })} unit="%" />
                    <Slider label="Shape bottom" value={Math.round((overlay.mask.points[1]?.y ?? 0.9) * 100)} min={5} max={100} onChange={(v) => props.onChange(overlay.id, { mask: { ...overlay.mask, points: [overlay.mask.points[0] || { x: 0.1, y: 0.1 }, { x: overlay.mask.points[1]?.x ?? 0.9, y: v / 100 }] } })} unit="%" />
                  </>
                )}
              </>
            ) : null}
          </div>

          {/* Tracking */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(180,120,0,0.14)' }}>
            <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650 }}>Auto-tracking</div>
            <div style={rowWrap}>
              <button
                type="button"
                className="vs-btn"
                disabled={props.trackingId === overlay.id}
                onClick={() => props.onTrack(overlay.id)}
                style={primaryBtn}
              >
                {props.trackingId === overlay.id ? <Loader2 size={12} className="vs-spin" /> : <Sparkles size={12} />}
                {props.trackingId === overlay.id ? `Tracking ${Math.round(props.trackingProgress * 100)}%` : overlay.track.keys.length ? 'Re-track from here' : 'Track the subject'}
              </button>
              {overlay.track.keys.length ? (
                <Toggle on={overlay.track.enabled} label="Follow the tracked path" onChange={(v) => props.onChange(overlay.id, { track: { ...overlay.track, enabled: v } })} />
              ) : null}
            </div>
            {overlay.track.keys.length ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(180,120,0,0.14)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(overlay.track.confidence * 100)}%`, height: '100%', background: overlay.track.confidence > 0.55 ? '#166534' : overlay.track.confidence > 0.3 ? '#B45309' : '#991B1B' }} />
                  </div>
                  <span style={{ color: LB.textSecondary, fontSize: 11, fontWeight: 700 }}>{Math.round(overlay.track.confidence * 100)}%</span>
                </div>
                <div style={hint}>{overlay.track.note}</div>
              </div>
            ) : (
              <div style={hint}>Position the overlay over the thing it should follow, then track. The overlay moves with it across the clip.</div>
            )}
          </div>

          <div style={rowWrap}>
            <button type="button" className="vs-btn" onClick={() => props.onDelete(overlay.id)} style={{ ...miniBtn, color: '#991B1B' }}>
              <Trash2 size={12} /> Remove overlay
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Look: grade + global effects + music
// ---------------------------------------------------------------------------

export function LookInspector(props: {
  grade: GradeId;
  globalEffects: VisualEffectId[];
  musicBedId: string;
  musicBeds: { id: string; label: string }[];
  onGrade: (g: GradeId) => void;
  onToggleEffect: (id: VisualEffectId) => void;
  onMusic: (id: string) => void;
  onCheckpoint: () => void;
}) {
  return (
    <Section title="Look & sound" icon={<Sparkles size={14} color="#B45309" />}>
      <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650, marginTop: 6 }}>Colour grade</div>
      <div style={rowWrap}>
        {GRADES.map((g) => (
          <Chip key={g.id} active={props.grade === g.id} onClick={() => { props.onCheckpoint(); props.onGrade(g.id); }}>{g.label}</Chip>
        ))}
      </div>

      <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650, marginTop: 12 }}>Effects on the whole video</div>
      <div style={rowWrap}>
        {VISUAL_EFFECTS.map((e) => (
          <Chip key={e.id} active={props.globalEffects.includes(e.id)} onClick={() => { props.onCheckpoint(); props.onToggleEffect(e.id); }} title={e.hint}>
            {e.label}
          </Chip>
        ))}
      </div>

      <div style={{ color: LB.textSecondary, fontSize: 12, fontWeight: 650, marginTop: 12 }}>Music bed</div>
      <div style={rowWrap}>
        <Chip active={props.musicBedId === 'none'} onClick={() => props.onMusic('none')}>None</Chip>
        {props.musicBeds.map((m) => (
          <Chip key={m.id} active={props.musicBedId === m.id} onClick={() => props.onMusic(m.id)}>{m.label}</Chip>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function ExportInspector(props: {
  aspects: AspectId[];
  resolution: ResolutionId;
  burnIn: boolean;
  cueCount: number;
  exporting: boolean;
  progress: number;
  etaS: number;
  stageNote: string;
  results: { aspect: AspectId; url: string; geometry: string }[];
  error: string;
  onResolution: (r: ResolutionId) => void;
  onExport: () => void;
  onShare: (url: string) => void;
  onDownloadSrt: () => void;
}) {
  return (
    <Section title="Export" icon={<Download size={14} color={LB.accent} />} defaultOpen>
      <div style={{ color: LB.textMuted, fontSize: 11, marginTop: 6 }}>MP4 · H.264 · 30 fps</div>

      <div style={rowWrap}>
        {RESOLUTIONS.map((r) => (
          <Chip
            key={r.id}
            active={props.resolution === r.id}
            onClick={() => { if (r.available) props.onResolution(r.id); }}
            title={r.available ? `${r.label} master` : r.note}
          >
            {r.available ? r.label : `${r.label} — n/a`}
          </Chip>
        ))}
      </div>
      <div style={hint}>
        {props.aspects.map((a) => `${a} at ${outputDims(a, props.resolution).width}×${outputDims(a, props.resolution).height}`).join(' · ')}
      </div>
      <div style={hint}>
        16:9 and 9:16 come out at their true pixel dimensions. 1:1 and 4:5 are delivered centred inside a
        1920×1080 file, because the platform’s render service is fixed to that canvas — which is also why
        720p and 4K are not on offer.
      </div>

      <div style={{ ...rowWrap, marginTop: 10 }}>
        <button
          type="button"
          className="vs-btn ve-tap"
          disabled={props.exporting}
          onClick={props.onExport}
          data-testid="ve-export-video"
          style={{ ...vePrimary, flex: '1 1 160px' }}
        >
          {props.exporting ? <Loader2 size={15} className="vs-spin" /> : <Download size={15} />}
          {props.exporting ? 'Exporting…' : 'Export Video'}
        </button>
        {props.cueCount && !props.burnIn ? (
          <button type="button" className="vs-btn" onClick={props.onDownloadSrt} style={{ ...miniBtn, minHeight: 44, padding: '0 14px' }}>
            <Download size={12} /> Subtitle file
          </button>
        ) : null}
      </div>

      {props.exporting ? <ExportProgress progress={props.progress} etaS={props.etaS} stage={props.stageNote} /> : null}

      <ExportReady results={props.results} onShare={props.onShare} />

      {props.error ? (
        <div style={{ color: '#991B1B', fontSize: 12.5, lineHeight: 1.55, marginTop: 10 }}>{props.error}</div>
      ) : null}
    </Section>
  );
}
