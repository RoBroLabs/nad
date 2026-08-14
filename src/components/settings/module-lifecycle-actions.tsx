'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
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
import type { ModuleReleaseSummary } from '@/lib/modules/installed/lifecycle';

type RetentionChoice = 'retain' | 'delete';

interface ModuleLifecycleActionsProps {
  moduleSlug: string;
  moduleName: string;
  releases: ModuleReleaseSummary[];
}

function shortDigest(digest: string): string {
  return digest.slice(0, 12);
}

export function canConfirmUninstall(pluginName: string, typedValue: string): boolean {
  return typedValue === pluginName;
}

export function ModuleLifecycleActions({
  moduleSlug,
  moduleName,
  releases,
}: ModuleLifecycleActionsProps): React.JSX.Element {
  const router = useRouter();
  const retainedReleases = useMemo(
    () => releases.filter(({ state }) => state === 'retained'),
    [releases],
  );
  const [selectedReleaseId, setSelectedReleaseId] = useState(
    retainedReleases.find(({ activationBlocked }) => !activationBlocked)?.releaseId ?? '',
  );
  const selectedRelease = retainedReleases.find(({ releaseId }) => releaseId === selectedReleaseId);
  const [configAndStorage, setConfigAndStorage] = useState<RetentionChoice>('retain');
  const [artifacts, setArtifacts] = useState<RetentionChoice>('retain');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');

  async function rollback(): Promise<void> {
    if (!selectedReleaseId) return;
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      const result = await requestApi<{ version: string }>(
        `/api/settings/modules/${moduleSlug}/rollback`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ releaseId: selectedReleaseId }),
        },
        'Rollback failed.',
      );
      setStatus(`Rolled back to ${result.version}.`);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Rollback failed.');
    } finally {
      setPending(false);
    }
  }

  async function uninstall(): Promise<void> {
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      await requestApi<unknown>(
        `/api/settings/modules/${moduleSlug}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ configAndStorage, artifacts }),
        },
        'Uninstall failed.',
      );
      setUninstallOpen(false);
      setConfirmationText('');
      router.push('/settings/modules');
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Uninstall failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border/70 bg-card/35 p-5">
      <div className="flex items-center gap-2">
        <Archive className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium">Lifecycle</h3>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Rollback and uninstall operate on retained signed releases. Disable keeps all data; uninstall asks what to keep before it runs.
      </p>

      {retainedReleases.length ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select value={selectedReleaseId} onValueChange={setSelectedReleaseId}>
            <SelectTrigger aria-label="Retained release">
              <SelectValue placeholder="Choose retained release" />
            </SelectTrigger>
            <SelectContent>
              {retainedReleases.map((release) => (
                <SelectItem key={release.releaseId} value={release.releaseId} disabled={release.activationBlocked}>
                  {release.version} · {shortDigest(release.digest)}{release.activationBlocked ? ' · revoked' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" disabled={pending || !selectedReleaseId || selectedRelease?.activationBlocked} onClick={() => void rollback()}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            Roll back
          </Button>
        </div>
      ) : (
        <p className="rounded-lg border border-border/60 bg-background/45 p-3 text-xs text-muted-foreground">
          No retained release is available for rollback yet.
        </p>
      )}

      <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Select value={configAndStorage} onValueChange={(value) => setConfigAndStorage(value as RetentionChoice)}>
          <SelectTrigger aria-label="Configuration and storage retention">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="retain">Keep config and storage</SelectItem>
            <SelectItem value="delete">Delete config and storage</SelectItem>
          </SelectContent>
        </Select>
        <Select value={artifacts} onValueChange={(value) => setArtifacts(value as RetentionChoice)}>
          <SelectTrigger aria-label="Artifact retention">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="retain">Keep package artifacts</SelectItem>
            <SelectItem value="delete">Delete package artifacts</SelectItem>
          </SelectContent>
        </Select>
        <Dialog open={uninstallOpen} onOpenChange={(open) => {
          setUninstallOpen(open);
          if (open) {
            setError(null);
            setStatus(null);
          } else {
            setConfirmationText('');
          }
        }}>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending}>
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              Uninstall
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Uninstall {moduleName}?</DialogTitle>
              <DialogDescription>
                NAD will disable and remove the plugin. Your retention choices below control whether configuration, storage and package artifacts stay available for a future reinstall.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border border-border/70 bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
                <p>Settings and storage: <span className="font-medium text-foreground">{configAndStorage === 'retain' ? 'keep' : 'delete'}</span></p>
                <p>Package artifacts: <span className="font-medium text-foreground">{artifacts === 'retain' ? 'keep' : 'delete'}</span></p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="uninstall-confirmation">Type the plugin name to confirm</Label>
                <Input
                  id="uninstall-confirmation"
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  placeholder={moduleName}
                  autoComplete="off"
                />
              </div>
            </div>
            {error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={pending || !canConfirmUninstall(moduleName, confirmationText)}
                onClick={() => void uninstall()}
              >
                {pending ? 'Uninstalling…' : 'Uninstall plugin'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {status ? <p className="text-xs text-primary" role="status">{status}</p> : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
