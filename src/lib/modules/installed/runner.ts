import 'server-only';

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModuleHostCallDocument, ModuleInvocationRequestDocument } from '@/lib/modules/contracts/v1';
import type {
  NADHostAPIV2Call,
  NADHostAPIV2OperationInvocation,
} from '@/lib/modules/contracts/v2';
import { validateContractDocument, validateContractV2Document } from '@/lib/modules/contracts/validators';
import { readBodyBytes, RequestBodyTooLargeError } from '@/lib/http';
import type { InstalledModuleDefinition } from '@/lib/modules/installed/provider';
import { assertJsonSchema } from '@/lib/modules/installed/json-schema';
import {
  createInstalledHostApi,
  InstalledHostApiError,
} from '@/lib/modules/installed/host-api';
import { createInstalledHostApiV2 } from '@/lib/modules/installed/host-api-v2';
import type { ModuleApiContext, ModuleApiHandler } from '@/lib/modules/registry-types';
import type { ModuleEntrypoint } from '@/lib/modules/types';

const RPC_PREFIX = 'NAD_RPC:';
const MAX_DIAGNOSTIC_BYTES = 32_768;
const MAX_MODULE_CONCURRENCY = 4;
const MAX_GLOBAL_CONCURRENCY = 32;
const activeInvocations = new Map<string, number>();
let totalActiveInvocations = 0;

type InvocationFailureCode =
  | 'BUNDLE_INVALID'
  | 'CONCURRENCY_LIMIT'
  | 'GLOBAL_CONCURRENCY_LIMIT'
  | 'INVALID_REQUEST'
  | 'MODULE_OUTPUT_LIMIT'
  | 'MODULE_RESPONSE_LIMIT'
  | 'MODULE_RUNTIME_FAILURE'
  | 'MODULE_TIMEOUT'
  | 'REQUEST_BODY_LIMIT'
  | 'REQUEST_SCHEMA_INVALID'
  | 'RESPONSE_SCHEMA_INVALID'
  | 'RUNTIME_UNAVAILABLE';

class InstalledModuleInvocationError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly failureCode: InvocationFailureCode,
    public readonly status = 502,
    public readonly responseCode = 'MODULE_EXECUTION_FAILED',
  ) {
    super(failureCode);
    this.name = 'InstalledModuleInvocationError';
  }
}

function invocationFailure(
  publicMessage: string,
  failureCode: InvocationFailureCode,
  status = 502,
  responseCode = 'MODULE_EXECUTION_FAILED',
): InstalledModuleInvocationError {
  return new InstalledModuleInvocationError(publicMessage, failureCode, status, responseCode);
}

function classifyInvocationFailure(error: unknown): InstalledModuleInvocationError {
  if (error instanceof InstalledModuleInvocationError) return error;
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return invocationFailure(
      'The installed plugin runtime is unavailable.',
      'RUNTIME_UNAVAILABLE',
      503,
      'RUNTIME_UNAVAILABLE',
    );
  }
  return invocationFailure('Plugin execution failed.', 'MODULE_RUNTIME_FAILURE');
}

function timeoutMilliseconds(timeoutClass: ModuleEntrypoint['timeoutClass']): number {
  if (timeoutClass === 'action') return 30_000;
  if (timeoutClass === 'standard') return 15_000;
  return 7_500;
}

export function createInstalledRuntimeEnvironment(scratch: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DENO_DIR: scratch,
    DENO_NO_UPDATE_CHECK: '1',
    DENO_NO_PROMPT: '1',
    NO_COLOR: '1',
  };
}

function validateBundle(source: string, handlers: string[]): void {
  if (Buffer.byteLength(source) > 5 * 1024 * 1024) {
    throw invocationFailure('Plugin server bundle exceeds the runtime limit.', 'BUNDLE_INVALID');
  }
  const forbidden = [
    /(?:^|\n)\s*import\s/m,
    /\bimport\s*\(/,
    /\brequire\s*\(/,
    /\bprocess\s*\./,
    /\bBun\s*\./,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    throw invocationFailure('Plugin server bundle contains a forbidden runtime import or global.', 'BUNDLE_INVALID');
  }
  for (const handler of handlers) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(handler)) {
      throw invocationFailure('Plugin handler name is invalid.', 'BUNDLE_INVALID');
    }
  }
}

function runtimeHarness(handlers: string[], hostApiVersion: 1 | 2): string {
  const handlerEntries = handlers.map((handler) => `${JSON.stringify(handler)}: ${handler}`).join(',');
  return `
const __nadHandlers = {${handlerEntries}};
const __nadEncoder = new TextEncoder();
const __nadReader = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader();
let __nadBuffer = '';
let __nadCallId = 0;
const __nadPending = new Map();
let __nadWriteQueue = Promise.resolve();
async function __nadReadLine() {
  while (true) {
    const newline = __nadBuffer.indexOf('\\n');
    if (newline >= 0) {
      const line = __nadBuffer.slice(0, newline);
      __nadBuffer = __nadBuffer.slice(newline + 1);
      return line;
    }
    const next = await __nadReader.read();
    if (next.done) return __nadBuffer || null;
    __nadBuffer += next.value;
    if (__nadBuffer.length > 1048576) throw new Error('RPC input exceeded limit');
  }
}
function __nadWrite(message) {
  const data = __nadEncoder.encode('${RPC_PREFIX}' + JSON.stringify(message) + '\\n');
  __nadWriteQueue = __nadWriteQueue.then(() => Deno.stdout.write(data));
  return __nadWriteQueue;
}
async function __nadHostCall(method, params) {
  const id = String(++__nadCallId);
  const pending = new Promise((resolve, reject) => __nadPending.set(id, { resolve, reject }));
  await __nadWrite({ type: 'hostCall', id, method, params });
  return pending;
}
const __nadHost = {
  ${hostApiVersion === 1 ? "config: { get: (name) => __nadHostCall('config.get', { name }) }," : `
  connections: {
    current: () => __nadHostCall('connections.current', {}),
    get: (name) => __nadHostCall('connections.get', { name }),
  },`}
  http: { request: (request) => __nadHostCall('http.request', request) },
  notifications: { emit: (event) => __nadHostCall('notifications.emit', event) },
  storage: {
    get: (key) => __nadHostCall('storage.get', { key }),
    set: (key, value) => __nadHostCall('storage.set', { key, value }),
    delete: (key) => __nadHostCall('storage.delete', { key }),
  },
  audit: { annotate: (metadata) => __nadHostCall('audit.annotate', metadata) },
  ${hostApiVersion === 2 ? `
  diagnostics: { emit: (event) => __nadHostCall('diagnostics.emit', event) },
  apps: { invoke: (request) => __nadHostCall('apps.invoke', request) },` : ''}
};
const __nadInvocation = JSON.parse(await __nadReadLine());
(async () => {
  while (true) {
    const line = await __nadReadLine();
    if (line === null) return;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.type !== 'hostResult' || !__nadPending.has(message.id)) continue;
    const pending = __nadPending.get(message.id);
    __nadPending.delete(message.id);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(new Error(message.error || 'Host call failed'));
  }
})().catch((error) => {
  for (const pending of __nadPending.values()) pending.reject(error);
  __nadPending.clear();
});
try {
  const handler = __nadHandlers[__nadInvocation.handler];
  if (!handler) throw new Error('Unknown Module handler');
  const data = await handler(__nadInvocation.request, __nadHost);
  await __nadWrite({ type: 'result', ok: true, data });
} catch (error) {
  await __nadWrite({ type: 'result', ok: false });
}
`;
}

async function requestInput(request: Request, maximumBytes: number): Promise<ModuleInvocationRequestDocument> {
  const method = request.method;
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    throw invocationFailure('Module request method is not supported.', 'INVALID_REQUEST');
  }
  if (method === 'GET' || method === 'DELETE') return { method };
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw invocationFailure('Module request body is too large.', 'REQUEST_BODY_LIMIT');
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await readBodyBytes(
      request.body,
      maximumBytes,
      'Module request body is too large.',
    ));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw invocationFailure('Module request body is too large.', 'REQUEST_BODY_LIMIT');
    }
    throw error;
  }
  if (!buffer.length) return { method };
  try {
    return { method, body: JSON.parse(buffer.toString('utf8')) as unknown };
  } catch {
    throw invocationFailure('Module request body must be valid JSON.', 'INVALID_REQUEST');
  }
}

async function executeInstalledModule(
  definition: InstalledModuleDefinition,
  entrypoint: ModuleEntrypoint,
  request: Request,
  context: ModuleApiContext,
  invocationOverride?: NADHostAPIV2OperationInvocation,
): Promise<unknown> {
  const current = activeInvocations.get(definition.moduleId) ?? 0;
  if (current >= MAX_MODULE_CONCURRENCY) {
    throw invocationFailure('Module concurrency limit reached.', 'CONCURRENCY_LIMIT');
  }
  if (totalActiveInvocations >= MAX_GLOBAL_CONCURRENCY) {
    throw invocationFailure('Global Module concurrency limit reached.', 'GLOBAL_CONCURRENCY_LIMIT');
  }
  activeInvocations.set(definition.moduleId, current + 1);
  totalActiveInvocations += 1;
  let scratch: string | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  const invocationController = new AbortController();
  const pendingHostCalls = new Set<Promise<void>>();
  const waitForHostCalls = async (): Promise<void> => {
    while (pendingHostCalls.size > 0) {
      await Promise.all([...pendingHostCalls]);
    }
  };
  try {
    scratch = await mkdtemp(join(tmpdir(), 'nad-module-'));
    const source = await readFile(join(definition.artifactPath, 'server/main.js'), 'utf8');
    const handlers = definition.packageSchemaVersion >= 2
      ? [...new Set(Object.values(definition.operations).flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const handler = (value as Record<string, unknown>).handler;
          return typeof handler === 'string' ? [handler] : [];
        }))]
      : Object.values(definition.manifest.entrypoints ?? {}).map(({ handler }) => handler);
    if (!handlers.includes(entrypoint.handler)) handlers.push(entrypoint.handler);
    validateBundle(source, handlers);
    const wrapperPath = join(scratch, 'module-runtime.js');
    const hostApiVersion = definition.packageSchemaVersion >= 2 ? 2 : 1;
    await writeFile(wrapperPath, `${source}\n${runtimeHarness(handlers, hostApiVersion)}\n`, { mode: 0o600, flag: 'wx' });
    const input = invocationOverride ?? await requestInput(request, entrypoint.maxRequestBytes);
    if (invocationOverride) {
      const validation = validateContractV2Document('invocation-request.v2.schema.json', invocationOverride);
      if (!validation.valid) {
        throw invocationFailure('App invocation did not match Host API v2.', 'INVALID_REQUEST');
      }
    }
    if (entrypoint.requestSchema) {
      const schema = JSON.parse(await readFile(join(definition.artifactPath, entrypoint.requestSchema), 'utf8')) as unknown;
      try {
        assertJsonSchema(input.body ?? {}, schema, 'request');
      } catch {
        throw invocationFailure('Module request did not match its schema.', 'REQUEST_SCHEMA_INVALID');
      }
    }
    const deno = process.env.NAD_DENO_PATH ?? 'deno';
    const spawned = spawn(deno, [
      'run',
      '--no-config',
      '--no-lock',
      '--no-prompt',
      '--cached-only',
      `--allow-read=${wrapperPath}`,
      '--deny-write',
      '--deny-net',
      '--deny-env',
      '--deny-run',
      '--deny-sys',
      '--deny-ffi',
      '--deny-import',
      wrapperPath,
    ], {
      cwd: scratch,
      env: createInstalledRuntimeEnvironment(scratch),
      stdio: ['pipe', 'pipe', 'pipe'] as const,
    });
    child = spawned;
    spawned.stdin.on('error', () => {
      // The process failure is classified by the protocol promise.
    });
    const processFailure = new Promise<never>((_resolve, reject) => {
      spawned.once('error', reject);
    });
    spawned.stdin.write(`${JSON.stringify({ type: 'invoke', handler: entrypoint.handler, request: input })}\n`);

    let diagnosticBytes = 0;
    let diagnosticLimitExceeded = false;
    spawned.stderr.on('data', (chunk: Buffer) => {
      diagnosticBytes += chunk.length;
      if (diagnosticBytes > MAX_DIAGNOSTIC_BYTES) {
        diagnosticLimitExceeded = true;
        spawned.kill('SIGKILL');
      }
    });
    const hostApi = hostApiVersion === 2
      ? createInstalledHostApiV2(definition, context, entrypoint.kind, invocationController.signal)
      : createInstalledHostApi(definition, context, entrypoint.kind, invocationController.signal);

    const launchHostCall = (id: string, method: string, params: unknown): void => {
      const task = (async () => {
        let message: Record<string, unknown>;
        try {
          const callCandidate = { method, params };
          if (hostApiVersion === 1) {
            const validation = validateContractDocument('host-call.schema.json', callCandidate);
            if (!validation.valid) {
              throw new InstalledHostApiError(
                'Host call does not match the canonical contract.',
                'INVALID_HOST_CALL',
              );
            }
          }
          const data = hostApiVersion === 2
            ? await (hostApi as (call: NADHostAPIV2Call) => Promise<unknown>)(callCandidate as NADHostAPIV2Call)
            : await (hostApi as (call: ModuleHostCallDocument) => Promise<unknown>)(callCandidate as ModuleHostCallDocument);
          message = { type: 'hostResult', id, ok: true, data };
        } catch (error) {
          message = {
            type: 'hostResult',
            id,
            ok: false,
            error: error instanceof InstalledHostApiError ? error.message : 'Host call failed.',
          };
        }
        if (!spawned.stdin.destroyed && spawned.stdin.writable) {
          try {
            spawned.stdin.write(`${JSON.stringify(message)}\n`);
          } catch {
            // The child process is already unavailable; no error detail is retained.
          }
        }
      })().catch(() => {
        // Host transport failures are contained within this invocation.
      });
      pendingHostCalls.add(task);
      void task.then(() => pendingHostCalls.delete(task));
    };

    const readProtocol = (async () => {
      let stdoutBytes = 0;
      let pending = Buffer.alloc(0);
      const outputLimit = entrypoint.maxResponseBytes + 65_536;
      for await (const rawChunk of spawned.stdout) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        stdoutBytes += chunk.length;
        if (stdoutBytes > outputLimit) {
          spawned.kill('SIGKILL');
          throw invocationFailure('Module output exceeded its limit.', 'MODULE_OUTPUT_LIMIT');
        }
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let newlineIndex = pending.indexOf(0x0a);
        while (newlineIndex >= 0) {
          const line = pending.subarray(0, newlineIndex).toString('utf8');
          pending = pending.subarray(newlineIndex + 1);
          if (line.startsWith(RPC_PREFIX)) {
            const message = JSON.parse(line.slice(RPC_PREFIX.length)) as unknown;
            if (message && typeof message === 'object' && !Array.isArray(message)) {
              const rpc = message as Record<string, unknown>;
              if (rpc.type === 'hostCall' && typeof rpc.id === 'string' && typeof rpc.method === 'string') {
                launchHostCall(rpc.id, rpc.method, rpc.params);
              } else if (rpc.type === 'result') {
                if (rpc.ok !== true) {
                  throw invocationFailure('Plugin execution failed.', 'MODULE_RUNTIME_FAILURE');
                }
                await waitForHostCalls();
                return rpc.data;
              }
            }
          }
          newlineIndex = pending.indexOf(0x0a);
        }
      }
      if (diagnosticLimitExceeded) {
        throw invocationFailure('Module diagnostic output exceeded its limit.', 'MODULE_OUTPUT_LIMIT');
      }
      throw invocationFailure('Plugin execution failed.', 'MODULE_RUNTIME_FAILURE');
    })();
    const protocol = Promise.race([readProtocol, processFailure]);
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(
        invocationFailure('Module execution timed out.', 'MODULE_TIMEOUT'),
      ), timeoutMilliseconds(entrypoint.timeoutClass));
      timeoutHandle.unref();
    });
    let result: unknown;
    try {
      result = await Promise.race([protocol, timeout]);
    } catch (error) {
      invocationController.abort();
      spawned.kill('SIGKILL');
      await waitForHostCalls();
      throw error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    const serialized = JSON.stringify(result);
    if (serialized === undefined) {
      throw invocationFailure('Plugin response is invalid.', 'MODULE_RUNTIME_FAILURE');
    }
    const encoded = Buffer.from(serialized);
    if (encoded.length > entrypoint.maxResponseBytes) {
      throw invocationFailure('Module response exceeded its limit.', 'MODULE_RESPONSE_LIMIT');
    }
    if (entrypoint.responseSchema) {
      const schema = JSON.parse(await readFile(join(definition.artifactPath, entrypoint.responseSchema), 'utf8')) as unknown;
      try {
        assertJsonSchema(result, schema, 'response');
      } catch {
        throw invocationFailure('Plugin response did not match its schema.', 'RESPONSE_SCHEMA_INVALID');
      }
    }
    return result;
  } finally {
    invocationController.abort();
    child?.kill('SIGKILL');
    await waitForHostCalls();
    if (scratch) await rm(scratch, { recursive: true, force: true });
    const remaining = (activeInvocations.get(definition.moduleId) ?? 1) - 1;
    if (remaining > 0) activeInvocations.set(definition.moduleId, remaining);
    else activeInvocations.delete(definition.moduleId);
    totalActiveInvocations = Math.max(0, totalActiveInvocations - 1);
  }
}

/** Execute a signed v2 App operation through the same isolated Deno boundary. */
export async function executeInstalledOperation(
  definition: InstalledModuleDefinition,
  entrypoint: ModuleEntrypoint,
  input: unknown,
  context: ModuleApiContext,
): Promise<unknown> {
  const serialized = JSON.stringify(input ?? {});
  const request = new Request('http://nad.internal/api/apps/operations', {
    method: entrypoint.method,
    headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(serialized)) },
    body: serialized,
  });
  const invocation: NADHostAPIV2OperationInvocation = {
    operation: context.path.at(-1) ?? entrypoint.handler,
    body: input ?? {},
    context: {
      connectionProfile: context.connectionProfileId
        ? { id: context.connectionProfileId, name: context.connectionProfileName ?? 'Connection' }
        : null,
      caller: context.caller ?? { kind: 'core', packageId: 'dev.robrolabs.nad-core' },
    },
  };
  return executeInstalledModule(definition, entrypoint, request, context, invocation);
}

export function createInstalledModuleHandler(
  definition: InstalledModuleDefinition,
  entrypoint: ModuleEntrypoint,
): ModuleApiHandler {
  return async (request, context) => {
    if (request.method !== entrypoint.method) {
      return Response.json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    }
    try {
      const data = await executeInstalledModule(definition, entrypoint, request, context);
      return Response.json({ data });
    } catch (error) {
      const failure = classifyInvocationFailure(error);
      console.error('Installed Module invocation failed', {
        moduleId: definition.moduleId,
        releaseId: definition.releaseId,
        endpoint: entrypoint.handler,
        failureCode: failure.failureCode,
      });
      return Response.json({
        error: failure.publicMessage,
        code: failure.responseCode,
      }, { status: failure.status });
    }
  };
}
