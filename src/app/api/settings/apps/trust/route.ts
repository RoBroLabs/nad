import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import {
  getTrustedCodePolicy,
  setTrustedCodePolicy,
  type TrustedCodePolicy,
} from '@/lib/modules/installed/trust';

const policies = new Set<TrustedCodePolicy>(['reviewed_auto', 'manual_each_release', 'sandbox_only']);

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  return NextResponse.json({ data: { policy: getTrustedCodePolicy() } });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin trust mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }
  const payload = await readJsonObject(request);
  if (!payload || typeof payload.policy !== 'string' || !policies.has(payload.policy as TrustedCodePolicy)) {
    return NextResponse.json({ error: 'Invalid trusted-code policy.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const policy = payload.policy as TrustedCodePolicy;
  setTrustedCodePolicy(policy);
  await logAuditEvent(session.user.id, 'update_trusted_code_policy', undefined, { policy });
  return NextResponse.json({ data: { policy } });
}
