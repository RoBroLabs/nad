import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import {
  listConnectionProfileAccess,
  replaceConnectionProfileAccess,
  type ConnectionAccessGrantInput,
} from '@/lib/modules/connections';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

interface RouteContext {
  params: Promise<{ appId: string; profileId: string }>;
}

function failure(error: unknown): NextResponse {
  const code = error instanceof ModulePackageError ? error.code : 'CONNECTION_ACCESS_FAILED';
  return NextResponse.json({
    error: error instanceof ModulePackageError ? error.message : 'Connection access could not be saved.',
    code,
  }, { status: code === 'CONNECTION_NOT_FOUND' ? 404 : code === 'CONNECTION_ACCESS_FAILED' ? 500 : 400 });
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  const { appId, profileId } = await context.params;
  try {
    return NextResponse.json({ data: listConnectionProfileAccess(appId, profileId) });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const payload = await readJsonObject(request);
  if (!payload || !Array.isArray(payload.grants)) {
    return NextResponse.json({ error: 'Invalid connection grants', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const grants: ConnectionAccessGrantInput[] = [];
  for (const grant of payload.grants) {
    if (
      !grant
      || typeof grant !== 'object'
      || Array.isArray(grant)
      || ((grant as Record<string, unknown>).subjectType !== 'user'
        && (grant as Record<string, unknown>).subjectType !== 'role')
      || typeof (grant as Record<string, unknown>).subjectId !== 'string'
    ) {
      return NextResponse.json({ error: 'Invalid connection grant', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    grants.push({
      subjectType: (grant as { subjectType: 'user' | 'role' }).subjectType,
      subjectId: (grant as { subjectId: string }).subjectId,
    });
  }
  const { appId, profileId } = await context.params;
  try {
    replaceConnectionProfileAccess(appId, profileId, grants, session.user.id);
    await logAuditEvent(session.user.id, 'update_app_connection_access', appId, {
      connectionProfileId: profileId,
      grantCount: grants.length,
    });
    return NextResponse.json({ data: listConnectionProfileAccess(appId, profileId) });
  } catch (error) {
    return failure(error);
  }
}
