// Stage 3 — Resolve Assets (PRD §pipeline.3).
// Populates <project>/assets/ per the plan's asset manifest. Resolution order:
//   (1) existing catalog (track-b/assets/** shared catalog + this project's ledger)
//   (2) stock icon sets — Lucide, Phosphor, Heroicons, Tabler (fetched once, frozen as SVG/currentColor)
//   (3) Gemini/GPT generation
//   (4) scraping — for product truth only (files already captured at intake)
// Every asset ends up local, frozen, ledger-recorded, hashed, deduplicated.
// Voice lines are frozen here too (one voice identity per film, settings recorded).
//
// In:  <project>/plan/plan.json
// Out: <project>/assets/** + assets/manifest.json + assets/ledger.json
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs, readJson, writeJson, ensureDir, MODULE_ROOT, sha256String } from '../lib/io.js';
import { beginStage, completeStage, failStage, requireStage } from '../lib/state.js';
import { loadProject, saveProject, resolveProjectDir } from '../lib/project.js';
import { recordAsset, findAsset } from '../lib/ledger.js';
import { generateImage } from '../lib/llm.js';
import { planDefect } from '../lib/defect.js';

const args = parseArgs(process.argv.slice(2));
const projectDir = resolveProjectDir(args);

const ICON_SETS = {
  // name → (iconName) => URL of a raw SVG. Fetched at resolve time, then frozen.
  lucide: (n) => `https://unpkg.com/lucide-static@latest/icons/${n}.svg`,
  phosphor: (n) => `https://unpkg.com/@phosphor-icons/core@latest/assets/regular/${n}.svg`,
  heroicons: (n) => `https://unpkg.com/heroicons@2.2.0/24/outline/${n}.svg`,
  tabler: (n) => `https://unpkg.com/@tabler/icons@latest/icons/outline/${n}.svg`,
};

function normalizeSvgCurrentColor(svg) {
  // Icons ship as SVG using currentColor (PRD §asset format rules).
  return svg
    .replace(/(stroke|fill)="(?!none)[^"]*"/g, '$1="currentColor"')
    .replace(/(stroke|fill):\s*(?!none)#[0-9a-fA-F]{3,8}/g, '$1: currentColor');
}

async function fetchStockIcon(name) {
  const errors = [];
  for (const [set, urlOf] of Object.entries(ICON_SETS)) {
    try {
      const res = await fetch(urlOf(name));
      if (!res.ok) { errors.push(`${set}: HTTP ${res.status}`); continue; }
      const svg = await res.text();
      if (!svg.includes('<svg')) { errors.push(`${set}: not an svg`); continue; }
      return { set, svg: normalizeSvgCurrentColor(svg) };
    } catch (err) { errors.push(`${set}: ${err.message}`); }
  }
  throw new Error(`icon '${name}' not found in any stock set (${errors.join('; ')})`);
}

function findInSharedCatalog(assetSpec) {
  // (1) existing catalog: track-b/assets/<kind>s/<id>.* frozen by earlier films.
  const kindDir = path.join(MODULE_ROOT, 'assets', `${assetSpec.kind}s`);
  if (!fs.existsSync(kindDir)) return null;
  const match = fs.readdirSync(kindDir).find((f) => f.startsWith(assetSpec.id + '.'));
  return match ? path.join(kindDir, match) : null;
}

function findScrapedFile(projectDir, assetSpec) {
  // (4) product truth only: reuse files the intake capture already downloaded.
  const captureDirs = [path.join(projectDir, 'intake', 'capture'), path.join(projectDir, 'intake', 'uploads')];
  for (const dir of captureDirs) {
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, entry.name);
        if (entry.isDirectory()) { stack.push(full); continue; }
        const base = entry.name.toLowerCase();
        if ((assetSpec.match && base.includes(assetSpec.match.toLowerCase())) || base.includes(assetSpec.id.toLowerCase())) return full;
      }
    }
  }
  return null;
}

beginStage(projectDir, 'assets');
try {
  requireStage(projectDir, 'assets', ['plan']);
  const plan = readJson(path.join(projectDir, 'plan', 'plan.json'));
  const project = loadProject(projectDir);
  const assetsDir = ensureDir(path.join(projectDir, 'assets'));
  for (const sub of ['icons', 'backgrounds', 'textures', 'logos', 'screenshots', 'audio']) ensureDir(path.join(assetsDir, sub));

  // Vendor the GSAP runtime locally so compositions never load it from a CDN
  // (offline rendering is non-negotiable). Frozen + ledgered like any asset.
  if (!findAsset(projectDir, 'vendor-gsap')) {
    ensureDir(path.join(assetsDir, 'vendor'));
    const gsapVersion = process.env.TRACKB_GSAP_VERSION || '3.14.2';
    const res = await fetch(`https://cdn.jsdelivr.net/npm/gsap@${gsapVersion}/dist/gsap.min.js`);
    if (!res.ok) throw new Error(`failed to vendor gsap@${gsapVersion}: HTTP ${res.status}`);
    fs.writeFileSync(path.join(assetsDir, 'vendor', 'gsap.min.js'), Buffer.from(await res.arrayBuffer()));
    recordAsset(projectDir, { id: 'vendor-gsap', kind: 'vendor', file: path.join('assets', 'vendor', 'gsap.min.js'), source: `stock:jsdelivr gsap@${gsapVersion}`, licence: 'GSAP standard license', meta: { version: gsapVersion } });
  }

  const resolved = [];
  for (const spec of plan.asset_manifest ?? []) {
    if (findAsset(projectDir, spec.id)) { resolved.push(spec.id); continue; } // idempotent retry

    const subdir = { icon: 'icons', background: 'backgrounds', texture: 'textures', logo: 'logos', screenshot: 'screenshots', audio: 'audio' }[spec.kind];
    if (!subdir) planDefect(projectDir, 'assets', `asset '${spec.id}' has unknown kind '${spec.kind}'`);

    if (spec.kind === 'icon') {
      const { set, svg } = await fetchStockIcon(spec.icon_name ?? spec.id);
      const rel = path.join('assets', subdir, `${spec.id}.svg`);
      fs.writeFileSync(path.join(projectDir, rel), svg);
      recordAsset(projectDir, { id: spec.id, kind: spec.kind, file: rel, source: `stock:${set}`, licence: `${set} icon licence (permissive OSS)`, meta: { icon_name: spec.icon_name } });
    } else if (spec.kind === 'audio') {
      // Voice/music audio: frozen locally. Voiceover uses `hyperframes tts`
      // (local Kokoro model) so rendering stays offline; music briefs resolve
      // from the shared catalog or halt as a plan defect (never invent audio).
      const catalogHit = findInSharedCatalog(spec);
      if (catalogHit) {
        const rel = path.join('assets', subdir, path.basename(catalogHit));
        fs.copyFileSync(catalogHit, path.join(projectDir, rel));
        recordAsset(projectDir, { id: spec.id, kind: spec.kind, file: rel, source: 'catalog', licence: 'workspace catalog (pre-cleared)' });
      } else {
        planDefect(projectDir, 'assets', `music asset '${spec.id}' is not in the approved catalog (track-b/assets/audios). Add an approved track to the catalog; the module does not source music from the open web.`);
      }
    } else {
      // background | texture | logo | screenshot
      let file = findInSharedCatalog(spec);
      let source = 'catalog';
      let licence = 'workspace catalog (pre-cleared)';
      let prompt = null;
      if (!file && (spec.resolution_hint === 'scrape' || spec.kind === 'logo' || spec.kind === 'screenshot')) {
        file = findScrapedFile(projectDir, spec);
        if (file) { source = `scrape:${project.source?.url ?? 'upload'}`; licence = 'product truth — owned by the founder'; }
      }
      if (!file) {
        if (spec.kind === 'logo' || spec.kind === 'screenshot') {
          // Product truth must never be invented (PRD: scraping for product truth only).
          planDefect(projectDir, 'assets', `product-truth asset '${spec.id}' (${spec.kind}) was not found in the intake capture and cannot be generated. Re-run intake with a source that contains it.`);
        }
        prompt = spec.prompt ?? spec.description;
        const { bytes, model } = await generateImage({ prompt });
        const rel = path.join('assets', subdir, `${spec.id}.png`);
        fs.writeFileSync(path.join(projectDir, rel), bytes);
        recordAsset(projectDir, { id: spec.id, kind: spec.kind, file: rel, source: `generated:${model}`, licence: 'AI-generated for this workspace', prompt });
        resolved.push(spec.id);
        continue;
      }
      const rel = path.join('assets', subdir, `${spec.id}${path.extname(file) || '.png'}`);
      fs.copyFileSync(file, path.join(projectDir, rel));
      recordAsset(projectDir, { id: spec.id, kind: spec.kind, file: rel, source, licence, prompt });
    }
    resolved.push(spec.id);
  }

  // Freeze voiceover lines: one voice identity per film. Settings are recorded
  // on the project so any single-line regeneration reuses voice id + seed +
  // stability exactly (PRD §voice layer).
  if (project.voice?.plan?.lines?.length) {
    project.voice.voice_id = project.voice.voice_id ?? (process.env.TRACKB_TTS_VOICE || 'af_heart');
    project.voice.seed = project.voice.seed ?? 42;
    project.voice.stability = project.voice.stability ?? 0.75;
    for (const line of project.voice.plan.lines) {
      const id = `voice-${line.scene_id}`;
      if (findAsset(projectDir, id)) continue;
      const rel = path.join('assets', 'audio', `${id}.wav`);
      execFileSync('npx', ['-y', 'hyperframes', 'tts', line.text, '--voice', project.voice.voice_id, '-o', path.join(projectDir, rel)], { stdio: 'inherit', timeout: 5 * 60 * 1000 });
      recordAsset(projectDir, {
        id, kind: 'voice', file: rel, source: 'generated:kokoro-local', licence: 'locally generated TTS',
        prompt: line.text, meta: { voice_id: project.voice.voice_id, seed: project.voice.seed, stability: project.voice.stability, scene_id: line.scene_id },
      });
    }
  }

  const manifest = { generated_at: new Date().toISOString(), plan_hash: project.hashes.plan, assets: resolved };
  writeJson(path.join(assetsDir, 'manifest.json'), manifest);
  project.asset_manifest_version += 1;
  project.hashes.manifest = sha256String(JSON.stringify(manifest));
  saveProject(projectDir, project);

  completeStage(projectDir, 'assets', { resolved: resolved.length });
} catch (err) {
  failStage(projectDir, 'assets', err);
  process.exit(1);
}
