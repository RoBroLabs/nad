import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotificationsManager } from '@/components/settings/notifications-manager';
import {
  getNotificationChannelConfigSummary,
  getNotificationChannelMeta,
  getNotificationChannelTitle,
  type ChannelSummary,
} from '@/components/settings/notification-channel-ui';
import { CHANNEL_SCHEMAS } from '@/lib/notifications/providers';

const emailChannel: ChannelSummary = {
  id: 'email-1',
  type: 'email',
  enabled: true,
  config: {
    from: { value: 'nad@example.com', masked: false, isSecret: false },
    host: { value: 'smtp.example.com', masked: false, isSecret: false },
    to: { value: 'ops@example.com', masked: false, isSecret: false },
  },
  createdAt: '2026-08-11T12:00:00.000Z',
  updatedAt: '2026-08-11T12:00:00.000Z',
};

const telegramChannel: ChannelSummary = {
  id: 'telegram-1',
  type: 'telegram',
  enabled: false,
  config: {
    botToken: { value: 'to****en', masked: true, isSecret: true },
    chatId: { value: '987654321', masked: false, isSecret: false },
  },
  createdAt: '2026-08-11T12:00:00.000Z',
  updatedAt: '2026-08-11T12:00:00.000Z',
};

describe('notification channel helpers', () => {
  it('returns plain-language provider titles and configuration summaries', () => {
    expect(getNotificationChannelMeta('email').label).toBe('Email (SMTP)');
    expect(getNotificationChannelMeta('ntfy').selectorHint).toContain('server URL');
    expect(getNotificationChannelTitle(emailChannel)).toBe('Email (SMTP) · nad@example.com');
    expect(getNotificationChannelConfigSummary(emailChannel)).toBe(
      'From nad@example.com to ops@example.com through smtp.example.com.',
    );
    expect(getNotificationChannelTitle(telegramChannel)).toBe('Telegram · chat 987654321');
    expect(getNotificationChannelConfigSummary(telegramChannel)).toBe(
      'Delivers to Telegram chat 987654321.',
    );
  });
});

describe('NotificationsManager', () => {
  it('renders supported provider guidance for the empty state', () => {
    const markup = renderToStaticMarkup(
      <NotificationsManager initialChannels={[]} schemas={CHANNEL_SCHEMAS} />,
    );

    expect(markup).toContain('No notification channels yet.');
    expect(markup).toContain('Email (SMTP)');
    expect(markup).toContain('Telegram');
    expect(markup).toContain('ntfy');
    expect(markup).toContain('Add notification channel');
  });

  it('renders provider-specific channel details and accessible action labels', () => {
    const markup = renderToStaticMarkup(
      <NotificationsManager initialChannels={[emailChannel, telegramChannel]} schemas={CHANNEL_SCHEMAS} />,
    );

    expect(markup).toContain('From nad@example.com to ops@example.com through smtp.example.com.');
    expect(markup).toContain('Delivers to Telegram chat 987654321.');
    expect(markup).toContain('Enabled for notification delivery.');
    expect(markup).toContain('Saved but disabled.');
    expect(markup).toContain('aria-label="Delete Email (SMTP) · nad@example.com"');
    expect(markup).toContain('aria-label="Disable Email (SMTP) · nad@example.com"');
    expect(markup).toContain('aria-label="Enable Telegram · chat 987654321"');
  });
});
