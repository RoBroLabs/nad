import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const appPackagePath = process.env.NAD_PHASE6_APP_PACKAGE;
const addonPackagePath = process.env.NAD_PHASE6_ADDON_PACKAGE;
const publicKeyPath = process.env.NAD_PHASE6_PUBLIC_KEY;
const proofEnabled = Boolean(appPackagePath && addonPackagePath && publicKeyPath);
const runtimeEnabled = proofEnabled && Boolean(process.env.NAD_DENO_PATH);
const liveTargetEnabled = runtimeEnabled && Boolean(
  process.env.NAD_PHASE8_PROXMOX_API_URL
  && process.env.NAD_PHASE8_PROXMOX_TOKEN_ID
  && process.env.NAD_PHASE8_PROXMOX_TOKEN_SECRET,
);
const directory = proofEnabled ? mkdtempSync(join(tmpdir(), 'nad-phase6-packages-')) : undefined;

type Db = typeof import('@/lib/db');
type Lifecycle = typeof import('@/lib/modules/installed/lifecycle');
type Verifier = typeof import('@/lib/modules/installed/package-verifier');
type Provider = typeof import('@/lib/modules/installed/provider');
type Connections = typeof import('@/lib/modules/connections');
type Surfaces = typeof import('@/lib/modules/installed/surfaces');
type AppOperations = typeof import('@/lib/modules/installed/app-operations');
type HostApiV2 = typeof import('@/lib/modules/installed/host-api-v2');

let database: Db;
let lifecycle: Lifecycle;
let verifier: Verifier;
let provider: Provider;
let connections: Connections;
let surfaces: Surfaces;
let appOperations: AppOperations;
let hostApiV2: HostApiV2;

beforeAll(async () => {
  if (!directory) return;
  process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
  process.env.NAD_DATA_DIR = directory;
  process.env.APP_SECRET = 'phase6-signed-package-proof-secret-01';
  process.env.NAD_VERSION = '0.3.0';
  delete process.env.NAD_BUILD_EPHEMERAL_DB;
  database = await import('@/lib/db');
  lifecycle = await import('@/lib/modules/installed/lifecycle');
  verifier = await import('@/lib/modules/installed/package-verifier');
  provider = await import('@/lib/modules/installed/provider');
  connections = await import('@/lib/modules/connections');
  surfaces = await import('@/lib/modules/installed/surfaces');
  appOperations = await import('@/lib/modules/installed/app-operations');
  hostApiV2 = await import('@/lib/modules/installed/host-api-v2');
  database.rawDb.prepare(`
    INSERT INTO users
      (id, email, name, password_hash, role, created_at, updated_at)
    VALUES ('admin', 'admin@example.test', 'Admin', 'hash', 'admin', 'now', 'now')
  `).run();
});

afterAll(() => {
  if (!directory) return;
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('signed Phase 6 App and Add-on proof packages', () => {
  it.skipIf(!proofEnabled)('installs a real v2 App and Add-on, retains v1 compatibility, and keeps connection secrets core-owned', async () => {
    const trustedKeys = {
      'phase6-proof-2026-08': readFileSync(publicKeyPath!, 'utf8'),
    };
    const options = { coreVersion: '0.3.0', trustedKeys };
    const appArchive = readFileSync(appPackagePath!);
    const addonArchive = readFileSync(addonPackagePath!);
    const appVerified = await verifier.verifyModulePackage(appArchive, options);
    const addonVerified = await verifier.verifyModulePackage(addonArchive, options);

    expect(appVerified).toMatchObject({
      signatureStatus: 'verified',
      signerKeyId: 'phase6-proof-2026-08',
      manifest: { schemaVersion: 2, kind: 'app', id: 'dev.robrolabs.proxmox' },
    });
    expect(addonVerified).toMatchObject({
      signatureStatus: 'verified',
      signerKeyId: 'phase6-proof-2026-08',
      manifest: { schemaVersion: 2, kind: 'addon', id: 'dev.robrolabs.proxmox-guest-controls' },
    });

    await lifecycle.installModulePackage(appArchive, 'admin', { expectedDigest: appVerified.digest }, options);
    await lifecycle.setInstalledModuleEnabled('proxmox', true, 'admin');
    const app = provider.getInstalledModule('proxmox');
    expect(app).toMatchObject({ packageSchemaVersion: 2, packageKind: 'app', manifest: { version: '2.0.0' } });

    const first = connections.createConnectionProfile(app!.moduleId, {
      name: 'Lab',
      values: {
        api_url: { value: 'https://pve-lab.example.test' },
        token_id: { value: 'nad@pve!dashboard' },
        token_secret: { value: 'lab-super-secret-token' },
        verify_ssl: { value: 'true' },
      },
    }, 'admin');
    const second = connections.createConnectionProfile(app!.moduleId, {
      name: 'Remote',
      values: {
        api_url: { value: 'https://pve-remote.example.test' },
        token_id: { value: 'nad@pve!remote' },
        token_secret: { value: 'remote-super-secret-token' },
        verify_ssl: { value: 'true' },
      },
    }, 'admin');
    expect(first.id).not.toBe(second.id);
    const displayed = connections.listConnectionProfilesForAdmin(app!.moduleId);
    expect(displayed).toHaveLength(3); // Includes the migrated/default compatibility profile.
    expect(JSON.stringify(displayed)).not.toContain('lab-super-secret-token');
    expect(JSON.stringify(displayed)).not.toContain('remote-super-secret-token');
    expect(displayed.find(({ id }) => id === first.id)?.fields.token_secret).toEqual({ present: true, isSecret: true });

    await lifecycle.installModulePackage(addonArchive, 'admin', { expectedDigest: addonVerified.digest }, options);
    await lifecycle.setInstalledModuleEnabled('proxmox-guest-controls', true, 'admin');
    const addon = provider.getInstalledModule('proxmox-guest-controls');
    expect(addon).toMatchObject({
      packageSchemaVersion: 2,
      packageKind: 'addon',
      dependencies: [expect.objectContaining({ appId: 'dev.robrolabs.proxmox' })],
    });
    await expect(surfaces.readVerifiedSurfaceEntryHtml('proxmox', 'overview'))
      .resolves.toMatchObject({ digest: appVerified.digest });
    await expect(surfaces.readVerifiedSurfaceEntryHtml('proxmox-guest-controls', 'guest-controls'))
      .resolves.toMatchObject({ digest: addonVerified.digest });

    const storedSecrets = database.rawDb.prepare(`
      SELECT encrypted_values_json FROM app_connection_generations
      WHERE connection_profile_id IN (?, ?)
    `).all(first.id, second.id) as Array<{ encrypted_values_json: string }>;
    expect(JSON.stringify(storedSecrets)).not.toContain('super-secret-token');
  }, 30_000);

  it.skipIf(!runtimeEnabled)('executes the real signed App self binding and Add-on-to-App binding in isolated Deno', async () => {
    const app = provider.getInstalledModule('proxmox');
    if (!app) throw new Error('The signed App proof must install first.');
    const profile = connections.listConnectionProfilesForAdmin(app.moduleId).find(({ name }) => name === 'Lab');
    if (!profile) throw new Error('The signed App proof must create the Lab profile first.');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const data = url.pathname.endsWith('/nodes')
        ? [{ node: 'pve-lab', status: 'online', cpu: 0.1, mem: 1024, maxmem: 4096 }]
        : [{ type: 'qemu', vmid: 100, name: 'Home Assistant', node: 'pve-lab', status: 'running' }];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const pinnedProfile = await connections.readConnectionProfileForInvocation(
        profile.id,
        app.moduleId,
        'admin',
        'view',
      );
      const host = hostApiV2.createInstalledHostApiV2(app, {
        config: { ...pinnedProfile.values },
        moduleSlug: app.manifest.slug,
        path: ['operations', 'overview'],
        userId: 'admin',
        connectionProfileId: pinnedProfile.id,
        connectionProfileName: pinnedProfile.name,
        connectionGenerationId: pinnedProfile.generationId,
        caller: { kind: 'surface', packageId: app.moduleId, surfaceId: 'overview' },
        notify: vi.fn(),
      }, 'query');
      await expect(host({ method: 'connections.current', params: {} }))
        .resolves.toEqual({ id: profile.id, name: 'Lab' });
      await expect(host({ method: 'connections.get', params: { name: 'token_secret' } }))
        .resolves.toMatchObject({ present: true, secretRef: expect.any(String) });
      await expect(host({ method: 'http.request', params: { scope: 'nodes', method: 'GET' } }))
        .resolves.toMatchObject({ status: 200, body: { data: [expect.objectContaining({ node: 'pve-lab' })] } });

      await expect(appOperations.invokeSurfaceBinding({
        moduleSlug: 'proxmox', surfaceId: 'overview', bindingId: 'overview',
        connectionBindings: { primary: profile.id }, userId: 'admin', input: {},
      })).resolves.toMatchObject({
        data: { profile: 'Lab', nodeCount: 1, onlineNodes: 1, guestCount: 1, runningGuests: 1 },
      });
      await expect(appOperations.invokeSurfaceBinding({
        moduleSlug: 'proxmox-guest-controls', surfaceId: 'guest-controls', bindingId: 'guests',
        connectionBindings: { primary: profile.id }, userId: 'admin', input: {},
      })).resolves.toMatchObject({
        data: { profile: 'Lab', guests: [expect.objectContaining({ vmid: 100, name: 'Home Assistant' })] },
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);

  it.skipIf(!liveTargetEnabled)('executes read-only v2 App and Add-on bindings against an approved Proxmox target', async () => {
    const app = provider.getInstalledModule('proxmox');
    if (!app) throw new Error('The signed App proof must install first.');
    const profile = connections.createConnectionProfile(app.moduleId, {
      name: 'Phase 8 live target',
      values: {
        api_url: { value: process.env.NAD_PHASE8_PROXMOX_API_URL! },
        token_id: { value: process.env.NAD_PHASE8_PROXMOX_TOKEN_ID! },
        token_secret: { value: process.env.NAD_PHASE8_PROXMOX_TOKEN_SECRET! },
        verify_ssl: { value: process.env.NAD_PHASE8_PROXMOX_VERIFY_SSL ?? 'true' },
      },
    }, 'admin');

    const overview = await appOperations.invokeSurfaceBinding({
      moduleSlug: 'proxmox', surfaceId: 'overview', bindingId: 'overview',
      connectionBindings: { primary: profile.id }, userId: 'admin', input: {},
    });
    expect(overview).toMatchObject({
      data: {
        profile: 'Phase 8 live target',
        nodeCount: expect.any(Number),
        onlineNodes: expect.any(Number),
        guestCount: expect.any(Number),
      },
    });
    expect((overview.data as { nodeCount: number }).nodeCount).toBeGreaterThan(0);
    expect((overview.data as { onlineNodes: number }).onlineNodes).toBeGreaterThan(0);

    const guests = await appOperations.invokeSurfaceBinding({
      moduleSlug: 'proxmox-guest-controls', surfaceId: 'guest-controls', bindingId: 'guests',
      connectionBindings: { primary: profile.id }, userId: 'admin', input: {},
    });
    expect(guests).toMatchObject({
      data: {
        profile: 'Phase 8 live target',
        guests: expect.any(Array),
      },
    });
    expect((guests.data as { guests: unknown[] }).guests.length).toBeGreaterThan(0);

    const stored = database.rawDb.prepare(`
      SELECT encrypted_values_json FROM app_connection_generations
      WHERE connection_profile_id = ?
    `).get(profile.id) as { encrypted_values_json: string };
    expect(stored.encrypted_values_json).not.toContain(process.env.NAD_PHASE8_PROXMOX_TOKEN_SECRET!);
  }, 45_000);
});
