/**
 * MANUAL SCRIPT MODE — the parser and prompt builder for a pre-formatted
 * script the customer pastes in whole.
 *
 * Nothing is inferred in this mode: no model reads the brief, no AI scene
 * detection runs and no director writes the shot. The pasted text IS the
 * plan. This module turns it into ParsedScene objects, and the pipeline then
 * generates from them exactly as if a director had returned them.
 *
 * The expected shape (the horizontal rules between scenes are optional):
 *
 *   Scene 1 — Title | 8 sec
 *
 *   Visual:
 *   <what the camera sees>
 *
 *   Dialogue — Maya:
 *   > "The line she speaks."
 *
 *   Camera: slow push in
 *
 *   ---
 *
 *   Scene 2 — …
 *
 *   ---
 *
 *   <everything after the last scene that does not open a new one is the
 *    overall style block — it is appended to EVERY scene's prompt>
 */

import { ManualDialogueLine, ParsedScene, ParsedScript } from './api';
import { capText } from './pipeline/videoModelService';
import { askOpusJson, askOpusRaw } from './pipeline/opus';

/** A scene starts here: "Scene 4 — Title | 6 sec". */
const SCENE_HEADER = /^\s*Scene\s+(\d+)\s*[\u2014\u2013-]\s*(.*)$/i;
/** Markdown horizontal rules separate scenes and carry no content of their own. */
const HORIZONTAL_RULE = /^\s*(?:[-*_\u2013\u2014]\s*){3,}$/;
const VISUAL_HEADING = /^\s*Visual\s*:\s*(.*)$/i;
const CAMERA_HEADING = /^\s*Camera\s*:\s*(.*)$/i;
const ON_SCREEN_TEXT_HEADING = /^\s*On[- ]screen\s+text\s*:\s*(.*)$/i;
/** Both "Dialogue — Maya:" and a bare "Dialogue:" open a dialogue block. */
const DIALOGUE_HEADING = /^\s*Dialogue\s*(?:[\u2014\u2013-]\s*([^:]*?))?\s*:\s*(.*)$/i;
const DURATION = /(\d+)\s*(?:s|sec|secs|second|seconds)\b/i;
/** The meta field after the "|" is where a length lives, so a bare number
 * there ("Scene 1 — Title | 12") means seconds even with the unit left off.
 * A number in the TITLE never does — "Scene 3 — Flight 815" is not an
 * 815-second scene — which is why this is only tried on the meta field. */
const BARE_DURATION = /^\s*(\d+)\s*$/;

/** The clip length used when a scene header carries no "| N sec" at all.
 * A DEFAULT, never a cap: any length the script does state is honoured up to
 * the chosen provider's real maximum. */
export const MANUAL_DEFAULT_SECONDS = 6;

/** A spoken line as written: drop the blockquote marker and the wrapping
 * quotes, straight or typographic, so the prompt carries the words alone. */
function stripQuote(value: string): string {
  const withoutMarker = String(value || '').trim().replace(/^>+\s*/, '').trim();
  return withoutMarker
    .replace(/^["'\u201C\u201D\u2018\u2019\u00AB\u00BB]+/, '')
    .replace(/["'\u201C\u201D\u2018\u2019\u00AB\u00BB]+$/, '')
    .trim();
}

interface SceneDraft {
  title: string;
  durationSec: number;
  visual: string[];
  camera: string[];
  onScreenText: string[];
  dialogue: { speaker: string; lines: string[] }[];
  /** Which heading's text the next unprefixed line belongs to. */
  section: 'visual' | 'camera' | 'dialogue' | 'on_screen_text';
}

function startScene(headerRest: string): SceneDraft {
  const [titlePart, ...meta] = String(headerRest || '').split('|');
  const metaText = meta.join('|');
  const duration = DURATION.exec(metaText) || DURATION.exec(headerRest) || BARE_DURATION.exec(metaText);
  const seconds = duration ? Number(duration[1]) : NaN;
  return {
    title: titlePart.trim(),
    durationSec: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : MANUAL_DEFAULT_SECONDS,
    visual: [],
    camera: [],
    onScreenText: [],
    dialogue: [],
    section: 'visual',
  };
}

/** Whether anything at all was written under this scene's headings. A header
 * followed immediately by a horizontal rule is a formatting quirk, not the
 * end of the scene, so an empty draft is never closed by one. */
function hasContent(draft: SceneDraft): boolean {
  return draft.visual.length > 0 || draft.camera.length > 0 || draft.onScreenText.length > 0 || draft.dialogue.length > 0;
}

function finishScene(draft: SceneDraft, index: number): ParsedScene {
  const dialogue: ManualDialogueLine[] = draft.dialogue
    .map((block) => ({ speaker: block.speaker.trim() || 'Speaker', line: block.lines.join(' ').trim() }))
    .filter((entry) => entry.line.length > 0);
  return {
    index,
    title: draft.title || `Scene ${index}`,
    durationSec: draft.durationSec,
    visual: draft.visual.join(' ').replace(/\s+/g, ' ').trim(),
    dialogue,
    onScreenText: draft.onScreenText.map((text) => stripQuote(text)).filter(Boolean),
    camera: draft.camera.join(' ').replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Parse a pasted script into scenes plus the overall style block.
 *
 * Scene boundaries are the only structural anchor: text before the first one
 * is ignored (a document title is not a scene), and text after a scene that
 * does not open another one is the overall style block.
 */
export function parseManualScript(raw: string): ParsedScript {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  const scenes: ParsedScene[] = [];
  const trailing: string[] = [];
  let draft: SceneDraft | null = null;

  const close = () => {
    if (draft) scenes.push(finishScene(draft, scenes.length + 1));
    draft = null;
  };

  for (const line of lines) {
    if (HORIZONTAL_RULE.test(line)) {
      if (draft && hasContent(draft)) close();
      continue;
    }
    const header = SCENE_HEADER.exec(line);
    if (header) {
      close();
      draft = startScene(header[2]);
      continue;
    }
    if (!draft) {
      // Loose text. Only what follows a scene counts as the style block — a
      // heading or title above the first scene is not part of the film.
      if (scenes.length && line.trim()) trailing.push(line.trim());
      continue;
    }

    const visual = VISUAL_HEADING.exec(line);
    if (visual) {
      draft.section = 'visual';
      if (visual[1].trim()) draft.visual.push(visual[1].trim());
      continue;
    }
    const camera = CAMERA_HEADING.exec(line);
    if (camera) {
      draft.section = 'camera';
      if (camera[1].trim()) draft.camera.push(camera[1].trim());
      continue;
    }
    const onScreenText = ON_SCREEN_TEXT_HEADING.exec(line);
    if (onScreenText) {
      draft.section = 'on_screen_text';
      if (onScreenText[1].trim()) draft.onScreenText.push(onScreenText[1].trim());
      continue;
    }
    const dialogue = DIALOGUE_HEADING.exec(line);
    if (dialogue) {
      draft.section = 'dialogue';
      const block = { speaker: (dialogue[1] || '').trim(), lines: [] as string[] };
      const inline = stripQuote(dialogue[2] || '');
      if (inline) block.lines.push(inline);
      draft.dialogue.push(block);
      continue;
    }

    const text = line.trim();
    if (!text) continue;
    if (draft.section === 'dialogue') {
      const block = draft.dialogue[draft.dialogue.length - 1];
      const spoken = stripQuote(text);
      if (block && spoken) block.lines.push(spoken);
    } else if (draft.section === 'camera') {
      draft.camera.push(text);
    } else if (draft.section === 'on_screen_text') {
      draft.onScreenText.push(text);
    } else {
      draft.visual.push(text);
    }
  }
  close();

  // "Overall style: warm 35mm grain" and "warm 35mm grain" mean the same
  // thing here, and the prompt builder re-labels it — so the label is dropped.
  const globalStyle = trailing.join(' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:overall\s+style|overall\s+look|style|look\s*(?:&|and)\s*feel)\s*[:\u2014\u2013-]\s*/i, '');
  return { scenes, globalStyle };
}

/** The scene's spoken content, as the rest of the pipeline reads it: the
 * script segment of a manual scene is its dialogue and nothing else, so the
 * audio stage never narrates a camera direction out loud. */
export function manualSceneSegment(scene: ParsedScene): string {
  return scene.dialogue.map((entry) => `${entry.speaker}: "${entry.line}"`).join('\n');
}

/**
 * Assemble one scene's generation prompt from the parsed script — visual,
 * then camera, then the dialogue lines, with the overall style block last.
 * Nothing here is generated: every sentence comes from the pasted text or is
 * a fixed instruction the video models need (lip-sync, no on-screen text,
 * seamless continuation).
 */
export function buildManualScenePrompt(params: {
  scene: ParsedScene;
  globalStyle?: string;
  /** The clip starts from the previous scene's final frame. */
  continuity?: boolean;
  /** A direction the customer added after the first attempt. */
  revisionNote?: string | null;
  maxChars?: number;
}): string {
  const { scene } = params;
  const maxChars = Math.max(200, params.maxChars || 10000);
  const body: string[] = [];

  if (scene.visual) body.push(scene.visual);
  if (scene.camera) body.push(`Camera: ${scene.camera}`);
  for (const entry of scene.dialogue) body.push(`Dialogue — ${entry.speaker}: "${entry.line}"`);
  if (scene.dialogue.length) {
    body.push('The speaker visibly says these exact words on camera, lips synchronized to the line. No other speech, no subtitles.');
  }
  if (params.continuity) {
    body.push('Continue seamlessly from the reference frame’s exact state — same character, wardrobe, lighting and position. No reset, no greeting, no recap.');
  }
  if (params.revisionNote) body.push(`Direction: ${params.revisionNote}`);

  const style = String(params.globalStyle || '').trim();
  const tail = style ? `Overall style: ${capText(style, 2000)}` : '';
  const room = tail ? Math.max(160, maxChars - tail.length - 1) : maxChars;
  const text = capText(body.join('\n'), room);
  return tail ? `${text}\n${tail}` : text;
}

/** The negative prompt a manual scene renders with. A scene with no dialogue
 * must not have the model inventing speech. */
export function manualSceneNegative(scene: ParsedScene): string {
  const base = 'on-screen text, captions, subtitles, watermarks, logos, UI elements, warped anatomy';
  return scene.dialogue.length ? base : `${base}, speaking to camera, moving lips as if speaking, voice-over`;
}

// ---------------------------------------------------------------------------
// AI FORMAT — turn ANY rough script into the manual-mode scene structure.
//
// Manual Script Mode's parser expects the strict "Scene N — Title | N sec"
// shape above. AI Format is the on-ramp for everything else: the raw text the
// customer pasted goes to the platform OpenAI proxy once, comes back as a
// ParsedScript-shaped JSON plan, and serializeManualScript() re-emits it in
// the exact format the parser reads — so the preview below the textarea shows
// precisely what will be filmed, and the customer can still hand-edit it.
// ---------------------------------------------------------------------------

export interface ScriptConcept { title: string; premise: string; visual_arc: string; }

export async function suggestScriptConcepts(raw: string): Promise<ScriptConcept[]> {
  const idea = String(raw || '').trim();
  if (!idea) throw new Error('Describe the film first — then the writer can propose distinct approaches.');
  const out = await askOpusJson<{ concepts: ScriptConcept[] }>({
    system: `You are the concept writer for a script-to-video production. Reply only with JSON: {"concepts":[{"title":string,"premise":string,"visual_arc":string}]}. Propose only meaningfully distinct approaches grounded in the user's exact brief. Each premise names the central action and audience value; each visual_arc states a physically realistic opening, development and ending without vague filler, invented claims, teleporting, morphing or decorative scenes. Do not write scene dialogue or the finished script yet. Include as many concepts as are genuinely distinct and no duplicates.`,
    user: idea,
    maxTokens: 16000,
    effort: 'high',
  });
  const concepts = (Array.isArray(out?.concepts) ? out.concepts : []).map((concept) => ({
    title: String(concept?.title || '').trim(),
    premise: String(concept?.premise || '').trim(),
    visual_arc: String(concept?.visual_arc || '').trim(),
  })).filter((concept) => concept.title && concept.premise && concept.visual_arc);
  if (!concepts.length) throw new Error('The writer returned no usable story approaches. Retry this step; no script or render was created.');
  return concepts;
}

const AI_FORMAT_SYSTEM_PROMPT = `You are a video director's assistant. Convert the provided idea or script into a structured, editable scene proposal for video production. Output ONLY valid JSON matching this TypeScript type:

interface ParsedScene {
  index: number;        // 1-based
  title: string;        // short scene title
  durationSec: number;  // one duration permitted by the MODEL DURATION CONTRACT supplied below
  visual: string;       // detailed visual description for video generation
  dialogue: { speaker: string; line: string }[];  // spoken lines (empty array if none)
  onScreenText: string[]; // exact visible copy, rendered only in post-production
  camera: string;       // camera framing and movement
}

Output: { "scenes": ParsedScene[], "globalStyle": string }

globalStyle should be a one-sentence visual style note naming camera language, motivated light source, palette and medium.
Each scene has one clear physical action. State every visible character's fixed appearance and position in frame, specific camera framing/movement, motivated lighting, object contact, weight, direction and end pose. Obey real physics. Ban vague filler (including “something exciting happens” and “cinematic moment”), teleporting, sudden appearances, identity/wardrobe morphing and dialogue cut in half.
Every spoken line must be attributed to a named character or to Narrator. Never use an unattributed Speaker placeholder.
If the source explicitly asks for visible copy (URL, brand name, tagline, CTA, statistic, label or end card), copy it exactly into onScreenText and keep it out of visual. Do not invent visible copy.`;

/** Models love wrapping JSON in \`\`\`json fences; strip them before parsing. */
function stripJsonFences(text: string): string {
  const t = String(text || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(t);
  if (fenced) return fenced[1].trim();
  // Fall back to the outermost object if the model added prose around it.
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) return t.slice(first, last + 1);
  return t;
}

function clampDuration(value: unknown, options: { modelMinDuration?: number; modelMaxDuration?: number; modelSupportedDurations?: number[] }): number {
  const min = Math.max(1, Math.round(Number(options.modelMinDuration) || 4));
  const max = Math.max(min, Math.round(Number(options.modelMaxDuration) || 10));
  const n = Math.round(Number(value));
  const wanted = Number.isFinite(n) && n > 0 ? n : Math.max(min, Math.min(max, MANUAL_DEFAULT_SECONDS));
  const fixed = (options.modelSupportedDurations || []).map(Number).filter((duration) => Number.isFinite(duration) && duration >= min && duration <= max).sort((a, b) => a - b);
  if (fixed.length) return fixed.find((duration) => duration >= wanted) ?? fixed[fixed.length - 1];
  return Math.max(min, Math.min(max, wanted));
}

/**
 * Send ANY rough script to the OpenAI proxy and get back a normalized
 * ParsedScript. Throws with a customer-readable message on every failure —
 * the caller shows it inline and the pasted text is never touched until a
 * valid plan came back.
 */
export async function aiFormatScript(raw: string, options: { audioEnabled?: boolean; narrationEnabled?: boolean; charactersSpeak?: boolean; modelLabel?: string; modelDurationRule?: string; modelMinDuration?: number; modelMaxDuration?: number; modelSupportedDurations?: number[]; targetDuration?: number; targetSceneDurations?: number[] } = {}): Promise<ParsedScript> {
  const script = String(raw || '').trim();
  if (!script) throw new Error('Paste your script first — then AI Format can structure it into scenes.');
  const audioEnabled = options.audioEnabled !== false;
  const narrationEnabled = audioEnabled && options.narrationEnabled === true;
  const charactersSpeak = audioEnabled && options.charactersSpeak === true;
  const speechPolicy = !audioEnabled
    ? 'AUDIO IS OFF: dialogue must be an empty array in every scene. Do not add speech, narration, music cues, ambient-audio cues, or sound effects.'
    : narrationEnabled && !charactersSpeak
      ? 'NARRATION ONLY: add concise Narrator lines where the story needs words. Do not add any on-camera character dialogue. Every spoken entry must use speaker "Narrator".'
      : narrationEnabled
        ? 'NARRATION AND CHARACTER SPEECH ARE ON: use concise Narrator lines for voice-over and add named, attributed on-camera character dialogue only where natural.'
        : charactersSpeak
          ? 'AUDIO IS ON, NARRATION IS OFF: add concise spoken dialogue for visible characters where natural, always attributed to the character name. Do not add Narrator lines.'
          : 'AUDIO IS ON, BUT ALL SPEECH IS OFF: dialogue must be an empty array in every scene; visuals may still imply ambient sound and music.';

  const reply = await askOpusRaw({
    system: `${AI_FORMAT_SYSTEM_PROMPT}\n\nMODEL DURATION CONTRACT: ${options.modelLabel || 'selected model'} accepts ${options.modelDurationRule || 'the durations shown in the app'}. Every scene must use a legal duration. Split only at sentence or complete dialogue-line boundaries; never cut a spoken line in half.\nEXACT RUNTIME: write for exactly ${Math.round(Number(options.targetDuration) || 0)} seconds. Output exactly ${(options.targetSceneDurations || []).length || 'the required number of'} BIG scenes with these durations in order: ${(options.targetSceneDurations || []).map((value) => `${value}s`).join(', ') || 'use the model maximum first'}. Each big scene is one provider generation and may contain several timecoded actions internally; do not create a many-5s-scene grid.\n\n${speechPolicy}\nPreserve any wording already supplied by the user verbatim; additions are a proposal the user must accept.`,
    user: capText(script, 24000),
    maxTokens: 16000,
    effort: 'high',
  });
  const text = reply.text.trim();
  if (!text) throw new Error('The formatter returned an empty answer — try again.');

  let parsed: any;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('The formatter did not return valid JSON — try again.');
  }

  const rawScenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  const scenes: ParsedScene[] = rawScenes
    .map((scene: any, i: number): ParsedScene => ({
      index: i + 1,
      title: String(scene?.title || '').trim() || `Scene ${i + 1}`,
      durationSec: clampDuration(scene?.durationSec, options),
      visual: String(scene?.visual || '').replace(/\s+/g, ' ').trim(),
      dialogue: (Array.isArray(scene?.dialogue) ? scene.dialogue : [])
        .map((entry: any): ManualDialogueLine => ({
          speaker: String(entry?.speaker || '').trim() || 'Speaker',
          line: String(entry?.line || '').trim(),
        }))
        .filter((entry: ManualDialogueLine) => entry.line.length > 0),
      onScreenText: (Array.isArray(scene?.onScreenText) ? scene.onScreenText : []).map((value: unknown) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
      camera: String(scene?.camera || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((scene: ParsedScene) => scene.visual.length > 0);

  if (!scenes.length) throw new Error('The formatter found no filmable scenes in that text — add a little more detail and try again.');
  const exactDurations = (options.targetSceneDurations || []).map((value) => Math.round(Number(value))).filter((value) => value > 0);
  if (exactDurations.length) {
    if (scenes.length !== exactDurations.length) throw new Error(`The writer returned ${scenes.length} scenes, but this model needs exactly ${exactDurations.length} big scenes (${exactDurations.join('s, ')}s). Retry the script step; no generation was started.`);
    scenes.forEach((scene, index) => { scene.durationSec = exactDurations[index]; });
  }
  const exactTotal = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  if (Number(options.targetDuration) > 0 && exactTotal !== Math.round(Number(options.targetDuration))) throw new Error(`The writer returned ${exactTotal}s, not the selected ${Math.round(Number(options.targetDuration))}s. Retry the script step; no generation was started.`);
  // Re-number after the visual-less filter so indexes stay 1-based and gapless.
  scenes.forEach((scene, i) => { scene.index = i + 1; });

  return { scenes, globalStyle: String(parsed?.globalStyle || '').replace(/\s+/g, ' ').trim() };
}

/**
 * Emit a ParsedScript in the exact text format parseManualScript() reads, so
 * an AI-formatted plan lands back in the textarea as editable manual-mode
 * text and the parse preview shows what will be filmed.
 */
export function serializeManualScript(parsed: ParsedScript): string {
  const blocks = (parsed.scenes || []).map((scene) => {
    const lines: string[] = [
      `Scene ${scene.index} — ${scene.title} | ${scene.durationSec} sec`,
      '',
      'Visual:',
      scene.visual,
    ];
    for (const entry of scene.dialogue) {
      lines.push('', `Dialogue — ${entry.speaker}:`, `> "${entry.line}"`);
    }
    if (scene.onScreenText.length) lines.push('', 'On-screen text:', ...scene.onScreenText.map((text) => `> "${text}"`));
    if (scene.camera) lines.push('', `Camera: ${scene.camera}`);
    return lines.join('\n');
  });
  const style = String(parsed.globalStyle || '').trim();
  return blocks.join('\n\n---\n\n') + (style ? `\n\n---\n\nOverall style: ${style}` : '') + '\n';
}
