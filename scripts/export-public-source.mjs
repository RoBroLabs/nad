import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ALLOWED_TOP_LEVEL = new Set([
  '.dockerignore', '.env.example', '.gitattributes', '.github', '.gitignore',
  '.gitleaks.toml', '.nvmrc', 'AGENTS.md', 'Dockerfile', 'LICENSE', 'README.md',
  'SECURITY.md', 'VERSION', 'components.json', 'docker-compose.backup.yml',
  'docker-compose.build.yml', 'docker-compose.yml', 'docs', 'drizzle.config.ts',
  'e2e', 'eslint.config.mjs', 'next.config.ts', 'package.json',
  'playwright.config.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'postcss.config.mjs', 'public', 'scripts', 'src', 'tsconfig.json',
  'vitest.config.ts',
]);

const FORBIDDEN_SEGMENTS = [
  '/docs/evidence/', '/docs/archive/', '/docs/milestones/', '/.gitea/',
  '/node_modules/', '/.next/', '/output/', '/test-results/', '/.playwright-cli/',
  '/data/', '/docs/PUBLIC_SOURCE.md', '/docker-compose.dokploy.yml',
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const reference = argument('--ref', 'HEAD');
const destinationValue = argument('--out');
if (!destinationValue) fail('Usage: pnpm public:export -- --ref <git-ref> --out <empty-directory>');

const repositoryRoot = resolve(import.meta.dirname, '..');
const destination = resolve(destinationValue);
if (destination === repositoryRoot || repositoryRoot.startsWith(`${destination}/`)) {
  fail('The public export destination must be outside the private repository.');
}
if (statSync(destination, { throwIfNoEntry: false }) && readdirSync(destination).length > 0) {
  fail(`Public export destination is not empty: ${destination}`);
}

const resolvedRevision = execFileSync('git', ['rev-parse', '--verify', `${reference}^{commit}`], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'nad-public-export-'));
const archivePath = join(temporaryRoot, 'source.tar');

try {
  execFileSync('git', ['archive', '--format=tar', '--output', archivePath, resolvedRevision], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xf', archivePath, '-C', destination], { stdio: 'inherit' });

  for (const entry of readdirSync(destination)) {
    if (!ALLOWED_TOP_LEVEL.has(entry)) fail(`Public export contains an unexpected top-level path: ${entry}`);
  }

  const tracked = execFileSync('find', ['.', '-type', 'f', '-print'], {
    cwd: destination,
    encoding: 'utf8',
  }).split('\n').filter(Boolean);
  for (const relative of tracked) {
    const normalized = `/${relative.replace(/^\.\//, '')}`;
    if (FORBIDDEN_SEGMENTS.some((segment) => normalized === segment || normalized.startsWith(segment))) {
      fail(`Public export contains a forbidden path: ${relative}`);
    }
  }

  const forbiddenText = /(?:192\.168\.70\.|stonewallmedia\.co\.uk|gitea-git|Dokploy|TBD_PHASE8_|\.codex\/credentials)/i;
  for (const relative of tracked) {
    if (relative === './.gitattributes' || relative === './scripts/export-public-source.mjs') continue;
    const filePath = join(destination, relative);
    if (statSync(filePath).size > 2_000_000) continue;
    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    if (forbiddenText.test(content)) fail(`Public export contains private or incomplete release text: ${relative}`);
  }

  process.stdout.write(`Exported NAD ${resolvedRevision} to ${destination}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
