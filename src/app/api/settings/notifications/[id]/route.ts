import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import {
  ChannelError,
  deleteChannel,
  setChannelEnabled,
  updateChannel,
  getChannelSummary,
} from '@/lib/notifications/channels';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function adminError(session: Session | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }
  return null;
}

function channelErrorResponse(error: unknown): NextResponse {
  if (error instanceof ChannelError) {
    const status = error.code === 'NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  throw error;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  const accessError = adminError(session);
  if (accessError) return accessError;
  if (!session) throw new Error('Admin session missing after access check.');
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin notification mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = await readJsonObject(request);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid request body.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const hasConfig = payload.config !== undefined;
  const hasEnabled = payload.enabled !== undefined;
  if (!hasConfig && !hasEnabled) {
    return NextResponse.json({ error: 'No supported changes supplied.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  if (hasEnabled && typeof payload.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Enabled must be a boolean.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  if (hasConfig && (!payload.config || typeof payload.config !== 'object' || Array.isArray(payload.config))) {
    return NextResponse.json({ error: 'Invalid channel configuration.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    if (hasConfig) {
      await updateChannel(id, payload.config as Record<string, unknown>);
    }
    if (hasEnabled) {
      await setChannelEnabled(id, payload.enabled as boolean);
    }
    const summary = await getChannelSummary(id);
    await logAuditEvent(session.user.id, 'update_notification_channel', undefined, {
      channelId: id,
      configUpdated: hasConfig,
      enabled: hasEnabled ? payload.enabled : undefined,
    });
    return NextResponse.json({ data: summary });
  } catch (error) {
    return channelErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  const accessError = adminError(session);
  if (accessError) return accessError;
  if (!session) throw new Error('Admin session missing after access check.');
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin notification mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }

  const { id } = await context.params;
  try {
    const summary = await getChannelSummary(id);
    await deleteChannel(id);
    await logAuditEvent(session.user.id, 'delete_notification_channel', undefined, {
      channelId: id,
      type: summary?.type,
    });
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return channelErrorResponse(error);
  }
}
