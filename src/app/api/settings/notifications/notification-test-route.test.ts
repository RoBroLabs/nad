import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceApiAccessLock: vi.fn(async () => null),
  logAuditEvent: vi.fn(async () => undefined),
  sendChannelTestNotification: vi.fn(async () => undefined),
}));

vi.mock('@/lib/access', () => ({ enforceApiAccessLock: mocks.enforceApiAccessLock }));
vi.mock('@/lib/auth/config', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/audit', () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock('@/lib/notifications', () => ({
  sendChannelTestNotification: mocks.sendChannelTestNotification,
}));

const notificationTestRoute = await import('@/app/api/settings/notifications/[id]/test/route');
const context = { params: Promise.resolve({ id: 'channel-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforceApiAccessLock.mockResolvedValue(null);
  mocks.auth.mockResolvedValue({
    user: { id: 'admin-1', role: 'admin', email: 'admin@example.test' },
    expires: '2099-01-01T00:00:00.000Z',
  });
});

describe('notification channel test route', () => {
  it('sends and audits a same-origin administrator test', async () => {
    const response = await notificationTestRoute.POST(new Request(
      'http://nad.test/api/settings/notifications/channel-1/test',
      { method: 'POST', headers: { origin: 'http://nad.test' } },
    ), context);

    expect(response.status).toBe(200);
    expect(mocks.sendChannelTestNotification).toHaveBeenCalledWith('channel-1');
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      'admin-1',
      'test_notification_channel',
      undefined,
      { channelId: 'channel-1' },
    );
  });

  it('refuses a cross-origin request before producing an external side effect', async () => {
    const response = await notificationTestRoute.POST(new Request(
      'http://nad.test/api/settings/notifications/channel-1/test',
      { method: 'POST', headers: { origin: 'https://attacker.example' } },
    ), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'CROSS_ORIGIN_REQUEST' });
    expect(mocks.sendChannelTestNotification).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });
});
