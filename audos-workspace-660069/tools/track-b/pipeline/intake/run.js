// Stage 1 — Intake (PRD §pipeline.1).
// Accepts a URL (preferred), a direct upload directory, or an Apify scrape
// result file. URL source uses `npx hyperframes capture <url>` so the product's
// real screens, assets, palette, and copy become local files.
//
// In:  --project <dir> plus exactly one of --url <url> | --upload <dir> | --apify <result.json>
// Out: <project>/intake/  (capture output or copied uploads) + intake/intake.json
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs, writeJson, ensureDir, listFilesRecursive } from '../lib/io.js';
import { beginStage, completeStage, failStage } from '../lib/state.js';
import { createProject, loadProject, saveProject, projectFile } from '../lib/project.js';
import { resolveProjectDir } from '../lib/project.js';

const args = parseArgs(process.argv.slice(2));
const projectDir = resolveProjectDir(args);
const sources = ['url', 'upload', 'apify'].filter((k) => args[k]);

if (sources.length !== 1) {
  console.error('usage: node pipeline/intake/run.js --project <dir> (--url <url> | --upload <dir> | --apify <result.json>) [--title <title>]');
  process.exit(2);
}

beginStage(projectDir, 'intake');
try {
  const kind = sources[0];
  const intakeDir = ensureDir(path.join(projectDir, 'intake'));

  if (!fs.existsSync(projectFile(projectDir))) {
    createProject(projectDir, {
      title: args.title,
      track: 'product',
      source: { kind, url: args.url ?? null, captured_at: null },
    });
  }

  // Scaffold the HyperFrames project contract files (project convention:
  // composition at <project>/index.html, hyperframes.json at the root).
  const hfConfig = path.join(projectDir, 'hyperframes.json');
  if (!fs.existsSync(hfConfig)) {
    writeJson(hfConfig, {
      $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
      registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
      paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
      media: { autoProxy: true },
    });
  }
  const metaFile = path.join(projectDir, 'meta.json');
  if (!fs.existsSync(metaFile)) {
    writeJson(metaFile, { id: path.basename(projectDir), name: args.title ?? path.basename(projectDir), createdAt: new Date().toISOString() });
  }

  if (kind === 'url') {
    // hyperframes capture downloads screenshots + assets and emits JSON for agents.
    execFileSync('npx', ['-y', 'hyperframes', 'capture', args.url, '--output', path.join(intakeDir, 'capture'), '--json'], {
      stdio: ['ignore', fs.openSync(path.join(intakeDir, 'capture-result.json'), 'w'), 'inherit'],
      timeout: 10 * 60 * 1000,
    });
  } else if (kind === 'upload') {
    const src = path.resolve(args.upload);
    if (!fs.existsSync(src)) throw new Error(`upload directory not found: ${src}`);
    fs.cpSync(src, path.join(intakeDir, 'uploads'), { recursive: true });
  } else {
    const src = path.resolve(args.apify);
    if (!fs.existsSync(src)) throw new Error(`apify result file not found: ${src}`);
    fs.copyFileSync(src, path.join(intakeDir, 'apify-result.json'));
  }

  const files = listFilesRecursive(intakeDir).map((f) => path.relative(projectDir, f));
  writeJson(path.join(intakeDir, 'intake.json'), {
    kind,
    url: args.url ?? null,
    captured_at: new Date().toISOString(),
    files,
  });

  const project = loadProject(projectDir);
  project.source = { kind, url: args.url ?? null, captured_at: new Date().toISOString() };
  project.status = 'draft';
  saveProject(projectDir, project);

  completeStage(projectDir, 'intake', { files: files.length });
} catch (err) {
  failStage(projectDir, 'intake', err);
  process.exit(1);
}
