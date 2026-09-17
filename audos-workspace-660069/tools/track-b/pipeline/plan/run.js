// Stage 2 — Plan (PRD §pipeline.2).
// Opus 5 reads the intake and produces plan.json: route selection, scene
// breakdown, timing, motion, voice_plan, asset manifest, and the §24 checklist.
// Assets are resolved BEFORE any composition code is written — so the manifest
// produced here is the contract the assets stage fills and the build stage
// consumes. PLANNER-owned fields are written into project.json here and only here.
//
// In:  <project>/intake/intake.json (+ capture output)
// Out: <project>/plan/plan.json, PLANNER fields in project.json
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs, readJson, writeJson, sha256String } from '../lib/io.js';
import { beginStage, completeStage, failStage, requireStage } from '../lib/state.js';
import { loadProject, saveProject, loadRoutes, resolveProjectDir } from '../lib/project.js';
import { anthropicMessage, extractJson, PLAN_MODEL } from '../lib/llm.js';
import { planDefect } from '../lib/defect.js';

const args = parseArgs(process.argv.slice(2));
const projectDir = resolveProjectDir(args);

const SYSTEM = `You are the PLANNER for Track B product videos (HyperFrames module). You produce a complete, executable plan as ONE JSON object and nothing else.

Anti-goals you must never plan (§23): generic stock-video aesthetic; arbitrary left-to-right text slides; drop shadows everywhere; more than three competing colours; default centred text; bullet-point animation; uniform 5-second scenes; music that ignores cuts; generic gradients; a slide deck with transitions.

Motion principles: vary ease families and speeds between scenes (slowest scene ~3x slower than fastest); every scene has build/breathe/resolve phases; stagger by importance; entrances longer than exits; text is ALWAYS a coded overlay, never baked into imagery.

Return JSON with exactly these keys:
{
  "route": one of ["product_launch","feature_update","product_tour","comparison","announcement"],
  "route_reason": string,
  "total_duration_s": number (must fit the route envelope),
  "scenes": [ { "id": "scene-01", "intent": string, "headline": string, "caption": string|null,
                "duration_s": number, "timing_range": {"min_s":number,"max_s":number},
                "motion": string (ease families, directions, ambient treatment, build/breathe/resolve),
                "asset_refs": [asset ids from your manifest] } ],
  "voice_plan": { "tone":string, "pace":string, "energy":string, "accent":string, "gender":string,
                  "age_range":string, "emotional_arc":string,
                  "lines": [ {"scene_id":string, "text":string} ] } | null (null = intentionally no voiceover),
  "brand": { "tokens": {"primary":css,"accent":css,"surface":css,"text":css}, "source": "captured product truth" },
  "music": { "brief": string, "sync_note": "how cuts land on the music" } | null,
  "asset_manifest": [ { "id": string, "kind": "icon"|"background"|"texture"|"logo"|"screenshot"|"audio",
                        "description": string, "resolution_hint": "catalog"|"stock_icon"|"generate"|"scrape",
                        "icon_name": string|null, "prompt": string|null } ],
  "checklist": [ §24 Definition-of-Done items, instantiated concretely for THIS film ]
}`;

beginStage(projectDir, 'plan');
try {
  requireStage(projectDir, 'plan', ['intake']);
  const intake = readJson(path.join(projectDir, 'intake', 'intake.json'));
  const routes = loadRoutes();

  // Give the planner the captured product truth, not raw binaries.
  let captureSummary = 'No structured capture summary available.';
  const captureResult = path.join(projectDir, 'intake', 'capture-result.json');
  if (fs.existsSync(captureResult)) {
    captureSummary = fs.readFileSync(captureResult, 'utf8').slice(0, 60000);
  } else if (fs.existsSync(path.join(projectDir, 'intake', 'apify-result.json'))) {
    captureSummary = fs.readFileSync(path.join(projectDir, 'intake', 'apify-result.json'), 'utf8').slice(0, 60000);
  } else {
    captureSummary = `Direct upload; files: ${intake.files.join(', ')}`;
  }

  const brief = args.brief ?? 'No extra brief provided — plan from the captured product truth.';
  const text = await anthropicMessage({
    model: PLAN_MODEL,
    system: SYSTEM,
    maxTokens: 20000,
    temperature: 0.7,
    messages: [{
      role: 'user',
      content: `ROUTE CATALOG (timing envelopes are hard constraints):\n${JSON.stringify(routes.routes, null, 2)}\n\nINTAKE (${intake.kind}${intake.url ? `, ${intake.url}` : ''}):\n${captureSummary}\n\nFOUNDER BRIEF:\n${brief}\n\nProduce the plan JSON now.`,
    }],
  });

  const plan = extractJson(text);

  // Validate the plan against hard constraints before accepting it.
  const route = routes.routes[plan.route];
  if (!route) planDefect(projectDir, 'plan', `planner selected unknown route '${plan.route}'`);
  if (plan.total_duration_s < route.duration_s.min || plan.total_duration_s > route.duration_s.max) {
    planDefect(projectDir, 'plan', `plan duration ${plan.total_duration_s}s is outside the ${plan.route} envelope ${route.duration_s.min}–${route.duration_s.max}s`);
  }
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) planDefect(projectDir, 'plan', 'plan has no scenes');
  const durations = plan.scenes.map((s) => s.duration_s);
  if (new Set(durations).size === 1 && plan.scenes.length > 2) {
    planDefect(projectDir, 'plan', `uniform ${durations[0]}s scenes violate §23 (uniform 5-second scenes anti-goal)`);
  }
  const manifestIds = new Set((plan.asset_manifest ?? []).map((a) => a.id));
  for (const scene of plan.scenes) {
    for (const ref of scene.asset_refs ?? []) {
      if (!manifestIds.has(ref)) planDefect(projectDir, 'plan', `scene ${scene.id} references asset '${ref}' missing from asset_manifest`);
    }
  }

  writeJson(path.join(projectDir, 'plan', 'plan.json'), plan);

  // Write PLANNER-owned fields into the single source of truth.
  const project = loadProject(projectDir);
  project.route = plan.route;
  project.brand.tokens = plan.brand?.tokens ?? project.brand.tokens;
  project.voice.plan = plan.voice_plan;
  project.checklist = plan.checklist;
  project.scenes = plan.scenes.map((s, i) => ({
    id: s.id ?? `scene-${String(i + 1).padStart(2, '0')}`,
    state: 'EDITABLE', // Track B scenes default to EDITABLE (PRD §scene states)
    version: 1,
    intent: s.intent,
    motion: s.motion,
    timing_range: s.timing_range,
    duration_s: s.duration_s,
    headline: s.headline,
    caption: s.caption ?? null,
    asset_refs: s.asset_refs ?? [],
    composition_file: null,
    implementation_notes: null,
  }));
  project.status = 'planned';
  project.hashes.plan = sha256String(JSON.stringify(plan));
  saveProject(projectDir, project);

  completeStage(projectDir, 'plan', { route: plan.route, scenes: plan.scenes.length, assets: plan.asset_manifest?.length ?? 0 });
} catch (err) {
  failStage(projectDir, 'plan', err);
  process.exit(1);
}
