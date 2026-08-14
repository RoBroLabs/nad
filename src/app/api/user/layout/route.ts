import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { db } from '@/lib/db';
import { widgetLayouts } from '@/lib/db/schema';
import { generateId, now, safeJsonParse } from '@/lib/utils';
import type { DashboardLayoutState } from '@/components/dashboard/types';
import { readJsonObject } from '@/lib/http';

const emptyLayout: DashboardLayoutState = { widgets: [], layouts: {} };

function isLayoutState(value: unknown): value is DashboardLayoutState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<DashboardLayoutState>;
  const widgetIds = new Set<string>();
  const validWidgets = Array.isArray(candidate.widgets)
    && candidate.widgets.length <= 100
    && candidate.widgets.every((widget) => Boolean(widget)
      && typeof widget === 'object'
      && typeof widget.instanceId === 'string'
      && widget.instanceId.length > 0
      && widget.instanceId.length <= 128
      && !widgetIds.has(widget.instanceId)
      && Boolean(widgetIds.add(widget.instanceId))
      && typeof widget.moduleSlug === 'string'
      && /^[a-z0-9][a-z0-9-]{0,63}$/.test(widget.moduleSlug)
      && typeof widget.widgetId === 'string'
      && /^[a-z0-9][a-z0-9-]{0,63}$/.test(widget.widgetId));
  const validLayouts = Boolean(candidate.layouts)
    && typeof candidate.layouts === 'object'
    && !Array.isArray(candidate.layouts)
    && Object.values(candidate.layouts).every((layout) => Array.isArray(layout)
      && layout.length <= 100
      && layout.every((item) => Boolean(item)
        && typeof item.i === 'string'
        && widgetIds.has(item.i)
        && [item.x, item.y, item.w, item.h].every(Number.isInteger)
        && item.x >= 0
        && item.y >= 0
        && item.w >= 1
        && item.w <= 12
        && item.h >= 1
        && item.h <= 100));
  return validWidgets && validLayouts;
}

export async function GET(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const record = await db
    .select()
    .from(widgetLayouts)
    .where(and(eq(widgetLayouts.userId, session.user.id), eq(widgetLayouts.pageSlug, 'home')))
    .get();
  const parsed = record ? safeJsonParse<DashboardLayoutState>(record.layoutJson) : undefined;
  return NextResponse.json({ data: parsed && isLayoutState(parsed) ? parsed : emptyLayout });
}

export async function POST(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const payload = await readJsonObject(request);
  if (!isLayoutState(payload)) {
    return NextResponse.json({ error: 'Invalid layout', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const value = { layoutJson: JSON.stringify(payload), updatedAt: now() };

  await db
    .insert(widgetLayouts)
    .values({
      id: generateId(),
      userId: session.user.id,
      pageSlug: 'home',
      ...value,
    })
    .onConflictDoUpdate({
      target: [widgetLayouts.userId, widgetLayouts.pageSlug],
      set: value,
    })
    .run();

  return NextResponse.json({ data: payload });
}
