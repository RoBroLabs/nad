import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import {
  clearModuleConfig,
  getModuleConfig,
  getModuleConfigForDisplay,
  setModuleConfig,
} from '@/lib/modules/config';
import { getInstalledModule } from '@/lib/modules/installed/provider';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { validateModuleConfig } from '@/lib/modules/config-validation';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';

interface RouteContext {
  params: Promise<{ slug: string }>;
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

const configConflictCodes = new Set([
  'CONCURRENT_MODIFICATION',
  'MODULE_BUSY',
  'MODULE_LOCK_LOST',
]);

function configErrorStatus(code: string): number {
  if (configConflictCodes.has(code)) return 409;
  if (code === 'MODULE_NOT_INSTALLED') return 404;
  return 500;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  const accessError = adminError(session);
  if (accessError) return accessError;
  const { slug } = await context.params;
  if (!getInstalledModule(slug)) return NextResponse.json({ error: 'Module not found', code: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ data: await getModuleConfigForDisplay(slug) });
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  const accessError = adminError(session);
  if (accessError) return accessError;
  if (!session) throw new Error('Admin session missing after access check.');
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const { slug } = await context.params;
  const installed = getInstalledModule(slug);
  if (!installed) return NextResponse.json({ error: 'Module not found', code: 'NOT_FOUND' }, { status: 404 });
  const manifest = installed.manifest;

  const payload = await readJsonObject(request);
  if (!payload?.values || typeof payload.values !== 'object' || Array.isArray(payload.values)) {
    return NextResponse.json({ error: 'Invalid configuration values', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const submitted = payload.values as Record<string, unknown>;
  const existing = await getModuleConfig(slug);
  const valuesToSave: Record<string, { value: string; isSecret?: boolean }> = {};
  const effectiveConfig: Record<string, string> = { ...existing };

  for (const field of manifest.configSchema) {
    const submittedValue = submitted[field.key];
    if (
      submittedValue !== undefined
      && typeof submittedValue !== 'string'
      && typeof submittedValue !== 'number'
      && typeof submittedValue !== 'boolean'
    ) {
      return NextResponse.json({ error: `${field.label} has an invalid value.`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const value = submittedValue === undefined ? existing[field.key] : String(submittedValue).trim();

    if (value && value.length > 16_384) {
      return NextResponse.json({ error: `${field.label} is too long.`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (field.required && !value) {
      return NextResponse.json({ error: `${field.label} is required.`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (value && field.type === 'url') {
      try {
        const url = new URL(value);
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
          throw new Error('Unsupported URL');
        }
      } catch {
        return NextResponse.json({ error: `${field.label} must be an HTTP(S) URL without embedded credentials.`, code: 'VALIDATION_ERROR' }, { status: 400 });
      }
    }
    if (value && field.type === 'number') {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || (field.min !== undefined && numericValue < field.min) || (field.max !== undefined && numericValue > field.max)) {
        return NextResponse.json({ error: `${field.label} is outside the allowed range.`, code: 'VALIDATION_ERROR' }, { status: 400 });
      }
    }
    if (value && field.type === 'boolean' && value !== 'true' && value !== 'false') {
      return NextResponse.json({ error: `${field.label} must be enabled or disabled.`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (value && field.type === 'select' && !field.options?.some(({ value: option }) => option === value)) {
      return NextResponse.json({ error: `${field.label} is not a supported option.`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (submittedValue !== undefined) {
      valuesToSave[field.key] = { value, isSecret: field.type === 'secret' };
      effectiveConfig[field.key] = value;
    }
  }

  const semanticValidation = validateModuleConfig(manifest, effectiveConfig);
  if (!semanticValidation.valid) {
    return NextResponse.json(
      { error: semanticValidation.error ?? 'The module configuration is invalid.', code: 'INVALID_CONFIG' },
      { status: 400 },
    );
  }

  try {
    await setModuleConfig(slug, valuesToSave, session.user.id, {
      expectedReleaseId: installed.releaseId,
      expectedConfigGenerationId: installed.configGenerationId,
    });
  } catch (error) {
    if (error instanceof ModulePackageError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: configErrorStatus(error.code) });
    }
    console.error('Failed to save module config', {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json({ error: 'Configuration could not be saved.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
  await logAuditEvent(session.user.id, 'update_module_config', slug, { keys: Object.keys(valuesToSave) });
  return NextResponse.json({ data: await getModuleConfigForDisplay(slug) });
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  const accessError = adminError(session);
  if (accessError) return accessError;
  if (!session) throw new Error('Admin session missing after access check.');
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const { slug } = await context.params;
  const installed = getInstalledModule(slug);
  if (!installed) return NextResponse.json({ error: 'Module not found', code: 'NOT_FOUND' }, { status: 404 });
  try {
    await clearModuleConfig(slug, session.user.id, {
      expectedReleaseId: installed.releaseId,
      expectedConfigGenerationId: installed.configGenerationId,
    });
  } catch (error) {
    if (error instanceof ModulePackageError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: configErrorStatus(error.code) });
    }
    console.error('Failed to clear module config', {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json({ error: 'Configuration could not be cleared.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
  await logAuditEvent(session.user.id, 'clear_module_config', slug);
  return NextResponse.json({ data: { cleared: true } });
}
