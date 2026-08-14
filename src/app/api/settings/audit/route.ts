import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { AUDIT_PAGE_MAX_SIZE, getAuditLogPage } from '@/lib/db/audit';
import { getAllModules } from '@/lib/modules/registry';

const MAX_FILTER_LENGTH = 128;

function boundedFilter(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_FILTER_LENGTH ? trimmed : undefined;
}

function boundedPositiveInteger(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const moduleSlug = boundedFilter(params.get('module'));
  if (moduleSlug && !getAllModules().some(({ slug }) => slug === moduleSlug)) {
    return NextResponse.json({ error: 'Unknown module filter.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const page = await getAuditLogPage({
    moduleSlug,
    action: boundedFilter(params.get('action')),
    page: boundedPositiveInteger(params.get('page'), 1, 1_000_000),
    pageSize: boundedPositiveInteger(params.get('pageSize'), 50, AUDIT_PAGE_MAX_SIZE),
  });

  return NextResponse.json({
    data: {
      ...page,
      modules: getAllModules().map(({ slug, name }) => ({ slug, name })),
    },
  });
}
