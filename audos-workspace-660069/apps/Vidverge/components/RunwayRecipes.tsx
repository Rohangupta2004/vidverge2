import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';

import AssetUpload, { MultiAssetUpload } from './AssetUpload';
import MultiShotForm, {
  AudioToggle,
  canSubmitMultiShot,
  emptyMultiShot,
  inputClass,
  toRunInput,
} from './MultiShotForm';
import type { MultiShotFormValue } from './MultiShotForm';
import { buildMultiShotPayload } from '../lib/pipelines';
import { RUNWAY_LOCALIZATION_LANGUAGES } from '../../../lib/videoEngines';
import {
  RECIPE_AD_LOCALIZATION,
  RECIPE_MARKETING_STOCK_IMAGE,
  RECIPE_MULTI_SHOT,
  RECIPE_PRODUCT_AD,
  RECIPE_PRODUCT_CAMPAIGN_IMAGE,
  RECIPE_PRODUCT_SWAP,
  RECIPE_PRODUCT_UGC,
} from '../lib/runway';
import type { RunwayRecipeId } from '../lib/runway';
import { runDurableRunwayRecipe } from '../lib/runwayJobs';
import { downloadRemote, hasWorkspaceToken, SESSION_NOT_READY } from '../lib/runtime';
import { isVideoUrl } from '../lib/upload';

/**
 * RUNWAY RECIPES — the seven provider recipes, each with a complete form.
 *
 * Every recipe uses Audos' native authenticated Runway API, the same path as
 * Pipeline C. A vge_video_jobs row mirrors the native task id and durable
 * outputs. Closing this tab cannot create a duplicate provider submission;
 * every run shows live progress and can stop watching safely.
 */

type RecipeKind = 'video' | 'image';

interface RecipeDef {
  id: RunwayRecipeId;
  name: string;
  blurb: string;
  kind: RecipeKind;
}

const RECIPES: RecipeDef[] = [
  {
    id: RECIPE_PRODUCT_UGC,
    name: 'Product UGC',
    blurb: 'Creator-style footage of a real person using your product.',
    kind: 'video',
  },
  {
    id: RECIPE_PRODUCT_AD,
    name: 'Product Ad',
    blurb: 'A polished ad built from your product shots and a creative line.',
    kind: 'video',
  },
  {
    id: RECIPE_MULTI_SHOT,
    name: 'Multi-Shot Video',
    blurb: 'Several directed shots stitched into one narrative cut.',
    kind: 'video',
  },
  {
    id: RECIPE_PRODUCT_SWAP,
    name: 'Product Swap',
    blurb: 'Replace the product inside an ad you already have.',
    kind: 'video',
  },
  {
    id: RECIPE_AD_LOCALIZATION,
    name: 'Ad Localization',
    blurb: 'Re-cut an existing ad for another language and market.',
    kind: 'image',
  },
  {
    id: RECIPE_MARKETING_STOCK_IMAGE,
    name: 'Stock Image',
    blurb: 'Commercial marketing imagery generated to a brief.',
    kind: 'image',
  },
  {
    id: RECIPE_PRODUCT_CAMPAIGN_IMAGE,
    name: 'Campaign Images',
    blurb: 'Four coordinated campaign stills around one product.',
    kind: 'image',
  },
];

const RATIOS = ['720:1280', '1080:1920'];
const RESOLUTIONS = ['720p', '1080p'];

export default function RunwayRecipes() {
  const [selected, setSelected] = useState<RunwayRecipeId>(RECIPE_PRODUCT_UGC);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [outputs, setOutputs] = useState<string[]>([]);
  const [ran, setRan] = useState<RecipeDef | null>(null);
  const cancelled = useRef(false);

  const running = phase === 'running';
  const recipe = RECIPES.filter((entry) => entry.id === selected)[0] || RECIPES[0];
  const wasCancelled = /^cancelled/i.test(error);

  async function run(definition: RecipeDef, payload: Record<string, unknown>) {
    if (running) return;
    if (!hasWorkspaceToken()) {
      setPhase('error');
      setError(SESSION_NOT_READY);
      return;
    }
    cancelled.current = false;
    setPhase('running');
    setProgress('Submitting to Runway\u2026');
    setError('');
    setOutputs([]);
    setRan(definition);
    try {
      const durable = await runDurableRunwayRecipe({
        recipeId: definition.id,
        payload,
        projectName: `${definition.name} · VidVerge`,
        rawPrompt: String(payload.userConcept || payload.prompt || definition.blurb),
        sourceUrl: firstMediaUrl(payload),
        aspectRatio: String(payload.ratio || '9:16'),
        targetDurationSec: Number(payload.duration) || 1,
        onUpdate: (job) => setProgress(job.stageDetail || `Runway job: ${job.phase}`),
        isCancelled: () => cancelled.current,
      });
      setOutputs(durable.mediaUrls);
      setPhase('done');
    } catch (caught: any) {
      setError(String(caught?.message || caught || 'The generation stopped unexpectedly.'));
      setPhase('error');
    }
  }

  function cancel() {
    cancelled.current = true;
    setProgress('Cancelling\u2026');
  }

  function reset() {
    cancelled.current = true;
    setPhase('idle');
    setProgress('');
    setError('');
    setOutputs([]);
  }

  /** Picking another recipe clears the last one's result, so the panel never
   * shows a finished asset under a form that did not produce it. */
  function choose(id: RunwayRecipeId) {
    if (running || id === selected) return;
    setSelected(id);
    reset();
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--space-text-primary)]">
          <Wand2 className="h-4 w-4 text-[var(--space-brand-highlight)]" />
          Runway Recipes
        </h2>
        <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--space-text-secondary)]">
          {'Seven provider recipes for single assets \u2014 ads, UGC, swaps, localisations and campaign stills. Each one runs on its own and hands the finished file straight back.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RECIPES.map((entry) => {
          const active = entry.id === selected;
          return (
            <button
              key={entry.id}
              type="button"
              disabled={running}
              onClick={() => choose(entry.id)}
              className={[
                'flex h-full flex-col gap-2 rounded-2xl border p-4 text-left transition-all duration-200',
                'disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? 'border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_10%,var(--space-surface-card))]'
                  : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] hover:border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)]',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-[var(--space-text-primary)]">
                  {entry.name}
                </span>
                <KindBadge kind={entry.kind} />
              </div>
              <span className="text-[12px] leading-relaxed text-[var(--space-text-muted)]">
                {entry.blurb}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
        <header className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--space-brand-highlight)]" />
          <h3 className="text-[14.5px] font-semibold text-[var(--space-text-primary)]">
            {recipe.name}
          </h3>
        </header>

        {selected === RECIPE_PRODUCT_UGC && <ProductUgcForm disabled={running} onRun={run} />}
        {selected === RECIPE_PRODUCT_AD && <ProductAdForm disabled={running} onRun={run} />}
        {selected === RECIPE_MULTI_SHOT && <MultiShotRecipeForm disabled={running} onRun={run} />}
        {selected === RECIPE_PRODUCT_SWAP && <ProductSwapForm disabled={running} onRun={run} />}
        {selected === RECIPE_AD_LOCALIZATION && <AdLocalizationForm disabled={running} onRun={run} />}
        {selected === RECIPE_MARKETING_STOCK_IMAGE && (
          <MarketingStockForm disabled={running} onRun={run} />
        )}
        {selected === RECIPE_PRODUCT_CAMPAIGN_IMAGE && (
          <CampaignImageForm disabled={running} onRun={run} />
        )}
      </div>

      {running && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-5 py-4">
          <p className="flex items-center gap-2.5 text-[13px] text-[var(--space-text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--space-brand-highlight)]" />
            {progress || 'Working\u2026'}
          </p>
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--space-border-default)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
            Stop watching
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div
          className="flex flex-col gap-3 rounded-2xl px-5 py-4"
          style={{
            background: 'color-mix(in srgb, var(--space-semantic-danger-500) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--space-semantic-danger-500) 36%, transparent)',
          }}
        >
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-[var(--space-text-primary)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-semantic-danger-500)]" />
            <span>{wasCancelled ? 'Cancelled.' : error}</span>
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-[var(--space-border-default)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      )}

      {phase === 'done' && outputs.length > 0 && ran && (
        <ResultArea recipe={ran} urls={outputs} onClear={reset} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function ResultArea({
  recipe,
  urls,
  onClear,
}: {
  recipe: RecipeDef;
  urls: string[];
  onClear: () => void;
}) {
  const isVideo = recipe.kind === 'video' || urls.some(isVideoUrl);
  const grid = recipe.id === RECIPE_PRODUCT_CAMPAIGN_IMAGE;

  return (
    <section className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[14.5px] font-semibold text-[var(--space-text-primary)]">
          {`${recipe.name} \u00b7 ${urls.length} ${urls.length === 1 ? 'output' : 'outputs'}`}
        </h3>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--space-border-default)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Make another
        </button>
      </header>

      {isVideo ? (
        <div className="flex flex-col gap-4">
          {urls.map((url, index) => (
            <div key={url} className="flex flex-col gap-2">
              <div className="mx-auto w-full overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black" style={{ maxWidth: 420 }}>
                <video
                  src={url}
                  autoPlay
                  loop
                  muted
                  controls
                  playsInline
                  className="block h-auto w-full"
                />
              </div>
              <DownloadLine url={url} filename={`${recipe.id}-${index + 1}.mp4`} />
            </div>
          ))}
        </div>
      ) : grid ? (
        <div className="grid grid-cols-2 gap-3">
          {urls.slice(0, 4).map((url, index) => (
            <figure key={url} className="relative overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black">
              <img src={url} alt={`${recipe.name} ${index + 1}`} className="block h-auto w-full" />
              <button
                type="button"
                onClick={() => downloadRemote(url, `${recipe.id}-${index + 1}.png`)}
                aria-label={`Download image ${index + 1}`}
                className="absolute right-2 top-2 rounded-lg p-1.5 transition-opacity hover:opacity-80"
                style={{
                  background: 'color-mix(in srgb, #000 55%, transparent)',
                  color: '#fff',
                }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black">
            <img src={urls[0]} alt={recipe.name} className="block h-auto w-full" />
          </div>
          <DownloadLine url={urls[0]} filename={`${recipe.id}.png`} />
          {urls.length > 1 && (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-[var(--space-text-muted)]">
                More variations
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {urls.slice(1).map((url, index) => (
                  <figure key={url} className="relative overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black">
                    <img src={url} alt={`${recipe.name} ${index + 2}`} className="block h-auto w-full" />
                    <button
                      type="button"
                      onClick={() => downloadRemote(url, `${recipe.id}-${index + 2}.png`)}
                      aria-label={`Download image ${index + 2}`}
                      className="absolute right-2 top-2 rounded-lg p-1.5 transition-opacity hover:opacity-80"
                      style={{ background: 'color-mix(in srgb, #000 55%, transparent)', color: '#fff' }}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </figure>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DownloadLine({ url, filename }: { url: string; filename: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--space-text-muted)]">{url}</span>
      <button
        type="button"
        onClick={() => downloadRemote(url, filename)}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-semibold transition-opacity hover:opacity-90"
        style={{ background: 'var(--space-brand-primary-500)', color: 'var(--space-text-on-primary)' }}
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared form furniture
// ---------------------------------------------------------------------------

type RunHandler = (definition: RecipeDef, payload: Record<string, unknown>) => void;

function definitionOf(id: RunwayRecipeId): RecipeDef {
  return RECIPES.filter((entry) => entry.id === id)[0];
}

function uri(url: string) {
  return { uri: url };
}

function firstMediaUrl(value: unknown): string | null {
  if (typeof value === 'string') return /^https:\/\//i.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstMediaUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = firstMediaUrl(item);
      if (found) return found;
    }
  }
  return null;
}

function KindBadge({ kind }: { kind: RecipeKind }) {
  const video = kind === 'video';
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]"
      style={{
        background: 'color-mix(in srgb, var(--space-brand-primary-500) 14%, transparent)',
        color: 'var(--space-brand-highlight)',
      }}
    >
      {video ? <Film className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
      {video ? 'Video' : 'Image'}
    </span>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-[var(--space-text-muted)]">{hint}</span>}
    </label>
  );
}

function CountedTextarea({
  label,
  value,
  onChange,
  max,
  min,
  rows = 3,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  max: number;
  min: number;
  rows?: number;
  placeholder: string;
  disabled?: boolean;
}) {
  const length = value.trim().length;
  return (
    <Labeled
      label={label}
      hint={length < min ? `At least ${min} characters.` : `${value.length} / ${max} characters`}
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, max))}
        disabled={disabled}
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        className={inputClass + ' resize-y'}
      />
    </Labeled>
  );
}

function PillGroup({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option)}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
              style={{
                background: active
                  ? 'color-mix(in srgb, var(--space-brand-primary-500) 18%, transparent)'
                  : 'transparent',
                border: `1px solid ${active ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)'}`,
                color: active ? 'var(--space-brand-highlight)' : 'var(--space-text-secondary)',
              }}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DurationPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">
        Duration <span className="text-[var(--space-text-muted)]">{value}s</span>
      </span>
      <input
        type="range"
        min={4}
        max={15}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full max-w-[260px] accent-[var(--space-brand-primary-500)] disabled:opacity-50"
      />
      <span className="text-[11.5px] text-[var(--space-text-muted)]">{'4\u201315 seconds'}</span>
    </div>
  );
}

function SubmitRow({
  label,
  ready,
  disabled,
  blocker,
  onClick,
}: {
  label: string;
  ready: boolean;
  disabled?: boolean;
  blocker: string;
  onClick: () => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[12px] text-[var(--space-text-muted)]">{ready ? 'Ready to generate.' : blocker}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={!ready || disabled}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-45 hover:opacity-90"
        style={{ background: 'var(--space-brand-primary-500)', color: 'var(--space-text-on-primary)' }}
      >
        {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1 — product_ugc
// ---------------------------------------------------------------------------

function ProductUgcForm({ disabled, onRun }: { disabled: boolean; onRun: RunHandler }) {
  const [characterImage, setCharacterImage] = useState<string | null>(null);
  const [productImage, setProductImage] = useState<string | null>(null);
  const [productInfo, setProductInfo] = useState('');
  const [userConcept, setUserConcept] = useState('');
  const [duration, setDuration] = useState(8);
  const [ratio, setRatio] = useState(RATIOS[0]);
  const [audio, setAudio] = useState(true);

  const ready =
    Boolean(characterImage) &&
    Boolean(productImage) &&
    productInfo.trim().length >= 10 &&
    userConcept.trim().length >= 10;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <AssetUpload
          label="Character Image"
          hint="The creator whose hands and face carry the clip."
          value={characterImage}
          onChange={setCharacterImage}
          disabled={disabled}
        />
        <AssetUpload
          label="Product Image"
          hint="The product they are holding or using."
          value={productImage}
          onChange={setProductImage}
          disabled={disabled}
        />
      </div>

      <CountedTextarea
        label="Product info"
        value={productInfo}
        onChange={setProductInfo}
        min={10}
        max={2500}
        placeholder="What the product is, who it is for, and the one claim that matters."
        disabled={disabled}
      />
      <CountedTextarea
        label="Creative concept"
        value={userConcept}
        onChange={setUserConcept}
        min={10}
        max={3500}
        rows={4}
        placeholder="Show it slotting into a chaotic morning routine, shot handheld, talking straight to camera."
        disabled={disabled}
      />

      <div className="flex flex-wrap items-end gap-5">
        <DurationPicker value={duration} onChange={setDuration} disabled={disabled} />
        <PillGroup label="Ratio" options={RATIOS} value={ratio} onChange={setRatio} disabled={disabled} />
        <AudioToggle on={audio} onToggle={() => setAudio(!audio)} disabled={disabled} />
      </div>

      <SubmitRow
        label="Generate UGC clip"
        ready={ready}
        disabled={disabled}
        blocker="Add both images and at least 10 characters in each brief."
        onClick={() =>
          onRun(definitionOf(RECIPE_PRODUCT_UGC), {
            characterImage: uri(characterImage as string),
            productImage: uri(productImage as string),
            productInfo: productInfo.trim(),
            userConcept: userConcept.trim(),
            duration,
            ratio,
            audio,
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 — product_ad
// ---------------------------------------------------------------------------

function ProductAdForm({ disabled, onRun }: { disabled: boolean; onRun: RunHandler }) {
  const [productImages, setProductImages] = useState<string[]>([]);
  const [styleImages, setStyleImages] = useState<string[]>([]);
  const [productInfo, setProductInfo] = useState('');
  const [userConcept, setUserConcept] = useState('');
  const [duration, setDuration] = useState(8);
  const [ratio, setRatio] = useState(RATIOS[0]);
  const [audio, setAudio] = useState(true);

  const ready =
    productImages.length >= 1 &&
    productInfo.trim().length >= 10 &&
    userConcept.trim().length >= 10;

  return (
    <div className="flex flex-col gap-4">
      <MultiAssetUpload
        label="Product images"
        slotLabel="Product image"
        hint="Up to five shots of the same product. At least one is required."
        values={productImages}
        onChange={setProductImages}
        max={5}
        disabled={disabled}
      />
      <MultiAssetUpload
        label="Style references (optional)"
        slotLabel="Style image"
        hint="Up to three frames that set the look you want it to match."
        values={styleImages}
        onChange={setStyleImages}
        max={3}
        disabled={disabled}
      />

      <CountedTextarea
        label="Product info"
        value={productInfo}
        onChange={setProductInfo}
        min={10}
        max={2500}
        placeholder={'Name, category, material, price point \u2014 whatever the ad has to get right.'}
        disabled={disabled}
      />
      <CountedTextarea
        label="Creative concept"
        value={userConcept}
        onChange={setUserConcept}
        min={10}
        max={3500}
        rows={4}
        placeholder="Premium studio spot, slow push in on the product, one line of copy on the last frame."
        disabled={disabled}
      />

      <div className="flex flex-wrap items-end gap-5">
        <DurationPicker value={duration} onChange={setDuration} disabled={disabled} />
        <PillGroup label="Ratio" options={RATIOS} value={ratio} onChange={setRatio} disabled={disabled} />
        <AudioToggle on={audio} onToggle={() => setAudio(!audio)} disabled={disabled} />
      </div>

      <SubmitRow
        label="Generate the ad"
        ready={ready}
        disabled={disabled}
        blocker="Add at least one product image and both briefs."
        onClick={() =>
          onRun(definitionOf(RECIPE_PRODUCT_AD), {
            productImages: productImages.map(uri),
            ...(styleImages.length ? { styleImages: styleImages.map(uri) } : {}),
            productInfo: productInfo.trim(),
            userConcept: userConcept.trim(),
            duration,
            ratio,
            audio,
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 — multi_shot_video (the same brief as Pipeline C)
// ---------------------------------------------------------------------------

function MultiShotRecipeForm({ disabled, onRun }: { disabled: boolean; onRun: RunHandler }) {
  const [value, setValue] = useState<MultiShotFormValue>(emptyMultiShot);
  const ready = canSubmitMultiShot(value);

  return (
    <div className="flex flex-col gap-4">
      <MultiShotForm value={value} onChange={setValue} disabled={disabled} />
      <SubmitRow
        label="Generate the cut"
        ready={ready}
        disabled={disabled}
        blocker="Custom needs three shots of ten characters or more; auto needs a twenty-character story."
        onClick={() =>
          onRun(
            definitionOf(RECIPE_MULTI_SHOT),
            buildMultiShotPayload(toRunInput(value, 'Runway recipe')),
          )
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4 — product_swap
// ---------------------------------------------------------------------------

function ProductSwapForm({ disabled, onRun }: { disabled: boolean; onRun: RunHandler }) {
  const [referenceVideo, setReferenceVideo] = useState('');
  const [uploadedVideo, setUploadedVideo] = useState<string | null>(null);
  const [originalProductImage, setOriginalProductImage] = useState<string | null>(null);
  const [newProductImages, setNewProductImages] = useState<string[]>([]);
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);

  // A typed URL wins when both are present: it is the field Runway documents,
  // and the upload is only there for customers whose footage is local.
  const sourceVideo = referenceVideo.trim() || uploadedVideo || '';
  const ready =
    /^https:\/\//i.test(sourceVideo) &&
    Boolean(originalProductImage) &&
    newProductImages.length >= 1;

  return (
    <div className="flex flex-col gap-4">
      <Labeled
        label="Source video URL"
        hint="A public HTTPS link to the ad you want re-skinned."
      >
        <input
          type="url"
          value={referenceVideo}
          onChange={(event) => setReferenceVideo(event.target.value)}
          disabled={disabled}
          placeholder={'https://storage.googleapis.com/\u2026/source-ad.mp4'}
          className={inputClass}
        />
      </Labeled>

      <AssetUpload
        label={'\u2026 or upload the source video'}
        hint="Uploaded here, it becomes a public HTTPS link Runway can read."
        accept="video/*"
        value={uploadedVideo}
        onChange={setUploadedVideo}
        disabled={disabled}
      />

      <AssetUpload
        label="Original product image"
        hint="The product currently on screen."
        value={originalProductImage}
        onChange={setOriginalProductImage}
        disabled={disabled}
      />

      <MultiAssetUpload
        label="Replacement product images"
        slotLabel="New product"
        hint="Up to five shots of the product going in. At least one is required."
        values={newProductImages}
        onChange={setNewProductImages}
        max={5}
        disabled={disabled}
      />

      <div className="flex flex-wrap items-end gap-5">
        <DurationPicker value={duration} onChange={setDuration} disabled={disabled} />
        <PillGroup
          label="Resolution"
          options={RESOLUTIONS}
          value={resolution}
          onChange={setResolution}
          disabled={disabled}
        />
      </div>

      <SubmitRow
        label="Swap the product"
        ready={ready}
        disabled={disabled}
        blocker="Give a source video, the original product, and at least one replacement."
        onClick={() =>
          onRun(definitionOf(RECIPE_PRODUCT_SWAP), {
            referenceVideo: uri(sourceVideo),
            originalProductImage: uri(originalProductImage as string),
            newProductImages: newProductImages.map(uri),
            duration,
            resolution,
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5 — ad_localization
// ---------------------------------------------------------------------------

function AdLocalizationForm({ disabled, onRun }: { disabled: boolean; onRun: RunHandler }) {
  const [sourceAdImage, setSourceAdImage] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('es');

  const ready = Boolean(sourceAdImage) && targetLanguage.length >= 2;

  return (
    <div className="flex flex-col gap-4">
      <AssetUpload
        label="Source ad image"
        hint="The creative as it runs today."
        value={sourceAdImage}
        onChange={setSourceAdImage}
        disabled={disabled}
      />

      <Labeled label="Target language" hint="Audos native localization supports these catalog languages.">
        <select
          value={targetLanguage}
          onChange={(event) => setTargetLanguage(event.target.value)}
          disabled={disabled}
          className={inputClass}
        >
          {RUNWAY_LOCALIZATION_LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>{language.label}</option>
          ))}
        </select>
      </Labeled>

      <SubmitRow
        label="Localize the ad"
        ready={ready}
        disabled={disabled}
        blocker="Add the source ad and a target language or market."
        onClick={() =>
          onRun(definitionOf(RECIPE_AD_LOCALIZATION), {
            referenceImage: uri(sourceAdImage as string),
            targetLanguage: targetLanguage.trim(),
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6 — marketing_stock_image
// ---------------------------------------------------------------------------

function MarketingStockForm({ disabled, onRun }: { disabled: boolean; onRun: RunHandler }) {
  const [brief, setBrief] = useState('');
  const [brandReferenceImage, setBrandReferenceImage] = useState<string | null>(null);

  const ready = brief.trim().length >= 20;

  return (
    <div className="flex flex-col gap-4">
      <CountedTextarea
        label="Image brief"
        value={brief}
        onChange={setBrief}
        min={20}
        max={3500}
        rows={4}
        placeholder={'Bright editorial still for a sustainable skincare launch \u2014 morning light, linen, no faces.'}
        disabled={disabled}
      />
      <AssetUpload
        label="Brand reference (optional)"
        hint="A frame whose palette and finish the image should follow."
        value={brandReferenceImage}
        onChange={setBrandReferenceImage}
        disabled={disabled}
      />

      <SubmitRow
        label="Generate the image"
        ready={ready}
        disabled={disabled}
        blocker="Describe the image in at least 20 characters."
        onClick={() =>
          onRun(definitionOf(RECIPE_MARKETING_STOCK_IMAGE), {
            prompt: brief.trim(),
            ...(brandReferenceImage ? { referenceImage: uri(brandReferenceImage) } : {}),
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7 — product_campaign_image
// ---------------------------------------------------------------------------

function CampaignImageForm({ disabled, onRun }: { disabled: boolean; onRun: RunHandler }) {
  const [image, setImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

  const ready = Boolean(image) && prompt.trim().length >= 10;

  return (
    <div className="flex flex-col gap-4">
      <AssetUpload
        label="Product image"
        hint="One clean shot of the product the campaign is built around."
        value={image}
        onChange={setImage}
        disabled={disabled}
      />
      <CountedTextarea
        label="Creative brief"
        value={prompt}
        onChange={setPrompt}
        min={10}
        max={3500}
        rows={4}
        placeholder="Four coordinated stills: studio hero, in-use lifestyle, flat lay, and a close detail."
        disabled={disabled}
      />

      <SubmitRow
        label="Generate four images"
        ready={ready}
        disabled={disabled}
        blocker="Add a product image and a brief of at least 10 characters."
        onClick={() =>
          onRun(definitionOf(RECIPE_PRODUCT_CAMPAIGN_IMAGE), {
            image: uri(image as string),
            prompt: prompt.trim(),
          })
        }
      />
    </div>
  );
}
