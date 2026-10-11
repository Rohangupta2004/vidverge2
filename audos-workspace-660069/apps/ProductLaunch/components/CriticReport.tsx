// CriticReport — the verdict, between one render and the next.
//
// The default action is whatever the iteration manager already decided; the
// countdown just gives the creator eight seconds to disagree. Stopping the
// loop costs nothing and continuing it costs a render, so the recommendation
// is always shown with its reason attached rather than as a bare button.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { explainDecision, type IterationDecision } from '../lib/iteration-manager';
import type { CriticOutput, Priority } from '../types/critic.types';
import {
  ACCENT,
  BORDER,
  CARD_BG,
  GhostButton,
  MUTED,
  PANEL,
  PrimaryButton,
  TEXT,
} from './LaunchUi';

/** How long before the pipeline acts on the iteration manager's decision. */
export const AUTO_PROCEED_MS = 8000;

const PRIORITY_COLOR: Record<Priority, string> = {
  critical: '#991B1B',
  high: '#B45309',
  low: '#1D4ED8',
  none: '#166534',
};

function ScoreMeter(props: { score: number; delta: number | null }) {
  const pct = Math.round(Math.max(0, Math.min(1, props.score)) * 100);
  const delta = props.delta;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: '-0.04em', color: TEXT }}>
          {props.score.toFixed(2)}
        </span>
        {delta === null ? (
          <span style={{ fontSize: 12, color: MUTED }}>first pass — nothing to compare against</span>
        ) : (
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: delta >= 0 ? '#166534' : '#991B1B',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {(delta >= 0 ? '+' : '') + delta.toFixed(3) + ' vs last cut'}
          </span>
        )}
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(180,120,0,0.14)', overflow: 'hidden' }}>
        <div
          style={{
            width: String(pct) + '%',
            height: '100%',
            background: props.score >= 0.8 ? '#166534' : props.score >= 0.6 ? ACCENT : '#991B1B',
            transition: 'width 320ms ease',
          }}
        />
      </div>
    </div>
  );
}

function PriorityDot(props: { priority: Priority }) {
  return (
    <span
      title={props.priority}
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        flexShrink: 0,
        display: 'inline-block',
        background: PRIORITY_COLOR[props.priority],
      }}
    />
  );
}

function SectionLabel(props: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: MUTED,
        marginBottom: 10,
      }}
    >
      {props.children}
    </div>
  );
}

export default function CriticReport(props: {
  critic: CriticOutput;
  decision: IterationDecision;
  iteration: number;
  maxIterations: number;
  onRevise: () => void;
  onShip: () => void;
  autoProceedMs?: number;
}) {
  const autoMs = props.autoProceedMs === undefined ? AUTO_PROCEED_MS : props.autoProceedMs;
  const [remaining, setRemaining] = useState(Math.ceil(autoMs / 1000));
  const [paused, setPaused] = useState(autoMs <= 0);
  const acted = useRef(false);
  const { critic, decision } = props;

  const act = (continueLoop: boolean): void => {
    if (acted.current) return;
    acted.current = true;
    if (continueLoop) props.onRevise();
    else props.onShip();
  };

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          act(decision.shouldContinue);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [paused, decision.shouldContinue]);

  return (
    <section style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...PANEL, padding: '22px 24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <SectionLabel>
              {'Critic verdict · iteration ' + String(props.iteration) + ' of ' + String(props.maxIterations)}
            </SectionLabel>
            <ScoreMeter score={critic.overall_score} delta={critic.improvement_delta} />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '9px 14px',
              borderRadius: 999,
              border: '1px solid color-mix(in srgb, '
                + (critic.shippable ? '#166534' : '#B45309') + ' 40%, transparent)',
              background: 'color-mix(in srgb, '
                + (critic.shippable ? '#166534' : '#B45309') + ' 12%, transparent)',
              color: critic.shippable ? '#166534' : '#B45309',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {critic.shippable
              ? <CheckCircle2 size={15} />
              : <AlertTriangle size={15} />}
            {critic.shippable ? 'Shippable' : 'Not shippable yet'}
          </div>
        </div>

        <div
          style={{
            marginTop: 20,
            padding: '16px 18px',
            borderRadius: 14,
            background: CARD_BG,
            border: '1px solid ' + BORDER,
          }}
        >
          <SectionLabel>The single biggest problem</SectionLabel>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, fontWeight: 600, color: TEXT }}>
            {critic.single_biggest_problem}
          </p>
        </div>

        {critic.director_note ? (
          <p style={{ margin: '16px 0 0', fontSize: 13.5, lineHeight: 1.6, color: MUTED }}>
            {critic.director_note}
          </p>
        ) : null}
      </div>

      {critic.what_is_working.length ? (
        <div style={{ ...PANEL, padding: '18px 22px' }}>
          <SectionLabel>What is working</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {critic.what_is_working.map((entry, index) => (
              <li key={'w' + String(index)} style={{ fontSize: 13, lineHeight: 1.55, color: TEXT }}>
                {entry}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {critic.scene_assessments.length ? (
        <div style={{ ...PANEL, padding: '18px 22px' }}>
          <SectionLabel>Scene by scene</SectionLabel>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {critic.scene_assessments.map((scene) => (
              <li
                key={scene.scene_id}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '11px 0',
                  borderTop: '1px solid ' + BORDER,
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ marginTop: 6 }}><PriorityDot priority={scene.fix_priority} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>{scene.scene_id}</span>
                    <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                      {scene.score.toFixed(2)}
                      {scene.treatment_achieved ? ' · treatment achieved' : ' · treatment missed'}
                    </span>
                  </div>
                  {scene.issues.length ? (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                      {scene.issues.map((issue, index) => (
                        <li key={'i' + String(index)} style={{ fontSize: 12.5, lineHeight: 1.5, color: MUTED }}>
                          {issue}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {critic.film_level_issues.length ? (
        <div style={{ ...PANEL, padding: '18px 22px' }}>
          <SectionLabel>Film-level issues</SectionLabel>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {critic.film_level_issues.map((issue, index) => (
              <li
                key={'f' + String(index)}
                style={{ display: 'flex', gap: 12, padding: '11px 0', borderTop: '1px solid ' + BORDER }}
              >
                <span style={{ marginTop: 6 }}><PriorityDot priority={issue.priority} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>{issue.dimension}</div>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: MUTED }}>
                    {issue.finding}
                  </p>
                  {issue.fix_instruction ? (
                    <p style={{ margin: '5px 0 0', fontSize: 12.5, lineHeight: 1.5, color: ACCENT }}>
                      {'Fix: ' + issue.fix_instruction}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ ...PANEL, padding: '18px 22px' }}>
        <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.55, color: MUTED }}>
          {explainDecision(decision.reason)}
          {paused ? '' : ' Proceeding automatically in ' + String(remaining) + 's.'}
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {decision.shouldContinue ? (
            <>
              <PrimaryButton onClick={() => act(true)}>Revise and re-render</PrimaryButton>
              <GhostButton onClick={() => act(false)}>Ship this version</GhostButton>
            </>
          ) : (
            <>
              <PrimaryButton onClick={() => act(false)}>Ship this version</PrimaryButton>
              {props.iteration < props.maxIterations ? (
                <GhostButton onClick={() => act(true)}>Revise anyway</GhostButton>
              ) : null}
            </>
          )}
          {paused ? null : <GhostButton onClick={() => setPaused(true)}>Wait</GhostButton>}
        </div>
      </div>
    </section>
  );
}
