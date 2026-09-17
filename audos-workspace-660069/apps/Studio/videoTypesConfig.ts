/**
 * VidVerge Studio — the 8 video types and their scene builders.
 *
 * Each type declares the minimal inputs it needs, whether a character and/or a
 * product image applies, its scene-count range (each scene ≈ 8 seconds — the
 * user picks the length in the form, up to 6 scenes / ~48s), and a `build()`
 * that turns the filled form into the scene list the generate-video hook
 * renders. The hook enforces a hard 1000-char cap per scene prompt (character
 * block + scene description + dialogue), so every builder clamps its pieces
 * well under that.
 *
 * PHONE BEAT: the live generate-video hook guarantees one phone shot per video
 * — if no scene mentions a phone it INJECTS the beat into scene 1. To keep
 * that guarantee from hijacking the opening shot, every builder writes its own
 * controlled phone moment into the OUTRO scene, where it reads as a natural
 * CTA.
 */
import type { ComponentType } from 'react';
import {
  Megaphone,
  Flame,
  UserSquare2,
  BookOpen,
  Clapperboard,
  ListOrdered,
  Quote,
  BadgePercent,
} from 'lucide-react';
import type { ScriptScene } from '../../lib/reelioStudio';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------
export type CharacterSupport = 'none' | 'optional' | 'required';
export type ProductSupport = 'none' | 'optional' | 'required';

/** A confirmed character: AI-generated portrait or uploaded face photo. */
export interface CharacterRef {
  name: string;
  description: string;
  imageUrl?: string;
  source: 'ai' | 'upload';
}

/** A confirmed product image (scraped from a URL or uploaded). */
export interface ProductRef {
  imageUrl: string;
  /** Compact visual description woven into scene prompts. */
  visualNote?: string;
  source: 'url' | 'upload';
}

export interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  multiline?: boolean;
  hint?: string;
}

export interface BuildArgs {
  inputs: Record<string, string>;
  steps: string[];
  character: CharacterRef | null;
  product: ProductRef | null;
  /** How many scenes the user asked for (clamped to the type's range). */
  sceneCount: number;
}

export interface BuildResult {
  scenes: ScriptScene[];
  tone: string;
  title: string;
  characterDescription: string;
}

export interface VideoTypeDef {
  id: string;
  label: string;
  tagline: string;
  icon: ComponentType<any>;
  character: CharacterSupport;
  product: ProductSupport;
  defaultAspect: '16:9' | '9:16';
  sceneCountLabel: string;
  fields: FieldDef[];
  /** Scene-count range the length picker offers (each scene ≈ 8s). */
  minScenes: number;
  maxScenes: number;
  defaultScenes: number;
  /** false = no length picker (tutorial: one scene per step). */
  lengthSelectable?: boolean;
  /** Tutorial-style dynamic step list (2–6 steps, one scene each). */
  hasSteps?: boolean;
  build: (args: BuildArgs) => BuildResult;
}

// ---------------------------------------------------------------------------
// Prompt-budget helpers (hook cap is 1000 chars/scene — stay well under)
// ---------------------------------------------------------------------------
export function clampText(text: string, max: number): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

const SCENE_MAX = 400;
const DIALOGUE_MAX = 150;
const CHAR_DESC_MAX = 300;
const PRODUCT_NOTE_MAX = 170;

function scene(description: string, dialogue: string): ScriptScene {
  return {
    scene_description: clampText(description, SCENE_MAX),
    dialogue: clampText(dialogue, DIALOGUE_MAX),
  };
}

/** "the presenter" / character-name phrase used inside scene descriptions. */
function who(character: CharacterRef | null): string {
  return character ? character.name : 'the presenter';
}

/** Product visual note appended to scenes that show the product. */
function productNote(product: ProductRef | null): string {
  if (!product) return '';
  const note = product.visualNote
    ? clampText(product.visualNote, PRODUCT_NOTE_MAX)
    : 'The product looks exactly like the provided reference image.';
  return ` The product shown: ${note}`;
}

/**
 * The character_description string the hook prepends to every scene prompt.
 * When no character is used, describe visual continuity instead — otherwise
 * the pipeline's default injects an unwanted on-camera presenter.
 */
export function characterDescriptionFor(character: CharacterRef | null, style: string): string {
  if (character) {
    return clampText(`${character.name}. ${character.description}`, CHAR_DESC_MAX + 60);
  }
  return `No recurring on-camera character. Maintain one consistent ${style} visual style, color grade, and lighting across every scene.`;
}

/**
 * Compose a scene list: fixed opener, fixed outro (carries the phone beat),
 * and as many middle beats as the requested count allows — in order.
 */
function compose(opener: ScriptScene, middles: ScriptScene[], outro: ScriptScene, count: number): ScriptScene[] {
  const middleCount = Math.max(0, Math.min(middles.length, count - 2));
  return [opener, ...middles.slice(0, middleCount), outro];
}

/** Split free text into `n` speakable chunks at sentence boundaries. */
function chunkText(raw: string, n: number): string[] {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (n <= 1) return [text];
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  if (sentences.length <= 1) {
    // No sentence boundaries — split by words into even halves/thirds.
    const words = text.split(' ');
    const per = Math.ceil(words.length / n);
    const out: string[] = [];
    for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(' '));
    return out.filter(Boolean);
  }
  const total = text.length;
  const target = total / n;
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length / 2 > target && chunks.length < n - 1) {
      chunks.push(current.trim());
      current = '';
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

// ---------------------------------------------------------------------------
// The 8 video types
// ---------------------------------------------------------------------------
export const VIDEO_TYPES: VideoTypeDef[] = [
  {
    id: 'product_ad',
    label: 'Product Ad',
    tagline: 'Hero shot, feature highlights, CTA — your real product on screen.',
    icon: Megaphone,
    character: 'optional',
    product: 'required',
    defaultAspect: '9:16',
    sceneCountLabel: '3–6 scenes · 24–48s',
    minScenes: 3,
    maxScenes: 6,
    defaultScenes: 4,
    fields: [
      { key: 'productName', label: 'Product name', placeholder: 'e.g. Lumen Desk Lamp', required: true },
      { key: 'tagline', label: 'Tagline or key benefit', placeholder: 'e.g. Light that adapts to you', required: false },
    ],
    build: ({ inputs, character, product, sceneCount }) => {
      const name = inputs.productName.trim();
      const tag = (inputs.tagline || '').trim();
      const pn = productNote(product);
      const opener = scene(
        `Product hero shot: ${name} displayed pristine on a clean premium surface, soft dramatic studio lighting, slow cinematic camera push-in.${pn}`,
        tag ? `Meet ${name} — ${tag}.` : `Meet ${name}.`,
      );
      const middles = [
        scene(
          character
            ? `${who(character)} demonstrates ${name} in use, close-up on the details that matter, genuine delight on camera.${pn}`
            : `Dynamic close-up montage of ${name} in use: macro details, texture, and craftsmanship under crisp lighting.${pn}`,
          tag ? `${clampText(tag, 90)} — and it shows.` : `Built for every day. Designed to last.`,
        ),
        scene(
          character
            ? `${who(character)} brings ${name} into a real everyday moment — using it naturally at home, relaxed and genuine, warm natural light.${pn}`
            : `Lifestyle beat: ${name} in a real everyday setting, warm natural light, hands using it naturally mid-routine.${pn}`,
          `It fits right into your day.`,
        ),
        scene(
          `Extreme macro pass over ${name}: materials, finish, and craftsmanship in shallow depth of field, slow precise camera glide.${pn}`,
          `Every detail, considered.`,
        ),
        scene(
          character
            ? `${who(character)} reacts genuinely to ${name} — an impressed nod, a small smile, holding it up to the light.${pn}`
            : `Quick cuts of delighted reactions to ${name}: hands passing it over, close on approving expressions.${pn}`,
          `Once you try it, you get it.`,
        ),
      ];
      const outro = scene(
        character
          ? `Call to action: ${who(character)} holds up a smartphone showing the ${name} order screen, smiles at the camera, bold end-card energy.`
          : `Call to action: a hand holds up a smartphone showing the ${name} order screen next to the product, bold end-card energy.`,
        `Get your ${name} today.`,
      );
      return {
        scenes: compose(opener, middles, outro, sceneCount),
        tone: 'upbeat, premium',
        title: `${name} — Product Ad`,
        characterDescription: characterDescriptionFor(character, 'premium commercial'),
      };
    },
  },
  {
    id: 'social_reel',
    label: 'Social Reel',
    tagline: 'Fast-paced, hook-first — built to stop the scroll.',
    icon: Flame,
    character: 'optional',
    product: 'none',
    defaultAspect: '9:16',
    sceneCountLabel: '3–6 scenes · 24–48s',
    minScenes: 3,
    maxScenes: 6,
    defaultScenes: 4,
    fields: [
      { key: 'topic', label: 'Topic', placeholder: 'e.g. morning routines that actually work', required: true },
      { key: 'vibe', label: 'Vibe', placeholder: 'e.g. bold and funny, calm and aesthetic', required: false },
    ],
    build: ({ inputs, character, sceneCount }) => {
      const topic = inputs.topic.trim();
      const vibe = (inputs.vibe || 'bold, energetic').trim();
      const opener = scene(
        character
          ? `Hook shot: ${who(character)} snaps toward the camera mid-action, ${vibe} energy, quick punch-in cut about ${topic}.`
          : `Hook shot: a striking fast-cut visual about ${topic}, ${vibe} energy, quick punch-in camera move.`,
        `Stop scrolling — this is about ${clampText(topic, 70)}.`,
      );
      const middles = [
        scene(
          character
            ? `${who(character)} delivers the payoff on ${topic} with fast dynamic cuts and expressive gestures, ${vibe} pacing.`
            : `Fast dynamic montage delivering the payoff on ${topic}, rhythmic cuts, ${vibe} pacing.`,
          `Here's the part nobody tells you.`,
        ),
        scene(
          character
            ? `${who(character)} raises the stakes on ${topic} — bigger gestures, faster cuts, energy climbing, ${vibe} pacing.`
            : `The stakes rise on ${topic}: bolder visuals, faster rhythm, energy climbing, ${vibe} pacing.`,
          `And it gets even better.`,
        ),
        scene(
          character
            ? `${who(character)} walks through a concrete real-world example of ${topic}, quick demonstrative cuts, hands-on energy.`
            : `A concrete real-world example of ${topic} plays out in quick demonstrative cuts, hands-on energy.`,
          `Watch how this works in real life.`,
        ),
        scene(
          character
            ? `Contrast beat: ${who(character)} acts out the common mistake people make with ${topic}, playfully exaggerated, then shakes their head.`
            : `Contrast beat: the common mistake people make with ${topic}, playfully exaggerated in fast cuts.`,
          `Most people get this completely wrong.`,
        ),
      ];
      const outro = scene(
        character
          ? `Outro: ${who(character)} points at the camera, then glances at a smartphone in hand with the follow screen glowing.`
          : `Outro: a hand raises a smartphone with a glowing follow screen, quick zoom, high-energy end card.`,
        `Follow for more like this.`,
      );
      return {
        scenes: compose(opener, middles, outro, sceneCount),
        tone: `fast-paced, ${vibe}`,
        title: `${clampText(topic, 40)} — Social Reel`,
        characterDescription: characterDescriptionFor(character, 'fast-cut social'),
      };
    },
  },
  {
    id: 'talking_head',
    label: 'Talking Head',
    tagline: 'One character, on camera, delivering your script.',
    icon: UserSquare2,
    character: 'required',
    product: 'none',
    defaultAspect: '9:16',
    sceneCountLabel: '1–4 scenes · 8–32s',
    minScenes: 1,
    maxScenes: 4,
    defaultScenes: 2,
    fields: [
      {
        key: 'script',
        label: 'Script or topic',
        placeholder: 'Paste the exact lines to say, or just describe the topic',
        required: true,
        multiline: true,
        hint: 'The script is split across your chosen number of scenes (~20 spoken words fit each 8s scene).',
      },
    ],
    build: ({ inputs, character, sceneCount }) => {
      const raw = inputs.script.trim().replace(/\s+/g, ' ');
      const name = who(character);
      // Don't pad a short script across empty scenes: ~130 chars ≈ one 8s scene.
      const usable = Math.max(1, Math.min(sceneCount, Math.ceil(raw.length / 130)));
      const chunks = chunkText(raw, usable);
      const framings = [
        `${name} speaks directly to camera, medium close-up, natural setting, warm even lighting, subtle handheld feel.`,
        `${name} continues to camera from a slightly wider angle in the same setting, natural gestures.`,
        `${name} keeps talking to camera, closer framing, leaning in slightly, same setting and light.`,
        `${name} continues to camera, relaxed three-quarter angle, same setting, steady energy.`,
      ];
      const scenes = chunks.map((chunk, i) => {
        const last = i === chunks.length - 1;
        if (chunks.length === 1) {
          return scene(
            `${name} speaks directly to camera, medium close-up, natural setting, warm even lighting, subtle handheld feel. A smartphone rests face-up on the table beside them.`,
            chunk,
          );
        }
        if (last) {
          return scene(
            `${name} wraps up to camera in the same setting, then glances at a smartphone in hand before looking back up with a warm nod.`,
            chunk,
          );
        }
        return scene(framings[i % framings.length], chunk);
      });
      return {
        scenes,
        tone: 'authentic, direct',
        title: `${name} — Talking Head`,
        characterDescription: characterDescriptionFor(character, 'on-camera'),
      };
    },
  },
  {
    id: 'brand_story',
    label: 'Brand Story',
    tagline: 'Cinematic narrative arc: problem → solution → your brand.',
    icon: BookOpen,
    character: 'none',
    product: 'none',
    defaultAspect: '16:9',
    sceneCountLabel: '3–6 scenes · 24–48s',
    minScenes: 3,
    maxScenes: 6,
    defaultScenes: 5,
    fields: [
      { key: 'brandName', label: 'Brand name', placeholder: 'e.g. Northwind Coffee', required: true },
      { key: 'whatTheyDo', label: 'What the brand does', placeholder: 'e.g. small-batch coffee roasted for people who work early', required: true, multiline: true },
      { key: 'vibe', label: 'Vibe / tone', placeholder: 'e.g. warm and human, sleek and modern', required: false },
    ],
    build: ({ inputs, sceneCount }) => {
      const brand = inputs.brandName.trim();
      const what = clampText(inputs.whatTheyDo, 160);
      const vibe = (inputs.vibe || 'warm, cinematic').trim();
      const problem = scene(
        `The problem: a moody cinematic vignette of everyday frustration in the world ${brand} serves, ${vibe} grade, shallow depth of field, slow push-in.`,
        `Some things just shouldn't be this hard.`,
      );
      const search = scene(
        `The search: hopeful transitional imagery — light breaking through, hands at work, motion toward something better, ${vibe} grade.`,
        `So we set out to fix it.`,
      );
      const turning = scene(
        `The turning point: a single decisive moment — a door opening, a first success, held in slow motion, ${vibe} grade.`,
        `Then everything changed.`,
      );
      const solution = scene(
        `The solution: ${brand} in its element — ${what} — shown beautifully and concretely, confident camera moves, ${vibe} grade.`,
        `${brand}: ${clampText(what, 80)}.`,
      );
      const impact = scene(
        `The impact: real people in real moments made better by ${brand}, candid warmth, layered vignettes, ${vibe} grade.`,
        `Real people. Real difference.`,
      );
      const close = scene(
        `Brand close: the ${brand} wordmark moment; a customer's smartphone screen glows warmly with ${brand} on it as the shot settles, ${vibe} grade.`,
        `${brand}. This is why we're here.`,
      );
      // The solution beat is the heart of the arc — it survives every length.
      const byCount: Record<number, ScriptScene[]> = {
        3: [problem, solution, close],
        4: [problem, search, solution, close],
        5: [problem, search, turning, solution, close],
        6: [problem, search, turning, solution, impact, close],
      };
      const scenes = byCount[Math.max(3, Math.min(6, sceneCount))] || byCount[5];
      return {
        scenes,
        tone: vibe,
        title: `${brand} — Brand Story`,
        characterDescription: characterDescriptionFor(null, vibe),
      };
    },
  },
  {
    id: 'cinematic',
    label: 'Cinematic Reel',
    tagline: 'Pure vibe — dramatic, artistic, high visual quality.',
    icon: Clapperboard,
    character: 'optional',
    product: 'optional',
    defaultAspect: '16:9',
    sceneCountLabel: '3–6 scenes · 24–48s',
    minScenes: 3,
    maxScenes: 6,
    defaultScenes: 4,
    fields: [
      { key: 'theme', label: 'Theme / mood', placeholder: 'e.g. neon rain in a sleeping city, golden-hour nostalgia', required: true, multiline: true },
    ],
    build: ({ inputs, character, product, sceneCount }) => {
      const theme = clampText(inputs.theme, 180);
      const pn = productNote(product);
      const establishing = scene(
        character
          ? `Establishing shot: ${who(character)} inside a world of ${theme}. Anamorphic cinematic framing, dramatic light, film grain.`
          : `Establishing shot: a world of ${theme}. Anamorphic cinematic framing, dramatic light, film grain, no people.`,
        ``,
      );
      const rising = scene(
        character
          ? `Rising motion: ${who(character)} moves through ${theme} — tracking shot, layered foreground elements, tension building.`
          : `Rising motion through ${theme} — gliding tracking shot, layered foreground elements, tension building.`,
        ``,
      );
      const peak = scene(
        character
          ? `The peak: ${who(character)} at the emotional center of ${theme} — striking silhouette, bold composition, slow motion.${pn}`
          : `The peak: the most striking image of ${theme} — bold composition, slow motion, rich texture.${pn}`,
        ``,
      );
      const texture = scene(
        `Texture study: extreme close details of ${theme} — surfaces, reflections, particles in the light, macro cinematography.${pn}`,
        ``,
      );
      const human = scene(
        character
          ? `A quiet human beat: ${who(character)} pauses inside ${theme}, breath visible, eyes catching the light, intimate framing.`
          : `A quiet human beat inside ${theme}: an anonymous figure pauses at a distance, small against the scene, intimate stillness.`,
        ``,
      );
      const resolution = scene(
        character
          ? `Resolution: the scene settles; ${who(character)} looks down at a smartphone whose glow is the only light, then the frame fades to black.`
          : `Resolution: the scene settles; a hand holds a smartphone whose glow is the only light in the dark, then the frame fades to black.`,
        ``,
      );
      // The peak always survives — it is the reason this video exists.
      const byCount: Record<number, ScriptScene[]> = {
        3: [establishing, peak, resolution],
        4: [establishing, rising, peak, resolution],
        5: [establishing, rising, peak, texture, resolution],
        6: [establishing, rising, peak, texture, human, resolution],
      };
      const scenes = byCount[Math.max(3, Math.min(6, sceneCount))] || byCount[4];
      return {
        scenes,
        tone: 'cinematic, dramatic',
        title: `${clampText(inputs.theme, 40)} — Cinematic Reel`,
        characterDescription: characterDescriptionFor(character, 'dramatic cinematic'),
      };
    },
  },
  {
    id: 'tutorial',
    label: 'Tutorial / How-To',
    tagline: 'A structured walkthrough — each step is one scene.',
    icon: ListOrdered,
    character: 'optional',
    product: 'none',
    defaultAspect: '9:16',
    sceneCountLabel: '2–6 steps · one scene each',
    minScenes: 2,
    maxScenes: 6,
    defaultScenes: 4,
    lengthSelectable: false,
    fields: [
      { key: 'topic', label: 'What are you teaching?', placeholder: 'e.g. how to make pour-over coffee', required: true },
    ],
    hasSteps: true,
    build: ({ inputs, steps, character }) => {
      const topic = inputs.topic.trim();
      const name = who(character);
      const used = steps.map((s) => s.trim()).filter(Boolean).slice(0, 6);
      const scenes = used.map((step, i) => {
        const last = i === used.length - 1;
        const base = character
          ? `Step ${i + 1} of ${topic}: ${name} demonstrates "${clampText(step, 120)}" clearly on camera, close on the hands and the action, clean bright lighting.`
          : `Step ${i + 1} of ${topic}: hands demonstrate "${clampText(step, 120)}" in clear close-up, clean bright lighting, instructional framing.`;
        return scene(
          last ? `${base} To close, a smartphone screen beside the action shows the finished result.` : base,
          `Step ${i + 1}: ${clampText(step, 110)}`,
        );
      });
      return {
        scenes,
        tone: 'clear, encouraging',
        title: `${clampText(topic, 46)} — Tutorial`,
        characterDescription: characterDescriptionFor(character, 'clean instructional'),
      };
    },
  },
  {
    id: 'testimonial',
    label: 'Testimonial',
    tagline: 'Your character tells the camera why they love it.',
    icon: Quote,
    character: 'required',
    product: 'none',
    defaultAspect: '9:16',
    sceneCountLabel: '2–4 scenes · 16–32s',
    minScenes: 2,
    maxScenes: 4,
    defaultScenes: 3,
    fields: [
      { key: 'productName', label: 'Product name', placeholder: 'e.g. Lumen Desk Lamp', required: true },
      { key: 'whatItDoes', label: 'What it does for them', placeholder: 'e.g. finally fixed my late-night eye strain', required: true, multiline: true },
    ],
    build: ({ inputs, character, sceneCount }) => {
      const product = inputs.productName.trim();
      const what = clampText(inputs.whatItDoes, 120);
      const name = who(character);
      const opener = scene(
        `${name} speaks candidly to camera in a natural everyday setting, honest and unscripted energy, soft window light, documentary framing.`,
        `Honestly? I didn't expect ${product} to change much. I was wrong.`,
      );
      const middles = [
        scene(
          `${name} recalls the moment it clicked — a genuine smile breaking through mid-sentence, same documentary setting.`,
          `Then I actually used ${product} for a week straight.`,
        ),
        scene(
          `${name} gestures naturally while describing the difference it made, warm daylight, honest close framing.`,
          `I stopped even thinking about the old way.`,
        ),
      ];
      const outro = scene(
        `${name} smiles at the camera, then holds up a smartphone showing ${product} on screen, genuine warmth, same setting.`,
        `It ${what}. If you're on the fence — just try it.`,
      );
      return {
        scenes: compose(opener, middles, outro, sceneCount),
        tone: 'genuine, warm',
        title: `${product} — Testimonial`,
        characterDescription: characterDescriptionFor(character, 'documentary'),
      };
    },
  },
  {
    id: 'promo',
    label: 'Promo / Offer',
    tagline: 'Punchy offer — CTA-forward, urgency built in.',
    icon: BadgePercent,
    character: 'optional',
    product: 'optional',
    defaultAspect: '9:16',
    sceneCountLabel: '2–4 scenes · 16–32s',
    minScenes: 2,
    maxScenes: 4,
    defaultScenes: 3,
    fields: [
      { key: 'offerText', label: 'The offer', placeholder: 'e.g. 50% off this weekend only', required: true },
      { key: 'productName', label: 'Product or store name', placeholder: 'e.g. Lumen Desk Lamp', required: true },
    ],
    build: ({ inputs, character, product, sceneCount }) => {
      const offer = clampText(inputs.offerText, 90);
      const name = inputs.productName.trim();
      const pn = productNote(product);
      const opener = scene(
        character
          ? `${who(character)} bursts into frame holding ${name}, bold promo energy, punchy lighting, big graphic feel.${pn}`
          : `Bold promo shot of ${name}: dramatic product spotlight, high-contrast punchy lighting, big graphic energy.${pn}`,
        `${offer} — on ${name}. Right now.`,
      );
      const middles = [
        scene(
          `Fast glamour pass over ${name}: rotating product spotlight, bold high-contrast lighting, quick rhythmic cuts.${pn}`,
          `This is the one you've been waiting on.`,
        ),
        scene(
          character
            ? `Scarcity beat: ${who(character)} taps an imaginary watch, quick cuts, ticking-clock energy, ${name} front and center.${pn}`
            : `Scarcity beat: ticking-clock energy in fast cuts, ${name} front and center under a hot spotlight.${pn}`,
          `When it's gone, it's gone.`,
        ),
      ];
      const outro = scene(
        character
          ? `Urgent CTA: ${who(character)} taps a smartphone showing the ${name} checkout screen, then looks up at the camera, countdown urgency.`
          : `Urgent CTA: a hand taps a smartphone showing the ${name} checkout screen, quick zoom, countdown urgency.`,
        `Don't wait — ${offer}. Go.`,
      );
      return {
        scenes: compose(opener, middles, outro, sceneCount),
        tone: 'punchy, urgent',
        title: `${clampText(name, 40)} — Promo`,
        characterDescription: characterDescriptionFor(character, 'bold promo'),
      };
    },
  },
];

export function getVideoType(id: string): VideoTypeDef | undefined {
  return VIDEO_TYPES.find((t) => t.id === id);
}
