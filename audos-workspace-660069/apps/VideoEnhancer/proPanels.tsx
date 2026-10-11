/**
 * Vidverge Pro — the right-hand control panel.
 *
 * Six tabs, no nested navigation: Effects, Presets, Text, Motion, Color and
 * Audio. Every control in here writes straight into the EditDoc, which is the
 * same object the preview renders and the export serialises — so there is no
 * such thing as a setting that looks applied but does not ship.
 *
 * Where the platform render service genuinely cannot do something (such as
 * stabilisation or audio de-noising) the control says so instead of offering
 * a switch that moves and changes nothing.
 */
import { useMemo, useState } from 'react';
import {
  AudioLines, Check, Download, Eraser, Gauge, Loader2, Mic, Music2, Plus,
  RotateCcw, Save, Sparkles, SplitSquareHorizontal, Trash2, Wand2,
} from 'lucide-react';
import {
  Adjust, CAPTION_ANIMATIONS, CAPTION_BACKGROUNDS, CAPTION_FONTS, CaptionSettings,
  EditDoc, ENTRANCE_ANIMS, EXIT_ANIMS, GRADES, GradeId, MusicStyleId, StudioClip,
  TextLayer, VISUAL_EFFECTS, VisualEffectId, clampN, clipMotion, newTextLayer,
} from './studioModel';
import { MUSIC_BEDS } from './nleCore';
import { Field, Pills, Section, Slider, Toggle } from './proUi';

export type ProTabId = 'effects' | 'presets' | 'text' | 'motion' | 'color' | 'audio';

export const PRO_TABS: { id: ProTabId; label: string }[] = [
  { id: 'effects', label: 'Effects' },
  { id: 'presets', label: 'Presets' },
  { id: 'text', label: 'Text' },
  { id: 'motion', label: 'Motion' },
  { id: 'color', label: 'Color' },
  { id: 'audio', label: 'Audio' },
];

// ===========================================================================
// Looks — the Effects tab's filter grid
// ===========================================================================

export type LookCategory = 'cinematic' | 'retro' | 'modern' | 'minimal';

export interface Look {
  id: string;
  label: string;
  category: LookCategory;
  grade: GradeId;
  effects: VisualEffectId[];
  /** Deltas from neutral (100) at full intensity. */
  adjust: { brightness: number; contrast: number; saturation: number };
  swatch: string;
  /** Preview filter for the thumbnail chip only. */
  chip: string;
}

/**
 * Twelve looks, each expressed only in terms the renderer already honours: a
 * colour grade, the global effect stack, and the per-clip brightness /
 * contrast / saturation trims. Nothing here is a preview-only filter.
 */
export const LOOKS: Look[] = [
  { id: 'cinematic', label: 'Cinematic', category: 'cinematic', grade: 'cinematic', effects: ['vignette'], adjust: { brightness: 0, contrast: 6, saturation: 4 }, swatch: 'linear-gradient(135deg,#0F2840,#D29B62)', chip: 'contrast(1.12) saturate(1.22)' },
  { id: 'warm', label: 'Warm', category: 'modern', grade: 'warm', effects: [], adjust: { brightness: 3, contrast: 2, saturation: 8 }, swatch: 'linear-gradient(135deg,#7C2D12,#F59E0B)', chip: 'sepia(.18) saturate(1.24)' },
  { id: 'cool', label: 'Cool', category: 'modern', grade: 'cool', effects: [], adjust: { brightness: 2, contrast: 4, saturation: 4 }, swatch: 'linear-gradient(135deg,#0C4A6E,#67E8F9)', chip: 'saturate(1.1) hue-rotate(-12deg)' },
  { id: 'matte', label: 'Matte', category: 'minimal', grade: 'none', effects: ['vignette'], adjust: { brightness: 4, contrast: -9, saturation: -13 }, swatch: 'linear-gradient(135deg,#3F3F46,#A1A1AA)', chip: 'contrast(.92) saturate(.87) brightness(1.04)' },
  { id: 'bw', label: 'B&W', category: 'cinematic', grade: 'bw', effects: [], adjust: { brightness: 0, contrast: 8, saturation: 0 }, swatch: 'linear-gradient(135deg,#09090B,#D4D4D8)', chip: 'grayscale(1) contrast(1.16)' },
  { id: 'vivid', label: 'Vivid', category: 'modern', grade: 'none', effects: [], adjust: { brightness: 2, contrast: 12, saturation: 38 }, swatch: 'linear-gradient(135deg,#DB2777,#D97706 48%,#06B6D4)', chip: 'saturate(1.42) contrast(1.1)' },
  { id: 'fade', label: 'Fade', category: 'minimal', grade: 'none', effects: [], adjust: { brightness: 7, contrast: -13, saturation: -16 }, swatch: 'linear-gradient(135deg,#6B7280,#E5E7EB)', chip: 'contrast(.87) brightness(1.07) saturate(.84)' },
  { id: 'neon', label: 'Neon', category: 'modern', grade: 'cool', effects: ['bloom'], adjust: { brightness: 2, contrast: 10, saturation: 42 }, swatch: 'linear-gradient(135deg,#D97706,#22D3EE)', chip: 'saturate(1.5) contrast(1.12) hue-rotate(-12deg)' },
  { id: 'grain', label: 'Film Grain', category: 'cinematic', grade: 'cinematic', effects: ['filmGrain'], adjust: { brightness: 0, contrast: 4, saturation: 0 }, swatch: 'linear-gradient(135deg,#1C1917,#78716C)', chip: 'contrast(1.1) saturate(1.1)' },
  { id: 'vignette', label: 'Vignette', category: 'cinematic', grade: 'none', effects: ['vignette'], adjust: { brightness: 0, contrast: 5, saturation: 0 }, swatch: 'radial-gradient(circle at 50% 50%,#A8A29E,#0C0A09 78%)', chip: 'contrast(1.05)' },
  { id: 'retro', label: 'Retro', category: 'retro', grade: 'vintage', effects: ['lightLeak'], adjust: { brightness: 4, contrast: -5, saturation: -8 }, swatch: 'linear-gradient(135deg,#4D3C2A,#D6B889)', chip: 'sepia(.3) saturate(.86) brightness(1.06)' },
  { id: 'lofi', label: 'Lo-Fi', category: 'retro', grade: 'vintage', effects: ['filmGrain', 'vignette'], adjust: { brightness: 2, contrast: -8, saturation: -12 }, swatch: 'linear-gradient(135deg,#44403C,#FCD34D)', chip: 'sepia(.3) saturate(.78) contrast(.92)' },
];

export const LOOK_CATEGORIES: { id: LookCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'retro', label: 'Retro' },
  { id: 'modern', label: 'Modern' },
  { id: 'minimal', label: 'Minimal' },
];

/** Apply a look at `strength` (0..1) to every clip plus the global stack. */
export function applyLook(doc: EditDoc, look: Look, strength: number): EditDoc {
  const k = clampN(strength, 0, 1);
  const nudge = (base: number, delta: number) => Math.round(clampN(base + delta * k, 0, 200));
  const effects = Array.from(new Set(k > 0.02 ? look.effects : []));
  return {
    ...doc,
    grade: k > 0.02 ? look.grade : 'none',
    globalEffects: effects,
    clips: doc.clips.map((c) => ({
      ...c,
      adjust: {
        ...c.adjust,
        brightness: nudge(100, look.adjust.brightness),
        contrast: nudge(100, look.adjust.contrast),
        saturation: nudge(100, look.adjust.saturation),
      },
    })),
  };
}

// ===========================================================================
// Full edit presets — the Presets tab
// ===========================================================================

export interface EditPreset {
  id: string;
  label: string;
  blurb: string;
  lookId: string;
  captionStyle: CaptionSettings['styleId'];
  captionFont: string;
  captionPosition: CaptionSettings['position'];
  uppercase: boolean;
  music: MusicStyleId;
  zoom: 'off' | 'in' | 'out';
  ramp: boolean;
}

export const EDIT_PRESETS: EditPreset[] = [
  { id: 'reels-pro', label: 'Reels Pro', blurb: 'Punchy grade, bold centre captions, push-in on every cut', lookId: 'vivid', captionStyle: 'tiktok', captionFont: 'anton', captionPosition: 'center', uppercase: true, music: 'uptempo', zoom: 'in', ramp: true },
  { id: 'vlog-classic', label: 'Vlog Classic', blurb: 'Warm natural colour, clean lower captions, easy pacing', lookId: 'warm', captionStyle: 'minimal', captionFont: 'inter', captionPosition: 'bottom', uppercase: false, music: 'playful', zoom: 'off', ramp: false },
  { id: 'cinematic-ad', label: 'Cinematic Ad', blurb: 'Teal-and-orange grade, vignette, slow pull-out, score bed', lookId: 'cinematic', captionStyle: 'cinematic', captionFont: 'playfair', captionPosition: 'bottom', uppercase: false, music: 'cinematic', zoom: 'out', ramp: false },
  { id: 'social-story', label: 'Social Story', blurb: 'Bright, high-contrast, big centred type for 9:16 stories', lookId: 'neon', captionStyle: 'bold', captionFont: 'montserrat', captionPosition: 'center', uppercase: true, music: 'uptempo', zoom: 'in', ramp: false },
  { id: 'product-showcase', label: 'Product Showcase', blurb: 'Clean matte grade, restrained captions, slow push-in', lookId: 'matte', captionStyle: 'minimal', captionFont: 'montserrat', captionPosition: 'bottom', uppercase: false, music: 'ambient', zoom: 'in', ramp: false },
  { id: 'minimal-clean', label: 'Minimal Clean', blurb: 'No grade, no effects, quiet typography — just the footage', lookId: 'fade', captionStyle: 'minimal', captionFont: 'inter', captionPosition: 'bottom', uppercase: false, music: 'none', zoom: 'off', ramp: false },
  { id: 'hype-edit', label: 'Hype Edit', blurb: 'Max saturation, karaoke captions, speed ramps and zoom slams', lookId: 'vivid', captionStyle: 'karaoke', captionFont: 'anton', captionPosition: 'center', uppercase: true, music: 'uptempo', zoom: 'in', ramp: true },
  { id: 'aesthetic-slow', label: 'Aesthetic Slow', blurb: 'Lo-fi grain, soft serif captions, ambient bed, slow drift', lookId: 'lofi', captionStyle: 'handwritten', captionFont: 'caveat', captionPosition: 'bottom', uppercase: false, music: 'ambient', zoom: 'out', ramp: false },
];

export function applyEditPreset(doc: EditDoc, preset: EditPreset): EditDoc {
  const look = LOOKS.find((l) => l.id === preset.lookId) || LOOKS[0];
  const graded = applyLook(doc, look, 1);
  return {
    ...graded,
    captionSettings: {
      ...graded.captionSettings,
      styleId: preset.captionStyle,
      fontId: preset.captionFont,
      position: preset.captionPosition,
      uppercase: preset.uppercase,
    },
    musicStyle: preset.music,
    ...(preset.music === 'none' ? { musicUrl: '', musicBedId: 'none' } : {}),
    clips: graded.clips.map((c) => {
      const m = clipMotion(c);
      return {
        ...c,
        motion: {
          ...m,
          zoomCut: { ...m.zoomCut, enabled: preset.zoom !== 'off', direction: preset.zoom === 'out' ? 'out' : 'in' },
          ramp: { ...m.ramp, enabled: preset.ramp },
        },
      };
    }),
  };
}

// ===========================================================================
// Motion presets — the Motion tab
// ===========================================================================

export type MotionKind = 'zoomIn' | 'zoomOut' | 'kenBurns' | 'panLeft' | 'panRight' | 'tiltUp' | 'parallax' | 'shake' | 'pulse' | 'none';

export const MOTION_PRESETS: { id: MotionKind; label: string; blurb: string; baked: boolean }[] = [
  { id: 'kenBurns', label: 'Ken Burns', blurb: 'Slow drift + 8% zoom', baked: false },
  { id: 'zoomIn', label: 'Push In', blurb: 'Steady scale up', baked: true },
  { id: 'zoomOut', label: 'Pull Out', blurb: 'Steady scale down', baked: true },
  { id: 'panLeft', label: 'Pan Left', blurb: 'Horizontal drift', baked: false },
  { id: 'panRight', label: 'Pan Right', blurb: 'Horizontal drift', baked: false },
  { id: 'tiltUp', label: 'Tilt Up', blurb: 'Vertical drift', baked: false },
  { id: 'parallax', label: 'Parallax', blurb: 'Zoom + opposing drift', baked: false },
  { id: 'shake', label: 'Shake', blurb: 'Handheld camera jitter', baked: true },
  { id: 'pulse', label: 'Pulse', blurb: 'Rhythmic scale breathing', baked: false },
  { id: 'none', label: 'None', blurb: 'Clear all motion', baked: true },
];

/** Build the keyframe track for one motion preset across `len` seconds. */
export function motionKeys(kind: MotionKind, len: number, amount: number): StudioClip['keyframes'] {
  const a = clampN(amount, 0, 1);
  const end = Math.max(0.3, len);
  const flat = { opacity: 1, scale: 1, x: 0, y: 0 };
  switch (kind) {
    case 'kenBurns':
      return [
        { t: 0, ...flat, scale: 1, x: -0.02 * a },
        { t: end, ...flat, scale: 1 + 0.1 * a, x: 0.02 * a, y: -0.015 * a },
      ];
    case 'panLeft':
      return [
        { t: 0, ...flat, scale: 1 + 0.08 * a, x: 0.07 * a },
        { t: end, ...flat, scale: 1 + 0.08 * a, x: -0.07 * a },
      ];
    case 'panRight':
      return [
        { t: 0, ...flat, scale: 1 + 0.08 * a, x: -0.07 * a },
        { t: end, ...flat, scale: 1 + 0.08 * a, x: 0.07 * a },
      ];
    case 'tiltUp':
      return [
        { t: 0, ...flat, scale: 1 + 0.08 * a, y: 0.07 * a },
        { t: end, ...flat, scale: 1 + 0.08 * a, y: -0.07 * a },
      ];
    case 'parallax':
      return [
        { t: 0, ...flat, scale: 1 + 0.14 * a, x: 0.05 * a, y: -0.03 * a },
        { t: end / 2, ...flat, scale: 1 + 0.04 * a, x: 0, y: 0 },
        { t: end, ...flat, scale: 1 + 0.14 * a, x: -0.05 * a, y: 0.03 * a },
      ];
    case 'pulse': {
      const keys: StudioClip['keyframes'] = [];
      const beats = Math.max(2, Math.round(end / 1.2));
      for (let i = 0; i <= beats; i += 1) {
        keys.push({ t: (end * i) / beats, ...flat, scale: i % 2 === 0 ? 1 : 1 + 0.06 * a });
      }
      return keys;
    }
    default:
      return [];
  }
}

// ===========================================================================
// Text style cards — the Text tab
// ===========================================================================

export const TEXT_STYLES: { id: string; label: string; blurb: string; make: (at: number) => TextLayer }[] = [
  {
    id: 'title',
    label: 'Title',
    blurb: 'Bold, centred, 2.5s',
    make: (at) => ({ ...newTextLayer(at, 2.5), text: 'YOUR TITLE', fontId: 'anton', size: 104, weight: 900, x: 0.5, y: 0.42, align: 'center', entrance: 'scalePop', exit: 'fadeOut' }),
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    blurb: 'Light, under the title',
    make: (at) => ({ ...newTextLayer(at, 3), text: 'Supporting line', fontId: 'inter', size: 46, weight: 600, x: 0.5, y: 0.56, align: 'center', entrance: 'fadeIn', exit: 'fadeOut' }),
  },
  {
    id: 'caption',
    label: 'Caption',
    blurb: 'Small, bottom-safe',
    make: (at) => ({ ...newTextLayer(at, 2.6), text: 'Caption line', fontId: 'inter', size: 38, weight: 700, x: 0.5, y: 0.84, align: 'center', entrance: 'slideUp', exit: 'fadeOut' }),
  },
  {
    id: 'kinetic',
    label: 'Kinetic',
    blurb: 'Typewriter reveal',
    make: (at) => ({ ...newTextLayer(at, 2.2), text: 'MOVES AS IT LANDS', fontId: 'bebas', size: 88, weight: 900, x: 0.5, y: 0.5, align: 'center', entrance: 'typewriter', exit: 'scaleDown', animDuration: 0.8 }),
  },
  {
    id: 'lower-third',
    label: 'Lower Third',
    blurb: 'Left-aligned name card',
    make: (at) => ({ ...newTextLayer(at, 4), text: 'Name · Role', fontId: 'montserrat', size: 44, weight: 800, x: 0.27, y: 0.8, align: 'left', entrance: 'slideRight', exit: 'slideOut' }),
  },
  {
    id: 'word-reveal',
    label: 'Word Reveal',
    blurb: 'Glitch-in statement',
    make: (at) => ({ ...newTextLayer(at, 2), text: 'ONE WORD', fontId: 'anton', size: 120, weight: 900, x: 0.5, y: 0.46, align: 'center', entrance: 'glitch', exit: 'fadeOut', animDuration: 0.4 }),
  },
];

/** The curated font set. Every entry renders identically in the export. */
const TEXT_FONTS = ['inter', 'playfair', 'bebas', 'montserrat', 'anton', 'oswald', 'caveat'];

// ===========================================================================
// The panel
// ===========================================================================

export interface ControlsProps {
  tab: ProTabId;
  doc: EditDoc;
  hasFootage: boolean;
  playhead: number;
  duration: number;
  selectedClipIds: string[];
  selectedTextId: string | null;
  activeLook: string;
  lookStrength: number;
  activePreset: string;
  /** Presets the creator saved on this device. */
  customPresets: EditPreset[];
  activeMotion: MotionKind | '';
  motionAmount: number;
  compareAB: boolean;
  captionsBusy: boolean;
  captionNote: string;
  musicBusy: boolean;
  musicNote: string;
  voBusy: boolean;
  voNote: string;
  bpm: number;
  patch: (fn: (d: EditDoc) => EditDoc) => void;
  commit: (fn: (d: EditDoc) => EditDoc) => void;
  onLook: (id: string, strength: number) => void;
  onPreset: (id: string) => void;
  onSavePreset: () => void;
  onMotion: (kind: MotionKind, amount: number) => void;
  onCompareAB: (v: boolean) => void;
  onSelectText: (id: string | null) => void;
  onGenerateCaptions: () => void;
  onRebuildCaptions: () => void;
  onDownloadSrt: () => void;
  onGenerateMusic: (style: MusicStyleId) => void;
  onVoiceover: (text: string, voice: string) => void;
  onBeatSync: () => void;
  onResetColor: () => void;
}

export default function ProControls(props: ControlsProps) {
  const { doc, tab } = props;
  const [lookCat, setLookCat] = useState<LookCategory | 'all'>('all');
  const [voText, setVoText] = useState('');
  const [voVoice, setVoVoice] = useState('alloy');

  const firstClip: StudioClip | null = doc.clips[0] || null;
  const adjust: Adjust = firstClip ? firstClip.adjust : {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    highlights: 0,
    shadows: 0,
    temperature: 0,
    tint: 0,
    speed: 1,
    reverse: false,
  };
  const selectedText = doc.textLayers.find((l) => l.id === props.selectedTextId) || null;
  const motion = firstClip ? clipMotion(firstClip) : null;

  const visibleLooks = useMemo(
    () => (lookCat === 'all' ? LOOKS : LOOKS.filter((l) => l.category === lookCat)),
    [lookCat],
  );

  const setAllAdjust = (p: Partial<Adjust>) => {
    props.patch((d) => ({ ...d, clips: d.clips.map((c) => ({ ...c, adjust: { ...c.adjust, ...p } })) }));
  };

  const setCaption = (p: Partial<CaptionSettings>) => {
    props.patch((d) => ({ ...d, captionSettings: { ...d.captionSettings, ...p } }));
  };

  const setText = (id: string, p: Partial<TextLayer>) => {
    props.patch((d) => ({ ...d, textLayers: d.textLayers.map((l) => (l.id === id ? { ...l, ...p } : l)) }));
  };

  // -------------------------------------------------------------- EFFECTS --
  if (tab === 'effects') {
    return (
      <>
        <Section title="Looks" hint={`${LOOKS.length} filters`}>
          <Pills
            options={LOOK_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
            value={lookCat}
            onPick={(id) => setLookCat(id)}
          />
          <div className="vp-grid c3">
            {visibleLooks.map((look) => {
              const on = props.activeLook === look.id;
              return (
                <button
                  key={look.id}
                  type="button"
                  className={`vp-tile${on ? ' on' : ''}`}
                  title={look.label}
                  onClick={() => props.onLook(look.id, props.lookStrength)}
                >
                  <span className="vp-swatch" style={{ background: look.swatch, filter: look.chip }}>
                    {on ? <span className="vp-check"><Check size={10} /></span> : null}
                  </span>
                  <span className="vp-tilelab">{look.label}</span>
                </button>
              );
            })}
          </div>
          {props.activeLook ? (
            <Slider
              label="Intensity"
              value={Math.round(props.lookStrength * 100)}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => props.onLook(props.activeLook, v / 100)}
            />
          ) : (
            <p className="vp-note">Pick a look to grade every clip at once. The intensity slider appears once one is active.</p>
          )}
        </Section>

        <Section title="Effect stack" hint="Whole video">
          <div className="vp-grid c2">
            {VISUAL_EFFECTS.map((fx) => {
              const on = doc.globalEffects.includes(fx.id);
              return (
                <button
                  key={fx.id}
                  type="button"
                  className={`vp-tile pad${on ? ' on' : ''}`}
                  title={fx.hint}
                  onClick={() => props.patch((d) => ({
                    ...d,
                    globalEffects: on ? d.globalEffects.filter((x) => x !== fx.id) : [...d.globalEffects, fx.id],
                  }))}
                >
                  <b style={{ fontSize: 11.5, display: 'block', color: on ? '#1A1000' : '#3D2800' }}>{fx.label}</b>
                  <small style={{ fontSize: 10, color: '#7A6030', lineHeight: 1.4 }}>{fx.hint}</small>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Chroma key" hint="Green screen">
          <Toggle
            label="Key out a background colour"
            hint="Heavier renders — budget extra time"
            checked={doc.chroma.enabled}
            onChange={(enabled) => props.patch((d) => ({ ...d, chroma: { ...d.chroma, enabled } }))}
          />
          {doc.chroma.enabled ? (
            <>
              <div className="vp-row">
                <input
                  className="vp-color"
                  type="color"
                  value={doc.chroma.color}
                  aria-label="Key colour"
                  onChange={(e) => props.patch((d) => ({ ...d, chroma: { ...d.chroma, color: e.target.value } }))}
                />
                <input
                  className="vp-color"
                  type="color"
                  value={doc.chroma.backgroundColor}
                  aria-label="Replacement colour"
                  onChange={(e) => props.patch((d) => ({ ...d, chroma: { ...d.chroma, background: 'color', backgroundColor: e.target.value } }))}
                />
                <span className="vp-note">Key colour · replacement</span>
              </div>
              <Slider label="Tolerance" value={Math.round(doc.chroma.tolerance * 100)} min={5} max={95} suffix="%"
                onChange={(v) => props.patch((d) => ({ ...d, chroma: { ...d.chroma, tolerance: v / 100 } }))} />
              <Slider label="Edge softness" value={Math.round(doc.chroma.softness * 100)} min={0} max={100} suffix="%"
                onChange={(v) => props.patch((d) => ({ ...d, chroma: { ...d.chroma, softness: v / 100 } }))} />
              <Slider label="Spill removal" value={Math.round(doc.chroma.spill * 100)} min={0} max={100} suffix="%"
                onChange={(v) => props.patch((d) => ({ ...d, chroma: { ...d.chroma, spill: v / 100 } }))} />
            </>
          ) : null}
        </Section>
      </>
    );
  }

  // -------------------------------------------------------------- PRESETS --
  if (tab === 'presets') {
    return (
      <>
        <Section title="Full edit presets" hint="One tap">
          <p className="vp-note">
            Each preset sets the grade, the effect stack, caption design, music mood and per-clip motion together.
            The preview updates immediately — undo puts everything back.
          </p>
          <div className="vp-grid c2">
            {EDIT_PRESETS.map((p) => {
              const look = LOOKS.find((l) => l.id === p.lookId) || LOOKS[0];
              const on = props.activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`vp-tile${on ? ' on' : ''}`}
                  title={p.blurb}
                  disabled={!props.hasFootage}
                  onClick={() => props.onPreset(p.id)}
                >
                  <span className="vp-swatch" style={{ background: look.swatch, filter: look.chip, aspectRatio: '16/7' }}>
                    {on ? <span className="vp-check"><Check size={10} /></span> : null}
                  </span>
                  <span className="vp-tilelab">{p.label}</span>
                  <span className="vp-tilesub">{p.blurb}</span>
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="Your presets" hint="Saved in this browser">
          {props.customPresets.length ? (
            <div className="vp-grid c2">
              {props.customPresets.map((p) => {
                const look = LOOKS.find((l) => l.id === p.lookId) || LOOKS[0];
                const on = props.activePreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`vp-tile${on ? ' on' : ''}`}
                    onClick={() => props.onPreset(p.id)}
                    disabled={!props.hasFootage}
                  >
                    <span className="vp-swatch" style={{ background: look.swatch, filter: look.chip, aspectRatio: '16/7' }}>
                      {on ? <span className="vp-check"><Check size={10} /></span> : null}
                    </span>
                    <span className="vp-tilelab">{p.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <button type="button" className="vp-btn block" onClick={props.onSavePreset} disabled={!props.hasFootage}>
            <Save size={13} /> Save current settings as a preset
          </button>
          <p className="vp-note">
            Captures the grade, effects, caption design, music mood and motion, and keeps it on this device so the
            next edit can start from the same place.
          </p>
        </Section>
      </>
    );
  }

  // ----------------------------------------------------------------- TEXT --
  if (tab === 'text') {
    return (
      <>
        <Section title="Add text" hint="Drops at the playhead">
          <div className="vp-grid c3">
            {TEXT_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="vp-tile pad"
                title={s.blurb}
                disabled={!props.hasFootage}
                onClick={() => {
                  const layer = s.make(props.playhead);
                  props.commit((d) => ({ ...d, textLayers: [...d.textLayers, layer] }));
                  props.onSelectText(layer.id);
                }}
              >
                <b style={{ fontSize: 11, display: 'block', color: '#1A1000' }}>{s.label}</b>
                <small style={{ fontSize: 9.5, color: '#7A6030' }}>{s.blurb}</small>
              </button>
            ))}
          </div>
          {doc.textLayers.length ? (
            <div className="vp-pills">
              {doc.textLayers.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`vp-pill${props.selectedTextId === l.id ? ' on' : ''}`}
                  onClick={() => props.onSelectText(l.id)}
                >
                  {l.text.slice(0, 16) || 'Text'}
                </button>
              ))}
            </div>
          ) : null}
        </Section>

        {selectedText ? (
          <Section
            title="Selected layer"
            right={(
              <button
                type="button"
                className="vp-ico sm"
                title="Delete this text layer"
                onClick={() => {
                  props.commit((d) => ({ ...d, textLayers: d.textLayers.filter((l) => l.id !== selectedText.id) }));
                  props.onSelectText(null);
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
          >
            <Field label="Text">
              <textarea
                className="vp-area"
                value={selectedText.text}
                onChange={(e) => setText(selectedText.id, { text: e.target.value })}
              />
            </Field>
            <Field label="Font">
              <select
                className="vp-select"
                value={selectedText.fontId}
                onChange={(e) => setText(selectedText.id, { fontId: e.target.value })}
              >
                {CAPTION_FONTS.filter((f) => TEXT_FONTS.includes(f.id)).map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </Field>
            <Slider label="Size" value={selectedText.size} min={18} max={200} suffix="px"
              onChange={(v) => setText(selectedText.id, { size: v })} onCommit={() => props.commit((d) => d)} />
            <div className="vp-row">
              <input className="vp-color" type="color" value={selectedText.color} aria-label="Text colour"
                onChange={(e) => setText(selectedText.id, { color: e.target.value })} />
              <input className="vp-color" type="color" value={selectedText.outlineColor} aria-label="Outline colour"
                onChange={(e) => setText(selectedText.id, { outlineColor: e.target.value })} />
              <span className="vp-note">Fill · outline</span>
            </div>
            <Slider label="Outline" value={selectedText.outlineWidth} min={0} max={12} suffix="px"
              onChange={(v) => setText(selectedText.id, { outlineWidth: v })} />
            <Slider label="Shadow" value={selectedText.shadowBlur} min={0} max={60} suffix="px"
              onChange={(v) => setText(selectedText.id, { shadowBlur: v })} />
            <div className="vp-row">
              <div style={{ flex: 1 }}>
                <Field label="Animate in">
                  <select className="vp-select" value={selectedText.entrance}
                    onChange={(e) => setText(selectedText.id, { entrance: e.target.value as TextLayer['entrance'] })}>
                    {ENTRANCE_ANIMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Animate out">
                  <select className="vp-select" value={selectedText.exit}
                    onChange={(e) => setText(selectedText.id, { exit: e.target.value as TextLayer['exit'] })}>
                    {EXIT_ANIMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <div className="vp-row">
              <div style={{ flex: 1 }}>
                <Field label="Start (s)">
                  <input className="vp-input" type="number" step="0.1" min={0} value={selectedText.start.toFixed(1)}
                    onChange={(e) => {
                      const start = Math.max(0, Number(e.target.value) || 0);
                      setText(selectedText.id, { start, end: start + Math.max(0.4, selectedText.end - selectedText.start) });
                    }} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Duration (s)">
                  <input className="vp-input" type="number" step="0.1" min={0.4}
                    value={(selectedText.end - selectedText.start).toFixed(1)}
                    onChange={(e) => setText(selectedText.id, { end: selectedText.start + Math.max(0.4, Number(e.target.value) || 1) })} />
                </Field>
              </div>
            </div>
            <Pills
              options={[{ id: 'left', label: 'Left' }, { id: 'center', label: 'Centre' }, { id: 'right', label: 'Right' }]}
              value={selectedText.align}
              onPick={(id) => setText(selectedText.id, { align: id as TextLayer['align'] })}
            />
          </Section>
        ) : null}

        <Section
          title="Spoken captions"
          hint={doc.captions.length ? `${doc.captions.length} lines` : 'Not built yet'}
        >
          <div className="vp-row">
            <button type="button" className="vp-btn primary" disabled={!props.hasFootage || props.captionsBusy}
              onClick={props.onGenerateCaptions}>
              {props.captionsBusy ? <Loader2 size={13} className="vp-spin" /> : <Wand2 size={13} />}
              {doc.captions.length ? 'Re-transcribe' : 'Generate captions'}
            </button>
            <button type="button" className="vp-btn" disabled={!doc.words.length} onClick={props.onRebuildCaptions}>
              Rebuild lines
            </button>
          </div>
          {props.captionNote ? <p className="vp-note">{props.captionNote}</p> : null}
          <Field label="Caption style">
            <select className="vp-select" value={doc.captionSettings.styleId}
              onChange={(e) => setCaption({ styleId: e.target.value as CaptionSettings['styleId'] })}>
              {['minimal', 'bold', 'gradient', 'karaoke', 'tiktok', 'neon', 'cinematic', 'handwritten'].map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </Field>
          <Field label="Font">
            <select className="vp-select" value={doc.captionSettings.fontId}
              onChange={(e) => setCaption({ fontId: e.target.value })}>
              {CAPTION_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </Field>
          <Slider label="Size" value={Math.round(doc.captionSettings.sizeScale * 100)} min={60} max={180} suffix="%"
            onChange={(v) => setCaption({ sizeScale: v / 100 })} />
          <div className="vp-row">
            <input className="vp-color" type="color" value={doc.captionSettings.color} aria-label="Caption colour"
              onChange={(e) => setCaption({ color: e.target.value })} />
            <input className="vp-color" type="color" value={doc.captionSettings.activeColor} aria-label="Spoken-word colour"
              onChange={(e) => setCaption({ activeColor: e.target.value })} />
            <span className="vp-note">Fill · spoken word</span>
          </div>
          <Field label="Background chip">
            <select className="vp-select" value={doc.captionSettings.background}
              onChange={(e) => setCaption({ background: e.target.value as CaptionSettings['background'] })}>
              {CAPTION_BACKGROUNDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </Field>
          {doc.captionSettings.background !== 'none' && doc.captionSettings.background !== 'preset' ? (
            <Slider label="Chip opacity" value={Math.round(doc.captionSettings.backgroundOpacity * 100)} min={0} max={100} suffix="%"
              onChange={(v) => setCaption({ backgroundOpacity: v / 100 })} />
          ) : null}
          <Field label="Reveal">
            <select className="vp-select" value={doc.captionSettings.animation}
              onChange={(e) => setCaption({ animation: e.target.value as CaptionSettings['animation'] })}>
              {CAPTION_ANIMATIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </Field>
          <Pills
            options={[{ id: 'top', label: 'Top' }, { id: 'center', label: 'Middle' }, { id: 'bottom', label: 'Bottom' }]}
            value={doc.captionSettings.position}
            onPick={(id) => setCaption({ position: id as CaptionSettings['position'] })}
          />
          <Toggle label="UPPERCASE" checked={doc.captionSettings.uppercase} onChange={(uppercase) => setCaption({ uppercase })} />
          <Toggle label="Burn into the video" hint="Off exports a separate .srt file instead"
            checked={doc.captionSettings.burnIn} onChange={(burnIn) => setCaption({ burnIn })} />
          <button type="button" className="vp-btn block" disabled={!doc.captions.length} onClick={props.onDownloadSrt}>
            <Download size={13} /> Download .srt
          </button>
        </Section>
      </>
    );
  }

  // --------------------------------------------------------------- MOTION --
  if (tab === 'motion') {
    return (
      <>
        <Section title="Motion presets" hint="Applies to every clip">
          <div className="vp-grid c3">
            {MOTION_PRESETS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`vp-tile pad${props.activeMotion === m.id ? ' on' : ''}`}
                title={m.blurb}
                disabled={!props.hasFootage}
                onClick={() => props.onMotion(m.id, props.motionAmount)}
              >
                <b style={{ fontSize: 10.5, display: 'block', color: '#1A1000' }}>{m.label}</b>
                <small style={{ fontSize: 9.5, color: '#7A6030' }}>{m.blurb}</small>
              </button>
            ))}
          </div>
          <Slider
            label="Amount"
            value={Math.round(props.motionAmount * 100)}
            min={10}
            max={100}
            suffix="%"
            disabled={!props.activeMotion}
            onChange={(v) => props.onMotion((props.activeMotion || 'kenBurns') as MotionKind, v / 100)}
          />
          <p className="vp-note">
            Push In, Pull Out and Shake are baked by the render service. Ken Burns, the pans, Parallax and Pulse are
            written as clip keyframes — you can see them on the VIDEO track as diamonds, and they travel with the
            render request.
          </p>
        </Section>

        {motion ? (
          <>
            <Section title="Speed ramp" hint="Same length, different pace">
              <Toggle
                label="Ramp the speed through each clip"
                hint="Fast → slow → fast, without changing the clip's length"
                checked={motion.ramp.enabled}
                onChange={(enabled) => props.patch((d) => ({
                  ...d,
                  clips: d.clips.map((c) => {
                    const m = clipMotion(c);
                    return { ...c, motion: { ...m, ramp: { ...m.ramp, enabled } } };
                  }),
                }))}
              />
              {motion.ramp.enabled ? (
                <>
                  <Pills
                    options={[
                      { id: 'punch', label: 'S-curve' },
                      { id: 'easeIn', label: 'Ease in' },
                      { id: 'easeOut', label: 'Ease out' },
                    ]}
                    value={motion.ramp.curve === 'custom' ? 'punch' : motion.ramp.curve}
                    onPick={(curve) => props.patch((d) => ({
                      ...d,
                      clips: d.clips.map((c) => {
                        const m = clipMotion(c);
                        return { ...c, motion: { ...m, ramp: { ...m.ramp, curve: curve as 'punch' } } };
                      }),
                    }))}
                  />
                  <Slider
                    label="Bend"
                    value={Math.round(motion.ramp.intensity * 100)}
                    min={10}
                    max={85}
                    suffix="%"
                    onChange={(v) => props.patch((d) => ({
                      ...d,
                      clips: d.clips.map((c) => {
                        const m = clipMotion(c);
                        return { ...c, motion: { ...m, ramp: { ...m.ramp, intensity: v / 100 } } };
                      }),
                    }))}
                  />
                </>
              ) : null}
              <Slider
                label="Playback speed"
                value={adjust.speed}
                min={0.25}
                max={4}
                step={0.05}
                format={(v) => `${v.toFixed(2)}x`}
                onCommit={() => props.commit((d) => d)}
                onChange={(speed) => setAllAdjust({ speed })}
              />
            </Section>

            <Section title="Camera shake" hint="Handheld energy">
              <Toggle
                label="Add camera shake"
                checked={motion.shake.enabled}
                onChange={(enabled) => props.patch((d) => ({
                  ...d,
                  clips: d.clips.map((c) => {
                    const m = clipMotion(c);
                    return { ...c, motion: { ...m, shake: { ...m.shake, enabled } } };
                  }),
                }))}
              />
              {motion.shake.enabled ? (
                <Slider
                  label="Shake intensity"
                  value={motion.shake.intensity}
                  min={5}
                  max={100}
                  suffix="%"
                  onChange={(v) => props.patch((d) => ({
                    ...d,
                    clips: d.clips.map((c) => {
                      const m = clipMotion(c);
                      return { ...c, motion: { ...m, shake: { ...m.shake, intensity: v } } };
                    }),
                  }))}
                />
              ) : null}
            </Section>
          </>
        ) : null}

        <Section title="Stabilisation" hint="Unavailable">
          <Toggle label="Stabilise shaky footage" hint="No stabiliser is exposed by the render service" checked={false} disabled onChange={() => undefined} />
          <p className="vp-note warn">
            The platform render service has no stabilisation pass, so this is switched off rather than shipped as a
            control that does nothing. Shake, speed ramps and zoom all work normally.
          </p>
        </Section>
      </>
    );
  }

  // ---------------------------------------------------------------- COLOR --
  if (tab === 'color') {
    return (
      <>
        <Section
          title="Adjustments"
          right={(
            <button type="button" className="vp-btn xs" onClick={props.onResetColor} title="Reset every colour control">
              <RotateCcw size={11} /> Reset
            </button>
          )}
        >
          <Slider label="Brightness" value={adjust.brightness} min={50} max={160} suffix="%" disabled={!props.hasFootage}
            onCommit={() => props.commit((d) => d)} onChange={(brightness) => setAllAdjust({ brightness })} />
          <Slider label="Contrast" value={adjust.contrast} min={50} max={160} suffix="%" disabled={!props.hasFootage}
            onCommit={() => props.commit((d) => d)} onChange={(contrast) => setAllAdjust({ contrast })} />
          <Slider label="Saturation" value={adjust.saturation} min={0} max={200} suffix="%" disabled={!props.hasFootage}
            onCommit={() => props.commit((d) => d)} onChange={(saturation) => setAllAdjust({ saturation })} />
          <Slider label="Highlights" value={adjust.highlights} min={-50} max={50} disabled={!props.hasFootage}
            onCommit={() => props.commit((d) => d)} onChange={(highlights) => setAllAdjust({ highlights })} />
          <Slider label="Shadows" value={adjust.shadows} min={-50} max={50} disabled={!props.hasFootage}
            onCommit={() => props.commit((d) => d)} onChange={(shadows) => setAllAdjust({ shadows })} />
          <Slider label="Temperature" value={adjust.temperature} min={-50} max={50} disabled={!props.hasFootage}
            onCommit={() => props.commit((d) => d)} onChange={(temperature) => setAllAdjust({ temperature })} />
          <Slider label="Tint" value={adjust.tint} min={-50} max={50} disabled={!props.hasFootage}
            onCommit={() => props.commit((d) => d)} onChange={(tint) => setAllAdjust({ tint })} />
          <p className="vp-note">
            Every adjustment travels with each clip and uses the same deterministic filter chain in preview and export.
          </p>
        </Section>

        <Section title="LUTs" hint="Colour grades">
          <div className="vp-grid c3">
            {GRADES.map((g) => {
              const on = doc.grade === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`vp-tile${on ? ' on' : ''}`}
                  onClick={() => props.commit((d) => ({ ...d, grade: g.id }))}
                  title={g.label}
                >
                  <span
                    className="vp-swatch"
                    style={{
                      aspectRatio: '1/1',
                      borderRadius: '50%',
                      margin: '8px auto 2px',
                      width: '62%',
                      background: 'conic-gradient(from 210deg,#EF4444,#F59E0B,#84CC16,#06B6D4,#6366F1,#EC4899,#EF4444)',
                      filter: g.css || 'none',
                    }}
                  >
                    {on ? <span className="vp-check"><Check size={10} /></span> : null}
                  </span>
                  <span className="vp-tilelab" style={{ textAlign: 'center' }}>{g.label}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Compare" hint="Before / after">
          <Toggle
            label="Split-screen A/B"
            hint="Left half is the ungraded source, right half is your edit"
            checked={props.compareAB}
            onChange={props.onCompareAB}
          />
          <button
            type="button"
            className="vp-btn block"
            onClick={() => props.onCompareAB(!props.compareAB)}
          >
            <SplitSquareHorizontal size={13} /> {props.compareAB ? 'Hide the comparison' : 'Show the comparison'}
          </button>
        </Section>
      </>
    );
  }

  // ---------------------------------------------------------------- AUDIO --
  return (
    <>
      <Section title="Mix" hint="Preview and export">
        <Slider
          label="Music level"
          value={Math.round(doc.musicVolume * 100)}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => props.patch((d) => ({ ...d, musicVolume: v / 100 }))}
        />
        <Toggle
          label="Mute the original audio"
          checked={doc.clips.length > 0 && doc.clips.every((c) => c.muted)}
          disabled={!props.hasFootage}
          onChange={(muted) => props.commit((d) => ({ ...d, clips: d.clips.map((c) => ({ ...c, muted })) }))}
        />
        <p className="vp-note">
          Cutaways duck the main track automatically while they are on screen; their own fade in / fade out live on the
          clip itself.
        </p>
      </Section>

      <Section title="Music library" hint={`${MUSIC_BEDS.length} beds`}>
        <div className="vp-grid c2">
          {MUSIC_BEDS.map((bed) => {
            const on = doc.musicBedId === bed.id && !doc.musicUrl;
            return (
              <button
                key={bed.id}
                type="button"
                className={`vp-tile pad${on ? ' on' : ''}`}
                onClick={() => props.commit((d) => ({ ...d, musicBedId: bed.id, musicUrl: '', musicStyle: 'none' }))}
              >
                <b style={{ fontSize: 11, display: 'block', color: '#1A1000' }}>
                  <Music2 size={10} style={{ marginRight: 4 }} />{bed.label}
                </b>
                <small style={{ fontSize: 9.5, color: '#7A6030' }}>Looping instrumental</small>
              </button>
            );
          })}
          <button
            type="button"
            className={`vp-tile pad${doc.musicBedId === 'none' && !doc.musicUrl ? ' on' : ''}`}
            onClick={() => props.commit((d) => ({ ...d, musicBedId: 'none', musicUrl: '', musicStyle: 'none' }))}
          >
            <b style={{ fontSize: 11, display: 'block', color: '#1A1000' }}>No music</b>
            <small style={{ fontSize: 9.5, color: '#7A6030' }}>Original audio only</small>
          </button>
        </div>
      </Section>

      <Section title="AI soundtrack" hint="Matched to the footage">
        <Pills
          options={[
            { id: 'auto', label: 'Auto' },
            { id: 'uptempo', label: 'Uptempo' },
            { id: 'ambient', label: 'Ambient' },
            { id: 'cinematic', label: 'Cinematic' },
            { id: 'playful', label: 'Playful' },
          ]}
          value={doc.musicStyle === 'none' ? null : doc.musicStyle}
          onPick={(id) => props.onGenerateMusic(id as MusicStyleId)}
        />
        {props.musicBusy ? (
          <p className="vp-note"><Loader2 size={11} className="vp-spin" /> Composing a bed for this footage…</p>
        ) : props.musicNote ? <p className="vp-note good">{props.musicNote}</p> : null}
        {doc.musicUrl ? (
          <>
            <audio src={doc.musicUrl} controls style={{ width: '100%', height: 30 }} />
            <button type="button" className="vp-btn block" onClick={() => props.onGenerateMusic(doc.musicStyle)}>
              <Sparkles size={13} /> Generate another take
            </button>
          </>
        ) : null}
      </Section>

      <Section title="Voiceover" hint="Text to speech">
        <Field label="Script">
          <textarea
            className="vp-area"
            placeholder="Type the line you want read over the video…"
            value={voText}
            onChange={(e) => setVoText(e.target.value)}
          />
        </Field>
        <Field label="Voice">
          <select className="vp-select" value={voVoice} onChange={(e) => setVoVoice(e.target.value)}>
            {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((v) => (
              <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="vp-btn primary block"
          disabled={props.voBusy || voText.trim().length < 2}
          onClick={() => props.onVoiceover(voText.trim(), voVoice)}
        >
          {props.voBusy ? <Loader2 size={13} className="vp-spin" /> : <Mic size={13} />}
          {props.voBusy ? 'Recording…' : 'Generate voiceover'}
        </button>
        {props.voNote ? <p className="vp-note">{props.voNote}</p> : null}
      </Section>

      <Section title="Beat sync" hint={props.bpm ? `${Math.round(props.bpm)} BPM` : 'Not measured'}>
        <button type="button" className="vp-btn block" disabled={!props.hasFootage} onClick={props.onBeatSync}>
          <AudioLines size={13} /> Detect the tempo and snap cuts to it
        </button>
        <p className="vp-note">
          Reads the onset tempo from the audio in your browser, then nudges each cut point onto the nearest beat.
        </p>
      </Section>

      <Section title="Silence" hint="Clean-up">
        <p className="vp-note">
          Dead air is marked on the AUDIO track. Use <b>Smart trim</b> in the agent drawer to cut every silent stretch
          in one pass, or <b>Remove fillers</b> to drop the ums and likes.
        </p>
        <p className="vp-note warn">
          <Eraser size={11} style={{ marginRight: 4 }} />
          Noise reduction is not offered: the render service exposes no de-noise pass, so a toggle here could not reach
          the exported file.
        </p>
      </Section>

      <Section title="Render budget" hint="Heads up">
        <p className="vp-note">
          <Gauge size={11} style={{ marginRight: 4 }} />
          Every audible cutaway, the chroma key and per-frame speed remapping all add render time. The export dialog
          shows the estimate before you spend anything.
        </p>
      </Section>
    </>
  );
}

/** The agent quick-actions block pinned under the tab content. */
export function AgentStrip(props: { onOpen: () => void; pending: number }) {
  return (
    <Section title="AI agent" hint="Hands-free editing">
      <button type="button" className="vp-btn primary block" onClick={props.onOpen}>
        <Sparkles size={13} /> Open the agent panel
      </button>
      <p className="vp-note">
        Auto-enhance, auto-caption, beat sync, smart trim and scene generation — each one reports what it changed and
        can be undone in a tap.
      </p>
      {props.pending ? (
        <p className="vp-note good">
          <Plus size={11} style={{ marginRight: 4 }} />
          {props.pending} suggestion{props.pending === 1 ? '' : 's'} waiting for review.
        </p>
      ) : null}
    </Section>
  );
}
