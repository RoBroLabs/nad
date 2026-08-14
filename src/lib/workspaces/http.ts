import { NextResponse } from 'next/server';

const clientErrors: Record<string, { status: number; message: string }> = {
  FORBIDDEN: { status: 403, message: 'You cannot change this Workspace.' },
  NOT_FOUND: { status: 404, message: 'Workspace not found.' },
  OWNER_NOT_FOUND: { status: 400, message: 'Workspace owner not found.' },
  USER_NOT_FOUND: { status: 404, message: 'User not found.' },
  WORKSPACE_LIMIT: { status: 409, message: 'Workspace limit reached.' },
  TAB_LIMIT: { status: 409, message: 'Workspace tab limit reached.' },
  LAST_TAB: { status: 409, message: 'A Workspace must keep at least one tab.' },
  SURFACE_REQUIRED: { status: 400, message: 'A full-page tab requires a declared plugin surface.' },
  ASSIGNMENT_LIMIT: { status: 409, message: 'Workspace assignment limit reached.' },
  INVALID_ASSIGNMENT: { status: 400, message: 'A Workspace assignment is invalid.' },
  PERSONAL_WORKSPACES_DISABLED: { status: 403, message: 'Personal Workspace creation is disabled for this account.' },
};

export function workspaceErrorResponse(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
  const mapped = clientErrors[code];
  if (mapped) return NextResponse.json({ error: mapped.message, code }, { status: mapped.status });
  console.error('Workspace operation failed', { errorType: error instanceof Error ? error.name : typeof error });
  return NextResponse.json({ error: 'Workspace operation failed.', code: 'INTERNAL_ERROR' }, { status: 500 });
}
