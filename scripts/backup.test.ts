import Database from 'better-sqlite3';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@/lib/db/migrate';

const directories: string[] = [];

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nad-backup-test-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('db:backup script', () => {
  it('writes a verified backup of a live WAL database into the target directory', () => {
    const sourceDirectory = makeDirectory();
    const targetDirectory = makeDirectory();
    const sourcePath = join(sourceDirectory, 'nad.db');

    // Seed a realistic source database, including WAL mode as in production.
    const source = new Database(sourcePath);
    source.pragma('journal_mode = WAL');
    migrateDatabase(source);
    source
      .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('dashboard_name', 'Backup Test', '2026-08-06T00:00:00.000Z')")
      .run();
    source.close();

    execFileSync('node', ['scripts/backup.mjs', targetDirectory], {
      env: { ...process.env, DATABASE_URL: `file:${sourcePath}` },
      stdio: 'pipe',
    });

    const bundles = readdirSync(targetDirectory);
    expect(bundles).toHaveLength(1);
    const bundlePath = join(targetDirectory, bundles[0] as string);
    expect(statSync(bundlePath).mode & 0o777).toBe(0o700);
    expect(statSync(join(bundlePath, 'nad.db')).mode & 0o777).toBe(0o600);
    expect(statSync(join(bundlePath, 'backup-manifest.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(bundlePath).sort()).toEqual(['backup-manifest.json', 'nad.db']);

    const verification = JSON.parse(execFileSync('node', [
      'scripts/verify-backup.mjs', bundlePath,
    ], { encoding: 'utf8' }));
    expect(verification).toMatchObject({ status: 'ok', migrationVersion: 10 });
    expect(readdirSync(bundlePath).sort()).toEqual(['backup-manifest.json', 'nad.db']);

    const archive = new Database(join(bundlePath, 'nad.db'), { readonly: true });
    expect(archive.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(archive.prepare('SELECT MAX(version) AS latest FROM homedashboard_migrations').get())
      .toEqual({ latest: 10 });
    expect(archive.prepare("SELECT value FROM app_settings WHERE key = 'dashboard_name'").get())
      .toEqual({ value: 'Backup Test' });
    archive.close();
    expect(JSON.parse(readFileSync(join(bundlePath, 'backup-manifest.json'), 'utf8'))).toMatchObject({
      backupVersion: 2,
      database: { migrationVersion: 10, bytes: expect.any(Number) },
      artifacts: [],
    });
  });

  it('copies active and retained installed Module artifacts into the bundle', () => {
    const sourceDirectory = makeDirectory();
    const targetDirectory = makeDirectory();
    const sourcePath = join(sourceDirectory, 'nad.db');
    const activeDigest = 'a'.repeat(64);
    const retainedDigest = 'b'.repeat(64);
    const artifactPath = join(sourceDirectory, 'modules', 'dev.robrolabs.demo', activeDigest);
    const retainedArtifactPath = join(sourceDirectory, 'modules', 'dev.robrolabs.demo', retainedDigest);
    mkdirSync(artifactPath, { recursive: true });
    mkdirSync(retainedArtifactPath, { recursive: true });
    writeFileSync(join(artifactPath, 'manifest.json'), '{}');
    writeFileSync(join(retainedArtifactPath, 'manifest.json'), '{}');
    const source = new Database(sourcePath);
    migrateDatabase(source);
    source.prepare(`
      INSERT INTO installed_modules
        (module_id, slug, active_release_id, installed_at, updated_at)
      VALUES ('dev.robrolabs.demo', 'demo', 'release-1', 'now', 'now')
    `).run();
    source.prepare(`
      INSERT INTO module_releases
        (id, module_id, version, digest, artifact_path, manifest_json,
         ui_pages_json, ui_widgets_json, signature_status, state, installed_at)
      VALUES ('release-1', 'dev.robrolabs.demo', '1.0.0', ?, ?, '{}', '{}', '{}',
              'development', 'active', 'now')
    `).run(activeDigest, artifactPath);
    source.prepare(`
      INSERT INTO module_releases
        (id, module_id, version, digest, artifact_path, manifest_json,
         ui_pages_json, ui_widgets_json, signature_status, state, installed_at)
      VALUES ('release-0', 'dev.robrolabs.demo', '0.9.0', ?, ?, '{}', '{}', '{}',
              'development', 'retained', 'before')
    `).run(retainedDigest, retainedArtifactPath);
    source.close();

    execFileSync('node', ['scripts/backup.mjs', targetDirectory], {
      env: { ...process.env, DATABASE_URL: `file:${sourcePath}`, NAD_DATA_DIR: sourceDirectory },
      stdio: 'pipe',
    });
    const bundlePath = join(targetDirectory, readdirSync(targetDirectory)[0] as string);
    expect(existsSync(join(bundlePath, 'modules', 'dev.robrolabs.demo', activeDigest, 'manifest.json'))).toBe(true);
    expect(existsSync(join(bundlePath, 'modules', 'dev.robrolabs.demo', retainedDigest, 'manifest.json'))).toBe(true);
    const artifacts = JSON.parse(readFileSync(join(bundlePath, 'backup-manifest.json'), 'utf8')).artifacts;
    expect(artifacts).toHaveLength(2);
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ digest: activeDigest, state: 'active' }),
      expect.objectContaining({ digest: retainedDigest, state: 'retained' }),
    ]));
    expect(artifacts.every((artifact: { files?: unknown[] }) => artifact.files?.length === 1)).toBe(true);

    const verification = JSON.parse(execFileSync('node', [
      'scripts/verify-backup.mjs', bundlePath, '--disposable',
    ], { encoding: 'utf8' }));
    expect(verification).toMatchObject({
      status: 'ok',
      backupVersion: 2,
      migrationVersion: 10,
      artifacts: 2,
      artifactFiles: 2,
    });
  });

  it('rejects a backup whose artifact bytes changed after the manifest was written', () => {
    const sourceDirectory = makeDirectory();
    const targetDirectory = makeDirectory();
    const sourcePath = join(sourceDirectory, 'nad.db');
    const digest = 'a'.repeat(64);
    const artifactPath = join(sourceDirectory, 'modules', 'dev.robrolabs.demo', digest);
    mkdirSync(artifactPath, { recursive: true });
    writeFileSync(join(artifactPath, 'manifest.json'), '{}');
    const source = new Database(sourcePath);
    migrateDatabase(source);
    source.prepare(`
      INSERT INTO installed_modules (module_id, slug, active_release_id, installed_at, updated_at)
      VALUES ('dev.robrolabs.demo', 'demo', 'release-1', 'now', 'now')
    `).run();
    source.prepare(`
      INSERT INTO module_releases
        (id, module_id, version, digest, artifact_path, manifest_json,
         ui_pages_json, ui_widgets_json, signature_status, state, installed_at)
      VALUES ('release-1', 'dev.robrolabs.demo', '1.0.0', ?, ?, '{}', '{}', '{}',
              'development', 'active', 'now')
    `).run(digest, artifactPath);
    source.close();
    execFileSync('node', ['scripts/backup.mjs', targetDirectory], {
      env: { ...process.env, DATABASE_URL: `file:${sourcePath}`, NAD_DATA_DIR: sourceDirectory },
    });
    const bundlePath = join(targetDirectory, readdirSync(targetDirectory)[0] as string);
    writeFileSync(join(bundlePath, 'modules', 'dev.robrolabs.demo', digest, 'manifest.json'), '{"changed":true}');
    const verification = spawnSync('node', ['scripts/verify-backup.mjs', bundlePath], { encoding: 'utf8' });
    expect(verification.status).not.toBe(0);
    expect(verification.stderr).toContain('inventory does not match');
  });

  it('rejects files that are not listed in the complete bundle inventory', () => {
    const sourceDirectory = makeDirectory();
    const targetDirectory = makeDirectory();
    const sourcePath = join(sourceDirectory, 'nad.db');
    const source = new Database(sourcePath);
    migrateDatabase(source);
    source.close();
    execFileSync('node', ['scripts/backup.mjs', targetDirectory], {
      env: { ...process.env, DATABASE_URL: `file:${sourcePath}` },
    });
    const bundlePath = join(targetDirectory, readdirSync(targetDirectory)[0] as string);
    writeFileSync(join(bundlePath, 'unlisted.txt'), 'must not be restored');
    const verification = spawnSync('node', ['scripts/verify-backup.mjs', bundlePath], { encoding: 'utf8' });
    expect(verification.status).not.toBe(0);
    expect(verification.stderr).toContain('unlisted or missing file');
  });

  it('rejects links in an installed artifact instead of copying their targets', () => {
    const sourceDirectory = makeDirectory();
    const targetDirectory = makeDirectory();
    const sourcePath = join(sourceDirectory, 'nad.db');
    const digest = 'c'.repeat(64);
    const artifactPath = join(sourceDirectory, 'modules', 'dev.robrolabs.demo', digest);
    mkdirSync(artifactPath, { recursive: true });
    writeFileSync(join(sourceDirectory, 'outside.txt'), 'must not enter the backup');
    symlinkSync(join(sourceDirectory, 'outside.txt'), join(artifactPath, 'linked-secret'));
    const source = new Database(sourcePath);
    migrateDatabase(source);
    source.prepare(`
      INSERT INTO installed_modules (module_id, slug, active_release_id, installed_at, updated_at)
      VALUES ('dev.robrolabs.demo', 'demo', 'release-1', 'now', 'now')
    `).run();
    source.prepare(`
      INSERT INTO module_releases
        (id, module_id, version, digest, artifact_path, manifest_json,
         ui_pages_json, ui_widgets_json, signature_status, state, installed_at)
      VALUES ('release-1', 'dev.robrolabs.demo', '1.0.0', ?, ?, '{}', '{}', '{}',
              'development', 'active', 'now')
    `).run(digest, artifactPath);
    source.close();

    const backup = spawnSync('node', ['scripts/backup.mjs', targetDirectory], {
      env: { ...process.env, DATABASE_URL: `file:${sourcePath}`, NAD_DATA_DIR: sourceDirectory },
      encoding: 'utf8',
    });
    expect(backup.status).not.toBe(0);
    expect(backup.stderr).toContain('unsupported file type');
    expect(readdirSync(targetDirectory)).toEqual([]);
  });

  it('rotates only complete NAD bundles after a disposable restore verification', () => {
    const sourceDirectory = makeDirectory();
    const targetDirectory = makeDirectory();
    const sourcePath = join(sourceDirectory, 'nad.db');
    const source = new Database(sourcePath);
    migrateDatabase(source);
    source.close();
    for (let index = 0; index < 3; index += 1) {
      execFileSync('node', ['scripts/backup-maintenance.mjs'], {
        env: {
          ...process.env,
          DATABASE_URL: `file:${sourcePath}`,
          NAD_DATA_DIR: sourceDirectory,
          NAD_BACKUP_DIRECTORY: targetDirectory,
          NAD_BACKUP_RETENTION_COUNT: '2',
        },
      });
    }
    expect(readdirSync(targetDirectory).filter((name) => name.startsWith('nad-'))).toHaveLength(2);
  });

  it('fails clearly when the source database does not exist', () => {
    const missingPath = join(makeDirectory(), 'missing.db');
    expect(() => execFileSync('node', ['scripts/backup.mjs', makeDirectory()], {
      env: { ...process.env, DATABASE_URL: `file:${missingPath}` },
      stdio: 'pipe',
    })).toThrow();
  });
});

describe('admin:recover script', () => {
  it('resets only an existing administrator, invalidates sessions, and records an offline audit event', async () => {
    const sourceDirectory = makeDirectory();
    const sourcePath = join(sourceDirectory, 'nad.db');
    const source = new Database(sourcePath);
    migrateDatabase(source);
    source.prepare(`
      INSERT INTO users (id, email, name, password_hash, auth_version, role, created_at, updated_at)
      VALUES ('admin-1', 'admin@example.test', 'Admin', 'old-hash', 3, 'admin', 'now', 'now')
    `).run();
    source.close();
    const recovery = spawnSync('node', [
      'scripts/admin-recover.mjs', '--email', 'ADMIN@example.test', '--password-stdin', '--confirm-offline',
    ], {
      input: 'replacement-password\n',
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: `file:${sourcePath}` },
    });
    expect(recovery.status).toBe(0);
    const checked = new Database(sourcePath, { readonly: true });
    const user = checked.prepare('SELECT password_hash, auth_version FROM users WHERE id = ?').get('admin-1') as {
      password_hash: string;
      auth_version: number;
    };
    const audit = checked.prepare("SELECT user_id, action, details FROM audit_log WHERE action = 'emergency_admin_recovery'").get() as {
      user_id: string | null;
      action: string;
      details: string;
    };
    checked.close();
    expect(user.auth_version).toBe(4);
    expect(user.password_hash).not.toBe('old-hash');
    expect(audit).toMatchObject({ user_id: null, action: 'emergency_admin_recovery' });
    expect(audit.details).not.toContain('replacement-password');
  });

  it('refuses recovery without the explicit offline acknowledgement', () => {
    const result = spawnSync('node', ['scripts/admin-recover.mjs', '--email', 'admin@example.test', '--password-stdin'], {
      input: 'replacement-password\n',
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--confirm-offline');
  });
});
