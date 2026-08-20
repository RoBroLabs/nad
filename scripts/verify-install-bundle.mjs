#!/usr/bin/env node

import { resolve } from 'node:path';
import { extractInstallationBundle, verifyInstallationBundle } from './generate-install-bundle.mjs';

const index = process.argv.indexOf('--bundle');
if (index === -1 || !process.argv[index + 1]) {
  process.stderr.write('Usage: node scripts/verify-install-bundle.mjs --bundle <bundle.zip> [--extract-to <empty-directory>]\n');
  process.exitCode = 1;
} else {
  try {
    const extractIndex = process.argv.indexOf('--extract-to');
    const result = extractIndex === -1
      ? verifyInstallationBundle({ bundlePath: resolve(process.argv[index + 1]) })
      : extractInstallationBundle({
        bundlePath: resolve(process.argv[index + 1]),
        outputDirectory: resolve(process.argv[extractIndex + 1] ?? ''),
      });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Bundle verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
