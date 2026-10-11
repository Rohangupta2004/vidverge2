/**
 * Compact AUDIO PREVIEW cards — voiceover / music / SFX — shown before Final
 * Assembly. Each card reflects the layer's REAL backend state (queued /
 * generating / ready / failed / skipped), previews the actual generated audio,
 * and carries that layer's own actions. Changing any audio layer NEVER
 * triggers scene regeneration — only that layer is re-made.
 *
 * EVERY layer here is optional, the voiceover included: its card opens with a
 * VOICE SOURCE choice (No Voiceover / ElevenLabs / built-in AI voice), and
 * "No Voiceover" needs nothing generated — so a missing or failing voice
 * provider can never stop a film from reaching Final Assembly.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Circle, Mic, Music, Pause, Play, RefreshCw,
  SkipForward, Volume2,
} from 'lucide-react';
import { Film, FilmScene, T, VoiceSourceId, fmtClock } from './api';
import { MUSIC_PRESETS, MusicPreset, VoiceOption } from './pipeline/finish';
import { audioScenes, isSpokenSource, musicReady, narrationReady, sfxReady } from './pipeline/audio';
import { OPENAI_VOICES, VOICE_SOURCES, openAiVoiceLabel } from './pipeline/voiceSource';
import VergeLoader from '../../components/VergeLoader';

type LayerState = 'done' | 'active' | 'failed' | 'todo' | 'skipped';

function Dot({ state }: { state: LayerState }) {
  const color = state === 'done' ? T.done : state === 'active' ? T.live : state === 'failed' ? T.fault : T.dim;
  return (
    <span style={{ color, display: 'inline-flex', flexShrink: 0 }}>
      {state === 'done' ? <Check size={12} /> : state === 'active' ? <VergeLoader size={28} label="In progress" /> : state === 'failed' ? <AlertTriangle size={12} /> : state === 'skipped' ? <SkipForward size={12} /> : <Circle size={11} />}
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
  background: '#FFFAEB', color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 999, cursor: 'pointer', flexShrink: 0,
} as const;

const selStyle = {
  background: '#FFFFFF', color: T.bone, border: `1px solid ${T.dim}`,
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

/**
 * VOICE SOURCE — the first control on the voiceover card, because it decides
 * whether the step does anything at all. Radio cards rather than a dropdown:
 * this is a fork in the pipeline, not a preference buried in a list.
 *
 * ElevenLabs is greyed out (with the reason in its tooltip) only once the
 * platform has actually refused its voice catalog — the built-in AI voice and
 * No Voiceover are always selectable.
 */
function VoiceSourcePicker(props: {
  value: VoiceSourceId;
  openaiVoice: string;
  elevenLabsOffered: boolean;
  disabled: boolean;
  onChange: (source: VoiceSourceId, openaiVoice?: string) => void;
}) {
  return (
    <div id="s2v-voice-source">
      <div style={{ color: T.dim, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 5 }}>Voice source</div>
      <div role="radiogroup" aria-label="Voice source" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {VOICE_SOURCES.map((option) => {
          const off = option.id === 'elevenlabs' && !props.elevenLabsOffered;
          const active = props.value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={props.disabled || off}
              title={off ? 'ElevenLabs not connected.' : option.blurb}
              onClick={() => props.onChange(option.id)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 7, width: '100%', textAlign: 'left',
                background: active ? 'rgba(200,146,10,0.14)' : '#FFFAEB',
                border: `1px solid ${active ? T.live : T.dim}`,
                borderRadius: 9, padding: '7px 9px',
                cursor: props.disabled || off ? 'default' : 'pointer',
                opacity: off ? 0.5 : 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 11, height: 11, borderRadius: 999, flexShrink: 0, marginTop: 2,
                  border: `2px solid ${active ? T.live : T.dim}`,
                  background: active ? T.live : 'transparent',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', color: active ? T.bone : T.muted, fontSize: 11.5, fontWeight: 700 }}>{option.label}</span>
                <span style={{ display: 'block', color: T.dim, fontSize: 10, lineHeight: 1.45 }}>
                  {off ? 'ElevenLabs not connected.' : option.blurb}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {props.value === 'openai' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
          <span style={{ color: T.dim, fontSize: 10.5, flexShrink: 0 }}>AI voice</span>
          <select
            value={props.openaiVoice}
            disabled={props.disabled}
            onChange={(e) => props.onChange('openai', e.target.value)}
            style={{ ...selStyle, flex: 1, minWidth: 0 }}
            aria-label="Built-in AI voice"
          >
            {OPENAI_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label} — {v.blurb}</option>)}
          </select>
        </div>
      ) : null}
    </div>
  );
}

export default function AudioCards(props: {
  film: Film;
  scenes: FilmScene[];
  voices: VoiceOption[];
  busy: boolean;
  generating: boolean;
  voiceSource: VoiceSourceId;
  openaiVoice: string;
  elevenLabsOffered: boolean;
  onChangeVoiceSource: (source: VoiceSourceId, openaiVoice?: string) => void;
  onRunLayer: (layer: 'narration' | 'music' | 'sfx') => void;
  onRegenNarration: () => void;
  onRegenSfx: () => void;
  onChangeVoice: (voiceId: string, voiceName?: string) => void;
  onChangeMusic: (preset: string) => void;
  onRetryLayer: (layer: 'narration' | 'music' | 'sfx') => void;
  onSkipLayer: (layer: 'narration' | 'music' | 'sfx') => void;
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

  // —— Voiceover ——
  const silent = props.voiceSource === 'none';
  const orderKeys = done.map((s) => s.scene_key);
  const narrReadyEntries = (audio?.narration || [])
    .filter((n) => isSpokenSource(n.voice_source) && n.status === 'ready' && n.audioUrl)
    .sort((a, b) => orderKeys.indexOf(a.scene_key) - orderKeys.indexOf(b.scene_key));
  const narrUrls = narrReadyEntries.map((n) => String(n.audioUrl));
  const narrTotalMs = narrReadyEntries.reduce((n, e) => n + (Number(e.duration_s) || 0) * 1000, 0);
  const nReady = !!audio && narrationReady(audio);
  const nFailed = !!audio && audio.narration.some((n) => isSpokenSource(n.voice_source) && n.status === 'failed');
  const nState: LayerState = silent ? 'skipped' : nReady ? 'done' : nFailed ? 'failed' : generating && !nReady ? 'active' : 'todo';
  const voiceId = audio?.voice_plan?.voiceId || '';

  // —— Music ——
  const music = audio?.music || null;
  const musicProvider = music?.provider === 'gemini'
    ? 'Google Gemini (Lyria)'
    : music?.provider === 'elevenlabs' ? 'ElevenLabs' : '';
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
      {/* —— VOICEOVER (optional) —— */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Mic size={13} color={T.live} />
          <span style={{ color: T.bone, fontSize: 11, fontWeight: 800, letterSpacing: 0.8 }}>VOICEOVER</span>
          <span style={{ color: T.dim, fontSize: 10, fontWeight: 600 }}>optional</span>
          <span style={{ marginLeft: 'auto' }}><Dot state={nState} /></span>
        </div>

        <VoiceSourcePicker
          value={props.voiceSource}
          openaiVoice={props.openaiVoice}
          elevenLabsOffered={props.elevenLabsOffered}
          disabled={locked}
          onChange={props.onChangeVoiceSource}
        />

        {silent ? (
          <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.55, marginTop: 'auto' }}>
            No narration layer. Your scenes keep their own sound and Final Assembly is ready as soon as the clips are — pick a voice above if you want one.
          </div>
        ) : (
          <>
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
            <div style={{ color: T.dim, fontSize: 10.5 }}>
              {props.voiceSource === 'openai'
                ? `Voice: ${openAiVoiceLabel(props.openaiVoice)} · built-in`
                : audio?.voice_plan?.voiceName ? `Voice: ${audio.voice_plan.voiceName} · ElevenLabs` : 'Voice: chosen with the audio plan'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                {!audio || (!nReady && !nFailed && !generating) ? (
                <button style={actBtn(true)} disabled={locked || !done.length} onClick={() => props.onRunLayer('narration')}><Mic size={11} /> Generate narration</button>
              ) : null}
              {nFailed ? <button style={actBtn(true)} disabled={locked} onClick={() => props.onRetryLayer('narration')}><RefreshCw size={11} /> Retry</button> : null}
              {nFailed || (!nReady && !generating) ? (
                <button style={actBtn()} disabled={locked} onClick={() => props.onSkipLayer('narration')} title="Drop the voiceover and assemble from the clips’ own sound. Nothing is regenerated.">
                  <SkipForward size={11} /> Continue Without Voiceover
                </button>
              ) : null}
              {nReady && narrUrls.length ? <button style={actBtn()} disabled={locked} onClick={props.onRegenNarration}><RefreshCw size={11} /> Regenerate Narration</button> : null}
            </div>
            {props.voiceSource === 'elevenlabs' ? (
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
            ) : null}
          </>
        )}
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
              {music?.status === 'ready' && music.audioUrl
                ? `Selected track · ${music.preset || 'custom bed'}${musicProvider ? ` · ${musicProvider}` : ''}`
                : music?.status === 'skipped'
                  ? music.skip_reason === 'providers_unavailable' ? 'Continuing without music · providers unavailable' : 'Skipped — no music bed'
                  : music?.status === 'failed' ? 'Music preparation failed' : mState === 'active' ? 'Selecting a bed…' : 'Not selected yet'}
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
