import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Blocks, Settings } from 'lucide-react';
import { auth } from '@/lib/auth/config';
import { hasPermission } from '@/lib/auth/permissions';
import { getModuleState } from '@/lib/modules/registry';
import { moduleStatusLabel } from '@/lib/modules/status';
import { AppShell } from '@/components/layout/app-shell';
import { ModuleIcon } from '@/components/shared/module-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InstalledModulePage } from '@/components/modules/declarative/installed-module-page';
import { InstalledSandboxSurface } from '@/components/modules/sandbox/installed-sandbox-surface';
import { canAccessInstalledSurface } from '@/lib/modules/installed/surfaces';

export const dynamic = 'force-dynamic';

interface ModulePageProps {
  params: Promise<{ moduleSlug: string }>;
}

export default async function ModulePage({ params }: ModulePageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session) redirect('/login');

  const { moduleSlug } = await params;
  const state = await getModuleState(moduleSlug);
  if (!state) notFound();
  if (state.status === 'discovered' && session.user.role !== 'admin') redirect('/');

  const allowed = session.user.role === 'admin'
    || await hasPermission(session.user.id, moduleSlug, 'view');
  if (!allowed) redirect('/');

  const { manifest, status } = state;
  const settingsHref = `/settings/modules/${moduleSlug}`;
  const rootPage = manifest.pages.find(({ path }) => path === '/');
  const installedPage = rootPage?.installedView;
  if (rootPage?.sandboxSurfaceId && !await canAccessInstalledSurface(
    session.user.id,
    moduleSlug,
    rootPage.sandboxSurfaceId,
    'page',
  )) redirect('/');

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary ring-1 ring-border/70">
              <ModuleIcon name={manifest.icon} className="size-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{manifest.name}</h1>
                <Badge variant="secondary">{moduleStatusLabel(status)}</Badge>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{manifest.description}</p>
            </div>
          </div>
          {session.user.role === 'admin' ? (
            <Button variant="outline" asChild>
              <Link href={settingsHref}>
                <Settings data-icon="inline-start" aria-hidden="true" />
                Plugin settings
              </Link>
            </Button>
          ) : null}
        </header>

        {status === 'quarantined' ? (
          <ModuleNotice
            title="Plugin quarantined"
            description="NAD blocked this exact release after verifying Marketplace security metadata. Its settings, package history and Dashboard layout are retained for review."
            href={session.user.role === 'admin' ? settingsHref : undefined}
            action={session.user.role === 'admin' ? 'Review security status' : undefined}
          />
        ) : status === 'discovered' ? (
          <ModuleNotice
            title="Plugin not enabled"
            description="Enable this plugin before opening its page."
            href={session.user.role === 'admin' ? settingsHref : undefined}
            action={session.user.role === 'admin' ? 'Open plugin settings' : undefined}
          />
        ) : status === 'enabled' ? (
          <ModuleNotice
            title="Configure this plugin"
            description={session.user.role === 'admin'
              ? 'Complete the required connection settings to activate this plugin.'
              : 'An administrator must complete the required connection settings.'}
            href={session.user.role === 'admin' ? settingsHref : undefined}
            action={session.user.role === 'admin' ? 'Configure plugin' : undefined}
          />
        ) : rootPage?.sandboxSurfaceId ? (
          <InstalledSandboxSurface
            moduleSlug={moduleSlug}
            surfaceId={rootPage.sandboxSurfaceId}
            title={rootPage.title}
            initialHeight={640}
          />
        ) : installedPage ? (
          <InstalledModulePage moduleSlug={moduleSlug} view={installedPage} />
        ) : (
          <ModuleNotice
            title="No full-page view"
            description="This plugin is active but only provides Widgets. Add one from your Dashboard."
            href="/"
            action="Open Dashboard"
          />
        )}
      </div>
    </AppShell>
  );
}

function ModuleNotice({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}): React.JSX.Element {
  return (
    <section className="glass-subtle flex min-h-80 flex-col items-center justify-center rounded-2xl px-6 py-14 text-center">
      <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
        <Blocks className="size-5" aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {href && action ? <Button className="mt-6" asChild><Link href={href}>{action}</Link></Button> : null}
    </section>
  );
}
