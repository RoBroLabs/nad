import React from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import type { InstalledMarketplaceSecurityState } from '@/lib/marketplace/security';

export function MarketplaceSecurityBanner({
  state,
}: {
  state: InstalledMarketplaceSecurityState;
}): React.JSX.Element | null {
  const affected = state.installedFindings.filter((finding) =>
    finding.revocations.length > 0
    || finding.advisories.some(({ status }) => status === 'open'));
  const quarantined = affected.filter((finding) => finding.quarantineRequired);
  const stale = state.available && (state.freshness === 'stale' || Boolean(state.lastErrorCode));
  if (affected.length === 0 && !stale) return null;

  const affectedPlugins = [...new Set(affected.map(({ moduleSlug }) => moduleSlug))];
  const title = quarantined.length
    ? 'Plugin execution quarantined'
    : affected.length
      ? 'Plugin security notice'
      : 'Marketplace security status is stale';
  const description = quarantined.length
    ? `NAD blocked ${quarantined.length} affected release${quarantined.length === 1 ? '' : 's'} while retaining settings, artifacts and history.`
    : affected.length
      ? `${affectedPlugins.length} installed plugin${affectedPlugins.length === 1 ? '' : 's'} ${affectedPlugins.length === 1 ? 'has' : 'have'} signed advisory or revocation guidance.`
      : 'NAD is using its last verified security snapshot. Installed plugins remain available while the Marketplace is unreachable.';

  return (
    <aside
      className="border-b border-warning/35 bg-warning/10 px-5 py-3 text-sm sm:px-7 lg:px-9"
      role="alert"
      aria-label="Plugin security status"
    >
      <div className="mx-auto flex w-full max-w-7xl items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <Link
          href="/settings/modules"
          className="shrink-0 text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          Review
        </Link>
      </div>
    </aside>
  );
}
