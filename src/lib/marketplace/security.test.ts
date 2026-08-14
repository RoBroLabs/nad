import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedMarketplaceSecuritySnapshot } from '@/lib/marketplace/security-types';

const directory = mkdtempSync(join(tmpdir(), 'nad-marketplace-security-'));
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
process.env.NAD_MARKETPLACE_MODE = 'online';
process.env.NAD_MARKETPLACE_URL = 'https://market.example/';
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type Security = typeof import('@/lib/marketplace/security');
type Database = typeof import('@/lib/db');
let security: Security;
let database: Database;

const activeDigest = 'a'.repeat(64);
const signerKeyId = 'robrolabs-first-party-2026-08';

function verifiedSnapshot(
  sequence: number,
  overrides: Partial<VerifiedMarketplaceSecuritySnapshot['snapshot']> = {},
  signatureSha = String(sequence).repeat(64).slice(0, 64),
): VerifiedMarketplaceSecuritySnapshot {
  return {
    snapshot: {
      schemaVersion: 1,
      sequence,
      issuedAt: '2026-08-12T12:00:00.000Z',
      expiresAt: '2026-08-13T12:00:00.000Z',
      recommendations: [{
        moduleId: 'dev.robrolabs.system-monitor',
        moduleSlug: 'system-monitor',
        version: '1.0.3',
        artifactSha256: 'b'.repeat(64),
        signerKeyId,
      }],
      advisories: [{
        id: 'NAD-2026-SM-001',
        moduleId: 'dev.robrolabs.system-monitor',
        moduleSlug: 'system-monitor',
        moduleName: 'System Monitor',
        severity: 'high',
        status: 'open',
        publishedAt: '2026-08-12T10:00:00.000Z',
        updatedAt: '2026-08-12T10:00:00.000Z',
        title: 'Affected release',
        summary: 'This exact release needs attention.',
        guidance: 'Update to 1.0.3.',
        affectedVersions: ['1.0.0'],
        fixedVersions: ['1.0.3'],
        affected: [{ version: '1.0.0', artifactSha256: activeDigest }],
        references: ['https://nad.robrolabs.com/modules/system-monitor'],
        path: '/api/v1/advisories/NAD-2026-SM-001.json',
        url: 'https://nad.robrolabs.com/api/v1/advisories/NAD-2026-SM-001.json',
      }],
      revocations: [{
        id: 'NAD-REV-2026-001',
        moduleSlug: 'system-monitor',
        moduleName: 'System Monitor',
        version: '1.0.0',
        severity: 'critical',
        action: 'quarantine',
        target: { type: 'artifact', sha256: activeDigest },
        moduleId: 'dev.robrolabs.system-monitor',
        publishedAt: '2026-08-12T10:00:00.000Z',
        updatedAt: '2026-08-12T10:00:00.000Z',
        reason: 'security',
        summary: 'Execution must stop while the artifact remains installed.',
        replacementVersion: '1.0.3',
      }],
      ...overrides,
    },
    signature: {
      schemaVersion: 1,
      algorithm: 'Ed25519',
      keyId: 'robrolabs-marketplace-metadata-2026-08',
      signedPath: 'api/v1/security.json',
      sha256: signatureSha,
      signature: 'fixture-signature',
    },
  };
}

function insertActiveRelease(): void {
  database.rawDb.prepare(`
    INSERT INTO installed_modules
      (module_id, slug, enabled, lifecycle_state, active_release_id, installed_at, updated_at)
    VALUES ('dev.robrolabs.system-monitor', 'system-monitor', 1, 'active', 'release-active', 'now', 'now')
  `).run();
  database.rawDb.prepare(`
    INSERT INTO module_releases
      (id, module_id, version, digest, artifact_path, manifest_json, ui_pages_json,
       ui_widgets_json, signer_key_id, signature_status, state, installed_at)
    VALUES ('release-active', 'dev.robrolabs.system-monitor', '1.0.0', ?, '/artifact',
            '{}', '{}', '{}', ?, 'verified', 'active', 'now')
  `).run(activeDigest, signerKeyId);
}

beforeAll(async () => {
  database = await import('@/lib/db');
  security = await import('@/lib/marketplace/security');
});

beforeEach(() => {
  process.env.NAD_MARKETPLACE_MODE = 'online';
  security.resetMarketplaceSecurityRefreshCacheForTests();
  database.rawDb.exec(`
    DELETE FROM marketplace_recommendations;
    DELETE FROM marketplace_advisories;
    DELETE FROM marketplace_revocations;
    DELETE FROM marketplace_security_state;
    DELETE FROM module_releases;
    DELETE FROM installed_modules;
  `);
  insertActiveRelease();
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('persistent Marketplace security state', () => {
  it('matches exact installed digests, exposes recommendations, and blocks activation', () => {
    security.applyVerifiedMarketplaceSecuritySnapshot(
      verifiedSnapshot(1),
      '2026-08-12T12:05:00.000Z',
    );

    const state = security.getInstalledMarketplaceSecurityState(
      Date.parse('2026-08-12T12:10:00.000Z'),
    );
    expect(state).toMatchObject({
      available: true,
      freshness: 'current',
      sequence: 1,
      installedFindings: [{
        digest: activeDigest,
        quarantineRequired: true,
        advisories: [{ id: 'NAD-2026-SM-001' }],
        revocations: [{ id: 'NAD-REV-2026-001', action: 'quarantine' }],
        recommendation: { version: '1.0.3', updateAvailable: true },
      }],
    });
    expect(security.isReleaseQuarantined(activeDigest, signerKeyId)).toBe(true);
    expect(() => security.assertReleaseActivationAllowed(activeDigest, signerKeyId))
      .toThrow(expect.objectContaining({ code: 'RELEASE_REVOKED' }));
  });

  it('matches a persisted signing-key revocation and preserves it when omitted later', () => {
    const keyRevocation = {
      ...verifiedSnapshot(1).snapshot.revocations[0],
      target: { type: 'signing-key' as const, keyId: signerKeyId },
    };
    security.applyVerifiedMarketplaceSecuritySnapshot(verifiedSnapshot(1, {
      revocations: [keyRevocation],
    }));
    security.applyVerifiedMarketplaceSecuritySnapshot(verifiedSnapshot(2, {
      revocations: [],
      advisories: [],
    }));

    expect(security.getKnownReleaseRevocations(activeDigest, signerKeyId))
      .toEqual([expect.objectContaining({ targetType: 'signing-key', action: 'quarantine' })]);
    expect(security.getInstalledMarketplaceSecurityState().installedFindings[0])
      .toMatchObject({ quarantineRequired: true, advisories: [{ id: 'NAD-2026-SM-001' }] });
  });

  it('accepts an explicit advisory resolution but rejects feed rollback and same-sequence rewrites', () => {
    security.applyVerifiedMarketplaceSecuritySnapshot(verifiedSnapshot(2));
    const resolved = {
      ...verifiedSnapshot(3).snapshot.advisories[0],
      status: 'resolved' as const,
      updatedAt: '2026-08-12T11:00:00.000Z',
    };
    security.applyVerifiedMarketplaceSecuritySnapshot(verifiedSnapshot(3, { advisories: [resolved] }));
    expect(security.getInstalledMarketplaceSecurityState().installedFindings[0].advisories[0].status)
      .toBe('resolved');

    expect(() => security.applyVerifiedMarketplaceSecuritySnapshot(verifiedSnapshot(2)))
      .toThrow(expect.objectContaining({ code: 'MARKETPLACE_SECURITY_ROLLBACK' }));
    expect(() => security.applyVerifiedMarketplaceSecuritySnapshot(
      verifiedSnapshot(3, { advisories: [resolved] }, 'f'.repeat(64)),
    )).toThrow(expect.objectContaining({ code: 'MARKETPLACE_SECURITY_REPLAY' }));
  });

  it('reports stale last-known-good findings without deleting them', () => {
    security.applyVerifiedMarketplaceSecuritySnapshot(verifiedSnapshot(1, {
      expiresAt: '2026-08-12T13:00:00.000Z',
    }));
    const state = security.getInstalledMarketplaceSecurityState(
      Date.parse('2026-08-12T14:00:00.000Z'),
    );
    expect(state.freshness).toBe('stale');
    expect(state.installedFindings[0].quarantineRequired).toBe(true);
  });

  it('makes no outbound request in manual mode and still returns persisted warnings', async () => {
    security.applyVerifiedMarketplaceSecuritySnapshot(verifiedSnapshot(1));
    process.env.NAD_MARKETPLACE_MODE = 'manual';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const state = await security.refreshMarketplaceSecurity({ force: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.mode).toBe('manual');
    expect(state.installedFindings[0].quarantineRequired).toBe(true);
  });

  it('keeps last-known-good findings through an outage and coalesces concurrent refreshes', async () => {
    security.applyVerifiedMarketplaceSecuritySnapshot(verifiedSnapshot(1));
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = security.refreshMarketplaceSecurity({
      force: true,
      nowMilliseconds: Date.parse('2026-08-12T12:30:00.000Z'),
    });
    const second = security.refreshMarketplaceSecurity({
      force: true,
      nowMilliseconds: Date.parse('2026-08-12T12:30:00.000Z'),
    });
    expect(first).toBe(second);
    const [firstState, secondState] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstState.lastErrorCode).toBe('MARKETPLACE_SECURITY_UNAVAILABLE');
    expect(firstState.installedFindings[0].quarantineRequired).toBe(true);
    expect(secondState).toEqual(firstState);
  });
});
