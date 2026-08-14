import bcrypt from 'bcrypt';
import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { passwordsMatch } from '@/lib/auth/password';
import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/db/audit';
import { users } from '@/lib/db/schema';
import { generateId, now } from '@/lib/utils';
import type { UserRole } from '@/lib/modules/types';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';

const roles: UserRole[] = ['admin', 'member', 'restricted'];

export async function GET(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }
  const records = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    canCreatePersonalWorkspaces: users.canCreatePersonalWorkspaces,
    createdAt: users.createdAt,
  }).from(users).orderBy(asc(users.name)).all();
  return NextResponse.json({ data: records });
}

export async function POST(request: Request): Promise<NextResponse> {
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

  const payload = await readJsonObject(request);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid request body.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const role = typeof payload.role === 'string' && roles.includes(payload.role as UserRole)
    ? payload.role as UserRole
    : null;
  if (
    !name
    || name.length > 100
    || !email.includes('@')
    || email.length > 320
    || password.length < 10
    || password.length > 1_024
    || !role
  ) {
    return NextResponse.json({ error: 'Enter a name, valid email, role, and password of at least 10 characters.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  if (!passwordsMatch(password, payload.passwordConfirmation)) {
    return NextResponse.json({ error: 'Passwords do not match.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (existing) {
    return NextResponse.json({ error: 'A user with this email already exists.', code: 'VALIDATION_ERROR' }, { status: 409 });
  }

  const timestamp = now();
  const user = {
    id: generateId(),
    name,
    email,
    role,
    canCreatePersonalWorkspaces: true,
    passwordHash: await bcrypt.hash(password, 12),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  try {
    await db.insert(users).values(user).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'A user with this email already exists.', code: 'VALIDATION_ERROR' }, { status: 409 });
    }
    throw error;
  }
  await logAuditEvent(session.user.id, 'create_user', undefined, { userId: user.id, role });
  return NextResponse.json({ data: { id: user.id, name, email, role, canCreatePersonalWorkspaces: true, createdAt: timestamp } }, { status: 201 });
}
