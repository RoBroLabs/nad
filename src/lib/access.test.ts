import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Point the database module at a disposable file before importing anything
// that opens a connection. This file is the integration pattern for
// DB-backed core behaviour: set DATABASE_URL first, then dynamic-import.
const dataDirectory = mkdtempSync(join(tmpdir(), 'nad-access-test-'));
process.env.DATABASE_URL = `file:${join(dataDirectory, 'test.db')}`;
delete process.env.AUTH_URL;
delete process.env.APP_URL;

const access = await import('@/lib/access');

afterAll(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
});

function requestTo(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers });
}

describe('general access settings', () => {
  it('defaults to no stored URL and the access lock off', async () => {
    const settings = await access.getGeneralSettings();
    expect(settings.canonicalUrl).toBeNull();
    expect(settings.envCanonicalUrl).toBeNull();
    expect(settings.effectiveCanonicalUrl).toBeNull();
    expect(settings.accessMode).toBe('off');
  });

  it('stores and normalises the canonical URL and access mode', async () => {
    await access.setGeneralSettings({
      canonicalUrl: 'https://NAD.example.com:443/',
      accessMode: 'locked',
    });

    const settings = await access.getGeneralSettings();
    expect(settings.canonicalUrl).toBe('https://nad.example.com');
    expect(settings.effectiveCanonicalUrl).toBe('https://nad.example.com');
    expect(settings.accessMode).toBe('locked');
  });

  it('treats an unparseable stored value as absent and falls back to the environment', async () => {
    process.env.APP_URL = 'http://192.168.1.15:3000';
    await access.setGeneralSettings({ canonicalUrl: null, accessMode: 'off' });

    const settings = await access.getGeneralSettings();
    expect(settings.canonicalUrl).toBeNull();
    expect(settings.envCanonicalUrl).toBe('http://192.168.1.15:3000');
    expect(settings.effectiveCanonicalUrl).toBe('http://192.168.1.15:3000');

    delete process.env.APP_URL;
  });
});

describe('access lock enforcement', () => {
  it('redirects page requests from a foreign origin only when locked', async () => {
    await access.setGeneralSettings({ canonicalUrl: 'https://nad.example.com', accessMode: 'locked' });
    const foreignHeaders = new Headers({ host: '192.168.1.15:3000' });
    const canonicalHeaders = new Headers({
      host: 'internal:3000',
      'x-forwarded-host': 'nad.example.com',
      'x-forwarded-proto': 'https',
    });

    expect(await access.getAccessLockRedirect(foreignHeaders)).toBe('https://nad.example.com');
    expect(await access.getAccessLockRedirect(canonicalHeaders)).toBeNull();

    await access.setGeneralSettings({ canonicalUrl: 'https://nad.example.com', accessMode: 'off' });
    expect(await access.getAccessLockRedirect(foreignHeaders)).toBeNull();
  });

  it('fails open when the request origin cannot be determined', async () => {
    await access.setGeneralSettings({ canonicalUrl: 'https://nad.example.com', accessMode: 'locked' });
    expect(await access.getAccessLockRedirect(new Headers())).toBeNull();
  });

  it('refuses API requests from a foreign origin with a JSON 403', async () => {
    await access.setGeneralSettings({ canonicalUrl: 'https://nad.example.com', accessMode: 'locked' });

    const blocked = await access.enforceApiAccessLock(
      requestTo('http://192.168.1.15:3000/api/modules/network/stats', {
        host: '192.168.1.15:3000',
      }),
    );
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(403);
    await expect(blocked?.json()).resolves.toMatchObject({ code: 'NON_CANONICAL_HOST' });

    const allowed = await access.enforceApiAccessLock(
      requestTo('http://internal:3000/api/modules/network/stats', {
        'x-forwarded-host': 'nad.example.com',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(allowed).toBeNull();
  });

  it('allows every API origin while the lock is off', async () => {
    await access.setGeneralSettings({ canonicalUrl: 'https://nad.example.com', accessMode: 'off' });
    const result = await access.enforceApiAccessLock(
      requestTo('http://192.168.1.15:3000/api/user/layout', { host: '192.168.1.15:3000' }),
    );
    expect(result).toBeNull();
  });
});
