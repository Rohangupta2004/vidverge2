import type { RenderInput } from '../types';
import { SCENE_FORGE_COMPOSITION_SOURCE } from '../remotion/SceneForgeComposition';

const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
const getToken = () => {
  const value = (window as any).__workspaceDb?.token;
  if (!value) throw new Error('Workspace authentication is not ready. Refresh and try again.');
  return value as string;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function renderWithRemotion(input: RenderInput): Promise<string> {
  const fps = 30;
  const durationInFrames = Math.max(1, Math.ceil(input.duration * fps));
  const response = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': getToken(),
    },
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      compositionTsx: SCENE_FORGE_COMPOSITION_SOURCE,
      props: { heygenVideoUrl: input.heygenVideoUrl, sourceAspectRatio: input.aspectRatio, overlays: input.overlays, fps },
      durationInFrames,
      fps,
      width: 1920,
      height: 1080,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.operationId) throw new Error(data?.error || `Remotion render submission failed (${response.status})`);

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const statusResponse = await fetch(`/api/render/remotion/${encodeURIComponent(data.operationId)}`, {
      headers: { 'X-Workspace-DB-Token': getToken() },
    });
    const status = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(status?.error || `Remotion status failed (${statusResponse.status})`);
    if (status.status === 'complete' && status.videoUrl) return status.videoUrl;
    if (status.status === 'failed') throw new Error(status.error || 'Remotion render failed');
    await wait(2000);
  }
  throw new Error('Remotion render timed out.');
}
