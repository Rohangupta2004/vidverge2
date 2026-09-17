// Stage 4 — Build (PRD §pipeline.4).
// Sonnet writes the HyperFrames HTML/CSS/JS compositions per the plan. Sonnet
// receives the COMPLETE asset manifest with local paths — it never invents or
// hotlinks assets. Text is always a coded overlay. If the plan asks for
// something the builder cannot execute, it emits PLAN_DEFECT and the stage halts.
//
// In:  <project>/plan/plan.json, <project>/assets/** (frozen), project.json
// Out: <project>/index.html (HyperFrames project convention), BUILDER fields in project.json
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs, readJson, sha256String } from '../lib/io.js';
import { beginStage, completeStage, failStage, requireStage } from '../lib/state.js';
import { loadProject, saveProject, resolveProjectDir } from '../lib/project.js';
import { loadLedger } from '../lib/ledger.js';
import { anthropicMessage, BUILD_MODEL } from '../lib/llm.js';
import { planDefect } from '../lib/defect.js';

const args = parseArgs(process.argv.slice(2));
const projectDir = resolveProjectDir(args);

const SYSTEM = `You are the BUILDER for Track B product videos. You write ONE complete HyperFrames composition (a single self-contained index.html) implementing the plan exactly.

HyperFrames contract:
- The DOM declares timing: scene elements use class="clip" with data-start and data-duration (seconds).
- The root carries data-fps="30" and data-duration set to the total.
- Animation runtime is GSAP on the seekable timeline "tl" provided by HyperFrames; every tween MUST attach to tl (never bare gsap.to — wallclock tweens do not scrub and silently vanish from renders).
- Prefer tl.fromTo() over tl.from() inside .clip scenes (immediateRender interacts badly with scene boundaries).
- Never overlap conflicting transform tweens on one element — combine into one tween or split across parent/child wrappers.
- Ambient loops (auras, breathing) also attach to tl.
- Hard-kill exiting inner elements at scene boundaries with tl.set(el, {opacity:0, visibility:"hidden"}) — never on the .clip container itself.

Asset rules (§asset format):
- Reference ONLY the local relative asset paths given in the manifest (the composition lives at the project root, so paths are exactly as listed, e.g. src="assets/icons/x.svg"). Load GSAP from the frozen local vendor copy: <script src="assets/vendor/gsap.min.js"></script>. NEVER a URL, CDN, remote font, or data:image/svg+xml.
- Icons are SVG files using currentColor.
- Grain/noise: inline CSS radial-gradient ONLY — never SVG filters or data:image/svg+xml (taints html2canvas).
- Never upscale low-res assets.
- Text is ALWAYS a coded DOM overlay — never baked into imagery.

Editability contract: the customer later edits headline/caption text, scene duration, brand colours, and music through the Product Editor. Therefore:
- Every headline element carries data-tb-scene="<scene-id>" data-tb-field="headline"; captions likewise with data-tb-field="caption".
- Brand colours are consumed ONLY through CSS custom properties --tb-primary, --tb-accent, --tb-surface, --tb-text declared once on :root.
- Scene timing comes ONLY from data-start/data-duration on the .clip elements.

Quality bar (§23 anti-goals — automatic failure if present): generic stock aesthetic, arbitrary left-to-right text slides, drop shadows everywhere, >3 competing colours, default centred text, bullet-point animation, uniform scene durations, music ignoring cuts, generic gradients, slide-deck transitions.

Motion doctrine: vary eases (max 2 tweens per scene with the same ease), vary speeds (slowest scene ~3x the fastest), vary entrance directions, build/breathe/resolve in every scene, entrances longer than exits, first animation offset 0.1–0.3s (never t=0), stagger by importance under 500ms total.

If any part of the plan cannot be executed exactly as specified, respond with a single line "PLAN_DEFECT: <precise description>" and NOTHING else.

Otherwise respond with the complete index.html and nothing else (no fences, no commentary).`;

beginStage(projectDir, 'build');
try {
  requireStage(projectDir, 'build', ['assets']);
  const plan = readJson(path.join(projectDir, 'plan', 'plan.json'));
  const project = loadProject(projectDir);
  const ledger = loadLedger(projectDir);

  // The builder receives the complete asset manifest WITH LOCAL PATHS.
  const assetTable = ledger.entries.map((e) => ({ id: e.id, kind: e.kind, file: e.file, meta: e.meta ?? {} }));

  const userContent = `PLAN:\n${JSON.stringify(plan, null, 2)}\n\nCURRENT PROJECT SCENES (single source of truth — durations/headlines may have been edited since planning; honour project.json values over plan.json where they differ):\n${JSON.stringify(project.scenes.map(({ id, intent, motion, timing_range, duration_s, headline, caption, asset_refs }) => ({ id, intent, motion, timing_range, duration_s, headline, caption, asset_refs })), null, 2)}\n\nBRAND TOKENS:\n${JSON.stringify(project.brand.tokens, null, 2)}\n\nFROZEN ASSET MANIFEST (local paths relative to the project root, where the composition lives — reference exactly as listed):\n${JSON.stringify(assetTable, null, 2)}\n\nVOICE + MUSIC:\n${JSON.stringify({ voice: project.voice, music: project.music }, null, 2)}\n\nWrite the composition now.`;

  const out = await anthropicMessage({ model: BUILD_MODEL, system: SYSTEM, maxTokens: 32000, temperature: 0.5, messages: [{ role: 'user', content: userContent }] });

  const trimmed = out.trim();
  if (trimmed.startsWith('PLAN_DEFECT:')) {
    planDefect(projectDir, 'build', trimmed.slice('PLAN_DEFECT:'.length).trim());
  }
  let html = trimmed;
  const fence = trimmed.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fence) html = fence[1].trim();
  if (!/<html[\s>]/i.test(html)) {
    throw new Error('builder did not return an HTML document (retry the stage)');
  }

  // Hard checks the builder must never violate.
  if (/data:image\/svg\+xml/i.test(html)) planDefect(projectDir, 'build', 'composition embeds data:image/svg+xml (taints html2canvas) — forbidden by asset format rules');
  const remote = html.match(/(?:src|href)=["']https?:\/\/[^"']+["']/gi) ?? [];
  if (remote.length) planDefect(projectDir, 'build', `composition references remote URLs (offline rendering is non-negotiable): ${remote.slice(0, 5).join(', ')}`);

  // HyperFrames project convention: the main composition is <project>/index.html.
  fs.writeFileSync(path.join(projectDir, 'index.html'), html);

  // BUILDER-owned fields.
  for (const scene of project.scenes) {
    scene.composition_file = 'index.html';
  }
  project.composition_version += 1;
  project.status = 'building';
  project.hashes.compositions = sha256String(html);
  saveProject(projectDir, project);

  completeStage(projectDir, 'build', { composition: 'index.html', bytes: html.length });
} catch (err) {
  failStage(projectDir, 'build', err);
  process.exit(1);
}
