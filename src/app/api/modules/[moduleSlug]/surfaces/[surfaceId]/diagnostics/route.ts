import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { hasPermission } from '@/lib/auth/permissions';
import { rawDb } from '@/lib/db';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { getSurfaceDefinition } from '@/lib/modules/installed/surfaces';
import { generateId, now } from '@/lib/utils';

const MAX_DIAGNOSTICS_PER_MODULE = 1_000;

interface RouteContext {
  params: Promise<{ moduleSlug: string; surfaceId: string }>;
}

function diagnosticPayload(payload: Record<string, unknown> | null): {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata: Record<string, string | number | boolean | null>;
} | null {
  if (!payload || !['debug', 'info', 'warning', 'error'].includes(String(payload.level))) return null;
  if (typeof payload.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(payload.code)) return null;
  if (typeof payload.message !== 'string' || payload.message.length < 1 || payload.message.length > 500) return null;
  const metadata = payload.metadata === undefined ? {} : payload.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const entries = Object.entries(metadata);
  if (entries.length > 16 || entries.some(([key, value]) => (
    !/^[A-Za-z0-9_.:-]{1,80}$/.test(key)
    || !(value === null || ['string', 'number', 'boolean'].includes(typeof value))
  ))) return null;
  return {
    level: payload.level === 'warning' ? 'warn' : payload.level as 'debug' | 'info' | 'error',
    message: payload.message,
    metadata: { code: payload.code, ...metadata as Record<string, string | number | boolean | null> },
  };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const { moduleSlug, surfaceId } = await context.params;
  const surface = getSurfaceDefinition(moduleSlug, surfaceId);
  if (!surface) return NextResponse.json({ error: 'Surface not found', code: 'SURFACE_NOT_FOUND' }, { status: 404 });
  for (const permission of surface.surface.permissions) {
    if (!await hasPermission(session.user.id, moduleSlug, permission)) {
      return NextResponse.json({ error: 'Forbidden', code: 'SURFACE_ACCESS_DENIED' }, { status: 403 });
    }
  }
  const payload = diagnosticPayload(await readJsonObject(request));
  if (!payload) return NextResponse.json({ error: 'Invalid diagnostic', code: 'VALIDATION_ERROR' }, { status: 400 });
  const metadataJson = JSON.stringify(payload.metadata);
  if (Buffer.byteLength(metadataJson) > 8_192) {
    return NextResponse.json({ error: 'Diagnostic metadata is too large', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  rawDb.transaction(() => {
    rawDb.prepare(`
      INSERT INTO module_diagnostics
        (id, module_id, release_id, level, message, metadata_json, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(generateId(), surface.moduleId, surface.releaseId, payload.level, payload.message, metadataJson, now());
    rawDb.prepare(`
      DELETE FROM module_diagnostics
      WHERE module_id = ? AND id NOT IN (
        SELECT id FROM module_diagnostics
        WHERE module_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
      )
    `).run(surface.moduleId, surface.moduleId, MAX_DIAGNOSTICS_PER_MODULE);
  }).immediate();
  return new NextResponse(null, { status: 204 });
}
