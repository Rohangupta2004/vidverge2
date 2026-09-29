/**
 * LightBeamPipeline — the video generation pipeline.
 *
 * BRIEF → SCRIPT → SCENES → GENERATION → CONSISTENCY → RENDER → VIDEO.
 *
 * Each stage is a node and the connectors between them carry the light
 * downward. The beam entering the ACTIVE node is white-hot and loops;
 * connectors already behind the work carry a dim amber beam; everything
 * ahead of it is pending and completely still.
 *
 * This is the one place a customer watches for minutes at a time, so it is
 * also the strictest about stillness: nothing moves except the light on the
 * connectors and the glow on the node currently doing work.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colors, tint } from '../tokens/colors';
import { typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

/** The canonical VidVerge production pipeline. */
export const DEFAULT_PIPELINE_STAGES = [
  'BRIEF', 'SCRIPT', 'SCENES', 'GENERATION', 'CONSISTENCY', 'RENDER', 'VIDEO',
] as const;

export interface LightBeamPipelineProps {
  riveSrc?: string;
  /** Index of the stage currently working. -1 = nothing started. */
  activeStage: number;
  stages?: readonly string[];
  /** Per-stage detail line (errors, counts, timings). */
  notes?: Record<number, ReactNode>;
  /** Mark the run as failed at `activeStage`. */
  failed?: boolean;
  orientation?: 'vertical' | 'horizontal';
  onStageClick?: (index: number) => void;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

type StageState = 'complete' | 'active' | 'pending' | 'failed';

export default function LightBeamPipeline({
  riveSrc, activeStage, stages = DEFAULT_PIPELINE_STAGES, notes, failed,
  orientation = 'vertical', onStageClick, className, style, testId,
}: LightBeamPipelineProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const vertical = orientation === 'vertical';

  if (rive.active) {
    return <rive.Rive src={riveSrc} style={{ width: '100%', minHeight: 320, ...style }} />;
  }

  const stateOf = (i: number): StageState => {
    if (failed && i === activeStage) return 'failed';
    if (i < activeStage) return 'complete';
    if (i === activeStage) return 'active';
    return 'pending';
  };

  const nodeColor = (s: StageState) =>
    s === 'failed' ? colors.error
      : s === 'active' ? colors.beamPrimary
        : s === 'complete' ? tint(colors.beamPrimary, 55)
          : colors.textDim;

  return (
    <div
      data-testid={testId}
      className={className}
      style={{
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        alignItems: vertical ? 'stretch' : 'center',
        width: '100%',
        ...style,
      }}
    >
      {stages.map((stage, i) => {
        const s = stateOf(i);
        const c = nodeColor(s);
        // The connector BELOW this node carries the light into the next stage.
        const connectorLive = i < activeStage || (i === activeStage && !failed);
        const connectorHot = i === activeStage - 1 || (i === activeStage && !failed);
        const isLast = i === stages.length - 1;

        return (
          <div
            key={stage}
            style={{
              display: 'flex',
              flexDirection: vertical ? 'column' : 'row',
              alignItems: vertical ? 'stretch' : 'center',
              flex: vertical ? undefined : 1,
              minWidth: 0,
            }}
          >
            <div
              onClick={onStageClick ? () => onStageClick(i) : undefined}
              role={onStageClick ? 'button' : undefined}
              tabIndex={onStageClick ? 0 : undefined}
              onKeyDown={(e) => { if (onStageClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onStageClick(i); } }}
              style={{
                display: 'flex', alignItems: vertical ? 'flex-start' : 'center', gap: 12,
                flexDirection: vertical ? 'row' : 'column',
                cursor: onStageClick ? 'pointer' : undefined,
                minWidth: 0,
              }}
            >
              {/* Node */}
              <span
                aria-hidden='true'
                style={{
                  width: 11, height: 11, borderRadius: '50%', flexShrink: 0, marginTop: vertical ? 3 : 0,
                  background: s === 'pending' ? 'transparent' : c,
                  border: '1px solid ' + (s === 'pending' ? colors.borderSubtle : c),
                  boxShadow: s === 'active' ? beamGlow(c, 12) : 'none',
                  transition: 'background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontFamily: typography.fontMono,
                    fontSize: typography.xs,
                    letterSpacing: typography.wider,
                    fontWeight: s === 'active' ? typography.semibold : typography.regular,
                    color: s === 'pending' ? colors.textDim : s === 'failed' ? colors.error : s === 'active' ? colors.beamPrimary : colors.textSecondary,
                    transition: 'color 0.3s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stage}
                </span>
                {notes && notes[i] ? (
                  <span style={{ display: 'block', fontFamily: typography.fontSans, fontSize: typography.xs, lineHeight: 1.5, color: colors.textSecondary, marginTop: 3 }}>
                    {notes[i]}
                  </span>
                ) : null}
              </span>
            </div>

            {/* Connector into the next stage */}
            {!isLast ? (
              <div
                style={{
                  position: 'relative', overflow: 'hidden',
                  width: vertical ? 1 : '100%', height: vertical ? 26 : 1,
                  flex: vertical ? undefined : 1,
                  margin: vertical ? '6px 0 6px 5px' : '0 10px',
                  background: connectorLive ? tint(colors.beamPrimary, 22) : colors.borderSubtle,
                  transition: 'background 0.3s ease',
                }}
              >
                {connectorLive ? (
                  <div
                    data-lb-anim='pipeline-connector'
                    style={{
                      position: 'absolute', inset: 0,
                      background: beamGradient({
                        core: connectorHot ? colors.beamCore : colors.beamPrimary,
                        body: colors.beamPrimary,
                        trail: colors.beamTrail,
                        bodyWidth: vertical ? 14 : 34,
                        trailWidth: vertical ? 8 : 16,
                        angle: vertical ? 180 : 90,
                      }),
                      opacity: connectorHot ? 1 : 0.4,
                      boxShadow: connectorHot ? beamGlow(colors.beamPrimary, 7) : 'none',
                      animation: 'lb-beamTravel' + (vertical ? 'Y' : '') + ' ' + (connectorHot ? '1.2s' : '2.4s') + ' linear infinite',
                      willChange: 'transform, opacity',
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
