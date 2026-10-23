/**
 * SceneForge step 3 — ONE-TIME CHOICES.
 * Every selection the pipeline needs is made here, once, BEFORE generation:
 * style, music mood, B-roll amount, transparent background, target length.
 * One pass then produces BOTH 16:9 and a native 9:16 layout — no second round
 * of setup for portrait.
 */
import type { CSSProperties } from 'react';
import { COLORS, FONT, RADIUS } from '../../../components/theme';
import { describeCost } from '../../../lib/credits';
import { BROLL_AMOUNTS, FORGE_STYLES, MUSIC_MOODS, type ForgeChoices } from '../lib/forgeTypes';

export default function ForgeChoicesStep({
  choices,
  targetSeconds,
  estimatedSeconds,
  onChange,
  onTargetChange,
}: {
  choices: ForgeChoices;
  targetSeconds: number;
  estimatedSeconds: number;
  onChange: (next: ForgeChoices) => void;
  onTargetChange: (seconds: number) => void;
}) {
  const card = (selected: boolean): CSSProperties => ({
    background: selected ? 'linear-gradient(100deg, #2B2418 0%, #202126 100%)' : COLORS.surface,
    border: `1px solid ${selected ? COLORS.accent : COLORS.border}`,
    borderRadius: RADIUS.card,
    cursor: 'pointer',
    padding: 14,
    textAlign: 'left' as const,
  });

  return (
    <div style={{ display: 'grid', gap: 26, maxWidth: 960 }}>
      <section>
        <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Motion-graphics style</h3>
        <p style={{ color: COLORS.muted, fontSize: 13, margin: '0 0 12px' }}>The coding agent writes a unique, voice-matched graphics layer in this look — no generic templates.</p>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {FORGE_STYLES.map((s) => (
            <button key={s.id} type="button" onClick={() => onChange({ ...choices, style: s.id })} style={card(choices.style === s.id)} data-testid={`button-style-${s.id}`}>
              <span style={{ color: choices.style === s.id ? COLORS.accent : COLORS.text, display: 'block', fontFamily: FONT.heading, fontSize: 15, fontWeight: 700 }}>{s.name}</span>
              <span style={{ color: COLORS.secondary, display: 'block', fontSize: 12.5, lineHeight: '18px', marginTop: 6 }}>{s.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Background music mood (ElevenLabs, with emotion)</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {MUSIC_MOODS.map((m) => (
            <button key={m} type="button" onClick={() => onChange({ ...choices, musicMood: m })} style={{ background: choices.musicMood === m ? COLORS.accentSoft : COLORS.raised, border: `1px solid ${choices.musicMood === m ? COLORS.accent : COLORS.border}`, borderRadius: 999, color: choices.musicMood === m ? COLORS.accent : COLORS.secondary, cursor: 'pointer', fontFamily: FONT.heading, fontSize: 13, fontWeight: 600, minHeight: 44, padding: '0 16px', textTransform: 'capitalize' }} data-testid={`button-mood-${m}`}>
              {m}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>B-roll (Veo 3.1 Fast) — fewer but meaningful</h3>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {BROLL_AMOUNTS.map((b) => (
            <button key={b.id} type="button" onClick={() => onChange({ ...choices, brollAmount: b.id })} style={card((choices.brollAmount || 'light') === b.id)} data-testid={`button-broll-${b.id}`}>
              <span style={{ color: (choices.brollAmount || 'light') === b.id ? COLORS.accent : COLORS.text, display: 'block', fontFamily: FONT.heading, fontSize: 14.5, fontWeight: 700 }}>{b.name}</span>
              <span style={{ color: COLORS.secondary, display: 'block', fontSize: 12.5, marginTop: 4 }}>{b.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, margin: 0 }}>Avatar options</h3>
        <label style={{ alignItems: 'center', color: COLORS.secondary, cursor: 'pointer', display: 'flex', fontFamily: FONT.body, fontSize: 14, gap: 10, minHeight: 44 }}>
          <input
            type="checkbox"
            checked={choices.transparentBg === true}
            onChange={(e) => onChange({ ...choices, transparentBg: e.target.checked })}
            style={{ accentColor: COLORS.accent, height: 18, width: 18 }}
            data-testid="checkbox-transparent"
          />
          Transparent avatar background (when HeyGen allows it — otherwise the brand backdrop is used and you'll see a note)
        </label>
        <div style={{ color: COLORS.muted, fontSize: 12.5 }}>
          Gesture &amp; emotion are adjusted automatically by the script agent from what you wrote — nothing to configure.
        </div>
      </section>

      <section>
        <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 16, fontWeight: 600, margin: '0 0 10px' }}>Target length</h3>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <input
            type="range"
            min={30}
            max={570}
            step={15}
            value={targetSeconds}
            onChange={(e) => onTargetChange(Number(e.target.value))}
            style={{ accentColor: COLORS.accent, flex: 1, minWidth: 200 }}
            data-testid="input-target-length"
          />
          <span style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 15, fontWeight: 700, minWidth: 90 }}>
            {Math.floor(targetSeconds / 60)}:{String(targetSeconds % 60).padStart(2, '0')} min
          </span>
        </div>
        <p style={{ color: COLORS.muted, fontSize: 12.5, margin: '8px 0 0' }}>
          The real length follows your script; this guides the idea-to-script writer. Long videos are generated in chunks and stitched on the timeline.
        </p>
      </section>

      <section style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: 16 }}>
        <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>One pass → both formats</h3>
        <p style={{ color: COLORS.secondary, fontSize: 13.5, lineHeight: '20px', margin: 0 }}>
          These choices are made once. SceneForge renders a 16:9 master <em>and</em> a native 9:16 portrait layout from the same edit plan —
          the portrait is re-laid-out for vertical, not cropped — and both stay in sync when you edit shared elements later.
        </p>
        <p style={{ color: COLORS.accent, fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 700, margin: '10px 0 0' }}>
          Estimated cost: {describeCost(estimatedSeconds)} (charged once for both formats, when generation starts)
        </p>
      </section>
    </div>
  );
}
