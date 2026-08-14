import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  apply: (database: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    apply(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS users (
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

        CREATE TABLE IF NOT EXISTS sessions (
          session_token TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_account_id TEXT NOT NULL,
          refresh_token TEXT,
          access_token TEXT,
          expires_at INTEGER,
          token_type TEXT,
          scope TEXT,
          id_token TEXT,
          session_state TEXT
        );

        CREATE TABLE IF NOT EXISTS verification_tokens (
          identifier TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS module_configs (
          id TEXT PRIMARY KEY NOT NULL,
          module_slug TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          is_secret INTEGER NOT NULL DEFAULT 0,
          updated_by TEXT REFERENCES users(id),
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS enabled_modules (
          module_slug TEXT PRIMARY KEY NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          enabled_by TEXT REFERENCES users(id),
          enabled_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_permissions (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          module_slug TEXT NOT NULL,
          actions TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS widget_layouts (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          page_slug TEXT NOT NULL,
          layout_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT REFERENCES users(id),
          action TEXT NOT NULL,
          module_slug TEXT,
          details TEXT,
          ip_address TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notification_channels (
          id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL,
          config TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        DELETE FROM module_configs
        WHERE rowid NOT IN (
          SELECT MAX(rowid) FROM module_configs GROUP BY module_slug, key
        );
        DELETE FROM user_permissions
        WHERE rowid NOT IN (
          SELECT MAX(rowid) FROM user_permissions GROUP BY user_id, module_slug
        );
        DELETE FROM widget_layouts
        WHERE rowid NOT IN (
          SELECT MAX(rowid) FROM widget_layouts GROUP BY user_id, page_slug
        );
        DELETE FROM accounts
        WHERE rowid NOT IN (
          SELECT MAX(rowid) FROM accounts GROUP BY provider, provider_account_id
        );

        CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_unique
          ON accounts(provider, provider_account_id);
        CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS module_configs_module_key_unique
          ON module_configs(module_slug, key);
        CREATE UNIQUE INDEX IF NOT EXISTS user_permissions_user_module_unique
          ON user_permissions(user_id, module_slug);
        CREATE UNIQUE INDEX IF NOT EXISTS widget_layouts_user_page_unique
          ON widget_layouts(user_id, page_slug);
        CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at);
        CREATE INDEX IF NOT EXISTS audit_log_module_slug_idx ON audit_log(module_slug);
      `);
    },
  },
  {
    version: 2,
    name: 'invalidate_sessions_after_password_change',
    apply(database) {
      const columns = database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === 'auth_version')) {
        database.exec('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;');
      }
    },
  },
  {
    version: 3,
    name: 'retain_audit_actor_after_user_deletion',
    apply(database) {
      database.exec(`
        CREATE TABLE audit_log_replacement (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT,
          action TEXT NOT NULL,
          module_slug TEXT,
          details TEXT,
          ip_address TEXT,
          created_at TEXT NOT NULL
        );

        INSERT INTO audit_log_replacement
          (id, user_id, action, module_slug, details, ip_address, created_at)
        SELECT id, user_id, action, module_slug, details, ip_address, created_at
        FROM audit_log;

        DROP TABLE audit_log;
        ALTER TABLE audit_log_replacement RENAME TO audit_log;
        CREATE INDEX audit_log_created_at_idx ON audit_log(created_at);
        CREATE INDEX audit_log_module_slug_idx ON audit_log(module_slug);
      `);
    },
  },
  {
    version: 4,
    name: 'installed_module_runtime',
    apply(database) {
      database.exec(`
        CREATE TABLE installed_modules (
          module_id TEXT PRIMARY KEY NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          slug_aliases_json TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 0,
          lifecycle_state TEXT NOT NULL DEFAULT 'staged',
          active_release_id TEXT,
          active_config_generation_id TEXT,
          active_kv_generation_id TEXT,
          active_grant_generation_id TEXT,
          registry_epoch INTEGER NOT NULL DEFAULT 1,
          installed_by TEXT REFERENCES users(id),
          installed_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE module_releases (
          id TEXT PRIMARY KEY NOT NULL,
          module_id TEXT NOT NULL REFERENCES installed_modules(module_id) ON DELETE CASCADE,
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

        CREATE TABLE module_config_generations (
          id TEXT PRIMARY KEY NOT NULL,
          module_id TEXT NOT NULL REFERENCES installed_modules(module_id) ON DELETE CASCADE,
          schema_version INTEGER NOT NULL DEFAULT 1,
          encrypted_values_json TEXT NOT NULL DEFAULT '{}',
          parent_generation_id TEXT,
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL
        );

        CREATE TABLE module_kv_generations (
          id TEXT PRIMARY KEY NOT NULL,
          module_id TEXT NOT NULL REFERENCES installed_modules(module_id) ON DELETE CASCADE,
          parent_generation_id TEXT,
          byte_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE module_kv_entries (
          id TEXT PRIMARY KEY NOT NULL,
          generation_id TEXT NOT NULL REFERENCES module_kv_generations(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          byte_count INTEGER NOT NULL
        );

        CREATE TABLE module_capability_grant_generations (
          id TEXT PRIMARY KEY NOT NULL,
          module_id TEXT NOT NULL REFERENCES installed_modules(module_id) ON DELETE CASCADE,
          grants_json TEXT NOT NULL DEFAULT '[]',
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL
        );

        CREATE TABLE module_lifecycle_locks (
          module_id TEXT PRIMARY KEY NOT NULL REFERENCES installed_modules(module_id) ON DELETE CASCADE,
          operation_id TEXT NOT NULL,
          owner TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );

        CREATE TABLE module_operations (
          id TEXT PRIMARY KEY NOT NULL,
          module_id TEXT,
          release_id TEXT,
          action TEXT NOT NULL,
          stage TEXT NOT NULL,
          expected_pointers_json TEXT,
          actor_id TEXT REFERENCES users(id),
          outcome TEXT NOT NULL DEFAULT 'pending',
          error_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX installed_modules_slug_unique ON installed_modules(slug);
        CREATE UNIQUE INDEX module_releases_digest_unique ON module_releases(digest);
        CREATE UNIQUE INDEX module_releases_module_version_unique
          ON module_releases(module_id, version);
        CREATE INDEX module_releases_module_id_idx ON module_releases(module_id);
        CREATE INDEX module_config_generations_module_id_idx
          ON module_config_generations(module_id);
        CREATE INDEX module_kv_generations_module_id_idx ON module_kv_generations(module_id);
        CREATE UNIQUE INDEX module_kv_entries_generation_key_unique
          ON module_kv_entries(generation_id, key);
        CREATE INDEX module_capability_grants_module_id_idx
          ON module_capability_grant_generations(module_id);
        CREATE INDEX module_operations_module_id_idx ON module_operations(module_id);
        CREATE INDEX module_operations_created_at_idx ON module_operations(created_at);
      `);
    },
  },
  {
    version: 5,
    name: 'installed_module_lifecycle_invariants',
    apply(database) {
      database.exec(`
        UPDATE module_releases
        SET state = 'retained'
        WHERE state = 'active'
          AND id NOT IN (
            SELECT active_release_id
            FROM installed_modules
            WHERE active_release_id IS NOT NULL
          );

        CREATE UNIQUE INDEX IF NOT EXISTS module_releases_one_active_per_module_unique
          ON module_releases(module_id)
          WHERE state = 'active';
        CREATE INDEX IF NOT EXISTS module_releases_module_state_idx
          ON module_releases(module_id, state);
      `);
    },
  },
  {
    version: 6,
    name: 'import_legacy_installed_module_config',
    apply(database) {
      database.exec(`
        CREATE TEMP TABLE legacy_module_config_imports (
          module_id TEXT PRIMARY KEY NOT NULL,
          generation_id TEXT NOT NULL,
          parent_generation_id TEXT,
          created_at TEXT NOT NULL
        );

        INSERT INTO legacy_module_config_imports
          (module_id, generation_id, parent_generation_id, created_at)
        SELECT
          installed_modules.module_id,
          'legacy-import-' || lower(hex(randomblob(16))),
          installed_modules.active_config_generation_id,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM installed_modules
        WHERE EXISTS (
          SELECT 1
          FROM module_configs
          WHERE module_configs.module_slug = installed_modules.slug
        )
          AND (
            installed_modules.active_config_generation_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM module_config_generations
              WHERE module_config_generations.id = installed_modules.active_config_generation_id
            )
            OR NOT EXISTS (
              SELECT 1
              FROM module_config_generations, json_each(module_config_generations.encrypted_values_json)
              WHERE module_config_generations.id = installed_modules.active_config_generation_id
            )
          );

        INSERT INTO module_config_generations
          (id, module_id, schema_version, encrypted_values_json,
           parent_generation_id, created_by, created_at)
        SELECT
          imports.generation_id,
          imports.module_id,
          1,
          (
            SELECT json_group_object(
              module_configs.key,
              json_object(
                'value', module_configs.value,
                'encrypted', json(CASE WHEN module_configs.is_secret = 1 THEN 'true' ELSE 'false' END),
                'isSecret', json(CASE WHEN module_configs.is_secret = 1 THEN 'true' ELSE 'false' END),
                'updatedBy', module_configs.updated_by,
                'updatedAt', module_configs.updated_at
              )
            )
            FROM module_configs
            JOIN installed_modules ON installed_modules.slug = module_configs.module_slug
            WHERE installed_modules.module_id = imports.module_id
          ),
          imports.parent_generation_id,
          NULL,
          imports.created_at
        FROM legacy_module_config_imports AS imports;

        UPDATE installed_modules
        SET active_config_generation_id = (
              SELECT generation_id
              FROM legacy_module_config_imports
              WHERE legacy_module_config_imports.module_id = installed_modules.module_id
            ),
            registry_epoch = registry_epoch + 1,
            updated_at = (
              SELECT created_at
              FROM legacy_module_config_imports
              WHERE legacy_module_config_imports.module_id = installed_modules.module_id
            )
        WHERE module_id IN (SELECT module_id FROM legacy_module_config_imports);

        DROP TABLE legacy_module_config_imports;
      `);
    },
  },
  {
    version: 7,
    name: 'release_data_generation_pointers',
    apply(database) {
      const columns = database.prepare('PRAGMA table_info(module_releases)').all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === 'config_generation_id')) {
        database.exec('ALTER TABLE module_releases ADD COLUMN config_generation_id TEXT;');
      }
      if (!columns.some(({ name }) => name === 'kv_generation_id')) {
        database.exec('ALTER TABLE module_releases ADD COLUMN kv_generation_id TEXT;');
      }

      database.exec(`
        UPDATE module_releases
        SET config_generation_id = COALESCE(
              config_generation_id,
              (
                SELECT installed_modules.active_config_generation_id
                FROM installed_modules
                WHERE installed_modules.module_id = module_releases.module_id
              )
            ),
            kv_generation_id = COALESCE(
              kv_generation_id,
              (
                SELECT installed_modules.active_kv_generation_id
                FROM installed_modules
                WHERE installed_modules.module_id = module_releases.module_id
              )
            )
        WHERE state IN ('active', 'retained', 'pruned')
          AND EXISTS (
            SELECT 1
            FROM installed_modules
            WHERE installed_modules.module_id = module_releases.module_id
          );
      `);
    },
  },
  {
    version: 8,
    name: 'marketplace_security_metadata',
    apply(database) {
      database.exec(`
        CREATE TABLE marketplace_security_state (
          feed TEXT PRIMARY KEY NOT NULL,
          sequence INTEGER NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          signer_key_id TEXT NOT NULL,
          document_sha256 TEXT NOT NULL,
          last_checked_at TEXT NOT NULL,
          last_succeeded_at TEXT NOT NULL,
          last_error_code TEXT
        );

        CREATE TABLE marketplace_recommendations (
          module_id TEXT PRIMARY KEY NOT NULL,
          module_slug TEXT NOT NULL UNIQUE,
          version TEXT NOT NULL,
          artifact_sha256 TEXT NOT NULL,
          signer_key_id TEXT NOT NULL,
          snapshot_sequence INTEGER NOT NULL
        );

        CREATE TABLE marketplace_advisories (
          id TEXT PRIMARY KEY NOT NULL,
          module_id TEXT NOT NULL,
          module_slug TEXT NOT NULL,
          module_name TEXT NOT NULL,
          severity TEXT NOT NULL,
          status TEXT NOT NULL,
          published_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          guidance TEXT NOT NULL,
          affected_json TEXT NOT NULL,
          affected_versions_json TEXT NOT NULL,
          fixed_versions_json TEXT NOT NULL,
          references_json TEXT NOT NULL,
          path TEXT NOT NULL,
          url TEXT NOT NULL,
          first_seen_sequence INTEGER NOT NULL,
          last_seen_sequence INTEGER NOT NULL
        );

        CREATE TABLE marketplace_revocations (
          id TEXT PRIMARY KEY NOT NULL,
          target_type TEXT NOT NULL,
          target_value TEXT NOT NULL,
          module_id TEXT NOT NULL,
          module_slug TEXT NOT NULL,
          module_name TEXT NOT NULL,
          version TEXT NOT NULL,
          severity TEXT NOT NULL,
          action TEXT NOT NULL,
          published_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          reason TEXT NOT NULL,
          summary TEXT NOT NULL,
          replacement_version TEXT,
          first_seen_sequence INTEGER NOT NULL,
          last_seen_sequence INTEGER NOT NULL
        );

        CREATE INDEX marketplace_advisories_module_slug_idx
          ON marketplace_advisories(module_slug);
        CREATE INDEX marketplace_advisories_status_idx
          ON marketplace_advisories(status);
        CREATE UNIQUE INDEX marketplace_revocations_target_unique
          ON marketplace_revocations(target_type, target_value);
        CREATE INDEX marketplace_revocations_module_slug_idx
          ON marketplace_revocations(module_slug);
        CREATE INDEX marketplace_revocations_action_idx
          ON marketplace_revocations(action);
      `);
    },
  },
  {
    version: 9,
    name: 'apps_connections_and_exact_digest_trust',
    apply(database) {
      const userColumns = database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
      if (!userColumns.some(({ name }) => name === 'can_create_personal_workspaces')) {
        database.exec('ALTER TABLE users ADD COLUMN can_create_personal_workspaces INTEGER NOT NULL DEFAULT 1;');
      }

      const releaseColumns = database.prepare('PRAGMA table_info(module_releases)').all() as Array<{ name: string }>;
      if (!releaseColumns.some(({ name }) => name === 'package_schema_version')) {
        database.exec('ALTER TABLE module_releases ADD COLUMN package_schema_version INTEGER NOT NULL DEFAULT 1;');
      }
      if (!releaseColumns.some(({ name }) => name === 'package_kind')) {
        database.exec("ALTER TABLE module_releases ADD COLUMN package_kind TEXT NOT NULL DEFAULT 'app';");
      }
      if (!releaseColumns.some(({ name }) => name === 'dependencies_json')) {
        database.exec("ALTER TABLE module_releases ADD COLUMN dependencies_json TEXT NOT NULL DEFAULT '[]';");
      }
      if (!releaseColumns.some(({ name }) => name === 'operations_json')) {
        database.exec("ALTER TABLE module_releases ADD COLUMN operations_json TEXT NOT NULL DEFAULT '{}';");
      }
      if (!releaseColumns.some(({ name }) => name === 'surfaces_json')) {
        database.exec('ALTER TABLE module_releases ADD COLUMN surfaces_json TEXT;');
      }
      if (!releaseColumns.some(({ name }) => name === 'connection_schema_json')) {
        database.exec('ALTER TABLE module_releases ADD COLUMN connection_schema_json TEXT;');
      }

      database.exec(`
        CREATE TABLE module_release_trust (
          id TEXT PRIMARY KEY NOT NULL,
          release_id TEXT NOT NULL REFERENCES module_releases(id) ON DELETE CASCADE,
          digest TEXT NOT NULL,
          decision TEXT NOT NULL DEFAULT 'sandboxed',
          basis TEXT NOT NULL DEFAULT 'package-default',
          surface_ids_json TEXT NOT NULL DEFAULT '[]',
          attestation_json TEXT,
          approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX module_release_trust_release_unique
          ON module_release_trust(release_id);
        CREATE UNIQUE INDEX module_release_trust_digest_unique
          ON module_release_trust(digest);

        CREATE TABLE app_connection_profiles (
          id TEXT PRIMARY KEY NOT NULL,
          app_module_id TEXT NOT NULL REFERENCES installed_modules(module_id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          is_default INTEGER NOT NULL DEFAULT 0,
          access_mode TEXT NOT NULL DEFAULT 'inherit',
          active_generation_id TEXT,
          revision INTEGER NOT NULL DEFAULT 1,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX app_connection_profiles_module_name_unique
          ON app_connection_profiles(app_module_id, name);
        CREATE UNIQUE INDEX app_connection_profiles_one_default_unique
          ON app_connection_profiles(app_module_id) WHERE is_default = 1;
        CREATE INDEX app_connection_profiles_module_idx
          ON app_connection_profiles(app_module_id);

        CREATE TABLE app_connection_generations (
          id TEXT PRIMARY KEY NOT NULL,
          connection_profile_id TEXT NOT NULL REFERENCES app_connection_profiles(id) ON DELETE CASCADE,
          schema_version INTEGER NOT NULL DEFAULT 1,
          encrypted_values_json TEXT NOT NULL DEFAULT '{}',
          parent_generation_id TEXT,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX app_connection_generations_profile_idx
          ON app_connection_generations(connection_profile_id);

        CREATE TABLE app_connection_access (
          id TEXT PRIMARY KEY NOT NULL,
          connection_profile_id TEXT NOT NULL REFERENCES app_connection_profiles(id) ON DELETE CASCADE,
          subject_type TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          access TEXT NOT NULL DEFAULT 'use',
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX app_connection_access_subject_unique
          ON app_connection_access(connection_profile_id, subject_type, subject_id, access);
        CREATE INDEX app_connection_access_profile_idx
          ON app_connection_access(connection_profile_id);

        CREATE TABLE module_diagnostics (
          id TEXT PRIMARY KEY NOT NULL,
          module_id TEXT NOT NULL REFERENCES installed_modules(module_id) ON DELETE CASCADE,
          release_id TEXT REFERENCES module_releases(id) ON DELETE SET NULL,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          metadata_json TEXT,
          correlation_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX module_diagnostics_module_created_idx
          ON module_diagnostics(module_id, created_at);

        INSERT INTO module_release_trust
          (id, release_id, digest, decision, basis, surface_ids_json, created_at, updated_at)
        SELECT
          'trust:' || id,
          id,
          digest,
          'sandboxed',
          'package-default',
          '[]',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM module_releases;

        INSERT INTO app_connection_profiles
          (id, app_module_id, name, enabled, is_default, access_mode,
           active_generation_id, revision, created_by, created_at, updated_at)
        SELECT
          'default-profile:' || module_id,
          module_id,
          'Default',
          1,
          1,
          'inherit',
          'default-profile-generation:' || module_id,
          1,
          NULL,
          installed_at,
          updated_at
        FROM installed_modules
        WHERE active_release_id IS NOT NULL;

        INSERT INTO app_connection_generations
          (id, connection_profile_id, schema_version, encrypted_values_json,
           parent_generation_id, created_by, created_at)
        SELECT
          'default-profile-generation:' || installed_modules.module_id,
          'default-profile:' || installed_modules.module_id,
          1,
          COALESCE(module_config_generations.encrypted_values_json, '{}'),
          NULL,
          NULL,
          installed_modules.updated_at
        FROM installed_modules
        LEFT JOIN module_config_generations
          ON module_config_generations.id = installed_modules.active_config_generation_id
        WHERE installed_modules.active_release_id IS NOT NULL;

        INSERT OR IGNORE INTO app_settings (key, value, updated_at)
        VALUES (
          'module.trusted_code_policy',
          'reviewed_auto',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      `);
    },
  },
  {
    version: 10,
    name: 'workspaces_tabs_and_surface_access',
    apply(database) {
      database.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX workspaces_owner_idx ON workspaces(owner_user_id);
        CREATE INDEX workspaces_kind_idx ON workspaces(kind);

        CREATE TABLE workspace_assignments (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          subject_type TEXT NOT NULL,
          subject_id TEXT NOT NULL DEFAULT '',
          access TEXT NOT NULL
        );
        CREATE UNIQUE INDEX workspace_assignments_subject_unique
          ON workspace_assignments(workspace_id, subject_type, subject_id);
        CREATE INDEX workspace_assignments_workspace_idx
          ON workspace_assignments(workspace_id);

        CREATE TABLE workspace_tabs (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          position INTEGER NOT NULL,
          kind TEXT NOT NULL,
          surface_module_slug TEXT,
          surface_id TEXT,
          connection_profile_id TEXT REFERENCES app_connection_profiles(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX workspace_tabs_position_unique
          ON workspace_tabs(workspace_id, position);
        CREATE INDEX workspace_tabs_workspace_idx ON workspace_tabs(workspace_id);

        CREATE TABLE workspace_widget_instances (
          id TEXT PRIMARY KEY NOT NULL,
          tab_id TEXT NOT NULL REFERENCES workspace_tabs(id) ON DELETE CASCADE,
          instance_id TEXT NOT NULL,
          module_slug TEXT NOT NULL,
          widget_id TEXT NOT NULL,
          connection_profile_id TEXT REFERENCES app_connection_profiles(id) ON DELETE SET NULL,
          chrome TEXT NOT NULL DEFAULT 'standard',
          settings_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE UNIQUE INDEX workspace_widget_instances_tab_instance_unique
          ON workspace_widget_instances(tab_id, instance_id);
        CREATE INDEX workspace_widget_instances_tab_idx
          ON workspace_widget_instances(tab_id);

        CREATE TABLE workspace_tab_layouts (
          id TEXT PRIMARY KEY NOT NULL,
          tab_id TEXT NOT NULL REFERENCES workspace_tabs(id) ON DELETE CASCADE,
          breakpoint TEXT NOT NULL,
          layout_json TEXT NOT NULL
        );
        CREATE UNIQUE INDEX workspace_tab_layouts_breakpoint_unique
          ON workspace_tab_layouts(tab_id, breakpoint);
        CREATE INDEX workspace_tab_layouts_tab_idx ON workspace_tab_layouts(tab_id);

        INSERT INTO workspaces
          (id, name, kind, owner_user_id, created_by, pinned, created_at, updated_at)
        SELECT
          'legacy-home-workspace:' || widget_layouts.id,
          'Home',
          'personal',
          widget_layouts.user_id,
          widget_layouts.user_id,
          1,
          widget_layouts.updated_at,
          widget_layouts.updated_at
        FROM widget_layouts
        WHERE widget_layouts.page_slug = 'home';

        INSERT INTO workspace_tabs
          (id, workspace_id, name, position, kind)
        SELECT
          'legacy-home-tab:' || widget_layouts.id,
          'legacy-home-workspace:' || widget_layouts.id,
          'Overview',
          0,
          'grid'
        FROM widget_layouts
        WHERE widget_layouts.page_slug = 'home';

        INSERT INTO workspace_widget_instances
          (id, tab_id, instance_id, module_slug, widget_id, chrome, settings_json)
        SELECT
          'legacy-widget:' || widget_layouts.id || ':' || widgets.key,
          'legacy-home-tab:' || widget_layouts.id,
          json_extract(widgets.value, '$.instanceId'),
          json_extract(widgets.value, '$.moduleSlug'),
          json_extract(widgets.value, '$.widgetId'),
          'standard',
          '{}'
        FROM widget_layouts,
             json_each(
               CASE WHEN json_valid(widget_layouts.layout_json) THEN widget_layouts.layout_json ELSE '{}' END,
               '$.widgets'
             ) AS widgets
        WHERE widget_layouts.page_slug = 'home'
          AND json_valid(widget_layouts.layout_json)
          AND json_type(widgets.value, '$.instanceId') = 'text'
          AND json_type(widgets.value, '$.moduleSlug') = 'text'
          AND json_type(widgets.value, '$.widgetId') = 'text';

        INSERT INTO workspace_tab_layouts (id, tab_id, breakpoint, layout_json)
        SELECT
          'legacy-layout:' || widget_layouts.id || ':' || layouts.key,
          'legacy-home-tab:' || widget_layouts.id,
          layouts.key,
          json(layouts.value)
        FROM widget_layouts,
             json_each(
               CASE WHEN json_valid(widget_layouts.layout_json) THEN widget_layouts.layout_json ELSE '{}' END,
               '$.layouts'
             ) AS layouts
        WHERE widget_layouts.page_slug = 'home'
          AND json_valid(widget_layouts.layout_json)
          AND json_type(layouts.value) = 'array';
      `);
    },
  },
];

export function migrateDatabase(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS homedashboard_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedVersions = new Set(
    database
      .prepare('SELECT version FROM homedashboard_migrations')
      .all()
      .map((record) => (record as { version: number }).version),
  );
  const recordMigration = database.prepare(
    'INSERT INTO homedashboard_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    database.transaction(() => {
      migration.apply(database);
      recordMigration.run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}
