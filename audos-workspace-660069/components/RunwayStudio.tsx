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
import { AlertCircle, Check, Download, Loader2, RefreshCw, Sparkles, Upload } from 'lucide-react';
import {
  RUNWAY_MODES, catalogRecipeInfo, catalogVideoModelInfo, modeSupported,
  ratioLabel, runwayCapabilities, runwayMode, runwayModeModels, runwayPoll,
  runwayQuote, runwaySubmitRecipe, runwaySubmitVideo, runwayUpload, statusText,
} from '../lib/runway';
import type {
  RunwayCapabilities, RunwayModeId, RunwayQuote, RunwayResult, RunwayVideoModel,
} from '../lib/runway';
import { routeShotIntent, runwayInputLabel, runwayModel as engineRunwayModel } from '../lib/videoEngines';

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
  panel: 'var(--space-surface-panel, #101623)',
  card: 'var(--space-surface-card, #0e131f)',
  line: 'var(--space-border-default, rgba(148,163,184,0.16))',
  lineStrong: 'var(--space-border-strong, rgba(148,163,184,0.28))',
  ink: 'var(--space-text-primary, #f1f5f9)',
  soft: 'var(--space-text-secondary, #cbd5e1)',
  muted: 'var(--space-text-muted, #94a3b8)',
  accent: 'var(--space-brand-primary-500, #f59e0b)',
  onAccent: 'var(--space-text-on-primary, #180f02)',
  good: 'var(--space-semantic-success-500, #22c55e)',
  bad: 'var(--space-semantic-danger-500, #ef4444)',
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
}

const IDLE_RUN: RunState = { phase: 'idle', quote: null, status: '', error: '', result: null };

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

function composeConcept(f: FormState): string {
  const bits: string[] = [];
  if (f.productName.trim()) bits.push(`Product: ${f.productName.trim()}.`);
  if (f.productDescription.trim()) bits.push(f.productDescription.trim());
  if (f.concept.trim()) bits.push(f.concept.trim());
  return bits.join(' ').trim();
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

function buildRequest(mode: RunwayModeId, f: FormState, caps: RunwayCapabilities): BuiltRequest {
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
    body.userConcept = composeConcept(f);
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
    body.userConcept = composeConcept(f);
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
          {busy ? <Loader2 size={13} className="rw-spin" /> : <Upload size={13} />}
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
}

const RW_CSS = `
@keyframes rw-spin { to { transform: rotate(360deg); } }
.rw-spin { animation: rw-spin 1s linear infinite; }
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
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const alive = useRef(true);
  const cancelSignals = useRef<Record<string, { cancelled: boolean }>>({});

  useEffect(() => () => { alive.current = false; }, []);

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
      return { ...prev, [mode]: { ...cur, phase: 'idle', quote: null } };
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

  // ---- quote / generate ----

  const getQuote = useCallback(async () => {
    if (!caps) return;
    const problem = validate(mode, form, caps);
    if (problem) { setRun(mode, { phase: 'error', error: problem, result: null }); return; }
    setRun(mode, { phase: 'quoting', error: '', quote: null, status: '' });
    try {
      const request = buildRequest(mode, form, caps);
      const quote = await runwayQuote(request.quoteBody, caps.creditUsd);
      if (!alive.current) return;
      setRun(mode, { phase: 'quoted', quote, error: '' });
    } catch (e: any) {
      if (!alive.current) return;
      setRun(mode, { phase: 'error', error: String(e?.message || e), quote: null });
    }
  }, [caps, form, mode, setRun]);

  const generate = useCallback(async () => {
    if (!caps) return;
    const id = mode;
    const signal = { cancelled: false };
    cancelSignals.current[id] = signal;
    setRun(id, { phase: 'running', error: '', status: 'Submitting to Runway…', result: null });
    try {
      const request = buildRequest(id, form, caps);
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
    } catch (e: any) {
      if (!alive.current) return;
      setRun(id, { phase: 'error', error: String(e?.message || e), status: '' });
    }
  }, [caps, form, mode, props, setRun]);

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
   * FULL Runway roster; entries the live catalogue does not list render
   * disabled with the reason instead of failing at submit. */
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
            const offline = !!caps && caps.models.length > 0 && !caps.models.some((cm) => cm.id === m);
            return (
              <button
                key={m} type="button" className="rw-btn" disabled={offline}
                onClick={() => setForm({ model: m, modelMode: 'manual' })}
                title={offline
                  ? (cat?.unavailableReason || 'Not available on this workspace right now')
                  : (cat ? `${runwayInputLabel(cat)} — ${cat.blurb}` : '')}
                style={{
                  background: on ? t.accent : t.panel, color: on ? t.onAccent : t.soft,
                  border: `1px solid ${on ? 'transparent' : t.line}`, borderRadius: 8,
                  padding: '7px 14px', fontSize: 12.5, fontWeight: 700,
                  cursor: offline ? 'not-allowed' : 'pointer', opacity: offline ? 0.45 : 1, fontFamily: t.font,
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
          <div style={{ color: t.muted, fontSize: 11.5, marginTop: 6 }}>
            {manualCat ? `${runwayInputLabel(manualCat)} · ${manualCat.blurb}` : 'Manual override — this concrete Runway model is quoted and submitted.'}
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
              conceptLabel: 'Tone / creative direction',
              conceptPlaceholder: 'e.g. Premium editorial finish, warm studio light, calm and confident.',
            })}
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
              conceptLabel: 'Creator persona / angle',
              conceptPlaceholder: 'e.g. Busy parent filming on their phone before the school run, upbeat and unscripted.',
            })}
            <MediaField label="Creator reference" accept="image/*" value={form.characterImage} t={t} hint="The creator who presents the product. Strongly recommended — it keeps the same face across takes." onChange={(url) => setForm({ characterImage: url })} />
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
        <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Loader2 size={16} className="rw-spin" color={t.accent} />
          <span style={{ fontSize: 13, color: t.soft }}>{run.status || 'Generating…'}</span>
          <button
            type="button" className="rw-btn" onClick={cancel}
            style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${t.line}`, borderRadius: 8, padding: '6px 12px', color: t.muted, fontSize: 12, cursor: 'pointer', fontFamily: t.font }}
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
              {capsBusy ? <Loader2 size={12} className="rw-spin" /> : <RefreshCw size={12} />} Refresh models
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
            Runway is not answering right now, so generation is disabled. {caps.reason}
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
              title={offline ? 'Not offered by the live Runway catalogue right now' : m.blurb}
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
        {/* Form */}
        <div style={s.card}>
          <div style={{ fontSize: 13, color: t.soft, lineHeight: 1.55, marginBottom: 12 }}>{def.blurb}</div>
          {!supported ? (
            <div style={{ fontSize: 12.5, color: t.muted, lineHeight: 1.55, marginBottom: 12 }}>
              The live catalogue is not offering this mode right now, so it cannot be submitted.
            </div>
          ) : null}
          {renderForm()}

          {/* Quote → confirm */}
          <div style={{ borderTop: `1px solid ${t.line}`, paddingTop: 12, marginTop: 4 }}>
            {run.phase === 'quoted' && run.quote ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: t.ink, marginBottom: 4 }}>{run.quote.label}</div>
                <div style={{ fontSize: 12, color: t.muted, marginBottom: 10, lineHeight: 1.5 }}>
                  Quoted by Runway for exactly these inputs. Nothing is charged until you generate.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button" className="rw-btn" disabled={!supported} onClick={() => void generate()}
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
                type="button" className="rw-btn" disabled={busy || !supported || !caps?.available}
                onClick={() => void getQuote()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: t.accent, color: t.onAccent, border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: t.font }}
                data-testid="runway-quote"
              >
                {run.phase === 'quoting' ? <Loader2 size={14} className="rw-spin" /> : <Sparkles size={14} />}
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
    </div>
  );
}
