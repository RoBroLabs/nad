import 'server-only';

import { randomUUID } from 'node:crypto';
import { hasPermission } from '@/lib/auth/permissions';
import { logAuditEvent } from '@/lib/db/audit';
import { rawDb } from '@/lib/db';
import { isReleaseQuarantined } from '@/lib/marketplace/security';
import { readConnectionProfileForInvocation } from '@/lib/modules/connections';
import { beginModuleInvocation } from '@/lib/modules/installed/invocation-guard';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import {
  getAllInstalledModules,
  type InstalledModuleDefinition,
} from '@/lib/modules/installed/provider';
import { executeInstalledOperation } from '@/lib/modules/installed/runner';
import { getSurfaceDefinition } from '@/lib/modules/installed/surfaces';
import { satisfiesCoreRange } from '@/lib/modules/installed/package-verifier';
import { notify } from '@/lib/notifications';
import type { ModuleEntrypoint } from '@/lib/modules/types';

const MAX_BINDING_INPUT_BYTES = 65_536;

interface AddonDependency {
  alias: string;
  appId: string;
  packageVersion: string;
  operations: Record<string, string>;
}

interface AppOperation {
  name: string;
  version: string;
  kind: 'query' | 'mutation';
  consumers: Array<'self' | 'addon'>;
  connection: 'required' | 'optional' | 'none';
  permission: string;
  handler: string;
  requestSchema: string;
  responseSchema: string;
  timeoutClass: 'short' | 'standard' | 'action';
  maxRequestBytes: number;
  maxResponseBytes: number;
  auditAction?: string;
}

export interface InvokeAddonBindingInput {
  addonSlug: string;
  surfaceId: string;
  bindingId: string;
  connectionBindings: Readonly<Record<string, string>>;
  userId: string;
  input: unknown;
}

export interface AddonBindingInvocationResult {
  data: unknown;
  correlationId: string;
  appReleaseId?: string;
  addonReleaseId?: string;
  connectionProfileId?: string;
}

export interface InvokeSurfaceBindingInput {
  moduleSlug: string;
  surfaceId: string;
  bindingId: string;
  connectionBindings: Readonly<Record<string, string>>;
  userId: string;
  input: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safePath(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]{1,220}$/.test(value);
}

function normalizeDependency(value: unknown): AddonDependency | null {
  const item = record(value);
  if (
    !item
    || typeof item.alias !== 'string'
    || !/^[a-z][a-z0-9-]{0,79}$/.test(item.alias)
    || typeof item.appId !== 'string'
    || typeof item.packageVersion !== 'string'
    || !record(item.operations)
  ) return null;
  const operations = item.operations as Record<string, unknown>;
  if (Object.values(operations).some((range) => typeof range !== 'string')) return null;
  return { ...item, operations: operations as Record<string, string> } as AddonDependency;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : fallback;
}

function normalizeOperation(name: string, value: unknown): AppOperation | null {
  const item = record(value);
  if (!item) return null;
  const limits = record(item.limits);
  if (
    !/^[a-z][a-z0-9-]{0,79}$/.test(name)
    || typeof item.version !== 'string'
    || (item.kind !== 'query' && item.kind !== 'mutation')
    || !Array.isArray(item.consumers)
    || item.consumers.some((consumer) => consumer !== 'self' && consumer !== 'addon')
    || (item.connection !== 'required' && item.connection !== 'optional' && item.connection !== 'none')
    || typeof item.permission !== 'string'
    || typeof item.handler !== 'string'
    || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(item.handler)
    || !safePath(item.requestSchema)
    || !safePath(item.responseSchema)
    || (item.timeoutClass !== 'short' && item.timeoutClass !== 'standard' && item.timeoutClass !== 'action')
  ) return null;
  const auditAction = item.kind === 'mutation'
    ? (typeof item.auditAction === 'string' ? item.auditAction : `app.operation.${name}`)
    : undefined;
  return {
    name,
    version: item.version,
    kind: item.kind,
    consumers: [...item.consumers] as Array<'self' | 'addon'>,
    connection: item.connection,
    permission: item.permission,
    handler: item.handler,
    requestSchema: item.requestSchema,
    responseSchema: item.responseSchema,
    timeoutClass: item.timeoutClass,
    maxRequestBytes: integer(item.maxRequestBytes ?? limits?.requestBytes, 65_536, 1, 65_536),
    maxResponseBytes: integer(item.maxResponseBytes ?? limits?.responseBytes, 1_048_576, 1, 1_048_576),
    ...(auditAction ? { auditAction } : {}),
  };
}

function packageById(moduleId: string): InstalledModuleDefinition | undefined {
  return getAllInstalledModules().find((definition) => definition.moduleId === moduleId);
}

function compatibleVersion(version: string, range: string): boolean {
  if (/^\^\d+\.\d+\.\d+$/.test(range)) {
    const base = range.slice(1).split('.').map(Number);
    const parsed = version.split(/[+-]/, 1)[0].split('.').map(Number);
    return parsed.length === 3 && parsed[0] === base[0]
      && (parsed[1] > base[1] || (parsed[1] === base[1] && parsed[2] >= base[2]));
  }
  if (/^~\d+\.\d+\.\d+$/.test(range)) {
    const base = range.slice(1).split('.').map(Number);
    const parsed = version.split(/[+-]/, 1)[0].split('.').map(Number);
    return parsed.length === 3 && parsed[0] === base[0] && parsed[1] === base[1] && parsed[2] >= base[2];
  }
  return satisfiesCoreRange(version, range);
}

function executable(definition: InstalledModuleDefinition, expectedKind: 'app' | 'addon'): boolean {
  return definition.packageSchemaVersion >= 2
    && definition.packageKind === expectedKind
    && definition.enabled
    && definition.lifecycleState === 'active'
    && !isReleaseQuarantined(definition.digest, definition.signerKeyId ?? null);
}

function exactReleaseIsActive(definition: InstalledModuleDefinition): boolean {
  const row = rawDb.prepare(`
    SELECT active_release_id, registry_epoch, enabled, lifecycle_state
    FROM installed_modules WHERE module_id = ?
  `).get(definition.moduleId) as {
    active_release_id: string | null;
    registry_epoch: number;
    enabled: number;
    lifecycle_state: string;
  } | undefined;
  return Boolean(
    row
    && row.active_release_id === definition.releaseId
    && row.registry_epoch === definition.registryEpoch
    && row.enabled === 1
    && row.lifecycle_state === 'active',
  );
}

/** Pin only the exact release/registry epoch that was authorized. */
function pinExactActiveRelease(
  definition: InstalledModuleDefinition,
  kind: 'query' | 'mutation',
): () => void {
  if (!exactReleaseIsActive(definition)) {
    throw new ModulePackageError('The active package release changed. Retry the operation.', 'MODULE_RELEASE_CHANGED');
  }
  const end = beginModuleInvocation(definition.moduleId, definition.releaseId, kind);
  if (!exactReleaseIsActive(definition)) {
    end();
    throw new ModulePackageError('The active package release changed. Retry the operation.', 'MODULE_RELEASE_CHANGED');
  }
  return end;
}

async function invokeDeclaredDependencyOperation(input: {
  addon: InstalledModuleDefinition;
  dependency: AddonDependency;
  operationName: string;
  connectionProfileId: string;
  userId: string;
  surfaceId: string;
  body: unknown;
  correlationId: string;
  callerKind: 'query' | 'mutation';
}): Promise<{ data: unknown; appReleaseId: string; connectionProfileId?: string }> {
  const app = packageById(input.dependency.appId);
  if (!app || !executable(app, 'app') || !compatibleVersion(app.manifest.version, input.dependency.packageVersion)) {
    throw new ModulePackageError('The required App version is unavailable.', 'DEPENDENCY_UNAVAILABLE');
  }
  const operation = normalizeOperation(input.operationName, app.operations[input.operationName]);
  const declaredRange = input.dependency.operations[input.operationName];
  if (
    !operation
    || !operation.consumers.includes('addon')
    || typeof declaredRange !== 'string'
    || !compatibleVersion(operation.version, declaredRange)
  ) throw new ModulePackageError('The App operation is not available to this Add-on.', 'OPERATION_REFUSED');
  if (input.callerKind === 'query' && operation.kind === 'mutation') {
    throw new ModulePackageError('A query Add-on operation cannot invoke an App mutation.', 'OPERATION_REFUSED');
  }
  if (!await hasPermission(input.userId, app.manifest.slug, operation.permission)) {
    throw new ModulePackageError('App operation access is unavailable.', 'OPERATION_ACCESS_DENIED');
  }
  if (operation.connection === 'required' && !input.connectionProfileId) {
    throw new ModulePackageError('The App operation requires a connection profile.', 'CONNECTION_REQUIRED');
  }
  if (operation.connection === 'none' && input.connectionProfileId) {
    throw new ModulePackageError('The App operation does not accept a connection profile.', 'CONNECTION_NOT_SUPPORTED');
  }
  const profile = input.connectionProfileId
    ? await readConnectionProfileForInvocation(
        input.connectionProfileId,
        app.moduleId,
        input.userId,
        operation.permission,
      )
    : undefined;
  const serialized = JSON.stringify(input.body ?? {});
  if (Buffer.byteLength(serialized) > Math.min(operation.maxRequestBytes, MAX_BINDING_INPUT_BYTES)) {
    throw new ModulePackageError('App operation input is too large.', 'OPERATION_INPUT_LIMIT');
  }
  const endApp = pinExactActiveRelease(app, operation.kind);
  const entrypoint: ModuleEntrypoint = {
    method: 'POST',
    kind: operation.kind,
    permission: operation.permission,
    handler: operation.handler,
    requestSchema: operation.requestSchema,
    responseSchema: operation.responseSchema,
    timeoutClass: operation.timeoutClass,
    maxRequestBytes: operation.maxRequestBytes,
    maxResponseBytes: operation.maxResponseBytes,
    ...(operation.auditAction ? { auditAction: operation.auditAction } : {}),
  };
  try {
    if (operation.auditAction) {
      await logAuditEvent(input.userId, operation.auditAction, app.manifest.slug, {
        phase: 'attempt',
        correlationId: input.correlationId,
        callerAddonId: input.addon.moduleId,
        callerReleaseId: input.addon.releaseId,
        targetReleaseId: app.releaseId,
        operation: operation.name,
        connectionProfileId: profile?.id,
        connectionGenerationId: profile?.generationId,
      });
    }
    const data = await executeInstalledOperation(app, entrypoint, input.body, {
      config: profile ? { ...profile.values } : {},
      moduleSlug: app.manifest.slug,
      path: ['operations', operation.name],
      userId: input.userId,
      connectionProfileId: profile?.id,
      connectionProfileName: profile?.name,
      connectionGenerationId: profile?.generationId,
      correlationId: input.correlationId,
      caller: { kind: 'addon', packageId: input.addon.moduleId, surfaceId: input.surfaceId },
      notify: (title, message, severity) => notify(title, message, severity, app.manifest.slug),
    });
    if (operation.auditAction) {
      await logAuditEvent(input.userId, operation.auditAction, app.manifest.slug, {
        phase: 'succeeded',
        correlationId: input.correlationId,
        callerAddonId: input.addon.moduleId,
        targetReleaseId: app.releaseId,
        operation: operation.name,
      });
    }
    return { data, appReleaseId: app.releaseId, ...(profile ? { connectionProfileId: profile.id } : {}) };
  } catch (error) {
    if (operation.auditAction) {
      try {
        await logAuditEvent(input.userId, operation.auditAction, app.manifest.slug, {
          phase: 'failed', correlationId: input.correlationId, callerAddonId: input.addon.moduleId,
          targetReleaseId: app.releaseId, operation: operation.name,
          code: error instanceof ModulePackageError ? error.code : 'OPERATION_FAILED',
        });
      } catch { /* Preserve the operation failure. */ }
    }
    throw error;
  } finally {
    endApp();
  }
}

export async function invokeAddonBinding(
  request: InvokeAddonBindingInput,
): Promise<AddonBindingInvocationResult> {
  const inputJson = JSON.stringify(request.input ?? {});
  if (Buffer.byteLength(inputJson) > MAX_BINDING_INPUT_BYTES) {
    throw new ModulePackageError('Add-on operation input is too large.', 'OPERATION_INPUT_LIMIT');
  }
  const resolvedSurface = getSurfaceDefinition(request.addonSlug, request.surfaceId);
  if (!resolvedSurface || resolvedSurface.packageKind !== 'addon') {
    throw new ModulePackageError('Add-on surface not found.', 'SURFACE_NOT_FOUND');
  }
  const addon = getAllInstalledModules().find(({ releaseId }) => releaseId === resolvedSurface.releaseId);
  if (!addon || !executable(addon, 'addon')) {
    throw new ModulePackageError('Add-on is unavailable.', 'ADDON_UNAVAILABLE');
  }
  for (const permission of resolvedSurface.surface.permissions) {
    if (!await hasPermission(request.userId, request.addonSlug, permission)) {
      throw new ModulePackageError('Add-on surface access is unavailable.', 'SURFACE_ACCESS_DENIED');
    }
  }
  const binding = resolvedSurface.surface.bindings.find(({ id }) => id === request.bindingId);
  if (!binding) throw new ModulePackageError('Add-on binding not found.', 'BINDING_NOT_FOUND');
  if (binding.target === 'self') {
    throw new ModulePackageError('This broker accepts only declared Add-on-to-App bindings.', 'BINDING_TARGET_REFUSED');
  }
  const dependency = addon.dependencies
    .map(normalizeDependency)
    .find((candidate): candidate is AddonDependency => candidate?.alias === binding.target);
  if (!dependency) throw new ModulePackageError('Add-on dependency is not declared.', 'DEPENDENCY_REFUSED');
  const app = packageById(dependency.appId);
  if (!app || !executable(app, 'app') || !compatibleVersion(app.manifest.version, dependency.packageVersion)) {
    throw new ModulePackageError('The required App version is unavailable.', 'DEPENDENCY_UNAVAILABLE');
  }
  const operation = normalizeOperation(binding.operation, app.operations[binding.operation]);
  const declaredRange = dependency.operations[binding.operation];
  if (
    !operation
    || !operation.consumers.includes('addon')
    || typeof declaredRange !== 'string'
    || !compatibleVersion(operation.version, declaredRange)
  ) throw new ModulePackageError('The App operation is not available to this Add-on.', 'OPERATION_REFUSED');

  if (!await hasPermission(request.userId, app.manifest.slug, operation.permission)) {
    throw new ModulePackageError('App operation access is unavailable.', 'OPERATION_ACCESS_DENIED');
  }
  const slot = binding.connectionSlot
    ? resolvedSurface.surface.connectionSlots.find(({ id }) => id === binding.connectionSlot)
    : undefined;
  if (slot && slot.target !== dependency.alias) {
    throw new ModulePackageError('Add-on connection binding targets the wrong App.', 'CONNECTION_ACCESS_DENIED');
  }
  const profileId = binding.connectionSlot ? request.connectionBindings[binding.connectionSlot] : undefined;
  if (operation.connection === 'required' && !profileId) {
    throw new ModulePackageError('The App operation requires a connection profile.', 'CONNECTION_REQUIRED');
  }
  if (operation.connection === 'none' && profileId) {
    throw new ModulePackageError('The App operation does not accept a connection profile.', 'CONNECTION_NOT_SUPPORTED');
  }
  const profile = profileId
    ? await readConnectionProfileForInvocation(profileId, app.moduleId, request.userId, operation.permission)
    : undefined;

  const correlationId = randomUUID();
  const endAddon = pinExactActiveRelease(addon, operation.kind);
  let endApp: (() => void) | undefined;
  try {
    endApp = pinExactActiveRelease(app, operation.kind);
    const entrypoint: ModuleEntrypoint = {
      method: 'POST',
      kind: operation.kind,
      permission: operation.permission,
      handler: operation.handler,
      requestSchema: operation.requestSchema,
      responseSchema: operation.responseSchema,
      timeoutClass: operation.timeoutClass,
      maxRequestBytes: operation.maxRequestBytes,
      maxResponseBytes: operation.maxResponseBytes,
      ...(operation.auditAction ? { auditAction: operation.auditAction } : {}),
    };
    if (operation.auditAction) {
      await logAuditEvent(request.userId, operation.auditAction, app.manifest.slug, {
        phase: 'attempt',
        correlationId,
        callerAddonId: addon.moduleId,
        callerReleaseId: addon.releaseId,
        targetReleaseId: app.releaseId,
        operation: operation.name,
        connectionProfileId: profile?.id,
        connectionGenerationId: profile?.generationId,
      });
    }
    const data = await executeInstalledOperation(app, entrypoint, request.input, {
      config: profile ? { ...profile.values } : {},
      moduleSlug: app.manifest.slug,
      path: ['operations', operation.name],
      userId: request.userId,
      connectionProfileId: profile?.id,
      connectionProfileName: profile?.name,
      connectionGenerationId: profile?.generationId,
      correlationId,
      caller: { kind: 'addon', packageId: addon.moduleId, surfaceId: request.surfaceId },
      notify: (title, message, severity) => notify(title, message, severity, app.manifest.slug),
    });
    if (operation.auditAction) {
      await logAuditEvent(request.userId, operation.auditAction, app.manifest.slug, {
        phase: 'succeeded',
        correlationId,
        callerAddonId: addon.moduleId,
        targetReleaseId: app.releaseId,
        operation: operation.name,
      });
    }
    return {
      data,
      correlationId,
      appReleaseId: app.releaseId,
      addonReleaseId: addon.releaseId,
      ...(profile ? { connectionProfileId: profile.id } : {}),
    };
  } catch (error) {
    if (operation.auditAction) {
      try {
        await logAuditEvent(request.userId, operation.auditAction, app.manifest.slug, {
          phase: 'failed',
          correlationId,
          callerAddonId: addon.moduleId,
          targetReleaseId: app.releaseId,
          operation: operation.name,
          code: error instanceof ModulePackageError ? error.code : 'OPERATION_FAILED',
        });
      } catch {
        // The operation error remains authoritative if outcome audit storage fails.
      }
    }
    throw error;
  } finally {
    endApp?.();
    endAddon();
  }
}

export async function invokeSurfaceBinding(
  request: InvokeSurfaceBindingInput,
): Promise<AddonBindingInvocationResult> {
  const resolved = getSurfaceDefinition(request.moduleSlug, request.surfaceId);
  if (!resolved) throw new ModulePackageError('Surface not found.', 'SURFACE_NOT_FOUND');
  if (resolved.packageKind === 'addon') {
    const binding = resolved.surface.bindings.find(({ id }) => id === request.bindingId);
    if (!binding) throw new ModulePackageError('Add-on binding not found.', 'BINDING_NOT_FOUND');
    if (binding.target !== 'self') {
      return invokeAddonBinding({
        addonSlug: request.moduleSlug,
        surfaceId: request.surfaceId,
        bindingId: request.bindingId,
        connectionBindings: request.connectionBindings,
        userId: request.userId,
        input: request.input,
      });
    }
    const addon = getAllInstalledModules().find(({ releaseId }) => releaseId === resolved.releaseId);
    if (!addon || !executable(addon, 'addon')) throw new ModulePackageError('Add-on is unavailable.', 'ADDON_UNAVAILABLE');
    for (const permission of resolved.surface.permissions) {
      if (!await hasPermission(request.userId, request.moduleSlug, permission)) {
        throw new ModulePackageError('Add-on surface access is unavailable.', 'SURFACE_ACCESS_DENIED');
      }
    }
    const operation = normalizeOperation(binding.operation, addon.operations[binding.operation]);
    if (!operation || !operation.consumers.includes('self') || operation.connection !== 'none') {
      throw new ModulePackageError('Add-on self operation is unavailable.', 'OPERATION_REFUSED');
    }
    if (!await hasPermission(request.userId, addon.manifest.slug, operation.permission)) {
      throw new ModulePackageError('Add-on operation access is unavailable.', 'OPERATION_ACCESS_DENIED');
    }
    const serialized = JSON.stringify(request.input ?? {});
    if (Buffer.byteLength(serialized) > Math.min(operation.maxRequestBytes, MAX_BINDING_INPUT_BYTES)) {
      throw new ModulePackageError('Add-on operation input is too large.', 'OPERATION_INPUT_LIMIT');
    }
    const correlationId = randomUUID();
    const endAddon = pinExactActiveRelease(addon, operation.kind);
    const permittedProfileIds = new Set(
      resolved.surface.connectionSlots.flatMap((slot) => {
        if (slot.target === 'self') return [];
        const profileId = request.connectionBindings[slot.id];
        return profileId ? [profileId] : [];
      }),
    );
    const entrypoint: ModuleEntrypoint = {
      method: 'POST', kind: operation.kind, permission: operation.permission, handler: operation.handler,
      requestSchema: operation.requestSchema, responseSchema: operation.responseSchema,
      timeoutClass: operation.timeoutClass, maxRequestBytes: operation.maxRequestBytes,
      maxResponseBytes: operation.maxResponseBytes,
      ...(operation.auditAction ? { auditAction: operation.auditAction } : {}),
    };
    try {
      const data = await executeInstalledOperation(addon, entrypoint, request.input, {
        config: {},
        moduleSlug: addon.manifest.slug,
        path: ['operations', operation.name],
        userId: request.userId,
        correlationId,
        caller: { kind: 'surface', packageId: addon.moduleId, surfaceId: request.surfaceId },
        invokeApp: async (call) => {
          if (!permittedProfileIds.has(call.connectionProfileId)) {
            throw new ModulePackageError(
              'apps.invoke may use only a connection selected for this surface.',
              'CONNECTION_ACCESS_DENIED',
            );
          }
          const dependency = addon.dependencies
            .map(normalizeDependency)
            .find((candidate): candidate is AddonDependency => candidate?.alias === call.dependency);
          if (!dependency) throw new ModulePackageError('Add-on dependency is not declared.', 'DEPENDENCY_REFUSED');
          return (await invokeDeclaredDependencyOperation({
            addon,
            dependency,
            operationName: call.operation,
            connectionProfileId: call.connectionProfileId,
            userId: request.userId,
            surfaceId: request.surfaceId,
            body: call.input,
            correlationId,
            callerKind: operation.kind,
          })).data;
        },
        notify: (title, message, severity) => notify(title, message, severity, addon.manifest.slug),
      });
      return { data, correlationId, addonReleaseId: addon.releaseId };
    } finally {
      endAddon();
    }
  }
  const app = getAllInstalledModules().find(({ releaseId }) => releaseId === resolved.releaseId);
  if (!app || !executable(app, 'app')) throw new ModulePackageError('App is unavailable.', 'APP_UNAVAILABLE');
  for (const permission of resolved.surface.permissions) {
    if (!await hasPermission(request.userId, request.moduleSlug, permission)) {
      throw new ModulePackageError('App surface access is unavailable.', 'SURFACE_ACCESS_DENIED');
    }
  }
  const binding = resolved.surface.bindings.find(({ id }) => id === request.bindingId);
  if (!binding || binding.target !== 'self') {
    throw new ModulePackageError('App surface binding is unavailable.', 'BINDING_REFUSED');
  }
  const operation = normalizeOperation(binding.operation, app.operations[binding.operation]);
  if (!operation || !operation.consumers.includes('self')) {
    throw new ModulePackageError('App operation is unavailable to its surface.', 'OPERATION_REFUSED');
  }
  if (!await hasPermission(request.userId, app.manifest.slug, operation.permission)) {
    throw new ModulePackageError('App operation access is unavailable.', 'OPERATION_ACCESS_DENIED');
  }
  const slot = binding.connectionSlot
    ? resolved.surface.connectionSlots.find(({ id }) => id === binding.connectionSlot)
    : undefined;
  if (binding.connectionSlot && (!slot || slot.target !== 'self')) {
    throw new ModulePackageError('App connection binding is invalid.', 'CONNECTION_ACCESS_DENIED');
  }
  const profileId = binding.connectionSlot ? request.connectionBindings[binding.connectionSlot] : undefined;
  if (operation.connection === 'required' && !profileId) {
    throw new ModulePackageError('The App operation requires a connection profile.', 'CONNECTION_REQUIRED');
  }
  if (operation.connection === 'none' && profileId) {
    throw new ModulePackageError('The App operation does not accept a connection profile.', 'CONNECTION_NOT_SUPPORTED');
  }
  const profile = profileId
    ? await readConnectionProfileForInvocation(profileId, app.moduleId, request.userId, operation.permission)
    : undefined;
  const inputJson = JSON.stringify(request.input ?? {});
  if (Buffer.byteLength(inputJson) > Math.min(operation.maxRequestBytes, MAX_BINDING_INPUT_BYTES)) {
    throw new ModulePackageError('App operation input is too large.', 'OPERATION_INPUT_LIMIT');
  }
  const correlationId = randomUUID();
  const endApp = pinExactActiveRelease(app, operation.kind);
  try {
    const entrypoint: ModuleEntrypoint = {
      method: 'POST',
      kind: operation.kind,
      permission: operation.permission,
      handler: operation.handler,
      requestSchema: operation.requestSchema,
      responseSchema: operation.responseSchema,
      timeoutClass: operation.timeoutClass,
      maxRequestBytes: operation.maxRequestBytes,
      maxResponseBytes: operation.maxResponseBytes,
      ...(operation.auditAction ? { auditAction: operation.auditAction } : {}),
    };
    if (operation.auditAction) {
      await logAuditEvent(request.userId, operation.auditAction, app.manifest.slug, {
        phase: 'attempt',
        correlationId,
        surfaceId: request.surfaceId,
        targetReleaseId: app.releaseId,
        operation: operation.name,
        connectionProfileId: profile?.id,
        connectionGenerationId: profile?.generationId,
      });
    }
    const data = await executeInstalledOperation(app, entrypoint, request.input, {
      config: profile ? { ...profile.values } : {},
      moduleSlug: app.manifest.slug,
      path: ['operations', operation.name],
      userId: request.userId,
      connectionProfileId: profile?.id,
      connectionProfileName: profile?.name,
      connectionGenerationId: profile?.generationId,
      correlationId,
      caller: { kind: 'surface', packageId: app.moduleId, surfaceId: request.surfaceId },
      notify: (title, message, severity) => notify(title, message, severity, app.manifest.slug),
    });
    if (operation.auditAction) {
      await logAuditEvent(request.userId, operation.auditAction, app.manifest.slug, {
        phase: 'succeeded', correlationId, surfaceId: request.surfaceId, operation: operation.name,
      });
    }
    return {
      data,
      correlationId,
      appReleaseId: app.releaseId,
      ...(profile ? { connectionProfileId: profile.id } : {}),
    };
  } catch (error) {
    if (operation.auditAction) {
      try {
        await logAuditEvent(request.userId, operation.auditAction, app.manifest.slug, {
          phase: 'failed', correlationId, surfaceId: request.surfaceId, operation: operation.name,
          code: error instanceof ModulePackageError ? error.code : 'OPERATION_FAILED',
        });
      } catch { /* Preserve the original operation failure. */ }
    }
    throw error;
  } finally {
    endApp();
  }
}
