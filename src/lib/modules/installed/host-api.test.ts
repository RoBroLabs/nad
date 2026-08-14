import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { contractLock } from '@/lib/modules/contracts/v1';
import type { InstalledModuleDefinition } from '@/lib/modules/installed/provider';
import type { ModuleApiContext } from '@/lib/modules/registry-types';

const directory = mkdtempSync(join(tmpdir(), 'nad-host-api-test-'));
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
process.env.NAD_DATA_DIR = directory;
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type HostApi = typeof import('@/lib/modules/installed/host-api');
type Db = typeof import('@/lib/db');
let hostApiModule: HostApi;
let database: Db;

const definition: InstalledModuleDefinition = {
  moduleId: 'dev.robrolabs.system-monitor',
  releaseId: 'release-1',
  configGenerationId: 'config-generation-1',
  kvGenerationId: 'kv-generation-1',
  grantGenerationId: 'grant-generation-1',
  digest: 'a'.repeat(64),
  artifactPath: '/tmp/not-used',
  enabled: true,
  lifecycleState: 'active',
  registryEpoch: 1,
  grantedCapabilities: ['http.request', 'notifications.emit', 'storage.get', 'storage.set', 'storage.delete', 'audit.annotate'],
  packageSchemaVersion: 1,
  packageKind: 'app',
  dependencies: [],
  operations: {},
  surfaces: null,
  v2HttpAccess: [],
  manifest: {
    moduleId: 'dev.robrolabs.system-monitor',
    slug: 'system-monitor',
    name: 'System Monitor',
    description: 'Fixture',
    icon: 'activity',
    category: 'monitoring',
    version: '1.0.1',
    source: 'installed',
    capabilities: [
      { name: 'http.request', reason: 'Read metrics.' },
      { name: 'notifications.emit', reason: 'Send alerts through NAD core.' },
      { name: 'storage.get', reason: 'Read cached state.' },
      { name: 'storage.set', reason: 'Write cached state.' },
      { name: 'storage.delete', reason: 'Delete cached state.' },
      { name: 'audit.annotate', reason: 'Record upstream task references.' },
    ],
    httpAccess: [
      {
        scheme: 'http',
        hostConfig: 'hosts',
        portConfig: 'node_exporter_port',
        path: '/metrics',
        methods: ['GET'],
      },
      {
        scheme: 'http',
        hostConfig: 'hosts',
        port: 80,
        path: '/',
        methods: ['GET'],
      },
    ],
    configSchema: [
      { key: 'hosts', label: 'Hosts', type: 'text', required: true },
      { key: 'node_exporter_port', label: 'Node Exporter port', type: 'number', required: false, defaultValue: 9100 },
    ],
    widgets: [],
    pages: [],
    permissions: [{ action: 'view', label: 'View', description: 'View metrics.', defaultRole: 'member' }],
    entrypoints: {},
  },
};

const context: ModuleApiContext = {
  config: { hosts: 'server|192.168.1.50' },
  moduleSlug: 'system-monitor',
  path: ['metrics'],
  userId: 'user-1',
  notify: vi.fn(async () => undefined),
};

beforeAll(async () => {
  database = await import('@/lib/db');
  hostApiModule = await import('@/lib/modules/installed/host-api');
  database.rawDb.prepare(`
    INSERT INTO users
      (id, email, name, password_hash, role, created_at, updated_at)
    VALUES ('user-1', 'user@example.test', 'User', 'hash', 'member', 'now', 'now')
  `).run();
  database.rawDb.prepare(`
    INSERT INTO installed_modules
      (module_id, slug, enabled, lifecycle_state, active_release_id, active_kv_generation_id, installed_at, updated_at)
    VALUES (?, ?, 1, 'active', ?, ?, 'now', 'now')
  `).run(definition.moduleId, definition.manifest.slug, definition.releaseId, definition.kvGenerationId);
  database.rawDb.prepare(`
    INSERT INTO module_releases
      (id, module_id, version, digest, artifact_path, manifest_json, ui_pages_json,
       ui_widgets_json, capabilities_json, signature_status, state, installed_at)
    VALUES (?, ?, '1.0.1', ?, '/tmp/not-used', '{}', '{}', '{}', '[]', 'verified', 'active', 'now')
  `).run(definition.releaseId, definition.moduleId, definition.digest);
  database.rawDb.prepare(`
    INSERT INTO module_kv_generations (id, module_id, byte_count, created_at)
    VALUES (?, ?, 0, 'now')
  `).run(definition.kvGenerationId, definition.moduleId);
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('installed Module host API HTTP scopes', () => {
  it('implements every canonical host capability', async () => {
    expect(hostApiModule.implementedModuleHostCapabilities).toEqual(contractLock.capabilities);
  });

  it('allows only the declared scheme, host, port, path, and method', async () => {
    const fetchMock = vi.fn(async () => new Response('metric 1\n', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const hostApi = hostApiModule.createInstalledHostApi(definition, context, 'query');

    await expect(hostApi({
      method: 'http.request',
      params: { url: 'http://192.168.1.50:9100/metrics', method: 'GET' },
    })).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://192.168.1.50:9100/metrics',
      expect.objectContaining({ redirect: 'manual' }),
    );

    await expect(hostApi({
      method: 'http.request',
      params: { url: 'http://192.168.1.50:9100/metrics?collect[]=cpu', method: 'GET' },
    })).rejects.toThrow('not approved');

    for (const request of [
      { url: 'http://192.168.1.50:2375/metrics', method: 'GET' },
      { url: 'http://192.168.1.50:9100/admin', method: 'GET' },
      { url: 'https://192.168.1.50:9100/metrics', method: 'GET' },
      { url: 'http://other.internal:9100/metrics', method: 'GET' },
      { url: 'http://192.168.1.50:9100/metrics', method: 'POST' },
    ] as const) {
      await expect(hostApi({ method: 'http.request', params: request })).rejects.toThrow('not approved');
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('allows the separately declared exact HTTP reachability endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const hostApi = hostApiModule.createInstalledHostApi(definition, context, 'query');

    await expect(hostApi({
      method: 'http.request',
      params: { url: 'http://192.168.1.50/', method: 'GET' },
    })).resolves.toMatchObject({ status: 204 });
    await expect(hostApi({
      method: 'http.request',
      params: { url: 'http://192.168.1.50/admin', method: 'GET' },
    })).rejects.toThrow('not approved');
  });

  it('uses the origin from configured URL fields while rejecting configured queries', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const hostApi = hostApiModule.createInstalledHostApi(definition, {
      ...context,
      config: { hosts: 'server|http://192.168.1.50/admin' },
    }, 'query');

    await expect(hostApi({
      method: 'http.request', params: { url: 'http://192.168.1.50:9100/metrics', method: 'GET' },
    })).resolves.toMatchObject({ status: 200 });

    const refused = hostApiModule.createInstalledHostApi(definition, {
      ...context,
      config: { hosts: 'server|http://192.168.1.50/admin?x=1' },
    }, 'query');
    await expect(refused({
      method: 'http.request', params: { url: 'http://192.168.1.50:9100/metrics', method: 'GET' },
    })).rejects.toThrow('not approved');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('injects a configured secret into an exact approved header without exposing it to Module code', async () => {
    const credentialDefinition: InstalledModuleDefinition = {
      ...definition,
      manifest: {
        ...definition.manifest,
        httpAccess: [{
          scheme: 'https',
          hostConfig: 'api_url',
          path: '/api2/json/nodes',
          methods: ['GET'],
          credential: {
            config: 'token_secret',
            location: 'header',
            name: 'Authorization',
            prefix: 'PVEAPIToken=',
            publicConfig: 'token_id',
            separator: '=',
          },
        }],
        configSchema: [
          { key: 'api_url', label: 'API URL', type: 'url', required: true },
          { key: 'token_id', label: 'Token ID', type: 'text', required: true },
          { key: 'token_secret', label: 'Token secret', type: 'secret', required: true },
        ],
      },
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        data: [],
        echoedAuthorization: 'PVEAPIToken=nad@pve!dashboard=super-"secret',
      }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const hostApi = hostApiModule.createInstalledHostApi(credentialDefinition, {
      ...context,
      config: {
        api_url: 'https://pve.internal:8006/api2/json',
        token_id: 'nad@pve!dashboard',
        token_secret: 'super-"secret',
      },
    }, 'query');

    await expect(hostApi({
      method: 'http.request',
      params: { url: 'https://pve.internal:8006/api2/json/nodes', method: 'GET' },
    })).resolves.toMatchObject({
      body: { data: [], echoedAuthorization: '[redacted]' },
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: 'PVEAPIToken=nad@pve!dashboard=super-"secret',
    });

    await expect(hostApi({
      method: 'http.request',
      params: {
        url: 'https://pve.internal:8006/api2/json/nodes',
        method: 'GET',
        headers: { Authorization: 'attacker-value' },
      },
    })).rejects.toThrow('not approved');

    const missingCredentialApi = hostApiModule.createInstalledHostApi(credentialDefinition, {
      ...context,
      config: {
        api_url: 'https://pve.internal:8006/api2/json',
        token_id: 'nad@pve!dashboard',
        token_secret: '',
      },
    }, 'query');
    await expect(missingCredentialApi({
      method: 'http.request',
      params: { url: 'https://pve.internal:8006/api2/json/nodes', method: 'GET' },
    })).rejects.toMatchObject({ code: 'UPSTREAM_CREDENTIAL_MISSING' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('allows signed read-effect GraphQL POSTs but refuses write-effect POSTs from queries', async () => {
    const graphqlDefinition: InstalledModuleDefinition = {
      ...definition,
      manifest: {
        ...definition.manifest,
        httpAccess: [{
          scheme: 'https',
          hostConfig: 'server_host',
          port: 443,
          path: '/graphql',
          methods: ['POST'],
          effect: 'read',
          requestBodyPolicy: 'graphql-query',
          credential: { config: 'api_key', location: 'header', name: 'x-api-key' },
        }],
        configSchema: [
          { key: 'server_host', label: 'Server host', type: 'text', required: true },
          { key: 'api_key', label: 'API key', type: 'secret', required: true },
        ],
      },
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ data: { info: {} } }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryHostApi = hostApiModule.createInstalledHostApi(graphqlDefinition, {
      ...context,
      config: { server_host: 'tower.internal', api_key: 'unraid-key' },
    }, 'query');

    await expect(queryHostApi({
      method: 'http.request',
      params: {
        url: 'https://tower.internal/graphql',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { query: 'query { info { os { hostname } } }' },
      },
    })).resolves.toMatchObject({ status: 200 });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ 'x-api-key': 'unraid-key' });

    await expect(queryHostApi({
      method: 'http.request',
      params: {
        url: 'https://tower.internal/graphql',
        method: 'POST',
        body: { query: 'mutation { array { start } }' },
      },
    })).rejects.toMatchObject({ code: 'QUERY_SIDE_EFFECT_REFUSED' });
    await expect(queryHostApi({
      method: 'http.request',
      params: {
        url: 'https://tower.internal/graphql',
        method: 'POST',
        body: { query: 'query { info { os { hostname } } }', extension: { unapproved: true } },
      },
    })).rejects.toThrow('unapproved field');

    const writeDefinition: InstalledModuleDefinition = {
      ...graphqlDefinition,
      manifest: {
        ...graphqlDefinition.manifest,
        httpAccess: graphqlDefinition.manifest.httpAccess?.map((scope) => ({ ...scope, effect: 'write' })),
      },
    };
    const refused = hostApiModule.createInstalledHostApi(writeDefinition, {
      ...context,
      config: { server_host: 'tower.internal', api_key: 'unraid-key' },
    }, 'query');
    await expect(refused({
      method: 'http.request',
      params: { url: 'https://tower.internal/graphql', method: 'POST', body: { query: '{}' } },
    })).rejects.toThrow('signed read-effect');
  });

  it('bounds query keys and constrained path placeholders to the signed scope', async () => {
    const dynamicDefinition: InstalledModuleDefinition = {
      ...definition,
      manifest: {
        ...definition.manifest,
        httpAccess: [{
          scheme: 'https',
          hostConfig: 'host',
          port: 8006,
          path: '/api2/json/nodes/{node}/qemu/{vmid}/status/start',
          pathParameters: { node: 'segment', vmid: 'integer' },
          queryParameters: ['wait'],
          methods: ['POST'],
          effect: 'write',
        }],
        configSchema: [{ key: 'host', label: 'Host', type: 'text', required: true }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: 'UPID:test' }), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const hostApi = hostApiModule.createInstalledHostApi(dynamicDefinition, {
      ...context,
      config: { host: 'pve.internal' },
    }, 'mutation');

    await expect(hostApi({
      method: 'http.request',
      params: { url: 'https://pve.internal:8006/api2/json/nodes/pve-1/qemu/101/status/start?wait=1', method: 'POST' },
    })).resolves.toMatchObject({ body: { data: 'UPID:test' } });
    for (const url of [
      'https://pve.internal:8006/api2/json/nodes/pve-1/qemu/not-a-number/status/start?wait=1',
      'https://pve.internal:8006/api2/json/nodes/pve-1/qemu/101/status/start?other=1',
      'https://pve.internal:8006/api2/json/nodes/pve-1/qemu/101/status/stop?wait=1',
    ]) {
      await expect(hostApi({ method: 'http.request', params: { url, method: 'POST' } })).rejects.toThrow('not approved');
    }
  });

  it('maps unknown upstream failures to a classified safe error', async () => {
    const secret = 'upstream-token-super-secret';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error(secret);
    }));
    const hostApi = hostApiModule.createInstalledHostApi(definition, context, 'query');

    const failure = await hostApi({
      method: 'http.request',
      params: { url: 'http://192.168.1.50:9100/metrics', method: 'GET' },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(hostApiModule.InstalledHostApiError);
    expect(failure).toMatchObject({
      message: 'Upstream request failed.',
      code: 'UPSTREAM_REQUEST_FAILED',
    });
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it('maps the broker deadline to a classified upstream timeout', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })
    )));
    const hostApi = hostApiModule.createInstalledHostApi(definition, context, 'query');
    const pending = hostApi({
      method: 'http.request',
      params: { url: 'http://192.168.1.50:9100/metrics', method: 'GET' },
    });
    timeout.abort();

    await expect(pending).rejects.toMatchObject({
      message: 'Upstream request timed out.',
      code: 'UPSTREAM_TIMEOUT',
    });
  });

  it('aborts in-flight HTTP work with the invocation signal without exposing its reason', async () => {
    const controller = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        fetchSignal = init?.signal ?? undefined;
        fetchSignal?.addEventListener('abort', () => reject(fetchSignal?.reason), { once: true });
      })
    )));
    const hostApi = hostApiModule.createInstalledHostApi(
      definition,
      context,
      'query',
      controller.signal,
    );

    const pending = hostApi({
      method: 'http.request',
      params: { url: 'http://192.168.1.50:9100/metrics', method: 'GET' },
    });
    await vi.waitFor(() => expect(fetchSignal).toBeDefined());
    controller.abort(new Error('secret abort reason'));

    await expect(pending).rejects.toMatchObject({
      message: 'Host call was cancelled.',
      code: 'INVOCATION_ABORTED',
    });
    expect(fetchSignal?.aborted).toBe(true);
  });
});

describe('installed Module host API storage and audit scopes', () => {
  it('refuses notification work after its invocation is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const hostApi = hostApiModule.createInstalledHostApi(
      definition,
      context,
      'mutation',
      controller.signal,
    );

    await expect(hostApi({
      method: 'notifications.emit',
      params: { key: 'aborted.test', title: 'Too late', body: 'Do not deliver', severity: 'warning' },
    })).rejects.toMatchObject({ code: 'INVOCATION_ABORTED' });
    expect(context.notify).not.toHaveBeenCalled();
  });

  it('routes package notification events through the core-owned notifier', async () => {
    const hostApi = hostApiModule.createInstalledHostApi(definition, context, 'mutation');

    await expect(hostApi({
      method: 'notifications.emit',
      params: {
        key: 'system-monitor.test',
        title: 'System Monitor test',
        body: 'This event came from the installed package.',
        severity: 'info',
      },
    })).resolves.toEqual({ accepted: true });
    expect(context.notify).toHaveBeenCalledWith(
      'System Monitor test',
      'This event came from the installed package.',
      'info',
    );

    const queryHostApi = hostApiModule.createInstalledHostApi(definition, context, 'query');
    await expect(queryHostApi({
      method: 'notifications.emit',
      params: { key: 'unexpected', title: 'Unexpected', body: 'Query side effect', severity: 'info' },
    })).rejects.toThrow('Read-only endpoints may not emit');
  });

  it('allows query endpoints to read but not write namespaced storage', async () => {
    const mutationHostApi = hostApiModule.createInstalledHostApi(definition, context, 'mutation');
    const queryHostApi = hostApiModule.createInstalledHostApi(definition, context, 'query');

    await expect(mutationHostApi({
      method: 'storage.set',
      params: { key: 'summary.last', value: { status: 'ok' } },
    })).resolves.toEqual({ accepted: true });

    await expect(queryHostApi({
      method: 'storage.get',
      params: { key: 'summary.last' },
    })).resolves.toEqual({ status: 'ok' });

    database.rawDb.prepare("UPDATE module_releases SET state = 'retained' WHERE id = ?")
      .run(definition.releaseId);
    database.rawDb.prepare("UPDATE installed_modules SET active_release_id = 'release-next' WHERE module_id = ?")
      .run(definition.moduleId);
    try {
      await expect(queryHostApi({
        method: 'storage.get',
        params: { key: 'summary.last' },
      })).resolves.toEqual({ status: 'ok' });
    } finally {
      database.rawDb.prepare("UPDATE installed_modules SET active_release_id = ? WHERE module_id = ?")
        .run(definition.releaseId, definition.moduleId);
      database.rawDb.prepare("UPDATE module_releases SET state = 'active' WHERE id = ?")
        .run(definition.releaseId);
    }

    await expect(queryHostApi({
      method: 'storage.set',
      params: { key: 'summary.last', value: { status: 'bad' } },
    })).rejects.toThrow('Read-only endpoints may not write');
  });

  it('binds storage writes to the active release and generation', async () => {
    const staleDefinition: InstalledModuleDefinition = {
      ...definition,
      releaseId: 'release-old',
    };
    const hostApi = hostApiModule.createInstalledHostApi(staleDefinition, context, 'mutation');

    await expect(hostApi({
      method: 'storage.set',
      params: { key: 'stale', value: true },
    })).rejects.toThrow('no longer active');
  });

  it('records bounded module audit annotations through core audit', async () => {
    const hostApi = hostApiModule.createInstalledHostApi(definition, context, 'mutation');

    await expect(hostApi({
      method: 'audit.annotate',
      params: { upstreamTask: 'task-123', succeeded: true },
    })).resolves.toEqual({ accepted: true });

    const row = database.rawDb.prepare(`
      SELECT action, module_slug, details FROM audit_log
      WHERE action = 'module_audit_annotation'
    `).get() as { action: string; module_slug: string; details: string };
    expect(row).toMatchObject({ action: 'module_audit_annotation', module_slug: 'system-monitor' });
    expect(JSON.parse(row.details)).toMatchObject({
      releaseId: definition.releaseId,
      endpoint: 'metrics',
      metadata: { upstreamTask: 'task-123', succeeded: true },
    });

    const queryHostApi = hostApiModule.createInstalledHostApi(definition, context, 'query');
    await expect(queryHostApi({
      method: 'audit.annotate',
      params: { unexpected: true },
    })).rejects.toThrow('Read-only endpoints may not annotate');
  });
});
