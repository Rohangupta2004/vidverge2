/**
 * Short Video Enhancer — the editor panels.
 *
 *   LayerPanel      the non-destructive layer stack, in render Z-order
 *   PropertiesPanel every channel of whatever is selected
 *   QcPanel         the pre-render gate's verdict, with the fix for each failure
 *
 * The timeline editor lives in ./timeline.tsx — it is the primary editing
 * surface now, so it earned its own file.
 *
 * These panels only ever describe and edit the project document. They never
 * draw video or motion themselves — the preview is the real composition in a
 * Remotion Player, so there is no second implementation to drift.
 */

import type { ReactNode } from 'react';
import {
  AlertTriangle, ArrowRightLeft, Camera, CheckCircle2, ChevronDown, ChevronUp,
  Crosshair, Film, Layers, Music, PanelRightClose, Plus, ScanFace, Shapes, Trash2, Type, Wand2, Waves, XCircle, Zap,
} from 'lucide-react';

import {
  CAMERAS, CANVAS_H, CANVAS_W, CAPTION_ANIMS, CAPTION_STYLES, EASINGS, FONTS, GRADES,
  GRAPHICS, GRAPHIC_BANDS, HOOK_TEMPLATES, ICONS, MIN_CAMERA_BLEND, SAFE_MARGIN,
  SUBJECT_SHAPES, TRACK_TARGETS, TRANSITIONS,
  audioTracks, cameraBlend, cameraSpec, clipContentDuration, formatTime,
  graphicSpec, handleIn, handleOut, hookTemplateLabel, isParticleType, resolveBand, transitionSpec,
  type AudioTrack, type BeatState, type CameraSegment, type CaptionAnimId, type CaptionCue, type CaptionStyleId,
  type CaptionWord, type Clip, type CompiledTimeline, type EasingId, type FontId, type GradeId,
  type GraphicBand, type GraphicLayer, type GraphicType, type HookState, type HookTemplateId,
  type IconId, type Project,
  type SubjectFx, type SubjectShape, type SubjectState, type TrackTarget, type TransitionId,
  type TransitionInstance,
} from '../lib/model';
import { hookSummary } from '../lib/hookTemplates';
import { sfxSpec } from '../lib/sfx';
import type { QcReport } from '../lib/qc';
import { Btn, ColorRow, Empty, LayerControls, NumberRow, P, Panel, Pill, RampRow, SectionHeader, SelectRow, TextRow, Toggle, MONO } from './controls';
import { KeyframePanel, type KeyframeClipboard } from './keyframes';

export type SelKind = 'clip' | 'transition' | 'caption' | 'graphic' | 'audio' | 'hook';
export interface Selection { kind: SelKind; id: string }

/** The hook is a singleton layer, so it always selects under this id. */
export const HOOK_SELECTION: Selection = { kind: 'hook', id: 'hook' };

export interface EditorActions {
  updateClip: (id: string, patch: Partial<Clip>) => void;
  updateTransition: (id: string, patch: Partial<TransitionInstance>) => void;
  updateCaption: (id: string, patch: Partial<CaptionCue>) => void;
  updateWord: (cueId: string, index: number, patch: Partial<CaptionWord>) => void;
  setCueText: (cueId: string, text: string) => void;
  updateGraphic: (id: string, patch: Partial<GraphicLayer>) => void;
  updateAudio: (id: string, patch: Partial<AudioTrack>) => void;
  remove: (kind: SelKind, id: string) => void;
  analyseClip: (id: string) => void;
  addCamera: (clipId: string) => void;
  updateCamera: (clipId: string, segId: string, patch: Partial<CameraSegment>) => void;
  removeCamera: (clipId: string, segId: string) => void;
  seek: (seconds: number) => void;
  analysing: string | null;
  // --- Phase 4: the timeline editor's verbs ------------------------------
  /** Shift a whole layer by a delta in seconds (ignored when locked). */
  moveLayer: (kind: SelKind, id: string, deltaSeconds: number) => void;
  /** Drag one edge of a layer by a delta in seconds (ignored when locked). */
  trimLayer: (kind: SelKind, id: string, edge: 'in' | 'out', deltaSeconds: number) => void;
  toggleLock: (kind: SelKind, id: string) => void;
  /** Reorder a clip in the VIDEO layer; -1 is earlier, 1 is later. */
  moveClip: (id: string, direction: -1 | 1) => void;
  // --- Phase 3: subject segmentation ------------------------------------
  segmentClip: (id: string) => void;
  segmenting: string | null;
  updateSubject: (clipId: string, patch: Partial<SubjectState>) => void;
  updateSubjectFx: (clipId: string, patch: Partial<SubjectFx>) => void;
  // --- Phase 4: keyframes -----------------------------------------------
  /** Where the playhead is, so a keyframe can be added at it. */
  playhead: number;
  keyClipboard: KeyframeClipboard | null;
  copyKeys: (clipboard: KeyframeClipboard) => void;
  // --- Phase 2: hook, sound design and beat sync -------------------------
  /** Put a hook on the project (or swap the template). */
  addHook: (template: HookTemplateId) => void;
  /**
   * Patch the hook. Changing the lead-in moves every absolute-timed layer by
   * the same amount, so the edit stays in sync behind it.
   */
  updateHook: (patch: Partial<HookState>) => void;
  removeHook: () => void;
  /** Change the beat grid's own settings (master sync switch, tolerance). */
  updateBeats: (patch: Partial<BeatState>) => void;
}

const asOptions = <T extends string>(list: { id: T; label: string }[]) => list.map((i) => ({ id: i.id, label: i.label }));

function cueText(cue: CaptionCue): string {
  return cue.words.map((w) => w.text).join(' ');
}

// ---------------------------------------------------------------------------
// Layer panel
// ---------------------------------------------------------------------------

function LayerRow({ label, sub, color, active, enabled, locked, onSelect, onToggle, onDelete, onLock, extra }: {
  label: string; sub?: string; color: string; active: boolean; enabled: boolean; locked?: boolean;
  onSelect: () => void; onToggle?: () => void; onDelete?: () => void; onLock?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '7px 10px',
      background: active ? P.accentSoft : 'transparent',
      borderLeft: '3px solid ' + (active ? P.accent : 'transparent'),
      cursor: 'pointer',
    }} onClick={onSelect}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0, opacity: enabled ? 1 : 0.3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: enabled ? P.text : P.muted, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        {sub ? <div style={{ fontSize: 10.5, color: P.muted, fontFamily: MONO, marginTop: 1 }}>{sub}</div> : null}
      </div>
      {extra}
      <LayerControls locked={!!locked} enabled={enabled} onLock={onLock} onToggle={onToggle} onDelete={onDelete} />
    </div>
  );
}

function ReorderButtons({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  const btn = { background: 'transparent', border: 'none', color: P.muted, cursor: 'pointer', padding: 0, display: 'flex' } as const;
  return (
    <span style={{ display: 'flex', flexDirection: 'column' }}>
      <button title="Move this clip earlier" onClick={(e) => { e.stopPropagation(); onUp(); }} style={btn}><ChevronUp size={11} /></button>
      <button title="Move this clip later" onClick={(e) => { e.stopPropagation(); onDown(); }} style={btn}><ChevronDown size={11} /></button>
    </span>
  );
}

export function LayerPanel({ project, timeline, selection, onSelect, actions }: {
  project: Project; timeline: CompiledTimeline; selection: Selection | null;
  onSelect: (s: Selection) => void; actions: EditorActions;
}) {
  const is = (kind: SelKind, id: string) => !!selection && selection.kind === kind && selection.id === id;
  // Grouped by the band the compositor will ACTUALLY use, so an Auto layer
  // appears where it is going to be drawn rather than in a third list.
  const bg = project.graphics.filter((g) => resolveBand(g, timeline) === 'background');
  const fg = project.graphics.filter((g) => resolveBand(g, timeline) === 'foreground');
  const beds = [project.audio.voice, project.audio.music].filter(Boolean) as AudioTrack[];
  const sfx = project.audio.sfx;
  const hook = project.hook;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
      <Panel>
        <SectionHeader icon={<Zap size={12} />} label="Hook" color={P.accent}
          right={<span style={{ color: P.muted, fontWeight: 600 }}>{hook && hook.enabled ? '1' : '0'}</span>} />
        {hook ? (
          <LayerRow color={P.accent} enabled={hook.enabled} locked={hook.locked}
            active={!!selection && selection.kind === 'hook'}
            label={hookTemplateLabel(hook.template) + ' \u00b7 ' + (hook.template === 'number' ? hook.currency + hook.value : hook.text).slice(0, 26)}
            sub={'0:00.0 \u2192 ' + formatTime(hook.duration) + (hook.leadIn > 0.01 ? '  \u00b7  before clip 1' : '  \u00b7  over clip 1')}
            onSelect={() => { onSelect(HOOK_SELECTION); actions.seek(0); }}
            onToggle={() => actions.updateHook({ enabled: !hook.enabled })}
            onLock={() => actions.updateHook({ locked: !hook.locked })}
            onDelete={() => actions.removeHook()} />
        ) : (
          <div style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 11.5, color: P.muted, lineHeight: 1.5, marginBottom: 8 }}>
              No opening hook. The first one to three seconds decide whether the rest is watched — pick a template and it
              becomes the first layer on the timeline.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {HOOK_TEMPLATES.map((h) => (
                <Btn key={h.id} onClick={() => actions.addHook(h.id)} title={h.blurb}>{h.label}</Btn>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <SectionHeader icon={<Type size={12} />} label="Captions" color={P.caption} right={<span style={{ color: P.muted, fontWeight: 600 }}>{project.captions.length}</span>} />
        {project.captions.length ? project.captions.map((c) => (
          <LayerRow key={c.id} color={P.caption} enabled={c.enabled} locked={c.locked} active={is('caption', c.id)}
            label={cueText(c).slice(0, 34) || 'Empty cue'}
            sub={formatTime(c.start) + ' → ' + formatTime(c.end) + '  ·  ' + c.words.length + 'w'}
            onSelect={() => { onSelect({ kind: 'caption', id: c.id }); actions.seek(c.start); }}
            onToggle={() => actions.updateCaption(c.id, { enabled: !c.enabled })}
            onLock={() => actions.toggleLock('caption', c.id)}
            onDelete={() => actions.remove('caption', c.id)} />
        )) : <Empty>No caption cues. Apply a preset after transcribing, or add one from the toolbar.</Empty>}
      </Panel>

      <Panel>
        <SectionHeader icon={<Shapes size={12} />} label="Motion graphics" color={P.gfxFg} right={<span style={{ color: P.muted, fontWeight: 600 }}>{project.graphics.length}</span>} />
        {fg.length ? (
          <div style={{ fontSize: 9.5, color: P.muted, padding: '6px 10px 2px', letterSpacing: 0.8, fontWeight: 800 }}>FOREGROUND</div>
        ) : null}
        {fg.map((g) => (
          <LayerRow key={g.id} color={P.gfxFg} enabled={g.enabled} locked={g.locked} active={is('graphic', g.id)}
            label={graphicSpec(g.type).label + (g.text ? ' · ' + g.text.split('|')[0] : '')}
            sub={formatTime(g.start) + ' → ' + formatTime(g.end) + (g.band === 'auto' ? '  ·  auto' : '')}
            extra={g.track.target !== 'none' ? <Crosshair size={11} color={P.gfxFg} /> : undefined}
            onSelect={() => { onSelect({ kind: 'graphic', id: g.id }); actions.seek(g.start); }}
            onToggle={() => actions.updateGraphic(g.id, { enabled: !g.enabled })}
            onLock={() => actions.toggleLock('graphic', g.id)}
            onDelete={() => actions.remove('graphic', g.id)} />
        ))}
        {bg.length ? (
          <div style={{ fontSize: 9.5, color: P.muted, padding: '6px 10px 2px', letterSpacing: 0.8, fontWeight: 800 }}>BACKGROUND</div>
        ) : null}
        {bg.map((g) => (
          <LayerRow key={g.id} color={P.gfxBg} enabled={g.enabled} locked={g.locked} active={is('graphic', g.id)}
            label={graphicSpec(g.type).label + (g.text ? ' · ' + g.text.split('|')[0] : '')}
            sub={formatTime(g.start) + ' → ' + formatTime(g.end) + (g.band === 'auto' ? '  ·  auto' : '')}
            extra={g.track.target !== 'none' ? <Crosshair size={11} color={P.gfxBg} /> : undefined}
            onSelect={() => { onSelect({ kind: 'graphic', id: g.id }); actions.seek(g.start); }}
            onToggle={() => actions.updateGraphic(g.id, { enabled: !g.enabled })}
            onLock={() => actions.toggleLock('graphic', g.id)}
            onDelete={() => actions.remove('graphic', g.id)} />
        ))}
        {!project.graphics.length ? <Empty>No motion graphics yet. Add one from the toolbar — arrows, circles, callouts, UI cards and the rest.</Empty> : null}
      </Panel>

      <Panel>
        <SectionHeader icon={<ArrowRightLeft size={12} />} label="Transitions" color={P.trans} right={<span style={{ color: P.muted, fontWeight: 600 }}>{project.transitions.length}</span>} />
        {project.transitions.length ? project.transitions.map((t) => {
          const placed = timeline.transitions.find((p) => p.id === t.id);
          const after = project.clips.find((c) => c.id === t.afterClipId);
          return (
            <LayerRow key={t.id} color={P.trans} enabled={t.enabled} locked={t.locked} active={is('transition', t.id)}
              label={transitionSpec(t.type).label + ' · after ' + (after ? after.name.slice(0, 16) : 'clip')}
              sub={placed ? placed.granted.toFixed(2) + 's of ' + t.duration.toFixed(2) + 's requested' : 'no footage — playing as a cut'}
              onSelect={() => { onSelect({ kind: 'transition', id: t.id }); if (placed) actions.seek(placed.from / project.canvas.fps); }}
              onToggle={() => actions.updateTransition(t.id, { enabled: !t.enabled })}
              onLock={() => actions.toggleLock('transition', t.id)}
              onDelete={() => actions.remove('transition', t.id)} />
          );
        }) : <Empty>Transitions appear here once there are two or more clips.</Empty>}
      </Panel>

      <Panel>
        <SectionHeader icon={<Film size={12} />} label="Video" color={P.video} right={<span style={{ color: P.muted, fontWeight: 600 }}>{project.clips.length}</span>} />
        {project.clips.length ? project.clips.map((c) => (
          <LayerRow key={c.id} color={P.video} enabled={c.enabled} locked={c.locked} active={is('clip', c.id)}
            label={c.name}
            sub={c.srcW + '×' + c.srcH + '  ·  ' + clipContentDuration(c).toFixed(2) + 's  ·  ' + c.camera.length + ' angle' +
              (c.camera.length === 1 ? '' : 's') + (c.subjectFx.enabled ? '  ·  depth' : '')}
            extra={project.clips.length > 1
              ? <ReorderButtons onUp={() => actions.moveClip(c.id, -1)} onDown={() => actions.moveClip(c.id, 1)} />
              : undefined}
            onSelect={() => onSelect({ kind: 'clip', id: c.id })}
            onToggle={() => actions.updateClip(c.id, { enabled: !c.enabled })}
            onLock={() => actions.toggleLock('clip', c.id)}
            onDelete={() => actions.remove('clip', c.id)} />
        )) : <Empty>Drop a clip on the preview to start.</Empty>}
      </Panel>

      <Panel>
        <SectionHeader icon={<Waves size={12} />} label="Audio SFX" color={P.audio} right={<span style={{ color: P.muted, fontWeight: 600 }}>{sfx.length}</span>} />
        {sfx.length ? sfx.map((a) => (
          <LayerRow key={a.id} color={P.audio} enabled={a.enabled} locked={a.locked} active={is('audio', a.id)}
            label={a.label}
            sub={formatTime(a.at) + '  \u00b7  ' + (a.duration ? a.duration.toFixed(2) + 's' : 'full') + '  \u00b7  vol ' + Math.round(a.volume * 100) + '%'}
            onSelect={() => { onSelect({ kind: 'audio', id: a.id }); actions.seek(a.at); }}
            onToggle={() => actions.updateAudio(a.id, { enabled: !a.enabled })}
            onLock={() => actions.updateAudio(a.id, { locked: !a.locked })}
            onDelete={() => actions.remove('audio', a.id)} />
        )) : (
          <Empty>
            The SFX track is empty. Open Sound in the toolbar to drop a whoosh, pop, impact or riser at the playhead, or let
            auto-align put one under every transition, text animation and graphic entry.
          </Empty>
        )}
      </Panel>

      <Panel>
        <SectionHeader icon={<Music size={12} />} label="Audio beds" color={P.audio} right={<span style={{ color: P.muted, fontWeight: 600 }}>{beds.length}</span>} />
        {beds.length ? beds.map((a) => (
          <LayerRow key={a.id} color={P.audio} enabled={a.enabled} active={is('audio', a.id)}
            label={a.kind.toUpperCase() + ' · ' + a.label}
            sub={'from ' + formatTime(a.at) + '  ·  vol ' + Math.round(a.volume * 100) + '%' +
              (a.kind === 'music' && project.beats.times.length ? '  \u00b7  ' + project.beats.bpm.toFixed(0) + ' BPM' : '')}
            onSelect={() => onSelect({ kind: 'audio', id: a.id })}
            onToggle={() => actions.updateAudio(a.id, { enabled: !a.enabled })}
            onDelete={() => actions.remove('audio', a.id)} />
        )) : <Empty>Clip audio plays with each clip. Add a voice or music track from the toolbar.</Empty>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

function ClipProps({ clip, actions }: { clip: Clip; actions: EditorActions }) {
  const busy = actions.analysing === clip.id;
  return (
    <div style={{ padding: 12 }}>
      <TextRow label="Name" value={clip.name} onChange={(v) => actions.updateClip(clip.id, { name: v })} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 11 }}>
        <Pill color={P.video}>{clip.srcW + '×' + clip.srcH}</Pill>
        <Pill color={P.video}>{clip.srcW / Math.max(1, clip.srcH) > 1.08 ? 'landscape source' : clip.srcW / Math.max(1, clip.srcH) < 0.92 ? 'portrait source' : 'square source'}</Pill>
      </div>
      <NumberRow label="In point" value={clip.in} min={0} max={Math.max(0.1, clip.out - 0.1)} step={0.01} suffix="s"
        onChange={(v) => actions.updateClip(clip.id, { in: Math.min(v, clip.out - 0.1) })} />
      <NumberRow label="Out point" value={clip.out} min={clip.in + 0.1} max={clip.srcDuration} step={0.01} suffix="s"
        onChange={(v) => actions.updateClip(clip.id, { out: Math.max(v, clip.in + 0.1) })} />
      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, marginBottom: 12 }}>
        Transition handles: <b style={{ color: P.sub }}>{handleIn(clip).toFixed(2)}s</b> before the in point,{' '}
        <b style={{ color: P.sub }}>{handleOut(clip).toFixed(2)}s</b> after the out point. Transitions are paid for out of
        these, never out of your kept content.
      </div>
      <NumberRow label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} suffix="×"
        onChange={(v) => actions.updateClip(clip.id, { speed: v })} />
      <NumberRow label="Clip volume" value={Math.round(clip.volume * 100)} min={0} max={100} step={1} suffix="%"
        onChange={(v) => actions.updateClip(clip.id, { volume: v / 100 })} />
      <Toggle label="Mute this clip" value={clip.muted} onChange={(v) => actions.updateClip(clip.id, { muted: v })} />
      <SelectRow label="Colour grade" value={clip.grade} options={asOptions<GradeId>(GRADES)}
        onChange={(v) => actions.updateClip(clip.id, { grade: v })} />

      <div style={{ height: 1, background: P.border, margin: '6px 0 14px' }} />
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: P.sub, textTransform: 'uppercase', marginBottom: 9 }}>Reframe to 9:16</div>
      <SelectRow label="Mode" value={clip.reframe.mode}
        options={[{ id: 'auto' as const, label: 'Auto — follow the subject' }, { id: 'center' as const, label: 'Centre' }, { id: 'manual' as const, label: 'Manual anchor' }]}
        onChange={(v) => actions.updateClip(clip.id, { reframe: { ...clip.reframe, mode: v } })}
        hint="Always an intelligent cover crop — the picture is never stretched to fit." />
      {clip.reframe.mode === 'manual' ? (
        <>
          <NumberRow label="Anchor X" value={clip.reframe.x} min={0.08} max={0.92} step={0.01}
            onChange={(v) => actions.updateClip(clip.id, { reframe: { ...clip.reframe, x: v } })} />
          <NumberRow label="Anchor Y" value={clip.reframe.y} min={0.08} max={0.92} step={0.01}
            onChange={(v) => actions.updateClip(clip.id, { reframe: { ...clip.reframe, y: v } })} />
        </>
      ) : null}
      <div style={{ marginBottom: 12 }}>
        <Btn tone="soft" onClick={() => actions.analyseClip(clip.id)} disabled={busy}>
          <Wand2 size={13} /> {busy ? 'Tracking the subject…' : 'Analyse subject'}
        </Btn>
        <div style={{ fontSize: 11, color: P.muted, marginTop: 6, lineHeight: 1.5 }}>
          {clip.reframe.focus.length
            ? clip.reframe.focus.length + ' tracked points (' + clip.reframe.source + ', confidence ' + Math.round(clip.reframe.confidence * 100) + '%). The crop and every camera move follow this path.'
            : 'No subject track yet — the crop uses the anchor above.'}
        </div>
      </div>

      <div style={{ height: 1, background: P.border, margin: '6px 0 12px' }} />
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 9 }}>
        <div style={{ flex: 1, fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: P.sub, textTransform: 'uppercase' }}>Camera angles</div>
        <Btn onClick={() => actions.addCamera(clip.id)}><Plus size={12} /> Add</Btn>
      </div>
      {clip.camera.length ? clip.camera.map((seg) => (
        <div key={seg.id} style={{ background: P.card, border: '1px solid ' + P.border, borderRadius: 10, padding: 9, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
            <Camera size={12} color={P.video} />
            <span style={{ flex: 1, fontSize: 11.5, color: P.text, fontWeight: 700 }}>{cameraSpec(seg.angle).label}</span>
            <span style={{ fontSize: 10, color: P.muted, fontFamily: MONO }}>{cameraSpec(seg.angle).zoom.toFixed(2)}×</span>
            <button onClick={() => actions.removeCamera(clip.id, seg.id)} style={{ background: 'transparent', border: 'none', color: P.muted, cursor: 'pointer', display: 'flex' }}><Trash2 size={12} /></button>
          </div>
          <select value={seg.angle} onChange={(e) => actions.updateCamera(clip.id, seg.id, { angle: e.target.value as CameraSegment['angle'] })}
            style={{ width: '100%', background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 7, color: P.text, fontSize: 11.5, padding: '5px 7px', marginBottom: 7 }}>
            {CAMERAS.map((c) => <option key={c.id} value={c.id}>{c.label} — {c.blurb}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="number" step={0.05} min={0} value={seg.start} title="Starts at, in clip seconds"
              onChange={(e) => actions.updateCamera(clip.id, seg.id, { start: Number(e.target.value) })}
              style={{ flex: 1, background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 7, color: P.text, fontSize: 11, fontFamily: MONO, padding: '4px 6px' }} />
            <input type="number" step={0.05} min={0} value={seg.end} title="Ends at, in clip seconds"
              onChange={(e) => actions.updateCamera(clip.id, seg.id, { end: Number(e.target.value) })}
              style={{ flex: 1, background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 7, color: P.text, fontSize: 11, fontFamily: MONO, padding: '4px 6px' }} />
            <input type="number" step={0.02} min={MIN_CAMERA_BLEND} max={4} value={cameraBlend(seg)}
              title="How long the move INTO this angle takes. The camera always eases — it never cuts."
              onChange={(e) => actions.updateCamera(clip.id, seg.id, { blend: Number(e.target.value) })}
              style={{ flex: 1, background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 7, color: P.accent, fontSize: 11, fontFamily: MONO, padding: '4px 6px' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 9, color: P.muted, letterSpacing: 0.4 }}>
            <span style={{ flex: 1 }}>FROM</span>
            <span style={{ flex: 1 }}>TO</span>
            <span style={{ flex: 1 }}>MOVE (S)</span>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: P.sub, cursor: 'pointer', marginTop: 7 }}>
            <input type="checkbox" checked={!!seg.locked} onChange={(e) => actions.updateCamera(clip.id, seg.id, { locked: e.target.checked })} />
            Lock this move through preset switches and the pacer
          </label>
        </div>
      )) : <Empty>No simulated angles. Add one to cut between Wide, Medium, Close Up, Punch In and Side Crop without a second camera — every change is eased over its own move time, never a jump cut.</Empty>}
      {clip.camera.length ? (
        <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, marginBottom: 12 }}>
          Each angle is a digital crop anchored on the tracked subject, so the subject stays centred and inside the safe area
          at every zoom level. MOVE is how long the camera takes to reach that angle — raise it for a slow operated push,
          lower it for a snap.
        </div>
      ) : null}

      <SubjectProps clip={clip} actions={actions} />
      <Toggle label="Lock this clip" value={clip.locked}
        onChange={(v) => actions.updateClip(clip.id, { locked: v })}
        hint="A locked clip keeps its trim, camera plan, grade and depth look through a preset switch and through the pacing engine." />
    </div>
  );
}

/**
 * Subject segmentation and the depth composite.
 *
 * The mask is built geometrically from the detected subject boxes, so the
 * shape, padding and feather are all editable — and the panel says which
 * source the boxes came from, because a depth composite built on a guess the
 * creator cannot see is the most expensive kind of wrong.
 */
function SubjectProps({ clip, actions }: { clip: Clip; actions: EditorActions }) {
  const busy = actions.segmenting === clip.id;
  const subject = clip.subject;
  const fx = clip.subjectFx;
  const live = fx.enabled && subject.mode !== 'off';

  return (
    <>
      <div style={{ height: 1, background: P.border, margin: '14px 0 12px' }} />
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: P.sub, textTransform: 'uppercase', marginBottom: 9 }}>Subject &amp; depth</div>
      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, marginBottom: 10 }}>
        With the depth composite on, this clip is drawn twice: a background plate you can blur and dim, and a masked cutout of
        the subject ABOVE the background graphics band — so a graphic set to Background sits genuinely behind the presenter.
      </div>

      <SelectRow label="Subject mode" value={subject.mode}
        options={[
          { id: 'off' as const, label: 'Off — flat stack, no cutout' },
          { id: 'auto' as const, label: 'Auto — follow the detected boxes' },
          { id: 'manual' as const, label: 'Manual — one fixed box' },
        ]}
        onChange={(v) => actions.updateSubject(clip.id, { mode: v })} />

      <div style={{ marginBottom: 12 }}>
        <Btn tone="soft" onClick={() => actions.segmentClip(clip.id)} disabled={busy}>
          <ScanFace size={13} /> {busy ? 'Segmenting the subject…' : 'Segment subject'}
        </Btn>
        <div style={{ fontSize: 11, color: P.muted, marginTop: 6, lineHeight: 1.5 }}>
          {subject.note || (subject.boxes.length
            ? subject.boxes.length + ' box(es) from ' + subject.source + ', confidence ' + Math.round(subject.confidence * 100) + '%.'
            : 'Not segmented yet. The vision model reads a few frames; if it is unavailable the local face / saliency track is promoted instead.')}
        </div>
      </div>

      {subject.mode !== 'off' ? (
        <>
          <SelectRow label="Mask shape" value={subject.shape} options={asOptions<SubjectShape>(SUBJECT_SHAPES)}
            onChange={(v) => actions.updateSubject(clip.id, { shape: v })}
            hint={(SUBJECT_SHAPES.find((s) => s.id === subject.shape) || SUBJECT_SHAPES[0]).blurb +
              (subject.shape === 'rounded' ? ' Feather sets its corner radius rather than softening the edge.' : '')} />
          <NumberRow label="Edge feather" value={subject.feather} min={0} max={1} step={0.02}
            onChange={(v) => actions.updateSubject(clip.id, { feather: v })}
            hint="0 is a hard cutout edge, 1 is fully soft." />
          <NumberRow label="Mask padding X" value={subject.padX} min={0.6} max={2} step={0.02} suffix="×"
            onChange={(v) => actions.updateSubject(clip.id, { padX: v })} />
          <NumberRow label="Mask padding Y" value={subject.padY} min={0.6} max={2} step={0.02} suffix="×"
            onChange={(v) => actions.updateSubject(clip.id, { padY: v })} />
          {subject.mode === 'manual' ? (
            <>
              <NumberRow label="Box centre X" value={subject.box.x} min={0.05} max={0.95} step={0.01}
                onChange={(v) => actions.updateSubject(clip.id, { box: { ...subject.box, x: v } })} />
              <NumberRow label="Box centre Y" value={subject.box.y} min={0.05} max={0.98} step={0.01}
                onChange={(v) => actions.updateSubject(clip.id, { box: { ...subject.box, y: v } })} />
              <NumberRow label="Box width" value={subject.box.w} min={0.1} max={1} step={0.01}
                onChange={(v) => actions.updateSubject(clip.id, { box: { ...subject.box, w: v } })} />
              <NumberRow label="Box height" value={subject.box.h} min={0.1} max={1} step={0.01}
                onChange={(v) => actions.updateSubject(clip.id, { box: { ...subject.box, h: v } })} />
            </>
          ) : null}
        </>
      ) : null}

      <Toggle label="Depth composite" value={fx.enabled}
        onChange={(v) => actions.updateSubjectFx(clip.id, { enabled: v })}
        hint={subject.mode === 'off'
          ? 'Set the subject mode above to Auto or Manual first — with no mask there is no cutout to draw, and the quality gate will block the export.'
          : 'Draws the masked subject above the background graphics band.'} />
      {live ? <Pill color={P.ok}>depth stack active</Pill> : null}

      {fx.enabled ? (
        <div style={{ marginTop: 11 }}>
          <NumberRow label="Background blur" value={fx.depthBlur} min={0} max={30} step={0.5} suffix="px"
            onChange={(v) => actions.updateSubjectFx(clip.id, { depthBlur: v })}
            hint="Blurs the plate only — the subject cutout stays sharp, which is what reads as depth." />
          <NumberRow label="Background dim" value={Math.round(fx.backgroundDim * 100)} min={0} max={100} step={1} suffix="%"
            onChange={(v) => actions.updateSubjectFx(clip.id, { backgroundDim: v / 100 })} />
          <NumberRow label="Subject outline" value={fx.outline} min={0} max={18} step={1} suffix="px"
            onChange={(v) => actions.updateSubjectFx(clip.id, { outline: v })} />
          {fx.outline > 0 ? (
            <ColorRow label="Outline colour" value={fx.outlineColor} onChange={(v) => actions.updateSubjectFx(clip.id, { outlineColor: v })} />
          ) : null}
          <NumberRow label="Subject glow" value={fx.glow} min={0} max={80} step={1} suffix="px"
            onChange={(v) => actions.updateSubjectFx(clip.id, { glow: v })} />
          {fx.glow > 0 ? (
            <ColorRow label="Glow colour" value={fx.glowColor} onChange={(v) => actions.updateSubjectFx(clip.id, { glowColor: v })} />
          ) : null}
          <NumberRow label="Contact shadow" value={fx.shadow} min={0} max={80} step={1} suffix="px"
            onChange={(v) => actions.updateSubjectFx(clip.id, { shadow: v })} />
        </div>
      ) : null}
    </>
  );
}

function TransitionProps({ tr, timeline, actions }: { tr: TransitionInstance; timeline: CompiledTimeline; actions: EditorActions }) {
  const placed = timeline.transitions.find((p) => p.id === tr.id);
  const spec = transitionSpec(tr.type);
  return (
    <div style={{ padding: 12 }}>
      <SelectRow label="Transition" value={tr.type} options={asOptions<TransitionId>(TRANSITIONS)}
        onChange={(v) => actions.updateTransition(tr.id, { type: v, duration: transitionSpec(v).duration, easing: transitionSpec(v).easing })}
        hint={spec.blurb} />
      <NumberRow label="Duration" value={tr.duration} min={0.1} max={1.5} step={0.05} suffix="s"
        onChange={(v) => actions.updateTransition(tr.id, { duration: v })} />
      <SelectRow label="Easing" value={tr.easing} options={asOptions<EasingId>(EASINGS)}
        onChange={(v) => actions.updateTransition(tr.id, { easing: v })} />
      {spec.directional ? (
        <SelectRow label="Direction" value={tr.direction}
          options={[{ id: 'left' as const, label: 'Left' }, { id: 'right' as const, label: 'Right' }, { id: 'up' as const, label: 'Up' }, { id: 'down' as const, label: 'Down' }]}
          onChange={(v) => actions.updateTransition(tr.id, { direction: v })} />
      ) : null}
      {tr.type === 'maskReveal' ? (
        <SelectRow label="Mask shape" value={tr.shape}
          options={[{ id: 'circle' as const, label: 'Circle' }, { id: 'bar' as const, label: 'Bar wipe' }, { id: 'diagonal' as const, label: 'Diagonal' }]}
          onChange={(v) => actions.updateTransition(tr.id, { shape: v })} />
      ) : null}
      <Toggle label="Sync to beats" value={tr.syncToBeat}
        onChange={(v) => actions.updateTransition(tr.id, { syncToBeat: v })}
        hint="Snap cuts in the Beat panel will pull this cut onto the nearest detected beat. Moving a cut re-trims the clip in front of it — the only way a cut can move — and a move that would leave the transition no spare footage is refused rather than forced." />
      <Toggle label="Lock this transition" value={tr.locked}
        onChange={(v) => actions.updateTransition(tr.id, { locked: v })}
        hint="A locked transition survives a preset switch, the pacing engine and a beat snap." />
      <div style={{
        background: placed && placed.granted >= tr.duration - 0.02 ? 'color-mix(in srgb, #4ADE80 10%, transparent)' : 'color-mix(in srgb, #FBBF24 12%, transparent)',
        border: '1px solid ' + (placed && placed.granted >= tr.duration - 0.02 ? 'color-mix(in srgb, #4ADE80 36%, transparent)' : 'color-mix(in srgb, #FBBF24 36%, transparent)'),
        borderRadius: 10, padding: 10, fontSize: 11.5, color: P.sub, lineHeight: 1.55,
      }}>
        {placed
          ? 'Running at ' + placed.granted.toFixed(2) + 's of the ' + tr.duration.toFixed(2) + 's requested, centred on the cut. ' +
            (placed.granted >= tr.duration - 0.02
              ? 'Both clips play their kept range in full.'
              : 'There was only that much spare footage either side of the cut — nothing was cut from either clip.')
          : 'There is no spare footage either side of this cut, so it is playing as a straight cut. Pull the clips’ in/out points inwards to give the transition something to run on.'}
      </div>
    </div>
  );
}

function CaptionProps({ cue, actions }: { cue: CaptionCue; actions: EditorActions }) {
  return (
    <div style={{ padding: 12 }}>
      <TextRow label="Cue text" value={cueText(cue)} onChange={(v) => actions.setCueText(cue.id, v)}
        hint="Re-splitting the line keeps each surviving word's style and animation; new words start on the base style." />
      <NumberRow label="Start" value={cue.start} min={0} max={Math.max(0.2, cue.end - 0.1)} step={0.02} suffix="s"
        onChange={(v) => actions.updateCaption(cue.id, { start: v })} />
      <NumberRow label="End" value={cue.end} min={cue.start + 0.1} max={cue.start + 20} step={0.02} suffix="s"
        onChange={(v) => actions.updateCaption(cue.id, { end: v })} />
      <NumberRow label="Position X" value={cue.x} min={SAFE_MARGIN} max={CANVAS_W - SAFE_MARGIN} step={2}
        onChange={(v) => actions.updateCaption(cue.id, { x: v })} />
      <NumberRow label="Position Y" value={cue.y} min={SAFE_MARGIN} max={CANVAS_H - SAFE_MARGIN} step={4}
        onChange={(v) => actions.updateCaption(cue.id, { y: v })} />
      <NumberRow label="Block width" value={Math.round(cue.widthPct * 100)} min={30} max={94} step={1} suffix="%"
        onChange={(v) => actions.updateCaption(cue.id, { widthPct: v / 100 })} />
      <SelectRow label="Alignment" value={cue.align}
        options={[{ id: 'left' as const, label: 'Left' }, { id: 'center' as const, label: 'Centre' }, { id: 'right' as const, label: 'Right' }]}
        onChange={(v) => actions.updateCaption(cue.id, { align: v })} />
      <SelectRow label="Base font" value={cue.font} options={asOptions<FontId>(FONTS)}
        onChange={(v) => actions.updateCaption(cue.id, { font: v })} />
      <NumberRow label="Base size" value={cue.baseSize} min={42} max={140} step={1} suffix="px"
        onChange={(v) => actions.updateCaption(cue.id, { baseSize: v })}
        hint="Canvas pixels on the 1080-wide frame. Below 42px the quality gate blocks the export." />
      <NumberRow label="Outline" value={cue.outline} min={0} max={14} step={1} suffix="px"
        onChange={(v) => actions.updateCaption(cue.id, { outline: v })} />
      <ColorRow label="Base colour" value={cue.color} onChange={(v) => actions.updateCaption(cue.id, { color: v })} />
      <ColorRow label="Accent colour" value={cue.accent} onChange={(v) => actions.updateCaption(cue.id, { accent: v })} />

      <div style={{ height: 1, background: P.border, margin: '6px 0 12px' }} />
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: P.sub, textTransform: 'uppercase', marginBottom: 4 }}>Per-word treatment</div>
      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, marginBottom: 10 }}>
        Every word carries its own style and animation, so one line can run Normal copy with a single Huge, popped keyword.
      </div>
      {cue.words.map((w, i) => (
        <div key={w.id} style={{ background: P.card, border: '1px solid ' + P.border, borderRadius: 10, padding: 9, marginBottom: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <span style={{ flex: 1, fontSize: 12.5, color: P.text, fontWeight: 700 }}>{w.text}</span>
            <span style={{ fontSize: 10, color: P.muted, fontFamily: MONO }}>{w.start.toFixed(2)}s</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <select value={w.style} onChange={(e) => actions.updateWord(cue.id, i, { style: e.target.value as CaptionStyleId })}
              style={{ flex: 1, background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 7, color: P.text, fontSize: 11, padding: '4px 6px' }}>
              {CAPTION_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={w.anim} onChange={(e) => actions.updateWord(cue.id, i, { anim: e.target.value as CaptionAnimId })}
              style={{ flex: 1, background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 7, color: P.text, fontSize: 11, padding: '4px 6px' }}>
              {CAPTION_ANIMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: P.sub, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!w.shake} onChange={(e) => actions.updateWord(cue.id, i, { shake: e.target.checked })} />
            Add a shake on entry
          </label>
        </div>
      ))}
    </div>
  );
}

function GraphicProps({ g, actions }: { g: GraphicLayer; actions: EditorActions }) {
  const spec = graphicSpec(g.type);
  return (
    <div style={{ padding: 12 }}>
      <SelectRow label="Primitive" value={g.type} options={asOptions<GraphicType>(GRAPHICS)}
        onChange={(v) => actions.updateGraphic(g.id, { type: v, w: graphicSpec(v).w, h: graphicSpec(v).h })} hint={spec.blurb} />
      <SelectRow label="Band" value={g.band} options={GRAPHIC_BANDS as { id: GraphicBand; label: string }[]}
        onChange={(v) => actions.updateGraphic(g.id, { band: v })}
        hint="Auto lets subject detection decide: behind the presenter when the layer would cover them, in front otherwise." />
      {['callout', 'label', 'progressBar', 'uiCard', 'statCard', 'arrowDiagram', 'browserMockup', 'phoneMockup',
        'featureCard', 'notification'].indexOf(g.type) >= 0 ? (
        <TextRow label="Text" value={g.text} onChange={(v) => actions.updateGraphic(g.id, { text: v })}
          hint={g.type === 'statCard'
            ? 'Pipe-separated: figure first, then the label — e.g. “3.4x|conversion lift”. The figure counts up on entry.'
            : g.type === 'arrowDiagram'
              ? 'Pipe-separated steps, up to four — e.g. “Brief|Draft|Ship”.'
              : g.type === 'featureCard' || g.type === 'notification'
                ? 'Pipe-separated: the title first, then the supporting line — e.g. “New sale|Another order just landed”.'
                : undefined} />
      ) : null}
      {g.type === 'icon' || g.type === 'featureCard' ? (
        <SelectRow label="Glyph" value={g.icon} options={asOptions<IconId>(ICONS)}
          onChange={(v) => actions.updateGraphic(g.id, { icon: v })}
          hint="Built-in vector glyphs — the render engine cannot load an icon font, so these draw themselves in as stroked paths." />
      ) : null}
      {isParticleType(g.type) ? (
        <>
          <NumberRow label="Element count" value={g.count} min={1} max={90} step={1}
            onChange={(v) => actions.updateGraphic(g.id, { count: Math.round(v) })}
            hint="How many confetti pieces, sparkles, embers, lines or rays this layer draws." />
          <NumberRow label="Scatter seed" value={g.seed} min={1} max={999} step={1}
            onChange={(v) => actions.updateGraphic(g.id, { seed: Math.round(v) })}
            hint="Positions come from this number, never from chance — so the preview and the render draw the same field. Change it to reshuffle the look." />
        </>
      ) : null}
      <NumberRow label="Start" value={g.start} min={0} max={Math.max(0.2, g.end - 0.2)} step={0.05} suffix="s"
        onChange={(v) => actions.updateGraphic(g.id, { start: v })} />
      <NumberRow label="End" value={g.end} min={g.start + 0.2} max={g.start + 30} step={0.05} suffix="s"
        onChange={(v) => actions.updateGraphic(g.id, { end: v })} />
      <NumberRow label="Position X" value={g.x} min={0} max={CANVAS_W} step={2} onChange={(v) => actions.updateGraphic(g.id, { x: v })} />
      <NumberRow label="Position Y" value={g.y} min={0} max={CANVAS_H} step={4} onChange={(v) => actions.updateGraphic(g.id, { y: v })} />
      <RampRow label="Position drift X" from={g.dx.from} to={g.dx.to} min={-600} max={600} step={2} onChange={(r) => actions.updateGraphic(g.id, { dx: r })} />
      <RampRow label="Position drift Y" from={g.dy.from} to={g.dy.to} min={-600} max={600} step={2} onChange={(r) => actions.updateGraphic(g.id, { dy: r })} />
      <NumberRow label="Width" value={g.w} min={24} max={CANVAS_W} step={4} onChange={(v) => actions.updateGraphic(g.id, { w: v })} />
      <NumberRow label="Height" value={g.h} min={16} max={CANVAS_H} step={4} onChange={(v) => actions.updateGraphic(g.id, { h: v })} />
      <RampRow label="Scale" from={g.scale.from} to={g.scale.to} min={0.05} max={4} step={0.01} onChange={(r) => actions.updateGraphic(g.id, { scale: r })} />
      <RampRow label="Rotation" from={g.rotation.from} to={g.rotation.to} min={-360} max={360} step={1} onChange={(r) => actions.updateGraphic(g.id, { rotation: r })} />
      <RampRow label="Opacity" from={g.opacity.from} to={g.opacity.to} min={0} max={1} step={0.02} onChange={(r) => actions.updateGraphic(g.id, { opacity: r })} />
      <RampRow label="Blur" from={g.blur.from} to={g.blur.to} min={0} max={40} step={0.5} onChange={(r) => actions.updateGraphic(g.id, { blur: r })} />
      <ColorRow label="Colour" value={g.color} onChange={(v) => actions.updateGraphic(g.id, { color: v })} />
      <ColorRow label="Secondary colour" value={g.color2} onChange={(v) => actions.updateGraphic(g.id, { color2: v })} />
      <SelectRow label="Easing" value={g.easing} options={asOptions<EasingId>(EASINGS)} onChange={(v) => actions.updateGraphic(g.id, { easing: v })} />
      <NumberRow label="Reveal in" value={g.inDur} min={0.05} max={3} step={0.05} suffix="s" onChange={(v) => actions.updateGraphic(g.id, { inDur: v })} />
      <NumberRow label="Reveal out" value={g.outDur} min={0.05} max={3} step={0.05} suffix="s" onChange={(v) => actions.updateGraphic(g.id, { outDur: v })} />
      <NumberRow label="Stroke weight" value={g.thickness} min={1} max={44} step={1} suffix="px" onChange={(v) => actions.updateGraphic(g.id, { thickness: v })} />
      {g.type === 'progressBar' ? (
        <NumberRow label="Fill target" value={Math.round(g.fill * 100)} min={0} max={100} step={1} suffix="%"
          onChange={(v) => actions.updateGraphic(g.id, { fill: v / 100 })} />
      ) : null}
      {g.type === 'arrow' || g.type === 'line' || g.type === 'speedLines' ? (
        <SelectRow label="Direction" value={g.direction}
          options={[{ id: 'right' as const, label: 'Right' }, { id: 'down' as const, label: 'Down' }, { id: 'left' as const, label: 'Left' }, { id: 'up' as const, label: 'Up' }]}
          onChange={(v) => actions.updateGraphic(g.id, { direction: v })}
          hint={g.type === 'speedLines' ? 'Which way the lines race. Arrow and Line primitives rotate instead.' : undefined} />
      ) : null}
      {g.type === 'line' ? <Toggle label="Curved connector" value={g.curved} onChange={(v) => actions.updateGraphic(g.id, { curved: v })} /> : null}

      <Toggle label="Lock this layer" value={g.locked}
        onChange={(v) => actions.updateGraphic(g.id, { locked: v })}
        hint="A locked layer survives a preset switch and the pacing engine, and refuses to move on the timeline." />

      <div style={{ height: 1, background: P.border, margin: '6px 0 12px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
        <Crosshair size={12} color={P.gfxFg} />
        <div style={{ flex: 1, fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: P.sub, textTransform: 'uppercase' }}>Tracking</div>
      </div>
      <SelectRow label="Follow" value={g.track.target} options={asOptions<TrackTarget>(TRACK_TARGETS)}
        onChange={(v) => actions.updateGraphic(g.id, { track: { ...g.track, target: v } })}
        hint={(TRACK_TARGETS.find((t) => t.id === g.track.target) || TRACK_TARGETS[0]).blurb} />
      {g.track.target !== 'none' ? (
        <>
          <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, marginBottom: 10 }}>
            The graphic is pinned to the subject point of whichever clip is on screen, through the same crop and camera maths the
            picture uses — so it stays on the subject at every simulated angle. Position X / Y below become the fallback for
            frames outside the window.
          </div>
          <NumberRow label="Offset X" value={g.track.offsetX} min={-500} max={500} step={2}
            onChange={(v) => actions.updateGraphic(g.id, { track: { ...g.track, offsetX: v } })} />
          <NumberRow label="Offset Y" value={g.track.offsetY} min={-900} max={900} step={4}
            onChange={(v) => actions.updateGraphic(g.id, { track: { ...g.track, offsetY: v } })} />
          <NumberRow label="Follow strength" value={g.track.strength} min={0} max={1} step={0.02}
            onChange={(v) => actions.updateGraphic(g.id, { track: { ...g.track, strength: v } })}
            hint="1 pins it to the subject; lower values blend back towards its own position, which reads as lag." />
          <Toggle label="Only track part of the layer" value={g.track.from != null}
            onChange={(v) => actions.updateGraphic(g.id, {
              track: { ...g.track, from: v ? g.start : null, to: v ? g.end : null },
            })} />
          {g.track.from != null ? (
            <>
              <NumberRow label="Track from" value={g.track.from} min={g.start} max={g.end} step={0.05} suffix="s"
                onChange={(v) => actions.updateGraphic(g.id, { track: { ...g.track, from: v } })} />
              <NumberRow label="Track until" value={g.track.to == null ? g.end : g.track.to} min={g.start} max={g.end} step={0.05} suffix="s"
                onChange={(v) => actions.updateGraphic(g.id, { track: { ...g.track, to: v } })} />
            </>
          ) : null}
        </>
      ) : null}

      <div style={{ height: 1, background: P.border, margin: '6px 0 12px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
        <Layers size={12} color={P.accent} />
        <div style={{ flex: 1, fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: P.sub, textTransform: 'uppercase' }}>Keyframes</div>
      </div>
      <KeyframePanel g={g} playhead={actions.playhead} onSeek={actions.seek}
        clipboard={actions.keyClipboard} onCopy={actions.copyKeys}
        onChange={(patch) => actions.updateGraphic(g.id, patch)} />
    </div>
  );
}

function AudioProps({ track, actions }: { track: AudioTrack; actions: EditorActions }) {
  const isSfx = track.kind === 'sfx';
  const spec = track.sfxId ? sfxSpec(track.sfxId) : null;
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 11, flexWrap: 'wrap' }}>
        <Pill color={P.audio}>{track.kind}</Pill>
        {spec ? <Pill color={P.audio}>{spec.duration.toFixed(2)}s</Pill> : null}
        {track.anchor !== 'manual' ? <Pill color={P.accent}>{track.anchor}</Pill> : null}
      </div>
      {spec ? <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, marginBottom: 10 }}>{spec.blurb}</div> : null}
      {track.anchorNote ? (
        <div style={{ fontSize: 11, color: P.sub, lineHeight: 1.5, marginBottom: 11 }}>{track.anchorNote}</div>
      ) : null}
      <TextRow label="Label" value={track.label} onChange={(v) => actions.updateAudio(track.id, { label: v })} />
      <NumberRow label="Starts at" value={track.at} min={0} max={600} step={0.01} suffix="s" onChange={(v) => actions.updateAudio(track.id, { at: v })}
        hint={isSfx ? 'Drag the clip along the AUDIO SFX track to move it, or set the exact timestamp here.' : undefined} />
      <NumberRow label="Volume" value={Math.round(track.volume * 100)} min={0} max={100} step={1} suffix="%"
        onChange={(v) => actions.updateAudio(track.id, { volume: v / 100 })} />
      <NumberRow label="Fade in" value={track.fadeIn} min={0} max={3} step={0.01} suffix="s"
        onChange={(v) => actions.updateAudio(track.id, { fadeIn: v })}
        hint="The engine ramps the clip's volume over this long, so it can never start on a click." />
      <NumberRow label="Fade out" value={track.fadeOut} min={0} max={6} step={0.01} suffix="s"
        onChange={(v) => actions.updateAudio(track.id, { fadeOut: v })}
        hint={track.duration > 0 ? undefined : 'A fade-out needs a clip length below — with 0 the whole file plays and there is no end to fade from.'} />
      <NumberRow label="Clip length" value={track.duration} min={0} max={30} step={0.01} suffix="s"
        onChange={(v) => actions.updateAudio(track.id, { duration: v })}
        hint="0 plays the whole file. Anything above that trims the clip and gives the fade-out something to land on." />
      <Toggle label="Loop this track" value={track.loop} onChange={(v) => actions.updateAudio(track.id, { loop: v })} />
      {isSfx ? (
        <Toggle label="Lock this sound" value={track.locked} onChange={(v) => actions.updateAudio(track.id, { locked: v })}
          hint="A locked sound is never moved by a re-align or a beat snap." />
      ) : null}
      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, wordBreak: 'break-all' }}>{track.url}</div>
    </div>
  );
}

/**
 * The opening hook.
 *
 * The lead-in is the one control here that changes the shape of the timeline:
 * raising it reserves more time before clip 1 and moves every caption, graphic
 * and audio clip back by the same amount, so the edit stays in sync behind it.
 */
function HookProps({ hook, actions }: { hook: HookState; actions: EditorActions }) {
  const leadIn = hook.leadIn > 0.01;
  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 11.5, color: P.sub, lineHeight: 1.55, marginBottom: 12 }}>{hookSummary(hook)}</div>

      <SelectRow label="Template" value={hook.template} options={asOptions<HookTemplateId>(HOOK_TEMPLATES)}
        onChange={(v) => actions.addHook(v)}
        hint={(HOOK_TEMPLATES.find((h) => h.id === hook.template) || HOOK_TEMPLATES[0]).blurb} />

      <NumberRow label="Hold" value={hook.duration} min={0.6} max={3} step={0.05} suffix="s"
        onChange={(v) => actions.updateHook({ duration: v, leadIn: leadIn ? v : 0 })}
        hint="How long the hook owns the frame. One to three seconds is the band that works — longer and the viewer leaves before the video starts." />
      <Toggle label="Play before clip 1" value={leadIn}
        onChange={(v) => actions.updateHook({ leadIn: v ? hook.duration : 0 })}
        hint="On, the hook plays on its own and the footage starts after it — every other layer moves back to match. Off, it plays over the opening of clip 1 behind a scrim." />
      {!leadIn ? (
        <NumberRow label="Scrim over the footage" value={Math.round(hook.scrim * 100)} min={0} max={100} step={1} suffix="%"
          onChange={(v) => actions.updateHook({ scrim: v / 100 })} />
      ) : null}

      {hook.template === 'number' ? (
        <>
          <TextRow label="Number" value={hook.value} onChange={(v) => actions.updateHook({ value: v })}
            hint="Digits, with or without separators. The figure is what counts up." />
          <TextRow label="Currency / unit" value={hook.currency} onChange={(v) => actions.updateHook({ currency: v })}
            hint="Shown before the figure in the accent colour. Leave it empty for a plain number." />
          <TextRow label="Supporting text" value={hook.support} onChange={(v) => actions.updateHook({ support: v })}
            hint="Slides in beneath the figure once the count is most of the way there." />
          <Toggle label="Count up to the figure" value={hook.countUp} onChange={(v) => actions.updateHook({ countUp: v })}
            hint="Off, the number pops in at full size instead of counting." />
        </>
      ) : (
        <TextRow label="Hook text" value={hook.text} onChange={(v) => actions.updateHook({ text: v })}
          hint={hook.template === 'problem'
            ? 'The words land one at a time, in order.'
            : 'One line. It is set in upper case whatever you type.'} />
      )}

      {hook.template === 'problem' ? (
        <>
          <TextRow label="Emphasise word(s)" value={hook.emphasisWords} onChange={(v) => actions.updateHook({ emphasisWords: v })}
            hint={'Word positions, counting from 1, separated by commas — e.g. “3” or “2,3”. The phrase has ' +
              (hook.text || '').trim().split(/\s+/).filter(Boolean).length + ' word(s).'} />
          <ColorRow label="Emphasis colour" value={hook.emphasisColor} onChange={(v) => actions.updateHook({ emphasisColor: v })} />
        </>
      ) : null}

      <SelectRow label="Font" value={hook.font} options={asOptions<FontId>(FONTS)}
        onChange={(v) => actions.updateHook({ font: v })} />
      <NumberRow label="Font size" value={hook.fontSize} min={40} max={240} step={2} suffix="px"
        onChange={(v) => actions.updateHook({ fontSize: v })}
        hint="A ceiling, not a promise: the hook shrinks itself if the longest word would otherwise run past the safe area." />
      <ColorRow label="Text colour" value={hook.color} onChange={(v) => actions.updateHook({ color: v })} />
      <ColorRow label="Accent colour" value={hook.accent} onChange={(v) => actions.updateHook({ accent: v })} />
      <ColorRow label="Backdrop" value={hook.background} onChange={(v) => actions.updateHook({ background: v })} />
      <NumberRow label="Camera push" value={Math.round(hook.push * 100)} min={0} max={40} step={1} suffix="%"
        onChange={(v) => actions.updateHook({ push: v / 100 })}
        hint="How far the frame pushes in across the hook. All three templates share it, so they read as one family." />

      <Toggle label="Lock the hook" value={hook.locked} onChange={(v) => actions.updateHook({ locked: v })}
        hint="A locked hook keeps its copy and look through a preset switch." />
      <Btn tone="danger" onClick={() => actions.removeHook()}>
        <Trash2 size={12} /> Remove the hook
      </Btn>
      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.5, marginTop: 8 }}>
        Removing it gives the lead-in time back to the timeline and moves every other layer forward again.
      </div>
    </div>
  );
}

export function PropertiesPanel({ project, timeline, selection, actions, onCollapse }: {
  project: Project; timeline: CompiledTimeline; selection: Selection | null; actions: EditorActions;
  onCollapse?: () => void;
}) {
  let title = 'Properties';
  let body = <Empty>Select a layer on the left to edit its position, scale, rotation, opacity, blur, colour, timing and easing.</Empty>;

  if (selection?.kind === 'hook') {
    if (project.hook) { title = 'Hook · ' + hookTemplateLabel(project.hook.template); body = <HookProps hook={project.hook} actions={actions} />; }
  } else if (selection?.kind === 'clip') {
    const clip = project.clips.find((c) => c.id === selection.id);
    if (clip) { title = 'Clip · ' + clip.name; body = <ClipProps clip={clip} actions={actions} />; }
  } else if (selection?.kind === 'transition') {
    const tr = project.transitions.find((t) => t.id === selection.id);
    if (tr) { title = 'Transition · ' + transitionSpec(tr.type).label; body = <TransitionProps tr={tr} timeline={timeline} actions={actions} />; }
  } else if (selection?.kind === 'caption') {
    const cue = project.captions.find((c) => c.id === selection.id);
    if (cue) { title = 'Caption cue'; body = <CaptionProps cue={cue} actions={actions} />; }
  } else if (selection?.kind === 'graphic') {
    const g = project.graphics.find((x) => x.id === selection.id);
    if (g) { title = 'Graphic · ' + graphicSpec(g.type).label; body = <GraphicProps g={g} actions={actions} />; }
  } else if (selection?.kind === 'audio') {
    const track = audioTracks(project.audio).find((a) => a.id === selection.id);
    if (track) { title = 'Audio · ' + track.label; body = <AudioProps track={track} actions={actions} />; }
  }

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <SectionHeader label={title} right={onCollapse ? (
        <button onClick={onCollapse} title="Collapse properties" aria-label="Collapse properties panel"
          style={{ width: 25, height: 25, display: 'grid', placeItems: 'center', background: P.card, border: '1px solid ' + P.border, borderRadius: 7, color: P.sub, cursor: 'pointer' }}>
          <PanelRightClose size={13} />
        </button>
      ) : undefined} />
      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>{body}</div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Quality control
// ---------------------------------------------------------------------------

export function QcPanel({ report, onClose }: { report: QcReport; onClose: () => void }) {
  const icon = (s: string) => s === 'pass'
    ? <CheckCircle2 size={14} color={P.ok} />
    : s === 'warn' ? <AlertTriangle size={14} color={P.warn} /> : <XCircle size={14} color={P.bad} />;
  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SectionHeader label="Pre-render quality control" right={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Pill color={report.ok ? P.ok : P.bad}>{report.ok ? 'Ready to render' : report.failures.length + ' blocking'}</Pill>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: P.sub, cursor: 'pointer', display: 'flex' }}><ChevronDown size={14} /></button>
        </span>
      } />
      <div style={{ overflowY: 'auto', minHeight: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {report.checks.map((c) => (
          <div key={c.id} style={{
            display: 'flex', gap: 9, padding: 9, borderRadius: 10,
            background: c.status === 'pass' ? P.card : 'color-mix(in srgb, ' + (c.status === 'warn' ? P.warn : P.bad) + ' 8%, transparent)',
            border: '1px solid ' + (c.status === 'pass' ? P.border : 'color-mix(in srgb, ' + (c.status === 'warn' ? P.warn : P.bad) + ' 34%, transparent)'),
          }}>
            <span style={{ marginTop: 1, flexShrink: 0 }}>{icon(c.status)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: P.text }}>{c.label}</div>
              <div style={{ fontSize: 11.5, color: P.sub, lineHeight: 1.5, marginTop: 2 }}>{c.detail}</div>
              {c.fix && c.status !== 'pass' ? (
                <div style={{ fontSize: 11.5, color: P.accent, lineHeight: 1.5, marginTop: 4 }}><b>Fix:</b> {c.fix}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function CollapsedQc({ report, onOpen }: { report: QcReport | null; onOpen: () => void }) {
  return (
    <Btn tone={report && !report.ok ? 'danger' : 'ghost'} onClick={onOpen}>
      <ChevronUp size={12} />
      {report ? (report.ok ? 'QC passed · ' + report.warnings.length + ' notes' : report.failures.length + ' blocking issues') : 'Run quality control'}
    </Btn>
  );
}
