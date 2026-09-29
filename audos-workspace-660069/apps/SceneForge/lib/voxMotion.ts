// VOX MOTION — Vox-style layered motion graphics produced from ONE scene
// still. Used by the batch generator when the customer flips the batch
// output toggle to "Motion Graphic" (App.tsx): instead of shipping a static
// still, an image scene becomes a layered, animated motion graphic.
//
//   1. READ — the same single model behind the whole pipeline (a vision task,
//      exactly like lib/visualQa) looks at the finished scene still and names
//      its distinct visual elements: the environment, the foreground
//      subjects, an optional accent detail, plus the headline worth saying.
//   2. ISOLATE — each element becomes its own generated asset: the platform
//      image endpoint (/api/veo/generate/image, gemini-3.1-flash-image)
//      redraws it as an isolated cutout using the ORIGINAL still as the
//      image-to-image reference, so every layer stays consistent with the
//      scene the customer approved.
//   3. ANIMATE — the layers are composed into an SVG and animated with the
//      same GSAP vocabulary the motion engine uses — staggered spring
//      entrances, depth-proportional parallax drift, ambient float, a slow
//      camera push, an animated headline — then captured to a real clip by
//      the shared recorder (lib/motionCapture.recordSvgTimeline).
//
// The finished clip lands on scene.render_url; the source still is kept on
// the scene's overlay assetUrl as its poster/fallback, so a failed or stale
// animation never costs the scene its picture (the scene stays settled as an
// image scene either way).

import { gsap } from 'https://esm.sh/gsap@3.12.5';
import { claudeVisionJson, uploadFile, workspaceToken } from './proxy';
import { SVG_NS, THEME, el, motionThemeForStyle, setMotionTheme, textBlock, wrapLines } from './motionKit';
import { enqueueCapture, recordSvgTimeline, sceneMotionDuration } from './motionCapture';
import { isVideoUrl } from './sceneState';
import { updateScene, type Project, type Scene } from './supabase';

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_CUTOUTS = 3;
const IMAGE_ENDPOINT = '/api/veo/generate/image';
const ELEMENT_IMAGE_MODEL = 'gemini-3.1-flash-image';

export type VoxRole = 'background' | 'midground' | 'foreground' | 'accent';
export type VoxEntrance = 'rise' | 'slide_left' | 'slide_right' | 'pop' | 'fade_drift';

export interface VoxElement {
  name: string;
  role: VoxRole;
  /** Image-generation prompt for the isolated element asset. */
  prompt: string;
  /** 0 = far background … 1 = nearest foreground; drives parallax amount. */
  depth: number;
  entrance: VoxEntrance;
  /** Placement as fractions of the frame (cutouts only). */
  x: number;
  y: number;
  /** Fraction of frame width the cutout occupies. */
  scale: number;
}

export interface VoxScenePlan { headline: string; subline?: string; elements: VoxElement[] }
export interface VoxLayerAsset { element: VoxElement; imageUrl: string }
export interface VoxMotionResult { videoUrl: string; fingerprint: string; reused: boolean; layers: number }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Number(value) || 0));

/** Stable fingerprint for a scene's Vox animation: same still + same copy +
 * same window length ⇒ the stored clip is reused instead of re-billed. Keeps
 * the 'mg:' prefix so the rest of the app recognizes it as a capture marker,
 * never as an AI-video prompt. */
export function voxSceneFingerprint(scene: Scene, stillUrl: string): string {
  const seed = `${stillUrl}|${String(scene.description || '')}|${sceneMotionDuration(scene).toFixed(1)}`;
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  return `mg:vox-${hash.toString(36)}:${seed.length.toString(36)}`;
}

export const hasFreshVoxClip = (scene: Scene, stillUrl: string) => isVideoUrl(scene.render_url) && String(scene.video_prompt || '') === voxSceneFingerprint(scene, stillUrl);

/** Fetch + downscale an image to a small JPEG for the vision call and the
 * image-to-image reference. Returns base64 WITHOUT the data: prefix. */
async function downscaledJpegBase64(url: string, maxEdge = 768): Promise<string> {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`The scene still could not be loaded for analysis (HTTP ${response.status}).`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.78).split(',')[1] || '';
}

/** Inline any image reference as a data: URL so the SVG rasterizes with it
 * (the capture path loads no external resources). Data URLs pass through. */
async function toInlineDataUrl(url: string): Promise<string> {
  if (/^data:image\//i.test(url)) return url;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return '';
    const blob = await response.blob();
    return await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => resolve(''); reader.readAsDataURL(blob); });
  } catch { return ''; }
}

const VOX_PLAN_SYSTEM = "You are SceneForge's motion director — the same single model behind the whole pipeline, here running its layer-decomposition task: you read ONE rendered scene still and break it into the distinct visual elements a Vox-style layered motion graphic needs. You never invent content that is not in the image or the scene description.";

const ENTRANCES: VoxEntrance[] = ['rise', 'slide_left', 'slide_right', 'pop', 'fade_drift'];
const ROLES: VoxRole[] = ['background', 'midground', 'foreground', 'accent'];

function normalizeVoxPlan(raw: any, scene: Scene): VoxScenePlan {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fallbackHeadline = String(scene.overlay_config?.text || scene.description || '').split(/[.!?]/)[0]?.trim().slice(0, 60) || '';
  const elements: VoxElement[] = (Array.isArray(source.elements) ? source.elements : []).map((entry: any, index: number): VoxElement | null => {
    if (!entry || typeof entry !== 'object') return null;
    const prompt = String(entry.prompt || entry.description || '').trim();
    if (!prompt) return null;
    const role = ROLES.includes(entry.role) ? entry.role as VoxRole : (index === 0 ? 'background' : 'foreground');
    return {
      name: String(entry.name || `element ${index + 1}`).slice(0, 60),
      role,
      prompt: prompt.slice(0, 500),
      depth: clamp(entry.depth, 0, 1) || (role === 'background' ? 0.1 : 0.7),
      entrance: ENTRANCES.includes(entry.entrance) ? entry.entrance as VoxEntrance : ENTRANCES[index % ENTRANCES.length],
      x: clamp(entry.x, 0.12, 0.88) || 0.5,
      y: clamp(entry.y, 0.16, 0.78) || 0.48,
      scale: clamp(entry.scale, 0.22, 0.55) || 0.34,
    };
  }).filter(Boolean) as VoxElement[];
  // One background at most; cutouts capped so the wallet is bounded.
  const background = elements.find((element) => element.role === 'background') || null;
  const cutouts = elements.filter((element) => element.role !== 'background').slice(0, MAX_CUTOUTS);
  // Spread colliding cutouts so layers never stack on one spot.
  if (cutouts.length > 1) {
    const sorted = [...cutouts].sort((a, b) => a.x - b.x);
    const collides = sorted.some((element, index) => index > 0 && Math.abs(element.x - sorted[index - 1].x) < 0.2);
    if (collides) sorted.forEach((element, index) => { element.x = clamp(0.2 + index * (0.6 / Math.max(1, sorted.length - 1)), 0.14, 0.86); });
  }
  return {
    headline: String(source.headline || fallbackHeadline).trim().slice(0, 60),
    subline: String(source.subline || '').trim().slice(0, 90) || undefined,
    elements: [...(background ? [background] : []), ...cutouts],
  };
}

/** Task 1 — READ: the vision pass that decomposes the still into elements. */
export async function planVoxSceneElements(scene: Scene, stillBase64: string, model?: string): Promise<VoxScenePlan> {
  const task = [
    `Identify the distinct visual elements of this scene image for a layered Vox-style motion graphic: exactly one 'background' element (the environment with the main subjects removed) and 1-${MAX_CUTOUTS} cutout elements (role 'foreground', 'midground' or 'accent') — the subjects or objects that should enter the frame separately.`,
    "For each element write 'prompt': an image-generation prompt describing EXACTLY what appears in the reference image (subject, colors, materials, lighting) so a regenerated asset stays visually consistent with it.",
    "Give each cutout a screen position (x, y as fractions of the frame; keep y below 0.16 and above 0.78 free — title and caption bands), a size ('scale', fraction of frame width, 0.22-0.55), a 'depth' (0 = far background, 1 = nearest foreground; drives parallax), and an 'entrance': one of 'rise' | 'slide_left' | 'slide_right' | 'pop' | 'fade_drift'.",
    "Also return 'headline' — a short punchy on-screen headline (max 60 characters) grounded in the scene description, copied language, never invented facts — and an optional 'subline' (max 90 characters).",
    `Scene description for grounding: ${String(scene.description || '').slice(0, 300)}`,
    'Return strict JSON only: {"headline":string,"subline"?:string,"elements":[{"name":string,"role":"background"|"midground"|"foreground"|"accent","prompt":string,"depth":number,"entrance":string,"x":number,"y":number,"scale":number}]}.',
  ].join(' ');
  const raw = await claudeVisionJson<any>(VOX_PLAN_SYSTEM, task, [{ data: stillBase64, mediaType: 'image/jpeg' }], model, 1600, 90_000);
  const plan = normalizeVoxPlan(raw, scene);
  if (!plan.elements.length) throw new Error(`Scene ${scene.scene_index}: the layer decomposition found no usable elements.`);
  return plan;
}

/** Task 2 — ISOLATE: one generated asset per element, image-to-image against
 * the original still so every layer keeps the approved scene's look. */
async function generateElementImage(prompt: string, aspectRatio: '1:1' | '16:9' | '9:16', editBase64?: string): Promise<string> {
  const response = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({ model: ELEMENT_IMAGE_MODEL, prompt, aspectRatio, ...(editBase64 ? { editImageData: editBase64 } : {}) }),
  });
  const data = await response.json().catch(() => ({}));
  const url = String(data.imageUrl || data.url || '');
  if (!response.ok || !url) throw new Error(String(data.error || `Element asset generation failed (HTTP ${response.status}).`));
  return url;
}

function isolationPrompt(element: VoxElement): string {
  if (element.role === 'background') {
    return `${element.prompt}. The scene's environment and backdrop only, with the main foreground subjects removed — keep the reference image's exact palette, lighting and mood. Full-frame composition. No text, no lettering, no logos, no watermark.`;
  }
  return `${element.prompt}. One isolated cutout element extracted from the reference image: the ${element.name} alone, centered with generous margin, on a plain solid #F4F1EA studio background, keeping the reference image's exact appearance, palette and lighting. No text, no lettering, no logos, no watermark, no additional objects.`;
}

export async function generateVoxLayerAssets(project: Project, plan: VoxScenePlan, stillBase64: string): Promise<VoxLayerAsset[]> {
  const aspect: '16:9' | '9:16' = project.aspect_ratio === '9:16' ? '9:16' : '16:9';
  const results = await Promise.all(plan.elements.map(async (element): Promise<VoxLayerAsset | null> => {
    try {
      const url = await generateElementImage(isolationPrompt(element), element.role === 'background' ? aspect : '1:1', stillBase64);
      return { element, imageUrl: url };
    } catch (error) {
      // A missing layer degrades the composition, never the scene.
      console.warn(`[SceneForge] Vox element "${element.name}" could not be generated — animating without it.`, error);
      return null;
    }
  }));
  return results.filter(Boolean) as VoxLayerAsset[];
}

function imageLayer(parent: SVGElement, href: string, attrs: Record<string, string | number>): SVGImageElement {
  const node = el<SVGImageElement>('image', attrs, parent);
  node.setAttribute('href', href);
  node.setAttributeNS(XLINK_NS, 'xlink:href', href);
  return node;
}

/** Task 3 — ANIMATE: compose the layers into an SVG, drive them with GSAP
 * (staggered entrances, parallax, ambient float, camera push, animated
 * headline) and record the result to a WebM through the shared recorder. */
export async function recordVoxLayeredClip(project: Project, scene: Scene, plan: VoxScenePlan, layers: VoxLayerAsset[], stillUrl: string, onProgress?: (fraction: number) => void): Promise<Blob> {
  const portrait = project.aspect_ratio === '9:16';
  const W = portrait ? 1080 : 1920;
  const H = portrait ? 1920 : 1080;
  const u = Math.min(W, H) / 1080;
  const total = sceneMotionDuration(scene);
  setMotionTheme(motionThemeForStyle(project.style));
  const paper = THEME.paper;

  // Inline every layer image; the background falls back to the original still.
  const backgroundLayer = layers.find((layer) => layer.element.role === 'background') || null;
  const cutoutLayers = layers.filter((layer) => layer.element.role !== 'background');
  const backgroundHref = (backgroundLayer ? await toInlineDataUrl(backgroundLayer.imageUrl) : '') || await toInlineDataUrl(stillUrl);
  if (!backgroundHref) throw new Error(`Scene ${scene.scene_index}: no background image could be inlined for the animation.`);
  const cutouts = (await Promise.all(cutoutLayers.map(async (layer) => ({ layer, href: await toInlineDataUrl(layer.imageUrl) })))).filter((entry) => entry.href);

  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, 'xmlns:xlink': XLINK_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  const defs = el('defs', {}, svg);
  const shadow = el('filter', { id: 'vox-shadow', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
  el('feDropShadow', { dx: 0, dy: 12 * u, stdDeviation: 20 * u, 'flood-color': '#000000', 'flood-opacity': paper ? 0.28 : 0.5 }, shadow);
  el('rect', { x: 0, y: 0, width: W, height: H, fill: THEME.bg }, svg);
  const root = el('g', {}, svg);

  // Background: over-scanned so the slow camera drift never shows an edge.
  const over = 1.16;
  const bg = imageLayer(root, backgroundHref, { x: -(W * (over - 1)) / 2, y: -(H * (over - 1)) / 2, width: W * over, height: H * over, preserveAspectRatio: 'xMidYMid slice', opacity: 0 });
  // Scrim keeps cutouts and the headline legible over any backdrop.
  el('rect', { x: 0, y: 0, width: W, height: H, fill: paper ? 'rgba(242,237,228,0.2)' : 'rgba(4,8,18,0.38)' }, root);

  // Cutout cards — paper-cut tiles in the Vox theme, glass cards in midnight.
  const cardGroups: { group: SVGGElement; element: VoxElement }[] = [];
  cutouts.forEach(({ layer, href }, index) => {
    const element = layer.element;
    const w = clamp(element.scale, 0.22, 0.55) * W;
    const h = w;
    const cx = clamp(element.x, 0.12, 0.88) * W;
    const cy = clamp(element.y, 0.16, 0.72) * H;
    const group = el<SVGGElement>('g', { opacity: 0 }, root);
    const clipId = `vox-clip-${scene.scene_index}-${index}`;
    const clip = el('clipPath', { id: clipId }, defs);
    const radius = paper ? 10 * u : 26 * u;
    el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: radius }, clip);
    el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: radius, fill: paper ? '#FAF7F0' : THEME.panel, stroke: paper ? 'rgba(26,26,26,0.35)' : 'rgba(255,255,255,0.3)', 'stroke-width': 5 * u, filter: 'url(#vox-shadow)' }, group);
    imageLayer(group, href, { x: cx - w / 2, y: cy - h / 2, width: w, height: h, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${clipId})` });
    cardGroups.push({ group, element });
  });

  // Headline block — accent bar + wrapped display text on a soft backing.
  const accent = THEME.accentOverride || '#3B82F6';
  const headline = plan.headline;
  const headGroup = el<SVGGElement>('g', { opacity: 0 }, root);
  let accentBar: SVGElement | null = null;
  if (headline) {
    const size = portrait ? 62 * u : 68 * u;
    const maxChars = portrait ? 18 : 30;
    const lines = wrapLines(headline, maxChars, 2);
    const subSize = Math.round(size * 0.44);
    const subLines = plan.subline ? wrapLines(plan.subline, Math.round(maxChars * 1.6), 2) : [];
    const lineH = size * 1.14;
    const blockH = lines.length * lineH + (subLines.length ? subLines.length * subSize * 1.3 + 14 * u : 0);
    const hx = W * 0.06;
    const hy = (portrait ? H * 0.79 : H * 0.76) - blockH;
    const longest = Math.max(...lines.map((line) => line.length), 1);
    const backW = Math.min(W * 0.88, longest * size * 0.6 + 70 * u);
    el('rect', { x: hx - 20 * u, y: hy - 18 * u, width: backW, height: blockH + 40 * u, rx: paper ? 6 * u : 18 * u, fill: paper ? 'rgba(250,247,240,0.94)' : 'rgba(8,12,24,0.78)', stroke: paper ? 'rgba(26,26,26,0.28)' : 'rgba(255,255,255,0.16)', 'stroke-width': 2 * u }, headGroup);
    accentBar = el('rect', { x: hx - 20 * u, y: hy - 18 * u, width: 10 * u, height: blockH + 40 * u, fill: accent }, headGroup);
    textBlock(headGroup, hx + 16 * u, hy + size * 0.86, headline, { size, weight: 800, fill: paper ? THEME.ink : '#FFFFFF', maxChars, maxLines: 2, lineHeight: 1.14 });
    if (subLines.length) textBlock(headGroup, hx + 16 * u, hy + lines.length * lineH + subSize * 1.1, String(plan.subline), { size: subSize, weight: 500, fill: paper ? THEME.inkSoft : 'rgba(255,255,255,0.88)', maxChars: Math.round(maxChars * 1.6), maxLines: 2, lineHeight: 1.3 });
  }

  // THE DIRECTION: camera push, background drift, staggered layer entrances
  // with parallax and ambient float, then the headline.
  const tl = gsap.timeline({ paused: true });
  tl.to(bg, { opacity: 1, duration: 0.55, ease: 'power2.out' }, 0);
  tl.fromTo(bg, { scale: 1, transformOrigin: '50% 50%' }, { scale: 1.07, x: -W * 0.015, duration: total, ease: 'none' }, 0);
  tl.fromTo(root, { scale: 1, transformOrigin: '50% 55%' }, { scale: 1.045, duration: total, ease: 'none' }, 0);
  const reveal = Math.max(1.1, total * 0.55);
  const stagger = cardGroups.length ? Math.min(0.85, reveal / cardGroups.length) : 0;
  cardGroups.forEach(({ group, element }, index) => {
    const at = 0.5 + index * stagger;
    if (element.entrance === 'slide_left') tl.fromTo(group, { opacity: 0, x: -W * 0.12 }, { opacity: 1, x: 0, duration: 0.7, ease: 'back.out(1.4)' }, at);
    else if (element.entrance === 'slide_right') tl.fromTo(group, { opacity: 0, x: W * 0.12 }, { opacity: 1, x: 0, duration: 0.7, ease: 'back.out(1.4)' }, at);
    else if (element.entrance === 'pop') tl.fromTo(group, { opacity: 0, scale: 0.55, transformOrigin: `${element.x * 100}% ${element.y * 100}%` }, { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.9)' }, at);
    else if (element.entrance === 'fade_drift') tl.fromTo(group, { opacity: 0, y: -34 * u }, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, at);
    else tl.fromTo(group, { opacity: 0, y: 70 * u, scale: 0.88, transformOrigin: `${element.x * 100}% ${element.y * 100}%` }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(1.6)' }, at);
    // Parallax: nearer layers travel further; ambient float keeps holds alive.
    tl.to(group, { x: `+=${(element.depth - 0.35) * W * 0.05}`, duration: Math.max(0.5, total - at), ease: 'none' }, at);
    tl.to(group, { y: `+=${(6 + element.depth * 6) * u}`, duration: 2 + index * 0.35, ease: 'sine.inOut', yoyo: true, repeat: -1 }, at + 0.75);
  });
  if (headline) {
    const headAt = Math.min(0.4, total * 0.12);
    tl.fromTo(headGroup, { opacity: 0, y: 46 * u }, { opacity: 1, y: 0, duration: 0.7, ease: 'back.out(1.4)' }, headAt);
    if (accentBar) tl.fromTo(accentBar, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.6, ease: 'power3.out' }, headAt + 0.15);
  }

  return recordSvgTimeline({ svg, timeline: tl }, W, H, total, { background: THEME.bg, onProgress });
}

export interface VoxProduceOptions { model?: string; force?: boolean; onNote?: (note: string) => void; onProgress?: (fraction: number) => void }

/**
 * Produce (or reuse) the Vox layered motion clip for one image scene: read →
 * isolate → animate → upload → persist. The clip lands on render_url with its
 * fingerprint in video_prompt, and the source still is kept on the overlay's
 * assetUrl so the scene remains settled (and recoverable) as an image scene.
 */
export async function produceVoxMotionScene(project: Project, scene: Scene, stillUrl: string, options: VoxProduceOptions = {}): Promise<VoxMotionResult> {
  if (!stillUrl) throw new Error(`Scene ${scene.scene_index} has no still to animate yet.`);
  const fingerprint = voxSceneFingerprint(scene, stillUrl);
  if (!options.force && isVideoUrl(scene.render_url) && String(scene.video_prompt || '') === fingerprint) {
    return { videoUrl: String(scene.render_url), fingerprint, reused: true, layers: 0 };
  }
  const stillBase64 = await downscaledJpegBase64(stillUrl);
  options.onNote?.(`Scene ${scene.scene_index}: reading the still to identify its visual elements…`);
  const plan = await planVoxSceneElements(scene, stillBase64, options.model);
  options.onNote?.(`Scene ${scene.scene_index}: generating ${plan.elements.length} isolated element asset${plan.elements.length === 1 ? '' : 's'}…`);
  const layers = await generateVoxLayerAssets(project, plan, stillBase64);
  options.onNote?.(`Scene ${scene.scene_index}: animating ${Math.max(1, layers.length)} layer${layers.length === 1 ? '' : 's'} — keep this tab visible while the clip records`);
  const blob = await enqueueCapture(() => recordVoxLayeredClip(project, scene, plan, layers, stillUrl, options.onProgress));
  const file = new File([blob], `scene-${scene.scene_index}-vox-motion.webm`, { type: 'video/webm' });
  const uploaded = await uploadFile(file, `sceneforge-v2/${project.id}/motion`);
  await updateScene(scene.id, { render_url: uploaded.url, video_prompt: fingerprint, status: 'ready', overlay_config: { ...(scene.overlay_config || {}), assetUrl: stillUrl } }, scene.project_id);
  return { videoUrl: uploaded.url, fingerprint, reused: false, layers: layers.length };
}
