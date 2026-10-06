/**
 * Video Studio — one-tap starting points.
 *
 * Two families of preset, both of which write straight into the EditDoc so the
 * stage, the timeline and the export all see the change on the next frame:
 *
 *   SAMPLE USES   shown on the empty state. "Make a TikTok" has to decide the
 *                 aspect as well as the look, because the format is the whole
 *                 point of the choice.
 *   STYLE PRESETS the scrollable row above the tabs. These never touch the
 *                 aspect — someone who already picked 9:16 should be able to
 *                 try five looks without losing their format.
 *
 * A preset deliberately picks a BUNDLED music bed rather than firing an AI
 * music generation: the bed is instant and free, and the Music tab is one tap
 * away when the creator wants a bespoke score. Generated music already in the
 * document is never thrown away by a preset.
 */
import {
  AspectId, CaptionStyleId, EditDoc, GradeId, MusicStyleId, SpeedRamp,
  StudioClip, SubjectMood, SubjectProfile, clipMotion,
} from './studioModel';

export interface StudioPreset {
  id: string;
  emoji: string;
  label: string;
  /** Tooltip copy — kept under twelve words on purpose. */
  blurb: string;
  /** Only the sample-use cards set a format. */
  aspect?: AspectId;
  captionStyle: CaptionStyleId;
  captionFontId: string;
  grade: GradeId;
  musicStyle: MusicStyleId;
  musicBedId: string;
  ramp: Partial<SpeedRamp>;
  vhs: boolean;
  /** Plain words for the AI suggestion sentence. */
  captionWord: string;
  musicWord: string;
}

export const STYLE_PRESETS: StudioPreset[] = [
  {
    id: 'tiktok',
    emoji: '🔥',
    label: 'TikTok Viral',
    blurb: 'Big bold captions, punchy speed, warm upbeat energy.',
    captionStyle: 'tiktok',
    captionFontId: 'anton',
    grade: 'warm',
    musicStyle: 'uptempo',
    musicBedId: 'energetic',
    ramp: { enabled: true, curve: 'punch', intensity: 0.55 },
    vhs: false,
    captionWord: 'Bold TikTok',
    musicWord: 'Upbeat',
  },
  {
    id: 'cinematic',
    emoji: '🎬',
    label: 'Cinematic',
    blurb: 'Filmic colour, calm captions, orchestral score.',
    captionStyle: 'cinematic',
    captionFontId: 'playfair',
    grade: 'cinematic',
    musicStyle: 'cinematic',
    musicBedId: 'cinematic-dark',
    ramp: { enabled: true, curve: 'easeOut', intensity: 0.35 },
    vhs: false,
    captionWord: 'Cinematic',
    musicWord: 'Orchestral',
  },
  {
    id: 'minimal',
    emoji: '⚪',
    label: 'Minimal',
    blurb: 'Clean type, true colour, quiet ambient bed.',
    captionStyle: 'minimal',
    captionFontId: 'inter',
    grade: 'none',
    musicStyle: 'ambient',
    musicBedId: 'calm',
    ramp: { enabled: false },
    vhs: false,
    captionWord: 'Clean minimal',
    musicWord: 'Ambient',
  },
  {
    id: 'vhs',
    emoji: '📼',
    label: '90s VHS',
    blurb: 'Retro tape texture, faded colour, playful soundtrack.',
    captionStyle: 'bold',
    captionFontId: 'bebas',
    grade: 'vintage',
    musicStyle: 'playful',
    musicBedId: 'inspiring',
    ramp: { enabled: true, curve: 'easeIn', intensity: 0.3 },
    vhs: true,
    captionWord: 'Retro bold',
    musicWord: 'Playful',
  },
  {
    id: 'corporate',
    emoji: '💼',
    label: 'Corporate Clean',
    blurb: 'Cool neutral grade, tidy captions, understated music.',
    captionStyle: 'minimal',
    captionFontId: 'montserrat',
    grade: 'cool',
    musicStyle: 'ambient',
    musicBedId: 'luxury',
    ramp: { enabled: false },
    vhs: false,
    captionWord: 'Tidy corporate',
    musicWord: 'Understated',
  },
];

/** The three cards on the empty state. Each one also fixes the output format. */
export const SAMPLE_USES: StudioPreset[] = [
  {
    ...STYLE_PRESETS[0],
    id: 'sample-tiktok',
    emoji: '📱',
    label: 'Make a TikTok',
    blurb: 'Vertical 9:16, bold captions, upbeat music.',
    aspect: '9:16',
  },
  {
    ...STYLE_PRESETS[1],
    id: 'sample-ad',
    emoji: '🛍️',
    label: 'Make a Product Ad',
    blurb: 'Tall 4:5 feed ad with a filmic look.',
    aspect: '4:5',
    captionStyle: 'bold',
    captionFontId: 'montserrat',
    captionWord: 'Bold product',
  },
  {
    ...STYLE_PRESETS[0],
    id: 'sample-reel',
    emoji: '🎞️',
    label: 'Make a Reel',
    blurb: 'Vertical 9:16 with bright captions and pop music.',
    aspect: '9:16',
    captionStyle: 'neon',
    captionFontId: 'bebas',
    grade: 'cool',
    musicStyle: 'playful',
    musicBedId: 'inspiring',
    captionWord: 'Bright neon',
    musicWord: 'Pop',
  },
];

export function presetById(id: string): StudioPreset | null {
  return STYLE_PRESETS.find((p) => p.id === id)
    || SAMPLE_USES.find((p) => p.id === id)
    || null;
}

function withRamp(clip: StudioClip, ramp: Partial<SpeedRamp>): StudioClip {
  const motion = clipMotion(clip);
  return { ...clip, motion: { ...motion, ramp: { ...motion.ramp, ...ramp } } };
}

/** Fold a preset into the document. Pure — it never starts a paid job. */
export function applyPreset(doc: EditDoc, preset: StudioPreset): EditDoc {
  return {
    ...doc,
    aspect: preset.aspect || doc.aspect,
    grade: preset.grade,
    captionSettings: {
      ...doc.captionSettings,
      styleId: preset.captionStyle,
      fontId: preset.captionFontId,
    },
    musicStyle: preset.musicStyle,
    // A score the creator already generated outranks the preset's stock bed.
    musicBedId: doc.musicUrl ? doc.musicBedId : preset.musicBedId,
    vfx: { ...doc.vfx, vhs: { ...doc.vfx.vhs, enabled: preset.vhs } },
    clips: doc.clips.map((c) => withRamp(c, preset.ramp)),
  };
}

/** Which look matches what the vision pass saw in the footage. */
export function suggestedPreset(profile: SubjectProfile | null): StudioPreset {
  const mood: SubjectMood = profile?.mood || 'energetic';
  if (mood === 'dramatic') return STYLE_PRESETS[1];
  if (mood === 'calm') return STYLE_PRESETS[2];
  if (mood === 'playful') return STYLE_PRESETS[3];
  return STYLE_PRESETS[0];
}

/** The one-line sentence shown in the auto-suggest banner under the preview. */
export function suggestionSentence(preset: StudioPreset, profile: SubjectProfile | null): string {
  const because = profile ? ` for this ${profile.mood} clip` : ' for this clip';
  return `${preset.captionWord} captions + ${preset.musicWord} music${because}`;
}
