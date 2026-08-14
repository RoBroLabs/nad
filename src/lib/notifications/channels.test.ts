import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Disposable database pattern: env must be set before importing db/crypto.
const dataDirectory = mkdtempSync(join(tmpdir(), 'nad-channels-test-'));
process.env.DATABASE_URL = `file:${join(dataDirectory, 'test.db')}`;
process.env.APP_SECRET = 'channels-test-secret-00000000000000000001';

const { db } = await import('@/lib/db');
const { notificationChannels } = await import('@/lib/db/schema');
const channels = await import('@/lib/notifications/channels');

afterAll(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
});

const emailConfig = {
  host: 'smtp.example.com',
  port: 587,
  user: 'nad',
  pass: 'super-secret-password',
  from: 'nad@example.com',
};

describe('notification channel CRUD', () => {
  it('creates a channel with encrypted-at-rest config and masked display', async () => {
    const created = await channels.createChannel('email', emailConfig, true);
    expect(created.type).toBe('email');
    expect(created.enabled).toBe(true);
    expect(created.config.pass).toMatchObject({ masked: true, isSecret: true });
    expect(created.config.pass?.value).not.toContain('super-secret-password');
    expect(created.config.host?.value).toBe('smtp.example.com');

    const stored = await db.select().from(notificationChannels).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.config).not.toContain('super-secret-password');
    expect(stored[0]?.config).not.toContain('smtp.example.com');
  });

  it('rejects invalid configs and unsupported types', async () => {
    await expect(channels.createChannel('email', { host: 'smtp.example.com' }, true))
      .rejects.toThrow(/SMTP port is required/);
    await expect(channels.createChannel('carrier-pigeon', {}, true))
      .rejects.toThrow(/Unsupported channel type/);
  });

  it('updates fields while preserving an unsubmitted secret', async () => {
    const [existing] = await db.select().from(notificationChannels).all();
    const updated = await channels.updateChannel(existing!.id, { host: 'mail.example.com' });
    expect(updated.config.host?.value).toBe('mail.example.com');

    // The preserved secret still decrypts for delivery.
    const provider = await channels.getChannelProvider(existing!.id);
    expect(provider).not.toBeNull();

    const replaced = await channels.updateChannel(existing!.id, { pass: 'rotated-password' });
    expect(replaced.config.pass?.value).not.toContain('rotated-password');
  });

  it('toggles and deletes channels, erroring on unknown ids', async () => {
    const telegram = await channels.createChannel('telegram', { botToken: 't', chatId: '1' }, false);

    let providers = await channels.getEnabledChannelProviders();
    expect(providers.map(({ type }) => type)).toEqual(['email']);

    await channels.setChannelEnabled(telegram.id, true);
    providers = await channels.getEnabledChannelProviders();
    expect(providers.map(({ type }) => type).sort()).toEqual(['email', 'telegram']);

    await channels.deleteChannel(telegram.id);
    await expect(channels.deleteChannel(telegram.id)).rejects.toThrow(/not found/);
    await expect(channels.setChannelEnabled(telegram.id, true)).rejects.toThrow(/not found/);
  });
});
