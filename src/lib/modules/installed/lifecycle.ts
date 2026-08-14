import 'server-only';

import { randomUUID } from 'node:crypto';
import { rawDb } from '@/lib/db';
import { logAuditEvent } from '@/lib/db/audit';
import { ensureInstalledModuleConfigGeneration } from '@/lib/modules/config';
import { ensureDefaultConnectionProfile } from '@/lib/modules/connections';
import {
  applyDeclarativeDataMigration,
  type DataGenerationPointers,
} from '@/lib/modules/installed/data-migration';
import {
  assertSafeStoredModuleArtifactPointer,
  removeNewlyStoredModuleArtifact,
  removeStoredModuleArtifact,
  storeVerifiedModuleArtifact,
  type ModuleArtifactPointer,
  type StoredModuleArtifact,
} from '@/lib/modules/installed/artifact-store';
import {
  acquireModuleLifecycleLock,
  assertModuleLifecycleLock,
  releaseModuleLifecycleLock,
} from '@/lib/modules/installed/lifecycle-lock';
import {
  assertModuleReleasesIdle,
  startModuleInvocationDrain,
  startModuleMutationDrain,
} from '@/lib/modules/installed/invocation-guard';
import { parseAnyPackageManifest } from '@/lib/modules/installed/package-schema';
import {
  ModulePackageError,
  type InstalledAnyPackageManifest,
  type VerifiedModulePackage,
} from '@/lib/modules/installed/package-types';
import { satisfiesCoreRange, verifyModulePackage, type ModuleVerifierOptions } from '@/lib/modules/installed/package-verifier';
import { ensureReleaseTrustRecord } from '@/lib/modules/installed/trust';
import { assertReleaseActivationAllowed, isReleaseQuarantined } from '@/lib/marketplace/security';

const protectedLegacyIds: Record<string, string> = {
  docker: 'dev.robrolabs.docker',
  network: 'dev.robrolabs.network',
  proxmox: 'dev.robrolabs.proxmox',
  'system-monitor': 'dev.robrolabs.system-monitor',
};

type ModuleOperationAction = 'install' | 'update' | 'activate' | 'rollback' | 'disable' | 'quarantine' | 'uninstall' | 'prune';
type ReleaseState = 'staged' | 'active' | 'retained' | 'rejected' | 'pruned';
export type ModuleRetentionChoice = 'retain' | 'delete';

interface ExistingInstalledModule {
  module_id: string;
  slug: string;
  enabled: number;
  lifecycle_state: string;
  active_release_id: string | null;
  active_config_generation_id: string | null;
  active_kv_generation_id: string | null;
  active_grant_generation_id: string | null;
  registry_epoch: number;
}

interface ReleaseRow {
  id: string;
  module_id: string;
  version: string;
  digest: string;
  signer_key_id: string | null;
  artifact_path: string;
  manifest_json: string;
  state: ReleaseState;
  config_generation_id: string | null;
  kv_generation_id: string | null;
  installed_at: string;
}

interface LifecyclePointers {
  activeReleaseId: string | null;
  activeConfigGenerationId: string | null;
  activeKvGenerationId: string | null;
  activeGrantGenerationId: string | null;
  registryEpoch: number;
}

interface PreparedLifecycleOperation {
  operationId: string;
  moduleId: string;
  expectedPointers: LifecyclePointers;
}

export interface InstallModuleResult {
  moduleId: string;
  slug: string;
  version: string;
  digest: string;
  releaseId: string;
  operationId: string;
  enabled: boolean;
  signatureStatus: 'verified' | 'development';
  replacedReleaseId?: string;
}

export interface ModuleInstallApproval {
  expectedDigest: string;
}

export interface ModuleReleaseSummary {
  releaseId: string;
  moduleId: string;
  version: string;
  digest: string;
  signerKeyId: string | null;
  activationBlocked: boolean;
  state: ReleaseState;
  installedAt: string;
}

export interface RollbackModuleOptions {
  targetReleaseId?: string;
  targetVersion?: string;
}

export interface RollbackModuleResult {
  moduleId: string;
  slug: string;
  version: string;
  digest: string;
  releaseId: string;
  operationId: string;
  enabled: boolean;
  replacedReleaseId?: string;
}

export interface SetInstalledModuleEnabledResult {
  moduleId: string;
  slug: string;
  enabled: boolean;
  operationId: string;
  changed: boolean;
}

export interface QuarantineInstalledModuleResult {
  moduleId: string;
  slug: string;
  releaseId: string;
  digest: string;
  operationId: string;
  changed: boolean;
}

export interface UninstallModuleOptions {
  configAndStorage: ModuleRetentionChoice;
  artifacts: ModuleRetentionChoice;
}

export interface UninstallModuleResult {
  moduleId: string;
  slug: string;
  operationId: string;
  configAndStorage: ModuleRetentionChoice;
  artifacts: ModuleRetentionChoice;
  prunedArtifacts: number;
  retainedArtifacts: number;
}

export interface PruneModuleArtifactsOptions {
  keepRetainedReleases: number;
}

export interface PruneModuleArtifactsResult {
  moduleId: string;
  slug: string;
  operationId: string;
  prunedArtifacts: number;
  retainedArtifacts: number;
}

function rowById(moduleId: string): ExistingInstalledModule | undefined {
  return rawDb.prepare(`
    SELECT module_id, slug, enabled, lifecycle_state, active_release_id,
           active_config_generation_id, active_kv_generation_id,
           active_grant_generation_id, registry_epoch
    FROM installed_modules
    WHERE module_id = ?
  `).get(moduleId) as ExistingInstalledModule | undefined;
}

function rowBySlug(slug: string): ExistingInstalledModule | undefined {
  return rawDb.prepare(`
    SELECT module_id, slug, enabled, lifecycle_state, active_release_id,
           active_config_generation_id, active_kv_generation_id,
           active_grant_generation_id, registry_epoch
    FROM installed_modules
    WHERE slug = ?
  `).get(slug) as ExistingInstalledModule | undefined;
}

function releaseByVersion(moduleId: string, version: string): ReleaseRow | undefined {
  return rawDb.prepare(`
    SELECT id, module_id, version, digest, signer_key_id, artifact_path, manifest_json, state,
           config_generation_id, kv_generation_id, installed_at
    FROM module_releases
    WHERE module_id = ? AND version = ?
  `).get(moduleId, version) as ReleaseRow | undefined;
}

function releaseById(moduleId: string, releaseId: string): ReleaseRow | undefined {
  return rawDb.prepare(`
    SELECT id, module_id, version, digest, signer_key_id, artifact_path, manifest_json, state,
           config_generation_id, kv_generation_id, installed_at
    FROM module_releases
    WHERE module_id = ? AND id = ?
  `).get(moduleId, releaseId) as ReleaseRow | undefined;
}

function parseStoredManifest(row: ReleaseRow): InstalledAnyPackageManifest {
  return parseAnyPackageManifest(JSON.parse(row.manifest_json) as unknown);
}

function dependencyVersionMatches(version: string, range: string): boolean {
  if (/^\^\d+\.\d+\.\d+$/.test(range)) {
    const base = range.slice(1).split('.').map(Number);
    const current = version.split(/[+-]/, 1)[0].split('.').map(Number);
    return current.length === 3 && current[0] === base[0]
      && (current[1] > base[1] || (current[1] === base[1] && current[2] >= base[2]));
  }
  if (/^~\d+\.\d+\.\d+$/.test(range)) {
    const base = range.slice(1).split('.').map(Number);
    const current = version.split(/[+-]/, 1)[0].split('.').map(Number);
    return current.length === 3 && current[0] === base[0] && current[1] === base[1] && current[2] >= base[2];
  }
  return satisfiesCoreRange(version, range);
}

function enabledAddonDependencies(): Array<{
  moduleId: string;
  slug: string;
  dependencies: Array<{
    appId: string;
    packageVersion: string;
    operations: Record<string, string>;
  }>;
}> {
  const rows = rawDb.prepare(`
    SELECT installed_modules.module_id, installed_modules.slug, module_releases.dependencies_json
    FROM installed_modules
    JOIN module_releases ON module_releases.id = installed_modules.active_release_id
    WHERE installed_modules.enabled = 1
      AND installed_modules.lifecycle_state = 'active'
      AND module_releases.package_kind = 'addon'
  `).all() as Array<{ module_id: string; slug: string; dependencies_json: string }>;
  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.dependencies_json) as unknown;
      if (!Array.isArray(parsed)) return [];
      const dependencies = parsed.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        const operations = item.operations && typeof item.operations === 'object' && !Array.isArray(item.operations)
          ? Object.fromEntries(Object.entries(item.operations).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
          : {};
        return typeof item.appId === 'string' && typeof item.packageVersion === 'string'
          ? [{ appId: item.appId, packageVersion: item.packageVersion, operations }]
          : [];
      });
      return [{ moduleId: row.module_id, slug: row.slug, dependencies }];
    } catch {
      return [];
    }
  });
}

function assertAppChangeKeepsEnabledAddons(
  appId: string,
  nextManifest?: InstalledAnyPackageManifest,
): void {
  const affected = enabledAddonDependencies().filter(({ dependencies }) => (
    dependencies.some((dependency) => dependency.appId === appId
      && (
        nextManifest === undefined
        || !dependencyVersionMatches(nextManifest.version, dependency.packageVersion)
        || nextManifest.schemaVersion !== 2
        || nextManifest.kind !== 'app'
        || Object.entries(dependency.operations).some(([operationName, operationRange]) => {
          const operation = nextManifest.operations[operationName];
          return !operation
            || !operation.consumers.includes('addon')
            || !dependencyVersionMatches(operation.version, operationRange);
        })
      ))
  ));
  if (affected.length) {
    throw new ModulePackageError(
      `Disable the dependent Add-on${affected.length === 1 ? '' : 's'} first: ${affected.map(({ slug }) => slug).join(', ')}.`,
      'ENABLED_ADDON_DEPENDENCY',
    );
  }
}

function assertAddonDependenciesAvailable(manifest: InstalledAnyPackageManifest): void {
  if (manifest.schemaVersion !== 2 || manifest.kind !== 'addon') return;
  for (const dependency of manifest.dependencies ?? []) {
    const row = rawDb.prepare(`
      SELECT installed_modules.enabled, installed_modules.lifecycle_state,
             module_releases.version, module_releases.digest, module_releases.signer_key_id
      FROM installed_modules
      JOIN module_releases ON module_releases.id = installed_modules.active_release_id
      WHERE installed_modules.module_id = ? AND module_releases.package_kind = 'app'
    `).get(dependency.appId) as {
      enabled: number;
      lifecycle_state: string;
      version: string;
      digest: string;
      signer_key_id: string | null;
    } | undefined;
    if (
      !row
      || row.enabled !== 1
      || row.lifecycle_state !== 'active'
      || !dependencyVersionMatches(row.version, dependency.packageVersion)
      || isReleaseQuarantined(row.digest, row.signer_key_id)
    ) {
      throw new ModulePackageError(`Required App ${dependency.appId} is not available.`, 'DEPENDENCY_UNAVAILABLE');
    }
  }
}

function manifestKind(manifest: InstalledAnyPackageManifest): 'app' | 'addon' {
  return manifest.schemaVersion === 2 ? manifest.kind : 'app';
}

function pointerSnapshot(row: ExistingInstalledModule): LifecyclePointers {
  return {
    activeReleaseId: row.active_release_id,
    activeConfigGenerationId: row.active_config_generation_id,
    activeKvGenerationId: row.active_kv_generation_id,
    activeGrantGenerationId: row.active_grant_generation_id,
    registryEpoch: row.registry_epoch,
  };
}

function createOperation(
  operationId: string,
  moduleId: string,
  releaseId: string | null,
  action: ModuleOperationAction,
  actorId: string | null,
  timestamp: string,
): void {
  rawDb.prepare(`
    INSERT INTO module_operations
      (id, module_id, release_id, action, stage, actor_id, outcome, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'requested', ?, 'pending', ?, ?)
  `).run(operationId, moduleId, releaseId, action, actorId, timestamp, timestamp);
}

function updateOperation(
  operationId: string,
  stage: string,
  timestamp: string,
  expectedPointers?: LifecyclePointers,
): void {
  rawDb.prepare(`
    UPDATE module_operations
    SET stage = ?, expected_pointers_json = COALESCE(?, expected_pointers_json), updated_at = ?
    WHERE id = ?
  `).run(stage, expectedPointers ? JSON.stringify(expectedPointers) : null, timestamp, operationId);
}

function finishOperation(operationId: string, outcome: 'succeeded' | 'failed', timestamp: string, errorCode?: string): void {
  rawDb.prepare(`
    UPDATE module_operations
    SET stage = 'complete', outcome = ?, error_code = ?, updated_at = ?
    WHERE id = ?
  `).run(outcome, errorCode ?? null, timestamp, operationId);
}

function acquireLifecycleLock(moduleId: string, operationId: string, timestamp: string): void {
  acquireModuleLifecycleLock(moduleId, operationId, timestamp);
}

function assertLifecycleLock(moduleId: string, operationId: string): void {
  assertModuleLifecycleLock(moduleId, operationId);
}

function releaseLifecycleLock(moduleId: string, operationId: string): void {
  releaseModuleLifecycleLock(moduleId, operationId);
}

function failOperation(operationId: string, moduleId: string | undefined, error: unknown): void {
  const failedAt = new Date().toISOString();
  const errorCode = error instanceof ModulePackageError ? error.code : 'LIFECYCLE_FAILED';
  try {
    rawDb.transaction(() => {
      finishOperation(operationId, 'failed', failedAt, errorCode);
      if (moduleId) releaseLifecycleLock(moduleId, operationId);
    }).immediate();
  } catch (operationError) {
    console.error('Failed to record Module operation failure', { operationId, operationError });
  }
}

function ensureIdentity(verifiedPackage: VerifiedModulePackage): ExistingInstalledModule | undefined {
  const { id, slug } = verifiedPackage.manifest;
  const legacyExpectedId = protectedLegacyIds[slug];
  if (legacyExpectedId && legacyExpectedId !== id) {
    throw new ModulePackageError(`The protected legacy slug ${slug} belongs to ${legacyExpectedId}.`, 'IDENTITY_CONFLICT');
  }
  const byId = rowById(id);
  if (byId && byId.slug !== slug) {
    throw new ModulePackageError(`Module ${id} cannot change its installed slug.`, 'IDENTITY_CONFLICT');
  }
  const bySlug = rowBySlug(slug);
  if (bySlug && bySlug.module_id !== id) {
    throw new ModulePackageError(`The slug ${slug} is already owned by another installed Module.`, 'IDENTITY_CONFLICT');
  }
  return byId;
}

function ensureInstalledModuleRow(
  verifiedPackage: VerifiedModulePackage,
  actorId: string,
  timestamp: string,
): { row: ExistingInstalledModule; created: boolean } {
  let created = false;
  rawDb.transaction(() => {
    const existing = ensureIdentity(verifiedPackage);
    if (existing) return;
    const legacyEnabled = rawDb.prepare('SELECT enabled FROM enabled_modules WHERE module_slug = ?')
      .get(verifiedPackage.manifest.slug) as { enabled: number } | undefined;
    rawDb.prepare(`
      INSERT INTO installed_modules
        (module_id, slug, enabled, lifecycle_state, installed_by, installed_at, updated_at)
      VALUES (?, ?, ?, 'staged', ?, ?, ?)
    `).run(
      verifiedPackage.manifest.id,
      verifiedPackage.manifest.slug,
      legacyEnabled?.enabled === 1 ? 1 : 0,
      actorId,
      timestamp,
      timestamp,
    );
    created = true;
  }).immediate();
  ensureInstalledModuleConfigGeneration(verifiedPackage.manifest.slug, actorId);
  const row = ensureIdentity(verifiedPackage);
  if (!row) throw new ModulePackageError('Module lifecycle row could not be created.', 'MODULE_NOT_INSTALLED');
  return { row, created };
}

function insertEmptyKvGeneration(moduleId: string, generationId: string, timestamp: string): void {
  rawDb.prepare(`
    INSERT INTO module_kv_generations (id, module_id, byte_count, created_at)
    VALUES (?, ?, 0, ?)
  `).run(generationId, moduleId, timestamp);
}

function createGrantGeneration(
  moduleId: string,
  generationId: string,
  manifest: Pick<InstalledAnyPackageManifest, 'capabilities'>,
  actorId: string,
  timestamp: string,
): void {
  rawDb.prepare(`
    INSERT INTO module_capability_grant_generations
      (id, module_id, grants_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    generationId,
    moduleId,
    JSON.stringify(manifest.capabilities.map(({ name }) => name)),
    actorId,
    timestamp,
  );
}

function snapshotActiveReleasePointers(current: ExistingInstalledModule): void {
  if (!current.active_release_id) return;
  const result = rawDb.prepare(`
    UPDATE module_releases
    SET config_generation_id = ?, kv_generation_id = ?
    WHERE id = ? AND module_id = ? AND state = 'active'
  `).run(
    current.active_config_generation_id,
    current.active_kv_generation_id,
    current.active_release_id,
    current.module_id,
  );
  if (result.changes !== 1) {
    throw new ModulePackageError('The active Module release changed while this lifecycle operation was running.', 'CONCURRENT_MODIFICATION');
  }
}

function retainActiveRelease(current: ExistingInstalledModule): void {
  if (!current.active_release_id) return;
  snapshotActiveReleasePointers(current);
  const result = rawDb.prepare(`
    UPDATE module_releases
    SET state = 'retained'
    WHERE id = ? AND module_id = ? AND state = 'active'
  `).run(current.active_release_id, current.module_id);
  if (result.changes !== 1) {
    throw new ModulePackageError('The active Module release changed while this lifecycle operation was running.', 'CONCURRENT_MODIFICATION');
  }
}

function releaseDataPointersWithFallback(
  release: ReleaseRow,
  fallback: ExistingInstalledModule,
): DataGenerationPointers {
  return {
    configGenerationId: release.config_generation_id ?? fallback.active_config_generation_id,
    kvGenerationId: release.kv_generation_id ?? fallback.active_kv_generation_id,
  };
}

function clearReleaseDataPointers(moduleId: string): void {
  rawDb.prepare(`
    UPDATE module_releases
    SET config_generation_id = NULL, kv_generation_id = NULL
    WHERE module_id = ?
  `).run(moduleId);
}

function updateInstalledModulePointers(
  moduleId: string,
  expected: LifecyclePointers,
  values: {
    activeReleaseId: string | null;
    activeConfigGenerationId: string | null;
    activeKvGenerationId: string | null;
    activeGrantGenerationId: string | null;
    enabled: boolean;
    lifecycleState: 'active' | 'disabled' | 'quarantined' | 'uninstalled' | 'error';
    timestamp: string;
  },
): void {
  const result = rawDb.prepare(`
    UPDATE installed_modules
    SET active_release_id = ?, active_config_generation_id = ?, active_kv_generation_id = ?,
        active_grant_generation_id = ?, enabled = ?, lifecycle_state = ?,
        registry_epoch = registry_epoch + 1, updated_at = ?
    WHERE module_id = ?
      AND registry_epoch = ?
      AND COALESCE(active_release_id, '') = COALESCE(?, '')
      AND COALESCE(active_config_generation_id, '') = COALESCE(?, '')
      AND COALESCE(active_kv_generation_id, '') = COALESCE(?, '')
      AND COALESCE(active_grant_generation_id, '') = COALESCE(?, '')
  `).run(
    values.activeReleaseId,
    values.activeConfigGenerationId,
    values.activeKvGenerationId,
    values.activeGrantGenerationId,
    values.enabled ? 1 : 0,
    values.lifecycleState,
    values.timestamp,
    moduleId,
    expected.registryEpoch,
    expected.activeReleaseId,
    expected.activeConfigGenerationId,
    expected.activeKvGenerationId,
    expected.activeGrantGenerationId,
  );
  if (result.changes !== 1) {
    throw new ModulePackageError('The Module changed while this lifecycle operation was running. Refresh and retry.', 'CONCURRENT_MODIFICATION');
  }
}

function validateRetentionChoice(value: string, label: string): ModuleRetentionChoice {
  if (value !== 'retain' && value !== 'delete') {
    throw new ModulePackageError(`${label} must be retain or delete.`, 'VALIDATION_ERROR');
  }
  return value;
}

function prepareExistingModuleOperation(
  slug: string,
  actorId: string | null,
  action: ModuleOperationAction,
  timestamp: string,
  operationId: string,
): PreparedLifecycleOperation {
  return rawDb.transaction(() => {
    const current = rowBySlug(slug);
    if (!current) throw new ModulePackageError('Module is not installed.', 'MODULE_NOT_INSTALLED');
    createOperation(operationId, current.module_id, current.active_release_id, action, actorId, timestamp);
    acquireLifecycleLock(current.module_id, operationId, timestamp);
    const expectedPointers = pointerSnapshot(current);
    updateOperation(operationId, 'locked', timestamp, expectedPointers);
    return { operationId, moduleId: current.module_id, expectedPointers };
  }).immediate();
}

async function reactivateInstalledPackageRelease(
  verifiedPackage: VerifiedModulePackage,
  target: ReleaseRow,
  actorId: string,
): Promise<InstallModuleResult> {
  assertReleaseActivationAllowed(verifiedPackage.digest, verifiedPackage.signerKeyId);
  const timestamp = new Date().toISOString();
  const operationId = randomUUID();
  const grantGenerationId = randomUUID();
  const kvGenerationId = randomUUID();
  let prepared: PreparedLifecycleOperation | undefined;
  let stored: StoredModuleArtifact | undefined;
  let releaseMutationDrain: (() => void) | undefined;
  try {
    prepared = prepareExistingModuleOperation(
      verifiedPackage.manifest.slug,
      actorId,
      'install',
      timestamp,
      operationId,
    );
    if (prepared.expectedPointers.activeReleaseId) {
      throw new ModulePackageError('That Module version is already installed.', 'VERSION_ALREADY_INSTALLED');
    }
    releaseMutationDrain = startModuleMutationDrain(prepared.moduleId, operationId);
    stored = await storeVerifiedModuleArtifact(verifiedPackage);
    rawDb.transaction(() => {
      assertLifecycleLock(prepared!.moduleId, operationId);
      const current = rowById(prepared!.moduleId);
      const currentTarget = releaseById(prepared!.moduleId, target.id);
      if (!current || current.active_release_id) {
        throw new ModulePackageError('The Module changed while reinstalling the retained release.', 'CONCURRENT_MODIFICATION');
      }
      if (
        !currentTarget
        || (currentTarget.state !== 'retained' && currentTarget.state !== 'pruned')
        || currentTarget.digest !== verifiedPackage.digest
      ) {
        throw new ModulePackageError('The retained release no longer matches this signed package.', 'RELEASE_NOT_RETAINED');
      }
      const targetPointers = releaseDataPointersWithFallback(currentTarget, current);
      const nextConfigGenerationId = targetPointers.configGenerationId;
      const nextKvGenerationId = targetPointers.kvGenerationId ?? kvGenerationId;
      if (!targetPointers.kvGenerationId) insertEmptyKvGeneration(prepared!.moduleId, kvGenerationId, timestamp);
      createGrantGeneration(prepared!.moduleId, grantGenerationId, verifiedPackage.manifest, actorId, timestamp);
      rawDb.prepare(`
        UPDATE module_releases
        SET state = 'active', artifact_path = ?, config_generation_id = ?, kv_generation_id = ?
        WHERE id = ? AND module_id = ?
      `).run(
        stored!.artifactPath,
        nextConfigGenerationId,
        nextKvGenerationId,
        currentTarget.id,
        prepared!.moduleId,
      );
      updateInstalledModulePointers(prepared!.moduleId, prepared!.expectedPointers, {
        activeReleaseId: currentTarget.id,
        activeConfigGenerationId: nextConfigGenerationId,
        activeKvGenerationId: nextKvGenerationId,
        activeGrantGenerationId: grantGenerationId,
        enabled: false,
        lifecycleState: 'disabled',
        timestamp,
      });
      finishOperation(operationId, 'succeeded', timestamp);
      releaseLifecycleLock(prepared!.moduleId, operationId);
    }).immediate();
    return {
      moduleId: prepared.moduleId,
      slug: verifiedPackage.manifest.slug,
      version: verifiedPackage.manifest.version,
      digest: verifiedPackage.digest,
      releaseId: target.id,
      operationId,
      enabled: false,
      signatureStatus: verifiedPackage.signatureStatus,
    };
  } catch (error) {
    failOperation(operationId, prepared?.moduleId, error);
    throw error;
  } finally {
    releaseMutationDrain?.();
  }
}

export async function installModulePackage(
  archive: Buffer,
  actorId: string,
  approval: ModuleInstallApproval,
  verifierOptions: ModuleVerifierOptions = {},
): Promise<InstallModuleResult> {
  const verifiedPackage = await verifyModulePackage(archive, verifierOptions);
  if (!/^[a-f0-9]{64}$/.test(approval.expectedDigest) || approval.expectedDigest !== verifiedPackage.digest) {
    throw new ModulePackageError('The Module package changed after approval. Review it again before installing.', 'APPROVAL_MISMATCH');
  }
  assertReleaseActivationAllowed(verifiedPackage.digest, verifiedPackage.signerKeyId);

  const timestamp = new Date().toISOString();
  const operationId = randomUUID();
  const releaseId = randomUUID();
  const kvGenerationId = randomUUID();
  const grantGenerationId = randomUUID();
  let moduleId: string | undefined;
  let createdModuleRow = false;
  let expectedPointers: LifecyclePointers | undefined;
  let previousReleaseId: string | undefined;
  let initiallyEnabled = false;
  let stored: StoredModuleArtifact | undefined;
  let releaseMutationDrain: (() => void) | undefined;

  try {
    const ensured = ensureInstalledModuleRow(verifiedPackage, actorId, timestamp);
    moduleId = ensured.row.module_id;
    createdModuleRow = ensured.created;
    previousReleaseId = ensured.row.active_release_id ?? undefined;
    const existingVersion = releaseByVersion(moduleId, verifiedPackage.manifest.version);
    if (
      !previousReleaseId
      && existingVersion
      && (existingVersion.state === 'retained' || existingVersion.state === 'pruned')
      && existingVersion.digest === verifiedPackage.digest
    ) {
      return await reactivateInstalledPackageRelease(verifiedPackage, existingVersion, actorId);
    }
    createOperation(operationId, moduleId, releaseId, previousReleaseId ? 'update' : 'install', actorId, timestamp);

    rawDb.transaction(() => {
      const current = ensureIdentity(verifiedPackage);
      if (!current) throw new ModulePackageError('Module is not installed.', 'MODULE_NOT_INSTALLED');
      previousReleaseId = current.active_release_id ?? undefined;
      if (releaseByVersion(current.module_id, verifiedPackage.manifest.version)) {
        throw new ModulePackageError('That Module version is already installed.', 'VERSION_ALREADY_INSTALLED');
      }
      acquireLifecycleLock(current.module_id, operationId, timestamp);
      initiallyEnabled = current.enabled === 1 && current.lifecycle_state !== 'uninstalled';
      expectedPointers = pointerSnapshot(current);
      updateOperation(operationId, 'staging_artifact', timestamp, expectedPointers);
    }).immediate();

    if (!moduleId || !expectedPointers) throw new ModulePackageError('Module install could not be prepared.', 'ACTIVATION_FAILED');
    if (previousReleaseId) releaseMutationDrain = startModuleMutationDrain(moduleId, operationId);
    stored = await storeVerifiedModuleArtifact(verifiedPackage);
    const storedArtifact = stored;

    rawDb.transaction(() => {
      assertLifecycleLock(moduleId!, operationId);
      const current = rowById(moduleId!);
      if (!current) throw new ModulePackageError('Module disappeared while activating the package.', 'MODULE_NOT_INSTALLED');
      if (releaseByVersion(moduleId!, verifiedPackage.manifest.version)) {
        throw new ModulePackageError('That Module version is already installed.', 'VERSION_ALREADY_INSTALLED');
      }
      updateOperation(operationId, 'activating', timestamp);

      if (initiallyEnabled) {
        if (manifestKind(verifiedPackage.manifest) === 'addon') {
          assertAddonDependenciesAvailable(verifiedPackage.manifest);
        } else {
          assertAppChangeKeepsEnabledAddons(verifiedPackage.manifest.id, verifiedPackage.manifest);
        }
      }

      let nextConfigGenerationId = current.active_config_generation_id;
      let nextKvGenerationId = current.active_kv_generation_id;
      if (current.active_release_id) {
        const currentRelease = releaseById(moduleId!, current.active_release_id);
        if (!currentRelease) {
          throw new ModulePackageError('The active Module release row is missing.', 'ACTIVATION_FAILED');
        }
        if (manifestKind(parseStoredManifest(currentRelease)) !== manifestKind(verifiedPackage.manifest)) {
          throw new ModulePackageError('An installed package cannot change between App and Add-on kinds.', 'PACKAGE_KIND_CHANGED');
        }
        const migratedPointers = applyDeclarativeDataMigration({
          moduleId: moduleId!,
          fromVersion: currentRelease.version,
          toManifest: verifiedPackage.manifest,
          currentConfigGenerationId: current.active_config_generation_id,
          currentKvGenerationId: current.active_kv_generation_id,
          actorId,
          timestamp,
        });
        nextConfigGenerationId = migratedPointers.configGenerationId;
        nextKvGenerationId = migratedPointers.kvGenerationId;
        retainActiveRelease(current);
      }
      if (!nextKvGenerationId) {
        insertEmptyKvGeneration(moduleId!, kvGenerationId, timestamp);
        nextKvGenerationId = kvGenerationId;
      }
      createGrantGeneration(moduleId!, grantGenerationId, verifiedPackage.manifest, actorId, timestamp);
      const packageKind = verifiedPackage.manifest.schemaVersion === 2
        ? verifiedPackage.manifest.kind
        : 'app';
      const dependencies = verifiedPackage.manifest.schemaVersion === 2
        ? verifiedPackage.manifest.dependencies ?? []
        : [];
      const operations = verifiedPackage.manifest.schemaVersion === 2
        ? verifiedPackage.manifest.operations
        : {};
      rawDb.prepare(`
        INSERT INTO module_releases
          (id, module_id, version, digest, artifact_path, manifest_json,
           ui_pages_json, ui_widgets_json, capabilities_json, signer_key_id,
           signature_status, state, config_generation_id, kv_generation_id,
           package_schema_version, package_kind, dependencies_json, operations_json,
           surfaces_json, connection_schema_json, installed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        releaseId,
        moduleId!,
        verifiedPackage.manifest.version,
        verifiedPackage.digest,
        storedArtifact.artifactPath,
        JSON.stringify(verifiedPackage.rawManifest),
        JSON.stringify(verifiedPackage.pages),
        JSON.stringify(verifiedPackage.widgets),
        JSON.stringify(verifiedPackage.manifest.capabilities),
        verifiedPackage.signerKeyId ?? null,
        verifiedPackage.signatureStatus,
        nextConfigGenerationId,
        nextKvGenerationId,
        verifiedPackage.manifest.schemaVersion,
        packageKind,
        JSON.stringify(dependencies),
        JSON.stringify(operations),
        verifiedPackage.surfaces ? JSON.stringify(verifiedPackage.surfaces) : null,
        verifiedPackage.connectionSchema ? JSON.stringify(verifiedPackage.connectionSchema) : null,
        timestamp,
      );
      ensureReleaseTrustRecord(releaseId, verifiedPackage.digest);
      if (packageKind !== 'addon') {
        ensureDefaultConnectionProfile(
          moduleId!,
          nextConfigGenerationId,
          actorId,
          verifiedPackage.manifest.schemaVersion,
        );
      }

      updateInstalledModulePointers(moduleId!, expectedPointers!, {
        activeReleaseId: releaseId,
        activeConfigGenerationId: nextConfigGenerationId,
        activeKvGenerationId: nextKvGenerationId,
        activeGrantGenerationId: grantGenerationId,
        enabled: initiallyEnabled,
        lifecycleState: initiallyEnabled ? 'active' : 'disabled',
        timestamp,
      });
      finishOperation(operationId, 'succeeded', timestamp);
      releaseLifecycleLock(moduleId!, operationId);
    }).immediate();
  } catch (error) {
    failOperation(operationId, moduleId, error);
    if (stored?.created) {
      try {
        const referenced = rawDb.prepare('SELECT 1 FROM module_releases WHERE digest = ? LIMIT 1')
          .get(verifiedPackage.digest);
        if (!referenced) await removeNewlyStoredModuleArtifact(stored, verifiedPackage);
      } catch (cleanupError) {
        console.error('Failed to clean a newly stored Module artifact', {
          moduleId: verifiedPackage.manifest.id,
          digest: verifiedPackage.digest,
          cleanupError,
        });
      }
    }
    if (createdModuleRow && moduleId) {
      try {
        rawDb.prepare(`
          DELETE FROM installed_modules
          WHERE module_id = ? AND active_release_id IS NULL AND lifecycle_state = 'staged'
        `).run(moduleId);
      } catch (cleanupError) {
        console.error('Failed to remove failed staged Module row', { moduleId, cleanupError });
      }
    }
    throw error;
  } finally {
    releaseMutationDrain?.();
  }

  if (!moduleId) throw new ModulePackageError('Module install did not reach activation.', 'ACTIVATION_FAILED');
  return {
    moduleId,
    slug: verifiedPackage.manifest.slug,
    version: verifiedPackage.manifest.version,
    digest: verifiedPackage.digest,
    releaseId,
    operationId,
    enabled: initiallyEnabled,
    signatureStatus: verifiedPackage.signatureStatus,
    replacedReleaseId: previousReleaseId,
  };
}

export function listModuleReleases(slug: string): ModuleReleaseSummary[] {
  const rows = rawDb.prepare(`
    SELECT module_releases.id, module_releases.module_id, module_releases.version,
           module_releases.digest, module_releases.signer_key_id, module_releases.artifact_path,
           module_releases.manifest_json, module_releases.state,
           module_releases.config_generation_id, module_releases.kv_generation_id,
           module_releases.installed_at
    FROM module_releases
    JOIN installed_modules ON installed_modules.module_id = module_releases.module_id
    WHERE installed_modules.slug = ? AND module_releases.state != 'rejected'
    ORDER BY module_releases.installed_at DESC, module_releases.id DESC
  `).all(slug) as ReleaseRow[];
  return rows.map((row) => ({
    releaseId: row.id,
    moduleId: row.module_id,
    version: row.version,
    digest: row.digest,
    signerKeyId: row.signer_key_id,
    activationBlocked: isReleaseQuarantined(row.digest, row.signer_key_id),
    state: row.state,
    installedAt: row.installed_at,
  }));
}

export async function rollbackModuleRelease(
  slug: string,
  actorId: string,
  options: RollbackModuleOptions,
): Promise<RollbackModuleResult> {
  if (Boolean(options.targetReleaseId) === Boolean(options.targetVersion)) {
    throw new ModulePackageError('Rollback requires exactly one target release ID or version.', 'VALIDATION_ERROR');
  }
  const timestamp = new Date().toISOString();
  const operationId = randomUUID();
  let prepared: PreparedLifecycleOperation | undefined;
  let releaseMutationDrain: (() => void) | undefined;
  try {
    prepared = prepareExistingModuleOperation(slug, actorId, 'rollback', timestamp, operationId);
    releaseMutationDrain = startModuleMutationDrain(prepared.moduleId, operationId);
    let result: RollbackModuleResult | undefined;
    rawDb.transaction(() => {
      assertLifecycleLock(prepared!.moduleId, operationId);
      const current = rowBySlug(slug);
      if (!current) throw new ModulePackageError('Module is not installed.', 'MODULE_NOT_INSTALLED');
      const target = options.targetReleaseId
        ? releaseById(prepared!.moduleId, options.targetReleaseId)
        : releaseByVersion(prepared!.moduleId, options.targetVersion!);
      if (!target) throw new ModulePackageError('The requested retained release does not exist.', 'RELEASE_NOT_FOUND');
      if (target.state !== 'retained') {
        throw new ModulePackageError('Rollback target must be a retained release that has not been pruned.', 'RELEASE_NOT_RETAINED');
      }
      assertReleaseActivationAllowed(target.digest, target.signer_key_id);
      const targetManifest = parseStoredManifest(target);
      const enabled = current.lifecycle_state !== 'uninstalled' && current.enabled === 1;
      if (enabled) {
        if (manifestKind(targetManifest) === 'addon') assertAddonDependenciesAvailable(targetManifest);
        else assertAppChangeKeepsEnabledAddons(targetManifest.id, targetManifest);
      }
      const targetPointers = releaseDataPointersWithFallback(target, current);
      const grantGenerationId = randomUUID();
      createGrantGeneration(prepared!.moduleId, grantGenerationId, parseStoredManifest(target), actorId, timestamp);
      updateOperation(operationId, 'activating', timestamp);
      retainActiveRelease(current);
      const activated = rawDb.prepare(`
        UPDATE module_releases
        SET state = 'active', config_generation_id = ?, kv_generation_id = ?
        WHERE id = ? AND module_id = ? AND state = 'retained'
      `).run(
        targetPointers.configGenerationId,
        targetPointers.kvGenerationId,
        target.id,
        prepared!.moduleId,
      );
      if (activated.changes !== 1) {
        throw new ModulePackageError('Rollback target changed while activating.', 'CONCURRENT_MODIFICATION');
      }
      updateInstalledModulePointers(prepared!.moduleId, prepared!.expectedPointers, {
        activeReleaseId: target.id,
        activeConfigGenerationId: targetPointers.configGenerationId,
        activeKvGenerationId: targetPointers.kvGenerationId,
        activeGrantGenerationId: grantGenerationId,
        enabled,
        lifecycleState: enabled ? 'active' : 'disabled',
        timestamp,
      });
      finishOperation(operationId, 'succeeded', timestamp);
      releaseLifecycleLock(prepared!.moduleId, operationId);
      result = {
        moduleId: prepared!.moduleId,
        slug,
        version: target.version,
        digest: target.digest,
        releaseId: target.id,
        operationId,
        enabled,
        replacedReleaseId: current.active_release_id ?? undefined,
      };
    }).immediate();
    return result!;
  } catch (error) {
    failOperation(operationId, prepared?.moduleId, error);
    throw error;
  } finally {
    releaseMutationDrain?.();
  }
}

export async function setInstalledModuleEnabled(
  slug: string,
  enabled: boolean,
  actorId: string,
): Promise<SetInstalledModuleEnabledResult> {
  const timestamp = new Date().toISOString();
  const operationId = randomUUID();
  let prepared: PreparedLifecycleOperation | undefined;
  let releaseMutationDrain: (() => void) | undefined;
  try {
    prepared = prepareExistingModuleOperation(slug, actorId, enabled ? 'activate' : 'disable', timestamp, operationId);
    releaseMutationDrain = startModuleMutationDrain(prepared.moduleId, operationId);
    let result: SetInstalledModuleEnabledResult | undefined;
    rawDb.transaction(() => {
      assertLifecycleLock(prepared!.moduleId, operationId);
      const current = rowBySlug(slug);
      if (!current) throw new ModulePackageError('Module is not installed.', 'MODULE_NOT_INSTALLED');
      if (!current.active_release_id) {
        throw new ModulePackageError('The Module has no active release. Roll back to a retained release first.', 'MODULE_UNINSTALLED');
      }
      if (enabled) {
        const activeRelease = releaseById(prepared!.moduleId, current.active_release_id);
        if (!activeRelease) {
          throw new ModulePackageError('The active Module release row is missing.', 'ACTIVATION_FAILED');
        }
        assertReleaseActivationAllowed(activeRelease.digest, activeRelease.signer_key_id);
        const activeManifest = parseStoredManifest(activeRelease);
        if (manifestKind(activeManifest) === 'addon') assertAddonDependenciesAvailable(activeManifest);
      } else {
        const activeRelease = releaseById(prepared!.moduleId, current.active_release_id);
        if (!activeRelease) throw new ModulePackageError('The active Module release row is missing.', 'ACTIVATION_FAILED');
        if (manifestKind(parseStoredManifest(activeRelease)) === 'app') {
          assertAppChangeKeepsEnabledAddons(prepared!.moduleId);
        }
      }
      const currentlyEnabled = current.enabled === 1 && current.lifecycle_state === 'active';
      const changed = currentlyEnabled !== enabled;
      updateOperation(operationId, changed ? 'updating_state' : 'noop', timestamp);
      if (changed) {
        updateInstalledModulePointers(prepared!.moduleId, prepared!.expectedPointers, {
          activeReleaseId: current.active_release_id,
          activeConfigGenerationId: current.active_config_generation_id,
          activeKvGenerationId: current.active_kv_generation_id,
          activeGrantGenerationId: current.active_grant_generation_id,
          enabled,
          lifecycleState: enabled ? 'active' : 'disabled',
          timestamp,
        });
      }
      finishOperation(operationId, 'succeeded', timestamp);
      releaseLifecycleLock(prepared!.moduleId, operationId);
      result = { moduleId: prepared!.moduleId, slug, enabled, operationId, changed };
    }).immediate();
    return result!;
  } catch (error) {
    failOperation(operationId, prepared?.moduleId, error);
    throw error;
  } finally {
    releaseMutationDrain?.();
  }
}

/**
 * Fail closed for an exact active release after a verified Marketplace
 * revocation. Package bytes, configuration, storage, grants and history stay
 * intact so an administrator can inspect the incident and install a reviewed
 * replacement. Quarantine is not an uninstall and is never silently cleared.
 */
export async function quarantineInstalledModule(
  slug: string,
  reasonId: string,
  expectedDigest: string,
): Promise<QuarantineInstalledModuleResult> {
  const timestamp = new Date().toISOString();
  const operationId = randomUUID();
  let prepared: PreparedLifecycleOperation | undefined;
  let releaseInvocationDrain: (() => void) | undefined;
  try {
    prepared = prepareExistingModuleOperation(slug, null, 'quarantine', timestamp, operationId);
    releaseInvocationDrain = startModuleInvocationDrain(prepared.moduleId, operationId);
    let result: QuarantineInstalledModuleResult | undefined;
    rawDb.transaction(() => {
      assertLifecycleLock(prepared!.moduleId, operationId);
      const current = rowBySlug(slug);
      if (!current || !current.active_release_id) {
        throw new ModulePackageError('The Module has no active release to quarantine.', 'MODULE_NOT_INSTALLED');
      }
      const activeRelease = releaseById(prepared!.moduleId, current.active_release_id);
      if (!activeRelease) {
        throw new ModulePackageError('The active Module release row is missing.', 'ACTIVATION_FAILED');
      }
      if (activeRelease.digest !== expectedDigest
        || !isReleaseQuarantined(activeRelease.digest, activeRelease.signer_key_id)) {
        throw new ModulePackageError(
          'The active Plugin release changed before quarantine could be applied.',
          'CONCURRENT_MODIFICATION',
        );
      }
      const changed = current.enabled === 1 || current.lifecycle_state !== 'quarantined';
      updateOperation(operationId, changed ? 'quarantining' : 'noop', timestamp);
      if (changed) {
        updateInstalledModulePointers(prepared!.moduleId, prepared!.expectedPointers, {
          activeReleaseId: current.active_release_id,
          activeConfigGenerationId: current.active_config_generation_id,
          activeKvGenerationId: current.active_kv_generation_id,
          activeGrantGenerationId: current.active_grant_generation_id,
          enabled: false,
          lifecycleState: 'quarantined',
          timestamp,
        });
      }
      finishOperation(operationId, 'succeeded', timestamp);
      releaseLifecycleLock(prepared!.moduleId, operationId);
      result = {
        moduleId: prepared!.moduleId,
        slug,
        releaseId: activeRelease.id,
        digest: activeRelease.digest,
        operationId,
        changed,
      };
    }).immediate();
    if (result!.changed) {
      try {
        await logAuditEvent(
          null,
          'quarantine_module',
          slug,
          {
            operationId,
            releaseId: result!.releaseId,
            digest: result!.digest,
            reasonId,
          },
        );
      } catch (auditError) {
        // Quarantine is the security boundary and has already committed. An
        // audit write failure must not relabel the completed lifecycle
        // operation as failed or make the revoked release executable again.
        console.error('Plugin quarantine audit failed', {
          moduleSlug: slug,
          operationId,
          errorType: auditError instanceof Error ? auditError.name : typeof auditError,
        });
      }
    }
    return result!;
  } catch (error) {
    failOperation(operationId, prepared?.moduleId, error);
    throw error;
  } finally {
    releaseInvocationDrain?.();
  }
}

function releaseArtifactPointer(row: ReleaseRow): ModuleArtifactPointer {
  return { moduleId: row.module_id, digest: row.digest, artifactPath: row.artifact_path };
}

async function validateArtifactPointers(rows: ReleaseRow[]): Promise<void> {
  for (const row of rows) await assertSafeStoredModuleArtifactPointer(releaseArtifactPointer(row));
}

async function cleanupPrunedArtifacts(rows: ReleaseRow[]): Promise<void> {
  for (const row of rows) {
    try {
      await removeStoredModuleArtifact(releaseArtifactPointer(row));
    } catch (error) {
      console.error('A pruned Module artifact could not be removed after the database transition committed.', {
        moduleId: row.module_id,
        releaseId: row.id,
        digest: row.digest,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }
}

export async function uninstallModule(
  slug: string,
  actorId: string,
  options: UninstallModuleOptions,
): Promise<UninstallModuleResult> {
  const configAndStorage = validateRetentionChoice(options.configAndStorage, 'configAndStorage');
  const artifacts = validateRetentionChoice(options.artifacts, 'artifacts');
  const timestamp = new Date().toISOString();
  const operationId = randomUUID();
  let prepared: PreparedLifecycleOperation | undefined;
  let releasesToDelete: ReleaseRow[] = [];
  let prunedArtifacts = 0;
  let retainedArtifacts = 0;
  let releaseMutationDrain: (() => void) | undefined;
  let releaseInvocationDrain: (() => void) | undefined;
  try {
    prepared = prepareExistingModuleOperation(slug, actorId, 'uninstall', timestamp, operationId);
    if (configAndStorage === 'delete' || artifacts === 'delete') {
      releaseInvocationDrain = startModuleInvocationDrain(prepared.moduleId, operationId);
    } else {
      releaseMutationDrain = startModuleMutationDrain(prepared.moduleId, operationId);
    }
    rawDb.transaction(() => {
      assertLifecycleLock(prepared!.moduleId, operationId);
      const current = rowBySlug(slug);
      if (!current) throw new ModulePackageError('Module is not installed.', 'MODULE_NOT_INSTALLED');
      if (current.active_release_id) {
        const activeRelease = releaseById(prepared!.moduleId, current.active_release_id);
        if (activeRelease && manifestKind(parseStoredManifest(activeRelease)) === 'app') {
          assertAppChangeKeepsEnabledAddons(prepared!.moduleId);
        }
      }
      const releases = rawDb.prepare(`
        SELECT id, module_id, version, digest, signer_key_id, artifact_path, manifest_json, state,
               config_generation_id, kv_generation_id, installed_at
        FROM module_releases
        WHERE module_id = ? AND state IN ('active', 'retained')
      `).all(prepared!.moduleId) as ReleaseRow[];
      retainedArtifacts = artifacts === 'retain' ? releases.length : 0;
      if (artifacts === 'delete') {
        const previouslyPruned = rawDb.prepare(`
          SELECT id, module_id, version, digest, signer_key_id, artifact_path, manifest_json, state,
                 config_generation_id, kv_generation_id, installed_at
          FROM module_releases
          WHERE module_id = ? AND state = 'pruned'
        `).all(prepared!.moduleId) as ReleaseRow[];
        releasesToDelete = [...releases, ...previouslyPruned];
      } else if (current.active_release_id) {
        retainActiveRelease(current);
      }
      if (artifacts === 'delete') snapshotActiveReleasePointers(current);
      updateOperation(operationId, artifacts === 'delete' ? 'validating_artifacts' : 'complete', timestamp);
      if (artifacts === 'retain') {
        updateInstalledModulePointers(prepared!.moduleId, prepared!.expectedPointers, {
          activeReleaseId: null,
          activeConfigGenerationId: configAndStorage === 'retain' ? current.active_config_generation_id : null,
          activeKvGenerationId: configAndStorage === 'retain' ? current.active_kv_generation_id : null,
          activeGrantGenerationId: null,
          enabled: false,
          lifecycleState: 'uninstalled',
          timestamp,
        });
        if (configAndStorage === 'delete') {
          rawDb.prepare('DELETE FROM module_configs WHERE module_slug = ?').run(slug);
          rawDb.prepare('DELETE FROM module_config_generations WHERE module_id = ?').run(prepared!.moduleId);
          rawDb.prepare('DELETE FROM module_kv_generations WHERE module_id = ?').run(prepared!.moduleId);
          clearReleaseDataPointers(prepared!.moduleId);
        }
        finishOperation(operationId, 'succeeded', timestamp);
        releaseLifecycleLock(prepared!.moduleId, operationId);
      }
    }).immediate();

    if (artifacts === 'delete') {
      await validateArtifactPointers(releasesToDelete);
      prunedArtifacts = releasesToDelete.length;
      rawDb.transaction(() => {
        assertLifecycleLock(prepared!.moduleId, operationId);
        const current = rowBySlug(slug);
        if (!current) throw new ModulePackageError('Module is not installed.', 'MODULE_NOT_INSTALLED');
        updateOperation(operationId, 'committing_prune', new Date().toISOString());
        rawDb.prepare("UPDATE module_releases SET state = 'pruned' WHERE module_id = ? AND state IN ('active', 'retained')")
          .run(prepared!.moduleId);
        updateInstalledModulePointers(prepared!.moduleId, prepared!.expectedPointers, {
          activeReleaseId: null,
          activeConfigGenerationId: configAndStorage === 'retain' ? current.active_config_generation_id : null,
          activeKvGenerationId: configAndStorage === 'retain' ? current.active_kv_generation_id : null,
          activeGrantGenerationId: null,
          enabled: false,
          lifecycleState: 'uninstalled',
          timestamp: new Date().toISOString(),
        });
        if (configAndStorage === 'delete') {
          rawDb.prepare('DELETE FROM module_configs WHERE module_slug = ?').run(slug);
          rawDb.prepare('DELETE FROM module_config_generations WHERE module_id = ?').run(prepared!.moduleId);
          rawDb.prepare('DELETE FROM module_kv_generations WHERE module_id = ?').run(prepared!.moduleId);
          clearReleaseDataPointers(prepared!.moduleId);
        }
        finishOperation(operationId, 'succeeded', new Date().toISOString());
        releaseLifecycleLock(prepared!.moduleId, operationId);
      }).immediate();
      await cleanupPrunedArtifacts(releasesToDelete);
    }
    return {
      moduleId: prepared.moduleId,
      slug,
      operationId,
      configAndStorage,
      artifacts,
      prunedArtifacts,
      retainedArtifacts,
    };
  } catch (error) {
    failOperation(operationId, prepared?.moduleId, error);
    throw error;
  } finally {
    releaseMutationDrain?.();
    releaseInvocationDrain?.();
  }
}

export async function pruneModuleArtifacts(
  slug: string,
  actorId: string,
  options: PruneModuleArtifactsOptions,
): Promise<PruneModuleArtifactsResult> {
  if (!Number.isInteger(options.keepRetainedReleases) || options.keepRetainedReleases < 0 || options.keepRetainedReleases > 32) {
    throw new ModulePackageError('keepRetainedReleases must be an integer from 0 to 32.', 'VALIDATION_ERROR');
  }
  const timestamp = new Date().toISOString();
  const operationId = randomUUID();
  let prepared: PreparedLifecycleOperation | undefined;
  let releasesToDelete: ReleaseRow[] = [];
  let releasesToPrune: ReleaseRow[] = [];
  let retainedArtifacts = 0;
  let releaseMutationDrain: (() => void) | undefined;
  try {
    prepared = prepareExistingModuleOperation(slug, actorId, 'prune', timestamp, operationId);
    releaseMutationDrain = startModuleMutationDrain(prepared.moduleId, operationId);
    rawDb.transaction(() => {
      assertLifecycleLock(prepared!.moduleId, operationId);
      const retained = rawDb.prepare(`
        SELECT id, module_id, version, digest, signer_key_id, artifact_path, manifest_json, state,
               config_generation_id, kv_generation_id, installed_at
        FROM module_releases
        WHERE module_id = ? AND state = 'retained'
        ORDER BY installed_at DESC, id DESC
      `).all(prepared!.moduleId) as ReleaseRow[];
      const previouslyPruned = rawDb.prepare(`
        SELECT id, module_id, version, digest, signer_key_id, artifact_path, manifest_json, state,
               config_generation_id, kv_generation_id, installed_at
        FROM module_releases
        WHERE module_id = ? AND state = 'pruned'
      `).all(prepared!.moduleId) as ReleaseRow[];
      const toKeep = new Set(retained.slice(0, options.keepRetainedReleases).map(({ id }) => id));
      releasesToPrune = retained.filter(({ id }) => !toKeep.has(id));
      assertModuleReleasesIdle(prepared!.moduleId, releasesToPrune.map(({ id }) => id));
      retainedArtifacts = toKeep.size;
      releasesToDelete = [...releasesToPrune, ...previouslyPruned];
      updateOperation(operationId, 'validating_artifacts', timestamp);
    }).immediate();
    await validateArtifactPointers(releasesToDelete);
    const prunedArtifacts = releasesToDelete.length;
    rawDb.transaction(() => {
      assertLifecycleLock(prepared!.moduleId, operationId);
      updateOperation(operationId, 'committing_prune', new Date().toISOString());
      if (releasesToPrune.length) {
        const placeholders = releasesToPrune.map(() => '?').join(', ');
        rawDb.prepare(`
          UPDATE module_releases SET state = 'pruned'
          WHERE module_id = ? AND state = 'retained' AND id IN (${placeholders})
        `).run(prepared!.moduleId, ...releasesToPrune.map(({ id }) => id));
      }
      finishOperation(operationId, 'succeeded', new Date().toISOString());
      releaseLifecycleLock(prepared!.moduleId, operationId);
    }).immediate();
    await cleanupPrunedArtifacts(releasesToDelete);
    return { moduleId: prepared.moduleId, slug, operationId, prunedArtifacts, retainedArtifacts };
  } catch (error) {
    failOperation(operationId, prepared?.moduleId, error);
    throw error;
  } finally {
    releaseMutationDrain?.();
  }
}
