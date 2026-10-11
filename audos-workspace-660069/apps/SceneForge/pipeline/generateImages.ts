import type { ImageStyle, Overlay } from '../types';

const getToken = () => {
  const value = (window as any).__workspaceDb?.token;
  if (!value) throw new Error('Workspace authentication is not ready. Refresh and try again.');
  return value as string;
};

export async function generateOverlayImages(
  overlays: Overlay[],
  style: ImageStyle,
  onProgress?: (complete: number, total: number) => void,
): Promise<Overlay[]> {
  const targets = overlays.filter((overlay) => overlay.type === 'seedance_motion' || overlay.type === 'static_image');
  let complete = 0;
  const output = [...overlays];

  for (const target of targets) {
    const index = output.findIndex((overlay) => overlay.id === target.id);
    const textInstruction = target.type === 'seedance_motion' && target.textContent
      ? `The exact words “${target.textContent}” must be visibly typeset inside the image, spelled perfectly, as an integral part of the design.`
      : 'Do not include lettering, captions, logos, watermarks, or UI text.';
    const prompt = `${target.imagePrompt || target.textContent || 'Editorial visual'}\nVisual style: ${style}. Premium 16:9 editorial composition designed as an overlay over talking-head video. ${textInstruction}`;

    const response = await fetch('/api/generate/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-DB-Token': getToken(),
      },
      body: JSON.stringify({ prompt, aspectRatio: '16:9', quality: 'hd', returnBase64: false }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.imageUrl) throw new Error(data?.error?.message || data?.error || `Image generation failed for ${target.id}`);
    output[index] = { ...output[index], imageUrl: data.imageUrl };
    complete += 1;
    onProgress?.(complete, targets.length);
  }

  return output;
}
