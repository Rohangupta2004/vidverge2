/**
 * VidVerge — the agentic video system: SMART INPUT ROUTING.
 *
 * Whatever the visitor hands over is read BEFORE the director is asked to plan,
 * because what they gave us is stronger evidence than anything a model can
 * infer from prose:
 *
 *   SCREENSHOT UPLOADED   → it becomes a named UI state, and the production
 *                           routes to UI Motion. We animate the real screen.
 *   URL PASTED            → fetch the page's own images (og:image, hero shots)
 *                           and read the copy into a product brief. Screenshot-
 *                           shaped images become UI states; the rest become
 *                           product references.
 *   CHARACTER PHOTO       → read with vision into a CHARACTER_MASTER that then
 *                           chains through every scene of the production.
 *   NOTHING PROVIDED      → the system generates its own references first:
 *                           script → detect character/environment/prop → draw
 *                           each one → use those as the basis for every shot.
 *
 * EVERYTHING HERE IS BEST-EFFORT. A page that cannot be read, vision that is
 * unavailable, an image endpoint having a moment — none of them stop a
 * production. Each function returns what it managed to get and the caller
 * carries on with less.
 */
import {
  CHARACTER_VISION_PROMPT,
  describeImage,
  describeProductImage,
  extractJson,
  fetchWebsiteBrief,
  fetchWebsiteImages,
} from './studioApi';
import { clampText, type AspectRatio } from './videoTypes';
import { detectReferences } from './agenticAgents';
import { drawReference } from './agenticEngines';
import {
  buildCharacterMaster,
  buildProductMaster,
  makeEnvironment,
  makeObject,
  withFullBodyReference,
} from './agenticMemory';
import type {
  CharacterMaster,
  ProductMaster,
  ProductionInputs,
  ProductionMemory,
  ResolvedMode,
  StoryPlan,
  UIState,
} from './agenticTypes';

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

// ---------------------------------------------------------------------------
// A screenshot → a named UI state
// ---------------------------------------------------------------------------
const UI_STATE_PROMPT =
  'You are cataloguing a screenshot of a software product so an animation can be built from it. Respond with ' +
  'ONLY valid JSON, no markdown fences: {"id": string, "label": string, "description": string, ' +
  '"elements": [string], "accent": string}. "id" is a short stable snake_case identifier for THIS screen, e.g. ' +
  '"dashboard", "analysis_page", "weak_topics_expanded" — derived from what the screen actually is. "label" is ' +
  'the same thing in two or three human words. "description" is one or two sentences on what is on the screen ' +
  'and what a user would do next from it. "elements" is up to four of the most visually prominent things on the ' +
  'screen, named in plain words ("score header", "weak topic card", "revenue chart"). "accent" is the ' +
  'interface\'s dominant accent colour as a hex value. Never mention that this is a screenshot.';

export interface ScreenRead {
  state: UIState;
  /** The elements the Motion Agent can animate, as a head start. */
  elements: string[];
  accentHex: string;
}

/**
 * Read one product screenshot into a UI state. The id it returns is what the
 * shot list references as `from_ui_state` / `to_ui_state`, so it has to be
 * stable and derived from the screen itself rather than from upload order.
 */
export async function readScreenshot(imageUrl: string, fallbackIndex = 1): Promise<ScreenRead | null> {
  if (!isHttpUrl(imageUrl)) return null;
  const fallback = (): ScreenRead => ({
    state: {
      id: `screen_${String(fallbackIndex).padStart(2, '0')}`,
      label: `Screen ${fallbackIndex}`,
      imageUrl,
      description: 'A screen from the product.',
    },
    elements: [],
    accentHex: '',
  });
  try {
    const parsed = extractJson(await describeImage(imageUrl, UI_STATE_PROMPT));
    if (!parsed || typeof parsed !== 'object') return fallback();
    const rawId = String(parsed.id || '').trim();
    const id = rawId
      ? rawId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
      : `screen_${String(fallbackIndex).padStart(2, '0')}`;
    const accent = String(parsed.accent || '').trim();
    return {
      state: {
        id: id || `screen_${String(fallbackIndex).padStart(2, '0')}`,
        label: clampText(String(parsed.label || id), 40),
        imageUrl,
        description: clampText(String(parsed.description || ''), 300),
      },
      elements: (Array.isArray(parsed.elements) ? parsed.elements : [])
        .slice(0, 4)
        .map((e: unknown) => clampText(String(e), 50))
        .filter(Boolean),
      accentHex: /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : '',
    };
  } catch (e) {
    console.warn('[Agentic] could not read the screenshot; using a generic UI state:', e);
    return fallback();
  }
}

/**
 * Is this image a SCREEN or a photograph? Scraped pages return both, and the
 * two are used completely differently: a screen becomes a UI state Remotion
 * animates, a photo becomes a product reference Veo matches against. The read
 * is a filename/aspect heuristic first (free) and vision is never spent on it.
 */
function looksLikeScreenshot(url: string, alt: string): boolean {
  return /screenshot|screen[-_.]|dashboard|app[-_]?ui|product[-_]?ui|interface|console|admin|analytics/i.test(
    `${url} ${alt}`,
  );
}

// ---------------------------------------------------------------------------
// A URL → brief + images + UI states
// ---------------------------------------------------------------------------
export interface UrlRead {
  brief: string;
  productName: string;
  tagline: string;
  uiStates: UIState[];
  productImageUrls: string[];
  productMaster: ProductMaster | null;
  /** True when the page genuinely could not be read. */
  failed: boolean;
}

/**
 * READ THE PAGE. The scrape and the image fetch run together because they are
 * independent and both slow, and the brief is assembled from whichever of them
 * answered. Images that look like product screens become UI states (which is
 * what makes "paste a SaaS URL" resolve to UI Motion without an upload); the
 * rest become product references.
 *
 * Only the FIRST two screen-shaped images are read with vision — a page can
 * return eight images and reading all of them would cost eight vision calls
 * before a single shot is planned.
 */
export async function readUrl(url: string, aspect: AspectRatio): Promise<UrlRead> {
  const [brief, images] = await Promise.all([fetchWebsiteBrief(url), fetchWebsiteImages(url)]);
  const screens = images.filter((img) => looksLikeScreenshot(img.url, img.alt || ''));
  const photos = images.filter((img) => screens.indexOf(img) === -1);

  const uiStates: UIState[] = [];
  for (let i = 0; i < Math.min(2, screens.length); i++) {
    const read = await readScreenshot(screens[i].url, i + 1);
    if (read) uiStates.push(read.state);
  }

  const name = (brief && brief.name) || '';
  const tagline = (brief && brief.tagline) || '';
  const features = (brief && brief.features) || '';
  const briefText = [name && `${name}.`, tagline, features].filter(Boolean).join(' ');

  const productImageUrls = photos.slice(0, 3).map((p) => p.url);
  return {
    brief: clampText(briefText, 1200),
    productName: name,
    tagline,
    uiStates,
    productImageUrls,
    productMaster:
      name || productImageUrls.length > 0 || uiStates.length > 0
        ? buildProductMaster({
            name: name || 'the product',
            tagline,
            screenshots: productImageUrls,
            uiStates,
            brandRules: brief ? clampText(brief.tone, 200) : '',
          })
        : null,
    failed: !brief && images.length === 0,
  };
}

// ---------------------------------------------------------------------------
// A character photo → CHARACTER_MASTER
// ---------------------------------------------------------------------------
/**
 * Read an uploaded photo into a CHARACTER_MASTER. The uploaded image becomes
 * the face reference and vision writes the description, so the same person is
 * carried both as pixels and as words — which matters, because a safety filter
 * that refuses the photo still leaves the written half working.
 */
export async function readCharacterPhoto(imageUrl: string): Promise<CharacterMaster | null> {
  if (!isHttpUrl(imageUrl)) return null;
  try {
    const description = await describeImage(imageUrl, CHARACTER_VISION_PROMPT);
    if (!description.trim()) return null;
    return buildCharacterMaster({
      name: 'The lead',
      description,
      faceReference: imageUrl,
    });
  } catch (e) {
    console.warn('[Agentic] could not read the character photo:', e);
    // The photo is still worth carrying even unread: it is the identity
    // reference on every shot, and the written half can stay generic.
    return buildCharacterMaster({
      name: 'The lead',
      description: 'The person shown in the uploaded reference photo, unchanged in every shot.',
      faceReference: imageUrl,
    });
  }
}

/** Read an uploaded product image into a brief and a visual reference line. */
export async function readProductImage(imageUrl: string): Promise<{ brief: string; visualReference: string }> {
  const read = await describeProductImage(imageUrl);
  if (!read) return { brief: '', visualReference: '' };
  return {
    brief: clampText([read.brief.name, read.brief.tagline, read.brief.features].filter(Boolean).join(' '), 1000),
    visualReference: read.visualReference,
  };
}

// ---------------------------------------------------------------------------
// Nothing provided → the system draws its own references first
// ---------------------------------------------------------------------------
export interface SelfReferenceResult {
  memory: ProductionMemory;
  /** What was drawn, for the plan screen's "references" row. */
  drawn: { kind: string; label: string; url: string }[];
}

/**
 * THE NO-INPUT PATH, in four steps, exactly in this order:
 *
 *   1. read the script,
 *   2. detect the character, the environments and the props that recur,
 *   3. DRAW a reference image for each one,
 *   4. hand them to the router as the basis for every shot.
 *
 * Step 3 is where the money goes, so it is capped hard: one character, one
 * environment per chapter up to three, and one prop. That is enough to hold a
 * five-minute piece together, and it is a fraction of one clip's cost.
 *
 * An environment that could not be drawn is still KEPT as a written reference:
 * the router can point a shot at a description even when it has no plate, and
 * that is strictly better than the shot having no anchor at all.
 */
export async function buildSelfReferences(input: {
  plan: StoryPlan;
  mode: ResolvedMode;
  memory: ProductionMemory;
  inputs: ProductionInputs;
  aspect: AspectRatio;
  onProgress?: (message: string) => void;
  isAborted?: () => boolean;
}): Promise<SelfReferenceResult> {
  const drawn: { kind: string; label: string; url: string }[] = [];
  let memory = input.memory;
  const look = input.plan.look || memory.anchors.style;

  if (input.onProgress) input.onProgress('Reading the script for what has to stay consistent…');
  const detected = await detectReferences({
    plan: input.plan,
    mode: input.mode,
    character: input.inputs.character,
  });
  if (input.isAborted && input.isAborted()) return { memory, drawn };

  // ---- The character ----
  if (memory.characterMasters.length === 0 && detected.characters.length > 0) {
    const detectedCharacter = detected.characters[0];
    if (input.onProgress) input.onProgress(`Designing ${detectedCharacter.name}…`);
    const url = await drawReference({
      kind: 'character',
      description: detectedCharacter.description,
      look,
      aspect: input.aspect,
    });
    if (input.isAborted && input.isAborted()) return { memory, drawn };
    const master = buildCharacterMaster({
      name: detectedCharacter.name,
      description: detectedCharacter.description,
      fullBodyReference: url,
    });
    memory = { ...memory, characterMasters: [master] };
    if (url) drawn.push({ kind: 'Character', label: detectedCharacter.name, url });
  } else if (memory.characterMasters.length > 0 && !memory.characterMasters[0].fullBodyReference) {
    // A CHARACTER_MASTER built from an uploaded headshot has no in-situation
    // reference, and on an image-to-video path a bare portrait behaves like
    // frame zero — which makes every shot open on that headshot. One full-body
    // still, drawn once, fixes it for the whole production.
    const master = memory.characterMasters[0];
    if (input.onProgress) input.onProgress('Drawing your character into the world of the piece…');
    const url = await drawReference({
      kind: 'character',
      description: `${master.description} ${clampText(input.plan.world, 120)}`,
      look,
      aspect: input.aspect,
    });
    if (input.isAborted && input.isAborted()) return { memory, drawn };
    if (url) {
      memory = { ...memory, characterMasters: [withFullBodyReference(master, url)] };
      drawn.push({ kind: 'Character', label: master.name, url });
    }
  }

  // ---- One environment per chapter ----
  const wanted = input.plan.chapters.slice(0, 3);
  const environments = [...memory.environments];
  for (let i = 0; i < wanted.length; i++) {
    const chapter = wanted[i];
    if (environments.some((e) => e.id === chapter.environmentId)) continue;
    const described =
      detected.environments[i] ||
      detected.environments[0] || { label: chapter.title, description: chapter.summary || input.plan.world };
    const description = clampText(described.description || chapter.summary || input.plan.world, 400);
    if (!description) continue;
    if (input.onProgress) input.onProgress(`Building the world of ${described.label || chapter.title}…`);
    const url = await drawReference({ kind: 'environment', description, look, aspect: input.aspect });
    if (input.isAborted && input.isAborted()) break;
    environments.push(
      makeEnvironment({
        id: chapter.environmentId,
        label: described.label || chapter.title,
        description,
        referenceUrl: url,
      }),
    );
    if (url) drawn.push({ kind: 'Environment', label: described.label || chapter.title, url });
  }
  memory = { ...memory, environments };

  // ---- One recurring prop ----
  if (memory.objects.length === 0 && detected.props.length > 0) {
    const prop = detected.props[0];
    if (input.onProgress) input.onProgress(`Drawing the ${prop.label}…`);
    const url = await drawReference({ kind: 'object', description: prop.description, look, aspect: input.aspect });
    if (!(input.isAborted && input.isAborted())) {
      memory = {
        ...memory,
        objects: [makeObject({ id: 'obj_01', label: prop.label, description: prop.description, referenceUrl: url })],
      };
      if (url) drawn.push({ kind: 'Prop', label: prop.label, url });
    }
  }

  // ---- The visual anchors the faceless engine repeats into every prompt ----
  memory = {
    ...memory,
    anchors: {
      style: look,
      environments: memory.environments,
      objects: memory.objects,
      motifs: detected.props.map((p) => p.label).slice(0, 3),
    },
  };

  return { memory, drawn };
}
