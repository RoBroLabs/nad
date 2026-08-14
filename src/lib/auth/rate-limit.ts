import { isIP } from 'node:net';

interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}

const entries = new Map<string, RateLimitEntry>();
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  /**
   * True only on the single request that exhausts the allowance — the point
   * at which subsequent requests start being rejected. Lets callers react to
   * lockouts exactly once per window instead of on every rejected retry.
   */
  becameBlocked?: boolean;
}

export function getClientAddress(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp && isIP(realIp)) return realIp;

  const forwardedAddresses = request.headers
    .get('x-forwarded-for')
    ?.split(',')
    .slice(-32)
    .map((address) => address.trim());
  if (forwardedAddresses) {
    for (let index = forwardedAddresses.length - 1; index >= 0; index -= 1) {
      const address = forwardedAddresses[index];
      if (address && isIP(address)) return address;
    }
  }

  return 'unknown';
}

export function consumeRateLimit(
  key: string,
  maximumAttempts: number,
  windowMs: number,
): RateLimitResult {
  const timestamp = Date.now();
  const existing = entries.get(key);
  if (!existing || existing.resetAt <= timestamp) {
    entries.set(key, { attempts: 1, resetAt: timestamp + windowMs });
    pruneEntries(timestamp);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.attempts >= maximumAttempts) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - timestamp) / 1000)),
    };
  }

  existing.attempts += 1;
  if (existing.attempts === maximumAttempts) {
    return { allowed: true, retryAfterSeconds: 0, becameBlocked: true };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimit(key: string): void {
  entries.delete(key);
}

function pruneEntries(timestamp: number): void {
  if (entries.size <= MAX_TRACKED_KEYS) return;
  for (const [key, entry] of entries) {
    if (entry.resetAt <= timestamp) entries.delete(key);
  }
  while (entries.size > MAX_TRACKED_KEYS) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    entries.delete(oldestKey);
  }
}
