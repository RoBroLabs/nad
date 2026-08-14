import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'nad-module-config-'));
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
process.env.APP_SECRET = 'module-config-test-secret-000000000000001';
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type Config = typeof import('@/lib/modules/config');
type Database = typeof import('@/lib/db');
let config: Config;
let database: Database;

function insertAdmin(): void {
  database.rawDb.prepare(`
    INSERT INTO users
      (id, email, name, password_hash, role, created_at, updated_at)
    VALUES ('admin', 'admin@example.test', 'Admin', 'hash', 'admin', 'now', 'now')
  `).run();
}

function digestFor(slug: string): string {
  return Buffer.from(slug).toString('hex').padEnd(64, '0').slice(0, 64);
}

function insertInstalledModule(slug = 'system-monitor'): void {
  const moduleId = `dev.robrolabs.${slug}`;
  const releaseId = `${slug}-release-1`;
  database.rawDb.prepare(`
    INSERT INTO installed_modules
      (module_id, slug, lifecycle_state, enabled, active_release_id, installed_by, installed_at, updated_at)
    VALUES (?, ?, 'active', 0, ?, 'admin', 'now', 'now')
  `).run(moduleId, slug, releaseId);
  database.rawDb.prepare(`
    INSERT INTO module_releases
      (id, module_id, version, digest, artifact_path, manifest_json, ui_pages_json,
       ui_widgets_json, capabilities_json, signature_status, state, installed_at)
    VALUES (?, ?, '1.0.0', ?, '/tmp/not-used', '{}', '{}', '{}', '[]', 'verified', 'active', 'now')
  `).run(releaseId, moduleId, digestFor(slug));
}

function insertLegacyConfig(
  moduleSlug: string,
  key: string,
  value: string,
  isSecret = false,
): void {
  database.rawDb.prepare(`
    INSERT INTO module_configs
      (id, module_slug, key, value, is_secret, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, 'admin', 'legacy-time')
  `).run(`${moduleSlug}-${key}`, moduleSlug, key, value, isSecret ? 1 : 0);
}

beforeAll(async () => {
  database = await import('@/lib/db');
  config = await import('@/lib/modules/config');
  insertAdmin();
});

beforeEach(() => {
  database.rawDb.exec(`
    DELETE FROM module_config_generations;
    DELETE FROM module_lifecycle_locks;
    DELETE FROM module_configs;
    DELETE FROM enabled_modules;
    DELETE FROM installed_modules;
  `);
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('Module configuration persistence', () => {
  it('requires an explicit one-time import before installed reads use legacy slug config', async () => {
    insertInstalledModule();
    insertLegacyConfig('system-monitor', 'hosts', 'router|192.0.2.10');

    expect(await config.getModuleConfig('system-monitor')).toEqual({});
    expect(await config.getModuleConfigForDisplay('system-monitor')).toEqual({});

    const generationId = config.ensureInstalledModuleConfigGeneration('system-monitor', 'admin');

    expect(typeof generationId).toBe('string');
    expect(await config.getModuleConfig('system-monitor')).toEqual({
      hosts: 'router|192.0.2.10',
    });
    expect(config.ensureInstalledModuleConfigGeneration('system-monitor', 'admin')).toBe(generationId);
    expect(database.rawDb.prepare(`
      SELECT COUNT(*) AS count
      FROM module_config_generations
      WHERE module_id = 'dev.robrolabs.system-monitor'
    `).get()).toEqual({ count: 1 });

    const activeGeneration = database.rawDb.prepare(`
      SELECT active_config_generation_id
      FROM installed_modules
      WHERE slug = 'system-monitor'
    `).get();
    expect(activeGeneration).toEqual({ active_config_generation_id: generationId });
  });

  it('imports legacy slug config into encrypted installed generations without dual-writing legacy rows', async () => {
    insertInstalledModule();
    insertLegacyConfig('system-monitor', 'hosts', 'router|192.0.2.10');

    await config.setModuleConfig('system-monitor', {
      check_method: { value: 'http' },
      token: { value: 'super-secret-token', isSecret: true },
    }, 'admin');

    expect(await config.getModuleConfig('system-monitor')).toEqual({
      hosts: 'router|192.0.2.10',
      check_method: 'http',
      token: 'super-secret-token',
    });
    expect(await config.getModuleConfigForDisplay('system-monitor')).toMatchObject({
      hosts: { value: 'router|192.0.2.10', masked: false, isSecret: false },
      check_method: { value: 'http', masked: false, isSecret: false },
      token: { masked: true, isSecret: true },
    });

    expect(database.rawDb.prepare(`
      SELECT value FROM module_configs
      WHERE module_slug = 'system-monitor' AND key = 'check_method'
    `).get()).toBeUndefined();

    const generations = database.rawDb.prepare(`
      SELECT id, encrypted_values_json, parent_generation_id
      FROM module_config_generations
      WHERE module_id = 'dev.robrolabs.system-monitor'
      ORDER BY rowid
    `).all() as Array<{ id: string; encrypted_values_json: string; parent_generation_id: string | null }>;
    expect(generations).toHaveLength(2);
    expect(generations[1].parent_generation_id).toBe(generations[0].id);
    expect(generations[1].encrypted_values_json).not.toContain('super-secret-token');
    expect(generations[1].encrypted_values_json).not.toContain('router|192.0.2.10');
    expect(database.rawDb.prepare(`
      SELECT active_config_generation_id
      FROM installed_modules
      WHERE slug = 'system-monitor'
    `).get()).toEqual({ active_config_generation_id: generations[1].id });
  });

  it('treats an active installed config generation as authoritative over stale legacy fallback', async () => {
    insertInstalledModule();
    insertLegacyConfig('system-monitor', 'hosts', 'stale|192.0.2.20');

    await config.setModuleConfigValue('system-monitor', 'hosts', 'current|192.0.2.30', false, 'admin');
    expect(await config.getModuleConfig('system-monitor')).toEqual({ hosts: 'current|192.0.2.30' });

    await config.clearModuleConfig('system-monitor');

    expect(await config.getModuleConfig('system-monitor')).toEqual({});
    expect(await config.getModuleConfigForDisplay('system-monitor')).toEqual({});
    expect(database.rawDb.prepare(`
      SELECT value FROM module_configs
      WHERE module_slug = 'system-monitor' AND key = 'hosts'
    `).get()).toEqual({ value: 'stale|192.0.2.20' });
  });

  it('keeps legacy config CRUD for slugs that are not installed yet', async () => {
    await config.setModuleConfig('network', {
      pihole_url: { value: 'https://pihole.example.test' },
      api_key: { value: 'legacy-secret', isSecret: true },
    }, 'admin');

    expect(await config.getModuleConfig('network')).toEqual({
      pihole_url: 'https://pihole.example.test',
      api_key: 'legacy-secret',
    });
    expect(await config.getModuleConfigForDisplay('network')).toMatchObject({
      pihole_url: { value: 'https://pihole.example.test', masked: false, isSecret: false },
      api_key: { masked: true, isSecret: true },
    });
    expect(database.rawDb.prepare('SELECT COUNT(*) AS count FROM module_config_generations').get())
      .toEqual({ count: 0 });
  });

  it('uses installed_modules as the only enablement authority for installed packages', async () => {
    insertInstalledModule();
    database.rawDb.prepare(`
      INSERT INTO enabled_modules (module_slug, enabled, enabled_by, enabled_at)
      VALUES ('system-monitor', 1, 'admin', 'legacy-enabled-time')
    `).run();

    expect(await config.isModuleEnabled('system-monitor')).toBe(false);
    expect(await config.getEnabledModules()).toEqual([]);
    expect(database.rawDb.prepare(`
      SELECT enabled, enabled_at FROM enabled_modules WHERE module_slug = 'system-monitor'
    `).get()).toEqual({ enabled: 1, enabled_at: 'legacy-enabled-time' });

    database.rawDb.prepare(`
      UPDATE installed_modules
      SET enabled = 1, lifecycle_state = 'active', registry_epoch = registry_epoch + 1
      WHERE slug = 'system-monitor'
    `).run();

    expect(await config.isModuleEnabled('system-monitor')).toBe(true);
    expect(await config.getEnabledModules()).toEqual(['system-monitor']);
    expect(database.rawDb.prepare(`
      SELECT enabled, lifecycle_state FROM installed_modules WHERE slug = 'system-monitor'
    `).get()).toEqual({ enabled: 1, lifecycle_state: 'active' });
  });

  it('fails closed when a pinned configuration generation is missing or malformed', async () => {
    insertInstalledModule();
    const generationId = config.ensureInstalledModuleConfigGeneration('system-monitor', 'admin');
    expect(typeof generationId).toBe('string');

    database.rawDb.prepare(`
      UPDATE module_config_generations
      SET encrypted_values_json = 'not-json'
      WHERE id = ?
    `).run(generationId);

    await expect(config.getInstalledModuleConfigGeneration('system-monitor', generationId))
      .rejects.toThrow('could not be decoded');
    await expect(config.getModuleConfig('system-monitor'))
      .rejects.toThrow('could not be decoded');

    await expect(config.getInstalledModuleConfigGeneration('system-monitor', 'missing-generation'))
      .rejects.toThrow('is unavailable');
  });

  it('serializes installed config writes behind the lifecycle lease', async () => {
    insertInstalledModule();
    const generationId = config.ensureInstalledModuleConfigGeneration('system-monitor', 'admin');
    database.rawDb.prepare(`
      INSERT INTO module_lifecycle_locks (module_id, operation_id, owner, expires_at)
      VALUES ('dev.robrolabs.system-monitor', 'operation-uninstall', 'test', '2999-01-01T00:00:00.000Z')
    `).run();

    await expect(config.setModuleConfig('system-monitor', {
      hosts: { value: 'router|192.0.2.10' },
    }, 'admin', {
      expectedReleaseId: 'system-monitor-release-1',
      expectedConfigGenerationId: generationId,
    })).rejects.toMatchObject({ code: 'MODULE_BUSY' });

    expect(database.rawDb.prepare(`
      SELECT active_config_generation_id
      FROM installed_modules
      WHERE slug = 'system-monitor'
    `).get()).toEqual({ active_config_generation_id: generationId });
    expect(database.rawDb.prepare(`
      SELECT COUNT(*) AS count
      FROM module_config_generations
      WHERE module_id = 'dev.robrolabs.system-monitor'
    `).get()).toEqual({ count: 1 });
  });

  it('rejects a config save validated against a superseded release', async () => {
    insertInstalledModule();
    const generationId = config.ensureInstalledModuleConfigGeneration('system-monitor', 'admin');
    database.rawDb.prepare("UPDATE module_releases SET state = 'retained' WHERE id = 'system-monitor-release-1'").run();
    database.rawDb.prepare(`
      INSERT INTO module_releases
        (id, module_id, version, digest, artifact_path, manifest_json, ui_pages_json,
         ui_widgets_json, capabilities_json, signature_status, state, installed_at)
      VALUES ('system-monitor-release-2', 'dev.robrolabs.system-monitor', '1.0.1', ?, '/tmp/not-used-2',
              '{}', '{}', '{}', '[]', 'verified', 'active', 'later')
    `).run('b'.repeat(64));
    database.rawDb.prepare(`
      UPDATE installed_modules
      SET active_release_id = 'system-monitor-release-2',
          registry_epoch = registry_epoch + 1
      WHERE slug = 'system-monitor'
    `).run();

    await expect(config.setModuleConfig('system-monitor', {
      hosts: { value: 'router|192.0.2.11' },
    }, 'admin', {
      expectedReleaseId: 'system-monitor-release-1',
      expectedConfigGenerationId: generationId,
    })).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });

    expect(database.rawDb.prepare(`
      SELECT active_release_id, active_config_generation_id
      FROM installed_modules
      WHERE slug = 'system-monitor'
    `).get()).toEqual({
      active_release_id: 'system-monitor-release-2',
      active_config_generation_id: generationId,
    });
  });

  it('never recreates config pointers after uninstall with deleted configuration wins the race', async () => {
    insertInstalledModule();
    const generationId = config.ensureInstalledModuleConfigGeneration('system-monitor', 'admin');
    database.rawDb.prepare(`
      UPDATE installed_modules
      SET active_release_id = NULL,
          active_config_generation_id = NULL,
          active_kv_generation_id = NULL,
          active_grant_generation_id = NULL,
          enabled = 0,
          lifecycle_state = 'uninstalled',
          registry_epoch = registry_epoch + 1
      WHERE slug = 'system-monitor'
    `).run();
    database.rawDb.prepare(`
      DELETE FROM module_config_generations
      WHERE module_id = 'dev.robrolabs.system-monitor'
    `).run();

    await expect(config.setModuleConfig('system-monitor', {
      hosts: { value: 'router|192.0.2.12' },
    }, 'admin', {
      expectedReleaseId: 'system-monitor-release-1',
      expectedConfigGenerationId: generationId,
    })).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });

    expect(database.rawDb.prepare(`
      SELECT active_release_id, active_config_generation_id, lifecycle_state
      FROM installed_modules
      WHERE slug = 'system-monitor'
    `).get()).toEqual({
      active_release_id: null,
      active_config_generation_id: null,
      lifecycle_state: 'uninstalled',
    });
    expect(database.rawDb.prepare(`
      SELECT COUNT(*) AS count
      FROM module_config_generations
      WHERE module_id = 'dev.robrolabs.system-monitor'
    `).get()).toEqual({ count: 0 });
  });
});
