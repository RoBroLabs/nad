import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceApiAccessLock: vi.fn(async () => null),
  getInstalledModule: vi.fn(),
  getModuleConfig: vi.fn(async () => ({ hosts: 'router|192.0.2.10' })),
  getModuleConfigForDisplay: vi.fn(async () => ({ hosts: { value: 'router|192.0.2.10', masked: false, isSecret: false } })),
  setModuleConfig: vi.fn(async () => undefined),
  clearModuleConfig: vi.fn(async () => undefined),
  validateModuleConfig: vi.fn(() => ({ valid: true })),
  logAuditEvent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/access', () => ({ enforceApiAccessLock: mocks.enforceApiAccessLock }));
vi.mock('@/lib/auth/config', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/audit', () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock('@/lib/modules/installed/provider', () => ({ getInstalledModule: mocks.getInstalledModule }));
vi.mock('@/lib/modules/config', () => ({
  clearModuleConfig: mocks.clearModuleConfig,
  getModuleConfig: mocks.getModuleConfig,
  getModuleConfigForDisplay: mocks.getModuleConfigForDisplay,
  setModuleConfig: mocks.setModuleConfig,
}));
vi.mock('@/lib/modules/config-validation', () => ({ validateModuleConfig: mocks.validateModuleConfig }));

const route = await import('@/app/api/settings/modules/[slug]/config/route');

const context = { params: Promise.resolve({ slug: 'system-monitor' }) };
const jsonHeaders = { 'content-type': 'application/json', origin: 'http://nad.test' };

function setAdmin(): void {
  mocks.auth.mockResolvedValue({
    user: { id: 'admin-1', role: 'admin', email: 'admin@example.test' },
    expires: '2099-01-01T00:00:00.000Z',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceApiAccessLock.mockResolvedValue(null);
  mocks.getModuleConfig.mockResolvedValue({ hosts: 'router|192.0.2.10' });
  mocks.getModuleConfigForDisplay.mockResolvedValue({ hosts: { value: 'router|192.0.2.10', masked: false, isSecret: false } });
  mocks.setModuleConfig.mockResolvedValue(undefined);
  mocks.clearModuleConfig.mockResolvedValue(undefined);
  mocks.validateModuleConfig.mockReturnValue({ valid: true });
  mocks.getInstalledModule.mockReturnValue({
    releaseId: 'release-1',
    configGenerationId: 'config-1',
    manifest: {
      slug: 'system-monitor',
      configSchema: [
        { key: 'hosts', label: 'Hosts', type: 'text', required: true },
      ],
    },
  });
  setAdmin();
});

describe('Module configuration route concurrency handling', () => {
  it('binds saves to the release and configuration generation that were validated', async () => {
    const response = await route.POST(new Request('http://nad.test/api/settings/modules/system-monitor/config', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ values: { hosts: 'router|192.0.2.11' } }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.setModuleConfig).toHaveBeenCalledWith(
      'system-monitor',
      { hosts: { value: 'router|192.0.2.11', isSecret: false } },
      'admin-1',
      { expectedReleaseId: 'release-1', expectedConfigGenerationId: 'config-1' },
    );
  });

  it('maps stale config saves to a retryable conflict', async () => {
    mocks.setModuleConfig.mockRejectedValueOnce(
      new ModulePackageError('Module release changed while saving configuration. Refresh and retry.', 'CONCURRENT_MODIFICATION'),
    );

    const response = await route.POST(new Request('http://nad.test/api/settings/modules/system-monitor/config', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ values: { hosts: 'router|192.0.2.11' } }),
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
    expect(mocks.logAuditEvent).not.toHaveBeenCalledWith(
      'admin-1',
      'update_module_config',
      'system-monitor',
      expect.anything(),
    );
  });

  it('maps stale config clears to a retryable conflict', async () => {
    mocks.clearModuleConfig.mockRejectedValueOnce(
      new ModulePackageError('Module configuration changed while saving. Refresh and retry.', 'CONCURRENT_MODIFICATION'),
    );

    const response = await route.DELETE(new Request('http://nad.test/api/settings/modules/system-monitor/config', {
      method: 'DELETE',
      headers: jsonHeaders,
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
    expect(mocks.clearModuleConfig).toHaveBeenCalledWith(
      'system-monitor',
      'admin-1',
      { expectedReleaseId: 'release-1', expectedConfigGenerationId: 'config-1' },
    );
  });
});
