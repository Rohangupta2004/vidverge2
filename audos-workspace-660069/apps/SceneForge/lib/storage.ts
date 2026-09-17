import { forgeApi } from './forge';
import { uploadFile } from './proxy';

export function assetPath(projectId: string, sceneIndex: number, elementIndex: number, elementName: string) {
  const clean = elementName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'element';
  return `projects/${projectId}/assets/scene-${String(sceneIndex).padStart(2, '0')}/${String(elementIndex).padStart(2, '0')}-${clean}.png`;
}

/**
 * Store the customer's own still for a scene. The file goes to GCS from here,
 * but the asset row and the scene's `render_url` are written by the server
 * function: `public_url` and `render_url` are server-only columns, so an
 * upload adopted from the browser used to vanish without a word.
 */
export async function saveUpload(projectId: string, sceneId: string, _sceneIndex: number, file: File) {
  const upload = await uploadFile(file, `sceneforge-v2/${projectId}`);
  const adopted = await forgeApi.adoptUpload(projectId, sceneId, upload.url, file.name);
  return { public_url: adopted.imageUrl };
}
