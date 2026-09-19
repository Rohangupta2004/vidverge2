/**
 * Video Enhancer — full AI editing suite.
 *
 * Upload footage → the editor opens with a proper dark editing interface:
 *   - ANALYZE  — claude-opus-5 watches sampled frames, reports findings
 *                (a supporting graphic appears ONLY when a finding carries a
 *                score, comparison, recommendation or multi-step explanation)
 *                and designs adaptive graphic overlays (arrows, callouts,
 *                steps, highlights, labels, diagrams — never captions).
 *   - TRIM     — timeline scrubber with in/out handles, playhead splitting,
 *                per-segment keep/cut.
 *   - EFFECTS  — brightness / contrast / saturation / blur / vignette and
 *                playback speed (0.5× – 2×).
 *   - TEXT     — timed text overlays, draggable on the player, with font
 *                size, color and duration controls.
 *   - FRAME    — aspect-ratio presets (16:9, 9:16, 1:1, 4:5) as a centered
 *                cover-crop, plus original-audio mute/volume.
 *   - MUSIC    — ElevenLabs music bed from a mood prompt or preset style;
 *                mixed into the export at an adjustable volume.
 *   - EXPORT   — prominent export with format (MP4/WebM) + quality options;
 *                the whole edit is composited in one canvas + MediaRecorder
 *                pass (editSuite.renderEditedVideo) and saved durably.
 *
 * Uploads, the AI plan, and results persist via localStorage + the
 * account-scoped video_enhancer_jobs WorkspaceDB table (jobStore).
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  UploadCloud, Loader2, Check, AlertCircle, Sparkles, Film, RefreshCw, Wand2,
  Play, Pause, Scissors, SlidersHorizontal, Type, Crop, Music, Download, Captions, Zap,
} from 'lucide-react';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';
import {
  MAX_UPLOAD_BYTES, uploadVideo, fetchVideoAsFile, workspaceToken, formatTime,
  transcribeVideo, buildCaptionSegments, retimeSegmentText,
} from './enhancerCore';
import type { CaptionSegment } from './enhancerCore';
import { createEnhancerJob, fetchLatestEnhancerJob, updateEnhancerJob } from './jobStore';
import { OverlayElement, extractFrames, analyzeFrames, drawOverlays } from './overlayEngine';
import type { AnalysisInsight } from './overlayEngine';
import {
  P, clamp, EffectsState, DEFAULT_EFFECTS, filterCss, TextOverlayItem,
  newTextOverlay, buildSegments, keptRanges, keptDuration, AspectPreset,
  ASPECT_PRESETS, drawTextOverlays, renderEditedVideo, ExportFormat,
  ExportQuality, TextHitRect,
} from './editSuite';
import { generateMusicBed } from './musicSuite';
import type { GeneratedMusic } from './musicSuite';
import { CAPTION_STYLES, DEFAULT_CAPTION_STYLE, drawCaptionOverlay, BRAND_CORAL } from './captionSuite';
import type { CaptionStyleId } from './captionSuite';
import { generateSfxClip, newSfxId } from './sfxSuite';
import type { SfxCue } from './sfxSuite';
import { AnalyzePanel, TrimPanel, EffectsPanel, TextPanel, FramePanel, MusicPanel, ExportPanel, ErrLine } from './editorPanels';
import { CaptionsPanel } from './captionsPanel';
import { SfxPanel } from './sfxPanel';

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

const VE_CSS = `
@keyframes ve-spin { to { transform: rotate(360deg); } }
.animate-spin { animation: ve-spin 1s linear infinite; }
@keyframes ve-fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.ve-fade { animation: ve-fadeIn .3s ease both; }
.ve-panel { animation: ve-fadeIn .24s ease both; }
@keyframes ve-glowPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
.ve-pulse { animation: ve-glowPulse 1.6s ease-in-out infinite; }
@keyframes ve-sheen { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
.ve-gradient-text { background: linear-gradient(100deg, ${P.blue}, ${P.mint} 35%, ${P.amber} 65%, ${P.coral}); background-size: 220% 100%; animation: ve-sheen 7s ease infinite; -webkit-background-clip: text; background-clip: text; color: transparent; }
.ve-btn { transition: filter .15s ease, transform .15s ease, box-shadow .15s ease, background .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease; }
.ve-btn:hover:not(:disabled) { filter: brightness(1.14); }
.ve-btn:active:not(:disabled) { transform: scale(0.97); }
.ve-btn:focus-visible { outline: 2px solid ${P.blue}; outline-offset: 2px; }
.ve-input { transition: border-color .16s ease, box-shadow .16s ease; outline: none; }
.ve-input:focus { border-color: ${P.blue} !important; box-shadow: 0 0 0 3px rgba(61,139,255,0.18); }
.ve-drop { transition: border-color .18s ease, background .18s ease, box-shadow .18s ease; }
.ve-chip { transition: background .15s ease, border-color .15s ease, opacity .15s ease, color .15s ease; }
.ve-elcard { transition: border-color .15s ease, background .15s ease, opacity .2s ease; cursor: pointer; }
.ve-elcard:hover { border-color: rgba(255,255,255,0.22); }
.ve-tab { transition: background .16s ease, color .16s ease, border-color .16s ease, transform .16s ease; }
.ve-tab:hover:not(:disabled) { background: rgba(140,155,255,0.10) !important; }
.ve-editor-grid { display: grid; grid-template-columns: 76px minmax(0, 1fr) 356px; gap: 14px; align-items: start; }
.ve-rail { display: flex; flex-direction: column; gap: 6px; position: sticky; top: 10px; }
@media (max-width: 1140px) {
  .ve-editor-grid { grid-template-columns: minmax(0, 1fr); }
  .ve-rail { flex-direction: row; flex-wrap: wrap; position: static; }
}
`;

const cardStyle: CSSProperties = {
  background: 'linear-gradient(160deg, ' + P.panel + ', ' + P.card + ')',
  border: '1px solid ' + P.border,
  borderRadius: 16,
  boxShadow: '0 22px 50px -38px rgba(0,0,0,0.9)',
};

type ToolId = 'analyze' | 'trim' | 'effects' | 'text' | 'captions' | 'frame' | 'music' | 'sfx' | 'export';

const TOOLS: { id: ToolId; label: string; icon: any; color: string }[] = [
  { id: 'analyze', label: 'Analyze', icon: Sparkles, color: P.blue },
  { id: 'trim', label: 'Trim', icon: Scissors, color: P.amber },
  { id: 'effects', label: 'Effects', icon: SlidersHorizontal, color: P.coral },
  { id: 'text', label: 'Text', icon: Type, color: P.violet },
  { id: 'captions', label: 'Captions', icon: Captions, color: BRAND_CORAL },
  { id: 'frame', label: 'Frame', icon: Crop, color: P.cyan },
  { id: 'music', label: 'Music', icon: Music, color: P.mint },
  { id: 'sfx', label: 'Sound FX', icon: Zap, color: BRAND_CORAL },
  { id: 'export', label: 'Download', icon: Download, color: P.mint },
];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const VE_SNAPSHOT_KEY = 've-editor-studio-v2';
const VE_AUTH_SESSION_KEY = 'vidverge_ve_session';

function readVeAuthSession(): { userId?: string } {
  try {
    const raw = window.localStorage.getItem(VE_AUTH_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function fallbackSessionId(): string {
  try {
    const KEY = 'vidverge_ve_anon_id';
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = 've-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch { return 've-anon'; }
}

interface StoredPlan { summary: string; elements: OverlayElement[]; insights: AnalysisInsight[] }

function parseStoredPlan(raw: unknown): StoredPlan | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).elements)) return null;
    const els = (parsed as any).elements.filter((e: any) => e && typeof e.id === 'string' && typeof e.kind === 'string');
    const ins = Array.isArray((parsed as any).insights)
      ? (parsed as any).insights.filter((i: any) => i && typeof i.id === 'string' && typeof i.text === 'string')
      : [];
    return { summary: String((parsed as any).summary || ''), elements: els as OverlayElement[], insights: ins as AnalysisInsight[] };
  } catch { return null; }
}

interface EditSnapshot {
  inPoint?: number; outPointRaw?: number; splits?: number[]; removedKeys?: string[];
  effects?: EffectsState; texts?: TextOverlayItem[]; aspect?: AspectPreset;
  muteOriginal?: boolean; originalVolume?: number; musicVolume?: number;
  format?: ExportFormat; quality?: ExportQuality;
  captionsOn?: boolean; captionStyleId?: CaptionStyleId;
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

function VideoEnhancerApp() {
  // Account identity (a missing runtime provider must never crash the app).
  let sessionId = '';
  let subscription: { contactId?: string | null } | null = null;
  try {
    const runtime = useSpaceRuntime() as { sessionId?: string; subscription?: { contactId?: string | null } | null } | null;
    sessionId = runtime?.sessionId || '';
    subscription = runtime?.subscription || null;
  } catch { /* provider missing — fall through to the persisted session */ }
  const storedAccountId = useMemo(() => readVeAuthSession().userId || '', []);
  const accountUserId = subscription?.contactId || sessionId || storedAccountId || fallbackSessionId();
  const accountUserIdRef = useRef(accountUserId);
  useEffect(() => { accountUserIdRef.current = accountUserId; }, [accountUserId]);
  useEffect(() => {
    if (!accountUserId) return;
    try { window.localStorage.setItem(VE_AUTH_SESSION_KEY, JSON.stringify({ userId: accountUserId, updatedAt: Date.now() })); } catch { /* no-op */ }
  }, [accountUserId]);

  // ---- Source footage ----
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [uploadErr, setUploadErr] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [duration, setDuration] = useState(0);
  const [jobRowId, setJobRowId] = useState<number | null>(null);
  const jobRowIdRef = useRef<number | null>(null);
  useEffect(() => { jobRowIdRef.current = jobRowId; }, [jobRowId]);

  // ---- AI analysis ----
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeNote, setAnalyzeNote] = useState('');
  const [analyzeErr, setAnalyzeErr] = useState('');
  const [summary, setSummary] = useState('');
  const [insights, setInsights] = useState<AnalysisInsight[]>([]);
  const [elements, setElements] = useState<OverlayElement[]>([]);
  const elementsRef = useRef<OverlayElement[]>([]);
  useEffect(() => { elementsRef.current = elements; }, [elements]);

  // ---- Editor state ----
  const [activeTool, setActiveTool] = useState<ToolId>('analyze');
  const [inPoint, setInPoint] = useState(0);
  const [outPointRaw, setOutPointRaw] = useState(0); // 0 = "to the end"
  const [splits, setSplits] = useState<number[]>([]);
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);
  const [effects, setEffects] = useState<EffectsState>({ ...DEFAULT_EFFECTS });
  const [texts, setTexts] = useState<TextOverlayItem[]>([]);
  const textsRef = useRef<TextOverlayItem[]>([]);
  useEffect(() => { textsRef.current = texts; }, [texts]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const selectedTextIdRef = useRef<string | null>(null);
  useEffect(() => { selectedTextIdRef.current = selectedTextId; }, [selectedTextId]);
  const [aspect, setAspect] = useState<AspectPreset>('original');
  const [muteOriginal, setMuteOriginal] = useState(false);
  const [originalVolume, setOriginalVolume] = useState(1);

  // ---- Music ----
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicNote, setMusicNote] = useState('');
  const [musicErr, setMusicErr] = useState('');
  const [musicTrack, setMusicTrack] = useState<GeneratedMusic | null>(null);
  const [musicUrl, setMusicUrl] = useState('');
  const [musicVolume, setMusicVolume] = useState(0.35);

  // ---- Captions ----
  const [captionSegments, setCaptionSegments] = useState<CaptionSegment[]>([]);
  const captionSegmentsRef = useRef<CaptionSegment[]>([]);
  useEffect(() => { captionSegmentsRef.current = captionSegments; }, [captionSegments]);
  const [captionsOn, setCaptionsOn] = useState(false);
  const captionsOnRef = useRef(false);
  useEffect(() => { captionsOnRef.current = captionsOn; }, [captionsOn]);
  const [captionStyleId, setCaptionStyleId] = useState<CaptionStyleId>(DEFAULT_CAPTION_STYLE);
  const captionStyleIdRef = useRef<CaptionStyleId>(DEFAULT_CAPTION_STYLE);
  useEffect(() => { captionStyleIdRef.current = captionStyleId; }, [captionStyleId]);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeNote, setTranscribeNote] = useState('');
  const [transcribeErr, setTranscribeErr] = useState('');

  // ---- Sound effects ----
  const [sfxCues, setSfxCues] = useState<SfxCue[]>([]);
  const sfxCuesRef = useRef<SfxCue[]>([]);
  useEffect(() => { sfxCuesRef.current = sfxCues; }, [sfxCues]);
  const [sfxBusy, setSfxBusy] = useState(false);
  const [sfxNote, setSfxNote] = useState('');
  const [sfxErr, setSfxErr] = useState('');
  const prevSfxTRef = useRef(0);

  // ---- Export ----
  const [format, setFormat] = useState<ExportFormat>('auto');
  const [quality, setQuality] = useState<ExportQuality>('standard');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportNote, setExportNote] = useState('');
  const [exportErr, setExportErr] = useState('');
  const [outputUrl, setOutputUrl] = useState('');
  const [outputExt, setOutputExt] = useState('webm');
  const [viewOriginal, setViewOriginal] = useState(false);
  // A visible explanation whenever the enhanced output cannot be shown — the
  // player must never present a blank rectangle as a valid state.
  const [outputIssue, setOutputIssue] = useState('');

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [playheadT, setPlayheadT] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewArea, setPreviewArea] = useState({ w: 0, h: 0 });

  useEffect(() => () => { if (localUrl && localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl); }, [localUrl]);
  useEffect(() => () => { if (musicUrl) { try { URL.revokeObjectURL(musicUrl); } catch { /* no-op */ } } }, [musicUrl]);

  const showingOutput = !!outputUrl && !viewOriginal;
  const playerSrc = showingOutput ? outputUrl : localUrl;

  // ---- Derived trim state ----
  const outPoint = outPointRaw > 0 && duration > 0 ? Math.min(outPointRaw, duration) : duration;
  const segments = useMemo(
    () => (duration > 0 ? buildSegments(inPoint, outPoint || duration, splits, removedKeys) : []),
    [duration, inPoint, outPoint, splits, removedKeys],
  );
  const segmentsRef = useRef(segments);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  const keptSecs = keptDuration(segments) || duration;
  const keptSecsRef = useRef(keptSecs);
  useEffect(() => { keptSecsRef.current = keptSecs; }, [keptSecs]);
  const hasEdits = segments.some((s) => !s.kept) || inPoint > 0.05 || (outPointRaw > 0 && duration > 0 && outPointRaw < duration - 0.05);

  const aspectRatioNum = useMemo(() => {
    const preset = ASPECT_PRESETS.find((a) => a.id === aspect);
    if (preset && preset.ratio) return preset.ratio;
    const v = videoRef.current;
    if (v && v.videoWidth && v.videoHeight) return v.videoWidth / v.videoHeight;
    return 16 / 9;
  }, [aspect, duration]);

  // Preview box sized to the available area at the chosen aspect ratio (16:9 default).
  useEffect(() => {
    const el = previewAreaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) setPreviewArea({ w: en.contentRect.width, h: en.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [localUrl]);
  const boxH = Math.max(200, previewArea.h || 400);
  let pvW = Math.min(previewArea.w || 640, boxH * aspectRatioNum);
  let pvH = pvW / aspectRatioNum;
  if (pvH > boxH) { pvH = boxH; pvW = pvH * aspectRatioNum; }

  // ---- Source duration, independent of what the player is showing ----
  // Every timing control (trim, splits, text in/out) and the export gate is
  // derived from the SOURCE duration. The visible player only reports the
  // metadata of whatever it is playing, so a session restored with a finished
  // export on screen used to leave duration at 0 and disable the whole editor
  // with nothing on screen explaining why. Read it off a detached element
  // instead, so it is known whichever view is up.
  useEffect(() => {
    if (!localUrl || duration > 0) return;
    let cancelled = false;
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    const done = () => {
      if (!cancelled && Number.isFinite(probe.duration) && probe.duration > 0) setDuration(probe.duration);
      cleanup();
    };
    const cleanup = () => {
      probe.removeEventListener('loadedmetadata', done);
      probe.removeEventListener('error', cleanup);
      probe.removeAttribute('src');
      try { probe.load(); } catch { /* no-op */ }
    };
    probe.addEventListener('loadedmetadata', done);
    probe.addEventListener('error', cleanup);
    probe.src = localUrl;
    return () => { cancelled = true; cleanup(); };
  }, [localUrl, duration]);

  // ---- SceneForge handoff: a finished SceneForge video opened "in the
  // Editor" or "sent to the Enhancer" from that app's done screen lands here.
  // The key is written immediately before the shell switches apps, so only a
  // fresh (<10 min) handoff loads — and it wins over the snapshot restore
  // below because it runs first and sets state unconditionally.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('sceneforge_handoff_v1');
      if (!raw) return;
      window.localStorage.removeItem('sceneforge_handoff_v1');
      const h = JSON.parse(raw) as { url?: string; title?: string; mode?: string; ts?: number } | null;
      if (!h || typeof h.url !== 'string' || !/^https?:\/\//.test(h.url)) return;
      if (!h.ts || Date.now() - h.ts > 10 * 60 * 1000) return;
      setUploadedUrl(h.url);
      setLocalUrl(h.url);
      setActiveTool(h.mode === 'enhance' ? 'analyze' : 'trim');
    } catch { /* localStorage unavailable — nothing to hand off */ }
  }, []);

  // ---- Restore: localStorage snapshot, then the account's latest job ----
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VE_SNAPSHOT_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as { uploadedUrl?: string; outputUrl?: string; summary?: string; elements?: OverlayElement[]; insights?: AnalysisInsight[]; edit?: EditSnapshot } | null;
      if (!snap || typeof snap !== 'object') return;
      // blob: URLs die with the tab that created them — restoring one would
      // put a permanently blank video in the player. Only durable https URLs
      // survive a restore; a tab-local output simply counts as "no output yet".
      if (snap.uploadedUrl && !String(snap.uploadedUrl).startsWith('blob:')) {
        setUploadedUrl((cur) => cur || (snap.uploadedUrl as string));
        setLocalUrl((cur) => cur || (snap.uploadedUrl as string));
      }
      if (snap.outputUrl && !String(snap.outputUrl).startsWith('blob:')) setOutputUrl((cur) => cur || (snap.outputUrl as string));
      if (snap.summary) setSummary((cur) => cur || (snap.summary as string));
      if (Array.isArray(snap.elements) && snap.elements.length) setElements((cur) => (cur.length ? cur : (snap.elements as OverlayElement[])));
      if (Array.isArray(snap.insights) && snap.insights.length) setInsights((cur) => (cur.length ? cur : (snap.insights as AnalysisInsight[])));
      const ed = snap.edit;
      if (ed && typeof ed === 'object') {
        if (Number.isFinite(ed.inPoint)) setInPoint(Math.max(0, Number(ed.inPoint)));
        if (Number.isFinite(ed.outPointRaw)) setOutPointRaw(Math.max(0, Number(ed.outPointRaw)));
        if (Array.isArray(ed.splits)) setSplits(ed.splits.filter((s) => Number.isFinite(s)));
        if (Array.isArray(ed.removedKeys)) setRemovedKeys(ed.removedKeys.filter((k) => typeof k === 'string'));
        if (ed.effects && typeof ed.effects === 'object') setEffects({ ...DEFAULT_EFFECTS, ...ed.effects });
        if (Array.isArray(ed.texts)) setTexts(ed.texts.filter((t) => t && typeof t.id === 'string'));
        if (ed.aspect && ASPECT_PRESETS.some((a) => a.id === ed.aspect)) setAspect(ed.aspect);
        if (typeof ed.muteOriginal === 'boolean') setMuteOriginal(ed.muteOriginal);
        if (Number.isFinite(ed.originalVolume)) setOriginalVolume(clamp(Number(ed.originalVolume), 0, 1));
        if (Number.isFinite(ed.musicVolume)) setMusicVolume(clamp(Number(ed.musicVolume), 0, 1));
        if (ed.format === 'auto' || ed.format === 'mp4' || ed.format === 'webm') setFormat(ed.format);
        if (ed.quality === 'high' || ed.quality === 'standard' || ed.quality === 'compact') setQuality(ed.quality);
        if (typeof ed.captionsOn === 'boolean') setCaptionsOn(ed.captionsOn);
        if (ed.captionStyleId && CAPTION_STYLES.some((s) => s.id === ed.captionStyleId)) setCaptionStyleId(ed.captionStyleId);
      }
    } catch { /* localStorage unavailable — the DB restore still runs */ }
  }, []);

  useEffect(() => {
    if (!uploadedUrl && !outputUrl && !elements.length && !texts.length) return;
    try {
      const edit: EditSnapshot = { inPoint, outPointRaw, splits, removedKeys, effects, texts, aspect, muteOriginal, originalVolume, musicVolume, format, quality, captionsOn, captionStyleId };
      window.localStorage.setItem(VE_SNAPSHOT_KEY, JSON.stringify({ uploadedUrl, outputUrl, summary, elements, insights, edit, updatedAt: Date.now() }));
    } catch { /* no-op */ }
  }, [uploadedUrl, outputUrl, summary, elements, insights, inPoint, outPointRaw, splits, removedKeys, effects, texts, aspect, muteOriginal, originalVolume, musicVolume, format, quality, captionsOn, captionStyleId]);

  useEffect(() => {
    if (!accountUserId) return;
    let cancelled = false;
    void fetchLatestEnhancerJob(accountUserId)
      .then((row) => {
        if (cancelled || !row || jobRowIdRef.current) return;
        setJobRowId(row.id);
        jobRowIdRef.current = row.id;
        if (row.video_url) {
          setUploadedUrl((cur) => cur || (row.video_url as string));
          setLocalUrl((cur) => cur || (row.video_url as string));
        }
        if (row.result_url) setOutputUrl((cur) => cur || (row.result_url as string));
        const stored = parseStoredPlan(row.caption_text);
        if (stored) {
          setSummary((cur) => cur || stored.summary);
          setElements((cur) => (cur.length ? cur : stored.elements));
          setInsights((cur) => (cur.length ? cur : stored.insights));
        }
      })
      .catch((e) => { if (!cancelled) console.warn('[VideoEnhancer] could not restore the latest job:', e); });
    return () => { cancelled = true; };
  }, [accountUserId]);

  useEffect(() => {
    if (!accountUserId || !jobRowId) return;
    void updateEnhancerJob(jobRowId, { user_id: accountUserId }).catch((e) => {
      console.warn('[VideoEnhancer] could not attach the job to the account:', e);
    });
  }, [accountUserId, jobRowId]);

  // ---- Preview playback settings (speed / audio follow the edit) ----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = showingOutput ? 1 : clamp(effects.speed || 1, 0.25, 4);
    v.muted = showingOutput ? false : muteOriginal;
    v.volume = showingOutput ? 1 : clamp(originalVolume, 0, 1);
  }, [effects.speed, muteOriginal, originalVolume, showingOutput, playerSrc]);

  // ---- Live overlay preview loop (+ cut-region skipping) ----
  const previewMapRef = useRef({ ox: 0, oy: 0, cw: 1, ch: 1, dpr: 1 });
  const hitRectsRef = useRef<Map<string, TextHitRect>>(new Map());
  const skipGuardRef = useRef(0);
  const aspectRef = useRef<AspectPreset>('original');
  useEffect(() => { aspectRef.current = aspect; }, [aspect]);
  const effectsRef = useRef(effects);
  useEffect(() => { effectsRef.current = effects; }, [effects]);
  const trimRef = useRef({ inPoint: 0, outPoint: 0 });
  useEffect(() => { trimRef.current = { inPoint, outPoint: outPoint || duration }; }, [inPoint, outPoint, duration]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      const c = overlayCanvasRef.current;
      if (v && c && v.videoWidth) {
        const rect = c.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(2, Math.round(rect.width * dpr));
        const h = Math.max(2, Math.round(rect.height * dpr));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          if (!showingOutput) {
            const vw = v.videoWidth, vh = v.videoHeight;
            const cover = aspectRef.current !== 'original';
            const s = cover ? Math.max(rect.width / vw, rect.height / vh) : Math.min(rect.width / vw, rect.height / vh);
            const cw = vw * s * dpr, ch = vh * s * dpr;
            const ox = (w - cw) / 2, oy = (h - ch) / 2;
            previewMapRef.current = { ox, oy, cw, ch, dpr };
            ctx.save();
            ctx.translate(ox, oy);
            drawOverlays(ctx, cw, ch, v.currentTime, elementsRef.current.filter((e) => e.enabled));
            drawTextOverlays(ctx, cw, ch, v.currentTime, textsRef.current, hitRectsRef.current, selectedTextIdRef.current);
            if (captionsOnRef.current && captionSegmentsRef.current.length) {
              drawCaptionOverlay(ctx, cw, ch, v.currentTime, captionSegmentsRef.current, captionStyleIdRef.current);
            }
            ctx.restore();
          }
        }
        // Skip cut regions while playing the original.
        if (!showingOutput && !v.paused && !v.seeking && performance.now() > skipGuardRef.current) {
          const segs = segmentsRef.current;
          if (segs.length) {
            const t = v.currentTime;
            const { inPoint: tin, outPoint: tout } = trimRef.current;
            const inCut = segs.find((sg) => !sg.kept && t >= sg.start && t < sg.end - 0.02);
            if (t < tin - 0.05) {
              skipGuardRef.current = performance.now() + 350;
              v.currentTime = tin;
            } else if (inCut) {
              const next = segs.find((sg) => sg.kept && sg.start >= inCut.end - 0.05);
              skipGuardRef.current = performance.now() + 350;
              if (next) v.currentTime = next.start + 0.02;
              else { v.pause(); v.currentTime = tin; }
            } else if (tout > 0 && t > tout + 0.02) {
              skipGuardRef.current = performance.now() + 350;
              v.pause();
            }
          }
        }
        // One-shot sound-effect cues: fire the instant playback crosses their moment.
        if (!showingOutput && !v.paused && !v.seeking) {
          const t = v.currentTime;
          const prevT = prevSfxTRef.current;
          if (prevT <= t) {
            for (const cue of sfxCuesRef.current) {
              if (cue.status === 'ready' && cue.url && prevT < cue.at && t >= cue.at) {
                try { const a = new Audio(cue.url); a.volume = clamp(cue.volume, 0, 1); void a.play().catch(() => undefined); } catch { /* no-op */ }
              }
            }
          }
          prevSfxTRef.current = t;
        } else {
          prevSfxTRef.current = v.currentTime;
        }
        setPlayheadT((prev) => (Math.abs(prev - v.currentTime) > 0.08 ? v.currentTime : prev));
        setIsPlaying((prev) => (prev === !v.paused ? prev : !v.paused));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [showingOutput]);

  // ---- Text dragging on the preview ----
  const textDragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const canvasPointFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const c = overlayCanvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    const m = previewMapRef.current;
    const px = (e.clientX - rect.left) * m.dpr;
    const py = (e.clientY - rect.top) * m.dpr;
    return { nx: (px - m.ox) / m.cw, ny: (py - m.oy) / m.ch, px: px - m.ox, py: py - m.oy };
  }, []);

  const onCanvasPointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pt = canvasPointFromEvent(e);
    if (!pt) return;
    const entries = [...hitRectsRef.current.entries()].reverse();
    for (const [id, r] of entries) {
      if (pt.px >= r.x && pt.px <= r.x + r.w && pt.py >= r.y && pt.py <= r.y + r.h) {
        const item = textsRef.current.find((t) => t.id === id);
        if (!item) continue;
        setSelectedTextId(id);
        textDragRef.current = { id, dx: pt.nx - item.x, dy: pt.ny - item.y };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no-op */ }
        e.preventDefault();
        return;
      }
    }
    setSelectedTextId(null);
  }, [canvasPointFromEvent]);

  const onCanvasPointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = textDragRef.current;
    if (!drag) return;
    const pt = canvasPointFromEvent(e);
    if (!pt) return;
    setTexts((cur) => cur.map((t) => (t.id === drag.id ? { ...t, x: clamp(pt.nx - drag.dx, 0.02, 0.98), y: clamp(pt.ny - drag.dy, 0.03, 0.97) } : t)));
  }, [canvasPointFromEvent]);

  const onCanvasPointerUp = useCallback(() => { textDragRef.current = null; }, []);

  // ---- Upload flow ----
  const startUpload = useCallback(async (f: File) => {
    setUploading(true); setUploadErr('');
    let rowId: number | null = null;
    try {
      const userId = accountUserIdRef.current || fallbackSessionId();
      const job = await createEnhancerJob(userId);
      rowId = job.id;
      setJobRowId(job.id); jobRowIdRef.current = job.id;
      const up = await uploadVideo(f);
      if (!aliveRef.current) return;
      setUploadedUrl(up.url);
      await updateEnhancerJob(job.id, { status: 'processing', video_url: up.url, result_url: null });
    } catch (e) {
      if (rowId) void updateEnhancerJob(rowId, { status: 'error' }).catch(() => undefined);
      if (aliveRef.current) setUploadErr(msg(e));
    }
    if (aliveRef.current) setUploading(false);
  }, []);

  const handleFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) { setUploadErr('Please choose a video file (MP4, WebM or MOV).'); return; }
    if (f.size > MAX_UPLOAD_BYTES) { setUploadErr('That file is over 500 MB — trim or compress it first, then upload again.'); return; }
    setUploadErr(''); setOutputUrl(''); setViewOriginal(false); setOutputIssue(''); setDuration(0);
    setElements([]); setInsights([]); setSummary(''); setAnalyzeErr(''); setExportErr(''); setExportProgress(0); setExportNote('');
    setInPoint(0); setOutPointRaw(0); setSplits([]); setRemovedKeys([]);
    setTexts([]); setSelectedTextId(null);
    setCaptionSegments([]); setCaptionsOn(false); setTranscribeErr(''); setTranscribeNote('');
    setSfxCues((cur) => { cur.forEach((c) => { if (c.url) { try { URL.revokeObjectURL(c.url); } catch { /* no-op */ } } }); return []; });
    setSfxErr(''); setSfxNote('');
    setActiveTool('analyze');
    setFile(f);
    setLocalUrl(URL.createObjectURL(f));
    void startUpload(f);
  }, [startUpload]);

  const resetAll = useCallback(() => {
    setFile(null); setLocalUrl(''); setUploading(false); setUploadedUrl(''); setUploadErr(''); setDuration(0);
    setJobRowId(null); jobRowIdRef.current = null;
    setOutputUrl(''); setViewOriginal(false); setOutputExt('webm'); setOutputIssue('');
    setAnalyzing(false); setAnalyzeNote(''); setAnalyzeErr(''); setSummary(''); setInsights([]); setElements([]);
    setExporting(false); setExportProgress(0); setExportNote(''); setExportErr('');
    setInPoint(0); setOutPointRaw(0); setSplits([]); setRemovedKeys([]);
    setEffects({ ...DEFAULT_EFFECTS }); setTexts([]); setSelectedTextId(null);
    setAspect('original'); setMuteOriginal(false); setOriginalVolume(1);
    setMusicTrack(null); setMusicErr(''); setMusicNote(''); setMusicPrompt('');
    setMusicUrl((prev) => { if (prev) { try { URL.revokeObjectURL(prev); } catch { /* no-op */ } } return ''; });
    setCaptionSegments([]); setCaptionsOn(false);
    setCaptionStyleId(DEFAULT_CAPTION_STYLE); setTranscribing(false); setTranscribeNote(''); setTranscribeErr('');
    setSfxCues((cur) => { cur.forEach((c) => { if (c.url) { try { URL.revokeObjectURL(c.url); } catch { /* no-op */ } } }); return []; });
    setSfxBusy(false); setSfxNote(''); setSfxErr('');
    setActiveTool('analyze');
    try { window.localStorage.removeItem(VE_SNAPSHOT_KEY); } catch { /* no-op */ }
  }, []);

  const ensureSourceFile = useCallback(async (note: (n: string) => void): Promise<File> => {
    if (file) return file;
    if (!uploadedUrl) throw new Error('Upload your footage first.');
    note('Fetching your stored video…');
    const restored = await fetchVideoAsFile(uploadedUrl);
    if (aliveRef.current) setFile(restored);
    return restored;
  }, [file, uploadedUrl]);

  // ---- claude-opus-5 analysis ----
  const runAnalyze = useCallback(async () => {
    if (analyzing || exporting) return;
    if (!workspaceToken()) { setAnalyzeErr('Your workspace session is still loading — try again in a moment.'); return; }
    setAnalyzing(true); setAnalyzeErr(''); setAnalyzeNote('Preparing the footage…');
    try {
      const src = await ensureSourceFile((n) => { if (aliveRef.current) setAnalyzeNote(n); });
      const sampled = await extractFrames(src, 8, 512, (n) => { if (aliveRef.current) setAnalyzeNote(n); });
      if (!aliveRef.current) return;
      setDuration((d) => d || sampled.duration);
      const result = await analyzeFrames(sampled.frames, sampled.duration, (n) => { if (aliveRef.current) setAnalyzeNote(n); });
      if (!aliveRef.current) return;
      setSummary(result.summary);
      setInsights(result.insights);
      setElements(result.elements);
      setViewOriginal(true);
      void updateEnhancerJob(jobRowIdRef.current, {
        status: 'done',
        caption_text: JSON.stringify({ summary: result.summary, elements: result.elements, insights: result.insights }),
      }).catch(() => undefined);
    } catch (e) {
      if (aliveRef.current) setAnalyzeErr(msg(e));
    }
    if (aliveRef.current) { setAnalyzing(false); setAnalyzeNote(''); }
  }, [analyzing, exporting, ensureSourceFile]);

  // ---- Export ----
  const canExport = (!!file || !!uploadedUrl) && duration > 0 && keptSecs > 0.1;
  const runExport = useCallback(async () => {
    if (exporting || analyzing) return;
    setExporting(true); setExportErr(''); setOutputIssue(''); setExportProgress(0); setExportNote('Preparing the footage…');
    try {
      const src = await ensureSourceFile((n) => { if (aliveRef.current) setExportNote(n); });
      const segs = segmentsRef.current.length ? keptRanges(segmentsRef.current) : [{ start: 0, end: duration || 1 }];
      setExportNote('Compositing your edit — the video plays through once…');
      const readySfx = sfxCuesRef.current.filter((c) => c.status === 'ready' && c.blob);
      const result = await renderEditedVideo(
        src,
        {
          segments: segs,
          effects: effectsRef.current,
          overlays: elementsRef.current,
          texts: textsRef.current,
          aspect: aspectRef.current,
          muteOriginal,
          originalVolume,
          music: musicTrack ? { blob: musicTrack.blob, volume: musicVolume } : null,
          captions: captionsOn && captionSegmentsRef.current.length ? { segments: captionSegmentsRef.current.filter((s) => s.enabled), styleId: captionStyleId } : null,
          sfx: readySfx.map((c) => ({ id: c.id, at: c.at, volume: c.volume, blob: c.blob as Blob })),
          format,
          quality,
        },
        (p) => { if (aliveRef.current) setExportProgress(p); },
        (n) => { if (aliveRef.current) setExportNote(n); },
      );
      if (!aliveRef.current) return;
      setOutputExt(result.extension);
      let url = '';
      const base = (src.name || 'footage').replace(/\.[a-z0-9]+$/i, '');
      if (result.blob.size <= MAX_UPLOAD_BYTES) {
        setExportNote('Saving the enhanced video to durable storage…');
        try {
          const up = await uploadVideo(new File([result.blob], base + '-enhanced.' + result.extension, { type: result.mimeType }));
          url = up.url;
          void updateEnhancerJob(jobRowIdRef.current, { status: 'done', result_url: url }).catch(() => undefined);
        } catch (e) {
          url = URL.createObjectURL(result.blob);
          setExportNote('Cloud save failed (' + msg(e) + ') — the output lives in this tab only.');
        }
      } else {
        url = URL.createObjectURL(result.blob);
        setExportNote('The output is over the 500 MB storage cap — it lives in this tab; download it now to keep it.');
      }
      if (!aliveRef.current) return;
      setOutputUrl(url);
      setViewOriginal(false);
      setExportProgress(1);
    } catch (e) {
      if (aliveRef.current) setExportErr(msg(e));
    }
    if (aliveRef.current) setExporting(false);
  }, [exporting, analyzing, ensureSourceFile, duration, muteOriginal, originalVolume, musicTrack, musicVolume, format, quality, captionsOn, captionStyleId]);

  // ---- Music ----
  const runMusic = useCallback(async () => {
    if (musicBusy) return;
    setMusicBusy(true); setMusicErr(''); setMusicNote('Composing your track…');
    try {
      const res = await generateMusicBed(musicPrompt, keptSecsRef.current || duration || 30, (n) => { if (aliveRef.current) setMusicNote(n); });
      if (!aliveRef.current) return;
      setMusicTrack(res);
      setMusicUrl((prev) => { if (prev) { try { URL.revokeObjectURL(prev); } catch { /* no-op */ } } return URL.createObjectURL(res.blob); });
    } catch (e) {
      if (aliveRef.current) setMusicErr(msg(e));
    }
    if (aliveRef.current) { setMusicBusy(false); setMusicNote(''); }
  }, [musicBusy, musicPrompt, duration]);

  const removeMusic = useCallback(() => {
    setMusicTrack(null);
    setMusicUrl((prev) => { if (prev) { try { URL.revokeObjectURL(prev); } catch { /* no-op */ } } return ''; });
  }, []);

  // ---- Captions ----
  const runGenerateCaptions = useCallback(async () => {
    if (transcribing || exporting) return;
    setTranscribing(true); setTranscribeErr(''); setTranscribeNote('Preparing the audio…');
    try {
      const src = await ensureSourceFile((n) => { if (aliveRef.current) setTranscribeNote(n); });
      const result = await transcribeVideo(src, (n) => { if (aliveRef.current) setTranscribeNote(n); });
      if (!aliveRef.current) return;
      if (result.words.length) {
        const segs = buildCaptionSegments(result.words);
        setCaptionSegments(segs);
        setCaptionsOn(true);
        setTranscribeNote(segs.length + ' caption line' + (segs.length === 1 ? '' : 's') + ' ready.');
      } else if (result.transcript.trim()) {
        setCaptionSegments([]);
        setTranscribeNote('Transcribed, but without word timings captions can\u2019t be timed to the video — try again.');
      } else {
        setCaptionSegments([]);
        setTranscribeNote('No speech was detected in this video.');
      }
    } catch (e) {
      if (aliveRef.current) setTranscribeErr(msg(e));
    }
    if (aliveRef.current) setTranscribing(false);
  }, [transcribing, exporting, ensureSourceFile]);

  const toggleCaptionSegment = useCallback((id: string) => {
    setCaptionSegments((cur) => cur.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  }, []);
  const deleteCaptionSegment = useCallback((id: string) => {
    setCaptionSegments((cur) => cur.filter((s) => s.id !== id));
  }, []);
  const editCaptionSegment = useCallback((id: string, text: string) => {
    setCaptionSegments((cur) => cur.map((s) => (s.id === id ? retimeSegmentText(s, text) : s)));
  }, []);

  // ---- Sound effects ----
  const addSfxCue = useCallback(async (label: string, prompt: string, seconds: number) => {
    if (sfxBusy) return;
    setSfxBusy(true); setSfxErr(''); setSfxNote('Generating \u201c' + label + '\u201d\u2026');
    const id = newSfxId();
    const at = clamp(Math.round(playheadT * 10) / 10, 0, Math.max(0, (duration || playheadT) - 0.05));
    const placeholder: SfxCue = { id, label, prompt, at, duration: seconds, volume: 0.85, blob: null, url: '', status: 'generating' };
    setSfxCues((cur) => [...cur, placeholder]);
    try {
      const res = await generateSfxClip(prompt, seconds, (n) => { if (aliveRef.current) setSfxNote(n); });
      if (!aliveRef.current) return;
      const url = URL.createObjectURL(res.blob);
      setSfxCues((cur) => cur.map((c) => (c.id === id ? { ...c, blob: res.blob, url, status: 'ready', source: res.source } : c)));
      setSfxNote(res.note);
    } catch (e) {
      if (aliveRef.current) {
        setSfxCues((cur) => cur.map((c) => (c.id === id ? { ...c, status: 'error', error: msg(e) } : c)));
        setSfxErr(msg(e));
        setSfxNote('');
      }
    }
    if (aliveRef.current) setSfxBusy(false);
  }, [sfxBusy, playheadT, duration]);

  const updateSfxCue = useCallback((id: string, patch: Partial<SfxCue>) => {
    setSfxCues((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);
  const removeSfxCue = useCallback((id: string) => {
    setSfxCues((cur) => {
      const target = cur.find((c) => c.id === id);
      if (target?.url) { try { URL.revokeObjectURL(target.url); } catch { /* no-op */ } }
      return cur.filter((c) => c.id !== id);
    });
  }, []);

  // ---- Element / text / trim actions ----
  const toggleElement = useCallback((id: string) => {
    setElements((cur) => cur.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)));
  }, []);
  const deleteElement = useCallback((id: string) => {
    setElements((cur) => cur.filter((e) => e.id !== id));
  }, []);
  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(t)) { skipGuardRef.current = performance.now() + 500; v.currentTime = Math.max(0, t + 0.02); setPlayheadT(v.currentTime); }
  }, []);
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const addText = useCallback(() => {
    const item = newTextOverlay(playheadT, duration || 10);
    setTexts((cur) => [...cur, item]);
    setSelectedTextId(item.id);
    setActiveTool('text');
  }, [playheadT, duration]);
  const updateText = useCallback((id: string, patch: Partial<TextOverlayItem>) => {
    setTexts((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);
  const removeText = useCallback((id: string) => {
    setTexts((cur) => cur.filter((t) => t.id !== id));
    setSelectedTextId((cur) => (cur === id ? null : cur));
  }, []);

  const setInAtPlayhead = useCallback(() => {
    setInPoint(clamp(Math.round(playheadT * 10) / 10, 0, Math.max(0, (outPoint || duration) - 0.5)));
  }, [playheadT, outPoint, duration]);
  const setOutAtPlayhead = useCallback(() => {
    setOutPointRaw(clamp(Math.round(playheadT * 10) / 10, inPoint + 0.5, duration || playheadT));
  }, [playheadT, inPoint, duration]);
  const resetTrim = useCallback(() => { setInPoint(0); setOutPointRaw(0); setSplits([]); setRemovedKeys([]); }, []);
  const splitAtPlayhead = useCallback(() => {
    const t = Math.round(playheadT * 10) / 10;
    const hi = outPoint || duration;
    if (t <= inPoint + 0.2 || t >= hi - 0.2) return;
    setSplits((cur) => (cur.some((s) => Math.abs(s - t) < 0.15) ? cur : [...cur, t].sort((a, b) => a - b)));
  }, [playheadT, inPoint, outPoint, duration]);
  const clearSplits = useCallback(() => { setSplits([]); setRemovedKeys([]); }, []);
  const toggleSegment = useCallback((key: string) => {
    setRemovedKeys((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      const segs = buildSegments(inPoint, outPoint || duration, splits, next);
      if (!segs.some((s) => s.kept)) return cur; // never allow cutting everything
      return next;
    });
  }, [inPoint, outPoint, duration, splits]);

  // ---- Timeline scrubber with in/out handles ----
  const timelineDragRef = useRef<null | 'seek' | 'in' | 'out'>(null);
  const timeFromPointer = useCallback((clientX: number) => {
    const el = timelineRef.current;
    if (!el || !duration) return 0;
    const r = el.getBoundingClientRect();
    return clamp((clientX - r.left) / Math.max(1, r.width), 0, 1) * duration;
  }, [duration]);

  const applyTimelineDrag = useCallback((mode: 'seek' | 'in' | 'out', t: number) => {
    if (mode === 'in') setInPoint(clamp(Math.round(t * 10) / 10, 0, Math.max(0, (outPointRaw > 0 ? outPointRaw : duration) - 0.5)));
    else if (mode === 'out') setOutPointRaw(clamp(Math.round(t * 10) / 10, inPoint + 0.5, duration));
    else {
      const v = videoRef.current;
      if (v) { skipGuardRef.current = performance.now() + 500; v.currentTime = t; setPlayheadT(t); }
    }
  }, [duration, inPoint, outPointRaw]);

  const onTimelinePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration || showingOutput) return;
    const el = timelineRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pps = r.width / duration;
    const t = timeFromPointer(e.clientX);
    const nearIn = Math.abs(t - inPoint) * pps < 9;
    const nearOut = Math.abs(t - (outPoint || duration)) * pps < 9;
    const mode: 'seek' | 'in' | 'out' = nearIn && (!nearOut || Math.abs(t - inPoint) <= Math.abs(t - (outPoint || duration))) ? 'in' : nearOut ? 'out' : 'seek';
    timelineDragRef.current = mode;
    try { el.setPointerCapture(e.pointerId); } catch { /* no-op */ }
    applyTimelineDrag(mode, t);
    e.preventDefault();
  }, [duration, showingOutput, inPoint, outPoint, timeFromPointer, applyTimelineDrag]);

  const onTimelinePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const mode = timelineDragRef.current;
    if (!mode) return;
    applyTimelineDrag(mode, timeFromPointer(e.clientX));
  }, [timeFromPointer, applyTimelineDrag]);

  const onTimelinePointerUp = useCallback(() => { timelineDragRef.current = null; }, []);

  const previewFilter = showingOutput ? 'none' : filterCss(effects);
  const editDisabled = exporting || duration <= 0;
  const timelineDur = duration || 0;
  const effOut = outPoint || timelineDur;

  // -----------------------------------------------------------------------------
  return (
    <div style={{
      height: '100%', overflowY: 'auto', color: P.text, fontFamily: "'Inter', system-ui, sans-serif",
      background: 'radial-gradient(900px 480px at 8% -6%, rgba(61,139,255,0.14), transparent 55%), radial-gradient(760px 420px at 96% 0%, rgba(52,224,176,0.10), transparent 52%), radial-gradient(700px 500px at 50% 110%, rgba(167,139,250,0.08), transparent 60%), ' + P.bg,
    }}>
      <style>{VE_CSS}</style>
      <div style={{ maxWidth: 1460, margin: '0 auto', padding: 'clamp(14px, 2.5vw, 24px) clamp(12px, 2.5vw, 22px) 48px' }}>

        {/* Header */}
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '14px 18px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(61,139,255,0.22), rgba(52,224,176,0.16))', border: '1px solid rgba(61,139,255,0.35)', flexShrink: 0 }}>
              <Wand2 size={21} style={{ color: P.blue }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="ve-gradient-text" style={{ fontSize: 'clamp(18px, 2.4vw, 22px)', fontWeight: 850, letterSpacing: -0.4 }}>Video Enhancer</div>
              <div style={{ fontSize: 12, color: P.sub, marginTop: 2 }}>
                AI analysis · trim & cut · effects · text · auto captions · aspect ratios · AI music & sound effects · one-click download
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {localUrl && (
              <button onClick={resetAll} disabled={exporting || analyzing} className="ve-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: P.sub, background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 10, padding: '9px 13px', cursor: exporting || analyzing ? 'not-allowed' : 'pointer' }}>
                <RefreshCw size={13} /> Start over
              </button>
            )}
            {localUrl && (
              /* PRD 3.4 — Enhance video (analysis + improvement pass) sits apart
                 from Download and carries a different visual weight. */
              <button
                onClick={() => { setActiveTool('analyze'); void runAnalyze(); }}
                disabled={analyzing || exporting || (!file && !uploadedUrl)}
                className="ve-btn"
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, borderRadius: 11,
                  padding: '10px 18px', border: 'none', cursor: analyzing || exporting ? 'not-allowed' : 'pointer',
                  background: analyzing ? P.panelSoft : 'linear-gradient(100deg, ' + P.blue + ', ' + P.violet + ')',
                  color: analyzing ? P.muted : '#fff',
                  boxShadow: analyzing ? 'none' : '0 12px 30px -14px rgba(61,139,255,0.7)',
                }}
              >
                {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                {analyzing ? 'Enhancing…' : 'Enhance video'}
              </button>
            )}
            {localUrl && (
              <button
                onClick={() => setActiveTool('export')}
                disabled={exporting}
                className="ve-btn"
                title="Prepare and download the finished file"
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, borderRadius: 11,
                  padding: '10px 18px', border: 'none', cursor: exporting ? 'not-allowed' : 'pointer',
                  background: exporting ? P.panelSoft : 'linear-gradient(100deg, ' + P.mint + ', ' + P.cyan + ')',
                  color: exporting ? P.muted : '#04241B',
                  boxShadow: exporting ? 'none' : '0 12px 30px -14px rgba(52,224,176,0.75)',
                }}
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {exporting ? 'Preparing ' + Math.round(exportProgress * 100) + '%' : 'Download'}
              </button>
            )}
          </div>
        </div>

        {!localUrl ? (
          /* ---------- Drag & drop upload zone ---------- */
          <div style={{ ...cardStyle, padding: 12 }}>
            <label
              className="ve-drop"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
                minHeight: 380, borderRadius: 14, cursor: 'pointer', textAlign: 'center', padding: '36px 28px',
                border: '2px dashed ' + (dragOver ? P.blue : P.border),
                background: dragOver ? 'rgba(61,139,255,0.10)' : 'linear-gradient(150deg, rgba(61,139,255,0.05), rgba(167,139,250,0.04) 55%, rgba(52,224,176,0.05))',
                boxShadow: dragOver ? '0 0 0 1px ' + P.blue + ' inset, 0 0 34px rgba(61,139,255,0.25) inset' : 'none',
              }}
            >
              <input type="file" accept="video/mp4,video/webm,video/quicktime" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
              <div style={{ width: 66, height: 66, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(61,139,255,0.14)', border: '1px solid rgba(61,139,255,0.4)' }}>
                <UploadCloud size={30} style={{ color: P.blue }} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.2 }}>Drop your footage here, or click to choose</div>
              <div style={{ fontSize: 13, color: P.muted, maxWidth: 480, lineHeight: 1.55 }}>
                MP4, WebM or MOV up to 500 MB. Then trim, grade, add text, reframe, drop in an AI music bed — and let the AI design graphic overlays that fit what is actually happening in your video.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
                {TOOLS.slice(1).map((t) => {
                  const Icon = t.icon;
                  return (
                    <span key={t.id} className="ve-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: t.color, background: 'rgba(7,10,18,0.6)', border: '1px solid ' + t.color + '55', borderRadius: 999, padding: '4px 10px' }}>
                      <Icon size={11} /> {t.label}
                    </span>
                  );
                })}
              </div>
              {uploadErr && <ErrLine>{uploadErr}</ErrLine>}
            </label>
          </div>
        ) : (
          /* ---------- Editor: tool rail | preview + timeline | active panel ---------- */
          <div className="ve-editor-grid">

            {/* Tool rail */}
            <div className="ve-rail">
              {TOOLS.map((t) => {
                const Icon = t.icon;
                const active = activeTool === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTool(t.id)}
                    className="ve-tab ve-btn"
                    title={t.label}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '11px 6px', borderRadius: 12, cursor: 'pointer', minWidth: 64,
                      background: active ? 'rgba(140,155,255,0.13)' : 'transparent',
                      border: '1px solid ' + (active ? t.color + '66' : 'transparent'),
                      color: active ? t.color : P.muted,
                    }}
                  >
                    <Icon size={17} />
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Preview column */}
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ ...cardStyle, padding: 12 }}>
                {/* The preview is the centrepiece: with the transport and
                    scrubber below it, this card occupies roughly 60% of the
                    viewport height, and the clamp keeps short windows usable. */}
                <div ref={previewAreaRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'clamp(300px, 56vh, 620px)', background: '#020409', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ position: 'relative', width: Math.max(120, pvW), height: Math.max(80, pvH), background: '#000', overflow: 'hidden', borderRadius: 4 }}>
                    <video
                      ref={videoRef}
                      src={playerSrc}
                      playsInline
                      onClick={togglePlay}
                      onError={() => {
                        // A broken enhanced output must never sit as a blank
                        // rectangle: fall back to the original and say why.
                        if (showingOutput) {
                          setViewOriginal(true);
                          setOutputIssue('The enhanced video could not be loaded, so the player switched back to your original. Open the Export tab and export again to rebuild it.');
                        }
                      }}
                      onLoadedMetadata={(e) => {
                        // Only the SOURCE defines the edit timeline; the
                        // exported output has its own (shorter) length.
                        if (showingOutput) return;
                        const v = e.currentTarget;
                        if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
                      }}
                      style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%',
                        objectFit: showingOutput ? 'contain' : (aspect === 'original' ? 'contain' : 'cover'),
                        filter: previewFilter, background: '#000', cursor: 'pointer',
                      }}
                    />
                    {!showingOutput && effects.vignette > 0 && (
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,' + (0.62 * effects.vignette / 100).toFixed(3) + ') 100%)' }} />
                    )}
                    {!showingOutput && (
                      <canvas
                        ref={overlayCanvasRef}
                        onPointerDown={onCanvasPointerDown}
                        onPointerMove={onCanvasPointerMove}
                        onPointerUp={onCanvasPointerUp}
                        onPointerCancel={onCanvasPointerUp}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: activeTool === 'text' ? 'auto' : 'none', touchAction: 'none', cursor: activeTool === 'text' ? 'move' : 'default' }}
                      />
                    )}
                    {/* Render-in-progress state: the player says what is happening instead of going quiet. */}
                    {exporting ? (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'rgba(2,4,9,0.72)', textAlign: 'center', padding: 16 }} data-testid="export-overlay">
                        <Loader2 size={26} className="animate-spin" style={{ color: P.mint }} />
                        <div style={{ fontSize: 13.5, fontWeight: 800 }}>Exporting {Math.round(exportProgress * 100)}%</div>
                        <div style={{ fontSize: 12, color: P.sub, maxWidth: 360, lineHeight: 1.5 }}>{exportNote || 'Compositing your edit…'}</div>
                      </div>
                    ) : null}
                    <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, pointerEvents: 'none' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: '4px 9px', borderRadius: 7, background: showingOutput ? 'rgba(52,224,176,0.28)' : 'rgba(0,0,0,0.55)', border: '1px solid ' + (showingOutput ? P.mint : 'rgba(255,255,255,0.25)'), color: showingOutput ? P.mint : '#fff' }}>
                        {showingOutput ? 'ENHANCED OUTPUT' : 'LIVE PREVIEW'}
                      </div>
                      {outputUrl && (
                        <button
                          onClick={() => setViewOriginal((v) => !v)}
                          className="ve-btn"
                          style={{ pointerEvents: 'auto', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer' }}
                        >
                          {showingOutput ? 'View original' : 'View output'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* The editor is gated on the source duration — say so rather
                    than presenting a row of dead controls. */}
                {localUrl && duration <= 0 && !uploading ? (
                  <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 10, padding: '9px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5, color: P.amber, background: 'rgba(255,178,36,0.08)', border: '1px solid rgba(255,178,36,0.35)' }} data-testid="duration-pending">
                    <Loader2 size={14} className="animate-spin" style={{ flexShrink: 0, marginTop: 1 }} />
                    Reading your video's length — trim, text timing and export unlock as soon as it loads. If this stays put, the file may be unreadable in this browser; try Start over with an MP4.
                  </div>
                ) : null}

                {outputIssue ? (
                  <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 10, padding: '9px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5, color: P.coral, background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.35)' }} data-testid="output-issue">
                    <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {outputIssue}
                  </div>
                ) : null}

                {/* Transport */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={togglePlay}
                    className="ve-btn"
                    title={isPlaying ? 'Pause' : 'Play'}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 11, border: '1px solid ' + P.border, background: P.panelSoft, color: P.text, cursor: 'pointer', flexShrink: 0 }}
                  >
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <span style={{ fontSize: 12.5, color: P.sub, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                    {formatTime(playheadT)} <span style={{ color: P.muted }}>/ {formatTime(timelineDur)}</span>
                  </span>
                  {effects.speed !== 1 && !showingOutput && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: P.amber, background: 'rgba(255,178,36,0.10)', border: '1px solid rgba(255,178,36,0.4)', borderRadius: 999, padding: '3px 9px' }}>{effects.speed}×</span>
                  )}
                  {hasEdits && !showingOutput && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: P.blue, background: 'rgba(61,139,255,0.10)', border: '1px solid rgba(61,139,255,0.4)', borderRadius: 999, padding: '3px 9px' }}>{formatTime(keptSecs)} kept</span>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: P.sub, background: P.panelSoft, border: '1px solid ' + P.borderSoft, borderRadius: 8, padding: '5px 10px', minWidth: 0, marginLeft: 'auto' }}>
                    <Film size={12} style={{ flexShrink: 0, color: P.violet }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{file?.name || 'Saved source video'}</span>
                  </div>
                  {uploading && <span style={{ fontSize: 11.5, color: P.blue, display: 'flex', gap: 5, alignItems: 'center' }}><Loader2 size={12} className="animate-spin" /> Uploading…</span>}
                  {uploadedUrl && !uploading && <span style={{ fontSize: 11.5, color: P.mint, display: 'flex', gap: 4, alignItems: 'center' }}><Check size={12} /> Stored</span>}
                  {uploadErr && <span style={{ fontSize: 11.5, color: P.coral, display: 'flex', gap: 4, alignItems: 'center' }}><AlertCircle size={12} /> {uploadErr}</span>}
                </div>

                {/* Timeline scrubber with in/out handles */}
                {timelineDur > 0 && (
                  <div style={{ marginTop: 10, opacity: showingOutput ? 0.35 : 1, transition: 'opacity .2s ease' }}>
                    <div
                      ref={timelineRef}
                      onPointerDown={onTimelinePointerDown}
                      onPointerMove={onTimelinePointerMove}
                      onPointerUp={onTimelinePointerUp}
                      onPointerCancel={onTimelinePointerUp}
                      style={{ position: 'relative', height: 38, background: P.panelSoft, border: '1px solid ' + P.borderSoft, borderRadius: 9, overflow: 'hidden', cursor: showingOutput ? 'default' : 'pointer', touchAction: 'none' }}
                    >
                      {/* Outside in/out shading */}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: (inPoint / timelineDur) * 100 + '%', background: 'rgba(2,4,9,0.72)' }} />
                      <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: (100 - (effOut / timelineDur) * 100) + '%', background: 'rgba(2,4,9,0.72)' }} />
                      {/* Cut segments */}
                      {segments.filter((s) => !s.kept).map((s) => (
                        <div key={s.key} style={{ position: 'absolute', top: 0, bottom: 0, left: (s.start / timelineDur) * 100 + '%', width: ((s.end - s.start) / timelineDur) * 100 + '%', background: 'repeating-linear-gradient(45deg, rgba(255,107,107,0.16), rgba(255,107,107,0.16) 5px, rgba(2,4,9,0.6) 5px, rgba(2,4,9,0.6) 10px)' }} />
                      ))}
                      {/* Split markers */}
                      {splits.map((s) => (
                        <div key={s} style={{ position: 'absolute', top: 0, bottom: 0, width: 1.5, background: 'rgba(255,178,36,0.8)', left: (s / timelineDur) * 100 + '%' }} />
                      ))}
                      {/* Overlay element markers */}
                      {elements.map((el) => (
                        <div
                          key={el.id}
                          title={el.text || el.kind}
                          style={{
                            position: 'absolute', top: 4, height: 7, borderRadius: 3,
                            left: (el.start / timelineDur) * 100 + '%',
                            width: Math.max(0.6, ((el.end - el.start) / timelineDur) * 100) + '%',
                            background: el.color + (el.enabled ? 'CC' : '33'),
                          }}
                        />
                      ))}
                      {/* Text overlay markers */}
                      {texts.map((t) => (
                        <div
                          key={t.id}
                          title={t.text}
                          style={{
                            position: 'absolute', bottom: 4, height: 7, borderRadius: 3,
                            left: (t.start / timelineDur) * 100 + '%',
                            width: Math.max(0.6, ((t.end - t.start) / timelineDur) * 100) + '%',
                            background: t.color + 'B8',
                            outline: t.id === selectedTextId ? '1px solid #fff' : 'none',
                          }}
                        />
                      ))}
                      {/* In / out handles */}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, width: 10, marginLeft: -5, left: (inPoint / timelineDur) * 100 + '%', cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 4, height: '78%', borderRadius: 3, background: P.mint, boxShadow: '0 0 8px rgba(52,224,176,0.8)' }} />
                      </div>
                      <div style={{ position: 'absolute', top: 0, bottom: 0, width: 10, marginLeft: -5, left: (effOut / timelineDur) * 100 + '%', cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 4, height: '78%', borderRadius: 3, background: P.mint, boxShadow: '0 0 8px rgba(52,224,176,0.8)' }} />
                      </div>
                      {/* Playhead */}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: '#FFFFFF', opacity: 0.95, left: (playheadT / timelineDur) * 100 + '%', pointerEvents: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: P.muted, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                      <span>0:00</span>
                      <span style={{ color: P.sub }}>drag the mint handles to trim · drag anywhere to scrub</span>
                      <span>{formatTime(timelineDur)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Active tool panel */}
            <div style={{ minWidth: 0, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', paddingRight: 2 }} key={activeTool}>
              {activeTool === 'analyze' && (
                <AnalyzePanel
                  analyzing={analyzing} analyzeNote={analyzeNote} analyzeErr={analyzeErr}
                  summary={summary} insights={insights} elements={elements}
                  canAnalyze={!!file || !!uploadedUrl} exporting={exporting}
                  onAnalyze={() => { void runAnalyze(); }}
                  onToggleElement={toggleElement} onDeleteElement={deleteElement} onSeek={seekTo}
                />
              )}
              {activeTool === 'trim' && (
                <TrimPanel
                  duration={timelineDur} inPoint={inPoint} outPoint={effOut} playheadT={playheadT}
                  segments={segments} splits={splits} keptSeconds={keptSecs} disabled={editDisabled}
                  onSetIn={setInAtPlayhead} onSetOut={setOutAtPlayhead} onResetTrim={resetTrim}
                  onSplit={splitAtPlayhead} onClearSplits={clearSplits} onToggleSegment={toggleSegment} onSeek={seekTo}
                />
              )}
              {activeTool === 'effects' && (
                <EffectsPanel effects={effects} disabled={editDisabled} onChange={setEffects} />
              )}
              {activeTool === 'text' && (
                <TextPanel
                  texts={texts} selectedId={selectedTextId} duration={timelineDur} playheadT={playheadT}
                  disabled={editDisabled} onSelect={setSelectedTextId} onAdd={addText}
                  onUpdate={updateText} onRemove={removeText}
                />
              )}
              {activeTool === 'captions' && (
                <CaptionsPanel
                  captionsOn={captionsOn} styleId={captionStyleId} segments={captionSegments}
                  transcribing={transcribing} note={transcribeNote} err={transcribeErr}
                  hasVideo={!!file || !!uploadedUrl} disabled={exporting}
                  onToggleOn={setCaptionsOn} onStyle={setCaptionStyleId} onGenerate={() => { void runGenerateCaptions(); }}
                  onToggleSegment={toggleCaptionSegment} onDeleteSegment={deleteCaptionSegment}
                  onEditSegment={editCaptionSegment} onSeek={seekTo}
                />
              )}
              {activeTool === 'frame' && (
                <FramePanel
                  aspect={aspect} muteOriginal={muteOriginal} originalVolume={originalVolume}
                  disabled={exporting} onAspect={setAspect} onMute={setMuteOriginal} onVolume={setOriginalVolume}
                />
              )}
              {activeTool === 'music' && (
                <MusicPanel
                  track={musicTrack} trackUrl={musicUrl} musicVolume={musicVolume}
                  busy={musicBusy} note={musicNote} err={musicErr} prompt={musicPrompt}
                  keptSeconds={keptSecs || timelineDur} disabled={exporting}
                  onPrompt={setMusicPrompt} onGenerate={() => { void runMusic(); }}
                  onVolume={setMusicVolume} onRemove={removeMusic}
                />
              )}
              {activeTool === 'sfx' && (
                <SfxPanel
                  cues={sfxCues} busy={sfxBusy} note={sfxNote} err={sfxErr}
                  playheadT={playheadT} duration={timelineDur} disabled={exporting}
                  onAdd={(label, prompt, secs) => { void addSfxCue(label, prompt, secs); }}
                  onUpdate={updateSfxCue} onRemove={removeSfxCue} onSeek={seekTo}
                />
              )}
              {activeTool === 'export' && (
                <ExportPanel
                  format={format} quality={quality} exporting={exporting} progress={exportProgress}
                  note={exportNote} err={exportErr} outputUrl={outputUrl}
                  canExport={canExport} disabled={analyzing}
                  keptSeconds={keptSecs || timelineDur} speed={effects.speed}
                  overlayCount={elements.filter((e) => e.enabled).length} textCount={texts.length}
                  hasMusic={!!musicTrack} aspect={aspect} downloadExt={outputExt}
                  hasCaptions={captionsOn && captionSegments.some((s) => s.enabled)}
                  sfxCount={sfxCues.filter((c) => c.status === 'ready').length}
                  onFormat={setFormat} onQuality={setQuality} onExport={() => { void runExport(); }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface VEBoundaryState { error: Error | null }

/** Error boundary: an unexpected runtime error renders a recovery card instead
 * of a blank screen. Upload, plan, edit state and output are persisted, so
 * remounting restores the session. */
class VideoEnhancerBoundary extends Component<{ children?: ReactNode }, VEBoundaryState> {
  state: VEBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): VEBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: unknown) {
    console.error('[VideoEnhancer] crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: P.text, background: P.bg }}>
          <div style={{ maxWidth: 460, textAlign: 'center', background: P.panel, border: '1px solid ' + P.border, borderRadius: 16, padding: '28px 24px' }}>
            <AlertCircle size={28} style={{ color: P.coral, display: 'block', margin: '0 auto 10px' }} />
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Video Enhancer hit a snag</div>
            <div style={{ fontSize: 13, color: P.muted, lineHeight: 1.5, marginBottom: 14 }}>
              Your upload and edit are saved — nothing is lost. Reload the editor to pick up where you left off.
            </div>
            <button onClick={() => this.setState({ error: null })} style={{ fontSize: 13, fontWeight: 800, color: '#fff', background: P.blue, border: 'none', borderRadius: 10, padding: '10px 18px', cursor: 'pointer' }}>
              Reload editor
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <VideoEnhancerBoundary>
      <VideoEnhancerApp />
    </VideoEnhancerBoundary>
  );
}
