/**
 * Video Studio — the timeline.
 *
 * Five colour-coded rows (video, b-roll slots, overlay/text, captions, FX),
 * trim handles on every clip edge, drag-to-reorder, Shift-click multi-select
 * for batch operations, draggable text and overlay bars, transition badges on
 * the cut points, and a retention heat strip above the ruler so the creator
 * can see where the edit is predicted to lose people.
 *
 * Pure React pointer events — no drag library, no canvas.
 */
import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeftRight, Scissors, Trash2, Wand2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  BrollSlot, CaptionCue, LB, Overlay, StudioClip, TRANSITIONS, TRACK_COLORS,
  TextLayer, TransitionId, clipLength, clipStart, fmtTimecode, retentionColor,
} from './studioModel';

const ROW_H = 40;
const RULER_H = 20;
const LABEL_W = 78;

interface Drag {
  kind: 'move' | 'trim-in' | 'trim-out' | 'playhead' | 'text' | 'overlay' | 'caption';
  id?: string;
  startX: number;
  startValue: number;
  moved: boolean;
}

const labelCol: CSSProperties = {
  width: LABEL_W, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 10,
  color: LB.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
};

const laneStyle: CSSProperties = {
  position: 'relative', flex: 1, height: ROW_H, borderRadius: 7,
  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
};

function clipColor(c: StudioClip): string {
  if (c.kind === 'broll') return TRACK_COLORS.broll;
  if (c.kind === 'cut') return TRACK_COLORS.cut;
  return TRACK_COLORS.raw;
}

export default function StudioTimeline(props: {
  clips: StudioClip[];
  captions: CaptionCue[];
  textLayers: TextLayer[];
  overlays: Overlay[];
  brollSlots: BrollSlot[];
  retention: { start: number; end: number; retention: number; why: string }[];
  duration: number;
  playhead: number;
  selectedClipIds: string[];
  selectedTextId: string | null;
  selectedOverlayId: string | null;
  onSeek: (t: number) => void;
  onSelectClips: (ids: string[]) => void;
  onReorder: (from: number, to: number) => void;
  onTrim: (id: string, nextIn: number, nextOut: number) => void;
  onDeleteClip: (id: string) => void;
  onSelectText: (id: string | null) => void;
  onSelectOverlay: (id: string | null) => void;
  onMoveText: (id: string, start: number) => void;
  onMoveOverlay: (id: string, start: number) => void;
  onSetTransition: (clipId: string, id: TransitionId | null) => void;
  onPickSlot: (id: string) => void;
  onSplit: () => void;
  canSplit: boolean;
}) {
  const { clips, duration, playhead } = props;
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [previewX, setPreviewX] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [transMenu, setTransMenu] = useState<string | null>(null);

  const total = Math.max(1, duration);
  const pct = (s: number) => `${Math.max(0, Math.min(100, (s / total) * 100))}%`;

  function laneSeconds(clientX: number): number {
    const el = laneRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(total, ((clientX - r.left) / Math.max(1, r.width)) * total));
  }
  function dxSeconds(clientX: number, startX: number): number {
    const el = laneRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return ((clientX - startX) / Math.max(1, r.width)) * total;
  }

  function begin(e: ReactPointerEvent, state: Drag) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = state;
    if (state.kind === 'move') setDraggingId(state.id || null);
    e.stopPropagation();
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = dxSeconds(e.clientX, d.startX);
    if (Math.abs(dx) > 0.02) d.moved = true;
    if (d.kind === 'playhead') { props.onSeek(Math.max(0, Math.min(total, d.startValue + dx))); return; }
    if (d.kind === 'text') { if (d.id) props.onMoveText(d.id, Math.max(0, d.startValue + dx)); return; }
    if (d.kind === 'overlay') { if (d.id) props.onMoveOverlay(d.id, Math.max(0, d.startValue + dx)); return; }
    const clip = clips.find((c) => c.id === d.id);
    if (!clip) return;
    if (d.kind === 'move') { setPreviewX(d.startValue + dx); return; }
    const srcDx = dx * Math.max(0.25, clip.adjust.speed);
    if (d.kind === 'trim-in') {
      props.onTrim(clip.id, Math.max(0, Math.min(clip.out - 0.15, d.startValue + srcDx)), clip.out);
    } else if (d.kind === 'trim-out') {
      props.onTrim(clip.id, clip.in, Math.max(clip.in + 0.15, Math.min(clip.sourceDuration || d.startValue + srcDx, d.startValue + srcDx)));
    }
  }

  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    const preview = previewX;
    setPreviewX(null);
    if (!d || d.kind !== 'move' || !d.id) return;
    if (!d.moved) return;
    const from = clips.findIndex((c) => c.id === d.id);
    if (from < 0 || preview == null) return;
    const centre = preview + clipLength(clips[from]) / 2;
    let to = 0;
    let cursor = 0;
    for (let i = 0; i < clips.length; i += 1) {
      if (i === from) continue;
      const len = clipLength(clips[i]);
      if (centre > cursor + len / 2) to += 1;
      cursor += len;
    }
    if (to !== from) props.onReorder(from, to);
  }

  function pickClip(e: ReactPointerEvent, id: string) {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) { props.onSelectClips([id]); return; }
    const next = props.selectedClipIds.includes(id)
      ? props.selectedClipIds.filter((x) => x !== id)
      : [...props.selectedClipIds, id];
    props.onSelectClips(next);
  }

  const captionStart = props.captions.length ? Math.min(...props.captions.map((c) => c.start)) : 0;
  const captionEnd = props.captions.length ? Math.max(...props.captions.map((c) => c.end)) : 0;

  return (
    <div
      style={{ background: LB.bgDeep, border: LB.border, borderRadius: 12, padding: '8px 10px 10px', userSelect: 'none', touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ color: LB.textPrimary, fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          {fmtTimecode(playhead, true)}
          <span style={{ color: LB.textMuted }}> / {fmtTimecode(total, true)}</span>
        </span>
        <button
          type="button"
          className="vs-btn"
          disabled={!props.canSplit}
          onClick={props.onSplit}
          title="Split the clip under the playhead (S)"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: LB.textSecondary, borderRadius: 7, padding: '5px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
        >
          <Scissors size={12} /> Split
        </button>
        {props.selectedClipIds.length > 1 ? (
          <span style={{ color: TRACK_COLORS.cut, fontSize: 11.5, fontWeight: 700 }}>
            {props.selectedClipIds.length} clips selected — batch edits apply to all
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button type="button" className="vs-btn" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} title="Zoom out" style={{ background: 'transparent', border: 'none', color: LB.textMuted, cursor: 'pointer', padding: 3 }}><ZoomOut size={14} /></button>
          <span style={{ color: LB.textMuted, fontSize: 10.5, width: 28, textAlign: 'center' }}>{zoom.toFixed(1)}×</span>
          <button type="button" className="vs-btn" onClick={() => setZoom((z) => Math.min(8, z + 0.5))} title="Zoom in" style={{ background: 'transparent', border: 'none', color: LB.textMuted, cursor: 'pointer', padding: 3 }}><ZoomIn size={14} /></button>
        </span>
      </div>

      <div style={{ overflowX: zoom > 1 ? 'auto' : 'hidden', paddingBottom: zoom > 1 ? 6 : 0 }}>
        <div style={{ minWidth: `${zoom * 100}%` }}>
          {/* Retention heat strip */}
          {props.retention.length ? (
            <div style={{ display: 'flex', marginBottom: 4 }}>
              <div style={{ ...labelCol, height: 12, fontSize: 9 }} title="Predicted watch-time retention across the cut">Retention</div>
              <div style={{ position: 'relative', flex: 1, height: 12, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
                {props.retention.map((s, i) => (
                  <div
                    key={`ret-${i}`}
                    title={`${s.retention}% predicted retention · ${s.why}`}
                    style={{
                      position: 'absolute', left: pct(s.start), width: pct(Math.max(0.2, s.end - s.start)),
                      top: 0, bottom: 0, background: retentionColor(s.retention),
                      opacity: 0.25 + (s.retention / 100) * 0.6,
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Ruler */}
          <div style={{ display: 'flex' }}>
            <div style={{ ...labelCol, height: RULER_H }}>Time</div>
            <div
              ref={laneRef}
              style={{ position: 'relative', flex: 1, height: RULER_H, cursor: 'pointer' }}
              onPointerDown={(e) => {
                const t = laneSeconds(e.clientX);
                props.onSeek(t);
                begin(e, { kind: 'playhead', startX: e.clientX, startValue: t, moved: false });
              }}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <span key={f} style={{ position: 'absolute', left: `${f * 100}%`, bottom: 1, transform: 'translateX(-50%)', color: LB.textMuted, fontSize: 9 }}>
                  {fmtTimecode(total * f)}
                </span>
              ))}
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            {/* VIDEO — grey raw, blue cut, green b-roll */}
            <div style={{ display: 'flex', marginTop: 5 }}>
              <div style={labelCol} title="Grey = raw · Blue = cut · Green = B-roll">Video</div>
              <div style={laneStyle} onPointerDown={(e) => { props.onSelectClips([]); props.onSeek(laneSeconds(e.clientX)); }}>
                {clips.map((c, i) => {
                  const dragging = draggingId === c.id && previewX != null;
                  const start = dragging ? (previewX as number) : clipStart(clips, i);
                  const len = clipLength(c);
                  const selected = props.selectedClipIds.includes(c.id);
                  return (
                    <div
                      key={c.id}
                      onPointerDown={(e) => { pickClip(e, c.id); begin(e, { kind: 'move', id: c.id, startX: e.clientX, startValue: clipStart(clips, i), moved: false }); }}
                      title={`${c.label} · ${c.in.toFixed(1)}–${c.out.toFixed(1)}s · ${c.adjust.speed}×${c.adjust.reverse ? ' reversed' : ''}`}
                      style={{
                        position: 'absolute', left: pct(start), width: `calc(${pct(len)} - 2px)`, top: 3, bottom: 3,
                        background: clipColor(c), borderRadius: 7, cursor: 'grab', overflow: 'hidden',
                        border: selected ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.18)',
                        boxShadow: selected ? '0 0 10px rgba(245,158,11,0.4)' : 'none',
                        opacity: dragging ? 0.75 : 1, zIndex: dragging ? 4 : 1,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <div
                        onPointerDown={(e) => begin(e, { kind: 'trim-in', id: c.id, startX: e.clientX, startValue: c.in, moved: false })}
                        title="Drag to trim the clip head"
                        style={{ width: 8, alignSelf: 'stretch', cursor: 'ew-resize', background: 'rgba(255,255,255,0.3)', flexShrink: 0 }}
                      />
                      <span style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 10, fontWeight: 600, padding: '0 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.label}
                      </span>
                      <button
                        type="button"
                        className="vs-btn"
                        title={`Delete ${c.label}`}
                        aria-label={`Delete ${c.label}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); props.onDeleteClip(c.id); }}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, flexShrink: 0, marginRight: 2, color: '#fff', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 6, cursor: 'pointer', padding: 0 }}
                      >
                        <Trash2 size={11} />
                      </button>
                      <div
                        onPointerDown={(e) => begin(e, { kind: 'trim-out', id: c.id, startX: e.clientX, startValue: c.out, moved: false })}
                        title="Drag to trim the clip tail"
                        style={{ width: 8, alignSelf: 'stretch', cursor: 'ew-resize', background: 'rgba(255,255,255,0.3)', flexShrink: 0 }}
                      />
                    </div>
                  );
                })}
                {!clips.length ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>
                    Drop footage above — it lands here and the cut plan starts immediately.
                  </div>
                ) : null}
              </div>
            </div>

            {/* B-ROLL SLOTS */}
            <div style={{ display: 'flex', marginTop: 5 }}>
              <div style={labelCol} title="Detected silence, pauses and low-action stretches">B-roll</div>
              <div style={laneStyle} onPointerDown={(e) => props.onSeek(laneSeconds(e.clientX))}>
                {props.brollSlots.map((s) => (
                  <div
                    key={s.id}
                    onPointerDown={(e) => { e.stopPropagation(); props.onPickSlot(s.id); props.onSeek(s.start); }}
                    title={`${s.reason} — click to replace or generate`}
                    style={{
                      position: 'absolute', left: pct(s.start), width: `calc(${pct(Math.max(0.3, s.end - s.start))} - 2px)`, top: 3, bottom: 3,
                      background: s.status === 'filled' ? TRACK_COLORS.broll : 'rgba(34,197,94,0.22)',
                      border: `1px ${s.status === 'filled' ? 'solid' : 'dashed'} ${TRACK_COLORS.broll}`,
                      borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', paddingLeft: 7,
                      color: s.status === 'filled' ? '#04240f' : '#86efac', fontSize: 10, fontWeight: 700,
                      whiteSpace: 'nowrap', overflow: 'hidden',
                    }}
                  >
                    {s.status === 'generating' ? 'Generating…' : s.status === 'filled' ? 'B-roll ready' : s.status === 'failed' ? 'Failed — retry' : `${s.cause === 'silence' ? 'Silence' : s.cause === 'pause' ? 'Pause' : 'Static'} gap`}
                  </div>
                ))}
                {!props.brollSlots.length ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>
                    No gaps flagged yet — they appear after the cut plan runs.
                  </div>
                ) : null}
              </div>
            </div>

            {/* OVERLAY + TEXT — purple */}
            <div style={{ display: 'flex', marginTop: 5 }}>
              <div style={labelCol} title="Image overlays and animated text layers">Overlay</div>
              <div style={laneStyle} onPointerDown={(e) => { props.onSelectText(null); props.onSelectOverlay(null); props.onSeek(laneSeconds(e.clientX)); }}>
                {props.overlays.filter((o) => !o.alwaysOn).map((o) => (
                  <div
                    key={o.id}
                    onPointerDown={(e) => { props.onSelectOverlay(o.id); begin(e, { kind: 'overlay', id: o.id, startX: e.clientX, startValue: o.start, moved: false }); }}
                    title={`${o.label} · drag to retime`}
                    style={{
                      position: 'absolute', left: pct(o.start), width: `calc(${pct(Math.max(0.3, o.end - o.start))} - 2px)`, top: 3, height: 15,
                      background: 'rgba(168,85,247,0.55)', border: props.selectedOverlayId === o.id ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 5, cursor: 'grab', display: 'flex', alignItems: 'center', paddingLeft: 6,
                      color: '#fff', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden',
                    }}
                  >
                    {o.label}
                  </div>
                ))}
                {props.textLayers.map((l) => (
                  <div
                    key={l.id}
                    onPointerDown={(e) => { props.onSelectText(l.id); begin(e, { kind: 'text', id: l.id, startX: e.clientX, startValue: l.start, moved: false }); }}
                    title={`“${l.text}” · drag to retime`}
                    style={{
                      position: 'absolute', left: pct(l.start), width: `calc(${pct(Math.max(0.3, l.end - l.start))} - 2px)`, bottom: 3, height: 15,
                      background: TRACK_COLORS.overlay, border: props.selectedTextId === l.id ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 5, cursor: 'grab', display: 'flex', alignItems: 'center', paddingLeft: 6,
                      color: '#fff', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden',
                    }}
                  >
                    T {l.text}
                  </div>
                ))}
                {!props.overlays.length && !props.textLayers.length ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>
                    No overlays or text layers yet.
                  </div>
                ) : null}
              </div>
            </div>

            {/* CAPTIONS — yellow */}
            <div style={{ display: 'flex', marginTop: 5 }}>
              <div style={labelCol}>Captions</div>
              <div style={laneStyle} onPointerDown={(e) => props.onSeek(laneSeconds(e.clientX))}>
                {props.captions.length ? (
                  <>
                    <div
                      style={{
                        position: 'absolute', left: pct(Math.max(0, captionStart)), width: `calc(${pct(Math.max(0.4, captionEnd - captionStart))} - 2px)`,
                        top: 3, bottom: 3, background: 'rgba(234,179,8,0.16)', border: `1px solid ${TRACK_COLORS.caption}`, borderRadius: 7,
                      }}
                    />
                    {props.captions.slice(0, 400).map((c) => (
                      <div
                        key={c.id}
                        onPointerDown={(e) => { e.stopPropagation(); props.onSeek(c.start); }}
                        title={c.text}
                        style={{
                          position: 'absolute', left: pct(c.start), width: `calc(${pct(Math.max(0.12, c.end - c.start))} - 1px)`,
                          top: 6, bottom: 6, background: TRACK_COLORS.caption, borderRadius: 3, cursor: 'pointer', opacity: 0.85,
                        }}
                      />
                    ))}
                  </>
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>
                    No captions — accept the caption card, or transcribe from the transcript panel.
                  </div>
                )}
              </div>
            </div>

            {/* FX — transitions on the cut points, orange */}
            <div style={{ display: 'flex', marginTop: 5 }}>
              <div style={labelCol} title="Transitions sit on cut points">FX</div>
              <div style={laneStyle} onPointerDown={(e) => props.onSeek(laneSeconds(e.clientX))}>
                {clips.map((c, i) => {
                  if (i === 0) return null;
                  const at = clipStart(clips, i);
                  const t = c.transitionIn;
                  const meta = t ? TRANSITIONS.find((x) => x.id === t.id) : null;
                  const open = transMenu === c.id;
                  return (
                    <div key={`cut-${c.id}`} style={{ position: 'absolute', left: pct(at), top: 3, bottom: 3 }}>
                      <button
                        type="button"
                        className="vs-btn"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setTransMenu(open ? null : c.id); }}
                        title={meta ? `${meta.label} · ${t?.duration.toFixed(2)}s — click to change` : 'Add a transition on this cut'}
                        style={{
                          transform: 'translateX(-50%)', height: '100%', minWidth: t ? 70 : 20, padding: t ? '0 7px' : 0,
                          background: t ? TRACK_COLORS.fx : 'rgba(249,115,22,0.2)',
                          border: `1px ${t ? 'solid' : 'dashed'} ${TRACK_COLORS.fx}`, borderRadius: 6,
                          color: t ? '#2a1203' : '#fdba74', fontSize: 9.5, fontWeight: 800, cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
                        }}
                      >
                        {t ? <ArrowLeftRight size={10} /> : <Wand2 size={10} />}
                        {meta ? meta.label : ''}
                      </button>
                      {open ? (
                        <div
                          onPointerDown={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute', bottom: '110%', left: 0, transform: 'translateX(-50%)', zIndex: 20,
                            background: '#111827', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9,
                            padding: 6, display: 'grid', gap: 3, width: 188, boxShadow: '0 10px 28px rgba(0,0,0,0.6)',
                          }}
                        >
                          {TRANSITIONS.map((x) => (
                            <button
                              key={x.id}
                              type="button"
                              className="vs-btn"
                              onClick={() => { props.onSetTransition(c.id, x.id); setTransMenu(null); }}
                              title={x.hint}
                              style={{
                                textAlign: 'left', background: t?.id === x.id ? 'rgba(249,115,22,0.22)' : 'transparent',
                                border: 'none', borderRadius: 6, padding: '5px 7px', color: LB.textSecondary,
                                fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              {x.label}
                            </button>
                          ))}
                          {t ? (
                            <button
                              type="button"
                              className="vs-btn"
                              onClick={() => { props.onSetTransition(c.id, null); setTransMenu(null); }}
                              style={{ textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 2, paddingTop: 6, color: '#f87171', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Remove transition
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {clips.length < 2 ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>
                    Split or add a second clip to get cut points you can drop transitions on.
                  </div>
                ) : null}
              </div>
            </div>

            {/* Playhead */}
            <div style={{ position: 'absolute', top: -RULER_H + 4, bottom: 0, left: LABEL_W, right: 0, pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(playhead), width: 2, background: LB.accent, transform: 'translateX(-1px)' }}>
                <div style={{ position: 'absolute', top: -1, left: '50%', width: 9, height: 9, background: LB.accent, transform: 'translate(-50%, -50%) rotate(45deg)', borderRadius: 2 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
