import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import {
  createConnectionProfile,
  listConnectionProfilesForAdmin,
  type ConnectionProfileInput,
} from '@/lib/modules/connections';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

interface RouteContext {
  params: Promise<{ appId: string }>;
}

function errorResponse(error: unknown): NextResponse {
  const code = error instanceof ModulePackageError ? error.code : 'CONNECTION_FAILED';
  const status = code === 'APP_NOT_INSTALLED' ? 404
    : code === 'CONNECTION_LIMIT' || code === 'CONNECTION_NAME_CONFLICT' ? 409
      : code === 'CONNECTION_FAILED' ? 500 : 400;
  return NextResponse.json({
    error: error instanceof ModulePackageError ? error.message : 'The connection could not be saved.',
    code,
  }, { status });
}

function inputFromPayload(payload: Record<string, unknown> | null): ConnectionProfileInput | null {
  if (!payload || typeof payload.name !== 'string') return null;
  if (!payload.values || typeof payload.values !== 'object' || Array.isArray(payload.values)) return null;
  const values: ConnectionProfileInput['values'] = {};
  for (const [key, rawValue] of Object.entries(payload.values)) {
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') return null;
    values[key] = { value: String(rawValue) };
  }
  if (payload.accessMode !== undefined && payload.accessMode !== 'inherit' && payload.accessMode !== 'restricted') return null;
  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') return null;
  if (payload.isDefault !== undefined && typeof payload.isDefault !== 'boolean') return null;
  if (payload.schemaVersion !== undefined && (!Number.isInteger(payload.schemaVersion) || Number(payload.schemaVersion) < 1)) return null;
  return {
    name: payload.name,
    values,
    accessMode: payload.accessMode as ConnectionProfileInput['accessMode'],
    enabled: payload.enabled as boolean | undefined,
    isDefault: payload.isDefault as boolean | undefined,
    schemaVersion: payload.schemaVersion as number | undefined,
  };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  const { appId } = await context.params;
  try {
    return NextResponse.json({ data: listConnectionProfilesForAdmin(appId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const input = inputFromPayload(await readJsonObject(request));
  if (!input) return NextResponse.json({ error: 'Invalid connection', code: 'VALIDATION_ERROR' }, { status: 400 });
  const { appId } = await context.params;
  try {
    const result = createConnectionProfile(appId, input, session.user.id);
    await logAuditEvent(session.user.id, 'create_app_connection', appId, {
      connectionProfileId: result.id,
      accessMode: result.accessMode,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
