import { NextResponse } from 'next/server';
import { rawDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function secretIsConfigured(value: string | undefined): boolean {
  return Boolean(
    value
    && value.length >= 32
    && !value.includes('change-me')
    && !value.includes('${APP_SECRET}'),
  );
}

export async function GET(): Promise<NextResponse> {
  try {
    rawDb.prepare('SELECT 1 FROM users LIMIT 1').get();
    const migration = rawDb
      .prepare('SELECT MAX(version) AS version FROM homedashboard_migrations')
      .get() as { version: number | null };
    const appSecretReady = secretIsConfigured(process.env.APP_SECRET);
    const authSecretReady = secretIsConfigured(
      process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    );
    const secretsAreDistinct = process.env.APP_SECRET !== (
      process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
    );
    const configurationReady = process.env.NODE_ENV !== 'production'
      || (appSecretReady && authSecretReady && secretsAreDistinct);

    return NextResponse.json(
      {
        data: {
          status: configurationReady ? 'ok' : 'degraded',
          database: 'ok',
          migrationVersion: migration.version ?? 0,
          configuration: configurationReady ? 'ok' : 'invalid',
        },
      },
      {
        status: configurationReady ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch {
    return NextResponse.json(
      { error: 'Service unavailable', code: 'UNHEALTHY' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
