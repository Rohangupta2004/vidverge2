/**
 * Short Video Enhancer — the NON-DESTRUCTIVE TIMELINE EDITOR.
 *
 * This is the primary surface of the editor. One track per band, in render
 * Z-order, every block draggable and trimmable:
 *
 *   HOOK          the opening 1-3 seconds, before or over clip 1
 *   CAPTIONS      word-by-word cue blocks
 *   GFX · FG      graphics in front of the presenter
 *   GFX · BG      graphics behind the presenter
 *   TRACKING      what is following the subject, and over what range
 *   TRANSITIONS   the granted overlap on each cut
 *   VIDEO         clip content spans, with trim handles on the in / out points
 *   SFX           the sound design track
 *   AUDIO         voice and music beds
 *
 * BEAT MARKERS are drawn on the AUDIO track when the music has been analysed,
 * so the creator can see the exact grid the pacing engine locked onto. They are
 * an editing guide, not a render layer: nothing in the composition reads them.
 *
 * Nothing here bakes anything. A drag edits the project document — the same
 * document the preview Player and the render service both read — so the picture
 * updates as the block moves and no effect is committed until the final render.
 *
 * Locked blocks refuse to move: the lock is the contract that a preset switch,
 * the pacing engine and a stray drag all have to honour.
 */

import { useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Lock, ZoomIn, ZoomOut } from 'lucide-react';
import {
  KEY_CHANNELS, graphicSpec, hookTemplateLabel, resolveBand, transitionSpec,
  type AudioTrack, type CompiledTimeline, type Project,
} from '../lib/model';
import { MONO, P, Panel, SectionHeader } from './controls';
import type { EditorActions, SelKind, Selection } from './panels';

type DragMode = 'move' | 'in' | 'out';

interface Block {
  id: string;
  kind: SelKind;
  start: number;
  end: number;
  label: string;
  color: string;
  locked: boolean;
  enabled: boolean;
  movable: boolean;
  trimmable: boolean;
  /** Rendered as a read-only strip — informational rows use this. */
  readOnly?: boolean;
}

interface Row {
  id: string;
  label: string;
  color: string;
  blocks: Block[];
  /** Rows the creator can collapse away when the stack gets tall. */
  hint?: string;
}

const ROW_H = 32;

function cueText(words: { text: string }[]): string {
  return words.map((w) => w.text).join(' ');
}

export function TimelineEditor({
  project, timeline, playheadS, zoom, onZoom, onSeek, selection, onSelect, actions, collapsed, onToggleCollapsed,
}: {
  project: Project;
  timeline: CompiledTimeline;
  playheadS: number;
  zoom: number;
  onZoom: (z: number) => void;
  onSeek: (s: number) => void;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  actions: EditorActions;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const duration = Math.max(1, timeline.durationS);
  const width = Math.max(320, duration * zoom);
  const secPerPx = 1 / Math.max(1, zoom);

  const drag = useRef<{ kind: SelKind; id: string; mode: DragMode; startX: number; applied: number; moved: boolean } | null>(null);
  // A drag ends in a click event too. Without this the click would re-seek the
  // playhead to the block's start the instant you finish moving it.
  const suppressClick = useRef(false);

  const rows: Row[] = useMemo(() => {
    const hook: Block[] = project.hook
      ? [{
          id: 'hook', kind: 'hook', start: 0, end: Math.max(0.2, project.hook.duration),
          label: hookTemplateLabel(project.hook.template) +
            (project.hook.leadIn > 0.01 ? ' \u00b7 before clip 1' : ' \u00b7 over clip 1'),
          color: P.accent, locked: !!project.hook.locked, enabled: project.hook.enabled,
          movable: false, trimmable: false, readOnly: true,
        }]
      : [];

    const captions: Block[] = project.captions.map((c) => ({
      id: c.id, kind: 'caption', start: c.start, end: c.end,
      label: cueText(c.words).slice(0, 20) || 'Empty cue',
      color: P.caption, locked: !!c.locked, enabled: c.enabled, movable: true, trimmable: true,
    }));

    const graphicBlock = (g: Project['graphics'][number]): Block => {
      const keys = KEY_CHANNELS.reduce((n, c) => n + (g.keys[c.id] || []).length, 0);
      return {
        id: g.id, kind: 'graphic', start: g.start, end: g.end,
        label: graphicSpec(g.type).label + (keys ? ' · ' + keys + 'k' : '') + (g.text ? ' · ' + g.text.split('|')[0] : ''),
        color: resolveBand(g, timeline) === 'background' ? P.gfxBg : P.gfxFg,
        locked: !!g.locked, enabled: g.enabled, movable: true, trimmable: true,
      };
    };
    const fg = project.graphics.filter((g) => resolveBand(g, timeline) === 'foreground').map(graphicBlock);
    const bg = project.graphics.filter((g) => resolveBand(g, timeline) === 'background').map(graphicBlock);

    const tracking: Block[] = [];
    for (const c of project.clips) {
      if (!c.subjectFx.enabled || c.subject.mode === 'off') continue;
      const span = timeline.contentSpans.find((s) => s.id === c.id);
      if (!span) continue;
      tracking.push({
        id: c.id, kind: 'clip', start: span.start, end: span.end,
        label: 'Subject · ' + (c.subject.source === 'none' ? 'not segmented' : c.subject.source) + ' [full]',
        color: P.video, locked: !!c.locked, enabled: c.enabled, movable: false, trimmable: false, readOnly: true,
      });
    }
    for (const g of project.graphics) {
      if (!g.track || g.track.target === 'none') continue;
      tracking.push({
        id: g.id, kind: 'graphic',
        start: g.track.from == null ? g.start : g.track.from,
        end: g.track.to == null ? g.end : g.track.to,
        label: (g.track.target === 'face' ? 'Face' : 'Product') + ' · ' + graphicSpec(g.type).label,
        color: P.gfxFg, locked: !!g.locked, enabled: g.enabled, movable: false, trimmable: false, readOnly: true,
      });
    }

    const transitions: Block[] = timeline.transitions.map((t) => {
      const source = project.transitions.find((x) => x.id === t.id);
      return {
        id: t.id, kind: 'transition',
        start: t.from / project.canvas.fps,
        end: (t.from + t.frames) / project.canvas.fps,
        label: transitionSpec(t.type).label + ' · ' + t.granted.toFixed(2) + 's',
        color: P.trans, locked: !!(source && source.locked), enabled: true, movable: false, trimmable: true,
      };
    });

    const video: Block[] = timeline.contentSpans.map((s) => {
      const clip = project.clips.find((c) => c.id === s.id);
      return {
        id: s.id, kind: 'clip', start: s.start, end: s.end,
        label: s.name.slice(0, 22),
        color: P.video, locked: !!(clip && clip.locked), enabled: !!(clip && clip.enabled),
        movable: false, trimmable: true,
      };
    });

    const sfx: Block[] = project.audio.sfx.map((a) => ({
      id: a.id, kind: 'audio', start: a.at,
      end: a.at + (a.duration > 0 ? a.duration : 0.35),
      label: a.label.slice(0, 16),
      color: P.audio, locked: !!a.locked, enabled: a.enabled, movable: true, trimmable: false,
    }));

    const beds = [project.audio.voice, project.audio.music].filter(Boolean) as AudioTrack[];
    const audio: Block[] = beds.map((a) => ({
      id: a.id, kind: 'audio', start: a.at, end: duration,
      label: a.kind + ' · ' + a.label.slice(0, 14),
      color: P.audio, locked: false, enabled: a.enabled, movable: true, trimmable: false,
    }));

    return [
      { id: 'hook', label: 'HOOK', color: P.accent, blocks: hook, hint: 'the opening — edit it in Properties' },
      { id: 'captions', label: 'CAPTIONS', color: P.caption, blocks: captions },
      { id: 'gfx-fg', label: 'GFX · FG', color: P.gfxFg, blocks: fg, hint: 'in front of the presenter' },
      { id: 'gfx-bg', label: 'GFX · BG', color: P.gfxBg, blocks: bg, hint: 'behind the presenter' },
      { id: 'tracking', label: 'TRACKING', color: P.video, blocks: tracking, hint: 'read-only — edit the range in Properties' },
      { id: 'transitions', label: 'TRANSITIONS', color: P.trans, blocks: transitions },
      { id: 'video', label: 'VIDEO', color: P.video, blocks: video },
      { id: 'sfx', label: 'SFX', color: P.audio, blocks: sfx, hint: 'drag a sound to any timestamp' },
      { id: 'audio', label: 'AUDIO', color: P.audio, blocks: audio, hint: 'voice and music beds' },
    ];
  }, [project, timeline, duration]);

  // Beat markers drawn on the music bed. At a glance this shows the exact grid
  // camera decisions and manual snap passes are using.
  const beatMarks = useMemo(() => {
    const times = project.beats.times.filter((t) => t >= 0 && t <= duration);
    // At a low zoom a marker every beat is a solid wall, so thin them out.
    const spacingPx = times.length > 1 ? ((times[1] - times[0]) / duration) * width : 999;
    const stride = spacingPx < 7 ? 4 : spacingPx < 14 ? 2 : 1;
    return times.filter((t, i) => i % stride === 0).map((t, i) => ({ t, strong: (i * stride) % 4 === 0 }));
  }, [project.beats.times, duration, width]);

  const seekFromEvent = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    onSeek((x / Math.max(1, rect.width)) * duration);
  };

  const startDrag = (e: ReactPointerEvent, block: Block, mode: DragMode) => {
    if (block.locked || block.readOnly) return;
    if (mode === 'move' && !block.movable) return;
    if (mode !== 'move' && !block.trimmable) return;
    e.stopPropagation();
    e.preventDefault();
    const node = e.currentTarget as HTMLElement;
    if (node.setPointerCapture) node.setPointerCapture(e.pointerId);
    drag.current = { kind: block.kind, id: block.id, mode, startX: e.clientX, applied: 0, moved: false };
    onSelect({ kind: block.kind, id: block.id });
  };

  // The project is the single source of truth, so a drag applies INCREMENTS
  // rather than absolute positions: the layer's own clamping then decides what
  // actually happened, and the block follows the project rather than the cursor.
  const moveDrag = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const total = (e.clientX - d.startX) * secPerPx;
    const step = total - d.applied;
    if (Math.abs(step) < 0.004) return;
    d.applied = total;
    d.moved = true;
    suppressClick.current = true;
    if (d.mode === 'move') actions.moveLayer(d.kind, d.id, step);
    else actions.trimLayer(d.kind, d.id, d.mode, step);
  };

  const endDrag = () => { drag.current = null; };

  const handle = (side: 'left' | 'right', block: Block) => (
    <div
      onPointerDown={(e) => startDrag(e, block, side === 'left' ? 'in' : 'out')}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title={side === 'left' ? 'Trim the start' : 'Trim the end'}
      style={{
        position: 'absolute', top: 0, bottom: 0, width: 7,
        [side]: 0,
        cursor: 'ew-resize',
        background: 'color-mix(in srgb, ' + block.color + ' 70%, transparent)',
        borderRadius: side === 'left' ? '5px 0 0 5px' : '0 5px 5px 0',
      } as CSSProperties}
    />
  );

  const ticks: number[] = [];
  const tickStep = zoom > 120 ? 0.5 : zoom > 60 ? 1 : zoom > 28 ? 2 : 5;
  for (let t = 0; t <= duration + 0.001; t += tickStep) ticks.push(Math.round(t * 100) / 100);

  const header = (
    <SectionHeader
      label={'Timeline · ' + duration.toFixed(2) + 's · ' + timeline.totalFrames + ' frames @ ' + project.canvas.fps + 'fps'}
      right={
        <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <button onClick={() => onZoom(Math.max(10, zoom / 1.4))} title="Zoom out"
            style={{ background: 'transparent', border: 'none', color: P.sub, cursor: 'pointer', display: 'flex' }}><ZoomOut size={13} /></button>
          <button onClick={() => onZoom(Math.min(400, zoom * 1.4))} title="Zoom in"
            style={{ background: 'transparent', border: 'none', color: P.sub, cursor: 'pointer', display: 'flex' }}><ZoomIn size={13} /></button>
          <button onClick={onToggleCollapsed} title={collapsed ? 'Show the tracks' : 'Collapse the tracks'}
            style={{ background: 'transparent', border: 'none', color: P.sub, cursor: 'pointer', display: 'flex' }}>
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </span>
      }
    />
  );

  if (collapsed) {
    return (
      <Panel style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, height: '100%' }}>
        {header}
        <div style={{ padding: '8px 12px', fontSize: 11, color: P.muted, lineHeight: 1.5 }}>
          {rows.filter((r) => r.blocks.length).map((r) => r.label + ' ' + r.blocks.length).join('  ·  ') || 'No layers yet.'}
        </div>
      </Panel>
    );
  }

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, height: '100%' }}>
      {header}
      <div style={{ display: 'flex', minHeight: 0, overflowY: 'auto' }}>
        <div style={{ width: 112, flexShrink: 0, borderRight: '1px solid ' + P.borderStrong, background: P.panelSoft, position: 'relative', zIndex: 8, boxShadow: '8px 0 18px rgba(0,0,0,.24)' }}>
          <div style={{ height: 18, borderBottom: '1px solid ' + P.borderStrong }} />
          {rows.map((r) => (
            <div key={r.id} title={r.hint} style={{ height: ROW_H, display: 'flex', alignItems: 'center', paddingLeft: 9, gap: 6, borderBottom: '1px solid ' + P.border }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: r.color }} />
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: P.muted }}>{r.label}</span>
              <span style={{ marginLeft: 'auto', marginRight: 7, fontSize: 9, color: P.muted, fontFamily: MONO }}>{r.blocks.length || ''}</span>
            </div>
          ))}
        </div>

        <div className="sve-scrollbar" style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 2 }}>
          <div style={{ width, position: 'relative' }}>
            <div style={{ height: 18, position: 'relative', borderBottom: '1px solid ' + P.borderStrong, cursor: 'pointer' }}
              onMouseDown={(e) => seekFromEvent(e.clientX, e.currentTarget)}>
              {ticks.map((t) => (
                <div key={t} style={{ position: 'absolute', left: (t / duration) * 100 + '%', top: 0, bottom: 0, borderLeft: '1px solid ' + P.border, paddingLeft: 3, fontSize: 8.5, color: P.muted, fontFamily: MONO }}>{t}s</div>
              ))}
              {beatMarks.map((b, i) => (
                <div key={'bt' + i} style={{
                  position: 'absolute', left: (b.t / duration) * 100 + '%', bottom: 0,
                  width: b.strong ? 2 : 1, height: b.strong ? 9 : 5,
                  background: P.audio, opacity: b.strong ? 0.95 : 0.6, pointerEvents: 'none',
                }} />
              ))}
            </div>

            {rows.map((r) => (
              <div key={r.id} style={{ height: ROW_H, position: 'relative', borderBottom: '1px solid ' + P.border }}
                onMouseDown={(e) => { if (e.target === e.currentTarget) seekFromEvent(e.clientX, e.currentTarget); }}>
                {r.id === 'audio' ? beatMarks.map((beat, index) => (
                  <div key={'audio-beat-' + index} title={'Music beat · ' + beat.t.toFixed(2) + 's'} style={{
                    position: 'absolute', top: 2, bottom: 2,
                    left: (beat.t / duration) * 100 + '%',
                    width: beat.strong ? 2 : 1,
                    background: P.audio,
                    opacity: beat.strong ? 0.88 : 0.48,
                    boxShadow: beat.strong ? '0 0 7px ' + P.audio : 'none',
                    pointerEvents: 'none', zIndex: 2,
                  }} />
                )) : null}
                {r.blocks.map((b) => {
                  const left = (Math.max(0, b.start) / duration) * 100;
                  const w = (Math.max(0.04, Math.min(duration, b.end) - Math.max(0, b.start)) / duration) * 100;
                  const active = !!selection && selection.kind === b.kind && selection.id === b.id;
                  return (
                    <div key={r.id + b.id}
                      onPointerDown={(e) => startDrag(e, b, 'move')}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onClick={() => {
                        if (suppressClick.current) { suppressClick.current = false; return; }
                        onSelect({ kind: b.kind, id: b.id });
                        onSeek(b.start);
                      }}
                      title={b.label + ' · ' + b.start.toFixed(2) + 's → ' + b.end.toFixed(2) + 's' +
                        (b.locked ? ' · locked' : b.movable ? ' · drag to move, drag an edge to trim' : b.trimmable ? ' · drag an edge to trim' : '')}
                      style={{
                        position: 'absolute', left: left + '%', width: w + '%', top: 4, bottom: 4,
                        background: 'linear-gradient(180deg, color-mix(in srgb, ' + b.color + ' ' + (active ? '58%' : '36%') + ', transparent), color-mix(in srgb, ' + b.color + ' ' + (active ? '38%' : '22%') + ', transparent))',
                        border: '1px ' + (b.locked ? 'dashed' : 'solid') + ' color-mix(in srgb, ' + b.color + ' ' + (active ? '100%' : '68%') + ', transparent)',
                        boxShadow: active ? '0 0 0 1px color-mix(in srgb, ' + b.color + ' 44%, transparent), 0 3px 10px rgba(0,0,0,.26)' : '0 2px 7px rgba(0,0,0,.2)',
                        borderRadius: 5, overflow: 'hidden',
                        cursor: b.locked || b.readOnly ? 'pointer' : b.movable ? 'grab' : 'default',
                        opacity: b.enabled ? 1 : 0.42,
                        display: 'flex', alignItems: 'center', gap: 4, paddingLeft: b.trimmable && !b.locked ? 10 : 5, paddingRight: 5,
                        fontSize: 9.5, color: P.text, whiteSpace: 'nowrap',
                        touchAction: 'none',
                      }}>
                      {b.locked ? <Lock size={9} color={P.muted} /> : null}
                      {b.readOnly ? <Crosshair size={9} color={P.muted} /> : null}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
                      {b.trimmable && !b.locked ? handle('left', b) : null}
                      {b.trimmable && !b.locked ? handle('right', b) : null}
                    </div>
                  );
                })}
              </div>
            ))}

            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: (Math.max(0, Math.min(duration, playheadS)) / duration) * 100 + '%',
              width: 2, background: P.accent, boxShadow: '0 0 8px ' + P.accent + ', 0 0 0 1px rgba(0,0,0,.35)', pointerEvents: 'none', zIndex: 6,
            }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: '1px solid ' + P.border, fontSize: 10.5, color: P.muted, flexWrap: 'wrap' }}>
        <span>Drag a block to move it, drag an edge to trim.</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Lock size={10} /> locked blocks refuse to move</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Crosshair size={10} /> tracking is read-only here</span>
        {beatMarks.length ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 2, height: 10, background: P.audio, opacity: 0.8 }} />
            {project.beats.bpm.toFixed(0)} BPM beat markers — every fourth is the downbeat
          </span>
        ) : null}
        <span>Nothing is baked until the final render.</span>
      </div>
    </Panel>
  );
}
