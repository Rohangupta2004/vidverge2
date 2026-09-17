/**
 * Clip Style — the hand-cut paper collage animation style template for the
 * Product Video (Track B) creation pipeline.
 *
 * Every clip is exactly 4 seconds. The style is generic and brandless: aged
 * newsprint and archival map stock, monochrome halftone cutouts, ripped paper
 * edges, tape, typewriter slips, rubber stamps, red thread and brass pins,
 * with one hot red accent and a restrained mustard yellow secondary.
 *
 * This module holds the fixed prompt blocks (style lock, negative, universal
 * animation prompt) plus the pure beat/timecode helpers the ClipStyleWizard
 * uses. Nothing here touches the standard HyperFrames pipeline.
 */

export const CLIP_STYLE_NAME = 'Clip Style';

/** Narration pacing: ~2.5 spoken words per second. */
export const WORDS_PER_SECOND = 2.5;
/** Every Clip Style clip is exactly 4 seconds long. */
export const SECONDS_PER_CLIP = 4;
/** ~10 words per beat = ~4 seconds at 2.5 words/sec. */
export const WORDS_PER_BEAT = 10;
/** Total number of pipeline phases shown in the wizard. */
export const TOTAL_PHASES = 6;

export interface ClipDurationOption {
  id: string;
  label: string;
  /** Target length in seconds (null = custom, user supplies their own). */
  seconds: number | null;
  /** Approximate narration word target (null = derived from custom seconds). */
  words: number | null;
}

export const DURATION_OPTIONS: ClipDurationOption[] = [
  { id: '30s', label: '30 seconds', seconds: 30, words: 75 },
  { id: '1m', label: '1 minute', seconds: 60, words: 150 },
  { id: '2m', label: '2 minutes', seconds: 120, words: 300 },
  { id: 'custom', label: 'Custom', seconds: null, words: null },
];

export function wordsForSeconds(seconds: number): number {
  return Math.max(10, Math.round(seconds * WORDS_PER_SECOND));
}

/**
 * STYLE LOCK — applied globally to every generated image. Never repeated
 * inside individual beat prompt lines.
 */
export const CLIP_STYLE_LOCK =
  'scissor cut documentary paper collage built on aged newsprint and old archival map stock, monochrome halftone photograph cutouts with ragged hand cut borders and offset accent strokes, ripped paper edges, strips of masking tape, typewriter caption slips, rubber stamp impressions, red thread and brass pins wherever the story links two things together, a faded archive palette of tan, ink black and halftone grey carrying ONE hot red signal accent plus a restrained mustard yellow secondary, condensed bold display lettering only where a label has been specified, visible print grain and paper fibre, matte finish, flat even documentary lighting with soft cutout drop shadows. Every element must read as genuinely hand cut and physically layered from real paper, with exposed cut edges, halftone print texture and soft shadow separation between the layers. The layout stays clean, minimal and editorial with plenty of empty space. Premium documentary collage aesthetic, 16:9, ultra detailed.';

export const CLIP_STYLE_NEGATIVE =
  'NOT digital illustration, NOT cartoon, NOT 3D render, NOT glossy, no gradients, no clutter, no watermark, no logos, no text anywhere in the image beyond the label written into that specific line, no recognisable human faces, no photoreal facial features, no real person likeness, no celebrity, no copyrighted character.';

/**
 * The universal animation prompt for all Clip Style clips. Fixed — always the
 * same for every clip, regardless of the beat.
 */
export const CLIP_STYLE_ANIMATION_PROMPT = `Turn the supplied image into a 4 second premium editorial documentary paper collage animation. The final composition of the supplied image must be preserved exactly. Do not redesign, reposition, resize or swap any element. The supplied image is the FINISHED frame the animation is building towards.

Style: hand cut documentary paper collage in motion. Aged newsprint and archival surfaces, halftone photo cutouts, torn edges, tape, stamps, red thread, typewriter slips. Every element moves like a rigid physical piece of paper. Visible cutout thickness, print grain, soft layered shadows. Stop motion cadence, stepped easing, 2 to 3 frame holds. Never smooth CGI motion.

CAMERA RULES: the camera stays completely locked for the entire animation. No zoom, no pan, no tilt, no rotation, no orbit, no dolly, no tracking, no handheld drift, no focus pulls, no reframing, no cuts, no transitions, no morphs, no object replacement and no time jumps. The whole thing is one uninterrupted static shot from first frame to last.

0 TO 2.5 SECONDS, BUILD PROCESS. Begin on the empty background plate alone, showing the aged newsprint or archival surface. None of the story elements are visible yet. The collage assembles itself back to front. Background scraps settle first. The hero cutout slides in with paper drag and a gentle settle. Supporting cutouts arrive one by one and pin down with a two frame stamped landing. Tape presses onto the surface. Typewriter labels slide into position. Rubber stamps land with a stamping motion. Red thread draws itself between the pins. Marker underlines and arrows come last. Every arriving element settles with a small handmade bounce and throws a realistic layered shadow. Once a piece has landed it stays perfectly still. The build is brisk so that by the two and a half second mark the composition matches the supplied image exactly.

2.5 TO 4 SECONDS, LIVING POSTER. The finished collage holds. Only the faintest signs of life are permitted. Paper corners may lift a fraction. Halftone texture may shimmer softly. The thread may vibrate once. Shadows may breathe gently. No element changes position. Nothing scales. Nothing rotates. Nothing new enters and nothing leaves.

AUDIO. Diegetic sound effects only. No music of any kind: no score, no soundtrack, no background music, no melody, no instruments, no piano, no strings, no guitar, no synth pad, no ambient drone, no hum, no rhythm, no percussion, no beat, no swell, no riser, no stinger. No narration, no voices, no speech. Only close miked physical paper sound effects plus faint room tone: paper sliding, cardstock taps, tape pressing and peeling, stamp impacts, thread movement, pin clicks.`;

/**
 * The fixed Remotion composition that animates every Clip Style beat.
 * Rendered server-side through the platform's proven Remotion pipeline
 * (POST /api/render/remotion — the same renderer trackb-render jobs use).
 * The finished collage frame arrives through props as imageUrl, because the
 * render endpoint requires image URLs to be passed via props, never inlined
 * in the composition source. 120 frames at 30fps = the fixed 4s clip:
 * 0–2.5s stepped stop-motion build onto the aged-paper plate, 2.5–4s
 * living-poster hold with only shadow breathing and a faint grain shimmer.
 */
export const CLIP_STYLE_REMOTION_COMPOSITION = `
import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion';

// Clip Style beat: the supplied image IS the finished hand-cut paper collage
// frame. It slides in like a rigid sheet of paper with a stepped stop-motion
// cadence, settles to match the supplied image exactly by 2.5 seconds, then
// holds as a living poster. The camera stays completely locked throughout.
export default function ClipStyleBeat(props) {
  const imageUrl = props && props.imageUrl ? String(props.imageUrl) : '';
  const frame = useCurrentFrame();
  const fps = 30;
  const buildEnd = Math.round(fps * 2.5);
  // Stop-motion cadence: 3-frame holds during the build, smooth-free by design.
  const stepped = frame < buildEnd ? Math.floor(frame / 3) * 3 : frame;

  // Paper drag entrance with a small handmade overshoot and settle.
  const slide = interpolate(stepped, [6, 27, 36, 45], [110, -2, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const reveal = interpolate(stepped, [6, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tilt = interpolate(stepped, [6, 30, 45], [1.7, -0.35, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const settle = interpolate(stepped, [30, 42, 52], [1.012, 0.997, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Living poster: after the build only the layered shadow breathes gently.
  const holdPhase = Math.max(0, frame - buildEnd);
  const buildShadow = interpolate(stepped, [6, 45], [0.05, 0.32], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shadowAlpha = frame < buildEnd ? buildShadow : 0.32 + 0.05 * Math.sin(holdPhase / 14);

  return (
    <AbsoluteFill style={{ backgroundColor: '#d8cdb4', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 42%, rgba(255,251,236,0.5) 0%, rgba(160,143,106,0.28) 78%, rgba(96,84,60,0.38) 100%)' }} />
      {imageUrl ? (
        <Img
          src={imageUrl}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: reveal,
            transform: 'translateY(' + slide + 'px) rotate(' + tilt + 'deg) scale(' + settle + ')',
            boxShadow: '0 26px 60px rgba(40,30,12,' + shadowAlpha.toFixed(3) + ')',
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          mixBlendMode: 'multiply',
          opacity: 0.08 + 0.012 * Math.sin(frame / 5),
          background: 'repeating-linear-gradient(0deg, rgba(60,50,30,0.16) 0px, rgba(60,50,30,0.16) 1px, transparent 1px, transparent 3px)',
        }}
      />
    </AbsoluteFill>
  );
}

export const calculateDemoVideoDuration = () => 120;
`;

/** The rules the Phase 3 scriptwriter must follow, verbatim in the AI prompt. */
export const SCRIPT_RULES = [
  'Natural spoken English with a documentary delivery tone, never marketing fluff.',
  'Open directly with a concrete fact about the product, a year, the problem it solves, or a real moment.',
  "Never open with generic openers such as Welcome, Imagine, Have you ever, or In today's video.",
  'Short to medium sentences. Every sentence lands one clear idea.',
  'No commas, no em dashes, no en dashes, no semicolons, no colons, no brackets, no ellipses, no quotation marks, no asterisks, no slashes, no emoji, no symbols.',
  'The only allowed punctuation is the full stop and the question mark. Apostrophes in contractions are fine.',
  'Write numbers, money, dates and percentages as spoken words, for example twenty twenty three instead of 2023.',
  'End on a product takeaway, an open question, or a consequence. No generic sign off.',
];

export function countWords(text: string): number {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function beatCode(index: number): string {
  return 'B' + String(index + 1).padStart(3, '0');
}

/**
 * Enforce the Clip Style narration punctuation rules on AI (or user-edited)
 * script text: only full stops and question marks survive, apostrophes in
 * contractions are preserved, everything else becomes a space or a stop.
 */
export function sanitizeNarration(raw: string): string {
  let t = String(raw || '');
  t = t.replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/[\u201C\u201D"]/g, ' ');
  t = t.replace(/\u2026|\.{3,}/g, '. ');
  t = t.replace(/[!;:]/g, '. ');
  t = t.replace(/[,\u2014\u2013()\[\]{}*\\/#%^~|<>+=_&@]/g, ' ');
  // Emoji and pictographs out; letters (including accented) stay.
  t = t.replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{27BF}\u{FE0F}]/gu, ' ');
  // Stray quote-style apostrophes (word-leading/trailing) out; contractions stay.
  t = t.replace(/(^|\s)'+|'+(?=\s|$)/g, ' ');
  t = t.replace(/\s+([.?])/g, '$1');
  t = t.replace(/\.{2,}/g, '.');
  t = t.replace(/([.?])(?=\S)/g, '$1 ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

export interface ClipBeat {
  code: string;
  /** Timecode start in seconds: running word count ÷ 2.5, rounded to 1 decimal. */
  startSec: number;
  text: string;
  wordCount: number;
}

/**
 * Deterministic beat cutter: ~10-word chunks in order, nothing dropped. A
 * trailing fragment shorter than 4 words merges into the previous beat.
 */
export function chunkScriptIntoBeatTexts(script: string): string[] {
  const words = String(script || '').trim().split(/\s+/).filter(Boolean);
  const texts: string[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_BEAT) {
    texts.push(words.slice(i, i + WORDS_PER_BEAT).join(' '));
  }
  if (texts.length > 1) {
    const last = texts[texts.length - 1];
    if (countWords(last) < 4) {
      texts.splice(texts.length - 2, 2, texts[texts.length - 2] + ' ' + last);
    }
  }
  return texts;
}

/** Attach beat codes and running-word-count timecodes to ordered beat texts. */
export function toClipBeats(beatTexts: string[]): ClipBeat[] {
  let running = 0;
  return beatTexts.map((text, i) => {
    const startSec = Math.round((running / WORDS_PER_SECOND) * 10) / 10;
    const wordCount = countWords(text);
    running += wordCount;
    return { code: beatCode(i), startSec, text: text.trim(), wordCount };
  });
}

function normalizedWords(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\u00c0-\u024f?. ]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * A proposed AI beat segmentation is only accepted when its concatenation
 * reproduces the script word for word, in order, with nothing dropped.
 */
export function segmentsMatchScript(script: string, segments: string[]): boolean {
  return normalizedWords(segments.join(' ')) === normalizedWords(script);
}

/** The full image-generation prompt for one beat: prompt line + global blocks. */
export function buildBeatImagePrompt(promptLine: string): string {
  return promptLine.trim() + '\n\nSTYLE LOCK\n' + CLIP_STYLE_LOCK + '\n\nNEGATIVE\n' + CLIP_STYLE_NEGATIVE;
}

/** mm:ss.d display for the beat table. */
export function formatTimecode(sec: number): string {
  const whole = Math.floor(sec);
  const dec = Math.round((sec - whole) * 10);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return m + ':' + String(s).padStart(2, '0') + '.' + dec;
}
