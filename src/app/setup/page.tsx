import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { SetupForm } from '@/components/auth/setup-form';
import { getDbCanonicalLoginUrl } from '@/lib/access';
import { getCanonicalLoginUrl } from '@/lib/auth/canonical-url';

export const dynamic = 'force-dynamic';

export default async function SetupPage(): Promise<React.JSX.Element> {
  const existingUser = await db.select({ id: users.id }).from(users).limit(1).get();

  if (existingUser) redirect('/login');

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-5 py-12">
      <SetupForm
        loginUrl={await getDbCanonicalLoginUrl(true) ?? getCanonicalLoginUrl(true) ?? '/login?setup=complete'}
      />
    </main>
  );
}
