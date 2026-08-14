import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { workspaceErrorResponse } from '@/lib/workspaces/http';
import { createWorkspace, ensurePersonalWorkspace, listWorkspaceNavigation } from '@/lib/workspaces/service';
import { parseWorkspaceKind, parseWorkspaceName } from '@/lib/workspaces/validation';

export async function GET(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  ensurePersonalWorkspace(session.user.id);
  return NextResponse.json({ data: listWorkspaceNavigation(session.user.id) });
}
export async function POST(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin Workspace mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const payload = await readJsonObject(request);
  const name = parseWorkspaceName(payload?.name);
  const kind = parseWorkspaceKind(payload?.kind ?? 'personal');
  const ownerUserId = payload?.ownerUserId === null || payload?.ownerUserId === undefined
    ? undefined
    : typeof payload.ownerUserId === 'string' && payload.ownerUserId.length <= 128
      ? payload.ownerUserId
      : null;
  if (!payload || !name || !kind || ownerUserId === null) {
    return NextResponse.json({ error: 'Enter a valid Workspace name and kind.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  try {
    const workspace = createWorkspace(session.user.id, { name, kind, ownerUserId });
    await logAuditEvent(session.user.id, 'create_workspace', undefined, { workspaceId: workspace.id, kind });
    return NextResponse.json({ data: workspace }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
