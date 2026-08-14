'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Globe, Lock, LockOpen, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { requestApi } from '@/lib/client-api';
import type { AccessMode } from '@/lib/access-url';

interface GeneralSettingsFormProps {
  initialCanonicalUrl: string | null;
  envCanonicalUrl: string | null;
  initialAccessMode: AccessMode;
  requestOrigin: string | null;
  dashboardName: string;
}

interface GeneralSettingsResponse {
  canonicalUrl: string | null;
  envCanonicalUrl: string | null;
  effectiveCanonicalUrl: string | null;
  accessMode: AccessMode;
  requestOrigin: string | null;
  redirectTo: string | null;
}

export function GeneralSettingsForm({
  initialCanonicalUrl,
  envCanonicalUrl,
  initialAccessMode,
  requestOrigin,
  dashboardName,
}: GeneralSettingsFormProps): React.JSX.Element {
  const [canonicalUrl, setCanonicalUrl] = useState(initialCanonicalUrl ?? '');
  const [lockEnabled, setLockEnabled] = useState(initialAccessMode === 'locked');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmLockOpen, setConfirmLockOpen] = useState(false);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);

  function restoreSaveFocus(): void {
    window.requestAnimationFrame(() => saveButtonRef.current?.focus());
  }

  const effectiveUrl = (() => {
    const trimmed = canonicalUrl.trim();
    if (trimmed) return trimmed;
    return envCanonicalUrl ?? null;
  })();

  const originMismatch = Boolean(
    lockEnabled
    && effectiveUrl
    && requestOrigin
    && requestOrigin !== effectiveUrl,
  );

  async function saveSettings(): Promise<void> {
    setError(null);
    setSaved(false);
    setIsSubmitting(true);
    try {
      const result = await requestApi<GeneralSettingsResponse>('/api/settings/general', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          canonicalUrl: canonicalUrl.trim(),
          accessMode: lockEnabled ? 'locked' : 'off',
        }),
      }, 'General settings could not be saved.');
      setCanonicalUrl(result.canonicalUrl ?? '');
      setLockEnabled(result.accessMode === 'locked');
      setSaved(true);
      if (result.redirectTo) {
        window.location.assign(result.redirectTo);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'General settings could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const turningLockOn = lockEnabled && initialAccessMode !== 'locked';
    if (turningLockOn) {
      setConfirmLockOpen(true);
      return;
    }
    void saveSettings();
  }

  return (
    <>
      <Card className="glass-subtle border-border/70">
        <CardHeader className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="size-4 text-primary" aria-hidden="true" />
            Access and dashboard URL
          </CardTitle>
          <CardDescription className="max-w-2xl leading-6">
            Set the address people use to reach {dashboardName}, then optionally lock access to it.
            When locked, browsers that open {dashboardName} by another address (for example a raw
            IP and port) are redirected to the dashboard URL and API calls from those addresses are refused.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="max-w-xl space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="canonicalUrl">Dashboard URL</Label>
              <Input
                id="canonicalUrl"
                name="canonicalUrl"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={envCanonicalUrl ?? 'https://dashboard.example.com'}
                value={canonicalUrl}
                onChange={(event) => {
                  setCanonicalUrl(event.target.value);
                  setSaved(false);
                }}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                An absolute HTTP(S) origin such as <code>https://dashboard.example.com</code> — no path or
                credentials. Leave empty to use the <code>APP_URL</code> environment default
                {envCanonicalUrl ? <> (<code>{envCanonicalUrl}</code>)</> : null}.
              </p>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border border-border/70 p-4">
              <div className="space-y-1">
                <Label htmlFor="accessLock" className="flex items-center gap-2 text-sm font-medium">
                  {lockEnabled
                    ? <Lock className="size-4 text-primary" aria-hidden="true" />
                    : <LockOpen className="size-4 text-muted-foreground" aria-hidden="true" />}
                  Lock access to the dashboard URL
                </Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  {lockEnabled
                    ? 'Only requests through the dashboard URL are answered.'
                    : 'All reachable addresses answer; sign-in warns when the address differs.'}
                </p>
              </div>
              <Switch
                id="accessLock"
                checked={lockEnabled}
                onCheckedChange={(checked) => {
                  setLockEnabled(checked);
                  setSaved(false);
                }}
                aria-label="Lock access to the dashboard URL"
              />
            </div>

            {originMismatch ? (
              <p role="alert" className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-sm leading-6">
                You are currently browsing through <code>{requestOrigin}</code>, which does not match the
                dashboard URL. After saving, this browser will be sent to <code>{effectiveUrl}</code> and
                you will sign in again there.
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {saved && !error ? (
              <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                General settings saved.
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
              <p className="text-xs leading-5 text-muted-foreground">
                Recovery: if the dashboard URL becomes unreachable, update <code>APP_URL</code> and restart,
                or remove the <code>canonical_url</code> row from the <code>app_settings</code> table.
              </p>
              <Button ref={saveButtonRef} type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={confirmLockOpen} onOpenChange={(open) => {
        setConfirmLockOpen(open);
        if (!open) restoreSaveFocus();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-warning" aria-hidden="true" />
              Lock access to {effectiveUrl ?? 'the dashboard URL'}?
            </DialogTitle>
            <DialogDescription className="leading-6">
              Every other address — including direct IP and port access — will redirect browsers to the
              dashboard URL and refuse API calls. Make sure the dashboard URL resolves for everyone who
              needs access before continuing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmLockOpen(false); restoreSaveFocus(); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmLockOpen(false);
                void saveSettings();
              }}
            >
              Lock access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
