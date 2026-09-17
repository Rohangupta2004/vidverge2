/**
 * VidVerge — the agentic video system: THE CONDITIONAL PRODUCTION ROUTER.
 *
 * THE ONE IDEA IN THIS FILE. Nothing in this system runs a fixed pipeline. For
 * every single shot the router is asked two questions in order:
 *
 *   1. What must persist?  — answered upstream by the Continuity Agent.
 *   2. Which engine can actually deliver that?  — answered here.
 *
 * and the answer is a GenerationDecision: a small JSON object naming the
 * strategy, the engine, the exact references this shot carries, and why. That
 * object is persisted with the shot, so a regeneration replays the same intent
 * and "why does shot 7 look like that?" has a real answer instead of a shrug.
 *
 * THE ROUTING TABLE, in the order it is evaluated:
 *
 *   UI on screen        → remotion   (deterministic; a generative model cannot
 *                                     draw your product, it cannot spell)
 *   scripted dialogue   → heygen     (a real talking head), and silently
 *                                     veo_i2v/veo_t2v when HeyGen is unavailable
 *   recurring character → veo_i2v    (character master + previous best frame)
 *   physics / motion    → veo_t2v    with an explicit physics clause
 *   B-roll              → veo_t2v    (or veo_i2v when a reference is worth having)
 *
 * WHAT THE ROUTER NEVER DOES. It never invents a reference that is not in
 * production memory, and it never routes at an engine the production cannot
 * reach. A missing HeyGen credential, an environment that was never drawn, a
 * first shot with no previous frame — each one degrades to the next best real
 * option rather than producing a decision that cannot be executed.
 */
import { clampText } from './videoTypes';
import {
  CONTINUITY_PASS_SCORE,
  SHOT_PROMPT_MAX,
  VEO_PROMPT_MAX,
  VEO_PROMPT_MIN,
  isPresenterShotKind,
  type ContinuityNeed,
  type GenerationDecision,
  type ProductionMemory,
  type ResolvedMode,
  type ShotEngine,
  type ShotKind,
  type ShotState,
  type StoryPlan,
  type UIState,
  type VideoMode,
  type VisualStrategy,
} from './agenticTypes';

/** What the router is allowed to reach for on this production. */
export interface RouterCapabilities {
  heygenAvailable: boolean;
  /** False for a production with no product screens at all. */
  hasUIStates: boolean;
  /**
   * False when a Remotion shot cannot be DELIVERED, not merely when it is not
   * preferred. The platform renders Remotion only at 1920x1080, so a portrait
   * production would get one letterboxed shot in the middle of otherwise
   * vertical footage — worse than animating the same screenshot with Veo. A
   * portrait production therefore routes its UI beats away from Remotion.
   */
  remotionAvailable: boolean;
  mode: ResolvedMode;
  /** The visitor's actual picker choice, before AUTO was resolved. */
  requestedMode: VideoMode;
  /** True only when the visitor's own request asked for an on-camera speaker. */
  presenterRequested: boolean;
}

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

/**
 * The best frame to continue out of — and note it is the BEST frame, not the
 * last. The Frame Analyzer already picked the most usable still in the previous
 * clip; the true last frame is only the fallback, because a clip that ends
 * mid-blink or mid-whip-pan is a terrible thing to seed the next shot with.
 */
export function previousBestFrame(
  previousShot: ShotState | null,
  memory: ProductionMemory,
): string | null {
  if (!previousShot) return null;
  const analysed = memory.bestFrames[previousShot.index];
  if (isHttpUrl(analysed)) return analysed;
  if (isHttpUrl(previousShot.bestFrameUrl)) return String(previousShot.bestFrameUrl);
  const last = memory.lastFrames[previousShot.index] || previousShot.lastFrameUrl;
  return isHttpUrl(last) ? String(last) : null;
}

/** The environment reference for this shot's chapter, when one has been drawn. */
export function environmentFor(shot: ShotState, plan: StoryPlan | null, memory: ProductionMemory): string | null {
  const chapter = plan ? plan.chapters.find((c) => c.index === shot.chapterIndex) : null;
  const byChapter = chapter ? memory.environments.find((e) => e.id === chapter.environmentId) : null;
  const env = byChapter || memory.environments[0] || null;
  return env && isHttpUrl(env.referenceUrl) ? env.referenceUrl : null;
}

/** A one-line summary of where the story has got to, saved with the decision. */
function storyState(shot: ShotState, memory: ProductionMemory): string {
  const parts = [memory.narrativeState, memory.characterState, shot.label].filter(Boolean);
  return clampText(parts.join(' → ') || `shot_${shot.index}_pending`, 200);
}

/** Which two UI states this shot moves between. */
export function uiTransitionFor(
  shot: ShotState,
  uiStates: UIState[],
): { from: UIState | null; to: UIState | null } {
  if (uiStates.length === 0) return { from: null, to: null };
  if (uiStates.length === 1) return { from: uiStates[0], to: uiStates[0] };
  // Walk the graph in order across the shot list, holding on the last pair
  // rather than wrapping around — a UI piece should never loop back to screen 1
  // in its closing shot as though nothing had happened.
  const fromIndex = Math.min(uiStates.length - 2, Math.max(0, shot.index - 1));
  return { from: uiStates[fromIndex], to: uiStates[fromIndex + 1] };
}

// ---------------------------------------------------------------------------
// THE ROUTER
// ---------------------------------------------------------------------------
function plannedShotKind(shot: ShotState, plan: StoryPlan | null): ShotKind | undefined {
  return shot.kind || (plan && plan.beats.find((beat) => beat.index === shot.index)?.kind) || undefined;
}

/** Strict HeyGen guard: a script alone is narration, not proof of a presenter. */
export function heygenEligible(input: {
  shot: ShotState;
  continuity: ContinuityNeed;
  plan: StoryPlan | null;
  caps: RouterCapabilities;
}): boolean {
  if (!input.caps.heygenAvailable || !input.continuity.needsDialogue || !input.shot.dialogue.trim()) return false;
  const kind = plannedShotKind(input.shot, input.plan);
  const legacyExplicitAvatar = input.caps.requestedMode === 'avatar' && kind === 'dialogue';
  if (!isPresenterShotKind(kind) && !legacyExplicitAvatar) return false;
  if (input.caps.requestedMode === 'avatar') return true;
  if (input.caps.requestedMode === 'faceless' || input.caps.requestedMode === 'ui_motion') return false;
  return input.caps.presenterRequested;
}

/**
 * Route ONE shot. Pure and synchronous on purpose: the thinking already
 * happened (Continuity Agent, Visual Metaphor Agent), so this step is a
 * decision table rather than another round trip, and it can be re-run for free
 * when a shot is regenerated.
 */
export function routeShot(input: {
  shot: ShotState;
  previousShot: ShotState | null;
  continuity: ContinuityNeed;
  memory: ProductionMemory;
  plan: StoryPlan | null;
  caps: RouterCapabilities;
  /** The Visual Metaphor Agent's verdict, for faceless beats. */
  visualStrategy?: VisualStrategy;
  /** Set on a regeneration after a continuity FAIL — see bridgeDecision. */
  bridgeFrom?: string | null;
}): GenerationDecision {
  const { shot, previousShot, continuity, memory, plan, caps } = input;
  const master = memory.characterMasters[0] || null;
  const characterReference = master
    ? isHttpUrl(master.faceReference)
      ? master.faceReference
      : isHttpUrl(master.fullBodyReference)
        ? master.fullBodyReference
        : master.id
    : null;
  const environmentReference = environmentFor(shot, plan, memory);
  // A DELIBERATE break carries no previous frame: chaining across a
  // problem→solution cut would soften exactly the contrast the ad is selling.
  const previousFrame = continuity.deliberateBreak ? null : previousBestFrame(previousShot, memory);
  const state = storyState(shot, memory);

  // ---- A regeneration after a continuity failure ----
  if (input.bridgeFrom) {
    return {
      generation_strategy: 'bridge_frame',
      engine: 'veo_i2v',
      character_reference: characterReference,
      environment_reference: environmentReference,
      previous_best_frame: input.bridgeFrom,
      story_state: state,
      camera_continuity: true,
      reason:
        'The first take drifted off the master, so this one is re-seeded from a bridge frame that still matches it.',
    };
  }

  // ---- 1. UI on screen → Remotion, always ----
  // A generative model cannot draw a real interface: it cannot spell, so every
  // label comes back as warped pseudo-lettering. Remotion renders the actual
  // screenshot, so the product on screen is the product.
  if (continuity.needsUI && caps.hasUIStates && !caps.remotionAvailable) {
    // The screens exist but Remotion cannot deliver at this aspect ratio. The
    // honest fallback is to animate the real screenshot with image-to-video: it
    // is the actual product on screen, and Veo only has to move the camera over
    // it rather than draw an interface it cannot spell.
    const { to, from } = uiTransitionFor(shot, memory.uiStates);
    const screen = (to && to.imageUrl) || (from && from.imageUrl) || '';
    if (isHttpUrl(screen)) {
      return {
        generation_strategy: 'image_to_video',
        engine: 'veo_i2v',
        character_reference: null,
        environment_reference: screen,
        previous_best_frame: null,
        story_state: state,
        camera_continuity: false,
        from_ui_state: from ? from.id : undefined,
        to_ui_state: to ? to.id : undefined,
        camera_motion: 'push_in',
        visual_strategy: 'USE_UI',
        reason:
          'Your real product screen, animated with a camera move — the deterministic UI renderer only outputs ' +
          'landscape, so a vertical video uses the screenshot directly instead.',
      };
    }
  }

  if (continuity.needsUI && caps.hasUIStates && caps.remotionAvailable) {
    const { from, to } = uiTransitionFor(shot, memory.uiStates);
    return {
      generation_strategy: 'remotion',
      engine: 'remotion',
      character_reference: null,
      environment_reference: null,
      previous_best_frame: null,
      story_state: state,
      camera_continuity: true,
      from_ui_state: from ? from.id : undefined,
      to_ui_state: to ? to.id : undefined,
      camera_motion: /pull|wide|back|out/i.test(shot.prompt) ? 'pull_back' : 'push_in',
      visual_strategy: 'USE_UI',
      reason: 'Real product UI is on screen, so this shot is animated deterministically rather than generated.',
    };
  }

  // ---- 2. Explicit avatar / presenter / talking-head shot → HeyGen ----
  if (heygenEligible({ shot, continuity, plan, caps })) {
    return {
      generation_strategy: 'heygen_avatar',
      engine: 'heygen',
      character_reference: characterReference,
      environment_reference: environmentReference,
      previous_best_frame: null,
      story_state: state,
      camera_continuity: false,
      reason: 'The director explicitly planned an on-camera presenter, which is what the avatar engine is for.',
    };
  }

  // ---- 3. A recurring character → Veo image-to-video ----
  if (continuity.needsCharacter && characterReference) {
    const chained = !!previousFrame && !continuity.newScene;
    return {
      generation_strategy: chained ? 'last_frame_plus_character_reference' : 'new_scene_reference',
      engine: 'veo_i2v',
      character_reference: characterReference,
      environment_reference: environmentReference,
      previous_best_frame: chained ? previousFrame : null,
      story_state: state,
      camera_continuity: chained,
      reason: chained
        ? 'The same person continues in the same place, so this shot carries the character master and the previous best frame.'
        : 'A new scene with the same person, so this shot anchors on the character master and the new environment.',
    };
  }

  // ---- 4. Physics / believable motion → Veo text-to-video, said out loud ----
  if (continuity.needsPhysics) {
    return {
      generation_strategy: 'text_to_video',
      engine: 'veo_t2v',
      character_reference: null,
      environment_reference: environmentReference,
      previous_best_frame: null,
      story_state: state,
      camera_continuity: false,
      visual_strategy: 'GENERATE_VIDEO',
      reason: 'The point of this shot is believable motion, so it renders as free text-to-video with a physics brief.',
    };
  }

  // ---- 5. B-roll, with the Visual Metaphor Agent's verdict honoured ----
  const strategy: VisualStrategy = input.visualStrategy || 'GENERATE_VIDEO';

  if ((strategy === 'USE_LAST_FRAME' || strategy === 'USE_BRIDGE_SHOT') && previousFrame) {
    return {
      generation_strategy: 'image_to_video',
      engine: 'veo_i2v',
      character_reference: null,
      environment_reference: environmentReference,
      previous_best_frame: previousFrame,
      story_state: state,
      camera_continuity: true,
      visual_strategy: strategy,
      reason:
        strategy === 'USE_BRIDGE_SHOT'
          ? 'A short connective beat between two worlds, so it grows out of the frame before it.'
          : 'This beat continues the previous image rather than opening a new world, so it seeds from that frame.',
    };
  }

  if ((strategy === 'USE_REFERENCE' || strategy === 'GENERATE_IMAGE_THEN_VIDEO') && environmentReference) {
    return {
      generation_strategy: 'new_scene_reference',
      engine: 'veo_i2v',
      character_reference: null,
      environment_reference: environmentReference,
      previous_best_frame: null,
      story_state: state,
      camera_continuity: false,
      visual_strategy: strategy,
      reason: 'The composition matters more than the motion here, so a still anchors the shot and Veo animates it.',
    };
  }

  // USE_MOTION_GRAPHIC / USE_TEXT are ideas no camera can film. Remotion can
  // draw them honestly (and can spell), so they go there when the production
  // has a Remotion path at all; otherwise they degrade to generated footage.
  if (
    (strategy === 'USE_MOTION_GRAPHIC' || strategy === 'USE_TEXT') &&
    caps.mode !== 'avatar' &&
    caps.remotionAvailable
  ) {
    return {
      generation_strategy: 'remotion',
      engine: 'remotion',
      character_reference: null,
      environment_reference: null,
      previous_best_frame: null,
      story_state: state,
      camera_continuity: false,
      camera_motion: 'hold',
      visual_strategy: strategy,
      reason: 'This beat is an abstract idea no camera can film, so it is drawn as a motion graphic instead.',
    };
  }

  const seed = previousFrame && !continuity.newScene ? previousFrame : null;
  return {
    generation_strategy: seed ? 'image_to_video' : 'text_to_video',
    engine: seed ? 'veo_i2v' : 'veo_t2v',
    character_reference: null,
    environment_reference: environmentReference,
    previous_best_frame: seed,
    story_state: state,
    camera_continuity: !!seed,
    visual_strategy: strategy,
    reason: seed
      ? 'B-roll continuing the same world, seeded from the previous best frame.'
      : 'Fresh B-roll in a new world, generated from the shot description and the production look.',
  };
}

/**
 * The decision for a REGENERATION after the Continuity Check failed. The
 * bridge frame is the last still that DID match the masters, so the retry
 * starts from known-good ground instead of from the drifted frame that caused
 * the failure — which is the difference between recovering and compounding.
 */
export function bridgeDecision(input: {
  shot: ShotState;
  previousShot: ShotState | null;
  continuity: ContinuityNeed;
  memory: ProductionMemory;
  plan: StoryPlan | null;
  caps: RouterCapabilities;
}): GenerationDecision {
  const master = input.memory.characterMasters[0] || null;
  // Preference order: the master's own full-body reference (never drifted), the
  // previous shot's approved best frame, then the environment plate.
  const bridge =
    (master && (isHttpUrl(master.fullBodyReference) ? master.fullBodyReference : master.faceReference)) ||
    previousBestFrame(input.previousShot, input.memory) ||
    environmentFor(input.shot, input.plan, input.memory) ||
    null;
  return routeShot({ ...input, bridgeFrom: isHttpUrl(bridge) ? String(bridge) : null });
}

// ---------------------------------------------------------------------------
// Prompt assembly — where the decision becomes text an engine will accept
// ---------------------------------------------------------------------------
/**
 * Build the prompt for one Veo shot from its decision.
 *
 * ORDER MATTERS, because the prompt is clamped from the END: the character
 * seed line and the continuity note are written FIRST, so the only thing a
 * long description can lose is its own tail — never the lock.
 *
 * THE WINDOW IS ENFORCED, NOT ASSUMED. /api/veo/generate/video refuses a prompt
 * outside 10–1000 characters outright, and the generate-video hook slices at
 * the same ceiling after adding several hundred characters of its own lock
 * wording. So this returns something guaranteed to be inside the window: too
 * long is clamped, and too short is padded with the production's own look
 * rather than sent to be rejected.
 */
export function buildShotPrompt(input: {
  shot: ShotState;
  decision: GenerationDecision;
  memory: ProductionMemory;
  plan: StoryPlan | null;
  shotTotal: number;
}): string {
  const { shot, decision, memory, plan } = input;
  const master = memory.characterMasters[0] || null;
  const pieces: string[] = [];

  if (decision.character_reference && master) pieces.push(master.seedLine);

  const bible = memory.visualBible || (plan
    ? {
        colorGrade: plan.look,
        lighting: plan.look,
        cameraStyle: plan.look,
        environment: plan.world,
        atmosphere: plan.look,
      }
    : null);
  if (bible) {
    pieces.push(
      clampText(
        `Visual style: grade ${clampText(bible.colorGrade, 55)}; lighting ${clampText(bible.lighting, 50)}; ` +
          `camera ${clampText(bible.cameraStyle, 50)}; location ${clampText(bible.environment, 60)}; ` +
          `mood ${clampText(bible.atmosphere, 45)}. Maintain this exact lighting, color grade, environment and atmosphere.`,
        300,
      ),
    );
  }

  const priorVisual = memory.visualMemory
    .filter((entry) => entry.shot < shot.index)
    .sort((a, b) => b.shot - a.shot)[0];
  if (priorVisual) {
    pieces.push(
      `Continue visually from the previous shot: ${clampText(
        [priorVisual.visualWorld, priorVisual.objects.join(', '), priorVisual.lighting, priorVisual.camera, priorVisual.motion]
          .filter(Boolean)
          .join('; '),
        130,
      )}.`,
    );
  }

  pieces.push(
    `Camera progression: ${shot.cameraDistance || 'medium'} distance, ${shot.cameraMovement || 'static'} movement. ` +
      `${clampText(shot.visualConnection || 'Make the cut feel like the next deliberate step in one visual sequence.', 105)}`,
  );
  if (shot.finalContinuityContext) {
    pieces.push(`FINAL CONTINUITY REPAIR: ${clampText(shot.finalContinuityContext, 170)}`);
  } else if (shot.continuityVerdict && !shot.continuityVerdict.passed) {
    pieces.push(
      `STRONG CONTINUITY CORRECTION: the previous take failed because ${clampText(shot.continuityVerdict.reason, 160)}. ` +
        'Match the visual bible exactly.',
    );
  }

  if (decision.previous_best_frame) {
    pieces.push(
      decision.camera_continuity
        ? 'Continuing straight on from the previous shot: same place, same wardrobe, same light.'
        : 'Growing out of the previous frame into the next moment.',
    );
  } else if (decision.generation_strategy === 'new_scene_reference') {
    pieces.push('A new location in the same piece.');
  }

  if (decision.engine === 'veo_t2v' && shot.continuity && shot.continuity.needsPhysics) {
    pieces.push('Physically believable motion: real weight, real momentum, correct contact and follow-through.');
  }

  const lead = pieces.join(' ');
  const look = !bible && plan && plan.look ? ` ${clampText(plan.look, 90)}.` : '';
  const anchors = memory.anchors.style && !look && !bible ? ` ${clampText(memory.anchors.style, 90)}.` : '';
  const tail = `${look}${anchors}`;
  const room = Math.max(120, SHOT_PROMPT_MAX - lead.length - tail.length);
  const body = clampText(shot.prompt, room);

  let prompt = `${lead ? `${lead} ` : ''}${body}${tail}`.trim();

  // Too short is a 400 from the proxy, so it is topped up with real production
  // detail rather than filler.
  if (prompt.length < VEO_PROMPT_MIN) {
    prompt = clampText(
      `${prompt} ${shot.label} shot. ${plan ? plan.look || plan.world : ''} Cinematic, professional cinematography.`.trim(),
      VEO_PROMPT_MAX,
    );
  }
  return clampText(prompt, VEO_PROMPT_MAX);
}

/**
 * The reference images one Veo shot carries, in priority order and capped at
 * the three the proxy accepts. Identity first, place second, continuity third:
 * if something has to be dropped it is the least load-bearing reference.
 */
export function referencesFor(decision: GenerationDecision, memory: ProductionMemory): {
  identity: string;
  place: string;
  firstFrame: string;
  visualReferences: string[];
} {
  const master = memory.characterMasters[0] || null;
  const identity =
    decision.character_reference && isHttpUrl(decision.character_reference)
      ? decision.character_reference
      : master && isHttpUrl(master.faceReference)
        ? master.faceReference
        : master && isHttpUrl(master.fullBodyReference)
          ? master.fullBodyReference
          : '';
  const place = isHttpUrl(decision.environment_reference) ? String(decision.environment_reference) : '';
  const firstFrame = isHttpUrl(decision.previous_best_frame) ? String(decision.previous_best_frame) : '';
  const visualReferences = (decision.reference_images || memory.referenceImages || [])
    .filter((url, index, all) => isHttpUrl(url) && all.indexOf(url) === index)
    .slice(0, 10);
  return { identity, place, firstFrame, visualReferences };
}

/** A short human line for the shot card: what this shot is doing, and how. */
export function decisionSummary(decision: GenerationDecision | null): string {
  if (!decision) return 'Waiting for its routing decision';
  const engineLabel: Record<ShotEngine, string> = {
    veo_i2v: 'Veo · image-to-video',
    veo_t2v: 'Veo · text-to-video',
    heygen: 'HeyGen · avatar',
    remotion: 'Remotion · deterministic UI',
  };
  return `${engineLabel[decision.engine]} — ${decision.reason}`;
}

/** Whether a verdict should trigger a regeneration. Exported so the UI agrees. */
export function verdictFailed(score: number): boolean {
  return score < CONTINUITY_PASS_SCORE;
}
