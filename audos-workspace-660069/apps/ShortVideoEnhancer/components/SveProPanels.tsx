/**
 * Short Video Enhancer — the right-hand control panel.
 *
 * Seven tabs: the six the Video Studio has, plus Shorts, which is where the
 * format-specific work lives (hooks, sound direction, the optimisation
 * checklist and pacing).
 *
 * Every control writes into the EditDoc, and the EditDoc is what the Remotion
 * composition is handed — so the grade, the camera move, the audio fades and
 * the loop treatment all reach the exported file, not just the preview. Where
 * the render service genuinely has no pass for something (stabilisation,
 * de-noise) the control says so instead of pretending.
 */
import { useMemo, useState, type ComponentType } from 'react';
import {
  AudioLines, Captions, Check, Crop, Film, Gauge, Languages, Layers, ListChecks, Loader2,
  Megaphone, Mic, Move, Music2, Palette, Repeat, RotateCcw, Save, Scissors,
  SlidersHorizontal, Sparkles, SplitSquareHorizontal, Sticker, Type, Volume2,
  Wand2, Waves, Zap,
} from 'lucide-react';
import {
  BROLL_LAYOUTS, CAPTION_LANGUAGES, CAPTION_PRESETS, FILTER_CATEGORIES, FILTER_GRADES,
  SHORT_ASPECTS, SVE_MOTION_PRESETS, type CaptionCue, type CaptionLanguage, type CaptionPreset,
  type CaptionTier, type CaptionTierMode, type CardKind, type EditDoc, type ShortAspect,
  type SveMotionKind,
} from '../lib/sveTypes';
import { TIER_LABELS } from '../lib/sveCaptionTiers';
import { Field, Pills, Slider, Toggle } from '../lib/sveProUi';
// Every group in this panel is a drop-down: the accordion owns its own open
// state, so a tab only declares which section starts open.
import { SveAccordion as Section } from './SveAccordion';
import SveTierPanel from './SveTierPanel';

export type SveTabId = 'effects' | 'presets' | 'text' | 'motion' | 'color' | 'audio' | 'shorts';

export const SVE_TABS: {
  id: SveTabId;
  label: string;
  icon: ComponentType<any>;
  tip: string;
}[] = [
  { id: 'effects', label: 'Effects', icon: Sparkles, tip: 'Captions, film grades and how B-roll sits in the frame' },
  { id: 'presets', label: 'Presets', icon: Layers, tip: 'One-tap looks that set grade, captions, motion and mix together' },
  { id: 'text', label: 'Text', icon: Type, tip: 'Graphic cards and the transcript' },
  { id: 'motion', label: 'Motion', icon: Move, tip: 'Camera moves, loop treatment and the preview aspect' },
  { id: 'color', label: 'Color', icon: Palette, tip: 'Exposure, colour balance, LUTs and the before/after compare' },
  { id: 'audio', label: 'Audio', icon: Volume2, tip: 'Mix levels, music bed, voiceover and beat sync' },
  { id: 'shorts', label: 'Shorts', icon: Film, tip: 'Short-form checklist, hooks, CTAs and pacing' },
];

// ===========================================================================
// Full edit presets
// ===========================================================================

export interface ShortPreset {
  id: string;
  label: string;
  blurb: string;
  filter: string;
  captionPreset: CaptionPreset;
  accent: string;
  uppercase: boolean;
  posY: number;
  wordsPerCue: number;
  motion: SveMotionKind;
  motionAmount: number;
  musicLevel: number;
  loop: boolean;
}

export const SHORT_PRESETS: ShortPreset[] = [
  { id: 'reels-pro', label: 'Reels Pro', blurb: 'Vivid grade, bold centre captions, push-in', filter: 'Vivid', captionPreset: 'bold', accent: '#A855F7', uppercase: true, posY: 0.68, wordsPerCue: 3, motion: 'pushIn', motionAmount: 0.6, musicLevel: 30, loop: true },
  { id: 'vlog-classic', label: 'Vlog Classic', blurb: 'Warm and natural, captions low and calm', filter: 'Warm', captionPreset: 'outline', accent: '#F59E0B', uppercase: false, posY: 0.8, wordsPerCue: 4, motion: 'none', motionAmount: 0.4, musicLevel: 18, loop: false },
  { id: 'cinematic-ad', label: 'Cinematic Ad', blurb: 'Teal-and-amber grade with a slow pull-out', filter: 'Cinematic', captionPreset: 'gradient', accent: '#38BDF8', uppercase: false, posY: 0.78, wordsPerCue: 4, motion: 'pullOut', motionAmount: 0.5, musicLevel: 34, loop: false },
  { id: 'social-story', label: 'Social Story', blurb: 'Neon pop, boxed captions dead centre', filter: 'Neon', captionPreset: 'boxed', accent: '#22D3EE', uppercase: true, posY: 0.56, wordsPerCue: 2, motion: 'kenBurns', motionAmount: 0.6, musicLevel: 28, loop: true },
  { id: 'product-showcase', label: 'Product Showcase', blurb: 'Clean matte grade, restrained type, slow push', filter: 'Matte', captionPreset: 'outline', accent: '#FFFFFF', uppercase: false, posY: 0.82, wordsPerCue: 4, motion: 'pushIn', motionAmount: 0.35, musicLevel: 22, loop: false },
  { id: 'minimal-clean', label: 'Minimal Clean', blurb: 'No grade, no motion — just the footage', filter: 'None', captionPreset: 'outline', accent: '#FFFFFF', uppercase: false, posY: 0.82, wordsPerCue: 4, motion: 'none', motionAmount: 0.3, musicLevel: 0, loop: false },
  { id: 'hype-edit', label: 'Hype Edit', blurb: 'Max saturation, two-word captions, pulse on the beat', filter: 'Vivid', captionPreset: 'bold', accent: '#F43F5E', uppercase: true, posY: 0.62, wordsPerCue: 2, motion: 'pulse', motionAmount: 0.8, musicLevel: 40, loop: true },
  { id: 'aesthetic-slow', label: 'Aesthetic Slow', blurb: 'Lo-fi grade, soft gradient captions, slow drift', filter: 'Lo-Fi', captionPreset: 'gradient', accent: '#C4B5FD', uppercase: false, posY: 0.76, wordsPerCue: 3, motion: 'parallax', motionAmount: 0.45, musicLevel: 32, loop: true },
];

// ===========================================================================
// Shorts tab content
// ===========================================================================

export const VIRAL_HOOKS: { title: string; subtitle: string }[] = [
  { title: 'STOP SCROLLING', subtitle: 'This takes 20 seconds' },
  { title: 'NOBODY TELLS YOU THIS', subtitle: '' },
  { title: 'I TRIED IT SO YOU DO NOT HAVE TO', subtitle: '' },
  { title: 'WATCH TILL THE END', subtitle: 'The last one is the best' },
  { title: '3 THINGS I WISH I KNEW', subtitle: '' },
  { title: 'THIS CHANGED EVERYTHING', subtitle: '' },
  { title: 'DO NOT MAKE THIS MISTAKE', subtitle: '' },
  { title: 'HERE IS THE PART THEY SKIP', subtitle: '' },
];

export const CTA_LINES: { title: string; subtitle: string }[] = [
  { title: 'FOLLOW FOR MORE', subtitle: 'New shorts every week' },
  { title: 'SAVE THIS', subtitle: 'You will want it later' },
  { title: 'LINK IN BIO', subtitle: '' },
  { title: 'COMMENT YOUR TAKE', subtitle: '' },
];

/**
 * Sound directions, not a trending chart. These are music briefs the
 * generator can actually act on — claiming to know what is trending on a
 * platform today would be a number nobody here can verify.
 */
export const SOUND_DIRECTIONS: { id: string; label: string; prompt: string }[] = [
  { id: 'phonk', label: 'Phonk', prompt: 'dark phonk beat, distorted 808 cowbell, heavy sub bass, 140 BPM, driving and hypnotic, no vocals' },
  { id: 'lofi', label: 'Lo-fi', prompt: 'warm lo-fi hip hop, dusty vinyl crackle, mellow rhodes chords, soft swung drums, 82 BPM, no vocals' },
  { id: 'trap', label: 'Trap', prompt: 'modern trap instrumental, rolling hi-hats, deep 808 glide, sparse dark keys, 146 BPM, no vocals' },
  { id: 'build', label: 'Cinematic Build', prompt: 'cinematic build, low strings swelling into a braam, rising percussion, one hit at the climax, 90 BPM, no vocals' },
  { id: 'pop', label: 'Upbeat Pop', prompt: 'bright pop-electronic, plucked synth hook, crisp claps, confident four-on-the-floor, 118 BPM, no vocals' },
  { id: 'ambient', label: 'Ambient', prompt: 'soft ambient pad, gentle arpeggio, no drums, wide reverb, calm and spacious, 70 BPM, no vocals' },
  { id: 'funk', label: 'Funk', prompt: 'tight funk groove, slap bass, clean guitar skank, live drums, playful, 104 BPM, no vocals' },
  { id: 'drill', label: 'Drill', prompt: 'UK drill instrumental, sliding 808s, icy bell melody, syncopated hats, 142 BPM, no vocals' },
];

// ===========================================================================
// Panel
// ===========================================================================

export interface SvePanelProps {
  tab: SveTabId;
  doc: EditDoc;
  hasSource: boolean;
  currentTime: number;
  activePreset: string;
  compareAB: boolean;
  captionsBusy: boolean;
  musicPhase: 'idle' | 'briefing' | 'generating';
  musicNote: string;
  voBusy: boolean;
  voNote: string;
  beatBusy: boolean;
  customPresets: ShortPreset[];
  checklist: { id: string; label: string; done: boolean; hint: string; fix?: () => void }[];
  /** How the cue list actually split across the five treatments. */
  captionTiers: { tier: CaptionTier; count: number }[];
  /** The resolved cue list — exactly what the preview is drawing. */
  cues: CaptionCue[];
  update: (fn: (d: EditDoc) => EditDoc, tag?: string) => void;
  onCaptionLanguage: (language: CaptionLanguage) => void;
  onTierMode: (mode: CaptionTierMode) => void;
  onSetCueTier: (key: string, tier: CaptionTier | null) => void;
  onSetCueEmphasis: (key: string, index: number | null) => void;
  onResetCueTiers: () => void;
  onSeek: (t: number) => void;
  onLoadHinglishSamples: () => void;
  onPreset: (id: string) => void;
  onSavePreset: () => void;
  onAspect: (a: ShortAspect) => void;
  onMotion: (kind: SveMotionKind, amount: number) => void;
  onCompareAB: (v: boolean) => void;
  onGenerateCaptions: () => void;
  onGenerateMusic: (prompt?: string) => void;
  onClearMusic: () => void;
  onVoiceover: (text: string, voice: string) => void;
  onBeatSync: () => void;
  onAddCard: (kind: CardKind, preset?: { title?: string; subtitle?: string }) => void;
  onResetColor: () => void;
}

export default function SveProPanels(props: SvePanelProps) {
  const { doc, tab } = props;
  const [filterCat, setFilterCat] = useState<'all' | 'cinematic' | 'retro' | 'modern' | 'minimal'>('all');
  const [voText, setVoText] = useState('');
  const [voVoice, setVoVoice] = useState('alloy');

  const set = props.update;
  const filters = useMemo(
    () => Object.keys(FILTER_GRADES).filter((name) => filterCat === 'all' || FILTER_CATEGORIES[name] === filterCat),
    [filterCat],
  );

  const musicBusy = props.musicPhase !== 'idle';
  const selectedCard = doc.cards.find((c) => c.start <= props.currentTime && c.end >= props.currentTime) || doc.cards[0] || null;

  // -------------------------------------------------------------- EFFECTS --
  if (tab === 'effects') {
    return (
      <>
        <Section
          key="fx-captions"
          icon={<Captions size={11} />}
          title="Captions"
          hint={doc.words.length ? `${doc.words.length} words` : 'Not generated'}
          defaultOpen
        >
          <button
            type="button"
            className="vp-btn primary block"
            disabled={!props.hasSource || props.captionsBusy}
            title={!props.hasSource ? 'Upload a clip first' : 'Transcribe the audio and time every word'}
            onClick={props.onGenerateCaptions}
          >
            {props.captionsBusy ? <Loader2 size={13} className="vp-spin" /> : <Wand2 size={13} />}
            {doc.words.length ? 'Re-transcribe' : 'Generate captions'}
          </button>
          {doc.timingSource === 'even' ? (
            <p className="vp-note warn">
              Word timing could not be measured, so the words are spaced evenly. Edit the transcript in the Text tab
              and they re-time.
            </p>
          ) : null}
          <Field label="Language">
            <Pills
              options={CAPTION_LANGUAGES.map((l) => ({ id: l.id, label: l.label, title: l.hint }))}
              value={doc.caption.language}
              onPick={props.onCaptionLanguage}
            />
          </Field>
          <p className="vp-note">
            {props.captionTiers.length
              ? 'This track: ' + props.captionTiers.map((r) => r.count + ' ' + TIER_LABELS[r.tier]).join(' \u00b7 ')
                + '. Reassign any line by hand in Caption tiers below.'
              : 'Captions are drawn in five tiers — Clean, Kinetic, Cinematic, Impact and Timeline. Generate them and the mix appears in Caption tiers below.'}
          </p>
          {doc.caption.language === 'hinglish' ? (
            <>
              <p className="vp-note">
                <Languages size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                Romanized Hindi mixed with English. Inter already covers the Latin script, so no extra font is
                loaded — what Hinglish adds is the Hindi filler list the key-word picker skips.
              </p>
              <button
                type="button"
                className="vp-btn block"
                disabled={!props.hasSource}
                title={props.hasSource
                  ? 'Put the five reference Hinglish lines in the transcript and spread them across the clip'
                  : 'Upload a clip first'}
                onClick={props.onLoadHinglishSamples}
              >
                <Sparkles size={13} /> Load sample Hinglish lines
              </button>
            </>
          ) : null}
          <Toggle
            label="Burn captions into the video"
            checked={doc.captionsEnabled}
            onChange={(captionsEnabled) => set((d) => ({ ...d, captionsEnabled }), 'cap-on')}
          />
          <Field label="Style">
            <div className="vp-grid c2">
              {CAPTION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`vp-tile pad${doc.caption.preset === p.id ? ' on' : ''}`}
                  title={p.hint}
                  onClick={() => set((d) => ({ ...d, caption: { ...d.caption, preset: p.id } }), 'cap-preset')}
                >
                  <b style={{ fontSize: 11, display: 'block', color: '#D7D7D7' }}>{p.label}</b>
                  <small style={{ fontSize: 9.5, color: '#6A6A6A' }}>{p.hint}</small>
                </button>
              ))}
            </div>
          </Field>
          <Slider
            label="Size"
            value={doc.caption.size}
            min={48}
            max={160}
            suffix="px"
            onChange={(size) => set((d) => ({ ...d, caption: { ...d.caption, size } }), 'cap-size')}
          />
          <Toggle
            label="Auto-fit to the safe zone"
            hint="Shrinks a long line rather than letting it clip"
            checked={doc.caption.autoFit}
            onChange={(autoFit) => set((d) => ({ ...d, caption: { ...d.caption, autoFit } }), 'cap-fit')}
          />
          <Slider
            label="Vertical position"
            value={Math.round(doc.caption.posY * 100)}
            min={20}
            max={92}
            suffix="%"
            onChange={(v) => set((d) => ({ ...d, caption: { ...d.caption, posY: v / 100 } }), 'cap-y')}
          />
          <Slider
            label="Words per line"
            value={doc.caption.wordsPerCue}
            min={1}
            max={6}
            onChange={(wordsPerCue) => set((d) => ({ ...d, caption: { ...d.caption, wordsPerCue } }), 'cap-wpc')}
          />
          <div className="vp-row">
            <input
              className="vp-color"
              type="color"
              aria-label="Caption colour"
              title="Caption fill colour"
              value={doc.caption.color}
              onChange={(e) => set((d) => ({ ...d, caption: { ...d.caption, color: e.target.value } }), 'cap-col')}
            />
            <input
              className="vp-color"
              type="color"
              aria-label="Emphasis colour"
              title="The accent an emphasis moment takes — a kinetic line's key word, a cinematic hook's key word, a timeline line's digits"
              value={doc.caption.accent}
              onChange={(e) => set((d) => ({ ...d, caption: { ...d.caption, accent: e.target.value } }), 'cap-acc')}
            />
            <span className="vp-note">Fill · emphasis</span>
          </div>
          <Toggle
            label="UPPERCASE"
            checked={doc.caption.uppercase}
            onChange={(uppercase) => set((d) => ({ ...d, caption: { ...d.caption, uppercase } }), 'cap-up')}
          />
          <Toggle
            label="Per-word pill"
            hint="A badge behind each word, never behind the whole line"
            checked={doc.caption.pill}
            onChange={(pill) => set((d) => ({ ...d, caption: { ...d.caption, pill } }), 'cap-pill')}
          />
        </Section>

        <Section
          key="fx-tiers"
          icon={<Layers size={11} />}
          title="Caption tiers"
          hint={props.cues.length ? `${props.cues.length} lines \u00b7 70/20/10` : 'No captions yet'}
        >
          <SveTierPanel
            cues={props.cues}
            mode={doc.caption.tierMode}
            tierOverrides={doc.captionTiers}
            emphasisOverrides={doc.captionEmphasis}
            currentTime={props.currentTime}
            onMode={props.onTierMode}
            onSetTier={props.onSetCueTier}
            onSetEmphasis={props.onSetCueEmphasis}
            onResetAll={props.onResetCueTiers}
            onSeek={props.onSeek}
          />
        </Section>

        <Section
          key="fx-grades"
          icon={<Palette size={11} />}
          title="Film grades"
          hint={`${Object.keys(FILTER_GRADES).length} looks`}
        >
          <Pills
            options={[
              { id: 'all', label: 'All' },
              { id: 'cinematic', label: 'Cinematic' },
              { id: 'retro', label: 'Retro' },
              { id: 'modern', label: 'Modern' },
              { id: 'minimal', label: 'Minimal' },
            ]}
            value={filterCat}
            onPick={(id) => setFilterCat(id as typeof filterCat)}
          />
          <div className="vp-grid c3">
            {filters.map((name) => {
              const on = doc.grade.filter === name;
              return (
                <button
                  key={name}
                  type="button"
                  className={`vp-tile${on ? ' on' : ''}`}
                  onClick={() => set((d) => ({ ...d, grade: { ...d.grade, filter: name } }), 'filter')}
                  aria-pressed={on}
                  title={on ? `${name} is applied — preview and export both use it` : `Grade the whole clip with ${name}`}
                >
                  <span className="vp-swatch" style={{ background: FILTER_GRADES[name].swatch, filter: FILTER_GRADES[name].css }}>
                    {on ? <span className="vp-check"><Check size={10} /></span> : null}
                  </span>
                  <span className="vp-tilelab">{name}</span>
                </button>
              );
            })}
          </div>
          <p className="vp-note">
            The same filter string drives the preview and the render, so a look can never read one way here and
            another in the exported file.
          </p>
        </Section>

        <Section
          key="fx-broll"
          icon={<Layers size={11} />}
          title="B-roll layout"
          hint={`${doc.broll.length} clip${doc.broll.length === 1 ? '' : 's'}`}
        >
          {doc.broll.length ? doc.broll.map((clip) => (
            <div key={clip.id}>
              <span className="vp-label" style={{ marginBottom: 4 }}>{clip.name}</span>
              <Pills
                options={BROLL_LAYOUTS.map((l) => ({ id: l.id, label: l.label, title: l.hint }))}
                value={clip.layout}
                onPick={(layout) => set((d) => ({
                  ...d,
                  broll: d.broll.map((b) => (b.id === clip.id ? { ...b, layout } : b)),
                }), 'broll-layout')}
              />
              {clip.layout === 'blend' ? (
                <Slider
                  label="Blend opacity"
                  value={Math.round(clip.opacity * 100)}
                  min={10}
                  max={100}
                  suffix="%"
                  onChange={(v) => set((d) => ({
                    ...d,
                    broll: d.broll.map((b) => (b.id === clip.id ? { ...b, opacity: v / 100 } : b)),
                  }), 'broll-opacity')}
                />
              ) : null}
            </div>
          )) : (
            <p className="vp-note">Open the agent drawer to search stock cutaways or upload your own.</p>
          )}
        </Section>
      </>
    );
  }

  // -------------------------------------------------------------- PRESETS --
  if (tab === 'presets') {
    const all = [...SHORT_PRESETS, ...props.customPresets];
    return (
      <>
        <Section key="pre-full" icon={<Sparkles size={11} />} title="Full edit presets" hint="One tap" defaultOpen>
          <p className="vp-note">
            Sets the grade, caption design, accent colour, camera move, music level and loop treatment together. Undo
            puts all of it back.
          </p>
          <div className="vp-grid c2">
            {all.map((p) => {
              const grade = FILTER_GRADES[p.filter] || FILTER_GRADES.None;
              const on = props.activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`vp-tile${on ? ' on' : ''}`}
                  disabled={!props.hasSource}
                  title={p.blurb}
                  onClick={() => props.onPreset(p.id)}
                >
                  <span className="vp-swatch" style={{ background: grade.swatch, filter: grade.css, aspectRatio: '16/7' }}>
                    {on ? <span className="vp-check"><Check size={10} /></span> : null}
                  </span>
                  <span className="vp-tilelab">{p.label}</span>
                  <span className="vp-tilesub">{p.blurb}</span>
                </button>
              );
            })}
          </div>
        </Section>
        <Section key="pre-mine" icon={<Save size={11} />} title="Your presets" hint="Saved on this device">
          <button
            type="button"
            className="vp-btn block"
            disabled={!props.hasSource}
            title={props.hasSource ? 'Store this grade, caption design, motion and mix as a reusable look' : 'Upload a clip first'}
            onClick={props.onSavePreset}
          >
            <Save size={13} /> Save current settings as a preset
          </button>
        </Section>
      </>
    );
  }

  // ----------------------------------------------------------------- TEXT --
  if (tab === 'text') {
    return (
      <>
        <Section key="txt-cards" icon={<Sticker size={11} />} title="Graphic cards" hint={`${doc.cards.length} on the timeline`} defaultOpen>
          <div className="vp-grid c3">
            {(['hook', 'lower', 'cta'] as CardKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className="vp-tile pad"
                disabled={!props.hasSource}
                title={!props.hasSource
                  ? 'Upload a clip first'
                  : kind === 'hook'
                    ? 'Add a title card at 0:00 that holds for three seconds'
                    : kind === 'cta'
                      ? 'Add a call-to-action card over the last three seconds'
                      : 'Add a lower third at the playhead'}
                onClick={() => props.onAddCard(kind)}
              >
                <b style={{ fontSize: 11, display: 'block', color: '#D7D7D7', textTransform: 'capitalize' }}>{kind}</b>
                <small style={{ fontSize: 9.5, color: '#6A6A6A' }}>
                  {kind === 'hook' ? 'Opens the video' : kind === 'cta' ? 'Closes the video' : 'Lower third'}
                </small>
              </button>
            ))}
          </div>
          {selectedCard ? (
            <>
              <Field label="Title">
                <input
                  className="vp-input"
                  value={selectedCard.title}
                  onChange={(e) => set((d) => ({
                    ...d,
                    cards: d.cards.map((c) => (c.id === selectedCard.id ? { ...c, title: e.target.value } : c)),
                  }), 'card-title')}
                />
              </Field>
              <Field label="Subtitle">
                <input
                  className="vp-input"
                  value={selectedCard.subtitle}
                  onChange={(e) => set((d) => ({
                    ...d,
                    cards: d.cards.map((c) => (c.id === selectedCard.id ? { ...c, subtitle: e.target.value } : c)),
                  }), 'card-sub')}
                />
              </Field>
              <div className="vp-row">
                <input
                  className="vp-color"
                  type="color"
                  aria-label="Card colour"
                  title="Accent colour for this card"
                  value={selectedCard.color}
                  onChange={(e) => set((d) => ({
                    ...d,
                    cards: d.cards.map((c) => (c.id === selectedCard.id ? { ...c, color: e.target.value } : c)),
                  }), 'card-col')}
                />
                <span className="vp-note">Drag the block on the CARDS track to retime it.</span>
              </div>
            </>
          ) : null}
        </Section>

        <Section key="txt-transcript" icon={<ListChecks size={11} />} title="Transcript" hint="Edit and the captions re-time">
          <textarea
            className="vp-area"
            style={{ minHeight: 110 }}
            placeholder="Generate captions, or type what is said and the words will be spread across the clip…"
            value={doc.transcript}
            onChange={(e) => set((d) => ({ ...d, transcript: e.target.value }), 'transcript')}
          />
        </Section>
      </>
    );
  }

  // --------------------------------------------------------------- MOTION --
  if (tab === 'motion') {
    return (
      <>
        <Section key="mo-camera" icon={<Move size={11} />} title="Motion effects" hint="Rendered, not just previewed" defaultOpen>
          <div className="vp-grid c3">
            {SVE_MOTION_PRESETS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`vp-tile pad${doc.motionKind === m.id ? ' on' : ''}`}
                title={!props.hasSource ? 'Upload a clip first' : `${m.label} — ${m.blurb}`}
                aria-pressed={doc.motionKind === m.id}
                disabled={!props.hasSource}
                onClick={() => props.onMotion(m.id, doc.motionAmount)}
              >
                <b style={{ fontSize: 10.5, display: 'block', color: '#D7D7D7' }}>{m.label}</b>
                <small style={{ fontSize: 9.5, color: '#6A6A6A' }}>{m.blurb}</small>
              </button>
            ))}
          </div>
          <Slider
            label="Amount"
            value={Math.round(doc.motionAmount * 100)}
            min={10}
            max={100}
            suffix="%"
            disabled={doc.motionKind === 'none'}
            onChange={(v) => props.onMotion(doc.motionKind === 'none' ? 'kenBurns' : doc.motionKind, v / 100)}
          />
          <p className="vp-note">
            The move is written as keyframes on the VIDEO track and handed to the renderer, so the exported file moves
            exactly like the preview.
          </p>
        </Section>

        <Section key="mo-loop" icon={<Repeat size={11} />} title="Loop" hint="For a feed that restarts">
          <Toggle
            label="Smooth loop"
            hint="Dips the first 0.3s and last 0.45s so a restart has no hard jump"
            checked={doc.smoothLoop}
            onChange={(smoothLoop) => set((d) => ({ ...d, smoothLoop }), 'loop')}
          />
        </Section>

        <Section key="mo-aspect" icon={<Crop size={11} />} title="Aspect" hint="Preview frame">
          <Pills
            options={SHORT_ASPECTS.map((a) => ({ id: a.id, label: a.label, title: a.blurb }))}
            value={doc.aspect}
            onPick={(id) => props.onAspect(id)}
          />
          <p className="vp-note">
            The master always renders 1080×1920 — the render service accepts no other geometry. A non-portrait choice
            here draws the safe frame on the preview so you can see what a square or landscape crop would keep.
          </p>
        </Section>

        <Section
          key="mo-stab"
          icon={<Gauge size={11} />}
          title="Stabilisation"
          hint="Not available"
          soon
          tip="Coming soon — the render service exposes no stabilisation pass"
        >
          <Toggle label="Stabilise shaky footage" checked={false} disabled onChange={() => undefined} />
          <p className="vp-note warn">
            The render service exposes no stabilisation pass, so this stays off rather than shipping as a switch that
            changes nothing.
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
          key="col-adjust"
          icon={<SlidersHorizontal size={11} />}
          title="Color grading"
          hint="Exposure and balance"
          defaultOpen
        >
          <button
            type="button"
            className="vp-btn xs"
            title="Put every slider back to the original footage"
            onClick={props.onResetColor}
          >
            <RotateCcw size={11} /> Reset all adjustments
          </button>
          <Slider label="Brightness" value={doc.grade.brightness} min={-50} max={50}
            onChange={(brightness) => set((d) => ({ ...d, grade: { ...d.grade, brightness } }), 'grade-b')} />
          <Slider label="Contrast" value={doc.grade.contrast} min={-50} max={50}
            onChange={(contrast) => set((d) => ({ ...d, grade: { ...d.grade, contrast } }), 'grade-c')} />
          <Slider label="Saturation" value={doc.grade.saturation} min={-50} max={50}
            onChange={(saturation) => set((d) => ({ ...d, grade: { ...d.grade, saturation } }), 'grade-s')} />
          <Slider label="Highlights" value={doc.grade.highlights} min={-50} max={50}
            onChange={(highlights) => set((d) => ({ ...d, grade: { ...d.grade, highlights } }), 'grade-h')} />
          <Slider label="Shadows" value={doc.grade.shadows} min={-50} max={50}
            onChange={(shadows) => set((d) => ({ ...d, grade: { ...d.grade, shadows } }), 'grade-sh')} />
          <Slider label="Temperature" value={doc.grade.temperature} min={-50} max={50}
            onChange={(temperature) => set((d) => ({ ...d, grade: { ...d.grade, temperature } }), 'grade-temp')} />
          <Slider label="Tint" value={doc.grade.tint} min={-50} max={50}
            onChange={(tint) => set((d) => ({ ...d, grade: { ...d.grade, tint } }), 'grade-tint')} />
          <p className="vp-note">
            Every adjustment uses the same deterministic filter chain in the preview and the exported file.
          </p>
        </Section>

        <Section key="col-luts" icon={<Palette size={11} />} title="LUTs" hint="Colour wheels">
          <div className="vp-grid c3">
            {Object.keys(FILTER_GRADES).map((name) => {
              const on = doc.grade.filter === name;
              return (
                <button
                  key={name}
                  type="button"
                  className={`vp-tile${on ? ' on' : ''}`}
                  aria-pressed={on}
                  title={on ? `${name} is applied` : `Apply the ${name} LUT`}
                  onClick={() => set((d) => ({ ...d, grade: { ...d.grade, filter: name } }), 'filter')}
                >
                  <span
                    className="vp-swatch"
                    style={{
                      aspectRatio: '1/1',
                      borderRadius: '50%',
                      width: '62%',
                      margin: '8px auto 2px',
                      background: 'conic-gradient(from 210deg,#EF4444,#F59E0B,#84CC16,#06B6D4,#6366F1,#EC4899,#EF4444)',
                      filter: FILTER_GRADES[name].css,
                    }}
                  >
                    {on ? <span className="vp-check"><Check size={10} /></span> : null}
                  </span>
                  <span className="vp-tilelab" style={{ textAlign: 'center' }}>{name}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section key="col-compare" icon={<SplitSquareHorizontal size={11} />} title="Compare" hint="Before / after">
          <Toggle
            label="Split-screen A/B"
            hint="Left half is the ungraded source, right half is your edit"
            checked={props.compareAB}
            onChange={props.onCompareAB}
          />
          <button
            type="button"
            className={`vp-btn block${props.compareAB ? ' on' : ''}`}
            title="Wipe the ungraded source over the left half of the preview"
            onClick={() => props.onCompareAB(!props.compareAB)}
          >
            <SplitSquareHorizontal size={13} /> {props.compareAB ? 'Hide the comparison' : 'Show the comparison'}
          </button>
        </Section>
      </>
    );
  }

  // ---------------------------------------------------------------- AUDIO --
  if (tab === 'audio') {
    return (
      <>
        <Section key="au-mix" icon={<SlidersHorizontal size={11} />} title="Mix" hint="Exported levels" defaultOpen>
          <Slider label="Original audio" value={doc.audio.original} min={0} max={100} suffix="%"
            onChange={(original) => set((d) => ({ ...d, audio: { ...d.audio, original } }), 'mix-o')} />
          <Slider label="Music bed" value={doc.audio.music} min={0} max={100} suffix="%"
            onChange={(music) => set((d) => ({ ...d, audio: { ...d.audio, music } }), 'mix-m')} />
          <Slider label="Fade in" value={doc.audio.fadeIn} min={0} max={5} step={0.1} suffix="s"
            onChange={(fadeIn) => set((d) => ({ ...d, audio: { ...d.audio, fadeIn } }), 'mix-fi')} />
          <Slider label="Fade out" value={doc.audio.fadeOut} min={0} max={5} step={0.1} suffix="s"
            onChange={(fadeOut) => set((d) => ({ ...d, audio: { ...d.audio, fadeOut } }), 'mix-fo')} />
          <p className="vp-note">The fades apply to the whole mix — original audio and music bed together.</p>
        </Section>

        <Section key="au-sound" icon={<Music2 size={11} />} title="Sound direction" hint="Generates a bed">
          <div className="vp-grid c2">
            {SOUND_DIRECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="vp-tile pad"
                disabled={!props.hasSource || musicBusy}
                title={!props.hasSource ? 'Upload a clip first' : `Compose a ${s.label} bed — ${s.prompt}`}
                onClick={() => props.onGenerateMusic(s.prompt)}
              >
                <b style={{ fontSize: 11, display: 'block', color: '#D7D7D7' }}>
                  <Music2 size={10} style={{ marginRight: 4 }} />{s.label}
                </b>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="vp-btn block"
            disabled={!props.hasSource || musicBusy}
            title={!props.hasSource ? 'Upload a clip first' : 'Write the brief from the footage, then compose a bed to match'}
            onClick={() => props.onGenerateMusic()}
          >
            {musicBusy ? <Loader2 size={13} className="vp-spin" /> : <Sparkles size={13} />}
            {props.musicPhase === 'briefing' ? 'Reading the footage…' : props.musicPhase === 'generating' ? 'Composing…' : 'Let the agent choose'}
          </button>
          {props.musicNote ? <p className="vp-note">{props.musicNote}</p> : null}
          {doc.music.url ? (
            <>
              <audio src={doc.music.url} controls style={{ width: '100%', height: 30 }} />
              <button
                type="button"
                className="vp-btn block"
                title="Drop the generated bed and keep only the original audio"
                onClick={props.onClearMusic}
              >
                Remove the music bed
              </button>
            </>
          ) : null}
        </Section>

        <Section key="au-voice" icon={<Mic size={11} />} title="Voiceover" hint="Text to speech">
          <Field label="Script">
            <textarea
              className="vp-area"
              placeholder="Type the line you want read over the short…"
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
            title={voText.trim().length < 2 ? 'Type a line to read first' : `Read this script in the ${voVoice} voice`}
            onClick={() => props.onVoiceover(voText.trim(), voVoice)}
          >
            {props.voBusy ? <Loader2 size={13} className="vp-spin" /> : <Mic size={13} />}
            {props.voBusy ? 'Recording…' : 'Generate voiceover'}
          </button>
          {props.voNote ? <p className="vp-note">{props.voNote}</p> : null}
        </Section>

        <Section key="au-beat" icon={<AudioLines size={11} />} title="Beat sync" hint={doc.bpm ? `${Math.round(doc.bpm)} BPM` : 'Not measured'}>
          <button
            type="button"
            className="vp-btn primary block"
            disabled={!props.hasSource || props.beatBusy}
            title={!props.hasSource ? 'Upload a clip first' : 'Measure the tempo, then move every card and cutaway onto a beat'}
            onClick={props.onBeatSync}
          >
            {props.beatBusy ? <Loader2 size={13} className="vp-spin" /> : <AudioLines size={13} />}
            Measure the tempo and snap the cards to it
          </button>
          <Toggle
            label="Keep new blocks on the beat"
            hint="Cards and cutaways you add will land on the nearest beat"
            checked={doc.beatSync}
            disabled={!doc.bpm}
            onChange={(beatSync) => set((d) => ({ ...d, beatSync }), 'beatsync')}
          />
          {doc.bpm ? <p className="vp-note good">Beat grid drawn across the timeline at {Math.round(doc.bpm)} BPM.</p> : null}
        </Section>

        <Section
          key="au-noise"
          icon={<Waves size={11} />}
          title="Noise reduction"
          hint="Not available"
          soon
          tip="Coming soon — there is no de-noise pass in the render service"
        >
          <p className="vp-note warn">
            There is no de-noise pass in the render service, so a toggle here could not reach the exported file. Clean
            the audio before uploading, or lower the original level and lean on the music bed.
          </p>
        </Section>
      </>
    );
  }

  // --------------------------------------------------------------- SHORTS --
  return (
    <>
      <Section
        key="sh-optimise"
        icon={<ListChecks size={11} />}
        title="Optimisation"
        hint={`${props.checklist.filter((c) => c.done).length}/${props.checklist.length} done`}
        defaultOpen
      >
        {props.checklist.map((item) => (
          <div key={item.id} className="vp-row">
            <span style={{ color: item.done ? '#34D399' : '#606060', display: 'inline-flex' }}>
              {item.done ? <Check size={13} /> : <Zap size={13} />}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <b style={{ fontSize: 11.5, fontWeight: 650, color: item.done ? '#8A8A8A' : '#DADADA' }}>{item.label}</b>
              <small style={{ display: 'block', fontSize: 10.5, color: '#6A6A6A', lineHeight: 1.45 }}>{item.hint}</small>
            </span>
            {!item.done && item.fix ? (
              <button type="button" className="vp-btn xs" title={`Fix this now — ${item.hint}`} onClick={item.fix}>Fix</button>
            ) : null}
          </div>
        ))}
      </Section>

      <Section key="sh-hooks" icon={<Zap size={11} />} title="Viral hooks" hint="Opens the short">
        <div className="vp-pills">
          {VIRAL_HOOKS.map((h) => (
            <button
              key={h.title}
              type="button"
              className="vp-pill"
              disabled={!props.hasSource}
              title={!props.hasSource ? 'Upload a clip first' : `Add “${h.title}” as the opening hook card`}
              onClick={() => props.onAddCard('hook', h)}
            >
              {h.title}
            </button>
          ))}
        </div>
        <p className="vp-note">
          A hook card lands at 0:00 and holds for three seconds — the window where a short is won or lost.
        </p>
      </Section>

      <Section key="sh-cta" icon={<Megaphone size={11} />} title="Closing CTA" hint="Last three seconds">
        <div className="vp-pills">
          {CTA_LINES.map((c) => (
            <button
              key={c.title}
              type="button"
              className="vp-pill"
              disabled={!props.hasSource}
              title={!props.hasSource ? 'Upload a clip first' : `Add “${c.title}” over the last three seconds`}
              onClick={() => props.onAddCard('cta', c)}
            >
              {c.title}
            </button>
          ))}
        </div>
      </Section>

      <Section key="sh-pacing" icon={<Gauge size={11} />} title="Pacing" hint="Measured">
        <p className="vp-note">
          {doc.durationS
            ? `${doc.durationS.toFixed(1)}s long${doc.words.length ? ` · ${(doc.words.length / Math.max(1, doc.durationS)).toFixed(1)} words per second` : ''}.`
            : 'Upload a clip to measure its pacing.'}
        </p>
        {doc.durationS > 60 ? (
          <p className="vp-note warn">
            <Scissors size={11} style={{ marginRight: 4 }} />
            Over 60 seconds — Shorts and Reels both cap there. Use Smart trim in the agent drawer to tighten it.
          </p>
        ) : null}
        {doc.silences.length ? (
          <p className="vp-note">
            {doc.silences.length} silent stretch{doc.silences.length === 1 ? '' : 'es'} marked on the AUDIO track.
          </p>
        ) : null}
      </Section>
    </>
  );
}
