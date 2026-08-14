import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { workspaceErrorResponse } from '@/lib/workspaces/http';
import { deleteWorkspace, getWorkspaceDetail, updateWorkspace } from '@/lib/workspaces/service';
import { parseWorkspaceName } from '@/lib/workspaces/validation';

interface RouteContext { params: Promise<{ workspaceId: string }> }

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  const { workspaceId } = await context.params;
  const workspace = getWorkspaceDetail(session.user.id, workspaceId);
  return workspace
    ? NextResponse.json({ data: workspace })
    : NextResponse.json({ error: 'Workspace not found.', code: 'NOT_FOUND' }, { status: 404 });
}
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
  const pinned = payload.pinned === undefined ? undefined : typeof payload.pinned === 'boolean' ? payload.pinned : null;
  if ((payload.name !== undefined && !name) || pinned === null) {
    return NextResponse.json({ error: 'Invalid Workspace update.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const { workspaceId } = await context.params;
  try {
    const workspace = updateWorkspace(session.user.id, workspaceId, { name, pinned: pinned ?? undefined });
    await logAuditEvent(session.user.id, 'update_workspace', undefined, { workspaceId });
    return NextResponse.json({ data: workspace });
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
  const { workspaceId } = await context.params;
  try {
    deleteWorkspace(session.user.id, workspaceId);
    await logAuditEvent(session.user.id, 'delete_workspace', undefined, { workspaceId });
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
