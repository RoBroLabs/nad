#!/usr/bin/env node
// NAD backup bundle: verified SQLite snapshot plus every active or retained
// installed Module artifact. A DB-only archive can leave restored lifecycle
// records with dangling artifact pointers, so it is explicit through --db-only.

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

function resolveDatabasePath() {
  const dbUrl = process.env.DATABASE_URL;
  const value = dbUrl?.startsWith('file:') ? dbUrl.slice(5) : join(process.cwd(), 'data', 'nad.db');
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function resolveDataDirectory(databasePath) {
  return resolve(process.env.NAD_DATA_DIR ?? dirname(databasePath));
}

function timestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function insideRoot(root, candidate) {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path);
}

function secureAndInventoryTree(root) {
  const files = [];
  const visit = (directory) => {
    chmodSync(directory, 0o700);
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const path = join(directory, name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new Error(`Backup payload contains an unsupported file type at ${path}.`);
      }
      if (metadata.isDirectory()) {
        visit(path);
        continue;
      }
      chmodSync(path, 0o600);
      files.push({
        path: relative(root, path).split('\\').join('/'),
        sha256: sha256File(path),
        bytes: statSync(path).size,
      });
    }
  };
  visit(root);
  return files;
}

function assertNormalSourceTree(root) {
  const visit = (path) => {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      throw new Error(`Installed Module artifact contains an unsupported file type at ${path}.`);
    }
    if (metadata.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    }
  };
  visit(root);
}

async function main() {
  const sourcePath = resolveDatabasePath();
  const args = process.argv.slice(2);
  const dbOnly = args.includes('--db-only');
  const targetArgument = args.find((argument) => argument !== '--db-only');
  const targetDirectory = resolve(targetArgument ?? join(resolveDataDirectory(sourcePath), 'backups'));
  mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
  chmodSync(targetDirectory, 0o700);
  const name = `nad-${timestamp(new Date())}`;
  const bundlePath = dbOnly ? targetDirectory : join(targetDirectory, name);
  if (!dbOnly) mkdirSync(bundlePath, { recursive: false, mode: 0o700 });
  const databaseTarget = dbOnly ? join(targetDirectory, `${name}.db`) : join(bundlePath, 'nad.db');

  try {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
      await source.backup(databaseTarget);
      chmodSync(databaseTarget, 0o600);
    } finally {
      source.close();
    }

    // Normalise the snapshot to a self-contained DELETE-journal database. A
    // WAL-mode source otherwise causes SQLite to create -wal/-shm sidecars
    // when the backup is inspected or restored, which would make the bundle
    // inventory mutable after it has been signed by its manifest digest.
    const archive = new Database(databaseTarget);
    let migrations;
    let installedReleases = [];
    try {
      archive.pragma('journal_mode = DELETE');
      const integrity = archive.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`Backup integrity check failed: ${integrity}`);
      migrations = archive
        .prepare('SELECT COUNT(*) AS count, MAX(version) AS latest FROM homedashboard_migrations')
        .get();
      if (!migrations.latest) throw new Error('Backup contains no recorded schema migrations.');
      const installedRuntimeExists = archive.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'module_releases'
      `).get();
      if (installedRuntimeExists) {
        installedReleases = archive.prepare(`
          SELECT installed_modules.module_id, module_releases.version,
                 module_releases.digest, module_releases.artifact_path,
                 module_releases.state
          FROM installed_modules
          JOIN module_releases ON module_releases.module_id = installed_modules.module_id
          WHERE module_releases.state IN ('active', 'retained')
          ORDER BY installed_modules.module_id, module_releases.installed_at
        `).all();
      }
    } finally {
      archive.close();
    }

    if (dbOnly) {
      if (installedReleases.length) {
        console.warn(`Warning: DB-only backup omits ${installedReleases.length} active/retained Module artifact(s).`);
      }
      console.log(`Database backup written to ${databaseTarget}`);
      return;
    }

    const artifactRoot = join(resolveDataDirectory(sourcePath), 'modules');
    const realArtifactRoot = installedReleases.length ? realpathSync(artifactRoot) : artifactRoot;
    const artifacts = [];
    for (const release of installedReleases) {
      const sourceArtifact = resolve(release.artifact_path);
      if (!insideRoot(artifactRoot, sourceArtifact)) {
        throw new Error(`Installed Module ${release.module_id} points outside the Module artifact root.`);
      }
      if (!existsSync(sourceArtifact)) {
        throw new Error(`Installed Module ${release.module_id} is missing artifact ${release.digest}.`);
      }
      const realSourceArtifact = realpathSync(sourceArtifact);
      if (!insideRoot(realArtifactRoot, realSourceArtifact)) {
        throw new Error(`Installed Module ${release.module_id} resolves outside the Module artifact root.`);
      }
      assertNormalSourceTree(sourceArtifact);
      const relativeTarget = join('modules', release.module_id, release.digest);
      const targetArtifact = join(bundlePath, relativeTarget);
      cpSync(sourceArtifact, targetArtifact, { recursive: true, errorOnExist: true });
      artifacts.push({
        moduleId: release.module_id,
        version: release.version,
        digest: release.digest,
        state: release.state,
        path: relativeTarget.split('\\').join('/'),
        files: secureAndInventoryTree(targetArtifact),
      });
    }

    const manifest = {
      backupVersion: 2,
      createdAt: new Date().toISOString(),
      database: {
        path: 'nad.db',
        sha256: sha256File(databaseTarget),
        bytes: statSync(databaseTarget).size,
        migrationVersion: migrations.latest,
      },
      artifacts,
    };
    writeFileSync(join(bundlePath, 'backup-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log(`Backup bundle written to ${bundlePath}`);
    console.log(`Integrity check ok; schema migration version ${migrations.latest}; ${artifacts.length} active/retained Module artifact(s) included.`);
  } catch (error) {
    if (!dbOnly) rmSync(bundlePath, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
