// The SceneForge Motion Graphics Editor.
//
// It opens on a finished HeyGen avatar MP4 and never asks for another render
// of it: the master is the base layer, and everything the customer adds lives
// above it as a timed layer. The preview is a real player with a real
// playhead; the export hands the compiled layer stack to the platform's
// server-side compositor and brings back one verified MP4.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Download, Film, Loader2, Play, RefreshCw, Save, Sparkles, Wand2 } from 'lucide-react';
import Timeline, { type TimelineTrack } from './Timeline';
import LayerPanel, { TRACK_TINTS } from './LayerPanel';
import HyperFrameCard from './HyperFrameCard';
import CaptionEditor from './CaptionEditor';
import { uploadFile } from '../lib/proxy';
import { renderCard } from '../lib/hyperFrames';
import {
  ENTRANCE_SEC,
  FRAME,
  brandKitFromWorkspace,
  defaultManifest,
  entranceProgress,
  exitProgress,
  formatClock,
  isLive,
  loadJob,
  manifestLayerCount,
  newBrandLayer,
  newCaptionSegment,
  newCardLayer,
  newImageLayer,
  newTextLayer,
  relativeSaved,
  saveJob,
  type AspectRatio,
  type BrandKind,
  type BrandLayer,
  type CaptionStyle,
  type CardLayer,
  type ColorGrade,
  type EditManifest,
  type EditorJob,
  type ImageLayer,
  type MusicLayer,
  type Pacing,
  type RenderJob,
  type TextKind,
  type TextLayer,
} from '../lib/motionEditor';
import {
  GOOGLE_FONTS_IMPORT,
  atmosphereOf,
  buildCinematicLayers,
  isCinematicLayerId,
  overlaySpecJson,
  presetOf,
  type CinematicSpec,
  type MotionPresetId,
} from '../lib/motionPresets';
import {
  MAX_EXPORT_OVERLAYS,
  captionsFromWords,
  compileRenderPlan,
  generateMusicBed,
  pollExport,
  rehostBase,
  startExport,
  suggestOverlayCopy,
  transcribeBaseAudio,
  type PlanProgress,
} from '../lib/editorRender';

export interface MotionEditorSource {
  videoId: string;
  videoUrl: string;
  posterUrl?: string;
  aspectRatio: AspectRatio;
  script?: string;
  avatarId?: string;
  avatarName?: string;
  voiceId?: string;
  voiceName?: string;
  title?: string;
  /** The product brief, used only to seed AI copy suggestions. */
  brief?: string;
}

type ExportPhase = 'idle' | 'compiling' | 'rendering' | 'done' | 'failed';

const AUTOSAVE_MS = 2500;

function animatedStyle(anim: string, progressIn: number, progressOut: number): { opacity: number; transform: string; clipPath?: string } {
  const fade = Math.min(progressIn, 1 - progressOut * 0.9);
  // A reveal is a MOVING EDGE rather than a fade, and the inset percentages
  // below are the same geometry motionPlates clips the canvas with, so what
  // is scrubbed here is what the exported MP4 burns in.
  if (anim === 'clip-reveal') {
    return { opacity: progressOut > 0.95 ? 0 : 1 - progressOut * 0.9, transform: 'translate(-50%, -50%)', clipPath: `inset(0 ${(1 - progressIn) * 100}% 0 0)` };
  }
  if (anim === 'mask-wipe') {
    return { opacity: progressOut > 0.95 ? 0 : 1 - progressOut * 0.9, transform: 'translate(-50%, -50%)', clipPath: `inset(${(1 - progressIn) * 100}% 0 0 0)` };
  }
  if (anim === 'slide-up') return { opacity: fade, transform: `translate(-50%, calc(-50% + ${(1 - progressIn) * 24}px))` };
  if (anim === 'pop') return { opacity: fade, transform: `translate(-50%, -50%) scale(${0.82 + 0.18 * progressIn})` };
  if (anim === 'none') return { opacity: progressOut > 0.95 ? 0 : 1, transform: 'translate(-50%, -50%)' };
  return { opacity: fade, transform: 'translate(-50%, -50%)' };
}

/** A rendered card clip plays only while the playhead sits inside its window. */
function CardClip({ card, live, fit }: { card: CardLayer; live: boolean; fit: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(card.clipUrl);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (live) void element.play().catch(() => { /* a blocked autoplay still shows the frame */ });
    else { element.pause(); element.currentTime = 0; }
  }, [live]);
  if (!isVideo) return <img src={card.clipUrl} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: fit as any }} />;
  return <video ref={ref} src={card.clipUrl} muted playsInline className="absolute inset-0 h-full w-full" style={{ objectFit: fit as any }} />;
}

export default function MotionEditor(props: {
  source: MotionEditorSource;
  onClose: () => void;
  /** Supplied by Avatar Studio so an expired HeyGen link can be renewed. */
  onRefreshLink?: (videoId: string, staleUrl: string) => Promise<string>;
}) {
  const { source } = props;
  const kit = useMemo(() => brandKitFromWorkspace(), []);
  const [job, setJob] = useState<EditorJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [baseUrl, setBaseUrl] = useState(source.videoUrl);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState('base');
  const [frameWidth, setFrameWidth] = useState(0);
  const [cardModal, setCardModal] = useState<{ open: boolean; cardId: string }>({ open: false, cardId: '' });
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [busy, setBusy] = useState({ copy: false, music: false, captions: false, card: false, rehost: false });
  const [notes, setNotes] = useState({ copy: '', music: '', captions: '', card: '' });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle');
  const [planProgress, setPlanProgress] = useState<PlanProgress | null>(null);
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [exportError, setExportError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const dirty = useRef(false);
  const jobRef = useRef<EditorJob | null>(null);

  useEffect(() => { jobRef.current = job; }, [job]);

  // ——— Load any saved layer stack for this video ———
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadJob({
      videoId: source.videoId,
      baseVideoUrl: source.videoUrl,
      posterUrl: source.posterUrl,
      aspectRatio: source.aspectRatio,
      script: source.script,
      avatarId: source.avatarId,
      avatarName: source.avatarName,
      voiceId: source.voiceId,
      voiceName: source.voiceName,
      title: source.title,
    }, kit)
      .then((loaded) => {
        if (cancelled) return;
        setJob(loaded);
        if (loaded.durationSec) setDuration(loaded.durationSec);
        if (loaded.baseVideoUrl) setBaseUrl(loaded.baseVideoUrl);
        setRenderJob(loaded.renderJob);
        if (loaded.renderJob && (loaded.renderJob.status === 'running' || loaded.renderJob.status === 'pending')) setExportPhase('rendering');
        else if (loaded.finalVideoUrl) setExportPhase('done');
      })
      .catch((e: any) => { if (!cancelled) setLoadError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source, kit]);

  // ——— Stage measurement, so the preview and the exported plate agree ———
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => setFrameWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading]);

  // ——— Playback clock ———
  // requestAnimationFrame rather than `timeupdate`: the browser fires that
  // event about four times a second, which makes a scrub look like it stutters
  // and makes an entrance animation jump.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const element = videoRef.current;
      if (element) setCurrentTime(element.currentTime);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback((seconds: number) => {
    const element = videoRef.current;
    const target = Math.max(0, Math.min(duration || seconds, seconds));
    if (element) element.currentTime = target;
    setCurrentTime(target);
  }, [duration]);

  const togglePlay = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }, []);

  // ——— Manifest edits ———
  const touch = useCallback(() => { dirty.current = true; }, []);
  const patchManifest = useCallback((change: (manifest: EditManifest) => EditManifest) => {
    setJob((current) => (current ? { ...current, manifest: change(current.manifest) } : current));
    touch();
  }, [touch]);

  const patchText = useCallback((id: string, patch: Partial<TextLayer>) => {
    patchManifest((manifest) => ({ ...manifest, text: manifest.text.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) }));
  }, [patchManifest]);
  const patchBrand = useCallback((id: string, patch: Partial<BrandLayer>) => {
    patchManifest((manifest) => ({ ...manifest, brand: manifest.brand.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) }));
  }, [patchManifest]);
  const patchImage = useCallback((id: string, patch: Partial<ImageLayer>) => {
    patchManifest((manifest) => ({ ...manifest, images: manifest.images.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) }));
  }, [patchManifest]);
  const patchCard = useCallback((id: string, patch: Partial<CardLayer>) => {
    patchManifest((manifest) => ({ ...manifest, cards: manifest.cards.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) }));
  }, [patchManifest]);
  const patchMusic = useCallback((patch: Partial<MusicLayer>) => {
    patchManifest((manifest) => ({ ...manifest, music: { ...manifest.music, ...patch } }));
  }, [patchManifest]);
  const patchCaptionStyle = useCallback((patch: Partial<CaptionStyle>) => {
    patchManifest((manifest) => ({ ...manifest, captionStyle: { ...manifest.captionStyle, ...patch } }));
  }, [patchManifest]);
  const patchDirectives = useCallback((patch: { colorGrade?: ColorGrade; pacing?: Pacing }) => {
    patchManifest((manifest) => ({ ...manifest, directives: { ...manifest.directives, ...patch } }));
  }, [patchManifest]);

  // ——— The cinematic story block ———
  //
  // The five copy fields are not a second rendering path. They COMPILE into
  // ordinary text and brand layers, so the timeline, the preview and the
  // exporter all keep working on exactly one model.
  //
  // Every element the compiler owns carries a deterministic `cine-` id, so a
  // recompile replaces its OWN previous output and never touches a layer the
  // customer added by hand — which is what makes the fields live-editable
  // instead of stacking a duplicate title on every keystroke.
  const applyCinematic = useCallback((next: CinematicSpec) => {
    const current = jobRef.current;
    const brandKit = current?.brandKit || kit;
    const film = duration || current?.durationSec || 0;
    const built = buildCinematicLayers(next, brandKit, film);
    patchManifest((manifest) => ({
      ...manifest,
      cinematic: next,
      text: [...manifest.text.filter((layer) => !isCinematicLayerId(layer.id)), ...(next.enabled ? built.text : [])],
      brand: [...manifest.brand.filter((layer) => !isCinematicLayerId(layer.id)), ...(next.enabled ? built.brand : [])],
    }));
  }, [duration, kit, patchManifest]);

  const patchCinematic = useCallback((patch: Partial<CinematicSpec>) => {
    const current = jobRef.current?.manifest.cinematic;
    if (!current) return;
    applyCinematic({ ...current, ...patch });
  }, [applyCinematic]);

  const choosePreset = useCallback((id: MotionPresetId) => {
    const current = jobRef.current?.manifest.cinematic;
    if (!current) return;
    // A preset brings its own accent, but only when the customer has not
    // already chosen one: switching looks must never silently discard a
    // brand colour they set on purpose.
    const previous = presetOf(current.preset);
    const next = presetOf(id);
    const customAccent = Boolean(current.accent) && current.accent.toLowerCase() !== previous.accent.toLowerCase();
    applyCinematic({ ...current, preset: id, accent: customAccent ? current.accent : next.accent, enabled: true });
  }, [applyCinematic]);

  // The schedule is derived from the film's own length, which is unknown
  // until the master's metadata loads. Recompiling once it lands corrects a
  // title that was placed against a guessed duration, instead of leaving it
  // mistimed for the whole session.
  const recompiledFor = useRef(-1);
  useEffect(() => {
    const spec = jobRef.current?.manifest.cinematic;
    if (!spec?.enabled || !duration) return;
    if (Math.abs(recompiledFor.current - duration) < 0.05) return;
    recompiledFor.current = duration;
    applyCinematic(spec);
  }, [duration, applyCinematic]);

  /**
   * The overlay spec, as a file. Otto's brief allows the export to be “the
   * MP4 plus an overlay spec JSON”; this is that file, and it is also the
   * exact record of what the compositor was asked to burn in, which is worth
   * having when a render needs to be explained after the fact.
   */
  const downloadOverlaySpec = useCallback(() => {
    const current = jobRef.current;
    if (!current) return;
    const json = overlaySpecJson(current.manifest.cinematic, current.brandKit, duration || current.durationSec, current.aspectRatio);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sceneforge-overlays-${current.videoId || 'master'}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 20000);
  }, [duration]);

  // One timeline drag edits exactly the collection the clip belongs to, so a
  // move never fires four state updates for one gesture.
  const changeClip = useCallback((id: string, patch: { start?: number; duration?: number }) => {
    const manifest = jobRef.current?.manifest;
    if (!manifest || id === 'base' || id === 'captions' || id === 'music') return;
    if (manifest.text.some((layer) => layer.id === id)) patchText(id, patch as Partial<TextLayer>);
    else if (manifest.brand.some((layer) => layer.id === id)) patchBrand(id, patch as Partial<BrandLayer>);
    else if (manifest.images.some((layer) => layer.id === id)) patchImage(id, patch as Partial<ImageLayer>);
    else if (manifest.cards.some((layer) => layer.id === id)) patchCard(id, patch as Partial<CardLayer>);
  }, [patchText, patchBrand, patchImage, patchCard]);

  const toggleHidden = useCallback((id: string) => {
    patchManifest((manifest) => ({
      ...manifest,
      text: manifest.text.map((layer) => (layer.id === id ? { ...layer, hidden: !layer.hidden } : layer)),
      brand: manifest.brand.map((layer) => (layer.id === id ? { ...layer, hidden: !layer.hidden } : layer)),
      images: manifest.images.map((layer) => (layer.id === id ? { ...layer, hidden: !layer.hidden } : layer)),
      cards: manifest.cards.map((layer) => (layer.id === id ? { ...layer, hidden: !layer.hidden } : layer)),
    }));
  }, [patchManifest]);

  const removeLayer = useCallback((id: string) => {
    patchManifest((manifest) => ({
      ...manifest,
      text: manifest.text.filter((layer) => layer.id !== id),
      brand: manifest.brand.filter((layer) => layer.id !== id),
      images: manifest.images.filter((layer) => layer.id !== id),
      cards: manifest.cards.filter((layer) => layer.id !== id),
    }));
    setSelectedId((current) => (current === id ? 'base' : current));
  }, [patchManifest]);

  const addText = useCallback((kind: TextKind) => {
    const layer = newTextLayer(kind, kit, Math.round(currentTime * 10) / 10);
    patchManifest((manifest) => ({ ...manifest, text: [...manifest.text, layer] }));
    setSelectedId(layer.id);
  }, [currentTime, kit, patchManifest]);

  const addBrand = useCallback((kind: BrandKind) => {
    const length = kind === 'logo' ? Math.max(2, duration || 6) : 4;
    const layer = newBrandLayer(kind, kit, kind === 'logo' ? 0 : Math.round(currentTime * 10) / 10, length);
    patchManifest((manifest) => ({ ...manifest, brand: [...manifest.brand, layer] }));
    setSelectedId(layer.id);
  }, [currentTime, duration, kit, patchManifest]);

  async function addImageFile(file: File) {
    try {
      const stored = await uploadFile(file, 'sceneforge-v2/motion-editor/overlays');
      const layer = newImageLayer(stored.url, file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40), Math.round(currentTime * 10) / 10);
      patchManifest((manifest) => ({ ...manifest, images: [...manifest.images, layer] }));
      setSelectedId(layer.id);
    } catch (e: any) {
      setNotes((old) => ({ ...old, copy: `That image could not be uploaded: ${String(e?.message || e)}` }));
    }
  }

  async function uploadLogo(layerId: string, file: File) {
    try {
      const stored = await uploadFile(file, 'sceneforge-v2/motion-editor/logos');
      patchBrand(layerId, { logoUrl: stored.url });
    } catch (e: any) {
      setNotes((old) => ({ ...old, copy: `That logo could not be uploaded: ${String(e?.message || e)}` }));
    }
  }

  async function uploadMusic(file: File) {
    setBusy((old) => ({ ...old, music: true }));
    try {
      const stored = await uploadFile(file, 'sceneforge-v2/motion-editor/music');
      patchMusic({ enabled: true, url: stored.url, prompt: `Uploaded: ${file.name}` });
      setNotes((old) => ({ ...old, music: 'Your track is attached to the music layer.' }));
    } catch (e: any) {
      setNotes((old) => ({ ...old, music: `That audio could not be uploaded: ${String(e?.message || e)}` }));
    } finally { setBusy((old) => ({ ...old, music: false })); }
  }

  // ——— AI copy, music, captions ———
  async function suggestCopy() {
    if (!job) return;
    setBusy((old) => ({ ...old, copy: true }));
    setNotes((old) => ({ ...old, copy: '' }));
    try {
      const suggestion = await suggestOverlayCopy(job.script || '', source.brief || '');
      const at = Math.round(currentTime * 10) / 10;
      const added: TextLayer[] = [];
      if (suggestion.headline) added.push({ ...newTextLayer('headline', kit, at), text: suggestion.headline });
      if (suggestion.subheadline) added.push({ ...newTextLayer('subheadline', kit, at + 0.3), text: suggestion.subheadline });
      if (suggestion.caption) added.push({ ...newTextLayer('caption-box', kit, Math.max(at, Math.max(0, (duration || 10) - 4))), text: suggestion.caption });
      if (!added.length) throw new Error('The assistant returned no usable copy.');
      patchManifest((manifest) => ({ ...manifest, text: [...manifest.text, ...added] }));
      setSelectedId(added[0].id);
      setNotes((old) => ({ ...old, copy: 'Three text layers were added at the playhead — edit any of them.' }));
    } catch (e: any) {
      setNotes((old) => ({ ...old, copy: String(e?.message || e) }));
    } finally { setBusy((old) => ({ ...old, copy: false })); }
  }

  async function makeMusic() {
    if (!job) return;
    setBusy((old) => ({ ...old, music: true }));
    setNotes((old) => ({ ...old, music: '' }));
    try {
      const prompt = job.manifest.music.prompt
        || `instrumental underscore for a short vertical video about ${(job.script || source.brief || 'this product').slice(0, 140)}, warm and unobtrusive, no vocals, sits beneath a spoken voiceover`;
      const result = await generateMusicBed(prompt, Math.max(8, duration || 20));
      patchMusic({ enabled: true, url: result.url, prompt, durationMs: result.durationMs });
      setNotes((old) => ({
        ...old,
        music: job.aspectRatio === '9:16'
          ? 'Bed ready. A 9:16 export keeps the presenter\u2019s own audio, so this track is delivered alongside the MP4 rather than mixed in; a 16:9 export mixes it under the voice.'
          : 'Bed ready. The 16:9 export mixes it under the voice and ducks it while the presenter speaks.',
      }));
    } catch (e: any) {
      setNotes((old) => ({ ...old, music: String(e?.message || e) }));
    } finally { setBusy((old) => ({ ...old, music: false })); }
  }

  async function makeCaptions() {
    if (!job) return;
    setBusy((old) => ({ ...old, captions: true }));
    setNotes((old) => ({ ...old, captions: '' }));
    try {
      const transcript = await transcribeBaseAudio(baseUrl);
      if (!transcript.words.length) throw new Error('The transcription came back with no word timings, so no caption segments were created.');
      const segments = await captionsFromWords(transcript.words, job.manifest.captionStyle.maxCharsPerLine, job.videoId);
      if (!segments.length) throw new Error('No caption segments could be built from the transcription.');
      setJob((current) => (current ? { ...current, captions: segments } : current));
      patchCaptionStyle({ enabled: true });
      setNotes((old) => ({ ...old, captions: `${segments.length} caption segments from the presenter\u2019s audio. Open Edit to fix any wording.` }));
      setCaptionsOpen(true);
    } catch (e: any) {
      setNotes((old) => ({ ...old, captions: String(e?.message || e) }));
    } finally { setBusy((old) => ({ ...old, captions: false })); }
  }

  async function reHost() {
    if (!job) return;
    setBusy((old) => ({ ...old, rehost: true }));
    try {
      const url = await rehostBase(job);
      if (url) {
        setBaseUrl(url);
        setJob((current) => (current ? { ...current, baseVideoUrl: url } : current));
        setNotes((old) => ({ ...old, captions: 'The master is now on workspace storage. Try the captions again.' }));
      }
    } catch (e: any) {
      setNotes((old) => ({ ...old, captions: `The master could not be re-hosted: ${String(e?.message || e)}` }));
    } finally { setBusy((old) => ({ ...old, rehost: false })); }
  }

  // ——— Cards ———
  async function submitCard(input: { template: CardLayer['template']; variables: Record<string, string>; start: number; duration: number; placement: 'overlay' | 'insert' }) {
    if (!job) return;
    setBusy((old) => ({ ...old, card: true }));
    setNotes((old) => ({ ...old, card: '' }));
    try {
      const result = await renderCard(input.template, input.variables, job.brandKit, job.aspectRatio, input.duration);
      const existing = cardModal.cardId;
      if (existing) {
        patchCard(existing, { template: input.template, variables: input.variables, start: input.start, duration: input.duration, placement: input.placement, clipUrl: result.clipUrl, renderedBy: result.renderedBy, renderError: '' });
        setSelectedId(existing);
      } else {
        const layer: CardLayer = { ...newCardLayer(input.template, input.variables, input.start, input.duration), placement: input.placement, clipUrl: result.clipUrl, renderedBy: result.renderedBy };
        patchManifest((manifest) => ({ ...manifest, cards: [...manifest.cards, layer] }));
        setSelectedId(layer.id);
      }
      setCardModal({ open: false, cardId: '' });
      if (result.note) setNotes((old) => ({ ...old, card: result.note }));
    } catch (e: any) {
      setNotes((old) => ({ ...old, card: String(e?.message || e) }));
    } finally { setBusy((old) => ({ ...old, card: false })); }
  }

  // ——— Save / resume ———
  const persist = useCallback(async () => {
    const current = jobRef.current;
    if (!current) return;
    setSaveState('saving');
    setSaveError('');
    try {
      const result = await saveJob({ ...current, durationSec: duration || current.durationSec, baseVideoUrl: baseUrl || current.baseVideoUrl });
      dirty.current = false;
      setJob((latest) => (latest ? { ...latest, rowId: result.rowId ?? latest.rowId, lastSavedAt: result.savedAt } : latest));
      setSaveState('idle');
    } catch (e: any) {
      setSaveState('error');
      setSaveError(String(e?.message || e));
    }
  }, [baseUrl, duration]);

  useEffect(() => {
    if (loading || !job) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (!dirty.current) return;
    saveTimer.current = window.setTimeout(() => { void persist(); }, AUTOSAVE_MS);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [job, loading, persist]);

  // ——— Export ———
  async function exportFinal() {
    if (!job) return;
    setExportError('');
    setWarnings([]);
    setExportPhase('compiling');
    setPlanProgress(null);
    try {
      if (dirty.current) await persist();
      const current = { ...(jobRef.current as EditorJob), durationSec: duration, baseVideoUrl: baseUrl };
      const plan = await compileRenderPlan(current, setPlanProgress);
      setWarnings(plan.warnings);
      if (!plan.overlays.length && !plan.inserts.length) {
        // Exporting the untouched master is a legitimate outcome: the editor
        // must not demand layers the customer does not want.
        setNotes((old) => ({ ...old, card: 'No layers to composite — the export will re-deliver the master as a verified MP4.' }));
      }
      setExportPhase('rendering');
      const render = await startExport(current, plan);
      setRenderJob(render);
      if (render.status === 'complete') { setExportPhase('done'); setJob((latest) => (latest ? { ...latest, finalVideoUrl: render.videoUrl || '' } : latest)); }
      else if (render.status === 'failed') { setExportPhase('failed'); setExportError(render.error || 'The export failed.'); }
    } catch (e: any) {
      setExportPhase('failed');
      setExportError(String(e?.message || e));
    }
  }

  useEffect(() => {
    if (exportPhase !== 'rendering' || !job) return;
    let stopped = false;
    const tick = async () => {
      try {
        const render = await pollExport(job);
        if (stopped) return;
        setRenderJob(render);
        if (render.status === 'complete') {
          setExportPhase('done');
          setJob((latest) => (latest ? { ...latest, finalVideoUrl: render.videoUrl || '' } : latest));
        } else if (render.status === 'failed') {
          setExportPhase('failed');
          setExportError(render.error || 'The export failed.');
        }
      } catch { /* a dropped poll is retried on the next tick */ }
    };
    const timer = window.setInterval(() => void tick(), 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [exportPhase, job]);

  const manifest = job?.manifest || defaultManifest(kit);
  const atmosphere = atmosphereOf(manifest.cinematic);
  const captions = job?.captions || [];
  const frame = FRAME[job?.aspectRatio || source.aspectRatio];
  const scale = frameWidth > 0 ? frameWidth / frame.w : 0;
  const activeCaption = manifest.captionStyle.enabled ? captions.find((segment) => currentTime >= segment.start && currentTime <= segment.end) : undefined;

  const tracks: TimelineTrack[] = [
    { id: 'base', label: 'Base video', color: TRACK_TINTS.base, clips: [{ id: 'base', label: source.title || 'HeyGen master', start: 0, duration: Math.max(0.2, duration), locked: true }] },
    { id: 'text', label: 'Text', color: TRACK_TINTS.text, clips: manifest.text.map((layer) => ({ id: layer.id, label: layer.text || 'Text', start: layer.start, duration: layer.duration, hidden: layer.hidden })) },
    { id: 'brand', label: 'Brand', color: TRACK_TINTS.brand, clips: manifest.brand.map((layer) => ({ id: layer.id, label: layer.kind === 'lower-third' ? layer.name || 'Lower third' : layer.kind, start: layer.start, duration: layer.duration, hidden: layer.hidden })) },
    { id: 'image', label: 'Images', color: TRACK_TINTS.image, clips: manifest.images.map((layer) => ({ id: layer.id, label: layer.label || 'Image', start: layer.start, duration: layer.duration, hidden: layer.hidden })) },
    { id: 'card', label: 'Cards', color: TRACK_TINTS.card, clips: manifest.cards.map((layer) => ({ id: layer.id, label: String(layer.variables.title || layer.variables.value || layer.variables.quote || 'Card'), start: layer.start, duration: layer.duration, hidden: layer.hidden })) },
    { id: 'caption', label: 'Captions', color: TRACK_TINTS.caption, clips: manifest.captionStyle.enabled ? captions.slice(0, 200).map((segment) => ({ id: segment.id, label: segment.text, start: segment.start, duration: Math.max(0.2, segment.end - segment.start), locked: true })) : [] },
    { id: 'music', label: 'Music', color: TRACK_TINTS.music, clips: manifest.music.enabled && manifest.music.url ? [{ id: 'music', label: 'Music bed', start: 0, duration: Math.max(0.2, duration), locked: true }] : [] },
  ];

  const layerCount = manifestLayerCount(manifest, captions);
  const portrait = (job?.aspectRatio || source.aspectRatio) === '9:16';

  return <div className="sfme absolute inset-0 z-40 flex flex-col bg-[#070b14] text-[var(--space-text-primary)]">
    <style>{`
      ${GOOGLE_FONTS_IMPORT}
      @keyframes sfme-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      /* Film grain. The layer is oversized and moved with transform rather
         than redrawn, so the shimmer costs the compositor a matrix and not a
         repaint; the texture itself is one SVG turbulence tile. */
      @keyframes sfme-grain {
        0%   { transform: translate3d(0, 0, 0); }
        12%  { transform: translate3d(-2%, -3%, 0); }
        25%  { transform: translate3d(3%, -2%, 0); }
        37%  { transform: translate3d(-3%, 2%, 0); }
        50%  { transform: translate3d(2%, 3%, 0); }
        62%  { transform: translate3d(-1%, -2%, 0); }
        75%  { transform: translate3d(3%, 1%, 0); }
        87%  { transform: translate3d(-2%, 2%, 0); }
        100% { transform: translate3d(0, 0, 0); }
      }
      .sfme .sfme-grain {
        position: absolute;
        inset: -8%;
        pointer-events: none;
        will-change: transform;
        background-repeat: repeat;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23g)'/%3E%3C/svg%3E");
        animation: sfme-grain 900ms steps(1, end) infinite;
      }
      /* The warm leak breathes rather than blinks: a slow 7.5s pulse reads as
         light moving across a lens, a fast one reads as a bug. */
      @keyframes sfme-leak {
        0%, 100% { opacity: .62; transform: translate3d(0, 0, 0) scale(1); }
        50%      { opacity: 1;   transform: translate3d(-1.5%, 1.5%, 0) scale(1.07); }
      }
      .sfme .sfme-leak {
        position: absolute;
        inset: 0;
        pointer-events: none;
        will-change: opacity, transform;
        animation: sfme-leak 7.5s ease-in-out infinite;
      }
      .sfme .sfme-veil { position: absolute; inset: 0; pointer-events: none; background: #000; will-change: opacity; }
      .sfme .sfme-rise { animation: sfme-rise .28s cubic-bezier(.22,.9,.3,1) both; }
      .sfme .sf-input { width: 100%; border-radius: .6rem; border: 1px solid var(--space-border-default); background: var(--space-surface-panel); padding: .45rem .6rem; font-size: .8125rem; color: var(--space-text-primary); outline: none; }
      .sfme .sf-input:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,.18); }
      .sfme input[type='range'] { accent-color: #8b5cf6; width: 100%; }
      .sfme button { transition: background-color .16s ease, border-color .16s ease, opacity .16s ease; }
      @media (prefers-reduced-motion: reduce) { .sfme *, .sfme *::before { animation: none !important; transition-duration: .01ms !important; } }
    `}</style>

    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--space-border-strong)] bg-[color-mix(in_srgb,#0b1022_80%,transparent)] px-4 py-3">
      <button type="button" onClick={props.onClose} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-xs font-semibold text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]">
        <ArrowLeft className="h-4 w-4" />Back to the studio
      </button>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#6366f1,#8b5cf6)]"><Film className="h-4 w-4 text-white" /></span>
      <div className="min-w-0">
        <h1 className="truncate text-sm font-bold">Motion Graphics Editor</h1>
        <p className="truncate text-[11px] text-[var(--space-text-muted)]">
          {portrait ? '1080\u00d71920 portrait' : '1920\u00d71080 landscape'} · {layerCount} layer{layerCount === 1 ? '' : 's'} over the HeyGen master
          {job?.lastSavedAt ? ` \u00b7 saved ${relativeSaved(job.lastSavedAt)}` : ''}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {manifest.cinematic.enabled ? <span title={`${presetOf(manifest.cinematic.preset).name} preset`} className="flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-semibold" style={{ borderColor: `${manifest.cinematic.accent}66`, color: manifest.cinematic.accent, background: `${manifest.cinematic.accent}14` }}>
          <Sparkles className="h-3.5 w-3.5" />{presetOf(manifest.cinematic.preset).name}
        </span> : null}
        <button type="button" onClick={downloadOverlaySpec} title="Download the overlay spec as JSON: every element, its timing and the look, exactly as the compositor receives it"
          className="flex items-center gap-1.5 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-xs font-semibold text-[var(--space-text-secondary)]">
          <Download className="h-3.5 w-3.5" />Spec JSON
        </button>
        <button type="button" onClick={() => void persist()} disabled={saveState === 'saving'} className="flex items-center gap-1.5 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-xs font-semibold text-[var(--space-text-secondary)] disabled:opacity-50">
          {saveState === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
        </button>
        <button type="button" onClick={() => void exportFinal()} disabled={exportPhase === 'compiling' || exportPhase === 'rendering' || loading}
          className="flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-4 py-2 text-xs font-bold text-white shadow-[0_4px_16px_rgba(99,102,241,.4)] disabled:opacity-40">
          {exportPhase === 'compiling' || exportPhase === 'rendering' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}Export / render final
        </button>
      </div>
    </header>

    {saveState === 'error' ? <p role="alert" className="shrink-0 bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_16%,transparent)] px-4 py-2 text-xs text-[var(--space-text-secondary)]">The layer stack could not be saved: {saveError}</p> : null}

    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
          {loading
            ? <span className="flex items-center gap-2 text-sm text-[var(--space-text-secondary)]"><Loader2 className="h-4 w-4 animate-spin text-[#a78bfa]" />Opening the editor…</span>
            : <div ref={stageRef} className={portrait ? 'relative aspect-[9/16] max-h-full overflow-hidden rounded-2xl border border-[var(--space-border-strong)] bg-black' : 'relative aspect-video max-h-full w-full max-w-4xl overflow-hidden rounded-2xl border border-[var(--space-border-strong)] bg-black'}
              style={portrait ? { height: '100%' } : undefined}>
              <video
                ref={videoRef}
                key={baseUrl}
                src={baseUrl}
                poster={job?.posterUrl || undefined}
                playsInline
                onLoadedMetadata={(event) => {
                  const value = Number((event.target as HTMLVideoElement).duration);
                  if (Number.isFinite(value) && value > 0) {
                    setDuration(value);
                    dirty.current = true;
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onSeeked={(event) => setCurrentTime((event.target as HTMLVideoElement).currentTime)}
                onError={() => {
                  if (!props.onRefreshLink || !job) return;
                  void props.onRefreshLink(job.videoId, baseUrl).then((fresh) => { if (fresh) setBaseUrl(fresh); }).catch(() => { /* the banner below already explains it */ });
                }}
                className="absolute inset-0 h-full w-full object-contain"
              />

              {/* ——— Cinematic atmosphere ———
                  Grain and the leak sit directly on the presenter and UNDER
                  every word of type, which is the same order compileRenderPlan
                  gives them, so nothing the customer wrote is ever read
                  through noise. The grain opacity is the literal value the
                  exported plate is drawn at — not a prettier preview number. */}
              {atmosphere.grainOpacity > 0 ? <div className="sfme-grain" style={{ opacity: atmosphere.grainOpacity }} /> : null}
              {atmosphere.lightLeak ? <div className="sfme-leak" style={{
                backgroundImage: `radial-gradient(62% 46% at 102% -4%, ${atmosphere.accent}6b, #fbbf2438 30%, #f9731618 62%, transparent 78%), radial-gradient(42% 32% at -10% 105%, ${atmosphere.accent}22, transparent 70%)`,
              }} /> : null}
              {/* The black fade-in is driven by the playhead, not by a CSS
                  animation, so scrubbing back into the first second really
                  shows the fade instead of a one-shot that already ran. */}
              {atmosphere.introFadeSec > 0 && currentTime < atmosphere.introFadeSec
                ? <div className="sfme-veil" style={{ opacity: Math.max(0, 1 - currentTime / atmosphere.introFadeSec) }} />
                : null}

              {/* Image and card overlays sit under the type, exactly as the
                  compositor orders them. */}
              {manifest.images.filter((layer) => isLive(layer, currentTime)).map((layer) => {
                const progress = entranceProgress(layer, currentTime);
                const out = exitProgress(layer, currentTime);
                const zoom = layer.transition === 'zoom-in' ? 1 + 0.08 * ((currentTime - layer.start) / Math.max(0.2, layer.duration)) : 1;
                const slide = layer.transition === 'slide' ? (1 - progress) * 18 : 0;
                return <img key={layer.id} src={layer.url} alt="" style={{ objectFit: layer.fit, opacity: layer.transition === 'fade' ? Math.min(progress, 1 - out) : 1, transform: `translateX(${slide}%) scale(${zoom})` }} className="absolute inset-0 h-full w-full" />;
              })}
              {manifest.cards.filter((layer) => layer.clipUrl && isLive(layer, currentTime)).map((layer) => <div key={layer.id} className="absolute inset-0" style={{ opacity: Math.min(entranceProgress(layer, currentTime), 1 - exitProgress(layer, currentTime)) }}>
                <CardClip card={layer} live={playing} fit="cover" />
              </div>)}

              {manifest.brand.filter((layer) => isLive(layer, currentTime)).map((layer) => {
                const progress = entranceProgress(layer, currentTime);
                const out = exitProgress(layer, currentTime);
                const wiping = layer.anim === 'mask-wipe' || layer.anim === 'clip-reveal';
                const opacity = layer.opacity * Math.min(layer.anim === 'none' || wiping ? 1 : progress, 1 - out * 0.9);
                const lift = layer.anim === 'slide-up' ? (1 - progress) * 18 : 0;
                // A lower third wipes in from the LEFT edge, matching the
                // horizontal clip renderBrandPlate draws for the same layer.
                const wipe = wiping ? `inset(0 ${(1 - progress) * 100}% 0 0)` : undefined;
                if (layer.kind === 'logo') {
                  const vertical = layer.corner.startsWith('top') ? { top: '5.5%' } : { bottom: '5.5%' };
                  const horizontal = layer.corner.endsWith('left') ? { left: '5.5%' } : { right: '5.5%' };
                  return <img key={layer.id} src={layer.logoUrl} alt="" style={{ position: 'absolute', width: `${layer.scale * 100}%`, opacity, transform: `translateY(${lift}px)`, ...vertical, ...horizontal }} />;
                }
                if (layer.kind === 'accent-bar') {
                  const vertical = layer.corner.startsWith('top') ? { top: '6%' } : { bottom: '8%' };
                  return <span key={layer.id} style={{ position: 'absolute', left: '8%', width: '84%', height: Math.max(2, frame.h * 0.012 * scale), borderRadius: 999, opacity, background: `linear-gradient(90deg, ${layer.accentColor}, ${layer.color})`, transform: `translateY(${lift}px)`, ...vertical }} />;
                }
                const vertical = layer.corner.startsWith('top') ? { top: '10%' } : { bottom: '16%' };
                return <div key={layer.id} style={{
                  position: 'absolute',
                  left: '7%',
                  width: '74%',
                  opacity,
                  transform: `translateY(${lift}px)`,
                  clipPath: wipe,
                  willChange: 'transform, opacity',
                  // A gradient that falls away to nothing on the right reads
                  // as broadcast; the old flat box read as a placeholder.
                  background: layer.gradient
                    ? `linear-gradient(90deg, ${layer.accentColor}e6 0%, rgba(10,14,24,.94) 16%, rgba(10,14,24,.76) 72%, rgba(10,14,24,0) 100%)`
                    : 'rgba(8,12,20,0.78)',
                  borderLeft: `${Math.max(2, frame.w * 0.012 * scale)}px solid ${layer.accentColor}`,
                  borderRadius: 10,
                  padding: `${Math.max(6, frame.w * 0.028 * scale)}px ${Math.max(8, frame.w * 0.034 * scale)}px`,
                  ...vertical,
                }}>
                  <span style={{ display: 'block', fontFamily: 'Poppins, Inter, system-ui, sans-serif', fontWeight: 800, color: layer.color, fontSize: Math.max(10, frame.w * 0.055 * scale), lineHeight: 1.1, textShadow: '0 2px 10px rgba(0,0,0,.55)' }}>{layer.name}</span>
                  <span style={{ display: 'block', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, color: layer.accentColor, fontSize: Math.max(8, frame.w * 0.032 * scale), lineHeight: 1.2, textShadow: '0 1px 6px rgba(0,0,0,.5)' }}>{layer.role}</span>
                </div>;
              })}

              {manifest.text.filter((layer) => isLive(layer, currentTime)).map((layer) => {
                const progress = entranceProgress(layer, currentTime);
                const out = exitProgress(layer, currentTime);
                const style = animatedStyle(layer.anim, progress, out);
                const shown = layer.anim === 'typewriter'
                  ? layer.text.slice(0, Math.max(1, Math.ceil(layer.text.length * Math.min(1, (currentTime - layer.start) / Math.max(ENTRANCE_SEC, Math.min(1.6, layer.duration * 0.5))))))
                  : layer.text;
                return <div key={layer.id} onPointerDown={() => setSelectedId(layer.id)} style={{
                  position: 'absolute',
                  left: `${layer.x * 100}%`,
                  top: `${layer.y * 100}%`,
                  width: `${layer.width * 100}%`,
                  textAlign: layer.align,
                  cursor: 'pointer',
                  ...style,
                }}>
                  <span style={{
                    display: 'inline-block',
                    fontFamily: `${layer.font}, Poppins, Inter, system-ui, sans-serif`,
                    fontWeight: layer.weight,
                    fontSize: Math.max(9, layer.sizePx * scale),
                    lineHeight: 1.18,
                    letterSpacing: layer.trackingEm ? `${layer.trackingEm}em` : undefined,
                    color: layer.color,
                    // The same two-part shadow renderTextPlate draws: a glow
                    // pass under the letterform when the preset asks for one,
                    // then a dropped shadow that keeps type legible over
                    // moving video.
                    textShadow: [
                      layer.glow ? `0 0 ${Math.max(6, layer.sizePx * 0.5 * scale)}px ${layer.color}` : '',
                      `0 ${Math.max(1, layer.sizePx * 0.05 * scale)}px ${Math.max(4, layer.sizePx * 0.3 * scale)}px rgba(0,0,0,.62)`,
                    ].filter(Boolean).join(', '),
                    background: layer.plate === 'none'
                      ? 'transparent'
                      : layer.plateGradientTo
                        ? `linear-gradient(135deg, ${layer.plateColor}, ${layer.plateGradientTo})`
                        : layer.plateColor,
                    borderRadius: layer.plate === 'pill' ? 999 : layer.plate === 'bar' ? Math.max(4, layer.sizePx * 0.16 * scale) : 0,
                    padding: layer.plate === 'none' ? 0 : `${Math.max(2, layer.sizePx * 0.32 * scale)}px ${Math.max(4, layer.sizePx * 0.55 * scale)}px`,
                  }}>{shown}</span>
                </div>;
              })}

              {activeCaption ? <div style={{
                position: 'absolute',
                left: '7%',
                width: '86%',
                textAlign: 'center',
                top: manifest.captionStyle.position === 'top' ? '12%' : manifest.captionStyle.position === 'middle' ? '46%' : '78%',
              }}>
                <span style={{
                  display: 'inline-block',
                  fontFamily: `${manifest.captionStyle.font}, Inter, system-ui, sans-serif`,
                  fontWeight: 700,
                  fontSize: Math.max(9, manifest.captionStyle.sizePx * scale),
                  color: manifest.captionStyle.color,
                  background: manifest.captionStyle.plate === 'pill' ? manifest.captionStyle.plateColor : 'transparent',
                  borderRadius: 999,
                  padding: `${Math.max(2, manifest.captionStyle.sizePx * 0.3 * scale)}px ${Math.max(5, manifest.captionStyle.sizePx * 0.55 * scale)}px`,
                  textShadow: manifest.captionStyle.plate === 'none' ? '0 1px 6px #000, 0 0 2px #000' : 'none',
                }}>{activeCaption.text}</span>
              </div> : null}

              {!playing && currentTime === 0 ? <button type="button" onClick={togglePlay} aria-label="Play preview" className="absolute inset-0 flex items-center justify-center bg-black/25">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] shadow-xl"><Play className="h-6 w-6 text-white" /></span>
              </button> : null}
            </div>}
        </div>

        {loadError ? <p role="alert" className="mx-4 mb-3 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,transparent)] p-3 text-xs text-[var(--space-text-secondary)]">{loadError}</p> : null}

        {notes.card ? <p className="mx-4 mb-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-2.5 text-[11px] text-[var(--space-text-secondary)]">{notes.card}</p> : null}

        {exportPhase !== 'idle' ? <div className="mx-4 mb-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--space-text-muted)]">Export</span>
            {exportPhase === 'compiling' ? <span className="flex items-center gap-1.5 text-xs text-[var(--space-text-secondary)]"><Loader2 className="h-3.5 w-3.5 animate-spin text-[#a78bfa]" />{planProgress ? `${planProgress.label} (${planProgress.done}/${planProgress.total})` : 'Rendering the overlay artwork…'}</span> : null}
            {exportPhase === 'rendering' ? <span className="flex items-center gap-1.5 text-xs text-[var(--space-text-secondary)]"><Loader2 className="h-3.5 w-3.5 animate-spin text-[#a78bfa]" />The platform compositor is building your MP4…</span> : null}
            {exportPhase === 'done' ? <span className="flex items-center gap-1.5 text-xs text-[#34d399]"><Check className="h-3.5 w-3.5" />Finished</span> : null}
            {exportPhase === 'failed' ? <span className="flex items-center gap-1.5 text-xs text-[var(--space-semantic-danger)]"><AlertTriangle className="h-3.5 w-3.5" />Not finished</span> : null}
            {job?.finalVideoUrl ? <a href={job.finalVideoUrl} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-3 py-1.5 text-[11px] font-bold text-white"><Download className="h-3.5 w-3.5" />Open the finished MP4</a> : null}
          </div>
          {renderJob?.steps?.length ? <ol className="mt-2 grid gap-1 sm:grid-cols-2">
            {renderJob.steps.map((step) => <li key={step.id} className="flex items-center gap-2 text-[11px]">
              <span className={step.state === 'done' ? 'h-1.5 w-1.5 rounded-full bg-[#34d399]' : step.state === 'failed' ? 'h-1.5 w-1.5 rounded-full bg-[var(--space-semantic-danger)]' : step.state === 'running' ? 'h-1.5 w-1.5 animate-pulse rounded-full bg-[#a78bfa]' : 'h-1.5 w-1.5 rounded-full bg-[var(--space-border-strong)]'} />
              <span className={step.state === 'skipped' ? 'text-[var(--space-text-muted)]' : 'text-[var(--space-text-secondary)]'}>{step.label}{step.detail ? ` \u2014 ${step.detail}` : ''}</span>
            </li>)}
          </ol> : null}
          {renderJob?.note ? <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--space-text-muted)]">{renderJob.note}</p> : null}
          {exportError ? <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--space-semantic-danger)]">{exportError}</p> : null}
          {warnings.map((warning) => <p key={warning} className="mt-1.5 text-[11px] leading-relaxed text-[#fbbf24]">{warning}</p>)}
        </div> : null}

        <Timeline
          duration={duration}
          currentTime={currentTime}
          playing={playing}
          tracks={tracks}
          selectedId={selectedId}
          onSeek={seek}
          onSelect={setSelectedId}
          onTogglePlay={togglePlay}
          onChangeClip={changeClip}
          onToggleHidden={toggleHidden}
        />
      </div>

      <div className="hidden w-[360px] shrink-0 lg:block">
        {job ? <LayerPanel
          manifest={manifest}
          duration={duration}
          captionCount={captions.length}
          selectedId={selectedId}
          playhead={currentTime}
          busy={{ copy: busy.copy, music: busy.music, captions: busy.captions }}
          notes={{ copy: notes.copy, music: notes.music, captions: notes.captions }}
          onSelect={setSelectedId}
          onAddText={addText}
          onAddBrand={addBrand}
          onAddImage={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = () => { const file = input.files?.[0]; if (file) void addImageFile(file); };
            input.click();
          }}
          onAddCard={() => setCardModal({ open: true, cardId: '' })}
          onEditCard={(id) => setCardModal({ open: true, cardId: id })}
          onPatchText={patchText}
          onPatchBrand={patchBrand}
          onPatchImage={patchImage}
          onPatchCard={patchCard}
          onPatchMusic={patchMusic}
          onPatchCaptions={patchCaptionStyle}
          onPatchDirectives={patchDirectives}
          onRemove={removeLayer}
          onSuggestCopy={() => void suggestCopy()}
          onGenerateMusic={() => void makeMusic()}
          onUploadMusic={(file) => void uploadMusic(file)}
          onGenerateCaptions={() => void makeCaptions()}
          onOpenCaptions={() => setCaptionsOpen(true)}
          onUploadLogo={(id, file) => void uploadLogo(id, file)}
          cinematic={manifest.cinematic}
          onPatchCinematic={patchCinematic}
          onChoosePreset={choosePreset}
          onDownloadSpec={downloadOverlaySpec}
        /> : null}
      </div>
    </div>

    <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-[var(--space-border-strong)] bg-[color-mix(in_srgb,#0b1022_70%,transparent)] px-4 py-2 text-[11px] text-[var(--space-text-muted)]">
      <span>Playhead {formatClock(currentTime)}</span>
      <span>·</span>
      <span>{manifest.text.length + manifest.brand.length + manifest.images.length + manifest.cards.length} timed layers, up to {MAX_EXPORT_OVERLAYS} composited assets per pass</span>
      {busy.rehost
        ? <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Re-hosting the master…</span>
        : <button type="button" onClick={() => void reHost()} className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-2 py-1 font-semibold text-[var(--space-text-secondary)]"><RefreshCw className="h-3 w-3" />Re-host base video</button>}
      <span className="ml-auto flex items-center gap-1.5">
        {saveState === 'saving' ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</> : job?.lastSavedAt ? <><Check className="h-3 w-3 text-[#34d399]" />Last saved {relativeSaved(job.lastSavedAt)}</> : 'Not saved yet'}
      </span>
    </footer>

    {cardModal.open && job ? <HyperFrameCard
      card={cardModal.cardId ? manifest.cards.find((layer) => layer.id === cardModal.cardId) || null : null}
      kit={job.brandKit}
      playhead={currentTime}
      duration={duration}
      rendering={busy.card}
      error={notes.card}
      onClose={() => setCardModal({ open: false, cardId: '' })}
      onSubmit={(input) => void submitCard(input)}
    /> : null}

    {captionsOpen && job ? <CaptionEditor
      segments={captions}
      duration={duration}
      playhead={currentTime}
      busy={busy.captions}
      onClose={() => setCaptionsOpen(false)}
      onSeek={seek}
      onChange={(id, patch) => { setJob((current) => (current ? { ...current, captions: current.captions.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)) } : current)); touch(); }}
      onRemove={(id) => { setJob((current) => (current ? { ...current, captions: current.captions.filter((segment) => segment.id !== id) } : current)); touch(); }}
      onAdd={(atSec) => { setJob((current) => (current ? { ...current, captions: [...current.captions, newCaptionSegment(atSec, Math.min(duration || atSec + 2, atSec + 2), 'New caption')] } : current)); touch(); }}
      onRegenerate={() => void makeCaptions()}
    /> : null}
  </div>;
}
