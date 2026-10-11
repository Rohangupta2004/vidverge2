/**
 * Remotion Studio — the Product Video SSR tab.
 *
 * FOUR STEPS: Product → Script → Style & sound → Generate.
 *
 *   1  Product        the structured brief, plus READ MY SITE: the full
 *                     page harvest (ps-brand-scrape) turned into a Brand
 *                     Object by Claude, which fills the form and hands back
 *                     the site's real colours, logo, screenshot, image
 *                     gallery and any video already embedded on the page.
 *                     The light og-tag fetch (pv-fetch-url) stays as the
 *                     on-blur fallback.
 *   2  Script         SIX script variants written from the brief, compared
 *                     side by side as storyboard columns. Optional — skip it
 *                     and the original brief-driven composition runs instead.
 *   3  Style & sound  tone, length, format, uploads, music, narration.
 *   4  Generate       ElevenLabs voiceover → Story Mode backdrop
 *                     (asset-image-gen) → server-side render
 *                     (pv-render-composition) → player + Download MP4.
 *
 * TWO COMPOSITIONS. With no script chosen it renders the original UI/Story
 * mode templates from remotionCompositions.ts. With a script chosen it renders
 * the scene-based composition from brandreel/composition.ts — the variant's
 * own scenes, durations and transition, with the scraped stills spread across
 * the scenes and an optional scraped clip behind the opener.
 *
 * The website reader, the script director and the scene composition are SHARED
 * with the Brand Reel tab (apps/ProductStudio/brandreel/). One implementation,
 * two front doors.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Clapperboard, Download, Film, Globe, Image as ImageIcon, Loader2, Play, Search, Sparkles, UploadCloud, X } from 'lucide-react';
import { LB, LB_SHIMMER_CSS } from '../../components/LightBeam';
import AgentStreak from '../../components/AgentStreak';
import {
  PV_FPS, PV_LENGTHS, PV_MUSIC_BEDS, PV_TONES, PvCompositionProps,
  STORY_MODE_TSX, UI_MODE_TSX,
} from './remotionCompositions';
import type { BrandObject, ScrapedVideo, ScriptVariant } from './brandreel/types';
import { brandTheme } from './brandreel/types';
import { buildBrandObject, scrapeBrand, writeScriptVariants } from './brandreel/api';
import { BRAND_REEL_TSX, buildReelProps } from './brandreel/composition';
import StoryboardColumns from './brandreel/StoryboardColumns';

const WORKSPACE_UUID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}
function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}
async function callHook(name: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/hooks/execute/${appId()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}) },
    body: JSON.stringify(payload),
  });
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  if (!res.ok) throw new Error(String(data?.error || `The ${name} service answered HTTP ${res.status}.`));
  return data || {};
}
async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('folder', 'remotion-studio');
  const res = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(String(data?.error || `Image upload failed (HTTP ${res.status}).`));
  return String(data.url);
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim());

// An in-flight (or finished) render survives tab switches AND full app
// close/reopen: the operation id / result URL persist in localStorage and the
// studio resumes polling on mount.
const RENDER_STORE_KEY = 'pv-remotion-render-v1';
function saveRenderState(state: Record<string, unknown> | null) {
  try {
    if (!state) window.localStorage.removeItem(RENDER_STORE_KEY);
    else window.localStorage.setItem(RENDER_STORE_KEY, JSON.stringify({ ...state, ts: Date.now() }));
  } catch { /* storage unavailable — the render still completes server-side */ }
}
function readRenderState(): { operationId?: string; renderUrl?: string; ts?: number } | null {
  try {
    const raw = window.localStorage.getItem(RENDER_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

interface ImageSlot { url: string; subject: string; colors: string[]; analyzing: boolean }
const emptySlot: ImageSlot = { url: '', subject: '', colors: [], analyzing: false };

type Step = 1 | 2 | 3 | 4;

const STEP_TRAIL: { n: Step; label: string }[] = [
  { n: 1, label: '1 · Product' },
  { n: 2, label: '2 · Script' },
  { n: 3, label: '3 · Style & sound' },
  { n: 4, label: '4 · Generate' },
];

const VIDEO_KIND_LABEL: Record<ScrapedVideo['kind'], string> = {
  file: 'On-page video',
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  linkedin: 'LinkedIn',
};

const RS_CSS = `
@keyframes rs-spin { to { transform: rotate(360deg); } }
.animate-spin { animation: rs-spin 1s linear infinite; }
@keyframes rs-bar { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
.rs-btn { transition: filter .15s ease, background .15s ease, opacity .15s ease; }
.rs-btn:hover:not(:disabled) { filter: brightness(1.12); }
.rs-btn:disabled { opacity: .55; cursor: default; }
.rs-input { transition: border-color .16s ease, box-shadow .16s ease; outline: none; }
.rs-input:focus { border-color: rgba(245,158,11,0.5) !important; box-shadow: 0 0 0 3px rgba(245,158,11,0.12); }
${LB_SHIMMER_CSS}
`;

const fieldLabel = { color: LB.textMuted, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' as const, display: 'block', margin: '16px 0 6px' };
const inputStyle = { width: '100%', background: LB.bgDeep, color: LB.textPrimary, border: LB.border, borderRadius: 8, padding: '10px 12px', fontSize: 13, boxSizing: 'border-box' as const };

function Pills<T extends string | number>(props: { options: readonly T[]; value: T; onChange: (v: T) => void; format?: (v: T) => string }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {props.options.map((o) => (
        <button key={String(o)} className="rs-btn" onClick={() => props.onChange(o)} style={{ background: props.value === o ? LB.accent : 'rgba(255,255,255,0.05)', color: props.value === o ? '#241503' : LB.textSecondary, border: props.value === o ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}>
          {props.format ? props.format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export default function RemotionStudio() {
  // ---- 3A: the structured brief ----
  const [productName, setProductName] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [tagline, setTagline] = useState('');
  const [featuresText, setFeaturesText] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState<(typeof PV_TONES)[number]>('Bold');
  const [lengthS, setLengthS] = useState<(typeof PV_LENGTHS)[number]>(30);
  const [mode, setMode] = useState<'ui' | 'story'>('ui');
  const [musicBedId, setMusicBedId] = useState<string>('inspiring');
  // Narration is OPT-IN — no voiceover is recorded unless the founder turns it on.
  const [voiceover, setVoiceover] = useState<'off' | 'on'>('off');
  // Step wizard — 1 Product · 2 Script · 3 Style & sound · 4 Generate.
  const [step, setStep] = useState<Step>(1);
  const [character, setCharacter] = useState<ImageSlot>(emptySlot);
  const [mockup, setMockup] = useState<ImageSlot>(emptySlot);
  const [ogImage, setOgImage] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);

  // ---- what the website reader found (step 1) ----
  const [brand, setBrand] = useState<BrandObject | null>(null);
  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [scrapedVideos, setScrapedVideos] = useState<ScrapedVideo[]>([]);
  const [chosenImages, setChosenImages] = useState<string[]>([]);
  const [useBrandColour, setUseBrandColour] = useState(true);

  // ---- the script variants (step 2) ----
  const [variants, setVariants] = useState<ScriptVariant[]>([]);
  const [variant, setVariant] = useState<ScriptVariant | null>(null);
  const [writing, setWriting] = useState(false);
  const [scriptError, setScriptError] = useState('');
  const [modelNote, setModelNote] = useState('');

  // ---- pipeline state ----
  const [phase, setPhase] = useState<'idle' | 'voiceover' | 'background' | 'render'>('idle');
  const [renderUrl, setRenderUrl] = useState('');
  const [renderNote, setRenderNote] = useState('');
  const [error, setError] = useState('');
  const aliveRef = useRef(true);
  // (unmount guard — set once; the tab is long-lived inside Product Studio)

  // RESUME — a render started earlier (even in a closed tab) picks back up:
  // a finished MP4 reappears instantly, an in-flight operation resumes polling.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const s = readRenderState();
    if (!s) return;
    if (s.renderUrl && Date.now() - (s.ts || 0) < 24 * 3600 * 1000) {
      setRenderUrl(String(s.renderUrl));
      setStep(4);
      return;
    }
    if (s.operationId && Date.now() - (s.ts || 0) < 30 * 60 * 1000) {
      setPhase('render');
      setStep(4);
      setRenderNote('Rendering with Remotion…');
      void (async () => {
        try {
          let out = await callHook('pv-render-composition', { operationId: s.operationId });
          while (aliveRef.current && out?.status === 'rendering' && out.operationId) {
            out = await callHook('pv-render-composition', { operationId: out.operationId });
          }
          if (out?.status === 'complete' && out.renderUrl) {
            setRenderUrl(String(out.renderUrl));
            saveRenderState({ renderUrl: String(out.renderUrl) });
          } else if (out?.status === 'failed') {
            setError(String(out.error || 'The render failed.'));
            saveRenderState(null);
          }
        } catch (e) {
          setError(msg(e));
        } finally {
          setPhase('idle');
          setRenderNote('');
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase !== 'idle';
  const features = featuresText.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 5);
  // The colour the site actually uses wins when we read one and the founder
  // left the toggle on; otherwise fall back to Gemini's palette, then amber.
  const brandAccent = brand && useBrandColour && isHex(brand.primaryColor) ? brand.primaryColor : '';
  const accent = brandAccent
    || (isHex(mockup.colors[0] || '') ? mockup.colors[0] : isHex(character.colors[0] || '') ? character.colors[0] : '#f59e0b');

  /** The typed brief expressed as a Brand Object, for when no site was read. */
  const briefAsBrand = useCallback((): BrandObject => ({
    url: productUrl.trim(),
    name: productName.trim() || 'Your product',
    tagline: tagline.trim(),
    features: featuresText.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 5),
    heroImageUrl: ogImage,
    logoUrl: '',
    primaryColor: accent,
    secondaryColor: '#0d1220',
    fontFamily: 'Inter',
    cta: `Try ${productName.trim() || 'it'} today`,
    scrapedVideos: [],
    screenshotUrl: ogImage,
    images: [],
    audience: audience.trim(),
    problem: '',
    toneOfVoice: tone,
  }), [productUrl, productName, tagline, featuresText, ogImage, accent, audience, tone]);

  const reelTheme = useMemo(
    () => brandTheme({ primaryColor: accent, secondaryColor: '#0d1220', fontFamily: 'Inter' }),
    [accent],
  );

  const toggleImage = useCallback((url: string) => {
    setChosenImages((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url].slice(0, 8)));
  }, []);

  // 3A — URL auto-fetch on blur
  const fetchUrl = useCallback(async () => {
    const url = productUrl.trim();
    if (!url || urlBusy) return;
    setUrlBusy(true);
    setError('');
    try {
      const out = await callHook('pv-fetch-url', { url });
      if (out.title && !productName.trim()) setProductName(String(out.title).split(/[|\u2014\u2013-]/)[0].trim().slice(0, 60));
      if (out.description && !tagline.trim()) setTagline(String(out.description).slice(0, 80));
      if (out.imageUrl) setOgImage(String(out.imageUrl));
      if (out.error) setError(String(out.error));
    } catch (e) {
      setError(msg(e));
    } finally {
      setUrlBusy(false);
    }
  }, [productUrl, urlBusy, productName, tagline]);

  // 3A+ — READ MY SITE: the full page harvest, not just the og tags. Gives us
  // the real copy, colours, logo, screenshot, image gallery and any video the
  // page already embeds. Degrades to the light og fetch rather than dead-ending.
  const readWebsite = useCallback(async () => {
    const url = productUrl.trim();
    if (!url || urlBusy) return;
    setUrlBusy(true);
    setError('');
    try {
      const scrape = await scrapeBrand(url);
      const { brand: built, answer } = await buildBrandObject(scrape);
      setBrand(built);
      setModelNote(answer.degradedFrom ? `${answer.degradedFrom} was unavailable, so ${answer.model} read your site.` : '');
      if (built.name) setProductName(built.name.slice(0, 60));
      if (built.tagline) setTagline(built.tagline.slice(0, 80));
      if (built.features.length) setFeaturesText(built.features.slice(0, 5).join('\n'));
      if (built.audience) setAudience(built.audience.slice(0, 80));
      const pool = [built.heroImageUrl, ...scrape.images.map((i) => i.url)].filter(Boolean);
      const unique = pool.filter((u, i) => pool.indexOf(u) === i).slice(0, 10);
      setScrapedImages(unique);
      setChosenImages(unique.slice(0, 4));
      setScrapedVideos(built.scrapedVideos);
      if (built.heroImageUrl) setOgImage(built.heroImageUrl);
      // Any scripts already on screen were written for the old brief.
      setVariants([]);
      setVariant(null);
    } catch (e) {
      try {
        const out = await callHook('pv-fetch-url', { url });
        if (out.title && !productName.trim()) setProductName(String(out.title).split(/[|\u2014\u2013-]/)[0].trim().slice(0, 60));
        if (out.description && !tagline.trim()) setTagline(String(out.description).slice(0, 80));
        if (out.imageUrl) setOgImage(String(out.imageUrl));
        setError(`I could only read the basics from that page — ${msg(e)}`);
      } catch {
        setError(msg(e));
      }
    } finally {
      setUrlBusy(false);
    }
  }, [productUrl, urlBusy, productName, tagline]);

  // 3A++ — six script variants for the same product, compared side by side.
  const writeScripts = useCallback(async () => {
    if (writing) return;
    setWriting(true);
    setScriptError('');
    try {
      const source = brand ? { ...brand, primaryColor: accent } : briefAsBrand();
      const { variants: written, answer } = await writeScriptVariants(source, mode === 'story' ? '9:16' : '16:9');
      setVariants(written);
      setModelNote(answer.degradedFrom ? `${answer.degradedFrom} was unavailable, so ${answer.model} wrote these scripts.` : '');
    } catch (e) {
      setScriptError(msg(e));
    } finally {
      setWriting(false);
    }
  }, [writing, brand, accent, briefAsBrand, mode]);

  // 3B — image upload + Gemini Vision analysis
  const handleImage = useCallback(async (file: File | null, which: 'character' | 'mockup') => {
    if (!file) return;
    const set = which === 'character' ? setCharacter : setMockup;
    setError('');
    set({ ...emptySlot, analyzing: true });
    try {
      const url = await uploadImage(file);
      set({ url, subject: '', colors: [], analyzing: true });
      try {
        const out = await callHook('pv-gemini-analyze', { imageUrl: url, wt: wsToken() });
        set({ url, subject: String(out.subject || ''), colors: Array.isArray(out.dominantColors) ? out.dominantColors.map(String) : [], analyzing: false });
      } catch (e) {
        // The upload still counts — analysis is a bonus.
        set({ url, subject: '', colors: [], analyzing: false });
        setError(`Gemini could not analyze the image: ${msg(e)}`);
      }
    } catch (e) {
      set({ ...emptySlot });
      setError(msg(e));
    }
  }, []);

  // 3C — the full generate-and-render pipeline
  const generate = useCallback(async () => {
    if (busy) return;
    const name = productName.trim();
    if (!name) { setError('Product Name is required.'); return; }
    setError('');
    setRenderUrl('');
    setStep(4);
    try {
      // 1. Voiceover — ONLY when the Narration toggle is on (opt-in).
      let voiceoverUrl = '';
      if (voiceover === 'on') {
        setPhase('voiceover');
        // A chosen script already says what the video says — narrate THAT,
        // not a second script assembled from the brief.
        const voScript = (variant
          ? variant.scenes.map((s) => s.voiceover)
          : [
              tagline.trim() || `Meet ${name}.`,
              ...features.slice(0, lengthS >= 30 ? 5 : 2),
              audience.trim() ? `Built for ${audience.trim()}.` : '',
              `Try ${name} today.`,
            ]
        ).filter(Boolean).join(' ');
        try {
          const token = wsToken();
          if (token) {
            const res = await fetch(`/api/workspaces/${WORKSPACE_UUID}/audio/voiceover`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
              body: JSON.stringify({ script: voScript.slice(0, 10000) }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.audioUrl) voiceoverUrl = String(data.audioUrl);
          }
        } catch { /* the video still renders without narration */ }
      }

      // 2. Story Mode backdrop — generated server-side (asset-image-gen hook).
      let backgroundUrl = '';
      if (mode === 'story') {
        setPhase('background');
        try {
          const brief = `Vertical 9:16 cinematic backdrop for a ${tone.toLowerCase()} product video about ${name}. ${mockup.subject || character.subject || tagline || ''}. Atmospheric, depth of field, rich lighting, no text, no lettering, no people in focus.`;
          const out = await callHook('asset-image-gen', { op: 'generate', prompt: brief, aspect: '9:16' });
          if (out?.imageUrl) backgroundUrl = String(out.imageUrl);
        } catch { /* gradient fallback lives in the composition */ }
      }

      // 3. Server-side Remotion render. A chosen script swaps the template:
      //    the scene-based composition renders the variant's own scenes,
      //    durations and transition instead of the fixed UI/Story layout.
      setPhase('render');
      setRenderNote('Rendering with Remotion…');
      const musicUrl = PV_MUSIC_BEDS.find((m) => m.id === musicBedId)?.url || '';
      let submission: Record<string, unknown>;

      if (variant) {
        const source = brand ? { ...brand, primaryColor: accent } : briefAsBrand();
        // The format pills live AFTER the script step, so the variant may have
        // been written for the other shape. The current choice wins.
        const shaped: ScriptVariant = {
          ...variant,
          composition: { ...variant.composition, aspect: mode === 'story' ? '9:16' : '16:9' },
        };
        // Spread the stills we read off the site across the scenes, leaving the
        // closing CTA scene clean.
        const images: Record<number, string> = {};
        const stills = chosenImages.length ? chosenImages : [mockup.url || ogImage].filter(Boolean);
        variant.scenes.forEach((s, i) => {
          if (i < variant.scenes.length - 1 && stills.length) images[s.sceneNumber] = stills[i % stills.length];
        });
        const reel = buildReelProps(
          { ...source, heroImageUrl: ogImage || source.heroImageUrl },
          shaped,
          [],
          { captionsEnabled: true, musicUrl, voiceoverUrl },
          { images },
        );
        submission = {
          compositionTsx: BRAND_REEL_TSX,
          props: reel.props,
          durationInFrames: reel.durationInFrames,
        };
      } else {
      const props: PvCompositionProps = {
        productName: name,
        tagline: tagline.trim(),
        features,
        audience: audience.trim(),
        tone,
        accent,
        bgFrom: '#080c14',
        bgTo: isHex(mockup.colors[1] || '') ? mockup.colors[1] : '#141b33',
        screenshotUrl: mockup.url || ogImage || '',
        characterUrl: character.url || '',
        backgroundUrl,
        voiceoverUrl,
        musicUrl,
        musicVolume: voiceoverUrl ? 0.18 : 0.3,
      };
        submission = {
          compositionTsx: mode === 'ui' ? UI_MODE_TSX : STORY_MODE_TSX,
          props,
          durationInFrames: lengthS * PV_FPS,
        };
      }

      // Short first budget so the operation id lands fast and is persisted —
      // from that moment the render survives tab switches and app reopens.
      let out = await callHook('pv-render-composition', {
        ...submission,
        fps: PV_FPS,
        width: 1920,
        height: 1080,
        budgetMs: 20000,
      });
      if (out?.operationId) saveRenderState({ operationId: String(out.operationId) });
      while (aliveRef.current && out?.status === 'rendering' && out.operationId) {
        out = await callHook('pv-render-composition', { operationId: out.operationId });
      }
      if (out?.status === 'complete' && out.renderUrl) {
        setRenderUrl(String(out.renderUrl));
        saveRenderState({ renderUrl: String(out.renderUrl) });
        setRenderNote('');
      } else {
        saveRenderState(null);
        throw new Error(String(out?.error || 'The render failed.'));
      }
    } catch (e) {
      setError(msg(e));
      setRenderNote('');
    } finally {
      setPhase('idle');
    }
  }, [busy, productName, tagline, features, audience, tone, lengthS, mode, musicBedId, voiceover, character, mockup, ogImage, accent, variant, brand, briefAsBrand, chosenImages]);

  const card = { background: LB.bgCard, border: LB.border, borderRadius: 16, padding: '18px 20px' } as const;

  // The agent's live progress trail — first-person, present-tense lines that
  // tick as each stage actually happens, not checkmarks after the fact.
  const trailOrder: ('voiceover' | 'background' | 'render')[] = [
    ...(voiceover === 'on' ? (['voiceover'] as const) : []),
    ...(mode === 'story' ? (['background'] as const) : []),
    'render',
  ];
  const TRAIL_COPY: Record<string, { todo: string; active: string; done: string }> = {
    voiceover: { todo: 'Record the ElevenLabs voiceover', active: 'Recording the voiceover now…', done: 'Voiceover recorded' },
    background: { todo: 'Film the 9:16 backdrop', active: 'Filming the 9:16 backdrop now…', done: 'Backdrop filmed' },
    render: { todo: 'Design & render the motion scenes', active: 'Designing the motion scenes and rendering frames now…', done: 'Render complete' },
  };
  const trailIdx = phase === 'idle' ? (renderUrl ? trailOrder.length : -1) : trailOrder.indexOf(phase as 'voiceover' | 'background' | 'render');

  const imageField = (label: string, slot: ImageSlot, which: 'character' | 'mockup', hint: string) => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <span style={fieldLabel}>{label} <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label className="rs-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: LB.textSecondary, borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {slot.analyzing ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} {slot.url ? 'Replace' : 'Upload'}
          <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => { void handleImage(e.target.files?.[0] || null, which); e.target.value = ''; }} />
        </label>
        {slot.url ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <img src={slot.url} alt="" style={{ width: 52, height: 36, objectFit: 'cover', borderRadius: 6, border: LB.border }} />
            <button className="rs-btn" onClick={() => (which === 'character' ? setCharacter(emptySlot) : setMockup(emptySlot))} style={{ background: 'none', border: 'none', color: LB.textMuted, cursor: 'pointer', padding: 2 }}><X size={13} /></button>
          </span>
        ) : (
          <span style={{ color: LB.textMuted, fontSize: 11 }}>{hint}</span>
        )}
      </div>
      {slot.subject ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: LB.accent, borderRadius: 999, padding: '3px 12px', fontSize: 11, fontWeight: 650 }}>
          <Sparkles size={11} /> Gemini analyzed: {slot.subject.slice(0, 60)}
        </div>
      ) : null}
      {slot.colors.length ? (
        <div style={{ display: 'flex', gap: 5, marginTop: 7, alignItems: 'center' }}>
          {slot.colors.slice(0, 5).map((cHex, i) => <span key={i} title={cHex} style={{ width: 16, height: 16, borderRadius: 5, background: cHex, border: '1px solid rgba(255,255,255,0.25)' }} />)}
          <span style={{ color: LB.textMuted, fontSize: 10.5, marginLeft: 4 }}>suggested palette</span>
        </div>
      ) : null}
    </div>
  );

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{RS_CSS}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <AgentStreak working={busy} size={26} />
        <div style={{ color: LB.textPrimary, fontSize: 19, fontWeight: 600 }}>Remotion Studio</div>
        <div style={{ color: LB.textMuted, fontSize: 12 }}>Paste your URL, pick a script, and I design and render the motion-design MP4</div>
      </div>

      {/* Step trail — visited steps stay clickable */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {STEP_TRAIL.map((sdef) => (
          <button
            key={sdef.n}
            className="rs-btn"
            disabled={busy || sdef.n > step}
            onClick={() => setStep(sdef.n)}
            style={{ background: step === sdef.n ? LB.accent : 'rgba(255,255,255,0.05)', color: step === sdef.n ? '#241503' : sdef.n < step ? LB.textPrimary : LB.textMuted, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '6px 14px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
          >
            {sdef.n < step ? '✓ ' : ''}{sdef.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 780 }}>
        <div style={card}>
          {step === 1 ? (
            <>
          <span style={fieldLabel}>Product name *</span>
          <input className="rs-input" style={inputStyle} value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. VidVerge" />

          <span style={fieldLabel}>Product URL <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(title &amp; description fill in on blur — hit Read my site for the rest)</span></span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
              <input className="rs-input" style={{ ...inputStyle, paddingRight: 36 }} value={productUrl} onChange={(e) => setProductUrl(e.target.value)} onBlur={() => void fetchUrl()} placeholder="https://yourproduct.com" />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: LB.textMuted }}>
                {urlBusy ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
              </span>
            </div>
            <button
              className="rs-btn"
              disabled={urlBusy || !productUrl.trim()}
              onClick={() => void readWebsite()}
              data-testid="button-read-website"
              title="Read the whole page — copy, colours, logo, screenshot, images and any video already on it"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flex: '0 0 auto' }}
            >
              {urlBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} {brand ? 'Read it again' : 'Read my site'}
            </button>
          </div>

          {brand ? (
            <div style={{ background: LB.bgDeep, border: LB.border, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                {brand.logoUrl ? (
                  <img src={brand.logoUrl} alt="" style={{ height: 20, width: 'auto', maxWidth: 84, objectFit: 'contain' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                ) : null}
                <span style={{ color: LB.textPrimary, fontSize: 12.5, fontWeight: 700 }}>Read from {brand.url.replace(/^https?:\/\//, '')}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: LB.textSecondary, fontSize: 11 }}>
                  <span style={{ width: 13, height: 13, borderRadius: 4, background: brand.primaryColor, border: '1px solid rgba(255,255,255,0.25)', display: 'inline-block' }} />
                  {brand.primaryColor}
                </span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: LB.textMuted, fontSize: 11.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={useBrandColour} onChange={(e) => setUseBrandColour(e.target.checked)} data-testid="toggle-use-brand-colour" />
                  Use their colour, not VidVerge amber
                </label>
              </div>

              {scrapedImages.length ? (
                <>
                  <div style={{ color: LB.textMuted, fontSize: 10, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase', margin: '12px 0 6px' }}>
                    <ImageIcon size={10} style={{ display: 'inline', verticalAlign: -1, marginRight: 5 }} />
                    Images from the page — tap the ones the scenes should use
                  </div>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {scrapedImages.map((u) => {
                      const on = chosenImages.includes(u);
                      return (
                        <button
                          key={u}
                          className="rs-btn"
                          onClick={() => toggleImage(u)}
                          style={{ position: 'relative', padding: 0, lineHeight: 0, background: 'none', cursor: 'pointer', borderRadius: 8, border: on ? `2px solid ${accent}` : '1px solid rgba(255,255,255,0.12)' }}
                        >
                          <img src={u} alt="" style={{ width: 74, height: 46, objectFit: 'cover', borderRadius: 6, opacity: on ? 1 : 0.5 }} onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                          {on ? (
                            <span style={{ position: 'absolute', top: 3, right: 3, width: 15, height: 15, borderRadius: 99, background: accent, color: '#241503', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Check size={9} />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {scrapedVideos.length ? (
                <>
                  <div style={{ color: LB.textMuted, fontSize: 10, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase', margin: '12px 0 6px' }}>
                    <Film size={10} style={{ display: 'inline', verticalAlign: -1, marginRight: 5 }} />
                    Video already on the page
                  </div>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {scrapedVideos.slice(0, 6).map((v) => (
                      <a
                        key={v.url}
                        href={v.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        data-testid="link-scraped-video"
                        title={v.url}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, padding: 6, maxWidth: 232 }}
                      >
                        <span style={{ width: 46, height: 30, borderRadius: 5, flexShrink: 0, background: v.thumbnail ? `center / cover no-repeat url(${JSON.stringify(v.thumbnail)})` : 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {v.thumbnail ? null : <Play size={12} color={LB.textMuted} />}
                        </span>
                        <span style={{ minWidth: 0, textAlign: 'left' }}>
                          <span style={{ display: 'block', color: LB.textSecondary, fontSize: 11.5, fontWeight: 700 }}>{VIDEO_KIND_LABEL[v.kind]}</span>
                          <span style={{ display: 'block', color: LB.textMuted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.url.replace(/^https?:\/\//, '').slice(0, 30)}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                  <div style={{ color: LB.textMuted, fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
                    Footage you already have, so you can see what is on the page and reuse it elsewhere. The Remotion
                    renderer cannot composite video in — it builds the film from stills and motion — so to cut with this
                    footage, bring it into the Video Enhancer tab instead.
                  </div>
                </>
              ) : null}
            </div>
          ) : ogImage ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <img src={ogImage} alt="" style={{ width: 84, height: 46, objectFit: 'cover', borderRadius: 6, border: LB.border }} />
              <span style={{ color: LB.textMuted, fontSize: 10.5 }}>og:image — used as the screen content when no mockup is uploaded</span>
            </div>
          ) : null}

          <span style={fieldLabel}>One-line tagline <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>({tagline.length}/80)</span></span>
          <input className="rs-input" style={inputStyle} value={tagline} maxLength={80} onChange={(e) => setTagline(e.target.value)} placeholder="Turn any idea into a publish-ready video" />

          <span style={fieldLabel}>Key features <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(one per line, max 5)</span></span>
          <textarea className="rs-input" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} rows={4} value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} placeholder={'AI script writing\nOne-click rendering\nBrand-ready exports'} />

          <span style={fieldLabel}>Target audience</span>
          <input className="rs-input" style={inputStyle} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. indie founders and marketers" />
              <button className="rs-btn" disabled={!productName.trim()} onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 11, padding: '12px 24px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                Continue → Script
              </button>
              <div style={{ color: LB.textMuted, fontSize: 10.5, marginTop: 8 }}>Next: six script options to choose between — then tone, length, images and sound, then I render.</div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              {!variants.length && !writing ? (
                <>
                  <span style={{ color: LB.textPrimary, fontSize: 14.5, fontWeight: 700, display: 'block' }}>Choose the script</span>
                  <div style={{ color: LB.textMuted, fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
                    I will write six genuinely different cuts of the same product — Pain → Solution, Demo-first, Social Proof,
                    Founder Story, Feature Walkthrough, Fast Cuts, Cinematic Reveal — each with its own scenes, timings and
                    voiceover lines. Pick one and the video follows it scene for scene. Skip and I write from your brief
                    into the fixed motion-design template instead.
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                    <button
                      className="rs-btn"
                      disabled={writing || !productName.trim()}
                      onClick={() => void writeScripts()}
                      data-testid="button-write-scripts"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 11, padding: '12px 22px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}
                    >
                      <Sparkles size={14} /> Write script options
                    </button>
                    <button
                      className="rs-btn"
                      onClick={() => { setVariant(null); setStep(3); }}
                      data-testid="button-skip-script"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: LB.textSecondary, borderRadius: 11, padding: '12px 20px', fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
                    >
                      Skip — write from my brief
                    </button>
                  </div>
                  {scriptError ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#f87171', fontSize: 12, lineHeight: 1.5, marginTop: 14, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 9, padding: '9px 13px' }}>
                      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{scriptError}</span>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <StoryboardColumns
                    theme={reelTheme}
                    variants={variants}
                    selectedId={variant?.id || ''}
                    writing={writing}
                    error={scriptError}
                    modelNote={modelNote}
                    title="Pick the script this video follows"
                    subtitle={`${variants.length || 'Six'} cuts of ${productName.trim() || 'your product'}. Scroll sideways to compare — the scenes, timings and transitions of the one you pick become the video.`}
                    backLabel="← Product"
                    onSelect={(v) => { setVariant(v); setStep(3); }}
                    onRegenerate={() => void writeScripts()}
                    onBack={() => setStep(1)}
                  />
                  {!writing ? (
                    <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        className="rs-btn"
                        onClick={() => { setVariant(null); setStep(3); }}
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: LB.textSecondary, borderRadius: 11, padding: '10px 18px', fontSize: 12.5, fontWeight: 650, cursor: 'pointer' }}
                      >
                        None of these — write from my brief
                      </button>
                      {variant ? (
                        <button
                          className="rs-btn"
                          onClick={() => setStep(3)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 11, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                        >
                          Continue → Style & sound
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          {step === 3 ? (
            <>
          {variant ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '9px 12px', marginBottom: 4 }}>
              <Check size={13} color={accent} />
              <span style={{ color: LB.textSecondary, fontSize: 12 }}>
                Script locked: <strong style={{ color: LB.textPrimary }}>{variant.styleLabel}</strong> · {variant.scenes.length} scenes · {variant.totalSeconds}s.
                Its own scene timings drive the length, so the Video length pills below only apply if you drop the script.
              </span>
              <button className="rs-btn" onClick={() => setStep(2)} style={{ background: 'none', border: 'none', color: LB.textMuted, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>change</button>
            </div>
          ) : null}

          <span style={fieldLabel}>Tone</span>
          <Pills options={PV_TONES} value={tone} onChange={setTone} />

          <span style={fieldLabel}>Video length</span>
          <Pills options={PV_LENGTHS} value={lengthS} onChange={setLengthS} format={(v) => `${v}s`} />

          <span style={fieldLabel}>Video style</span>
          <Pills options={['ui', 'story'] as const} value={mode} onChange={setMode} format={(v) => (v === 'ui' ? 'UI Mode (16:9)' : 'Story Mode (9:16)')} />

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {imageField('Character photo', character, 'character', 'Story Mode: enters from the bottom')}
            {imageField('Product mockup', mockup, 'mockup', 'Shown in the browser frame / floating card')}
          </div>

          <span style={fieldLabel}>Background music</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PV_MUSIC_BEDS.map((m) => (
              <button key={m.id} className="rs-btn" onClick={() => setMusicBedId(m.id)} style={{ background: musicBedId === m.id ? LB.accent : 'rgba(255,255,255,0.05)', color: musicBedId === m.id ? '#241503' : LB.textSecondary, border: musicBedId === m.id ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}>{m.label}</button>
            ))}
            <button className="rs-btn" onClick={() => setMusicBedId('none')} style={{ background: musicBedId === 'none' ? LB.accent : 'rgba(255,255,255,0.05)', color: musicBedId === 'none' ? '#241503' : LB.textSecondary, border: musicBedId === 'none' ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}>None</button>
          </div>

          <span style={fieldLabel}>Narration (ElevenLabs) <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>— off by default, nothing is recorded unless you turn it on</span></span>
          <Pills options={['off', 'on'] as const} value={voiceover} onChange={setVoiceover} format={(v) => (v === 'on' ? 'Voiceover on' : 'No narration')} />
              <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
                <button className="rs-btn" onClick={() => setStep(2)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: LB.textSecondary, borderRadius: 11, padding: '12px 20px', fontSize: 13, fontWeight: 650, cursor: 'pointer' }}>← Back</button>
                <button className="rs-btn" onClick={() => setStep(4)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 11, padding: '12px 24px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Continue → Generate</button>
              </div>
            </>
          ) : null}

          {error ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#f87171', fontSize: 12, lineHeight: 1.5, marginTop: 14, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 9, padding: '9px 13px' }}>
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{error}</span>
            </div>
          ) : null}

          {step === 4 ? (
            <>
              {/* Brief summary — what the agent is about to work from */}
              <div style={{ color: LB.textSecondary, fontSize: 12.5, lineHeight: 1.7, marginTop: 12 }}>
                <span style={{ color: LB.textPrimary, fontWeight: 700 }}>{productName || 'Your product'}</span> ·{' '}
                {variant ? `${variant.styleLabel} · ${variant.scenes.length} scenes · ${variant.totalSeconds}s` : `brief-driven · ${lengthS}s`} ·{' '}
                {mode === 'ui' ? 'UI Mode 16:9' : 'Story Mode 9:16'} · {tone}{features.length ? ` · ${features.length} feature${features.length > 1 ? 's' : ''}` : ''} · music: {musicBedId} · narration: {voiceover}
                <button className="rs-btn" disabled={busy} onClick={() => setStep(1)} style={{ marginLeft: 10, background: 'none', border: 'none', color: LB.textMuted, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>edit brief</button>
              </div>
              {variant ? (
                <div style={{ color: LB.textMuted, fontSize: 11.5, lineHeight: 1.6, marginTop: 6 }}>
                  Rendering scene by scene from your chosen script{chosenImages.length ? `, using ${chosenImages.length} image${chosenImages.length > 1 ? 's' : ''} read off your site` : ''}{brand && useBrandColour ? `, in ${brand.primaryColor}` : ''}.
                </div>
              ) : null}

              <button
                className="rs-btn"
                disabled={busy || !productName.trim()}
                onClick={() => void generate()}
                style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, background: LB.accentGradient, color: '#241503', border: 'none', borderRadius: 11, padding: '13px 26px', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 14px rgba(245,158,11,0.3)' }}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
                {busy ? 'Working…' : renderUrl ? 'Generate again' : 'Generate video'}
              </button>
              <div style={{ color: LB.textMuted, fontSize: 10.5, marginTop: 8 }}>What happens next: I render everything on the server — you can switch tabs or close the app and I keep going; the MP4 lands right below.</div>

              {/* The agent's ticking progress trail */}
              <div style={{ background: LB.bgDeep, border: LB.border, borderRadius: 12, padding: '12px 14px', marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <AgentStreak working={busy} size={16} />
                  <span style={{ color: LB.textMuted, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{busy ? 'Working' : renderUrl ? 'Done' : 'Ready when you are'}</span>
                </div>
                {trailOrder.map((k, i) => {
                  const state = i < trailIdx ? 'done' : i === trailIdx && phase !== 'idle' ? 'active' : trailIdx >= trailOrder.length ? 'done' : 'todo';
                  const copyDef = TRAIL_COPY[k];
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                      {state === 'active' ? <Loader2 size={12} color={LB.accent} className="animate-spin" /> : <span style={{ width: 7, height: 7, borderRadius: 99, background: state === 'done' ? '#4ade80' : 'rgba(255,255,255,0.2)', display: 'inline-block', flexShrink: 0 }} />}
                      <span style={{ color: state === 'active' ? LB.accent : state === 'done' ? LB.textSecondary : LB.textMuted, fontSize: 12 }}>{state === 'active' ? copyDef.active : state === 'done' ? copyDef.done : copyDef.todo}</span>
                    </div>
                  );
                })}
              </div>

              {/* Result */}
              <div style={{ marginTop: 16 }}>
                {phase === 'render' || renderNote ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '30px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 46 }}>
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <span key={i} style={{ width: 7, height: 46, borderRadius: 4, background: LB.accent, transformOrigin: 'bottom', animation: `rs-bar 1s ease-in-out ${i * 0.12}s infinite` }} />
                      ))}
                    </div>
                    <div style={{ color: LB.textSecondary, fontSize: 12.5 }}>Rendering with Remotion… (server-side, 1080p 30fps — usually 1–4 minutes)</div>
                  </div>
                ) : busy ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0' }}>
                    <div className="lb-shimmer" style={{ width: '100%', height: 160, borderRadius: 12 }} />
                    <div className="lb-shimmer" style={{ width: 220, height: 12 }} />
                  </div>
                ) : renderUrl ? (
                  <div>
                    <video src={renderUrl} controls style={{ width: '100%', borderRadius: 12, background: '#000', border: LB.border }} />
                    <a className="rs-btn" href={renderUrl} download target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, background: LB.accent, color: '#241503', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                      <Download size={14} /> Download MP4
                    </a>
                    {mode === 'story' ? <div style={{ color: LB.textMuted, fontSize: 10.5, marginTop: 8 }}>Story Mode renders a centered 9:16 stage inside the platform's fixed 1920×1080 canvas — crop to 9:16 in the Video Enhancer if you need a pure vertical file.</div> : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
