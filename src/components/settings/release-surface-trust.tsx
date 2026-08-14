'use client';

import { useState } from 'react';
import { Check, Shield, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestApi } from '@/lib/client-api';
import type { ReleaseSurfaceTrust } from '@/lib/modules/installed/trust';

export function ReleaseSurfaceTrustEditor({
  appId,
  digest,
  initialSurfaces,
}: {
  appId: string;
  digest: string;
  initialSurfaces: Array<ReleaseSurfaceTrust & { name: string }>;
}): React.JSX.Element | null {
  const [surfaces, setSurfaces] = useState(initialSurfaces);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!surfaces.length) return null;

  async function decide(trusted: boolean): Promise<void> {
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      await requestApi(`/api/settings/apps/${encodeURIComponent(appId)}/trust`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trusted,
          surfaceIds: surfaces.map(({ surfaceId }) => surfaceId),
        }),
      }, 'Exact-release UI decision could not be saved.');
      setSurfaces((current) => current.map((surface) => ({
        ...surface,
        mode: trusted && surface.policy !== 'sandbox_only' ? 'trusted' : 'sandboxed',
        basis: 'manual',
      })));
      setMessage(trusted
        ? 'This exact release is approved for reviewed bridge privileges.'
        : 'This exact release is restricted to the minimum sandbox bridge.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Exact-release UI decision could not be saved.');
    } finally {
      setPending(false);
    }
  }

  const trusted = surfaces.every(({ mode }) => mode === 'trusted');
  return (
    <section className="space-y-3 border-t border-border/60 pt-5" aria-labelledby="release-ui-trust-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="release-ui-trust-heading" className="text-sm font-medium">Exact-release UI trust</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            The decision is bound to digest <span className="font-mono">{digest.slice(0, 12)}</span> and never carries to an update. Every surface still runs in an opaque-origin iframe without NAD cookies, raw secrets or direct network access.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs ${trusted ? 'text-success' : 'text-muted-foreground'}`}>
          {trusted ? <Shield className="size-3.5" aria-hidden="true" /> : <ShieldOff className="size-3.5" aria-hidden="true" />}
          {trusted ? 'Manually approved' : 'Sandbox bridge only'}
        </span>
      </div>
      <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        {surfaces.map((surface) => <li key={surface.surfaceId}>• {surface.name}</li>)}
      </ul>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="flex items-center gap-1.5 text-sm text-success"><Check className="size-4" aria-hidden="true" />{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending || !trusted} onClick={() => void decide(false)}>
          <ShieldOff data-icon="inline-start" aria-hidden="true" />Sandbox only
        </Button>
        <Button size="sm" disabled={pending || trusted || surfaces.some(({ revoked, policy }) => revoked || policy === 'sandbox_only')} onClick={() => void decide(true)}>
          <Shield data-icon="inline-start" aria-hidden="true" />Approve exact release
        </Button>
      </div>
    </section>
  );
}
