// Product Videos — AI Ad Director style presets + the Remotion coding agent's
// brief.
//
// THE COMPOSITION IS NOT HARDCODED. Every ad's Remotion composition is WRITTEN
// PER-AD by a coding agent that specialises in Remotion product commercials
// (gpt-5.6-sol on the platform text path). This module is the canonical copy
// of everything that agent is given:
//   - AD_STYLE_PRESETS: the founder-selectable art directions. Each preset's
//     `direction` is the detailed text the coding agent reads and codes from.
//   - REMOTION_CODER_SYSTEM: the specialist system prompt with every hard
//     rule (determinism, imports, audio ducking, word-snapped captions, the
//     DATA contract, the injected-data marker).
//   - buildCoderBrief(): the per-ad user message — timeline, script, asset
//     inventory and the chosen preset's full direction.
//   - validateAdComposition(): the acceptance gate the generated code must
//     pass before it is rendered.
// The deterministic SaaSHeroMotion template (compositions/SaaSHeroMotion.tsx)
// remains ONLY as the safety fallback when generated code fails validation or
// rendering — it is never the first choice.
//
// THE LIVE COPY OF ALL OF THIS IS INLINED IN THE pv-ad-director SERVER
// FUNCTION (hook code cannot import workspace files). Change both together.

export interface AdStylePreset {
  id: string;
  name: string;
  /** One line shown in the app's preset picker. */
  blurb: string;
  /** The detailed art direction the Remotion coding agent codes from. */
  direction: string;
}

export const AUTO_PRESET_ID = 'auto';

export const AD_STYLE_PRESETS: AdStylePreset[] = [
  {
    id: 'isometric-studio',
    name: 'Isometric Studio',
    blurb: 'Cinematic dark studio · 3D floating UI · glass light sweep',
    direction: [
      'ISOMETRIC STUDIO — the premium dark-studio SaaS look.',
      'Canvas #05070C. The Veo backdrop plate (or a deep indigo-and-amber radial gradient when there is no plate) sits behind everything at brightness ~0.5 with a slow 1.06→1.16 zoom.',
      'The product screenshot is the hero: a 1240x720 card in a perspective(1200px) 3D stage, border-radius 26, 1px rgba(255,255,255,0.16) border, deep layered shadows, a faint top glass sheen, and a mirrored floor reflection fading out below.',
      'Card motion: spring in from rotateY ~30°/rotateX ~16°/scale 0.6 to a settled rotateY -8°/rotateX 7°/scale 1.0 at the solution beat, with CONTINUOUS gyro drift (sin/cos of frame, ±2.4° and ±1.7°) and ±6px vertical float — never frozen.',
      'A glassmorphism light sweep crosses the card: linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%) translating across every ~4.4s.',
      'Type: Inter/Geist, tight -0.03em headlines in near-white with heavy soft shadows. Accent gold #F5B936→#FFD84D for the CTA pill. Breathing radial vignette on top.',
    ].join('\n'),
  },
  {
    id: 'neon-launch',
    name: 'Neon Launch',
    blurb: 'Electric gradients · glow edges · high-energy motion',
    direction: [
      'NEON LAUNCH — an electric, launch-night keynote look.',
      'Canvas near-black #060312 washed by two drifting radial glows: violet rgba(139,92,246,≤.35) upper-left and cyan rgba(34,211,238,≤.28) lower-right, positions oscillating with the frame. Dim any Veo plate to ~0.35 brightness underneath and tint it with the glows.',
      'The screenshot card wears a 2px neon gradient border (violet→cyan, use a padded gradient wrapper div), border-radius 24, and an outer glow shadow (0 0 60px rgba(139,92,246,0.35)). 3D perspective stage with a slightly faster, snappier spring (stiffness ~160) and ±3° gyro drift.',
      'The light sweep is a cyan-tinted specular pass. Headlines are 900-weight, uppercase, letter-spacing -0.02em, white with a violet→cyan gradient on ONE emphasised word (background-clip text).',
      'Caption pills glow when active. CTA pill: cyan→violet gradient, white text, pulsing glow shadow. Motion is punchy: shorter springs, small overshoots, quick staggered entrances — but still 100% deterministic.',
    ].join('\n'),
  },
  {
    id: 'minimal-daylight',
    name: 'Minimal Daylight',
    blurb: 'Bright editorial · soft shadows · calm precise motion',
    direction: [
      'MINIMAL DAYLIGHT — a bright, airy, editorial product film.',
      'Canvas warm off-white #F7F6F2 with a very soft top-left daylight gradient. If a Veo plate exists, show it heavily lifted: brightness ~1.05, opacity ~0.35, blur 4px — an atmospheric wash, not a scene. Ink text #14161C, muted ink rgba(20,22,28,0.55).',
      'The screenshot card: border-radius 20, 1px rgba(20,22,28,0.08) border, big soft diffuse shadow (0 40px 90px rgba(20,22,28,0.14)), NO reflection. Gentle 3D: settle at rotateY -5°/rotateX 4°, slow ±1.2° drift, ±4px float.',
      'The light sweep is subtle: rgba(255,255,255,0.5) at 40% width gliding slowly.',
      'Typography is the star: large serif-feeling Inter at -0.04em tracking, generous whitespace, thin 1px rule lines that draw themselves in (scaleX via spring). Captions: ink pills on rgba(20,22,28,0.06); the active word inverts to an ink pill with off-white text (NOT yellow — this preset’s highlight is ink).',
      'CTA: solid ink pill, off-white text, tiny 1.5% pulse. All motion slow, eased, precise.',
    ].join('\n'),
  },
  {
    id: 'luxury-noir',
    name: 'Luxury Noir',
    blurb: 'Black & gold · slow elegant moves · serif accents',
    direction: [
      'LUXURY NOIR — black-card luxury for premium products.',
      'Canvas pure #000 with a faint warm radial (rgba(212,175,55,0.10)) breathing behind the subject. A Veo plate runs at ~0.4 brightness with +10% contrast and a gold-tinted color wash (sepia-ish filter).',
      'The screenshot card: border-radius 18, a 1px champagne-gold border rgba(212,175,55,0.5), inner hairline (second nested border div), long soft shadow, and a slow mirrored reflection at 10% opacity. 3D settle at rotateY -6°/rotateX 5° with VERY slow ±1° drift — the card floats like jewellery on velvet.',
      'The light sweep is a narrow gold-white specular line (rgba(255,240,200,0.28)) passing every ~6s.',
      'Type: headlines in high-contrast serif feel (use "Playfair Display, Georgia, serif" — Google Fonts are available in the renderer), champagne #E8D9A0; body/captions in Inter. Letter-spacing +0.06em uppercase kickers.',
      'Captions: minimal — no pills; active word turns gold #D4AF37 with a fine underline that draws in. CTA: gold-outlined pill (transparent fill) that fills to gold on the pulse peaks. Every movement is slow (springs damping ~20) and deliberate.',
    ].join('\n'),
  },
  {
    id: 'bold-kinetic',
    name: 'Bold Kinetic',
    blurb: 'Huge type · color blocks · fast startup energy',
    direction: [
      'BOLD KINETIC — loud, type-first startup energy.',
      'Canvas alternates per beat between a saturated brand block and near-black: hook on the brand accent colour (DATA.accent, else #4F46E5) as a FULL-BLEED background with giant contrasting type; solution on #0A0A0F; CTA back on the accent. Beat transitions are hard cuts with a 6-frame wipe (a full-screen div scaling X from 0→1→0).',
      'Hook headline: enormous (140-170px), 900 weight, words slamming in one by one with overshoot springs and ±1.5° rotation offsets. Nothing sits still — idle words breathe ±1%.',
      'The screenshot card enters with a fast spring and a visible overshoot, settles at rotateY -10° with ±3° gyro drift, thick 3px solid border in the accent colour, hard offset shadow (16px 16px 0 rgba(0,0,0,0.35)) — poster-style, not glassy. Skip the reflection; keep a bold light sweep.',
      'Captions: chunky pills, active word on #FFD84D with black text, spoken words white on black. CTA: massive pill in white with black text on the accent background, pulsing 4%.',
      'Any Veo plate appears ONLY during the solution beat at low opacity under the dark block.',
    ].join('\n'),
  },
  {
    id: 'product-spotlight',
    name: 'Product Spotlight',
    blurb: 'Launch-page split layout · kicker pills · feature rows · callout chips',
    direction: [
      'PRODUCT SPOTLIGHT — the polished launch-page look (modelled on a hand-designed SaaS promo): deep space canvas, split layouts, kicker pills, two-tone headlines, feature rows, floating callout chips.',
      'Canvas #050A14 with a faint dot-grid texture (a subtle repeating radial-gradient of 1px dots at ~40px spacing, opacity ~0.35) and a soft breathing vignette. EMOTIONAL COLOR ARC: the hook beat carries a subtle RED wash (a corner glow rgba(220,60,60,0.14) and red accents) for the pain; the solution and CTA beats switch to the product blue — DATA.accent when set, else #4D9FFF — with cyan support #39D0D8.',
      'LAYOUT IS SPLIT, never center-stacked: the text block sits on one side (kicker pill → two-line headline → muted supporting line → feature rows), the screenshot card on the other; mirror the sides between beats for variety.',
      'KICKER PILLS: above each headline a small uppercase pill (12px, letter-spacing 0.08em, 1px colored border, small colored dot) using DATA.beats[i].kicker when present — red-tinted on the hook, blue on solution/CTA.',
      'HEADLINES: 800-900 weight, -0.03em tracking, ~64-84px, TWO-TONE: most words near-white #F2F5FA, the emotional key phrase in the beat accent (red on the hook, a blue→cyan gradient via background-clip text on the solution).',
      'FEATURE ROWS (solution beat, when DATA.features is set): up to 3 rounded rows (radius 12, background rgba(255,255,255,0.03), 1px rgba(255,255,255,0.07) border), each a small colored square icon dot + bold title + muted detail, spring-staggered 8 frames apart, idle breathing ±1%.',
      'THE SCREENSHOT CARD: framed like a floating device/browser — border-radius 22, 1px rgba(255,255,255,0.14) border, deep blue glow shadow (0 40px 120px rgba(40,90,220,0.25)), perspective(1200px) settling at rotateY -7°/rotateX 4° with slow ±1.6° gyro drift and ±5px float. Over its corners float 1-2 CALLOUT CHIPS (small dark pills, colored icon dot, short labels drawn from DATA.beats subtitles or DATA.tagline) that spring in late and drift ±3px. Keep the light sweep subtle (white 0.18).',
      'Backdrop: any Veo plate at very low presence (opacity ~0.25, blur 3px) beneath the canvas tint; without one the dot-grid canvas + glows carry the atmosphere — always breathing, never static.',
      'CAPTIONS: compact pills; the active word inverts to the beat accent with white text. CTA: blue→cyan gradient pill, logo + title above it, the domain in muted type below.',
    ].join('\n'),
  },
];

export function presetById(id: string | null | undefined): AdStylePreset {
  return AD_STYLE_PRESETS.find((p) => p.id === String(id || '')) || AD_STYLE_PRESETS[0];
}

/**
 * The exact line the coding agent must emit. The pipeline replaces the marker
 * with the real payload JSON after generation — the agent never wastes tokens
 * echoing URLs or timestamp tables, and the data can never be mistyped.
 */
export const AD_DATA_MARKER = '/*__AD_DATA__*/ null';

export const REMOTION_CODER_SYSTEM = [
  'You are an elite Remotion motion engineer who specialises in premium 25-second SaaS product commercials. You write complete, production-ready Remotion composition code — nothing else.',
  '',
  'NON-NEGOTIABLE ENGINEERING RULES:',
  "1. DETERMINISM: every visual value is a pure function of useCurrentFrame(). No CSS animations/transitions, no setTimeout/setInterval/requestAnimationFrame, no Math.random, no Date, no fetch, no window/document.",
  "2. IMPORTS: only from 'remotion' (AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig) and 'react'. No @remotion/* subpackages, no other libraries.",
  '3. GEOMETRY: 1920x1080 @ 30fps. The film’s EXACT total length in frames is stated in the brief and in DATA.durationInFrames — export const calculateDemoVideoDuration = () => <that exact literal number>; Keep text inside ~120px safe margins. Export default function MotionVideo().',
  "4. THE DATA CONTRACT: near the top emit EXACTLY this line — const DATA: any = /*__AD_DATA__*/ null; — the pipeline replaces the marker with the real JSON. Read EVERYTHING from DATA and always access it as DATA.<field> (never destructure DATA — the automated acceptance check looks for DATA.screenshotUrl, DATA.captionLines, DATA.beats, DATA.backdropUrl, DATA.logoUrl and DATA.duckWindows). Never invent text, URLs, colours-as-content, or assets that are not in DATA.",
  '   DATA shape: { title, tagline, ctaText, ctaUrl, accent (hex|null), brand ({ palette: [{ hex, count }], themeColor, fonts }|null), logoUrl (url|null), screenshotUrl, backdropUrl (mp4 url|null), musicUrl (mp3 url|null), durationInFrames, features ([{ title, detail }]|null), beats: [{ id: "hook"|"solution"|"cta", from, durationFrames, subtitle, kicker, voUrl (url|null), voFrames }], captionLines: [{ from, to, words: [{ word, startFrame, endFrame }] }], duckWindows: [{ from, to }] }.',
  '5. VOICE-DRIVEN BEAT TIMING: the three beats (hook → solution → cta) start and last EXACTLY as DATA.beats[i].from / durationFrames say — these were derived from the recorded narration; never invent your own timings. hook = the relatable frustration (kinetic headline from beats[0].subtitle); solution = the product screenshot is the HERO on a 3D stage with title + beats[1].subtitle; cta = payoff with title, beats[2].subtitle and a pulsing CTA pill (DATA.ctaText, DATA.ctaUrl below it). Each beat may carry beats[i].kicker (short uppercase eyebrow line — render it as a small pill above the headline when the art direction calls for one), and DATA.features may hold up to 3 { title, detail } rows grounded in the product page — render them on the solution beat when present; both may be empty/null.',
  '6. SCREENSHOT (the star): render DATA.screenshotUrl with <Img> inside a perspective(1200px) 3D card treatment per the art direction. It must carry continuous subtle motion (gyro drift + float) — NO element in the film is ever fully stationary.',
  '7. LIGHT SWEEP: an absolute overlay clipped to the card running linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%) (tint per art direction), translated across the card by the frame counter on a loop.',
  "8. BACKDROP: when DATA.backdropUrl is set, cover the frame with <OffthreadVideo muted src={DATA.backdropUrl}> tiled in <Sequence> blocks of 236 frames (Math.ceil(DATA.durationInFrames/236) tiles) under a slow zoom, dimmed/tinted per art direction. When null, build the preset's gradient atmosphere instead — also in motion.",
  '9. LOGO: when DATA.logoUrl is non-null you MUST render it (solution beat title row AND the CTA beat, objectFit contain, drop shadow). When null render no logo and no invented mark.',
  '10. AUDIO: at the root render the music ONCE when DATA.musicUrl is set: <Audio src={DATA.musicUrl} volume={(f) => musicVolume(f)} /> where musicVolume ducks from 0.5 to 0.5*0.251 (-12 dB) inside every DATA.duckWindows window with 12-frame interpolate ramps, returning to full outside (the CTA rises). For each beat with voUrl && voFrames > 0 mount <Sequence from={beat.from} durationInFrames={Math.min(beat.voFrames, DATA.durationInFrames - beat.from)}><Audio src={beat.voUrl} /></Sequence>.',
  '11. KINETIC CAPTIONS: render DATA.captionLines — show the line where from <= frame < to; each word pops in with a snappy spring at word.startFrame; the word currently being spoken (startFrame <= frame < endFrame) carries the highlight treatment from the art direction; spoken words settle to the resting style; upcoming words are dimmed. Bottom-center, ~44px, never overlapping the CTA pill.',
  '12. Springs: config { damping: 15, stiffness: 120, mass: 0.8 } as the base (art direction may vary it). Stagger children; headline words cascade 4-6 frames apart.',
  '13. WEBSITE COLOUR THEME: when DATA.brand is set, the film’s palette comes from THE PRODUCT’S OWN SITE — build the background/surface/text/accent colours from DATA.brand.palette (real hex values harvested from their pages, ordered by usage), DATA.brand.themeColor and DATA.accent, and prefer DATA.brand.fonts (with system fallbacks) for the type. The style preset dictates LAYOUT, TYPE SCALE and MOTION CHARACTER — not the colours; fall back to the preset palette only when DATA.brand is null. Always keep strong text/background contrast.',
  '14. TRANSCRIPT CHOREOGRAPHY: the word timeline in DATA.captionLines is the film’s conductor — sync visual emphasis to it: pop the matching headline word, pulse a feature row, or fire an accent flash exactly on the startFrame of key spoken words, and land scene transitions on the gaps between caption lines (sentence boundaries).',
  '15. FOUNDER REVISION NOTES: when the brief contains revision notes from a previous cut, they OVERRIDE everything else — implement every note faithfully in this new composition.',
  '',
  'OUTPUT: ONLY the complete TSX source. No markdown fences, no commentary.',
].join('\n');

export interface CoderBriefInput {
  preset: AdStylePreset;
  title: string;
  tagline: string;
  ctaText: string;
  ctaUrl: string;
  accent: string | null;
  hasLogo: boolean;
  hasBackdrop: boolean;
  hasMusic: boolean;
  beats: Array<{ id: string; subtitle: string; narration: string; kicker?: string; hasVoice: boolean }>;
  features?: Array<{ title: string; detail: string }> | null;
  wordCount: number;
}

/** The per-ad brief the Remotion coding agent receives as its user message. */
export function buildCoderBrief(input: CoderBriefInput): string {
  return [
    'Write the complete Remotion composition for this 25-second SaaS commercial.',
    '',
    '=== ART DIRECTION (follow it precisely) ===',
    input.preset.direction,
    '',
    '=== THIS AD ===',
    `Product: ${input.title} — ${input.tagline}`,
    `CTA pill text: "${input.ctaText}" · site shown under it: ${input.ctaUrl || '(none — omit the url line)'}`,
    `Brand accent from their site: ${input.accent || '(none — use the preset palette)'}`,
    `Logo: ${input.hasLogo ? 'PROVIDED in DATA.logoUrl — render it per rule 9.' : 'none — render no logo anywhere.'}`,
    `Backdrop plate: ${input.hasBackdrop ? 'PROVIDED (photoreal Veo clip) — rule 8 tiling.' : 'none — build the preset gradient atmosphere.'}`,
    `Music bed: ${input.hasMusic ? 'provided — duck per rule 10.' : 'none — skip the root Audio.'}`,
    '',
    'Beats (timing is FIXED by the grid in rule 5; subtitles below are the on-screen lines):',
    ...input.beats.map((b) => `- ${b.id}: ${b.kicker ? `kicker "${b.kicker}" · ` : ''}subtitle "${b.subtitle}" · narration "${b.narration}" · voiceover ${b.hasVoice ? 'recorded (mount per rule 10)' : 'not recorded'}`),
    input.features && input.features.length
      ? `Feature rows in DATA.features (real page facts): ${input.features.map((f) => `${f.title} — ${f.detail}`).join(' | ')}`
      : 'No feature rows for this ad (DATA.features is null).',
    `Word-timed captions: ${input.wordCount} words in DATA.captionLines — render per rule 11.`,
    '',
    'Remember: emit the exact DATA marker line, read all URLs/frames/words from DATA, keep every element in continuous subtle motion, and return ONLY the TSX source.',
  ].join('\n');
}

// Only the true determinism threats. 'window'/'document' are deliberately NOT
// scanned: the renderer IS a browser, and agents legitimately name loop
// variables 'window' when iterating DATA.duckWindows (a verified real output).
const FORBIDDEN_IN_GENERATED = [
  /\bfetch\s*\(/,
  /Math\.random\s*\(/,
  /\b(?:setInterval|setTimeout|requestAnimationFrame)\s*\(/,
  /\bDate\.now\s*\(|new Date\s*\(/,
];

// The agent often ECHOES the rules in comments ('no window access', 'no
// setTimeout') — scan only real code, never comments.
function stripComments(code: string): string {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Acceptance gate for the coding agent's output. Throws with a reason. */
export function validateAdComposition(code: string, expectedFrames?: number): void {
  if (code.length < 1500) throw new Error('the generated composition was incomplete');
  if (code.indexOf(AD_DATA_MARKER) < 0) throw new Error('the generated composition dropped the DATA marker line');
  code = stripComments(code);
  if (!/export\s+default\s+function\s+MotionVideo\b|export\s+default\s+MotionVideo\b/.test(code)) {
    throw new Error('the generated composition must default-export MotionVideo');
  }
  const durMatch = /calculateDemoVideoDuration\s*=\s*\(\)\s*=>\s*(\d+)/.exec(code);
  if (!durMatch) throw new Error('the generated composition must export calculateDemoVideoDuration = () => <frames>');
  if (expectedFrames && Number(durMatch[1]) !== Number(expectedFrames)) {
    throw new Error(`the generated composition declared ${durMatch[1]} frames but the narration-derived length is ${expectedFrames}`);
  }
  if (!/\buseCurrentFrame\b/.test(code) || !/\bspring\b/.test(code)) {
    throw new Error('the generated composition is missing frame-driven animation');
  }
  // Field-name presence, not literal DATA.x — a valid composition may alias or
  // destructure even though the prompt asks it not to.
  for (const ref of ['screenshotUrl', 'captionLines', 'beats', 'backdropUrl', 'logoUrl', 'duckWindows']) {
    if (!new RegExp(`\\b${ref}\\b`).test(code)) throw new Error(`the generated composition never uses ${ref}`);
  }
  const imports = Array.from(code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
  if (imports.some((source) => source !== 'remotion' && source !== 'react')) {
    throw new Error('the generated composition imported an unsupported library');
  }
  for (const pattern of FORBIDDEN_IN_GENERATED) {
    if (pattern.test(code)) throw new Error('the generated composition used a non-deterministic API');
  }
}
