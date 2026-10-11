// Compose and generate: the brief goes in, a finished film comes out.
//
// This file is the form. The order of operations behind the Generate button —
// submit, optional storyboard pause, durable job row, webhook-watched
// tracking — lives in lib/useCompose, which is where that story is worth
// reading.
import { useState } from 'react';
import { Download, FileUp, Layers, Monitor, Play, Smartphone, Trash2, X } from 'lucide-react';
import { cacheAsset, describeError, type CachedAsset } from '../../lib/heygenApi';
import { AGENT_AUDIO_UNSUPPORTED_NOTE, videoAgentAudioRuledOut } from '../../lib/heygenAgent';
import { voicePipeline } from '../../lib/voicePipeline';
import { setOrientation, setToggles, useHeyGenSession } from '../../lib/heygenSession';
import { useCompose, type Generated } from '../../lib/useCompose';
import { Button, CapabilityNote, Field, Notice, Panel, Progress, Segmented, Toggle, fieldClassFor } from './ui';
import StoryboardReview from './StoryboardReview';

export type { Generated };

interface SceneDraft { key: string; prompt: string }

function newScene(): SceneDraft {
  return { key: Math.random().toString(36).slice(2, 9), prompt: '' };
}

export default function ComposePanel({ step, onGenerated }: { step: number; onGenerated: (result: Generated) => void }) {
  const session = useHeyGenSession();
  const compose = useCompose(onGenerated);
  const [brief, setBrief] = useState('');
  const [scenes, setScenes] = useState<SceneDraft[]>([]);
  const [files, setFiles] = useState<CachedAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function addFiles(list: FileList) {
    setUploadError('');
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        // cacheAsset is content-addressed, so re-picking a file the customer
        // already attached costs one hash and no upload.
        const asset = await cacheAsset(file, 'sceneforge-heygen-inputs');
        setFiles((current) => current.some((entry) => entry.url === asset.url) ? current : [...current, asset]);
      }
    } catch (e) {
      setUploadError(describeError(e));
    } finally {
      setUploading(false);
    }
  }

  const ready = Boolean(session.avatarId) && Boolean(brief.trim() || scenes.some((scene) => scene.prompt.trim()));
  const portrait = session.orientation === 'portrait';
  const { busy, phase } = compose;
  const elevenLabsStoryboard = voicePipeline() === 'elevenlabs_heygen';
  // The Video Agent on this account will not lip-sync to a ready-made track, so
  // a voiced film is assembled scene by scene instead. Said out loud, because a
  // silent fallback here would look like the suite being slow for no reason.
  const voicedSceneBySceneOnly = elevenLabsStoryboard && videoAgentAudioRuledOut();

  return <Panel
    step={step}
    done={phase === 'done'}
    title="Write the brief"
    hint="Say what the video should cover. HeyGen plans the scenes, writes the script and renders them with your locked character."
  >
    <CapabilityNote capability="video-agents" label="The HeyGen Video Agent">
      Your HeyGen plan does not expose the prompt-driven Video Agent. The Avatar Studio&rsquo;s script-and-render path still
      works &mdash; switch to Quick render in the header.
    </CapabilityNote>

    {voicedSceneBySceneOnly ? <Notice tone="info" title="Your film is rendered scene by scene">
      {AGENT_AUDIO_UNSUPPORTED_NOTE}
    </Notice> : null}

    <div className="space-y-4">
      <Field label="Your brief" hint="For example: a 45-second explainer for founders on why scene consistency matters, ending on a free-trial CTA.">
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          rows={4}
          disabled={busy}
          placeholder="A 45-second explainer for founders on why scene consistency matters, ending on a free-trial CTA"
          className="st-textarea"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Orientation" hint={portrait ? 'Portrait fills a phone — Reels, Shorts, TikTok.' : 'Landscape suits YouTube and your website.'}>
          <Segmented
            value={session.orientation}
            onChange={setOrientation}
            options={[{ value: 'portrait', label: 'Portrait', icon: Smartphone }, { value: 'landscape', label: 'Landscape', icon: Monitor }]}
          />
        </Field>
        <Field label="Product images or screenshots" hint="Uploaded once and reused — attaching the same file twice costs nothing." error={uploadError}>
          <input
            type="file"
            multiple
            accept="image/*,application/pdf"
            disabled={busy || uploading}
            aria-invalid={uploadError ? true : undefined}
            onChange={(event) => {
              const list = event.target.files;
              event.target.value = '';
              if (list?.length) void addFiles(list);
            }}
            className={`${fieldClassFor('st-field', Boolean(uploadError))} file:mr-3 file:rounded-lg file:border-0 file:bg-[color-mix(in_srgb,#C8920A_22%,transparent)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#1A1000]`}
          />
        </Field>
      </div>

      {files.length ? <div className="flex flex-wrap gap-2">
        {files.map((asset) => <span key={asset.url} className="inline-flex items-center gap-2 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-1.5 text-xs text-[var(--space-text-secondary)]">
          <FileUp className="h-3.5 w-3.5" />
          <span className="max-w-[160px] truncate">{asset.name}</span>
          <button type="button" aria-label={`Remove ${asset.name}`} onClick={() => setFiles((current) => current.filter((entry) => entry.url !== asset.url))}>
            <X className="h-3.5 w-3.5 text-[var(--space-text-muted)] hover:text-[var(--space-text-primary)]" />
          </button>
        </span>)}
      </div> : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <Toggle
          checked={session.storyboardReview || elevenLabsStoryboard}
          onChange={(value) => setToggles({ storyboardReview: value })}
          disabled={busy || elevenLabsStoryboard}
          label="Review storyboard first"
          hint={elevenLabsStoryboard
            ? 'Required for ElevenLabs: SceneForge needs each scene line before it can make the lip-sync tracks.'
            : 'See and edit the scene plan before any render credit is spent.'}
        />
        <Toggle
          checked={session.transparentBackground}
          onChange={(value) => setToggles({ transparentBackground: value })}
          disabled={busy}
          label="Transparent background"
          hint="Character only, with an alpha channel, for overlaying on your own footage."
        />
        <Toggle
          checked={session.cinematicMode}
          onChange={(value) => setToggles({ cinematicMode: value })}
          disabled={busy}
          label="Cinematic mode"
          hint="Film-style framing instead of a standard talking-head crop."
        />
      </div>

      {scenes.length ? <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">
          Scenes &mdash; submitted together as one batch
        </p>
        {scenes.map((scene, index) => <div key={scene.key} className="flex items-start gap-2">
          <span className="mt-2.5 w-14 shrink-0 text-xs font-medium text-[var(--space-text-muted)]">Scene {index + 1}</span>
          <textarea
            value={scene.prompt}
            onChange={(event) => setScenes((current) => current.map((entry) => entry.key === scene.key ? { ...entry, prompt: event.target.value } : entry))}
            rows={2}
            disabled={busy}
            placeholder="What the viewer sees and hears in this scene"
            className="st-textarea"
          />
          <button
            type="button"
            aria-label={`Remove scene ${index + 1}`}
            disabled={busy}
            onClick={() => setScenes((current) => current.filter((entry) => entry.key !== scene.key))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--space-border-default)] text-[var(--space-text-muted)] hover:border-[var(--space-border-strong)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>)}
      </div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void compose.generate({ brief, scenePrompts: scenes.map((scene) => scene.prompt), files })}
          busy={busy}
          disabled={!ready}
        >
          <Play className="h-4 w-4" />
          {session.storyboardReview || elevenLabsStoryboard ? 'Plan the storyboard' : 'Generate video'}
        </Button>
        <Button tone="ghost" onClick={() => setScenes((current) => [...current, newScene()])} disabled={busy}>
          <Layers className="h-3.5 w-3.5" />Add a scene
        </Button>
        {phase === 'done' ? <Button tone="ghost" onClick={compose.reset}>Start another</Button> : null}
      </div>

      {!session.avatarId ? <Notice tone="info" title="Lock a presenter first">
        Pick or build a character above &mdash; that is what keeps every scene looking like the same person.
      </Notice> : null}

      {Object.keys(compose.batchState).length ? <div className="flex flex-wrap gap-2">
        {Object.entries(compose.batchState).map(([label, state]) => <span
          key={label}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${state === 'done'
            ? 'bg-[color-mix(in_srgb,var(--space-semantic-success-500)_16%,transparent)] text-[var(--space-text-primary)]'
            : state
              ? 'bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_16%,transparent)] text-[var(--space-text-primary)]'
              : 'bg-[var(--space-surface-panel)] text-[var(--space-text-muted)]'}`}
          title={state && state !== 'done' ? String(state) : undefined}
        >
          {label} {state === 'done' ? '\u2713' : state ? '\u2715' : '\u23f3'}
        </span>)}
      </div> : null}

      {busy ? <Progress
        elapsedSec={compose.elapsed}
        expectedSec={phase === 'submitting' ? 20 : 260}
        label={phase === 'submitting' ? 'Sending your brief to HeyGen' : 'Rendering your video'}
      /> : null}

      {phase === 'storyboard' && !compose.storyboard.length
        ? <Progress elapsedSec={compose.elapsed} expectedSec={40} label="HeyGen is planning your scenes" />
        : null}

      {compose.error ? <Notice tone="error" title="That did not go through">{compose.error}</Notice> : null}

      {compose.note && !compose.error ? <Notice tone="info" title="How this film was made">{compose.note}</Notice> : null}

      {compose.storyboard.length ? <StoryboardReview
        scenes={compose.storyboard}
        busy={phase === 'rendering'}
        onChange={compose.setStoryboard}
        onApprove={compose.approve}
      /> : null}

      {compose.videoUrl ? <div className="space-y-3">
        <video
          src={compose.videoUrl}
          controls
          playsInline
          className={`w-full rounded-xl border border-[var(--space-border-default)] bg-black ${portrait ? 'mx-auto max-w-[320px]' : ''}`}
          style={session.transparentBackground ? {
            // A checkerboard behind an alpha render is the only way the
            // customer can see that the background really is transparent.
            backgroundImage: 'linear-gradient(45deg,#EDE3CC 25%,transparent 25%,transparent 75%,#EDE3CC 75%),linear-gradient(45deg,#EDE3CC 25%,transparent 25%,transparent 75%,#EDE3CC 75%)',
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0,10px 10px',
          } : undefined}
        />
        <a
          href={compose.videoUrl}
          download
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundImage: 'linear-gradient(135deg,#E8B737,#C8920A)' }}
        >
          <Download className="h-4 w-4" />Download MP4
        </a>
      </div> : null}
    </div>
  </Panel>;
}
