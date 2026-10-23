import { planBigScenes, validateBigScenePlan } from './bigScenePlanner';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export function runBigScenePlannerTests(): void {
  const models = ['openrouter/bytedance/seedance-2.5', 'kling-3.0', 'kling-3.0-omni', 'gemini-omni-1.1-flash'];
  const durations = [15, 30, 45, 60, 90];
  for (const modelId of models) {
    for (const totalDurationSec of durations) {
      const scenes = planBigScenes({ modelId, totalDurationSec, script: 'A founder enters. The camera tracks forward. The product lights up. The founder smiles.' });
      assert(validateBigScenePlan(scenes, totalDurationSec).length === 0, `${modelId} ${totalDurationSec}s plan must validate`);
      assert(scenes.reduce((sum, scene) => sum + scene.duration, 0) === totalDurationSec, `${modelId} must total exactly ${totalDurationSec}s`);
      assert(scenes.every((scene) => scene.beats.reduce((sum, beat) => sum + beat.end - beat.start, 0) === scene.duration), `${modelId} beat timecodes must sum exactly`);
      assert(scenes.every((scene) => scene.attachCharacterReferences), `${modelId} must attach cast references to every big scene`);
      assert(scenes.slice(1).every((scene) => scene.continuityInput === 'last-frame' || scene.continuityInput === 'video-reference'), `${modelId} must choose capability-driven continuity`);
    }
  }
  const seedance60 = planBigScenes({ modelId: 'openrouter/bytedance/seedance-2.5', totalDurationSec: 60, script: 'One. Two. Three.' });
  assert(seedance60.map((scene) => scene.duration).join(',') === '30,30', 'Seedance 60s must be two 30s big scenes');
  const kling60 = planBigScenes({ modelId: 'kling-3.0-omni', totalDurationSec: 60, script: 'One. Two. Three.' });
  assert(kling60.length === 6 && kling60.every((scene) => scene.duration === 10), 'Kling 60s must be six 10s big scenes');
}
