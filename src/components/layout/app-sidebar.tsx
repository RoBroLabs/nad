'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelsTopLeft, Settings, UsersRound } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { ModuleIcon } from '@/components/shared/module-icon';
import { NadLogo } from '@/components/shared/nad-logo';
import type { ModuleCategory, ModuleStatus } from '@/lib/modules/types';
import { WorkspaceCreateDialog } from '@/components/workspaces/workspace-create-dialog';
import type { WorkspaceNavigation, WorkspaceSummary } from '@/lib/workspaces/types';
import { workspacePath } from '@/lib/workspaces/route-paths';

interface SidebarModule {
  slug: string;
  name: string;
  icon: string;
  category: ModuleCategory;
  status: ModuleStatus;
}

const categoryLabels: Record<ModuleCategory, string> = {
  servers: 'Servers',
  media: 'Media',
  games: 'Games',
  network: 'Network',
  tools: 'Tools',
  automation: 'Automation',
  monitoring: 'Monitoring',
  custom: 'Custom',
};

export function AppSidebar({
  appName,
  modules,
  workspaces,
  canCreatePersonalWorkspaces,
  showSettings,
  version,
}: {
  appName: string;
  modules: SidebarModule[];
  workspaces: WorkspaceNavigation;
  canCreatePersonalWorkspaces: boolean;
  showSettings: boolean;
  version: string;
}): React.JSX.Element {
  const pathname = usePathname();
  const categories = Array.from(new Set(modules.map(({ category }) => category)));
  const firstWorkspace = workspaces.mine[0] ?? workspaces.shared[0];
  const homeHref = firstWorkspace ? workspaceHref(firstWorkspace) : '/';

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={appName}>
              <Link href={homeHref}>
                <NadLogo className="size-8" />
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold tracking-tight">{appName}</span>
                  <span className="truncate text-xs text-sidebar-foreground/60">Mission control</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupLabel>My Workspaces</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaces.mine.map((workspace) => <WorkspaceMenuItem key={workspace.id} workspace={workspace} pathname={pathname} />)}
              {!workspaces.mine.length ? (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === '/'} tooltip="Dashboard">
                    <Link href="/"><PanelsTopLeft aria-hidden="true" /><span>Dashboard</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
              {canCreatePersonalWorkspaces ? <SidebarMenuItem><WorkspaceCreateDialog /></SidebarMenuItem> : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {workspaces.shared.length ? (
          <SidebarGroup>
            <SidebarGroupLabel>Shared with me</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {workspaces.shared.map((workspace) => <WorkspaceMenuItem key={workspace.id} workspace={workspace} pathname={pathname} shared />)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        {categories.map((category) => (
          <SidebarGroup key={category}>
            <SidebarGroupLabel>{categoryLabels[category]}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {modules.filter((module) => module.category === category).map((module) => (
                  <SidebarMenuItem key={module.slug}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(`/m/${module.slug}`)}
                      tooltip={module.name}
                    >
                      <Link href={`/m/${module.slug}`}>
                        <ModuleIcon name={module.icon} />
                        <span>{module.name}</span>
                        {module.status === 'enabled' ? (
                          <span className="ml-auto text-warning" title="Plugin needs configuration" aria-label="Plugin needs configuration">●</span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        {showSettings ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname.startsWith('/settings')} tooltip="Settings">
                <Link href="/settings/modules">
                  <Settings aria-hidden="true" />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
        <p
          className="truncate px-2 pt-2 text-xs text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden"
          title="NAD core version"
        >
          {version}
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function workspaceHref(workspace: WorkspaceSummary): string {
  const firstTab = [...workspace.tabs].sort((left, right) => left.position - right.position)[0];
  return workspacePath(workspace.id, firstTab?.id);
}

function WorkspaceMenuItem({
  workspace,
  pathname,
  shared = false,
}: {
  workspace: WorkspaceSummary;
  pathname: string;
  shared?: boolean;
}): React.JSX.Element {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={pathname.startsWith(workspacePath(workspace.id))} tooltip={workspace.name}>
        <Link href={workspaceHref(workspace)}>
          {shared ? <UsersRound aria-hidden="true" /> : <PanelsTopLeft aria-hidden="true" />}
          <span>{workspace.name}</span>
          {workspace.tabs.length > 1 ? <span className="ml-auto font-mono text-[10px] text-sidebar-foreground/45">{workspace.tabs.length}</span> : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
