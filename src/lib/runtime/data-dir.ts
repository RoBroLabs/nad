import 'server-only';

import { dirname, isAbsolute, join, resolve } from 'node:path';

function configuredDatabasePath(): string | undefined {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith('file:')) return undefined;
  const value = databaseUrl.slice('file:'.length);
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

/**
 * Returns NAD's persistent data root without touching the filesystem.
 * Callers create only the narrow directories they own during an explicit
 * install, backup, or startup operation.
 */
export function getDataDirectory(): string {
  if (process.env.NAD_DATA_DIR) return resolve(process.env.NAD_DATA_DIR);
  const databasePath = configuredDatabasePath();
  return databasePath ? dirname(databasePath) : join(process.cwd(), 'data');
}

export function getModuleArtifactDirectory(): string {
  return join(getDataDirectory(), 'modules');
}
