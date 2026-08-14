import { describe, expect, it } from 'vitest';
import { createInstalledRuntimeEnvironment } from '@/lib/modules/installed/runner';

describe('createInstalledRuntimeEnvironment', () => {
  it('uses the disposable invocation directory for Deno cache state', () => {
    const environment = createInstalledRuntimeEnvironment('/tmp/nad-module-test');

    expect(environment).toEqual({
      NODE_ENV: 'production',
      DENO_DIR: '/tmp/nad-module-test',
      DENO_NO_UPDATE_CHECK: '1',
      DENO_NO_PROMPT: '1',
      NO_COLOR: '1',
    });
    expect(environment).not.toHaveProperty('HOME');
  });
});
