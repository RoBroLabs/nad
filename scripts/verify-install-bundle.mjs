#!/usr/bin/env node

import { resolve } from 'node:path';
import { verifyInstallationBundle } from './generate-install-bundle.mjs';

const index = process.argv.indexOf('--bundle');
if (index === -1 || !process.argv[index + 1]) {
  process.stderr.write('Usage: node scripts/verify-install-bundle.mjs --bundle <bundle.zip>\n');
  process.exitCode = 1;
} else {
  try {
    process.stdout.write(`${JSON.stringify(verifyInstallationBundle({ bundlePath: resolve(process.argv[index + 1]) }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Bundle verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
