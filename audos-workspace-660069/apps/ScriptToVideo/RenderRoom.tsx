/**
 * Sequential production board — the live view of a film generating clip by
 * clip. Left rail: every scene with its live status. Right panel: THE ACTIVE
 * SCENE only — its duration, continuity decision, reference assets and full
 * prepared prompt, with the explicit [Generate Video] trigger. Future scenes'
 * prompts are never shown (they do not exist yet — the director prepares one
 * clip at a time). Failed scenes offer per-scene recovery that never touches
 * completed clips.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Check, Circle, CircleDot,
  Loader2, Play, RefreshCw, SkipForward, Sparkles, UserRound, Wand2, Zap,
} from 'lucide-react';
import { Film, FilmScene, T } from './api';
import { audioReady, isSpokenSource, musicReady, narrationReady, sfxReady } from './pipeline/audio';
import { videoEngine } from '../../lib/videoEngines';

const DONE = new Set(['completed', 'skipped']);

function customerError(value: unknown): string {
  const raw = String(value || 'This step could not be completed.');
  const named = raw.replace(/(?:openrouter\/[^\s,;]+|gemini-omni-flash-preview|veo-[\w.-]+)/g, (id) => videoEngine(id)?.label || 'the selected video engine');
  if (/no_credentials|\b401\b/i.test(named)) return 'Your workspace session is not ready yet. Try again in a moment.';
  if (/insufficient|payment|required|\b402\b/i.test(named)) return 'This generation needs more workspace credits before it can start.';
  if (/rate.?limit|\b429\b/i.test(named)) return 'The video service is busy right now. Wait a moment, then retry this scene.';
  if (/provider[_ -]?error|\b50[0234]\b|service unavailable/i.test(named)) return 'The video service is temporarily unavailable. Your completed scenes are safe; retry this scene shortly.';
  return named;
}

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
  const base = (() => {
    switch (String(s.reference_type || '')) {
      case 'previous_final_frame': return prev ? `Scene ${prev.idx + 1} final frame` : 'Previous final frame';
      case 'character_reference': return 'Character reference';
      case 'scene_reference': return 'Scene reference image';
      default: return 'None — prompt only';
    }
  })();
  // The dual reference: a seed frame AND a character image travelling together.
  const assets = Array.isArray(s.reference_assets) ? s.reference_assets : [];
  const dual = assets.some((a) => a.role === 'first_frame') && assets.some((a) => a.role === 'reference');
  return dual ? `${base} + character reference` : base;
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
  onRedo: (scene: FilmScene) => void;
  redoingId: number | null;
  onUseCharRef: (scene: FilmScene) => void;
  onSkip: (scene: FilmScene) => void;
}) {
  const { film, note, busy, auto, autoPost } = props;
  const scenes = [...(Array.isArray(props.scenes) ? props.scenes : [])].sort((a, b) => a.idx - b.idx);
  const completed = scenes.filter((s) => s.status === 'completed');
  const failedScenes = scenes.filter((s) => s.status === 'failed');
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
          {generating ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.live, fontSize: 11.5, fontWeight: 700, marginTop: 4 }}>
              <Loader2 size={11} className="animate-spin" /> Generating scene {generating.idx + 1}/{scenes.length}
            </div>
          ) : null}
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
          <details>
            <summary style={{ cursor: 'pointer', color: T.muted, fontSize: 12, fontWeight: 700, listStylePosition: 'inside' }}>Advanced — automation</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 9 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title="Prepare → generate → extract frame → decide continuity → next — still strictly one clip at a time. Remembered per film, so reopening this one picks up where it left off.">
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
          </details>
        </div>
      </div>

      {/* —— Active scene panel —— */}
      <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, padding: '18px 22px 28px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {/* Persisted pipeline stage, collapsed so the active scene remains the focus. */}
          <details style={{ marginBottom: 10, background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.raised}`, borderRadius: 10, padding: '9px 12px' }}>
            <summary style={{ cursor: 'pointer', color: generating || assembling ? T.live : T.muted, fontSize: 12.5, fontWeight: 700, listStylePosition: 'inside' }}>
              Production status — {note || film.stage_note || (active ? 'Waiting for the next scene' : 'Waiting for you')}
            </summary>
            <div style={{ marginTop: 9 }}><GenerationStates film={film} scenes={scenes} /></div>
          </details>
          {film.error ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: T.fault, fontSize: 12.5, lineHeight: 1.55, margin: '6px 0 10px', background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{customerError(film.error)}</span>
            </div>
          ) : null}

          {/* Partial failures are never swallowed: the scenes that refused are
              listed here with their real reason and a retry that touches only
              them, while every other clip keeps its progress. */}
          {failedScenes.length ? (
            <div style={{ marginTop: 6, marginBottom: 10, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.3)', borderRadius: 12, padding: '13px 15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <AlertTriangle size={14} color={T.fault} style={{ flexShrink: 0 }} />
                <span style={{ color: T.fault, fontSize: 13, fontWeight: 700 }}>
                  {completed.length} of {scenes.length} scenes succeeded, {failedScenes.length} failed
                </span>
                <button
                  className="s2v-lift"
                  disabled={busy || !!generating}
                  onClick={() => { const first = failedScenes[0]; if (first) props.onRetry(first); }}
                  style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, background: busy || generating ? T.raised : T.live, color: busy || generating ? T.dim : '#1A1205', border: 'none', borderRadius: 9, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: busy || generating ? 'default' : 'pointer' }}
                >
                  <RefreshCw size={12} /> Retry failed only
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {failedScenes.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: T.muted, fontFamily: T.mono, fontSize: 11, flexShrink: 0, paddingTop: 1 }}>Scene {String(s.idx + 1).padStart(2, '0')}</span>
                    <span style={{ color: T.fault, fontSize: 11.5, lineHeight: 1.5, minWidth: 0, flex: 1 }}>{customerError(s.error)}</span>
                    <button className="s2v-ghost" disabled={busy || !!generating} onClick={() => props.onRetry(s)} style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 8, padding: '4px 10px', fontSize: 11, cursor: busy || generating ? 'default' : 'pointer' }}>Retry</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {allDone && !selected ? (
            <div style={{ color: T.done, fontSize: 14, marginTop: 30, textAlign: 'center' }}>All scenes are complete — assemble the final film.</div>
          ) : null}

          {selected ? <ScenePanel {...props} scene={selected} scenes={scenes} film={film} isActive={selectedIsActive} busy={busy} auto={auto} /> : null}
        </div>
      </div>
    </div>
  );
}

/** The pipeline's post-scene steps — REAL backend states, never faked: a ✓
 * appears only when that layer's asset actually exists, a failure shows as a
 * failure, and “queued” vs “generating” reflect the machine state. */
function formatStepElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

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
  const nFailed = !!audio && audio.narration.some((n) => isSpokenSource(n.voice_source) && n.status === 'failed');
  const silentVoice = audio?.voice_source === 'none';
  const mReady = !!audio && musicReady(audio);
  const mFailed = audio?.music?.status === 'failed';
  const sReady = !!audio && sfxReady(audio);
  const sFailed = audio?.sfx_status === 'failed';

  type RowState = 'done' | 'active' | 'failed' | 'todo';
  type Row = { key: string; label: string; state: RowState };
  const layer = (key: string, ready: boolean, failed: boolean, active: boolean, labels: { done: string; failed: string; active: string; todo: string }): Row =>
    ready ? { key, label: labels.done, state: 'done' }
      : failed ? { key, label: labels.failed, state: 'failed' }
        : active ? { key, label: labels.active, state: 'active' }
          : { key, label: labels.todo, state: 'todo' };

  const rows: Row[] = [
    { key: 'script', label: 'Script analyzed', state: film.plan ? 'done' : 'active' },
    { key: 'scenes', label: `Video scenes (${completed}/${scenes.length})`, state: allDone ? 'done' : sceneFailed ? 'failed' : 'active' },
    { key: 'continuity', label: 'Character continuity', state: continuity ? 'done' : 'todo' },
    layer('narration', nReady, nFailed, audioRunning && !nReady, { done: silentVoice ? 'No voiceover' : 'Voiceover ready', failed: 'Voiceover failed', active: 'Recording the voiceover…', todo: audio ? 'Voiceover queued' : 'Voiceover (optional)' }),
    layer('music', mReady, !!mFailed, audioRunning && nReady && !mReady, { done: audio?.music?.status === 'skipped' ? 'Music skipped' : 'Music selected', failed: 'Music failed', active: 'Selecting music…', todo: audio ? 'Music queued' : 'Music' }),
    layer('sfx', sReady, !!sFailed, audioRunning && nReady && mReady && !sReady, { done: audio?.sfx_status === 'skipped' ? 'SFX skipped' : audio?.sfx_status === 'none' ? 'No SFX needed' : 'SFX prepared', failed: 'SFX failed', active: 'Preparing SFX…', todo: audio ? 'SFX queued' : 'SFX' }),
    finalReady
      ? { key: 'assembly', label: 'Final video ready', state: 'done' as const }
      : assembling
        ? { key: 'assembly', label: 'Assembling final video…', state: 'active' as const }
        : { key: 'assembly', label: allDone && !!audio && audioReady(audio) ? 'Ready for Final Assembly' : 'Final assembly', state: 'todo' as const },
  ];

  const timings = useRef<Record<string, { state: RowState; startedAt?: number; elapsedMs?: number }>>({});
  const [nowMs, setNowMs] = useState(Date.now());
  const signature = rows.map((row) => `${row.key}:${row.state}`).join('|');
  useEffect(() => {
    const now = Date.now();
    const reopenedAt = Date.parse(String(film.updated_at || ''));
    const next = { ...timings.current };
    rows.forEach((row) => {
      const previous = next[row.key];
      if (row.state === 'active' && previous?.state !== 'active') {
        next[row.key] = { state: row.state, startedAt: previous ? now : (Number.isFinite(reopenedAt) ? reopenedAt : now) };
      } else if (row.state !== 'active' && previous?.state === 'active' && previous.startedAt) {
        next[row.key] = { state: row.state, elapsedMs: Math.max(0, now - previous.startedAt) };
      } else {
        next[row.key] = { ...previous, state: row.state };
      }
    });
    timings.current = next;
    setNowMs(now);
  }, [film.id, film.updated_at, signature]);
  const hasRunning = rows.some((row) => row.state === 'active');
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunning, signature]);

  const statusWord = (state: RowState) => state === 'active' ? 'running' : state === 'todo' ? 'pending' : state;
  const elapsedFor = (row: Row) => {
    const timing = timings.current[row.key];
    if (row.state === 'active' && timing?.startedAt) return formatStepElapsed(nowMs - timing.startedAt);
    if ((row.state === 'done' || row.state === 'failed') && timing?.elapsedMs !== undefined) return formatStepElapsed(timing.elapsedMs);
    return '—';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {rows.map((r) => (
        <div key={r.key} className="s2v-row" style={{ display: 'flex', alignItems: 'center', gap: 7, borderRadius: 7, padding: '3px 5px' }}>
          <span style={{ color: r.state === 'done' ? T.done : r.state === 'active' ? T.live : r.state === 'failed' ? T.fault : T.dim, display: 'flex', flexShrink: 0 }}>
            {r.state === 'done' ? <Check size={11} /> : r.state === 'active' ? <Loader2 size={11} className="animate-spin" /> : r.state === 'failed' ? <AlertTriangle size={11} /> : <Circle size={10} />}
          </span>
          <span style={{ color: r.state === 'todo' ? T.dim : r.state === 'failed' ? T.fault : T.muted, fontSize: 11, minWidth: 0, flex: 1 }}>{r.label}</span>
          <span style={{ color: r.state === 'failed' ? T.fault : r.state === 'active' ? T.live : T.dim, fontSize: 9.5, fontFamily: T.mono, textTransform: 'uppercase' }}>{statusWord(r.state)}</span>
          <span style={{ width: 46, textAlign: 'right', color: T.dim, fontSize: 9.5, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>{elapsedFor(r)}</span>
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
  onRedo: (scene: FilmScene) => void;
  redoingId: number | null;
  onUseCharRef: (scene: FilmScene) => void;
  onSkip: (scene: FilmScene) => void;
}) {
  const { scene: s, scenes, film, isActive, busy } = props;
  const meta = statusMeta(s);
  const prev = [...scenes].filter((x) => x.idx < s.idx && x.status === 'completed').sort((a, b) => b.idx - a.idx)[0] || null;
  const refs = Array.isArray(s.reference_assets) ? s.reference_assets : [];
  const working = busy || s.status === 'generating';
  // LightBeam: the ACTIVE scene card carries the amber focus glow.
  const activeGlow = isActive && !DONE.has(String(s.status));

  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '18px 20px', marginTop: 6, boxShadow: activeGlow ? '0 0 0 2px #f59e0b, 0 0 20px rgba(245,158,11,0.3)' : 'none', transition: 'box-shadow 0.3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: T.bone, fontSize: 17, fontWeight: 800, letterSpacing: 0.5, fontFamily: T.mono }}>SCENE {String(s.idx + 1).padStart(2, '0')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: meta.color, fontSize: 11.5, fontWeight: 700, border: `1px solid ${meta.color}`, borderRadius: 999, padding: '2px 10px' }}>{meta.icon} {meta.word}</span>
      </div>

      {/* An empty segment used to render as a pair of bare quote marks. */}
      <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.55, fontStyle: 'italic', marginTop: 12 }}>
        {String(s.script_segment || '').trim()
          ? `“${String(s.script_segment).slice(0, 320)}${String(s.script_segment).length > 320 ? '…' : ''}”`
          : 'This clip carries no spoken line — it is a visual beat the director wrote from the surrounding story.'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        <MetaRow label="Duration">{Math.round(Number(s.duration_s) || 6)}s</MetaRow>
        {s.prompt ? (
          <MetaRow label="Continuity">
            {s.continuation ? (
              <span style={{ color: T.done }}><Check size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />{prev ? `Continuing from Scene ${String(prev.idx + 1).padStart(2, '0')}` : 'Continuing from the previous clip'}</span>
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

      {/* Skeleton shimmer while the clip renders (pure CSS keyframes). */}
      {s.status === 'generating' ? (
        <div style={{ marginTop: 14 }}>
          <div className="lb-shimmer" style={{ width: film.aspect_ratio === '9:16' ? 200 : 380, height: film.aspect_ratio === '9:16' ? 300 : 214, borderRadius: 12 }} />
          <div className="lb-shimmer" style={{ width: 260, height: 12, marginTop: 10 }} />
          <div className="lb-shimmer" style={{ width: 180, height: 12, marginTop: 6 }} />
        </div>
      ) : null}

      {s.status === 'failed' && s.error ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: T.fault, fontSize: 12.5, lineHeight: 1.55, marginTop: 14, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{customerError(s.error)}</span>
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
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: working ? T.raised : T.live, color: working ? T.dim : '#1A1205', border: 'none', borderRadius: 10, padding: '12px 26px', fontSize: 14, fontWeight: 700, cursor: working ? 'default' : 'pointer', boxShadow: working ? 'none' : '0 2px 12px rgba(245,158,11,0.25)' }}
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
            <Loader2 size={15} className="animate-spin" /> Generating scene {s.idx + 1}/{scenes.length} — the clip, its real duration and its final frame land automatically…
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
        {s.status === 'completed' && props.redoingId === s.id ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: T.live, fontSize: 12.5, fontWeight: 600, padding: '10px 4px' }}>
            <Loader2 size={14} className="animate-spin" /> Redoing — the director is writing a fresh prompt, then the clip re-renders. Other scenes are untouched.
          </div>
        ) : s.status === 'completed' && !working ? (
          <button className="s2v-ghost" disabled={props.redoingId != null} onClick={() => props.onRedo(s)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 9, padding: '9px 15px', fontSize: 12, cursor: props.redoingId != null ? 'default' : 'pointer', opacity: props.redoingId != null ? 0.5 : 1 }} title="Opus writes a fresh prompt and the clip re-renders in place. Other scenes are untouched.">
            <RefreshCw size={12} /> Redo this scene
          </button>
        ) : null}
      </div>

      {s.status === 'ready' && s.prompt ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: props.auto ? T.live : T.dim, fontSize: 11.5, marginTop: 12 }}>
          {props.auto ? <Zap size={11} /> : <ArrowRight size={11} />}
          {props.auto
            ? 'Auto-generate is on — this clip starts rendering by itself, then the next prompt is prepared.'
            : 'Generation starts only when you click — prompt preparation and rendering are separate steps.'}
        </div>
      ) : null}
    </div>
  );
}
