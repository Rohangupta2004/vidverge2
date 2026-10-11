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

/** A scene starts here: "Scene 4 — Title | 6 sec". */
const SCENE_HEADER = /^\s*Scene\s+(\d+)\s*[\u2014\u2013-]\s*(.*)$/i;
/** Markdown horizontal rules separate scenes and carry no content of their own. */
const HORIZONTAL_RULE = /^\s*(?:[-*_\u2013\u2014]\s*){3,}$/;
const VISUAL_HEADING = /^\s*Visual\s*:\s*(.*)$/i;
const CAMERA_HEADING = /^\s*Camera\s*:\s*(.*)$/i;
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
  dialogue: { speaker: string; lines: string[] }[];
  /** Which heading's text the next unprefixed line belongs to. */
  section: 'visual' | 'camera' | 'dialogue';
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
    dialogue: [],
    section: 'visual',
  };
}

/** Whether anything at all was written under this scene's headings. A header
 * followed immediately by a horizontal rule is a formatting quirk, not the
 * end of the scene, so an empty draft is never closed by one. */
function hasContent(draft: SceneDraft): boolean {
  return draft.visual.length > 0 || draft.camera.length > 0 || draft.dialogue.length > 0;
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
