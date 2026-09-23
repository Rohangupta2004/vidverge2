/**
 * ORCHESTRATOR — drives the AI Product Advertisement Director end to end and
 * persists every step, so a reload resumes instead of restarting:
 *
 *   Understanding Product → Ad Strategy → Voiceover Script → Recording Voice
 *   → Visual Storyboard → Generating Scenes (sequential, one at a time)
 *   → Quality Check → Composing Final Ad → (optional) Ad Variations
 *
 * VOICE-FIRST TIMING: the script is written and every scene's narration is
 * spoken + MEASURED before any visual exists; visual durations derive from
 * the audio. Generative video (Google Omni Flash — the default and only
 * generative model here) is used ONLY for B-roll/lifestyle/cinematic scenes;
 * product UI is always a REAL screenshot in a device mockup with a cursor
 * layer; explanations are GSAP+SVG motion graphics. No Remotion.
 *
 * Per scene the loop is agentic: PLAN → GENERATE → INSPECT (Opus vision vs
 * narration + intent) → FIX/REGENERATE (up to 2 retries with concrete fix
 * notes) → CONTINUE (continuity snapshot handed to the next chained scene).
 * After production, a QUALITY CONTROL pass re-checks every scene against the
 * seven-point checklist and regenerates only the weak ones.
 */

import { extractFrame, probeClipDuration, recordSvgAnimation, uploadClip } from '../../ScriptToVideo/pipeline/capture';
import { VideoModelService } from '../../ScriptToVideo/pipeline/videoModelService';
import { generateMusicBed, generateSfxBed } from '../audioSuite';
import {
  AdVariation, Aspect, Film, FilmScene, MotionSpec, SceneQaReport,
  VARIATION_IDX_BASE, VideoStyle, VisualType, autoGenerateOn, autoMixOn, db,
  frameSize, newSceneKey, sceneFingerprint, visualTypeToSource,
} from './api';
import {
  VariationRecipe, buildAdStrategy, buildVisualStoryboard,
  continuitySnapshotFromFrame, derivedDuration, inspectScene,
  qualityCheckScene, rewriteSpecForVisualType, understandProduct,
  writeAdScript, writeVariationRecipes, writeVideoPrompt,
} from './director';
import { generateOrReuseAsset, registerUpload } from './assets';
import { buildCapturedScene, brandPalette } from './scenes';
import { buildMotionOverlay } from './motion';
import { buildCaptionOverlay, buildExactTextOverlay } from './captions';
import { buildRequiredContent, runFinalVideoQa, runSceneOutputQa, validateClipIntegrity } from './qa';
import { ComposeInput, composeFilm } from './compose';
import { remotionAvailable, renderRemotionScene, sceneWantsRemotion } from './remotionKit';
import { speakSceneLine } from './voiceover';

export interface RunHooks {
  onFilm?: (patch: Partial<Film>) => void;
  onScene?: (sceneId: number, patch: Partial<FilmScene>) => void;
  onScenesReplaced?: (scenes: FilmScene[]) => void;
  onNote?: (note: string) => void;
}

const say = (hooks: RunHooks, note: string) => { try { hooks.onNote?.(note); } catch { /* UI only */ } };

async function patchFilm(film: Film, hooks: RunHooks, patch: Partial<Film>): Promise<void> {
  Object.assign(film, patch);
  try { hooks.onFilm?.(patch); } catch { /* UI only */ }
  await db.updateFilm(film.id, patch);
}

async function patchScene(scene: FilmScene, hooks: RunHooks, patch: Partial<FilmScene>): Promise<void> {
  Object.assign(scene, patch);
  try { hooks.onScene?.(scene.id, patch); } catch { /* UI only */ }
  await db.updateScene(scene.id, patch);
}

/** The main ad's scenes — variation-only scenes (idx >= 100) excluded. */
export function mainScenes(scenes: FilmScene[]): FilmScene[] {
  return scenes.filter((s) => Number(s.idx) < VARIATION_IDX_BASE).sort((a, b) => a.idx - b.idx);
}

// ---------------------------------------------------------------------------
// Film creation
// ---------------------------------------------------------------------------

export async function createFilm(params: {
  url?: string | null;
  screenshots: string[];
  goal?: string | null;
  aspect: Aspect;
  voice?: string | null;
  /** "How do you want your product video to feel?" — persisted with the project. */
  videoStyle?: VideoStyle | null;
  /** Auto Generate / Auto Mix — ON by default; the user may turn either off. */
  autoGenerate?: boolean;
  autoMix?: boolean;
}): Promise<Film> {
  const film = await db.createFilm({
    title: null,
    source_url: params.url || null,
    goal: params.goal || null,
    video_style: params.videoStyle || null,
    aspect_ratio: params.aspect,
    screenshots: params.screenshots,
    narration_voice: params.voice || null,
    auto_generate: params.autoGenerate !== false,
    auto_mix: params.autoMix !== false,
    status: 'draft',
    stage_note: 'Queued — the director is about to start.',
  });
  // Register uploads in the shared asset cache so Opus can reuse them later.
  for (const url of params.screenshots) {
    try { await registerUpload(film.id, url, 'User-uploaded product screenshot (ground-truth UI)'); } catch { /* best-effort */ }
  }
  return film;
}

// ---------------------------------------------------------------------------
// Stage runners (each is idempotent — a persisted result is never redone)
// ---------------------------------------------------------------------------

async function runUnderstanding(film: Film, hooks: RunHooks): Promise<void> {
  if (film.brief) return;
  await patchFilm(film, hooks, { status: 'understanding', stage_note: 'Researching the product — website, screenshots, positioning…', error: null });
  const brief = await understandProduct({
    url: film.source_url,
    screenshotUrls: film.screenshots || [],
    goal: film.goal,
    onNote: (n) => say(hooks, n),
  });
  await patchFilm(film, hooks, { brief, stage_note: `Understood: ${brief.product_name}.` });
}

async function runStrategy(film: Film, hooks: RunHooks): Promise<void> {
  if (film.strategy) return;
  await patchFilm(film, hooks, { status: 'strategizing', stage_note: 'Choosing the hook and ad structure…', error: null });
  const strategy = await buildAdStrategy({ brief: film.brief!, goal: film.goal });
  await patchFilm(film, hooks, {
    strategy,
    stage_note: `Strategy set: ${strategy.hook_type} hook · ${strategy.structure.join(' → ')}.`,
  });
}

async function runScript(film: Film, hooks: RunHooks): Promise<void> {
  if (film.ad_script?.scenes?.length) return;
  await patchFilm(film, hooks, { status: 'scripting', stage_note: 'Writing the complete voiceover script — before any visuals…', error: null });
  const script = await writeAdScript({ brief: film.brief!, strategy: film.strategy!, goal: film.goal });
  await patchFilm(film, hooks, { ad_script: script, stage_note: `${script.scenes.length}-scene script written (≈${script.estimated_s}s spoken).` });
}

/** Speak every scripted line and MEASURE it — the master clock. Progress
 * persists into film.ad_script so a reload never re-bills finished lines. */
async function runVoicing(film: Film, hooks: RunHooks): Promise<void> {
  const script = film.ad_script!;
  const pending = script.scenes.filter((s: any) => !s.narration_url);
  if (!pending.length) return;
  await patchFilm(film, hooks, { status: 'voicing', stage_note: 'Recording the voiceover, scene by scene…', error: null });
  for (let i = 0; i < script.scenes.length; i += 1) {
    const s: any = script.scenes[i];
    if (s.narration_url) continue;
    say(hooks, `Voice ${i + 1}/${script.scenes.length}: “${String(s.narration).slice(0, 60)}…”`);
    const voice = await speakSceneLine(s.narration, film.narration_voice);
    s.narration_url = voice.url;
    s.narration_s = voice.seconds;
    s.voice_engine = voice.engine;
    await patchFilm(film, hooks, { ad_script: { ...script } });
  }
  const total = script.scenes.reduce((a: number, s: any) => a + (Number(s.narration_s) || 0), 0);
  await patchFilm(film, hooks, { stage_note: `Voiceover recorded — ${Math.round(total)}s of narration measured.` });
}

async function runStoryboarding(film: Film, hooks: RunHooks): Promise<FilmScene[]> {
  const existing = mainScenes(await db.listScenes(film.id));
  if (film.plan && existing.length) return existing;
  await patchFilm(film, hooks, { status: 'storyboarding', stage_note: 'Designing the most understandable visual for every line…', error: null });
  const assets = await db.listAssets(film.id);
  const script = film.ad_script!;
  const voiced = script.scenes.map((s: any, i: number) => ({
    idx: i,
    beat: s.beat,
    narration: s.narration,
    narration_s: Number(s.narration_s) || 3,
    product_action: s.product_action,
    on_screen_text: s.on_screen_text,
    visual_hint: s.visual_hint,
  }));
  const shots = [...(film.screenshots || [])];
  if (film.brief?.site_screenshot_url) shots.push(film.brief.site_screenshot_url);
  const plan = await buildVisualStoryboard({
    brief: film.brief!,
    strategy: film.strategy!,
    script: voiced,
    goal: film.goal,
    aspect: (film.aspect_ratio || '16:9') as Aspect,
    screenshots: shots,
    assets,
    videoStyle: film.video_style,
  });
  for (const old of existing) { try { await db.deleteScene(old.id); } catch { /* replaced */ } }
  for (const s of plan.scenes) {
    const scripted: any = script.scenes[Math.min(s.idx, script.scenes.length - 1)] || {};
    await db.insertScene({
      film_id: film.id,
      idx: s.idx,
      scene_key: s.scene_key,
      source: s.source,
      beat_title: s.beat_title,
      purpose: s.purpose,
      rationale: s.rationale || null,
      spec: s.spec,
      motion: s.motion || { kind: 'none' },
      transition_in: s.transition_in || 'cut',
      transition_out: s.transition_out || 'cut',
      status: 'pending',
      attempts: 0,
      duration_s: s.duration_s,
      continuity_group: s.continuity_group,
      narration: s.narration || scripted.narration || '',
      narration_url: scripted.narration_url || null,
      narration_s: Number(scripted.narration_s) || null,
      visual_type: s.visual_type || null,
      visual_prompt: s.visual_prompt || null,
      on_screen_text: s.on_screen_text || null,
      product_action: s.product_action || null,
      music_mood: s.music_mood || null,
      sfx: s.sfx || null,
      reference_assets: null,
      required_content: s.required_content || null,
      qa_report: null,
    });
  }
  await patchFilm(film, hooks, { title: plan.title, plan, stage_note: `${plan.scenes.length} scenes storyboarded — visuals timed to the voice.` });
  const scenes = mainScenes(await db.listScenes(film.id));
  try { hooks.onScenesReplaced?.(scenes); } catch { /* UI only */ }
  return scenes;
}

// ---------------------------------------------------------------------------
// Scene production — the agentic generate → inspect → fix loop
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3; // initial take + 2 fix retries

async function recordMotionOverlay(film: Film, scene: FilmScene, hooks: RunHooks, durationS: number): Promise<string | null> {
  const motion = scene.motion as MotionSpec | null;
  if (!motion || motion.kind === 'none') return null;
  try {
    say(hooks, `Scene ${scene.idx + 1}: recording the motion-design layer…`);
    const { W, H } = frameSize((film.aspect_ratio || '16:9') as Aspect);
    const built = buildMotionOverlay(motion, brandPalette(film), W, H, durationS + 1); // slightly long; composition bounds it
    const blob = await recordSvgAnimation(built, W, H);
    return await uploadClip(blob, `pf-${film.id}-${scene.scene_key}-motion.webm`);
  } catch (e: any) {
    say(hooks, `Scene ${scene.idx + 1}: the motion layer could not be recorded (${String(e?.message || e).slice(0, 90)}) — the scene ships without it.`);
    return null;
  }
}

/** Captions — built from the scene's ACTUAL narration, timed to its audio. */
async function recordCaptions(film: Film, scene: FilmScene, hooks: RunHooks): Promise<string | null> {
  if (!scene.narration) return null;
  try {
    const { W, H } = frameSize((film.aspect_ratio || '16:9') as Aspect);
    const built = buildCaptionOverlay(
      scene.narration,
      Number(scene.duration_s) || 5,
      Number(scene.narration_s) || 0,
      W, H,
      brandPalette(film).accent,
    );
    if (!built) return null;
    say(hooks, `Scene ${scene.idx + 1}: recording the captions…`);
    const blob = await recordSvgAnimation(built, W, H);
    return await uploadClip(blob, `pf-${film.id}-${scene.scene_key}-captions.webm`);
  } catch (e: any) {
    say(hooks, `Scene ${scene.idx + 1}: captions could not be recorded (${String(e?.message || e).slice(0, 90)}) — the scene ships without them.`);
    return null;
  }
}

/** EXACT TEXT NEVER DEPENDS ON AI VIDEO — when a generative-video scene
 * carries required on-screen text, it is rendered HERE as a deterministic
 * SVG overlay (recorded on black, colorkeyed over the footage in FFmpeg).
 * The generative model is never trusted to draw precise information. */
async function recordTextOverlay(film: Film, scene: FilmScene, hooks: RunHooks): Promise<string | null> {
  const text = String(scene.on_screen_text || '').trim();
  if (!text) return null;
  if (scene.layer_urls?.text_overlay) return scene.layer_urls.text_overlay;
  try {
    say(hooks, `Scene ${scene.idx + 1}: rendering the exact-text overlay (“${text}”)…`);
    const { W, H } = frameSize((film.aspect_ratio || '16:9') as Aspect);
    const built = buildExactTextOverlay(text, Number(scene.duration_s) || 6, W, H, brandPalette(film).accent);
    if (!built) return null;
    const blob = await recordSvgAnimation(built, W, H);
    return await uploadClip(blob, `pf-${film.id}-${scene.scene_key}-text.webm`);
  } catch (e: any) {
    say(hooks, `Scene ${scene.idx + 1}: the exact-text overlay could not be recorded (${String(e?.message || e).slice(0, 90)}) — QA will flag the missing text.`);
    return null;
  }
}

/** Make sure a scene has spoken, measured narration; derive its duration. */
async function ensureSceneVoice(film: Film, scene: FilmScene, hooks: RunHooks): Promise<void> {
  if (!scene.narration || scene.narration_url) return;
  say(hooks, `Scene ${scene.idx + 1}: recording the narration line…`);
  const voice = await speakSceneLine(scene.narration, film.narration_voice);
  await patchScene(scene, hooks, {
    narration_url: voice.url,
    narration_s: voice.seconds,
    duration_s: derivedDuration(scene.source, voice.seconds),
  });
}

/** Generative video scene (Omni Flash) — B-roll/lifestyle/cinematic ONLY. */
async function produceVideoScene(film: Film, scene: FilmScene, prev: FilmScene | null, hooks: RunHooks): Promise<void> {
  const spec = scene.spec as any;
  const chain = !!spec.seed_from_previous && !!prev?.keyframe_url;
  const continuity = chain ? (prev?.continuity || null) : null;
  let fixNotes: string | null = spec.fix_note ? String(spec.fix_note) : null;
  // USER PROMPT OVERRIDE — when the user edited the prompt, their EXACT text
  // is the generation prompt. It is never rewritten by Opus; automatic fix
  // retries only APPEND a bracketed [Fix] clause after the user's words.
  const override = String(scene.user_prompt_override || '').trim();
  const overrideNegative = () => {
    const base = 'on-screen text, captions, subtitles, watermarks, logos, UI elements, screens with readable content, distorted hands, distorted faces';
    return base + (spec.must_not_appear ? `, ${String(spec.must_not_appear).slice(0, 150)}` : '');
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await patchScene(scene, hooks, { attempts: attempt });
    try {
      let prompt: string; let negative: string;
      if (override) {
        say(hooks, `Scene ${scene.idx + 1}: using your exact edited prompt${fixNotes ? ' (with the fix note appended)' : ''}…`);
        prompt = (fixNotes ? `${override}\n[Fix]: ${fixNotes.slice(0, 200)}` : override).slice(0, 990);
        negative = overrideNegative();
      } else {
        say(hooks, `Scene ${scene.idx + 1}: writing the production prompt${attempt > 1 ? ` (take ${attempt})` : ''}…`);
        const written = await writeVideoPrompt(scene, film.plan!, film.brief, continuity, fixNotes);
        prompt = written.prompt; negative = written.negative;
      }
      await patchScene(scene, hooks, { veo_prompt: { prompt, negative }, ...(override ? {} : { generated_prompt: prompt }) });

      const refs: { role: 'first_frame' | 'reference'; url: string }[] = [];
      if (chain && prev?.keyframe_url) refs.push({ role: 'first_frame', url: prev.keyframe_url });
      for (const r of scene.reference_assets || []) if (r?.url) refs.push({ role: r.role === 'first_frame' ? 'first_frame' : 'reference', url: r.url });

      say(hooks, `Scene ${scene.idx + 1}: filming on Omni Flash${chain ? ' (continuing from the previous shot)' : ''}…`);
      const job = await VideoModelService.createVideo({
        prompt, negative,
        aspect: (film.aspect_ratio || '16:9') as Aspect,
        durationS: Number(scene.duration_s) || 6,
        referenceAssets: refs,
      });
      await patchScene(scene, hooks, { veo_operation_id: job.jobId });
      const videoUrl = await VideoModelService.getVideoResult(job.jobId);
      // Explicit state machine: GENERATING → VALIDATING → QA_CHECKING → READY.
      await patchScene(scene, hooks, { clip_url: videoUrl, veo_operation_id: null, status: 'validating' });

      // BLANK AI-VIDEO VALIDATION — the API returning a URL is NOT success.
      // The file must exist, decode, have real duration/dimensions and
      // non-blank frames before it counts as a take at all.
      say(hooks, `Scene ${scene.idx + 1}: validating the rendered file…`);
      const integrity = await validateClipIntegrity(videoUrl);
      if (!integrity.ok) {
        if (attempt < MAX_ATTEMPTS) {
          fixNotes = `Scene ${scene.idx + 1} failed video validation. Expected: a real, decodable, non-blank video. Detected: ${integrity.reason || 'blank or corrupt file'}. Write a fresh, concrete prompt for the same story beat.`;
          say(hooks, `Scene ${scene.idx + 1}: invalid video detected (${integrity.reason || 'blank/corrupt'}). Attempt ${attempt}/${MAX_ATTEMPTS} — retrying with a corrected prompt…`);
          await patchScene(scene, hooks, { status: 'retrying', error: `Invalid video detected — ${integrity.reason || 'blank or corrupt render'} (attempt ${attempt}/${MAX_ATTEMPTS}).`, clip_url: null, inspection: { pass: false, issues: integrity.reason || 'Blank/corrupt render.', method: 'integrity', attempts: attempt } });
          continue;
        }
        throw new Error(`AI video failed after ${MAX_ATTEMPTS} takes: ${integrity.reason || 'blank or corrupt render'}. Press Retry, edit the prompt, add a retake note, or swap the visual type.`);
      }

      say(hooks, `Scene ${scene.idx + 1}: extracting keyframes…`);
      let firstFrame = ''; let lastFrame = '';
      try { firstFrame = await extractFrame(videoUrl, 0.15); } catch { /* inspection degrades */ }
      try { lastFrame = await extractFrame(videoUrl, 'end'); } catch { /* continuity degrades */ }

      let snapshot: any = null;
      if (lastFrame) {
        say(hooks, `Scene ${scene.idx + 1}: reading the end state for continuity…`);
        snapshot = await continuitySnapshotFromFrame(lastFrame);
      }

      await patchScene(scene, hooks, { status: 'qa_checking' });
      say(hooks, `Scene ${scene.idx + 1}: the director is inspecting the take…`);
      const verdict = await inspectScene(scene, film.plan!, [firstFrame, lastFrame].filter(Boolean));

      if (!verdict.pass && attempt < MAX_ATTEMPTS) {
        fixNotes = `Scene ${scene.idx + 1} failed inspection. Expected: ${scene.purpose || scene.visual_prompt || 'the storyboard subject'}. Detected: ${verdict.issues}. ${verdict.fix_hint || ''}`.trim();
        say(hooks, `Scene ${scene.idx + 1}: take rejected (${verdict.issues}). Attempt ${attempt}/${MAX_ATTEMPTS} — retrying with fixes…`);
        await patchScene(scene, hooks, { status: 'retrying', error: `Take rejected — ${String(verdict.issues).slice(0, 220)} (attempt ${attempt}/${MAX_ATTEMPTS}).`, inspection: { pass: false, issues: verdict.issues, method: verdict.method, attempts: attempt } });
        continue;
      }

      // Exact text lives on the deterministic overlay — never in the AI video.
      const textOverlayUrl = await recordTextOverlay(film, scene, hooks);

      // RENDERED-OUTPUT QA — frames extracted from the ACTUAL clip, OCR +
      // vision compared against the scene's required-content manifest.
      const qa = await runSceneOutputQa({
        clipUrl: videoUrl,
        textOverlayUrl,
        durationS: Number(scene.duration_s) || 6,
        required: scene.required_content,
        source: 'veo',
        onNote: (n) => say(hooks, `Scene ${scene.idx + 1}: ${n}`),
      });
      // A wrong/missing SUBJECT means the take itself is bad — retake it. A
      // text failure is an overlay problem: retaking footage cannot fix it.
      const badTake = !qa.pass && qa.failures.some((f) => f.requirement === 'visual' || f.requirement === 'integrity');
      if (badTake) {
        const takeFailures = qa.failures.filter((f) => f.requirement !== 'text');
        const expected = takeFailures.map((f) => f.expected).join('; ').slice(0, 300);
        const detected = takeFailures.map((f) => f.detected).join('; ').slice(0, 300);
        if (attempt < MAX_ATTEMPTS) {
          // Opus receives the ACTUAL QA failure (expected vs detected) and
          // writes a corrected prompt for the next take of THIS scene only.
          fixNotes = `Scene ${scene.idx + 1} failed QA. Expected: ${expected}. Detected: ${detected}. Write a corrected prompt that concretely fixes this.`;
          say(hooks, `Scene ${scene.idx + 1}: output QA failed. Expected: ${expected.slice(0, 120)} — detected: ${detected.slice(0, 120)}. Attempt ${attempt}/${MAX_ATTEMPTS} — retrying…`);
          await patchScene(scene, hooks, { status: 'retrying', error: `QA failed — expected: ${expected.slice(0, 180)}; detected: ${detected.slice(0, 180)} (attempt ${attempt}/${MAX_ATTEMPTS}).`, qa_report: qa, inspection: { pass: false, issues: qa.failures.map((f) => f.cause).join(' · ').slice(0, 300), method: 'frames_ocr_vision', attempts: attempt } });
          continue;
        }
        // The last allowed take still failed hard QA — the scene is FAILED,
        // never READY with a bad render.
        await patchScene(scene, hooks, { qa_report: qa, inspection: { pass: false, issues: qa.failures.map((f) => f.cause).join(' · ').slice(0, 300), method: 'frames_ocr_vision', attempts: attempt } });
        throw new Error(`AI video failed QA after ${MAX_ATTEMPTS} takes. Expected: ${expected}. Detected: ${detected}. Press Retry, edit the prompt, or swap the visual type.`);
      }

      // Accept — flagged when the last allowed take still missed the intent.
      const overlayUrl = await recordMotionOverlay(film, scene, hooks, Number(scene.duration_s) || 6);
      const captionsUrl = await recordCaptions(film, scene, hooks);
      await patchScene(scene, hooks, {
        status: 'ready',
        error: null,
        first_frame_url: firstFrame || null,
        keyframe_url: lastFrame || null,
        continuity: snapshot,
        qa_report: qa,
        layer_urls: {
          ...(scene.layer_urls || {}),
          ...(overlayUrl ? { motion_overlay: overlayUrl } : {}),
          ...(textOverlayUrl ? { text_overlay: textOverlayUrl } : {}),
          ...(captionsUrl ? { captions: captionsUrl } : {}),
        },
        inspection: { pass: verdict.pass && qa.pass, issues: [verdict.issues, ...qa.failures.map((f) => f.cause)].filter(Boolean).join(' · ').slice(0, 400), method: qa.pass ? verdict.method : 'frames_ocr_vision', attempts: attempt },
      });
      if (scene.continuity_group && lastFrame) {
        const cont = { ...(film.continuity || {}) };
        cont[scene.continuity_group] = { keyframe_url: lastFrame, snapshot };
        await patchFilm(film, hooks, { continuity: cont });
      }
      return;
    } catch (e: any) {
      const message = String(e?.message || e);
      if (attempt >= MAX_ATTEMPTS || /billing|declined|402/i.test(message)) throw e;
      fixNotes = `The previous take failed to render (${message.slice(0, 160)}). Rephrase the prompt to avoid the failure — e.g. soften anything a content filter could reject — while keeping the story beat.`;
      say(hooks, `Scene ${scene.idx + 1}: the take failed (${message.slice(0, 120)}). Attempt ${attempt}/${MAX_ATTEMPTS} — trying again…`);
      await patchScene(scene, hooks, { status: 'retrying', error: `Take failed — ${message.slice(0, 200)} (attempt ${attempt}/${MAX_ATTEMPTS}).`, veo_operation_id: null });
    }
  }
}

/** IMAGE scene whose spec asks to be animated — the generated still becomes
 * the Omni Flash seed frame (image-to-video). Falls back to the captured
 * cinematic-still treatment on any failure. */
async function produceAnimatedImageScene(film: Film, scene: FilmScene, hooks: RunHooks, assetUrl: string): Promise<boolean> {
  try {
    say(hooks, `Scene ${scene.idx + 1}: animating the image on Omni Flash…`);
    const concept = scene.visual_prompt || String((scene.spec as any).asset_prompt || '');
    const prompt = `Animate this exact still image with subtle, realistic motion — gentle parallax, drifting light, breathing atmosphere. Preserve the composition, subject and palette exactly. ${concept}`.slice(0, 990);
    const job = await VideoModelService.createVideo({
      prompt,
      negative: 'on-screen text, captions, watermarks, logos, UI elements, distorted subjects, scene changes, new objects',
      aspect: (film.aspect_ratio || '16:9') as Aspect,
      durationS: Number(scene.duration_s) || 6,
      referenceAssets: [{ role: 'first_frame', url: assetUrl }],
    });
    await patchScene(scene, hooks, { veo_operation_id: job.jobId });
    const videoUrl = await VideoModelService.getVideoResult(job.jobId);
    await patchScene(scene, hooks, { status: 'validating' });
    const integrity = await validateClipIntegrity(videoUrl);
    if (!integrity.ok) throw new Error(integrity.reason || 'The animated image render came back blank.');
    const captionsUrl = await recordCaptions(film, scene, hooks);
    await patchScene(scene, hooks, {
      status: 'ready',
      error: null,
      clip_url: videoUrl,
      veo_operation_id: null,
      layer_urls: { ...(scene.layer_urls || {}), asset: assetUrl, ...(captionsUrl ? { captions: captionsUrl } : {}) },
      inspection: { pass: true, issues: '', method: 'image_to_video', attempts: 1 },
    });
    return true;
  } catch (e: any) {
    say(hooks, `Scene ${scene.idx + 1}: image-to-video failed (${String(e?.message || e).slice(0, 110)}) — using the cinematic still instead.`);
    await patchScene(scene, hooks, { veo_operation_id: null });
    return false;
  }
}

/** SECONDARY ENGINE — Remotion. Opt-in per scene via spec.engine='remotion':
 * the SAME normalized spec renders server-side as a frame-accurate multi-layer
 * composition built from the reusable primitives in remotionKit. The rendered
 * MP4 goes through the identical validate → QA gate as every other scene.
 * Returns false (never throws) so a Remotion failure falls back to GSAP. */
async function produceRemotionScene(film: Film, scene: FilmScene, hooks: RunHooks): Promise<boolean> {
  try {
    const durationS = Number(scene.duration_s) || 6;
    say(hooks, `Scene ${scene.idx + 1}: rendering on the Remotion engine…`);
    const url = await renderRemotionScene(film, scene, durationS, (n) => say(hooks, `Scene ${scene.idx + 1}: ${n}`));
    await patchScene(scene, hooks, { status: 'validating' });
    const integrity = await validateClipIntegrity(url);
    if (!integrity.ok) throw new Error(integrity.reason || 'The Remotion render came back blank or corrupt.');
    await patchScene(scene, hooks, { status: 'qa_checking' });
    const qa = await runSceneOutputQa({
      clipUrl: url,
      durationS,
      required: scene.required_content,
      source: scene.source,
      onNote: (n) => say(hooks, `Scene ${scene.idx + 1}: ${n}`),
    });
    if (!qa.pass && qa.failures.some((f) => f.severity === 'critical')) {
      const first = qa.failures.find((f) => f.severity === 'critical')!;
      throw new Error(`Remotion output failed QA — expected ${first.expected}; detected: ${first.detected}.`);
    }
    const captionsUrl = await recordCaptions(film, scene, hooks);
    await patchScene(scene, hooks, {
      status: 'ready',
      error: null,
      clip_url: url,
      duration_s: durationS,
      qa_report: qa,
      layer_urls: { ...(scene.layer_urls || {}), ...(captionsUrl ? { captions: captionsUrl } : {}) },
      inspection: { pass: qa.pass, issues: qa.pass ? '' : qa.failures.map((f) => f.cause).join(' · ').slice(0, 400), method: 'remotion', attempts: 1 },
    });
    return true;
  } catch (e: any) {
    say(hooks, `Scene ${scene.idx + 1}: the Remotion engine did not deliver (${String(e?.message || e).slice(0, 120)}) — using the browser GSAP engine instead.`);
    return false;
  }
}

async function produceCapturedScene(film: Film, scene: FilmScene, hooks: RunHooks): Promise<void> {
  // Asset scenes: resolve the image first through the CACHED Asset Generator.
  if (scene.source === 'asset') {
    const spec = scene.spec as any;
    let assetUrl = scene.layer_urls?.asset || spec.asset_url || '';
    if (!assetUrl) {
      assetUrl = await generateOrReuseAsset({
        filmId: film.id,
        name: scene.beat_title || `Scene ${scene.idx + 1} asset`,
        prompt: String(spec.asset_prompt || scene.visual_prompt || ''),
        aspect: (film.aspect_ratio || '16:9') as any,
        onNote: (n) => say(hooks, `Scene ${scene.idx + 1}: ${n}`),
      });
      await patchScene(scene, hooks, { layer_urls: { ...(scene.layer_urls || {}), asset: assetUrl } });
    }
    // Optional: animate the still with Omni Flash image-to-video.
    if (spec.animate && assetUrl && (await produceAnimatedImageScene(film, scene, hooks, assetUrl))) return;
  }
  // SECONDARY ENGINE: a scene whose spec asks for Remotion (complex,
  // frame-accurate multi-layer composition) renders server-side first — any
  // failure falls straight through to the default GSAP capture below.
  if (sceneWantsRemotion(scene) && remotionAvailable((film.aspect_ratio || '16:9') as Aspect)) {
    if (await produceRemotionScene(film, scene, hooks)) return;
  }
  const { W, H } = frameSize((film.aspect_ratio || '16:9') as Aspect);
  let url = '';
  let durationSec = Number(scene.duration_s) || 6;
  let qa: SceneQaReport | null = null;
  // Deterministic captures are verified like everything else — a capture can
  // silently record a black canvas or clip its text. Critical QA failures
  // re-record (up to 3 takes) and then FAIL the scene — never READY on a bad
  // render; important-only misses ship flagged for the QC pass.
  const CAPTURE_TAKES = 3;
  for (let take = 1; take <= CAPTURE_TAKES; take += 1) {
    say(hooks, `Scene ${scene.idx + 1}: rendering in your browser${take > 1 ? ` (take ${take})` : ''}…`);
    const built = await buildCapturedScene(film, scene);
    durationSec = built.durationSec;
    say(hooks, `Scene ${scene.idx + 1}: recording the animation…`);
    const blob = await recordSvgAnimation(built, W, H);
    say(hooks, `Scene ${scene.idx + 1}: publishing the clip…`);
    url = await uploadClip(blob, `pf-${film.id}-${scene.scene_key}.webm`);
    // VALIDATING → QA — the actual recording, not the spec, is checked.
    await patchScene(scene, hooks, { status: 'validating' });
    qa = await runSceneOutputQa({
      clipUrl: url,
      durationS: built.durationSec,
      required: scene.required_content,
      source: scene.source,
      onNote: (n) => say(hooks, `Scene ${scene.idx + 1}: ${n}`),
    });
    if (qa.pass || !qa.failures.some((f) => f.severity === 'critical')) break;
    if (take < CAPTURE_TAKES) {
      const first = qa.failures.find((f) => f.severity === 'critical');
      say(hooks, `Scene ${scene.idx + 1}: the capture failed QA. Expected: ${first?.expected || '—'} — detected: ${first?.detected || 'blank recording'}. Attempt ${take}/${CAPTURE_TAKES} — recording again…`);
      await patchScene(scene, hooks, { status: 'retrying', error: `Invalid capture — ${String(first?.detected || 'the recording failed QA').slice(0, 200)} (attempt ${take}/${CAPTURE_TAKES}).` });
    }
  }
  // NEVER READY WITH A BAD RENDER: a critical QA failure after every allowed
  // take marks the scene FAILED (the clip is kept as evidence for the report).
  if (qa && !qa.pass && qa.failures.some((f) => f.severity === 'critical')) {
    const first = qa.failures.find((f) => f.severity === 'critical')!;
    await patchScene(scene, hooks, { clip_url: url || null, duration_s: durationSec, qa_report: qa, inspection: { pass: false, issues: qa.failures.map((f) => f.cause).join(' · ').slice(0, 400), method: 'frames_ocr_vision', attempts: CAPTURE_TAKES } });
    throw new Error(`The rendered scene failed QA. Expected: ${first.expected}. Detected: ${first.detected}. Press Retry (or retake with a note).`);
  }
  const captionsUrl = await recordCaptions(film, scene, hooks);
  await patchScene(scene, hooks, {
    status: 'ready',
    error: null,
    clip_url: url,
    duration_s: durationSec,
    qa_report: qa,
    layer_urls: { ...(scene.layer_urls || {}), ...(captionsUrl ? { captions: captionsUrl } : {}) },
    inspection: qa && !qa.pass
      ? { pass: false, issues: qa.failures.map((f) => f.cause).join(' · ').slice(0, 400), method: 'frames_ocr_vision', attempts: 1 }
      : { pass: true, issues: '', method: 'deterministic', attempts: 1 },
  });
}

export async function produceScene(film: Film, scene: FilmScene, allScenes: FilmScene[], hooks: RunHooks): Promise<void> {
  const aspect = (film.aspect_ratio || '16:9') as Aspect;
  await ensureSceneVoice(film, scene, hooks); // voice first — it sets the clock
  const fp = sceneFingerprint(scene, aspect);
  if (scene.clip_url && scene.clip_fingerprint === fp && scene.status === 'ready') return; // cached — nothing changed
  await patchScene(scene, hooks, { status: 'generating', error: null, clip_fingerprint: fp });
  try {
    if (scene.source === 'veo') {
      const prev = allScenes
        .filter((s) => s.continuity_group && s.continuity_group === scene.continuity_group && s.idx < scene.idx)
        .sort((a, b) => b.idx - a.idx)[0] || null;
      await produceVideoScene(film, scene, prev, hooks);
    } else {
      await produceCapturedScene(film, scene, hooks);
    }
  } catch (e: any) {
    await patchScene(scene, hooks, { status: 'failed', error: String(e?.message || e), veo_operation_id: null });
    throw e;
  }
}

/** SEQUENTIAL production — one scene at a time, in story order, so continuity
 * chains naturally and the browser capture queue never starves. */
export async function produceAllScenes(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<string[]> {
  await patchFilm(film, hooks, { status: 'producing', stage_note: 'Generating scenes — one at a time, in story order…', error: null });
  const ordered = [...scenes].sort((a, b) => a.idx - b.idx);
  const failures: string[] = [];
  for (const scene of ordered) {
    // A scene that already exhausted its attempts stays FAILED until the user
    // presses Retry — the run never silently burns more generations on it.
    if (scene.status === 'failed' || scene.status === 'error') {
      failures.push(`Scene ${scene.idx + 1}: ${String(scene.error || 'failed — press Retry on the scene.')}`);
      continue;
    }
    try {
      await produceScene(film, scene, scenes, hooks);
    } catch (e: any) {
      failures.push(`Scene ${scene.idx + 1}: ${String(e?.message || e)}`);
      // Later scenes still render — a broken chain opens fresh.
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Quality control — the seven-point pass; only weak scenes regenerate
// ---------------------------------------------------------------------------

async function runQualityControl(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  const ordered = mainScenes(scenes).filter((s) => s.status === 'ready' && s.clip_url);
  if (!ordered.length) return;
  await patchFilm(film, hooks, { status: 'quality', stage_note: 'Quality check — every scene against its narration…', error: null });
  const lastIdx = ordered[ordered.length - 1].idx;
  for (const scene of ordered) {
    if (scene.inspection?.method === 'opus_qc') continue; // already QC'd this cut
    let frames = [scene.first_frame_url, scene.keyframe_url].filter(Boolean) as string[];
    if (!frames.length && scene.clip_url) {
      try { frames = [await extractFrame(scene.clip_url, 0.4)]; } catch { frames = []; }
    }
    say(hooks, `QC: scene ${scene.idx + 1}…`);
    const verdict = await qualityCheckScene(scene, film.plan!, frames, scene.idx === lastIdx);
    if (verdict.pass) {
      await patchScene(scene, hooks, { inspection: { pass: true, issues: scene.inspection?.issues || '', method: 'opus_qc', attempts: Number(scene.attempts) || 1 } });
      continue;
    }
    say(hooks, `QC: scene ${scene.idx + 1} flagged — ${verdict.issues}. Regenerating…`);
    const spec: any = { ...(scene.spec as any), fix_note: [verdict.issues, verdict.fix_hint].filter(Boolean).join(' — ').slice(0, 400) };
    await patchScene(scene, hooks, {
      spec, status: 'pending', clip_url: null, clip_fingerprint: null,
      veo_operation_id: null, attempts: 0, error: null,
      inspection: { pass: false, issues: verdict.issues, method: 'opus_qc', attempts: Number(scene.attempts) || 1 },
    });
    try {
      await produceScene(film, scene, scenes, hooks);
      await patchScene(scene, hooks, { inspection: { ...(scene.inspection || {}), method: 'opus_qc' } });
    } catch (e: any) {
      say(hooks, `QC: scene ${scene.idx + 1} regeneration failed (${String(e?.message || e).slice(0, 120)}) — keeping it flagged.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Composition stage
// ---------------------------------------------------------------------------

export interface ComposeOptions { captions?: boolean }

function toComposeInputs(film: Film, ready: FilmScene[], captions: boolean): ComposeInput[] {
  return ready.map((s) => ({
    sceneKey: s.scene_key,
    url: String(s.clip_url),
    motionOverlayUrl: s.source === 'veo' ? s.layer_urls?.motion_overlay || null : null,
    motionOpacity: (s.motion as MotionSpec | null)?.opacity ?? 0.25,
    textOverlayUrl: s.layer_urls?.text_overlay || null,
    captionOverlayUrl: captions ? s.layer_urls?.captions || null : null,
    narrationUrl: s.narration_url || null,
    duckNative: s.source === 'veo', // Omni clips carry native sound — duck it under the voice
    durationS: Number(s.duration_s) || null,
    fadeIn: s.transition_in === 'fade',
    fadeOut: s.transition_out === 'fade',
  }));
}

async function ensureMusicAndSfx(film: Film, ready: FilmScene[], hooks: RunHooks): Promise<void> {
  // AUTO MIX gate (default ON). OFF composes with narration only — music/SFX
  // beds are not auto-generated (an already-generated bed is still used).
  if (!autoMixOn(film)) {
    say(hooks, 'Auto Mix is OFF — composing with narration only (no new music or SFX beds).');
    return;
  }
  const total = ready.reduce((acc, s) => acc + (Number(s.duration_s) || 6), 0);
  const musicBrief = film.strategy?.music_brief || film.plan?.music_brief || '';
  if (!film.music_url && musicBrief) {
    try {
      say(hooks, `Composing the music bed (${film.strategy?.music_style || 'modern tech'})…`);
      const track = await generateMusicBed(musicBrief, Math.max(12, Math.round(total)), (n) => say(hooks, n));
      await patchFilm(film, hooks, { music_url: track.url, music_note: track.note });
    } catch (e: any) {
      say(hooks, `The music bed could not be generated (${String(e?.message || e).slice(0, 120)}) — composing without it.`);
      await patchFilm(film, hooks, { music_note: `Music skipped: ${String(e?.message || e).slice(0, 200)}` });
    }
  }
  // A single subtle SFX bed from the storyboard's per-scene briefs (optional).
  if (!film.sfx_url) {
    const briefs = Array.from(new Set(ready.map((s) => String(s.sfx || '').trim()).filter(Boolean))).slice(0, 3);
    if (briefs.length) {
      try {
        say(hooks, 'Adding subtle sound effects…');
        const bed = await generateSfxBed(`Subtle, sparse: ${briefs.join('; ')}`, Math.min(22, Math.max(6, Math.round(total))), (n) => say(hooks, n));
        await patchFilm(film, hooks, { sfx_url: bed.url });
      } catch (e: any) {
        say(hooks, `Sound effects skipped (${String(e?.message || e).slice(0, 100)}).`);
      }
    }
  }
}

export async function composeReadyFilm(film: Film, scenes: FilmScene[], hooks: RunHooks, opts: ComposeOptions = {}): Promise<void> {
  const captions = opts.captions !== false;
  const ordered = mainScenes(scenes);
  const ready = ordered.filter((s) => s.status === 'ready' && s.clip_url);
  if (!ready.length) throw new Error('No finished scenes to compose yet.');
  await patchFilm(film, hooks, { status: 'composing', stage_note: 'FFmpeg is composing the final ad…', error: null });

  // Captions for any scene that predates them (or was toggled on later).
  if (captions) {
    for (const s of ready) {
      if (!s.layer_urls?.captions && s.narration) {
        const url = await recordCaptions(film, s, hooks);
        if (url) await patchScene(s, hooks, { layer_urls: { ...(s.layer_urls || {}), captions: url } });
      }
    }
  }
  // Exact-text overlays for AI-video scenes that predate them — exact text
  // never ships dependent on the generative model.
  for (const s of ready) {
    if (s.source === 'veo' && String(s.on_screen_text || '').trim() && !s.layer_urls?.text_overlay) {
      const url = await recordTextOverlay(film, s, hooks);
      if (url) await patchScene(s, hooks, { layer_urls: { ...(s.layer_urls || {}), text_overlay: url } });
    }
  }

  await ensureMusicAndSfx(film, ready, hooks);

  try {
    let result = await composeFilm(
      toComposeInputs(film, ready, captions),
      (film.aspect_ratio || '16:9') as Aspect,
      { musicUrl: film.music_url, sfxUrl: film.sfx_url, onProgress: (note) => say(hooks, note) },
    );

    // FINAL-VIDEO QA — the composed MP4 itself is inspected (frame extraction
    // + OCR + vision + blank-frame sweep + audio) before anything is called
    // ready. This catches assets that were valid on their own but disappeared
    // in FFmpeg composition (alpha/colorkey/z-order/timing faults). One
    // automatic re-compose when the failure is composition-level.
    const expectNarration = ready.some((s) => !!s.narration_url);
    await patchFilm(film, hooks, { stage_note: 'Final video QA — inspecting the actual rendered MP4…' });
    let finalQa = await runFinalVideoQa({ finalUrl: result.url, scenes: ready, expectNarration, onNote: (n) => say(hooks, n) });
    if (!finalQa.pass && result.via === 'ffmpeg_wasm'
      && finalQa.failures.some((f) => f.requirement === 'composite' || f.requirement === 'audio' || f.requirement === 'integrity')) {
      say(hooks, 'Final QA failed on the composite — composing the ad again…');
      result = await composeFilm(
        toComposeInputs(film, ready, captions),
        (film.aspect_ratio || '16:9') as Aspect,
        { musicUrl: film.music_url, sfxUrl: film.sfx_url, onProgress: (note) => say(hooks, note) },
      );
      finalQa = await runFinalVideoQa({ finalUrl: result.url, scenes: ready, expectNarration, onNote: (n) => say(hooks, n) });
    }
    if (result.via === 'platform_stitch') {
      finalQa = { ...finalQa, pass: false, notes: [...finalQa.notes, 'Composed with the platform joiner fallback — narration, captions, overlays and music were skipped, so this cut is not the complete ad.'] };
    }

    // Push composite failures back onto their scenes so the storyboard shows
    // exactly which scene lost what.
    for (const f of finalQa.failures) {
      if (f.sceneIdx == null) continue;
      const s = ready.find((sc) => sc.idx === f.sceneIdx);
      if (s) await patchScene(s, hooks, { inspection: { pass: false, issues: String(f.cause).slice(0, 300), method: 'final_video_qa', attempts: Number(s.attempts) || 1 } });
    }

    let durationS = 0; let thumb = '';
    try { durationS = await probeClipDuration(result.url); } catch { /* cosmetic */ }
    try { thumb = await extractFrame(result.url, 0.3); } catch { /* cosmetic */ }
    const flagged = ready.filter((s) => s.inspection && s.inspection.pass === false).length;
    if (finalQa.pass) {
      await patchFilm(film, hooks, {
        status: 'ready',
        final_qa: finalQa,
        stage_note: [
          result.via === 'ffmpeg_wasm' ? 'Composed in your browser with FFmpeg — voice, captions and music included.' : 'Composed with the platform joiner.',
          'Final video QA passed — required text, visuals, composition and timing verified on the rendered MP4.',
          result.note || '',
          flagged ? `${flagged} scene(s) stayed flagged after QC — review and regenerate them if you agree.` : '',
        ].filter(Boolean).join(' '),
        final_video_url: result.url,
        final_thumb_url: thumb || null,
        duration_s: durationS || null,
        error: null,
      });
    } else {
      // NEVER FALSE-PASS: the composed file stays watchable below, but the ad
      // is not READY until the rendered output actually matches the plan.
      const summary = finalQa.failures.slice(0, 3)
        .map((f) => `${f.sceneIdx != null ? `Scene ${f.sceneIdx + 1}: ` : ''}expected ${f.expected} — detected: ${f.detected}`)
        .join(' · ') || finalQa.notes.join(' ');
      await patchFilm(film, hooks, {
        status: 'producing',
        final_qa: finalQa,
        stage_note: 'Final video QA FAILED — the composed cut is below with the full report. Retake the flagged scenes (or re-compose) and QA runs again.',
        final_video_url: result.url,
        final_thumb_url: thumb || null,
        duration_s: durationS || null,
        error: `Final video QA: ${summary}`.slice(0, 800),
      });
    }
  } catch (e: any) {
    await patchFilm(film, hooks, { status: 'producing', stage_note: 'Composition failed — fix the note below and try again.', error: String(e?.message || e) });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// The full run + regenerate + edit + resume
// ---------------------------------------------------------------------------

export async function runFilm(film: Film, hooks: RunHooks): Promise<void> {
  try {
    await runUnderstanding(film, hooks);
    // LEGACY films (a storyboard from before the voice-first rebuild, no ad
    // script) finish with their original plan — no re-strategising, no
    // re-scripting, no scene re-renders.
    const existing = mainScenes(await db.listScenes(film.id));
    let scenes: FilmScene[];
    if (film.plan && existing.length && !film.ad_script) {
      say(hooks, 'This ad predates the voice-first pipeline — finishing it with its original storyboard.');
      scenes = existing;
    } else {
      await runStrategy(film, hooks);
      await runScript(film, hooks);
      await runVoicing(film, hooks);
      scenes = await runStoryboarding(film, hooks);
    }
    // AUTO GENERATE gate (default ON). When the user turned it OFF, a fresh
    // storyboard pauses here — production starts only from the explicit
    // "Generate scenes" button. A run already in progress always resumes.
    if (!autoGenerateOn(film) && mainScenes(scenes).every((s) => s.status === 'pending')) {
      await patchFilm(film, hooks, {
        status: 'producing',
        stage_note: 'Auto-generate is OFF — the storyboard is ready and paused. Press “Generate scenes” to start production.',
        error: null,
      });
      return;
    }
    await finishProduction(film, scenes, hooks);
  } catch (e: any) {
    const message = String(e?.message || e);
    if (['understanding', 'strategizing', 'scripting', 'voicing', 'storyboarding', 'draft'].includes(String(film.status))) {
      await patchFilm(film, hooks, { status: 'error', error: message, stage_note: 'The run stopped — see the error below.' });
    }
    throw e;
  }
}

/** Produce every remaining scene, run quality control, then compose — the
 * shared back half of a run. Also the explicit “Generate scenes” entry point
 * when Auto Generate is OFF. */
export async function finishProduction(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  const failures = await produceAllScenes(film, scenes, hooks);
  if (failures.length) {
    await patchFilm(film, hooks, {
      status: 'producing',
      stage_note: `${failures.length} scene(s) need attention — regenerate them, then compose.`,
      error: failures.join(' · ').slice(0, 800),
    });
    return;
  }
  await runQualityControl(film, scenes, hooks);
  await composeReadyFilm(film, scenes, hooks, { captions: true });
}

/** Regenerate exactly ONE scene — the rest of the ad is untouched. An
 * optional director note is folded into the next take's prompt. */
export async function regenerateScene(film: Film, scene: FilmScene, allScenes: FilmScene[], hooks: RunHooks, note?: string): Promise<void> {
  const spec: any = { ...(scene.spec as any) };
  if (note && note.trim()) spec.fix_note = note.trim().slice(0, 400);
  else delete spec.fix_note;
  await patchScene(scene, hooks, {
    spec,
    status: 'pending',
    clip_url: null,
    clip_fingerprint: null,
    veo_operation_id: null,
    inspection: null,
    qa_report: null,
    attempts: 0,
    error: null,
    layer_urls: scene.source === 'asset' && note ? {} : scene.layer_urls, // a noted asset retake regenerates the image too
  });
  await produceScene(film, scene, allScenes, hooks);
  if (film.final_video_url) {
    await patchFilm(film, hooks, { status: 'producing', stage_note: 'A scene changed — compose again to update the final ad.' });
  }
}

/** Save a user-edited visual prompt and regenerate ONLY that scene with it.
 * For AI-video scenes the edited prompt becomes the concrete visual concept
 * the production prompt is written from; for captured scenes (graphics,
 * mockups) Opus rewrites the structured spec so the edit actually changes the
 * render; for asset scenes it becomes the image brief. */
export async function updateScenePrompt(film: Film, scene: FilmScene, allScenes: FilmScene[], hooks: RunHooks, prompt: string): Promise<void> {
  const text = prompt.trim().slice(0, 900);
  if (!text) throw new Error('The prompt cannot be empty.');
  const spec: any = { ...(scene.spec as any) };
  delete spec.fix_note;
  let patch: Partial<FilmScene>;
  if (scene.source === 'veo') {
    // The user's exact words become the generation prompt — stored as a
    // persistent override that Opus never silently replaces.
    spec.visual_concept = text;
    patch = { spec, visual_prompt: text, user_prompt_override: text };
  } else if (scene.source === 'asset') {
    spec.asset_prompt = text;
    delete spec.asset_url;
    patch = { spec, visual_prompt: text, user_prompt_override: text, layer_urls: {} };
  } else {
    say(hooks, `Scene ${scene.idx + 1}: redesigning from your edited prompt…`);
    const shots = [...(film.screenshots || [])];
    if (film.brief?.site_screenshot_url) shots.push(film.brief.site_screenshot_url);
    const redesigned = await rewriteSpecForVisualType({
      scene, plan: film.plan!, brief: film.brief,
      newType: (scene.visual_type || 'MOTION_GRAPHIC') as VisualType,
      screenshots: shots,
      promptOverride: text,
    });
    // Captured scenes render from a structured spec, so Opus implements the
    // user's brief — the override is still stored to mark user intent and
    // protect the edit from being silently re-planned away.
    patch = { spec: redesigned.spec, motion: redesigned.motion, visual_prompt: text, user_prompt_override: text, on_screen_text: redesigned.on_screen_text };
  }
  const nextSpec: any = patch.spec ?? spec;
  await patchScene(scene, hooks, {
    ...patch,
    required_content: buildRequiredContent({ source: scene.source, visual_type: scene.visual_type, spec: nextSpec, on_screen_text: (patch.on_screen_text ?? scene.on_screen_text) || '', purpose: scene.purpose, visual_prompt: text }),
    status: 'pending',
    clip_url: null,
    clip_fingerprint: null,
    veo_operation_id: null,
    inspection: null,
    qa_report: null,
    attempts: 0,
    error: null,
  });
  await produceScene(film, scene, allScenes, hooks);
  if (film.final_video_url) {
    await patchFilm(film, hooks, { status: 'producing', stage_note: 'A scene changed — compose again to update the final ad.' });
  }
}

/** Remove a scene's manual prompt override and regenerate from the Opus
 * prompt again — the explicit “Reset to AI prompt” action. */
export async function clearScenePromptOverride(film: Film, scene: FilmScene, allScenes: FilmScene[], hooks: RunHooks): Promise<void> {
  if (!scene.user_prompt_override) return;
  const spec: any = { ...(scene.spec as any) };
  delete spec.fix_note;
  say(hooks, `Scene ${scene.idx + 1}: override cleared — regenerating from the director's prompt…`);
  await patchScene(scene, hooks, {
    spec,
    user_prompt_override: null,
    status: 'pending',
    clip_url: null,
    clip_fingerprint: null,
    veo_operation_id: null,
    inspection: null,
    qa_report: null,
    attempts: 0,
    error: null,
  });
  await produceScene(film, scene, allScenes, hooks);
  if (film.final_video_url) {
    await patchFilm(film, hooks, { status: 'producing', stage_note: 'A scene changed — compose again to update the final ad.' });
  }
}

/** Edit a scene's narration: re-speak, re-time, re-render — that scene only. */
export async function updateSceneNarration(film: Film, scene: FilmScene, allScenes: FilmScene[], hooks: RunHooks, narration: string): Promise<void> {
  const text = narration.trim().slice(0, 300);
  if (!text) throw new Error('The narration line cannot be empty.');
  await patchScene(scene, hooks, {
    narration: text,
    narration_url: null,
    narration_s: null,
    status: 'pending',
    clip_url: null,
    clip_fingerprint: null,
    veo_operation_id: null,
    inspection: null,
    qa_report: null,
    attempts: 0,
    error: null,
    layer_urls: { ...(scene.layer_urls || {}), captions: undefined } as any,
  });
  // Keep the stored script in step so a future re-run speaks the same words.
  if (film.ad_script?.scenes?.[scene.idx]) {
    const script: any = { ...film.ad_script };
    script.scenes = script.scenes.map((s: any, i: number) => (i === scene.idx ? { ...s, narration: text, narration_url: null, narration_s: null } : s));
    await patchFilm(film, hooks, { ad_script: script });
  }
  await produceScene(film, scene, allScenes, hooks);
  if (film.final_video_url) {
    await patchFilm(film, hooks, { status: 'producing', stage_note: 'The narration changed — compose again to update the final ad.' });
  }
}

/** Swap a scene's VISUAL TYPE: Opus rewrites the spec for the new engine and
 * the scene regenerates — narration and timing stay untouched. */
export async function swapSceneVisualType(film: Film, scene: FilmScene, allScenes: FilmScene[], hooks: RunHooks, newType: VisualType): Promise<void> {
  say(hooks, `Scene ${scene.idx + 1}: redesigning as ${newType}…`);
  const shots = [...(film.screenshots || [])];
  if (film.brief?.site_screenshot_url) shots.push(film.brief.site_screenshot_url);
  const redesigned = await rewriteSpecForVisualType({ scene, plan: film.plan!, brief: film.brief, newType, screenshots: shots });
  const source = visualTypeToSource(newType);
  await patchScene(scene, hooks, {
    visual_type: newType,
    source,
    spec: redesigned.spec,
    motion: redesigned.motion,
    // A type change is an explicit redesign request — the old medium's manual
    // prompt no longer applies, so the override is cleared with the swap.
    user_prompt_override: null,
    visual_prompt: redesigned.visual_prompt,
    on_screen_text: redesigned.on_screen_text,
    required_content: buildRequiredContent({ source, visual_type: newType, spec: redesigned.spec, on_screen_text: redesigned.on_screen_text, purpose: scene.purpose, visual_prompt: redesigned.visual_prompt }),
    duration_s: derivedDuration(source, Number(scene.narration_s) || 4),
    status: 'pending',
    clip_url: null,
    clip_fingerprint: null,
    veo_operation_id: null,
    inspection: null,
    qa_report: null,
    attempts: 0,
    error: null,
    layer_urls: {},
  });
  await produceScene(film, scene, allScenes, hooks);
  if (film.final_video_url) {
    await patchFilm(film, hooks, { status: 'producing', stage_note: 'A scene changed — compose again to update the final ad.' });
  }
}

// ---------------------------------------------------------------------------
// Creative style override — re-plan the storyboard, reuse what still fits
// ---------------------------------------------------------------------------

/** The user changed Story-Driven ↔ Product-Focused AFTER planning. The whole
 * ad is NOT blindly regenerated: the storyboard is re-planned for the new
 * style, and every scene whose narration + visual type survive the re-plan
 * keeps its rendered clip, voice, layers and QA — only scenes whose visual
 * treatment actually changed are regenerated (keeps generation costs low). */
export async function replanForStyle(film: Film, hooks: RunHooks, newStyle: VideoStyle): Promise<void> {
  if (!film.ad_script?.scenes?.length || !film.brief || !film.strategy) {
    // Nothing planned yet — just persist the choice; the normal run uses it.
    await patchFilm(film, hooks, { video_style: newStyle });
    return;
  }
  const old = mainScenes(await db.listScenes(film.id));
  await patchFilm(film, hooks, {
    video_style: newStyle,
    status: 'storyboarding',
    stage_note: `Creative direction changed to ${newStyle === 'story_driven' ? 'Story-Driven' : 'Product-Focused'} — re-planning the visual storyboard…`,
    error: null,
  });
  const assets = await db.listAssets(film.id);
  const script = film.ad_script!;
  const voiced = script.scenes.map((s: any, i: number) => ({
    idx: i, beat: s.beat, narration: s.narration, narration_s: Number(s.narration_s) || 3,
    product_action: s.product_action, on_screen_text: s.on_screen_text, visual_hint: s.visual_hint,
  }));
  const shots = [...(film.screenshots || [])];
  if (film.brief?.site_screenshot_url) shots.push(film.brief.site_screenshot_url);
  const plan = await buildVisualStoryboard({
    brief: film.brief!,
    strategy: film.strategy!,
    script: voiced,
    goal: film.goal,
    aspect: (film.aspect_ratio || '16:9') as Aspect,
    screenshots: shots,
    assets,
    videoStyle: newStyle,
    reusableScenes: old
      .filter((s) => s.status === 'ready' && s.clip_url)
      .map((s) => ({ narration: s.narration || '', visual_type: String(s.visual_type || s.source) })),
  });

  // Sync scene rows: REUSE rendered scenes whose narration + visual type are
  // unchanged; insert the redesigned ones; drop what the new plan replaced.
  const leftover = new Map(old.map((s) => [s.id, s]));
  let reused = 0;
  for (const p of plan.scenes) {
    const scripted: any = script.scenes[Math.min(p.idx, script.scenes.length - 1)] || {};
    const match = old.find((s) => leftover.has(s.id)
      && String(s.narration || '').trim() === String(p.narration || '').trim()
      && String(s.visual_type || '') === String(p.visual_type || '')
      && s.status === 'ready' && !!s.clip_url);
    if (match) {
      leftover.delete(match.id);
      reused += 1;
      await patchScene(match, hooks, { idx: p.idx, beat_title: p.beat_title, transition_in: p.transition_in || 'cut', transition_out: p.transition_out || 'cut' });
      continue;
    }
    await db.insertScene({
      film_id: film.id,
      idx: p.idx,
      scene_key: p.scene_key,
      source: p.source,
      beat_title: p.beat_title,
      purpose: p.purpose,
      rationale: p.rationale || null,
      spec: p.spec,
      motion: p.motion || { kind: 'none' },
      transition_in: p.transition_in || 'cut',
      transition_out: p.transition_out || 'cut',
      status: 'pending',
      attempts: 0,
      duration_s: p.duration_s,
      continuity_group: p.continuity_group,
      narration: p.narration || scripted.narration || '',
      narration_url: scripted.narration_url || null,
      narration_s: Number(scripted.narration_s) || null,
      visual_type: p.visual_type || null,
      visual_prompt: p.visual_prompt || null,
      on_screen_text: p.on_screen_text || null,
      product_action: p.product_action || null,
      music_mood: p.music_mood || null,
      sfx: p.sfx || null,
      reference_assets: null,
      required_content: p.required_content || null,
      qa_report: null,
    });
  }
  for (const s of leftover.values()) { try { await db.deleteScene(s.id); } catch { /* replaced by the new plan */ } }

  await patchFilm(film, hooks, {
    title: plan.title,
    plan,
    final_video_url: null,
    final_thumb_url: null,
    final_qa: null,
    stage_note: `Storyboard re-planned for the new creative direction — ${plan.scenes.length} scenes, ${reused} finished clip(s) reused, only the changed scenes regenerate.`,
  });
  const scenes = mainScenes(await db.listScenes(film.id));
  try { hooks.onScenesReplaced?.(scenes); } catch { /* UI only */ }
  say(hooks, `Re-plan complete: ${reused} scene(s) reused as-is, ${scenes.length - reused} to generate.`);

  const failures = await produceAllScenes(film, scenes, hooks);
  if (failures.length) {
    await patchFilm(film, hooks, {
      status: 'producing',
      stage_note: `${failures.length} scene(s) need attention — regenerate them, then compose.`,
      error: failures.join(' · ').slice(0, 800),
    });
    return;
  }
  await runQualityControl(film, scenes, hooks);
  await composeReadyFilm(film, scenes, hooks, { captions: true });
}

// ---------------------------------------------------------------------------
// Ad variations — after the main ad; reuse existing assets wherever possible
// ---------------------------------------------------------------------------

export async function planVariations(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<AdVariation[]> {
  const ready = mainScenes(scenes).filter((s) => s.status === 'ready' && s.clip_url);
  if (ready.length < 3) throw new Error('Finish the main ad first — variations reuse its scenes.');
  say(hooks, 'Designing ad variations from the finished scenes…');
  const recipes = await writeVariationRecipes({ brief: film.brief!, strategy: film.strategy!, plan: film.plan!, scenes: ready });
  if (!recipes.length) throw new Error('No workable variations came back — try again.');
  const variations: AdVariation[] = recipes.map((r, i) => ({
    id: `var_${Date.now().toString(36)}_${i}`,
    name: r.name,
    kind: r.kind,
    note: r.note,
    scene_keys: r.scene_keys,
    status: 'planned',
    video_url: null,
    duration_s: null,
  }));
  // The alt-hook recipe carries its new opening line — stash it on the variation.
  recipes.forEach((r, i) => { if (r.alt_hook) (variations[i] as any).alt_hook = r.alt_hook; });
  await patchFilm(film, hooks, { variations });
  return variations;
}

async function setVariation(film: Film, hooks: RunHooks, id: string, patch: Partial<AdVariation>): Promise<void> {
  const variations = (film.variations || []).map((v) => (v.id === id ? { ...v, ...patch } : v));
  await patchFilm(film, hooks, { variations });
}

export async function buildVariation(film: Film, scenes: FilmScene[], hooks: RunHooks, variationId: string): Promise<void> {
  const variation: any = (film.variations || []).find((v) => v.id === variationId);
  if (!variation) throw new Error('This variation no longer exists.');
  await setVariation(film, hooks, variationId, { status: 'building', error: null });
  try {
    const byKey = new Map(scenes.map((s) => [s.scene_key, s]));
    const cut: FilmScene[] = [];

    // An alt hook introduces ONE new scene — everything else is reused.
    if (variation.kind === 'alt_hook' && variation.alt_hook) {
      let hook = scenes.find((s) => s.scene_key === variation.hook_scene_key) || null;
      if (!hook || !hook.clip_url) {
        say(hooks, `Variation “${variation.name}”: producing the new hook scene…`);
        const vt = variation.alt_hook.visual_type as VisualType;
        const source = visualTypeToSource(vt);
        const usedIdx = scenes.filter((s) => s.idx >= VARIATION_IDX_BASE).map((s) => Number(s.idx));
        const idx = usedIdx.length ? Math.max(...usedIdx) + 1 : VARIATION_IDX_BASE;
        await db.insertScene({
          film_id: film.id,
          idx,
          scene_key: newSceneKey(),
          source,
          beat_title: `Alt hook — ${variation.alt_hook.hook_type}`,
          purpose: `Alternative ${variation.alt_hook.hook_type} hook for the “${variation.name}” variation.`,
          spec: {},
          motion: { kind: 'none' },
          transition_in: 'cut',
          transition_out: 'cut',
          status: 'pending',
          attempts: 0,
          narration: variation.alt_hook.narration,
          visual_type: vt,
          visual_prompt: variation.alt_hook.visual_prompt || null,
          on_screen_text: variation.alt_hook.on_screen_text || null,
          duration_s: 5,
        });
        const fresh = await db.listScenes(film.id);
        hook = fresh.find((s) => Number(s.idx) === idx) || null;
        if (!hook) throw new Error('The new hook scene could not be created.');
        scenes.push(hook);
        // Opus fills the spec for the chosen visual type, then the scene renders.
        const redesigned = await rewriteSpecForVisualType({
          scene: hook, plan: film.plan!, brief: film.brief, newType: vt,
          screenshots: [...(film.screenshots || []), ...(film.brief?.site_screenshot_url ? [film.brief.site_screenshot_url] : [])],
        });
        await patchScene(hook, hooks, { spec: redesigned.spec, motion: redesigned.motion, visual_prompt: redesigned.visual_prompt, on_screen_text: redesigned.on_screen_text, required_content: buildRequiredContent({ source, visual_type: vt, spec: redesigned.spec, on_screen_text: redesigned.on_screen_text, purpose: hook.purpose, visual_prompt: redesigned.visual_prompt }) });
        await produceScene(film, hook, scenes, hooks);
        await setVariation(film, hooks, variationId, { ...( { hook_scene_key: hook.scene_key } as any) });
        variation.hook_scene_key = hook.scene_key;
      }
      if (hook?.status === 'ready' && hook.clip_url) cut.push(hook);
    }

    for (const key of variation.scene_keys) {
      const s = byKey.get(key);
      if (s && s.status === 'ready' && s.clip_url) cut.push(s);
    }
    if (cut.length < 2) throw new Error('Too few reusable scenes for this variation.');

    say(hooks, `Variation “${variation.name}”: composing from ${cut.length} scenes…`);
    const result = await composeFilm(
      toComposeInputs(film, cut, true),
      (film.aspect_ratio || '16:9') as Aspect,
      { musicUrl: film.music_url, sfxUrl: film.sfx_url, onProgress: (note) => say(hooks, note) },
    );
    let durationS = 0;
    try { durationS = await probeClipDuration(result.url); } catch { /* cosmetic */ }
    await setVariation(film, hooks, variationId, { status: 'ready', video_url: result.url, duration_s: durationS || null, error: null });
  } catch (e: any) {
    await setVariation(film, hooks, variationId, { status: 'error', error: String(e?.message || e).slice(0, 300) });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Resume after a reload + READY-scene audit
// ---------------------------------------------------------------------------

/** PRIORITY-ONE STATE REPAIR: a scene marked READY whose rendered file is
 * missing, corrupt or blank is demoted to RETRYING ("Invalid video detected —
 * attempt 1/3") so the pipeline regenerates it. READY must always mean a
 * real, validated video. Scenes whose stored QA report already proved a
 * passing integrity check are trusted (no re-download on every open). */
export async function auditReadyScenes(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<number> {
  let demoted = 0;
  for (const scene of mainScenes(scenes)) {
    if (scene.status !== 'ready') continue;
    let reason: string | null = null;
    if (!scene.clip_url) {
      reason = 'No rendered file exists for this scene.';
    } else if (scene.qa_report?.integrity?.ok === true && scene.qa_report?.pass !== false) {
      continue; // validated by the pipeline at generation time
    } else {
      const integrity = await validateClipIntegrity(scene.clip_url);
      if (!integrity.ok) {
        reason = integrity.reason || 'The rendered file is blank or corrupt.';
      } else {
        // The file is actually fine — heal the record so the next open skips
        // the re-download (and clear stale integrity-only failures).
        const prior = scene.qa_report;
        const nonIntegrity = (prior?.failures || []).filter((f) => f.requirement !== 'integrity');
        await patchScene(scene, hooks, {
          qa_report: {
            pass: nonIntegrity.length === 0,
            method: prior?.method || 'integrity_audit',
            checkedAt: new Date().toISOString(),
            integrity,
            detected_text: prior?.detected_text,
            failures: nonIntegrity,
          },
        });
        continue;
      }
    }
    demoted += 1;
    say(hooks, `Scene ${scene.idx + 1}: invalid video detected (${reason}) — set to RETRYING, attempt 1/${MAX_ATTEMPTS}.`);
    await patchScene(scene, hooks, {
      status: 'retrying',
      error: `Invalid video detected — ${reason} Attempt 1/${MAX_ATTEMPTS}.`,
      clip_url: null,
      clip_fingerprint: null,
      veo_operation_id: null,
      qa_report: null,
      inspection: null,
      attempts: 0,
    });
  }
  return demoted;
}

export async function resumeFilm(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  for (const scene of scenes) {
    if (!['generating', 'validating', 'qa_checking'].includes(String(scene.status))) continue;
    if (scene.source === 'veo' && scene.veo_operation_id) {
      try {
        say(hooks, `Scene ${scene.idx + 1}: picking the render back up…`);
        const videoUrl = await VideoModelService.getVideoResult(scene.veo_operation_id);
        const integrity = await validateClipIntegrity(videoUrl);
        if (!integrity.ok) throw new Error(integrity.reason || 'The adopted render is blank or corrupt — retake the scene.');
        let firstFrame = ''; let lastFrame = '';
        try { firstFrame = await extractFrame(videoUrl, 0.15); } catch { /* degrades */ }
        try { lastFrame = await extractFrame(videoUrl, 'end'); } catch { /* degrades */ }
        const snapshot = lastFrame ? await continuitySnapshotFromFrame(lastFrame) : null;
        const verdict = await inspectScene(scene, film.plan!, [firstFrame, lastFrame].filter(Boolean));
        const overlayUrl = await recordMotionOverlay(film, scene, hooks, Number(scene.duration_s) || 6);
        const textOverlayUrl = await recordTextOverlay(film, scene, hooks);
        const captionsUrl = await recordCaptions(film, scene, hooks);
        const qa = await runSceneOutputQa({
          clipUrl: videoUrl, textOverlayUrl, durationS: Number(scene.duration_s) || 6,
          required: scene.required_content, source: 'veo',
          onNote: (n) => say(hooks, `Scene ${scene.idx + 1}: ${n}`),
        });
        // An adopted render that fails hard QA never becomes READY — it goes
        // back through the normal generate → validate → QA loop instead.
        if (!qa.pass && qa.failures.some((f) => f.requirement === 'visual' || f.requirement === 'integrity')) {
          say(hooks, `Scene ${scene.idx + 1}: the adopted render failed QA — regenerating this scene…`);
          await patchScene(scene, hooks, { status: 'retrying', error: 'Invalid video detected on resume — the adopted render failed QA. Retrying.', clip_url: null, clip_fingerprint: null, veo_operation_id: null, qa_report: qa, attempts: 0 });
          continue;
        }
        await patchScene(scene, hooks, {
          status: 'ready', error: null, clip_url: videoUrl, veo_operation_id: null,
          first_frame_url: firstFrame || null, keyframe_url: lastFrame || null, continuity: snapshot,
          qa_report: qa,
          layer_urls: { ...(scene.layer_urls || {}), ...(overlayUrl ? { motion_overlay: overlayUrl } : {}), ...(textOverlayUrl ? { text_overlay: textOverlayUrl } : {}), ...(captionsUrl ? { captions: captionsUrl } : {}) },
          inspection: { pass: verdict.pass && qa.pass, issues: [verdict.issues, ...qa.failures.map((f) => f.cause)].filter(Boolean).join(' · ').slice(0, 400), method: qa.pass ? verdict.method : 'frames_ocr_vision', attempts: Number(scene.attempts) || 1 },
        });
      } catch (e: any) {
        await patchScene(scene, hooks, { status: 'failed', error: String(e?.message || e), veo_operation_id: null });
      }
    } else {
      // A browser capture that died with the tab — safe to redo from scratch.
      await patchScene(scene, hooks, { status: 'pending', error: null });
    }
  }
  const main = mainScenes(scenes);
  const unfinished = main.some((s) => ['pending', 'generating', 'validating', 'qa_checking', 'retrying'].includes(String(s.status)));
  const stage = String(film.status || '');
  if (['understanding', 'strategizing', 'scripting', 'voicing', 'storyboarding', 'draft'].includes(stage) || unfinished || stage === 'producing' || stage === 'quality' || stage === 'composing') {
    await runFilm(film, hooks);
  }
}
