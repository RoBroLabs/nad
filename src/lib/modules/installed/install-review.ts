import 'server-only';

import { getInstalledModule } from '@/lib/modules/installed/provider';
import type {
  InstalledAnyPackageManifest,
  VerifiedModulePackage,
} from '@/lib/modules/installed/package-types';
import type {
  ModuleInstallReview,
  ModuleReviewCapability,
  ModuleReviewConfigField,
  ModuleReviewHttpAccess,
  ModuleReviewPermission,
  ModuleUpdateChanges,
} from '@/lib/modules/installed/install-review-types';
import type { ModuleManifest } from '@/lib/modules/types';

export type { ModuleInstallReview } from '@/lib/modules/installed/install-review-types';

type ReviewManifest = Pick<ModuleManifest, 'capabilities' | 'permissions' | 'configSchema' | 'httpAccess'>;

interface ReviewProjection {
  capabilities: ModuleReviewCapability[];
  permissions: ModuleReviewPermission[];
  configFields: ModuleReviewConfigField[];
  httpAccess: ModuleReviewHttpAccess[];
}

function projectManifest(manifest: ReviewManifest): ReviewProjection {
  const configFields = manifest.configSchema.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    ...(field.description === undefined ? {} : { description: field.description }),
    ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
    ...(field.min === undefined ? {} : { min: field.min }),
    ...(field.max === undefined ? {} : { max: field.max }),
    ...(field.options === undefined ? {} : { options: field.options }),
  }));
  const fieldByKey = new Map(configFields.map((field) => [field.key, field]));
  return {
    capabilities: (manifest.capabilities ?? []).map(({ name, reason }) => ({ name, reason })),
    permissions: manifest.permissions.map(({ action, label, description, defaultRole }) => ({
      action,
      label,
      description,
      defaultRole,
    })),
    configFields,
    httpAccess: (manifest.httpAccess ?? []).map((scope) => {
      const hostField = fieldByKey.get(scope.hostConfig);
      const portField = scope.portConfig ? fieldByKey.get(scope.portConfig) : undefined;
      const credentialField = scope.credential ? fieldByKey.get(scope.credential.config) : undefined;
      const publicCredentialField = scope.credential?.publicConfig
        ? fieldByKey.get(scope.credential.publicConfig)
        : undefined;
      const tlsVerificationField = scope.tlsVerifyConfig
        ? fieldByKey.get(scope.tlsVerifyConfig)
        : undefined;
      if (!hostField || (scope.portConfig && !portField)) {
        throw new Error('Installed Module network scope references an unknown configuration field.');
      }
      return {
        scheme: scope.scheme,
        hostConfig: { key: hostField.key, label: hostField.label },
        port: portField
          ? { key: portField.key, label: portField.label }
          : scope.port ?? { key: hostField.key, label: `${hostField.label} port` },
        path: scope.path,
        methods: scope.methods,
        effect: scope.effect ?? (scope.methods.every((method) => method === 'GET') ? 'read' : 'write'),
        ...(scope.requestBodyPolicy ? { requestBodyPolicy: scope.requestBodyPolicy } : {}),
        allowedHeaders: [...(scope.allowedHeaders ?? [])],
        queryParameters: [...(scope.queryParameters ?? [])],
        pathParameters: { ...(scope.pathParameters ?? {}) },
        ...(scope.credential && credentialField ? {
          credential: {
            config: { key: credentialField.key, label: credentialField.label },
            location: scope.credential.location,
            name: scope.credential.name,
            ...(publicCredentialField ? {
              publicConfig: { key: publicCredentialField.key, label: publicCredentialField.label },
            } : {}),
          },
        } : {}),
        ...(tlsVerificationField ? {
          tlsVerification: { key: tlsVerificationField.key, label: tlsVerificationField.label },
        } : {}),
      };
    }),
  };
}

function reviewManifest(manifest: InstalledAnyPackageManifest): ReviewManifest {
  if (manifest.schemaVersion === 1) return manifest;
  return {
    capabilities: manifest.capabilities,
    permissions: manifest.permissions,
    configSchema: manifest.configSchema,
    httpAccess: manifest.httpAccess?.map((scope) => ({
      scheme: scope.scheme,
      hostConfig: scope.hostField,
      ...(scope.port === undefined ? {} : { port: scope.port }),
      ...(scope.portField ? { portConfig: scope.portField } : {}),
      path: scope.path,
      methods: scope.methods,
      effect: scope.effect,
      ...(scope.requestBodyPolicy ? { requestBodyPolicy: scope.requestBodyPolicy } : {}),
      ...(scope.allowedHeaders ? { allowedHeaders: scope.allowedHeaders } : {}),
      ...(scope.queryParameters ? { queryParameters: scope.queryParameters } : {}),
      ...(scope.pathParameters ? { pathParameters: scope.pathParameters } : {}),
      ...(scope.credential ? {
        credential: {
          config: scope.credential.field,
          location: scope.credential.location,
          name: scope.credential.name,
          ...(scope.credential.prefix ? { prefix: scope.credential.prefix } : {}),
          ...(scope.credential.publicField ? { publicConfig: scope.credential.publicField } : {}),
          ...(scope.credential.separator ? { separator: scope.credential.separator } : {}),
        },
      } : {}),
      ...(scope.tlsVerifyField ? { tlsVerifyConfig: scope.tlsVerifyField } : {}),
    })),
  };
}

function diffByKey<T>(
  before: T[],
  after: T[],
  key: (value: T) => string,
): { added: T[]; removed: T[]; changed: Array<{ before: T; after: T }> } {
  const previous = new Map(before.map((value) => [key(value), value]));
  const next = new Map(after.map((value) => [key(value), value]));
  return {
    added: after.filter((value) => !previous.has(key(value))),
    removed: before.filter((value) => !next.has(key(value))),
    changed: after.flatMap((value) => {
      const prior = previous.get(key(value));
      if (!prior || JSON.stringify(prior) === JSON.stringify(value)) return [];
      return [{ before: prior, after: value }];
    }),
  };
}

function httpScopeKey(scope: ModuleReviewHttpAccess): string {
  const port = typeof scope.port === 'number' ? String(scope.port) : scope.port.key;
  return `${scope.scheme}:${scope.hostConfig.key}:${port}:${scope.path}`;
}

export function createModuleUpdateChanges(
  current: ReviewManifest,
  next: ReviewManifest,
): ModuleUpdateChanges {
  const before = projectManifest(current);
  const after = projectManifest(next);
  return {
    capabilities: diffByKey(before.capabilities, after.capabilities, ({ name }) => name),
    permissions: diffByKey(before.permissions, after.permissions, ({ action }) => action),
    configFields: diffByKey(before.configFields, after.configFields, ({ key }) => key),
    httpAccess: diffByKey(before.httpAccess, after.httpAccess, httpScopeKey),
    dataMigration: {
      mode: 'reuse',
      summary: 'Package schema v1 reuses the existing configuration and storage generations; no package code migration runs during this update.',
    },
  };
}

export function createModuleInstallReview(verified: VerifiedModulePackage): ModuleInstallReview {
  const current = getInstalledModule(verified.manifest.slug);
  const nextReviewManifest = reviewManifest(verified.manifest);
  const projected = projectManifest(nextReviewManifest);
  return {
    moduleId: verified.manifest.id,
    slug: verified.manifest.slug,
    name: verified.manifest.name,
    publisher: verified.manifest.publisher,
    version: verified.manifest.version,
    currentVersion: current?.manifest.version,
    operation: current ? 'update' : 'install',
    digest: verified.digest,
    signatureStatus: verified.signatureStatus,
    signerKeyId: verified.signerKeyId,
    compatibility: verified.manifest.compatibility,
    capabilities: projected.capabilities,
    permissions: projected.permissions,
    configFields: projected.configFields,
    secretConfigFields: nextReviewManifest.configSchema
      .filter(({ type }) => type === 'secret')
      .map(({ key, label }) => ({ key, label })),
    networkConfigFields: nextReviewManifest.configSchema
      .filter(({ key }) => /(?:host|address|url|endpoint)/i.test(key))
      .map(({ key, label }) => ({ key, label })),
    httpAccess: projected.httpAccess,
    ...(current ? { changes: createModuleUpdateChanges(current.manifest, nextReviewManifest) } : {}),
  };
}
