import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/config';
import { getEnabledModuleStates } from '@/lib/modules/registry';
import { hasPermission } from '@/lib/auth/permissions';
import { AppShell } from '@/components/layout/app-shell';
import { DashboardWorkspace } from '@/components/dashboard/dashboard-workspace';
import type { AvailableWidget } from '@/components/dashboard/types';
import { ensurePersonalWorkspace } from '@/lib/workspaces/service';
import { canAccessInstalledSurface } from '@/lib/modules/installed/surfaces';
import { workspacePath } from '@/lib/workspaces/route-paths';

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session) redirect('/login');
  const workspace = ensurePersonalWorkspace(session.user.id);
  if (workspace?.tabs[0]) redirect(workspacePath(workspace.id, workspace.tabs[0].id));
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
    .flatMap(({ manifest }) =>
    manifest.widgets.map(async (widget): Promise<AvailableWidget | null> => {
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
    })))).filter((widget): widget is AvailableWidget => widget !== null);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl">
        <DashboardWorkspace
          availableWidgets={availableWidgets}
          isAdmin={session.user.role === 'admin'}
          installedCount={visibleModuleStates.length}
        />
      </div>
    </AppShell>
  );
}
