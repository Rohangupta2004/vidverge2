/**
 * ADS STUDIO — shared types, auth plumbing, uploads, server-function calls and
 * localStorage session persistence for the agentic short-form ad engine:
 *
 *   product URL + avatar + assets
 *     → web research (scrape-website server function + Claude Opus 5)
 *     → ad angles → clip script → scene plan (all Opus 5 creative direction)
 *     → Veo generation with Opus inspection + continuity notes
 *     → GSAP/SVG overlay layer (screenshot mockups, callouts, captions)
 *     → FFmpeg.wasm assembly (NO Remotion anywhere)
 *     → final downloadable MP4 + hook/body/CTA variations
 *
 * Standalone by design: Ads Studio shares no module with Product Video,
 * SceneForge, Video Enhancer or Script-to-Video.
 */

// ---------------------------------------------------------------------------
// Session / auth plumbing
// ---------------------------------------------------------------------------

export function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

export function sessionId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__spaceSessionId || '');
}

export function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

/** The workspace's UUID, injected by the platform at serve time. Used for
 *  provider-credential proxy and server-stitch endpoints that address the
 *  workspace by UUID rather than by space id. */
export function workspaceUuid(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__WORKSPACE_ID__ || '');
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface UploadedAsset { name: string; url: string }

export interface ProductResearch {
  product_name: string;
  one_liner: string;
  core_features: string[];
  pricing: string;
  target_audience: string;
  pain_points: string[];
  desires: string[];
  objections: string[];
  mechanism: string;
  awareness_level: string;
  customer_language: string[];
  positioning: string;
  proof_elements: string[];
}

export const ANGLE_TYPES = [
  'Problem/Pain', 'Identity', 'Mechanism', 'Benefit/Result', 'Objection Breaker',
  'Emotional', 'Status/Aspirational', 'Fear/Loss', 'Time/Convenience',
  'Price/Value', 'Comparison', 'Myth-Buster',
] as const;

export interface AdAngle {
  id: string;
  angle_name: string;
  angle_type: string;
  core_idea: string;
  target_audience_state: string;
  hook: string;
  problem: string;
  mechanism: string;
  desired_outcome: string;
  proof_opportunity: string;
  creative_direction: string;
}

export type ClipDuration = 4 | 6 | 8 | 10;

/** HARD word limits per clip duration — enforced in the UI and in prompts. */
export const WORD_LIMITS: Record<ClipDuration, number> = { 4: 9, 6: 13, 8: 17, 10: 22 };

export function wordCount(line: string): number {
  return String(line || '').trim().split(/\s+/).filter(Boolean).length;
}

export interface ScriptClip {
  clip_number: number;
  clip_role: string;
  duration_seconds: ClipDuration;
  spoken_line: string;
  word_count: number;
  visual_concept: string;
  overlay_idea: string;
  emotion: string;
}

export type OverlayType =
  | 'none' | 'screenshot_mockup' | 'text_callout' | 'review_card'
  | 'stat_counter' | 'cta_button' | 'arrow_highlight';

export type MockupDevice = 'phone' | 'laptop' | 'browser' | 'tablet' | 'monitor';

export interface GeneratedAssetNeed { description: string; purpose: string }

export interface ScenePlan {
  clip_number: number;
  camera_movement: string;
  framing: string;
  subject_position: string;
  micro_action: string;
  gesture: string;
  spoken_line: string;
  voice_description: string;
  accent: string;
  expression: string;
  environment: string;
  lighting: string;
  visual_style: string;
  product_interaction: string;
  continuity_notes: string;
  do_not_show: string;
  overlay_assets: string[];
  overlay_type: OverlayType;
  overlay_text: string;
  veo_prompt: string;
  use_screenshot_mockup: boolean;
  screenshot_mockup_type: MockupDevice;
  generated_assets_needed?: GeneratedAssetNeed[];
}

export interface GeneratedAsset extends GeneratedAssetNeed { url: string }

export type ClipStatus = 'pending' | 'generating' | 'inspecting' | 'accepted' | 'regenerated' | 'failed';

export interface GeneratedClip {
  clipNumber: number;
  videoUrl: string | null;
  status: ClipStatus;
  issues: string[];
  attempts: number;
  lastFrameUrl: string | null;
  promptUsed: string;
  /** The ACTUAL model this clip rendered on — recorded per clip, never assumed. */
  modelUsed?: string | null;
  note: string;
}

export interface VariationMatrix {
  /** Alternative spoken lines for the hook clip; index 0 = the original. */
  hooks: string[];
  /** Alternative middle-section line sets, keyed by clip_number; index 0 = original. */
  bodies: Record<string, string>[];
  /** Alternative CTA-clip lines; index 0 = the original. */
  ctas: string[];
}

export interface AdVariation {
  id: string;
  hookIdx: number;
  bodyIdx: number;
  ctaIdx: number;
  status: 'pending' | 'generating' | 'assembling' | 'done' | 'error';
  error: string | null;
  videoUrl: string | null;
  clipVideos: Record<string, string>;
}

export interface AdsSession {
  // Intake
  productUrl: string;
  productDescription: string;
  offerCta: string;
  avatar: UploadedAsset | null;
  screenshots: UploadedAsset[];
  productImages: UploadedAsset[];
  productVideos: UploadedAsset[];
  logo: UploadedAsset | null;
  aspect: '9:16' | '16:9' | '1:1';
  // Research
  research: ProductResearch | null;
  researchStatus: 'idle' | 'loading' | 'done' | 'error';
  researchError: string | null;
  // Angles
  angles: AdAngle[];
  selectedAngleIds: string[];
  activeAngleId: string | null;
  opusPick: { angleId: string; reason: string } | null;
  // Script
  script: ScriptClip[];
  // Scene plan
  scenePlan: ScenePlan[];
  voiceDescription: string;
  generatedAssets: GeneratedAsset[];
  // Cast — the ONE presenter every clip renders from. castUrl is the locked
  // reference image (the uploaded avatar, or a portrait cast and generated
  // once), castDescription its text half. Both are remembered on the session
  // so a resume, a retake or a variation reuses the same person.
  castUrl: string | null;
  castDescription: string;
  // Generation
  clips: GeneratedClip[];
  // Assembly
  finalVideoUrl: string | null;
  assemblyStatus: 'idle' | 'assembling' | 'done' | 'error';
  assemblyError: string | null;
  // Variations
  matrix: VariationMatrix | null;
  variations: AdVariation[];
  // UI
  currentStep: number;
  isProcessing: boolean;
}

export function emptySession(): AdsSession {
  return {
    productUrl: '', productDescription: '', offerCta: '',
    avatar: null, screenshots: [], productImages: [], productVideos: [], logo: null,
    aspect: '9:16',
    research: null, researchStatus: 'idle', researchError: null,
    angles: [], selectedAngleIds: [], activeAngleId: null, opusPick: null,
    script: [],
    scenePlan: [], voiceDescription: '', generatedAssets: [],
    castUrl: null, castDescription: '',
    clips: [],
    finalVideoUrl: null, assemblyStatus: 'idle', assemblyError: null,
    matrix: null, variations: [],
    currentStep: 1, isProcessing: false,
  };
}

// ---------------------------------------------------------------------------
// localStorage persistence — refresh-and-continue
// ---------------------------------------------------------------------------

const STORE_KEY = 'ads_studio_session_v1';

export function loadSession(): AdsSession {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    if (!raw) return emptySession();
    const parsed = JSON.parse(raw);
    const s: AdsSession = { ...emptySession(), ...parsed, isProcessing: false };
    // In-flight work died with the tab — settle transient statuses.
    if (s.researchStatus === 'loading') s.researchStatus = s.research ? 'done' : 'idle';
    if (s.assemblyStatus === 'assembling') s.assemblyStatus = s.finalVideoUrl ? 'done' : 'idle';
    s.clips = (s.clips || []).map((c) => (
      c.status === 'generating' || c.status === 'inspecting'
        ? (c.videoUrl
          ? { ...c, status: 'accepted' as const, note: c.note || 'Adopted after a reload.' }
          : { ...c, status: 'failed' as const, note: 'Interrupted by a reload — regenerate this clip.' })
        : c
    ));
    s.variations = (s.variations || []).map((v) => (
      v.status === 'generating' || v.status === 'assembling'
        ? { ...v, status: v.videoUrl ? 'done' : 'error', error: v.videoUrl ? null : 'Interrupted by a reload — build it again.' }
        : v
    ));
    return s;
  } catch {
    return emptySession();
  }
}

export function saveSession(s: AdsSession): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, isProcessing: false }));
  } catch { /* quota or private mode — persistence degrades gracefully */ }
}

export function clearSession(): void {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(STORE_KEY); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Uploads (platform file-storage integration)
// ---------------------------------------------------------------------------

export async function uploadDataUrl(dataUrl: string, fileName: string): Promise<string> {
  const res = await fetch('/api/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
    body: JSON.stringify({ imageData: dataUrl, fileName }),
  });
  const data = await res.json().catch(() => null);
  const url = data && (data.imageUrl || data.url);
  if (!res.ok || typeof url !== 'string') throw new Error(String(data?.error || `Image upload failed (HTTP ${res.status}).`));
  return url;
}

export async function uploadBlob(blob: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append('file', new File([blob], fileName, { type: blob.type || 'application/octet-stream' }));
  form.append('folder', 'ads-studio');
  const res = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(String(data?.error || `File upload failed (HTTP ${res.status}).`));
  return String(data.url);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/** Park a user-picked file on durable storage; images go through the image
 * endpoint, videos and everything else through file upload. */
export async function uploadUserFile(file: File): Promise<UploadedAsset> {
  const safeName = file.name.replace(/[^\w.-]+/g, '_');
  if (file.type.startsWith('image/')) {
    const dataUrl = await readAsDataUrl(file);
    return { name: file.name, url: await uploadDataUrl(dataUrl, safeName) };
  }
  return { name: file.name, url: await uploadBlob(file, safeName) };
}

// ---------------------------------------------------------------------------
// Server-function calls (browser → registered hooks)
// ---------------------------------------------------------------------------

export async function callHook(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/hooks/execute/${appId()}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}),
      ...(sessionId() ? { 'X-Session-Id': sessionId() } : {}),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  if (!res.ok) throw new Error(String(data?.error || `The ${name} service answered HTTP ${res.status}.`));
  return data;
}

/** Generate a bespoke image asset through the cached Asset Generator hook
 * (asset-image-gen → Omni Flash → durable GCS URL) — the same engine every
 * other app in this workspace uses. */
export async function generateImageAsset(prompt: string, aspect: '9:16' | '16:9' | '1:1'): Promise<string> {
  const data = await callHook('asset-image-gen', { op: 'generate', prompt, aspect });
  const url = data?.imageUrl;
  if (!url || typeof url !== 'string') throw new Error(String(data?.error || 'The asset engine returned no image.'));
  return url;
}

// ---------------------------------------------------------------------------
// Design tokens — dark, premium, creative-agency; derived from the VidVerge
// brand (see config.json themeTokens) so Ads Studio matches the shell.
// ---------------------------------------------------------------------------

export const T = {
  canvas: 'var(--space-surface-bg, #FFFDF4)',
  panel: 'var(--space-surface-panel, #FFFAEB)',
  card: 'var(--space-surface-card, #FFFFFF)',
  raised: 'var(--space-surface-panel-strong, #FFF3D6)',
  line: 'var(--space-border-default, rgba(180,120,0,0.14))',
  lineStrong: 'var(--space-border-strong, rgba(180,120,0,0.36))',
  ink: 'var(--space-text-primary, #1A1000)',
  soft: 'var(--space-text-secondary, #3D2800)',
  muted: 'var(--space-text-muted, #7A6030)',
  accent: 'var(--space-brand-primary-500, #C8920A)',
  accentDeep: 'var(--space-brand-primary-600, #B4720A)',
  highlight: 'var(--space-brand-highlight-500, #E0A33A)',
  good: 'var(--space-semantic-success-500, #166534)',
  bad: 'var(--space-semantic-danger-500, #991B1B)',
  warn: '#B45309',
  sans: "'Inter', 'Geist', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
} as const;

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/** The 8-step workflow rail. */
export const STEPS = [
  { n: 1, id: 'product', label: 'Product' },
  { n: 2, id: 'research', label: 'Research' },
  { n: 3, id: 'angles', label: 'Angles' },
  { n: 4, id: 'script', label: 'Script' },
  { n: 5, id: 'sceneplan', label: 'Scene Plan' },
  { n: 6, id: 'generate', label: 'Generate' },
  { n: 7, id: 'review', label: 'Review' },
  { n: 8, id: 'variations', label: 'Variations' },
] as const;
