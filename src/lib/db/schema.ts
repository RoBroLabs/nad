// =============================================================================
// Database Schema — Drizzle ORM
// =============================================================================
// All tables for NAD. Uses SQLite initially (better-sqlite3),
// designed to be driver-swappable to PostgreSQL via Drizzle's abstraction.
//
// Conventions:
// - snake_case for table and column names
// - ISO 8601 strings for timestamps (SQLite has no native datetime)
// - JSON stored as text (SQLite has no native JSON column)
// =============================================================================

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ── Users ───────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // nanoid or cuid2
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  authVersion: integer('auth_version').notNull().default(0),
  role: text('role', { enum: ['admin', 'member', 'restricted'] }).notNull().default('member'),
  canCreatePersonalWorkspaces: integer('can_create_personal_workspaces', { mode: 'boolean' }).notNull().default(true),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(), // ISO 8601
  updatedAt: text('updated_at').notNull(), // ISO 8601
});

// ── Auth.js Tables ──────────────────────────────────────────────────────────
// These follow the Auth.js / NextAuth schema for SQLite.
// The 'accounts' table supports OAuth/OIDC providers (future Authentik).

export const sessions = sqliteTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: text('expires').notNull(),
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),
]);

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'credentials' | 'oauth' | 'oidc'
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: integer('expires_at'),
  tokenType: text('token_type'),
  scope: text('scope'),
  idToken: text('id_token'),
  sessionState: text('session_state'),
}, (table) => [
  uniqueIndex('accounts_provider_account_unique').on(table.provider, table.providerAccountId),
  index('accounts_user_id_idx').on(table.userId),
]);

export const verificationTokens = sqliteTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull().unique(),
  expires: text('expires').notNull(),
});

// ── Module Configuration ────────────────────────────────────────────────────

export const moduleConfigs = sqliteTable('module_configs', {
  id: text('id').primaryKey(),
  moduleSlug: text('module_slug').notNull(),
  key: text('key').notNull(),
  /** Value — encrypted if isSecret is true */
  value: text('value').notNull(),
  /** Whether this value is encrypted at rest */
  isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('module_configs_module_key_unique').on(table.moduleSlug, table.key),
]);

// ── Module Enabled State ────────────────────────────────────────────────────

export const enabledModules = sqliteTable('enabled_modules', {
  moduleSlug: text('module_slug').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  enabledBy: text('enabled_by').references(() => users.id),
  enabledAt: text('enabled_at').notNull(),
});

// ── Installed Module Runtime ────────────────────────────────────────────────
//
// Installed Modules keep immutable release artifacts under the NAD data
// directory. The active pointers below let core switch releases and their
// state together without rebuilding or restarting the dashboard image. The
// original slug-keyed tables remain during the static-to-installed migration
// so existing configuration, permissions, and dashboard layouts survive.

export const installedModules = sqliteTable('installed_modules', {
  moduleId: text('module_id').primaryKey(),
  slug: text('slug').notNull().unique(),
  slugAliasesJson: text('slug_aliases_json').notNull().default('[]'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  lifecycleState: text('lifecycle_state', {
    enum: ['staged', 'active', 'disabled', 'quarantined', 'error', 'uninstalled'],
  }).notNull().default('staged'),
  activeReleaseId: text('active_release_id'),
  activeConfigGenerationId: text('active_config_generation_id'),
  activeKvGenerationId: text('active_kv_generation_id'),
  activeGrantGenerationId: text('active_grant_generation_id'),
  registryEpoch: integer('registry_epoch').notNull().default(1),
  installedBy: text('installed_by').references(() => users.id),
  installedAt: text('installed_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('installed_modules_slug_unique').on(table.slug),
]);

export const moduleReleases = sqliteTable('module_releases', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull().references(() => installedModules.moduleId, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  digest: text('digest').notNull(),
  artifactPath: text('artifact_path').notNull(),
  manifestJson: text('manifest_json').notNull(),
  packageSchemaVersion: integer('package_schema_version').notNull().default(1),
  packageKind: text('package_kind', { enum: ['app', 'addon'] }).notNull().default('app'),
  dependenciesJson: text('dependencies_json').notNull().default('[]'),
  operationsJson: text('operations_json').notNull().default('{}'),
  surfacesJson: text('surfaces_json'),
  connectionSchemaJson: text('connection_schema_json'),
  uiPagesJson: text('ui_pages_json').notNull(),
  uiWidgetsJson: text('ui_widgets_json').notNull(),
  capabilitiesJson: text('capabilities_json').notNull().default('[]'),
  signerKeyId: text('signer_key_id'),
  signatureStatus: text('signature_status', { enum: ['verified', 'development'] }).notNull(),
  state: text('state', { enum: ['staged', 'active', 'retained', 'rejected', 'pruned'] }).notNull().default('staged'),
  configGenerationId: text('config_generation_id'),
  kvGenerationId: text('kv_generation_id'),
  installedAt: text('installed_at').notNull(),
}, (table) => [
  uniqueIndex('module_releases_digest_unique').on(table.digest),
  uniqueIndex('module_releases_module_version_unique').on(table.moduleId, table.version),
  uniqueIndex('module_releases_one_active_per_module_unique')
    .on(table.moduleId)
    .where(sql`state = 'active'`),
  index('module_releases_module_id_idx').on(table.moduleId),
  index('module_releases_module_state_idx').on(table.moduleId, table.state),
]);

// Exact-digest trust never follows a package name or version to a new release.
// Revocation/quarantine checks remain authoritative over these local decisions.
export const moduleReleaseTrust = sqliteTable('module_release_trust', {
  id: text('id').primaryKey(),
  releaseId: text('release_id').notNull().references(() => moduleReleases.id, { onDelete: 'cascade' }),
  digest: text('digest').notNull(),
  decision: text('decision', { enum: ['sandboxed', 'trusted'] }).notNull().default('sandboxed'),
  basis: text('basis', { enum: ['package-default', 'review-attestation', 'manual'] }).notNull().default('package-default'),
  surfaceIdsJson: text('surface_ids_json').notNull().default('[]'),
  attestationJson: text('attestation_json'),
  approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('module_release_trust_release_unique').on(table.releaseId),
  uniqueIndex('module_release_trust_digest_unique').on(table.digest),
]);

// ── App Connections ────────────────────────────────────────────────────────

export const appConnectionProfiles = sqliteTable('app_connection_profiles', {
  id: text('id').primaryKey(),
  appModuleId: text('app_module_id').notNull().references(() => installedModules.moduleId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  accessMode: text('access_mode', { enum: ['inherit', 'restricted'] }).notNull().default('inherit'),
  activeGenerationId: text('active_generation_id'),
  revision: integer('revision').notNull().default(1),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('app_connection_profiles_module_name_unique').on(table.appModuleId, table.name),
  uniqueIndex('app_connection_profiles_one_default_unique')
    .on(table.appModuleId)
    .where(sql`is_default = 1`),
  index('app_connection_profiles_module_idx').on(table.appModuleId),
]);

export const appConnectionGenerations = sqliteTable('app_connection_generations', {
  id: text('id').primaryKey(),
  connectionProfileId: text('connection_profile_id').notNull().references(() => appConnectionProfiles.id, { onDelete: 'cascade' }),
  schemaVersion: integer('schema_version').notNull().default(1),
  encryptedValuesJson: text('encrypted_values_json').notNull().default('{}'),
  parentGenerationId: text('parent_generation_id'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('app_connection_generations_profile_idx').on(table.connectionProfileId),
]);

export const appConnectionAccess = sqliteTable('app_connection_access', {
  id: text('id').primaryKey(),
  connectionProfileId: text('connection_profile_id').notNull().references(() => appConnectionProfiles.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type', { enum: ['user', 'role'] }).notNull(),
  subjectId: text('subject_id').notNull(),
  access: text('access', { enum: ['use'] }).notNull().default('use'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('app_connection_access_subject_unique')
    .on(table.connectionProfileId, table.subjectType, table.subjectId, table.access),
  index('app_connection_access_profile_idx').on(table.connectionProfileId),
]);

export const moduleDiagnostics = sqliteTable('module_diagnostics', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull().references(() => installedModules.moduleId, { onDelete: 'cascade' }),
  releaseId: text('release_id').references(() => moduleReleases.id, { onDelete: 'set null' }),
  level: text('level', { enum: ['debug', 'info', 'warn', 'error'] }).notNull(),
  message: text('message').notNull(),
  metadataJson: text('metadata_json'),
  correlationId: text('correlation_id'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('module_diagnostics_module_created_idx').on(table.moduleId, table.createdAt),
]);

export const moduleConfigGenerations = sqliteTable('module_config_generations', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull().references(() => installedModules.moduleId, { onDelete: 'cascade' }),
  schemaVersion: integer('schema_version').notNull().default(1),
  encryptedValuesJson: text('encrypted_values_json').notNull().default('{}'),
  parentGenerationId: text('parent_generation_id'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: text('created_at').notNull(),
}, (table) => [index('module_config_generations_module_id_idx').on(table.moduleId)]);

export const moduleKvGenerations = sqliteTable('module_kv_generations', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull().references(() => installedModules.moduleId, { onDelete: 'cascade' }),
  parentGenerationId: text('parent_generation_id'),
  byteCount: integer('byte_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (table) => [index('module_kv_generations_module_id_idx').on(table.moduleId)]);

export const moduleKvEntries = sqliteTable('module_kv_entries', {
  id: text('id').primaryKey(),
  generationId: text('generation_id').notNull().references(() => moduleKvGenerations.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  valueJson: text('value_json').notNull(),
  byteCount: integer('byte_count').notNull(),
}, (table) => [
  uniqueIndex('module_kv_entries_generation_key_unique').on(table.generationId, table.key),
]);

export const moduleCapabilityGrantGenerations = sqliteTable('module_capability_grant_generations', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull().references(() => installedModules.moduleId, { onDelete: 'cascade' }),
  grantsJson: text('grants_json').notNull().default('[]'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: text('created_at').notNull(),
}, (table) => [index('module_capability_grants_module_id_idx').on(table.moduleId)]);

export const moduleLifecycleLocks = sqliteTable('module_lifecycle_locks', {
  moduleId: text('module_id').primaryKey().references(() => installedModules.moduleId, { onDelete: 'cascade' }),
  operationId: text('operation_id').notNull(),
  owner: text('owner').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const moduleOperations = sqliteTable('module_operations', {
  id: text('id').primaryKey(),
  moduleId: text('module_id'),
  releaseId: text('release_id'),
  action: text('action', { enum: ['install', 'update', 'activate', 'rollback', 'disable', 'quarantine', 'uninstall', 'prune'] }).notNull(),
  stage: text('stage').notNull(),
  expectedPointersJson: text('expected_pointers_json'),
  actorId: text('actor_id').references(() => users.id),
  outcome: text('outcome', { enum: ['pending', 'succeeded', 'failed'] }).notNull().default('pending'),
  errorCode: text('error_code'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('module_operations_module_id_idx').on(table.moduleId),
  index('module_operations_created_at_idx').on(table.createdAt),
]);

// ── Marketplace Security Metadata ──────────────────────────────────────────

export const marketplaceSecurityState = sqliteTable('marketplace_security_state', {
  feed: text('feed').primaryKey(),
  sequence: integer('sequence').notNull(),
  issuedAt: text('issued_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  signerKeyId: text('signer_key_id').notNull(),
  documentSha256: text('document_sha256').notNull(),
  lastCheckedAt: text('last_checked_at').notNull(),
  lastSucceededAt: text('last_succeeded_at').notNull(),
  lastErrorCode: text('last_error_code'),
});

export const marketplaceRecommendations = sqliteTable('marketplace_recommendations', {
  moduleId: text('module_id').primaryKey(),
  moduleSlug: text('module_slug').notNull().unique(),
  version: text('version').notNull(),
  artifactSha256: text('artifact_sha256').notNull(),
  signerKeyId: text('signer_key_id').notNull(),
  snapshotSequence: integer('snapshot_sequence').notNull(),
});

export const marketplaceAdvisories = sqliteTable('marketplace_advisories', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull(),
  moduleSlug: text('module_slug').notNull(),
  moduleName: text('module_name').notNull(),
  severity: text('severity', { enum: ['low', 'moderate', 'high', 'critical'] }).notNull(),
  status: text('status', { enum: ['open', 'resolved'] }).notNull(),
  publishedAt: text('published_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  guidance: text('guidance').notNull(),
  affectedJson: text('affected_json').notNull(),
  affectedVersionsJson: text('affected_versions_json').notNull(),
  fixedVersionsJson: text('fixed_versions_json').notNull(),
  referencesJson: text('references_json').notNull(),
  path: text('path').notNull(),
  url: text('url').notNull(),
  firstSeenSequence: integer('first_seen_sequence').notNull(),
  lastSeenSequence: integer('last_seen_sequence').notNull(),
}, (table) => [
  index('marketplace_advisories_module_slug_idx').on(table.moduleSlug),
  index('marketplace_advisories_status_idx').on(table.status),
]);

export const marketplaceRevocations = sqliteTable('marketplace_revocations', {
  id: text('id').primaryKey(),
  targetType: text('target_type', { enum: ['artifact', 'signing-key'] }).notNull(),
  targetValue: text('target_value').notNull(),
  moduleId: text('module_id').notNull(),
  moduleSlug: text('module_slug').notNull(),
  moduleName: text('module_name').notNull(),
  version: text('version').notNull(),
  severity: text('severity', { enum: ['low', 'moderate', 'high', 'critical'] }).notNull(),
  action: text('action', { enum: ['warn', 'quarantine'] }).notNull(),
  publishedAt: text('published_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  reason: text('reason').notNull(),
  summary: text('summary').notNull(),
  replacementVersion: text('replacement_version'),
  firstSeenSequence: integer('first_seen_sequence').notNull(),
  lastSeenSequence: integer('last_seen_sequence').notNull(),
}, (table) => [
  uniqueIndex('marketplace_revocations_target_unique').on(table.targetType, table.targetValue),
  index('marketplace_revocations_module_slug_idx').on(table.moduleSlug),
  index('marketplace_revocations_action_idx').on(table.action),
]);

// ── User Permissions (RBAC) ─────────────────────────────────────────────────

export const userPermissions = sqliteTable('user_permissions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  moduleSlug: text('module_slug').notNull(),
  /** JSON array of allowed actions, e.g., ["view", "restart"] */
  actions: text('actions').notNull(), // JSON array stored as text
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('user_permissions_user_module_unique').on(table.userId, table.moduleSlug),
]);

// ── Widget Layouts ──────────────────────────────────────────────────────────

export const widgetLayouts = sqliteTable('widget_layouts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Which page this layout belongs to (e.g., 'home', 'media-dashboard') */
  pageSlug: text('page_slug').notNull(),
  /** react-grid-layout state serialised as JSON */
  layoutJson: text('layout_json').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('widget_layouts_user_page_unique').on(table.userId, table.pageSlug),
]);

// ── Workspaces ─────────────────────────────────────────────────────────────

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['personal', 'shared', 'template'] }).notNull(),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('workspaces_owner_idx').on(table.ownerUserId),
  index('workspaces_kind_idx').on(table.kind),
]);

export const workspaceAssignments = sqliteTable('workspace_assignments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type', { enum: ['user', 'role', 'all'] }).notNull(),
  // `all` assignments use an empty subject ID so uniqueness remains effective.
  subjectId: text('subject_id').notNull().default(''),
  access: text('access', { enum: ['view', 'edit'] }).notNull(),
}, (table) => [
  uniqueIndex('workspace_assignments_subject_unique')
    .on(table.workspaceId, table.subjectType, table.subjectId),
  index('workspace_assignments_workspace_idx').on(table.workspaceId),
]);

export const workspaceTabs = sqliteTable('workspace_tabs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  kind: text('kind', { enum: ['grid', 'surface'] }).notNull(),
  surfaceModuleSlug: text('surface_module_slug'),
  surfaceId: text('surface_id'),
  connectionProfileId: text('connection_profile_id').references(() => appConnectionProfiles.id, { onDelete: 'set null' }),
}, (table) => [
  uniqueIndex('workspace_tabs_position_unique').on(table.workspaceId, table.position),
  index('workspace_tabs_workspace_idx').on(table.workspaceId),
]);

export const workspaceWidgetInstances = sqliteTable('workspace_widget_instances', {
  id: text('id').primaryKey(),
  tabId: text('tab_id').notNull().references(() => workspaceTabs.id, { onDelete: 'cascade' }),
  instanceId: text('instance_id').notNull(),
  moduleSlug: text('module_slug').notNull(),
  widgetId: text('widget_id').notNull(),
  connectionProfileId: text('connection_profile_id').references(() => appConnectionProfiles.id, { onDelete: 'set null' }),
  chrome: text('chrome', { enum: ['standard', 'solid', 'frameless'] }).notNull().default('standard'),
  settingsJson: text('settings_json').notNull().default('{}'),
}, (table) => [
  uniqueIndex('workspace_widget_instances_tab_instance_unique').on(table.tabId, table.instanceId),
  index('workspace_widget_instances_tab_idx').on(table.tabId),
]);

export const workspaceTabLayouts = sqliteTable('workspace_tab_layouts', {
  id: text('id').primaryKey(),
  tabId: text('tab_id').notNull().references(() => workspaceTabs.id, { onDelete: 'cascade' }),
  breakpoint: text('breakpoint').notNull(),
  layoutJson: text('layout_json').notNull(),
}, (table) => [
  uniqueIndex('workspace_tab_layouts_breakpoint_unique').on(table.tabId, table.breakpoint),
  index('workspace_tab_layouts_tab_idx').on(table.tabId),
]);

// ── Audit Log ───────────────────────────────────────────────────────────────

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  /** Immutable actor identifier retained even after the user is deleted. */
  userId: text('user_id'),
  /** What action was performed (e.g., 'restart_server', 'update_config') */
  action: text('action').notNull(),
  /** Which module the action relates to */
  moduleSlug: text('module_slug'),
  /** Additional context as JSON */
  details: text('details'), // JSON
  ipAddress: text('ip_address'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('audit_log_created_at_idx').on(table.createdAt),
  index('audit_log_module_slug_idx').on(table.moduleSlug),
]);

// ── Notification Channels ───────────────────────────────────────────────────

export const notificationChannels = sqliteTable('notification_channels', {
  id: text('id').primaryKey(),
  /** Channel type identifier */
  type: text('type', { enum: ['email', 'telegram', 'discord', 'ntfy'] }).notNull(),
  /** Channel configuration as encrypted JSON (contains tokens, chat IDs, etc.) */
  config: text('config').notNull(),
  /** Whether this channel is active */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ── App Settings ────────────────────────────────────────────────────────────

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// =============================================================================
// Type Exports (for use in application code)
// =============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;

export type ModuleConfig = typeof moduleConfigs.$inferSelect;
export type NewModuleConfig = typeof moduleConfigs.$inferInsert;

export type EnabledModule = typeof enabledModules.$inferSelect;
export type InstalledModule = typeof installedModules.$inferSelect;
export type ModuleRelease = typeof moduleReleases.$inferSelect;
export type ModuleReleaseTrust = typeof moduleReleaseTrust.$inferSelect;
export type AppConnectionProfile = typeof appConnectionProfiles.$inferSelect;
export type AppConnectionGeneration = typeof appConnectionGenerations.$inferSelect;
export type AppConnectionAccess = typeof appConnectionAccess.$inferSelect;
export type ModuleDiagnostic = typeof moduleDiagnostics.$inferSelect;
export type ModuleOperation = typeof moduleOperations.$inferSelect;
export type MarketplaceSecurityState = typeof marketplaceSecurityState.$inferSelect;
export type MarketplaceRecommendation = typeof marketplaceRecommendations.$inferSelect;
export type MarketplaceAdvisory = typeof marketplaceAdvisories.$inferSelect;
export type MarketplaceRevocation = typeof marketplaceRevocations.$inferSelect;
export type UserPermission = typeof userPermissions.$inferSelect;
export type WidgetLayout = typeof widgetLayouts.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceAssignment = typeof workspaceAssignments.$inferSelect;
export type WorkspaceTab = typeof workspaceTabs.$inferSelect;
export type WorkspaceWidgetInstance = typeof workspaceWidgetInstances.$inferSelect;
export type WorkspaceTabLayout = typeof workspaceTabLayouts.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
