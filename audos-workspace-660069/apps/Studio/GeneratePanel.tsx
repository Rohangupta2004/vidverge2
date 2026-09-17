/**
 * VidVerge Studio — the generate flow.
 *
 * Submits the built scene list through lib/reelioStudio.submitVideo() (which
 * stamps the visitor's session on the video_jobs row via the X-Session-Id
 * header AND a redundant body.session_id copy), then polls the
 * check-video-status hook every 10s with the returned job_id.
 *
 * AUDIO: multi-scene videos come back from the platform stitcher without
 * sound (known platform bug). When the hook reports audio:"pending" with the
 * raw clip URLs, this panel runs the same in-browser lossless remux the chat
 * progress card uses (lib/client-stitch.ts) and attaches the full-audio MP4
 * back to the job — so the player and Download button always end on the
 * version with sound.
 *
 * Errors never blank the flow: a failed submit or render shows a plain
 * message with Retry (same inputs, new job) and "Edit inputs" back to the form.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Music,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  scopedSpaceId,
  spaceId as rawSpaceId,
  studioSessionId,
  submitVideo,
} from '../../lib/reelioStudio';
import type { SubmitVideoInput } from '../../lib/reelioStudio';
import { remuxAndAttachAudio } from '../../lib/client-stitch';

const POLL_MS = 10000;

type Phase = 'submitting' | 'generating' | 'stitching' | 'finishing-audio' | 'ready' | 'failed';

const ROTATING_LINES = [
  'Setting up your scenes…',
  'Casting the shots…',
  'Rolling camera on scene one…',
  'Keeping everything consistent shot to shot…',
  'Recording dialogue and ambience…',
  'Rendering the last few frames…',
];

function elapsedLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

interface StatusSnapshot {
  stage: 'generating' | 'stitching' | 'ready' | 'failed';
  progress: number;
  downloadUrl?: string;
  audio: 'ready' | 'pending' | 'none';
  clipUrls?: string[];
  workspaceUuid?: string;
  userMessage?: string;
  error?: string;
}

async function pollStatus(jobId: string): Promise<StatusSnapshot | null> {
  const sessionId = studioSessionId();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['X-Session-Id'] = sessionId;
  try {
    const res = await fetch(`/api/hooks/execute/${scopedSpaceId()}/check-video-status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ job_id: jobId }),
    });
    const data = await res.json().catch(() => null);
    if (!data) return null;
    const raw = typeof data.stage === 'string' ? data.stage : '';
    const stage: StatusSnapshot['stage'] =
      raw === 'ready' || raw === 'failed' || raw === 'stitching' || raw === 'generating'
        ? raw
        : data.status === 'completed'
          ? 'ready'
          : data.status === 'failed'
            ? 'failed'
            : 'generating';
    return {
      stage,
      progress: typeof data.progress === 'number' ? Math.max(0, Math.min(100, data.progress)) : 0,
      downloadUrl: typeof data.download_url === 'string' ? data.download_url : undefined,
      audio: data.audio === 'pending' ? 'pending' : data.audio === 'none' ? 'none' : 'ready',
      clipUrls: Array.isArray(data.clip_urls)
        ? data.clip_urls.filter((u: unknown): u is string => typeof u === 'string' && !!u)
        : undefined,
      workspaceUuid: typeof data.workspace_uuid === 'string' ? data.workspace_uuid : undefined,
      userMessage: typeof data.user_message === 'string' ? data.user_message : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
    };
  } catch {
    return null; // transient — next poll retries
  }
}

function friendlyError(error?: string): string {
  if (error && /lost by the video service|not found/i.test(error)) {
    return 'The video service dropped this render mid-job.';
  }
  if (error && /generation failed/i.test(error)) {
    return 'The video service stumbled on this render.';
  }
  return error || 'Something went wrong on that render.';
}

export default function GeneratePanel({
  payload,
  aspectRatio,
  onEdit,
  onDone,
}: {
  payload: SubmitVideoInput;
  aspectRatio: '16:9' | '9:16';
  /** Back to the form with all inputs intact. */
  onEdit: () => void;
  /** "Make another video" — reset to the type picker. */
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('submitting');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [audioNote, setAudioNote] = useState<'ok' | 'missing'>('ok');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0); // bump to retry
  const startedAtRef = useRef<number>(Date.now());
  const remuxTriedRef = useRef<string | null>(null);

  // Submit once per attempt, then poll until terminal.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setPhase('submitting');
    setError(null);
    setDownloadUrl(null);
    setProgress(0);
    setJobId(null);
    setAudioNote('ok');
    startedAtRef.current = Date.now();

    const tick = async (id: string) => {
      const status = await pollStatus(id);
      if (cancelled) return;
      if (status) {
        setProgress(status.progress);
        if (status.stage === 'failed') {
          setPhase('failed');
          setError(friendlyError(status.error));
          return;
        }
        if (status.stage === 'ready') {
          // Audio leg: rebuild the soundtrack in-browser once per job.
          if (
            status.audio === 'pending' &&
            status.clipUrls &&
            status.clipUrls.length >= 2 &&
            status.workspaceUuid &&
            remuxTriedRef.current !== id
          ) {
            remuxTriedRef.current = id;
            setPhase('finishing-audio');
            try {
              const url = await remuxAndAttachAudio({
                spaceId: rawSpaceId(),
                workspaceUuid: status.workspaceUuid,
                jobId: id,
                clipUrls: status.clipUrls,
                sessionId: studioSessionId(),
              });
              if (cancelled) return;
              setDownloadUrl(url);
              setPhase('ready');
              return;
            } catch (e) {
              console.warn('[VidVerge Studio] audio remux failed — keeping the fast cut:', e);
              if (cancelled) return;
              setAudioNote('missing');
            }
          } else if (status.audio === 'none') {
            setAudioNote('missing');
          }
          setDownloadUrl(status.downloadUrl || null);
          setPhase('ready');
          return;
        }
        setPhase(status.stage === 'stitching' ? 'stitching' : 'generating');
      }
      timer = window.setTimeout(() => void tick(id), POLL_MS);
    };

    void (async () => {
      const result = await submitVideo(payload);
      if (cancelled) return;
      if (!result.success || !result.jobId) {
        setPhase('failed');
        setError(result.error || 'Could not start the render. Try again in a moment.');
        return;
      }
      setJobId(result.jobId);
      setPhase('generating');
      timer = window.setTimeout(() => void tick(result.jobId!), 4000);
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Elapsed heartbeat while working.
  const working = phase === 'submitting' || phase === 'generating' || phase === 'stitching' || phase === 'finishing-audio';
  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [working]);

  const headline =
    phase === 'submitting'
      ? 'Scripting your scenes…'
      : phase === 'generating'
        ? 'Generating your video…'
        : phase === 'stitching'
          ? 'Putting the cut together…'
          : phase === 'finishing-audio'
            ? 'Finishing the sound…'
            : phase === 'ready'
              ? 'Your video is ready!'
              : "That render didn't make it";

  const subLine = working
    ? phase === 'finishing-audio'
      ? 'Attaching the soundtrack — a few more seconds.'
      : ROTATING_LINES[Math.floor(elapsed / 15) % ROTATING_LINES.length]
    : null;

  const steps: { label: string; state: 'done' | 'active' | 'todo' }[] = [
    { label: 'Scripting', state: phase === 'submitting' ? 'active' : 'done' },
    {
      label: 'Generating',
      state:
        phase === 'submitting' ? 'todo' : phase === 'generating' || phase === 'stitching' ? 'active' : 'done',
    },
    {
      label: 'Ready',
      state: phase === 'ready' ? 'done' : phase === 'finishing-audio' ? 'active' : 'todo',
    },
  ];

  const barWidth = phase === 'ready' ? 100 : phase === 'finishing-audio' ? 96 : Math.max(6, progress);

  return (
    <div
      style={{
        borderRadius: 18,
        border: '1px solid var(--space-border-default)',
        background: 'var(--space-surface-panel)',
        padding: 22,
      }}
      data-testid="generate-panel"
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ marginTop: 2 }}>
          {phase === 'ready' ? (
            <CheckCircle2 size={20} color="var(--space-semantic-success)" />
          ) : phase === 'failed' ? (
            <AlertTriangle size={20} color="var(--space-semantic-danger)" />
          ) : phase === 'finishing-audio' ? (
            <Music size={20} color="var(--space-text-brand)" className="rst-pulse" />
          ) : (
            <Loader2 size={20} color="var(--space-text-brand)" className="rst-spin" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: 'var(--space-text-primary)' }}>{headline}</p>
          {subLine && (
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--space-text-secondary)' }}>{subLine}</p>
          )}
        </div>
        {working && (
          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--space-text-muted)' }}>
            {elapsedLabel(elapsed)}
          </span>
        )}
      </div>

      {/* Progress */}
      {working && (
        <>
          <div style={{ marginTop: 16, height: 6, borderRadius: 999, overflow: 'hidden', background: 'rgba(0,0,0,0.4)' }}>
            <div
              style={{
                height: '100%',
                width: `${barWidth}%`,
                borderRadius: 999,
                background: 'linear-gradient(90deg, var(--space-brand-primary-600), var(--space-brand-primary-500))',
                transition: 'width .7s ease',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
            {steps.map((s) => (
              <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: s.state === 'todo' ? 'var(--space-text-muted)' : s.state === 'active' ? 'var(--space-text-brand)' : 'var(--space-semantic-success)' }}>
                {s.state === 'done' ? <CheckCircle2 size={12} /> : s.state === 'active' ? <Loader2 size={12} className="rst-spin" /> : <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor', opacity: 0.5 }} />}
                {s.label}
              </span>
            ))}
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--space-text-muted)' }}>
            Usually ready in 2–6 minutes. You can keep this open or check My Videos later — the render keeps going either way.
          </p>
        </>
      )}

      {/* Ready */}
      {phase === 'ready' && (
        <div style={{ marginTop: 18 }}>
          {downloadUrl ? (
            <div
              style={{
                borderRadius: 14,
                overflow: 'hidden',
                background: '#000',
                border: '1px solid var(--space-border-default)',
                maxWidth: aspectRatio === '9:16' ? 300 : 560,
                margin: '0 auto',
              }}
            >
              <video
                src={downloadUrl}
                controls
                playsInline
                preload="metadata"
                style={{ display: 'block', width: '100%', aspectRatio: aspectRatio === '9:16' ? '9 / 16' : '16 / 9', objectFit: 'contain', background: '#000' }}
                data-testid="video-result-player"
              />
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--space-text-secondary)' }}>
              The render finished — find it in My Videos.
            </p>
          )}
          {audioNote === 'missing' && (
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--space-text-secondary)', textAlign: 'center' }}>
              Heads up: the soundtrack couldn't be attached to this one — the video is still good to post if silence works for it.
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '11px 20px',
                  borderRadius: 11,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: 'var(--space-text-on-primary)',
                  textDecoration: 'none',
                  background: 'var(--space-brand-primary)',
                  boxShadow: '0 8px 24px rgba(124,58,237,0.35)',
                }}
                data-testid="button-download-video"
              >
                <Download size={15} /> Download MP4
              </a>
            )}
            <button
              type="button"
              onClick={onDone}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '11px 18px',
                borderRadius: 11,
                fontSize: 13.5,
                fontWeight: 600,
                color: 'var(--space-text-primary)',
                border: '1px solid var(--space-border-strong)',
                background: 'transparent',
                cursor: 'pointer',
              }}
              data-testid="button-make-another"
            >
              <Sparkles size={15} /> Make another video
            </button>
          </div>
        </div>
      )}

      {/* Failed */}
      {phase === 'failed' && (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--space-text-secondary)', lineHeight: 1.55 }}>
            {error || 'Something went wrong.'} Nothing you entered was lost — you can retry the exact same video, or step back and adjust the inputs.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 11,
                fontSize: 13.5,
                fontWeight: 600,
                color: 'var(--space-text-on-primary)',
                border: 'none',
                cursor: 'pointer',
                background: 'var(--space-brand-primary)',
              }}
              data-testid="button-retry-render"
            >
              <RefreshCw size={15} /> Retry
            </button>
            <button
              type="button"
              onClick={onEdit}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderRadius: 11,
                fontSize: 13.5,
                fontWeight: 500,
                color: 'var(--space-text-secondary)',
                border: '1px solid var(--space-border-default)',
                background: 'transparent',
                cursor: 'pointer',
              }}
              data-testid="button-edit-inputs"
            >
              <ArrowLeft size={15} /> Edit inputs
            </button>
          </div>
        </div>
      )}

      {jobId && working && (
        <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--space-text-muted)' }}>Job {jobId}</p>
      )}
    </div>
  );
}
