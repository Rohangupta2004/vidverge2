/**
 * Video Studio — the agentic editing engine.
 *
 * On upload the studio produces a CUT PLAN: a list of specific, reviewable
 * edits with a reason and a predicted retention score, which the creator
 * accepts or rejects card by card.
 *
 * The plan is deliberately built in two layers:
 *
 *   DETERMINISTIC — filler removal, dead-air cuts and captions come from the
 *   transcript and the audio envelope. They need no model, they cannot
 *   hallucinate, and they are ready the moment transcription finishes, which
 *   is what keeps the upload-to-first-cut-plan budget under two minutes.
 *
 *   MODEL — the judgement calls (what to trim for pace, where a cutaway
 *   helps, which line deserves a text beat, which segments will actually be
 *   watched) come from one gpt-5.6-terra pass over the timecoded transcript.
 *   If that call fails the deterministic plan still stands.
 *
 * Retention scores are blended: the model's read of the content, averaged with
 * the local signal-based estimate, so a confident-sounding model cannot claim
 * 90% retention over ten seconds of silence.
 */
import {
  CardType, EditCard, estimateRetention, newId, nleToken, clampN,
  type WordToken,
} from './studioModel';

const MODEL = 'gpt-5.6-terra';

function aiHeaders(): Record<string, string> {
  const token = nleToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

async function askModel(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  maxTokens = 3000,
): Promise<string> {
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: aiHeaders(),
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: 'none',
      messages,
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      stream: false,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.code ? ` [${data.code}]` : '';
    throw new Error(`${String(data?.error?.message || data?.error || `The editing model answered HTTP ${res.status}`)}${code}`);
  }
  return String(data?.choices?.[0]?.message?.content || '');
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('The editing model replied in an unexpected format.');
  return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Context the planner reads
// ---------------------------------------------------------------------------

export interface PlanContext {
  durationS: number;
  words: WordToken[];
  transcript: string;
  silences: { start: number; end: number }[];
  motion: { t: number; score: number }[];
  lowAction: { start: number; end: number; score: number }[];
  /** What the creator says the video is for, when they have told us. */
  brief: string;
}

function motionNear(motion: { t: number; score: number }[], a: number, b: number): number {
  const inRange = motion.filter((m) => m.t >= a - 0.5 && m.t <= b + 0.5);
  if (!inRange.length) return 0.35;
  return inRange.reduce((n, m) => n + m.score, 0) / inRange.length;
}

function silenceShare(silences: { start: number; end: number }[], a: number, b: number): number {
  const span = Math.max(0.1, b - a);
  let quiet = 0;
  silences.forEach((s) => {
    const overlap = Math.min(b, s.end) - Math.max(a, s.start);
    if (overlap > 0) quiet += overlap;
  });
  return Math.min(1, quiet / span);
}

function wordsPerSecond(words: WordToken[], a: number, b: number): number {
  const span = Math.max(0.1, b - a);
  const n = words.filter((w) => w.start >= a && w.end <= b).length;
  return n / span;
}

/** The local, explainable retention estimate for one segment. */
export function localRetention(ctx: PlanContext, a: number, b: number): number {
  return estimateRetention({
    durationS: Math.max(0.3, b - a),
    wordsPerSecond: wordsPerSecond(ctx.words, a, b),
    silenceShare: silenceShare(ctx.silences, a, b),
    motionScore: motionNear(ctx.motion, a, b),
    positionShare: ctx.durationS > 0 ? a / ctx.durationS : 0,
  });
}

// ---------------------------------------------------------------------------
// Deterministic cards
// ---------------------------------------------------------------------------

function card(type: CardType, start: number, end: number, title: string, reason: string, retention: number, payload: Record<string, unknown>): EditCard {
  return {
    id: newId('card'), type, start, end, title, reason,
    retention: Math.round(clampN(retention, 1, 99)),
    thumbnail: '', status: 'pending', note: '', payload,
  };
}

/**
 * The cards that come straight out of the transcript and the audio envelope.
 * These are the ones a creator almost always wants, so they lead the plan.
 */
export function deterministicCards(ctx: PlanContext): EditCard[] {
  const out: EditCard[] = [];

  const fillers = ctx.words.filter((w) => w.filler);
  if (fillers.length) {
    const labels = [...new Set(fillers.map((w) => w.text.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase()))].slice(0, 5);
    const saved = fillers.reduce((n, w) => n + (w.end - w.start), 0);
    out.push(card(
      'filler',
      fillers[0].start,
      fillers[fillers.length - 1].end,
      `Remove ${fillers.length} filler word${fillers.length === 1 ? '' : 's'}`,
      `“${labels.join('”, “')}” appear ${fillers.length} times and cost ${saved.toFixed(1)}s. Cutting them tightens the delivery without changing a sentence.`,
      82,
      { wordIds: fillers.map((w) => w.id) },
    ));
  }

  const deadAir = ctx.silences.filter((s) => s.end - s.start >= 0.6);
  if (deadAir.length) {
    const saved = deadAir.reduce((n, s) => n + (s.end - s.start), 0);
    out.push(card(
      'silence',
      deadAir[0].start,
      deadAir[deadAir.length - 1].end,
      `Cut ${deadAir.length} silent gap${deadAir.length === 1 ? '' : 's'}`,
      `${saved.toFixed(1)}s of dead air across the take. Removing it is the single biggest win for watch time on a talking-head cut.`,
      88,
      { ranges: deadAir.map((s) => ({ start: s.start, end: s.end })) },
    ));
  }

  if (ctx.words.length) {
    out.push(card(
      'caption',
      0,
      ctx.durationS,
      'Add word-timed captions',
      'Most short-form views start muted. Word-timed captions across the whole cut are the highest-leverage change on this timeline.',
      91,
      {},
    ));
  }

  ctx.lowAction.slice(0, 4).forEach((region) => {
    out.push(card(
      'broll',
      region.start,
      region.end,
      `B-roll slot at ${region.start.toFixed(1)}s`,
      `${(region.end - region.start).toFixed(1)}s of near-static picture. A cutaway here breaks the visual monotony that loses viewers.`,
      localRetention(ctx, region.start, region.end),
      { cause: 'lowAction' },
    ));
  });

  return out;
}

// ---------------------------------------------------------------------------
// The model pass
// ---------------------------------------------------------------------------

function transcriptLines(ctx: PlanContext, maxChars = 7000): string {
  const lines: string[] = [];
  let chunk: WordToken[] = [];
  const flush = () => {
    if (!chunk.length) return;
    lines.push(`${chunk[0].start.toFixed(1)}-${chunk[chunk.length - 1].end.toFixed(1)}s: ${chunk.map((w) => w.text).join(' ')}`);
    chunk = [];
  };
  ctx.words.forEach((w) => {
    chunk.push(w);
    if (chunk.length >= 12) flush();
  });
  flush();
  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n… (transcript truncated)`;
  return text;
}

const PLANNER_SYSTEM = [
  'You are the lead editor of a short-form video studio. You watch a creator\u2019s raw take through its timecoded transcript plus measured audio and motion signals, and you return a CUT PLAN: specific, individually reviewable edits.',
  'You never return vague advice. Every suggestion names an exact start and end in seconds and says what changes.',
  'You estimate retention honestly. A segment that is slow, silent, repetitive or off-topic gets a LOW score even if the words are good.',
  'Reply with JSON only.',
].join(' ');

const PLAN_SHAPE = [
  '{',
  '  "summary": "one sentence on what this take needs most",',
  '  "hookVerdict": "one sentence on whether the first three seconds earn the watch",',
  '  "edits": [',
  '    { "type": "trim"|"effect"|"broll"|"text"|"reframe"|"transition",',
  '      "start": seconds, "end": seconds,',
  '      "title": "short imperative, max 48 chars",',
  '      "reason": "why this helps, 1-2 sentences, specific to what is said here",',
  '      "retention": 0-100,',
  '      "text": "only for type text — the on-screen words, max 34 chars",',
  '      "prompt": "only for type broll — a cinematic shot description, no on-screen text, no logos, no named people",',
  '      "effect": "only for type effect — one of lensFlare|lightLeak|vignette|bloom|flash|filmGrain",',
  '      "transition": "only for type transition — one of crossfade|whipPan|flashCut|dipToBlack|glitchCut|zoomPunch|spin" }',
  '  ],',
  '  "segments": [ { "start": seconds, "end": seconds, "retention": 0-100, "why": "short reason" } ]',
  '}',
].join('\n');

function signalBlock(ctx: PlanContext): string {
  const sil = ctx.silences.slice(0, 40).map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', ') || 'none';
  const quiet = ctx.lowAction.slice(0, 12).map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', ') || 'none';
  const avgMotion = ctx.motion.length ? (ctx.motion.reduce((n, m) => n + m.score, 0) / ctx.motion.length).toFixed(2) : 'n/a';
  return [
    `Duration: ${ctx.durationS.toFixed(1)}s`,
    `Measured silences (s): ${sil}`,
    `Measured near-static picture (s): ${quiet}`,
    `Average motion energy 0-1: ${avgMotion}`,
    `Words: ${ctx.words.length}`,
    `Detected filler words: ${ctx.words.filter((w) => w.filler).length}`,
  ].join('\n');
}

const ALLOWED_TYPES: CardType[] = ['trim', 'effect', 'broll', 'text', 'reframe', 'transition'];
const ALLOWED_EFFECTS = ['lensFlare', 'lightLeak', 'vignette', 'bloom', 'flash', 'filmGrain'];
const ALLOWED_TRANSITIONS = ['crossfade', 'whipPan', 'flashCut', 'dipToBlack', 'glitchCut', 'zoomPunch', 'spin'];

export interface ModelPlan {
  summary: string;
  hookVerdict: string;
  cards: EditCard[];
  segments: { start: number; end: number; retention: number; why: string }[];
}

/** One planner pass. Throws on transport failure so the caller can degrade. */
export async function modelPlan(ctx: PlanContext): Promise<ModelPlan> {
  const user = [
    ctx.brief ? `The creator says this video is for: ${ctx.brief}` : 'The creator gave no brief — judge the take on its own terms.',
    '',
    'MEASURED SIGNALS',
    signalBlock(ctx),
    '',
    'TIMECODED TRANSCRIPT',
    transcriptLines(ctx),
    '',
    'Return 4 to 10 edits and 4 to 12 retention segments covering the whole video, in exactly this JSON shape:',
    PLAN_SHAPE,
    '',
    'Rules:',
    '- Filler-word removal, dead-air cutting and captioning are already handled. Do NOT propose them.',
    '- Every start/end must sit inside 0 and ' + ctx.durationS.toFixed(1) + ' seconds, and end must be greater than start.',
    '- A trim must name a span that genuinely does not earn its time (a repeat, a ramble, a false start) and say what is in it.',
    '- At most 3 b-roll suggestions, never inside the first 2 seconds, at least 6 seconds apart.',
    '- A text beat must quote or compress something actually said at that moment.',
    '- Retention segments must be non-overlapping and ordered.',
  ].join('\n');

  const raw = await askModel(
    [{ role: 'system', content: PLANNER_SYSTEM }, { role: 'user', content: user }],
    4000,
  );
  const parsed = parseJson(raw);
  const inRange = (n: unknown, fb: number) => {
    const v = Number(n);
    return Number.isFinite(v) ? clampN(v, 0, Math.max(0.2, ctx.durationS)) : fb;
  };

  const cards: EditCard[] = (Array.isArray(parsed.edits) ? parsed.edits : [])
    .slice(0, 12)
    .map((raw1: unknown) => {
      const e = (raw1 || {}) as Record<string, unknown>;
      const type = ALLOWED_TYPES.includes(String(e.type) as CardType) ? (String(e.type) as CardType) : 'trim';
      const start = inRange(e.start, 0);
      let end = inRange(e.end, start + 2);
      if (end <= start + 0.1) end = Math.min(ctx.durationS, start + 2);
      const title = String(e.title || '').trim().slice(0, 60) || 'Suggested edit';
      const reason = String(e.reason || '').trim().slice(0, 320) || 'The editor flagged this moment.';
      const modelScore = Number(e.retention);
      const local = localRetention(ctx, start, end);
      // Blend: the model reads the content, the signals read the delivery.
      const retention = Number.isFinite(modelScore) && modelScore > 0
        ? Math.round((clampN(modelScore, 1, 99) + local) / 2)
        : local;
      const payload: Record<string, unknown> = {};
      if (type === 'text') payload.text = String(e.text || title).trim().slice(0, 40);
      if (type === 'broll') payload.prompt = String(e.prompt || '').trim().slice(0, 600);
      if (type === 'effect') payload.effect = ALLOWED_EFFECTS.includes(String(e.effect)) ? String(e.effect) : 'vignette';
      if (type === 'transition') payload.transition = ALLOWED_TRANSITIONS.includes(String(e.transition)) ? String(e.transition) : 'crossfade';
      return card(type, start, end, title, reason, retention, payload);
    })
    .filter((c: EditCard) => !(c.type === 'broll' && !String(c.payload.prompt || '').trim()));

  const segments = (Array.isArray(parsed.segments) ? parsed.segments : [])
    .slice(0, 16)
    .map((raw1: unknown) => {
      const s = (raw1 || {}) as Record<string, unknown>;
      const start = inRange(s.start, 0);
      const end = Math.max(start + 0.5, inRange(s.end, start + 4));
      const model = Number(s.retention);
      const local = localRetention(ctx, start, end);
      return {
        start,
        end,
        retention: Math.round(Number.isFinite(model) && model > 0 ? (clampN(model, 1, 99) + local) / 2 : local),
        why: String(s.why || '').trim().slice(0, 160),
      };
    })
    .sort((a: { start: number }, b: { start: number }) => a.start - b.start);

  return {
    summary: String(parsed.summary || '').trim().slice(0, 400),
    hookVerdict: String(parsed.hookVerdict || '').trim().slice(0, 300),
    cards,
    segments,
  };
}

export interface CutPlan {
  cards: EditCard[];
  summary: string;
  hookVerdict: string;
  segments: { start: number; end: number; retention: number; why: string }[];
  modelError: string;
}

/**
 * The full plan. The deterministic half is returned even when the model pass
 * fails, so the creator always has something to accept.
 */
export async function buildCutPlan(ctx: PlanContext, onNote?: (n: string) => void): Promise<CutPlan> {
  const base = deterministicCards(ctx);
  onNote?.(`${base.length} measured edits ready — asking the editor for the judgement calls…`);
  let plan: ModelPlan | null = null;
  let modelError = '';
  try {
    plan = await modelPlan(ctx);
  } catch (e) {
    modelError = e instanceof Error ? e.message : String(e);
  }
  const fallbackSegments = plan?.segments.length
    ? plan.segments
    : segmentRetention(ctx);
  return {
    cards: [...base, ...(plan?.cards || [])],
    summary: plan?.summary || 'The measured pass found the cuts that matter most: dead air, filler words and captions.',
    hookVerdict: plan?.hookVerdict || '',
    segments: fallbackSegments,
    modelError,
  };
}

/** Signal-only retention curve — used when the model pass is unavailable. */
export function segmentRetention(ctx: PlanContext): { start: number; end: number; retention: number; why: string }[] {
  const span = Math.max(3, ctx.durationS / 8);
  const out: { start: number; end: number; retention: number; why: string }[] = [];
  for (let t = 0; t < ctx.durationS - 0.4; t += span) {
    const end = Math.min(ctx.durationS, t + span);
    const quiet = silenceShare(ctx.silences, t, end);
    const wps = wordsPerSecond(ctx.words, t, end);
    out.push({
      start: t,
      end,
      retention: localRetention(ctx, t, end),
      why: quiet > 0.3 ? 'Long quiet stretch' : wps < 1.4 ? 'Slow delivery' : 'Dense, paced delivery',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mid-session chat — "make this punchy", "remove all silences", "add captions"
// ---------------------------------------------------------------------------

const CHAT_SYSTEM = [
  'You are the editing assistant inside a video studio. The creator is mid-edit and asks for changes in plain language.',
  'You answer in two parts: a short spoken reply (max 2 sentences, no markdown), and zero or more concrete edit cards the studio can apply.',
  'Only propose edits you can anchor to a timecode. If the request is about the whole video ("add captions", "remove all silences"), use an action instead of a card.',
  'Reply with JSON only.',
].join(' ');

export type ChatAction =
  | 'captions' | 'removeFillers' | 'removeSilences' | 'reframe' | 'replan'
  | 'punchUp' | 'addMusic' | 'export' | 'none';

const ALLOWED_ACTIONS: ChatAction[] = ['captions', 'removeFillers', 'removeSilences', 'reframe', 'replan', 'punchUp', 'addMusic', 'export', 'none'];

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export interface ChatOutcome {
  reply: string;
  actions: ChatAction[];
  cards: EditCard[];
}

/** One assistant turn: a reply plus the edits it wants to make. */
export async function chatForEdits(
  message: string,
  ctx: PlanContext,
  history: ChatTurn[],
  stateLine: string,
): Promise<ChatOutcome> {
  const shape = [
    '{',
    '  "reply": "short spoken answer",',
    '  "actions": ["captions"|"removeFillers"|"removeSilences"|"reframe"|"replan"|"punchUp"|"addMusic"|"export"],',
    '  "edits": [ { "type": "trim"|"effect"|"broll"|"text"|"transition"|"reframe", "start": seconds, "end": seconds, "title": "…", "reason": "…", "retention": 0-100, "text": "…", "prompt": "…", "effect": "…", "transition": "…" } ]',
    '}',
  ].join('\n');

  const user = [
    `CURRENT EDIT: ${stateLine}`,
    '',
    'MEASURED SIGNALS',
    signalBlock(ctx),
    '',
    'TIMECODED TRANSCRIPT',
    transcriptLines(ctx, 4500),
    '',
    `CREATOR SAYS: ${message}`,
    '',
    `Reply in this JSON shape:\n${shape}`,
  ].join('\n');

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: CHAT_SYSTEM }];
  history.slice(-6).forEach((turn) => messages.push({ role: turn.role, content: turn.content.slice(0, 1200) }));
  messages.push({ role: 'user', content: user });

  const raw = await askModel(messages, 2600);
  const parsed = parseJson(raw);

  const actions = (Array.isArray(parsed.actions) ? parsed.actions : [])
    .map((a: unknown) => String(a) as ChatAction)
    .filter((a: ChatAction) => ALLOWED_ACTIONS.includes(a) && a !== 'none');

  const cards: EditCard[] = (Array.isArray(parsed.edits) ? parsed.edits : [])
    .slice(0, 8)
    .map((raw1: unknown) => {
      const e = (raw1 || {}) as Record<string, unknown>;
      const type = ALLOWED_TYPES.includes(String(e.type) as CardType) ? (String(e.type) as CardType) : 'trim';
      const start = clampN(Number(e.start) || 0, 0, Math.max(0.2, ctx.durationS));
      const end = Math.max(start + 0.2, clampN(Number(e.end) || start + 2, 0, Math.max(0.4, ctx.durationS)));
      const local = localRetention(ctx, start, end);
      const model = Number(e.retention);
      const payload: Record<string, unknown> = {};
      if (type === 'text') payload.text = String(e.text || e.title || '').trim().slice(0, 40);
      if (type === 'broll') payload.prompt = String(e.prompt || '').trim().slice(0, 600);
      if (type === 'effect') payload.effect = ALLOWED_EFFECTS.includes(String(e.effect)) ? String(e.effect) : 'vignette';
      if (type === 'transition') payload.transition = ALLOWED_TRANSITIONS.includes(String(e.transition)) ? String(e.transition) : 'crossfade';
      return card(
        type, start, end,
        String(e.title || 'Suggested edit').trim().slice(0, 60),
        String(e.reason || 'Asked for in chat.').trim().slice(0, 320),
        Number.isFinite(model) && model > 0 ? Math.round((clampN(model, 1, 99) + local) / 2) : local,
        payload,
      );
    })
    .filter((c: EditCard) => !(c.type === 'broll' && !String(c.payload.prompt || '').trim()));

  return {
    reply: String(parsed.reply || '').trim().slice(0, 600) || 'Done — check the cards on the right.',
    actions,
    cards,
  };
}

/** A b-roll prompt written from the words spoken around a slot. */
export function brollPromptFromContext(words: WordToken[], start: number, end: number): string {
  const near = words.filter((w) => w.end >= start - 4 && w.start <= end + 4).map((w) => w.text).join(' ').trim();
  const subject = near.slice(0, 220) || 'the subject of this video';
  return `Cinematic b-roll cutaway that illustrates: ${subject}. Handheld documentary feel, shallow depth of field, natural light, no on-screen text, no logos, no recognisable faces.`;
}
