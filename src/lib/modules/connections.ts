import 'server-only';

import { randomUUID } from 'node:crypto';
import { rawDb } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/crypto';
import { hasPermission } from '@/lib/auth/permissions';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { generateId, now } from '@/lib/utils';
import type { NADV2ConnectionProfileSchema } from '@/lib/modules/contracts/v2';

const MAX_PROFILES_PER_APP = 64;
const MAX_CONNECTION_FIELDS = 128;
const MAX_CONNECTION_VALUE_BYTES = 64 * 1024;
const MAX_CONNECTION_TOTAL_BYTES = 256 * 1024;
const connectionNamePattern = /^[^\u0000-\u001f\u007f]{1,80}$/;
const connectionKeyPattern = /^[a-z][a-z0-9_]{0,79}$/;

interface StoredConnectionValue {
  value: string;
  encrypted: boolean;
  isSecret: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

type StoredConnectionValues = Record<string, StoredConnectionValue>;

interface ConnectionRow {
  id: string;
  app_module_id: string;
  app_slug: string;
  name: string;
  enabled: number;
  is_default: number;
  access_mode: 'inherit' | 'restricted';
  active_generation_id: string | null;
  revision: number;
  lifecycle_state: string;
  app_enabled: number;
  package_kind: 'app' | 'addon';
}

export interface ConnectionProfileSummary {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AdminConnectionProfile extends ConnectionProfileSummary {
  enabled: boolean;
  isDefault: boolean;
  accessMode: 'inherit' | 'restricted';
  revision: number;
  generationId: string | null;
  fields: Record<string, { present: boolean; isSecret: boolean; value?: string }>;
}

export interface ConnectionProfileInput {
  name: string;
  values: Record<string, { value: string; isSecret?: boolean }>;
  accessMode?: 'inherit' | 'restricted';
  enabled?: boolean;
  isDefault?: boolean;
  schemaVersion?: number;
}

export interface PinnedConnectionProfile {
  id: string;
  name: string;
  appModuleId: string;
  appSlug: string;
  generationId: string;
  revision: number;
  values: Readonly<Record<string, string>>;
}

export interface ConnectionAccessGrantInput {
  subjectType: 'user' | 'role';
  subjectId: string;
}

/**
 * Creates the compatibility `Default` profile without decrypting or rewriting
 * the active v1 generation. Safe to call from the package lifecycle transaction.
 */
export function ensureDefaultConnectionProfile(
  appModuleId: string,
  sourceConfigGenerationId: string | null,
  actorId: string,
  schemaVersion = 1,
): string {
  const existing = rawDb.prepare(`
    SELECT id FROM app_connection_profiles
    WHERE app_module_id = ? AND is_default = 1
  `).get(appModuleId) as { id: string } | undefined;
  if (existing) return existing.id;
  const timestamp = now();
  const profileId = generateId();
  const generationId = generateId();
  const source = sourceConfigGenerationId
    ? rawDb.prepare(`
        SELECT encrypted_values_json FROM module_config_generations
        WHERE id = ? AND module_id = ?
      `).get(sourceConfigGenerationId, appModuleId) as { encrypted_values_json: string } | undefined
    : undefined;
  rawDb.prepare(`
    INSERT INTO app_connection_profiles
      (id, app_module_id, name, enabled, is_default, access_mode,
       active_generation_id, revision, created_by, created_at, updated_at)
    VALUES (?, ?, 'Default', 1, 1, 'inherit', ?, 1, ?, ?, ?)
  `).run(profileId, appModuleId, generationId, actorId, timestamp, timestamp);
  rawDb.prepare(`
    INSERT INTO app_connection_generations
      (id, connection_profile_id, schema_version, encrypted_values_json,
       parent_generation_id, created_by, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `).run(generationId, profileId, schemaVersion, source?.encrypted_values_json ?? '{}', actorId, timestamp);
  return profileId;
}

function connectionRow(profileId: string): ConnectionRow | undefined {
  return rawDb.prepare(`
    SELECT
      app_connection_profiles.id,
      app_connection_profiles.app_module_id,
      installed_modules.slug AS app_slug,
      app_connection_profiles.name,
      app_connection_profiles.enabled,
      app_connection_profiles.is_default,
      app_connection_profiles.access_mode,
      app_connection_profiles.active_generation_id,
      app_connection_profiles.revision,
      installed_modules.lifecycle_state,
      installed_modules.enabled AS app_enabled,
      module_releases.package_kind
    FROM app_connection_profiles
    JOIN installed_modules
      ON installed_modules.module_id = app_connection_profiles.app_module_id
    JOIN module_releases
      ON module_releases.id = installed_modules.active_release_id
    WHERE app_connection_profiles.id = ?
  `).get(profileId) as ConnectionRow | undefined;
}

function assertApp(appModuleId: string): { slug: string } {
  const app = rawDb.prepare(`
    SELECT installed_modules.slug, module_releases.package_kind
    FROM installed_modules
    JOIN module_releases ON module_releases.id = installed_modules.active_release_id
    WHERE installed_modules.module_id = ?
      AND installed_modules.lifecycle_state IN ('active', 'disabled')
  `).get(appModuleId) as { slug: string; package_kind: string } | undefined;
  if (!app) throw new ModulePackageError('The App is not installed.', 'APP_NOT_INSTALLED');
  if (app.package_kind !== 'app') {
    throw new ModulePackageError('Add-ons cannot own connection profiles.', 'CONNECTION_NOT_SUPPORTED');
  }
  return app;
}

function normalizeName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!connectionNamePattern.test(normalized)) {
    throw new ModulePackageError('Connection name must be between 1 and 80 printable characters.', 'INVALID_CONNECTION');
  }
  return normalized;
}

function activeConnectionSchema(appModuleId: string): NADV2ConnectionProfileSchema | undefined {
  const row = rawDb.prepare(`
    SELECT module_releases.connection_schema_json
    FROM installed_modules
    JOIN module_releases ON module_releases.id = installed_modules.active_release_id
    WHERE installed_modules.module_id = ? AND module_releases.package_schema_version = 2
  `).get(appModuleId) as { connection_schema_json: string | null } | undefined;
  if (!row?.connection_schema_json) return undefined;
  try {
    return JSON.parse(row.connection_schema_json) as NADV2ConnectionProfileSchema;
  } catch {
    throw new ModulePackageError('The signed connection schema is invalid.', 'CONNECTION_SCHEMA_INVALID');
  }
}

function normalizedInputValue(value: string, field: NADV2ConnectionProfileSchema['properties'][string]): string {
  if (field.type === 'number' || field.type === 'integer') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || (field.type === 'integer' && !Number.isInteger(numeric))) {
      throw new ModulePackageError(`${field.title} must be a valid ${field.type}.`, 'INVALID_CONNECTION');
    }
    if (field.minimum !== undefined && numeric < field.minimum) throw new ModulePackageError(`${field.title} is below its minimum.`, 'INVALID_CONNECTION');
    if (field.maximum !== undefined && numeric > field.maximum) throw new ModulePackageError(`${field.title} is above its maximum.`, 'INVALID_CONNECTION');
    return String(numeric);
  }
  if (field.type === 'boolean') {
    if (value !== 'true' && value !== 'false') throw new ModulePackageError(`${field.title} must be true or false.`, 'INVALID_CONNECTION');
    return value;
  }
  if (field.minLength !== undefined && value.length < field.minLength) throw new ModulePackageError(`${field.title} is too short.`, 'INVALID_CONNECTION');
  if (field.maxLength !== undefined && value.length > field.maxLength) throw new ModulePackageError(`${field.title} is too long.`, 'INVALID_CONNECTION');
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern, 'u').test(value)) throw new ModulePackageError(`${field.title} has an invalid format.`, 'INVALID_CONNECTION');
    } catch (error) {
      if (error instanceof ModulePackageError) throw error;
      throw new ModulePackageError('The signed connection field pattern is invalid.', 'CONNECTION_SCHEMA_INVALID');
    }
  }
  if (field.enum && !field.enum.some((candidate) => String(candidate) === value)) {
    throw new ModulePackageError(`${field.title} is not an allowed value.`, 'INVALID_CONNECTION');
  }
  if (field['x-nad'].control === 'url' && value) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('bad');
    } catch {
      throw new ModulePackageError(`${field.title} must be an HTTP(S) URL without embedded credentials.`, 'INVALID_CONNECTION');
    }
  }
  return value;
}

function storedValues(
  appModuleId: string,
  values: ConnectionProfileInput['values'],
  actorId: string,
  timestamp: string,
  existing: StoredConnectionValues = {},
  requireAll = true,
): StoredConnectionValues {
  const entries = Object.entries(values);
  if (entries.length > MAX_CONNECTION_FIELDS) {
    throw new ModulePackageError('A connection contains too many fields.', 'INVALID_CONNECTION');
  }
  let totalBytes = 0;
  const schema = activeConnectionSchema(appModuleId);
  const result: StoredConnectionValues = { ...existing };
  if (schema && Object.keys(values).some((key) => !schema.properties[key])) {
    throw new ModulePackageError('A connection contains an undeclared field.', 'INVALID_CONNECTION');
  }
  for (const [key, input] of entries) {
    if (!connectionKeyPattern.test(key) || !input || typeof input.value !== 'string') {
      throw new ModulePackageError('A connection field is invalid.', 'INVALID_CONNECTION');
    }
    const field = schema?.properties[key];
    const value = field ? normalizedInputValue(input.value, field) : input.value;
    const byteCount = Buffer.byteLength(value, 'utf8');
    if (byteCount > MAX_CONNECTION_VALUE_BYTES) {
      throw new ModulePackageError(`Connection field ${key} is too large.`, 'INVALID_CONNECTION');
    }
    totalBytes += byteCount;
    if (totalBytes > MAX_CONNECTION_TOTAL_BYTES) {
      throw new ModulePackageError('Connection values are too large.', 'INVALID_CONNECTION');
    }
    result[key] = {
      value: encrypt(value),
      encrypted: true,
      isSecret: field ? field['x-nad'].control === 'secret' : input.isSecret ?? false,
      updatedBy: actorId,
      updatedAt: timestamp,
    };
  }
  if (schema && requireAll) {
    for (const key of schema.required ?? []) {
      const entry = result[key];
      if (!entry || !entry.value) throw new ModulePackageError(`${schema.properties[key]?.title ?? key} is required.`, 'INVALID_CONNECTION');
    }
  }
  return result;
}

function readStoredGeneration(profileId: string, generationId: string): StoredConnectionValues {
  const row = rawDb.prepare(`
    SELECT encrypted_values_json
    FROM app_connection_generations
    WHERE id = ? AND connection_profile_id = ?
  `).get(generationId, profileId) as { encrypted_values_json: string } | undefined;
  if (!row) throw new ModulePackageError('The pinned connection generation is unavailable.', 'CONNECTION_GENERATION_MISSING');
  try {
    const parsed = JSON.parse(row.encrypted_values_json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as StoredConnectionValues;
  } catch {
    throw new ModulePackageError('The pinned connection generation is invalid.', 'CONNECTION_GENERATION_INVALID');
  }
}

function decryptGeneration(profileId: string, generationId: string): Record<string, string> {
  const values = readStoredGeneration(profileId, generationId);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(values)) {
    if (!entry || typeof entry.encrypted !== 'boolean' || typeof entry.value !== 'string') {
      throw new ModulePackageError('The pinned connection generation is invalid.', 'CONNECTION_GENERATION_INVALID');
    }
    try {
      result[key] = entry.encrypted || entry.isSecret ? decrypt(entry.value) : entry.value;
    } catch {
      throw new ModulePackageError('The pinned connection generation could not be decrypted.', 'CONNECTION_DECRYPT_FAILED');
    }
  }
  return result;
}

export function listConnectionProfilesForAdmin(appModuleId: string): AdminConnectionProfile[] {
  assertApp(appModuleId);
  const rows = rawDb.prepare(`
    SELECT id, name, enabled, is_default, access_mode, active_generation_id, revision
    FROM app_connection_profiles
    WHERE app_module_id = ?
    ORDER BY is_default DESC, name COLLATE NOCASE, id
  `).all(appModuleId) as Array<{
    id: string;
    name: string;
    enabled: number;
    is_default: number;
    access_mode: 'inherit' | 'restricted';
    active_generation_id: string | null;
    revision: number;
  }>;
  return rows.map((row) => {
    const generation = row.active_generation_id
      ? readStoredGeneration(row.id, row.active_generation_id)
      : {};
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      isDefault: row.is_default === 1,
      accessMode: row.access_mode,
      revision: row.revision,
      generationId: row.active_generation_id,
      // Deliberately return presence metadata only. Plaintext is confined to
      // the owning App runtime and the core HTTP credential broker.
      fields: Object.fromEntries(Object.entries(generation).map(([key, value]) => {
        const plain = value.isSecret
          ? undefined
          : (value.encrypted ? decrypt(value.value) : value.value);
        return [
          key,
          {
            present: Boolean(value.value),
            isSecret: value.isSecret,
            ...(plain === undefined ? {} : { value: plain }),
          },
        ];
      })),
    };
  });
}

async function authorizedConnectionRow(
  connectionProfileId: string,
  appModuleId: string,
  userId: string,
  action = 'view',
): Promise<ConnectionRow | undefined> {
  const profile = connectionRow(connectionProfileId);
  if (
    !profile
    || profile.app_module_id !== appModuleId
    || profile.package_kind !== 'app'
    || profile.app_enabled !== 1
    || profile.lifecycle_state !== 'active'
    || profile.enabled !== 1
    || !profile.active_generation_id
  ) return undefined;

  if (!await hasPermission(userId, profile.app_slug, action)) return undefined;
  if (profile.access_mode === 'inherit') return profile;

  const user = rawDb.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  if (!user) return undefined;
  if (user.role === 'admin') return profile;
  const grant = rawDb.prepare(`
    SELECT 1
    FROM app_connection_access
    WHERE connection_profile_id = ?
      AND access = 'use'
      AND (
        (subject_type = 'user' AND subject_id = ?)
        OR (subject_type = 'role' AND subject_id = ?)
      )
    LIMIT 1
  `).get(connectionProfileId, userId, user.role);
  return grant ? profile : undefined;
}

export async function authorizeConnectionProfile(
  connectionProfileId: string,
  appModuleId: string,
  userId: string,
  action = 'view',
): Promise<boolean> {
  return Boolean(await authorizedConnectionRow(connectionProfileId, appModuleId, userId, action));
}

export async function listConnectionProfilesForUser(
  appModuleId: string,
  userId: string,
): Promise<ConnectionProfileSummary[]> {
  const profiles = rawDb.prepare(`
    SELECT id, name, is_default
    FROM app_connection_profiles
    WHERE app_module_id = ? AND enabled = 1
    ORDER BY is_default DESC, name COLLATE NOCASE, id
  `).all(appModuleId) as Array<{ id: string; name: string; is_default: number }>;
  const allowed = await Promise.all(profiles.map(async (profile) => (
    await authorizeConnectionProfile(profile.id, appModuleId, userId, 'view')
      ? { id: profile.id, name: profile.name, isDefault: profile.is_default === 1 }
      : null
  )));
  return allowed.filter((profile): profile is ConnectionProfileSummary => profile !== null);
}

/**
 * Validates configured state without returning connection values. This is used
 * by registry status calculation, not by browser-facing APIs.
 */
export function hasConfiguredConnectionProfile(appModuleId: string): boolean {
  const schema = activeConnectionSchema(appModuleId);
  if (!schema) return false;
  const rows = rawDb.prepare(`
    SELECT id, active_generation_id
    FROM app_connection_profiles
    WHERE app_module_id = ? AND enabled = 1 AND active_generation_id IS NOT NULL
    ORDER BY is_default DESC, updated_at DESC, id
  `).all(appModuleId) as Array<{ id: string; active_generation_id: string }>;
  return rows.some((row) => {
    try {
      const values = decryptGeneration(row.id, row.active_generation_id);
      if (Object.keys(values).some((key) => !schema.properties[key])) return false;
      for (const key of schema.required ?? []) {
        if (!(key in values)) return false;
      }
      for (const [key, value] of Object.entries(values)) {
        const field = schema.properties[key];
        if (!field) return false;
        normalizedInputValue(value, field);
      }
      return true;
    } catch {
      return false;
    }
  });
}

export function createConnectionProfile(
  appModuleId: string,
  input: ConnectionProfileInput,
  actorId: string,
): AdminConnectionProfile {
  assertApp(appModuleId);
  // Schema-v2 activation creates a compatibility "Default" profile from the
  // previous package configuration. When that profile is empty, the first
  // genuinely configured profile should become the practical default instead
  // of forcing every surface to select past an unusable placeholder.
  const shouldBecomeDefault = input.isDefault === true || !hasConfiguredConnectionProfile(appModuleId);
  const timestamp = now();
  const profileId = generateId();
  const generationId = generateId();
  const name = normalizeName(input.name);
  const encrypted = storedValues(appModuleId, input.values, actorId, timestamp);

  rawDb.transaction(() => {
    const count = rawDb.prepare(`
      SELECT COUNT(*) AS count FROM app_connection_profiles WHERE app_module_id = ?
    `).get(appModuleId) as { count: number };
    if (count.count >= MAX_PROFILES_PER_APP) {
      throw new ModulePackageError('This App has reached the connection profile limit.', 'CONNECTION_LIMIT');
    }
    const duplicate = rawDb.prepare(`
      SELECT 1 FROM app_connection_profiles
      WHERE app_module_id = ? AND lower(name) = lower(?)
    `).get(appModuleId, name);
    if (duplicate) throw new ModulePackageError('A connection with that name already exists.', 'CONNECTION_NAME_CONFLICT');

    const isDefault = count.count === 0 || shouldBecomeDefault;
    if (isDefault) {
      rawDb.prepare('UPDATE app_connection_profiles SET is_default = 0 WHERE app_module_id = ?')
        .run(appModuleId);
    }
    rawDb.prepare(`
      INSERT INTO app_connection_profiles
        (id, app_module_id, name, enabled, is_default, access_mode,
         active_generation_id, revision, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      profileId,
      appModuleId,
      name,
      input.enabled === false ? 0 : 1,
      isDefault ? 1 : 0,
      input.accessMode ?? 'inherit',
      generationId,
      actorId,
      timestamp,
      timestamp,
    );
    rawDb.prepare(`
      INSERT INTO app_connection_generations
        (id, connection_profile_id, schema_version, encrypted_values_json,
         parent_generation_id, created_by, created_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(generationId, profileId, input.schemaVersion ?? 1, JSON.stringify(encrypted), actorId, timestamp);
  }).immediate();

  return listConnectionProfilesForAdmin(appModuleId).find(({ id }) => id === profileId)!;
}

export function updateConnectionProfile(
  appModuleId: string,
  connectionProfileId: string,
  input: Partial<ConnectionProfileInput> & { expectedRevision: number },
  actorId: string,
): AdminConnectionProfile {
  const current = connectionRow(connectionProfileId);
  if (!current || current.app_module_id !== appModuleId) {
    throw new ModulePackageError('Connection profile not found.', 'CONNECTION_NOT_FOUND');
  }
  assertApp(appModuleId);
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== current.revision) {
    throw new ModulePackageError('The connection changed while saving. Refresh and retry.', 'CONCURRENT_MODIFICATION');
  }
  const timestamp = now();
  const generationId = input.values ? generateId() : current.active_generation_id;
  if (!generationId) throw new ModulePackageError('The connection has no active generation.', 'CONNECTION_GENERATION_MISSING');
  const name = input.name === undefined ? current.name : normalizeName(input.name);
  const existingValues = current.active_generation_id
    ? readStoredGeneration(connectionProfileId, current.active_generation_id)
    : {};
  const encrypted = input.values
    ? storedValues(appModuleId, input.values, actorId, timestamp, existingValues)
    : null;

  rawDb.transaction(() => {
    const duplicate = rawDb.prepare(`
      SELECT 1 FROM app_connection_profiles
      WHERE app_module_id = ? AND id <> ? AND lower(name) = lower(?)
    `).get(appModuleId, connectionProfileId, name);
    if (duplicate) throw new ModulePackageError('A connection with that name already exists.', 'CONNECTION_NAME_CONFLICT');
    if (input.isDefault === true) {
      rawDb.prepare('UPDATE app_connection_profiles SET is_default = 0 WHERE app_module_id = ?')
        .run(appModuleId);
    }
    if (encrypted) {
      rawDb.prepare(`
        INSERT INTO app_connection_generations
          (id, connection_profile_id, schema_version, encrypted_values_json,
           parent_generation_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        generationId,
        connectionProfileId,
        input.schemaVersion ?? 1,
        JSON.stringify(encrypted),
        current.active_generation_id,
        actorId,
        timestamp,
      );
    }
    const changed = rawDb.prepare(`
      UPDATE app_connection_profiles
      SET name = ?, enabled = ?, is_default = ?, access_mode = ?,
          active_generation_id = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND app_module_id = ? AND revision = ?
    `).run(
      name,
      input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
      input.isDefault === undefined ? current.is_default : input.isDefault ? 1 : 0,
      input.accessMode ?? current.access_mode,
      generationId,
      timestamp,
      connectionProfileId,
      appModuleId,
      input.expectedRevision,
    );
    if (changed.changes !== 1) {
      throw new ModulePackageError('The connection changed while saving. Refresh and retry.', 'CONCURRENT_MODIFICATION');
    }
  }).immediate();

  return listConnectionProfilesForAdmin(appModuleId).find(({ id }) => id === connectionProfileId)!;
}

export function replaceConnectionProfileAccess(
  appModuleId: string,
  connectionProfileId: string,
  grants: ConnectionAccessGrantInput[],
  actorId: string,
): void {
  const profile = connectionRow(connectionProfileId);
  if (!profile || profile.app_module_id !== appModuleId) {
    throw new ModulePackageError('Connection profile not found.', 'CONNECTION_NOT_FOUND');
  }
  if (grants.length > 256) throw new ModulePackageError('Too many connection grants.', 'INVALID_CONNECTION_ACCESS');
  const unique = new Map<string, ConnectionAccessGrantInput>();
  for (const grant of grants) {
    if (
      (grant.subjectType !== 'user' && grant.subjectType !== 'role')
      || typeof grant.subjectId !== 'string'
      || !/^[a-zA-Z0-9@._:-]{1,160}$/.test(grant.subjectId)
    ) throw new ModulePackageError('A connection access grant is invalid.', 'INVALID_CONNECTION_ACCESS');
    if (grant.subjectType === 'role' && !['admin', 'member', 'restricted'].includes(grant.subjectId)) {
      throw new ModulePackageError('A connection role grant is invalid.', 'INVALID_CONNECTION_ACCESS');
    }
    if (grant.subjectType === 'user') {
      const exists = rawDb.prepare('SELECT 1 FROM users WHERE id = ?').get(grant.subjectId);
      if (!exists) throw new ModulePackageError('A connection user grant is invalid.', 'INVALID_CONNECTION_ACCESS');
    }
    unique.set(`${grant.subjectType}:${grant.subjectId}`, grant);
  }
  const timestamp = now();
  rawDb.transaction(() => {
    rawDb.prepare('DELETE FROM app_connection_access WHERE connection_profile_id = ?')
      .run(connectionProfileId);
    const insert = rawDb.prepare(`
      INSERT INTO app_connection_access
        (id, connection_profile_id, subject_type, subject_id, access, created_by, created_at)
      VALUES (?, ?, ?, ?, 'use', ?, ?)
    `);
    for (const grant of unique.values()) {
      insert.run(randomUUID(), connectionProfileId, grant.subjectType, grant.subjectId, actorId, timestamp);
    }
  }).immediate();
}

export function listConnectionProfileAccess(
  appModuleId: string,
  connectionProfileId: string,
): ConnectionAccessGrantInput[] {
  const profile = connectionRow(connectionProfileId);
  if (!profile || profile.app_module_id !== appModuleId) {
    throw new ModulePackageError('Connection profile not found.', 'CONNECTION_NOT_FOUND');
  }
  return rawDb.prepare(`
    SELECT subject_type AS subjectType, subject_id AS subjectId
    FROM app_connection_access
    WHERE connection_profile_id = ? AND access = 'use'
    ORDER BY subject_type, subject_id
  `).all(connectionProfileId) as ConnectionAccessGrantInput[];
}

export async function readConnectionProfileForInvocation(
  connectionProfileId: string,
  appModuleId: string,
  userId: string,
  action: string,
): Promise<PinnedConnectionProfile> {
  // The authorization decision returns the exact generation/revision it
  // approved. Generations are immutable, so a concurrent rotation cannot make
  // this invocation decrypt a different set of credentials.
  const profile = await authorizedConnectionRow(connectionProfileId, appModuleId, userId, action);
  if (!profile) {
    throw new ModulePackageError('Connection profile access is not available.', 'CONNECTION_ACCESS_DENIED');
  }
  const generationId = profile.active_generation_id;
  if (!generationId) {
    throw new ModulePackageError('Connection profile not found.', 'CONNECTION_NOT_FOUND');
  }
  return {
    id: profile.id,
    name: profile.name,
    appModuleId: profile.app_module_id,
    appSlug: profile.app_slug,
    generationId,
    revision: profile.revision,
    values: Object.freeze(decryptGeneration(profile.id, generationId)),
  };
}

export function deleteConnectionProfile(
  appModuleId: string,
  connectionProfileId: string,
): void {
  const profile = connectionRow(connectionProfileId);
  if (!profile || profile.app_module_id !== appModuleId) {
    throw new ModulePackageError('Connection profile not found.', 'CONNECTION_NOT_FOUND');
  }
  const count = rawDb.prepare(`
    SELECT COUNT(*) AS count FROM app_connection_profiles WHERE app_module_id = ?
  `).get(appModuleId) as { count: number };
  if (count.count <= 1) {
    throw new ModulePackageError('An App must retain at least one connection profile.', 'LAST_CONNECTION');
  }
  rawDb.transaction(() => {
    rawDb.prepare('DELETE FROM app_connection_profiles WHERE id = ? AND app_module_id = ?')
      .run(connectionProfileId, appModuleId);
    if (profile.is_default === 1) {
      const next = rawDb.prepare(`
        SELECT id FROM app_connection_profiles
        WHERE app_module_id = ? ORDER BY name COLLATE NOCASE, id LIMIT 1
      `).get(appModuleId) as { id: string } | undefined;
      if (next) rawDb.prepare('UPDATE app_connection_profiles SET is_default = 1 WHERE id = ?').run(next.id);
    }
  }).immediate();
}
