import type { Overlay } from '../types';

const getToken = () => {
  const value = (window as any).__workspaceDb?.token;
  if (!value) throw new Error('Workspace authentication is not ready. Refresh and try again.');
  return value as string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(operationId: string): Promise<string> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`, {
      headers: { 'X-Workspace-DB-Token': getToken() },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Seedance status failed (${response.status})`);
    if (data.status === 'completed' && data.videoUrl) return data.videoUrl;
    if (data.status === 'failed') throw new Error(data.errorMessage || 'Seedance motion generation failed');
    await wait(5000);
  }
  throw new Error('Seedance motion generation timed out.');
}

export async function makeSeedanceClips(
  overlays: Overlay[],
  onProgress?: (complete: number, total: number) => void,
): Promise<Overlay[]> {
  const targets = overlays.filter((overlay) => overlay.type === 'seedance_motion');
  let complete = 0;
  const output = [...overlays];

  for (const target of targets) {
    if (!target.imageUrl) throw new Error(`Missing generated image for ${target.id}`);
    const duration = Math.round(target.durationSec);
    if (!Number.isInteger(duration) || duration < 2 || duration > 10) {
      throw new Error(`${target.id} is ${target.durationSec}s — Seedance 2 accepts whole scenes from 2–10s. Split the scene before generation.`);
    }
    const response = await fetch('/api/veo/generate/video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-DB-Token': getToken(),
      },
      body: JSON.stringify({
        model: 'openrouter/bytedance/seedance-2.0-fast',
        prompt: target.motionPrompt || 'Begin on a blank dark frame. Materialize every design element with kinetic typography energy while preserving the exact embedded text.',
        negativePrompt: 'misspelled text, changed wording, new words, warped typography, watermark, logo',
        aspectRatio: '16:9',
        duration,
        generateAudio: false,
        imageData: target.imageUrl,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.operationId || /_error_\d+$/.test(String(data.operationId))) throw new Error(data?.error?.message || data?.error || `Seedance generation failed for ${target.id}`);
    const videoUrl = await poll(data.operationId);
    const index = output.findIndex((overlay) => overlay.id === target.id);
    output[index] = { ...output[index], videoUrl };
    complete += 1;
    onProgress?.(complete, targets.length);
  }

  return output;
}
