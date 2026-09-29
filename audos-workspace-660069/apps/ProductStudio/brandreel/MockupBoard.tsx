/**
 * BRAND REEL · STEP 3 and 4 — the storyboard preview and the render.
 *
 * Step 3 shows one FRAME PER SCENE, drawn in code by the same shapes the
 * Remotion composition uses (see sceneGraphics.tsx / composition.ts), next to
 * the locked headline and voiceover. Generate Video is always ready — there is
 * nothing to wait for and nothing to pay for before you press it.
 *
 * WHAT CHANGED AND WHY: this step used to generate one AI still per scene. The
 * model was asked for "the product's dashboard" and returned a convincing
 * interface that was not the customer's product — arbitrary, ~15s and a charge
 * per scene, and not what the video actually rendered. Every scene visual is
 * now drawn from the customer's own screenshot and their own strings, so the
 * preview is truthful, instant and free. The file keeps its old name so the
 * imports stay put; "mockup" here means a code-drawn frame, never a generated
 * picture.
 *
 * Step 4 renders that same locked script through the existing server-side
 * Remotion pipeline and shows the MP4 inline with a download.
 */
import { ArrowLeft, Camera, Check, Clock, Download, Film, Mic, RefreshCw, Wand2 } from 'lucide-react';
import type { BrandObject, BrandTheme, ScriptVariant } from './types';
import { SCENE_VISUAL_LABEL } from './types';
import ScenePreview from './sceneGraphics';
import { Card, ErrorNote, GhostButton, PrimaryButton, Pill, SectionLabel, Spinner } from './ui';

export interface MockupBoardProps {
  theme: BrandTheme;
  brand: BrandObject;
  variant: ScriptVariant;
  onBack: () => void;
  onGenerate: () => void;
  /** Render state, owned by the studio shell so it survives tab switches. */
  rendering: boolean;
  renderNote: string;
  renderUrl: string;
  error: string;
}

export default function MockupBoard(props: MockupBoardProps) {
  const { theme, brand, variant } = props;
  const aspect = variant.composition.aspect;

  if (props.renderUrl) {
    return (
      <div className="br-rise" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card theme={theme} accentEdge style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: theme.border, flexWrap: 'wrap' }}>
            <Check size={17} style={{ color: theme.primary }} />
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ color: theme.text, fontSize: 15, fontWeight: 800 }}>{brand.name} — {variant.styleLabel}</div>
              <div style={{ color: theme.textMuted, fontSize: 11.5 }}>
                {variant.totalSeconds}s · {variant.scenes.length} scenes · {variant.composition.transition} transitions
              </div>
            </div>
            <a
              href={props.renderUrl}
              download
              target="_blank"
              rel="noreferrer noopener"
              className="br-btn"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none',
                padding: '11px 20px', borderRadius: 11, background: theme.primary,
                color: theme.onPrimary, fontSize: 13.5, fontWeight: 800,
              }}
              data-testid="link-download-reel"
            >
              <Download size={15} /> Download MP4
            </a>
          </div>
          <video src={props.renderUrl} controls playsInline style={{ display: 'block', width: '100%', background: '#000', maxHeight: '60vh' }} />
        </Card>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <GhostButton theme={theme} onClick={props.onBack}>
            <ArrowLeft size={13} /> Pick a different script
          </GhostButton>
          <GhostButton theme={theme} onClick={props.onGenerate} testId="button-rerender-reel">
            <RefreshCw size={13} /> Render again
          </GhostButton>
        </div>
      </div>
    );
  }

  return (
    <div className="br-rise" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, color: theme.text, fontSize: 'clamp(17px, 3vw, 21px)', fontWeight: 800, letterSpacing: -0.3 }}>
            Storyboard — {variant.styleLabel}
          </h2>
          <p style={{ margin: '5px 0 0', color: theme.textMuted, fontSize: 12.5, lineHeight: 1.55 }}>
            These are the actual frames. Every one is drawn in code from your own screenshot and your own words, in your
            own colour — nothing here is an AI picture of a product that isn&rsquo;t yours.
          </p>
        </div>
        <GhostButton theme={theme} onClick={props.onBack} disabled={props.rendering} testId="button-back-to-storyboard">
          <ArrowLeft size={13} /> Scripts
        </GhostButton>
      </div>

      <ErrorNote theme={theme} message={props.error} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {variant.scenes.map((scene, i) => {
          const isLast = i === variant.scenes.length - 1;
          const kind = isLast ? 'kinetic' : scene.visual?.kind || 'kinetic';
          return (
            <Card key={scene.sceneNumber} theme={theme} style={{ padding: 13 }}>
              <div className="br-mockup-row" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <ScenePreview
                  theme={theme}
                  brand={brand}
                  scene={scene}
                  imageUrl={brand.heroImageUrl}
                  isLast={isLast}
                  aspect={aspect}
                />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pill theme={theme}>{isLast ? 'Call to action' : `Scene ${scene.sceneNumber}`}</Pill>
                    <Pill theme={theme} tone="quiet"><Clock size={10} /> {scene.durationSeconds}s</Pill>
                    <Pill theme={theme} tone="quiet">{isLast ? 'CTA plate' : SCENE_VISUAL_LABEL[kind]}</Pill>
                  </div>
                  <div style={{ color: theme.text, fontSize: 'clamp(16px, 2.4vw, 20px)', fontWeight: 800, lineHeight: 1.25, letterSpacing: -0.3 }}>
                    {scene.headline}
                  </div>
                  {scene.bodyText ? (
                    <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 1.5 }}>{scene.bodyText}</div>
                  ) : null}
                  {scene.voiceover ? (
                    <div style={{ display: 'flex', gap: 8, color: 'rgba(255,255,255,0.78)', fontSize: 12.5, lineHeight: 1.55, fontStyle: 'italic' }}>
                      <Mic size={13} style={{ flexShrink: 0, marginTop: 2, color: theme.primary }} />
                      <span>{scene.voiceover}</span>
                    </div>
                  ) : null}
                  {scene.visualDescription ? (
                    <div style={{ display: 'flex', gap: 8, color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5 }}>
                      <Film size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>{scene.visualDescription}</span>
                    </div>
                  ) : null}
                  {scene.cameraNote ? (
                    <div style={{ display: 'flex', gap: 8, color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5 }}>
                      <Camera size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>{scene.cameraNote}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card theme={theme} accentEdge style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <SectionLabel theme={theme}>What this costs</SectionLabel>
            <div style={{ color: theme.text, fontSize: 13, marginTop: 5, lineHeight: 1.6 }}>
              <div>
                <strong style={{ color: theme.primary }}>No image generation.</strong> Every frame above is drawn in
                code, so the storyboard is free and instant.
              </div>
              <div style={{ color: theme.textMuted }}>
                You only pay for one {variant.totalSeconds}-second server-side Remotion render.
              </div>
            </div>
          </div>
          <PrimaryButton
            theme={theme}
            onClick={props.onGenerate}
            busy={props.rendering}
            testId="button-generate-video"
            title="Render this reel as an MP4"
            style={{ padding: '13px 26px', fontSize: 14 }}
          >
            {props.rendering ? (props.renderNote || 'Rendering…') : (<><Wand2 size={16} /> Generate Video</>)}
          </PrimaryButton>
        </div>
        {props.rendering && props.renderNote ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, paddingTop: 13, borderTop: theme.border, color: theme.textMuted, fontSize: 12.5 }}>
            <Spinner color={theme.primary} />
            {props.renderNote} — this keeps running even if you switch tabs.
          </div>
        ) : null}
      </Card>
    </div>
  );
}
