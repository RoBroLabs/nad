import 'server-only';

import { createHash, verify as verifySignature } from 'node:crypto';
import { readBodyBytes } from '@/lib/http';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { MODULE_ARCHIVE_LIMITS } from '@/lib/modules/installed/package-verifier';
import type {
  MarketplaceAdvisoryAffectedRelease,
  MarketplaceAdvisorySeverity,
  MarketplaceAdvisoryStatus,
  MarketplaceMetadataSignature,
  MarketplaceRecommendedRelease,
  MarketplaceRevocationAction,
  MarketplaceRevocationTarget,
  MarketplaceSecurityAdvisory,
  MarketplaceSecurityRevocation,
  MarketplaceSecuritySnapshot,
  VerifiedMarketplaceSecuritySnapshot,
} from '@/lib/marketplace/security-types';

const CATALOG_LIMIT_BYTES = 1_048_576;
const SIGNATURE_LIMIT_BYTES = 4_096;
const SECURITY_LIMIT_BYTES = 2_097_152;
const MAX_SECURITY_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_SECURITY_VALIDITY_MS = 93 * 24 * 60 * 60 * 1_000;
const MARKETPLACE_METADATA_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  'robrolabs-marketplace-metadata-2026-01': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAx4YbWnDRDEWBIsfPzbExnPCs45QaB6sVjwTgHlqoSjU=
-----END PUBLIC KEY-----`,
  'robrolabs-marketplace-metadata-2026-08': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAhSEGepev8Vfop9X/DNEmnDidlEFbxonXylbcsEL6aDI=
-----END PUBLIC KEY-----`,
};

export interface MarketplaceCatalogModule {
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  publisher: string;
  latestVersion: string;
  recommendedVersion: string;
  status: string;
  recommended: boolean;
  compatibility: { dashboard: string; runtime: string };
  permissions: Array<{ scope: string; level: string; reason: string }>;
  capabilities: Array<{ name: string; reason: string }>;
  review: { status: string; summary: string };
  artifact: {
    fileName: string;
    bytes: number;
    downloadPath: string;
    sha256: string;
  };
}

export interface MarketplaceCatalog {
  schemaVersion: 1;
  modules: MarketplaceCatalogModule[];
}

export function getMarketplaceMode(): 'online' | 'manual' {
  const configured = process.env.NAD_MARKETPLACE_MODE?.trim().toLowerCase();
  if (configured === 'manual' || configured === 'disabled') return 'manual';
  return 'online';
}

export function getMarketplaceBaseUrl(): URL | undefined {
  const value = process.env.NAD_MARKETPLACE_URL;
  if (!value) return undefined;
  const url = new URL(value);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.hash || url.search) {
    throw new Error('NAD_MARKETPLACE_URL must be a normal HTTP(S) base URL without credentials, query, or fragment.');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('NAD_MARKETPLACE_URL must use HTTPS in production.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function metadataPublicKey(keyId: string): string | undefined {
  if ((process.env.NODE_ENV !== 'production' || process.env.VITEST === 'true')
    && process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY) {
    return process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY;
  }
  return MARKETPLACE_METADATA_PUBLIC_KEYS[keyId];
}

export function verifyMarketplaceMetadata(
  bytes: Buffer,
  value: unknown,
  expectedPath: string,
  publicKeyPem?: string,
): MarketplaceMetadataSignature {
  if (isRecord(value)) {
    exactKeys(value, ['schemaVersion', 'algorithm', 'keyId', 'signedPath', 'sha256', 'signature'], 'metadata signature');
  }
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.algorithm !== 'Ed25519'
    || typeof value.keyId !== 'string'
    || !Object.hasOwn(MARKETPLACE_METADATA_PUBLIC_KEYS, value.keyId)
    || value.signedPath !== expectedPath
    || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.signature !== 'string'
    || value.signature.length > 256) {
    throw new Error('Marketplace metadata signature has an unsupported shape.');
  }
  const trustedKey = publicKeyPem ?? metadataPublicKey(value.keyId);
  if (!trustedKey) throw new Error('Marketplace metadata signature uses an untrusted key.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature)
    || Buffer.from(value.signature, 'base64').length !== 64) {
    throw new Error('Marketplace metadata signature has an unsupported shape.');
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== value.sha256) throw new Error('Marketplace metadata digest does not match its signature.');
  if (!verifySignature(null, bytes, trustedKey, Buffer.from(value.signature, 'base64'))) {
    throw new Error('Marketplace metadata signature verification failed.');
  }
  return value as unknown as MarketplaceMetadataSignature;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error(`Marketplace ${label} contains an unsupported field.`);
  }
}

function boundedText(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw new Error(`Marketplace ${label} is invalid.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  const result = boundedText(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`Marketplace ${label} is invalid.`);
  return result;
}

function slug(value: unknown, label: string): string {
  const result = boundedText(value, label, 80);
  if (!/^[a-z][a-z0-9-]*$/.test(result)) throw new Error(`Marketplace ${label} is invalid.`);
  return result;
}

function moduleId(value: unknown, label: string): string {
  const result = boundedText(value, label, 160);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(result)) throw new Error(`Marketplace ${label} is invalid.`);
  return result;
}

function semver(value: unknown, label: string): string {
  const result = boundedText(value, label, 80);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(result)) {
    throw new Error(`Marketplace ${label} is invalid.`);
  }
  return result;
}

function instant(value: unknown, label: string): string {
  const result = boundedText(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result)
    || !Number.isFinite(Date.parse(result))) {
    throw new Error(`Marketplace ${label} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  return value === undefined ? undefined : boundedText(value, label, maximum);
}

function parseSeverity(value: unknown, label: string): MarketplaceAdvisorySeverity {
  if (value !== 'low' && value !== 'moderate' && value !== 'high' && value !== 'critical') {
    throw new Error(`Marketplace ${label} is invalid.`);
  }
  return value;
}

function parseAffected(value: unknown, advisoryId: string): MarketplaceAdvisoryAffectedRelease[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error(`Marketplace advisory ${advisoryId} affected releases are invalid.`);
  }
  const seenVersions = new Set<string>();
  const seenDigests = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(`Marketplace advisory ${advisoryId} contains an invalid affected release.`);
    exactKeys(item, ['version', 'artifactSha256'], `advisory ${advisoryId} affected release`);
    const affected = {
      version: semver(item.version, `advisory ${advisoryId} affected version`),
      artifactSha256: digest(item.artifactSha256, `advisory ${advisoryId} affected digest`),
    };
    if (seenVersions.has(affected.version) || seenDigests.has(affected.artifactSha256)) {
      throw new Error(`Marketplace advisory ${advisoryId} repeats an affected release identity.`);
    }
    seenVersions.add(affected.version);
    seenDigests.add(affected.artifactSha256);
    return affected;
  });
}

function parseStringList(
  value: unknown,
  label: string,
  parse: (item: unknown, itemLabel: string) => string,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Marketplace ${label} is invalid.`);
  const result = value.map((item) => parse(item, label));
  if (new Set(result).size !== result.length) throw new Error(`Marketplace ${label} contains duplicates.`);
  return result;
}

function parseRecommendation(value: unknown): MarketplaceRecommendedRelease {
  if (!isRecord(value)) throw new Error('Marketplace security snapshot contains an invalid recommendation.');
  exactKeys(value, ['moduleId', 'moduleSlug', 'version', 'artifactSha256', 'signerKeyId'], 'recommendation');
  return {
    moduleId: moduleId(value.moduleId, 'recommendation Module ID'),
    moduleSlug: slug(value.moduleSlug, 'recommendation Module slug'),
    version: semver(value.version, 'recommendation version'),
    artifactSha256: digest(value.artifactSha256, 'recommendation digest'),
    signerKeyId: boundedText(value.signerKeyId, 'recommendation signer key ID', 120),
  };
}

function parseAdvisory(value: unknown): MarketplaceSecurityAdvisory {
  if (!isRecord(value)) throw new Error('Marketplace security snapshot contains an invalid advisory.');
  exactKeys(value, [
    'id', 'moduleId', 'moduleSlug', 'moduleName', 'severity', 'status', 'publishedAt', 'updatedAt',
    'title', 'summary', 'guidance', 'affected', 'affectedVersions', 'fixedVersions',
    'references', 'path', 'url',
  ], 'advisory');
  const id = boundedText(value.id, 'advisory ID', 120);
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(id)) throw new Error('Marketplace advisory ID is invalid.');
  const status = value.status;
  if (status !== 'open' && status !== 'resolved') throw new Error(`Marketplace advisory ${id} status is invalid.`);
  const publishedAt = instant(value.publishedAt, `advisory ${id} publishedAt`);
  const updatedAt = instant(value.updatedAt, `advisory ${id} updatedAt`);
  if (Date.parse(updatedAt) < Date.parse(publishedAt)) throw new Error(`Marketplace advisory ${id} update predates publication.`);
  const affected = parseAffected(value.affected, id);
  const affectedVersions = parseStringList(value.affectedVersions, `advisory ${id} affected versions`, semver, 100);
  if (new Set(affected.map(({ version }) => version)).size !== affectedVersions.length
    || affectedVersions.some((version) => !affected.some((item) => item.version === version))) {
    throw new Error(`Marketplace advisory ${id} affected version identities are inconsistent.`);
  }
  const advisoryPath = boundedText(value.path, `advisory ${id} path`, 500);
  if (!advisoryPath.startsWith('/') || advisoryPath.includes('\\') || advisoryPath.includes('\0')) {
    throw new Error(`Marketplace advisory ${id} path is invalid.`);
  }
  const advisoryUrl = boundedText(value.url, `advisory ${id} URL`, 1_000);
  const parsedAdvisoryUrl = new URL(advisoryUrl);
  if (parsedAdvisoryUrl.protocol !== 'https:' || parsedAdvisoryUrl.username || parsedAdvisoryUrl.password
    || parsedAdvisoryUrl.search || parsedAdvisoryUrl.hash || parsedAdvisoryUrl.pathname !== advisoryPath) {
    throw new Error(`Marketplace advisory ${id} URL is invalid.`);
  }
  return {
    id,
    moduleId: moduleId(value.moduleId, `advisory ${id} Module ID`),
    moduleSlug: slug(value.moduleSlug, `advisory ${id} Module slug`),
    moduleName: boundedText(value.moduleName, `advisory ${id} Module name`, 120),
    severity: parseSeverity(value.severity, `advisory ${id} severity`),
    status: status as MarketplaceAdvisoryStatus,
    publishedAt,
    updatedAt,
    title: boundedText(value.title, `advisory ${id} title`, 200),
    summary: boundedText(value.summary, `advisory ${id} summary`, 2_000),
    guidance: boundedText(value.guidance, `advisory ${id} guidance`, 2_000),
    affected,
    affectedVersions,
    fixedVersions: parseStringList(value.fixedVersions, `advisory ${id} fixed versions`, semver, 100),
    references: parseStringList(value.references, `advisory ${id} references`, (item, itemLabel) => {
      const reference = boundedText(item, itemLabel, 1_000);
      const url = new URL(reference);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`Marketplace ${itemLabel} is invalid.`);
      return reference;
    }, 32),
    path: advisoryPath,
    url: advisoryUrl,
  };
}

function parseRevocationTarget(value: unknown, id: string): MarketplaceRevocationTarget {
  if (!isRecord(value)) throw new Error(`Marketplace revocation ${id} target is invalid.`);
  if (value.type === 'artifact') {
    exactKeys(value, ['type', 'sha256'], `revocation ${id} target`);
    return { type: 'artifact', sha256: digest(value.sha256, `revocation ${id} target digest`) };
  }
  if (value.type === 'signing-key') {
    exactKeys(value, ['type', 'keyId'], `revocation ${id} target`);
    return { type: 'signing-key', keyId: boundedText(value.keyId, `revocation ${id} target key ID`, 120) };
  }
  throw new Error(`Marketplace revocation ${id} target type is invalid.`);
}

function parseRevocation(value: unknown): MarketplaceSecurityRevocation {
  if (!isRecord(value)) throw new Error('Marketplace security snapshot contains an invalid revocation.');
  exactKeys(value, [
    'id', 'publishedAt', 'updatedAt', 'severity', 'action', 'target', 'moduleId', 'moduleSlug',
    'moduleName', 'version', 'reason', 'summary', 'replacementVersion',
  ], 'revocation');
  const id = boundedText(value.id, 'revocation ID', 120);
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(id)) throw new Error('Marketplace revocation ID is invalid.');
  const action = value.action;
  if (action !== 'warn' && action !== 'quarantine') throw new Error(`Marketplace revocation ${id} action is invalid.`);
  const publishedAt = instant(value.publishedAt, `revocation ${id} publishedAt`);
  const updatedAt = instant(value.updatedAt, `revocation ${id} updatedAt`);
  if (Date.parse(updatedAt) < Date.parse(publishedAt)) throw new Error(`Marketplace revocation ${id} update predates publication.`);
  const parsed: MarketplaceSecurityRevocation = {
    id,
    publishedAt,
    updatedAt,
    severity: parseSeverity(value.severity, `revocation ${id} severity`),
    action: action as MarketplaceRevocationAction,
    target: parseRevocationTarget(value.target, id),
    moduleId: moduleId(value.moduleId, `revocation ${id} Module ID`),
    moduleSlug: slug(value.moduleSlug, `revocation ${id} Module slug`),
    moduleName: boundedText(value.moduleName, `revocation ${id} Module name`, 120),
    version: semver(value.version, `revocation ${id} version`),
    reason: boundedText(value.reason, `revocation ${id} reason`, 200),
    summary: boundedText(value.summary, `revocation ${id} summary`, 2_000),
  };
  return {
    ...parsed,
    ...(optionalText(value.replacementVersion, `revocation ${id} replacement version`, 80) === undefined
      ? {}
      : { replacementVersion: semver(value.replacementVersion, `revocation ${id} replacement version`) }),
  };
}

export function parseMarketplaceSecuritySnapshot(
  value: unknown,
  nowMilliseconds = Date.now(),
): MarketplaceSecuritySnapshot {
  if (!isRecord(value)) throw new Error('Marketplace security snapshot has an unsupported shape.');
  exactKeys(value, ['schemaVersion', 'sequence', 'issuedAt', 'expiresAt', 'recommendations', 'advisories', 'revocations'], 'security snapshot');
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
    throw new Error('Marketplace security snapshot has an unsupported version or sequence.');
  }
  if (!Array.isArray(value.recommendations) || value.recommendations.length > 500
    || !Array.isArray(value.advisories) || value.advisories.length > 2_000
    || !Array.isArray(value.revocations) || value.revocations.length > 2_000) {
    throw new Error('Marketplace security snapshot exceeds its record limits.');
  }
  const issuedAt = instant(value.issuedAt, 'security snapshot issuedAt');
  const expiresAt = instant(value.expiresAt, 'security snapshot expiresAt');
  const issuedMilliseconds = Date.parse(issuedAt);
  const expiresMilliseconds = Date.parse(expiresAt);
  if (expiresMilliseconds <= issuedMilliseconds) throw new Error('Marketplace security snapshot expiry must follow issuance.');
  if (expiresMilliseconds - issuedMilliseconds > MAX_SECURITY_VALIDITY_MS) {
    throw new Error('Marketplace security snapshot validity period is too long.');
  }
  if (issuedMilliseconds > nowMilliseconds + MAX_SECURITY_CLOCK_SKEW_MS) throw new Error('Marketplace security snapshot is not valid yet.');
  if (expiresMilliseconds <= nowMilliseconds) throw new Error('Marketplace security snapshot has expired.');

  const recommendations = value.recommendations.map(parseRecommendation);
  const recommendationIds = recommendations.map(({ moduleId }) => moduleId);
  const recommendationSlugs = recommendations.map(({ moduleSlug }) => moduleSlug);
  if (new Set(recommendationIds).size !== recommendationIds.length
    || new Set(recommendationSlugs).size !== recommendationSlugs.length
    || new Set(recommendations.map(({ artifactSha256 }) => artifactSha256)).size !== recommendations.length) {
    throw new Error('Marketplace security snapshot repeats a recommendation identity.');
  }
  const advisories = value.advisories.map(parseAdvisory);
  if (new Set(advisories.map(({ id }) => id)).size !== advisories.length) {
    throw new Error('Marketplace security snapshot repeats an advisory ID.');
  }
  const revocations = value.revocations.map(parseRevocation);
  if (new Set(revocations.map(({ id }) => id)).size !== revocations.length) {
    throw new Error('Marketplace security snapshot repeats a revocation ID.');
  }
  const revocationTargets = revocations.map(({ target }) => target.type === 'artifact'
    ? `artifact:${target.sha256}`
    : `signing-key:${target.keyId}`);
  if (new Set(revocationTargets).size !== revocationTargets.length) {
    throw new Error('Marketplace security snapshot repeats a revocation target.');
  }
  if ([...advisories, ...revocations].some(({ publishedAt, updatedAt }) =>
    Date.parse(publishedAt) > issuedMilliseconds + MAX_SECURITY_CLOCK_SKEW_MS
    || Date.parse(updatedAt) > issuedMilliseconds + MAX_SECURITY_CLOCK_SKEW_MS)) {
    throw new Error('Marketplace security record timestamp is later than snapshot issuance.');
  }
  return {
    schemaVersion: 1,
    sequence: value.sequence as number,
    issuedAt,
    expiresAt,
    recommendations,
    advisories,
    revocations,
  };
}

function parseCatalog(value: unknown): MarketplaceCatalog {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.modules) || value.modules.length > 500) {
    throw new Error('Marketplace catalog has an unsupported shape.');
  }
  const modules = value.modules.map((moduleValue) => {
    if (!isRecord(moduleValue) || !isRecord(moduleValue.artifact) || !isRecord(moduleValue.compatibility)
      || !isRecord(moduleValue.review) || !Array.isArray(moduleValue.permissions)
      || !Array.isArray(moduleValue.capabilities)) {
      throw new Error('Marketplace catalog contains an invalid Module record.');
    }
    const text = (field: unknown, label: string, maximum = 500): string => {
      if (typeof field !== 'string' || !field || field.length > maximum) throw new Error(`Marketplace ${label} is invalid.`);
      return field;
    };
    const slug = text(moduleValue.slug, 'slug', 80);
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error('Marketplace Module slug is invalid.');
    const bytes = moduleValue.artifact.bytes;
    if (!Number.isInteger(bytes) || (bytes as number) < 1 || (bytes as number) > MODULE_ARCHIVE_LIMITS.compressedBytes) {
      throw new Error(`Marketplace artifact size is invalid for ${slug}.`);
    }
    const sha256 = text(moduleValue.artifact.sha256, 'artifact digest', 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Marketplace artifact digest is invalid for ${slug}.`);
    const latestVersion = text(moduleValue.latestVersion, 'version', 80);
    return {
      slug,
      name: text(moduleValue.name, 'name', 100),
      summary: text(moduleValue.summary, 'summary'),
      description: text(moduleValue.description, 'description', 2_000),
      category: text(moduleValue.category, 'category', 80),
      publisher: text(moduleValue.publisher, 'publisher', 120),
      latestVersion,
      // Catalog schema v1 predates the explicit field. The separately signed
      // security snapshot is authoritative for Phase 5; this fallback keeps a
      // rolling deployment compatible with a still-cached earlier v1 catalog.
      recommendedVersion: moduleValue.recommendedVersion === undefined
        ? latestVersion
        : text(moduleValue.recommendedVersion, 'recommended version', 80),
      status: text(moduleValue.status, 'status', 40),
      recommended: moduleValue.recommended === true,
      compatibility: {
        dashboard: text(moduleValue.compatibility.dashboard, 'dashboard compatibility', 80),
        runtime: text(moduleValue.compatibility.runtime, 'runtime compatibility', 120),
      },
      permissions: moduleValue.permissions.slice(0, 32).map((permissionValue) => {
        if (!isRecord(permissionValue)) throw new Error(`Marketplace permission is invalid for ${slug}.`);
        return {
          scope: text(permissionValue.scope, 'permission scope', 100),
          level: text(permissionValue.level, 'permission level', 40),
          reason: text(permissionValue.reason, 'permission reason', 500),
        };
      }),
      capabilities: moduleValue.capabilities.slice(0, 32).map((capabilityValue) => {
        if (!isRecord(capabilityValue)) throw new Error(`Marketplace capability is invalid for ${slug}.`);
        return {
          name: text(capabilityValue.name, 'capability name', 100),
          reason: text(capabilityValue.reason, 'capability reason', 500),
        };
      }),
      review: {
        status: text(moduleValue.review.status, 'review status', 40),
        summary: text(moduleValue.review.summary, 'review summary', 1_000),
      },
      artifact: {
        fileName: text(moduleValue.artifact.fileName, 'artifact filename', 160),
        bytes: bytes as number,
        downloadPath: text(moduleValue.artifact.downloadPath, 'download path', 500),
        sha256,
      },
    };
  });
  return { schemaVersion: 1, modules };
}

async function readBounded(response: Response, maximum: number): Promise<Buffer> {
  if (!response.ok) throw new Error(`Marketplace returned HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > maximum) throw new Error('Marketplace response is too large.');
  return Buffer.from(await readBodyBytes(response.body, maximum, 'Marketplace response is too large.'));
}

async function fetchSignedMarketplaceDocument(
  relativePath: string,
  maximumBytes: number,
): Promise<{ bytes: Buffer; signature: MarketplaceMetadataSignature }> {
  if (getMarketplaceMode() !== 'online') throw new Error('Marketplace access is disabled in manual-install mode.');
  const base = getMarketplaceBaseUrl();
  if (!base) throw new Error('Marketplace URL is not configured.');
  const requestOptions = {
    headers: { accept: 'application/json' },
    redirect: 'error' as const,
    cache: 'no-store' as const,
    signal: AbortSignal.timeout(10_000),
  };
  const [response, signatureResponse] = await Promise.all([
    fetch(new URL(relativePath, base), requestOptions),
    fetch(new URL(`${relativePath}.sig`, base), requestOptions),
  ]);
  const [bytes, signatureBytes] = await Promise.all([
    readBounded(response, maximumBytes),
    readBounded(signatureResponse, SIGNATURE_LIMIT_BYTES),
  ]);
  let signatureValue: unknown;
  try {
    signatureValue = JSON.parse(signatureBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('Marketplace metadata signature is not valid JSON.');
  }
  return {
    bytes,
    signature: verifyMarketplaceMetadata(bytes, signatureValue, relativePath),
  };
}

export async function fetchMarketplaceCatalog(): Promise<MarketplaceCatalog> {
  const { bytes } = await fetchSignedMarketplaceDocument('api/v1/catalog.json', CATALOG_LIMIT_BYTES);
  try {
    return parseCatalog(JSON.parse(bytes.toString('utf8')) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Marketplace catalog is not valid JSON.');
    throw error;
  }
}

export async function fetchMarketplaceSecuritySnapshot(
  nowMilliseconds = Date.now(),
): Promise<VerifiedMarketplaceSecuritySnapshot> {
  const { bytes, signature } = await fetchSignedMarketplaceDocument(
    'api/v1/security.json',
    SECURITY_LIMIT_BYTES,
  );
  try {
    return {
      snapshot: parseMarketplaceSecuritySnapshot(
        JSON.parse(bytes.toString('utf8')) as unknown,
        nowMilliseconds,
      ),
      signature,
    };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Marketplace security snapshot is not valid JSON.');
    throw error;
  }
}

function downloadUrl(base: URL, path: string): URL {
  if (!path.startsWith('/') || path.includes('\\') || path.includes('\0')) throw new Error('Marketplace download path is invalid.');
  const url = new URL(path, base.origin);
  const basePath = base.pathname;
  if (url.origin !== base.origin || (basePath !== '/' && !url.pathname.startsWith(basePath))) {
    throw new Error('Marketplace download must remain under the configured base URL.');
  }
  return url;
}

export async function downloadMarketplaceModule(slug: string): Promise<Buffer> {
  const base = getMarketplaceBaseUrl();
  if (!base || getMarketplaceMode() !== 'online') throw new Error('Marketplace access is unavailable.');
  const catalog = await fetchMarketplaceCatalog();
  const listing = catalog.modules.find((module) => module.slug === slug);
  if (!listing) throw new Error('Marketplace Module was not found.');
  const response = await fetch(downloadUrl(base, listing.artifact.downloadPath), {
    headers: { accept: 'application/zip, application/octet-stream' },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const archive = await readBounded(response, Math.min(listing.artifact.bytes, MODULE_ARCHIVE_LIMITS.compressedBytes));
  if (archive.length !== listing.artifact.bytes) throw new ModulePackageError('Marketplace artifact length does not match its catalog record.', 'BAD_DOWNLOAD');
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== listing.artifact.sha256) throw new ModulePackageError('Marketplace artifact checksum does not match its catalog record.', 'BAD_DOWNLOAD');
  return archive;
}
