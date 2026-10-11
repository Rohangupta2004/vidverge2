/**
 * Video Enhancer NLE — the bottom timeline.
 *
 * Three tracks (Video / Audio / Captions), clips as colored rounded
 * rectangles with labels, pointer-event drag to reorder video clips, trim
 * handles on video clip edges, a 2px amber playhead with a diamond head
 * synced to the player, and click-to-seek. Pure React + CSS — no libraries.
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { LB, LB_TRACKS, MotionGraphic, NleCaption, NleClip, clipStartOnTimeline, clipTimelineLength, fmtTimecode } from './nleCore';

const GRAPHICS_COLOR = '#C8920A';

const TRACK_H = 44;
const RULER_H = 22;

interface DragState {
  kind: 'move' | 'trim-in' | 'trim-out' | 'captions' | 'playhead' | 'graphic';
  clipId?: string;
  startX: number;
  startValue: number;   // move: clip start (s) · trim: in/out (source s) · captions: offset · playhead: t
  moved: boolean;
}

export default function NleTimeline(props: {
  clips: NleClip[];
  captions: NleCaption[];
  captionOffset: number;
  graphics: MotionGraphic[];
  selectedGraphicId: string | null;
  musicBed: { id: string; label: string } | null;
  duration: number;
  playhead: number;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onSelectGraphic: (id: string | null) => void;
  onMoveGraphic: (id: string, start: number) => void;
  onSeek: (t: number) => void;
  onReorder: (from: number, to: number) => void;
  onTrim: (id: string, nextIn: number, nextOut: number) => void;
  onCaptionOffset: (offset: number) => void;
}) {
  const { clips, captions, duration, playhead } = props;
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragPreviewX, setDragPreviewX] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

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

  function beginDrag(e: ReactPointerEvent, state: DragState) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = state;
    if (state.kind === 'move') setDraggingId(state.clipId || null);
    e.stopPropagation();
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = dxSeconds(e.clientX, d.startX);
    if (Math.abs(dx) > 0.02) d.moved = true;
    if (d.kind === 'playhead') { props.onSeek(Math.max(0, Math.min(total, d.startValue + dx))); return; }
    if (d.kind === 'captions') { props.onCaptionOffset(d.startValue + dx); return; }
    if (d.kind === 'graphic') { if (d.clipId) props.onMoveGraphic(d.clipId, Math.max(0, d.startValue + dx)); return; }
    const clip = clips.find((c) => c.id === d.clipId);
    if (!clip) return;
    if (d.kind === 'move') { setDragPreviewX(d.startValue + dx); return; }
    // Trimming: a timeline delta converts to source seconds through the speed.
    const srcDx = dx * Math.max(0.1, clip.speed);
    if (d.kind === 'trim-in') {
      const nextIn = Math.max(0, Math.min(clip.out - 0.2, d.startValue + srcDx));
      props.onTrim(clip.id, nextIn, clip.out);
    } else if (d.kind === 'trim-out') {
      const nextOut = Math.max(clip.in + 0.2, Math.min(clip.sourceDuration || d.startValue + srcDx, d.startValue + srcDx));
      props.onTrim(clip.id, clip.in, nextOut);
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    const preview = dragPreviewX;
    setDragPreviewX(null);
    if (!d) return;
    if (d.kind === 'move' && d.clipId) {
      if (!d.moved) { props.onSelectClip(d.clipId); return; }
      const from = clips.findIndex((c) => c.id === d.clipId);
      if (from < 0 || preview == null) return;
      const center = preview + clipTimelineLength(clips[from]) / 2;
      let to = 0;
      let cursor = 0;
      for (let i = 0; i < clips.length; i += 1) {
        if (i === from) continue;
        const len = clipTimelineLength(clips[i]);
        if (center > cursor + len / 2) to += 1;
        cursor += len;
      }
      if (to !== from) props.onReorder(from, to);
    }
  }

  const labelCol = { width: 74, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 12, color: LB.textMuted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const };
  const lane = { position: 'relative' as const, flex: 1, height: TRACK_H, borderRadius: 8, background: 'rgba(180,120,0,0.04)', border: '1px solid rgba(180,120,0,0.12)' };

  const captionStart = captions.length ? Math.min(...captions.map((c) => c.start)) + props.captionOffset : 0;
  const captionEnd = captions.length ? Math.max(...captions.map((c) => c.end)) + props.captionOffset : 0;

  return (
    <div
      style={{ background: LB.bgDeep, border: LB.border, borderRadius: 12, padding: '10px 12px 12px', userSelect: 'none', touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Ruler + playhead head */}
      <div style={{ display: 'flex' }}>
        <div style={{ ...labelCol, height: RULER_H }}>{fmtTimecode(playhead)}</div>
        <div
          ref={laneRef}
          style={{ position: 'relative', flex: 1, height: RULER_H, cursor: 'pointer' }}
          onPointerDown={(e) => {
            const t = laneSeconds(e.clientX);
            props.onSeek(t);
            beginDrag(e, { kind: 'playhead', startX: e.clientX, startValue: t, moved: false });
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} style={{ position: 'absolute', left: `${f * 100}%`, bottom: 2, transform: 'translateX(-50%)', color: LB.textMuted, fontSize: 9 }}>
              {fmtTimecode(total * f)}
            </span>
          ))}
        </div>
      </div>

      {/* Tracks */}
      <div style={{ position: 'relative' }}>
        {/* VIDEO */}
        <div style={{ display: 'flex', marginTop: 6 }}>
          <div style={labelCol}>Video</div>
          <div style={lane} onPointerDown={(e) => { props.onSelectClip(null); props.onSeek(laneSeconds(e.clientX)); }}>
            {clips.map((c, i) => {
              const isDragging = draggingId === c.id && dragPreviewX != null;
              const start = isDragging ? (dragPreviewX as number) : clipStartOnTimeline(clips, i);
              const len = clipTimelineLength(c);
              const selected = props.selectedClipId === c.id;
              return (
                <div
                  key={c.id}
                  onPointerDown={(e) => beginDrag(e, { kind: 'move', clipId: c.id, startX: e.clientX, startValue: clipStartOnTimeline(clips, i), moved: false })}
                  title={`${c.label} · ${c.in.toFixed(1)}s–${c.out.toFixed(1)}s · ${c.speed}×`}
                  style={{
                    position: 'absolute', left: pct(start), width: `calc(${pct(len)} - 2px)`, top: 4, bottom: 4,
                    background: c.kind === 'broll' ? 'rgba(200,146,10,0.9)' : LB_TRACKS.video,
                    borderRadius: 8, cursor: 'grab', overflow: 'hidden',
                    border: selected ? '2px solid #C8920A' : '1px solid rgba(180,120,0,0.28)',
                    boxShadow: selected ? '0 0 12px rgba(200,146,10,0.4)' : 'none',
                    opacity: isDragging ? 0.75 : 1,
                    zIndex: isDragging ? 3 : 1,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {/* trim handles */}
                  <div
                    onPointerDown={(e) => beginDrag(e, { kind: 'trim-in', clipId: c.id, startX: e.clientX, startValue: c.in, moved: false })}
                    style={{ width: 9, alignSelf: 'stretch', cursor: 'ew-resize', background: 'rgba(255,255,255,0.28)', flexShrink: 0 }}
                  />
                  <span style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 10.5, fontWeight: 600, padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'system-ui, sans-serif' }}>
                    {c.label}
                  </span>
                  <div
                    onPointerDown={(e) => beginDrag(e, { kind: 'trim-out', clipId: c.id, startX: e.clientX, startValue: c.out, moved: false })}
                    style={{ width: 9, alignSelf: 'stretch', cursor: 'ew-resize', background: 'rgba(255,255,255,0.28)', flexShrink: 0 }}
                  />
                </div>
              );
            })}
            {!clips.length ? <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>Upload footage to start — it lands here as a clip.</div> : null}
          </div>
        </div>

        {/* GRAPHICS — kinetic motion-graphic cues */}
        <div style={{ display: 'flex', marginTop: 6 }}>
          <div style={labelCol}>Graphics</div>
          <div style={lane} onPointerDown={(e) => { props.onSelectGraphic(null); props.onSeek(laneSeconds(e.clientX)); }}>
            {props.graphics.map((g) => {
              const selected = props.selectedGraphicId === g.id;
              return (
                <div
                  key={g.id}
                  onPointerDown={(e) => { props.onSelectGraphic(g.id); beginDrag(e, { kind: 'graphic', clipId: g.id, startX: e.clientX, startValue: g.start, moved: false }); }}
                  title={`${g.kind} · “${g.text}” — drag to retime, click to edit in Properties`}
                  style={{
                    position: 'absolute', left: pct(g.start), width: `calc(${pct(Math.max(0.4, g.duration))} - 2px)`, top: 4, bottom: 4,
                    background: GRAPHICS_COLOR, borderRadius: 8, cursor: 'grab', overflow: 'hidden',
                    border: selected ? '2px solid #C8920A' : '1px solid rgba(180,120,0,0.28)',
                    boxShadow: selected ? '0 0 12px rgba(200,146,10,0.4)' : 'none',
                    display: 'flex', alignItems: 'center', paddingLeft: 8,
                    color: '#42300f', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontFamily: 'system-ui, sans-serif',
                  }}
                >
                  ✦ {g.text || g.kind}
                </div>
              );
            })}
            {!props.graphics.length ? <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>No motion graphics — add one from AI Tools, or run AI Edit.</div> : null}
          </div>
        </div>

        {/* AUDIO */}
        <div style={{ display: 'flex', marginTop: 6 }}>
          <div style={labelCol}>Audio</div>
          <div style={lane} onPointerDown={(e) => props.onSeek(laneSeconds(e.clientX))}>
            {props.musicBed ? (
              <div title={`Music bed · ${props.musicBed.label}`} style={{ position: 'absolute', left: 0, right: 0, top: 4, bottom: 4, background: LB_TRACKS.audio, borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#04291c', fontSize: 10.5, fontWeight: 700, fontFamily: 'system-ui, sans-serif' }}>
                ♪ {props.musicBed.label}
              </div>
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>No music bed — pick one in Properties.</div>
            )}
          </div>
        </div>

        {/* CAPTIONS */}
        <div style={{ display: 'flex', marginTop: 6 }}>
          <div style={labelCol}>Captions</div>
          <div style={lane} onPointerDown={(e) => props.onSeek(laneSeconds(e.clientX))}>
            {captions.length ? (
              <div
                onPointerDown={(e) => beginDrag(e, { kind: 'captions', startX: e.clientX, startValue: props.captionOffset, moved: false })}
                title={`${captions.length} captions — drag to retime`}
                style={{ position: 'absolute', left: pct(Math.max(0, captionStart)), width: `calc(${pct(Math.max(0.4, captionEnd - captionStart))} - 2px)`, top: 4, bottom: 4, background: LB_TRACKS.captions, borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#241503', fontSize: 10.5, fontWeight: 700, cursor: 'grab', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontFamily: 'system-ui, sans-serif' }}
              >
                Captions ({captions.length})
              </div>
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, color: LB.textMuted, fontSize: 11 }}>No captions — paste a transcript in AI Tools.</div>
            )}
          </div>
        </div>

        {/* Playhead — 2px amber line + diamond, over all three tracks */}
        <div style={{ position: 'absolute', top: -RULER_H + 6, bottom: 0, left: 74, right: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(playhead), width: 2, background: LB.accent, transform: 'translateX(-1px)' }}>
            <div style={{ position: 'absolute', top: -1, left: '50%', width: 9, height: 9, background: LB.accent, transform: 'translate(-50%, -50%) rotate(45deg)', borderRadius: 2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
