import { claudeJson } from '../lib/proxy';

export interface SceneImageBrief { scene: number; brief: string }
export interface ScriptResult { script: string; sources: string[]; estimated_duration_sec: number; scene_image_briefs: SceneImageBrief[] }

// One LLM owns both the words AND the pictures: alongside the script it
// returns a per-beat image brief, and those briefs are what the scene planner
// and the image stage generate from.
export const SCRIPT_AGENT_SYSTEM = [
  "You are SceneForge's deep researcher and human scriptwriter. Given a topic, audience, language and target length, research deeply: establish facts, dates, narrative context, comparisons and surprising angles.",
  'Write only words a human presenter would naturally speak. Use plain paragraphs with natural paragraph breaks: no stage directions, markdown headings, lists or production notes.',
  'Aim for 130 spoken words per minute; use 110 words per minute for Hindi or Hinglish. End with a strong call to action or memorable final line.',
  'During drafting, place citations in an internal sources block after the script so they are never spoken; then move those URLs into the JSON sources array and omit the block from the final script value.',
  'You must ALSO return scene_image_briefs: one entry per beat of the script, in script order, each naming the single supporting image that beat needs (subject, setting, framing, light and mood) with no on-screen words, no lettering and no watermark.',
  'Return strict JSON only: {"script":string,"sources":string[],"estimated_duration_sec":number,"scene_image_briefs":[{"scene":number,"brief":string}]}.',
].join(' ');

export async function writeScript(input: { topic: string; audience?: string; language: string; targetLengthSec: number; direction?: string }, model = 'claude-opus-5'): Promise<ScriptResult> {
  const rate = /hindi|hinglish|hi\b/i.test(input.language) ? 110 : 130;
  const result = await claudeJson<Partial<ScriptResult>>(SCRIPT_AGENT_SYSTEM, {
    ...input,
    target_word_count: Math.round(rate * input.targetLengthSec / 60),
    instruction: input.direction || 'Write the strongest complete script.',
  }, model, 8192);
  const briefs = Array.isArray(result.scene_image_briefs) ? result.scene_image_briefs : [];
  return {
    script: String(result.script || ''),
    sources: Array.isArray(result.sources) ? result.sources : [],
    estimated_duration_sec: Number(result.estimated_duration_sec) || input.targetLengthSec,
    scene_image_briefs: briefs
      .map((entry: any, index: number) => ({ scene: Number((entry && entry.scene) || index + 1), brief: String((entry && (entry.brief || entry.text)) || entry || '').trim() }))
      .filter((entry) => entry.brief.length > 3)
      .slice(0, 60),
  };
}
