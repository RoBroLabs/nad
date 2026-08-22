'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AppWindow, ChevronDown, LayoutGrid, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { requestApi } from '@/lib/client-api';
import { cn } from '@/lib/utils';
import type { WorkspaceDetail, WorkspaceTab } from '@/lib/workspaces/types';
import { workspacePath } from '@/lib/workspaces/route-paths';

/**
 * Anything rendered into this element appears on the right of the workspace
 * bar. The grid mounts its own controls here so the page needs one band of
 * chrome instead of the two it used to carry.
 */
export const WORKSPACE_ACTIONS_SLOT_ID = 'workspace-actions-slot';

export function WorkspaceHeader({
  workspace,
  activeTab,
  availableSurfaces,
}: {
  workspace: WorkspaceDetail;
  activeTab: WorkspaceTab;
  availableSurfaces: Array<{
    moduleSlug: string;
    moduleName: string;
    surfaceId: string;
    title: string;
  }>;
}): React.JSX.Element {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newTabKind, setNewTabKind] = useState<'grid' | 'surface'>('grid');
  const [newSurfaceKey, setNewSurfaceKey] = useState(availableSurfaces[0]
    ? `${availableSurfaces[0].moduleSlug}:${availableSurfaces[0].surfaceId}`
    : '');
  const canEdit = workspace.access === 'edit';
  const widgetCount = activeTab.widgets.length;

  async function updateWorkspace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await requestApi(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.get('name') }),
      }, 'Workspace could not be renamed.');
      await requestApi(`/api/workspaces/${workspace.id}/tabs/${activeTab.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.get('tabName') }),
      }, 'Workspace tab could not be renamed.');
      setEditOpen(false);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Workspace could not be updated.');
    } finally {
      setPending(false);
    }
  }

  async function addTab(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const selectedSurface = availableSurfaces.find(({ moduleSlug, surfaceId }) => (
      `${moduleSlug}:${surfaceId}` === newSurfaceKey
    ));
    try {
      const tab = await requestApi<WorkspaceTab>(`/api/workspaces/${workspace.id}/tabs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          kind: newTabKind,
          ...(newTabKind === 'surface' && selectedSurface ? {
            surfaceModuleSlug: selectedSurface.moduleSlug,
            surfaceId: selectedSurface.surfaceId,
          } : {}),
        }),
      }, 'Workspace tab could not be created.');
      setAddOpen(false);
      router.push(workspacePath(workspace.id, tab.id));
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Workspace tab could not be created.');
    } finally {
      setPending(false);
    }
  }

  async function togglePinned(): Promise<void> {
    setPending(true);
    try {
      await requestApi(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: !workspace.pinned }),
      }, 'Workspace pin could not be updated.');
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Workspace pin could not be updated.');
    } finally {
      setPending(false);
    }
  }

  async function deleteActiveTab(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await requestApi(`/api/workspaces/${workspace.id}/tabs/${activeTab.id}`, {
        method: 'DELETE',
      }, 'Workspace tab could not be deleted.');
      setDeleteOpen(false);
      const next = workspace.tabs.find(({ id }) => id !== activeTab.id);
      if (next) router.push(workspacePath(workspace.id, next.id));
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Workspace tab could not be deleted.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 pb-3">
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="-ml-2 h-9 max-w-64 gap-1.5 px-2 text-base font-semibold tracking-tight"
              >
                <span className="truncate">{workspace.name}</span>
                {workspace.pinned ? <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" /> : null}
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onClick={() => { setError(null); setEditOpen(true); }}>
                <Pencil aria-hidden="true" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem disabled={pending} onClick={() => void togglePinned()}>
                {workspace.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                {workspace.pinned ? 'Unpin Workspace' : 'Pin Workspace'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setError(null); setAddOpen(true); }}>
                <Plus aria-hidden="true" />
                Add tab
              </DropdownMenuItem>
              {workspace.tabs.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={pending}
                    onClick={() => { setError(null); setDeleteOpen(true); }}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete “{activeTab.name}”…
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <h1 className="max-w-64 truncate text-base font-semibold tracking-tight">
            {workspace.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">Shared</span>
          </h1>
        )}

        {workspace.tabs.length > 1 || canEdit ? (
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="Workspace tabs">
            {workspace.tabs.map((tab) => (
              <Link
                key={tab.id}
                href={workspacePath(workspace.id, tab.id)}
                className={cn(
                  'relative flex h-8 shrink-0 items-center rounded-md px-2.5 text-sm outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring',
                  tab.id === activeTab.id
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
                aria-current={tab.id === activeTab.id ? 'page' : undefined}
              >
                {tab.name}
              </Link>
            ))}
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                onClick={() => { setError(null); setAddOpen(true); }}
                aria-label="Add Workspace tab"
              >
                <Plus aria-hidden="true" />
              </Button>
            ) : null}
          </nav>
        ) : (
          <div className="flex-1" />
        )}

        <div id={WORKSPACE_ACTIONS_SLOT_ID} className="flex shrink-0 flex-wrap items-center justify-end gap-2" />
      </header>

      {error && !editOpen && !addOpen && !deleteOpen ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (open) setError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Workspace</DialogTitle>
            <DialogDescription>Names are navigation labels only and do not affect installed plugins.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={updateWorkspace}>
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input id="workspace-name" name="name" defaultValue={workspace.name} maxLength={80} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-tab-name">Current tab name</Label>
              <Input id="workspace-tab-name" name="tabName" defaultValue={activeTab.name} maxLength={80} required />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save names'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (open) setError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Workspace tab</DialogTitle>
            <DialogDescription>Choose a resizable Widget grid or an installed App/Add-on page. Access is rechecked every time the tab opens.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={addTab}>
            <div className="space-y-2">
              <Label htmlFor="new-workspace-tab">Tab name</Label>
              <Input id="new-workspace-tab" name="name" placeholder="Infrastructure" maxLength={80} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-workspace-tab-kind">Tab type</Label>
              <Select value={newTabKind} onValueChange={(value) => setNewTabKind(value as 'grid' | 'surface')}>
                <SelectTrigger id="new-workspace-tab-kind" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="grid">Widget grid</SelectItem>
                  <SelectItem value="surface" disabled={!availableSurfaces.length}>App or Add-on page</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newTabKind === 'surface' ? (
              <div className="space-y-2">
                <Label htmlFor="new-workspace-surface">Plugin page</Label>
                <Select value={newSurfaceKey} onValueChange={setNewSurfaceKey}>
                  <SelectTrigger id="new-workspace-surface" className="w-full"><SelectValue placeholder="Choose an installed page" /></SelectTrigger>
                  <SelectContent>
                    {availableSurfaces.map((surface) => (
                      <SelectItem key={`${surface.moduleSlug}:${surface.surfaceId}`} value={`${surface.moduleSlug}:${surface.surfaceId}`}>
                        {surface.moduleName} · {surface.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={pending || (newTabKind === 'surface' && !newSurfaceKey)}>
                {newTabKind === 'surface' ? <AppWindow data-icon="inline-start" /> : <LayoutGrid data-icon="inline-start" />}
                {pending ? 'Creating…' : 'Create tab'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (open) setError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{activeTab.name}”?</DialogTitle>
            <DialogDescription>
              {activeTab.kind === 'grid'
                ? widgetCount === 0
                  ? 'This tab is empty. Deleting it cannot be undone.'
                  : `Its ${widgetCount} ${widgetCount === 1 ? 'Widget' : 'Widgets'} and their layout will be removed. This cannot be undone.`
                : 'The tab will be removed. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your installed plugins, their settings and their connections are not affected.
          </p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={pending} onClick={() => void deleteActiveTab()}>
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              {pending ? 'Deleting…' : 'Delete tab'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
