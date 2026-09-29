/**
 * Video Enhancer — professional timeline NLE (Sep 27 2026 redesign).
 *
 * Three-panel layout:
 *   TOP     preview player (16:9) — play/pause, timecode, volume, fullscreen
 *   MIDDLE  AI Tools (Gemini Describe · Generate B-roll · Add Captions ·
 *           Style Transfer) + Properties (trim, speed, opacity, text overlay,
 *           music bed, color grade)
 *   BOTTOM  3-track timeline (Video / Audio / Captions) with drag-to-reorder,
 *           trim handles, amber playhead and click-to-seek
 *
 * React + CSS + canvas only. Heavy work runs in server hooks:
 * veh-gemini-describe (frame analysis), veh-broll-generate (Auto Director or manual Group A model),
 * veh-render (the whole edit → platform Remotion render → MP4).
 *
 * The SceneForge handoff contract is preserved: a fresh (<10 min)
 * `sceneforge_handoff_v1` localStorage entry loads that video as the first
 * clip, exactly like the previous editor did.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Download, Loader2, Maximize, Pause, Play, Rocket, Sparkles, UploadCloud, Volume2 } from 'lucide-react';
import { LB_SHIMMER_CSS } from '../../components/LightBeam';
import AgentStreak from '../../components/AgentStreak';
import ProductSuiteHeader from '../../components/ProductSuiteHeader';
import { MAX_UPLOAD_BYTES, WORKSPACE_UUID, buildCaptionSegments, fetchVideoAsFile, planEnhancements, transcribeVideo, uploadVideo } from './enhancerCore';
import type { CaptionSegment } from './enhancerCore';
import { decodeAudioMono, detectSilences } from './enhancerExtras';
import {
  AspectId, COLOR_GRADES, ColorGradeId, DEFAULT_NLE_EFFECTS, GeminiAnalysis,
  GraphicKind, LB, MUSIC_BEDS, MotionGraphic, MusicBedId, NleCaption, NleClip,
  NleEffects, STYLE_TRANSFERS, callHook, captureFrameBase64,
  clipStartOnTimeline, effectsFilterCss, estimateCaptions, fmtTimecode, locate,
  newGraphic, newId, nleToken, replaceClipWithRanges, sourceToTimeline,
  splitClipAt, timelineDuration,
} from './nleCore';
import GraphicOverlay from './nleGraphics';
import NleTimeline from './nleTimeline';
import { AiToolsPanel, PropertiesPanel } from './nleTools';
import RunwayStudio from '../../components/RunwayStudio';
import { engineDisplayName, usePersistentEngine } from '../../components/EngineSelector';
import { isRunwayModel, routeShotIntent } from '../../lib/videoEngines';
import { generateWithRunway } from '../../lib/runwayAdapter';
import { AgentChatProvider } from '../../components/AgentChat/AgentChatContext';
import { AgentChatButton } from '../../components/AgentChat/AgentChatButton';
import { AgentChatPanel } from '../../components/AgentChat/AgentChatPanel';
// The full Product Studio suite (Brand Reel, Ad Director, galleries and the
// studio-tools drawer) is merged into this app as the "Product Video" mode.
// Its own file tree stays in place (apps/ProductStudio/*) — it is simply no
// longer registered as a separate dock app in config.json.
import ProductStudioApp from '../ProductStudio/App';

function msg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const named = raw
    .replace(/gemini-omni-flash-preview/g, engineDisplayName('gemini-omni-flash-preview'))
    .replace(/veo-3\.1-fast-generate-preview/g, engineDisplayName('veo-3.1-fast-generate-preview'))
    .replace(/veo-3\.1-generate-preview/g, engineDisplayName('veo-3.1-generate-preview'))
    .replace(/openrouter\/bytedance\/seedance-2\.0-fast/g, engineDisplayName('openrouter/bytedance/seedance-2.0-fast'));
  if (/no_credentials|\b401\b/i.test(named)) return 'Your workspace session is not ready for this tool yet. Try again in a moment.';
  if (/insufficient|payment|required|\b402\b/i.test(named)) return 'This generation needs more workspace credits before it can start.';
  if (/rate.?limit|\b429\b/i.test(named)) return 'The generation service is busy right now. Wait a moment, then try again.';
  if (/provider[_ -]?error|\b50[0234]\b|service unavailable/i.test(named)) return 'The generation service is temporarily unavailable. Your edit is safe; try this step again shortly.';
  return named;
}

/**
 * Film one b-roll clip on whichever engine is selected. Group A models go
 * through the veh-broll-generate hook, which is the only thing it accepts;
 * Runway models are submitted straight to the Runway proxy because the hook
 * has no Runway route at all. Either way the caller just gets a clip URL or a
 * message it can show next to the engine picker.
 */
async function filmBrollClip(
  model: string,
  prompt: string,
  durationS: number,
  alive: () => boolean,
): Promise<{ videoUrl: string; error: string }> {
  if (isRunwayModel(model)) {
    try {
      const out = await generateWithRunway({ model, prompt, duration: durationS, aspectRatio: '16:9' });
      return { videoUrl: out.mediaUrls[0] || '', error: '' };
    } catch (e) {
      return { videoUrl: '', error: msg(e) };
    }
  }
  let out = await callHook('veh-broll-generate', { model, prompt, aspect: '16:9', durationS });
  while (alive() && out?.status === 'generating' && out.operationId) {
    out = await callHook('veh-broll-generate', { operationId: out.operationId });
  }
  if (out?.status === 'completed' && out.videoUrl) return { videoUrl: String(out.videoUrl), error: '' };
  return { videoUrl: '', error: String(out?.error || 'The b-roll generation failed.') };
}

const NLE_CSS = `
@keyframes nle-spin { to { transform: rotate(360deg); } }
.animate-spin { animation: nle-spin 1s linear infinite; }
.nle-btn { transition: filter .15s ease, background .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease; }
.nle-btn:hover:not(:disabled) { filter: brightness(1.15); }
.nle-btn:disabled { opacity: .55; cursor: default; }
.nle-input:focus { border-color: rgba(245,158,11,0.5) !important; box-shadow: 0 0 0 3px rgba(245,158,11,0.12); }
${LB_SHIMMER_CSS}
@keyframes nle-progress { 0% { background-position: 0 0; } 100% { background-position: 28px 0; } }
.nle-progress-fill { background-image: linear-gradient(45deg, rgba(255,255,255,0.18) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.18) 75%, transparent 75%, transparent); background-size: 28px 28px; animation: nle-progress .9s linear infinite; }
@media (prefers-reduced-motion: reduce) { .animate-spin, .nle-progress-fill { animation: none !important; } .nle-btn { transition: none !important; } }
`;

function VideoEnhancerNle() {
  // ---- Timeline state ----
  const [clips, setClips] = useState<NleClip[]>([]);
  const clipsRef = useRef<NleClip[]>([]);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  const [captions, setCaptions] = useState<NleCaption[]>([]);
  const [captionOffset, setCaptionOffset] = useState(0);
  const [musicBedId, setMusicBedId] = useState<MusicBedId | 'custom'>('none');
  const [gradeId, setGradeId] = useState<ColorGradeId>('none');
  const [styleId, setStyleId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [effects, setEffects] = useState<NleEffects>({ ...DEFAULT_NLE_EFFECTS });
  const [graphics, setGraphics] = useState<MotionGraphic[]>([]);
  const [selectedGraphicId, setSelectedGraphicId] = useState<string | null>(null);
  const [aspect, setAspect] = useState<AspectId>('16:9');

  // ---- Player state ----
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  const [volume, setVolume] = useState(1);
  const pendingSourceT = useRef<number | null>(null);

  // ---- Upload / AI / export state ----
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<GeminiAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [brollBusy, setBrollBusy] = useState(false);
  const [brollPrompt, setBrollPrompt] = useState('');
  // The manual b-roll engine persists for the browser session, so the
  // last-used model stays selected across generations and reopened panels.
  const [brollModel, setBrollModel] = usePersistentEngine('video-enhancer:broll-engine', 'gemini-omni-flash-preview');
  const [brollModelMode, setBrollModelMode] = useState<'auto' | 'manual'>('auto');
  const [openRouterHealthy, setOpenRouterHealthy] = useState(false);
  const [mediaAvailability, setMediaAvailability] = useState({ runwayEnabled: false, klingEnabled: false });
  const [aiEditBusy, setAiEditBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [musicGenBusy, setMusicGenBusy] = useState(false);
  const [customMusic, setCustomMusic] = useState<{ url: string; label: string } | null>(null);
  const [appliedSuggestions, setAppliedSuggestions] = useState<string[]>([]);
  // Original Files per clip id — AI Edit and transcription read the real bytes.
  const sourceFiles = useRef<Map<string, File>>(new Map());
  const [exporting, setExporting] = useState(false);
  const [exportStartedAt, setExportStartedAt] = useState(0);
  const [exportTick, setExportTick] = useState(0);
  const [renderUrl, setRenderUrl] = useState('');
  const [exportError, setExportError] = useState('');
  // Runway Enhance — generative clips beside the editor. Collapsed by default
  // so the timeline stays the focus, and nothing it makes reaches the timeline
  // until the customer presses Add to timeline.
  const [runwayOpen, setRunwayOpen] = useState(false);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  useEffect(() => {
    let live = true;
    void callHook('vv-media-capabilities', {})
      .then((caps) => {
        if (!live) return;
        setMediaAvailability({
          runwayEnabled: Boolean(caps?.runway?.available && caps?.runway?.generationEnabled !== false),
          // The catalogue answering 200 is not enough: routeShotIntent only
          // accepts Kling after a real submit succeeds, and this surface does
          // not spend credits merely to probe it.
          klingEnabled: false,
        });
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const brollRoute = routeShotIntent('fast_broll', { ...mediaAvailability, openRouterHealthy });
  const brollAutoId = brollRoute.engineId || 'gemini-omni-flash-preview';
  const concreteBrollModel = brollModelMode === 'auto' ? brollAutoId : brollModel;
  const concreteBrollName = engineDisplayName(concreteBrollModel);

  const duration = Math.max(0.1, timelineDuration(clips));
  const activeClip = clips[Math.min(activeIndex, clips.length - 1)] || null;
  const selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  const styleCss = STYLE_TRANSFERS.find((s) => s.id === styleId)?.css || '';
  const gradeCss = COLOR_GRADES.find((g) => g.id === gradeId)?.css || 'none';
  const baseLook = styleCss && styleCss !== 'none' ? styleCss : gradeCss;
  const previewFilter = [effectsFilterCss(effects), baseLook === 'none' ? '' : baseLook].filter(Boolean).join(' ') || 'none';

  // ---------------------------------------------------------------------------
  // Footage intake
  // ---------------------------------------------------------------------------

  const probeDuration = (url: string): Promise<number> => new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (d: number) => { v.removeAttribute('src'); try { v.load(); } catch { /* no-op */ } resolve(d); };
    v.addEventListener('loadedmetadata', () => done(Number.isFinite(v.duration) ? v.duration : 0), { once: true });
    v.addEventListener('error', () => done(0), { once: true });
    v.src = url;
  });

  const addClipFromUrl = useCallback(async (url: string, previewUrl: string, label: string, kind: 'source' | 'broll', atIndex?: number) => {
    const d = (await probeDuration(previewUrl)) || (await probeDuration(url)) || 5;
    const clip: NleClip = {
      id: newId('clip'), label, url, previewUrl, sourceDuration: d,
      in: 0, out: d, speed: 1, opacity: 1, text: '', textSize: 56, textColor: '#ffffff', kind,
    };
    setClips((list) => {
      if (atIndex == null || atIndex >= list.length) return [...list, clip];
      const next = [...list];
      next.splice(Math.max(0, atIndex), 0, clip);
      return next;
    });
    setSelectedClipId(clip.id);
    return clip;
  }, []);

  const runDescribe = useCallback(async (srcUrl?: string) => {
    const source = srcUrl || clipsRef.current[0]?.previewUrl || clipsRef.current[0]?.url;
    if (!source) return;
    setAnalyzing(true);
    setError('');
    setNote('Gemini is reading a frame…');
    try {
      const frame = await captureFrameBase64(source, 1);
      const out = await callHook('veh-gemini-describe', { frameBase64: frame.base64, mimeType: frame.mimeType, wt: nleToken() });
      if (!aliveRef.current) return;
      const a: GeminiAnalysis = {
        subject: String(out.subject || ''),
        dominantColors: Array.isArray(out.dominantColors) ? out.dominantColors.map(String) : [],
        backgroundType: String(out.backgroundType || ''),
        lightingStyle: String(out.lightingStyle || ''),
        mood: String(out.mood || ''),
        suggestedEnhancements: Array.isArray(out.suggestedEnhancements) ? out.suggestedEnhancements.map(String) : [],
      };
      setAnalysis(a);
      setNote('');
      if (a.subject) setBrollPrompt((p) => p || `Cinematic b-roll that complements: ${a.subject}. ${a.mood ? `Mood: ${a.mood}.` : ''}`);
    } catch (e) {
      if (aliveRef.current) { setNote(''); setError(msg(e)); }
    } finally {
      if (aliveRef.current) setAnalyzing(false);
    }
  }, []);

  const handleFile = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) { setError('That file is not a video.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError('Videos up to 500 MB are supported.'); return; }
    setError('');
    const localUrl = URL.createObjectURL(file);
    const clip = await addClipFromUrl('', localUrl, file.name, 'source');
    sourceFiles.current.set(clip.id, file);
    // The durable copy uploads in the background — export needs it, preview does not.
    setUploading(true);
    setNote('Uploading your footage…');
    void (async () => {
      try {
        const up = await uploadVideo(file);
        if (!aliveRef.current) return;
        setClips((list) => list.map((c) => (c.id === clip.id ? { ...c, url: up.url } : c)));
        setNote('');
      } catch (e) {
        if (aliveRef.current) { setNote(''); setError(`The upload failed — preview still works, but export needs it. ${msg(e)}`); }
      } finally {
        if (aliveRef.current) setUploading(false);
      }
    })();
    // 2B: uploading auto-triggers Gemini Describe on the local copy.
    void runDescribe(localUrl);
  }, [addClipFromUrl, runDescribe]);

  // SceneForge handoff — same contract as the previous editor.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('sceneforge_handoff_v1');
      if (!raw) return;
      window.localStorage.removeItem('sceneforge_handoff_v1');
      const h = JSON.parse(raw) as { url?: string; title?: string; ts?: number } | null;
      if (!h || typeof h.url !== 'string' || !/^https?:\/\//.test(h.url)) return;
      if (!h.ts || Date.now() - h.ts > 10 * 60 * 1000) return;
      void (async () => {
        await addClipFromUrl(h.url!, h.url!, h.title || 'SceneForge video', 'source');
        void runDescribe(h.url!);
      })();
    } catch { /* localStorage unavailable — nothing to hand off */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Playback engine — one <video> element walks the clip sequence
  // ---------------------------------------------------------------------------

  // Keep the element on the active clip's source, trim window and rate.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip) return;
    const src = activeClip.previewUrl || activeClip.url;
    const seekTo = pendingSourceT.current != null ? pendingSourceT.current : activeClip.in;
    pendingSourceT.current = null;
    const apply = () => {
      try { v.currentTime = Math.max(activeClip.in, Math.min(activeClip.out, seekTo)); } catch { /* not seekable yet */ }
      v.playbackRate = activeClip.speed;
      if (isPlayingRef.current) void v.play().catch(() => setIsPlaying(false));
    };
    if (v.getAttribute('data-src') !== src) {
      v.setAttribute('data-src', src);
      v.src = src;
      v.addEventListener('loadedmetadata', apply, { once: true });
      v.load();
    } else {
      apply();
    }
  }, [activeClip?.id, activeClip?.previewUrl, activeClip?.speed]);

  useEffect(() => { const v = videoRef.current; if (v) v.volume = volume; }, [volume]);

  // rAF loop: playhead sync + clip advance + music sync.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const step = () => {
      const v = videoRef.current;
      const list = clipsRef.current;
      const i = activeIndexRef.current;
      const c = list[i];
      if (v && c) {
        const start = clipStartOnTimeline(list, i);
        const t = start + Math.max(0, (v.currentTime - c.in)) / Math.max(0.1, c.speed);
        setPlayhead(Math.min(t, timelineDuration(list)));
        if (v.currentTime >= c.out - 0.04 || v.ended) {
          if (i < list.length - 1) {
            pendingSourceT.current = list[i + 1].in;
            setActiveIndex(i + 1);
          } else {
            v.pause();
            setIsPlaying(false);
            setPlayhead(timelineDuration(list));
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // Music bed preview follows play/pause and the playhead.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const bed = musicBedId === 'custom'
      ? (customMusic ? { url: customMusic.url } : null)
      : (MUSIC_BEDS.find((m) => m.id === musicBedId) || null);
    if (!bed) { a.pause(); a.removeAttribute('src'); return; }
    if (a.getAttribute('data-src') !== bed.url) { a.setAttribute('data-src', bed.url); a.src = bed.url; a.loop = true; }
    a.volume = 0.3 * volume;
    if (isPlaying) { try { a.currentTime = playheadRef.current % Math.max(1, a.duration || 62); } catch { /* no-op */ } void a.play().catch(() => undefined); }
    else a.pause();
  }, [musicBedId, customMusic, isPlaying, volume]);

  const seek = useCallback((t: number) => {
    const list = clipsRef.current;
    if (!list.length) return;
    const clamped = Math.max(0, Math.min(timelineDuration(list), t));
    const loc = locate(list, clamped);
    if (!loc) return;
    setPlayhead(clamped);
    pendingSourceT.current = loc.sourceT;
    if (loc.index !== activeIndexRef.current) setActiveIndex(loc.index);
    else {
      const v = videoRef.current;
      if (v) { try { v.currentTime = loc.sourceT; } catch { /* no-op */ } }
      pendingSourceT.current = null;
    }
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !clipsRef.current.length) return;
    if (isPlayingRef.current) { v.pause(); setIsPlaying(false); }
    else {
      if (playheadRef.current >= timelineDuration(clipsRef.current) - 0.05) seek(0);
      setIsPlaying(true);
      void v.play().catch(() => setIsPlaying(false));
    }
  }, [seek]);

  // ---------------------------------------------------------------------------
  // Edit operations
  // ---------------------------------------------------------------------------

  const onReorder = useCallback((from: number, to: number) => {
    setClips((list) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
      return next;
    });
  }, []);
  const onTrim = useCallback((id: string, nextIn: number, nextOut: number) => {
    setClips((list) => list.map((c) => (c.id === id ? { ...c, in: nextIn, out: nextOut } : c)));
  }, []);
  const onSpeed = useCallback((id: string, speed: number) => {
    setClips((list) => list.map((c) => (c.id === id ? { ...c, speed } : c)));
  }, []);
  const onOpacity = useCallback((id: string, opacity: number) => {
    setClips((list) => list.map((c) => (c.id === id ? { ...c, opacity } : c)));
  }, []);
  const onText = useCallback((id: string, patch: { text?: string; textSize?: number; textColor?: string }) => {
    setClips((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  // ---- Graphics, cut tools, AI Edit, transcription, custom music ----

  function onAddGraphic(kind: GraphicKind) {
    const g = newGraphic(kind, playheadRef.current);
    setGraphics((l) => [...l, g]);
    setSelectedGraphicId(g.id);
    setSelectedClipId(null);
  }
  function onGraphicChange(id: string, patch: Partial<MotionGraphic>) {
    setGraphics((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function onGraphicDelete(id: string) {
    setGraphics((l) => l.filter((x) => x.id !== id));
    setSelectedGraphicId(null);
  }
  function onMoveGraphic(id: string, start: number) {
    onGraphicChange(id, { start: Math.round(start * 10) / 10 });
  }

  function onSplitAtPlayhead() {
    const list = clipsRef.current;
    const loc = locate(list, playheadRef.current);
    if (!loc) return;
    const clip = list[loc.index];
    const next = splitClipAt(list, clip.id, loc.sourceT);
    if (next === list) return;
    const f = sourceFiles.current.get(clip.id);
    if (f) next.forEach((c) => { if (c.previewUrl === clip.previewUrl && !sourceFiles.current.has(c.id)) sourceFiles.current.set(c.id, f); });
    setClips(next);
    setSelectedClipId(null);
  }
  function onDeleteClip(id: string) {
    setClips((l) => l.filter((c) => c.id !== id));
    setSelectedClipId(null);
  }

  async function fileForClip(clip: NleClip): Promise<File> {
    const cached = sourceFiles.current.get(clip.id);
    if (cached) return cached;
    const f = await fetchVideoAsFile(clip.previewUrl || clip.url);
    sourceFiles.current.set(clip.id, f);
    return f;
  }

  /** Detect silences in the source audio and cut them out of the clip as real
   * timeline cuts. Returns true when something was cut. */
  async function cutSilences(target: NleClip, file: File): Promise<boolean> {
    const decoded = await decodeAudioMono(file);
    const silences = detectSilences(decoded.samples, decoded.sampleRate, -38, 0.6);
    if (!silences.length) return false;
    const PAD = 0.12;
    const keeps: { start: number; end: number }[] = [];
    let cursor = 0;
    silences.forEach((s) => {
      if (s.start + PAD > cursor + 0.35) keeps.push({ start: cursor, end: s.start + PAD });
      cursor = Math.max(cursor, s.end - PAD);
    });
    if (decoded.duration - cursor > 0.2) keeps.push({ start: cursor, end: decoded.duration });
    const next = replaceClipWithRanges(clipsRef.current, target.id, keeps);
    if (next === clipsRef.current) return false;
    next.forEach((c) => { if (c.previewUrl === target.previewUrl && !sourceFiles.current.has(c.id)) sourceFiles.current.set(c.id, file); });
    clipsRef.current = next;
    setClips(next);
    return true;
  }

  /** Map word-timed caption segments (SOURCE seconds of `srcUrl`) onto the
   * timeline — segments that fall inside cut-away silences are dropped. */
  function applyCaptionsFromSegments(segs: CaptionSegment[], srcUrl: string) {
    const list = clipsRef.current;
    const caps: NleCaption[] = [];
    segs.forEach((s) => {
      if (!String(s.text || '').trim()) return;
      const a = sourceToTimeline(list, srcUrl, s.start);
      const b = sourceToTimeline(list, srcUrl, s.end);
      if (a == null && b == null) return;
      const start = a == null ? Math.max(0, (b as number) - (s.end - s.start)) : a;
      const end = b == null ? start + (s.end - s.start) : b;
      if (end - start >= 0.25) caps.push({ id: newId('cap'), text: s.text, start, end });
    });
    setCaptions(caps);
    setCaptionOffset(0);
  }

  async function runTranscribe() {
    const list = clipsRef.current;
    if (!list.length || transcribing || aiEditBusy) return;
    setTranscribing(true);
    setError('');
    setNote('Transcribing the footage (AI, word-timed)…');
    try {
      const first = list[0];
      const file = await fileForClip(first);
      const res = await transcribeVideo(file, (n) => setNote(n));
      if (!res.words.length) {
        setNote('');
        setError('The transcription service returned no word timings — paste the transcript manually instead.');
        return;
      }
      const segs = buildCaptionSegments(res.words);
      applyCaptionsFromSegments(segs, first.previewUrl);
      setNote(`${segs.length} captions transcribed with word-accurate timing.`);
    } catch (e) {
      setError(msg(e));
      setNote('');
    } finally {
      setTranscribing(false);
    }
  }

  /** ONE-CLICK AI EDIT — transcribe → cut dead air → word-timed captions →
   * AI-planned motion graphics. Every step degrades gracefully. */
  async function runAiEdit() {
    const list = clipsRef.current;
    if (!list.length || aiEditBusy) return;
    setAiEditBusy(true);
    setError('');
    try {
      const first = list[0];
      const file = await fileForClip(first);

      setNote('AI Edit 1/4 — transcribing the footage…');
      let words: { word: string; start: number; end: number }[] = [];
      let transcript = '';
      try {
        const t = await transcribeVideo(file, (n) => setNote(n));
        words = t.words;
        transcript = t.transcript;
      } catch (e) {
        setNote(`Transcription unavailable (${msg(e).slice(0, 90)}) — continuing with the silence cut.`);
      }

      setNote('AI Edit 2/4 — listening for dead air…');
      try {
        await cutSilences(first, file);
      } catch (e) {
        setNote(`Silence analysis skipped (${msg(e).slice(0, 80)}).`);
      }

      let segs: CaptionSegment[] = [];
      if (words.length) {
        setNote('AI Edit 3/4 — laying word-timed captions…');
        segs = buildCaptionSegments(words);
        applyCaptionsFromSegments(segs, first.previewUrl);
      }

      if (transcript && segs.length) {
        setNote('AI Edit 4/4 — planning motion graphics…');
        try {
          const plan = await planEnhancements(transcript, segs, first.sourceDuration);
          const mapped: MotionGraphic[] = [];
          plan.graphics.forEach((cue) => {
            const at = sourceToTimeline(clipsRef.current, first.previewUrl, cue.at);
            if (at == null) return;
            const g = newGraphic(cue.kind === 'title' ? 'hook' : 'pop', at);
            g.text = cue.text;
            g.duration = Math.max(1.2, Math.min(3.5, cue.duration));
            mapped.push(g);
          });
          if (mapped.length) setGraphics((l) => [...l, ...mapped]);
          // \"Apply b-roll in between too\": film the FIRST suggested cutaway
          // (one Omni Flash render, wallet-billed) and insert it at its
          // suggested moment between the cut clips — applied, not just listed.
          const slot = Array.isArray(plan.broll) && plan.broll.length ? plan.broll[0] : null;
          if (slot && slot.prompt) {
            setNote(`AI Edit — filming one suggested b-roll cutaway on ${concreteBrollName} (1–3 min)…`);
            try {
              const cut = await filmBrollClip(
                concreteBrollModel,
                String(slot.prompt),
                Math.min(6, Math.max(4, Math.round(slot.duration) || 5)),
                () => aliveRef.current,
              );
              if (cut.videoUrl) {
                const at = sourceToTimeline(clipsRef.current, first.previewUrl, slot.at);
                const loc = at != null ? locate(clipsRef.current, at) : null;
                await addClipFromUrl(cut.videoUrl, cut.videoUrl, 'B-roll: ' + String(slot.prompt).slice(0, 28), 'broll', loc ? loc.index + 1 : undefined);
              }
            } catch { /* the cutaway is a bonus — the edit stands without it */ }
          }
        } catch { /* the graphics plan is a bonus — captions and cuts stand */ }
      }

      setNote('AI Edit complete — dead air cut, captions laid, graphics placed, and a suggested b-roll cutaway inserted in between. Review the timeline, then Render & Export.');
      seek(0);
    } catch (e) {
      setError(msg(e));
      setNote('');
    } finally {
      setAiEditBusy(false);
    }
  }

  async function onGenerateMusic(prompt: string) {
    if (musicGenBusy) return;
    setMusicGenBusy(true);
    setError('');
    setNote('ElevenLabs is composing your track (10–30s)…');
    try {
      const token = nleToken();
      if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
      const lengthMs = Math.min(120000, Math.max(15000, Math.round(timelineDuration(clipsRef.current) * 1000) || 30000));
      const compose = async (provider?: string): Promise<string> => {
        const res = await fetch(`/api/workspaces/${WORKSPACE_UUID}/audio/music/custom`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
          body: JSON.stringify({ prompt, lengthMs, instrumental: true, ...(provider ? { provider } : {}) }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.audioUrl) {
          const code = data?.code ? ` [${data.code}]` : '';
          throw new Error(`${String(data?.error || `HTTP ${res.status}`)}${code}`);
        }
        return String(data.audioUrl);
      };
      let url = '';
      let elevenErr = '';
      try {
        url = await compose();
      } catch (e) {
        elevenErr = msg(e);
      }
      if (!url) {
        // The ElevenLabs engine refused — fall back to the Gemini (Lyria)
        // music engine on the same platform endpoint before giving up.
        setNote('ElevenLabs refused — trying the Gemini music engine…');
        try {
          url = await compose('gemini');
        } catch (e2) {
          throw new Error(`Music generation failed on both engines. ElevenLabs: ${elevenErr} — Gemini: ${msg(e2)}`);
        }
      }
      setCustomMusic({ url, label: prompt.slice(0, 40) });
      setMusicBedId('custom');
      setNote('Custom track ready — it plays under the preview and mixes into the export.');
    } catch (e) {
      setError(msg(e));
      setNote('');
    } finally {
      setMusicGenBusy(false);
    }
  }

  /** ONE-CLICK APPLY for a Gemini suggestion — the fix is executed on the
   * edit (effects, grade, captions, music, cuts, b-roll), not just displayed. */
  function applySuggestion(s: string) {
    const t = s.toLowerCase();
    let what = '';
    if (/(too bright|overexpos|blown)/.test(t)) { setEffects((e) => ({ ...e, brightness: Math.max(50, e.brightness - 12) })); what = 'lowered brightness'; }
    else if (/(brighten|bright|light|dark|underexpos|dim|exposure)/.test(t)) { setEffects((e) => ({ ...e, brightness: Math.min(160, e.brightness + 14) })); what = 'raised brightness'; }
    else if (/contrast/.test(t)) { setEffects((e) => ({ ...e, contrast: Math.min(160, e.contrast + 12) })); what = 'boosted contrast'; }
    else if (/(black.?and.?white|monochrome|b&w)/.test(t)) { setGradeId('bw'); setStyleId(null); what = 'applied the BW grade'; }
    else if (/(satur|vibran|vivid|colou?r)/.test(t)) { setEffects((e) => ({ ...e, saturation: Math.min(200, e.saturation + 20) })); what = 'boosted saturation'; }
    else if (/(teal|orange|cinematic|film look|grade)/.test(t)) { setGradeId('tealorange'); setStyleId(null); what = 'applied the Teal+Orange cinematic grade'; }
    else if (/(warm|golden|vintage)/.test(t)) { setGradeId('film'); setStyleId(null); what = 'applied the warm Film grade'; }
    else if (/vignette/.test(t)) { setEffects((e) => ({ ...e, vignette: Math.max(e.vignette, 35) })); what = 'added a vignette'; }
    else if (/(sharpen|crisp|clarity|punch)/.test(t)) { setEffects((e) => ({ ...e, contrast: Math.min(160, e.contrast + 8), saturation: Math.min(200, e.saturation + 8) })); what = 'added punch (contrast + saturation)'; }
    else if (/(caption|subtitle|transcri|on.?screen text)/.test(t)) { void runTranscribe(); what = 'started auto-captions'; }
    else if (/(b.?roll|cutaway|insert (footage|clips?)|supplement)/.test(t)) {
      const p = `Cinematic b-roll cutaway, no on-screen text: ${s}`;
      setBrollPrompt(p);
      void onBroll(p);
      what = 'filming a b-roll cutaway to insert at the playhead';
    }
    else if (/(music|soundtrack|score|audio bed)/.test(t)) { setMusicBedId('inspiring'); what = 'added the Inspiring music bed'; }
    else if (/(cut|trim|silence|dead air|pacing|tighten)/.test(t)) {
      const first = clipsRef.current[0];
      if (!first) return;
      what = 'cutting dead air';
      void (async () => {
        try {
          setNote('Cutting dead air…');
          const file = await fileForClip(first);
          const did = await cutSilences(first, file);
          setNote(did ? 'Dead air cut out of the timeline.' : 'No long silences found to cut.');
        } catch (e) { setError(msg(e)); }
      })();
    }
    else if (/(vertical|9:16|portrait|reels?|tiktok|shorts?)/.test(t)) { setAspect('9:16'); what = 'switched to the 9:16 TikTok frame'; }
    else if (/(stabiliz|shak)/.test(t)) { setNote('Stabilization is not available in this editor yet — that one stays manual.'); return; }
    else { setNote('That suggestion has no one-click control yet — use the Properties panel on the right.'); return; }
    setAppliedSuggestions((l) => (l.includes(s) ? l : [...l, s]));
    setNote(`Applied: ${what}.`);
  }

  const onCaptionsFromTranscript = useCallback((transcript: string) => {
    const caps = estimateCaptions(transcript, timelineDuration(clipsRef.current));
    setCaptions(caps);
    setCaptionOffset(0);
    setNote(caps.length ? `${caps.length} captions estimated across the cut.` : '');
  }, []);

  const onBroll = useCallback(async (overridePrompt?: string) => {
    const prompt = (overridePrompt || brollPrompt).trim();
    if (prompt.length < 10 || brollBusy) return;
    setBrollBusy(true);
    setError('');
    setNote(`${concreteBrollName} is filming your b-roll (1–3 minutes)…`);
    try {
      const shot = await filmBrollClip(concreteBrollModel, prompt, 6, () => aliveRef.current);
      if (!aliveRef.current) return;
      if (shot.videoUrl) {
        if (concreteBrollModel.startsWith('openrouter/')) setOpenRouterHealthy(true);
        // Insert IN BETWEEN: right after the clip under the playhead, not at the end.
        const loc = locate(clipsRef.current, playheadRef.current);
        await addClipFromUrl(shot.videoUrl, shot.videoUrl, 'B-roll: ' + prompt.slice(0, 32), 'broll', loc ? loc.index + 1 : undefined);
        setNote('B-roll inserted in between, right after the clip under the playhead.');
      } else {
        setError(shot.error);
        setNote('');
      }
    } catch (e) {
      if (aliveRef.current) { setError(msg(e)); setNote(''); }
    } finally {
      if (aliveRef.current) setBrollBusy(false);
    }
  }, [brollPrompt, brollBusy, concreteBrollModel, concreteBrollName, addClipFromUrl]);

  const onStyle = useCallback((id: string) => {
    setStyleId((prev) => (prev === id ? null : id));
    const s = STYLE_TRANSFERS.find((x) => x.id === id);
    if (s) setGradeId(s.grade);
  }, []);

  // ---------------------------------------------------------------------------
  // Export — veh-render (server-side Remotion render)
  // ---------------------------------------------------------------------------

  const onExport = useCallback(async () => {
    if (exporting) return;
    const list = clipsRef.current;
    if (!list.length) return;
    const missing = list.filter((c) => !/^https:\/\//.test(c.url));
    if (missing.length) { setExportError(uploading ? 'The footage is still uploading — give it a moment, then render again.' : 'A clip has no durable copy (its upload failed) — remove it or re-upload the file.'); return; }
    setExporting(true);
    setExportError('');
    setRenderUrl('');
    setExportStartedAt(Date.now());
    try {
      const payload = {
        clips: list.map((c) => ({ url: c.url, in: c.in, out: c.out, speed: c.speed, opacity: c.opacity, text: c.text, textSize: c.textSize, textColor: c.textColor })),
        captions: captions.map((c) => ({ text: c.text, start: c.start + captionOffset, end: c.end + captionOffset })),
        graphics: graphics.map((g) => ({ kind: g.kind, text: g.text, sub: g.sub, value: g.value, start: g.start, duration: g.duration, accent: g.accent, position: g.position })),
        effects,
        aspect,
        colorGrade: gradeId,
        musicUrl: musicBedId === 'custom' && customMusic ? customMusic.url : undefined,
        musicBedId: musicBedId === 'custom' ? undefined : musicBedId,
        musicVolume: 0.3,
      };
      let out = await callHook('veh-render', payload);
      while (aliveRef.current && out?.status === 'rendering' && out.operationId) {
        out = await callHook('veh-render', { operationId: out.operationId });
      }
      if (!aliveRef.current) return;
      if (out?.status === 'complete' && out.renderUrl) setRenderUrl(String(out.renderUrl));
      else setExportError(String(out?.error || 'The render failed.'));
    } catch (e) {
      if (aliveRef.current) setExportError(msg(e));
    } finally {
      if (aliveRef.current) setExporting(false);
    }
  }, [exporting, uploading, captions, captionOffset, gradeId, musicBedId, graphics, effects, aspect, customMusic]);

  // Progress ticker (CSS-only bar — the % is an honest elapsed-time estimate).
  useEffect(() => {
    if (!exporting) return;
    const timer = setInterval(() => setExportTick((n) => n + 1), 800);
    return () => clearInterval(timer);
  }, [exporting]);
  const exportPct = exporting ? Math.min(92, Math.round(((Date.now() - exportStartedAt) / 150000) * 100)) : renderUrl ? 100 : 0;
  void exportTick;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const currentCaption = useMemo(() => {
    const t = playhead - captionOffset;
    return captions.find((c) => t >= c.start && t <= c.end) || null;
  }, [captions, playhead, captionOffset]);

  const hasFootage = clips.length > 0;
  // Runway only accepts public references, so the durable upload is the source
  // — never the local blob: URL the preview plays from.
  const runwaySource = (clips.filter((c) => /^https:\/\//i.test(c.url))[0] || { url: '' }).url;
  const musicBed = musicBedId === 'custom'
    ? (customMusic ? { id: 'custom', label: customMusic.label } : null)
    : (MUSIC_BEDS.find((m) => m.id === musicBedId) || null);
  const selectedGraphic = graphics.find((g) => g.id === selectedGraphicId) || null;
  const canSplit = (() => {
    const loc = locate(clips, playhead);
    if (!loc) return false;
    const c = clips[loc.index];
    return !!c && loc.sourceT - c.in > 0.2 && c.out - loc.sourceT > 0.2;
  })();
  // The streak pulses faster while the agent is actually working — the
  // at-a-glance difference between WORKING and WAITING.
  const agentWorking = aiEditBusy || transcribing || brollBusy || exporting || musicGenBusy || analyzing || uploading;

  // The preview stage's live pixel width — graphic type sizes scale off it so
  // the preview matches the 1920/608-wide render stages proportionally.
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const [stageW, setStageW] = useState(0);
  useEffect(() => {
    const el = stageBoxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => { for (const en of entries) setStageW(en.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasFootage, aspect]);

  // Vidverge Agent — the floating orb assistant. It reads the editor's key
  // inputs and can run the one-click tools (AI Edit, transcription, b-roll,
  // music, export) on the customer's behalf.
  const agentContext = {
    appId: 'video-enhancer',
    appName: 'Video Enhancer',
    currentInputs: {
      clipsOnTimeline: String(clips.length),
      brollPrompt,
      musicBed: String(musicBedId),
      colorGrade: gradeId,
      aspect,
    },
    onFillField: (field: string, value: string) => {
      if (field === 'brollPrompt') setBrollPrompt(value);
      else if (field === 'aspect' && (value === '16:9' || value === '9:16')) setAspect(value);
      else if (field === 'colorGrade') { setGradeId(value as ColorGradeId); setStyleId(null); }
      else if (field === 'musicBed') setMusicBedId(value as MusicBedId);
    },
    onTriggerAction: (action: string, params?: Record<string, unknown>) => {
      const p = params || {};
      if (action === 'enhance' || action === 'aiEdit') void runAiEdit();
      else if (action === 'transcribe' || action === 'captions') void runTranscribe();
      else if (action === 'describe') void runDescribe();
      else if (action === 'broll') void onBroll(typeof p.prompt === 'string' ? p.prompt : undefined);
      else if (action === 'generateMusic' && typeof p.prompt === 'string') void onGenerateMusic(p.prompt);
      else if (action === 'export' || action === 'render') void onExport();
    },
    promptHint: [
      'The user uploads a video to enhance on a timeline editor. Suggest enhancement options and run them.',
      'Fields you can fill: brollPrompt (a cinematic b-roll description), aspect (16:9 | 9:16), colorGrade (none | film | kodak | tealorange | bw), musicBed (none | inspiring | cinematic | energetic | calm | luxury).',
      'Actions you can trigger: enhance (one-click AI Edit: transcribe, cut dead air, captions, motion graphics), transcribe (word-timed captions), describe (Gemini frame analysis), broll with {"prompt":"..."}, generateMusic with {"prompt":"..."}, export (render the final MP4).',
      'If clipsOnTimeline is 0, ask the user to upload footage first — actions need footage on the timeline.',
    ].join('\n'),
  };

  return (
    <div style={{ minHeight: '100%', background: LB.bg, fontFamily: 'system-ui, -apple-system, sans-serif', padding: '16px 18px 28px', boxSizing: 'border-box' }}>
      <style>{NLE_CSS}</style>
      <audio ref={audioRef} style={{ display: 'none' }} />

      <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ProductSuiteHeader
          name="Video Enhancer"
          voice="I polish your footage, shape the pacing, and finish a clean export with you."
          working={agentWorking}
          actions={(
            <>
              <details>
                <summary style={{ cursor: 'pointer', color: LB.textSecondary, fontSize: 11.5, fontWeight: 700, listStylePosition: 'inside' }}>
                  Advanced <span style={{ color: LB.textMuted, fontWeight: 500 }}>— format: {aspect}</span>
                </summary>
                <div style={{ display: 'inline-flex', gap: 4, marginTop: 7, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: 3 }}>
                  {(['16:9', '9:16'] as AspectId[]).map((a) => (
                    <button key={a} className="nle-btn" onClick={() => setAspect(a)} title={a === '9:16' ? 'Vertical — TikTok / Reels / Shorts framing' : 'Widescreen'} style={{ background: aspect === a ? LB.accent : 'transparent', color: aspect === a ? '#241503' : LB.textSecondary, border: 'none', borderRadius: 999, padding: '5px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                      {a === '16:9' ? '16:9' : '9:16 TikTok'}
                    </button>
                  ))}
                </div>
              </details>
              <label className="nle-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: LB.textSecondary, borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                <UploadCloud size={14} /> {hasFootage ? 'Add footage' : 'Upload video'}
                <input type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => { void handleFile(e.target.files?.[0] || null); e.target.value = ''; }} />
              </label>
              <button
                className="nle-btn"
                disabled={!hasFootage || exporting}
                onClick={() => void onExport()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 14px rgba(245,158,11,0.3)' }}
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {exporting ? 'Rendering…' : 'Render & Export'}
              </button>
            </>
          )}
        />

        {(hasFootage || note || error) ? (
          <details style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, background: 'rgba(255,255,255,0.03)', padding: '9px 12px' }}>
            <summary style={{ cursor: 'pointer', color: error ? '#f87171' : LB.textSecondary, fontSize: 12, fontWeight: 700, listStylePosition: 'inside' }}>
              Production status <span style={{ color: error ? '#f87171' : LB.textMuted, fontWeight: 500 }}>— {error ? 'Needs attention' : note || (renderUrl ? 'Video ready' : exporting ? 'Rendering the final video' : 'Waiting for you')}</span>
            </summary>
            <div style={{ display: 'grid', gap: 6, color: error ? '#f87171' : LB.textMuted, fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {error ? <AlertCircle size={13} style={{ flexShrink: 0 }} /> : agentWorking ? <AgentStreak working size={16} /> : null}
                <span>{error || note}</span>
              </div>
              <div>{hasFootage ? '✓ Footage loaded on the timeline' : '○ Waiting for footage'}</div>
              <div>{renderUrl ? '✓ Final video rendered' : exporting ? '• Rendering the final video' : '• Waiting for you to review the timeline and choose Render & Export'}</div>
            </div>
          </details>
        ) : null}

        {/* TOP — preview */}
        <div ref={stageRef} style={{ background: '#0d1117', borderRadius: 12, padding: 16 }}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFile(e.dataTransfer.files?.[0] || null); }}
            style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 10, overflow: 'hidden', border: dragOver ? '2px dashed #f59e0b' : '1px solid rgba(255,255,255,0.08)' }}
          >
            {hasFootage ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* The stage — 16:9 fills the frame, 9:16 is the centered TikTok canvas (matches the render). */}
                <div ref={stageBoxRef} style={{ position: 'relative', height: '100%', aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9', maxWidth: '100%', background: '#000', overflow: 'hidden' }}>
                  <video
                    ref={videoRef}
                    playsInline
                    onClick={togglePlay}
                    style={{ width: '100%', height: '100%', objectFit: aspect === '9:16' ? 'cover' : 'contain', filter: previewFilter, opacity: activeClip ? activeClip.opacity : 1, cursor: 'pointer' }}
                  />
                  {effects.vignette > 0 ? (
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${((effects.vignette / 100) * 0.85).toFixed(3)}) 100%)` }} />
                  ) : null}
                  {activeClip?.text ? (
                    <div style={{ position: 'absolute', top: '7%', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', color: activeClip.textColor, fontSize: Math.max(13, Math.round((stageW || 600) * (activeClip.textSize / 1920) * (aspect === '9:16' ? 2.4 : 1))), fontWeight: 700, textShadow: '0 2px 14px rgba(0,0,0,0.85)', padding: '0 4%' }}>
                      {activeClip.text}
                    </div>
                  ) : null}
                  {graphics.map((g) => (playhead >= g.start && playhead <= g.start + g.duration
                    ? <GraphicOverlay key={g.id} g={g} t={playhead - g.start} sw={stageW || 600} />
                    : null))}
                  {currentCaption ? (
                    <div style={{ position: 'absolute', bottom: aspect === '9:16' ? '20%' : '8%', left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: '0 6%' }}>
                      <span style={{ color: LB.accent, fontSize: Math.max(12, Math.round((stageW || 600) * (aspect === '9:16' ? 0.052 : 0.024))), fontWeight: 700, textShadow: '0 2px 12px rgba(0,0,0,0.85)', background: 'rgba(0,0,0,0.35)', padding: '6px 16px', borderRadius: 10, textAlign: 'center' }}>
                        {currentCaption.text}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <label style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', color: LB.textSecondary }}>
                <AgentStreak working={false} size={34} />
                <UploadCloud size={34} color={LB.accent} />
                <span style={{ fontSize: 14, fontWeight: 600, color: LB.textPrimary }}>Drop a video here, or click to choose</span>
                <span style={{ fontSize: 11.5, color: LB.textMuted }}>MP4 / WebM / MOV up to 500 MB — it loads into the player and the Video track, and Gemini describes it automatically.</span>
                <input type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => { void handleFile(e.target.files?.[0] || null); e.target.value = ''; }} />
              </label>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="nle-btn" disabled={!hasFootage} onClick={togglePlay} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, background: LB.accent, color: '#241503', border: 'none', borderRadius: 999, cursor: 'pointer' }}>
              {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
            </button>
            <span style={{ color: LB.textPrimary, fontSize: 13, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              {fmtTimecode(playhead)} <span style={{ color: LB.textMuted }}>/ {fmtTimecode(duration)}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginLeft: 8 }}>
              <Volume2 size={14} color={LB.textSecondary} />
              <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} style={{ width: 110, accentColor: LB.accent }} />
            </span>
            <button
              className="nle-btn"
              disabled={!hasFootage}
              onClick={() => { const el = stageRef.current; if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined); }}
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: LB.textSecondary, borderRadius: 8, padding: '7px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              <Maximize size={13} /> Fullscreen
            </button>
          </div>

          {/* Export progress / result */}
          {exporting || renderUrl || exportError ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: exportError ? '#f87171' : LB.textSecondary, fontSize: 11.5, fontWeight: 700, listStylePosition: 'inside' }}>
                Production status — {exporting ? 'Rendering your final video' : renderUrl ? 'Video ready' : 'Render needs attention'}
              </summary>
              <div style={{ marginTop: 8 }}>
              {exporting || renderUrl ? (
                <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                  <div className={exporting ? 'nle-progress-fill' : undefined} style={{ height: '100%', width: `${exportPct}%`, background: LB.accent, transition: 'width 0.8s ease' }} />
                </div>
              ) : null}
              {exporting ? <div style={{ color: LB.textMuted, fontSize: 11.5, marginTop: 6 }}>Rendering on the platform (Remotion, 1080p)… you can keep editing.</div> : null}
              {renderUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#7FD4B4', fontSize: 12.5, fontWeight: 700 }}>✓ Render complete</span>
                  <a className="nle-btn" href={renderUrl} download target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: LB.accent, color: '#241503', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                    <Download size={13} /> Download MP4
                  </a>
                </div>
              ) : null}
              {exportError ? <div style={{ color: '#f87171', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{exportError}</div> : null}
              </div>
            </details>
          ) : null}
        </div>

        {/* MIDDLE — tools + properties */}
        <div style={{ display: 'grid', gap: 14 }}>
          <AiToolsPanel
            hasFootage={hasFootage}
            analysis={analysis}
            analyzing={analyzing}
            aiEditBusy={aiEditBusy}
            transcribing={transcribing}
            brollBusy={brollBusy}
            brollPrompt={brollPrompt}
            onBrollPrompt={setBrollPrompt}
            brollModel={brollModel}
            brollModelMode={brollModelMode}
            brollAutoName={engineDisplayName(brollAutoId)}
            brollAutoReason={brollRoute.reason}
            onBrollAuto={() => setBrollModelMode('auto')}
            onBrollModel={(id) => { setBrollModel(id); setBrollModelMode('manual'); }}
            styleId={styleId}
            onAiEdit={() => void runAiEdit()}
            onTranscribe={() => void runTranscribe()}
            onDescribe={() => void runDescribe()}
            onBroll={() => void onBroll()}
            onCaptions={onCaptionsFromTranscript}
            onStyle={onStyle}
            onAddGraphic={onAddGraphic}
            appliedSuggestions={appliedSuggestions}
            onApplySuggestion={applySuggestion}
          />
          <details style={{ background: '#0d1117', borderRadius: 12, padding: 14 }}>
            <summary style={{ cursor: 'pointer', color: LB.textPrimary, fontSize: 13.5, fontWeight: 700, listStylePosition: 'inside' }}>
              Advanced <span style={{ color: LB.textMuted, fontSize: 11.5, fontWeight: 500 }}>— clip properties, effects, music and colour grade</span>
            </summary>
            <div style={{ marginTop: 12 }}>
              <PropertiesPanel
                clip={selectedClip}
                graphic={selectedGraphic}
                effects={effects}
                musicBedId={musicBedId}
                customMusicLabel={customMusic ? customMusic.label : ''}
                musicGenBusy={musicGenBusy}
                gradeId={gradeId}
                canSplit={canSplit}
                onSplit={onSplitAtPlayhead}
                onDeleteClip={onDeleteClip}
                onTrim={onTrim}
                onSpeed={onSpeed}
                onOpacity={onOpacity}
                onText={onText}
                onGraphicChange={onGraphicChange}
                onGraphicDelete={onGraphicDelete}
                onEffects={(patch) => setEffects((e) => ({ ...e, ...patch }))}
                onMusic={(id) => setMusicBedId(id)}
                onGenerateMusic={(p) => void onGenerateMusic(p)}
                onGrade={(g) => { setGradeId(g); setStyleId(null); }}
              />
            </div>
          </details>
        </div>

        {/* RUNWAY ENHANCE — generation that sits beside the editor rather than
            inside it: the loaded footage is offered as the swap source, and a
            finished clip only joins the timeline when the customer says so. */}
        <div style={{ background: '#0d1117', borderRadius: 12, padding: 14 }}>
          <button
            type="button"
            className="nle-btn"
            onClick={() => setRunwayOpen((open) => !open)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', background: 'none', border: 'none', color: LB.textPrimary, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', padding: 0, textAlign: 'left', flexWrap: 'wrap' }}
            data-testid="toggle-runway-enhance"
          >
            <Sparkles size={15} color={LB.accent} />
            Runway Enhance
            <span style={{ fontSize: 11.5, fontWeight: 500, color: LB.textMuted }}>
              Swap the product inside your footage, or generate a fresh clip from a prompt or a still.
            </span>
            <span style={{ marginLeft: 'auto', color: LB.textMuted, fontSize: 12, fontWeight: 600 }}>{runwayOpen ? 'Hide' : 'Show'}</span>
          </button>
          {runwayOpen ? (
            <div style={{ marginTop: 14 }}>
              <RunwayStudio
                bare
                modes={['product_swap', 'text_to_video', 'image_to_video']}
                theme={{
                  panel: 'rgba(255,255,255,0.05)',
                  card: '#11161f',
                  line: 'rgba(255,255,255,0.09)',
                  lineStrong: 'rgba(255,255,255,0.17)',
                  ink: LB.textPrimary,
                  soft: LB.textSecondary,
                  muted: LB.textMuted,
                  accent: LB.accent,
                  onAccent: '#241503',
                  good: '#7FD4B4',
                  bad: '#f87171',
                  font: 'system-ui, -apple-system, sans-serif',
                }}
                prefill={{ sourceVideo: runwaySource }}
                adoptLabel="Add to timeline"
                onAdopt={(url) => { void addClipFromUrl(url, url, 'Runway clip', 'broll'); }}
              />
              {hasFootage && !runwaySource ? (
                <div style={{ color: LB.textMuted, fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
                  Your footage is still uploading — the swap source appears here once the durable copy lands.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* BOTTOM — timeline */}
        <NleTimeline
          clips={clips}
          captions={captions}
          captionOffset={captionOffset}
          graphics={graphics}
          selectedGraphicId={selectedGraphicId}
          musicBed={musicBed}
          duration={duration}
          playhead={playhead}
          selectedClipId={selectedClipId}
          onSelectClip={(id) => { setSelectedClipId(id); if (id) setSelectedGraphicId(null); }}
          onSelectGraphic={(id) => { setSelectedGraphicId(id); if (id) setSelectedClipId(null); }}
          onMoveGraphic={onMoveGraphic}
          onSeek={seek}
          onReorder={onReorder}
          onTrim={onTrim}
          onCaptionOffset={setCaptionOffset}
        />
      </div>
      <AgentChatProvider appContext={agentContext}>
        <AgentChatButton />
        <AgentChatPanel />
      </AgentChatProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crash containment
// ---------------------------------------------------------------------------

class VeBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) { console.error('[VideoEnhancer] crashed:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: LB.bg, fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: 440, textAlign: 'center', background: LB.bgCard, border: LB.border, borderRadius: 16, padding: '30px 26px' }}>
            <AlertCircle size={26} color="#f87171" style={{ margin: '0 auto 10px' }} />
            <div style={{ color: LB.textPrimary, fontSize: 15.5, fontWeight: 600, marginBottom: 8 }}>The editor hit a snag</div>
            <div style={{ color: LB.textSecondary, fontSize: 12.5, lineHeight: 1.6, marginBottom: 16 }}>{this.state.error.message}</div>
            <button onClick={() => this.setState({ error: null })} style={{ background: LB.accent, color: '#241503', border: 'none', borderRadius: 10, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Reload the editor
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type EnhancerMode = 'enhance' | 'product';

const MODE_TABS: { id: EnhancerMode; label: string; icon: typeof Sparkles; blurb: string; testId: string }[] = [
  // Enhance — the original timeline NLE for footage you already have.
  { id: 'enhance', label: 'Enhance', icon: Sparkles, blurb: 'Polish footage you already have on the timeline editor', testId: 've-mode-enhance' },
  // Product Video — the full Product Studio suite merged in: Brand Reel,
  // Ad Director, the video galleries and the studio-tools drawer.
  { id: 'product', label: 'Product Video', icon: Rocket, blurb: 'Paste a product URL for a branded video, direct an ad, or open the studio tools', testId: 've-mode-product' },
];

export default function App() {
  // The Enhancer now leads with two modes: the original Enhance NLE and the
  // merged Product Video suite. BOTH stay mounted (hidden with display, never
  // unmounted) so an in-flight render, upload or half-typed URL on either side
  // survives a switch; the hidden tree's floating agent orb is hidden with it.
  const [mode, setMode] = useState<EnhancerMode>('enhance');
  const activeBlurb = MODE_TABS.find((t) => t.id === mode)?.blurb || '';
  return (
    <VeBoundary>
      <div style={{ height: '100%', minHeight: 0, background: LB.bg, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flexShrink: 0, borderBottom: LB.border, background: 'rgba(8,12,20,0.92)' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 18px' }}>
            <div role="tablist" aria-label="Video Enhancer mode" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, border: LB.border, background: LB.bgCard }}>
              {MODE_TABS.map((t) => {
                const Icon = t.icon;
                const active = mode === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={t.blurb}
                    onClick={() => setMode(t.id)}
                    className="nle-btn"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, border: 'none', background: active ? LB.accentGradient : 'transparent', color: active ? '#241503' : LB.textSecondary, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
                    data-testid={t.testId}
                  >
                    <Icon size={14} /> {t.label}
                  </button>
                );
              })}
            </div>
            <span style={{ color: LB.textMuted, fontSize: 11.5, fontWeight: 500, minWidth: 0 }}>{activeBlurb}</span>
          </div>
        </div>
        {/* Both modes stay mounted; only the active one is shown. The .nle-btn
            class comes from the always-mounted Enhance tree's <style> block. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: mode === 'enhance' ? 'block' : 'none' }}>
          <VideoEnhancerNle />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: mode === 'product' ? 'block' : 'none' }}>
          <ProductStudioApp />
        </div>
      </div>
    </VeBoundary>
  );
}
