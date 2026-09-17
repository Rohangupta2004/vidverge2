// Convenience sequential driver. Each stage remains an independent,
// individually retryable CLI — an orchestrator may ignore this file entirely
// and invoke pipeline/<stage>/run.js directly (the module is
// orchestrator-agnostic and does not know an orchestrator exists).
//
// usage: node pipeline/run.js --project <dir> [--from <stage>] [--to <stage>]
//        [--url <url> | --upload <dir> | --apify <file>] [--brief <text>]
//        [--docker] [--verify-determinism]
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from './lib/io.js';
import { STAGES, loadState } from './lib/state.js';

const args = parseArgs(process.argv.slice(2), { docker: 'boolean', 'verify-determinism': 'boolean' });
if (!args.project) {
  console.error('usage: node pipeline/run.js --project <dir> [--from <stage>] [--to <stage>] [stage-specific flags]');
  process.exit(2);
}

const from = args.from ?? 'intake';
const to = args.to ?? 'deliver';
const fromIdx = STAGES.indexOf(from);
const toIdx = STAGES.indexOf(to);
if (fromIdx === -1 || toIdx === -1 || fromIdx > toIdx) {
  console.error(`--from/--to must be stages in order: ${STAGES.join(' → ')}`);
  process.exit(2);
}

const stageFlags = {
  intake: ['url', 'upload', 'apify', 'title'],
  plan: ['brief'],
  assets: [],
  build: [],
  validate: [],
  render: ['docker', 'verify-determinism', 'quality'],
  qa: [],
  deliver: ['confirm-alpha', 'confirm-audio', 'allow-unconfirmed-audio'],
};

const here = path.dirname(new URL(import.meta.url).pathname);
for (const stage of STAGES.slice(fromIdx, toIdx + 1)) {
  const argv = [path.join(here, stage, 'run.js'), '--project', args.project];
  for (const flag of stageFlags[stage]) {
    if (args[flag] !== undefined) {
      argv.push(`--${flag}`);
      if (args[flag] !== true) argv.push(String(args[flag]));
    }
  }
  console.log(`\n[track-b] ── stage: ${stage} ──`);
  const res = spawnSync(process.execPath, argv, { stdio: 'inherit' });
  if (res.status === 3) {
    console.error(`[track-b] halted on PLAN_DEFECT during '${stage}' — see ${args.project}/plan-defects.json`);
    process.exit(3);
  }
  if (res.status !== 0) {
    console.error(`[track-b] stopped at failed stage '${stage}' (exit ${res.status}). State is on disk; fix and re-run: node pipeline/${stage}/run.js --project ${args.project}`);
    process.exit(res.status ?? 1);
  }
}

const state = loadState(path.resolve(args.project));
console.log(`\n[track-b] pipeline finished. Stage summary:`);
for (const [stage, s] of Object.entries(state.stages)) console.log(`  ${stage}: ${s.status}${s.attempts > 1 ? ` (attempts: ${s.attempts})` : ''}`);
