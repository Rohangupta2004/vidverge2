// Stage 6 — Render (PRD §pipeline.6).
// Renders the composition to MP4. `--docker` gives byte-identical reproducible
// output (§24 item 5; verify with --verify-determinism, which renders twice and
// compares hashes). OFFLINE-CAPABLE: before rendering, the stage proves the
// frozen-asset ledger is intact and the composition references no remote URLs —
// once assets are frozen, rendering completes with zero network calls.
//
// In:  <project>/index.html + frozen assets/
// Out: <project>/renders/<render-id>.mp4 + renders/render-record.json (versions)
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs, writeJson, ensureDir, sha256File } from '../lib/io.js';
import { beginStage, completeStage, failStage, requireStage } from '../lib/state.js';
import { loadProject, saveProject, recordRender, resolveProjectDir } from '../lib/project.js';
import { auditFrozen } from '../lib/ledger.js';

const args = parseArgs(process.argv.slice(2), { docker: 'boolean', 'verify-determinism': 'boolean' });
const projectDir = resolveProjectDir(args);

function renderOnce(outFile, useDocker) {
  const argv = ['-y', 'hyperframes', 'render', '-o', outFile, '--quality', args.quality ?? 'high', '--strict'];
  if (useDocker) argv.push('--docker');
  const res = spawnSync('npx', argv, { cwd: projectDir, stdio: 'inherit', timeout: 60 * 60 * 1000 });
  if (res.status !== 0) throw new Error(`hyperframes render exited ${res.status}`);
  if (!fs.existsSync(path.join(projectDir, outFile))) throw new Error(`render produced no output at ${outFile}`);
}

beginStage(projectDir, 'render');
try {
  requireStage(projectDir, 'render', ['validate']);
  ensureDir(path.join(projectDir, 'renders'));

  // Offline guarantee, enforced (not assumed):
  const drift = auditFrozen(projectDir);
  if (drift.length) throw new Error(`frozen asset audit failed:\n  ${drift.join('\n  ')}`);
  const html = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  const remote = html.match(/(?:src|href)=["']https?:\/\/[^"']+["']/gi) ?? [];
  if (remote.length) throw new Error(`composition references remote URLs — offline rendering violated: ${remote.slice(0, 5).join(', ')}`);

  const useDocker = Boolean(args.docker);
  const renderId = `r-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const outFile = path.join('renders', `${renderId}.mp4`);
  renderOnce(outFile, useDocker);
  const hash = sha256File(path.join(projectDir, outFile));

  let determinism = null;
  if (args['verify-determinism']) {
    if (!useDocker) throw new Error('--verify-determinism requires --docker (only the docker path guarantees byte-identical output)');
    const verifyFile = path.join('renders', `${renderId}-verify.mp4`);
    renderOnce(verifyFile, true);
    const verifyHash = sha256File(path.join(projectDir, verifyFile));
    determinism = { verified: verifyHash === hash, first: hash, second: verifyHash };
    if (!determinism.verified) {
      // Keep both files so the difference can be diagnosed.
      throw new Error(`determinism verification FAILED: two --docker renders differ byte-for-byte (kept ${verifyFile} for diagnosis)`);
    }
    fs.rmSync(path.join(projectDir, verifyFile));
  }

  // Every render records the exact versions it was produced from (PRD §20.2).
  const project = loadProject(projectDir);
  const record = recordRender(project, { renderId, docker: useDocker, output: outFile, sha256: hash });
  project.status = 'rendered';
  saveProject(projectDir, project);
  writeJson(path.join(projectDir, 'renders', 'render-record.json'), { ...record, determinism });

  completeStage(projectDir, 'render', { render_id: renderId, output: outFile, docker: useDocker, determinism });
} catch (err) {
  failStage(projectDir, 'render', err);
  process.exit(1);
}
