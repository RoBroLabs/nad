import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { getModule } from '@/lib/modules/registry';
import { setInstalledModuleEnabled, uninstallModule } from '@/lib/modules/installed/lifecycle';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

const lifecycleConflictCodes = new Set([
  'CONCURRENT_MODIFICATION',
  'MODULE_BUSY',
  'MODULE_INVOCATION_DRAINING',
  'MODULE_INVOCATION_IN_FLIGHT',
  'MODULE_LIFECYCLE_BUSY',
  'MODULE_MUTATION_DRAINING',
  'MODULE_MUTATION_IN_FLIGHT',
  'MODULE_RELEASE_IN_FLIGHT',
]);

function lifecycleErrorStatus(code: string): number {
  return lifecycleConflictCodes.has(code) ? 409 : 400;
}

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
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }

  const { slug } = await context.params;
  if (!getModule(slug)) {
    return NextResponse.json({ error: 'Module not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  const payload = await readJsonObject(request);
  if (!payload || typeof payload.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Enabled must be a boolean', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const result = await setInstalledModuleEnabled(slug, payload.enabled, session.user.id);
    await logAuditEvent(session.user.id, payload.enabled ? 'enable_module' : 'disable_module', slug, {
      operationId: result.operationId,
      changed: result.changed,
    });

    return NextResponse.json({ data: { enabled: payload.enabled } });
  } catch (error) {
    const code = error instanceof ModulePackageError ? error.code : 'MODULE_LIFECYCLE_FAILED';
    await logAuditEvent(session.user.id, payload.enabled ? 'enable_module_failed' : 'disable_module_failed', slug, { code });
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'The Module lifecycle operation failed.',
      code,
    }, { status: lifecycleErrorStatus(code) });
  }
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
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }

  const { slug } = await context.params;
  if (!getModule(slug)) {
    return NextResponse.json({ error: 'Module not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  const payload = await readJsonObject(request);
  const configAndStorage = payload?.configAndStorage;
  const artifacts = payload?.artifacts;
  if ((configAndStorage !== 'retain' && configAndStorage !== 'delete') || (artifacts !== 'retain' && artifacts !== 'delete')) {
    return NextResponse.json({
      error: 'Uninstall requires explicit configAndStorage and artifacts retention choices.',
      code: 'VALIDATION_ERROR',
    }, { status: 400 });
  }

  try {
    const result = await uninstallModule(slug, session.user.id, { configAndStorage, artifacts });
    await logAuditEvent(session.user.id, 'uninstall_module', slug, {
      operationId: result.operationId,
      configAndStorage: result.configAndStorage,
      artifacts: result.artifacts,
      prunedArtifacts: result.prunedArtifacts,
      retainedArtifacts: result.retainedArtifacts,
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const code = error instanceof ModulePackageError ? error.code : 'MODULE_LIFECYCLE_FAILED';
    await logAuditEvent(session.user.id, 'uninstall_module_failed', slug, { code });
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'The Module could not be uninstalled.',
      code,
    }, { status: lifecycleErrorStatus(code) });
  }
}
