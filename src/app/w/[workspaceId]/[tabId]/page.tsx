import { Blocks } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth/config';
import { hasPermission } from '@/lib/auth/permissions';
import { AppShell } from '@/components/layout/app-shell';
import { DashboardWorkspace } from '@/components/dashboard/dashboard-workspace';
import type { AvailableWidget } from '@/components/dashboard/types';
import { WorkspaceHeader } from '@/components/workspaces/workspace-header';
import { InstalledSandboxSurface } from '@/components/modules/sandbox/installed-sandbox-surface';
import { getEnabledModuleStates } from '@/lib/modules/registry';
import { getWorkspaceDetail } from '@/lib/workspaces/service';
import { canAccessInstalledSurface } from '@/lib/modules/installed/surfaces';
import { decodeWorkspaceRouteId } from '@/lib/workspaces/route-paths';

export const dynamic = 'force-dynamic';

interface WorkspaceTabPageProps {
  params: Promise<{ workspaceId: string; tabId: string }>;
}

export default async function WorkspaceTabPage({ params }: WorkspaceTabPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session) redirect('/login');
  const { workspaceId: routeWorkspaceId, tabId: routeTabId } = await params;
  const workspaceId = decodeWorkspaceRouteId(routeWorkspaceId);
  const tabId = decodeWorkspaceRouteId(routeTabId);
  if (!workspaceId || !tabId) notFound();
  const workspace = getWorkspaceDetail(session.user.id, workspaceId);
  if (!workspace) notFound();
  const tab = workspace.tabs.find(({ id }) => id === tabId);
  if (!tab) notFound();

  const moduleStates = await getEnabledModuleStates();
  const visibleModuleStates = session.user.role === 'admin'
    ? moduleStates
    : (await Promise.all(moduleStates.map(async (state) => ({
        state,
        visible: await hasPermission(session.user.id, state.manifest.slug, 'view'),
      }))))
        .filter(({ visible }) => visible)
        .map(({ state }) => state);
  const availableWidgets = (await Promise.all(visibleModuleStates
    .filter(({ status }) => status === 'configured')
    .flatMap(({ manifest }) => manifest.widgets.map(async (widget): Promise<AvailableWidget | null> => {
      if (widget.sandboxSurfaceId && !await canAccessInstalledSurface(
        session.user.id,
        manifest.slug,
        widget.sandboxSurfaceId,
        'widget',
      )) return null;
      return {
        moduleSlug: manifest.slug,
        moduleName: manifest.name,
        widgetId: widget.id,
        name: widget.name,
        description: widget.description,
        defaultSize: widget.defaultSize,
        minSize: widget.minSize,
        maxSize: widget.maxSize,
        installedView: widget.installedView,
        sandboxSurfaceId: widget.sandboxSurfaceId,
      };
    })))).flat().filter((widget): widget is AvailableWidget => widget !== null);
  const availableSurfaces = (await Promise.all(visibleModuleStates.flatMap(({ manifest, status }) => (
    status === 'configured'
      ? manifest.pages.flatMap((page) => page.sandboxSurfaceId ? [{ manifest, page }] : [])
      : []
  )).map(async ({ manifest, page }) => (
    page.sandboxSurfaceId && await canAccessInstalledSurface(
      session.user.id,
      manifest.slug,
      page.sandboxSurfaceId,
      'page',
    ) ? {
        moduleSlug: manifest.slug,
        moduleName: manifest.name,
        surfaceId: page.sandboxSurfaceId,
        title: page.title,
      } : null
  )))).filter((surface): surface is NonNullable<typeof surface> => surface !== null);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <WorkspaceHeader
          workspace={workspace}
          activeTab={tab}
          availableSurfaces={availableSurfaces}
        />
        {tab.kind === 'grid' ? (
          <DashboardWorkspace
            availableWidgets={availableWidgets}
            layoutEndpoint={`/api/workspaces/${workspace.id}/tabs/${tab.id}/layout`}
            saveMethod="PUT"
            eyebrow={workspace.access === 'edit' ? 'Widget grid' : 'Shared view'}
            title={tab.name}
            canEdit={workspace.access === 'edit'}
          />
        ) : tab.surfaceModuleSlug && tab.surfaceId ? (
          <InstalledSandboxSurface
            moduleSlug={tab.surfaceModuleSlug}
            surfaceId={tab.surfaceId}
            title={tab.name}
            connectionProfileId={tab.connectionProfileId}
            initialHeight={680}
            persistConnectionEndpoint={workspace.access === 'edit'
              ? `/api/workspaces/${workspace.id}/tabs/${tab.id}`
              : undefined}
          />
        ) : (
          <section className="flex min-h-80 flex-col items-center justify-center border border-dashed border-border px-6 py-14 text-center">
            <Blocks className="size-5 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-4 text-base font-medium">Plugin surface unavailable</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              This tab keeps its layout reference, but the installed App or Add-on surface is disabled, unavailable, or no longer permitted.
            </p>
          </section>
        )}
      </div>
    </AppShell>
  );
}
