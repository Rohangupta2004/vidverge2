// SCREEN 2 — AI GENERATION.
//
// The progress on this screen is REAL. Each row is one awaited piece of work
// and flips state only when that promise settles; the elapsed clock counts
// actual wall time. There is no setTimeout pretending to be a pipeline and no
// percentage invented to fill the wait — a bar that cannot know how far along
// it is sweeps instead of lying.

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Clapperboard } from 'lucide-react';
import { filmSeconds, planTiming } from '../lib/filmTiming';
import { PREVIEW_FPS, type LaunchScript } from '../lib/launchTypes';
import { ACCENT, BORDER, CARD_BG, ErrorNote, GhostButton, MUTED, PANEL, PrimaryButton, Spinner, TEXT } from './LaunchUi';

export type PhaseState = 'waiting' | 'running' | 'done' | 'failed';

export interface GenerationPhase {
  id: string;
  label: string;
  detail: string;
  state: PhaseState;
  /** Measured, not estimated: how long this step actually took. */
  ms: number;
}

function PhaseRow(props: { phase: GenerationPhase; liveMs: number }) {
  const { phase } = props;
  const running = phase.state === 'running';
  const shown = running ? props.liveMs : phase.ms;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '16px 18px',
        borderTop: '1px solid ' + BORDER,
      }}
    >
      <div style={{ width: 22, paddingTop: 1 }}>
        {phase.state === 'done' ? <Check size={18} style={{ color: 'var(--space-semantic-success, #4ADE80)' }} /> : null}
        {phase.state === 'failed' ? <AlertTriangle size={18} style={{ color: 'var(--space-semantic-danger, #F87171)' }} /> : null}
        {running ? <Spinner size={18} /> : null}
        {phase.state === 'waiting' ? (
          <span style={{ display: 'block', width: 8, height: 8, margin: '5px 5px', borderRadius: 4, background: 'rgba(148,163,184,0.35)' }} />
        ) : null}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14.5,
            fontWeight: 650,
            color: phase.state === 'waiting' ? MUTED : TEXT,
            letterSpacing: '-0.01em',
          }}
        >
          {phase.label}
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>{phase.detail}</div>
        {running ? (
          <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: 'rgba(148,163,184,0.16)', overflow: 'hidden' }}>
            <div
              style={{
                width: '30%',
                height: '100%',
                borderRadius: 2,
                background: ACCENT,
                animation: 'plSweep 1.4s ease-in-out infinite',
              }}
            />
          </div>
        ) : null}
      </div>
      {shown > 0 ? (
        <div style={{ fontSize: 12, color: MUTED, fontVariantNumeric: 'tabular-nums', paddingTop: 2 }}>
          {(shown / 1000).toFixed(1)}s
        </div>
      ) : null}
    </div>
  );
}

function ScriptSummary(props: { script: LaunchScript }) {
  const { script } = props;
  const timing = planTiming(script, PREVIEW_FPS);
  const runtime = filmSeconds(timing);
  return (
    <div style={{ ...PANEL, padding: 24, marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <Clapperboard size={18} style={{ color: ACCENT }} />
        <span style={{ fontSize: 17, fontWeight: 750, color: TEXT, letterSpacing: '-0.02em' }}>{script.title}</span>
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            border: '1px solid ' + BORDER,
            background: script.brandColor || 'transparent',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          ['Scenes', String(script.scenes.length)],
          ['Runtime', runtime.toFixed(1) + 's'],
          ['Pacing', script.pacing],
          ['Frames at 60fps', String(timing.totalFrames)],
        ].map(([label, figure]) => (
          <div key={label}>
            <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>
              {label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 750, color: TEXT, marginTop: 4 }}>{figure}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {script.scenes.map((scene, index) => (
          <div
            key={scene.sceneNumber}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              padding: '11px 14px',
              borderRadius: 11,
              background: CARD_BG,
              border: '1px solid ' + BORDER,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, color: ACCENT, width: 18 }}>{index + 1}</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: TEXT, letterSpacing: '-0.01em' }}>
              {scene.headline || scene.wordRevealLines[0] || ''}
            </span>
            <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: 'nowrap' }}>
              {scene.transitionType} · {scene.durationSeconds}s
            </span>
          </div>
        ))}
      </div>

      {script.cta ? (
        <div style={{ marginTop: 16, fontSize: 13.5, color: MUTED }}>
          Closing line: <span style={{ color: TEXT, fontWeight: 600 }}>{script.cta}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function GenerateScreen(props: {
  phases: GenerationPhase[];
  startedAt: number;
  script: LaunchScript | null;
  error: string;
  onBack: () => void;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const running = props.phases.some((phase) => phase.state === 'running');
  const [liveMs, setLiveMs] = useState(0);

  // One tick while something is genuinely in flight; it reads the clock rather
  // than advancing a fake counter.
  useEffect(() => {
    if (!running || !props.startedAt) return undefined;
    const settled = props.phases
      .filter((phase) => phase.state === 'done' || phase.state === 'failed')
      .reduce((total, phase) => total + phase.ms, 0);
    const tick = () => setLiveMs(Math.max(0, Date.now() - props.startedAt - settled));
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [running, props.startedAt, props.phases]);

  const total = props.phases.reduce((sum, phase) => sum + phase.ms, 0);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '8px 0 48px' }}>
      <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', color: TEXT, margin: '0 0 8px' }}>
        {props.script ? 'Your film is written.' : 'Claude Opus 5 is writing your film.'}
      </h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.6, color: MUTED, margin: '0 0 24px' }}>
        {props.script
          ? 'Every line below came out of this run. Open the composition to watch it move.'
          : 'Frontier model, extended thinking on. It reads your words, then writes the scenes, the cuts and the colour.'}
      </p>

      <div style={{ ...PANEL, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 18px',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          <span>Pipeline</span>
          {total > 0 ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{(total / 1000).toFixed(1)}s total</span> : null}
        </div>
        {props.phases.map((phase) => (
          <PhaseRow key={phase.id} phase={phase} liveMs={liveMs} />
        ))}
      </div>

      <ErrorNote>{props.error}</ErrorNote>

      {props.script ? <ScriptSummary script={props.script} /> : null}

      <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
        <GhostButton onClick={props.onBack} disabled={running}>
          Change the brief
        </GhostButton>
        {props.error ? (
          <PrimaryButton onClick={props.onRetry} disabled={running}>
            Try again
          </PrimaryButton>
        ) : null}
        {props.script ? (
          <PrimaryButton onClick={props.onContinue}>
            Open the composition
            <ArrowRight size={16} />
          </PrimaryButton>
        ) : null}
      </div>
    </div>
  );
}
