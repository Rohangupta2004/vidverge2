/**
 * VidVerge LightBeam UI System — the single shared design system for all six
 * apps (Product Video, Video Enhancer, Script-to-Video, SceneForge, Ads
 * Studio, Creatables).
 *
 *   Black space + flowing gold-amber energy + precision software +
 *   cinematic motion.
 *
 * DESIGN LAW
 *   Don't animate the UI. Animate the light travelling through the UI.
 *   Every interaction answers: where did the light come from, where is it
 *   going, and what happens when it arrives?
 *
 * RULES BAKED INTO THIS LAYER
 *   - Beams travel left → right, or top → bottom in vertical layouts. Never
 *     randomly, never in circles.
 *   - Keyframes touch `transform` and `opacity` only, so the compositor does
 *     the work. The single exception is the SVG border trace, which animates
 *     `stroke-dashoffset` because that is the only way to run light along a
 *     rounded border path.
 *   - Dormant means still. A card, button or field that is not active does
 *     not animate at all.
 *   - No spinners, blobs, particles or neon splashes anywhere.
 *
 * WHERE THIS LIVES
 *   Under `components/` rather than at the workspace root: the space
 *   compiler only copies apps/, components/, hooks/, lib/, tools/, utils/,
 *   data/ and assets/ into the published page, so a root-level
 *   `design-system/` would fail to resolve and take the whole space down
 *   with it. Everything else about the structure is unchanged
 *   (tokens/, components/, animations/, icons/).
 *
 * USAGE
 *   import { LightBeamButton, LightBeamPipeline, colors }
 *     from '../../components/design-system/index';
 *
 *   The trailing `/index` is deliberate: nothing else in this space imports a
 *   directory, so the barrel is always addressed as a file to keep module
 *   resolution identical to every other import here.
 *
 * RIVE (platform `rive-animation` integration)
 *   `@rive-app/react-canvas` is a pre-registered allowed library here, so
 *   `rive/RiveStage.tsx` addresses it by its bare name and pins the matching
 *   rive.wasm. It reaches for it with a RUNTIME dynamic import, so a space
 *   with no .riv files configured never downloads the runtime. Do NOT turn
 *   that back into a static `import ... from '@rive-app/react-canvas'`: the
 *   space compiles to one ES module, so a static bare import is hoisted out
 *   of its React.lazy() chunk and blocks every page load on the CDN.
 *
 *   Two ways to use it:
 *     - `<RiveSlotView slot='pipeline'>{<LightBeamPipeline .../>}</RiveSlotView>`
 *       — named slots resolved from the registry (rive/riveSlots.ts), which
 *       the app hydrates from its own settings.
 *     - a `riveSrc` prop on any LightBeam component, for a one-off file.
 *
 *   Rive is always an ENHANCEMENT: if the runtime, the .riv file or the
 *   WebAssembly binary fails, the LightBeam layer comes straight back.
 */

// ---- tokens ----
export { colors, beamVariants, tint } from './tokens/colors';
export type { ColorToken, BeamVariant } from './tokens/colors';
export { spacing, space, beamMetrics } from './tokens/spacing';
export type { SpacingToken } from './tokens/spacing';
export { typography, microLabel } from './tokens/typography';
export { radii, radiiPx } from './tokens/radii';
export type { RadiusToken } from './tokens/radii';

// ---- animation layer ----
export { BEAM_KEYFRAMES, GLOBAL_RESET_CSS, BEAM_STYLE_ID, beamGradient, beamGlow } from './animations/beamKeyframes';
export { useBeamAnimation, useBeamStyles, useRiveSlot, staggerDelays } from './animations/useBeamAnimation';
export type { BeamAnimationOptions, BeamAnimationState, RiveSlot } from './animations/useBeamAnimation';

// ---- Rive (rive-animation integration) ----
export { default as RiveSlotView } from './rive/RiveSlotView';
export type { RiveSlotViewProps } from './rive/RiveSlotView';
export { default as RiveSurface, riveOverlayStyle } from './rive/RiveSurface';
export type { RiveSurfaceProps, RiveStatus } from './rive/RiveSurface';
export {
  RIVE_SLOTS, setRiveSlots, getRiveSlots, getRiveSlot, useRiveSlots,
  useRiveSlotConfig, normalizeRiveSlots, serializeRiveSlots,
} from './rive/riveSlots';
export type { RiveSlotId, RiveSlotConfig, RiveSlotMap } from './rive/riveSlots';

// ---- components ----
export * from './components/index';

// ---- icons ----
export * from './icons/index';
