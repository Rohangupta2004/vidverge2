/**
 * Short Video Enhancer — the caption lab.
 *
 * Four visual presets, a word-by-word timing readout, and an honest statement
 * of where that timing came from. The old solid caption plate is gone: the
 * only background option left is a small per-word pill, which is what the
 * CapCut / OpusClip look actually uses.
 *
 * Every track — English or Hinglish — is drawn in the five-tier mixed style
 * described in `lib/sveCaptionTiers.ts`. The language selector changes the
 * vocabulary the key-word picker skips, not the treatment; per-line tier
 * assignment lives in the Text tab's Caption tiers section.
 */

import { Captions, Languages, Layers, Loader2, Sparkles } from 'lucide-react';
import {
  CAPTION_LANGUAGES, CAPTION_PRESETS,
  type CaptionCue, type CaptionLanguage, type CaptionPreset, type CaptionTier, type EditDoc,
} from '../lib/sveTypes';
import { TIER_LABELS } from '../lib/sveCaptionTiers';
import { Field, Note, Section, Slider, Toggle } from './SveControls';

export interface CaptionPanelProps {
  doc: EditDoc;
  cues: CaptionCue[];
  /** How the cue list actually split across the five treatments. */
  tiers: { tier: CaptionTier; count: number }[];
  captionSize: number;
  open: boolean;
  onToggleOpen: () => void;
  busy: boolean;
  hasSource: boolean;
  onUpdate: (patch: (doc: EditDoc) => EditDoc, label?: string) => void;
  onLanguage: (language: CaptionLanguage) => void;
  onLoadSamples: () => void;
  onGenerate: () => void;
}

export function SveCaptionPanel(props: CaptionPanelProps) {
  const { doc, cues, captionSize, busy } = props;
  const design = doc.caption;

  const setDesign = (patch: Partial<typeof design>, label?: string) => {
    props.onUpdate((d) => ({ ...d, caption: { ...d.caption, ...patch } }), label);
  };

  const hinglish = design.language === 'hinglish';
  const wordCount = doc.words.length;
  const timingLabel =
    doc.timingSource === 'transcript' ? 'Speech-locked from word timestamps'
    : doc.timingSource === 'even' ? 'Evenly spaced — no word timestamps were available'
    : 'Not generated yet';

  return (
    <Section id="captions" title="Dynamic Captions" open={props.open} onToggle={props.onToggleOpen}>
      <button className="sve-action" disabled={busy || !props.hasSource} onClick={props.onGenerate}>
        {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
        {busy ? 'Reading the audio…' : wordCount ? 'Regenerate captions' : 'Generate captions'}
      </button>

      {!props.hasSource && <Note>Upload a clip first — captions are timed against its audio track.</Note>}

      {wordCount > 0 && (
        <Note tone={doc.timingSource === 'transcript' ? 'good' : 'warn'}>
          {wordCount} words · {cues.length} cues · {timingLabel}.
          {doc.silences.length > 0 && ' ' + doc.silences.length + ' silent gap' + (doc.silences.length === 1 ? '' : 's') + ' detected — marked on the AUDIO track so you can see where to tighten.'}
        </Note>
      )}

      <Toggle label="Show captions" checked={doc.captionsEnabled} onChange={(v) => props.onUpdate((d) => ({ ...d, captionsEnabled: v }), 'captions-on')} />

      <Field label="Language">
        <div className="sve-segmented two">
          {CAPTION_LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              className={design.language === lang.id ? 'active' : ''}
              title={lang.hint}
              onClick={() => props.onLanguage(lang.id)}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </Field>
      <p className="sve-muted">
        <Layers size={10} style={{ verticalAlign: '-1px' }} /> Lines are drawn in five tiers — clean, kinetic,
        cinematic, impact and timeline — split roughly 70 / 20 / 10. Reassign any single line in the Text
        tab's Caption tiers.
        {props.tiers.length > 0 && ' This track: ' + props.tiers.map((row) => row.count + ' ' + TIER_LABELS[row.tier]).join(' \u00b7 ') + '.'}
      </p>
      {hinglish && (
        <>
          <p className="sve-muted">
            <Languages size={10} style={{ verticalAlign: '-1px' }} /> Romanized Hindi mixed with English. Inter
            already covers the Latin script, so no extra font is loaded.
          </p>
          <button className="sve-save" style={{ marginTop: 0, marginBottom: 12 }} disabled={!props.hasSource} onClick={props.onLoadSamples}>
            <Sparkles size={13} /> Load sample Hinglish lines
          </button>
        </>
      )}

      <Field label="Caption style">
        <div className="sve-cap-styles">
          {CAPTION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={design.preset === preset.id ? 'active' : ''}
              onClick={() => setDesign({ preset: preset.id as CaptionPreset })}
              title={preset.hint}
            >
              <em className={preset.id}>Aa</em>
              <small>{preset.label}</small>
            </button>
          ))}
        </div>
      </Field>

      <Toggle label="Auto-fit to safe zone" checked={design.autoFit} onChange={(v) => setDesign({ autoFit: v })} />
      <Slider
        label={design.autoFit ? 'Max font size' : 'Font size'}
        value={design.size} min={40} max={160} suffix="px"
        onChange={(size) => setDesign({ size }, 'cap-size')}
      />
      {design.autoFit && captionSize < design.size && (
        <p className="sve-muted">Auto-fit shrank the type to {captionSize}px so the longest line clears both edges.</p>
      )}

      <Slider label="Words per cue" value={design.wordsPerCue} min={1} max={6} onChange={(wordsPerCue) => setDesign({ wordsPerCue }, 'cap-wpc')} />
      <Slider
        label="Vertical position" value={Math.round(design.posY * 100)} min={10} max={92} suffix="%"
        onChange={(v) => setDesign({ posY: v / 100 }, 'cap-pos')}
      />

      <div className="sve-color-row">
        <Field label="Text"><input type="color" value={design.color} onChange={(e) => setDesign({ color: e.target.value }, 'cap-color')} /></Field>
        <Field label="Highlight"><input type="color" value={design.accent} onChange={(e) => setDesign({ accent: e.target.value }, 'cap-accent')} /></Field>
      </div>

      <Toggle label="Uppercase" checked={design.uppercase} onChange={(uppercase) => setDesign({ uppercase })} />
      <Toggle
        label={design.preset === 'boxed' ? 'Per-word pill (always on for Boxed)' : 'Per-word pill'}
        checked={design.preset === 'boxed' || design.pill}
        onChange={(pill) => setDesign({ pill })}
      />
      <p className="sve-muted">
        A pill is a small rounded badge behind each word at 40% dark. There is no full-width caption block — captions sit directly on the video.
      </p>

      <Field label="Transcript">
        <textarea
          value={doc.transcript}
          rows={4}
          placeholder="Generate captions, or type the words here to re-time them evenly."
          onChange={(e) => props.onUpdate((d) => ({ ...d, transcript: e.target.value }), 'transcript')}
        />
      </Field>
      <p className="sve-muted"><Captions size={10} style={{ verticalAlign: '-1px' }} /> Fixing a spelling keeps the measured timing; adding or removing words re-times the line evenly.</p>
    </Section>
  );
}
