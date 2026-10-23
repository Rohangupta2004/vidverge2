import { authorizeCredits, newChargeKey, quoteCredits, refundCreditsStrict } from '../../../lib/credits';
import { callHook, WORKSPACE_ID, workspaceTokenNow } from '../../../lib/workspace';

export type PipelineStep = 'brief' | 'script' | 'voiceover' | 'timing' | 'storyboard' | 'images' | 'clips' | 'finishing' | 'review' | 'export';
export type VisualType = 'animated scene' | 'motion graphic' | 'B-roll';
export type ItemStatus = 'waiting' | 'working' | 'ready' | 'error';

export interface WordTiming { word: string; start: number; end: number; confidence?: number }
export interface StoryboardScene {
  id: string;
  index: number;
  start: number;
  end: number;
  duration: number;
  narration: string;
  visualType: VisualType;
  imagePrompt: string;
  motionPrompt: string;
  overlayText?: string;
  imageUrl?: string;
  clipUrl?: string;
  operationId?: string;
  imageStatus: ItemStatus;
  clipStatus: ItemStatus;
  progress: number;
  attempts: number;
  creditKey: string;
  error?: string;
}
export interface FacelessSettings {
  mode: string;
  aspect: '16:9' | '9:16';
  targetDuration: number;
  voiceId: string;
  captions: boolean;
  music: boolean;
  musicVolume: number;
}
export interface FacelessProject {
  pipelineVersion: 2;
  id: string;
  title: string;
  brief: string;
  script: string;
  settings: FacelessSettings;
  step: PipelineStep;
  status: 'running' | 'error' | 'ready';
  notice: string;
  error?: string;
  voiceover?: { audioUrl: string; duration: number; words: WordTiming[] };
  storyboard?: { styleDescriptor: string; characterDescriptor: string; createdAt: string };
  scenes: StoryboardScene[];
  music?: { url?: string; status: ItemStatus; error?: string };
  sfx?: { url?: string; status: ItemStatus; error?: string };
  review: { captions: boolean; music: boolean; musicVolume: number };
  previewUrl?: string;
  finalUrl?: string;
  finishing?: {
    operationId: string;
    status: 'rendering' | 'completed' | 'failed';
    startedAt: string;
    durationInFrames: number;
    error?: string;
  };
  createdAt: string;
  updatedAt: string;
}

type Checkpoint = (project: FacelessProject) => Promise<void> | void;
const SEEDANCE_MODEL = 'openrouter/bytedance/seedance-2.0-fast';
const FPS = 30;

function token(): string {
  const value = workspaceTokenNow();
  if (!value) throw new Error('Your signed-in workspace session is not ready. Reload, then try again.');
  return value;
}
function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token() };
}
async function json(response: Response): Promise<any> {
  return response.json().catch(() => null);
}
function errorMessage(data: any, fallback: string): string {
  return String(data?.error?.message || data?.errorMessage || data?.error || data?.message || data?.code || fallback);
}
function isUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function clipText(value: string, max: number): string {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
function parseJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] || raw).trim();
  try { return JSON.parse(text) as T; } catch { /* recover below */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as T;
  throw new Error('The creative model returned an unreadable plan. Try again.');
}

async function gpt(system: string, user: string, maxTokens = 6000): Promise<string> {
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      model: 'gpt-6.1-sol',
      reasoning_effort: 'medium',
      max_completion_tokens: maxTokens,
      stream: false,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const data = await json(response);
  if (!response.ok) throw new Error(errorMessage(data, `Script service failed (HTTP ${response.status}).`));
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('The script service returned an empty result.');
  return text;
}

async function generateScript(project: FacelessProject): Promise<string> {
  const words = Math.max(80, Math.round(project.settings.targetDuration * 2.25));
  const result = await gpt(
    'You are a concise faceless-video scriptwriter. Write narration only: no shot labels, markdown, speaker names, or production notes. Make the opening instantly compelling, use concrete language, and end cleanly.',
    `Create a roughly ${project.settings.targetDuration}-second (${words}-word) ${project.settings.mode} narration.\n\nTITLE/TOPIC:\n${project.title}\n\nCREATIVE BRIEF AND SOURCE NOTES:\n${project.brief}`,
  );
  return result.replace(/^```[a-z]*\s*|```$/gi, '').trim();
}

async function guardPaidRun(seconds: number): Promise<void> {
  const quote = await quoteCredits(seconds);
  if (!quote) throw new Error('Credit authorization is unavailable. Refresh your signed-in session before starting paid generation.');
  if (!quote.affordable) {
    throw new Error(`This film needs ${quote.cost} credits and you have ${quote.balance}. Add ${quote.shortfall} credits before generation.`);
  }
}

async function generateVoiceover(script: string, voiceId: string): Promise<{ audioUrl: string; estimated: number }> {
  const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ script, voiceId, modelId: 'eleven_v3', voiceSettings: { stability: 0.5 } }),
  });
  const data = await json(response);
  if (!response.ok || !isUrl(data?.audioUrl)) throw new Error(errorMessage(data, 'ElevenLabs returned no voiceover.'));
  return { audioUrl: String(data.audioUrl), estimated: Math.max(1, Number(data.estimatedDurationMs || 0) / 1000) };
}

async function transcribeVoiceover(audioUrl: string): Promise<{ words: WordTiming[]; duration: number }> {
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) throw new Error('The generated voiceover could not be read back for timing.');
  const form = new FormData();
  form.append('audio', await audioResponse.blob(), 'faceless-voiceover.mp3');
  form.append('language', 'en');
  const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/transcribe-timestamped`, {
    method: 'POST', headers: { 'X-Workspace-DB-Token': token() }, body: form,
  });
  const data = await json(response);
  if (!response.ok) throw new Error(errorMessage(data, 'Deepgram timing failed.'));
  const words: WordTiming[] = (Array.isArray(data?.words) ? data.words : [])
    .map((entry: any) => ({ word: String(entry?.word || '').trim(), start: Number(entry?.start), end: Number(entry?.end), confidence: Number(entry?.confidence) }))
    .filter((entry: WordTiming) => entry.word && Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end >= entry.start);
  if (!words.length) throw new Error('Deepgram returned no word-level timestamps, so a timed storyboard cannot be built.');
  return { words, duration: Math.max(Number(data?.duration || 0), words[words.length - 1].end) };
}

function wordsInRange(words: WordTiming[], startIndex: number, endIndex: number): string {
  return words.slice(startIndex, endIndex + 1).map((word) => word.word).join(' ').trim();
}
function normalizeType(value: unknown): VisualType {
  const text = String(value || '').toLowerCase();
  if (text.includes('motion')) return 'motion graphic';
  if (text.includes('b-roll') || text.includes('broll')) return 'B-roll';
  return 'animated scene';
}

async function buildStoryboard(project: FacelessProject): Promise<{ styleDescriptor: string; characterDescriptor: string; scenes: StoryboardScene[] }> {
  const words = project.voiceover!.words;
  const duration = project.voiceover!.duration;
  const targetScenes = Math.max(2, Math.min(14, Math.ceil(duration / 6)));
  const timing = words.map((word, index) => `${index}:${word.word}@${word.start.toFixed(2)}-${word.end.toFixed(2)}`).join(' ');
  type Plan = { styleDescriptor?: string; characterDescriptor?: string; scenes?: Array<{ startWord: number; endWord: number; visualType: string; imagePrompt: string; motionPrompt: string; overlayText?: string }> };
  let plan: Plan | null = null;
  try {
    plan = parseJson<Plan>(await gpt(
      'You are a faceless-video storyboard director. Return strict JSON only. Scene boundaries are WORD INDEXES from the supplied timed transcript. Cover every word exactly once, in order, with no gaps or overlap. Prefer 4–8 second scenes. Choose animated scene for cinematic subjects, motion graphic for ideas/numbers/text, and B-roll for real-world support. Image prompts must describe a single strong first frame with no rendered text. Motion prompts describe camera/subject movement. Keep recurring people and art direction consistent through one shared descriptor.',
      `Build about ${targetScenes} timed scenes for this narration.\nAspect: ${project.settings.aspect}. Mode: ${project.settings.mode}.\nScript: ${project.script}\n\nTimed words:\n${clipText(timing, 42000)}\n\nJSON shape: {"styleDescriptor":"...","characterDescriptor":"... or none","scenes":[{"startWord":0,"endWord":12,"visualType":"animated scene|motion graphic|B-roll","imagePrompt":"...","motionPrompt":"...","overlayText":"optional, max 7 words"}]}`,
      6000,
    ));
  } catch (error) {
    console.warn('[Faceless] storyboard model fallback:', error);
  }
  const styleDescriptor = String(plan?.styleDescriptor || `cinematic ${project.settings.mode}, cohesive amber highlights, charcoal shadows, premium editorial photography, consistent lens and grade`);
  const characterDescriptor = String(plan?.characterDescriptor || 'No recurring character; preserve one coherent visual world and color grade.');
  const raw = Array.isArray(plan?.scenes) ? plan!.scenes! : [];
  const scenes: StoryboardScene[] = [];
  let cursor = 0;
  for (let index = 0; index < targetScenes && cursor < words.length; index += 1) {
    const remainingScenes = targetScenes - index;
    const fallbackEnd = Math.max(cursor, Math.ceil((words.length - cursor) / remainingScenes) + cursor - 1);
    const source = raw[index];
    const startWord = cursor;
    const proposed = Number(source?.endWord);
    const endWord = index === targetScenes - 1
      ? words.length - 1
      : Math.max(startWord, Math.min(words.length - remainingScenes, Number.isFinite(proposed) ? Math.round(proposed) : fallbackEnd));
    const start = index === 0 ? 0 : words[startWord].start;
    const end = index === targetScenes - 1 ? duration : words[endWord].end;
    const narration = wordsInRange(words, startWord, endWord);
    const visualType = normalizeType(source?.visualType || (index % 4 === 1 ? 'motion graphic' : index % 3 === 2 ? 'B-roll' : 'animated scene'));
    scenes.push({
      id: `scene-${index + 1}`,
      index,
      start: Math.max(0, start),
      end: Math.max(start + 0.25, end),
      duration: Math.max(0.25, end - start),
      narration,
      visualType,
      imagePrompt: String(source?.imagePrompt || `A compelling ${visualType} first frame illustrating: ${narration}.`),
      motionPrompt: String(source?.motionPrompt || 'Subtle cinematic camera movement, natural subject motion, stable composition, no morphing.'),
      overlayText: source?.overlayText ? clipText(String(source.overlayText), 70) : undefined,
      imageStatus: 'waiting', clipStatus: 'waiting', progress: 0, attempts: 0,
      creditKey: newChargeKey(`faceless:${project.id}:scene:${index + 1}`),
    });
    cursor = endWord + 1;
  }
  return { styleDescriptor, characterDescriptor, scenes };
}

async function generateImage(project: FacelessProject, scene: StoryboardScene): Promise<string> {
  const prompt = [
    project.storyboard?.styleDescriptor,
    project.storyboard?.characterDescriptor,
    scene.imagePrompt,
    `Composition: ${project.settings.aspect}. Scene purpose: ${scene.visualType}.`,
    'No lettering, subtitles, watermarks, logos, split screens, or collage. Keep recurring subjects exactly consistent.',
  ].filter(Boolean).join('\n');
  const response = await fetch('/api/generate/image', {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ prompt, aspectRatio: project.settings.aspect, quality: 'standard', returnBase64: false }),
  });
  const data = await json(response);
  if (!response.ok || !isUrl(data?.imageUrl)) throw new Error(errorMessage(data, 'The image provider returned no scene image.'));
  return String(data.imageUrl);
}

async function generateMusic(project: FacelessProject): Promise<string> {
  const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/music/preset`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ preset: project.settings.mode === 'news' ? 'energetic' : project.settings.mode === 'story' ? 'cinematic' : 'tech', lengthMs: Math.max(3000, Math.round((project.voiceover?.duration || project.settings.targetDuration) * 1000)) }),
  });
  const data = await json(response);
  if (!response.ok || !isUrl(data?.audioUrl)) throw new Error(errorMessage(data, 'Music generation returned no audio.'));
  return String(data.audioUrl);
}
async function generateSfx(project: FacelessProject): Promise<string> {
  const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/music/custom`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ prompt: 'A clean cinematic transition sound design hit: airy whoosh, soft impact, no melody, no voice, no silence.', lengthMs: 3000, instrumental: true }),
  });
  const data = await json(response);
  if (!response.ok || !isUrl(data?.audioUrl)) throw new Error(errorMessage(data, 'SFX generation returned no audio.'));
  return String(data.audioUrl);
}

async function mapBounded<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function pollSeedance(operationId: string, scene: StoryboardScene, onProgress: (progress: number) => Promise<void>): Promise<string> {
  const deadline = Date.now() + 12 * 60 * 1000;
  let misses = 0;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`, { headers: { 'X-Workspace-DB-Token': token() } });
    const data = await json(response);
    if (!response.ok) {
      misses += 1;
      if (misses >= 6) throw new Error(errorMessage(data, 'Seedance status stopped answering.'));
      await sleep(5000);
      continue;
    }
    misses = 0;
    const status = String(data?.status || '').toLowerCase();
    if (status === 'completed' && isUrl(data?.videoUrl)) return String(data.videoUrl);
    if (status === 'failed' || status === 'error') throw new Error(errorMessage(data, 'Seedance failed this scene.'));
    const progress = Math.max(scene.progress, Math.min(98, Number(data?.progress || 0)));
    await onProgress(progress);
    await sleep(5000);
  }
  throw new Error('Seedance did not finish within 12 minutes. Retry this scene; the saved project will not lose its other clips.');
}

async function generateClip(project: FacelessProject, scene: StoryboardScene, onProgress: (progress: number) => Promise<void>): Promise<string> {
  if (!scene.imageUrl) throw new Error('Generate this scene image before animating it.');
  await authorizeCredits({ seconds: scene.duration, entryKey: scene.creditKey, source: 'faceless', note: `Seedance scene ${scene.index + 1}` });
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    scene.attempts = attempt;
    try {
      const response = await fetch('/api/veo/generate/video', {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({
          model: SEEDANCE_MODEL,
          prompt: `${scene.motionPrompt}\nPreserve the supplied first frame's exact subject, wardrobe, setting, palette and composition. ${project.storyboard?.styleDescriptor || ''} No text, captions, watermark, morphing or identity drift.`,
          imageData: scene.imageUrl,
          aspectRatio: project.settings.aspect,
          duration: Math.max(4, Math.min(8, Math.round(scene.duration))),
          resolution: '720p',
          generateAudio: false,
        }),
      });
      const data = await json(response);
      const operationId = String(data?.operationId || data?.operation_id || '');
      if (!response.ok || !operationId || data?.success === false) throw new Error(errorMessage(data, `Seedance submit failed (HTTP ${response.status}).`));
      scene.operationId = operationId;
      await onProgress(5);
      return await pollSeedance(operationId, scene, onProgress);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1500);
    }
  }
  await refundCreditsStrict(scene.creditKey, `Seedance scene ${scene.index + 1} failed after one retry`).catch(() => undefined);
  throw lastError instanceof Error ? lastError : new Error('Seedance failed this scene after one retry.');
}

const COMPOSITION_TSX = `
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
function Caption({words}){const f=useCurrentFrame();const t=f/30;const active=words.findIndex(w=>t>=w.start&&t<w.end);if(active<0)return null;const from=Math.max(0,active-2);const line=words.slice(from,from+6);return <div style={{position:'absolute',left:'8%',right:'8%',bottom:92,textAlign:'center'}}><span style={{display:'inline-block',background:'rgba(8,10,16,.78)',color:'#fff',padding:'14px 22px',borderRadius:16,fontFamily:'Manrope,Arial',fontSize:42,fontWeight:700,lineHeight:1.2}}>{line.map((w,i)=><span key={i} style={{color:from+i===active?'#F2B544':'#fff'}}>{w.word}{' '}</span>)}</span></div>}
function Scene({scene}){const f=useCurrentFrame();const dur=Math.max(1,Math.round(scene.duration*30));const fade=Math.min(1,f/5,(dur-f)/5);return <AbsoluteFill style={{background:'#0D0E10',opacity:Math.max(.05,fade),overflow:'hidden'}}><OffthreadVideo src={scene.clipUrl} muted startFrom={Math.round(n(scene.trimStart)*30)} style={{width:'100%',height:'100%',objectFit:'cover'}}/>{scene.overlayText?<AbsoluteFill style={{justifyContent:'flex-end',padding:90,background:'linear-gradient(transparent 45%,rgba(0,0,0,.68))'}}><div style={{fontFamily:'Space Grotesk,Arial',fontWeight:700,fontSize:68,color:'#F6F2E9',maxWidth:'80%',lineHeight:1.05}}>{scene.overlayText}</div></AbsoluteFill>:null}</AbsoluteFill>}
export default function FacelessFinish(props){const {width,height}=useVideoConfig();const scenes=Array.isArray(props.scenes)?props.scenes:[];const portrait=props.aspect==='9:16';const cw=portrait?1080:1920,ch=portrait?1920:1080,scale=Math.min(width/cw,height/ch);return <AbsoluteFill style={{background:'#08090B'}}><AbsoluteFill style={{alignItems:'center',justifyContent:'center'}}><div style={{position:'relative',width:cw,height:ch,transform:'scale('+scale+')',overflow:'hidden',background:'#0D0E10'}}>{scenes.map(s=><Sequence key={s.id} from={Math.round(s.start*30)} durationInFrames={Math.max(1,Math.round(s.duration*30))}><Scene scene={s}/></Sequence>)}{props.captions?<Caption words={props.words||[]}/>:null}</div></AbsoluteFill>{props.voiceover?<Audio src={props.voiceover} volume={1}/>:null}{props.music&&props.musicUrl?<Audio src={props.musicUrl} volume={n(props.musicVolume,.18)*.42}/>:null}{props.sfxUrl?scenes.slice(1).map((s,i)=><Sequence key={'sfx'+i} from={Math.round(s.start*30)}><Audio src={props.sfxUrl} volume={.18}/></Sequence>):null}</AbsoluteFill>}
// The platform resolves this export without composition props. Reading
// props.duration here caused COMPOSITION_INVALID before the explicit
// durationInFrames override could be applied.
export const calculateDemoVideoDuration=()=>30;
`;

export interface FinishingRenderRequest {
  compositionTsx: string;
  props: Record<string, unknown>;
  durationInFrames: number;
}

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildFinishingRenderRequest(project: FacelessProject): FinishingRenderRequest {
  if (!project.scenes.length) throw new Error('Finishing cannot start because this film has no saved scenes.');

  const narrationDuration = positive(project.voiceover?.duration) || 0;
  const words = Array.isArray(project.voiceover?.words) ? project.voiceover!.words : [];
  const lastWordEnd = words.reduce((latest, word) => Math.max(latest, positive(word?.end) || 0), 0);
  const fallbackPerScene = Math.max(1, (Math.max(narrationDuration, lastWordEnd) || project.settings.targetDuration || 5) / project.scenes.length);
  let cursor = 0;

  const scenes = project.scenes.map((scene, index) => {
    if (scene.clipStatus !== 'ready' || !isUrl(scene.clipUrl)) {
      throw new Error(`Scene ${index + 1} has no ready saved clip. Retry that clip before finishing the film.`);
    }
    const savedStart = Number(scene.start);
    const start = Number.isFinite(savedStart) && savedStart >= 0 ? savedStart : cursor;
    const savedEnd = Number(scene.end);
    const duration = positive(scene.duration)
      || (Number.isFinite(savedEnd) ? positive(savedEnd - start) : null)
      || fallbackPerScene;
    const end = start + duration;
    cursor = Math.max(cursor, end);
    return { ...scene, start, end, duration, durationInFrames: Math.max(1, Math.round(duration * FPS)), trimStart: 0 };
  });

  const invalidScene = scenes.findIndex((scene) => !positive(scene.duration) || !Number.isFinite(scene.start) || !Number.isFinite(scene.end));
  if (invalidScene >= 0) {
    throw new Error(`Scene ${invalidScene + 1} has an invalid duration. Each saved clip must have a finite duration greater than zero before finishing.`);
  }

  const duration = Math.max(cursor, narrationDuration, lastWordEnd);
  if (!positive(duration)) {
    throw new Error('The film has no valid total duration. Check the saved clip lengths and narration timing before finishing.');
  }
  const durationInFrames = Math.max(30, Math.round(duration * FPS));
  const shots = scenes.map((scene) => ({
    id: scene.id,
    duration: scene.duration,
    durationInFrames: scene.durationInFrames,
    start: scene.start,
    startFrame: Math.max(0, Math.round(scene.start * FPS)),
  }));

  return {
    compositionTsx: COMPOSITION_TSX,
    props: {
      scenes,
      shots,
      aspect: project.settings.aspect,
      duration,
      durationInFrames,
      voiceover: project.voiceover?.audioUrl,
      words,
      captions: project.review.captions,
      music: project.review.music,
      musicVolume: project.review.musicVolume,
      musicUrl: project.music?.url || '',
      sfxUrl: project.sfx?.url || '',
    },
    durationInFrames,
  };
}

export async function retryFinishingOnly(project: FacelessProject): Promise<void> {
  const request = buildFinishingRenderRequest(project);
  await callHook<any>('faceless-render', { op: 'retry_finishing', filmId: project.id, ...request });
}

async function render(project: FacelessProject): Promise<string> {
  const request = buildFinishingRenderRequest(project);
  const submitted = await callHook<any>('faceless-render', {
    op: 'submit',
    ...request,
  });
  const operationId = String(submitted?.operationId || '');
  if (!operationId) throw new Error(errorMessage(submitted, 'Remotion returned no render job.'));
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const status = await callHook<any>('faceless-render', { op: 'status', operationId });
    const state = String(status?.status || '').toLowerCase();
    if ((state === 'complete' || state === 'completed') && isUrl(status?.videoUrl)) {
      if (project.settings.aspect === '9:16') {
        try {
          const portrait = await callHook<any>('faceless-portrait-export', { videoUrl: status.videoUrl });
          if (isUrl(portrait?.videoUrl)) return String(portrait.videoUrl);
        } catch { /* the review render remains usable */ }
      }
      return String(status.videoUrl);
    }
    if (state === 'failed') throw new Error(errorMessage(status, 'Remotion finishing failed.'));
  }
  throw new Error('Remotion finishing timed out. Your generated scene clips remain saved in this project.');
}

async function checkpoint(project: FacelessProject, onCheckpoint: Checkpoint, step: PipelineStep, notice: string): Promise<void> {
  project.step = step;
  project.notice = notice;
  project.updatedAt = new Date().toISOString();
  await onCheckpoint({ ...project, scenes: project.scenes.map((scene) => ({ ...scene })) });
}

export async function runFacelessPipeline(project: FacelessProject, onCheckpoint: Checkpoint): Promise<FacelessProject> {
  project.status = 'running'; project.error = undefined;
  try {
    if (!project.script.trim()) {
      await checkpoint(project, onCheckpoint, 'script', 'Writing the narration from your brief with GPT Sol…');
      project.script = await generateScript(project);
    }
    const needsPaidGeneration = !project.voiceover?.audioUrl || !project.storyboard || !project.scenes.length
      || project.scenes.some((scene) => scene.imageStatus !== 'ready' || scene.clipStatus !== 'ready');
    if (needsPaidGeneration) await guardPaidRun(project.settings.targetDuration);

    if (!project.voiceover?.audioUrl) {
      await checkpoint(project, onCheckpoint, 'voiceover', 'Recording the approved script with ElevenLabs…');
      const voice = await generateVoiceover(project.script, project.settings.voiceId);
      project.voiceover = { audioUrl: voice.audioUrl, duration: voice.estimated, words: [] };
    }

    if (!project.voiceover?.words?.length) {
      const audioUrl = project.voiceover?.audioUrl;
      if (!audioUrl) throw new Error('The saved project has no ElevenLabs voiceover to time.');
      await checkpoint(project, onCheckpoint, 'timing', 'Deepgram is measuring every spoken word…');
      const timing = await transcribeVoiceover(audioUrl);
      project.voiceover = { audioUrl, duration: timing.duration, words: timing.words };
    }

    if (!project.storyboard || !project.scenes.length) {
      await checkpoint(project, onCheckpoint, 'storyboard', 'Aligning the storyboard to the narration timing…');
      const board = await buildStoryboard(project);
      project.storyboard = { styleDescriptor: board.styleDescriptor, characterDescriptor: board.characterDescriptor, createdAt: new Date().toISOString() };
      project.scenes = board.scenes;
    }

    if (!project.settings.music) {
      project.music = { status: 'ready' };
      project.sfx = { status: 'ready' };
    } else {
      if (!project.music || project.music.status === 'error') project.music = { status: 'working' };
      if (!project.sfx || project.sfx.status === 'error') project.sfx = { status: 'working' };
    }
    await checkpoint(project, onCheckpoint, 'images', 'Generating one consistent first frame for every scene…');
    const audioTasks: Promise<void>[] = [];
    if (project.settings.music && project.music?.status !== 'ready') audioTasks.push(generateMusic(project).then((url) => { project.music = { status: 'ready', url }; }).catch((error) => { project.music = { status: 'error', error: String(error?.message || error) }; }));
    if (project.settings.music && project.sfx?.status !== 'ready') audioTasks.push(generateSfx(project).then((url) => { project.sfx = { status: 'ready', url }; }).catch((error) => { project.sfx = { status: 'error', error: String(error?.message || error) }; }));
    const audioPromise = Promise.all(audioTasks);
    await mapBounded(project.scenes.filter((scene) => scene.imageStatus !== 'ready' || !scene.imageUrl), 3, async (scene) => {
      scene.imageStatus = 'working'; scene.error = undefined;
      await checkpoint(project, onCheckpoint, 'images', `Generating scene ${scene.index + 1} of ${project.scenes.length}…`);
      try { scene.imageUrl = await generateImage(project, scene); scene.imageStatus = 'ready'; }
      catch (error: any) { scene.imageStatus = 'error'; scene.error = String(error?.message || error); }
      await checkpoint(project, onCheckpoint, 'images', `Scene ${scene.index + 1} image ${scene.imageStatus}.`);
    });
    await audioPromise;
    if (project.scenes.some((scene) => scene.imageStatus !== 'ready')) throw new Error('One or more scene images failed. Retry the error cards to continue.');

    await checkpoint(project, onCheckpoint, 'clips', 'Animating scene images with Seedance 2.0 Fast…');
    await mapBounded(project.scenes.filter((scene) => scene.clipStatus !== 'ready' || !scene.clipUrl), 2, async (scene) => {
      scene.clipStatus = 'working'; scene.progress = 0; scene.error = undefined;
      await checkpoint(project, onCheckpoint, 'clips', `Seedance is animating scene ${scene.index + 1}…`);
      try {
        scene.clipUrl = await generateClip(project, scene, async (progress) => {
          scene.progress = progress;
          await checkpoint(project, onCheckpoint, 'clips', `Scene ${scene.index + 1}: ${Math.round(progress)}%`);
        });
        scene.clipStatus = 'ready'; scene.progress = 100;
      } catch (error: any) {
        scene.clipStatus = 'error'; scene.error = String(error?.message || error);
      }
      await checkpoint(project, onCheckpoint, 'clips', `Scene ${scene.index + 1} clip ${scene.clipStatus}.`);
    });
    if (project.scenes.some((scene) => scene.clipStatus !== 'ready')) throw new Error('One or more Seedance scenes failed. Retry only those scenes; completed clips are preserved.');

    await checkpoint(project, onCheckpoint, 'finishing', 'Remotion is trimming, sequencing, captioning, mixing and balancing the film…');
    project.previewUrl = await render(project);
    project.finishing = undefined;
    project.status = 'ready';
    await checkpoint(project, onCheckpoint, 'review', 'Review the composed film, then export when it feels right.');
    return project;
  } catch (error: any) {
    project.status = 'error'; project.error = String(error?.message || error || 'The pipeline stopped.');
    await onCheckpoint({ ...project, scenes: project.scenes.map((scene) => ({ ...scene })) });
    return project;
  }
}

export async function retryScene(project: FacelessProject, sceneId: string, regenerateImage: boolean, onCheckpoint: Checkpoint): Promise<FacelessProject> {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error('That scene is no longer in this project.');
  project.status = 'running'; project.error = undefined; project.step = regenerateImage ? 'images' : 'clips';
  scene.error = undefined;
  try {
    if (regenerateImage) {
      scene.imageStatus = 'working'; await onCheckpoint({ ...project, scenes: project.scenes.map((item) => ({ ...item })) });
      scene.imageUrl = await generateImage(project, scene); scene.imageStatus = 'ready';
    }
    scene.creditKey = newChargeKey(`faceless:${project.id}:scene:${scene.index + 1}:regen`);
    scene.clipStatus = 'working'; scene.progress = 0; await onCheckpoint({ ...project, scenes: project.scenes.map((item) => ({ ...item })) });
    scene.clipUrl = await generateClip(project, scene, async (progress) => { scene.progress = progress; await onCheckpoint({ ...project, scenes: project.scenes.map((item) => ({ ...item })) }); });
    scene.clipStatus = 'ready'; scene.progress = 100;
    project.step = 'finishing'; project.previewUrl = await render(project); project.step = 'review'; project.status = 'ready';
  } catch (error: any) {
    if (regenerateImage && scene.imageStatus !== 'ready') scene.imageStatus = 'error';
    else scene.clipStatus = 'error';
    scene.error = String(error?.message || error); project.status = 'error'; project.error = scene.error;
  }
  await onCheckpoint({ ...project, scenes: project.scenes.map((item) => ({ ...item })) });
  return project;
}

export async function replaceSceneClip(project: FacelessProject, sceneId: string, url: string, onCheckpoint: Checkpoint): Promise<FacelessProject> {
  if (!isUrl(url)) throw new Error('Paste a public HTTPS MP4 URL for the replacement clip.');
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error('That scene is no longer in this project.');
  scene.clipUrl = url; scene.clipStatus = 'ready'; scene.progress = 100; scene.error = undefined;
  project.step = 'finishing'; project.status = 'running'; await onCheckpoint({ ...project, scenes: project.scenes.map((item) => ({ ...item })) });
  project.previewUrl = await render(project); project.step = 'review'; project.status = 'ready';
  await onCheckpoint({ ...project, scenes: project.scenes.map((item) => ({ ...item })) });
  return project;
}

export async function rerenderReview(project: FacelessProject, onCheckpoint: Checkpoint): Promise<FacelessProject> {
  project.step = 'finishing'; project.status = 'running'; project.error = undefined; await onCheckpoint({ ...project, scenes: project.scenes.map((item) => ({ ...item })) });
  try { project.previewUrl = await render(project); project.step = 'review'; project.status = 'ready'; }
  catch (error: any) { project.status = 'error'; project.error = String(error?.message || error); }
  await onCheckpoint({ ...project, scenes: project.scenes.map((item) => ({ ...item })) });
  return project;
}
