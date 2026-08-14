import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { hasPermission } from '@/lib/auth/permissions';
import { logAuditEvent } from '@/lib/db/audit';
import { isSameOriginMutationRequest } from '@/lib/http';
import { getInstalledModuleConfigGeneration } from '@/lib/modules/config';
import {
  listConnectionProfilesForUser,
  readConnectionProfileForInvocation,
} from '@/lib/modules/connections';
import { validateModuleConfig } from '@/lib/modules/config-validation';
import { getModuleApiEndpoint, getModuleExecutionBlock, pinModuleApiEndpoint } from '@/lib/modules/registry';
import type { PinnedModuleApiEndpoint } from '@/lib/modules/registry';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { notify } from '@/lib/notifications';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ moduleSlug: string; path: string[] }>;
}

async function proxyRequest(request: Request, context: RouteContext): Promise<Response> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { moduleSlug, path } = await context.params;
  if (getModuleExecutionBlock(moduleSlug) === 'quarantined') {
    return NextResponse.json({
      error: 'Plugin execution is quarantined by verified security metadata.',
      code: 'PLUGIN_QUARANTINED',
    }, { status: 423 });
  }
  const endpoint = getModuleApiEndpoint(moduleSlug, path);
  if (!endpoint) {
    return NextResponse.json({ error: 'Plugin endpoint not implemented', code: 'NOT_FOUND' }, { status: 404 });
  }

  if (request.method !== endpoint.entrypoint.method) {
    return NextResponse.json(
      { error: `Plugin endpoint requires ${endpoint.entrypoint.method}`, code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { Allow: endpoint.entrypoint.method } },
    );
  }

  let pinnedEndpoint: PinnedModuleApiEndpoint;
  try {
    pinnedEndpoint = pinModuleApiEndpoint(endpoint);
  } catch (error) {
    if (error instanceof ModulePackageError) {
      const quarantined = error.code === 'RELEASE_REVOKED';
      return NextResponse.json({
        error: error.message,
        code: quarantined ? 'PLUGIN_QUARANTINED' : error.code,
      }, { status: quarantined ? 423 : 409 });
    }
    throw error;
  }

  const { manifest, handler, entrypoint, permission, configGenerationId, endInvocation } = pinnedEndpoint;
  try {
    if (entrypoint.kind === 'mutation') {
      if (!isSameOriginMutationRequest(request)) {
        return NextResponse.json({ error: 'Cross-origin Module mutation refused', code: 'CSRF_REFUSED' }, { status: 403 });
      }
    }

    const requestedAction = permission
      || (request.method === 'GET'
        ? 'view'
        : manifest.permissions.some(({ action }) => action === path[0])
          ? path[0]
          : 'execute');
    if (!(await hasPermission(session.user.id, moduleSlug, requestedAction))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    const requestedProfileId = request.headers.get('x-nad-connection-profile')?.trim() || undefined;
    let connectionProfileId: string | undefined;
    let connectionGenerationId: string | undefined;
    let config: Record<string, string>;
    if (pinnedEndpoint.packageSchemaVersion >= 2 && pinnedEndpoint.packageKind === 'app') {
      const profileId = requestedProfileId
        ?? (await listConnectionProfilesForUser(pinnedEndpoint.moduleId, session.user.id))
          .find(({ isDefault }) => isDefault)?.id;
      if (!profileId) {
        return NextResponse.json({ error: 'No accessible App connection is configured', code: 'CONNECTION_REQUIRED' }, { status: 503 });
      }
      try {
        const profile = await readConnectionProfileForInvocation(
          profileId,
          pinnedEndpoint.moduleId,
          session.user.id,
          requestedAction,
        );
        config = { ...profile.values };
        connectionProfileId = profile.id;
        connectionGenerationId = profile.generationId;
      } catch (error) {
        if (error instanceof ModulePackageError) {
          return NextResponse.json({ error: 'Connection profile access is unavailable', code: 'CONNECTION_ACCESS_DENIED' }, { status: 403 });
        }
        throw error;
      }
    } else {
      if (requestedProfileId) {
        return NextResponse.json({
          error: 'This package does not accept a connection profile.',
          code: 'CONNECTION_NOT_SUPPORTED',
        }, { status: 400 });
      }
      config = await getInstalledModuleConfigGeneration(moduleSlug, configGenerationId);
    }
    if (!validateModuleConfig(manifest, config).valid) {
      return NextResponse.json({ error: 'Plugin is not configured', code: 'NOT_CONFIGURED' }, { status: 503 });
    }

    const auditAction = entrypoint.kind === 'mutation' ? entrypoint.auditAction : undefined;
    if (auditAction) {
      await logAuditEvent(session.user.id, auditAction, moduleSlug, {
        phase: 'attempt',
        endpoint: path.join('/'),
        method: request.method,
      });
    }

    try {
      const response = await handler(request, {
        config,
        moduleSlug,
        path,
        userId: session.user.id,
        connectionProfileId,
        connectionGenerationId,
        notify: (title, message, severity) => notify(title, message, severity, moduleSlug),
      });
      if (auditAction) {
        try {
          await logAuditEvent(session.user.id, auditAction, moduleSlug, {
            phase: response.ok ? 'succeeded' : 'failed',
            endpoint: path.join('/'),
            method: request.method,
            status: response.status,
          });
        } catch (auditError) {
          console.error('Module mutation outcome audit failed', { moduleSlug, path, auditError });
        }
      }
      return response;
    } catch (error) {
      if (auditAction) {
        try {
          await logAuditEvent(session.user.id, auditAction, moduleSlug, {
            phase: 'failed',
            endpoint: path.join('/'),
            method: request.method,
            status: 500,
          });
        } catch (auditError) {
          console.error('Module mutation failure audit failed', { moduleSlug, path, auditError });
        }
      }
      console.error('Module API handler failed', {
        moduleSlug,
        path,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return NextResponse.json({ error: 'Plugin request failed', code: 'INTERNAL_ERROR' }, { status: 500 });
    }
  } catch (error) {
    console.error('Module API proxy failed', {
      moduleSlug,
      path,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json({ error: 'Plugin request failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    endInvocation();
  }
}

export function GET(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}

export function PUT(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}
