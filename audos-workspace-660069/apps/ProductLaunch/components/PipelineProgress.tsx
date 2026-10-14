// PipelineProgress — the ten steps, live.
//
// Every elapsed time on this list is measured from a real awaited promise.
// Nothing here is a simulated tick: a step that says 4.1s took 4.1 seconds,
// and a step that sits on 'running' for a minute is genuinely still waiting
// on the render farm.

import { AlertTriangle, Check, Circle, Minus } from 'lucide-react';

import VergeLoader from '../../../components/VergeLoader';
import VideoErrorCard from '../../../components/video/VideoErrorCard';
import VideoGeneratingState from '../../../components/video/VideoGeneratingState';

import { formatMs, type PipelineStep } from '../lib/pipeline-events';
import { ACCENT, BORDER, CARD_BG, MUTED, TEXT } from './LaunchUi';

const DANGER = 'var(--space-semantic-danger, #F87171)';
const SUCCESS = 'var(--space-semantic-success, #34D399)';

function StepIcon(props: { state: PipelineStep['state'] }) {
  if (props.state === 'done') return <Check size={14} style={{ color: SUCCESS }} />;
  if (props.state === 'failed') return <AlertTriangle size={14} style={{ color: DANGER }} />;
  if (props.state === 'skipped') return <Minus size={14} style={{ color: MUTED }} />;
  if (props.state === 'running') {
    return <VergeLoader size={24} label="Running" />;
  }
  return <Circle size={9} style={{ color: 'rgba(158,139,85,0.5)' }} />;
}

function Row(props: { step: PipelineStep; onRetry?: () => void }) {
  const { step } = props;
  const running = step.state === 'running';
  const idle = step.state === 'waiting';

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '14px 16px',
        borderRadius: 14,
        border: '1px solid ' + (running ? ACCENT : 'transparent'),
        background: running
          ? 'color-mix(in srgb, var(--space-brand-primary-500, #D4920A) 10%, transparent)'
          : 'transparent',
        opacity: idle ? 0.45 : 1,
        transition: 'opacity 160ms ease',
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          marginTop: 1,
          borderRadius: 11,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid ' + BORDER,
          background: CARD_BG,
        }}
      >
        <StepIcon state={step.state} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 650, color: TEXT, letterSpacing: '-0.01em' }}>
            {step.label}
            {step.attempt > 0 ? (
              <span style={{ color: MUTED, fontWeight: 500 }}>{'  · attempt ' + String(step.attempt)}</span>
            ) : null}
          </span>
          {step.ms ? (
            <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: MUTED }}>
              {formatMs(step.ms)}
            </span>
          ) : null}
        </div>

        {step.detail ? (
          <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.5, color: MUTED, wordBreak: 'break-word' }}>
            {step.detail}
          </div>
        ) : null}

        {step.error ? (
          step.id === 'render' ? (
            <VideoErrorCard
              error={step.error}
              subject="the launch film"
              onRetry={props.onRetry}
              compact
              style={{ marginTop: 9 }}
            />
          ) : (
            <div style={{ marginTop: 9, padding: '10px 12px', borderRadius: 10, border: '1px solid color-mix(in srgb, var(--space-semantic-danger, #f87171) 36%, transparent)', background: 'color-mix(in srgb, var(--space-semantic-danger, #f87171) 10%, transparent)', fontSize: 12.5, lineHeight: 1.55, color: DANGER }}>
              {step.error}
              {props.onRetry ? <button type="button" onClick={props.onRetry} style={{ display: 'block', marginTop: 10, border: '1px solid ' + BORDER, borderRadius: 8, background: CARD_BG, color: TEXT, padding: '7px 12px', cursor: 'pointer' }}>Retry this step</button> : null}
            </div>
          )
        ) : null}
      </div>
    </li>
  );
}

export default function PipelineProgress(props: {
  steps: PipelineStep[];
  iteration: number;
  startedAt: number;
  onRetry?: () => void;
}) {
  const done = props.steps.filter((step) => step.state === 'done').length;
  const failed = props.steps.some((step) => step.state === 'failed');
  const elapsed = props.startedAt ? Date.now() - props.startedAt : 0;
  const runningStep = props.steps.find((step) => step.state === 'running');

  return (
    <section style={{ maxWidth: 760, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: '-0.025em', color: TEXT }}>
            {failed ? 'The pipeline stopped' : 'Building your launch film'}
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: MUTED }}>
            {props.iteration > 1
              ? 'Iteration ' + String(props.iteration) + ' — revising from the critic\'s notes.'
              : 'Opus decides the film. This app executes it.'}
          </p>
        </div>
        <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
          {String(done) + ' / ' + String(props.steps.length)}
          {elapsed ? '  ·  ' + formatMs(elapsed) : ''}
        </span>
      </header>

      {!failed && runningStep?.id === 'render' ? (
        <VideoGeneratingState
          label={runningStep.label}
          detail={runningStep.detail || `Iteration ${props.iteration}`}
          elapsedSeconds={elapsed / 1000}
          style={{ marginBottom: 20 }}
        />
      ) : null}

      <div
        style={{
          height: 3,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.07)',
          overflow: 'hidden',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            height: '100%',
            width: String((done / Math.max(1, props.steps.length)) * 100) + '%',
            background: failed ? DANGER : ACCENT,
            transition: 'width 320ms ease',
          }}
        />
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {props.steps.map((step) => (
          <Row
            key={step.id}
            step={step}
            onRetry={step.state === 'failed' ? props.onRetry : undefined}
          />
        ))}
      </ul>
    </section>
  );
}
