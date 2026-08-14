import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InstalledModuleDefinition } from '@/lib/modules/installed/provider';
import type { ModuleApiContext } from '@/lib/modules/registry-types';

const directory = mkdtempSync(join(tmpdir(), 'nad-host-v2-'));
const artifactPath = join(directory, 'artifact');
const moduleId = 'dev.robrolabs.host-v2';
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
process.env.NAD_DATA_DIR = directory;
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type Database = typeof import('@/lib/db');
type HostApiV2 = typeof import('@/lib/modules/installed/host-api-v2');
let database: Database;
let hostApiV2: HostApiV2;

const manifest: InstalledModuleDefinition['manifest'] = {
  moduleId, slug: 'host-v2', name: 'Host v2', description: 'Fixture',
  icon: 'server', category: 'servers', version: '2.0.0', source: 'installed', publisher: 'Robro Labs',
  compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
  capabilities: [
    { name: 'connections.current', reason: 'Current connection.' },
    { name: 'connections.get', reason: 'Connection fields.' },
    { name: 'diagnostics.emit', reason: 'Diagnostics.' },
  ],
  configSchema: [], widgets: [], pages: [],
  permissions: [{ action: 'view', label: 'View', description: 'View.', defaultRole: 'member' }],
  entrypoints: {},
};

const definition: InstalledModuleDefinition = {
  moduleId,
  releaseId: 'release-v2',
  configGenerationId: null,
  kvGenerationId: null,
  grantGenerationId: 'grant-v2',
  digest: 'a'.repeat(64),
  signerKeyId: 'fixture-key',
  artifactPath,
  enabled: true,
  lifecycleState: 'active',
  registryEpoch: 1,
  grantedCapabilities: ['connections.current', 'connections.get', 'diagnostics.emit'],
  packageSchemaVersion: 2,
  packageKind: 'app',
  dependencies: [], operations: {}, surfaces: null, v2HttpAccess: [], manifest,
};

const context: ModuleApiContext = {
  config: { endpoint: 'https://host.example.test', token: 'never-return-this' },
  moduleSlug: manifest.slug,
  path: ['operations', 'summary'],
  userId: 'member',
  connectionProfileId: 'profile-1',
  connectionProfileName: 'Lab',
  connectionGenerationId: 'generation-1',
  correlationId: 'correlation-1',
  caller: { kind: 'surface', packageId: moduleId, surfaceId: 'summary' },
  notify: vi.fn(async () => undefined),
};

beforeAll(async () => {
  mkdirSync(join(artifactPath, 'schemas'), { recursive: true });
  writeFileSync(join(artifactPath, 'schemas', 'connections.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
    properties: {
      endpoint: { type: 'string', title: 'Endpoint', 'x-nad': { control: 'url' } },
      token: { type: 'string', title: 'Token', 'x-nad': { control: 'secret' } },
    },
  }));
  database = await import('@/lib/db');
  hostApiV2 = await import('@/lib/modules/installed/host-api-v2');
  database.rawDb.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
    VALUES ('member', 'member@example.test', 'Member', 'hash', 'member', 'now', 'now')
  `).run();
  database.rawDb.prepare(`
    INSERT INTO installed_modules
      (module_id, slug, enabled, lifecycle_state, active_release_id, installed_at, updated_at)
    VALUES (?, ?, 1, 'active', ?, 'now', 'now')
  `).run(definition.moduleId, manifest.slug, definition.releaseId);
  database.rawDb.prepare(`
    INSERT INTO module_releases
      (id, module_id, version, digest, artifact_path, manifest_json, ui_pages_json,
       ui_widgets_json, signature_status, state, package_schema_version, package_kind, installed_at)
    VALUES (?, ?, '2.0.0', ?, ?, '{}', '{}', '{}', 'verified', 'active', 2, 'app', 'now')
  `).run(definition.releaseId, definition.moduleId, definition.digest, artifactPath);
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('Host API v2', () => {
  it('returns profile identity and opaque secret references without exposing plaintext', async () => {
    const host = hostApiV2.createInstalledHostApiV2(definition, context, 'query');
    await expect(host({ method: 'connections.current', params: {} })).resolves.toEqual({ id: 'profile-1', name: 'Lab' });
    await expect(host({ method: 'connections.get', params: { name: 'endpoint' } }))
      .resolves.toBe('https://host.example.test');
    const secret = await host({ method: 'connections.get', params: { name: 'token' } });
    expect(secret).toEqual({ present: true, secretRef: 'profile/profile-1/token' });
    expect(JSON.stringify(secret)).not.toContain('never-return-this');
    await expect(host({ method: 'connections.get', params: { name: 'undeclared' } }))
      .rejects.toThrow('undeclared field');
  });

  it('validates canonical calls, capabilities, and bounds persisted diagnostics', async () => {
    const host = hostApiV2.createInstalledHostApiV2(definition, context, 'query');
    await expect(host({
      method: 'diagnostics.emit',
      params: { level: 'warning', code: 'UPSTREAM_SLOW', message: 'The upstream was slow.', metadata: { ms: 12 } },
    })).resolves.toEqual({ accepted: true });
    expect(database.rawDb.prepare(`
      SELECT level, message, correlation_id FROM module_diagnostics WHERE module_id = ?
    `).get(definition.moduleId)).toEqual({ level: 'warn', message: 'The upstream was slow.', correlation_id: 'correlation-1' });
    await expect(host({ method: 'http.request', params: { scope: 'undeclared' } }))
      .rejects.toThrow('no approved capability');
    await expect(host({ method: 'connections.current', params: { unexpected: true } } as never))
      .rejects.toThrow('canonical v2 contract');
  });

  it('exposes apps.invoke only to an Add-on with a core-supplied non-recursive broker', async () => {
    const invokeApp = vi.fn(async () => ({ status: 'ok' }));
    const addon: InstalledModuleDefinition = {
      ...definition,
      moduleId: 'dev.robrolabs.host-addon',
      packageKind: 'addon',
      grantedCapabilities: ['apps.invoke'],
      manifest: { ...manifest, moduleId: 'dev.robrolabs.host-addon', slug: 'host-addon' },
    };
    const call = {
      method: 'apps.invoke' as const,
      params: { dependency: 'app', operation: 'summary', connectionProfileId: 'connection-profile-1', input: {} },
    };
    await expect(hostApiV2.createInstalledHostApiV2(addon, { ...context, invokeApp }, 'query')(call))
      .resolves.toEqual({ status: 'ok' });
    expect(invokeApp).toHaveBeenCalledWith(call.params);

    const appWithCapability = { ...definition, grantedCapabilities: ['apps.invoke'] };
    await expect(hostApiV2.createInstalledHostApiV2(appWithCapability, { ...context, invokeApp }, 'query')(call))
      .rejects.toThrow('only to a declared Add-on dependency');
  });
});
