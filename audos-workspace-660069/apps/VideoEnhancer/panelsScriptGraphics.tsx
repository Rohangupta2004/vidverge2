/**
 * Video Enhancer — Script Graphics tab.
 *
 * Paste a script → gpt-5.6-terra (workspace AI proxy) splits it into timed
 * scenes → preview the detected scenes and overlay types → render title
 * cards / lower-thirds / callouts on top of the base video through the
 * existing Remotion pipeline. Every render is persisted to the account-owned
 * `video_enhancements` table (renderStore) the moment it is submitted, so a
 * closed tab never orphans it — the app resumes the poll on next mount and
 * the finished MP4 shows up in the Export tab's render library.
 * The base video is the one already uploaded to the app, a fresh upload
 * from this tab, or a pasted video URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Check, Clapperboard, Download, Film, Link2, Loader2, RefreshCw, UploadCloud, Wand2,
} from 'lucide-react';
import { MAX_UPLOAD_BYTES, formatTime, uploadVideo } from './enhancerCore';
import { ScriptScene, clampScenesToDuration, parseScriptScenes, probeVideoDuration, submitScriptGraphicsRender } from './scriptGraphics';
import {
  RENDER_POLL_BUDGET_MS, fetchRenderRows, insertRenderRow, pollRenderToOutcome,
  renderKind, updateRenderRow, veSessionId,
} from './renderStore';
import { createEnhancerJob, updateEnhancerJob } from './jobStore';
import MusicSection from './musicGen';
import { card } from './uiControls';

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

const FPS = 30;
const MAX_FRAMES = 18000;

const TYPE_LABEL: Record<ScriptScene['type'], string> = {
  title: 'Title card',
  lowerthird: 'Lower-third',
  callout: 'Callout',
  none: 'No overlay',
};

const TYPE_COLOR: Record<ScriptScene['type'], string> = {
  title: 'var(--space-brand-primary-500)',
  lowerthird: 'var(--space-semantic-success-500)',
  callout: 'var(--space-brand-highlight-500)',
  none: 'var(--space-border-strong)',
};

const inputStyle = {
  width: '100%', fontSize: 13, background: 'var(--space-surface-card)',
  border: '1px solid var(--space-border-default)', borderRadius: 10,
  padding: '9px 12px', color: 'var(--space-text-primary)',
} as const;

/**
 * The tab's working state is mirrored to localStorage so a full page reload,
 * an app remount, or the browser discarding a background tab restores it
 * exactly — script, detected scenes, base video and last result included.
 */
const SG_SNAPSHOT_KEY = 've-script-graphics-v1';

interface SgSnapshot {
  script?: string;
  scenes?: ScriptScene[];
  urlInput?: string;
  pickedUrl?: string;
  pickedName?: string;
  resultUrl?: string;
  updatedAt?: number;
}

function readSgSnapshot(): SgSnapshot {
  try {
    const raw = window.localStorage.getItem(SG_SNAPSHOT_KEY);
    const snap = raw ? JSON.parse(raw) as SgSnapshot : null;
    return snap && typeof snap === 'object' ? snap : {};
  } catch { return {}; }
}

export default function ScriptGraphicsPanel({ appVideoUrl, appVideoName, appDurationSec, captionText, accountUserId, appJobRowId, onJobState }: {
  /** Stored URL of the video uploaded through the main dropzone ('' when none). */
  appVideoUrl: string;
  /** File name of that video ('' when none). */
  appVideoName: string;
  /** Its duration in seconds (null when unknown). */
  appDurationSec: number | null;
  /** The caption field is the canonical Script Graphics input. */
  captionText: string;
  accountUserId: string;
  appJobRowId: number | null;
  onJobState: (state: { rowId?: number; status: 'uploading' | 'processing' | 'done' | 'error'; progress: number; resultUrl?: string }) => void;
}) {
  const snapRef = useRef<SgSnapshot>(readSgSnapshot());
  const [script, setScript] = useState(() => snapRef.current.script || '');
  const autoCaptionRef = useRef('');
  const [urlInput, setUrlInput] = useState(() => snapRef.current.urlInput || '');
  const [pickedUrl, setPickedUrl] = useState(() => snapRef.current.pickedUrl || '');
  const [pickedName, setPickedName] = useState(() => snapRef.current.pickedName || '');
  const [uploading, setUploading] = useState(false);
  const [sourceErr, setSourceErr] = useState('');

  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState('');
  const [scenes, setScenes] = useState<ScriptScene[] | null>(() => {
    // Restored snapshots can carry scenes written by an older schema — sanitize
    // so the scene list and overlay badges never render from malformed data.
    const raw = Array.isArray(snapRef.current.scenes) ? snapRef.current.scenes : [];
    const valid = raw.filter((s): s is ScriptScene => !!s && typeof s === 'object'
      && Number.isFinite(Number(s.startSec)) && Number.isFinite(Number(s.endSec))
      && typeof s.title === 'string'
      && (s.type === 'title' || s.type === 'lowerthird' || s.type === 'callout' || s.type === 'none')
      && (s.pos === 'left' || s.pos === 'center' || s.pos === 'right'));
    return valid.length ? valid : null;
  });
  const [durationSec, setDurationSec] = useState<number | null>(null);

  const [rendering, setRendering] = useState(false);
  const [renderErr, setRenderErr] = useState('');
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState(() => snapRef.current.resultUrl || '');
  const [standaloneJobRowId, setStandaloneJobRowId] = useState<number | null>(null);

  // A caption entered or generated elsewhere in the editor is automatically
  // the Script Graphics script. Users can still refine it here, but never
  // have to paste the same words a second time.
  useEffect(() => {
    const next = captionText.trim();
    if (!next || next === autoCaptionRef.current) return;
    autoCaptionRef.current = next;
    setScript(next);
    setScenes(null);
    setParseErr('');
  }, [captionText]);

  // Stops all state updates (and the poll loop) once the tab unmounts — the
  // persisted row lets the app resume the poll on its next mount.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Persist the working state (see SG_SNAPSHOT_KEY above).
  useEffect(() => {
    try {
      window.localStorage.setItem(SG_SNAPSHOT_KEY, JSON.stringify({
        script, scenes: scenes || undefined, urlInput, pickedUrl, pickedName, resultUrl, updatedAt: Date.now(),
      }));
    } catch { /* localStorage unavailable — the DB rows still cover renders */ }
  }, [script, scenes, urlInput, pickedUrl, pickedName, resultUrl]);

  // ON MOUNT: reattach to any script-graphics render still in flight
  // (submitted before a tab switch, app remount or page reload), and surface
  // the most recent finished one. The operation id lives in the DB row, so a
  // remount never orphans a render — the progress bar and result come back.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await fetchRenderRows();
      if (cancelled || !aliveRef.current) return;
      const uid = veSessionId();
      const mine = rows.filter((r) => renderKind(r) === 'script-graphics' && (!uid || !r.user_id || r.user_id === uid));
      const inFlight = mine.find((r) => r.status === 'processing' && r.op_id);
      if (inFlight && inFlight.op_id) {
        const createdMs = inFlight.created_at ? new Date(inFlight.created_at).getTime() : NaN;
        const startedAt = Number.isFinite(createdMs) ? createdMs : Date.now();
        if (Date.now() - startedAt > RENDER_POLL_BUDGET_MS) {
          // Older than any render can still be alive — close it out.
          void updateRenderRow(inFlight.id, { status: 'failed', error_message: 'The render timed out — try again.' });
        } else {
          setRendering(true); setRenderErr('');
          setProgress(Math.min(92, Math.max(10, Number(inFlight.progress) || 10)));
          const outcome = await pollRenderToOutcome(inFlight.op_id, inFlight.id, startedAt, {
            isAlive: () => aliveRef.current,
            onTick: (info) => setProgress(info.progress),
          });
          if (!outcome || !aliveRef.current) return;
          setRendering(false);
          if (outcome.status === 'completed' && outcome.url) { setProgress(100); setResultUrl(outcome.url); }
          else setRenderErr(outcome.error || 'Render failed.');
          return;
        }
      }
      // No render in flight: show the newest finished result so returning to
      // this tab never looks like the work was lost.
      const done = mine.find((r) => r.status === 'completed' && r.output_url);
      if (done && done.output_url) setResultUrl((cur) => cur || (done.output_url as string));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseVideoUrl = urlInput.trim() || pickedUrl || appVideoUrl;
  const baseVideoLabel = urlInput.trim()
    ? 'Pasted URL'
    : pickedUrl
      ? (pickedName || 'Uploaded video')
      : (appVideoName || 'Video from this session');

  const pickFile = useCallback(async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) { setSourceErr('Please choose a video file (MP4, WebM or MOV).'); return; }
    if (f.size > MAX_UPLOAD_BYTES) { setSourceErr('That file is over 50 MB — trim or compress it first.'); return; }
    setSourceErr(''); setUploading(true);
    onJobState({ status: 'uploading', progress: 10 });
    let jobId: number | null = null;
    try {
      if (!accountUserId) throw new Error('Your account is still loading — try again in a moment.');
      const job = await createEnhancerJob(accountUserId);
      jobId = job.id;
      setStandaloneJobRowId(job.id);
      onJobState({ rowId: job.id, status: 'uploading', progress: 18 });
      const up = await uploadVideo(f);
      await updateEnhancerJob(job.id, {
        status: 'processing', video_url: up.url, caption_text: script.trim(), result_url: null,
      });
      onJobState({ rowId: job.id, status: 'processing', progress: 48 });
      if (!aliveRef.current) return;
      setPickedUrl(up.url); setPickedName(f.name); setUrlInput('');
    } catch (e) {
      if (jobId) void updateEnhancerJob(jobId, { status: 'error' }).catch(() => undefined);
      onJobState({ ...(jobId ? { rowId: jobId } : {}), status: 'error', progress: 100 });
      if (aliveRef.current) setSourceErr(msg(e));
    }
    if (aliveRef.current) setUploading(false);
  }, [accountUserId, script, onJobState]);

  const generate = useCallback(async () => {
    if (parsing) return;
    setParseErr(''); setScenes(null); setResultUrl(''); setRenderErr('');
    if (!script.trim()) { setParseErr('Paste your video script first.'); return; }
    setParsing(true);
    // Time estimates are better when the AI knows the real video length.
    let dur: number | null = null;
    if (appVideoUrl && baseVideoUrl === appVideoUrl && appDurationSec && appDurationSec > 0) dur = appDurationSec;
    else if (baseVideoUrl) dur = await probeVideoDuration(baseVideoUrl);
    if (!aliveRef.current) return;
    setDurationSec(dur);
    try {
      const parsed = await parseScriptScenes(script, dur);
      if (!aliveRef.current) return;
      if (!parsed.length) throw new Error('No scenes could be detected — add scene headings or more detail, then try again.');
      setScenes(parsed);
    } catch (e) {
      if (aliveRef.current) setParseErr(msg(e));
    }
    if (aliveRef.current) setParsing(false);
  }, [parsing, script, baseVideoUrl, appVideoUrl, appDurationSec]);

  const render = useCallback(async () => {
    if (rendering || !scenes || !scenes.length) return;
    if (!baseVideoUrl) { setRenderErr('Add a base video first — upload one above or paste a video URL.'); return; }
    let enhancerJobId = standaloneJobRowId || appJobRowId;
    setRendering(true); setRenderErr(''); setResultUrl(''); setProgress(4);
    onJobState({ ...(enhancerJobId ? { rowId: enhancerJobId } : {}), status: 'processing', progress: 6 });
    try {
      if (!enhancerJobId) {
        if (!accountUserId) throw new Error('Your account is still loading — try again in a moment.');
        const job = await createEnhancerJob(accountUserId);
        enhancerJobId = job.id;
        setStandaloneJobRowId(job.id);
        onJobState({ rowId: job.id, status: 'processing', progress: 8 });
      }
      await updateEnhancerJob(enhancerJobId, {
        status: 'processing', video_url: baseVideoUrl, caption_text: script.trim(), result_url: null,
      });
      // The render must never overrun the real video: asking Remotion for
      // frames past the source's end fails the whole render server-side. Probe
      // the duration when it is still unknown and clamp scenes + frame count.
      let dur = durationSec;
      if (!dur || dur <= 0) {
        dur = await probeVideoDuration(baseVideoUrl);
        if (!aliveRef.current) return;
        if (dur && dur > 0) setDurationSec(dur);
      }
      const scenesForRender = dur && dur > 0 ? clampScenesToDuration(scenes, dur) : scenes;
      if (!scenesForRender.length) throw new Error('The detected scenes fall outside this video’s length — regenerate the graphics with the base video loaded.');
      const totalSec = dur && dur > 0 ? dur : Math.max(...scenesForRender.map((s) => s.endSec));
      const frames = Math.min(MAX_FRAMES, Math.max(FPS, Math.ceil(totalSec * FPS)));
      const opId = await submitScriptGraphicsRender(scenesForRender, baseVideoUrl, frames);
      if (!aliveRef.current) return;
      setProgress(10);
      // Persist immediately so the render survives a tab switch or reload.
      const rowId = await insertRenderRow({
        status: 'processing',
        op_id: opId,
        progress: 10,
        title: 'Script graphics — ' + baseVideoLabel,
        user_id: veSessionId() || null,
        input_params: { kind: 'script-graphics', enhancerJobId, sceneCount: scenesForRender.length, baseVideoUrl },
      });
      const outcome = await pollRenderToOutcome(opId, rowId, Date.now(), {
        isAlive: () => aliveRef.current,
        onTick: (info) => {
          setProgress(info.progress);
          onJobState({ rowId: enhancerJobId as number, status: 'processing', progress: info.progress });
        },
      });
      if (!outcome || !aliveRef.current) return;
      if (outcome.status === 'completed' && outcome.url) {
        await updateEnhancerJob(enhancerJobId, { status: 'done', result_url: outcome.url, caption_text: script.trim() });
        onJobState({ rowId: enhancerJobId as number, status: 'done', progress: 100, resultUrl: outcome.url });
        setProgress(100); setResultUrl(outcome.url); setRendering(false);
        return;
      }
      throw new Error(outcome.error || 'Render failed.');
    } catch (e) {
      void updateEnhancerJob(enhancerJobId, { status: 'error', caption_text: script.trim() }).catch(() => undefined);
      onJobState({ ...(enhancerJobId ? { rowId: enhancerJobId } : {}), status: 'error', progress: 100 });
      if (aliveRef.current) { setRenderErr(msg(e)); setRendering(false); setProgress(0); }
    }
  }, [rendering, scenes, baseVideoUrl, baseVideoLabel, durationSec, standaloneJobRowId, appJobRowId, script, accountUserId, onJobState]);

  const busy = parsing || uploading || rendering;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Intro */}
      <div style={{ ...card, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Clapperboard size={16} style={{ color: 'var(--space-text-brand)' }} />
          <span style={{ fontSize: 14, fontWeight: 800 }}>Script Graphics</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--space-text-muted)', lineHeight: 1.5 }}>
          Your caption automatically becomes the script. AI plans a graphic for every scene — title cards, lower-thirds and callouts — then renders them on top of your video.
        </div>
      </div>

      {/* Base video source */}
      <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Base video</div>
        {baseVideoUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--space-text-secondary)', background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '6px 10px', marginBottom: 8, minWidth: 0 }}>
            <Film size={13} style={{ flexShrink: 0, color: 'var(--space-semantic-success-600)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseVideoLabel}</span>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginBottom: 8 }}>
            No video yet — upload one here (or in the main drop zone), or paste a video URL below.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="ve-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--space-text-secondary)', background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 10, padding: '7px 11px', cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
            <input type="file" accept="video/mp4,video/webm,video/quicktime" style={{ display: 'none' }} disabled={uploading} onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
            {uploading ? 'Uploading…' : 'Upload video'}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 180 }}>
            <Link2 size={13} style={{ flexShrink: 0, color: 'var(--space-text-muted)' }} />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="…or paste a video URL (https://…/video.mp4)"
              className="ve-input"
              style={inputStyle}
            />
          </div>
        </div>
        {sourceErr && <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><AlertCircle size={13} /> {sourceErr}</div>}
      </div>

      {/* Script input + Generate */}
      <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Script from captions</div>
          <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginBottom: 7 }}>Automatically synced from your caption field. Edit here only if you want a script-specific variation.</div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={9}
            placeholder={'INTRO\nWelcome — today we cover the three moves that fix your jump shot…\n\nSCENE 2 — The problem\nMost players grip the ball too tight…'}
            className="ve-input"
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
        </label>
        <button
          onClick={() => { void generate(); }}
          disabled={busy || !script.trim()}
          className="ve-btn"
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10,
            fontSize: 13.5, fontWeight: 700, padding: '10px 14px', borderRadius: 10, border: 'none',
            cursor: busy || !script.trim() ? 'not-allowed' : 'pointer',
            background: busy || !script.trim() ? 'var(--space-surface-panel-strong)' : 'var(--space-brand-primary-600)',
            color: busy || !script.trim() ? 'var(--space-text-muted)' : '#fff',
          }}
        >
          {parsing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {parsing ? 'Analyzing your script…' : 'Generate Graphics'}
        </button>
        {parseErr && <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><AlertCircle size={13} /> {parseErr}</div>}
      </div>

      {/* Detected scenes preview */}
      {scenes && scenes.length > 0 && (
        <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Detected scenes ({scenes.length})</div>
          <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginBottom: 8 }}>
            {durationSec && durationSec > 0
              ? 'Timed against your ' + formatTime(durationSec) + ' video.'
              : 'Times are estimated from the script — load the base video for exact timing.'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scenes.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 10, padding: '8px 10px' }}>
                <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--space-text-muted)', flexShrink: 0, paddingTop: 2 }}>
                  {formatTime(s.startSec)}–{formatTime(s.endSec)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
                  {s.body && <div style={{ fontSize: 12, color: 'var(--space-text-secondary)', marginTop: 2 }}>{s.body}</div>}
                  {s.type !== 'none' && <div style={{ fontSize: 10.5, color: 'var(--space-text-muted)', marginTop: 2 }}>bottom-{s.pos}</div>}
                </div>
                <span style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 0,
                  padding: '3px 8px', borderRadius: 999,
                  border: '1px solid ' + TYPE_COLOR[s.type],
                  background: 'color-mix(in srgb, ' + TYPE_COLOR[s.type] + ' 14%, transparent)',
                  color: s.type === 'none' ? 'var(--space-text-muted)' : 'var(--space-text-primary)',
                }}>
                  {TYPE_LABEL[s.type]}
                </span>
              </div>
            ))}
          </div>

          {/* Render */}
          <button
            onClick={() => { void render(); }}
            disabled={rendering || !baseVideoUrl}
            className="ve-btn"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10,
              fontSize: 13.5, fontWeight: 700, padding: '11px 14px', borderRadius: 10, border: 'none',
              cursor: rendering || !baseVideoUrl ? 'not-allowed' : 'pointer',
              background: rendering || !baseVideoUrl ? 'var(--space-surface-panel-strong)' : 'var(--space-brand-primary-600)',
              color: rendering || !baseVideoUrl ? 'var(--space-text-muted)' : '#fff',
              boxShadow: rendering || !baseVideoUrl ? 'none' : '0 10px 26px -12px color-mix(in srgb, var(--space-brand-primary-600) 85%, transparent)',
            }}
          >
            {rendering ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
            {rendering ? 'Rendering…' : 'Render graphics on video'}
          </button>
          {!baseVideoUrl && <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 6 }}>Add a base video above to render these graphics onto it.</div>}

          {rendering && (
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--space-surface-panel-strong)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: progress + '%', background: 'var(--space-brand-primary-600)', borderRadius: 999, transition: 'width .4s ease' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 6 }}>Rendering your script graphics… this usually takes a few minutes. It's saved to the Export tab's render library, so it keeps going even if you switch tabs.</div>
            </div>
          )}

          {renderErr && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {renderErr}
              </div>
              <button onClick={() => { void render(); }} className="ve-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--space-text-secondary)', background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', marginTop: 8 }}>
                <RefreshCw size={13} /> Try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {resultUrl && (
        <div style={{ ...card, borderColor: 'color-mix(in srgb, var(--space-semantic-success-500) 45%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Check size={16} style={{ color: 'var(--space-semantic-success-600)' }} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>Script graphics rendered</span>
            <a href={resultUrl} target="_blank" rel="noreferrer" download className="ve-btn" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--space-brand-primary-600)', borderRadius: 10, padding: '8px 14px', textDecoration: 'none', boxShadow: '0 8px 20px -10px color-mix(in srgb, var(--space-brand-primary-600) 80%, transparent)' }}>
              <Download size={14} /> Download MP4
            </a>
          </div>
          <video src={resultUrl} controls playsInline style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 380 }} />
          <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>Also saved to the Export tab's render library.</div>
          <MusicSection script={script} durationSec={durationSec} />
        </div>
      )}
    </div>
  );
}
