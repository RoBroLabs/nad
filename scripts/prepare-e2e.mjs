#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const resultsRoot = resolve(process.cwd(), 'test-results');
const dataDirectory = join(resultsRoot, 'e2e-data');
if (dirname(dataDirectory) !== resultsRoot || !dataDirectory.endsWith('/test-results/e2e-data')) {
  throw new Error('Refusing to prepare an unexpected browser-test data path.');
}
rmSync(dataDirectory, { recursive: true, force: true });
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

const standaloneDirectory = resolve(process.cwd(), '.next/standalone');
if (!existsSync(join(standaloneDirectory, 'server.js'))) {
  throw new Error('Build the standalone application before running browser tests.');
}
const standalonePublic = join(standaloneDirectory, 'public');
const standaloneStatic = join(standaloneDirectory, '.next/static');
rmSync(standalonePublic, { recursive: true, force: true });
rmSync(standaloneStatic, { recursive: true, force: true });
cpSync(resolve(process.cwd(), 'public'), standalonePublic, { recursive: true });
mkdirSync(dirname(standaloneStatic), { recursive: true });
cpSync(resolve(process.cwd(), '.next/static'), standaloneStatic, { recursive: true });
