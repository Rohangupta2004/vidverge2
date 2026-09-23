// Read-side helpers for the LIVE HeyGen catalog. Everything here only
// reshapes what the API actually returned — nothing is invented — and every
// field read is defensive because catalog payload shapes vary by account.

export interface AvatarView {
  id: string;
  name: string;
  image: string;
  gender: string;
  styleLabel: string;
  indian: boolean;
  raw: any;
}

export interface VoiceView {
  id: string;
  name: string;
  language: string;
  gender: string;
  indian: boolean;
  raw: any;
}

const INDIAN_LANGUAGES = /(hindi|hinglish|tamil|telugu|bengali|marathi|punjabi|gujarati|kannada|malayalam|urdu|odia|assamese)/i;
const INDIAN_MARKERS = /(\bindian?\b|\bindia\b|south asian|\bdesi\b|en[-_]in\b|hi[-_]in\b)/i;
// Name-only fallback for catalog entries that carry no region or language
// metadata at all — deliberately conservative, common Indian given names.
const INDIAN_NAMES = /\b(aarav|aditi|aisha|amit|ananya|anil|anjali|arjun|deepa|deepika|divya|isha|ishaan|kavya|kiran|krishna|lakshmi|meera|neha|nikhil|pooja|priya|rahul|raj|rajesh|rani|ravi|riya|rohan|sanjay|shreya|sneha|sunita|tanvi|varun|vikram)\b/i;

function joined(...parts: unknown[]): string {
  return parts
    .flat()
    .filter(Boolean)
    .map((part) => (typeof part === 'string' ? part : Array.isArray(part) ? part.join(' ') : String(part)))
    .join(' ');
}

function isIndian(metadata: string, nameOnly: string): boolean {
  return INDIAN_MARKERS.test(metadata) || INDIAN_LANGUAGES.test(metadata) || INDIAN_NAMES.test(nameOnly);
}

export function avatarView(avatar: any): AvatarView {
  const id = String(avatar?.id ?? avatar?.avatar_id ?? avatar?.look_id ?? '');
  const name = String(avatar?.name || avatar?.display_name || avatar?.avatar_name || id);
  const image = String(avatar?.preview_image_url || avatar?.image_url || avatar?.preview_url || avatar?.thumbnail_url || avatar?.cover_url || '');
  const gender = String(avatar?.gender || '').trim();
  const tags = Array.isArray(avatar?.tags) ? avatar.tags : [];
  const styleLabel = String(avatar?.style || avatar?.pose_name || avatar?.type || tags[0] || (avatar?.premium ? 'Premium' : '')).trim();
  const metadata = joined(name, gender, styleLabel, avatar?.language, avatar?.accent, avatar?.ethnicity, avatar?.region, tags);
  return { id, name, image, gender, styleLabel, indian: isIndian(metadata, name), raw: avatar };
}

export function voiceView(voice: any): VoiceView {
  const id = String(voice?.voice_id ?? voice?.id ?? '');
  const name = String(voice?.name || voice?.display_name || id);
  const language = joined(voice?.language || voice?.languages || voice?.locale, voice?.accent).trim() || 'Language unlabelled';
  const gender = String(voice?.gender || '').trim();
  const metadata = joined(name, language, gender, voice?.accent, voice?.locale, voice?.tags);
  return { id, name, language, gender, indian: isIndian(metadata, name), raw: voice };
}

// Indian avatars first (the primary market), then entries with a real
// thumbnail, then alphabetical — pure ordering, never filtering.
export function sortAvatars(avatars: any[]): AvatarView[] {
  return avatars
    .map(avatarView)
    .filter((view) => view.id)
    .sort((a, b) => Number(b.indian) - Number(a.indian) || Number(Boolean(b.image)) - Number(Boolean(a.image)) || a.name.localeCompare(b.name));
}

export function sortVoices(voices: any[]): VoiceView[] {
  return voices
    .map(voiceView)
    .filter((view) => view.id)
    .sort((a, b) => Number(b.indian) - Number(a.indian) || a.name.localeCompare(b.name));
}

// Voice suggestions for one selected avatar. Explicit compatibility ids from
// the API win; a language match is the fallback; null means HeyGen gave us
// nothing to pair on, so the picker shows the full catalog unfiltered. Only
// ids that exist in the live voice list are ever suggested.
export function suggestedVoices(avatar: any | undefined, voices: VoiceView[]): { ids: Set<string>; reason: string } | null {
  if (!avatar) return null;
  const explicit = [avatar.default_voice_id, avatar.preferred_voice_id, avatar.voice_id, avatar.compatible_voice_ids, avatar.compatible_voices, avatar.supported_voice_ids, avatar.voice_ids]
    .flat()
    .map((entry: any) => String((entry && typeof entry === 'object' ? entry.voice_id ?? entry.id : entry) ?? ''))
    .filter(Boolean);
  const available = new Set(voices.map((voice) => voice.id));
  const compatible = explicit.filter((id) => available.has(id));
  if (compatible.length) return { ids: new Set(compatible), reason: 'HeyGen marks these voices as compatible with this avatar.' };
  const language = String(avatar.language || avatar.locale || '').trim().toLowerCase();
  if (language) {
    const matched = voices.filter((voice) => voice.language.toLowerCase().includes(language)).map((voice) => voice.id);
    if (matched.length) return { ids: new Set(matched), reason: `Matched on the avatar's language (${language}).` };
  }
  return null;
}
