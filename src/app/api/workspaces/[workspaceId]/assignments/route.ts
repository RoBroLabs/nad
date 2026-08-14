import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { workspaceErrorResponse } from '@/lib/workspaces/http';
import { replaceWorkspaceAssignments } from '@/lib/workspaces/service';
import { parseAssignmentSubject } from '@/lib/workspaces/validation';

interface RouteContext { params: Promise<{ workspaceId: string }> }

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin Workspace mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const payload = await readJsonObject(request);
  if (!payload || !Array.isArray(payload.assignments) || payload.assignments.length > 100) {
    return NextResponse.json({ error: 'Invalid Workspace assignments.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const assignments = payload.assignments.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const item = entry as Record<string, unknown>;
    const subjectType = parseAssignmentSubject(item.subjectType);
    const subjectId = subjectType === 'all' ? null : typeof item.subjectId === 'string' && item.subjectId.length <= 128 ? item.subjectId : undefined;
    const access: 'view' | 'edit' | undefined = item.access === 'view' || item.access === 'edit'
      ? item.access
      : undefined;
    return subjectType && subjectId !== undefined && access ? { subjectType, subjectId, access } : undefined;
  });
  if (assignments.some((entry) => entry === undefined)) {
    return NextResponse.json({ error: 'Invalid Workspace assignment.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const { workspaceId } = await context.params;
  try {
    const result = replaceWorkspaceAssignments(session.user.id, workspaceId, assignments as Exclude<typeof assignments[number], undefined>[]);
    await logAuditEvent(session.user.id, 'assign_workspace', undefined, { workspaceId, assignmentCount: result.length });
    return NextResponse.json({ data: result });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
