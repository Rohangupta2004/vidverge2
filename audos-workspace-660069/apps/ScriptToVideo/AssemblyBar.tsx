/**
 * Persistent FINAL ASSEMBLY action bar — pinned to the bottom of the app in
 * normal document flow (never an overlay), so it is ALWAYS visible and can
 * never be covered by the chat input, the timeline, or scrolling content.
 *
 * Every chip and every button state reflects the REAL backend state: a ✓
 * appears only when that layer's asset actually exists.
 *   Preparing  → disabled  "FINAL ASSEMBLY — Preparing assets…"
 *   Ready      → enabled, prominent  "FINAL ASSEMBLY"
 *   Assembling → "ASSEMBLING VIDEO… 72%" with real FFmpeg progress
 *   Complete   → "✓ FINAL VIDEO READY" + [Preview] [Download] [Edit]
 */
import { AlertTriangle, Check, CircleDot, Download, Layers, Loader2, Mic, Pencil, Play, RefreshCw } from 'lucide-react';
import { Film, FilmScene, T } from './api';
import { audioReady, musicReady, narrationReady, sfxReady } from './pipeline/audio';
import { AssemblyProgress } from './pipeline/orchestrator';

const DONE = new Set(['completed', 'skipped']);

function Chip({ state, label }: { state: 'done' | 'active' | 'failed' | 'todo'; label: string }) {
  const color = state === 'done' ? T.done : state === 'active' ? T.live : state === 'failed' ? T.fault : T.dim;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, border: `1px solid ${state === 'todo' ? T.dim : color}`, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>
      {state === 'done' ? <Check size={11} /> : state === 'active' ? <Loader2 size={11} className="animate-spin" /> : state === 'failed' ? <AlertTriangle size={11} /> : <CircleDot size={10} />}
      {label}
    </span>
  );
}

const barBtn = (kind: 'accent' | 'disabled' | 'ghost' | 'fault') => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  background: kind === 'accent' ? T.live : kind === 'fault' ? 'rgba(226,114,111,0.12)' : T.raised,
  color: kind === 'accent' ? '#1A1205' : kind === 'fault' ? T.fault : kind === 'ghost' ? T.bone : T.dim,
  border: kind === 'ghost' ? `1px solid ${T.dim}` : kind === 'fault' ? '1px solid rgba(226,114,111,0.4)' : 'none',
  borderRadius: 10, padding: '11px 20px', fontSize: 13, fontWeight: 800, letterSpacing: 0.4,
  cursor: kind === 'disabled' ? 'default' : 'pointer', whiteSpace: 'nowrap' as const,
  boxShadow: kind === 'accent' ? '0 2px 12px rgba(232,163,60,0.3)' : 'none',
} as const);

const miniBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: T.raised, color: T.bone,
  border: `1px solid ${T.dim}`, borderRadius: 9, padding: '9px 14px', fontSize: 12, fontWeight: 650,
  cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap' as const,
} as const;

export default function AssemblyBar(props: {
  film: Film;
  scenes: FilmScene[];
  assembly: AssemblyProgress | null;
  busy: boolean;
  screen: 'board' | 'final';
  onFinalAssembly: () => void;
  onPrepareAudio: () => void;
  onOpenFinal: () => void;
  onOpenBoard: () => void;
}) {
  const { film, assembly, busy } = props;
  const scenes = [...(Array.isArray(props.scenes) ? props.scenes : [])].sort((a, b) => a.idx - b.idx);
  const total = scenes.length;
  const completedN = scenes.filter((s) => s.status === 'completed').length;
  const allDone = total > 0 && scenes.every((s) => DONE.has(String(s.status)));
  const sceneFailed = scenes.some((s) => s.status === 'failed');

  const audio = film.audio || null;
  const audioRunning = film.machine_state === 'AUDIO_PLANNING' || film.machine_state === 'AUDIO_GENERATING';
  const assembling = film.status === 'assembling' || !!(assembly && assembly.running);
  const complete = !assembling && film.status === 'ready' && !!film.final_video_url;

  const nReady = !!audio && narrationReady(audio);
  const mReady = !!audio && musicReady(audio);
  const sReady = !!audio && sfxReady(audio);
  const nFail = !!audio && audio.narration.some((n) => n.status === 'failed');
  const mFail = audio?.music?.status === 'failed';
  const sFail = audio?.sfx_status === 'failed';
  const anyAudioFail = nFail || !!mFail || !!sFail;
  const audioIsReady = !!audio && audioReady(audio);
  const canAssemble = allDone && audioIsReady && !busy && !assembling;

  const layerChip = (ready: boolean, failed: boolean, active: boolean): 'done' | 'active' | 'failed' | 'todo' =>
    ready ? 'done' : failed ? 'failed' : active ? 'active' : 'todo';

  const pct = assembly ? assembly.percent : 0;

  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${T.raised}`, background: '#17171B', padding: '9px 14px 10px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', boxShadow: '0 -8px 24px rgba(0,0,0,0.35)' }}>
      {/* —— Real layer states —— */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', minWidth: 0, flex: '1 1 240px' }}>
        <Chip state={allDone ? 'done' : sceneFailed ? 'failed' : 'active'} label={allDone ? `${completedN} Scenes` : `Scenes ${completedN}/${total}`} />
        <Chip state={layerChip(nReady, nFail, audioRunning && !nReady)} label="Narration" />
        <Chip state={layerChip(mReady, !!mFail, audioRunning && nReady && !mReady)} label={audio?.music?.status === 'skipped' ? 'Music skipped' : 'Music'} />
        <Chip state={layerChip(sReady, !!sFail, audioRunning && nReady && mReady && !sReady)} label={audio?.sfx_status === 'skipped' ? 'SFX skipped' : audio?.sfx_status === 'none' ? 'No SFX' : 'SFX'} />
        {props.screen === 'board' && allDone && !complete ? (
          <button className="s2v-ghost" onClick={props.onOpenFinal} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline', padding: '2px 4px' }}>
            Audio &amp; assembly ›
          </button>
        ) : null}
      </div>

      {/* —— The one Final Assembly control, with real states —— */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
        {complete ? (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.done, fontSize: 12.5, fontWeight: 800, letterSpacing: 0.5 }}>
              <Check size={14} /> FINAL VIDEO READY
            </span>
            <button className="s2v-lift" style={miniBtn} onClick={props.onOpenFinal}><Play size={13} /> Preview</button>
            <a className="s2v-lift" style={miniBtn} href={String(film.final_video_url)} download target="_blank" rel="noreferrer"><Download size={13} /> Download</a>
            <button className="s2v-lift" style={miniBtn} onClick={props.onOpenBoard}><Pencil size={13} /> Edit</button>
            {canAssemble ? (
              <button className="s2v-ghost" onClick={props.onFinalAssembly} title="Re-mix the audio layers over the existing clips and render again — video is never regenerated." style={{ background: 'none', border: 'none', color: T.muted, fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline', padding: '2px 4px' }}>
                <RefreshCw size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />Re-run assembly
              </button>
            ) : null}
          </>
        ) : assembling ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 110, height: 4, background: T.raised, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: T.live, transition: 'width 0.5s ease' }} />
            </div>
            <button disabled style={barBtn('disabled')}>
              <Loader2 size={14} className="animate-spin" /> ASSEMBLING VIDEO… {pct}%
            </button>
          </div>
        ) : !allDone ? (
          <button disabled style={barBtn('disabled')} title="Final Assembly unlocks when every scene is completed or skipped.">
            <Layers size={14} /> FINAL ASSEMBLY — {completedN}/{total} SCENES
          </button>
        ) : canAssemble ? (
          <button className="s2v-lift" style={barBtn('accent')} onClick={props.onFinalAssembly} title="Existing scene videos + ElevenLabs narration + music + SFX → FFmpeg merge → final MP4. No scene is ever regenerated.">
            <Layers size={15} /> FINAL ASSEMBLY
          </button>
        ) : anyAudioFail ? (
          <button style={barBtn('fault')} onClick={props.onOpenFinal} title="An audio layer failed — retry it or continue without it. Completed scenes are untouched.">
            <AlertTriangle size={14} /> FINAL ASSEMBLY — AUDIO NEEDS ATTENTION
          </button>
        ) : audioRunning || busy ? (
          <button disabled style={barBtn('disabled')}>
            <Loader2 size={14} className="animate-spin" /> FINAL ASSEMBLY — PREPARING ASSETS…
          </button>
        ) : (
          <button className="s2v-lift" style={barBtn('accent')} onClick={props.onPrepareAudio} title="Runs the post-production steps: narration → music → SFX. Video scenes are reused, never regenerated.">
            <Mic size={14} /> {audio ? 'FINISH AUDIO PREP' : 'PREPARE AUDIO'}
          </button>
        )}
      </div>
    </div>
  );
}
