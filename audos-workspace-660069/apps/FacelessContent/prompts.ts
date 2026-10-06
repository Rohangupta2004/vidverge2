/**
 * FACELESS CONTENT — the two writer system prompts and the parsers for what
 * they return. Which model answers them is decided by the ladder in api.ts,
 * not here.
 *
 * Call 1 (Faceless Script Writer) researches the topic and writes the whole
 * script: three title options, a thumbnail line, and timecoded blocks that
 * each carry a VO line and a VISUAL line, followed by a fact-check list.
 *
 * Call 2 (Faceless Video Prompts) turns ONE of those VISUAL lines into a shot
 * prompt a video model can actually execute — lens language only, numbers
 * instead of adjectives, positive phrasing throughout.
 *
 * Both prompts are plain text on purpose. These models write markedly better
 * prose against a stated craft rule than against a JSON schema, so the
 * structure is a labelled plain-text format that parseScript() reads back.
 */

export type Niche = 'explainer' | 'documentary' | 'crime';
export type Orientation = '16:9' | '9:16';

export const NICHES: { id: Niche; label: string }[] = [
  { id: 'explainer', label: 'Explainer' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'crime', label: 'Crime' },
];

export const LENGTHS = [2, 5, 8] as const;
export type TargetLength = (typeof LENGTHS)[number];

/** Roughly 150 spoken words a minute, which is the pace these channels read at. */
export function targetWords(minutes: number): number {
  return Math.round(minutes * 150);
}

/** How many blocks a script of this length should carry, as a hint to Opus. */
export function blockCountHint(niche: Niche, minutes: number): string {
  if (niche === 'explainer') return minutes <= 2 ? '6 to 8' : minutes <= 5 ? '8 to 12' : '12 to 16';
  return minutes <= 2 ? '6 to 8' : minutes <= 5 ? '9 to 13' : '13 to 18';
}

// ---------------------------------------------------------------------------
// Call 1 — research + script
// ---------------------------------------------------------------------------

const BLUEPRINTS: Record<Niche, string> = {
  crime: [
    'CRIME BLUEPRINT (follow this block order):',
    '1. HOOK — built by the Hook Engine below, written LAST.',
    '2. NORMAL DAY — open on an exact date and place, in present tense, with the ordinary detail that is about to stop being ordinary.',
    '3. DISCOVERY — the moment the ordinary breaks. Physical, specific, no commentary.',
    '4. INVESTIGATION LOOPS — three to six blocks. Each one runs lead to revelation to new question, and ENDS on the open question, never on a summary.',
    '5. THE TURN — placed at about 70% of the runtime. The fact that reframes everything before it.',
    '6. RESOLUTION — what was established, in order, with dates and numbers.',
    '7. CLOSER — one gut-punch image or fact. No moral, no lesson, no “what this teaches us”.',
  ].join('\n'),
  explainer: [
    'EXPLAINER BLUEPRINT (follow this block order):',
    '1. HOOK — Layer 1 and Layer 2 ONLY, under 25 seconds. No teases.',
    '2. SEGMENTS — five to twelve blocks, ordered so each is more surprising than the last. Every segment runs: item name, then the shocking fact, then the mechanism that makes it true, then one concrete number, then a bridge into the next item.',
    '3. CLOSER — the item you deliberately held back, revealed last.',
  ].join('\n'),
  documentary: [
    'DOCUMENTARY BLUEPRINT (follow this block order):',
    '1. HOOK — built by the Hook Engine below, written LAST.',
    '2. THE SURFACE — the version of this story everyone already believes.',
    '3. DESCENT LOOPS — three to six blocks. Each one CONTRADICTS the block before it and moves to a new location, a new person or a new document.',
    '4. HUMAN CORE — one named person, carrying one physical detail the audience can picture.',
    '5. THE WHY — the explanation, argued in numbers rather than opinions.',
    '6. CLOSER — return to the image the film opened on, now meaning something else.',
  ].join('\n'),
};

export function scriptSystemPrompt(niche: Niche, minutes: number): string {
  return [
    'You are the Faceless Script Writer. You write voice-over scripts for faceless long-form video — no presenter, no face, b-roll and narration only.',
    '',
    'TOPIC RULES',
    'A topic only earns a video if it has at least one of: a knowledge gap, a superlative with a number, a counterintuitive premise, or a complete-set promise.',
    'Evergreen only — nothing that dates within a year.',
    'Verify every fact you state. Never invent a case, a quote, a statistic, an event, a date or a name. If you are not certain of a detail, write the script without it rather than guessing.',
    '',
    'HOOK ENGINE (write the hook AFTER the body is finished, never before)',
    'Layer 1, 0:00 to 0:10 — a cold drop. The first sentence is already inside the story. No greeting, no channel name, no “in this video”.',
    'Layer 2, 0:10 to 0:30 — the stakes sentence, carrying a superlative or the knowledge gap.',
    'Layer 3, 0:30 to 1:00 — three or four teases lifted from the actual peaks of the body. Skip Layer 3 entirely for explainers.',
    '',
    BLUEPRINTS[niche],
    '',
    'RETENTION',
    'Present tense throughout. An exact number every 30 to 60 seconds. Open a loop before you close one. One idea per sentence, maximum 20 words. No filler transitions (“but here is the thing”, “let us dive in”, “moving on”).',
    '',
    'ANTI-SLOP',
    'No staccato three-word-sentence patterns. No motivational padding. No chains of rhetorical questions. Vary sentence length deliberately. No brand names.',
    '',
    'VISUAL LINES',
    'Every block carries one VISUAL line describing what is ON SCREEN while that VO is read — a real place, object, document, landscape or piece of equipment. Describe only what a camera could record. Never describe on-screen text, captions, logos, lettering or a presenter.',
    '',
    `LENGTH: ${minutes} minutes, roughly ${targetWords(minutes)} words of voice-over, split across ${blockCountHint(niche, minutes)} blocks.`,
    '',
    'OUTPUT FORMAT — reply with exactly this and nothing else. No markdown, no code fence, no preamble.',
    '',
    'TITLE_1: ...',
    'TITLE_2: ...',
    'TITLE_3: ...',
    'THUMBNAIL_LINE: ...',
    `TARGET_LENGTH: ${minutes} min (~${targetWords(minutes)} words)`,
    '',
    '[00:00] BLOCK_NAME',
    'VO: ...',
    'VISUAL: ...',
    '',
    '[00:45] BLOCK_NAME',
    'VO: ...',
    'VISUAL: ...',
    '',
    'FACT_CHECK:',
    '- claim | verified',
    '- claim | unverifiable',
  ].join('\n');
}

export function scriptUserPrompt(topic: string, niche: Niche, minutes: number): string {
  return [
    `Topic: ${topic.trim()}`,
    `Niche: ${niche}`,
    `Target length: ${minutes} minutes`,
    '',
    'Research the topic from what you reliably know, then write the script. Write the body first and the hook last, exactly as the Hook Engine requires.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Call 2 — video prompts
// ---------------------------------------------------------------------------

/** Retained for compatibility with older prompt consumers. New scene prompts are purely visual. */
export const AUDIO_LOCK = 'NO MUSIC. SFX ONLY — diegetic sound throughout; no score, no narration, no voices.';

/** The marker Opus returns for a [scheme] slot, which renders no video. */
export const SKIP_MARKER = 'SKIP';

export const VIDEO_PROMPT_SYSTEM = [
  'You are the Faceless Video Prompts writer. Convert one VISUAL line into one concise prompt for a video generation model.',
  '',
  'HARD OUTPUT LIMIT',
  'The complete scene prompt must be at most 800 characters, including spaces. This limit is absolute.',
  'Write one compact line only. Never write multi-paragraph SCENE CONTEXT blocks, labelled sections, a preamble, markdown or an explanation.',
  '',
  'PURELY VISUAL',
  'Include only the subject, setting, visible action, one camera move and lighting. Describe only what the lens records.',
  'Use physical verbs and concrete details. Numbers may specify field of view, white balance, speed or distance when useful.',
  'Exclude narration, audio, dialogue, captions, logos, story analysis, intent and mood commentary.',
  'Use positive phrasing for the desired image: for example, “unmanned architecture and equipment” instead of a negative instruction.',
  '',
  'TREATMENT TAGS — the caller names one.',
  '[live] — flat cool daylight, pale grey-dust sky, cool shadows, WB 5600K, subject on the right third.',
  '[archive] — sepia, thick grain, gate weave, hand-cranked wobble, humans at 10 to 15 m so faces read small.',
  '[scheme] — SKIP. Reply with exactly the single word SKIP and nothing else.',
  '[pVFX] — practical in-camera light effects; impacts shudder while geometry stays intact and the flash lives in light.',
  '',
  'Target style: “Wide shot, Nile riverbank at dawn, wooden cargo boat loaded with pale limestone blocks, flat brown water, reeds in the foreground, steady push forward, 5600K daylight.”',
  'Reply with the single prompt line only.',
].join('\n');

export function videoPromptUser(input: {
  visual: string;
  blockName: string;
  treatment: string;
  orientation: Orientation;
  durationSeconds: number;
  continuity?: string | null;
}): string {
  return [
    `Treatment tag: ${input.treatment}`,
    `Block: ${input.blockName}`,
    `Shot length: ${input.durationSeconds} seconds (${Math.max(2, Math.round(input.durationSeconds / 2))} cuts)`,
    `Frame: ${input.orientation === '9:16' ? 'vertical 9:16' : 'horizontal 16:9'}`,
    input.continuity ? `Continuity — this shot cuts directly out of the previous one: ${input.continuity}` : '',
    '',
    `VISUAL line to convert: ${input.visual.trim()}`,
  ].filter(Boolean).join('\n');
}

/**
 * Which treatment a block gets. Archive footage suits historical beats, the
 * practical-VFX tag suits anything with an impact in it, and everything else
 * is contemporary live footage.
 */
export function treatmentFor(blockName: string, visual: string): string {
  const hay = `${blockName} ${visual}`.toLowerCase();
  if (/archive|historic|1[0-9]{3}|black.and.white|old footage|newsreel/.test(hay)) return '[archive]';
  if (/explosion|blast|collapse|crash|impact|wildfire|lightning|detonat/.test(hay)) return '[pVFX]';
  return '[live]';
}

// ---------------------------------------------------------------------------
// Parsing what Opus sent back
// ---------------------------------------------------------------------------

export interface ScriptBlock {
  timecode: string;
  block: string;
  vo: string;
  visual: string;
}

export interface FactCheckItem {
  claim: string;
  verdict: string;
}

export interface ParsedScript {
  titles: string[];
  thumbnailLine: string;
  targetLength: string;
  blocks: ScriptBlock[];
  factCheck: FactCheckItem[];
}

const BLOCK_HEAD = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/;

export function parseScript(raw: string): ParsedScript {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const titles: string[] = [];
  let thumbnailLine = '';
  let targetLength = '';
  const blocks: ScriptBlock[] = [];
  const factCheck: FactCheckItem[] = [];

  let current: ScriptBlock | null = null;
  let field: 'vo' | 'visual' | null = null;
  let inFactCheck = false;

  const commit = () => {
    if (current && (current.vo.trim() || current.visual.trim())) blocks.push(current);
    current = null;
    field = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^FACT_CHECK\s*:/i.test(line)) { commit(); inFactCheck = true; continue; }
    if (inFactCheck) {
      if (!line) continue;
      const item = line.replace(/^[-*\u2022]\s*/, '');
      const parts = item.split('|');
      if (parts[0] && parts[0].trim()) {
        factCheck.push({ claim: parts[0].trim(), verdict: (parts[1] || 'unverified').trim() });
      }
      continue;
    }

    const titleMatch = line.match(/^TITLE_([123])\s*:\s*(.+)$/i);
    if (titleMatch) { titles.push(titleMatch[2].trim()); field = null; continue; }
    const thumbMatch = line.match(/^THUMBNAIL_LINE\s*:\s*(.+)$/i);
    if (thumbMatch) { thumbnailLine = thumbMatch[1].trim(); field = null; continue; }
    const lengthMatch = line.match(/^TARGET_LENGTH\s*:\s*(.+)$/i);
    if (lengthMatch) { targetLength = lengthMatch[1].trim(); field = null; continue; }

    const head = line.match(BLOCK_HEAD);
    if (head) {
      commit();
      current = { timecode: head[1], block: (head[2] || 'BLOCK').trim() || 'BLOCK', vo: '', visual: '' };
      continue;
    }

    const voMatch = line.match(/^VO\s*:\s*(.*)$/i);
    if (voMatch && current) { current.vo = voMatch[1].trim(); field = 'vo'; continue; }
    const visualMatch = line.match(/^VISUAL\s*:\s*(.*)$/i);
    if (visualMatch && current) { current.visual = visualMatch[1].trim(); field = 'visual'; continue; }

    // A wrapped continuation of whichever field we are inside.
    if (current && field && line) {
      current[field] = `${current[field]} ${line}`.trim();
    }
  }
  commit();

  if (!blocks.length) {
    throw new Error('The script writer did not return any timecoded blocks. Try Generate again.');
  }
  return {
    titles: titles.length ? titles : ['Untitled'],
    thumbnailLine,
    targetLength,
    blocks,
    factCheck,
  };
}

/** The full voice-over, timecoded, for the script accordion and for copying. */
export function scriptToText(blocks: ScriptBlock[]): string {
  return blocks.map((b) => `[${b.timecode}] ${b.block}\n${b.vo}`).join('\n\n');
}

// ---------------------------------------------------------------------------
// Topic suggestion
// ---------------------------------------------------------------------------

export const TOPIC_SYSTEM = [
  'You suggest ONE topic for a faceless long-form video.',
  'It must satisfy at least one of: a knowledge gap, a superlative with a number, a counterintuitive premise, or a complete-set promise.',
  'It must be evergreen and factually real — never invent an event, a case or a place.',
  'Reply with the topic only: one line, under 15 words, no quotes, no preamble, no punctuation at the end.',
].join(' ');

export function topicUserPrompt(niche: Niche): string {
  return `Suggest one ${niche} topic. Do not repeat an obvious, over-covered subject.`;
}
