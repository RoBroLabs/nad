import { describe, expect, it, vi } from 'vitest';
import {
  channelSecretKeys,
  createProviderFromConfig,
  validateChannelConfig,
  validateMergedChannelConfig,
} from '@/lib/notifications/providers';
import type { Notification } from '@/lib/notifications';

const notification: Notification = {
  title: 'Test "alert" <here>',
  message: 'Something happened.',
  severity: 'warning',
  timestamp: '2026-08-06T12:00:00.000Z',
};

describe('validateChannelConfig', () => {
  it('accepts a complete email config', () => {
    const result = validateChannelConfig('email', {
      host: 'smtp.example.com',
      port: 587,
      user: 'nad',
      pass: 'secret-value',
      from: 'nad@example.com',
    });
    expect(result.valid).toBe(true);
    expect(result.values).toMatchObject({ host: 'smtp.example.com', port: '587' });
  });

  it('rejects unsupported types, bad ports, hosts, and addresses', () => {
    expect(validateChannelConfig('discord', {}).error).toMatch(/Unsupported/);
    expect(validateChannelConfig('email', { host: 'smtp.example.com', port: 70000, user: 'u', pass: 'p', from: 'a@b.c' }).error)
      .toMatch(/port/);
    expect(validateChannelConfig('email', { host: 'not a host!', port: 25, user: 'u', pass: 'p', from: 'a@b.c' }).error)
      .toMatch(/hostname/);
    expect(validateChannelConfig('email', { host: 'smtp.example.com', port: 25, user: 'u', pass: 'p', from: 'not-an-email' }).error)
      .toMatch(/email address/);
  });

  it('enforces required fields on create but not on partial update', () => {
    expect(validateChannelConfig('telegram', { chatId: '42' }).error).toMatch(/Bot token is required/);
    const partial = validateChannelConfig('telegram', { chatId: '42' }, { partial: true });
    expect(partial.valid).toBe(true);
    expect(partial.values).toEqual({ chatId: '42' });
  });

  it('rejects overlong and non-scalar values', () => {
    expect(validateChannelConfig('telegram', { botToken: 'x'.repeat(2_000), chatId: '1' }).error)
      .toMatch(/too long/);
    expect(validateChannelConfig('telegram', { botToken: ['x'], chatId: '1' }).error)
      .toMatch(/invalid value/);
  });

  it('validates ntfy server URL, topic, and optional token', () => {
    expect(validateChannelConfig('ntfy', {
      serverUrl: 'https://ntfy.sh', topic: 'nad-alerts',
    }).valid).toBe(true);

    expect(validateChannelConfig('ntfy', { serverUrl: 'ftp://ntfy.sh', topic: 'nad' }).error)
      .toMatch(/HTTP\(S\) URL/);
    expect(validateChannelConfig('ntfy', { serverUrl: 'https://user:pass@ntfy.sh', topic: 'nad' }).error)
      .toMatch(/credentials/);
    expect(validateChannelConfig('ntfy', { serverUrl: 'https://ntfy.sh', topic: 'has spaces' }).error)
      .toMatch(/letters, numbers, dashes/);
    expect(validateChannelConfig('ntfy', { topic: 'nad' }).error).toMatch(/Server URL is required/);
  });
});

describe('validateMergedChannelConfig', () => {
  it('flags required fields missing after a merge', () => {
    expect(validateMergedChannelConfig('telegram', { chatId: '42' })).toMatch(/Bot token is required/);
    expect(validateMergedChannelConfig('telegram', { botToken: 't', chatId: '42' })).toBeNull();
  });
});

describe('channelSecretKeys', () => {
  it('identifies secret fields per type', () => {
    expect([...channelSecretKeys('email')]).toEqual(['pass']);
    expect([...channelSecretKeys('telegram')]).toEqual(['botToken']);
    expect([...channelSecretKeys('ntfy')]).toEqual(['token']);
  });
});

describe('createProviderFromConfig', () => {
  it('returns null for unknown types and incomplete configs', () => {
    expect(createProviderFromConfig('discord', {})).toBeNull();
    expect(createProviderFromConfig('ntfy', {})).toBeNull();
    expect(createProviderFromConfig('telegram', { botToken: '', chatId: '' })).toBeNull();
  });

  it('sends telegram messages with the configured token, chat, and escaping', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const provider = createProviderFromConfig('telegram', { botToken: 'token123', chatId: '99' });
    expect(provider).not.toBeNull();

    // Inject the stub via the config-aware factory.
    const { createTelegramProvider } = await import('@/lib/notifications/telegram');
    const stubbed = createTelegramProvider({ botToken: 'token123', chatId: '99' }, fetchMock);
    await stubbed?.send(notification);

    expect(provider).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottoken123/sendMessage');
    const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(body.chat_id).toBe('99');
    // Telegram MarkdownV2 escapes `>` but not `<` or `"`.
    expect(body.text).toContain('Test "alert" <here\\>');
  });

  it('throws a sanitised error when telegram rejects the message', async () => {
    const { createTelegramProvider } = await import('@/lib/notifications/telegram');
    const fetchMock = vi.fn(async () => new Response('denied', { status: 403 }));
    const provider = createTelegramProvider({ botToken: 'token123', chatId: '99' }, fetchMock);
    await expect(provider?.send(notification)).rejects.toThrow(/HTTP 403/);
  });

  it('publishes to ntfy with token auth, priority, tag, and a header-safe title', async () => {
    const { createNtfyProvider } = await import('@/lib/notifications/ntfy');
    const fetchMock = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    const provider = createNtfyProvider({
      serverUrl: 'https://ntfy.example.test/',
      topic: 'nad-alerts',
      token: 'tk_secret',
    }, fetchMock);

    expect(provider).not.toBeNull();
    await provider?.send({ ...notification, severity: 'critical' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ntfy.example.test/nad-alerts');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tk_secret');
    expect(headers.Priority).toBe('5');
    expect(headers.Tags).toBe('rotating_light');
    // The notification title contains a double quote but no control characters.
    expect(headers.Title).toBe('Test "alert" <here>');
    expect(String(init.body)).toContain('Something happened.');

    await expect(provider?.test?.()).resolves.toBe(true);
  });

  it('omits the Authorization header without a token and sanitises ntfy errors', async () => {
    const { createNtfyProvider } = await import('@/lib/notifications/ntfy');
    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const provider = createNtfyProvider({ serverUrl: 'https://ntfy.sh', topic: 't' }, fetchMock);

    await expect(provider?.send(notification)).rejects.toThrow(/HTTP 403/);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends email through the configured transport with escaped HTML', async () => {
    const { createEmailProvider } = await import('@/lib/notifications/email');
    const sendMail = vi.fn(async (message: { from: string; to: string; html: string; subject: string }) => {
      void message;
      return {};
    });
    const verify = vi.fn(async () => true);
    const transporter = { sendMail, verify } as never;

    const provider = createEmailProvider({
      host: 'smtp.example.com',
      port: '587',
      user: 'nad',
      pass: 'secret',
      from: 'from@example.com',
      to: 'alerts@example.com',
    }, transporter);

    await provider?.send(notification);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.from).toBe('from@example.com');
    expect(message?.to).toBe('alerts@example.com');
    expect(message?.html).toContain('Test &quot;alert&quot; &lt;here&gt;');
    expect(message?.html).not.toContain('<here>');

    await expect(provider?.test()).resolves.toBe(true);
  });

  it('closes and rejects an SMTP operation that does not settle within its deadline', async () => {
    vi.useFakeTimers();
    const sendMail = vi.fn(() => new Promise<never>(() => undefined));
    const verify = vi.fn(() => new Promise<never>(() => undefined));
    const close = vi.fn();
    const transporter = { sendMail, verify, close } as never;
    const { createEmailProvider } = await import('@/lib/notifications/email');
    const provider = createEmailProvider({
      host: 'smtp.example.com',
      port: '587',
      user: 'nad',
      pass: 'secret',
      from: 'from@example.com',
    }, transporter);

    try {
      const sendResult = expect(provider?.send(notification)).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(6_000);
      await sendResult;
      expect(close).toHaveBeenCalledOnce();

      const testResult = expect(provider?.test()).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(6_000);
      await testResult;
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
