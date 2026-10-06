/**
 * VFX DROP — upload a clip, describe an addition, get the composited shot back.
 *
 * The creator writes a short idea in their own words. A fast text model expands
 * it into a cinematic VFX instruction, which remains visible before generation.
 * The video pipeline, metering, segmented continuity and download behavior live
 * in ./vfxClient.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Download, Film, Loader2, RefreshCw, Sparkles, Upload, Wand2, X,
} from 'lucide-react';
import {
  LightBeamButton, LightBeamError, LightBeamProgress, colors,
} from '../../components/design-system/index';
import { isInsufficientCreditsError } from '../../lib/credits';
import { buildVfxPrompt, promptSlug } from './effects';
import {
  MAX_SOURCE_SECONDS, MAX_UPLOAD_BYTES, OMNI_MODEL, OUTPUT_SECONDS, aspectRatioFor,
  downloadVideo, formatBytes, isVideoFile, renderVfx, uploadSourceVideo, vfxCreditCost,
  vfxSegmentCount, videoMimeTypeFor,
} from './vfxClient';
import type { SegmentProgress, VfxAspect } from './vfxClient';

type Stage = 'upload' | 'compose' | 'working' | 'done' | 'failed';
type WorkPhase = 'upload' | 'render';
type UploadState = 'idle' | 'uploading' | 'ready' | 'failed';

const PROMPT_MODEL = 'gpt-4o-mini';
const WORKING_LINES = [
  'Analyzing your scene…',
  'Locking your face, pose and movement…',
  'Compositing the new elements…',
  'Matching light, depth and motion…',
  'Rendering the VFX layer…',
  'Finalizing…',
];

const CSS = `
.vfx-root { color: ${colors.textPrimary}; font-family: inherit; min-height: 100%; }
.vfx-wrap { max-width: 760px; margin: 0 auto; padding: 20px 16px 34px; }
.vfx-kicker { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: ${colors.beamPrimary}; font-weight: 700; }
.vfx-h1 { font-size: clamp(24px, 5vw, 34px); font-weight: 750; letter-spacing: -0.035em; line-height: 1.08; margin: 5px 0 8px; }
.vfx-sub { font-size: 14px; line-height: 1.58; color: ${colors.textSecondary}; margin: 0; max-width: 620px; }
.vfx-note { font-size: 12.5px; line-height: 1.5; color: ${colors.textSecondary}; }
.vfx-section-label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 700; color: ${colors.textPrimary}; }

.vfx-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  text-align: center; padding: 40px 20px; border-radius: 18px; cursor: pointer;
  border: 1.5px dashed rgba(245,185,54,0.34); background: rgba(255,255,255,0.025);
  transition: border-color .18s ease, background .18s ease; min-height: 230px; }
.vfx-drop:hover, .vfx-drop.is-over { border-color: ${colors.beamPrimary}; background: color-mix(in srgb, ${colors.beamPrimary} 7%, transparent); }
.vfx-drop-icon { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, ${colors.beamPrimary} 14%, transparent); color: ${colors.beamPrimary}; }

.vfx-card { border: 1px solid ${colors.borderSubtle}; background: ${colors.bgGlass}; border-radius: 16px; padding: 14px; }
.vfx-strip { display: flex; align-items: center; gap: 12px; }
.vfx-thumb { width: 76px; height: 76px; flex: 0 0 76px; border-radius: 12px; overflow: hidden; background: #000;
  border: 1px solid ${colors.borderSubtle}; }
.vfx-thumb video { width: 100%; height: 100%; object-fit: contain; display: block; }

.vfx-field { margin-top: 18px; }
.vfx-textarea { width: 100%; min-height: 104px; resize: vertical; box-sizing: border-box; border-radius: 14px;
  padding: 14px 15px; color: ${colors.textPrimary}; background: rgba(0,0,0,.2); border: 1px solid ${colors.borderSubtle};
  font: inherit; font-size: 15px; line-height: 1.5; outline: none; transition: border-color .18s ease, box-shadow .18s ease; }
.vfx-textarea::placeholder { color: ${colors.textDim}; }
.vfx-textarea:focus { border-color: ${colors.beamPrimary}; box-shadow: 0 0 0 3px color-mix(in srgb, ${colors.beamPrimary} 13%, transparent); }
.vfx-field-actions { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }

.vfx-expanded { margin-top: 14px; border: 1px solid ${colors.borderSubtle}; background: ${colors.bgGlass}; border-radius: 14px; overflow: hidden; }
.vfx-expanded summary { cursor: pointer; list-style: none; min-height: 48px; padding: 0 14px; display: flex; align-items: center;
  justify-content: space-between; gap: 10px; font-size: 12.5px; font-weight: 700; color: ${colors.textSecondary}; }
.vfx-expanded summary::-webkit-details-marker { display: none; }
.vfx-expanded summary::after { content: '⌄'; font-size: 18px; transition: transform .18s ease; }
.vfx-expanded[open] summary::after { transform: rotate(180deg); }
.vfx-expanded-body { border-top: 1px solid ${colors.borderSubtle}; padding: 12px 14px 14px; }
.vfx-preview { width: 100%; min-height: 132px; resize: vertical; box-sizing: border-box; padding: 0; border: 0; outline: none;
  background: transparent; color: ${colors.textSecondary}; font: inherit; font-size: 13px; line-height: 1.58; }
.vfx-preview::placeholder { color: ${colors.textDim}; }

.vfx-generate { margin-top: 16px; }
.vfx-player-shell { width: 100%; display: flex; justify-content: center; }
.vfx-player { width: 100%; border-radius: 16px; overflow: hidden; background: #000; border: 1px solid ${colors.borderSubtle};
  max-height: 68vh; display: block; object-fit: contain; }
.vfx-player.is-vertical { max-width: 420px; aspect-ratio: 9 / 16; }
.vfx-player.is-horizontal { aspect-ratio: 16 / 9; }

.vfx-link { background: none; border: none; padding: 8px 4px; min-height: 44px; cursor: pointer; font-size: 13px;
  font-weight: 600; color: ${colors.textSecondary}; text-decoration: underline; text-underline-offset: 3px; }
.vfx-link:hover { color: ${colors.beamPrimary}; }
.vfx-warn { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.5;
  color: ${colors.warning}; background: color-mix(in srgb, ${colors.warning} 9%, transparent);
  border: 1px solid color-mix(in srgb, ${colors.warning} 30%, transparent); }
`;

function Header({ onReset, showReset }: { onReset: () => void; showReset: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div className="vfx-kicker">VFX Drop</div>
        <h1 className="vfx-h1">Add anything to your video with AI.</h1>
        <p className="vfx-sub">
          Drop your video and describe what should appear. AI expands your idea into a cinematic VFX prompt, then composites it into your real footage.
        </p>
      </div>
      {showReset ? (
        <button type="button" className="vfx-link" onClick={onReset} style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}>
          Start over
        </button>
      ) : null}
    </div>
  );
}

export default function VFXDropApp() {
  const [stage, setStage] = useState<Stage>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState('');
  const [meta, setMeta] = useState<{ seconds: number; width: number; height: number } | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [sourceUrl, setSourceUrl] = useState('');
  const [pickError, setPickError] = useState('');
  const [lengthNote, setLengthNote] = useState('');
  const [metaUnreadable, setMetaUnreadable] = useState(false);

  const [brief, setBrief] = useState('');
  const [expandedPrompt, setExpandedPrompt] = useState('');
  const [expandedFor, setExpandedFor] = useState('');
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState('');

  const [workPhase, setWorkPhase] = useState<WorkPhase>('upload');
  const [statusIndex, setStatusIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [segmentProgress, setSegmentProgress] = useState<SegmentProgress | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [renderedLabel, setRenderedLabel] = useState('');
  const [error, setError] = useState('');
  const [errorRun, setErrorRun] = useState(0);
  const [saving, setSaving] = useState(false);

  const cancelRef = useRef(false);
  const objectUrlRef = useRef('');
  const expandRequestRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const measuredSeconds = meta && Number.isFinite(meta.seconds) && meta.seconds > 0
    ? meta.seconds
    : OUTPUT_SECONDS;
  const lengthKnown = Boolean(meta) || metaUnreadable;
  const quotedSeconds = Math.min(MAX_SOURCE_SECONDS, measuredSeconds);
  const quotedCredits = vfxCreditCost(measuredSeconds);
  const quotedSegments = vfxSegmentCount(measuredSeconds);
  const aspectRatio: VfxAspect = aspectRatioFor(meta?.width, meta?.height);
  const playerClass = `vfx-player ${aspectRatio === '9:16' ? 'is-vertical' : 'is-horizontal'}`;

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  useEffect(() => {
    if (stage !== 'working' || workPhase !== 'render') return;
    setStatusIndex(0);
    const timer = setInterval(() => setStatusIndex((i) => (i + 1) % WORKING_LINES.length), 3600);
    return () => clearInterval(timer);
  }, [stage, workPhase]);

  const beginUpload = useCallback(async (picked: File) => {
    setUploadState('uploading');
    try {
      const url = await uploadSourceVideo(picked);
      setSourceUrl(url);
      setUploadState('ready');
    } catch (e: any) {
      setUploadState('failed');
      setPickError(String(e?.message || 'Your clip could not be uploaded.'));
    }
  }, []);

  const acceptFile = useCallback((picked: File | null | undefined) => {
    if (!picked) return;
    setPickError('');
    setLengthNote('');
    if (!isVideoFile(picked)) {
      setPickError('That file is not a video. Drop an MP4, MOV or WEBM clip.');
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setPickError(`This clip is ${formatBytes(picked.size)}. Uploads are capped at 50 MB — trim it or export at a lower bitrate, then try again.`);
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(picked);
    objectUrlRef.current = url;
    setFile(picked);
    setLocalUrl(url);
    setMeta(null);
    setMetaUnreadable(false);
    setSourceUrl('');
    setResultUrl('');
    setError('');
    setStage('compose');
    void beginUpload(picked);
  }, [beginUpload]);

  const expandBrief = useCallback(async (value: string): Promise<string> => {
    const short = value.trim();
    if (!short) return '';
    const requestId = ++expandRequestRef.current;
    setExpanding(true);
    setExpandError('');

    try {
      const token = (window as any).__workspaceDb?.token;
      if (!token) throw new Error('The workspace AI token is not available yet. Please try again.');
      const response = await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-DB-Token': token,
        },
        body: JSON.stringify({
          model: PROMPT_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a cinematic VFX prompt writer. Expand the creator’s short request into one precise video-compositing instruction. Add concrete details for placement, scale, timing, motion, depth, particles, lighting, shadows, reflections, atmospheric interaction and camera continuity when relevant. Treat the request as an addition to the existing footage, not a style transfer or a replacement scene. Preserve the original camera move, duration and composition. Return only the finished prompt as plain text, under 850 characters, with no heading, quotes or markdown.',
            },
            { role: 'user', content: short },
          ],
          max_tokens: 260,
          temperature: 0.65,
          stream: false,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = data?.error?.message || data?.error || `Prompt expansion failed (HTTP ${response.status}).`;
        throw new Error(String(detail));
      }
      const expanded = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!expanded) throw new Error('The prompt expander returned an empty suggestion. Please try again.');
      if (requestId !== expandRequestRef.current) return '';
      setExpandedPrompt(expanded);
      setExpandedFor(short);
      return expanded;
    } catch (e: any) {
      if (requestId === expandRequestRef.current) {
        setExpandedPrompt('');
        setExpandedFor('');
        setExpandError(String(e?.message || 'The prompt could not be expanded.'));
      }
      return '';
    } finally {
      if (requestId === expandRequestRef.current) setExpanding(false);
    }
  }, []);

  useEffect(() => {
    if (stage !== 'compose' || brief.trim().length < 3 || expandedFor === brief.trim()) return;
    const timer = setTimeout(() => { void expandBrief(brief); }, 750);
    return () => clearTimeout(timer);
  }, [brief, expandBrief, expandedFor, stage]);

  const changeBrief = (value: string) => {
    expandRequestRef.current += 1;
    setBrief(value);
    setExpandedPrompt('');
    setExpandedFor('');
    setExpandError('');
    setExpanding(false);
  };

  const reset = useCallback(() => {
    cancelRef.current = true;
    expandRequestRef.current += 1;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
    setStage('upload');
    setFile(null);
    setLocalUrl('');
    setMeta(null);
    setSourceUrl('');
    setUploadState('idle');
    setBrief('');
    setExpandedPrompt('');
    setExpandedFor('');
    setExpanding(false);
    setExpandError('');
    setResultUrl('');
    setRenderedLabel('');
    setError('');
    setPickError('');
    setLengthNote('');
    setMetaUnreadable(false);
    setProgress(0);
    setSegmentProgress(null);
  }, []);

  const generate = useCallback(async () => {
    const short = brief.trim();
    if (!file || !short) return;

    let suggestion = expandedFor === short ? expandedPrompt : '';
    if (!suggestion) suggestion = await expandBrief(short);
    if (!suggestion) return;

    cancelRef.current = false;
    setError('');
    setProgress(0);
    setStatusIndex(0);
    setSegmentProgress(null);
    setRenderedLabel(short);
    setWorkPhase(sourceUrl ? 'render' : 'upload');
    setStage('working');

    try {
      let source = sourceUrl;
      if (!source) {
        source = await uploadSourceVideo(file);
        if (cancelRef.current) return;
        setSourceUrl(source);
        setUploadState('ready');
      }
      setWorkPhase('render');
      const url = await renderVfx({
        sourceUrl: source,
        videoMimeType: videoMimeTypeFor(file),
        sourceSeconds: measuredSeconds,
        prompt: buildVfxPrompt(suggestion),
        model: OMNI_MODEL,
        aspectRatio,
        effectLabel: short,
        onProgress: setProgress,
        onSegmentProgress: setSegmentProgress,
        isCancelled: () => cancelRef.current,
      });
      if (cancelRef.current) return;
      setProgress(100);
      setResultUrl(url);
      setStage('done');
    } catch (e: any) {
      if (cancelRef.current) return;
      const message = isInsufficientCreditsError(e)
        ? `${e.message} Your clip is still here — top up and press Generate again.`
        : String(e?.message || 'The VFX render did not finish.');
      setError(message);
      setErrorRun((n) => n + 1);
      setStage('failed');
    }
  }, [aspectRatio, brief, expandBrief, expandedFor, expandedPrompt, file, measuredSeconds, sourceUrl]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    setStage('compose');
    setProgress(0);
    setSegmentProgress(null);
  }, []);

  const save = useCallback(async () => {
    if (!resultUrl) return;
    setSaving(true);
    try {
      await downloadVideo(resultUrl, `vfx-drop-${promptSlug(renderedLabel)}.mp4`);
    } finally {
      setSaving(false);
    }
  }, [renderedLabel, resultUrl]);

  const openPicker = () => fileInputRef.current?.click();
  const clipPreview = localUrl ? (
    <div className="vfx-thumb">
      <video
        src={localUrl}
        muted
        playsInline
        preload="metadata"
        onError={() => setMetaUnreadable(true)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          const seconds = Number.isFinite(v.duration) ? v.duration : 0;
          if (!seconds) setMetaUnreadable(true);
          setMeta({ seconds, width: v.videoWidth, height: v.videoHeight });
          try { if (v.currentTime === 0) v.currentTime = 0.1; } catch { /* seek refused */ }
          if (seconds > MAX_SOURCE_SECONDS) {
            setLengthNote(`That clip is ${Math.round(seconds)} seconds. VFX Drop renders the first ${MAX_SOURCE_SECONDS}s — trim it if you need a specific ending.`);
          }
        }}
      />
    </div>
  ) : null;

  const uploadStatusLine = uploadState === 'uploading' ? 'Uploading…'
    : uploadState === 'ready' ? 'Ready'
      : uploadState === 'failed' ? 'Upload failed — Generate will try again'
        : '';

  return (
    <div className="vfx-root" style={{ background: colors.bgPrimary }}>
      <style>{CSS}</style>
      <div className="vfx-wrap">
        <Header onReset={reset} showReset={stage !== 'upload'} />
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
          style={{ display: 'none' }}
          onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }}
        />

        {stage === 'upload' ? (
          <div style={{ marginTop: 20 }}>
            <div
              className={`vfx-drop${dragOver ? ' is-over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={openPicker}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
            >
              <div className="vfx-drop-icon"><Upload className="w-6 h-6" /></div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Drop your video here or tap to browse</div>
              <div className="vfx-note" style={{ maxWidth: 410 }}>
                MP4, MOV or WEBM · up to 30 seconds · 50 MB max. Portrait videos stay portrait; landscape videos stay landscape.
              </div>
            </div>
            {pickError ? <div style={{ marginTop: 14 }}><LightBeamError message={pickError} runKey={pickError} /></div> : null}
            <p className="vfx-note" style={{ marginTop: 18 }}>
              Add rain, neon light, fire in the background, floating particles — or anything else you can describe.
            </p>
          </div>
        ) : null}

        {stage === 'compose' ? (
          <div style={{ marginTop: 18 }}>
            <div className="vfx-card">
              <div className="vfx-strip">
                {clipPreview}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file?.name || 'Your clip'}
                  </div>
                  <div className="vfx-note" style={{ marginTop: 3 }}>
                    {file ? formatBytes(file.size) : ''}{meta?.seconds ? ` · ${Math.round(meta.seconds)}s` : ''}{meta?.width ? ` · ${aspectRatio}` : ''}
                  </div>
                  <div style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700,
                    color: uploadState === 'failed' ? colors.error : uploadState === 'ready' ? colors.success : colors.textSecondary }}>
                    {uploadState === 'uploading' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {uploadStatusLine}
                  </div>
                </div>
                <button type="button" className="vfx-link" onClick={openPicker} style={{ flex: '0 0 auto' }}>Change</button>
              </div>
              {lengthNote ? (
                <div className="vfx-warn" style={{ marginTop: 12 }}>
                  <AlertTriangle className="w-4 h-4" style={{ flex: '0 0 auto', marginTop: 1 }} /><span>{lengthNote}</span>
                </div>
              ) : null}
              {pickError ? <div style={{ marginTop: 12 }}><LightBeamError message={pickError} runKey={pickError} /></div> : null}
            </div>

            <div className="vfx-field">
              <label className="vfx-section-label" htmlFor="vfx-brief">What do you want to add?</label>
              <textarea
                id="vfx-brief"
                className="vfx-textarea"
                value={brief}
                onChange={(e) => changeBrief(e.target.value)}
                onBlur={() => { if (brief.trim() && expandedFor !== brief.trim() && !expanding) void expandBrief(brief); }}
                placeholder="e.g. Add realistic rain with neon reflections on the street"
                maxLength={500}
              />
              <div className="vfx-field-actions">
                <span className="vfx-note">Write a few words — AI will build the cinematic detail.</span>
                <LightBeamButton kind="ghost" small busy={expanding} disabled={!brief.trim()} onClick={() => void expandBrief(brief)}>
                  <Sparkles className="w-4 h-4" />
                  {expanding ? 'Expanding…' : 'Expand with AI'}
                </LightBeamButton>
              </div>
            </div>

            <details className="vfx-expanded" open>
              <summary>
                <span>Expanded prompt · what Omni Flash will receive</span>
                {expanding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              </summary>
              <div className="vfx-expanded-body">
                <textarea
                  className="vfx-preview"
                  readOnly
                  value={expandedPrompt ? buildVfxPrompt(expandedPrompt) : ''}
                  placeholder={expanding ? 'Expanding your idea…' : 'Your expanded cinematic prompt will appear here.'}
                  aria-label="Expanded VFX prompt preview"
                />
                {expandError ? <LightBeamError message={expandError} runKey={expandError} /> : null}
              </div>
            </details>

            <div className="vfx-generate">
              <LightBeamButton fullWidth onClick={() => void generate()} disabled={!brief.trim() || !lengthKnown || expanding} testId="vfx-generate">
                <Wand2 className="w-4 h-4" />
                {!lengthKnown ? 'Reading clip orientation…' : expanding ? 'Expanding your prompt…' : `Generate VFX · ${quotedCredits} credits`}
              </LightBeamButton>
              <p className="vfx-note" style={{ textAlign: 'center', marginTop: 8 }}>
                {quotedSegments > 1
                  ? `First ${Math.ceil(quotedSeconds)}s · ${quotedSegments} sequential segments · ${aspectRatio} output`
                  : `One up-to-${OUTPUT_SECONDS}-second VFX shot · ${aspectRatio} output`}
              </p>
            </div>
          </div>
        ) : null}

        {stage === 'working' ? (
          <div style={{ marginTop: 22 }}>
            {localUrl ? <div className="vfx-player-shell"><video className={playerClass} src={localUrl} muted playsInline loop autoPlay style={{ opacity: 0.42 }} /></div> : null}
            <div style={{ marginTop: 20 }}>
              <LightBeamProgress
                state="processing"
                progress={workPhase === 'upload' ? Math.max(4, progress) : progress}
                label={workPhase === 'upload' ? 'Uploading your clip…'
                  : segmentProgress?.phase === 'stitching' ? `Stitching ${segmentProgress.total} finished segments into one MP4…`
                    : segmentProgress ? `Segment ${segmentProgress.current} of ${segmentProgress.total} · ${segmentProgress.phase === 'clipping' ? 'Preparing this source range…' : segmentProgress.phase === 'continuity' ? 'Locking continuity into the next segment…' : WORKING_LINES[statusIndex]}`
                      : WORKING_LINES[statusIndex]}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, color: colors.textSecondary, fontSize: 13 }}>
              <Sparkles className="w-4 h-4" style={{ color: colors.beamPrimary }} />
              <span>{renderedLabel || 'Custom VFX'} · compositing into your original footage</span>
            </div>
            <p className="vfx-note" style={{ marginTop: 10 }}>
              Each segment can take one to three minutes. They render one at a time to preserve continuity — keep this screen open.
            </p>
            <div style={{ marginTop: 14 }}>
              <LightBeamButton kind="ghost" small onClick={cancel}><X className="w-4 h-4" />Cancel</LightBeamButton>
            </div>
          </div>
        ) : null}

        {stage === 'done' ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 12, fontSize: 12, fontWeight: 700,
              padding: '6px 12px', borderRadius: 999, color: colors.beamPrimary,
              background: 'color-mix(in srgb, #f5b936 12%, transparent)', border: '1px solid color-mix(in srgb, #f5b936 36%, transparent)' }}>
              <Film className="w-3.5 h-3.5" />{renderedLabel}
            </div>
            <div className="vfx-player-shell"><video className={playerClass} src={resultUrl} controls playsInline autoPlay loop /></div>
            <div style={{ marginTop: 16 }}>
              <LightBeamButton fullWidth busy={saving} onClick={() => void save()} testId="vfx-download">
                <Download className="w-4 h-4" />{saving ? 'Saving…' : 'Download MP4'}
              </LightBeamButton>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" className="vfx-link" onClick={() => { changeBrief(''); setStage('compose'); setProgress(0); }}>Add something else</button>
              <button type="button" className="vfx-link" onClick={reset}>Use a different clip</button>
            </div>
          </div>
        ) : null}

        {stage === 'failed' ? (
          <div style={{ marginTop: 22 }}>
            <LightBeamError message={error} runKey={errorRun} />
            <p className="vfx-note" style={{ marginTop: 14 }}>
              A run that does not return a finished MP4 is refunded automatically, including any earlier segments. Your clip and expanded prompt are still here.
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <LightBeamButton onClick={() => void generate()} disabled={!brief.trim()}><RefreshCw className="w-4 h-4" />Try again</LightBeamButton>
              <LightBeamButton kind="ghost" onClick={() => { setError(''); setStage('compose'); setProgress(0); }}><ArrowLeft className="w-4 h-4" />Edit description</LightBeamButton>
              <LightBeamButton kind="ghost" onClick={reset}><Upload className="w-4 h-4" />Use a different clip</LightBeamButton>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
