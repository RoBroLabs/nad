import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadMarketplaceModule,
  fetchMarketplaceCatalog,
  fetchMarketplaceSecuritySnapshot,
  getMarketplaceBaseUrl,
  getMarketplaceMode,
  verifyMarketplaceMetadata,
} from '@/lib/marketplace/client';

const originalEnvironment = { ...process.env };
const metadataKeys = generateKeyPairSync('ed25519');
const metadataPublicKey = metadataKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString();

function signedCatalogResponses(catalog: Record<string, unknown>): [Response, Response] {
  const bytes = Buffer.from(JSON.stringify(catalog));
  const signature = {
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: 'robrolabs-marketplace-metadata-2026-01',
    signedPath: 'api/v1/catalog.json',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signature: sign(null, bytes, metadataKeys.privateKey).toString('base64'),
  };
  return [
    new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify(signature), { status: 200, headers: { 'content-type': 'application/json' } }),
  ];
}

function securitySnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sequence: 4,
    issuedAt: '2026-08-12T12:00:00.000Z',
    expiresAt: '2026-08-13T12:00:00.000Z',
    recommendations: [{
      moduleId: 'dev.robrolabs.system-monitor',
      moduleSlug: 'system-monitor',
      version: '1.0.3',
      artifactSha256: 'a'.repeat(64),
      signerKeyId: 'robrolabs-first-party-2026-08',
    }],
    advisories: [{
      id: 'NAD-2026-SM-001',
      moduleId: 'dev.robrolabs.system-monitor',
      moduleSlug: 'system-monitor',
      moduleName: 'System Monitor',
      severity: 'moderate',
      status: 'resolved',
      publishedAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-12T11:00:00.000Z',
      title: 'Tighter broker scope available',
      summary: 'The earlier release used a broader scope.',
      guidance: 'Install 1.0.3.',
      affectedVersions: ['1.0.0'],
      fixedVersions: ['1.0.1'],
      affected: [{ version: '1.0.0', artifactSha256: 'b'.repeat(64) }],
      references: ['https://nad.robrolabs.com/modules/system-monitor'],
      path: '/api/v1/advisories/NAD-2026-SM-001.json',
      url: 'https://nad.robrolabs.com/api/v1/advisories/NAD-2026-SM-001.json',
    }],
    revocations: [{
      id: 'NAD-REV-2026-001',
      moduleSlug: 'system-monitor',
      moduleName: 'System Monitor',
      version: '1.0.0',
      publishedAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-12T11:00:00.000Z',
      severity: 'critical',
      action: 'quarantine',
      target: { type: 'artifact', sha256: 'b'.repeat(64) },
      moduleId: 'dev.robrolabs.system-monitor',
      reason: 'security',
      summary: 'Do not execute this exact artifact.',
      replacementVersion: '1.0.3',
    }],
    ...overrides,
  };
}

function signedSecurityResponses(snapshot: Record<string, unknown>): [Response, Response] {
  const bytes = Buffer.from(JSON.stringify(snapshot));
  const signature = {
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: 'robrolabs-marketplace-metadata-2026-08',
    signedPath: 'api/v1/security.json',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signature: sign(null, bytes, metadataKeys.privateKey).toString('base64'),
  };
  return [
    new Response(bytes, { status: 200 }),
    new Response(JSON.stringify(signature), { status: 200 }),
  ];
}

function streamingResponse(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { status: 200 });
}

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.unstubAllGlobals();
});

function catalogFor(artifact: Buffer, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    modules: [{
      slug: 'system-monitor',
      name: 'System Monitor',
      summary: 'Read-only host metrics.',
      description: 'Reads configured Node Exporter endpoints through core.',
      category: 'monitoring',
      publisher: 'Robro Labs',
      latestVersion: '1.0.0',
      recommendedVersion: '1.0.0',
      status: 'available',
      recommended: true,
      compatibility: { dashboard: '>=0.2.0 <1.0.0', runtime: 'host API 1.x' },
      permissions: [{ scope: 'view', level: 'read', reason: 'Display metrics.' }],
      capabilities: [
        { name: 'config.get', reason: 'Read configured hosts.' },
        { name: 'http.request', reason: 'Read through the core broker.' },
      ],
      review: { status: 'reviewed', summary: 'First-party read-only release.' },
      artifact: {
        fileName: 'system-monitor-1.0.0.nadmod',
        bytes: artifact.length,
        downloadPath: '/nad/downloads/system-monitor/1.0.0/system-monitor-1.0.0.nadmod',
        sha256: createHash('sha256').update(artifact).digest('hex'),
      },
      ...overrides,
    }],
  };
}

describe('Marketplace client', () => {
  it('accepts both retained and current metadata trust roots but rejects unknown key IDs', () => {
    const bytes = Buffer.from('{"schemaVersion":1}');
    const signatureFor = (keyId: string) => ({
      schemaVersion: 1,
      algorithm: 'Ed25519',
      keyId,
      signedPath: 'api/v1/catalog.json',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      signature: sign(null, bytes, metadataKeys.privateKey).toString('base64'),
    });

    expect(() => verifyMarketplaceMetadata(
      bytes,
      signatureFor('robrolabs-marketplace-metadata-2026-01'),
      'api/v1/catalog.json',
      metadataPublicKey,
    )).not.toThrow();
    expect(() => verifyMarketplaceMetadata(
      bytes,
      signatureFor('robrolabs-marketplace-metadata-2026-08'),
      'api/v1/catalog.json',
      metadataPublicKey,
    )).not.toThrow();
    expect(() => verifyMarketplaceMetadata(
      bytes,
      signatureFor('untrusted-metadata-key'),
      'api/v1/catalog.json',
      metadataPublicKey,
    )).toThrow('unsupported shape');
  });

  it('uses online mode by default and makes manual mode outbound-free', async () => {
    delete process.env.NAD_MARKETPLACE_MODE;
    expect(getMarketplaceMode()).toBe('online');

    process.env.NAD_MARKETPLACE_MODE = 'manual';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchMarketplaceCatalog()).rejects.toThrow('manual-install mode');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a normal HTTPS Marketplace URL in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NAD_MARKETPLACE_URL = 'http://market.example/nad/';
    expect(() => getMarketplaceBaseUrl()).toThrow('HTTPS');

    process.env.NAD_MARKETPLACE_URL = 'https://user:secret@market.example/nad/';
    expect(() => getMarketplaceBaseUrl()).toThrow('without credentials');
  });

  it('downloads only the catalog artifact and verifies its digest and length', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NAD_MARKETPLACE_MODE = 'online';
    process.env.NAD_MARKETPLACE_URL = 'https://market.example/nad/';
    process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY = metadataPublicKey;
    const artifact = Buffer.from('signed-package-bytes');
    const catalog = catalogFor(artifact);
    const [catalogResponse, signatureResponse] = signedCatalogResponses(catalog);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(catalogResponse)
      .mockResolvedValueOnce(signatureResponse)
      .mockResolvedValueOnce(new Response(artifact, {
        status: 200,
        headers: { 'content-length': String(artifact.length) },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadMarketplaceModule('system-monitor')).resolves.toEqual(artifact);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL('https://market.example/nad/api/v1/catalog.json'),
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL('https://market.example/nad/api/v1/catalog.json.sig'),
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL('https://market.example/nad/downloads/system-monitor/1.0.0/system-monitor-1.0.0.nadmod'),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('rejects a downloaded artifact whose catalog digest is wrong', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NAD_MARKETPLACE_MODE = 'online';
    process.env.NAD_MARKETPLACE_URL = 'https://market.example/nad/';
    process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY = metadataPublicKey;
    const artifact = Buffer.from('signed-package-bytes');
    const catalog = catalogFor(artifact);
    const moduleRecord = (catalog.modules as Array<Record<string, unknown>>)[0];
    moduleRecord.artifact = {
      ...(moduleRecord.artifact as Record<string, unknown>),
      sha256: '0'.repeat(64),
    };
    const [catalogResponse, signatureResponse] = signedCatalogResponses(catalog);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(catalogResponse)
      .mockResolvedValueOnce(signatureResponse)
      .mockResolvedValueOnce(new Response(artifact, { status: 200 })));

    await expect(downloadMarketplaceModule('system-monitor')).rejects.toMatchObject({ code: 'BAD_DOWNLOAD' });
  });

  it('rejects catalog bytes not covered by the offline metadata signature', async () => {
    process.env.NAD_MARKETPLACE_MODE = 'online';
    process.env.NAD_MARKETPLACE_URL = 'https://market.example/nad/';
    process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY = metadataPublicKey;
    const artifact = Buffer.from('signed-package-bytes');
    const catalog = catalogFor(artifact);
    const [, signatureResponse] = signedCatalogResponses(catalog);
    const changedCatalog = catalogFor(artifact, { latestVersion: '9.9.9' });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(changedCatalog), { status: 200 }))
      .mockResolvedValueOnce(signatureResponse));

    await expect(fetchMarketplaceCatalog()).rejects.toThrow('digest does not match');
  });

  it('bounds streamed catalog bytes before allocation when Content-Length is absent', async () => {
    process.env.NAD_MARKETPLACE_MODE = 'online';
    process.env.NAD_MARKETPLACE_URL = 'https://market.example/nad/';
    process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY = metadataPublicKey;
    const [, signatureResponse] = signedCatalogResponses(catalogFor(Buffer.from('artifact')));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(streamingResponse([
        new Uint8Array(700_000),
        new Uint8Array(700_000),
      ]))
      .mockResolvedValueOnce(signatureResponse));

    await expect(fetchMarketplaceCatalog()).rejects.toThrow('Marketplace response is too large');
  });

  it('bounds streamed artifact bytes when Content-Length is absent', async () => {
    process.env.NAD_MARKETPLACE_MODE = 'online';
    process.env.NAD_MARKETPLACE_URL = 'https://market.example/nad/';
    process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY = metadataPublicKey;
    const artifact = Buffer.from('signed-package-bytes');
    const [catalogResponse, signatureResponse] = signedCatalogResponses(catalogFor(artifact));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(catalogResponse)
      .mockResolvedValueOnce(signatureResponse)
      .mockResolvedValueOnce(streamingResponse([
        artifact,
        Buffer.from('overflow'),
      ])));

    await expect(downloadMarketplaceModule('system-monitor'))
      .rejects.toThrow('Marketplace response is too large');
  });

  it('verifies and strictly parses the signed security snapshot', async () => {
    process.env.NAD_MARKETPLACE_MODE = 'online';
    process.env.NAD_MARKETPLACE_URL = 'https://market.example/nad/';
    process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY = metadataPublicKey;
    const [snapshotResponse, signatureResponse] = signedSecurityResponses(securitySnapshot());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(snapshotResponse)
      .mockResolvedValueOnce(signatureResponse);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMarketplaceSecuritySnapshot(Date.parse('2026-08-12T12:30:00.000Z')))
      .resolves.toMatchObject({
        snapshot: { sequence: 4, revocations: [{ action: 'quarantine' }] },
        signature: { signedPath: 'api/v1/security.json' },
      });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL('https://market.example/nad/api/v1/security.json'),
      expect.objectContaining({ redirect: 'error', cache: 'no-store' }),
    );
  });

  it('rejects expired, duplicate, and internally inconsistent security metadata', async () => {
    process.env.NAD_MARKETPLACE_MODE = 'online';
    process.env.NAD_MARKETPLACE_URL = 'https://market.example/';
    process.env.NAD_MARKETPLACE_METADATA_PUBLIC_KEY = metadataPublicKey;
    const expired = signedSecurityResponses(securitySnapshot({
      expiresAt: '2026-08-12T12:01:00.000Z',
    }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(expired[0])
      .mockResolvedValueOnce(expired[1]));
    await expect(fetchMarketplaceSecuritySnapshot(Date.parse('2026-08-12T12:30:00.000Z')))
      .rejects.toThrow('expired');

    const inconsistentValue = securitySnapshot();
    const advisory = (inconsistentValue.advisories as Array<Record<string, unknown>>)[0];
    advisory.affectedVersions = ['9.9.9'];
    const inconsistent = signedSecurityResponses(inconsistentValue);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(inconsistent[0])
      .mockResolvedValueOnce(inconsistent[1]));
    await expect(fetchMarketplaceSecuritySnapshot(Date.parse('2026-08-12T12:30:00.000Z')))
      .rejects.toThrow('inconsistent');
  });
});
