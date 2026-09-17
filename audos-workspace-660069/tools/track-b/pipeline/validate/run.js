// Stage 5 — Validate (PRD §pipeline.5).
// Runs the full HyperFrames gate: `hyperframes lint && hyperframes check &&
// hyperframes validate`, plus keyframe diagnostics (§24 item 4). All output is
// captured to disk so a failed gate is diagnosable without re-running.
//
// In:  <project>/index.html
// Out: <project>/validate/report.json (+ raw tool logs)
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs, writeJson, ensureDir } from '../lib/io.js';
import { beginStage, completeStage, failStage, requireStage } from '../lib/state.js';
import { resolveProjectDir, loadProject, saveProject } from '../lib/project.js';

const args = parseArgs(process.argv.slice(2));
const projectDir = resolveProjectDir(args);

function runTool(cmd, argv, logFile) {
  const res = spawnSync(cmd, argv, { cwd: projectDir, encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  fs.writeFileSync(logFile, output);
  return { ok: res.status === 0, exit_code: res.status, log: path.basename(logFile) };
}

beginStage(projectDir, 'validate');
try {
  requireStage(projectDir, 'validate', ['build']);
  const outDir = ensureDir(path.join(projectDir, 'validate'));
  // HyperFrames project convention: the composition is <project>/index.html and
  // lint/check/validate take the project directory.
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) throw new Error('missing index.html — run the build stage first');

  const report = {
    started_at: new Date().toISOString(),
    lint: runTool('npx', ['-y', 'hyperframes', 'lint', '.'], path.join(outDir, 'lint.log')),
    check: runTool('npx', ['-y', 'hyperframes', 'check', '.'], path.join(outDir, 'check.log')),
    validate: runTool('npx', ['-y', 'hyperframes', 'validate', '.'], path.join(outDir, 'validate.log')),
    keyframes: runTool('npx', ['-y', 'hyperframes', 'keyframes', '.'], path.join(outDir, 'keyframes.log')),
  };
  report.passed = report.lint.ok && report.check.ok && report.validate.ok;
  report.completed_at = new Date().toISOString();
  writeJson(path.join(outDir, 'report.json'), report);

  if (!report.passed) {
    throw new Error(`validation gate failed (lint:${report.lint.ok} check:${report.check.ok} validate:${report.validate.ok}) — see validate/*.log`);
  }

  const project = loadProject(projectDir);
  project.status = 'validated';
  saveProject(projectDir, project);
  completeStage(projectDir, 'validate', { passed: true });
} catch (err) {
  failStage(projectDir, 'validate', err);
  process.exit(1);
}
