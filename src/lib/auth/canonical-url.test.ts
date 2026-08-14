import { afterEach, describe, expect, it } from 'vitest';
import { getCanonicalLoginUrl } from '@/lib/auth/canonical-url';

const originalAuthUrl = process.env.AUTH_URL;
const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = originalAuthUrl;

  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

describe('getCanonicalLoginUrl', () => {
  it('builds the secure login URL and setup completion marker', () => {
    process.env.AUTH_URL = 'https://nad.example.com';
    process.env.APP_URL = 'http://ignored.example.test';

    expect(getCanonicalLoginUrl()).toBe('https://nad.example.com/login');
    expect(getCanonicalLoginUrl(true)).toBe('https://nad.example.com/login?setup=complete');
  });

  it('falls back to APP_URL and rejects credential-bearing URLs', () => {
    delete process.env.AUTH_URL;
    process.env.APP_URL = 'http://127.0.0.1:3000/base';
    expect(getCanonicalLoginUrl()).toBe('http://127.0.0.1:3000/login');

    process.env.APP_URL = 'https://user:password@example.test';
    expect(getCanonicalLoginUrl()).toBeUndefined();
  });
});
