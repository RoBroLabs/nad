#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const bundleSchemaVersion = 1;
const zeroDosTime = 0;
const zeroDosDate = 0x21;

function fail(message) {
  throw new Error(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function crc32(value) {
  let result = 0xffffffff;
  for (const byte of value) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit += 1) result = (result >>> 1) ^ (0xedb88320 & -(result & 1));
  }
  return (result ^ 0xffffffff) >>> 0;
}

function writeUint16(value) {
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value, 0);
  return output;
}

function writeUint32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
}

function createStoredZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.concat([
      writeUint32(0x04034b50), writeUint16(20), writeUint16(0), writeUint16(0),
      writeUint16(zeroDosTime), writeUint16(zeroDosDate), writeUint32(checksum),
      writeUint32(data.length), writeUint32(data.length), writeUint16(name.length), writeUint16(0),
      name, data,
    ]);
    locals.push(local);
    central.push(Buffer.concat([
      writeUint32(0x02014b50), writeUint16(20), writeUint16(20), writeUint16(0), writeUint16(0),
      writeUint16(zeroDosTime), writeUint16(zeroDosDate), writeUint32(checksum),
      writeUint32(data.length), writeUint32(data.length), writeUint16(name.length), writeUint16(0),
      writeUint16(0), writeUint16(0), writeUint16(0), writeUint32(0o100644 << 16), writeUint32(offset),
      name,
    ]));
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(central);
  return Buffer.concat([
    ...locals,
    centralDirectory,
    writeUint32(0x06054b50), writeUint16(0), writeUint16(0), writeUint16(entries.length),
    writeUint16(entries.length), writeUint32(centralDirectory.length), writeUint32(offset), writeUint16(0),
  ]);
}

function parseStoredZip(archive) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > archive.length) fail('Bundle ZIP has a truncated local header.');
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const checksum = archive.readUInt32LE(offset + 14);
    const compressedBytes = archive.readUInt32LE(offset + 18);
    const bytes = archive.readUInt32LE(offset + 22);
    const nameBytes = archive.readUInt16LE(offset + 26);
    const extraBytes = archive.readUInt16LE(offset + 28);
    if (flags !== 0 || method !== 0 || compressedBytes !== bytes) fail('Bundle ZIP uses an unsupported encoding.');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameBytes + extraBytes;
    const dataEnd = dataStart + bytes;
    if (dataEnd > archive.length) fail('Bundle ZIP has a truncated entry.');
    const path = archive.subarray(nameStart, nameStart + nameBytes).toString('utf8');
    const data = archive.subarray(dataStart, dataEnd);
    if (!path || path.includes('..') || path.startsWith('/') || entries.has(path)) fail('Bundle ZIP has an unsafe entry path.');
    if (crc32(data) !== checksum) fail(`Bundle ZIP entry checksum mismatch: ${path}`);
    entries.set(path, data);
    offset = dataEnd;
  }
  if (!entries.size) fail('Bundle ZIP has no files.');
  return entries;
}

function parseIdentity(options) {
  const version = options.version;
  const revision = options.revision;
  const imageRepository = options.imageRepository;
  const imageDigest = options.imageDigest;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version ?? '')) fail('Version must be a semantic version.');
  if (!/^[0-9a-f]{40}$/i.test(revision ?? '')) fail('Revision must be a full 40-character Git SHA.');
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/.test(imageRepository ?? '')) {
    fail('Image repository must be a lowercase registry/repository path without a tag or digest.');
  }
  if (!/^sha256:[0-9a-f]{64}$/i.test(imageDigest ?? '')) fail('Image digest must be an immutable sha256 digest.');
  return { version, revision: revision.toLowerCase(), imageRepository, imageDigest: imageDigest.toLowerCase() };
}

function sourceCompose(imageReference) {
  const compose = readFileSync(join(repositoryRoot, 'docker-compose.yml'), 'utf8');
  const withImage = compose.replace(/^    image: .+$/m, `    image: ${imageReference}`);
  const result = withImage
    .replace('    # Source builds use docker-compose.build.yml explicitly.\n', '')
    .replace(/(    env_file:\n)      - \.env\.local/m, '$1      - .env');
  if (result === compose || /(^|\n)\s*build\s*:/.test(result)) fail('Supported Compose definition could not produce a pull-only bundle.');
  return result;
}

function environmentExample() {
  return `# Copy to .env before starting NAD. Never commit this file with real secrets.\nAPP_NAME=NAD\nAPP_SECRET=\nAUTH_SECRET=\nAPP_URL=https://nad.example.com\nAUTH_URL=https://nad.example.com\nAPP_TIMEZONE=UTC\nNAD_BIND_ADDRESS=127.0.0.1\nNAD_MARKETPLACE_MODE=online\nNAD_MARKETPLACE_URL=https://nad.robrolabs.com\n`;
}

function bundleReadme(identity) {
  return `# NAD ${identity.version}\n\nThis bundle runs the reviewed NAD image without a source checkout or local image build.\n\n## Start\n\n1. Install Docker Engine and the Docker Compose plugin on Linux \`amd64\` or 64-bit \`arm64\`.\n2. Copy \`.env.example\` to \`.env\`. Generate independent secrets with \`openssl rand -base64 32\` and set \`APP_SECRET\` and \`AUTH_SECRET\`. Set \`APP_URL\` and \`AUTH_URL\` to the final HTTPS origin.\n3. Validate the resolved deployment, then start it:\n\n   \`docker compose -f compose.yaml config\`\n\n   \`docker compose -f compose.yaml up -d\`\n\nThe image is pinned to \`${identity.imageRepository}@${identity.imageDigest}\`. Compose pulls the matching architecture automatically; it must not build NAD locally.\n\n## Reverse proxy\n\nBy default NAD binds only to \`127.0.0.1:3000\`. Put a TLS reverse proxy in front of it, preserve the original \`Host\` and forwarded-client headers, then use that HTTPS origin for both URL settings. Only change \`NAD_BIND_ADDRESS\` when the host-network boundary is intentional.\n\n## Marketplace\n\n\`NAD_MARKETPLACE_MODE=online\` uses the first-party Marketplace. Set it to \`manual\` to prevent all Marketplace requests while retaining signed \`.nadmod\` upload.\n\n## Backup, upgrade and rollback\n\nCreate and verify a backup before replacing the image:\n\n\`docker compose -f compose.yaml exec nad /nodejs/bin/node scripts/backup-maintenance.mjs\`\n\n\`docker compose -f compose.yaml exec nad /nodejs/bin/node scripts/verify-backup.mjs /app/data/backups/<bundle> --disposable\`\n\nFor an upgrade, retain this bundle, its image digest and a verified backup; extract the newer bundle alongside it and run \`docker compose -f compose.yaml up -d\`. To roll back after a migration, stop NAD, restore the complete pre-upgrade database-and-Plugin backup into a disposable volume, then start the previous bundle. Do not attach an older image to a migrated database.\n\nSee the matching Operations guide for the full restore drill: https://github.com/robrolabs/nad/blob/main/docs/OPERATIONS.md\n`;
}

function buildEntries(identity) {
  const root = `NAD-${identity.version}`;
  const manifest = {
    schemaVersion: bundleSchemaVersion,
    product: 'NAD',
    version: identity.version,
    revision: identity.revision,
    image: {
      repository: identity.imageRepository,
      digest: identity.imageDigest,
      reference: `${identity.imageRepository}@${identity.imageDigest}`,
    },
    supportedPlatforms: ['linux/amd64', 'linux/arm64'],
  };
  const entries = [
    { path: `${root}/.env.example`, data: environmentExample() },
    { path: `${root}/README.md`, data: bundleReadme(identity) },
    { path: `${root}/compose.yaml`, data: sourceCompose(manifest.image.reference) },
    { path: `${root}/release-manifest.json`, data: `${JSON.stringify(manifest, null, 2)}\n` },
  ].sort((left, right) => left.path.localeCompare(right.path));
  const sums = entries.map((entry) => `${sha256(entry.data)}  ${entry.path.slice(root.length + 1)}`).join('\n');
  entries.push({ path: `${root}/SHA256SUMS`, data: `${sums}\n` });
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function verifyEntries(entries, identity) {
  const root = `NAD-${identity.version}/`;
  const required = ['.env.example', 'README.md', 'compose.yaml', 'release-manifest.json', 'SHA256SUMS'];
  if (entries.size !== required.length) fail('Bundle ZIP has an unexpected file inventory.');
  for (const name of required) if (!entries.has(`${root}${name}`)) fail(`Bundle ZIP is missing ${name}.`);
  const compose = entries.get(`${root}compose.yaml`).toString('utf8');
  if (/(^|\n)\s*build\s*:/.test(compose) || compose.includes('docker-compose.build.yml') || !compose.includes(`${identity.imageRepository}@${identity.imageDigest}`)) {
    fail('Bundle Compose is not a pull-only immutable-image definition.');
  }
  const environment = entries.get(`${root}.env.example`).toString('utf8');
  const privateDeploymentMarker = new RegExp(['stonewallmedia', '192\\.168\\.', 'gi' + 'tea', 'dok' + 'ploy'].join('|'), 'i');
  if (/APP_SECRET=.+|AUTH_SECRET=.+/.test(environment) || privateDeploymentMarker.test(environment)) {
    fail('Bundle environment example contains a secret or private deployment value.');
  }
  const manifest = JSON.parse(entries.get(`${root}release-manifest.json`).toString('utf8'));
  if (manifest.schemaVersion !== bundleSchemaVersion || manifest.version !== identity.version || manifest.revision !== identity.revision || manifest.image?.digest !== identity.imageDigest) {
    fail('Bundle release manifest does not match the requested release identity.');
  }
  const expectedSums = entries.get(`${root}SHA256SUMS`).toString('utf8');
  const actualSums = required
    .filter((name) => name !== 'SHA256SUMS')
    .sort((left, right) => left.localeCompare(right))
    .map((name) => `${sha256(entries.get(`${root}${name}`))}  ${name}`)
    .join('\n') + '\n';
  if (actualSums !== expectedSums) fail('Bundle SHA256SUMS does not match its files.');
}

function validateCompose(outputDirectory) {
  const environmentPath = join(outputDirectory, '.env');
  writeFileSync(environmentPath, readFileSync(join(outputDirectory, '.env.example')));
  try {
    const output = execFileSync('docker', ['compose', '-f', 'compose.yaml', 'config'], {
      cwd: outputDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (/(^|\n)\s*build\s*:/.test(output) || !/sha256:[0-9a-f]{64}/i.test(output)) fail('Docker Compose did not resolve a pull-only immutable image.');
  } finally {
    rmSync(environmentPath, { force: true });
  }
}

function extractEntries(entries, outputDirectory) {
  if (!existsSync(outputDirectory) || readdirSync(outputDirectory).length) {
    fail('Extraction directory must already exist and be empty.');
  }
  for (const [path, data] of entries) {
    const target = resolve(outputDirectory, path);
    if (relative(outputDirectory, target).startsWith('..')) fail(`Bundle ZIP has an unsafe extraction path: ${path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data, { mode: 0o644 });
  }
}

export function createInstallationBundle({ version, revision, imageRepository, imageDigest, outputDirectory, validateCompose: shouldValidateCompose = false }) {
  const identity = parseIdentity({ version, revision, imageRepository, imageDigest });
  const output = resolve(outputDirectory ?? '');
  if (!outputDirectory || !existsSync(output) || readdirSync(output).length) {
    fail('Output directory must already exist and be empty.');
  }
  const entries = buildEntries(identity);
  const archive = createStoredZip(entries);
  verifyEntries(parseStoredZip(archive), identity);
  const fileName = `NAD-${identity.version}-installation-bundle.zip`;
  const archivePath = join(output, fileName);
  const checksumPath = `${archivePath}.sha256`;
  if (existsSync(archivePath) || existsSync(checksumPath)) fail(`Refusing to overwrite an existing bundle: ${fileName}`);
  writeFileSync(archivePath, archive, { mode: 0o644 });
  writeFileSync(checksumPath, `${sha256(archive)}  ${basename(archivePath)}\n`, { mode: 0o644 });
  if (shouldValidateCompose) {
    const extracted = mkdtempSync(join(tmpdir(), 'nad-install-bundle-'));
    try {
      extractEntries(parseStoredZip(archive), extracted);
      validateCompose(join(extracted, `NAD-${identity.version}`));
    } finally {
      rmSync(extracted, { recursive: true, force: true });
    }
  }
  return { archivePath, checksumPath, archiveSha256: sha256(archive), identity };
}

export function verifyInstallationBundle({ bundlePath }) {
  const archive = readFileSync(resolve(bundlePath));
  const entries = parseStoredZip(archive);
  const manifestEntry = [...entries.entries()].find(([path]) => path.endsWith('/release-manifest.json'));
  if (!manifestEntry) fail('Bundle ZIP has no release manifest.');
  const manifest = JSON.parse(manifestEntry[1].toString('utf8'));
  const identity = parseIdentity({
    version: manifest.version,
    revision: manifest.revision,
    imageRepository: manifest.image?.repository,
    imageDigest: manifest.image?.digest,
  });
  verifyEntries(entries, identity);
  return { archiveSha256: sha256(archive), identity, files: [...entries.keys()].sort() };
}

export function extractInstallationBundle({ bundlePath, outputDirectory }) {
  const archive = readFileSync(resolve(bundlePath));
  const entries = parseStoredZip(archive);
  const verified = verifyInstallationBundle({ bundlePath });
  extractEntries(entries, resolve(outputDirectory));
  return verified;
}

function main() {
  const result = createInstallationBundle({
    version: argument('--version'),
    revision: argument('--revision'),
    imageRepository: argument('--image-repository'),
    imageDigest: argument('--image-digest'),
    outputDirectory: argument('--out'),
    validateCompose: process.argv.includes('--validate-compose'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
