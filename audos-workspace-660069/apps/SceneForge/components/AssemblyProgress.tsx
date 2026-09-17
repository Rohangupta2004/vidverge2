import { AlertTriangle, Download, Loader2, Music, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { CheckResult, Project } from '../lib/supabase';
import ChecksReport from './ChecksReport';

/**
 * Step 7. The film is watchable here before anything is downloaded, the music
 * bed has its own audio preview, and the download always points at the best
 * master available (music mix first, otherwise the assembled cut).
 */
export default function AssemblyProgress({ busy, note, failure, project, checks, musicBusy, musicNote, onRetry, onContinue, onGenerateMusic, onMixMusic }: {
  busy: boolean;
  note: string;
  /** Why the last assembly attempt produced no film. Empty when it worked. */
  failure?: string;
  project: Project | null;
  checks: CheckResult[];
  musicBusy?: boolean;
  musicNote?: string;
  onRetry: () => void;
  onContinue: () => void;
  onGenerateMusic: (prompt: string) => void;
  onMixMusic: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const allPass = checks.length === 6 && checks.every((check) => check.pass);
  const assembled = project?.assembled_video_url;
  const final = project?.final_video_url;
  const playable = final || assembled;
  const portrait = project?.aspect_ratio === '9:16';

  return <div className="mx-auto max-w-5xl px-6 py-10">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Step 7 · Assembly, music and checks</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--space-text-primary)]">One continuous film</h1>
    <p className="mt-2 text-[var(--space-text-secondary)]">Supporting scenes replace the avatar picture. The original avatar audio remains the uninterrupted master track.</p>

    {busy ? <div className="mt-8 flex items-center gap-3 rounded-2xl bg-[var(--space-surface-panel)] p-5 text-[var(--space-text-primary)]"><Loader2 className="h-5 w-5 animate-spin text-[var(--space-text-brand)]" />{note || project?.stage_note || 'Working…'}</div> : null}

    {/* An assembly that produced no film says so here, with the reason and the
        one button that starts it again. The checks panel below is about a
        finished film, so it must not be read as the explanation. */}
    {!busy && failure && !playable ? <div className="mt-8 rounded-2xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-5">
      <div className="flex items-center gap-2 font-semibold text-[var(--space-text-primary)]"><AlertTriangle className="h-5 w-5 text-[var(--space-semantic-danger)]" />Assembly did not finish</div>
      <p className="mt-2 text-sm text-[var(--space-text-secondary)]">{failure}</p>
      <p className="mt-2 text-sm text-[var(--space-text-secondary)]">Every scene picture and its code are kept, so retrying only redoes the join.</p>
      <button onClick={onRetry} className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />Retry assembly</button>
    </div> : null}

    <div className="mt-7 grid gap-6 lg:grid-cols-2">
      <div>
        {playable
          ? <video key={playable} src={playable} controls playsInline className="max-h-[560px] w-full rounded-2xl bg-black" />
          : <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-[var(--space-border-default)] text-sm text-[var(--space-text-muted)]">
            {busy ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Rendering the assembly…</span> : 'The finished film plays here once assembly completes.'}
          </div>}
        {playable ? <p className="mt-2 text-xs text-[var(--space-text-muted)]">{final ? 'Playing the final master with its music bed.' : 'Playing the assembled cut. Add a music bed below to produce the final master.'}</p> : null}
      </div>
      <ChecksReport checks={checks} busy={busy} assembled={Boolean(playable)} onRetry={onRetry} />
    </div>

    {assembled ? <section className="mt-7 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="flex items-center gap-2"><Music className="h-4 w-4 text-[var(--space-text-brand)]" /><h2 className="font-semibold text-[var(--space-text-primary)]">Music and sound bed</h2></div>
      <p className="mt-1 text-sm text-[var(--space-text-secondary)]">ElevenLabs writes an instrumental bed for this film. Preview it here, then mix it underneath the picture.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="describe the bed — e.g. warm piano that builds, 90 BPM" className="min-w-64 flex-1 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3 text-sm text-[var(--space-text-primary)]" />
        <button disabled={musicBusy} onClick={() => onGenerateMusic(prompt.trim())} className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{musicBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{project?.music_url ? 'Regenerate music' : 'Generate music'}</button>
      </div>
      {project?.music_url ? <div className="mt-4">
        <audio src={project.music_url} controls className="w-full" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button disabled={musicBusy || portrait} onClick={onMixMusic} className="rounded-xl border border-[var(--space-border-default)] px-4 py-2.5 text-sm font-semibold text-[var(--space-text-primary)] disabled:opacity-40">{final ? 'Re-mix music into the film' : 'Mix music into the film'}</button>
          {portrait ? <span className="text-xs text-[var(--space-text-muted)]">The portrait renderer cannot mix a new track without reshaping the film, so the 9:16 master keeps its avatar audio and this bed stays a separate track you can download.</span> : null}
        </div>
      </div> : null}
      {musicNote ? <p className="mt-3 text-sm text-[var(--space-text-secondary)]">{musicNote}</p> : null}
    </section> : null}

    <div className="mt-7 flex flex-wrap gap-3">
      {playable ? <a href={playable} download target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-3 font-semibold text-white"><Download className="h-4 w-4" />Download {final ? 'final MP4 with music' : 'MP4'}</a> : null}
      {project?.music_url && !final ? <a href={project.music_url} download target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-5 py-3 font-semibold text-[var(--space-text-primary)]"><Music className="h-4 w-4" />Download music track</a> : null}
      {allPass ? <button onClick={onContinue} className="rounded-xl border border-[var(--space-border-default)] px-5 py-3 font-semibold text-[var(--space-text-primary)]">Open in Editor</button> : null}
    </div>
  </div>;
}
