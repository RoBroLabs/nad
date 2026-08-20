import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const revision = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;

function directory() {
  const value = mkdtempSync(join(tmpdir(), 'nad-install-bundle-test-'));
  directories.push(value);
  return value;
}

function generate(outputDirectory: string, extraArguments: string[] = []) {
  return execFileSync('node', [
    'scripts/generate-install-bundle.mjs',
    '--version', '1.2.3',
    '--revision', revision,
    '--image-repository', 'ghcr.io/robrolabs/nad',
    '--image-digest', digest,
    '--out', outputDirectory,
    ...extraArguments,
  ], { encoding: 'utf8' });
}

afterEach(() => {
  directories.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true }));
});

describe('installation bundle generator', () => {
  it('creates deterministic, pull-only files and validates extracted Compose without the source tree', () => {
    const first = directory();
    const second = directory();
    const firstResult = JSON.parse(generate(first, ['--validate-compose']));
    const secondResult = JSON.parse(generate(second));
    const fileName = 'NAD-1.2.3-installation-bundle.zip';

    expect(readFileSync(join(first, fileName))).toEqual(readFileSync(join(second, fileName)));
    expect(firstResult.archiveSha256).toBe(secondResult.archiveSha256);
    expect(readFileSync(join(first, `${fileName}.sha256`), 'utf8')).toBe(`${firstResult.archiveSha256}  ${fileName}\n`);

    const extracted = directory();
    execFileSync('unzip', ['-q', join(first, fileName), '-d', extracted]);
    const bundleDirectory = join(extracted, 'NAD-1.2.3');
    execFileSync('cp', [join(bundleDirectory, '.env.example'), join(bundleDirectory, '.env')]);
    const compose = execFileSync('docker', ['compose', '-f', 'compose.yaml', 'config'], {
      cwd: bundleDirectory,
      encoding: 'utf8',
    });
    expect(compose).toContain(`ghcr.io/robrolabs/nad@${digest}`);
    expect(compose).not.toMatch(/(^|\n)\s*build\s*:/);
    expect(compose).not.toContain('context:');
    expect(compose).not.toContain('docker-compose.build.yml');
    expect(readFileSync(join(bundleDirectory, '.env.example'), 'utf8')).not.toMatch(/APP_SECRET=.+|AUTH_SECRET=.+/);
  });

  it('rejects mutable or incomplete release identities before writing an archive', () => {
    const output = directory();
    const missingDigest = spawnSync('node', [
      'scripts/generate-install-bundle.mjs', '--version', '1.2.3', '--revision', revision,
      '--image-repository', 'ghcr.io/robrolabs/nad', '--out', output,
    ], { encoding: 'utf8' });
    const mutableRepository = spawnSync('node', [
      'scripts/generate-install-bundle.mjs', '--version', '1.2.3', '--revision', revision,
      '--image-repository', 'ghcr.io/robrolabs/nad:latest', '--image-digest', digest, '--out', output,
    ], { encoding: 'utf8' });
    expect(missingDigest.status).not.toBe(0);
    expect(missingDigest.stderr).toContain('Image digest');
    expect(mutableRepository.status).not.toBe(0);
    expect(mutableRepository.stderr).toContain('Image repository');
  });
});
