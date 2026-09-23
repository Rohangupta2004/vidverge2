import { useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Clapperboard, Eye, GitBranch, Image as ImageIcon, Loader2, RefreshCw, ShieldAlert, ShieldCheck, SkipForward, Type, Undo2, X } from 'lucide-react';
import type { Project, Scene } from '../lib/supabase';
import { isVideoUrl, sceneKind, sceneSettled } from '../lib/sceneState';
import { hasFreshMotionClip } from '../lib/motionCapture';
import { KIND_COLORS, KIND_LABELS } from '../lib/effects';
import RemotionCodePreview from './RemotionCodePreview';

// Live pipeline board. Every card reflects its OWN scene the moment that
// scene's clip or still lands, so nothing waits for the slowest scene. A
// failed scene is one click from recovery — retry, switch to Text/Graphics,
// or skip — and never blocks the rest of the film.
function phaseOf(project: Project | null, settled: number, total: number) {
  if (!project) return 'Preparing';
  if (project.status === 'asset_gen' || project.status === 'coding') return settled === total && total > 0 ? 'Every scene is settled — ready to assemble' : `Producing supporting scenes · ${settled} of ${total} settled`;
  if (project.status === 'assembling') return 'Assembling the final film';
  if (settled === total && total > 0) return 'Every scene is settled — ready to assemble';
  return 'Waiting to start';
}

function sceneLabel(scene: Scene) {
  const kind = sceneKind(scene);
  const motionKind = kind === 'motion_graphic' || kind === 'text_overlay';
  if (scene.status === 'skipped') return 'skipped — the presenter plays through this window';
  if (scene.status === 'error') {
    if (kind === 'ai_video') return 'video failed — retry, switch type, or skip';
    if (motionKind) return 'capture failed — retry, switch type, or skip';
    return 'asset failed — retry or skip';
  }
  if (scene.status === 'generating') {
    if (kind === 'ai_video') return 'generating AI video…';
    if (motionKind) return 'recording the motion graphic in this browser…';
    return 'drawing the still…';
  }
  if (kind === 'ai_video') return isVideoUrl(scene.render_url) ? 'AI clip ready — placed straight on the timeline' : 'waiting to generate the clip';
  if (kind === 'text_overlay' && scene.overlay_config?.overAvatar === true) return 'presenter callout — composed at final assembly, nothing to capture';
  if (motionKind) return hasFreshMotionClip(scene) ? 'motion clip captured — exact text, ready to composite' : 'waiting to capture the animation (runs in this browser)';
  if (kind === 'image') return scene.render_url || scene.overlay_config?.assetUrl ? 'still ready' : 'waiting to draw the still';
  if (kind === 'legacy') return scene.render_url ? 'coded scene ready (legacy)' : 'waiting';
  return scene.render_url || scene.overlay_config?.assetUrl ? 'text + graphic ready — composed at final assembly' : 'text overlay ready — nothing to pre-render';
}

// Visual QA verdict chip — the qa_report the directed pipeline stored after
// Opus vision inspected the rendered frames. 'flagged' means the auto-fix
// retries were exhausted: the scene ships its best render and says why here.
function QaBadge({ scene }: { scene: Scene }) {
  const qa = scene.qa_report as { status?: string; summary?: string; issues?: { detail?: string }[] } | null | undefined;
  if (!qa || !qa.status || qa.status === 'skipped') return null;
  const passed = qa.status === 'pass';
  const detail = [qa.summary, ...(qa.issues || []).map((issue) => issue?.detail)].filter(Boolean).join(' · ');
  return <span title={detail} className={passed
    ? 'mt-1 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--space-semantic-success-500)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--space-semantic-success)]'
    : 'mt-1 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--space-semantic-warning-500)_14%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--space-semantic-warning)]'}>
    {passed ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}{passed ? 'Visual QA passed' : 'Visual QA: needs review'}
  </span>;
}

function kindBadge(scene: Scene) {
  const kind = sceneKind(scene);
  if (kind === 'legacy') return { icon: Eye, label: 'Legacy', color: '#94A3B8' };
  const icon = kind === 'ai_video' ? Clapperboard : kind === 'motion_graphic' ? GitBranch : kind === 'image' ? ImageIcon : Type;
  return { icon, label: KIND_LABELS[kind], color: KIND_COLORS[kind] };
}

export default function AssetProgress({ scenes, busy, note, project, onAssemble, onRetryScene, onConvertScene, onSkipScene, onUnskipScene, onCancel, onResume }: {
  scenes: Scene[];
  busy: boolean;
  note?: string;
  project: Project | null;
  onAssemble: () => void;
  onRetryScene?: (scene: Scene) => void;
  onConvertScene?: (scene: Scene) => void;
  onSkipScene?: (scene: Scene) => void;
  onUnskipScene?: (scene: Scene) => void;
  /** Stop pulling new scenes; clips in flight finish and are kept. Never navigates or resets. */
  onCancel?: () => void;
  onResume?: () => void;
}) {
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [videoSceneId, setVideoSceneId] = useState<string | null>(null);
  const previewScene = scenes.find((scene) => scene.id === previewSceneId) || null;
  const videoScene = scenes.find((scene) => scene.id === videoSceneId) || null;
  const total = scenes.length;
  const settled = scenes.filter(sceneSettled).length;
  const failed = scenes.filter((scene) => scene.status === 'error');
  const allReady = total > 0 && settled === total;
  const percent = total ? Math.round(settled / total * 100) : 0;

  return <div className="mx-auto max-w-4xl px-6 py-10">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Step 6 · Middle visuals</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--space-text-primary)]">Each scene is produced its own way</h1>
    <p className="mt-2 text-sm leading-relaxed text-[var(--space-text-secondary)]">AI Video scenes generate real clips in parallel; Motion Graphic and Text Overlay scenes are recorded right here in your browser by the GSAP engine (exact text, never hallucinated); Image scenes draw one still. Every clip is cached — re-assembly never regenerates a scene.</p>

    <div className="mt-6 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="flex flex-wrap items-center gap-3">
        {allReady ? <CheckCircle2 className="h-5 w-5 text-[var(--space-semantic-success)]" /> : <Loader2 className="h-5 w-5 animate-spin text-[var(--space-text-brand)]" />}
        <span className="font-semibold text-[var(--space-text-primary)]">{phaseOf(project, settled, total)}</span>
        <span className="ml-auto font-mono text-sm text-[var(--space-text-secondary)]">Scenes settled: {settled} / {total}</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--space-surface-muted)]"><div className="h-full bg-[var(--space-brand-primary-500)] transition-all duration-500" style={{ width: `${percent}%` }} /></div>
      {note ? <p className="mt-3 text-sm text-[var(--space-text-secondary)]">{note}</p> : null}
      {project?.stage_note && project.stage_note !== note ? <p className="mt-1 text-xs text-[var(--space-text-muted)]">{project.stage_note}</p> : null}
    </div>

    {project?.heygen_video_url ? <div className="mt-5 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4">
      <p className="mb-3 text-sm font-semibold text-[var(--space-text-primary)]">Avatar master · the primary video every scene plays over</p>
      <video src={project.heygen_video_url} controls className={project.aspect_ratio === '9:16' ? 'max-h-80 rounded-xl bg-black' : 'w-full max-w-xl rounded-xl bg-black'} />
    </div> : <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4">
      <span className="h-12 w-20 animate-pulse rounded-lg bg-[var(--space-surface-muted)]" />
      <span className="text-sm text-[var(--space-text-secondary)]">Avatar video rendering…</span>
    </div>}

    <div className="mt-5 space-y-3">{scenes.map((scene) => {
      const done = sceneSettled(scene) && scene.status !== 'skipped';
      const working = scene.status === 'generating';
      const broken = scene.status === 'error';
      const skipped = scene.status === 'skipped';
      const kind = sceneKind(scene);
      const badge = kindBadge(scene);
      const hasVideo = isVideoUrl(scene.render_url);
      const thumb = hasVideo ? '' : scene.render_url || scene.overlay_config?.assetUrl || '';
      const legacyPreviewable = kind === 'legacy' && Boolean(scene.remotion_code?.trim());
      return <div key={scene.id} className={skipped ? 'flex items-center gap-4 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 opacity-55' : 'flex items-center gap-4 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 transition-colors hover:border-[var(--space-border-strong)]'}>
        {/* 80x60 inline preview, shown the instant THIS scene's media lands. */}
        <span className="flex h-[60px] w-[80px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--space-surface-muted)]">
          {hasVideo
            ? <video src={scene.render_url} muted playsInline className="h-full w-full object-cover" />
            : thumb
              ? <img src={thumb} alt={`Scene ${scene.scene_index} preview`} width={80} height={60} className="h-full w-full object-cover" />
              : broken ? <AlertCircle className="h-5 w-5 text-[var(--space-semantic-danger)]" />
                : working ? <Loader2 className="h-5 w-5 animate-spin text-[var(--space-text-brand)]" />
                  : kind === 'text_graphics' ? <Type className="h-5 w-5 text-[var(--space-text-muted)]" /> : <ImageIcon className="h-5 w-5 text-[var(--space-text-muted)]" />}
        </span>
        {done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--space-semantic-success)]" /> : working ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--space-text-brand)]" /> : broken ? <AlertCircle className="h-5 w-5 shrink-0 text-[var(--space-semantic-danger)]" /> : <Circle className="h-5 w-5 shrink-0 text-[var(--space-text-muted)]" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-semibold text-[var(--space-text-primary)]">Scene {scene.scene_index}<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: badge.color, background: `color-mix(in srgb, ${badge.color} 14%, transparent)` }}><badge.icon className="h-3 w-3" />{badge.label}</span></div>
          <p className="truncate text-sm text-[var(--space-text-secondary)]">{scene.description}</p>
          <p className={broken ? 'mt-1 text-xs text-[var(--space-semantic-danger)]' : 'mt-1 text-xs text-[var(--space-text-muted)]'}>{sceneLabel(scene)}</p>
          <QaBadge scene={scene} />
        </div>
        {hasVideo && !skipped ? <button onClick={() => setVideoSceneId(scene.id)} className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_10%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--space-text-brand)] transition hover:bg-[color-mix(in_srgb,var(--space-brand-primary-500)_18%,transparent)]"><Eye className="h-3.5 w-3.5" />Preview</button> : null}
        {legacyPreviewable && !skipped ? <button onClick={() => setPreviewSceneId(scene.id)} className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_10%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--space-text-brand)] transition hover:bg-[color-mix(in_srgb,var(--space-brand-primary-500)_18%,transparent)]"><Eye className="h-3.5 w-3.5" />Preview</button> : null}
        {broken && onRetryScene ? <button onClick={() => onRetryScene(scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)]"><RefreshCw className="h-3.5 w-3.5" />Retry</button> : null}
        {broken && kind !== 'text_overlay' && onConvertScene ? <button title="Replace this scene with a deterministic animated text overlay" onClick={() => onConvertScene(scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)]"><Type className="h-3.5 w-3.5" />Use Text Overlay</button> : null}
        {broken && onSkipScene ? <button title="Take this scene out of the film — the avatar plays through its window" onClick={() => onSkipScene(scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-muted)] transition-colors hover:border-[var(--space-border-strong)]"><SkipForward className="h-3.5 w-3.5" />Skip</button> : null}
        {skipped && onUnskipScene ? <button onClick={() => onUnskipScene(scene)} className="flex items-center gap-1 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)]"><Undo2 className="h-3.5 w-3.5" />Restore</button> : null}
      </div>;
    })}</div>

    {previewScene ? <RemotionCodePreview scene={previewScene} project={project} onClose={() => setPreviewSceneId(null)} /> : null}
    {videoScene ? <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-label={`Scene ${videoScene.scene_index} video preview`} onClick={() => setVideoSceneId(null)}>
      <div className="relative w-full max-w-3xl rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><p className="font-semibold text-[var(--space-text-primary)]">Scene {videoScene.scene_index} · AI clip</p><button aria-label="Close preview" onClick={() => setVideoSceneId(null)} className="rounded-lg p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--space-text-primary)_7%,transparent)]"><X className="h-5 w-5 text-[var(--space-text-primary)]" /></button></div>
        <video src={videoScene.render_url} controls autoPlay muted className="max-h-[70vh] w-full rounded-xl bg-black object-contain" />
      </div>
    </div> : null}

    {failed.length ? <p className="mt-4 text-sm text-[var(--space-semantic-danger)]">{failed.length} scene{failed.length === 1 ? '' : 's'} failed — each one can be retried, switched to Text/Graphics, or skipped. The rest of the film is unaffected.</p> : null}

    <div className="mt-6 flex flex-wrap gap-3">
      {/* The final-assembly call to action must be impossible to miss the
          moment every scene settles — hence the pulse and ring when ready. */}
      <button disabled={!allReady || busy} onClick={onAssemble} className={`rounded-xl bg-[var(--space-brand-primary-600)] px-6 py-3.5 text-base font-bold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--space-brand-primary-600)_40%,transparent)] transition-all hover:-translate-y-0.5 hover:bg-[var(--space-brand-primary-700)] hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--space-brand-primary-600)_50%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--space-brand-primary-500)] disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0${allReady && !busy ? ' animate-pulse ring-2 ring-[color-mix(in_srgb,var(--space-brand-primary-500)_60%,transparent)] ring-offset-2 ring-offset-[var(--space-surface-bg)]' : ''}`}>
        {busy ? 'Working…' : allReady ? 'Start final assembly' : `Start final assembly · ${settled} of ${total} scenes settled`}
      </button>
      {busy && !allReady && onCancel ? <button onClick={onCancel} className="rounded-xl border border-[var(--space-border-default)] px-5 py-3 font-semibold text-[var(--space-text-muted)] transition-colors hover:border-[var(--space-border-strong)] hover:text-[var(--space-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)]">Cancel generation</button> : null}
      {/* Picks a half-finished run back up: scenes that already have their
          media are skipped, so this costs only what is missing. */}
      {!allReady && onResume ? <button disabled={busy} onClick={onResume} className="rounded-xl border border-[var(--space-border-default)] px-5 py-3 font-semibold text-[var(--space-text-primary)] transition-colors hover:border-[var(--space-border-strong)] hover:bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--space-brand-primary-500)] disabled:opacity-40">Generate the remaining scenes</button> : null}
    </div>
  </div>;
}
