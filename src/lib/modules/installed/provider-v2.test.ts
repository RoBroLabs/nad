import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'nad-provider-v2-'));
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type Database = typeof import('@/lib/db');
type Provider = typeof import('@/lib/modules/installed/provider');
let database: Database;
let provider: Provider;

const manifest = {
  schemaVersion: 2,
  kind: 'app',
  id: 'dev.robrolabs.provider-fixture',
  slug: 'provider-fixture',
  name: 'Provider Fixture',
  description: 'Restart-safe v2 provider fixture.',
  icon: 'server',
  category: 'servers',
  version: '2.0.0',
  publisher: 'Robro Labs',
  compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
  capabilities: [{ name: 'connections.current', reason: 'Identify a selected profile.' }],
  permissions: [{ action: 'view', label: 'View', risk: 'read' }],
  connections: { schema: 'schemas/connections.json', multiple: true },
  operations: {
    summary: {
      version: '1.0.0', kind: 'query', consumers: ['self'], connection: 'required', permission: 'view',
      handler: 'summary', requestSchema: 'schemas/operations/input.json', responseSchema: 'schemas/operations/output.json',
      timeoutClass: 'short', maxRequestBytes: 1024, maxResponseBytes: 4096,
    },
  },
  surfaces: 'ui/surfaces.json',
};

const connectionSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
  required: ['endpoint', 'token'],
  properties: {
    endpoint: { type: 'string', title: 'Endpoint', 'x-nad': { control: 'url' } },
    token: { type: 'string', title: 'Token', 'x-nad': { control: 'secret' } },
  },
};

const surfaces = {
  schemaVersion: 2,
  surfaces: [
    {
      id: 'summary', kind: 'widget', name: 'Summary', description: 'Summary Widget',
      entry: 'ui/surfaces/summary.html', bridge: '2.x', permissions: ['view'],
      connectionSlots: [{ slot: 'primary', target: 'self', required: true }],
      bindings: { summary: { target: 'self', operation: 'summary', connectionSlot: 'primary' } },
      widget: { defaultSize: { w: 4, h: 3 }, chrome: 'standard' },
      execution: { requestedMode: 'sandbox', privileges: ['theme'] },
    },
    {
      id: 'details', kind: 'page', name: 'Details', description: 'Details page',
      entry: 'ui/surfaces/details.html', bridge: '2.x', permissions: ['view'],
      connectionSlots: [{ slot: 'primary', target: 'self', required: true }],
      bindings: { summary: { target: 'self', operation: 'summary', connectionSlot: 'primary' } },
      page: { path: '/', pinEligible: true },
      execution: { requestedMode: 'sandbox', privileges: ['theme'] },
    },
  ],
};

beforeAll(async () => {
  database = await import('@/lib/db');
  provider = await import('@/lib/modules/installed/provider');
  database.rawDb.prepare(`
    INSERT INTO installed_modules
      (module_id, slug, enabled, lifecycle_state, active_release_id,
       active_grant_generation_id, installed_at, updated_at)
    VALUES (?, ?, 1, 'active', 'release-v2', 'grants-v2', 'now', 'now')
  `).run(manifest.id, manifest.slug);
  database.rawDb.prepare(`
    INSERT INTO module_releases
      (id, module_id, version, digest, artifact_path, manifest_json,
       ui_pages_json, ui_widgets_json, signature_status, state,
       package_schema_version, package_kind, operations_json, surfaces_json,
       connection_schema_json, installed_at)
    VALUES
      ('release-v2', ?, '2.0.0', ?, '/artifact', ?, ?, ?, 'verified', 'active',
       2, 'app', ?, ?, ?, 'now')
  `).run(
    manifest.id,
    'a'.repeat(64),
    JSON.stringify(manifest),
    JSON.stringify({ schemaVersion: 1, pages: [] }),
    JSON.stringify({ schemaVersion: 1, widgets: [] }),
    JSON.stringify(manifest.operations),
    JSON.stringify(surfaces),
    JSON.stringify(connectionSchema),
  );
  database.rawDb.prepare(`
    INSERT INTO module_capability_grant_generations
      (id, module_id, grants_json, created_at)
    VALUES ('grants-v2', ?, '["connections.current"]', 'now')
  `).run(manifest.id);
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('schema-v2 installed provider restart projection', () => {
  it('parses the canonical raw manifest and derives connections and surfaces after reload', () => {
    expect(provider.getInstalledModule(manifest.slug)).toMatchObject({
      packageSchemaVersion: 2,
      packageKind: 'app',
      manifest: {
        configSchema: [
          expect.objectContaining({ key: 'endpoint', type: 'url' }),
          expect.objectContaining({ key: 'token', type: 'secret' }),
        ],
        widgets: [expect.objectContaining({ id: 'summary', sandboxSurfaceId: 'summary' })],
        pages: [expect.objectContaining({ path: '/', sandboxSurfaceId: 'details' })],
      },
    });
  });
});
