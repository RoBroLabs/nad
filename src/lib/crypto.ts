// =============================================================================
// Crypto Utilities — Secret Encryption/Decryption
// =============================================================================
// Used to encrypt module config secrets (API keys, tokens) at rest in the DB.
// Uses AES-256-GCM with a key derived from the APP_SECRET env var.
//
// These functions run SERVER-SIDE ONLY — never import this in client components.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT = 'homedashboard-secret-salt'; // Static salt — key derivation uses APP_SECRET

/**
 * Derives a 256-bit encryption key from the APP_SECRET environment variable.
 * Throws if APP_SECRET is not set or is the default placeholder.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.APP_SECRET;

  if (!secret || secret === 'change-me-to-a-random-string') {
    throw new Error(
      'APP_SECRET is not configured. Set a random string in your .env.local file. ' +
      'Generate one with: openssl rand -base64 32'
    );
  }

  return scryptSync(secret, SALT, 32);
}

/**
 * Encrypts a plaintext string.
 * Returns a string in the format: iv:encrypted:authTag (all hex-encoded).
 *
 * @param plaintext - The secret value to encrypt (e.g., an API key)
 * @returns Encrypted string safe for database storage
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:ciphertext:authTag
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
}

/**
 * Decrypts a previously encrypted string.
 *
 * @param encryptedValue - The encrypted string (iv:ciphertext:authTag format)
 * @returns The original plaintext value
 * @throws If the value cannot be decrypted (wrong key, corrupted data, etc.)
 */
export function decrypt(encryptedValue: string): string {
  const key = getEncryptionKey();

  const parts = encryptedValue.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format. Expected iv:ciphertext:authTag');
  }

  const [ivHex, encrypted, authTagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Masks a secret value for display in the UI.
 * Shows the first 4 and last 4 characters with dots in between.
 * Returns '••••••••' if the value is too short to mask safely.
 *
 * @param value - The plaintext secret value
 * @returns Masked string (e.g., "abc1••••••••xyz9")
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '••••••••';
  }
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(value.length - 8, 12))}${value.slice(-4)}`;
}
