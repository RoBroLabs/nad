'use client';

import { useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ChevronDown, KeyRound, Plus, Trash2 } from 'lucide-react';
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
import { PasswordInput } from '@/components/ui/password-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { passwordsMatch } from '@/lib/auth/password';
import { requestApi } from '@/lib/client-api';
import type { UserRole } from '@/lib/modules/types';

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  canCreatePersonalWorkspaces: boolean;
  createdAt: string;
}

export interface PermissionModule {
  slug: string;
  name: string;
  permissions: Array<{ action: string; label: string; description: string }>;
}

type PermissionMap = Record<string, Record<string, string[]>>;

export function UsersManager({
  initialUsers,
  modules,
  initialPermissions,
  currentUserId,
}: {
  initialUsers: ManagedUser[];
  modules: PermissionModule[];
  initialPermissions: PermissionMap;
  currentUserId: string;
}): React.JSX.Element {
  const [users, setUsers] = useState(initialUsers);
  const [permissions, setPermissions] = useState(initialPermissions);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ManagedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<Set<string>>(new Set());
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const managedDialogTrigger = useRef<HTMLElement | null>(null);

  function rememberDialogTrigger(element: HTMLElement): void {
    managedDialogTrigger.current = element;
  }

  function restoreDialogFocus(): void {
    window.requestAnimationFrame(() => {
      const target = managedDialogTrigger.current?.isConnected
        ? managedDialogTrigger.current
        : document.getElementById('create-user-button');
      target?.focus();
      managedDialogTrigger.current = null;
    });
  }

  async function createUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus(null);
    const formData = new FormData(event.currentTarget);
    if (!passwordsMatch(formData.get('password'), formData.get('passwordConfirmation'))) {
      setError('Passwords do not match.');
      return;
    }
    setIsCreating(true);
    try {
      const data = await requestApi<ManagedUser>('/api/settings/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(formData)),
      }, 'User could not be created.');
      setUsers((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateOpen(false);
      setStatus(`${data.name} was created.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'User could not be created.');
    } finally {
      setIsCreating(false);
    }
  }

  async function updateRole(userId: string, role: UserRole): Promise<void> {
    setError(null);
    setStatus(null);
    try {
      await requestApi<{ updated: true }>(`/api/settings/users/${userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      }, 'Role could not be updated.');
      setUsers((current) => current.map((user) => user.id === userId ? { ...user, role } : user));
      setStatus('Role updated.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Role could not be updated.');
    }
  }

  async function updatePersonalWorkspaces(userId: string, canCreatePersonalWorkspaces: boolean): Promise<void> {
    setError(null);
    setStatus(null);
    try {
      await requestApi<{ updated: true }>(`/api/settings/users/${userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canCreatePersonalWorkspaces }),
      }, 'Personal Workspace permission could not be updated.');
      setUsers((current) => current.map((user) => user.id === userId ? { ...user, canCreatePersonalWorkspaces } : user));
      setStatus('Personal Workspace permission updated.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Personal Workspace permission could not be updated.');
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!resetUser) return;
    const formData = new FormData(event.currentTarget);
    setError(null);
    setStatus(null);
    const password = formData.get('password');
    const passwordConfirmation = formData.get('passwordConfirmation');
    if (!passwordsMatch(password, passwordConfirmation)) {
      setError('Passwords do not match.');
      return;
    }
    setIsResetting(true);
    try {
      await requestApi<{ updated: true }>(`/api/settings/users/${resetUser.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, passwordConfirmation }),
      }, 'Password could not be reset.');
      setResetUser(null);
      setStatus(`${resetUser.name}'s password was reset. Their existing sessions were signed out.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Password could not be reset.');
    } finally {
      setIsResetting(false);
    }
  }

  async function deleteUser(user: ManagedUser): Promise<void> {
    setError(null);
    setStatus(null);
    setIsDeleting(true);
    try {
      await requestApi<{ deleted: true }>(
        `/api/settings/users/${user.id}`,
        { method: 'DELETE' },
        'User could not be deleted.',
      );
      setUsers((current) => current.filter(({ id }) => id !== user.id));
      setDeleteCandidate(null);
      setStatus(`${user.name} was deleted.`);
      restoreDialogFocus();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'User could not be deleted.');
    } finally {
      setIsDeleting(false);
    }
  }

  async function togglePermission(userId: string, moduleSlug: string, action: string, enabled: boolean): Promise<void> {
    const pendingKey = `${userId}:${moduleSlug}`;
    const currentActions = permissions[userId]?.[moduleSlug] ?? [];
    const actions = enabled
      ? Array.from(new Set([...currentActions, action]))
      : currentActions.filter((current) => current !== action);
    setError(null);
    setStatus(null);
    setPendingPermissions((current) => new Set(current).add(pendingKey));
    try {
      await requestApi<{ actions: string[] }>(`/api/settings/users/${userId}/permissions`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ moduleSlug, actions }),
      }, 'Permissions could not be updated.');
      setPermissions((current) => ({
        ...current,
        [userId]: { ...current[userId], [moduleSlug]: actions },
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Permissions could not be updated.');
    } finally {
      setPendingPermissions((current) => {
        const next = new Set(current);
        next.delete(pendingKey);
        return next;
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage roles, credentials, and per-plugin actions.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) setError(null); }}>
          <DialogTrigger asChild><Button id="create-user-button"><Plus data-icon="inline-start" />Create user</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create user</DialogTitle><DialogDescription>Add a local NAD account.</DialogDescription></DialogHeader>
            {error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <UserForm onSubmit={createUser} isSubmitting={isCreating} />
          </DialogContent>
        </Dialog>
      </div>

      {error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {status && !error ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{status}</p> : null}

      <div className="space-y-3">
        {users.map((user) => {
          const expanded = expandedUsers.has(user.id);
          const detailsId = `user-details-${user.id}`;

          return (
          <div key={user.id} className="rounded-xl border border-border/70 bg-card/35">
            <div className="flex flex-wrap items-center gap-4 px-5 py-4">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-4 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => {
                  setExpandedUsers((current) => {
                    const next = new Set(current);
                    if (expanded) next.delete(user.id);
                    else next.add(user.id);
                    return next;
                  });
                }}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium">{user.name.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="font-medium">{user.name}</span>{user.id === currentUserId ? <Badge variant="outline">You</Badge> : null}</span>
                  <span className="block truncate text-sm text-muted-foreground">{user.email}</span>
                </span>
                <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Select value={user.role} disabled={user.id === currentUserId} onValueChange={(role) => updateRole(user.id, role as UserRole)}>
                  <SelectTrigger aria-label={`Role for ${user.name}`} className="min-w-0 flex-1 sm:w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="restricted">Restricted</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={(event) => { rememberDialogTrigger(event.currentTarget); setError(null); setResetUser(user); }} aria-label={`Reset ${user.name}'s password`}><KeyRound /></Button>
                <Button variant="ghost" size="icon" disabled={user.id === currentUserId} className="text-destructive" onClick={(event) => { rememberDialogTrigger(event.currentTarget); setDeleteCandidate(user); }} aria-label={`Delete ${user.name}`}><Trash2 /></Button>
              </div>
            </div>
            {expanded ? <div id={detailsId} className="border-t border-border/60 px-5 py-5">
              <label className="mb-5 flex items-start justify-between gap-4 rounded-lg border border-border/60 px-3 py-3">
                <span><span className="block text-sm">Create personal Workspaces</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">Allows this user to create private tabs and arrange already approved plugin surfaces.</span></span>
                <Switch
                  checked={user.canCreatePersonalWorkspaces}
                  onCheckedChange={(checked) => void updatePersonalWorkspaces(user.id, checked)}
                />
              </label>
              {user.role === 'admin' ? (
                <p className="text-sm text-muted-foreground">Administrators have full access to every plugin and action.</p>
              ) : (
                <div className="space-y-6">
                  {modules.map((module) => (
                    <section key={module.slug}>
                      <h3 className="text-sm font-medium">{module.name}</h3>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {module.permissions.map((permission) => (
                          <label key={permission.action} className="flex items-start justify-between gap-4 rounded-lg border border-border/60 px-3 py-3">
                            <span><span className="block text-sm">{permission.label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{permission.description}</span></span>
                            <Switch
                              checked={(permissions[user.id]?.[module.slug] ?? []).includes(permission.action)}
                              disabled={pendingPermissions.has(`${user.id}:${module.slug}`)}
                              onCheckedChange={(checked) => togglePermission(user.id, module.slug, permission.action, checked)}
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div> : null}
          </div>
          );
        })}
      </div>

      <Dialog open={Boolean(resetUser)} onOpenChange={(open) => { if (!open && !isResetting) { setResetUser(null); restoreDialogFocus(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset password</DialogTitle><DialogDescription>Set a new local password for {resetUser?.name}.</DialogDescription></DialogHeader>
          <form method="post" className="space-y-4" onSubmit={resetPassword}>
            <div className="space-y-2"><Label htmlFor="reset-password">New password</Label><PasswordInput id="reset-password" name="password" autoComplete="new-password" minLength={10} maxLength={1024} required /></div>
            <div className="space-y-2"><Label htmlFor="reset-password-confirmation">Confirm new password</Label><PasswordInput id="reset-password-confirmation" name="passwordConfirmation" autoComplete="new-password" minLength={10} maxLength={1024} required /></div>
            {error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isResetting} onClick={() => { setResetUser(null); restoreDialogFocus(); }}>Cancel</Button>
              <Button type="submit" disabled={isResetting}>{isResetting ? 'Resetting…' : 'Reset password'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteCandidate)} onOpenChange={(open) => { if (!open && !isDeleting) { setDeleteCandidate(null); restoreDialogFocus(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
              Delete {deleteCandidate?.name}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the local account and its Dashboard layout. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDeleting} onClick={() => { setDeleteCandidate(null); restoreDialogFocus(); }}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={isDeleting || !deleteCandidate} onClick={() => { if (deleteCandidate) void deleteUser(deleteCandidate); }}>
              {isDeleting ? 'Deleting…' : 'Delete user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserForm({
  onSubmit,
  isSubmitting,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
}): React.JSX.Element {
  return (
    <form method="post" className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2"><Label htmlFor="new-name">Name</Label><Input id="new-name" name="name" required /></div>
      <div className="space-y-2"><Label htmlFor="new-email">Email</Label><Input id="new-email" name="email" type="email" required /></div>
      <div className="space-y-2"><Label htmlFor="new-password">Password</Label><PasswordInput id="new-password" name="password" autoComplete="new-password" minLength={10} maxLength={1024} required /></div>
      <div className="space-y-2"><Label htmlFor="new-password-confirmation">Confirm password</Label><PasswordInput id="new-password-confirmation" name="passwordConfirmation" autoComplete="new-password" minLength={10} maxLength={1024} required /></div>
      <div className="space-y-2"><Label htmlFor="new-role">Role</Label><Select name="role" defaultValue="member"><SelectTrigger id="new-role" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="member">Member</SelectItem><SelectItem value="restricted">Restricted</SelectItem></SelectContent></Select></div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Creating…' : 'Create user'}</Button>
    </form>
  );
}
