// Product Videos — Remotion composition builders.
//
// Everything here produces a SELF-CONTAINED composition TSX string for the
// platform's server-side Remotion renderer (fixed geometry: 30fps, 1920x1080).
//
// - Story Mode (9:16): a deterministic template consumes the GPT scene
//   manifest — the vertical 1080x1920 stage is scaled into the fixed 16:9
//   render frame, every scene runs the layer stack (audio, parallax BG,
//   projected floor shadow, boiling character cutout, kinetic subtitles) under
//   the global FilmTreatment. THE LIVE STORY MODE TEMPLATE NOW LIVES IN THE
//   runStoryModePipeline SERVER FUNCTION, which builds and renders it without
//   a browser; buildStoryComposition below is the readable copy of that
//   template (hook source is not part of this source tree). Change both
//   together — the hook's copy additionally takes the subtitle colour from the
//   customer's brand accent.
// - UI Mode (16:9): GPT writes the composition code from the Motion Designer
//   system prompt; a deterministic fallback template ships the video anyway if
//   the generated code fails validation or the render errors.
//
// NO STUDIO BRANDING IN A CUSTOMER'S FILM: the only logo either builder can
// render is the one passed in as brandLogoUrl — the customer's own, read off
// their website or uploaded by them — and both omit it entirely when that is
// null. The light-beam overlay that used to be blended over every frame is
// gone.
//
// Generated code imports ONLY from 'remotion' and is a pure function of
// useCurrentFrame() — no CSS animations, timers, or randomness.

import type { VoiceSegment } from './media';

export const FPS = 30;
export const MAX_TOTAL_FRAMES = 1800; // 60 seconds hard cap
export const MIN_SCENE_FRAMES = 120; // 4 seconds minimum per scene

export interface UiPlanScene {
  id: string;
  headline: string;
  sub: string;
  voiceover: string;
  imagePrompt: string | null;
  durationFrames: number;
  features: Array<{ title: string; detail: string }> | null;
}

export interface UiPlan {
  title: string;
  tagline: string;
  musicTrack: number;
  ctaText: string;
  ctaUrl: string;
  scenes: UiPlanScene[];
}

export interface StoryScenePlan {
  id: string;
  narration: string;
  subtitle: string;
  background: string;
  characterCutout: string;
  props?: string | null;
  sfx?: string | null;
}

export interface StoryPlan {
  title: string;
  musicTrack: number;
  scenes: StoryScenePlan[];
}

// ---------------------------------------------------------------------------
// Scene timing — durations are DERIVED from the recorded voiceover, then
// clamped to the 4s minimum and the 60s total budget.
// ---------------------------------------------------------------------------

export function deriveSceneDurations(
  sceneCount: number,
  segments: Array<VoiceSegment | null>,
  plannedFrames?: Array<number | undefined>,
): number[] {
  const raw: number[] = [];
  for (let i = 0; i < sceneCount; i += 1) {
    const voFrames = segments[i]?.durationMs
      ? Math.ceil((segments[i]!.durationMs / 1000) * FPS) + 18
      : 0;
    const planned = plannedFrames?.[i] || 0;
    raw.push(Math.max(MIN_SCENE_FRAMES, voFrames, planned, MIN_SCENE_FRAMES));
  }
  let total = raw.reduce((sum, frames) => sum + frames, 0);
  if (total > MAX_TOTAL_FRAMES) {
    const scale = MAX_TOTAL_FRAMES / total;
    for (let i = 0; i < raw.length; i += 1) {
      raw[i] = Math.max(MIN_SCENE_FRAMES, Math.floor(raw[i] * scale));
    }
    total = raw.reduce((sum, frames) => sum + frames, 0);
    let overshoot = total - MAX_TOTAL_FRAMES;
    for (let i = raw.length - 1; i >= 0 && overshoot > 0; i -= 1) {
      const give = Math.min(overshoot, raw[i] - MIN_SCENE_FRAMES);
      raw[i] -= give;
      overshoot -= give;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// STORY MODE — deterministic 6-layer documentary composition
//
// Reference copy. Story Mode renders from the identical template inside the
// runStoryModePipeline server function, which adds one thing this version
// cannot do without a canvas: an SVG luminance filter that knocks the white
// field out of a character still at render time, standing in for the
// in-browser chroma key.
// ---------------------------------------------------------------------------

export interface StorySceneAssets {
  backgroundUrl: string;
  characterUrl: string | null;
}

export function buildStoryComposition(input: {
  plan: StoryPlan;
  assets: StorySceneAssets[];
  voice: Array<VoiceSegment | null>;
  musicUrl: string | null;
  // The CUSTOMER'S logo, or null for a film with no logo at all. This studio's
  // own mark is never composited into a customer's video.
  brandLogoUrl?: string | null;
}): { tsx: string; durationInFrames: number } {
  const durations = deriveSceneDurations(input.plan.scenes.length, input.voice);
  let cursor = 0;
  const scenes = input.plan.scenes.map((scene, index) => {
    const from = cursor;
    cursor += durations[index];
    return {
      id: scene.id || `scene-${index}`,
      subtitle: scene.subtitle || '',
      backgroundUrl: input.assets[index]?.backgroundUrl || '',
      characterUrl: input.assets[index]?.characterUrl || null,
      voUrl: input.voice[index]?.audioUrl || null,
      from,
      durationFrames: durations[index],
    };
  });
  const durationInFrames = cursor;

  const payload = JSON.stringify({
    title: input.plan.title,
    logoUrl: input.brandLogoUrl || null,
    musicUrl: input.musicUrl,
    scenes,
  });

  const tsx = `import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const DATA: any = ${payload};

// Global film treatment — always the top layer of every scene (zIndex 100):
// gate weave, vignette, scanlines, and a soft inner burn.
export const FilmTreatment: React.FC = () => {
  const frame = useCurrentFrame();
  const weaveX = (frame % 2 === 0 ? 0.8 : -0.8) * Math.sin(frame);
  const weaveY = (frame % 3 === 0 ? -0.6 : 0.6) * Math.cos(frame);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', transform: 'translate(' + weaveX + 'px, ' + weaveY + 'px)', zIndex: 100 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.75) 100%)' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1.6px, transparent 1.6px, transparent 3.2px)', opacity: 0.85 }} />
      <div style={{ position: 'absolute', inset: -20, boxShadow: 'inset 0 0 100px rgba(0,0,0,0.85)', filter: 'blur(8px)' }} />
    </AbsoluteFill>
  );
};

const SUBTITLE_FONT = "'Montserrat', 'Inter', system-ui, sans-serif";

const StoryScene: React.FC<{ scene: any; durationFrames: number }> = ({ scene, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Differential parallax: BG 1.05x\u21921.12x, character 1.1x\u21921.28x.
  const bgScale = interpolate(frame, [0, durationFrames], [1.05, 1.12], { extrapolateRight: 'clamp' });
  const charScale = interpolate(frame, [0, durationFrames], [1.1, 1.28], { extrapolateRight: 'clamp' });
  // Character boil: subtle living drift.
  const boilY = Math.sin(frame * 0.12) * 5;
  const boilRot = Math.sin(frame * 0.08) * 0.7;
  const charIn = spring({ frame, fps, config: { damping: 15, stiffness: 120, mass: 0.8 } });
  const subtitleWords = String(scene.subtitle || '').split(' ').filter(Boolean);
  return (
    <AbsoluteFill style={{ background: '#000000', overflow: 'hidden' }}>
      {/* Layer 1 \u2014 parallax background plate */}
      {scene.backgroundUrl ? (
        <Img
          src={scene.backgroundUrl}
          style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(' + bgScale + ')', filter: 'brightness(0.65) contrast(1.15) sepia(0.15)' }}
        />
      ) : null}
      {/* Layer 2 \u2014 projected floor shadow (duplicate of the character) */}
      {scene.characterUrl ? (
        <Img
          src={scene.characterUrl}
          style={{ position: 'absolute', left: '50%', bottom: 210, width: 780, marginLeft: -390, transformOrigin: 'bottom center', transform: 'scale(' + charScale + ') scaleY(0.25) skewX(-35deg)', filter: 'blur(16px) brightness(0)', opacity: 0.7 * charIn }}
        />
      ) : null}
      {/* Layer 3 \u2014 character cutout with boil + entrance spring */}
      {scene.characterUrl ? (
        <Img
          src={scene.characterUrl}
          style={{ position: 'absolute', left: '50%', bottom: 250, width: 780, marginLeft: -390, transformOrigin: 'bottom center', opacity: charIn, transform: 'translateY(' + (boilY + (1 - charIn) * 40) + 'px) rotate(' + boilRot + 'deg) scale(' + charScale + ')' }}
        />
      ) : null}
      {/* Layer 4 \u2014 bold kinetic subtitles */}
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 340, textAlign: 'center', zIndex: 60 }}>
        {subtitleWords.map((word: string, wordIndex: number) => {
          const wordIn = spring({ frame: Math.max(0, frame - 8 - wordIndex * 4), fps, config: { damping: 15, stiffness: 120, mass: 0.8 } });
          return (
            <span
              key={wordIndex}
              style={{ display: 'inline-block', margin: '0 12px', fontFamily: SUBTITLE_FONT, fontWeight: 900, fontSize: 74, lineHeight: 1.12, textTransform: 'uppercase', color: '#FFDE59', textShadow: '0 6px 20px rgba(0,0,0,0.9)', opacity: wordIn, transform: 'translateY(' + (1 - wordIn) * 40 + 'px)' }}
            >
              {word}
            </span>
          );
        })}
      </div>
      {/* Layer 5 \u2014 global film treatment, always on top */}
      <FilmTreatment />
    </AbsoluteFill>
  );
};

// The render service outputs a fixed 1920x1080 frame; the 9:16 story stage is
// composed at its native 1080x1920 and scaled to fit, cinema-pillarboxed.
export default function MotionVideo() {
  return (
    <AbsoluteFill style={{ background: '#000000', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      {/* Layer 0 \u2014 audio: music bed under the per-scene voiceover */}
      {DATA.musicUrl ? <Audio src={DATA.musicUrl} volume={0.22} /> : null}
      <div style={{ position: 'relative', width: 1080, height: 1920, flexShrink: 0, overflow: 'hidden', transform: 'scale(0.5625)' }}>
        {DATA.scenes.map((scene: any) => (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationFrames}>
            {scene.voUrl ? <Audio src={scene.voUrl} /> : null}
            <StoryScene scene={scene} durationFrames={scene.durationFrames} />
          </Sequence>
        ))}
        {/* The CUSTOMER'S logo, and only when they have one */}
        {DATA.logoUrl ? (
          <Img
            src={DATA.logoUrl}
            style={{ position: 'absolute', top: 64, right: 64, width: 170, maxHeight: 88, objectFit: 'contain', objectPosition: 'right top', zIndex: 120, opacity: 0.92, filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.6))' }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

export const calculateDemoVideoDuration = () => ${durationInFrames};
`;

  return { tsx, durationInFrames };
}

// ---------------------------------------------------------------------------
// UI MODE — deterministic fallback composition (also the reference structure
// the GPT code-generation call is asked to match)
// ---------------------------------------------------------------------------

export interface UiSceneAssets {
  imageUrl: string | null;
}

export function buildUiFallbackComposition(input: {
  plan: UiPlan;
  assets: UiSceneAssets[];
  voice: Array<VoiceSegment | null>;
  musicUrl: string | null;
  brandLogoUrl?: string | null;
}): { tsx: string; durationInFrames: number } {
  const durations = deriveSceneDurations(
    input.plan.scenes.length,
    input.voice,
    input.plan.scenes.map((scene) => scene.durationFrames),
  );
  let cursor = 0;
  const scenes = input.plan.scenes.map((scene, index) => {
    const from = cursor;
    cursor += durations[index];
    return {
      id: scene.id || `scene-${index}`,
      role: scene.id,
      headline: scene.headline || '',
      sub: scene.sub || '',
      imageUrl: input.assets[index]?.imageUrl || null,
      features: Array.isArray(scene.features) ? scene.features.slice(0, 4) : null,
      voUrl: input.voice[index]?.audioUrl || null,
      from,
      durationFrames: durations[index],
    };
  });
  const durationInFrames = cursor;

  const payload = JSON.stringify({
    title: input.plan.title,
    tagline: input.plan.tagline,
    ctaText: input.plan.ctaText,
    ctaUrl: input.plan.ctaUrl,
    logoUrl: input.brandLogoUrl || null,
    musicUrl: input.musicUrl,
    scenes,
  });

  const tsx = `import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const DATA: any = ${payload};

const FONT = "'Inter', 'Geist', system-ui, -apple-system, sans-serif";
const SPRING_CONFIG = { damping: 15, stiffness: 120, mass: 0.8 };

// Shared dark-SaaS scene shell: #0B0F17 canvas and an indigo radial accent
// drawn in CSS. No overlay asset is blended over the frame.
const SceneShell: React.FC<{ children?: any }> = ({ children }) => (
  <AbsoluteFill style={{ background: '#0B0F17', overflow: 'hidden', fontFamily: FONT }}>
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, rgba(99,102,241,0.15) 0%, transparent 70%)' }} />
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 50% at 50% 100%, rgba(99,102,241,0.10) 0%, transparent 70%)' }} />
    {children}
  </AbsoluteFill>
);

const Enter: React.FC<{ delay: number; children?: any; pop?: boolean }> = ({ delay, children, pop }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: Math.max(0, frame - delay), fps, config: SPRING_CONFIG });
  const style = pop
    ? { opacity: progress, transform: 'scale(' + (0.85 + progress * 0.15) + ')' }
    : { opacity: progress, transform: 'translateY(' + (1 - progress) * 40 + 'px)' };
  return <div style={style}>{children}</div>;
};

const KenBurnsImage: React.FC<{ src: string; durationFrames: number; card?: boolean }> = ({ src, durationFrames, card }) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, durationFrames], [1.0, 1.05], { extrapolateRight: 'clamp' });
  return (
    <div style={{ overflow: 'hidden', borderRadius: card ? 24 : 0, border: card ? '1px solid rgba(255,255,255,0.1)' : 'none', boxShadow: card ? '0 40px 120px rgba(0,0,0,0.55)' : 'none', width: '100%', height: '100%' }}>
      <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(' + zoom + ')' }} />
    </div>
  );
};

const Headline: React.FC<{ text: string; size?: number; delay?: number }> = ({ text, size, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = String(text).split(' ').filter(Boolean);
  return (
    <div style={{ textAlign: 'center' }}>
      {words.map((word, index) => {
        const progress = spring({ frame: Math.max(0, frame - (delay || 0) - index * 5), fps, config: SPRING_CONFIG });
        return (
          <span key={index} style={{ display: 'inline-block', margin: '0 14px', fontSize: size || 96, fontWeight: 800, letterSpacing: '-0.03em', color: '#F0F0F0', opacity: progress, transform: 'translateY(' + (1 - progress) * 40 + 'px)' }}>
            {word}
          </span>
        );
      })}
    </div>
  );
};

const HeroScene: React.FC<{ scene: any }> = ({ scene }) => (
  <SceneShell>
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 36 }}>
      {DATA.logoUrl ? (
        <Enter delay={0} pop>
          <Img src={DATA.logoUrl} style={{ width: 240, maxHeight: 140, objectFit: 'contain', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }} />
        </Enter>
      ) : null}
      <Headline text={scene.headline || DATA.title} delay={6} />
      <Enter delay={20}>
        <div style={{ fontSize: 34, color: 'rgba(240,240,240,0.65)', letterSpacing: '-0.01em' }}>{scene.sub || DATA.tagline}</div>
      </Enter>
    </AbsoluteFill>
  </SceneShell>
);

const ProblemScene: React.FC<{ scene: any }> = ({ scene }) => (
  <SceneShell>
    {scene.imageUrl ? (
      <AbsoluteFill style={{ opacity: 0.35 }}>
        <KenBurnsImage src={scene.imageUrl} durationFrames={scene.durationFrames} />
      </AbsoluteFill>
    ) : null}
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 140, gap: 30 }}>
      <Headline text={scene.headline} size={88} delay={0} />
      <Enter delay={20}>
        <div style={{ fontSize: 32, color: 'rgba(240,240,240,0.7)', textAlign: 'center', maxWidth: 1200, lineHeight: 1.5 }}>{scene.sub}</div>
      </Enter>
    </AbsoluteFill>
  </SceneShell>
);

const UiScene: React.FC<{ scene: any }> = ({ scene }) => (
  <SceneShell>
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34, padding: 90 }}>
      <Enter delay={0}>
        <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: '-0.03em', color: '#F0F0F0' }}>{scene.headline}</div>
      </Enter>
      <Enter delay={12} pop>
        <div style={{ width: 1240, height: 660, background: '#161F30' }}>
          {scene.imageUrl ? (
            <KenBurnsImage src={scene.imageUrl} durationFrames={scene.durationFrames} card />
          ) : (
            <div style={{ width: '100%', height: '100%', borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', background: '#161F30', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {DATA.logoUrl ? (
                <Img src={DATA.logoUrl} style={{ width: 200, maxHeight: 120, objectFit: 'contain', opacity: 0.85 }} />
              ) : (
                <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', color: 'rgba(240,240,240,0.35)' }}>{DATA.title}</div>
              )}
            </div>
          )}
        </div>
      </Enter>
      <Enter delay={20}>
        <div style={{ fontSize: 28, color: 'rgba(240,240,240,0.6)' }}>{scene.sub}</div>
      </Enter>
    </AbsoluteFill>
  </SceneShell>
);

const FeaturesScene: React.FC<{ scene: any }> = ({ scene }) => {
  const features = scene.features && scene.features.length > 0 ? scene.features : [{ title: scene.headline, detail: scene.sub }];
  return (
    <SceneShell>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 120, gap: 40 }}>
        <Enter delay={0}>
          <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: '-0.03em', color: '#F0F0F0', textAlign: 'center' }}>{scene.headline}</div>
        </Enter>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 1100 }}>
          {features.map((feature: any, index: number) => (
            <Enter key={index} delay={12 + index * 8}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '26px 34px', borderRadius: 24, background: '#161F30', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ width: 18, height: 18, borderRadius: 999, background: '#F5B936', boxShadow: '0 0 18px rgba(245,185,54,0.8)', flexShrink: 0 }} />
                <div style={{ fontSize: 34, fontWeight: 700, color: '#F0F0F0', letterSpacing: '-0.02em', minWidth: 330 }}>{feature.title}</div>
                <div style={{ fontSize: 27, color: 'rgba(240,240,240,0.6)' }}>{feature.detail}</div>
              </div>
            </Enter>
          ))}
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const CtaScene: React.FC<{ scene: any }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: SPRING_CONFIG });
  const pulse = 1 + Math.sin(frame * 0.1) * 0.03;
  return (
    <SceneShell>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 40 }}>
        {DATA.logoUrl ? (
          <div style={{ opacity: entrance, transform: 'scale(' + (0.85 + entrance * 0.15) * pulse + ')' }}>
            <Img src={DATA.logoUrl} style={{ width: 280, maxHeight: 150, objectFit: 'contain', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))' }} />
          </div>
        ) : null}
        <Headline text={scene.headline || DATA.ctaText} size={80} delay={8} />
        <Enter delay={20} pop>
          <div style={{ padding: '20px 46px', borderRadius: 999, background: 'linear-gradient(90deg, #F5B936, #E0A527)', color: '#1A1205', fontSize: 34, fontWeight: 800, letterSpacing: '-0.01em', boxShadow: '0 18px 60px rgba(245,185,54,0.4)' }}>
            {DATA.ctaUrl || scene.sub}
          </div>
        </Enter>
      </AbsoluteFill>
    </SceneShell>
  );
};

const SCENE_VIEWS: any = { hero: HeroScene, problem: ProblemScene, ui: UiScene, features: FeaturesScene, cta: CtaScene };

export default function MotionVideo() {
  return (
    <AbsoluteFill style={{ background: '#0B0F17' }}>
      {DATA.musicUrl ? <Audio src={DATA.musicUrl} volume={0.2} /> : null}
      {DATA.scenes.map((scene: any) => {
        const View = SCENE_VIEWS[scene.role] || ProblemScene;
        return (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationFrames}>
            {scene.voUrl ? <Audio src={scene.voUrl} /> : null}
            <View scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

export const calculateDemoVideoDuration = () => ${durationInFrames};
`;

  return { tsx, durationInFrames };
}

// ---------------------------------------------------------------------------
// UI MODE — GPT code-generation contract
// ---------------------------------------------------------------------------

export function buildUiCodegenUserMessage(input: {
  plan: UiPlan;
  assets: UiSceneAssets[];
  voice: Array<VoiceSegment | null>;
  musicUrl: string | null;
  durations: number[];
  durationInFrames: number;
  brandLogoUrl?: string | null;
}): string {
  let cursor = 0;
  const timeline = input.plan.scenes.map((scene, index) => {
    const from = cursor;
    cursor += input.durations[index];
    return {
      id: scene.id,
      headline: scene.headline,
      sub: scene.sub,
      features: scene.features,
      imageUrl: input.assets[index]?.imageUrl || null,
      voiceoverUrl: input.voice[index]?.audioUrl || null,
      from,
      durationFrames: input.durations[index],
    };
  });

  return [
    'Generate the UI Mode composition for this plan. 16:9, 1920x1080, 30fps.',
    '',
    'PLAN + TIMELINE (frame-accurate, already derived from the recorded voiceover):',
    JSON.stringify({ title: input.plan.title, tagline: input.plan.tagline, ctaText: input.plan.ctaText, ctaUrl: input.plan.ctaUrl, scenes: timeline }, null, 2),
    '',
    'BRAND ASSETS (use these exact URLs — there are no others, and you must not invent any):',
    input.brandLogoUrl
      ? `- The customer's own logo: ${input.brandLogoUrl}`
      : '- NO logo was supplied. Render no logo, watermark or brand mark anywhere; use the product name as type instead.',
    input.musicUrl ? `- Music bed (play under everything at volume 0.2): ${input.musicUrl}` : '- No music bed.',
    '',
    'ADDITIONAL HARD REQUIREMENTS:',
    "- Import ONLY from 'remotion' (AbsoluteFill, Audio, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig). No other imports, no @remotion/* packages.",
    '- Mount each scene in a <Sequence from={scene.from} durationInFrames={scene.durationFrames}> exactly matching the timeline above.',
    '- Inside each scene Sequence, render <Audio src={voiceoverUrl} /> when the scene has one; render the music bed once at the root with volume 0.2.',
    '- Stagger children: headline at frame 0, card/visual at frame 12, caption at frame 20. NEVER move all elements simultaneously.',
    `- Total duration is exactly ${input.durationInFrames} frames. Export const calculateDemoVideoDuration = () => ${input.durationInFrames};`,
    '- No fetch, no window/document access, no Math.random, no Date.now, no setTimeout/setInterval/requestAnimationFrame, no CSS animations or transitions.',
    '- Bake every URL and string into the file as constants; the component receives no props.',
    '- Return ONLY the TSX source, no markdown fences.',
  ].join('\n');
}

const FORBIDDEN_IN_GENERATED = [
  /\bfetch\s*\(/,
  /\bwindow\b/,
  /\bdocument\b/,
  /Math\.random/,
  /setInterval|setTimeout|requestAnimationFrame/,
  /\bDate\.now\b|new Date\(/,
];

export function validateGeneratedUiComposition(code: string): void {
  if (code.length < 800) throw new Error('The generated composition was incomplete.');
  if (!/export\s+default\s+function\s+MotionVideo\b|export\s+default\s+MotionVideo\b/.test(code)) {
    throw new Error('The generated composition must default-export MotionVideo.');
  }
  if (!/\buseCurrentFrame\b/.test(code) || !/\bspring\b/.test(code)) {
    throw new Error('The generated composition is missing frame-driven animation.');
  }
  const imports = Array.from(code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)).map((match) => match[1]);
  if (imports.some((source) => source !== 'remotion' && source !== 'react')) {
    throw new Error('The generated composition imported an unsupported library.');
  }
  for (const pattern of FORBIDDEN_IN_GENERATED) {
    if (pattern.test(code)) {
      throw new Error('The generated composition used a non-deterministic API.');
    }
  }
}
