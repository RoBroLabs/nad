import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledModuleDefinition } from '@/lib/modules/installed/provider';
import type { ModuleApiHandler } from '@/lib/modules/registry-types';

const mocks = vi.hoisted(() => ({
  getInstalledModule: vi.fn<() => InstalledModuleDefinition | undefined>(),
  isReleaseQuarantined: vi.fn(() => false),
  handler: vi.fn<ModuleApiHandler>(async () => Response.json({ data: {} })),
}));

vi.mock('@/lib/modules/installed/provider', () => ({
  getAllInstalledModules: vi.fn(() => []),
  getInstalledModule: mocks.getInstalledModule,
}));
vi.mock('@/lib/modules/installed/runner', () => ({
  createInstalledModuleHandler: vi.fn(() => mocks.handler),
}));
vi.mock('@/lib/marketplace/security', () => ({
  isReleaseQuarantined: mocks.isReleaseQuarantined,
}));

const registry = await import('@/lib/modules/registry');
const invocationGuard = await import('@/lib/modules/installed/invocation-guard');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isReleaseQuarantined.mockReturnValue(false);
  mocks.getInstalledModule.mockReturnValue({
    manifest: {
      moduleId: 'dev.robrolabs.system-monitor',
      slug: 'system-monitor',
      name: 'System Monitor',
      description: 'System health.',
      icon: 'activity',
      category: 'monitoring',
      version: '1.0.3',
      source: 'installed',
      publisher: 'Robro Labs',
      compatibility: { core: '>=0.2.1 <0.3.0', hostApi: '1.0', uiApi: '1.0' },
      capabilities: [],
      httpAccess: [],
      configSchema: [],
      permissions: [{
        action: 'restart',
        label: 'Restart',
        description: 'Restart host.',
        defaultRole: 'admin',
      }],
      entrypoints: {
        restart: {
          method: 'POST',
          kind: 'mutation',
          permission: 'restart',
          handler: 'restartHost',
          auditAction: 'restart_host',
          timeoutClass: 'action',
          maxRequestBytes: 1024,
          maxResponseBytes: 4096,
        },
      },
      widgets: [],
      pages: [],
    },
    moduleId: 'dev.robrolabs.system-monitor',
    releaseId: 'release-1.0.3',
    configGenerationId: 'config-current',
    kvGenerationId: 'kv-current',
    grantGenerationId: 'grants-current',
    digest: 'a'.repeat(64),
    artifactPath: '/data/modules/artifacts/aa/package.nadmod',
    enabled: true,
    lifecycleState: 'active',
    registryEpoch: 3,
    grantedCapabilities: [],
    packageSchemaVersion: 1,
    packageKind: 'app',
    dependencies: [],
    operations: {},
    surfaces: null,
    v2HttpAccess: [],
  });
});

describe('installed Module API registry', () => {
  it('looks up method metadata without joining a mutation drain', () => {
    const endpoint = registry.getModuleApiEndpoint('system-monitor', ['restart']);
    expect(endpoint?.entrypoint.method).toBe('POST');
    expect(invocationGuard.getModuleInvocationSnapshot('dev.robrolabs.system-monitor')).toEqual({
      queryCount: 0,
      mutationCount: 0,
      releaseCounts: {},
    });

    const endDrain = invocationGuard.startModuleMutationDrain(
      'dev.robrolabs.system-monitor',
      'operation-update',
    );
    try {
      expect(() => registry.pinModuleApiEndpoint(endpoint!)).toThrowError(
        expect.objectContaining({ code: 'MODULE_MUTATION_DRAINING' }),
      );
      expect(invocationGuard.getModuleInvocationSnapshot('dev.robrolabs.system-monitor')).toEqual({
        queryCount: 0,
        mutationCount: 0,
        releaseCounts: {},
        mutationDrainOperationId: 'operation-update',
      });
    } finally {
      endDrain();
    }
  });
});
