import 'server-only';

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, normalize, sep } from 'node:path';
import { fromBufferPromise, type Entry } from 'yauzl';
import {
  assertEndpointSchemaDocument,
} from '@/lib/modules/installed/json-schema';
import {
  ModulePackageError,
  type InstalledPackageManifestV2,
  type PackageChecksums,
  type VerifiedModulePackage,
} from '@/lib/modules/installed/package-types';
import type { NADV2ConnectionProfileSchema, NADUIAPIV2Surfaces } from '@/lib/modules/contracts/v2';
import {
  parseAnyPackageManifest,
  applyConnectionSchemaV2,
  parseChecksums,
  parseConnectionSchemaV2,
  parseJsonFile,
  parsePageDocument,
  parseSignature,
  parseSurfaceDocumentV2,
  parseWidgetDocument,
} from '@/lib/modules/installed/package-schema';
import { getDataDirectory } from '@/lib/runtime/data-dir';
import {
  NAD_CORE_VERSION,
  NAD_HOST_API_COMPATIBILITY,
  NAD_UI_API_COMPATIBILITY,
  NAD_SUPPORTED_HOST_API_COMPATIBILITY,
  NAD_SUPPORTED_UI_API_COMPATIBILITY,
} from '@/lib/runtime/build-info';
import { builtInModuleTrustRoots } from '@/lib/modules/installed/trusted-keys';

export const MODULE_ARCHIVE_LIMITS = {
  compressedBytes: 25 * 1024 * 1024,
  uncompressedBytes: 100 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024,
  files: 100,
  pathBytes: 240,
  compressionRatio: 100,
} as const;

const requiredFiles = [
  'manifest.json',
  'server/main.js',
  'ui/pages.json',
  'ui/widgets.json',
  'schemas/config.json',
  'README.md',
  'LICENSE',
  'assets/icon.png',
  'checksums.json',
  'signature.json',
] as const;

export interface ModuleVerifierOptions {
  allowUnsigned?: boolean;
  coreVersion?: string;
  trustedKeys?: Record<string, string>;
}

function packageError(message: string, code = 'INVALID_PACKAGE'): never {
  throw new ModulePackageError(message, code);
}

function archivePath(fileName: string): string {
  if (!fileName || fileName.length > MODULE_ARCHIVE_LIMITS.pathBytes || Buffer.byteLength(fileName) > MODULE_ARCHIVE_LIMITS.pathBytes) {
    packageError('The archive contains an invalid or overlong path.');
  }
  if (fileName.includes('\\') || fileName.includes('\0') || isAbsolute(fileName)) {
    packageError(`Unsafe archive path: ${fileName}.`);
  }
  const normal = normalize(fileName).split(sep).join('/');
  if (normal !== fileName || normal === '..' || normal.startsWith('../') || normal.includes('/../')) {
    packageError(`Unsafe archive path: ${fileName}.`);
  }
  return normal;
}

function validateEntryType(entry: Entry): void {
  if (entry.isEncrypted()) packageError(`Encrypted archive entry is forbidden: ${entry.fileName}.`);
  if (!entry.canDecodeFileData()) packageError(`Unsupported archive compression for ${entry.fileName}.`);
  const madeByUnix = (entry.versionMadeBy >>> 8) === 3;
  if (!madeByUnix) return;
  const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
  const regularFile = fileType === 0 || fileType === 0o100000;
  const directory = fileType === 0o040000;
  if (!regularFile && !directory) packageError(`Links and special files are forbidden: ${entry.fileName}.`);
}

async function readEntry(zipFile: Awaited<ReturnType<typeof fromBufferPromise>>, entry: Entry): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const stream = await zipFile.openReadStreamPromise(entry);
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > MODULE_ARCHIVE_LIMITS.fileBytes || bytes > entry.uncompressedSize) {
      stream.destroy();
      packageError(`Archive entry exceeds its permitted size: ${entry.fileName}.`, 'PACKAGE_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  if (bytes !== entry.uncompressedSize) packageError(`Archive entry size mismatch: ${entry.fileName}.`);
  return Buffer.concat(chunks, bytes);
}

async function readArchive(buffer: Buffer): Promise<Map<string, Buffer>> {
  if (buffer.length === 0 || buffer.length > MODULE_ARCHIVE_LIMITS.compressedBytes) {
    packageError('Module archive exceeds the compressed size limit.', 'PACKAGE_TOO_LARGE');
  }
  const zipFile = await fromBufferPromise(buffer, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
  });
  const files = new Map<string, Buffer>();
  const caseFoldedFiles = new Map<string, string>();
  let entryCount = 0;
  let uncompressedBytes = 0;
  try {
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      if (entryCount > MODULE_ARCHIVE_LIMITS.files) packageError('Module archive contains too many files.', 'PACKAGE_TOO_LARGE');
      const path = archivePath(entry.fileName);
      validateEntryType(entry);
      const isDirectory = path.endsWith('/');
      if (isDirectory) continue;
      if (files.has(path)) packageError(`Duplicate archive path: ${path}.`);
      const foldedPath = path.toLocaleLowerCase('en-US');
      const caseCollision = caseFoldedFiles.get(foldedPath);
      if (caseCollision) packageError(`Archive paths differ only by case: ${caseCollision} and ${path}.`);
      const pathSegments = path.split('/');
      for (let index = 1; index < pathSegments.length; index += 1) {
        const parent = pathSegments.slice(0, index).join('/');
        if (files.has(parent) || caseFoldedFiles.has(parent.toLocaleLowerCase('en-US'))) {
          packageError(`Archive file and directory paths conflict at ${parent}.`);
        }
      }
      const childPrefix = `${foldedPath}/`;
      if ([...caseFoldedFiles.keys()].some((existing) => existing.startsWith(childPrefix))) {
        packageError(`Archive file and directory paths conflict at ${path}.`);
      }
      if (entry.uncompressedSize > MODULE_ARCHIVE_LIMITS.fileBytes) packageError(`Archive entry is too large: ${path}.`, 'PACKAGE_TOO_LARGE');
      const ratio = entry.compressedSize === 0
        ? (entry.uncompressedSize === 0 ? 1 : Number.POSITIVE_INFINITY)
        : entry.uncompressedSize / entry.compressedSize;
      if (ratio > MODULE_ARCHIVE_LIMITS.compressionRatio) packageError(`Archive entry compression ratio is unsafe: ${path}.`, 'PACKAGE_TOO_LARGE');
      uncompressedBytes += entry.uncompressedSize;
      if (uncompressedBytes > MODULE_ARCHIVE_LIMITS.uncompressedBytes) packageError('Module archive expands beyond the size limit.', 'PACKAGE_TOO_LARGE');
      files.set(path, await readEntry(zipFile, entry));
      caseFoldedFiles.set(foldedPath, path);
    }
  } finally {
    zipFile.close();
  }
  for (const required of requiredFiles) {
    if ((required === 'server/main.js' || required === 'ui/pages.json' || required === 'ui/widgets.json' || required === 'schemas/config.json')
      && files.get('manifest.json')) {
      try {
        const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as { schemaVersion?: unknown };
        if (manifest.schemaVersion === 2) continue;
      } catch { /* manifest parsing reports a deterministic error later */ }
    }
    if (!files.has(required)) packageError(`Module archive is missing ${required}.`);
  }
  let schemaVersion: unknown;
  try { schemaVersion = JSON.parse(files.get('manifest.json')!.toString('utf8')).schemaVersion; } catch { /* handled below */ }
  if (schemaVersion === 2) {
    if (!files.has('ui/surfaces.json')) packageError('App/Add-on archive is missing ui/surfaces.json.');
    try {
      const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as { kind?: unknown };
      if (manifest.kind === 'app' && !files.has('schemas/connections.json')) {
        packageError('App archive is missing schemas/connections.json.');
      }
    } catch (error) {
      if (error instanceof ModulePackageError) throw error;
      // Malformed manifest parsing reports a deterministic error below.
    }
  }
  for (const path of files.keys()) {
    if (path.endsWith('.js') && path !== 'server/main.js' && !(schemaVersion === 2 && path.startsWith('ui/surfaces/'))) {
      packageError(`Executable content is not allowed at ${path}.`);
    }
  }
  return files;
}

function validateSelfContainedSurfaceHtml(path: string, contents: Buffer): void {
  if (contents.length === 0 || contents.length > 512 * 1024 || contents.includes(0)) {
    packageError(`Surface entry ${path} is empty, too large, or contains NUL bytes.`);
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(contents);
  } catch {
    packageError(`Surface entry ${path} is not valid UTF-8.`);
  }
  if (/<(?:base|iframe|object|embed|link)\b/i.test(source)) {
    packageError(`Surface entry ${path} contains a forbidden nested or external resource element.`);
  }
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh\b/i.test(source)) {
    packageError(`Surface entry ${path} cannot navigate with a meta refresh.`);
  }
  if (/\b(?:src|href|action)\s*=\s*["']\s*(?:https?:)?\/\//i.test(source) || /\bhttps?:\/\//i.test(source)) {
    packageError(`Surface entry ${path} must be self-contained and cannot reference an external network resource.`);
  }
}

function validateConnectionFieldReferences(
  manifest: InstalledPackageManifestV2,
  schema: NADV2ConnectionProfileSchema | undefined,
): void {
  if (manifest.kind !== 'app') return;
  if (!schema) packageError('App connection schema is unavailable.');
  const required = new Set(schema.required ?? []);
  for (const requiredField of required) {
    if (!schema.properties[requiredField]) packageError(`Connection schema requires undeclared field ${requiredField}.`);
  }
  for (const [name, field] of Object.entries(schema.properties)) {
    const control = field['x-nad'].control;
    if (control === 'secret' && field.default !== undefined) packageError(`Secret connection field ${name} cannot declare a default.`);
    if (['text', 'url', 'secret', 'select'].includes(control) && field.type !== 'string') {
      packageError(`Connection field ${name} has an incompatible ${control} control.`);
    }
    if (control === 'boolean' && field.type !== 'boolean') packageError(`Connection field ${name} must be boolean.`);
    if (control === 'number' && field.type !== 'number' && field.type !== 'integer') {
      packageError(`Connection field ${name} must be numeric.`);
    }
    if (control === 'select' && !field.enum?.length) packageError(`Select connection field ${name} must declare an enum.`);
  }
  const fields = schema.properties;
  for (const scope of manifest.httpAccess ?? []) {
    const host = fields[scope.hostField];
    if (!host || host.type !== 'string' || !['text', 'url'].includes(host['x-nad'].control)) {
      packageError(`HTTP scope ${scope.id} hostField must reference a non-secret text or URL field.`);
    }
    if (scope.portField) {
      const port = fields[scope.portField];
      if (!port || !['number', 'integer'].includes(port.type) || port['x-nad'].control !== 'number') {
        packageError(`HTTP scope ${scope.id} portField must reference a numeric field.`);
      }
    }
    if (scope.tlsVerifyField) {
      const tls = fields[scope.tlsVerifyField];
      if (!tls || tls.type !== 'boolean' || tls['x-nad'].control !== 'boolean') {
        packageError(`HTTP scope ${scope.id} tlsVerifyField must reference a boolean field.`);
      }
    }
    if (scope.credential) {
      const secret = fields[scope.credential.field];
      if (!secret || secret.type !== 'string' || secret['x-nad'].control !== 'secret' || !required.has(scope.credential.field)) {
        packageError(`HTTP scope ${scope.id} credential field must reference a required secret string.`);
      }
      if (scope.credential.publicField) {
        const publicField = fields[scope.credential.publicField];
        if (!publicField || publicField.type !== 'string' || !['text', 'url', 'select'].includes(publicField['x-nad'].control)) {
          packageError(`HTTP scope ${scope.id} public credential field is incompatible.`);
        }
      }
    }
  }
}

function validateSurfaceReferences(
  manifest: InstalledPackageManifestV2,
  surfaces: NADUIAPIV2Surfaces,
): void {
  const permissions = new Set(manifest.permissions.map(({ action }) => action));
  const dependencies = new Map((manifest.dependencies ?? []).map((dependency) => [dependency.alias, dependency]));
  const surfaceIds = new Set<string>();
  const entries = new Set<string>();
  for (const surface of surfaces.surfaces) {
    if (surfaceIds.has(surface.id) || entries.has(surface.entry)) packageError('Surface IDs and entry paths must be unique.');
    surfaceIds.add(surface.id);
    entries.add(surface.entry);
    for (const permission of surface.permissions) {
      if (!permissions.has(permission)) packageError(`Surface ${surface.id} references undeclared permission ${permission}.`);
    }
    const slots = new Map<string, string>();
    for (const slot of surface.connectionSlots ?? []) {
      if (slots.has(slot.slot)) packageError(`Surface ${surface.id} contains duplicate connection slot ${slot.slot}.`);
      slots.set(slot.slot, slot.target);
      if (slot.target === 'self' && manifest.kind !== 'app') packageError(`Add-on surface ${surface.id} cannot use a self connection.`);
      if (slot.target !== 'self' && !dependencies.has(slot.target)) packageError(`Surface ${surface.id} references undeclared dependency ${slot.target}.`);
    }
    for (const [bindingId, binding] of Object.entries(surface.bindings)) {
      if (binding.target === 'self') {
        const operation = manifest.operations[binding.operation];
        if (!operation || !operation.consumers.includes('self')) packageError(`Surface binding ${bindingId} references an unavailable self operation.`);
        if (!surface.permissions.includes(operation.permission)) packageError(`Surface ${surface.id} omits operation permission ${operation.permission}.`);
        if (operation.connection === 'required' && !binding.connectionSlot) packageError(`Surface binding ${bindingId} requires a connection slot.`);
        if (operation.connection === 'none' && binding.connectionSlot) packageError(`Surface binding ${bindingId} cannot select a connection.`);
      } else {
        const dependency = dependencies.get(binding.target);
        if (!dependency || !(binding.operation in dependency.operations)) packageError(`Surface binding ${bindingId} references an unapproved dependency operation.`);
        if (!binding.connectionSlot) packageError(`Add-on binding ${bindingId} must select an App connection slot.`);
      }
      if (binding.connectionSlot) {
        const target = slots.get(binding.connectionSlot);
        if (!target || target !== binding.target) packageError(`Surface binding ${bindingId} has a mismatched connection slot.`);
      }
    }
  }
}

function validateExactV2Inventory(
  files: ReadonlyMap<string, Buffer>,
  manifest: InstalledPackageManifestV2,
  surfaces: NADUIAPIV2Surfaces,
): void {
  const expected = new Set([
    'manifest.json', 'ui/surfaces.json', 'README.md', 'LICENSE', 'assets/icon.png',
    'checksums.json', 'signature.json',
  ]);
  if (manifest.connections) expected.add('schemas/connections.json');
  if (Object.keys(manifest.operations).length) expected.add('server/main.js');
  for (const operation of Object.values(manifest.operations)) {
    expected.add(operation.requestSchema);
    expected.add(operation.responseSchema);
  }
  for (const surface of surfaces.surfaces) expected.add(surface.entry);
  for (const path of expected) if (!files.has(path)) packageError(`App/Add-on archive is missing ${path}.`);
  for (const path of files.keys()) if (!expected.has(path)) packageError(`${path} is not declared by the v2 package contract.`);
}

function verifyChecksums(files: ReadonlyMap<string, Buffer>, checksums: PackageChecksums): void {
  const payloadPaths = [...files.keys()].filter((path) => path !== 'checksums.json' && path !== 'signature.json').sort();
  const listedPaths = Object.keys(checksums.files).sort();
  if (payloadPaths.length !== listedPaths.length || payloadPaths.some((path, index) => path !== listedPaths[index])) {
    packageError('checksums.json must list every payload file and no metadata envelope files.');
  }
  for (const path of payloadPaths) {
    const digest = createHash('sha256').update(files.get(path)!).digest('hex');
    if (digest !== checksums.files[path]) packageError(`Checksum verification failed for ${path}.`, 'BAD_CHECKSUM');
  }
}

export function createSignatureEnvelope(id: string, version: string, checksums: PackageChecksums): Buffer {
  const orderedFiles = Object.fromEntries(Object.entries(checksums.files).sort(([left], [right]) => left.localeCompare(right)));
  return Buffer.from(JSON.stringify({
    moduleId: id,
    version,
    digestAlgorithm: checksums.algorithm,
    files: orderedFiles,
  }), 'utf8');
}

function createLegacySignatureEnvelopeV1(id: string, version: string, checksums: PackageChecksums): Buffer {
  const orderedFiles = Object.fromEntries(Object.entries(checksums.files).sort(([left], [right]) => left.localeCompare(right)));
  return Buffer.from(JSON.stringify({ id, version, files: orderedFiles }), 'utf8');
}

async function configuredTrustedKeys(): Promise<Record<string, string>> {
  let configured: Record<string, string> = {};
  if (process.env.NAD_TRUSTED_MODULE_KEYS) {
    try {
      const value = JSON.parse(process.env.NAD_TRUSTED_MODULE_KEYS) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) configured = value as Record<string, string>;
    } catch {
      packageError('NAD_TRUSTED_MODULE_KEYS is not valid JSON.', 'TRUST_CONFIGURATION_ERROR');
    }
  }
  const keyFile = process.env.NAD_TRUSTED_MODULE_KEYS_FILE
    ?? `${getDataDirectory()}/trusted-module-keys.json`;
  try {
    const value = JSON.parse(await readFile(keyFile, 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    configured = { ...configured, ...value as Record<string, string> };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ...builtInModuleTrustRoots, ...configured };
    packageError('The trusted Module key file is invalid.', 'TRUST_CONFIGURATION_ERROR');
  }
  return { ...builtInModuleTrustRoots, ...configured };
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compareVersion(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function satisfiesCoreRange(version: string, range: string): boolean {
  const parsedVersion = parseVersion(version);
  if (!parsedVersion) return false;
  const comparators = range.trim().split(/\s+/).filter(Boolean);
  if (comparators.length === 1 && /^\d+\.x$/.test(comparators[0])) {
    return parsedVersion[0] === Number(comparators[0].split('.')[0]);
  }
  return comparators.length > 0 && comparators.every((comparator) => {
    const match = /^(>=|>|<=|<|=)?(\d+\.\d+\.\d+)$/.exec(comparator);
    if (!match) return false;
    const target = parseVersion(match[2]);
    if (!target) return false;
    const comparison = compareVersion(parsedVersion, target);
    switch (match[1] ?? '=') {
      case '>=': return comparison >= 0;
      case '>': return comparison > 0;
      case '<=': return comparison <= 0;
      case '<': return comparison < 0;
      default: return comparison === 0;
    }
  });
}

function validateCompatibility(coreVersion: string, coreRange: string, hostApi: string, uiApi: string, schemaVersion: number): void {
  if (!satisfiesCoreRange(coreVersion, coreRange)) {
    packageError(`Module requires NAD core ${coreRange}; this dashboard is ${coreVersion}.`, 'INCOMPATIBLE_CORE');
  }
  const hostSupported = schemaVersion === 1
    ? hostApi === NAD_HOST_API_COMPATIBILITY
    : NAD_SUPPORTED_HOST_API_COMPATIBILITY.includes(hostApi);
  const uiSupported = schemaVersion === 1
    ? uiApi === NAD_UI_API_COMPATIBILITY
    : NAD_SUPPORTED_UI_API_COMPATIBILITY.includes(uiApi);
  if (!hostSupported || !uiSupported) {
    packageError('Module requires an unsupported host or UI API version.', 'INCOMPATIBLE_API');
  }
}

export async function verifyModulePackage(
  buffer: Buffer,
  options: ModuleVerifierOptions = {},
): Promise<VerifiedModulePackage> {
  const files = await readArchive(buffer);
  const rawManifest = parseJsonFile(files.get('manifest.json')!, 'manifest.json');
  const packageSchemaVersion = (rawManifest as Record<string, unknown>).schemaVersion;
  const rawPages = packageSchemaVersion === 2 ? { schemaVersion: 1, pages: [] } : parseJsonFile(files.get('ui/pages.json')!, 'ui/pages.json');
  const rawWidgets = packageSchemaVersion === 2 ? { schemaVersion: 1, widgets: [] } : parseJsonFile(files.get('ui/widgets.json')!, 'ui/widgets.json');
  const rawChecksums = parseJsonFile(files.get('checksums.json')!, 'checksums.json');
  const rawSignature = parseJsonFile(files.get('signature.json')!, 'signature.json');
  let manifest = parseAnyPackageManifest(rawManifest);
  const pages = packageSchemaVersion === 2
    ? { schemaVersion: 1 as const, pages: [] }
    : parsePageDocument(rawPages);
  const widgets = packageSchemaVersion === 2
    ? { schemaVersion: 1 as const, widgets: [] }
    : parseWidgetDocument(rawWidgets);
  const checksums = parseChecksums(rawChecksums);
  const signature = parseSignature(rawSignature);
  verifyChecksums(files, checksums);
  validateCompatibility(
    options.coreVersion ?? process.env.NAD_VERSION ?? NAD_CORE_VERSION,
    manifest.compatibility.core,
    manifest.compatibility.hostApi,
    manifest.compatibility.uiApi,
    manifest.schemaVersion,
  );
  if (
    signature.signedPayload.moduleId !== manifest.id
    || signature.signedPayload.version !== manifest.version
    || signature.signedPayload.digestAlgorithm !== checksums.algorithm
  ) {
    packageError('signature.json does not match the package identity.', 'BAD_SIGNATURE');
  }
  const expectedSignedFiles = Object.fromEntries(Object.entries(checksums.files).sort(([left], [right]) => left.localeCompare(right)));
  const providedSignedFiles = Object.fromEntries(Object.entries(signature.signedPayload.files).sort(([left], [right]) => left.localeCompare(right)));
  if (JSON.stringify(expectedSignedFiles) !== JSON.stringify(providedSignedFiles)) {
    packageError('signature.json does not match checksums.json.', 'BAD_SIGNATURE');
  }

  let signatureStatus: VerifiedModulePackage['signatureStatus'];
  let signerKeyId: string | undefined;
  if (signature.mode === 'unsigned-dev') {
    const allowUnsigned = options.allowUnsigned ?? process.env.NAD_ALLOW_UNSIGNED_MODULES === 'true';
    if (!allowUnsigned) packageError('Unsigned development Modules are disabled.', 'UNTRUSTED_MODULE');
    signatureStatus = 'development';
  } else {
    const trustedKeys = options.trustedKeys ?? await configuredTrustedKeys();
    const encodedKey = trustedKeys[signature.keyId];
    if (!encodedKey) packageError(`The signing key ${signature.keyId} is not trusted.`, 'UNTRUSTED_MODULE');
    let publicKey;
    try {
      publicKey = createPublicKey(encodedKey.includes('BEGIN PUBLIC KEY')
        ? encodedKey
        : { key: Buffer.from(encodedKey, 'base64'), format: 'der', type: 'spki' });
    } catch {
      packageError(`The trusted signing key ${signature.keyId} is invalid.`, 'TRUST_CONFIGURATION_ERROR');
    }
    const signatureBytes = Buffer.from(signature.signature, 'base64');
    const canonicalSignatureValid = verifySignature(
      null,
      createSignatureEnvelope(manifest.id, manifest.version, checksums),
      publicKey,
      signatureBytes,
    );
    // Packages published before the canonical envelope was introduced signed
    // the same schema-v1 identity and file digests under this legacy shape.
    // New packages are always signed with the canonical envelope above.
    const legacySignatureValid = manifest.schemaVersion === 1 && verifySignature(
      null,
      createLegacySignatureEnvelopeV1(manifest.id, manifest.version, checksums),
      publicKey,
      signatureBytes,
    );
    if (!canonicalSignatureValid && !legacySignatureValid) {
      packageError('Module signature verification failed.', 'BAD_SIGNATURE');
    }
    signatureStatus = 'verified';
    signerKeyId = signature.keyId;
  }

  const connectionSchema = manifest.schemaVersion === 2 && manifest.kind === 'app'
    ? parseConnectionSchemaV2(parseJsonFile(files.get('schemas/connections.json')!, 'schemas/connections.json'))
    : undefined;
  if (manifest.schemaVersion === 2) manifest = applyConnectionSchemaV2(manifest, connectionSchema);
  const surfaces = manifest.schemaVersion === 2
    ? parseSurfaceDocumentV2(parseJsonFile(files.get('ui/surfaces.json')!, 'ui/surfaces.json'))
    : undefined;
  if (manifest.schemaVersion === 2) {
    validateConnectionFieldReferences(manifest, connectionSchema);
    validateSurfaceReferences(manifest, surfaces!);
    validateExactV2Inventory(files, manifest, surfaces!);
    const declaredOperations = new Set(Object.keys(manifest.operations));
    for (const [name, operation] of Object.entries(manifest.operations)) {
      for (const schemaPath of [operation.requestSchema, operation.responseSchema]) {
        if (!files.has(schemaPath)) packageError(`Operation ${name} references missing schema ${schemaPath}.`);
        assertEndpointSchemaDocument(parseJsonFile(files.get(schemaPath)!, schemaPath));
      }
    }
    for (const surface of surfaces?.surfaces ?? []) {
      if (!files.has(surface.entry)) packageError(`Surface ${surface.id} references missing entry ${surface.entry}.`);
      validateSelfContainedSurfaceHtml(surface.entry, files.get(surface.entry)!);
      for (const [bindingId, binding] of Object.entries(surface.bindings)) {
        if (binding.target === 'self' && !declaredOperations.has(binding.operation)) {
          packageError(`Surface binding ${bindingId} references unknown self operation ${binding.operation}.`);
        }
        if (binding.target !== 'self' && manifest.kind !== 'addon') {
          packageError(`App surface binding ${bindingId} cannot target a dependency.`);
        }
        if (binding.target !== 'self' && !manifest.dependencies?.some(({ alias }) => alias === binding.target)) {
          packageError(`Surface binding ${bindingId} references unknown dependency ${binding.target}.`);
        }
      }
    }
  }

  const declaredEndpoints = new Set(Object.keys(manifest.entrypoints));
  for (const [endpoint, entrypoint] of Object.entries(manifest.entrypoints)) {
    for (const schemaPath of [entrypoint.requestSchema, entrypoint.responseSchema]) {
      if (!schemaPath || !files.has(schemaPath)) packageError(`Endpoint ${endpoint} references missing schema ${schemaPath ?? '(none)'}.`);
      const schema = parseJsonFile(files.get(schemaPath)!, schemaPath);
      assertEndpointSchemaDocument(schema);
    }
  }
  for (const widget of widgets.widgets) {
    if (!declaredEndpoints.has(widget.view.endpoint)) packageError(`Widget ${widget.id} references an unknown endpoint.`);
  }
  for (const page of pages.pages) {
    for (const section of page.view.sections) {
      if (!declaredEndpoints.has(section.endpoint)) packageError(`Page ${page.path} references an unknown endpoint.`);
    }
  }

  return {
    manifest,
    rawManifest: rawManifest as VerifiedModulePackage['rawManifest'],
    pages,
    rawPages: rawPages as VerifiedModulePackage['rawPages'],
    widgets,
    rawWidgets: rawWidgets as VerifiedModulePackage['rawWidgets'],
    checksums,
    signature,
    digest: createHash('sha256').update(buffer).digest('hex'),
    files,
    signatureStatus,
    signerKeyId,
    connectionSchema,
    surfaces,
  };
}
