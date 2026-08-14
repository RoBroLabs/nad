import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { workspaceErrorResponse } from '@/lib/workspaces/http';
import { getWorkspaceDetail, saveWorkspaceGrid } from '@/lib/workspaces/service';
import { parseWorkspaceGrid } from '@/lib/workspaces/validation';
import { authorizeConnectionProfile } from '@/lib/modules/connections';
import { getInstalledModule } from '@/lib/modules/installed/provider';
import { getSurfaceConnectionOwnerModuleId } from '@/lib/modules/installed/surfaces';

interface RouteContext { params: Promise<{ workspaceId: string; tabId: string }> }

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  const { workspaceId, tabId } = await context.params;
  const tab = getWorkspaceDetail(session.user.id, workspaceId)?.tabs.find(({ id }) => id === tabId);
  if (!tab || tab.kind !== 'grid') {
    return NextResponse.json({ error: 'Workspace grid not found.', code: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ data: { widgets: tab.widgets, layouts: tab.layouts } });
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin Workspace mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const payload = parseWorkspaceGrid(await readJsonObject(request));
  if (!payload) return NextResponse.json({ error: 'Invalid Workspace grid.', code: 'VALIDATION_ERROR' }, { status: 400 });
  const { workspaceId, tabId } = await context.params;
  try {
    for (const widget of payload.widgets) {
      if (!widget.connectionProfileId) continue;
      const installed = getInstalledModule(widget.moduleSlug);
      const surfaceId = installed?.manifest.widgets.find(({ id }) => id === widget.widgetId)?.sandboxSurfaceId;
      const ownerId = surfaceId
        ? getSurfaceConnectionOwnerModuleId(widget.moduleSlug, surfaceId)
        : undefined;
      if (!ownerId || !await authorizeConnectionProfile(widget.connectionProfileId, ownerId, session.user.id, 'view')) {
        return NextResponse.json({ error: 'Widget connection access unavailable.', code: 'CONNECTION_ACCESS_DENIED' }, { status: 403 });
      }
    }
    return NextResponse.json({ data: saveWorkspaceGrid(session.user.id, workspaceId, tabId, payload) });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
