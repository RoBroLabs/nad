import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';

// =============================================================================
// Core route integration tests
// =============================================================================
// Exercises real route handlers against a disposable database with the Auth.js
// session mocked at the module boundary. DATABASE_URL must be set before any
// database-touching module is imported.
// =============================================================================

// NAD_CORE_VERSION is resolved at import time, before these tests can set
// NAD_VERSION, so it falls through to the root VERSION file. Read the same
// source rather than hardcoding it, so a release bump cannot break this test.
const rootVersion = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();

const dataDirectory = mkdtempSync(join(tmpdir(), 'nad-core-routes-test-'));
process.env.DATABASE_URL = `file:${join(dataDirectory, 'test.db')}`;
process.env.APP_SECRET = 'core-routes-test-secret-0000000000000001';
delete process.env.AUTH_URL;
delete process.env.APP_URL;

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/notifications', () => ({
  notify: vi.fn(async () => undefined),
  sendChannelTestNotification: vi.fn(),
}));

const { auth } = await import('@/lib/auth/config');
const authMock = vi.mocked(auth);
const { notify } = await import('@/lib/notifications');
const notifyMock = vi.mocked(notify);
const { db } = await import('@/lib/db');
const { users, appSettings } = await import('@/lib/db/schema');
const { eq } = await import('drizzle-orm');

/** Auth.js has overloaded call signatures; mock the session through a narrow cast. */
function mockSession(session: Session | null): void {
  (authMock as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(session);
}

const setupRoute = await import('@/app/api/setup/route');
const layoutRoute = await import('@/app/api/user/layout/route');
const generalRoute = await import('@/app/api/settings/general/route');
const passwordRoute = await import('@/app/api/user/password/route');
const healthRoute = await import('@/app/api/health/route');
const buildInfoRoute = await import('@/app/api/build-info/route');

afterAll(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
});

function jsonRequest(url: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function adminSession(): Session {
  return {
    user: { id: 'admin-user-id', email: 'admin@example.test', name: 'Admin', role: 'admin' },
    expires: '2099-01-01T00:00:00.000Z',
  } as Session;
}

/** Session bound to the real administrator row created by the setup tests. */
async function realAdminSession(): Promise<Session> {
  const user = await db.select().from(users).get();
  if (!user) throw new Error('Expected the setup tests to have created an admin.');
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires: '2099-01-01T00:00:00.000Z',
  } as Session;
}

beforeEach(() => {
  authMock.mockReset();
  notifyMock.mockClear();
  mockSession(null);
});

describe('setup route', () => {
  it('rejects invalid payloads before creating anything', async () => {
    const response = await setupRoute.POST(jsonRequest('http://127.0.0.1:3000/api/setup', {
      name: 'A', email: 'a@b.c', password: 'short', dashboardName: 'NAD',
    }));
    expect(response.status).toBe(400);
  });

  it('rejects an unusable dashboard URL', async () => {
    const response = await setupRoute.POST(jsonRequest('http://127.0.0.1:3000/api/setup', {
      name: 'Admin', email: 'admin@example.test', password: 'long-enough-password',
      dashboardName: 'NAD',
      dashboardUrl: 'https://nad.example.test/path',
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('creates the first admin without a confirmation field, stores branding and canonical URL, then refuses repeats', async () => {
    const created = await setupRoute.POST(jsonRequest('http://127.0.0.1:3000/api/setup', {
      name: 'Admin', email: 'admin@example.test', password: 'long-enough-password',
      dashboardName: 'Test NAD',
      dashboardUrl: 'https://nad.example.test',
    }));
    expect(created.status).toBe(201);

    // The setup notification is fire-and-forget; flush the microtask queue so
    // the mock invocation is observable before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    expect(notifyMock).toHaveBeenCalledWith(
      'NAD setup complete',
      expect.stringContaining('Test NAD'),
      'info',
    );
    const body = await created.json() as { data: { userId: string; loginUrl?: string } };
    expect(body.data.loginUrl).toBe('https://nad.example.test/login?setup=complete');

    const user = await db.select().from(users).get();
    expect(user).toMatchObject({ email: 'admin@example.test', role: 'admin' });

    const settings = await db.select().from(appSettings).all();
    const byKey = Object.fromEntries(settings.map(({ key, value }) => [key, value]));
    expect(byKey).toMatchObject({ dashboard_name: 'Test NAD', canonical_url: 'https://nad.example.test' });

    const duplicate = await setupRoute.POST(jsonRequest('http://127.0.0.1:3000/api/setup', {
      name: 'Second', email: 'second@example.test', password: 'long-enough-password',
      dashboardName: 'NAD',
    }));
    expect(duplicate.status).toBe(409);
  });
});

describe('layout route', () => {
  const validLayout = {
    widgets: [{ instanceId: 'w-1', moduleSlug: 'network', widgetId: 'dns-stats' }],
    layouts: { lg: [{ i: 'w-1', x: 0, y: 0, w: 4, h: 3 }] },
  };

  it('requires authentication and returns the empty layout by default', async () => {
    const unauthenticated = await layoutRoute.GET(jsonRequest('http://127.0.0.1:3000/api/user/layout'));
    expect(unauthenticated.status).toBe(401);

    mockSession(adminSession());
    const response = await layoutRoute.GET(jsonRequest('http://127.0.0.1:3000/api/user/layout'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { widgets: [], layouts: {} } });
  });

  it('persists and reloads a validated layout, rejecting malformed shapes', async () => {
    mockSession(await realAdminSession());

    const saved = await layoutRoute.POST(jsonRequest('http://127.0.0.1:3000/api/user/layout', validLayout));
    expect(saved.status).toBe(200);

    const loaded = await layoutRoute.GET(jsonRequest('http://127.0.0.1:3000/api/user/layout'));
    await expect(loaded.json()).resolves.toEqual({ data: validLayout });

    const invalid = await layoutRoute.POST(jsonRequest('http://127.0.0.1:3000/api/user/layout', {
      widgets: [{ instanceId: 'w-1', moduleSlug: 'INVALID SLUG', widgetId: 'x' }],
      layouts: {},
    }));
    expect(invalid.status).toBe(400);
  });
});

describe('general settings route', () => {
  it('rejects non-admin callers', async () => {
    mockSession({
      user: { id: 'member-id', role: 'member' },
      expires: '2099-01-01T00:00:00.000Z',
    } as Session);

    const response = await generalRoute.GET(jsonRequest('http://127.0.0.1:3000/api/settings/general'));
    expect(response.status).toBe(403);
  });

  it('validates the URL and requires one before locking', async () => {
    mockSession(adminSession());

    const badUrl = await generalRoute.POST(jsonRequest('http://127.0.0.1:3000/api/settings/general', {
      canonicalUrl: 'notaurl', accessMode: 'off',
    }));
    expect(badUrl.status).toBe(400);

    // Clear the URL stored during the setup test first.
    const cleared = await generalRoute.POST(jsonRequest('http://127.0.0.1:3000/api/settings/general', {
      canonicalUrl: '', accessMode: 'off',
    }));
    expect(cleared.status).toBe(200);

    const lockWithoutUrl = await generalRoute.POST(jsonRequest('http://127.0.0.1:3000/api/settings/general', {
      canonicalUrl: '', accessMode: 'locked',
    }));
    expect(lockWithoutUrl.status).toBe(400);
  });

  it('saves settings and reports a redirect when locking from another origin', async () => {
    mockSession(adminSession());
    const response = await generalRoute.POST(jsonRequest('http://127.0.0.1:3000/api/settings/general', {
      canonicalUrl: 'https://nad.example.test', accessMode: 'locked',
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { accessMode: string; redirectTo: string | null } };
    expect(body.data.accessMode).toBe('locked');
    expect(body.data.redirectTo).toBe('https://nad.example.test');
  });
});

describe('build info route', () => {
  it('requires an administrator session', async () => {
    const unauthenticated = await buildInfoRoute.GET(jsonRequest(
      'http://internal:3000/api/build-info',
      undefined,
      { 'x-forwarded-host': 'nad.example.test', 'x-forwarded-proto': 'https' },
    ));
    expect(unauthenticated.status).toBe(401);

    mockSession({
      user: { id: 'member-id', role: 'member' },
      expires: '2099-01-01T00:00:00.000Z',
    } as Session);
    const forbidden = await buildInfoRoute.GET(jsonRequest(
      'http://internal:3000/api/build-info',
      undefined,
      { 'x-forwarded-host': 'nad.example.test', 'x-forwarded-proto': 'https' },
    ));
    expect(forbidden.status).toBe(403);
  });

  it('returns the central build metadata and sanitised Marketplace state for admins', async () => {
    process.env.NAD_VERSION = '0.2.1-test';
    process.env.NAD_GIT_REVISION = 'abcdef123456';
    process.env.NAD_BUILD_DATE = '2026-08-10T12:34:56Z';
    process.env.NAD_SOURCE_URL = 'https://example.test/nad.git';
    process.env.NAD_DENO_VERSION = '2.7.7';
    process.env.NAD_MARKETPLACE_MODE = 'manual';
    process.env.NAD_MARKETPLACE_URL = 'https://nad.example.test/catalog/';
    mockSession(adminSession());

    const response = await buildInfoRoute.GET(jsonRequest(
      'http://internal:3000/api/build-info',
      undefined,
      { 'x-forwarded-host': 'nad.example.test', 'x-forwarded-proto': 'https' },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        coreVersion: rootVersion,
        hostApiVersion: '1.0',
        hostApiCompatibility: '1.x',
        uiApiVersion: '1.0',
        uiApiCompatibility: '1.x',
        modulePackageSchemaVersion: 1,
        modulePackageSchemaDisplayVersion: '1.0',
        nodeVersion: process.version,
        denoVersion: '2.7.7',
        buildVersion: '0.2.1-test',
        buildRevision: 'abcdef123456',
        buildCreatedAt: '2026-08-10T12:34:56Z',
        sourceRepository: 'https://example.test/nad.git',
        marketplace: {
          mode: 'manual',
          url: 'https://nad.example.test/catalog/',
          configurationValid: true,
        },
      },
    });
  });
});

describe('access lock across routes', () => {
  it('refuses a foreign-origin API call while health stays reachable', async () => {
    // Lock is on from the previous test, canonical is https://nad.example.test.
    mockSession(adminSession());

    const blocked = await layoutRoute.GET(jsonRequest('http://127.0.0.1:3000/api/user/layout'));
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({ code: 'NON_CANONICAL_HOST' });

    const forwarded = await layoutRoute.GET(jsonRequest(
      'http://internal:3000/api/user/layout',
      undefined,
      { 'x-forwarded-host': 'nad.example.test', 'x-forwarded-proto': 'https' },
    ));
    expect(forwarded.status).toBe(200);

    const health = await healthRoute.GET();
    expect(health.status).toBe(200);

    // Restore off for later tests.
    await generalRoute.POST(jsonRequest(
      'http://internal:3000/api/settings/general',
      { canonicalUrl: 'https://nad.example.test', accessMode: 'off' },
      {
        'x-forwarded-host': 'nad.example.test',
        'x-forwarded-proto': 'https',
        origin: 'https://nad.example.test',
      },
    ));
  });
});

describe('password route', () => {
  it('changes the password only with the current one and advances authVersion', async () => {
    const user = await db.select().from(users).get();
    expect(user).toBeDefined();
    mockSession(await realAdminSession());

    const wrongCurrent = await passwordRoute.POST(jsonRequest('http://127.0.0.1:3000/api/user/password', {
      currentPassword: 'wrong-password', password: 'replacement-password',
      passwordConfirmation: 'replacement-password',
    }));
    expect(wrongCurrent.status).toBe(400);

    const changed = await passwordRoute.POST(jsonRequest('http://127.0.0.1:3000/api/user/password', {
      currentPassword: 'long-enough-password', password: 'replacement-password',
      passwordConfirmation: 'replacement-password',
    }));
    expect(changed.status).toBe(200);

    const updated = await db.select().from(users).where(eq(users.id, user!.id)).get();
    expect(updated!.authVersion).toBe(user!.authVersion + 1);

    const bcrypt = await import('bcrypt');
    await expect(bcrypt.compare('replacement-password', updated!.passwordHash)).resolves.toBe(true);

    const audit = await db.query.auditLog.findMany();
    expect(audit.some(({ action }) => action === 'change_password')).toBe(true);

    // Security event notification fired after the change; order-independent flush.
    await new Promise((resolve) => setImmediate(resolve));
    expect(notifyMock).toHaveBeenCalledWith(
      'Account password changed',
      expect.stringContaining('admin@example.test'),
      'info',
    );
  });

  it('requires authentication', async () => {
    const response = await passwordRoute.POST(jsonRequest('http://127.0.0.1:3000/api/user/password', {
      currentPassword: 'x', password: 'replacement-password', passwordConfirmation: 'replacement-password',
    }));
    expect(response.status).toBe(401);
  });
});
