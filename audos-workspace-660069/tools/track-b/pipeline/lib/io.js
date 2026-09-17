// Track B shared file I/O helpers. Pure filesystem — no network, no MCP.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw new Error(`Failed to read JSON ${file}: ${err.message}`);
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file); // atomic on the same filesystem
}

export function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

export function sha256String(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

export const MODULE_ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

export function parseArgs(argv, spec = {}) {
  // Minimal flag parser: --key value | --key=value | --flag
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (spec[key] === 'boolean' || next === undefined || next.startsWith('--')) {
          args[key] = true;
        } else {
          args[key] = next;
          i += 1;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}
