import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getModule, getModuleState } from '@/lib/modules/registry';
import { getModuleConfigForDisplay } from '@/lib/modules/config';
import { listModuleReleases } from '@/lib/modules/installed/lifecycle';
import { moduleStatusLabel } from '@/lib/modules/status';
import { ModuleConfigForm } from '@/components/settings/module-config-form';
import { ModuleLifecycleActions } from '@/components/settings/module-lifecycle-actions';
import { ModuleIcon } from '@/components/shared/module-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AppConnectionsManager } from '@/components/settings/app-connections-manager';
import { getInstalledModule } from '@/lib/modules/installed/provider';
import { listConnectionProfilesForAdmin } from '@/lib/modules/connections';
import { listConnectionProfileAccess } from '@/lib/modules/connections';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { getReleaseSurfaceTrust } from '@/lib/modules/installed/trust';
import { ReleaseSurfaceTrustEditor } from '@/components/settings/release-surface-trust';

export const dynamic = 'force-dynamic';

interface ModuleConfigPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ModuleConfigPage({ params }: ModuleConfigPageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const manifest = getModule(slug);
  if (!manifest) notFound();
  const installed = getInstalledModule(slug);
  const usesNamedConnections = installed?.packageSchemaVersion === 2 && installed.packageKind === 'app';
  const connectionProfiles = usesNamedConnections && installed
    ? listConnectionProfilesForAdmin(installed.moduleId)
    : [];
  const connectionUsers = usesNamedConnections
    ? await db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .orderBy(asc(users.name))
      .all()
    : [];
  const installedSurfaces = installed?.surfaces && Array.isArray(installed.surfaces.surfaces)
    ? installed.surfaces.surfaces.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const surface = value as Record<string, unknown>;
        return typeof surface.id === 'string'
          ? [{ id: surface.id, name: typeof surface.name === 'string' ? surface.name : surface.id }]
          : [];
      })
    : [];

  const [config, state, releases] = await Promise.all([
    getModuleConfigForDisplay(slug),
    getModuleState(slug),
    Promise.resolve(listModuleReleases(slug)),
  ]);

  return (
    <section className="space-y-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary ring-1 ring-border/70">
            <ModuleIcon name={manifest.icon} className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{manifest.name}</h2>
              <Badge variant="secondary">{moduleStatusLabel(state?.status ?? 'discovered')}</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{manifest.description}</p>
          </div>
        </div>
        <Button variant="ghost" asChild className="self-start">
          <Link href="/settings/modules">
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            All plugins
          </Link>
        </Button>
      </div>
      {usesNamedConnections && installed ? (
        <AppConnectionsManager
          appId={installed.moduleId}
          appName={manifest.name}
          fields={manifest.configSchema}
          initialProfiles={connectionProfiles}
          users={connectionUsers}
          initialAccess={Object.fromEntries(connectionProfiles.map((profile) => [
            profile.id,
            listConnectionProfileAccess(installed.moduleId, profile.id),
          ]))}
        />
      ) : (
        <ModuleConfigForm
          moduleSlug={slug}
          fields={manifest.configSchema}
          initialConfig={config}
          testEndpoint={manifest.entrypoints?.test ? 'test' : undefined}
        />
      )}
      {installed && installed.packageSchemaVersion === 2 ? (
        <ReleaseSurfaceTrustEditor
          appId={installed.moduleId}
          digest={installed.digest}
          initialSurfaces={installedSurfaces.map((surface) => ({
            ...getReleaseSurfaceTrust(installed.digest, surface.id),
            name: surface.name,
          }))}
        />
      ) : null}
      <ModuleLifecycleActions
        moduleSlug={slug}
        moduleName={manifest.name}
        releases={releases}
      />
    </section>
  );
}
