// =============================================================================
// RBAC Permission System
// =============================================================================
// Checks whether a user has permission to perform an action on a module.
// Three-tier model: admin (all access), member (per-module), restricted (view + whitelist).
// =============================================================================

import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, userPermissions } from '@/lib/db/schema';
import { safeJsonParse } from '@/lib/utils';
import type { UserRole } from '@/lib/modules/types';

/**
 * Checks if a user has permission to perform a specific action on a module.
 *
 * Logic:
 * 1. Admin role → always true (bypasses all checks)
 * 2. Look up user_permissions for this user + module
 * 3. Check if the requested action is in their allowed actions list
 *
 * @param userId - The user's ID
 * @param moduleSlug - The module to check against
 * @param action - The action to check (e.g., 'view', 'restart', 'configure')
 * @returns true if the user is allowed to perform the action
 */
export async function hasPermission(
  userId: string,
  moduleSlug: string,
  action: string,
): Promise<boolean> {
  // Fetch the user's role
  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!user) return false;

  // Admin bypasses everything
  if (user.role === 'admin') return true;

  // Look up module-specific permissions for this user
  const permission = await db
    .select({ actions: userPermissions.actions })
    .from(userPermissions)
    .where(
      and(
        eq(userPermissions.userId, userId),
        eq(userPermissions.moduleSlug, moduleSlug),
      ),
    )
    .get();

  if (!permission) return false;

  // Parse the JSON actions array
  const allowedActions = safeJsonParse<string[]>(permission.actions);
  if (!allowedActions) return false;

  return allowedActions.includes(action);
}

/**
 * Checks multiple permissions at once. Returns a map of action → boolean.
 * More efficient than calling hasPermission() multiple times.
 */
export async function checkPermissions(
  userId: string,
  moduleSlug: string,
  actions: string[],
): Promise<Record<string, boolean>> {
  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!user) {
    return Object.fromEntries(actions.map((a) => [a, false]));
  }

  // Admin gets everything
  if (user.role === 'admin') {
    return Object.fromEntries(actions.map((a) => [a, true]));
  }

  const permission = await db
    .select({ actions: userPermissions.actions })
    .from(userPermissions)
    .where(
      and(
        eq(userPermissions.userId, userId),
        eq(userPermissions.moduleSlug, moduleSlug),
      ),
    )
    .get();

  const allowedActions = permission
    ? safeJsonParse<string[]>(permission.actions) ?? []
    : [];

  return Object.fromEntries(
    actions.map((a) => [a, allowedActions.includes(a)]),
  );
}

/**
 * Gets the user's role from the database.
 */
export async function getUserRole(userId: string): Promise<UserRole | null> {
  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return (user?.role as UserRole) ?? null;
}

/**
 * Gets all modules a user has any permissions for.
 * Useful for building the sidebar — only show modules the user can access.
 */
export async function getUserModules(userId: string): Promise<string[]> {
  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!user) return [];

  // Admin sees all modules — return empty to signal "show everything"
  // The caller should check for admin role separately
  if (user.role === 'admin') return [];

  const permissions = await db
    .select({ moduleSlug: userPermissions.moduleSlug })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId))
    .all();

  return permissions.map((p) => p.moduleSlug);
}

/**
 * Grants permissions to a user for a specific module.
 * Replaces any existing permissions for that user + module combination.
 */
export async function setUserPermissions(
  userId: string,
  moduleSlug: string,
  actions: string[],
): Promise<void> {
  const { generateId, now } = await import('@/lib/utils');

  if (actions.length === 0) {
    await db
      .delete(userPermissions)
      .where(
        and(
          eq(userPermissions.userId, userId),
          eq(userPermissions.moduleSlug, moduleSlug),
        ),
      )
      .run();
    return;
  }

  await db
    .insert(userPermissions)
    .values({
      id: generateId(),
      userId,
      moduleSlug,
      actions: JSON.stringify(actions),
      createdAt: now(),
    })
    .onConflictDoUpdate({
      target: [userPermissions.userId, userPermissions.moduleSlug],
      set: { actions: JSON.stringify(actions), createdAt: now() },
    })
    .run();
}
