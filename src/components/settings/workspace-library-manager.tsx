'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import type {
  WorkspaceAccess,
  WorkspaceAssignment,
  WorkspaceAssignmentSubject,
  WorkspaceDetail,
  WorkspaceKind,
} from '@/lib/workspaces/types';
import { workspacePath } from '@/lib/workspaces/route-paths';

interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

const roleLabels: Record<string, string> = { admin: 'Administrators', member: 'Members', restricted: 'Restricted users' };

export function WorkspaceLibraryManager({
  initialWorkspaces,
  users,
}: {
  initialWorkspaces: WorkspaceDetail[];
  users: WorkspaceUser[];
}): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [createOpen, setCreateOpen] = useState(false);
  const [kind, setKind] = useState<WorkspaceKind>('shared');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userNames = useMemo(() => new Map(users.map((user) => [user.id, user.name])), [users]);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const workspace = await requestApi<WorkspaceDetail>('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          kind,
          ownerUserId: kind === 'personal' ? form.get('ownerUserId') : undefined,
        }),
      }, 'Workspace could not be created.');
      setWorkspaces((current) => [...current, workspace].sort((left, right) => left.name.localeCompare(right.name)));
      setCreateOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Workspace could not be created.');
    } finally {
      setPending(false);
    }
  }

  async function remove(workspace: WorkspaceDetail): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await requestApi(`/api/workspaces/${workspace.id}`, { method: 'DELETE' }, 'Workspace could not be deleted.');
      setWorkspaces((current) => current.filter(({ id }) => id !== workspace.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Workspace could not be deleted.');
    } finally {
      setPending(false);
    }
  }

  async function saveAssignments(workspaceId: string, assignments: WorkspaceAssignment[]): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await requestApi<WorkspaceAssignment[]>(`/api/workspaces/${workspaceId}/assignments`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignments }),
      }, 'Workspace assignments could not be saved.');
      setWorkspaces((current) => current.map((workspace) => workspace.id === workspaceId ? { ...workspace, assignments: result } : workspace));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Workspace assignments could not be saved.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Workspace library</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Create personal, assigned and reusable layouts without exposing every Workspace in the administrator sidebar.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) setError(null); }}>
          <DialogTrigger asChild><Button><Plus data-icon="inline-start" />New Workspace</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Workspace</DialogTitle><DialogDescription>Shared Workspaces can be assigned after creation. Templates copy layout references but never connection credentials.</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={create}>
              <div className="space-y-2"><Label htmlFor="library-workspace-name">Name</Label><Input id="library-workspace-name" name="name" maxLength={80} required /></div>
              <div className="space-y-2"><Label htmlFor="library-workspace-kind">Type</Label><Select value={kind} onValueChange={(value) => setKind(value as WorkspaceKind)}><SelectTrigger id="library-workspace-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="shared">Shared</SelectItem><SelectItem value="personal">User-specific</SelectItem><SelectItem value="template">Template</SelectItem></SelectContent></Select></div>
              {kind === 'personal' ? (
                <div className="space-y-2"><Label htmlFor="library-workspace-owner">Owner</Label><Select name="ownerUserId" required><SelectTrigger id="library-workspace-owner" className="w-full"><SelectValue placeholder="Choose user" /></SelectTrigger><SelectContent>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}</SelectContent></Select></div>
              ) : null}
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter><Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create'}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {error && !createOpen ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      <div className="divide-y divide-border/60 border-y border-border/70">
        {workspaces.map((workspace) => (
          <details key={workspace.id} className="group py-1">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-2 py-4 marker:hidden">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="font-medium">{workspace.name}</span><Badge variant="outline">{workspace.kind}</Badge></span>
                <span className="mt-1 block text-xs text-muted-foreground">{workspace.kind === 'personal' ? `Owner: ${userNames.get(workspace.ownerUserId ?? '') ?? 'Unknown'}` : `${workspace.tabs.length} tab${workspace.tabs.length === 1 ? '' : 's'}`}</span>
              </span>
              <Button asChild variant="ghost" size="icon" onClick={(event) => event.stopPropagation()} aria-label={`Open ${workspace.name}`}><Link href={workspacePath(workspace.id, workspace.tabs[0]?.id)}><ExternalLink /></Link></Button>
              <Button variant="ghost" size="icon" className="text-destructive" disabled={pending} onClick={(event) => { event.preventDefault(); void remove(workspace); }} aria-label={`Delete ${workspace.name}`}><Trash2 /></Button>
            </summary>
            <div className="border-t border-border/45 px-2 py-4">
              {workspace.kind === 'shared' ? (
                <AssignmentEditor workspace={workspace} users={users} disabled={pending} onSave={(assignments) => saveAssignments(workspace.id, assignments)} />
              ) : workspace.kind === 'template' ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Copy className="size-4" />Applying this template creates new layout rows and asks the user to select local connections.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Only the owner and administrators can edit this Workspace.</p>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function AssignmentEditor({
  workspace,
  users,
  disabled,
  onSave,
}: {
  workspace: WorkspaceDetail;
  users: WorkspaceUser[];
  disabled: boolean;
  onSave: (assignments: WorkspaceAssignment[]) => Promise<void>;
}): React.JSX.Element {
  const initial = Object.fromEntries(workspace.assignments.map((assignment) => [
    `${assignment.subjectType}:${assignment.subjectId ?? ''}`,
    assignment.access,
  ]));
  const [values, setValues] = useState<Record<string, WorkspaceAccess | 'none'>>(initial);
  const subjects: Array<{ type: WorkspaceAssignmentSubject; id: string | null; label: string }> = [
    { type: 'all', id: null, label: 'Everyone' },
    ...Object.entries(roleLabels).map(([id, label]) => ({ type: 'role' as const, id, label })),
    ...users.filter(({ role }) => role !== 'admin').map((user) => ({ type: 'user' as const, id: user.id, label: `${user.name} · ${user.email}` })),
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Assignments</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {subjects.map((subject) => {
          const key = `${subject.type}:${subject.id ?? ''}`;
          return (
            <label key={key} className="flex items-center justify-between gap-3 border border-border/60 px-3 py-2">
              <span className="truncate text-sm">{subject.label}</span>
              <Select value={values[key] ?? 'none'} onValueChange={(value) => setValues((current) => ({ ...current, [key]: value as WorkspaceAccess | 'none' }))}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="view">View</SelectItem><SelectItem value="edit">Edit</SelectItem></SelectContent>
              </Select>
            </label>
          );
        })}
      </div>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => void onSave(subjects.flatMap((subject) => {
        const access = values[`${subject.type}:${subject.id ?? ''}`];
        return access === 'view' || access === 'edit' ? [{ id: '', subjectType: subject.type, subjectId: subject.id, access }] : [];
      }))}>Save assignments</Button>
    </div>
  );
}
