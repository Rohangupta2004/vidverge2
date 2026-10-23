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
 *
 * ASSEMBLY IS AUTOMATIC. Once every scene and every audio layer is ready the
 * film assembles itself, so the big button is a way to start it sooner (or to
 * re-run it), not the only way it ever happens. "Review before assembly" is
 * the opt-in beside it for anyone who wants a look at the cut first.
 */
import { AlertTriangle, Check, Download, Layers, Mic, Pencil, Play, RefreshCw, Square } from 'lucide-react';
import { Film, FilmScene, T } from './api';
import { audioReady, isSpokenSource } from './pipeline/audio';
import { AssemblyProgress } from './pipeline/orchestrator';
import VergeLoader from '../../components/VergeLoader';

const DONE = new Set(['completed', 'skipped']);

const ON_ACCENT = 'var(--vg-on-accent, #1B1308)';

const barBtn = (kind: 'accent' | 'disabled' | 'ghost' | 'fault') => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  background: kind === 'accent' ? 'var(--vg-gradient-action, var(--vg-accent, #D9A441))' : kind === 'fault' ? `color-mix(in srgb, ${T.fault} 14%, transparent)` : T.raised,
  color: kind === 'accent' ? ON_ACCENT : kind === 'fault' ? T.fault : kind === 'ghost' ? T.bone : T.dim,
  border: kind === 'fault' ? `1px solid color-mix(in srgb, ${T.fault} 45%, transparent)` : kind === 'accent' ? 'none' : `1px solid ${T.line}`,
  borderRadius: 10, padding: '11px 20px', minHeight: 44, maxWidth: '100%', fontSize: 13, fontWeight: 800, letterSpacing: 0.4,
  lineHeight: 1.25, textAlign: 'center' as const,
  cursor: kind === 'disabled' ? 'not-allowed' : 'pointer', whiteSpace: 'normal' as const,
  boxShadow: kind === 'accent' ? `0 2px 14px color-mix(in srgb, ${T.live} 32%, transparent)` : 'none',
} as const);

const miniBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: T.raised, color: T.bone,
  border: `1px solid ${T.line}`, borderRadius: 9, padding: '9px 14px', minHeight: 40, fontSize: 12, fontWeight: 650,
  cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap' as const,
} as const;

const BAR_CSS = `
.s2v-asm-bar button:disabled { opacity: 1; }
.s2v-asm-bar button:not(:disabled):hover, .s2v-asm-bar a:hover { filter: brightness(1.1); }
.s2v-asm-bar a:hover { border-color: ${T.live} !important; }
.s2v-asm-bar button:focus-visible, .s2v-asm-bar a:focus-visible, .s2v-asm-bar input:focus-visible { outline: 2px solid var(--vg-focus, ${T.live}); outline-offset: 2px; }
@media (max-width: 640px) {
  .s2v-asm-bar > div { flex: 1 1 100% !important; margin-left: 0 !important; }
  .s2v-asm-bar > div > button, .s2v-asm-bar > div > a { flex: 1 1 auto; }
}
`;

export default function AssemblyBar(props: {
  film: Film;
  scenes: FilmScene[];
  assembly: AssemblyProgress | null;
  busy: boolean;
  screen: 'board' | 'final';
  onStop: () => void;
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

  const nFail = !!audio && audio.narration.some((n) => isSpokenSource(n.voice_source) && n.status === 'failed');
  const mFail = audio?.music?.status === 'failed';
  const sFail = audio?.sfx_status === 'failed';
  const anyAudioFail = nFail || !!mFail || !!sFail;
  const audioIsReady = !!audio && audioReady(audio);
  const canAssemble = allDone && audioIsReady && !busy && !assembling;

  const pct = assembly ? assembly.percent : 0;
  const activeStep = assembly?.steps.find((step) => step.status === 'active')?.label;
  const statusLine = complete ? 'Ready to download'
    : assembling ? (activeStep || 'Finishing the video')
      : !allDone ? `Producing scenes ${completedN}/${total}`
        : anyAudioFail ? 'Audio needs attention'
          : audioRunning || busy ? 'Preparing narration, music and effects'
            : canAssemble ? 'Everything is ready — final assembly is starting'
              : 'Preparing post-production';

  return (
    <div className="s2v-asm-bar" style={{ flexShrink: 0, minWidth: 0, maxWidth: '100%', borderTop: `1px solid ${T.line}`, background: T.card, padding: '10px 14px calc(10px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', boxShadow: '0 -8px 24px rgba(0,0,0,0.35)' }}>
      <style>{BAR_CSS}</style>
      <div role="status" aria-live="polite" style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, flex: '1 1 240px', color: complete ? T.done : sceneFailed || anyAudioFail ? T.fault : T.muted, fontSize: 12.5, fontWeight: 700 }}>
        {complete ? <Check size={13} /> : sceneFailed || anyAudioFail ? <AlertTriangle size={13} /> : assembling || audioRunning || busy ? <VergeLoader size={28} label={statusLine} /> : <Layers size={13} />}
        <span>{statusLine}{assembling ? ` · ${pct}%` : ''}</span>
        {props.screen === 'board' && allDone && !complete ? <button className="s2v-ghost" onClick={props.onOpenFinal} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline', padding: '2px 4px' }}>Open finish</button> : null}
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
          <button type="button" onClick={props.onStop} style={barBtn('ghost')} title="Stop after the active step. Saved scenes and audio remain ready to resume.">
            <Square size={13} fill="currentColor" /> Stop
          </button>
        ) : !allDone ? (
          <button disabled style={barBtn('disabled')} title="Final Assembly unlocks when every scene is completed or skipped.">
            <Layers size={14} /> FINAL ASSEMBLY — {completedN}/{total} SCENES
          </button>
        ) : canAssemble ? (
          <button
            className="s2v-lift"
            style={barBtn('accent')}
            onClick={props.onFinalAssembly}
            title="Assembly starts automatically. Existing scene videos and ready audio layers are reused; no scene is regenerated."
          >
            <Layers size={15} /> FINAL ASSEMBLY — STARTING…
          </button>
        ) : anyAudioFail ? (
          <button style={barBtn('fault')} onClick={props.onOpenFinal} title="An audio layer failed — retry it, or continue without it: every layer, the voiceover included, is optional. Completed scenes are untouched.">
            <AlertTriangle size={14} /> FINAL ASSEMBLY — AUDIO NEEDS ATTENTION
          </button>
        ) : audioRunning || busy ? (
          <button disabled style={barBtn('disabled')}>
            <VergeLoader size={34} label="Preparing assets" /> FINAL ASSEMBLY — PREPARING ASSETS…
          </button>
        ) : (
          <button className="s2v-lift" style={barBtn('accent')} onClick={props.onPrepareAudio} title="Runs the post-production steps: voiceover (optional) → music → SFX. Video scenes are reused, never regenerated.">
            <Mic size={14} /> {audio ? 'FINISH AUDIO PREP' : 'PREPARE AUDIO'}
          </button>
        )}
      </div>
    </div>
  );
}
