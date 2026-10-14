import { workspaceToken } from './ai-client';
import { WORKSPACE_ID } from './platform';
import type { AssetType } from '../types/product-context.types';

export interface LaunchUpload {
  kind: 'logo' | 'product_image' | 'screenshot';
  type: AssetType;
  handle: string;
  url: string;
  name: string;
}

export async function uploadLaunchAsset(
  file: File,
  kind: LaunchUpload['kind'],
  signal?: AbortSignal,
): Promise<LaunchUpload> {
  const token = workspaceToken();
  if (!token) throw new Error('The workspace session is not ready for asset upload.');
  const form = new FormData();
  form.append('file', file, file.name || kind + '.png');
  form.append('workspaceId', WORKSPACE_ID);
  form.append('folder', 'product-launch-assets');
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': token },
    body: form,
    signal,
  });
  const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !data?.url) throw new Error(String(data?.error || 'Asset upload failed.'));
  return {
    kind,
    type: kind === 'logo' ? 'logo' : kind === 'screenshot' ? 'screenshot' : 'hero_image',
    handle: kind === 'logo' ? 'uploaded_logo' : kind === 'screenshot' ? 'uploaded_ui_reference' : 'uploaded_product_image',
    url: data.url,
    name: file.name,
  };
}
