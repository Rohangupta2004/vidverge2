/**
 * VFX Drop prompt utilities.
 *
 * The app intentionally has no presets: the creator describes any addition in
 * their own words and the text model expands it into the prompt sent to the
 * video editor. The identity lock remains deterministic so an expansion can
 * never silently remove the app's core preservation promise.
 */

export const IDENTITY_LOCK =
  "Preserve the person's face, identity, skin tone, hair, clothing and body " +
  'proportions exactly, and keep their original pose, timing and natural movement ' +
  'frame for frame. Composite the requested addition into the existing footage ' +
  'with physically plausible lighting, shadows, reflections, perspective, scale, ' +
  'occlusion and motion. Do not replace or restyle the person.';

export const MAX_VFX_PROMPT_CHARS = 10000;

/**
 * Append the deterministic preservation clause without ever letting the
 * provider's 10,000-character ceiling cut that clause off. The returned value
 * is exactly what the preview shows and what Omni receives.
 */
export function buildVfxPrompt(expandedPrompt: string): string {
  const raw = String(expandedPrompt || '').trim();
  const maxCore = MAX_VFX_PROMPT_CHARS - IDENTITY_LOCK.length - 2;
  const sliced = raw.slice(0, maxCore);
  const boundary = sliced.length < raw.length ? sliced.lastIndexOf(' ') : sliced.length;
  const core = (boundary > maxCore * 0.6 ? sliced.slice(0, boundary) : sliced).trim();
  return `${core}${/[.!?]$/.test(core) ? '' : '.'} ${IDENTITY_LOCK}`;
}

/** A short, filesystem-safe stem for the downloaded MP4. */
export function promptSlug(brief: string): string {
  const slug = String(brief || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'custom-vfx';
}
