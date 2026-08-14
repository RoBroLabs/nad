import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { getAllInstalledModules } from '@/lib/modules/installed/provider';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { getReleaseSurfaceTrust, setExactDigestTrust } from '@/lib/modules/installed/trust';

interface RouteContext { params: Promise<{ appId: string }> }
const surfacePattern = /^[a-z][a-z0-9-]{0,79}$/;

function installedById(appId: string) {
  return getAllInstalledModules().find(({ moduleId }) => moduleId === appId);
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  const { appId } = await context.params;
  const installed = installedById(appId);
  if (!installed) return NextResponse.json({ error: 'Plugin not found.', code: 'NOT_FOUND' }, { status: 404 });
  const surfaceIds = installed.surfaces && Array.isArray(installed.surfaces.surfaces)
    ? installed.surfaces.surfaces.flatMap((surface) => surface && typeof surface === 'object' && typeof (surface as { id?: unknown }).id === 'string' ? [(surface as { id: string }).id] : [])
    : [];
  return NextResponse.json({
    data: {
      digest: installed.digest,
      surfaces: surfaceIds.map((surfaceId) => getReleaseSurfaceTrust(installed.digest, surfaceId)),
    },
  });
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin trust mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const { appId } = await context.params;
  const installed = installedById(appId);
  if (!installed) return NextResponse.json({ error: 'Plugin not found.', code: 'NOT_FOUND' }, { status: 404 });
  const payload = await readJsonObject(request);
  const surfaceIds = payload && Array.isArray(payload.surfaceIds)
    ? payload.surfaceIds.filter((value): value is string => typeof value === 'string' && surfacePattern.test(value))
    : null;
  const rawSurfaceIds = payload?.surfaceIds;
  if (!payload || !Array.isArray(rawSurfaceIds) || surfaceIds === null || surfaceIds.length !== rawSurfaceIds.length || typeof payload.trusted !== 'boolean') {
    return NextResponse.json({ error: 'Invalid exact-release trust decision.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  try {
    setExactDigestTrust({
      digest: installed.digest,
      decision: payload.trusted ? 'trusted' : 'sandboxed',
      basis: 'manual',
      surfaceIds,
      actorId: session.user.id,
    });
    await logAuditEvent(session.user.id, 'update_release_surface_trust', installed.manifest.slug, {
      digest: installed.digest,
      trusted: payload.trusted,
      surfaceIds,
    });
    return NextResponse.json({ data: { updated: true, digest: installed.digest } });
  } catch (error) {
    if (error instanceof ModulePackageError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
