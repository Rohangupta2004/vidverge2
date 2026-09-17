// Stage 8 — Deliver (PRD §pipeline.8).
// Runs ONLY after every §24 Definition-of-Done criterion this module can check
// mechanically has passed. Copies the final MP4 + full provenance (project
// version identity, render record, ledger, contact sheet) into deliver/.
// The orchestrator decides what to do with deliver/ — the module does not know
// an orchestrator exists.
//
// In:  validate/report.json, renders/render-record.json, qa/report.json
// Out: <project>/deliver/{final.mp4, delivery.json, contact-sheet.png}
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs, readJson, writeJson, ensureDir, sha256File } from '../lib/io.js';
import { beginStage, completeStage, failStage, requireStage } from '../lib/state.js';
import { loadProject, saveProject, resolveProjectDir } from '../lib/project.js';
import { hasOpenDefects } from '../lib/defect.js';

const args = parseArgs(process.argv.slice(2), { 'confirm-alpha': 'boolean', 'confirm-audio': 'boolean', 'allow-unconfirmed-audio': 'boolean' });
const projectDir = resolveProjectDir(args);

beginStage(projectDir, 'deliver');
try {
  requireStage(projectDir, 'deliver', ['validate', 'render', 'qa']);
  const project = loadProject(projectDir);
  const validateReport = readJson(path.join(projectDir, 'validate', 'report.json'));
  const renderRecord = readJson(path.join(projectDir, 'renders', 'render-record.json'));
  const qaReport = readJson(path.join(projectDir, 'qa', 'report.json'));

  // §24 Definition of Done — every mechanically checkable criterion, re-checked
  // here from the artifacts on disk (not trusted from stage exit codes).
  const dod = {
    '1_lint': validateReport.lint?.ok === true,
    '2_check': validateReport.check?.ok === true,
    '3_validate': validateReport.validate?.ok === true,
    '4_keyframe_diagnostics': validateReport.keyframes?.ok === true,
    '5_docker_determinism': renderRecord.docker === true && (renderRecord.determinism == null || renderRecord.determinism.verified === true),
    '7_vision_qa': qaReport.pass === true,
    '8_product_fidelity': qaReport.verdict?.product_fidelity && Object.entries(qaReport.verdict.product_fidelity).every(([k, v]) => k === 'notes' || v === true),
    '10_contact_sheet': fs.existsSync(path.join(projectDir, 'qa', 'contact-sheet.png')),
    '11_no_anti_goals': (qaReport.verdict?.anti_goals_present ?? []).length === 0,
    'no_open_plan_defects': !hasOpenDefects(projectDir),
    'render_version_identity': renderRecord.project_version != null && renderRecord.sha256 != null,
  };
  // Items 6 (alpha formats) and 9 (phone-speaker audio mix) need format-specific
  // and human/audio checks; they are recorded as manual gates the orchestrator
  // must confirm via --confirm-alpha / --confirm-audio flags when applicable.
  dod['6_alpha_formats'] = args['confirm-alpha'] ? true : 'not_applicable_or_unconfirmed';
  dod['9_audio_phone_check'] = args['confirm-audio'] ? true : 'unconfirmed';

  const hardFailures = Object.entries(dod).filter(([, v]) => v === false).map(([k]) => k);
  if (hardFailures.length) {
    throw new Error(`Definition of Done not met — failing criteria: ${hardFailures.join(', ')}. Delivery refused.`);
  }
  if (dod['9_audio_phone_check'] !== true && !args['allow-unconfirmed-audio']) {
    throw new Error('DoD item 9 (low-volume phone-speaker audio check) is unconfirmed. Re-run with --confirm-audio after a human check, or --allow-unconfirmed-audio to record it as an explicit waiver.');
  }

  const deliverDir = ensureDir(path.join(projectDir, 'deliver'));
  const finalPath = path.join(deliverDir, 'final.mp4');
  fs.copyFileSync(path.join(projectDir, renderRecord.output), finalPath);
  if (sha256File(finalPath) !== renderRecord.sha256) throw new Error('delivered file hash does not match the render record — aborting');
  fs.copyFileSync(path.join(projectDir, 'qa', 'contact-sheet.png'), path.join(deliverDir, 'contact-sheet.png'));

  writeJson(path.join(deliverDir, 'delivery.json'), {
    delivered_at: new Date().toISOString(),
    definition_of_done: dod,
    render_record: renderRecord,
    project: {
      id: project.id,
      version: project.version,
      schema_version: project.schema_version,
      last_render_version: project.last_render_version,
      route: project.route,
      track: project.track,
    },
    qa: { pass: qaReport.pass, contact_sheet: 'contact-sheet.png' },
    audio_waiver: dod['9_audio_phone_check'] !== true ? 'delivered with explicit --allow-unconfirmed-audio waiver' : null,
  });

  project.status = 'delivered';
  saveProject(projectDir, project);
  completeStage(projectDir, 'deliver', { final: 'deliver/final.mp4' });
} catch (err) {
  failStage(projectDir, 'deliver', err);
  process.exit(1);
}
