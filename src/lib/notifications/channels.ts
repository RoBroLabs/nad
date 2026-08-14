// =============================================================================
// Notification Channels — Database CRUD with encrypted configuration
// =============================================================================
// Channel configs are stored as a single encrypted JSON document in
// notification_channels.config (AES-256-GCM, key derived from APP_SECRET).
// Display paths return per-field masks for secrets; delivery paths decrypt
// server-side only.
// =============================================================================

import 'server-only';

import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { notificationChannels } from '@/lib/db/schema';
import { decrypt, encrypt, maskSecret } from '@/lib/crypto';
import { generateId, now, safeJsonParse } from '@/lib/utils';
import type { NotificationProvider } from './index';
import {
  channelSecretKeys,
  createProviderFromConfig,
  validateChannelConfig,
  validateMergedChannelConfig,
} from './providers';
import type { NotificationChannelType } from './providers';

export interface ChannelDisplayConfig {
  value: string;
  masked: boolean;
  isSecret: boolean;
}

export interface ChannelSummary {
  id: string;
  type: NotificationChannelType;
  enabled: boolean;
  config: Record<string, ChannelDisplayConfig>;
  createdAt: string;
  updatedAt: string;
}

export class ChannelError extends Error {
  readonly code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'DELIVERY_FAILED';

  constructor(code: ChannelError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

function decryptChannelConfig(encryptedConfig: string): Record<string, string> {
  try {
    return safeJsonParse<Record<string, string>>(decrypt(encryptedConfig)) ?? {};
  } catch {
    // APP_SECRET rotation invalidates stored channels; treat them as empty so
    // listing keeps working and the operator can re-enter the secrets.
    return {};
  }
}

function toSummary(record: typeof notificationChannels.$inferSelect): ChannelSummary {
  const config = decryptChannelConfig(record.config);
  const secrets = channelSecretKeys(record.type as NotificationChannelType);
  const display: Record<string, ChannelDisplayConfig> = {};

  for (const [key, value] of Object.entries(config)) {
    display[key] = secrets.has(key)
      ? { value: maskSecret(value), masked: true, isSecret: true }
      : { value, masked: false, isSecret: false };
  }

  return {
    id: record.id,
    type: record.type as NotificationChannelType,
    enabled: record.enabled,
    config: display,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listChannels(): Promise<ChannelSummary[]> {
  const records = await db
    .select()
    .from(notificationChannels)
    .orderBy(asc(notificationChannels.type), asc(notificationChannels.createdAt))
    .all();
  return records.map(toSummary);
}

export async function getChannelSummary(id: string): Promise<ChannelSummary | null> {
  const record = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .get();
  return record ? toSummary(record) : null;
}

export async function createChannel(
  type: string,
  config: Record<string, unknown>,
  enabled: boolean,
): Promise<ChannelSummary> {
  const validation = validateChannelConfig(type, config);
  if (!validation.valid) {
    throw new ChannelError('VALIDATION_ERROR', validation.error ?? 'Invalid channel configuration.');
  }

  const timestamp = now();
  const id = generateId();
  await db.insert(notificationChannels).values({
    id,
    type: type as NotificationChannelType,
    config: encrypt(JSON.stringify(validation.values)),
    enabled,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();

  const summary = await getChannelSummary(id);
  if (!summary) throw new Error('Channel missing after insert.');
  return summary;
}

/**
 * Updates a channel. Submitted fields replace stored ones, except empty
 * secret values, which keep the stored secret so edits never require
 * re-entering credentials.
 */
export async function updateChannel(
  id: string,
  config: Record<string, unknown>,
): Promise<ChannelSummary> {
  const existing = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .get();
  if (!existing) throw new ChannelError('NOT_FOUND', 'Notification channel not found.');

  const validation = validateChannelConfig(existing.type, config, { partial: true });
  if (!validation.valid) {
    throw new ChannelError('VALIDATION_ERROR', validation.error ?? 'Invalid channel configuration.');
  }

  const stored = decryptChannelConfig(existing.config);
  const secrets = channelSecretKeys(existing.type as NotificationChannelType);
  const merged: Record<string, string> = { ...stored };
  for (const [key, value] of Object.entries(validation.values)) {
    if (secrets.has(key) && !value) continue;
    merged[key] = value;
  }

  const mergedError = validateMergedChannelConfig(
    existing.type as NotificationChannelType,
    merged,
  );
  if (mergedError) throw new ChannelError('VALIDATION_ERROR', mergedError);

  await db.update(notificationChannels)
    .set({ config: encrypt(JSON.stringify(merged)), updatedAt: now() })
    .where(eq(notificationChannels.id, id))
    .run();

  const summary = await getChannelSummary(id);
  if (!summary) throw new ChannelError('NOT_FOUND', 'Notification channel not found.');
  return summary;
}

export async function setChannelEnabled(id: string, enabled: boolean): Promise<void> {
  const result = await db.update(notificationChannels)
    .set({ enabled, updatedAt: now() })
    .where(eq(notificationChannels.id, id))
    .run();
  if (result.changes === 0) throw new ChannelError('NOT_FOUND', 'Notification channel not found.');
}

export async function deleteChannel(id: string): Promise<void> {
  const result = await db
    .delete(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .run();
  if (result.changes === 0) throw new ChannelError('NOT_FOUND', 'Notification channel not found.');
}

/** Builds a provider for one channel, decrypting its config server-side. */
export async function getChannelProvider(id: string): Promise<NotificationProvider | null> {
  const record = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .get();
  if (!record) return null;
  return createProviderFromConfig(record.type, decryptChannelConfig(record.config));
}

/** Builds providers for every enabled channel, in deterministic order. */
export async function getEnabledChannelProviders(): Promise<NotificationProvider[]> {
  const records = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.enabled, true))
    .orderBy(asc(notificationChannels.createdAt))
    .all();

  return records
    .map((record) => createProviderFromConfig(record.type, decryptChannelConfig(record.config)))
    .filter((provider): provider is NotificationProvider => provider !== null);
}
