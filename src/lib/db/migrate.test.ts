import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@/lib/db/migrate';

const databases: Database.Database[] = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe('migrateDatabase', () => {
  it('creates a complete schema and remains idempotent', () => {
    const database = new Database(':memory:');
    databases.push(database);

    migrateDatabase(database);
    migrateDatabase(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((record) => (record as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining([
      'users',
      'module_configs',
      'enabled_modules',
      'user_permissions',
      'widget_layouts',
      'audit_log',
      'installed_modules',
      'module_releases',
      'module_config_generations',
      'module_kv_generations',
      'module_kv_entries',
      'module_capability_grant_generations',
      'module_lifecycle_locks',
      'module_operations',
      'marketplace_security_state',
      'marketplace_recommendations',
      'marketplace_advisories',
      'marketplace_revocations',
      'module_release_trust',
      'app_connection_profiles',
      'app_connection_generations',
      'app_connection_access',
      'module_diagnostics',
      'workspaces',
      'workspace_assignments',
      'workspace_tabs',
      'workspace_widget_instances',
      'workspace_tab_layouts',
      'homedashboard_migrations',
    ]));
    const releaseColumns = database
      .prepare('PRAGMA table_info(module_releases)')
      .all()
      .map((record) => (record as { name: string }).name);
    expect(releaseColumns).toEqual(expect.arrayContaining([
      'config_generation_id',
      'kv_generation_id',
      'package_schema_version',
      'package_kind',
      'dependencies_json',
      'operations_json',
      'surfaces_json',
      'connection_schema_json',
    ]));
    const userColumns = database
      .prepare('PRAGMA table_info(users)')
      .all()
      .map((record) => (record as { name: string }).name);
    expect(userColumns).toContain('can_create_personal_workspaces');
    expect(database.prepare('SELECT COUNT(*) AS count FROM homedashboard_migrations').get())
      .toEqual({ count: 10 });
  });

  it('enforces the module config upsert key', () => {
    const database = new Database(':memory:');
    databases.push(database);
    migrateDatabase(database);

    const insert = database.prepare(`
      INSERT INTO module_configs
        (id, module_slug, key, value, is_secret, updated_at)
      VALUES (?, 'network', 'pihole_url', 'http://one', 0, '2026-08-05T00:00:00.000Z')
    `);
    insert.run('first');
    expect(() => insert.run('second')).toThrow(/UNIQUE constraint failed/);
  });

  it('retains an opaque audit actor after migrating and deleting the user', () => {
    const database = new Database(':memory:');
    databases.push(database);
    database.pragma('foreign_keys = ON');
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        auth_version INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL DEFAULT 'member',
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT REFERENCES users(id),
        action TEXT NOT NULL,
        module_slug TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_log_created_at_idx ON audit_log(created_at);
      CREATE INDEX audit_log_module_slug_idx ON audit_log(module_slug);
      CREATE TABLE module_configs (
        id TEXT PRIMARY KEY NOT NULL,
        module_slug TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        is_secret INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT REFERENCES users(id),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE widget_layouts (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_slug TEXT NOT NULL,
        layout_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE homedashboard_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO homedashboard_migrations VALUES
        (1, 'initial_schema', '2026-08-05T00:00:00.000Z'),
        (2, 'invalidate_sessions_after_password_change', '2026-08-05T00:00:00.000Z');
      INSERT INTO users
        (id, email, name, password_hash, role, created_at, updated_at)
      VALUES
        ('former-user', 'former@example.test', 'Former User', 'hash', 'member',
         '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
      INSERT INTO audit_log
        (id, user_id, action, module_slug, details, ip_address, created_at)
      VALUES
        ('audit-1', 'former-user', 'example_action', 'docker', '{"safe":true}',
         '192.168.1.10', '2026-08-05T00:00:00.000Z');
    `);

    migrateDatabase(database);
    database.prepare("DELETE FROM users WHERE id = 'former-user'").run();

    expect(database.prepare("SELECT id FROM users WHERE id = 'former-user'").get()).toBeUndefined();
    expect(database.prepare("SELECT * FROM audit_log WHERE id = 'audit-1'").get()).toMatchObject({
      id: 'audit-1',
      user_id: 'former-user',
      action: 'example_action',
      details: '{"safe":true}',
    });
    expect(database.pragma('foreign_key_check')).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM homedashboard_migrations').get())
      .toEqual({ count: 10 });
  });

  it('adds release-level data pointers and backfills version 6 releases from installed pointers', () => {
    const database = new Database(':memory:');
    databases.push(database);
    database.exec(`
      CREATE TABLE installed_modules (
        module_id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        active_release_id TEXT,
        active_config_generation_id TEXT,
        active_kv_generation_id TEXT,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE module_releases (
        id TEXT PRIMARY KEY NOT NULL,
        module_id TEXT NOT NULL,
        version TEXT NOT NULL,
        digest TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        ui_pages_json TEXT NOT NULL,
        ui_widgets_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        signer_key_id TEXT,
        signature_status TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'staged',
        installed_at TEXT NOT NULL
      );
      CREATE TABLE homedashboard_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO homedashboard_migrations VALUES
        (1, 'initial_schema', '2026-08-05T00:00:00.000Z'),
        (2, 'invalidate_sessions_after_password_change', '2026-08-05T00:00:00.000Z'),
        (3, 'retain_audit_actor_after_user_deletion', '2026-08-05T00:00:00.000Z'),
        (4, 'installed_module_runtime', '2026-08-05T00:00:00.000Z'),
        (5, 'installed_module_lifecycle_invariants', '2026-08-05T00:00:00.000Z'),
        (6, 'import_legacy_installed_module_config', '2026-08-05T00:00:00.000Z'),
        (8, 'marketplace_security_metadata', '2026-08-05T00:00:00.000Z'),
        (9, 'apps_connections_and_exact_digest_trust', '2026-08-05T00:00:00.000Z'),
        (10, 'workspaces_tabs_and_surface_access', '2026-08-05T00:00:00.000Z');
      INSERT INTO installed_modules
        (module_id, slug, active_release_id, active_config_generation_id,
         active_kv_generation_id, installed_at, updated_at)
      VALUES
        ('dev.robrolabs.system-monitor', 'system-monitor', 'release-active',
         'config-live', 'kv-live', 'now', 'now');
      INSERT INTO module_releases
        (id, module_id, version, digest, artifact_path, manifest_json,
         ui_pages_json, ui_widgets_json, signature_status, state, installed_at)
      VALUES
        ('release-active', 'dev.robrolabs.system-monitor', '1.0.2', 'digest-active', '/artifact', '{}', '{}', '{}', 'verified', 'active', 'now'),
        ('release-retained', 'dev.robrolabs.system-monitor', '1.0.1', 'digest-retained', '/artifact', '{}', '{}', '{}', 'verified', 'retained', 'before'),
        ('release-pruned', 'dev.robrolabs.system-monitor', '1.0.0', 'digest-pruned', '/artifact', '{}', '{}', '{}', 'verified', 'pruned', 'older'),
        ('release-rejected', 'dev.robrolabs.system-monitor', '1.0.3', 'digest-rejected', '/artifact', '{}', '{}', '{}', 'verified', 'rejected', 'later');
    `);

    migrateDatabase(database);

    const releaseColumns = database
      .prepare('PRAGMA table_info(module_releases)')
      .all()
      .map((record) => (record as { name: string }).name);
    expect(releaseColumns).toEqual(expect.arrayContaining([
      'config_generation_id',
      'kv_generation_id',
    ]));
    expect(database.prepare(`
      SELECT id, config_generation_id, kv_generation_id
      FROM module_releases
      ORDER BY id
    `).all()).toEqual([
      { id: 'release-active', config_generation_id: 'config-live', kv_generation_id: 'kv-live' },
      { id: 'release-pruned', config_generation_id: 'config-live', kv_generation_id: 'kv-live' },
      { id: 'release-rejected', config_generation_id: null, kv_generation_id: null },
      { id: 'release-retained', config_generation_id: 'config-live', kv_generation_id: 'kv-live' },
    ]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM homedashboard_migrations').get())
      .toEqual({ count: 10 });
  });

  it('enforces immutable installed release identities', () => {
    const database = new Database(':memory:');
    databases.push(database);
    migrateDatabase(database);

    database.prepare(`
      INSERT INTO installed_modules
        (module_id, slug, installed_at, updated_at)
      VALUES ('dev.robrolabs.system-monitor', 'system-monitor', 'now', 'now')
    `).run();
    const insertRelease = database.prepare(`
      INSERT INTO module_releases
        (id, module_id, version, digest, artifact_path, manifest_json,
         ui_pages_json, ui_widgets_json, signature_status, state, installed_at)
      VALUES (?, 'dev.robrolabs.system-monitor', ?, ?, '/artifact', '{}', '{}', '{}',
              'development', 'active', 'now')
    `);
    insertRelease.run('release-1', '1.0.0', 'digest-1');

    expect(() => insertRelease.run('release-2', '1.0.0', 'digest-2'))
      .toThrow(/UNIQUE constraint failed/);
    expect(() => insertRelease.run('release-3', '1.0.1', 'digest-1'))
      .toThrow(/UNIQUE constraint failed/);
    expect(() => insertRelease.run('release-4', '1.0.1', 'digest-4'))
      .toThrow(/UNIQUE constraint failed/);
  });

  it('imports legacy installed config when the transitional active generation is empty', () => {
    const database = new Database(':memory:');
    databases.push(database);
    migrateDatabase(database);
    database.prepare('DELETE FROM homedashboard_migrations WHERE version = 6').run();
    database.exec(`
      INSERT INTO users
        (id, email, name, password_hash, role, created_at, updated_at)
      VALUES ('admin', 'admin@example.test', 'Admin', 'hash', 'admin', 'now', 'now');
      INSERT INTO installed_modules
        (module_id, slug, active_config_generation_id, installed_at, updated_at)
      VALUES ('dev.robrolabs.system-monitor', 'system-monitor', 'empty-generation', 'now', 'now');
      INSERT INTO module_config_generations
        (id, module_id, encrypted_values_json, created_at)
      VALUES ('empty-generation', 'dev.robrolabs.system-monitor', '{}', 'before');
      INSERT INTO module_configs
        (id, module_slug, key, value, is_secret, updated_by, updated_at)
      VALUES
        ('hosts', 'system-monitor', 'hosts', 'Example NAD|192.0.2.8', 0, 'admin', 'configured'),
        ('token', 'system-monitor', 'token', 'encrypted-token-value', 1, 'admin', 'configured');
    `);

    migrateDatabase(database);

    const pointer = database.prepare(`
      SELECT active_config_generation_id, registry_epoch
      FROM installed_modules
      WHERE slug = 'system-monitor'
    `).get() as { active_config_generation_id: string; registry_epoch: number };
    expect(pointer.active_config_generation_id).toMatch(/^legacy-import-[a-f0-9]{32}$/);
    expect(pointer.registry_epoch).toBe(2);
    const generation = database.prepare(`
      SELECT encrypted_values_json, parent_generation_id
      FROM module_config_generations
      WHERE id = ?
    `).get(pointer.active_config_generation_id) as {
      encrypted_values_json: string;
      parent_generation_id: string;
    };
    expect(generation.parent_generation_id).toBe('empty-generation');
    expect(JSON.parse(generation.encrypted_values_json)).toEqual({
      hosts: {
        value: 'Example NAD|192.0.2.8',
        encrypted: false,
        isSecret: false,
        updatedBy: 'admin',
        updatedAt: 'configured',
      },
      token: {
        value: 'encrypted-token-value',
        encrypted: true,
        isSecret: true,
        updatedBy: 'admin',
        updatedAt: 'configured',
      },
    });
  });

  it('backfills exact-digest trust, a Default connection, and the legacy Home workspace', () => {
    const database = new Database(':memory:');
    databases.push(database);
    database.pragma('foreign_keys = ON');
    migrateDatabase(database);

    database.exec(`
      INSERT INTO users
        (id, email, name, password_hash, role, created_at, updated_at)
      VALUES ('member-1', 'member@example.test', 'Member', 'hash', 'member', 'created', 'updated');
      INSERT INTO installed_modules
        (module_id, slug, enabled, lifecycle_state, active_release_id,
         active_config_generation_id, installed_at, updated_at)
      VALUES
        ('dev.robrolabs.example', 'example', 1, 'active', 'release-1',
         'config-1', 'installed', 'updated');
      INSERT INTO module_releases
        (id, module_id, version, digest, artifact_path, manifest_json,
         ui_pages_json, ui_widgets_json, signature_status, state, installed_at)
      VALUES
        ('release-1', 'dev.robrolabs.example', '1.0.0', 'digest-1', '/artifact',
         '{}', '{}', '{}', 'verified', 'active', 'installed');
      INSERT INTO module_config_generations
        (id, module_id, encrypted_values_json, created_at)
      VALUES
        ('config-1', 'dev.robrolabs.example',
         '{"host":{"value":"encrypted-value","encrypted":true,"isSecret":false,"updatedBy":null,"updatedAt":"updated"}}',
         'updated');
      INSERT INTO widget_layouts (id, user_id, page_slug, layout_json, updated_at)
      VALUES (
        'layout-1',
        'member-1',
        'home',
        '{"widgets":[{"instanceId":"widget-1","moduleSlug":"example","widgetId":"summary"}],"layouts":{"lg":[{"i":"widget-1","x":0,"y":0,"w":4,"h":3}]}}',
        'updated'
      );

      DROP TABLE workspace_tab_layouts;
      DROP TABLE workspace_widget_instances;
      DROP TABLE workspace_tabs;
      DROP TABLE workspace_assignments;
      DROP TABLE workspaces;
      DROP TABLE module_diagnostics;
      DROP TABLE app_connection_access;
      DROP TABLE app_connection_generations;
      DROP TABLE app_connection_profiles;
      DROP TABLE module_release_trust;
      DELETE FROM app_settings WHERE key = 'module.trusted_code_policy';
      DELETE FROM homedashboard_migrations WHERE version IN (9, 10);
    `);

    migrateDatabase(database);

    expect(database.prepare(`
      SELECT digest, decision, basis
      FROM module_release_trust
      WHERE release_id = 'release-1'
    `).get()).toEqual({ digest: 'digest-1', decision: 'sandboxed', basis: 'package-default' });
    expect(database.prepare(`
      SELECT name, is_default, access_mode, active_generation_id
      FROM app_connection_profiles
      WHERE app_module_id = 'dev.robrolabs.example'
    `).get()).toEqual({
      name: 'Default',
      is_default: 1,
      access_mode: 'inherit',
      active_generation_id: 'default-profile-generation:dev.robrolabs.example',
    });
    expect(database.prepare(`
      SELECT encrypted_values_json
      FROM app_connection_generations
      WHERE connection_profile_id = 'default-profile:dev.robrolabs.example'
    `).get()).toEqual({
      encrypted_values_json: '{"host":{"value":"encrypted-value","encrypted":true,"isSecret":false,"updatedBy":null,"updatedAt":"updated"}}',
    });
    expect(database.prepare(`
      SELECT workspaces.name, workspaces.kind, workspace_tabs.name AS tab_name,
             workspace_widget_instances.instance_id, workspace_widget_instances.module_slug,
             workspace_widget_instances.widget_id
      FROM workspaces
      JOIN workspace_tabs ON workspace_tabs.workspace_id = workspaces.id
      JOIN workspace_widget_instances ON workspace_widget_instances.tab_id = workspace_tabs.id
    `).get()).toEqual({
      name: 'Home',
      kind: 'personal',
      tab_name: 'Overview',
      instance_id: 'widget-1',
      module_slug: 'example',
      widget_id: 'summary',
    });
    expect(database.prepare('SELECT breakpoint, layout_json FROM workspace_tab_layouts').get())
      .toEqual({ breakpoint: 'lg', layout_json: '[{"i":"widget-1","x":0,"y":0,"w":4,"h":3}]' });
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });
});
