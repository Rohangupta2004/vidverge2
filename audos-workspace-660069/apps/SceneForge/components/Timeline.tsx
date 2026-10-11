// The editor's time ruler and layer tracks.
//
// Everything here is TIME based: a clip's left edge is its start second and
// its width is its duration, both read straight off the edit manifest. There
// is no frame list and no JSON timeline — dragging a clip changes a number of
// seconds, which is exactly what the server compositor is given at export.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pause, Play, SkipBack } from 'lucide-react';
import { formatClock } from '../lib/motionEditor';

export interface TimelineClip {
  id: string;
  label: string;
  start: number;
  duration: number;
  hidden?: boolean;
  /** Clips that have no independent timing (the base video) cannot be dragged. */
  locked?: boolean;
}

export interface TimelineTrack {
  id: string;
  label: string;
  /** A concrete colour so each track reads at a glance on the dark canvas. */
  color: string;
  clips: TimelineClip[];
}

const FRAME_SEC = 1 / 30;

export default function Timeline(props: {
  duration: number;
  currentTime: number;
  playing: boolean;
  tracks: TimelineTrack[];
  selectedId: string;
  onSeek: (seconds: number) => void;
  onSelect: (id: string) => void;
  onTogglePlay: () => void;
  onChangeClip: (id: string, patch: { start?: number; duration?: number }) => void;
  onToggleHidden: (id: string) => void;
}) {
  const { duration, currentTime, playing, tracks, selectedId, onSeek, onSelect, onTogglePlay, onChangeClip, onToggleHidden } = props;
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [laneWidth, setLaneWidth] = useState(0);
  const drag = useRef<{ id: string; mode: 'move' | 'start' | 'end'; originX: number; start: number; duration: number } | null>(null);
  const span = Math.max(1, duration || 1);

  useLayoutEffect(() => {
    const element = laneRef.current;
    if (!element) return;
    const measure = () => setLaneWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const secondsPerPixel = laneWidth > 0 ? span / laneWidth : 0;
  const pct = (seconds: number) => `${Math.max(0, Math.min(100, (seconds / span) * 100))}%`;

  const seekFromEvent = useCallback((clientX: number) => {
    const element = laneRef.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const ratio = (clientX - box.left) / Math.max(1, box.width);
    onSeek(Math.max(0, Math.min(span, ratio * span)));
  }, [onSeek, span]);

  // The drag listeners live on the window so a fast gesture that leaves the
  // clip (or the lane) still tracks instead of dropping the layer mid-move.
  useEffect(() => {
    if (!secondsPerPixel) return;
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      const deltaSec = (event.clientX - active.originX) * secondsPerPixel;
      if (active.mode === 'move') {
        const start = Math.max(0, Math.min(span - 0.2, active.start + deltaSec));
        onChangeClip(active.id, { start: Math.round(start * 100) / 100 });
      } else if (active.mode === 'start') {
        const start = Math.max(0, Math.min(active.start + active.duration - 0.2, active.start + deltaSec));
        onChangeClip(active.id, { start: Math.round(start * 100) / 100, duration: Math.round((active.duration - (start - active.start)) * 100) / 100 });
      } else {
        const next = Math.max(0.2, Math.min(span - active.start, active.duration + deltaSec));
        onChangeClip(active.id, { duration: Math.round(next * 100) / 100 });
      }
    };
    const up = () => { drag.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onChangeClip, secondsPerPixel, span]);

  const ticks: number[] = [];
  const stepSec = span <= 12 ? 1 : span <= 40 ? 5 : span <= 120 ? 10 : 30;
  for (let t = 0; t <= span + 0.001; t += stepSec) ticks.push(Math.round(t));

  return <section className="border-t border-[var(--space-border-strong)] bg-[color-mix(in_srgb,#FFFFFF_88%,transparent)]">
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <button type="button" onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#E8B737,#C8920A)] text-white shadow-[0_4px_14px_rgba(200,146,10,.35)]">
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button type="button" onClick={() => onSeek(0)} aria-label="Back to start" className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--space-border-default)] text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"><SkipBack className="h-4 w-4" /></button>
      <button type="button" onClick={() => onSeek(Math.max(0, currentTime - FRAME_SEC))} aria-label="Previous frame" className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--space-border-default)] text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"><ChevronLeft className="h-4 w-4" /></button>
      <button type="button" onClick={() => onSeek(Math.min(span, currentTime + FRAME_SEC))} aria-label="Next frame" className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--space-border-default)] text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"><ChevronRight className="h-4 w-4" /></button>
      <span className="ml-1 font-mono text-xs text-[var(--space-text-secondary)]">{formatClock(currentTime)} <span className="text-[var(--space-text-muted)]">/ {formatClock(span)}</span></span>
      <span className="ml-auto text-[11px] text-[var(--space-text-muted)]">Drag a clip to move it · drag its edge to retime · ←/→ steps one frame</span>
    </div>

    <div className="px-4 pb-4">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={Math.round(currentTime)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); onSeek(Math.max(0, currentTime - FRAME_SEC)); }
          if (event.key === 'ArrowRight') { event.preventDefault(); onSeek(Math.min(span, currentTime + FRAME_SEC)); }
        }}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seekFromEvent(event.clientX); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromEvent(event.clientX); }}
        className="relative h-7 cursor-ew-resize select-none rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C8920A]">
        {ticks.map((tick) => <span key={tick} className="absolute top-0 h-full border-l border-[color-mix(in_srgb,#B4780A_16%,transparent)] pl-1 text-[9px] leading-7 text-[var(--space-text-muted)]" style={{ left: pct(tick) }}>{tick}s</span>)}
        <span className="pointer-events-none absolute -top-0.5 z-10 h-8 w-0.5 bg-[#C8920A] shadow-[0_0_10px_rgba(200,146,10,.6)]" style={{ left: pct(currentTime) }} />
      </div>

      <div className="relative mt-2 space-y-1.5">
        {/* Measured separately from the label column so a pixel of drag is
            the same number of seconds in every lane. */}
        <div ref={laneRef} className="pointer-events-none absolute bottom-0 left-[7.5rem] right-0 top-0">
          <span className="absolute inset-y-0 z-10 w-0.5 bg-[#C8920A]/70" style={{ left: pct(currentTime) }} />
        </div>
        {tracks.map((track) => <div key={track.id} className="flex items-stretch gap-2">
          <span className="w-28 shrink-0 self-center truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">{track.label}</span>
          <div className="relative h-9 flex-1 rounded-lg border border-[var(--space-border-default)] bg-[color-mix(in_srgb,#B4780A_5%,transparent)]">
            {track.clips.map((clip) => {
              const selected = clip.id === selectedId;
              const width = `${Math.max(1.4, Math.min(100, (Math.max(0.2, clip.duration) / span) * 100))}%`;
              return <div key={clip.id}
                onPointerDown={(event) => {
                  onSelect(clip.id);
                  if (clip.locked) return;
                  drag.current = { id: clip.id, mode: 'move', originX: event.clientX, start: clip.start, duration: clip.duration };
                }}
                className={`group absolute top-1 flex h-7 items-center overflow-hidden rounded-md border px-1.5 text-[11px] font-medium ${clip.locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} ${selected ? 'border-[#1A1000]/70 shadow-[0_0_0_2px_rgba(26,16,0,.22)]' : 'border-transparent'} ${clip.hidden ? 'opacity-40' : ''}`}
                style={{ left: pct(clip.start), width, background: track.color }}>
                {clip.locked ? null : <span onPointerDown={(event) => { event.stopPropagation(); onSelect(clip.id); drag.current = { id: clip.id, mode: 'start', originX: event.clientX, start: clip.start, duration: clip.duration }; }}
                  className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 opacity-0 group-hover:opacity-100" />}
                <span className="truncate text-white drop-shadow">{clip.label}</span>
                {clip.locked ? null : <>
                  <button type="button" aria-label={clip.hidden ? 'Show layer' : 'Hide layer'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onToggleHidden(clip.id); }}
                    className="ml-auto hidden shrink-0 rounded p-0.5 text-white/90 hover:bg-black/30 group-hover:block">
                    {clip.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <span onPointerDown={(event) => { event.stopPropagation(); onSelect(clip.id); drag.current = { id: clip.id, mode: 'end', originX: event.clientX, start: clip.start, duration: clip.duration }; }}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 opacity-0 group-hover:opacity-100" />
                </>}
              </div>;
            })}
            {!track.clips.length ? <span className="absolute inset-0 flex items-center pl-2 text-[11px] text-[var(--space-text-muted)]">Empty</span> : null}
          </div>
        </div>)}
      </div>
    </div>
  </section>;
}
