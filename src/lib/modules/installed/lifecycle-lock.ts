import 'server-only';

import { rawDb } from '@/lib/db';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

const LOCK_TTL_MS = 5 * 60 * 1000;

function isSqliteConstraint(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

export function acquireModuleLifecycleLock(moduleId: string, operationId: string, timestamp: string): void {
  rawDb.prepare('DELETE FROM module_lifecycle_locks WHERE module_id = ? AND expires_at <= ?')
    .run(moduleId, timestamp);
  try {
    rawDb.prepare(`
      INSERT INTO module_lifecycle_locks (module_id, operation_id, owner, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(
      moduleId,
      operationId,
      `${process.pid}`,
      new Date(Date.parse(timestamp) + LOCK_TTL_MS).toISOString(),
    );
  } catch (error) {
    if (isSqliteConstraint(error)) {
      throw new ModulePackageError('Another lifecycle operation is already running for this Module.', 'MODULE_BUSY');
    }
    throw error;
  }
}

export function assertModuleLifecycleLock(moduleId: string, operationId: string): void {
  const lock = rawDb.prepare('SELECT operation_id FROM module_lifecycle_locks WHERE module_id = ?')
    .get(moduleId) as { operation_id: string } | undefined;
  if (!lock || lock.operation_id !== operationId) {
    throw new ModulePackageError('The Module lifecycle operation lock was lost. Retry the operation.', 'MODULE_LOCK_LOST');
  }
}

export function releaseModuleLifecycleLock(moduleId: string, operationId: string): void {
  rawDb.prepare('DELETE FROM module_lifecycle_locks WHERE module_id = ? AND operation_id = ?')
    .run(moduleId, operationId);
}
