import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import yazl from 'yazl';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSignatureEnvelope } from '@/lib/modules/installed/package-verifier';

const directory = mkdtempSync(join(tmpdir(), 'nad-installed-lifecycle-'));
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
process.env.NAD_DATA_DIR = directory;
process.env.APP_SECRET = 'installed-lifecycle-test-secret-00000001';
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type Lifecycle = typeof import('@/lib/modules/installed/lifecycle');
type Provider = typeof import('@/lib/modules/installed/provider');
type Config = typeof import('@/lib/modules/config');
type Db = typeof import('@/lib/db');
type Verifier = typeof import('@/lib/modules/installed/package-verifier');
type InvocationGuard = typeof import('@/lib/modules/installed/invocation-guard');
let lifecycle: Lifecycle;
let provider: Provider;
let config: Config;
let database: Db;
let verifier: Verifier;
let invocationGuard: InvocationGuard;

const keyPair = generateKeyPairSync('ed25519');
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

beforeAll(async () => {
  database = await import('@/lib/db');
  lifecycle = await import('@/lib/modules/installed/lifecycle');
  provider = await import('@/lib/modules/installed/provider');
  config = await import('@/lib/modules/config');
  verifier = await import('@/lib/modules/installed/package-verifier');
  invocationGuard = await import('@/lib/modules/installed/invocation-guard');
  database.rawDb.prepare(`
    INSERT INTO users
      (id, email, name, password_hash, role, created_at, updated_at)
    VALUES ('admin', 'admin@example.test', 'Admin', 'hash', 'admin', 'now', 'now')
  `).run();
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

async function zip(files: Record<string, Buffer>): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const [path, contents] of Object.entries(files)) {
    archive.addBuffer(contents, path, { mtime: new Date('1980-01-01T00:00:00.000Z'), mode: 0o100644 });
  }
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
  archive.outputStream.pipe(output);
  archive.end();
  return complete;
}

async function signedPackage(version: string, manifestOverrides: Record<string, unknown> = {}): Promise<Buffer> {
  const manifest = {
    schemaVersion: 1,
    id: 'dev.robrolabs.status-demo',
    slug: 'status-demo',
    name: 'Status Demo',
    description: 'Lifecycle contract fixture.',
    icon: 'activity',
    category: 'monitoring',
    publisher: 'Robro Labs',
    compatibility: { core: '>=0.2.0 <1.0.0', hostApi: '1.x', uiApi: '1.x' },
    capabilities: [{ name: 'config.get', reason: 'Read fixture configuration.' }],
    permissions: [{ action: 'view', label: 'View', risk: 'read', description: 'View status.' }],
    configSchema: [],
    entrypoints: {
      summary: {
        method: 'GET', kind: 'query', permission: 'view', handler: 'summary',
        requestSchema: 'schemas/endpoints/summary-input.json',
        responseSchema: 'schemas/endpoints/summary-output.json',
        timeoutClass: 'short', maxRequestBytes: 1024, maxResponseBytes: 65536,
      },
    },
    ...manifestOverrides,
    version,
  };
  const payload: Record<string, Buffer> = {
    'manifest.json': Buffer.from(JSON.stringify(manifest)),
    'server/main.js': Buffer.from('export async function summary() { return { status: "ok" }; }'),
    'ui/pages.json': Buffer.from(JSON.stringify({
      schemaVersion: 1,
      pages: [{ path: '/', title: 'Status', source: { endpoint: 'summary' }, body: [{ type: 'status', label: 'State', valuePath: 'status' }] }],
    })),
    'ui/widgets.json': Buffer.from(JSON.stringify({
      schemaVersion: 1,
      widgets: [{ id: 'summary', name: 'Summary', description: 'Current status.', defaultSize: { w: 4, h: 3 }, source: { endpoint: 'summary' }, body: [{ type: 'status', label: 'State', valuePath: 'status' }] }],
    })),
    'schemas/config.json': Buffer.from('{"type":"object"}'),
    'schemas/endpoints/summary-input.json': Buffer.from('{"type":"object","additionalProperties":false}'),
    'schemas/endpoints/summary-output.json': Buffer.from('{"type":"object","required":["status"],"properties":{"status":{"type":"string"}},"additionalProperties":false}'),
    'README.md': Buffer.from('# Status Demo\n'),
    'LICENSE': Buffer.from('AGPL-3.0-only\n'),
    'assets/icon.png': Buffer.from('fixture-icon'),
  };
  const checksums = { schemaVersion: 1 as const, algorithm: 'sha256' as const, files: Object.fromEntries(Object.entries(payload).map(([path, contents]) => [
    path,
    createHash('sha256').update(contents).digest('hex'),
  ])) };
  const signature = sign(null, createSignatureEnvelope(manifest.id, version, checksums), keyPair.privateKey).toString('base64');
  return zip({
    ...payload,
    'checksums.json': Buffer.from(JSON.stringify(checksums)),
    'signature.json': Buffer.from(JSON.stringify({
      schemaVersion: 1,
      mode: 'signed',
      algorithm: 'Ed25519',
      keyId: 'lifecycle-test',
      signature,
      signedPayload: {
        moduleId: manifest.id,
        version,
        digestAlgorithm: 'sha256',
        files: checksums.files,
      },
    })),
  });
}

interface ActivePointerRow {
  active_release_id: string;
  active_config_generation_id: string;
  active_kv_generation_id: string;
}

function activeDataPointers(): ActivePointerRow {
  return database.rawDb.prepare(`
    SELECT active_release_id, active_config_generation_id, active_kv_generation_id
    FROM installed_modules
    WHERE module_id = 'dev.robrolabs.status-demo'
  `).get() as ActivePointerRow;
}

function releaseDataPointers(releaseId: string): {
  state: string;
  config_generation_id: string | null;
  kv_generation_id: string | null;
} {
  return database.rawDb.prepare(`
    SELECT state, config_generation_id, kv_generation_id
    FROM module_releases
    WHERE id = ?
  `).get(releaseId) as {
    state: string;
    config_generation_id: string | null;
    kv_generation_id: string | null;
  };
}

function setKvEntries(generationId: string, entries: Record<string, unknown>): void {
  database.rawDb.transaction(() => {
    database.rawDb.prepare('DELETE FROM module_kv_entries WHERE generation_id = ?').run(generationId);
    const insert = database.rawDb.prepare(`
      INSERT INTO module_kv_entries (id, generation_id, key, value_json, byte_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    let totalBytes = 0;
    for (const [key, value] of Object.entries(entries)) {
      const valueJson = JSON.stringify(value);
      if (valueJson === undefined) throw new Error(`Fixture value ${key} is not JSON serialisable.`);
      const byteCount = Buffer.byteLength(valueJson, 'utf8');
      totalBytes += byteCount;
      insert.run(`kv-${generationId}-${key}`, generationId, key, valueJson, byteCount);
    }
    database.rawDb.prepare('UPDATE module_kv_generations SET byte_count = ? WHERE id = ?')
      .run(totalBytes, generationId);
  }).immediate();
}

function kvEntries(generationId: string): Record<string, unknown> {
  const rows = database.rawDb.prepare(`
    SELECT key, value_json
    FROM module_kv_entries
    WHERE generation_id = ?
    ORDER BY key
  `).all(generationId) as Array<{ key: string; value_json: string }>;
  return Object.fromEntries(rows.map(({ key, value_json }) => [key, JSON.parse(value_json) as unknown]));
}

describe('installed Module lifecycle', () => {
  it('activates a verified release without restart and preserves identity through update', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const firstArchive = await signedPackage('1.0.0');
    const firstVerified = await verifier.verifyModulePackage(firstArchive, verifierOptions);
    const first = await lifecycle.installModulePackage(firstArchive, 'admin', {
      expectedDigest: firstVerified.digest,
    }, verifierOptions);
    expect(first.enabled).toBe(false);
    expect(provider.getInstalledModule('status-demo')).toMatchObject({
      moduleId: 'dev.robrolabs.status-demo',
      grantedCapabilities: ['config.get'],
      manifest: { version: '1.0.0', source: 'installed' },
    });

    await lifecycle.setInstalledModuleEnabled('status-demo', true, 'admin');
    expect(await config.isModuleEnabled('status-demo')).toBe(true);

    const updateArchive = await signedPackage('1.0.1');
    const updateVerified = await verifier.verifyModulePackage(updateArchive, verifierOptions);
    const update = await lifecycle.installModulePackage(updateArchive, 'admin', {
      expectedDigest: updateVerified.digest,
    }, verifierOptions);
    expect(update.replacedReleaseId).toBe(first.releaseId);
    expect(update.enabled).toBe(true);
    expect(provider.getInstalledModule('status-demo')?.manifest.version).toBe('1.0.1');
    expect(database.rawDb.prepare("SELECT state FROM module_releases WHERE id = ?").get(first.releaseId))
      .toEqual({ state: 'retained' });
  });

  it('rejects activation when the package digest differs from approval', async () => {
    await expect(lifecycle.installModulePackage(await signedPackage('1.0.2'), 'admin', {
      expectedDigest: '0'.repeat(64),
    }, {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    })).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' });
  });

  it('serializes concurrent activation attempts and records the losing operation', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const archive = await signedPackage('1.1.0');
    const verified = await verifier.verifyModulePackage(archive, verifierOptions);
    const results = await Promise.allSettled([
      lifecycle.installModulePackage(archive, 'admin', { expectedDigest: verified.digest }, verifierOptions),
      lifecycle.installModulePackage(archive, 'admin', { expectedDigest: verified.digest }, verifierOptions),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(provider.getInstalledModule('status-demo')?.manifest.version).toBe('1.1.0');
    const operations = database.rawDb.prepare(`
      SELECT outcome, error_code FROM module_operations
      WHERE module_id = 'dev.robrolabs.status-demo' AND release_id IS NOT NULL
      ORDER BY created_at DESC
    `).all() as Array<{ outcome: string; error_code: string | null }>;
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'succeeded', error_code: null }),
    ]));
    // The verifier and artifact preparation happen before the lifecycle lock.
    // Depending on scheduling, the loser either observes the held lock or the
    // exact version committed by the winner. Both are safe serialized results.
    expect(operations.some(({ outcome, error_code: errorCode }) => (
      outcome === 'failed'
      && (errorCode === 'MODULE_BUSY' || errorCode === 'VERSION_ALREADY_INSTALLED')
    ))).toBe(true);
  });

  it('rolls back explicitly to a retained release without changing config or storage generations', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const firstArchive = await signedPackage('2.0.0');
    const firstVerified = await verifier.verifyModulePackage(firstArchive, verifierOptions);
    const first = await lifecycle.installModulePackage(firstArchive, 'admin', {
      expectedDigest: firstVerified.digest,
    }, verifierOptions);
    await lifecycle.setInstalledModuleEnabled('status-demo', true, 'admin');
    const beforeUpdatePointers = database.rawDb.prepare(`
      SELECT active_config_generation_id, active_kv_generation_id
      FROM installed_modules
      WHERE module_id = ?
    `).get(first.moduleId);

    const updateArchive = await signedPackage('2.0.1');
    const updateVerified = await verifier.verifyModulePackage(updateArchive, verifierOptions);
    const update = await lifecycle.installModulePackage(updateArchive, 'admin', {
      expectedDigest: updateVerified.digest,
    }, verifierOptions);
    expect(provider.getInstalledModule('status-demo')?.manifest.version).toBe('2.0.1');

    const rollback = await lifecycle.rollbackModuleRelease('status-demo', 'admin', { targetReleaseId: first.releaseId });
    expect(rollback).toMatchObject({
      replacedReleaseId: update.releaseId,
      releaseId: first.releaseId,
      enabled: true,
    });
    expect(provider.getInstalledModule('status-demo')?.manifest.version).toBe('2.0.0');
    expect(database.rawDb.prepare("SELECT state FROM module_releases WHERE id = ?").get(first.releaseId))
      .toEqual({ state: 'active' });
    expect(database.rawDb.prepare("SELECT state FROM module_releases WHERE id = ?").get(update.releaseId))
      .toEqual({ state: 'retained' });
    expect(database.rawDb.prepare(`
      SELECT active_config_generation_id, active_kv_generation_id
      FROM installed_modules
      WHERE module_id = ?
    `).get(first.moduleId)).toEqual(beforeUpdatePointers);
  });

  it('blocks release activation while a mutation is in flight', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const firstArchive = await signedPackage('3.0.0');
    const firstVerified = await verifier.verifyModulePackage(firstArchive, verifierOptions);
    const first = await lifecycle.installModulePackage(firstArchive, 'admin', {
      expectedDigest: firstVerified.digest,
    }, verifierOptions);
    const endMutation = invocationGuard.beginModuleInvocation(first.moduleId, first.releaseId, 'mutation');
    try {
      const updateArchive = await signedPackage('3.0.1');
      const updateVerified = await verifier.verifyModulePackage(updateArchive, verifierOptions);
      await expect(lifecycle.installModulePackage(updateArchive, 'admin', {
        expectedDigest: updateVerified.digest,
      }, verifierOptions)).rejects.toMatchObject({ code: 'MODULE_MUTATION_IN_FLIGHT' });
    } finally {
      endMutation();
    }

    const retryArchive = await signedPackage('3.0.1');
    const retryVerified = await verifier.verifyModulePackage(retryArchive, verifierOptions);
    await expect(lifecycle.installModulePackage(retryArchive, 'admin', {
      expectedDigest: retryVerified.digest,
    }, verifierOptions)).resolves.toMatchObject({ replacedReleaseId: first.releaseId });
  });

  it('disables and uninstalls with explicit retention, then restores a retained release', async () => {
    await config.setModuleConfigValue('status-demo', 'fixture', 'retained-value', false, 'admin');
    const before = database.rawDb.prepare(`
      SELECT active_release_id, active_config_generation_id, active_kv_generation_id
      FROM installed_modules WHERE module_id = 'dev.robrolabs.status-demo'
    `).get() as {
      active_release_id: string;
      active_config_generation_id: string;
      active_kv_generation_id: string;
    };

    await expect(lifecycle.setInstalledModuleEnabled('status-demo', false, 'admin'))
      .resolves.toMatchObject({ enabled: false, changed: true });
    expect(await config.isModuleEnabled('status-demo')).toBe(false);

    const uninstall = await lifecycle.uninstallModule('status-demo', 'admin', {
      configAndStorage: 'retain',
      artifacts: 'retain',
    });
    expect(uninstall).toMatchObject({ configAndStorage: 'retain', artifacts: 'retain' });
    expect(uninstall.retainedArtifacts).toBeGreaterThan(0);
    expect(provider.getInstalledModule('status-demo')).toBeUndefined();
    expect(database.rawDb.prepare(`
      SELECT lifecycle_state, active_release_id, active_config_generation_id, active_kv_generation_id
      FROM installed_modules WHERE module_id = 'dev.robrolabs.status-demo'
    `).get()).toEqual({
      lifecycle_state: 'uninstalled',
      active_release_id: null,
      active_config_generation_id: before.active_config_generation_id,
      active_kv_generation_id: before.active_kv_generation_id,
    });
    expect(releaseDataPointers(before.active_release_id)).toMatchObject({
      state: 'retained',
      config_generation_id: before.active_config_generation_id,
      kv_generation_id: before.active_kv_generation_id,
    });
    expect(await config.getModuleConfig('status-demo')).toEqual({ fixture: 'retained-value' });

    const retainedArchive = await signedPackage('3.0.1');
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const retainedVerified = await verifier.verifyModulePackage(retainedArchive, verifierOptions);
    const restored = await lifecycle.installModulePackage(retainedArchive, 'admin', {
      expectedDigest: retainedVerified.digest,
    }, verifierOptions);
    expect(restored).toMatchObject({ releaseId: before.active_release_id, enabled: false });
    expect(provider.getInstalledModule('status-demo')?.releaseId).toBe(before.active_release_id);
    await lifecycle.setInstalledModuleEnabled('status-demo', true, 'admin');
    expect(await config.isModuleEnabled('status-demo')).toBe(true);
  });

  it('prunes old retained artifacts and permanently removes selected data during uninstall', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const archive = await signedPackage('4.0.0');
    const verified = await verifier.verifyModulePackage(archive, verifierOptions);
    await lifecycle.installModulePackage(archive, 'admin', { expectedDigest: verified.digest }, verifierOptions);

    const retainedBeforePrune = lifecycle.listModuleReleases('status-demo').filter(({ state }) => state === 'retained');
    const pinnedRetained = retainedBeforePrune.at(-1);
    if (!pinnedRetained) throw new Error('Expected a retained release fixture.');
    const endRetainedQuery = invocationGuard.beginModuleInvocation(
      pinnedRetained.moduleId,
      pinnedRetained.releaseId,
      'query',
    );
    try {
      await expect(lifecycle.pruneModuleArtifacts('status-demo', 'admin', { keepRetainedReleases: 1 }))
        .rejects.toMatchObject({ code: 'MODULE_RELEASE_IN_FLIGHT' });
    } finally {
      endRetainedQuery();
    }

    const prune = await lifecycle.pruneModuleArtifacts('status-demo', 'admin', { keepRetainedReleases: 1 });
    expect(prune.retainedArtifacts).toBe(1);
    expect(prune.prunedArtifacts).toBeGreaterThan(0);
    expect(lifecycle.listModuleReleases('status-demo').filter(({ state }) => state === 'retained')).toHaveLength(1);

    const activeArtifact = database.rawDb.prepare(`
      SELECT module_releases.artifact_path
      FROM module_releases
      JOIN installed_modules ON installed_modules.active_release_id = module_releases.id
      WHERE installed_modules.slug = 'status-demo'
    `).get() as { artifact_path: string };
    expect(existsSync(activeArtifact.artifact_path)).toBe(true);

    const activeDefinition = provider.getInstalledModule('status-demo');
    if (!activeDefinition) throw new Error('Expected an active release fixture.');
    const endActiveQuery = invocationGuard.beginModuleInvocation(
      activeDefinition.moduleId,
      activeDefinition.releaseId,
      'query',
    );
    try {
      await expect(lifecycle.uninstallModule('status-demo', 'admin', {
        configAndStorage: 'delete',
        artifacts: 'delete',
      })).rejects.toMatchObject({ code: 'MODULE_INVOCATION_IN_FLIGHT' });
      expect(existsSync(activeArtifact.artifact_path)).toBe(true);
      expect(await config.getModuleConfig('status-demo')).toEqual({ fixture: 'retained-value' });
    } finally {
      endActiveQuery();
    }

    database.rawDb.prepare(`
      UPDATE module_releases SET artifact_path = '/unexpected/artifact-path' WHERE id = ?
    `).run(activeDefinition.releaseId);
    await expect(lifecycle.uninstallModule('status-demo', 'admin', {
      configAndStorage: 'delete',
      artifacts: 'delete',
    })).rejects.toThrow('unexpected Module artifact path');
    expect(provider.getInstalledModule('status-demo')?.releaseId).toBe(activeDefinition.releaseId);
    expect(await config.getModuleConfig('status-demo')).toEqual({ fixture: 'retained-value' });
    expect(existsSync(activeArtifact.artifact_path)).toBe(true);
    database.rawDb.prepare(`
      UPDATE module_releases SET artifact_path = ? WHERE id = ?
    `).run(activeArtifact.artifact_path, activeDefinition.releaseId);

    const uninstall = await lifecycle.uninstallModule('status-demo', 'admin', {
      configAndStorage: 'delete',
      artifacts: 'delete',
    });
    expect(uninstall.prunedArtifacts).toBeGreaterThan(0);
    expect(existsSync(activeArtifact.artifact_path)).toBe(false);
    expect(await config.getModuleConfig('status-demo')).toEqual({});
    expect(database.rawDb.prepare(`
      SELECT active_release_id, active_config_generation_id, active_kv_generation_id,
             active_grant_generation_id, enabled, lifecycle_state
      FROM installed_modules WHERE slug = 'status-demo'
    `).get()).toEqual({
      active_release_id: null,
      active_config_generation_id: null,
      active_kv_generation_id: null,
      active_grant_generation_id: null,
      enabled: 0,
      lifecycle_state: 'uninstalled',
    });
  });

  it('applies an exact declarative data migration and rollback restores the retained generation snapshot', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const firstArchive = await signedPackage('5.0.0', {
      configSchema: [
        { key: 'old_host', label: 'Old host', type: 'text', required: false },
        { key: 'remove_me', label: 'Removed', type: 'text', required: false },
      ],
    });
    const firstVerified = await verifier.verifyModulePackage(firstArchive, verifierOptions);
    const first = await lifecycle.installModulePackage(firstArchive, 'admin', {
      expectedDigest: firstVerified.digest,
    }, verifierOptions);
    await config.setModuleConfigValue('status-demo', 'old_host', 'legacy-host', false, 'admin');
    await config.setModuleConfigValue('status-demo', 'remove_me', 'unused', false, 'admin');
    const before = activeDataPointers();
    setKvEntries(before.active_kv_generation_id, {
      'cache.old': { status: 'old' },
      'cache.drop': 'delete-me',
    });

    const updateArchive = await signedPackage('5.0.1', {
      configSchema: [
        { key: 'host', label: 'Host', type: 'text', required: false },
        { key: 'interval', label: 'Interval', type: 'number', required: false, min: 1, max: 60 },
      ],
      dataMigrations: [{
        fromVersion: '5.0.0',
        toVersion: '5.0.1',
        config: [
          { op: 'rename', from: 'old_host', to: 'host' },
          { op: 'setDefault', key: 'interval', value: 30 },
          { op: 'delete', key: 'remove_me' },
        ],
        storage: [
          { op: 'rename', from: 'cache.old', to: 'cache.new' },
          { op: 'setDefault', key: 'cache.default', value: { enabled: true } },
          { op: 'delete', key: 'cache.drop' },
        ],
      }],
    });
    const updateVerified = await verifier.verifyModulePackage(updateArchive, verifierOptions);
    const update = await lifecycle.installModulePackage(updateArchive, 'admin', {
      expectedDigest: updateVerified.digest,
    }, verifierOptions);
    const migrated = activeDataPointers();

    expect(migrated.active_release_id).toBe(update.releaseId);
    expect(migrated.active_config_generation_id).not.toBe(before.active_config_generation_id);
    expect(migrated.active_kv_generation_id).not.toBe(before.active_kv_generation_id);
    expect(releaseDataPointers(first.releaseId)).toMatchObject({
      state: 'retained',
      config_generation_id: before.active_config_generation_id,
      kv_generation_id: before.active_kv_generation_id,
    });
    expect(releaseDataPointers(update.releaseId)).toMatchObject({
      state: 'active',
      config_generation_id: migrated.active_config_generation_id,
      kv_generation_id: migrated.active_kv_generation_id,
    });
    expect(await config.getModuleConfig('status-demo')).toEqual({
      host: 'legacy-host',
      interval: '30',
    });
    const migratedConfig = database.rawDb.prepare(`
      SELECT encrypted_values_json, parent_generation_id
      FROM module_config_generations
      WHERE id = ?
    `).get(migrated.active_config_generation_id) as {
      encrypted_values_json: string;
      parent_generation_id: string;
    };
    expect(migratedConfig.parent_generation_id).toBe(before.active_config_generation_id);
    const migratedValues = JSON.parse(migratedConfig.encrypted_values_json) as Record<string, {
      value: string;
      encrypted: boolean;
      isSecret: boolean;
    }>;
    expect(migratedValues.interval).toMatchObject({ encrypted: true, isSecret: false });
    expect(migratedValues.interval.value).not.toBe('30');
    expect(database.rawDb.prepare(`
      SELECT parent_generation_id
      FROM module_kv_generations
      WHERE id = ?
    `).get(migrated.active_kv_generation_id)).toEqual({ parent_generation_id: before.active_kv_generation_id });
    expect(kvEntries(migrated.active_kv_generation_id)).toEqual({
      'cache.default': { enabled: true },
      'cache.new': { status: 'old' },
    });

    await expect(lifecycle.rollbackModuleRelease('status-demo', 'admin', { targetReleaseId: first.releaseId }))
      .resolves.toMatchObject({ releaseId: first.releaseId, replacedReleaseId: update.releaseId });
    const rolledBack = activeDataPointers();
    expect(rolledBack).toEqual({
      active_release_id: first.releaseId,
      active_config_generation_id: before.active_config_generation_id,
      active_kv_generation_id: before.active_kv_generation_id,
    });
    expect(releaseDataPointers(update.releaseId)).toMatchObject({
      state: 'retained',
      config_generation_id: migrated.active_config_generation_id,
      kv_generation_id: migrated.active_kv_generation_id,
    });
    expect(await config.getModuleConfig('status-demo')).toEqual({
      old_host: 'legacy-host',
      remove_me: 'unused',
    });
    expect(kvEntries(rolledBack.active_kv_generation_id)).toEqual({
      'cache.drop': 'delete-me',
      'cache.old': { status: 'old' },
    });
  });

  it('rolls back transaction-created generations when a declarative data migration fails', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const archive = await signedPackage('5.1.0', {
      configSchema: [{ key: 'host', label: 'Host', type: 'text', required: false }],
    });
    const verified = await verifier.verifyModulePackage(archive, verifierOptions);
    await lifecycle.installModulePackage(archive, 'admin', { expectedDigest: verified.digest }, verifierOptions);
    await config.setModuleConfigValue('status-demo', 'host', 'stable-host', false, 'admin');
    const before = activeDataPointers();
    setKvEntries(before.active_kv_generation_id, { stable: true });
    const configGenerationsBefore = database.rawDb.prepare('SELECT COUNT(*) AS count FROM module_config_generations').get();
    const kvGenerationsBefore = database.rawDb.prepare('SELECT COUNT(*) AS count FROM module_kv_generations').get();
    const oversizedStorageDefault = randomBytes(50 * 1024).toString('base64');

    const badArchive = await signedPackage('5.1.1', {
      configSchema: [
        { key: 'host', label: 'Host', type: 'text', required: false },
        { key: 'interval', label: 'Interval', type: 'number', required: false },
      ],
      dataMigrations: [{
        fromVersion: '5.1.0',
        toVersion: '5.1.1',
        config: [{ op: 'setDefault', key: 'interval', value: 15 }],
        storage: [{ op: 'setDefault', key: 'oversized', value: oversizedStorageDefault }],
      }],
    });
    const badVerified = await verifier.verifyModulePackage(badArchive, verifierOptions);
    await expect(lifecycle.installModulePackage(badArchive, 'admin', {
      expectedDigest: badVerified.digest,
    }, verifierOptions)).rejects.toMatchObject({ code: 'DATA_MIGRATION_FAILED' });

    expect(activeDataPointers()).toEqual(before);
    expect(provider.getInstalledModule('status-demo')?.manifest.version).toBe('5.1.0');
    expect(await config.getModuleConfig('status-demo')).toMatchObject({ host: 'stable-host' });
    expect(kvEntries(before.active_kv_generation_id)).toEqual({ stable: true });
    expect(database.rawDb.prepare('SELECT COUNT(*) AS count FROM module_config_generations').get())
      .toEqual(configGenerationsBefore);
    expect(database.rawDb.prepare('SELECT COUNT(*) AS count FROM module_kv_generations').get())
      .toEqual(kvGenerationsBefore);
    expect(database.rawDb.prepare(`
      SELECT id FROM module_releases
      WHERE module_id = 'dev.robrolabs.status-demo' AND version = '5.1.1'
    `).get()).toBeUndefined();
    expect(database.rawDb.prepare(`
      SELECT outcome, error_code
      FROM module_operations
      WHERE module_id = 'dev.robrolabs.status-demo'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get()).toEqual({ outcome: 'failed', error_code: 'DATA_MIGRATION_FAILED' });
  });

  it('reuses config and storage generations when no exact data migration matches', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const archive = await signedPackage('5.2.0', {
      configSchema: [{ key: 'host', label: 'Host', type: 'text', required: false }],
    });
    const verified = await verifier.verifyModulePackage(archive, verifierOptions);
    const base = await lifecycle.installModulePackage(archive, 'admin', { expectedDigest: verified.digest }, verifierOptions);
    await config.setModuleConfigValue('status-demo', 'host', 'reuse-host', false, 'admin');
    const before = activeDataPointers();
    setKvEntries(before.active_kv_generation_id, { retained: { count: 1 } });

    const updateArchive = await signedPackage('5.2.1', {
      configSchema: [{ key: 'host', label: 'Host', type: 'text', required: false }],
    });
    const updateVerified = await verifier.verifyModulePackage(updateArchive, verifierOptions);
    const update = await lifecycle.installModulePackage(updateArchive, 'admin', {
      expectedDigest: updateVerified.digest,
    }, verifierOptions);
    const after = activeDataPointers();

    expect(after).toEqual({
      active_release_id: update.releaseId,
      active_config_generation_id: before.active_config_generation_id,
      active_kv_generation_id: before.active_kv_generation_id,
    });
    expect(releaseDataPointers(base.releaseId)).toMatchObject({
      state: 'retained',
      config_generation_id: before.active_config_generation_id,
      kv_generation_id: before.active_kv_generation_id,
    });
    expect(releaseDataPointers(update.releaseId)).toMatchObject({
      state: 'active',
      config_generation_id: before.active_config_generation_id,
      kv_generation_id: before.active_kv_generation_id,
    });
    expect(await config.getModuleConfig('status-demo')).toMatchObject({ host: 'reuse-host' });
    expect(kvEntries(after.active_kv_generation_id)).toEqual({ retained: { count: 1 } });
  });

  it('rejects invalid unused data migration routes before activation', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const archive = await signedPackage('5.3.0', {
      configSchema: [{ key: 'host', label: 'Host', type: 'text', required: false }],
    });
    const verified = await verifier.verifyModulePackage(archive, verifierOptions);
    const base = await lifecycle.installModulePackage(archive, 'admin', { expectedDigest: verified.digest }, verifierOptions);
    const before = activeDataPointers();

    const wrongTargetArchive = await signedPackage('5.3.1', {
      configSchema: [{ key: 'host', label: 'Host', type: 'text', required: false }],
      dataMigrations: [{
        fromVersion: '0.1.0',
        toVersion: '9.9.9',
        config: [{ op: 'delete', key: 'legacy' }],
      }],
    });
    const wrongTargetVerified = await verifier.verifyModulePackage(wrongTargetArchive, verifierOptions);
    await expect(lifecycle.installModulePackage(wrongTargetArchive, 'admin', {
      expectedDigest: wrongTargetVerified.digest,
    }, verifierOptions)).rejects.toMatchObject({ code: 'DATA_MIGRATION_FAILED' });

    const duplicateRouteArchive = await signedPackage('5.3.1', {
      configSchema: [{ key: 'host', label: 'Host', type: 'text', required: false }],
      dataMigrations: [
        {
          fromVersion: '0.1.0',
          toVersion: '5.3.1',
          config: [{ op: 'delete', key: 'legacy_one' }],
        },
        {
          fromVersion: '0.1.0',
          toVersion: '5.3.1',
          config: [{ op: 'delete', key: 'legacy_two' }],
        },
      ],
    });
    const duplicateRouteVerified = await verifier.verifyModulePackage(duplicateRouteArchive, verifierOptions);
    await expect(lifecycle.installModulePackage(duplicateRouteArchive, 'admin', {
      expectedDigest: duplicateRouteVerified.digest,
    }, verifierOptions)).rejects.toMatchObject({ code: 'DATA_MIGRATION_FAILED' });

    expect(activeDataPointers()).toEqual(before);
    expect(provider.getInstalledModule('status-demo')?.manifest.version).toBe('5.3.0');
    expect(releaseDataPointers(base.releaseId)).toMatchObject({
      state: 'active',
      config_generation_id: before.active_config_generation_id,
      kv_generation_id: before.active_kv_generation_id,
    });
    expect(database.rawDb.prepare(`
      SELECT id FROM module_releases
      WHERE module_id = 'dev.robrolabs.status-demo' AND version = '5.3.1'
    `).get()).toBeUndefined();
  });

  it('keeps destructive uninstall committed when post-commit artifact cleanup cannot complete', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const archive = await signedPackage('5.4.0');
    const verified = await verifier.verifyModulePackage(archive, verifierOptions);
    const installed = await lifecycle.installModulePackage(archive, 'admin', { expectedDigest: verified.digest }, verifierOptions);
    const activeArtifact = database.rawDb.prepare(`
      SELECT artifact_path
      FROM module_releases
      WHERE id = ?
    `).get(installed.releaseId) as { artifact_path: string };
    const artifactParent = dirname(activeArtifact.artifact_path);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      chmodSync(artifactParent, 0o500);
      const uninstall = await lifecycle.uninstallModule('status-demo', 'admin', {
        configAndStorage: 'delete',
        artifacts: 'delete',
      });

      expect(uninstall).toMatchObject({
        configAndStorage: 'delete',
        artifacts: 'delete',
        prunedArtifacts: expect.any(Number),
      });
      expect(database.rawDb.prepare(`
        SELECT active_release_id, active_config_generation_id, active_kv_generation_id,
               active_grant_generation_id, enabled, lifecycle_state
        FROM installed_modules WHERE slug = 'status-demo'
      `).get()).toEqual({
        active_release_id: null,
        active_config_generation_id: null,
        active_kv_generation_id: null,
        active_grant_generation_id: null,
        enabled: 0,
        lifecycle_state: 'uninstalled',
      });
      expect(database.rawDb.prepare(`
        SELECT state FROM module_releases WHERE id = ?
      `).get(installed.releaseId)).toEqual({ state: 'pruned' });
      expect(database.rawDb.prepare(`
        SELECT outcome, error_code FROM module_operations WHERE id = ?
      `).get(uninstall.operationId)).toEqual({ outcome: 'succeeded', error_code: null });
      expect(existsSync(activeArtifact.artifact_path)).toBe(true);
      expect(consoleError).toHaveBeenCalledWith(
        'A pruned Module artifact could not be removed after the database transition committed.',
        expect.objectContaining({
          releaseId: installed.releaseId,
          digest: verified.digest,
          errorType: expect.any(String),
        }),
      );
    } finally {
      consoleError.mockRestore();
      if (existsSync(artifactParent)) chmodSync(artifactParent, 0o700);
    }
  });

  it('quarantines an exact revoked active release without deleting its data or artifact', async () => {
    const verifierOptions = {
      coreVersion: '0.2.0',
      trustedKeys: { 'lifecycle-test': publicKey },
    };
    const archive = await signedPackage('5.5.0');
    const verified = await verifier.verifyModulePackage(archive, verifierOptions);
    const installed = await lifecycle.installModulePackage(
      archive,
      'admin',
      { expectedDigest: verified.digest },
      verifierOptions,
    );
    await lifecycle.setInstalledModuleEnabled('status-demo', true, 'admin');
    const before = activeDataPointers();
    const artifact = database.rawDb.prepare(`
      SELECT artifact_path FROM module_releases WHERE id = ?
    `).get(installed.releaseId) as { artifact_path: string };
    database.rawDb.prepare(`
      INSERT INTO marketplace_revocations
        (id, target_type, target_value, module_id, module_slug, module_name,
         version, severity, action, published_at, updated_at, reason, summary,
         first_seen_sequence, last_seen_sequence)
      VALUES
        ('NAD-REV-LIFECYCLE-001', 'artifact', ?, 'dev.robrolabs.status-demo',
         'status-demo', 'Status Demo', '5.5.0', 'critical', 'quarantine',
         '2026-08-12T20:00:00.000Z', '2026-08-12T20:00:00.000Z',
         'controlled-test', 'Controlled exact-digest quarantine fixture.', 1, 1)
    `).run(verified.digest);

    await expect(lifecycle.quarantineInstalledModule(
      'status-demo',
      'NAD-REV-LIFECYCLE-001',
      'f'.repeat(64),
    )).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
    expect(database.rawDb.prepare(`
      SELECT enabled, lifecycle_state FROM installed_modules WHERE slug = 'status-demo'
    `).get()).toEqual({ enabled: 1, lifecycle_state: 'active' });

    const quarantined = await lifecycle.quarantineInstalledModule(
      'status-demo',
      'NAD-REV-LIFECYCLE-001',
      verified.digest,
    );

    expect(quarantined).toMatchObject({
      releaseId: installed.releaseId,
      digest: verified.digest,
      changed: true,
    });
    expect(database.rawDb.prepare(`
      SELECT active_release_id, active_config_generation_id, active_kv_generation_id,
             enabled, lifecycle_state
      FROM installed_modules WHERE slug = 'status-demo'
    `).get()).toEqual({
      active_release_id: before.active_release_id,
      active_config_generation_id: before.active_config_generation_id,
      active_kv_generation_id: before.active_kv_generation_id,
      enabled: 0,
      lifecycle_state: 'quarantined',
    });
    expect(existsSync(artifact.artifact_path)).toBe(true);
    expect(database.rawDb.prepare('SELECT state FROM module_releases WHERE id = ?')
      .get(installed.releaseId)).toEqual({ state: 'active' });
    await expect(lifecycle.setInstalledModuleEnabled('status-demo', true, 'admin'))
      .rejects.toMatchObject({ code: 'RELEASE_REVOKED' });
    expect(database.rawDb.prepare(`
      SELECT action, outcome FROM module_operations WHERE id = ?
    `).get(quarantined.operationId)).toEqual({ action: 'quarantine', outcome: 'succeeded' });
  });
});
