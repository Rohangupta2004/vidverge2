// HyperFrames project — single source of truth (PRD §20).
// Load/save, version bumping, field-ownership enforcement, render records.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { readJson, writeJson, MODULE_ROOT } from './io.js';

export const SCHEMA_VERSION = '1.1.0';
export const SCENE_STATES = ['EDITABLE', 'BAKED', 'REGENERATING', 'ERROR', 'LOCKED'];

// USER-writable fields (must mirror schema/project.schema.json → field_ownership.USER).
const USER_PROJECT_FIELDS = new Set(['title', 'music.track', 'music.volume', 'brand.primary_token', 'brand.accent_token']);
const USER_SCENE_FIELDS = new Set(['headline', 'caption', 'duration_s']);

export function projectFile(projectDir) {
  return path.join(projectDir, 'project.json');
}

export function loadProject(projectDir) {
  return readJson(projectFile(projectDir));
}

export function saveProject(projectDir, project) {
  project.version += 1;
  project.updated_at = new Date().toISOString();
  writeJson(projectFile(projectDir), project);
  return project;
}

export function createProject(projectDir, { title, track = 'product', source }) {
  if (track !== 'product') {
    throw new Error(`Track B only creates 'product' projects; got '${track}'. Track A (video) projects are not managed by this module.`);
  }
  const project = {
    id: crypto.randomUUID(),
    schema_version: SCHEMA_VERSION,
    version: 0, // saveProject bumps to 1
    updated_at: null,
    last_render_version: null,
    track,
    status: 'draft',
    title: title ?? 'Untitled product video',
    route: null,
    source,
    brand: { tokens: {}, primary_token: 'primary', accent_token: 'accent' },
    scenes: [],
    voice: { plan: null, voice_id: null, seed: null, stability: null },
    music: { track: null, volume: 0.7 },
    asset_manifest_version: 0,
    composition_version: 0,
    audio_version: 0,
    renders: [],
    checklist: null,
    hashes: {},
  };
  return saveProject(projectDir, project);
}

export function assertWritable(field, actor, { sceneField = false } = {}) {
  // PLANNER/BUILDER/SYSTEM actors are the pipeline stages themselves; the only
  // actor that must be constrained here is 'user' (and 'agent' acting on the
  // customer's behalf — the agent gets USER powers, never PLANNER powers).
  if (actor === 'user' || actor === 'agent') {
    const allowed = sceneField ? USER_SCENE_FIELDS : USER_PROJECT_FIELDS;
    if (!allowed.has(field)) {
      throw new Error(`field '${field}' is not customer-editable (ownership violation): customer edits must not overwrite PLANNER/BUILDER/SYSTEM fields`);
    }
  }
}

export function recordRender(project, { renderId, docker, output, sha256 }) {
  const record = {
    render_id: renderId,
    project_version: project.version,
    schema_version: project.schema_version,
    asset_manifest_version: project.asset_manifest_version,
    composition_version: project.composition_version,
    audio_version: project.audio_version,
    voice_version: project.audio_version, // voice audio is frozen inside the audio manifest version
    docker: Boolean(docker),
    output,
    sha256,
    rendered_at: new Date().toISOString(),
  };
  project.renders.push(record);
  project.last_render_version = project.version;
  return record;
}

export function loadRoutes() {
  return readJson(path.join(MODULE_ROOT, 'config', 'routes.json'));
}

export function loadCredits() {
  return readJson(path.join(MODULE_ROOT, 'config', 'credits.json'));
}

export function resolveProjectDir(args) {
  const dir = args.project ?? args._?.[0];
  if (!dir) {
    console.error('usage: node run.js --project <project-dir>');
    process.exit(2);
  }
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
  return abs;
}
