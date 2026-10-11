// STUDIO WORKBENCH — SceneForge's single working surface.
//
// One screen, four regions, no nested menus for anything a customer does
// often (Runway / CapCut / Pika shape):
//
//   TOP BAR  — app name, provider selector (with live configured / not
//              configured state), Generate All, Export.
//   CENTRE   — the large video preview: the finished film, or whichever
//              scene clip is selected in the timeline.
//   BOTTOM   — a horizontal, scrollable scene timeline of 120px cards:
//              thumbnail, scene number, duration, status. Click opens the
//              scene in the preview; right-click regenerates / edits / deletes.
//   RIGHT    — one collapsible sidebar holding Script, Character, Style,
//              Audio (per-scene voiceover / lip-sync), Music, Scene Context
//              (Gemini Vision) and B-roll.
//
// Everything here is presentational plus local editing state; every action is
// a prop so the pipeline logic stays in App.tsx where it already lives.

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Circle, Clapperboard, Clock, Download, FileText,
  Film, Layers, MessageSquareText, Mic, Music, Palette, Pencil, Play, Plus, RefreshCw, Search,
  Settings, Sparkles, Trash2, Upload, User, Volume2, VolumeX, Wand2, X, XCircle,
} from 'lucide-react';
import type { Project, Scene } from '../lib/supabase';
import type { GenerationEstimate, ProviderStatus } from '../lib/providers';
import { describeEstimate, humanDuration } from '../lib/providers';
import type { AudioConfig, AudioMode, StudioConfig, SidebarTab, TransitionStyle } from '../lib/studioConfig';
import { emptySceneAudio, lineFor, lipsyncState, overrunningScenes, scenesNeedingLipsync, scenesNeedingVoice, voicedScenes, voiceoverState } from '../lib/sceneAudio';
import { MODEL_NOTE, type ElevenVoice, type VoiceSettings } from '../lib/elevenLabs';
import ElevenVoicePicker from './ElevenVoicePicker';
import { rememberNarrationVoice, resolveNarrationVoiceId, setVoicePipeline, voicePipeline } from '../lib/voicePipeline';
import { brollSuggestions, visionOf } from '../lib/sceneVision';
import { BROLL_POSITIONS, brollOf, defaultBrollFor, searchPexelsVideos, sceneWindowSec, uploadBrollClip, type BrollClip, type BrollPosition, type PexelsClip } from '../lib/broll';
import { isVideoUrl, sceneSettled } from '../lib/sceneState';
import { KIND_LABELS, visualKindOf } from '../lib/effects';
import { sortAvatars, sortVoices, withIndiaSeedVoices } from '../lib/heygenCatalog';
import VideoIntegrationPicker from '../../../components/VideoIntegrationPicker';
import VergeLoader from '../../../components/VergeLoader';
import { defaultModelForIntegration, integrationForEngineId, type VideoIntegrationId } from '../../../lib/videoIntegrations';

/** Live state of a Generate All run, so the bar can say "Generating scene 2 of 4". */
export interface SceneProgress {
  active: boolean;
  done: number;
  total: number;
  /** The scene_index currently in flight, when exactly one is. */
  currentIndex: number | null;
  /** Seconds still expected for the whole run. */
  etaSec: number;
  message: string;
}

export interface StudioWorkbenchProps {
  project: Project;
  scenes: Scene[];
  config: StudioConfig;
  onConfig: (patch: Partial<StudioConfig>) => void;
  providers: ProviderStatus[];
  providersLoading: boolean;
  onRefreshProviders: () => void;
  estimate: GenerationEstimate;
  progress: SceneProgress;
  busy: boolean;
  note: string;
  error: string;
  onDismissError: () => void;
  selectedSceneId: string | null;
  onSelectScene: (id: string | null) => void;
  onGenerateAll: () => void;
  onCancelGenerate: () => void;
  onExport: () => void;
  onDownload: () => void;
  exportBusy: boolean;
  exportProgress: number;
  exportMessage: string;
  finalVideoUrl: string;
  onRegenerateScene: (scene: Scene) => void;
  onDeleteScene: (scene: Scene) => void;
  onAddScene: () => void;
  /** Error recovery: a scene that cannot be filmed becomes deterministic
   * text/graphics, or steps out of the film entirely, in one click. */
  onConvertScene: (scene: Scene) => void;
  onFilmAsVideo: (scene: Scene) => void;
  onSkipScene: (scene: Scene) => void;
  onUnskipScene: (scene: Scene) => void;
  onEditSceneScript: (scene: Scene, description: string) => void;
  onUploadSceneMedia: (scene: Scene, file: File) => void;
  generatingSceneId: string | null;
  onSaveScript: (script: string) => void;
  onRewriteScript: (direction: string) => void;
  onPlanScenes: () => void;
  onAnalyzeScene: (scene: Scene) => void;
  analyzingSceneId: string | null;
  onAutoGraphics: () => void;
  autoGraphicsBusy: boolean;
  autoGraphicsNote: string;
  onSetBroll: (scene: Scene, clip: BrollClip | null) => void;
  onGenerateMusic: (prompt: string) => void;
  onMixMusic: () => void;
  musicBusy: boolean;
  musicNote: string;
  onUploadAudioTrack: (file: File) => void;
  /** Per-scene speech (the Audio tab). The ElevenLabs catalog is loaded once
   * by the pipeline; the two actions run the batch narration and the HeyGen
   * lip-sync pass over whatever the saved config says is stale. */
  elevenVoices: ElevenVoice[];
  elevenVoicesLoading: boolean;
  elevenVoicesError: string;
  onNarrateScenes: () => void;
  onLipsyncScenes: () => void;
  audioBusy: boolean;
  audioNote: string;
  avatars: any[];
  voices: any[];
  charactersLoading: boolean;
  charactersError: string;
  characterNote: string;
  /** `voice_engine` and `eleven_voice_id` choose which pipeline narrates this
   * presenter master — see lib/voicePipeline. */
  onGenerateAvatar: (options: { avatar_id: string; voice_id: string; voice_engine: 'elevenlabs' | 'heygen'; eleven_voice_id: string }) => void;
  onUploadCharacterPhoto: (file: File) => void;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
  onOpenAssistant: () => void;
}

// --------------------------------------------------------------------------
// Small shared pieces
// --------------------------------------------------------------------------

type SceneStatus = 'pending' | 'generating' | 'done' | 'error' | 'skipped';

function statusOf(scene: Scene, generatingSceneId: string | null): SceneStatus {
  if (scene.status === 'skipped') return 'skipped';
  if (scene.status === 'error') return 'error';
  if (scene.status === 'generating' || generatingSceneId === scene.id) return 'generating';
  return sceneSettled(scene) ? 'done' : 'pending';
}

function StatusIcon({ status }: { status: SceneStatus }) {
  if (status === 'generating') return <VergeLoader size={30} label="Working" />;
  if (status === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-[var(--sf-ok)]" />;
  if (status === 'error') return <XCircle className="h-3.5 w-3.5 text-[var(--sf-bad)]" />;
  return <Circle className="h-3.5 w-3.5 text-[var(--sf-dim)]" />;
}

/** Every sidebar panel sees the whole workbench plus the selected scene. */
type PanelProps = StudioWorkbenchProps & { selected: Scene | null };

const secondsLabel = (scene: Scene) => {
  const span = sceneWindowSec(scene);
  return span >= 10 ? `${Math.round(span)}s` : `${span.toFixed(1)}s`;
};

function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'warn' | 'brand' }) {
  const toneClass = tone === 'ok'
    ? 'bg-[color-mix(in_srgb,var(--sf-ok)_16%,transparent)] text-[var(--sf-ok)]'
    : tone === 'warn'
      ? 'bg-[color-mix(in_srgb,var(--sf-warn)_18%,transparent)] text-[var(--sf-warn)]'
      : tone === 'brand'
        ? 'bg-[color-mix(in_srgb,var(--sf-accent)_18%,transparent)] text-[var(--sf-accent-text)]'
        : 'bg-[var(--sf-chip)] text-[var(--sf-dim)]';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneClass}`}>{children}</span>;
}

/**
 * A labelled control.
 *
 * `error` puts the reason UNDER the field that caused it, in red, beside the red
 * border the control itself takes on — a toast that disappears leaves the
 * customer staring at a form with no idea which field is wrong.
 */
function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className="block">
    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--sf-dim)]">{label}</span>
    {children}
    {error
      ? <span role="alert" className="mt-1.5 block text-[11px] leading-relaxed text-[var(--sf-bad)]">{error}</span>
      : hint ? <span className="mt-1.5 block text-[11px] leading-relaxed text-[var(--sf-dim)]">{hint}</span> : null}
  </label>;
}

// ONE geometry for every control on this surface: a 44px minimum height, the
// same radius and padding as the studio's `.st-field` (styles/fieldStyles), and
// a focus RING rather than a border that merely changes colour by a shade.
// Mismatched heights down a column of controls is what made these panels read as
// assembled rather than designed.
//
// `min-h-11` rather than a fixed height on purpose: the same class dresses
// single-line inputs, selects AND textareas, and a textarea has to be free to
// grow to its `rows`.
const FIELD_BASE = 'w-full rounded-xl border bg-[var(--sf-sunken)] px-3.5 py-2.5 text-sm leading-normal text-[var(--sf-text)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--sf-dim)] disabled:cursor-not-allowed disabled:opacity-55';
const FIELD_RESTING = 'border-[var(--sf-line)] hover:border-[var(--sf-dim)] focus:border-[var(--sf-accent)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--sf-accent)_40%,transparent)]';
const FIELD_INVALID = 'border-[var(--sf-bad)] focus:border-[var(--sf-bad)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--sf-bad)_38%,transparent)]';
const inputClass = `min-h-11 ${FIELD_BASE} ${FIELD_RESTING}`;
/** The same control, in its error state. Pair it with `Field`'s `error`. */
const invalidInputClass = `min-h-11 ${FIELD_BASE} ${FIELD_INVALID}`;
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--sf-line)] px-3.5 text-xs font-semibold text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-chip)] disabled:cursor-not-allowed disabled:opacity-40';
const primaryClass = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--sf-accent)] px-4 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';

// --------------------------------------------------------------------------
// Scene card
// --------------------------------------------------------------------------

function SceneThumb({ scene, status }: { scene: Scene; status: SceneStatus }) {
  const url = String(scene.render_url || '');
  if (status === 'generating' || (!url && status === 'pending')) {
    return status === 'generating'
      ? <div className="flex h-full w-full items-center justify-center bg-[var(--sf-sunken)]"><VergeLoader size={64} label="Generating this scene" /></div>
      : <div className="h-full w-full bg-[var(--sf-sunken)] opacity-50" />;
  }
  if (!url) return <div className="flex h-full w-full items-center justify-center bg-[var(--sf-sunken)]"><Film className="h-4 w-4 text-[var(--sf-dim)]" /></div>;
  if (isVideoUrl(url)) {
    // A real frame from the generated clip — seeked just past the fade-up so
    // the card shows the shot, not black.
    return <video src={`${url}#t=0.6`} muted playsInline preload="metadata" className="h-full w-full object-cover" />;
  }
  return <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />;
}

interface SceneCardProps {
  scene: Scene;
  status: SceneStatus;
  selected: boolean;
  hasBroll: boolean;
  hasGraphics: boolean;
  onSelect: () => void;
  onMenu: (event: MouseEvent) => void;
}

function SceneCard({ scene, status, selected, hasBroll, hasGraphics, onSelect, onMenu }: SceneCardProps) {
  return <div
    role="button"
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}
    onContextMenu={onMenu}
    aria-label={`Scene ${scene.scene_index}, ${status}`}
    className={`group relative w-[120px] shrink-0 cursor-pointer overflow-hidden rounded-xl border bg-[var(--sf-panel)] text-left transition-all ${selected ? 'border-[var(--sf-accent)] shadow-[0_0_0_1px_var(--sf-accent)]' : 'border-[var(--sf-line)] hover:border-[var(--sf-line-strong)]'}`}
  >
    <div className="relative h-[68px] w-full overflow-hidden bg-[var(--sf-sunken)]">
      <SceneThumb scene={scene} status={status} />
      <span className="absolute left-1.5 top-1.5 rounded-md bg-[rgba(4,6,14,0.78)] px-1.5 py-0.5 text-[10px] font-bold text-white">{scene.scene_index}</span>
      <span className="absolute bottom-1.5 right-1.5 rounded-md bg-[rgba(4,6,14,0.78)] px-1.5 py-0.5 text-[10px] font-semibold text-white">{secondsLabel(scene)}</span>
      {status === 'generating' ? <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[var(--sf-line)]"><span className="sf-bar block h-full w-1/3 bg-[var(--sf-info)]" /></span> : null}
    </div>
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      <StatusIcon status={status} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--sf-dim)]">{KIND_LABELS[visualKindOf(scene.visual_kind)]}</span>
      {hasGraphics ? <Layers className="h-3 w-3 shrink-0 text-[var(--sf-accent-text)]" /> : null}
      {hasBroll ? <Film className="h-3 w-3 shrink-0 text-[var(--sf-accent-text)]" /> : null}
    </div>
    <button
      type="button"
      aria-label={`Scene ${scene.scene_index} actions`}
      onClick={(event) => { event.stopPropagation(); onMenu(event); }}
      className="absolute right-1 top-1 rounded-md bg-[rgba(4,6,14,0.78)] px-1.5 py-0.5 text-[11px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
    >⋯</button>
  </div>;
}

// --------------------------------------------------------------------------
// Workbench
// --------------------------------------------------------------------------

export default function StudioWorkbench(props: StudioWorkbenchProps) {
  const {
    project, scenes, config, onConfig, providers, providersLoading, onRefreshProviders,
    estimate, progress, busy, note, error, onDismissError, selectedSceneId, onSelectScene,
    onGenerateAll, onCancelGenerate, onExport, exportBusy, exportProgress, exportMessage, finalVideoUrl,
    onRegenerateScene, onDeleteScene, onEditSceneScript, onUploadSceneMedia, generatingSceneId,
  } = props;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menu, setMenu] = useState<{ scene: Scene; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ scene: Scene; text: string } | null>(null);
  const sceneUploadRef = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<Scene | null>(null);

  const ordered = useMemo(() => [...scenes].sort((a, b) => a.scene_index - b.scene_index), [scenes]);
  const selected = ordered.find((scene) => scene.id === selectedSceneId) || null;
  const sceneProvider = providers.find((entry) => entry.id === config.provider) || null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [menu]);

  const openMenu = (scene: Scene, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ scene, x: Math.min(event.clientX, window.innerWidth - 210), y: Math.min(event.clientY, window.innerHeight - 180) });
  };

  const previewUrl = selected?.render_url && isVideoUrl(selected.render_url)
    ? String(selected.render_url)
    : finalVideoUrl;
  const previewStill = selected?.render_url && !isVideoUrl(selected.render_url) ? String(selected.render_url) : '';

  const readyCount = ordered.filter((scene) => statusOf(scene, generatingSceneId) === 'done').length;
  const errorCount = ordered.filter((scene) => statusOf(scene, generatingSceneId) === 'error').length;

  return <div className="sf-studio flex h-full min-h-[560px] flex-col overflow-hidden bg-[var(--sf-bg)] text-[var(--sf-text)]">
    <style>{`
      .sf-studio {
        --sf-bg: color-mix(in srgb, var(--space-surface-bg) 86%, #FFF3D6);
        --sf-panel: color-mix(in srgb, var(--space-surface-card) 88%, #FFFFFF);
        --sf-sunken: color-mix(in srgb, var(--space-surface-panel) 72%, #FFFAEB);
        --sf-chip: color-mix(in srgb, var(--space-text-primary) 7%, transparent);
        --sf-line: color-mix(in srgb, var(--space-border-default) 80%, transparent);
        --sf-line-strong: var(--space-border-strong);
        --sf-text: var(--space-text-primary);
        --sf-dim: var(--space-text-muted);
        --sf-accent: var(--space-brand-primary-600);
        --sf-accent-text: var(--space-text-brand);
        --sf-ok: var(--space-semantic-success);
        --sf-bad: var(--space-semantic-danger);
        --sf-warn: var(--space-semantic-warning, #f59e0b);
        --sf-info: var(--space-text-brand);
      }
      @keyframes sf-shimmer-slide { 0% { background-position: -160% 0; } 100% { background-position: 260% 0; } }
      @keyframes sf-bar-slide { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
      .sf-studio .sf-shimmer {
        background-image: linear-gradient(100deg, var(--sf-sunken) 20%, color-mix(in srgb, var(--space-text-primary) 12%, var(--sf-sunken)) 42%, var(--sf-sunken) 64%);
        background-size: 220% 100%;
        animation: sf-shimmer-slide 1.5s linear infinite;
      }
      .sf-studio .sf-bar { animation: sf-bar-slide 1.25s ease-in-out infinite; }
      .sf-studio .sf-rail::-webkit-scrollbar { height: 8px; }
      .sf-studio .sf-rail::-webkit-scrollbar-thumb { background: var(--sf-line); border-radius: 999px; }
      @media (prefers-reduced-motion: reduce) { .sf-studio .sf-shimmer, .sf-studio .sf-bar { animation: none; } }
    `}</style>

    {/* ---------------- TOP BAR ---------------- */}
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--sf-line)] bg-[var(--sf-panel)] px-3">
      <button onClick={props.onOpenLibrary} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-bold tracking-tight hover:bg-[var(--sf-chip)]">
        <Clapperboard className="h-4 w-4 text-[var(--sf-accent-text)]" />SceneForge
      </button>
      <span className="hidden min-w-0 truncate text-xs text-[var(--sf-dim)] md:block">{project.topic}</span>

      <div className="ml-auto flex items-center gap-2">
        <VideoIntegrationPicker
          sceneOnly
          className="hidden max-w-[420px] md:block"
          integration={(config.video_integration || integrationForEngineId(config.provider)) as VideoIntegrationId}
          model={config.provider || defaultModelForIntegration((config.video_integration || 'image-and-video-generation') as VideoIntegrationId)}
          onChange={(integration, model) => onConfig({ video_integration: integration, provider: model })}
          label="Scene provider"
        />
        {progress.active || exportBusy
          ? <button onClick={onCancelGenerate} className={buttonClass}><X className="h-3.5 w-3.5" />Cancel</button>
          : <button onClick={onGenerateAll} disabled={busy || !ordered.length} className={primaryClass} title={describeEstimate(estimate)}>
              <Sparkles className="h-3.5 w-3.5" />Generate All
            </button>}
        <button onClick={onExport} disabled={exportBusy || !ordered.length} className={buttonClass} title="Render the finished film: every clip plus the title card, lower thirds, transitions, B-roll and audio, in one server-side pass">
          {exportBusy ? <VergeLoader size={28} label="Exporting" /> : <Film className="h-3.5 w-3.5" />}Export
        </button>
        {finalVideoUrl ? <button onClick={props.onDownload} className={buttonClass} title="Save the finished MP4"><Download className="h-3.5 w-3.5" />MP4</button> : null}
        <button aria-label="Assistant" title="Ask the assistant" onClick={props.onOpenAssistant} className="rounded-lg border border-[var(--sf-line)] p-2 hover:bg-[var(--sf-chip)]"><MessageSquareText className="h-4 w-4" /></button>
        <button aria-label="Settings" onClick={props.onOpenSettings} className="rounded-lg border border-[var(--sf-line)] p-2 hover:bg-[var(--sf-chip)]"><Settings className="h-4 w-4" /></button>
        <button aria-label={sidebarOpen ? 'Hide panel' : 'Show panel'} onClick={() => setSidebarOpen((open) => !open)} className="rounded-lg border border-[var(--sf-line)] p-2 hover:bg-[var(--sf-chip)]">
          <ChevronRight className={`h-4 w-4 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} />
        </button>
      </div>
    </header>

    {/* ---------------- STATUS STRIP ---------------- */}
    {progress.active || exportBusy || error || note ? <div className="shrink-0 border-b border-[var(--sf-line)] bg-[var(--sf-sunken)] px-4 py-2">
      {error ? <div role="alert" className="flex items-start gap-2 text-xs leading-relaxed text-[var(--sf-text)]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--sf-bad)]" />
        <span className="min-w-0 flex-1">{error}</span>
        <button aria-label="Dismiss" onClick={onDismissError} className="shrink-0 rounded p-0.5 hover:bg-[var(--sf-chip)]"><X className="h-3.5 w-3.5" /></button>
      </div> : null}
      {progress.active ? <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--sf-dim)]">
        <VergeLoader size={30} label="Working" />
        <strong className="font-semibold text-[var(--sf-text)]">
          {progress.currentIndex
            ? `Generating scene ${progress.currentIndex} of ${progress.total}`
            : `Generating ${progress.done} of ${progress.total} scenes`}
        </strong>
        {progress.etaSec > 0 ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />about {humanDuration(progress.etaSec)} left</span> : null}
        <span className="min-w-0 flex-1 truncate">{progress.message || note}</span>
      </div> : null}
      {!progress.active && exportBusy ? <div className="mt-1 flex items-center gap-2 text-xs text-[var(--sf-dim)]">
        <VergeLoader size={30} label="Working" />
        <span className="min-w-0 flex-1 truncate">{exportMessage || 'Rendering the final MP4…'}</span>
        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--sf-line)]"><span className="block h-full rounded-full bg-[var(--sf-accent)] transition-all" style={{ width: `${Math.max(3, Math.min(100, exportProgress))}%` }} /></span>
      </div> : null}
      {!progress.active && !exportBusy && !error && note ? <div className="text-xs text-[var(--sf-dim)]">{note}</div> : null}
    </div> : null}

    {/* ---------------- BODY ---------------- */}
    <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        {/* PREVIEW — the dominant region */}
        <section className="relative flex min-h-0 flex-1 items-center justify-center bg-[#05060c] p-3">
          {previewUrl
            ? <video key={previewUrl} src={previewUrl} controls playsInline className="h-full max-h-full w-auto max-w-full rounded-xl bg-black shadow-[0_24px_80px_rgba(0,0,0,0.55)]" />
            : previewStill
              ? <img src={previewStill} alt="" className="h-full max-h-full w-auto max-w-full rounded-xl object-contain" />
              : <div className="flex max-w-md flex-col items-center text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--sf-chip)]"><Play className="h-6 w-6 text-[var(--sf-dim)]" /></span>
                  <p className="mt-4 text-sm font-semibold">{ordered.length ? 'Nothing rendered yet' : 'No scenes planned yet'}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--sf-dim)]">
                    {ordered.length
                      ? 'Press Generate All to produce every scene clip, then Export to render the finished film with its title card, lower thirds and transitions.'
                      : 'Write the script in the panel on the right, then plan the scenes to fill this timeline.'}
                  </p>
                </div>}
          {selected ? <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-2 rounded-lg bg-[rgba(4,6,14,0.8)] px-2.5 py-1.5 text-[11px] font-semibold text-white">
            Scene {selected.scene_index} · {secondsLabel(selected)} · {KIND_LABELS[visualKindOf(selected.visual_kind)]}
          </div> : null}
          {selected ? <button onClick={() => onSelectScene(null)} className="absolute right-5 top-5 rounded-lg bg-[rgba(4,6,14,0.8)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[rgba(4,6,14,0.95)]">Back to full film</button> : null}
        </section>

        {/* TIMELINE */}
        <section className="shrink-0 border-t border-[var(--sf-line)] bg-[var(--sf-panel)] px-3 py-2.5">
          <div className="mb-2 flex items-center gap-3 text-[11px] text-[var(--sf-dim)]">
            <span className="font-semibold uppercase tracking-[.14em]">Timeline</span>
            <span>{ordered.length} scene{ordered.length === 1 ? '' : 's'}</span>
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-[var(--sf-ok)]" />{readyCount} ready</span>
            {errorCount ? <span className="inline-flex items-center gap-1 text-[var(--sf-bad)]"><XCircle className="h-3 w-3" />{errorCount} failed</span> : null}
            {sceneProvider?.characterRef && config.character_photo_url && ordered.length > 1
              ? <Pill tone="brand"><User className="h-2.5 w-2.5" />Same character across {ordered.length} scenes</Pill>
              : null}
            <button onClick={props.onAddScene} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-[var(--sf-dim)] hover:bg-[var(--sf-chip)] hover:text-[var(--sf-text)]"><Plus className="h-3 w-3" />Add scene</button>
            <span className="ml-auto hidden lg:block">{describeEstimate(estimate)}</span>
          </div>
          <div className="sf-rail flex gap-2 overflow-x-auto pb-1">
            {ordered.map((scene) => <SceneCard
              key={scene.id}
              scene={scene}
              status={statusOf(scene, generatingSceneId)}
              selected={scene.id === selectedSceneId}
              hasBroll={Boolean(brollOf(scene))}
              hasGraphics={Array.isArray((scene as any).overlays) && (scene as any).overlays.length > 0}
              onSelect={() => onSelectScene(scene.id)}
              onMenu={(event) => openMenu(scene, event)}
            />)}
            {!ordered.length ? <div className="flex h-[104px] w-full items-center justify-center rounded-xl border border-dashed border-[var(--sf-line)] text-xs text-[var(--sf-dim)]">
              Scenes appear here once the script is planned.
            </div> : null}
          </div>
        </section>
      </main>

      {sidebarOpen ? <Sidebar {...props} selected={selected} /> : null}
    </div>

    {/* ---------------- CONTEXT MENU ---------------- */}
    {menu ? <div
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      className="fixed z-50 w-[200px] overflow-hidden rounded-xl border border-[var(--sf-line)] bg-[var(--sf-panel)] py-1 shadow-[0_18px_50px_rgba(120,80,0,0.18)]"
    >
      <button role="menuitem" onClick={() => { onRegenerateScene(menu.scene); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--sf-chip)]"><RefreshCw className="h-3.5 w-3.5" />Regenerate this scene</button>
      <button role="menuitem" onClick={() => { setEditing({ scene: menu.scene, text: String(menu.scene.description || '') }); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--sf-chip)]"><Pencil className="h-3.5 w-3.5" />Edit script</button>
      <button role="menuitem" onClick={() => { uploadTarget.current = menu.scene; sceneUploadRef.current?.click(); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--sf-chip)]"><Upload className="h-3.5 w-3.5" />Replace with upload</button>
      {visualKindOf(menu.scene.visual_kind) === 'ai_video'
        ? <button role="menuitem" onClick={() => { props.onConvertScene(menu.scene); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--sf-chip)]"><Layers className="h-3.5 w-3.5" />Switch to text / graphics</button>
        : <button role="menuitem" onClick={() => { props.onFilmAsVideo(menu.scene); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--sf-chip)]"><Film className="h-3.5 w-3.5" />Film this as AI video</button>}
      {menu.scene.status === 'skipped'
        ? <button role="menuitem" onClick={() => { props.onUnskipScene(menu.scene); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--sf-chip)]"><Play className="h-3.5 w-3.5" />Put scene back in the film</button>
        : <button role="menuitem" onClick={() => { props.onSkipScene(menu.scene); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--sf-chip)]"><X className="h-3.5 w-3.5" />Skip this scene</button>}
      <button role="menuitem" onClick={() => { onDeleteScene(menu.scene); setMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--sf-bad)] hover:bg-[var(--sf-chip)]"><Trash2 className="h-3.5 w-3.5" />Delete scene</button>
    </div> : null}

    <input
      ref={sceneUploadRef}
      type="file"
      accept="video/*,image/*"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        const scene = uploadTarget.current;
        event.target.value = '';
        if (file && scene) onUploadSceneMedia(scene, file);
      }}
    />

    {/* ---------------- SCENE SCRIPT EDITOR ---------------- */}
    {editing ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,16,0,0.35)] p-4" onClick={() => setEditing(null)}>
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-[var(--sf-line)] bg-[var(--sf-panel)] p-5">
        <h3 className="text-sm font-bold">Scene {editing.scene.scene_index} script</h3>
        <p className="mt-1 text-xs text-[var(--sf-dim)]">This text is what the provider films. Saving marks the scene for regeneration.</p>
        <textarea
          autoFocus
          rows={5}
          value={editing.text}
          onChange={(event) => setEditing({ scene: editing.scene, text: event.target.value })}
          placeholder="What the viewer sees in this shot — subject, setting, action, camera"
          aria-invalid={editing.text.trim() ? undefined : true}
          className={`mt-3 ${editing.text.trim() ? inputClass : invalidInputClass}`}
        />
        {/* Save is disabled on an empty script, so the reason sits on the field
            instead of leaving a dead button with no explanation beside it. */}
        {editing.text.trim() ? null : <span role="alert" className="mt-1.5 block text-[11px] leading-relaxed text-[var(--sf-bad)]">
          A scene needs a script before it can be filmed — describe what happens in this shot.
        </span>}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className={buttonClass}>Cancel</button>
          <button onClick={() => { onEditSceneScript(editing.scene, editing.text.trim()); setEditing(null); }} disabled={!editing.text.trim()} className={primaryClass}>Save scene script</button>
        </div>
      </div>
    </div> : null}
  </div>;
}

// --------------------------------------------------------------------------
// Provider selector
// --------------------------------------------------------------------------

function ProviderSelect({ providers, loading, value, onChange, onRefresh }: {
  providers: ProviderStatus[];
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = providers.find((entry) => entry.id === value);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  const scene = providers.filter((entry) => entry.role === 'scene');
  const presenter = providers.filter((entry) => entry.role === 'presenter');

  const row = (entry: ProviderStatus) => <button
    key={entry.id}
    onClick={() => { if (entry.state !== 'unconfigured' && entry.role === 'scene') { onChange(entry.id); setOpen(false); } }}
    disabled={entry.state === 'unconfigured' || entry.role !== 'scene'}
    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${entry.state === 'unconfigured' || entry.role !== 'scene' ? 'cursor-default opacity-70' : 'hover:bg-[var(--sf-chip)]'}`}
  >
    <span className="flex w-full items-center gap-2">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.state === 'available' ? 'bg-[var(--sf-ok)]' : entry.state === 'unconfigured' ? 'bg-[var(--sf-bad)]' : 'bg-[var(--sf-warn)]'}`} />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{entry.label}</span>
      {entry.id === value ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--sf-accent-text)]" /> : null}
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--sf-dim)]">
        {entry.state === 'available' ? 'ready' : entry.state === 'unconfigured' ? 'not set up' : entry.state}
      </span>
    </span>
    <span className="text-[11px] leading-relaxed text-[var(--sf-dim)]">{entry.note || entry.costHint || entry.blurb.slice(0, 90)}</span>
  </button>;

  return <div className="relative" onClick={(event) => event.stopPropagation()}>
    <button onClick={() => setOpen((value) => !value)} className={buttonClass}>
      {loading ? <VergeLoader size={28} label="Loading" /> : <span className={`h-1.5 w-1.5 rounded-full ${current?.state === 'available' ? 'bg-[var(--sf-ok)]' : current?.state === 'unconfigured' ? 'bg-[var(--sf-bad)]' : 'bg-[var(--sf-warn)]'}`} />}
      <span className="max-w-[140px] truncate">{current?.label || 'Choose provider'}</span>
      <ChevronRight className="h-3 w-3 rotate-90" />
    </button>
    {open ? <div className="absolute right-0 top-full z-50 mt-1.5 w-[320px] overflow-hidden rounded-xl border border-[var(--sf-line)] bg-[var(--sf-panel)] py-1 shadow-[0_18px_50px_rgba(120,80,0,0.18)]">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--sf-dim)]">Scene clips</span>
        <button onClick={onRefresh} className="inline-flex items-center gap-1 text-[10px] text-[var(--sf-dim)] hover:text-[var(--sf-text)]"><RefreshCw className="h-3 w-3" />Recheck</button>
      </div>
      <div className="max-h-[300px] overflow-y-auto">{scene.map(row)}</div>
      {presenter.length ? <>
        <div className="border-t border-[var(--sf-line)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-[var(--sf-dim)]">Presenter</div>
        {presenter.map(row)}
      </> : null}
    </div> : null}
  </div>;
}

// --------------------------------------------------------------------------
// Sidebar
// --------------------------------------------------------------------------

const TABS: { id: SidebarTab; label: string; icon: typeof FileText }[] = [
  { id: 'script', label: 'Script', icon: FileText },
  { id: 'character', label: 'Character', icon: User },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'audio', label: 'Audio', icon: Mic },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'context', label: 'Context', icon: Sparkles },
  { id: 'broll', label: 'B-roll', icon: Film },
];

function Sidebar(props: PanelProps) {
  const { config, onConfig } = props;
  const tab = config.sidebar;
  return <aside className="flex w-[340px] shrink-0 flex-col border-l border-[var(--sf-line)] bg-[var(--sf-panel)]">
    <nav className="flex shrink-0 gap-0.5 border-b border-[var(--sf-line)] px-2 py-2">
      {TABS.map(({ id, label, icon: Icon }) => <button
        key={id}
        onClick={() => onConfig({ sidebar: id })}
        aria-current={tab === id}
        title={label}
        className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-semibold transition-colors ${tab === id ? 'bg-[var(--sf-chip)] text-[var(--sf-text)]' : 'text-[var(--sf-dim)] hover:text-[var(--sf-text)]'}`}
      ><Icon className="h-4 w-4" />{label}</button>)}
    </nav>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {tab === 'script' ? <ScriptPanel {...props} /> : null}
      {tab === 'character' ? <CharacterPanel {...props} /> : null}
      {tab === 'style' ? <StylePanel {...props} /> : null}
      {tab === 'audio' ? <AudioPanel {...props} /> : null}
      {tab === 'music' ? <MusicPanel {...props} /> : null}
      {tab === 'context' ? <ContextPanel {...props} /> : null}
      {tab === 'broll' ? <BrollPanel {...props} /> : null}
    </div>
  </aside>;
}

// --------------------------------------------------------------------------
// Script
// --------------------------------------------------------------------------

function ScriptPanel({ project, config, onConfig, onSaveScript, onRewriteScript, onPlanScenes, busy }: PanelProps) {
  const [direction, setDirection] = useState('');
  const script = config.script_draft || String(project.script || '');
  const dirty = script.trim() !== String(project.script || '').trim();
  return <>
    <Field label="Script" hint={config.saved_at ? `Auto-saved · ${new Date(config.saved_at).toLocaleTimeString()}` : 'Auto-saves as you type — you can close the tab and come back.'}>
      <textarea
        rows={14}
        value={script}
        onChange={(event) => onConfig({ script_draft: event.target.value })}
        placeholder="Write or paste the narration script…"
        className={`${inputClass} resize-y font-[inherit] leading-relaxed`}
      />
    </Field>
    <div className="flex items-center gap-2">
      <button onClick={() => onSaveScript(script)} disabled={busy || !script.trim() || !dirty} className={primaryClass}><CheckCircle2 className="h-3.5 w-3.5" />Apply script</button>
      {dirty ? <Pill tone="warn">Unapplied changes</Pill> : <Pill tone="ok">In sync</Pill>}
    </div>
    <button onClick={onPlanScenes} disabled={busy || !String(project.script || '').trim()} className={`${buttonClass} w-full`}>
      <Layers className="h-3.5 w-3.5" />Re-plan scenes from this script
    </button>
    <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">Re-planning rewrites the scene timeline to match the applied script. Clips you have already generated for unchanged scenes are reused, never re-billed.</p>
    <div className="rounded-xl border border-[var(--sf-line)] p-3">
      <Field label="Ask for a rewrite">
        <input
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
          placeholder="e.g. punchier opening, cut 20 seconds"
          className={inputClass}
        />
      </Field>
      <button onClick={() => { onRewriteScript(direction.trim()); setDirection(''); }} disabled={busy || !direction.trim()} className={`${buttonClass} mt-2 w-full`}><Wand2 className="h-3.5 w-3.5" />Rewrite with AI</button>
    </div>
    {project.sources?.length ? <div>
      <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--sf-dim)]">Sources</p>
      <ul className="mt-1.5 space-y-1">
        {project.sources.slice(0, 6).map((source) => <li key={source} className="truncate text-[11px] text-[var(--sf-dim)]">{source}</li>)}
      </ul>
    </div> : null}
  </>;
}

// --------------------------------------------------------------------------
// Character
// --------------------------------------------------------------------------

function CharacterPanel({ project, config, onConfig, avatars, voices, charactersLoading, charactersError, characterNote, onGenerateAvatar, onUploadCharacterPhoto, providers, busy, elevenVoices, elevenVoicesLoading, elevenVoicesError }: PanelProps) {
  const [query, setQuery] = useState('');
  const [avatarId, setAvatarId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  // ElevenLabs narrates and HeyGen lip-syncs the presenter to that finished
  // track; the HeyGen voice below is only what a render falls back to. The
  // switch is the shared one, so flipping it here also debugs the wizard.
  const [voiceEngine, setVoiceEngine] = useState<'elevenlabs' | 'heygen'>(() => (voicePipeline() === 'heygen_tts' ? 'heygen' : 'elevenlabs'));
  const [elevenVoiceId, setElevenVoiceId] = useState('');
  const photoRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (elevenVoiceId || !elevenVoices.length) return;
    let cancelled = false;
    void resolveNarrationVoiceId().catch(() => '').then((preferred) => {
      if (cancelled) return;
      setElevenVoiceId((current) => current
        || (elevenVoices.some((voice) => voice.id === preferred) ? preferred : '')
        || (elevenVoices.find((voice) => voice.indian) || elevenVoices[0])?.id
        || '');
    });
    return () => { cancelled = true; };
  }, [elevenVoices, elevenVoiceId]);

  const avatarViews = useMemo(() => sortAvatars(avatars), [avatars]);
  const voiceViews = useMemo(() => sortVoices(withIndiaSeedVoices(voices)), [voices]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? avatarViews.filter((view) => view.name.toLowerCase().includes(term)) : avatarViews;
  }, [avatarViews, query]);

  const heygen = providers.find((entry) => entry.id === 'heygen');
  const sceneProvider = providers.find((entry) => entry.id === config.provider) || null;
  const blocked = heygen?.state === 'unconfigured';

  return <>
    {blocked ? <div className="rounded-xl border border-[color-mix(in_srgb,var(--sf-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--sf-warn)_10%,transparent)] p-3 text-[11px] leading-relaxed text-[var(--sf-text)]">
      {heygen?.note}
    </div> : null}
    {project.heygen_video_url ? <div className="overflow-hidden rounded-xl border border-[var(--sf-line)]">
      <video src={project.heygen_video_url} controls playsInline className="w-full bg-black" />
      <p className="px-3 py-2 text-[11px] text-[var(--sf-dim)]">Presenter master · {Math.round(Number(project.avatar_duration_sec) || 0)}s. Every scene composites against this and its narration.</p>
    </div> : null}

    <div className="rounded-xl border border-[var(--sf-line)] p-3">
      <Field label="Character reference" hint="A face, product or mascot shot. It is sent with EVERY scene request on engines that carry references across clips, which is what keeps the same character recognisable from cut to cut.">
        {config.character_photo_url ? <div className="mt-1.5 flex items-center gap-3">
          <img src={config.character_photo_url} alt="Character reference" className="h-16 w-16 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            {sceneProvider?.characterRef
              ? <Pill tone="ok">Consistency seed active on {sceneProvider.label}</Pill>
              : <Pill tone="warn">{sceneProvider ? `${sceneProvider.label} cannot carry references` : 'Pick a provider'}</Pill>}
            <button onClick={() => onConfig({ character_photo_url: '' })} className={`${buttonClass} mt-2 w-full`}><X className="h-3.5 w-3.5" />Remove</button>
          </div>
        </div> : null}
        <button onClick={() => photoRef.current?.click()} className={`${buttonClass} mt-1.5 w-full`}><Upload className="h-3.5 w-3.5" />{config.character_photo_url ? 'Replace reference photo' : 'Upload reference photo'}</button>
      </Field>
      <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) onUploadCharacterPhoto(file);
      }} />
      {!sceneProvider?.characterRef && config.character_photo_url
        ? <p className="mt-2 text-[11px] leading-relaxed text-[var(--sf-dim)]">Switch to Gemini Omni Flash or Veo 3.1 in the top bar to use this reference — the other engines reject reference images, so SceneForge deliberately does not send it to them.</p>
        : null}
    </div>

    <div>
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-[var(--sf-dim)]" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search presenters" className={`${inputClass} mt-0`} />
      </div>
      {charactersError ? <p className="mt-2 text-[11px] text-[var(--sf-bad)]">{charactersError}</p> : null}
      <div className="mt-2 grid max-h-[220px] grid-cols-3 gap-2 overflow-y-auto">
        {charactersLoading && !filtered.length
          ? <div className="col-span-3 flex justify-center py-4"><VergeLoader size={96} caption="Loading characters" /></div>
          : filtered.slice(0, 48).map((view) => <button
              key={view.id}
              onClick={() => setAvatarId(view.id)}
              title={view.name}
              className={`overflow-hidden rounded-lg border transition-all ${avatarId === view.id ? 'border-[var(--sf-accent)] shadow-[0_0_0_1px_var(--sf-accent)]' : 'border-[var(--sf-line)] hover:border-[var(--sf-line-strong)]'}`}
            >
              {view.image
                ? <img src={view.image} alt={view.name} loading="lazy" className="aspect-square w-full object-cover" />
                : <span className="flex aspect-square w-full items-center justify-center bg-[var(--sf-sunken)] text-[10px] text-[var(--sf-dim)]">{view.name.slice(0, 12)}</span>}
            </button>)}
      </div>
    </div>

    <Field label="Narration voice" hint="ElevenLabs narrates the script first and HeyGen lip-syncs the presenter to that finished track, so HeyGen's own text-to-speech is never heard. Switch engines only to compare the two.">
      <div className="mt-1.5 flex gap-1.5">
        {([{ id: 'elevenlabs', label: 'ElevenLabs' }, { id: 'heygen', label: 'HeyGen TTS' }] as const).map((option) => <button
          key={option.id}
          onClick={() => { setVoiceEngine(option.id); setVoicePipeline(option.id === 'heygen' ? 'heygen_tts' : 'elevenlabs_heygen'); }}
          className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${voiceEngine === option.id ? 'border-[var(--sf-accent)] bg-[color-mix(in_srgb,var(--sf-accent)_16%,transparent)]' : 'border-[var(--sf-line)] hover:bg-[var(--sf-chip)]'}`}
        >{option.label}</button>)}
      </div>
    </Field>

    {voiceEngine === 'elevenlabs' ? <ElevenVoicePicker
      voices={elevenVoices}
      value={elevenVoiceId}
      loading={elevenVoicesLoading}
      error={elevenVoicesError}
      listHeightClass="max-h-56"
      onChange={(id) => { setElevenVoiceId(id); rememberNarrationVoice(id); }}
    /> : null}

    <Field label={voiceEngine === 'elevenlabs' ? 'Fallback HeyGen voice' : 'HeyGen voice'} hint={voiceEngine === 'elevenlabs' ? 'Used only if ElevenLabs cannot be reached, or if this presenter is missing from the HeyGen catalog that accepts a ready-made audio track.' : undefined}>
      <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} className={inputClass}>
        <option value="">Choose a voice</option>
        {voiceViews.slice(0, 200).map((view) => <option key={view.id} value={view.id}>{view.name} · {view.language}</option>)}
      </select>
    </Field>

    <button
      onClick={() => onGenerateAvatar({ avatar_id: avatarId, voice_id: voiceId, voice_engine: voiceEngine, eleven_voice_id: elevenVoiceId })}
      disabled={busy || blocked || !avatarId || !project.script || (voiceEngine === 'elevenlabs' ? !elevenVoiceId : !voiceId)}
      className={`${primaryClass} w-full`}
    ><Clapperboard className="h-3.5 w-3.5" />{project.heygen_video_url ? 'Re-render presenter' : 'Render presenter'}</button>
    {!project.script ? <p className="text-[11px] text-[var(--sf-dim)]">Apply a script first — the presenter reads it.</p> : null}
    {characterNote ? <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">{characterNote}</p> : null}
  </>;
}

// --------------------------------------------------------------------------
// Style (brand + post-processing)
// --------------------------------------------------------------------------

const TRANSITION_OPTIONS: { id: TransitionStyle; label: string }[] = [
  { id: 'fade', label: 'Fade' },
  { id: 'slide', label: 'Slide' },
  { id: 'none', label: 'Hard cut' },
];

function StylePanel({ project, config, onConfig, onAutoGraphics, autoGraphicsBusy, autoGraphicsNote }: PanelProps) {
  // The finishing pass is a Remotion render, and the platform's public
  // Remotion renderer is fixed at 1920x1080. A 9:16 film is therefore
  // composited by the portrait FFmpeg endpoint instead, which takes only
  // full-frame overlays — so the branded graphics below are a landscape
  // feature today. Saying so here beats shipping settings that quietly do
  // nothing.
  const portrait = project.aspect_ratio === '9:16';
  return <>
    <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">
      These settings drive the Remotion finishing pass. Once every clip exists, the whole timeline is re-rendered server-side with these graphics drawn on top — frame-accurate, not screen-captured.
    </p>
    {portrait ? <div className="rounded-xl border border-[color-mix(in_srgb,var(--sf-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--sf-warn)_10%,transparent)] p-3 text-[11px] leading-relaxed text-[var(--sf-text)]">
      This project is 9:16. The platform's Remotion renderer only outputs 1920x1080, so a portrait film is composited by the vertical FFmpeg pipeline instead and the branded cards, lower thirds, transitions and B-roll overlay below are not drawn into it. Switch the project to 16:9 to use them; the scenes, narration and music all work either way.
    </div> : null}

    <Field label="Brand accent">
      <div className="mt-1.5 flex items-center gap-2">
        <input type="color" value={config.accent} onChange={(event) => onConfig({ accent: event.target.value })} className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--sf-line)] bg-transparent" />
        <input value={config.accent} onChange={(event) => onConfig({ accent: event.target.value })} className={`${inputClass} mt-0`} />
      </div>
    </Field>

    <Field label="Transitions">
      <div className="mt-1.5 flex gap-1.5">
        {TRANSITION_OPTIONS.map((option) => <button
          key={option.id}
          onClick={() => onConfig({ transitions: option.id })}
          className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${config.transitions === option.id ? 'border-[var(--sf-accent)] bg-[color-mix(in_srgb,var(--sf-accent)_16%,transparent)]' : 'border-[var(--sf-line)] hover:bg-[var(--sf-chip)]'}`}
        >{option.label}</button>)}
      </div>
    </Field>

    <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--sf-line)] px-3 py-2.5">
      <span className="text-xs font-semibold">Lower thirds<span className="mt-0.5 block text-[11px] font-normal text-[var(--sf-dim)]">Branded caption bar on each scene</span></span>
      <input type="checkbox" checked={config.lower_thirds} onChange={(event) => onConfig({ lower_thirds: event.target.checked })} className="h-4 w-4 accent-[var(--sf-accent)]" />
    </label>

    <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--sf-line)] px-3 py-2.5">
      <span className="text-xs font-semibold">B-roll overlays<span className="mt-0.5 block text-[11px] font-normal text-[var(--sf-dim)]">Corner picture-in-picture, always muted</span></span>
      <input type="checkbox" checked={config.broll_enabled} onChange={(event) => onConfig({ broll_enabled: event.target.checked })} className="h-4 w-4 accent-[var(--sf-accent)]" />
    </label>

    <div className="rounded-xl border border-[var(--sf-line)] p-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold">Title card</span>
        <input type="checkbox" checked={config.title_card.enabled} onChange={(event) => onConfig({ title_card: { ...config.title_card, enabled: event.target.checked } })} className="h-4 w-4 accent-[var(--sf-accent)]" />
      </label>
      {config.title_card.enabled ? <div className="mt-2 space-y-2">
        <input value={config.title_card.title} onChange={(event) => onConfig({ title_card: { ...config.title_card, title: event.target.value } })} placeholder="Title" className={`${inputClass} mt-0`} />
        <input value={config.title_card.subtitle} onChange={(event) => onConfig({ title_card: { ...config.title_card, subtitle: event.target.value } })} placeholder="Subtitle (optional)" className={`${inputClass} mt-0`} />
      </div> : null}
    </div>

    <div className="rounded-xl border border-[var(--sf-line)] p-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold">Closing CTA card</span>
        <input type="checkbox" checked={config.cta_card.enabled} onChange={(event) => onConfig({ cta_card: { ...config.cta_card, enabled: event.target.checked } })} className="h-4 w-4 accent-[var(--sf-accent)]" />
      </label>
      {config.cta_card.enabled ? <div className="mt-2 space-y-2">
        <input value={config.cta_card.headline} onChange={(event) => onConfig({ cta_card: { ...config.cta_card, headline: event.target.value } })} placeholder="Headline" className={`${inputClass} mt-0`} />
        <input value={config.cta_card.subline} onChange={(event) => onConfig({ cta_card: { ...config.cta_card, subline: event.target.value } })} placeholder="Supporting line" className={`${inputClass} mt-0`} />
        <input value={config.cta_card.button} onChange={(event) => onConfig({ cta_card: { ...config.cta_card, button: event.target.value } })} placeholder="Button label" className={`${inputClass} mt-0`} />
      </div> : null}
    </div>

    <button onClick={onAutoGraphics} disabled={autoGraphicsBusy} className={`${buttonClass} w-full`}>
      {autoGraphicsBusy ? <VergeLoader size={28} label="Applying graphics" /> : <Wand2 className="h-3.5 w-3.5" />}Auto-apply graphics
    </button>
    <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">{autoGraphicsNote || 'Writes a lower third and a subject callout on every analyzed scene, using what Gemini Vision actually saw in the frame. Hand-made overlays are kept.'}</p>
  </>;
}

// --------------------------------------------------------------------------
// Audio (per-scene voiceover / lip-sync)
// --------------------------------------------------------------------------

const AUDIO_MODES: { id: AudioMode; label: string; icon: typeof Mic; blurb: string }[] = [
  { id: 'off', label: 'Audio Off', icon: VolumeX, blurb: 'Scenes carry no speech of their own; the presenter master is the only voice in the film.' },
  { id: 'voiceover', label: 'Voiceover', icon: Volume2, blurb: 'Every scene speaks its own ElevenLabs line over its footage. The presenter is muted for that window.' },
  { id: 'lipsync', label: 'Lip-sync', icon: Mic, blurb: 'Every line also drives a HeyGen avatar clip, rendered to the ElevenLabs audio, which replaces the scene footage. Scenes HeyGen cannot render fall back to Voiceover.' },
];

function AudioPanel({ project, scenes, config, onConfig, providers, avatars, charactersLoading, elevenVoices, elevenVoicesLoading, elevenVoicesError, onNarrateScenes, onLipsyncScenes, audioBusy, audioNote, busy }: PanelProps) {
  const audio = config.audio;
  const [avatarQuery, setAvatarQuery] = useState('');
  const rows = useMemo(() => voicedScenes(scenes), [scenes]);
  const needVoice = useMemo(() => scenesNeedingVoice(scenes, project, audio), [scenes, project, audio]);
  const needLips = useMemo(() => scenesNeedingLipsync(scenes, project, audio), [scenes, project, audio]);
  const overruns = useMemo(() => overrunningScenes(scenes, audio), [scenes, audio]);
  const avatarViews = useMemo(() => sortAvatars(avatars), [avatars]);
  const filteredAvatars = useMemo(() => {
    const term = avatarQuery.trim().toLowerCase();
    return term ? avatarViews.filter((view) => view.name.toLowerCase().includes(term)) : avatarViews;
  }, [avatarViews, avatarQuery]);
  const heygen = providers.find((entry) => entry.id === 'heygen');
  const heygenBlocked = heygen?.state === 'unconfigured';
  const portrait = project.aspect_ratio === '9:16';
  const lipsync = audio.mode === 'lipsync';
  const settings = audio.voice_settings;
  const patchAudio = (patch: Partial<AudioConfig>) => onConfig({ audio: { ...audio, ...patch } });
  const setSetting = (patch: Partial<VoiceSettings>) => patchAudio({ voice_settings: { ...settings, ...patch } });
  // The line is stored on the config so a reload keeps the customer's edit;
  // the clip made from the OLD line stays until it is narrated again, which
  // is what lets the row say "Line changed" instead of silently going quiet.
  const setLine = (scene: Scene, text: string) => patchAudio({ scenes: { ...audio.scenes, [scene.id]: { ...(audio.scenes[scene.id] || emptySceneAudio()), text } } });
  const totalChars = rows.reduce((sum, scene) => sum + lineFor(scene, project, rows, audio).length, 0);
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  return <>
    <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">
      How the film is voiced. In Audio Off the presenter master narrates as before; the other two modes give every scene its own ElevenLabs line, carried into the finished MP4 by the same Remotion render that draws the graphics and mounts the music.
    </p>
    <Field label="Audio mode">
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {AUDIO_MODES.map((option) => {
          const Icon = option.icon;
          const active = audio.mode === option.id;
          return <button
            key={option.id}
            onClick={() => patchAudio({ mode: option.id })}
            aria-pressed={active}
            title={option.blurb}
            className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors ${active ? 'border-[var(--sf-accent)] bg-[color-mix(in_srgb,var(--sf-accent)_16%,transparent)]' : 'border-[var(--sf-line)] hover:bg-[var(--sf-chip)]'}`}
          ><Icon className="h-4 w-4" />{option.label}</button>;
        })}
      </div>
      <span className="mt-1.5 block text-[11px] leading-relaxed text-[var(--sf-dim)]">{AUDIO_MODES.find((option) => option.id === audio.mode)?.blurb}</span>
    </Field>

    {audio.mode !== 'off' && portrait ? <div className="rounded-xl border border-[color-mix(in_srgb,var(--sf-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--sf-warn)_10%,transparent)] p-3 text-[11px] leading-relaxed text-[var(--sf-text)]">
      This project is 9:16. The vertical compositor keeps only the presenter master's own audio and cannot take a per-scene track, so these lines are narrated and saved but will not be heard in a portrait export. Switch the project to 16:9 for them to reach the finished film.
    </div> : null}

    {audio.mode === 'off' ? null : <>
      <div className="rounded-xl border border-[var(--sf-line)] p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--sf-dim)]">Voice</p>
        <ElevenVoicePicker
          voices={elevenVoices}
          value={audio.voice_id}
          onChange={(id) => patchAudio({ voice_id: id })}
          settings={settings}
          loading={elevenVoicesLoading}
          error={elevenVoicesError}
          listHeightClass="max-h-56"
          disabled={audioBusy}
        />
        <details className="mt-3 rounded-lg border border-[var(--sf-line)] p-2.5">
          <summary className="cursor-pointer text-[11px] font-semibold text-[var(--sf-text)]">Delivery settings</summary>
          <div className="mt-2 space-y-2">
            <Field label={`Stability · ${settings.stability.toFixed(2)}`} hint="Lower is more expressive; higher is steadier.">
              <input type="range" min={0} max={1} step={0.01} value={settings.stability} onChange={(event) => setSetting({ stability: Number(event.target.value) })} className="mt-1 w-full accent-[var(--sf-accent)]" />
            </Field>
            <Field label={`Similarity · ${settings.similarity_boost.toFixed(2)}`} hint="How closely the delivery tracks the original voice.">
              <input type="range" min={0} max={1} step={0.01} value={settings.similarity_boost} onChange={(event) => setSetting({ similarity_boost: Number(event.target.value) })} className="mt-1 w-full accent-[var(--sf-accent)]" />
            </Field>
            <Field label={`Style · ${settings.style.toFixed(2)}`} hint="Style exaggeration. Higher is more dramatic.">
              <input type="range" min={0} max={1} step={0.01} value={settings.style} onChange={(event) => setSetting({ style: Number(event.target.value) })} className="mt-1 w-full accent-[var(--sf-accent)]" />
            </Field>
            <label className="flex items-center justify-between gap-3 text-[11px]">
              <span>Speaker boost</span>
              <input type="checkbox" checked={settings.use_speaker_boost} onChange={(event) => setSetting({ use_speaker_boost: event.target.checked })} className="h-4 w-4 accent-[var(--sf-accent)]" />
            </label>
            <p className="text-[10px] leading-relaxed text-[var(--sf-dim)]">{MODEL_NOTE}</p>
          </div>
        </details>
      </div>

      {lipsync ? <div className="rounded-xl border border-[var(--sf-line)] p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--sf-dim)]">Lip-sync presenter</p>
        {heygenBlocked ? <div className="mb-2 rounded-xl border border-[color-mix(in_srgb,var(--sf-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--sf-warn)_10%,transparent)] p-3 text-[11px] leading-relaxed text-[var(--sf-text)]">
          {heygen?.note} Until then every scene plays as Voiceover.
        </div> : null}
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--sf-dim)]">HeyGen renders this look speaking each scene's ElevenLabs clip — its own text-to-speech is never used, so the voice you picked above is the voice on the lips.</p>
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-[var(--sf-dim)]" />
          <input value={avatarQuery} onChange={(event) => setAvatarQuery(event.target.value)} placeholder="Search presenters" className={`${inputClass} mt-0`} />
        </div>
        <div className="mt-2 grid max-h-[200px] grid-cols-3 gap-2 overflow-y-auto">
          {charactersLoading && !filteredAvatars.length
            ? <div className="col-span-3 flex justify-center py-4"><VergeLoader size={96} caption="Loading characters" /></div>
            : filteredAvatars.map((view) => <button
                key={view.id}
                onClick={() => patchAudio({ lipsync_avatar_id: view.id })}
                title={view.name}
                disabled={audioBusy}
                className={`overflow-hidden rounded-lg border transition-all ${audio.lipsync_avatar_id === view.id ? 'border-[var(--sf-accent)] shadow-[0_0_0_1px_var(--sf-accent)]' : 'border-[var(--sf-line)] hover:border-[var(--sf-line-strong)]'}`}
              >
                {view.image
                  ? <img src={view.image} alt={view.name} loading="lazy" className="aspect-square w-full object-cover" />
                  : <span className="flex aspect-square w-full items-center justify-center bg-[var(--sf-sunken)] text-[10px] text-[var(--sf-dim)]">{view.name.slice(0, 12)}</span>}
              </button>)}
          {!charactersLoading && !filteredAvatars.length ? <p className="col-span-3 text-[11px] text-[var(--sf-dim)]">{heygenBlocked ? 'Presenters appear here once HeyGen is connected.' : 'No presenter matches that search.'}</p> : null}
        </div>
      </div> : null}

      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--sf-dim)]">
          <span className="font-semibold uppercase tracking-[.14em]">Scene lines</span>
          <span>{plural(rows.length, 'scene')} · {totalChars} chars</span>
        </div>
        {!rows.length ? <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">Plan the scenes first — each one gets a line here, seeded from the part of the script it covers.</p> : null}
        <div className="space-y-2">
          {rows.map((scene) => {
            const line = lineFor(scene, project, rows, audio);
            const entry = audio.scenes[scene.id];
            const voice = voiceoverState(entry, line, audio.voice_id);
            const lips = lipsync ? lipsyncState(entry, line, audio.voice_id, audio.lipsync_avatar_id) : 'missing';
            return <div key={scene.id} className="rounded-lg border border-[var(--sf-line)] p-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-bold">Scene {scene.scene_index}</span>
                <span className="text-[var(--sf-dim)]">{secondsLabel(scene)}</span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {voice === 'ready' ? <Pill tone="ok">Voice ready</Pill> : voice === 'stale' ? <Pill tone="warn">Line changed</Pill> : <Pill>No voice yet</Pill>}
                  {lipsync && voice === 'ready' ? (lips === 'ready' ? <Pill tone="ok">Lips ready</Pill> : entry?.lipsync_note ? <Pill tone="warn">Voiceover only</Pill> : <Pill>Lips pending</Pill>) : null}
                </span>
              </div>
              <textarea
                rows={2}
                value={line}
                onChange={(event) => setLine(scene, event.target.value)}
                disabled={audioBusy}
                placeholder="What this scene says…"
                className={`${inputClass} resize-y text-xs leading-relaxed`}
              />
              {entry?.audio_url ? <audio src={entry.audio_url} controls preload="none" className="mt-1.5 h-8 w-full" /> : null}
              {entry?.duration_ms ? <p className="mt-1 text-[10px] text-[var(--sf-dim)]">{(entry.duration_ms / 1000).toFixed(1)}s of speech in a {secondsLabel(scene)} window.</p> : null}
              {lipsync && entry?.lipsync_note ? <p className="mt-1 text-[11px] leading-relaxed text-[var(--sf-warn)]">{entry.lipsync_note}</p> : null}
            </div>;
          })}
        </div>
      </div>

      {overruns.length ? <div className="rounded-xl border border-[color-mix(in_srgb,var(--sf-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--sf-warn)_10%,transparent)] p-3 text-[11px] leading-relaxed text-[var(--sf-text)]">
        {overruns.map(({ scene, overBySec }) => `Scene ${scene.scene_index} speaks ${overBySec.toFixed(1)}s past its window`).join('; ')}. The render cuts a line at the scene's end — shorten the line or lengthen the scene.
      </div> : null}

      <div className="flex gap-2">
        <button onClick={onNarrateScenes} disabled={audioBusy || busy || !audio.voice_id || !needVoice.length} className={`${primaryClass} flex-1`}>
          {audioBusy ? <VergeLoader size={28} tone="ink" label="Narrating scenes" /> : <Volume2 className="h-3.5 w-3.5" />}
          {needVoice.length ? `Narrate ${plural(needVoice.length, 'scene')}` : rows.length ? 'All lines narrated' : 'Narrate scenes'}
        </button>
        {lipsync ? <button onClick={onLipsyncScenes} disabled={audioBusy || busy || heygenBlocked || !audio.lipsync_avatar_id || !needLips.length} className={buttonClass} title={!audio.lipsync_avatar_id ? 'Pick a lip-sync presenter first' : needVoice.length ? 'Narrate every line before lip-syncing' : undefined}>
          <Mic className="h-3.5 w-3.5" />{needLips.length ? `Lip-sync ${needLips.length}` : 'Lips done'}
        </button> : null}
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">
        {!audio.voice_id ? 'Pick a voice above to enable narration. ' : ''}One ElevenLabs request narrates every scene that needs it; a line that has not changed is never billed again.{lipsync ? ' Lip-sync renders two scenes at a time in HeyGen and keeps the voiceover for any scene it cannot render.' : ''}
      </p>
      {audioNote ? <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">{audioNote}</p> : null}
    </>}
  </>;
}

// --------------------------------------------------------------------------
// Music
// --------------------------------------------------------------------------

function MusicPanel({ project, config, onConfig, onGenerateMusic, onMixMusic, musicBusy, musicNote, onUploadAudioTrack }: PanelProps) {
  const [prompt, setPrompt] = useState(String(project.music_prompt || ''));
  const audioRef = useRef<HTMLInputElement | null>(null);
  return <>
    <Field label="Music bed" hint="Generated with ElevenLabs and ducked under the narration inside the same render — the finished MP4 already carries it.">
      <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="e.g. warm cinematic underscore, slow build" className={inputClass} />
    </Field>
    <div className="flex gap-2">
      <button onClick={() => onGenerateMusic(prompt.trim())} disabled={musicBusy} className={`${primaryClass} flex-1`}>
        {musicBusy ? <VergeLoader size={28} tone="ink" label="Generating the music bed" /> : <Music className="h-3.5 w-3.5" />}Generate bed
      </button>
      <button onClick={onMixMusic} disabled={musicBusy || !project.music_url} className={buttonClass}>Mix into film</button>
    </div>
    {project.music_url ? <audio src={project.music_url} controls className="w-full" /> : null}
    {musicNote ? <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">{musicNote}</p> : null}

    <div className="rounded-xl border border-[var(--sf-line)] p-3">
      <Field label="Your own audio track" hint="Uploaded audio is mounted by the same finishing render and ducks under the narration, so it survives stitching intact.">
        <button onClick={() => audioRef.current?.click()} className={`${buttonClass} mt-1.5 w-full`}><Upload className="h-3.5 w-3.5" />Upload audio</button>
      </Field>
      <input ref={audioRef} type="file" accept="audio/*" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) onUploadAudioTrack(file);
      }} />
      {config.audio_track_url ? <div className="mt-2 space-y-1.5">
        <audio src={config.audio_track_url} controls className="w-full" />
        {project.aspect_ratio === '9:16'
          ? <p className="text-[11px] leading-relaxed text-[var(--sf-warn)]">This project is 9:16, and the vertical compositor keeps only the presenter's own audio — an uploaded track is mounted by the landscape Remotion render. Use the generated music bed and Mix into film for portrait, or switch the project to 16:9.</p>
          : null}
        <button onClick={() => onConfig({ audio_track_url: '' })} className={buttonClass}><X className="h-3.5 w-3.5" />Remove track</button>
      </div> : null}
    </div>
  </>;
}

// --------------------------------------------------------------------------
// Scene context (Gemini Vision)
// --------------------------------------------------------------------------

function ContextPanel({ selected, onAnalyzeScene, analyzingSceneId, onConfig }: PanelProps) {
  if (!selected) return <p className="text-xs leading-relaxed text-[var(--sf-dim)]">Pick a scene in the timeline to see what Gemini Vision found in its first frame — objects, mood, setting and the colours its graphics should use.</p>;
  const vision = visionOf(selected);
  const analyzing = analyzingSceneId === selected.id;
  return <>
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-bold">Scene {selected.scene_index} context</h3>
      <button onClick={() => onAnalyzeScene(selected)} disabled={analyzing || !selected.render_url} className={buttonClass}>
        {analyzing ? <VergeLoader size={28} label="Analysing the scene" /> : <Sparkles className="h-3.5 w-3.5" />}{vision ? 'Re-analyze' : 'Analyze'}
      </button>
    </div>
    {!selected.render_url ? <p className="text-[11px] text-[var(--sf-dim)]">This scene has no clip yet — generate it first and vision runs automatically.</p> : null}
    {!vision && selected.render_url && !analyzing ? <p className="text-[11px] leading-relaxed text-[var(--sf-dim)]">No analysis stored for this clip yet. Press Analyze to read the first frame.</p> : null}
    {vision ? <>
      <p className="text-xs leading-relaxed text-[var(--sf-text)]">{vision.summary}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[var(--sf-line)] p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[var(--sf-dim)]">Mood</p>
          <p className="mt-1 text-xs">{vision.mood || '—'}</p>
        </div>
        <div className="rounded-lg border border-[var(--sf-line)] p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[var(--sf-dim)]">Setting</p>
          <p className="mt-1 text-xs">{vision.setting || '—'}</p>
        </div>
      </div>
      {vision.objects.length ? <div>
        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[var(--sf-dim)]">Detected objects</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{vision.objects.map((object) => <Pill key={object}>{object}</Pill>)}</div>
      </div> : null}
      {vision.palette.length ? <div>
        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[var(--sf-dim)]">Palette</p>
        <div className="mt-1.5 flex gap-1.5">{vision.palette.map((hex) => <button
          key={hex}
          title={`Use ${hex} as the brand accent`}
          onClick={() => onConfig({ accent: hex })}
          className="h-8 w-8 rounded-lg border border-[var(--sf-line)]"
          style={{ background: hex }}
        />)}</div>
      </div> : null}
      {vision.lower_third.text ? <div className="rounded-lg border border-[var(--sf-line)] p-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[var(--sf-dim)]">Suggested lower third</p>
        <p className="mt-1 text-xs font-semibold">{vision.lower_third.text}</p>
        {vision.lower_third.subtext ? <p className="text-[11px] text-[var(--sf-dim)]">{vision.lower_third.subtext}</p> : null}
      </div> : null}
    </> : null}
  </>;
}

// --------------------------------------------------------------------------
// B-roll
// --------------------------------------------------------------------------

function BrollPanel({ selected, onSetBroll, config }: PanelProps) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PexelsClip[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const clip = selected ? brollOf(selected) : null;
  const suggestions = selected ? brollSuggestions(selected) : [];
  const windowSec = selected ? sceneWindowSec(selected) : 0;

  const search = async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchNote('');
    const result = await searchPexelsVideos(query, { perPage: 8 });
    setResults(result.clips);
    setSearchNote(result.note);
    setSearching(false);
  };

  const patch = (changes: Partial<BrollClip>) => {
    if (!selected || !clip) return;
    onSetBroll(selected, { ...clip, ...changes });
  };

  if (!selected) return <p className="text-xs leading-relaxed text-[var(--sf-dim)]">Pick a scene in the timeline to add B-roll over it. B-roll is visual only — it rides as a muted corner overlay and never interrupts the scene's audio.</p>;

  return <>
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--sf-accent)_32%,transparent)] bg-[color-mix(in_srgb,var(--sf-accent)_8%,transparent)] p-3 text-[11px] leading-relaxed text-[var(--sf-text)]">
      B-roll overlays scene {selected.scene_index} as a corner picture-in-picture. It is always muted, so the narration and music underneath keep running untouched.
      {!config.broll_enabled ? <strong className="mt-1 block text-[var(--sf-warn)]">B-roll overlays are switched off in Style — turn them on for this to appear in the export.</strong> : null}
    </div>

    {clip ? <div className="space-y-3 rounded-xl border border-[var(--sf-line)] p-3">
      <video src={clip.url} muted loop playsInline controls className="w-full rounded-lg bg-black" />
      <Field label="Corner">
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {BROLL_POSITIONS.map((position) => <button
            key={position.id}
            onClick={() => patch({ position: position.id as BrollPosition })}
            className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${clip.position === position.id ? 'border-[var(--sf-accent)] bg-[color-mix(in_srgb,var(--sf-accent)_16%,transparent)]' : 'border-[var(--sf-line)] hover:bg-[var(--sf-chip)]'}`}
          >{position.label}</button>)}
        </div>
      </Field>
      <Field label={`Width · ${Math.round(clip.width_pct * 100)}% of frame`}>
        <input type="range" min={15} max={50} value={Math.round(clip.width_pct * 100)} onChange={(event) => patch({ width_pct: Number(event.target.value) / 100 })} className="mt-2 w-full accent-[var(--sf-accent)]" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Starts at (s)">
          <input type="number" min={0} max={Math.max(0, windowSec - 0.4)} step={0.1} value={clip.start_sec} onChange={(event) => patch({ start_sec: Number(event.target.value) })} className={inputClass} />
        </Field>
        <Field label="Ends at (s)">
          <input type="number" min={clip.start_sec + 0.4} max={windowSec} step={0.1} value={clip.end_sec} onChange={(event) => patch({ end_sec: Number(event.target.value) })} className={inputClass} />
        </Field>
      </div>
      <p className="text-[11px] text-[var(--sf-dim)]">Scene window is {windowSec.toFixed(1)}s{clip.credit ? ` · ${clip.credit}` : ''}.</p>
      <button onClick={() => onSetBroll(selected, null)} className={`${buttonClass} w-full`}><Trash2 className="h-3.5 w-3.5" />Remove B-roll</button>
    </div> : null}

    <div className="rounded-xl border border-[var(--sf-line)] p-3">
      <Field label="Find stock B-roll">
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void search(term); }}
            placeholder="What should the overlay show?"
            className={`${inputClass} mt-0`}
          />
          <button onClick={() => void search(term)} disabled={searching || !term.trim()} className={buttonClass}>
            {searching ? <VergeLoader size={28} label="Searching" /> : <Search className="h-3.5 w-3.5" />}
          </button>
        </div>
      </Field>
      {suggestions.length ? <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => <button key={suggestion} onClick={() => { setTerm(suggestion); void search(suggestion); }} className="rounded-full bg-[var(--sf-chip)] px-2.5 py-1 text-[11px] text-[var(--sf-dim)] hover:text-[var(--sf-text)]">{suggestion}</button>)}
      </div> : null}
      {searchNote ? <p className="mt-2 text-[11px] leading-relaxed text-[var(--sf-dim)]">{searchNote}</p> : null}
      {results.length ? <div className="mt-2 grid grid-cols-2 gap-2">
        {results.map((result) => <button
          key={result.id}
          onClick={() => onSetBroll(selected, defaultBrollFor(selected, result.url, { source: 'pexels', query: term, poster: result.poster, credit: result.credit }))}
          className="overflow-hidden rounded-lg border border-[var(--sf-line)] hover:border-[var(--sf-accent)]"
        >
          {result.poster ? <img src={result.poster} alt="" loading="lazy" className="aspect-video w-full object-cover" /> : <span className="flex aspect-video w-full items-center justify-center bg-[var(--sf-sunken)]"><Film className="h-4 w-4 text-[var(--sf-dim)]" /></span>}
          <span className="block px-2 py-1 text-left text-[10px] text-[var(--sf-dim)]">{result.durationSec}s · {result.credit}</span>
        </button>)}
      </div> : null}
    </div>

    <button onClick={() => uploadRef.current?.click()} className={`${buttonClass} w-full`}><Upload className="h-3.5 w-3.5" />Upload your own B-roll</button>
    <input ref={uploadRef} type="file" accept="video/*" className="hidden" onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setSearchNote('Uploading your clip…');
      void uploadBrollClip(file)
        .then((url) => { onSetBroll(selected, defaultBrollFor(selected, url, { source: 'upload' })); setSearchNote(''); })
        .catch((uploadError: any) => setSearchNote(`That clip could not be uploaded: ${String(uploadError?.message || uploadError).slice(0, 160)}`));
    }} />
  </>;
}
