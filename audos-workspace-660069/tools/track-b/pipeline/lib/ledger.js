// Asset ledger (PRD stage 3): every asset is local, frozen, ledger-recorded,
// hashable, and deduplicated. Records source, licence, prompt, and content hash.
import path from 'node:path';
import fs from 'node:fs';
import { readJson, writeJson, sha256File } from './io.js';

const LEDGER_FILE = 'assets/ledger.json';

export function loadLedger(projectDir) {
  return readJson(path.join(projectDir, LEDGER_FILE), { entries: [] });
}

export function saveLedger(projectDir, ledger) {
  writeJson(path.join(projectDir, LEDGER_FILE), ledger);
}

/**
 * Record a frozen local asset. If an entry with the same content hash already
 * exists, the new file is removed and the existing entry is returned (dedupe).
 */
export function recordAsset(projectDir, { id, kind, file, source, licence, prompt = null, meta = {} }) {
  const ledger = loadLedger(projectDir);
  const abs = path.resolve(projectDir, file);
  const hash = sha256File(abs);

  const existing = ledger.entries.find((e) => e.sha256 === hash);
  if (existing) {
    if (path.resolve(projectDir, existing.file) !== abs) fs.rmSync(abs);
    return existing;
  }

  const entry = {
    id,
    kind, // icon | background | texture | logo | screenshot | audio | voice
    file, // path relative to the project dir — always local, never a URL
    source, // catalog | stock:<set> | generated:<model> | scrape:<url>
    licence,
    prompt,
    sha256: hash,
    bytes: fs.statSync(abs).size,
    frozen_at: new Date().toISOString(),
    meta,
  };
  ledger.entries.push(entry);
  saveLedger(projectDir, ledger);
  return entry;
}

export function findAsset(projectDir, id) {
  return loadLedger(projectDir).entries.find((e) => e.id === id) ?? null;
}

export function auditFrozen(projectDir) {
  // Verify every ledger entry still exists on disk and hashes to its recorded
  // value. Render refuses to run when the frozen set has drifted.
  const ledger = loadLedger(projectDir);
  const problems = [];
  for (const entry of ledger.entries) {
    const abs = path.resolve(projectDir, entry.file);
    if (!fs.existsSync(abs)) {
      problems.push(`missing asset file: ${entry.file} (${entry.id})`);
    } else if (sha256File(abs) !== entry.sha256) {
      problems.push(`asset content drifted from frozen hash: ${entry.file} (${entry.id})`);
    }
  }
  return problems;
}
