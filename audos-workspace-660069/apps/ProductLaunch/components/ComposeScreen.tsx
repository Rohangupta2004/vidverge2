// SCREEN 3 — VIDEO COMPOSITION.
//
// The real Remotion <Player> running the live script at 60fps, with motion
// blur on every word reveal and the soundtrack wired in. The MP4 button
// submits THE SAME composition source and THE SAME props to the platform
// render service, so what plays here is what is exported — only the frame
// rate changes, because the render service is pinned to 30fps and every
// animation in the film is written in seconds rather than frames.

import { ChevronLeft, Clapperboard, Film, Music4 } from 'lucide-react';
import { filmSeconds, planTiming } from '../lib/filmTiming';
import { PREVIEW_FPS, RENDER_FPS, type LaunchScript } from '../lib/launchTypes';
import type { RenderPhase } from '../lib/renderPipeline';
import { ACCENT, BORDER, CARD_BG, ErrorNote, GhostButton, MUTED, PANEL, PrimaryButton, Spinner, TEXT } from './LaunchUi';

function renderLabel(phase: RenderPhase | ''): string {
  if (phase === 'pending') return 'Queued on the render service…';
  if (phase === 'rendering') return 'Rendering every frame…';
  if (phase === 'complete') return 'Render complete.';
  if (phase === 'failed') return 'The render failed.';
  return '';
}

export default function ComposeScreen(props: {
  script: LaunchScript;
  srcDoc: string;
  screenshotUrl: string;
  rendering: boolean;
  renderPhase: RenderPhase | '';
  renderElapsedMs: number;
  renderError: string;
  onRender: () => void;
  onBack: () => void;
}) {
  const previewTiming = planTiming(props.script, PREVIEW_FPS);
  const renderTiming = planTiming(props.script, RENDER_FPS);
  const runtime = filmSeconds(previewTiming);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '8px 0 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: TEXT, margin: 0 }}>
          {props.script.title}
        </h1>
        <span
          style={{
            padding: '5px 11px',
            borderRadius: 999,
            border: '1px solid ' + BORDER,
            fontSize: 11.5,
            fontWeight: 700,
            color: MUTED,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          60fps preview
        </span>
      </div>

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 640px', minWidth: 320 }}>
          <div
            style={{
              ...PANEL,
              padding: 0,
              overflow: 'hidden',
              aspectRatio: '16 / 9',
              background: '#05070C',
            }}
          >
            <iframe
              title="Launch film preview"
              srcDoc={props.srcDoc}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              sandbox="allow-scripts allow-same-origin"
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {props.script.scenes.map((scene, index) => (
              <div
                key={scene.sceneNumber}
                style={{
                  flex: '1 1 150px',
                  padding: '11px 13px',
                  borderRadius: 11,
                  background: CARD_BG,
                  border: '1px solid ' + BORDER,
                }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: ACCENT, textTransform: 'uppercase' }}>
                  Scene {index + 1} · {scene.transitionType}
                </div>
                <div style={{ fontSize: 12.5, color: TEXT, marginTop: 5, lineHeight: 1.45, fontWeight: 600 }}>
                  {scene.headline || scene.wordRevealLines[0] || ''}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: '0 1 320px', minWidth: 280 }}>
          <div style={{ ...PANEL, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
              <Film size={16} style={{ color: ACCENT }} />
              <span style={{ fontSize: 13, fontWeight: 750, color: TEXT, letterSpacing: '-0.01em' }}>This cut</span>
            </div>

            {[
              ['Runtime', runtime.toFixed(1) + 's'],
              ['Scenes', String(props.script.scenes.length)],
              ['Preview', PREVIEW_FPS + 'fps · ' + previewTiming.totalFrames + ' frames'],
              ['Export', RENDER_FPS + 'fps · 1920×1080 · ' + renderTiming.totalFrames + ' frames'],
              ['Pacing', props.script.pacing],
              ['Product shot', props.screenshotUrl ? 'Live screenshot of your site' : 'Type only — no URL given'],
            ].map(([label, figure]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '7px 0' }}>
                <span style={{ fontSize: 12.5, color: MUTED }}>{label}</span>
                <span style={{ fontSize: 12.5, color: TEXT, fontWeight: 600, textAlign: 'right' }}>{figure}</span>
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12, color: MUTED }}>
              <Music4 size={14} style={{ color: ACCENT }} />
              Soundtrack mixed at 65%
            </div>

            <div style={{ marginTop: 20 }}>
              <PrimaryButton onClick={props.onRender} busy={props.rendering} width="100%">
                {props.rendering ? 'Rendering…' : 'Render the MP4'}
              </PrimaryButton>
            </div>

            {props.rendering || props.renderPhase ? (
              <div
                style={{
                  marginTop: 14,
                  padding: '12px 14px',
                  borderRadius: 11,
                  border: '1px solid ' + BORDER,
                  background: CARD_BG,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  {props.rendering ? <Spinner size={14} /> : <Clapperboard size={14} style={{ color: ACCENT }} />}
                  <span style={{ fontSize: 12.5, color: TEXT, fontWeight: 600 }}>{renderLabel(props.renderPhase)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {(props.renderElapsedMs / 1000).toFixed(0)}s elapsed · every update is a real answer from the
                  render service
                </div>
              </div>
            ) : null}

            <ErrorNote>{props.renderError}</ErrorNote>

            <div style={{ marginTop: 18 }}>
              <GhostButton onClick={props.onBack} disabled={props.rendering}>
                <ChevronLeft size={15} />
                Back to the script
              </GhostButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
