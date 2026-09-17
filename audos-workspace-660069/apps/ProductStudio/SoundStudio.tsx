/**
 * Sound Studio — the sound-and-captions finishing step for Product Launch
 * films. It takes a video that already exists and lays over it exactly what
 * the styled wizard lays over its own films, using the same ElevenLabs
 * helpers and the same Remotion finish composition:
 *
 *   - a background-music bed (ElevenLabs)
 *   - an OPTIONAL sound-effects bed from the creation flow's optional SFX
 *     field, or edited here
 *   - OPTIONAL auto-captions, which both burn into the video and come back as
 *     a downloadable .SRT file
 *
 * The finished MP4 replaces the card's video in the unified Saved Videos
 * gallery, with the caption file attached to the same row.
 *
 * The render runs through the platform's Remotion pipeline and is polled here;
 * a Product Launch film is short, so this is a single foreground step rather
 * than a durable background chain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Captions, Check, Download, FileText, Loader2, Music, Sparkles, Volume2, X,
} from 'lucide-react';
import { WORKSPACE_UUID, workspaceToken, checkRender } from '../VideoEnhancer/enhancerCore';
import { buildFinishComposition, buildSrt, type CaptionCue } from './videoStyles';
import { byokVerdictNote, generateMusicBed, generateNarration, generateSfxBed, type GeneratedTrack } from './audioSuite';
import { registerSavedVideo } from './SavedVideos';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  brand: 'var(--space-text-brand)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  panel: 'var(--space-surface-panel)',
  panelStrong: 'var(--space-surface-panel-strong)',
  card: 'var(--space-surface-card)',
  danger: 'var(--space-semantic-danger-500)',
  success: 'var(--space-semantic-success-500)',
};

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 };
const inputStyle: React.CSSProperties = { boxSizing: 'border-box', width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13.5 };
const panelStyle: React.CSSProperties = { borderRadius: 16, border: `1px solid ${S.border}`, background: S.panel, padding: 'clamp(14px, 2.5vw, 20px)', marginBottom: 14 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 20px', borderRadius: 11, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13.5, fontWeight: 700 };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' };

const DEFAULT_MUSIC_PROMPT =
  'Warm, confident product-launch underscore: bright plucked synth, a steady four-on-the-floor pulse, soft claps and a rounded sub bass. Optimistic and modern, sits under a speaking voice. Around one hundred beats per minute.';

/** Where the optional SFX brief and captions choice from the creation flow are parked. */
const PREFS_KEY = 'ps-launch-sound-prefs-v1';

export interface LaunchSoundPrefs { sfxPrompt?: string; captions?: boolean }

export function readLaunchSoundPrefs(projectId: number): LaunchSoundPrefs {
  try {
    const all = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
    const one = all && typeof all === 'object' ? all[String(projectId)] : null;
    return one && typeof one === 'object' ? one : {};
  } catch { return {}; }
}

/**
 * Remember the optional sound-effects brief and captions choice the customer
 * made while creating a Product Launch video, so the sound step opens with
 * their answers already filled in rather than asking twice.
 */
export function writeLaunchSoundPrefs(projectId: number, prefs: LaunchSoundPrefs): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
    const next = all && typeof all === 'object' ? all : {};
    next[String(projectId)] = prefs;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch { /* the step still works, it just starts empty */ }
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function slug(s: string): string {
  return (s || 'video').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'video';
}

/**
 * Split a narration script into caption cues spread evenly across the film.
 * The Product Launch film has no per-shot narration table to time against, so
 * the cues are paced by word count — close enough to read along with, and the
 * .SRT is editable afterwards.
 */
function cuesFromScript(scriptText: string, durationSec: number): CaptionCue[] {
  const sentences = scriptText
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length || durationSec <= 0) return [];
  const totalWords = sentences.reduce((n, s) => n + s.split(/\s+/).length, 0) || 1;
  let t = 0;
  return sentences.map((text) => {
    const share = (text.split(/\s+/).length / totalWords) * durationSec;
    const cue = { start: Math.round(t * 100) / 100, end: Math.round((t + share) * 100) / 100, text };
    t += share;
    return cue;
  });
}

async function submitFinishRender(props: Record<string, unknown>, durationInFrames: number): Promise<string> {
  const res = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      workspaceId: WORKSPACE_UUID,
      compositionTsx: buildFinishComposition('clean'),
      props,
      durationInFrames,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.operationId) {
    throw new Error(String(data?.error || `The sound render could not be started (HTTP ${res.status}).`));
  }
  return String(data.operationId);
}

export interface SoundTarget {
  title: string;
  videoUrl: string;
  /** The row this video came from, so the result lands on the same gallery card. */
  sourceId: number;
  source: 'clipstyle' | 'product_launch';
  /** The film's narration, when the app knows it — used for the captions. */
  scriptText?: string;
}

export default function SoundStudio({ target, onBack }: { target: SoundTarget; onBack: () => void }) {
  const prefs = useMemo(() => readLaunchSoundPrefs(target.sourceId), [target.sourceId]);

  const [duration, setDuration] = useState(0);
  const [musicOn, setMusicOn] = useState(true);
  const [musicPrompt, setMusicPrompt] = useState(DEFAULT_MUSIC_PROMPT);
  const [musicTrack, setMusicTrack] = useState<GeneratedTrack | null>(null);
  const [sfxPrompt, setSfxPrompt] = useState(prefs.sfxPrompt || '');
  const [sfxTrack, setSfxTrack] = useState<GeneratedTrack | null>(null);
  const [captionsOn, setCaptionsOn] = useState(prefs.captions === true);
  const [scriptText, setScriptText] = useState(target.scriptText || '');
  const [narrationOn, setNarrationOn] = useState(false);
  const [narrationUrl, setNarrationUrl] = useState('');

  const [busy, setBusy] = useState<'' | 'music' | 'sfx' | 'narration' | 'render'>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState('');

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const cues = useMemo(() => (captionsOn ? cuesFromScript(scriptText, duration) : []), [captionsOn, scriptText, duration]);
  const srt = useMemo(() => buildSrt(cues), [cues]);

  const makeMusic = useCallback(async () => {
    setError(null);
    setBusy('music');
    try {
      setMusicTrack(await generateMusicBed(musicPrompt, duration || 30, setNote));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy('');
      setNote('');
    }
  }, [musicPrompt, duration]);

  const makeSfx = useCallback(async () => {
    setError(null);
    setBusy('sfx');
    try {
      setSfxTrack(await generateSfxBed(sfxPrompt, duration || 30, setNote));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy('');
      setNote('');
    }
  }, [sfxPrompt, duration]);

  const makeNarration = useCallback(async () => {
    setError(null);
    setBusy('narration');
    try {
      const res = await generateNarration(scriptText, null, setNote);
      setNarrationUrl(res.url);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy('');
      setNote('');
    }
  }, [scriptText]);

  const runRender = useCallback(async () => {
    setError(null);
    setBusy('render');
    setNote('Submitting the sound render…');
    try {
      const frames = Math.max(30, Math.round((duration || 30) * 30));
      const opId = await submitFinishRender({
        videoUrl: target.videoUrl,
        narrationUrl: narrationOn ? narrationUrl : '',
        musicUrl: musicOn && musicTrack ? musicTrack.url : '',
        sfxUrl: sfxTrack ? sfxTrack.url : '',
        musicVolume: 0.24,
        sfxVolume: 0.26,
        showCaptions: captionsOn && cues.length > 0,
        captions: cues,
      }, frames);
      setNote('Rendering — this usually takes about a minute…');
      const startedAt = Date.now();
      while (aliveRef.current) {
        await new Promise((r) => { window.setTimeout(r, 4000); });
        const st = await checkRender(opId).catch(() => null);
        if (!aliveRef.current) return;
        if (st?.status === 'complete' && st.videoUrl) {
          setOutputUrl(st.videoUrl);
          setNote('');
          // Land the result on the same gallery card, caption file included.
          await registerSavedVideo({
            source: target.source,
            source_id: target.sourceId,
            title: target.title,
            style: target.source === 'product_launch' ? 'hyperframes' : undefined,
            video_url: st.videoUrl,
            srt_text: captionsOn && srt ? srt : undefined,
            duration_seconds: duration || undefined,
          }).catch(() => undefined);
          break;
        }
        if (st?.status === 'failed') throw new Error(st.error || 'The sound render failed.');
        if (Date.now() - startedAt > 10 * 60 * 1000) throw new Error('The render is taking longer than ten minutes — try again.');
      }
    } catch (e) {
      if (aliveRef.current) { setError(msg(e)); setNote(''); }
    } finally {
      if (aliveRef.current) setBusy('');
    }
  }, [duration, target, narrationOn, narrationUrl, musicOn, musicTrack, sfxTrack, captionsOn, cues, srt]);

  const downloadSrt = useCallback(() => {
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = slug(target.title) + '.srt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, [srt, target.title]);

  const nothingToAdd = !(musicOn && musicTrack) && !sfxTrack && !(narrationOn && narrationUrl) && !(captionsOn && cues.length);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 'clamp(14px, 3vw, 28px)', color: S.text, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" onClick={onBack} className="ps-btn" style={ghostBtn} data-testid="button-sound-back">
          <ArrowLeft size={13} /> Back
        </button>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 'clamp(17px, 2.6vw, 22px)', fontWeight: 800 }}>
          <Volume2 size={19} color="var(--space-text-brand)" /> Sound &amp; captions
        </h1>
      </header>

      <section style={panelStyle}>
        <video
          src={outputUrl || target.videoUrl}
          key={outputUrl || target.videoUrl}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => setDuration((d) => d || e.currentTarget.duration || 0)}
          style={{ display: 'block', width: '100%', maxWidth: 640, borderRadius: 14, border: `1px solid ${S.borderStrong}`, background: '#000' }}
          data-testid="sound-player"
        />
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: S.sub, lineHeight: 1.6 }}>
          <strong style={{ color: S.text }}>{target.title}</strong>
          {duration ? ` · ${Math.round(duration)}s` : ''}
          {outputUrl ? ' · playing the version with sound' : ''}
        </p>
      </section>

      {/* Background music */}
      <section style={panelStyle} data-testid="panel-launch-music">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ flex: 1, minWidth: 140, fontSize: 13.5, fontWeight: 800 }}><Music size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />Background music</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.sub, cursor: 'pointer' }}>
            <input type="checkbox" checked={musicOn} onChange={(e) => setMusicOn(e.currentTarget.checked)} /> Include
          </label>
          <button type="button" onClick={() => void makeMusic()} disabled={!musicOn || busy !== ''} className="ps-btn" style={{ ...ghostBtn, opacity: !musicOn || busy !== '' ? 0.55 : 1 }} data-testid="button-launch-music">
            {busy === 'music' ? <Loader2 size={13} className="rc-spin" /> : <Music size={13} />}
            {musicTrack ? 'Regenerate' : 'Generate music'}
          </button>
        </div>
        <textarea value={musicPrompt} onChange={(e) => setMusicPrompt(e.currentTarget.value)} rows={2} disabled={!musicOn} className="ps-input" style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical', opacity: musicOn ? 1 : 0.55 }} data-testid="input-launch-music-prompt" />
        {musicTrack ? (
          <div style={{ marginTop: 9 }}>
            <audio src={musicTrack.url} controls style={{ width: '100%', height: 34 }} data-testid="audio-launch-music" />
            <p style={{ margin: '6px 0 0', fontSize: 11, color: S.muted }}>{musicTrack.note}</p>
          </div>
        ) : null}
      </section>

      {/* OPTIONAL sound effects */}
      <section style={panelStyle} data-testid="panel-launch-sfx">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ flex: 1, minWidth: 140, fontSize: 13.5, fontWeight: 800 }}>
            Sound effects
            <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: S.panelStrong, color: S.muted }}>OPTIONAL</span>
          </span>
          <button type="button" onClick={() => void makeSfx()} disabled={!sfxPrompt.trim() || busy !== ''} className="ps-btn" style={{ ...ghostBtn, opacity: !sfxPrompt.trim() || busy !== '' ? 0.55 : 1 }} data-testid="button-launch-sfx">
            {busy === 'sfx' ? <Loader2 size={13} className="rc-spin" /> : <Sparkles size={13} />}
            {sfxTrack ? 'Regenerate' : 'Generate effects'}
          </button>
        </div>
        <textarea value={sfxPrompt} onChange={(e) => { setSfxPrompt(e.currentTarget.value); setSfxTrack(null); }} rows={2} placeholder="Leave empty to skip. Or describe the effects you want, e.g. a soft whoosh on each scene change and a bright chime on the logo." className="ps-input" style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }} data-testid="input-launch-sfx-prompt" />
        <p style={{ margin: '7px 0 0', fontSize: 11, color: S.muted }}>Nothing to add? Leave it blank — this is entirely optional.</p>
        {sfxTrack ? (
          <div style={{ marginTop: 9 }}>
            <audio src={sfxTrack.url} controls style={{ width: '100%', height: 34 }} data-testid="audio-launch-sfx" />
            <p style={{ margin: '6px 0 0', fontSize: 11, color: S.muted }}>{sfxTrack.note}</p>
          </div>
        ) : null}
      </section>

      {/* OPTIONAL captions */}
      <section style={panelStyle} data-testid="panel-launch-captions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Captions size={14} style={{ color: S.brand }} />
          <span style={{ flex: 1, minWidth: 140, fontSize: 13.5, fontWeight: 800 }}>
            Add captions
            <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: S.panelStrong, color: S.muted }}>OPTIONAL</span>
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.sub, cursor: 'pointer' }}>
            <input type="checkbox" checked={captionsOn} onChange={(e) => setCaptionsOn(e.currentTarget.checked)} data-testid="toggle-launch-captions" /> On
          </label>
        </div>
        <p style={{ margin: '8px 0 8px', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
          Burns captions into the video and gives you a .SRT file to download beside it. Paste or edit the narration below so the captions match what is said.
        </p>
        {captionsOn ? (
          <div className="ps-fade-up">
            <span style={labelStyle}>Narration text</span>
            <textarea value={scriptText} onChange={(e) => setScriptText(e.currentTarget.value)} rows={5} placeholder="Paste the narration for this video. Each sentence becomes one caption, paced across the film." className="ps-input" style={{ ...inputStyle, fontSize: 12.5, lineHeight: 1.55, resize: 'vertical' }} data-testid="input-launch-script" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 8 }}>
              <span style={{ fontSize: 11.5, color: cues.length ? S.sub : S.muted }}>
                {cues.length ? `${cues.length} captions timed across ${Math.round(duration)}s` : 'Add narration text to time the captions.'}
              </span>
              {srt ? (
                <button type="button" onClick={downloadSrt} className="ps-btn" style={{ ...ghostBtn, padding: '6px 11px', fontSize: 11.5 }} data-testid="button-launch-srt">
                  <FileText size={12} /> Download .srt
                </button>
              ) : null}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.sub, cursor: 'pointer' }}>
                <input type="checkbox" checked={narrationOn} onChange={(e) => setNarrationOn(e.currentTarget.checked)} /> Also speak it with ElevenLabs
              </label>
              {narrationOn ? (
                <button type="button" onClick={() => void makeNarration()} disabled={!scriptText.trim() || busy !== ''} className="ps-btn" style={{ ...ghostBtn, padding: '6px 11px', fontSize: 11.5, opacity: !scriptText.trim() || busy !== '' ? 0.55 : 1 }} data-testid="button-launch-narration">
                  {busy === 'narration' ? <Loader2 size={12} className="rc-spin" /> : <Volume2 size={12} />}
                  {narrationUrl ? 'Re-record' : 'Record narration'}
                </button>
              ) : null}
            </div>
            {narrationOn && narrationUrl ? <audio src={narrationUrl} controls style={{ width: '100%', marginTop: 9, height: 34 }} data-testid="audio-launch-narration" /> : null}
          </div>
        ) : null}
      </section>

      {/* Render */}
      <section style={{ ...panelStyle, border: `1px solid color-mix(in srgb, ${S.success} 40%, transparent)` }} data-testid="panel-launch-render">
        <button type="button" onClick={() => void runRender()} disabled={busy !== '' || nothingToAdd} className="ps-btn" style={{ ...primaryBtn, width: '100%', justifyContent: 'center', opacity: busy !== '' || nothingToAdd ? 0.6 : 1 }} data-testid="button-launch-render">
          {busy === 'render' ? <Loader2 size={15} className="rc-spin" /> : <Volume2 size={15} />}
          {busy === 'render' ? 'Rendering…' : 'Add the sound to this video'}
        </button>
        <p style={{ margin: '9px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
          {nothingToAdd
            ? 'Generate music, sound effects or captions above first — then this renders them onto the video.'
            : 'Mixes everything you generated over the film in one pass and saves the result to Saved Videos.'}
        </p>
        {note ? (
          <p role="status" style={{ margin: '9px 0 0', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: S.brand }} data-testid="note-launch-render">
            <Loader2 size={12} className="rc-spin" /> {note}
          </p>
        ) : null}
        {outputUrl ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 11 }}>
            <p style={{ margin: 0, flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: S.success }}>
              <Check size={14} /> Done — the version with sound is saved to Saved Videos.
            </p>
            <a href={outputUrl} download target="_blank" rel="noreferrer" className="ps-btn" style={primaryBtn} data-testid="link-launch-download">
              <Download size={14} /> Download MP4
            </a>
            {srt ? (
              <button type="button" onClick={downloadSrt} className="ps-btn" style={ghostBtn} data-testid="button-launch-srt-done">
                <FileText size={13} /> Download .srt
              </button>
            ) : null}
          </div>
        ) : null}
        {byokVerdictNote() ? (
          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }} data-testid="note-launch-byok">{byokVerdictNote()}</p>
        ) : null}
        {error ? (
          <p role="alert" style={{ margin: '9px 0 0', display: 'flex', gap: 6, fontSize: 12.5, color: S.danger, lineHeight: 1.5 }} data-testid="error-launch">
            <X size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
