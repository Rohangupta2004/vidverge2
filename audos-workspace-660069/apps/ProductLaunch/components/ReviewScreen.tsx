// SCREEN 4 — REVIEW & DOWNLOAD.
//
// The finished MP4, and the contact-sheet verdict on it. Frames are pulled
// back out of the rendered file, stitched into one grid, and read by Claude
// Opus 5 in a single vision call — so the score on this screen is a judgement
// about THIS render, not a generic checklist. There is no poster image and no
// placeholder thumbnail anywhere here: every pixel shown is from the file.

import { useRef, useState } from 'react';
import {
  AlertTriangle, Download, Grid2X2, RotateCcw, Sparkles, Volume2, VolumeX,
} from 'lucide-react';
import type { LaunchScript } from '../lib/launchTypes';
import type { ContactSheet } from '../lib/renderPipeline';
import type { SheetVerdict } from '../lib/opusClient';
import { ACCENT, BORDER, CARD_BG, ErrorNote, GhostButton, MUTED, PANEL, PrimaryButton, Spinner, TEXT } from './LaunchUi';

export type AnalysisState = 'idle' | 'sampling' | 'stitching' | 'reading' | 'done' | 'failed';

export interface AnalysisProgress {
  state: AnalysisState;
  framesDone: number;
  framesTotal: number;
  sheet: ContactSheet | null;
  verdict: SheetVerdict | null;
  error: string;
}

const ANALYSIS_LABEL: Record<AnalysisState, string> = {
  idle: 'Waiting for the render.',
  sampling: 'Pulling frames out of the finished file…',
  stitching: 'Stitching the frames into one contact sheet…',
  reading: 'Claude Opus 5 is reading the sheet…',
  done: 'Reviewed.',
  failed: 'The review could not be completed.',
};

function scoreColor(score: number): string {
  if (score >= 8) return 'var(--space-semantic-success, #4ADE80)';
  if (score >= 7) return ACCENT;
  return 'var(--space-semantic-danger, #F87171)';
}

function SheetPreview(props: { sheet: ContactSheet }) {
  const { sheet } = props;
  if (sheet.dataUrl) {
    return (
      <img
        src={sheet.dataUrl}
        alt="Contact sheet of every sampled frame"
        style={{ width: '100%', display: 'block', borderRadius: 12, border: '1px solid ' + BORDER }}
      />
    );
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(' + sheet.columns + ', 1fr)',
        gap: 3,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid ' + BORDER,
      }}
    >
      {sheet.frames.map((frame) => (
        <img
          key={frame.url}
          src={frame.url}
          alt={'Frame at ' + frame.timestamp.toFixed(2) + 's'}
          style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'cover' }}
        />
      ))}
    </div>
  );
}

export default function ReviewScreen(props: {
  videoUrl: string;
  script: LaunchScript;
  analysis: AnalysisProgress;
  onRegenerate: () => void;
  onBackToComposition: () => void;
  onRetryAnalysis: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const toggleSound = () => {
    const element = videoRef.current;
    if (!element) return;
    const next = !muted;
    element.muted = next;
    if (!next) element.play().catch(() => undefined);
    setMuted(next);
  };

  const download = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      const response = await fetch(props.videoUrl);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = (props.script.title || 'launch-film').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.mp4';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(href), 4000);
    } catch {
      // A cross-origin file the browser will not hand over as a blob still
      // opens perfectly well in a tab, where the native controls can save it.
      window.open(props.videoUrl, '_blank', 'noopener');
      setDownloadError('Your browser opened the file in a new tab instead of saving it directly.');
    } finally {
      setDownloading(false);
    }
  };

  const { analysis } = props;
  const working = analysis.state === 'sampling' || analysis.state === 'stitching' || analysis.state === 'reading';
  const verdict = analysis.verdict;
  const weak = Boolean(verdict && verdict.score < 7);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '8px 0 48px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: TEXT, margin: '0 0 18px' }}>
        {props.script.title}
      </h1>

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 620px', minWidth: 320 }}>
          <div style={{ ...PANEL, padding: 0, overflow: 'hidden', background: '#05070C', position: 'relative' }}>
            <video
              ref={videoRef}
              src={props.videoUrl}
              autoPlay
              muted
              loop
              playsInline
              controls
              style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', background: '#05070C' }}
            />
            <button
              type="button"
              onClick={toggleSound}
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 14px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(5,7,12,0.72)',
                color: '#F1F5F9',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
              }}
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              {muted ? 'Unmute' : 'Mute'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <PrimaryButton onClick={download} busy={downloading}>
              <Download size={16} />
              Download MP4
            </PrimaryButton>
            <GhostButton onClick={props.onRegenerate}>
              <RotateCcw size={15} />
              Regenerate
            </GhostButton>
            <GhostButton onClick={props.onBackToComposition}>Back to the composition</GhostButton>
          </div>
          {downloadError ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: MUTED }}>{downloadError}</div>
          ) : null}
        </div>

        <div style={{ flex: '1 1 380px', minWidth: 300 }}>
          <div style={{ ...PANEL, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
              <Grid2X2 size={16} style={{ color: ACCENT }} />
              <span style={{ fontSize: 13, fontWeight: 750, color: TEXT }}>Contact-sheet review</span>
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55, marginBottom: 16 }}>
              {working ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Spinner size={13} />
                  {ANALYSIS_LABEL[analysis.state]}
                  {analysis.state === 'sampling' && analysis.framesTotal
                    ? ' ' + analysis.framesDone + '/' + analysis.framesTotal
                    : ''}
                </span>
              ) : (
                ANALYSIS_LABEL[analysis.state]
              )}
            </div>

            {analysis.sheet ? <SheetPreview sheet={analysis.sheet} /> : null}

            {analysis.sheet && analysis.sheet.blockedReason ? (
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8 }}>
                {analysis.sheet.blockedReason} The frames were sent to Opus individually instead.
              </div>
            ) : null}

            {verdict ? (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 40, fontWeight: 850, color: scoreColor(verdict.score), letterSpacing: '-0.04em' }}>
                    {verdict.score.toFixed(1)}
                  </span>
                  <span style={{ fontSize: 13, color: MUTED }}>/ 10 from Claude Opus 5 vision</span>
                </div>

                {verdict.issues.length ? (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
                      Issues
                    </div>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: TEXT, fontSize: 13, lineHeight: 1.6 }}>
                      {verdict.issues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  </div>
                ) : null}

                {verdict.suggestions.length ? (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
                      Suggestions
                    </div>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: TEXT, fontSize: 13, lineHeight: 1.6 }}>
                      {verdict.suggestions.map((hint) => <li key={hint}>{hint}</li>)}
                    </ul>
                  </div>
                ) : null}

                {weak ? (
                  <div
                    style={{
                      marginTop: 18,
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: '1px solid ' + BORDER,
                      background: CARD_BG,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <AlertTriangle size={15} style={{ color: 'var(--space-semantic-danger, #F87171)' }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Worth another pass</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55, marginBottom: 12 }}>
                      Opus scored this below 7. Regenerating writes a fresh script from the same brief —
                      your inputs are kept, so you can adjust one line and run it again.
                    </div>
                    <PrimaryButton onClick={props.onRegenerate}>
                      <Sparkles size={15} />
                      Regenerate the film
                    </PrimaryButton>
                  </div>
                ) : null}
              </div>
            ) : null}

            <ErrorNote>{analysis.error}</ErrorNote>

            {analysis.state === 'failed' ? (
              <div style={{ marginTop: 14 }}>
                <GhostButton onClick={props.onRetryAnalysis}>Run the review again</GhostButton>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
