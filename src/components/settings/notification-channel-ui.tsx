import type { LucideIcon } from 'lucide-react';
import { BellRing, Mail, Send } from 'lucide-react';

export interface ChannelDisplayConfig {
  value: string;
  masked: boolean;
  isSecret: boolean;
}

export interface ChannelSummary {
  id: string;
  type: string;
  enabled: boolean;
  config: Record<string, ChannelDisplayConfig>;
  createdAt: string;
  updatedAt: string;
}

interface NotificationChannelMeta {
  description: string;
  iconLabel: string;
  label: string;
  selectorHint: string;
  Icon: LucideIcon;
}

const FALLBACK_META: NotificationChannelMeta = {
  description: 'Operator-managed notification delivery.',
  iconLabel: 'Notification provider',
  label: 'Notification channel',
  selectorHint: 'Choose how NAD should deliver notifications.',
  Icon: BellRing,
};

export const NOTIFICATION_CHANNEL_META: Record<string, NotificationChannelMeta> = {
  email: {
    description: 'Send notifications through an SMTP mailbox that NAD controls.',
    iconLabel: 'Email provider',
    label: 'Email (SMTP)',
    selectorHint: 'Use your SMTP host, account, and sender address for email delivery.',
    Icon: Mail,
  },
  telegram: {
    description: 'Send notifications to a Telegram chat through a bot token that NAD stores encrypted.',
    iconLabel: 'Telegram provider',
    label: 'Telegram',
    selectorHint: 'Use a BotFather token and the chat ID that should receive alerts.',
    Icon: Send,
  },
  ntfy: {
    description: 'Publish notifications to an ntfy topic on ntfy.sh or your own ntfy server.',
    iconLabel: 'ntfy provider',
    label: 'ntfy',
    selectorHint: 'Use the server URL, topic, and optional bearer token for ntfy delivery.',
    Icon: BellRing,
  },
};

export function getNotificationChannelMeta(type: string): NotificationChannelMeta {
  return NOTIFICATION_CHANNEL_META[type] ?? FALLBACK_META;
}

export function getNotificationChannelTitle(channel: ChannelSummary): string {
  const base = getNotificationChannelMeta(channel.type).label;
  if (channel.type === 'email' && channel.config.from) return `${base} · ${channel.config.from.value}`;
  if (channel.type === 'telegram' && channel.config.chatId) return `${base} · chat ${channel.config.chatId.value}`;
  if (channel.type === 'ntfy' && channel.config.topic) return `${base} · ${channel.config.topic.value}`;
  return base;
}

export function getNotificationChannelConfigSummary(channel: ChannelSummary): string {
  if (channel.type === 'email') {
    const from = channel.config.from?.value;
    const to = channel.config.to?.value;
    const host = channel.config.host?.value;

    if (from && to) return `From ${from} to ${to}${host ? ` through ${host}` : ''}.`;
    if (from) return `From ${from}${host ? ` through ${host}` : ''}.`;
    if (host) return `SMTP host ${host}.`;
  }

  if (channel.type === 'telegram') {
    const chatId = channel.config.chatId?.value;
    return chatId ? `Delivers to Telegram chat ${chatId}.` : 'Delivers to a Telegram chat.';
  }

  if (channel.type === 'ntfy') {
    const topic = channel.config.topic?.value;
    const serverUrl = channel.config.serverUrl?.value;
    if (topic && serverUrl) return `Publishes to topic ${topic} on ${serverUrl}.`;
    if (topic) return `Publishes to topic ${topic}.`;
    if (serverUrl) return `Publishes through ${serverUrl}.`;
  }

  return getNotificationChannelMeta(channel.type).description;
}

export function getNotificationChannelStateText(channel: ChannelSummary): string {
  return channel.enabled
    ? 'Enabled for notification delivery.'
    : 'Saved but disabled.';
}
