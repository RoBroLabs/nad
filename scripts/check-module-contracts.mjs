#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contractRoot = join(root, 'src', 'lib', 'modules', 'contracts', 'v1');
const lockPath = join(contractRoot, 'generated-lock.generated.json');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (lock.schemaVersion !== 1 || typeof lock.contractSha256 !== 'string' || !lock.files) {
    throw new Error(`${lockPath} is not a supported generated contract lock.`);
  }

  for (const [name, expected] of Object.entries(lock.files)) {
    const actual = sha256(await readFile(join(contractRoot, name)));
    if (actual !== expected) {
      throw new Error(`${name} does not match the canonical SDK-generated contract bundle.`);
    }
  }

  const contractLock = JSON.parse(await readFile(join(contractRoot, 'contract-lock.generated.json'), 'utf8'));
  if (contractLock.sha256 !== lock.contractSha256) {
    throw new Error('The contract and generated-output locks disagree.');
  }
  process.stdout.write(`Verified ${Object.keys(lock.files).length} generated Module contract files.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
