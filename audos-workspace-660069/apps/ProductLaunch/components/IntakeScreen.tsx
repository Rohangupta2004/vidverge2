// SCREEN 1 — INTAKE.
//
// Five fields, all of them empty on arrival. There is no sample product, no
// suggested description, no pre-selected example and no placeholder content
// anywhere on this screen: the placeholders below are HTML hints that vanish
// the moment a key is pressed and are never submitted. Everything the film
// becomes starts here.

import { ArrowRight, Globe } from 'lucide-react';
import {
  isLaunchInputReady,
  LAUNCH_TONES,
  type LaunchInput,
  type LaunchTone,
} from '../lib/launchTypes';
import { ACCENT, ACCENT_SOFT, BORDER, ErrorNote, Field, INPUT_STYLE, MUTED, PANEL, PrimaryButton, TEXT } from './LaunchUi';

const TONE_NOTE: Record<LaunchTone, string> = {
  Cinematic: 'Near-black frame, slow holds, one colour doing all the work.',
  Energetic: 'Saturated, loud, cut hard on the beat.',
  Professional: 'Composed slate, measured pace, nothing shouts.',
  Minimal: 'Light frame, black type, air around every line.',
};

export default function IntakeScreen(props: {
  value: LaunchInput;
  onChange: (next: LaunchInput) => void;
  onGenerate: () => void;
  error: string;
}) {
  const { value, onChange } = props;
  const ready = isLaunchInputReady(value);

  const set = (patch: Partial<LaunchInput>) => onChange({ ...value, ...patch });

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '8px 0 48px' }}>
      <h1
        style={{
          fontSize: 34,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: TEXT,
          margin: '0 0 10px',
        }}
      >
        Tell me about your product.
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: MUTED, margin: '0 0 30px' }}>
        Claude Opus 5 writes the film from these words — the lines, the cuts, the colour and the
        closing call to action. Nothing here is pre-filled, and nothing is reused from another run.
      </p>

      <div style={{ ...PANEL, padding: 26 }}>
        <Field label="Product name">
          <input
            style={INPUT_STYLE}
            value={value.productName}
            onChange={(event) => set({ productName: event.target.value })}
            placeholder="What is it called?"
            spellCheck={false}
          />
        </Field>

        <Field
          label="What it does"
          hint="Two or three sentences in your own words. The more specific you are, the less generic the film is."
        >
          <textarea
            style={{ ...INPUT_STYLE, minHeight: 124, resize: 'vertical', lineHeight: 1.6 }}
            value={value.whatItDoes}
            onChange={(event) => set({ whatItDoes: event.target.value })}
            placeholder="The problem it solves, and how."
          />
        </Field>

        <Field
          label="Website"
          optional
          hint="If you paste one, the page is read and photographed, and that real screenshot is composited into the film."
        >
          <div style={{ position: 'relative' }}>
            <Globe
              size={16}
              style={{ position: 'absolute', left: 14, top: 15, color: MUTED, pointerEvents: 'none' }}
            />
            <input
              style={{ ...INPUT_STYLE, paddingLeft: 40 }}
              value={value.websiteUrl}
              onChange={(event) => set({ websiteUrl: event.target.value })}
              placeholder="yourproduct.com"
              spellCheck={false}
            />
          </div>
        </Field>

        <Field label="Target audience" optional>
          <input
            style={INPUT_STYLE}
            value={value.audience}
            onChange={(event) => set({ audience: event.target.value })}
            placeholder="Who is this for?"
          />
        </Field>

        <Field label="Tone" hint={TONE_NOTE[value.tone]}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {LAUNCH_TONES.map((tone) => {
              const active = value.tone === tone;
              return (
                <button
                  key={tone}
                  type="button"
                  onClick={() => set({ tone })}
                  style={{
                    padding: '11px 18px',
                    borderRadius: 999,
                    border: '1px solid ' + (active ? ACCENT : BORDER),
                    background: active ? ACCENT_SOFT : 'transparent',
                    color: active ? TEXT : MUTED,
                    fontSize: 13.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {tone}
                </button>
              );
            })}
          </div>
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 }}>
          <PrimaryButton onClick={props.onGenerate} disabled={!ready}>
            Write the film
            <ArrowRight size={16} />
          </PrimaryButton>
          {!ready ? (
            <span style={{ fontSize: 12.5, color: MUTED }}>
              A name and a sentence about what it does is all it takes.
            </span>
          ) : null}
        </div>

        <ErrorNote>{props.error}</ErrorNote>
      </div>
    </div>
  );
}
