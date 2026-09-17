/**
 * VidVerge Create — the 8 video types, the tone/length catalogs, and the
 * deterministic fallback script builders used when the AI scripting call
 * cannot deliver (offline, malformed JSON, proxy hiccup).
 *
 * The generate-video hook enforces a hard ~1000-char prompt cap per scene
 * (character block + scene description + dialogue), so every builder clamps
 * its pieces well under it. Scene descriptions here are the SAME text used
 * for both the storyboard preview image prompt and the final Omni render, so
 * what the user approves is what gets generated.
 */

export type AspectRatio = '16:9' | '9:16';
export type CharacterSupport = 'optional' | 'required';
export type LengthId = 'short' | 'medium' | 'long';

/** A confirmed character for this video: saved, AI-generated, or uploaded. */
export interface CharacterRef {
  name: string;
  description: string;
  imageUrl?: string;
  source: 'saved' | 'ai' | 'upload';
}

/** One storyboard scene — everything on a scene card is editable. */
export interface BoardScene {
  key: string;
  shotType: string;
  description: string;
  dialogue: string;
  durationSec: number;
}

export interface VideoTypeDef {
  id: string;
  name: string;
  /** lucide icon name, mapped in TypePicker. */
  icon: string;
  blurb: string;
  character: CharacterSupport;
  defaultAspect: AspectRatio;
  /** Product Ad only: URL scrape + product image intake. */
  productIntake?: boolean;
  topicLabel: string;
  topicPlaceholder: string;
  /** Visual style words woven into script + image prompts. */
  styleWord: string;
}

export const VIDEO_TYPES: VideoTypeDef[] = [
  {
    id: 'product_ad',
    name: 'Product Ad',
    icon: 'Megaphone',
    blurb: 'Start from your product link or an image — we read either one for you.',
    character: 'optional',
    defaultAspect: '9:16',
    productIntake: true,
    topicLabel: 'Anything else the ad should hit? (optional)',
    topicPlaceholder: 'e.g. a launch offer, the audience, one feature to lead with',
    styleWord: 'premium commercial',
  },
  {
    id: 'social_reel',
    name: 'Social Reel',
    icon: 'Zap',
    blurb: 'Short, punchy content for Instagram / TikTok — high energy, trending feel.',
    character: 'optional',
    defaultAspect: '9:16',
    topicLabel: 'What is this reel about?',
    topicPlaceholder: 'e.g. 3 things nobody tells you about starting a coffee brand',
    styleWord: 'fast-cut social',
  },
  {
    id: 'cinematic_story',
    name: 'Cinematic Trailer',
    icon: 'Clapperboard',
    blurb: 'Dramatic, high-impact — cut like a movie trailer.',
    character: 'optional',
    defaultAspect: '16:9',
    topicLabel: 'What is the trailer for?',
    topicPlaceholder: 'e.g. a product launch, an event, a film-style tease of your brand',
    styleWord: 'dramatic cinematic trailer',
  },
  {
    id: 'explainer',
    name: 'Explainer',
    icon: 'Presentation',
    blurb: 'Breaks a concept down step by step — talking head + screen-style shots.',
    character: 'optional',
    defaultAspect: '9:16',
    topicLabel: 'What are we explaining?',
    topicPlaceholder: 'e.g. how compound interest actually works, in plain words',
    styleWord: 'clean instructional',
  },
  {
    id: 'testimonial',
    name: 'Testimonial / Talking Head',
    icon: 'User',
    blurb: 'A single character speaks directly to camera.',
    character: 'required',
    defaultAspect: '9:16',
    topicLabel: 'What should they say?',
    topicPlaceholder: 'Paste the exact lines to deliver, or describe the message',
    styleWord: 'authentic documentary',
  },
  {
    id: 'brand_story',
    name: 'Brand Story',
    icon: 'Heart',
    blurb: 'Who you are and what you stand for — brand emotion over product features.',
    character: 'optional',
    defaultAspect: '16:9',
    topicLabel: 'Tell us about the brand',
    topicPlaceholder: 'e.g. Northwind Coffee — small-batch roasts shipped within 48 hours, for the early risers',
    styleWord: 'emotive brand film',
  },
  {
    id: 'tutorial',
    name: 'Tutorial / How-To',
    icon: 'ListOrdered',
    blurb: 'Step-by-step instructional format that teaches one thing clearly.',
    character: 'optional',
    defaultAspect: '9:16',
    topicLabel: 'What are you teaching?',
    topicPlaceholder: 'e.g. how to make pour-over coffee at home',
    styleWord: 'bright instructional',
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: 'PenLine',
    blurb: "Open brief — describe anything and we'll script it.",
    character: 'optional',
    defaultAspect: '16:9',
    topicLabel: 'Describe the video you want',
    topicPlaceholder: 'Anything — the subject, the setting, the mood, what happens, where it will be posted',
    styleWord: 'cinematic',
  },
];

export function getVideoType(id: string): VideoTypeDef | undefined {
  return VIDEO_TYPES.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------
export interface ToneDef {
  id: string;
  label: string;
  /** Camera / light / grade language for prompts. */
  visual: string;
  /** The tone string sent to the generate-video hook. */
  prompt: string;
}

export const TONES: ToneDef[] = [
  {
    id: 'energetic',
    label: 'Energetic',
    visual: 'high-energy pacing, punchy vibrant color, kinetic camera moves',
    prompt: 'energetic, high-energy',
  },
  {
    id: 'professional',
    label: 'Professional',
    visual: 'clean composed framing, neutral premium palette, steady confident camera',
    prompt: 'professional, polished',
  },
  {
    id: 'warm',
    label: 'Warm',
    visual: 'golden natural light, soft depth of field, intimate framing',
    prompt: 'warm, heartfelt',
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    visual: 'high-contrast moody lighting, deep shadows, slow deliberate camera',
    prompt: 'dramatic, cinematic',
  },
  {
    id: 'playful',
    label: 'Playful',
    visual: 'bright saturated color, bouncy motion, whimsical framing',
    prompt: 'playful, fun',
  },
];

export function getTone(id: string): ToneDef {
  return TONES.find((t) => t.id === id) || TONES[1];
}

// ---------------------------------------------------------------------------
// Lengths — every length produces AT LEAST 3 scenes. `targetSeconds` is the
// promise; how many scenes of what length it takes to DELIVER that promise
// follows Omni Flash's clip limit, so scenePlanFor() below is what the script
// writer, storyboard and Generate screen all read.
// ---------------------------------------------------------------------------
export interface LengthDef {
  id: LengthId;
  label: string;
  sub: string;
  sceneCount: number;
  sceneSeconds: number;
  /** Sent to the generate-video hook as target_duration_seconds. */
  targetSeconds: number;
}

export const LENGTHS: LengthDef[] = [
  { id: 'short', label: 'Short', sub: '~15s', sceneCount: 3, sceneSeconds: 5, targetSeconds: 15 },
  { id: 'medium', label: 'Medium', sub: '~30s', sceneCount: 3, sceneSeconds: 10, targetSeconds: 30 },
  { id: 'long', label: 'Long', sub: '~60s', sceneCount: 6, sceneSeconds: 10, targetSeconds: 60 },
];

export const MIN_SCENES = 3;

export function getLength(id: string): LengthDef {
  return LENGTHS.find((l) => l.id === id) || LENGTHS[1];
}

// ---------------------------------------------------------------------------
// Video generation engine. The registered generate-video hook intentionally
// renders every request with Gemini Omni Flash, so this catalog exposes only
// that real capability. Keep the broader type vocabulary for persisted legacy
// values and adjacent agentic code; getVideoModel() normalizes them to Omni.
// ---------------------------------------------------------------------------
export type VideoModelId =
  | 'gemini-omni-flash-preview'
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.0-generate-001'
  | 'veo-3.0-fast-generate-001'
  | 'veo-2.0-generate-001'
  | 'sora-2'
  | 'sora-2-pro'
  | 'kling-v1'
  | 'kling-v1-5'
  | 'kling-v1-6'
  | 'kling-v2-master'
  | 'heygen-video';
export type VideoProvider = 'google-veo3' | 'kling-video' | 'heygen-video';
export type VideoEngine = 'omni' | 'veo' | 'sora' | 'kling' | 'heygen';

export interface VideoModelDef {
  id: VideoModelId;
  label: string;
  provider: VideoProvider;
  model: string;
  engine: VideoEngine;
  sound: boolean;
  recommended: boolean;
}

export const VIDEO_MODELS: VideoModelDef[] = [
  {
    id: 'gemini-omni-flash-preview',
    label: 'Omni Flash (Google Gemini — reference-consistent)',
    provider: 'google-veo3',
    model: 'gemini-omni-flash-preview',
    engine: 'omni',
    sound: true,
    recommended: true,
  },
];

export const MODEL_GROUPS: { label: string; engine: VideoEngine }[] = [
  { label: 'Google Omni', engine: 'omni' },
];

export function modelsForEngine(engine: VideoEngine): VideoModelDef[] {
  return VIDEO_MODELS.filter((m) => m.engine === engine);
}

/**
 * The default and only exposed engine is the one this workspace actually
 * renders on. It is also the engine that accepts the same reference images on
 * every clip, which is what holds a character's face across a production.
 */
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'gemini-omni-flash-preview';
export const PRIMARY_MODEL_IDS: VideoModelId[] = VIDEO_MODELS.map((model) => model.id);

// Old saved provider preferences are migrated to the current default. This is
// compatibility only: `higgsfield-media` is not exposed because generate-video
// has no Higgsfield route.
const LEGACY_VIDEO_MODEL_ALIASES: Record<string, VideoModelId> = {
  'google-veo3': DEFAULT_VIDEO_MODEL,
  'higgsfield-media': DEFAULT_VIDEO_MODEL,
};

export function getVideoModel(id: string): VideoModelDef {
  const resolvedId = LEGACY_VIDEO_MODEL_ALIASES[id] || id;
  return VIDEO_MODELS.find((model) => model.id === resolvedId || model.model === resolvedId) || VIDEO_MODELS[0];
}

export function shortModelLabel(id: string): string {
  return getVideoModel(id).label;
}

export function modelHasSound(id: string): boolean {
  return getVideoModel(id).sound;
}

export const VEO_CLIP_SECONDS = 8;

export function clipOptionsFor(_modelId: string): number[] {
  return [VEO_CLIP_SECONDS];
}

export function longestClipSeconds(_modelId: string): number {
  return VEO_CLIP_SECONDS;
}

export function renderClipSeconds(_seconds: number, _modelId?: string): number {
  return VEO_CLIP_SECONDS;
}

export const MAX_RENDER_SCENES = 8;

export function scenePlanFor(
  lengthId: LengthId,
  _modelId: string,
): { sceneCount: number; sceneSeconds: number } {
  const target = getLength(lengthId).targetSeconds;
  return {
    sceneCount: Math.max(MIN_SCENES, Math.min(MAX_RENDER_SCENES, Math.round(target / VEO_CLIP_SECONDS))),
    sceneSeconds: VEO_CLIP_SECONDS,
  };
}

export function plannedSeconds(lengthId: LengthId, modelId: string): number {
  const plan = scenePlanFor(lengthId, modelId);
  return plan.sceneCount * plan.sceneSeconds;
}

// ---------------------------------------------------------------------------
// Script building blocks
// ---------------------------------------------------------------------------
export const SCENE_MAX = 380;
export const DIALOGUE_MAX = 140;

export function clampText(text: string, max: number): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

let sceneSeq = 0;
export function makeScene(
  shotType: string,
  description: string,
  dialogue: string,
  durationSec: number,
  /** Legacy caller value; clip length always snaps to Omni Flash. */
  modelId?: string,
): BoardScene {
  sceneSeq += 1;
  return {
    key: `sc_${Date.now()}_${sceneSeq}`,
    shotType: clampText(shotType, 40) || 'Medium shot',
    description: clampText(description, SCENE_MAX),
    dialogue: clampText(dialogue, DIALOGUE_MAX),
    durationSec: renderClipSeconds(durationSec || 10, modelId),
  };
}

export interface ProductBrief {
  name: string;
  tagline: string;
  features: string;
  tone: string;
}

/** Everything the script generator needs, gathered across screens 1–3. */
export interface ScriptBrief {
  typeId: string;
  topic: string;
  /** Legacy caller value; scene planning always resolves to Omni Flash. */
  model?: string;
  productBrief: ProductBrief | null;
  hasProductImages: boolean;
  /**
   * Vision read of an uploaded product/brand image — the image entry point's
   * equivalent of the URL fetch. Every scene that shows the product is written
   * and previewed against this description.
   */
  visualReference?: string;
  character: CharacterRef | null;
  toneId: string;
  lengthId: LengthId;
  aspect: AspectRatio;
}

export interface BuiltScript {
  title: string;
  scenes: BoardScene[];
  /** The character_description string sent to the generate-video hook. */
  characterDescription: string;
}

function who(character: CharacterRef | null): string {
  return character ? character.name : 'the presenter';
}

/**
 * When no character is used, describe visual continuity instead — otherwise
 * the pipeline's default injects an unwanted on-camera presenter.
 */
export function characterDescriptionFor(character: CharacterRef | null, style: string): string {
  if (character) return clampText(`${character.name}. ${character.description}`, 360);
  return `No recurring on-camera character. Maintain one consistent ${style} visual style, color grade, and lighting across every scene.`;
}

/**
 * CHARACTER-CONSISTENCY FIX: a short character seed line injected at the
 * START of every scene description sent to the render hook — not just
 * scene 1 — so the character reference travels with each individual scene
 * prompt. With a reference image the line ties every scene back to the image
 * the model is given as that clip's reference; without one it restates the
 * appearance in every scene.
 * Returns '' when the video has no character (no injection).
 */
export function characterSeedLine(character: CharacterRef | null): string {
  if (!character) return '';
  const desc = clampText(character.description, 150).replace(/[.…]+$/, '');
  return character.imageUrl
    ? `Same character as the reference image: ${desc}.`
    : `Same character in every scene: ${desc}.`;
}

interface Beat {
  shot: string;
  desc: string;
  line: string;
}

/**
 * Deterministic fallback script: 5 beats per type, sliced to the requested
 * scene count (never below MIN_SCENES). Used only when the AI scripting call
 * fails — the user still lands on a real, editable storyboard.
 */
export function buildFallbackScript(brief: ScriptBrief): BuiltScript {
  const type = getVideoType(brief.typeId);
  const tone = getTone(brief.toneId);
  // The plan, not the raw length: it knows how many Omni clips are needed to
  // reach the runtime the visitor asked for.
  const plan = scenePlanFor(brief.lengthId, brief.model || DEFAULT_VIDEO_MODEL);
  const c = brief.character;
  const name = who(c);
  const style = type ? type.styleWord : 'cinematic';
  const topic = clampText(brief.topic || '', 140);

  const b = brief.productBrief;
  const product = (b && b.name) || topic || 'the product';
  const tag = (b && b.tagline) || '';
  const feat = clampText((b && b.features) || '', 120);
  const pn = brief.hasProductImages ? ' The product shown matches the provided reference image exactly.' : '';

  let title = '';
  let beats: Beat[] = [];

  switch (brief.typeId) {
    case 'product_ad':
      title = `${clampText(product, 44)} — Product Ad`;
      beats = [
        {
          shot: 'Product close-up',
          desc: `Hero shot: ${product} displayed pristine on a clean premium surface, soft dramatic studio lighting, slow camera push-in, ${tone.visual}.${pn}`,
          line: tag ? `Meet ${product} — ${tag}.` : `Meet ${product}.`,
        },
        {
          shot: c ? 'Medium shot' : 'Lifestyle shot',
          desc: c
            ? `${name} uses ${product} in a real everyday moment, genuine delight, natural light, ${tone.visual}.${pn}`
            : `${product} in use in a real everyday moment — hands interacting with it naturally, warm natural light, ${tone.visual}.${pn}`,
          line: feat || 'Made for every day — and it shows.',
        },
        {
          shot: 'Macro detail',
          desc: `Macro montage of ${product}: texture, materials, and craft details under crisp directional lighting, rhythmic cuts.${pn}`,
          line: 'Every detail, considered.',
        },
        {
          shot: 'Social proof beat',
          desc: c
            ? `${name} reacts to ${product} with real enthusiasm, quick authentic cutaways, ${tone.visual}.${pn}`
            : `Quick authentic cutaways of ${product} making a moment easier and better, ${tone.visual}.${pn}`,
          line: 'Once you try it, you get it.',
        },
        {
          shot: 'End card',
          desc: c
            ? `Call to action: ${name} holds up ${product} toward the camera and smiles, bold clean closing framing, no words on screen.${pn}`
            : `Call to action: ${product} centered on a dark premium backdrop, light sweep, bold clean closing framing, no words on screen.${pn}`,
          line: `Get ${product} today.`,
        },
      ];
      break;

    case 'social_reel':
      title = `${clampText(topic || 'Reel', 44)} — Social Reel`;
      beats = [
        {
          shot: 'Hook — punch-in',
          desc: c
            ? `Hook (first 2 seconds): ${name} snaps toward the camera mid-action with a fast punch-in, high energy, about ${topic}.`
            : `Hook (first 2 seconds): a striking fast-cut visual with a hard punch-in about ${topic}, high energy.`,
          line: `Stop scrolling — ${clampText(topic, 80)}.`,
        },
        {
          shot: 'Fast montage',
          desc: c
            ? `${name} delivers the first payoff on ${topic} with quick dynamic cuts and expressive gestures, rhythmic pacing.`
            : `Fast dynamic montage delivering the first payoff on ${topic}, rhythmic cuts, kinetic camera.`,
          line: "Here's the part nobody tells you.",
        },
        {
          shot: 'Payoff beat',
          desc: c
            ? `${name} lands the key insight on ${topic}, closer framing, a beat of stillness before the energy kicks back in.`
            : `The key insight on ${topic} lands visually — one bold clear image, a beat of stillness, then energy returns.`,
          line: 'This is the one that changes everything.',
        },
        {
          shot: 'Proof flash',
          desc: `Rapid proof montage on ${topic}: quick concrete examples, snap zooms, bold rhythm, ${tone.visual}.`,
          line: 'And it works every single time.',
        },
        {
          shot: 'CTA close',
          desc: c
            ? `Outro: ${name} points straight at the camera with a grin, bold closing energy, no words on screen.`
            : `Outro: a bold closing image with a final kinetic camera move, no words on screen.`,
          line: 'Follow for more like this.',
        },
      ];
      break;

    case 'cinematic_story':
      title = `${clampText(topic || 'Trailer', 44)} — Cinematic Trailer`;
      beats = [
        {
          shot: 'Establishing wide',
          desc: `Trailer cold open: the world of ${topic} in one striking image — anamorphic cinematic framing, ${tone.visual}, film grain.`,
          line: 'Every story starts somewhere quiet.',
        },
        {
          shot: 'Rising action',
          desc: c
            ? `${name} moves through the heart of the story — ${topic} — purposeful motion, evolving light, ${tone.visual}.`
            : `The story builds — ${topic} — purposeful motion, evolving light, ${tone.visual}.`,
          line: 'But nothing worth having comes easy.',
        },
        {
          shot: 'Intimate close-up',
          desc: c
            ? `Close on ${name}: a quiet human moment inside the story, shallow depth of field, held breath, ${tone.visual}.`
            : `A quiet intimate detail inside the story — shallow depth of field, held breath, ${tone.visual}.`,
          line: 'This is the moment it all comes down to.',
        },
        {
          shot: 'Emotional peak',
          desc: `The peak: the single most striking image of the story — slow motion, bold composition, rich texture, ${tone.visual}.`,
          line: 'And then — everything changes.',
        },
        {
          shot: 'Resolution',
          desc: `Resolution: the story settles into a final memorable image, ${tone.visual}, slow fade.`,
          line: 'Some stories stay with you.',
        },
      ];
      break;

    case 'explainer':
      title = `${clampText(topic || 'Explainer', 44)} — Explainer`;
      beats = [
        {
          shot: 'Hook — close-up',
          desc: c
            ? `${name} looks straight into camera and poses the core question of ${topic}, clean bright lighting, screen-style graphics hinted behind.`
            : `A bold clean opening image posing the core question of ${topic}, bright modern graphics-style framing.`,
          line: `Ever wondered how ${clampText(topic, 70)} actually works?`,
        },
        {
          shot: 'Concept overview',
          desc: c
            ? `${name} lays out the big picture of ${topic} while clean diagram-style visuals appear beside them, crisp modern look.`
            : `Clean diagram-style visuals lay out the big picture of ${topic}, crisp modern look, steady camera.`,
          line: "Here's the big picture in ten seconds.",
        },
        {
          shot: 'Step by step',
          desc: c
            ? `${name} breaks ${topic} into clear steps, showing each one with their hands, bright even light, no words on screen.`
            : `${topic} broken into clear steps, each one shown as a simple physical action, bright even light, no words on screen.`,
          line: 'Step one, step two, step three — that simple.',
        },
        {
          shot: 'Concrete example',
          desc: `A concrete real-world example of ${topic} playing out, close practical detail, clean instructional framing.`,
          line: "Here's what that looks like in real life.",
        },
        {
          shot: 'Recap + CTA',
          desc: c
            ? `${name} recaps the key takeaway of ${topic} to camera with an encouraging smile, clean closing framing.`
            : `One clear final image that sums ${topic} up, calm composition, no words on screen.`,
          line: 'Now you know — go use it.',
        },
      ];
      break;

    case 'testimonial':
      title = `${clampText(name, 44)} — Testimonial`;
      beats = [
        {
          shot: 'Documentary close-up',
          desc: `${name} speaks candidly to camera in a natural everyday setting, honest unscripted energy, soft window light, documentary framing.`,
          line: topic ? clampText(topic, 130) : "Honestly? I didn't expect much. I was wrong.",
        },
        {
          shot: 'The before',
          desc: `${name} recalls how things were before — a slightly tighter frame, reflective tone, muted light, ${tone.visual}.`,
          line: 'I used to waste hours fighting this every week.',
        },
        {
          shot: 'The turn',
          desc: `${name} brightens describing what changed, natural hand gestures, warmer light entering the frame.`,
          line: 'Then I tried it — and it just clicked.',
        },
        {
          shot: 'The result',
          desc: `${name} speaks with quiet conviction about the result, relaxed confident posture, documentary realism.`,
          line: 'The difference was night and day.',
        },
        {
          shot: 'Warm recommendation',
          desc: `${name} smiles at the camera with genuine warmth in the same setting, relaxed and convinced, gentle push-in.`,
          line: "If you're on the fence — just try it.",
        },
      ];
      break;

    case 'brand_story':
      title = `${clampText(product !== 'the product' ? product : topic || 'Brand', 44)} — Brand Story`;
      beats = [
        {
          shot: 'Wide shot',
          desc: `The problem: a moody cinematic vignette of everyday frustration in the world this brand serves — ${topic} — ${tone.visual}, slow push-in.`,
          line: "Some things shouldn't be this hard.",
        },
        {
          shot: 'Transition montage',
          desc: `The turn: hopeful transitional imagery — light breaking through, hands at work, motion toward something better — ${tone.visual}.`,
          line: 'So we set out to fix it.',
        },
        {
          shot: 'Medium shot',
          desc: c
            ? `${name} embodies the brand at work — ${topic} — shown beautifully and concretely, confident camera moves, ${tone.visual}.`
            : `The brand in its element — ${topic} — shown beautifully and concretely, confident camera moves, ${tone.visual}.`,
          line: 'Built by people who needed it themselves.',
        },
        {
          shot: 'Values moment',
          desc: `A quiet human moment that shows what the brand stands for — real people, real care, ${tone.visual}.`,
          line: "Because this was never just about product.",
        },
        {
          shot: 'Brand close',
          desc: `Brand close: the product alone in frame as the shot settles — ${tone.visual}, quiet confidence, fade out, no words on screen.`,
          line: "This is why we're here.",
        },
      ];
      break;

    case 'tutorial':
      title = `${clampText(topic || 'How-To', 44)} — Tutorial`;
      beats = [
        {
          shot: 'Intro — close-up',
          desc: c
            ? `Intro: ${name} greets the camera warmly and introduces what they're teaching: ${topic}. Clean bright lighting.`
            : `Intro: a clean bright title moment establishing the lesson — ${topic} — instructional framing.`,
          line: `Today: ${clampText(topic, 80)}. Let me break it down.`,
        },
        {
          shot: 'Step 1 — setup',
          desc: c
            ? `${name} shows the setup for ${topic}, close on the hands and materials, clear deliberate movements, bright even light.`
            : `Hands lay out the setup for ${topic} in clear close-up, clean bright lighting, deliberate movements.`,
          line: 'First, get your setup right — it matters.',
        },
        {
          shot: 'Step 2 — technique',
          desc: c
            ? `${name} demonstrates the core technique of ${topic} step by step, close on the action, crisp detail.`
            : `The core technique of ${topic} demonstrated step by step in crisp close-up detail.`,
          line: 'Watch closely — every detail matters here.',
        },
        {
          shot: 'Common mistake',
          desc: `A quick contrast beat: the common mistake people make with ${topic}, then the correction, side-by-side feel.`,
          line: "Here's the mistake almost everyone makes.",
        },
        {
          shot: 'Result + recap',
          desc: c
            ? `${name} shows the finished result to camera and recaps the key points with encouraging energy.`
            : `The finished result shown beautifully, then a clean recap moment, instructional framing.`,
          line: "And that's it — remember these key points every time.",
        },
      ];
      break;

    default:
      // custom (and any unknown id): a general-purpose open-brief structure.
      title = `${clampText(topic || 'My video', 44)}`;
      beats = [
        {
          shot: 'Opening hook',
          desc: c
            ? `Hook (first 2 seconds): ${name} mid-moment in the world of the brief — ${topic} — one striking image already in motion, ${tone.visual}.`
            : `Hook (first 2 seconds): the single most striking image of the brief — ${topic} — already in motion, ${tone.visual}.`,
          line: 'This is the part worth watching.',
        },
        {
          shot: 'Development',
          desc: c
            ? `${name} carries the idea forward — ${topic} — purposeful action, evolving light, ${tone.visual}.`
            : `The idea develops — ${topic} — purposeful motion, evolving light, ${tone.visual}.`,
          line: "Here's where it gets interesting.",
        },
        {
          shot: 'Key detail',
          desc: `Close on the detail that matters most inside ${topic} — crisp texture, deliberate framing, ${tone.visual}.`,
          line: 'The details are the whole story.',
        },
        {
          shot: 'The peak',
          desc: c
            ? `The peak moment: ${name} lands the payoff of ${topic} — bold composition, a beat of stillness, ${tone.visual}.`
            : `The peak moment of ${topic} lands — bold composition, a beat of stillness, ${tone.visual}.`,
          line: 'And then — everything clicks.',
        },
        {
          shot: 'Closing beat',
          desc: c
            ? `Close: ${name} settles the story with a final look to camera, clean memorable end framing, ${tone.visual}.`
            : `Close: the final memorable image of ${topic}, clean end framing, slow settle, ${tone.visual}.`,
          line: 'Now it’s your turn.',
        },
      ];
      break;
  }

  const count = Math.max(MIN_SCENES, Math.min(beats.length, plan.sceneCount));
  // Keep the first and last beats (hook + close), trim from the middle.
  let picked: Beat[];
  if (count >= beats.length) {
    picked = beats;
  } else {
    const middle = beats.slice(1, beats.length - 1);
    const keepMiddle = middle.slice(0, count - 2);
    picked = [beats[0], ...keepMiddle, beats[beats.length - 1]];
  }

  return {
    title,
    scenes: picked.map((beat) =>
      makeScene(beat.shot, beat.desc, beat.line, plan.sceneSeconds, brief.model),
    ),
    characterDescription: characterDescriptionFor(c, style),
  };
}

// ---------------------------------------------------------------------------
// Retry hand-off (My Videos → Create)
// ---------------------------------------------------------------------------
/**
 * localStorage key the My Videos library writes a failed job's brief to just
 * before it opens the Create app. Create consumes (and clears) it on mount and
 * lands straight on the intake step with that brief pre-filled, so "Try again"
 * on a failed render is one click instead of a re-type.
 */
export const RETRY_BRIEF_KEY = 'vidverge.retryBrief';

export interface RetryBrief {
  typeId: string;
  topic: string;
  toneId?: string;
  lengthId?: LengthId;
  aspect?: AspectRatio;
}

/**
 * The still-image prompt for one storyboard card. Same visual language as
 * the final render prompt so the preview is an honest approval gate.
 */
export function sceneImagePrompt(
  s: BoardScene,
  character: CharacterRef | null,
  tonePrompt: string,
  styleWord: string,
  visualReference?: string,
): string {
  const charNote = character ? ` Featuring ${clampText(character.description, 200)}.` : '';
  const refNote = visualReference
    ? ` The product shown must match this reference exactly: ${clampText(visualReference, 220)}.`
    : '';
  return clampText(
    `Cinematic film still, ${s.shotType.toLowerCase()}: ${s.description}${charNote}${refNote} ${styleWord} style, ${tonePrompt} mood, professional cinematography, high detail. No text, no captions, no watermarks, no borders.`,
    900,
  );
}
