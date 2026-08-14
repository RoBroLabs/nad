import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { setUserPermissions } from '@/lib/auth/permissions';
import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/db/audit';
import { users } from '@/lib/db/schema';
import { getModule } from '@/lib/modules/registry';
import { eq } from 'drizzle-orm';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
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
    return NextResponse.json({ error: 'Cross-origin permission mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const { id } = await context.params;
  const targetUser = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  const payload = await readJsonObject(request);
  if (!payload || typeof payload.moduleSlug !== 'string' || !Array.isArray(payload.actions) || !payload.actions.every((action) => typeof action === 'string')) {
    return NextResponse.json({ error: 'Invalid permissions', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const manifest = getModule(payload.moduleSlug);
  if (!manifest) return NextResponse.json({ error: 'Module not found', code: 'NOT_FOUND' }, { status: 404 });
  const supportedActions = new Set(manifest.permissions.map(({ action }) => action));
  const actions = payload.actions.filter((action): action is string => typeof action === 'string' && supportedActions.has(action));
  if (actions.length !== payload.actions.length) {
    return NextResponse.json({ error: 'Unsupported permission action', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  await setUserPermissions(id, payload.moduleSlug, actions);
  await logAuditEvent(session.user.id, 'update_user_permissions', payload.moduleSlug, { userId: id, actions });
  return NextResponse.json({ data: { actions } });
}
