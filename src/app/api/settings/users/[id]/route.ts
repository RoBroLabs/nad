import bcrypt from 'bcrypt';
import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { passwordsMatch } from '@/lib/auth/password';
import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/db/audit';
import { users } from '@/lib/db/schema';
import { notify } from '@/lib/notifications';
import { now } from '@/lib/utils';
import type { UserRole } from '@/lib/modules/types';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const roles: UserRole[] = ['admin', 'member', 'restricted'];

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin user mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const { id } = await context.params;
  const target = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).get();
  if (!target) return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });

  const payload = await readJsonObject(request);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid request body.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const updates: {
    authVersion?: ReturnType<typeof sql>;
    role?: UserRole;
    passwordHash?: string;
    canCreatePersonalWorkspaces?: boolean;
    updatedAt: string;
  } = { updatedAt: now() };
  if (payload.role !== undefined) {
    if (typeof payload.role !== 'string' || !roles.includes(payload.role as UserRole)) {
      return NextResponse.json({ error: 'Invalid role', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const role = payload.role as UserRole;
    if (id === session.user.id && role !== 'admin') {
      return NextResponse.json({ error: 'You cannot change your own administrator role.', code: 'VALIDATION_ERROR' }, { status: 409 });
    }
    updates.role = role;
  }
  if (payload.password !== undefined) {
    if (typeof payload.password !== 'string' || payload.password.length < 10 || payload.password.length > 1_024) {
      return NextResponse.json({ error: 'Password must be between 10 and 1024 characters.', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (!passwordsMatch(payload.password, payload.passwordConfirmation)) {
      return NextResponse.json({ error: 'Passwords do not match.', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    updates.passwordHash = await bcrypt.hash(payload.password, 12);
    updates.authVersion = sql`${users.authVersion} + 1`;
  }
  if (payload.canCreatePersonalWorkspaces !== undefined) {
    if (typeof payload.canCreatePersonalWorkspaces !== 'boolean') {
      return NextResponse.json({ error: 'Invalid personal Workspace setting.', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    updates.canCreatePersonalWorkspaces = payload.canCreatePersonalWorkspaces;
  }
  if (!updates.role && !updates.passwordHash && updates.canCreatePersonalWorkspaces === undefined) {
    return NextResponse.json({ error: 'No supported changes supplied.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const updateResult = db.transaction((transaction) => {
    const current = transaction
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!current) return 'not_found' as const;
    if (current.role === 'admin' && updates.role && updates.role !== 'admin') {
      const adminCount = transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'))
        .all()
        .length;
      if (adminCount <= 1) return 'last_admin' as const;
    }
    transaction.update(users).set(updates).where(eq(users.id, id)).run();
    return 'updated' as const;
  });
  if (updateResult === 'not_found') {
    return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (updateResult === 'last_admin') {
    return NextResponse.json({ error: 'The last administrator cannot be demoted.', code: 'VALIDATION_ERROR' }, { status: 409 });
  }
  await logAuditEvent(session.user.id, 'update_user', undefined, {
    userId: id,
    role: updates.role,
    passwordReset: Boolean(updates.passwordHash),
    canCreatePersonalWorkspaces: updates.canCreatePersonalWorkspaces,
  });
  // Security event: an administrator resetting another account's password.
  if (updates.passwordHash) {
    void notify(
      'Account password reset by administrator',
      `An administrator reset the password for ${target.email}; that account's sessions were signed out.`,
      'warning',
    ).catch(() => {});
  }
  return NextResponse.json({ data: { updated: true } });
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin user mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const { id } = await context.params;
  if (id === session.user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.', code: 'VALIDATION_ERROR' }, { status: 409 });
  }
  const target = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
  if (!target) return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  const deleteResult = db.transaction((transaction) => {
    const current = transaction
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!current) return 'not_found' as const;
    if (current.role === 'admin') {
      const adminCount = transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'))
        .all()
        .length;
      if (adminCount <= 1) return 'last_admin' as const;
    }
    transaction.delete(users).where(eq(users.id, id)).run();
    return 'deleted' as const;
  });
  if (deleteResult === 'not_found') {
    return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (deleteResult === 'last_admin') {
    return NextResponse.json({ error: 'The last administrator cannot be deleted.', code: 'VALIDATION_ERROR' }, { status: 409 });
  }
  await logAuditEvent(session.user.id, 'delete_user', undefined, { userId: id });
  return NextResponse.json({ data: { deleted: true } });
}
