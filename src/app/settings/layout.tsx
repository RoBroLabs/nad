import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/config';
import { AppShell } from '@/components/layout/app-shell';
import { SettingsNavigation } from '@/components/settings/settings-navigation';

export default async function SettingsLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session) redirect('/login');
  if (session.user.role !== 'admin') redirect('/');

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl space-y-7">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Administration</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        </div>
        <SettingsNavigation />
        {children}
      </div>
    </AppShell>
  );
}
