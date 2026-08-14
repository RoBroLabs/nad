import 'server-only';

import { randomUUID } from 'node:crypto';
import { rawDb } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import type { ModuleDataMigrationDocument } from '@/lib/modules/contracts/v1';
import { ModulePackageError, type InstalledPackageManifestSource } from '@/lib/modules/installed/package-types';
import type { ConfigField } from '@/lib/modules/types';

const MAX_STORAGE_KEY_BYTES = 160;
const MAX_STORAGE_VALUE_BYTES = 64 * 1024;
const MAX_STORAGE_GENERATION_BYTES = 1024 * 1024;
const MAX_CONFIG_VALUE_BYTES = 64 * 1024;

type DataMigrationOperation = NonNullable<ModuleDataMigrationDocument['config']>[number];

interface StoredConfigValue {
  value: string;
  encrypted: boolean;
  isSecret: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

type StoredConfigValues = Record<string, StoredConfigValue>;

interface KvEntry {
  key: string;
  valueJson: string;
  byteCount: number;
}

export interface DataGenerationPointers {
  configGenerationId: string | null;
  kvGenerationId: string | null;
}

export interface ApplyDeclarativeDataMigrationOptions {
  moduleId: string;
  fromVersion: string;
  toManifest: Pick<InstalledPackageManifestSource, 'version' | 'configSchema' | 'dataMigrations'>;
  currentConfigGenerationId: string | null;
  currentKvGenerationId: string | null;
  actorId: string;
  timestamp: string;
}

function fail(message: string): never {
  throw new ModulePackageError(message, 'DATA_MIGRATION_FAILED');
}

function validateMigrationKey(key: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key) || Buffer.byteLength(key, 'utf8') > MAX_STORAGE_KEY_BYTES) {
    fail(`${label} is not a valid data migration key.`);
  }
}

function selectedMigration(
  migrations: ModuleDataMigrationDocument[] | undefined,
  fromVersion: string,
  toVersion: string,
): ModuleDataMigrationDocument | undefined {
  const matches = (migrations ?? []).filter((migration) => (
    migration.fromVersion === fromVersion && migration.toVersion === toVersion
  ));
  if (matches.length > 1) {
    fail(`Multiple data migrations match ${fromVersion} -> ${toVersion}.`);
  }
  return matches[0];
}

function validateMigrationDeclarations(
  migrations: ModuleDataMigrationDocument[] | undefined,
  toManifest: Pick<InstalledPackageManifestSource, 'version' | 'configSchema'>,
): void {
  const routes = new Set<string>();
  for (const [index, migration] of (migrations ?? []).entries()) {
    if (migration.toVersion !== toManifest.version) {
      fail(`Data migration ${index} must target manifest version ${toManifest.version}.`);
    }
    if (migration.fromVersion === migration.toVersion) {
      fail(`Data migration ${index} cannot migrate a version to itself.`);
    }
    const route = `${migration.fromVersion}->${migration.toVersion}`;
    if (routes.has(route)) fail(`Duplicate data migration route ${route}.`);
    routes.add(route);
    if (!migration.config && !migration.storage) {
      fail(`Data migration ${route} has no operations.`);
    }
    if (migration.config) validateConfigDeclaration(migration.config, toManifest.configSchema);
    if (migration.storage) validateStorageDeclaration(migration.storage);
  }
}

function validateOperationKeys(operations: DataMigrationOperation[], scope: 'config' | 'storage'): void {
  const touched = new Set<string>();
  for (const [index, operation] of operations.entries()) {
    if (operation.op === 'rename') {
      validateMigrationKey(operation.from, `${scope}[${index}].from`);
      validateMigrationKey(operation.to, `${scope}[${index}].to`);
      if (operation.from === operation.to) fail(`${scope}[${index}] cannot rename a key to itself.`);
      for (const key of [operation.from, operation.to]) {
        if (touched.has(key)) fail(`${scope} data migration key ${key} is used by more than one operation.`);
        touched.add(key);
      }
      continue;
    }
    validateMigrationKey(operation.key, `${scope}[${index}].key`);
    if (touched.has(operation.key)) fail(`${scope} data migration key ${operation.key} is used by more than one operation.`);
    touched.add(operation.key);
  }
}

function validateConfigDeclaration(operations: DataMigrationOperation[], configSchema: ConfigField[]): void {
  validateOperationKeys(operations, 'config');
  const fieldByKey = new Map(configSchema.map((field) => [field.key, field]));
  for (const operation of operations) {
    if (operation.op === 'rename') {
      if (!fieldByKey.has(operation.to)) fail(`Config migration target ${operation.to} is not declared by the new manifest.`);
      continue;
    }
    if (operation.op === 'setDefault') {
      const field = fieldByKey.get(operation.key);
      if (!field) fail(`Config migration default ${operation.key} is not declared by the new manifest.`);
      const plaintext = configDefaultAsString(field, operation.value);
      if (Buffer.byteLength(plaintext, 'utf8') > MAX_CONFIG_VALUE_BYTES) fail(`Default for ${operation.key} is too large.`);
    }
  }
}

function validateStorageDeclaration(operations: DataMigrationOperation[]): void {
  validateOperationKeys(operations, 'storage');
  for (const operation of operations) {
    if (operation.op === 'setDefault') encodeStorageValue(operation.value);
  }
}

function readConfigGeneration(moduleId: string, generationId: string | null): StoredConfigValues {
  if (!generationId) return {};
  const row = rawDb.prepare(`
    SELECT encrypted_values_json
    FROM module_config_generations
    WHERE id = ? AND module_id = ?
  `).get(generationId, moduleId) as { encrypted_values_json: string } | undefined;
  if (!row) fail(`Configuration generation ${generationId} is unavailable.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.encrypted_values_json) as unknown;
  } catch {
    fail(`Configuration generation ${generationId} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`Configuration generation ${generationId} is not an object.`);
  }

  const result: StoredConfigValues = {};
  for (const [key, value] of Object.entries(parsed)) {
    validateMigrationKey(key, `configuration key ${key}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(`Configuration value ${key} is not a stored entry object.`);
    }
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.value !== 'string'
      || typeof entry.encrypted !== 'boolean'
      || typeof entry.isSecret !== 'boolean'
      || (entry.updatedBy !== null && typeof entry.updatedBy !== 'string')
      || typeof entry.updatedAt !== 'string'
    ) {
      fail(`Configuration value ${key} is not a stored entry object.`);
    }
    result[key] = {
      value: entry.value,
      encrypted: entry.encrypted,
      isSecret: entry.isSecret,
      updatedBy: entry.updatedBy,
      updatedAt: entry.updatedAt,
    };
  }
  return result;
}

function configDefaultAsString(field: ConfigField, value: unknown): string {
  if (field.type === 'secret') fail(`Data migration cannot set a default for secret config field ${field.key}.`);
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`Default for ${field.key} must be a finite number.`);
    if (field.min !== undefined && value < field.min) fail(`Default for ${field.key} is below its minimum.`);
    if (field.max !== undefined && value > field.max) fail(`Default for ${field.key} is above its maximum.`);
    return String(value);
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') fail(`Default for ${field.key} must be a boolean.`);
    return value ? 'true' : 'false';
  }
  if (typeof value !== 'string') fail(`Default for ${field.key} must be a string.`);
  if (field.type === 'url') {
    try {
      const url = new URL(value);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new Error('invalid');
    } catch {
      fail(`Default for ${field.key} must be a normal HTTP(S) URL without embedded credentials.`);
    }
  }
  if (field.type === 'select' && !field.options?.some(({ value: option }) => option === value)) {
    fail(`Default for ${field.key} is not one of its declared options.`);
  }
  return value;
}

function applyConfigOperations(
  moduleId: string,
  generationId: string | null,
  operations: DataMigrationOperation[],
  configSchema: ConfigField[],
  actorId: string,
  timestamp: string,
): string {
  validateOperationKeys(operations, 'config');
  const nextValues = readConfigGeneration(moduleId, generationId);
  const fieldByKey = new Map(configSchema.map((field) => [field.key, field]));

  for (const operation of operations) {
    if (operation.op === 'rename') {
      if (!fieldByKey.has(operation.to)) fail(`Config migration target ${operation.to} is not declared by the new manifest.`);
      const existing = nextValues[operation.from];
      if (!existing) continue;
      if (nextValues[operation.to]) fail(`Config migration would overwrite existing value ${operation.to}.`);
      nextValues[operation.to] = existing;
      delete nextValues[operation.from];
      continue;
    }

    if (operation.op === 'setDefault') {
      const field = fieldByKey.get(operation.key);
      if (!field) fail(`Config migration default ${operation.key} is not declared by the new manifest.`);
      if (nextValues[operation.key]) continue;
      const plaintext = configDefaultAsString(field, operation.value);
      if (Buffer.byteLength(plaintext, 'utf8') > MAX_CONFIG_VALUE_BYTES) fail(`Default for ${operation.key} is too large.`);
      nextValues[operation.key] = {
        value: encrypt(plaintext),
        encrypted: true,
        isSecret: false,
        updatedBy: actorId,
        updatedAt: timestamp,
      };
      continue;
    }

    delete nextValues[operation.key];
  }

  const nextGenerationId = randomUUID();
  rawDb.prepare(`
    INSERT INTO module_config_generations
      (id, module_id, schema_version, encrypted_values_json, parent_generation_id, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?)
  `).run(
    nextGenerationId,
    moduleId,
    JSON.stringify(nextValues),
    generationId,
    actorId,
    timestamp,
  );
  return nextGenerationId;
}

function encodeStorageValue(value: unknown): { valueJson: string; byteCount: number } {
  const valueJson = JSON.stringify(value);
  if (valueJson === undefined) fail('Storage default must be JSON serialisable.');
  const byteCount = Buffer.byteLength(valueJson, 'utf8');
  if (byteCount > MAX_STORAGE_VALUE_BYTES) fail('Storage default exceeds the per-entry quota.');
  JSON.parse(valueJson);
  return { valueJson, byteCount };
}

function readKvEntries(moduleId: string, generationId: string | null): KvEntry[] {
  if (!generationId) return [];
  const generation = rawDb.prepare(`
    SELECT 1
    FROM module_kv_generations
    WHERE id = ? AND module_id = ?
  `).get(generationId, moduleId);
  if (!generation) fail(`Storage generation ${generationId} is unavailable.`);

  return (rawDb.prepare(`
    SELECT key, value_json, byte_count
    FROM module_kv_entries
    WHERE generation_id = ?
    ORDER BY key
  `).all(generationId) as Array<{ key: string; value_json: string; byte_count: number }>).map((entry) => {
    validateMigrationKey(entry.key, `storage key ${entry.key}`);
    try {
      JSON.parse(entry.value_json);
    } catch {
      fail(`Storage value ${entry.key} is not valid JSON.`);
    }
    const actualBytes = Buffer.byteLength(entry.value_json, 'utf8');
    if (actualBytes > MAX_STORAGE_VALUE_BYTES) fail(`Storage value ${entry.key} exceeds the per-entry quota.`);
    return { key: entry.key, valueJson: entry.value_json, byteCount: actualBytes };
  });
}

function assertStorageGenerationQuota(entries: Map<string, KvEntry>): number {
  let total = 0;
  for (const entry of entries.values()) total += entry.byteCount;
  if (total > MAX_STORAGE_GENERATION_BYTES) fail('Storage migration exceeds the generation quota.');
  return total;
}

function applyStorageOperations(
  moduleId: string,
  generationId: string | null,
  operations: DataMigrationOperation[],
  timestamp: string,
): string {
  validateOperationKeys(operations, 'storage');
  const entries = new Map(readKvEntries(moduleId, generationId).map((entry) => [entry.key, entry]));

  for (const operation of operations) {
    if (operation.op === 'rename') {
      const existing = entries.get(operation.from);
      if (!existing) continue;
      if (entries.has(operation.to)) fail(`Storage migration would overwrite existing value ${operation.to}.`);
      entries.set(operation.to, { ...existing, key: operation.to });
      entries.delete(operation.from);
      continue;
    }

    if (operation.op === 'setDefault') {
      if (entries.has(operation.key)) continue;
      const encoded = encodeStorageValue(operation.value);
      entries.set(operation.key, { key: operation.key, ...encoded });
      continue;
    }

    entries.delete(operation.key);
  }

  const totalBytes = assertStorageGenerationQuota(entries);
  const nextGenerationId = randomUUID();
  rawDb.prepare(`
    INSERT INTO module_kv_generations (id, module_id, parent_generation_id, byte_count, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(nextGenerationId, moduleId, generationId, totalBytes, timestamp);

  const insertEntry = rawDb.prepare(`
    INSERT INTO module_kv_entries (id, generation_id, key, value_json, byte_count)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const entry of entries.values()) {
    insertEntry.run(randomUUID(), nextGenerationId, entry.key, entry.valueJson, entry.byteCount);
  }
  return nextGenerationId;
}

export function applyDeclarativeDataMigration(
  options: ApplyDeclarativeDataMigrationOptions,
): DataGenerationPointers {
  validateMigrationDeclarations(options.toManifest.dataMigrations, options.toManifest);
  const migration = selectedMigration(
    options.toManifest.dataMigrations,
    options.fromVersion,
    options.toManifest.version,
  );
  if (!migration) {
    return {
      configGenerationId: options.currentConfigGenerationId,
      kvGenerationId: options.currentKvGenerationId,
    };
  }
  if (!migration.config && !migration.storage) {
    fail(`Data migration ${options.fromVersion} -> ${options.toManifest.version} has no operations.`);
  }

  return {
    configGenerationId: migration.config
      ? applyConfigOperations(
        options.moduleId,
        options.currentConfigGenerationId,
        migration.config,
        options.toManifest.configSchema,
        options.actorId,
        options.timestamp,
      )
      : options.currentConfigGenerationId,
    kvGenerationId: migration.storage
      ? applyStorageOperations(
        options.moduleId,
        options.currentKvGenerationId,
        migration.storage,
        options.timestamp,
      )
      : options.currentKvGenerationId,
  };
}
