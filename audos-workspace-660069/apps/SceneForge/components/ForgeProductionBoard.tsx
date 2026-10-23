/**
 * SceneForge — the production board.
 * Shows durable pipeline progress (resume-safe), the 4-draft style pick, the
 * finished 16:9 + native 9:16 players with download/share, and the shared-plan
 * edit panel (text / music / colour / timing — one edit re-renders BOTH formats).
 */
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Download,
  Loader2,
  Monitor,
  Pencil,
  RotateCcw,
  Share2,
  Smartphone,
  Star,
  XCircle,
} from 'lucide-react';
import { COLORS, FONT, RADIUS } from '../../../components/theme';
import { openPricing } from '../../../lib/plans';
import type { ForgeProject, ForgeStatus } from '../lib/forgeTypes';

const PHASES: Array<{ id: ForgeStatus[]; label: string }> = [
  { id: ['voicing'], label: 'ElevenLabs voice track (emotion by the script agent)' },
  { id: ['avatar'], label: 'Complete HeyGen avatar master (full script, audio and duration verified)' },
  { id: ['transcribe'], label: 'Server-side word timing map' },
  { id: ['direct'], label: 'Boss agent plans the edit for your niche' },
  { id: ['assets'], label: 'Assets — images, Veo 3.1 Fast B-roll, music + SFX' },
  { id: ['code'], label: 'Expert Remotion coder writes the graphics layer' },
  { id: ['drafts', 'draft_pick'], label: '4 × 5s draft styles — you pick one' },
  { id: ['final_render', 'portrait_finish'], label: 'Full renders — 16:9 and native 9:16' },
];

function phaseIndex(status: ForgeStatus): number {
  const i = PHASES.findIndex((p) => p.id.indexOf(status) >= 0);
  if (i >= 0) return i;
  return status === 'done' ? PHASES.length : -1;
}

function reviewPhaseIndex(step: string | null | undefined): number {
  if (step === 'script' || step === 'voice') return 0;
  if (step === 'avatar') return 1;
  if (step === 'scenes' || step === 'music') return 4;
  if (step === 'captions') return 5;
  if (step === 'landscape' || step === 'portrait' || step === 'final') return 7;
  return -1;
}

function shareVideo(url: string, title: string) {
  if (typeof navigator !== 'undefined' && (navigator as any).share) {
    (navigator as any).share({ title, url }).catch(() => undefined);
    return;
  }
  void navigator.clipboard?.writeText(url);
}

export default function ForgeProductionBoard({
  project,
  insufficient,
  onChooseDraft,
  onEdit,
  onRetry,
  onStepAction,
  onCancel,
}: {
  project: ForgeProject;
  insufficient: { required: number; shortfall: number | null } | null;
  onChooseDraft: (variation: number) => Promise<void>;
  onEdit: (changes: { accent?: string; music_mood?: string; timing_shift?: number; event_text?: Record<number, string>; scene_gestures?: Record<number, string>; scene_emotions?: Record<number, string> }) => Promise<void>;
  onRetry: () => Promise<void>;
  onStepAction: (step: string, action: 'approve' | 'regenerate' | 'edit', value?: string) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const idx = project.review_step ? reviewPhaseIndex(project.review_step) : phaseIndex(project.status);
  const [editOpen, setEditOpen] = useState(false);
  const [accent, setAccent] = useState('');
  const [mood, setMood] = useState('');
  const [textEdits, setTextEdits] = useState<Record<number, string>>({});
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState('');
  const [gestureEdits, setGestureEdits] = useState<Record<number, string>>({});
  const [emotionEdits, setEmotionEdits] = useState<Record<number, string>>({});

  const events: any[] = useMemo(() => (Array.isArray(project.director_plan?.events) ? project.director_plan.events : []), [project.director_plan]);

  const brollPreviews: any[] = Array.isArray(project.director_plan?.broll_previews) ? project.director_plan.broll_previews : [];
  const firstAvatar = project.heygen_video_url || project.heygen_chunks.find((chunk) => chunk.video_url)?.video_url || '';
  const avatarScenes = Array.isArray(project.studio_config.avatar_script) ? project.studio_config.avatar_script : [];
  const gestureOptions = Array.isArray(project.studio_config.avatarGestures) ? project.studio_config.avatarGestures : [];
  const emotionOptions = Array.isArray(project.studio_config.avatarEmotions) ? project.studio_config.avatarEmotions : [];

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (pending[key]) return;
    setPending((current) => ({ ...current, [key]: true }));
    setActionError('');
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        action(),
        new Promise<void>((_, reject) => { timeout = setTimeout(() => reject(new Error('This action took too long. You can try it again safely.')), 45000); }),
      ]);
    } catch (error: any) {
      setActionError(String(error?.message || error || 'The action could not be completed.'));
    } finally {
      if (timeout) clearTimeout(timeout);
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };
  const firstImage = (Array.isArray(project.director_plan?.images) ? project.director_plan.images : []).find((image: any) => image?.url)?.url || '';

  const submitEdit = async () => {
    setEditBusy(true);
    setEditError('');
    try {
      const changes: any = {};
      if (accent) changes.accent = accent;
      if (mood) changes.music_mood = mood;
      if (Object.keys(textEdits).length) changes.event_text = textEdits;
      if (!Object.keys(changes).length) { setEditOpen(false); return; }
      await onEdit(changes);
      setEditOpen(false);
      setTextEdits({});
    } catch (e: any) {
      setEditError(String(e?.message || e));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 1100 }}>
      {/* status line */}
      <div style={{ alignItems: 'center', background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, display: 'flex', gap: 12, padding: '12px 16px' }}>
        {project.status === 'failed' ? <XCircle size={18} color={COLORS.danger} /> : project.status === 'done' ? <Check size={18} color={COLORS.success} /> : project.review_step ? <Clapperboard size={18} color={COLORS.accent} /> : <Loader2 size={18} color={COLORS.accent} className="animate-spin" />}
        <div style={{ minWidth: 0 }}>
          <div style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 14.5, fontWeight: 600 }}>{project.topic}</div>
          <div style={{ color: project.status === 'failed' ? COLORS.danger : COLORS.secondary, fontSize: 13 }}>{project.stage_note || project.status}</div>
        </div>
        {project.coder_model ? (
          <span title="The model that wrote your Remotion graphics" style={{ background: COLORS.raised, border: `1px solid ${COLORS.border}`, borderRadius: 999, color: COLORS.muted, fontSize: 11.5, marginLeft: 'auto', padding: '4px 10px', whiteSpace: 'nowrap' }}>
            coder: {project.coder_model}
          </span>
        ) : null}
      </div>

      {actionError ? <div role="alert" style={{ background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}`, borderRadius: RADIUS.sm, color: COLORS.danger, fontSize: 13, padding: '10px 12px' }}>{actionError}</div> : null}

      {project.status === 'failed' ? (
        <div style={{ background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}`, borderRadius: RADIUS.card, display: 'grid', gap: 10, padding: 16 }}>
          <strong style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 14 }}>This step stopped</strong>
          <span style={{ color: COLORS.danger, fontSize: 13.5 }}>{project.stage_note || 'The provider returned an error.'}</span>
          <button type="button" onClick={() => void runAction('retry', onRetry)} disabled={Boolean(pending.retry)} style={{ alignItems: 'center', background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.sm, color: COLORS.onAccent, cursor: pending.retry ? 'wait' : 'pointer', display: 'flex', fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 700, gap: 7, justifyContent: 'center', minHeight: 44, width: 230 }} data-testid="button-retry-failed-step">
            {pending.retry ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Retry from this step
          </button>
          <span style={{ color: COLORS.muted, fontSize: 12 }}>Earlier approved outputs are reused; SceneForge does not restart or charge the project again.</span>
        </div>
      ) : null}

      {insufficient ? (
        <div style={{ alignItems: 'center', background: COLORS.warningBg, border: `1px solid ${COLORS.warning}`, borderRadius: RADIUS.card, display: 'flex', flexWrap: 'wrap', gap: 10, padding: '12px 16px' }}>
          <AlertTriangle size={16} color={COLORS.warning} />
          <span style={{ color: COLORS.text, fontSize: 13.5 }}>
            This video needs {insufficient.required} credits{insufficient.shortfall ? ` (${insufficient.shortfall} short)` : ''} — both formats are covered by the one charge.
          </span>
          <button type="button" onClick={() => openPricing('credits')} style={{ background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.sm, color: COLORS.onAccent, cursor: 'pointer', fontFamily: FONT.heading, fontSize: 13, fontWeight: 700, minHeight: 40, padding: '0 14px' }} data-testid="button-topup">
            Top up credits
          </button>
        </div>
      ) : null}

      {/* phases */}
      {project.status !== 'done' && project.status !== 'failed' ? (
        <ol style={{ display: 'grid', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
          {PHASES.map((phase, i) => {
            const state = i < idx ? 'done' : i === idx ? (project.review_step ? 'review' : 'now') : 'next';
            return (
              <li key={phase.label} style={{ alignItems: 'center', color: state === 'done' ? COLORS.success : state === 'now' || state === 'review' ? COLORS.text : COLORS.muted, display: 'flex', fontSize: 13.5, gap: 10, minHeight: 32 }}>
                {state === 'done' ? <Check size={15} /> : state === 'now' ? <Loader2 size={15} color={COLORS.accent} className="animate-spin" /> : state === 'review' ? <Clapperboard size={15} color={COLORS.accent} /> : <span style={{ border: `1.5px solid ${COLORS.border}`, borderRadius: 999, display: 'inline-block', height: 13, width: 13 }} />}
                {phase.label}{state === 'review' ? ' — awaiting your approval' : ''}
              </li>
            );
          })}
        </ol>
      ) : null}

      {/* Persisted real-output previews. Plain media elements only; all encoding stays server-side. */}
      <section>
        <div style={{ alignItems: 'end', display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, margin: 0 }}>Pipeline previews</h3>
            <p style={{ color: COLORS.muted, fontSize: 12.5, margin: '4px 0 0' }}>Open any completed step after reload. Approving the highlighted step lets the next stage run.</p>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {[
            { step: 'script', label: 'Script', ready: Boolean(project.script), body: project.script ? <div style={{ color: COLORS.secondary, fontSize: 12.5, lineHeight: '19px', maxHeight: 150, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{project.script}</div> : null },
            { step: 'voice', label: 'Complete voice', ready: project.heygen_chunks.length > 0 && project.heygen_chunks.every((chunk) => chunk.audio_url), body: project.heygen_chunks.some((chunk) => chunk.audio_url) ? <div style={{ display: 'grid', gap: 6, maxHeight: 150, overflowY: 'auto', padding: 8 }}>{project.heygen_chunks.filter((chunk) => chunk.audio_url).map((chunk) => <div key={chunk.i}><span style={{ color: COLORS.muted, display: 'block', fontSize: 10.5, marginBottom: 2 }}>Scene {chunk.i + 1} · {Math.round(chunk.duration_sec)}s</span><audio controls preload="metadata" src={chunk.audio_url || ''} style={{ height: 32, width: '100%' }} /></div>)}</div> : null },
            { step: 'avatar', label: 'Avatar', ready: Boolean(firstAvatar), body: firstAvatar ? <video controls playsInline preload="metadata" src={firstAvatar} style={{ aspectRatio: '16 / 9', background: '#000', width: '100%' }} /> : null },
            { step: 'scenes', label: 'B-roll / scenes', ready: brollPreviews.length > 0 || project.studio_config.brollAmount === 'none', body: brollPreviews.length ? <video controls muted playsInline preload="metadata" src={brollPreviews[0]?.url} style={{ aspectRatio: '16 / 9', background: '#000', width: '100%' }} /> : project.studio_config.brollAmount === 'none' ? <div style={{ color: COLORS.secondary, fontSize: 12.5 }}>No B-roll was selected for this project.</div> : null },
            { step: 'music', label: 'Music', ready: Boolean(project.music_url), body: project.music_url ? <audio controls preload="metadata" src={project.music_url} style={{ width: '100%' }} /> : null },
            { step: 'captions', label: 'Captions / overlays', ready: events.length > 0 && Boolean(firstAvatar || firstImage), body: events.length && (firstAvatar || firstImage) ? <div style={{ alignItems: 'end', aspectRatio: '16 / 9', background: `linear-gradient(rgba(0,0,0,.18),rgba(0,0,0,.7)), url(${firstImage || ''}) center/cover, #111`, display: 'flex', overflow: 'hidden', padding: 12, position: 'relative' }}>{firstAvatar && !firstImage ? <video muted playsInline preload="metadata" src={firstAvatar} style={{ height: '100%', inset: 0, objectFit: 'cover', position: 'absolute', width: '100%' }} /> : null}<span style={{ background: 'rgba(13,14,16,.82)', borderLeft: `4px solid ${COLORS.accent}`, color: '#fff', fontFamily: FONT.heading, fontSize: 14, fontWeight: 700, padding: '8px 10px', position: 'relative' }}>{String(events[0]?.text || '')}</span></div> : null },
            { step: 'landscape', label: 'Landscape layout', ready: Boolean(project.final_video_url), body: project.final_video_url ? <video controls playsInline preload="metadata" src={project.final_video_url} style={{ aspectRatio: '16 / 9', background: '#000', width: '100%' }} /> : null },
            { step: 'portrait', label: 'Portrait layout', ready: Boolean(project.portrait_preview_url || project.portrait_video_url), body: project.portrait_preview_url || project.portrait_video_url ? <video controls playsInline preload="metadata" src={project.portrait_preview_url || project.portrait_video_url || ''} style={{ aspectRatio: '9 / 16', background: '#000', display: 'block', maxHeight: 260, margin: '0 auto', objectFit: 'cover', width: 'auto' }} /> : null },
            { step: 'final', label: 'Final delivery', ready: Boolean(project.final_video_url && project.portrait_video_url), body: project.final_video_url && project.portrait_video_url ? <div style={{ color: COLORS.success, fontSize: 13 }}>Both server-rendered MP4 files are ready below.</div> : null },
          ].map((preview) => {
            const awaiting = project.review_step === preview.step;
            return (
              <article key={preview.step} style={{ background: COLORS.surface, border: `1px solid ${awaiting ? COLORS.accent : COLORS.border}`, borderRadius: RADIUS.card, overflow: 'hidden' }}>
                <div style={{ minHeight: 130, padding: preview.body ? 0 : 14 }}>{preview.body || <div style={{ alignItems: 'center', color: COLORS.muted, display: 'flex', fontSize: 12.5, height: 100, justifyContent: 'center' }}>Output not ready yet</div>}</div>
                <div style={{ display: 'grid', gap: 8, padding: 10 }}>
                  <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}><strong style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 13.5 }}>{preview.label}</strong>{awaiting ? <span style={{ color: COLORS.accent, fontSize: 11.5 }}>Awaiting approval</span> : preview.ready ? <Check size={14} color={COLORS.success} /> : null}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button type="button" disabled={!preview.ready || !awaiting || Boolean(pending[`${preview.step}:approve`])} onClick={() => void runAction(`${preview.step}:approve`, () => onStepAction(preview.step, 'approve'))} data-testid={`button-approve-${preview.step}`} style={{ background: awaiting ? COLORS.accent : COLORS.raised, border: `1px solid ${awaiting ? COLORS.accent : COLORS.border}`, borderRadius: RADIUS.badge, color: awaiting ? COLORS.onAccent : COLORS.muted, cursor: awaiting ? 'pointer' : 'not-allowed', fontSize: 11.5, minHeight: 34, padding: '0 9px' }}>Approve</button>
                    <button type="button" disabled={!preview.ready || !awaiting || Boolean(pending[`${preview.step}:regenerate`])} onClick={() => void runAction(`${preview.step}:regenerate`, () => onStepAction(preview.step, 'regenerate'))} data-testid={`button-regenerate-${preview.step}`} style={{ background: COLORS.raised, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.badge, color: awaiting ? COLORS.secondary : COLORS.muted, cursor: awaiting ? 'pointer' : 'not-allowed', fontSize: 11.5, minHeight: 34, padding: '0 9px' }}>Regenerate</button>
                    <button type="button" disabled={!preview.ready || !awaiting || Boolean(pending[`${preview.step}:edit`])} onClick={() => { const value = window.prompt(`Describe the change for ${preview.label}:`, preview.step === 'script' ? project.script || '' : ''); if (value != null) void runAction(`${preview.step}:edit`, () => onStepAction(preview.step, 'edit', value)); }} data-testid={`button-edit-${preview.step}`} style={{ background: COLORS.raised, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.badge, color: awaiting ? COLORS.secondary : COLORS.muted, cursor: awaiting ? 'pointer' : 'not-allowed', fontSize: 11.5, minHeight: 34, padding: '0 9px' }}>Edit</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {avatarScenes.length ? (
        <section style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: 14 }}>
          <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Avatar direction by scene</h3>
          <p style={{ color: COLORS.muted, fontSize: 12.5, margin: '0 0 12px' }}>SceneForge chose each cue from capability metadata returned for this avatar. Edits update the shared post-production motion treatment for both formats.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {avatarScenes.map((scene, index) => (
              <div key={index} style={{ alignItems: 'center', background: COLORS.raised, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.sm, display: 'grid', gap: 8, gridTemplateColumns: 'minmax(180px, 1fr) repeat(2, minmax(130px, 180px))', padding: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ color: COLORS.text, display: 'block', fontFamily: FONT.heading, fontSize: 12.5 }}>Scene {index + 1}{scene.startSec != null && scene.endSec != null ? ` · ${Math.round(scene.startSec)}s–${Math.round(scene.endSec)}s` : ''}</strong>
                  <span style={{ color: COLORS.muted, display: 'block', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scene.text}</span>
                </div>
                {gestureOptions.length ? <select aria-label={`Gesture for scene ${index + 1}`} value={gestureEdits[index] ?? scene.gesture ?? ''} onChange={(event) => setGestureEdits((current) => ({ ...current, [index]: event.target.value }))} style={{ background: COLORS.input, border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.badge, color: COLORS.secondary, minHeight: 38, padding: '0 8px' }}><option value="">Automatic gesture</option>{gestureOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <span style={{ color: COLORS.muted, fontSize: 11.5 }}>Automatic HeyGen motion</span>}
                {emotionOptions.length ? <select aria-label={`Expression for scene ${index + 1}`} value={emotionEdits[index] ?? scene.emotion ?? ''} onChange={(event) => setEmotionEdits((current) => ({ ...current, [index]: event.target.value }))} style={{ background: COLORS.input, border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.badge, color: COLORS.secondary, minHeight: 38, padding: '0 8px' }}><option value="">Natural expression</option>{emotionOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <span style={{ color: COLORS.muted, fontSize: 11.5 }}>{scene.emotion || 'Natural expression'}</span>}
              </div>
            ))}
          </div>
          {gestureOptions.length || emotionOptions.length ? <button type="button" disabled={project.status !== 'done' || Boolean(pending.gestures) || (!Object.keys(gestureEdits).length && !Object.keys(emotionEdits).length)} onClick={() => void runAction('gestures', async () => { await onEdit({ scene_gestures: gestureEdits, scene_emotions: emotionEdits }); setGestureEdits({}); setEmotionEdits({}); })} style={{ background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.sm, color: COLORS.onAccent, cursor: pending.gestures ? 'wait' : 'pointer', fontFamily: FONT.heading, fontSize: 13, fontWeight: 700, marginTop: 12, minHeight: 40, padding: '0 14px' }} data-testid="button-apply-scene-gestures">Apply scene direction</button> : <p style={{ color: COLORS.muted, fontSize: 11.5, margin: '10px 0 0' }}>This avatar did not report editable gesture or expression options, so SceneForge uses HeyGen’s native audio-driven motion and does not show a dead filter.</p>}
        </section>
      ) : null}

      {/* draft pick */}
      {project.status === 'draft_pick' && project.drafts ? (
        <section>
          <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Pick your edit style</h3>
          <p style={{ color: COLORS.muted, fontSize: 13, margin: '0 0 12px' }}>Four 5-second drafts of the same moment. Star the one you like — the other three are scrapped and the full video continues in that style only.</p>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {project.drafts.map((d) => (
              <div key={d.variation} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, overflow: 'hidden' }}>
                {d.video_url ? (
                  <video src={d.video_url} controls muted playsInline loop style={{ aspectRatio: '16 / 9', background: '#000', display: 'block', width: '100%' }} />
                ) : (
                  <div style={{ alignItems: 'center', aspectRatio: '16 / 9', color: d.status === 'failed' ? COLORS.danger : COLORS.muted, display: 'flex', fontSize: 12.5, justifyContent: 'center' }}>
                    {d.status === 'failed' ? 'This draft failed to render' : 'Rendering…'}
                  </div>
                )}
                <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', padding: '10px 12px' }}>
                  <span style={{ color: COLORS.secondary, fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 600 }}>{d.label}</span>
                  <button
                    type="button"
                    disabled={!d.video_url || Boolean(pending[`draft:${d.variation}`])}
                    onClick={() => void runAction(`draft:${d.variation}`, () => onChooseDraft(d.variation))}
                    style={{ alignItems: 'center', background: d.video_url ? 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)' : COLORS.raised, border: 'none', borderRadius: RADIUS.sm, color: d.video_url ? COLORS.onAccent : COLORS.muted, cursor: d.video_url ? 'pointer' : 'not-allowed', display: 'flex', fontFamily: FONT.heading, fontSize: 13, fontWeight: 700, gap: 6, minHeight: 40, padding: '0 14px' }}
                    data-testid={`button-pick-draft-${d.variation}`}
                  >
                    <Star size={14} /> Use this
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* finals */}
      {project.status === 'done' ? (
        <section style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {[
              { url: project.final_video_url, label: '16:9 · Landscape', icon: <Monitor size={15} />, aspect: '16 / 9' },
              { url: project.portrait_video_url, label: '9:16 · Portrait (native layout)', icon: <Smartphone size={15} />, aspect: '9 / 16' },
            ].map((f) =>
              f.url ? (
                <div key={f.label} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: 12 }}>
                  <div style={{ alignItems: 'center', color: COLORS.secondary, display: 'flex', fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 600, gap: 7, marginBottom: 10 }}>
                    {f.icon} {f.label}
                  </div>
                  <video src={f.url} controls playsInline style={{ aspectRatio: f.aspect, background: '#000', borderRadius: RADIUS.sm, display: 'block', maxHeight: 420, margin: '0 auto', width: f.aspect === '9 / 16' ? 'auto' : '100%' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <a href={f.url} download target="_blank" rel="noreferrer" style={{ alignItems: 'center', background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', borderRadius: RADIUS.sm, color: COLORS.onAccent, display: 'flex', flex: 1, fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 700, gap: 7, justifyContent: 'center', minHeight: 44, textDecoration: 'none' }} data-testid={`link-download-${f.aspect === '9 / 16' ? 'portrait' : 'landscape'}`}>
                      <Download size={15} /> Download
                    </a>
                    <button type="button" onClick={() => shareVideo(f.url!, project.topic)} style={{ alignItems: 'center', background: COLORS.raised, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.sm, color: COLORS.secondary, cursor: 'pointer', display: 'flex', fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 600, gap: 7, justifyContent: 'center', minHeight: 44, padding: '0 14px' }} data-testid={`button-share-${f.aspect === '9 / 16' ? 'portrait' : 'landscape'}`}>
                      <Share2 size={15} /> Share
                    </button>
                  </div>
                </div>
              ) : null,
            )}
          </div>

          {/* edit panel — shared elements apply to BOTH formats */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: 14 }}>
            <button type="button" onClick={() => setEditOpen((v) => !v)} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: COLORS.text, cursor: 'pointer', display: 'flex', fontFamily: FONT.heading, fontSize: 14.5, fontWeight: 600, gap: 8, minHeight: 40, padding: 0 }} data-testid="button-edit-toggle">
              <Pencil size={15} color={COLORS.accent} /> Edit both formats (text · music · colour)
            </button>
            {editOpen ? (
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <p style={{ color: COLORS.muted, fontSize: 12.5, margin: 0 }}>Edits change the ONE shared edit plan, then both the 16:9 and 9:16 versions re-render in sync.</p>
                {events.length ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {events.slice(0, 8).map((ev, i) => (
                      <div key={i} style={{ display: 'grid', gap: 4 }}>
                        <label style={{ color: COLORS.muted, fontSize: 12 }}>On-screen text #{i + 1} ({Math.round(ev.start)}s–{Math.round(ev.end)}s)</label>
                        <input
                          defaultValue={String(ev.text || '')}
                          onChange={(e) => setTextEdits((prev) => ({ ...prev, [i]: e.target.value }))}
                          style={{ background: COLORS.input, border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.sm, color: COLORS.text, fontFamily: FONT.body, fontSize: 13.5, minHeight: 40, padding: '0 10px' }}
                          data-testid={`input-event-text-${i}`}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <label style={{ alignItems: 'center', color: COLORS.secondary, display: 'flex', fontSize: 13, gap: 8 }}>
                    Accent colour
                    <input type="color" value={accent || '#D9A441'} onChange={(e) => setAccent(e.target.value)} style={{ background: 'transparent', border: 'none', height: 36, width: 48 }} data-testid="input-accent" />
                  </label>
                  <label style={{ alignItems: 'center', color: COLORS.secondary, display: 'flex', fontSize: 13, gap: 8 }}>
                    Music mood
                    <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="e.g. dramatic" style={{ background: COLORS.input, border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.sm, color: COLORS.text, fontSize: 13.5, minHeight: 40, padding: '0 10px', width: 150 }} data-testid="input-music-mood" />
                  </label>
                </div>
                {editError ? <div style={{ color: COLORS.danger, fontSize: 13 }}>{editError}</div> : null}
                <button type="button" onClick={submitEdit} disabled={editBusy} style={{ alignItems: 'center', background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.sm, color: COLORS.onAccent, cursor: editBusy ? 'wait' : 'pointer', display: 'flex', fontFamily: FONT.heading, fontSize: 14, fontWeight: 700, gap: 8, justifyContent: 'center', minHeight: 44, width: 260 }} data-testid="button-edit-apply">
                  {editBusy ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
                  Re-render both formats
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* cancel (active runs only) */}
      {project.status !== 'done' && project.status !== 'failed' && project.status !== 'draft_pick' ? (
        <button type="button" disabled={Boolean(pending.cancel)} onClick={() => void runAction('cancel', onCancel)} style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.sm, color: COLORS.muted, cursor: pending.cancel ? 'wait' : 'pointer', fontFamily: FONT.body, fontSize: 13, justifySelf: 'start', minHeight: 40, padding: '0 14px' }} data-testid="button-cancel-run">
          Cancel this run (unused credits are refunded)
        </button>
      ) : null}
    </div>
  );
}
