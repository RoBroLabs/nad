import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'nad-production-deno-'));

try {
  const entrypoint = join(scratch, 'main.js');
  writeFileSync(entrypoint, 'console.log(JSON.stringify({ ok: true }));\n', { mode: 0o600 });
  const result = spawnSync('/usr/local/bin/deno', [
    'run',
    '--no-config',
    '--no-lock',
    '--no-prompt',
    '--cached-only',
    '--deny-env',
    '--deny-net',
    '--deny-read',
    '--deny-write',
    '--deny-run',
    '--deny-sys',
    '--deny-ffi',
    '--deny-import',
    entrypoint,
  ], {
    cwd: scratch,
    env: {
      NODE_ENV: 'production',
      DENO_DIR: scratch,
      DENO_NO_UPDATE_CHECK: '1',
      DENO_NO_PROMPT: '1',
      NO_COLOR: '1',
    },
    encoding: 'utf8',
  });

  if (result.status !== 0 || result.stderr !== '' || result.stdout.trim() !== '{"ok":true}') {
    throw new Error(`Production Deno smoke failed with status ${String(result.status)}.`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('Production Deno cache and denial smoke passed.');
