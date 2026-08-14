'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AppWindow, LayoutGrid, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newTabKind, setNewTabKind] = useState<'grid' | 'surface'>('grid');
  const [newSurfaceKey, setNewSurfaceKey] = useState(availableSurfaces[0]
    ? `${availableSurfaces[0].moduleSlug}:${availableSurfaces[0].surfaceId}`
    : '');
  const canEdit = workspace.access === 'edit';

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
    <header className="space-y-4 border-b border-border/70 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {workspace.kind === 'personal' ? 'My Workspace' : 'Shared Workspace'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{workspace.name}</h1>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" disabled={pending} onClick={() => void togglePinned()} aria-label={workspace.pinned ? 'Unpin Workspace' : 'Pin Workspace'}>
              {workspace.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            </Button>
            <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (open) setError(null); }}>
              <DialogTrigger asChild><Button variant="outline"><Pencil data-icon="inline-start" />Rename</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Rename Workspace</DialogTitle><DialogDescription>Names are navigation labels only and do not affect installed plugins.</DialogDescription></DialogHeader>
                <form className="space-y-4" onSubmit={updateWorkspace}>
                  <div className="space-y-2"><Label htmlFor="workspace-name">Workspace name</Label><Input id="workspace-name" name="name" defaultValue={workspace.name} maxLength={80} required /></div>
                  <div className="space-y-2"><Label htmlFor="workspace-tab-name">Current tab name</Label><Input id="workspace-tab-name" name="tabName" defaultValue={activeTab.name} maxLength={80} required /></div>
                  {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                  <DialogFooter><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save names'}</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2 overflow-x-auto" aria-label="Workspace tabs">
        {workspace.tabs.map((tab) => (
          <Link
            key={tab.id}
            href={workspacePath(workspace.id, tab.id)}
            className={cn(
              'group relative flex min-h-9 shrink-0 items-center gap-2 border-b-2 px-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              tab.id === activeTab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
            aria-current={tab.id === activeTab.id ? 'page' : undefined}
          >
            <span className={cn('size-1.5 rounded-full', tab.id === activeTab.id ? 'bg-primary' : 'bg-border group-hover:bg-muted-foreground')} aria-hidden="true" />
            {tab.name}
          </Link>
        ))}
        {canEdit ? (
          <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (open) setError(null); }}>
            <DialogTrigger asChild><Button variant="ghost" size="sm" className="shrink-0"><Plus data-icon="inline-start" />Tab</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Workspace tab</DialogTitle><DialogDescription>Choose a resizable Widget grid or an installed App/Add-on page. Access is rechecked every time the tab opens.</DialogDescription></DialogHeader>
              <form className="space-y-4" onSubmit={addTab}>
                <div className="space-y-2"><Label htmlFor="new-workspace-tab">Tab name</Label><Input id="new-workspace-tab" name="name" placeholder="Infrastructure" maxLength={80} required /></div>
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
                <DialogFooter><Button type="submit" disabled={pending || (newTabKind === 'surface' && !newSurfaceKey)}>{newTabKind === 'surface' ? <AppWindow data-icon="inline-start" /> : <LayoutGrid data-icon="inline-start" />}{pending ? 'Creating…' : 'Create tab'}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
        {canEdit && workspace.tabs.length > 1 ? (
          <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0 text-destructive" disabled={pending} onClick={() => void deleteActiveTab()} aria-label={`Delete ${activeTab.name} tab`}>
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {error && !editOpen && !addOpen ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </header>
  );
}
