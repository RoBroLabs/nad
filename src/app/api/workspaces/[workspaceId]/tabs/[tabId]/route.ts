import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { workspaceErrorResponse } from '@/lib/workspaces/http';
import { deleteWorkspaceTab, getWorkspaceDetail, updateWorkspaceTab } from '@/lib/workspaces/service';
import { parseWorkspaceName } from '@/lib/workspaces/validation';
import { authorizeConnectionProfile } from '@/lib/modules/connections';
import { getSurfaceConnectionOwnerModuleId } from '@/lib/modules/installed/surfaces';

interface RouteContext { params: Promise<{ workspaceId: string; tabId: string }> }

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin Workspace mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const payload = await readJsonObject(request);
  if (!payload) return NextResponse.json({ error: 'Invalid request.', code: 'VALIDATION_ERROR' }, { status: 400 });
  const name = payload.name === undefined ? undefined : parseWorkspaceName(payload.name);
  const positionCandidate = payload.position;
  const position = positionCandidate === undefined
    ? undefined
    : typeof positionCandidate === 'number'
      && Number.isInteger(positionCandidate)
      && positionCandidate >= 0
      && positionCandidate < 20
      ? positionCandidate
      : null;
  const connectionProfileId = payload.connectionProfileId === undefined
    ? undefined
    : payload.connectionProfileId === null
      ? null
      : typeof payload.connectionProfileId === 'string' && payload.connectionProfileId.length <= 128 ? payload.connectionProfileId : false;
  if ((payload.name !== undefined && !name) || position === null || connectionProfileId === false) {
    return NextResponse.json({ error: 'Invalid Workspace tab update.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const { workspaceId, tabId } = await context.params;
  try {
    if (typeof connectionProfileId === 'string') {
      const current = getWorkspaceDetail(session.user.id, workspaceId)?.tabs.find(({ id }) => id === tabId);
      const ownerId = current?.surfaceModuleSlug && current.surfaceId
        ? getSurfaceConnectionOwnerModuleId(current.surfaceModuleSlug, current.surfaceId)
        : undefined;
      if (!ownerId || !await authorizeConnectionProfile(connectionProfileId, ownerId, session.user.id, 'view')) {
        return NextResponse.json({ error: 'Connection access unavailable.', code: 'CONNECTION_ACCESS_DENIED' }, { status: 403 });
      }
    }
    const tab = updateWorkspaceTab(session.user.id, workspaceId, tabId, {
      name,
      position: position ?? undefined,
      connectionProfileId,
    });
    await logAuditEvent(session.user.id, 'update_workspace_tab', tab.surfaceModuleSlug ?? undefined, { workspaceId, tabId });
    return NextResponse.json({ data: tab });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin Workspace mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const { workspaceId, tabId } = await context.params;
  try {
    deleteWorkspaceTab(session.user.id, workspaceId, tabId);
    await logAuditEvent(session.user.id, 'delete_workspace_tab', undefined, { workspaceId, tabId });
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
