/**
 * Compact AUDIO PREVIEW cards — narration / music / SFX — shown before Final
 * Assembly. Each card reflects the layer's REAL backend state (queued /
 * generating / ready / failed / skipped), previews the actual generated audio,
 * and carries that layer's own actions. Changing any audio layer NEVER
 * triggers scene regeneration — only that layer is re-made.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Circle, Loader2, Mic, Music, Pause, Play, RefreshCw,
  SkipForward, Volume2,
} from 'lucide-react';
import { Film, FilmScene, T, fmtClock } from './api';
import { MUSIC_PRESETS, MusicPreset, VoiceOption } from './pipeline/finish';
import { audioScenes, musicReady, narrationReady, sfxReady } from './pipeline/audio';

type LayerState = 'done' | 'active' | 'failed' | 'todo' | 'skipped';

function Dot({ state }: { state: LayerState }) {
  const color = state === 'done' ? T.done : state === 'active' ? T.live : state === 'failed' ? T.fault : T.dim;
  return (
    <span style={{ color, display: 'inline-flex', flexShrink: 0 }}>
      {state === 'done' ? <Check size={12} /> : state === 'active' ? <Loader2 size={12} className="animate-spin" /> : state === 'failed' ? <AlertTriangle size={12} /> : state === 'skipped' ? <SkipForward size={12} /> : <Circle size={11} />}
    </span>
  );
}

const cardStyle = {
  flex: '1 1 220px', minWidth: 200, background: T.raised, border: `1px solid ${T.dim}`,
  borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, gap: 9,
} as const;

const actBtn = (accent = false) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: accent ? T.live : 'transparent', color: accent ? '#1A1205' : T.bone,
  border: accent ? 'none' : `1px solid ${T.dim}`,
  borderRadius: 8, padding: '6px 11px', fontSize: 11.5, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap' as const,
} as const);

const playBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  background: '#101014', color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 999, cursor: 'pointer', flexShrink: 0,
} as const;

const selStyle = {
  background: '#151519', color: T.bone, border: `1px solid ${T.dim}`,
  borderRadius: 8, padding: '6px 8px', fontSize: 11.5, maxWidth: '100%',
} as const;

/** Plays a queue of audio URLs back to back through one Audio element. */
function useSequencePlayer() {
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<string[]>([]);
  const baseMs = useRef(0);
  const timer = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);

  const stop = () => {
    if (audioEl.current) { try { audioEl.current.pause(); } catch { /* noop */ } audioEl.current.onended = null; }
    if (timer.current) clearInterval(timer.current);
    queue.current = [];
    baseMs.current = 0;
    setPlaying(false);
    setPosMs(0);
  };
  useEffect(() => () => stop(), []);

  const play = (urls: string[]) => {
    stop();
    const list = urls.filter(Boolean);
    if (!list.length) return;
    queue.current = [...list];
    const el = audioEl.current || new Audio();
    audioEl.current = el;
    const next = () => {
      const url = queue.current.shift();
      if (!url) { stop(); return; }
      el.src = url;
      el.onended = () => { baseMs.current += (Number(el.duration) || 0) * 1000; next(); };
      el.onerror = () => next();
      el.play().catch(() => stop());
    };
    timer.current = setInterval(() => setPosMs(baseMs.current + (audioEl.current?.currentTime || 0) * 1000), 250);
    setPlaying(true);
    next();
  };
  return { playing, posMs, play, stop };
}

export default function AudioCards(props: {
  film: Film;
  scenes: FilmScene[];
  voices: VoiceOption[];
  busy: boolean;
  generating: boolean;
  onRunLayer: (layer: 'narration' | 'music' | 'sfx') => void;
  onRegenNarration: () => void;
  onRegenSfx: () => void;
  onChangeVoice: (voiceId: string, voiceName?: string) => void;
  onChangeMusic: (preset: string) => void;
  onRetryLayer: (layer: 'narration' | 'music' | 'sfx') => void;
  onSkipLayer: (layer: 'music' | 'sfx') => void;
}) {
  const { film, busy, generating } = props;
  const audio = film.audio || null;
  const done = audioScenes(props.scenes);
  const locked = busy || generating;
  const player = useSequencePlayer();
  const [previewing, setPreviewing] = useState<'narration' | 'music' | 'sfx' | null>(null);

  const toggle = (kind: 'narration' | 'music' | 'sfx', urls: string[]) => {
    if (player.playing && previewing === kind) { player.stop(); setPreviewing(null); return; }
    setPreviewing(kind);
    player.play(urls);
  };

  // —— Narration ——
  const orderKeys = done.map((s) => s.scene_key);
  const narrReadyEntries = (audio?.narration || [])
    .filter((n) => n.voice_source === 'elevenlabs' && n.status === 'ready' && n.audioUrl)
    .sort((a, b) => orderKeys.indexOf(a.scene_key) - orderKeys.indexOf(b.scene_key));
  const narrUrls = narrReadyEntries.map((n) => String(n.audioUrl));
  const narrTotalMs = narrReadyEntries.reduce((n, e) => n + (Number(e.duration_s) || 0) * 1000, 0);
  const nReady = !!audio && narrationReady(audio);
  const nFailed = !!audio && audio.narration.some((n) => n.status === 'failed');
  const nState: LayerState = nReady ? 'done' : nFailed ? 'failed' : generating && !nReady ? 'active' : 'todo';
  const voiceId = audio?.voice_plan?.voiceId || '';

  // —— Music ——
  const music = audio?.music || null;
  const mReady = !!audio && musicReady(audio);
  const mState: LayerState = music?.status === 'skipped' ? 'skipped' : music?.status === 'failed' ? 'failed' : mReady && music?.audioUrl ? 'done' : mReady ? 'done' : generating && nReady && !mReady ? 'active' : 'todo';

  // —— SFX ——
  const sfxItems = audio?.sfx || [];
  const sfxReadyItems = sfxItems.filter((f) => f.status === 'ready' && f.audioUrl);
  const sfxStatus = audio?.sfx_status || 'none';
  const sReady = !!audio && sfxReady(audio);
  const sState: LayerState = sfxStatus === 'skipped' ? 'skipped' : sfxStatus === 'failed' ? 'failed' : sfxStatus === 'ready' || sfxStatus === 'none' ? (audio ? 'done' : 'todo') : generating && nReady && mReady ? 'active' : 'todo';

  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
      {/* —— NARRATION —— */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Mic size={13} color={T.live} />
          <span style={{ color: T.bone, fontSize: 11, fontWeight: 800, letterSpacing: 0.8 }}>NARRATION</span>
          <span style={{ marginLeft: 'auto' }}><Dot state={nState} /></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <button
            style={{ ...playBtn, opacity: narrUrls.length ? 1 : 0.4, cursor: narrUrls.length ? 'pointer' : 'default' }}
            disabled={!narrUrls.length}
            onClick={() => toggle('narration', narrUrls)}
            aria-label="Voice preview"
          >
            {player.playing && previewing === 'narration' ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: narrUrls.length ? T.bone : T.dim, fontSize: 12, fontWeight: 600 }}>Voice preview</div>
            <div style={{ color: T.muted, fontSize: 11, fontFamily: T.mono }}>
              {narrUrls.length ? `${fmtClock(player.playing && previewing === 'narration' ? player.posMs : 0)} — ${fmtClock(narrTotalMs)}` : nState === 'active' ? 'generating…' : nState === 'failed' ? 'failed' : 'not generated yet'}
            </div>
          </div>
        </div>
        {audio?.voice_plan?.voiceName ? <div style={{ color: T.dim, fontSize: 10.5 }}>Voice: {audio.voice_plan.voiceName}</div> : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
          {!audio || (!nReady && !nFailed && !generating) ? (
            <button style={actBtn(true)} disabled={locked || !done.length} onClick={() => props.onRunLayer('narration')}><Mic size={11} /> Generate narration</button>
          ) : null}
          {nFailed ? <button style={actBtn(true)} disabled={locked} onClick={() => props.onRetryLayer('narration')}><RefreshCw size={11} /> Retry</button> : null}
          {nReady && narrUrls.length ? <button style={actBtn()} disabled={locked} onClick={props.onRegenNarration}><RefreshCw size={11} /> Regenerate Narration</button> : null}
        </div>
        <div id="s2v-voice-picker" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: T.dim, fontSize: 10.5, flexShrink: 0 }}>Change Voice</span>
          <select
            value={voiceId}
            disabled={locked}
            onChange={(e) => {
              const v = props.voices.find((x) => x.id === e.target.value);
              if (e.target.value) props.onChangeVoice(e.target.value, v?.name);
            }}
            style={{ ...selStyle, flex: 1, minWidth: 0 }}
            aria-label="Change narration voice"
          >
            {voiceId && !props.voices.some((v) => v.id === voiceId) ? <option value={voiceId}>{audio?.voice_plan?.voiceName || voiceId}</option> : null}
            {!voiceId ? <option value="">Choose a voice…</option> : null}
            {props.voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      </div>

      {/* —— MUSIC —— */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Music size={13} color={T.live} />
          <span style={{ color: T.bone, fontSize: 11, fontWeight: 800, letterSpacing: 0.8 }}>MUSIC</span>
          <span style={{ marginLeft: 'auto' }}><Dot state={mState} /></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <button
            style={{ ...playBtn, opacity: music?.audioUrl ? 1 : 0.4, cursor: music?.audioUrl ? 'pointer' : 'default' }}
            disabled={!music?.audioUrl}
            onClick={() => music?.audioUrl && toggle('music', [String(music.audioUrl)])}
            aria-label="Music preview"
          >
            {player.playing && previewing === 'music' ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: music?.audioUrl ? T.bone : T.dim, fontSize: 12, fontWeight: 600 }}>Music preview</div>
            <div style={{ color: T.muted, fontSize: 11 }}>
              {music?.status === 'ready' && music.audioUrl ? `Selected track · ${music.preset}` : music?.status === 'skipped' ? 'skipped' : music?.status === 'failed' ? 'failed' : mState === 'active' ? 'selecting…' : 'not selected yet'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
          {!audio || (music && music.status === 'pending' && !generating) ? (
            <button style={actBtn(true)} disabled={locked || !done.length} onClick={() => props.onRunLayer('music')}><Music size={11} /> Select music</button>
          ) : null}
          {music?.status === 'failed' ? (
            <>
              <button style={actBtn(true)} disabled={locked} onClick={() => props.onRetryLayer('music')}><RefreshCw size={11} /> Retry</button>
              <button style={actBtn()} disabled={locked} onClick={() => props.onSkipLayer('music')}><SkipForward size={11} /> Continue Without Music</button>
            </>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: T.dim, fontSize: 10.5, flexShrink: 0 }}>Change Music</span>
          <select
            value={(MUSIC_PRESETS as readonly string[]).includes(String(music?.preset)) ? String(music?.preset) : 'cinematic'}
            disabled={locked}
            onChange={(e) => props.onChangeMusic(e.target.value as MusicPreset)}
            style={{ ...selStyle, flex: 1, minWidth: 0 }}
            aria-label="Change music style"
          >
            {MUSIC_PRESETS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {/* —— SFX —— */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Volume2 size={13} color={T.live} />
          <span style={{ color: T.bone, fontSize: 11, fontWeight: 800, letterSpacing: 0.8 }}>SFX</span>
          <span style={{ marginLeft: 'auto' }}><Dot state={sState} /></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <button
            style={{ ...playBtn, opacity: sfxReadyItems.length ? 1 : 0.4, cursor: sfxReadyItems.length ? 'pointer' : 'default' }}
            disabled={!sfxReadyItems.length}
            onClick={() => toggle('sfx', sfxReadyItems.map((f) => String(f.audioUrl)))}
            aria-label="SFX preview"
          >
            {player.playing && previewing === 'sfx' ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: sfxReadyItems.length ? T.bone : T.dim, fontSize: 12, fontWeight: 600 }}>
              {sfxStatus === 'ready' ? `${sfxReadyItems.length} effect${sfxReadyItems.length === 1 ? '' : 's'} prepared` : sfxStatus === 'none' && audio ? 'No SFX planned' : sfxStatus === 'skipped' ? 'SFX skipped' : sfxStatus === 'failed' ? 'SFX failed' : sState === 'active' ? 'Preparing SFX…' : 'SFX'}
            </div>
            <div style={{ color: T.muted, fontSize: 11 }}>{sfxItems.length ? 'subtle, tied to scene actions' : audio ? 'the sound director planned none' : 'planned with the audio stage'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
          {!audio || (sfxStatus === 'pending' && !generating) ? (
            <button style={actBtn(true)} disabled={locked || !done.length} onClick={() => props.onRunLayer('sfx')}><Volume2 size={11} /> Prepare SFX</button>
          ) : null}
          {sfxStatus === 'failed' ? (
            <>
              <button style={actBtn(true)} disabled={locked} onClick={() => props.onRetryLayer('sfx')}><RefreshCw size={11} /> Retry</button>
              <button style={actBtn()} disabled={locked} onClick={() => props.onSkipLayer('sfx')}><SkipForward size={11} /> Continue Without SFX</button>
            </>
          ) : null}
          {sfxStatus === 'ready' && sfxItems.length ? <button style={actBtn()} disabled={locked} onClick={props.onRegenSfx}><RefreshCw size={11} /> Regenerate SFX</button> : null}
        </div>
      </div>
    </div>
  );
}
