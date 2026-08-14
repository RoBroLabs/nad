import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NADHostAPIV2Call } from '@/lib/modules/contracts/v2';
import { validateContractV2Document } from '@/lib/modules/contracts/validators';
import { rawDb } from '@/lib/db';
import { createInstalledHostApi, InstalledHostApiError } from '@/lib/modules/installed/host-api';
import type { InstalledModuleDefinition } from '@/lib/modules/installed/provider';
import type { ModuleApiContext } from '@/lib/modules/registry-types';
import type { ModuleHttpAccessScope } from '@/lib/modules/types';
import { generateId, now } from '@/lib/utils';

const MAX_HOST_CALLS = 128;
const MAX_DIAGNOSTIC_ROWS = 1_000;

function failure(message: string, code: string): never {
  throw new InstalledHostApiError(message, code);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fieldValue(value: string | undefined, type: unknown): string | number | boolean | undefined {
  if (value === undefined) return undefined;
  if (type === 'number' || type === 'integer') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (type === 'boolean') return value === 'true' ? true : value === 'false' ? false : undefined;
  return value;
}

async function connectionField(
  definition: InstalledModuleDefinition,
  name: string,
): Promise<{ secret: boolean; type: unknown } | undefined> {
  let document: unknown;
  try {
    document = JSON.parse(await readFile(join(definition.artifactPath, 'schemas/connections.json'), 'utf8')) as unknown;
  } catch {
    failure('The App connection schema is unavailable.', 'CONNECTION_SCHEMA_UNAVAILABLE');
  }
  const properties = record(record(document)?.properties);
  const field = properties ? record(properties[name]) : null;
  if (!field) return undefined;
  const metadata = record(field['x-nad']);
  return { secret: metadata?.control === 'secret', type: field.type };
}

function convertedHttpScopes(definition: InstalledModuleDefinition): ModuleHttpAccessScope[] {
  if (definition.packageSchemaVersion !== 2) return [];
  return definition.v2HttpAccess.flatMap((scope) => {
    if (
      typeof scope.scheme !== 'string'
      || typeof scope.hostField !== 'string'
      || typeof scope.path !== 'string'
      || !Array.isArray(scope.methods)
    ) return [];
    const credential = record(scope.credential);
    return [{
      scheme: scope.scheme as 'http' | 'https',
      hostConfig: scope.hostField,
      ...(typeof scope.port === 'number' ? { port: scope.port } : {}),
      ...(typeof scope.portField === 'string' ? { portConfig: scope.portField } : {}),
      path: scope.path,
      methods: scope.methods as Array<'GET' | 'POST' | 'PUT' | 'DELETE'>,
      effect: scope.effect === 'write' ? 'write' : 'read',
      ...(typeof scope.requestBodyPolicy === 'string' ? { requestBodyPolicy: scope.requestBodyPolicy as ModuleHttpAccessScope['requestBodyPolicy'] } : {}),
      ...(Array.isArray(scope.allowedHeaders) ? { allowedHeaders: scope.allowedHeaders as string[] } : {}),
      ...(Array.isArray(scope.queryParameters) ? { queryParameters: scope.queryParameters as string[] } : {}),
      ...(record(scope.pathParameters) ? { pathParameters: scope.pathParameters as Record<string, 'segment' | 'integer'> } : {}),
      ...(credential && typeof credential.field === 'string' && typeof credential.location === 'string' && typeof credential.name === 'string' ? {
        credential: {
          config: credential.field,
          location: credential.location as 'header' | 'query' | 'json-body',
          name: credential.name,
          ...(typeof credential.prefix === 'string' ? { prefix: credential.prefix } : {}),
          ...(typeof credential.publicField === 'string' ? { publicConfig: credential.publicField } : {}),
          ...(typeof credential.separator === 'string' ? { separator: credential.separator } : {}),
        },
      } : {}),
      ...(typeof scope.tlsVerifyField === 'string' ? { tlsVerifyConfig: scope.tlsVerifyField } : {}),
    } satisfies ModuleHttpAccessScope];
  });
}

function scopedRequest(
  definition: InstalledModuleDefinition,
  context: ModuleApiContext,
  call: Extract<NADHostAPIV2Call, { method: 'http.request' }>,
): { method: 'http.request'; params: Record<string, unknown> } {
  const declared = definition.v2HttpAccess.find((scope) => scope.id === call.params.scope);
  if (!declared || typeof declared.hostField !== 'string' || typeof declared.scheme !== 'string' || typeof declared.path !== 'string') {
    failure('http.request references an undeclared scope.', 'HTTP_SCOPE_REFUSED');
  }
  const configuredHost = context.config[declared.hostField];
  if (!configuredHost) failure('http.request scope has no configured host.', 'HTTP_SCOPE_UNCONFIGURED');
  let base: URL;
  try {
    base = new URL(configuredHost.includes('://') ? configuredHost : `${declared.scheme}://${configuredHost}`);
  } catch {
    failure('http.request scope has an invalid configured host.', 'HTTP_SCOPE_UNCONFIGURED');
  }
  if (base.protocol !== `${declared.scheme}:` || base.username || base.password || base.search || base.hash) {
    failure('http.request scope has an invalid configured host.', 'HTTP_SCOPE_UNCONFIGURED');
  }
  let path = declared.path;
  const parameters = record(declared.pathParameters) ?? {};
  for (const [name, kind] of Object.entries(parameters)) {
    const value = call.params.pathParameters?.[name];
    if (value === undefined) failure('http.request is missing a declared path parameter.', 'HTTP_REQUEST_REFUSED');
    const text = String(value);
    if (kind === 'integer' && !/^\d+$/.test(text)) failure('http.request path parameter is invalid.', 'HTTP_REQUEST_REFUSED');
    if (kind !== 'integer' && !/^[A-Za-z0-9_.~-]+$/.test(text)) failure('http.request path parameter is invalid.', 'HTTP_REQUEST_REFUSED');
    path = path.replace(`{${name}}`, encodeURIComponent(text));
  }
  if (/\{[^}]+\}/.test(path)) failure('http.request path parameters are incomplete.', 'HTTP_REQUEST_REFUSED');
  const url = new URL(path, base.origin);
  for (const [key, value] of Object.entries(call.params.query ?? {})) url.searchParams.set(key, value);
  return {
    method: 'http.request',
    params: {
      url: url.toString(),
      method: call.params.method ?? 'GET',
      headers: call.params.headers ?? {},
      ...(call.params.body === undefined ? {} : { body: call.params.body }),
    },
  };
}

function emitDiagnostic(
  definition: InstalledModuleDefinition,
  call: Extract<NADHostAPIV2Call, { method: 'diagnostics.emit' }>,
  correlationId?: string,
): void {
  const message = call.params.message.slice(0, 1_000);
  const code = call.params.code.slice(0, 80);
  const metadata = call.params.metadata ?? {};
  if (!message || !/^[A-Z0-9_.:-]{1,80}$/i.test(code) || Object.keys(metadata).length > 32) {
    failure('Diagnostic event is invalid.', 'INVALID_DIAGNOSTIC');
  }
  const metadataJson = JSON.stringify({ code, ...metadata });
  if (Buffer.byteLength(metadataJson) > 8_192) failure('Diagnostic metadata is too large.', 'INVALID_DIAGNOSTIC');
  rawDb.transaction(() => {
    rawDb.prepare(`
      INSERT INTO module_diagnostics
        (id, module_id, release_id, level, message, metadata_json, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(),
      definition.moduleId,
      definition.releaseId,
      call.params.level === 'warning' ? 'warn' : call.params.level,
      message,
      metadataJson,
      correlationId ?? null,
      now(),
    );
    rawDb.prepare(`
      DELETE FROM module_diagnostics
      WHERE module_id = ? AND id NOT IN (
        SELECT id FROM module_diagnostics
        WHERE module_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
      )
    `).run(definition.moduleId, definition.moduleId, MAX_DIAGNOSTIC_ROWS);
  }).immediate();
}

export function createInstalledHostApiV2(
  definition: InstalledModuleDefinition,
  context: ModuleApiContext,
  operationKind: 'query' | 'mutation',
  signal?: AbortSignal,
): (call: NADHostAPIV2Call) => Promise<unknown> {
  const capabilities = new Set(definition.grantedCapabilities);
  let callCount = 0;
  const v1 = createInstalledHostApi({
    ...definition,
    manifest: { ...definition.manifest, httpAccess: convertedHttpScopes(definition) },
  }, context, operationKind, signal);
  return async (call) => {
    const validation = validateContractV2Document('host-call.v2.schema.json', call);
    if (!validation.valid) failure('Host call does not match the canonical v2 contract.', 'INVALID_HOST_CALL');
    callCount += 1;
    if (callCount > MAX_HOST_CALLS) failure('App exceeded its host-call limit.', 'HOST_CALL_LIMIT');
    if (!capabilities.has(call.method)) failure('App has no approved capability for this host call.', 'CAPABILITY_REFUSED');
    if (signal?.aborted) failure('Host call was cancelled.', 'INVOCATION_ABORTED');

    if (call.method === 'connections.current') {
      return context.connectionProfileId
        ? { id: context.connectionProfileId, name: context.connectionProfileName ?? 'Connection' }
        : null;
    }
    if (call.method === 'connections.get') {
      if (!context.connectionProfileId) failure('This operation has no selected connection.', 'CONNECTION_REQUIRED');
      const field = await connectionField(definition, call.params.name);
      if (!field) failure('connections.get requested an undeclared field.', 'CONNECTION_FIELD_REFUSED');
      const value = context.config[call.params.name];
      return field.secret
        ? { present: Boolean(value), secretRef: value ? `profile/${context.connectionProfileId}/${call.params.name}` : '' }
        : fieldValue(value, field.type);
    }
    if (call.method === 'http.request') {
      const request = scopedRequest(definition, context, call);
      return v1(request as never);
    }
    if (call.method === 'notifications.emit') {
      return v1({
        method: 'notifications.emit',
        params: {
          key: call.params.key,
          title: call.params.title,
          body: call.params.body,
          severity: call.params.severity,
          ...(call.params.dedupeKey ? { dedupeKey: call.params.dedupeKey } : {}),
        },
      });
    }
    if (call.method === 'storage.get' || call.method === 'storage.delete') return v1(call);
    if (call.method === 'storage.set') return v1(call);
    if (call.method === 'audit.annotate') return v1(call);
    if (call.method === 'diagnostics.emit') {
      emitDiagnostic(definition, call, context.correlationId);
      return { accepted: true };
    }
    if (call.method === 'apps.invoke') {
      if (definition.packageKind !== 'addon' || !context.invokeApp) {
        failure('apps.invoke is available only to a declared Add-on dependency.', 'APP_OPERATION_REFUSED');
      }
      return context.invokeApp(call.params);
    }
    failure('The requested v2 Host API capability is unavailable.', 'CAPABILITY_UNAVAILABLE');
  };
}
