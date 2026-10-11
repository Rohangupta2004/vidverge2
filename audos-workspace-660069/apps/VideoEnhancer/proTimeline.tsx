/**
 * Vidverge Pro — the four-track editing timeline.
 *
 * VIDEO / AUDIO / TEXT / FX stack vertically against one shared time ruler, so
 * a caption, a cutaway and the shot underneath it line up on the same second.
 * Everything is derived from the EditDoc: there is no second copy of the edit
 * living in the timeline, which is why dragging a trim handle and typing in
 * the right-hand panel can never disagree.
 *
 * Zoom is pixels-per-second, 0.25x to 8x of a 60 px/s base. The ruler picks a
 * tick step that stays legible at every zoom instead of drawing a fixed
 * one-second grid that turns into a solid bar when you zoom out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ChevronDown, ChevronUp, Copy, Diamond, Minus, Music2, Plus, Scissors,
  Sparkles, Trash2, Type as TypeIcon, Video as VideoIcon,
} from 'lucide-react';
import {
  CaptionCue, Overlay, StudioClip, TextLayer, TransitionId, TRANSITIONS, VideoOverlay,
  VisualEffectId, clipLength, clipStart, timelineDuration,
} from './studioModel';
import { PRO, timecode } from './proUi';

const BASE_PX_PER_SEC = 60;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

const CLIP_FILL: Record<StudioClip['kind'], string> = {
  raw: 'linear-gradient(180deg,#2B4C86,#1E3A6B)',
  cut: 'linear-gradient(180deg,#2F63B8,#1E4080)',
  broll: 'linear-gradient(180deg,#128055,#0B5A3C)',
};

export interface TimelineProps {
  clips: StudioClip[];
  captions: CaptionCue[];
  textLayers: TextLayer[];
  overlays: Overlay[];
  videoOverlays: VideoOverlay[];
  globalEffects: VisualEffectId[];
  /** Silence ranges measured from the source audio, in timeline seconds. */
  silences: { start: number; end: number }[];
  musicLabel: string;
  playhead: number;
  zoom: number;
  collapsed: boolean;
  selectedClipIds: string[];
  selectedTextId: string | null;
  selectedBrollId: string | null;
  onZoom: (z: number) => void;
  onCollapse: (v: boolean) => void;
  /**
   * Height drag from the grip on the top edge. `persist` is true once on
   * release so the host can save it; a height of 0 asks for the natural
   * (auto) height again.
   */
  onResize?: (height: number, persist: boolean) => void;
  onSeek: (t: number) => void;
  onSelectClips: (ids: string[]) => void;
  onSelectText: (id: string | null) => void;
  onSelectBroll: (id: string | null) => void;
  onTrim: (id: string, nextIn: number, nextOut: number) => void;
  onBeforeEdit: () => void;
  onSplit: () => void;
  onSplitAt: (time: number) => void;
  onInsert: (kind: 'aiVideo' | 'aiImage' | 'overlay' | 'motion' | 'cut', time: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRipple: (id: string) => void;
  onTransition: (id: string, t: TransitionId | null) => void;
  onToggleKeyframe: (id: string) => void;
  onMoveText: (id: string, start: number) => void;
}

type Menu = { x: number; y: number; clipId: string } | null;
type InsertPoint = { x: number; y: number; time: number; open: boolean; clientX: number; clientY: number } | null;

export default function ProTimeline(props: TimelineProps) {
  const {
    clips, captions, textLayers, overlays, videoOverlays, globalEffects, silences,
    musicLabel, playhead, zoom, collapsed, selectedClipIds, selectedTextId, selectedBrollId,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const addTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addWasOpenRef = useRef(false);
  const [resizing, setResizing] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [insertPoint, setInsertPoint] = useState<InsertPoint>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [drag, setDrag] = useState<{ kind: 'in' | 'out' | 'text'; id: string } | null>(null);

  const duration = Math.max(1, timelineDuration(clips));
  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const width = Math.max(320, duration * pxPerSec);

  const starts = useMemo(() => clips.map((_, i) => clipStart(clips, i)), [clips]);

  /** Tick step in seconds that keeps labels at least 56 px apart. */
  const tickStep = useMemo(() => {
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    return steps.find((s) => s * pxPerSec >= 56) || 600;
  }, [pxPerSec]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += tickStep) out.push(Number(t.toFixed(3)));
    return out;
  }, [duration, tickStep]);

  const timeAt = useCallback((clientX: number): number => {
    const node = laneRef.current;
    if (!node) return 0;
    const box = node.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - box.left) / pxPerSec));
  }, [duration, pxPerSec]);

  // ---- scrubbing -----------------------------------------------------------
  const scrub = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    props.onSeek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => props.onSeek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [props, timeAt]);

  const showInsertPoint = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const time = timeAt(e.clientX);
    props.onSeek(time);
    if (splitMode) {
      props.onSplitAt(time);
      return;
    }
    const lane = laneRef.current?.getBoundingClientRect();
    if (!lane) return;
    setInsertPoint({
      x: time * pxPerSec,
      y: Math.max(24, e.clientY - lane.top),
      time,
      open: false,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, [props, pxPerSec, splitMode, timeAt]);

  const openAddAtPlayhead = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    addTriggerRef.current = e.currentTarget;
    props.onCollapse(false);
    setInsertPoint({
      x: playhead * pxPerSec,
      y: 46,
      time: playhead,
      open: true,
      clientX: box.left + box.width / 2,
      clientY: box.bottom + 8,
    });
  }, [playhead, props, pxPerSec]);

  const applyInsert = useCallback((kind: 'aiVideo' | 'aiImage' | 'overlay' | 'motion' | 'cut') => {
    if (!insertPoint) return;
    props.onInsert(kind, insertPoint.time);
    setInsertPoint(null);
  }, [insertPoint, props]);

  // ---- height drag (the grip along the top edge) ---------------------------
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const onResize = props.onResize;
    const root = rootRef.current;
    if (e.button !== 0 || !onResize || !root) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setResizing(true);
    const startY = e.clientY;
    const startH = root.getBoundingClientRect().height;
    const clamp = (h: number) => Math.round(Math.max(80, Math.min(window.innerHeight * 0.5, h)));
    let latest = clamp(startH);
    const move = (ev: PointerEvent) => {
      // Dragging up (smaller clientY) makes the timeline taller.
      latest = clamp(startH + (startY - ev.clientY));
      onResize(latest, false);
    };
    const up = () => {
      setResizing(false);
      onResize(latest, true);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, [props]);

  // ---- trim handles --------------------------------------------------------
  const startTrim = useCallback((e: React.PointerEvent, clip: StudioClip, edge: 'in' | 'out', index: number) => {
    e.stopPropagation();
    e.preventDefault();
    props.onBeforeEdit();
    setDrag({ kind: edge, id: clip.id });
    const speed = Math.max(0.25, clip.adjust.speed);
    const originX = e.clientX;
    const startIn = clip.in;
    const startOut = clip.out;
    const move = (ev: PointerEvent) => {
      // Handle travel is timeline pixels; the trim itself is in source
      // seconds, so a sped-up clip trims by the same amount of *footage* the
      // cursor covered rather than drifting away from the pointer.
      const deltaSource = ((ev.clientX - originX) / pxPerSec) * speed;
      if (edge === 'in') {
        props.onTrim(clip.id, Math.max(0, Math.min(startOut - 0.2, startIn + deltaSource)), startOut);
      } else {
        props.onTrim(clip.id, startIn, Math.max(startIn + 0.2, Math.min(clip.sourceDuration, startOut + deltaSource)));
      }
    };
    const up = () => {
      setDrag(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    void index;
  }, [props, pxPerSec]);

  // ---- text block dragging -------------------------------------------------
  const startTextDrag = useCallback((e: React.PointerEvent, layer: TextLayer) => {
    e.stopPropagation();
    props.onBeforeEdit();
    props.onSelectText(layer.id);
    setDrag({ kind: 'text', id: layer.id });
    const originX = e.clientX;
    const startAt = layer.start;
    const move = (ev: PointerEvent) => {
      const next = Math.max(0, startAt + (ev.clientX - originX) / pxPerSec);
      props.onMoveText(layer.id, Number(next.toFixed(2)));
    };
    const up = () => {
      setDrag(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [props, pxPerSec]);

  // ---- wheel zoom ----------------------------------------------------------
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = zoom * (e.deltaY > 0 ? 0.88 : 1.14);
      props.onZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(next.toFixed(3)))));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [props, zoom]);

  // Keep the playhead on screen while it travels.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const x = playhead * pxPerSec;
    const left = node.scrollLeft;
    const right = left + node.clientWidth;
    if (x < left + 40) node.scrollLeft = Math.max(0, x - 80);
    else if (x > right - 60) node.scrollLeft = x - node.clientWidth + 120;
  }, [playhead, pxPerSec]);

  useEffect(() => {
    if (!menu && !insertPoint?.open) return undefined;
    const close = () => { setMenu(null); setInsertPoint((point) => point ? { ...point, open: false } : null); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [insertPoint?.open, menu]);

  useEffect(() => {
    if (insertPoint?.open) {
      addWasOpenRef.current = true;
      const frame = window.requestAnimationFrame(() => addMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (addWasOpenRef.current) {
      addWasOpenRef.current = false;
      const frame = window.requestAnimationFrame(() => {
        const remembered = addTriggerRef.current;
        const target = remembered?.isConnected ? remembered : rootRef.current?.querySelector<HTMLButtonElement>('[data-timeline-add="true"]');
        target?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [insertPoint?.open]);

  const menuClip = menu ? clips.find((c) => c.id === menu.clipId) || null : null;

  const span = (start: number, end: number): CSSProperties => ({
    left: `${start * pxPerSec}px`,
    width: `${Math.max(3, (end - start) * pxPerSec)}px`,
  });

  const head = (
    <div className="vp-tlbar">
      <button
        type="button"
        className="vp-btn xs ghost"
        onClick={() => props.onCollapse(!collapsed)}
        title={collapsed ? 'Show the timeline' : 'Hide the timeline'}
      >
        {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Timeline
      </button>
      <span className="vp-mono" style={{ fontSize: 11.5, color: '#1A1000', fontWeight: 700 }}>
        {timecode(playhead)}
      </span>
      <span className="vp-mono" style={{ fontSize: 10.5, color: PRO.text3 }}>/ {timecode(duration)}</span>
      <button data-timeline-add="true" type="button" className="vp-btn xs primary" onClick={openAddAtPlayhead} title="Add video, image, overlay, motion or a cut at the playhead">
        <Plus size={12} /> Add
      </button>
      <span className="vp-spread" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          className="vp-ico sm"
          title="Zoom out"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => props.onZoom(Math.max(ZOOM_MIN, Number((zoom / 1.5).toFixed(3))))}
        >
          <Minus size={12} />
        </button>
        <span className="vp-mono" style={{ fontSize: 10.5, color: PRO.text2, minWidth: 38, textAlign: 'center' }}>
          {zoom >= 1 ? `${zoom.toFixed(zoom < 10 ? 2 : 1)}x` : `${zoom.toFixed(2)}x`}
        </span>
        <button
          type="button"
          className="vp-ico sm"
          title="Zoom in (or Ctrl + scroll over the timeline)"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => props.onZoom(Math.min(ZOOM_MAX, Number((zoom * 1.5).toFixed(3))))}
        >
          <Plus size={12} />
        </button>
        <span className="vp-divider" />
        <button
          type="button"
          className={`vp-btn xs${splitMode ? ' on' : ''}`}
          onClick={() => setSplitMode((active) => !active)}
          title="Scissors mode — click a clip to split exactly there"
          aria-pressed={splitMode}
        >
          <Scissors size={11} /> {splitMode ? 'Click to cut' : 'Split'}
        </button>
      </span>
    </div>
  );

  if (collapsed) {
    return <div className="vp-tl" ref={rootRef}>{head}</div>;
  }

  const grip = props.onResize ? (
    <div
      className="vp-tl-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the timeline"
      title="Drag to resize the timeline · double-click to reset"
      data-dragging={resizing ? 'true' : 'false'}
      onPointerDown={startResize}
      onDoubleClick={() => props.onResize?.(0, true)}
    />
  ) : null;

  return (
    <div className="vp-tl" ref={rootRef}>
      {grip}
      {head}
      <div style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* fixed track labels */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
          <div className="vp-trkhead" style={{ height: 22, justifyContent: 'center' }}>
            <b style={{ fontSize: 8.5 }}>Tracks</b>
          </div>
          {[
            { label: 'Video', Icon: VideoIcon, color: PRO.track.video },
            { label: 'Audio', Icon: Music2, color: PRO.track.audio },
            { label: 'Text', Icon: TypeIcon, color: PRO.track.text },
            { label: 'FX', Icon: Sparkles, color: PRO.track.fx },
          ].map((t) => (
            <div key={t.label} className="vp-trkhead" style={{ height: 38 }}>
              <b><t.Icon size={10} color={t.color} /> {t.label}</b>
            </div>
          ))}
        </div>

        {/* scrolling lanes */}
        <div className="vp-tlwrap" ref={scrollRef} style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div className="vp-tlgrid" ref={laneRef} style={{ width }}>
            {/* ruler */}
            <div className="vp-ruler" onPointerDown={scrub} onClick={showInsertPoint}>
              {ticks.map((t) => (
                <span key={t} style={{ left: `${t * pxPerSec}px` }}>{timecode(t).slice(0, 5)}</span>
              ))}
            </div>

            {/* VIDEO */}
            <div className="vp-trk" onPointerDown={scrub} onClick={showInsertPoint} style={{ cursor: splitMode ? 'crosshair' : undefined }}>
              {clips.map((clip, i) => {
                const start = starts[i];
                const len = clipLength(clip);
                const on = selectedClipIds.includes(clip.id);
                return (
                  <div
                    key={clip.id}
                    className={`vp-clip${on ? ' on' : ''}`}
                    style={{ ...span(start, start + len), background: CLIP_FILL[clip.kind] }}
                    title={`${clip.label} · ${len.toFixed(1)}s`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (splitMode) {
                        const time = timeAt(e.clientX);
                        props.onSeek(time);
                        props.onSplitAt(time);
                        return;
                      }
                      props.onSelectClips(e.shiftKey ? Array.from(new Set([...selectedClipIds, clip.id])) : [clip.id]);
                      props.onSeek(start + 0.01);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      props.onSelectClips([clip.id]);
                      setMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
                    }}
                  >
                    <span className="vp-handle" onPointerDown={(e) => startTrim(e, clip, 'in', i)} />
                    <span className="vp-cliplab">{clip.label}</span>
                    <span className="vp-handle r" onPointerDown={(e) => startTrim(e, clip, 'out', i)} />
                    {(clip.keyframes || []).map((k, ki) => (
                      <span
                        key={`${clip.id}-k${ki}`}
                        className="vp-key"
                        title={`Keyframe at ${timecode(k.t)} · opacity ${Math.round(k.opacity * 100)}% · scale ${k.scale.toFixed(2)}x`}
                        style={{ left: `${(k.t / Math.max(0.05, len)) * 100}%` }}
                      />
                    ))}
                  </div>
                );
              })}
              {clips.map((clip, i) => {
                if (i === 0) return null;
                const at = starts[i];
                const label = clip.transitionIn
                  ? (TRANSITIONS.find((t) => t.id === clip.transitionIn?.id)?.label || 'Cut')
                  : 'Cut';
                return (
                  <button
                    key={`tr-${clip.id}`}
                    type="button"
                    className="vp-trans"
                    style={{ left: `${at * pxPerSec}px` }}
                    title="Change the transition into this clip"
                    onClick={(e) => {
                      e.stopPropagation();
                      const order: (TransitionId | null)[] = [null, 'crossfade', 'whipPan', 'zoomPunch', 'glitchCut'];
                      const current = clip.transitionIn?.id || null;
                      const next = order[(order.indexOf(current) + 1) % order.length];
                      props.onTransition(clip.id, next);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* AUDIO */}
            <div className="vp-trk" onPointerDown={scrub} onClick={showInsertPoint}>
              {clips.map((clip, i) => {
                const start = starts[i];
                const len = clipLength(clip);
                return (
                  <div
                    key={`a-${clip.id}`}
                    className="vp-clip"
                    style={{
                      ...span(start, start + len),
                      background: clip.muted
                        ? 'repeating-linear-gradient(45deg,#1b1b1b,#1b1b1b 5px,#232323 5px,#232323 10px)'
                        : 'linear-gradient(180deg,#0F6F52,#0A4B38)',
                      cursor: 'default',
                    }}
                    title={clip.muted ? `${clip.label} — muted` : `${clip.label} — original audio`}
                  >
                    {!clip.muted ? (
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          inset: '6px 2px',
                          // A legible level band rather than a fabricated waveform:
                          // the editor never measured per-sample peaks for this clip.
                          background:
                            'repeating-linear-gradient(90deg,rgba(255,255,255,.34) 0 2px,transparent 2px 5px)',
                          maskImage: 'linear-gradient(180deg,transparent,#000 35%,#000 65%,transparent)',
                          WebkitMaskImage: 'linear-gradient(180deg,transparent,#000 35%,#000 65%,transparent)',
                        }}
                      />
                    ) : null}
                    <span className="vp-cliplab">{clip.muted ? 'Muted' : 'Audio'}</span>
                  </div>
                );
              })}
              {silences.map((s, i) => (
                <span
                  key={`sil-${i}`}
                  title={`Silence · ${(s.end - s.start).toFixed(1)}s`}
                  style={{
                    position: 'absolute',
                    top: 4,
                    bottom: 4,
                    ...span(s.start, s.end),
                    background: 'rgba(26,16,0,.38)',
                    border: '1px dashed rgba(200,146,10,.55)',
                    borderRadius: 4,
                    pointerEvents: 'none',
                  }}
                />
              ))}
              {musicLabel ? (
                <div
                  className="vp-clip"
                  style={{
                    ...span(0, duration),
                    top: 'auto',
                    bottom: 2,
                    height: 9,
                    background: 'linear-gradient(90deg,#78350F,#D97706)',
                    cursor: 'default',
                  }}
                  title={`Music bed · ${musicLabel}`}
                />
              ) : null}
            </div>

            {/* TEXT */}
            <div className="vp-trk" onPointerDown={scrub} onClick={showInsertPoint}>
              {captions.map((cue) => (
                <div
                  key={cue.id}
                  className="vp-clip"
                  style={{
                    ...span(cue.start, cue.end),
                    top: 4,
                    height: 13,
                    background: 'linear-gradient(180deg,#B45309,#92400E)',
                    cursor: 'pointer',
                  }}
                  title={cue.text}
                  onClick={() => props.onSeek(cue.start + 0.01)}
                />
              ))}
              {textLayers.map((layer) => (
                <div
                  key={layer.id}
                  className={`vp-clip${selectedTextId === layer.id ? ' on' : ''}`}
                  style={{
                    ...span(layer.start, layer.end),
                    top: 19,
                    bottom: 4,
                    background: 'linear-gradient(180deg,#D97706,#B45309)',
                    cursor: 'grab',
                  }}
                  title={`${layer.text} — drag to move`}
                  onPointerDown={(e) => startTextDrag(e, layer)}
                >
                  <span className="vp-cliplab">{layer.text}</span>
                </div>
              ))}
            </div>

            {/* FX */}
            <div className="vp-trk" onPointerDown={scrub} onClick={showInsertPoint}>
              {globalEffects.map((fx, i) => (
                <div
                  key={`g-${fx}`}
                  className="vp-clip"
                  style={{
                    ...span(0, duration),
                    top: 4 + i * 8,
                    height: 7,
                    background: 'linear-gradient(90deg,#D97706,#F59E0B)',
                    cursor: 'default',
                  }}
                  title={`${fx} — whole video`}
                />
              ))}
              {videoOverlays.map((o) => (
                <div
                  key={o.id}
                  className={`vp-clip${selectedBrollId === o.id ? ' on' : ''}`}
                  style={{
                    ...span(o.start, o.end),
                    top: 16,
                    bottom: 4,
                    background: 'linear-gradient(180deg,#B4720A,#8A5708)',
                  }}
                  title={`${o.label} — B-roll overlay`}
                  onClick={() => { props.onSelectBroll(o.id); props.onSeek(o.start + 0.01); }}
                >
                  <span className="vp-cliplab">{o.label}</span>
                </div>
              ))}
              {overlays.filter((o) => !o.alwaysOn).map((o) => (
                <div
                  key={o.id}
                  className="vp-clip"
                  style={{
                    ...span(o.start, o.end),
                    top: 16,
                    bottom: 4,
                    background: 'linear-gradient(180deg,#D97706,#92400E)',
                    cursor: 'default',
                  }}
                  title={`${o.label} — image overlay`}
                >
                  <span className="vp-cliplab">{o.label}</span>
                </div>
              ))}
            </div>

            {insertPoint ? (
              <>
                <button
                  type="button"
                  aria-label={`Add at ${timecode(insertPoint.time)}`}
                  title={`Add at ${timecode(insertPoint.time)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const box = e.currentTarget.getBoundingClientRect();
                    addTriggerRef.current = e.currentTarget;
                    setInsertPoint((point) => point ? { ...point, open: true, clientX: box.left + box.width / 2, clientY: box.bottom + 8 } : point);
                  }}
                  style={{
                    position: 'absolute', left: insertPoint.x, top: insertPoint.y, zIndex: 18,
                    width: 24, height: 24, marginLeft: -12, marginTop: -12, borderRadius: '50%',
                    display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#160d02',
                    background: 'linear-gradient(135deg,#FFD66E,#F5A20A)', border: '1px solid rgba(255,255,255,.42)',
                    boxShadow: '0 0 0 5px rgba(200,146,10,.18),0 8px 24px rgba(120,80,0,.18)',
                  }}
                >
                  <Plus size={14} />
                </button>
              </>
            ) : null}

            {/* the playhead rides over every lane and never swallows a click */}
            <div className="vp-playhead" style={{ left: `${playhead * pxPerSec}px` }} />
          </div>
        </div>
      </div>

      {insertPoint?.open ? (
        <div
          ref={addMenuRef}
          className="vp-addmenu"
          role="dialog"
          aria-modal="false"
          aria-label={`Add at ${timecode(insertPoint.time)}`}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            left: Math.max(12, Math.min(insertPoint.clientX - 122, window.innerWidth - 260)),
            top: Math.max(64, Math.min(insertPoint.clientY, window.innerHeight - 330)),
          }}
        >
          <div className="vp-addhead"><span>Add to timeline</span><b>{timecode(insertPoint.time)}</b></div>
          <button type="button" onClick={() => applyInsert('aiVideo')}><VideoIcon size={16} /><span><b>AI Video</b><small>Generate real B-roll at this moment</small></span></button>
          <button type="button" onClick={() => applyInsert('aiImage')}><Sparkles size={16} /><span><b>AI Image</b><small>Generate a timed visual layer</small></span></button>
          <button type="button" onClick={() => applyInsert('overlay')}><Plus size={16} /><span><b>Overlay</b><small>Add image, logo, video or text</small></span></button>
          <button type="button" onClick={() => applyInsert('motion')}><Diamond size={16} /><span><b>Motion</b><small>Animate, reframe or add camera movement</small></span></button>
          <button type="button" onClick={() => applyInsert('cut')}><Scissors size={16} /><span><b>Cut here</b><small>Split the active clip exactly at playhead</small></span></button>
        </div>
      ) : null}

      {menu && menuClip ? (
        <div
          className="vp-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 250) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { props.onSplit(); setMenu(null); }}>
            <Scissors size={13} /> Split at playhead <kbd>S</kbd>
          </button>
          <button type="button" onClick={() => { props.onDuplicate(menuClip.id); setMenu(null); }}>
            <Copy size={13} /> Duplicate <kbd>D</kbd>
          </button>
          <button type="button" onClick={() => { props.onToggleKeyframe(menuClip.id); setMenu(null); }}>
            <Diamond size={13} /> Keyframe at playhead <kbd>K</kbd>
          </button>
          <button type="button" onClick={() => { props.onRipple(menuClip.id); setMenu(null); }}>
            <Scissors size={13} /> Ripple trim to playhead
          </button>
          <hr />
          {TRANSITIONS.slice(0, 5).map((t) => (
            <button key={t.id} type="button" onClick={() => { props.onTransition(menuClip.id, t.id); setMenu(null); }}>
              <Sparkles size={13} /> {t.label}
            </button>
          ))}
          <button type="button" onClick={() => { props.onTransition(menuClip.id, null); setMenu(null); }}>
            <Sparkles size={13} /> Hard cut (no transition)
          </button>
          <hr />
          <button type="button" className="danger" onClick={() => { props.onDelete(menuClip.id); setMenu(null); }}>
            <Trash2 size={13} /> Delete clip <kbd>Del</kbd>
          </button>
        </div>
      ) : null}
      {drag ? <span style={{ display: 'none' }} aria-hidden="true" /> : null}
    </div>
  );
}
