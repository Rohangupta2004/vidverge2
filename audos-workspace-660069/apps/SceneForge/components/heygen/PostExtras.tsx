// Scoring, sound design and short-form cuts.
//
// Split out of PostPanel so each half stays readable: the panel owns the tool
// switch, the re-voice and the translation; this file owns the three tools
// that work by AUDITION — HeyGen returns candidates and the customer picks,
// because a score and a sound effect are taste decisions that must never be
// applied automatically.
import { useState } from 'react';
import { Download, Music, Scissors, Volume2 } from 'lucide-react';
import { describeError } from '../../lib/heygenApi';
import { applyMusic, createClips, suggestMusic, suggestSoundEffects, type Highlight, type MusicTrack, type SoundEffect } from '../../lib/heygenPost';
import { finishJob, localJobId, recordJob } from '../../lib/sfJobs';
import { Button, CapabilityNote, Field, Notice } from './ui';

export type ExtraTool = 'music' | 'sfx' | 'clips';

export default function PostExtras(props: {
  tool: ExtraTool;
  videoUrl: string;
  busy: string;
  onBusy: (key: string) => void;
  onElapsed: (seconds: number) => void;
  onNewVideo: (url: string) => void;
}) {
  const [error, setError] = useState('');
  const [mood, setMood] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [sfxPrompt, setSfxPrompt] = useState('');
  const [effects, setEffects] = useState<SoundEffect[]>([]);
  const [clips, setClips] = useState<Highlight[]>([]);

  async function run(key: string, work: () => Promise<void>) {
    props.onBusy(key);
    setError('');
    try { await work(); }
    catch (e) { setError(describeError(e)); }
    finally { props.onBusy(''); }
  }

  const busy = Boolean(props.busy);

  return <div className="space-y-3">
    {props.tool === 'music' ? <>
      <CapabilityNote capability="music" label="Background music" />
      <Field label="What should it feel like?" hint="For example: warm and understated, building to the CTA.">
        <input value={mood} onChange={(event) => setMood(event.target.value)} placeholder="Warm, modern, understated" className="st-field" />
      </Field>
      <Button onClick={() => run('music', async () => setTracks(await suggestMusic(props.videoUrl, mood)))} busy={props.busy === 'music'} disabled={busy}>
        <Music className="h-4 w-4" />Find tracks
      </Button>
      {tracks.length ? <div className="space-y-2">
        {tracks.map((track) => <div key={track.id} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--space-text-primary)]">{track.title}</span>
            {track.mood ? <span className="text-[11px] text-[var(--space-text-muted)]">{track.mood}</span> : null}
          </div>
          {track.previewUrl ? <audio src={track.previewUrl} controls className="mt-2 w-full" /> : null}
          <div className="mt-2">
            <Button
              tone="ghost"
              busy={props.busy === `apply-${track.id}`}
              disabled={busy}
              onClick={() => run(`apply-${track.id}`, async () => {
                const jobId = localJobId('music');
                await recordJob({ videoId: jobId, jobType: 'music', metadata: { track_id: track.id, mood } });
                const result = await applyMusic(props.videoUrl, track, props.onElapsed);
                await finishJob(jobId, result.url);
                props.onNewVideo(result.url);
              })}
            >
              Use this track
            </Button>
          </div>
        </div>)}
      </div> : null}
    </> : null}

    {props.tool === 'sfx' ? <>
      <CapabilityNote capability="sfx" label="Sound effects" />
      <Field label="Describe the sound" hint="For example: product reveal whoosh, soft UI click, camera shutter.">
        <input value={sfxPrompt} onChange={(event) => setSfxPrompt(event.target.value)} placeholder="Product reveal whoosh" className="st-field" />
      </Field>
      <Button
        onClick={() => run('sfx', async () => setEffects(await suggestSoundEffects(sfxPrompt)))}
        busy={props.busy === 'sfx'}
        disabled={!sfxPrompt.trim() || busy}
      >
        <Volume2 className="h-4 w-4" />Find effects
      </Button>
      {effects.length ? <div className="space-y-2">
        {effects.map((effect) => <div key={effect.id} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
          <span className="block truncate text-sm font-medium text-[var(--space-text-primary)]">{effect.label}</span>
          <audio src={effect.audioUrl} controls className="mt-2 w-full" />
          <a href={effect.audioUrl} download target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--space-text-secondary)] underline decoration-dotted">
            <Download className="h-3 w-3" />Download this effect
          </a>
        </div>)}
        <p className="text-xs leading-relaxed text-[var(--space-text-muted)]">
          Add the effect you picked to a scene in the Motion Graphics Editor, where it is mixed under the narration at the
          timestamp you choose.
        </p>
      </div> : null}
    </> : null}

    {props.tool === 'clips' ? <>
      <CapabilityNote capability="clipping" label="AI clipping" />
      <p className="text-xs leading-relaxed text-[var(--space-text-muted)]">
        HeyGen finds the strongest moments in your finished film and cuts each one into its own short &mdash; ready for
        Reels, Shorts and TikTok.
      </p>
      <Button
        onClick={() => run('clips', async () => {
          const jobId = localJobId('clipping');
          await recordJob({ videoId: jobId, jobType: 'clipping', metadata: { source: props.videoUrl } });
          const found = await createClips(props.videoUrl, props.onElapsed);
          setClips(found);
          if (found[0]?.videoUrl) await finishJob(jobId, found[0].videoUrl);
        })}
        busy={props.busy === 'clips'}
        disabled={busy}
      >
        <Scissors className="h-4 w-4" />Create short clips
      </Button>
      {clips.length ? <div className="grid gap-3 sm:grid-cols-2">
        {clips.map((clip) => <div key={clip.id} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
          <video src={clip.videoUrl} controls playsInline poster={clip.thumbnailUrl || undefined} className="w-full rounded-lg bg-black" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--space-text-primary)]">{clip.title}</span>
            {clip.endSec ? <span className="text-[11px] text-[var(--space-text-muted)]">
              {Math.round(clip.startSec)}s&ndash;{Math.round(clip.endSec)}s
            </span> : null}
            <a href={clip.videoUrl} download target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]">
              <Download className="h-3 w-3" />MP4
            </a>
          </div>
        </div>)}
      </div> : null}
    </> : null}

    {error ? <Notice tone="error" title="That edit did not go through">{error}</Notice> : null}
  </div>;
}
