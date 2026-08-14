import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { ChannelError, createChannel, listChannels } from '@/lib/notifications/channels';

function adminError(session: Session | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  const accessError = adminError(session);
  if (accessError) return accessError;

  return NextResponse.json({ data: { channels: await listChannels() } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  const accessError = adminError(session);
  if (accessError) return accessError;
  if (!session) throw new Error('Admin session missing after access check.');
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin notification mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }

  const payload = await readJsonObject(request);
  if (!payload || typeof payload.type !== 'string'
    || !payload.config || typeof payload.config !== 'object' || Array.isArray(payload.config)) {
    return NextResponse.json({ error: 'Invalid channel configuration.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const channel = await createChannel(
      payload.type,
      payload.config as Record<string, unknown>,
      payload.enabled !== false,
    );
    await logAuditEvent(session.user.id, 'create_notification_channel', undefined, {
      channelId: channel.id,
      type: channel.type,
    });
    return NextResponse.json({ data: channel }, { status: 201 });
  } catch (error) {
    if (error instanceof ChannelError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
