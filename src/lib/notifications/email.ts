// =============================================================================
// Email Notification Provider — Nodemailer SMTP
// =============================================================================
// Configuration comes from the channel's validated, decrypted database config
// (see providers.ts for the schema). Secrets never leave the server.
// =============================================================================

import { createTransport, type Transporter } from 'nodemailer';
import type { Notification, NotificationProvider } from './index';

const SEVERITY_EMOJI: Record<string, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🚨',
};

const SMTP_OPERATION_TIMEOUT_MS = 6_000;

async function withTransportDeadline<T>(
  operation: Promise<T>,
  transport: Transporter,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      try {
        transport.close();
      } catch {
        // Closing a failed test/injected transport is best-effort.
      }
      reject(new Error('Email provider operation timed out.'));
    }, SMTP_OPERATION_TIMEOUT_MS);
    timeoutHandle.unref();
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Creates an email notification provider from a validated channel config.
 * Implicit TLS defaults to port 465 unless the `secure` field overrides it;
 * the recipient defaults to the from address.
 *
 * A pre-built transporter can be injected for tests.
 */
export function createEmailProvider(
  config: Record<string, string>,
  transporter?: Transporter,
): NotificationProvider | null {
  const host = config.host;
  const port = Number(config.port ?? '587');
  const user = config.user;
  const pass = config.pass;
  const from = config.from;
  const to = config.to || from;
  const secure = config.secure ? config.secure === 'true' : port === 465;

  if (!host || !user || !pass || !from) {
    return null;
  }

  const transport = transporter ?? createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: SMTP_OPERATION_TIMEOUT_MS,
  });

  return {
    type: 'email',

    async send(notification: Notification): Promise<void> {
      const emoji = SEVERITY_EMOJI[notification.severity] ?? '';
      const subject = `${emoji} ${notification.title}`;

      const html = buildEmailHtml(notification);

      await withTransportDeadline(transport.sendMail({
        from,
        to,
        subject,
        html,
        text: `${notification.title}\n\n${notification.message}\n\nSeverity: ${notification.severity}\nTime: ${notification.timestamp}`,
      }), transport);
    },

    async test(): Promise<boolean> {
      try {
        await withTransportDeadline(transport.verify(), transport);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Builds a simple HTML email body.
 */
function buildEmailHtml(notification: Notification): string {
  const severityColor: Record<string, string> = {
    info: '#3b82f6',
    warning: '#f59e0b',
    critical: '#ef4444',
  };

  const color = severityColor[notification.severity] ?? '#6b7280';
  const title = escapeHtml(notification.title);
  const message = escapeHtml(notification.message).replaceAll('\n', '<br>');
  const moduleSlug = notification.moduleSlug ? escapeHtml(notification.moduleSlug) : undefined;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="border-left: 4px solid ${color}; padding: 16px; background-color: #f9fafb; border-radius: 4px;">
        <h2 style="margin: 0 0 8px 0; color: #111827; font-size: 18px;">
          ${title}
        </h2>
        <p style="margin: 0 0 12px 0; color: #374151; font-size: 14px; line-height: 1.5;">
          ${message}
        </p>
        <div style="font-size: 12px; color: #6b7280;">
          ${moduleSlug ? `Plugin: ${moduleSlug} · ` : ''}
          Severity: ${notification.severity} ·
          ${new Date(notification.timestamp).toLocaleString()}
        </div>
      </div>
      <p style="font-size: 11px; color: #9ca3af; margin-top: 16px; text-align: center;">
        Sent by NAD
      </p>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character);
}
