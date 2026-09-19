import { useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Code2, Eye, Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import type { Project, Scene } from '../lib/supabase';
import RemotionCodePreview from './RemotionCodePreview';

// Live pipeline board. Every card reflects its OWN scene the moment that
// scene's picture or code lands, so nothing waits for the slowest scene.
function phaseOf(project: Project | null, imagesReady: number, codeReady: number, total: number) {
  if (!project) return 'Preparing';
  if (project.status === 'asset_gen') return `Generating scene images · ${imagesReady} of ${total}`;
  if (project.status === 'coding') return `Writing scene motion code · ${codeReady} of ${total}`;
  if (project.status === 'assembling') return 'Assembling the final film';
  if (imagesReady === total && codeReady === total && total > 0) return 'Every scene is ready to assemble';
  return 'Waiting to start';
}

function codeIsReady(scene: Scene) {
  return Boolean(scene.remotion_code?.trim()) && (scene.coding_status === 'ready' || scene.coding_status === 'done');
}

function sceneLabel(scene: Scene) {
  if (scene.status === 'error') return 'image failed';
  if (scene.coding_status === 'error') return 'code failed — retry it below';
  if (codeIsReady(scene)) return 'code ready · preview available';
  if (scene.coding_status === 'coding') return 'generating code…';
  if (scene.render_url) return 'image ready';
  if (scene.status === 'generating') return 'generating image…';
  return 'waiting';
}

export default function AssetProgress({ scenes, busy, note, project, onAssemble, onRetryScene, onResume }: {
  scenes: Scene[];
  busy: boolean;
  note?: string;
  project: Project | null;
  onAssemble: () => void;
  onRetryScene?: (scene: Scene) => void;
  onResume?: () => void;
}) {
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const previewScene = scenes.find((scene) => scene.id === previewSceneId) || null;
  const total = scenes.length;
  const imagesReady = scenes.filter((scene) => Boolean(scene.render_url)).length;
  const codeReady = scenes.filter(codeIsReady).length;
  const failed = scenes.filter((scene) => scene.status === 'error');
  const codeFailed = scenes.filter((scene) => scene.coding_status === 'error');
  const allReady = total > 0 && imagesReady === total && codeReady === total;
  const percent = total ? Math.round((imagesReady + codeReady) / (total * 2) * 100) : 0;

  return <div className="mx-auto max-w-4xl px-6 py-10">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Step 6 · Assets and code</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--space-text-primary)]">Every scene is its own little production</h1>

    <div className="mt-6 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="flex flex-wrap items-center gap-3">
        {allReady ? <CheckCircle2 className="h-5 w-5 text-[var(--space-semantic-success)]" /> : <Loader2 className="h-5 w-5 animate-spin text-[var(--space-text-brand)]" />}
        <span className="font-semibold text-[var(--space-text-primary)]">{phaseOf(project, imagesReady, codeReady, total)}</span>
        <span className="ml-auto font-mono text-sm text-[var(--space-text-secondary)]">Images: {imagesReady} / {total} ready · Code: {codeReady} / {total} ready</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--space-surface-muted)]"><div className="h-full bg-[var(--space-brand-primary-500)] transition-all duration-500" style={{ width: `${percent}%` }} /></div>
      {note ? <p className="mt-3 text-sm text-[var(--space-text-secondary)]">{note}</p> : null}
      {project?.stage_note && project.stage_note !== note ? <p className="mt-1 text-xs text-[var(--space-text-muted)]">{project.stage_note}</p> : null}
    </div>

    {project?.heygen_video_url ? <div className="mt-5 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4">
      <p className="mb-3 text-sm font-semibold text-[var(--space-text-primary)]">Avatar master · the audio every scene plays over</p>
      <video src={project.heygen_video_url} controls className={project.aspect_ratio === '9:16' ? 'max-h-80 rounded-xl bg-black' : 'w-full max-w-xl rounded-xl bg-black'} />
    </div> : <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4">
      <span className="h-12 w-20 animate-pulse rounded-lg bg-[var(--space-surface-muted)]" />
      <span className="text-sm text-[var(--space-text-secondary)]">Avatar video rendering…</span>
    </div>}

    <div className="mt-5 space-y-3">{scenes.map((scene) => {
      const previewable = codeIsReady(scene);
      const done = Boolean(scene.render_url) && previewable;
      const working = scene.status === 'generating' || scene.coding_status === 'coding';
      const broken = scene.status === 'error';
      // A scene whose picture is fine but whose code failed keeps its preview
      // and its image Retry stays hidden: the fix is another coding pass, not
      // another image.
      const labelBroken = broken || scene.coding_status === 'error';
      return <div key={scene.id} className="flex items-center gap-4 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 transition-colors hover:border-[var(--space-border-strong)]">
        {/* 80x60 inline preview, shown the instant THIS scene's image lands. */}
        <span className="flex h-[60px] w-[80px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--space-surface-muted)]">
          {scene.render_url
            ? <img src={scene.render_url} alt={`Scene ${scene.scene_index} preview`} width={80} height={60} className="h-full w-full object-cover" />
            : broken ? <AlertCircle className="h-5 w-5 text-[var(--space-semantic-danger)]" />
              : working ? <Loader2 className="h-5 w-5 animate-spin text-[var(--space-text-brand)]" />
                : <ImageIcon className="h-5 w-5 text-[var(--space-text-muted)]" />}
        </span>
        {done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--space-semantic-success)]" /> : working ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--space-text-brand)]" /> : <Circle className="h-5 w-5 shrink-0 text-[var(--space-text-muted)]" />}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[var(--space-text-primary)]">Scene {scene.scene_index} · {scene.scene_type}</div>
          <p className="truncate text-sm text-[var(--space-text-secondary)]">{scene.description}</p>
          <p className={labelBroken ? 'mt-1 text-xs text-[var(--space-semantic-danger)]' : 'mt-1 text-xs text-[var(--space-text-muted)]'}>{sceneLabel(scene)}</p>
        </div>
        <span className="hidden items-center gap-1 text-xs text-[var(--space-text-muted)] sm:flex"><ImageIcon className="h-3.5 w-3.5" />{scene.status}</span>
        <span className="hidden items-center gap-1 text-xs text-[var(--space-text-muted)] sm:flex"><Code2 className="h-3.5 w-3.5" />{scene.coding_status || 'pending'}</span>
        {previewable ? <button onClick={() => setPreviewSceneId(scene.id)} className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_10%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--space-text-brand)] transition hover:bg-[color-mix(in_srgb,var(--space-brand-primary-500)_18%,transparent)]"><Eye className="h-3.5 w-3.5" />Preview</button> : null}
        {broken && onRetryScene ? <button onClick={() => onRetryScene(scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)]"><RefreshCw className="h-3.5 w-3.5" />Retry</button> : null}
      </div>;
    })}</div>

    {previewScene ? <RemotionCodePreview scene={previewScene} project={project} onClose={() => setPreviewSceneId(null)} /> : null}

    {failed.length ? <p className="mt-4 text-sm text-[var(--space-semantic-danger)]">{failed.length} scene{failed.length === 1 ? '' : 's'} could not draw an image. Retry {failed.length === 1 ? 'it' : 'them'} — assembly stays locked until every scene has a picture and its code.</p> : null}
    {codeFailed.length ? <p className="mt-2 text-sm text-[var(--space-semantic-danger)]">{codeFailed.length} scene{codeFailed.length === 1 ? '' : 's'} could not write motion code. “Generate the remaining scenes” retries only those — the pictures and finished scenes are kept.</p> : null}

    <div className="mt-6 flex flex-wrap gap-3">
      <button disabled={!allReady || busy} onClick={onAssemble} className="rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-3 font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:-translate-y-0.5 hover:bg-[var(--space-brand-primary-700)] hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--space-brand-primary-600)_50%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--space-brand-primary-500)] disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0">
        {busy ? 'Working…' : allReady ? 'Assemble video' : `Assemble video · ${Math.min(imagesReady, codeReady)} of ${total} scenes ready`}
      </button>
      {/* Picks a half-finished run back up: scenes that already have a picture
          and their code are skipped, so this costs only what is missing. */}
      {!allReady && onResume ? <button disabled={busy} onClick={onResume} className="rounded-xl border border-[var(--space-border-default)] px-5 py-3 font-semibold text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)] disabled:opacity-40">Generate the remaining scenes</button> : null}
    </div>
  </div>;
}
