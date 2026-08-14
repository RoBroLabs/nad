// =============================================================================
// Module Configuration — CRUD with Encryption
// =============================================================================
// Reads and writes module configuration values (API keys, URLs, settings).
// Secret fields are encrypted at rest using AES-256-GCM.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, rawDb } from '@/lib/db';
import { moduleConfigs, enabledModules, installedModules } from '@/lib/db/schema';
import { encrypt, decrypt, maskSecret } from '@/lib/crypto';
import {
  acquireModuleLifecycleLock,
  releaseModuleLifecycleLock,
} from '@/lib/modules/installed/lifecycle-lock';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { generateId, now } from '@/lib/utils';

interface InstalledModuleConfigPointer {
  module_id: string;
  active_release_id: string | null;
  active_config_generation_id: string | null;
  lifecycle_state: string;
}

interface LegacyConfigRow {
  key: string;
  value: string;
  is_secret: number;
  updated_by: string | null;
  updated_at: string;
}

interface StoredConfigValue {
  value: string;
  encrypted: boolean;
  isSecret: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

type StoredConfigValues = Record<string, StoredConfigValue>;

export interface InstalledModuleConfigMutationOptions {
  expectedReleaseId?: string;
  expectedConfigGenerationId?: string | null;
}

function getInstalledConfigPointer(moduleSlug: string): InstalledModuleConfigPointer | undefined {
  return rawDb.prepare(`
    SELECT module_id, active_release_id, active_config_generation_id, lifecycle_state
    FROM installed_modules
    WHERE slug = ?
  `).get(moduleSlug) as InstalledModuleConfigPointer | undefined;
}

function readGenerationValues(generationId: string | null): StoredConfigValues | undefined {
  if (!generationId) return undefined;
  const row = rawDb.prepare(`
    SELECT encrypted_values_json
    FROM module_config_generations
    WHERE id = ?
  `).get(generationId) as { encrypted_values_json: string } | undefined;
  if (!row) return undefined;
  try {
    const parsed = JSON.parse(row.encrypted_values_json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Module configuration generation ${generationId} is invalid.`);
    }
    return parsed as StoredConfigValues;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Module configuration generation')) {
      throw error;
    }
    throw new Error(`Module configuration generation ${generationId} could not be decoded.`);
  }
}

function decryptStoredValue(
  moduleSlug: string,
  key: string,
  entry: StoredConfigValue,
): string | undefined {
  try {
    return entry.encrypted || entry.isSecret ? decrypt(entry.value) : entry.value;
  } catch {
    console.error(`Failed to decrypt config ${moduleSlug}.${key}`);
    return undefined;
  }
}

function storedValuesToConfig(moduleSlug: string, values: StoredConfigValues): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(values)) {
    const value = decryptStoredValue(moduleSlug, key, entry);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function readLegacyConfigRows(moduleSlug: string): LegacyConfigRow[] {
  return rawDb.prepare(`
    SELECT key, value, is_secret, updated_by, updated_at
    FROM module_configs
    WHERE module_slug = ?
  `).all(moduleSlug) as LegacyConfigRow[];
}

function legacyRowsToStoredValues(moduleSlug: string): StoredConfigValues {
  const result: StoredConfigValues = {};
  for (const row of readLegacyConfigRows(moduleSlug)) {
    let plaintext: string;
    try {
      plaintext = row.is_secret ? decrypt(row.value) : row.value;
    } catch {
      console.error(`Failed to decrypt config ${moduleSlug}.${row.key}`);
      continue;
    }
    result[row.key] = {
      value: encrypt(plaintext),
      encrypted: true,
      isSecret: Boolean(row.is_secret),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  }
  return result;
}

function insertConfigGeneration(
  moduleId: string,
  values: StoredConfigValues,
  parentGenerationId: string | null,
  createdBy: string | null,
  createdAt: string,
): string {
  const generationId = generateId();
  rawDb.prepare(`
    INSERT INTO module_config_generations
      (id, module_id, schema_version, encrypted_values_json, parent_generation_id, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?)
  `).run(generationId, moduleId, JSON.stringify(values), parentGenerationId, createdBy, createdAt);
  return generationId;
}

function sameNullable(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? null) === (right ?? null);
}

function assertConfigPointerWritable(
  pointer: InstalledModuleConfigPointer,
  options?: InstalledModuleConfigMutationOptions,
): void {
  if (!pointer.active_release_id || (pointer.lifecycle_state !== 'active' && pointer.lifecycle_state !== 'disabled')) {
    throw new ModulePackageError('Module configuration changed while saving. Refresh and retry.', 'CONCURRENT_MODIFICATION');
  }
  if (options?.expectedReleaseId !== undefined && pointer.active_release_id !== options.expectedReleaseId) {
    throw new ModulePackageError('Module release changed while saving configuration. Refresh and retry.', 'CONCURRENT_MODIFICATION');
  }
  if (
    options?.expectedConfigGenerationId !== undefined
    && !sameNullable(pointer.active_config_generation_id, options.expectedConfigGenerationId)
  ) {
    throw new ModulePackageError('Module configuration changed while saving. Refresh and retry.', 'CONCURRENT_MODIFICATION');
  }
}

function createInstalledConfigGeneration(
  moduleSlug: string,
  values: Record<string, { value: string; isSecret?: boolean }>,
  updatedBy?: string,
  mode: 'merge' | 'replace' = 'merge',
  options?: InstalledModuleConfigMutationOptions,
): void {
  const timestamp = now();
  const operationId = randomUUID();
  rawDb.transaction(() => {
    const pointer = getInstalledConfigPointer(moduleSlug);
    if (!pointer) throw new ModulePackageError(`Module ${moduleSlug} is not installed.`, 'MODULE_NOT_INSTALLED');
    assertConfigPointerWritable(pointer, options);
    acquireModuleLifecycleLock(pointer.module_id, operationId, timestamp);

    const activeGenerationId = pointer.active_config_generation_id;
    let parentGenerationId = activeGenerationId;
    let currentValues = readGenerationValues(activeGenerationId);

    if (!currentValues) {
      currentValues = legacyRowsToStoredValues(moduleSlug);
      if (Object.keys(currentValues).length > 0) {
        parentGenerationId = insertConfigGeneration(
          pointer.module_id,
          currentValues,
          null,
          updatedBy ?? null,
          timestamp,
        );
      }
    }

    const nextValues: StoredConfigValues = mode === 'replace' ? {} : { ...currentValues };
    for (const [key, { value, isSecret }] of Object.entries(values)) {
      nextValues[key] = {
        value: encrypt(value),
        encrypted: true,
        isSecret: isSecret ?? false,
        updatedBy: updatedBy ?? null,
        updatedAt: timestamp,
      };
    }

    const nextGenerationId = insertConfigGeneration(
      pointer.module_id,
      nextValues,
      parentGenerationId,
      updatedBy ?? null,
      timestamp,
    );

    const result = rawDb.prepare(`
      UPDATE installed_modules
      SET active_config_generation_id = ?,
          registry_epoch = registry_epoch + 1,
          updated_at = ?
      WHERE slug = ?
        AND active_release_id = ?
        AND lifecycle_state IN ('active', 'disabled')
        AND (
          active_config_generation_id = ?
          OR (active_config_generation_id IS NULL AND ? IS NULL)
        )
    `).run(nextGenerationId, timestamp, moduleSlug, pointer.active_release_id, activeGenerationId, activeGenerationId);

    if (result.changes !== 1) {
      throw new ModulePackageError('Module configuration changed while saving. Refresh and retry.', 'CONCURRENT_MODIFICATION');
    }
    releaseModuleLifecycleLock(pointer.module_id, operationId);
  }).immediate();
}

/**
 * Imports legacy slug-keyed configuration into the installed generation model.
 *
 * This is the static-to-installed upgrade bridge. Runtime installed reads do
 * not fall back to `module_configs`; install/lifecycle code should call this
 * once after creating `installed_modules` so the active pointer is explicit.
 */
export function ensureInstalledModuleConfigGeneration(
  moduleSlug: string,
  createdBy?: string,
): string | null {
  const timestamp = now();
  return rawDb.transaction(() => {
    const pointer = getInstalledConfigPointer(moduleSlug);
    if (!pointer) return null;
    if (pointer.active_config_generation_id) return pointer.active_config_generation_id;

    const generationId = insertConfigGeneration(
      pointer.module_id,
      legacyRowsToStoredValues(moduleSlug),
      null,
      createdBy ?? null,
      timestamp,
    );

    const result = rawDb.prepare(`
      UPDATE installed_modules
      SET active_config_generation_id = ?,
          registry_epoch = registry_epoch + 1,
          updated_at = ?
      WHERE slug = ?
        AND active_config_generation_id IS NULL
    `).run(generationId, timestamp, moduleSlug);

    if (result.changes !== 1) {
      throw new Error('Module configuration changed while importing legacy values. Retry the update.');
    }

    return generationId;
  }).immediate();
}

/**
 * Gets all configuration values for a module.
 * Secret values are decrypted before returning.
 *
 * @param moduleSlug - The module to get config for
 * @returns Record of key → value (decrypted)
 */
export async function getModuleConfig(
  moduleSlug: string,
): Promise<Record<string, string>> {
  const installed = getInstalledConfigPointer(moduleSlug);
  if (installed) {
    const generationValues = readGenerationValues(installed.active_config_generation_id);
    if (generationValues) return storedValuesToConfig(moduleSlug, generationValues);
    return {};
  }

  const configs = await db
    .select()
    .from(moduleConfigs)
    .where(eq(moduleConfigs.moduleSlug, moduleSlug))
    .all();

  const result: Record<string, string> = {};

  for (const config of configs) {
    try {
      result[config.key] = config.isSecret
        ? decrypt(config.value)
        : config.value;
    } catch {
      // If decryption fails (e.g., APP_SECRET changed), skip the value
      console.error(`Failed to decrypt config ${moduleSlug}.${config.key}`);
    }
  }

  return result;
}

/** Reads one immutable installed configuration generation for a pinned request. */
export async function getInstalledModuleConfigGeneration(
  moduleSlug: string,
  generationId: string | null,
): Promise<Record<string, string>> {
  if (!generationId) return {};
  const row = rawDb.prepare(`
    SELECT module_config_generations.encrypted_values_json
    FROM module_config_generations
    JOIN installed_modules
      ON installed_modules.module_id = module_config_generations.module_id
    WHERE installed_modules.slug = ? AND module_config_generations.id = ?
  `).get(moduleSlug, generationId) as { encrypted_values_json: string } | undefined;
  if (!row) {
    throw new Error(`Pinned configuration generation ${generationId} is unavailable for ${moduleSlug}.`);
  }
  try {
    const parsed = JSON.parse(row.encrypted_values_json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Pinned configuration generation ${generationId} is invalid for ${moduleSlug}.`);
    }
    return storedValuesToConfig(moduleSlug, parsed as StoredConfigValues);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Pinned configuration generation')) {
      throw error;
    }
    throw new Error(`Pinned configuration generation ${generationId} could not be decoded for ${moduleSlug}.`);
  }
}

/**
 * Gets module config with secrets masked for UI display.
 * Use this when returning config to the frontend settings page.
 *
 * @param moduleSlug - The module to get config for
 * @returns Record of key → { value, masked, isSecret }
 */
export async function getModuleConfigForDisplay(
  moduleSlug: string,
): Promise<Record<string, { value: string; masked: boolean; isSecret: boolean }>> {
  const installed = getInstalledConfigPointer(moduleSlug);
  if (installed) {
    const generationValues = readGenerationValues(installed.active_config_generation_id);
    if (generationValues) {
      const result: Record<string, { value: string; masked: boolean; isSecret: boolean }> = {};
      for (const [key, entry] of Object.entries(generationValues)) {
        const decrypted = decryptStoredValue(moduleSlug, key, entry);
        if (entry.isSecret) {
          result[key] = {
            value: decrypted ? maskSecret(decrypted) : '••••••••',
            masked: true,
            isSecret: true,
          };
        } else if (decrypted !== undefined) {
          result[key] = {
            value: decrypted,
            masked: false,
            isSecret: false,
          };
        }
      }
      return result;
    }
    return {};
  }

  const configs = await db
    .select()
    .from(moduleConfigs)
    .where(eq(moduleConfigs.moduleSlug, moduleSlug))
    .all();

  const result: Record<string, { value: string; masked: boolean; isSecret: boolean }> = {};

  for (const config of configs) {
    if (config.isSecret) {
      try {
        const decrypted = decrypt(config.value);
        result[config.key] = {
          value: maskSecret(decrypted),
          masked: true,
          isSecret: true,
        };
      } catch {
        result[config.key] = {
          value: '••••••••',
          masked: true,
          isSecret: true,
        };
      }
    } else {
      result[config.key] = {
        value: config.value,
        masked: false,
        isSecret: false,
      };
    }
  }

  return result;
}

/**
 * Sets a single configuration value for a module.
 * If the field is a secret, it will be encrypted before storage.
 *
 * @param moduleSlug - The module to set config for
 * @param key - The config key
 * @param value - The plaintext value
 * @param isSecret - Whether this value should be encrypted
 * @param updatedBy - The user ID making the change (for audit trail)
 */
export async function setModuleConfigValue(
  moduleSlug: string,
  key: string,
  value: string,
  isSecret: boolean = false,
  updatedBy?: string,
  options?: InstalledModuleConfigMutationOptions,
): Promise<void> {
  if (getInstalledConfigPointer(moduleSlug)) {
    createInstalledConfigGeneration(moduleSlug, { [key]: { value, isSecret } }, updatedBy, 'merge', options);
    return;
  }

  const storedValue = isSecret ? encrypt(value) : value;
  const timestamp = now();
  await db
    .insert(moduleConfigs)
    .values({
      id: generateId(),
      moduleSlug,
      key,
      value: storedValue,
      isSecret,
      updatedBy: updatedBy ?? null,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [moduleConfigs.moduleSlug, moduleConfigs.key],
      set: {
        value: storedValue,
        isSecret,
        updatedBy: updatedBy ?? null,
        updatedAt: timestamp,
      },
    })
    .run();
}

/**
 * Sets multiple configuration values at once.
 * More efficient than calling setModuleConfigValue() in a loop.
 */
export async function setModuleConfig(
  moduleSlug: string,
  values: Record<string, { value: string; isSecret?: boolean }>,
  updatedBy?: string,
  options?: InstalledModuleConfigMutationOptions,
): Promise<void> {
  if (getInstalledConfigPointer(moduleSlug)) {
    createInstalledConfigGeneration(moduleSlug, values, updatedBy, 'merge', options);
    return;
  }

  const timestamp = now();
  const entries = Object.entries(values).map(([key, { value, isSecret }]) => ({
    id: generateId(),
    moduleSlug,
    key,
    value: isSecret ? encrypt(value) : value,
    isSecret: isSecret ?? false,
    updatedBy: updatedBy ?? null,
    updatedAt: timestamp,
  }));

  db.transaction((transaction) => {
    for (const entry of entries) {
      transaction
        .insert(moduleConfigs)
        .values(entry)
        .onConflictDoUpdate({
          target: [moduleConfigs.moduleSlug, moduleConfigs.key],
          set: {
            value: entry.value,
            isSecret: entry.isSecret,
            updatedBy: entry.updatedBy,
            updatedAt: entry.updatedAt,
          },
        })
        .run();
    }
  });
}

/**
 * Deletes all configuration for a module.
 * Used when uninstalling/resetting a module.
 */
export async function clearModuleConfig(
  moduleSlug: string,
  updatedBy?: string,
  options?: InstalledModuleConfigMutationOptions,
): Promise<void> {
  if (getInstalledConfigPointer(moduleSlug)) {
    createInstalledConfigGeneration(moduleSlug, {}, updatedBy, 'replace', options);
    return;
  }

  await db
    .delete(moduleConfigs)
    .where(eq(moduleConfigs.moduleSlug, moduleSlug))
    .run();
}

/**
 * Checks if a module is enabled.
 */
export async function isModuleEnabled(moduleSlug: string): Promise<boolean> {
  const installed = await db
    .select({ enabled: installedModules.enabled })
    .from(installedModules)
    .where(eq(installedModules.slug, moduleSlug))
    .get();
  if (installed) return installed.enabled;

  const record = await db
    .select({ enabled: enabledModules.enabled })
    .from(enabledModules)
    .where(eq(enabledModules.moduleSlug, moduleSlug))
    .get();

  return record?.enabled ?? false;
}

/**
 * Gets all enabled module slugs.
 */
export async function getEnabledModules(): Promise<string[]> {
  const records = rawDb.prepare(`
    SELECT slug AS module_slug
    FROM installed_modules
    WHERE enabled = 1
      AND lifecycle_state = 'active'
    UNION
    SELECT enabled_modules.module_slug AS module_slug
    FROM enabled_modules
    WHERE enabled_modules.enabled = 1
      AND NOT EXISTS (
        SELECT 1
        FROM installed_modules
        WHERE installed_modules.slug = enabled_modules.module_slug
      )
    ORDER BY module_slug
  `).all() as Array<{ module_slug: string }>;

  return records.map((record) => record.module_slug);
}
