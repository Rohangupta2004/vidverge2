import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Palette,
  RefreshCw,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  DEFAULT_MOTION_TEMPLATE,
  MotionStylePicker,
  presentationTemplateByLabel,
  type MotionTemplate,
  type PresentationTemplateDefinition,
} from './MotionTemplates';

type GenerationPhase = 'idle' | 'analyzing' | 'writing' | 'rendering' | 'done' | 'error';
type BrandMood =
  | 'bold/energetic'
  | 'premium/minimal'
  | 'professional/corporate'
  | 'playful/bright';

interface VisionImage {
  index: number;
  description: string;
  suggestedRole: string;
}

interface VisionResult {
  palette: string[];
  mood: BrandMood;
  images: VisionImage[];
  textEffect: string;
}

interface ProductAsset {
  id: string;
  file: File;
  objectUrl: string;
  label: string;
}

interface ProductMotionEmbedProps {
  compact?: boolean;
}

const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
const MAX_IMAGES = 5;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ACCENT = 'var(--space-brand-primary-500, #6366f1)';
const ACCENT_DARK = 'var(--space-brand-primary-600, #4f46e5)';
const MOODS: BrandMood[] = [
  'bold/energetic',
  'premium/minimal',
  'professional/corporate',
  'playful/bright',
];

const APP_CSS = `
@keyframes pm-pulse { 0%,100% { opacity:.45; transform:scale(.92) } 50% { opacity:1; transform:scale(1) } }
@keyframes pm-slide { 0% { transform:translateX(-110%) } 100% { transform:translateX(320%) } }
@keyframes pm-blink { 0%,45% { opacity:1 } 46%,100% { opacity:0 } }
@keyframes pm-rise { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
.pm-rise { animation:pm-rise .42s cubic-bezier(.16,1,.3,1) both }
.pm-dot { animation:pm-pulse 1.2s ease-in-out infinite }
.pm-cursor { animation:pm-blink .8s steps(1) infinite }
.pm-sheen::after { content:''; position:absolute; inset:0 auto 0 0; width:34%; background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent); animation:pm-slide 1.8s linear infinite }
.pm-button { transition:transform .18s ease, filter .18s ease, box-shadow .18s ease }
.pm-button:hover:not(:disabled) { transform:translateY(-1px); filter:brightness(1.08); box-shadow:0 16px 44px -18px rgba(99,102,241,.9) }
.pm-button:active:not(:disabled) { transform:scale(.985) }
.pm-drop { transition:border-color .2s ease, background .2s ease, transform .2s ease }
.pm-drop:hover { border-color:rgba(129,140,248,.7); background:rgba(99,102,241,.08) }
.pm-focus:focus-visible { outline:2px solid #818cf8; outline-offset:3px }
@media (prefers-reduced-motion:reduce) { .pm-rise,.pm-dot,.pm-cursor,.pm-sheen::after { animation:none !important } .pm-button:hover:not(:disabled) { transform:none } }
`;

function uid(): string {
  return `pm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) {
    throw new Error('Your workspace session is still loading. Wait a moment, then try again.');
  }
  return String(token);
}

async function waitForWorkspaceToken(timeoutMs = 12000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let token = (window as any).__workspaceDb?.token;
  while (!token && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    token = (window as any).__workspaceDb?.token;
  }
  if (!token) {
    throw new Error('Your workspace session is still loading. Wait a moment, then try again.');
  }
  return String(token);
}

function activeWorkspaceId(): string {
  return String((window as any).__workspaceDb?.workspaceId || (window as any).__WORKSPACE_ID__ || WORKSPACE_ID);
}

function apiError(body: any, fallback: string): string {
  const value = body?.error?.message || body?.error || body?.message || body?.errorMessage;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function inferLabel(file: File, index: number): string {
  const name = file.name.toLowerCase();
  if (/screen|dashboard|app|ui|mobile|desktop|site|web/.test(name)) return `App Screen ${index + 1}`;
  if (/feature|detail|callout/.test(name)) return `Feature Shot ${index + 1}`;
  return `Product Shot ${index + 1}`;
}

function roleLabel(role: string, index: number): string {
  const normalized = role.toLowerCase();
  if (/screen|dashboard|interface|app|ui|website/.test(normalized)) return `App Screen ${index + 1}`;
  if (/feature|detail|callout/.test(normalized)) return `Feature Shot ${index + 1}`;
  if (/logo|brand/.test(normalized)) return `Brand Asset ${index + 1}`;
  return `Product Shot ${index + 1}`;
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}.`));
    };
    image.src = url;
  });
}

async function makeVisionImage(file: File): Promise<{ mediaType: 'image/jpeg'; data: string }> {
  const image = await readImage(file);
  let maxSide = 1050;
  let quality = 0.78;
  let dataUrl = '';

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare images for analysis.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length < 46_000) break;
    maxSide = Math.round(maxSide * 0.78);
    quality = Math.max(0.46, quality - 0.08);
  }

  const data = dataUrl.split(',')[1];
  if (!data) throw new Error(`Could not prepare ${file.name} for analysis.`);
  return { mediaType: 'image/jpeg', data };
}

function extractJson(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Vision analysis returned an unreadable result.');
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeVision(value: any, count: number): VisionResult {
  const mood = MOODS.includes(value?.mood) ? value.mood : 'professional/corporate';
  const fallbackEffect: Record<BrandMood, string> = {
    'bold/energetic': 'kinetic punch text',
    'premium/minimal': 'mask reveal',
    'professional/corporate': 'stagger-type',
    'playful/bright': 'spring bounce',
  };
  const palette = Array.isArray(value?.palette)
    ? value.palette.filter((color: unknown) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)).slice(0, 5)
    : [];
  while (palette.length < 3) {
    palette.push(['#0a0a0a', '#6366f1', '#f8fafc'][palette.length]);
  }
  const rawImages = Array.isArray(value?.images) ? value.images : [];
  const images = Array.from({ length: count }, (_, index) => {
    const item = rawImages.find((candidate: any) => Number(candidate?.index) === index) || rawImages[index] || {};
    return {
      index,
      description: typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : `Product image ${index + 1}`,
      suggestedRole: typeof item.suggestedRole === 'string' && item.suggestedRole.trim()
        ? item.suggestedRole.trim()
        : 'product hero shot',
    };
  });
  return {
    palette,
    mood,
    images,
    textEffect: typeof value?.textEffect === 'string' && value.textEffect.trim()
      ? value.textEffect.trim()
      : fallbackEffect[mood],
  };
}

async function analyzeImages(assets: ProductAsset[]): Promise<VisionResult> {
  const token = workspaceToken();
  const prepared = await Promise.all(assets.map((asset) => makeVisionImage(asset.file)));
  const analyses = await Promise.all(prepared.map(async (image, index) => {
    try {
      const response = await fetch('/api/generate/vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-DB-Token': token,
        },
        body: JSON.stringify({
          prompt: `Analyze product image ${index + 1} of ${assets.length}. Return ONLY JSON with exactly this shape: {"palette":["#RRGGBB"],"mood":"bold/energetic | premium/minimal | professional/corporate | playful/bright","description":"what the image visibly shows","suggestedRole":"product hero shot | app screenshot | feature callout | brand asset"}. Use 2-4 dominant hex colors. Analyze only what is visible and never invent product claims.`,
          image: image.data,
          mimeType: image.mediaType,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success || typeof body.result !== 'string') {
        throw new Error(body?.error || `Image analysis failed (${response.status}).`);
      }
      return { ok: true, value: extractJson(body.result) };
    } catch (error) {
      console.warn(`[Product Motion] Image ${index + 1} analysis failed:`, error);
      return { ok: false, value: null };
    }
  }));

  const successful = analyses.filter((entry) => entry.ok && entry.value);
  if (successful.length === 0) {
    throw new Error('The product images could not be analyzed. Please try again.');
  }

  const moods = successful.map((entry) => String(entry.value?.mood || '')).filter(Boolean);
  const mood = moods.sort((a, b) => moods.filter((item) => item === b).length - moods.filter((item) => item === a).length)[0];
  const palette = Array.from(new Set(successful.flatMap((entry) => Array.isArray(entry.value?.palette) ? entry.value.palette : []))).slice(0, 5);
  return normalizeVision({
    palette,
    mood,
    images: analyses.map((entry, index) => ({
      index,
      description: entry.value?.description || `Product image ${index + 1}`,
      suggestedRole: entry.value?.suggestedRole || 'product hero shot',
    })),
  }, assets.length);
}

async function uploadProductImage(asset: ProductAsset): Promise<{ filename: string; url: string }> {
  const token = workspaceToken();
  const form = new FormData();
  form.append('file', asset.file, asset.file.name);
  form.append('workspaceId', activeWorkspaceId());
  form.append('folder', 'product-motion');
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': token },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.url) {
    throw new Error(body?.error || `Could not upload ${asset.file.name}.`);
  }
  return { filename: asset.file.name, url: String(body.url) };
}

function cleanTsx(raw: string): string {
  return raw.trim().replace(/^```(?:tsx|typescript|jsx)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function validateComposition(code: string): void {
  if (code.length < 600) throw new Error('The generated composition was incomplete.');
  if (!/export\s+default\b/.test(code)) {
    throw new Error('The generated composition is missing a default export.');
  }
  if (!/\breturn\b/.test(code)) {
    throw new Error('The generated composition is missing its render return.');
  }
  const required = ['useCurrentFrame', 'useVideoConfig', 'interpolate', 'spring', 'Sequence', 'AbsoluteFill'];
  const missing = required.filter((name) => !new RegExp(`\\b${name}\\b`).test(code));
  if (missing.length > 0) throw new Error(`The generated composition is missing ${missing.join(', ')}.`);
  const imports = Array.from(code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)).map((match) => match[1]);
  if (imports.some((source) => source !== 'remotion')) {
    throw new Error('The generated composition tried to import an unsupported library.');
  }
  if (!/\bstaticFile\s*\(/.test(code)) {
    throw new Error('The generated composition did not include staticFile image resolution.');
  }
}

async function writeComposition(
  vision: VisionResult,
  images: Array<{ filename: string; url: string }>,
  durationInFrames: number,
  presentationTemplate: PresentationTemplateDefinition,
): Promise<string> {
  const token = workspaceToken();
  const system = `You are an expert Remotion creative coder. Write a COMPLETE, VALID, bespoke Remotion TSX composition from scratch for the supplied product-image analysis. This is never a fill-in-the-blank template: invent the layout, pacing, transitions, typography, and visual rhythm for this exact image set.

Hard requirements:
- Return ONLY TSX source. No markdown fences and no explanation.
- Import only from 'remotion'. Import and use useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill, Img, and staticFile.
- Default-export one composition component accepting props shaped as { images: Array<{ filename: string; url: string }>; palette: string[]; mood: string; textEffect: string }.
- Resolve every image with a helper that prefers its durable URL but explicitly falls back to staticFile(asset.filename), for example asset.url || staticFile(asset.filename). The public URL is necessary for server rendering; the staticFile filename fallback preserves normal Remotion asset behavior.
- Use every supplied image at least once. Use Img, never a CSS background URL.
- Follow this selected presentation template throughout: ${presentationTemplate.label}. ${presentationTemplate.generationPrompt}
- Implement the detected text effect. Kinetic punch text should use sharply timed scale/position interpolation; mask reveal should use clipPath or overflow masks; stagger-type should reveal characters or words in sequence; spring bounce should visibly use spring().
- Give hero product shots a slow Ken Burns zoom/pan.
- Give app screenshots a convincing CSS 3D tilt with perspective plus rotateX and rotateY.
- Use staggered spring entrances whenever multiple images share a layout.
- The composition is exactly ${durationInFrames} frames at 30fps, 1920x1080. Export const calculateDemoVideoDuration = () => ${durationInFrames}.
- Keep all animation deterministic and frame-driven. Do not fetch, use timers, access window/document, or use Math.random.
- Use only claims visible in the analysis. Favor short editorial text such as mood-appropriate verbs or image descriptions over invented product promises.
- Avoid tiny type, image distortion, dead frames, and content outside safe margins.`;

  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': token,
    },
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Create the composition for this vision direction:\n${JSON.stringify(vision, null, 2)}\n\nSelected presentation template: ${presentationTemplate.label}\nTemplate direction: ${presentationTemplate.generationPrompt}\n\nAvailable image props, in order:\n${JSON.stringify(images, null, 2)}`,
        },
      ],
      stream: false,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.error || `Composition generation failed (${response.status}).`);
  }
  const code = cleanTsx(String(body?.choices?.[0]?.message?.content || ''));
  validateComposition(code);
  return code;
}

async function renderComposition(
  compositionTsx: string,
  images: Array<{ filename: string; url: string }>,
  vision: VisionResult,
  durationInFrames: number,
): Promise<string> {
  const token = workspaceToken();
  const submit = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': token,
    },
    body: JSON.stringify({
      workspaceId: activeWorkspaceId(),
      compositionTsx,
      props: {
        images,
        palette: vision.palette,
        mood: vision.mood,
        textEffect: vision.textEffect,
      },
      durationInFrames,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
  });
  const submitted = await submit.json().catch(() => null);
  const operationId = String(submitted?.operationId || '');
  if (submit.status === 402) {
    throw new Error('Your workspace wallet needs funds before this motion video can be rendered.');
  }
  if (!submit.ok || submitted?.success === false || !operationId) {
    throw new Error(apiError(submitted, `The render could not be started (${submit.status}).`));
  }

  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    const response = await fetch(`/api/render/remotion/${encodeURIComponent(operationId)}`, {
      headers: { 'X-Workspace-DB-Token': token },
    });
    const status = await response.json().catch(() => null);
    if (!response.ok || status?.success === false) {
      throw new Error(apiError(status, `Could not check the render status (${response.status}).`));
    }
    const state = String(status?.status || '').toLowerCase();
    const resultUrl = status?.videoUrl || status?.downloadUrl || status?.video_url || status?.download_url;
    if ((state === 'complete' || state === 'completed') && resultUrl) return String(resultUrl);
    if (state === 'failed' || state === 'error') {
      throw new Error(apiError(status, 'The Remotion render failed.'));
    }
    if (!state) throw new Error('The render service returned an unreadable status. Please try again.');
  }
  throw new Error('The render is taking longer than expected. Try again to start a fresh render.');
}

async function logRender(input: {
  filenames: string[];
  vision: VisionResult;
  code: string;
  renderUrl: string | null;
  status: 'complete' | 'failed';
}): Promise<void> {
  const db = (window as any).__workspaceDb;
  if (!db) return;
  await db.from('product_motion_renders').insert({
    image_filenames: input.filenames,
    mood: input.vision.mood,
    text_effect: input.vision.textEffect,
    composition_code: input.code,
    render_url: input.renderUrl,
    status: input.status,
  });
}

async function addRemotionToVideoJobs(input: {
  title: string;
  renderUrl: string;
  durationInFrames: number;
  filenames: string[];
  vision: VisionResult;
  presentationTemplate: string;
}): Promise<void> {
  const db = (window as any).__workspaceDb;
  if (!db) throw new Error('The video library session is still loading.');
  await db.from('video_jobs').insert({
    job_id: `remotion:${Date.now()}`,
    title: input.title,
    status: 'completed',
    video_url: input.renderUrl,
    delivery_url: input.renderUrl,
    source: 'remotion',
    phase_mode: false,
    model_used: 'remotion',
    tone: `${input.vision.mood} · ${input.presentationTemplate}`,
    duration_seconds: Math.round(input.durationInFrames / 30),
    scene_count: input.filenames.length,
    aspect_ratio: '16:9',
    script_json: {
      mode: 'remotion',
      filenames: input.filenames,
      textEffect: input.vision.textEffect,
      presentationTemplate: input.presentationTemplate,
    },
  });
}

function ProgressSteps({ phase }: { phase: GenerationPhase }) {
  const steps = [
    { key: 'analyzing', label: 'Analyzing your images…', note: 'Vision layer' },
    { key: 'writing', label: 'Writing your composition…', note: 'Custom TSX' },
    { key: 'rendering', label: 'Rendering…', note: 'Polishing every frame' },
  ] as const;
  const order: GenerationPhase[] = ['analyzing', 'writing', 'rendering', 'done'];
  const current = order.indexOf(phase);
  return (
    <div style={{ display: 'grid', gap: 12 }} role="status" aria-live="polite">
      {steps.map((step, index) => {
        const active = step.key === phase;
        const complete = current > index;
        return (
          <div
            key={step.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 13,
              padding: '14px 16px',
              borderRadius: 14,
              border: `1px solid ${active ? 'rgba(99,102,241,.55)' : 'rgba(255,255,255,.08)'}`,
              background: active ? 'rgba(99,102,241,.10)' : 'rgba(255,255,255,.025)',
              opacity: active || complete ? 1 : 0.5,
            }}
          >
            <span
              className={active ? 'pm-dot' : undefined}
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 30,
                height: 30,
                flexShrink: 0,
                borderRadius: 999,
                color: complete || active ? '#fff' : '#71717a',
                background: complete ? '#22c55e' : active ? ACCENT : 'rgba(255,255,255,.07)',
              }}
            >
              {complete ? <Check size={15} /> : active ? <Loader2 size={15} /> : index + 1}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: 14, color: active ? '#fff' : '#d4d4d8' }}>
                {step.label}{active && step.key === 'writing' ? <span className="pm-cursor">▋</span> : null}
              </strong>
              <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: '#71717a' }}>{step.note}</span>
            </span>
          </div>
        );
      })}
      <div className="pm-sheen" style={{ position: 'relative', height: 4, overflow: 'hidden', borderRadius: 999, background: 'rgba(255,255,255,.06)' }}>
        <div style={{ width: `${Math.max(12, (Math.max(0, current) + 1) * 33.333)}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${ACCENT_DARK}, #818cf8)` }} />
      </div>
    </div>
  );
}

function VisionCard({ vision }: { vision: VisionResult }) {
  return (
    <div
      className="pm-rise"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        flexWrap: 'wrap',
        padding: '15px 17px',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,.08)',
        background: 'rgba(255,255,255,.035)',
      }}
    >
      <div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '.09em' }}>
          <Sparkles size={12} /> Direction detected
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7, flexWrap: 'wrap' }}>
          <span style={{ padding: '5px 9px', borderRadius: 999, background: 'rgba(99,102,241,.15)', color: '#c7d2fe', fontSize: 12, fontWeight: 700 }}>
            {vision.mood}
          </span>
          <span style={{ fontSize: 12, color: '#a1a1aa' }}>{vision.textEffect}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label={`Palette: ${vision.palette.join(', ')}`}>
        <Palette size={15} color="#71717a" />
        {vision.palette.map((color) => (
          <span key={color} title={color} style={{ width: 24, height: 24, borderRadius: 8, background: color, border: '1px solid rgba(255,255,255,.16)', boxShadow: '0 5px 16px rgba(0,0,0,.35)' }} />
        ))}
      </div>
    </div>
  );
}

export function ProductMotionEmbed({ compact = false }: ProductMotionEmbedProps) {
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<GenerationPhase>('idle');
  const [vision, setVision] = useState<VisionResult | null>(null);
  const [compositionCode, setCompositionCode] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [logWarning, setLogWarning] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [motionTemplate, setMotionTemplate] = useState<MotionTemplate>(DEFAULT_MOTION_TEMPLATE);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const objectUrls = useRef<Set<string>>(new Set());

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
  }, []);

  const addFiles = (files: File[]) => {
    setError('');
    const room = MAX_IMAGES - assets.length;
    const accepted = files.filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, room));
    const tooLarge = accepted.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setError(`${tooLarge.name} is larger than 12 MB. Choose a smaller image.`);
      return;
    }
    if (accepted.length === 0) {
      setError(assets.length >= MAX_IMAGES ? `You can use up to ${MAX_IMAGES} images.` : 'Choose PNG, JPG, WebP, or GIF images.');
      return;
    }
    const next = accepted.map((file, index) => {
      const objectUrl = URL.createObjectURL(file);
      objectUrls.current.add(objectUrl);
      return {
        id: uid(),
        file,
        objectUrl,
        label: inferLabel(file, assets.length + index),
      };
    });
    setAssets((current) => [...current, ...next]);
    setVision(null);
    setVideoUrl('');
    setCompositionCode('');
    setPhase('idle');
  };

  const removeAsset = (id: string) => {
    if (phase !== 'idle' && phase !== 'error') return;
    setAssets((current) => {
      const removed = current.find((asset) => asset.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.objectUrl);
        objectUrls.current.delete(removed.objectUrl);
      }
      return current.filter((asset) => asset.id !== id);
    });
    setVision(null);
    setVideoUrl('');
    setCompositionCode('');
  };

  const generate = async () => {
    if (assets.length === 0 || ['analyzing', 'writing', 'rendering'].includes(phase)) return;
    setError('');
    setLogWarning('');
    setVideoUrl('');
    setPhase('analyzing');
    let analyzed: VisionResult | null = null;
    let code = '';
    const selectedTemplate = presentationTemplateByLabel(motionTemplate);
    try {
      // The workspace token arrives asynchronously on a cold load. Waiting here
      // prevents the first click from failing before either AI request starts.
      await waitForWorkspaceToken();
      analyzed = await analyzeImages(assets);
      setVision(analyzed);
      setAssets((current) => current.map((asset, index) => ({
        ...asset,
        label: roleLabel(analyzed!.images[index]?.suggestedRole || '', index),
      })));

      const uploaded = await Promise.all(assets.map(uploadProductImage));
      const durationInFrames = Math.min(300, Math.max(150, 165 + assets.length * 24));
      setPhase('writing');
      code = await writeComposition(analyzed, uploaded, durationInFrames, selectedTemplate);
      setCompositionCode(code);

      setPhase('rendering');
      const renderedUrl = await renderComposition(code, uploaded, analyzed, durationInFrames);
      setVideoUrl(renderedUrl);
      setPhase('done');
      try {
        const filenames = assets.map((asset) => asset.file.name);
        await Promise.all([
          logRender({
            filenames,
            vision: analyzed,
            code,
            renderUrl: renderedUrl,
            status: 'complete',
          }),
          addRemotionToVideoJobs({
            title: `${filenames[0]?.replace(/\.[^.]+$/, '') || 'Product'} · Remotion`,
            renderUrl: renderedUrl,
            durationInFrames,
            filenames,
            vision: analyzed,
            presentationTemplate: selectedTemplate.label,
          }),
        ]);
      } catch {
        setLogWarning('The video is ready, but its My Videos entry could not be saved.');
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Remotion could not finish this video.';
      setError(message);
      setPhase('error');
      if (analyzed && code) {
        try {
          await logRender({
            filenames: assets.map((asset) => asset.file.name),
            vision: analyzed,
            code,
            renderUrl: null,
            status: 'failed',
          });
        } catch {
          // The actionable generation error remains the primary message.
        }
      }
    }
  };

  const downloadVideo = async () => {
    if (!videoUrl || downloading) return;
    setDownloading(true);
    setError('');
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'product-motion.mp4';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      // Cross-origin storage may refuse a blob fetch even though the permanent
      // media URL is valid. A normal anchor still gives the user the file.
      const link = document.createElement('a');
      link.href = videoUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setDownloading(false);
    }
  };

  const reset = () => {
    assets.forEach((asset) => URL.revokeObjectURL(asset.objectUrl));
    objectUrls.current.clear();
    setAssets([]);
    setVision(null);
    setCompositionCode('');
    setVideoUrl('');
    setError('');
    setLogWarning('');
    setMotionTemplate(DEFAULT_MOTION_TEMPLATE);
    setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  const busy = ['analyzing', 'writing', 'rendering'].includes(phase);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      style={{
        width: '100%',
        minHeight: compact ? 540 : '100%',
        boxSizing: 'border-box',
        background: '#0a0a0a',
        color: '#fafafa',
        fontFamily: "'Inter', 'Geist', system-ui, -apple-system, sans-serif",
        padding: compact ? 20 : 'clamp(22px, 5vw, 64px)',
      }}
    >
      <style>{APP_CSS}</style>
      <div style={{ width: '100%', maxWidth: compact ? 760 : 1020, margin: '0 auto' }}>
        {!compact ? (
          <header style={{ marginBottom: 34 }} className="pm-rise">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#a5b4fc', fontSize: 12, fontWeight: 700, letterSpacing: '.11em', textTransform: 'uppercase' }}>
              <Film size={15} /> Remotion
            </div>
            <h1 style={{ margin: '12px 0 0', maxWidth: 780, fontSize: 'clamp(34px, 6vw, 64px)', lineHeight: 1.02, letterSpacing: '-.045em', fontWeight: 760 }}>
              Your product shots,<br /><span style={{ color: '#a5b4fc' }}>directed frame by frame.</span>
            </h1>
            <p style={{ margin: '16px 0 0', maxWidth: 620, color: '#a1a1aa', lineHeight: 1.65, fontSize: 15 }}>
              Preview and render a one-of-one Remotion composition built frame by frame from your product images.
            </p>
          </header>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
            <Sparkles size={17} color="#a5b4fc" />
            <strong style={{ fontSize: 16 }}>Generate a motion video</strong>
          </div>
        )}

        {phase !== 'done' ? (
          <div style={{ display: 'grid', gap: 18 }}>
            {!busy ? (
              <div className="pm-rise" style={{ padding: 'clamp(14px,3vw,20px)', borderRadius: 18, border: '1px solid rgba(255,255,255,.09)', background: '#111113' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: '#c7d2fe' }}>
                  <Sparkles size={15} />
                  <strong style={{ fontSize: 14 }}>Choose a motion style</strong>
                </div>
                <p style={{ margin: '0 0 13px', color: '#71717a', fontSize: 12, lineHeight: 1.5 }}>
                  Watch all 15 layouts move, then choose the presentation direction for your product video.
                </p>
                <MotionStylePicker selected={motionTemplate} onSelect={setMotionTemplate} />
              </div>
            ) : null}

            <div
              className="pm-drop pm-focus"
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !busy && inputRef.current?.click()}
              onKeyDown={(event) => {
                if (!busy && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={busy ? -1 : 0}
              aria-disabled={busy}
              style={{
                minHeight: compact ? 190 : 270,
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                cursor: busy ? 'default' : 'pointer',
                borderRadius: 22,
                border: `1.5px dashed ${dragging ? '#818cf8' : 'rgba(255,255,255,.18)'}`,
                background: dragging ? 'rgba(99,102,241,.12)' : 'linear-gradient(145deg, rgba(99,102,241,.07), rgba(255,255,255,.018))',
                transform: dragging ? 'scale(1.006)' : undefined,
                padding: 26,
              }}
              data-testid="product-motion-dropzone"
            >
              <div>
                <span style={{ width: 54, height: 54, display: 'inline-grid', placeItems: 'center', borderRadius: 17, color: '#c7d2fe', background: 'rgba(99,102,241,.14)', border: '1px solid rgba(129,140,248,.25)' }}>
                  <UploadCloud size={25} />
                </span>
                <h2 style={{ margin: '16px 0 6px', fontSize: compact ? 20 : 25, letterSpacing: '-.02em' }}>Drop your product shots here</h2>
                <p style={{ margin: 0, color: '#71717a', fontSize: 13 }}>or click to choose up to five images · 12 MB each</p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                disabled={busy || assets.length >= MAX_IMAGES}
                onClick={(event) => { event.currentTarget.value = ''; }}
                onChange={(event) => addFiles(Array.from(event.target.files || []))}
                style={{ display: 'none' }}
                data-testid="product-motion-file-input"
              />
            </div>

            {assets.length > 0 ? (
              <div className="pm-rise" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '2px 2px 8px' }}>
                {assets.map((asset) => (
                  <div key={asset.id} style={{ position: 'relative', flex: '0 0 132px' }}>
                    <div style={{ height: 96, borderRadius: 13, overflow: 'hidden', border: '1px solid rgba(255,255,255,.10)', background: '#18181b' }}>
                      <img src={asset.objectUrl} alt={asset.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <span style={{ display: 'block', marginTop: 7, color: '#a1a1aa', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.label}</span>
                    {!busy ? (
                      <button
                        type="button"
                        onClick={() => removeAsset(asset.id)}
                        className="pm-focus"
                        aria-label={`Remove ${asset.file.name}`}
                        style={{ position: 'absolute', top: 6, right: 6, width: 25, height: 25, display: 'grid', placeItems: 'center', border: 0, borderRadius: 999, color: '#fff', background: 'rgba(0,0,0,.72)', cursor: 'pointer' }}
                      >
                        <X size={13} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {vision ? <VisionCard vision={vision} /> : null}

            {busy ? (
              <div className="pm-rise" style={{ padding: 'clamp(17px, 3vw, 24px)', borderRadius: 18, border: '1px solid rgba(255,255,255,.08)', background: '#111113' }}>
                <ProgressSteps phase={phase} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void generate()}
                disabled={assets.length === 0}
                className="pm-button pm-focus"
                style={{
                  minHeight: 54,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 9,
                  width: '100%',
                  border: 0,
                  borderRadius: 15,
                  background: assets.length ? `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DARK})` : '#27272a',
                  color: assets.length ? '#fff' : '#71717a',
                  fontSize: 16,
                  fontWeight: 750,
                  cursor: assets.length ? 'pointer' : 'not-allowed',
                }}
                data-testid="product-motion-generate"
              >
                {phase === 'error' ? <RefreshCw size={18} /> : <Sparkles size={18} />}
                {phase === 'error' ? 'Retry generation' : 'Generate Motion Video'} <ArrowRight size={18} />
              </button>
            )}

            {error ? (
              <div className="pm-rise" role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '13px 15px', borderRadius: 13, border: '1px solid rgba(248,113,113,.28)', background: 'rgba(239,68,68,.08)', color: '#fca5a5', fontSize: 13, lineHeight: 1.5 }}>
                <X size={16} style={{ marginTop: 1, flexShrink: 0 }} /> {error}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="pm-rise" style={{ display: 'grid', gap: 18 }}>
            <div style={{ padding: 'clamp(14px, 3vw, 24px)', borderRadius: 20, border: '1px solid rgba(255,255,255,.10)', background: '#111113', boxShadow: '0 32px 90px -45px rgba(99,102,241,.65)' }}>
              <video src={videoUrl} controls playsInline style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', borderRadius: 14, background: '#000' }} data-testid="product-motion-video" />
            </div>
            {vision ? <VisionCard vision={vision} /> : null}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void downloadVideo()}
                disabled={downloading}
                className="pm-button pm-focus"
                style={{ minHeight: 50, flex: '1 1 220px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, border: 0, borderRadius: 14, color: '#fff', cursor: downloading ? 'wait' : 'pointer', fontWeight: 750, background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DARK})`, opacity: downloading ? .72 : 1 }}
                data-testid="product-motion-download"
              >
                {downloading ? <Loader2 size={18} className="pm-dot" /> : <Download size={18} />}
                {downloading ? 'Preparing download…' : 'Download'}
              </button>
              <button
                type="button"
                onClick={reset}
                className="pm-focus"
                style={{ minHeight: 50, flex: '1 1 180px', borderRadius: 14, border: '1px solid rgba(255,255,255,.12)', color: '#d4d4d8', background: 'rgba(255,255,255,.035)', cursor: 'pointer', fontWeight: 650 }}
              >
                Generate another
              </button>
            </div>
            {logWarning ? <p style={{ margin: 0, color: '#fbbf24', fontSize: 12 }}>{logWarning}</p> : null}
            {compositionCode ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#52525b', fontSize: 11 }}>
                <ImageIcon size={13} /> Unique TSX composition · {compositionCode.length.toLocaleString()} characters
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return <ProductMotionEmbed />;
}
