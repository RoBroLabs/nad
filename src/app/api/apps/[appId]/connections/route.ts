import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { listConnectionProfilesForUser } from '@/lib/modules/connections';

interface RouteContext {
  params: Promise<{ appId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  const { appId } = await context.params;
  // The service intentionally returns only opaque IDs and administrator-set
  // names. It never exposes configuration fields or secret-derived values.
  return NextResponse.json({ data: await listConnectionProfilesForUser(appId, session.user.id) });
}
