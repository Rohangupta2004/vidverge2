/**
 * Owner key for saved SceneForge Director films (table sf_director_films).
 * Moved here verbatim from apps/SceneForge/lib/directorStore.ts during the
 * Oct 2026 SceneForge scrap-and-rebuild — the Vidverge Agent still lists the
 * old Director films, and this hash is the row scope they were saved under.
 */
export async function directorOwnerKey(identity: string): Promise<string> {
  const normalized = String(identity || '').trim().toLowerCase();
  if (!normalized) throw new Error('Sign in before loading saved Director films.');
  const bytes = new TextEncoder().encode(`sceneforge-director:${normalized}`);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}
