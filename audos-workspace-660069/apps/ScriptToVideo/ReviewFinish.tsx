/**
 * Final screen — the AUDIO & FINAL ASSEMBLY hub.
 *
 * Voice plan · per-scene ElevenLabs narration · music bed (auto-ducked under
 * speech) · subtle SFX · audio timeline (VIDEO / VOICE / MUSIC / SFX tracks)
 * · one-click Final Assembly with real progress. Audio work NEVER regenerates
 * the video clips: change the voice or the music and only that layer is
 * re-made before a fast re-assembly of the existing clips.
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle, Captions, Check, Circle, CircleDot, Download, Layers,
  Loader2, Mic, Music, RefreshCw, SkipForward, Sparkles, Volume2,
} from 'lucide-react';
import { Film, FilmScene, T } from './api';
import { MUSIC_PRESETS, MusicPreset, VoiceOption, listVoices } from './pipeline/finish';
import { audioReady, audioScenes, musicReady, narrationReady, sfxReady } from './pipeline/audio';
import { AssemblyProgress, sceneTargetDuration } from './pipeline/orchestrator';
import AudioCards from './AudioCards';

const fieldStyle = {
  width: '100%', background: '#151519', color: T.bone, border: `1px solid ${T.dim}`,
  borderRadius: 8, padding: '8px 10px', fontSize: 12.5,
} as const;

const smallBtn = (accent = false) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: accent ? T.live : 'transparent',
  color: accent ? '#1A1205' : T.bone,
  border: accent ? 'none' : `1px solid ${T.dim}`,
  borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 650, cursor: 'pointer',
} as const);

function StateDot({ state }: { state: 'done' | 'active' | 'failed' | 'todo' }) {
  const color = state === 'done' ? T.done : state === 'active' ? T.live : state === 'failed' ? T.fault : T.dim;
  return (
    <span style={{ color, display: 'inline-flex', flexShrink: 0 }}>
      {state === 'done' ? <Check size={12} /> : state === 'active' ? <Loader2 size={12} className="animate-spin" /> : state === 'failed' ? <AlertTriangle size={12} /> : <Circle size={11} />}
    </span>
  );
}

function Section(props: { icon: any; title: string; hint?: string; children: any }) {
  return (
    <section style={{ marginTop: 14, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 14, padding: '15px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: T.live, display: 'flex' }}>{props.icon}</span>
        <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 700 }}>{props.title}</div>
        {props.hint ? <div style={{ color: T.dim, fontSize: 11 }}>{props.hint}</div> : null}
      </div>
      <div style={{ marginTop: 10 }}>{props.children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Audio timeline — VIDEO / VOICE / MUSIC / SFX tracks over the scene layout
// ---------------------------------------------------------------------------

function TrackLabel({ children }: { children: any }) {
  return <div style={{ width: 52, flexShrink: 0, color: T.dim, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.7 }}>{children}</div>;
}

function AudioTimeline({ film, scenes }: { film: Film; scenes: FilmScene[] }) {
  const audio = film.audio || null;
  const done = audioScenes(scenes);
  if (!done.length) return null;
  const entries = new Map((audio?.narration || []).map((n) => [n.scene_key, n]));
  const target = (s: FilmScene) => sceneTargetDuration(s, entries.get(s.scene_key) || null);
  const total = done.reduce((n, s) => n + target(s), 0) || 1;
  let cursor = 0;
  const blocks = done.map((s) => {
    const block = { s, leftPct: (cursor / total) * 100, widthPct: (target(s) / total) * 100, startS: cursor };
    cursor += target(s);
    return block;
  });
  const trackStyle = { position: 'relative' as const, flex: 1, height: 18, background: '#101014', borderRadius: 5, overflow: 'hidden' };
  const musicOk = !!audio && audio.music?.status === 'ready' && !!audio.music.audioUrl;
  const sfxItems = (audio?.sfx || []).filter((f) => f.status === 'ready' && f.audioUrl);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TrackLabel>VIDEO</TrackLabel>
        <div style={trackStyle}>
          {blocks.map((b, i) => (
            <div key={b.s.id} title={`Scene ${b.s.idx + 1} · ${target(b.s).toFixed(1)}s`} style={{ position: 'absolute', left: `${b.leftPct}%`, width: `calc(${b.widthPct}% - 1px)`, top: 2, bottom: 2, background: i % 2 ? 'rgba(232,163,60,0.35)' : 'rgba(232,163,60,0.5)', borderRadius: 3 }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TrackLabel>VOICE</TrackLabel>
        <div style={trackStyle}>
          {blocks.map((b) => {
            const n = entries.get(b.s.scene_key);
            if (!n || n.voice_source === 'none') return null;
            if (n.voice_source === 'video_native') {
              return <div key={b.s.id} title={`Scene ${b.s.idx + 1}: on-camera dialogue (native voice)`} style={{ position: 'absolute', left: `${b.leftPct}%`, width: `calc(${b.widthPct}% - 1px)`, top: 2, bottom: 2, border: `1px dashed ${T.done}`, borderRadius: 3 }} />;
            }
            const voicePct = n.duration_s ? Math.min(100, (n.duration_s / target(b.s)) * 100) : 100;
            return (
              <div key={b.s.id} title={`Scene ${b.s.idx + 1}: "${(n.text || '').slice(0, 90)}"${n.duration_s ? ` · ${n.duration_s.toFixed(1)}s` : ''}`} style={{ position: 'absolute', left: `${b.leftPct}%`, width: `calc(${(b.widthPct * voicePct) / 100}% - 1px)`, top: 2, bottom: 2, background: n.status === 'ready' ? 'rgba(127,212,180,0.55)' : n.status === 'failed' ? 'rgba(226,114,111,0.5)' : 'rgba(127,212,180,0.2)', borderRadius: 3 }} />
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TrackLabel>MUSIC</TrackLabel>
        <div style={trackStyle}>
          {musicOk ? <div title={`${audio!.music!.preset} music — ducks under narration automatically`} style={{ position: 'absolute', left: 0, right: 0, top: 5, bottom: 5, background: 'linear-gradient(90deg, transparent, rgba(122,140,255,0.45) 6%, rgba(122,140,255,0.45) 94%, transparent)', borderRadius: 3 }} /> : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, color: T.dim, fontSize: 9.5 }}>{audio?.music?.status === 'skipped' ? 'skipped' : audio?.music?.status === 'failed' ? 'failed' : '—'}</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TrackLabel>SFX</TrackLabel>
        <div style={trackStyle}>
          {sfxItems.map((f, i) => {
            const b = blocks.find((x) => x.s.scene_key === f.scene_key);
            if (!b) return null;
            const at = ((b.startS + Math.min(Number(f.at_s) || 0, target(b.s))) / total) * 100;
            return <div key={i} title={`${f.description} · scene ${b.s.idx + 1} @ ${Number(f.at_s || 0).toFixed(1)}s`} style={{ position: 'absolute', left: `${at}%`, top: 3, bottom: 3, width: 5, background: T.live, borderRadius: 2 }} />;
          })}
          {!sfxItems.length ? <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, color: T.dim, fontSize: 9.5 }}>{film.audio?.sfx_status === 'skipped' ? 'skipped' : '—'}</div> : null}
        </div>
      </div>
      <div style={{ color: T.dim, fontSize: 10, marginLeft: 60 }}>{Math.round(total)}s total · narration is the authoritative voice; native clip sound stays as ambience; music ducks under speech.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Final Assembly progress — real step states, never faked
// ---------------------------------------------------------------------------

function AssemblyProgressCard({ progress }: { progress: AssemblyProgress }) {
  return (
    <div style={{ marginTop: 14, background: '#101014', border: `1px solid ${T.dim}`, borderRadius: 12, padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: T.live, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>FINAL ASSEMBLY</span>
        <span style={{ marginLeft: 'auto', color: T.bone, fontSize: 13, fontWeight: 700, fontFamily: T.mono }}>{progress.percent}%</span>
      </div>
      <div style={{ marginTop: 8, height: 4, background: T.raised, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress.percent}%`, background: progress.steps.some((s) => s.status === 'failed') ? T.fault : T.live, transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
        {progress.steps.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StateDot state={s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : s.status === 'failed' ? 'failed' : 'todo'} />
            <span style={{ color: s.status === 'pending' ? T.dim : s.status === 'failed' ? T.fault : T.muted, fontSize: 11.5 }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice & narration panel
// ---------------------------------------------------------------------------

function VoiceNarrationPanel(props: {
  film: Film;
  scenes: FilmScene[];
  voices: VoiceOption[];
  busy: boolean;
  onChangeVoice: (voiceId: string, voiceName?: string) => void;
  onRetry: () => void;
}) {
  const { film, busy } = props;
  const audio = film.audio!;
  const vp = audio.voice_plan;
  const done = audioScenes(props.scenes);
  const entries = new Map(audio.narration.map((n) => [n.scene_key, n]));
  const failed = audio.narration.some((n) => n.status === 'failed');
  return (
    <Section icon={<Mic size={15} />} title="Narration voice" hint="one consistent ElevenLabs voice for the whole film">
      {vp ? (
        <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.6 }}>
          Voice plan: <span style={{ color: T.bone }}>{vp.voiceName}</span> · tone {vp.tone} · energy {vp.energy} · pace {vp.pace} · emotion {vp.emotion} · {vp.language}{vp.accent ? ` (${vp.accent} accent)` : ''}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <select
          value={vp?.voiceId || ''}
          disabled={busy}
          onChange={(e) => {
            const v = props.voices.find((x) => x.id === e.target.value);
            if (e.target.value) props.onChangeVoice(e.target.value, v?.name);
          }}
          style={{ ...fieldStyle, width: 260 }}
          aria-label="Narration voice"
        >
          {vp?.voiceId && !props.voices.some((v) => v.id === vp.voiceId) ? <option value={vp.voiceId}>{vp.voiceName}</option> : null}
          {!vp?.voiceId ? <option value="">Choose a voice…</option> : null}
          {props.voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.labels?.accent ? ` · ${v.labels.accent}` : ''}</option>)}
        </select>
        {failed ? (
          <button style={smallBtn(true)} disabled={busy} onClick={props.onRetry}><RefreshCw size={12} /> Retry Voice</button>
        ) : null}
      </div>
      <div style={{ color: T.dim, fontSize: 10.5, marginTop: 6 }}>Changing the voice re-records the narration only — the video clips are never regenerated.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
        {done.map((s) => {
          const n = entries.get(s.scene_key);
          const clipS = Number(s.duration_s) || 6;
          return (
            <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <StateDot state={!n || n.voice_source === 'none' ? 'todo' : n.voice_source === 'video_native' ? 'done' : n.status === 'ready' ? 'done' : n.status === 'failed' ? 'failed' : 'active'} />
              <div style={{ minWidth: 0 }}>
                <span style={{ color: T.muted, fontSize: 11, fontFamily: T.mono }}>Scene {String(s.idx + 1).padStart(2, '0')} — {clipS.toFixed(1)}s</span>
                <span style={{ color: n?.voice_source === 'elevenlabs' ? T.bone : T.dim, fontSize: 11.5, marginLeft: 8 }}>
                  {!n || n.voice_source === 'none' ? 'no words (visual beat)'
                    : n.voice_source === 'video_native' ? `on-camera dialogue — the clip's own voice${s.dialogue?.line ? `: "${String(s.dialogue.line).slice(0, 70)}"` : ''}`
                    : `"${(n.text || '').slice(0, 110)}"${n.duration_s ? ` · voice ${n.duration_s.toFixed(1)}s` : ''}`}
                </span>
                {n?.error ? <div style={{ color: T.fault, fontSize: 10.5 }}>{n.error}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Music + SFX panels
// ---------------------------------------------------------------------------

function MusicPanel(props: { film: Film; busy: boolean; onChangeMusic: (preset: string) => void; onRetry: () => void; onSkip: () => void }) {
  const music = props.film.audio?.music || null;
  const state = !music ? 'todo' : music.status === 'ready' ? 'done' : music.status === 'failed' ? 'failed' : music.status === 'skipped' ? 'todo' : 'active';
  return (
    <Section icon={<Music size={15} />} title="Music bed" hint="responds to the script — ducks under narration automatically">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StateDot state={state as any} />
        <span style={{ color: T.muted, fontSize: 11.5 }}>
          {!music ? 'Planned with the audio stage.'
            : music.status === 'skipped' ? 'Skipped — the film ships without music.'
            : music.status === 'failed' ? 'Music preparation failed.'
            : music.status === 'ready' ? `${music.preset} bed ready${music.mood ? ` · ${music.mood}` : ''}` : `Composing ${music.preset}…`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 9, flexWrap: 'wrap' }}>
        <select
          value={(MUSIC_PRESETS as readonly string[]).includes(String(music?.preset)) ? String(music?.preset) : 'cinematic'}
          disabled={props.busy}
          onChange={(e) => props.onChangeMusic(e.target.value as MusicPreset)}
          style={{ ...fieldStyle, width: 190 }}
          aria-label="Music style"
        >
          {MUSIC_PRESETS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select>
        {music?.status === 'failed' ? <button style={smallBtn(true)} disabled={props.busy} onClick={props.onRetry}><RefreshCw size={12} /> Retry</button> : null}
        {music && music.status !== 'skipped' ? <button style={smallBtn()} disabled={props.busy} onClick={props.onSkip}><SkipForward size={12} /> Continue Without Music</button> : null}
      </div>
      {music?.error ? <div style={{ color: T.fault, fontSize: 11, marginTop: 7 }}>{music.error}</div> : null}
      <div style={{ color: T.dim, fontSize: 10.5, marginTop: 7 }}>Changing the music re-composes the bed only, then Final Assembly reuses the existing clips.</div>
    </Section>
  );
}

function SfxPanel(props: { film: Film; busy: boolean; onRetry: () => void; onSkip: () => void }) {
  const audio = props.film.audio || null;
  const items = audio?.sfx || [];
  const status = audio?.sfx_status || 'none';
  return (
    <Section icon={<Volume2 size={15} />} title="Sound effects" hint="sparse and subtle — only where they land a visual event">
      {items.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {items.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StateDot state={status === 'skipped' ? 'todo' : f.status === 'ready' ? 'done' : f.status === 'failed' ? 'failed' : 'active'} />
              <span style={{ color: status === 'skipped' ? T.dim : T.muted, fontSize: 11.5 }}>{f.description} · @{Number(f.at_s || 0).toFixed(1)}s{f.error ? ` — ${f.error}` : ''}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: T.dim, fontSize: 11.5 }}>{audio ? 'The sound director planned no SFX for this film — that is a valid choice.' : 'Planned with the audio stage.'}</div>
      )}
      {status === 'skipped' ? <div style={{ color: T.dim, fontSize: 11, marginTop: 7 }}>Skipped — the film ships without SFX.</div> : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
        {status === 'failed' ? <button style={smallBtn(true)} disabled={props.busy} onClick={props.onRetry}><RefreshCw size={12} /> Retry</button> : null}
        {items.length && status !== 'skipped' ? <button style={smallBtn()} disabled={props.busy} onClick={props.onSkip}><SkipForward size={12} /> Continue Without SFX</button> : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Header block — title, player, meta, and layer-aware error recovery
// ---------------------------------------------------------------------------

function FinalHeader(props: {
  film: Film;
  readyCount: number;
  busy: boolean;
  canAssemble: boolean;
  captions: boolean;
  onBackToBoard: () => void;
  onFinalAssembly: (o: { captions: boolean }) => void;
  onRetryLayer: (layer: 'narration' | 'music' | 'sfx') => void;
  onSkipLayer: (layer: 'music' | 'sfx') => void;
}) {
  const { film, busy, canAssemble, captions } = props;
  const assembling = film.status === 'assembling';
  const videoUrl = film.final_video_url;
  const audio = film.audio || null;
  const narrFailed = !!audio && audio.narration.some((n) => n.status === 'failed');
  const musicFailed = audio?.music?.status === 'failed';
  const sfxFailed = audio?.sfx_status === 'failed';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ color: T.bone, fontSize: 21, fontWeight: 700, letterSpacing: -0.3 }}>{film.title || 'Your film'}</div>
        <button className="s2v-ghost" onClick={props.onBackToBoard} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: '5px 9px', borderRadius: 7 }}>
          Back to the scene board
        </button>
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', background: '#0C0C0F', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 20px 50px rgba(0,0,0,0.4)' }}>
        {videoUrl ? (
          <video key={videoUrl} src={videoUrl} controls poster={film.final_thumb_url || undefined} style={{ maxWidth: '100%', maxHeight: 460, background: '#000' }} />
        ) : (
          <div style={{ color: T.dim, fontSize: 13, padding: 56 }}>
            {assembling ? 'Final Assembly is running…' : 'Run Final Assembly — the finished film plays here when it lands.'}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ color: T.muted, fontSize: 12, fontFamily: T.mono }}>
          {film.duration_s ? `${Math.round(Number(film.duration_s))}s · ` : ''}{film.aspect_ratio || '16:9'} · {props.readyCount} scenes
        </span>
        {film.stage_note ? <span style={{ color: T.muted, fontSize: 12 }}>{film.stage_note}</span> : null}
      </div>

      {film.error ? (
        <div style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.5, marginTop: 12, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '10px 13px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{film.error}</span></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
            {narrFailed ? (<>
              <button style={smallBtn(true)} disabled={busy} onClick={() => props.onRetryLayer('narration')}><RefreshCw size={12} /> Retry</button>
              <button style={smallBtn()} disabled={busy} onClick={() => document.getElementById('s2v-voice-picker')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><Mic size={12} /> Choose Voice</button>
            </>) : null}
            {musicFailed ? (<>
              <button style={smallBtn(true)} disabled={busy} onClick={() => props.onRetryLayer('music')}><RefreshCw size={12} /> Retry</button>
              <button style={smallBtn()} disabled={busy} onClick={() => props.onSkipLayer('music')}><SkipForward size={12} /> Continue Without Music</button>
            </>) : null}
            {sfxFailed ? (<>
              <button style={smallBtn(true)} disabled={busy} onClick={() => props.onRetryLayer('sfx')}><RefreshCw size={12} /> Retry SFX</button>
              <button style={smallBtn()} disabled={busy} onClick={() => props.onSkipLayer('sfx')}><SkipForward size={12} /> Continue Without SFX</button>
            </>) : null}
            {!narrFailed && !musicFailed && !sfxFailed ? <button style={smallBtn(true)} disabled={!canAssemble} onClick={() => props.onFinalAssembly({ captions })}><RefreshCw size={12} /> Retry Assembly</button> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The Final screen
// ---------------------------------------------------------------------------

export function FinalScreen(props: {
  film: Film;
  scenes: FilmScene[];
  busy: boolean;
  assembly: AssemblyProgress | null;
  captions: boolean;
  onCaptions: (v: boolean) => void;
  onBackToBoard: () => void;
  onPrepareAudio: () => void;
  onFinalAssembly: (o: { captions: boolean }) => void;
  onRunLayer: (layer: 'narration' | 'music' | 'sfx') => void;
  onRegenNarration: () => void;
  onRegenSfx: () => void;
  onRetryLayer: (layer: 'narration' | 'music' | 'sfx') => void;
  onSkipLayer: (layer: 'music' | 'sfx') => void;
  onChangeVoice: (voiceId: string, voiceName?: string) => void;
  onChangeMusic: (preset: string) => void;
  onNativeCut: () => void;
}) {
  const { film, busy, assembly, captions } = props;
  const scenes = Array.isArray(props.scenes) ? props.scenes : [];
  const ready = audioScenes(scenes);
  const assembling = film.status === 'assembling';
  const videoUrl = film.final_video_url;
  const audio = film.audio || null;
  const audioGenerating = film.machine_state === 'AUDIO_PLANNING' || film.machine_state === 'AUDIO_GENERATING';
  const [voices, setVoices] = useState<VoiceOption[]>([]);

  useEffect(() => {
    let live = true;
    listVoices().then((list) => { if (live) setVoices(list); }).catch(() => { if (live) setVoices([]); });
    return () => { live = false; };
  }, []);

  const canAssemble = ready.length > 0 && !busy && !assembling;
  const showProgress = !!assembly && (assembly.running || assembly.steps.some((s) => s.status === 'failed'));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 36px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <FinalHeader
          film={film}
          readyCount={ready.length}
          busy={busy}
          canAssemble={canAssemble}
          captions={captions}
          onBackToBoard={props.onBackToBoard}
          onFinalAssembly={props.onFinalAssembly}
          onRetryLayer={props.onRetryLayer}
          onSkipLayer={props.onSkipLayer}
        />

        <div style={{ display: 'flex', gap: 12, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          {videoUrl ? (
            <a className="s2v-lift" href={videoUrl} download target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 9, background: T.raised, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '11px 20px', fontSize: 13, fontWeight: 650, textDecoration: 'none' }}>
              <Download size={14} /> Download MP4
            </a>
          ) : null}
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={captions} onChange={(e) => props.onCaptions(e.target.checked)} style={{ accentColor: T.live }} />
            <Captions size={13} color={captions ? T.live : T.dim} />
            <span style={{ color: captions ? T.bone : T.muted, fontSize: 12 }}>Burn-in captions</span>
          </label>
        </div>
        <div style={{ color: T.dim, fontSize: 11, marginTop: 8 }}>
          The FINAL ASSEMBLY button lives in the always-visible bar below — it reuses the existing clips, so changing the voice, music or SFX never regenerates video and re-assembly is fast.
          {' '}<button className="s2v-ghost" disabled={busy || assembling || !ready.length} onClick={props.onNativeCut} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 11, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Assemble the plain native-audio cut instead</button>.
        </div>

        <AudioCards
          film={film}
          scenes={scenes}
          voices={voices}
          busy={busy || assembling}
          generating={audioGenerating}
          onRunLayer={props.onRunLayer}
          onRegenNarration={props.onRegenNarration}
          onRegenSfx={props.onRegenSfx}
          onChangeVoice={props.onChangeVoice}
          onChangeMusic={props.onChangeMusic}
          onRetryLayer={props.onRetryLayer}
          onSkipLayer={props.onSkipLayer}
        />

        {showProgress ? <AssemblyProgressCard progress={assembly!} /> : null}

        {ready.length ? (
          <Section icon={<Layers size={15} />} title="Timeline" hint="video · voice · music · SFX">
            <AudioTimeline film={film} scenes={scenes} />
          </Section>
        ) : null}

        {audio ? (
          <>
            <VoiceNarrationPanel film={film} scenes={scenes} voices={voices} busy={busy || assembling} onChangeVoice={props.onChangeVoice} onRetry={() => props.onRetryLayer('narration')} />
            <MusicPanel film={film} busy={busy || assembling} onChangeMusic={props.onChangeMusic} onRetry={() => props.onRetryLayer('music')} onSkip={() => props.onSkipLayer('music')} />
            <SfxPanel film={film} busy={busy || assembling} onRetry={() => props.onRetryLayer('sfx')} onSkip={() => props.onSkipLayer('sfx')} />
          </>
        ) : (
          <Section icon={<Sparkles size={15} />} title="Audio — narration, music & SFX" hint="planned by Opus from the original script">
            <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.6 }}>
              Opus writes a voice plan and a natural spoken narration for each scene (faithful to your script — nothing invented), ElevenLabs records it with one consistent voice, a music bed is composed to match the story arc, and subtle SFX land the key moments. You can also just press Final Assembly — it prepares whatever is missing first.
            </div>
            <button style={{ ...smallBtn(true), marginTop: 10 }} disabled={busy || assembling || !ready.length} onClick={props.onPrepareAudio}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />} Prepare narration, music &amp; SFX
            </button>
          </Section>
        )}

        <div style={{ color: T.dim, fontSize: 12, lineHeight: 1.6, marginTop: 20 }}>
          Want to change one moment? Open the scene board, regenerate just that scene — every other clip is cached — then re-run Final Assembly.
        </div>
      </div>
    </div>
  );
}
