/**
 * Short Video Enhancer — the caption tier editor.
 *
 * One row per caption line: when it is spoken, what it says, which of the
 * five treatments is drawing it, and — on the two tiers that have a key word
 * — which word takes the accent and the pop.
 *
 * The dropdown's first option is Auto, which is NOT a sixth tier: it hands
 * the line back to the 70/20/10 mix and shows, in the option label, what the
 * mix chose. Anything else is a hand assignment that the mix will never
 * override, and the row says so with a filled swatch.
 *
 * The meter at the top is the point of the whole panel. A premium edit is a
 * ratio, not a setting, and a creator cannot hold that ratio in their head
 * while scrubbing — so the mix is measured for them against the brief's
 * 70% clean / 20% kinetic / 10% display and labelled honestly either way.
 */

import { RotateCcw } from 'lucide-react';
import { formatClock, type CaptionCue, type CaptionTier, type CaptionTierMode } from '../lib/sveTypes';
import {
  CAPTION_TIER_IDS, CAPTION_TIER_MODES, CAPTION_TIER_OPTIONS, TIER_COLORS, TIER_LABELS,
  cueKey, emphasisIndex, tierMix,
} from '../lib/sveCaptionTiers';
import { Pills } from '../lib/sveProUi';

export interface SveTierPanelProps {
  /** Cues with their tiers already resolved — exactly what the preview draws. */
  cues: CaptionCue[];
  mode: CaptionTierMode;
  tierOverrides: Record<string, CaptionTier>;
  emphasisOverrides: Record<string, number>;
  currentTime: number;
  onMode: (mode: CaptionTierMode) => void;
  /** `null` returns the line to the automatic mix. */
  onSetTier: (key: string, tier: CaptionTier | null) => void;
  /** `null` returns the line to the automatically picked key word. */
  onSetEmphasis: (key: string, index: number | null) => void;
  onResetAll: () => void;
  onSeek: (t: number) => void;
}

function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

export default function SveTierPanel(props: SveTierPanelProps) {
  const { cues } = props;
  const mix = tierMix(cues);
  const handSet = cues.filter((cue) => props.tierOverrides[cueKey(cue)]).length;

  if (!cues.length) {
    return (
      <p className="vp-note">
        Generate captions first — the tier mix is assigned over the real cue list, so there is nothing to
        spread across the five treatments yet.
      </p>
    );
  }

  return (
    <>
      <Pills
        options={CAPTION_TIER_MODES.map((m) => ({ id: m.id, label: m.label, title: m.hint }))}
        value={props.mode}
        onPick={props.onMode}
      />
      <p className="vp-note">
        {props.mode === 'auto'
          ? 'Lines are spread 70% clean, 20% kinetic and 10% display. A row of numbers takes the Timeline treatment and a shouted line takes Impact whatever the ratio says.'
          : 'Every line starts on Clean. Assign the louder treatments yourself, line by line, below.'}
      </p>

      <div>
        <div className="sve-tiermix" role="img" aria-label={pct(mix.clean) + '% clean, ' + pct(mix.kinetic) + '% kinetic, ' + pct(mix.display) + '% display'}>
          {CAPTION_TIER_IDS.map((tier) => {
            const count = cues.filter((c) => (c.tier || 'clean') === tier).length;
            if (!count) return null;
            return (
              <i
                key={tier}
                title={count + ' ' + TIER_LABELS[tier] + ' line' + (count === 1 ? '' : 's')}
                style={{ flexGrow: count, background: TIER_COLORS[tier] }}
              />
            );
          })}
        </div>
        <p className={'vp-note' + (mix.onBrief ? ' good' : '')} style={{ marginTop: 5 }}>
          {pct(mix.clean)}% clean · {pct(mix.kinetic)}% kinetic · {pct(mix.display)}% display across {mix.total} line
          {mix.total === 1 ? '' : 's'}.{' '}
          {mix.onBrief
            ? 'On brief — this reads as an intentional edit.'
            : 'The brief is 70 / 20 / 10; nudge a few lines below to get there.'}
        </p>
      </div>

      {handSet > 0 ? (
        <button
          type="button"
          className="vp-btn xs"
          title="Hand every line back to the automatic mix"
          onClick={props.onResetAll}
        >
          <RotateCcw size={11} /> Reset {handSet} hand-set line{handSet === 1 ? '' : 's'}
        </button>
      ) : null}

      <div className="sve-tierlist">
        {cues.map((cue) => {
          const key = cueKey(cue);
          const tier: CaptionTier = cue.tier || 'clean';
          const assigned = !!props.tierOverrides[key];
          const live = props.currentTime >= cue.start && props.currentTime <= cue.end;
          const text = cue.words.map((w) => w.text).join(' ');
          // Only the two tiers that colour a single word are worth offering a
          // word picker for: Clean and Impact accent nothing, and Timeline
          // accents every digit rather than one chosen token.
          const picksWord = tier === 'kinetic' || tier === 'cinematic';
          const picked = emphasisIndex(cue);

          return (
            <div
              key={cue.id}
              className={'sve-tierrow' + (live ? ' live' : '') + (assigned ? ' assigned' : '')}
            >
              <div className="sve-tierhead">
                <button
                  type="button"
                  className="sve-tiertime"
                  title={'Move the playhead to this line and watch it in the preview'}
                  onClick={() => props.onSeek(cue.start + 0.01)}
                >
                  {formatClock(cue.start)}
                </button>
                <span className="sve-tierdot" style={{ background: TIER_COLORS[tier] }} />
                <span className="sve-tiertext" title={text}>{text}</span>
                <select
                  className="vp-select sve-tierpick"
                  aria-label={'Caption tier for the line at ' + formatClock(cue.start)}
                  title={assigned
                    ? 'You assigned this line the ' + TIER_LABELS[tier] + ' treatment'
                    : 'The automatic mix gave this line the ' + TIER_LABELS[tier] + ' treatment'}
                  value={assigned ? tier : 'auto'}
                  onChange={(e) => props.onSetTier(
                    key,
                    e.target.value === 'auto' ? null : (e.target.value as CaptionTier),
                  )}
                >
                  <option value="auto">Auto · {TIER_LABELS[tier]}</option>
                  {CAPTION_TIER_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>

              {picksWord ? (
                <div className="sve-tierwords">
                  <span className="sve-tierwlab">{tier === 'kinetic' ? 'Pops' : 'Accent'}</span>
                  {cue.words.map((word, i) => (
                    <button
                      key={cue.id + '-w' + i}
                      type="button"
                      className={'sve-tierword' + (i === picked ? ' on' : '')}
                      title={i === picked && props.emphasisOverrides[key] === i
                        ? 'Click again to let the editor pick the key word'
                        : 'Make “' + word.text + '” the word that takes the accent'}
                      onClick={() => props.onSetEmphasis(
                        key,
                        props.emphasisOverrides[key] === i ? null : i,
                      )}
                    >
                      {word.text}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
