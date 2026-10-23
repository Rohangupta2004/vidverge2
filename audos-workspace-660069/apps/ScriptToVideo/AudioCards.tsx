/**
 * AUDIO PREVIEW — voiceover / music / SFX — shown before Final Assembly.
 * Each layer reflects its REAL backend state (queued / generating / ready /
 * failed / skipped), previews the actual generated audio, and carries that
 * layer's own actions. Changing any audio layer NEVER triggers scene
 * regeneration — only that layer is re-made.
 *
 * LAYOUT: one tab per layer (Voice · Music · SFX), each tab showing its live
 * state. The Final screen's content column is capped at 780px, which cannot
 * hold three usable columns beside the voice chooser, so the layers are tabs
 * at every width instead of three cramped cards at tablet width.
 *
 * EVERY layer here is optional, the voiceover included: its tab opens with a
 * VOICE SOURCE choice (No Voiceover / ElevenLabs / built-in AI voice), and
 * "No Voiceover" needs nothing generated — so a missing or failing voice
 * provider can never stop a film from reaching Final Assembly.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, Circle, Mic, Music, Pause, Play, RefreshCw,
  SkipForward, Volume2,
} from 'lucide-react';
import { Film, FilmScene, T, VoiceSourceId, fmtClock } from './api';
import { MUSIC_PRESETS, MusicPreset, VoiceOption } from './pipeline/finish';
import { audioScenes, isSpokenSource, musicReady, narrationReady } from './pipeline/audio';
import { OPENAI_VOICES, VOICE_SOURCES, openAiVoiceLabel } from './pipeline/voiceSource';
import VergeLoader from '../../components/VergeLoader';
import { useVoiceCatalog } from '../../components/shared/VoicePicker';
import VoiceChooser from './VoiceChooser';
import { SelectField } from './audioUi';

type LayerState = 'done' | 'active' | 'failed' | 'todo' | 'skipped';
type LayerKey = 'narration' | 'music' | 'sfx';

function Dot({ state }: { state: LayerState }) {
  const color = state === 'done' ? T.done : state === 'active' ? T.live : state === 'failed' ? T.fault : T.dim;
  return (
    <span style={{ color, display: 'inline-flex', flexShrink: 0 }}>
      {state === 'done' ? <Check size={14} /> : state === 'active' ? <VergeLoader size={28} label="In progress" /> : state === 'failed' ? <AlertTriangle size={14} /> : state === 'skipped' ? <SkipForward size={14} /> : <Circle size={13} />}
    </span>
  );
}

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
 * VOICE SOURCE — the first control on the voiceover tab, because it decides
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
    <div id="s2v-voice-source" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="s2v-au-label">Voice source</div>
      <div role="radiogroup" aria-label="Voice source" className="s2v-au-sources">
        {VOICE_SOURCES.map((option) => {
          const off = option.id === 'elevenlabs' && !props.elevenLabsOffered;
          const active = props.value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              className="s2v-au-source"
              disabled={props.disabled || off}
              title={off ? 'The managed voice catalog is unavailable.' : option.blurb}
              onClick={() => props.onChange(option.id)}
            >
              <span aria-hidden className="s2v-au-source-dot" />
              <span style={{ minWidth: 0 }}>
                <span className="s2v-au-source-name">{option.label}</span>
                <span className="s2v-au-source-blurb">{off ? 'The managed voice catalog is unavailable.' : option.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
      {props.value === 'openai' ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="s2v-au-label">Built-in AI voice</span>
          <SelectField
            value={props.openaiVoice}
            disabled={props.disabled}
            onChange={(e) => props.onChange('openai', e.target.value)}
          >
            {OPENAI_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label} — {v.blurb}</option>)}
          </SelectField>
        </label>
      ) : null}
    </div>
  );
}

function PlayButton(props: { playing: boolean; enabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="s2v-au-btn is-icon"
      disabled={!props.enabled}
      onClick={props.onClick}
      aria-label={`${props.playing ? 'Pause' : 'Play'} ${props.label}`}
    >
      {props.playing ? <Pause size={16} /> : <Play size={16} />}
    </button>
  );
}

const TABS: { key: 'voice' | 'music' | 'sfx'; label: string; icon: typeof Mic }[] = [
  { key: 'voice', label: 'Voice', icon: Mic },
  { key: 'music', label: 'Music', icon: Music },
  { key: 'sfx', label: 'SFX', icon: Volume2 },
];

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

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
  onRunLayer: (layer: LayerKey) => void;
  onRegenNarration: () => void;
  onRegenSfx: () => void;
  onChangeVoice: (voiceId: string, voiceName?: string) => void;
  onChangeMusic: (preset: string) => void;
  onRetryLayer: (layer: LayerKey) => void;
  onSkipLayer: (layer: LayerKey) => void;
}) {
  const { film, busy, generating } = props;
  const audio = film.audio || null;
  const done = audioScenes(props.scenes);
  const locked = busy || generating;
  const player = useSequencePlayer();
  const voiceCatalog = useVoiceCatalog();
  const [previewing, setPreviewing] = useState<LayerKey | null>(null);
  const [tab, setTab] = useState<'voice' | 'music' | 'sfx'>('voice');
  const [showEffects, setShowEffects] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const toggle = (kind: LayerKey, urls: string[]) => {
    if (player.playing && previewing === kind) { player.stop(); setPreviewing(null); return; }
    setPreviewing(kind);
    player.play(urls);
  };
  const isPlaying = (kind: LayerKey) => player.playing && previewing === kind;

  // —— Voiceover ——
  const silent = props.voiceSource === 'none';
  const orderKeys = done.map((s) => s.scene_key);
  const narrReadyEntries = (audio?.narration || [])
    .filter((n) => isSpokenSource(n.voice_source) && n.status === 'ready' && n.audioUrl)
    .sort((a, b) => orderKeys.indexOf(a.scene_key) - orderKeys.indexOf(b.scene_key));
  const narrUrls = narrReadyEntries.map((n) => String(n.audioUrl));
  const narrTotalMs = narrReadyEntries.reduce((n, e) => n + (Number(e.duration_s) || 0) * 1000, 0);
  const nReady = !!audio && narrationReady(audio);
  const failedNarration = audio ? audio.narration.find((n) => isSpokenSource(n.voice_source) && n.status === 'failed') : undefined;
  const nFailed = !!failedNarration;
  const nState: LayerState = silent ? 'skipped' : nReady ? 'done' : nFailed ? 'failed' : generating && !nReady ? 'active' : 'todo';
  const voiceId = audio?.voice_plan?.voiceId || '';

  // —— Music ——
  const music = audio?.music || null;
  const mReady = !!audio && musicReady(audio);
  const mState: LayerState = music?.status === 'skipped' ? 'skipped' : music?.status === 'failed' ? 'failed' : mReady ? 'done' : generating && nReady && !mReady ? 'active' : 'todo';
  const musicProvider = music?.provider === 'gemini' ? 'Google Gemini (Lyria)' : music?.provider === 'elevenlabs' ? 'ElevenLabs' : '';

  // —— SFX ——
  const sfxItems = audio?.sfx || [];
  const sfxReadyItems = sfxItems.filter((f) => f.status === 'ready' && f.audioUrl);
  const sfxStatus = audio?.sfx_status || 'none';
  const sState: LayerState = sfxStatus === 'skipped' ? 'skipped' : sfxStatus === 'failed' ? 'failed' : sfxStatus === 'ready' || sfxStatus === 'none' ? (audio ? 'done' : 'todo') : generating && nReady && mReady ? 'active' : 'todo';
  const failedSfx = sfxItems.find((f) => f.status === 'failed');

  const tabState: Record<'voice' | 'music' | 'sfx', { state: LayerState; text: string }> = {
    voice: {
      state: nState,
      text: silent ? 'Off' : nReady ? 'Ready' : nFailed ? 'Failed' : nState === 'active' ? 'Generating' : 'Not generated',
    },
    music: {
      state: mState,
      text: music?.status === 'skipped' ? 'Skipped' : music?.status === 'failed' ? 'Failed' : mReady ? 'Ready' : mState === 'active' ? 'Generating' : 'Not selected',
    },
    sfx: {
      state: sState,
      text: sfxStatus === 'skipped' ? 'Skipped' : sfxStatus === 'failed' ? 'Failed' : sfxStatus === 'ready' ? `${sfxReadyItems.length} effect${sfxReadyItems.length === 1 ? '' : 's'}` : sfxStatus === 'none' && audio ? 'None planned' : sState === 'active' ? 'Generating' : 'Not prepared',
    },
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((t) => t.key === tab);
    const target = event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (target < 0) return;
    event.preventDefault();
    setTab(TABS[target].key);
    tabRefs.current[TABS[target].key]?.focus();
  };

  const sceneNumber = (sceneKey: string) => {
    const scene = props.scenes.find((s) => s.scene_key === sceneKey);
    return scene ? scene.idx + 1 : null;
  };

  return (
    <div className="s2v-au" style={{ marginTop: 14 }}>
      <div className="s2v-au-tabs" role="tablist" aria-label="Audio layers">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            ref={(node) => { tabRefs.current[key] = node; }}
            type="button"
            role="tab"
            id={`s2v-au-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`s2v-au-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            className="s2v-au-tab"
            onClick={() => setTab(key)}
            onKeyDown={onTabKey}
          >
            <span className="s2v-au-tab-top">
              <Icon size={15} color={T.live} />
              {label}
              <span style={{ marginLeft: 'auto' }}><Dot state={tabState[key].state} /></span>
            </span>
            <span className="s2v-au-tab-state">{tabState[key].text}</span>
          </button>
        ))}
      </div>

      {/* —— VOICEOVER (optional) —— */}
      {tab === 'voice' ? (
        <div className="s2v-au-panel" role="tabpanel" id="s2v-au-panel-voice" aria-labelledby="s2v-au-tab-voice">
          <VoiceSourcePicker
            value={props.voiceSource}
            openaiVoice={props.openaiVoice}
            elevenLabsOffered={props.elevenLabsOffered}
            disabled={locked}
            onChange={props.onChangeVoiceSource}
          />

          {silent ? (
            <p className="s2v-au-msg">
              No narration layer. Your scenes keep their own sound and Final Assembly is ready as soon as the clips are — pick a voice source above if you want one.
            </p>
          ) : (
            <>
              {props.voiceSource === 'elevenlabs' ? (
                <div id="s2v-voice-picker">
                  <VoiceChooser
                    catalog={voiceCatalog}
                    value={voiceId}
                    valueName={audio?.voice_plan?.voiceName}
                    onChange={(nextVoiceId, voice) => props.onChangeVoice(nextVoiceId, voice.name)}
                    disabled={locked}
                  />
                </div>
              ) : null}

              <div className="s2v-au-item">
                <div className="s2v-au-item-main">
                  <PlayButton
                    playing={isPlaying('narration')}
                    enabled={narrUrls.length > 0}
                    label="narration preview"
                    onClick={() => toggle('narration', narrUrls)}
                  />
                  <div className="s2v-au-item-text">
                    <div className="s2v-au-item-title">Narration preview</div>
                    <div className={`s2v-au-item-sub${nState === 'failed' ? ' is-error' : ''}`} style={{ fontFamily: narrUrls.length ? T.mono : undefined }}>
                      {narrUrls.length
                        ? `${fmtClock(isPlaying('narration') ? player.posMs : 0)} — ${fmtClock(narrTotalMs)}`
                        : nState === 'active' ? 'Generating narration…'
                          : nState === 'failed' ? (failedNarration?.error || 'Narration failed.')
                            : !done.length ? 'Narration needs at least one finished scene.'
                              : 'Not generated yet. Generate narration to hear it.'}
                    </div>
                  </div>
                </div>
                <div className="s2v-au-actions">
                  {!audio || (!nReady && !nFailed && !generating) ? (
                    <button type="button" className="s2v-au-btn is-primary" disabled={locked || !done.length} onClick={() => props.onRunLayer('narration')}><Mic size={16} /> Generate narration</button>
                  ) : null}
                  {nFailed ? <button type="button" className="s2v-au-btn is-primary" disabled={locked} onClick={() => props.onRetryLayer('narration')}><RefreshCw size={16} /> Retry</button> : null}
                  {nReady && narrUrls.length ? <button type="button" className="s2v-au-btn" disabled={locked} onClick={props.onRegenNarration}><RefreshCw size={16} /> Regenerate</button> : null}
                  {nFailed || (!nReady && !generating) ? (
                    <button type="button" className="s2v-au-btn" disabled={locked} onClick={() => props.onSkipLayer('narration')} title="Drop the voiceover and assemble from the clips’ own sound. Nothing is regenerated.">
                      <SkipForward size={16} /> Continue without voiceover
                    </button>
                  ) : null}
                </div>
              </div>
              {props.voiceSource === 'openai' ? (
                <p className="s2v-au-help">Narrated with the built-in {openAiVoiceLabel(props.openaiVoice)} voice. Changing the voice re-records the narration only — the video clips are never regenerated.</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* —— MUSIC —— */}
      {tab === 'music' ? (
        <div className="s2v-au-panel" role="tabpanel" id="s2v-au-panel-music" aria-labelledby="s2v-au-tab-music">
          <div className="s2v-au-item">
            <div className="s2v-au-item-main">
              <PlayButton
                playing={isPlaying('music')}
                enabled={!!music?.audioUrl}
                label="music preview"
                onClick={() => music?.audioUrl && toggle('music', [String(music.audioUrl)])}
              />
              <div className="s2v-au-item-text">
                <div className="s2v-au-item-title">
                  {music?.status === 'ready' ? capitalize(music.preset || 'custom') : music?.status === 'skipped' ? 'No music' : music?.status === 'failed' ? 'Music failed' : mState === 'active' ? 'Selecting a bed…' : 'No music selected yet'}
                </div>
                <div className={`s2v-au-item-sub${music?.status === 'failed' ? ' is-error' : ''}`}>
                  {music?.status === 'ready'
                    ? [musicProvider, music.duration_s ? fmtClock(Number(music.duration_s) * 1000) : '', music.mood].filter(Boolean).join(' · ') || 'Selected track'
                    : music?.status === 'skipped'
                      ? music.skip_reason === 'providers_unavailable' ? 'Continuing without music — providers unavailable.' : 'Skipped — the film ships without a music bed.'
                      : music?.status === 'failed' ? (music.error || 'Music preparation failed.')
                        : mState === 'active' ? 'Composing a bed for this film.'
                          : !done.length ? 'Music needs at least one finished scene.' : 'Select music to compose a bed for this film.'}
                </div>
              </div>
            </div>
            <div className="s2v-au-actions">
              {!audio || (music && music.status === 'pending' && !generating) ? (
                <button type="button" className="s2v-au-btn is-primary" disabled={locked || !done.length} onClick={() => props.onRunLayer('music')}><Music size={16} /> Select music</button>
              ) : null}
              {music?.status === 'failed' ? <button type="button" className="s2v-au-btn is-primary" disabled={locked} onClick={() => props.onRetryLayer('music')}><RefreshCw size={16} /> Retry</button> : null}
              {music?.status === 'failed' ? <button type="button" className="s2v-au-btn" disabled={locked} onClick={() => props.onSkipLayer('music')}><SkipForward size={16} /> Continue without music</button> : null}
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="s2v-au-label">Music style</span>
            <SelectField
              value={(MUSIC_PRESETS as readonly string[]).includes(String(music?.preset)) ? String(music?.preset) : 'cinematic'}
              disabled={locked}
              onChange={(e) => props.onChangeMusic(e.target.value as MusicPreset)}
              wrapStyle={{ width: 'fit-content', maxWidth: '100%' }}
            >
              {MUSIC_PRESETS.map((p) => <option key={p} value={p}>{capitalize(p)}</option>)}
            </SelectField>
          </label>
          <p className="s2v-au-help">Changing the style re-composes the music bed only. It ducks under narration automatically, and the video clips are never regenerated.</p>
        </div>
      ) : null}

      {/* —— SFX —— */}
      {tab === 'sfx' ? (
        <div className="s2v-au-panel" role="tabpanel" id="s2v-au-panel-sfx" aria-labelledby="s2v-au-tab-sfx">
          <div className="s2v-au-item">
            <div className="s2v-au-item-main">
              <PlayButton
                playing={isPlaying('sfx')}
                enabled={sfxReadyItems.length > 0}
                label="sound effects preview"
                onClick={() => toggle('sfx', sfxReadyItems.map((f) => String(f.audioUrl)))}
              />
              <div className="s2v-au-item-text">
                <div className="s2v-au-item-title">
                  {sfxStatus === 'ready' ? `${sfxReadyItems.length} effect${sfxReadyItems.length === 1 ? '' : 's'} prepared` : sfxStatus === 'none' && audio ? 'No sound effects planned' : sfxStatus === 'skipped' ? 'Sound effects skipped' : sfxStatus === 'failed' ? 'Sound effects failed' : sState === 'active' ? 'Preparing sound effects…' : 'Sound effects not prepared'}
                </div>
                <div className={`s2v-au-item-sub${sfxStatus === 'failed' ? ' is-error' : ''}`}>
                  {sfxItems.length && sfxStatus !== 'failed' ? 'Subtle, tied to scene actions.'
                    : sfxStatus === 'failed' ? (failedSfx?.error || 'Sound effect preparation failed.')
                      : audio && sfxStatus === 'none' ? 'The sound director planned none for this film — that is a valid choice.'
                        : sfxStatus === 'skipped' ? 'Skipped — the film ships without sound effects.'
                          : 'Planned with the audio stage.'}
                </div>
              </div>
            </div>
            <div className="s2v-au-actions">
              {!audio || (sfxStatus === 'pending' && !generating) ? (
                <button type="button" className="s2v-au-btn is-primary" disabled={locked || !done.length} onClick={() => props.onRunLayer('sfx')}><Volume2 size={16} /> Prepare SFX</button>
              ) : null}
              {sfxStatus === 'failed' ? <button type="button" className="s2v-au-btn is-primary" disabled={locked} onClick={() => props.onRetryLayer('sfx')}><RefreshCw size={16} /> Retry</button> : null}
              {sfxStatus === 'failed' ? <button type="button" className="s2v-au-btn" disabled={locked} onClick={() => props.onSkipLayer('sfx')}><SkipForward size={16} /> Continue without SFX</button> : null}
              {sfxStatus === 'ready' && sfxItems.length ? <button type="button" className="s2v-au-btn" disabled={locked} onClick={props.onRegenSfx}><RefreshCw size={16} /> Regenerate</button> : null}
            </div>
          </div>
          {sfxItems.length ? (
            <div>
              <button type="button" className="s2v-au-btn" aria-expanded={showEffects} aria-controls="s2v-au-effects" onClick={() => setShowEffects((v) => !v)}>
                {showEffects ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {showEffects ? 'Hide effects' : `Show effects (${sfxItems.length})`}
              </button>
              {showEffects ? (
                <ul className="s2v-au-effects" id="s2v-au-effects" style={{ marginTop: 8 }}>
                  {sfxItems.map((f, i) => (
                    <li key={`${f.scene_key}-${i}`}>
                      <Dot state={f.status === 'ready' ? 'done' : f.status === 'failed' ? 'failed' : 'active'} />
                      <span className="s2v-au-effect-text">{f.description || 'Sound effect'}</span>
                      <span className="s2v-au-effect-meta">{sceneNumber(f.scene_key) ? `Scene ${sceneNumber(f.scene_key)} · ` : ''}@{Number(f.at_s || 0).toFixed(1)}s</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <p className="s2v-au-help">Sound effects are sparse and subtle — only where they land a visual event. Regenerating them never touches the video clips.</p>
        </div>
      ) : null}
    </div>
  );
}
