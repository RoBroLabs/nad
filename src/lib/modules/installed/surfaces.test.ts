import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'nad-surfaces-'));
const artifactPath = join(directory, 'artifact');
const entryPath = 'ui/surfaces/summary.html';
const html = '<main><script>globalThis.fixture=true</script></main>';
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type Database = typeof import('@/lib/db');
type Surfaces = typeof import('@/lib/modules/installed/surfaces');
let database: Database;
let surfaceApi: Surfaces;

const manifest = {
  schemaVersion: 2, kind: 'app', id: 'dev.robrolabs.surface-fixture', slug: 'surface-fixture',
  name: 'Surface Fixture', description: 'Verified surface fixture.', icon: 'layout', category: 'custom',
  version: '2.0.0', publisher: 'Robro Labs',
  compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
  capabilities: [{ name: 'connections.current', reason: 'Identify a selected profile.' }],
  permissions: [{ action: 'view', label: 'View', risk: 'read' }],
  connections: { schema: 'schemas/connections.json', multiple: true },
  operations: {
    summary: {
      version: '1.0.0', kind: 'query', consumers: ['self'], connection: 'required', permission: 'view',
      handler: 'summary', requestSchema: 'schemas/operations/input.json',
      responseSchema: 'schemas/operations/output.json', timeoutClass: 'short',
      maxRequestBytes: 1024, maxResponseBytes: 4096,
    },
  },
  surfaces: 'ui/surfaces.json',
};

const surfaceDocument = {
  schemaVersion: 2,
  surfaces: [{
    id: 'summary', kind: 'widget', name: 'Summary', description: 'Summary surface.', entry: entryPath,
    bridge: '2.x', permissions: ['view'],
    connectionSlots: [{ slot: 'primary', target: 'self', required: true }],
    bindings: { summary: { target: 'self', operation: 'summary', connectionSlot: 'primary' } },
    widget: { defaultSize: { w: 4, h: 3 }, chrome: 'standard' },
    execution: { requestedMode: 'sandbox', privileges: ['theme'] },
  }],
};

function updateSurfaces(value: unknown): void {
  database.rawDb.prepare(`UPDATE module_releases SET surfaces_json = ? WHERE id = 'release-surface'`)
    .run(JSON.stringify(value));
}

beforeAll(async () => {
  mkdirSync(join(artifactPath, 'ui', 'surfaces'), { recursive: true });
  writeFileSync(join(artifactPath, entryPath), html);
  writeFileSync(join(artifactPath, 'checksums.json'), JSON.stringify({
    schemaVersion: 1,
    algorithm: 'sha256',
    files: { [entryPath]: createHash('sha256').update(html).digest('hex') },
  }));
  database = await import('@/lib/db');
  surfaceApi = await import('@/lib/modules/installed/surfaces');
  database.rawDb.prepare(`
    INSERT INTO installed_modules
      (module_id, slug, enabled, lifecycle_state, active_release_id,
       active_grant_generation_id, installed_at, updated_at)
    VALUES (?, ?, 1, 'active', 'release-surface', 'grant-surface', 'now', 'now')
  `).run(manifest.id, manifest.slug);
  database.rawDb.prepare(`
    INSERT INTO module_releases
      (id, module_id, version, digest, artifact_path, manifest_json, ui_pages_json, ui_widgets_json,
       signature_status, state, package_schema_version, package_kind, operations_json, surfaces_json,
       connection_schema_json, installed_at)
    VALUES ('release-surface', ?, '2.0.0', ?, ?, ?, ?, ?, 'verified', 'active', 2, 'app', ?, ?, ?, 'now')
  `).run(
    manifest.id,
    'b'.repeat(64),
    artifactPath,
    JSON.stringify(manifest),
    JSON.stringify({ schemaVersion: 1, pages: [] }),
    JSON.stringify({ schemaVersion: 1, widgets: [] }),
    JSON.stringify(manifest.operations),
    JSON.stringify(surfaceDocument),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
      properties: { endpoint: { type: 'string', title: 'Endpoint', 'x-nad': { control: 'url' } } },
    }),
  );
  database.rawDb.prepare(`
    INSERT INTO module_capability_grant_generations (id, module_id, grants_json, created_at)
    VALUES ('grant-surface', ?, '["connections.current"]', 'now')
  `).run(manifest.id);
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('verified installed surface entries', () => {
  it('reads only the exact active checksummed HTML entry', async () => {
    await expect(surfaceApi.readVerifiedSurfaceEntryHtml(manifest.slug, 'summary')).resolves.toEqual({
      html,
      digest: 'b'.repeat(64),
      releaseId: 'release-surface',
    });
  });

  it('rejects checksum changes and paths outside the verified surface contract', async () => {
    writeFileSync(join(artifactPath, entryPath), '<main>tampered</main>');
    await expect(surfaceApi.readVerifiedSurfaceEntryHtml(manifest.slug, 'summary'))
      .rejects.toMatchObject({ code: 'SURFACE_CHECKSUM_FAILED' });
    writeFileSync(join(artifactPath, entryPath), html);

    const invalid = structuredClone(surfaceDocument);
    invalid.surfaces[0].entry = 'ui/surfaces/../outside.html';
    updateSurfaces(invalid);
    expect(surfaceApi.getSurfaceDefinition(manifest.slug, 'summary')).toBeUndefined();
    updateSurfaces(surfaceDocument);

    rmSync(join(artifactPath, entryPath));
    writeFileSync(join(directory, 'outside.html'), html);
    symlinkSync(join(directory, 'outside.html'), join(artifactPath, entryPath));
    await expect(surfaceApi.readVerifiedSurfaceEntryHtml(manifest.slug, 'summary'))
      .rejects.toMatchObject({ code: 'INVALID_SURFACE_ENTRY' });
  });
});
