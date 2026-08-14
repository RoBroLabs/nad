import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import {
  deleteConnectionProfile,
  listConnectionProfilesForAdmin,
  updateConnectionProfile,
  type ConnectionProfileInput,
} from '@/lib/modules/connections';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

interface RouteContext {
  params: Promise<{ appId: string; profileId: string }>;
}

function failure(error: unknown): NextResponse {
  const code = error instanceof ModulePackageError ? error.code : 'CONNECTION_FAILED';
  const status = code === 'CONNECTION_NOT_FOUND' ? 404
    : code === 'CONCURRENT_MODIFICATION' || code === 'CONNECTION_NAME_CONFLICT' ? 409
      : code === 'CONNECTION_FAILED' ? 500 : 400;
  return NextResponse.json({
    error: error instanceof ModulePackageError ? error.message : 'The connection operation failed.',
    code,
  }, { status });
}

function parseUpdate(payload: Record<string, unknown> | null): (
  Partial<ConnectionProfileInput> & { expectedRevision: number }
) | null {
  if (!payload || !Number.isInteger(payload.expectedRevision)) return null;
  const result: Partial<ConnectionProfileInput> & { expectedRevision: number } = {
    expectedRevision: Number(payload.expectedRevision),
  };
  if (payload.name !== undefined) {
    if (typeof payload.name !== 'string') return null;
    result.name = payload.name;
  }
  if (payload.values !== undefined) {
    if (!payload.values || typeof payload.values !== 'object' || Array.isArray(payload.values)) return null;
    const values: ConnectionProfileInput['values'] = {};
    for (const [key, rawValue] of Object.entries(payload.values)) {
      if (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') return null;
      values[key] = { value: String(rawValue) };
    }
    result.values = values;
  }
  if (payload.accessMode !== undefined) {
    if (payload.accessMode !== 'inherit' && payload.accessMode !== 'restricted') return null;
    result.accessMode = payload.accessMode;
  }
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== 'boolean') return null;
    result.enabled = payload.enabled;
  }
  if (payload.isDefault !== undefined) {
    if (typeof payload.isDefault !== 'boolean') return null;
    result.isDefault = payload.isDefault;
  }
  if (payload.schemaVersion !== undefined) {
    if (!Number.isInteger(payload.schemaVersion) || Number(payload.schemaVersion) < 1) return null;
    result.schemaVersion = Number(payload.schemaVersion);
  }
  return result;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  const { appId, profileId } = await context.params;
  try {
    const profile = listConnectionProfilesForAdmin(appId).find(({ id }) => id === profileId);
    return profile
      ? NextResponse.json({ data: profile })
      : NextResponse.json({ error: 'Connection profile not found', code: 'CONNECTION_NOT_FOUND' }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const input = parseUpdate(await readJsonObject(request));
  if (!input) return NextResponse.json({ error: 'Invalid connection update', code: 'VALIDATION_ERROR' }, { status: 400 });
  const { appId, profileId } = await context.params;
  try {
    const result = updateConnectionProfile(appId, profileId, input, session.user.id);
    await logAuditEvent(session.user.id, 'update_app_connection', appId, {
      connectionProfileId: profileId,
      revision: result.revision,
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const { appId, profileId } = await context.params;
  try {
    deleteConnectionProfile(appId, profileId);
    await logAuditEvent(session.user.id, 'delete_app_connection', appId, { connectionProfileId: profileId });
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return failure(error);
  }
}
