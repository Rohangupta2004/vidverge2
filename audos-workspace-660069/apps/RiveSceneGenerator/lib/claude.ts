// Claude Opus 5 — the only source of animation in this app.
//
// Every frame the renderer paints traces back to a step in the array Opus
// returns here. There is no built-in sequence to fall back on: if the call
// fails or the JSON cannot be read, generateAnimationScript reports the error
// and the stage stays as it was. Two different prompts produce two different
// step arrays, and therefore two different animations.
//
// Proxy contract (integrations/anthropic-text-generation):
//   * POST /proxy/anthropic/v1/messages is the only proxied path.
//   * X-Workspace-DB-Token is REQUIRED — anonymous calls are 401 no_credentials.
//   * max_tokens is required and capped at 8192.
//   * claude-opus-5 cannot disable thinking: it needs adaptive thinking paired
//     with output_config.effort. Sending temperature/top_p/top_k is a 400.
//   * The reply is content[].text (Anthropic shape), never choices[0].message.

import { getWorkspaceToken } from '../../../lib/workspace';
import {
  MACHINES,
  describeInput,
  findInput,
  isKnownMachine,
  type InputKind,
  type TimedStep,
} from './scenes';

const MODEL = 'claude-opus-5';
const ENDPOINT = '/proxy/anthropic/v1/messages';

export interface AnimationStep {
  t: number;
  rive: string;
  input: string;
  type: InputKind;
  value?: number | string | boolean;
}

/** A step the runtime refused, kept so the UI can show what was dropped. */
export interface SkippedStep {
  step: unknown;
  reason: string;
}

export interface ScriptResult {
  /** Valid steps, ascending by time. Null means nothing is playable. */
  steps: AnimationStep[] | null;
  /** Verbatim model text, always shown in the debug panel. */
  raw: string;
  error: string | null;
  skipped: SkippedStep[];
}

/** The runtime catalog, rendered exactly as the system prompt advertises it. */
export function machineCatalog(): string {
  return MACHINES.map(
    (m) => `- "${m.name}" — inputs: ${m.inputs.map(describeInput).join(', ')}`,
  ).join('\n');
}

export function buildSystemPrompt(durationSec: number): string {
  return `You control a Rive animation runtime. You have access to these bundled Rive state machines:
${machineCatalog()}

Based on the user's prompt, return ONLY a JSON array of animation steps. Each step:
{
  "t": <seconds from start, float>,
  "rive": <state machine name>,
  "input": <input name>,
  "type": "trigger" | "number" | "string",
  "value": <omit for trigger, else the value>
}
Return only the JSON array, no explanation.

Runtime notes:
- The stage is 1280x720 and the scene is ${durationSec} seconds long, so every "t" must sit between 0 and ${durationSec}.
- Only the state machine names and input names listed above exist. Any other name is skipped by the runtime, so never invent one.
- Triggers fire once per step. To bring the three metric cards in one by one, emit three "animateIn" triggers at increasing times.
- Pace the steps across the whole duration and use the inputs the prompt actually calls for — nothing renders unless a step asks for it.`;
}

export async function generateAnimationScript(
  userPrompt: string,
  durationSec: number,
): Promise<ScriptResult> {
  const token = await getWorkspaceToken();
  if (!token) {
    return {
      steps: null,
      raw: '',
      skipped: [],
      error: 'Workspace token unavailable — the Anthropic proxy requires X-Workspace-DB-Token.',
    };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-DB-Token': token,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: buildSystemPrompt(durationSec),
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch (e: any) {
    return {
      steps: null,
      raw: '',
      skipped: [],
      error: `Network error reaching Claude: ${e?.message || e}`,
    };
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    let body = '';
    try {
      body = await res.text();
      const parsed = JSON.parse(body);
      const code = parsed?.code ? ` [${parsed.code}]` : '';
      detail = `${parsed?.error?.message || parsed?.error || detail}${code}`;
    } catch {
      /* keep the status-only detail */
    }
    return { steps: null, raw: body, skipped: [], error: `Claude request failed: ${detail}` };
  }

  let raw = '';
  let stopReason = '';
  try {
    const data = await res.json();
    stopReason = String(data?.stop_reason || '');
    raw = (data?.content || [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
  } catch (e: any) {
    return {
      steps: null,
      raw: '',
      skipped: [],
      error: `Could not read Claude's response: ${e?.message || e}`,
    };
  }

  if (!raw) {
    return {
      steps: null,
      raw: '',
      skipped: [],
      error:
        stopReason === 'max_tokens'
          ? 'Claude ran out of output tokens before returning the script. Try a shorter brief.'
          : 'Claude returned no text content.',
    };
  }

  return parseAnimationScript(raw);
}

/**
 * Read a step array out of the model text and validate every step against the
 * runtime registry. Unknown machines / inputs are skipped and reported rather
 * than crashing playback — and never replaced with invented motion.
 */
export function parseAnimationScript(raw: string): ScriptResult {
  const parsed = extractJson(raw);
  if (parsed === undefined) {
    return {
      steps: null,
      raw,
      skipped: [],
      error: 'Claude did not return valid JSON. The raw response is in Debug: Animation Script.',
    };
  }

  // Accept a bare array, or an object that wraps one under a predictable key.
  let list: unknown;
  if (Array.isArray(parsed)) list = parsed;
  else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    list = obj.steps ?? obj.sequence ?? obj.animation ?? obj.timeline;
  }
  if (!Array.isArray(list)) {
    return {
      steps: null,
      raw,
      skipped: [],
      error: 'Claude returned JSON, but not an array of animation steps.',
    };
  }

  const steps: AnimationStep[] = [];
  const skipped: SkippedStep[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      skipped.push({ step: entry, reason: 'not an object' });
      continue;
    }
    const s = entry as Record<string, unknown>;
    const machine = typeof s.rive === 'string' ? s.rive : '';
    const input = typeof s.input === 'string' ? s.input : '';

    if (!machine || !isKnownMachine(machine)) {
      skipped.push({ step: entry, reason: `unknown state machine "${machine || '(missing)'}"` });
      console.warn('[rive-scene] skipping step for unknown state machine', entry);
      continue;
    }
    const spec = findInput(machine, input);
    if (!spec) {
      skipped.push({ step: entry, reason: `"${machine}" has no input "${input || '(missing)'}"` });
      console.warn('[rive-scene] skipping step for unknown input', entry);
      continue;
    }

    const t = Number(s.t);
    if (!Number.isFinite(t) || t < 0) {
      skipped.push({ step: entry, reason: `invalid time "${String(s.t)}"` });
      continue;
    }

    // The registry decides the kind, so a mislabelled "type" cannot break a step.
    const kind = spec.kind;
    let value: number | string | boolean | undefined;
    if (kind === 'number') {
      const n = Number(s.value);
      if (!Number.isFinite(n)) {
        skipped.push({ step: entry, reason: `"${input}" needs a number value` });
        continue;
      }
      value = spec.range ? Math.min(spec.range[1], Math.max(spec.range[0], n)) : n;
    } else if (kind === 'string') {
      if (s.value === undefined || s.value === null) {
        skipped.push({ step: entry, reason: `"${input}" needs a string value` });
        continue;
      }
      value = String(s.value);
    }

    steps.push({ t, rive: machine, input, type: kind, value });
  }

  steps.sort((a, b) => a.t - b.t);

  if (!steps.length) {
    return {
      steps: null,
      raw,
      skipped,
      error: skipped.length
        ? `None of the ${skipped.length} step(s) Claude returned could be played — see Debug: Animation Script.`
        : 'Claude returned an empty animation script.',
    };
  }

  return { steps, raw, skipped, error: null };
}

/** Parse the first JSON array (or object) in the text, tolerating code fences. */
function extractJson(raw: string): unknown | undefined {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const attempt = (slice: string): unknown | undefined => {
    try {
      return JSON.parse(slice);
    } catch {
      return undefined;
    }
  };

  const direct = attempt(text);
  if (direct !== undefined) return direct;

  const spans: Array<[number, number]> = [
    [text.indexOf('['), text.lastIndexOf(']')],
    [text.indexOf('{'), text.lastIndexOf('}')],
  ];
  for (const [start, end] of spans) {
    if (start === -1 || end <= start) continue;
    const got = attempt(text.slice(start, end + 1));
    if (got !== undefined) return got;
  }
  return undefined;
}

/** Model steps (seconds) → renderer steps (milliseconds). */
export function toTimedSteps(steps: AnimationStep[]): TimedStep[] {
  return steps.map((s) => ({
    atMs: Math.max(0, Math.round(s.t * 1000)),
    machine: s.rive,
    input: s.input,
    kind: s.type,
    value: s.value,
  }));
}

export const PROMPT_PLACEHOLDER =
  'A SaaS dashboard loads. A cursor clicks Generate, three metric cards appear one by one, a line chart draws itself, then a green success badge appears. Dark glass UI, 6 seconds.';
