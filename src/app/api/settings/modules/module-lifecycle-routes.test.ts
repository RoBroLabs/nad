import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceApiAccessLock: vi.fn(async () => null),
  getModule: vi.fn(() => ({ slug: 'system-monitor' })),
  logAuditEvent: vi.fn(async () => undefined),
  rollbackModuleRelease: vi.fn(),
  setInstalledModuleEnabled: vi.fn(),
  uninstallModule: vi.fn(),
}));

vi.mock('@/lib/access', () => ({ enforceApiAccessLock: mocks.enforceApiAccessLock }));
vi.mock('@/lib/auth/config', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/audit', () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock('@/lib/modules/registry', () => ({ getModule: mocks.getModule }));
vi.mock('@/lib/modules/installed/lifecycle', () => ({
  rollbackModuleRelease: mocks.rollbackModuleRelease,
  setInstalledModuleEnabled: mocks.setInstalledModuleEnabled,
  uninstallModule: mocks.uninstallModule,
}));

const moduleRoute = await import('@/app/api/settings/modules/[slug]/route');
const rollbackRoute = await import('@/app/api/settings/modules/[slug]/rollback/route');
const context = { params: Promise.resolve({ slug: 'system-monitor' }) };
const jsonHeaders = { 'content-type': 'application/json', origin: 'http://nad.test' };

function adminSession(): void {
  mocks.auth.mockResolvedValue({
    user: { id: 'admin-1', role: 'admin', email: 'admin@example.test' },
    expires: '2099-01-01T00:00:00.000Z',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceApiAccessLock.mockResolvedValue(null);
  mocks.getModule.mockReturnValue({ slug: 'system-monitor' });
  mocks.setInstalledModuleEnabled.mockResolvedValue({
    moduleId: 'dev.robrolabs.system-monitor',
    slug: 'system-monitor',
    enabled: false,
    operationId: 'operation-disable',
    changed: true,
  });
  mocks.rollbackModuleRelease.mockResolvedValue({
    moduleId: 'dev.robrolabs.system-monitor',
    slug: 'system-monitor',
    version: '1.0.1',
    digest: 'a'.repeat(64),
    releaseId: 'release-1',
    operationId: 'operation-rollback',
    enabled: true,
    replacedReleaseId: 'release-2',
  });
  mocks.uninstallModule.mockResolvedValue({
    moduleId: 'dev.robrolabs.system-monitor',
    slug: 'system-monitor',
    operationId: 'operation-uninstall',
    configAndStorage: 'retain',
    artifacts: 'retain',
    prunedArtifacts: 0,
    retainedArtifacts: 2,
  });
  adminSession();
});

describe('Module lifecycle administrator routes', () => {
  it('disables through the lifecycle service and records the operation ID', async () => {
    const response = await moduleRoute.PATCH(new Request('http://nad.test/api/settings/modules/system-monitor', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ enabled: false }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.setInstalledModuleEnabled).toHaveBeenCalledWith('system-monitor', false, 'admin-1');
    expect(mocks.logAuditEvent).toHaveBeenCalledWith('admin-1', 'disable_module', 'system-monitor', {
      operationId: 'operation-disable',
      changed: true,
    });
  });

  it('requires both uninstall retention choices before touching lifecycle state', async () => {
    const response = await moduleRoute.DELETE(new Request('http://nad.test/api/settings/modules/system-monitor', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ configAndStorage: 'retain' }),
    }), context);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.uninstallModule).not.toHaveBeenCalled();
  });

  it('passes explicit retain choices to uninstall and audits the result', async () => {
    const response = await moduleRoute.DELETE(new Request('http://nad.test/api/settings/modules/system-monitor', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ configAndStorage: 'retain', artifacts: 'retain' }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.uninstallModule).toHaveBeenCalledWith('system-monitor', 'admin-1', {
      configAndStorage: 'retain',
      artifacts: 'retain',
    });
    expect(mocks.logAuditEvent).toHaveBeenCalledWith('admin-1', 'uninstall_module', 'system-monitor', expect.objectContaining({
      operationId: 'operation-uninstall',
      retainedArtifacts: 2,
    }));
  });

  it('rolls back only to an explicit retained release and audits both release IDs', async () => {
    const response = await rollbackRoute.POST(new Request('http://nad.test/api/settings/modules/system-monitor/rollback', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ releaseId: 'release-1' }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.rollbackModuleRelease).toHaveBeenCalledWith('system-monitor', 'admin-1', {
      targetReleaseId: 'release-1',
    });
    expect(mocks.logAuditEvent).toHaveBeenCalledWith('admin-1', 'rollback_module', 'system-monitor', {
      operationId: 'operation-rollback',
      fromReleaseId: 'release-2',
      toReleaseId: 'release-1',
      version: '1.0.1',
      digest: 'a'.repeat(64),
    });
  });

  it('returns a conflict and failure audit when a lifecycle lock is busy', async () => {
    mocks.setInstalledModuleEnabled.mockRejectedValue(
      new ModulePackageError('Another lifecycle operation is running.', 'MODULE_BUSY'),
    );
    const response = await moduleRoute.PATCH(new Request('http://nad.test/api/settings/modules/system-monitor', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ enabled: false }),
    }), context);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'MODULE_BUSY' });
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      'admin-1',
      'disable_module_failed',
      'system-monitor',
      { code: 'MODULE_BUSY' },
    );
  });

  it('rejects cross-origin lifecycle mutations before reading or changing state', async () => {
    const response = await moduleRoute.PATCH(new Request('http://nad.test/api/settings/modules/system-monitor', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ enabled: false }),
    }), context);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'CROSS_ORIGIN_REQUEST' });
    expect(mocks.setInstalledModuleEnabled).not.toHaveBeenCalled();
  });

  it('audits rollback failures with the safe lifecycle error code', async () => {
    mocks.rollbackModuleRelease.mockRejectedValue(
      new ModulePackageError('Retained release is busy.', 'MODULE_RELEASE_IN_FLIGHT'),
    );
    const response = await rollbackRoute.POST(new Request('http://nad.test/api/settings/modules/system-monitor/rollback', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ releaseId: 'release-1' }),
    }), context);

    expect(response.status).toBe(409);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      'admin-1',
      'rollback_module_failed',
      'system-monitor',
      { code: 'MODULE_RELEASE_IN_FLIGHT' },
    );
  });
});
