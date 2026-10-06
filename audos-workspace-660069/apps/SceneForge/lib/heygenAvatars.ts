// Making a character, rather than picking one.
//
// Three routes to a custom presenter, all through the workspace HeyGen proxy:
//   * a photo the customer uploads  → `v3/avatars/photo`
//   * a written description         → `v3/avatars/prompt`
//   * a cinematic, film-framed look → `v3/avatars/cinematic`
// Plus `v3/avatar-groups`, which supplies the grouping the picker organises
// stock looks by.
//
// Each route is capability-gated and each creation is asynchronous: HeyGen
// returns an id and then takes up to a minute to train the look, so every
// creator here polls to a usable avatar before handing it back to be locked.
import { body, cacheAsset, get, jobIdOf, listOf, post, probe, sleep, statusOf, type CachedAsset } from './heygenApi';
import { HeyGenError } from './heygenStudio';

export interface CreatedAvatar {
  avatarId: string;
  lookId: string;
  name: string;
  previewUrl: string;
  defaultVoiceId: string;
}

function avatarFrom(payload: any, fallbackName: string): CreatedAvatar {
  const data = body(payload);
  const avatarId = String(data.avatar_id || data.id || data.photo_avatar_id || '');
  return {
    avatarId,
    lookId: String(data.avatar_look_id || data.look_id || data.default_look_id || avatarId),
    name: String(data.name || data.avatar_name || fallbackName),
    previewUrl: String(data.preview_image_url || data.image_url || data.preview_url || data.thumbnail_url || ''),
    defaultVoiceId: String(data.default_voice_id || ''),
  };
}

const READY = /^(completed|complete|ready|success|succeeded|active|done|trained)$/;
const FAILED = /^(failed|error|rejected|cancell?ed)$/;

/**
 * Wait for a freshly created avatar to become renderable.
 *
 * A new look is not usable the instant HeyGen accepts it, and submitting a
 * render against an untrained avatar is a wasted paid request. The detail
 * endpoint is polled until the look reports ready or carries a preview image;
 * a 404 on the detail route is treated as "no status endpoint, assume ready"
 * rather than a failure, because the creation call already succeeded.
 */
async function waitForAvatar(avatarId: string, fallbackName: string, onTick?: (seconds: number) => void): Promise<CreatedAvatar> {
  const started = Date.now();
  let best: CreatedAvatar | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let payload: any;
    try {
      payload = await get(`v3/avatars/${encodeURIComponent(avatarId)}`);
    } catch (e) {
      const status = Number((e as HeyGenError)?.status) || 0;
      if (status === 404 || status === 405) {
        return best || { avatarId, lookId: avatarId, name: fallbackName, previewUrl: '', defaultVoiceId: '' };
      }
      throw e;
    }
    const view = avatarFrom(payload, fallbackName);
    if (view.avatarId) best = view;
    const state = statusOf(payload);
    if (FAILED.test(state)) throw new HeyGenError(`HeyGen could not finish building this avatar${state ? ` (${state})` : ''}.`);
    if (READY.test(state) || (!state && view.previewUrl)) return view;
    onTick?.(Math.round((Date.now() - started) / 1000));
    await sleep(4000);
  }
  if (best) return best;
  throw new HeyGenError('Your avatar is still being built in HeyGen. Reopen the studio in a minute and it will be in your library.');
}

/**
 * Build a presenter from the customer's own photo.
 *
 * The bytes go to workspace storage first and HeyGen is handed the resulting
 * handle — the proxy carries JSON, not multipart, so a direct byte upload to
 * HeyGen is not possible from the browser (see lib/heygenApi `cacheAsset`).
 * The upload is content-addressed, so re-picking the same photo costs nothing.
 */
export async function createPhotoAvatar(file: File, name: string, onTick?: (seconds: number) => void): Promise<{ avatar: CreatedAvatar; asset: CachedAsset }> {
  if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
    throw new Error('Use a JPG, PNG or WebP photo of one person, facing the camera.');
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('That photo is larger than 20 MB. Use a smaller version.');
  const asset = await cacheAsset(file, 'sceneforge-heygen-photos');
  const created = await probe('avatar-photo', 'Photo avatars', () => post('v3/avatars/photo', {
    // `asset_id` is the documented-style handle; the URL is sent alongside
    // for an account whose asset registry is not enabled, where the id is ''.
    ...(asset.assetId ? { asset_id: asset.assetId } : { image_url: asset.url }),
    name: name.trim() || 'My avatar',
  }));
  const avatarId = String(body(created).avatar_id || body(created).id || jobIdOf(created));
  if (!avatarId) throw new HeyGenError('HeyGen accepted the photo but returned no avatar id.');
  const avatar = await waitForAvatar(avatarId, name.trim() || 'My avatar', onTick);
  return { avatar: { ...avatar, previewUrl: avatar.previewUrl || asset.url }, asset };
}

/** Build a presenter from a written description. */
export async function createPromptAvatar(prompt: string, onTick?: (seconds: number) => void): Promise<CreatedAvatar> {
  const description = prompt.trim();
  if (description.length < 12) throw new Error('Describe the character in a bit more detail — age, look, clothing, setting.');
  const created = await probe('avatar-prompt', 'Prompt-built avatars', () => post('v3/avatars/prompt', { prompt: description }));
  const avatarId = String(body(created).avatar_id || body(created).id || jobIdOf(created));
  if (!avatarId) throw new HeyGenError('HeyGen accepted the description but returned no avatar id.');
  return waitForAvatar(avatarId, description.slice(0, 40), onTick);
}

/**
 * A cinematic look: HeyGen's film-style framing of a presenter, driven by a
 * prompt describing the shot rather than the person.
 */
export async function createCinematicAvatar(prompt: string, baseAvatarId: string, onTick?: (seconds: number) => void): Promise<CreatedAvatar> {
  const look = prompt.trim();
  if (!look) throw new Error('Describe the cinematic look you want — framing, lighting, setting.');
  const created = await probe('avatar-cinematic', 'Cinematic avatars', () => post('v3/avatars/cinematic', {
    prompt: look,
    ...(baseAvatarId ? { avatar_id: baseAvatarId } : {}),
  }));
  const avatarId = String(body(created).avatar_id || body(created).id || jobIdOf(created));
  if (!avatarId) throw new HeyGenError('HeyGen accepted the cinematic look but returned no avatar id.');
  return waitForAvatar(avatarId, look.slice(0, 40), onTick);
}

// ——— Grouping ———

export interface AvatarGroup {
  id: string;
  name: string;
  /** Look ids that belong to this group, when the response lists them. */
  lookIds: string[];
}

/**
 * The account's avatar groups. HeyGen uses these for "Professional", "Casual",
 * "Custom" style collections, and the picker renders one expandable section
 * per group. An account with no groups is normal, not an error — the picker
 * falls back to a single flat section.
 */
export async function fetchAvatarGroups(): Promise<AvatarGroup[]> {
  const payload = await probe('avatar-groups', 'Avatar groups', () => get('v3/avatar-groups?limit=100'));
  return listOf(payload).map((entry) => ({
    id: String(entry?.group_id || entry?.id || ''),
    name: String(entry?.name || entry?.group_name || 'Group'),
    lookIds: (Array.isArray(entry?.looks) ? entry.looks : Array.isArray(entry?.avatars) ? entry.avatars : [])
      .map((look: any) => String(typeof look === 'string' ? look : look?.id || look?.look_id || look?.avatar_id || ''))
      .filter(Boolean),
  })).filter((group) => group.id);
}

/**
 * Group a flat look catalog for display.
 *
 * Membership comes from the group's own `lookIds` when HeyGen listed them;
 * otherwise a look's own `group_id` is used. Anything unclaimed lands in
 * "All looks", so no avatar is ever hidden by the grouping — which is the
 * failure mode that would make a customer think their library shrank.
 */
export function groupLooks<T extends { id: string; raw?: any }>(looks: T[], groups: AvatarGroup[]): { id: string; name: string; looks: T[] }[] {
  if (!groups.length) return [{ id: 'all', name: 'All looks', looks }];
  const byId = new Map(looks.map((look) => [look.id, look]));
  const claimed = new Set<string>();
  const sections = groups.map((group) => {
    const members: T[] = [];
    group.lookIds.forEach((id) => {
      const look = byId.get(id);
      if (look && !claimed.has(id)) { members.push(look); claimed.add(id); }
    });
    if (!members.length) {
      looks.forEach((look) => {
        const owner = String(look.raw?.group_id || look.raw?.avatar_group_id || '');
        if (owner && owner === group.id && !claimed.has(look.id)) { members.push(look); claimed.add(look.id); }
      });
    }
    return { id: group.id, name: group.name, looks: members };
  }).filter((section) => section.looks.length);

  const rest = looks.filter((look) => !claimed.has(look.id));
  if (rest.length) sections.push({ id: 'ungrouped', name: sections.length ? 'Everything else' : 'All looks', looks: rest });
  return sections;
}
