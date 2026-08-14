import 'server-only';

import { Agent } from 'undici';
import type { ModuleHostCallDocument, ModuleHostHttpResponse } from '@/lib/modules/contracts/v1';
import { validateContractDocument } from '@/lib/modules/contracts/validators';
import { logAuditEvent } from '@/lib/db/audit';
import type { InstalledModuleDefinition } from '@/lib/modules/installed/provider';
import {
  deleteModuleStorageValue,
  getModuleStorageValue,
  setModuleStorageValue,
} from '@/lib/modules/installed/storage';
import type { ModuleApiContext } from '@/lib/modules/registry-types';

const MAX_HOST_RESPONSE_BYTES = 1_048_576;
const packageControlledForbiddenHeaders = new Set([
  'authorization', 'connection', 'content-length', 'cookie', 'expect', 'forwarded',
  'host', 'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'trailer',
  'transfer-encoding', 'upgrade', 'via', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-real-ip',
]);
const injectedForbiddenHeaders = new Set([
  'connection', 'content-length', 'cookie', 'expect', 'forwarded', 'host',
  'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'trailer',
  'transfer-encoding', 'upgrade', 'via', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-real-ip',
]);
const MAX_HOST_CALLS = 128;
const SAFE_STORAGE_FAILURES = new Map<string, string>([
  ['storage key must be a string.', 'INVALID_STORAGE_REQUEST'],
  ['storage key must be 1-128 safe namespace characters.', 'INVALID_STORAGE_REQUEST'],
  ['storage key is too large.', 'STORAGE_QUOTA'],
  ['storage value must be JSON serialisable.', 'INVALID_STORAGE_REQUEST'],
  ['storage value exceeds the per-entry quota.', 'STORAGE_QUOTA'],
  ['storage generation is no longer active for this Module release.', 'STORAGE_RELEASE_INACTIVE'],
  ['storage generation is unavailable for this Module release.', 'STORAGE_UNAVAILABLE'],
  ['storage generation does not exist.', 'STORAGE_UNAVAILABLE'],
  ['storage generation exceeds its quota.', 'STORAGE_QUOTA'],
]);

export class InstalledHostApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'InstalledHostApiError';
  }
}

function hostApiFailure(message: string, code: string): never {
  throw new InstalledHostApiError(message, code);
}

function assertInvocationActive(signal?: AbortSignal): void {
  if (signal?.aborted) hostApiFailure('Host call was cancelled.', 'INVOCATION_ABORTED');
}

function runStorageCall<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = SAFE_STORAGE_FAILURES.get(message);
    if (code) hostApiFailure(message, code);
    hostApiFailure('Module storage call failed.', 'STORAGE_FAILED');
  }
}

interface HttpRequestValue {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  body?: unknown;
}

interface ApprovedHttpScope {
  scheme: 'http:' | 'https:';
  hostname: string;
  port: number;
  pathPattern: RegExp;
  effect: 'read' | 'write';
  requestBodyPolicy?: 'graphql-query' | 'credential-only' | 'session-cleanup';
  methods: Set<HttpRequestValue['method']>;
  allowedHeaders: Set<string>;
  queryParameters: Set<string>;
  credential?: {
    value: string;
    redactions: string[];
    location: 'header' | 'query' | 'json-body';
    name: string;
  };
  verifyTls: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configValue(definition: InstalledModuleDefinition, config: Record<string, string>, key: string): string {
  const configured = config[key];
  if (configured !== undefined && configured !== '') return configured;
  const fallback = definition.manifest.configSchema.find((field) => field.key === key)?.defaultValue;
  return fallback === undefined ? '' : String(fallback);
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

function pathPattern(path: string, parameters: Record<string, 'segment' | 'integer'> | undefined): RegExp {
  let cursor = 0;
  let source = '^';
  const placeholder = /\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g;
  for (const match of path.matchAll(placeholder)) {
    const start = match.index;
    const name = match[1];
    if (start === undefined || name === undefined) continue;
    source += path.slice(cursor, start).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    source += parameters?.[name] === 'integer' ? '[0-9]+' : '[A-Za-z0-9_.~-]+';
    cursor = start + match[0].length;
  }
  source += path.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${source}$`);
}

function credentialValue(
  definition: InstalledModuleDefinition,
  config: Record<string, string>,
  credential: NonNullable<NonNullable<InstalledModuleDefinition['manifest']['httpAccess']>[number]['credential']>,
): string {
  const secret = configValue(definition, config, credential.config);
  if (!secret) return '';
  const publicValue = credential.publicConfig
    ? configValue(definition, config, credential.publicConfig)
    : '';
  if (credential.publicConfig && !publicValue) return '';
  return `${credential.prefix ?? ''}${publicValue}${publicValue ? credential.separator ?? '' : ''}${secret}`;
}

function approvedHttpScopes(
  definition: InstalledModuleDefinition,
  config: Record<string, string>,
): ApprovedHttpScope[] {
  const result: ApprovedHttpScope[] = [];
  for (const scope of definition.manifest.httpAccess ?? []) {
    const hosts = configValue(definition, config, scope.hostConfig);
    if (scope.allowedHeaders?.some((name) => packageControlledForbiddenHeaders.has(name.toLowerCase()))) continue;
    if (
      scope.credential?.location === 'header'
      && injectedForbiddenHeaders.has(scope.credential.name.toLowerCase())
    ) continue;
    for (const rawEntry of hosts.split(',')) {
      const candidate = (rawEntry.split('|')[1] ?? rawEntry).trim();
      if (!candidate || candidate.length > 512) continue;
      try {
        const url = new URL(candidate.includes('://') ? candidate : `${scope.scheme}://${candidate}`);
        if (!url.hostname || url.username || url.password || url.search || url.hash) continue;
        if (url.protocol !== `${scope.scheme}:`) continue;
        const rawPort = scope.portConfig
          ? configValue(definition, config, scope.portConfig)
          : scope.port === undefined
            ? String(url.port || defaultPort(url.protocol))
            : String(scope.port);
        const port = Number(rawPort);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) continue;
        const allowedHeaders = new Set(['accept', 'content-type']);
        for (const header of scope.allowedHeaders ?? []) allowedHeaders.add(header.toLowerCase());
        const credential = scope.credential
          ? {
              value: credentialValue(definition, config, scope.credential),
              redactions: [
                credentialValue(definition, config, scope.credential),
                configValue(definition, config, scope.credential.config),
              ].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index),
              location: scope.credential.location,
              name: scope.credential.name,
            }
          : undefined;
        result.push({
          scheme: `${scope.scheme}:`,
          hostname: url.hostname.toLowerCase(),
          port,
          pathPattern: pathPattern(scope.path, scope.pathParameters),
          effect: scope.effect ?? (scope.methods.every((method) => method === 'GET') ? 'read' : 'write'),
          ...(scope.requestBodyPolicy ? { requestBodyPolicy: scope.requestBodyPolicy } : {}),
          methods: new Set(scope.methods),
          allowedHeaders,
          queryParameters: new Set(scope.queryParameters ?? []),
          ...(credential ? { credential } : {}),
          verifyTls: scope.tlsVerifyConfig
            ? configValue(definition, config, scope.tlsVerifyConfig) !== 'false'
            : true,
        });
      } catch {
        // Invalid candidates remain unusable; config validation reports them.
      }
    }
  }
  return result;
}

function requestPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

function approvedHttpScope(request: HttpRequestValue, scopes: ApprovedHttpScope[]): ApprovedHttpScope | undefined {
  const url = new URL(request.url);
  const port = requestPort(url);
  return scopes.find((scope) => (
    scope.scheme === url.protocol
    && scope.hostname === url.hostname.toLowerCase()
    && scope.port === port
    && scope.pathPattern.test(url.pathname)
    && scope.methods.has(request.method)
    && [...url.searchParams.keys()].every((name) => scope.queryParameters.has(name))
    && Object.keys(request.headers).every((name) => scope.allowedHeaders.has(name.toLowerCase()))
    && !(scope.credential?.location === 'header'
      && Object.keys(request.headers).some((name) => name.toLowerCase() === scope.credential?.name.toLowerCase()))
    && !(scope.credential?.location === 'query' && url.searchParams.has(scope.credential.name))
  ));
}

function parseHttpRequest(value: unknown): HttpRequestValue {
  const result = validateContractDocument('host-call.schema.json', { method: 'http.request', params: value });
  if (!result.valid) {
    hostApiFailure('http.request requires a bounded URL.', 'INVALID_HTTP_REQUEST');
  }
  const request = value as Extract<ModuleHostCallDocument, { method: 'http.request' }>['params'];
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    hostApiFailure('http.request URL is invalid.', 'INVALID_HTTP_REQUEST');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hash) {
    hostApiFailure('http.request URL is not allowed.', 'HTTP_REQUEST_REFUSED');
  }
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    hostApiFailure('http.request method is not allowed.', 'HTTP_REQUEST_REFUSED');
  }
  const headers: Record<string, string> = {};
  if (request.headers !== undefined) {
    if (!isRecord(request.headers)) hostApiFailure('http.request headers are invalid.', 'INVALID_HTTP_REQUEST');
    for (const [name, headerValue] of Object.entries(request.headers)) {
      if (typeof headerValue !== 'string' || headerValue.length > 512) {
        hostApiFailure('http.request header value is invalid.', 'INVALID_HTTP_REQUEST');
      }
      headers[name] = headerValue;
    }
  }
  return { url: url.toString(), method, headers, body: request.body };
}

function injectCredential(request: HttpRequestValue, scope: ApprovedHttpScope): HttpRequestValue {
  const credential = scope.credential;
  if (!credential) return request;
  if (!credential.value) hostApiFailure('The approved upstream credential is not configured.', 'UPSTREAM_CREDENTIAL_MISSING');
  const url = new URL(request.url);
  const headers = { ...request.headers };
  let body = request.body;
  if (credential.location === 'header') {
    headers[credential.name] = credential.value;
  } else if (credential.location === 'query') {
    url.searchParams.set(credential.name, credential.value);
  } else {
    if (!isRecord(body)) hostApiFailure('Credential-bound JSON requests require an object body.', 'INVALID_HTTP_REQUEST');
    if (Object.hasOwn(body, credential.name)) {
      hostApiFailure('Module code may not override a broker-injected credential.', 'HTTP_REQUEST_REFUSED');
    }
    body = { ...body, [credential.name]: credential.value };
  }
  return { ...request, url: url.toString(), headers, body };
}

function assertRequestBodyPolicy(request: HttpRequestValue, scope: ApprovedHttpScope): void {
  if (!scope.requestBodyPolicy) return;
  if (scope.requestBodyPolicy === 'session-cleanup') {
    if (request.body !== undefined) hostApiFailure('Session cleanup requests must not contain a body.', 'HTTP_REQUEST_REFUSED');
    return;
  }
  if (scope.requestBodyPolicy === 'credential-only') {
    if (!isRecord(request.body) || Object.keys(request.body).length !== 0) {
      hostApiFailure('Credential-only requests may not supply package-controlled body fields.', 'HTTP_REQUEST_REFUSED');
    }
    return;
  }
  if (!isRecord(request.body)) {
    hostApiFailure('GraphQL query requests require an object body.', 'INVALID_HTTP_REQUEST');
  }
  const bodyKeys = Object.keys(request.body);
  if (bodyKeys.some((key) => key !== 'query' && key !== 'variables' && key !== 'operationName')) {
    hostApiFailure('GraphQL request body contains an unapproved field.', 'HTTP_REQUEST_REFUSED');
  }
  if (typeof request.body.query !== 'string' || request.body.query.length > 32_768) {
    hostApiFailure('GraphQL query document is invalid.', 'INVALID_HTTP_REQUEST');
  }
  const withoutComments = request.body.query.replace(/#[^\r\n]*/g, ' ');
  if (/\bmutation\b/i.test(withoutComments) || /\bsubscription\b/i.test(withoutComments)) {
    hostApiFailure('Read-effect GraphQL scopes allow query operations only.', 'QUERY_SIDE_EFFECT_REFUSED');
  }
  if (request.body.variables !== undefined && !isRecord(request.body.variables)) {
    hostApiFailure('GraphQL variables must be an object.', 'INVALID_HTTP_REQUEST');
  }
  if (request.body.operationName !== undefined && typeof request.body.operationName !== 'string') {
    hostApiFailure('GraphQL operationName must be a string.', 'INVALID_HTTP_REQUEST');
  }
}

function redactInjectedCredential(text: string, scope: ApprovedHttpScope): string {
  const values = scope.credential?.redactions ?? [];
  let redacted = text;
  for (const value of values) {
    const encoded = JSON.stringify(value).slice(1, -1);
    redacted = redacted.split(value).join('[redacted]');
    if (encoded !== value) redacted = redacted.split(encoded).join('[redacted]');
  }
  return redacted;
}

function safeAuditMetadata(value: unknown): Record<string, unknown> {
  const result = validateContractDocument('host-call.schema.json', { method: 'audit.annotate', params: value });
  if (!result.valid) hostApiFailure('audit.annotate metadata is invalid.', 'INVALID_AUDIT_ANNOTATION');
  if (!isRecord(value)) hostApiFailure('audit.annotate metadata must be an object.', 'INVALID_AUDIT_ANNOTATION');
  const entries = Object.entries(value);
  if (entries.length > 16) hostApiFailure('audit.annotate metadata has too many fields.', 'INVALID_AUDIT_ANNOTATION');
  const safe: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key)) {
      hostApiFailure('audit.annotate metadata key is invalid.', 'INVALID_AUDIT_ANNOTATION');
    }
    if (typeof entryValue === 'string') {
      safe[key] = entryValue.slice(0, 500);
    } else if (
      typeof entryValue === 'number'
      || typeof entryValue === 'boolean'
      || entryValue === null
    ) {
      safe[key] = entryValue;
    } else {
      hostApiFailure('audit.annotate metadata values must be primitive.', 'INVALID_AUDIT_ANNOTATION');
    }
  }
  return safe;
}

async function readBoundedResponse(response: Response, maximum: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    hostApiFailure('Upstream response is too large.', 'UPSTREAM_RESPONSE_TOO_LARGE');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      hostApiFailure('Upstream response is too large.', 'UPSTREAM_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export const implementedModuleHostCapabilities = [
  'config.get',
  'http.request',
  'notifications.emit',
  'storage.get',
  'storage.set',
  'storage.delete',
  'audit.annotate',
] as const satisfies readonly ModuleHostCallDocument['method'][];

export function createInstalledHostApi(
  definition: InstalledModuleDefinition,
  context: ModuleApiContext,
  endpointKind: 'query' | 'mutation',
  signal?: AbortSignal,
): (call: ModuleHostCallDocument) => Promise<unknown> {
  const capabilities = new Set(definition.grantedCapabilities.filter((name): name is typeof implementedModuleHostCapabilities[number] => (
    implementedModuleHostCapabilities.includes(name as typeof implementedModuleHostCapabilities[number])
  )));
  const httpScopes = approvedHttpScopes(definition, context.config);
  let callCount = 0;

  const invoke = async (call: ModuleHostCallDocument): Promise<unknown> => {
    assertInvocationActive(signal);
    callCount += 1;
    if (callCount > MAX_HOST_CALLS) hostApiFailure('Module exceeded its host-call limit.', 'HOST_CALL_LIMIT');
    const method = call.method;
    if (!capabilities.has(method)) hostApiFailure('Module has no approved capability for this host call.', 'CAPABILITY_REFUSED');

    if (method === 'config.get') {
      const field = definition.manifest.configSchema.find(({ key }) => key === call.params.name);
      if (!field) hostApiFailure('config.get requested an undeclared field.', 'CONFIG_FIELD_REFUSED');
      const value = context.config[field.key];
      if (field.type === 'secret') {
        return { present: Boolean(value), secretRef: value ? `secret:${definition.moduleId}:${field.key}` : '' };
      }
      return value;
    }

    if (method === 'http.request') {
      const request = parseHttpRequest(call.params);
      const url = new URL(request.url);
      const scope = approvedHttpScope(request, httpScopes);
      if (!scope) {
        hostApiFailure(
          'http.request target, port, path, or method is not approved by the Module package and configuration.',
          'HTTP_REQUEST_REFUSED',
        );
      }
      if (endpointKind === 'query' && scope.effect !== 'read') {
        hostApiFailure('Read-only endpoints may use only signed read-effect HTTP scopes.', 'QUERY_SIDE_EFFECT_REFUSED');
      }
      assertRequestBodyPolicy(request, scope);
      const approvedRequest = injectCredential(request, scope);
      const body = approvedRequest.body === undefined ? undefined : JSON.stringify(approvedRequest.body);
      if (body && Buffer.byteLength(body) > 65_536) {
        hostApiFailure('http.request body is too large.', 'HTTP_REQUEST_TOO_LARGE');
      }
      const upstreamTimeout = AbortSignal.timeout(5_000);
      const requestSignal = signal ? AbortSignal.any([signal, upstreamTimeout]) : upstreamTimeout;
      const dispatcher = url.protocol === 'https:' && !scope.verifyTls
        ? new Agent({ connect: { rejectUnauthorized: false } })
        : undefined;
      try {
        const response = await fetch(approvedRequest.url, {
          method: approvedRequest.method,
          headers: approvedRequest.headers,
          body,
          redirect: 'manual',
          signal: requestSignal,
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit & { dispatcher?: Agent });
        assertInvocationActive(signal);
        const responseBody = await readBoundedResponse(response, MAX_HOST_RESPONSE_BYTES);
        assertInvocationActive(signal);
        const contentType = response.headers.get('content-type') ?? '';
        const redactedBody = redactInjectedCredential(responseBody.toString('utf8'), scope);
        let decodedBody: unknown = redactedBody;
        if (contentType.includes('application/json') && responseBody.length) {
          try { decodedBody = JSON.parse(redactedBody) as unknown; } catch { /* retain text */ }
        }
        return {
          status: response.status,
          headers: { 'content-type': contentType },
          body: decodedBody,
        } satisfies ModuleHostHttpResponse;
      } catch (error) {
        if (error instanceof InstalledHostApiError) throw error;
        if (signal?.aborted) hostApiFailure('Host call was cancelled.', 'INVOCATION_ABORTED');
        if (upstreamTimeout.aborted) hostApiFailure('Upstream request timed out.', 'UPSTREAM_TIMEOUT');
        hostApiFailure('Upstream request failed.', 'UPSTREAM_REQUEST_FAILED');
      } finally {
        if (dispatcher) await dispatcher.close();
      }
    }

    if (method === 'notifications.emit') {
      if (endpointKind !== 'mutation') {
        hostApiFailure('Read-only endpoints may not emit notifications.', 'QUERY_SIDE_EFFECT_REFUSED');
      }
      const title = call.params.title.slice(0, 160);
      const message = call.params.body.slice(0, 2_000);
      const severity = call.params.severity;
      if (!title || !message) hostApiFailure('notifications.emit requires title and body.', 'INVALID_NOTIFICATION');
      assertInvocationActive(signal);
      await context.notify(title, message, severity);
      assertInvocationActive(signal);
      return { accepted: true };
    }

    if (method === 'storage.get') {
      const kvGenerationId = definition.kvGenerationId;
      if (!kvGenerationId) hostApiFailure('Module storage is unavailable for this release.', 'STORAGE_UNAVAILABLE');
      return runStorageCall(() => getModuleStorageValue({
        moduleId: definition.moduleId,
        releaseId: definition.releaseId,
        kvGenerationId,
      }, call.params.key));
    }

    if (method === 'storage.set') {
      if (endpointKind !== 'mutation') {
        hostApiFailure('Read-only endpoints may not write Module storage.', 'QUERY_SIDE_EFFECT_REFUSED');
      }
      const kvGenerationId = definition.kvGenerationId;
      if (!kvGenerationId) hostApiFailure('Module storage is unavailable for this release.', 'STORAGE_UNAVAILABLE');
      assertInvocationActive(signal);
      runStorageCall(() => setModuleStorageValue({
        moduleId: definition.moduleId,
        releaseId: definition.releaseId,
        kvGenerationId,
      }, call.params.key, call.params.value));
      return { accepted: true };
    }

    if (method === 'storage.delete') {
      if (endpointKind !== 'mutation') {
        hostApiFailure('Read-only endpoints may not write Module storage.', 'QUERY_SIDE_EFFECT_REFUSED');
      }
      const kvGenerationId = definition.kvGenerationId;
      if (!kvGenerationId) hostApiFailure('Module storage is unavailable for this release.', 'STORAGE_UNAVAILABLE');
      assertInvocationActive(signal);
      runStorageCall(() => deleteModuleStorageValue({
        moduleId: definition.moduleId,
        releaseId: definition.releaseId,
        kvGenerationId,
      }, call.params.key));
      return { accepted: true };
    }

    if (method === 'audit.annotate') {
      if (endpointKind !== 'mutation') {
        hostApiFailure('Read-only endpoints may not annotate the audit log.', 'QUERY_SIDE_EFFECT_REFUSED');
      }
      const metadata = safeAuditMetadata(call.params);
      assertInvocationActive(signal);
      await logAuditEvent(context.userId, 'module_audit_annotation', context.moduleSlug, {
        releaseId: definition.releaseId,
        digest: definition.digest,
        endpoint: context.path.join('/'),
        metadata,
      });
      assertInvocationActive(signal);
      return { accepted: true };
    }
    hostApiFailure('The requested capability is not implemented by host API v1.', 'CAPABILITY_UNAVAILABLE');
  };

  return async (call) => {
    const validation = validateContractDocument('host-call.schema.json', call);
    if (!validation.valid) {
      hostApiFailure('Host call does not match the canonical contract.', 'INVALID_HOST_CALL');
    }
    try {
      return await invoke(call);
    } catch (error) {
      if (error instanceof InstalledHostApiError) throw error;
      throw new InstalledHostApiError('Host call failed.', 'HOST_CALL_FAILED');
    }
  };
}
