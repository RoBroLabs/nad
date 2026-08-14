import 'server-only';

import { randomUUID } from 'node:crypto';
import { rawDb } from '@/lib/db';

const MAX_KEY_BYTES = 160;
const MAX_VALUE_BYTES = 64 * 1024;
const MAX_GENERATION_BYTES = 1024 * 1024;

export interface ModuleStorageScope {
  moduleId: string;
  releaseId: string;
  kvGenerationId: string;
}

interface KvGenerationRow {
  byte_count: number;
}

interface KvEntryRow {
  id: string;
  value_json: string;
  byte_count: number;
}

function validateKey(key: unknown): string {
  if (typeof key !== 'string') throw new Error('storage key must be a string.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
    throw new Error('storage key must be 1-128 safe namespace characters.');
  }
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) throw new Error('storage key is too large.');
  return key;
}

function encodeValue(value: unknown): { json: string; bytes: number } {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('storage value must be JSON serialisable.');
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_VALUE_BYTES) throw new Error('storage value exceeds the per-entry quota.');
  return { json, bytes };
}

function assertActiveScope(scope: ModuleStorageScope): void {
  const active = rawDb.prepare(`
    SELECT 1 FROM installed_modules
    WHERE module_id = ?
      AND active_release_id = ?
      AND active_kv_generation_id = ?
      AND enabled = 1
      AND lifecycle_state = 'active'
  `).get(scope.moduleId, scope.releaseId, scope.kvGenerationId);
  if (!active) {
    throw new Error('storage generation is no longer active for this Module release.');
  }
}

function assertReadableScope(scope: ModuleStorageScope): void {
  const readable = rawDb.prepare(`
    SELECT 1
    FROM module_kv_generations
    JOIN module_releases ON module_releases.module_id = module_kv_generations.module_id
    WHERE module_kv_generations.id = ?
      AND module_kv_generations.module_id = ?
      AND module_releases.id = ?
      AND module_releases.state IN ('active', 'retained')
  `).get(scope.kvGenerationId, scope.moduleId, scope.releaseId);
  if (!readable) throw new Error('storage generation is unavailable for this Module release.');
}

export function getModuleStorageValue(scope: ModuleStorageScope, rawKey: unknown): unknown {
  const key = validateKey(rawKey);
  assertReadableScope(scope);
  const entry = rawDb.prepare(`
    SELECT value_json FROM module_kv_entries
    WHERE generation_id = ? AND key = ?
  `).get(scope.kvGenerationId, key) as { value_json: string } | undefined;
  if (!entry) return null;
  return JSON.parse(entry.value_json) as unknown;
}

export function setModuleStorageValue(scope: ModuleStorageScope, rawKey: unknown, value: unknown): void {
  const key = validateKey(rawKey);
  const encoded = encodeValue(value);
  rawDb.transaction(() => {
    assertActiveScope(scope);
    const generation = rawDb.prepare(`
      SELECT byte_count FROM module_kv_generations WHERE id = ? AND module_id = ?
    `).get(scope.kvGenerationId, scope.moduleId) as KvGenerationRow | undefined;
    if (!generation) throw new Error('storage generation does not exist.');

    const existing = rawDb.prepare(`
      SELECT id, value_json, byte_count FROM module_kv_entries
      WHERE generation_id = ? AND key = ?
    `).get(scope.kvGenerationId, key) as KvEntryRow | undefined;
    const nextBytes = generation.byte_count - (existing?.byte_count ?? 0) + encoded.bytes;
    if (nextBytes > MAX_GENERATION_BYTES) throw new Error('storage generation exceeds its quota.');

    if (existing) {
      rawDb.prepare(`
        UPDATE module_kv_entries SET value_json = ?, byte_count = ? WHERE id = ?
      `).run(encoded.json, encoded.bytes, existing.id);
    } else {
      rawDb.prepare(`
        INSERT INTO module_kv_entries (id, generation_id, key, value_json, byte_count)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), scope.kvGenerationId, key, encoded.json, encoded.bytes);
    }
    rawDb.prepare(`
      UPDATE module_kv_generations SET byte_count = ? WHERE id = ?
    `).run(nextBytes, scope.kvGenerationId);
  }).immediate();
}

export function deleteModuleStorageValue(scope: ModuleStorageScope, rawKey: unknown): void {
  const key = validateKey(rawKey);
  rawDb.transaction(() => {
    assertActiveScope(scope);
    const existing = rawDb.prepare(`
      SELECT id, byte_count FROM module_kv_entries
      WHERE generation_id = ? AND key = ?
    `).get(scope.kvGenerationId, key) as Pick<KvEntryRow, 'id' | 'byte_count'> | undefined;
    if (!existing) return;
    rawDb.prepare('DELETE FROM module_kv_entries WHERE id = ?').run(existing.id);
    rawDb.prepare(`
      UPDATE module_kv_generations
      SET byte_count = max(0, byte_count - ?)
      WHERE id = ?
    `).run(existing.byte_count, scope.kvGenerationId);
  }).immediate();
}
