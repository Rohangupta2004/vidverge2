/**
 * Short Video Enhancer — AI suggestions and the optimisation checklist.
 *
 * Two cards that share one idea: tell the creator what the footage actually
 * is, then tell them what it is still missing.
 *
 * The checklist is built from the research the brief cites — roughly 80% of
 * top-performing shorts burn in captions, and the first three seconds decide
 * whether the rest is watched — so each row is a concrete, one-click fix
 * rather than general advice.
 */

import { Check, Eye, Film, Loader2, Palette, Sparkles, Type } from 'lucide-react';
import type { EditDoc, VisionRead } from '../lib/sveTypes';
import type { MotionRead } from '../lib/sveAnalyze';
import { Card, Note } from './SveControls';

export interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  action?: { label: string; run: () => void };
}

/**
 * What the short has versus what it still needs. `motion` is the measured
 * opening-movement read — a clip that already opens on action does not get
 * nagged to add a title card.
 */
export function buildChecklist(
  doc: EditDoc,
  motion: MotionRead | null,
  actions: {
    addHook: () => void;
    addCta: () => void;
    generateCaptions: () => void;
    addMusic: () => void;
    openBroll: () => void;
  },
): ChecklistItem[] {
  const hasHookCard = doc.cards.some((c) => c.kind === 'hook');
  const openingMoves = !!motion && !motion.staticOpening;
  const hasCaptions = doc.captionsEnabled && doc.words.length > 0;
  const hasCta = doc.cards.some((c) => c.kind === 'cta');

  return [
    {
      id: 'hook',
      label: 'Hook in the first 3 seconds',
      detail: hasHookCard
        ? 'A title card opens the video.'
        : openingMoves
          ? 'The opening already moves — no title card needed.'
          : motion
            ? 'The first 3 seconds are visually static. A title card gives viewers a reason to stay.'
            : 'Not measured yet — the opening check runs once the clip is analysed.',
      done: hasHookCard || openingMoves,
      action: hasHookCard || openingMoves ? undefined : { label: 'Add title card hook', run: actions.addHook },
    },
    {
      id: 'captions',
      label: 'Burned-in captions',
      detail: hasCaptions
        ? doc.words.length + ' words timed across the clip.'
        : 'Around 80% of top-performing shorts carry captions — most are watched on mute.',
      done: hasCaptions,
      action: hasCaptions ? undefined : { label: 'Generate captions', run: actions.generateCaptions },
    },
    {
      id: 'music',
      label: 'Music bed under the audio',
      detail: doc.music.url
        ? 'Mixed at ' + doc.audio.music + '% under the original audio.'
        : 'A bed under the dialogue lifts retention without covering the speech.',
      done: !!doc.music.url,
      action: doc.music.url ? undefined : { label: 'Add music', run: actions.addMusic },
    },
    {
      id: 'cta',
      label: 'Closing call to action',
      detail: hasCta
        ? 'A CTA card closes the video.'
        : motion?.abruptEnding
          ? 'The clip stops mid-shot. A contrasting CTA card gives it an ending.'
          : 'Tell viewers what to do next before the clip ends.',
      done: hasCta,
      action: hasCta ? undefined : { label: 'Add CTA card', run: actions.addCta },
    },
    {
      id: 'broll',
      label: 'B-roll over the talking head',
      detail: doc.broll.length
        ? doc.broll.length + ' overlay clip' + (doc.broll.length === 1 ? '' : 's') + ' placed.'
        : 'Cutaways hold attention through longer stretches of talking.',
      done: doc.broll.length > 0,
      action: doc.broll.length ? undefined : { label: 'Open B-roll', run: actions.openBroll },
    },
  ];
}

export function SveOptimizationCard({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((i) => i.done).length;
  const score = Math.round((done / Math.max(1, items.length)) * 100);
  const hue = score >= 80 ? '#166534' : score >= 50 ? '#B45309' : '#991B1B';

  return (
    <Card title="Optimization Tips" icon={<Check size={14} />}>
      <div className="sve-score">
        <div
          className="sve-score-ring"
          style={{ background: 'conic-gradient(' + hue + ' ' + score + '%, rgba(180,120,0,0.16) ' + score + '% 100%)' }}
        >
          <span style={{
            position: 'absolute', inset: 4, borderRadius: '50%', background: '#FFFFFF',
            display: 'grid', placeItems: 'center', fontSize: 10,
          }}>{score}</span>
        </div>
        <div className="sve-score-copy">
          <strong>{done} of {items.length} best practices</strong>
          <small>{score >= 80 ? 'Ready to post.' : 'Each fix below is one click.'}</small>
        </div>
      </div>

      <div className="sve-checklist">
        {items.map((item) => (
          <div key={item.id} className={'sve-check ' + (item.done ? 'done' : '')}>
            <span>{item.done ? <Check size={11} /> : <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
              {item.action && <button onClick={item.action.run}>{item.action.label}</button>}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export interface SuggestionsProps {
  vision: VisionRead | null;
  thumbs: string[];
  analysing: boolean;
  onUseBrollTerm: (term: string) => void;
  onUseCallout: (text: string) => void;
  onUseAccent: (hex: string) => void;
  onRerun: () => void;
  hasSource: boolean;
}

export function SveSuggestionsCard(props: SuggestionsProps) {
  const { vision, analysing } = props;

  return (
    <Card title="AI Suggestions" icon={<Sparkles size={14} />}>
      {props.thumbs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.min(5, props.thumbs.length) + ',1fr)', gap: 4, marginBottom: 10 }}>
          {props.thumbs.slice(0, 5).map((src, i) => (
            <img key={i} src={src} alt={'Sampled frame ' + (i + 1)} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', borderRadius: 5, border: '1px solid rgba(180,120,0,0.14)' }} />
          ))}
        </div>
      )}

      {analysing && (
        <p className="sve-note"><Loader2 size={12} className="spin" /><span>Reading 5 frames with the vision model…</span></p>
      )}

      {!analysing && !vision && props.hasSource && (
        <Note>Scene analysis has not run for this clip yet.</Note>
      )}
      {!analysing && !props.hasSource && <Note>Upload a clip to get B-roll, caption and colour suggestions.</Note>}

      {vision?.note && <Note tone="warn">{vision.note}</Note>}

      {vision && !vision.note && (
        <>
          <div className="sve-pills" style={{ marginBottom: 10 }}>
            {vision.sceneType && <span><Eye size={9} style={{ verticalAlign: '-1px' }} /> {vision.sceneType}</span>}
            {vision.mood && <span>{vision.mood}</span>}
            {vision.objects.slice(0, 3).map((o) => <span key={o}>{o}</span>)}
          </div>

          {vision.keyMoments.length > 0 && (
            <p className="sve-muted" style={{ marginBottom: 10 }}>{vision.keyMoments.join(' · ')}</p>
          )}

          {vision.brollTerms.length > 0 && (
            <>
              <div className="sve-mix-head" style={{ marginBottom: 6 }}><span><Film size={11} style={{ verticalAlign: '-1px' }} /> B-roll keywords</span></div>
              <div className="sve-chiprow">
                {vision.brollTerms.map((term) => (
                  <button key={term} className="sve-chip" onClick={() => props.onUseBrollTerm(term)}>{term}</button>
                ))}
              </div>
            </>
          )}

          {vision.calloutText.length > 0 && (
            <>
              <div className="sve-mix-head" style={{ marginBottom: 6 }}><span><Type size={11} style={{ verticalAlign: '-1px' }} /> Graphic callouts</span></div>
              <div className="sve-chiprow">
                {vision.calloutText.map((text) => (
                  <button key={text} className="sve-chip" onClick={() => props.onUseCallout(text)}>{text}</button>
                ))}
              </div>
            </>
          )}

          {(vision.captionAccent || vision.palette.length > 0) && (
            <>
              <div className="sve-mix-head" style={{ marginBottom: 6 }}><span><Palette size={11} style={{ verticalAlign: '-1px' }} /> Caption colour</span></div>
              <div className="sve-chiprow">
                {[vision.captionAccent, ...vision.palette].filter(Boolean).slice(0, 4).map((hex) => (
                  <button
                    key={hex}
                    className="sve-chip"
                    style={{ borderColor: hex, color: hex }}
                    onClick={() => props.onUseAccent(hex)}
                  >
                    {hex}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {props.hasSource && !analysing && (
        <button className="sve-save" onClick={props.onRerun}>
          <Sparkles size={14} />{vision ? 'Re-run scene analysis' : 'Analyse this clip'}
        </button>
      )}
    </Card>
  );
}
