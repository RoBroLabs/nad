#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDisposableRestore } from './verify-backup.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bundleName = /^nad-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

function integerEnvironment(name, fallback, minimum, maximum) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function dataDirectory() {
  const dbUrl = process.env.DATABASE_URL;
  const database = dbUrl?.startsWith('file:') ? dbUrl.slice(5) : join(process.cwd(), 'data', 'nad.db');
  const databasePath = isAbsolute(database) ? database : resolve(process.cwd(), database);
  return resolve(process.env.NAD_DATA_DIR ?? dirname(databasePath));
}

function insideRoot(root, candidate) {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path);
}

function bundleDirectories(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && bundleName.test(entry.name))
    .map((entry) => ({ name: entry.name, path: join(root, entry.name), modified: lstatSync(join(root, entry.name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified || right.name.localeCompare(left.name));
}

export function runBackupMaintenance() {
  const target = resolve(process.env.NAD_BACKUP_DIRECTORY ?? join(dataDirectory(), 'backups'));
  const keep = integerEnvironment('NAD_BACKUP_RETENTION_COUNT', 14, 2, 365);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const before = new Set(bundleDirectories(target).map(({ name }) => name));
  chmodSync(target, 0o700);
  const backup = spawnSync(process.execPath, [join(scriptDirectory, 'backup.mjs'), target], {
    env: process.env,
    encoding: 'utf8',
  });
  if (backup.status !== 0) throw new Error((backup.stderr || backup.stdout || 'Backup command failed.').trim());
  const created = bundleDirectories(target).find(({ name }) => !before.has(name));
  if (!created) throw new Error('Backup command did not create a new complete bundle.');
  const verification = verifyDisposableRestore(created.path);

  const removed = [];
  for (const candidate of bundleDirectories(target).slice(keep)) {
    if (!insideRoot(target, candidate.path)) throw new Error('Retention candidate escaped the backup root.');
    const staged = `${candidate.path}.pruning`;
    renameSync(candidate.path, staged);
    rmSync(staged, { recursive: true, force: false });
    removed.push(candidate.name);
  }
  return { bundle: created.path, retained: bundleDirectories(target).length, removed, verification };
}

function pause(milliseconds) {
  return new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
}

async function main() {
  const scheduled = process.argv.includes('--scheduled');
  const intervalHours = integerEnvironment('NAD_BACKUP_INTERVAL_HOURS', 24, 1, 168);
  do {
    const result = runBackupMaintenance();
    process.stdout.write(`${JSON.stringify({ status: 'ok', checkedAt: new Date().toISOString(), ...result })}\n`);
    if (!scheduled) break;
    await pause(intervalHours * 60 * 60 * 1000);
  } while (true);
}

main().catch((error) => {
  console.error(`Backup maintenance failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
