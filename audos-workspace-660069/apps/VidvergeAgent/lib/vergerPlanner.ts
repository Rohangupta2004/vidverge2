/**
 * VERGER PLANNER — the orchestrator brain.
 *
 * gpt-6.1-sol takes no `tools` on /v1/chat/completions and never accepts
 * reasoning_effort "none" (platform proxy contract), so orchestration is a
 * PLANNER LOOP: every turn the model returns one structured JSON plan
 * ({ say, askQuestion, dispatch, openStudio, done }) and the app executes it —
 * runs sub-agents in parallel, shows the option-card question, routes briefs
 * to studios — then feeds results back as the next turn's context.
 *
 * Models (build-time tiers, per platform policy):
 *   planner + sub-agents : gpt-6.1-sol, reasoning_effort "medium", 6000 tokens
 *   chip suggestions     : gpt-6-luna,  reasoning_effort "none",   2000 tokens
 */
import { getWorkspaceToken } from '../../../lib/workspace';
import { capabilityManifestText, openableAppIds, routableAppIds, toolRegistryText } from './capabilities';
import { SUB_AGENT_TYPES, subAgentById, subAgentRosterText } from './subAgents';
import type { SubAgentType } from './subAgents';

const PROXY_URL = '/proxy/openai/v1/chat/completions';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface VergerQuestion {
  prompt: string;
  options: string[];
  allowOwn: boolean;
}

export interface VergerDispatch {
  agentType: string;
  task: string;
}

export interface VergerOpenStudio {
  appId: string;
  brief: string;
  /** Seconds of video the next step will generate; > 0 means credits will be spent and the UI must confirm first. */
  estimatedSeconds: number;
}

export interface VergerVisualEdit {
  sceneReference: string;
  timestampSec: number | null;
  request: string;
}

export interface VergerPlan {
  say: string;
  askQuestion: VergerQuestion | null;
  dispatch: VergerDispatch[];
  openStudio: VergerOpenStudio | null;
  visualEdit: VergerVisualEdit | null;
  done: boolean;
}

export class PlannerError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'PlannerError';
    this.status = status;
  }
}

async function proxyChat(body: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const token = await getWorkspaceToken();
  if (!token) throw new PlannerError('Your session is still loading — give it a second and try again.', 401);
  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (data as any)?.error?.message || (data as any)?.error || `AI request failed (HTTP ${response.status})`;
    const code = (data as any)?.code ? ` [${(data as any).code}]` : '';
    throw new PlannerError(`${String(detail)}${code}`, response.status);
  }
  const text = (data as any)?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new PlannerError('The model returned an empty reply. Try again.');
  return text;
}

// ------------------------------------------------------------- planner ----

const PLAN_SHAPE =
  '{"say": string, "askQuestion": {"prompt": string, "options": string[2..4], "allowOwn": true} | null, ' +
  '"dispatch": [{"agentType": string, "task": string}], "openStudio": {"appId": string, "brief": string, "estimatedSeconds": number} | null, ' +
  '"visualEdit": {"sceneReference": string, "timestampSec": number | null, "request": string} | null, "done": boolean}';

function plannerSystemPrompt(queueSummary: string): string {
  return [
    'Act as the main agent of Vidverge called Verger.',
    '',
    'You are the ORCHESTRATOR of every Vidverge app. You act as the user, in place of the user: you analyse their request, suggest a direction, operate the studios the way they would by hand (fill briefs, choose models, plan steps), and ask them a question at every step where you genuinely need their input. The user describes what they want in plain natural language — any mix of English, Hindi or Hinglish — and you do everything you can with the help of the apps. Reply in the user\u2019s own language mix.',
    '',
    'METHOD, every turn: PLAN → DELEGATE independent specialist work in parallel → EXECUTE the next registered tool → VERIFY its result → REPORT. Ask only when an answer is truly required to proceed; then ask ONE question with 2–4 numbered options plus write-your-own. Do not re-ask known facts. Diagnose failures from exact errors, classify them, and attempt at most one safe targeted repair; never automatically retry a paid submit.',
    '',
    'YOUR CAPABILITY MANIFEST — you know these apps and respect their limits. Never promise anything outside this manifest:',
    capabilityManifestText(),
    '',
    'YOUR PARALLEL SUB-AGENTS — dispatch up to 6 independent specialists in one turn; they run concurrently and their reports come back as a [sub-agent results] message that you must merge and resolve before execution:',
    subAgentRosterText(),
    '',
    'YOUR EXECUTABLE TOOL REGISTRY — this is the single source of what you may call or promise:',
    toolRegistryText(),
    '',
    'CREDITS RULE (hard): 1 credit = 1 second of finished video; only generation spends credits. BEFORE any step that will spend credits, state the cost (e.g. "30s · 30 credits") and ask for an explicit yes. In openStudio, estimatedSeconds MUST carry the seconds that step will generate (0 when the step is free, e.g. editing footage, brand setup, drafting).',
    '',
    `ROUTING: when a new production plan is ready, set openStudio with one registered app id [${openableAppIds().join(', ')}]. For routable ids [${routableAppIds().join(', ')}], provide a complete self-contained brief (goal, audience, script/direction, seconds, ratio, voice/music and model). Treat that existing studio and its durable worker as a Verger tool, not as a tutorial for the user.`,
    'TARGETED EDITS: if the user asks to change a selected scene or timestamp, set visualEdit (and do NOT open a studio). Copy only the requested change into request, identify the affected scene, and include timestampSec when stated. The live project pane will trim only an 8s window, run vision analysis, show the detailed prompt, request 8-credit approval, edit once with Omni Flash, splice server-side, and preserve the original version.',
    '',
    `LIVE QUEUE (what is currently running for this user): ${queueSummary || 'nothing right now'}.`,
    '',
    'OUTPUT CONTRACT (hard): reply with EXACTLY ONE JSON object, no markdown fences, no text outside it, matching:',
    PLAN_SHAPE,
    '"say" is what you tell the user this turn (short, warm, director-like — not salesy). "dispatch" is [] when no sub-agents are needed. "done" is true only when the work for this request is fully handed off or finished.',
  ].join('\n');
}

function extractJson(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new PlannerError('The model reply was not valid JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizePlan(raw: any): VergerPlan {
  const say = typeof raw?.say === 'string' ? raw.say.trim() : '';
  let askQuestion: VergerQuestion | null = null;
  if (raw?.askQuestion && typeof raw.askQuestion === 'object' && typeof raw.askQuestion.prompt === 'string') {
    const options = Array.isArray(raw.askQuestion.options)
      ? raw.askQuestion.options.filter((o: unknown) => typeof o === 'string' && o.trim()).slice(0, 4)
      : [];
    askQuestion = { prompt: raw.askQuestion.prompt.trim(), options, allowOwn: true };
  }
  const dispatch: VergerDispatch[] = Array.isArray(raw?.dispatch)
    ? raw.dispatch
        .filter((d: any) => d && typeof d.task === 'string' && subAgentById(d.agentType))
        .slice(0, 6)
        .map((d: any) => ({ agentType: String(d.agentType), task: String(d.task) }))
    : [];
  let openStudio: VergerOpenStudio | null = null;
  if (raw?.openStudio && typeof raw.openStudio === 'object' && openableAppIds().indexOf(String(raw.openStudio.appId)) >= 0) {
    openStudio = {
      appId: String(raw.openStudio.appId),
      brief: String(raw.openStudio.brief || '').trim(),
      estimatedSeconds: Math.max(0, Math.round(Number(raw.openStudio.estimatedSeconds) || 0)),
    };
    if (!openStudio.brief) openStudio = null;
  }
  let visualEdit: VergerVisualEdit | null = null;
  if (raw?.visualEdit && typeof raw.visualEdit === 'object' && typeof raw.visualEdit.request === 'string') {
    const request = raw.visualEdit.request.trim();
    if (request) {
      const timestamp = raw.visualEdit.timestampSec == null ? null : Number(raw.visualEdit.timestampSec);
      visualEdit = {
        sceneReference: String(raw.visualEdit.sceneReference || 'selected scene'),
        timestampSec: timestamp !== null && Number.isFinite(timestamp) ? Math.max(0, timestamp) : null,
        request,
      };
    }
  }
  if (!say && !askQuestion && !dispatch.length && !openStudio && !visualEdit) {
    throw new PlannerError('The model returned an empty plan.');
  }
  return { say, askQuestion, dispatch, openStudio, visualEdit, done: raw?.done === true };
}

/**
 * One planner turn. `history` is the running conversation (user turns,
 * Verger says, answered questions, and [sub-agent results] observations).
 */
export async function planTurn(history: ChatTurn[], queueSummary: string, signal?: AbortSignal): Promise<VergerPlan> {
  const messages: ChatTurn[] = [{ role: 'system', content: plannerSystemPrompt(queueSummary) }, ...history.slice(-40)];
  const request: Record<string, unknown> = {
    model: 'gpt-6.1-sol',
    reasoning_effort: 'medium',
    max_completion_tokens: 6000,
    messages,
    response_format: { type: 'json_object' },
    stream: false,
  };
  let text: string;
  try {
    text = await proxyChat(request, signal);
  } catch (error) {
    // Some gateways refuse response_format; the prompt already demands JSON.
    if (error instanceof PlannerError && error.status === 400 && /response_format|unsupported_field/i.test(error.message)) {
      const { response_format: _omit, ...rest } = request as any;
      text = await proxyChat(rest, signal);
    } else {
      throw error;
    }
  }
  try {
    return normalizePlan(extractJson(text));
  } catch {
    // One self-repair pass: show the model its own broken output.
    const repaired = await proxyChat({
      model: 'gpt-6.1-sol',
      reasoning_effort: 'medium',
      max_completion_tokens: 6000,
      messages: [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: `That reply was not one valid JSON object. Re-send ONLY the JSON object matching ${PLAN_SHAPE} — nothing else.` },
      ],
      stream: false,
    }, signal);
    return normalizePlan(extractJson(repaired));
  }
}

// ---------------------------------------------------------- sub-agents ----

export interface SubAgentReport {
  agentType: string;
  name: string;
  task: string;
  ok: boolean;
  /** The specialist's report, or the error message when ok is false. */
  text: string;
}

export async function runSubAgent(type: SubAgentType, task: string, context: string, signal?: AbortSignal): Promise<string> {
  const text = await proxyChat({
    model: 'gpt-6.1-sol',
    reasoning_effort: 'medium',
    max_completion_tokens: 6000,
    messages: [
      { role: 'system', content: `${type.prompt}\n\nCAPABILITY MANIFEST:\n${capabilityManifestText()}` },
      { role: 'user', content: `CONVERSATION SO FAR (condensed):\n${context}\n\nYOUR TASK:\n${task}` },
    ],
    stream: false,
  }, signal);
  return text.trim();
}

/** Run every dispatch concurrently; failures become ok:false reports instead of throwing. */
export async function runDispatches(
  dispatches: { agentType: string; task: string }[],
  context: string,
  onSettle?: (report: SubAgentReport) => void,
  signal?: AbortSignal,
): Promise<SubAgentReport[]> {
  const jobs = dispatches
    .map((d) => ({ type: subAgentById(d.agentType), task: d.task }))
    .filter((j): j is { type: SubAgentType; task: string } => Boolean(j.type));
  return Promise.all(
    jobs.map(async ({ type, task }) => {
      let report: SubAgentReport;
      try {
        report = { agentType: type.id, name: type.name, task, ok: true, text: await runSubAgent(type, task, context, signal) };
      } catch (error) {
        report = { agentType: type.id, name: type.name, task, ok: false, text: error instanceof Error ? error.message : 'This specialist failed.' };
      }
      if (onSettle) onSettle(report);
      return report;
    }),
  );
}

export function reportsAsContext(reports: SubAgentReport[]): string {
  const body = reports
    .map((r) => `--- ${r.name} (${r.agentType}) ${r.ok ? '' : '[FAILED] '}---\n${r.text}`)
    .join('\n\n');
  return `[sub-agent results]\n${body}\n\nMerge these into your next plan. If one failed, work without it or re-dispatch it once.`;
}

// --------------------------------------------------------------- chips ----

export const FALLBACK_CHIPS = [
  'Make a launch video from my website',
  'Turn my script into a cinematic film',
  'Edit my footage into a sharp short',
];

/** Two example-chip suggestions via the instant tier. Cached by the caller. */
export async function suggestChips(): Promise<string[]> {
  const text = await proxyChat({
    model: 'gpt-6-luna',
    reasoning_effort: 'none',
    max_completion_tokens: 2000,
    messages: [
      {
        role: 'system',
        content:
          'Verger is the main agent of Vidverge: it makes presenter/avatar videos, faceless films, script-to-video films, ads and edits via its studios. Reply with ONLY a JSON array of exactly 3 short first-person example requests a user could tap (each under 9 words, concrete, no emoji, no quotes inside).',
      },
      { role: 'user', content: 'Three fresh example chips.' },
    ],
    stream: false,
  });
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) return FALLBACK_CHIPS;
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  const chips = Array.isArray(parsed) ? parsed.filter((c: unknown) => typeof c === 'string' && c.trim()).slice(0, 3) : [];
  return chips.length === 3 ? chips : FALLBACK_CHIPS;
}

export { SUB_AGENT_TYPES };
