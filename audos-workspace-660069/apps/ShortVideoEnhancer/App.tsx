/**
 * Short Video Enhancer — the pro studio shell.
 *
 * One document (`lib/sveTypes.ts`) describes the whole edit. The preview, the
 * Remotion props, the optimisation checklist and the autosaved row are all
 * pure functions of it, which is why undo/redo is a stack of documents and the
 * exported file always matches what the preview showed.
 *
 * This file owns state and orchestration only. The chrome is the Vidverge Pro
 * layout — header, preview with its own transport, a seven-tab control panel
 * on the right, a five-track timeline underneath and an agent drawer that
 * slides over the preview — and every surface of it lives in `components/`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Check, ChevronRight, Clapperboard, Diamond, Download, FileVideo, Loader2,
  Maximize2, Pause, Play, Redo2, Ruler, Save, Sparkles, Undo2, Upload, Volume2,
  VolumeX,
} from 'lucide-react';

import { APP_IDS, defaultModelFor } from '../../lib/appIds';
import { generationHeaders, postGeneration } from '../../lib/videoEngineClient';
import {
  FILTER_GRADES, FPS, SHORT_ASPECTS, clamp, emptyDoc, formatClock, newId,
  shortAspectRatio, sveKeyframeAt, sveMotionKeys,
  type CaptionLanguage, type CaptionTier, type CaptionTierMode, type CardKind, type EditDoc,
  type ShortAspect, type SveMotionKind,
} from './lib/sveTypes';
import {
  autoFitSize, buildCues, captionsToSrt, captionsToVtt, detectSilences, evenTimings,
  keywordMoments, normaliseWords, retimeFromTranscript,
} from './lib/sveCaptions';
import {
  HINGLISH_SAMPLE_LINES, applyStoredCaptionLanguage, storeCaptionLanguage,
} from './lib/sveHinglish';
import { resolveCaptionTiers, tierBreakdown } from './lib/sveCaptionTiers';
import * as api from './lib/sveApi';
import { analyzeAudio, readMotion, sampleFrames, waveformFor, type AudioStats, type MotionRead } from './lib/sveAnalyze';
import { SVE_BASE_STYLES } from './lib/sveBaseStyles';
import { SVE_PHASE2_STYLES } from './lib/sveStyles';
import { useHistory, useUndoShortcuts } from './lib/sveHistory';
import { PRO_CSS, PRO_FONTS_URL, type RunState } from './lib/sveProUi';
import { SVE_STUDIO_CSS } from './lib/sveStudioCss';

import { SveStage, gradeCss } from './components/SveStage';
import { SveAccordion } from './components/SveAccordion';
import { SveCaptionPanel } from './components/SveCaptionPanel';
import { SveMusicPanel } from './components/SveMusicPanel';
import { SveBrollPanel } from './components/SveBrollPanel';
import { SveCardsPanel } from './components/SveCardsPanel';
import { SveSuggestionsCard, SveOptimizationCard, buildChecklist } from './components/SveInsightsPanel';
import SveProPanels, { SHORT_PRESETS, SVE_TABS, type ShortPreset, type SveTabId } from './components/SveProPanels';
import SveProTimeline from './components/SveProTimeline';
import SveProAgent, {
  emptySveJobs, routeSveInstruction, type SveAgentActionId, type SveAgentJobs,
} from './components/SveProAgent';
import SveProExport, {
  encodeSveGif, encodeSveWebm, type ExportPhase, type SveExportSpec,
} from './components/SveProExport';

type Toast = { id: number; message: string; tone: 'ok' | 'bad' } | null;
type ChatLine = { id: string; role: 'user' | 'assistant'; content: string };

const AUTOSAVE_MS = 30000;
const PRESET_STORE = 'vidverge_shorts_presets';

/**
 * App-local additions on top of PRO_CSS (which stays byte-identical with the
 * Video Enhancer): the drag-to-resize timeline row and icon-clipping guards.
 */
const SVE_SHELL_FIXES = `
.vp-root .vp-body { grid-template-rows: minmax(0,1fr) var(--ve-tl-h, auto); }
.vp-root .vp-body > .vp-stagecol, .vp-root .vp-body > .vp-side { min-height: 0; }
.vp-root .vp-tl { min-height: 0; }
/* The preview wrapper carries max-height:100% but no height, and the stage
   centres (does not stretch) it — so .sve-phone's height:100% had no definite
   base to resolve against and the whole player collapsed to zero height. Give
   the wrapper the stage's height so the 9/16 phone sizes from it again. */
.vp-root .vp-stage > .vp-stageinner { height: 100%; }
.vp-root .vp-tl-grip { flex:0 0 auto; height:6px; cursor:ns-resize; touch-action:none; background:transparent; transition:background .15s ease; }
.vp-root .vp-tl-grip:hover, .vp-root .vp-tl-grip[data-dragging="true"] { background: rgba(124,58,237,0.55); }
@media (max-width:900px){ .vp-root .vp-body { grid-template-rows:auto auto auto; } .vp-root .vp-tl-grip{display:none;} }
.vp-root .vp-trkhead { flex-basis:auto; width:auto; min-width:76px; }
.vp-root .vp-trkhead b { white-space:nowrap; }
.vp-root .vp-trkhead b > svg, .vp-root .vp-btn > svg, .vp-root .vp-ico > svg, .vp-root .vp-actico > svg { flex:0 0 auto; }
.vp-root .vp-btn { justify-content: safe center; }
.vp-root .vp-tab { align-items: safe center; }
`;

export default function App() {
  // The caption language is a device preference, like the saved presets and
  // the timeline height, so a fresh edit opens in whichever one was chosen
  // last. Lazy, because it only matters on the very first render.
  const [initialDoc] = useState(() => applyStoredCaptionLanguage(emptyDoc()));
  const history = useHistory<EditDoc>(initialDoc);
  const doc = history.present;
  const commit = history.commit;
  useUndoShortcuts(history.undo, history.redo);

  // --- source ---------------------------------------------------------------
  const [previewUrl, setPreviewUrl] = useState('');
  const [clipLoading, setClipLoading] = useState(false);
  const [clipLoadingLabel, setClipLoadingLabel] = useState('');
  const [audioStats, setAudioStats] = useState<AudioStats | null>(null);
  const [motion, setMotion] = useState<MotionRead | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);

  // --- transport ------------------------------------------------------------
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(true);

  // --- pro shell ------------------------------------------------------------
  const [tab, setTab] = useState<SveTabId>('effects');
  const [agentOpen, setAgentOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [tlCollapsed, setTlCollapsed] = useState(false);

  // The control rail retracts to a 46px icon strip. The main column is a grid
  // track, not an overlay, so collapsing it HANDS THE WIDTH BACK to the stage
  // instead of leaving the preview to render underneath a floating panel.
  const [sideCollapsed, setSideCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );
  // Only crossing the 768px line moves it, so a manual expand survives the
  // address bar sliding in and out on a phone.
  const wasNarrow = useRef(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => {
      const narrow = window.innerWidth < 768;
      if (narrow === wasNarrow.current) return;
      wasNarrow.current = narrow;
      setSideCollapsed(narrow);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Which drawer panels are expanded. The caption lab opens first; the rest
  // stay shut so the drawer is a list of headers, not a wall of controls.
  const [drawerOpen, setDrawerOpen] = useState<Record<string, boolean>>({ captions: true });
  const toggleDrawer = useCallback(
    (id: string) => setDrawerOpen((state) => ({ ...state, [id]: !state[id] })),
    [],
  );

  const [tlZoom, setTlZoom] = useState(1);
  // Timeline height in px; 0 means "auto" (the natural height of the tracks).
  const [timelineHeight, setTimelineHeight] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 0;
      const saved = Number(window.localStorage.getItem('sve:timelineHeight'));
      if (!Number.isFinite(saved) || saved <= 0) return 0;
      return Math.round(Math.min(Math.max(saved, 80), window.innerHeight * 0.5));
    } catch { return 0; }
  });
  const onTimelineResize = useCallback((height: number, persist: boolean) => {
    const next = height > 0 ? Math.round(height) : 0;
    setTimelineHeight(next);
    if (!persist) return;
    try {
      if (next > 0) window.localStorage.setItem('sve:timelineHeight', String(next));
      else window.localStorage.removeItem('sve:timelineHeight');
    } catch { /* storage unavailable — the height still applies for this session */ }
  }, []);
  const [compareAB, setCompareAB] = useState(false);
  const [activePreset, setActivePreset] = useState('');
  const [customPresets, setCustomPresets] = useState<ShortPreset[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedBrollId, setSelectedBrollId] = useState<string | null>(null);
  const [agentJobs, setAgentJobs] = useState<SveAgentJobs>(emptySveJobs);
  const [agentRunning, setAgentRunning] = useState<SveAgentActionId | ''>('');
  const [chat, setChat] = useState<ChatLine[]>([]);

  // --- async work -----------------------------------------------------------
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const [musicPhase, setMusicPhase] = useState<'idle' | 'briefing' | 'generating'>('idle');
  const [musicNote, setMusicNote] = useState('');
  const [visionBusy, setVisionBusy] = useState(false);
  const [stock, setStock] = useState<api.PexelsClip[]>([]);
  const [stockNote, setStockNote] = useState('');
  const [stockBusy, setStockBusy] = useState(false);
  const [brollUploading, setBrollUploading] = useState(false);
  const [voBusy, setVoBusy] = useState(false);
  const [voNote, setVoNote] = useState('');
  const [beatBusy, setBeatBusy] = useState(false);

  // --- export ---------------------------------------------------------------
  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle');
  const [exportError, setExportError] = useState('');
  const [exportGeometry, setExportGeometry] = useState('');
  const [variants, setVariants] = useState<api.ExportSizes | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [downloading, setDownloading] = useState('');
  const [exportSpec, setExportSpec] = useState<SveExportSpec>({ format: 'mp4', target: '9:16', fps: 30, bitrate: 'auto' });
  const [localUrl, setLocalUrl] = useState('');
  const [localBytes, setLocalBytes] = useState(0);
  const [localProgress, setLocalProgress] = useState(0);

  // --- persistence ----------------------------------------------------------
  const [projectId, setProjectId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number>(0);

  const [toast, setToast] = useState<Toast>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageShellRef = useRef<HTMLDivElement>(null);
  const sourceFileRef = useRef<File | null>(null);
  const uploadRef = useRef<Promise<string> | null>(null);
  const analysedFor = useRef<string>('');
  const savedRevision = useRef<number>(-1);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const notify = useCallback((message: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now();
    setToast({ id, message, tone });
    window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), tone === 'bad' ? 7000 : 3600);
  }, []);

  // Only an object URL needs revoking; a restored draft's preview is a durable
  // https URL that must survive.
  useEffect(() => () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Saved looks live on the device: a personal shortcut, not project data.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRESET_STORE);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) setCustomPresets(list.slice(0, 12) as ShortPreset[]);
    } catch { /* storage unavailable — the built-in presets still work */ }
  }, []);

  // Pick up the most recent autosaved draft once per mount.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      const rows = await api.listProjects(1);
      const row = rows[0];
      const saved = row ? api.parseDoc(row) : null;
      if (!row || !saved?.sourceUrl) return;
      setProjectId(Number(row.id) || null);
      history.reset(applyStoredCaptionLanguage(saved));
      setPreviewUrl(saved.sourceUrl);
      setSavedAt(Date.now());
      notify('Picked up where you left off — “' + (saved.title || 'Untitled') + '”');
    })();
  }, [history, notify]);

  // --- derived --------------------------------------------------------------
  // Grouping words into cues is one pass; giving each cue its treatment is a
  // second. The tier pass is where the 70/20/10 mix — and any line the
  // creator assigned by hand — is applied, and its output is what the
  // preview draws AND what the renderer is handed, so the two cannot drift.
  const cues = useMemo(
    () => resolveCaptionTiers(buildCues(doc.words, doc.caption.wordsPerCue), {
      mode: doc.caption.tierMode,
      language: doc.caption.language,
      durationS: doc.durationS,
      tierOverrides: doc.captionTiers,
      emphasisOverrides: doc.captionEmphasis,
    }),
    [
      doc.words, doc.caption.wordsPerCue, doc.caption.tierMode, doc.caption.language,
      doc.durationS, doc.captionTiers, doc.captionEmphasis,
    ],
  );
  const captionTiers = useMemo(() => tierBreakdown(cues), [cues]);
  const captionSize = useMemo(
    () => (doc.caption.autoFit ? autoFitSize(cues, doc.caption.size, doc.caption.uppercase) : doc.caption.size),
    [cues, doc.caption.autoFit, doc.caption.size, doc.caption.uppercase],
  );
  const keywords = useMemo(
    () => keywordMoments(doc.words, doc.caption.language),
    [doc.words, doc.caption.language],
  );
  const hasSource = !!previewUrl;
  const activeKey = useMemo(() => sveKeyframeAt(doc.keyframes, currentTime), [doc.keyframes, currentTime]);
  const allPresets = useMemo(() => [...SHORT_PRESETS, ...customPresets], [customPresets]);
  const activeTab = useMemo(() => SVE_TABS.find((t) => t.id === tab), [tab]);

  // ==========================================================================
  // Source clip
  // ==========================================================================

  const handleFile = useCallback((file?: File | null) => {
    if (!file) return;
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|webm|avi|m4v)$/i.test(file.name)) {
      notify('That file is not a video — upload an MP4, MOV, WEBM or AVI.', 'bad');
      return;
    }
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    sourceFileRef.current = file;
    uploadRef.current = null;
    analysedFor.current = '';
    setPreviewUrl(URL.createObjectURL(file));
    setClipLoading(true);
    setClipLoadingLabel('Reading the clip…');
    setCurrentTime(0);
    setPlaying(false);
    setAudioStats(null);
    setMotion(null);
    setThumbs([]);
    setVariants(null);
    setLocalUrl('');
    setExportPhase('idle');
    setExportError('');
    history.reset(applyStoredCaptionLanguage({
      ...emptyDoc(),
      title: file.name.replace(/\.[^.]+$/, ''),
      sourceName: file.name,
    }));
    setProjectId(null);
    setActivePreset('');
    savedRevision.current = -1;
  }, [history, notify, previewUrl]);

  /**
   * The source clip as a File.
   *
   * After a draft is restored from the database the browser holds only a URL,
   * so the bytes are fetched back. Storage serves these objects without CORS
   * headers, so that fetch can legitimately fail — and when it does the caller
   * is told exactly what to do instead of being handed a generic error.
   */
  const sourceFile = useCallback(async (): Promise<File> => {
    if (sourceFileRef.current) return sourceFileRef.current;
    if (!doc.sourceUrl) throw new Error('No clip is loaded — upload a video first.');
    const res = await fetch(doc.sourceUrl, { mode: 'cors' }).catch(() => null);
    if (!res || !res.ok) {
      throw new Error('this draft was restored from a saved project, so the clip itself is no longer in this browser — re-upload the same file to run this step again');
    }
    const blob = await res.blob();
    const file = new File([blob], doc.sourceName || 'clip.mp4', { type: blob.type || 'video/mp4' });
    sourceFileRef.current = file;
    return file;
  }, [doc.sourceName, doc.sourceUrl]);

  /** Push the clip to durable storage so the render service can read it. */
  const ensureUploaded = useCallback(async (): Promise<string> => {
    if (doc.sourceUrl) return doc.sourceUrl;
    if (uploadRef.current) return uploadRef.current;
    const file = sourceFileRef.current;
    if (!file) throw new Error('No clip is loaded — upload a video first.');
    const task = (async () => {
      const result = await api.uploadAsset(file);
      commit((d) => ({ ...d, sourceUrl: result.url }), 'source-url');
      void api.recordAsset({
        kind: 'clip',
        label: file.name,
        url: result.url,
        bytes: result.bytes,
        duration_s: Number(doc.durationS.toFixed(3)) || null,
      });
      return result.url;
    })();
    uploadRef.current = task;
    try {
      return await task;
    } catch (e) {
      uploadRef.current = null;
      throw e;
    }
  }, [commit, doc.durationS, doc.sourceUrl]);

  /** Audio, frames, vision and the opening-motion read — run once per clip. */
  const analyseClip = useCallback(async (url: string, duration: number) => {
    if (!url || !duration || analysedFor.current === url) return;
    analysedFor.current = url;

    // Loudness and tempo need the bytes; the frame and motion reads only need
    // the URL, so a restored draft still gets its scene analysis.
    try {
      const stats = await analyzeAudio(await sourceFile());
      setAudioStats(stats);
      if (stats?.bpm) commit((d) => ({ ...d, bpm: stats.bpm }), 'bpm');
    } catch {
      setAudioStats(null);
    }

    setVisionBusy(true);
    try {
      const frames = await sampleFrames(url, duration, 5);
      setThumbs(frames.thumbs);
      if (frames.contactSheetBase64) {
        const vision = await api.readFramesWithVision(frames.contactSheetBase64);
        commit((d) => ({ ...d, vision }), 'vision');
      } else if (frames.note) {
        commit((d) => ({
          ...d,
          vision: { sceneType: '', objects: [], mood: '', palette: [], keyMoments: [], brollTerms: [], calloutText: [], captionAccent: '', note: frames.note },
        }), 'vision');
      }
    } finally {
      setVisionBusy(false);
    }

    setMotion(await readMotion(url, duration));
  }, [commit, sourceFile]);

  const onLoadedMetadata = useCallback(() => {
    const node = videoRef.current;
    if (!node) return;
    const duration = Number.isFinite(node.duration) && node.duration > 0 ? node.duration : 0;
    if (!duration) {
      setClipLoading(false);
      notify('That clip’s length could not be read — try re-exporting it as an MP4 and uploading again.', 'bad');
      return;
    }
    commit((d) => ({
      ...d,
      durationS: duration,
      srcW: node.videoWidth || d.srcW,
      srcH: node.videoHeight || d.srcH,
    }), 'metadata');
    setClipLoading(false);
    // A restored draft already carries its scene read, so only a freshly
    // uploaded clip triggers the (wallet-billed) analysis pass.
    if (!sourceFileRef.current) return;
    notify('✓ Clip loaded — analysing it now');
    void ensureUploaded().catch((e) => notify(e instanceof Error ? e.message : String(e), 'bad'));
    void analyseClip(previewUrl, duration);
  }, [analyseClip, commit, ensureUploaded, notify, previewUrl]);

  // ==========================================================================
  // Captions
  // ==========================================================================

  const generateCaptions = useCallback(async () => {
    if (!hasSource) {
      notify('Upload a clip before generating captions.', 'bad');
      return;
    }
    setCaptionsBusy(true);
    try {
      const result = await api.transcribeClip(await sourceFile());
      const duration = doc.durationS || result.duration || 0;
      const words = result.words.length
        ? normaliseWords(result.words, duration)
        : evenTimings(result.text || doc.transcript, duration);
      if (!words.length) {
        notify(result.note || 'Caption generation failed — this clip has no readable speech. Type the transcript by hand instead.', 'bad');
        commit((d) => ({ ...d, timingSource: 'none' }), 'captions');
        return;
      }
      commit((d) => ({
        ...d,
        words,
        transcript: result.text || words.map((w) => w.text).join(' '),
        timingSource: result.words.length ? 'transcript' : 'even',
        silences: detectSilences(words, duration),
        // A fresh transcription is a new word track, so every per-line tier
        // assignment was made against lines that no longer exist. Dropping
        // them is honest; keeping them would land somebody's Impact line on
        // whatever sentence happens to start at the same second.
        captionTiers: {},
        captionEmphasis: {},
      }), 'captions');
      notify(result.note ? result.note : '✓ ' + words.length + ' words timed across the clip');
    } catch (e) {
      notify('Caption generation failed — ' + (e instanceof Error ? e.message : String(e)), 'bad');
    } finally {
      setCaptionsBusy(false);
    }
  }, [commit, doc.durationS, doc.transcript, hasSource, notify, sourceFile]);

  /**
   * The language selector.
   *
   * It writes the device preference as well as the document. It does NOT
   * change the caption treatment: the five-tier mix runs on every track
   * whatever its language. What it changes is the filler vocabulary the
   * key-word picker skips, so a Hinglish line never pops "karna".
   */
  const setCaptionLanguage = useCallback((language: CaptionLanguage) => {
    storeCaptionLanguage(language);
    commit((d) => (d.caption.language === language ? d : {
      ...d,
      caption: { ...d.caption, language },
    }), 'cap-language');
    notify(language === 'hinglish'
      ? '✓ Hinglish captions on — the key-word picker now skips Hindi filler'
      : '✓ English captions on');
  }, [commit, notify]);

  /**
   * The five-tier controls.
   *
   * A hand assignment is stored against the cue's START time rather than its
   * index, so changing “words per line” re-groups the track without moving
   * anybody's choice onto the wrong sentence — a line that still begins at
   * that moment keeps its tier, and one that no longer exists quietly falls
   * back to the automatic mix.
   */
  const setTierMode = useCallback((tierMode: CaptionTierMode) => {
    commit((d) => ({ ...d, caption: { ...d.caption, tierMode } }), 'cap-tiermode');
    notify(tierMode === 'auto'
      ? '✓ Auto mix on — lines spread 70% clean / 20% kinetic / 10% display'
      : '✓ Every line is Clean now — assign the louder tiers line by line');
  }, [commit, notify]);

  const setCueTier = useCallback((key: string, tier: CaptionTier | null) => {
    commit((d) => {
      const next = { ...d.captionTiers };
      if (tier) next[key] = tier;
      else delete next[key];
      return { ...d, captionTiers: next };
    }, 'cap-tier');
  }, [commit]);

  const setCueEmphasis = useCallback((key: string, index: number | null) => {
    commit((d) => {
      const next = { ...d.captionEmphasis };
      if (index === null) delete next[key];
      else next[key] = index;
      return { ...d, captionEmphasis: next };
    }, 'cap-emphasis');
  }, [commit]);

  const resetCueTiers = useCallback(() => {
    commit((d) => ({ ...d, captionTiers: {}, captionEmphasis: {} }), 'cap-tier-reset');
    notify('Every line is back on the automatic mix');
  }, [commit, notify]);

  /**
   * Drop the five reference Hinglish lines into the transcript so the mixed
   * styles can be seen on a real clip. They are spread evenly across its
   * length, exactly as any hand-typed transcript is.
   */
  const loadHinglishSamples = useCallback(() => {
    storeCaptionLanguage('hinglish');
    commit((d) => ({
      ...d,
      transcript: HINGLISH_SAMPLE_LINES.join(' '),
      captionTiers: {},
      captionEmphasis: {},
      caption: {
        ...d.caption,
        language: 'hinglish' as CaptionLanguage,
        // Six words a line keeps the sample sentences whole rather than
        // chopping them into three-word fragments.
        wordsPerCue: 6,
      },
    }), 'cap-sample');
    notify('Sample lines loaded — scrub the preview to see all five tiers');
  }, [commit, notify]);

  // Re-time the word track when the creator edits the transcript by hand.
  const transcriptRef = useRef(doc.transcript);
  useEffect(() => {
    if (doc.transcript === transcriptRef.current) return;
    transcriptRef.current = doc.transcript;
    const handle = window.setTimeout(() => {
      commit((d) => {
        const words = retimeFromTranscript(d, d.transcript);
        // Fixing a spelling keeps every word's measured timing, so the
        // per-line tier assignments still point at the lines they were made
        // on. Adding or removing words re-times the track and the old keys
        // no longer mean anything, so they go.
        const retimed = words.length !== d.words.length;
        return {
          ...d,
          words,
          silences: detectSilences(words, d.durationS),
          timingSource: words.length ? (d.timingSource === 'transcript' ? 'transcript' : 'even') : 'none',
          captionTiers: retimed ? {} : d.captionTiers,
          captionEmphasis: retimed ? {} : d.captionEmphasis,
        };
      }, 'retime');
    }, 700);
    return () => window.clearTimeout(handle);
  }, [commit, doc.transcript]);

  // ==========================================================================
  // Music and voice
  // ==========================================================================

  const generateMusic = useCallback(async (promptOverride?: string) => {
    if (!hasSource) {
      notify('Upload a clip first — the music brief is written from the footage.', 'bad');
      return;
    }
    setMusicNote('');
    try {
      let prompt = String(promptOverride || '').trim();
      let rationale = '';
      if (!prompt) {
        setMusicPhase('briefing');
        const brief = await api.writeMusicPrompt({
          vision: doc.vision,
          bpm: audioStats?.bpm || doc.bpm || 0,
          energy: audioStats?.energy ?? 0.5,
          durationS: doc.durationS,
          transcript: doc.transcript,
        });
        prompt = brief.prompt;
        rationale = brief.rationale;
        if (brief.note) setMusicNote(brief.note);
      }

      setMusicPhase('generating');
      const result = await api.generateMusic(prompt, doc.durationS || 30);
      const peaks = await waveformFor(result.url);
      commit((d) => ({
        ...d,
        music: {
          url: result.url,
          prompt: result.prompt,
          brief: rationale || d.music.brief,
          durationMs: result.durationMs,
          peaks,
          provider: result.provider,
        },
        audio: { ...d.audio, music: d.audio.music > 0 ? d.audio.music : 25 },
      }), 'music');
      void api.recordAsset({ kind: 'music', label: prompt.slice(0, 80), url: result.url, duration_s: result.durationMs / 1000 });
      notify('✓ Music bed generated — mixed under your original audio');
      if (!peaks.length) setMusicNote('The waveform preview could not be drawn for this file, but the track itself is fine — press play to hear it.');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'bad');
      setMusicNote(e instanceof Error ? e.message : String(e));
    } finally {
      setMusicPhase('idle');
    }
  }, [audioStats, commit, doc.bpm, doc.durationS, doc.transcript, doc.vision, hasSource, notify]);

  const clearMusic = useCallback(() => {
    commit((d) => ({ ...d, music: { ...d.music, url: '', peaks: [], durationMs: 0 } }), 'music-clear');
    notify('Music bed removed');
  }, [commit, notify]);

  /**
   * Text to speech through the platform's OpenAI proxy, uploaded straight to
   * durable storage so the render service can read it back as the music bed.
   */
  const generateVoiceover = useCallback(async (text: string, voice: string) => {
    setVoBusy(true);
    setVoNote('');
    try {
      const token = api.workspaceToken();
      if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
      const res = await fetch('/proxy/openai/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
        body: JSON.stringify({ model: 'tts-1', voice, input: text.slice(0, 3800), response_format: 'mp3' }),
      });
      if (!res.ok) throw new Error('the speech service answered HTTP ' + res.status);
      const blob = await res.blob();
      const file = new File([blob], 'voiceover-' + Date.now() + '.mp3', { type: 'audio/mpeg' });
      const result = await api.uploadAsset(file, 'short-video-enhancer-voice');
      if (!aliveRef.current) return;
      commit((d) => ({
        ...d,
        music: { url: result.url, prompt: text.slice(0, 120), brief: 'Voiceover', durationMs: 0, peaks: [], provider: 'openai-tts' },
        audio: { ...d.audio, music: Math.max(d.audio.music, 85) },
      }), 'voiceover');
      void api.recordAsset({ kind: 'voice', label: text.slice(0, 80), url: result.url, bytes: result.bytes });
      setVoNote('Voiceover generated and mixed in. Lower the music level if it sits too loud over the dialogue.');
    } catch (e) {
      setVoNote(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setVoBusy(false);
    }
  }, [commit]);

  // ==========================================================================
  // B-roll
  // ==========================================================================

  const snap = useCallback((t: number): number => {
    if (!doc.beatSync || !doc.bpm) return t;
    const period = 60 / doc.bpm;
    return Math.max(0, Math.round(t / period) * period);
  }, [doc.beatSync, doc.bpm]);

  const defaultWindow = useCallback((at?: number) => {
    const duration = Math.max(1, doc.durationS);
    const start = clamp(snap(at ?? currentTime), 0, Math.max(0, duration - 1));
    return { start, end: Math.min(duration, start + Math.min(3.5, duration - start)) };
  }, [currentTime, doc.durationS, snap]);

  const searchStock = useCallback(async (term: string) => {
    setStockBusy(true);
    setStockNote('');
    try {
      const answer = await api.searchPexelsVideos(term);
      setStock(answer.clips);
      setStockNote(answer.note);
    } finally {
      setStockBusy(false);
    }
  }, []);

  const addStockClip = useCallback((clip: api.PexelsClip) => {
    const window = defaultWindow();
    commit((d) => ({
      ...d,
      broll: d.broll.concat([{
        id: newId('broll'),
        url: clip.url,
        name: clip.name,
        start: window.start,
        end: window.end,
        layout: 'corner',
        opacity: 0.6,
        source: 'pexels',
        posterUrl: clip.posterUrl,
      }]),
    }), 'broll-add');
    notify('✓ B-roll added as a corner overlay — your original audio keeps playing');
  }, [commit, defaultWindow, notify]);

  const uploadBroll = useCallback(async (file: File) => {
    setBrollUploading(true);
    try {
      const result = await api.uploadAsset(file, 'short-video-enhancer-broll');
      const window = defaultWindow();
      commit((d) => ({
        ...d,
        broll: d.broll.concat([{
          id: newId('broll'),
          url: result.url,
          name: file.name,
          start: window.start,
          end: window.end,
          layout: 'corner',
          opacity: 0.6,
          source: 'upload',
          posterUrl: '',
        }]),
      }), 'broll-add');
      void api.recordAsset({ kind: 'broll', label: file.name, url: result.url, bytes: result.bytes });
      notify('✓ B-roll uploaded and placed on the timeline');
    } catch (e) {
      notify('B-roll upload failed — ' + (e instanceof Error ? e.message : String(e)), 'bad');
    } finally {
      setBrollUploading(false);
    }
  }, [commit, defaultWindow, notify]);

  const pinToKeyword = useCallback((word: string, at: number) => {
    if (!doc.broll.length) {
      notify('Add a B-roll clip first, then pin it to “' + word + '”.', 'bad');
      return;
    }
    const window = defaultWindow(at);
    const last = doc.broll[doc.broll.length - 1];
    commit((d) => ({
      ...d,
      broll: d.broll.map((c) => (c.id === last.id ? { ...c, start: window.start, end: window.end, keyword: word } : c)),
    }), 'broll-pin');
    notify('✓ “' + last.name + '” pinned to “' + word + '” at ' + formatClock(at));
  }, [commit, defaultWindow, doc.broll, notify]);

  /** Film a vertical cutaway and drop it on the B-roll track. */
  const generateScene = useCallback(async (): Promise<string> => {
    if (!api.workspaceToken()) throw new Error('Your workspace session is still loading — try again in a moment.');
    const subject = doc.vision?.sceneType || doc.transcript.slice(0, 120) || doc.title;
    const prompt = [
      'Cinematic vertical B-roll of ' + (subject || 'the subject of this short') + '.',
      doc.vision?.mood ? 'Carry a ' + doc.vision.mood + ' mood.' : '',
      doc.vision?.palette.length ? 'Use a ' + doc.vision.palette.join(', ') + ' palette.' : '',
      'Five-second 9:16 composition, natural continuity, no on-screen text, no logos.',
    ].filter(Boolean).join(' ');

    const { res: start, data: started } = await postGeneration('/api/veo/generate/video', {
      model: defaultModelFor(APP_IDS.shortVideoEnhancer),
      prompt,
      aspectRatio: '9:16',
      duration: 5,
      resolution: '1080p',
      generateAudio: false,
    }, APP_IDS.shortVideoEnhancer);
    if (!start.ok || !started?.operationId) {
      throw new Error(String(started?.error || 'the video model could not start (HTTP ' + start.status + ')'));
    }

    const operationId = String(started.operationId);
    for (let attempt = 0; attempt < 72 && aliveRef.current; attempt += 1) {
      await new Promise((resolve) => { window.setTimeout(resolve, 5000); });
      if (!aliveRef.current) return '';
      const poll = await fetch('/api/veo/status/' + encodeURIComponent(operationId), {
        headers: generationHeaders(APP_IDS.shortVideoEnhancer),
      });
      const status = await poll.json().catch(() => null);
      if (!poll.ok || !status) throw new Error('could not check the generation status (HTTP ' + poll.status + ')');
      if (status.status === 'failed') throw new Error(String(status.errorMessage || 'the video model could not generate this clip'));
      if (status.status === 'completed' && status.videoUrl) {
        const window = defaultWindow();
        commit((d) => ({
          ...d,
          broll: d.broll.concat([{
            id: newId('broll'),
            url: String(status.videoUrl),
            name: 'Generated scene',
            start: window.start,
            end: window.end,
            layout: 'blend',
            opacity: 0.85,
            source: 'upload',
            posterUrl: '',
          }]),
        }), 'broll-add');
        return 'A matched vertical cutaway was filmed and placed at ' + formatClock(window.start) + '.';
      }
    }
    throw new Error('the video model took too long to finish — try again');
  }, [commit, defaultWindow, doc.title, doc.transcript, doc.vision]);

  // ==========================================================================
  // Graphic cards
  // ==========================================================================

  const addCard = useCallback((kind: CardKind, preset?: { title?: string; subtitle?: string }) => {
    const duration = Math.max(1.2, doc.durationS);
    const start = kind === 'hook' ? 0 : kind === 'cta' ? Math.max(0, duration - 3) : clamp(snap(currentTime), 0, duration - 1);
    const end = kind === 'hook' ? Math.min(3, duration) : Math.min(duration, start + 3);
    const id = newId('card');
    commit((d) => ({
      ...d,
      cards: d.cards.concat([{
        id,
        kind,
        title: preset?.title || (kind === 'hook' ? 'STOP SCROLLING' : kind === 'cta' ? 'FOLLOW FOR MORE' : 'Your name here'),
        subtitle: preset?.subtitle || (kind === 'cta' ? 'New shorts every week' : ''),
        start,
        end,
        color: kind === 'cta' ? '#F59E0B' : d.caption.accent,
      }]),
    }), 'card-add');
    setSelectedCardId(id);
    return id;
  }, [commit, currentTime, doc.durationS, snap]);

  const duplicateCard = useCallback((id: string) => {
    commit((d) => {
      const source = d.cards.find((c) => c.id === id);
      if (!source) return d;
      const span = source.end - source.start;
      const start = Math.min(Math.max(0, d.durationS - span), source.end + 0.2);
      return { ...d, cards: d.cards.concat([{ ...source, id: newId('card'), start, end: start + span }]) };
    }, 'card-duplicate');
  }, [commit]);

  // ==========================================================================
  // Looks, presets, motion
  // ==========================================================================

  const applyPreset = useCallback((id: string) => {
    const preset = allPresets.find((p) => p.id === id);
    if (!preset) return;
    commit((d) => ({
      ...d,
      grade: { ...d.grade, filter: preset.filter },
      caption: {
        ...d.caption,
        preset: preset.captionPreset,
        accent: preset.accent,
        uppercase: preset.uppercase,
        posY: preset.posY,
        wordsPerCue: preset.wordsPerCue,
      },
      audio: { ...d.audio, music: preset.musicLevel },
      smoothLoop: preset.loop,
      motionKind: preset.motion,
      motionAmount: preset.motionAmount,
      keyframes: sveMotionKeys(preset.motion, d.durationS, preset.motionAmount, d.bpm),
    }), 'preset');
    setActivePreset(id);
    notify('✓ ' + preset.label + ' applied across the whole edit');
  }, [allPresets, commit, notify]);

  const savePreset = useCallback(() => {
    const label = (window.prompt('Name this preset', 'My look') || '').trim().slice(0, 28);
    if (!label) return;
    const row: ShortPreset = {
      id: 'custom-' + Date.now().toString(36),
      label,
      blurb: 'Saved from this edit',
      filter: doc.grade.filter,
      captionPreset: doc.caption.preset,
      accent: doc.caption.accent,
      uppercase: doc.caption.uppercase,
      posY: doc.caption.posY,
      wordsPerCue: doc.caption.wordsPerCue,
      motion: doc.motionKind,
      motionAmount: doc.motionAmount,
      musicLevel: doc.audio.music,
      loop: doc.smoothLoop,
    };
    const next = [row, ...customPresets].slice(0, 12);
    setCustomPresets(next);
    try { window.localStorage.setItem(PRESET_STORE, JSON.stringify(next)); } catch { /* storage unavailable */ }
    notify('✓ “' + label + '” saved to your presets');
  }, [customPresets, doc, notify]);

  const applyMotion = useCallback((kind: SveMotionKind, amount: number) => {
    commit((d) => ({
      ...d,
      motionKind: kind,
      motionAmount: amount,
      keyframes: sveMotionKeys(kind, d.durationS, amount, d.bpm),
    }), 'motion');
  }, [commit]);

  const toggleKeyframe = useCallback(() => {
    commit((d) => {
      const at = currentTime;
      const hit = d.keyframes.findIndex((k) => Math.abs(k.t - at) < 0.12);
      if (hit >= 0) return { ...d, keyframes: d.keyframes.filter((_, i) => i !== hit) };
      const base = sveKeyframeAt(d.keyframes, at) || { t: at, opacity: 1, scale: 1, x: 0, y: 0 };
      return {
        ...d,
        keyframes: d.keyframes.concat([{ ...base, t: at }]).sort((a, b) => a.t - b.t),
      };
    }, 'keyframe');
  }, [commit, currentTime]);

  const resetColor = useCallback(() => {
    commit((d) => ({
      ...d,
      grade: {
        ...d.grade,
        brightness: 0,
        contrast: 0,
        saturation: 0,
        highlights: 0,
        shadows: 0,
        temperature: 0,
        tint: 0,
        filter: 'None',
      },
    }), 'grade-reset');
    notify('Colour reset to the original footage');
  }, [commit, notify]);

  // ==========================================================================
  // Agent
  // ==========================================================================

  const runBeatSync = useCallback(async (): Promise<string> => {
    setBeatBusy(true);
    try {
      let bpm = doc.bpm;
      if (!bpm) {
        const stats = await analyzeAudio(await sourceFile());
        setAudioStats(stats);
        bpm = stats?.bpm || 0;
      }
      if (!bpm) return 'No steady pulse could be measured in this clip’s audio.';
      const period = 60 / bpm;
      const round = (t: number) => Math.max(0, Math.round(t / period) * period);
      commit((d) => ({
        ...d,
        bpm,
        beatSync: true,
        cards: d.cards.map((c) => {
          const start = round(c.start);
          return { ...c, start, end: Math.max(start + period, round(c.end)) };
        }),
        broll: d.broll.map((b) => {
          const start = round(b.start);
          return { ...b, start, end: Math.max(start + period, round(b.end)) };
        }),
        keyframes: d.motionKind === 'pulse' ? sveMotionKeys('pulse', d.durationS, d.motionAmount, bpm) : d.keyframes,
      }), 'beat-sync');
      return Math.round(bpm) + ' BPM measured — every card and cutaway now lands on a beat.';
    } finally {
      if (aliveRef.current) setBeatBusy(false);
    }
  }, [commit, doc.bpm, sourceFile]);

  const runSmartTrim = useCallback((): string => {
    if (!doc.words.length) return 'Generate captions first — the silence map is measured from the word timing.';
    const gaps = doc.silences.filter((s) => s.end - s.start >= 0.45);
    if (!gaps.length) return 'No silent stretch long enough to cut was measured in this clip.';
    const total = gaps.reduce((n, g) => n + (g.end - g.start), 0);
    return gaps.length + ' silent stretch' + (gaps.length === 1 ? '' : 'es')
      + ' totalling ' + total.toFixed(1) + 's are marked on the AUDIO track. Trim the source clip to those points before '
      + 're-uploading — this editor composites one continuous clip, so it cannot cut it into pieces for you.';
  }, [doc.silences, doc.words.length]);

  const runAutoEnhance = useCallback(async (): Promise<string> => {
    if (!hasSource) return 'Upload a clip first.';
    const notes: string[] = [];
    if (!doc.words.length) { await generateCaptions(); notes.push('captions'); }
    if (!doc.vision) { await analyseClip(previewUrl, doc.durationS); notes.push('a scene read'); }
    const mood = doc.vision?.mood || '';
    const filter = mood === 'calm' ? 'Matte' : mood === 'dramatic' ? 'Cinematic' : mood === 'energetic' ? 'Vivid' : 'Cinematic';
    commit((d) => ({
      ...d,
      grade: { ...d.grade, filter },
      motionKind: 'kenBurns',
      motionAmount: 0.5,
      keyframes: sveMotionKeys('kenBurns', d.durationS, 0.5, d.bpm),
      caption: { ...d.caption, accent: d.vision?.captionAccent || d.caption.accent },
    }), 'auto-enhance');
    if (!doc.cards.some((c) => c.kind === 'hook') && motion?.staticOpening) {
      addCard('hook', { title: doc.vision?.calloutText[0] || 'STOP SCROLLING' });
      notes.push('an opening hook');
    }
    if (!doc.cards.some((c) => c.kind === 'cta') && motion?.abruptEnding) {
      addCard('cta');
      notes.push('a closing CTA');
    }
    return 'Graded with the ' + filter + ' look and given a slow Ken Burns drift'
      + (notes.length ? ', plus ' + notes.join(', ') + '.' : '.');
  }, [addCard, analyseClip, commit, doc.cards, doc.durationS, doc.vision, doc.words.length, generateCaptions, hasSource, motion, previewUrl]);

  const runAgentAction = useCallback(async (id: SveAgentActionId) => {
    if (agentRunning) return;
    setAgentRunning(id);
    setAgentJobs((jobs) => ({ ...jobs, [id]: { state: 'running' as RunState, note: '' } }));
    let note = '';
    let ok = true;
    try {
      if (id === 'enhance') note = await runAutoEnhance();
      else if (id === 'caption') {
        await generateCaptions();
        note = doc.words.length ? 'Caption track rebuilt.' : 'Transcription finished — check the Effects tab.';
      } else if (id === 'beat') note = await runBeatSync();
      else if (id === 'trim') note = runSmartTrim();
      else if (id === 'scene') note = await generateScene();
    } catch (e) {
      ok = false;
      note = e instanceof Error ? e.message : String(e);
    }
    if (!aliveRef.current) return;
    setAgentRunning('');
    setAgentJobs((jobs) => ({ ...jobs, [id]: { state: (ok ? 'done' : 'failed') as RunState, note } }));
  }, [agentRunning, doc.words.length, generateCaptions, generateScene, runAutoEnhance, runBeatSync, runSmartTrim]);

  const sendToAgent = useCallback(async (text: string) => {
    setChat((c) => c.concat([{ id: newId('m'), role: 'user', content: text }]));
    const routed = routeSveInstruction(text);
    if (!routed) {
      setChat((c) => c.concat([{
        id: newId('m'),
        role: 'assistant',
        content: 'I can auto-enhance, caption, beat-sync, smart-trim, apply a preset or generate a scene. Name one of those and I will run it.',
      }]));
      return;
    }
    if (routed === 'preset') {
      const match = allPresets.find((p) => text.toLowerCase().includes(p.label.toLowerCase()));
      if (match) {
        applyPreset(match.id);
        setChat((c) => c.concat([{ id: newId('m'), role: 'assistant', content: 'Applied the ' + match.label + ' preset.' }]));
        return;
      }
      setChat((c) => c.concat([{
        id: newId('m'),
        role: 'assistant',
        content: 'Which preset? ' + allPresets.map((p) => p.label).join(', ') + '.',
      }]));
      return;
    }
    setChat((c) => c.concat([{ id: newId('m'), role: 'assistant', content: 'On it — running ' + routed + '.' }]));
    await runAgentAction(routed);
  }, [allPresets, applyPreset, runAgentAction]);

  // ==========================================================================
  // Export
  // ==========================================================================

  const buildRenderProps = useCallback(() => ({
    base: { url: doc.sourceUrl, volume: doc.audio.original / 100 },
    grade: {
      brightness: doc.grade.brightness,
      contrast: doc.grade.contrast,
      saturation: doc.grade.saturation,
      highlights: doc.grade.highlights,
      shadows: doc.grade.shadows,
      temperature: doc.grade.temperature,
      tint: doc.grade.tint,
      filterCss: FILTER_GRADES[doc.grade.filter]?.css || 'none',
    },
    audio: { fadeIn: doc.audio.fadeIn, fadeOut: doc.audio.fadeOut },
    keyframes: doc.keyframes.map((k) => ({
      t: Number(k.t.toFixed(3)),
      opacity: Number(k.opacity.toFixed(3)),
      scale: Number(k.scale.toFixed(4)),
      x: Number(k.x.toFixed(4)),
      y: Number(k.y.toFixed(4)),
    })),
    smoothLoop: doc.smoothLoop,
    captionsEnabled: doc.captionsEnabled && cues.length > 0,
    captionSize,
    captionDesign: {
      preset: doc.caption.preset,
      language: doc.caption.language,
      color: doc.caption.color,
      accent: doc.caption.accent,
      posY: doc.caption.posY,
      pill: doc.caption.pill,
      uppercase: doc.caption.uppercase,
    },
    // The tier travels with the cue, so the renderer draws the same mix of
    // clean, kinetic, cinematic, beat and UI lines the preview just showed.
    cues: cues.map((cue) => ({
      start: cue.start,
      end: cue.end,
      tier: cue.tier || 'clean',
      words: cue.words.map((w) => ({ text: w.text, start: w.start, end: w.end, emphasis: !!w.emphasis })),
    })),
    broll: doc.broll.map((b) => ({ url: b.url, start: b.start, end: b.end, layout: b.layout, opacity: b.opacity })),
    cards: doc.cards.map((c) => ({ kind: c.kind, title: c.title, subtitle: c.subtitle, start: c.start, end: c.end, color: c.color })),
    music: doc.music.url ? { url: doc.music.url, volume: doc.audio.music / 100 } : null,
  }), [captionSize, cues, doc]);

  const exportMaster = useCallback(async () => {
    if (!sourceFileRef.current && !doc.sourceUrl) {
      notify('Upload a clip before exporting.', 'bad');
      return;
    }
    setExportError('');
    setVariants(null);
    setElapsedS(0);
    const startedAt = Date.now();
    const ticker = window.setInterval(() => setElapsedS(Math.round((Date.now() - startedAt) / 1000)), 1000);

    try {
      setExportPhase('uploading');
      await ensureUploaded();

      setExportPhase('submitting');
      const frames = Math.max(30, Math.round((doc.durationS || 10) * FPS));
      let answer = await api.submitRender(buildRenderProps(), frames);

      setExportPhase('rendering');
      let guard = 0;
      while (answer.status === 'rendering' && answer.operationId && guard < 12) {
        guard += 1;
        answer = await api.continueRender(answer.operationId, answer.geometry || '');
      }
      if (answer.status !== 'complete' || !answer.renderUrl) {
        throw new Error(answer.error || 'The render did not finish in time. Press Export again to keep waiting — nothing was lost.');
      }
      setExportGeometry(answer.geometry || '1080×1920 · H.264');

      setExportPhase('sizing');
      const sizes = await api.buildExportVariants(answer.renderUrl);
      setVariants(sizes);
      setExportPhase('ready');
      notify('✓ Export complete — pick a download below');

      void api.updateProject(projectId, {
        status: 'exported',
        render_url: sizes.master.url,
        render_operation_id: answer.operationId || null,
        render_geometry: answer.geometry || null,
        render_error: null,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setExportError(message);
      setExportPhase('failed');
      notify('Export failed — ' + message, 'bad');
      void api.updateProject(projectId, { status: 'failed', render_error: message });
    } finally {
      window.clearInterval(ticker);
    }
  }, [buildRenderProps, doc.durationS, doc.sourceUrl, ensureUploaded, notify, projectId]);

  const exportLocal = useCallback(async () => {
    const video = videoRef.current;
    if (!video) { setExportError('Load a clip first.'); return; }
    setExportError('');
    setLocalUrl('');
    setLocalProgress(0);
    try {
      const options = {
        video,
        aspect: exportSpec.target,
        filter: gradeCss(doc),
        startS: 0,
        endS: doc.durationS,
        fps: exportSpec.fps,
        onProgress: (p: number) => { if (aliveRef.current) setLocalProgress(p); },
      };
      const blob = exportSpec.format === 'gif'
        ? await encodeSveGif(options)
        : await encodeSveWebm({ ...options, bitrate: exportSpec.bitrate });
      if (!aliveRef.current) return;
      setLocalUrl(URL.createObjectURL(blob));
      setLocalBytes(blob.size);
      setLocalProgress(1);
      notify('✓ ' + exportSpec.format.toUpperCase() + ' encoded in your browser');
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setExportError(/taint|securityerror|insecure|cross-origin/i.test(raw)
        ? 'Your browser refused to read the frames because this clip is served without CORS headers. Export MP4 instead — that render runs on the server.'
        : raw);
    }
  }, [doc.durationS, doc.grade.filter, exportSpec, notify]);

  const downloadVariant = useCallback(async (which: 'master' | 'compressed' | 'local') => {
    const safeName = (doc.title || 'short').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 48);
    if (which === 'local') {
      if (!localUrl) return;
      const a = document.createElement('a');
      a.href = localUrl;
      a.download = safeName + '.' + exportSpec.format;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    const variant = which === 'master' ? variants?.master : variants?.compressed;
    if (!variant?.url) return;
    setDownloading(which);
    try {
      const outcome = await api.downloadVideo(variant.url, safeName + (which === 'compressed' ? '-share' : '') + '.mp4');
      notify(outcome === 'downloaded'
        ? '✓ Saved to your downloads'
        : 'Your browser blocked the direct save, so the file opened in a new tab — use the tab’s download control.');
    } finally {
      setDownloading('');
    }
  }, [doc.title, exportSpec.format, localUrl, notify, variants]);

  /**
   * The caption track as a sidecar subtitle file.
   *
   * The words are written exactly as the transcript holds them: UPPERCASE is a
   * visual treatment of the burnt-in track, and a sidecar is read by players,
   * search indexes and screen readers that are all better served by the real
   * casing. Romanized Hindi is Latin script, so a Hinglish track needs nothing
   * beyond the UTF-8 both formats already are.
   */
  const downloadCaptionFile = useCallback((format: 'srt' | 'vtt') => {
    const text = format === 'srt' ? captionsToSrt(cues) : captionsToVtt(cues);
    if (!text) {
      notify('Generate captions first — there is no cue list to write out yet.', 'bad');
      return;
    }
    const safeName = (doc.title || 'short').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 48);
    const blob = new Blob([text], {
      type: (format === 'srt' ? 'application/x-subrip' : 'text/vtt') + ';charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName + '.' + format;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 20000);
    notify('✓ ' + cues.length + ' cues saved as ' + format.toUpperCase());
  }, [cues, doc.title, notify]);

  const shareLink = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify('✓ Link copied');
    } catch {
      notify('Your browser blocked the copy — use Download instead.', 'bad');
    }
  }, [notify]);

  // ==========================================================================
  // Autosave every 30 seconds
  // ==========================================================================

  const saveProject = useCallback(async (silent = true) => {
    if (!doc.sourceUrl) return;
    setSaving(true);
    try {
      const fields = {
        title: doc.title,
        status: exportPhase === 'ready' ? 'exported' : 'editing',
        duration_s: Number(doc.durationS.toFixed(3)),
        frames: Math.round(doc.durationS * FPS),
        source_url: doc.sourceUrl,
        doc,
        saved_at: new Date().toISOString(),
      };
      if (projectId) {
        await api.updateProject(projectId, fields);
      } else {
        const id = await api.insertProject(fields);
        if (id) setProjectId(id);
      }
      savedRevision.current = history.revision;
      setSavedAt(Date.now());
      if (!silent) notify('✓ Saved to Projects');
    } catch (e) {
      if (!silent) notify('Could not save this project — ' + (e instanceof Error ? e.message : String(e)), 'bad');
    } finally {
      setSaving(false);
    }
  }, [doc, exportPhase, history.revision, notify, projectId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (history.revision !== savedRevision.current) void saveProject(true);
    }, AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [history.revision, saveProject]);

  // ==========================================================================
  // Transport
  // ==========================================================================

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play(); else video.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !doc.durationS) return;
    const t = clamp(time, 0, doc.durationS);
    video.currentTime = t;
    setCurrentTime(t);
  }, [doc.durationS]);

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const toggleFullscreen = () => {
    const node = stageShellRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen?.().catch(() => notify('This browser would not open the preview full screen.', 'bad'));
  };

  // Keyboard: space to play, K for a keyframe, Del to remove the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); toggleKeyframe(); return; }
      if (e.key.toLowerCase() === 'd' && selectedCardId) { e.preventDefault(); duplicateCard(selectedCardId); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(currentTime - (e.shiftKey ? 1 : 1 / FPS)); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(currentTime + (e.shiftKey ? 1 : 1 / FPS)); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedCardId) {
          e.preventDefault();
          commit((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== selectedCardId) }), 'card-delete');
          setSelectedCardId(null);
        } else if (selectedBrollId) {
          e.preventDefault();
          commit((d) => ({ ...d, broll: d.broll.filter((b) => b.id !== selectedBrollId) }), 'broll-delete');
          setSelectedBrollId(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, currentTime, duplicateCard, seek, selectedBrollId, selectedCardId, toggleKeyframe, togglePlay]);

  // ==========================================================================
  // Checklists
  // ==========================================================================

  const checklist = useMemo(() => buildChecklist(doc, motion, {
    addHook: () => addCard('hook', { title: doc.vision?.calloutText[0] || 'STOP SCROLLING' }),
    addCta: () => addCard('cta'),
    generateCaptions: () => { setTab('effects'); void generateCaptions(); },
    addMusic: () => { setTab('audio'); void generateMusic(); },
    openBroll: () => setAgentOpen(true),
  }), [addCard, doc, generateCaptions, generateMusic, motion]);

  /** The Shorts tab's own, format-specific checklist. */
  const shortsChecklist = useMemo(() => [
    {
      id: 'hook',
      label: 'Opens with a hook',
      done: doc.cards.some((c) => c.kind === 'hook'),
      hint: 'The first three seconds decide whether the short is watched at all.',
      fix: () => addCard('hook', { title: doc.vision?.calloutText[0] || 'STOP SCROLLING' }),
    },
    {
      id: 'captions',
      label: 'Captions on screen',
      done: doc.words.length > 0 && doc.captionsEnabled,
      hint: 'Most shorts are watched muted.',
      fix: () => { setTab('effects'); void generateCaptions(); },
    },
    {
      id: 'music',
      label: 'Music bed under the voice',
      done: Boolean(doc.music.url),
      hint: 'A bed holds attention through the quiet moments.',
      fix: () => { setTab('audio'); void generateMusic(); },
    },
    {
      id: 'motion',
      label: 'The frame moves',
      done: doc.motionKind !== 'none',
      hint: 'A static frame reads as a still to the algorithm and the viewer.',
      fix: () => { setTab('motion'); applyMotion('kenBurns', 0.5); },
    },
    {
      id: 'cta',
      label: 'Closes with a CTA',
      done: doc.cards.some((c) => c.kind === 'cta'),
      hint: 'Tell the viewer what to do in the last three seconds.',
      fix: () => addCard('cta'),
    },
    {
      id: 'length',
      label: 'Under 60 seconds',
      done: doc.durationS > 0 && doc.durationS <= 60,
      hint: 'Shorts and Reels both cap at a minute.',
    },
  ], [addCard, applyMotion, doc, generateCaptions, generateMusic]);

  const exportBlocked = !hasSource
    ? 'Upload a clip to enable export.'
    : !doc.durationS
      ? 'Waiting for the clip’s length to be read.'
      : '';

  const progress = doc.durationS ? (currentTime / doc.durationS) * 100 : 0;
  const stageWidth = shortAspectRatio(doc.aspect) >= 1 ? '100%' : 'min(100%, 42vh)';

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    // The Phase 1 stylesheet fills its positioned ancestor with
    // `position:absolute; inset:0`, and the pro layout is happy either way —
    // so the fill is pinned inline rather than left to whichever stylesheet
    // happens to load second.
    <div className="vp-root sve-premium sve-studio" style={{ position: 'absolute', inset: 0 }}>
      <style>{SVE_BASE_STYLES}</style>
      <style>{SVE_PHASE2_STYLES}</style>
      <style>{PRO_CSS}</style>
      <style>{SVE_SHELL_FIXES}</style>
      {/* Loaded last: density, the retractable rail and the pointer-event rules. */}
      <style>{SVE_STUDIO_CSS}</style>
      <link rel="stylesheet" href={PRO_FONTS_URL} />
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
        hidden
        onChange={(event) => { handleFile(event.target.files?.[0]); event.currentTarget.value = ''; }}
      />

      <header className="vp-head">
        <span className="vp-brand">
          <span className="vp-mark"><Clapperboard size={16} color="#FFFFFF" /></span>
          <span>
            <b>Short Video Enhancer</b>
            <small>{hasSource ? doc.sourceName || 'Untitled short' : 'Vidverge pro editor · vertical'}</small>
          </span>
        </span>
        <span className="vp-divider" />
        <button type="button" className="vp-ico" title="Undo (Ctrl+Z)" disabled={!history.canUndo} onClick={history.undo}>
          <Undo2 size={14} />
        </button>
        <button type="button" className="vp-ico" title="Redo (Ctrl+Y)" disabled={!history.canRedo} onClick={history.redo}>
          <Redo2 size={14} />
        </button>
        <span className="vp-headgap" />
        <span className="vp-note" style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {saving ? <Loader2 size={11} className="vp-spin" /> : <Check size={11} />}
          {saving ? 'Saving…' : savedAt ? 'Saved ' + formatClock((Date.now() - savedAt) / 1000) + ' ago' : 'Autosave on'}
        </span>
        <button
          type="button"
          className="vp-btn"
          title={hasSource ? 'Swap in a different clip — this starts a new edit' : 'Upload an MP4, MOV, WebM or AVI'}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={14} /> {hasSource ? 'Replace' : 'Upload'}
        </button>
        <button
          type="button"
          className={'vp-btn' + (agentOpen ? ' on' : '')}
          title="Open the AI agent"
          onClick={() => setAgentOpen((v) => !v)}
        >
          <Sparkles size={14} /> Agent
        </button>
        <button
          type="button"
          className="vp-btn primary"
          disabled={!hasSource}
          title={hasSource ? 'Render the 1080×1920 master and pick a download' : 'Upload a clip to enable export'}
          onClick={() => setExportOpen(true)}
        >
          <Download size={14} /> Export
        </button>
      </header>

      <div
        className="vp-body"
        style={{
          '--ve-tl-h': tlCollapsed || timelineHeight <= 0 ? 'auto' : `${timelineHeight}px`,
          '--sve-side-w': sideCollapsed ? '46px' : '332px',
        } as CSSProperties}
      >
        <div className="vp-stagecol">
          {agentOpen ? (
            <SveProAgent
              jobs={agentJobs}
              running={agentRunning}
              hasSource={hasSource}
              canUndo={history.canUndo}
              presets={allPresets.map((p) => ({ id: p.id, label: p.label }))}
              messages={chat}
              onClose={() => setAgentOpen(false)}
              onRun={(id) => { void runAgentAction(id); }}
              onPreset={applyPreset}
              onUndo={history.undo}
              onSend={(text) => { void sendToAgent(text); }}
            >
              <SveOptimizationCard items={checklist} />

              <SveSuggestionsCard
                vision={doc.vision}
                thumbs={thumbs}
                analysing={visionBusy}
                hasSource={hasSource}
                onUseBrollTerm={(term) => { void searchStock(term); }}
                onUseCallout={(text) => addCard('lower', { title: text })}
                onUseAccent={(hex) => commit((d) => ({ ...d, caption: { ...d.caption, accent: hex } }), 'cap-accent')}
                onRerun={() => { analysedFor.current = ''; void analyseClip(previewUrl, doc.durationS); }}
              />

              <SveCaptionPanel
                doc={doc}
                cues={cues}
                tiers={captionTiers}
                captionSize={captionSize}
                open={!!drawerOpen.captions}
                onToggleOpen={() => toggleDrawer('captions')}
                busy={captionsBusy}
                hasSource={hasSource}
                onUpdate={commit}
                onLanguage={setCaptionLanguage}
                onLoadSamples={loadHinglishSamples}
                onGenerate={() => void generateCaptions()}
              />

              <SveMusicPanel
                doc={doc}
                open={!!drawerOpen.music}
                onToggleOpen={() => toggleDrawer('music')}
                hasSource={hasSource}
                phase={musicPhase}
                note={musicNote}
                onUpdate={commit}
                onGenerate={(prompt) => void generateMusic(prompt)}
                onClear={clearMusic}
              />

              <SveBrollPanel
                doc={doc}
                open={!!drawerOpen.broll}
                onToggleOpen={() => toggleDrawer('broll')}
                hasSource={hasSource}
                currentTime={currentTime}
                searching={stockBusy}
                uploading={brollUploading}
                stock={stock}
                stockNote={stockNote}
                suggestedTerms={doc.vision?.brollTerms || []}
                keywordMoments={keywords}
                onUpdate={commit}
                onSearch={(term) => void searchStock(term)}
                onAddStock={addStockClip}
                onUploadBroll={(file) => void uploadBroll(file)}
                onPinToKeyword={pinToKeyword}
              />

              <SveCardsPanel
                doc={doc}
                open={!!drawerOpen.cards}
                onToggleOpen={() => toggleDrawer('cards')}
                hasSource={hasSource}
                selectedId={selectedCardId}
                onSelect={setSelectedCardId}
                onUpdate={commit}
                onAdd={(kind) => { addCard(kind); }}
              />
            </SveProAgent>
          ) : null}

          <div className="vp-stage" ref={stageShellRef}>
            {!hasSource ? (
              <label
                className="vp-drop"
                style={{ cursor: 'pointer', display: 'block' }}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('hot'); }}
                onDragLeave={(e) => e.currentTarget.classList.remove('hot')}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('hot');
                  handleFile(e.dataTransfer.files?.[0]);
                }}
              >
                <span style={{ display: 'inline-grid', placeItems: 'center', width: 62, height: 62, borderRadius: 14, background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.42)' }}>
                  <Upload size={28} color="#A78BFA" />
                </span>
                <h3>Drop your vertical clip here</h3>
                <p>
                  MP4, MOV, WebM or AVI up to 500&nbsp;MB. The master always exports 1080×1920, ready for TikTok,
                  Reels and Shorts.
                </p>
                <span className="vp-btn primary" style={{ pointerEvents: 'none' }}>
                  <Upload size={14} /> Choose a file
                </span>
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
                  style={{ display: 'none' }}
                  onChange={(event) => { handleFile(event.target.files?.[0]); event.currentTarget.value = ''; }}
                />
              </label>
            ) : (
              <>
                <div className="vp-stagetop">
                  {SHORT_ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="vp-chip"
                      title={a.blurb}
                      onClick={() => commit((d) => ({ ...d, aspect: a.id as ShortAspect }), 'aspect')}
                      style={{
                        cursor: 'pointer',
                        borderColor: doc.aspect === a.id ? 'rgba(124,58,237,0.75)' : undefined,
                        color: doc.aspect === a.id ? '#C4B5FD' : undefined,
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                  <span className="vp-headgap" />
                  <button
                    type="button"
                    className="vp-chip"
                    title={showSafeArea ? 'Hide the safe-zone guide' : 'Show the safe-zone guide'}
                    style={{ cursor: 'pointer', color: showSafeArea ? '#C4B5FD' : undefined }}
                    onClick={() => setShowSafeArea((v) => !v)}
                  >
                    <Ruler size={11} /> Safe
                  </button>
                  <button type="button" className="vp-chip" title="Full screen" style={{ cursor: 'pointer' }} onClick={toggleFullscreen}>
                    <Maximize2 size={11} />
                  </button>
                </div>

                <div
                  className="vp-stageinner"
                  style={{
                    width: stageWidth,
                    transform: activeKey
                      ? 'translate(' + (activeKey.x * 100).toFixed(2) + '%,' + (activeKey.y * 100).toFixed(2) + '%) scale(' + activeKey.scale.toFixed(3) + ')'
                      : undefined,
                    opacity: activeKey ? activeKey.opacity : 1,
                  }}
                >
                  <SveStage
                    doc={doc}
                    cues={cues}
                    captionSize={captionSize}
                    currentTime={currentTime}
                    previewUrl={previewUrl}
                    loading={clipLoading}
                    loadingLabel={clipLoadingLabel}
                    showSafeArea={showSafeArea}
                    videoRef={videoRef}
                    onPickFile={() => fileRef.current?.click()}
                    onDropFile={(file) => handleFile(file)}
                    onLoadedMetadata={onLoadedMetadata}
                    onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                  {compareAB ? (
                    <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', clipPath: 'inset(0 50% 0 0)', overflow: 'hidden' }}>
                      <video
                        src={previewUrl}
                        muted
                        playsInline
                        ref={(node) => { if (node) { try { node.currentTime = currentTime; } catch { /* not seekable yet */ } } }}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
                      />
                      <span className="vp-chip" style={{ position: 'absolute', left: 8, top: 8 }}>BEFORE</span>
                    </div>
                  ) : null}
                  {doc.aspect !== '9:16' ? (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 5,
                        pointerEvents: 'none',
                        boxShadow: 'inset 0 0 0 2px rgba(124,58,237,0.55)',
                        // The safe frame for the chosen crop, centred on the
                        // 9:16 master the renderer always produces.
                        clipPath: 'inset(' + Math.max(0, (1 - (9 / 16) / shortAspectRatio(doc.aspect)) * 50).toFixed(2) + '% 0)',
                      }}
                    />
                  ) : null}
                </div>

                <div className="vp-stagechrome pin">
                  <div className="vp-row" style={{ marginBottom: 6 }}>
                    <button type="button" className="vp-ico on" title="Play / pause (Space)" onClick={togglePlay} disabled={!hasSource}>
                      {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />}
                    </button>
                    <span className="vp-mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
                      {formatClock(currentTime)}
                      <span style={{ color: '#707070' }}> / {formatClock(doc.durationS)}</span>
                    </span>
                    <button type="button" className="vp-btn xs" onClick={toggleKeyframe} title="Add or remove a camera keyframe (K)">
                      <Diamond size={11} /> Key
                    </button>
                    <span className="vp-headgap" />
                    {doc.bpm ? <span className="vp-chip">{Math.round(doc.bpm)} BPM</span> : null}
                    <button type="button" className="vp-ico sm" title={muted ? 'Unmute preview' : 'Mute preview'} onClick={toggleMute}>
                      {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                    </button>
                  </div>
                  <div
                    className="vp-scrub"
                    onPointerDown={(e) => {
                      const box = e.currentTarget.getBoundingClientRect();
                      const go = (x: number) => seek(((x - box.left) / Math.max(1, box.width)) * doc.durationS);
                      go(e.clientX);
                      const move = (ev: PointerEvent) => go(ev.clientX);
                      const up = () => {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                      };
                      window.addEventListener('pointermove', move);
                      window.addEventListener('pointerup', up);
                    }}
                  >
                    <span className="vp-scrubtrack">
                      <span className="vp-scrubfill" style={{ width: progress + '%' }} />
                    </span>
                    <span className="vp-scrubknob" style={{ left: progress + '%' }} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <SveProTimeline
          doc={doc}
          cues={cues}
          currentTime={currentTime}
          zoom={tlZoom}
          collapsed={tlCollapsed}
          selectedCardId={selectedCardId}
          selectedBrollId={selectedBrollId}
          onZoom={setTlZoom}
          onCollapse={setTlCollapsed}
          onResize={onTimelineResize}
          onSeek={seek}
          onSelectCard={setSelectedCardId}
          onSelectBroll={setSelectedBrollId}
          onMoveCard={(id, start, end) => commit((d) => ({
            ...d,
            cards: d.cards.map((c) => (c.id === id ? { ...c, start, end } : c)),
          }), 'card-move')}
          onMoveBroll={(id, start, end) => commit((d) => ({
            ...d,
            broll: d.broll.map((b) => (b.id === id ? { ...b, start, end } : b)),
          }), 'broll-move')}
          onDeleteCard={(id) => {
            commit((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }), 'card-delete');
            setSelectedCardId(null);
          }}
          onDeleteBroll={(id) => {
            commit((d) => ({ ...d, broll: d.broll.filter((b) => b.id !== id) }), 'broll-delete');
            setSelectedBrollId(null);
          }}
          onDuplicateCard={duplicateCard}
          onSnapToBeat={(block) => {
            if (!doc.bpm) { notify('Measure the tempo first — Beat sync is in the Audio tab.', 'bad'); return; }
            const period = 60 / doc.bpm;
            const round = (t: number) => Math.max(0, Math.round(t / period) * period);
            commit((d) => (block.kind === 'card'
              ? {
                ...d,
                cards: d.cards.map((c) => (c.id === block.id
                  ? { ...c, start: round(c.start), end: Math.max(round(c.start) + period, round(c.end)) }
                  : c)),
              }
              : {
                ...d,
                broll: d.broll.map((b) => (b.id === block.id
                  ? { ...b, start: round(b.start), end: Math.max(round(b.start) + period, round(b.end)) }
                  : b)),
              }), 'snap-beat');
          }}
          onToggleKeyframe={toggleKeyframe}
        />

        <aside className={'vp-side' + (sideCollapsed ? ' collapsed' : '')}>
          <div className="vp-sidehead">
            <b>{activeTab?.label || 'Controls'}</b>
            <button
              type="button"
              className="vp-sidetoggle"
              aria-expanded={!sideCollapsed}
              aria-label={sideCollapsed ? 'Expand the control panel' : 'Collapse the control panel'}
              title={sideCollapsed ? 'Expand the control panel' : 'Collapse the control panel to icons'}
              onClick={() => setSideCollapsed((v) => !v)}
            >
              <ChevronRight size={13} style={{ transform: sideCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>
          </div>
          <div className="vp-tabs c7" role="tablist" aria-label="Editor controls">
            {SVE_TABS.map((t) => {
              const TabIcon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className="vp-tab"
                  title={t.label + ' \u2014 ' + t.tip}
                  onClick={() => { setTab(t.id); setSideCollapsed(false); }}
                >
                  <span className="vp-tabico"><TabIcon size={14} /></span>
                  <span className="vp-tablab">{t.label}</span>
                </button>
              );
            })}
          </div>
          <div className="vp-sidescroll">
            <SveProPanels
              tab={tab}
              doc={doc}
              hasSource={hasSource}
              currentTime={currentTime}
              activePreset={activePreset}
              compareAB={compareAB}
              captionsBusy={captionsBusy}
              musicPhase={musicPhase}
              musicNote={musicNote}
              voBusy={voBusy}
              voNote={voNote}
              beatBusy={beatBusy}
              customPresets={customPresets}
              checklist={shortsChecklist}
              captionTiers={captionTiers}
              cues={cues}
              update={commit}
              onCaptionLanguage={setCaptionLanguage}
              onTierMode={setTierMode}
              onSetCueTier={setCueTier}
              onSetCueEmphasis={setCueEmphasis}
              onResetCueTiers={resetCueTiers}
              onSeek={seek}
              onLoadHinglishSamples={loadHinglishSamples}
              onPreset={applyPreset}
              onSavePreset={savePreset}
              onAspect={(a) => commit((d) => ({ ...d, aspect: a }), 'aspect')}
              onMotion={applyMotion}
              onCompareAB={setCompareAB}
              onGenerateCaptions={() => { void runAgentAction('caption'); }}
              onGenerateMusic={(prompt) => void generateMusic(prompt)}
              onClearMusic={clearMusic}
              onVoiceover={(text, voice) => { void generateVoiceover(text, voice); }}
              onBeatSync={() => { void runAgentAction('beat'); }}
              onAddCard={(kind, preset) => { addCard(kind, preset); }}
              onResetColor={resetColor}
            />

            <SveAccordion key="side-agent" icon={<Sparkles size={11} />} title="AI agent" hint="Hands-free editing">
              <button
                type="button"
                className="vp-btn primary block"
                title="Open the agent drawer over the preview"
                onClick={() => setAgentOpen(true)}
              >
                <Sparkles size={13} /> Open the agent panel
              </button>
              <p className="vp-note">
                Auto-enhance, auto-caption, beat sync, smart trim and scene generation — each one reports what it
                changed and can be undone in a tap.
              </p>
            </SveAccordion>

            <SveAccordion key="side-clip" icon={<FileVideo size={11} />} title="Clip details" hint="Source, tempo, save">
              <div className="vp-row">
                <FileVideo size={13} color="#A0A0A0" />
                <span className="vp-note vp-mono">{doc.srcW}×{doc.srcH}</span>
                <span className="vp-spread vp-badge idle">{hasSource ? 'Source ready' : 'No clip'}</span>
              </div>
              <p className="vp-note">
                Duration {doc.durationS ? formatClock(doc.durationS) : '—'} · export 1080×1920 at 30 fps ·{' '}
                {doc.words.length ? doc.words.length + ' words' : 'no transcript yet'} ·{' '}
                {audioStats?.bpm ? Math.round(audioStats.bpm) + ' BPM' : 'tempo not measured'}
              </p>
              {audioStats?.note ? <p className="vp-note warn">{audioStats.note}</p> : null}
              <button
                type="button"
                className="vp-btn block"
                disabled={!doc.sourceUrl || saving}
                title={doc.sourceUrl ? 'Write this edit to Projects now' : 'The clip is still uploading'}
                onClick={() => void saveProject(false)}
              >
                <Save size={13} /> Save to Projects
              </button>
            </SveAccordion>
          </div>

          {/* Sticky, never scrolled away: the one action the panel exists for. */}
          <div className="vp-sidefoot">
            <button
              type="button"
              className="vp-btn primary block"
              disabled={!hasSource || !doc.durationS}
              title={exportBlocked || 'Render the 1080×1920 master with every effect above applied'}
              onClick={() => setExportOpen(true)}
            >
              <Download size={14} /> Apply &amp; export
            </button>
            <div className="vp-footrow">
              <button
                type="button"
                className="vp-btn sm"
                disabled={!doc.sourceUrl || saving}
                title={doc.sourceUrl ? 'Save this edit to Projects' : 'The clip is still uploading'}
                onClick={() => void saveProject(false)}
              >
                {saving ? <Loader2 size={12} className="vp-spin" /> : <Save size={12} />} Save
              </button>
              <button
                type="button"
                className={'vp-btn sm' + (agentOpen ? ' on' : '')}
                title="Open the AI agent drawer"
                onClick={() => setAgentOpen((v) => !v)}
              >
                <Sparkles size={12} /> Agent
              </button>
            </div>
            <p className="vp-footnote">
              {exportBlocked || 'Everything above is already in the preview — the export renders exactly that.'}
            </p>
          </div>
        </aside>
      </div>

      {exportOpen ? (
        <SveProExport
          spec={exportSpec}
          onSpec={(p) => setExportSpec((s) => ({ ...s, ...p }))}
          phase={exportPhase}
          elapsedS={elapsedS}
          geometry={exportGeometry}
          error={exportError}
          blockedReason={exportBlocked}
          canExport={hasSource && !!doc.durationS}
          downloading={downloading}
          master={variants?.master || null}
          compressed={variants?.compressed || null}
          smaller={!!variants?.smaller}
          note={variants?.note || ''}
          localUrl={localUrl}
          localBytes={localBytes}
          localProgress={localProgress}
          cueCount={cues.length}
          captionLanguage={doc.caption.language}
          onClose={() => setExportOpen(false)}
          onExport={() => { void (exportSpec.format === 'mp4' ? exportMaster() : exportLocal()); }}
          onDownload={(which) => void downloadVariant(which)}
          onDownloadCaptions={downloadCaptionFile}
          onShare={(url) => void shareLink(url)}
        />
      ) : null}

      {toast ? (
        <div className="vp-toasts">
          <div className={'vp-toast ' + (toast.tone === 'bad' ? 'bad' : 'good')}>
            <Check size={14} />
            {toast.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}
