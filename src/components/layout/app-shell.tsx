import type { ReactNode } from 'react';
import { auth } from '@/lib/auth/config';
import { hasPermission } from '@/lib/auth/permissions';
import { getEnabledModuleStates } from '@/lib/modules/registry';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { MarketplaceSecurityBanner } from '@/components/layout/marketplace-security-banner';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getAppName } from '@/lib/settings';
import { refreshAndEnforceMarketplaceSecurity } from '@/lib/marketplace/security-enforcement';
import {
  canCreatePersonalWorkspace,
  ensurePersonalWorkspace,
  listWorkspaceNavigation,
} from '@/lib/workspaces/service';
import { canAccessInstalledSurface } from '@/lib/modules/installed/surfaces';

export async function AppShell({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const session = await auth();
  const [appName, states, marketplaceSecurity] = await Promise.all([
    getAppName(),
    session ? getEnabledModuleStates() : Promise.resolve([]),
    session?.user.role === 'admin'
      ? refreshAndEnforceMarketplaceSecurity()
      : Promise.resolve(undefined),
  ]);
  const visibleStates = session?.user.role === 'admin'
    ? states
    : (await Promise.all(
        states.map(async (state) => ({
          state,
          visible: session ? await hasPermission(session.user.id, state.manifest.slug, 'view') : false,
        })),
      )).filter(({ visible }) => visible).map(({ state }) => state);

  const modules = session ? (await Promise.all(visibleStates.map(async ({ manifest, status }) => {
    const pageAccess = await Promise.all(manifest.pages.map((page) => (
      page.sandboxSurfaceId
        ? canAccessInstalledSurface(session.user.id, manifest.slug, page.sandboxSurfaceId, 'page')
        : Promise.resolve(true)
    )));
    return pageAccess.some(Boolean) ? {
      slug: manifest.slug,
      name: manifest.name,
      icon: manifest.icon,
      category: manifest.category,
      status,
    } : null;
  }))).filter((module): module is NonNullable<typeof module> => module !== null) : [];
  if (session) ensurePersonalWorkspace(session.user.id);
  const workspaces = session
    ? listWorkspaceNavigation(session.user.id)
    : { mine: [], shared: [] };

  return (
    <SidebarProvider>
      <AppSidebar
        appName={appName}
        modules={modules}
        workspaces={workspaces}
        canCreatePersonalWorkspaces={session ? canCreatePersonalWorkspace(session.user.id) : false}
        showSettings={session?.user.role === 'admin'}
        version={process.env.NAD_VERSION ?? 'dev'}
      />
      <SidebarInset className="min-w-0 bg-transparent">
        <Header appName={appName} />
        {marketplaceSecurity ? <MarketplaceSecurityBanner state={marketplaceSecurity} /> : null}
        <main className="flex-1 px-4 py-4 sm:px-6 sm:py-5 lg:px-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
