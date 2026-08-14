import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledModuleDefinition } from '@/lib/modules/installed/provider';
import { createInstalledModuleHandler, executeInstalledOperation } from '@/lib/modules/installed/runner';
import type { ModuleApiContext } from '@/lib/modules/registry-types';
import type { ModuleEntrypoint } from '@/lib/modules/types';

const denoPath = process.env.NAD_DENO_PATH;
const directories: string[] = [];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function fixture(source: string, options: Partial<ModuleEntrypoint> = {}): {
  definition: InstalledModuleDefinition;
  entrypoint: ModuleEntrypoint;
} {
  const artifactPath = mkdtempSync(join(tmpdir(), 'nad-runner-fixture-'));
  directories.push(artifactPath);
  mkdirSync(join(artifactPath, 'server'));
  writeFileSync(join(artifactPath, 'server/main.js'), source, { mode: 0o600 });
  const entrypoint: ModuleEntrypoint = {
    method: 'GET',
    kind: 'query',
    permission: 'view',
    handler: 'run',
    timeoutClass: 'short',
    maxRequestBytes: 1024,
    maxResponseBytes: 65_536,
    ...options,
  };
  return {
    entrypoint,
    definition: {
      moduleId: `dev.robrolabs.runner-${directories.length}`,
      releaseId: `release-${directories.length}`,
      configGenerationId: null,
      kvGenerationId: null,
      grantGenerationId: `grant-${directories.length}`,
      digest: 'a'.repeat(64),
      artifactPath,
      enabled: true,
      lifecycleState: 'active',
      registryEpoch: 1,
      grantedCapabilities: [],
      packageSchemaVersion: 1,
      packageKind: 'app',
      dependencies: [],
      operations: {},
      surfaces: null,
      v2HttpAccess: [],
      manifest: {
        moduleId: `dev.robrolabs.runner-${directories.length}`,
        slug: `runner-${directories.length}`,
        name: 'Runner fixture',
        description: 'Runtime isolation fixture.',
        icon: 'activity',
        category: 'monitoring',
        version: '1.0.0',
        source: 'installed',
        configSchema: [],
        permissions: [{ action: 'view', label: 'View', description: 'View.', defaultRole: 'member' }],
        entrypoints: { run: entrypoint },
        widgets: [],
        pages: [],
      },
    },
  };
}

async function invoke(
  definition: InstalledModuleDefinition,
  entrypoint: ModuleEntrypoint,
  request = new Request('http://nad.test/api/modules/runner/run'),
  context: Partial<ModuleApiContext> = {},
): Promise<Response> {
  return createInstalledModuleHandler(definition, entrypoint)(
    request,
    {
      config: {},
      moduleSlug: definition.manifest.slug,
      path: ['run'],
      userId: 'admin',
      notify: async () => undefined,
      ...context,
    },
  );
}

describe('isolated Deno Module runner budgets', () => {
  it.skipIf(!denoPath)('runs a v2 App operation with canonical context and exposes only an opaque secret reference', async () => {
    const artifactPath = mkdtempSync(join(tmpdir(), 'nad-v2-runner-fixture-'));
    directories.push(artifactPath);
    mkdirSync(join(artifactPath, 'server'), { recursive: true });
    mkdirSync(join(artifactPath, 'schemas', 'endpoints'), { recursive: true });
    writeFileSync(join(artifactPath, 'server/main.js'), `
      export async function inspect(request, host) {
        const profile = await host.connections.current();
        const endpoint = await host.connections.get('endpoint');
        const token = await host.connections.get('token');
        return {
          operation: request.operation,
          body: request.body,
          caller: request.context.caller,
          profile,
          endpoint,
          tokenPresent: token.present,
          tokenReference: token.secretRef,
        };
      }
    `, { mode: 0o600 });
    writeFileSync(join(artifactPath, 'schemas', 'connections.json'), JSON.stringify({
      type: 'object',
      required: ['endpoint', 'token'],
      properties: {
        endpoint: { type: 'string', title: 'Endpoint', 'x-nad': { control: 'url' } },
        token: { type: 'string', title: 'Token', 'x-nad': { control: 'secret' } },
      },
    }));
    writeFileSync(join(artifactPath, 'schemas', 'endpoints', 'input.json'), '{"type":"object"}');
    writeFileSync(join(artifactPath, 'schemas', 'endpoints', 'output.json'), '{"type":"object"}');
    const entrypoint: ModuleEntrypoint = {
      method: 'POST', kind: 'query', permission: 'view', handler: 'inspect',
      requestSchema: 'schemas/endpoints/input.json',
      responseSchema: 'schemas/endpoints/output.json',
      timeoutClass: 'short', maxRequestBytes: 1024, maxResponseBytes: 65_536,
    };
    const definition: InstalledModuleDefinition = {
      moduleId: 'dev.robrolabs.v2-runner', releaseId: 'release-v2',
      configGenerationId: null, kvGenerationId: null, grantGenerationId: 'grant-v2',
      digest: 'b'.repeat(64), artifactPath, enabled: true, lifecycleState: 'active', registryEpoch: 1,
      grantedCapabilities: ['connections.current', 'connections.get'],
      packageSchemaVersion: 2, packageKind: 'app', dependencies: [],
      operations: { inspect: { handler: 'inspect' } }, surfaces: null, v2HttpAccess: [],
      manifest: {
        moduleId: 'dev.robrolabs.v2-runner', slug: 'v2-runner', name: 'V2 runner',
        description: 'V2 runtime fixture.', icon: 'activity', category: 'tools', version: '1.0.0',
        source: 'installed', configSchema: [], permissions: [{ action: 'view', label: 'View', description: 'View.', defaultRole: 'member' }],
        entrypoints: {}, widgets: [], pages: [],
      },
    };
    const plaintextSecret = 'must-not-cross-the-runtime-boundary';
    const result = await executeInstalledOperation(definition, entrypoint, { target: 42 }, {
      config: { endpoint: 'https://example.test', token: plaintextSecret },
      moduleSlug: 'v2-runner', path: ['operations', 'inspect'], userId: 'admin',
      connectionProfileId: 'profile-abcdefghijklmnop', connectionProfileName: 'Lab',
      caller: { kind: 'addon', packageId: 'dev.robrolabs.fixture-addon', surfaceId: 'summary' },
      notify: async () => undefined,
    });
    expect(result).toMatchObject({
      operation: 'inspect', body: { target: 42 },
      caller: { kind: 'addon', packageId: 'dev.robrolabs.fixture-addon', surfaceId: 'summary' },
      profile: { id: 'profile-abcdefghijklmnop', name: 'Lab' },
      endpoint: 'https://example.test', tokenPresent: true,
      tokenReference: 'profile/profile-abcdefghijklmnop/token',
    });
    expect(JSON.stringify(result)).not.toContain(plaintextSecret);
  }, 20_000);

  it.skipIf(!denoPath)('dispatches schema-v2 operations with the canonical invocation envelope and Host API v2', async () => {
    const target = fixture(`
      export async function summary(request, host) {
        return {
          operation: request.operation,
          body: request.body,
          caller: request.context.caller,
          profile: request.context.connectionProfile,
          current: await host.connections.current(),
          hasLegacyConfig: Object.hasOwn(host, 'config'),
        };
      }
    `, {
      method: 'POST',
      handler: 'summary',
      requestSchema: 'schemas/operations/summary-input.json',
      responseSchema: 'schemas/operations/summary-output.json',
    });
    mkdirSync(join(target.definition.artifactPath, 'schemas', 'operations'), { recursive: true });
    writeFileSync(join(target.definition.artifactPath, 'schemas', 'operations', 'summary-input.json'), JSON.stringify({
      type: 'object', required: ['filter'], properties: { filter: { type: 'string' } }, additionalProperties: false,
    }));
    writeFileSync(join(target.definition.artifactPath, 'schemas', 'operations', 'summary-output.json'), JSON.stringify({
      type: 'object', required: ['operation', 'body', 'caller', 'profile', 'current', 'hasLegacyConfig'], additionalProperties: true,
    }));
    target.definition.packageSchemaVersion = 2;
    target.definition.packageKind = 'app';
    target.definition.grantedCapabilities = ['connections.current'];
    target.definition.operations = {
      summary: {
        version: '1.0.0', kind: 'query', consumers: ['self'], connection: 'required', permission: 'view',
        handler: 'summary', requestSchema: target.entrypoint.requestSchema,
        responseSchema: target.entrypoint.responseSchema, timeoutClass: 'short',
        maxRequestBytes: 1024, maxResponseBytes: 65_536,
      },
    };

    await expect(executeInstalledOperation(target.definition, target.entrypoint, { filter: 'online' }, {
      config: { token: 'server-only-secret' },
      moduleSlug: target.definition.manifest.slug,
      path: ['operations', 'summary'],
      userId: 'member',
      connectionProfileId: 'connection-profile-1',
      connectionProfileName: 'Lab',
      connectionGenerationId: 'generation-1',
      caller: { kind: 'surface', packageId: target.definition.moduleId, surfaceId: 'summary' },
      notify: async () => undefined,
    })).resolves.toEqual({
      operation: 'summary',
      body: { filter: 'online' },
      caller: { kind: 'surface', packageId: target.definition.moduleId, surfaceId: 'summary' },
      profile: { id: 'connection-profile-1', name: 'Lab' },
      current: { id: 'connection-profile-1', name: 'Lab' },
      hasLegacyConfig: false,
    });
  }, 20_000);

  it.skipIf(!denoPath)('brokers an Add-on apps.invoke host call through the core-supplied dependency closure', async () => {
    const target = fixture(`
      export async function compose(request, host) {
        return host.apps.invoke({
          dependency: 'app',
          operation: 'summary',
          connectionProfileId: 'connection-profile-1',
          input: request.body,
        });
      }
    `, {
      method: 'POST', handler: 'compose',
      requestSchema: 'schemas/operations/compose-input.json',
      responseSchema: 'schemas/operations/compose-output.json',
    });
    mkdirSync(join(target.definition.artifactPath, 'schemas', 'operations'), { recursive: true });
    writeFileSync(join(target.definition.artifactPath, 'schemas', 'operations', 'compose-input.json'), JSON.stringify({
      type: 'object', required: ['filter'], properties: { filter: { type: 'string' } }, additionalProperties: false,
    }));
    writeFileSync(join(target.definition.artifactPath, 'schemas', 'operations', 'compose-output.json'), JSON.stringify({
      type: 'object', required: ['fromApp'], properties: { fromApp: { type: 'boolean' } }, additionalProperties: false,
    }));
    target.definition.packageSchemaVersion = 2;
    target.definition.packageKind = 'addon';
    target.definition.grantedCapabilities = ['apps.invoke'];
    target.definition.operations = {
      compose: {
        version: '1.0.0', kind: 'query', consumers: ['self'], connection: 'none', permission: 'view',
        handler: 'compose', requestSchema: target.entrypoint.requestSchema,
        responseSchema: target.entrypoint.responseSchema, timeoutClass: 'short',
        maxRequestBytes: 1024, maxResponseBytes: 65_536,
      },
    };
    const invokeApp = vi.fn(async () => ({ fromApp: true }));

    await expect(executeInstalledOperation(target.definition, target.entrypoint, { filter: 'online' }, {
      config: {}, moduleSlug: target.definition.manifest.slug, path: ['operations', 'compose'], userId: 'member',
      caller: { kind: 'surface', packageId: target.definition.moduleId, surfaceId: 'compose' },
      invokeApp,
      notify: async () => undefined,
    })).resolves.toEqual({ fromApp: true });
    expect(invokeApp).toHaveBeenCalledWith({
      dependency: 'app', operation: 'summary', connectionProfileId: 'connection-profile-1', input: { filter: 'online' },
    });
  }, 20_000);

  it.skipIf(!denoPath)('denies direct network access and recovers on the next invocation', async () => {
    const denied = fixture(`
      export async function run() {
        await fetch('http://127.0.0.1:9/');
        return { reached: true };
      }
    `);
    const deniedResponse = await invoke(denied.definition, denied.entrypoint);
    expect(deniedResponse.status).toBe(502);
    expect(await deniedResponse.json()).toMatchObject({ code: 'MODULE_EXECUTION_FAILED' });

    const healthy = fixture('export async function run() { return { recovered: true }; }');
    const healthyResponse = await invoke(healthy.definition, healthy.entrypoint);
    expect(healthyResponse.status).toBe(200);
    await expect(healthyResponse.json()).resolves.toEqual({ data: { recovered: true } });
  }, 20_000);

  it.skipIf(!denoPath)('never exposes or logs a secret thrown by plugin code', async () => {
    const secret = 'plugin-secret-value-should-never-escape';
    const failing = fixture(`
      export async function run() {
        throw new Error('${secret}');
      }
    `);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await invoke(failing.definition, failing.entrypoint);
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        error: 'Plugin execution failed.',
        code: 'MODULE_EXECUTION_FAILED',
      });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
      expect(consoleError).toHaveBeenCalledWith(
        'Installed Module invocation failed',
        expect.objectContaining({ failureCode: 'MODULE_RUNTIME_FAILURE' }),
      );
    } finally {
      consoleError.mockRestore();
    }
  }, 20_000);

  it.skipIf(!denoPath)('waits for an unawaited Host API call before completing the invocation', async () => {
    const target = fixture(`
      export async function run(_request, host) {
        void host.notifications.emit({
          key: 'runner.event',
          title: 'Runner event',
          body: 'Complete before returning',
          severity: 'info',
        });
        return { complete: true };
      }
    `, { method: 'POST', kind: 'mutation' });
    target.definition.grantedCapabilities = ['notifications.emit'];
    const notificationStarted = deferred();
    const notificationPending = deferred();
    const notify = vi.fn(async () => {
      notificationStarted.resolve();
      await notificationPending.promise;
    });

    let invocationSettled = false;
    const responsePromise = invoke(
      target.definition,
      target.entrypoint,
      new Request('http://nad.test/api/modules/runner/run', {
        method: 'POST',
        body: '{}',
      }),
      { notify },
    );
    void responsePromise.then(() => {
      invocationSettled = true;
    });

    const firstEvent = await Promise.race([
      notificationStarted.promise.then(() => 'notification-started' as const),
      responsePromise.then(() => 'invocation-settled' as const),
    ]);
    expect(firstEvent).toBe('notification-started');
    expect(notify).toHaveBeenCalledOnce();
    expect(invocationSettled).toBe(false);

    notificationPending.resolve();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { complete: true } });
  }, 20_000);

  it.skipIf(!denoPath)('terminates a timed-out process and remains healthy afterwards', async () => {
    const hanging = fixture(`
      export async function run() {
        await new Promise(() => {});
      }
    `);
    const startedAt = Date.now();
    const timedOutResponse = await invoke(hanging.definition, hanging.entrypoint);
    expect(timedOutResponse.status).toBe(502);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(7_000);
    expect(Date.now() - startedAt).toBeLessThan(12_000);
    expect(await timedOutResponse.json()).toMatchObject({
      error: 'Module execution timed out.',
      code: 'MODULE_EXECUTION_FAILED',
    });

    const healthy = fixture('export async function run() { return { recovered: true }; }');
    expect((await invoke(healthy.definition, healthy.entrypoint)).status).toBe(200);
  }, 20_000);

  it.skipIf(!denoPath)('bounds output and enforces per-Module concurrency', async () => {
    const oversized = fixture(
      'export async function run() { return { value: "x".repeat(4096) }; }',
      { maxResponseBytes: 128 },
    );
    const oversizedResponse = await invoke(oversized.definition, oversized.entrypoint);
    expect(oversizedResponse.status).toBe(502);
    expect(await oversizedResponse.json()).toMatchObject({
      error: 'Module response exceeded its limit.',
      code: 'MODULE_EXECUTION_FAILED',
    });

    const noNewline = fixture(`
      await Deno.stdout.write(new Uint8Array(100_000));
      export async function run() { return { unreachable: true }; }
    `, { maxResponseBytes: 128 });
    const noNewlineResponse = await invoke(noNewline.definition, noNewline.entrypoint);
    expect(noNewlineResponse.status).toBe(502);
    expect(await noNewlineResponse.json()).toMatchObject({
      error: 'Module output exceeded its limit.',
      code: 'MODULE_EXECUTION_FAILED',
    });

    const concurrent = fixture(`
      export async function run() {
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { complete: true };
      }
    `);
    const firstFour = Array.from({ length: 4 }, () => invoke(concurrent.definition, concurrent.entrypoint));
    const refused = await invoke(concurrent.definition, concurrent.entrypoint);
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({
      error: 'Module concurrency limit reached.',
      code: 'MODULE_EXECUTION_FAILED',
    });
    const responses = await Promise.all(firstFour);
    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
  }, 20_000);

  it.skipIf(!denoPath)('rejects an oversized streaming request without a Content-Length header', async () => {
    const target = fixture(
      'export async function run(request) { return { received: request.body }; }',
      { method: 'POST', kind: 'mutation', maxRequestBytes: 1024 },
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(768));
        controller.enqueue(new Uint8Array(768));
        controller.close();
      },
    });
    const response = await invoke(
      target.definition,
      target.entrypoint,
      new Request('http://nad.test/api/modules/runner/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'Module request body is too large.',
      code: 'MODULE_EXECUTION_FAILED',
    });
  }, 20_000);
});
