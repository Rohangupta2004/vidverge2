/**
 * RunwayStudio — the shared Runway generation surface.
 *
 * One tabbed panel that every app mounts with the subset of modes that makes
 * sense there (Ads Studio takes all nine, Product Studio takes the three
 * product recipes, and so on). Each tab runs the same contract:
 *
 *   capabilities on mount → quote → explicit Generate confirmation → submit
 *   → poll with backoff → inline player + Download
 *
 * All network work lives in lib/runway.ts. Colours come in through `theme` so
 * the panel inherits whichever palette the host app already uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AlertCircle, Check, Download, Pencil, RefreshCw, Sparkles, Upload, X } from 'lucide-react';
import VergeLoader from './VergeLoader';
import {
  RUNWAY_MODES, catalogRecipeInfo, catalogVideoModelInfo, modeSupported,
  ratioLabel, runwayCapabilities, runwayMode, runwayModeModels, runwayPoll,
  runwayQuote, runwaySubmitRecipe, runwaySubmitVideo, runwayUpload, statusText,
} from '../lib/runway';
import type {
  RunwayCapabilities, RunwayModeId, RunwayQuote, RunwayResult, RunwayVideoModel,
} from '../lib/runway';
import { routeShotIntent, runwayInputLabel, runwayModel as engineRunwayModel } from '../lib/videoEngines';
import {
  AdAngleIdea, AdCharacter, AdPersona, PersonaTarget, ProductBrief,
  briefReady, extendAdAngle, generateAdPersona, generatePresenterPortrait,
  personaConceptLines, personaSignature,
} from '../lib/adPersona';
import {
  OMNI_FALLBACK_LABEL, generateWithOmniFlash, isModelRejection, omniFallbackMessage,
} from '../lib/omniFallback';
import { buildRecipePrompt, logRecipePrompt, saveRecipeGeneration } from '../lib/recipeLibrary';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface RunwayTheme {
  bg: string;
  panel: string;
  card: string;
  line: string;
  lineStrong: string;
  ink: string;
  soft: string;
  muted: string;
  accent: string;
  onAccent: string;
  good: string;
  bad: string;
  font: string;
}

const DEFAULT_THEME: RunwayTheme = {
  bg: 'transparent',
  panel: 'var(--space-surface-panel, #FFFAEB)',
  card: 'var(--space-surface-card, #FFFFFF)',
  line: 'var(--space-border-default, rgba(180,120,0,0.14))',
  lineStrong: 'var(--space-border-strong, rgba(180,120,0,0.36))',
  ink: 'var(--space-text-primary, #1A1000)',
  soft: 'var(--space-text-secondary, #3D2800)',
  muted: 'var(--space-text-muted, #7A6030)',
  accent: 'var(--space-brand-primary-500, #C8920A)',
  onAccent: 'var(--space-text-on-primary, #FFFFFF)',
  good: 'var(--space-semantic-success-500, #166534)',
  bad: 'var(--space-semantic-danger-500, #991B1B)',
  font: "'Inter', system-ui, -apple-system, sans-serif",
};

// ---------------------------------------------------------------------------
// Per-tab form + run state
// ---------------------------------------------------------------------------

interface FormState {
  productName: string;
  productDescription: string;
  /** Creative direction: tone, persona, campaign theme or motion note. */
  concept: string;
  /** Standalone prompt for text→video and stock imagery. */
  prompt: string;
  productImage: string;
  characterImage: string;
  originalProductImage: string;
  sourceVideo: string;
  sourceImage: string;
  shots: string[];
  language: string;
  ratio: string;
  duration: number;
  model: RunwayVideoModel;
  modelMode: 'auto' | 'manual';
  quality: string;
}

function emptyForm(): FormState {
  return {
    productName: '', productDescription: '', concept: '', prompt: '',
    productImage: '', characterImage: '', originalProductImage: '',
    sourceVideo: '', sourceImage: '',
    shots: ['', ''],
    language: 'es', ratio: '', duration: 5, model: 'gen4.5', modelMode: 'auto', quality: 'high',
  };
}

type Phase = 'idle' | 'quoting' | 'quoted' | 'running' | 'done' | 'error';

interface RunState {
  phase: Phase;
  quote: RunwayQuote | null;
  status: string;
  error: string;
  result: RunwayResult | null;
  /** Runway refused this model, so Generate runs it on Omni Flash instead. */
  fallback: boolean;
}

const IDLE_RUN: RunState = { phase: 'idle', quote: null, status: '', error: '', result: null, fallback: false };

/** The quote shown when Runway will not price a model and Omni Flash takes it. */
function omniQuote(): RunwayQuote {
  return {
    credits: 0,
    usd: 0,
    outputs: 1,
    label: `${OMNI_FALLBACK_LABEL} · billed as workspace credits, one per second of video`,
    raw: null,
  };
}

// ---------------------------------------------------------------------------
// Auto-written presenter + angle (opt-in via `autoPersona`)
// ---------------------------------------------------------------------------

/** The recipes that put a presenter on camera, so a cast persona means something. */
const PERSONA_MODES: RunwayModeId[] = ['product_ad', 'product_ugc'];

interface PersonaState {
  /** The product the current persona was written for. */
  signature: string;
  character: AdCharacter | null;
  angle: AdAngleIdea | null;
  characterBusy: boolean;
  angleBusy: boolean;
  error: string;
  /** The presenter's face: drawn from the description, or the customer's own photo. */
  portraitUrl: string;
  portraitSource: 'auto' | 'upload';
  portraitBusy: boolean;
  portraitError: string;
}

const IDLE_PERSONA: PersonaState = {
  signature: '', character: null, angle: null, characterBusy: false, angleBusy: false, error: '',
  portraitUrl: '', portraitSource: 'auto', portraitBusy: false, portraitError: '',
};

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** The creative brief a recipe reads. Built through buildRecipePrompt, so it
 * is always control-character free, never double-spaced, never empty and
 * never over the 500-character ceiling the proxies answer 400 to. */
function composeConcept(f: FormState, persona?: AdPersona | null): string {
  const bits: string[] = [];
  if (f.productName.trim()) bits.push(`Product: ${f.productName.trim()}.`);
  if (f.productDescription.trim()) bits.push(f.productDescription.trim());
  if (f.concept.trim()) bits.push(f.concept.trim());
  // The auto-written presenter and angle ride along in the same creative brief
  // the recipe already reads its character direction from.
  personaConceptLines(persona || null).forEach((line) => bits.push(line));
  // An empty concept would be an automatic refusal, so the product description
  // (and then a generic direction) stands in.
  return buildRecipePrompt(bits, f.productDescription || f.productName);
}

/**
 * Optional fields the workspace engine catalog documents for each recipe. Used
 * only when the live capabilities response does not spell its own fields out;
 * anything wrong here surfaces as a quote error, before a charge.
 */
const CATALOG_OPTIONAL_FIELDS: Record<string, string[]> = {
  product_ad: ['ratio', 'duration'],
  product_swap: ['userConcept', 'duration'],
  product_ugc: ['ratio', 'duration'],
  multi_shot_video: ['ratio'],
  ad_localization: [],
  marketing_stock_image: ['ratio'],
  product_campaign_image: [],
};

function recipeAccepts(caps: RunwayCapabilities, recipeId: string, field: string): boolean {
  const recipe = caps.recipes.filter((r) => r.id === recipeId)[0];
  if (recipe && recipe.fields.length) return recipe.fields.indexOf(field) >= 0;
  return (CATALOG_OPTIONAL_FIELDS[recipeId] || []).indexOf(field) >= 0;
}

interface BuiltRequest {
  endpoint: 'video' | 'recipe';
  recipeId?: string;
  body: Record<string, any>;
  quoteBody: Record<string, any>;
}

function autoImageRoute(caps: RunwayCapabilities) {
  const turboLive = caps.available && caps.models.some((m) => m.id === 'gen4_turbo');
  return routeShotIntent('stills_to_motion', { runwayEnabled: turboLive });
}

function modelLabelOf(id: string): string {
  return engineRunwayModel(id)?.label || id;
}

function resolvedVideoModel(mode: 'text_to_video' | 'image_to_video', f: FormState, caps: RunwayCapabilities): RunwayVideoModel {
  if (f.modelMode !== 'auto') return f.model;
  if (mode === 'image_to_video') {
    const id = autoImageRoute(caps).engineId;
    if (id && runwayModeModels('image_to_video').indexOf(id) >= 0 && caps.models.some((m) => m.id === id)) return id;
  }
  // First roster model the live catalogue actually offers for this mode.
  const live = runwayModeModels(mode).filter((m) => !caps.models.length || caps.models.some((cm) => cm.id === m));
  return live[0] || (mode === 'image_to_video' ? 'gen4_turbo' : 'gen4.5');
}

function validate(mode: RunwayModeId, f: FormState, caps: RunwayCapabilities): string {
  switch (mode) {
    case 'product_ad':
      if (!f.productImage) return 'Add a product image — the ad is assembled around your real product.';
      if (!composeConcept(f)) return 'Describe the product or the creative direction you want.';
      return '';
    case 'product_swap':
      if (!f.sourceVideo) return 'Upload the source video you want the product swapped inside.';
      if (!f.productImage) return 'Add an image of the replacement product.';
      return '';
    case 'product_ugc':
      if (!f.productImage) return 'Add a product image — UGC is built around the real product.';
      if (!composeConcept(f)) return 'Describe the creator persona or the angle you want them to take.';
      return '';
    case 'multi_shot_video':
      if (f.shots.filter((s) => s.trim()).length < 2) return 'Describe at least two shots.';
      return '';
    case 'ad_localization':
      if (!f.sourceVideo && !f.sourceImage) return 'Upload the ad you want localized.';
      if (!f.language) return 'Pick a target language.';
      return '';
    case 'product_campaign_image':
      if (!f.productImage) return 'Add the product image the campaign is built around.';
      if (!f.concept.trim() && !f.productDescription.trim()) return 'Describe the campaign theme.';
      return '';
    case 'marketing_stock_image':
      if (!f.prompt.trim()) return 'Describe the image you need.';
      return '';
    case 'text_to_video':
      if (!f.prompt.trim()) return 'Write a prompt for the clip.';
      return '';
    case 'image_to_video': {
      if (!f.productImage) return 'Upload the image you want animated.';
      const m = resolvedVideoModel('image_to_video', f, caps);
      if (m !== 'gen4_turbo' && !f.prompt.trim()) return `${modelLabelOf(m)} image-to-video needs a motion prompt as well as the image.`;
      return '';
    }
    default:
      return '';
  }
}

function buildRequest(mode: RunwayModeId, f: FormState, caps: RunwayCapabilities, persona?: AdPersona | null): BuiltRequest {
  const def = runwayMode(mode);
  const ratio = f.ratio || caps.ratios[0] || '';

  if (mode === 'text_to_video') {
    const body: Record<string, any> = { model: resolvedVideoModel('text_to_video', f, caps), promptText: f.prompt.trim() };
    if (ratio) body.ratio = ratio;
    if (f.duration) body.duration = f.duration;
    return { endpoint: 'video', body, quoteBody: body };
  }

  if (mode === 'image_to_video') {
    const model = resolvedVideoModel('image_to_video', f, caps);
    const body: Record<string, any> = { model };
    if (model === 'gen4_turbo') {
      // Turbo takes the ordered-frame form and is image-to-video only.
      body.promptImage = [{ uri: f.productImage, position: 'first' }];
      if (f.prompt.trim()) body.promptText = f.prompt.trim();
    } else {
      body.mode = 'image-to-video';
      body.promptText = f.prompt.trim();
      body.promptImage = f.productImage;
    }
    if (ratio) body.ratio = ratio;
    if (f.duration) body.duration = f.duration;
    return { endpoint: 'video', body, quoteBody: body };
  }

  const recipeId = String(def.recipeId);
  const body: Record<string, any> = {};

  if (mode === 'product_ad') {
    if (f.productImage) body.productImages = [{ uri: f.productImage }];
    // Product Ad does not advertise characterImage in the static catalogue,
    // but pass it when the live capabilities response explicitly opts in.
    if (f.characterImage && recipeAccepts(caps, recipeId, 'characterImage')) {
      body.characterImage = { uri: f.characterImage };
    }
    body.userConcept = composeConcept(f, persona);
    if (ratio && recipeAccepts(caps, recipeId, 'ratio')) body.ratio = ratio;
    if (f.duration && recipeAccepts(caps, recipeId, 'duration')) body.duration = f.duration;
  } else if (mode === 'product_swap') {
    body.referenceVideo = { uri: f.sourceVideo };
    body.newProductImages = [{ uri: f.productImage }];
    if (f.originalProductImage) body.originalProductImage = { uri: f.originalProductImage };
    if (f.concept.trim() && recipeAccepts(caps, recipeId, 'userConcept')) body.userConcept = f.concept.trim();
  } else if (mode === 'product_ugc') {
    body.productImage = { uri: f.productImage };
    if (f.characterImage) body.characterImage = { uri: f.characterImage };
    body.userConcept = composeConcept(f, persona);
    if (ratio && recipeAccepts(caps, recipeId, 'ratio')) body.ratio = ratio;
    if (f.duration && recipeAccepts(caps, recipeId, 'duration')) body.duration = f.duration;
  } else if (mode === 'multi_shot_video') {
    const shots = f.shots.map((s) => s.trim()).filter(Boolean);
    const lines = shots.map((s, i) => `Shot ${i + 1}: ${s}`).join('\n');
    body.prompt = f.concept.trim() ? `${lines}\nOverall style: ${f.concept.trim()}` : lines;
    body.mode = 'auto';
    body.duration = f.duration;
    if (ratio && recipeAccepts(caps, recipeId, 'ratio')) body.ratio = ratio;
  } else if (mode === 'ad_localization') {
    if (f.sourceVideo) body.referenceVideo = { uri: f.sourceVideo };
    else body.referenceImage = { uri: f.sourceImage };
    body.targetLanguage = f.language;
  } else if (mode === 'product_campaign_image') {
    body.image = { uri: f.productImage };
    body.prompt = [f.productDescription.trim(), f.concept.trim()].filter(Boolean).join(' — ') || composeConcept(f);
  } else if (mode === 'marketing_stock_image') {
    body.prompt = f.prompt.trim();
    body.quality = f.quality;
    if (ratio && recipeAccepts(caps, recipeId, 'ratio')) body.ratio = ratio;
  }

  return { endpoint: 'recipe', recipeId, body, quoteBody: { recipeId, ...body } };
}

/**
 * What Omni Flash is asked to film when Runway refuses the chosen model. It
 * reads the SAME brief the recipe would have read — the written prompt, the
 * shot list and the composed creative direction including the cast presenter
 * and the ad angle — so the stand-in shoots the ad the customer described,
 * not a generic clip.
 */
function omniBriefFor(mode: RunwayModeId, f: FormState, persona: AdPersona | null): {
  prompt: string;
  seed: string;
  reference: string;
} {
  const shots = f.shots.map((s) => s.trim()).filter(Boolean);
  const prompt = buildRecipePrompt([
    f.prompt.trim(),
    shots.length ? shots.map((s, i) => `Shot ${i + 1}: ${s}`).join(' ') : '',
    composeConcept(f, persona),
  ], f.productDescription || f.productName);
  return {
    prompt,
    seed: f.productImage || f.sourceImage || '',
    reference: mode === 'product_ugc' ? f.characterImage : '',
  };
}

// ---------------------------------------------------------------------------
// Small inputs
// ---------------------------------------------------------------------------

function useStyles(t: RunwayTheme): { label: CSSProperties; input: CSSProperties; card: CSSProperties } {
  return useMemo(() => ({
    label: {
      display: 'block', fontSize: 11, fontWeight: 700, color: t.muted,
      textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 5,
    },
    input: {
      width: '100%', background: t.panel, border: `1px solid ${t.line}`, borderRadius: 9,
      padding: '9px 11px', color: t.ink, fontSize: 13.5, fontFamily: t.font,
      outline: 'none', boxSizing: 'border-box' as const,
    },
    card: {
      background: t.card, border: `1px solid ${t.line}`, borderRadius: 12, padding: 14,
    },
  }), [t]);
}

function Field(props: { label: string; hint?: string; children: any; t: RunwayTheme }) {
  const s = useStyles(props.t);
  return (
    <div style={{ marginBottom: 12 }}>
      <span style={s.label}>{props.label}</span>
      {props.children}
      {props.hint ? <div style={{ fontSize: 11.5, color: props.t.muted, marginTop: 5, lineHeight: 1.45 }}>{props.hint}</div> : null}
    </div>
  );
}

function MediaField(props: {
  label: string;
  accept: string;
  value: string;
  hint?: string;
  t: RunwayTheme;
  onChange: (url: string) => void;
}) {
  const { t } = props;
  const s = useStyles(t);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(props.value);

  const pick = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      props.onChange(await runwayUpload(file));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <span style={s.label}>{props.label}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => ref.current?.click()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, background: t.panel,
            border: `1px dashed ${t.lineStrong}`, borderRadius: 9, padding: '9px 14px',
            color: t.soft, fontSize: 12.5, fontWeight: 600, fontFamily: t.font,
            cursor: busy ? 'progress' : 'pointer',
          }}
        >
          {busy ? <VergeLoader size={28} label="Uploading" /> : <Upload size={13} />}
          {busy ? 'Uploading…' : props.value ? 'Replace' : 'Upload'}
        </button>
        {props.value ? (
          isVideo
            ? <video src={props.value} style={{ width: 92, height: 56, borderRadius: 7, background: '#000', objectFit: 'cover' }} muted />
            : <img src={props.value} alt="" style={{ width: 56, height: 56, borderRadius: 7, objectFit: 'cover', border: `1px solid ${t.line}` }} />
        ) : null}
        {props.value ? (
          <button
            type="button"
            onClick={() => props.onChange('')}
            style={{ background: 'none', border: 'none', color: t.muted, fontSize: 12, cursor: 'pointer', fontFamily: t.font }}
          >
            Remove
          </button>
        ) : null}
      </div>
      <input
        style={{ ...s.input, marginTop: 8, fontSize: 12 }}
        placeholder="…or paste a public https:// URL"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <input
        ref={ref} type="file" accept={props.accept} style={{ display: 'none' }}
        onChange={(e) => { void pick(e.target.files?.[0] || null); e.target.value = ''; }}
      />
      {error ? <div style={{ fontSize: 11.5, color: t.bad, marginTop: 5 }}>{error}</div> : null}
      {props.hint && !error ? <div style={{ fontSize: 11.5, color: t.muted, marginTop: 5, lineHeight: 1.45 }}>{props.hint}</div> : null}
    </div>
  );
}

function Select(props: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; t: RunwayTheme }) {
  const s = useStyles(props.t);
  return (
    <select style={{ ...s.input, cursor: 'pointer' }} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface RunwayPrefill {
  productName?: string;
  productDescription?: string;
  productImage?: string;
  sourceVideo?: string;
  prompt?: string;
  concept?: string;
  shots?: string[];
}

export interface RunwayStudioProps {
  /** Which tabs to show. Defaults to all nine. */
  modes?: RunwayModeId[];
  title?: string;
  subtitle?: string;
  theme?: Partial<RunwayTheme>;
  /** Seeds empty fields from the host app (product details, loaded video…). */
  prefill?: RunwayPrefill;
  /** Fires once a generation succeeds — hosts use it to adopt the media. */
  onResult?: (r: { mode: RunwayModeId; result: RunwayResult }) => void;
  /** Label + handler for an extra button beside Download (e.g. "Add to timeline"). */
  adoptLabel?: string;
  onAdopt?: (url: string, mode: RunwayModeId) => void;
  initialMode?: RunwayModeId;
  /** Controlled tab. Model Lab drives this from its catalogue cards; leave it
   * unset and the tab strip owns the selection itself. */
  mode?: RunwayModeId;
  onModeChange?: (mode: RunwayModeId) => void;
  /** Drops the header when the host already provides one. */
  bare?: boolean;
  /**
   * Write the ad's presenter and angle automatically as soon as the customer
   * has given a product image and a line about the product. Off by default, so
   * only hosts that ask for it (Ads Studio's Recipes surface) pay for the call.
   */
  autoPersona?: boolean;
}

const RW_CSS = `
.rw-btn { transition: filter .15s ease, opacity .15s ease; }
.rw-btn:hover:not(:disabled) { filter: brightness(1.12); }
.rw-btn:disabled { opacity: .5; cursor: not-allowed; }
`;

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export default function RunwayStudio(props: RunwayStudioProps) {
  const t: RunwayTheme = useMemo(() => ({ ...DEFAULT_THEME, ...(props.theme || {}) }), [props.theme]);
  const s = useStyles(t);

  const modes = useMemo(
    () => (props.modes && props.modes.length ? props.modes : RUNWAY_MODES.map((m) => m.id)),
    [props.modes],
  );
  const [internalMode, setInternalMode] = useState<RunwayModeId>(
    props.initialMode && modes.indexOf(props.initialMode) >= 0 ? props.initialMode : modes[0],
  );
  const mode: RunwayModeId = props.mode && modes.indexOf(props.mode) >= 0 ? props.mode : internalMode;
  const onModeChange = props.onModeChange;
  const setMode = useCallback((next: RunwayModeId) => {
    setInternalMode(next);
    onModeChange?.(next);
  }, [onModeChange]);
  const [caps, setCaps] = useState<RunwayCapabilities | null>(null);
  const [capsBusy, setCapsBusy] = useState(true);
  const [toast, setToast] = useState('');
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const alive = useRef(true);
  const cancelSignals = useRef<Record<string, { cancelled: boolean }>>({});

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 9000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadCaps = useCallback(async (refresh = false) => {
    setCapsBusy(true);
    const next = await runwayCapabilities({ refresh });
    if (!alive.current) return;
    setCaps(next);
    setCapsBusy(false);
  }, []);

  useEffect(() => { void loadCaps(false); }, [loadCaps]);

  const form = forms[mode] || emptyForm();
  const run = runs[mode] || IDLE_RUN;

  const setForm = useCallback((patch: Partial<FormState>) => {
    setForms((prev) => ({ ...prev, [mode]: { ...(prev[mode] || emptyForm()), ...patch } }));
    // Any edit invalidates the quote the customer was about to confirm.
    setRuns((prev) => {
      const cur = prev[mode];
      if (!cur || cur.phase !== 'quoted') return prev;
      return { ...prev, [mode]: { ...cur, phase: 'idle', quote: null, fallback: false } };
    });
  }, [mode]);

  const setRun = useCallback((id: RunwayModeId, patch: Partial<RunState>) => {
    setRuns((prev) => ({ ...prev, [id]: { ...(prev[id] || IDLE_RUN), ...patch } }));
  }, []);

  // Defaults from the live catalogue, applied once capabilities land.
  useEffect(() => {
    if (!caps) return;
    setForms((prev) => {
      const cur = prev[mode] || emptyForm();
      if (cur.ratio && caps.ratios.indexOf(cur.ratio) >= 0) return prev;
      const duration = caps.durations.indexOf(cur.duration) >= 0 ? cur.duration : (caps.durations[0] || 5);
      return { ...prev, [mode]: { ...cur, ratio: caps.ratios[0] || '', duration } };
    });
  }, [caps, mode]);

  // Seed empty fields from the host app without ever overwriting typing.
  const prefill = props.prefill;
  const prefillKey = useMemo(() => JSON.stringify(prefill || {}), [prefill]);
  useEffect(() => {
    if (!prefill) return;
    setForms((prev) => {
      const next = { ...prev };
      modes.forEach((id) => {
        const cur = next[id] || emptyForm();
        const merged: FormState = { ...cur };
        if (!merged.productName && prefill.productName) merged.productName = prefill.productName;
        if (!merged.productDescription && prefill.productDescription) merged.productDescription = prefill.productDescription;
        if (!merged.productImage && prefill.productImage) merged.productImage = prefill.productImage;
        if (!merged.sourceVideo && prefill.sourceVideo) merged.sourceVideo = prefill.sourceVideo;
        if (!merged.prompt && prefill.prompt) merged.prompt = prefill.prompt;
        if (!merged.concept && prefill.concept) merged.concept = prefill.concept;
        if (prefill.shots && prefill.shots.length && !cur.shots.some((x) => x.trim())) merged.shots = prefill.shots.slice(0, 6);
        next[id] = merged;
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey, modes]);

  // ---- auto-written presenter + angle ----

  const [persona, setPersona] = useState<PersonaState>(IDLE_PERSONA);
  // A photo the customer chose themselves outranks the automatic portrait: it
  // is only replaced when they ask for the creator to be rewritten.
  const ownPortrait = useRef(false);
  const portraitInput = useRef<HTMLInputElement>(null);
  const [portraitUploading, setPortraitUploading] = useState(false);
  // Write-your-own angle — the alternative path to Regenerate.
  const [angleWriterOpen, setAngleWriterOpen] = useState(false);
  const [angleDraft, setAngleDraft] = useState('');
  const [angleExtendBusy, setAngleExtendBusy] = useState(false);
  const [angleExtendError, setAngleExtendError] = useState('');
  const personaCapable = !!props.autoPersona && PERSONA_MODES.indexOf(mode) >= 0;
  const personaBrief: ProductBrief = { productName: form.productName, productDescription: form.productDescription };
  const personaSig = personaCapable && briefReady(form.productImage, personaBrief)
    ? personaSignature(form.productImage, personaBrief)
    : '';
  // Only a persona written for the product currently in the form is shown or sent
  // downstream — changing the product, or moving to a tab holding a different one,
  // never carries the old cast over.
  const personaMatches = !!personaSig && persona.signature === personaSig;
  const personaForRequest = personaMatches && (persona.character || persona.angle) ? persona : null;

  const writePersona = useCallback(async (
    want: PersonaTarget,
    sig: string,
    brief: ProductBrief,
    opts: { regeneratePortrait?: boolean } = {},
  ) => {
    const wantsCharacter = want !== 'angle';
    // Writing the creator draws their portrait in the same pass, from the
    // description that just came back — so the card never shows a face that
    // disagrees with the words under it.
    const wantsPortrait = wantsCharacter && (opts.regeneratePortrait === true || !ownPortrait.current);
    setPersona((prev) => ({
      ...prev,
      signature: sig,
      error: '',
      characterBusy: wantsCharacter,
      angleBusy: want !== 'character',
      portraitBusy: wantsPortrait,
      portraitError: wantsPortrait ? '' : prev.portraitError,
    }));
    try {
      const written = await generateAdPersona({ brief, want });
      if (!alive.current) return;
      setPersona((prev) => ({
        ...prev,
        signature: sig,
        character: written.character || prev.character,
        angle: written.angle || prev.angle,
        characterBusy: false,
        angleBusy: false,
        error: '',
      }));
      if (!wantsPortrait || !written.character) {
        setPersona((prev) => ({ ...prev, portraitBusy: false }));
        return;
      }
      try {
        const url = await generatePresenterPortrait({ character: written.character, brief });
        if (!alive.current) return;
        ownPortrait.current = false;
        setPersona((prev) => ({
          ...prev, portraitUrl: url, portraitSource: 'auto', portraitBusy: false, portraitError: '',
        }));
      } catch (e: any) {
        // A face that cannot be drawn never blocks the ad — the written
        // description still carries the casting downstream.
        if (!alive.current) return;
        setPersona((prev) => ({ ...prev, portraitBusy: false, portraitError: String(e?.message || e) }));
      }
    } catch (e: any) {
      if (!alive.current) return;
      setPersona((prev) => ({
        ...prev, characterBusy: false, angleBusy: false, portraitBusy: false, error: String(e?.message || e),
      }));
    }
  }, []);

  // A new product writes a new presenter and angle, once the typing settles.
  // A failed attempt keeps its signature, so it never retries in a loop — the
  // card offers a retry button instead.
  useEffect(() => {
    if (!personaSig || personaSig === persona.signature) return;
    const brief: ProductBrief = { productName: form.productName, productDescription: form.productDescription };
    const timer = window.setTimeout(() => { void writePersona('both', personaSig, brief); }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaSig, persona.signature, writePersona]);

  // Regenerate is always explicit, so it refreshes the description AND the
  // portrait together — including over a photo the customer uploaded.
  const rewritePersona = useCallback((want: PersonaTarget) => {
    const brief: ProductBrief = { productName: form.productName, productDescription: form.productDescription };
    const sig = personaSignature(form.productImage, brief);
    void writePersona(want, sig, brief, { regeneratePortrait: true });
  }, [form.productImage, form.productName, form.productDescription, writePersona]);

  /** Swap the generated portrait for the customer's own photo. */
  const uploadPortrait = useCallback(async (file: File | null) => {
    if (!file) return;
    setPortraitUploading(true);
    setPersona((prev) => ({ ...prev, portraitError: '' }));
    try {
      const url = await runwayUpload(file);
      if (!alive.current) return;
      ownPortrait.current = true;
      setPersona((prev) => ({
        ...prev, portraitUrl: url, portraitSource: 'upload', portraitBusy: false, portraitError: '',
      }));
    } catch (e: any) {
      if (!alive.current) return;
      setPersona((prev) => ({ ...prev, portraitError: String(e?.message || e) }));
    } finally {
      if (alive.current) setPortraitUploading(false);
    }
  }, []);

  const openAngleWriter = useCallback(() => {
    setAngleExtendError('');
    setAngleWriterOpen(true);
    setAngleDraft((prev) => prev || persona.angle?.hook || '');
  }, [persona.angle]);

  /** Take the customer's draft as the angle, exactly as they typed it. */
  const applyOwnAngle = useCallback(() => {
    const text = angleDraft.trim().replace(/\s+/g, ' ');
    if (!text) return;
    const brief: ProductBrief = { productName: form.productName, productDescription: form.productDescription };
    setPersona((prev) => ({
      ...prev,
      signature: personaSignature(form.productImage, brief),
      angle: { name: 'Your angle', pain: '', hook: text, cta: prev.angle?.cta || '' },
      angleBusy: false,
      error: '',
    }));
    setAngleExtendError('');
  }, [angleDraft, form.productImage, form.productName, form.productDescription]);

  /** Complete the draft into a full angle without losing their wording. */
  const autoExtendAngle = useCallback(async () => {
    const draft = angleDraft.trim();
    if (!draft) { setAngleExtendError('Write a line or two first — Auto-extend finishes your own draft.'); return; }
    setAngleExtendBusy(true);
    setAngleExtendError('');
    const brief: ProductBrief = { productName: form.productName, productDescription: form.productDescription };
    try {
      const angle = await extendAdAngle({ draft, brief });
      if (!alive.current) return;
      setPersona((prev) => ({
        ...prev,
        signature: personaSignature(form.productImage, brief),
        angle,
        angleBusy: false,
        error: '',
      }));
      setAngleDraft(angle.hook || draft);
    } catch (e: any) {
      if (!alive.current) return;
      setAngleExtendError(String(e?.message || e));
    } finally {
      if (alive.current) setAngleExtendBusy(false);
    }
  }, [angleDraft, form.productImage, form.productName, form.productDescription]);

  // ---- quote / generate ----

  /** The model name the customer actually picked, for the fallback message. */
  const chosenModelLabel = useCallback((id: RunwayModeId) => (
    (id === 'text_to_video' || id === 'image_to_video') && caps
      ? modelLabelOf(resolvedVideoModel(id, form, caps))
      : runwayMode(id).label
  ), [caps, form]);

  const getQuote = useCallback(async () => {
    if (!caps) return;
    const problem = validate(mode, form, caps);
    if (problem) { setRun(mode, { phase: 'error', error: problem, result: null }); return; }
    setRun(mode, { phase: 'quoting', error: '', quote: null, status: '' });
    try {
      const request = buildRequest(mode, form, caps, personaForRequest);
      const quote = await runwayQuote(request.quoteBody, caps.creditUsd);
      if (!alive.current) return;
      setRun(mode, { phase: 'quoted', quote, error: '', fallback: false });
    } catch (e: any) {
      if (!alive.current) return;
      // Runway prices only the models its own catalogue lists, so a refused
      // price check on a roster model is not a dead end — it is the signal to
      // quote Omni Flash instead and keep the customer moving.
      if (!runwayMode(mode).recipeId && runwayMode(mode).kind === 'video' && isModelRejection(e)) {
        setToast(omniFallbackMessage(chosenModelLabel(mode)));
        setRun(mode, { phase: 'quoted', quote: omniQuote(), error: '', fallback: true });
        return;
      }
      setRun(mode, { phase: 'error', error: String(e?.message || e), quote: null, fallback: false });
    }
  }, [caps, chosenModelLabel, form, mode, personaForRequest, setRun]);

  /** Re-run the brief on Omni Flash. Resolves false when it could not stand in. */
  const runOmniFallback = useCallback(async (
    id: RunwayModeId,
    signal: { cancelled: boolean },
  ): Promise<boolean> => {
    const brief = omniBriefFor(id, form, personaForRequest);
    logRecipePrompt(`${id} via ${OMNI_FALLBACK_LABEL}`, brief.prompt);
    try {
      const out = await generateWithOmniFlash({
        prompt: brief.prompt,
        aspect: form.ratio,
        durationSeconds: form.duration,
        seedImageUrl: brief.seed,
        referenceImageUrl: brief.reference,
        onStatus: (status) => { if (alive.current) setRun(id, { status }); },
        isCancelled: () => signal.cancelled,
      });
      if (!alive.current) return true;
      const result: RunwayResult = {
        taskId: '', status: 'succeeded', mediaUrls: [out.videoUrl], mediaIds: [], kind: 'video', raw: null,
      };
      setRun(id, { phase: 'done', result, status: '', error: '', fallback: true });
      setToast(omniFallbackMessage(chosenModelLabel(id)));
      props.onResult?.({ mode: id, result });
      // The stand-in's clip belongs in Saved Videos too — it is the ad the
      // customer asked for, filmed by a different engine.
      void saveRecipeGeneration({
        mediaUrls: result.mediaUrls,
        provider: 'gemini',
        kind: 'video',
        recipeId: id,
        model: OMNI_FALLBACK_LABEL,
        prompt: brief.prompt,
        aspectRatio: form.ratio,
      });
      return true;
    } catch {
      return false;
    }
  }, [chosenModelLabel, form, personaForRequest, props, setRun]);

  const generate = useCallback(async () => {
    if (!caps) return;
    const id = mode;
    const signal = { cancelled: false };
    cancelSignals.current[id] = signal;
    const viaOmni = (runs[id] || IDLE_RUN).fallback;

    setRun(id, {
      phase: 'running',
      error: '',
      status: viaOmni ? `Generating on ${OMNI_FALLBACK_LABEL}…` : 'Submitting to Runway…',
      result: null,
    });

    if (viaOmni) {
      const ok = await runOmniFallback(id, signal);
      if (!ok && alive.current) {
        setRun(id, { phase: 'error', status: '', error: `${OMNI_FALLBACK_LABEL} could not generate this either — adjust the brief and try again.` });
      }
      return;
    }

    try {
      const request = buildRequest(id, form, caps, personaForRequest);
      const sentPrompt = String(request.body.promptText || request.body.prompt || request.body.userConcept || '');
      logRecipePrompt(request.recipeId || id, sentPrompt);
      const submission = request.endpoint === 'video'
        ? await runwaySubmitVideo(request.body)
        : await runwaySubmitRecipe(request.recipeId as any, request.body);
      if (!alive.current) return;
      setRun(id, { status: statusText(submission.status) });
      const result = await runwayPoll(submission.taskId, {
        signal,
        onStatus: (status) => { if (alive.current) setRun(id, { status: statusText(status) }); },
      });
      if (!alive.current) return;
      setRun(id, { phase: 'done', result, status: '', error: '' });
      props.onResult?.({ mode: id, result });
      // NORMALISE AT SAVE TIME. A Runway generation lands straight in the
      // browser, so nothing else would ever register it — this is what makes
      // it show up under Recipes → Saved Videos → Runway.
      void saveRecipeGeneration({
        mediaUrls: result.mediaUrls,
        provider: 'runway',
        kind: result.kind === 'image' ? 'image' : 'video',
        recipeId: request.recipeId || id,
        model: String(request.body.model || request.recipeId || id),
        prompt: sentPrompt,
        aspectRatio: String(request.body.ratio || form.ratio || ''),
        taskId: result.taskId || submission.taskId,
      });
    } catch (e: any) {
      if (!alive.current) return;
      // A model Runway will not accept hands the shot to Omni Flash. If the
      // stand-in cannot film it either, the customer reads the ORIGINAL
      // refusal — not a second one about a model they never chose.
      if (!signal.cancelled && !runwayMode(id).recipeId && runwayMode(id).kind === 'video' && isModelRejection(e)) {
        setRun(id, { status: `Generating on ${OMNI_FALLBACK_LABEL}…` });
        if (await runOmniFallback(id, signal)) return;
      }
      if (!alive.current) return;
      setRun(id, { phase: 'error', error: String(e?.message || e), status: '' });
    }
  }, [caps, form, mode, personaForRequest, props, runOmniFallback, runs, setRun]);

  const cancel = useCallback(() => {
    const signal = cancelSignals.current[mode];
    if (signal) signal.cancelled = true;
  }, [mode]);

  // ---- derived ----

  const def = runwayMode(mode);
  const supported = caps ? modeSupported(caps, mode) : true;
  const ratioOptions = useMemo(
    () => (caps?.ratios || []).map((r) => ({ value: r, label: ratioLabel(r) })),
    [caps],
  );
  const durationOptions = useMemo(
    () => (caps?.durations || []).map((d) => ({ value: String(d), label: `${d}s` })),
    [caps],
  );
  const languageOptions = useMemo(
    () => (caps?.languages || []).map((l) => ({ value: l.code, label: `${l.label} (${l.code})` })),
    [caps],
  );
  const busy = run.phase === 'running' || run.phase === 'quoting';
  const imageAutoRoute = caps ? autoImageRoute(caps) : null;
  const activeVideoModel = caps
    ? resolvedVideoModel(mode === 'text_to_video' ? 'text_to_video' : 'image_to_video', form, caps)
    : form.model;

  // ---- form renderers ----

  const productBlock = (opts: { imageLabel: string; imageHint?: string; conceptLabel: string; conceptPlaceholder: string }) => (
    <>
      <Field label="Product name" t={t}>
        <input style={s.input} value={form.productName} onChange={(e) => setForm({ productName: e.target.value })} placeholder="e.g. Lumen Desk Lamp" />
      </Field>
      <Field label="Product description" t={t}>
        <textarea style={{ ...s.input, minHeight: 66, resize: 'vertical' }} value={form.productDescription} onChange={(e) => setForm({ productDescription: e.target.value })} placeholder="What it is, who it's for, what makes it different…" />
      </Field>
      <MediaField label={opts.imageLabel} accept="image/*" value={form.productImage} hint={opts.imageHint} t={t} onChange={(url) => setForm({ productImage: url })} />
      <Field label={opts.conceptLabel} t={t}>
        <textarea style={{ ...s.input, minHeight: 66, resize: 'vertical' }} value={form.concept} onChange={(e) => setForm({ concept: e.target.value })} placeholder={opts.conceptPlaceholder} />
      </Field>
    </>
  );

  /** One half of the auto-written persona, with its own Rewrite button. */
  const personaCard = (opts: { title: string; busy: boolean; want: PersonaTarget; children: any; extra?: any }) => (
    <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {opts.title}
        </span>
        {opts.extra || null}
        <button
          type="button" className="rw-btn"
          disabled={persona.characterBusy || persona.angleBusy || (opts.want !== 'angle' && persona.portraitBusy)}
          onClick={() => rewritePersona(opts.want)}
          title={`Write a different ${opts.title.toLowerCase()}`}
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'none', border: `1px solid ${t.line}`, borderRadius: 7, padding: '4px 9px',
            color: t.muted, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: t.font,
          }}
        >
          {opts.busy ? <VergeLoader size={26} label="Regenerating" /> : <RefreshCw size={11} />} Regenerate
        </button>
      </div>
      {opts.busy
        ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 0' }}>
            <VergeLoader size={96} caption={`Writing your ${opts.title.toLowerCase()}`} />
          </div>
        )
        : opts.children}
    </div>
  );

  const productAdAcceptsCharacterImage = mode === 'product_ad'
    && !!caps
    && recipeAccepts(caps, 'product_ad', 'characterImage');
  const acceptsCharacterReference = mode === 'product_ugc' || productAdAcceptsCharacterImage;
  const portraitIsCreatorReference = acceptsCharacterReference
    && !!form.characterImage
    && form.characterImage === persona.portraitUrl;

  /**
   * The presenter's face. Drawn from the same description the recipe is asked
   * to film, or replaced by a photo the customer uploads themselves. Choosing
   * it as recipe input is explicit: the visible Creator reference field remains
   * the source of truth for pricing and generation.
   */
  const portraitFrame = (
    <div style={{ width: 120, flexShrink: 0 }}>
      <div
        style={{
          width: 120, height: 120, borderRadius: 12, overflow: 'hidden', background: t.panel,
          border: `1px solid ${t.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {persona.portraitBusy ? (
          <VergeLoader size={100} label="Drawing the portrait" />
        ) : persona.portraitUrl ? (
          <img
            src={persona.portraitUrl}
            alt={persona.character?.name ? `${persona.character.name}, the presenter` : 'The presenter'}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span style={{ fontSize: 10.5, color: t.muted, textAlign: 'center', padding: 10, lineHeight: 1.45 }}>
            No portrait yet
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: t.muted, marginTop: 5, textAlign: 'center', lineHeight: 1.4 }}>
        {persona.portraitBusy
          ? 'Drawing the portrait…'
          : persona.portraitUrl
            ? (persona.portraitSource === 'upload' ? 'Your photo' : '✨ Auto-generated')
            : ''}
      </div>
      <button
        type="button" className="rw-btn" disabled={portraitUploading}
        onClick={() => portraitInput.current?.click()}
        title="Use your own photo of the presenter instead"
        style={{
          marginTop: 6, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          background: t.panel, border: `1px dashed ${t.lineStrong}`, borderRadius: 8, padding: '6px 8px',
          color: t.soft, fontSize: 11, fontWeight: 600, cursor: portraitUploading ? 'progress' : 'pointer', fontFamily: t.font,
        }}
        data-testid="persona-portrait-upload"
      >
        {portraitUploading ? <VergeLoader size={26} label="Uploading your photo" /> : <Upload size={11} />}
        {portraitUploading ? 'Uploading…' : 'Upload your own'}
      </button>
      <input
        ref={portraitInput} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { void uploadPortrait(e.target.files?.[0] || null); e.target.value = ''; }}
      />
      {personaMatches && persona.portraitUrl && acceptsCharacterReference && !form.characterImage ? (
        <button
          type="button" className="rw-btn"
          onClick={() => setForm({ characterImage: persona.portraitUrl })}
          title="Send this visible portrait to Runway as the creator reference"
          style={{
            marginTop: 6, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: t.accent, border: 'none', borderRadius: 8, padding: '7px 8px',
            color: t.onAccent, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: t.font,
          }}
          data-testid="persona-use-as-reference"
        >
          <Check size={11} /> Use as creator reference
        </button>
      ) : null}
      {personaMatches && portraitIsCreatorReference ? (
        <div style={{ marginTop: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 10.5, color: t.good, fontWeight: 700, lineHeight: 1.4 }}>
            <Check size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} /> Sent with this recipe
          </div>
          <button
            type="button" className="rw-btn"
            onClick={() => setForm({ characterImage: '' })}
            style={{
              marginTop: 3, background: 'none', border: 'none', padding: 0,
              color: t.muted, fontSize: 10.5, cursor: 'pointer', fontFamily: t.font,
            }}
            data-testid="persona-clear-reference"
          >
            Clear reference
          </button>
        </div>
      ) : null}
      {persona.portraitError ? (
        <div style={{ fontSize: 10.5, color: t.bad, marginTop: 5, lineHeight: 1.45 }}>{persona.portraitError}</div>
      ) : null}
    </div>
  );

  /** The write-your-own angle editor, with Auto-extend. */
  const angleWriter = !angleWriterOpen ? null : (
    <div style={{ marginTop: 10, borderTop: `1px solid ${t.line}`, paddingTop: 10 }}>
      <span style={s.label}>Your angle</span>
      <textarea
        style={{ ...s.input, minHeight: 74, resize: 'vertical' }}
        value={angleDraft}
        onChange={(e) => setAngleDraft(e.target.value)}
        placeholder="Your own headline, quote or CTA — e.g. “I stopped buying three of these a year”"
        data-testid="angle-own-draft"
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <button
          type="button" className="rw-btn" disabled={angleExtendBusy || !angleDraft.trim() || !personaSig}
          onClick={() => void autoExtendAngle()}
          title="Finish this draft into a full angle"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, background: t.accent, color: t.onAccent,
            border: 'none', borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: t.font,
          }}
          data-testid="angle-auto-extend"
        >
          {angleExtendBusy ? <VergeLoader size={28} tone="ink" label="Extending your angle" /> : <Sparkles size={12} />}
          {angleExtendBusy ? 'Extending…' : 'Auto-extend'}
        </button>
        <button
          type="button" className="rw-btn" disabled={angleExtendBusy || !angleDraft.trim() || !personaSig}
          onClick={applyOwnAngle}
          title="Run the ad on exactly what you typed"
          style={{
            background: t.panel, border: `1px solid ${t.line}`, borderRadius: 8, padding: '7px 13px',
            color: t.soft, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: t.font,
          }}
          data-testid="angle-own-apply"
        >
          Use my angle
        </button>
        <button
          type="button" className="rw-btn"
          onClick={() => { setAngleWriterOpen(false); setAngleExtendError(''); }}
          style={{
            background: 'none', border: 'none', color: t.muted, fontSize: 12, cursor: 'pointer', fontFamily: t.font,
          }}
        >
          Close
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: t.muted, marginTop: 7, lineHeight: 1.5 }}>
        {personaSig
          ? 'Auto-extend finishes your draft into a full angle — the pain it speaks to, one spoken hook and a call to action — in your own words.'
          : 'Name the product and say what it is first — your angle is written against that brief.'}
      </div>
      {angleExtendError ? (
        <div style={{ fontSize: 11.5, color: t.bad, marginTop: 6, lineHeight: 1.5 }}>{angleExtendError}</div>
      ) : null}
    </div>
  );

  const angleWriterToggle = (
    <button
      type="button" className="rw-btn"
      onClick={() => (angleWriterOpen ? setAngleWriterOpen(false) : openAngleWriter())}
      title="Write the angle yourself instead of regenerating it"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: angleWriterOpen ? `color-mix(in srgb, ${t.accent} 16%, transparent)` : 'none',
        border: `1px solid ${angleWriterOpen ? `color-mix(in srgb, ${t.accent} 42%, transparent)` : t.line}`,
        borderRadius: 7, padding: '4px 9px', color: angleWriterOpen ? t.accent : t.muted,
        fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: t.font,
      }}
      data-testid="angle-write-own"
    >
      <Pencil size={11} /> Write your own
    </button>
  );

  /**
   * The presenter + angle card. It sits directly under the product inputs and
   * writes itself — nothing here has to be filled in by hand, and whatever it
   * says is what the recipe is asked to film.
   */
  const personaBlock = !personaCapable ? null : (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 11, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Sparkles size={14} color={t.accent} />
        <span style={{ fontSize: 13, fontWeight: 700, color: t.ink }}>Presenter &amp; angle</span>
        {personaMatches && (persona.character || persona.angle) ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '3px 9px',
            background: `color-mix(in srgb, ${t.accent} 16%, transparent)`,
            border: `1px solid color-mix(in srgb, ${t.accent} 38%, transparent)`,
            color: t.accent, fontSize: 11, fontWeight: 700,
          }}>
            ✨ Auto-generated
          </span>
        ) : null}
      </div>

      {!personaMatches || (!persona.character && !persona.angle && !persona.characterBusy && !persona.angleBusy) ? (
        <div>
          <div style={{ fontSize: 12.5, color: t.muted, lineHeight: 1.55 }}>
            {!personaSig
              ? 'Say what the product is (name it and give it a short sentence) — the creator who presents it and the angle the ad runs on are written for you.'
              : persona.error
                ? 'The presenter and angle could not be written this time.'
                : 'Reading your product…'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              type="button" className="rw-btn"
              disabled={!personaSig || persona.characterBusy || persona.angleBusy}
              onClick={() => rewritePersona('both')}
              title={personaSig ? 'Write the creator and the angle from your product brief' : 'Name the product and say what it is first'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: t.accent, color: t.onAccent, border: 'none', borderRadius: 8,
                padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: t.font,
              }}
              data-testid="persona-generate"
            >
              <Sparkles size={13} /> Generate presenter &amp; angle
            </button>
            <button
              type="button" className="rw-btn" disabled={!personaSig}
              onClick={() => (angleWriterOpen ? setAngleWriterOpen(false) : openAngleWriter())}
              title={personaSig ? 'Write the angle yourself instead' : 'Name the product and say what it is first'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: t.panel, border: `1px solid ${t.line}`, borderRadius: 8,
                padding: '8px 14px', fontSize: 12.5, fontWeight: 700, color: t.soft,
                cursor: 'pointer', fontFamily: t.font,
              }}
              data-testid="angle-write-own-empty"
            >
              <Pencil size={13} /> Write your own angle
            </button>
          </div>
          {angleWriter}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {personaCard({
            title: 'Creator', busy: persona.characterBusy, want: 'character',
            children: persona.character ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {portraitFrame}
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: t.ink, marginBottom: 5 }}>{persona.character.name}</div>
                  {persona.character.appearance ? (
                    <div style={{ fontSize: 12.5, color: t.soft, lineHeight: 1.55 }}>{persona.character.appearance}</div>
                  ) : null}
                  {persona.character.personality ? (
                    <div style={{ fontSize: 12.5, color: t.muted, lineHeight: 1.55, marginTop: 5 }}>{persona.character.personality}</div>
                  ) : null}
                </div>
              </div>
            ) : <div style={{ fontSize: 12.5, color: t.muted }}>Not written yet.</div>,
          })}
          {personaCard({
            title: 'Angle', busy: persona.angleBusy, want: 'angle', extra: angleWriterToggle,
            children: (
              <div>
                {persona.angle ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: t.ink, marginBottom: 5 }}>{persona.angle.name}</div>
                    {persona.angle.pain ? (
                      <div style={{ fontSize: 12.5, color: t.soft, lineHeight: 1.55 }}>{persona.angle.pain}</div>
                    ) : null}
                    {persona.angle.hook ? (
                      <div style={{ fontSize: 13.5, fontWeight: 700, fontStyle: 'italic', color: t.ink, lineHeight: 1.5, marginTop: 7 }}>
                        “{persona.angle.hook}”
                      </div>
                    ) : null}
                    {persona.angle.cta ? (
                      <div style={{ fontSize: 12.5, color: t.accent, fontWeight: 700, marginTop: 6 }}>{persona.angle.cta}</div>
                    ) : null}
                  </div>
                ) : <div style={{ fontSize: 12.5, color: t.muted }}>Not written yet — regenerate it, or write your own.</div>}
                {angleWriter}
              </div>
            ),
          })}
        </div>
      )}

      {persona.error ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10 }}>
          <AlertCircle size={13} color={t.bad} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 12, color: t.soft, lineHeight: 1.5 }}>{persona.error}</span>
          <button
            type="button" className="rw-btn" onClick={() => rewritePersona('both')}
            style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${t.line}`, borderRadius: 7, padding: '4px 9px', color: t.muted, fontSize: 11.5, cursor: 'pointer', fontFamily: t.font }}
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );

  const ratioField = (
    ratioOptions.length ? (
      <Field label="Aspect ratio" t={t}>
        <Select value={form.ratio || ratioOptions[0].value} options={ratioOptions} onChange={(v) => setForm({ ratio: v })} t={t} />
      </Field>
    ) : null
  );

  const durationField = (
    durationOptions.length ? (
      <Field label="Duration" t={t}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {durationOptions.map((d) => {
            const on = String(form.duration) === d.value;
            return (
              <button
                key={d.value} type="button" className="rw-btn"
                onClick={() => setForm({ duration: Number(d.value) })}
                style={{
                  background: on ? t.accent : t.panel, color: on ? t.onAccent : t.soft,
                  border: `1px solid ${on ? 'transparent' : t.line}`, borderRadius: 8,
                  padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: t.font,
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </Field>
    ) : null
  );

  /** Shared model picker for the two base-model modes — rendered from the
   * FULL Runway roster, every entry selectable. What the live catalogue is
   * currently listing shows up in each button's tooltip rather than greying
   * the choice out, so nothing in the roster is unreachable. */
  const modelField = (modeId: 'text_to_video' | 'image_to_video') => {
    const roster = runwayModeModels(modeId);
    const active = caps ? resolvedVideoModel(modeId, form, caps) : form.model;
    const activeCat = engineRunwayModel(active);
    const manualCat = engineRunwayModel(form.model);
    return (
      <Field label="Model" t={t}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button" className="rw-btn"
            onClick={() => setForm({ modelMode: 'auto' })}
            style={{
              background: form.modelMode === 'auto' ? t.accent : t.panel,
              color: form.modelMode === 'auto' ? t.onAccent : t.soft,
              border: `1px solid ${form.modelMode === 'auto' ? 'transparent' : t.line}`, borderRadius: 8,
              padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: t.font,
            }}
          >
            Auto — Director picks
          </button>
          {roster.map((m) => {
            const cat = engineRunwayModel(m);
            const on = form.modelMode === 'manual' && form.model === m;
            return (
              <button
                key={m} type="button" className="rw-btn"
                onClick={() => setForm({ model: m, modelMode: 'manual' })}
                title={cat ? `${runwayInputLabel(cat)} — ${cat.blurb}` : ''}
                style={{
                  background: on ? t.accent : t.panel, color: on ? t.onAccent : t.soft,
                  border: `1px solid ${on ? 'transparent' : t.line}`, borderRadius: 8,
                  padding: '7px 14px', fontSize: 12.5, fontWeight: 700,
                  cursor: 'pointer', fontFamily: t.font,
                }}
              >
                {cat?.label || m}
              </button>
            );
          })}
        </div>
        {form.modelMode === 'auto' ? (
          <div style={{ marginTop: 8, background: t.panel, border: `1px solid ${t.line}`, borderRadius: 9, padding: '9px 11px' }}>
            <div style={{ color: t.ink, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>
              Director's pick: {modelLabelOf(active)}
            </div>
            <div style={{ color: t.muted, fontSize: 11.5, lineHeight: 1.5 }}>
              {modeId === 'image_to_video' && imageAutoRoute?.engineId === active
                ? imageAutoRoute.reason
                : activeCat
                  ? `${runwayInputLabel(activeCat)} · ${activeCat.blurb}`
                  : 'The first Runway model the live catalogue offers for this mode.'}
            </div>
          </div>
        ) : (
          <div style={{ color: t.muted, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
            {manualCat ? `${runwayInputLabel(manualCat)} · ${manualCat.blurb}` : 'Manual override — this concrete Runway model is quoted and submitted.'}
            {caps && caps.models.length > 0 && !caps.models.some((cm) => cm.id === form.model) ? (
              <div style={{ marginTop: 3 }}>
                The live Runway catalogue is not listing this model today. Check price still works: if Runway refuses it, the shot is
                generated on {OMNI_FALLBACK_LABEL} instead and the result says so.
              </div>
            ) : null}
          </div>
        )}
      </Field>
    );
  };

  function renderForm() {
    switch (mode) {
      case 'product_ad':
        return (
          <>
            {productBlock({
              imageLabel: 'Product image',
              imageHint: 'A clean shot of the real product. Runway builds the whole ad around it.',
              conceptLabel: 'Tone / creative direction (optional)',
              conceptPlaceholder: 'e.g. Premium editorial finish, warm studio light, calm and confident.',
            })}
            {personaBlock}
            {productAdAcceptsCharacterImage ? (
              <MediaField
                label="Creator reference"
                accept="image/*"
                value={form.characterImage}
                t={t}
                hint={portraitIsCreatorReference
                  ? 'Using the portrait above. Replace it here with another photo, or remove it before checking the price.'
                  : 'Optional. The live Runway catalog accepts a creator image for this Product Ad.'}
                onChange={(url) => setForm({ characterImage: url })}
              />
            ) : null}
            {durationField}
            {ratioField}
          </>
        );

      case 'product_swap':
        return (
          <>
            <MediaField label="Source video" accept="video/*" value={form.sourceVideo} t={t} hint="The ad whose product you want replaced. The shot, motion and pacing are kept." onChange={(url) => setForm({ sourceVideo: url })} />
            <MediaField label="Replacement product" accept="image/*" value={form.productImage} t={t} onChange={(url) => setForm({ productImage: url })} />
            <MediaField label="Original product (optional)" accept="image/*" value={form.originalProductImage} t={t} hint="Helps Runway find the product it has to paint over." onChange={(url) => setForm({ originalProductImage: url })} />
            <Field label="Swap notes (optional)" t={t}>
              <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={form.concept} onChange={(e) => setForm({ concept: e.target.value })} placeholder="Anything Runway should know about how the new product should sit in the shot." />
            </Field>
          </>
        );

      case 'product_ugc':
        return (
          <>
            {productBlock({
              imageLabel: 'Product image',
              conceptLabel: 'Creator persona / angle (optional)',
              conceptPlaceholder: 'e.g. Busy parent filming on their phone before the school run, upbeat and unscripted.',
            })}
            {personaBlock}
            <MediaField
              label="Creator reference"
              accept="image/*"
              value={form.characterImage}
              t={t}
              hint={portraitIsCreatorReference
                ? 'Using the portrait above. Replace it here with another photo, or remove it before checking the price.'
                : 'The creator who presents the product. Use the portrait above or upload a different photo; this is what Runway receives.'}
              onChange={(url) => setForm({ characterImage: url })}
            />
            {durationField}
            {ratioField}
          </>
        );

      case 'multi_shot_video':
        return (
          <>
            <Field label="Shots (2–6)" t={t}>
              <div style={{ display: 'grid', gap: 8 }}>
                {form.shots.map((shot, i) => (
                  <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: t.muted, paddingTop: 11, width: 22, flexShrink: 0 }}>{i + 1}</span>
                    <textarea
                      style={{ ...s.input, minHeight: 50, resize: 'vertical' }}
                      value={shot}
                      placeholder={i === 0 ? 'Wide establishing shot of the product on a concrete surface' : 'Close-up detail shot as the light sweeps across'}
                      onChange={(e) => {
                        const shots = form.shots.slice();
                        shots[i] = e.target.value;
                        setForm({ shots });
                      }}
                    />
                    {form.shots.length > 2 ? (
                      <button
                        type="button" className="rw-btn"
                        onClick={() => setForm({ shots: form.shots.filter((_, x) => x !== i) })}
                        style={{ background: 'none', border: 'none', color: t.muted, cursor: 'pointer', fontSize: 12, paddingTop: 10, fontFamily: t.font }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {form.shots.length < 6 ? (
                <button
                  type="button" className="rw-btn"
                  onClick={() => setForm({ shots: [...form.shots, ''] })}
                  style={{ marginTop: 8, background: t.panel, border: `1px solid ${t.line}`, borderRadius: 8, padding: '7px 13px', color: t.soft, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: t.font }}
                >
                  Add a shot
                </button>
              ) : null}
            </Field>
            <Field label="Overall style" t={t}>
              <input style={s.input} value={form.concept} onChange={(e) => setForm({ concept: e.target.value })} placeholder="e.g. Moody cinematic, shallow depth of field, single light source" />
            </Field>
            {durationField}
            {ratioField}
          </>
        );

      case 'ad_localization':
        return (
          <>
            <MediaField
              label="Source ad"
              accept="video/*,image/*"
              value={form.sourceVideo || form.sourceImage}
              t={t}
              hint="Upload the finished ad. A video is sent as the reference video; a still is sent as the reference image."
              onChange={(url) => {
                const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
                setForm(isVideo || !url ? { sourceVideo: url, sourceImage: '' } : { sourceImage: url, sourceVideo: '' });
              }}
            />
            <Field label="Target language" hint={`${languageOptions.length} languages available.`} t={t}>
              <Select value={form.language} options={languageOptions} onChange={(v) => setForm({ language: v })} t={t} />
            </Field>
          </>
        );

      case 'product_campaign_image':
        return (
          <>
            <MediaField label="Product image" accept="image/*" value={form.productImage} t={t} onChange={(url) => setForm({ productImage: url })} />
            <Field label="Product description" t={t}>
              <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={form.productDescription} onChange={(e) => setForm({ productDescription: e.target.value })} placeholder="What the product is and who it's for…" />
            </Field>
            <Field label="Campaign theme" hint="Runway returns a coordinated set, not a single image." t={t}>
              <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={form.concept} onChange={(e) => setForm({ concept: e.target.value })} placeholder="e.g. Spring reset — pale linen, morning light, soft shadows" />
            </Field>
          </>
        );

      case 'marketing_stock_image':
        return (
          <>
            <Field label="Describe the image" t={t}>
              <textarea style={{ ...s.input, minHeight: 84, resize: 'vertical' }} value={form.prompt} onChange={(e) => setForm({ prompt: e.target.value })} placeholder="Bright editorial image for a sustainable skincare campaign — hands, glass, natural light…" />
            </Field>
            <Field label="Quality" t={t}>
              <Select
                value={form.quality}
                options={[{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]}
                onChange={(v) => setForm({ quality: v })}
                t={t}
              />
            </Field>
            {ratioField}
          </>
        );

      case 'text_to_video':
        return (
          <>
            <Field label="Prompt" hint={`Runs on ${modelLabelOf(activeVideoModel)}.`} t={t}>
              <textarea style={{ ...s.input, minHeight: 96, resize: 'vertical' }} value={form.prompt} onChange={(e) => setForm({ prompt: e.target.value })} placeholder="A product hero shot moving through warm studio light, slow push in, shallow depth of field…" />
            </Field>
            {modelField('text_to_video')}
            {durationField}
            {ratioField}
          </>
        );

      case 'image_to_video':
        return (
          <>
            <MediaField label="Image to animate" accept="image/*" value={form.productImage} t={t} onChange={(url) => setForm({ productImage: url })} />
            <Field label="Motion prompt" hint={activeVideoModel === 'gen4_turbo' ? 'Optional on Gen-4 Turbo.' : `Required on ${modelLabelOf(activeVideoModel)}.`} t={t}>
              <textarea style={{ ...s.input, minHeight: 72, resize: 'vertical' }} value={form.prompt} onChange={(e) => setForm({ prompt: e.target.value })} placeholder="A slow premium product reveal, camera drifts right as the light sweeps…" />
            </Field>
            {modelField('image_to_video')}
            {durationField}
            {ratioField}
          </>
        );

      default:
        return null;
    }
  }

  // ---- results ----

  function renderResult() {
    if (run.phase === 'running') {
      return (
        <div style={{ ...s.card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <VergeLoader size={120} caption={run.status || 'Generating your video'} />
          <button
            type="button" className="rw-btn" onClick={cancel}
            style={{ background: 'none', border: `1px solid ${t.line}`, borderRadius: 8, padding: '6px 12px', color: t.muted, fontSize: 12, cursor: 'pointer', fontFamily: t.font }}
          >
            Stop watching
          </button>
        </div>
      );
    }

    if (run.phase === 'error') {
      return (
        <div style={{ ...s.card, borderColor: t.bad }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <AlertCircle size={15} color={t.bad} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 13, color: t.soft, lineHeight: 1.55 }}>{run.error}</span>
          </div>
        </div>
      );
    }

    const result = run.result;
    if (run.phase !== 'done' || !result) return null;

    const isVideo = result.kind === 'video' || (result.kind === 'unknown' && def.kind === 'video');

    return (
      <div style={{ ...s.card, borderColor: t.good }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Check size={15} color={t.good} />
          <span style={{ fontSize: 13, fontWeight: 700, color: t.ink }}>
            {def.label} ready{result.mediaUrls.length > 1 ? ` · ${result.mediaUrls.length} outputs` : ''}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: result.mediaUrls.length > 1 ? 'repeat(auto-fill, minmax(190px, 1fr))' : '1fr', gap: 10 }}>
          {result.mediaUrls.map((url, i) => (
            <div key={url}>
              {isVideo
                ? <video src={url} controls preload="metadata" style={{ width: '100%', borderRadius: 9, background: '#000', maxHeight: 340 }} />
                : <img src={url} alt={`${def.label} output ${i + 1}`} style={{ width: '100%', borderRadius: 9, display: 'block' }} />}
              <div style={{ display: 'flex', gap: 7, marginTop: 7, flexWrap: 'wrap' }}>
                <a
                  className="rw-btn" href={url} download target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: t.accent, color: t.onAccent, borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700, textDecoration: 'none', fontFamily: t.font }}
                >
                  <Download size={12} /> Download
                </a>
                {props.onAdopt ? (
                  <button
                    type="button" className="rw-btn" onClick={() => props.onAdopt?.(url, mode)}
                    style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 8, padding: '7px 13px', color: t.soft, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: t.font }}
                  >
                    {props.adoptLabel || 'Use this'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {result.mediaIds.length ? (
          <div style={{ fontSize: 11.5, color: t.muted, marginTop: 10 }}>Saved to your workspace media library.</div>
        ) : null}
      </div>
    );
  }

  // ---- shell ----

  return (
    <div style={{ background: t.bg, color: t.ink, fontFamily: t.font }}>
      <style>{RW_CSS}</style>

      {props.bare ? null : (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <Sparkles size={17} color={t.accent} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em' }}>{props.title || 'Runway'}</h2>
            <button
              type="button" className="rw-btn" onClick={() => void loadCaps(true)} disabled={capsBusy}
              title="Re-read the live Runway catalogue"
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, background: t.panel, border: `1px solid ${t.line}`, borderRadius: 8, padding: '6px 11px', color: t.muted, fontSize: 12, cursor: 'pointer', fontFamily: t.font }}
            >
              {capsBusy ? <VergeLoader size={26} label="Refreshing models" /> : <RefreshCw size={12} />} Refresh models
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: t.muted, lineHeight: 1.55 }}>
            {props.subtitle || 'Runway ads, UGC, product swaps, multi-shot films, localization and campaign imagery. Every generation is quoted before it is charged.'}
          </p>
        </div>
      )}

      {caps && !caps.available ? (
        <div style={{ ...s.card, borderColor: t.lineStrong, marginBottom: 14, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <AlertCircle size={15} color={t.muted} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12.5, color: t.soft, lineHeight: 1.55 }}>
            Runway is not answering right now — video recipes fall back to {OMNI_FALLBACK_LABEL}. {caps.reason}
          </span>
        </div>
      ) : null}

      {/* Tabs */}
      <div role="tablist" aria-label="Runway modes" style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: 4, borderRadius: 11, border: `1px solid ${t.line}`, background: t.panel, marginBottom: 14 }}>
        {modes.map((id) => {
          const m = runwayMode(id);
          const active = id === mode;
          const offline = !!caps && !modeSupported(caps, id);
          return (
            <button
              key={id} type="button" role="tab" aria-selected={active} className="rw-btn"
              onClick={() => setMode(id)}
              title={offline
                ? `Not offered by the live Runway catalogue right now — it runs on ${OMNI_FALLBACK_LABEL} instead`
                : m.blurb}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px',
                borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: t.font,
                background: active ? t.accent : 'transparent',
                color: active ? t.onAccent : offline ? t.muted : t.soft,
                opacity: offline && !active ? 0.55 : 1,
                fontSize: 12.5, fontWeight: 700,
              }}
              data-testid={`runway-tab-${id}`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 14, alignItems: 'start' }}>
        {/* Form */}
        <div style={s.card}>
          <div style={{ fontSize: 13, color: t.soft, lineHeight: 1.55, marginBottom: 12 }}>{def.blurb}</div>
          {!supported ? (
            <div style={{ fontSize: 12.5, color: t.muted, lineHeight: 1.55, marginBottom: 12 }}>
              {runwayMode(mode).kind === 'video'
                ? `The live Runway catalogue is not offering this recipe right now — it runs on ${OMNI_FALLBACK_LABEL} instead, from the same brief.`
                : 'The live Runway catalogue is not offering this mode right now, so it cannot be submitted.'}
            </div>
          ) : null}
          {renderForm()}

          {/* Quote → confirm */}
          <div style={{ borderTop: `1px solid ${t.line}`, paddingTop: 12, marginTop: 4 }}>
            {run.phase === 'quoted' && run.quote ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: t.ink, marginBottom: 4 }}>{run.quote.label}</div>
                <div style={{ fontSize: 12, color: t.muted, marginBottom: 10, lineHeight: 1.5 }}>
                  {run.fallback
                    ? `Runway will not price this model, so Generate films the same brief on ${OMNI_FALLBACK_LABEL}. Nothing is charged until you generate.`
                    : 'Quoted by Runway for exactly these inputs. Nothing is charged until you generate.'}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button" className="rw-btn" onClick={() => void generate()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: t.accent, color: t.onAccent, border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: t.font }}
                    data-testid="runway-generate"
                  >
                    <Sparkles size={14} /> Generate
                  </button>
                  <button
                    type="button" className="rw-btn" onClick={() => setRun(mode, { phase: 'idle', quote: null })}
                    style={{ background: 'none', border: `1px solid ${t.line}`, borderRadius: 9, padding: '10px 16px', color: t.muted, fontSize: 13, cursor: 'pointer', fontFamily: t.font }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button" className="rw-btn" disabled={busy}
                onClick={() => void getQuote()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: t.accent, color: t.onAccent, border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: t.font }}
                data-testid="runway-quote"
              >
                {run.phase === 'quoting' ? <VergeLoader size={30} tone="ink" label="Pricing your generation" /> : <Sparkles size={14} />}
                {run.phase === 'quoting' ? 'Pricing…' : 'Check price'}
              </button>
            )}
          </div>
        </div>

        {/* Output */}
        <div style={{ display: 'grid', gap: 12 }}>
          {renderResult()}
          {run.phase === 'idle' || run.phase === 'quoting' || run.phase === 'quoted' ? (
            <div style={{ ...s.card, borderStyle: 'dashed' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>What this needs</div>
              <div style={{ fontSize: 13, color: t.soft, lineHeight: 1.6 }}>{def.inputs}</div>
              {(() => {
                const live = def.recipeId ? caps?.recipes.filter((r) => r.id === def.recipeId)[0] : null;
                const catalog = def.recipeId ? catalogRecipeInfo(def.recipeId) : catalogVideoModelInfo(activeVideoModel);
                const description = live?.description || (catalog as any)?.purpose || (catalog as any)?.blurb || '';
                const price = live?.price || (catalog as any)?.priceNote || '';
                if (!description && !price) return null;
                return (
                  <div style={{ fontSize: 12, color: t.muted, marginTop: 8, lineHeight: 1.55 }}>
                    {description}
                    {price ? <div style={{ marginTop: 4 }}>Typical cost: {price} — the quote above is the one that counts.</div> : null}
                  </div>
                );
              })()}
            </div>
          ) : null}
        </div>
      </div>

      {toast ? (
        <div
          role="status"
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 60, maxWidth: 380,
            display: 'flex', alignItems: 'flex-start', gap: 9,
            background: t.card, borderRadius: 12, padding: '12px 14px',
            border: `1px solid color-mix(in srgb, ${t.accent} 45%, transparent)`,
            boxShadow: '0 18px 40px rgba(120,80,0,0.12)',
          }}
          data-testid="runway-fallback-toast"
        >
          <Sparkles size={14} color={t.accent} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ flex: 1, fontSize: 12.5, color: t.soft, lineHeight: 1.5 }}>{toast}</span>
          <button
            type="button" onClick={() => setToast('')} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: t.muted, cursor: 'pointer', padding: 0, lineHeight: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
