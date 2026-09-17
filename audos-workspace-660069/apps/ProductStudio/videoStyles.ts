/**
 * Video styles — the catalogue behind the Product Video creation picker.
 *
 * One entry per style the customer can pick. A style is not just a label: it
 * owns its own
 *   - SCRIPT STRATEGY   (tone, sentence shape, hook and CTA instructions the
 *                        Claude scriptwriter must follow — see scriptWriter.ts),
 *   - IMAGE STRATEGY    (style lock, negative prompt, per-beat prompt rules),
 *   - VISUAL PARAMETERS (the Remotion beat composition is generated from the
 *                        style's own motion/grade numbers by buildBeatComposition),
 *   - AUDIO DEFAULTS    (background-music brief + a suggested sound-effects
 *                        brief for the optional SFX field),
 *   - CAPTION LOOK      (used by the finish render when auto-captions are on).
 *
 * Clip Style keeps its original hand-cut paper collage template verbatim
 * (clipStyleTemplate.ts) so existing runs stay pixel-identical; the four new
 * styles are defined here alongside it.
 */
import {
  CLIP_STYLE_ANIMATION_PROMPT,
  CLIP_STYLE_LOCK,
  CLIP_STYLE_NAME,
  CLIP_STYLE_NEGATIVE,
  CLIP_STYLE_REMOTION_COMPOSITION,
  SECONDS_PER_CLIP,
} from './clipStyleTemplate';

export type VideoStyleId = 'clip' | 'cinematic' | 'text2video' | 'documentary' | 'showcase';

/** How the beat's finished frame enters the shot. */
type Entrance = 'paper' | 'hardcut' | 'settle' | 'rise';
/** What the shot does once the frame has landed. */
type Hold = 'poster' | 'kenburns' | 'slowpan' | 'pushin';

export interface BeatVisualParams {
  /** Backdrop behind the frame (letterbox bars and any uncovered edge). */
  background: string;
  entrance: Entrance;
  hold: Hold;
  /** Stop-motion stepping in frames (0 = smooth motion). */
  stepFrames: number;
  /** Directional motion blur on the entrance, in px (0 = off). */
  motionBlurPx: number;
  /** Corner darkening, 0..1. */
  vignette: number;
  /** Scanline / paper-fibre texture overlay opacity, 0..1 (0 = off). */
  grain: number;
  /** Cinemascope bars top and bottom, as a fraction of height (0 = off). */
  letterbox: number;
  /** CSS filter applied to the frame, e.g. a colour grade. */
  filter: string;
  /** Scale at the end of the hold (1 = locked camera). */
  holdScale: number;
}

export interface VideoStyle {
  id: VideoStyleId;
  name: string;
  /** One line for the picker card. */
  blurb: string;
  /** lucide-react icon name rendered by the picker. */
  icon: 'Scissors' | 'Flame' | 'Type' | 'BookOpen' | 'Gem';
  /** Seconds per beat clip — every clip of a run is exactly this long. */
  clipSeconds: number;
  /** Target words per beat (clipSeconds x ~2.5 words/second). */
  wordsPerBeat: number;
  /** Can the customer start from a product URL, or is this description-only? */
  allowsUrl: boolean;
  /** Style-matched tone instruction handed to the Claude scriptwriter. */
  scriptTone: string;
  /** Extra scriptwriter rules on top of the shared ones. */
  scriptRules: string[];
  /** How each scene's visual direction should be written. */
  visualDirectionRule: string;
  /** Global image style lock — applied to every frame, never repeated per beat. */
  styleLock: string;
  /** Global negative prompt. */
  negative: string;
  /** Per-beat image prompt rules for the prompt writer. */
  imagePromptRules: string[];
  /** Human-readable note about how the clips move (shown in the wizard). */
  animationNote: string;
  /** Default background-music brief for ElevenLabs. */
  musicPrompt: string;
  /** Suggested sound-effects brief — a hint, never auto-applied. */
  sfxSuggestion: string;
  /** Music bed level under the narration, 0..1. */
  musicVolume: number;
  /** Sound-effects bed level, 0..1. */
  sfxVolume: number;
  /** Caption look used by the finish render when auto-captions are on. */
  captionLook: 'bold' | 'clean' | 'serif' | 'minimal';
  visual: BeatVisualParams;
}

/**
 * Duration-aware scene budget. The scriptwriter is told to write exactly this
 * many scenes so a 15-second film does not arrive with six of them.
 */
export function sceneBudget(seconds: number): { min: number; max: number } {
  if (seconds <= 20) return { min: 1, max: 2 };
  if (seconds <= 40) return { min: 3, max: 4 };
  if (seconds <= 75) return { min: 5, max: 6 };
  return { min: 7, max: 8 };
}

/**
 * Build a style's Remotion beat composition from its visual parameters. Every
 * style renders one finished frame per beat; what differs is how the frame
 * enters, what the camera does afterwards, and the grade/texture on top.
 *
 * The finished frame arrives through props as `imageUrl` because the render
 * endpoint requires image URLs to travel in props, never inlined in source.
 */
export function buildBeatComposition(p: BeatVisualParams, clipSeconds: number): string {
  const frames = Math.round(clipSeconds * 30);
  const landFrame = Math.round(frames * 0.42);
  return `
import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion';

// Generated from the style's own visual parameters (apps/ProductStudio/videoStyles.ts).
// entrance=${p.entrance} hold=${p.hold} step=${p.stepFrames} blur=${p.motionBlurPx}px
const FRAMES = ${frames};
const LAND = ${landFrame};
const STEP = ${p.stepFrames};
const HOLD_SCALE = ${p.holdScale};

export default function StyledBeat(props) {
  const imageUrl = props && props.imageUrl ? String(props.imageUrl) : '';
  const frame = useCurrentFrame();
  // Stepped cadence during the entrance gives stop-motion styles their snap;
  // STEP of 0 leaves the motion perfectly smooth.
  const stepped = STEP > 0 && frame < LAND ? Math.floor(frame / STEP) * STEP : frame;
  const after = Math.max(0, frame - LAND);
  const holdT = FRAMES > LAND ? after / (FRAMES - LAND) : 0;

  const reveal = interpolate(stepped, [0, Math.round(LAND * 0.55)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
${entranceBlock(p)}
${holdBlock(p)}

  const scale = entryScale * holdScale;
  const x = tx + panX;
  const blurNow = ${p.motionBlurPx} > 0
    ? interpolate(stepped, [0, Math.round(LAND * 0.8)], [${p.motionBlurPx}, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 0;
  const grade = '${p.filter}';
  const filter = blurNow > 0.15 ? (grade === 'none' ? 'blur(' + blurNow.toFixed(2) + 'px)' : grade + ' blur(' + blurNow.toFixed(2) + 'px)') : (grade === 'none' ? undefined : grade);

  return (
    <AbsoluteFill style={{ backgroundColor: '${p.background}', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {imageUrl ? (
        <Img
          src={imageUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: reveal,
            filter: filter,
            transform: 'translate(' + x.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px) rotate(' + rot.toFixed(3) + 'deg) scale(' + scale.toFixed(4) + ')',
          }}
        />
      ) : null}
${p.grain > 0 ? `      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          mixBlendMode: 'multiply',
          opacity: ${p.grain} + 0.012 * Math.sin(frame / 5),
          background: 'repeating-linear-gradient(0deg, rgba(40,36,28,0.18) 0px, rgba(40,36,28,0.18) 1px, transparent 1px, transparent 3px)',
        }}
      />
` : ''}${p.vignette > 0 ? `      <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 54%, rgba(0,0,0,${p.vignette}) 100%)' }} />
` : ''}${p.letterbox > 0 ? `      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '${Math.round(p.letterbox * 100)}%', background: '#000' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '${Math.round(p.letterbox * 100)}%', background: '#000' }} />
      </AbsoluteFill>
` : ''}    </AbsoluteFill>
  );
}

export const calculateDemoVideoDuration = () => FRAMES;
`;
}

function entranceBlock(p: BeatVisualParams): string {
  switch (p.entrance) {
    case 'paper':
      return `  const tx = 0;
  const ty = interpolate(stepped, [0, Math.round(LAND * 0.55), Math.round(LAND * 0.78), LAND], [110, -2, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rot = interpolate(stepped, [0, Math.round(LAND * 0.62), LAND], [1.7, -0.35, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const entryScale = interpolate(stepped, [Math.round(LAND * 0.62), Math.round(LAND * 0.86), LAND], [1.012, 0.997, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });`;
    case 'hardcut':
      // A trailer cut: the frame is already there, snapping down from a punch.
      return `  const tx = interpolate(stepped, [0, Math.round(LAND * 0.5)], [26, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ty = 0;
  const rot = 0;
  const entryScale = interpolate(stepped, [0, Math.round(LAND * 0.5)], [1.09, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });`;
    case 'rise':
      return `  const tx = 0;
  const ty = interpolate(stepped, [0, LAND], [34, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rot = 0;
  const entryScale = interpolate(stepped, [0, LAND], [1.03, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });`;
    default:
      // 'settle' — a calm, almost imperceptible arrival.
      return `  const tx = 0;
  const ty = 0;
  const rot = 0;
  const entryScale = interpolate(stepped, [0, LAND], [1.02, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });`;
  }
}

function holdBlock(p: BeatVisualParams): string {
  switch (p.hold) {
    case 'kenburns':
      return `  const holdScale = 1 + (HOLD_SCALE - 1) * holdT;
  const panX = 0;`;
    case 'slowpan':
      // A steady documentary drift: a slow horizontal move with a hint of scale.
      // The hold scale keeps the frame overfilled so the pan never exposes an edge.
      return `  const holdScale = 1 + (HOLD_SCALE - 1) * holdT;
  const panX = -22 * holdT;`;
    case 'pushin':
      return `  const holdScale = 1 + (HOLD_SCALE - 1) * Math.pow(holdT, 0.72);
  const panX = 0;`;
    default:
      // 'poster' — locked off; only the faintest breath of life.
      return `  const holdScale = 1 + 0.0015 * Math.sin(after / 14);
  const panX = 0;`;
  }
}

// ---------------------------------------------------------------------------
// Shared script rules every style inherits
// ---------------------------------------------------------------------------

/**
 * The non-negotiable scriptwriting rules. Style-specific tone is layered on
 * top of these by each entry's `scriptTone` / `scriptRules`.
 */
export const SHARED_SCRIPT_RULES: string[] = [
  'The first line is a HOOK that lands inside three seconds: one concrete, specific claim, number, or tension. It must be sayable in under eight words.',
  'Never open with Welcome, Imagine, Have you ever, In today\'s video, Introducing, or any variation of them.',
  'Write the way a person actually talks. Contractions are good. No marketing-speak: ban revolutionary, game changing, seamless, cutting edge, unlock, elevate, supercharge, empower, leverage, solution, and synergy.',
  'Every sentence carries exactly one idea. Short to medium length. Read it aloud in your head before you keep it.',
  'Name real specifics from the product brief — actual features, actual numbers, actual problems. Never a generic benefit that would fit any product.',
  'The last line is a CLEAR CALL TO ACTION: one plain instruction telling the viewer what to do next.',
];

/** Narration punctuation contract — the TTS voice reads these marks literally. */
export const NARRATION_PUNCTUATION_RULES: string[] = [
  'Narration uses only full stops and question marks. Apostrophes in contractions are fine.',
  'No commas, em dashes, en dashes, semicolons, colons, brackets, ellipses, quotation marks, asterisks, slashes, emoji, or symbols.',
  'Write numbers, money, dates and percentages as spoken words, for example twenty twenty three instead of 2023.',
];

// ---------------------------------------------------------------------------
// The styles
// ---------------------------------------------------------------------------

export const VIDEO_STYLES: VideoStyle[] = [
  {
    id: 'clip',
    name: CLIP_STYLE_NAME,
    blurb: 'Hand-cut paper collage animation — aged newsprint, halftone cutouts, tape and red thread, assembled in stop motion.',
    icon: 'Scissors',
    clipSeconds: SECONDS_PER_CLIP,
    wordsPerBeat: 10,
    allowsUrl: true,
    scriptTone:
      'Documentary narration for an archival investigation. Measured, factual, quietly confident. The voice of someone laying evidence on a table, not selling anything.',
    scriptRules: [
      'Open on a concrete fact, a year, or the exact problem — the way an archive documentary opens on a date.',
      'End on a consequence or an open question, then the call to action as its own final line.',
    ],
    visualDirectionRule:
      'Each scene\'s visual is a physical paper tableau: name the hero cutout first, then up to three supporting cut-outs, then what the empty background stock is.',
    styleLock: CLIP_STYLE_LOCK,
    negative: CLIP_STYLE_NEGATIVE,
    imagePromptRules: [
      'Order: the dominant hero element first, then up to three supporting elements, then one background or empty-space note.',
      'Hero options: the product device, app or interface, a faceless figure, a phone, a laptop, an analytics dashboard, money or credits, a document, a screenshot, a social post, a newspaper clipping, a map, a timeline, a website interface.',
      'If the beat carries a key date, name, amount or stat, write it as a one to four word label on a paper strip, rubber stamp or torn headline, and give the exact label wording in the line.',
      'NO recognisable human faces anywhere. If a person is needed: seen from behind, over the shoulder, cropped below the eyes, a silhouette, or hands only.',
      'Recurring subjects (the product, a figure, an app screen) must be described with IDENTICAL wording every time they appear so the clips stay visually consistent.',
    ],
    animationNote: CLIP_STYLE_ANIMATION_PROMPT,
    musicPrompt:
      'Restrained documentary underscore: sparse felt piano, a low sustained cello drone, soft brushed percussion and the faint hiss of tape. Patient, archival, never sentimental. Around seventy beats per minute.',
    sfxSuggestion: 'Close-miked paper: sheets sliding, cardstock taps, tape pressing and peeling, rubber-stamp impacts, pin clicks, faint room tone.',
    musicVolume: 0.2,
    sfxVolume: 0.3,
    captionLook: 'serif',
    // Clip Style keeps its original hand-authored template verbatim.
    visual: {
      background: '#d8cdb4',
      entrance: 'paper',
      hold: 'poster',
      stepFrames: 3,
      motionBlurPx: 0,
      vignette: 0,
      grain: 0.08,
      letterbox: 0,
      filter: 'none',
      holdScale: 1,
    },
  },
  {
    id: 'cinematic',
    name: 'Cinematic Trailer',
    blurb: 'Dramatic cuts, motion blur, epic score and bold text beats — a teaser trailer for your product.',
    icon: 'Flame',
    clipSeconds: 3,
    wordsPerBeat: 7,
    allowsUrl: true,
    scriptTone:
      'Trailer voice. Dramatic, declarative, built in escalating beats. Short hard lines with air between them, the way a teaser narrator lands each one. Tension first, product second, promise last.',
    scriptRules: [
      'Build in three movements: the stakes, the turn, the reveal. Each scene escalates on the one before it.',
      'Lines are short and stackable. Four to nine words each. Fragments are allowed and encouraged.',
      'No jokes, no hedging, no qualifiers. Every line is stated as fact.',
      'The final call to action is a single imperative of three words or fewer plus the product name.',
    ],
    visualDirectionRule:
      'Each scene\'s visual is one high-contrast cinematic frame: name the subject, the lens feel (wide, macro, low angle), the light source, and the single colour that dominates.',
    styleLock:
      'Cinematic teaser-trailer frame, anamorphic widescreen composition, dramatic high-contrast chiaroscuro lighting with deep crushed blacks and one hard rim light, volumetric haze and drifting dust in the light beam, shallow depth of field with heavy bokeh falloff, cool teal shadows against a warm amber key, subtle film halation on the highlights, 35mm grain, epic scale with a strong single focal subject and generous negative space. Photographic, not illustrated. 16:9, ultra detailed.',
    negative:
      'NOT cartoon, NOT flat illustration, NOT clipart, no bright even lighting, no pastel palette, no clutter, no busy backgrounds, no watermark, no logos, no on-image text or captions or typography of any kind, no recognisable human faces, no photoreal facial features, no real person likeness, no celebrity, no copyrighted character.',
    imagePromptRules: [
      'Order: the single hero subject first and in sharp focus, then the light source and its direction, then the atmosphere, then the out-of-focus background.',
      'Every frame needs ONE dominant subject. Never split attention between two equal subjects.',
      'Name the camera angle explicitly: low hero angle, overhead, extreme macro, wide establishing, or over-the-shoulder.',
      'NO text, typography, captions or lettering inside the image — the film lays its own text over the frame.',
      'NO recognisable human faces. Use silhouettes, hands, the back of a head, or a figure cropped below the eyes.',
      'Recurring subjects must be described with IDENTICAL wording every time so the cuts read as one film.',
    ],
    animationNote:
      'Three-second trailer cut. The frame snaps in from a hard punch with directional motion blur that resolves over the first half second, then pushes slowly in for the rest of the shot. Cinemascope bars top and bottom, deep vignette, teal-and-amber grade. No dissolves — every join is a hard cut.',
    musicPrompt:
      'Epic cinematic trailer score: low brass swells, a pounding timpani and taiko pulse, rising string ostinato, metallic braam hits on the accents, building relentlessly to a final impact. Dark, huge, no melody-forward sweetness. Around ninety beats per minute.',
    sfxSuggestion: 'Deep braam impacts on each cut, a rising riser into the reveal, low sub drops, distant metallic reverb tails.',
    musicVolume: 0.34,
    sfxVolume: 0.32,
    captionLook: 'bold',
    visual: {
      background: '#000000',
      entrance: 'hardcut',
      hold: 'pushin',
      stepFrames: 0,
      motionBlurPx: 14,
      vignette: 0.52,
      grain: 0,
      letterbox: 0.055,
      filter: 'contrast(1.16) saturate(1.1)',
      holdScale: 1.08,
    },
  },
  {
    id: 'text2video',
    name: 'Text-to-Video (English)',
    blurb: 'Type a plain English description of the video you want and the AI generates it directly from your words.',
    icon: 'Type',
    clipSeconds: 4,
    wordsPerBeat: 10,
    allowsUrl: false,
    scriptTone:
      'Faithful to the description the person typed. Their words, their angle, their voice — cleaned up and paced for speech, never rewritten into something else. Neutral and natural by default; if their description implies a tone, follow it.',
    scriptRules: [
      'The typed description is the brief AND the creative direction. Honour every specific it contains — named subjects, settings, moods, and any scenes it already describes.',
      'If the description already reads like a script, keep its lines and only re-pace them for speech.',
      'Do not invent product claims, statistics, or features the description does not mention.',
      'If the description names no call to action, close with a simple, honest one that fits what was described.',
    ],
    visualDirectionRule:
      'Each scene\'s visual translates one part of the typed description into a single concrete frame: name the subject, the setting, and the light. Stay literal to what they asked for.',
    styleLock:
      'Photographic, naturally lit scene with clean composition and a clear single subject, realistic materials and textures, soft directional daylight with gentle falloff, believable depth of field, balanced neutral colour with true whites, unobtrusive background that supports the subject, generous negative space. Editorial photography quality, 16:9, ultra detailed.',
    negative:
      'NOT cartoon, NOT 3D render, NOT illustration, no heavy filters, no surreal distortion, no clutter, no watermark, no logos, no on-image text or captions or typography, no recognisable human faces, no photoreal facial features, no real person likeness, no celebrity, no copyrighted character.',
    imagePromptRules: [
      'Stay literal to the beat and to the description the customer typed — this style exists to give people exactly what they asked for.',
      'Order: the subject the beat is about first, then the setting, then the light, then one background note.',
      'NO text, typography or lettering inside the image.',
      'NO recognisable human faces. Use hands, a silhouette, the back of a figure, or a crop below the eyes.',
      'Any subject that appears in more than one beat must be described with IDENTICAL wording every time.',
    ],
    animationNote:
      'Four-second shot. The frame rises gently into place and then holds with a slow Ken Burns drift — smooth motion throughout, no stepping, no grade. Plain and honest, so the description itself is what comes across.',
    musicPrompt:
      'Clean, unobtrusive underscore: warm electric piano, soft synth pad, light finger-snap percussion and a simple sustained bass. Friendly and neutral, sits well under a speaking voice. Around eighty beats per minute.',
    sfxSuggestion: 'Soft whoosh on each scene change, a gentle click on the reveals, light ambient room tone underneath.',
    musicVolume: 0.22,
    sfxVolume: 0.26,
    captionLook: 'clean',
    visual: {
      background: '#0A0F1E',
      entrance: 'rise',
      hold: 'kenburns',
      stepFrames: 0,
      motionBlurPx: 0,
      vignette: 0.14,
      grain: 0,
      letterbox: 0,
      filter: 'none',
      holdScale: 1.06,
    },
  },
  {
    id: 'documentary',
    name: 'Documentary',
    blurb: 'Slow steady shots, narration-style pacing and minimal transitions — calm, factual, and credible.',
    icon: 'BookOpen',
    clipSeconds: 5,
    wordsPerBeat: 12,
    allowsUrl: true,
    scriptTone:
      'Calm, factual documentary narration. Even-tempered and unhurried, the way a public-broadcast narrator reads: every claim plainly stated, nothing oversold, the pauses doing as much work as the words.',
    scriptRules: [
      'State facts, not enthusiasm. If a sentence would sound strange read flatly, rewrite it.',
      'Sentences run slightly longer than in the other styles, because the pacing is slower. Still one idea each.',
      'Include at least one concrete number, date or measurable detail from the brief, written as spoken words.',
      'Close on what this means in practice, then the call to action stated plainly with no urgency language.',
    ],
    visualDirectionRule:
      'Each scene\'s visual is one patient observational frame: name what is being observed, where it sits, and the quality of the light. No staging, no drama.',
    styleLock:
      'Observational documentary photograph, patient wide or medium composition on a tripod, available natural light with honest soft shadows, restrained desaturated colour with earthy neutrals, fine detail and real-world texture, everything in focus with only gentle depth falloff, quiet uncluttered framing with plenty of breathing room, a faint 35mm grain. Unstaged and truthful, never glossy. 16:9, ultra detailed.',
    negative:
      'NOT cartoon, NOT illustration, NOT 3D render, no dramatic lighting, no lens flare, no saturated colour, no motion blur, no clutter, no watermark, no logos, no on-image text or captions or typography, no recognisable human faces, no photoreal facial features, no real person likeness, no celebrity, no copyrighted character.',
    imagePromptRules: [
      'Order: the observed subject first, then its real setting, then the natural light direction, then one quiet background detail.',
      'Frames are still and honest: name a tripod-locked wide, medium or detail shot. Never a dramatic or heroic angle.',
      'Prefer real workaday detail over polish — a worn desk, a real screen, an actual document.',
      'NO text, typography or lettering inside the image.',
      'NO recognisable human faces. Hands at work, a figure from behind, or a silhouette at a window.',
      'Recurring subjects must be described with IDENTICAL wording every time they appear.',
    ],
    animationNote:
      'Five-second shot. The frame settles almost imperceptibly into place, then holds with a slow, steady pan and the faintest scale drift — one continuous locked-off observation. Minimal transitions: nothing cuts hard, nothing wipes.',
    musicPrompt:
      'Sparse documentary score: single sustained cello note, distant felt piano, a slow warm drone underneath, almost no percussion. Patient, serious, leaves space for the narrator. Around sixty-five beats per minute.',
    sfxSuggestion: 'Quiet room tone, distant keyboard taps, a page turning, the low hum of an office in the background.',
    musicVolume: 0.16,
    sfxVolume: 0.24,
    captionLook: 'minimal',
    visual: {
      background: '#14120E',
      entrance: 'settle',
      hold: 'slowpan',
      stepFrames: 0,
      motionBlurPx: 0,
      vignette: 0.2,
      grain: 0.05,
      letterbox: 0,
      filter: 'saturate(0.88) contrast(1.04)',
      holdScale: 1.035,
    },
  },
  {
    id: 'showcase',
    name: 'Product Showcase',
    blurb: 'Clean white background, a slow product reveal and elegant typography — the premium launch look.',
    icon: 'Gem',
    clipSeconds: 4,
    wordsPerBeat: 9,
    allowsUrl: true,
    scriptTone:
      'Quietly premium. Spare, precise, confident — a luxury product page read aloud. Few words, each one chosen. Never breathless, never a hard sell; the restraint is the pitch.',
    scriptRules: [
      'Fewer words than feels comfortable. If a line can lose a word, lose it.',
      'Lead with what the thing IS and what it does, in plain nouns and verbs. One feature per scene, never a list.',
      'No superlatives and no adjective stacking. Describe, do not praise.',
      'Close with one calm imperative and the product name.',
    ],
    visualDirectionRule:
      'Each scene\'s visual is one studio product frame: name the product or detail in view, how it is positioned, and where the soft light falls. One object, nothing else.',
    styleLock:
      'Premium studio product photograph on a seamless white-to-pale-grey neutral background, one object centred with immaculate negative space around it, large soft diffused key light from above and slightly left with a gentle gradient falloff, delicate contact shadow beneath, crisp material detail showing real surface finish, clean true-white balance with a restrained palette, subtle specular highlights along the edges, shallow but controlled depth of field. Apple-grade commercial product photography, 16:9, ultra detailed.',
    negative:
      'NOT cartoon, NOT illustration, NOT 3D toy render, no busy or coloured background, no props, no clutter, no harsh shadows, no gradients behind the product, no watermark, no logos, no on-image text or captions or typography, no recognisable human faces, no photoreal facial features, no real person likeness, no celebrity, no copyrighted character.',
    imagePromptRules: [
      'Exactly ONE object or one product detail per frame. If the beat mentions two things, pick the one that matters.',
      'Order: the object and its material first, then its position and angle in frame, then the soft light direction, then the neutral backdrop note.',
      'Say how much empty space surrounds it — this style lives on negative space.',
      'NO text, typography or lettering inside the image; the film adds its own elegant type.',
      'NO people and NO hands unless the beat is specifically about holding the product, in which case hands only.',
      'The product must be described with IDENTICAL wording in every beat it appears in, so it reads as the same object throughout.',
    ],
    animationNote:
      'Four-second shot. The frame settles in without fuss and then reveals slowly with a gentle push-in — smooth, unhurried, camera almost still. Bright neutral backdrop, no grain, no vignette. The pace is the product.',
    musicPrompt:
      'Minimal premium underscore: clean sine-marimba pulse, a single warm pad, sparse plucked notes with long tails, soft sub bass on the downbeats. Elegant, spacious, unhurried. Around seventy-five beats per minute.',
    sfxSuggestion: 'A soft glassy chime on each reveal, a low airy swell between scenes, near-silent studio room tone.',
    musicVolume: 0.26,
    sfxVolume: 0.22,
    captionLook: 'clean',
    visual: {
      background: '#F4F5F7',
      entrance: 'settle',
      hold: 'pushin',
      stepFrames: 0,
      motionBlurPx: 0,
      vignette: 0,
      grain: 0,
      letterbox: 0,
      filter: 'brightness(1.02) saturate(1.04)',
      holdScale: 1.05,
    },
  },
];

export const DEFAULT_STYLE_ID: VideoStyleId = 'clip';

export function getStyle(id: string | null | undefined): VideoStyle {
  return VIDEO_STYLES.find((s) => s.id === id) ?? VIDEO_STYLES[0];
}

/**
 * The Remotion beat composition for a style. Clip Style returns its original
 * hand-authored template unchanged; the others are generated from their own
 * visual parameters.
 */
export function beatCompositionFor(style: VideoStyle): string {
  if (style.id === 'clip') return CLIP_STYLE_REMOTION_COMPOSITION;
  return buildBeatComposition(style.visual, style.clipSeconds);
}

/** The full image-generation prompt for one beat: prompt line + global blocks. */
export function buildStyledImagePrompt(style: VideoStyle, promptLine: string): string {
  return promptLine.trim() + '\n\nSTYLE LOCK\n' + style.styleLock + '\n\nNEGATIVE\n' + style.negative;
}

// ---------------------------------------------------------------------------
// Captions / SRT
// ---------------------------------------------------------------------------

export interface CaptionCue { start: number; end: number; text: string }

function srtStamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return pad(Math.floor(ms / 3600000)) + ':' + pad(Math.floor((ms % 3600000) / 60000)) + ':' +
    pad(Math.floor((ms % 60000) / 1000)) + ',' + pad(ms % 1000, 3);
}

/**
 * Caption cues for a styled run. Every clip is exactly `clipSeconds` long and
 * carries exactly one beat of narration, so the timing is exact rather than
 * transcribed — no speech recognition needed.
 */
export function captionCues(beatTexts: string[], clipSeconds: number): CaptionCue[] {
  return beatTexts.map((text, i) => ({
    start: i * clipSeconds,
    end: (i + 1) * clipSeconds,
    text: String(text || '').trim(),
  })).filter((c) => !!c.text);
}

/** A downloadable .SRT file for the run's captions. */
export function buildSrt(cues: CaptionCue[]): string {
  if (!cues.length) return '';
  return cues
    .map((c, i) => (i + 1) + '\n' + srtStamp(c.start) + ' --> ' + srtStamp(c.end) + '\n' + c.text)
    .join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// The finish composition — the beat clips re-sequenced under the audio beds
// ---------------------------------------------------------------------------

/**
 * The FINISH pass. It lays down everything that has to span the whole film:
 * the ElevenLabs narration voiceover, the background-music bed, the separate
 * sound-effects bed, and — when the customer turned the optional captions
 * toggle on — burned-in captions.
 *
 * The picture comes from `clipUrls`: every beat clip is placed in its own
 * <Sequence>, `clipDurationFrames` apart, so the render only ever reads the
 * clip renders. A single `videoUrl` is still honoured for callers that finish
 * an already-joined film (Sound Studio).
 *
 * Both audio beds loop, because ElevenLabs returns a fixed-length clip that is
 * usually shorter than the finished film.
 */
export function buildFinishComposition(
  captionLook: VideoStyle['captionLook'],
  clipDurationFrames = 120,
): string {
  const look = CAPTION_LOOKS[captionLook];
  const clipFrames = Math.max(1, Math.round(Number(clipDurationFrames) || 120));
  return `
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

// Finish pass: narration + music bed + sound-effects bed (+ optional burned
// captions) over the film. Generated by buildFinishComposition in
// apps/ProductStudio/videoStyles.ts.
//
// The beat clips are sequenced here rather than read back out of the joined
// MP4: Remotion Cloud Run can only reliably fetch its own bucket, which is
// where the per-beat renders land. The joined film lives in audos-images,
// which the renderer cannot read, so sourcing it produced a black, silent
// video with the audio layers playing over nothing.
const CLIP_FRAMES = ${clipFrames};

function Caption({ text }) {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: ${look.bottom}, pointerEvents: 'none' }}>
      <div style={{
        opacity: fade,
        maxWidth: '78%',
        textAlign: 'center',
        fontFamily: ${JSON.stringify(look.fontFamily)},
        fontSize: ${look.fontSize},
        fontWeight: ${look.fontWeight},
        lineHeight: 1.28,
        letterSpacing: ${look.letterSpacing},
        textTransform: '${look.textTransform}',
        color: '${look.color}',
        background: '${look.background}',
        borderRadius: ${look.radius},
        padding: '${look.padding}',
        textShadow: '${look.textShadow}',
      }}>{text}</div>
    </AbsoluteFill>
  );
}

export default function FinishedFilm(props) {
  // The render service probes this bundle with no inputProps before the real
  // render, so nothing here may throw on an empty props object.
  const p = props || {};
  const clipUrls = Array.isArray(p.clipUrls)
    ? p.clipUrls.filter(function (u) { return typeof u === 'string' && u.length > 0; })
    : [];
  const clipFrames = Number(p.clipDurationFrames) > 0 ? Math.round(Number(p.clipDurationFrames)) : CLIP_FRAMES;
  const videoUrl = typeof p.videoUrl === 'string' ? p.videoUrl : '';
  const narrationUrl = typeof p.narrationUrl === 'string' ? p.narrationUrl : '';
  const musicUrl = typeof p.musicUrl === 'string' ? p.musicUrl : '';
  const sfxUrl = typeof p.sfxUrl === 'string' ? p.sfxUrl : '';
  const musicVolume = Number.isFinite(p.musicVolume) ? Number(p.musicVolume) : 0.22;
  const sfxVolume = Number.isFinite(p.sfxVolume) ? Number(p.sfxVolume) : 0.26;
  const showCaptions = p.showCaptions === true;
  const captions = Array.isArray(p.captions) ? p.captions : [];

  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const active = showCaptions
    ? captions.find(function (c) { return c && t >= Number(c.start) && t < Number(c.end); })
    : null;

  // Gentle fade out over the last half second so the film does not cut dead.
  const tail = interpolate(frame, [Math.max(0, durationInFrames - 15), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {clipUrls.length ? clipUrls.map(function (url, i) {
        return (
          <Sequence key={i} from={i * clipFrames} durationInFrames={clipFrames}>
            <OffthreadVideo src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </Sequence>
        );
      }) : (videoUrl ? (
        <OffthreadVideo src={videoUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : null)}
      {narrationUrl ? <Audio src={narrationUrl} volume={tail} /> : null}
      {musicUrl ? <Audio src={musicUrl} loop volume={musicVolume * tail} /> : null}
      {sfxUrl ? <Audio src={sfxUrl} loop volume={sfxVolume * tail} /> : null}
      {active ? <Caption text={String(active.text || '')} /> : null}
    </AbsoluteFill>
  );
}
`;
}

interface CaptionLook {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  textTransform: 'none' | 'uppercase';
  color: string;
  background: string;
  radius: number;
  padding: string;
  textShadow: string;
  bottom: number;
}

const CAPTION_LOOKS: Record<VideoStyle['captionLook'], CaptionLook> = {
  bold: {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 60,
    fontWeight: 900,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#FFFFFF',
    background: 'transparent',
    radius: 0,
    padding: '0',
    textShadow: '0 4px 22px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)',
    bottom: 140,
  },
  clean: {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 44,
    fontWeight: 600,
    letterSpacing: 0,
    textTransform: 'none',
    color: '#F8FAFC',
    background: 'rgba(10,15,30,0.72)',
    radius: 18,
    padding: '14px 30px',
    textShadow: 'none',
    bottom: 96,
  },
  serif: {
    fontFamily: "'Georgia', 'Times New Roman', serif",
    fontSize: 42,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: 'none',
    color: '#1C1810',
    background: 'rgba(244,240,227,0.9)',
    radius: 4,
    padding: '12px 26px',
    textShadow: 'none',
    bottom: 92,
  },
  minimal: {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 38,
    fontWeight: 500,
    letterSpacing: 0.2,
    textTransform: 'none',
    color: '#F5F3EE',
    background: 'transparent',
    radius: 0,
    padding: '0',
    textShadow: '0 2px 14px rgba(0,0,0,0.8)',
    bottom: 88,
  },
};
