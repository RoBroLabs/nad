import Link from 'next/link';
import { ArrowLeft, Radar } from 'lucide-react';
import { auth } from '@/lib/auth/config';
import { getAppName } from '@/lib/settings';

export default async function NotFound(): Promise<React.JSX.Element> {
  const [session, appName] = await Promise.all([auth(), getAppName()]);
  const destination = session ? '/' : '/login';
  const destinationLabel = session ? 'Return to Dashboard' : 'Return to login';

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-6 py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/.12),transparent_42%)]" />
      <section className="glass relative w-full max-w-lg rounded-2xl px-7 py-10 text-center sm:px-10">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
          <Radar className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-primary">404 · Signal lost</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">This NAD route does not exist</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The requested page is outside {appName}. Use the safe route below to return to the application.
        </p>
        <Link
          href={destination}
          className="mt-7 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {destinationLabel}
        </Link>
      </section>
    </main>
  );
}
