/**
 * BRAND REEL · STEP 2 — the script variants as a horizontally scrolling
 * storyboard.
 *
 * One column per variant, its style label and total duration pinned at the
 * top with the Select button, then the scene cards stacked vertically inside
 * it — scene 1 above scene 2 above scene 3 — exactly as a storyboard reads.
 * Cards are dark; the accent is the CLIENT's colour throughout.
 */
import { Camera, Check, Clock, Film, Mic, RefreshCw, Shapes } from 'lucide-react';
import type { BrandTheme, ScriptVariant, StoryboardScene } from './types';
import { SCENE_VISUAL_LABEL } from './types';
import { Card, ErrorNote, GhostButton, PrimaryButton, Pill, Spinner } from './ui';

function SceneCard({ theme, scene, isLast }: { theme: BrandTheme; scene: StoryboardScene; isLast: boolean }) {
  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.34)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderLeft: `3px solid ${isLast ? theme.primary : 'rgba(255,255,255,0.16)'}`,
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span
          style={{
            width: 21, height: 21, borderRadius: 6, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme.primarySoft, color: theme.primary,
            fontSize: 11, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
          }}
        >
          {scene.sceneNumber}
        </span>
        <span style={{ flex: 1, color: theme.textMuted, fontSize: 10, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase' }}>
          {isLast ? 'Call to action' : `Scene ${scene.sceneNumber}`}
        </span>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            color: theme.primary, background: theme.primarySoft,
            border: `1px solid ${theme.primarySoft}`, borderRadius: 999,
            padding: '2px 8px', fontSize: 10.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Clock size={10} /> {scene.durationSeconds}s
        </span>
      </div>

      {/* The shape this scene is DRAWN as — no AI picture is involved. */}
      <span
        style={{
          alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5,
          color: theme.textMuted, background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7,
          padding: '2px 7px', fontSize: 10, fontWeight: 700,
        }}
      >
        <Shapes size={10} /> {isLast ? 'CTA plate' : SCENE_VISUAL_LABEL[scene.visual?.kind || 'kinetic']}
      </span>

      <div style={{ color: theme.text, fontSize: 14, fontWeight: 750, lineHeight: 1.3 }}>{scene.headline}</div>
      {scene.bodyText ? (
        <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 1.5 }}>{scene.bodyText}</div>
      ) : null}

      {scene.visualDescription ? (
        <div style={{ display: 'flex', gap: 7, color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5 }}>
          <Film size={12} style={{ flexShrink: 0, marginTop: 2, color: theme.primary }} />
          <span>{scene.visualDescription}</span>
        </div>
      ) : null}

      {scene.cameraNote ? (
        <div style={{ display: 'flex', gap: 7, color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5 }}>
          <Camera size={12} style={{ flexShrink: 0, marginTop: 2, color: theme.primary }} />
          <span>{scene.cameraNote}</span>
        </div>
      ) : null}

      {scene.voiceover ? (
        <div
          style={{
            display: 'flex', gap: 7, marginTop: 1, padding: '7px 9px', borderRadius: 9,
            background: 'rgba(255,255,255,0.045)', color: 'rgba(255,255,255,0.8)',
            fontSize: 11.5, lineHeight: 1.5, fontStyle: 'italic',
          }}
        >
          <Mic size={12} style={{ flexShrink: 0, marginTop: 2, color: theme.primary, fontStyle: 'normal' }} />
          <span>{scene.voiceover}</span>
        </div>
      ) : null}
    </div>
  );
}

export interface StoryboardColumnsProps {
  theme: BrandTheme;
  variants: ScriptVariant[];
  selectedId: string;
  writing: boolean;
  error: string;
  modelNote: string;
  onSelect: (variant: ScriptVariant) => void;
  onRegenerate: () => void;
  onBack: () => void;
  /** Remotion Studio reuses this board, so the wording is caller-supplied. */
  title?: string;
  subtitle?: string;
  backLabel?: string;
}

export default function StoryboardColumns(props: StoryboardColumnsProps) {
  const { theme } = props;

  if (props.writing) {
    return (
      <Card theme={theme} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 22 }}>
        <Spinner color={theme.primary} size={19} />
        <div>
          <div style={{ color: theme.text, fontSize: 14, fontWeight: 750 }}>Writing six different cuts of your ad…</div>
          <div style={{ color: theme.textMuted, fontSize: 12, marginTop: 3 }}>
            Each one takes a genuinely different angle. This takes about twenty seconds.
          </div>
        </div>
      </Card>
    );
  }

  if (!props.variants.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ErrorNote theme={theme} message={props.error} onRetry={props.onRegenerate} />
        <div>
          <GhostButton theme={theme} onClick={props.onBack}>← Back to the brand summary</GhostButton>
        </div>
      </div>
    );
  }

  return (
    <div className="br-rise" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, color: theme.text, fontSize: 'clamp(17px, 3vw, 21px)', fontWeight: 800, letterSpacing: -0.3 }}>
            {props.title || 'Pick the cut you want'}
          </h2>
          <p style={{ margin: '5px 0 0', color: theme.textMuted, fontSize: 12.5, lineHeight: 1.55 }}>
            {props.subtitle
              || `${props.variants.length} scripts, each a different way of telling the same story. Scroll sideways to compare, then select one — nothing is generated until you do.`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton theme={theme} onClick={props.onBack} testId="button-back-to-brand">{props.backLabel || '← Brand'}</GhostButton>
          <GhostButton theme={theme} onClick={props.onRegenerate} testId="button-regenerate-scripts">
            <RefreshCw size={13} /> Regenerate
          </GhostButton>
        </div>
      </div>

      <ErrorNote theme={theme} message={props.error} onRetry={props.onRegenerate} />

      <div className="br-columns br-scroll" role="list" aria-label="Script variants">
        {props.variants.map((variant) => {
          const selected = variant.id === props.selectedId;
          return (
            <div
              key={variant.id}
              role="listitem"
              className="br-card"
              style={{
                flex: '0 0 auto',
                width: 306,
                minWidth: 306,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                background: 'rgba(255,255,255,0.035)',
                border: selected ? theme.borderStrong : '1px solid rgba(255,255,255,0.08)',
                boxShadow: selected ? `0 0 0 1px ${theme.primary}, 0 16px 44px rgba(0,0,0,0.42)` : 'none',
                borderRadius: 16,
                padding: 13,
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: theme.text, fontSize: 14.5, fontWeight: 820, letterSpacing: -0.2, flex: 1, minWidth: 0 }}>
                    {variant.styleLabel}
                  </span>
                  <Pill theme={theme}>{variant.totalSeconds}s</Pill>
                </div>
                <div style={{ color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5, minHeight: 34 }}>
                  {variant.styleSummary || `${variant.scenes.length} scenes, ${variant.composition.transition} transitions.`}
                </div>
                <PrimaryButton
                  theme={theme}
                  onClick={() => props.onSelect(variant)}
                  testId={`button-select-${variant.id}`}
                  style={{ width: '100%', padding: '10px 16px' }}
                >
                  {selected ? (<><Check size={14} /> Selected</>) : 'Select this script'}
                </PrimaryButton>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {variant.scenes.map((scene, i) => (
                  <SceneCard key={scene.sceneNumber} theme={theme} scene={scene} isLast={i === variant.scenes.length - 1} />
                ))}
              </div>

              <div style={{ marginTop: 'auto', paddingTop: 4, color: theme.textMuted, fontSize: 10.5, letterSpacing: 0.3 }}>
                {variant.composition.width}×{variant.composition.height} · {variant.composition.fps}fps ·{' '}
                {variant.composition.totalFrames} frames · {variant.composition.transition}
              </div>
            </div>
          );
        })}
      </div>

      {props.modelNote ? (
        <div style={{ color: theme.textMuted, fontSize: 11.5 }}>{props.modelNote}</div>
      ) : null}
    </div>
  );
}
