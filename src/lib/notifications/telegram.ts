// =============================================================================
// Telegram Notification Provider — Bot API
// =============================================================================
// Configuration comes from the channel's validated, decrypted database config
// (see providers.ts for the schema). The bot token never leaves the server.
//
// To set up:
// 1. Create a bot via @BotFather on Telegram
// 2. Send a message to the bot, then find the chat ID via getUpdates:
//    curl https://api.telegram.org/bot<TOKEN>/getUpdates
// =============================================================================

import type { Notification, NotificationProvider } from './index';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

const SEVERITY_EMOJI: Record<string, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🚨',
};

/**
 * Creates a Telegram notification provider from a validated channel config.
 * The fetch implementation can be injected for tests.
 */
export function createTelegramProvider(
  config: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): NotificationProvider | null {
  const botToken = config.botToken;
  const chatId = config.chatId;

  if (!botToken || !chatId) {
    return null;
  }

  return {
    type: 'telegram',

    async send(notification: Notification): Promise<void> {
      const emoji = SEVERITY_EMOJI[notification.severity] ?? '';
      const text = formatTelegramMessage(notification, emoji);

      const response = await fetchFn(`${TELEGRAM_API_BASE}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Telegram rejected the message (HTTP ${response.status}).`);
      }
    },

    async test(): Promise<boolean> {
      try {
        const response = await fetchFn(`${TELEGRAM_API_BASE}${botToken}/getMe`, {
          signal: AbortSignal.timeout(5_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Formats a notification as a Telegram MarkdownV2 message.
 * MarkdownV2 requires escaping special characters.
 */
function formatTelegramMessage(notification: Notification, emoji: string): string {
  const title = escapeMarkdownV2(notification.title);
  const message = escapeMarkdownV2(notification.message);
  const severity = escapeMarkdownV2(notification.severity);
  const time = escapeMarkdownV2(
    new Date(notification.timestamp).toLocaleString(),
  );

  let text = `${emoji} *${title}*\n\n${message}`;

  if (notification.moduleSlug) {
    const mod = escapeMarkdownV2(notification.moduleSlug);
    text += `\n\n📦 Plugin: \`${mod}\``;
  }

  text += `\n🔸 Severity: ${severity}`;
  text += `\n🕐 ${time}`;

  return text;
}

/**
 * Escapes special characters for Telegram MarkdownV2.
 * See: https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
