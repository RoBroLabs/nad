// =============================================================================
// ntfy Notification Provider — ntfy.sh or self-hosted ntfy server
// =============================================================================
// Configuration comes from the channel's validated, decrypted database config
// (see providers.ts for the schema). The access token never leaves the server.
//
// See https://docs.ntfy.sh/publish/ for the plain-HTTP publish API used here.
// =============================================================================

import type { Notification, NotificationProvider } from './index';

const SEVERITY_TAG: Record<string, string> = {
  info: 'information_source',
  warning: 'warning',
  critical: 'rotating_light',
};

const SEVERITY_PRIORITY: Record<string, string> = {
  info: '3',
  warning: '4',
  critical: '5',
};

/** Header values must stay single-line and header-safe. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n\x00-\x1f]+/g, ' ').slice(0, 200);
}

/**
 * Creates an ntfy notification provider from a validated channel config.
 * The fetch implementation can be injected for tests.
 */
export function createNtfyProvider(
  config: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): NotificationProvider | null {
  const serverUrl = config.serverUrl?.replace(/\/+$/, '');
  const topic = config.topic;
  const token = config.token;

  if (!serverUrl || !topic) {
    return null;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const publishUrl = `${serverUrl}/${encodeURIComponent(topic)}`;

  return {
    type: 'ntfy',

    async send(notification: Notification): Promise<void> {
      const body = [
        notification.message,
        '',
        `Severity: ${notification.severity}${notification.moduleSlug ? ` · Plugin: ${notification.moduleSlug}` : ''}`,
        `Time: ${notification.timestamp}`,
      ].join('\n');

      const response = await fetchFn(publishUrl, {
        method: 'POST',
        headers: {
          ...headers,
          Title: headerSafe(notification.title),
          Priority: SEVERITY_PRIORITY[notification.severity] ?? '3',
          Tags: SEVERITY_TAG[notification.severity] ?? SEVERITY_TAG.info ?? 'information_source',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`ntfy rejected the message (HTTP ${response.status}).`);
      }
    },

    async test(): Promise<boolean> {
      try {
        const response = await fetchFn(`${serverUrl}/v1/health`, {
          headers,
          signal: AbortSignal.timeout(5_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
