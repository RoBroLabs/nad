import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import {
  enforceApiAccessLock,
  getGeneralSettings,
  setGeneralSettings,
} from '@/lib/access';
import { getRequestOrigin, parseCanonicalUrl } from '@/lib/access-url';
import type { AccessMode } from '@/lib/access-url';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';

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

  return NextResponse.json({
    data: {
      ...await getGeneralSettings(),
      requestOrigin: getRequestOrigin(request.headers) ?? null,
    },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  const accessError = adminError(session);
  if (accessError) return accessError;
  if (!session) throw new Error('Admin session missing after access check.');
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin settings mutation refused.', code: 'CSRF_REFUSED' }, { status: 403 });
  }

  const payload = await readJsonObject(request);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid request body.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  if (typeof payload.canonicalUrl !== 'string') {
    return NextResponse.json(
      { error: 'Dashboard URL must be a string.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }
  const canonicalUrl = payload.canonicalUrl.trim();
  if (canonicalUrl && !parseCanonicalUrl(canonicalUrl)) {
    return NextResponse.json(
      {
        error: 'Enter an absolute HTTP(S) origin such as https://dashboard.example.com — no credentials, path, or query string.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  if (payload.accessMode !== 'off' && payload.accessMode !== 'locked') {
    return NextResponse.json(
      { error: 'Access mode must be off or locked.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }
  const accessMode: AccessMode = payload.accessMode;

  const normalisedCanonical = canonicalUrl ? parseCanonicalUrl(canonicalUrl) : null;
  const environmentFallback = process.env.AUTH_URL ?? process.env.APP_URL;
  const effectiveCanonical = normalisedCanonical
    ?? (environmentFallback ? parseCanonicalUrl(environmentFallback) : null);
  if (accessMode === 'locked' && !effectiveCanonical) {
    return NextResponse.json(
      { error: 'Set a dashboard URL (or the APP_URL environment variable) before locking access.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  await setGeneralSettings({ canonicalUrl: normalisedCanonical, accessMode });
  await logAuditEvent(session.user.id, 'update_general_settings', undefined, {
    canonicalUrl: normalisedCanonical,
    accessMode,
  });

  const settings = await getGeneralSettings();
  return NextResponse.json({
    data: {
      ...settings,
      requestOrigin: getRequestOrigin(request.headers) ?? null,
      // Tell the browser where to go next when the lock now refuses this origin.
      redirectTo: accessMode === 'locked'
        && settings.effectiveCanonicalUrl
        && getRequestOrigin(request.headers) !== settings.effectiveCanonicalUrl
        ? settings.effectiveCanonicalUrl
        : null,
    },
  });
}
