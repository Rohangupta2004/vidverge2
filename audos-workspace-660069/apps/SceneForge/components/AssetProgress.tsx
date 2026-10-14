import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Clapperboard, Eye, GitBranch, Image as ImageIcon, RefreshCw, ShieldAlert, ShieldCheck, SkipForward, Type, Undo2, X } from 'lucide-react';
import type { Project, Scene } from '../lib/supabase';
import { isVideoUrl, sceneKind, sceneSettled } from '../lib/sceneState';
import { hasFreshMotionClip } from '../lib/motionCapture';
import { KIND_COLORS, KIND_LABELS } from '../lib/effects';
import RemotionCodePreview from './RemotionCodePreview';
import CompositionPreview from './CompositionPreview';
import VergeLoader from '../../../components/VergeLoader';

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

function formatStepElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function displayStatus(scene: Scene): 'pending' | 'running' | 'done' | 'failed' {
  if (scene.status === 'error') return 'failed';
  if (scene.status === 'generating') return 'running';
  if (sceneSettled(scene) || scene.status === 'skipped') return 'done';
  return 'pending';
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
  if (kind === 'legacy') return { icon: Eye, label: 'Legacy', color: '#9E8B55' };
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
  const [filmPreviewOpen, setFilmPreviewOpen] = useState(false);
  const previewScene = scenes.find((scene) => scene.id === previewSceneId) || null;
  const videoScene = scenes.find((scene) => scene.id === videoSceneId) || null;
  const total = scenes.length;
  const settled = scenes.filter(sceneSettled).length;
  const failed = scenes.filter((scene) => scene.status === 'error');
  const allReady = total > 0 && settled === total;
  const percent = total ? Math.round(settled / total * 100) : 0;
  const timings = useRef<Record<string, { status: ReturnType<typeof displayStatus>; startedAt?: number; elapsedMs?: number }>>({});
  const [nowMs, setNowMs] = useState(Date.now());
  const timingSignature = scenes.map((scene) => `${scene.id}:${displayStatus(scene)}`).join('|');
  useEffect(() => {
    const now = Date.now();
    const next = { ...timings.current };
    scenes.forEach((scene) => {
      const status = displayStatus(scene);
      const previous = next[scene.id];
      const rowAt = Date.parse(String((scene as Scene & { updated_at?: string }).updated_at || ''));
      if (status === 'running' && previous?.status !== 'running') {
        next[scene.id] = { status, startedAt: previous ? now : (Number.isFinite(rowAt) ? rowAt : now) };
      } else if (status !== 'running' && previous?.status === 'running' && previous.startedAt) {
        next[scene.id] = { status, elapsedMs: Math.max(0, now - previous.startedAt) };
      } else {
        next[scene.id] = { ...previous, status };
      }
    });
    timings.current = next;
    setNowMs(now);
  }, [timingSignature]);
  const hasRunning = scenes.some((scene) => displayStatus(scene) === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunning, timingSignature]);
  const elapsedFor = (scene: Scene) => {
    const status = displayStatus(scene);
    const timing = timings.current[scene.id];
    if (status === 'running' && timing?.startedAt) return formatStepElapsed(nowMs - timing.startedAt);
    if ((status === 'done' || status === 'failed') && timing?.elapsedMs !== undefined) return formatStepElapsed(timing.elapsedMs);
    return '—';
  };

  return <div className="sf-step-shell mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Step 6 · Middle visuals</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--space-text-primary)]">Each scene is produced its own way</h1>
    <p className="mt-2 text-sm leading-relaxed text-[var(--space-text-secondary)]">AI Video scenes generate real clips in parallel; Motion Graphic and Text Overlay scenes are recorded right here in your browser by the GSAP engine (exact text, never hallucinated); Image scenes draw one still. Every clip is cached — re-assembly never regenerates a scene.</p>

    <div className="mt-6 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="flex flex-wrap items-center gap-3">
        {allReady ? <CheckCircle2 className="h-5 w-5 text-[var(--space-semantic-success)]" /> : <VergeLoader size={64} label="Producing your scenes" />}
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
      <VergeLoader size={90} label="Rendering the avatar video" />
      <span className="text-sm text-[var(--space-text-secondary)]">Avatar video rendering…</span>
    </div>}

    {!total ? <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-6 py-10 text-center">
      <ImageIcon className="h-7 w-7 text-[var(--space-text-brand)]" />
      <p className="mt-3 font-semibold text-[var(--space-text-primary)]">No scenes are queued yet</p>
      <p className="mt-1 max-w-md text-sm text-[var(--space-text-muted)]">Return to the scene plan, add the moments you want, then generate the supporting visuals.</p>
      {onResume ? <button disabled={busy} onClick={onResume} className="mt-4 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Generate scenes</button> : null}
    </div> : null}

    <div className="mt-5 space-y-3">{scenes.map((scene, sceneIndex) => {
      const done = sceneSettled(scene) && scene.status !== 'skipped';
      const working = scene.status === 'generating';
      const broken = scene.status === 'error';
      const skipped = scene.status === 'skipped';
      const kind = sceneKind(scene);
      const badge = kindBadge(scene);
      const hasVideo = isVideoUrl(scene.render_url);
      const thumb = hasVideo ? '' : scene.render_url || scene.overlay_config?.assetUrl || '';
      const legacyPreviewable = kind === 'legacy' && Boolean(scene.remotion_code?.trim());
      return <div key={scene.id} className={skipped ? 'sf-card flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 opacity-55 sm:gap-4' : 'sf-card flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--space-border-strong)] hover:shadow-xl sm:gap-4'} style={{ animationDelay: `${Math.min(sceneIndex, 10) * 45}ms` }}>
        {/* 80x60 inline preview, shown the instant THIS scene's media lands. */}
        <span className="flex h-[60px] w-[80px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--space-surface-muted)]">
          {hasVideo
            ? <video src={scene.render_url} muted playsInline className="h-full w-full object-cover" />
            : thumb
              ? <img src={thumb} alt={`Scene ${scene.scene_index} preview`} width={80} height={60} className="h-full w-full object-cover" />
              : broken ? <AlertCircle className="h-5 w-5 text-[var(--space-semantic-danger)]" />
                : working ? <VergeLoader size={64} label={`Generating scene ${scene.scene_index}`} />
                  : kind === 'text_graphics' ? <Type className="h-5 w-5 text-[var(--space-text-muted)]" /> : <ImageIcon className="h-5 w-5 text-[var(--space-text-muted)]" />}
        </span>
        {done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--space-semantic-success)]" /> : working ? <VergeLoader size={40} style={{ flexShrink: 0 }} label={`Generating scene ${scene.scene_index}`} /> : broken ? <AlertCircle className="h-5 w-5 shrink-0 text-[var(--space-semantic-danger)]" /> : <Circle className="h-5 w-5 shrink-0 text-[var(--space-text-muted)]" />}
        <div className="min-w-[min(100%,240px)] flex-1">
          <div className="flex items-center gap-2 font-semibold text-[var(--space-text-primary)]">Scene {scene.scene_index}<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: badge.color, background: `color-mix(in srgb, ${badge.color} 14%, transparent)` }}><badge.icon className="h-3 w-3" />{badge.label}</span></div>
          <p className="truncate text-sm text-[var(--space-text-secondary)]">{scene.description}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className={broken ? 'text-[var(--space-semantic-danger)]' : 'text-[var(--space-text-muted)]'}>{sceneLabel(scene)}</span>
            <span className={working ? 'rounded-full bg-[color-mix(in_srgb,var(--space-brand-primary-500)_12%,transparent)] px-2 py-0.5 font-mono font-semibold uppercase tracking-wide text-[var(--space-text-brand)]' : broken ? 'rounded-full bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,transparent)] px-2 py-0.5 font-mono font-semibold uppercase tracking-wide text-[var(--space-semantic-danger)]' : 'rounded-full bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] px-2 py-0.5 font-mono font-semibold uppercase tracking-wide text-[var(--space-text-muted)]'}>{displayStatus(scene)} · {elapsedFor(scene)}</span>
          </div>
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
    {videoScene ? <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(0,0,0,0.58)] p-6" role="dialog" aria-label={`Scene ${videoScene.scene_index} video preview`} onClick={() => setVideoSceneId(null)}>
      <div className="relative w-full max-w-3xl rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><p className="font-semibold text-[var(--space-text-primary)]">Scene {videoScene.scene_index} · AI clip</p><button aria-label="Close preview" onClick={() => setVideoSceneId(null)} className="rounded-lg p-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--space-text-primary)_7%,transparent)]"><X className="h-5 w-5 text-[var(--space-text-primary)]" /></button></div>
        <video src={videoScene.render_url} controls autoPlay muted className="max-h-[70vh] w-full rounded-xl bg-black object-contain" />
      </div>
    </div> : null}

    {failed.length ? <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-4 text-sm">
      <AlertCircle className="h-5 w-5 shrink-0 text-[var(--space-semantic-danger)]" />
      <p className="min-w-[min(100%,220px)] flex-1 text-[var(--space-text-secondary)]"><strong className="text-[var(--space-text-primary)]">{failed.length} scene{failed.length === 1 ? '' : 's'} need attention.</strong> Retry, switch to Text Overlay, or skip each failed scene; the rest of the film is safe.</p>
      {onRetryScene ? <button onClick={() => onRetryScene(failed[0])} className="rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-2 text-xs font-semibold text-white"><RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />Retry first failed scene</button> : null}
    </div> : null}

    {/* FULL-FILM DRAFT PREVIEW before the production render: the browser plays
        the complete composition from the same timeline and props the Remotion
        render will receive — presenter states, clips, stills, overlays,
        captions and the ducked music bed. Strictly a preview: the final MP4 is
        always produced by the platform renderer. */}
    {project && allReady ? <div className="mt-6 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <button aria-expanded={filmPreviewOpen} onClick={() => setFilmPreviewOpen((open) => !open)} className="flex w-full items-center gap-2 text-left">
        <Clapperboard className="h-4 w-4 text-[var(--space-text-brand)]" />
        <span className="font-semibold text-[var(--space-text-primary)]">Preview the full film before rendering</span>
        <span className="ml-auto text-xs font-semibold text-[var(--space-text-brand)]">{filmPreviewOpen ? 'Hide' : 'Show'}</span>
      </button>
      {filmPreviewOpen ? <div className="mt-4"><CompositionPreview project={project} scenes={scenes} /></div> : null}
    </div> : null}

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
