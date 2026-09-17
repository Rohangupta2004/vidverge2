/**
 * VidVerge — MOTION UI: asset analysis, the AI Motion Director, AI Edit and
 * the validator/repairer.
 *
 * THE PIPELINE THIS FILE OWNS:
 *   analyzeAsset()      — reads dimensions + dominant colors in the browser, then
 *                         asks the platform vision model what the screen IS
 *                         (role, structure, theme) so the Director can assign
 *                         motion roles without the visitor classifying anything.
 *   directMotionPlan()  — builds a deterministic base plan procedurally, then
 *                         (best-effort) lets the AI Motion Director enrich the
 *                         camera path and typography. The AI NEVER writes
 *                         Remotion code — it only returns the structured JSON
 *                         Motion Plan, which is always normalized + validated.
 *   editMotionPlan()    — natural-language edits patch the existing plan rather
 *                         than regenerating it; locked assets are preserved.
 *   validateAndRepair() — clamps timings, keeps text in the safe area, drops
 *                         collisions and missing assets, then returns the fixed
 *                         plan plus the list of what it changed.
 *
 * Provider-neutral text goes through the platform openai proxy (see the App AI
 * Model Policy). Everything degrades gracefully: no model ⇒ the procedural plan
 * still ships.
 */
import { aiProxyHeaders, describeImage } from '../../lib/reelioStudio';
import {
  PRODUCT_LAUNCH_ARC,
  getPreset,
  type MotionPreset,
} from './motionUiPresets';
import {
  clamp,
  isHttpUrl,
  uid,
  type AssetLayer,
  type CameraKeyframe,
  type MotionAsset,
  type MotionAspect,
  type MotionBackground,
  type MotionBrand,
  type MotionGraphic,
  type MotionPlan,
  type TextCue,
  type ValidationResult,
  type MotionIssue,
  MOTION_FPS,
  MOTION_PLAN_VERSION,
} from './motionUiTypes';

// ---------------------------------------------------------------------------
// JSON extraction (mirrors studioApi.extractJson, kept local to this module)
// ---------------------------------------------------------------------------
export function extractJson(raw: string): any | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const candidates = [cleaned];
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) candidates.push(cleaned.slice(objStart, objEnd + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* next */
    }
  }
  return null;
}

const TEXT_MODEL = 'gpt-5.6-terra';

async function chat(system: string, user: string, maxTokens = 1800): Promise<string | null> {
  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: aiProxyHeaders(),
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        reasoning_effort: 'none',
        max_completion_tokens: maxTokens,
      }),
    });
    const data = await res.json().catch(() => null);
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!res.ok || !raw) return null;
    return raw;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Asset analysis
// ---------------------------------------------------------------------------
/** Read natural dimensions + dominant colors + light/dark in the browser. */
export function readImageMeta(
  url: string,
): Promise<{ width: number; height: number; aspect: number; colors: string[]; theme: 'light' | 'dark' | '' }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !isHttpUrl(url)) {
      resolve({ width: 0, height: 0, aspect: 1, colors: [], theme: '' });
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = (meta: { width: number; height: number; aspect: number; colors: string[]; theme: 'light' | 'dark' | '' }) =>
      resolve(meta);
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      const aspect = height > 0 ? width / height : 1;
      try {
        const size = 40;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return done({ width, height, aspect, colors: [], theme: '' });
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = new Map<string, { count: number; r: number; g: number; b: number; lum: number }>();
        let lumSum = 0;
        let lumCount = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          lumSum += lum;
          lumCount += 1;
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
          const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0, lum: 0 };
          bucket.count += 1;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          buckets.set(key, bucket);
        }
        const sorted = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, 5);
        const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
        const colors = sorted.map((c) => `#${toHex(c.r / c.count)}${toHex(c.g / c.count)}${toHex(c.b / c.count)}`);
        const theme: 'light' | 'dark' | '' = lumCount === 0 ? '' : lumSum / lumCount > 0.5 ? 'light' : 'dark';
        done({ width, height, aspect, colors, theme });
      } catch {
        // Cross-origin taint or no canvas: dimensions still make it through.
        done({ width, height, aspect, colors: [], theme: '' });
      }
    };
    img.onerror = () => done({ width: 0, height: 0, aspect: 1, colors: [], theme: '' });
    img.src = url;
  });
}

const ASSET_VISION_PROMPT =
  'You are analyzing a single uploaded asset for a product-launch motion video. ' +
  'Respond with ONLY valid JSON, no markdown fences, in this exact shape: ' +
  '{"role": string, "summary": string, "structure": string[], "theme": "light"|"dark", "kind": "ui_screenshot"|"website"|"mobile"|"product"|"logo"}. ' +
  '"role" is a short semantic label for what this screen is, e.g. "dashboard", "analytics", "settings", "pricing", "mobile home", "logo". ' +
  '"summary" is one concrete sentence describing what is on screen. ' +
  '"structure" is a short list of the important visual regions actually present, drawn from: nav, sidebar, header, cards, charts, table, buttons, hero, form, list, media. ' +
  '"theme" is whether the UI is light or dark. "kind" classifies the asset. ' +
  'Never invent UI that is not visible. Describe only what is actually shown.';

/** Ask vision what an asset is. Best-effort — returns partial on any failure. */
export async function analyzeAssetVision(
  url: string,
): Promise<{ role: string; summary: string; structure: string[]; theme: 'light' | 'dark' | ''; kind: string }> {
  try {
    const raw = await describeImage(url, ASSET_VISION_PROMPT);
    const parsed = extractJson(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        role: String(parsed.role || '').trim().slice(0, 40),
        summary: String(parsed.summary || '').trim().slice(0, 200),
        structure: Array.isArray(parsed.structure)
          ? parsed.structure.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 8)
          : [],
        theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : '',
        kind: String(parsed.kind || '').trim(),
      };
    }
  } catch {
    /* vision unavailable */
  }
  return { role: '', summary: '', structure: [], theme: '', kind: '' };
}

// ---------------------------------------------------------------------------
// Brand derivation
// ---------------------------------------------------------------------------
function isVivid(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 48 && max > 60;
}

/** Build the brand system from analyzed asset colors, falling back to preset. */
export function deriveBrand(assets: MotionAsset[], preset: MotionPreset, override?: Partial<MotionBrand>): MotionBrand {
  const pool: string[] = [];
  assets.forEach((a) => (a.colors || []).forEach((c) => pool.push(c)));
  const vivid = pool.filter(isVivid);
  const primary = override?.primary || vivid[0] || preset.palette.primary;
  const secondary = override?.secondary || vivid.find((c) => c !== primary) || preset.palette.secondary;
  const logo = assets.find((a) => a.type === 'logo');
  return {
    primary,
    secondary,
    background: override?.background || preset.palette.background,
    text: override?.text || preset.palette.text,
    accent: override?.accent || vivid.find((c) => c !== primary && c !== secondary) || preset.palette.accent,
    font: override?.font || "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    logoUrl: override?.logoUrl || (logo ? logo.url : undefined),
  };
}

// ---------------------------------------------------------------------------
// The Director input
// ---------------------------------------------------------------------------
export interface DirectorInput {
  brief: string;
  assets: MotionAsset[];
  presetId: string;
  styleWord: string;
  duration: number;
  aspect: MotionAspect;
  brandOverride?: Partial<MotionBrand>;
  /** Notes distilled from an optional reference video. */
  referenceNotes?: string;
  /** Whether the Director may request generative AI_VIDEO shots. */
  allowAiVideo?: boolean;
  /** Whether the Director may place one presenter beat. */
  useAvatar?: boolean;
  /** Optional presenter image used as an Omni identity reference at render time. */
  avatarUrl?: string;
}

// ---------------------------------------------------------------------------
// The deterministic base planner — always produces a coherent continuous plan
// ---------------------------------------------------------------------------
function cameraEnergyScale(preset: MotionPreset): { zoom: number; travel: number } {
  switch (preset.cameraEnergy) {
    case 'calm':
      return { zoom: 0.08, travel: 0.35 };
    case 'bold':
      return { zoom: 0.22, travel: 0.9 };
    case 'medium':
    default:
      return { zoom: 0.14, travel: 0.6 };
  }
}

function backgroundFor(preset: MotionPreset, brand: MotionBrand): MotionBackground {
  return {
    type: preset.background,
    colors: [brand.background, brand.primary, brand.secondary].filter(Boolean),
    animation: preset.backgroundAnimation,
  };
}

function graphicsFor(preset: MotionPreset, brand: MotionBrand): MotionGraphic[] {
  const out: MotionGraphic[] = [];
  const d = preset.density;
  if (d > 0.3) out.push({ id: uid('g'), kind: 'glow', color: brand.primary, intensity: clamp(d, 0.3, 0.8), depth: 'back' });
  if (preset.id === 'futuristic' || preset.id === 'dark_tech')
    out.push({ id: uid('g'), kind: 'grid', color: brand.secondary, intensity: 0.3, depth: 'back' });
  if (preset.id === 'futuristic' || preset.id === 'cinematic')
    out.push({ id: uid('g'), kind: 'beams', color: brand.accent, intensity: 0.4, depth: 'back' });
  if (preset.id === 'energetic') out.push({ id: uid('g'), kind: 'particles', color: brand.accent, intensity: 0.6, depth: 'front' });
  if (preset.id === 'dark_tech') out.push({ id: uid('g'), kind: 'dots', color: brand.secondary, intensity: 0.25, depth: 'back' });
  if (preset.id === 'clean_launch' || preset.id === 'premium_saas')
    out.push({ id: uid('g'), kind: 'rings', color: brand.secondary, intensity: 0.28, depth: 'back' });
  return out;
}

/** Product name guess from brief or asset roles. */
function productName(input: DirectorInput): string {
  const brief = input.brief.trim();
  if (brief) {
    const firstLine = brief.split(/[\n.—-]/)[0].trim();
    if (firstLine && firstLine.length <= 42) return firstLine;
  }
  return 'Your product';
}

/**
 * Build the deterministic, continuous base plan. This is what ships when no
 * model is reachable, and the scaffold the AI enrichment merges onto.
 */
export function buildBasePlan(input: DirectorInput): MotionPlan {
  const preset = getPreset(input.presetId);
  const brand = deriveBrand(input.assets, preset, input.brandOverride);
  const duration = clamp(input.duration || 15, 5, 60);

  // The visual assets we actually animate (skip logo + reference video here —
  // the logo becomes a brand frame; the reference is style-only).
  const screens = input.assets.filter((a) => a.type !== 'logo' && a.type !== 'reference_video');
  const count = Math.max(1, screens.length);

  // Lay the screens out across a horizontal world so ONE camera pan connects
  // them. Slight vertical stagger keeps it from feeling like a filmstrip.
  const spread = cameraEnergyScale(preset).travel;
  const layers: AssetLayer[] = [];
  const perScreen = duration / count;
  screens.forEach((asset, i) => {
    const worldX = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2 * spread;
    const worldY = i % 2 === 0 ? 0 : (i % 4 === 1 ? -0.06 : 0.06);
    // Overlap windows so a screen is already easing in while the last eases out.
    const start = Math.max(0, i * perScreen - (i === 0 ? 0 : 0.6));
    const end = Math.min(duration, (i + 1) * perScreen + 0.6);
    const entrances: AssetLayer['entrance'][] = ['scale_in', 'slide_up', 'slide_left', 'rise', 'slide_right'];
    layers.push({
      id: uid('l'),
      assetId: asset.id,
      kind: asset.type === 'product' ? 'product' : 'ui',
      start,
      end,
      worldX,
      worldY,
      worldScale: asset.type === 'mobile' ? 0.62 : 0.82,
      rotate: 0,
      entrance: i === 0 ? 'scale_in' : entrances[i % entrances.length],
      entranceDur: 0.8,
      exitDur: 0.6,
      float: preset.density > 0.5 ? 'float' : 'none',
      frameStyle: asset.type === 'mobile' ? 'device' : asset.type === 'website' ? 'browser' : 'card',
      shadow: true,
    });
  });

  // The ONE global camera: start pulled back and centred on the first screen,
  // then pan across each screen with a gentle zoom breathing in and out. No
  // resets — keyframes are monotonic in time and flow into one another.
  const { zoom } = cameraEnergyScale(preset);
  const camera: CameraKeyframe[] = [];
  camera.push({ t: 0, x: -(layers[0]?.worldX || 0), y: 0, scale: 1 - zoom * 0.5 });
  layers.forEach((l, i) => {
    const mid = (l.start + l.end) / 2;
    camera.push({ t: clamp(mid, 0, duration), x: -l.worldX, y: -l.worldY * 0.5, scale: 1 + zoom * (i % 2 === 0 ? 1 : 0.4) });
  });
  // Land on a pulled-back overview of the whole world for the CTA.
  camera.push({ t: duration, x: 0, y: 0, scale: 1 - zoom * 0.4 });

  // Avatar is additive to the same global timeline. This deterministic beat is
  // also the no-AI fallback: when requested, an intro presenter slot exists
  // even if the Director call is unavailable. Its clip is generated immediately
  // before the final render; failure simply removes the slot.
  if (input.useAvatar) {
    layers.push({
      id: uid('l'),
      assetId: '',
      kind: 'avatar',
      start: 0,
      end: Math.min(duration, Math.max(2.5, duration * 0.28)),
      worldX: 0.46,
      worldY: 0.12,
      worldScale: 0.42,
      rotate: 0,
      entrance: 'rise',
      entranceDur: 0.7,
      exitDur: 0.5,
      float: 'none',
      frameStyle: 'none',
      shadow: true,
      prompt: `A confident, natural presenter introduces ${productName(input) || 'the product'} directly to camera in a polished modern studio, subtle organic gestures, cinematic lighting.`,
    });
  }

  // Text: opening product title, a headline per screen (from its role), a CTA.
  const name = productName(input);
  const text: TextCue[] = [];
  text.push({
    id: uid('t'),
    content: name.toUpperCase(),
    start: 0.3,
    end: Math.min(duration, 3),
    anchor: 'center',
    level: 3,
    weight: 800,
    animation: preset.textAnimation === 'char_reveal' ? 'char_reveal' : 'slide_up',
    align: 'center',
  });
  screens.forEach((asset, i) => {
    const label = (asset.role || asset.summary || 'A closer look').trim();
    if (!label) return;
    const l = layers[i];
    text.push({
      id: uid('t'),
      content: label.length > 32 ? label.slice(0, 32) : label,
      start: clamp(l.start + 0.5, 0, duration),
      end: clamp(l.end - 0.3, 0, duration),
      anchor: i % 2 === 0 ? 'bottom-left' : 'top-right',
      level: 2,
      weight: 700,
      animation: preset.textAnimation === 'char_reveal' ? 'slide_up' : preset.textAnimation,
      align: i % 2 === 0 ? 'left' : 'right',
    });
  });
  text.push({
    id: uid('t'),
    content: 'Start building',
    start: Math.max(0, duration - 2.6),
    end: duration,
    anchor: 'center',
    level: 3,
    weight: 800,
    animation: 'scale_reveal',
    align: 'center',
    emphasis: true,
  });

  return {
    version: MOTION_PLAN_VERSION,
    duration,
    fps: MOTION_FPS,
    aspectRatio: input.aspect,
    presetId: preset.id,
    styleWord: input.styleWord || '',
    brand,
    background: backgroundFor(preset, brand),
    graphics: graphicsFor(preset, brand),
    camera,
    layers,
    text,
    audio: { volume: 0.6, muted: false },
    title: name,
  };
}

// ---------------------------------------------------------------------------
// AI enrichment of the base plan
// ---------------------------------------------------------------------------
function assetDigest(assets: MotionAsset[]): string {
  return assets
    .map(
      (a) =>
        `- id:${a.id} | type:${a.type} | role:${a.role || 'unknown'} | aspect:${a.aspect.toFixed(2)} | theme:${a.theme || '?'} | ${a.summary || ''}`,
    )
    .join('\n');
}

const DIRECTOR_SYSTEM =
  'You are an AI Motion Director for premium product-launch videos. You do NOT write code. ' +
  'You return ONLY a JSON "motion plan" that a deterministic Remotion engine renders. ' +
  'The whole video is ONE continuous composition with ONE global camera path — never scene-by-scene. ' +
  'Uploaded UI screenshots are pixel-accurate and must NEVER be redrawn; you only choose where/when they appear and how the camera moves over them. ' +
  'All on-screen words are text cues you author (short, punchy, hierarchy-aware); the render draws them, so spelling is exact. ' +
  'Respond with ONLY valid JSON, no markdown fences, in this exact shape: ' +
  '{"title": string, "camera": [{"t": number, "x": number, "y": number, "scale": number}], ' +
  '"layers": [{"kind": "ui"|"product"|"logo"|"ai_video"|"avatar", "assetId": string, "prompt": string, "screenAssetId": string, "start": number, "end": number, "worldX": number, "worldY": number, "worldScale": number, "entrance": string, "float": string}], ' +
  '"text": [{"content": string, "start": number, "end": number, "anchor": string, "level": 1|2|3, "animation": string, "align": string, "emphasis": boolean}]}. ' +
  'camera keyframes MUST be time-sorted, start at t:0 and end at t:duration, and flow smoothly (no sudden jumps back). ' +
  'x/y are world offsets in frame fractions (-1..1); scale is zoom (0.8..1.4). worldX/worldY place a screen in the shared world so a single pan connects two screens. ' +
  'entrance is one of fade|slide_left|slide_right|slide_up|slide_down|scale_in|rise|none. float is one of none|float|drift_left|drift_right|parallax. ' +
  'anchor is one of center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right. animation is one of fade|slide_up|word_reveal|char_reveal|tracking_expand|scale_reveal|mask_reveal. ' +
  'For normal ui/product/logo layers, assetId MUST be a provided asset id. ' +
  'An ai_video layer is optional and assetId may be empty; use one ONLY when permission is explicitly ON and cinematic environment, physical product behavior, or human/organic motion genuinely adds something Remotion cannot. Give it a concrete visual prompt. ' +
  'If that generated shot deliberately contains a device or screen, set screenAssetId to the exact real UI asset that must remain readable and also keep it as a normal foreground UI layer; never invent tracking coordinates or claim a perspective match. ' +
  'An avatar layer is optional and assetId may be empty; use at most one, only when avatar permission is ON, as a short intro or outro with a concrete presenter prompt. ' +
  'When either permission is OFF, never emit that layer kind. Keep text short (<= 34 chars). Keep everything within the given duration.';

function normalizeEntrance(v: any): AssetLayer['entrance'] {
  const ok = ['fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down', 'scale_in', 'rise', 'none'];
  return ok.includes(v) ? v : 'fade';
}
function normalizeFloat(v: any): AssetLayer['float'] {
  const ok = ['none', 'float', 'drift_left', 'drift_right', 'parallax'];
  return ok.includes(v) ? v : 'none';
}
function normalizeAnchor(v: any): TextCue['anchor'] {
  const ok = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
  return ok.includes(v) ? v : 'center';
}
function normalizeTextAnim(v: any): TextCue['animation'] {
  const ok = ['fade', 'slide_up', 'word_reveal', 'char_reveal', 'tracking_expand', 'scale_reveal', 'mask_reveal'];
  return ok.includes(v) ? v : 'fade';
}

function normalizeScreenComposite(value: any, validIds: Set<string>): AssetLayer['screenComposite'] {
  if (!value || typeof value !== 'object' || !validIds.has(String(value.assetId))) return undefined;
  const confidence = clamp(Number(value.trackingConfidence) || 0, 0, 1);
  if (confidence < 0.85) return undefined;
  return {
    assetId: String(value.assetId),
    x: clamp(Number(value.x) || 0, 0, 1),
    y: clamp(Number(value.y) || 0, 0, 1),
    width: clamp(Number(value.width) || 0.5, 0.02, 1),
    height: clamp(Number(value.height) || 0.5, 0.02, 1),
    rotateX: clamp(Number(value.rotateX) || 0, -75, 75),
    rotateY: clamp(Number(value.rotateY) || 0, -75, 75),
    rotateZ: clamp(Number(value.rotateZ) || 0, -180, 180),
    skewX: clamp(Number(value.skewX) || 0, -45, 45),
    skewY: clamp(Number(value.skewY) || 0, -45, 45),
    borderRadius: clamp(Number(value.borderRadius) || 0, 0, 80),
    trackingConfidence: confidence,
  };
}

/** Merge a parsed AI plan onto the base plan, keeping the base for anything missing. */
function mergeAiPlan(base: MotionPlan, parsed: any, input: DirectorInput): MotionPlan {
  const validIds = new Set(input.assets.map((a) => a.id));
  const plan: MotionPlan = { ...base };
  if (typeof parsed.title === 'string' && parsed.title.trim()) plan.title = parsed.title.trim().slice(0, 60);

  if (Array.isArray(parsed.camera) && parsed.camera.length >= 2) {
    const cam: CameraKeyframe[] = parsed.camera
      .filter((k: any) => k && Number.isFinite(k.t))
      .map((k: any) => ({
        t: clamp(Number(k.t), 0, base.duration),
        x: clamp(Number(k.x) || 0, -1.5, 1.5),
        y: clamp(Number(k.y) || 0, -1.5, 1.5),
        scale: clamp(Number(k.scale) || 1, 0.7, 1.6),
      }))
      .sort((a: CameraKeyframe, b: CameraKeyframe) => a.t - b.t);
    if (cam.length >= 2) plan.camera = cam;
  }

  if (Array.isArray(parsed.layers) && parsed.layers.length > 0) {
    const layers: AssetLayer[] = [];
    parsed.layers.forEach((l: any) => {
      if (!l) return;
      const requestedKind = String(l.kind || '');
      const generatedKind = requestedKind === 'ai_video' || requestedKind === 'avatar';
      if (generatedKind) {
        if (requestedKind === 'ai_video' && !input.allowAiVideo) return;
        if (requestedKind === 'avatar' && !input.useAvatar) return;
        const prompt = String(l.prompt || '').trim().slice(0, 600);
        if (prompt.length < 12) return;
        const screenAssetId = validIds.has(String(l.screenAssetId)) ? String(l.screenAssetId) : undefined;
        const screenComposite = normalizeScreenComposite(l.screenComposite, validIds);
        layers.push({
          id: uid('l'),
          assetId: '',
          kind: requestedKind as 'ai_video' | 'avatar',
          start: clamp(Number(l.start) || 0, 0, base.duration),
          end: clamp(Number(l.end) || base.duration, 0.5, base.duration),
          worldX: clamp(Number(l.worldX) || 0, -1.5, 1.5),
          worldY: clamp(Number(l.worldY) || 0, -1, 1),
          worldScale: clamp(Number(l.worldScale) || 0.9, 0.3, 1.4),
          rotate: 0,
          entrance: normalizeEntrance(l.entrance),
          entranceDur: 0.8,
          exitDur: 0.6,
          float: normalizeFloat(l.float),
          frameStyle: 'none',
          shadow: true,
          clipUrl: isHttpUrl(l.clipUrl) ? String(l.clipUrl) : undefined,
          prompt,
          screenAssetId,
          screenComposite,
        });
        return;
      }

      if (!validIds.has(String(l.assetId))) return;
      const asset = input.assets.find((a) => a.id === String(l.assetId));
      if (!asset || asset.type === 'reference_video') return;
      layers.push({
        id: uid('l'),
        assetId: String(l.assetId),
        kind: asset.type === 'product' ? 'product' : asset.type === 'logo' ? 'logo' : 'ui',
        start: clamp(Number(l.start) || 0, 0, base.duration),
        end: clamp(Number(l.end) || base.duration, 0.5, base.duration),
        worldX: clamp(Number(l.worldX) || 0, -1.5, 1.5),
        worldY: clamp(Number(l.worldY) || 0, -1, 1),
        worldScale: clamp(Number(l.worldScale) || 0.82, 0.3, 1.4),
        rotate: 0,
        entrance: normalizeEntrance(l.entrance),
        entranceDur: 0.8,
        exitDur: 0.6,
        float: normalizeFloat(l.float),
        frameStyle: asset.type === 'mobile' ? 'device' : asset.type === 'website' ? 'browser' : 'card',
        shadow: true,
      });
    });
    if (input.useAvatar && !layers.some((l) => l.kind === 'avatar')) {
      const baseAvatar = base.layers.find((l) => l.kind === 'avatar');
      if (baseAvatar) layers.push(baseAvatar);
    }
    if (layers.length > 0) plan.layers = layers;
  }

  if (Array.isArray(parsed.text)) {
    const text: TextCue[] = parsed.text
      .filter((t: any) => t && typeof t.content === 'string' && t.content.trim())
      .map((t: any) => ({
        id: uid('t'),
        content: String(t.content).trim().slice(0, 48),
        start: clamp(Number(t.start) || 0, 0, base.duration),
        end: clamp(Number(t.end) || base.duration, 0.5, base.duration),
        anchor: normalizeAnchor(t.anchor),
        level: (t.level === 1 || t.level === 2 || t.level === 3 ? t.level : 2) as TextCue['level'],
        weight: (t.level === 3 ? 800 : t.level === 1 ? 500 : 700) as TextCue['weight'],
        animation: normalizeTextAnim(t.animation),
        align: t.align === 'left' || t.align === 'right' ? t.align : 'center',
        emphasis: !!t.emphasis,
      }));
    if (text.length > 0) plan.text = text;
  }
  return plan;
}

/**
 * Build a Motion Plan for the brief + assets. Always returns a valid plan:
 * the procedural base is enriched by the AI when reachable, then validated.
 */
export async function directMotionPlan(input: DirectorInput): Promise<{ plan: MotionPlan; usedAi: boolean; issues: MotionIssue[] }> {
  const base = buildBasePlan(input);
  const preset = getPreset(input.presetId);

  const user = [
    `Product brief: ${input.brief || '(none given — infer from the screens)'}`,
    `Duration: ${base.duration}s at ${MOTION_FPS}fps. Aspect: ${input.aspect}.`,
    `Preset: ${preset.name}. ${preset.guidance}`,
    input.styleWord ? `Visual style word: ${input.styleWord}.` : '',
    `Reference beat arc to adapt (NOT a fixed template): ${PRODUCT_LAUNCH_ARC}.`,
    input.referenceNotes ? `Reference video notes to take inspiration from (do not copy): ${input.referenceNotes}` : '',
    `AI video permission: ${input.allowAiVideo ? 'ON — one selective ai_video shot is allowed when it materially benefits the story.' : 'OFF — emit no ai_video layers.'}`,
    `Avatar permission: ${input.useAvatar ? 'ON — one short presenter intro or outro is allowed.' : 'OFF — emit no avatar layers.'}`,
    'Assets available (use these exact ids in layers):',
    assetDigest(input.assets.filter((a) => a.type !== 'reference_video')),
    'Design ONE continuous camera move across all screens. Author 3-6 short text cues that build the story (opening title, feature headlines, closing CTA).',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await chat(DIRECTOR_SYSTEM, user, 2000);
  let plan = base;
  let usedAi = false;
  if (raw) {
    const parsed = extractJson(raw);
    if (parsed && typeof parsed === 'object') {
      try {
        plan = mergeAiPlan(base, parsed, input);
        usedAi = true;
      } catch {
        plan = base;
      }
    }
  }
  const result = validateAndRepair(plan, input.assets);
  return { plan: result.plan, usedAi, issues: result.issues };
}

// ---------------------------------------------------------------------------
// AI Edit — natural-language patch of an existing plan
// ---------------------------------------------------------------------------
const EDIT_SYSTEM =
  'You are editing an existing JSON motion plan for a product-launch video. ' +
  'Apply the user instruction by returning the COMPLETE updated motion plan as JSON only (no fences, no prose), ' +
  'in the same shape you were given: {title, duration, camera:[{t,x,y,scale}], layers:[{kind,assetId,prompt,screenAssetId,clipUrl,start,end,worldX,worldY,worldScale,entrance,float}], text:[{content,start,end,anchor,level,animation,align,emphasis}]}. ' +
  'Preserve everything the instruction does not touch. Keep it ONE continuous camera move. ' +
  'NEVER change, redraw or invent UI — layers only reference existing asset ids. Keep text short and spelled exactly. ' +
  'You MUST NOT move, remove or replace any layer whose assetId is in the LOCKED list.';

function planForEditPrompt(plan: MotionPlan): any {
  return {
    title: plan.title,
    duration: plan.duration,
    camera: plan.camera.map((k) => ({ t: k.t, x: k.x, y: k.y, scale: k.scale })),
    layers: plan.layers.map((l) => ({
      kind: l.kind,
      assetId: l.assetId,
      prompt: l.prompt,
      screenAssetId: l.screenAssetId,
      screenComposite: l.screenComposite,
      clipUrl: l.clipUrl,
      start: l.start,
      end: l.end,
      worldX: l.worldX,
      worldY: l.worldY,
      worldScale: l.worldScale,
      entrance: l.entrance,
      float: l.float,
    })),
    text: plan.text.map((t) => ({
      content: t.content,
      start: t.start,
      end: t.end,
      anchor: t.anchor,
      level: t.level,
      animation: t.animation,
      align: t.align,
      emphasis: t.emphasis,
    })),
  };
}

/**
 * Apply a natural-language edit to the plan. Locked assets are never moved or
 * dropped: their layers are restored from the pre-edit plan afterwards. Returns
 * the original plan unchanged if the model is unreachable or returns nonsense.
 */
export async function editMotionPlan(
  plan: MotionPlan,
  instruction: string,
  assets: MotionAsset[],
): Promise<{ plan: MotionPlan; changed: boolean; issues: MotionIssue[] }> {
  const lockedIds = assets.filter((a) => a.locked).map((a) => a.id);
  const user = [
    `Current plan:\n${JSON.stringify(planForEditPrompt(plan))}`,
    `LOCKED asset ids (do not move/remove): ${lockedIds.length ? lockedIds.join(', ') : '(none)'}`,
    `Available asset ids: ${assets.map((a) => a.id).join(', ')}`,
    `Instruction: ${instruction}`,
  ].join('\n\n');

  const raw = await chat(EDIT_SYSTEM, user, 2200);
  if (!raw) return { plan, changed: false, issues: [{ level: 'warning', code: 'ai_unavailable', message: 'The editor is temporarily unavailable — nothing was changed.' }] };
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { plan, changed: false, issues: [{ level: 'warning', code: 'ai_parse', message: 'Could not read that edit — try rephrasing.' }] };
  }

  const input: DirectorInput = {
    brief: '',
    assets,
    presetId: plan.presetId,
    styleWord: plan.styleWord,
    duration: Number.isFinite(parsed.duration) ? clamp(Number(parsed.duration), 5, 60) : plan.duration,
    aspect: plan.aspectRatio,
    allowAiVideo: plan.layers.some((l) => l.kind === 'ai_video'),
    useAvatar: plan.layers.some((l) => l.kind === 'avatar'),
  };
  // Start from a base that carries the plan's brand/background/graphics/audio,
  // then overlay the model's camera/layers/text.
  const base: MotionPlan = { ...plan, duration: input.duration };
  let edited = mergeAiPlan(base, parsed, input);

  // Restore locked layers verbatim from the pre-edit plan.
  if (lockedIds.length) {
    const keptLocked = plan.layers.filter((l) => lockedIds.includes(l.assetId));
    const withoutLocked = edited.layers.filter((l) => !lockedIds.includes(l.assetId));
    edited = { ...edited, layers: [...withoutLocked, ...keptLocked] };
  }

  const result = validateAndRepair(edited, assets);
  return { plan: result.plan, changed: true, issues: result.issues };
}

// ---------------------------------------------------------------------------
// Validation + repair
// ---------------------------------------------------------------------------
/**
 * Repair a plan into a renderable state. Every fix is recorded as an issue so
 * the studio can show what it corrected. This runs before EVERY render and
 * after every AI generate/edit — the renderer never sees an invalid plan.
 */
export function validateAndRepair(plan: MotionPlan, assets: MotionAsset[]): ValidationResult {
  const issues: MotionIssue[] = [];
  const validIds = new Set(assets.map((a) => a.id));
  const duration = clamp(plan.duration || 15, 5, 60);

  // Layers: drop missing assets, clamp windows, fix inverted/negative spans.
  const layers: AssetLayer[] = [];
  (plan.layers || []).forEach((l) => {
    if (l.assetId && !validIds.has(l.assetId)) {
      issues.push({ level: 'warning', code: 'missing_asset', message: `A layer referenced a missing asset and was removed.`, repaired: 'removed' });
      return;
    }
    let start = clamp(l.start, 0, duration);
    let end = clamp(l.end, 0, duration);
    if (end <= start) {
      end = clamp(start + Math.max(2, duration / Math.max(1, plan.layers.length)), start + 1, duration);
      issues.push({ level: 'error', code: 'bad_span', message: 'A layer had a non-positive duration.', repaired: `set to ${start.toFixed(1)}–${end.toFixed(1)}s` });
    }
    layers.push({
      ...l,
      start,
      end,
      worldX: clamp(l.worldX, -1.5, 1.5),
      worldY: clamp(l.worldY, -1, 1),
      worldScale: clamp(l.worldScale, 0.3, 1.4),
      entranceDur: clamp(l.entranceDur || 0.7, 0.15, 2),
      exitDur: clamp(l.exitDur || 0.5, 0.15, 2),
    });
  });
  // A generated device shot without high-confidence tracking keeps the real UI
  // as a normal foreground layer. This is intentionally honest: an untracked
  // perspective replacement would look precise while being wrong.
  layers.slice().forEach((l) => {
    if (l.kind !== 'ai_video' || !l.screenAssetId || l.screenComposite?.trackingConfidence >= 0.85) return;
    const screen = assets.find((a) => a.id === l.screenAssetId && a.type !== 'reference_video');
    const alreadyForeground = layers.some(
      (candidate) =>
        candidate.kind === 'ui' &&
        candidate.assetId === l.screenAssetId &&
        candidate.start < l.end &&
        l.start < candidate.end,
    );
    if (!screen || alreadyForeground) return;
    layers.push({
      id: uid('l'),
      assetId: screen.id,
      kind: 'ui',
      start: l.start,
      end: l.end,
      worldX: clamp(l.worldX + 0.2, -1.5, 1.5),
      worldY: clamp(l.worldY + 0.08, -1, 1),
      worldScale: clamp(l.worldScale * 0.52, 0.3, 1.4),
      rotate: 0,
      entrance: 'scale_in',
      entranceDur: l.entranceDur,
      exitDur: l.exitDur,
      float: 'parallax',
      frameStyle: screen.type === 'mobile' ? 'device' : screen.type === 'website' ? 'browser' : 'card',
      shadow: true,
    });
    issues.push({ level: 'warning', code: 'screen_tracking_unavailable', message: 'Kept the real UI in front because reliable screen tracking was unavailable.' });
  });

  if (layers.length === 0 && assets.some((a) => a.type !== 'logo' && a.type !== 'reference_video')) {
    issues.push({ level: 'error', code: 'no_layers', message: 'No usable layers — rebuilt from assets.' });
  }

  // Camera: sort, clamp, ensure it spans [0, duration] and has >= 2 keys.
  let camera: CameraKeyframe[] = (plan.camera || [])
    .filter((k) => k && Number.isFinite(k.t))
    .map((k) => ({ t: clamp(k.t, 0, duration), x: clamp(k.x, -1.5, 1.5), y: clamp(k.y, -1.5, 1.5), scale: clamp(k.scale, 0.7, 1.6), rotate: k.rotate }))
    .sort((a, b) => a.t - b.t);
  if (camera.length < 2) {
    camera = [
      { t: 0, x: 0, y: 0, scale: 0.95 },
      { t: duration, x: 0, y: 0, scale: 1.1 },
    ];
    issues.push({ level: 'error', code: 'camera', message: 'Camera path was empty — a gentle push was added.' });
  } else {
    if (camera[0].t > 0.01) camera.unshift({ ...camera[0], t: 0 });
    if (camera[camera.length - 1].t < duration - 0.01) camera.push({ ...camera[camera.length - 1], t: duration });
    // Guard against a big scale jump that would read as a camera reset.
    for (let i = 1; i < camera.length; i++) {
      const dScale = Math.abs(camera[i].scale - camera[i - 1].scale);
      const dt = camera[i].t - camera[i - 1].t;
      if (dScale > 0.5 && dt < 0.4) {
        camera[i].scale = camera[i - 1].scale + Math.sign(camera[i].scale - camera[i - 1].scale) * 0.5;
        issues.push({ level: 'warning', code: 'camera_jump', message: 'Softened an abrupt camera zoom.', repaired: 'clamped' });
      }
    }
  }

  // Text: clamp windows, keep inside the safe area, avoid two hero cues overlapping.
  const text: TextCue[] = [];
  (plan.text || []).forEach((t) => {
    if (!t.content || !t.content.trim()) return;
    let start = clamp(t.start, 0, duration);
    let end = clamp(t.end, 0, duration);
    if (end <= start) {
      end = clamp(start + 2.2, start + 0.8, duration);
      issues.push({ level: 'error', code: 'text_span', message: 'A caption had a non-positive duration.', repaired: `set to ${start.toFixed(1)}–${end.toFixed(1)}s` });
    }
    let content = t.content.trim();
    if (content.length > 48) {
      content = content.slice(0, 48);
      issues.push({ level: 'warning', code: 'text_overflow', message: 'A caption was trimmed to fit the safe area.', repaired: 'trimmed' });
    }
    text.push({ ...t, content, start, end, x: t.x, y: t.y });
  });
  // Two large (level 3) cues on screen at once, in the same anchor, collide.
  for (let i = 0; i < text.length; i++) {
    for (let j = i + 1; j < text.length; j++) {
      const a = text[i];
      const b = text[j];
      const overlap = a.start < b.end && b.start < a.end;
      if (overlap && a.level >= 3 && b.level >= 3 && a.anchor === b.anchor) {
        b.anchor = a.anchor === 'center' ? 'bottom' : 'center';
        issues.push({ level: 'warning', code: 'text_collision', message: 'Two headlines overlapped — one was repositioned.', repaired: 'moved' });
      }
    }
  }

  const repaired: MotionPlan = {
    ...plan,
    version: MOTION_PLAN_VERSION,
    duration,
    fps: MOTION_FPS,
    camera,
    layers: layers.length > 0 ? layers : plan.layers,
    text,
    audio: plan.audio || { volume: 0.6, muted: false },
    graphics: Array.isArray(plan.graphics) ? plan.graphics : [],
  };
  const ok = !issues.some((i) => i.level === 'error');
  return { plan: repaired, issues, ok };
}

// ---------------------------------------------------------------------------
// Reference video analysis (optional, best-effort)
// ---------------------------------------------------------------------------
const REFERENCE_SYSTEM =
  'You distill a reference video description into motion direction. Given notes about a reference video, ' +
  'reply with 2-3 short sentences capturing its pacing, camera style, transition style, typography feel and rhythm — ' +
  'as inspiration for an ORIGINAL plan, never to copy frame-for-frame. Plain text only.';

export async function distillReferenceNotes(rawNotes: string): Promise<string> {
  const trimmed = (rawNotes || '').trim();
  if (!trimmed) return '';
  const out = await chat(REFERENCE_SYSTEM, trimmed, 300);
  return (out || trimmed).trim().slice(0, 400);
}
