// =============================================================================
// Notification System — Provider Interface & Dispatcher
// =============================================================================
// Channels are configured by administrators in Settings → Notifications and
// stored with encrypted configuration. The dispatcher loads enabled channels
// from the database at dispatch time, so configuration changes take effect
// immediately with no startup registration step.
// =============================================================================

import 'server-only';

import { getChannelProvider, getEnabledChannelProviders } from './channels';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface Notification {
  title: string;
  message: string;
  severity: NotificationSeverity;
  /** Module that triggered the notification */
  moduleSlug?: string;
  /** Additional metadata */
  meta?: Record<string, string>;
  timestamp: string;
}

/**
 * Interface that all notification providers must implement.
 * Add new providers (Discord, Ntfy, etc.) by implementing this interface,
 * declaring a schema in providers.ts, and extending createProviderFromConfig.
 */
export interface NotificationProvider {
  /** Provider identifier (e.g., 'email', 'telegram') */
  type: string;
  /** Send a notification through this provider */
  send(notification: Notification): Promise<void>;
  /** Test the provider configuration (returns true if working) */
  test(): Promise<boolean>;
}

function buildNotification(
  title: string,
  message: string,
  severity: NotificationSeverity,
  moduleSlug?: string,
): Notification {
  return {
    title: title.slice(0, 500),
    message: message.slice(0, 8_000),
    severity,
    moduleSlug,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Sends a notification to every enabled channel. Failures in individual
 * channels are logged but don't prevent delivery to others. With no enabled
 * channels the notification is dropped by design.
 */
export async function notify(
  title: string,
  message: string,
  severity: NotificationSeverity = 'info',
  moduleSlug?: string,
): Promise<void> {
  const providers = await getEnabledChannelProviders();
  if (providers.length === 0) {
    console.warn('[notifications] No enabled channels, notification dropped:', title);
    return;
  }

  const notification = buildNotification(title, message, severity, moduleSlug);

  const results = await Promise.allSettled(
    providers.map((provider) => provider.send(notification)),
  );

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.error(
      `[notifications] ${failures.length}/${providers.length} channels failed for: ${title}`,
    );
  }
}

/**
 * Sends a bounded test notification through a single configured channel.
 * Throws with a sanitised message when the channel is unknown or delivery
 * fails — callers surface this to the administrator testing the channel.
 */
export async function sendChannelTestNotification(channelId: string): Promise<void> {
  const provider = await getChannelProvider(channelId);
  if (!provider) {
    throw new Error('Notification channel not found or incomplete.');
  }

  const notification = buildNotification(
    'NAD test notification',
    'Your NAD notification channel is configured correctly.',
    'info',
  );

  await provider.send(notification);
}
