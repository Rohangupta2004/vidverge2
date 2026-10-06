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

/** Append the deterministic preservation clause to an AI-expanded VFX prompt. */
export function buildVfxPrompt(expandedPrompt: string): string {
  const core = String(expandedPrompt || '').trim();
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
