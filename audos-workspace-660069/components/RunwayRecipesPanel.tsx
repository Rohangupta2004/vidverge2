/**
 * RUNWAY RECIPES PANEL — shared UI for the seven allowlisted Runway Recipes
 * (product_ad, product_swap, product_ugc, multi_shot_video, ad_localization,
 * marketing_stock_image, product_campaign_image).
 *
 * Used by Creatables and by Ads Studio's Runway tools section. Contract:
 *  - a FREE quote is fetched and shown BEFORE the paid submit is enabled
 *  - every submit sends X-Workspace-DB-Token + a fresh Idempotency-Key
 *    (handled inside lib/videoEngineClient)
 *  - 503 generation_disabled renders the friendly "being enabled" message
 *  - 'uncertain' → never resubmit; failed/cancelled → auto-refund note
 *  - all media inputs must be public HTTPS URLs (validated before submit)
 */
import { useMemo, useRef, useState } from 'react';
import { Loader2, Upload, X, Play, Download, Calculator, AlertTriangle } from 'lucide-react';
import {
  RUNWAY_RECIPES, RUNWAY_RATIOS, RUNWAY_LOCALIZATION_LANGUAGES, RUNWAY_DISABLED_MESSAGE,
  RunwayRecipeId, runwayRecipe,
} from '../lib/videoEngines';
import {
  EngineError, isPublicHttpsUrl, isRunwayDisabledError, pollRunway, runwayQuote, runwaySubmitRecipe,
} from '../lib/videoEngineClient';

const S = {
  card: { background: 'var(--space-surface-card, #10182A)', border: '1px solid var(--space-border-default, rgba(148,163,184,0.16))', borderRadius: 12, padding: 14 } as const,
  label: { fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--space-text-muted, #94A3B8)', display: 'block', marginBottom: 5 } as const,
  input: { width: '100%', boxSizing: 'border-box', background: 'var(--space-surface-panel, #121C30)', border: '1px solid var(--space-border-default, rgba(148,163,184,0.16))', borderRadius: 8, color: 'var(--space-text-primary, #F8FAFC)', fontSize: 12.5, padding: '8px 10px', outline: 'none' } as const,
  btn: { display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 9, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--space-border-default, rgba(148,163,184,0.16))', background: 'var(--space-surface-panel-strong, #18243A)', color: 'var(--space-text-primary, #F8FAFC)' } as const,
  primary: { display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', border: 'none', background: 'var(--space-brand-primary-600, #2563EB)', color: '#fff' } as const,
  err: { color: 'var(--space-semantic-danger, #F87171)', fontSize: 12, lineHeight: 1.5, marginTop: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 11px' } as const,
  warn: { color: '#E8A33C', fontSize: 12, lineHeight: 1.5, marginTop: 8, background: 'rgba(232,163,60,0.08)', border: '1px solid rgba(232,163,60,0.25)', borderRadius: 8, padding: '8px 11px' } as const,
};

// ---------------------------------------------------------------------------
// Media input — upload a file (→ durable public URL) or paste a public URL
// ---------------------------------------------------------------------------

function MediaInput({ label, urls, max, accept, uploadFile, onChange }: {
  label: string;
  urls: string[];
  max: number;
  accept: string;
  uploadFile: (f: File) => Promise<string>;
  onChange: (urls: string[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  const isVideo = accept.includes('video');
  return (
    <div>
      <span style={S.label}>{label}{max > 1 ? ` (${urls.length}/${max})` : ''}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {urls.map((u) => (
          <span key={u} style={{ position: 'relative', display: 'inline-block' }}>
            {isVideo
              ? <video src={u} style={{ width: 84, height: 56, objectFit: 'cover', borderRadius: 7, border: '1px solid var(--space-border-default, rgba(148,163,184,0.2))' }} muted />
              : <img src={u} alt="" style={{ width: 84, height: 56, objectFit: 'cover', borderRadius: 7, border: '1px solid var(--space-border-default, rgba(148,163,184,0.2))' }} />}
            <button type="button" onClick={() => onChange(urls.filter((x) => x !== u))} style={{ position: 'absolute', top: -6, right: -6, width: 17, height: 17, borderRadius: 999, border: 'none', background: 'var(--space-semantic-danger-500, #EF4444)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={10} /></button>
          </span>
        ))}
        {urls.length < max ? (
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={{ ...S.btn, padding: '7px 11px', fontSize: 12 }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload
          </button>
        ) : null}
        <input ref={fileRef} type="file" accept={accept} style={{ display: 'none' }} onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true); setErr('');
          try {
            const url = await uploadFile(f);
            if (!isPublicHttpsUrl(url)) throw new Error('The upload did not return a public HTTPS URL.');
            onChange([...urls, url].slice(0, max));
          } catch (ex: any) { setErr(String(ex?.message || ex)); }
          finally { setBusy(false); e.target.value = ''; }
        }} />
      </div>
      {urls.length < max ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="…or paste a public https:// URL" style={{ ...S.input, fontSize: 11.5, padding: '6px 9px' }} />
          <button type="button" style={{ ...S.btn, padding: '6px 10px', fontSize: 11.5 }} onClick={() => {
            const u = manual.trim();
            if (!u) return;
            if (!isPublicHttpsUrl(u)) { setErr('Reference URLs must be public HTTPS — private, localhost and port-bearing URLs are rejected.'); return; }
            setErr(''); onChange([...urls, u].slice(0, max)); setManual('');
          }}>Add</button>
        </div>
      ) : null}
      {err ? <div style={{ color: 'var(--space-semantic-danger, #F87171)', fontSize: 11.5, marginTop: 5 }}>{err}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipe form state
// ---------------------------------------------------------------------------

interface Shot { prompt: string; duration: number }

interface RecipeForm {
  productImages: string[];
  styleImages: string[];
  referenceVideo: string[];
  originalProductImage: string[];
  newProductImages: string[];
  characterImage: string[];
  productImage: string[];
  referenceImage: string[];
  image: string[];
  prompt: string;
  userConcept: string;
  ratio: string;
  duration: number;
  resolution: '720p' | '1080p';
  audio: boolean;
  mode: 'auto' | 'custom';
  shots: Shot[];
  targetLanguage: string;
  outputCount: number;
  quality: 'low' | 'medium' | 'high';
  hd: boolean;
}

function emptyForm(): RecipeForm {
  return {
    productImages: [], styleImages: [], referenceVideo: [], originalProductImage: [],
    newProductImages: [], characterImage: [], productImage: [], referenceImage: [], image: [],
    prompt: '', userConcept: '', ratio: '1280:720', duration: 4, resolution: '720p', audio: false,
    mode: 'auto', shots: [{ prompt: '', duration: 5 }, { prompt: '', duration: 5 }, { prompt: '', duration: 5 }],
    targetLanguage: 'es', outputCount: 1, quality: 'medium', hd: false,
  };
}

/** Build the exact request body for a recipe; returns an error string when a
 * required input is missing. Media fields use { uri } objects (per docs). */
function buildRecipeBody(id: RunwayRecipeId, f: RecipeForm): { body?: Record<string, unknown>; error?: string } {
  const uri = (u: string) => ({ uri: u });
  switch (id) {
    case 'product_ad': {
      if (!f.productImages.length) return { error: 'Add at least one product image.' };
      const body: Record<string, unknown> = { productImages: f.productImages.map(uri), ratio: f.ratio, duration: f.duration, audio: f.audio };
      if (f.styleImages.length) body.styleImages = f.styleImages.map(uri);
      if (f.userConcept.trim()) body.userConcept = f.userConcept.trim();
      return { body };
    }
    case 'product_swap': {
      if (!f.referenceVideo.length) return { error: 'Add the reference video.' };
      if (!f.originalProductImage.length) return { error: 'Add the original product image.' };
      if (!f.newProductImages.length) return { error: 'Add at least one new product image.' };
      return { body: { referenceVideo: uri(f.referenceVideo[0]), originalProductImage: uri(f.originalProductImage[0]), newProductImages: f.newProductImages.map(uri), duration: f.duration, resolution: f.resolution, audio: f.audio } };
    }
    case 'product_ugc': {
      if (!f.characterImage.length) return { error: 'Add the character image.' };
      if (!f.productImage.length) return { error: 'Add the product image.' };
      const body: Record<string, unknown> = { characterImage: uri(f.characterImage[0]), productImage: uri(f.productImage[0]), ratio: f.ratio, duration: f.duration, audio: f.audio };
      if (f.userConcept.trim()) body.userConcept = f.userConcept.trim();
      return { body };
    }
    case 'multi_shot_video': {
      if (f.mode === 'auto') {
        if (f.prompt.trim().length < 10) return { error: 'Describe the video (at least 10 characters).' };
        return { body: { mode: 'auto', prompt: f.prompt.trim(), duration: f.duration, ratio: f.ratio, quality: f.hd ? 'hd' : 'sd' } };
      }
      const shots = f.shots.filter((s) => s.prompt.trim());
      if (shots.length < 3 || shots.length > 5) return { error: 'Custom mode needs 3–5 shots with prompts.' };
      const sum = shots.reduce((a, s) => a + (Number(s.duration) || 0), 0);
      if (sum !== f.duration) return { error: `Shot durations must sum to ${f.duration}s (currently ${sum}s).` };
      return { body: { mode: 'custom', shots: shots.map((s) => ({ prompt: s.prompt.trim(), duration: s.duration })), duration: f.duration, ratio: f.ratio, quality: f.hd ? 'hd' : 'sd' } };
    }
    case 'ad_localization': {
      if (!f.referenceImage.length) return { error: 'Add the reference ad image.' };
      return { body: { referenceImage: uri(f.referenceImage[0]), targetLanguage: f.targetLanguage } };
    }
    case 'marketing_stock_image': {
      if (f.prompt.trim().length < 10) return { error: 'Describe the image (at least 10 characters).' };
      const body: Record<string, unknown> = { prompt: f.prompt.trim(), outputCount: f.outputCount, quality: f.quality };
      if (f.referenceImage.length) body.referenceImage = uri(f.referenceImage[0]);
      return { body };
    }
    case 'product_campaign_image': {
      if (!f.image.length) return { error: 'Add the product image.' };
      if (f.prompt.trim().length < 10) return { error: 'Describe the campaign direction (at least 10 characters).' };
      return { body: { image: uri(f.image[0]), prompt: f.prompt.trim() } };
    }
  }
  return { error: 'Unknown recipe.' };
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

type RunState = 'idle' | 'quoting' | 'quoted' | 'running' | 'done' | 'error';

export default function RunwayRecipesPanel({ uploadFile, initialRecipe }: {
  uploadFile: (f: File) => Promise<string>;
  initialRecipe?: RunwayRecipeId;
}) {
  const [recipeId, setRecipeId] = useState<RunwayRecipeId>(initialRecipe || 'product_ad');
  const [form, setForm] = useState<RecipeForm>(emptyForm());
  const [state, setState] = useState<RunState>('idle');
  const [quote, setQuote] = useState<{ priceUsd?: number; credits?: number } | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [error, setError] = useState('');
  const [disabled503, setDisabled503] = useState(false);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [taskId, setTaskId] = useState('');
  const recipe = runwayRecipe(recipeId)!;
  const patch = (p: Partial<RecipeForm>) => { setForm((f) => ({ ...f, ...p })); setQuote(null); if (state === 'quoted') setState('idle'); };

  const validation = useMemo(() => buildRecipeBody(recipeId, form), [recipeId, form]);

  async function getQuote() {
    if (validation.error || !validation.body) { setError(validation.error || 'Fill the required fields first.'); return; }
    setState('quoting'); setError('');
    const q = await runwayQuote({ recipeId, ...validation.body });
    if (!q.ok) { setState('idle'); setQuote(null); setError(q.error || 'The quote failed — check the inputs.'); return; }
    setQuote({ priceUsd: q.priceUsd, credits: q.credits });
    setState('quoted');
  }

  async function run() {
    if (state !== 'quoted' || !validation.body) return;
    setState('running'); setError(''); setOutputs([]); setStatusNote('Submitting to Runway…');
    try {
      const kick = await runwaySubmitRecipe(recipeId, validation.body);
      if (kick.uncertain) {
        setState('error');
        setError('Runway accepted the request but the outcome is uncertain — do NOT resubmit. Check back shortly; a duplicate submit would double-charge.');
        return;
      }
      setTaskId(kick.taskId);
      setStatusNote(`Task ${kick.taskId} — ${kick.status}…`);
      const result = await pollRunway(kick.taskId, { onStatus: (s) => setStatusNote(`Task ${kick.taskId} — ${s}…`) });
      setOutputs(result.mediaUrls);
      setState('done');
      setStatusNote(result.mediaUrls.length ? 'Done — durable media below.' : 'Succeeded, but no media URL was found in the response.');
    } catch (e: any) {
      if (isRunwayDisabledError(e)) { setDisabled503(true); setState('idle'); return; }
      setState('error');
      setError(e instanceof EngineError && e.code === 'runway_failed' ? e.message : String(e?.message || e));
    }
  }

  const videoRatios = recipeId === 'product_ugc' ? RUNWAY_RATIOS.filter((r) => ['720:1280', '832:1104'].includes(r.value)) : RUNWAY_RATIOS;

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {RUNWAY_RECIPES.map((r) => (
          <button key={r.id} type="button" onClick={() => { setRecipeId(r.id); setForm(emptyForm()); setQuote(null); setState('idle'); setError(''); setOutputs([]); }}
            title={r.purpose}
            style={{ ...S.btn, padding: '6px 11px', fontSize: 11.5, ...(recipeId === r.id ? { background: 'var(--space-brand-primary-600, #2563EB)', color: '#fff', borderColor: 'transparent' } : {}) }}>
            {r.name}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--space-text-secondary, #CBD5E1)', marginBottom: 4 }}>{recipe.purpose}</div>
      <div style={{ fontSize: 11, color: 'var(--space-text-muted, #94A3B8)', marginBottom: 12 }}>Inputs: {recipe.inputsNote} · Price: {recipe.priceNote}</div>

      {disabled503 ? <div style={S.warn}><AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 5 }} />{RUNWAY_DISABLED_MESSAGE}</div> : null}

      <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
        {recipeId === 'product_ad' ? (<>
          <MediaInput label="Product images (1–10)" urls={form.productImages} max={10} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ productImages: u })} />
          <MediaInput label="Style images (optional, up to 4)" urls={form.styleImages} max={4} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ styleImages: u })} />
        </>) : null}
        {recipeId === 'product_swap' ? (<>
          <MediaInput label="Reference video" urls={form.referenceVideo} max={1} accept="video/*" uploadFile={uploadFile} onChange={(u) => patch({ referenceVideo: u })} />
          <MediaInput label="Original product image" urls={form.originalProductImage} max={1} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ originalProductImage: u })} />
          <MediaInput label="New product images (1–10)" urls={form.newProductImages} max={10} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ newProductImages: u })} />
        </>) : null}
        {recipeId === 'product_ugc' ? (<>
          <MediaInput label="Character image" urls={form.characterImage} max={1} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ characterImage: u })} />
          <MediaInput label="Product image" urls={form.productImage} max={1} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ productImage: u })} />
        </>) : null}
        {recipeId === 'ad_localization' ? (
          <MediaInput label="Reference ad image" urls={form.referenceImage} max={1} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ referenceImage: u })} />
        ) : null}
        {recipeId === 'marketing_stock_image' ? (
          <MediaInput label="Reference image (optional)" urls={form.referenceImage} max={1} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ referenceImage: u })} />
        ) : null}
        {recipeId === 'product_campaign_image' ? (
          <MediaInput label="Product image" urls={form.image} max={1} accept="image/*" uploadFile={uploadFile} onChange={(u) => patch({ image: u })} />
        ) : null}

        {(recipeId === 'product_ad' || recipeId === 'product_ugc') ? (
          <div><span style={S.label}>Creative direction (optional)</span>
            <textarea value={form.userConcept} onChange={(e) => patch({ userConcept: e.target.value })} rows={2} placeholder={recipeId === 'product_ugc' ? 'e.g. Show how this product fits a busy morning routine.' : 'e.g. A clean studio product ad with a premium editorial finish.'} style={{ ...S.input, resize: 'vertical' }} />
          </div>
        ) : null}
        {(recipeId === 'multi_shot_video' && form.mode === 'auto') || recipeId === 'marketing_stock_image' || recipeId === 'product_campaign_image' ? (
          <div><span style={S.label}>Prompt</span>
            <textarea value={form.prompt} onChange={(e) => patch({ prompt: e.target.value })} rows={2} placeholder="Describe what you want…" style={{ ...S.input, resize: 'vertical' }} />
          </div>
        ) : null}

        {recipeId === 'multi_shot_video' ? (<>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...S.label, marginBottom: 0 }}>Mode</span>
            {(['auto', 'custom'] as const).map((m) => (
              <button key={m} type="button" onClick={() => patch({ mode: m })} style={{ ...S.btn, padding: '5px 11px', fontSize: 11.5, ...(form.mode === m ? { background: 'var(--space-brand-primary-600, #2563EB)', color: '#fff', borderColor: 'transparent' } : {}) }}>{m === 'auto' ? 'Auto (one prompt)' : 'Custom shots'}</button>
            ))}
            <span style={{ ...S.label, marginBottom: 0, marginLeft: 8 }}>Total</span>
            {[5, 10, 15].map((d) => (
              <button key={d} type="button" onClick={() => patch({ duration: d })} style={{ ...S.btn, padding: '5px 10px', fontSize: 11.5, ...(form.duration === d ? { background: 'var(--space-brand-primary-600, #2563EB)', color: '#fff', borderColor: 'transparent' } : {}) }}>{d}s</button>
            ))}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--space-text-secondary, #CBD5E1)', marginLeft: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.hd} onChange={(e) => patch({ hd: e.target.checked })} /> HD (17 credits/s vs 13)
            </label>
          </div>
          {form.mode === 'custom' ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {form.shots.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={s.prompt} onChange={(e) => { const shots = form.shots.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x); patch({ shots }); }} placeholder={`Shot ${i + 1} — what happens`} style={{ ...S.input, flex: 1 }} />
                  <input type="number" min={1} max={13} value={s.duration} onChange={(e) => { const shots = form.shots.map((x, j) => j === i ? { ...x, duration: Number(e.target.value) || 1 } : x); patch({ shots }); }} style={{ ...S.input, width: 64 }} />
                  {form.shots.length > 3 ? <button type="button" onClick={() => patch({ shots: form.shots.filter((_, j) => j !== i) })} style={{ ...S.btn, padding: '6px 8px' }}><X size={12} /></button> : null}
                </div>
              ))}
              {form.shots.length < 5 ? <button type="button" onClick={() => patch({ shots: [...form.shots, { prompt: '', duration: 5 }] })} style={{ ...S.btn, alignSelf: 'start', fontSize: 11.5 }}>+ Add shot</button> : null}
              <div style={{ fontSize: 11, color: 'var(--space-text-muted, #94A3B8)' }}>3–5 shots; durations must sum to the total ({form.duration}s).</div>
            </div>
          ) : null}
        </>) : null}

        {recipeId === 'ad_localization' ? (
          <div><span style={S.label}>Target language (22 available)</span>
            <select value={form.targetLanguage} onChange={(e) => patch({ targetLanguage: e.target.value })} style={{ ...S.input, cursor: 'pointer' }}>
              {RUNWAY_LOCALIZATION_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </div>
        ) : null}

        {recipeId === 'marketing_stock_image' ? (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div><span style={S.label}>Outputs (1–4)</span>
              <select value={form.outputCount} onChange={(e) => patch({ outputCount: Number(e.target.value) })} style={{ ...S.input, width: 90, cursor: 'pointer' }}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </div>
            <div><span style={S.label}>Quality (1 / 5 / 20 credits per output)</span>
              <select value={form.quality} onChange={(e) => patch({ quality: e.target.value as any })} style={{ ...S.input, width: 130, cursor: 'pointer' }}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select>
            </div>
          </div>
        ) : null}

        {(recipeId === 'product_ad' || recipeId === 'product_ugc') ? (
          <div><span style={S.label}>Ratio</span>
            <select value={form.ratio} onChange={(e) => patch({ ratio: e.target.value })} style={{ ...S.input, cursor: 'pointer' }}>
              {videoRatios.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        ) : null}
        {recipeId === 'multi_shot_video' ? (
          <div><span style={S.label}>Ratio</span>
            <select value={form.ratio} onChange={(e) => patch({ ratio: e.target.value })} style={{ ...S.input, cursor: 'pointer' }}>
              {RUNWAY_RATIOS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        ) : null}

        {(recipeId === 'product_ad' || recipeId === 'product_swap' || recipeId === 'product_ugc') ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <div><span style={S.label}>Duration: {form.duration}s (4–15)</span>
              <input type="range" min={4} max={15} value={form.duration} onChange={(e) => patch({ duration: Number(e.target.value) })} style={{ width: 180, accentColor: 'var(--space-brand-primary-500, #3B82F6)' }} />
            </div>
            {recipeId === 'product_swap' ? (
              <div><span style={S.label}>Resolution</span>
                <select value={form.resolution} onChange={(e) => patch({ resolution: e.target.value as any })} style={{ ...S.input, width: 110, cursor: 'pointer' }}><option value="720p">720p</option><option value="1080p">1080p</option></select>
              </div>
            ) : null}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--space-text-secondary, #CBD5E1)', cursor: 'pointer', marginTop: 12 }}>
              <input type="checkbox" checked={form.audio} onChange={(e) => patch({ audio: e.target.checked })} /> Generate audio
            </label>
          </div>
        ) : null}
      </div>

      {/* Quote → Generate (a free quote ALWAYS precedes the paid submit) */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button type="button" disabled={state === 'quoting' || state === 'running'} onClick={() => void getQuote()} style={S.btn}>
          {state === 'quoting' ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />} Get free quote
        </button>
        {quote ? (
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--space-semantic-success-600, #4ADE80)' }}>
            {quote.priceUsd !== undefined ? `$${quote.priceUsd.toFixed(2)}` : ''}{quote.credits !== undefined ? ` (${quote.credits} credits)` : ''} — exact price, quoted free
          </span>
        ) : <span style={{ fontSize: 11.5, color: 'var(--space-text-muted, #94A3B8)' }}>Quote first — the paid submit unlocks after a successful quote.</span>}
        <button type="button" disabled={state !== 'quoted'} onClick={() => void run()} style={{ ...S.primary, opacity: state === 'quoted' ? 1 : 0.45, cursor: state === 'quoted' ? 'pointer' : 'default' }}>
          {state === 'running' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Generate ({recipe.name})
        </button>
      </div>

      {state === 'running' ? <div style={{ fontSize: 12.5, color: 'var(--space-text-brand, #60A5FA)', marginTop: 10 }}><Loader2 size={13} className="animate-spin" style={{ verticalAlign: -2, marginRight: 6 }} />{statusNote} Polling every 5s.</div> : null}
      {error ? <div style={S.err}>{error}{/refund/i.test(error) ? '' : (state === 'error' && /failed|cancelled/i.test(error) ? ' Credits were automatically refunded.' : '')}</div> : null}

      {outputs.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <span style={S.label}>Output{outputs.length > 1 ? `s (${outputs.length})` : ''}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {outputs.map((u) => (
              <div key={u} style={{ background: '#000', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--space-border-default, rgba(148,163,184,0.16))' }}>
                {recipe.outputKind === 'video' && /\.(mp4|webm|mov)(\?|#|$)/i.test(u)
                  ? <video src={u} controls style={{ width: '100%', display: 'block' }} />
                  : /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u)
                    ? <img src={u} alt="output" style={{ width: '100%', display: 'block' }} />
                    : recipe.outputKind === 'video'
                      ? <video src={u} controls style={{ width: '100%', display: 'block' }} />
                      : <img src={u} alt="output" style={{ width: '100%', display: 'block' }} />}
                <a href={u} target="_blank" rel="noreferrer" download style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', fontSize: 12, fontWeight: 700, color: 'var(--space-text-brand, #60A5FA)', textDecoration: 'none' }}>
                  <Download size={12} /> Download
                </a>
              </div>
            ))}
          </div>
          {taskId ? <div style={{ fontSize: 10.5, color: 'var(--space-text-muted, #94A3B8)', marginTop: 6, fontFamily: 'monospace' }}>task: {taskId}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
