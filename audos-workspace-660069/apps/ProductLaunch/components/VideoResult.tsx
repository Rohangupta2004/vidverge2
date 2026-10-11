// VideoResult — the finished film, and the receipts.
//
// The video is the deliverable, but the run is also an argument: the concept
// that was chosen, the score it ended on, why the loop stopped and what the
// critic still thinks is wrong. All of it stays visible, because a creator
// deciding whether to run it again needs the reasoning, not just the file.

import { useState } from 'react';
import { Code2, Download, Film, RefreshCw } from 'lucide-react';

import { explainDecision, type IterationRecord } from '../lib/iteration-manager';
import { filmSecondsOf } from '../pipeline/render';
import type { CriticOutput } from '../types/critic.types';
import type { FilmSpec } from '../types/film-spec.types';
import {
  ACCENT,
  BORDER,
  CARD_BG,
  GhostButton,
  MUTED,
  PANEL,
  PrimaryButton,
  Spinner,
  TEXT,
} from './LaunchUi';
import FilmSpecViewer from './FilmSpecViewer';

function Stat(props: { label: string; value: string; tint?: string }) {
  return (
    <div
      style={{
        flex: '1 1 130px',
        padding: '14px 16px',
        borderRadius: 14,
        background: CARD_BG,
        border: '1px solid ' + BORDER,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          marginTop: 7,
          fontSize: 21,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: props.tint || TEXT,
        }}
      >
        {props.value}
      </div>
    </div>
  );
}

export default function VideoResult(props: {
  videoUrl: string;
  spec: FilmSpec;
  critic: CriticOutput | null;
  frameCount: number;
  stopReason: string;
  history: IterationRecord[];
  filmCode: string;
  codeSource: 'model' | 'printed';
  onRestart: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [showCode, setShowCode] = useState(false);

  const download = async (): Promise<void> => {
    setDownloading(true);
    setDownloadError('');
    try {
      // A real blob download rather than a target=_blank link: the render
      // service serves from another origin, where a download attribute is
      // ignored and the browser simply navigates away from the app.
      const response = await fetch(props.videoUrl);
      if (!response.ok) throw new Error('The file answered HTTP ' + String(response.status));
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = (props.spec.product_name || 'launch-film')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-launch-film.mp4';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  };

  const score = props.critic ? props.critic.overall_score : null;

  return (
    <section style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div
        style={{
          borderRadius: 18,
          overflow: 'hidden',
          border: '1px solid ' + BORDER,
          background: '#05060A',
          aspectRatio: '16 / 9',
        }}
      >
        <video
          src={props.videoUrl}
          controls
          playsInline
          style={{ width: '100%', height: '100%', display: 'block', background: '#05060A' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="Runtime" value={filmSecondsOf(props.frameCount).toFixed(1) + 's'} />
        <Stat label="Scenes" value={String(props.spec.scenes.length)} />
        <Stat
          label="Critic score"
          value={score === null ? 'not scored' : score.toFixed(2)}
          tint={score === null ? MUTED : score >= 0.8 ? '#166534' : score >= 0.6 ? ACCENT : '#991B1B'}
        />
        <Stat label="Iterations" value={String(Math.max(1, props.history.length))} />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <PrimaryButton onClick={download} busy={downloading}>
          {downloading ? <>Preparing…</> : <><Download size={15} /> Download MP4</>}
        </PrimaryButton>
        <GhostButton onClick={props.onRestart}>
          <RefreshCw size={14} /> Generate another concept
        </GhostButton>
        <GhostButton onClick={() => setShowCode(!showCode)}>
          <Code2 size={14} /> {showCode ? 'Hide Film.tsx' : 'Show Film.tsx'}
        </GhostButton>
        {downloading ? <Spinner /> : null}
      </div>

      {downloadError ? (
        <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger, #F87171)' }}>
          {'The download could not start: ' + downloadError}
        </div>
      ) : null}

      <div style={{ ...PANEL, padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
          <Film size={15} style={{ color: ACCENT }} />
          <span style={{ fontSize: 14, fontWeight: 750, color: TEXT }}>Why the pipeline stopped here</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: MUTED }}>
          {explainDecision(props.stopReason)}
          {props.codeSource === 'printed'
            ? ' The film was printed directly from the validated component plan after the code'
              + ' step could not produce a file that passed the compile gate.'
            : ''}
        </p>

        {props.history.length > 1 ? (
          <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0 }}>
            {props.history.map((record) => (
              <li
                key={'h' + String(record.iteration)}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'baseline',
                  padding: '8px 0',
                  borderTop: '1px solid ' + BORDER,
                  fontSize: 12.5,
                  color: MUTED,
                }}
              >
                <span style={{ fontWeight: 700, color: TEXT }}>
                  {'Iteration ' + String(record.iteration)}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {record.critic.overall_score.toFixed(2)}
                  {record.critic.improvement_delta === null
                    ? ''
                    : '  (' + (record.critic.improvement_delta >= 0 ? '+' : '')
                      + record.critic.improvement_delta.toFixed(3) + ')'}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{record.critic.single_biggest_problem}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {props.critic && props.critic.film_level_issues.length ? (
        <div style={{ ...PANEL, padding: '18px 22px' }}>
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
            What the critic would still change
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {props.critic.film_level_issues.map((issue, index) => (
              <li key={'fi' + String(index)} style={{ fontSize: 12.5, lineHeight: 1.55, color: MUTED }}>
                <span style={{ color: TEXT, fontWeight: 650 }}>{issue.dimension + ': '}</span>
                {issue.fix_instruction || issue.finding}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FilmSpecViewer spec={props.spec} defaultOpen={false} />

      {showCode ? (
        <pre
          style={{
            ...PANEL,
            margin: 0,
            padding: '18px 20px',
            maxHeight: 460,
            overflow: 'auto',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11.5,
            lineHeight: 1.6,
            color: TEXT,
            whiteSpace: 'pre',
          }}
        >
          {props.filmCode}
        </pre>
      ) : null}
    </section>
  );
}
