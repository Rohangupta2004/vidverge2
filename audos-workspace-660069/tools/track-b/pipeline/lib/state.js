// Per-project pipeline state on disk (PRD: every stage is files-in → files-out,
// independently retryable, with state maintained on disk so any orchestrator —
// or a human at a shell — can resume from the exact failed stage).
import path from 'node:path';
import { readJson, writeJson } from './io.js';

export const STAGES = ['intake', 'plan', 'assets', 'build', 'validate', 'render', 'qa', 'deliver'];

const STATE_FILE = 'pipeline-state.json';

export function loadState(projectDir) {
  return readJson(path.join(projectDir, STATE_FILE), {
    stages: Object.fromEntries(STAGES.map((s) => [s, { status: 'pending', attempts: 0 }])),
  });
}

export function saveState(projectDir, state) {
  writeJson(path.join(projectDir, STATE_FILE), state);
}

export function beginStage(projectDir, stage) {
  const state = loadState(projectDir);
  const s = state.stages[stage];
  s.status = 'running';
  s.attempts += 1;
  s.started_at = new Date().toISOString();
  delete s.error;
  saveState(projectDir, state);
  return state;
}

export function completeStage(projectDir, stage, outputs = {}) {
  const state = loadState(projectDir);
  const s = state.stages[stage];
  s.status = 'complete';
  s.completed_at = new Date().toISOString();
  s.outputs = outputs;
  saveState(projectDir, state);
  console.log(`[track-b] stage ${stage}: complete`);
  return state;
}

export function failStage(projectDir, stage, error) {
  const state = loadState(projectDir);
  const s = state.stages[stage];
  s.status = 'failed';
  s.failed_at = new Date().toISOString();
  s.error = String(error?.message ?? error);
  saveState(projectDir, state);
  console.error(`[track-b] stage ${stage}: FAILED — ${s.error}`);
  return state;
}

export function requireStage(projectDir, stage, dependsOn) {
  // A stage may only run when its upstream stage has completed. Re-running a
  // completed stage is always allowed (idempotent retry).
  const state = loadState(projectDir);
  for (const dep of dependsOn) {
    if (state.stages[dep]?.status !== 'complete') {
      throw new Error(`stage '${stage}' requires stage '${dep}' to be complete first (current: ${state.stages[dep]?.status ?? 'unknown'}). Run pipeline/${dep}/run.js.`);
    }
  }
  return state;
}
