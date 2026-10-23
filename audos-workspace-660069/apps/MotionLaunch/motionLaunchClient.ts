/**
 * MotionLaunch client — agentic planning, Seedance generation and deterministic
 * Remotion finishing. Website media is context only and is never sent to the
 * video model. User-supplied references are opt-in and remain scene-scoped.
 */
import { chargeCredits, newChargeKey, refundCredits } from '../../lib/credits';
import { poll } from '../../lib/poll';
import { finishPortrait, readRender, submitRender } from '../../lib/render/remotion';
import {
  WORKSPACE_ID as CANONICAL_WORKSPACE_ID,
  callHook as callWorkspaceHook,
  spaceId,
  workspaceTokenNow,
} from '../../lib/workspace';

export const WORKSPACE_ID = CANONICAL_WORKSPACE_ID;
export const MIN_SCENES = 1;
export const MAX_SCENES = 8;
export const MIN_SCENE_SECONDS = 4;
export const MAX_SCENE_SECONDS = 12;
export const TRANSITION_SECONDS = 0.35;
export const SEEDANCE_MODEL = 'openrouter/bytedance/seedance-2.0-fast';

export type Orientation = 'landscape' | 'portrait';
export type SceneStatus = 'pending' | 'generating' | 'processing' | 'completed' | 'failed';
export type PipelinePhase = 'brief' | 'planning' | 'review' | 'generating' | 'composing' | 'validating' | 'ready';

export interface CreativeInput {
  script: string;
  url: string;
  styleGuidance: string;
  brandColor: string;
  targetDuration: number | null;
  orientation: Orientation;
  referenceImageUrl: string;
  referenceImageName: string;
  voiceoverUrl: string;
  voiceoverName: string;
}

export interface ProductBrief {
  productName: string;
  tagline: string;
  features: string[];
  ogImageUrl: string;
  accentColor: string;
  siteName: string;
  sourceUrl: string;
  note: string;
}

export interface TextOverlay {
  text: string;
  startSec: number;
  endSec: number;
  treatment: 'headline' | 'caption' | 'label' | 'stat';
}

export interface GraphicInstruction {
  type: 'diagram' | 'chart' | 'timeline' | 'shapes' | 'frame';
  instruction: string;
  startSec: number;
  endSec: number;
}

export interface ScenePlan {
  id: string;
  order: number;
  title: string;
  purpose: string;
  narrationSegment: string;
  visualConcept: string;
  motionStyle: string;
  seedancePrompt: string;
  durationSeconds: number;
  transitionIntent: string;
  textOverlays: TextOverlay[];
  graphics: GraphicInstruction[];
  useUserReference: boolean;
  generationSettings: {
    aspectRatio: '16:9' | '9:16';
    duration: number;
    generateAudio: false;
  };
}

export interface ProductionPlan {
  creativeDirection: string;
  palette: string[];
  aspectRatio: '16:9' | '9:16';
  plannedDuration: number;
  audioInstructions: string;
  scenes: ScenePlan[];
}

export interface SceneRuntime {
  status: SceneStatus;
  operationId: string;
  clipUrl: string;
  progress: number;
  error: string;
  attempts: number;
}

export interface SceneView extends ScenePlan, SceneRuntime {}

export interface RunSnapshot {
  phase: PipelinePhase;
  detail: string;
  failed: boolean;
  scenes: SceneView[];
  completed: number;
  total: number;
}

export interface RunState {
  input: CreativeInput;
  brief: ProductBrief | null;
  plan: ProductionPlan | null;
  sceneRuns: Record<string, SceneRuntime>;
  finalUrl: string;
  geometry: string;
  actualDuration: number;
  filmId: number | null;
  galleryRegistered: boolean;
  chargeKey: string;
  charged: boolean;
  notes: string[];
}

export interface RunCallbacks {
  signal: AbortSignal;
  onProgress: (snapshot: RunSnapshot) => void;
  onNotice: (message: string) => void;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const workspaceToken = workspaceTokenNow;
const appId = spaceId;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AbortedError extends Error {
  constructor() { super('The run was stopped.'); this.name = 'AbortedError'; }
}

class ProviderGenerationError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderGenerationError'; }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AbortedError();
}

function clean(value: unknown, max = 1000): string {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

async function callHook<T>(name: string, body: Json, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  try {
    return await callWorkspaceHook<T>(name, body, { signal });
  } catch (error) {
    if (signal.aborted) throw new AbortedError();
    throw new Error(name + ' could not be reached: ' + errorMessage(error));
  }
}

export function normalizeUrl(value: string): string {
  const raw = String(value || '').trim();
  return raw && !/^https?:\/\//i.test(raw) ? 'https://' + raw : raw;
}

export function isLikelyUrl(value: string): boolean {
  try { return new URL(normalizeUrl(value)).hostname.includes('.'); } catch { return false; }
}

export function hostOf(value: string): string {
  try { return new URL(normalizeUrl(value)).hostname.replace(/^www\./, ''); } catch { return String(value || ''); }
}

export function plannedSeconds(plan: ProductionPlan | null): number {
  return plan ? plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) : 0;
}

export function newRunState(input: CreativeInput): RunState {
  return {
    input: { ...input, script: input.script.trim(), url: input.url.trim() },
    brief: null,
    plan: null,
    sceneRuns: {},
    finalUrl: '',
    geometry: '',
    actualDuration: 0,
    filmId: null,
    galleryRegistered: false,
    chargeKey: newChargeKey('motionlaunch'),
    charged: false,
    notes: [],
  };
}

export async function uploadAsset(file: File, folder: 'references' | 'voiceovers', signal?: AbortSignal): Promise<string> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Uploads in MotionLaunch are limited to 50 MB.');
  const form = new FormData();
  form.append('file', file);
  form.append('workspaceId', WORKSPACE_ID);
  form.append('folder', 'motionlaunch-' + folder);
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-App-Id': appId() },
    body: form,
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success || !data?.url) throw new Error(String(data?.error || 'The file could not be uploaded.'));
  return String(data.url);
}

export async function fetchProductBrief(url: string, signal: AbortSignal): Promise<ProductBrief> {
  return callHook<ProductBrief>('motionlaunch-fetch-url', { url: normalizeUrl(url) }, signal);
}

function parseJson(raw: string): unknown {
  let source = String(raw || '').trim();
  if (source.startsWith('```')) source = source.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(source); } catch { return null; }
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function validateOverlay(raw: unknown, duration: number, path: string, issues: string[]): TextOverlay | null {
  if (!isRecord(raw)) { issues.push(path + ' must be an object'); return null; }
  const text = clean(raw.text, 140);
  const startSec = finite(raw.startSec);
  const endSec = finite(raw.endSec);
  const treatment = String(raw.treatment || 'headline') as TextOverlay['treatment'];
  if (!text) issues.push(path + '.text is required');
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec || endSec > duration) {
    issues.push(path + ' timing must fit inside its scene');
  }
  if (!['headline', 'caption', 'label', 'stat'].includes(treatment)) issues.push(path + '.treatment is unsupported');
  return text && Number.isFinite(startSec) && Number.isFinite(endSec)
    ? { text, startSec, endSec, treatment: ['headline', 'caption', 'label', 'stat'].includes(treatment) ? treatment : 'headline' }
    : null;
}

function validateGraphic(raw: unknown, duration: number, path: string, issues: string[]): GraphicInstruction | null {
  if (!isRecord(raw)) { issues.push(path + ' must be an object'); return null; }
  const type = String(raw.type || '') as GraphicInstruction['type'];
  const instruction = clean(raw.instruction, 300);
  const startSec = finite(raw.startSec);
  const endSec = finite(raw.endSec);
  if (!['diagram', 'chart', 'timeline', 'shapes', 'frame'].includes(type)) issues.push(path + '.type is unsupported');
  if (!instruction) issues.push(path + '.instruction is required');
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec || endSec > duration) {
    issues.push(path + ' timing must fit inside its scene');
  }
  return instruction && Number.isFinite(startSec) && Number.isFinite(endSec)
    ? { type, instruction, startSec, endSec }
    : null;
}

function validatePlan(raw: unknown, input: CreativeInput): { plan: ProductionPlan | null; issues: string[] } {
  const issues: string[] = [];
  if (!isRecord(raw)) return { plan: null, issues: ['The response must be a JSON object.'] };
  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  if (rawScenes.length < MIN_SCENES || rawScenes.length > MAX_SCENES) {
    issues.push('scenes must contain 1–' + MAX_SCENES + ' content-driven scenes');
  }
  const expectedAspect = input.orientation === 'portrait' ? '9:16' : '16:9';
  const ids = new Set<string>();
  const scenes: ScenePlan[] = [];

  rawScenes.slice(0, MAX_SCENES).forEach((item, index) => {
    const path = 'scenes[' + index + ']';
    if (!isRecord(item)) { issues.push(path + ' must be an object'); return; }
    const id = clean(item.id, 64);
    const title = clean(item.title, 80);
    const purpose = clean(item.purpose, 240);
    const narrationSegment = clean(item.narrationSegment, 1000);
    const visualConcept = clean(item.visualConcept, 500);
    const motionStyle = clean(item.motionStyle, 300);
    const seedancePrompt = clean(item.seedancePrompt, 950);
    const durationSeconds = Math.round(finite(item.durationSeconds));
    const transitionIntent = clean(item.transitionIntent, 240);
    const useUserReference = item.useUserReference === true;

    if (!id || ids.has(id)) issues.push(path + '.id must be present and unique');
    ids.add(id);
    if (!title) issues.push(path + '.title is required');
    if (!purpose) issues.push(path + '.purpose is required');
    if (!visualConcept) issues.push(path + '.visualConcept is required');
    if (!motionStyle) issues.push(path + '.motionStyle is required');
    if (seedancePrompt.length < 120) issues.push(path + '.seedancePrompt must be a detailed self-contained prompt of at least 120 characters');
    if (seedancePrompt.length > 950) issues.push(path + '.seedancePrompt exceeds 950 characters');
    if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_SCENE_SECONDS || durationSeconds > MAX_SCENE_SECONDS) {
      issues.push(path + '.durationSeconds must be an integer from ' + MIN_SCENE_SECONDS + ' to ' + MAX_SCENE_SECONDS);
    }
    if (useUserReference && !input.referenceImageUrl) issues.push(path + ' requests a user reference, but none was supplied');

    const settings: Json = isRecord(item.generationSettings) ? item.generationSettings : {};
    if (settings.aspectRatio !== expectedAspect) issues.push(path + '.generationSettings.aspectRatio must be ' + expectedAspect);
    if (Number(settings.duration) !== durationSeconds) issues.push(path + '.generationSettings.duration must match durationSeconds');
    if (settings.generateAudio !== false) issues.push(path + '.generationSettings.generateAudio must be false');

    const overlays: TextOverlay[] = [];
    if (!Array.isArray(item.textOverlays)) issues.push(path + '.textOverlays must be an array');
    else item.textOverlays.forEach((overlay, overlayIndex) => {
      const valid = validateOverlay(overlay, durationSeconds, path + '.textOverlays[' + overlayIndex + ']', issues);
      if (valid) overlays.push(valid);
    });

    const graphics: GraphicInstruction[] = [];
    if (!Array.isArray(item.graphics)) issues.push(path + '.graphics must be an array');
    else item.graphics.forEach((graphic, graphicIndex) => {
      const valid = validateGraphic(graphic, durationSeconds, path + '.graphics[' + graphicIndex + ']', issues);
      if (valid) graphics.push(valid);
    });

    if (id && title && purpose && visualConcept && motionStyle && seedancePrompt && Number.isFinite(durationSeconds)) {
      scenes.push({
        id,
        order: index + 1,
        title,
        purpose,
        narrationSegment,
        visualConcept,
        motionStyle,
        seedancePrompt,
        durationSeconds,
        transitionIntent,
        textOverlays: overlays,
        graphics,
        useUserReference,
        generationSettings: { aspectRatio: expectedAspect, duration: durationSeconds, generateAudio: false },
      });
    }
  });

  const creativeDirection = clean(raw.creativeDirection, 800);
  const palette = Array.isArray(raw.palette) ? raw.palette.map((value) => clean(value, 40)).filter(Boolean).slice(0, 8) : [];
  const audioInstructions = clean(raw.audioInstructions, 500);
  if (!creativeDirection) issues.push('creativeDirection is required');
  if (palette.length < 2) issues.push('palette must contain at least two color values or names');
  if (raw.aspectRatio !== expectedAspect) issues.push('aspectRatio must be ' + expectedAspect);
  const total = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const declared = Math.round(finite(raw.plannedDuration));
  if (declared !== total) issues.push('plannedDuration must equal the sum of scene durations (' + total + ')');

  return {
    plan: issues.length ? null : {
      creativeDirection,
      palette,
      aspectRatio: expectedAspect,
      plannedDuration: total,
      audioInstructions,
      scenes,
    },
    issues,
  };
}

async function requestDirector(messages: { role: 'system' | 'user'; content: string }[], signal: AbortSignal): Promise<unknown> {
  const token = workspaceToken();
  if (!token) throw new Error('The GPT Sol planner is unavailable — reload the workspace and try again.');
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      reasoning_effort: 'medium',
      max_completion_tokens: 8192,
      response_format: { type: 'json_object' },
      messages,
      stream: false,
    }),
    signal,
  }).catch((error: unknown) => {
    if (signal.aborted) throw new AbortedError();
    throw new Error('The creative director could not be reached: ' + errorMessage(error));
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(data) ? String((isRecord(data.error) ? data.error.message : data.error) || data.code || response.status) : String(response.status);
    throw new Error('GPT Sol answered: ' + detail);
  }
  const choice = isRecord(data) && Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const content = message ? String(message.content || '') : '';
  if (!content) throw new Error('GPT Sol returned an empty production plan.');
  const parsed = parseJson(content);
  if (!parsed) throw new Error('GPT Sol returned malformed JSON.');
  return parsed;
}

export async function planProduction(state: RunState, signal: AbortSignal): Promise<ProductionPlan> {
  const input = state.input;
  const brief = state.brief;
  const aspect = input.orientation === 'portrait' ? '9:16' : '16:9';
  const system = [
    'You are GPT Sol, the creative director for MotionLaunch, an agentic motion-design studio.',
    'Translate the supplied topic, script and factual website context into one coherent production plan. Decide scene count from the material; use 1–8 scenes as a safety limit, never add filler to reach a count. Each scene must be 4–12 seconds because that is the connected Seedance adapter limit.',
    'Choose techniques by meaning: kinetic typography, editorial collage, abstract material studies, sculptural 3D, explanatory diagrams, charts, timelines, layered parallax, geometric transformation, controlled cinematic camera movement, or restrained product imagery. Do not default to dashboards, floating SaaS cards, particles or 3D type. Give every scene a distinct visual purpose and connect the opening, development and resolution when the content calls for it.',
    'Seedance receives each scene independently. Every seedancePrompt must be 120–950 characters and independently state subject/metaphor, composition, camera, motion behavior, materials, lighting/depth, pace/atmosphere and end resolution. Repeat concise shared art-direction details where continuity matters.',
    'Seedance must not render exact text, captions, logos, website layouts or small UI copy. Put exact text in textOverlays and deterministic diagrams/charts/shapes in graphics. Never ask Seedance to recreate, redraw, morph, imitate or feature a logo.',
    'Website fields are factual context only. Never use ogImageUrl or any scraped site image as a visual reference. useUserReference may be true only if an explicit user reference URL is listed below; otherwise it must be false. Even when one exists, use it only where its stated purpose supports the scene, not as an automatic template.',
    'The optional voiceover is preserved as supplied. Segment the provided script into narrationSegment fields and time visual emphasis accordingly. Do not invent or request a new voiceover.',
    'Use only generation settings supported here: aspectRatio ' + aspect + ', integer duration 4–12, generateAudio false. Do not invent model parameters.',
    'Return JSON only with: creativeDirection string; palette string[]; aspectRatio "' + aspect + '"; plannedDuration number; audioInstructions string; scenes array. Each scene must contain id (stable lowercase slug), title, purpose, narrationSegment, visualConcept, motionStyle, seedancePrompt, durationSeconds, transitionIntent, textOverlays [{text,startSec,endSec,treatment:headline|caption|label|stat}], graphics [{type:diagram|chart|timeline|shapes|frame,instruction,startSec,endSec}], useUserReference boolean, generationSettings {aspectRatio,duration,generateAudio:false}. plannedDuration must exactly equal the duration sum.',
  ].join(' ');

  const context = [
    'USER SCRIPT OR TOPIC:\n' + (input.script || '(not supplied; use verified website facts only)'),
    'OPTIONAL MOTION-STYLE GUIDANCE:\n' + (input.styleGuidance || '(director decides)'),
    'TARGET DURATION PREFERENCE:\n' + (input.targetDuration ? input.targetDuration + ' seconds (preference, not a fixed scene template)' : '(director decides)'),
    'USER BRAND COLOR PREFERENCE:\n' + (input.brandColor || '(none)'),
    'EXPLICIT USER REFERENCE:\n' + (input.referenceImageUrl ? input.referenceImageName + ' at ' + input.referenceImageUrl : '(none)'),
    'SUPPLIED VOICEOVER:\n' + (input.voiceoverUrl ? input.voiceoverName + ' at ' + input.voiceoverUrl : '(none)'),
    'WEBSITE FACTS (context only; never visual references):\n' + JSON.stringify({
      productName: brief?.productName || '',
      tagline: brief?.tagline || '',
      features: brief?.features || [],
      accentColor: brief?.accentColor || '',
      sourceUrl: brief?.sourceUrl || '',
    }),
  ].join('\n\n');

  const first = await requestDirector([{ role: 'system', content: system }, { role: 'user', content: context }], signal);
  let checked = validatePlan(first, input);
  if (checked.plan) return checked.plan;

  const correction = [
    'Your JSON plan failed runtime validation. Correct it without replacing the content with a canned template.',
    'Validation errors:\n- ' + checked.issues.join('\n- '),
    'Original plan:\n' + JSON.stringify(first),
    'Return the complete corrected JSON object only.',
  ].join('\n\n');
  const second = await requestDirector([{ role: 'system', content: system }, { role: 'user', content: context }, { role: 'user', content: correction }], signal);
  checked = validatePlan(second, input);
  if (!checked.plan) throw new Error('GPT Sol could not produce a valid plan after one correction: ' + checked.issues.slice(0, 5).join(' · '));
  return checked.plan;
}

function runtime(): SceneRuntime {
  return { status: 'pending', operationId: '', clipUrl: '', progress: 0, error: '', attempts: 0 };
}

export function syncSceneRuns(state: RunState): void {
  if (!state.plan) return;
  const active = new Set(state.plan.scenes.map((scene) => scene.id));
  Object.keys(state.sceneRuns).forEach((id) => { if (!active.has(id)) delete state.sceneRuns[id]; });
  state.plan.scenes.forEach((scene) => { if (!state.sceneRuns[scene.id]) state.sceneRuns[scene.id] = runtime(); });
}

export function sceneViews(state: RunState): SceneView[] {
  if (!state.plan) return [];
  return state.plan.scenes.map((scene, index) => ({ ...scene, order: index + 1, ...(state.sceneRuns[scene.id] || runtime()) }));
}

export function invalidateScene(state: RunState, sceneId: string): void {
  state.sceneRuns[sceneId] = runtime();
  state.finalUrl = '';
  state.actualDuration = 0;
  state.filmId = null;
  state.galleryRegistered = false;
}

export function invalidateComposition(state: RunState): void {
  state.finalUrl = '';
  state.actualDuration = 0;
  state.filmId = null;
  state.galleryRegistered = false;
}

export async function preparePlan(state: RunState, cb: RunCallbacks): Promise<RunState> {
  const emit = (phase: PipelinePhase, detail: string) => cb.onProgress({ phase, detail, failed: false, scenes: sceneViews(state), completed: 0, total: 0 });
  if (state.input.url && !state.brief) {
    emit('brief', 'Reading factual context from ' + hostOf(state.input.url) + '…');
    state.brief = await fetchProductBrief(state.input.url, cb.signal);
    if (state.brief.note) { state.notes.push(state.brief.note); cb.onNotice(state.brief.note); }
  }
  emit('planning', 'GPT Sol is directing the visual treatment and scene structure…');
  state.plan = await planProduction(state, cb.signal);
  syncSceneRuns(state);
  emit('review', state.plan.scenes.length + ' scenes · ' + plannedSeconds(state.plan) + ' seconds planned');
  return state;
}

interface ClipSubmitAnswer { operationId: string; model: string; seedSource: string }
interface ClipStatusAnswer { status: 'processing' | 'completed' | 'failed'; progress: number; clipUrl: string; error: string }

async function renderSceneClip(
  state: RunState,
  scene: ScenePlan,
  signal: AbortSignal,
  onTick: (progress: number, seconds: number) => void,
): Promise<string> {
  const run = state.sceneRuns[scene.id];
  if (!run.operationId) {
    const submitted = await callHook<ClipSubmitAnswer>('motionlaunch-create-motion-clip', {
      op: 'submit',
      motionPrompt: scene.seedancePrompt,
      duration: scene.durationSeconds,
      format: state.input.orientation,
      imageUrl: scene.useUserReference ? state.input.referenceImageUrl : '',
    }, signal);
    run.operationId = submitted.operationId;
    run.status = 'processing';
    run.attempts += 1;
  }

  const startedAt = Date.now();
  let status: ClipStatusAnswer;
  try {
    status = await poll(
      () => callHook<ClipStatusAnswer>('motionlaunch-create-motion-clip', {
        op: 'status', operationId: run.operationId,
      }, signal),
      {
        interval: 4_000,
        timeout: 12 * 60 * 1_000,
        backoff: 1.2,
        maxInterval: 12_000,
        signal,
        until: (value) => value.status === 'completed' || value.status === 'failed',
        onTick: (value) => {
          if (value.status !== 'processing') return;
          run.progress = Math.max(0, Math.min(99, Number(value.progress) || 0));
          onTick(run.progress, Math.round((Date.now() - startedAt) / 1000));
        },
      },
    );
  } catch (error) {
    if (signal.aborted) throw new AbortedError();
    throw error;
  }
  if (status.status === 'completed' && status.clipUrl) return status.clipUrl;
  throw new ProviderGenerationError(status.error || 'Seedance failed this scene.');
}

const REMOTION_COMPOSITION = `
import React from 'react';
import {AbsoluteFill, Audio, Sequence, Video, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
const safe=(v,f)=>Number.isFinite(Number(v))?Number(v):f;
function Overlay({item,fps,accent}){const frame=useCurrentFrame();const start=Math.round(item.startSec*fps);const end=Math.round(item.endSec*fps);const local=frame-start;if(frame<start||frame>end)return null;const a=interpolate(local,[0,8,Math.max(9,end-start-8),Math.max(10,end-start)],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});const y=(1-spring({frame:Math.max(0,local),fps,config:{damping:22,stiffness:180,mass:.6}}))*34;const sizes={headline:76,caption:36,label:26,stat:92};return <div style={{position:'absolute',left:'8%',right:'8%',bottom:item.treatment==='caption'?'8%':'13%',opacity:a,transform:'translateY('+y+'px)',color:'#fff',fontFamily:'Inter,Arial,sans-serif',fontSize:sizes[item.treatment]||64,fontWeight:item.treatment==='label'?600:800,lineHeight:1.02,letterSpacing:'-0.035em',textShadow:'0 3px 24px rgba(0,0,0,.7)'}}><span style={{background:'linear-gradient(90deg,rgba(5,5,10,.78),rgba(5,5,10,.24))',padding:'8px 14px',borderLeft:'5px solid '+accent}}>{item.text}</span></div>}
function Graphic({item,fps,accent,index}){const frame=useCurrentFrame();const start=Math.round(item.startSec*fps);const end=Math.round(item.endSec*fps);if(frame<start||frame>end)return null;const p=spring({frame:Math.max(0,frame-start),fps,config:{damping:20,stiffness:150,mass:.7}});const bars=[.42,.7,.55,.88,.63];return <div style={{position:'absolute',right:'7%',top:'10%',width:360,height:210,opacity:p,transform:'translateY('+((1-p)*28)+'px)',border:'1px solid rgba(255,255,255,.22)',borderRadius:24,background:'rgba(7,7,14,.66)',backdropFilter:'blur(14px)',padding:24,color:'#fff',fontFamily:'Inter,Arial'}}><div style={{fontSize:14,opacity:.7,textTransform:'uppercase',letterSpacing:2}}>{item.type}</div><div style={{height:120,display:'flex',alignItems:'flex-end',gap:12,marginTop:12}}>{bars.map((b,i)=><div key={i} style={{flex:1,height:(b*p*100)+'%',minHeight:4,borderRadius:8,background:i===index%bars.length?accent:'rgba(255,255,255,.24)'}}/>)}</div></div>}
function Scene({scene,index,total,palette,fps,portrait}){const frame=useCurrentFrame();const duration=Math.round(scene.durationSeconds*fps);const edge=10;const alpha=interpolate(frame,[0,edge,Math.max(edge+1,duration-edge),duration],[index===0?1:0,1,1,index===total-1?1:0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});const accent=palette[index%palette.length]||'#f59e0b';const frameStyle=portrait?{background:'#050508',opacity:alpha,overflow:'hidden',left:'50%',right:'auto',width:608,transform:'translateX(-50%)'}:{background:'#050508',opacity:alpha,overflow:'hidden'};return <AbsoluteFill style={frameStyle}><Video src={scene.clipUrl} muted style={{width:'100%',height:'100%',objectFit:'cover'}}/><AbsoluteFill style={{background:'linear-gradient(180deg,rgba(2,2,8,.02),rgba(2,2,8,.38))'}}/>{(scene.graphics||[]).map((g,i)=><Graphic key={i} item={g} fps={fps} accent={accent} index={index+i}/>)}{(scene.textOverlays||[]).map((t,i)=><Overlay key={i} item={t} fps={fps} accent={accent}/>)}</AbsoluteFill>}
export default function Composition(props){const {fps}=useVideoConfig();let cursor=0;const palette=props.palette&&props.palette.length?props.palette:['#f59e0b','#06b6d4'];const portrait=props.aspectRatio==='9:16';return <AbsoluteFill style={{background:'#050508'}}>{props.scenes.map((scene,index)=>{const start=cursor;const frames=Math.round(scene.durationSeconds*fps);cursor+=frames;return <Sequence key={scene.id} from={start} durationInFrames={frames}><Scene scene={scene} index={index} total={props.scenes.length} palette={palette} fps={fps} portrait={portrait}/></Sequence>})}{props.voiceoverUrl?<Audio src={props.voiceoverUrl}/>:null}</AbsoluteFill>}
export const calculateDemoVideoDuration=(props)=>Math.max(1,Math.round((props.scenes||[]).reduce((n,s)=>n+safe(s.durationSeconds,0),0)*30));
`;

async function pollRemotion(operationId: string, signal: AbortSignal): Promise<string> {
  try {
    const status = await poll(() => readRender(operationId), {
      interval: 3_000,
      timeout: 60 * 60 * 1_000,
      signal,
      until: (value) => value.state === 'complete' || value.state === 'failed',
    });
    if (status.state === 'complete' && status.videoUrl) return status.videoUrl;
    throw new Error(status.error || 'The deterministic composition failed.');
  } catch (error) {
    if (signal.aborted) throw new AbortedError();
    throw error;
  }
}

async function composeFilm(state: RunState, signal: AbortSignal): Promise<{ url: string; geometry: string }> {
  if (!state.plan) throw new Error('No production plan is available.');
  const scenes = state.plan.scenes.map((scene) => ({ ...scene, clipUrl: state.sceneRuns[scene.id]?.clipUrl || '' }));
  if (scenes.some((scene) => !scene.clipUrl)) throw new Error('Every selected scene needs a completed clip before export.');
  const durationInFrames = Math.max(1, Math.round(plannedSeconds(state.plan) * 30));
  const aspect = state.input.orientation === 'portrait' ? '9:16' : '16:9';
  const submitted = await submitRender({
    compositionTsx: REMOTION_COMPOSITION,
    props: { scenes, palette: state.plan.palette, aspectRatio: state.plan.aspectRatio, voiceoverUrl: state.input.voiceoverUrl },
    durationInFrames,
    aspect,
  }, workspaceToken());
  const rendered = await pollRemotion(submitted.operationId, signal);
  if (state.input.orientation !== 'portrait') return { url: rendered, geometry: '1920×1080 (16:9)' };

  const portraitUrl = await finishPortrait(
    rendered,
    { durationSeconds: durationInFrames / 30 },
    workspaceToken(),
  );
  return { url: portraitUrl, geometry: '1080×1920 (9:16)' };
}

async function probeVideo(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timer = setTimeout(() => finish(new Error('The exported video could not be verified within 30 seconds.')), 30000);
    const abort = () => finish(new AbortedError());
    const finish = (error?: Error) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      if (error) reject(error); else resolve(duration);
    };
    signal.addEventListener('abort', abort, { once: true });
    video.preload = 'metadata';
    video.onloadedmetadata = () => video.duration > 0 && video.videoWidth > 0 && video.videoHeight > 0
      ? finish()
      : finish(new Error('The export exists but has invalid playback metadata.'));
    video.onerror = () => finish(new Error('The exported file is not playable.'));
    video.src = url;
  });
}

interface SavedFilmAnswer { success?: boolean; film?: { id?: number } }

async function registerCompletedFilm(state: RunState, signal: AbortSignal): Promise<void> {
  if (!state.plan) return;
  if (!state.filmId) {
    const saved = await callHook<SavedFilmAnswer>('motionlaunch-save-film', {
      product_name: state.brief?.productName || hostOf(state.input.url) || clean(state.input.script, 60) || 'MotionLaunch film',
      source_url: normalizeUrl(state.brief?.sourceUrl || state.input.url || 'https://motionlaunch.local/topic'),
      format: state.input.orientation,
      final_video_url: state.finalUrl,
      scene_plan: state.plan.scenes.map((scene) => ({ ...scene, clipUrl: state.sceneRuns[scene.id]?.clipUrl || '' })),
    }, signal);
    const filmId = Number(saved.film?.id);
    if (!saved.success || !Number.isFinite(filmId) || filmId <= 0) throw new Error('MotionLaunch history did not return a film id.');
    state.filmId = filmId;
  }
  if (state.galleryRegistered) return;
  await callHook<{ success?: boolean }>('saved-videos', {
    op: 'upsert', source: 'motionlaunch', source_id: state.filmId,
    title: state.brief?.productName || clean(state.input.script, 60) || 'MotionLaunch film',
    style: 'motionlaunch', style_label: 'Motion Design Film', video_url: state.finalUrl,
    thumbnail_url: null, srt_text: null,
    duration_seconds: state.actualDuration || plannedSeconds(state.plan),
  }, signal);
  state.galleryRegistered = true;
}

export async function runPipeline(state: RunState, cb: RunCallbacks): Promise<RunState> {
  if (!state.plan) throw new Error('Generate and review a production plan first.');
  syncSceneRuns(state);
  const total = state.plan.scenes.length;
  const emit = (phase: PipelinePhase, detail: string, failed = false) => {
    const views = sceneViews(state);
    cb.onProgress({ phase, detail, failed, scenes: views, completed: views.filter((scene) => scene.status === 'completed').length, total });
  };
  const notice = (message: string) => { if (message) { state.notes.push(message); cb.onNotice(message); } };

  if (!state.charged && !Object.values(state.sceneRuns).some((run) => run.clipUrl)) {
    const charge = await chargeCredits({
      seconds: plannedSeconds(state.plan), entryKey: state.chargeKey, source: 'motionlaunch',
      note: 'MotionLaunch · ' + total + ' planned scenes',
    });
    state.charged = charge.metered;
  }

  let acceptedClip = Object.values(state.sceneRuns).some((run) => Boolean(run.clipUrl || run.operationId));
  try {
    for (const scene of state.plan.scenes) {
      const run = state.sceneRuns[scene.id];
      if (run.clipUrl) continue;
      throwIfAborted(cb.signal);
      run.status = run.operationId ? 'processing' : 'generating';
      run.error = '';
      emit('generating', 'Scene ' + scene.order + ' of ' + total + ': ' + scene.title);
      try {
        const clipUrl = await renderSceneClip(state, scene, cb.signal, (progress, seconds) => {
          run.status = 'processing'; run.progress = progress;
          emit('generating', 'Scene ' + scene.order + ' · ' + progress + '% · ' + seconds + 's elapsed');
        });
        run.clipUrl = clipUrl;
        run.progress = 100;
        run.status = 'completed';
        run.error = '';
        acceptedClip = true;
        emit('generating', 'Scene ' + scene.order + ' completed.');
      } catch (error) {
        run.status = 'failed';
        run.error = errorMessage(error);
        if (error instanceof ProviderGenerationError) run.operationId = '';
        emit('generating', 'Scene ' + scene.order + ' failed: ' + run.error, true);
        throw error;
      }
    }
  } catch (error) {
    acceptedClip = acceptedClip || Object.values(state.sceneRuns).some((run) => Boolean(run.clipUrl || run.operationId));
    if (state.charged && !acceptedClip && !(error instanceof AbortedError)) {
      await refundCredits(state.chargeKey, 'MotionLaunch produced no accepted clips').catch(() => undefined);
      state.charged = false;
    }
    throw error;
  }

  if (!state.finalUrl) {
    emit('composing', 'Rendering exact typography, deterministic graphics, transitions and audio…');
    const composed = await composeFilm(state, cb.signal);
    state.finalUrl = composed.url;
    state.geometry = composed.geometry;
  }

  emit('validating', 'Verifying export playback, dimensions and duration…');
  state.actualDuration = await probeVideo(state.finalUrl, cb.signal);
  if (Math.abs(state.actualDuration - plannedSeconds(state.plan)) > 1.5) {
    notice('The playable export duration is ' + state.actualDuration.toFixed(1) + 's versus ' + plannedSeconds(state.plan) + 's planned.');
  }

  try { await registerCompletedFilm(state, cb.signal); }
  catch (error) {
    if (error instanceof AbortedError) throw error;
    notice('The final MP4 is ready, but Saved Videos registration failed (' + errorMessage(error) + '). Download it before closing this tab.');
  }
  emit('ready', 'Final playable MP4 ready.');
  return state;
}

export async function downloadFilm(url: string, filename: string): Promise<void> {
  const click = (href: string, newTab: boolean) => {
    const anchor = document.createElement('a');
    anchor.href = href; anchor.download = filename;
    if (newTab) { anchor.target = '_blank'; anchor.rel = 'noopener'; }
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  };
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const href = URL.createObjectURL(await response.blob());
    click(href, false); setTimeout(() => URL.revokeObjectURL(href), 20000);
  } catch { click(url, true); }
}

export function filmFilename(state: RunState): string {
  const name = state.brief?.productName || clean(state.input.script, 50) || hostOf(state.input.url) || 'motionlaunch';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'motionlaunch';
  return slug + '-' + (state.input.orientation === 'portrait' ? '9x16' : '16x9') + '.mp4';
}
