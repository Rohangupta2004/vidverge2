/**
 * ADS STUDIO — HEYGEN health check + avatar identity persistence
 * (platform integration: heygen-video).
 *
 * Ads Studio does not render its presenter on HeyGen — the clips come from
 * Kling or the Group A video proxy. What it needs from HeyGen is:
 *
 *   1. a HEALTH SIGNAL in the toolbar, so the founder knows whether avatar
 *      generation is even reachable before they spend anything, and
 *   2. a STABLE avatar_id + voice_id pair, because HeyGen has no seed
 *      parameter — reusing the same pair is the only way its presenter stays
 *      the same person between sessions.
 *
 * THE PROXY IS SAME-ORIGIN ONLY. Probed 26 Sep 2026: a server function
 * calling /api/workspaces/:id/provider-credentials/heygen/proxy/... is
 * refused with 401 {"error":"Same-origin request required"} — both on v3 and
 * on the legacy v2 quota path. The health check therefore HAS to run in the
 * page (which is same-origin) and can never be moved into a hook.
 *
 * The probe is a catalogue GET (v3/avatars/looks?limit=1): it costs nothing,
 * it is a documented endpoint, and it fails with 401/403 when the key is bad
 * — which is exactly what "reachable and valid" means here. The proxy injects
 * the HeyGen key server-side, so no provider credential is sent from here.
 */

import { workspaceUuid, wsToken } from './api';

function proxyUrl(path: string): string {
  return `/api/workspaces/${workspaceUuid()}/provider-credentials/heygen/proxy/${String(path).replace(/^\/+/, '')}`;
}

export type HeygenHealth = 'checking' | 'online' | 'offline';

export interface HeygenHealthResult {
  state: HeygenHealth;
  online: boolean;
  /** Tooltip text — the reason, in the founder's language. */
  detail: string;
}

export const HEYGEN_OFFLINE_TOOLTIP =
  'HeyGen API is unreachable. Avatar generation will fall back to Kling.';

/**
 * One cheap catalogue read that proves the proxy answers AND the key is
 * accepted. Never throws — an offline HeyGen degrades Ads Studio, it does not
 * block it.
 */
export async function checkHeygenHealth(): Promise<HeygenHealthResult> {
  try {
    const res = await fetch(proxyUrl('v3/avatars/looks?limit=1'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Harmless on this proxy (it injects the provider key itself) and
        // correct for every other authenticated platform call this app makes.
        ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}),
      },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const reason = String(data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`);
      return { state: 'offline', online: false, detail: `${HEYGEN_OFFLINE_TOOLTIP} (${reason.slice(0, 120)})` };
    }
    // A 200 whose body is not the documented { data: [...] } envelope is still
    // a reachable, authenticated proxy — report online and say what came back.
    const looks = Array.isArray(data?.data) ? data.data.length : 0;
    return {
      state: 'online',
      online: true,
      detail: looks
        ? `HeyGen is reachable and the key is valid (${looks} avatar look read from the live catalogue).`
        : 'HeyGen is reachable and the key is valid.',
    };
  } catch (e: any) {
    return { state: 'offline', online: false, detail: `${HEYGEN_OFFLINE_TOOLTIP} (${String(e?.message || e).slice(0, 120)})` };
  }
}

// ---------------------------------------------------------------------------
// Avatar identity — HeyGen's substitute for a seed
//
// Ads Studio renders its clips on Kling or the Group A video proxy, so it has
// no HeyGen avatar picker of its own: the avatar and voice are chosen in
// SceneForge, and this pair is read here so the 🎭 Character card shows the
// same presenter and an avatar render started elsewhere stays the same person.
// ---------------------------------------------------------------------------

export const AVATAR_CONFIG_KEY = 'ads_studio_avatar_config';

export interface AvatarConfig {
  avatarId: string;
  voiceId: string;
  /** Preview thumbnail for the Character card, when the catalogue gave one. */
  thumbnailUrl: string;
  /** Human name, for the card. */
  name: string;
}

export function readAvatarConfig(): AvatarConfig | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(AVATAR_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const avatarId = String(parsed?.avatarId || '');
    if (!avatarId) return null;
    return {
      avatarId,
      voiceId: String(parsed?.voiceId || ''),
      thumbnailUrl: String(parsed?.thumbnailUrl || ''),
      name: String(parsed?.name || avatarId),
    };
  } catch {
    return null;
  }
}

/** Persist the presenter identity so it survives every reload. It is never
 * reset between sessions — only an explicit change replaces it. */
export function writeAvatarConfig(config: AvatarConfig): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(AVATAR_CONFIG_KEY, JSON.stringify(config));
  } catch { /* quota or private mode — the pair just does not survive reload */ }
}
