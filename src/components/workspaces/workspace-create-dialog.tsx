'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
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
import { requestApi } from '@/lib/client-api';
import type { WorkspaceDetail } from '@/lib/workspaces/types';
import { workspacePath } from '@/lib/workspaces/route-paths';

export function WorkspaceCreateDialog({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const workspace = await requestApi<WorkspaceDetail>('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), kind: 'personal' }),
      }, 'Workspace could not be created.');
      setOpen(false);
      const tab = workspace.tabs[0];
      router.push(workspacePath(workspace.id, tab?.id));
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Workspace could not be created.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon-sm' : 'sm'} className={compact ? '' : 'w-full justify-start text-muted-foreground'} aria-label="Create personal Workspace">
          <Plus data-icon={compact ? undefined : 'inline-start'} aria-hidden="true" />
          {compact ? null : 'New Workspace'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create personal Workspace</DialogTitle>
          <DialogDescription>Add a private set of tabs and Widget layouts. You can use only Apps and connections already assigned to you.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2"><Label htmlFor="new-workspace-name">Name</Label><Input id="new-workspace-name" name="name" placeholder="Media room" maxLength={80} required /></div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create Workspace'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
