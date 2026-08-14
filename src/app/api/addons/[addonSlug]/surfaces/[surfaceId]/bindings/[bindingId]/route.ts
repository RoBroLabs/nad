import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { invokeAddonBinding } from '@/lib/modules/installed/app-operations';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

interface RouteContext {
  params: Promise<{ addonSlug: string; surfaceId: string; bindingId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const payload = await readJsonObject(request);
  if (!payload || !payload.connectionBindings || typeof payload.connectionBindings !== 'object' || Array.isArray(payload.connectionBindings)) {
    return NextResponse.json({ error: 'Invalid connection bindings', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const connectionBindings: Record<string, string> = {};
  for (const [slot, profileId] of Object.entries(payload.connectionBindings)) {
    if (typeof profileId !== 'string') {
      return NextResponse.json({ error: 'Invalid connection binding', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    connectionBindings[slot] = profileId;
  }
  const { addonSlug, surfaceId, bindingId } = await context.params;
  try {
    const result = await invokeAddonBinding({
      addonSlug,
      surfaceId,
      bindingId,
      connectionBindings,
      userId: session.user.id,
      input: payload.input ?? {},
    });
    return NextResponse.json({ data: result.data, correlationId: result.correlationId });
  } catch (error) {
    const code = error instanceof ModulePackageError ? error.code : 'OPERATION_FAILED';
    const denied = code.endsWith('_DENIED') || code.endsWith('_REFUSED');
    const unavailable = code.endsWith('_UNAVAILABLE') || code === 'CONNECTION_REQUIRED';
    const missing = code.endsWith('_NOT_FOUND');
    const status = denied ? 403 : missing ? 404 : unavailable ? 503 : code === 'OPERATION_FAILED' ? 500 : 400;
    return NextResponse.json({
      error: error instanceof ModulePackageError ? error.message : 'Add-on operation failed.',
      code,
    }, { status });
  }
}
