import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(async () => ({
    user: { id: 'admin', role: 'admin', email: 'admin@example.test', name: 'Admin' },
    expires: '2099-01-01T00:00:00.000Z',
  })),
}));

vi.mock('@/lib/access', () => ({
  enforceApiAccessLock: vi.fn(async () => null),
  getGeneralSettings: vi.fn(async () => ({})),
  setGeneralSettings: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/db/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/modules/registry', () => ({ getModule: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ setUserPermissions: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications/channels', () => ({
  ChannelError: class ChannelError extends Error {},
  createChannel: vi.fn(), listChannels: vi.fn(), updateChannel: vi.fn(),
  setChannelEnabled: vi.fn(), getChannelSummary: vi.fn(), deleteChannel: vi.fn(),
}));

const general = await import('@/app/api/settings/general/route');
const notifications = await import('@/app/api/settings/notifications/route');
const notification = await import('@/app/api/settings/notifications/[id]/route');
const permissions = await import('@/app/api/settings/users/[id]/permissions/route');

function crossOriginlessRequest(path: string, method: string): Request {
  return new Request(`https://nad.example.test${path}`, {
    method,
    headers: { host: 'nad.example.test', 'content-type': 'application/json' },
    body: method === 'DELETE' ? undefined : '{}',
  });
}

describe('admin mutation CSRF boundary', () => {
  it('refuses sensitive settings, notification and permission mutations without an Origin', async () => {
    const responses = await Promise.all([
      general.POST(crossOriginlessRequest('/api/settings/general', 'POST')),
      notifications.POST(crossOriginlessRequest('/api/settings/notifications', 'POST')),
      notification.PATCH(crossOriginlessRequest('/api/settings/notifications/channel', 'PATCH'), {
        params: Promise.resolve({ id: 'channel' }),
      }),
      notification.DELETE(crossOriginlessRequest('/api/settings/notifications/channel', 'DELETE'), {
        params: Promise.resolve({ id: 'channel' }),
      }),
      permissions.PUT(crossOriginlessRequest('/api/settings/users/member/permissions', 'PUT'), {
        params: Promise.resolve({ id: 'member' }),
      }),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([403, 403, 403, 403, 403]);
    await Promise.all(responses.map(async (response) => {
      await expect(response.json()).resolves.toMatchObject({ code: 'CSRF_REFUSED' });
    }));
  });
});
