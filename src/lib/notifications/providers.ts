// =============================================================================
// Notification Providers — Channel config schemas, validation, construction
// =============================================================================
// Each notification channel type declares the fields the Settings UI renders
// and the server validates, mirroring the module configSchema pattern. Secret
// fields (SMTP passwords, bot tokens) are encrypted at rest as part of the
// channel's encrypted JSON config and masked in every display response.
// =============================================================================

import type { NotificationProvider } from './index';
import { createEmailProvider } from './email';
import { createNtfyProvider } from './ntfy';
import { createTelegramProvider } from './telegram';

export type NotificationChannelType = 'email' | 'telegram' | 'ntfy';

export const NOTIFICATION_CHANNEL_TYPES: NotificationChannelType[] = ['email', 'telegram', 'ntfy'];

export interface ChannelField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'number' | 'boolean';
  required: boolean;
  placeholder?: string;
  description?: string;
}

export const CHANNEL_SCHEMAS: Record<NotificationChannelType, ChannelField[]> = {
  email: [
    {
      key: 'host',
      label: 'SMTP host',
      type: 'text',
      required: true,
      placeholder: 'smtp.example.com',
    },
    {
      key: 'port',
      label: 'SMTP port',
      type: 'number',
      required: true,
      placeholder: '587',
      description: 'Implicit TLS is assumed on port 465, STARTTLS otherwise.',
    },
    {
      key: 'user',
      label: 'Username',
      type: 'text',
      required: true,
    },
    {
      key: 'pass',
      label: 'Password',
      type: 'secret',
      required: true,
      description: 'Encrypted at rest; never returned to the browser.',
    },
    {
      key: 'from',
      label: 'From address',
      type: 'text',
      required: true,
      placeholder: 'dashboard@example.com',
    },
    {
      key: 'to',
      label: 'Recipient address',
      type: 'text',
      required: false,
      description: 'Defaults to the from address when empty.',
    },
    {
      key: 'secure',
      label: 'Implicit TLS',
      type: 'boolean',
      required: false,
      description: 'Enable for port 465-style implicit TLS; leave off for STARTTLS.',
    },
  ],
  telegram: [
    {
      key: 'botToken',
      label: 'Bot token',
      type: 'secret',
      required: true,
      description: 'From @BotFather. Encrypted at rest; never returned to the browser.',
    },
    {
      key: 'chatId',
      label: 'Chat ID',
      type: 'text',
      required: true,
      placeholder: '123456789',
      description: 'Personal or group chat ID the bot should post to.',
    },
  ],
  ntfy: [
    {
      key: 'serverUrl',
      label: 'Server URL',
      type: 'text',
      required: true,
      placeholder: 'https://ntfy.sh',
      description: 'ntfy.sh or your self-hosted ntfy server — no credentials in the URL.',
    },
    {
      key: 'topic',
      label: 'Topic',
      type: 'text',
      required: true,
      placeholder: 'nad-alerts',
      description: 'Letters, numbers, dashes, and underscores only. Treat the topic as unguessable when no token is set.',
    },
    {
      key: 'token',
      label: 'Access token',
      type: 'secret',
      required: false,
      description: 'Optional bearer token for protected topics. Encrypted at rest; never returned to the browser.',
    },
  ],
};

const MAX_FIELD_LENGTH = 1_024;

export interface ChannelValidationResult {
  valid: boolean;
  error?: string;
  /** Normalised config: numbers/booleans coerced to strings for storage. */
  values: Record<string, string>;
}

/**
 * Validates a channel config against its schema. When `partial` is true
 * (updates), missing fields are skipped so the caller can merge them with the
 * stored config; required-secret enforcement then happens against the merged
 * result via `validateMergedChannelConfig`.
 */
export function validateChannelConfig(
  type: string,
  config: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {},
): ChannelValidationResult {
  if (!NOTIFICATION_CHANNEL_TYPES.includes(type as NotificationChannelType)) {
    return { valid: false, error: 'Unsupported channel type.', values: {} };
  }

  const schema = CHANNEL_SCHEMAS[type as NotificationChannelType];
  const values: Record<string, string> = {};

  for (const field of schema) {
    const raw = config[field.key];
    if (raw === undefined || raw === null || raw === '') {
      if (!partial && field.required) {
        return { valid: false, error: `${field.label} is required.`, values: {} };
      }
      continue;
    }

    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
      return { valid: false, error: `${field.label} has an invalid value.`, values: {} };
    }
    const value = String(raw).trim();
    if (value.length > MAX_FIELD_LENGTH) {
      return { valid: false, error: `${field.label} is too long.`, values: {} };
    }

    if (value && field.type === 'number') {
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65_535) {
        return { valid: false, error: `${field.label} must be a port between 1 and 65535.`, values: {} };
      }
    }
    if (value && field.type === 'boolean' && value !== 'true' && value !== 'false') {
      return { valid: false, error: `${field.label} must be enabled or disabled.`, values: {} };
    }
    if (value && field.key === 'host' && !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(value)) {
      return { valid: false, error: `${field.label} must be a valid hostname.`, values: {} };
    }
    if (value && (field.key === 'from' || field.key === 'to') && !value.includes('@')) {
      return { valid: false, error: `${field.label} must be an email address.`, values: {} };
    }
    if (value && field.key === 'serverUrl') {
      let parsed: URL | null = null;
      try {
        parsed = new URL(value);
      } catch {
        parsed = null;
      }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
        return { valid: false, error: `${field.label} must be an HTTP(S) URL without embedded credentials.`, values: {} };
      }
    }
    if (value && field.key === 'topic' && !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
      return { valid: false, error: `${field.label} may only contain letters, numbers, dashes, and underscores (max 64).`, values: {} };
    }

    values[field.key] = value;
  }

  return { valid: true, values };
}

/** Ensures a merged create/update result still satisfies every required field. */
export function validateMergedChannelConfig(
  type: NotificationChannelType,
  merged: Record<string, string>,
): string | null {
  for (const field of CHANNEL_SCHEMAS[type]) {
    if (field.required && !merged[field.key]) {
      return `${field.label} is required.`;
    }
  }
  return null;
}

/** Fields that must be encrypted at rest and masked for display. */
export function channelSecretKeys(type: NotificationChannelType): Set<string> {
  return new Set(
    CHANNEL_SCHEMAS[type].filter(({ type: fieldType }) => fieldType === 'secret').map(({ key }) => key),
  );
}

/**
 * Builds a ready-to-send provider from a validated channel config.
 * Returns null when the type has no provider implementation.
 */
export function createProviderFromConfig(
  type: string,
  config: Record<string, string>,
): NotificationProvider | null {
  switch (type) {
    case 'email':
      return createEmailProvider(config);
    case 'telegram':
      return createTelegramProvider(config);
    case 'ntfy':
      return createNtfyProvider(config);
    default:
      return null;
  }
}
