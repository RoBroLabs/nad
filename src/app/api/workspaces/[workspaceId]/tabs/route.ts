import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { workspaceErrorResponse } from '@/lib/workspaces/http';
import { createWorkspaceTab } from '@/lib/workspaces/service';
import { parseWorkspaceName, parseWorkspaceTabKind } from '@/lib/workspaces/validation';
import { canAccessInstalledSurface, getSurfaceDefinition } from '@/lib/modules/installed/surfaces';

interface RouteContext { params: Promise<{ workspaceId: string }> }
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin Workspace mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const payload = await readJsonObject(request);
  const name = parseWorkspaceName(payload?.name);
  const kind = parseWorkspaceTabKind(payload?.kind ?? 'grid');
  const surfaceModuleSlug = payload?.surfaceModuleSlug === undefined || payload.surfaceModuleSlug === null
    ? null
    : typeof payload.surfaceModuleSlug === 'string' && slugPattern.test(payload.surfaceModuleSlug) ? payload.surfaceModuleSlug : undefined;
  const surfaceId = payload?.surfaceId === undefined || payload.surfaceId === null
    ? null
    : typeof payload.surfaceId === 'string' && slugPattern.test(payload.surfaceId) ? payload.surfaceId : undefined;
  const connectionProfileId = payload?.connectionProfileId === undefined || payload.connectionProfileId === null
    ? null
    : typeof payload.connectionProfileId === 'string' && payload.connectionProfileId.length <= 128 ? payload.connectionProfileId : undefined;
  if (!payload || !name || !kind || surfaceModuleSlug === undefined || surfaceId === undefined || connectionProfileId === undefined) {
    return NextResponse.json({ error: 'Invalid Workspace tab.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const { workspaceId } = await context.params;
  try {
    if (kind === 'surface') {
      if (!surfaceModuleSlug || !surfaceId) {
        return NextResponse.json({ error: 'Choose an installed plugin page.', code: 'SURFACE_REQUIRED' }, { status: 400 });
      }
      const surface = getSurfaceDefinition(surfaceModuleSlug, surfaceId);
      if (!surface || surface.surface.type !== 'page') {
        return NextResponse.json({ error: 'Plugin page unavailable.', code: 'SURFACE_NOT_FOUND' }, { status: 404 });
      }
      if (!await canAccessInstalledSurface(session.user.id, surfaceModuleSlug, surfaceId, 'page')) {
        return NextResponse.json({ error: 'Plugin page access unavailable.', code: 'SURFACE_ACCESS_DENIED' }, { status: 403 });
      }
    }
    const tab = createWorkspaceTab(session.user.id, workspaceId, {
      name,
      kind,
      surfaceModuleSlug,
      surfaceId,
      connectionProfileId,
    });
    await logAuditEvent(session.user.id, 'create_workspace_tab', surfaceModuleSlug ?? undefined, { workspaceId, tabId: tab.id, kind });
    return NextResponse.json({ data: tab }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
