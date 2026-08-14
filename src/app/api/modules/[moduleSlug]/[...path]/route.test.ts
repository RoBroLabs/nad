import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import type { ModuleApiContext, ModuleApiHandler } from '@/lib/modules/registry-types';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceApiAccessLock: vi.fn<(request: Request) => Promise<Response | null>>(async () => null),
  hasPermission: vi.fn(async () => true),
  logAuditEvent: vi.fn(async () => undefined),
  getInstalledModuleConfigGeneration: vi.fn(async () => ({})),
  validateModuleConfig: vi.fn<() => { valid: boolean }>(() => ({ valid: true })),
  notify: vi.fn(async () => undefined),
  handler: vi.fn<ModuleApiHandler>(async () => Response.json({ data: { accepted: true } })),
  endInvocation: vi.fn(),
  getModuleExecutionBlock: vi.fn(),
  getModuleApiEndpoint: vi.fn(),
  pinModuleApiEndpoint: vi.fn(),
}));

vi.mock('@/lib/access', () => ({ enforceApiAccessLock: mocks.enforceApiAccessLock }));
vi.mock('@/lib/auth/config', () => ({ auth: mocks.auth }));
vi.mock('@/lib/auth/permissions', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/db/audit', () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock('@/lib/modules/config', () => ({
  getInstalledModuleConfigGeneration: mocks.getInstalledModuleConfigGeneration,
}));
vi.mock('@/lib/modules/config-validation', () => ({ validateModuleConfig: mocks.validateModuleConfig }));
vi.mock('@/lib/modules/registry', () => ({
  getModuleExecutionBlock: mocks.getModuleExecutionBlock,
  getModuleApiEndpoint: mocks.getModuleApiEndpoint,
  pinModuleApiEndpoint: mocks.pinModuleApiEndpoint,
}));
vi.mock('@/lib/notifications', () => ({ notify: mocks.notify }));

const route = await import('@/app/api/modules/[moduleSlug]/[...path]/route');

const context = {
  params: Promise.resolve({ moduleSlug: 'system-monitor', path: ['restart'] }),
};

function setSession(): void {
  mocks.auth.mockResolvedValue({
    user: { id: 'user-1', role: 'admin', email: 'admin@example.test' },
    expires: '2099-01-01T00:00:00.000Z',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceApiAccessLock.mockResolvedValue(null);
  mocks.hasPermission.mockResolvedValue(true);
  mocks.getModuleExecutionBlock.mockReturnValue(undefined);
  const endpoint = {
    manifest: {
      slug: 'system-monitor',
      name: 'System Monitor',
      permissions: [{ action: 'restart', label: 'Restart', description: 'Restart', risk: 'write' }],
    },
    entrypoint: {
      method: 'POST',
      kind: 'mutation',
      permission: 'restart',
      handler: 'restartHost',
      auditAction: 'restart_host',
      timeoutClass: 'action',
      maxRequestBytes: 1024,
      maxResponseBytes: 4096,
    },
    handler: mocks.handler,
    permission: 'restart',
    moduleId: 'dev.robrolabs.system-monitor',
    releaseId: 'release-pinned',
    releaseDigest: 'a'.repeat(64),
    signerKeyId: 'robrolabs-first-party-2026-08',
    configGenerationId: 'config-pinned',
  };
  mocks.getModuleApiEndpoint.mockReturnValue(endpoint);
  mocks.pinModuleApiEndpoint.mockImplementation(() => ({
    ...endpoint,
    endInvocation: mocks.endInvocation,
  }));
  setSession();
});

describe('generic installed Module proxy route', () => {
  it('returns an access-lock response before authentication or endpoint resolution', async () => {
    const blocked = Response.json(
      { error: 'Use the configured NAD address', code: 'NON_CANONICAL_HOST' },
      { status: 421 },
    );
    mocks.enforceApiAccessLock.mockResolvedValue(blocked);

    const response = await route.GET(new Request('http://foreign.test/api/modules/system-monitor/restart'), context);

    expect(response).toBe(blocked);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.getModuleApiEndpoint).not.toHaveBeenCalled();
    expect(mocks.pinModuleApiEndpoint).not.toHaveBeenCalled();
  });

  it('returns a JSON authentication failure without resolving installed code', async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await route.GET(new Request('http://nad.test/api/modules/system-monitor/restart'), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    expect(mocks.getModuleApiEndpoint).not.toHaveBeenCalled();
    expect(mocks.pinModuleApiEndpoint).not.toHaveBeenCalled();
  });

  it('returns a safe lifecycle conflict when the pinned release cannot accept an invocation', async () => {
    mocks.pinModuleApiEndpoint.mockImplementation(() => {
      throw new ModulePackageError('Plugin is changing release; retry shortly.', 'MODULE_BUSY');
    });

    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin is changing release; retry shortly.',
      code: 'MODULE_BUSY',
    });
    expect(mocks.endInvocation).not.toHaveBeenCalled();
  });

  it('returns a distinct locked response when a release is revoked between resolution and pinning', async () => {
    mocks.pinModuleApiEndpoint.mockImplementation(() => {
      throw new ModulePackageError(
        'Plugin execution is quarantined by verified security metadata.',
        'RELEASE_REVOKED',
      );
    });

    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin execution is quarantined by verified security metadata.',
      code: 'PLUGIN_QUARANTINED',
    });
    expect(mocks.endInvocation).not.toHaveBeenCalled();
  });

  it('returns a distinct locked response for a quarantined Plugin before resolving code', async () => {
    mocks.getModuleExecutionBlock.mockReturnValue('quarantined');

    const response = await route.GET(new Request('http://nad.test/api/modules/system-monitor/restart'), context);

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin execution is quarantined by verified security metadata.',
      code: 'PLUGIN_QUARANTINED',
    });
    expect(mocks.getModuleApiEndpoint).not.toHaveBeenCalled();
    expect(mocks.pinModuleApiEndpoint).not.toHaveBeenCalled();
  });

  it('does not expose disabled, inactive, or unknown endpoints', async () => {
    mocks.getModuleApiEndpoint.mockReturnValue(undefined);

    const response = await route.GET(new Request('http://nad.test/api/modules/system-monitor/missing'), {
      params: Promise.resolve({ moduleSlug: 'system-monitor', path: ['missing'] }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin endpoint not implemented',
      code: 'NOT_FOUND',
    });
    expect(mocks.endInvocation).not.toHaveBeenCalled();
  });

  it('rejects mutation endpoints reached by GET before invoking Module code', async () => {
    const response = await route.GET(new Request('http://nad.test/api/modules/system-monitor/restart'), context);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
    expect(mocks.pinModuleApiEndpoint).not.toHaveBeenCalled();
    expect(mocks.endInvocation).not.toHaveBeenCalled();
  });

  it('enforces the exact signed endpoint method', async () => {
    const response = await route.PUT(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'PUT',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin endpoint requires POST',
      code: 'METHOD_NOT_ALLOWED',
    });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.pinModuleApiEndpoint).not.toHaveBeenCalled();
    expect(mocks.endInvocation).not.toHaveBeenCalled();
  });

  it('rejects cross-origin mutation requests before audit attempt or handler execution', async () => {
    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      body: '{}',
    }), context);

    expect(response.status).toBe(403);
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
    expect(mocks.endInvocation).toHaveBeenCalledOnce();
  });

  it('enforces the endpoint permission before reading config or invoking code', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
    expect(mocks.hasPermission).toHaveBeenCalledWith('user-1', 'system-monitor', 'restart');
    expect(mocks.getInstalledModuleConfigGeneration).not.toHaveBeenCalled();
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.endInvocation).toHaveBeenCalledOnce();
  });

  it('uses the pinned config generation and refuses an invalid configuration', async () => {
    mocks.validateModuleConfig.mockReturnValue({ valid: false });

    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin is not configured',
      code: 'NOT_CONFIGURED',
    });
    expect(mocks.getInstalledModuleConfigGeneration).toHaveBeenCalledWith('system-monitor', 'config-pinned');
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.endInvocation).toHaveBeenCalledOnce();
  });

  it('audits mutation attempt and outcome around a permitted same-origin handler', async () => {
    mocks.getInstalledModuleConfigGeneration.mockResolvedValue({ hosts: 'lab|192.0.2.10' });
    mocks.handler.mockImplementationOnce(async (_request: Request, handlerContext: ModuleApiContext) => {
      await handlerContext.notify('Restart complete', 'The host restarted.', 'info');
      return Response.json({ data: { accepted: true } });
    });
    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.hasPermission).toHaveBeenCalledWith('user-1', 'system-monitor', 'restart');
    expect(mocks.getModuleApiEndpoint).toHaveBeenCalledOnce();
    expect(mocks.pinModuleApiEndpoint).toHaveBeenCalledOnce();
    expect(mocks.getInstalledModuleConfigGeneration).toHaveBeenCalledWith('system-monitor', 'config-pinned');
    expect(mocks.handler).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({
      config: { hosts: 'lab|192.0.2.10' },
      moduleSlug: 'system-monitor',
      path: ['restart'],
      userId: 'user-1',
      notify: expect.any(Function),
    }));
    expect(mocks.notify).toHaveBeenCalledWith(
      'Restart complete',
      'The host restarted.',
      'info',
      'system-monitor',
    );
    expect(mocks.logAuditEvent).toHaveBeenNthCalledWith(1, 'user-1', 'restart_host', 'system-monitor', {
      phase: 'attempt',
      endpoint: 'restart',
      method: 'POST',
    });
    expect(mocks.logAuditEvent).toHaveBeenNthCalledWith(2, 'user-1', 'restart_host', 'system-monitor', {
      phase: 'succeeded',
      endpoint: 'restart',
      method: 'POST',
      status: 200,
    });
    expect(mocks.endInvocation).toHaveBeenCalledOnce();
  });

  it('passes through a bounded runtime/schema failure and audits the failed outcome', async () => {
    mocks.handler.mockResolvedValueOnce(Response.json(
      { error: 'Plugin response did not match its schema.', code: 'MODULE_EXECUTION_FAILED' },
      { status: 502 },
    ));

    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin response did not match its schema.',
      code: 'MODULE_EXECUTION_FAILED',
    });
    expect(mocks.logAuditEvent).toHaveBeenLastCalledWith(
      'user-1',
      'restart_host',
      'system-monitor',
      { phase: 'failed', endpoint: 'restart', method: 'POST', status: 502 },
    );
    expect(mocks.endInvocation).toHaveBeenCalledOnce();
  });

  it('turns a runtime crash into a safe JSON error and releases the pinned invocation', async () => {
    mocks.handler.mockRejectedValueOnce(new Error('secret upstream credential'));

    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin request failed',
      code: 'INTERNAL_ERROR',
    });
    expect(mocks.logAuditEvent).toHaveBeenLastCalledWith(
      'user-1',
      'restart_host',
      'system-monitor',
      { phase: 'failed', endpoint: 'restart', method: 'POST', status: 500 },
    );
    expect(mocks.endInvocation).toHaveBeenCalledOnce();
  });

  it('returns a safe JSON error when pinned configuration loading fails', async () => {
    mocks.getInstalledModuleConfigGeneration.mockRejectedValueOnce(new Error('database failure'));

    const response = await route.POST(new Request('http://nad.test/api/modules/system-monitor/restart', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: '{}',
    }), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Plugin request failed',
      code: 'INTERNAL_ERROR',
    });
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.endInvocation).toHaveBeenCalledOnce();
  });
});
