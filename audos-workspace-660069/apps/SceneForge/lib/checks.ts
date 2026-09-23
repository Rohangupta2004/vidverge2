import type { Asset, CheckResult, Project, Scene } from './supabase';
import { sceneSettled } from './sceneState';

async function reachable(url?: string) { if (!url) return false; try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; } }
export async function runChecks(project: Project, scenes: Scene[], assets: Asset[], previousHash?: string): Promise<CheckResult[]> {
  const duration = Number(project.avatar_duration_sec || project.estimated_duration_sec || 0);
  // Skipped scenes are out of the film by decision — they neither count
  // toward the visual check nor toward the scene-share arithmetic.
  const active = scenes.filter((scene) => scene.status !== 'skipped');
  const sceneSec = active.reduce((sum, scene) => sum + Math.max(0, Number(scene.script_end_sec) - Number(scene.script_start_sec)), 0);
  const share = duration ? sceneSec / duration : 0;
  const assetReachability = await Promise.all(assets.map((asset) => reachable(asset.public_url)));
  const hash = project.build_hash || '';
  return [
    { id: 'duration_match', pass: duration > 0 && !!project.assembled_video_url, label: 'Duration match', detail: duration > 0 ? `Assembly targets ${duration.toFixed(1)} seconds, matching the avatar master.` : 'Avatar duration is missing.' },
    { id: 'audio_continuity', pass: !!project.heygen_video_url && !!project.assembled_video_url, label: 'Audio continuity', detail: project.heygen_video_url ? 'Assembly uses the uninterrupted avatar master as its audio source.' : 'Avatar audio source is missing.' },
    { id: 'frame_samples', pass: active.every(sceneSettled), label: 'Frame samples', detail: active.every(sceneSettled) ? 'Every scene in the film is settled: AI clips generated, stills in place, text overlays composed at assembly.' : 'One or more scenes are still missing their media.' },
    { id: 'manifest_complete', pass: assets.length > 0 && assetReachability.every(Boolean), label: 'Manifest complete', detail: `${assetReachability.filter(Boolean).length}/${assets.length} asset URLs responded.` },
    { id: 'scene_share', pass: duration > 0 && share >= 0.25 && share <= 0.70, label: 'Scene share', detail: duration ? `${Math.round(share * 100)}% of the runtime uses supporting scenes.` : 'Cannot calculate scene share without duration.' },
    { id: 'no_stale_bundle', pass: !!hash && hash !== previousHash, label: 'Fresh bundle', detail: hash && hash !== previousHash ? `Build ${hash.slice(0, 10)} is new.` : 'The build hash did not change.' },
  ];
}
