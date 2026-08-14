import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { workspaceErrorResponse } from '@/lib/workspaces/http';
import { cloneWorkspaceTemplate } from '@/lib/workspaces/service';
import { parseWorkspaceName } from '@/lib/workspaces/validation';

interface RouteContext { params: Promise<{ templateId: string }> }

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
  if (!name) return NextResponse.json({ error: 'Enter a Workspace name.', code: 'VALIDATION_ERROR' }, { status: 400 });
  const { templateId } = await context.params;
  try {
    const workspace = cloneWorkspaceTemplate(session.user.id, templateId, name);
    await logAuditEvent(session.user.id, 'apply_workspace_template', undefined, { templateId, workspaceId: workspace.id });
    return NextResponse.json({ data: workspace }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
