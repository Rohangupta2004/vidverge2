import { claudeJson } from '../lib/proxy';
import type { WordTimestamp } from '../lib/supabase';

export const SCENE_DECIDER_SYSTEM = `You are SceneForge's scene-decider. Input includes the full script, word-level timestamps, style, requested supporting-scene share and user uploads. Choose only lines that materially benefit from a supporting visual. The first 5 seconds must remain avatar. The final segment before the end must return to avatar. Never place two supporting scenes back-to-back without an avatar return, unless one continuous sentence spans that gap. Keep total supporting duration near low=30%, medium=50%, or high=65%. Each image prompt describes exactly one transparent compositing element. When the input carries imageBriefs from the scriptwriter, treat them as the intended visual for their beat and turn each one into that scene's image_prompts rather than inventing a different picture. Reuse a fitting upload by naming it in suggested_user_uploads. Return strict JSON only: {"scenes":[{"scene_index":number,"script_start_sec":number,"script_end_sec":number,"scene_type":string,"description":string,"image_prompts":string[],"motion_notes":string,"suggested_user_uploads"?:string[]}],"total_scene_sec":number,"total_avatar_sec":number}.`;

export async function decideScenes(input: { script: string; wordTimestamps: WordTimestamp[]; style: string; sceneShare: 'low' | 'medium' | 'high'; uploads: string[]; durationSec: number; imageBriefs?: { scene: number; brief: string }[] }, model = 'claude-opus-5') {
  const result = await claudeJson<any>(SCENE_DECIDER_SYSTEM, input, model);
  const duration = Math.max(6, input.durationSec);
  const sorted = (Array.isArray(result.scenes) ? result.scenes : [])
    .map((s: any, i: number) => ({ ...s, scene_index: i + 1, script_start_sec: Math.max(5, Number(s.script_start_sec || 5)), script_end_sec: Math.min(duration - 1, Number(s.script_end_sec || 6)), image_prompts: Array.isArray(s.image_prompts) ? s.image_prompts : [] }))
    .filter((s: any) => s.script_end_sec > s.script_start_sec)
    .sort((a: any, b: any) => a.script_start_sec - b.script_start_sec);
  const separated = sorted.filter((s: any, i: number) => i === 0 || s.script_start_sec - sorted[i - 1].script_end_sec >= 0.4);
  const total = separated.reduce((n: number, s: any) => n + s.script_end_sec - s.script_start_sec, 0);
  return { scenes: separated, total_scene_sec: total, total_avatar_sec: Math.max(0, duration - total) };
}

export function approximateWordTimestamps(script: string, durationSec: number): WordTimestamp[] {
  const words = script.trim().split(/\s+/).filter(Boolean); const usable = Math.max(1, durationSec);
  return words.map((word, i) => ({ word, start: i * usable / words.length, end: (i + 1) * usable / words.length }));
}
