import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { LoginForm } from '@/components/auth/login-form';
import { getDbCanonicalLoginUrl } from '@/lib/access';
import { getRequestOrigin } from '@/lib/access-url';
import { getCanonicalLoginUrl } from '@/lib/auth/canonical-url';
import { getAppName } from '@/lib/settings';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string; setup?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps): Promise<React.JSX.Element> {
  const existingUser = await db.select({ id: users.id }).from(users).limit(1).get();
  if (!existingUser) redirect('/setup');
  const appName = await getAppName();
  const requestOrigin = getRequestOrigin(await headers());
  const canonicalLoginUrl = await getDbCanonicalLoginUrl() ?? getCanonicalLoginUrl();
  let requiresCanonicalLogin = false;

  if (requestOrigin && canonicalLoginUrl) {
    try {
      requiresCanonicalLogin = new URL(canonicalLoginUrl).origin !== new URL(requestOrigin).origin;
    } catch {
      requiresCanonicalLogin = false;
    }
  }

  const params = await searchParams;
  const requestedCallback = params.callbackUrl;
  const callbackUrl = requestedCallback?.startsWith('/')
    && !requestedCallback.startsWith('//')
    && !requestedCallback.includes('\\')
    ? requestedCallback
    : '/';

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-5 py-12">
      <LoginForm
        appName={appName}
        callbackUrl={callbackUrl}
        setupComplete={params.setup === 'complete'}
        canonicalLoginUrl={canonicalLoginUrl}
        requiresCanonicalLogin={requiresCanonicalLogin}
      />
    </main>
  );
}
