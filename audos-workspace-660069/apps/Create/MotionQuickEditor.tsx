/**
 * VidVerge — MOTION UI: the Quick Editor.
 *
 * A LIGHTWEIGHT timeline for quick corrections after generation — not a
 * Premiere/CapCut replacement. It edits the ONE Motion Plan directly (through
 * the store), so Generate → Quick Edit → Render never leaves VidVerge and never
 * breaks the continuous composition: every change is validated + repaired and
 * pushed onto the undo/redo stack.
 *
 * Tracks: UI/asset layers, Text cues, Audio. Trim by dragging a bar's ends,
 * move by dragging its middle; select a bar to reveal its inspector (delete,
 * duplicate, split at the playhead, reorder, replace asset, edit text).
 */
import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  Copy,
  Plus,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  addTextCue,
  canRedo,
  canUndo,
  deleteLayer,
  deleteTextCue,
  duplicateLayer,
  moveLayerOrder,
  redo,
  replaceLayerAsset,
  setAudioMuted,
  setAudioVolume,
  splitLayer,
  trimLayer,
  undo,
  updateTextCue,
} from './motionUiStore';
import type { AssetLayer, MotionAsset, MotionPlan, TextCue } from './motionUiTypes';
import { clamp } from './motionUiTypes';
import { FONT, T } from './ui';

const TRACK_H = 40;
const LABEL_W = 66;

function Bar({
  left,
  width,
  color,
  label,
  selected,
  onSelect,
  onTrim,
  onMove,
  duration,
  trackWidth,
}: {
  left: number;
  width: number;
  color: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onTrim?: (edge: 'start' | 'end', deltaSec: number) => void;
  onMove?: (deltaSec: number) => void;
  duration: number;
  trackWidth: number;
}) {
  const drag = useRef<{ mode: 'move' | 'start' | 'end'; x0: number } | null>(null);

  const onPointerDown = (mode: 'move' | 'start' | 'end') => (e: PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode, x0: e.clientX };
    onSelect();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const deltaPx = e.clientX - drag.current.x0;
    const deltaSec = (deltaPx / Math.max(1, trackWidth)) * duration;
    if (Math.abs(deltaSec) < 0.02) return;
    drag.current.x0 = e.clientX;
    if (drag.current.mode === 'move' && onMove) onMove(deltaSec);
    else if (onTrim) onTrim(drag.current.mode, deltaSec);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={onPointerDown('move')}
      style={{
        position: 'absolute',
        left,
        width: Math.max(14, width),
        top: 5,
        height: TRACK_H - 10,
        borderRadius: 7,
        background: selected ? color : `${color}cc`,
        border: selected ? '2px solid #fff' : '1px solid rgba(255,255,255,0.25)',
        cursor: 'grab',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        boxShadow: selected ? '0 6px 18px -8px rgba(0,0,0,0.9)' : 'none',
      }}
      title={label}
    >
      {onTrim ? (
        <span
          onPointerDown={onPointerDown('start')}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: 'rgba(0,0,0,0.28)' }}
        />
      ) : null}
      <span
        style={{
          flex: 1,
          padding: '0 12px',
          fontSize: 11,
          fontWeight: 600,
          color: '#fff',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          pointerEvents: 'none',
        }}
      >
        {label}
      </span>
      {onTrim ? (
        <span
          onPointerDown={onPointerDown('end')}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: 'rgba(0,0,0,0.28)' }}
        />
      ) : null}
    </div>
  );
}

function Track({
  label,
  children,
  onWidth,
}: {
  label: string;
  children: (width: number) => ReactNode;
  onWidth?: (w: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const measure = (el: HTMLDivElement | null) => {
    ref.current = el;
    if (el) {
      const w = el.clientWidth;
      if (w !== width) {
        setWidth(w);
        if (onWidth) onWidth(w);
      }
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ width: LABEL_W, flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.muted }}>
        {label}
      </span>
      <div
        ref={measure}
        style={{ position: 'relative', flex: 1, height: TRACK_H, borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}` }}
      >
        {width > 0 ? children(width) : null}
      </div>
    </div>
  );
}

function miniSelect(value: string, onChange: (v: string) => void, options: { value: string; label: string }[], testId?: string) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
      style={{
        padding: '6px 8px',
        borderRadius: 8,
        border: `1px solid ${T.borderStrong}`,
        background: '#101014',
        color: T.text,
        fontSize: 12,
        fontFamily: FONT,
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const iconBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 11px',
  borderRadius: 9,
  border: `1px solid ${T.border}`,
  background: 'rgba(255,255,255,0.04)',
  color: T.sub,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: FONT,
  cursor: 'pointer',
};

export default function MotionQuickEditor({
  plan,
  assets,
  playhead,
}: {
  plan: MotionPlan;
  assets: MotionAsset[];
  playhead: number;
}) {
  const [selLayer, setSelLayer] = useState<string | null>(null);
  const [selText, setSelText] = useState<string | null>(null);
  const [newText, setNewText] = useState('');
  const duration = plan.duration;

  const layer = plan.layers.find((l) => l.id === selLayer) || null;
  const cue = plan.text.find((c) => c.id === selText) || null;

  const assetLabel = (assetId: string) => {
    const a = assets.find((x) => x.id === assetId);
    return a ? a.role || a.filename : 'layer';
  };
  const layerLabel = (item: AssetLayer) =>
    item.kind === 'ai_video' ? 'AI video' : item.kind === 'avatar' ? 'Presenter' : assetLabel(item.assetId);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" style={{ ...iconBtn, opacity: canUndo() ? 1 : 0.4 }} onClick={undo} disabled={!canUndo()} data-testid="qe-undo">
          <Undo2 size={13} /> Undo
        </button>
        <button type="button" style={{ ...iconBtn, opacity: canRedo() ? 1 : 0.4 }} onClick={redo} disabled={!canRedo()} data-testid="qe-redo">
          <Redo2 size={13} /> Redo
        </button>
        <span style={{ width: 1, height: 22, background: T.border }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add a headline…"
            data-testid="qe-add-text-input"
            style={{ padding: '7px 10px', borderRadius: 9, border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.04)', color: T.text, fontSize: 12.5, fontFamily: FONT, width: 150 }}
          />
          <button
            type="button"
            style={iconBtn}
            onClick={() => {
              addTextCue(newText);
              setNewText('');
            }}
            data-testid="qe-add-text"
          >
            <Plus size={13} /> Text
          </button>
        </div>
      </div>

      {/* Timeline ruler */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: LABEL_W, flexShrink: 0 }} />
        <div style={{ position: 'relative', flex: 1, height: 16 }}>
          {Array.from({ length: Math.floor(duration) + 1 }).map((_, i) => (
            <span
              key={i}
              style={{ position: 'absolute', left: `${(i / duration) * 100}%`, fontSize: 9, color: T.muted, transform: 'translateX(-50%)' }}
            >
              {i % 5 === 0 || i === Math.floor(duration) ? `${i}s` : '·'}
            </span>
          ))}
        </div>
      </div>

      {/* Playhead-aware tracks */}
      <div style={{ position: 'relative' }}>
        {/* Playhead line spanning the tracks */}
        <div
          style={{
            position: 'absolute',
            left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${clamp(playhead / duration, 0, 1)})`,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'rgba(255,255,255,0.5)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
        <Track label="UI / Assets">
          {(width) =>
            plan.layers.map((l) => (
              <Bar
                key={l.id}
                left={(l.start / duration) * width}
                width={((l.end - l.start) / duration) * width}
                color={T.accent}
                label={layerLabel(l)}
                selected={selLayer === l.id}
                duration={duration}
                trackWidth={width}
                onSelect={() => {
                  setSelLayer(l.id);
                  setSelText(null);
                }}
                onTrim={(edge, delta) => {
                  if (edge === 'start') trimLayer(l.id, l.start + delta, l.end);
                  else trimLayer(l.id, l.start, l.end + delta);
                }}
                onMove={(delta) => {
                  const span = l.end - l.start;
                  const ns = clamp(l.start + delta, 0, duration - span);
                  trimLayer(l.id, ns, ns + span);
                }}
              />
            ))
          }
        </Track>
        <Track label="Text">
          {(width) =>
            plan.text.map((c) => (
              <Bar
                key={c.id}
                left={(c.start / duration) * width}
                width={((c.end - c.start) / duration) * width}
                color="#f59e0b"
                label={c.content}
                selected={selText === c.id}
                duration={duration}
                trackWidth={width}
                onSelect={() => {
                  setSelText(c.id);
                  setSelLayer(null);
                }}
                onTrim={(edge, delta) => {
                  if (edge === 'start') updateTextCue(c.id, { start: clamp(c.start + delta, 0, c.end - 0.4) });
                  else updateTextCue(c.id, { end: clamp(c.end + delta, c.start + 0.4, duration) });
                }}
                onMove={(delta) => {
                  const span = c.end - c.start;
                  const ns = clamp(c.start + delta, 0, duration - span);
                  updateTextCue(c.id, { start: ns, end: ns + span });
                }}
              />
            ))
          }
        </Track>
        <Track label="Audio">
          {(width) => (
            <div style={{ position: 'absolute', left: 0, width, top: 5, height: TRACK_H - 10, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
              <button
                type="button"
                onClick={() => setAudioMuted(!plan.audio.muted)}
                style={{ ...iconBtn, padding: '5px 9px' }}
                data-testid="qe-mute"
              >
                {plan.audio.muted ? <VolumeX size={13} /> : <Volume2 size={13} />} {plan.audio.muted ? 'Muted' : 'On'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={plan.audio.volume}
                onChange={(e) => setAudioVolume(Number(e.target.value))}
                style={{ flex: 1, accentColor: plan.brand.primary }}
                aria-label="Music volume"
              />
              <span style={{ fontSize: 11, color: T.muted }}>{plan.audio.musicUrl ? 'Music' : 'No track'}</span>
            </div>
          )}
        </Track>
      </div>

      {/* Selected layer inspector */}
      {layer ? (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{layerLabel(layer)}</span>
            <span style={{ fontSize: 11, color: T.muted }}>{layer.start.toFixed(1)}–{layer.end.toFixed(1)}s</span>
            <span style={{ flex: 1 }} />
            <button type="button" style={iconBtn} onClick={() => splitLayer(layer.id, playhead)} data-testid="qe-split">
              <Scissors size={13} /> Split
            </button>
            <button type="button" style={iconBtn} onClick={() => duplicateLayer(layer.id)} data-testid="qe-duplicate">
              <Copy size={13} /> Duplicate
            </button>
            <button type="button" style={iconBtn} onClick={() => moveLayerOrder(layer.id, -1)} title="Send backward">
              <ArrowLeftRight size={13} /> Order
            </button>
            <button
              type="button"
              style={{ ...iconBtn, color: T.danger, borderColor: 'rgba(239,68,68,0.3)' }}
              onClick={() => {
                deleteLayer(layer.id);
                setSelLayer(null);
              }}
              data-testid="qe-delete-layer"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
          <div style={{ display: layer.kind === 'ai_video' || layer.kind === 'avatar' ? 'none' : 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: T.muted }}>Replace asset:</span>
            {miniSelect(
              layer.assetId,
              (v) => replaceLayerAsset(layer.id, v),
              assets.filter((a) => a.type !== 'reference_video').map((a) => ({ value: a.id, label: a.role || a.filename })),
              'qe-replace-asset',
            )}
          </div>
          {layer.kind === 'ai_video' || layer.kind === 'avatar' ? (
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: T.muted }}>{layer.prompt || 'Generated layer'}</p>
          ) : null}
        </div>
      ) : null}

      {/* Selected text inspector */}
      {cue ? (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.02)' }}>
          <input
            value={cue.content}
            onChange={(e) => updateTextCue(cue.id, { content: e.target.value })}
            data-testid="qe-edit-text"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9, border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.04)', color: T.text, fontSize: 14, fontFamily: FONT, marginBottom: 10 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {miniSelect(cue.anchor, (v) => updateTextCue(cue.id, { anchor: v as TextCue['anchor'] }), [
              { value: 'center', label: 'Center' },
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' },
              { value: 'top-left', label: 'Top left' },
              { value: 'top-right', label: 'Top right' },
              { value: 'bottom-left', label: 'Bottom left' },
              { value: 'bottom-right', label: 'Bottom right' },
            ])}
            {miniSelect(String(cue.level), (v) => updateTextCue(cue.id, { level: Number(v) as TextCue['level'], weight: Number(v) === 3 ? 800 : Number(v) === 1 ? 500 : 700 }), [
              { value: '1', label: 'Body' },
              { value: '2', label: 'Headline' },
              { value: '3', label: 'Hero' },
            ])}
            {miniSelect(cue.animation, (v) => updateTextCue(cue.id, { animation: v as TextCue['animation'] }), [
              { value: 'fade', label: 'Fade' },
              { value: 'slide_up', label: 'Slide up' },
              { value: 'word_reveal', label: 'Word reveal' },
              { value: 'char_reveal', label: 'Char reveal' },
              { value: 'tracking_expand', label: 'Tracking' },
              { value: 'scale_reveal', label: 'Scale' },
              { value: 'mask_reveal', label: 'Mask' },
            ])}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={{ ...iconBtn, color: T.danger, borderColor: 'rgba(239,68,68,0.3)' }}
              onClick={() => {
                deleteTextCue(cue.id);
                setSelText(null);
              }}
              data-testid="qe-delete-text"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      ) : null}

      {!layer && !cue ? (
        <p style={{ margin: '12px 0 0', fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
          Drag a bar's edges to trim, drag its middle to move. Select a bar to split, duplicate, reorder, replace or delete it. Every change is undoable.
        </p>
      ) : null}
    </div>
  );
}
