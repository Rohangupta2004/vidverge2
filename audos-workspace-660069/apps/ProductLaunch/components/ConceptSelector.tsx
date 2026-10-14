// ConceptSelector — the one creative decision a person can take over.
//
// Everything downstream of this point is expensive, so this is the cheapest
// possible moment to disagree with the machine. It auto-selects the highest
// concept_score after five seconds, because the default behaviour of the
// pipeline is to be autonomous — the countdown is an opt-in, not a gate.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';

import type { ConceptAudit } from '../pipeline/select-concept';
import { filmSeconds, type FilmSpec } from '../types/film-spec.types';
import {
  ACCENT,
  BORDER,
  CARD_BG,
  GhostButton,
  MUTED,
  PrimaryButton,
  TEXT,
} from './LaunchUi';
import FilmSpecViewer from './FilmSpecViewer';

/** How long the creator has before the pipeline takes its own advice. */
export const AUTO_SELECT_MS = 5000;

const WARN = 'var(--space-semantic-warning, #FBBF24)';

function ScoreBar(props: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, props.score)) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div
        style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.07)',
          overflow: 'hidden',
          minWidth: 60,
        }}
      >
        <div style={{ width: String(pct) + '%', height: '100%', background: ACCENT }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>
        {props.score.toFixed(2)}
      </span>
    </div>
  );
}

function ConceptCard(props: {
  audit: ConceptAudit;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { spec } = props.audit;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '18px 20px',
        borderRadius: 16,
        border: '1px solid ' + (props.selected ? ACCENT : BORDER),
        background: props.selected
          ? 'color-mix(in srgb, var(--space-brand-primary-500, #D4920A) 9%, transparent)'
          : CARD_BG,
        color: TEXT,
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: props.selected ? ACCENT : 'rgba(255,255,255,0.07)',
            color: props.selected ? 'var(--space-text-on-primary, #FFFFFF)' : MUTED,
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {props.selected ? <Check size={12} /> : String(props.index + 1)}
        </span>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 750, letterSpacing: '-0.02em' }}>
          {spec.narrative_arc}
        </span>
      </div>

      <ScoreBar score={spec.concept_score} />

      <p style={{ margin: '12px 0 0', fontSize: 12.5, lineHeight: 1.55, color: MUTED }}>
        {spec.concept_rationale}
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          marginTop: 12,
          fontSize: 11.5,
          color: MUTED,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>{String(spec.scenes.length) + ' scenes'}</span>
        <span>{filmSeconds(spec).toFixed(1) + 's'}</span>
        <span>{'assets ' + String(Math.round(props.audit.asset_coverage * 100)) + '% covered'}</span>
        <span>{String(spec.risks.length) + ' risk(s)'}</span>
      </div>

      {props.audit.warnings.length ? (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, #B45309 34%, transparent)',
            background: 'color-mix(in srgb, #B45309 10%, transparent)',
            display: 'flex',
            gap: 9,
          }}
        >
          <AlertTriangle size={14} style={{ color: WARN, flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, lineHeight: 1.5, color: WARN }}>
            {props.audit.warnings.join(' ')}
          </div>
        </div>
      ) : null}
    </button>
  );
}

export default function ConceptSelector(props: {
  audits: ConceptAudit[];
  onConfirm: (spec: FilmSpec) => void;
  autoSelectMs?: number;
}) {
  const autoMs = props.autoSelectMs === undefined ? AUTO_SELECT_MS : props.autoSelectMs;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [remaining, setRemaining] = useState(Math.ceil(autoMs / 1000));
  const [paused, setPaused] = useState(autoMs <= 0);
  const confirmed = useRef(false);

  const confirm = (spec: FilmSpec): void => {
    if (confirmed.current) return;
    confirmed.current = true;
    props.onConfirm(spec);
  };

  useEffect(() => {
    if (paused || !props.audits.length) return undefined;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          confirm(props.audits[selectedIndex].spec);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // selectedIndex is read through the closure on the tick that fires, which
    // is what makes a late click still decide the outcome.
  }, [paused, props.audits, selectedIndex]);

  if (!props.audits.length) return null;
  const selected = props.audits[selectedIndex];

  return (
    <section style={{ maxWidth: 820, margin: '0 auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: '-0.025em', color: TEXT }}>
          {String(props.audits.length) + ' competing concepts'}
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: MUTED }}>
          Opus scored these itself. The highest score is pre-selected and the pipeline will take it
          {paused ? '.' : ' in ' + String(remaining) + 's.'}
          {' Pick a different one to overrule it — this is the last cheap decision in the run.'}
        </p>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {props.audits.map((audit, index) => (
          <ConceptCard
            key={audit.spec.narrative_arc + String(index)}
            audit={audit}
            index={index}
            selected={index === selectedIndex}
            onSelect={() => { setSelectedIndex(index); setPaused(true); }}
          />
        ))}
      </div>

      <div style={{ marginTop: 18 }}>
        <FilmSpecViewer spec={selected.spec} defaultOpen={false} compact />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
        <PrimaryButton onClick={() => confirm(selected.spec)}>
          {paused ? 'Build this concept' : 'Build it now'}
        </PrimaryButton>
        {paused ? null : (
          <GhostButton onClick={() => setPaused(true)}>Hold on, let me read</GhostButton>
        )}
      </div>
    </section>
  );
}
