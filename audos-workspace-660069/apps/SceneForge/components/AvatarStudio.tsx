import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Clapperboard, Download, Flag, History, Image as ImageIcon, KeyRound, Loader2, Mic, Monitor, Palette, Play, RefreshCw, Search, Smartphone, Sparkles, Trash2, Video, Volume2, Wand2, X } from 'lucide-react';
import { sortAvatars, sortVoices, type AvatarView, type VoiceView } from '../lib/heygenCatalog';
import {
  HeyGenError,
  clearHistory,
  createAvatarVideo,
  defaultVoiceId,
  downloadVideo,
  fetchAvatarLooks,
  fetchVideoStatus,
  fetchVoices,
  improveScript,
  isIndianAvatar,
  pushHistory,
  readHistory,
  readIndianPins,
  toggleIndianPin,
  voiceAccent,
  avatarSupportsAudioVoice,
  type BackgroundMode,
  type HeyGenApiVersion,
  type HistoryEntry,
} from '../lib/heygenStudio';
import { registerAudioAsset } from '../lib/heygenApi';
import {
  CLONE_AUDIO_ACCEPT,
  MAX_CLONE_SAMPLES,
  MODEL_NOTE,
  PRESENTER_VOICE_SETTINGS,
  cloneElevenVoice,
  deleteElevenVoice,
  fetchElevenVoices,
  measureAudioDuration,
  shortVoiceName,
  speak,
  type ElevenVoice,
  type VoiceSettings,
} from '../lib/elevenLabs';
import ElevenVoicePicker from './ElevenVoicePicker';
import type { MotionEditorSource } from './MotionEditor';

const MAX_SCRIPT = 1500;
// HeyGen quotes 60–120 seconds for a short avatar render, so the bar is eased
// against that expectation instead of jumping 0 → 100 when the poll lands.
const EXPECTED_RENDER_SEC = 85;
const PENDING_KEY = 'sceneforge_studio_pending_v1';
const PENDING_MAX_AGE_MS = 60 * 60 * 1000;

type Phase = 'idle' | 'submitting' | 'rendering' | 'done';
type AvatarTab = 'all' | 'indian';

// Where the spoken words come from. 'elevenlabs' narrates the script FIRST
// and hands HeyGen a finished track to lip-sync to, so HeyGen's own TTS is
// never invoked; 'heygen' is the original one-step path, kept because a look
// that is missing from HeyGen's v2 catalog cannot take a ready-made track.
type VoiceEngine = 'elevenlabs' | 'heygen';
const VOICE_ENGINE_KEY = 'sceneforge_studio_voice_engine_v1';

/** The stages the pipeline reports while a render is in flight. */
type Stage = '' | 'voice' | 'handoff' | 'render';

interface PendingRender {
  videoId: string;
  script: string;
  avatarName: string;
  voiceName: string;
  aspectRatio: string;
  startedAt: number;
  /** Which HeyGen status route this render can be polled on. */
  apiVersion?: HeyGenApiVersion;
}

function readPending(): PendingRender | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingRender;
    if (!value?.videoId || Date.now() - Number(value.startedAt || 0) > PENDING_MAX_AGE_MS) {
      window.localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return value;
  } catch { return null; }
}
function writePending(value: PendingRender | null) {
  try {
    if (value) window.localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(PENDING_KEY);
  } catch { /* private mode — the render still finishes in this tab */ }
}

function relativeDate(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return <span className={done
    ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] text-xs font-bold text-white'
    : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--space-border-strong)] bg-[var(--space-surface-panel)] text-xs font-bold text-[var(--space-text-muted)]'}>
    {done ? <Check className="h-4 w-4" /> : n}
  </span>;
}

function Step(props: { n: number; done: boolean; title: string; hint?: string; action?: any; children: any }) {
  return <section className="st-rise rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5 shadow-[0_1px_0_color-mix(in_srgb,#ffffff_5%,transparent)_inset]">
    <div className="flex flex-wrap items-center gap-3">
      <StepBadge n={props.n} done={props.done} />
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold tracking-tight text-[var(--space-text-primary)]">{props.title}</h2>
        {props.hint ? <p className="mt-0.5 text-xs leading-relaxed text-[var(--space-text-muted)]">{props.hint}</p> : null}
      </div>
      {props.action}
    </div>
    <div className="mt-4">{props.children}</div>
  </section>;
}

function Segmented<T extends string>(props: { value: T; options: { value: T; label: string; icon?: any }[]; onChange: (value: T) => void }) {
  return <div className="inline-flex flex-wrap gap-1 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-1">
    {props.options.map((option) => {
      const Icon = option.icon;
      const active = option.value === props.value;
      return <button key={option.value} type="button" onClick={() => props.onChange(option.value)}
        className={active
          ? 'flex items-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_2px_10px_color-mix(in_srgb,#6366f1_45%,transparent)]'
          : 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--space-text-secondary)] hover:bg-[color-mix(in_srgb,#ffffff_6%,transparent)]'}>
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}{option.label}
      </button>;
    })}
  </div>;
}

function Notice(props: { tone: 'error' | 'info' | 'key'; title?: string; children: any; action?: any }) {
  const error = props.tone === 'error';
  return <div role={error ? 'alert' : undefined} className={error
    ? 'st-rise flex flex-wrap items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_38%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,transparent)] p-4 text-sm'
    : 'st-rise flex flex-wrap items-start gap-3 rounded-xl border border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-panel)] p-4 text-sm'}>
    {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-semantic-danger)]" />
      : props.tone === 'key' ? <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[#a78bfa]" />
        : <Search className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-text-muted)]" />}
    <div className="min-w-[min(100%,220px)] flex-1 leading-relaxed text-[var(--space-text-secondary)]">
      {props.title ? <strong className="block text-[var(--space-text-primary)]">{props.title}</strong> : null}
      {props.children}
    </div>
    {props.action}
  </div>;
}

function AvatarSkeletons() {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
    {Array.from({ length: 8 }).map((_, index) => <div key={index} className="rounded-xl border border-[var(--space-border-default)] p-2">
      <div className="st-shimmer aspect-[3/4] rounded-lg bg-[var(--space-surface-muted)]" />
      <div className="st-shimmer mt-2 h-3 w-2/3 rounded bg-[var(--space-surface-muted)]" />
    </div>)}
  </div>;
}

export default function AvatarStudio({ onOpenPipeline, onOpenSuite, onOpenEditor }: { onOpenPipeline?: () => void; onOpenSuite?: () => void; onOpenEditor?: (source: MotionEditorSource) => void }) {
  const [avatars, setAvatars] = useState<any[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(true);
  const [avatarsError, setAvatarsError] = useState('');
  const [needsKey, setNeedsKey] = useState(false);
  const [voices, setVoices] = useState<any[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState('');
  const [pins, setPins] = useState<string[]>(() => readIndianPins());

  const [tab, setTab] = useState<AvatarTab>('indian');
  const [avatarQuery, setAvatarQuery] = useState('');
  const [avatarLimit, setAvatarLimit] = useState(24);
  const [avatarId, setAvatarId] = useState('');

  const [voiceId, setVoiceId] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceQuery, setVoiceQuery] = useState('');
  const voiceBox = useRef<HTMLDivElement | null>(null);
  const voiceFilter = useRef<HTMLInputElement | null>(null);

  // ——— ElevenLabs, the default voice engine ———
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>(() => {
    try { return window.localStorage.getItem(VOICE_ENGINE_KEY) === 'heygen' ? 'heygen' : 'elevenlabs'; } catch { return 'elevenlabs'; }
  });
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[]>([]);
  const [elevenLoading, setElevenLoading] = useState(true);
  const [elevenError, setElevenError] = useState('');
  const [elevenCloned, setElevenCloned] = useState(false);
  const [elevenVoiceId, setElevenVoiceId] = useState('');
  const [settings, setSettings] = useState<VoiceSettings>(PRESENTER_VOICE_SETTINGS);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneSamples, setCloneSamples] = useState<File[]>([]);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState('');
  const [cloneSuccess, setCloneSuccess] = useState('');
  const [cloneRecording, setCloneRecording] = useState(false);
  const [deleteVoiceId, setDeleteVoiceId] = useState('');
  const [confirmDeleteVoiceId, setConfirmDeleteVoiceId] = useState('');
  const cloneRecorder = useRef<MediaRecorder | null>(null);
  const cloneStream = useRef<MediaStream | null>(null);
  const cloneFileInput = useRef<HTMLInputElement | null>(null);
  // The finished track for the CURRENT script and voice. Keeping it means a
  // retry after a HeyGen failure re-submits the render without paying for a
  // second voiceover.
  const [voiceover, setVoiceover] = useState<{ url: string; playbackUrl: string; script: string; voiceId: string; durationMs: number } | null>(null);
  const [stage, setStage] = useState<Stage>('');
  const apiVersion = useRef<HeyGenApiVersion | undefined>(undefined);

  const [script, setScript] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [scriptNote, setScriptNote] = useState('');

  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('1080p');
  const [speed, setSpeed] = useState(1);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('color');
  const [backgroundColor, setBackgroundColor] = useState('#0f172a');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState('');

  const [phase, setPhase] = useState<Phase>('idle');
  const [videoId, setVideoId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [renderError, setRenderError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [refreshingLink, setRefreshingLink] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const startedAt = useRef(0);
  const currentVideoId = useRef('');
  const linkRefreshes = useRef(new Map<string, Promise<string>>());
  const renderMeta = useRef<{ avatarName: string; voiceName: string; script: string; aspectRatio: string }>({ avatarName: '', voiceName: '', script: '', aspectRatio: '9:16' });

  // ——— Live catalogs ———
  useEffect(() => {
    let cancelled = false;
    fetchAvatarLooks((items) => { if (!cancelled) setAvatars(items); })
      .then((result) => { if (!cancelled) setAvatars(result.items); })
      .catch((e: any) => {
        if (cancelled) return;
        if (e instanceof HeyGenError && e.missingCredential) setNeedsKey(true);
        else setAvatarsError(String(e?.message || 'The HeyGen avatar catalog could not be loaded.'));
      })
      .finally(() => { if (!cancelled) setAvatarsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchVoices()
      .then((result) => { if (!cancelled) setVoices(result.voices); })
      .catch((e: any) => {
        if (cancelled) return;
        if (e instanceof HeyGenError && e.missingCredential) setNeedsKey(true);
        else setVoicesError(String(e?.message || 'The HeyGen voice catalog could not be loaded.'));
      })
      .finally(() => { if (!cancelled) setVoicesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchElevenVoices()
      .then((result) => {
        if (cancelled) return;
        setElevenVoices(result.voices);
        setElevenCloned(result.includesCloned);
      })
      .catch((e: any) => { if (!cancelled) setElevenError(String(e?.message || 'The ElevenLabs voice catalog could not be loaded.')); })
      .finally(() => { if (!cancelled) setElevenLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const avatarLibrary = useMemo<AvatarView[]>(() => sortAvatars(avatars), [avatars]);
  const voiceLibrary = useMemo<VoiceView[]>(() => sortVoices(voices), [voices]);
  const indianAvatars = useMemo(() => avatarLibrary.filter((view) => isIndianAvatar(view, pins)), [avatarLibrary, pins]);
  const selectedAvatar = useMemo(() => avatarLibrary.find((view) => view.id === avatarId), [avatarLibrary, avatarId]);
  const selectedVoice = useMemo(() => voiceLibrary.find((view) => view.id === voiceId), [voiceLibrary, voiceId]);

  // The studio opens on an Indian-English voice when the account has one.
  useEffect(() => {
    if (voiceId || !voiceLibrary.length) return;
    setVoiceId(defaultVoiceId(voiceLibrary));
  }, [voiceLibrary, voiceId]);

  const indianElevenVoices = useMemo(() => elevenVoices.filter((voice) => voice.indian), [elevenVoices]);
  const selectedEleven = useMemo(() => elevenVoices.find((voice) => voice.id === elevenVoiceId), [elevenVoices, elevenVoiceId]);

  // Open on an Indian voice when the catalog has one — it is the primary
  // market and the reason this engine leads.
  useEffect(() => {
    if (elevenVoiceId || !elevenVoices.length) return;
    setElevenVoiceId((indianElevenVoices[0] || elevenVoices[0]).id);
  }, [elevenVoices, indianElevenVoices, elevenVoiceId]);

  const cloneTotalBytes = useMemo(() => cloneSamples.reduce((total, file) => total + file.size, 0), [cloneSamples]);

  function addCloneSamples(incoming: File[]) {
    if (!incoming.length) return;
    if (cloneSamples.length + incoming.length > MAX_CLONE_SAMPLES) {
      setCloneError('Choose no more than five audio samples for one voice.');
      return;
    }
    setCloneSamples((current) => [...current, ...incoming]);
    setCloneError('');
    setCloneSuccess('');
  }

  async function toggleCloneRecording() {
    if (cloneRecording) {
      cloneRecorder.current?.stop();
      return;
    }
    if (cloneSamples.length >= MAX_CLONE_SAMPLES) {
      setCloneError('Remove a sample before recording another one. You can use up to five.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setCloneError('This browser cannot record audio here. Upload an audio file instead.');
      return;
    }
    setCloneError('');
    setCloneSuccess('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      cloneStream.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      const chunks: Blob[] = [];
      cloneRecorder.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => setCloneError('The microphone recording stopped unexpectedly. Try again or upload a file.');
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        cloneStream.current = null;
        cloneRecorder.current = null;
        setCloneRecording(false);
        if (!chunks.length) { setCloneError('No audio was captured. Check your microphone and try again.'); return; }
        const type = recorder.mimeType || chunks[0].type || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const sample = new File(chunks, `recording-${Date.now()}.${extension}`, { type });
        setCloneSamples((current) => current.length < MAX_CLONE_SAMPLES ? [...current, sample] : current);
      };
      recorder.start();
      setCloneRecording(true);
    } catch (error: any) {
      cloneStream.current?.getTracks().forEach((track) => track.stop());
      cloneStream.current = null;
      setCloneError(error?.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in your browser, or upload an audio file instead.'
        : 'The microphone could not start. Upload an audio file instead.');
    }
  }

  useEffect(() => () => {
    const recorder = cloneRecorder.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    cloneStream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (voiceEngine !== 'elevenlabs' && cloneRecorder.current?.state === 'recording') cloneRecorder.current.stop();
  }, [voiceEngine]);

  async function createClone() {
    if (cloneBusy) return;
    setCloneBusy(true);
    setCloneError('');
    setCloneSuccess('');
    try {
      const created = await cloneElevenVoice(cloneName, cloneSamples);
      setElevenVoiceId(created.voiceId);
      setVoiceover(null);
      try {
        const catalog = await fetchElevenVoices();
        setElevenVoices(catalog.voices);
        setElevenCloned(catalog.includesCloned);
        setElevenError('');
      } catch (error: any) {
        setElevenError(String(error?.message || 'Refresh the page to load the new voice into the catalog.'));
      }
      setCloneName('');
      setCloneSamples([]);
      if (cloneFileInput.current) cloneFileInput.current.value = '';
      setCloneSuccess(`${created.name} is ready, selected, and available with the Yours badge.`);
    } catch (error: any) {
      setCloneError(String(error?.message || 'The voice could not be cloned.'));
    } finally {
      setCloneBusy(false);
    }
  }

  async function removeClonedVoice(id: string) {
    if (!id || deleteVoiceId) return;
    setDeleteVoiceId(id);
    setCloneError('');
    setCloneSuccess('');
    try {
      await deleteElevenVoice(id);
      const catalog = await fetchElevenVoices();
      setElevenVoices(catalog.voices);
      setElevenCloned(catalog.includesCloned);
      if (elevenVoiceId === id) {
        const next = catalog.voices.find((voice) => voice.id !== id);
        setElevenVoiceId(next?.id || '');
        setVoiceover(null);
      }
      setConfirmDeleteVoiceId('');
      setCloneSuccess('The cloned voice was deleted from this workspace.');
    } catch (error: any) {
      setCloneError(String(error?.message || 'The cloned voice could not be deleted.'));
    } finally {
      setDeleteVoiceId('');
    }
  }

  // The India tab is the default face of the picker, but an account with no
  // Indian look must never open on an empty grid — not even while later
  // catalog pages are still arriving. Once a real sample of the library has
  // produced zero matches, the picker switches to All instead of holding the
  // customer on skeletons until every page lands.
  useEffect(() => {
    if (!avatarLibrary.length || indianAvatars.length) return;
    if (avatarsLoading && avatarLibrary.length < 24) return;
    setTab('all');
  }, [avatarsLoading, avatarLibrary.length, indianAvatars.length]);

  useEffect(() => setAvatarLimit(24), [tab, avatarQuery]);

  // pointerdown rather than mousedown: a tap outside the picker closes it on
  // the touch itself instead of waiting for the synthesized mouse event.
  useEffect(() => {
    if (!voiceOpen) return;
    const close = (event: Event) => { if (voiceBox.current && !voiceBox.current.contains(event.target as Node)) setVoiceOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [voiceOpen]);

  const visibleAvatars = useMemo(() => {
    const query = avatarQuery.trim().toLowerCase();
    const pool = tab === 'indian' ? indianAvatars : avatarLibrary;
    if (!query) return pool;
    return pool.filter((view) => `${view.name} ${view.gender} ${view.styleLabel}`.toLowerCase().includes(query));
  }, [tab, avatarQuery, avatarLibrary, indianAvatars]);

  const visibleVoices = useMemo(() => {
    const query = voiceQuery.trim().toLowerCase();
    if (!query) return voiceLibrary;
    return voiceLibrary.filter((view) => `${view.name} ${view.language} ${view.gender} ${voiceAccent(view.raw)}`.toLowerCase().includes(query));
  }, [voiceLibrary, voiceQuery]);

  // Committing a voice never depends on the filter input: the id is stored
  // first, then the keyboard is dismissed and the list collapsed.
  const chooseVoice = useCallback((id: string) => {
    setVoiceId(id);
    setVoiceQuery('');
    voiceFilter.current?.blur();
    setVoiceOpen(false);
  }, []);

  // ——— Render lifecycle ———
  useEffect(() => { currentVideoId.current = videoId; }, [videoId]);

  // Avatar Studio history is browser-local rather than a sceneforge_projects
  // row, so it refreshes from HeyGen by video id directly. One promise per id
  // is shared by player errors and download retries, then the renewed URL is
  // persisted back into Recent videos.
  const refreshVideoLink = useCallback(async (id: string, staleUrl: string): Promise<string> => {
    if (!id) throw new Error('This video has no HeyGen id to refresh.');
    const existing = linkRefreshes.current.get(id);
    if (existing) return existing;
    setRefreshingLink(true);
    const pending = (async () => {
      // Only the render in front of the customer has a known api version; a
      // history entry predates it, so that one falls back to the probe.
      const status = await fetchVideoStatus(id, id === currentVideoId.current ? apiVersion.current : undefined);
      if (status.status !== 'completed' || !status.videoUrl) throw new Error(status.error || 'HeyGen has not made this video available yet.');
      if (status.videoUrl === staleUrl) throw new Error('HeyGen returned the same unavailable video link. Try again in a moment.');
      if (currentVideoId.current === id) {
        setVideoUrl(status.videoUrl);
        if (status.thumbnailUrl) setThumbnailUrl(status.thumbnailUrl);
      }
      setHistory((current) => {
        const entry = current.find((item) => item.videoId === id);
        return entry ? pushHistory({ ...entry, videoUrl: status.videoUrl, thumbnailUrl: status.thumbnailUrl || entry.thumbnailUrl }) : current;
      });
      return status.videoUrl;
    })();
    linkRefreshes.current.set(id, pending);
    try { return await pending; }
    finally {
      linkRefreshes.current.delete(id);
      setRefreshingLink(linkRefreshes.current.size > 0);
    }
  }, []);

  const finish = useCallback((id: string, url: string, poster: string) => {
    const meta = renderMeta.current;
    setVideoUrl(url);
    setThumbnailUrl(poster);
    setPhase('done');
    setStage('');
    writePending(null);
    setHistory(pushHistory({
      videoId: id,
      videoUrl: url,
      thumbnailUrl: poster,
      script: meta.script,
      avatarName: meta.avatarName,
      voiceName: meta.voiceName,
      aspectRatio: meta.aspectRatio,
      createdAt: new Date().toISOString(),
    }));
  }, []);

  const fail = useCallback((message: string) => {
    setRenderError(message);
    setPhase('idle');
    setStage('');
    writePending(null);
  }, []);

  useEffect(() => {
    if (phase !== 'rendering' || !videoId) return;
    let stopped = false;
    let misses = 0;
    const tick = async () => {
      try {
        const status = await fetchVideoStatus(videoId, apiVersion.current);
        if (stopped) return;
        misses = 0;
        if (status.status === 'completed' && status.videoUrl) { finish(videoId, status.videoUrl, status.thumbnailUrl); return; }
        if (status.status === 'failed') { fail(status.error || 'HeyGen could not finish this render. Adjust the script or avatar and try again.'); return; }
      } catch (e: any) {
        if (stopped) return;
        misses += 1;
        // A dropped status read is a hiccup, not a dead render — a paid
        // render is only abandoned after five consecutive failures.
        if (misses >= 5) fail(String(e?.message || 'The render status could not be read. Your video may still finish in HeyGen.'));
      }
    };
    const poll = window.setInterval(() => void tick(), 8000);
    const clock = window.setInterval(() => setElapsed(Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))), 1000);
    void tick();
    return () => { stopped = true; window.clearInterval(poll); window.clearInterval(clock); };
  }, [phase, videoId, finish, fail]);

  // A render survives a reload: the id is persisted at submit, so reopening
  // the studio reattaches to the render already in flight instead of losing it.
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    renderMeta.current = { avatarName: pending.avatarName, voiceName: pending.voiceName, script: pending.script, aspectRatio: pending.aspectRatio };
    startedAt.current = pending.startedAt;
    apiVersion.current = pending.apiVersion;
    setScript((current) => current || pending.script);
    setVideoId(pending.videoId);
    setStage('render');
    setPhase('rendering');
  }, []);

  // A look that is missing from HeyGen's v2 catalog cannot be driven by a
  // ready-made audio track. Checking it HERE means the customer is told
  // before they spend a render, not by a rejection afterwards.
  const [audioCompatible, setAudioCompatible] = useState<boolean | null>(null);
  useEffect(() => {
    if (voiceEngine !== 'elevenlabs' || !avatarId) { setAudioCompatible(null); return; }
    let cancelled = false;
    setAudioCompatible(null);
    avatarSupportsAudioVoice(avatarId)
      .then((supported) => { if (!cancelled) setAudioCompatible(supported); })
      .catch(() => { if (!cancelled) setAudioCompatible(null); });
    return () => { cancelled = true; };
  }, [voiceEngine, avatarId]);

  const chosenVoiceId = voiceEngine === 'elevenlabs' ? elevenVoiceId : voiceId;
  const ready = Boolean(avatarId && chosenVoiceId && script.trim()) && script.length <= MAX_SCRIPT;
  const busy = phase === 'submitting' || phase === 'rendering';
  const progress = phase === 'done' ? 100 : Math.min(95, Math.round(100 * (1 - Math.exp(-elapsed / (EXPECTED_RENDER_SEC / 2.4)))));

  // The voiceover already on hand for exactly this script and voice.
  const freshVoiceover = voiceover && voiceover.script === script.trim() && voiceover.voiceId === elevenVoiceId ? voiceover : null;

  const stageOrder: Stage[] = voiceEngine === 'elevenlabs' ? ['voice', 'handoff', 'render'] : ['render'];
  const STAGE_LABELS: Record<string, string> = {
    voice: 'Recording the ElevenLabs voiceover',
    handoff: 'Handing the voice track to HeyGen',
    render: 'HeyGen lip-syncs the avatar',
  };
  const pipelineSteps = stageOrder.map((key) => {
    const here = stageOrder.indexOf(stage);
    const mine = stageOrder.indexOf(key);
    return { key, label: STAGE_LABELS[key], state: here > mine ? 'done' : here === mine ? 'active' : 'todo' };
  });
  const stageLabel = stage && STAGE_LABELS[stage] ? `${STAGE_LABELS[stage]}\u2026` : phase === 'submitting' ? 'Submitting to HeyGen\u2026' : 'Generating\u2026';

  /**
   * The whole pipeline, in order.
   *
   * On the ElevenLabs engine the script is NARRATED FIRST and HeyGen is then
   * handed the finished track to lip-sync to, so HeyGen's text-to-speech is
   * never invoked and the voice the customer auditioned is the one on the
   * finished MP4. On the HeyGen engine it is the original single call.
   */
  async function generate() {
    if (!ready || busy) return;
    const usingEleven = voiceEngine === 'elevenlabs';
    setRenderError('');
    setVideoUrl('');
    setThumbnailUrl('');
    setElapsed(0);
    setStage(usingEleven ? 'voice' : 'render');
    setPhase('submitting');
    renderMeta.current = {
      avatarName: selectedAvatar?.name || avatarId,
      voiceName: usingEleven ? `${shortVoiceName(selectedEleven?.name || elevenVoiceId)} (ElevenLabs)` : (selectedVoice?.name || voiceId),
      script: script.trim(),
      aspectRatio,
    };
    try {
      let audioUrl = '';
      let audioAssetId = '';
      if (usingEleven) {
        let track = freshVoiceover;
        if (!track) {
          const spoken = await speak(script.trim(), elevenVoiceId, settings);
          const durationMs = await measureAudioDuration(spoken.playbackUrl || spoken.url, spoken.estimatedDurationMs);
          track = { url: spoken.url, playbackUrl: spoken.playbackUrl, script: script.trim(), voiceId: elevenVoiceId, durationMs };
          setVoiceover(track);
        }
        audioUrl = track.url;
        setStage('handoff');
        // Best effort. An account with an asset registry gets a real
        // audio_asset_id; everyone else sends the public URL. Both bypass
        // HeyGen's TTS completely, so neither is a degraded path.
        audioAssetId = await registerAudioAsset(track.url, 'audio/mpeg');
      }
      const created = await createAvatarVideo({
        avatarId,
        voiceId: usingEleven ? '' : voiceId,
        script,
        speed,
        resolution,
        aspectRatio,
        backgroundMode,
        backgroundColor,
        backgroundImageUrl,
        ...(usingEleven ? { audioUrl, audioAssetId } : {}),
      });
      apiVersion.current = created.apiVersion;
      startedAt.current = Date.now();
      writePending({ videoId: created.videoId, ...renderMeta.current, startedAt: startedAt.current, apiVersion: created.apiVersion });
      setVideoId(created.videoId);
      setStage('render');
      setPhase('rendering');
    } catch (e: any) {
      if (e instanceof HeyGenError && e.missingCredential) { setNeedsKey(true); setPhase('idle'); setStage(''); return; }
      fail(String(e?.message || 'The render could not be submitted.'));
    }
  }

  async function polish() {
    if (!script.trim() || polishing) return;
    setPolishing(true);
    setScriptNote('');
    try {
      const improved = await improveScript(script.trim(), MAX_SCRIPT);
      setScript(improved);
      setScriptNote('Script polished — edit anything you want before generating.');
    } catch (e: any) {
      setScriptNote(String(e?.message || 'The script could not be polished.'));
    } finally { setPolishing(false); }
  }

  async function save(url: string, id: string) {
    setDownloading(true);
    setRenderError('');
    try { await downloadVideo(url, `sceneforge-${id}.mp4`, () => refreshVideoLink(id, url)); }
    catch (e: any) { setRenderError(String(e?.message || 'The video link could not be refreshed.')); }
    finally { setDownloading(false); }
  }

  function pin(id: string) {
    setPins(toggleIndianPin(id));
  }

  // The editor is handed the finished master as a BASE layer; it never asks
  // HeyGen for another render of it.
  function openEditor(entry: { videoId: string; videoUrl: string; thumbnailUrl?: string; aspectRatio?: string; script?: string; avatarName?: string; voiceName?: string }) {
    if (!onOpenEditor) return;
    onOpenEditor({
      videoId: entry.videoId,
      videoUrl: entry.videoUrl,
      posterUrl: entry.thumbnailUrl || '',
      aspectRatio: entry.aspectRatio === '16:9' ? '16:9' : '9:16',
      script: entry.script || '',
      avatarId,
      avatarName: entry.avatarName || selectedAvatar?.name || '',
      voiceId: chosenVoiceId,
      voiceName: entry.voiceName || (voiceEngine === 'elevenlabs' ? shortVoiceName(selectedEleven?.name || '') : selectedVoice?.name || ''),
      title: (entry.script || 'Avatar video').slice(0, 60),
      brief: entry.script || '',
    });
  }

  const portrait = aspectRatio === '9:16';

  return <div className="sfstudio relative flex h-full min-h-[560px] flex-col overflow-hidden bg-[var(--space-surface-bg)] text-[var(--space-text-primary)]" style={{ backgroundImage: 'radial-gradient(1100px 520px at 12% -8%, rgba(99,102,241,.20), transparent 62%), radial-gradient(900px 480px at 92% 4%, rgba(139,92,246,.17), transparent 58%), linear-gradient(165deg,#0f172a,#0b1022 52%,#140e2b)' }}>
    <style>{`
      @keyframes st-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes st-shimmer { 0%, 100% { opacity: .40; } 50% { opacity: .85; } }
      .sfstudio .st-rise { animation: st-rise .32s cubic-bezier(.22,.9,.3,1) both; }
      .sfstudio .st-shimmer { animation: st-shimmer 1.4s ease-in-out infinite; }
      .sfstudio button, .sfstudio a { transition: transform .16s cubic-bezier(.22,.9,.3,1), background-color .16s ease, border-color .16s ease, box-shadow .2s ease, opacity .16s ease; }
      .sfstudio button:active:not(:disabled) { transform: scale(.97); }
      .sfstudio .st-field { width: 100%; border-radius: .75rem; border: 1px solid var(--space-border-default); background: var(--space-surface-panel); padding: .6rem .75rem; font-size: .875rem; color: var(--space-text-primary); outline: none; transition: border-color .18s ease, box-shadow .18s ease; }
      .sfstudio .st-field::placeholder { color: var(--space-text-muted); }
      .sfstudio .st-field:focus { border-color: #8b5cf6; box-shadow: 0 0 0 4px rgba(139,92,246,.18); }
      .sfstudio .st-scroll::-webkit-scrollbar { width: 8px; }
      .sfstudio .st-scroll::-webkit-scrollbar-thumb { background: var(--space-border-strong); border-radius: 999px; }
      .sfstudio input[type='range'] { accent-color: #8b5cf6; }
      @media (prefers-reduced-motion: reduce) { .sfstudio *, .sfstudio *::before, .sfstudio *::after { animation: none !important; transition-duration: .01ms !important; } }
    `}</style>

    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[color-mix(in_srgb,#ffffff_8%,transparent)] bg-[color-mix(in_srgb,#0b1022_72%,transparent)] px-4 py-3 backdrop-blur sm:px-6">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] shadow-[0_4px_16px_rgba(99,102,241,.45)]"><Clapperboard className="h-4 w-4 text-white" /></span>
      <div className="min-w-0">
        <h1 className="truncate text-base font-bold tracking-tight">SceneForge Avatar Studio</h1>
        <p className="hidden text-xs text-[var(--space-text-muted)] sm:block">Live HeyGen avatars and voices — pick, write, generate, download.</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => setHistoryOpen(true)} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]">
          <History className="h-4 w-4" /><span className="hidden sm:inline">Recent</span>{history.length ? <span className="rounded-full bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-1.5 text-[10px] font-bold text-white">{history.length}</span> : null}
        </button>
        {onOpenSuite ? <button type="button" onClick={onOpenSuite} title="Lock one character and brand across a whole multi-scene film" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-[0_2px_10px_color-mix(in_srgb,#6366f1_45%,transparent)]" style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
          <Sparkles className="h-4 w-4" /><span className="hidden sm:inline">HeyGen Suite</span>
        </button> : null}
        {onOpenPipeline ? <button type="button" onClick={onOpenPipeline} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]">
          <Video className="h-4 w-4" /><span className="hidden sm:inline">Full pipeline</span>
        </button> : null}
      </div>
    </header>

    <div className="st-scroll flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_364px]">
        <div className="space-y-5">
          {needsKey ? <Notice tone="key" title="Connect your HeyGen API key in Settings to unlock avatars.">
            Once the key is saved, reopen this studio and the live avatar and voice catalogs load automatically.
          </Notice> : null}

          <Step n={1} done={Boolean(avatarId)} title="Choose your presenter" hint={avatarLibrary.length ? `${visibleAvatars.length} of ${avatarLibrary.length} looks live from your HeyGen account${avatarsLoading ? ' · still loading' : ''}` : 'Loading your HeyGen avatar looks'}>
            {needsKey ? null : <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Segmented value={tab} onChange={(value) => setTab(value)} options={[{ value: 'indian', label: `\u{1F1EE}\u{1F1F3} Indian avatars${indianAvatars.length ? ` (${indianAvatars.length})` : ''}` }, { value: 'all', label: `All${avatarLibrary.length ? ` (${avatarLibrary.length})` : ''}` }]} />
                <div className="relative min-w-[160px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--space-text-muted)]" />
                  <input value={avatarQuery} onChange={(event) => setAvatarQuery(event.target.value)} placeholder="Search by name or style" className="st-field pl-9" />
                </div>
              </div>

              {avatarsLoading && !visibleAvatars.length ? <AvatarSkeletons />
                : avatarsError && !avatarLibrary.length ? <Notice tone="error" title="The avatar catalog did not load" action={<button type="button" onClick={() => window.location.reload()} className="flex items-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-3 py-2 text-xs font-semibold text-white"><RefreshCw className="h-3.5 w-3.5" />Retry</button>}>{avatarsError}</Notice>
                  : !visibleAvatars.length ? <Notice tone="info" title={tab === 'indian' ? 'No Indian avatars matched yet' : 'No avatars match this search'} action={tab === 'indian' ? <button type="button" onClick={() => setTab('all')} className="rounded-lg border border-[var(--space-border-strong)] px-3 py-2 text-xs font-semibold text-[var(--space-text-primary)]">Show all avatars</button> : null}>
                    {tab === 'indian'
                      ? 'HeyGen does not tag avatars by country, so this tab matches on each look\u2019s own name, language and accent. Open All avatars and use the flag button on a card to add it here.'
                      : 'Try a different name, or clear the search.'}
                  </Notice>
                    : <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                        {visibleAvatars.slice(0, avatarLimit).map((view, index) => {
                          const selected = view.id === avatarId;
                          const pinned = pins.includes(view.id);
                          // An Indian look is highlighted on its own card as
                          // well as sorted first, so it still stands out in
                          // the All tab where it is surrounded by everything
                          // else on the account.
                          return <div key={view.id} className={selected
                            ? 'group relative rounded-xl border-2 border-[#8b5cf6] bg-[color-mix(in_srgb,#8b5cf6_12%,transparent)] p-2 shadow-[0_8px_26px_rgba(139,92,246,.28)]'
                            : view.indian || pinned
                              ? 'group relative rounded-xl border border-[color-mix(in_srgb,#f59e0b_52%,transparent)] bg-[color-mix(in_srgb,#f59e0b_7%,transparent)] p-2 hover:border-[#6366f1]'
                              : 'group relative rounded-xl border border-[var(--space-border-default)] p-2 hover:border-[#6366f1] hover:bg-[color-mix(in_srgb,#6366f1_8%,transparent)]'}>
                            <button type="button" onClick={() => setAvatarId(view.id)} aria-pressed={selected} className="block w-full text-left">
                              {view.image
                                ? <img src={view.image} alt={view.name} loading={index < 8 ? 'eager' : 'lazy'} decoding="async" className="aspect-[3/4] w-full rounded-lg bg-[var(--space-surface-muted)] object-cover" />
                                : <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg bg-[var(--space-surface-muted)] text-[10px] text-[var(--space-text-muted)]">No preview</div>}
                              <span className="mt-2 flex items-center gap-1">
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--space-text-primary)]">{view.name}</span>
                                {view.indian || pinned ? <span title={pinned ? 'You pinned this look to the Indian avatars tab.' : 'Matched as Indian on this look\u2019s own name, language or accent.'}
                                  className="shrink-0 rounded-full bg-[color-mix(in_srgb,#f59e0b_26%,transparent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#fcd34d]">IN</span> : null}
                              </span>
                              <span className="mt-0.5 block truncate text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">{[view.gender, view.styleLabel].filter(Boolean).join(' · ') || 'HeyGen look'}</span>
                            </button>
                            {selected ? <span className="pointer-events-none absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] shadow"><Check className="h-3.5 w-3.5 text-white" /></span> : null}
                            <button type="button" onClick={() => pin(view.id)} title={pinned ? 'Remove from the Indian avatars tab' : 'Add to the Indian avatars tab'} aria-label={pinned ? 'Remove from the Indian avatars tab' : 'Add to the Indian avatars tab'}
                              className={pinned
                                ? 'absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[color-mix(in_srgb,#f59e0b_85%,transparent)] text-[#1a1203]'
                                : 'absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[color-mix(in_srgb,#0b1022_72%,transparent)] text-[var(--space-text-muted)] opacity-0 hover:text-white focus:opacity-100 group-hover:opacity-100'}>
                              <Flag className="h-3 w-3" />
                            </button>
                          </div>;
                        })}
                      </div>
                      {visibleAvatars.length > avatarLimit ? <button type="button" onClick={() => setAvatarLimit((old) => old + 48)} className="mt-3 w-full rounded-xl border border-dashed border-[var(--space-border-strong)] py-3 text-sm font-medium text-[var(--space-text-secondary)] hover:bg-[color-mix(in_srgb,#ffffff_5%,transparent)]">Show more ({visibleAvatars.length - avatarLimit} remaining)</button> : null}
                    </>}
            </>}
          </Step>

          <Step n={2} done={Boolean(chosenVoiceId)} title="Pick the voice"
            hint={voiceEngine === 'elevenlabs'
              ? (elevenVoices.length
                ? `${elevenVoices.length} ElevenLabs voices${elevenVoices.some((voice) => voice.category === 'cloned') ? ', including your own clones' : ''} · ${indianElevenVoices.length} Indian, listed first`
                : 'Loading the ElevenLabs voice catalog')
              : (voiceLibrary.length ? `${voiceLibrary.length} live HeyGen voices · Indian voices listed first` : 'Loading your HeyGen voices')}>
            <div className="mb-3 space-y-2">
              <Segmented value={voiceEngine}
                onChange={(value) => { setVoiceEngine(value); try { window.localStorage.setItem(VOICE_ENGINE_KEY, value); } catch { /* private mode — the choice just does not persist */ } }}
                options={[{ value: 'elevenlabs' as VoiceEngine, label: 'ElevenLabs', icon: Mic }, { value: 'heygen' as VoiceEngine, label: 'HeyGen voices', icon: Volume2 }]} />
              <p className="text-[11px] leading-relaxed text-[var(--space-text-muted)]">
                {voiceEngine === 'elevenlabs'
                  ? 'ElevenLabs narrates your script first, then HeyGen lip-syncs the avatar to that exact track \u2014 so HeyGen\u2019s own text-to-speech is never used and the voice you audition below is the voice on the finished video.'
                  : 'HeyGen reads the script in its own voice as it renders. One step fewer, but you cannot hear the delivery before paying for the render.'}
              </p>
              {voiceEngine === 'elevenlabs' && audioCompatible === false ? <Notice tone="error" title="This presenter cannot take a ready-made voice track"
                action={<button type="button" onClick={() => { setVoiceEngine('heygen'); try { window.localStorage.setItem(VOICE_ENGINE_KEY, 'heygen'); } catch { /* ignore */ } }}
                  className="rounded-lg border border-[var(--space-border-strong)] px-3 py-2 text-xs font-semibold text-[var(--space-text-primary)]">Use HeyGen voices</button>}>
                {selectedAvatar?.name || 'This look'} is missing from the HeyGen catalog that accepts audio-driven lip-sync. Pick a different presenter, or switch this render to HeyGen voices.
              </Notice> : null}
            </div>
            {voiceEngine === 'elevenlabs' ? <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" aria-expanded={cloneOpen} onClick={() => { setCloneOpen((open) => !open); setCloneError(''); }} disabled={cloneRecording}
                  className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,#8b5cf6_42%,transparent)] bg-[color-mix(in_srgb,#8b5cf6_10%,transparent)] px-3 py-2 text-xs font-semibold text-[#c4b5fd] hover:bg-[color-mix(in_srgb,#8b5cf6_18%,transparent)] disabled:opacity-50">
                  <Mic className="h-3.5 w-3.5" />Clone your own voice
                </button>
              </div>

              {cloneOpen ? <div className="st-rise rounded-xl border border-[color-mix(in_srgb,#8b5cf6_38%,transparent)] bg-[color-mix(in_srgb,#8b5cf6_8%,var(--space-surface-panel))] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--space-text-primary)]">Clone your own voice</h3>
                    <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--space-text-muted)]">Use 1\u20135 clean speech samples, ideally 1\u20133 minutes total. MP3, WAV, WebM, OGG, M4A, AAC and FLAC are supported; each file can be up to 10 MB and all files together up to 25 MB.</p>
                  </div>
                  <span className="rounded-full bg-[color-mix(in_srgb,#f59e0b_18%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[#fcd34d]">$1.00 per voice</span>
                </div>
                <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,#f59e0b_28%,transparent)] bg-[color-mix(in_srgb,#f59e0b_8%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--space-text-secondary)]">
                  Voice cloning costs $1.00 from this workspace\u2019s wallet. If creation fails, the charge is refunded automatically.
                </p>
                <label className="mt-3 block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Voice name</span>
                  <input value={cloneName} onChange={(event) => { setCloneName(event.target.value); setCloneError(''); }} maxLength={80} placeholder="e.g. My studio voice" className="st-field mt-1" />
                  <span className="mt-1 block text-right text-[10px] text-[var(--space-text-muted)]">{cloneName.trim().length} / 80</span>
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--space-border-strong)] px-3 py-2 text-xs font-semibold text-[var(--space-text-secondary)] hover:text-[var(--space-text-primary)]">
                    <input ref={cloneFileInput} type="file" accept={CLONE_AUDIO_ACCEPT} multiple className="sr-only"
                      onChange={(event) => { addCloneSamples(Array.from(event.target.files || [])); event.target.value = ''; }} />
                    <Download className="h-3.5 w-3.5 rotate-180" />Choose audio
                  </label>
                  <button type="button" onClick={() => void toggleCloneRecording()} disabled={cloneBusy || (!cloneRecording && cloneSamples.length >= MAX_CLONE_SAMPLES)}
                    className={cloneRecording
                      ? 'flex items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_22%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--space-semantic-danger)]'
                      : 'flex items-center gap-1.5 rounded-lg border border-[var(--space-border-strong)] px-3 py-2 text-xs font-semibold text-[var(--space-text-secondary)] disabled:opacity-40'}>
                    {cloneRecording ? <><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--space-semantic-danger)]" />Stop recording</> : <><Mic className="h-3.5 w-3.5" />Record sample</>}
                  </button>
                </div>
                {cloneSamples.length ? <ul className="mt-3 space-y-1.5">
                  {cloneSamples.map((file, index) => <li key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-[var(--space-text-secondary)]">{file.name}</span>
                    <span className="shrink-0 text-[10px] text-[var(--space-text-muted)]">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button type="button" onClick={() => setCloneSamples((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`} className="rounded p-1 text-[var(--space-text-muted)] hover:text-[var(--space-semantic-danger)]"><X className="h-3.5 w-3.5" /></button>
                  </li>)}
                </ul> : <p className="mt-3 text-[11px] text-[var(--space-text-muted)]">No samples added yet. Pick files or record directly from your microphone.</p>}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[10px] text-[var(--space-text-muted)]">{cloneSamples.length} / {MAX_CLONE_SAMPLES} samples · {(cloneTotalBytes / 1024 / 1024).toFixed(1)} / 25 MB</span>
                  <button type="button" onClick={() => void createClone()} disabled={cloneBusy || cloneRecording}
                    className="flex items-center gap-2 rounded-lg bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-4 py-2 text-xs font-bold text-white shadow-[0_4px_14px_rgba(99,102,241,.3)] disabled:opacity-50">
                    {cloneBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{cloneBusy ? 'Cloning voice\u2026' : 'Clone voice · $1.00'}
                  </button>
                </div>
              </div> : null}

              {cloneError ? <Notice tone="error" title="Voice cloning needs attention">{cloneError}</Notice> : null}
              {cloneSuccess ? <div role="status" className="rounded-xl border border-[color-mix(in_srgb,#34d399_35%,transparent)] bg-[color-mix(in_srgb,#34d399_10%,transparent)] px-4 py-3 text-xs font-medium text-[#6ee7b7]">{cloneSuccess}</div> : null}

              <ElevenVoicePicker voices={elevenVoices} value={elevenVoiceId} onChange={setElevenVoiceId} settings={settings} loading={elevenLoading} error={elevenError}
                renderActions={(voice) => elevenCloned && voice.category === 'cloned' ? (confirmDeleteVoiceId === voice.id
                  ? <span className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => void removeClonedVoice(voice.id)} disabled={Boolean(deleteVoiceId)} className="rounded-md bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_20%,transparent)] px-2 py-1 text-[10px] font-bold text-[var(--space-semantic-danger)] disabled:opacity-50">{deleteVoiceId === voice.id ? 'Deleting\u2026' : 'Confirm delete'}</button>
                    <button type="button" onClick={() => setConfirmDeleteVoiceId('')} disabled={Boolean(deleteVoiceId)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-[var(--space-text-muted)]">Keep</button>
                  </span>
                  : <button type="button" onClick={() => setConfirmDeleteVoiceId(voice.id)} aria-label={`Delete ${shortVoiceName(voice.name)}`} title="Delete this cloned voice" className="shrink-0 rounded-lg border border-[var(--space-border-strong)] p-2 text-[var(--space-text-muted)] hover:border-[color-mix(in_srgb,var(--space-semantic-danger-500)_45%,transparent)] hover:text-[var(--space-semantic-danger)]"><Trash2 className="h-3.5 w-3.5" /></button>) : null} />

              <details className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--space-text-secondary)]">Delivery settings</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Stability {settings.stability.toFixed(2)}</span>
                    <input type="range" min={0} max={1} step={0.01} value={settings.stability} onChange={(event) => setSettings((old) => ({ ...old, stability: Number(event.target.value) }))} className="mt-1 w-full" />
                    <span className="block text-[10px] leading-relaxed text-[var(--space-text-muted)]">Lower is more expressive and varied; higher is steadier and flatter.</span>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Similarity {settings.similarity_boost.toFixed(2)}</span>
                    <input type="range" min={0} max={1} step={0.01} value={settings.similarity_boost} onChange={(event) => setSettings((old) => ({ ...old, similarity_boost: Number(event.target.value) }))} className="mt-1 w-full" />
                    <span className="block text-[10px] leading-relaxed text-[var(--space-text-muted)]">How closely the delivery tracks the original voice.</span>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Style {settings.style.toFixed(2)}</span>
                    <input type="range" min={0} max={1} step={0.01} value={settings.style} onChange={(event) => setSettings((old) => ({ ...old, style: Number(event.target.value) }))} className="mt-1 w-full" />
                    <span className="block text-[10px] leading-relaxed text-[var(--space-text-muted)]">Style exaggeration. Higher is more dramatic.</span>
                  </label>
                  <label className="flex items-start gap-2 pt-5 text-[11px] text-[var(--space-text-secondary)]">
                    <input type="checkbox" checked={settings.use_speaker_boost} onChange={(event) => setSettings((old) => ({ ...old, use_speaker_boost: event.target.checked }))} />
                    <span>Speaker boost — pushes the output closer to the original speaker.</span>
                  </label>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-[var(--space-text-muted)]">{MODEL_NOTE}</p>
                <button type="button" onClick={() => setSettings(PRESENTER_VOICE_SETTINGS)} className="mt-2 rounded-lg border border-[var(--space-border-default)] px-3 py-1.5 text-[11px] font-semibold text-[var(--space-text-secondary)]">Reset to the presenter preset</button>
              </details>

              {freshVoiceover ? <div className="rounded-xl border border-[color-mix(in_srgb,#34d399_35%,transparent)] bg-[color-mix(in_srgb,#34d399_10%,transparent)] p-3">
                <p className="text-xs font-semibold text-[#6ee7b7]">Voiceover ready — {(freshVoiceover.durationMs / 1000).toFixed(1)}s</p>
                <audio src={freshVoiceover.playbackUrl || freshVoiceover.url} controls className="mt-2 w-full" />
                <p className="mt-1 text-[10px] leading-relaxed text-[var(--space-text-muted)]">This is the exact track HeyGen lip-syncs to. Re-rendering only pays for another voiceover if you change the script or the voice.</p>
              </div> : null}
            </div> : needsKey ? null : voicesLoading && !voiceLibrary.length
              ? <div className="st-shimmer h-12 rounded-xl bg-[var(--space-surface-muted)]" />
              : voicesError && !voiceLibrary.length
                ? <Notice tone="error" title="The voice catalog did not load">{voicesError}</Notice>
                : <div ref={voiceBox} className="relative">
                  <button type="button" onClick={() => setVoiceOpen((open) => !open)} aria-expanded={voiceOpen} className="flex w-full items-center gap-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-4 py-3 text-left hover:border-[#6366f1]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--space-text-primary)]">{selectedVoice?.name || 'Choose a voice'}</span>
                      <span className="block truncate text-xs text-[var(--space-text-muted)]">{selectedVoice ? [selectedVoice.language, selectedVoice.gender, voiceAccent(selectedVoice.raw)].filter(Boolean).join(' · ') : 'Search by language, accent or name'}</span>
                    </span>
                    {selectedVoice?.indian ? <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,#8b5cf6_22%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[#c4b5fd]">India</span> : null}
                    <ChevronDown className={voiceOpen ? 'h-4 w-4 shrink-0 rotate-180 text-[var(--space-text-muted)]' : 'h-4 w-4 shrink-0 text-[var(--space-text-muted)]'} />
                  </button>
                  {voiceOpen ? <div className="st-rise absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-[var(--space-border-strong)] bg-[var(--space-surface-card)] shadow-2xl">
                    <div className="border-b border-[var(--space-border-default)] p-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--space-text-muted)]" />
                        <input ref={voiceFilter} value={voiceQuery} onChange={(event) => setVoiceQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') { event.preventDefault(); voiceFilter.current?.blur(); setVoiceOpen(false); }
                            else if (event.key === 'Enter') { event.preventDefault(); if (visibleVoices.length) chooseVoice(visibleVoices[0].id); }
                          }}
                          inputMode="search" autoComplete="off" placeholder="Filter by language, accent or name" className="st-field pl-9" />
                      </div>
                    </div>
                    <div className="st-scroll max-h-72 overflow-y-auto p-1">
                      {visibleVoices.length ? visibleVoices.slice(0, 120).map((view) => {
                        const selected = view.id === voiceId;
                        const unsupported = view.raw?.v3_supported === false;
                        // The tap must not blur the filter input: on a phone that blur
                        // dismisses the keyboard mid-gesture, the list shifts under the
                        // finger, and the click that commits the voice lands on nothing.
                        return <button key={view.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseVoice(view.id)}
                          className={selected
                            ? 'flex w-full items-center gap-3 rounded-lg bg-[color-mix(in_srgb,#8b5cf6_16%,transparent)] px-3 py-2 text-left'
                            : 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[color-mix(in_srgb,#ffffff_6%,transparent)]'}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-[var(--space-text-primary)]">{view.name}</span>
                            <span className="block truncate text-[11px] text-[var(--space-text-muted)]">{[view.language, view.gender, voiceAccent(view.raw)].filter(Boolean).join(' · ')}{unsupported ? ' · v2 only' : ''}</span>
                          </span>
                          {view.indian ? <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,#8b5cf6_22%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[#c4b5fd]">India</span> : null}
                          {selected ? <Check className="h-4 w-4 shrink-0 text-[#a78bfa]" /> : null}
                        </button>;
                      }) : <p className="px-3 py-6 text-center text-sm text-[var(--space-text-muted)]">No voice matches that search.</p>}
                    </div>
                  </div> : null}
                </div>}
          </Step>

          <Step n={3} done={Boolean(script.trim())} title="Write the script" hint="Exactly these words are spoken on camera."
            action={<button type="button" onClick={() => void polish()} disabled={!script.trim() || polishing}
              className="flex items-center gap-1.5 rounded-xl border border-[color-mix(in_srgb,#8b5cf6_45%,transparent)] bg-[color-mix(in_srgb,#8b5cf6_14%,transparent)] px-3 py-2 text-xs font-semibold text-[#c4b5fd] disabled:opacity-40">
              {polishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Improve script
            </button>}>
            <textarea value={script} onChange={(event) => { setScript(event.target.value.slice(0, MAX_SCRIPT + 200)); setScriptNote(''); }} rows={7}
              placeholder="Write your script here... The avatar will speak this text."
              className="st-field resize-y leading-relaxed" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className={script.length > MAX_SCRIPT ? 'font-semibold text-[var(--space-semantic-danger)]' : 'text-[var(--space-text-muted)]'}>{script.length} / {MAX_SCRIPT} chars{script.length > MAX_SCRIPT ? ' — trim before generating' : ''}</span>
              <span className="text-[var(--space-text-muted)]">Roughly {Math.max(1, Math.round(script.trim().split(/\s+/).filter(Boolean).length / 2.4))}s of speech</span>
            </div>
            {scriptNote ? <p className="mt-2 text-xs text-[var(--space-text-secondary)]">{scriptNote}</p> : null}
          </Step>

          <Step n={4} done title="Video settings" hint="Portrait fills the frame for Reels, Shorts and status posts.">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Aspect ratio</p>
                <Segmented value={aspectRatio} onChange={(value) => setAspectRatio(value)} options={[{ value: '9:16', label: 'Portrait 9:16', icon: Smartphone }, { value: '16:9', label: 'Landscape 16:9', icon: Monitor }]} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Resolution</p>
                <Segmented value={resolution} onChange={(value) => setResolution(value)} options={[{ value: '1080p', label: '1080p' }, { value: '720p', label: '720p' }]} />
              </div>
              <div className="sm:col-span-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Background</p>
                <Segmented value={backgroundMode} onChange={(value) => setBackgroundMode(value)} options={[{ value: 'color', label: 'Colour', icon: Palette }, { value: 'image', label: 'Image URL', icon: ImageIcon }, { value: 'original', label: 'Avatar\u2019s own' }]} />
                {backgroundMode === 'color' ? <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} aria-label="Background colour" className="h-10 w-16 cursor-pointer rounded-lg border border-[var(--space-border-default)] bg-transparent" />
                  <div className="flex flex-wrap gap-2">
                    {['#0f172a', '#1e1b4b', '#111827', '#f8fafc', '#065f46', '#7c2d12'].map((swatch) => <button key={swatch} type="button" onClick={() => setBackgroundColor(swatch)} aria-label={`Use ${swatch}`}
                      className={backgroundColor.toLowerCase() === swatch ? 'h-8 w-8 rounded-lg border-2 border-[#8b5cf6]' : 'h-8 w-8 rounded-lg border border-[var(--space-border-strong)]'} style={{ background: swatch }} />)}
                  </div>
                  <span className="text-xs text-[var(--space-text-muted)]">{backgroundColor}</span>
                </div> : null}
                {backgroundMode === 'image' ? <input value={backgroundImageUrl} onChange={(event) => setBackgroundImageUrl(event.target.value)} placeholder="https://… a public image URL" className="st-field mt-3" /> : null}
                {backgroundMode === 'original' ? <p className="mt-3 text-xs leading-relaxed text-[var(--space-text-muted)]">No background is sent, so HeyGen keeps the backdrop baked into the avatar look. HeyGen v3 exposes colour and image backgrounds only — there is no blur option on this endpoint.</p> : null}
              </div>
              <div className="sm:col-span-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Speaking speed · {speed.toFixed(2)}x</p>
                <input type="range" min={0.8} max={1.5} step={0.05} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} disabled={voiceEngine === 'elevenlabs'} className="w-full disabled:opacity-40" />
                <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]"><span>0.8x relaxed</span><span>1.0x natural</span><span>1.5x brisk</span></div>
                {voiceEngine === 'elevenlabs' ? <p className="mt-2 text-[11px] leading-relaxed text-[var(--space-text-muted)]">
                  Speed is set by the ElevenLabs track, not by HeyGen, so this slider does nothing on this engine — shape the delivery with Stability and Style in step 2 instead.
                </p> : null}
              </div>
            </div>
          </Step>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="st-rise rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
            <h2 className="text-sm font-bold uppercase tracking-[.16em] text-[var(--space-text-muted)]">Your video</h2>

            <div className={portrait ? 'mx-auto mt-4 w-full max-w-[220px]' : 'mt-4 w-full'}>
              <div className={portrait ? 'relative aspect-[9/16] overflow-hidden rounded-xl border border-[var(--space-border-strong)] bg-black' : 'relative aspect-video overflow-hidden rounded-xl border border-[var(--space-border-strong)] bg-black'}>
                {videoUrl
                  ? <video key={videoUrl} src={videoUrl} poster={thumbnailUrl || undefined} controls playsInline onError={() => void refreshVideoLink(videoId, videoUrl).catch((e: any) => setRenderError(String(e?.message || e)))} className="h-full w-full object-contain" />
                  : selectedAvatar?.image
                    ? <img src={selectedAvatar.image} alt={selectedAvatar.name} className="h-full w-full object-cover opacity-60" />
                    : <div className="flex h-full w-full items-center justify-center text-xs text-[var(--space-text-muted)]">Preview appears here</div>}
                {busy ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[color-mix(in_srgb,#0b1022_72%,transparent)] backdrop-blur-sm">
                  <Loader2 className="h-7 w-7 animate-spin text-[#a78bfa]" />
                  <span className="px-3 text-center text-[11px] font-medium text-[var(--space-text-secondary)]">{stageLabel}</span>
                </div> : null}
              </div>
            </div>

            {refreshingLink ? <p className="mt-2 flex items-center justify-center gap-2 text-xs text-[var(--space-text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin text-[#a78bfa]" />Refreshing video link…</p> : null}

            <dl className="mt-4 space-y-1.5 text-xs">
              <div className="flex gap-2"><dt className="w-20 shrink-0 text-[var(--space-text-muted)]">Avatar</dt><dd className="min-w-0 flex-1 truncate text-[var(--space-text-secondary)]">{selectedAvatar?.name || 'Not chosen'}</dd></div>
              <div className="flex gap-2"><dt className="w-20 shrink-0 text-[var(--space-text-muted)]">Voice</dt><dd className="min-w-0 flex-1 truncate text-[var(--space-text-secondary)]">{voiceEngine === 'elevenlabs' ? (selectedEleven ? `${shortVoiceName(selectedEleven.name)} · ElevenLabs` : 'Not chosen') : (selectedVoice?.name ? `${selectedVoice.name} · HeyGen` : 'Not chosen')}</dd></div>
              <div className="flex gap-2"><dt className="w-20 shrink-0 text-[var(--space-text-muted)]">Output</dt><dd className="min-w-0 flex-1 truncate text-[var(--space-text-secondary)]">{resolution} · {aspectRatio} · MP4</dd></div>
            </dl>

            {busy ? <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--space-surface-muted)]">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#6366f1,#8b5cf6)] transition-[width] duration-700 ease-out" style={{ width: `${Math.max(6, progress)}%` }} />
              </div>
              <ol className="mt-3 space-y-1">
                {pipelineSteps.map((step) => <li key={step.key} className="flex items-center gap-2 text-[11px]">
                  {step.state === 'done' ? <Check className="h-3 w-3 shrink-0 text-[#34d399]" />
                    : step.state === 'active' ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#a78bfa]" />
                      : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--space-border-strong)]" />}
                  <span className={step.state === 'todo' ? 'text-[var(--space-text-muted)]' : 'text-[var(--space-text-secondary)]'}>{step.label}</span>
                </li>)}
              </ol>
              <p className="mt-2 text-xs text-[var(--space-text-secondary)]">{stageLabel} (60–120s in total) · {elapsed}s elapsed</p>
              <p className="mt-1 text-[11px] text-[var(--space-text-muted)]">You can leave this open — the render is picked back up if the page reloads.</p>
            </div> : null}

            {renderError ? <div className="mt-4"><Notice tone="error" title="HeyGen could not finish this video">{renderError}</Notice></div> : null}

            {phase === 'done' && videoUrl ? <div className="mt-4 space-y-2">
              <button type="button" onClick={() => void save(videoUrl, videoId)} disabled={downloading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-4 py-3 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(99,102,241,.4)] disabled:opacity-60">
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download MP4
              </button>
              {onOpenEditor ? <button type="button" onClick={() => openEditor({ videoId, videoUrl, thumbnailUrl, aspectRatio, script: renderMeta.current.script || script })}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color-mix(in_srgb,#8b5cf6_45%,transparent)] bg-[color-mix(in_srgb,#8b5cf6_14%,transparent)] px-4 py-3 text-sm font-semibold text-[#c4b5fd] hover:bg-[color-mix(in_srgb,#8b5cf6_22%,transparent)]">
                <Wand2 className="h-4 w-4" />Add motion graphics
              </button> : null}
              <button type="button" onClick={() => { setPhase('idle'); setVideoUrl(''); setVideoId(''); setElapsed(0); }} className="w-full rounded-xl border border-[var(--space-border-strong)] px-4 py-2.5 text-sm font-medium text-[var(--space-text-secondary)] hover:bg-[color-mix(in_srgb,#ffffff_5%,transparent)]">Make another video</button>
            </div> : <button type="button" onClick={() => void generate()} disabled={!ready || busy}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] px-4 py-3.5 text-sm font-bold text-white shadow-[0_6px_20px_rgba(99,102,241,.4)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Generate video
            </button>}

            {!ready && !busy && phase !== 'done' ? <p className="mt-2 text-center text-[11px] text-[var(--space-text-muted)]">
              {!avatarId ? 'Pick an avatar to continue' : !chosenVoiceId ? 'Pick a voice to continue' : !script.trim() ? 'Write a script to continue' : 'Trim the script under the character limit'}
            </p> : null}
          </div>

          {history.length ? <div className="st-rise rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-[.16em] text-[var(--space-text-muted)]">Recent videos</h2>
              <button type="button" onClick={() => setHistory(clearHistory())} aria-label="Clear recent videos" className="rounded-lg p-1.5 text-[var(--space-text-muted)] hover:bg-[color-mix(in_srgb,#ffffff_6%,transparent)]"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <ul className="mt-3 space-y-2">
              {history.map((entry) => <li key={entry.videoId} className="flex gap-3 rounded-xl border border-[var(--space-border-default)] p-2">
                <button type="button" onClick={() => { setVideoUrl(entry.videoUrl); setThumbnailUrl(entry.thumbnailUrl); setVideoId(entry.videoId); setPhase('done'); }} className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-black">
                  {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center"><Play className="h-4 w-4 text-[var(--space-text-muted)]" /></span>}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs leading-snug text-[var(--space-text-secondary)]">{entry.script || 'Untitled script'}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">{[entry.avatarName, entry.aspectRatio, relativeDate(entry.createdAt)].filter(Boolean).join(' · ')}</p>
                </div>
                <button type="button" onClick={() => void save(entry.videoUrl, entry.videoId)} aria-label="Download this video" className="self-center rounded-lg border border-[var(--space-border-strong)] p-2 text-[var(--space-text-secondary)] hover:bg-[color-mix(in_srgb,#ffffff_6%,transparent)]"><Download className="h-3.5 w-3.5" /></button>
              </li>)}
            </ul>
          </div> : null}
        </aside>
      </div>
    </div>

    {historyOpen ? <div className="absolute inset-0 z-40 flex justify-end bg-[color-mix(in_srgb,#040713_64%,transparent)]" onClick={() => setHistoryOpen(false)}>
      <aside className="st-rise flex h-full w-full max-w-md flex-col border-l border-[var(--space-border-strong)] bg-[var(--space-surface-card)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--space-border-default)] px-5 py-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">Recent videos</h2>
            <p className="text-xs text-[var(--space-text-muted)]">The last {history.length || 'few'} renders from this browser.</p>
          </div>
          <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close recent videos" className="rounded-lg p-1.5 hover:bg-[color-mix(in_srgb,#ffffff_7%,transparent)]"><X className="h-5 w-5" /></button>
        </div>
        <div className="st-scroll flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {history.length ? history.map((entry) => <div key={entry.videoId} className="rounded-xl border border-[var(--space-border-default)] p-3">
            <video key={entry.videoUrl} src={entry.videoUrl} poster={entry.thumbnailUrl || undefined} controls playsInline onError={() => void refreshVideoLink(entry.videoId, entry.videoUrl).catch((e: any) => setRenderError(String(e?.message || e)))} className="max-h-64 w-full rounded-lg bg-black" />
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--space-text-secondary)]">{entry.script}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">{[entry.avatarName, entry.voiceName, entry.aspectRatio, relativeDate(entry.createdAt)].filter(Boolean).join(' · ')}</span>
              <span className="flex items-center gap-1.5">
                {onOpenEditor ? <button type="button" onClick={() => { setHistoryOpen(false); openEditor(entry); }} className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,#8b5cf6_45%,transparent)] px-2.5 py-1.5 text-xs font-medium text-[#c4b5fd]"><Wand2 className="h-3.5 w-3.5" />Edit</button> : null}
                <button type="button" onClick={() => void save(entry.videoUrl, entry.videoId)} className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--space-text-secondary)]"><Download className="h-3.5 w-3.5" />MP4</button>
              </span>
            </div>
          </div>) : <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--space-border-strong)] px-6 py-12 text-center">
            <Wand2 className="h-6 w-6 text-[#a78bfa]" />
            <p className="text-sm font-semibold">Nothing here yet</p>
            <p className="text-xs text-[var(--space-text-muted)]">Generate your first avatar video and it lands here with a one-tap MP4 download.</p>
          </div>}
        </div>
      </aside>
    </div> : null}
  </div>;
}
