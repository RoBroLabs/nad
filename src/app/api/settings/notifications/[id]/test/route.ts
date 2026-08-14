import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { consumeRateLimit } from '@/lib/auth/rate-limit';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest } from '@/lib/http';
import { sendChannelTestNotification } from '@/lib/notifications';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const TEST_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json(
      { error: 'Cross-origin notification test refused', code: 'CROSS_ORIGIN_REQUEST' },
      { status: 403 },
    );
  }

  // Test delivery sends real external messages; bound it per administrator.
  const rateLimit = consumeRateLimit(`notification-test:${session.user.id}`, 10, TEST_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many test notifications. Try again later.', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'retry-after': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { id } = await context.params;
  try {
    await sendChannelTestNotification(id);
    await logAuditEvent(session.user.id, 'test_notification_channel', undefined, { channelId: id });
    return NextResponse.json({ data: { delivered: true } });
  } catch {
    return NextResponse.json(
      { error: 'The test notification could not be delivered. Check the channel configuration.', code: 'DELIVERY_FAILED' },
      { status: 502 },
    );
  }
}
