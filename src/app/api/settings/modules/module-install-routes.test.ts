import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceApiAccessLock: vi.fn(async () => null),
  logAuditEvent: vi.fn(async () => undefined),
  verifyModulePackage: vi.fn(async () => ({
    digest: 'a'.repeat(64),
    signerKeyId: 'first-party-test',
    manifest: { id: 'dev.robrolabs.system-monitor', slug: 'system-monitor', version: '1.0.0' },
  })),
  createModuleInstallReview: vi.fn(() => ({
    slug: 'system-monitor',
    name: 'System Monitor',
    version: '1.0.0',
    digest: 'a'.repeat(64),
  })),
  installModulePackage: vi.fn(async () => ({
    moduleId: 'dev.robrolabs.system-monitor',
    slug: 'system-monitor',
    version: '1.0.0',
    operationId: 'operation-1',
    releaseId: 'release-1',
    digest: 'a'.repeat(64),
    enabled: false,
    signatureStatus: 'verified',
  })),
  downloadMarketplaceModule: vi.fn(async () => Buffer.from('package')),
  fetchMarketplaceCatalog: vi.fn(),
  getMarketplaceBaseUrl: vi.fn(() => new URL('https://market.example/')),
  getMarketplaceMode: vi.fn(() => 'online'),
  refreshAndEnforceMarketplaceSecurity: vi.fn(async () => ({
    mode: 'online', available: true, freshness: 'current', recommendations: [{
      moduleId: 'dev.robrolabs.system-monitor',
      moduleSlug: 'system-monitor',
      version: '1.0.0',
      artifactSha256: 'a'.repeat(64),
      signerKeyId: 'first-party-test',
    }], installedFindings: [],
  })),
}));

vi.mock('@/lib/auth/config', () => ({ auth: mocks.auth }));
vi.mock('@/lib/access', () => ({ enforceApiAccessLock: mocks.enforceApiAccessLock }));
vi.mock('@/lib/db/audit', () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock('@/lib/modules/installed/package-verifier', () => ({
  MODULE_ARCHIVE_LIMITS: { compressedBytes: 10 * 1024 * 1024 },
  verifyModulePackage: mocks.verifyModulePackage,
}));
vi.mock('@/lib/modules/installed/install-review', () => ({ createModuleInstallReview: mocks.createModuleInstallReview }));
vi.mock('@/lib/modules/installed/lifecycle', () => ({ installModulePackage: mocks.installModulePackage }));
vi.mock('@/lib/marketplace/client', () => ({
  downloadMarketplaceModule: mocks.downloadMarketplaceModule,
  fetchMarketplaceCatalog: mocks.fetchMarketplaceCatalog,
  getMarketplaceBaseUrl: mocks.getMarketplaceBaseUrl,
  getMarketplaceMode: mocks.getMarketplaceMode,
}));
vi.mock('@/lib/marketplace/security-enforcement', () => ({
  refreshAndEnforceMarketplaceSecurity: mocks.refreshAndEnforceMarketplaceSecurity,
}));

const uploadRoute = await import('@/app/api/settings/modules/install/route');
const marketplaceRoute = await import('@/app/api/settings/modules/marketplace/route');

function setAdmin(): void {
  mocks.auth.mockResolvedValue({
    user: { id: 'admin', role: 'admin', email: 'admin@example.test' },
    expires: '2099-01-01T00:00:00.000Z',
  });
}

function uploadRequest(confirm = false): Request {
  const form = new FormData();
  form.set('module', new File([Buffer.from('package')], 'system-monitor.nadmod', { type: 'application/zip' }));
  if (confirm) {
    form.set('confirm', 'true');
    form.set('expectedDigest', 'a'.repeat(64));
  }
  return new Request('http://nad.test/api/settings/modules/install', {
    method: 'POST',
    headers: { origin: 'http://nad.test' },
    body: form,
  });
}

const jsonHeaders = { 'content-type': 'application/json', origin: 'http://nad.test' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceApiAccessLock.mockResolvedValue(null);
  mocks.getMarketplaceMode.mockReturnValue('online');
  mocks.getMarketplaceBaseUrl.mockReturnValue(new URL('https://market.example/'));
  mocks.downloadMarketplaceModule.mockResolvedValue(Buffer.from('package'));
  mocks.verifyModulePackage.mockResolvedValue({
    digest: 'a'.repeat(64),
    signerKeyId: 'first-party-test',
    manifest: { id: 'dev.robrolabs.system-monitor', slug: 'system-monitor', version: '1.0.0' },
  });
  mocks.fetchMarketplaceCatalog.mockResolvedValue({ modules: [] });
  mocks.refreshAndEnforceMarketplaceSecurity.mockResolvedValue({
    mode: 'online', available: true, freshness: 'current', recommendations: [{
      moduleId: 'dev.robrolabs.system-monitor',
      moduleSlug: 'system-monitor',
      version: '1.0.0',
      artifactSha256: 'a'.repeat(64),
      signerKeyId: 'first-party-test',
    }], installedFindings: [],
  });
});

describe('manual Module install route', () => {
  it('requires an administrator', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await uploadRoute.POST(uploadRequest());
    expect(response.status).toBe(401);
  });

  it('honors the canonical access lock before authentication', async () => {
    mocks.enforceApiAccessLock.mockResolvedValue(new Response(JSON.stringify({ code: 'NON_CANONICAL_HOST' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }) as never);
    const response = await uploadRoute.POST(uploadRequest());
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it('rejects non-admin users and malformed uploads', async () => {
    mocks.auth.mockResolvedValue({
      user: { id: 'member', role: 'member', email: 'member@example.test' },
      expires: '2099-01-01T00:00:00.000Z',
    });
    expect((await uploadRoute.POST(uploadRequest())).status).toBe(403);

    setAdmin();
    const form = new FormData();
    form.set('module', new File([Buffer.from('package')], 'not-a-module.zip'));
    const malformed = await uploadRoute.POST(new Request('http://nad.test/api/settings/modules/install', {
      method: 'POST',
      headers: { origin: 'http://nad.test' },
      body: form,
    }));
    expect(malformed.status).toBe(400);
    expect(mocks.verifyModulePackage).not.toHaveBeenCalled();
  });

  it('rejects an oversized request before reading multipart data', async () => {
    setAdmin();
    const response = await uploadRoute.POST(new Request('http://nad.test/api/settings/modules/install', {
      method: 'POST',
      headers: { 'content-length': String(12 * 1024 * 1024), origin: 'http://nad.test' },
    }));
    expect(response.status).toBe(413);
    expect(mocks.verifyModulePackage).not.toHaveBeenCalled();
  });

  it('bounds chunked multipart bytes before parsing form data', async () => {
    setAdmin();
    const formDataSpy = vi.spyOn(Request.prototype, 'formData');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        controller.close();
      },
    });

    try {
      const response = await uploadRoute.POST(new Request('http://nad.test/api/settings/modules/install', {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=nad-test-boundary',
          origin: 'http://nad.test',
        },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }));

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({ code: 'PACKAGE_TOO_LARGE' });
      expect(formDataSpy).not.toHaveBeenCalled();
      expect(mocks.verifyModulePackage).not.toHaveBeenCalled();
    } finally {
      formDataSpy.mockRestore();
    }
  });

  it('verifies and returns a review before activation', async () => {
    setAdmin();
    const response = await uploadRoute.POST(uploadRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { review: { slug: 'system-monitor' } } });
    expect(mocks.verifyModulePackage).toHaveBeenCalledOnce();
    expect(mocks.installModulePackage).not.toHaveBeenCalled();
  });

  it('binds confirmed activation to the reviewed digest', async () => {
    setAdmin();
    const response = await uploadRoute.POST(uploadRequest(true));
    expect(response.status).toBe(201);
    expect(mocks.installModulePackage).toHaveBeenCalledWith(
      Buffer.from('package'),
      'admin',
      { expectedDigest: 'a'.repeat(64) },
    );
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      'admin',
      'install_module',
      'system-monitor',
      expect.objectContaining({ operationId: 'operation-1' }),
    );
  });

  it('maps lifecycle contention during confirmed activation to a retryable conflict', async () => {
    setAdmin();
    mocks.installModulePackage.mockRejectedValueOnce(
      new ModulePackageError('Another lifecycle operation is already running.', 'MODULE_BUSY'),
    );

    const response = await uploadRoute.POST(uploadRequest(true));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'MODULE_BUSY' });
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      'admin',
      'reject_module_install',
      undefined,
      { code: 'MODULE_BUSY' },
    );
  });
});

describe('Marketplace Module install route', () => {
  it('does not fetch a catalog in manual-install mode', async () => {
    setAdmin();
    mocks.getMarketplaceMode.mockReturnValue('manual');
    const response = await marketplaceRoute.GET(new Request('http://nad.test/api/settings/modules/marketplace'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { mode: 'manual', modules: [] } });
    expect(mocks.fetchMarketplaceCatalog).not.toHaveBeenCalled();
  });

  it('does not download a package in manual-install mode', async () => {
    setAdmin();
    mocks.getMarketplaceMode.mockReturnValue('manual');
    const response = await marketplaceRoute.POST(new Request('http://nad.test/api/settings/modules/marketplace', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'system-monitor' }),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'MARKETPLACE_DISABLED' });
    expect(mocks.downloadMarketplaceModule).not.toHaveBeenCalled();
  });

  it('rejects cross-origin Marketplace mutations before downloading', async () => {
    setAdmin();
    const response = await marketplaceRoute.POST(new Request('http://nad.test/api/settings/modules/marketplace', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ slug: 'system-monitor' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'CROSS_ORIGIN_REQUEST' });
    expect(mocks.downloadMarketplaceModule).not.toHaveBeenCalled();
  });

  it('does not fetch when the Marketplace URL is missing', async () => {
    setAdmin();
    mocks.getMarketplaceBaseUrl.mockReturnValue(undefined as never);
    const response = await marketplaceRoute.GET(new Request('http://nad.test/api/settings/modules/marketplace'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { configured: false, modules: [] } });
    expect(mocks.fetchMarketplaceCatalog).not.toHaveBeenCalled();
  });

  it('returns a bounded fallback when the catalog is unavailable', async () => {
    setAdmin();
    mocks.fetchMarketplaceCatalog.mockRejectedValue(new Error('catalog unavailable'));
    const response = await marketplaceRoute.GET(new Request('http://nad.test/api/settings/modules/marketplace'));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'MARKETPLACE_UNAVAILABLE',
      data: { mode: 'online', configured: true, modules: [] },
    });
  });

  it('downloads and verifies for review without activating', async () => {
    setAdmin();
    const response = await marketplaceRoute.POST(new Request('http://nad.test/api/settings/modules/marketplace', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'system-monitor' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.downloadMarketplaceModule).toHaveBeenCalledWith('system-monitor');
    expect(mocks.installModulePackage).not.toHaveBeenCalled();
  });

  it('requires a current signed recommendation before downloading', async () => {
    setAdmin();
    mocks.refreshAndEnforceMarketplaceSecurity.mockResolvedValueOnce({
      mode: 'online', available: true, freshness: 'stale', recommendations: [], installedFindings: [],
    });

    const response = await marketplaceRoute.POST(new Request('http://nad.test/api/settings/modules/marketplace', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'system-monitor' }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'MARKETPLACE_SECURITY_UNAVAILABLE' });
    expect(mocks.downloadMarketplaceModule).not.toHaveBeenCalled();
    expect(mocks.verifyModulePackage).not.toHaveBeenCalled();
  });

  it('rejects a downloaded package that differs from the signed recommendation', async () => {
    setAdmin();
    mocks.verifyModulePackage.mockResolvedValueOnce({
      digest: 'b'.repeat(64),
      signerKeyId: 'first-party-test',
      manifest: { id: 'dev.robrolabs.system-monitor', slug: 'system-monitor', version: '1.0.0' },
    });

    const response = await marketplaceRoute.POST(new Request('http://nad.test/api/settings/modules/marketplace', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'system-monitor' }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'BAD_DOWNLOAD' });
    expect(mocks.installModulePackage).not.toHaveBeenCalled();
  });

  it('activates only the confirmed reviewed digest', async () => {
    setAdmin();
    const response = await marketplaceRoute.POST(new Request('http://nad.test/api/settings/modules/marketplace', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'system-monitor', confirm: true, expectedDigest: 'a'.repeat(64) }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.installModulePackage).toHaveBeenCalledWith(
      Buffer.from('package'),
      'admin',
      { expectedDigest: 'a'.repeat(64) },
    );
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      'admin',
      'install_module_from_marketplace',
      'system-monitor',
      expect.objectContaining({ operationId: 'operation-1' }),
    );
  });

  it('maps Marketplace lifecycle contention to a retryable conflict', async () => {
    setAdmin();
    mocks.installModulePackage.mockRejectedValueOnce(
      new ModulePackageError('Another lifecycle operation is already running.', 'MODULE_BUSY'),
    );

    const response = await marketplaceRoute.POST(new Request('http://nad.test/api/settings/modules/marketplace', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'system-monitor', confirm: true, expectedDigest: 'a'.repeat(64) }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'MODULE_BUSY' });
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      'admin',
      'marketplace_install_failed',
      'system-monitor',
      { code: 'MODULE_BUSY' },
    );
  });

  it('audits a safe failure without activating a release', async () => {
    setAdmin();
    mocks.downloadMarketplaceModule.mockRejectedValue(new Error('upstream leaked detail'));
    const response = await marketplaceRoute.POST(new Request('http://nad.test/api/settings/modules/marketplace', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'system-monitor' }),
    }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Marketplace install failed.',
      code: 'MARKETPLACE_INSTALL_FAILED',
    });
    expect(mocks.installModulePackage).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      'admin',
      'marketplace_install_failed',
      'system-monitor',
      { code: 'MARKETPLACE_INSTALL_FAILED' },
    );
  });
});
