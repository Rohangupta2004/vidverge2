// Stage 7 — QA (PRD §pipeline.7).
// A vision model confirms the render matches the plan, scene by scene, and runs
// the product-fidelity check: logo, colours, shape, proportions, UI structure.
// Verdict is BINARY pass/fail — no partial credit. Also screens for §23
// anti-goals visible in the frames.
//
// In:  <project>/renders/<id>.mp4 + plan/plan.json
// Out: <project>/qa/report.json + qa/frames/*.png (contact sheet source)
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs, readJson, writeJson, ensureDir } from '../lib/io.js';
import { beginStage, completeStage, failStage, requireStage } from '../lib/state.js';
import { loadProject, saveProject, resolveProjectDir } from '../lib/project.js';
import { anthropicVision, extractJson } from '../lib/llm.js';

const args = parseArgs(process.argv.slice(2));
const projectDir = resolveProjectDir(args);

beginStage(projectDir, 'qa');
try {
  requireStage(projectDir, 'qa', ['render']);
  const plan = readJson(path.join(projectDir, 'plan', 'plan.json'));
  const project = loadProject(projectDir);
  const render = project.renders.at(-1);
  if (!render) throw new Error('no render record on the project');
  const videoAbs = path.join(projectDir, render.output);

  // Extract one frame at each scene midpoint (deterministic timestamps from the project).
  const framesDir = ensureDir(path.join(projectDir, 'qa', 'frames'));
  let t = 0;
  const framePlan = [];
  for (const scene of project.scenes) {
    const mid = t + scene.duration_s / 2;
    const frameFile = path.join(framesDir, `${scene.id}.png`);
    execFileSync('ffmpeg', ['-y', '-ss', String(mid.toFixed(3)), '-i', videoAbs, '-frames:v', '1', frameFile], { stdio: 'ignore', timeout: 5 * 60 * 1000 });
    framePlan.push({ scene_id: scene.id, at_s: mid, frame: frameFile, intent: scene.intent, headline: scene.headline });
    t += scene.duration_s;
  }

  // Contact sheet (§24 item 10) — all scene frames tiled into one PNG.
  const cols = Math.ceil(Math.sqrt(framePlan.length));
  execFileSync('ffmpeg', ['-y', '-pattern_type', 'glob', '-i', path.join(framesDir, '*.png'), '-filter_complex', `tile=${cols}x${Math.ceil(framePlan.length / cols)}`, path.join(projectDir, 'qa', 'contact-sheet.png')], { stdio: 'ignore', timeout: 5 * 60 * 1000 });

  const SYSTEM = `You are the binary QA gate for a Track B product video. You receive one mid-scene frame per scene, in scene order, plus the plan. Judge STRICTLY and answer with JSON only:
{
  "scenes": [ { "scene_id": string, "matches_plan": boolean, "notes": string } ],
  "product_fidelity": { "logo": boolean, "colours": boolean, "shape_proportions": boolean, "ui_structure": boolean, "notes": string },
  "anti_goals_present": [ strings — any §23 anti-goal you can SEE: generic stock aesthetic, drop shadows everywhere, >3 competing colours, default centred text, bullet-point animation, generic gradients, slide-deck look ],
  "pass": boolean  // true ONLY if every scene matches, product fidelity fully passes, and no anti-goal is present
}`;

  const prompt = `PLAN ROUTE: ${plan.route}\n\nSCENES (in the same order as the images):\n${JSON.stringify(framePlan.map(({ scene_id, intent, headline }) => ({ scene_id, intent, headline })), null, 2)}\n\nBRAND TOKENS (product truth): ${JSON.stringify(project.brand.tokens)}\n\nReturn the QA JSON now.`;
  const raw = await anthropicVision({ system: SYSTEM, prompt, imagePaths: framePlan.map((f) => f.frame) });
  const verdict = extractJson(raw);

  const report = {
    render_id: render.render_id,
    project_version: project.version,
    frames: framePlan.map((f) => ({ scene_id: f.scene_id, at_s: f.at_s, frame: path.relative(projectDir, f.frame) })),
    contact_sheet: 'qa/contact-sheet.png',
    verdict,
    pass: verdict.pass === true,
    completed_at: new Date().toISOString(),
  };
  writeJson(path.join(projectDir, 'qa', 'report.json'), report);

  if (!report.pass) {
    throw new Error(`QA gate FAILED (binary): ${JSON.stringify({ anti_goals: verdict.anti_goals_present, fidelity: verdict.product_fidelity }).slice(0, 500)}`);
  }

  project.status = 'qa_passed';
  saveProject(projectDir, project);
  completeStage(projectDir, 'qa', { pass: true, render_id: render.render_id });
} catch (err) {
  failStage(projectDir, 'qa', err);
  process.exit(1);
}
