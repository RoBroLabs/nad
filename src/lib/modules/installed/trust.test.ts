import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'nad-release-trust-'));
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
delete process.env.NAD_BUILD_EPHEMERAL_DB;

type Trust = typeof import('@/lib/modules/installed/trust');
type Database = typeof import('@/lib/db');
let trust: Trust;
let database: Database;
const digest = 'b'.repeat(64);

beforeAll(async () => {
  database = await import('@/lib/db');
  trust = await import('@/lib/modules/installed/trust');
  database.rawDb.exec(`
    INSERT INTO users
      (id, email, name, password_hash, role, created_at, updated_at)
    VALUES ('admin', 'admin@example.test', 'Admin', 'hash', 'admin', 'now', 'now');
  `);
});

beforeEach(() => {
  database.rawDb.exec(`
    DELETE FROM marketplace_revocations;
    DELETE FROM module_release_trust;
    DELETE FROM module_releases;
    DELETE FROM installed_modules;
    DELETE FROM app_settings WHERE key = 'module.trusted_code_policy';
    INSERT INTO installed_modules
      (module_id, slug, enabled, lifecycle_state, active_release_id,
       installed_by, installed_at, updated_at)
    VALUES ('dev.robrolabs.app', 'app', 1, 'active', 'release-1', 'admin', 'now', 'now');
    INSERT INTO module_releases
      (id, module_id, version, digest, artifact_path, manifest_json,
       ui_pages_json, ui_widgets_json, signature_status, signer_key_id, state, installed_at)
    VALUES
      ('release-1', 'dev.robrolabs.app', '2.0.0', '${digest}', '/artifact', '{}', '{}', '{}',
       'verified', 'publisher-key', 'active', 'now');
  `);
  trust.ensureReleaseTrustRecord('release-1', digest);
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('exact-digest surface trust', () => {
  it('does not infer trusted execution from package signing alone', () => {
    expect(trust.getReleaseSurfaceTrust(digest, 'overview')).toEqual({
      digest,
      surfaceId: 'overview',
      mode: 'sandboxed',
      basis: 'package-default',
      policy: 'reviewed_auto',
      revoked: false,
    });
  });

  it('requires an exact verified review attestation for reviewed-auto trust', () => {
    expect(() => trust.setExactDigestTrust({
      digest,
      decision: 'trusted',
      basis: 'review-attestation',
      surfaceIds: ['overview'],
      actorId: 'admin',
    })).toThrow(/verified exact-digest attestation/);
    trust.setExactDigestTrust({
      digest,
      decision: 'trusted',
      basis: 'review-attestation',
      surfaceIds: ['overview'],
      actorId: 'admin',
      verifiedAttestation: { artifactDigest: digest, reviewer: 'review-key' },
    });
    expect(trust.getReleaseSurfaceTrust(digest, 'overview').mode).toBe('trusted');
    expect(trust.getReleaseSurfaceTrust(digest, 'settings').mode).toBe('sandboxed');
  });

  it('applies global policy and quarantine revocation over local trust', () => {
    trust.setExactDigestTrust({
      digest,
      decision: 'trusted',
      basis: 'manual',
      surfaceIds: ['overview'],
      actorId: 'admin',
    });
    trust.setTrustedCodePolicy('sandbox_only');
    expect(trust.getReleaseSurfaceTrust(digest, 'overview').mode).toBe('sandboxed');
    trust.setTrustedCodePolicy('manual_each_release');
    expect(trust.getReleaseSurfaceTrust(digest, 'overview').mode).toBe('trusted');

    database.rawDb.prepare(`
      INSERT INTO marketplace_revocations
        (id, target_type, target_value, module_id, module_slug, module_name,
         version, severity, action, published_at, updated_at, reason, summary,
         first_seen_sequence, last_seen_sequence)
      VALUES
        ('revoke-1', 'artifact', ?, 'dev.robrolabs.app', 'app', 'App', '2.0.0',
         'critical', 'quarantine', 'now', 'now', 'Compromised', 'Do not execute', 1, 1)
    `).run(digest);
    expect(trust.getReleaseSurfaceTrust(digest, 'overview')).toMatchObject({
      mode: 'sandboxed',
      revoked: true,
    });
  });
});
