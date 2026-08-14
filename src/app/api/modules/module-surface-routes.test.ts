import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enforceApiAccessLock: vi.fn(),
  auth: vi.fn(),
  hasPermission: vi.fn(),
  isSameOriginMutationRequest: vi.fn(),
  readJsonObject: vi.fn(),
  invokeSurfaceBinding: vi.fn(),
  getSurfaceDefinition: vi.fn(),
  prepare: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/access', () => ({ enforceApiAccessLock: mocks.enforceApiAccessLock }));
vi.mock('@/lib/auth/config', () => ({ auth: mocks.auth }));
vi.mock('@/lib/auth/permissions', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/http', () => ({
  isSameOriginMutationRequest: mocks.isSameOriginMutationRequest,
  readJsonObject: mocks.readJsonObject,
}));
vi.mock('@/lib/modules/installed/app-operations', () => ({ invokeSurfaceBinding: mocks.invokeSurfaceBinding }));
vi.mock('@/lib/modules/installed/surfaces', () => ({ getSurfaceDefinition: mocks.getSurfaceDefinition }));
vi.mock('@/lib/db', () => ({ rawDb: { prepare: mocks.prepare, transaction: mocks.transaction } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceApiAccessLock.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({ user: { id: 'member', role: 'member' } });
  mocks.hasPermission.mockResolvedValue(true);
  mocks.isSameOriginMutationRequest.mockReturnValue(true);
  mocks.transaction.mockImplementation((callback: () => void) => ({ immediate: callback }));
  mocks.prepare.mockReturnValue({ run: vi.fn() });
});

describe('surface bridge routes', () => {
  it('passes only the authenticated user, declared route identity, bindings, and input to the broker', async () => {
    mocks.readJsonObject.mockResolvedValue({
      input: { filter: 'online' },
      connectionBindings: { primary: 'connection-profile-1' },
    });
    mocks.invokeSurfaceBinding.mockResolvedValue({ data: { status: 'ok' }, correlationId: 'correlation-1' });
    const route = await import('@/app/api/modules/[moduleSlug]/surfaces/[surfaceId]/bindings/[bindingId]/route');
    const response = await route.POST(
      new Request('https://nad.test/api/modules/app/surfaces/summary/bindings/summary', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://nad.test' }, body: '{}',
      }),
      { params: Promise.resolve({ moduleSlug: 'app', surfaceId: 'summary', bindingId: 'summary' }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { status: 'ok' }, correlationId: 'correlation-1' });
    expect(mocks.invokeSurfaceBinding).toHaveBeenCalledWith({
      moduleSlug: 'app', surfaceId: 'summary', bindingId: 'summary', userId: 'member',
      input: { filter: 'online' }, connectionBindings: { primary: 'connection-profile-1' },
    });
  });

  it('authorizes and bounds surface diagnostics before persisting them against the exact release', async () => {
    mocks.readJsonObject.mockResolvedValue({
      level: 'warning', code: 'UPSTREAM_SLOW', message: 'The upstream was slow.', metadata: { ms: 14 },
    });
    mocks.getSurfaceDefinition.mockReturnValue({
      moduleId: 'dev.robrolabs.app', moduleSlug: 'app', releaseId: 'release-1', digest: 'a'.repeat(64),
      artifactPath: '/artifact', packageKind: 'app',
      surface: { permissions: ['view'] },
    });
    const route = await import('@/app/api/modules/[moduleSlug]/surfaces/[surfaceId]/diagnostics/route');
    const response = await route.POST(
      new Request('https://nad.test/api/modules/app/surfaces/summary/diagnostics', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://nad.test' }, body: '{}',
      }),
      { params: Promise.resolve({ moduleSlug: 'app', surfaceId: 'summary' }) },
    );
    expect(response.status).toBe(204);
    expect(mocks.hasPermission).toHaveBeenCalledWith('member', 'app', 'view');
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('fails closed on CSRF and removed surface permission', async () => {
    const bindingRoute = await import('@/app/api/modules/[moduleSlug]/surfaces/[surfaceId]/bindings/[bindingId]/route');
    mocks.isSameOriginMutationRequest.mockReturnValue(false);
    expect((await bindingRoute.POST(
      new Request('https://nad.test/api/modules/app/surfaces/summary/bindings/summary', { method: 'POST' }),
      { params: Promise.resolve({ moduleSlug: 'app', surfaceId: 'summary', bindingId: 'summary' }) },
    )).status).toBe(403);

    mocks.isSameOriginMutationRequest.mockReturnValue(true);
    mocks.readJsonObject.mockResolvedValue({ level: 'info', code: 'TEST', message: 'test' });
    mocks.getSurfaceDefinition.mockReturnValue({
      moduleId: 'dev.robrolabs.app', moduleSlug: 'app', releaseId: 'release-1', surface: { permissions: ['view'] },
    });
    mocks.hasPermission.mockResolvedValue(false);
    const diagnosticsRoute = await import('@/app/api/modules/[moduleSlug]/surfaces/[surfaceId]/diagnostics/route');
    expect((await diagnosticsRoute.POST(
      new Request('https://nad.test/api/modules/app/surfaces/summary/diagnostics', { method: 'POST' }),
      { params: Promise.resolve({ moduleSlug: 'app', surfaceId: 'summary' }) },
    )).status).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
