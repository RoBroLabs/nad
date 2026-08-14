'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, RotateCcw, ShieldCheck, Store } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ModuleInstallReviewDetails } from '@/components/settings/module-install-review';
import type { ModuleInstallReview } from '@/lib/modules/installed/install-review-types';

interface Listing {
  slug: string;
  name: string;
  summary: string;
  publisher: string;
  latestVersion: string;
  recommendedVersion: string;
  installedVersion?: string;
  installState: 'install' | 'current' | 'update' | 'different';
  status: string;
  permissions: Array<{ scope: string; level: string; reason: string }>;
  capabilities: Array<{ name: string; reason: string }>;
  review: { status: string; summary: string };
}

interface MarketplaceState {
  mode: 'online' | 'manual';
  configured: boolean;
  modules: Listing[];
}

async function loadMarketplace(): Promise<MarketplaceState> {
  const response = await fetch('/api/settings/modules/marketplace');
  const result = await response.json() as { data?: MarketplaceState; error?: string };
  if (!response.ok && !result.data) throw new Error(result.error ?? 'Marketplace is unavailable.');
  return result.data ?? { mode: 'online', configured: true, modules: [] };
}

export function MarketplaceBrowser(): React.JSX.Element {
  const router = useRouter();
  const query = useQuery({ queryKey: ['module-marketplace'], queryFn: loadMarketplace, retry: false });
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ModuleInstallReview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function request(listing: Listing, review?: ModuleInstallReview): Promise<void> {
    setPendingSlug(listing.slug);
    setMessage(null);
    try {
      const response = await fetch('/api/settings/modules/marketplace', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: listing.slug,
          confirm: Boolean(review),
          expectedDigest: review?.digest,
        }),
      });
      const result = await response.json() as { data?: { review?: ModuleInstallReview; version?: string }; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error ?? 'Marketplace request failed.');
      if (!review && result.data.review) {
        setCandidate(result.data.review);
        return;
      }
      setMessage(`${listing.name} ${result.data.version ?? listing.latestVersion} installed. Review its configuration before enabling it.`);
      setCandidate(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Marketplace install failed.');
    } finally {
      setPendingSlug(null);
    }
  }

  if (query.isLoading) {
    return (
      <section className="rounded-xl border border-border/70 bg-card/35 p-5" aria-busy="true">
        <div className="flex items-center gap-2"><Store className="size-4" aria-hidden="true" /><h3 className="text-sm font-medium">Plugin Marketplace</h3></div>
        <p className="mt-2 text-sm text-muted-foreground">Checking the Marketplace…</p>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="rounded-xl border border-border/70 bg-card/35 p-5">
        <div className="flex items-center gap-2"><Store className="size-4" aria-hidden="true" /><h3 className="text-sm font-medium">Marketplace unavailable</h3></div>
        <p className="mt-2 text-sm text-muted-foreground">NAD could not reach the Marketplace. You can still install a downloaded .nadmod file below.</p>
        <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>
          <RotateCcw data-icon="inline-start" aria-hidden="true" />
          Try again
        </Button>
      </section>
    );
  }
  const marketplace = query.data;
  if (!marketplace) return <div className="rounded-xl border border-border/70 bg-card/35 p-5 text-sm text-muted-foreground">The Marketplace returned no plugin catalog. Manual .nadmod upload still works.</div>;
  if (marketplace.mode !== 'online' || !marketplace.configured) {
    return (
      <section className="rounded-xl border border-border/70 bg-card/35 p-5">
        <div className="flex items-center gap-2"><Store className="size-4" aria-hidden="true" /><h3 className="text-sm font-medium">Marketplace offline</h3></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {marketplace.mode === 'manual' ? 'This Dashboard is in manual-install mode and makes no Marketplace requests.' : 'Set NAD_MARKETPLACE_URL to browse first-party plugins here.'} Manual file installation remains available.
        </p>
      </section>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card/35">
      <div className="border-b border-border/60 p-5">
        <div className="flex items-center gap-2"><Store className="size-4" aria-hidden="true" /><h3 className="text-sm font-medium">Plugin Marketplace</h3></div>
        <p className="mt-1 text-xs text-muted-foreground">Browse first-party plugins. NAD verifies the signed package and shows what access changes before anything is installed.</p>
        {message ? <p className="mt-2 text-xs text-primary" role="status">{message}</p> : null}
      </div>
      {marketplace.modules.length === 0 ? (
        <div className="p-5">
          <p className="text-sm font-medium">No plugins are available</p>
          <p className="mt-1 text-sm text-muted-foreground">The Marketplace is online, but its catalog is empty. Manual .nadmod upload still works.</p>
        </div>
      ) : marketplace.modules.map((listing) => {
        const review = candidate?.slug === listing.slug ? candidate : undefined;
        return (
          <div key={listing.slug} className="border-b border-border/50 p-5 last:border-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-medium">{listing.name}</h4>
                  <span className="text-xs text-muted-foreground">{listing.latestVersion} · {listing.publisher} · {listing.review.status}</span>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{listing.summary}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Permissions: {listing.permissions.map(({ scope }) => scope).join(', ') || 'none'} · Core services: {listing.capabilities.map(({ name }) => name).join(', ') || 'none'}
                </p>
              </div>
              {!review ? (
                <Button
                  variant="outline"
                  disabled={pendingSlug !== null || listing.installState === 'current'}
                  onClick={() => void request(listing)}
                >
                  <Download data-icon="inline-start" aria-hidden="true" />
                  {pendingSlug === listing.slug
                    ? 'Verifying…'
                    : listing.installState === 'current'
                      ? 'Installed'
                      : listing.installState === 'update'
                        ? 'Review update'
                        : listing.installState === 'different'
                          ? 'Review release'
                          : 'Review install'}
                </Button>
              ) : null}
            </div>
            {review ? (
              <div className="mt-4 border-t border-border/50 pt-4" role="region" aria-label={`Plugin install review for ${review.name}`}>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Verified package: {review.publisher} · {review.signatureStatus === 'verified' ? `signed by ${review.signerKeyId}` : 'unsigned development'} · Core {review.compatibility.core}
                    {review.currentVersion ? ` · updates ${review.currentVersion}` : ''}
                  </p>
                </div>
                <ModuleInstallReviewDetails review={review} />
                <p className="mt-2 break-all text-[11px] text-muted-foreground">SHA-256 {review.digest}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button disabled={pendingSlug !== null} onClick={() => void request(listing, review)}>
                    {pendingSlug === listing.slug ? 'Installing…' : review.operation === 'update' ? 'Approve update' : 'Approve install'}
                  </Button>
                  <Button variant="outline" disabled={pendingSlug !== null} onClick={() => setCandidate(null)}>Cancel</Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
