// =============================================================================
// Audit Log — Records all write operations for accountability
// =============================================================================

import { db } from '@/lib/db';
import { auditLog, users } from '@/lib/db/schema';
import { generateId, now, safeJsonParse } from '@/lib/utils';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

/**
 * Records an action in the audit log.
 *
 * @param userId - Who performed the action
 * @param action - What was done (e.g., 'restart_server', 'update_config', 'create_user')
 * @param moduleSlug - Which module (optional, null for system actions)
 * @param details - Additional context (will be JSON-serialised)
 * @param ipAddress - Client IP address
 */
export async function logAuditEvent(
  userId: string | null,
  action: string,
  moduleSlug?: string,
  details?: Record<string, unknown>,
  ipAddress?: string,
): Promise<void> {
  await db
    .insert(auditLog)
    .values({
      id: generateId(),
      userId,
      action,
      moduleSlug: moduleSlug ?? null,
      details: details ? JSON.stringify(details) : null,
      ipAddress: ipAddress ?? null,
      createdAt: now(),
    })
    .run();
}

/**
 * Retrieves recent audit log entries.
 *
 * @param limit - Maximum number of entries to return
 * @param moduleSlug - Filter by module (optional)
 */
export async function getAuditLog(
  limit: number = 50,
  moduleSlug?: string,
) {
  let query = db.select().from(auditLog);

  if (moduleSlug) {
    query = query.where(eq(auditLog.moduleSlug, moduleSlug)) as typeof query;
  }

  return query.orderBy(desc(auditLog.createdAt)).limit(limit).all();
}

// -----------------------------------------------------------------------------
// Administration viewer query
// -----------------------------------------------------------------------------

export const AUDIT_PAGE_MAX_SIZE = 200;

export interface AuditLogFilters {
  moduleSlug?: string;
  action?: string;
  page: number;
  pageSize: number;
}

export interface AuditLogEntryView {
  id: string;
  /** Immutable actor identifier, retained after the user is deleted. */
  userId: string | null;
  /** Display identity when the actor's user row still exists. */
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  moduleSlug: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogPage {
  entries: AuditLogEntryView[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated audit query for the administration viewer. Deleted users keep
 * their opaque actor ID; the name/email join simply comes back null.
 */
export async function getAuditLogPage(filters: AuditLogFilters): Promise<AuditLogPage> {
  const conditions: SQL[] = [];
  if (filters.moduleSlug) conditions.push(eq(auditLog.moduleSlug, filters.moduleSlug));
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLog)
    .where(where)
    .all();

  const entries = await db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      actorName: users.name,
      actorEmail: users.email,
      action: auditLog.action,
      moduleSlug: auditLog.moduleSlug,
      details: auditLog.details,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize)
    .all();

  return {
    entries: entries.map((entry) => ({
      ...entry,
      details: safeJsonParse<Record<string, unknown>>(entry.details ?? '') ?? null,
    })),
    total: count,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}
