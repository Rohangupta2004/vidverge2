import type { AssetRow, Film, FilmScene, VideoClipSpec } from './api';
import { capabilityFor, S2V_VIDEO_CAPABILITIES } from './v2Contracts';
import { resolveVideoModel } from './pipeline/videoModelService';
import { SCENE_STALL_MS, msSinceSceneUpdate } from './pipeline/orchestrator';
import {
  compactToolResult, compactValue,
  prepareContextBody, requestWithContextRetry,
} from './contextBudget';

export const FILM_DIRECTOR_MODEL = 'claude-opus-5';
export const FILM_DIRECTOR_MAX_TOKENS = 16000;

export type AgentToolName =
  | 'read_project_state'
  | 'read_scene_failure'
  | 'inspect_scene_visuals'
  | 'edit_brief'
  | 'edit_character'
  | 'edit_scene_prompt'
  | 'regenerate_scene'
  | 'approve_plan'
  | 'start_render'
  | 'stop_render';

export interface AgentProposal {
  id: string;
  tool: AgentToolName;
  args: Record<string, unknown>;
  title: string;
  summary: string;
  costNotice?: string;
  status: 'pending' | 'applied' | 'declined' | 'undone' | 'failed';
}

export interface AgentUndo {
  tool: AgentToolName;
  payload: Record<string, unknown>;
}

export interface AgentStep {
  id: string;
  tool: AgentToolName;
  label: string;
  state: 'running' | 'done' | 'failed' | 'awaiting_approval';
  detail?: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  steps?: AgentStep[];
  proposal?: AgentProposal;
  undo?: AgentUndo;
}

export interface AgentMetrics {
  model: typeof FILM_DIRECTOR_MODEL;
  durationsMs: number[];
  durationsByMode?: { text: number[]; vision: number[] };
  lastCallAt?: string;
  /** Deterministic rolling summary of older turns; saved with the film. */
  contextSummary?: string;
  contextCompactions?: number;
}

export interface AgentTurnResult {
  text: string;
  steps: AgentStep[];
  proposal?: AgentProposal;
  metrics: AgentMetrics;
  trimNotice?: string;
}

interface ToolResult {
  text: string;
  summary?: string;
  images?: string[];
  proposal?: AgentProposal;
}

const TOOLS: Array<Record<string, unknown>> = [
  {
    name: 'read_project_state',
    description: 'Read the current film brief, cast, approved plan, per-scene status, render state, errors, audio state and safe model limits. Use before answering project-state questions.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: { focus: { type: 'string', enum: ['all', 'brief', 'cast', 'plan', 'produce', 'finish'] } },
    },
  },
  {
    name: 'read_scene_failure',
    description: 'Read stored provider/job/error/validation/audio evidence for one scene. Diagnose only from this result; if evidence is absent, say it is absent.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['scene_id'],
      properties: { scene_id: { type: 'integer' } },
    },
  },
  {
    name: 'inspect_scene_visuals',
    description: 'Look at the scene storyboard, character references, first frame, final frame and finished clip frames that already exist. Use for missing/inconsistent character or visual mismatch questions.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['scene_id'],
      properties: { scene_id: { type: 'integer' } },
    },
  },
  {
    name: 'edit_brief',
    description: 'Propose a reversible pre-production edit to title, visual direction, audio policy, or target duration. The original source script is immutable after planning.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' },
        visual_direction: { type: 'string' },
        audio_policy: { type: 'string', enum: ['native-dialogue-effects', 'narration-voiceover', 'music-ambience', 'no-narration', 'fully-silent'] },
        target_duration_sec: { type: 'integer', minimum: 2, maximum: 1800 },
      },
    },
  },
  {
    name: 'edit_character',
    description: 'Propose a reversible pre-production change to one existing character. Editing identity unapproves the sheet so the creator can review it again.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['character_id'],
      properties: {
        character_id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' },
        age_appearance: { type: 'string' }, wardrobe: { type: 'string' },
        personality_voice: { type: 'string' }, appearance: { type: 'string' },
        voice_tone: { type: 'string' }, voice_accent: { type: 'string' }, voice_pace: { type: 'string' },
      },
    },
  },
  {
    name: 'edit_scene_prompt',
    description: 'Propose a reversible edit to one scene prompt. Optionally re-split its timing into contiguous timed beats inside the same legal provider block; this does not invent or delete source script.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['scene_id', 'prompt', 'reason'],
      properties: {
        scene_id: { type: 'integer' }, prompt: { type: 'string' }, reason: { type: 'string' },
        timed_beats: {
          type: 'array', minItems: 2,
          items: {
            type: 'object', additionalProperties: false, required: ['start_s', 'end_s', 'action'],
            properties: { start_s: { type: 'number' }, end_s: { type: 'number' }, action: { type: 'string' }, camera: { type: 'string' }, dialogue: { type: 'string' }, audio: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    name: 'regenerate_scene',
    description: 'Propose rewriting and regenerating exactly one scene. This is billable and must show the creator the scene, model and authorization before approval.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['scene_id', 'instruction'],
      properties: { scene_id: { type: 'integer' }, instruction: { type: 'string' } },
    },
  },
  {
    name: 'approve_plan',
    description: 'Propose approving the current plan without starting a paid render. Cast approval and model/audio safety gates still apply.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'start_render',
    description: 'Propose starting the durable server-side production. Never use this to bypass cast approval, model audio rules, duration rules, or the saved credit ceiling.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'stop_render',
    description: 'Propose pausing future submissions or permanently stopping future jobs. A provider job already submitted may still finish and be billed.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['mode'],
      properties: { mode: { type: 'string', enum: ['pause', 'stop_future_jobs'] } },
    },
  },
];

const MUTATING = new Set<AgentToolName>(['edit_brief', 'edit_character', 'edit_scene_prompt', 'regenerate_scene', 'approve_plan', 'start_render', 'stop_render']);

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, field: string, optional = false): string | undefined {
  if (value == null && optional) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function integer(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer.`);
  return Number(value);
}

function findScene(scenes: FilmScene[], value: unknown): FilmScene {
  const sceneId = integer(value, 'scene_id');
  const scene = scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} is not part of this film.`);
  return scene;
}

function planIsEditable(film: Film, scenes: FilmScene[]): boolean {
  return !film.plan?.background?.enabled && scenes.every((scene) => ['waiting', 'ready', 'failed'].includes(String(scene.status)));
}

function validateInput(name: AgentToolName, raw: unknown, film: Film, scenes: FilmScene[]): Record<string, unknown> {
  if (!isObject(raw)) throw new Error('Tool input must be one JSON object.');
  const input = raw;
  if (name === 'read_project_state') {
    const focus = input.focus == null ? 'all' : text(input.focus, 'focus');
    if (!['all', 'brief', 'cast', 'plan', 'produce', 'finish'].includes(String(focus))) throw new Error('focus is not supported.');
    return { focus };
  }
  if (name === 'read_scene_failure' || name === 'inspect_scene_visuals') {
    const scene = findScene(scenes, input.scene_id);
    return { scene_id: scene.id };
  }
  if (MUTATING.has(name) && !planIsEditable(film, scenes) && ['edit_brief', 'edit_character', 'edit_scene_prompt', 'approve_plan'].includes(name)) {
    throw new Error('The plan is locked because paid production has started. Diagnose or regenerate one affected scene instead.');
  }
  if (name === 'edit_brief') {
    const out: Record<string, unknown> = {};
    if (input.title != null) out.title = text(input.title, 'title');
    if (input.visual_direction != null) out.visual_direction = text(input.visual_direction, 'visual_direction');
    if (input.audio_policy != null) {
      const policy = text(input.audio_policy, 'audio_policy');
      if (!['native-dialogue-effects', 'narration-voiceover', 'music-ambience', 'no-narration', 'fully-silent'].includes(String(policy))) throw new Error('audio_policy is not supported.');
      out.audio_policy = policy;
    }
    if (input.target_duration_sec != null) {
      const duration = integer(input.target_duration_sec, 'target_duration_sec');
      if (duration < 2 || duration > 1800) throw new Error('target_duration_sec must be between 2 and 1800 seconds.');
      out.target_duration_sec = duration;
    }
    if (!Object.keys(out).length) throw new Error('edit_brief needs at least one changed field.');
    return out;
  }
  if (name === 'edit_character') {
    const characterId = text(input.character_id, 'character_id')!;
    if (!(film.character_refs || []).some((character) => character.id === characterId)) throw new Error(`Character ${characterId} is not in this film.`);
    const out: Record<string, unknown> = { character_id: characterId };
    for (const key of ['name', 'role', 'age_appearance', 'wardrobe', 'personality_voice', 'appearance', 'voice_tone', 'voice_accent', 'voice_pace']) {
      if (input[key] != null) out[key] = text(input[key], key);
    }
    if (Object.keys(out).length === 1) throw new Error('edit_character needs at least one changed field.');
    return out;
  }
  if (name === 'edit_scene_prompt') {
    const scene = findScene(scenes, input.scene_id);
    const prompt = text(input.prompt, 'prompt')!;
    const reason = text(input.reason, 'reason')!;
    const out: Record<string, unknown> = { scene_id: scene.id, prompt, reason };
    if (input.timed_beats != null) {
      if (!Array.isArray(input.timed_beats) || input.timed_beats.length < 2) throw new Error('timed_beats must contain at least two beats.');
      const duration = Number(scene.duration_s || (scene.spec as VideoClipSpec)?.duration_s || 0);
      let cursor = 0;
      const beats = input.timed_beats.map((beat, index) => {
        if (!isObject(beat)) throw new Error(`timed_beats[${index}] must be an object.`);
        const start = Number(beat.start_s); const end = Number(beat.end_s);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start !== cursor || end <= start) throw new Error(`timed_beats[${index}] must start at ${cursor} and end after it.`);
        cursor = end;
        return { start_s: start, end_s: end, action: text(beat.action, `timed_beats[${index}].action`)!, ...(beat.camera != null ? { camera: text(beat.camera, 'camera') } : {}), ...(beat.dialogue != null ? { dialogue: text(beat.dialogue, 'dialogue') } : {}), ...(beat.audio != null ? { audio: text(beat.audio, 'audio') } : {}) };
      });
      if (cursor !== duration) throw new Error(`timed_beats must cover the scene exactly from 0 to ${duration} seconds.`);
      out.timed_beats = beats;
    }
    return out;
  }
  if (name === 'regenerate_scene') {
    const scene = findScene(scenes, input.scene_id);
    return { scene_id: scene.id, instruction: text(input.instruction, 'instruction')! };
  }
  if (name === 'approve_plan' || name === 'start_render') return {};
  if (name === 'stop_render') {
    const mode = text(input.mode, 'mode');
    if (!['pause', 'stop_future_jobs'].includes(String(mode))) throw new Error('mode must be pause or stop_future_jobs.');
    if (!film.plan?.background?.enabled) throw new Error('No durable render is currently active for this film.');
    return { mode };
  }
  throw new Error(`Unsupported tool ${name}.`);
}

function compactProject(film: Film, scenes: FilmScene[], assets: AssetRow[]) {
  const plan = film.plan ? { ...film.plan } as Record<string, unknown> : null;
  if (plan) {
    delete plan.assistant;
    delete plan.exports;
    delete plan.editor_versions;
  }
  return {
    film: {
      id: film.id, title: film.title, script: String(film.script || '').slice(0, 12_000), aspect_ratio: film.aspect_ratio,
      status: film.status, stage_note: film.stage_note, plan: compactValue(plan, 16_000), continuity: compactValue(film.continuity, 3_000),
      brand: compactValue(film.brand, 3_000), product_screenshot_url: film.product_screenshot_url,
      final_video_url: film.final_video_url, duration_s: film.duration_s, error: film.error,
      finish: compactValue(film.finish, 3_000), machine_state: film.machine_state,
      character_refs: (film.character_refs || []).map((character) => ({ id: character.id, name: character.name, appearance: character.appearance, wardrobe: character.wardrobe, approved: character.approved, url: character.url })),
      audio: compactValue(film.audio, 4_000), video_model: film.video_model, style_lock: film.style_lock,
      style_lock_description: film.style_lock_description, at_references: compactValue(film.at_references, 3_000), updated_at: film.updated_at,
    },
    scenes: [...scenes].sort((a, b) => a.idx - b.idx).map((scene) => {
      const detailed = scene.idx < 2 || ['failed', 'generating', 'needs_action', 'ready'].includes(String(scene.status));
      return {
        id: scene.id, idx: scene.idx, scene_key: scene.scene_key, status: scene.status, duration_s: scene.duration_s,
        script_segment: String(scene.script_segment || '').slice(0, detailed ? 900 : 260), prompt: detailed ? String(scene.prompt || '').slice(0, 1_200) : '',
        error: scene.error, operation_id: scene.veo_operation_id, asset_url: scene.asset_url,
        first_frame_url: scene.first_frame_url, keyframe_url: scene.keyframe_url,
        references: detailed ? (scene.reference_assets || []).map((reference) => ({ type: reference.type, role: reference.role, label: reference.label, url: reference.url })) : [],
        validation: detailed ? compactValue(scene.validation, 1_500) : compactValue({ pass: scene.validation?.pass, issues: scene.validation?.issues }, 400),
        spec: detailed ? compactValue(scene.spec, 1_800) : compactValue({ engine_id: (scene.spec as VideoClipSpec)?.engine_id, background: (scene.spec as VideoClipSpec)?.background?.status }, 500),
        updated_at: scene.updated_at,
      };
    }),
    assets: assets.slice(0, 60).map((asset) => ({ id: asset.id, kind: asset.kind, name: asset.name, url: /^https:\/\//.test(String(asset.url || '')) ? asset.url : '[inline asset omitted]' })),
    verified_model_capabilities: S2V_VIDEO_CAPABILITIES,
  };
}

function systemPrompt(contextJson: string, trimNotice?: string): string {
  return `You are Director, the tool-using production agent inside Script-to-Video. You run the saved Brief → Cast → Plan → Produce → Finish flow with the creator, never as a generic chatbot.

Model and safety rules:
- Use tools for every project fact and every action. Never claim an action happened unless its tool result says it did.
- Mutating tools create visible proposals. The creator must approve or decline them in the UI; do not say a proposal is already applied.
- Diagnose failures, stalls, silence and missing characters only from stored job, clip, audio-probe and image evidence. State exactly what evidence is missing instead of guessing.
- Respect the saved model capability snapshot, audio-capable-model requirement, legal block duration, reference cap and authorized credit ceiling. Explain a violated rule; never work around it.
- The source script is immutable after planning. Brief edits may change title, visual direction, audio policy or target duration, but not silently rewrite source words.
- For a small requested edit, propose only that edit. For planning or diagnosis, inspect the complete relevant state first.
- Tool arguments are schema-checked before they can touch the project. If a tool result reports invalid input, repair it once. After a second rejection, explain the error clearly.
- Keep answers concise and name scene numbers, statuses, models, stored errors and measured audio/visual evidence.
${trimNotice ? `\nCONTEXT TRIM NOTICE: ${trimNotice}` : ''}

CURRENT PROJECT STATE (authoritative this turn):
${contextJson}`;
}

function plainHistory(messages: AgentMessage[]) {
  return messages.filter((message) => message.text.trim()).map((message) => ({ role: message.role, content: message.text }));
}

function fitRequest(film: Film, scenes: FilmScene[], assets: AssetRow[], history: AgentMessage[], userText: string, metrics: AgentMetrics) {
  const project = compactProject(film, scenes, assets);
  return {
    system: systemPrompt(JSON.stringify(project)),
    messages: [...plainHistory(history), { role: 'user', content: userText }],
    trimNotice: undefined,
    metrics,
  };
}

function measuredTimeoutMs(metrics: AgentMetrics, mode: 'text' | 'vision'): number | null {
  const samples = (metrics.durationsByMode?.[mode] || []).filter((value) => Number.isFinite(value) && value > 0);
  if (samples.length < 2) return null;
  const minimum = Math.min(...samples);
  const maximum = Math.max(...samples);
  return maximum + (maximum - minimum);
}

async function callClaude(system: string, messages: any[], metrics: AgentMetrics, useTools = true) {
  const token = String((window as any).__workspaceDb?.token || '');
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const started = performance.now();
  const mode: 'text' | 'vision' = messages.some((message) => Array.isArray(message.content) && message.content.some((block: any) => block?.type === 'image')) ? 'vision' : 'text';
  const timeoutMs = measuredTimeoutMs(metrics, mode);
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller && timeoutMs ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const visionUrls = mode === 'vision' ? messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((block: any) => block?.type === 'image' && /^https:\/\//.test(String(block.source?.url || ''))).map((block: any) => String(block.source.url)) : []) : [];
    const visionEvidence = mode === 'vision' ? compactToolResult(messages.slice(-3), 18_000) : '';
    const call = await requestWithContextRetry({
      prepare: (aggressive) => mode === 'vision'
        ? prepareContextBody({
            system, aggressive,
            messages: [{ role: 'user', content: [{ type: 'text', text: `Analyze only this current-scene evidence and answer the creator’s latest diagnosis request. Do not claim any mutation.\n\n${visionEvidence}` }, ...visionUrls.map((url) => ({ type: 'image_url', image_url: { url } }))] }],
            buildBody: (_safeSystem, safeMessages) => ({ model: 'gpt-6.1-sol', reasoning_effort: 'medium', max_completion_tokens: 6000, messages: [{ role: 'system', content: system }, ...safeMessages], stream: false }),
          })
        : prepareContextBody({
            system, messages, priorSummary: metrics.contextSummary, aggressive,
            buildBody: (safeSystem, safeMessages) => ({
              model: FILM_DIRECTOR_MODEL,
              max_tokens: FILM_DIRECTOR_MAX_TOKENS,
              thinking: { type: 'adaptive' },
              output_config: { effort: 'medium' },
              system: safeSystem,
              messages: safeMessages,
              ...(useTools ? { tools: TOOLS } : {}),
              stream: false,
            }),
          }),
      send: async (body: any) => {
        const response = await fetch(mode === 'vision' ? '/proxy/openai/v1/chat/completions' : '/proxy/anthropic/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
          signal: controller?.signal,
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.error) throw new Error(String(data?.error?.message || data?.error || `Director request failed (HTTP ${response.status}).`));
        return data;
      },
    });
    const duration = Math.round(performance.now() - started);
    const byMode = metrics.durationsByMode || { text: [], vision: [] };
    const nextMetrics: AgentMetrics = {
      ...metrics,
      model: FILM_DIRECTOR_MODEL,
      durationsMs: [...metrics.durationsMs, duration],
      durationsByMode: { ...byMode, [mode]: [...byMode[mode], duration] },
      lastCallAt: new Date().toISOString(),
      contextSummary: call.prepared.runningSummary || metrics.contextSummary,
      contextCompactions: Number(metrics.contextCompactions || 0) + (call.prepared.compacted || call.retried ? 1 : 0),
    };
    const data = mode === 'vision'
      ? { content: [{ type: 'text', text: String((call.result as any)?.choices?.[0]?.message?.content || '') }], stop_reason: (call.result as any)?.choices?.[0]?.finish_reason || 'end_turn' }
      : call.result;
    return { data, metrics: nextMetrics, compactNotice: call.prepared.notice, retried: call.retried };
  } catch (error: any) {
    if (error?.name === 'AbortError' && timeoutMs) throw new Error(`Director request exceeded the measured ${Math.round(timeoutMs)} ms budget derived from prior successful calls. Nothing was changed.`);
    throw error;
  } finally {
    if (timeout != null) window.clearTimeout(timeout);
  }
}

function readProject(film: Film, scenes: FilmScene[], focus: string): ToolResult {
  const ordered = [...scenes].sort((a, b) => a.idx - b.idx);
  const project = {
    focus,
    film: { id: film.id, title: film.title, status: film.status, machine_state: film.machine_state, stage_note: film.stage_note, error: film.error, video_model: film.video_model, target_duration_sec: film.plan?.target_duration_sec, audio_policy: film.plan?.audio_policy, max_authorized_credits: film.plan?.max_authorized_credits, background: film.plan?.background, final_video_url: film.final_video_url },
    cast: film.character_refs || [],
    scenes: ordered.map((scene) => ({ id: scene.id, number: scene.idx + 1, status: scene.status, duration_s: scene.duration_s, model: (scene.spec as VideoClipSpec)?.engine_id || film.video_model, prompt: scene.prompt, error: scene.error, validation: scene.validation, asset_url: scene.asset_url, first_frame_url: scene.first_frame_url, keyframe_url: scene.keyframe_url, updated_at: scene.updated_at })),
    audio: film.audio,
  };
  return { text: JSON.stringify(project), summary: `${ordered.length} scene${ordered.length === 1 ? '' : 's'} read; film status ${film.status || 'unknown'}.` };
}

function sceneEvidence(film: Film, scene: FilmScene): ToolResult {
  const spec = (scene.spec || {}) as VideoClipSpec;
  const actualModel = String(scene.validation?.actual_model || spec.background?.actual_model || spec.engine_id || film.video_model || '');
  const model = resolveVideoModel(actualModel);
  const audioProbe = (scene.validation as any)?.audio_probe || null;
  const evidence = {
    scene_id: scene.id, scene_number: scene.idx + 1, status: scene.status, stored_error: scene.error,
    updated_at: scene.updated_at, provider_operation_id: scene.veo_operation_id || spec.background?.provider_job_id || null,
    provider_status: spec.background?.provider_status || spec.background?.status || null,
    requested_model: spec.engine_id || film.video_model, actual_model: actualModel || null,
    requested_duration_s: scene.duration_s, actual_duration_s: spec.background?.actual_duration_s || scene.validation?.requested_duration || null,
    model_audio_capable: model.audioSupported === true, audio_requested: film.plan?.audio_enabled !== false,
    measured_audio_probe: audioProbe, validation: scene.validation, has_clip: Boolean(scene.asset_url),
    has_first_frame: Boolean(scene.first_frame_url), has_final_frame: Boolean(scene.keyframe_url),
    prompt: String(scene.prompt || '').slice(0, 6_000),
    references_sent: (scene.reference_assets || []).map((reference) => ({ type: reference.type, role: reference.role, label: reference.label, url: reference.url })),
  };
  const images = [scene.first_frame_url, scene.keyframe_url, spec.storyboard_url, ...(film.character_refs || []).filter((character) => (spec.characters || []).includes(character.id)).map((character) => character.url)].filter((url): url is string => Boolean(url && /^https:\/\//.test(url)));
  return { text: JSON.stringify(evidence), summary: scene.error ? `Stored scene error: ${scene.error}` : `Scene ${scene.idx + 1} status ${scene.status}; no stored error.`, images: Array.from(new Set(images)).slice(0, 10) };
}

function visualEvidence(film: Film, scene: FilmScene, assets: AssetRow[]): ToolResult {
  const spec = (scene.spec || {}) as VideoClipSpec;
  const characterIds = Array.isArray(spec.characters) ? spec.characters : [];
  const characterRefs = (film.character_refs || []).filter((character) => characterIds.includes(character.id) && character.url).map((character) => ({ id: character.id, name: character.name, appearance: character.appearance, url: character.url }));
  const projectAssets = assets.filter((asset) => ['character', 'storyboard', 'keyframe', 'clip', 'screenshot', 'product'].includes(asset.kind));
  const images = [spec.storyboard_url, scene.first_frame_url, scene.keyframe_url, ...characterRefs.map((character) => character.url), ...projectAssets.map((asset) => asset.url)].filter((url): url is string => Boolean(url && /^https:\/\//.test(url)));
  return {
    text: JSON.stringify({ scene_id: scene.id, scene_number: scene.idx + 1, expected_characters: characterRefs, storyboard: spec.storyboard_url ? { url: spec.storyboard_url, caption: String(spec.storyboard_caption || '').slice(0, 500) } : null, first_frame_url: scene.first_frame_url, final_frame_url: scene.keyframe_url, clip_url: scene.asset_url, visual_attributes: compactValue(scene.visual_attributes, 2_000), validation: compactValue(scene.validation, 3_000), available_assets: projectAssets.slice(0, 20).map((asset) => ({ id: asset.id, kind: asset.kind, name: asset.name, url: asset.url })) }),
    summary: `${Array.from(new Set(images)).slice(0, 10).length} saved visual reference${Array.from(new Set(images)).slice(0, 10).length === 1 ? '' : 's'} attached.`,
    images: Array.from(new Set(images)).slice(0, 10),
  };
}

function proposalFor(name: AgentToolName, args: Record<string, unknown>, film: Film, scenes: FilmScene[]): AgentProposal {
  const scene = 'scene_id' in args ? scenes.find((item) => item.id === args.scene_id) : null;
  if (name === 'edit_brief') return { id: id('proposal'), tool: name, args, title: 'Update the film brief', summary: `Change ${Object.keys(args).join(', ')}. The source script and rendered clips stay untouched.`, status: 'pending' };
  if (name === 'edit_character') return { id: id('proposal'), tool: name, args, title: `Edit ${(film.character_refs || []).find((item) => item.id === args.character_id)?.name || 'character'}`, summary: 'Update the locked character description and return the sheet to review. Existing rendered clips stay untouched.', status: 'pending' };
  if (name === 'edit_scene_prompt') return { id: id('proposal'), tool: name, args, title: `Edit scene ${(scene?.idx ?? 0) + 1} prompt`, summary: `${String(args.reason)}${args.timed_beats ? ' The timing is re-split inside the same provider block.' : ''}`, status: 'pending' };
  if (name === 'regenerate_scene') {
    const spec = (scene?.spec || {}) as VideoClipSpec;
    const model = resolveVideoModel(spec.engine_id || film.video_model);
    const seconds = Number(scene?.duration_s || spec.duration_s || 0);
    const capability = capabilityFor(model.apiModel) || capabilityFor(model.id);
    return { id: id('proposal'), tool: name, args, title: `Regenerate scene ${(scene?.idx ?? 0) + 1}`, summary: `Rewrite and rerender only scene ${(scene?.idx ?? 0) + 1} on ${model.label}.`, costNotice: `Authorization: up to ${seconds} video credits. ${capability?.price.note || 'The provider receipt is authoritative.'}`, status: 'pending' };
  }
  if (name === 'approve_plan') return { id: id('proposal'), tool: name, args, title: 'Approve this plan', summary: 'Mark the current saved plan approved. This does not submit any paid render.', status: 'pending' };
  if (name === 'start_render') {
    const estimated = Number(film.plan?.orchestration?.credits_estimated || scenes.filter((item) => !['completed', 'skipped'].includes(String(item.status))).reduce((sum, item) => sum + Number(item.duration_s || 0), 0));
    return { id: id('proposal'), tool: name, args, title: 'Start durable production', summary: 'Pre-authorize unfinished scenes and hand production to the server so it continues with the tab closed.', costNotice: `Saved authorization ceiling: ${film.plan?.max_authorized_credits ?? 'not set'} credits. Current unfinished estimate: ${estimated} credits; provider receipts remain authoritative.`, status: 'pending' };
  }
  const mode = String(args.mode || 'pause');
  return { id: id('proposal'), tool: name, args, title: mode === 'pause' ? 'Pause future submissions' : 'Stop every future job', summary: mode === 'pause' ? 'The current provider job may finish; no later scene will be submitted until resumed.' : 'Completed clips remain saved. A provider job already submitted may still finish and be billed.', status: 'pending' };
}

function executeReadTool(name: AgentToolName, args: Record<string, unknown>, film: Film, scenes: FilmScene[], assets: AssetRow[]): ToolResult {
  if (name === 'read_project_state') return readProject(film, scenes, String(args.focus || 'all'));
  if (name === 'read_scene_failure' || name === 'inspect_scene_visuals') {
    const scene = findScene(scenes, args.scene_id);
    return name === 'read_scene_failure' ? sceneEvidence(film, scene) : visualEvidence(film, scene, assets);
  }
  return { text: JSON.stringify({ proposal_created: true, action: name }), proposal: proposalFor(name, args, film, scenes) };
}

function responseText(content: any[]): string {
  return (Array.isArray(content) ? content : []).filter((block) => block?.type === 'text').map((block) => String(block.text || '')).join('\n').trim();
}

function toolUses(content: any[]): any[] {
  return (Array.isArray(content) ? content : []).filter((block) => block?.type === 'tool_use');
}

export async function runFilmAgentTurn(params: {
  film: Film;
  scenes: FilmScene[];
  assets: AssetRow[];
  history: AgentMessage[];
  userText: string;
  metrics?: AgentMetrics;
  onSteps?: (steps: AgentStep[]) => void;
}): Promise<AgentTurnResult> {
  const metrics: AgentMetrics = params.metrics || { model: FILM_DIRECTOR_MODEL, durationsMs: [] };
  const fitted = fitRequest(params.film, params.scenes, params.assets, params.history, params.userText, metrics);
  let workingMetrics = metrics;
  let messages: any[] = fitted.messages;
  const steps: AgentStep[] = [];
  let proposal: AgentProposal | undefined;
  let invalidRepairUsed = false;
  let lastText = '';
  let compactNotice = fitted.trimNotice;

  for (let round = 0; round <= TOOLS.length; round += 1) {
    const response = await callClaude(fitted.system, messages, workingMetrics, !proposal);
    if (response.compactNotice) compactNotice = response.compactNotice;
    workingMetrics = response.metrics;
    const content = Array.isArray(response.data?.content) ? response.data.content : [];
    const visible = responseText(content);
    if (visible) lastText = visible;
    const uses = toolUses(content);
    if (!uses.length || proposal) break;

    const toolResults: any[] = [];
    const imageBlocks: any[] = [];
    let needsRepair = false;
    for (const use of uses) {
      const name = String(use.name || '') as AgentToolName;
      const step: AgentStep = { id: String(use.id || id('step')), tool: name, label: name.replace(/_/g, ' '), state: 'running' };
      steps.push(step); params.onSteps?.([...steps]);
      try {
        if (!TOOLS.some((tool) => tool.name === name)) throw new Error(`Unknown tool ${name}.`);
        const args = validateInput(name, use.input, params.film, params.scenes);
        const result = executeReadTool(name, args, params.film, params.scenes, params.assets);
        step.state = result.proposal ? 'awaiting_approval' : 'done';
        step.detail = result.proposal ? result.proposal.summary : (result.summary || 'Read from the saved film state.');
        if (result.proposal && !proposal) proposal = result.proposal;
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: compactToolResult(result.text) });
        for (const url of result.images || []) imageBlocks.push({ type: 'image', source: { type: 'url', url } });
      } catch (error: any) {
        step.state = 'failed'; step.detail = String(error?.message || error);
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `INVALID_TOOL_INPUT: ${step.detail}` });
        needsRepair = true;
      }
      params.onSteps?.([...steps]);
    }
    messages = [...messages, { role: 'assistant', content }, { role: 'user', content: [...toolResults, ...imageBlocks] }];
    if (needsRepair) {
      proposal = undefined;
      if (invalidRepairUsed) throw new Error('The director produced invalid tool arguments twice. Nothing was changed; review the visible validation error and try a narrower instruction.');
      invalidRepairUsed = true;
      continue;
    }
    if (proposal) {
      const final = await callClaude(fitted.system, messages, workingMetrics, false);
      if (final.compactNotice) compactNotice = final.compactNotice;
      workingMetrics = final.metrics;
      lastText = responseText(final.data?.content) || lastText || 'I prepared the action for your approval.';
      break;
    }
  }

  if (!lastText) lastText = proposal ? 'I prepared the action for your approval.' : 'I could not produce a visible answer. Nothing was changed.';
  return { text: lastText, steps, proposal, metrics: workingMetrics, trimNotice: compactNotice };
}

export function proactiveIssue(film: Film, scenes: FilmScene[]): { text: string; prompt: string } | null {
  const failed = [...scenes].sort((a, b) => a.idx - b.idx).find((scene) => scene.status === 'failed');
  if (failed) return { text: `Scene ${failed.idx + 1} failed. Stored reason: ${failed.error || 'no provider reason was saved'}.`, prompt: `Diagnose scene ${failed.idx + 1} from its stored job, error, validation and visual evidence. Offer one safe fix.` };
  const stalled = [...scenes].sort((a, b) => a.idx - b.idx).find((scene) => scene.status === 'generating' && msSinceSceneUpdate(scene, film) >= SCENE_STALL_MS);
  if (stalled) return { text: `Scene ${stalled.idx + 1} has no saved progress inside the pipeline's measured stall window.`, prompt: `Diagnose stalled scene ${stalled.idx + 1} from its saved operation id, provider status and update time. Offer one safe fix.` };
  const visualMismatch = [...scenes].sort((a, b) => a.idx - b.idx).find((scene) => scene.validation?.pass === false && /missing|character|person|identity|inconsistent/i.test(String(scene.validation?.issues || '')));
  if (visualMismatch) return { text: `Scene ${visualMismatch.idx + 1} needs visual review: ${visualMismatch.validation?.issues}`, prompt: `Inspect scene ${visualMismatch.idx + 1}'s saved character references, storyboard and extracted frames. Explain the measured identity mismatch and offer one safe fix.` };
  const silent = [...scenes].sort((a, b) => a.idx - b.idx).find((scene) => {
    const probe = (scene.validation as any)?.audio_probe;
    const model = resolveVideoModel((scene.spec as VideoClipSpec)?.engine_id || film.video_model);
    return film.plan?.audio_enabled !== false && model.audioSupported && probe?.audible === false;
  });
  if (silent) {
    const probe = (silent.validation as any).audio_probe;
    const measured = Number.isFinite(Number(probe.rmsDb)) ? `${Number(probe.rmsDb).toFixed(1)} dB mean` : 'no decodable audio track';
    return { text: `Scene ${silent.idx + 1} measured silent even though its selected model supports audio (${measured}).`, prompt: `Diagnose why scene ${silent.idx + 1} is silent using its measured audio probe and stored generation data. Offer one safe fix.` };
  }
  return null;
}
