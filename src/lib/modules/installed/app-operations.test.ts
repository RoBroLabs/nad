import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledModuleDefinition } from '@/lib/modules/installed/provider';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  getAllInstalledModules: vi.fn(),
  getSurfaceDefinition: vi.fn(),
  readConnectionProfileForInvocation: vi.fn(),
  executeInstalledOperation: vi.fn(),
  beginModuleInvocation: vi.fn(),
  isReleaseQuarantined: vi.fn(),
  logAuditEvent: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/db/audit', () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock('@/lib/db', () => ({ rawDb: { prepare: mocks.prepare } }));
vi.mock('@/lib/marketplace/security', () => ({ isReleaseQuarantined: mocks.isReleaseQuarantined }));
vi.mock('@/lib/modules/connections', () => ({ readConnectionProfileForInvocation: mocks.readConnectionProfileForInvocation }));
vi.mock('@/lib/modules/installed/invocation-guard', () => ({ beginModuleInvocation: mocks.beginModuleInvocation }));
vi.mock('@/lib/modules/installed/provider', () => ({ getAllInstalledModules: mocks.getAllInstalledModules }));
vi.mock('@/lib/modules/installed/runner', () => ({ executeInstalledOperation: mocks.executeInstalledOperation }));
vi.mock('@/lib/modules/installed/surfaces', () => ({ getSurfaceDefinition: mocks.getSurfaceDefinition }));
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => undefined) }));

const operation = {
  version: '1.0.0', kind: 'query', consumers: ['self', 'addon'], connection: 'required', permission: 'view',
  handler: 'summary', requestSchema: 'schemas/operations/input.json', responseSchema: 'schemas/operations/output.json',
  timeoutClass: 'short', maxRequestBytes: 1024, maxResponseBytes: 4096,
};

function definition(kind: 'app' | 'addon'): InstalledModuleDefinition {
  const app = kind === 'app';
  const moduleId = app ? 'dev.robrolabs.fixture-app' : 'dev.robrolabs.fixture-addon';
  const slug = app ? 'fixture-app' : 'fixture-addon';
  return {
    moduleId,
    releaseId: `${kind}-release`,
    configGenerationId: null,
    kvGenerationId: null,
    grantGenerationId: `${kind}-grant`,
    digest: (app ? 'a' : 'b').repeat(64),
    signerKeyId: 'reviewed-key',
    artifactPath: `/artifact/${slug}`,
    enabled: true,
    lifecycleState: 'active',
    registryEpoch: 4,
    grantedCapabilities: app ? ['connections.current'] : ['apps.invoke'],
    packageSchemaVersion: 2,
    packageKind: kind,
    dependencies: app ? [] : [{
      alias: 'app', appId: 'dev.robrolabs.fixture-app', packageVersion: '>=2.0.0 <3.0.0',
      operations: { summary: '^1.0.0' },
    }],
    operations: app ? { summary: operation } : {},
    surfaces: null,
    v2HttpAccess: [],
    manifest: {
      moduleId, slug, name: app ? 'Fixture App' : 'Fixture Add-on', description: 'Fixture', icon: 'server',
      category: 'servers', version: app ? '2.0.0' : '1.0.0', source: 'installed', publisher: 'Robro Labs',
      compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
      capabilities: [], configSchema: [], widgets: [], pages: [],
      permissions: [{ action: 'view', label: 'View', description: 'View.', defaultRole: 'member' }],
      entrypoints: {},
    },
  };
}

const appSurface = {
  moduleId: 'dev.robrolabs.fixture-app', moduleSlug: 'fixture-app', releaseId: 'app-release',
  digest: 'a'.repeat(64), artifactPath: '/artifact/fixture-app', packageKind: 'app' as const,
  surface: {
    id: 'summary', type: 'widget' as const, name: 'Summary', entry: 'ui/surfaces/summary.html',
    permissions: ['view'], requestedMode: 'sandboxed' as const, raw: {},
    connectionSlots: [{ id: 'primary', target: 'self', required: true }],
    bindings: [{ id: 'summary', target: 'self', operation: 'summary', connectionSlot: 'primary' }],
  },
};

const addonSurface = {
  ...appSurface,
  moduleId: 'dev.robrolabs.fixture-addon', moduleSlug: 'fixture-addon', releaseId: 'addon-release',
  digest: 'b'.repeat(64), artifactPath: '/artifact/fixture-addon', packageKind: 'addon' as const,
  surface: {
    ...appSurface.surface,
    connectionSlots: [{ id: 'primary', target: 'app', required: true }],
    bindings: [{ id: 'summary', target: 'app', operation: 'summary', connectionSlot: 'primary' }],
  },
};

beforeEach(() => {
  mocks.hasPermission.mockResolvedValue(true);
  mocks.isReleaseQuarantined.mockReturnValue(false);
  mocks.beginModuleInvocation.mockImplementation(() => vi.fn());
  mocks.prepare.mockReturnValue({
    get: vi.fn((moduleId: string) => ({
      active_release_id: moduleId === 'dev.robrolabs.fixture-app' ? 'app-release' : 'addon-release',
      registry_epoch: 4,
      enabled: 1,
      lifecycle_state: 'active',
    })),
  });
  mocks.readConnectionProfileForInvocation.mockResolvedValue({
    id: 'connection-profile-1', name: 'Lab', appModuleId: 'dev.robrolabs.fixture-app', appSlug: 'fixture-app',
    generationId: 'generation-1', revision: 1, values: { endpoint: 'https://lab.example.test', token: 'secret-value' },
  });
  mocks.executeInstalledOperation.mockResolvedValue({ status: 'ok' });
  mocks.logAuditEvent.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe('v2 surface App-operation broker', () => {
  it('executes an App self binding with a pinned authorized connection and no browser secret exposure', async () => {
    const app = definition('app');
    mocks.getAllInstalledModules.mockReturnValue([app]);
    mocks.getSurfaceDefinition.mockReturnValue(appSurface);
    const { invokeSurfaceBinding } = await import('@/lib/modules/installed/app-operations');
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-app', surfaceId: 'summary', bindingId: 'summary',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: {},
    })).resolves.toMatchObject({ data: { status: 'ok' }, appReleaseId: 'app-release' });
    expect(mocks.executeInstalledOperation).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ handler: 'summary' }),
      {},
      expect.objectContaining({
        config: { endpoint: 'https://lab.example.test', token: 'secret-value' },
        connectionProfileId: 'connection-profile-1',
        caller: { kind: 'surface', packageId: app.moduleId, surfaceId: 'summary' },
      }),
    );
    expect(JSON.stringify((await invokeSurfaceBinding({
      moduleSlug: 'fixture-app', surfaceId: 'summary', bindingId: 'summary',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: {},
    })))).not.toContain('secret-value');
  });

  it('executes only a declared compatible Add-on-to-App binding', async () => {
    const app = definition('app');
    const addon = definition('addon');
    mocks.getAllInstalledModules.mockReturnValue([addon, app]);
    mocks.getSurfaceDefinition.mockReturnValue(addonSurface);
    const { invokeSurfaceBinding } = await import('@/lib/modules/installed/app-operations');
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-addon', surfaceId: 'summary', bindingId: 'summary',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: { filter: 'running' },
    })).resolves.toMatchObject({ appReleaseId: 'app-release', addonReleaseId: 'addon-release' });
    expect(mocks.beginModuleInvocation).toHaveBeenCalledWith(addon.moduleId, addon.releaseId, 'query');
    expect(mocks.beginModuleInvocation).toHaveBeenCalledWith(app.moduleId, app.releaseId, 'query');

    addon.dependencies = [{
      alias: 'app', appId: app.moduleId, packageVersion: '>=3.0.0 <4.0.0', operations: { summary: '^1.0.0' },
    }];
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-addon', surfaceId: 'summary', bindingId: 'summary',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: {},
    })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('allows an Add-on self operation to invoke only its declared App and surface-selected profile', async () => {
    const app = definition('app');
    const addon = definition('addon');
    addon.operations = {
      compose: {
        version: '1.0.0', kind: 'query', consumers: ['self'], connection: 'none', permission: 'view',
        handler: 'compose', requestSchema: 'schemas/operations/input.json',
        responseSchema: 'schemas/operations/output.json', timeoutClass: 'short',
        maxRequestBytes: 1024, maxResponseBytes: 4096,
      },
    };
    mocks.getAllInstalledModules.mockReturnValue([addon, app]);
    mocks.getSurfaceDefinition.mockReturnValue({
      ...addonSurface,
      surface: {
        ...addonSurface.surface,
        bindings: [{ id: 'compose', target: 'self', operation: 'compose' }],
      },
    });
    mocks.executeInstalledOperation.mockImplementation(async (target, _entrypoint, body, context) => {
      if (target.packageKind === 'app') return { fromApp: true };
      return context.invokeApp?.({
        dependency: 'app', operation: 'summary', connectionProfileId: 'connection-profile-1', input: body,
      });
    });
    const { invokeSurfaceBinding } = await import('@/lib/modules/installed/app-operations');
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-addon', surfaceId: 'summary', bindingId: 'compose',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: { filter: 'online' },
    })).resolves.toMatchObject({ data: { fromApp: true }, addonReleaseId: 'addon-release' });

    mocks.executeInstalledOperation.mockImplementationOnce(async (_target, _entrypoint, body, context) => (
      context.invokeApp?.({
        dependency: 'app', operation: 'summary', connectionProfileId: 'not-selected-profile', input: body,
      })
    ));
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-addon', surfaceId: 'summary', bindingId: 'compose',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: {},
    })).rejects.toMatchObject({ code: 'CONNECTION_ACCESS_DENIED' });
  });

  it('blocks cross-App profiles, permission removal, revocation, and changed active releases', async () => {
    const app = definition('app');
    mocks.getAllInstalledModules.mockReturnValue([app]);
    mocks.getSurfaceDefinition.mockReturnValue(appSurface);
    const { invokeSurfaceBinding } = await import('@/lib/modules/installed/app-operations');

    mocks.readConnectionProfileForInvocation.mockRejectedValueOnce(Object.assign(new Error('wrong app'), { code: 'CONNECTION_ACCESS_DENIED' }));
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-app', surfaceId: 'summary', bindingId: 'summary',
      connectionBindings: { primary: 'other-app-profile' }, userId: 'member', input: {},
    })).rejects.toMatchObject({ code: 'CONNECTION_ACCESS_DENIED' });

    mocks.hasPermission.mockResolvedValueOnce(false);
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-app', surfaceId: 'summary', bindingId: 'summary',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: {},
    })).rejects.toMatchObject({ code: 'SURFACE_ACCESS_DENIED' });

    mocks.isReleaseQuarantined.mockReturnValueOnce(true);
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-app', surfaceId: 'summary', bindingId: 'summary',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: {},
    })).rejects.toMatchObject({ code: 'APP_UNAVAILABLE' });

    mocks.prepare.mockReturnValueOnce({ get: vi.fn(() => ({
      active_release_id: 'new-release', registry_epoch: 5, enabled: 1, lifecycle_state: 'active',
    })) });
    await expect(invokeSurfaceBinding({
      moduleSlug: 'fixture-app', surfaceId: 'summary', bindingId: 'summary',
      connectionBindings: { primary: 'connection-profile-1' }, userId: 'member', input: {},
    })).rejects.toMatchObject({ code: 'MODULE_RELEASE_CHANGED' });
  });
});
