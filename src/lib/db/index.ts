// =============================================================================
// Database Connection — Drizzle ORM + SQLite
// =============================================================================
// Creates and exports the Drizzle database instance.
// Uses better-sqlite3 for SQLite. Swap to postgres-js for PostgreSQL migration.
// =============================================================================

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { migrateDatabase } from './migrate';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

/**
 * Resolves the database file path from environment or defaults.
 * Creates the data directory if it doesn't exist.
 */
function resolveDatabasePath(): string {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl?.startsWith('file:')) {
    // Strip the 'file:' prefix
    return dbUrl.slice(5);
  }

  // Default: ./data/nad.db relative to project root
  return join(process.cwd(), 'data', 'nad.db');
}

// Initialise the SQLite connection
// Next.js imports server modules while collecting build metadata. Use an
// isolated in-memory schema for that phase so `pnpm build` can never migrate or
// create the operator's configured runtime database.
const databasePath = process.env.NAD_BUILD_EPHEMERAL_DB === '1'
  ? ':memory:'
  : resolveDatabasePath();
mkdirSync(dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);

// Build workers can initialise the database concurrently. Wait briefly for the
// process holding SQLite's schema/journal lock instead of failing immediately.
sqlite.pragma('busy_timeout = 5000');

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');

// Enable foreign keys (SQLite has them off by default)
sqlite.pragma('foreign_keys = ON');

// Keep fresh and existing installations on the schema expected by this build.
// Migrations are synchronous so no request can observe a partially initialised DB.
migrateDatabase(sqlite);

/**
 * The Drizzle ORM database instance.
 * Import this wherever you need to query the database.
 *
 * @example
 * ```ts
 * import { db } from '@/lib/db';
 * import { users } from '@/lib/db/schema';
 *
 * const allUsers = db.select().from(users).all();
 * ```
 */
export const db = drizzle(sqlite, { schema });

/**
 * The raw better-sqlite3 instance.
 * Only use this for operations Drizzle doesn't support (e.g., VACUUM, custom pragmas).
 */
export const rawDb = sqlite;
