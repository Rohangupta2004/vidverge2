/**
 * My Videos — the ProductStudio landing view. A 3D-tilt gallery of every
 * Product (Track B) project the visitor owns: poster-frame thumbnails, live
 * status badges, Edit / Download / Delete actions, and the "+ Create new
 * video" flow (title, product URL, screenshots, opt-in AI images — unchanged
 * pipeline). Soft-deleted projects never appear: the server's list op filters
 * on deleted_at.
 */
import { useCallback, useEffect, useState } from 'react';
import { AudioLines, BookOpen, Clapperboard, Download, Film, Flame, Gem, ImagePlus, Loader2, MonitorPlay, Pencil, Plus, RefreshCw, Scissors, Sparkles, Trash2, Type, Volume2, Wand2, X } from 'lucide-react';
import { trackB, type NarrationWordTiming, type TrackBProjectRow, type MutationRejection } from '../../lib/trackB/api';
import type { EnhanceTarget } from './App';
import { Tilt } from './fx';
import { VIDEO_STYLES, type VideoStyleId } from './videoStyles';
import { writeLaunchSoundPrefs, type SoundTarget } from './SoundStudio';

const STYLE_ICONS = { Scissors, Flame, Type, BookOpen, Gem };

/** What the "Choose Style" step offers: the Product Launch film plus every styled pipeline. */
type StyleChoice = 'hyperframes' | VideoStyleId;

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

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function statusBadge(status?: string): { label: string; color: string; spin: boolean } {
  const s = String(status || '').toLowerCase();
  if (/rendered|delivered|qa_passed/.test(s)) return { label: 'rendered', color: S.success, spin: false };
  if (/render|build|compos|queue|generat/.test(s)) return { label: 'rendering', color: '#fbbf24', spin: true };
  if (/fail|error/.test(s)) return { label: 'failed', color: S.danger, spin: false };
  if (/planned|validated/.test(s)) return { label: 'planned', color: '#94a3b8', spin: false };
  return { label: s || 'draft', color: '#94a3b8', spin: false };
}

const actionBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 9,
  border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer',
  fontSize: 11.5, fontWeight: 700, textDecoration: 'none', lineHeight: 1.4,
};

/** Live render telemetry per project: provider-reported % and the real failure reason. */
interface RenderInfo {
  progress: number | null;
  error?: string;
  failed?: boolean;
}

const RENDERING_STATUS = /render|build|compos|queue|generat/i;

export default function MyVideos({ onOpen, onStartWizard, onEnhance, onAddSound }: {
  onOpen: (id: number) => void;
  /** Open the creation wizard on the style picked in the Create dialog. */
  onStartWizard: (style: VideoStyleId) => void;
  onEnhance?: (target: EnhanceTarget) => void;
  /** Open the sound + captions studio on a finished film. */
  onAddSound?: (target: SoundTarget) => void;
}) {
  const [projects, setProjects] = useState<Partial<TrackBProjectRow>[]>([]);
  const [renderInfo, setRenderInfo] = useState<Record<number, RenderInfo>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [styleChoice, setStyleChoice] = useState<StyleChoice>('hyperframes');
  // Optional Product Launch sound choices, made here and applied in the
  // Sound Studio once the film has rendered.
  const [launchSfx, setLaunchSfx] = useState('');
  const [launchCaptions, setLaunchCaptions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [aiImages, setAiImages] = useState(false); // default OFF per the image-source rule
  const [shots, setShots] = useState<string[]>([]);
  const [uploadingShots, setUploadingShots] = useState(false);
  const [userScript, setUserScript] = useState('');
  const [voiceTrackUrl, setVoiceTrackUrl] = useState<string | null>(null);
  const [voiceTrackName, setVoiceTrackName] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceWords, setVoiceWords] = useState<NarrationWordTiming[]>([]);
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null);
  const [transcribingVoice, setTranscribingVoice] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<{ id: number; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll each in-flight render's real status: the provider-reported progress
  // number (persisted on the job row by the watcher) and, on failure, the
  // provider's actual reason — shown on the card instead of a generic error.
  const syncRenders = useCallback(async (rows: Partial<TrackBProjectRow>[]) => {
    const rendering = rows.filter((p) => RENDERING_STATUS.test(String(p.status || ''))).slice(0, 4);
    for (const p of rendering) {
      try {
        const res = await trackB.renderStatus(p.id as number);
        if ((res as MutationRejection).ok === false) continue;
        const r = res as { rendering: boolean; failed?: boolean; error?: string; progress?: number | null };
        setRenderInfo((cur) => ({
          ...cur,
          [p.id as number]: {
            progress: typeof r.progress === 'number' ? r.progress : null,
            error: r.failed ? (r.error || 'The render failed.') : undefined,
            failed: !!r.failed,
          },
        }));
      } catch {
        /* next poll retries */
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await trackB.list();
      if (res.ok) {
        const visible = (res.projects ?? []).filter((p) => !p.deleted_at);
        setProjects(visible);
        void syncRenders(visible);
      }
    } finally {
      setLoading(false);
    }
  }, [syncRenders]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => { void load(); }, 20000);
    return () => { window.clearInterval(poll); };
  }, [load]);

  const onShotFiles = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploadingShots(true);
    try {
      const next: string[] = [];
      for (const f of Array.from(files).slice(0, Math.max(0, 12 - shots.length))) {
        if (!f.type.startsWith('image/')) continue;
        const r = await trackB.uploadScreenshot(f);
        if (r.success && r.url) next.push(r.url);
        else setError(r.error ?? 'A screenshot could not be uploaded.');
      }
      if (next.length) setShots((cur) => [...cur, ...next].slice(0, 12));
    } finally {
      setUploadingShots(false);
    }
  }, [shots.length]);

  const onVoiceFile = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|webm)$/i.test(file.name)) {
      setError('Choose an MP3, WAV, M4A, or WebM audio file.');
      return;
    }
    setError(null);
    setTranscribingVoice(true);
    try {
      const transcription = await trackB.transcribeVoiceTrack(file);
      if (!transcription.success || !transcription.transcript) {
        setError(transcription.error ?? 'Your voice track could not be transcribed.');
        return;
      }
      setVoiceTranscript(transcription.transcript);
      setVoiceWords(transcription.words ?? []);
      setVoiceDuration(transcription.duration ?? null);
      setTranscribingVoice(false);
      setUploadingVoice(true);
      const upload = await trackB.uploadVoiceTrack(file);
      if (!upload.success || !upload.url) {
        setError(upload.error ?? 'Your voice track could not be uploaded.');
        return;
      }
      setVoiceTrackUrl(upload.url);
      setVoiceTrackName(file.name || 'Voice track');
    } finally {
      setTranscribingVoice(false);
      setUploadingVoice(false);
    }
  }, []);

  const clearVoiceTrack = useCallback(() => {
    setVoiceTrackUrl(null);
    setVoiceTrackName('');
    setVoiceTranscript(null);
    setVoiceWords([]);
    setVoiceDuration(null);
  }, []);

  const createProject = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await trackB.create(title.trim() || 'Untitled product video', url.trim() || undefined, {
        aiImageEnabled: aiImages,
        userScreenshots: shots,
        userScript: userScript.trim() || null,
        voiceTrackUrl,
        voiceTranscript,
        voiceWords,
        voiceDuration,
      });
      if ((res as MutationRejection).ok === false) {
        setError((res as MutationRejection).error);
      } else {
        const ok = res as { project: TrackBProjectRow };
        // Carry the optional sound-effects brief and captions choice forward so
        // the sound step opens with the customer's answers already filled in.
        if (launchSfx.trim() || launchCaptions) {
          writeLaunchSoundPrefs(ok.project.id, { sfxPrompt: launchSfx.trim() || undefined, captions: launchCaptions });
        }
        setShowCreate(false);
        setTitle(''); setUrl(''); setAiImages(false); setShots([]); setUserScript(''); clearVoiceTrack();
        setLaunchSfx(''); setLaunchCaptions(false);
        await load();
        onOpen(ok.project.id);
      }
    } catch {
      setError('Could not create the project — please try again.');
    } finally {
      setCreating(false);
    }
  }, [title, url, aiImages, shots, userScript, voiceTrackUrl, voiceTranscript, voiceWords, voiceDuration, launchSfx, launchCaptions, clearVoiceTrack, load, onOpen]);

  const confirmDelete = useCallback(async () => {
    if (!deletePrompt) return;
    setDeleting(true);
    try {
      const res = await trackB.deleteProject(deletePrompt.id);
      if ((res as MutationRejection).ok === false) setError((res as MutationRejection).error);
      else setProjects((cur) => cur.filter((p) => p.id !== deletePrompt.id));
    } catch {
      setError('Delete failed — please try again.');
    } finally {
      setDeleting(false);
      setDeletePrompt(null);
    }
  }, [deletePrompt]);

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', color: S.text, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800 }}>
            <Film size={22} color="var(--space-text-brand)" /> My Videos
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: S.sub }}>Designed product films, rendered from your real product. Click a video to open the editor.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => void load()} aria-label="Refresh" className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', padding: 9, borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer' }} data-testid="button-refresh">
            <RefreshCw size={14} className={loading ? 'rc-spin' : ''} />
          </button>
          <button type="button" onClick={() => setShowCreate(true)} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700, boxShadow: '0 8px 22px -12px color-mix(in srgb, var(--space-brand-primary-600) 80%, transparent)' }} data-testid="button-new-project">
            <Plus size={14} /> Create new video
          </button>
        </div>
      </header>

      {error ? (
        <div role="alert" style={{ marginBottom: 14, padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: S.danger, background: `color-mix(in srgb, ${S.danger} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${S.danger} 30%, transparent)` }}>
          {error}
        </div>
      ) : null}

      {loading && projects.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: S.muted, fontSize: 13, padding: 24 }}>
          <Loader2 size={14} className="rc-spin" /> Loading your videos…
        </div>
      ) : projects.length === 0 ? (
        <div className="ps-fade-up" style={{ borderRadius: 18, border: `1px solid ${S.border}`, background: S.panel, padding: 'clamp(32px, 6vw, 56px)', textAlign: 'center' }} data-testid="empty-projects">
          <div aria-hidden="true" style={{ position: 'relative', width: 120, height: 84, margin: '0 auto 18px' }}>
            <span style={{ position: 'absolute', inset: '8px 18px', borderRadius: 12, background: 'linear-gradient(135deg, var(--space-brand-primary-700), var(--space-brand-primary-500))', transform: 'rotate(-7deg)', opacity: 0.5 }} />
            <span style={{ position: 'absolute', inset: '4px 10px', borderRadius: 12, background: 'linear-gradient(135deg, var(--space-brand-primary-600), var(--space-brand-highlight-600))', transform: 'rotate(4deg)', opacity: 0.75 }} />
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14, background: S.panelStrong, border: `1px solid ${S.borderStrong}` }}>
              <Clapperboard size={30} color="var(--space-text-brand)" />
            </span>
          </div>
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>No videos yet</h2>
          <p style={{ margin: '0 auto 18px', fontSize: 13.5, color: S.sub, lineHeight: 1.6, maxWidth: 460 }}>
            Drop your product URL and the pipeline captures your real screens, writes the script, and renders a designed film you can fine-tune scene by scene.
          </p>
          <button type="button" onClick={() => setShowCreate(true)} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 20px', borderRadius: 12, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 14, fontWeight: 700, boxShadow: '0 10px 26px -12px color-mix(in srgb, var(--space-brand-primary-600) 85%, transparent)' }} data-testid="button-first-video">
            <Sparkles size={15} /> Make your first video
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 290px), 1fr))', gap: 20 }}>
          {projects.map((p) => {
            const badge = statusBadge(p.status);
            const info = renderInfo[p.id as number];
            return (
              <Tilt
                key={p.id}
                maxTilt={6}
                role="button"
                tabIndex={0}
                ariaLabel={`Open ${p.title} in the editor`}
                testId={`video-card-${p.id}`}
                onClick={() => onOpen(p.id as number)}
                style={{ borderRadius: 16, border: `1px solid ${S.border}`, background: S.panel, overflow: 'hidden', cursor: 'pointer' }}
              >
                <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000' }}>
                  {p.preview_video_url ? (
                    <video
                      src={p.preview_video_url}
                      preload="metadata"
                      muted
                      playsInline
                      style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                      data-testid={`video-thumb-${p.id}`}
                    />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, background: 'linear-gradient(135deg, var(--space-brand-primary-700), var(--space-brand-primary-500) 55%, var(--space-brand-highlight-600))' }} data-testid={`video-tile-${p.id}`}>
                      <span style={{ fontSize: 17, fontWeight: 900, color: '#fff', textAlign: 'center', textShadow: '0 2px 10px rgba(0,0,0,0.35)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{p.title}</span>
                    </div>
                  )}
                  <span style={{ position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: badge.color, background: `color-mix(in srgb, ${badge.color} 16%, rgba(4,8,18,0.72))`, border: `1px solid color-mix(in srgb, ${badge.color} 45%, transparent)` }} data-testid={`status-${p.id}`}>
                    {badge.spin ? <Loader2 size={10} className="rc-spin" /> : null}
                    {badge.label}
                  </span>
                </div>
                <div style={{ padding: '12px 14px 14px' }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>
                  <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: S.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {relativeTime(p.created_at)}{p.route ? ` · ${String(p.route).replace(/_/g, ' ')}` : ''}
                  </span>
                  {info?.failed && info.error ? (
                    <p style={{ margin: '8px 0 0', fontSize: 11.5, color: S.danger, lineHeight: 1.5 }} data-testid={`render-error-${p.id}`}>
                      {info.error}
                    </p>
                  ) : null}
                  {badge.label === 'rendering' ? (
                    <div style={{ marginTop: 9 }} data-testid={`render-progress-${p.id}`}>
                      <div style={{ height: 5, borderRadius: 999, background: `color-mix(in srgb, ${S.border} 60%, transparent)`, overflow: 'hidden' }}>
                        <div
                          className={info && info.progress != null ? undefined : 'rc-pulse'}
                          style={{ height: '100%', width: `${info && info.progress != null ? Math.max(4, Math.min(100, info.progress)) : 8}%`, borderRadius: 999, background: 'linear-gradient(90deg, var(--space-brand-primary-500), var(--space-brand-highlight-600))', transition: 'width 0.6s ease' }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4, fontSize: 10.5, color: S.muted, fontWeight: 700 }}>
                        <span>Submitted → Rendering → Done</span>
                        <span>{info && info.progress != null ? `${Math.round(info.progress)}%` : 'Starting…'}</span>
                      </div>
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
                    <button type="button" className="ps-btn" style={actionBtn} onClick={(e) => { e.stopPropagation(); onOpen(p.id as number); }} data-testid={`button-edit-${p.id}`}>
                      <Pencil size={11} /> Edit
                    </button>
                    {p.preview_video_url && onEnhance ? (
                      <button
                        type="button"
                        className="ps-btn"
                        style={{ ...actionBtn, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEnhance({ projectId: p.id as number, title: String(p.title ?? 'Product video'), videoUrl: p.preview_video_url as string, accent: p.project?.brand?.tokens?.primary ?? null });
                        }}
                        title="Auto cuts, captions, trim, colour and export - on this finished video"
                        data-testid={`button-enhance-${p.id}`}
                      >
                        <Wand2 size={11} /> Enhance
                      </button>
                    ) : null}
                    {p.preview_video_url && onAddSound ? (
                      <button
                        type="button"
                        className="ps-btn"
                        style={actionBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddSound({
                            title: String(p.title ?? 'Product video'),
                            videoUrl: p.preview_video_url as string,
                            sourceId: p.id as number,
                            source: 'product_launch',
                          });
                        }}
                        title="ElevenLabs music, optional sound effects and optional captions — on this finished film"
                        data-testid={`button-sound-${p.id}`}
                      >
                        <Volume2 size={11} /> Sound
                      </button>
                    ) : null}
                    {p.preview_video_url ? (
                      <a href={p.preview_video_url} download target="_blank" rel="noreferrer" className="ps-btn" style={actionBtn} onClick={(e) => e.stopPropagation()} data-testid={`button-download-${p.id}`}>
                        <Download size={11} /> Download
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="ps-btn"
                      style={{ ...actionBtn, marginLeft: 'auto', color: S.danger, borderColor: `color-mix(in srgb, ${S.danger} 35%, transparent)` }}
                      onClick={(e) => { e.stopPropagation(); setDeletePrompt({ id: p.id as number, title: String(p.title ?? 'this video') }); }}
                      data-testid={`button-delete-${p.id}`}
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </div>
              </Tilt>
            );
          })}
        </div>
      )}

      <p style={{ margin: '26px 0 0', fontSize: 12, color: S.muted }}>
        Want AI-generated footage with characters instead (Track A)?{' '}
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'create' } }))} style={{ padding: 0, border: 'none', background: 'none', color: S.brand, cursor: 'pointer', fontSize: 12, fontWeight: 700 }} data-testid="link-track-a">
        Open Create</button>{' — the Product track here designs films from your real product screens.'}
      </p>

      {deletePrompt ? (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,8,18,0.66)' }}>
          <div className="ps-fade-up" style={{ width: 'min(400px, 92vw)', borderRadius: 16, border: `1px solid ${S.borderStrong}`, background: S.panelStrong, padding: 20 }} data-testid="dialog-delete">
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800 }}>Delete “{deletePrompt.title}”?</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: S.sub, lineHeight: 1.6 }}>
              The video disappears from My Videos and the editor. This is a soft delete — nothing is rendered again and the project stays recoverable if you ever need it back.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDeletePrompt(null)} className="ps-btn" style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${S.border}`, background: 'transparent', color: S.sub, cursor: 'pointer', fontSize: 13, fontWeight: 600 }} data-testid="button-delete-cancel">Keep it</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="ps-btn" style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: S.danger, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: deleting ? 0.6 : 1 }} data-testid="button-delete-confirm">
                {deleting ? 'Deleting…' : 'Delete video'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,8,18,0.66)' }}>
          <div className="ps-fade-up" style={{ width: 'min(460px, 92vw)', maxHeight: 'min(85vh, 720px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 16, border: `1px solid ${S.borderStrong}`, background: S.panelStrong }} data-testid="dialog-create">
            <div style={{ flexShrink: 0, padding: '20px 22px 0' }}>
              <h3 style={{ margin: '0 0 6px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800 }}><MonitorPlay size={16} color="var(--space-text-brand)" /> New Product video</h3>
              <p style={{ margin: '0 0 14px', fontSize: 12.5, color: S.sub, lineHeight: 1.55 }}>
                Drop your product URL — the pipeline captures the real screens, colours, and copy to design from truth.
              </p>
            </div>

            {/* Scrollable body — the footer CTA below never scrolls out of reach. */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 22px 10px' }} data-testid="dialog-create-body">
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 }}>Choose Style</label>
            <div role="radiogroup" aria-label="Choose Style" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 14 }}>
              <button type="button" role="radio" aria-checked={styleChoice === 'hyperframes'} onClick={() => setStyleChoice('hyperframes')} className="ps-btn" style={{ padding: '10px 12px', borderRadius: 11, textAlign: 'left', border: `1px solid ${styleChoice === 'hyperframes' ? 'var(--space-brand-primary-600)' : S.border}`, background: styleChoice === 'hyperframes' ? 'color-mix(in srgb, var(--space-brand-primary-600) 14%, transparent)' : S.card, color: S.text, cursor: 'pointer' }} data-testid="option-style-hyperframes">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800 }}><MonitorPlay size={12} color="var(--space-text-brand)" /> Product Launch</span>
                <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: S.muted, lineHeight: 1.45 }}>HyperFrames film designed from your real product screens — the standard pipeline.</span>
              </button>
              {VIDEO_STYLES.map((s) => {
                const Icon = STYLE_ICONS[s.icon];
                const active = styleChoice === s.id;
                return (
                  <button key={s.id} type="button" role="radio" aria-checked={active} onClick={() => setStyleChoice(s.id)} className="ps-btn" style={{ padding: '10px 12px', borderRadius: 11, textAlign: 'left', border: `1px solid ${active ? 'var(--space-brand-primary-600)' : S.border}`, background: active ? 'color-mix(in srgb, var(--space-brand-primary-600) 14%, transparent)' : S.card, color: S.text, cursor: 'pointer' }} data-testid={`option-style-${s.id}`}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800 }}><Icon size={12} color="var(--space-text-brand)" /> {s.name}</span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: S.muted, lineHeight: 1.45 }}>{s.blurb}</span>
                  </button>
                );
              })}
            </div>

            {styleChoice !== 'hyperframes' ? (
              <div className="ps-fade-up" data-testid={`panel-style-${styleChoice}`}>
                <div style={{ borderRadius: 12, border: `1px solid ${S.border}`, background: S.card, padding: 13, marginBottom: 14 }}>
                  <p style={{ margin: 0, fontSize: 12.5, color: S.sub, lineHeight: 1.6 }}>
                    {VIDEO_STYLES.find((s) => s.id === styleChoice)?.blurb}
                  </p>
                  <p style={{ margin: '9px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.55 }}>
                    A guided seven-step flow takes you from your product or a plain English description through the script — which you review and approve before anything renders — to the frames, the ElevenLabs sound and the finished film.
                  </p>
                </div>
              </div>
            ) : (
            <>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 }}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={140} placeholder="Launch film for…" className="ps-input"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13.5, marginBottom: 12 }} data-testid="input-new-title" />
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 }}>Product URL (recommended)</label>
            <input value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://yourproduct.com" className="ps-input"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13.5, marginBottom: 12 }} data-testid="input-new-url" />

            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 }}>Scene images (optional)</label>
            <div style={{ borderRadius: 10, border: `1px dashed ${S.border}`, background: S.card, padding: 10, marginBottom: 10 }}>
              <label className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, border: `1px solid ${S.border}`, background: S.panelStrong, color: S.sub, cursor: 'pointer', fontSize: 12, fontWeight: 700 }} data-testid="button-upload-screenshots">
                {uploadingShots ? <Loader2 size={12} className="rc-spin" /> : <ImagePlus size={12} />}
                {uploadingShots ? 'Uploading…' : 'Upload screenshots'}
                <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { void onShotFiles(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid="input-screenshots" />
              </label>
              <p style={{ margin: '7px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
                Your screenshots are used directly for the scenes — no AI images are generated. Without uploads, your site's real screenshot is used.
              </p>
              {shots.length ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {shots.map((u) => (
                    <span key={u} style={{ position: 'relative', display: 'inline-block' }}>
                      <img src={u} alt="Uploaded screenshot" style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 7, border: `1px solid ${S.border}` }} />
                      <button type="button" aria-label="Remove screenshot" onClick={() => setShots((cur) => cur.filter((x) => x !== u))}
                        style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, padding: 0, borderRadius: 999, border: 'none', background: S.danger, color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, cursor: 'pointer' }} data-testid="toggle-ai-images">
              <input type="checkbox" checked={aiImages} onChange={(e) => setAiImages(e.currentTarget.checked)} style={{ marginTop: 2 }} />
              <span style={{ fontSize: 12.5, color: S.sub, lineHeight: 1.5 }}>
                <strong style={{ color: S.text, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Sparkles size={11} /> Generate scene images with AI</strong><br />
                Off by default. Only used when there are no uploaded or scraped screenshots; prompts are grounded in your real product facts.
              </span>
            </label>

            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 }} htmlFor="input-new-script">Script / Narration (optional)</label>
            <textarea
              id="input-new-script"
              value={userScript}
              onChange={(e) => setUserScript(e.currentTarget.value)}
              maxLength={2000}
              rows={5}
              placeholder="Paste your narration script here — the video will be timed to match it"
              className="ps-input"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13.5, lineHeight: 1.5, resize: 'vertical' }}
              data-testid="input-new-script"
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, margin: '5px 0 12px', fontSize: 11, color: S.muted }}>
              <span>Up to ~2,000 characters</span>
              <span>{userScript.length}/2000</span>
            </div>

            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 }}>Voice Track (optional)</label>
            <div style={{ borderRadius: 10, border: `1px dashed ${S.border}`, background: S.card, padding: 10, marginBottom: 12 }}>
              <label className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, border: `1px solid ${S.border}`, background: S.panelStrong, color: S.sub, cursor: transcribingVoice || uploadingVoice ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700, opacity: transcribingVoice || uploadingVoice ? 0.65 : 1 }} data-testid="button-upload-voice-track">
                {transcribingVoice || uploadingVoice ? <Loader2 size={12} className="rc-spin" /> : <AudioLines size={12} />}
                {transcribingVoice ? 'Transcribing…' : uploadingVoice ? 'Uploading…' : voiceTrackUrl ? 'Replace voice track' : 'Upload voice track'}
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.webm"
                  disabled={transcribingVoice || uploadingVoice}
                  style={{ display: 'none' }}
                  onChange={(e) => { void onVoiceFile(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ''; }}
                  data-testid="input-new-voice-track"
                />
              </label>
              {transcribingVoice ? (
                <p role="status" style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: S.brand }} data-testid="status-transcribing-voice">
                  <Loader2 size={11} className="rc-spin" /> Transcribing your voice track…
                </p>
              ) : null}
              {voiceTrackUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '7px 9px', borderRadius: 8, border: `1px solid ${S.border}`, background: S.panelStrong }}>
                  <AudioLines size={12} color="var(--space-text-brand)" />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{voiceTrackName}</span>
                  <button type="button" onClick={clearVoiceTrack} aria-label="Remove voice track" style={{ display: 'inline-flex', padding: 4, border: 'none', background: 'transparent', color: S.danger, cursor: 'pointer' }}><X size={12} /></button>
                </div>
              ) : null}
              <p style={{ margin: '7px 0 0', fontSize: 11.5, color: S.muted, lineHeight: 1.5 }}>
                We'll transcribe your voice and sync the motion to it
              </p>
            </div>

            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 }} htmlFor="input-launch-sfx">
              Sound effects (optional)
            </label>
            <textarea
              id="input-launch-sfx"
              value={launchSfx}
              onChange={(e) => setLaunchSfx(e.currentTarget.value)}
              rows={2}
              maxLength={600}
              placeholder="Leave empty to skip. Or describe the effects you want, e.g. a soft whoosh on each scene change and a bright chime on the logo."
              className="ps-input"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }}
              data-testid="input-new-sfx"
            />
            <p style={{ margin: '5px 0 12px', fontSize: 11, color: S.muted, lineHeight: 1.5 }}>
              Optional. ElevenLabs generates them and lays them under your film in the sound step once it has rendered.
            </p>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, cursor: 'pointer' }} data-testid="toggle-new-captions">
              <input type="checkbox" checked={launchCaptions} onChange={(e) => setLaunchCaptions(e.currentTarget.checked)} style={{ marginTop: 2 }} />
              <span style={{ fontSize: 12.5, color: S.sub, lineHeight: 1.5 }}>
                <strong style={{ color: S.text, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Sparkles size={11} /> Add captions (optional)</strong><br />
                Off by default. Burns captions into the film and gives you a .SRT caption file to download beside it.
              </span>
            </label>
            {error ? <p style={{ margin: '0 0 10px', fontSize: 12.5, color: S.danger }}>{error}</p> : null}
            </>
            )}
            </div>

            {/* Fixed footer — the primary CTA is always visible, even at a 768px-tall viewport. */}
            <div style={{ flexShrink: 0, display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 22px 16px', borderTop: `1px solid ${S.border}` }} data-testid="dialog-create-footer">
              {styleChoice !== 'hyperframes' ? (
                <>
                  <button type="button" onClick={() => setShowCreate(false)} className="ps-btn" style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${S.border}`, background: 'transparent', color: S.sub, cursor: 'pointer', fontSize: 13, fontWeight: 600 }} data-testid="button-clip-cancel">Cancel</button>
                  <button type="button" onClick={() => { setShowCreate(false); onStartWizard(styleChoice); }} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }} data-testid="button-clip-start">
                    <Sparkles size={13} /> Start {VIDEO_STYLES.find((s) => s.id === styleChoice)?.name}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setShowCreate(false)} className="ps-btn" style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${S.border}`, background: 'transparent', color: S.sub, cursor: 'pointer', fontSize: 13, fontWeight: 600 }} data-testid="button-create-cancel">Cancel</button>
                  <button type="button" onClick={() => void createProject()} disabled={creating || transcribingVoice || uploadingVoice} className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: creating || transcribingVoice || uploadingVoice ? 0.6 : 1 }} data-testid="button-create-confirm">
                    {creating ? 'Creating…' : 'Create video'}
                    {!creating && userScript.trim() ? <span style={{ padding: '2px 6px', borderRadius: 999, background: 'color-mix(in srgb, var(--space-text-on-primary) 18%, transparent)', fontSize: 9.5, fontWeight: 800 }} data-testid="badge-script-synced">Script-synced</span> : null}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
