// Post-production: five edits on a film that is already rendered.
//
// The organising idea is that NONE of these re-render the avatar. Re-voicing,
// translating, scoring, adding an effect and cutting shorts all operate on the
// finished MP4, so each is cheap enough to try twice. The panel only appears
// once there is something to work on, because every action here needs a
// finished video URL.
//
// Re-voice and translate live here; the three audition-based tools (music,
// sound effects, clipping) live in PostExtras.
import { useEffect, useState } from 'react';
import { Download, Languages, Mic2, Music, Scissors, Volume2 } from 'lucide-react';
import { cacheAsset, describeError } from '../../lib/heygenApi';
import { QUALITY_MODES, lipsyncVideo, translateVideo, type QualityMode, type Translation } from '../../lib/heygenPost';
import { removeFillerWords } from '../../lib/heygenVoice';
import { BUNDLED_LANGUAGES, fetchTargetLanguages, type TargetLanguage } from '../../lib/translateLanguages';
import { finishJob, localJobId, recordJob } from '../../lib/sfJobs';
import PostExtras, { type ExtraTool } from './PostExtras';
import { Button, CapabilityNote, Field, Notice, Panel, Progress, Segmented, Toggle, Working } from './ui';

type Tool = 'revoice' | 'translate' | ExtraTool;

const TOOLS: { value: Tool; label: string; icon: any }[] = [
  { value: 'revoice', label: 'Re-voice', icon: Mic2 },
  { value: 'translate', label: 'Translate', icon: Languages },
  { value: 'music', label: 'Music', icon: Music },
  { value: 'sfx', label: 'Sound effect', icon: Volume2 },
  { value: 'clips', label: 'Short clips', icon: Scissors },
];

export default function PostPanel({ step, videoUrl, onNewVideo }: { step: number; videoUrl: string; onNewVideo: (url: string) => void }) {
  const [tool, setTool] = useState<Tool>('revoice');
  const [busy, setBusy] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  const [audioUrl, setAudioUrl] = useState('');
  const [cleanAudio, setCleanAudio] = useState(true);
  const [fillerNote, setFillerNote] = useState('');
  const [lipsyncMode, setLipsyncMode] = useState<QualityMode>('precision');

  const [languages, setLanguages] = useState<TargetLanguage[]>(BUNDLED_LANGUAGES);
  const [liveLanguages, setLiveLanguages] = useState(false);
  const [language, setLanguage] = useState('hindi');
  const [translateMode, setTranslateMode] = useState<QualityMode>('precision');
  const [translations, setTranslations] = useState<Translation[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchTargetLanguages()
      .then((result) => {
        if (cancelled) return;
        setLanguages(result.languages);
        setLiveLanguages(result.live);
      })
      .catch(() => { /* the bundled list is already loaded */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const clock = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(clock);
  }, [busy]);

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setElapsed(0);
    setError('');
    try { await work(); }
    catch (e) { setError(describeError(e)); }
    finally { setBusy(''); }
  }

  async function revoice() {
    await run('revoice', async () => {
      let source = audioUrl;
      // The cleanup runs BEFORE the lipsync so the filler words never make it
      // into the render — the only order in which this actually helps. A
      // cleanup that fails is not fatal: the raw narration is used instead and
      // the customer is told, rather than losing the re-voice entirely.
      if (cleanAudio) {
        try {
          const cleaned = await removeFillerWords(source);
          source = cleaned.audioUrl || source;
          setFillerNote(cleaned.note);
        } catch (e) {
          setFillerNote(`Audio cleanup was skipped (${describeError(e).slice(0, 110)}). Your original narration was used.`);
        }
      }
      const jobId = localJobId('lipsync');
      await recordJob({ videoId: jobId, jobType: 'lipsync', metadata: { mode: lipsyncMode, audio_url: source, cleaned: cleanAudio } });
      const result = await lipsyncVideo(videoUrl, source, lipsyncMode, setElapsed);
      await finishJob(jobId, result.url);
      onNewVideo(result.url);
    });
  }

  async function translate() {
    await run('translate', async () => {
      const label = languages.find((entry) => entry.code === language)?.label || language;
      const jobId = localJobId('translation');
      await recordJob({ videoId: jobId, jobType: 'translation', metadata: { target_language: language, mode: translateMode } });
      const result = await translateVideo(videoUrl, language, label, translateMode, setElapsed);
      await finishJob(jobId, result.videoUrl);
      setTranslations((current) => [result, ...current.filter((entry) => entry.language !== result.language)]);
    });
  }

  return <Panel
    step={step}
    title="Finish it"
    hint="Change the narration, translate it, score it, add an effect or cut it into shorts — none of these re-render your avatar."
  >
    <div className="space-y-4">
      <Segmented value={tool} options={TOOLS} onChange={(value) => setTool(value)} />

      {tool === 'revoice' ? <div className="space-y-3">
        <CapabilityNote capability="lipsync" label="Lipsync re-voicing" />
        <Field label="New narration" hint="Upload a WAV, MP3 or M4A, or paste a link to one. The avatar's mouth is re-timed to it.">
          <input
            type="file"
            accept="audio/*,video/mp4"
            disabled={Boolean(busy)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void run('audio', async () => {
                const asset = await cacheAsset(file, 'sceneforge-heygen-audio');
                setAudioUrl(asset.url);
                setFillerNote('');
              });
            }}
            className="st-field file:mr-3 file:rounded-lg file:border-0 file:bg-[color-mix(in_srgb,#8b5cf6_22%,transparent)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
        </Field>
        <Field label="Or paste an audio URL">
          <input value={audioUrl} onChange={(event) => setAudioUrl(event.target.value)} placeholder="https://" className="st-field" />
        </Field>
        <Toggle
          checked={cleanAudio}
          onChange={setCleanAudio}
          label="Clean up the audio first"
          hint="Strips \u201cum\u201d and \u201cuh\u201d before the lipsync, so the fillers never reach the render."
        />
        <Field label="Quality" hint={QUALITY_MODES.find((entry) => entry.value === lipsyncMode)?.blurb}>
          <Segmented value={lipsyncMode} onChange={(value) => setLipsyncMode(value)} options={QUALITY_MODES.map((entry) => ({ value: entry.value, label: entry.label }))} />
        </Field>
        {busy === 'audio' ? <Working text="Uploading your narration" /> : null}
        {fillerNote ? <Notice tone="info" title="Audio cleanup">{fillerNote}</Notice> : null}
        <Button onClick={revoice} busy={busy === 'revoice'} disabled={!audioUrl || Boolean(busy)}>
          <Mic2 className="h-4 w-4" />Re-voice this video
        </Button>
      </div> : null}

      {tool === 'translate' ? <div className="space-y-3">
        <CapabilityNote capability="translation" label="Video translation" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Language" hint={`${languages.length} languages${liveLanguages ? ' from your HeyGen account' : ''}`}>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} className="st-field" disabled={Boolean(busy)}>
              {languages.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
            </select>
          </Field>
          <Field label="Quality" hint={QUALITY_MODES.find((entry) => entry.value === translateMode)?.blurb}>
            <Segmented value={translateMode} onChange={(value) => setTranslateMode(value)} options={QUALITY_MODES.map((entry) => ({ value: entry.value, label: entry.label }))} />
          </Field>
        </div>
        <Button onClick={translate} busy={busy === 'translate'} disabled={Boolean(busy)}>
          <Languages className="h-4 w-4" />Translate
        </Button>
        {translations.length ? <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Your translations</p>
          {translations.map((entry) => <div key={entry.language} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--space-text-primary)]">{entry.label}</span>
            <span className="text-[11px] uppercase tracking-wide text-[var(--space-text-muted)]">{entry.mode}</span>
            <a href={entry.videoUrl} download target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]">
              <Download className="h-3 w-3" />MP4
            </a>
          </div>)}
        </div> : null}
      </div> : null}

      {tool === 'music' || tool === 'sfx' || tool === 'clips' ? <PostExtras
        tool={tool}
        videoUrl={videoUrl}
        busy={busy}
        onBusy={setBusy}
        onElapsed={setElapsed}
        onNewVideo={onNewVideo}
      /> : null}

      {busy && busy !== 'audio' ? <Progress
        elapsedSec={elapsed}
        expectedSec={tool === 'translate' ? 300 : tool === 'clips' ? 200 : 150}
        label={`Working on your ${TOOLS.find((entry) => entry.value === tool)?.label.toLowerCase()}`}
      /> : null}
      {error ? <Notice tone="error" title="That edit did not go through">{error}</Notice> : null}

      <p className="text-[11px] text-[var(--space-text-muted)]">
        Each finished edit replaces the player above, and every version stays downloadable.
      </p>
    </div>
  </Panel>;
}
