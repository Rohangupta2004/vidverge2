// PLAN_DEFECT escalation (PRD §escalation protocol).
// A stage that encounters something the plan does not cover, or cannot execute,
// records the defect on disk, prints the canonical marker, and HALTS. It never
// improvises, guesses, invents assets, or changes creative direction.
import path from 'node:path';
import { writeJson, readJson } from './io.js';

export function planDefect(projectDir, stage, description) {
  const file = path.join(projectDir, 'plan-defects.json');
  const defects = readJson(file, []);
  defects.push({ stage, description, at: new Date().toISOString() });
  writeJson(file, defects);
  // The canonical marker, on its own line, so any orchestrator can grep for it.
  console.error(`PLAN_DEFECT: ${description}`);
  process.exit(3); // distinct exit code: 3 = plan defect (vs 1 = ordinary failure)
}

export function hasOpenDefects(projectDir) {
  return readJson(path.join(projectDir, 'plan-defects.json'), []).length > 0;
}
