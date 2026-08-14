import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

interface RuntimeContractLock {
  hostApiVersion: string;
  hostApiCompatibility: string;
  uiApiVersion: string;
  uiApiCompatibility: string;
  packageSchemaVersion: number;
  contractVersion: string;
}

function readRuntimeContractLock(version: 'v1' | 'v2'): RuntimeContractLock | undefined {
  const path = join(
    process.cwd(),
    'src',
    'lib',
    'modules',
    'contracts',
    version,
    'contract-lock.generated.json',
  );
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RuntimeContractLock>;
  if (
    typeof value.hostApiVersion !== 'string'
    || typeof value.hostApiCompatibility !== 'string'
    || typeof value.uiApiVersion !== 'string'
    || typeof value.uiApiCompatibility !== 'string'
    || typeof value.packageSchemaVersion !== 'number'
    || typeof value.contractVersion !== 'string'
  ) {
    throw new Error(`Invalid generated Module contract lock at ${path}.`);
  }
  return value as RuntimeContractLock;
}

const contractLock = readRuntimeContractLock('v1');
if (!contractLock) throw new Error('The generated Module v1 contract lock is missing.');
const runtimeContractLocks = [contractLock, readRuntimeContractLock('v2')]
  .filter((lock): lock is RuntimeContractLock => Boolean(lock));

function readRootVersion(): string {
  try {
    const version = readFileSync(join(process.cwd(), 'VERSION'), 'utf8').trim();
    return VERSION_PATTERN.test(version) ? version : 'dev';
  } catch {
    return 'dev';
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const NAD_CORE_VERSION = nonEmpty(process.env.NAD_VERSION) ?? readRootVersion();
export const NAD_HOST_API_VERSION = contractLock.hostApiVersion;
export const NAD_HOST_API_COMPATIBILITY = contractLock.hostApiCompatibility;
export const NAD_UI_API_VERSION = contractLock.uiApiVersion;
export const NAD_UI_API_COMPATIBILITY = contractLock.uiApiCompatibility;
export const NAD_MODULE_PACKAGE_SCHEMA_VERSION = contractLock.packageSchemaVersion;
export const NAD_MODULE_PACKAGE_SCHEMA_DISPLAY_VERSION = contractLock.contractVersion;
export const NAD_SUPPORTED_HOST_API_VERSIONS = [...new Set(runtimeContractLocks.map((lock) => lock.hostApiVersion))];
export const NAD_SUPPORTED_HOST_API_COMPATIBILITY = [...new Set(runtimeContractLocks.map((lock) => lock.hostApiCompatibility))];
export const NAD_SUPPORTED_UI_API_VERSIONS = [...new Set(runtimeContractLocks.map((lock) => lock.uiApiVersion))];
export const NAD_SUPPORTED_UI_API_COMPATIBILITY = [...new Set(runtimeContractLocks.map((lock) => lock.uiApiCompatibility))];
export const NAD_SUPPORTED_MODULE_PACKAGE_SCHEMA_VERSIONS = [...new Set(
  runtimeContractLocks.map((lock) => lock.packageSchemaVersion),
)].sort((left, right) => left - right);
export const NAD_DENO_VERSION = '2.7.7' as const;
export const NAD_SOURCE_REPOSITORY = 'https://github.com/robrolabs/nad' as const;

export interface NadBuildMetadata {
  coreVersion: string;
  hostApiVersion: string;
  hostApiCompatibility: string;
  uiApiVersion: string;
  uiApiCompatibility: string;
  modulePackageSchemaVersion: number;
  modulePackageSchemaDisplayVersion: string;
  supportedHostApiVersions: string[];
  supportedHostApiCompatibility: string[];
  supportedUiApiVersions: string[];
  supportedUiApiCompatibility: string[];
  supportedModulePackageSchemaVersions: number[];
  nodeVersion: string;
  denoVersion: string;
  buildVersion: string;
  buildRevision: string | null;
  buildCreatedAt: string | null;
  sourceRepository: string;
}

export function getBuildMetadata(): NadBuildMetadata {
  return {
    coreVersion: NAD_CORE_VERSION,
    hostApiVersion: NAD_HOST_API_VERSION,
    hostApiCompatibility: NAD_HOST_API_COMPATIBILITY,
    uiApiVersion: NAD_UI_API_VERSION,
    uiApiCompatibility: NAD_UI_API_COMPATIBILITY,
    modulePackageSchemaVersion: NAD_MODULE_PACKAGE_SCHEMA_VERSION,
    modulePackageSchemaDisplayVersion: NAD_MODULE_PACKAGE_SCHEMA_DISPLAY_VERSION,
    supportedHostApiVersions: [...NAD_SUPPORTED_HOST_API_VERSIONS],
    supportedHostApiCompatibility: [...NAD_SUPPORTED_HOST_API_COMPATIBILITY],
    supportedUiApiVersions: [...NAD_SUPPORTED_UI_API_VERSIONS],
    supportedUiApiCompatibility: [...NAD_SUPPORTED_UI_API_COMPATIBILITY],
    supportedModulePackageSchemaVersions: [...NAD_SUPPORTED_MODULE_PACKAGE_SCHEMA_VERSIONS],
    nodeVersion: process.version,
    denoVersion: nonEmpty(process.env.NAD_DENO_VERSION) ?? NAD_DENO_VERSION,
    buildVersion: nonEmpty(process.env.NAD_VERSION)
      ?? nonEmpty(process.env.NAD_BUILD_VERSION)
      ?? NAD_CORE_VERSION,
    buildRevision: nonEmpty(process.env.NAD_GIT_REVISION)
      ?? nonEmpty(process.env.NAD_BUILD_REVISION)
      ?? null,
    buildCreatedAt: nonEmpty(process.env.NAD_BUILD_DATE)
      ?? nonEmpty(process.env.NAD_BUILD_CREATED)
      ?? null,
    sourceRepository: nonEmpty(process.env.NAD_SOURCE_URL)
      ?? nonEmpty(process.env.NAD_BUILD_SOURCE)
      ?? NAD_SOURCE_REPOSITORY,
  };
}
