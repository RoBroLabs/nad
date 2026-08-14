import 'server-only';

import { rawDb } from '@/lib/db';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { generateId, now } from '@/lib/utils';

export type TrustedCodePolicy = 'reviewed_auto' | 'manual_each_release' | 'sandbox_only';
export type ReleaseTrustBasis = 'package-default' | 'review-attestation' | 'manual';

export interface ReleaseSurfaceTrust {
  digest: string;
  surfaceId: string;
  mode: 'sandboxed' | 'trusted';
  basis: ReleaseTrustBasis;
  policy: TrustedCodePolicy;
  revoked: boolean;
}

interface TrustRow {
  release_id: string;
  digest: string;
  decision: 'sandboxed' | 'trusted';
  basis: ReleaseTrustBasis;
  surface_ids_json: string;
  signer_key_id: string | null;
}

const policyKey = 'module.trusted_code_policy';

function parseSurfaceIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function getTrustedCodePolicy(): TrustedCodePolicy {
  const row = rawDb.prepare('SELECT value FROM app_settings WHERE key = ?').get(policyKey) as { value: string } | undefined;
  return row?.value === 'manual_each_release' || row?.value === 'sandbox_only' || row?.value === 'reviewed_auto'
    ? row.value
    : 'reviewed_auto';
}

export function setTrustedCodePolicy(policy: TrustedCodePolicy): void {
  if (policy !== 'reviewed_auto' && policy !== 'manual_each_release' && policy !== 'sandbox_only') {
    throw new ModulePackageError('Trusted-code policy is invalid.', 'INVALID_TRUST_POLICY');
  }
  rawDb.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(policyKey, policy, now());
}

export function ensureReleaseTrustRecord(releaseId: string, digest: string): void {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new ModulePackageError('Release digest is invalid.', 'INVALID_RELEASE_DIGEST');
  }
  const timestamp = now();
  rawDb.prepare(`
    INSERT INTO module_release_trust
      (id, release_id, digest, decision, basis, surface_ids_json, created_at, updated_at)
    VALUES (?, ?, ?, 'sandboxed', 'package-default', '[]', ?, ?)
    ON CONFLICT(release_id) DO NOTHING
  `).run(generateId(), releaseId, digest, timestamp, timestamp);
}

export function setExactDigestTrust(input: {
  digest: string;
  decision: 'sandboxed' | 'trusted';
  basis: Exclude<ReleaseTrustBasis, 'package-default'>;
  surfaceIds: string[];
  actorId?: string;
  verifiedAttestation?: Readonly<Record<string, unknown>>;
}): void {
  if (!/^[a-f0-9]{64}$/.test(input.digest)) {
    throw new ModulePackageError('Release digest is invalid.', 'INVALID_RELEASE_DIGEST');
  }
  if (input.surfaceIds.length > 128 || input.surfaceIds.some((id) => !/^[a-z][a-z0-9-]{0,79}$/.test(id))) {
    throw new ModulePackageError('Release trust contains an invalid surface.', 'INVALID_RELEASE_TRUST');
  }
  const release = rawDb.prepare(`
    SELECT id FROM module_releases WHERE digest = ?
  `).get(input.digest) as { id: string } | undefined;
  if (!release) throw new ModulePackageError('Release not found.', 'RELEASE_NOT_FOUND');
  if (input.basis === 'review-attestation' && !input.verifiedAttestation) {
    throw new ModulePackageError('Reviewed trust requires a verified exact-digest attestation.', 'ATTESTATION_REQUIRED');
  }
  if (input.basis === 'review-attestation') {
    const attestedDigest = input.verifiedAttestation?.artifactDigest ?? input.verifiedAttestation?.digest;
    if (attestedDigest !== input.digest) {
      throw new ModulePackageError('Review attestation does not match the release digest.', 'ATTESTATION_MISMATCH');
    }
  }
  const timestamp = now();
  rawDb.prepare(`
    INSERT INTO module_release_trust
      (id, release_id, digest, decision, basis, surface_ids_json,
       attestation_json, approved_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id) DO UPDATE SET
      digest = excluded.digest,
      decision = excluded.decision,
      basis = excluded.basis,
      surface_ids_json = excluded.surface_ids_json,
      attestation_json = excluded.attestation_json,
      approved_by = excluded.approved_by,
      updated_at = excluded.updated_at
  `).run(
    generateId(),
    release.id,
    input.digest,
    input.decision,
    input.basis,
    JSON.stringify([...new Set(input.surfaceIds)].sort()),
    input.verifiedAttestation ? JSON.stringify(input.verifiedAttestation) : null,
    input.actorId ?? null,
    timestamp,
    timestamp,
  );
}

function isRevoked(digest: string, signerKeyId: string | null): boolean {
  const row = rawDb.prepare(`
    SELECT 1
    FROM marketplace_revocations
    WHERE action = 'quarantine'
      AND (
        (target_type = 'artifact' AND target_value = ?)
        OR (target_type = 'signing-key' AND target_value = ?)
      )
    LIMIT 1
  `).get(digest, signerKeyId ?? '');
  return Boolean(row);
}

export function getReleaseSurfaceTrust(digest: string, surfaceId: string): ReleaseSurfaceTrust {
  if (!/^[a-f0-9]{64}$/.test(digest) || !/^[a-z][a-z0-9-]{0,79}$/.test(surfaceId)) {
    throw new ModulePackageError('Release surface identity is invalid.', 'INVALID_RELEASE_TRUST');
  }
  const row = rawDb.prepare(`
    SELECT
      module_release_trust.release_id,
      module_release_trust.digest,
      module_release_trust.decision,
      module_release_trust.basis,
      module_release_trust.surface_ids_json,
      module_releases.signer_key_id
    FROM module_release_trust
    JOIN module_releases ON module_releases.id = module_release_trust.release_id
    WHERE module_release_trust.digest = ?
  `).get(digest) as TrustRow | undefined;
  const policy = getTrustedCodePolicy();
  const revoked = row ? isRevoked(digest, row.signer_key_id) : false;
  const surfaceIds = row ? parseSurfaceIds(row.surface_ids_json) : [];
  const surfaceApproved = surfaceIds.includes('*') || surfaceIds.includes(surfaceId);
  const basisPermitted = row?.basis === 'manual'
    || (policy === 'reviewed_auto' && row?.basis === 'review-attestation');
  const trusted = Boolean(
    row
    && !revoked
    && policy !== 'sandbox_only'
    && row.decision === 'trusted'
    && surfaceApproved
    && basisPermitted,
  );
  return {
    digest,
    surfaceId,
    mode: trusted ? 'trusted' : 'sandboxed',
    basis: row?.basis ?? 'package-default',
    policy,
    revoked,
  };
}
