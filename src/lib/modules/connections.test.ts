import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'nad-connections-'));
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
process.env.APP_SECRET = 'connection-test-secret-000000000000000001';
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type Connections = typeof import('@/lib/modules/connections');
type Database = typeof import('@/lib/db');
let connections: Connections;
let database: Database;

const signedConnectionSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    host: { type: 'string', title: 'Host', 'x-nad': { control: 'url' } },
    api_key: { type: 'string', title: 'API key', 'x-nad': { control: 'secret' } },
    token: { type: 'string', title: 'Token', 'x-nad': { control: 'secret' } },
  },
};

function installApp(): void {
  database.rawDb.exec(`
    INSERT INTO installed_modules
      (module_id, slug, enabled, lifecycle_state, active_release_id,
       installed_by, installed_at, updated_at)
    VALUES
      ('dev.robrolabs.example', 'example', 1, 'active', 'release-1',
       'admin', 'now', 'now');
    INSERT INTO module_releases
      (id, module_id, version, digest, artifact_path, manifest_json,
       ui_pages_json, ui_widgets_json, signature_status, state,
       package_schema_version, package_kind, connection_schema_json, installed_at)
    VALUES
      ('release-1', 'dev.robrolabs.example', '2.0.0',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       '/artifact', '{}', '{}', '{}', 'verified', 'active', 2, 'app',
       '${JSON.stringify(signedConnectionSchema).replaceAll("'", "''")}', 'now');
    INSERT INTO user_permissions
      (id, user_id, module_slug, actions, created_at)
    VALUES
      ('permission-1', 'member', 'example', '["view","operate"]', 'now'),
      ('permission-2', 'other', 'example', '["view","operate"]', 'now');
  `);
}

beforeAll(async () => {
  database = await import('@/lib/db');
  connections = await import('@/lib/modules/connections');
  database.rawDb.exec(`
    INSERT INTO users
      (id, email, name, password_hash, role, created_at, updated_at)
    VALUES
      ('admin', 'admin@example.test', 'Admin', 'hash', 'admin', 'now', 'now'),
      ('member', 'member@example.test', 'Member', 'hash', 'member', 'now', 'now'),
      ('other', 'other@example.test', 'Other', 'hash', 'member', 'now', 'now');
  `);
});

beforeEach(() => {
  database.rawDb.exec(`
    DELETE FROM app_connection_access;
    DELETE FROM app_connection_generations;
    DELETE FROM app_connection_profiles;
    DELETE FROM user_permissions;
    DELETE FROM module_release_trust;
    DELETE FROM module_releases;
    DELETE FROM installed_modules;
  `);
  installApp();
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('named App connection profiles', () => {
  it('promotes the first configured profile over an empty compatibility default', () => {
    const requiredSchema = { ...signedConnectionSchema, required: ['host', 'api_key'] };
    database.rawDb.prepare(`
      UPDATE module_releases SET connection_schema_json = ? WHERE id = 'release-1'
    `).run(JSON.stringify(requiredSchema));
    const compatibilityId = connections.ensureDefaultConnectionProfile(
      'dev.robrolabs.example',
      null,
      'admin',
      2,
    );
    const configured = connections.createConnectionProfile('dev.robrolabs.example', {
      name: 'Lab',
      values: {
        host: { value: 'https://lab.example.test' },
        api_key: { value: 'lab-secret', isSecret: true },
      },
    }, 'admin');
    expect(configured.isDefault).toBe(true);
    expect(connections.listConnectionProfilesForAdmin('dev.robrolabs.example'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: configured.id, isDefault: true }),
        expect.objectContaining({ id: compatibilityId, isDefault: false }),
      ]));
  });

  it('creates two independently encrypted profiles and never returns their values to UI callers', async () => {
    const first = connections.createConnectionProfile('dev.robrolabs.example', {
      name: 'Local',
      values: {
        host: { value: 'https://local.example.test' },
        api_key: { value: 'local-secret', isSecret: true },
      },
    }, 'admin');
    const second = connections.createConnectionProfile('dev.robrolabs.example', {
      name: 'Remote',
      values: {
        host: { value: 'https://remote.example.test' },
        api_key: { value: 'remote-secret', isSecret: true },
      },
    }, 'admin');

    expect(first).toMatchObject({ name: 'Local', isDefault: true });
    expect(second).toMatchObject({ name: 'Remote', isDefault: false });
    expect(JSON.stringify(connections.listConnectionProfilesForAdmin('dev.robrolabs.example')))
      .not.toContain('local-secret');
    expect(JSON.stringify(connections.listConnectionProfilesForAdmin('dev.robrolabs.example')))
      .not.toContain('remote-secret');
    expect(connections.listConnectionProfilesForAdmin('dev.robrolabs.example')[0]?.fields.host)
      .toEqual({ present: true, isSecret: false, value: 'https://local.example.test' });

    const stored = database.rawDb.prepare(`
      SELECT encrypted_values_json FROM app_connection_generations ORDER BY rowid
    `).all() as Array<{ encrypted_values_json: string }>;
    expect(stored).toHaveLength(2);
    expect(stored.every(({ encrypted_values_json }) => !encrypted_values_json.includes('example.test'))).toBe(true);
    expect(stored.every(({ encrypted_values_json }) => !encrypted_values_json.includes('-secret'))).toBe(true);

    expect(await connections.listConnectionProfilesForUser('dev.robrolabs.example', 'member'))
      .toEqual([
        { id: first.id, name: 'Local', isDefault: true },
        { id: second.id, name: 'Remote', isDefault: false },
      ]);
    const pinned = await connections.readConnectionProfileForInvocation(
      second.id,
      'dev.robrolabs.example',
      'member',
      'operate',
    );
    expect(pinned.values).toEqual({
      host: 'https://remote.example.test',
      api_key: 'remote-secret',
    });
  });

  it('enforces restricted user and role grants and blocks immediately after removal', async () => {
    const profile = connections.createConnectionProfile('dev.robrolabs.example', {
      name: 'Restricted',
      accessMode: 'restricted',
      values: { token: { value: 'restricted-secret', isSecret: true } },
    }, 'admin');

    expect(await connections.authorizeConnectionProfile(
      profile.id,
      'dev.robrolabs.example',
      'member',
      'operate',
    )).toBe(false);

    connections.replaceConnectionProfileAccess('dev.robrolabs.example', profile.id, [
      { subjectType: 'user', subjectId: 'member' },
    ], 'admin');
    expect(await connections.authorizeConnectionProfile(
      profile.id,
      'dev.robrolabs.example',
      'member',
      'operate',
    )).toBe(true);

    connections.replaceConnectionProfileAccess('dev.robrolabs.example', profile.id, [], 'admin');
    await expect(connections.readConnectionProfileForInvocation(
      profile.id,
      'dev.robrolabs.example',
      'member',
      'operate',
    )).rejects.toMatchObject({ code: 'CONNECTION_ACCESS_DENIED' });

    connections.replaceConnectionProfileAccess('dev.robrolabs.example', profile.id, [
      { subjectType: 'role', subjectId: 'member' },
    ], 'admin');
    expect(await connections.listConnectionProfilesForUser('dev.robrolabs.example', 'member'))
      .toEqual([{ id: profile.id, name: 'Restricted', isDefault: true }]);
    expect(await connections.listConnectionProfilesForUser('dev.robrolabs.example', 'other'))
      .toEqual([{ id: profile.id, name: 'Restricted', isDefault: true }]);
  });

  it('uses revision compare-and-swap and keeps exact generations immutable', () => {
    const profile = connections.createConnectionProfile('dev.robrolabs.example', {
      name: 'Primary',
      values: { api_key: { value: 'first', isSecret: true } },
    }, 'admin');
    const updated = connections.updateConnectionProfile('dev.robrolabs.example', profile.id, {
      expectedRevision: profile.revision,
      values: { api_key: { value: 'second', isSecret: true } },
    }, 'admin');
    expect(updated.revision).toBe(2);
    expect(database.rawDb.prepare(`
      SELECT COUNT(*) AS count FROM app_connection_generations WHERE connection_profile_id = ?
    `).get(profile.id)).toEqual({ count: 2 });
    expect(() => connections.updateConnectionProfile('dev.robrolabs.example', profile.id, {
      expectedRevision: profile.revision,
      name: 'Stale update',
    }, 'admin')).toThrow(/changed while saving/);
  });

  it('derives secrecy from the signed schema and preserves omitted secrets on PATCH', async () => {
    const profile = connections.createConnectionProfile('dev.robrolabs.example', {
      name: 'Primary',
      values: {
        host: { value: 'https://one.example.test', isSecret: true },
        api_key: { value: 'keep-me', isSecret: false },
      },
    }, 'admin');
    expect(profile.fields).toMatchObject({
      host: { isSecret: false, value: 'https://one.example.test' },
      api_key: { isSecret: true, present: true },
    });

    const updated = connections.updateConnectionProfile('dev.robrolabs.example', profile.id, {
      expectedRevision: profile.revision,
      values: { host: { value: 'https://two.example.test', isSecret: true } },
    }, 'admin');
    expect(updated.fields).toMatchObject({
      host: { isSecret: false, value: 'https://two.example.test' },
      api_key: { isSecret: true, present: true },
    });
    await expect(connections.readConnectionProfileForInvocation(
      profile.id, 'dev.robrolabs.example', 'member', 'operate',
    )).resolves.toMatchObject({ values: { host: 'https://two.example.test', api_key: 'keep-me' } });
    expect(() => connections.updateConnectionProfile('dev.robrolabs.example', profile.id, {
      expectedRevision: updated.revision,
      values: { undeclared: { value: 'nope' } },
    }, 'admin')).toThrow(/undeclared field/);
  });
});
