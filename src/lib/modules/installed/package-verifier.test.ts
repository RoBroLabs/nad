import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { PassThrough } from 'node:stream';
import yazl from 'yazl';
import { describe, expect, it } from 'vitest';
import { contractSchemas } from '@/lib/modules/contracts/v1/schemas.generated';
import { createSignatureEnvelope, verifyModulePackage, satisfiesCoreRange } from '@/lib/modules/installed/package-verifier';

const manifest = {
  schemaVersion: 1,
  id: 'dev.robrolabs.status-demo',
  slug: 'status-demo',
  name: 'Status Demo',
  description: 'A small contract fixture.',
  icon: 'activity',
  category: 'monitoring',
  version: '1.0.0',
  publisher: 'Robro Labs',
  compatibility: { core: '>=0.2.0 <1.0.0', hostApi: '1.x', uiApi: '1.x' },
  capabilities: [{ name: 'config.get', reason: 'Read declared configuration.' }],
  permissions: [{ action: 'view', label: 'View', risk: 'read', description: 'View status.' }],
  configSchema: [],
  entrypoints: {
    summary: {
      method: 'GET',
      kind: 'query',
      permission: 'view',
      handler: 'summary',
      requestSchema: 'schemas/endpoints/summary-input.json',
      responseSchema: 'schemas/endpoints/summary-output.json',
      timeoutClass: 'short',
      maxRequestBytes: 1024,
      maxResponseBytes: 65536,
    },
  },
};

const pages = {
  schemaVersion: 1,
  pages: [{
    path: '/',
    title: 'Status',
    source: { endpoint: 'summary', refreshIntervalMs: 15_000 },
    body: [{ type: 'metric', label: 'Online', valuePath: 'online' }],
  }],
};

const widgets = {
  schemaVersion: 1,
  widgets: [{
    id: 'summary',
    name: 'Summary',
    description: 'Current status.',
    defaultSize: { w: 4, h: 3 },
    source: { endpoint: 'summary', refreshIntervalMs: 15_000 },
    body: [{ type: 'status', label: 'State', valuePath: 'status' }],
  }],
};

interface ZipEntryFixture {
  path: string;
  contents: Buffer;
  mode?: number;
}

async function zipEntries(entries: ZipEntryFixture[]): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const { path, contents, mode = 0o100644 } of entries) {
    archive.addBuffer(contents, path, { mtime: new Date('1980-01-01T00:00:00.000Z'), mode });
  }
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
  });
  archive.outputStream.pipe(output);
  archive.end();
  return complete;
}

async function zip(files: Record<string, Buffer>): Promise<Buffer> {
  return zipEntries(Object.entries(files).map(([path, contents]) => ({ path, contents })));
}

function replaceArchivePath(archive: Buffer, from: string, to: string): Buffer {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) throw new Error('Fixture paths must have equal byte length.');
  const result = Buffer.from(archive);
  const source = Buffer.from(from);
  const target = Buffer.from(to);
  let offset = 0;
  let replacements = 0;
  while ((offset = result.indexOf(source, offset)) !== -1) {
    target.copy(result, offset);
    offset += target.length;
    replacements += 1;
  }
  if (replacements < 2) throw new Error('Expected to replace local and central ZIP paths.');
  return result;
}

async function moduleArchive(overrides: Record<string, Buffer> = {}): Promise<Buffer> {
  const payload: Record<string, Buffer> = {
    'manifest.json': Buffer.from(JSON.stringify(manifest)),
    'server/main.js': Buffer.from('globalThis.__nadModule = true;'),
    'ui/pages.json': Buffer.from(JSON.stringify(pages)),
    'ui/widgets.json': Buffer.from(JSON.stringify(widgets)),
    'schemas/config.json': Buffer.from('{"type":"object"}'),
    'schemas/endpoints/summary-input.json': Buffer.from('{"type":"object","additionalProperties":false}'),
    'schemas/endpoints/summary-output.json': Buffer.from('{"type":"object"}'),
    'README.md': Buffer.from('# Status Demo\n'),
    'LICENSE': Buffer.from('AGPL-3.0-only\n'),
    'assets/icon.png': Buffer.from('fixture-icon'),
    ...overrides,
  };
  const checksums = Object.fromEntries(Object.entries(payload).map(([path, contents]) => [
    path,
    createHash('sha256').update(contents).digest('hex'),
  ]));
  return zip({
    ...payload,
    'checksums.json': Buffer.from(JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files: checksums })),
    'signature.json': Buffer.from(JSON.stringify({
      schemaVersion: 1,
      mode: 'unsigned-dev',
      warning: 'development only',
      signedPayload: {
        moduleId: manifest.id,
        version: manifest.version,
        digestAlgorithm: 'sha256',
        files: checksums,
      },
    })),
  });
}

async function v2Archive(
  kind: 'app' | 'addon',
  options: {
    extraFiles?: Record<string, Buffer>;
    surfaceHtml?: string;
    manifestTransform?: (value: Record<string, unknown>) => Record<string, unknown>;
    surfacesTransform?: (value: Record<string, unknown>) => Record<string, unknown>;
  } = {},
): Promise<Buffer> {
  const app = kind === 'app';
  const operation = {
    version: '1.0.0', kind: 'query', consumers: ['self', 'addon'], connection: 'required',
    permission: 'view', handler: 'summary', requestSchema: 'schemas/operations/input.json',
    responseSchema: 'schemas/operations/output.json', timeoutClass: 'short',
    maxRequestBytes: 1024, maxResponseBytes: 4096,
  };
  const baseManifest: Record<string, unknown> = app ? {
    schemaVersion: 2, kind, id: 'dev.robrolabs.fixture-app', slug: 'fixture-app', name: 'Fixture App',
    description: 'Schema v2 verifier fixture.', icon: 'server', category: 'servers', version: '2.0.0',
    publisher: 'Robro Labs', compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
    capabilities: [
      { name: 'connections.current', reason: 'Identify the selected connection.' },
      { name: 'http.request', reason: 'Call the exact approved endpoint.' },
    ],
    permissions: [{ action: 'view', label: 'View', risk: 'read' }],
    connections: { schema: 'schemas/connections.json', multiple: true },
    httpAccess: [{
      id: 'summary', scheme: 'https', hostField: 'api_url', path: '/api/summary', methods: ['GET'], effect: 'read',
      credential: { field: 'api_key', location: 'header', name: 'Authorization', prefix: 'Bearer ' },
      tlsVerifyField: 'verify_ssl',
    }],
    operations: { summary: operation },
    surfaces: 'ui/surfaces.json',
  } : {
    schemaVersion: 2, kind, id: 'dev.robrolabs.fixture-addon', slug: 'fixture-addon', name: 'Fixture Add-on',
    description: 'Schema v2 UI-only Add-on verifier fixture.', icon: 'layout', category: 'servers', version: '1.0.0',
    publisher: 'Robro Labs', compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
    capabilities: [{ name: 'apps.invoke', reason: 'Call only declared App operations.' }],
    permissions: [{ action: 'view', label: 'View', risk: 'read' }],
    dependencies: [{
      alias: 'app', appId: 'dev.robrolabs.fixture-app', packageVersion: '>=2.0.0 <3.0.0',
      operations: { summary: '^1.0.0' },
    }],
    surfaces: 'ui/surfaces.json',
  };
  const baseSurfaces: Record<string, unknown> = {
    schemaVersion: 2,
    surfaces: [{
      id: 'summary', kind: 'widget', name: 'Summary', description: 'Fixture summary.',
      entry: 'ui/surfaces/summary.html', bridge: '2.x', permissions: ['view'],
      connectionSlots: [{ slot: 'primary', target: app ? 'self' : 'app', required: true }],
      bindings: { summary: { target: app ? 'self' : 'app', operation: 'summary', connectionSlot: 'primary' } },
      widget: { defaultSize: { w: 4, h: 3 }, chrome: 'standard' },
      execution: { requestedMode: 'sandbox', privileges: ['theme', 'resize', 'connection-selection'] },
    }],
  };
  const v2Manifest = options.manifestTransform?.(baseManifest) ?? baseManifest;
  const v2Surfaces = options.surfacesTransform?.(baseSurfaces) ?? baseSurfaces;
  const payload: Record<string, Buffer> = {
    'manifest.json': Buffer.from(JSON.stringify(v2Manifest)),
    'ui/surfaces.json': Buffer.from(JSON.stringify(v2Surfaces)),
    'ui/surfaces/summary.html': Buffer.from(options.surfaceHtml ?? '<main><script>globalThis.fixture=true</script></main>'),
    'README.md': Buffer.from('# Fixture\n'),
    'LICENSE': Buffer.from('AGPL-3.0-only\n'),
    'assets/icon.png': Buffer.from('fixture-icon'),
    ...(app ? {
      'schemas/connections.json': Buffer.from(JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
        required: ['api_url', 'api_key', 'verify_ssl'],
        properties: {
          api_url: { type: 'string', title: 'API URL', 'x-nad': { control: 'url' } },
          api_key: { type: 'string', title: 'API key', 'x-nad': { control: 'secret' } },
          verify_ssl: { type: 'boolean', title: 'Verify TLS', default: true, 'x-nad': { control: 'boolean' } },
        },
      })),
      'schemas/operations/input.json': Buffer.from('{"type":"object","additionalProperties":false}'),
      'schemas/operations/output.json': Buffer.from('{"type":"object"}'),
      'server/main.js': Buffer.from('export async function summary() { return {}; }'),
    } : {}),
    ...(options.extraFiles ?? {}),
  };
  const checksums = Object.fromEntries(Object.entries(payload).map(([path, contents]) => [
    path, createHash('sha256').update(contents).digest('hex'),
  ]));
  const identity = v2Manifest as { id: string; version: string };
  return zip({
    ...payload,
    'checksums.json': Buffer.from(JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files: checksums })),
    'signature.json': Buffer.from(JSON.stringify({
      schemaVersion: 1, mode: 'unsigned-dev', warning: 'development only',
      signedPayload: { moduleId: identity.id, version: identity.version, digestAlgorithm: 'sha256', files: checksums },
    })),
  });
}

async function signedModuleArchive(envelope: 'canonical' | 'legacy-v1' = 'canonical'): Promise<{ archive: Buffer; publicKey: string }> {
  const payload: Record<string, Buffer> = {
    'manifest.json': Buffer.from(JSON.stringify(manifest)),
    'server/main.js': Buffer.from('export async function summary() { return {}; }'),
    'ui/pages.json': Buffer.from(JSON.stringify(pages)),
    'ui/widgets.json': Buffer.from(JSON.stringify(widgets)),
    'schemas/config.json': Buffer.from('{"type":"object"}'),
    'schemas/endpoints/summary-input.json': Buffer.from('{"type":"object","additionalProperties":false}'),
    'schemas/endpoints/summary-output.json': Buffer.from('{"type":"object"}'),
    'README.md': Buffer.from('# Status Demo\n'),
    'LICENSE': Buffer.from('AGPL-3.0-only\n'),
    'assets/icon.png': Buffer.from('fixture-icon'),
  };
  const checksums = { schemaVersion: 1 as const, algorithm: 'sha256' as const, files: Object.fromEntries(Object.entries(payload).map(([path, contents]) => [
    path,
    createHash('sha256').update(contents).digest('hex'),
  ])) };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const orderedFiles = Object.fromEntries(Object.entries(checksums.files).sort(([left], [right]) => left.localeCompare(right)));
  const signaturePayload = envelope === 'canonical'
    ? createSignatureEnvelope(manifest.id, manifest.version, checksums)
    : Buffer.from(JSON.stringify({ id: manifest.id, version: manifest.version, files: orderedFiles }), 'utf8');
  const signature = sign(null, signaturePayload, privateKey).toString('base64');
  return {
    archive: await zip({
      ...payload,
      'checksums.json': Buffer.from(JSON.stringify(checksums)),
      'signature.json': Buffer.from(JSON.stringify({
        schemaVersion: 1,
        mode: 'signed',
        algorithm: 'Ed25519',
        keyId: 'test-key',
        signature,
        signedPayload: {
          moduleId: manifest.id,
          version: manifest.version,
          digestAlgorithm: 'sha256',
          files: checksums.files,
        },
      })),
    }),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('verifyModulePackage', () => {
  it('uses the canonical SDK-compatible signature envelope', () => {
    const canonicalExample = contractSchemas['signature-envelope.schema.json'].examples[0];
    const checksums = {
      schemaVersion: 1 as const,
      algorithm: 'sha256' as const,
      files: {
        'z.txt': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'a.txt': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    };

    expect(createSignatureEnvelope('dev.robrolabs.fixture', '1.2.3', checksums).toString('utf8'))
      .toBe(JSON.stringify(canonicalExample));
  });

  it('retains verification compatibility with schema-v1 packages signed using the legacy envelope', async () => {
    const signed = await signedModuleArchive('legacy-v1');

    await expect(verifyModulePackage(signed.archive, {
      coreVersion: '0.2.0',
      trustedKeys: { 'test-key': signed.publicKey },
    })).resolves.toMatchObject({
      manifest: { schemaVersion: 1, id: manifest.id },
      signatureStatus: 'verified',
      signerKeyId: 'test-key',
    });
  });

  it('accepts a bounded development package only when explicitly enabled', async () => {
    const archive = await moduleArchive();
    const verified = await verifyModulePackage(archive, { allowUnsigned: true, coreVersion: '0.2.0' });
    expect(verified.manifest.id).toBe('dev.robrolabs.status-demo');
    expect(verified.signatureStatus).toBe('development');
    await expect(verifyModulePackage(archive, { allowUnsigned: false, coreVersion: '0.2.0' }))
      .rejects.toMatchObject({ code: 'UNTRUSTED_MODULE' });
  });

  it('accepts stable permission actions containing SDK-supported separators', async () => {
    const archive = await moduleArchive({
      'manifest.json': Buffer.from(JSON.stringify({
        ...manifest,
        permissions: [
          manifest.permissions[0],
          { action: 'manage_dns', label: 'Manage DNS', risk: 'write', description: 'Change DNS blocking.' },
        ],
      })),
    });

    await expect(verifyModulePackage(archive, { allowUnsigned: true, coreVersion: '0.2.0' }))
      .resolves.toMatchObject({
        manifest: { permissions: expect.arrayContaining([expect.objectContaining({ action: 'manage_dns' })]) },
      });
  });

  it('rejects a payload that no longer matches its checksum', async () => {
    const archive = await moduleArchive();
    const verified = await verifyModulePackage(archive, { allowUnsigned: true, coreVersion: '0.2.0' });
    const badFiles = Object.fromEntries(verified.files);
    badFiles['server/main.js'] = Buffer.from('tampered');
    await expect(zip(badFiles)).resolves.toBeInstanceOf(Buffer);
    await expect(verifyModulePackage(await zip(badFiles), { allowUnsigned: true, coreVersion: '0.2.0' }))
      .rejects.toMatchObject({ code: 'BAD_CHECKSUM' });
  });

  it('rejects traversal, duplicate, and case-colliding archive paths', async () => {
    const valid = await moduleArchive({ 'aa/payload.txt': Buffer.from('unsafe path fixture') });
    await expect(verifyModulePackage(
      replaceArchivePath(valid, 'aa/payload.txt', '../payload.txt'),
      { allowUnsigned: true, coreVersion: '0.2.0' },
    )).rejects.toThrow(/invalid relative path|Unsafe archive path/);

    const verified = await verifyModulePackage(await moduleArchive(), { allowUnsigned: true, coreVersion: '0.2.0' });
    const entries = [...verified.files].map(([path, contents]) => ({ path, contents }));
    await expect(verifyModulePackage(await zipEntries([
      ...entries,
      { path: 'README.md', contents: Buffer.from('duplicate') },
    ]), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toThrow('Duplicate archive path');
    await expect(verifyModulePackage(await zipEntries([
      ...entries,
      { path: 'readme.md', contents: Buffer.from('case collision') },
    ]), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toThrow('differ only by case');
  });

  it('rejects links, archive bombs, and undeclared executable content', async () => {
    const verified = await verifyModulePackage(await moduleArchive(), { allowUnsigned: true, coreVersion: '0.2.0' });
    const linkedEntries = [...verified.files].map(([path, contents]) => ({
      path,
      contents,
      mode: path === 'README.md' ? 0o120777 : 0o100644,
    }));
    await expect(verifyModulePackage(await zipEntries(linkedEntries), {
      allowUnsigned: true,
      coreVersion: '0.2.0',
    })).rejects.toThrow('Links and special files are forbidden');

    await expect(verifyModulePackage(await moduleArchive({
      'README.md': Buffer.alloc(1024 * 1024),
    }), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toMatchObject({ code: 'PACKAGE_TOO_LARGE' });

    await expect(verifyModulePackage(await moduleArchive({
      'ui/injected.js': Buffer.from('globalThis.compromised = true;'),
    }), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toThrow('Executable content is not allowed');
  });

  it('rejects unlisted payloads and a tampered signature', async () => {
    const verified = await verifyModulePackage(await moduleArchive(), { allowUnsigned: true, coreVersion: '0.2.0' });
    await expect(verifyModulePackage(await zip({
      ...Object.fromEntries(verified.files),
      'notes.txt': Buffer.from('not listed in checksums'),
    }), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toThrow('must list every payload file');

    const signed = await signedModuleArchive();
    const signedVerified = await verifyModulePackage(signed.archive, {
      coreVersion: '0.2.0',
      trustedKeys: { 'test-key': signed.publicKey },
    });
    const tamperedSignature = JSON.parse(signedVerified.files.get('signature.json')!.toString('utf8')) as Record<string, unknown>;
    tamperedSignature.signature = Buffer.alloc(64, 7).toString('base64');
    await expect(verifyModulePackage(await zip({
      ...Object.fromEntries(signedVerified.files),
      'signature.json': Buffer.from(JSON.stringify(tamperedSignature)),
    }), {
      coreVersion: '0.2.0',
      trustedKeys: { 'test-key': signed.publicKey },
    })).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
  });

  it('checks the supported core compatibility range', () => {
    expect(satisfiesCoreRange('0.2.0', '>=0.2.0 <1.0.0')).toBe(true);
    expect(satisfiesCoreRange('1.0.0', '>=0.2.0 <1.0.0')).toBe(false);
    expect(satisfiesCoreRange('1.4.2', '1.x')).toBe(true);
  });

  it('rejects capabilities outside the host API contract', async () => {
    const unsafeManifest = {
      ...manifest,
      capabilities: [{ name: 'shell.execute', reason: 'Run arbitrary commands.' }],
    };
    await expect(verifyModulePackage(await moduleArchive({
      'manifest.json': Buffer.from(JSON.stringify(unsafeManifest)),
    }), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toThrow('canonical contract');
  });

  it('requires endpoint schemas to exist in the verified package', async () => {
    const missingSchemaManifest = {
      ...manifest,
      entrypoints: {
        summary: {
          ...manifest.entrypoints.summary,
          responseSchema: 'schemas/endpoints/missing.json',
        },
      },
    };
    await expect(verifyModulePackage(await moduleArchive({
      'manifest.json': Buffer.from(JSON.stringify(missingSchemaManifest)),
    }), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toThrow('references missing schema');
  });

  it.each(['README.md', 'LICENSE', 'assets/icon.png'])('requires the public package contract file %s', async (path) => {
    const archive = await moduleArchive();
    const verified = await verifyModulePackage(archive, { allowUnsigned: true, coreVersion: '0.2.0' });
    const files = Object.fromEntries(verified.files);
    delete files[path];
    await expect(verifyModulePackage(await zip(files), { allowUnsigned: true, coreVersion: '0.2.0' }))
      .rejects.toThrow(`missing ${path}`);
  });

  it('requires endpoint-scoped approval for brokered HTTP', async () => {
    const unscopedManifest = {
      ...manifest,
      capabilities: [{ name: 'http.request', reason: 'Read an upstream service.' }],
      configSchema: [{ key: 'hosts', label: 'Hosts', type: 'text', required: true }],
    };
    await expect(verifyModulePackage(await moduleArchive({
      'manifest.json': Buffer.from(JSON.stringify(unscopedManifest)),
    }), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toThrow('canonical contract');
  });

  it('rejects mutation entrypoints that use an idempotent GET route', async () => {
    const unsafeManifest = {
      ...manifest,
      entrypoints: {
        summary: {
          ...manifest.entrypoints.summary,
          kind: 'mutation',
          auditAction: 'change_status',
        },
      },
    };
    await expect(verifyModulePackage(await moduleArchive({
      'manifest.json': Buffer.from(JSON.stringify(unsafeManifest)),
    }), { allowUnsigned: true, coreVersion: '0.2.0' })).rejects.toThrow('canonical contract');
  });

  it('verifies an Ed25519 release signature against an explicit trust root', async () => {
    const { archive, publicKey } = await signedModuleArchive();
    const verified = await verifyModulePackage(archive, {
      coreVersion: '0.2.0',
      trustedKeys: { 'test-key': publicKey },
    });
    expect(verified.signatureStatus).toBe('verified');
    expect(verified.signerKeyId).toBe('test-key');
  });

  it('accepts a schema-v2 App and a UI-only Add-on with no server bundle', async () => {
    const verifiedApp = await verifyModulePackage(
      await v2Archive('app'),
      { allowUnsigned: true, coreVersion: '0.3.0' },
    );
    expect(verifiedApp).toMatchObject({ manifest: { schemaVersion: 2, kind: 'app' }, surfaces: { schemaVersion: 2 } });
    expect(verifiedApp.manifest.configSchema.map(({ key }) => key)).toEqual(['api_url', 'api_key', 'verify_ssl']);
    expect(verifiedApp.rawManifest).not.toHaveProperty('configSchema');
    expect(verifiedApp.rawManifest).not.toHaveProperty('entrypoints');
    await expect(verifyModulePackage(await v2Archive('addon'), { allowUnsigned: true, coreVersion: '0.3.0' }))
      .resolves.toMatchObject({ manifest: { schemaVersion: 2, kind: 'addon' }, surfaces: { schemaVersion: 2 } });
  });

  it('enforces the exact v2 payload inventory and self-contained surface HTML', async () => {
    await expect(verifyModulePackage(await v2Archive('app', {
      extraFiles: { 'ui/surfaces/injected.js': Buffer.from('globalThis.compromised=true') },
    }), { allowUnsigned: true, coreVersion: '0.3.0' })).rejects.toThrow('not declared by the v2 package contract');
    for (const html of [
      '<iframe srcdoc="nested"></iframe>',
      '<base href="/unexpected/">',
      '<script src="https://example.test/remote.js"></script>',
      '<a href="//example.test/out">external</a>',
      '<meta http-equiv="refresh" content="0;url=/unexpected">',
    ]) {
      await expect(verifyModulePackage(await v2Archive('app', { surfaceHtml: html }), {
        allowUnsigned: true,
        coreVersion: '0.3.0',
      })).rejects.toThrow(/forbidden|self-contained|cannot navigate/);
    }
  });

  it('rejects v2 connection, permission, dependency, operation, and slot cross-reference violations', async () => {
    await expect(verifyModulePackage(await v2Archive('app', {
      manifestTransform: (value) => ({
        ...value,
        httpAccess: [{
          id: 'bad', scheme: 'https', hostField: 'api_key', path: '/', methods: ['GET'], effect: 'read',
          credential: { field: 'api_url', location: 'header', name: 'Authorization' },
        }],
      }),
    }), { allowUnsigned: true, coreVersion: '0.3.0' })).rejects.toThrow(/hostField|credential/);

    await expect(verifyModulePackage(await v2Archive('addon', {
      surfacesTransform: (value) => {
        const copy = structuredClone(value) as { surfaces: Array<Record<string, unknown>> };
        copy.surfaces[0].permissions = ['undeclared'];
        return copy as Record<string, unknown>;
      },
    }), { allowUnsigned: true, coreVersion: '0.3.0' })).rejects.toThrow('undeclared permission');

    await expect(verifyModulePackage(await v2Archive('addon', {
      surfacesTransform: (value) => {
        const copy = structuredClone(value) as { surfaces: Array<Record<string, unknown>> };
        copy.surfaces[0].bindings = { summary: { target: 'app', operation: 'not-allowed', connectionSlot: 'primary' } };
        return copy as Record<string, unknown>;
      },
    }), { allowUnsigned: true, coreVersion: '0.3.0' })).rejects.toThrow(/unapproved dependency operation/);

    await expect(verifyModulePackage(await v2Archive('app', {
      surfacesTransform: (value) => {
        const copy = structuredClone(value) as { surfaces: Array<Record<string, unknown>> };
        copy.surfaces[0].bindings = { summary: { target: 'self', operation: 'summary' } };
        return copy as Record<string, unknown>;
      },
    }), { allowUnsigned: true, coreVersion: '0.3.0' })).rejects.toThrow(/requires a connection slot/);
  });
});
