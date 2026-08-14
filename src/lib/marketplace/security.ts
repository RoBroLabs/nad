import 'server-only';

import { rawDb } from '@/lib/db';
import { fetchMarketplaceSecuritySnapshot, getMarketplaceMode } from '@/lib/marketplace/client';
import type {
  MarketplaceRecommendedRelease,
  MarketplaceSecurityAdvisory,
  MarketplaceSecurityRevocation,
  VerifiedMarketplaceSecuritySnapshot,
} from '@/lib/marketplace/security-types';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

const SECURITY_REFRESH_TTL_MS = 5 * 60 * 1_000;
const SECURITY_FEED = 'security';

interface StoredSecurityStateRow {
  sequence: number;
  issued_at: string;
  expires_at: string;
  signer_key_id: string;
  document_sha256: string;
  last_checked_at: string;
  last_succeeded_at: string;
  last_error_code: string | null;
}

interface StoredRecommendationRow {
  module_id: string;
  module_slug: string;
  version: string;
  artifact_sha256: string;
  signer_key_id: string;
}

interface StoredAdvisoryRow {
  id: string;
  module_id: string;
  module_slug: string;
  module_name: string;
  severity: MarketplaceSecurityAdvisory['severity'];
  status: MarketplaceSecurityAdvisory['status'];
  published_at: string;
  updated_at: string;
  title: string;
  summary: string;
  guidance: string;
  affected_json: string;
  affected_versions_json: string;
  fixed_versions_json: string;
  references_json: string;
  path: string;
  url: string;
}

interface StoredRevocationRow {
  id: string;
  target_type: 'artifact' | 'signing-key';
  target_value: string;
  module_id: string;
  module_slug: string;
  module_name: string;
  version: string;
  severity: MarketplaceSecurityRevocation['severity'];
  action: MarketplaceSecurityRevocation['action'];
  published_at: string;
  updated_at: string;
  reason: string;
  summary: string;
  replacement_version: string | null;
}

interface InstalledReleaseRow {
  module_id: string;
  module_slug: string;
  module_lifecycle_state: string;
  release_id: string;
  version: string;
  digest: string;
  signer_key_id: string | null;
  release_state: 'active' | 'retained';
}

export interface MarketplaceReleaseRevocationFinding {
  id: string;
  targetType: 'artifact' | 'signing-key';
  targetValue: string;
  moduleId: string;
  moduleSlug: string;
  moduleName: string;
  version: string;
  severity: MarketplaceSecurityRevocation['severity'];
  action: MarketplaceSecurityRevocation['action'];
  publishedAt: string;
  updatedAt: string;
  reason: string;
  summary: string;
  replacementVersion?: string;
}

export interface MarketplaceInstalledReleaseFinding {
  moduleId: string;
  moduleSlug: string;
  moduleLifecycleState: string;
  releaseId: string;
  version: string;
  digest: string;
  signerKeyId: string | null;
  releaseState: 'active' | 'retained';
  advisories: MarketplaceSecurityAdvisory[];
  revocations: MarketplaceReleaseRevocationFinding[];
  quarantineRequired: boolean;
  recommendation?: MarketplaceRecommendedRelease & { updateAvailable: boolean };
}

export interface InstalledMarketplaceSecurityState {
  mode: 'online' | 'manual';
  available: boolean;
  freshness: 'current' | 'stale' | 'unavailable';
  sequence?: number;
  issuedAt?: string;
  expiresAt?: string;
  signerKeyId?: string;
  documentSha256?: string;
  lastCheckedAt?: string;
  lastSucceededAt?: string;
  lastErrorCode?: string;
  recommendations: MarketplaceRecommendedRelease[];
  installedFindings: MarketplaceInstalledReleaseFinding[];
}

export interface RefreshMarketplaceSecurityOptions {
  force?: boolean;
  nowMilliseconds?: number;
}

let refreshInFlight: Promise<InstalledMarketplaceSecurityState> | undefined;
let lastRefreshAttemptMilliseconds = 0;
let transientRefreshErrorCode: string | undefined;

function securityStateRow(): StoredSecurityStateRow | undefined {
  return rawDb.prepare(`
    SELECT sequence, issued_at, expires_at, signer_key_id, document_sha256,
           last_checked_at, last_succeeded_at, last_error_code
    FROM marketplace_security_state
    WHERE feed = ?
  `).get(SECURITY_FEED) as StoredSecurityStateRow | undefined;
}

function parseJsonArray<T>(value: string): T[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed as T[] : [];
}

function storedAdvisories(): MarketplaceSecurityAdvisory[] {
  const rows = rawDb.prepare(`
    SELECT id, module_id, module_slug, module_name, severity, status, published_at, updated_at,
           title, summary, guidance, affected_json, affected_versions_json,
           fixed_versions_json, references_json, path, url
    FROM marketplace_advisories
    ORDER BY published_at DESC, id
  `).all() as StoredAdvisoryRow[];
  return rows.map((row) => ({
    id: row.id,
    moduleId: row.module_id,
    moduleSlug: row.module_slug,
    moduleName: row.module_name,
    severity: row.severity,
    status: row.status,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    title: row.title,
    summary: row.summary,
    guidance: row.guidance,
    affected: parseJsonArray<MarketplaceSecurityAdvisory['affected'][number]>(row.affected_json),
    affectedVersions: parseJsonArray<string>(row.affected_versions_json),
    fixedVersions: parseJsonArray<string>(row.fixed_versions_json),
    references: parseJsonArray<string>(row.references_json),
    path: row.path,
    url: row.url,
  }));
}

function mapRevocation(row: StoredRevocationRow): MarketplaceReleaseRevocationFinding {
  return {
    id: row.id,
    targetType: row.target_type,
    targetValue: row.target_value,
    moduleId: row.module_id,
    moduleSlug: row.module_slug,
    moduleName: row.module_name,
    version: row.version,
    severity: row.severity,
    action: row.action,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    reason: row.reason,
    summary: row.summary,
    ...(row.replacement_version ? { replacementVersion: row.replacement_version } : {}),
  };
}

export function getKnownReleaseRevocations(
  digest: string,
  signerKeyId?: string | null,
): MarketplaceReleaseRevocationFinding[] {
  const rows = signerKeyId
    ? rawDb.prepare(`
        SELECT id, target_type, target_value, module_id, module_slug, module_name, version,
               severity, action, published_at, updated_at, reason, summary,
               replacement_version
        FROM marketplace_revocations
        WHERE (target_type = 'artifact' AND target_value = ?)
           OR (target_type = 'signing-key' AND target_value = ?)
        ORDER BY published_at, id
      `).all(digest, signerKeyId) as StoredRevocationRow[]
    : rawDb.prepare(`
        SELECT id, target_type, target_value, module_id, module_slug, module_name, version,
               severity, action, published_at, updated_at, reason, summary,
               replacement_version
        FROM marketplace_revocations
        WHERE target_type = 'artifact' AND target_value = ?
        ORDER BY published_at, id
      `).all(digest) as StoredRevocationRow[];
  return rows.map(mapRevocation);
}

export function isReleaseQuarantined(digest: string, signerKeyId?: string | null): boolean {
  return getKnownReleaseRevocations(digest, signerKeyId).some(({ action }) => action === 'quarantine');
}

export function assertReleaseActivationAllowed(digest: string, signerKeyId?: string | null): void {
  const revocation = getKnownReleaseRevocations(digest, signerKeyId)
    .find(({ action }) => action === 'quarantine');
  if (revocation) {
    throw new ModulePackageError(
      `This Plugin release is quarantined by Marketplace revocation ${revocation.id}.`,
      'RELEASE_REVOKED',
    );
  }
}

function recommendations(): MarketplaceRecommendedRelease[] {
  const rows = rawDb.prepare(`
    SELECT module_id, module_slug, version, artifact_sha256, signer_key_id
    FROM marketplace_recommendations
    ORDER BY module_slug
  `).all() as StoredRecommendationRow[];
  return rows.map((row) => ({
    moduleId: row.module_id,
    moduleSlug: row.module_slug,
    version: row.version,
    artifactSha256: row.artifact_sha256,
    signerKeyId: row.signer_key_id,
  }));
}

function versionParts(version: string): [number, number, number, string | undefined] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/.exec(version);
  if (!match) return [0, 0, 0, version];
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]];
}

function comparePrerelease(left: string, right: string): number {
  const leftIdentifiers = left.split('.');
  const rightIdentifiers = right.split('.');
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftIdentifiers[index];
    const rightValue = rightIdentifiers[index];
    if (leftValue === undefined) return -1;
    if (rightValue === undefined) return 1;
    if (leftValue === rightValue) continue;
    const leftNumeric = /^\d+$/.test(leftValue);
    const rightNumeric = /^\d+$/.test(rightValue);
    if (leftNumeric && rightNumeric) return Number(leftValue) - Number(rightValue);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftValue.localeCompare(rightValue);
  }
  return 0;
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number);
  }
  if (a[3] === b[3]) return 0;
  if (a[3] === undefined) return 1;
  if (b[3] === undefined) return -1;
  return comparePrerelease(a[3], b[3]);
}

export function getInstalledMarketplaceSecurityState(
  nowMilliseconds = Date.now(),
): InstalledMarketplaceSecurityState {
  const feed = securityStateRow();
  const currentRecommendations = recommendations();
  const recommendationByModuleId = new Map(currentRecommendations.map((item) => [item.moduleId, item]));
  const advisories = storedAdvisories();
  const releases = rawDb.prepare(`
    SELECT installed_modules.module_id, installed_modules.slug AS module_slug,
           installed_modules.lifecycle_state AS module_lifecycle_state,
           module_releases.id AS release_id, module_releases.version,
           module_releases.digest, module_releases.signer_key_id,
           module_releases.state AS release_state
    FROM installed_modules
    JOIN module_releases ON module_releases.module_id = installed_modules.module_id
    WHERE module_releases.state IN ('active', 'retained')
    ORDER BY installed_modules.slug, module_releases.state, module_releases.version DESC
  `).all() as InstalledReleaseRow[];

  const installedFindings = releases.map((release): MarketplaceInstalledReleaseFinding => {
    const releaseAdvisories = advisories.filter((advisory) => advisory.moduleSlug === release.module_slug
      && advisory.affected.some(({ artifactSha256 }) => artifactSha256 === release.digest));
    const revocations = getKnownReleaseRevocations(release.digest, release.signer_key_id);
    const recommendation = recommendationByModuleId.get(release.module_id);
    return {
      moduleId: release.module_id,
      moduleSlug: release.module_slug,
      moduleLifecycleState: release.module_lifecycle_state,
      releaseId: release.release_id,
      version: release.version,
      digest: release.digest,
      signerKeyId: release.signer_key_id,
      releaseState: release.release_state,
      advisories: releaseAdvisories,
      revocations,
      quarantineRequired: revocations.some(({ action }) => action === 'quarantine'),
      ...(recommendation ? {
        recommendation: {
          ...recommendation,
          updateAvailable: recommendation.artifactSha256 !== release.digest
            && compareVersions(recommendation.version, release.version) > 0,
        },
      } : {}),
    };
  });

  return {
    mode: getMarketplaceMode(),
    available: Boolean(feed),
    freshness: !feed ? 'unavailable' : Date.parse(feed.expires_at) > nowMilliseconds ? 'current' : 'stale',
    ...(feed ? {
      sequence: feed.sequence,
      issuedAt: feed.issued_at,
      expiresAt: feed.expires_at,
      signerKeyId: feed.signer_key_id,
      documentSha256: feed.document_sha256,
      lastCheckedAt: feed.last_checked_at,
      lastSucceededAt: feed.last_succeeded_at,
      ...(feed.last_error_code ? { lastErrorCode: feed.last_error_code } : {}),
    } : transientRefreshErrorCode ? { lastErrorCode: transientRefreshErrorCode } : {}),
    recommendations: currentRecommendations,
    installedFindings,
  };
}

function revocationTarget(revocation: MarketplaceSecurityRevocation): { type: string; value: string } {
  return revocation.target.type === 'artifact'
    ? { type: 'artifact', value: revocation.target.sha256 }
    : { type: 'signing-key', value: revocation.target.keyId };
}

function sameStoredAdvisoryContent(stored: StoredAdvisoryRow, advisory: MarketplaceSecurityAdvisory): boolean {
  return stored.severity === advisory.severity
    && stored.status === advisory.status
    && stored.title === advisory.title
    && stored.summary === advisory.summary
    && stored.guidance === advisory.guidance
    && stored.affected_json === JSON.stringify(advisory.affected)
    && stored.affected_versions_json === JSON.stringify(advisory.affectedVersions)
    && stored.fixed_versions_json === JSON.stringify(advisory.fixedVersions)
    && stored.references_json === JSON.stringify(advisory.references)
    && stored.path === advisory.path
    && stored.url === advisory.url;
}

function sameStoredRevocationContent(
  stored: StoredRevocationRow,
  revocation: MarketplaceSecurityRevocation,
): boolean {
  return stored.severity === revocation.severity
    && stored.action === revocation.action
    && stored.reason === revocation.reason
    && stored.summary === revocation.summary
    && stored.replacement_version === (revocation.replacementVersion ?? null);
}

function assertSnapshotDoesNotRewriteHistory(
  verified: VerifiedMarketplaceSecuritySnapshot,
  current: StoredSecurityStateRow | undefined,
): 'new' | 'repeat' {
  const { snapshot, signature } = verified;
  if (!current) return 'new';
  if (snapshot.sequence < current.sequence) {
    throw new ModulePackageError('Marketplace security metadata sequence moved backwards.', 'MARKETPLACE_SECURITY_ROLLBACK');
  }
  if (snapshot.sequence === current.sequence) {
    if (signature.sha256 !== current.document_sha256) {
      throw new ModulePackageError('Marketplace security metadata changed without a new sequence.', 'MARKETPLACE_SECURITY_REPLAY');
    }
    return 'repeat';
  }

  for (const advisory of snapshot.advisories) {
    const stored = rawDb.prepare(`
      SELECT id, module_id, module_slug, module_name, severity, status,
             published_at, updated_at, title, summary, guidance, affected_json,
             affected_versions_json, fixed_versions_json, references_json, path, url
      FROM marketplace_advisories WHERE id = ?
    `).get(advisory.id) as StoredAdvisoryRow | undefined;
    if (!stored) continue;
    if (stored.module_id !== advisory.moduleId || stored.module_slug !== advisory.moduleSlug || stored.module_name !== advisory.moduleName
      || stored.published_at !== advisory.publishedAt || Date.parse(advisory.updatedAt) < Date.parse(stored.updated_at)
      || (advisory.updatedAt === stored.updated_at && !sameStoredAdvisoryContent(stored, advisory))) {
      throw new ModulePackageError(`Marketplace advisory ${advisory.id} rewrites verified history.`, 'MARKETPLACE_SECURITY_REPLAY');
    }
  }

  for (const revocation of snapshot.revocations) {
    const target = revocationTarget(revocation);
    const storedById = rawDb.prepare(`
      SELECT id, target_type, target_value, module_id, module_slug, module_name,
             version, severity, action, published_at, updated_at, reason, summary,
             replacement_version
      FROM marketplace_revocations WHERE id = ?
    `).get(revocation.id) as StoredRevocationRow | undefined;
    const storedByTarget = rawDb.prepare(`
      SELECT id, target_type, target_value, action, published_at, updated_at
      FROM marketplace_revocations WHERE target_type = ? AND target_value = ?
    `).get(target.type, target.value) as Pick<StoredRevocationRow, 'id' | 'target_type' | 'target_value' | 'action' | 'published_at' | 'updated_at'> | undefined;
    if (storedByTarget && storedByTarget.id !== revocation.id) {
      throw new ModulePackageError('Marketplace security metadata reassigns a known revocation target.', 'MARKETPLACE_SECURITY_REPLAY');
    }
    if (storedById && (storedById.target_type !== target.type || storedById.target_value !== target.value
      || storedById.module_id !== revocation.moduleId || storedById.module_slug !== revocation.moduleSlug
      || storedById.module_name !== revocation.moduleName || storedById.version !== revocation.version
      || storedById.published_at !== revocation.publishedAt
      || Date.parse(revocation.updatedAt) < Date.parse(storedById.updated_at)
      || (revocation.updatedAt === storedById.updated_at && !sameStoredRevocationContent(storedById, revocation))
      || (storedById.action === 'quarantine' && revocation.action !== 'quarantine'))) {
      throw new ModulePackageError(`Marketplace revocation ${revocation.id} rewrites verified history.`, 'MARKETPLACE_SECURITY_REPLAY');
    }
  }
  return 'new';
}

export function applyVerifiedMarketplaceSecuritySnapshot(
  verified: VerifiedMarketplaceSecuritySnapshot,
  checkedAt = new Date().toISOString(),
): void {
  const { snapshot, signature } = verified;
  rawDb.transaction(() => {
    const current = securityStateRow();
    const mode = assertSnapshotDoesNotRewriteHistory(verified, current);
    if (mode === 'new') {
      rawDb.prepare('DELETE FROM marketplace_recommendations').run();
      const insertRecommendation = rawDb.prepare(`
        INSERT INTO marketplace_recommendations
          (module_id, module_slug, version, artifact_sha256, signer_key_id, snapshot_sequence)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const recommendation of snapshot.recommendations) {
        insertRecommendation.run(
          recommendation.moduleId,
          recommendation.moduleSlug,
          recommendation.version,
          recommendation.artifactSha256,
          recommendation.signerKeyId,
          snapshot.sequence,
        );
      }

      const upsertAdvisory = rawDb.prepare(`
        INSERT INTO marketplace_advisories
          (id, module_id, module_slug, module_name, severity, status, published_at, updated_at,
           title, summary, guidance, affected_json, affected_versions_json,
           fixed_versions_json, references_json, path, url, first_seen_sequence,
           last_seen_sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          severity = excluded.severity,
          status = excluded.status,
          updated_at = excluded.updated_at,
          title = excluded.title,
          summary = excluded.summary,
          guidance = excluded.guidance,
          affected_json = excluded.affected_json,
          affected_versions_json = excluded.affected_versions_json,
          fixed_versions_json = excluded.fixed_versions_json,
          references_json = excluded.references_json,
          path = excluded.path,
          url = excluded.url,
          last_seen_sequence = excluded.last_seen_sequence
      `);
      for (const advisory of snapshot.advisories) {
        upsertAdvisory.run(
          advisory.id,
          advisory.moduleId,
          advisory.moduleSlug,
          advisory.moduleName,
          advisory.severity,
          advisory.status,
          advisory.publishedAt,
          advisory.updatedAt,
          advisory.title,
          advisory.summary,
          advisory.guidance,
          JSON.stringify(advisory.affected),
          JSON.stringify(advisory.affectedVersions),
          JSON.stringify(advisory.fixedVersions),
          JSON.stringify(advisory.references),
          advisory.path,
          advisory.url,
          snapshot.sequence,
          snapshot.sequence,
        );
      }

      const upsertRevocation = rawDb.prepare(`
        INSERT INTO marketplace_revocations
          (id, target_type, target_value, module_id, module_slug, module_name, version,
           severity, action, published_at, updated_at, reason, summary,
           replacement_version, first_seen_sequence, last_seen_sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          module_slug = excluded.module_slug,
          module_name = excluded.module_name,
          version = excluded.version,
          severity = excluded.severity,
          action = excluded.action,
          updated_at = excluded.updated_at,
          reason = excluded.reason,
          summary = excluded.summary,
          replacement_version = excluded.replacement_version,
          last_seen_sequence = excluded.last_seen_sequence
      `);
      for (const revocation of snapshot.revocations) {
        const target = revocationTarget(revocation);
        upsertRevocation.run(
          revocation.id,
          target.type,
          target.value,
          revocation.moduleId,
          revocation.moduleSlug,
          revocation.moduleName,
          revocation.version,
          revocation.severity,
          revocation.action,
          revocation.publishedAt,
          revocation.updatedAt,
          revocation.reason,
          revocation.summary,
          revocation.replacementVersion ?? null,
          snapshot.sequence,
          snapshot.sequence,
        );
      }
    }

    rawDb.prepare(`
      INSERT INTO marketplace_security_state
        (feed, sequence, issued_at, expires_at, signer_key_id, document_sha256,
         last_checked_at, last_succeeded_at, last_error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(feed) DO UPDATE SET
        sequence = excluded.sequence,
        issued_at = excluded.issued_at,
        expires_at = excluded.expires_at,
        signer_key_id = excluded.signer_key_id,
        document_sha256 = excluded.document_sha256,
        last_checked_at = excluded.last_checked_at,
        last_succeeded_at = excluded.last_succeeded_at,
        last_error_code = NULL
    `).run(
      SECURITY_FEED,
      snapshot.sequence,
      snapshot.issuedAt,
      snapshot.expiresAt,
      signature.keyId,
      signature.sha256,
      checkedAt,
      checkedAt,
    );
  }).immediate();
  transientRefreshErrorCode = undefined;
}

function safeRefreshErrorCode(error: unknown): string {
  if (error instanceof ModulePackageError && /^MARKETPLACE_SECURITY_[A-Z_]+$/.test(error.code)) return error.code;
  if (error instanceof Error && /expired/i.test(error.message)) return 'MARKETPLACE_SECURITY_EXPIRED';
  if (error instanceof Error && /signature|digest/i.test(error.message)) return 'MARKETPLACE_SECURITY_UNTRUSTED';
  return 'MARKETPLACE_SECURITY_UNAVAILABLE';
}

function recordRefreshFailure(code: string, checkedAt: string): void {
  transientRefreshErrorCode = code;
  rawDb.prepare(`
    UPDATE marketplace_security_state
    SET last_checked_at = ?, last_error_code = ?
    WHERE feed = ?
  `).run(checkedAt, code, SECURITY_FEED);
}

async function performRefresh(nowMilliseconds: number): Promise<InstalledMarketplaceSecurityState> {
  const checkedAt = new Date(nowMilliseconds).toISOString();
  try {
    const verified = await fetchMarketplaceSecuritySnapshot(nowMilliseconds);
    applyVerifiedMarketplaceSecuritySnapshot(verified, checkedAt);
  } catch (error) {
    recordRefreshFailure(safeRefreshErrorCode(error), checkedAt);
  }
  return getInstalledMarketplaceSecurityState(nowMilliseconds);
}

export function refreshMarketplaceSecurity(
  options: RefreshMarketplaceSecurityOptions = {},
): Promise<InstalledMarketplaceSecurityState> {
  const nowMilliseconds = options.nowMilliseconds ?? Date.now();
  if (getMarketplaceMode() !== 'online') {
    return Promise.resolve(getInstalledMarketplaceSecurityState(nowMilliseconds));
  }
  if (!options.force && lastRefreshAttemptMilliseconds > 0
    && nowMilliseconds >= lastRefreshAttemptMilliseconds
    && nowMilliseconds - lastRefreshAttemptMilliseconds < SECURITY_REFRESH_TTL_MS) {
    return Promise.resolve(getInstalledMarketplaceSecurityState(nowMilliseconds));
  }
  if (refreshInFlight) return refreshInFlight;
  lastRefreshAttemptMilliseconds = nowMilliseconds;
  refreshInFlight = performRefresh(nowMilliseconds).finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

export function resetMarketplaceSecurityRefreshCacheForTests(): void {
  lastRefreshAttemptMilliseconds = 0;
  transientRefreshErrorCode = undefined;
  refreshInFlight = undefined;
}
