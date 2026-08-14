import 'server-only';

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { getAllInstalledModules, getInstalledModule } from '@/lib/modules/installed/provider';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { hasPermission } from '@/lib/auth/permissions';

const safeId = /^[a-z][a-z0-9-]{0,79}$/;
const safeAssetPath = /^ui\/surfaces\/[a-zA-Z0-9._/-]{1,220}$/;

export interface InstalledSurfaceConnectionSlot {
  id: string;
  target: 'self' | string;
  required: boolean;
}

export interface InstalledSurfaceBinding {
  id: string;
  target: 'self' | string;
  operation: string;
  connectionSlot?: string;
}

export interface InstalledSurfaceDefinition {
  id: string;
  type: 'widget' | 'page';
  name: string;
  description?: string;
  entry: string;
  permissions: string[];
  connectionSlots: InstalledSurfaceConnectionSlot[];
  bindings: InstalledSurfaceBinding[];
  requestedMode: 'sandboxed' | 'trusted';
  raw: Readonly<Record<string, unknown>>;
}

export interface ResolvedSurfaceDefinition {
  moduleId: string;
  moduleSlug: string;
  releaseId: string;
  digest: string;
  artifactPath: string;
  packageKind: 'app' | 'addon';
  surface: InstalledSurfaceDefinition;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown, maximum = 32): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((entry) => typeof entry !== 'string')) return [];
  return value as string[];
}

function normalizeSurface(value: unknown): InstalledSurfaceDefinition | null {
  const item = record(value);
  if (!item || typeof item.id !== 'string' || !safeId.test(item.id)) return null;
  const type = item.kind;
  if (type !== 'widget' && type !== 'page') return null;
  if (typeof item.entry !== 'string' || !safeAssetPath.test(item.entry) || item.entry.includes('..')) return null;
  const permissions = stringArray(item.permissions);
  if (!permissions.length || permissions.some((permission) => !/^[a-z][a-z0-9.:_-]{0,79}$/.test(permission))) return null;

  const slots = Array.isArray(item.connectionSlots) ? item.connectionSlots : [];
  const connectionSlots: InstalledSurfaceConnectionSlot[] = [];
  for (const rawSlot of slots) {
    const slot = record(rawSlot);
    if (!slot || typeof slot.slot !== 'string' || !safeId.test(slot.slot)) return null;
    if (typeof slot.target !== 'string' || (slot.target !== 'self' && !safeId.test(slot.target))) return null;
    connectionSlots.push({ id: slot.slot, target: slot.target, required: slot.required !== false });
  }

  const rawBindings = record(item.bindings);
  if (!rawBindings) return null;
  const bindings: InstalledSurfaceBinding[] = [];
  for (const [bindingId, rawBinding] of Object.entries(rawBindings)) {
    const binding = record(rawBinding);
    const connectionSlot = binding?.connectionSlot ?? binding?.slot;
    if (
      !binding
      || !safeId.test(bindingId)
      || typeof binding.target !== 'string'
      || (binding.target !== 'self' && !safeId.test(binding.target))
      || typeof binding.operation !== 'string'
      || !safeId.test(binding.operation)
      || (connectionSlot !== undefined && (typeof connectionSlot !== 'string' || !safeId.test(connectionSlot)))
    ) return null;
    bindings.push({
      id: bindingId,
      target: binding.target,
      operation: binding.operation,
      ...(typeof connectionSlot === 'string' ? { connectionSlot } : {}),
    });
  }
  const execution = record(item.execution);
  const requestedMode = execution?.requestedMode === 'trusted' ? 'trusted' : 'sandboxed';
  return {
    id: item.id,
    type,
    name: typeof item.name === 'string' ? item.name : item.id,
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
    entry: item.entry,
    permissions,
    connectionSlots,
    bindings,
    requestedMode,
    raw: Object.freeze({ ...item }),
  };
}

function surfaceEntries(document: Record<string, unknown> | null): unknown[] {
  if (!document) return [];
  return Array.isArray(document.surfaces) ? document.surfaces : [];
}

export function getSurfaceDefinition(moduleSlug: string, surfaceId: string): ResolvedSurfaceDefinition | undefined {
  if (!safeId.test(surfaceId)) return undefined;
  const installed = getInstalledModule(moduleSlug);
  if (!installed || !installed.enabled || installed.lifecycleState !== 'active' || installed.packageSchemaVersion < 2) {
    return undefined;
  }
  const surface = surfaceEntries(installed.surfaces)
    .map(normalizeSurface)
    .find((candidate): candidate is InstalledSurfaceDefinition => candidate?.id === surfaceId);
  if (!surface) return undefined;
  return {
    moduleId: installed.moduleId,
    moduleSlug,
    releaseId: installed.releaseId,
    digest: installed.digest,
    artifactPath: installed.artifactPath,
    packageKind: installed.packageKind,
    surface,
  };
}

export async function canAccessInstalledSurface(
  userId: string,
  moduleSlug: string,
  surfaceId: string,
  expectedType?: InstalledSurfaceDefinition['type'],
): Promise<boolean> {
  const definition = getSurfaceDefinition(moduleSlug, surfaceId);
  if (!definition || (expectedType && definition.surface.type !== expectedType)) return false;
  const decisions = await Promise.all(definition.surface.permissions.map((permission) => (
    hasPermission(userId, moduleSlug, permission)
  )));
  return decisions.every(Boolean);
}

export function getSurfaceConnectionOwnerModuleId(
  moduleSlug: string,
  surfaceId: string,
  slotId?: string,
): string | undefined {
  const definition = getSurfaceDefinition(moduleSlug, surfaceId);
  const installed = getInstalledModule(moduleSlug);
  if (!definition || !installed) return undefined;
  const slot = slotId
    ? definition.surface.connectionSlots.find(({ id }) => id === slotId)
    : definition.surface.connectionSlots[0];
  if (!slot) return undefined;
  if (slot.target === 'self') return definition.packageKind === 'app' ? definition.moduleId : undefined;
  const dependency = installed.dependencies.find((value) => (
    value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).alias === slot.target
  )) as Record<string, unknown> | undefined;
  if (typeof dependency?.appId !== 'string') return undefined;
  return getAllInstalledModules().some((candidate) => (
    candidate.moduleId === dependency.appId
    && candidate.packageKind === 'app'
    && candidate.enabled
    && candidate.lifecycleState === 'active'
  )) ? dependency.appId : undefined;
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

export async function readVerifiedSurfaceEntryHtml(
  moduleSlug: string,
  surfaceId: string,
): Promise<{ html: string; digest: string; releaseId: string }> {
  const definition = getSurfaceDefinition(moduleSlug, surfaceId);
  if (!definition) throw new ModulePackageError('Surface not found.', 'SURFACE_NOT_FOUND');
  const entry = definition.surface.entry;
  if (!entry.endsWith('.html')) throw new ModulePackageError('Surface entry must be HTML.', 'INVALID_SURFACE_ENTRY');
  const candidate = join(definition.artifactPath, entry);
  const [root, resolved] = await Promise.all([realpath(definition.artifactPath), realpath(candidate)]);
  if (!inside(root, resolved)) throw new ModulePackageError('Surface entry resolves outside its package.', 'INVALID_SURFACE_ENTRY');
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) {
    throw new ModulePackageError('Surface entry is unsafe or too large.', 'INVALID_SURFACE_ENTRY');
  }
  const [contents, checksumDocument] = await Promise.all([
    readFile(resolved),
    readFile(join(definition.artifactPath, 'checksums.json'), 'utf8'),
  ]);
  let expected: string | undefined;
  try {
    const parsed = JSON.parse(checksumDocument) as { files?: Record<string, unknown> };
    const value = parsed.files?.[entry];
    expected = typeof value === 'string' ? value : undefined;
  } catch {
    throw new ModulePackageError('Package checksums are invalid.', 'INVALID_SURFACE_ENTRY');
  }
  const actual = createHash('sha256').update(contents).digest('hex');
  if (!expected || expected !== actual) {
    throw new ModulePackageError('Surface entry failed its package checksum.', 'SURFACE_CHECKSUM_FAILED');
  }
  return { html: contents.toString('utf8'), digest: definition.digest, releaseId: definition.releaseId };
}
