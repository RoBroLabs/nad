import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { rollbackModuleRelease } from '@/lib/modules/installed/lifecycle';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
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
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }

  const { slug } = await context.params;
  const payload = await readJsonObject(request);
  if (!payload || typeof payload.releaseId !== 'string' || payload.releaseId.length < 1 || payload.releaseId.length > 120) {
    await logAuditEvent(session.user.id, 'rollback_module_failed', slug, { code: 'VALIDATION_ERROR' });
    return NextResponse.json({ error: 'releaseId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const result = await rollbackModuleRelease(slug, session.user.id, { targetReleaseId: payload.releaseId });
    await logAuditEvent(session.user.id, 'rollback_module', slug, {
      operationId: result.operationId,
      fromReleaseId: result.replacedReleaseId,
      toReleaseId: result.releaseId,
      version: result.version,
      digest: result.digest,
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const code = error instanceof ModulePackageError ? error.code : 'ROLLBACK_FAILED';
    const message = error instanceof Error ? error.message : 'Module rollback failed.';
    await logAuditEvent(session.user.id, 'rollback_module_failed', slug, { code });
    const status = code === 'MODULE_NOT_INSTALLED' || code === 'RELEASE_NOT_FOUND'
      ? 404
      : code === 'VALIDATION_ERROR'
        ? 400
        : 409;
    return NextResponse.json({ error: message, code }, { status });
  }
}
