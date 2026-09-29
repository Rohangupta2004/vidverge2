// Product Videos — the autonomous URL-to-Published-MP4 AI Ad Director.
//
// ONE input: a product URL. The entry screen is a hero URL field; submitting
// it auto-fetches a summary card (title, tagline, value proposition, the
// scraped UI screenshot); one confirm click queues the ENTIRE production on
// the pv-ad-director server function and the customer can close the browser
// immediately — nothing after submission needs a tab.
//
// The server pipeline (see lib/renderJob.ts for the contract):
//   directing  → web-scraping + gpt-5.6-terra write the 3-beat Problem-First
//                script (frustration hook → solution reveal → payoff & CTA)
//   voiceover  → ElevenLabs MP3s + Deepgram word-level millisecond stamps
//   backdrop   → google-veo3 photoreal ambient plate (atmosphere only — the
//                scraped screenshot is composited by Remotion, never by Veo)
//   rendering  → the SaaSHeroMotion composition (3D isometric screenshot
//                card, glassmorphism light sweep, kinetic yellow-highlight
//                subtitles, music bed ducked -12 dB under the voice) on the
//                platform Remotion service, fixed 1920x1080 @ 30fps, 25s
//   completed  → MP4 on durable GCS storage, saved to pv_projects
//
// The app only ever READS the pv_projects row (lib/studio.ts watchAdJob) and
// plays the finished MP4 in the embedded studio panel. Music comes from the
// five pre-generated tracks cached workspace-wide in pv_music_tracks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Download,
  Globe,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  UploadCloud,
  Wand2,
  X,
} from 'lucide-react';
import StudioPreview from './components/StudioPreview';
import { APP_HEADER_LOGO_URL } from './lib/prompts';
import { persistImage, uploadUserImage, warmUpMusicLibrary } from './lib/media';
import { scoutProduct, type AdProductSummary } from './lib/director';
import { queueAdRender, retryAdRender } from './lib/render';
import {
  approveAdRender,
  isAdJobDone,
  isAdJobFailed,
  isAdJobLive,
  isAdJobPreview,
  listAdProjects,
  reviseAdJob,
  type AdPhase,
  type AdProjectRow,
} from './lib/renderJob';
import { buildRemotionPlayerSrcDoc, watchAdJob, type AdJobView } from './lib/studio';
import { AD_STYLE_PRESETS, AUTO_PRESET_ID } from './lib/stylePresets';
import { generateWithRunway } from '../../lib/runwayAdapter';
import { RUNWAY_MODELS } from '../../lib/videoEngines';
import { AD_DURATION_FRAMES, AD_FPS } from './compositions/SaaSHeroMotion';

type View = 'home' | 'summary' | 'producing' | 'preview' | 'studio';

interface FinishedVideo {
  projectId: number;
  title: string;
  videoUrl: string;
  durationInFrames: number;
  vertical: boolean;
}

const PHASES: Array<{ key: AdPhase; label: string; note: string }> = [
  { key: 'directing', label: 'Directing', note: 'Reading your page · writing the 3-beat script' },
  { key: 'voiceover', label: 'Recording sound', note: 'ElevenLabs voiceover · word-level timing' },
  { key: 'backdrop', label: 'Filming the backdrop', note: 'Veo 3 photoreal ambient plate' },
  { key: 'composing', label: 'Coding the composition', note: 'Remotion specialist agent · site colours · voice-timed' },
  { key: 'preview', label: 'Preview & approve', note: 'Watch it in the studio — nothing renders until you say so' },
  { key: 'rendering', label: 'Rendering on the server', note: 'Only after your approval · MP4 lands on durable storage' },
];

const APP_CSS = `
@keyframes pvRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.pv-rise { animation: pvRise .4s cubic-bezier(.16,1,.3,1) both; }
.pv-card { transition: border-color .2s ease, background .2s ease; }
.pv-card:hover { border-color: rgba(245,185,54,.45); background: rgba(255,255,255,.05); }
.pv-btn { transition: filter .15s ease, box-shadow .15s ease; }
.pv-btn:hover:not(:disabled) { filter: brightness(1.08); box-shadow: 0 12px 36px -14px rgba(245,185,54,.8); }
.pv-btn:disabled { opacity: .55; cursor: not-allowed; }
.pv-input { width: 100%; padding: 16px 18px; border-radius: 14px; font-size: 16px; color: #F0F0F0; background: #101010; border: 1px solid rgba(255,255,255,.1); outline: none; }
.pv-input:focus { border-color: rgba(245,185,54,.5); box-shadow: 0 0 0 3px rgba(245,185,54,.12); }
.pv-spin { animation: pvSpin 1s linear infinite; } @keyframes pvSpin { to { transform: rotate(360deg); } }
`;

function looksLikeUrl(value: string): boolean {
  const v = value.trim();
  return v.length > 3 && /[a-z0-9-]\.[a-z]{2,}/i.test(v);
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [url, setUrl] = useState('');
  const [scouting, setScouting] = useState(false);
  const [summary, setSummary] = useState<AdProductSummary | null>(null);
  const [stylePreset, setStylePreset] = useState<string>(AUTO_PRESET_ID);
  const [uploadingShot, setUploadingShot] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<AdJobView | null>(null);
  const [watchingId, setWatchingId] = useState<number | null>(null);
  const [result, setResult] = useState<FinishedVideo | null>(null);
  const [previewProject, setPreviewProject] = useState<AdProjectRow | null>(null);
  const [reviseNote, setReviseNote] = useState('');
  const [revising, setRevising] = useState(false);
  const [approving, setApproving] = useState(false);
  const [projects, setProjects] = useState<AdProjectRow[]>([]);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Runway product shot — an optional live-action clip filmed from the scraped
  // product image. It is a separate deliverable from the server-produced
  // commercial: pv-ad-director owns that pipeline end to end and decides its
  // own Veo backdrop, so nothing here changes what the director renders.
  const [runwayModelId, setRunwayModelId] = useState('gen4_turbo');
  const [runwayBusy, setRunwayBusy] = useState(false);
  const [runwayClipUrl, setRunwayClipUrl] = useState<string | null>(null);
  const [runwayError, setRunwayError] = useState<string | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const resumed = useRef(false);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await listAdProjects(24));
    } catch (loadError) {
      console.warn('[Product Videos] Could not load the library.', loadError);
    }
  }, []);

  useEffect(() => {
    // The five music beds are generated once, workspace-wide; the browser is
    // the surface that holds the wallet token, so it tops the cache up.
    warmUpMusicLibrary();
    loadProjects();
  }, [loadProjects]);

  // ---- watch a server job (the browser only reads) -----------------------
  const openStudio = useCallback((row: AdProjectRow) => {
    setResult({
      projectId: Number(row.id),
      title: String(row.title || 'Untitled commercial'),
      videoUrl: String(row.video_url),
      durationInFrames: Number(row.duration_frames || AD_DURATION_FRAMES),
      vertical: row.mode === 'story',
    });
    setView('studio');
  }, []);

  const watchJob = useCallback(
    (projectId: number) => {
      stopWatch.current?.();
      setWatchingId(projectId);
      setJob(null);
      setError(null);
      setView('producing');
      stopWatch.current = watchAdJob(projectId, (view) => {
        setJob(view);
        if (view.preview) {
          // THE STUDIO GATE: the cut is ready to watch — nothing renders on the
          // server until the founder approves it here.
          setWatchingId(null);
          setPreviewProject(view.project);
          setReviseNote('');
          setView('preview');
          loadProjects();
        } else if (view.done && view.videoUrl) {
          setWatchingId(null);
          openStudio(view.project);
          loadProjects();
        } else if (view.failed) {
          setWatchingId(null);
          setError(String(view.project.error || 'The production failed.'));
          loadProjects();
        }
      });
    },
    [loadProjects, openStudio],
  );

  useEffect(() => () => { stopWatch.current?.(); }, []);

  // A production started earlier (even in a closed tab) is picked straight
  // back up: the newest live ad job of this session resumes on screen.
  useEffect(() => {
    if (resumed.current) return;
    void (async () => {
      try {
        const rows = await listAdProjects(10);
        const waiting = rows.find((row) => row.mode === 'ad' && isAdJobPreview(row.status));
        const inFlight = rows.find((row) => row.mode === 'ad' && isAdJobLive(row.status));
        if (!resumed.current && waiting) {
          resumed.current = true;
          setPreviewProject(waiting);
          setView('preview');
        } else if (!resumed.current && inFlight) {
          resumed.current = true;
          watchJob(Number(inFlight.id));
        }
      } catch {
        // nothing to resume — the library still lists the rows
      }
    })();
  }, [watchJob]);

  // ---- the URL-first flow -------------------------------------------------
  const analyse = useCallback(async () => {
    if (!looksLikeUrl(url) || scouting) return;
    setError(null);
    setScouting(true);
    try {
      const found = await scoutProduct(url);
      setSummary(found);
      setView('summary');
    } catch (scoutError: any) {
      setError(scoutError?.message || 'That page could not be read.');
    } finally {
      setScouting(false);
    }
  }, [url, scouting]);

  /**
   * Film one Runway clip from the scraped hero image. Runway only accepts
   * public HTTPS references, so the screenshot is copied onto platform
   * storage first — exactly like the render service's copy below.
   */
  const makeRunwayShot = useCallback(async () => {
    if (!summary || runwayBusy) return;
    setRunwayError(null);
    setRunwayBusy(true);
    try {
      let seed: string | null = null;
      if (summary.screenshotUrl) {
        try {
          seed = await persistImage(summary.screenshotUrl, `pv-runway-seed-${Date.now()}.png`);
        } catch {
          seed = /^https:\/\//.test(summary.screenshotUrl) ? summary.screenshotUrl : null;
        }
      }
      const prompt = [
        `Premium live-action product commercial shot for ${summary.title || 'this product'}.`,
        summary.tagline || summary.valueProp || '',
        'Slow confident camera move, soft studio light, shallow depth of field. No added text, captions or watermarks.',
      ].filter(Boolean).join(' ');
      const shot = await generateWithRunway({
        model: runwayModelId,
        prompt,
        image: seed,
        aspectRatio: '16:9',
        duration: 5,
      });
      setRunwayClipUrl(shot.mediaUrls[0]);
    } catch (shotError: any) {
      setRunwayError(String(shotError?.message || 'Runway could not film that shot.'));
    } finally {
      setRunwayBusy(false);
    }
  }, [summary, runwayBusy, runwayModelId]);

  const generate = useCallback(async () => {
    if (!summary || starting) return;
    if (!summary.screenshotUrl) {
      setError('A real screenshot is needed first — upload one on the card below. AI mockups are never used.');
      return;
    }
    setError(null);
    setStarting(true);
    try {
      // The screenshot is copied onto platform storage first — the render
      // service has to fetch it, and a customer's CDN can block that or move
      // the file mid-render. Best effort: a blocked copy keeps the original.
      let settled = summary;
      if (summary.screenshotUrl) {
        try {
          const durable = await persistImage(summary.screenshotUrl, `pv-ad-shot-${Date.now()}.png`);
          settled = { ...summary, screenshotUrl: durable };
        } catch {
          // keep the scraped URL
        }
      }
      const projectId = await queueAdRender(settled.url || url, settled, stylePreset);
      watchJob(projectId);
      loadProjects();
    } catch (startError: any) {
      setError(startError?.message || 'The production could not be started.');
    } finally {
      setStarting(false);
    }
  }, [summary, starting, url, stylePreset, watchJob, loadProjects]);

  // REAL SCREENSHOTS ONLY: when the scout could not lift or capture one, the
  // founder uploads their own — the pipeline never draws an AI mockup.
  const uploadScreenshot = useCallback(async (file: File | null) => {
    if (!file || !summary) return;
    setUploadingShot(true);
    setError(null);
    try {
      const uploaded = await uploadUserImage(file);
      setSummary({ ...summary, screenshotUrl: uploaded, screenshotSource: 'upload' });
    } catch (uploadError: any) {
      setError(uploadError?.message || 'The screenshot could not be uploaded.');
    } finally {
      setUploadingShot(false);
    }
  }, [summary]);

  const uploadLogo = useCallback(async (file: File | null) => {
    if (!file || !summary) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const uploaded = await uploadUserImage(file);
      setSummary({ ...summary, logoUrl: uploaded });
    } catch (uploadError: any) {
      setError(uploadError?.message || 'The logo could not be uploaded.');
    } finally {
      setUploadingLogo(false);
    }
  }, [summary]);

  const approve = useCallback(async () => {
    if (!previewProject || approving) return;
    setApproving(true);
    setError(null);
    try {
      await approveAdRender(Number(previewProject.id));
      watchJob(Number(previewProject.id));
      loadProjects();
    } catch (approveError: any) {
      setError(approveError?.message || 'The render could not be started.');
    } finally {
      setApproving(false);
    }
  }, [previewProject, approving, watchJob, loadProjects]);

  const revise = useCallback(async () => {
    if (!previewProject || revising || !reviseNote.trim()) return;
    setRevising(true);
    setError(null);
    try {
      await reviseAdJob(Number(previewProject.id), reviseNote.trim());
      setReviseNote('');
      watchJob(Number(previewProject.id));
      loadProjects();
    } catch (reviseError: any) {
      setError(reviseError?.message || 'The change request could not be sent.');
    } finally {
      setRevising(false);
    }
  }, [previewProject, revising, reviseNote, watchJob, loadProjects]);

  const retry = useCallback(
    async (projectId: number) => {
      setError(null);
      setRetrying(projectId);
      try {
        await retryAdRender(projectId);
        watchJob(projectId);
        loadProjects();
      } catch (retryError: any) {
        setError(retryError?.message || 'The retry could not be started.');
      } finally {
        setRetrying(null);
      }
    },
    [watchJob, loadProjects],
  );

  const downloadMp4 = useCallback(async () => {
    if (!result) return;
    setDownloading(true);
    try {
      const response = await fetch(result.videoUrl);
      if (!response.ok) throw new Error('download blocked');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${(result.title || 'product-ad').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'product-ad'}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = result.videoUrl;
      anchor.download = 'product-ad.mp4';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setDownloading(false);
    }
  }, [result]);

  const phase: AdPhase = job?.phase || 'directing';
  const phaseIndex = PHASES.findIndex((entry) => entry.key === phase);

  // The in-browser Remotion Player studio over the agent's composition — the
  // founder watches THIS before anything renders on the server.
  const previewSrcDoc = useMemo(() => {
    if (!previewProject || !previewProject.composition_tsx) return null;
    return buildRemotionPlayerSrcDoc({
      compositionTsx: String(previewProject.composition_tsx),
      durationInFrames: Number(previewProject.duration_frames || AD_DURATION_FRAMES),
      fps: AD_FPS,
      title: String(previewProject.title || 'Your commercial'),
    });
  }, [previewProject]);
  const stageLine = job?.stageLabel || 'Queued — the server pipeline is picking this up…';

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
      <img
        src={APP_HEADER_LOGO_URL}
        alt="VidVerge"
        style={{ width: 46, height: 46, objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(212,175,55,0.6))' }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#F0F0F0' }}>Product Videos · AI Ad Director</div>
        <div style={{ fontSize: 12.5, color: 'rgba(240,240,240,0.55)' }}>
          URL in → published 25s commercial out · 1920×1080 · everything renders server-side
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100%', padding: '26px 22px 40px', background: 'var(--space-surface-bg, #080808)', fontFamily: "'Inter', 'Geist', system-ui, sans-serif" }}>
      <style>{APP_CSS}</style>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        {header}

        {error && view !== 'producing' && (
          <div className="pv-rise" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '12px 16px', borderRadius: 12, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5', fontSize: 13 }}>
            <X size={15} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 12 }}>Dismiss</button>
          </div>
        )}

        {view === 'home' && (
          <div className="pv-rise">
            {/* THE input — a URL is the whole brief. */}
            <div style={{ padding: '46px 34px', borderRadius: 22, background: 'linear-gradient(180deg, rgba(245,185,54,0.07), rgba(255,255,255,0.02))', border: '1px solid rgba(245,185,54,0.25)', marginBottom: 34, textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', color: '#F0F0F0', marginBottom: 8 }}>
                Paste your product URL. Get a finished commercial.
              </div>
              <p style={{ margin: '0 auto 26px', maxWidth: 640, fontSize: 14, lineHeight: 1.6, color: 'rgba(240,240,240,0.6)' }}>
                The AI Ad Director reads your page, writes a 25-second problem-first script, records the voiceover,
                films a photoreal backdrop, and renders your UI in a 3D motion pass — all on the server. Submit and
                close the tab; the MP4 will be waiting.
              </p>
              <div style={{ display: 'flex', gap: 12, maxWidth: 680, margin: '0 auto' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Globe size={17} color="#F5B936" style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    className="pv-input"
                    style={{ paddingLeft: 44 }}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void analyse(); }}
                    placeholder="yourproduct.com"
                    autoFocus
                  />
                </div>
                <button
                  className="pv-btn"
                  disabled={!looksLikeUrl(url) || scouting}
                  onClick={() => void analyse()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '0 26px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 15.5, fontWeight: 800, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)', boxShadow: '0 14px 40px rgba(245,185,54,0.3)', whiteSpace: 'nowrap' }}
                >
                  {scouting ? <Loader2 size={17} className="pv-spin" /> : <Sparkles size={17} />}
                  {scouting ? 'Reading…' : 'Analyze my site'}
                </button>
              </div>
              <div style={{ marginTop: 14, fontSize: 11.5, color: 'rgba(240,240,240,0.4)' }}>
                Reading the page and capturing a real screenshot can take up to ~2 minutes. Nothing is generated or charged until you confirm.
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Clapperboard size={16} color="#F5B936" />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#F0F0F0' }}>Your videos</span>
            </div>
            {projects.length === 0 ? (
              <div style={{ padding: '26px 22px', borderRadius: 14, border: '1px dashed rgba(255,255,255,0.12)', color: 'rgba(240,240,240,0.45)', fontSize: 13 }}>
                Nothing here yet — paste your product URL above and generate your first commercial.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
                {projects.map((project) => {
                  const status = String(project.status || 'draft');
                  const isAd = project.mode === 'ad';
                  const done = isAdJobDone(status) && project.video_url;
                  const live = isAdJobLive(status) || ['planning', 'generating_images', 'generating_audio', 'assets', 'audio', 'composing'].indexOf(status) >= 0;
                  return (
                    <div key={project.id} className="pv-card" style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#F0F0F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title || 'Untitled video'}</span>
                        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, color: done ? '#4ade80' : status === 'failed' ? '#f87171' : '#F5B936', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                          {status.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(240,240,240,0.45)', marginBottom: 12 }}>
                        {isAd ? 'AI Ad Director · 16:9 · 25s' : project.mode === 'story' ? 'Story reel · 9:16' : 'UI film · 16:9'}
                        {!isAd && project.duration_frames ? ` · ${Math.round(Number(project.duration_frames) / AD_FPS)}s` : ''}
                      </div>
                      {live && project.stage && (
                        <div style={{ fontSize: 11, color: 'rgba(245,185,54,0.85)', lineHeight: 1.4, marginBottom: 10 }}>{String(project.stage)}</div>
                      )}
                      {done && (
                        <button
                          className="pv-btn"
                          onClick={() => openStudio(project)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)' }}
                        >
                          <Play size={13} /> Open in Studio
                        </button>
                      )}
                      {isAdJobPreview(status) && isAd && (
                        <button
                          className="pv-btn"
                          onClick={() => { setPreviewProject(project); setReviseNote(''); setView('preview'); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)' }}
                        >
                          <Play size={13} /> Review preview
                        </button>
                      )}
                      {live && isAd && (
                        <button
                          className="pv-btn"
                          onClick={() => watchJob(Number(project.id))}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#F5B936', background: 'rgba(245,185,54,0.10)', border: '1px solid rgba(245,185,54,0.35)' }}
                        >
                          <Loader2 size={13} className="pv-spin" /> Watch progress
                        </button>
                      )}
                      {status === 'failed' && (
                        <div>
                          {project.error && (
                            <div style={{ fontSize: 11, color: 'rgba(248,113,113,0.8)', lineHeight: 1.4, marginBottom: 10 }}>{String(project.error).slice(0, 180)}</div>
                          )}
                          {isAd && (
                            <button
                              className="pv-btn"
                              onClick={() => void retry(Number(project.id))}
                              disabled={retrying === project.id}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)', border: 'none' }}
                            >
                              {retrying === project.id ? <Loader2 size={13} className="pv-spin" /> : <RotateCcw size={13} />}
                              {retrying === project.id ? 'Restarting…' : 'Retry'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view === 'summary' && summary && (
          <div className="pv-rise" style={{ maxWidth: 720 }}>
            <button onClick={() => setView('home')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 18, background: 'none', border: 'none', color: 'rgba(240,240,240,0.55)', fontSize: 13, cursor: 'pointer' }}>
              <ArrowLeft size={14} /> Different URL
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <Check size={18} color="#F5B936" />
              <span style={{ fontSize: 18, fontWeight: 800, color: '#F0F0F0', letterSpacing: '-0.02em' }}>Here’s what your ad will sell</span>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: 'rgba(240,240,240,0.55)', lineHeight: 1.55 }}>
              Read from {summary.url}. Nothing has been generated or charged yet — confirm and the whole production
              runs on the server. You can close this tab the moment it starts.
            </p>

            <div style={{ borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', marginBottom: 18 }}>
              {summary.screenshotUrl ? (
                <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#0D1220', overflow: 'hidden' }}>
                  <img src={summary.screenshotUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
                  <div style={{ position: 'absolute', left: 12, top: 12, padding: '4px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: '#F5B936', background: 'rgba(8,8,8,0.75)', border: '1px solid rgba(245,185,54,0.4)' }}>
                    {summary.screenshotSource === 'upload'
                      ? 'Your uploaded screenshot — stars in the motion pass'
                      : summary.screenshotSource === 'capture'
                        ? 'Captured live from your page — stars in the motion pass'
                        : 'From your page — stars in the motion pass'}
                  </div>
                  <label className="pv-btn" style={{ position: 'absolute', right: 12, bottom: 12, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#F0F0F0', background: 'rgba(8,8,8,0.78)', border: '1px solid rgba(255,255,255,0.25)' }}>
                    {uploadingShot ? <Loader2 size={13} className="pv-spin" /> : <UploadCloud size={13} />}
                    {uploadingShot ? 'Uploading…' : 'Replace with my own'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(event) => void uploadScreenshot(event.target.files?.[0] || null)} />
                  </label>
                </div>
              ) : (
                <div style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center', background: '#0D1220', padding: 24 }}>
                  <div style={{ textAlign: 'center', maxWidth: 440 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fca5a5', marginBottom: 8 }}>
                      No real screenshot could be captured from your page.
                    </div>
                    <div style={{ fontSize: 12.5, color: 'rgba(240,240,240,0.55)', lineHeight: 1.55, marginBottom: 14 }}>
                      Your ad only ever uses the real thing — never an AI mockup. Upload a screenshot of your product to
                      continue.
                    </div>
                    <label className="pv-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)' }}>
                      {uploadingShot ? <Loader2 size={15} className="pv-spin" /> : <UploadCloud size={15} />}
                      {uploadingShot ? 'Uploading…' : 'Upload a real screenshot'}
                      <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(event) => void uploadScreenshot(event.target.files?.[0] || null)} />
                    </label>
                  </div>
                </div>
              )}
              <div style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  {summary.logoUrl && (
                    <img src={summary.logoUrl} alt="" style={{ width: 34, height: 34, objectFit: 'contain', background: 'rgba(0,0,0,0.35)', borderRadius: 8 }} />
                  )}
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#F0F0F0', letterSpacing: '-0.02em' }}>{summary.title}</span>
                  {summary.accent && (
                    <span title={`Brand colour ${summary.accent}`} style={{ width: 16, height: 16, borderRadius: 5, background: summary.accent, border: '1px solid rgba(255,255,255,0.25)' }} />
                  )}
                  <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#F5B936', background: 'rgba(245,185,54,0.08)', border: '1px solid rgba(245,185,54,0.35)', whiteSpace: 'nowrap' }}>
                    {uploadingLogo ? <Loader2 size={12} className="pv-spin" /> : <UploadCloud size={12} />}
                    {summary.logoUrl ? 'Replace logo' : 'Add your logo'}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={(event) => void uploadLogo(event.target.files?.[0] || null)} />
                  </label>
                </div>
                {!summary.logoUrl && (
                  <div style={{ fontSize: 11.5, color: 'rgba(240,240,240,0.45)', marginBottom: 8 }}>
                    No logo found on your page — add one and it appears in the film's title row and CTA.
                  </div>
                )}
                {summary.tagline && (
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'rgba(240,240,240,0.8)', marginBottom: 8 }}>{summary.tagline}</div>
                )}
                {summary.valueProp && (
                  <div style={{ fontSize: 13, color: 'rgba(240,240,240,0.6)', lineHeight: 1.6 }}>{summary.valueProp}</div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 18, padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(240,240,240,0.5)', marginBottom: 8 }}>
                Runway product shot · optional
              </div>
              <div style={{ fontSize: 12, color: 'rgba(240,240,240,0.5)', lineHeight: 1.55, marginBottom: 10 }}>
                Film a live-action product clip from your page’s hero image. It is billed and delivered on its own — your commercial below still renders through the server director.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <select
                  value={runwayModelId}
                  onChange={(event) => setRunwayModelId(event.target.value)}
                  disabled={runwayBusy}
                  style={{ background: '#101010', color: '#F0F0F0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '9px 11px', fontSize: 12.5, fontWeight: 600, cursor: runwayBusy ? 'default' : 'pointer' }}
                >
                  {RUNWAY_MODELS.filter((model) => model.type === 'video').map((model) => (
                    <option key={model.id} value={model.id} disabled={!model.available}>
                      {model.speed === 'fast' ? '⚡ ' : ''}{model.label}{model.available ? '' : ' — unavailable on this platform'}
                    </option>
                  ))}
                </select>
                <button
                  className="pv-btn"
                  onClick={() => void makeRunwayShot()}
                  disabled={runwayBusy || !summary.screenshotUrl}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', color: '#F0F0F0', fontSize: 12.5, fontWeight: 700, cursor: runwayBusy ? 'default' : 'pointer' }}
                >
                  {runwayBusy ? <Loader2 size={14} className="pv-spin" /> : <Sparkles size={14} />}
                  {runwayBusy ? 'Filming on Runway…' : runwayClipUrl ? 'Film another take' : 'Film a Runway shot'}
                </button>
                {runwayClipUrl ? (
                  <video src={runwayClipUrl} controls muted style={{ width: 200, borderRadius: 10, background: '#000' }} />
                ) : null}
              </div>
              {runwayError ? (
                <div style={{ marginTop: 9, fontSize: 12, color: '#ff8f8f', lineHeight: 1.5 }}>{runwayError}</div>
              ) : null}
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(240,240,240,0.5)', marginBottom: 10 }}>
                Style — the Remotion coding agent writes your ad in this direction
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button
                  onClick={() => setStylePreset(AUTO_PRESET_ID)}
                  style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 12, cursor: 'pointer', maxWidth: 240, background: stylePreset === AUTO_PRESET_ID ? 'rgba(245,185,54,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${stylePreset === AUTO_PRESET_ID ? 'rgba(245,185,54,0.6)' : 'rgba(255,255,255,0.1)'}` }}
                >
                  <div style={{ fontSize: 13, fontWeight: 800, color: stylePreset === AUTO_PRESET_ID ? '#F5B936' : '#F0F0F0' }}>Auto</div>
                  <div style={{ fontSize: 11, color: 'rgba(240,240,240,0.5)' }}>The director picks the best fit for your brand</div>
                </button>
                {AD_STYLE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setStylePreset(p.id)}
                    style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 12, cursor: 'pointer', maxWidth: 240, background: stylePreset === p.id ? 'rgba(245,185,54,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${stylePreset === p.id ? 'rgba(245,185,54,0.6)' : 'rgba(255,255,255,0.1)'}` }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: stylePreset === p.id ? '#F5B936' : '#F0F0F0' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(240,240,240,0.5)' }}>{p.blurb}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                className="pv-btn"
                onClick={() => void generate()}
                disabled={starting || uploadingShot || !summary.screenshotUrl}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '15px 24px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 800, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)', boxShadow: '0 14px 40px rgba(245,185,54,0.3)' }}
              >
                {starting ? <Loader2 size={17} className="pv-spin" /> : <Wand2 size={17} />}
                {starting ? 'Starting…' : 'Generate my commercial'}
              </button>
              <span style={{ fontSize: 12, color: 'rgba(240,240,240,0.45)' }}>25 seconds · 1920×1080 · voiceover, music bed & word-synced captions included</span>
            </div>
          </div>
        )}

        {view === 'producing' && (
          <div className="pv-rise" style={{ maxWidth: 640 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#F0F0F0', letterSpacing: '-0.02em', marginBottom: 4 }}>
              Producing your commercial…
            </div>
            <p style={{ margin: '0 0 20px', fontSize: 12.5, color: 'rgba(240,240,240,0.5)' }}>
              Every step runs on the server — you can close this tab right now and come back later; the ad keeps
              building and lands in your library.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {PHASES.map((step, index) => {
                const active = step.key === phase;
                const complete = phaseIndex > index || phase === 'done';
                return (
                  <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 16px', borderRadius: 13, border: `1px solid ${active ? 'rgba(245,185,54,0.5)' : 'rgba(255,255,255,0.08)'}`, background: active ? 'rgba(245,185,54,0.07)' : 'rgba(255,255,255,0.02)', opacity: active || complete ? 1 : 0.5 }}>
                    <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 999, flexShrink: 0, color: complete ? '#0B0F17' : active ? '#1A1205' : 'rgba(240,240,240,0.5)', background: complete ? '#4ade80' : active ? '#F5B936' : 'rgba(255,255,255,0.06)' }}>
                      {complete ? <Check size={14} /> : active ? <Loader2 size={14} className="pv-spin" /> : index + 1}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 13.5, color: active ? '#F0F0F0' : 'rgba(240,240,240,0.75)' }}>{step.label}</strong>
                      <span style={{ display: 'block', fontSize: 11, color: 'rgba(240,240,240,0.45)' }}>{active ? stageLine : step.note}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            {error && (
              <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 12, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5', fontSize: 13 }}>
                {error}
                <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                  {job?.project && (
                    <button className="pv-btn" onClick={() => void retry(Number(job.project.id))} disabled={retrying === job.project.id} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#1A1205', background: '#F5B936' }}>
                      {retrying === job.project.id ? 'Restarting…' : 'Retry this ad'}
                    </button>
                  )}
                  <button onClick={() => { setError(null); setView('home'); loadProjects(); }} style={{ padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'rgba(240,240,240,0.7)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>Back to library</button>
                </div>
              </div>
            )}
            {!error && watchingId && (
              <button onClick={() => { setView('home'); loadProjects(); }} style={{ marginTop: 18, padding: '9px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'rgba(240,240,240,0.7)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                Back to library (it keeps building)
              </button>
            )}
          </div>
        )}

        {view === 'preview' && previewProject && (
          <div className="pv-rise">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={() => { setView('home'); loadProjects(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'rgba(240,240,240,0.55)', fontSize: 13, cursor: 'pointer' }}>
                <ArrowLeft size={14} /> Library
              </button>
              <span style={{ fontSize: 12, color: 'rgba(240,240,240,0.5)' }}>
                Live preview of the agent-coded composition — nothing has rendered on the server yet.
              </span>
            </div>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'stretch' }}>
              <div style={{ height: 'min(68vh, 700px)', minWidth: 0 }}>
                {previewSrcDoc ? (
                  <iframe
                    title="Remotion preview studio"
                    srcDoc={previewSrcDoc}
                    allow="autoplay; fullscreen"
                    style={{ width: '100%', height: '100%', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, background: '#05070C', display: 'block' }}
                  />
                ) : (
                  <div style={{ height: '100%', display: 'grid', placeItems: 'center', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 16, color: 'rgba(240,240,240,0.5)', fontSize: 13 }}>
                    The composition is still being written — check back in a moment.
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ padding: 16, borderRadius: 14, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.3)' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#4ade80', marginBottom: 6 }}>Happy with this cut?</div>
                  <p style={{ margin: '0 0 12px', fontSize: 12, color: 'rgba(240,240,240,0.6)', lineHeight: 1.55 }}>
                    Approving sends it to the server renderer (typically 20–40 minutes). You can close the tab — the
                    MP4 lands in your library.
                  </p>
                  <button
                    className="pv-btn"
                    onClick={() => void approve()}
                    disabled={approving}
                    style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, color: '#052e12', background: 'linear-gradient(90deg, #4ade80, #22c55e)' }}
                  >
                    {approving ? <Loader2 size={15} className="pv-spin" /> : <Check size={15} />}
                    {approving ? 'Submitting…' : 'Approve — render final MP4'}
                  </button>
                </div>
                <div style={{ padding: 16, borderRadius: 14, background: 'rgba(245,185,54,0.06)', border: '1px solid rgba(245,185,54,0.3)', flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#F5B936', marginBottom: 6 }}>Want changes?</div>
                  <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(240,240,240,0.6)', lineHeight: 1.55 }}>
                    Tell the coding agent what to change — it rewrites the composition and the new cut comes straight
                    back to this preview.
                  </p>
                  <textarea
                    className="pv-input"
                    rows={4}
                    value={reviseNote}
                    onChange={(event) => setReviseNote(event.target.value)}
                    placeholder="e.g. make the headline bigger, slow the card tilt, use more of the blue from my site…"
                    style={{ resize: 'vertical', marginBottom: 10 }}
                  />
                  <button
                    className="pv-btn"
                    onClick={() => void revise()}
                    disabled={revising || !reviseNote.trim()}
                    style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', borderRadius: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: 800, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)', border: 'none' }}
                  >
                    {revising ? <Loader2 size={15} className="pv-spin" /> : <Wand2 size={15} />}
                    {revising ? 'Sending to the agent…' : 'Ask the agent to change it'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'studio' && result && (
          <div className="pv-rise">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <button onClick={() => { setView('home'); loadProjects(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'rgba(240,240,240,0.55)', fontSize: 13, cursor: 'pointer' }}>
                <ArrowLeft size={14} /> Library
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="pv-btn"
                  onClick={() => void downloadMp4()}
                  disabled={downloading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 800, color: '#1A1205', background: 'linear-gradient(90deg, #F5B936, #E0A527)', boxShadow: '0 12px 34px rgba(245,185,54,0.3)' }}
                >
                  {downloading ? <Loader2 size={15} className="pv-spin" /> : <Download size={15} />} Download MP4
                </button>
                <button
                  className="pv-btn"
                  onClick={() => { setSummary(null); setUrl(''); setView('home'); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#F5B936', background: 'rgba(245,185,54,0.08)', border: '1px solid rgba(245,185,54,0.35)' }}
                >
                  <Sparkles size={15} /> New commercial
                </button>
              </div>
            </div>
            <div style={{ height: 'min(72vh, 760px)' }}>
              <StudioPreview
                videoUrl={result.videoUrl}
                title={result.title}
                durationInFrames={result.durationInFrames}
                vertical={result.vertical}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 11.5, color: 'rgba(240,240,240,0.45)' }}>
              <Play size={12} />
              Press play to hear the voiceover and the ducked music bed · scrub the timeline · use ⛶ for fullscreen.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
