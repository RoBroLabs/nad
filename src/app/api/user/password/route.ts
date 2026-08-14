import bcrypt from 'bcrypt';
import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { passwordsMatch } from '@/lib/auth/password';
import { consumeRateLimit } from '@/lib/auth/rate-limit';
import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/db/audit';
import { users } from '@/lib/db/schema';
import { notify } from '@/lib/notifications';
import { now } from '@/lib/utils';
import { readJsonObject } from '@/lib/http';

const PASSWORD_CHANGE_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Bound attempts per account so an unattended unlocked session cannot be
  // used to brute-force the current password.
  const rateLimit = consumeRateLimit(`password-change:${session.user.id}`, 10, PASSWORD_CHANGE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many password change attempts. Try again later.', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'retry-after': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const payload = await readJsonObject(request);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid request body.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (password.length < 10 || password.length > 1_024) {
    return NextResponse.json(
      { error: 'New password must be between 10 and 1024 characters.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }
  if (!passwordsMatch(password, payload.passwordConfirmation)) {
    return NextResponse.json({ error: 'Passwords do not match.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const user = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .get();
  if (!user) {
    return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  const currentMatches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentMatches) {
    return NextResponse.json(
      { error: 'The current password is incorrect.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  // Advancing authVersion invalidates every existing session, including this
  // one; the user signs back in with the new password.
  await db
    .update(users)
    .set({
      passwordHash: await bcrypt.hash(password, 12),
      authVersion: sql`${users.authVersion} + 1`,
      updatedAt: now(),
    })
    .where(eq(users.id, user.id))
    .run();

  await logAuditEvent(user.id, 'change_password', undefined, { selfService: true });
  // Security event: best-effort notification; delivery never fails the request.
  void notify(
    'Account password changed',
    `${user.email} changed their password; all existing sessions were signed out.`,
    'info',
  ).catch(() => {});
  return NextResponse.json({ data: { changed: true } });
}
