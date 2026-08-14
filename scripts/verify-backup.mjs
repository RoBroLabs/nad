#!/usr/bin/env node

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function insideRoot(root, candidate) {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path);
}

function safeRelativePath(root, value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/')) {
    throw new Error(`${label} path is invalid.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} path is invalid.`);
  }
  const resolved = resolve(root, value);
  if (!insideRoot(root, resolved)) throw new Error(`${label} path escapes the backup bundle.`);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      throw new Error(`${label} path contains an unsupported file type.`);
    }
  }
  return resolved;
}

function inventoryTree(root) {
  const files = [];
  const visit = (directory) => {
    const directoryMetadata = lstatSync(directory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`Backup directory is not a normal directory: ${directory}.`);
    }
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const path = join(directory, name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new Error(`Backup contains an unsupported file type at ${path}.`);
      }
      if (metadata.isDirectory()) visit(path);
      else files.push({
        path: relative(root, path).split('\\').join('/'),
        sha256: sha256File(path),
        bytes: metadata.size,
      });
    }
  };
  visit(root);
  return files;
}

function assertMode(path, expected, label) {
  if (process.platform === 'win32') return;
  const mode = statSync(path).mode & 0o777;
  if (mode & ~expected) throw new Error(`${label} permissions are too broad (${mode.toString(8)}).`);
}

function secureCopiedTree(root) {
  const visit = (path) => {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      throw new Error(`Restored backup contains an unsupported file type at ${path}.`);
    }
    if (metadata.isDirectory()) {
      chmodSync(path, 0o700);
      for (const name of readdirSync(path)) visit(join(path, name));
    } else {
      chmodSync(path, 0o600);
    }
  };
  visit(root);
}

function parseManifest(bundlePath) {
  const manifestPath = join(bundlePath, 'backup-manifest.json');
  assertMode(bundlePath, 0o700, 'Backup bundle');
  const manifestMetadata = lstatSync(manifestPath);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
    throw new Error('Backup manifest must be a normal file.');
  }
  assertMode(manifestPath, 0o600, 'Backup manifest');
  const bytes = readFileSync(manifestPath);
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('Backup manifest is too large.');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest?.backupVersion !== 2) throw new Error('Only complete backup manifest version 2 is accepted.');
  if (!Array.isArray(manifest.artifacts) || !manifest.database) throw new Error('Backup manifest is incomplete.');
  return manifest;
}

export function verifyBackupBundle(inputPath) {
  const bundlePath = resolve(inputPath);
  const bundleMetadata = lstatSync(bundlePath);
  if (!bundleMetadata.isDirectory() || bundleMetadata.isSymbolicLink()) throw new Error('Backup bundle must be a normal directory.');
  const manifest = parseManifest(bundlePath);
  const databasePath = safeRelativePath(bundlePath, manifest.database.path, 'Database');
  assertMode(databasePath, 0o600, 'Backup database');
  if (!SHA256.test(manifest.database.sha256)
      || sha256File(databasePath) !== manifest.database.sha256
      || statSync(databasePath).size !== manifest.database.bytes) {
    throw new Error('Backup database digest or byte size does not match the manifest.');
  }

  let migrationVersion;
  let databaseReleases = [];
  const databaseScratch = mkdtempSync(join(tmpdir(), 'nad-backup-database-'));
  try {
    chmodSync(databaseScratch, 0o700);
    const inspectionPath = join(databaseScratch, 'nad.db');
    cpSync(databasePath, inspectionPath, { errorOnExist: true });
    chmodSync(inspectionPath, 0o600);
    const database = new Database(inspectionPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = database.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`Backup database integrity check failed: ${integrity}`);
      const foreignKeys = database.pragma('foreign_key_check');
      if (foreignKeys.length) throw new Error(`Backup database has ${foreignKeys.length} foreign-key violation(s).`);
      migrationVersion = database
        .prepare('SELECT MAX(version) AS latest FROM homedashboard_migrations')
        .get()?.latest;
      if (migrationVersion !== manifest.database.migrationVersion) {
        throw new Error('Backup database migration version does not match the manifest.');
      }
      databaseReleases = database.prepare(`
        SELECT module_id AS moduleId, version, digest, state
        FROM module_releases
        WHERE state IN ('active', 'retained')
        ORDER BY module_id, version, digest
      `).all();
    } finally {
      database.close();
    }
  } finally {
    rmSync(databaseScratch, { recursive: true, force: true });
  }

  let artifactFiles = 0;
  const seenPaths = new Set();
  const manifestReleases = [];
  const expectedBundleFiles = new Set(['backup-manifest.json', manifest.database.path]);
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact.moduleId !== 'string' || typeof artifact.version !== 'string'
        || !/^[A-Za-z0-9._-]+$/.test(artifact.moduleId) || !SHA256.test(artifact.digest)
        || !['active', 'retained'].includes(artifact.state) || !Array.isArray(artifact.files)) {
      throw new Error('Backup artifact manifest entry is invalid.');
    }
    const expectedArtifactPath = `modules/${artifact.moduleId}/${artifact.digest}`;
    if (artifact.path !== expectedArtifactPath) {
      throw new Error(`Artifact ${artifact.moduleId} path does not match its immutable identity.`);
    }
    const artifactPath = safeRelativePath(bundlePath, artifact.path, `Artifact ${artifact.moduleId}`);
    const expected = artifact.files.map((file) => {
      if (!file || typeof file.path !== 'string' || !SHA256.test(file.sha256)
          || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
        throw new Error(`Artifact ${artifact.moduleId} has an invalid file entry.`);
      }
      expectedBundleFiles.add(`${artifact.path}/${file.path}`);
      return file;
    }).sort((left, right) => left.path.localeCompare(right.path));
    if (seenPaths.has(artifact.path)) throw new Error(`Duplicate artifact path ${artifact.path}.`);
    seenPaths.add(artifact.path);
    const actual = inventoryTree(artifactPath);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Artifact ${artifact.moduleId}@${artifact.version} inventory does not match the manifest.`);
    }
    artifactFiles += actual.length;
    manifestReleases.push({
      moduleId: artifact.moduleId,
      version: artifact.version,
      digest: artifact.digest,
      state: artifact.state,
    });
  }

  manifestReleases.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  databaseReleases.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (JSON.stringify(manifestReleases) !== JSON.stringify(databaseReleases)) {
    throw new Error('Backup artifact identities do not match the active/retained database releases.');
  }
  const actualBundleFiles = inventoryTree(bundlePath).map(({ path }) => path).sort();
  const allowedBundleFiles = [...expectedBundleFiles].sort();
  if (JSON.stringify(actualBundleFiles) !== JSON.stringify(allowedBundleFiles)) {
    throw new Error('Backup bundle contains an unlisted or missing file.');
  }

  return {
    backupVersion: manifest.backupVersion,
    createdAt: manifest.createdAt,
    migrationVersion,
    artifacts: manifest.artifacts.length,
    artifactFiles,
    databaseSha256: manifest.database.sha256,
  };
}

export function verifyDisposableRestore(inputPath) {
  verifyBackupBundle(inputPath);
  const scratch = mkdtempSync(join(tmpdir(), 'nad-backup-restore-'));
  try {
    chmodSync(scratch, 0o700);
    const restored = join(scratch, basename(resolve(inputPath)));
    cpSync(resolve(inputPath), restored, { recursive: true, errorOnExist: true });
    secureCopiedTree(restored);
    return verifyBackupBundle(restored);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const disposable = args.includes('--disposable');
  const bundle = args.find((argument) => argument !== '--disposable');
  if (!bundle) throw new Error('Usage: node scripts/verify-backup.mjs <bundle> [--disposable]');
  const result = disposable ? verifyDisposableRestore(bundle) : verifyBackupBundle(bundle);
  process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Backup verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
