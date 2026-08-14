import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Providers } from '@/components/providers';
import '@/styles/globals.css';
import { getAccessLockRedirect } from '@/lib/access';
import { getAppName } from '@/lib/settings';

export async function generateMetadata(): Promise<Metadata> {
  const appName = await getAppName();
  return {
    title: {
      default: appName,
      template: `%s · ${appName}`,
    },
    description: 'Self-hosted homelab mission control.',
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  // When the access lock is enabled, send every page request that arrives on
  // a non-canonical origin to the configured domain instead of rendering it.
  const accessLockTarget = await getAccessLockRedirect(await headers());
  if (accessLockTarget) redirect(accessLockTarget);

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
