import bcrypt from 'bcrypt';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appSettings, users } from '@/lib/db/schema';
import { generateId, now } from '@/lib/utils';
import { parseCanonicalUrl } from '@/lib/access-url';
import { consumeRateLimit, getClientAddress } from '@/lib/auth/rate-limit';
import { notify } from '@/lib/notifications';
import { readJsonObject } from '@/lib/http';

interface SetupPayload {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  dashboardName?: unknown;
  dashboardUrl?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimit = consumeRateLimit(`setup:${getClientAddress(request)}`, 5, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many setup attempts. Try again later.', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'retry-after': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const existingUser = await db.select({ id: users.id }).from(users).limit(1).get();

  if (existingUser) {
    return NextResponse.json(
      { error: 'Setup has already been completed.', code: 'SETUP_COMPLETE' },
      { status: 409 },
    );
  }

  const parsedPayload = await readJsonObject(request);
  if (!parsedPayload) {
    return NextResponse.json(
      { error: 'Invalid request body.', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }
  const payload = parsedPayload as SetupPayload;

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string'
    ? payload.email.trim().toLowerCase()
    : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const dashboardName = typeof payload.dashboardName === 'string'
    ? payload.dashboardName.trim()
    : '';
  const dashboardUrl = typeof payload.dashboardUrl === 'string'
    ? payload.dashboardUrl.trim()
    : '';
  const canonicalUrl = dashboardUrl ? parseCanonicalUrl(dashboardUrl) : null;
  if (dashboardUrl && !canonicalUrl) {
    return NextResponse.json(
      {
        error: 'Dashboard URL must be an absolute HTTP(S) origin such as https://dashboard.example.com — no credentials, path, or query string.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  if (
    !name
    || name.length > 100
    || !email.includes('@')
    || email.length > 320
    || password.length < 10
    || password.length > 1_024
    || !dashboardName
    || dashboardName.length > 100
  ) {
    return NextResponse.json(
      {
        error: 'Enter a name, valid email, dashboard name, and a password of at least 10 characters.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 },
    );
  }

  const timestamp = now();
  const userId = generateId();
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const created = db.transaction((transaction) => {
      const setupComplete = transaction
        .select({ id: users.id })
        .from(users)
        .limit(1)
        .get();
      if (setupComplete) return false;

      transaction.insert(users).values({
        id: userId,
        email,
        name,
        passwordHash,
        role: 'admin',
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run();

      transaction.insert(appSettings).values({
        key: 'dashboard_name',
        value: dashboardName,
        updatedAt: timestamp,
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: dashboardName, updatedAt: timestamp },
      }).run();

      if (canonicalUrl) {
        transaction.insert(appSettings).values({
          key: 'canonical_url',
          value: canonicalUrl,
          updatedAt: timestamp,
        }).onConflictDoUpdate({
          target: appSettings.key,
          set: { value: canonicalUrl, updatedAt: timestamp },
        }).run();
      }
      return true;
    });
    if (!created) {
      return NextResponse.json(
        { error: 'Setup has already been completed.', code: 'SETUP_COMPLETE' },
        { status: 409 },
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return NextResponse.json(
        { error: 'Setup has already been completed.', code: 'SETUP_COMPLETE' },
        { status: 409 },
      );
    }
    throw error;
  }

  // Send the browser to the login page on the canonical URL when one was
  // stored during setup, so the first session is established on the right origin.
  const loginUrl = canonicalUrl
    ? new URL('/login?setup=complete', canonicalUrl).toString()
    : undefined;

  // First-run setup is a security-relevant lifecycle event; notification
  // delivery is best-effort and must never fail the request.
  void notify(
    'NAD setup complete',
    `${dashboardName} finished first-run setup. Administrator: ${email}.`,
    'info',
  ).catch(() => {});

  return NextResponse.json({ data: { userId, loginUrl } }, { status: 201 });
}
