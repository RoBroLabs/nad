import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { storeVerifiedModuleArtifact } from '@/lib/modules/installed/artifact-store';
import type { VerifiedModulePackage } from '@/lib/modules/installed/package-types';

const directories: string[] = [];

function fixture(directory: string): VerifiedModulePackage {
  process.env.NAD_DATA_DIR = directory;
  return {
    manifest: {
      schemaVersion: 1,
      id: 'dev.robrolabs.artifact-test',
      slug: 'artifact-test',
      name: 'Artifact Test',
      description: 'Artifact store fixture.',
      icon: 'activity',
      category: 'tools',
      version: '1.0.0',
      publisher: 'Robro Labs',
      compatibility: { core: '>=0.2.1 <1.0.0', hostApi: '1.x', uiApi: '1.x' },
      capabilities: [{ name: 'config.get', reason: 'Fixture.' }],
      permissions: [{ action: 'view', label: 'View', description: 'View fixture.', defaultRole: 'member' }],
      configSchema: [],
      entrypoints: {},
    },
    rawManifest: {
      schemaVersion: 1,
      id: 'dev.robrolabs.artifact-test',
      slug: 'artifact-test',
      name: 'Artifact Test',
      description: 'Artifact store fixture.',
      icon: 'activity',
      category: 'tools',
      version: '1.0.0',
      publisher: 'Robro Labs',
      compatibility: { core: '>=0.2.1 <1.0.0', hostApi: '1.x', uiApi: '1.x' },
      capabilities: [{ name: 'config.get', reason: 'Fixture.' }],
      permissions: [{ action: 'view', label: 'View', risk: 'read', description: 'View fixture.' }],
      configSchema: [],
      entrypoints: {},
    },
    pages: { schemaVersion: 1, pages: [] },
    rawPages: {
      schemaVersion: 1,
      pages: [{ path: '/', title: 'Artifact Test', source: { endpoint: 'summary' }, body: [{ type: 'text', value: 'fixture' }] }],
    },
    widgets: { schemaVersion: 1, widgets: [] },
    rawWidgets: {
      schemaVersion: 1,
      widgets: [{ id: 'summary', name: 'Summary', description: 'Fixture', defaultSize: { w: 4, h: 3 }, source: { endpoint: 'summary' }, body: [{ type: 'text', value: 'fixture' }] }],
    },
    checksums: { schemaVersion: 1, algorithm: 'sha256', files: { 'manifest.json': 'unused' } },
    signature: {
      schemaVersion: 1,
      mode: 'unsigned-dev',
      warning: 'development only',
      signedPayload: {
        moduleId: 'dev.robrolabs.artifact-test',
        version: '1.0.0',
        digestAlgorithm: 'sha256',
        files: { 'manifest.json': 'unused' },
      },
    },
    digest: 'a'.repeat(64),
    files: new Map([['manifest.json', Buffer.from('{"fixture":true}')]]),
    signatureStatus: 'development',
  };
}

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nad-artifact-store-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  delete process.env.NAD_DATA_DIR;
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('installed Module artifact store', () => {
  it('refuses to reuse a content-addressed directory whose bytes changed', async () => {
    const directory = makeDirectory();
    const verified = fixture(directory);
    const stored = await storeVerifiedModuleArtifact(verified);
    writeFileSync(join(stored.artifactPath, 'manifest.json'), '{"tampered":true}');

    await expect(storeVerifiedModuleArtifact(verified)).rejects.toThrow('differs from the verified package');
  });

  it('rejects a pre-positioned symlink at the expected digest path', async () => {
    const directory = makeDirectory();
    const verified = fixture(directory);
    const outside = makeDirectory();
    const finalPath = join(directory, 'modules', verified.manifest.id, verified.digest);
    mkdirSync(join(directory, 'modules', verified.manifest.id), { recursive: true });
    symlinkSync(outside, finalPath, 'dir');

    await expect(storeVerifiedModuleArtifact(verified)).rejects.toThrow('not a regular directory');
  });
});
