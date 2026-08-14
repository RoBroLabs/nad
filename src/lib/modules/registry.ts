import 'server-only';

import { getModuleConfig, isModuleEnabled } from '@/lib/modules/config';
import { validateModuleConfig } from '@/lib/modules/config-validation';
import { getAllInstalledModules, getInstalledModule } from '@/lib/modules/installed/provider';
import { beginModuleInvocation } from '@/lib/modules/installed/invocation-guard';
import { isReleaseQuarantined } from '@/lib/marketplace/security';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { createInstalledModuleHandler } from '@/lib/modules/installed/runner';
import { hasConfiguredConnectionProfile } from '@/lib/modules/connections';
import type { ModuleApiHandler } from '@/lib/modules/registry-types';
import type { ModuleCategory, ModuleEntrypoint, ModuleManifest, ModuleState } from '@/lib/modules/types';

export type { ModuleApiContext, ModuleApiHandler, ModuleNotifier } from '@/lib/modules/registry-types';

export interface ModuleApiEndpoint {
  manifest: ModuleManifest;
  entrypoint: ModuleEntrypoint;
  handler: ModuleApiHandler;
  permission: string;
  moduleId: string;
  releaseId: string;
  releaseDigest: string;
  signerKeyId: string | null;
  configGenerationId: string | null;
  packageSchemaVersion: number;
  packageKind: 'app' | 'addon';
}

export interface PinnedModuleApiEndpoint extends ModuleApiEndpoint {
  endInvocation: () => void;
}

export function getModule(slug: string): ModuleManifest | undefined {
  return getInstalledModule(slug)?.manifest;
}

export function getModuleExecutionBlock(slug: string): 'quarantined' | undefined {
  const installed = getInstalledModule(slug);
  if (!installed) return undefined;
  return installed.lifecycleState === 'quarantined'
    || isReleaseQuarantined(installed.digest, installed.signerKeyId)
    ? 'quarantined'
    : undefined;
}

export function getAllModules(): ModuleManifest[] {
  return getAllInstalledModules()
    .map(({ manifest }) => manifest)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getModulesByCategory(): Partial<Record<ModuleCategory, ModuleManifest[]>> {
  return getAllModules().reduce<Partial<Record<ModuleCategory, ModuleManifest[]>>>((groups, manifest) => {
    const categoryModules = groups[manifest.category] ?? [];
    categoryModules.push(manifest);
    groups[manifest.category] = categoryModules;
    return groups;
  }, {});
}

export async function getModuleState(slug: string): Promise<ModuleState | undefined> {
  const installed = getInstalledModule(slug);
  const manifest = installed?.manifest;
  if (!installed || !manifest) return undefined;
  if (installed.lifecycleState === 'quarantined'
    || isReleaseQuarantined(installed.digest, installed.signerKeyId)) {
    return { manifest, status: 'quarantined' };
  }
  const enabled = await isModuleEnabled(slug);
  if (!enabled) return { manifest, status: 'discovered' };
  if (installed.packageSchemaVersion === 2) {
    if (installed.packageKind === 'app') {
      return { manifest, status: hasConfiguredConnectionProfile(installed.moduleId) ? 'configured' : 'enabled' };
    }
    const available = installed.dependencies.every((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const appId = (value as { appId?: unknown }).appId;
      if (typeof appId !== 'string') return false;
      const dependency = getAllInstalledModules().find(({ moduleId }) => moduleId === appId);
      return Boolean(
        dependency
        && dependency.packageKind === 'app'
        && dependency.enabled
        && dependency.lifecycleState === 'active'
        && !isReleaseQuarantined(dependency.digest, dependency.signerKeyId),
      );
    });
    return { manifest, status: available ? 'configured' : 'enabled' };
  }
  const config = await getModuleConfig(slug);
  const configured = validateModuleConfig(manifest, config).valid;
  return { manifest, status: configured ? 'configured' : 'enabled' };
}

export async function getAllModuleStates(): Promise<ModuleState[]> {
  const states = await Promise.all(getAllModules().map(({ slug }) => getModuleState(slug)));
  return states.filter((state): state is ModuleState => Boolean(state));
}

export async function getEnabledModuleStates(): Promise<ModuleState[]> {
  const states = await getAllModuleStates();
  return states.filter(({ status }) => status !== 'discovered' && status !== 'quarantined');
}

export function getModuleApiHandler(moduleSlug: string, path: string[]): ModuleApiHandler | undefined {
  const installed = getInstalledModule(moduleSlug);
  if (installed) {
    const entrypoint = installed.manifest.entrypoints?.[path.join('/')];
    if (!entrypoint) return undefined;
    return createInstalledModuleHandler(installed, entrypoint);
  }
  return undefined;
}

export function getModuleApiPermission(moduleSlug: string, path: string[]): string | undefined {
  const installed = getInstalledModule(moduleSlug);
  if (installed) return installed.manifest.entrypoints?.[path.join('/')]?.permission;
  return undefined;
}

export function getModuleApiEntrypoint(moduleSlug: string, path: string[]): ModuleEntrypoint | undefined {
  return getInstalledModule(moduleSlug)?.manifest.entrypoints?.[path.join('/')];
}

/** Resolve endpoint metadata without joining lifecycle invocation accounting. */
export function getModuleApiEndpoint(
  moduleSlug: string,
  path: string[],
): ModuleApiEndpoint | undefined {
  const installed = getInstalledModule(moduleSlug);
  if (!installed
    || !installed.enabled
    || installed.lifecycleState !== 'active'
    || isReleaseQuarantined(installed.digest, installed.signerKeyId)) return undefined;
  const entrypoint = installed.manifest.entrypoints?.[path.join('/')];
  if (!entrypoint) return undefined;
  return {
    manifest: installed.manifest,
    entrypoint,
    handler: createInstalledModuleHandler(installed, entrypoint),
    permission: entrypoint.permission,
    moduleId: installed.moduleId,
    releaseId: installed.releaseId,
    releaseDigest: installed.digest,
    signerKeyId: installed.signerKeyId ?? null,
    configGenerationId: installed.configGenerationId,
    packageSchemaVersion: installed.packageSchemaVersion,
    packageKind: installed.packageKind,
  };
}

/**
 * Pins a previously resolved immutable release after request metadata has been
 * validated. The caller must invoke endInvocation in a finally block.
 */
export function pinModuleApiEndpoint(endpoint: ModuleApiEndpoint): PinnedModuleApiEndpoint {
  if (isReleaseQuarantined(endpoint.releaseDigest, endpoint.signerKeyId)) {
    throw new ModulePackageError(
      'Plugin execution is quarantined by verified security metadata.',
      'RELEASE_REVOKED',
    );
  }
  const endInvocation = beginModuleInvocation(
    endpoint.moduleId,
    endpoint.releaseId,
    endpoint.entrypoint.kind,
  );
  return { ...endpoint, endInvocation };
}
