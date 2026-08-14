// =============================================================================
// Access Control — Canonical URL resolution and access-lock enforcement
// =============================================================================
// NAD can optionally be locked to a configured canonical URL (for example
// https://dashboard.example.com) instead of answering on every reachable
// IP:port address. The canonical URL is collected during first-run setup and
// managed afterwards in Settings → General. Enforcement modes:
//
//   off    — default. The login page still offers a secure-login handoff when
//            the request origin differs from the canonical URL.
//   locked — page requests from other origins redirect to the canonical URL
//            and API requests receive a JSON 403 (NON_CANONICAL_HOST).
//
// Precedence: the `canonical_url` app setting wins when present; the
// AUTH_URL/APP_URL environment variables remain the deployment default and
// the break-glass override. Edge middleware cannot read SQLite, so all
// enforcement lives in the Node runtime (root layout and route handlers).
// Operational endpoints (/api/health, /api/setup) stay reachable so container
// health checks and first-run recovery can never be locked out.
// =============================================================================

import 'server-only';

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import { now } from '@/lib/utils';
import { getRequestOrigin, originsMatch, parseCanonicalUrl } from '@/lib/access-url';
import type { AccessMode } from '@/lib/access-url';

const CANONICAL_URL_KEY = 'canonical_url';
const ACCESS_MODE_KEY = 'access_mode';

function envCanonicalUrl(): string | undefined {
  const configured = process.env.AUTH_URL ?? process.env.APP_URL;
  if (!configured) return undefined;
  return parseCanonicalUrl(configured) ?? undefined;
}

async function getSetting(key: string): Promise<string | undefined> {
  const row = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return row?.value;
}

/** The canonical URL stored in the database, if one has been saved. */
export async function getStoredCanonicalUrl(): Promise<string | undefined> {
  const stored = await getSetting(CANONICAL_URL_KEY);
  if (!stored) return undefined;
  return parseCanonicalUrl(stored) ?? undefined;
}

/**
 * The canonical URL NAD answers to: the stored setting when present,
 * otherwise the AUTH_URL/APP_URL deployment default.
 */
export async function getEffectiveCanonicalUrl(): Promise<string | undefined> {
  return (await getStoredCanonicalUrl()) ?? envCanonicalUrl();
}

/** The access-lock mode. Absent or unrecognised values mean 'off'. */
export async function getAccessMode(): Promise<AccessMode> {
  return (await getSetting(ACCESS_MODE_KEY)) === 'locked' ? 'locked' : 'off';
}

export interface GeneralSettings {
  /** Normalised canonical URL stored in the database, or null. */
  canonicalUrl: string | null;
  /** Canonical URL supplied by AUTH_URL/APP_URL, or null. */
  envCanonicalUrl: string | null;
  /** The URL enforcement currently uses (stored, else environment). */
  effectiveCanonicalUrl: string | null;
  accessMode: AccessMode;
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const canonicalUrl = await getStoredCanonicalUrl();
  const environment = envCanonicalUrl();
  const accessMode = await getAccessMode();
  return {
    canonicalUrl: canonicalUrl ?? null,
    envCanonicalUrl: environment ?? null,
    effectiveCanonicalUrl: canonicalUrl ?? environment ?? null,
    accessMode,
  };
}

/**
 * Persists the general access settings. A null canonical URL clears the
 * stored row so the environment default applies again.
 */
export async function setGeneralSettings(
  settings: { canonicalUrl: string | null; accessMode: AccessMode },
): Promise<void> {
  const timestamp = now();
  db.transaction((transaction) => {
    const { canonicalUrl } = settings;
    if (canonicalUrl) {
      transaction
        .insert(appSettings)
        .values({ key: CANONICAL_URL_KEY, value: canonicalUrl, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: canonicalUrl, updatedAt: timestamp },
        })
        .run();
    } else {
      transaction
        .delete(appSettings)
        .where(eq(appSettings.key, CANONICAL_URL_KEY))
        .run();
    }

    transaction
      .insert(appSettings)
      .values({ key: ACCESS_MODE_KEY, value: settings.accessMode, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: settings.accessMode, updatedAt: timestamp },
      })
      .run();
  });
}

/**
 * Page-side enforcement for the root layout. Returns the canonical origin the
 * browser must be sent to, or null when the request may proceed. Fails open
 * when either origin cannot be determined so a misconfigured proxy can never
 * create a redirect loop.
 */
export async function getAccessLockRedirect(headers: Headers): Promise<string | null> {
  if ((await getAccessMode()) !== 'locked') return null;
  const canonicalUrl = await getEffectiveCanonicalUrl();
  if (!canonicalUrl) return null;
  const requestOrigin = getRequestOrigin(headers);
  if (!requestOrigin || originsMatch(requestOrigin, canonicalUrl)) return null;
  return canonicalUrl;
}

/**
 * API-side enforcement. Returns a JSON 403 response when the access lock
 * refuses this request, or null when it may proceed.
 */
export async function enforceApiAccessLock(request: Request): Promise<NextResponse | null> {
  if ((await getAccessMode()) !== 'locked') return null;
  const canonicalUrl = await getEffectiveCanonicalUrl();
  if (!canonicalUrl) return null;
  const requestOrigin = getRequestOrigin(request.headers);
  if (!requestOrigin || originsMatch(requestOrigin, canonicalUrl)) return null;
  return NextResponse.json(
    {
      error: 'NAD is locked to its configured domain. Open it through the canonical URL.',
      code: 'NON_CANONICAL_HOST',
    },
    { status: 403 },
  );
}

/**
 * Canonical login URL honouring the stored setting, used for the post-setup
 * redirect and the secure-login handoff.
 */
export async function getDbCanonicalLoginUrl(setupComplete = false): Promise<string | undefined> {
  const canonicalUrl = await getEffectiveCanonicalUrl();
  if (!canonicalUrl) return undefined;
  const url = new URL('/login', canonicalUrl);
  if (setupComplete) url.searchParams.set('setup', 'complete');
  return url.toString();
}
