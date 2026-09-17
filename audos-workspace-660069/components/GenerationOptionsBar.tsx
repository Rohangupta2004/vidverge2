/**
 * GenerationOptionsBar — the compact options row that sits directly above the
 * chat composer.
 *
 * WHY IT EXISTS: Reel used to interview the visitor for all of this one question
 * at a time ("which model?", "do you want a character?", "should it speak?"),
 * while they type. The remaining choices travel with their message (see
 * generationOptionsContext in lib/reelioStudio), and the conversation stays
 * about the video itself.
 *
 * Character creation and URL mockups are autonomous. There is deliberately no
 * character upload or mockup picker here: the pipeline builds the character
 * from the confirmed brief and silently captures a mobile page screenshot when
 * a URL is available.
 */
import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Film,
  Globe,
  Loader2,
  Mic,
  Settings2,
  Sparkles,
} from 'lucide-react';
import {
  getGenerationOptions,
  setGenerationOptions,
  STUDIO_EVENTS,
  type GenerationOptions,
} from '../lib/reelioStudio';
import {
  DEFAULT_VIDEO_MODEL,
  getVideoModel,
  MODEL_GROUPS,
  modelsForEngine,
  PRIMARY_MODEL_IDS,
} from '../apps/Create/videoTypes';

/** Which option's detail row is open. Only ever one at a time. */
type Detail = 'none' | 'model' | 'longform' | 'website';

const CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors';

function chipClass(on: boolean): string {
  return on
    ? `${CHIP_BASE} border-[color-mix(in_srgb,var(--space-brand-primary-500)_55%,transparent)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_16%,transparent)] text-[var(--space-text-brand)]`
    : `${CHIP_BASE} border-[var(--space-border-default)] bg-[var(--space-surface-muted)] text-[var(--space-text-muted)] hover:text-[var(--space-text-secondary)]`;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-2.5 py-1.5 text-xs text-[var(--space-text-primary)] placeholder-[var(--space-text-muted)] focus:outline-none focus:border-[var(--space-brand-primary-200)]';

/** "Google Omni Flash · With sound" reads as "Google Omni Flash" on a chip. */
function shortModelLabel(label: string): string {
  return label.split('\u00b7')[0].trim();
}

const MANUAL_VIDEO_KEY = 'vidverge.manualVideoOptions.v1';
const SCENE_DURATIONS = [5, 10, 15, 30] as const;

export interface ManualVideoOptions {
  sceneCount: number;
  sceneDuration: (typeof SCENE_DURATIONS)[number];
}

export function getManualVideoOptions(): ManualVideoOptions {
  if (typeof window === 'undefined') return { sceneCount: 1, sceneDuration: 10 };
  try {
    const saved = JSON.parse(window.localStorage.getItem(MANUAL_VIDEO_KEY) || '{}');
    const sceneCount = Math.max(1, Math.min(10, Number(saved.sceneCount) || 1));
    const requestedDuration = Number(saved.sceneDuration);
    const sceneDuration = SCENE_DURATIONS.includes(requestedDuration as any)
      ? (requestedDuration as ManualVideoOptions['sceneDuration'])
      : 10;
    return { sceneCount, sceneDuration };
  } catch {
    return { sceneCount: 1, sceneDuration: 10 };
  }
}

function saveManualVideoOptions(value: ManualVideoOptions): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(MANUAL_VIDEO_KEY, JSON.stringify(value));
  }
}

/**
 * Builds the explicit request consumed by Reel's existing produce_video flow.
 * The hook contracts stay untouched: the agent receives the selected model
 * and complete sequential scene plan in one message.
 */
export function buildManualVideoRequest(prompt: string): string {
  const options = getGenerationOptions();
  const manual = getManualVideoOptions();
  const selectedModel = getVideoModel(options.model || DEFAULT_VIDEO_MODEL);
  const character = ' When the concept needs a recurring character, create it from the confirmed product brief and DNA, generate its seed image automatically at job start, and keep it consistent across every scene. Do not ask for or use a custom character image.';
  const delivery = manual.sceneCount > 1
    ? ' Generate every scene sequentially without pausing for approval, report “Scene N of TOTAL generating…” as each scene starts, then stitch the completed clips into one downloadable MP4 and also list the ordered clips as a playlist.'
    : ' Generate the scene and return its playable/downloadable video.';

  return `${prompt.trim() || 'Create a video from my attached reference.'}\n\nCreate this in one automatic generation pass with ${manual.sceneCount} scene${manual.sceneCount === 1 ? '' : 's'} at a target of ${manual.sceneDuration} seconds per scene (up to ${manual.sceneCount * manual.sceneDuration} seconds total). If my text above is already a scene-by-scene script, use every supplied scene and line exactly as written — do not rewrite it. Otherwise, write the complete multi-scene script from my idea before rendering. Use model ${selectedModel.id}.${character}${delivery} If a scene is safety-blocked, sanitize only that scene, preserve the locked character reference, retry it automatically up to two times, and continue the remaining scenes without asking me to continue.`;
}

interface GenerationOptionsBarProps {
  prompt?: string;
  disabled?: boolean;
  busy?: boolean;
  onGenerate?: (request: string) => void;
}

export default function GenerationOptionsBar({
  prompt = '',
  disabled = false,
  busy = false,
  onGenerate,
}: GenerationOptionsBarProps) {
  const [options, setOptions] = useState<GenerationOptions>(getGenerationOptions);
  const [manual, setManual] = useState<ManualVideoOptions>(getManualVideoOptions);
  const [detail, setDetail] = useState<Detail>('none');
  // The shared store remains the source of truth for model, website, scene,
  // and dialogue choices across the chat and Create surfaces.
  useEffect(() => {
    const sync = () => setOptions(getGenerationOptions());
    sync();
    window.addEventListener(STUDIO_EVENTS.optionsChanged, sync);
    window.addEventListener(STUDIO_EVENTS.selectionChanged, sync);
    return () => {
      window.removeEventListener(STUDIO_EVENTS.optionsChanged, sync);
      window.removeEventListener(STUDIO_EVENTS.selectionChanged, sync);
    };
  }, []);

  const patch = (next: Partial<GenerationOptions>) => setOptions(setGenerationOptions(next));

  // Retire stale manual picks from earlier builds. URL screenshots and character
  // seeds now come from the pipeline, never from persistent intake controls.
  useEffect(() => {
    if (!options.characterEnabled && !options.mockupEnabled && !options.characterImageUrl && !options.mockupImageUrl) return;
    setOptions(setGenerationOptions({ characterEnabled: false, mockupEnabled: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchManual = (next: Partial<ManualVideoOptions>) => {
    const value = { ...manual, ...next };
    setManual(value);
    saveManualVideoOptions(value);
  };

  // A pick saved under an id that is no longer in the catalog is corrected to
  // the default, so the chip and the render can never disagree.
  const modelKnown = PRIMARY_MODEL_IDS.indexOf(options.model as any) !== -1;
  useEffect(() => {
    if (!modelKnown) patch({ model: DEFAULT_VIDEO_MODEL });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKnown]);

  const currentModelId = modelKnown ? options.model : DEFAULT_VIDEO_MODEL;
  const model = getVideoModel(currentModelId);

  return (
    <div className="mb-2 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">
          <Settings2 className="h-3 w-3" /> Options
        </span>

        <button
          type="button"
          onClick={() => setDetail(detail === 'model' ? 'none' : 'model')}
          className={chipClass(true)}
          title={`Choose the video model — currently ${model.label}`}
          data-testid="chip-option-model"
          aria-expanded={detail === 'model'}
        >
          <Sparkles className="h-3 w-3" />
          {shortModelLabel(model.label)}
          {model.recommended ? (
            <span className="text-[var(--space-text-muted)]">Recommended</span>
          ) : null}
          <ChevronDown className={`h-3 w-3 transition-transform ${detail === 'model' ? 'rotate-180' : ''}`} />
        </button>

        <button
          type="button"
          onClick={() => setDetail(detail === 'longform' ? 'none' : 'longform')}
          className={chipClass(manual.sceneCount > 1)}
          title="Build 1–10 scenes automatically, up to 5 minutes"
          data-testid="chip-option-long-video"
          aria-expanded={detail === 'longform'}
        >
          <Film className="h-3 w-3" />
          {manual.sceneCount} {manual.sceneCount === 1 ? 'scene' : 'scenes'} · {manual.sceneDuration}s
          <ChevronDown className={`h-3 w-3 transition-transform ${detail === 'longform' ? 'rotate-180' : ''}`} />
        </button>

        <button
          type="button"
          onClick={() => {
            const on = !options.websiteEnabled;
            patch({ websiteEnabled: on });
            setDetail(on ? 'website' : 'none');
          }}
          className={chipClass(options.websiteEnabled)}
          data-testid="toggle-option-website"
          title="Pull context from a web page"
        >
          <Globe className="h-3 w-3" /> Website
        </button>

        <button
          type="button"
          onClick={() => patch({ dialogueEnabled: !options.dialogueEnabled })}
          className={chipClass(options.dialogueEnabled)}
          data-testid="toggle-option-dialogue"
          title="Spoken dialogue / voiceover in the video"
        >
          <Mic className="h-3 w-3" /> Dialogue
        </button>

        {onGenerate ? (
          <button
            type="button"
            onClick={() => onGenerate(buildManualVideoRequest(prompt))}
            disabled={disabled || busy}
            className={`${chipClass(true)} ml-auto disabled:cursor-not-allowed disabled:opacity-50`}
            data-testid="button-generate-video-pass"
            title="Generate every configured scene automatically"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {busy
              ? `Generating ${manual.sceneCount} scene${manual.sceneCount === 1 ? '' : 's'}…`
              : 'Generate'}
          </button>
        ) : null}

        {/* The detail rows are opened by the toggles, and closable from here */}
        {detail !== 'none' && (
          <button
            type="button"
            onClick={() => setDetail('none')}
            className="ml-auto text-[11px] font-medium text-[var(--space-text-muted)] hover:text-[var(--space-text-secondary)]"
          >
            Done
          </button>
        )}
      </div>

      {detail === 'model' && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="picker-video-models">
          {MODEL_GROUPS.map((group) => (
            <div
              key={group.engine}
              className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-2"
            >
              <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--space-text-muted)]">
                {group.label}
              </p>
              <div className="flex flex-col gap-1">
                {modelsForEngine(group.engine).map((candidate) => {
                  const selected = candidate.id === currentModelId;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => {
                        patch({ model: candidate.id });
                        setDetail('none');
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                        selected
                          ? 'bg-[var(--space-surface-accent-soft)] text-[var(--space-text-primary)]'
                          : 'text-[var(--space-text-secondary)] hover:bg-[var(--space-surface-muted)]'
                      }`}
                      data-testid={`pick-video-model-${candidate.id}`}
                    >
                      <span className="flex-1">{candidate.label}</span>
                      {candidate.recommended ? (
                        <span className="text-[10px] text-[var(--space-text-brand)]">Recommended</span>
                      ) : null}
                      {selected ? <Check className="h-3.5 w-3.5 text-[var(--space-text-brand)]" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {detail === 'longform' && (
        <div className="mt-2 grid gap-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3 sm:grid-cols-2" data-testid="controls-long-video">
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-[var(--space-text-secondary)]">
            Scene count
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={manual.sceneCount}
                onChange={(e) => patchManual({ sceneCount: Number(e.target.value) })}
                className="min-w-0 flex-1 accent-[var(--space-brand-primary-500)]"
                data-testid="input-scene-count"
              />
              <span className="min-w-8 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] px-2 py-1 text-center text-xs text-[var(--space-text-primary)]">
                {manual.sceneCount}
              </span>
            </div>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-[var(--space-text-secondary)]">Target duration per scene</span>
            <div className="flex flex-wrap gap-1">
              {SCENE_DURATIONS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => patchManual({ sceneDuration: seconds })}
                  className={chipClass(manual.sceneDuration === seconds)}
                  data-testid={`pick-scene-duration-${seconds}`}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-[var(--space-text-muted)] sm:col-span-2">
            Total target: {manual.sceneCount * manual.sceneDuration}s ({Math.floor((manual.sceneCount * manual.sceneDuration) / 60)}m {(manual.sceneCount * manual.sceneDuration) % 60}s). One Generate click runs every scene in order, keeps the same character anchor, and returns a stitched video plus the clip playlist.
          </p>
        </div>
      )}

      {detail === 'website' && options.websiteEnabled && (
        <div className="mt-2">
          <input
            value={options.websiteUrl}
            onChange={(e) => patch({ websiteUrl: e.target.value })}
            placeholder="https://your-product.com — I'll read this page for the brief"
            className={INPUT_CLASS}
            data-testid="input-option-website-url"
          />
        </div>
      )}

    </div>
  );
}
