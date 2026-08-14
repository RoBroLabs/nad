// =============================================================================
// Access Control — Pure URL helpers
// =============================================================================
// Canonical-URL validation and request-origin resolution for the NAD access
// lock. These helpers are side-effect free and safe to unit test; the
// DB-backed enforcement lives in src/lib/access.ts.
// =============================================================================

export type AccessMode = 'off' | 'locked';

const MAX_CANONICAL_URL_LENGTH = 255;

/**
 * Validates and normalises a canonical dashboard URL to its origin.
 * Accepts absolute HTTP(S) origins only — no credentials, path, query, or
 * fragment — so access-lock comparisons are exact. IP:port origins are valid
 * canonical targets. Returns null when the value is unusable.
 */
export function parseCanonicalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CANONICAL_URL_LENGTH) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (!url.hostname) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    if (url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolves the origin the browser used for this request, trusting the
 * reverse-proxy forwarding headers the same way the login page and rate
 * limiter do. Returns undefined when the origin cannot be determined — the
 * caller must fail open rather than guess.
 */
export function getRequestOrigin(headers: Headers): string | undefined {
  const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    ?? headers.get('host');
  const protocol = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
    ?? 'http';
  if (!host || (protocol !== 'http' && protocol !== 'https')) return undefined;

  try {
    const url = new URL(`${protocol}://${host}`);
    if (url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Compares two origins after URL normalisation (case, default ports). */
export function originsMatch(first: string, second: string): boolean {
  try {
    return new URL(first).origin === new URL(second).origin;
  } catch {
    return false;
  }
}
