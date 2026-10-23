/**
 * VIDEO STUDIO — Vidverge's all-in-one AI editor (Oct 1 2026 rework).
 *
 * One editor, no round trips. Upload footage and within a couple of minutes
 * you have a reviewable CUT PLAN; from there everything happens on the same
 * timeline:
 *
 *   · agentic editing      cut-plan cards with a reason and a predicted
 *                          retention score, Accept / Reject, plus a chat
 *                          sidebar that proposes more edits mid-session
 *   · transcript-first     word-timed transcript; delete text and the video
 *                          cuts with it; one tap clears every filler word
 *   · auto-reframe         16:9 / 9:16 / 1:1 / 4:5 with subject tracking and a
 *                          side-by-side proof; export several formats at once
 *   · b-roll slots         silence, pause and low-action gaps detected and
 *                          fillable from a prompt, your own clip or the library
 *   · pro timeline         colour-coded tracks, trim handles, split, reorder,
 *                          multi-select, per-clip crop / adjust / speed
 *   · overlays             logo and image layers with masks, blend modes and
 *                          optical-flow-approximation auto-tracking
 *   · captions             eight presets, full type control, burn-in or SRT
 *   · text + FX            animated text layers, visual effects, transitions
 *   · export               MP4 at 720p / 1080p / 4K, per format, with progress
 *
 * The heavy lifting is split deliberately: measurement and compositing run in
 * the browser (Web Audio, canvas, CSS), judgement runs through the platform AI
 * proxy, and the final render runs server-side in the veh-render hook from the
 * same descriptors the preview used.
 *
 * The SceneForge and Vidverge Agent handoff contracts are preserved. This app
 * is now one focused professional editor; Product Video is not embedded here.
 */
import { Component, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AlertCircle, Download, Loader2, Maximize, Pause, Play, Redo2,
  Scissors, Sparkles, Undo2, UploadCloud, Volume2, X,
} from 'lucide-react';
import { LB_SHIMMER_CSS } from '../../components/LightBeam';
import AppShell from '../../components/ui/AppShell';
import RunwayStudio from '../../components/RunwayStudio';
import { VideoHistory } from '../../components/VideoHistory';
import { saveVideoToHistory } from '../../lib/videoHistory';
import { AgentChatProvider } from '../../components/AgentChat/AgentChatContext';
import { AgentChatButton } from '../../components/AgentChat/AgentChatButton';
import { AgentChatPanel } from '../../components/AgentChat/AgentChatPanel';
import { consumeVidvergeHandoff } from '../../lib/vidvergeHandoff';
import { MODEL_CHOICES, VEO_31_FAST_MODEL } from '../../lib/appIds';
import { poll, PollTimeoutError } from '../../lib/poll';
import { MUSIC_BEDS, callHook } from './nleCore';
import { fetchVideoAsFile, uploadVideo, workspaceToken } from './enhancerCore';
import {
  ASPECTS, AspectId, Adjust, BrollSlot, CameraShake, CaptionSettings,
  ChromaKeyState, CropRect, EditCard, EditDoc, GradeId, LB, MAX_UPLOAD_BYTES,
  MusicStyleId, Overlay, RESOLUTIONS, ResolutionId, ReframeState, SpeedRamp, STUDIO_FONTS_URL, StudioClip,
  SubjectProfile, TextLayer, TransitionId, TRANSITIONS, VfxState, VideoOverlay, VisualEffectId,
  WordToken, ZoomCut, aspectRatio, buildSrt, captionsFromWords, clampN,
  clipLength, clipMotion, clipStart, cutSourceRanges, defaultChroma, defaultVfx, emptyDoc, fmtTimecode,
  locate, mergeRanges, newClip, newId, newOverlay, newTextLayer,
  newVideoOverlay, outputDims, restoreSourceRanges, serialiseDoc,
  sourceToTimeline, splitClipAt, timelineDuration,
} from './studioModel';
import { analyseAudio, fillerIds, removeWords, restoreWords, transcribeForStudio, type AudioAnalysis } from './studioTranscript';
import {
  brollPromptFromContext, buildCutPlan, chatForEdits, segmentRetention,
  type ChatAction, type ChatTurn, type PlanContext,
} from './studioAgent';
import { captureThumb, detectSubjectTrack, lowActionRegions, trackOverlaySubject } from './studioVision';
import StudioStage from './studioStage';
import { BrollPanel, ChatPanel, CutPlanPanel, TranscriptPanel, type ChatMessage } from './studioPanels';
import {
  ClipInspector, ExportInspector, LookInspector, OverlayInspector,
  ReframeInspector, TextInspector, cropForAspect,
} from './studioInspector';
import EffectsSidebar, { type EffectsTabId } from './studioEffects';
import { warp, warpRate } from './studioFx';
import {
  captionMaxWords, detectLanguage, mergeCues, retimeCue, saveCaptionTrack,
  shiftCue, splitCue,
} from './studioCaptionKit';
import {
  detectSubjectProfile, generateBackgroundMusic, rankBrollSuggestions,
} from './studioPhase2';
import { AiMusicPanel, ClipManagerPanel, StickyExportBar } from './studioPhase2Panels';
import {
  FriendlyError, GUIDE_CSS, STUDIO_STEPS, ToastStack, VE, copyLink,
  useIsMobile, usePreviewPulse, useToasts, vePrimary,
} from './studioGuide';
import type { StepId } from './studioGuide';
import {
  STYLE_PRESETS, applyPreset,
} from './studioPresets';
import type { StudioPreset } from './studioPresets';
import { Clapperboard, Diamond } from 'lucide-react';
import { WORKSPACE_UUID, clipFilterCss, keyframeAt } from './studioModel';
import { PRO_CSS, PRO_FONTS_URL, type RunState } from './proUi';
import ProControls, {
  AgentStrip, EDIT_PRESETS, LOOKS, PRO_TABS, applyEditPreset, applyLook, motionKeys,
  type EditPreset, type MotionKind, type ProTabId,
} from './proPanels';
import ProTimeline from './proTimeline';
import ProAgent, { emptyJobs, routeInstruction, type AgentActionId, type AgentJobs } from './proAgent';
import ProExport, { encodeGif, encodeWebm, type ExportResult, type ExportSpec } from './proExport';
import { withBrandContext } from '../../components/BrandContextLayer';
import { detectTempo } from './proAudio';

/** Which legacy effects tab belongs under each pro tab. */
const FX_FOR_TAB: Record<ProTabId, EffectsTabId> = {
  effects: 'overlays',
  presets: 'overlays',
  text: 'captions',
  motion: 'motion',
  color: 'vfx',
  audio: 'music',
};

const WORKSPACE_LOGO = 'https://storage.googleapis.com/audos-images/attachments/general/c0902809-6dc4-4e0c-b04e-1f60e01b31e6.png';

/**
 * Turn anything thrown anywhere in the studio into a sentence a first-time
 * creator can act on. A raw error object, a stack, a JSON body or an HTML
 * error page must never reach the screen — those go to the console instead.
 */
function msg(e: unknown): string {
  const raw = (e instanceof Error ? e.message : typeof e === 'string' ? e : '').trim();
  if (/session required|workspace session/i.test(raw)) return 'Your sign-in session could not be verified, so this step was refused before anything was charged. Refresh, sign in again, then retry.';
  if (/no_credentials|\b401\b/i.test(raw)) return 'Your workspace session is still waking up. Try again in a moment.';
  if (/insufficient|wallet balance|\b402\b/i.test(raw)) return 'This step needs more workspace credits before it can run.';
  if (/rate.?limit|\b429\b/i.test(raw)) return 'Things are busy right now. Wait a few seconds, then try again.';
  if (/provider[_ -]?error|\b50[0234]\b|service unavailable|timed out|timeout/i.test(raw)) {
    return 'That step could not finish just now. Your edit is saved — try again shortly.';
  }
  if (/network|failed to fetch|load failed/i.test(raw)) return 'The connection dropped. Check your internet, then try again.';
  if (!raw) return 'Something went wrong — please try again.';
  if (raw.length > 170 || /[{}<>]|\[object |\bundefined\b|\bHTTP \d{3}\b/.test(raw)) {
    console.error('[VideoStudio]', e);
    return 'Something went wrong — please try again.';
  }
  return raw;
}

const STUDIO_CSS = `
@keyframes vs-spin { to { transform: rotate(360deg); } }
.vs-spin { animation: vs-spin 1s linear infinite; }
.vs-btn, .ve-btn { transition: filter .15s ease, background .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease; }
.vs-btn:hover:not(:disabled), .ve-btn:hover:not(:disabled) { filter: brightness(1.15); }
.vs-btn:disabled, .ve-btn:disabled { opacity: .5; cursor: default; }
.vs-input:focus, .ve-input:focus { outline: 2px solid var(--vg-focus); outline-offset: 3px; border-color: var(--vg-focus) !important; box-shadow: none; }
@keyframes vs-progress { 0% { background-position: 0 0; } 100% { background-position: 28px 0; } }
.vs-progress { background-image: linear-gradient(45deg, rgba(255,255,255,0.18) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.18) 75%, transparent 75%, transparent); background-size: 28px 28px; animation: vs-progress .9s linear infinite; }
.vs-rail::-webkit-scrollbar { width: 8px; }
.vs-rail::-webkit-scrollbar-thumb { background: var(--vg-border); border-radius: 6px; }
${LB_SHIMMER_CSS}
${GUIDE_CSS}
/* Resizable timeline: the bottom grid row follows --ve-tl-h (auto when unset or collapsed). */
.vp-root .vp-body { grid-template-rows: minmax(0, 1fr) var(--ve-tl-h, auto); grid-template-columns: minmax(0, 1fr) !important; }
.vp-root .vp-stagecol { grid-column: 1; grid-row: 1; min-height: 0; }
.vp-root .vp-tl { grid-column: 1; grid-row: 2; }
.vp-root .vp-side { display: none; }
.vp-root .vp-side.open { display: flex; position: fixed; z-index: 82; top: 64px; right: 16px; bottom: 16px; width: min(460px, calc(100vw - 32px)); min-height: 0; border: 1px solid var(--vg-border); border-radius: 16px; background: var(--vg-raised); box-shadow: 0 18px 48px rgba(0,0,0,.52); overflow: hidden; }
.vp-root .vp-drawerhead { flex:0 0 auto; display:flex; align-items:center; gap:12px; padding:12px 14px; border-bottom:1px solid var(--vg-border); background:var(--vg-raised); }
.vp-root .vp-drawerhead > span { display:grid; gap:2px; min-width:0; }
.vp-root .vp-drawerhead b { color:var(--vg-text); font-size:14px; letter-spacing:0; }
.vp-root .vp-drawerhead small { color:var(--vg-muted); font-size:12px; }
.vp-root .vp-drawerhead button { margin-left:auto; }
.vp-root .vp-toolstack { display:flex; flex-direction:column; gap:0; border:1px solid rgba(255,255,255,.07); border-radius:12px; background:rgba(255,255,255,.03); overflow:visible; }
.vp-root .vp-toolstack-head { display:flex; align-items:center; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.07); background:rgba(212,146,10,.08); }
.vp-root .vp-toolstack-head span { display:grid; gap:2px; }
.vp-root .vp-toolstack-head b { color:#F0B429; font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
.vp-root .vp-toolstack-head small { color:#9E8B55; font-size:10px; }
.vp-root .vp-toolstack-body { padding:10px; display:flex; flex-direction:column; gap:10px; }
.vp-root .vp-aiimage { display:flex; flex-direction:column; padding:12px; border-radius:12px; border:1px solid rgba(212,146,10,.3); background:linear-gradient(145deg,rgba(212,146,10,.12),rgba(28,24,8,.94)); box-shadow:inset 0 1px 0 rgba(255,255,255,.05); }
.vp-root .vp-aiimage-head { display:flex; align-items:center; gap:10px; margin-bottom:11px; }
.vp-root .vp-aiimage-head span { display:grid; gap:2px; }
.vp-root .vp-aiimage-head b { color:#F0B429; font-size:12px; }
.vp-root .vp-aiimage-head small { color:#9E8B55; font-size:10px; }
.vp-root .vp-aiimage-head button { margin-left:auto; }
.vp-root .vp-aiimage .vp-btn { margin-top:11px; }
.vp-root .vp-drawerback { position: fixed; inset: 0; z-index: 81; border: 0; background: rgba(0,0,0,.58); backdrop-filter: blur(3px); cursor: default; }
.vp-root .vp-body > .vp-stagecol, .vp-root .vp-body > .vp-side { min-height: 0; }
.vp-root .vp-tl { min-height: 0; }
.vp-root .vp-tl-grip { flex: 0 0 auto; height: 6px; cursor: ns-resize; touch-action: none; background: transparent; transition: background .15s ease; }
.vp-root .vp-tl-grip:hover, .vp-root .vp-tl-grip[data-dragging="true"] { background: rgba(212,146,10,0.55); }
@media (max-width: 900px) { .vp-root .vp-body { grid-template-rows: minmax(320px,1fr) auto; } .vp-root .vp-tl-grip { display: none; } .vp-root .vp-side.open { top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; height: min(74vh, 680px); border-radius: 20px 20px 14px 14px; } }
/* Icons in rails and track labels: never squeeze the icon or clip it off the left edge. */
.vp-root .vp-trkhead { flex-basis: auto; width: auto; min-width: 76px; }
.vp-root .vp-trkhead b { white-space: nowrap; }
.vp-root .vp-trkhead b > svg, .vp-root .vp-btn > svg, .vp-root .vp-ico > svg, .vp-root .vp-actico > svg { flex: 0 0 auto; }
.vp-root .vp-btn { justify-content: safe center; }
.vp-root .vp-tab { align-items: safe center; }
@media (max-width: 900px) { .vp-root .vp-trkhead { min-width: 56px; } }
@media (prefers-reduced-motion: reduce) { .vs-spin, .vs-progress { animation: none !important; } .vs-btn, .ve-btn { transition: none !important; } }
`;

/** The picker label for a Group A model id. */
function modelLabel(model: string): string {
  return MODEL_CHOICES.find((m) => m.id === model)?.label || 'The video model';
}

/** Film one b-roll clip through the generation hook. */
async function filmBroll(prompt: string, durationS: number, aspect: AspectId, model: string, alive: () => boolean): Promise<{ url: string; error: string }> {
  let out = await callHook('veh-broll-generate', {
    model,
    prompt,
    aspect: aspect === '16:9' ? '16:9' : '9:16',
    durationS: Math.min(8, Math.max(4, Math.round(durationS) || 5)),
  });
  if (out?.status === 'generating' && out.operationId) {
    const operationId = String(out.operationId);
    out = await poll(
      async () => (alive()
        ? callHook('veh-broll-generate', { operationId })
        : { status: 'cancelled' }),
      {
        interval: 4_000,
        timeout: 15 * 60 * 1_000,
        backoff: 1.1,
        maxInterval: 15_000,
        until: (status) => status?.status !== 'generating',
      },
    );
  }
  if (out?.status === 'completed' && out.videoUrl) return { url: String(out.videoUrl), error: '' };
  return { url: '', error: String(out?.error || 'The b-roll generation did not complete.') };
}

/** Generate one fast, subject-matched cutaway through the shared B-roll hook. */
async function generateOmniBroll(
  prompt: string,
  model: string,
  aspect: AspectId,
  referenceImage: string,
  onProgress: (progress: number) => void,
  alive: () => boolean,
): Promise<string> {
  const label = modelLabel(model);
  const started = await callHook('veh-broll-generate', {
    model,
    prompt,
    aspect: aspect === '16:9' ? '16:9' : '9:16',
    durationS: 5,
    ...(referenceImage ? { referenceImage } : {}),
  });
  onProgress(Number(started?.progress) || 10);
  if (started?.status === 'completed' && started.videoUrl) return String(started.videoUrl);
  if (started?.status === 'failed') {
    throw new Error(String(started.error || started.errorMessage || `${label} could not generate this clip.`));
  }
  if (!started?.operationId) {
    throw new Error(String(started?.error || `${label} could not start.`));
  }

  const operationId = String(started.operationId);
  try {
    const final = await poll(async () => {
      if (!alive()) return { cancelled: true as const, status: null as any };
      const status = await callHook('veh-broll-generate', { operationId });
      return { cancelled: false as const, status };
    }, {
      interval: 5_000,
      timeout: 6 * 60 * 1_000,
      until: (result) => Boolean(result.cancelled || result.status?.status === 'completed' || result.status?.status === 'failed'),
      onTick: (result) => {
        if (result.status) onProgress(Number(result.status.progress) || 0);
      },
    });
    if (final.cancelled) return '';
    if (final.status?.status === 'completed' && final.status.videoUrl) return String(final.status.videoUrl);
    throw new Error(String(final.status?.error || final.status?.errorMessage || `${label} could not generate this clip.`));
  } catch (e) {
    if (e instanceof PollTimeoutError) throw new Error(`${label} took too long to finish. Retry to start a fresh clip.`);
    throw e;
  }
}

function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (d: number) => { v.removeAttribute('src'); try { v.load(); } catch { /* detached */ } resolve(d); };
    v.addEventListener('loadedmetadata', () => done(Number.isFinite(v.duration) ? v.duration : 0), { once: true });
    v.addEventListener('error', () => done(0), { once: true });
    v.src = url;
  });
}

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ===========================================================================
// The studio
// ===========================================================================

function VideoStudio() {
  // ---- the document, plus undo / redo -------------------------------------
  const [doc, setDoc] = useState<EditDoc>(emptyDoc);
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const undoRef = useRef<EditDoc[]>([]);
  const redoRef = useRef<EditDoc[]>([]);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });

  const checkpoint = useCallback(() => {
    undoRef.current = [...undoRef.current.slice(-39), docRef.current];
    redoRef.current = [];
    setHistoryDepth({ undo: undoRef.current.length, redo: 0 });
  }, []);

  /** Change the doc without recording history (mid-drag updates). */
  const patch = useCallback((fn: (d: EditDoc) => EditDoc) => setDoc((d) => fn(d)), []);
  /** Record history, then change the doc (discrete actions). */
  const commit = useCallback((fn: (d: EditDoc) => EditDoc) => { checkpoint(); setDoc((d) => fn(d)); }, [checkpoint]);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current = [...redoRef.current.slice(-39), docRef.current];
    setDoc(prev);
    setHistoryDepth({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);
  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current = [...undoRef.current.slice(-39), docRef.current];
    setDoc(next);
    setHistoryDepth({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);

  // ---- playback ------------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  const [isPlaying, setIsPlaying] = useState(false);
  const playingRef = useRef(false);
  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);
  const [volume, setVolume] = useState(1);
  const [playWithEffects, setPlayWithEffects] = useState(true);
  const [previewFit, setPreviewFit] = useState<'fit' | 'fill'>('fit');
  const pendingSeek = useRef<number | null>(null);
  const mainAudioContextRef = useRef<AudioContext | null>(null);
  const mainGainRef = useRef<GainNode | null>(null);
  const mainSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const lastDuckRef = useRef({ id: '', target: 1 });

  // ---- selection -----------------------------------------------------------
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const selectedClipRef = useRef<string[]>([]);
  useEffect(() => { selectedClipRef.current = selectedClipIds; }, [selectedClipIds]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [showFocus, setShowFocus] = useState(false);

  // ---- analysis + plan -----------------------------------------------------
  const sourceFiles = useRef<Map<string, File>>(new Map());
  const audioRefData = useRef<AudioAnalysis | null>(null);
  const motionRef = useRef<{ t: number; score: number }[]>([]);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState('');
  const [planError, setPlanError] = useState('');
  const [planSummary, setPlanSummary] = useState('');
  const [hookVerdict, setHookVerdict] = useState('');
  const [retention, setRetention] = useState<{ start: number; end: number; retention: number; why: string }[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptNote, setTranscriptNote] = useState('');
  const [exactTimings, setExactTimings] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackProgress, setTrackProgress] = useState(0);
  const [brief, setBrief] = useState('');

  // ---- chat ----------------------------------------------------------------
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);

  // ---- intake / errors -----------------------------------------------------
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [thumbUrl, setThumbUrl] = useState('');
  const [generatingSlot, setGeneratingSlot] = useState('');
  const [libraryFor, setLibraryFor] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ id: string; url: string; prompt: string; provider: string }[]>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [runwayOpen, setRunwayOpen] = useState(false);
  const [subjectBusyId, setSubjectBusyId] = useState('');
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicNote, setMusicNote] = useState('');
  const [musicError, setMusicError] = useState('');
  const removedClipTimer = useRef<number | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // ---- the guided layer ----------------------------------------------------
  const isMobile = useIsMobile();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const [step, setStep] = useState<StepId>('trim');
  const [presetId, setPresetId] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!sheetOpen) return;
    const drawer = drawerRef.current;
    const opener = toolsButtonRef.current;
    const frame = window.requestAnimationFrame(() => drawer?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSheetOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) { event.preventDefault(); drawer.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === drawer)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      window.requestAnimationFrame(() => opener?.focus());
    };
  }, [sheetOpen]);

  // ---- effects sidebar -----------------------------------------------------
  const [fxTab, setFxTab] = useState<EffectsTabId>('overlays');
  const [selectedBrollId, setSelectedBrollId] = useState<string | null>(null);
  const [uploadingBroll, setUploadingBroll] = useState(false);
  const [brollModel, setBrollModel] = useState<string>(VEO_31_FAST_MODEL);
  const [omniPrompt, setOmniPrompt] = useState('');
  const [omniGenerating, setOmniGenerating] = useState(false);
  const [omniProgress, setOmniProgress] = useState(0);
  const [omniError, setOmniError] = useState('');
  const [omniNote, setOmniNote] = useState('');
  const [aiImageOpen, setAiImageOpen] = useState(false);
  const [aiImagePrompt, setAiImagePrompt] = useState('');
  const [aiImageModel, setAiImageModel] = useState<'gemini-3.1-flash-image' | 'dall-e-3'>('gemini-3.1-flash-image');
  const [aiImageAt, setAiImageAt] = useState(0);
  const [aiImageBusy, setAiImageBusy] = useState(false);
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const [captionNote, setCaptionNote] = useState('');
  const captionRowRef = useRef<number | null>(null);

  // ---- export --------------------------------------------------------------
  const [exportAspects, setExportAspects] = useState<AspectId[]>(['16:9']);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  useEffect(() => { exportingRef.current = exporting; }, [exporting]);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState('');
  const [exportEta, setExportEta] = useState(0);
  const [exportError, setExportError] = useState('');
  const [exportWarning, setExportWarning] = useState('');
  const [exportResults, setExportResults] = useState<{ aspect: AspectId; url: string; geometry: string }[]>([]);
  const resultsRef = useRef<{ aspect: AspectId; url: string; geometry: string }[]>([]);
  useEffect(() => { resultsRef.current = exportResults; }, [exportResults]);

  // ---- autosave ------------------------------------------------------------
  const projectIdRef = useRef<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'retrying' | 'failed'>('idle');
  const [savedAt, setSavedAt] = useState(0);

  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
    if (removedClipTimer.current != null) window.clearTimeout(removedClipTimer.current);
  }, []);

  // ---- the pro shell -------------------------------------------------------
  const [proTab, setProTab] = useState<ProTabId>('effects');
  const [agentOpen, setAgentOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [tlCollapsed, setTlCollapsed] = useState(false);
  const [tlZoom, setTlZoom] = useState(1);
  // Timeline height in px; 0 means "auto" (the natural height of the tracks).
  const [timelineHeight, setTimelineHeight] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 0;
      const saved = Number(window.localStorage.getItem('ve:timelineHeight'));
      if (!Number.isFinite(saved) || saved <= 0) return 0;
      return Math.round(Math.min(Math.max(saved, 80), window.innerHeight * 0.5));
    } catch { return 0; }
  });
  const onTimelineResize = useCallback((height: number, persist: boolean) => {
    const next = height > 0 ? Math.round(height) : 0;
    setTimelineHeight(next);
    if (!persist) return;
    try {
      if (next > 0) window.localStorage.setItem('ve:timelineHeight', String(next));
      else window.localStorage.removeItem('ve:timelineHeight');
    } catch { /* storage unavailable — the height still applies for this session */ }
  }, []);
  const [activeLook, setActiveLook] = useState('');
  const [lookStrength, setLookStrength] = useState(1);
  const [activeMotion, setActiveMotion] = useState<MotionKind | ''>('');
  const [motionAmount, setMotionAmount] = useState(0.6);
  const [compareAB, setCompareAB] = useState(false);
  const [voBusy, setVoBusy] = useState(false);
  const [voNote, setVoNote] = useState('');
  const [bpm, setBpm] = useState(0);
  const [agentJobs, setAgentJobs] = useState<AgentJobs>(emptyJobs);
  const [agentRunning, setAgentRunning] = useState<AgentActionId | ''>('');
  const [customPresets, setCustomPresets] = useState<EditPreset[]>([]);
  const [exportSpec, setExportSpec] = useState<ExportSpec>({
    format: 'mp4', resolution: '1080p', aspects: ['16:9'], fps: 30, bitrate: 'auto',
  });
  const [clientResults, setClientResults] = useState<ExportResult[]>([]);

  // Saved looks live on the device, not the server: they are a personal
  // shortcut, not project data that has to survive a machine change.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('vidverge_pro_presets');
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) setCustomPresets(list.slice(0, 12) as EditPreset[]);
    } catch { /* storage unavailable — the built-in presets still work */ }
  }, []);

  // ---- derived -------------------------------------------------------------
  const clips = doc.clips;
  const duration = Math.max(0.1, timelineDuration(clips));
  const hasFootage = clips.length > 0;
  const activeClip = clips[Math.min(activeIndex, Math.max(0, clips.length - 1))] || null;
  const selectedClips = clips.filter((c) => selectedClipIds.includes(c.id));
  const located = useMemo(() => locate(clips, playhead), [clips, playhead]);
  const sourceT = located ? located.sourceT : 0;
  const clipLocalT = located ? playhead - located.start : 0;
  const canSplit = (() => {
    if (!located) return false;
    const c = clips[located.index];
    return !!c && located.sourceT - c.in > 0.2 && c.out - located.sourceT > 0.2;
  })();
  const busy = planning || transcribing || detecting || exporting || uploading || omniGenerating || musicBusy || Boolean(subjectBusyId) || Boolean(trackingId) || Boolean(generatingSlot);
  const subjectProfile: SubjectProfile | null = clips.find((c) => c.subject)?.subject || null;
  const rankedLibrary = useMemo(() => rankBrollSuggestions(library, subjectProfile), [library, subjectProfile]);
  const stageDoc = useMemo<EditDoc>(() => {
    if (playWithEffects) return doc;
    return {
      ...doc,
      captions: [], textLayers: [], overlays: [], videoOverlays: [], globalEffects: [],
      vfx: defaultVfx(), chroma: defaultChroma(),
      clips: doc.clips.map((clip) => ({ ...clip, effects: [] })),
    };
  }, [doc, playWithEffects]);

  const planContext = useCallback((): PlanContext => {
    const d = docRef.current;
    const audio = audioRefData.current;
    const dur = audio?.duration || Math.max(1, timelineDuration(d.clips));
    const motion = motionRef.current;
    return {
      durationS: dur,
      words: d.words,
      transcript: d.transcript,
      silences: audio?.silences || [],
      motion,
      lowAction: lowActionRegions(motion, dur),
      brief,
    };
  }, [brief]);

  // =========================================================================
  // Footage intake
  // =========================================================================

  const addClip = useCallback(async (
    url: string,
    previewUrl: string,
    label: string,
    kind: StudioClip['kind'],
    atIndex?: number,
  ): Promise<StudioClip> => {
    const d = (await probeDuration(previewUrl)) || (await probeDuration(url)) || 5;
    const clip = newClip({ previewUrl, sourceDuration: d, url: url || previewUrl, label, kind });
    commit((cur) => {
      const list = cur.clips.slice();
      if (atIndex == null || atIndex >= list.length) list.push(clip);
      else list.splice(Math.max(0, atIndex), 0, clip);
      return { ...cur, clips: list, title: cur.clips.length ? cur.title : label };
    });
    setSelectedClipIds([clip.id]);
    return clip;
  }, [commit]);

  const fileForClip = useCallback(async (clip: StudioClip): Promise<File> => {
    const cached = sourceFiles.current.get(clip.id);
    if (cached) return cached;
    const f = await fetchVideoAsFile(clip.previewUrl || clip.url);
    sourceFiles.current.set(clip.id, f);
    return f;
  }, []);

  const makeMusic = useCallback(async (profile: SubjectProfile | null, style: MusicStyleId, variation: number) => {
    if (style === 'none') {
      patch((cur) => ({ ...cur, musicStyle: 'none', musicUrl: '', musicPrompt: '', musicVariation: variation }));
      return;
    }
    setMusicBusy(true);
    setMusicError('');
    setMusicNote('Composing a subject-matched soundtrack…');
    try {
      const out = await generateBackgroundMusic({
        profile,
        style,
        lengthSeconds: Math.max(3, timelineDuration(docRef.current.clips)),
        variation,
      });
      if (!aliveRef.current) return;
      patch((cur) => ({
        ...cur,
        musicStyle: style,
        musicUrl: out.url,
        musicBedId: 'none',
        musicPrompt: out.prompt,
        musicVariation: variation,
      }));
      setMusicNote(`Music ready · ${out.provider}`);
    } catch (e) {
      if (aliveRef.current) { setMusicError(msg(e)); setMusicNote(''); }
    } finally {
      if (aliveRef.current) setMusicBusy(false);
    }
  }, [patch]);

  const runSubjectAnalysis = useCallback(async (clipId: string, url: string, sourceDuration: number) => {
    setSubjectBusyId(clipId);
    try {
      const profile = await detectSubjectProfile(url, sourceDuration);
      if (!aliveRef.current) return;
      patch((cur) => ({
        ...cur,
        clips: cur.clips.map((clip) => (clip.id === clipId ? { ...clip, subject: profile } : clip)),
        brollSlots: cur.brollSlots.map((slot) => ({
          ...slot,
          prompt: `${slot.prompt} Match the detected ${profile.subjectType}; background: ${profile.backgroundDescription}; dominant color: ${profile.dominantColor}; ${profile.mood} mood.`,
        })),
      }));
      setOmniPrompt((current) => current || `${profile.subjectType} in ${profile.backgroundDescription}`);
      const current = docRef.current;
      if (!current.musicUrl && current.musicStyle === 'auto') void makeMusic(profile, 'auto', 1);
    } catch (e) {
      if (aliveRef.current) setError(`Subject detection could not finish: ${msg(e)}`);
    } finally {
      if (aliveRef.current) setSubjectBusyId('');
    }
  }, [makeMusic, patch]);

  /**
   * The upload pipeline: measure the audio, read the picture, transcribe, then
   * plan. Measurement and vision run together because neither needs the other,
   * which is what keeps the whole thing inside the two-minute budget.
   */
  const runPipeline = useCallback(async (clip: StudioClip, file: File) => {
    setPlanning(true);
    setPlanError('');
    setError('');
    const src = clip.previewUrl;

    try {
      setPlanNote('Measuring the audio and reading the picture…');
      const [audio, vision] = await Promise.all([
        analyseAudio(file).catch(() => null),
        detectSubjectTrack(src, clip.sourceDuration, (p, n) => {
          if (aliveRef.current) setPlanNote(`${n} ${Math.round(p * 100)}%`);
        }).catch(() => null),
      ]);
      if (!aliveRef.current) return;
      audioRefData.current = audio;
      motionRef.current = vision?.motion || [];
      setAnalysisReady(true);
      if (vision) {
        patch((cur) => ({
          ...cur,
          reframe: { ...cur.reframe, focus: vision.focus, detector: vision.detector, status: 'ready', note: vision.note },
        }));
      }

      setPlanNote('Transcribing with word-level timing…');
      setTranscribing(true);
      let words: WordToken[] = [];
      let transcript = '';
      try {
        const t = await transcribeForStudio(file, audio, (n) => { if (aliveRef.current) setPlanNote(n); });
        words = t.words;
        transcript = t.transcript;
        setExactTimings(t.exactTimings);
        setTranscriptNote(t.note);
      } catch (e) {
        setTranscriptNote(`Transcription failed: ${msg(e)} — the measured cuts and reframe still work.`);
      } finally {
        setTranscribing(false);
      }
      if (!aliveRef.current) return;
      patch((cur) => ({ ...cur, words, transcript, transcriptSource: src }));

      // B-roll slots: real silence, long pauses between words, static picture.
      const dur = audio?.duration || clip.sourceDuration;
      const motionGaps = lowActionRegions(motionRef.current, dur);
      const slots: BrollSlot[] = [];
      (audio?.silences || []).filter((s) => s.end - s.start >= 1.2).slice(0, 6).forEach((s) => {
        slots.push({
          id: newId('slot'), start: s.start, end: s.end, cause: 'silence',
          reason: `${(s.end - s.start).toFixed(1)}s of silence — a cutaway covers it without a jump cut.`,
          prompt: brollPromptFromContext(words, s.start, s.end),
          status: 'open', clipUrl: '', error: '',
        });
      });
      motionGaps.slice(0, 6).forEach((g) => {
        if (slots.some((s) => Math.abs(s.start - g.start) < 2)) return;
        slots.push({
          id: newId('slot'), start: g.start, end: g.end, cause: 'lowAction',
          reason: `${(g.end - g.start).toFixed(1)}s of near-static picture — visual variety holds attention here.`,
          prompt: brollPromptFromContext(words, g.start, g.end),
          status: 'open', clipUrl: '', error: '',
        });
      });
      patch((cur) => ({ ...cur, brollSlots: slots.sort((a, b) => a.start - b.start) }));

      setPlanNote('Writing the cut plan…');
      const ctx: PlanContext = {
        durationS: dur,
        words,
        transcript,
        silences: audio?.silences || [],
        motion: motionRef.current,
        lowAction: motionGaps,
        brief,
      };
      const plan = await buildCutPlan(ctx, (n) => { if (aliveRef.current) setPlanNote(n); });
      if (!aliveRef.current) return;
      setPlanSummary(plan.summary);
      setHookVerdict(plan.hookVerdict);
      setPlanError(plan.modelError);
      setRetention(plan.segments);
      patch((cur) => ({ ...cur, cards: plan.cards }));

      // Thumbnails last — the cards are already usable without them.
      setPlanNote('');
      const thumbs = await Promise.all(
        plan.cards.slice(0, 10).map(async (c) => ({ id: c.id, url: await captureThumb(src, c.start, 150).catch(() => '') })),
      );
      if (!aliveRef.current) return;
      const byId = new Map(thumbs.map((t) => [t.id, t.url]));
      patch((cur) => ({ ...cur, cards: cur.cards.map((c) => (byId.get(c.id) ? { ...c, thumbnail: byId.get(c.id) as string } : c)) }));
    } catch (e) {
      if (aliveRef.current) setError(msg(e));
    } finally {
      if (aliveRef.current) { setPlanning(false); setPlanNote(''); }
    }
  }, [brief, patch]);

  const handleFile = useCallback(async (file: File | null, analyse = true) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) { setError('That file is not a video — try an MP4, MOV or WebM.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError('That video is bigger than 500 MB. Try a shorter clip.'); return; }
    setError('');
    const localUrl = URL.createObjectURL(file);
    const clip = await addClip('', localUrl, file.name, 'raw');
    sourceFiles.current.set(clip.id, file);

    setUploading(true);
    setNote('Uploading a durable copy for the export…');
    void (async () => {
      try {
        const up = await uploadVideo(file);
        if (!aliveRef.current) return;
        patch((cur) => ({ ...cur, clips: cur.clips.map((c) => (c.id === clip.id ? { ...c, url: up.url } : c)) }));
        setNote('');
        void runSubjectAnalysis(clip.id, up.url, clip.sourceDuration);
      } catch (e) {
        if (aliveRef.current) {
          console.error('[VideoStudio] upload failed', e);
          setNote('');
          setError('Something went wrong saving your video. Editing still works — try uploading again before you export.');
        }
      } finally {
        if (aliveRef.current) setUploading(false);
      }
    })();

    void captureThumb(localUrl, 1, 320).then((t) => { if (aliveRef.current && analyse) setThumbUrl(t); });
    if (analyse) void runPipeline(clip, file);
  }, [addClip, patch, runPipeline, runSubjectAnalysis]);

  const handleFiles = useCallback(async (files: File[]) => {
    const videos = files.filter((file) => file.type.startsWith('video/'));
    if (files.length && !videos.length) {
      setError('Choose one or more MP4, MOV or WebM video files.');
      return;
    }
    const analyseFirst = docRef.current.clips.length === 0;
    for (let index = 0; index < videos.length; index += 1) {
      await handleFile(videos[index], analyseFirst && index === 0);
    }
  }, [handleFile]);

  const replan = useCallback(async () => {
    const first = docRef.current.clips[0];
    if (!first || planning) return;
    try {
      const file = await fileForClip(first);
      await runPipeline(first, file);
    } catch (e) {
      setError(msg(e));
    }
  }, [fileForClip, planning, runPipeline]);

  const runTranscribe = useCallback(async () => {
    const first = docRef.current.clips[0];
    if (!first || transcribing) return;
    setTranscribing(true);
    setError('');
    try {
      const file = await fileForClip(first);
      if (!audioRefData.current) audioRefData.current = await analyseAudio(file).catch(() => null);
      const t = await transcribeForStudio(file, audioRefData.current, (n) => setTranscriptNote(n));
      if (!aliveRef.current) return;
      setExactTimings(t.exactTimings);
      setTranscriptNote(t.note);
      commit((cur) => ({ ...cur, words: t.words, transcript: t.transcript, transcriptSource: first.previewUrl }));
    } catch (e) {
      setError(msg(e));
    } finally {
      if (aliveRef.current) setTranscribing(false);
    }
  }, [commit, fileForClip, transcribing]);

  // =========================================================================
  // Playback engine — one <video> walks the clip sequence
  // =========================================================================

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip) return;
    const src = activeClip.previewUrl || activeClip.url;
    const seekTo = pendingSeek.current != null ? pendingSeek.current : activeClip.in;
    pendingSeek.current = null;
    const apply = () => {
      try { v.currentTime = clampN(seekTo, activeClip.in, activeClip.out); } catch { /* not seekable yet */ }
      v.playbackRate = clampN(activeClip.adjust.speed, 0.25, 4);
      v.muted = activeClip.muted;
      if (playingRef.current) void v.play().catch(() => setIsPlaying(false));
    };
    if (v.getAttribute('data-src') !== src) {
      v.setAttribute('data-src', src);
      v.src = src;
      v.addEventListener('loadedmetadata', apply, { once: true });
      v.load();
    } else {
      apply();
    }
    // Deliberately NOT keyed on in/out: a trim-handle drag changes those every
    // frame, and re-seeking on each change would fight the drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip?.id, activeClip?.previewUrl, activeClip?.adjust.speed, activeClip?.muted]);

  const ensureMainAudioGraph = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    if (mainGainRef.current) return mainGainRef.current;
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      const context = new AudioContextCtor();
      const source = context.createMediaElementSource(video);
      const gain = context.createGain();
      source.connect(gain);
      gain.connect(context.destination);
      mainAudioContextRef.current = context;
      mainSourceRef.current = source;
      mainGainRef.current = gain;
      video.volume = 1;
      return gain;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const active = playWithEffects
      ? doc.videoOverlays.find((o) => !o.muted && o.duckMain && playhead >= o.start && playhead < o.end) || null
      : null;
    const target = Math.max(0, Math.min(1, volume * (active ? active.duckVolume : 1)));
    const gain = mainGainRef.current;
    const context = mainAudioContextRef.current;
    const changed = lastDuckRef.current.id !== (active?.id || '') || Math.abs(lastDuckRef.current.target - target) > 0.01;
    if (gain && context && changed) {
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(target, now + (active ? 0.3 : 0.5));
      lastDuckRef.current = { id: active?.id || '', target };
    } else if (!gain && videoRef.current) {
      videoRef.current.volume = target;
    }
  }, [doc.videoOverlays, playWithEffects, playhead, volume]);

  useEffect(() => () => {
    try { void mainAudioContextRef.current?.close(); } catch { /* already closed */ }
  }, []);

  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    lastTickRef.current = null;
    const step = (now: number) => {
      const v = videoRef.current;
      const list = docRef.current.clips;
      const i = activeIndexRef.current;
      const c = list[i];
      const prevTick = lastTickRef.current;
      lastTickRef.current = now;
      if (v && c) {
        const start = clipStart(list, i);
        const total = timelineDuration(list);
        const ramp = clipMotion(c).ramp;
        let reachedEnd = false;

        if (ramp.enabled) {
          // A ramped clip is driven FROM the timeline rather than read from
          // the video element: the playhead advances on the wall clock, and
          // the source time it should be showing is the warp of that
          // progress. Reading currentTime back would drift, because the
          // playback rate is different on every frame.
          const len = Math.max(0.05, clipLength(c));
          const dt = prevTick == null ? 0 : Math.min(0.25, (now - prevTick) / 1000);
          const nextT = Math.min(start + len, playheadRef.current + dt);
          const p = clampN((nextT - start) / len, 0, 1);
          const want = c.in + warp(ramp, p) * (c.out - c.in);
          v.playbackRate = clampN(warpRate(ramp, p) * c.adjust.speed, 0.1, 4);
          if (Math.abs(v.currentTime - want) > 0.12) {
            try { v.currentTime = want; } catch { /* not seekable yet */ }
          }
          setPlayhead(Math.min(nextT, total));
          reachedEnd = nextT >= start + len - 0.02 || v.ended;
        } else {
          const t = start + Math.max(0, v.currentTime - c.in) / Math.max(0.25, c.adjust.speed);
          setPlayhead(Math.min(t, total));
          reachedEnd = v.currentTime >= c.out - 0.04 || v.ended;
        }

        if (reachedEnd) {
          if (i < list.length - 1) {
            pendingSeek.current = list[i + 1].in;
            setActiveIndex(i + 1);
          } else {
            v.pause();
            setIsPlaying(false);
            setPlayhead(total);
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // Music bed preview follows play / pause.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const bed = doc.musicUrl
      ? { url: doc.musicUrl }
      : MUSIC_BEDS.find((m) => m.id === doc.musicBedId) || null;
    if (!bed) { a.pause(); a.removeAttribute('src'); return; }
    if (a.getAttribute('data-src') !== bed.url) { a.setAttribute('data-src', bed.url); a.src = bed.url; a.loop = true; }
    a.volume = doc.musicVolume * volume;
    if (isPlaying) {
      try { a.currentTime = playheadRef.current % Math.max(1, a.duration || 60); } catch { /* not ready */ }
      void a.play().catch(() => undefined);
    } else {
      a.pause();
    }
  }, [doc.musicBedId, doc.musicUrl, doc.musicVolume, isPlaying, volume]);

  const seek = useCallback((t: number) => {
    const list = docRef.current.clips;
    if (!list.length) return;
    const clamped = clampN(t, 0, timelineDuration(list));
    const loc = locate(list, clamped);
    if (!loc) return;
    setPlayhead(clamped);
    pendingSeek.current = loc.sourceT;
    if (loc.index !== activeIndexRef.current) {
      setActiveIndex(loc.index);
    } else {
      const v = videoRef.current;
      if (v) { try { v.currentTime = loc.sourceT; } catch { /* not seekable */ } }
      pendingSeek.current = null;
    }
  }, []);

  /** Seek by SOURCE time of the transcript's clip — what a word click does. */
  const seekSource = useCallback((srcT: number) => {
    const d = docRef.current;
    const t = sourceToTimeline(d.clips, d.transcriptSource, srcT);
    if (t != null) seek(t);
  }, [seek]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !docRef.current.clips.length) return;
    if (playingRef.current) { v.pause(); setIsPlaying(false); return; }
    if (playheadRef.current >= timelineDuration(docRef.current.clips) - 0.05) seek(0);
    const gain = ensureMainAudioGraph();
    if (gain && mainAudioContextRef.current?.state === 'suspended') void mainAudioContextRef.current.resume();
    setIsPlaying(true);
    void v.play().catch(() => setIsPlaying(false));
  }, [ensureMainAudioGraph, seek]);

  // =========================================================================
  // Timeline edits
  // =========================================================================

  const onReorder = useCallback((from: number, to: number) => {
    commit((cur) => {
      const list = cur.clips.slice();
      const [moved] = list.splice(from, 1);
      list.splice(clampN(to, 0, list.length), 0, moved);
      return { ...cur, clips: list };
    });
  }, [commit]);

  const onTrim = useCallback((id: string, nextIn: number, nextOut: number) => {
    patch((cur) => ({ ...cur, clips: cur.clips.map((c) => (c.id === id ? { ...c, in: nextIn, out: nextOut, kind: c.kind === 'raw' ? 'cut' : c.kind } : c)) }));
  }, [patch]);

  const onSplit = useCallback(() => {
    const d = docRef.current;
    const loc = locate(d.clips, playheadRef.current);
    if (!loc) return;
    const clip = d.clips[loc.index];
    const next = splitClipAt(d.clips, clip.id, loc.sourceT);
    if (next === d.clips) return;
    // The split halves share the original's decoded file, so analysis and
    // transcription keep working on both without re-fetching.
    const file = sourceFiles.current.get(clip.id);
    if (file) next.forEach((c) => { if (c.previewUrl === clip.previewUrl && !sourceFiles.current.has(c.id)) sourceFiles.current.set(c.id, file); });
    commit((cur) => ({ ...cur, clips: next }));
    setSelectedClipIds([]);
  }, [commit]);

  const onDeleteSelected = useCallback(() => {
    const ids = selectedClipRef.current;
    if (ids.length) {
      commit((cur) => {
        const urls = new Set(cur.clips.filter((c) => ids.includes(c.id)).flatMap((c) => [c.url, c.previewUrl]).filter(Boolean));
        return {
          ...cur,
          clips: cur.clips.filter((c) => !ids.includes(c.id)),
          brollSlots: cur.brollSlots.filter((s) => !s.clipUrl || !urls.has(s.clipUrl)),
        };
      });
      ids.forEach((id) => sourceFiles.current.delete(id));
      setSelectedClipIds([]);
      return;
    }
    if (selectedTextId) {
      commit((cur) => ({ ...cur, textLayers: cur.textLayers.filter((l) => l.id !== selectedTextId) }));
      setSelectedTextId(null);
      return;
    }
    if (selectedOverlayId) {
      commit((cur) => ({ ...cur, overlays: cur.overlays.filter((o) => o.id !== selectedOverlayId) }));
      setSelectedOverlayId(null);
      return;
    }
    if (selectedBrollId) {
      commit((cur) => ({ ...cur, videoOverlays: cur.videoOverlays.filter((o) => o.id !== selectedBrollId) }));
      setSelectedBrollId(null);
    }
  }, [commit, selectedBrollId, selectedOverlayId, selectedTextId]);

  /**
   * Removing a clip is reversible for five seconds. The restore closure holds
   * the clip and its index directly instead of reading them back out of
   * state, so the Undo on a toast always puts back the clip THAT toast is
   * about, even if another clip is deleted before it expires.
   */
  const deleteClip = useCallback((id: string) => {
    const current = docRef.current;
    const index = current.clips.findIndex((clip) => clip.id === id);
    const clip = current.clips[index];
    if (!clip) return;
    if (removedClipTimer.current != null) window.clearTimeout(removedClipTimer.current);
    removedClipTimer.current = window.setTimeout(() => {
      sourceFiles.current.delete(id);
      removedClipTimer.current = null;
    }, 5000);
    commit((cur) => {
      const urls = new Set([clip.url, clip.previewUrl].filter(Boolean));
      return {
        ...cur,
        clips: cur.clips.filter((c) => c.id !== id),
        brollSlots: cur.brollSlots.filter((s) => !s.clipUrl || !urls.has(s.clipUrl)),
      };
    });
    setSelectedClipIds((ids) => ids.filter((x) => x !== id));
    pushToast({
      message: 'Clip removed',
      actionLabel: 'Undo',
      ttlMs: 5000,
      onAction: () => {
        if (removedClipTimer.current != null) {
          window.clearTimeout(removedClipTimer.current);
          removedClipTimer.current = null;
        }
        commit((cur) => {
          if (cur.clips.some((c) => c.id === clip.id)) return cur;
          const clips = cur.clips.slice();
          clips.splice(Math.min(index, clips.length), 0, clip);
          return { ...cur, clips };
        });
        setSelectedClipIds([clip.id]);
      },
    });
  }, [commit, pushToast]);

  const clearAllClips = useCallback(() => {
    commit((cur) => ({ ...cur, clips: [], brollSlots: [], videoOverlays: [] }));
    sourceFiles.current.clear();
    setSelectedClipIds([]);
    setActiveIndex(0);
    setPlayhead(0);
    setConfirmClearAll(false);
    pushToast({ message: 'All clips cleared. Press Cmd+Z to bring them back.' });
  }, [commit, pushToast]);

  const applyToSelected = useCallback((fn: (c: StudioClip) => StudioClip) => {
    const ids = selectedClipRef.current;
    patch((cur) => ({ ...cur, clips: cur.clips.map((c) => (ids.includes(c.id) ? fn(c) : c)) }));
  }, [patch]);

  const onAdjust = useCallback((p: Partial<Adjust>) => {
    applyToSelected((c) => ({ ...c, adjust: { ...c.adjust, ...p } }));
  }, [applyToSelected]);

  const onCrop = useCallback((p: Partial<CropRect>) => {
    applyToSelected((c) => {
      let crop = { ...c.crop, ...p };
      if (c.cropLocked && p.w != null) {
        const ratio = c.crop.h / Math.max(0.05, c.crop.w);
        crop = { ...crop, h: clampN(crop.w * ratio, 0.1, 1) };
      }
      crop.x = clampN(crop.x, 0, Math.max(0, 1 - crop.w));
      crop.y = clampN(crop.y, 0, Math.max(0, 1 - crop.h));
      return { ...c, crop };
    });
  }, [applyToSelected]);

  const sourceAspect = useMemo(() => {
    const v = videoRef.current;
    if (v && v.videoWidth && v.videoHeight) return v.videoWidth / v.videoHeight;
    return 16 / 9;
  }, [activeClip?.id, playhead]);

  const onCropPreset = useCallback((id: AspectId | 'free') => {
    applyToSelected((c) => ({ ...c, cropAspect: id, crop: cropForAspect(id, c.crop, sourceAspect) }));
  }, [applyToSelected, sourceAspect]);

  const onToggleClipEffect = useCallback((id: VisualEffectId) => {
    applyToSelected((c) => ({
      ...c,
      effects: c.effects.includes(id) ? c.effects.filter((x) => x !== id) : [...c.effects, id],
    }));
  }, [applyToSelected]);

  const onSetTransition = useCallback((clipId: string, id: TransitionId | null) => {
    commit((cur) => ({
      ...cur,
      clips: cur.clips.map((c) => (c.id === clipId
        ? { ...c, transitionIn: id ? { id, duration: TRANSITIONS.find((t) => t.id === id)?.defaultDuration || 0.5 } : null }
        : c)),
    }));
  }, [commit]);

  // =========================================================================
  // Transcript editing — text deletions become timeline cuts
  // =========================================================================

  const rebuildCaptions = useCallback((d: EditDoc): EditDoc => {
    if (!d.words.length || !d.captions.length) return d;
    return { ...d, captions: captionsFromWords(d.clips, d.transcriptSource, d.words, captionMaxWords(d.captionSettings)) };
  }, []);

  const onRemoveWords = useCallback((ids: string[]) => {
    if (!ids.length) return;
    commit((cur) => {
      const target = cur.words.filter((w) => ids.includes(w.id) && !w.removed);
      if (!target.length) return cur;
      const ranges = mergeRanges(target.map((w) => ({ start: Math.max(0, w.start - 0.04), end: w.end + 0.04 })));
      const words = removeWords(cur.words, ids);
      const next = { ...cur, words, clips: cutSourceRanges(cur.clips, cur.transcriptSource, ranges) };
      return rebuildCaptions(next);
    });
  }, [commit, rebuildCaptions]);

  const onRestoreWords = useCallback((ids: string[]) => {
    if (!ids.length) return;
    commit((cur) => {
      const target = cur.words.filter((w) => ids.includes(w.id) && w.removed);
      if (!target.length) return cur;
      const ranges = mergeRanges(target.map((w) => ({ start: Math.max(0, w.start - 0.04), end: w.end + 0.04 })));
      const words = restoreWords(cur.words, ids);
      const next = { ...cur, words, clips: restoreSourceRanges(cur.clips, cur.transcriptSource, ranges) };
      return rebuildCaptions(next);
    });
  }, [commit, rebuildCaptions]);

  const onRemoveAllFillers = useCallback(() => {
    onRemoveWords(fillerIds(docRef.current.words));
  }, [onRemoveWords]);

  const buildCaptionTrack = useCallback(() => {
    commit((cur) => ({ ...cur, captions: captionsFromWords(cur.clips, cur.transcriptSource, cur.words, captionMaxWords(cur.captionSettings)) }));
  }, [commit]);

  const downloadSrt = useCallback(() => {
    const d = docRef.current;
    if (!d.captions.length) return;
    downloadText(`${(d.title || 'captions').replace(/[^\w.-]+/g, '-').slice(0, 48)}.srt`, buildSrt(d.captions));
  }, []);

  // =========================================================================
  // Cut-plan cards
  // =========================================================================

  const generateForSlot = useCallback(async (slotId: string) => {
    const d = docRef.current;
    const slot = d.brollSlots.find((s) => s.id === slotId);
    if (!slot || slot.status === 'generating') return;
    patch((cur) => ({ ...cur, brollSlots: cur.brollSlots.map((s) => (s.id === slotId ? { ...s, status: 'generating', error: '' } : s)) }));
    setGeneratingSlot(slotId);
    try {
      const profile = d.clips.find((clip) => clip.subject)?.subject || null;
      const matchedPrompt = profile
        ? `${slot.prompt} Prioritize a visual match for ${profile.subjectType}; ${profile.backgroundDescription}; dominant color ${profile.dominantColor}; ${profile.mood} mood.`
        : slot.prompt;
      const shot = await filmBroll(matchedPrompt, slot.end - slot.start, d.aspect, brollModel, () => aliveRef.current);
      if (!aliveRef.current) return;
      if (!shot.url) {
        patch((cur) => ({ ...cur, brollSlots: cur.brollSlots.map((s) => (s.id === slotId ? { ...s, status: 'failed', error: shot.error } : s)) }));
        return;
      }
      // The user may delete a slot while generation is in flight. In that
      // case the completed result is intentionally ignored instead of being
      // resurrected onto the timeline.
      if (!docRef.current.brollSlots.some((s) => s.id === slotId)) return;
      const at = locate(docRef.current.clips, slot.start);
      await addClip(shot.url, shot.url, `B-roll ${fmtTimecode(slot.start)}`, 'broll', at ? at.index + 1 : undefined);
      patch((cur) => ({ ...cur, brollSlots: cur.brollSlots.map((s) => (s.id === slotId ? { ...s, status: 'filled', clipUrl: shot.url } : s)) }));
    } catch (e) {
      if (aliveRef.current) {
        patch((cur) => ({ ...cur, brollSlots: cur.brollSlots.map((s) => (s.id === slotId ? { ...s, status: 'failed', error: msg(e) } : s)) }));
      }
    } finally {
      if (aliveRef.current) setGeneratingSlot('');
    }
  }, [addClip, brollModel, patch]);

  /** Map a card's source-time span onto the current timeline. */
  const cardTimeline = useCallback((card: EditCard): { start: number; end: number } | null => {
    const d = docRef.current;
    const a = sourceToTimeline(d.clips, d.transcriptSource, card.start);
    const b = sourceToTimeline(d.clips, d.transcriptSource, card.end);
    if (a == null && b == null) return null;
    const start = a == null ? Math.max(0, (b as number) - (card.end - card.start)) : a;
    const end = b == null ? start + (card.end - card.start) : Math.max(start + 0.2, b);
    return { start, end };
  }, []);

  const applyCard = useCallback(async (card: EditCard): Promise<string> => {
    switch (card.type) {
      case 'filler': {
        const ids = Array.isArray(card.payload.wordIds) ? (card.payload.wordIds as string[]) : fillerIds(docRef.current.words);
        onRemoveWords(ids);
        return '';
      }
      case 'silence': {
        const ranges = (card.payload.ranges as { start: number; end: number }[] | undefined) || [];
        if (!ranges.length) return 'No silence ranges on this card.';
        const PAD = 0.1;
        const padded = ranges.map((r) => ({ start: r.start + PAD, end: Math.max(r.start + PAD + 0.1, r.end - PAD) }));
        commit((cur) => rebuildCaptions({ ...cur, clips: cutSourceRanges(cur.clips, cur.transcriptSource, padded) }));
        return '';
      }
      case 'trim': {
        commit((cur) => rebuildCaptions({ ...cur, clips: cutSourceRanges(cur.clips, cur.transcriptSource, [{ start: card.start, end: card.end }]) }));
        return '';
      }
      case 'caption': {
        if (!docRef.current.words.length) return 'There is no transcript to caption from yet.';
        buildCaptionTrack();
        return '';
      }
      case 'effect': {
        const id = String(card.payload.effect || 'vignette') as VisualEffectId;
        const span = cardTimeline(card);
        commit((cur) => {
          // A card that covers most of the video is a global look; a short one
          // belongs to the clips it actually overlaps.
          const total = Math.max(0.5, timelineDuration(cur.clips));
          if (!span || span.end - span.start > total * 0.7) {
            return { ...cur, globalEffects: cur.globalEffects.includes(id) ? cur.globalEffects : [...cur.globalEffects, id] };
          }
          return {
            ...cur,
            clips: cur.clips.map((c, i) => {
              const s = clipStart(cur.clips, i);
              const e = s + clipLength(c);
              const overlaps = e > span.start && s < span.end;
              return overlaps && !c.effects.includes(id) ? { ...c, effects: [...c.effects, id] } : c;
            }),
          };
        });
        return '';
      }
      case 'transition': {
        const id = String(card.payload.transition || 'crossfade') as TransitionId;
        const span = cardTimeline(card);
        const d = docRef.current;
        if (!span || d.clips.length < 2) return 'There is no cut point here to put a transition on.';
        let bestIndex = 1;
        let bestGap = Infinity;
        for (let i = 1; i < d.clips.length; i += 1) {
          const gap = Math.abs(clipStart(d.clips, i) - span.start);
          if (gap < bestGap) { bestGap = gap; bestIndex = i; }
        }
        onSetTransition(d.clips[bestIndex].id, id);
        return '';
      }
      case 'text': {
        const span = cardTimeline(card);
        if (!span) return 'That moment is no longer on the timeline.';
        const layer: TextLayer = {
          ...newTextLayer(span.start, Math.max(1.2, Math.min(4, span.end - span.start))),
          text: String(card.payload.text || card.title).slice(0, 48),
        };
        commit((cur) => ({ ...cur, textLayers: [...cur.textLayers, layer] }));
        setSelectedTextId(layer.id);
        return '';
      }
      case 'reframe': {
        commit((cur) => ({ ...cur, reframe: { ...cur.reframe, mode: 'auto' } }));
        return '';
      }
      case 'broll': {
        const span = cardTimeline(card);
        const prompt = String(card.payload.prompt || brollPromptFromContext(docRef.current.words, card.start, card.end));
        const existing = docRef.current.brollSlots.find((s) => Math.abs(s.start - (span?.start ?? card.start)) < 1.5);
        if (existing) {
          patch((cur) => ({ ...cur, brollSlots: cur.brollSlots.map((s) => (s.id === existing.id ? { ...s, prompt } : s)) }));
          await generateForSlot(existing.id);
          return '';
        }
        const slot: BrollSlot = {
          id: newId('slot'),
          start: span?.start ?? card.start,
          end: span?.end ?? card.end,
          cause: 'pause',
          reason: card.reason,
          prompt,
          status: 'open',
          clipUrl: '',
          error: '',
        };
        patch((cur) => ({ ...cur, brollSlots: [...cur.brollSlots, slot].sort((a, b) => a.start - b.start) }));
        await generateForSlot(slot.id);
        return '';
      }
      default:
        return 'That card has no apply step.';
    }
  }, [buildCaptionTrack, cardTimeline, commit, generateForSlot, onRemoveWords, onSetTransition, patch, rebuildCaptions]);

  const acceptCard = useCallback(async (id: string) => {
    const card = docRef.current.cards.find((c) => c.id === id);
    if (!card || card.status !== 'pending') return;
    patch((cur) => ({ ...cur, cards: cur.cards.map((c) => (c.id === id ? { ...c, status: 'accepted' } : c)) }));
    let failure = '';
    try {
      failure = await applyCard(card);
    } catch (e) {
      failure = msg(e);
    }
    if (!aliveRef.current) return;
    patch((cur) => ({
      ...cur,
      cards: cur.cards.map((c) => (c.id === id ? { ...c, status: failure ? 'failed' : 'applied', note: failure } : c)),
    }));
  }, [applyCard, patch]);

  const rejectCard = useCallback((id: string) => {
    patch((cur) => ({ ...cur, cards: cur.cards.map((c) => (c.id === id ? { ...c, status: 'rejected' } : c)) }));
  }, [patch]);

  /**
   * Accept everything, cuts first. Applying a trim after a caption rebuild
   * would leave the captions describing footage that is no longer there, so
   * the destructive cards go through before the additive ones.
   */
  const acceptAll = useCallback(async () => {
    const order: Record<string, number> = { filler: 0, silence: 1, trim: 2, caption: 3, reframe: 4, effect: 5, transition: 6, text: 7, broll: 8 };
    const queue = docRef.current.cards
      .filter((c) => c.status === 'pending')
      .slice()
      .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
    for (const card of queue) {
      if (!aliveRef.current) return;
      await acceptCard(card.id);
    }
  }, [acceptCard]);

  // =========================================================================
  // Chat
  // =========================================================================

  const runChatAction = useCallback(async (action: ChatAction) => {
    switch (action) {
      case 'captions': buildCaptionTrack(); return;
      case 'removeFillers': onRemoveAllFillers(); return;
      case 'removeSilences': {
        const ranges = (audioRefData.current?.silences || []).filter((s) => s.end - s.start >= 0.5);
        if (!ranges.length) return;
        commit((cur) => rebuildCaptions({
          ...cur,
          clips: cutSourceRanges(cur.clips, cur.transcriptSource, ranges.map((r) => ({ start: r.start + 0.1, end: Math.max(r.start + 0.2, r.end - 0.1) }))),
        }));
        return;
      }
      case 'reframe': commit((cur) => ({ ...cur, aspect: '9:16', reframe: { ...cur.reframe, mode: 'auto' } })); return;
      case 'punchUp': {
        onRemoveAllFillers();
        const ranges = (audioRefData.current?.silences || []).filter((s) => s.end - s.start >= 0.45);
        if (ranges.length) {
          commit((cur) => rebuildCaptions({
            ...cur,
            clips: cutSourceRanges(cur.clips, cur.transcriptSource, ranges.map((r) => ({ start: r.start + 0.08, end: Math.max(r.start + 0.18, r.end - 0.08) }))),
          }));
        }
        return;
      }
      case 'addMusic': commit((cur) => ({ ...cur, musicBedId: cur.musicBedId === 'none' ? 'energetic' : cur.musicBedId })); return;
      case 'replan': void replan(); return;
      default: return;
    }
  }, [buildCaptionTrack, commit, onRemoveAllFillers, rebuildCaptions, replan]);

  const sendChat = useCallback(async (text: string) => {
    const mine: ChatMessage = { id: newId('m'), role: 'user', content: text };
    setChat((c) => [...c, mine]);
    setChatBusy(true);
    try {
      const d = docRef.current;
      const history: ChatTurn[] = chat.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const stateLine = [
        `${d.clips.length} clips`,
        `${timelineDuration(d.clips).toFixed(1)}s`,
        `${d.captions.length} captions`,
        `${d.textLayers.length} text layers`,
        `${d.overlays.length} overlays`,
        `format ${d.aspect}`,
        `grade ${d.grade}`,
        `${d.words.filter((w) => w.removed).length} words cut from the transcript`,
      ].join(' · ');
      const out = await chatForEdits(text, planContext(), history, stateLine);
      if (!aliveRef.current) return;
      setChat((c) => [...c, { id: newId('m'), role: 'assistant', content: out.reply }]);
      if (out.cards.length) patch((cur) => ({ ...cur, cards: [...out.cards, ...cur.cards] }));
      for (const action of out.actions) await runChatAction(action);
    } catch (e) {
      if (aliveRef.current) setChat((c) => [...c, { id: newId('m'), role: 'assistant', content: `I could not reach the editing model: ${msg(e)}` }]);
    } finally {
      if (aliveRef.current) setChatBusy(false);
    }
  }, [chat, patch, planContext, runChatAction]);

  // =========================================================================
  // Reframe / overlays
  // =========================================================================

  const detectSubject = useCallback(async () => {
    const first = docRef.current.clips[0];
    if (!first || detecting) return;
    setDetecting(true);
    patch((cur) => ({ ...cur, reframe: { ...cur.reframe, status: 'detecting', note: 'Reading frames…' } }));
    try {
      const out = await detectSubjectTrack(first.previewUrl, first.sourceDuration, (p, n) => {
        if (aliveRef.current) patch((cur) => ({ ...cur, reframe: { ...cur.reframe, note: `${n} ${Math.round(p * 100)}%` } }));
      });
      if (!aliveRef.current) return;
      motionRef.current = out.motion;
      commit((cur) => ({
        ...cur,
        reframe: { ...cur.reframe, focus: out.focus, detector: out.detector, status: 'ready', note: out.note, mode: 'auto' },
      }));
    } catch (e) {
      if (aliveRef.current) patch((cur) => ({ ...cur, reframe: { ...cur.reframe, status: 'failed', note: msg(e) } }));
    } finally {
      if (aliveRef.current) setDetecting(false);
    }
  }, [commit, detecting, patch]);

  const addOverlayFromUrl = useCallback((url: string, label: string, at?: number) => {
    const durationNow = Math.max(2, timelineDuration(docRef.current.clips));
    const overlay = newOverlay(url, label, durationNow);
    if (typeof at === 'number') {
      overlay.alwaysOn = false;
      overlay.start = clampN(at, 0, Math.max(0, durationNow - 0.2));
      overlay.end = Math.min(durationNow, Math.max(overlay.start + 0.2, overlay.start + 5));
    }
    commit((cur) => ({ ...cur, overlays: [...cur.overlays, overlay] }));
    setSelectedOverlayId(overlay.id);
    // The server render cannot inspect the image file, so its natural aspect
    // is measured here and travels with the overlay into the export spec.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ratio = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      if (aliveRef.current) patch((cur) => ({ ...cur, overlays: cur.overlays.map((o) => (o.id === overlay.id ? { ...o, aspect: ratio } : o)) }));
    };
    img.src = url;
  }, [commit, patch]);

  const generateImageAt = useCallback(async (at: number) => {
    const prompt = aiImagePrompt.trim();
    if (!prompt || aiImageBusy) return;
    const model = aiImageModel;
    setAiImageBusy(true);
    setNote(`Generating with ${model === 'dall-e-3' ? 'DALL-E 3' : 'Gemini 3.1 Flash Image'}…`);
    setError('');
    try {
      const generated = await callHook('vv-image-generate', {
        prompt,
        aspect: model === 'dall-e-3' && docRef.current.aspect === '4:5' ? '9:16' : docRef.current.aspect,
        model,
        quality: 'hd',
      });
      if (!generated?.success || !generated?.imageUrl) {
        throw new Error(String(generated?.error || 'The image generator could not create this visual.'));
      }
      const durableUrl = String(generated.imageUrl);
      addOverlayFromUrl(durableUrl, `AI image · ${prompt.slice(0, 28)}`, at);
      const fallback = generated.fellBackFrom ? ` · ${generated.modelUsed || 'managed fallback'}` : '';
      setNote(`AI image ready on the overlay track${fallback}.`);
      setAiImageOpen(false);
      setAiImagePrompt('');
    } catch (e) {
      setNote('');
      setError(msg(e));
    } finally {
      if (aliveRef.current) setAiImageBusy(false);
    }
  }, [addOverlayFromUrl, aiImageBusy, aiImageModel, aiImagePrompt]);

  const addOverlayFile = useCallback(async (file: File) => {
    const local = URL.createObjectURL(file);
    addOverlayFromUrl(local, file.name.slice(0, 28));
    // The export needs a public URL, so the durable copy lands in the
    // background and replaces the local one when it arrives.
    try {
      const up = await uploadVideo(file);
      if (!aliveRef.current) return;
      patch((cur) => ({ ...cur, overlays: cur.overlays.map((o) => (o.url === local ? { ...o, url: up.url } : o)) }));
    } catch (e) {
      if (aliveRef.current) setError(`The overlay image is only local for now — the export needs a durable copy. ${msg(e)}`);
    }
  }, [addOverlayFromUrl, patch]);

  const trackOverlay = useCallback(async (id: string) => {
    const d = docRef.current;
    const overlay = d.overlays.find((o) => o.id === id);
    const loc = locate(d.clips, playheadRef.current);
    if (!overlay || !loc) return;
    const clip = d.clips[loc.index];
    setTrackingId(id);
    setTrackProgress(0);
    patch((cur) => ({ ...cur, overlays: cur.overlays.map((o) => (o.id === id ? { ...o, track: { ...o.track, status: 'tracking', note: 'Following the subject…' } } : o)) }));
    try {
      const out = await trackOverlaySubject(
        clip.previewUrl,
        loc.sourceT,
        clip.out,
        { x: overlay.x, y: overlay.y },
        (p) => { if (aliveRef.current) setTrackProgress(p); },
      );
      if (!aliveRef.current) return;
      // Tracker keys come back in source seconds; the overlay lives on the
      // timeline, so they are converted before they are stored.
      const keys = out.keys
        .map((k) => {
          const t = sourceToTimeline(docRef.current.clips, clip.previewUrl, k.t);
          return t == null ? null : { t, x: k.x, y: k.y };
        })
        .filter(Boolean) as { t: number; x: number; y: number }[];
      commit((cur) => ({
        ...cur,
        overlays: cur.overlays.map((o) => (o.id === id
          ? { ...o, track: { enabled: keys.length > 1, keys, confidence: out.confidence, status: keys.length > 1 ? 'ready' : 'failed', note: out.note } }
          : o)),
      }));
    } catch (e) {
      if (aliveRef.current) {
        patch((cur) => ({ ...cur, overlays: cur.overlays.map((o) => (o.id === id ? { ...o, track: { ...o.track, status: 'failed', note: msg(e) } } : o)) }));
      }
    } finally {
      if (aliveRef.current) { setTrackingId(null); setTrackProgress(0); }
    }
  }, [commit, patch]);

  // =========================================================================
  // Library picker (B-roll from the workspace's own clips)
  // =========================================================================

  const openLibrary = useCallback(async (slotId: string) => {
    setLibraryFor(slotId);
    if (library.length) return;
    setLibraryBusy(true);
    try {
      const out = await callHook('vv-workspace-videos', { provider: 'all', limit: 60 });
      if (!aliveRef.current) return;
      setLibrary(Array.isArray(out?.videos) ? out.videos : []);
    } catch (e) {
      if (aliveRef.current) setError(msg(e));
    } finally {
      if (aliveRef.current) setLibraryBusy(false);
    }
  }, [library.length]);

  const useLibraryClip = useCallback(async (url: string) => {
    const slotId = libraryFor;
    setLibraryFor(null);
    const d = docRef.current;
    const slot = d.brollSlots.find((s) => s.id === slotId) || null;
    const at = slot ? locate(d.clips, slot.start) : null;
    await addClip(url, url, slot ? `B-roll ${fmtTimecode(slot.start)}` : 'Library clip', 'broll', at ? at.index + 1 : undefined);
    if (slot) patch((cur) => ({ ...cur, brollSlots: cur.brollSlots.map((s) => (s.id === slot.id ? { ...s, status: 'filled', clipUrl: url } : s)) }));
  }, [addClip, libraryFor, patch]);

  const replaceSlotWithFile = useCallback(async (slotId: string, file: File) => {
    const d = docRef.current;
    const slot = d.brollSlots.find((s) => s.id === slotId);
    if (!slot) return;
    const local = URL.createObjectURL(file);
    const at = locate(d.clips, slot.start);
    const clip = await addClip('', local, file.name.slice(0, 28), 'broll', at ? at.index + 1 : undefined);
    sourceFiles.current.set(clip.id, file);
    patch((cur) => ({ ...cur, brollSlots: cur.brollSlots.map((s) => (s.id === slotId ? { ...s, status: 'filled', clipUrl: local } : s)) }));
    try {
      const up = await uploadVideo(file);
      if (!aliveRef.current) return;
      patch((cur) => ({
        ...cur,
        clips: cur.clips.map((c) => (c.id === clip.id ? { ...c, url: up.url } : c)),
        brollSlots: cur.brollSlots.map((s) => (s.id === slotId ? { ...s, clipUrl: up.url } : s)),
      }));
    } catch (e) {
      if (aliveRef.current) setError(`That cutaway is only local for now — the export needs a durable copy. ${msg(e)}`);
    }
  }, [addClip, patch]);

  const removeBrollSlot = useCallback((slotId: string) => {
    const current = docRef.current;
    const slot = current.brollSlots.find((s) => s.id === slotId);
    const clipUrl = slot?.clipUrl || '';
    const removedIds = current.clips
      .filter((c) => clipUrl && (c.url === clipUrl || c.previewUrl === clipUrl))
      .map((c) => c.id);
    removedIds.forEach((id) => sourceFiles.current.delete(id));
    if (removedIds.length) setSelectedClipIds((ids) => ids.filter((id) => !removedIds.includes(id)));
    commit((cur) => ({
      ...cur,
      brollSlots: cur.brollSlots.filter((s) => s.id !== slotId),
      clips: clipUrl ? cur.clips.filter((c) => c.url !== clipUrl && c.previewUrl !== clipUrl) : cur.clips,
    }));
    setSelectedSlotId((selected) => (selected === slotId ? null : selected));
  }, [commit]);

  // =========================================================================
  // Captions — generate, design, edit line by line
  // =========================================================================

  /**
   * One button for the whole caption job: transcribe if we have not already,
   * work out the language, then cut the words into lines. Running it again
   * re-cuts the lines from the transcript already in hand rather than paying
   * for a second transcription.
   */
  const generateCaptions = useCallback(async () => {
    const first = docRef.current.clips[0];
    if (!first || captionsBusy) return;
    setCaptionsBusy(true);
    setCaptionNote('');
    try {
      let words = docRef.current.words;
      let transcript = docRef.current.transcript;
      let source = docRef.current.transcriptSource || first.previewUrl;

      if (!words.length) {
        setCaptionNote('Listening to the footage…');
        const file = await fileForClip(first);
        if (!audioRefData.current) audioRefData.current = await analyseAudio(file).catch(() => null);
        const t = await transcribeForStudio(file, audioRefData.current, (n) => { if (aliveRef.current) setCaptionNote(n); });
        if (!aliveRef.current) return;
        words = t.words;
        transcript = t.transcript;
        source = first.previewUrl;
        setExactTimings(t.exactTimings);
        setTranscriptNote(t.note);
      }

      if (!words.length) {
        setCaptionNote('No speech was found in this footage, so there is nothing to caption.');
        return;
      }

      const lang = detectLanguage(transcript || words.map((w) => w.text).join(' '));
      commit((cur) => {
        const next = { ...cur, words, transcript, transcriptSource: source, captionLanguage: lang.code };
        return { ...next, captions: captionsFromWords(next.clips, next.transcriptSource, next.words, captionMaxWords(next.captionSettings)) };
      });
      setCaptionNote(lang.confident
        ? `Caption track built in ${lang.label}.`
        : 'Caption track built. The language could not be read confidently from the transcript.');
    } catch (e) {
      setCaptionNote(`The captions could not be built: ${msg(e)}`);
    } finally {
      if (aliveRef.current) setCaptionsBusy(false);
    }
  }, [captionsBusy, commit, fileForClip]);

  const onEditCue = useCallback((id: string, text: string) => {
    patch((cur) => ({ ...cur, captions: cur.captions.map((c) => (c.id === id ? retimeCue(c, text) : c)) }));
  }, [patch]);

  const onRetimeCue = useCallback((id: string, start: number, end: number) => {
    patch((cur) => ({ ...cur, captions: cur.captions.map((c) => (c.id === id ? shiftCue(c, start, end) : c)) }));
  }, [patch]);

  const onDeleteCue = useCallback((id: string) => {
    commit((cur) => ({ ...cur, captions: cur.captions.filter((c) => c.id !== id) }));
  }, [commit]);

  const onSplitCue = useCallback((id: string) => {
    commit((cur) => {
      const i = cur.captions.findIndex((c) => c.id === id);
      if (i < 0) return cur;
      const parts = splitCue(cur.captions[i], Math.ceil(cur.captions[i].words.length / 2));
      return { ...cur, captions: [...cur.captions.slice(0, i), ...parts, ...cur.captions.slice(i + 1)] };
    });
  }, [commit]);

  const onMergeCueUp = useCallback((id: string) => {
    commit((cur) => {
      const i = cur.captions.findIndex((c) => c.id === id);
      if (i < 1) return cur;
      const fused = mergeCues(cur.captions[i - 1], cur.captions[i]);
      return { ...cur, captions: [...cur.captions.slice(0, i - 1), fused, ...cur.captions.slice(i + 1)] };
    });
  }, [commit]);

  // The caption track also lives in its own table so a creator can pull the
  // lines back out without reopening the whole project. Debounced, and
  // deliberately silent on failure — the cues are inside the project JSON too.
  useEffect(() => {
    if (!doc.captions.length) return;
    const timer = setTimeout(() => {
      void saveCaptionTrack({
        rowId: captionRowRef.current,
        projectId: projectIdRef.current,
        title: doc.title,
        sourceUrl: doc.clips.find((c) => /^https:\/\//i.test(c.url))?.url || '',
        language: doc.captionLanguage,
        cues: doc.captions,
        settings: doc.captionSettings,
        srt: buildSrt(doc.captions),
        durationS: timelineDuration(doc.clips),
      }).then((id) => { if (id != null) captionRowRef.current = id; }).catch(() => undefined);
    }, 4000);
    return () => clearTimeout(timer);
  }, [doc.captions, doc.captionSettings, doc.captionLanguage, doc.clips, doc.title]);

  // =========================================================================
  // B-roll video overlays
  // =========================================================================

  const addBrollFiles = useCallback(async (files: File[]) => {
    const usable = files.filter((f) => f.type.startsWith('video/') && f.size <= MAX_UPLOAD_BYTES);
    if (files.length && !usable.length) {
      setError('B-roll must be a video file of 500 MB or less.');
      return;
    }
    const queued: { id: string; file: File }[] = [];
    let at = playheadRef.current;

    for (const file of usable) {
      const local = URL.createObjectURL(file);
      const dur = (await probeDuration(local)) || 4;
      const overlay = newVideoOverlay({
        previewUrl: local,
        sourceDuration: dur,
        sourceOut: dur,
        label: file.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'B-roll',
        start: Number(at.toFixed(2)),
        end: Number((at + dur).toFixed(2)),
      });
      if (!aliveRef.current) return;
      commit((cur) => ({ ...cur, videoOverlays: [...cur.videoOverlays, overlay] }));
      setSelectedBrollId(overlay.id);
      queued.push({ id: overlay.id, file });
      at += dur;
    }

    if (!queued.length) return;
    setUploadingBroll(true);
    for (const q of queued) {
      try {
        const up = await uploadVideo(q.file);
        if (!aliveRef.current) return;
        patch((cur) => ({ ...cur, videoOverlays: cur.videoOverlays.map((o) => (o.id === q.id ? { ...o, url: up.url } : o)) }));
      } catch (e) {
        if (aliveRef.current) setError(`A cutaway is only local for now — the export needs a durable copy. ${msg(e)}`);
      }
    }
    if (aliveRef.current) setUploadingBroll(false);
  }, [commit, patch]);

  const changeBroll = useCallback((id: string, p: Partial<VideoOverlay>) => {
    patch((cur) => ({ ...cur, videoOverlays: cur.videoOverlays.map((o) => (o.id === id ? { ...o, ...p } : o)) }));
  }, [patch]);

  const deleteBroll = useCallback((id: string) => {
    commit((cur) => ({ ...cur, videoOverlays: cur.videoOverlays.filter((o) => o.id !== id) }));
    setSelectedBrollId((selected) => (selected === id ? null : selected));
  }, [commit]);

  const generateOmniClip = useCallback(async () => {
    if (omniGenerating) return;
    const d = docRef.current;
    const inferred = (d.transcript || d.captions.map((c) => c.text).join(' ')).trim();
    const profile = d.clips.find((clip) => clip.subject)?.subject || null;
    const subject = omniPrompt.trim() || profile?.subjectType || inferred;
    if (!subject && !thumbUrl) {
      setOmniError('Describe the subject or generate a transcript first, then try again.');
      return;
    }

    const sourceVideo = videoRef.current;
    const hasSourceGeometry = Boolean(sourceVideo?.videoWidth && sourceVideo?.videoHeight);
    const sourceIsLandscape = hasSourceGeometry
      ? (sourceVideo as HTMLVideoElement).videoWidth >= (sourceVideo as HTMLVideoElement).videoHeight
      : d.aspect === '16:9' || d.aspect === '1:1';
    const generationAspect: AspectId = sourceIsLandscape ? '16:9' : '9:16';
    const orientation = sourceIsLandscape ? 'horizontal' : 'vertical';
    const scene = profile?.backgroundDescription || inferred || subject || 'the subject and scene in the reference frame';
    const prompt = [
      `Cinematic B-roll of ${subject || 'the same subject shown in the reference image'}.`,
      `Match the tone and visual context of this scene: ${scene.slice(0, 420)}.`,
      profile ? `Carry through the ${profile.dominantColor} palette and a ${profile.mood} mood.` : '',
      `Five-second ${orientation} composition, natural continuity, polished camera movement, no on-screen text, no logos.`,
    ].join(' ');

    setOmniGenerating(true);
    setOmniProgress(0);
    setOmniError('');
    setOmniNote(`Matching the subject and scene with ${modelLabel(brollModel)}…`);
    try {
      const url = await generateOmniBroll(prompt, brollModel, generationAspect, thumbUrl, setOmniProgress, () => aliveRef.current);
      if (!aliveRef.current || !url) return;
      const sourceDuration = (await probeDuration(url)) || 5;
      const start = playheadRef.current;
      const span = Math.min(5, sourceDuration);
      const overlay = newVideoOverlay({
        url,
        previewUrl: url,
        sourceDuration,
        sourceOut: sourceDuration,
        start,
        end: start + span,
        label: `${modelLabel(brollModel)} · ${(subject || 'Matched subject').slice(0, 24)}`,
      });
      commit((cur) => ({ ...cur, videoOverlays: [...cur.videoOverlays, overlay] }));
      setSelectedBrollId(overlay.id);
      setOmniProgress(100);
      setOmniNote('Clip ready — it is on the canvas at the playhead. Generate again to make another option.');
    } catch (e) {
      if (aliveRef.current) {
        setOmniError(msg(e));
        setOmniNote('');
      }
    } finally {
      if (aliveRef.current) setOmniGenerating(false);
    }
  }, [brollModel, commit, omniGenerating, omniPrompt, thumbUrl]);

  // =========================================================================
  // Chroma key, motion and VFX
  // =========================================================================

  const onTimelineInsert = useCallback((kind: 'aiVideo' | 'aiImage' | 'overlay' | 'motion' | 'cut', time: number) => {
    seek(time);
    playheadRef.current = time;
    if (kind === 'cut') {
      window.requestAnimationFrame(() => onSplit());
      return;
    }
    setSheetOpen(true);
    if (kind === 'aiImage') {
      setAiImageAt(time);
      setAiImageOpen(true);
      setProTab('effects');
      setFxTab('overlays');
      const nearby = docRef.current.words.filter((word) => word.end >= time - 3 && word.start <= time + 4).map((word) => word.text).join(' ');
      if (nearby && !aiImagePrompt.trim()) setAiImagePrompt(`Editorial visual illustrating: ${nearby}`);
      return;
    }
    setAiImageOpen(false);
    if (kind === 'aiVideo') {
      setProTab('effects');
      setFxTab('overlays');
      const nearby = docRef.current.words.filter((word) => word.end >= time - 3 && word.start <= time + 4).map((word) => word.text).join(' ');
      if (nearby) setOmniPrompt(nearby);
      setOmniNote('Choose a real configured model, refine the prompt, then Generate. The clip lands at this playhead.');
    } else if (kind === 'overlay') {
      setProTab('effects');
      setFxTab('overlays');
    } else {
      setProTab('motion');
      setFxTab('motion');
    }
  }, [aiImagePrompt, onSplit, seek]);

  const onChroma = useCallback((p: Partial<ChromaKeyState>) => {
    patch((cur) => ({ ...cur, chroma: { ...cur.chroma, ...p } }));
  }, [patch]);

  const onChromaBackgroundFile = useCallback(async (file: File) => {
    const local = URL.createObjectURL(file);
    onChroma({ background: 'image', backgroundUrl: local });
    try {
      const up = await uploadVideo(file);
      if (aliveRef.current) onChroma({ backgroundUrl: up.url });
    } catch (e) {
      if (aliveRef.current) setError(`The key background is only local for now — the export needs a durable copy. ${msg(e)}`);
    }
  }, [onChroma]);

  /** Motion is per clip: the selection, or every clip when the toggle is on. */
  const applyMotion = useCallback((all: boolean, fn: (c: StudioClip) => StudioClip) => {
    const ids = selectedClipRef.current;
    patch((cur) => ({
      ...cur,
      clips: cur.clips.map((c) => {
        const target = all || (ids.length ? ids.includes(c.id) : cur.clips[0]?.id === c.id);
        return target ? fn(c) : c;
      }),
    }));
  }, [patch]);

  const onRamp = useCallback((p: Partial<SpeedRamp>, all: boolean) => {
    applyMotion(all, (c) => { const m = clipMotion(c); return { ...c, motion: { ...m, ramp: { ...m.ramp, ...p } } }; });
  }, [applyMotion]);

  const onZoomCut = useCallback((p: Partial<ZoomCut>, all: boolean) => {
    applyMotion(all, (c) => { const m = clipMotion(c); return { ...c, motion: { ...m, zoomCut: { ...m.zoomCut, ...p } } }; });
  }, [applyMotion]);

  const onShake = useCallback((p: Partial<CameraShake>, all: boolean) => {
    applyMotion(all, (c) => { const m = clipMotion(c); return { ...c, motion: { ...m, shake: { ...m.shake, ...p } } }; });
  }, [applyMotion]);

  const onVfx = useCallback((p: Partial<VfxState>) => {
    patch((cur) => ({ ...cur, vfx: { ...cur.vfx, ...p } }));
  }, [patch]);

  // =========================================================================
  // Autosave — every 30 seconds, with a backing-off retry
  // =========================================================================

  const saveProject = useCallback(async (attempt = 0): Promise<void> => {
    const db = (window as unknown as { __workspaceDb?: { from?: (t: string) => any } }).__workspaceDb;
    if (!db?.from) return;
    const d = docRef.current;
    if (!d.clips.length) return;
    const row = {
      title: d.title || 'Untitled edit',
      source_url: d.clips.find((c) => /^https:\/\//i.test(c.url))?.url || '',
      duration_s: Number(timelineDuration(d.clips).toFixed(2)),
      aspect: d.aspect,
      status: exportingRef.current ? 'rendering' : resultsRef.current.length ? 'exported' : 'editing',
      render_url: resultsRef.current[0]?.url || '',
      project: serialiseDoc(d),
      subject: d.clips.find((clip) => clip.subject)?.subject || null,
      music_url: d.musicUrl || null,
      autosaved_at: new Date().toISOString(),
    };
    try {
      setSaveState('saving');
      if (projectIdRef.current == null) {
        const res = await db.from('ve_projects').insert(row);
        const id = res?.data?.[0]?.id ?? res?.data?.id ?? res?.id;
        if (id != null) projectIdRef.current = Number(id);
      } else {
        await db.from('ve_projects').update(projectIdRef.current, row);
      }
      if (!aliveRef.current) return;
      setSaveState('saved');
      setSavedAt(Date.now());
    } catch {
      if (!aliveRef.current) return;
      if (attempt < 3) {
        setSaveState('retrying');
        setTimeout(() => { void saveProject(attempt + 1); }, 8000 * (attempt + 1));
      } else {
        setSaveState('failed');
      }
    }
  }, []);

  useEffect(() => {
    if (!hasFootage) return;
    const timer = setInterval(() => { void saveProject(); }, 30000);
    return () => clearInterval(timer);
  }, [hasFootage, saveProject]);

  // =========================================================================
  // Export
  // =========================================================================

  const renderPayload = useCallback((d: EditDoc, aspect: AspectId): Record<string, unknown> => {
    const dims = outputDims(aspect, d.resolution);
    return {
      aspect,
      width: dims.width,
      height: dims.height,
      grade: d.grade,
      globalEffects: d.globalEffects,
      reframe: {
        mode: d.reframe.mode,
        manualX: d.reframe.manualX,
        manualY: d.reframe.manualY,
        focus: d.reframe.focus.map((f) => ({ t: Number(f.t.toFixed(2)), x: Number(f.x.toFixed(4)), y: Number(f.y.toFixed(4)) })),
      },
      chroma: d.chroma.enabled ? d.chroma : null,
      vfx: d.vfx,
      videoOverlays: d.videoOverlays
        .filter((o) => /^https:\/\//i.test(o.url))
        .map((o) => ({
          url: o.url,
          start: Number(o.start.toFixed(3)),
          end: Number(o.end.toFixed(3)),
          sourceIn: Number(o.sourceIn.toFixed(3)),
          sourceOut: Number(o.sourceOut.toFixed(3)),
          position: o.position,
          scale: o.scale,
          opacity: o.opacity,
          radius: o.radius,
          muted: o.muted,
          duckMain: o.duckMain,
          duckVolume: o.duckVolume,
          audioFadeIn: o.audioFadeIn,
          audioFadeOut: o.audioFadeOut,
          fadeOut: o.fadeOut,
        })),
      clips: d.clips.map((c, i) => ({
        url: c.url,
        focusable: c.kind !== 'broll',
        keyframes: (c.keyframes || []).map((k) => ({
          t: Number(k.t.toFixed(3)),
          opacity: Number(k.opacity.toFixed(3)),
          scale: Number(k.scale.toFixed(3)),
          x: Number(k.x.toFixed(4)),
          y: Number(k.y.toFixed(4)),
        })),
        in: Number(c.in.toFixed(3)),
        out: Number(c.out.toFixed(3)),
        speed: c.adjust.speed,
        reverse: c.adjust.reverse,
        opacity: c.opacity,
        muted: c.muted,
        brightness: c.adjust.brightness,
        contrast: c.adjust.contrast,
        saturation: c.adjust.saturation,
        highlights: c.adjust.highlights,
        shadows: c.adjust.shadows,
        temperature: c.adjust.temperature,
        tint: c.adjust.tint,
        crop: c.crop,
        effects: c.effects,
        transitionIn: c.transitionIn,
        motion: clipMotion(c),
        timelineStart: Number(clipStart(d.clips, i).toFixed(3)),
      })),
      captions: d.captionSettings.burnIn
        ? d.captions.map((c) => ({
          text: c.text,
          start: Number(c.start.toFixed(3)),
          end: Number(c.end.toFixed(3)),
          words: c.words.map((w) => ({ text: w.text, start: Number(w.start.toFixed(3)), end: Number(w.end.toFixed(3)) })),
        }))
        : [],
      captionSettings: d.captionSettings,
      textLayers: d.textLayers,
      overlays: d.overlays
        .filter((o) => /^https:\/\//i.test(o.url))
        .map((o) => ({
          url: o.url, x: o.x, y: o.y, w: o.w, aspect: o.aspect, opacity: o.opacity, rotation: o.rotation,
          blend: o.blend, alwaysOn: o.alwaysOn, start: o.start, end: o.end,
          mask: o.mask,
          track: o.track.enabled ? o.track.keys : [],
        })),
      musicUrl: d.musicUrl || undefined,
      musicBedId: d.musicUrl ? undefined : d.musicBedId,
      musicVolume: d.musicVolume,
      musicStyle: d.musicStyle,
      musicPrompt: d.musicPrompt,
      audioDucking: {
        defaultMainVolume: 1,
        defaultDuckVolume: 0.2,
        brollFadeIn: 0.3,
        brollFadeOut: 0.5,
        mainRampBack: 0.5,
      },
    };
  }, []);

  const onExport = useCallback(async (aspectsArg?: AspectId[]) => {
    if (exporting) return;
    const d = docRef.current;
    if (!d.clips.length) return;
    const missing = d.clips.filter((c) => !/^https:\/\//i.test(c.url));
    if (missing.length) {
      setExportError(uploading
        ? 'Your footage is still uploading — give it a moment, then export again.'
        : `${missing.length} clip${missing.length === 1 ? '' : 's'} did not finish uploading. Re-add or remove them, then export.`);
      return;
    }
    const localOverlays = d.overlays.filter((o) => !/^https:\/\//i.test(o.url));

    setExporting(true);
    setExportError('');
    setExportWarning('');
    setExportResults([]);
    setExportProgress(0.02);

    const formats = aspectsArg && aspectsArg.length
      ? aspectsArg
      : exportAspects.length ? exportAspects : [d.aspect];
    // Honest estimate: the render service runs roughly real time per format.
    const perFormat = Math.max(35, timelineDuration(d.clips) * 1.4);
    const started = Date.now();
    const done: { aspect: AspectId; url: string; geometry: string }[] = [];
    const failures: string[] = [];

    for (let i = 0; i < formats.length; i += 1) {
      const aspect = formats[i];
      setExportStage(`Rendering ${aspect}${formats.length > 1 ? ` (${i + 1} of ${formats.length})` : ''} at ${outputDims(aspect, d.resolution).width}×${outputDims(aspect, d.resolution).height}…`);
      const tick = setInterval(() => {
        if (!aliveRef.current) return;
        const elapsed = (Date.now() - started) / 1000;
        const expected = perFormat * formats.length;
        setExportProgress(Math.min(0.95, 0.02 + (elapsed / expected) * 0.93));
        setExportEta(Math.max(0, expected - elapsed));
      }, 900);
      try {
        let out = await callHook('veh-render', renderPayload(d, aspect));
        // The poll call carries the aspect and geometry back so the hook can
        // still run its true-portrait up-convert on the finishing pass.
        if (out?.status === 'rendering' && out.operationId) {
          const operationId = String(out.operationId);
          const geometry = out.geometry;
          out = await poll(
            async () => (aliveRef.current
              ? callHook('veh-render', { operationId, geometry, aspect })
              : { status: 'cancelled' }),
            {
              interval: 4_000,
              timeout: 15 * 60 * 1_000,
              backoff: 1.1,
              maxInterval: 15_000,
              until: (status) => status?.status !== 'rendering',
            },
          );
        }
        if (out?.status === 'complete' && out.renderUrl) {
          done.push({ aspect, url: String(out.renderUrl), geometry: String(out.geometry || '') });
          if (out.note) setExportWarning((cur) => [cur, String(out.note)].filter(Boolean).join(' · '));
        }
        else failures.push(`${aspect}: ${String(out?.error || 'the render failed')}`);
      } catch (e) {
        failures.push(`${aspect}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        clearInterval(tick);
      }
      if (!aliveRef.current) return;
      setExportResults(done.slice());
    }

    setExportProgress(1);
    setExportEta(0);
    setExportStage(done.length ? 'Export complete' : '');
    setExporting(false);
    if (failures.length) {
      console.error('[VideoStudio] export failed:', failures.join(' · '));
      setExportError(failures.join(' · '));
      pushToast({ message: 'Export failed. Your project is saved — try again.', tone: 'bad', ttlMs: 6000 });
    }
    if (localOverlays.length) {
      setExportWarning((cur) => [cur, `${localOverlays.length} overlay image${localOverlays.length === 1 ? '' : 's'} could not be included — re-add them and export again.`].filter(Boolean).join(' · '));
    }
    if (!d.captionSettings.burnIn && d.captions.length) downloadSrt();
    void saveProject();
    // Every finished master also lands in the suite-wide video history. One row
    // per format, because each aspect really is a separate deliverable.
    for (const render of done) {
      void saveVideoToHistory({
        appId: 'video-enhancer',
        title: `${d.title || 'Video export'} (${render.aspect})`,
        videoUrl: render.url,
      });
    }
    // Download the first finished master straight away.
    if (done.length) {
      const a = document.createElement('a');
      a.href = done[0].url;
      a.download = `${(d.title || 'vidverge-export').replace(/[^\w.-]+/g, '-').slice(0, 48)}-${done[0].aspect.replace(':', 'x')}.mp4`;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.click();
      pushToast({ message: 'Video ready! Your download has started.', tone: 'good', ttlMs: 6000 });
    }
  }, [downloadSrt, exportAspects, exporting, pushToast, renderPayload, saveProject, uploading]);

  // =========================================================================
  // Handoffs
  // =========================================================================

  useEffect(() => {
    const handoff = consumeVidvergeHandoff('video-enhancer');
    if (!handoff) return;
    const prompt = String(handoff.prompt || '').trim();
    if (prompt) setBrief(prompt);
    const attachment = handoff.attachment;
    if (handoff.projectId != null) {
      const db = (window as unknown as { __workspaceDb?: { from?: (t: string, o?: unknown) => any } }).__workspaceDb;
      if (!db?.from) return;
      void db.from('video_enhancements', { shared: true }).getById(handoff.projectId).then((response: any) => {
        const row = response?.data?.[0] || response?.data;
        let params = row?.input_params;
        if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }
        const url = String(row?.output_url || params?.srcUrl || params?.baseVideoUrl || '');
        if (url) void addClip(url, url, String(row?.title || 'Saved enhancement'), 'raw');
      }).catch(() => undefined);
      return;
    }
    if (attachment && String(attachment.type || '').startsWith('video/')) {
      void addClip(attachment.url, attachment.url, attachment.name, 'raw').then(async (clip) => {
        void captureThumb(attachment.url, 1, 320).then((t) => { if (aliveRef.current) setThumbUrl(t); });
        void runSubjectAnalysis(clip.id, attachment.url, clip.sourceDuration);
        try {
          const file = await fetchVideoAsFile(attachment.url);
          sourceFiles.current.set(clip.id, file);
          void runPipeline(clip, file);
        } catch { /* the clip still edits without the analysis pass */ }
      });
    }
  }, [addClip, runPipeline, runSubjectAnalysis]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('sceneforge_handoff_v1');
      if (!raw) return;
      window.localStorage.removeItem('sceneforge_handoff_v1');
      const h = JSON.parse(raw) as { url?: string; title?: string; ts?: number } | null;
      if (!h || typeof h.url !== 'string' || !/^https?:\/\//.test(h.url)) return;
      if (!h.ts || Date.now() - h.ts > 10 * 60 * 1000) return;
      void (async () => {
        const clip = await addClip(h.url as string, h.url as string, h.title || 'SceneForge video', 'raw');
        void captureThumb(h.url as string, 1, 320).then((t) => { if (aliveRef.current) setThumbUrl(t); });
        void runSubjectAnalysis(clip.id, h.url as string, clip.sourceDuration);
        try {
          const file = await fetchVideoAsFile(h.url as string);
          sourceFiles.current.set(clip.id, file);
          void runPipeline(clip, file);
        } catch { /* editing still works without the analysis pass */ }
      })();
    } catch { /* localStorage unavailable — nothing to hand off */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a stage thumbnail roughly current for the reframe proof.
  useEffect(() => {
    const first = doc.clips[0];
    if (!first || thumbUrl) return;
    void captureThumb(first.previewUrl, Math.min(1, first.sourceDuration / 2), 320).then((t) => {
      if (aliveRef.current && t) setThumbUrl(t);
    });
  }, [doc.clips, thumbUrl]);

  // Retention curve stays meaningful after edits even without a model pass.
  useEffect(() => {
    if (retention.length || !analysisReady || !doc.words.length) return;
    setRetention(segmentRetention(planContext()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisReady, doc.words.length, retention.length]);

  // =========================================================================
  // The pro shell — looks, presets, motion, voiceover, beat sync, agent
  // =========================================================================

  /** Push any file to durable storage and hand back its public URL. */
  const uploadBlob = useCallback(async (file: File, folder: string): Promise<string> => {
    const token = workspaceToken();
    if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('workspaceId', WORKSPACE_UUID);
    form.append('folder', folder);
    const res = await fetch('/api/upload/file', {
      method: 'POST',
      headers: { 'X-Workspace-DB-Token': token },
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) throw new Error(String(data?.error || `the storage service answered HTTP ${res.status}`));
    return String(data.url);
  }, []);

  const onLook = useCallback((id: string, strength: number) => {
    const look = LOOKS.find((l) => l.id === id);
    if (!look) return;
    // One checkpoint per look, not one per intensity frame.
    if (id !== activeLook) checkpoint();
    setActiveLook(id);
    setLookStrength(strength);
    patch((d) => applyLook(d, look, strength));
  }, [activeLook, checkpoint, patch]);

  const allPresets = useMemo(() => [...EDIT_PRESETS, ...customPresets], [customPresets]);

  const onProPreset = useCallback((id: string) => {
    const preset = allPresets.find((p) => p.id === id);
    if (!preset) return;
    commit((d) => applyEditPreset(d, preset));
    setPresetId(id);
    setActiveLook(preset.lookId);
    setLookStrength(1);
    pushToast({ message: `${preset.label} applied across the whole edit`, tone: 'good' });
  }, [allPresets, commit, pushToast]);

  const onSavePreset = useCallback(() => {
    const d = docRef.current;
    const label = (window.prompt('Name this preset', 'My look') || '').trim().slice(0, 28);
    if (!label) return;
    const first = d.clips[0];
    const m = first ? clipMotion(first) : null;
    const row: EditPreset = {
      id: `custom-${Date.now().toString(36)}`,
      label,
      blurb: 'Saved from this edit',
      lookId: activeLook || 'cinematic',
      captionStyle: d.captionSettings.styleId,
      captionFont: d.captionSettings.fontId,
      captionPosition: d.captionSettings.position,
      uppercase: d.captionSettings.uppercase,
      music: d.musicStyle,
      zoom: m?.zoomCut.enabled ? (m.zoomCut.direction === 'out' ? 'out' : 'in') : 'off',
      ramp: Boolean(m?.ramp.enabled),
    };
    const next = [row, ...customPresets].slice(0, 12);
    setCustomPresets(next);
    try { window.localStorage.setItem('vidverge_pro_presets', JSON.stringify(next)); } catch { /* storage unavailable */ }
    pushToast({ message: `“${label}” saved to your presets`, tone: 'good' });
  }, [activeLook, customPresets, pushToast]);

  const onMotionPreset = useCallback((kind: MotionKind, amount: number) => {
    if (kind !== activeMotion) checkpoint();
    setActiveMotion(kind === 'none' ? '' : kind);
    setMotionAmount(amount);
    patch((d) => ({
      ...d,
      clips: d.clips.map((c) => {
        const m = clipMotion(c);
        const off = { ...m, zoomCut: { ...m.zoomCut, enabled: false }, shake: { ...m.shake, enabled: false } };
        if (kind === 'none') return { ...c, keyframes: [], motion: off };
        if (kind === 'zoomIn' || kind === 'zoomOut') {
          return {
            ...c,
            keyframes: [],
            motion: {
              ...off,
              zoomCut: {
                ...m.zoomCut,
                enabled: true,
                direction: kind === 'zoomIn' ? ('in' as const) : ('out' as const),
                intensity: amount > 0.66 ? ('high' as const) : amount > 0.33 ? ('medium' as const) : ('low' as const),
              },
            },
          };
        }
        if (kind === 'shake') {
          return { ...c, keyframes: [], motion: { ...off, shake: { ...m.shake, enabled: true, intensity: Math.round(amount * 100) } } };
        }
        return { ...c, keyframes: motionKeys(kind, clipLength(c), amount), motion: off };
      }),
    }));
  }, [activeMotion, checkpoint, patch]);

  const onResetColor = useCallback(() => {
    commit((d) => ({
      ...d,
      grade: 'none',
      globalEffects: [],
      clips: d.clips.map((c) => ({
        ...c,
        adjust: {
          ...c.adjust,
          brightness: 100,
          contrast: 100,
          saturation: 100,
          highlights: 0,
          shadows: 0,
          temperature: 0,
          tint: 0,
        },
      })),
    }));
    setActiveLook('');
    pushToast({ message: 'Colour reset to the original footage' });
  }, [commit, pushToast]);

  /**
   * Text to speech through the platform's OpenAI proxy, then straight into
   * durable storage so the render service can read it back.
   */
  const onVoiceover = useCallback(async (text: string, voice: string) => {
    setVoBusy(true);
    setVoNote('');
    try {
      const token = workspaceToken();
      if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
      const res = await fetch('/proxy/openai/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
        body: JSON.stringify({ model: 'tts-1', voice, input: text.slice(0, 4096), response_format: 'mp3' }),
      });
      if (!res.ok) throw new Error(`the speech service answered HTTP ${res.status}`);
      const blob = await res.blob();
      const url = await uploadBlob(new File([blob], `voiceover-${Date.now()}.mp3`, { type: 'audio/mpeg' }), 'video-studio-voiceover');
      if (!aliveRef.current) return;
      commit((cur) => ({
        ...cur,
        musicUrl: url,
        musicBedId: 'none',
        musicStyle: 'none',
        musicPrompt: text.slice(0, 120),
        musicVolume: Math.max(cur.musicVolume, 0.85),
      }));
      setVoNote('Voiceover generated and mixed in as the audio bed. Drop the music level if it sits too loud over the dialogue.');
    } catch (e) {
      setVoNote(msg(e));
    } finally {
      if (aliveRef.current) setVoBusy(false);
    }
  }, [commit, uploadBlob]);

  /** Measure the tempo, then lengthen or shorten each clip onto a whole beat. */
  const runBeatSync = useCallback(async (): Promise<string> => {
    const first = docRef.current.clips[0];
    if (!first) return 'Upload footage first.';
    const file = await fileForClip(first);
    const tempo = await detectTempo(file);
    if (!aliveRef.current) return '';
    setBpm(tempo.bpm);
    if (!tempo.bpm) return tempo.note;
    const period = 60 / tempo.bpm;
    commit((cur) => ({
      ...cur,
      clips: cur.clips.map((c) => {
        const speed = Math.max(0.25, c.adjust.speed);
        const beats = Math.max(1, Math.round(((c.out - c.in) / speed) / period));
        const out = Math.min(c.sourceDuration, c.in + beats * period * speed);
        if (out - c.in <= 0.25) return c;
        return { ...c, out, kind: (c.kind === 'raw' ? 'cut' : c.kind) as StudioClip['kind'] };
      }),
    }));
    return `${Math.round(tempo.bpm)} BPM measured — every cut now lands on a beat.`;
  }, [commit, fileForClip]);

  const runSmartTrim = useCallback((): string => {
    const ranges = (audioRefData.current?.silences || []).filter((s) => s.end - s.start >= 0.45);
    if (!ranges.length) return 'No silent stretch long enough to cut was measured in this footage.';
    commit((cur) => rebuildCaptions({
      ...cur,
      clips: cutSourceRanges(
        cur.clips,
        cur.transcriptSource,
        ranges.map((r) => ({ start: r.start + 0.08, end: Math.max(r.start + 0.18, r.end - 0.08) })),
      ),
    }));
    return `${ranges.length} silent stretch${ranges.length === 1 ? '' : 'es'} cut out.`;
  }, [commit, rebuildCaptions]);

  const runAutoEnhance = useCallback(async (): Promise<string> => {
    const d = docRef.current;
    if (!d.clips.length) return 'Upload footage first.';
    const mood = d.clips.find((c) => c.subject)?.subject?.mood || '';
    const lookId = mood === 'calm' ? 'matte' : mood === 'playful' ? 'vivid' : mood === 'dramatic' ? 'cinematic' : 'cinematic';
    const needsCaptions = !d.captions.length && d.words.length > 0;
    onLook(lookId, 0.85);
    onMotionPreset('kenBurns', 0.5);
    if (needsCaptions) buildCaptionTrack();
    return `Graded with the ${lookId} look and given a slow Ken Burns drift${needsCaptions ? ', plus a caption track from the transcript' : ''}.`;
  }, [buildCaptionTrack, onLook, onMotionPreset]);

  const runAgentAction = useCallback(async (id: AgentActionId) => {
    if (agentRunning) return;
    setAgentRunning(id);
    setAgentJobs((jobs) => ({ ...jobs, [id]: { state: 'running' as RunState, note: '' } }));
    let note = '';
    let ok = true;
    try {
      if (id === 'enhance') note = await runAutoEnhance();
      else if (id === 'caption') {
        await generateCaptions();
        note = docRef.current.captions.length
          ? `${docRef.current.captions.length} caption lines built from the transcript.`
          : 'No speech was found in this footage, so there is nothing to caption.';
      } else if (id === 'beat') note = await runBeatSync();
      else if (id === 'trim') note = runSmartTrim();
      else if (id === 'scene') {
        await generateOmniClip();
        note = 'A matched cutaway was filmed and dropped at the playhead.';
      }
    } catch (e) {
      ok = false;
      note = msg(e);
    }
    if (!aliveRef.current) return;
    setAgentRunning('');
    setAgentJobs((jobs) => ({ ...jobs, [id]: { state: (ok ? 'done' : 'failed') as RunState, note } }));
  }, [agentRunning, generateCaptions, generateOmniClip, runAutoEnhance, runBeatSync, runSmartTrim]);

  /**
   * A typed instruction goes to whichever action it names. Anything the
   * keywords do not recognise is a real question, so it goes to the editing
   * model, which can answer and propose cut cards.
   */
  const onAgentSend = useCallback(async (text: string) => {
    const routed = routeInstruction(text);
    if (!routed) { await sendChat(text); return; }
    setChat((c) => [...c, { id: newId('m'), role: 'user', content: text }]);
    if (routed === 'preset') {
      const match = allPresets.find((p) => text.toLowerCase().includes(p.label.toLowerCase()));
      if (match) {
        onProPreset(match.id);
        setChat((c) => [...c, { id: newId('m'), role: 'assistant', content: `Applied the ${match.label} preset.` }]);
        return;
      }
      setChat((c) => [...c, {
        id: newId('m'),
        role: 'assistant',
        content: `Which preset? ${allPresets.map((p) => p.label).join(', ')}.`,
      }]);
      return;
    }
    setChat((c) => [...c, { id: newId('m'), role: 'assistant', content: `On it — running ${routed}.` }]);
    await runAgentAction(routed);
  }, [allPresets, onProPreset, runAgentAction, sendChat]);

  const duplicateClip = useCallback((id: string) => {
    const source = docRef.current.clips.find((c) => c.id === id);
    if (!source) return;
    const copy = { ...source, id: newId('clip'), keyframes: (source.keyframes || []).map((k) => ({ ...k })) };
    const file = sourceFiles.current.get(source.id);
    if (file) sourceFiles.current.set(copy.id, file);
    commit((cur) => {
      const list = cur.clips.slice();
      const at = list.findIndex((c) => c.id === id);
      list.splice(at < 0 ? list.length : at + 1, 0, copy);
      return { ...cur, clips: list };
    });
    setSelectedClipIds([copy.id]);
  }, [commit]);

  /** Trim the clip's tail to the playhead; everything after it slides up. */
  const rippleTrim = useCallback((id: string) => {
    const d = docRef.current;
    const index = d.clips.findIndex((c) => c.id === id);
    const loc = locate(d.clips, playheadRef.current);
    if (!loc || loc.index !== index) {
      pushToast({ message: 'Put the playhead inside that clip first.', tone: 'bad' });
      return;
    }
    if (loc.sourceT - d.clips[index].in < 0.2) return;
    commit((cur) => ({
      ...cur,
      clips: cur.clips.map((c) => (c.id === id ? { ...c, out: loc.sourceT, kind: 'cut' as StudioClip['kind'] } : c)),
    }));
    pushToast({ message: 'Rippled — every later clip moved up to meet it.' });
  }, [commit, pushToast]);

  const toggleKeyframe = useCallback((id: string) => {
    const d = docRef.current;
    const index = d.clips.findIndex((c) => c.id === id);
    if (index < 0) return;
    const localT = Math.max(0, playheadRef.current - clipStart(d.clips, index));
    commit((cur) => ({
      ...cur,
      clips: cur.clips.map((c) => {
        if (c.id !== id) return c;
        const keys = c.keyframes || [];
        const hit = keys.findIndex((k) => Math.abs(k.t - localT) < 0.12);
        if (hit >= 0) return { ...c, keyframes: keys.filter((_, x) => x !== hit) };
        const base = keyframeAt(keys, localT) || { t: localT, opacity: 1, scale: 1, x: 0, y: 0 };
        return { ...c, keyframes: [...keys, { ...base, t: localT }].sort((a, b) => a.t - b.t) };
      }),
    }));
  }, [commit]);

  // =========================================================================
  // Keyboard shortcuts
  // =========================================================================

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const interactive = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.isContentEditable);
      if (interactive) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (meta) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); onSplit(); return; }
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        selectedClipRef.current.forEach((id) => duplicateClip(id));
        return;
      }
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        selectedClipRef.current.forEach((id) => toggleKeyframe(id));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDeleteSelected(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(playheadRef.current - (e.shiftKey ? 1 : 1 / 30)); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(playheadRef.current + (e.shiftKey ? 1 : 1 / 30)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duplicateClip, onDeleteSelected, onSplit, redo, seek, toggleKeyframe, togglePlay, undo]);

  const runProExport = useCallback(async () => {
    setClientResults([]);
    if (exportSpec.format === 'mp4') {
      const synced = { ...docRef.current, resolution: exportSpec.resolution };
      docRef.current = synced;
      setDoc(synced);
      setExportAspects(exportSpec.aspects);
      await onExport(exportSpec.aspects);
      return;
    }
    const video = videoRef.current;
    const d = docRef.current;
    const clip = d.clips[0];
    if (!video || !clip) { setExportError('Load a clip first.'); return; }
    setExporting(true);
    setExportError('');
    setExportProgress(0);
    setExportStage(`Encoding ${exportSpec.format.toUpperCase()} in your browser…`);
    try {
      const options = {
        video,
        aspect: exportSpec.aspects[0] || d.aspect,
        filter: clipFilterCss(clip.adjust, d.grade, clip.effects),
        startS: clip.in,
        endS: clip.out,
        fps: exportSpec.fps,
        onProgress: (p: number) => { if (aliveRef.current) setExportProgress(p); },
      };
      const blob = exportSpec.format === 'gif'
        ? await encodeGif(options)
        : await encodeWebm({ ...options, bitrate: exportSpec.bitrate });
      if (!aliveRef.current) return;
      setClientResults([{
        aspect: 'local',
        url: URL.createObjectURL(blob),
        geometry: `${(blob.size / 1024 / 1024).toFixed(1)} MB`,
        label: `${exportSpec.format.toUpperCase()} · built in your browser`,
      }]);
      setExportProgress(1);
      setExportStage('Encode complete');
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setExportError(/taint|securityerror|insecure|cross-origin/i.test(raw)
        ? 'Your browser refused to read the frames because this clip is served without CORS headers. Export MP4 instead — that render runs on the server.'
        : msg(e));
    } finally {
      if (aliveRef.current) setExporting(false);
    }
  }, [exportSpec, onExport]);

  const onProDownload = useCallback((r: ExportResult) => {
    const stem = (docRef.current.title || 'vidverge-export').replace(/[^\w.-]+/g, '-').slice(0, 48);
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.aspect === 'local'
      ? `${stem}.${exportSpec.format}`
      : `${stem}-${String(r.aspect).replace(':', 'x')}.mp4`;
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [exportSpec.format]);

  const proResults: ExportResult[] = useMemo(() => [
    ...exportResults.map((r) => ({ aspect: r.aspect, url: r.url, geometry: r.geometry, label: `MP4 · ${r.aspect}` })),
    ...clientResults,
  ], [clientResults, exportResults]);

  /** Measured silences, mapped from source seconds onto the current timeline. */
  const timelineSilences = useMemo(() => (audioRefData.current?.silences || [])
    .map((s) => {
      const a = sourceToTimeline(doc.clips, doc.transcriptSource, s.start);
      const b = sourceToTimeline(doc.clips, doc.transcriptSource, s.end);
      return a == null || b == null || b <= a ? null : { start: a, end: b };
    })
    .filter(Boolean) as { start: number; end: number }[],
  [analysisReady, doc.clips, doc.transcriptSource]);


  // =========================================================================
  // Agent orb context
  // =========================================================================

  const agentContext = {
    appId: 'video-enhancer',
    appName: 'Video Studio',
    currentInputs: {
      clipsOnTimeline: String(clips.length),
      format: doc.aspect,
      resolution: doc.resolution,
      captions: String(doc.captions?.length ?? 0),
      captionLanguage: doc.captionLanguage,
      brollOverlays: String(doc.videoOverlays?.length ?? 0),
      chromaKey: doc.chroma?.enabled ? 'on' : 'off',
      effectsTab: fxTab,
      currentStep: step,
      stylePreset: presetId || 'none',
      pendingSuggestions: String(doc.cards.filter((c) => c.status === 'pending').length),
      grade: doc.grade,
    },
    onFillField: (field: string, value: string) => {
      if (field === 'format' && ASPECTS.some((a) => a.id === value)) commit((cur) => ({ ...cur, aspect: value as AspectId }));
      else if (field === 'grade') commit((cur) => ({ ...cur, grade: value as GradeId }));
      else if (field === 'brief') setBrief(value);
    },
    onTriggerAction: (action: string, params?: Record<string, unknown>) => {
      const p = params || {};
      if (action === 'plan' || action === 'enhance') void replan();
      else if (action === 'transcribe') void runTranscribe();
      else if (action === 'captions') buildCaptionTrack();
      else if (action === 'removeFillers') onRemoveAllFillers();
      else if (action === 'acceptAll') void acceptAll();
      else if (action === 'reframe') void detectSubject();
      else if (action === 'ask' && typeof p.message === 'string') void sendChat(p.message);
      else if (action === 'addCaptions') void generateCaptions();
      else if (action === 'openEffects') setFxTab(['overlays', 'motion', 'vfx', 'captions', 'music', 'export'].includes(String(p.tab)) ? (String(p.tab) as EffectsTabId) : 'overlays');
      else if (action === 'chromaKey') onChroma({ enabled: p.enabled !== false });
      else if (action === 'applyStyle') {
        const preset = STYLE_PRESETS.find((s) => s.id === String(p.preset));
        if (preset) applyStylePreset(preset);
      } else if (action === 'goToStep') {
        const target = STUDIO_STEPS.find((s) => s.id === String(p.step));
        if (target) selectStep(target.id);
      } else if (action === 'export' || action === 'render') void onExport();
    },
    promptHint: [
      'The user is editing uploaded footage in an all-in-one AI video studio: agentic cut plan, transcript-first editing, auto-reframe, b-roll slots, overlays, captions, text effects, transitions and MP4 export.',
      'Fields you can fill: format (16:9 | 9:16 | 1:1 | 4:5), grade (none | cinematic | warm | cool | bw | vintage), brief (what the video is for — it sharpens the cut plan).',
      'The editor is guided: a five-step rail runs Trim & Clips, Effects, Captions, Music, Export, ticking each step green once the work is actually done, and a sticky bottom bar names the current step with a Next button. Steps can be done in any order.',
      'A one-tap style row above the panels sets captions, colour grade, music mood and speed ramp together: tiktok (TikTok Viral), cinematic, minimal, vhs (90s VHS), corporate (Corporate Clean).',
      'The right panel has six tabs: Overlays, Motion, VFX, Captions, Music and Export. Uploaded clips are analyzed from their 25% and 75% frames, so B-roll ranking, the AI style suggestion and the AI soundtrack all use the detected subject, background, dominant color and mood.',
      'Actions you can trigger: plan (re-run the cut plan), transcribe, captions (build the caption track), addCaptions (transcribe if needed, detect the language and build the track in one step), removeFillers, acceptAll (apply every pending suggestion), reframe (detect the subject), openEffects with {"tab":"overlays|motion|vfx|captions|music|export"}, goToStep with {"step":"trim|effects|captions|music|export"}, applyStyle with {"preset":"tiktok|cinematic|minimal|vhs|corporate"}, chromaKey with {"enabled":true|false}, ask with {"message":"..."} (put a request to the editing model), export.',
      'If clipsOnTimeline is 0, ask the user to upload footage first.',
      'Text “behind subject” depth compositing still needs a real matte, which currently means chroma key; visual subject detection itself is available for B-roll and music matching.',
    ].join('\n'),
  };

  // =========================================================================
  // Render
  // =========================================================================

  const pendingCount = doc.cards.filter((c) => c.status === 'pending').length;
  const runwaySource = (clips.filter((c) => /^https:\/\//i.test(c.url))[0] || { url: '' }).url;

  // =========================================================================
  // The guided flow — steps, presets, suggestion, preview feedback
  // =========================================================================

  const selectStep = useCallback((id: StepId) => {
    const found = STUDIO_STEPS.find((s) => s.id === id);
    setStep(id);
    if (found) setFxTab(found.tab as EffectsTabId);
    if (isMobile) setSheetOpen(true);
  }, [isMobile]);

  /** Keep the rail honest when someone drives the sidebar tabs directly. */
  const onFxTab = useCallback((tab: EffectsTabId) => {
    setFxTab(tab);
    const match = tab === 'overlays'
      ? STUDIO_STEPS.find((s) => s.id === 'effects')
      : STUDIO_STEPS.find((s) => s.tab === tab);
    if (match) setStep(match.id);
  }, []);

  const applyStylePreset = useCallback((preset: StudioPreset) => {
    commit((cur) => applyPreset(cur, preset));
    setPresetId(preset.id);
    pushToast({ message: `${preset.label} style applied`, tone: 'good' });
  }, [commit, pushToast]);

  const shareLink = useCallback(async (url: string) => {
    const copied = await copyLink(url);
    pushToast({
      message: copied ? 'Link copied!' : 'Could not copy the link — use Download instead.',
      tone: copied ? 'good' : 'bad',
    });
  }, [pushToast]);

  /**
   * The preview is already live: every control writes into the doc and the
   * stage re-renders on the next frame. The pill only tells the creator that
   * the frame in front of them has just been recomposited, so a change never
   * looks like it was ignored.
   */
  const previewSignature = useMemo(() => JSON.stringify([
    doc.grade, doc.globalEffects, doc.vfx, doc.chroma, doc.aspect,
    doc.captionSettings, doc.musicBedId, doc.musicUrl, doc.musicVolume,
    doc.textLayers?.length, doc.overlays?.length, doc.videoOverlays?.length,
    (doc.clips || []).map((c) => [c.effects, c.adjust, c.crop, c.motion, c.opacity]),
  ]), [doc]);
  const previewUpdating = usePreviewPulse(previewSignature);

  /**
   * The render service gives up at ten minutes. Per-pixel work (the key, the
   * displacement field, the glitch tear) and per-frame time remapping each
   * push the cost up, so the creator is warned BEFORE they spend the wallet
   * on a render that cannot finish.
   */
  const renderWarning = useMemo(() => {
    if (!hasFootage) return '';
    const heavy = (doc.chroma?.enabled ? 1 : 0)
      + (doc.vfx?.displace?.enabled ? 1 : 0)
      + (doc.vfx?.glitch?.enabled ? 1 : 0)
      + (clips.some((c) => clipMotion(c).ramp?.enabled) ? 1 : 0)
      + (doc.videoOverlays?.length ? 1 : 0);
    const formats = Math.max(1, exportAspects.length);
    const estimate = duration * (1.4 + heavy * 0.55) * formats;
    if (estimate < 420) return '';
    const mins = Math.ceil(estimate / 60);
    return estimate > 600
      ? `At this length with ${heavy} heavy effect${heavy === 1 ? '' : 's'} on, the render is estimated at about ${mins} minutes across ${formats} format${formats === 1 ? '' : 's'} — past the service's 10-minute ceiling. Shorten the edit, export one format at a time, or turn an effect off.`
      : `Estimated render time is about ${mins} minutes across ${formats} format${formats === 1 ? '' : 's'}. That is close to the service's 10-minute ceiling, so give it room.`;
  }, [clips, doc.chroma?.enabled, doc.vfx?.displace?.enabled, doc.vfx?.glitch?.enabled, doc.videoOverlays?.length, duration, exportAspects.length, hasFootage]);

  return (
    <div className="vp-root">
      <style>{STUDIO_CSS}</style>
      <style>{PRO_CSS}</style>
      <link rel="stylesheet" href={STUDIO_FONTS_URL} />
      <link rel="stylesheet" href={PRO_FONTS_URL} />
      <audio ref={audioRef} style={{ display: 'none' }} />

      <header className="vp-head">
        <span className="vp-brand">
          <span className="vp-mark"><Clapperboard size={16} color="#FFFFFF" /></span>
          <span>
            <b>Video Studio</b>
            <small>
              {hasFootage
                ? `${clips.length} clip${clips.length === 1 ? '' : 's'} · ${fmtTimecode(duration)}`
                : 'Vidverge pro editor'}
            </small>
          </span>
        </span>
        <span className="vp-divider" />
        <button type="button" className="vp-ico" title="Undo (Cmd+Z)" disabled={!historyDepth.undo} onClick={undo}>
          <Undo2 size={14} />
        </button>
        <button type="button" className="vp-ico" title="Redo (Shift+Cmd+Z)" disabled={!historyDepth.redo} onClick={redo}>
          <Redo2 size={14} />
        </button>
        {busy ? <Loader2 size={14} className="vp-spin" color="#C8920A" /> : null}
        <span className="vp-headgap" />
        <span
          className="vp-note"
          title={saveState === 'failed' ? 'Autosave failed — it keeps retrying in the background' : 'Autosaves every 30 seconds'}
          style={{ whiteSpace: 'nowrap', color: saveState === 'failed' ? '#991B1B' : undefined }}
        >
          {saveState === 'saving' ? 'Saving…'
            : saveState === 'retrying' ? 'Retrying save…'
              : saveState === 'failed' ? 'Save failed'
                : savedAt ? `Saved ${fmtTimecode((Date.now() - savedAt) / 1000)} ago` : 'Autosave on'}
        </span>
        <label className="vp-btn" title="Add one or more clips to the timeline">
          <UploadCloud size={14} /> {hasFootage ? 'Add clips' : 'Upload'}
          <input
            type="file"
            accept="video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { void handleFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
          />
        </label>
        <button
          ref={toolsButtonRef}
          type="button"
          className={`vp-btn${sheetOpen ? ' on' : ''}`}
          aria-expanded={sheetOpen}
          title="Open contextual editing controls"
          onClick={() => setSheetOpen((open) => !open)}
        >
          <Diamond size={13} /> Tools
        </button>
        <button
          type="button"
          className={`vp-btn${agentOpen ? ' on' : ''}`}
          title="Open the AI agent"
          onClick={() => setAgentOpen((v) => !v)}
        >
          <Sparkles size={14} /> Agent
        </button>
        <button type="button" className="vp-btn primary" disabled={!hasFootage} onClick={() => setExportOpen(true)}>
          {exporting ? <Loader2 size={14} className="vp-spin" /> : <Download size={14} />} Export
        </button>
      </header>

      {error ? (
        <div style={{ padding: '8px 12px 0' }}>
          <FriendlyError message={error} onDismiss={() => setError('')} />
        </div>
      ) : null}

      <div className="vp-body" style={{ '--ve-tl-h': tlCollapsed || timelineHeight <= 0 ? 'auto' : `${timelineHeight}px` } as CSSProperties}>
        <div className="vp-stagecol">
          {agentOpen ? (
            <ProAgent
              jobs={agentJobs}
              running={agentRunning}
              hasFootage={hasFootage}
              canUndo={historyDepth.undo > 0}
              chatBusy={chatBusy}
              messages={chat}
              presets={allPresets.map((p) => ({ id: p.id, label: p.label }))}
              onClose={() => setAgentOpen(false)}
              onRun={(id) => { void runAgentAction(id); }}
              onPreset={(id) => onProPreset(id)}
              onUndo={undo}
              onSend={(text) => { void onAgentSend(text); }}
            >
              <ClipManagerPanel
                clips={clips}
                selectedIds={selectedClipIds}
                analyzingId={subjectBusyId}
                onAdd={(file) => void handleFile(file)}
                onSelect={(id) => {
                  setSelectedClipIds([id]);
                  const index = docRef.current.clips.findIndex((clip) => clip.id === id);
                  if (index >= 0) seek(clipStart(docRef.current.clips, index));
                }}
                onDelete={deleteClip}
                onReorder={onReorder}
                onClearAll={() => setConfirmClearAll(true)}
              />
              <CutPlanPanel
                cards={doc.cards}
                summary={planSummary}
                hookVerdict={hookVerdict}
                planning={planning}
                planNote={planNote}
                planError={planError}
                hasFootage={hasFootage}
                onAccept={(id) => void acceptCard(id)}
                onReject={rejectCard}
                onAcceptAll={() => void acceptAll()}
                onReplan={() => void replan()}
                onSeek={(t) => { const mapped = sourceToTimeline(doc.clips, doc.transcriptSource, t); seek(mapped == null ? t : mapped); }}
              />
              <TranscriptPanel
                words={doc.words}
                transcribing={transcribing}
                note={transcriptNote}
                exactTimings={exactTimings}
                playheadSource={sourceT}
                hasFootage={hasFootage}
                onTranscribe={() => void runTranscribe()}
                onSeekSource={seekSource}
                onRemove={onRemoveWords}
                onRestore={onRestoreWords}
                onRemoveAllFillers={onRemoveAllFillers}
              />
              <BrollPanel
                slots={doc.brollSlots}
                selectedId={selectedSlotId}
                generatingLabel={generatingSlot ? 'Filming (1–3 min)…' : ''}
                onSelect={setSelectedSlotId}
                onPrompt={(id, prompt) => patch((cur) => ({ ...cur, brollSlots: cur.brollSlots.map((s) => (s.id === id ? { ...s, prompt } : s)) }))}
                onGenerate={(id) => void generateForSlot(id)}
                onReplaceFile={(id, file) => void replaceSlotWithFile(id, file)}
                onPickStock={(id) => void openLibrary(id)}
                onRemove={removeBrollSlot}
                onSeek={seek}
              />
              <ChatPanel messages={chat} busy={chatBusy} hasFootage={hasFootage} onSend={(t) => void sendChat(t)} />
            </ProAgent>
          ) : null}

          <div
            ref={stageWrapRef}
            className="vp-stage"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(Array.from(e.dataTransfer.files || [])); }}
          >
            {!hasFootage ? (
              <label className={`vp-drop${dragOver ? ' hot' : ''}`} style={{ cursor: 'pointer', display: 'block' }}>
                <span style={{ display: 'inline-grid', placeItems: 'center', width: 62, height: 62, borderRadius: 14, background: 'rgba(200,146,10,0.14)', border: '1px solid rgba(200,146,10,0.42)' }}>
                  <UploadCloud size={28} color="#C8920A" />
                </span>
                <h3>Drop your footage here</h3>
                <p>
                  MP4, MOV, WebM or AVI up to 500&nbsp;MB. Drop more files later and each one joins the VIDEO track as a
                  new clip.
                </p>
                <span className="vp-btn primary" style={{ pointerEvents: 'none' }}>
                  <UploadCloud size={14} /> Choose clips
                </span>
                <input
                  type="file"
                  accept="video/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { void handleFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
                />
              </label>
            ) : (
              <>
                <div className="vp-stagetop">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="vp-chip"
                      title={a.blurb}
                      onClick={() => commit((cur) => ({ ...cur, aspect: a.id }))}
                      style={{
                        cursor: 'pointer',
                        borderColor: doc.aspect === a.id ? 'rgba(212,146,10,0.75)' : undefined,
                        color: doc.aspect === a.id ? '#FFD168' : undefined,
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                  <span className="vp-divider" style={{ height: 18 }} />
                  {(['fit', 'fill'] as const).map((mode) => (
                    <button key={mode} type="button" className="vp-chip" onClick={() => setPreviewFit(mode)} style={{ cursor: 'pointer', color: previewFit === mode ? '#FFD168' : undefined, borderColor: previewFit === mode ? 'rgba(212,146,10,0.75)' : undefined }}>
                      {mode === 'fit' ? 'Fit' : 'Fill'}
                    </button>
                  ))}
                  <span className="vp-divider" style={{ height: 18 }} />
                  {RESOLUTIONS.map((resolution) => (
                    <button
                      key={resolution.id}
                      type="button"
                      className="vp-chip"
                      disabled={!resolution.available}
                      title={resolution.available ? `Export at ${resolution.label}` : `${resolution.label} is not available on the current renderer`}
                      onClick={() => {
                        if (!resolution.available) return;
                        commit((cur) => ({ ...cur, resolution: resolution.id }));
                        setExportSpec((spec) => ({ ...spec, resolution: resolution.id }));
                      }}
                      style={{ cursor: resolution.available ? 'pointer' : 'not-allowed', opacity: resolution.available ? 1 : 0.38, color: doc.resolution === resolution.id ? '#FFD168' : undefined, borderColor: doc.resolution === resolution.id ? 'rgba(212,146,10,0.75)' : undefined }}
                    >
                      {resolution.label}
                    </button>
                  ))}
                  <span className="vp-headgap" />
                  {previewUpdating ? (
                    <span className="vp-chip"><Loader2 size={10} className="vp-spin" /> Updating</span>
                  ) : null}
                  <button
                    type="button"
                    className="vp-chip"
                    title="Show filters and captions while the preview plays"
                    style={{ cursor: 'pointer', color: playWithEffects ? '#FFD168' : undefined }}
                    onClick={() => setPlayWithEffects((on) => !on)}
                  >
                    FX {playWithEffects ? 'on' : 'off'}
                  </button>
                  <button
                    type="button"
                    className="vp-chip"
                    title="Full screen"
                    style={{ cursor: 'pointer' }}
                    onClick={() => { const el = stageWrapRef.current; if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined); }}
                  >
                    <Maximize size={11} />
                  </button>
                </div>

                <div
                  className="vp-stageinner"
                  style={{
                    width: aspectRatio(doc.aspect) < 1 ? 'min(100%, 46vh)' : '100%',
                  }}
                >
                  <StudioStage
                    doc={stageDoc}
                    activeClip={activeClip}
                    playhead={playhead}
                    sourceT={sourceT}
                    clipLocalT={clipLocalT}
                    videoRef={videoRef}
                    isPlaying={isPlaying}
                    volume={volume}
                    selection={{ overlayId: selectedOverlayId, textId: selectedTextId, brollId: selectedBrollId }}
                    showFocus={showFocus}
                    onPickOverlay={setSelectedOverlayId}
                    onPickBroll={setSelectedBrollId}
                    onPickText={setSelectedTextId}
                    onMoveOverlay={(id, x, y) => patch((cur) => ({ ...cur, overlays: cur.overlays.map((o) => (o.id === id ? { ...o, x, y } : o)) }))}
                    onResizeOverlay={(id, width) => patch((cur) => ({ ...cur, overlays: cur.overlays.map((o) => (o.id === id ? { ...o, w: width } : o)) }))}
                    onOverlayTransformStart={checkpoint}
                    onMoveText={(id, x, y) => patch((cur) => ({ ...cur, textLayers: cur.textLayers.map((l) => (l.id === id ? { ...l, x, y } : l)) }))}
                    onTextTransformStart={checkpoint}
                    onTogglePlay={togglePlay}
                    previewFit={previewFit}
                  />
                  {compareAB && activeClip ? (
                    <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', clipPath: 'inset(0 50% 0 0)', overflow: 'hidden' }}>
                      <video
                        key={`ab-${activeClip.id}`}
                        src={activeClip.previewUrl || activeClip.url}
                        muted
                        playsInline
                        ref={(node) => { if (node) { try { node.currentTime = sourceT; } catch { /* not seekable yet */ } } }}
                        style={{ width: '100%', height: '100%', objectFit: previewFit === 'fit' ? 'contain' : 'cover', background: '#000' }}
                      />
                      <span className="vp-chip" style={{ position: 'absolute', left: 8, top: 8 }}>BEFORE</span>
                    </div>
                  ) : null}
                </div>

                <div className="vp-stagechrome pin">
                  <div className="vp-row" style={{ marginBottom: 6 }}>
                    <button type="button" className="vp-ico on" title="Play / pause (Space)" onClick={togglePlay}>
                      {isPlaying ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: 2 }} />}
                    </button>
                    <span className="vp-mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
                      {fmtTimecode(playhead, true)}
                      <span style={{ color: '#707070' }}> / {fmtTimecode(duration, true)}</span>
                    </span>
                    <button type="button" className="vp-btn xs" disabled={!canSplit} onClick={onSplit} title="Split at the playhead (S)">
                      <Scissors size={11} /> Split
                    </button>
                    <button
                      type="button"
                      className="vp-btn xs"
                      disabled={!selectedClipIds.length}
                      title="Add or remove a keyframe on the selected clip"
                      onClick={() => selectedClipIds.forEach((id) => toggleKeyframe(id))}
                    >
                      <Diamond size={11} /> Key
                    </button>
                    <span className="vp-headgap" />
                    {pendingCount ? (
                      <span className="vp-chip">{pendingCount} suggestion{pendingCount === 1 ? '' : 's'}</span>
                    ) : null}
                    <Volume2 size={13} color="#A0A0A0" />
                    <input
                      type="range"
                      className="vp-range"
                      aria-label="Preview volume"
                      min={0}
                      max={100}
                      value={Math.round(volume * 100)}
                      onChange={(e) => setVolume(Number(e.target.value) / 100)}
                      style={{ width: 86, '--vp-fill': `${Math.round(volume * 100)}%` } as CSSProperties}
                    />
                  </div>
                  <div
                    className="vp-scrub"
                    onPointerDown={(e) => {
                      const box = e.currentTarget.getBoundingClientRect();
                      const go = (x: number) => seek(((x - box.left) / Math.max(1, box.width)) * duration);
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
                      <span className="vp-scrubfill" style={{ width: `${Math.min(100, (playhead / Math.max(0.1, duration)) * 100)}%` }} />
                    </span>
                    <span className="vp-scrubknob" style={{ left: `${Math.min(100, (playhead / Math.max(0.1, duration)) * 100)}%` }} />
                    {doc.videoOverlays.map((overlay) => (
                      <span
                        key={overlay.id}
                        title={`B-roll at ${fmtTimecode(overlay.start)}`}
                        style={{ position: 'absolute', left: `${Math.max(0, Math.min(100, (overlay.start / Math.max(0.1, duration)) * 100))}%`, top: 2, width: 5, height: 5, marginLeft: -2.5, borderRadius: '50%', background: '#166534', pointerEvents: 'none' }}
                      />
                    ))}
                  </div>
                  {note ? <p className="vp-note" style={{ marginTop: 5 }}>{note}</p> : null}
                </div>
              </>
            )}
          </div>
        </div>

        <ProTimeline
          clips={clips}
          captions={doc.captions}
          textLayers={doc.textLayers}
          overlays={doc.overlays}
          videoOverlays={doc.videoOverlays}
          globalEffects={doc.globalEffects}
          silences={timelineSilences}
          musicLabel={doc.musicUrl ? 'AI soundtrack' : doc.musicBedId !== 'none' ? doc.musicBedId : ''}
          playhead={playhead}
          zoom={tlZoom}
          collapsed={tlCollapsed}
          selectedClipIds={selectedClipIds}
          selectedTextId={selectedTextId}
          selectedBrollId={selectedBrollId}
          onZoom={setTlZoom}
          onCollapse={setTlCollapsed}
          onResize={onTimelineResize}
          onSeek={seek}
          onSelectClips={setSelectedClipIds}
          onSelectText={setSelectedTextId}
          onSelectBroll={setSelectedBrollId}
          onTrim={onTrim}
          onBeforeEdit={checkpoint}
          onSplit={onSplit}
          onSplitAt={(time) => { seek(time); playheadRef.current = time; window.requestAnimationFrame(() => onSplit()); }}
          onInsert={onTimelineInsert}
          onDuplicate={duplicateClip}
          onDelete={deleteClip}
          onRipple={rippleTrim}
          onTransition={onSetTransition}
          onToggleKeyframe={toggleKeyframe}
          onMoveText={(id, start) => patch((cur) => ({ ...cur, textLayers: cur.textLayers.map((l) => (l.id === id ? { ...l, end: start + (l.end - l.start), start } : l)) }))}
        />

        {sheetOpen ? <button type="button" className="vp-drawerback" aria-label="Close editing controls" onClick={() => setSheetOpen(false)} /> : null}
        <aside ref={drawerRef} className={`vp-side${sheetOpen ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label="Contextual editing controls" tabIndex={-1}>
          <div className="vp-drawerhead">
            <span><b>Editing controls</b><small>Playhead {fmtTimecode(playhead, true)} · changes preview instantly</small></span>
            <button type="button" className="vp-ico sm" aria-label="Close editing controls" onClick={() => setSheetOpen(false)}><X size={13} /></button>
          </div>
          <div className="vp-tabs" role="tablist" aria-label="Quick editing controls">
            {PRO_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={proTab === t.id}
                className="vp-tab"
                onClick={() => { setProTab(t.id); setFxTab(FX_FOR_TAB[t.id]); }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="vp-sidescroll">
            <ProControls
              tab={proTab}
              doc={doc}
              hasFootage={hasFootage}
              playhead={playhead}
              duration={duration}
              selectedClipIds={selectedClipIds}
              selectedTextId={selectedTextId}
              activeLook={activeLook}
              lookStrength={lookStrength}
              activePreset={presetId}
              customPresets={customPresets}
              activeMotion={activeMotion}
              motionAmount={motionAmount}
              compareAB={compareAB}
              captionsBusy={captionsBusy || transcribing}
              captionNote={captionNote}
              musicBusy={musicBusy}
              musicNote={musicError || musicNote}
              voBusy={voBusy}
              voNote={voNote}
              bpm={bpm}
              patch={patch}
              commit={commit}
              onLook={onLook}
              onPreset={onProPreset}
              onSavePreset={onSavePreset}
              onMotion={onMotionPreset}
              onCompareAB={setCompareAB}
              onSelectText={setSelectedTextId}
              onGenerateCaptions={() => void generateCaptions()}
              onRebuildCaptions={buildCaptionTrack}
              onDownloadSrt={downloadSrt}
              onGenerateMusic={(style) => void makeMusic(subjectProfile, style, doc.musicVariation + 1)}
              onVoiceover={(text, voice) => { void onVoiceover(text, voice); }}
              onBeatSync={() => { void runAgentAction('beat'); }}
              onResetColor={onResetColor}
            />

            <AgentStrip onOpen={() => setAgentOpen(true)} pending={pendingCount} />

            <section className="vp-toolstack">
              <div className="vp-toolstack-head">
                <span><b>Layers & effects</b><small>Choose Overlays, Motion, VFX, Captions, Music or Export below</small></span>
              </div>
              <div className="vp-toolstack-body">
                {aiImageOpen ? (
                  <div className="vp-aiimage">
                    <div className="vp-aiimage-head"><span><b>Generate AI image</b><small>Inserts at {fmtTimecode(aiImageAt, true)} as a timed overlay</small></span><button type="button" className="vp-ico sm" onClick={() => setAiImageOpen(false)} aria-label="Close AI image generator"><X size={12} /></button></div>
                    <label className="vp-label">Model</label>
                    <select className="vp-select" value={aiImageModel} disabled={aiImageBusy} onChange={(e) => setAiImageModel(e.target.value as 'gemini-3.1-flash-image' | 'dall-e-3')}>
                      <option value="gemini-3.1-flash-image">Gemini 3.1 Flash Image</option>
                      <option value="dall-e-3">DALL-E 3</option>
                    </select>
                    <label className="vp-label" style={{ marginTop: 9 }}>Prompt</label>
                    <textarea className="vp-area" rows={4} maxLength={10000} value={aiImagePrompt} disabled={aiImageBusy} onChange={(e) => setAiImagePrompt(e.target.value)} placeholder="Describe the visual, subject, lighting and composition…" />
                    {aiImageModel === 'dall-e-3' && doc.aspect === '4:5' ? <p className="vp-note warn">DALL-E 3 will generate the nearest supported portrait ratio, then the overlay keeps your 4:5 canvas.</p> : null}
                    <button type="button" className="vp-btn primary block" disabled={aiImageBusy || !aiImagePrompt.trim()} onClick={() => void generateImageAt(aiImageAt)}>
                      {aiImageBusy ? <Loader2 size={13} className="vp-spin" /> : <Sparkles size={13} />} {aiImageBusy ? 'Generating…' : 'Generate and add to timeline'}
                    </button>
                  </div>
                ) : null}
                <div style={{ background: '#15120A', borderRadius: 12, padding: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                <button
                  type="button"
                  className="vs-btn"
                  onClick={() => setRunwayOpen((o) => !o)}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', background: 'none', border: 'none', color: LB.textPrimary, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0, textAlign: 'left', flexWrap: 'wrap' }}
                  data-testid="toggle-runway-enhance"
                >
                  <Sparkles size={14} color={LB.accent} />
                  Generate footage
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: LB.textMuted }}>
                    Swap the product inside your shot, or film a fresh clip from a prompt or a still — it only joins the timeline when you say so.
                  </span>
                  <span style={{ marginLeft: 'auto', color: LB.textMuted, fontSize: 12, fontWeight: 600 }}>{runwayOpen ? 'Hide' : 'Show'}</span>
                </button>
                {runwayOpen ? (
                  <div style={{ marginTop: 13 }}>
                    <RunwayStudio
                      bare
                      modes={['product_swap', 'text_to_video', 'image_to_video']}
                      theme={{
                        panel: '#1C1808', card: '#15120A',
                        line: 'rgba(255,255,255,0.07)', lineStrong: 'rgba(255,255,255,0.18)',
                        ink: LB.textPrimary, soft: LB.textSecondary, muted: LB.textMuted,
                        accent: LB.accent, onAccent: '#ffffff', good: '#4ade80', bad: '#f87171',
                        font: "'Inter', system-ui, sans-serif",
                      }}
                      prefill={{ sourceVideo: runwaySource }}
                      adoptLabel="Add to timeline"
                      onAdopt={(url: string) => { void addClip(url, url, 'Generated clip', 'broll'); }}
                    />
                  </div>
                ) : null}
              </div>

              <EffectsSidebar
                tab={fxTab}
                onTab={onFxTab}
                playhead={playhead}
                duration={duration}
                onSeek={seek}
                onCheckpoint={checkpoint}
                renderWarning={renderWarning}
                videoOverlays={doc.videoOverlays}
                selectedBrollId={selectedBrollId}
                uploadingBroll={uploadingBroll}
                onSelectBroll={setSelectedBrollId}
                onAddBrollFiles={(files) => void addBrollFiles(files)}
                onChangeBroll={changeBroll}
                onDeleteBroll={deleteBroll}
                brollModel={brollModel}
                onBrollModel={setBrollModel}
                omniPrompt={omniPrompt}
                omniGenerating={omniGenerating}
                omniProgress={omniProgress}
                omniError={omniError}
                omniNote={omniNote}
                onOmniPrompt={setOmniPrompt}
                onGenerateOmni={() => void generateOmniClip()}
                chroma={doc.chroma}
                onChroma={onChroma}
                onChromaBackgroundFile={(f) => void onChromaBackgroundFile(f)}
                clips={clips}
                selectedClips={selectedClips}
                onRamp={onRamp}
                onZoomCut={onZoomCut}
                onShake={onShake}
                vfx={doc.vfx}
                textLayerCount={doc.textLayers.length}
                onVfx={onVfx}
                captions={doc.captions}
                captionSettings={doc.captionSettings}
                captionLanguage={doc.captionLanguage}
                captionNote={captionNote}
                captionsBusy={captionsBusy || transcribing}
                hasWords={doc.words.length > 0}
                hasFootage={hasFootage}
                onGenerateCaptions={() => void generateCaptions()}
                onRebuildCaptions={buildCaptionTrack}
                onCaptionSettings={(p: Partial<CaptionSettings>) => patch((cur) => ({ ...cur, captionSettings: { ...cur.captionSettings, ...p } }))}
                onEditCue={onEditCue}
                onRetimeCue={onRetimeCue}
                onDeleteCue={onDeleteCue}
                onSplitCue={onSplitCue}
                onMergeCueUp={onMergeCueUp}
                onDownloadSrt={downloadSrt}
                musicPanel={(
                  <AiMusicPanel
                    profile={subjectProfile}
                    style={doc.musicStyle}
                    prompt={doc.musicPrompt}
                    url={doc.musicUrl}
                    variation={doc.musicVariation}
                    busy={musicBusy}
                    note={musicNote}
                    error={musicError}
                    onStyle={(style) => {
                      patch((cur) => ({ ...cur, musicStyle: style, ...(style === 'none' ? { musicUrl: '', musicPrompt: '', musicBedId: 'none' } : {}) }));
                    }}
                    onGenerate={() => void makeMusic(subjectProfile, doc.musicStyle, 1)}
                    onRegenerate={() => void makeMusic(subjectProfile, doc.musicStyle, doc.musicVariation + 1)}
                  />
                )}
                exportPanel={(
                  <ExportInspector
                    aspects={exportAspects.length ? exportAspects : [doc.aspect]}
                    resolution={doc.resolution}
                    burnIn={doc.captionSettings?.burnIn}
                    cueCount={doc.captions.length}
                    exporting={exporting}
                    progress={exportProgress}
                    etaS={exportEta}
                    stageNote={exportStage}
                    results={exportResults}
                    error={exportError}
                    onResolution={(r: ResolutionId) => {
                      patch((cur) => ({ ...cur, resolution: r }));
                      setExportSpec((spec) => ({ ...spec, resolution: r }));
                    }}
                    onExport={() => void onExport()}
                    onShare={(url: string) => void shareLink(url)}
                    onDownloadSrt={downloadSrt}
                  />
                )}
              />
              {fxTab === 'motion' ? (
                <>
                  <ReframeInspector
                    aspect={doc.aspect}
                    exportAspects={exportAspects}
                    reframe={doc.reframe}
                    sourceT={sourceT}
                    thumbUrl={thumbUrl}
                    detecting={detecting}
                    onAspect={(a) => { commit((cur) => ({ ...cur, aspect: a })); setExportAspects((list) => (list.includes(a) ? list : [a, ...list.filter((x) => x !== a)])); }}
                    onToggleExportAspect={(a) => setExportAspects((list) => (list.includes(a) ? (list.length > 1 ? list.filter((x) => x !== a) : list) : [...list, a]))}
                    onMode={(m: ReframeState['mode']) => commit((cur) => ({ ...cur, reframe: { ...cur.reframe, mode: m } }))}
                    onManual={(x, y) => patch((cur) => ({ ...cur, reframe: { ...cur.reframe, manualX: x, manualY: y } }))}
                    onDetect={() => void detectSubject()}
                    onFocusPanel={setShowFocus}
                  />
                  <ClipInspector
                    clips={clips}
                    selected={selectedClips}
                    playhead={playhead}
                    canSplit={canSplit}
                    sourceAspect={sourceAspect}
                    onAdjust={onAdjust}
                    onTrim={onTrim}
                    onOpacity={(v) => applyToSelected((c) => ({ ...c, opacity: v }))}
                    onCrop={onCrop}
                    onCropPreset={onCropPreset}
                    onCropLock={(locked) => applyToSelected((c) => ({ ...c, cropLocked: locked }))}
                    onToggleEffect={onToggleClipEffect}
                    onSplit={onSplit}
                    onDelete={onDeleteSelected}
                    onCheckpoint={checkpoint}
                  />
                </>
              ) : null}
              {fxTab === 'captions' ? (
              <TextInspector
                layers={doc.textLayers}
                selectedId={selectedTextId}
                playhead={playhead}
                depthAvailable={doc.chroma?.enabled}
                onSelect={setSelectedTextId}
                onAdd={() => {
                  const layer = newTextLayer(playheadRef.current);
                  commit((cur) => ({ ...cur, textLayers: [...cur.textLayers, layer] }));
                  setSelectedTextId(layer.id);
                }}
                onChange={(id: string, p: Partial<TextLayer>) => patch((cur) => ({ ...cur, textLayers: cur.textLayers.map((l) => (l.id === id ? { ...l, ...p } : l)) }))}
                onDelete={(id: string) => { commit((cur) => ({ ...cur, textLayers: cur.textLayers.filter((l) => l.id !== id) })); setSelectedTextId(null); }}
                onCheckpoint={checkpoint}
              />
              ) : null}
              {fxTab === 'overlays' ? (
              <OverlayInspector
                overlays={doc.overlays}
                selectedId={selectedOverlayId}
                duration={duration}
                trackingId={trackingId}
                trackingProgress={trackProgress}
                onSelect={setSelectedOverlayId}
                onAddFile={(file: File) => void addOverlayFile(file)}
                onAddWorkspaceLogo={() => addOverlayFromUrl(WORKSPACE_LOGO, 'VidVerge logo')}
                onChange={(id: string, p: Partial<Overlay>) => patch((cur) => ({ ...cur, overlays: cur.overlays.map((o) => (o.id === id ? { ...o, ...p } : o)) }))}
                onDelete={(id: string) => { commit((cur) => ({ ...cur, overlays: cur.overlays.filter((o) => o.id !== id) })); setSelectedOverlayId(null); }}
                onTrack={(id: string) => void trackOverlay(id)}
                onCheckpoint={checkpoint}
              />
              ) : null}
              {fxTab === 'vfx' ? (
              <LookInspector
                grade={doc.grade}
                globalEffects={doc.globalEffects}
                musicBedId={doc.musicBedId}
                musicBeds={MUSIC_BEDS.map((m) => ({ id: m.id, label: m.label }))}
                onGrade={(g: GradeId) => patch((cur) => ({ ...cur, grade: g }))}
                onToggleEffect={(id: VisualEffectId) => patch((cur) => ({
                  ...cur,
                  globalEffects: cur.globalEffects.includes(id) ? cur.globalEffects.filter((x) => x !== id) : [...cur.globalEffects, id],
                }))}
                onMusic={(id: string) => patch((cur) => ({ ...cur, musicBedId: id, musicUrl: '', musicStyle: 'none' }))}
                onCheckpoint={checkpoint}
              />
              ) : null}
              <StickyExportBar
                clipCount={clips.length}
                duration={duration}
                resolution={doc.resolution}
                exporting={exporting}
                onPreview={() => { seek(0); if (!playingRef.current) togglePlay(); }}
                onExport={() => setExportOpen(true)}
              />
              </div>
            </section>
          </div>
        </aside>
      </div>

      {exportOpen ? (
        <ProExport
          spec={exportSpec}
          onSpec={(p) => {
            setExportSpec((s) => ({ ...s, ...p }));
            if (p.resolution) commit((cur) => ({ ...cur, resolution: p.resolution as ResolutionId }));
          }}
          hasFootage={hasFootage}
          durationS={duration}
          busy={exporting}
          progress={exportProgress}
          stage={exportStage}
          etaS={exportEta}
          error={exportError}
          warning={[renderWarning, exportWarning].filter(Boolean).join(' · ')}
          results={proResults}
          onClose={() => setExportOpen(false)}
          onExport={() => { void runProExport(); }}
          onDownload={onProDownload}
          onShare={(url) => void shareLink(url)}
        />
      ) : null}

      {confirmClearAll ? (
        <div role="dialog" aria-modal="true" aria-label="Clear all clips" onClick={() => setConfirmClearAll(false)} style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.58)', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(390px, 92vw)', background: '#15120A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 18, boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
            <div style={{ color: VE.text, fontSize: 17, fontWeight: 800 }}>Remove every clip?</div>
            <div style={{ color: VE.textMuted, fontSize: 13, lineHeight: 1.55, marginTop: 7 }}>This takes out all your clips, cutaways and B-roll slots. You can still press Cmd+Z afterwards to bring them back.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" className="vs-btn ve-tap" onClick={() => setConfirmClearAll(false)} style={{ padding: '0 18px', minHeight: 44, borderRadius: 8, border: '1px solid rgba(180,120,0,0.14)', background: 'transparent', color: VE.textSecondary, fontSize: 14, fontWeight: 650, cursor: 'pointer' }}>Keep them</button>
              <button type="button" className="vs-btn ve-tap" onClick={clearAllClips} style={{ padding: '0 18px', minHeight: 44, borderRadius: 8, border: '1px solid rgba(153,27,27,0.45)', background: 'rgba(153,27,27,0.12)', color: '#991B1B', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Yes, clear all</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Library picker for a B-roll slot */}
      {libraryFor ? (
        <div
          onClick={() => setLibraryFor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.58)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(820px, 94vw)', maxHeight: '82vh', overflowY: 'auto', background: '#15120A', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 18 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <span style={{ color: LB.textPrimary, fontSize: 14, fontWeight: 700 }}>Pick a clip from your library</span>
              {subjectProfile ? <span style={{ color: '#B4720A', fontSize: 10.5, background: 'rgba(200,146,10,0.15)', border: '1px solid rgba(200,146,10,0.35)', borderRadius: 999, padding: '3px 8px' }}>Ranked for {subjectProfile.subjectType}</span> : null}
              <button type="button" className="vs-btn" onClick={() => setLibraryFor(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: LB.textMuted, cursor: 'pointer' }}><X size={15} /></button>
            </div>
            {libraryBusy ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: LB.textSecondary, fontSize: 12.5 }}>
                <Loader2 size={14} className="vs-spin" color={LB.accent} /> Reading the workspace clip library…
              </div>
            ) : library.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                {rankedLibrary.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="vs-btn"
                    onClick={() => void useLibraryClip(v.url)}
                    style={{ textAlign: 'left', background: '#1C1808', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 8, cursor: 'pointer' }}
                  >
                    <video src={v.url} muted preload="metadata" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 7, background: '#000' }} />
                    <div style={{ color: LB.textSecondary, fontSize: 11, marginTop: 6, lineHeight: 1.45, maxHeight: 44, overflow: 'hidden' }}>
                      {v.prompt || v.provider}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ color: LB.textMuted, fontSize: 12.5, lineHeight: 1.6 }}>
                Your workspace clip library is empty so far. Generate a cutaway from a prompt, or drop in your own clip.
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div style={{ padding: '0 16px 20px' }}>
        <VideoHistory />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <AgentChatProvider appContext={agentContext}>
        <AgentChatButton />
        <AgentChatPanel />
      </AgentChatProvider>
    </div>
  );
}

// ===========================================================================
// Crash containment + mode shell
// ===========================================================================

class VeBoundary extends Component<{ children?: ReactNode }, { error: Error | null; nonce: number }> {
  state: { error: Error | null; nonce: number } = { error: null, nonce: 0 };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) { console.error('[VideoStudio] crashed:', error, info); }
  /** Bumping the key re-mounts the children from scratch instead of re-rendering the crashed tree. */
  reset = () => { this.setState((s) => ({ error: null, nonce: s.nonce + 1 })); };
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: VE.bg, fontFamily: VE.font }}>
          <div style={{ maxWidth: 440, textAlign: 'center', background: VE.card, border: `1px solid ${VE.border}`, borderRadius: VE.radiusCard, padding: '30px 26px' }}>
            <AlertCircle size={26} color={VE.bad} style={{ margin: '0 auto 10px' }} />
            <div style={{ color: VE.text, fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
            <div style={{ color: VE.textSecondary, fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              Your project is saved. Reopen the editor and carry on from where you were.
            </div>
            <button onClick={this.reset} style={{ ...vePrimary, margin: '0 auto' }}>
              Reopen the editor
            </button>
          </div>
        </div>
      );
    }
    return <Fragment key={this.state.nonce}>{this.props.children}</Fragment>;
  }
}

const BrandedVideoEnhancer = withBrandContext(App, 'Video Enhancer');
export default BrandedVideoEnhancer;
function App() {
  return (
    // The editor fills the whole frame and runs its own scroll panes, so the
    // shell only supplies the ground and the beam layer behind it.
    <AppShell
      title="Video Studio"
      header={false}
      watermark={false}
      scroll={false}
      maxWidth="full"
      padding={0}
    >
      <VeBoundary>
        <VideoStudio />
      </VeBoundary>
    </AppShell>
  );
}
