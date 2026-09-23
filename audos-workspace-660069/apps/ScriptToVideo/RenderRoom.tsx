/**
 * Sequential production board — the live view of a film generating clip by
 * clip. Left rail: every scene with its live status. Right panel: THE ACTIVE
 * SCENE only — its duration, continuity decision, reference assets and full
 * prepared prompt, with the explicit [Generate Video] trigger. Future scenes'
 * prompts are never shown (they do not exist yet — the director prepares one
 * clip at a time). Failed scenes offer per-scene recovery that never touches
 * completed clips.
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Check, Circle, CircleDot,
  Loader2, Play, RefreshCw, SkipForward, Sparkles, UserRound, Wand2, Zap,
} from 'lucide-react';
import { Film, FilmScene, T } from './api';
import { audioReady, musicReady, narrationReady, sfxReady } from './pipeline/audio';

const DONE = new Set(['completed', 'skipped']);

function statusMeta(s: FilmScene): { word: string; color: string; icon: any } {
  switch (String(s.status)) {
    case 'completed': return { word: 'Completed', color: T.done, icon: <Check size={13} /> };
    case 'ready': return { word: 'Ready to generate', color: T.live, icon: <CircleDot size={13} /> };
    case 'generating': return { word: 'Generating', color: T.live, icon: <Loader2 size={13} className="animate-spin" /> };
    case 'failed': return { word: 'Failed', color: T.fault, icon: <AlertTriangle size={13} /> };
    case 'skipped': return { word: 'Skipped', color: T.dim, icon: <SkipForward size={13} /> };
    default: return { word: 'Waiting', color: T.dim, icon: <Circle size={12} /> };
  }
}

function referenceLabel(s: FilmScene, scenes: FilmScene[]): string {
  const prev = [...scenes].filter((x) => x.idx < s.idx && x.status === 'completed').sort((a, b) => b.idx - a.idx)[0];
  switch (String(s.reference_type || '')) {
    case 'previous_final_frame': return prev ? `Scene ${prev.idx + 1} final frame` : 'Previous final frame';
    case 'character_reference': return 'Locked character reference';
    case 'scene_reference': return 'Scene reference image';
    default: return 'None — prompt only';
  }
}

export default function RenderRoom(props: {
  film: Film;
  scenes: FilmScene[];
  note: string;
  busy: boolean;
  auto: boolean;
  autoPost: boolean;
  onToggleAuto: (on: boolean) => void;
  onToggleAutoPost: (on: boolean) => void;
  onGenerate: (scene: FilmScene) => void;
  onPrepare: (scene: FilmScene) => void;
  onRetry: (scene: FilmScene) => void;
  onRegenPrompt: (scene: FilmScene) => void;
  onUseCharRef: (scene: FilmScene) => void;
  onSkip: (scene: FilmScene) => void;
}) {
  const { film, note, busy, auto, autoPost } = props;
  const scenes = [...(Array.isArray(props.scenes) ? props.scenes : [])].sort((a, b) => a.idx - b.idx);
  const completed = scenes.filter((s) => s.status === 'completed');
  const generating = scenes.find((s) => s.status === 'generating') || null;
  const active = scenes.find((s) => !DONE.has(String(s.status))) || null;
  const allDone = scenes.length > 0 && scenes.every((s) => DONE.has(String(s.status)));
  const assembling = film.status === 'assembling';

  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => { setSelectedId(active ? active.id : (scenes[scenes.length - 1]?.id ?? null)); }, [active?.id, scenes.length]);
  const selected = scenes.find((s) => s.id === selectedId) || active || scenes[0] || null;
  const selectedIsActive = !!selected && !!active && selected.id === active.id;

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* —— Scene rail —— */}
      <div style={{ width: 268, flexShrink: 0, borderRight: `1px solid ${T.raised}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '16px 16px 10px' }}>
          <div style={{ color: T.bone, fontSize: 14.5, fontWeight: 700, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{film.title || 'Your film'}</div>
          <div style={{ color: T.muted, fontSize: 11.5, marginTop: 4 }}>{completed.length} of {scenes.length} clips completed</div>
          <div style={{ marginTop: 8, height: 4, background: T.raised, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${scenes.length ? Math.round((completed.length / scenes.length) * 100) : 2}%`, background: T.live, transition: 'width 0.6s ease' }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '2px 8px 12px' }}>
          {scenes.map((s) => {
            const meta = statusMeta(s);
            const isSel = selected?.id === s.id;
            return (
              <button
                key={s.id}
                className="s2v-row"
                onClick={() => setSelectedId(s.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', background: isSel ? 'rgba(255,255,255,0.05)' : 'transparent', border: `1px solid ${isSel ? T.dim : 'transparent'}`, borderRadius: 10, padding: '9px 10px', cursor: 'pointer', marginBottom: 2 }}
              >
                <span style={{ color: meta.color, display: 'flex', flexShrink: 0 }}>{meta.icon}</span>
                <span style={{ color: isSel ? T.bone : T.muted, fontFamily: T.mono, fontSize: 12, flexShrink: 0 }}>Scene {String(s.idx + 1).padStart(2, '0')}</span>
                <span style={{ color: meta.color, fontSize: 11.5, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{meta.word}</span>
              </button>
            );
          })}
        </div>
        {/* Generation states + auto modes (the Final Assembly control lives in
            the persistent bottom bar, never buried down here) */}
        <div style={{ padding: '10px 14px 14px', borderTop: `1px solid ${T.raised}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <GenerationStates film={film} scenes={scenes} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title="Prepare → generate → extract frame → decide continuity → next — still strictly one clip at a time.">
            <input type="checkbox" checked={auto} onChange={(e) => props.onToggleAuto(e.target.checked)} style={{ accentColor: T.live }} />
            <Zap size={13} color={auto ? T.live : T.dim} />
            <span style={{ color: auto ? T.bone : T.muted, fontSize: 12.5, fontWeight: 600 }}>Auto-generate</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title="After the last scene completes: narration → music → SFX run automatically until Ready for Final Assembly. Off = trigger each post-production step yourself.">
            <input type="checkbox" checked={autoPost} onChange={(e) => props.onToggleAutoPost(e.target.checked)} style={{ accentColor: T.live }} />
            <Wand2 size={13} color={autoPost ? T.live : T.dim} />
            <span style={{ color: autoPost ? T.bone : T.muted, fontSize: 12.5, fontWeight: 600 }}>Auto-complete post-production</span>
          </label>
        </div>
      </div>

      {/* —— Active scene panel —— */}
      <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, padding: '18px 22px 28px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {/* Live pipeline note */}
          <div style={{ color: generating || assembling ? T.live : T.muted, fontSize: 12.5, minHeight: 18, marginBottom: 4 }}>
            {note || film.stage_note || '…'}
          </div>
          {film.error ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: T.fault, fontSize: 12.5, lineHeight: 1.55, margin: '6px 0 10px', background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{film.error}</span>
            </div>
          ) : null}

          {allDone && !selected ? (
            <div style={{ color: T.done, fontSize: 14, marginTop: 30, textAlign: 'center' }}>All scenes are complete — assemble the final film.</div>
          ) : null}

          {selected ? <ScenePanel scene={selected} scenes={scenes} film={film} isActive={selectedIsActive} busy={busy} auto={auto} {...props} /> : null}
        </div>
      </div>
    </div>
  );
}

/** The pipeline's post-scene steps — REAL backend states, never faked: a ✓
 * appears only when that layer's asset actually exists, a failure shows as a
 * failure, and “queued” vs “generating” reflect the machine state. */
function GenerationStates({ film, scenes }: { film: Film; scenes: FilmScene[] }) {
  const completed = scenes.filter((s) => s.status === 'completed').length;
  const allDone = scenes.length > 0 && scenes.every((s) => DONE.has(String(s.status)));
  const sceneFailed = scenes.some((s) => s.status === 'failed');
  const audio = film.audio || null;
  const assembling = film.status === 'assembling';
  const finalReady = !!film.final_video_url && film.machine_state === 'FINAL_VIDEO';
  const continuity = scenes.some((s) => s.keyframe_url);
  const audioRunning = film.machine_state === 'AUDIO_PLANNING' || film.machine_state === 'AUDIO_GENERATING';
  const nReady = !!audio && narrationReady(audio);
  const nFailed = !!audio && audio.narration.some((n) => n.status === 'failed');
  const mReady = !!audio && musicReady(audio);
  const mFailed = audio?.music?.status === 'failed';
  const sReady = !!audio && sfxReady(audio);
  const sFailed = audio?.sfx_status === 'failed';

  type RowState = 'done' | 'active' | 'failed' | 'todo';
  const layer = (ready: boolean, failed: boolean, active: boolean, labels: { done: string; failed: string; active: string; todo: string }): { label: string; state: RowState } =>
    ready ? { label: labels.done, state: 'done' }
      : failed ? { label: labels.failed, state: 'failed' }
        : active ? { label: labels.active, state: 'active' }
          : { label: labels.todo, state: 'todo' };

  const rows: { label: string; state: RowState }[] = [
    { label: 'Script analyzed', state: film.plan ? 'done' : 'active' },
    { label: `Video scenes (${completed}/${scenes.length})`, state: allDone ? 'done' : sceneFailed ? 'failed' : 'active' },
    { label: 'Character continuity', state: continuity ? 'done' : 'todo' },
    layer(nReady, nFailed, audioRunning && !nReady, { done: 'Narration ready', failed: 'Narration failed', active: 'Generating narration…', todo: audio ? 'Narration queued' : 'Narration' }),
    layer(mReady, !!mFailed, audioRunning && nReady && !mReady, { done: audio?.music?.status === 'skipped' ? 'Music skipped' : 'Music selected', failed: 'Music failed', active: 'Selecting music…', todo: audio ? 'Music queued' : 'Music' }),
    layer(sReady, !!sFailed, audioRunning && nReady && mReady && !sReady, { done: audio?.sfx_status === 'skipped' ? 'SFX skipped' : audio?.sfx_status === 'none' ? 'No SFX needed' : 'SFX prepared', failed: 'SFX failed', active: 'Preparing SFX…', todo: audio ? 'SFX queued' : 'SFX' }),
    finalReady
      ? { label: 'Final video ready', state: 'done' as const }
      : assembling
        ? { label: 'Assembling final video…', state: 'active' as const }
        : { label: 'Ready for Final Assembly', state: allDone && !!audio && audioReady(audio) ? 'done' as const : 'todo' as const },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color: r.state === 'done' ? T.done : r.state === 'active' ? T.live : r.state === 'failed' ? T.fault : T.dim, display: 'flex', flexShrink: 0 }}>
            {r.state === 'done' ? <Check size={11} /> : r.state === 'active' ? <CircleDot size={11} /> : r.state === 'failed' ? <AlertTriangle size={11} /> : <Circle size={10} />}
          </span>
          <span style={{ color: r.state === 'todo' ? T.dim : r.state === 'failed' ? T.fault : T.muted, fontSize: 11 }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span style={{ color: T.dim, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', width: 92, flexShrink: 0 }}>{label}</span>
      <span style={{ color: T.bone, fontSize: 12.5, lineHeight: 1.5, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function ScenePanel(props: {
  scene: FilmScene;
  scenes: FilmScene[];
  film: Film;
  isActive: boolean;
  busy: boolean;
  auto: boolean;
  onGenerate: (scene: FilmScene) => void;
  onPrepare: (scene: FilmScene) => void;
  onRetry: (scene: FilmScene) => void;
  onRegenPrompt: (scene: FilmScene) => void;
  onUseCharRef: (scene: FilmScene) => void;
  onSkip: (scene: FilmScene) => void;
}) {
  const { scene: s, scenes, film, isActive, busy } = props;
  const meta = statusMeta(s);
  const prev = [...scenes].filter((x) => x.idx < s.idx && x.status === 'completed').sort((a, b) => b.idx - a.idx)[0] || null;
  const refs = Array.isArray(s.reference_assets) ? s.reference_assets : [];
  const working = busy || s.status === 'generating';

  return (
    <div style={{ background: T.raised, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '18px 20px', marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: T.bone, fontSize: 17, fontWeight: 800, letterSpacing: 0.5, fontFamily: T.mono }}>SCENE {String(s.idx + 1).padStart(2, '0')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: meta.color, fontSize: 11.5, fontWeight: 700, border: `1px solid ${meta.color}`, borderRadius: 999, padding: '2px 10px' }}>{meta.icon} {meta.word}</span>
      </div>

      <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.55, fontStyle: 'italic', marginTop: 12 }}>“{String(s.script_segment || '').slice(0, 320)}{String(s.script_segment || '').length > 320 ? '…' : ''}”</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        <MetaRow label="Duration">{Math.round(Number(s.duration_s) || 6)}s</MetaRow>
        {s.prompt ? (
          <MetaRow label="Continuity">
            {s.continuation ? (
              <span style={{ color: T.done }}><Check size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />Continuing from Scene {prev ? String(prev.idx + 1).padStart(2, '0') : '—'}</span>
            ) : (
              <span>Independent scene{prev ? ' — the previous frame is deliberately NOT used' : ''}</span>
            )}
          </MetaRow>
        ) : null}
        {s.prompt ? <MetaRow label="Reference">{referenceLabel(s, scenes)}</MetaRow> : null}
        {(s.spec as any)?.reasoning ? <MetaRow label="Director">{String((s.spec as any).reasoning)}</MetaRow> : null}
      </div>

      {refs.length ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {refs.map((r, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <img src={r.url} alt="" style={{ width: 84, height: 56, objectFit: 'cover', borderRadius: 7, border: `1px solid ${T.dim}` }} />
              <div style={{ color: T.dim, fontSize: 10, marginTop: 3 }}>{r.role === 'first_frame' ? 'seed frame' : 'reference'}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Only the ACTIVE scene's full prompt is exposed — completed scenes keep
          theirs for reference; future scenes have none yet. */}
      {s.prompt ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: T.dim, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Prompt</div>
          <div style={{ background: '#0E0E11', border: `1px solid ${T.dim}`, borderRadius: 9, padding: '12px 14px', color: T.bone, fontSize: 12, lineHeight: 1.65, fontFamily: T.mono, maxHeight: 210, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{s.prompt}</div>
        </div>
      ) : s.status === 'waiting' ? (
        <div style={{ color: T.dim, fontSize: 12.5, marginTop: 14 }}>
          {isActive ? 'The director prepares this scene\u2019s prompt after the previous clip lands (or prepare it now).' : 'Waiting its turn — the prompt is written one scene at a time, after the previous clip\u2019s final frame is known.'}
        </div>
      ) : null}

      {s.status === 'failed' && s.error ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: T.fault, fontSize: 12.5, lineHeight: 1.55, marginTop: 14, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{s.error}</span>
        </div>
      ) : null}

      {/* Completed clip playback + final frame */}
      {s.status === 'completed' && s.asset_url ? (
        <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <video key={s.asset_url} src={s.asset_url} controls preload="metadata" style={{ maxWidth: film.aspect_ratio === '9:16' ? 200 : 380, maxHeight: 300, borderRadius: 10, background: '#000', border: '1px solid rgba(255,255,255,0.06)' }} />
          {s.keyframe_url ? (
            <div>
              <img src={s.keyframe_url} alt="" style={{ width: film.aspect_ratio === '9:16' ? 110 : 190, borderRadius: 8, border: `1px solid ${T.dim}`, display: 'block' }} />
              <div style={{ color: T.dim, fontSize: 10.5, marginTop: 4 }}>Extracted final frame (continuity)</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {s.status === 'completed' && s.validation && s.validation.pass === false ? (
        <div style={{ color: T.fault, fontSize: 11.5, marginTop: 10 }}><AlertTriangle size={11} style={{ display: 'inline', marginRight: 5, verticalAlign: '-1px' }} />Director flag: {s.validation.issues || 'does not match the segment'} — use “New prompt” below to redo it.</div>
      ) : null}

      {/* —— Actions —— */}
      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        {s.status === 'ready' && s.prompt ? (
          <button
            className="s2v-lift"
            disabled={working}
            onClick={() => props.onGenerate(s)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: working ? T.raised : T.live, color: working ? T.dim : '#1A1205', border: 'none', borderRadius: 10, padding: '12px 26px', fontSize: 14, fontWeight: 700, cursor: working ? 'default' : 'pointer', boxShadow: working ? 'none' : '0 2px 12px rgba(232,163,60,0.25)' }}
          >
            <Play size={15} /> Generate Video
          </button>
        ) : null}
        {s.status === 'waiting' && isActive ? (
          <button className="s2v-ghost" disabled={working} onClick={() => props.onPrepare(s)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.canvas, border: `1px solid ${T.dim}`, color: T.bone, borderRadius: 9, padding: '10px 18px', fontSize: 13, cursor: 'pointer' }}>
            <Wand2 size={13} /> Prepare this scene
          </button>
        ) : null}
        {s.status === 'generating' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: T.live, fontSize: 13, fontWeight: 600, padding: '11px 4px' }}>
            <Loader2 size={15} className="animate-spin" /> Generating — the clip, its real duration and its final frame land automatically…
          </div>
        ) : null}
        {s.status === 'failed' ? (
          <>
            <button className="s2v-lift" disabled={working} onClick={() => props.onRetry(s)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.live, color: '#1A1205', border: 'none', borderRadius: 9, padding: '10px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              <RefreshCw size={13} /> Retry
            </button>
            <button className="s2v-ghost" disabled={working} onClick={() => props.onRegenPrompt(s)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${T.dim}`, color: T.bone, borderRadius: 9, padding: '10px 16px', fontSize: 12.5, cursor: 'pointer' }}>
              <Sparkles size={13} /> Regenerate prompt
            </button>
            <button className="s2v-ghost" disabled={working} onClick={() => props.onUseCharRef(s)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${T.dim}`, color: T.bone, borderRadius: 9, padding: '10px 16px', fontSize: 12.5, cursor: 'pointer' }}>
              <UserRound size={13} /> Use character reference
            </button>
            <button className="s2v-ghost" disabled={working} onClick={() => props.onSkip(s)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', color: T.muted, borderRadius: 9, padding: '10px 12px', fontSize: 12.5, cursor: 'pointer' }}>
              <SkipForward size={13} /> Skip scene
            </button>
          </>
        ) : null}
        {s.status === 'ready' && s.prompt && !working ? (
          <button className="s2v-ghost" onClick={() => props.onRegenPrompt(s)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 9, padding: '10px 16px', fontSize: 12.5, cursor: 'pointer' }}>
            <Sparkles size={13} /> New prompt
          </button>
        ) : null}
        {s.status === 'completed' && !working ? (
          <button className="s2v-ghost" onClick={() => props.onRegenPrompt(s)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 9, padding: '9px 15px', fontSize: 12, cursor: 'pointer' }} title="Opus writes a fresh prompt for this scene; generate again to replace the clip. Other scenes are untouched.">
            <RefreshCw size={12} /> Redo this scene
          </button>
        ) : null}
      </div>

      {s.status === 'ready' && s.prompt && !props.auto ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.dim, fontSize: 11.5, marginTop: 12 }}>
          <ArrowRight size={11} /> Generation starts only when you click — prompt preparation and rendering are separate steps.
        </div>
      ) : null}
    </div>
  );
}
