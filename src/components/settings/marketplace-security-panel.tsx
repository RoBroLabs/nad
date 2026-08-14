import { ExternalLink, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { InstalledMarketplaceSecurityState } from '@/lib/marketplace/security';
import { Badge } from '@/components/ui/badge';

function shortDigest(value: string): string {
  return value.slice(0, 12);
}

export function MarketplaceSecurityPanel({
  state,
}: {
  state: InstalledMarketplaceSecurityState;
}): React.JSX.Element {
  const findings = state.installedFindings.filter((finding) =>
    finding.revocations.length > 0
    || finding.advisories.some(({ status }) => status === 'open')
    || finding.recommendation?.updateAvailable);

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card/35" aria-labelledby="marketplace-security-title">
      <div className="flex flex-col gap-3 border-b border-border/60 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {findings.some(({ quarantineRequired }) => quarantineRequired)
              ? <ShieldAlert className="size-4 text-warning" aria-hidden="true" />
              : <ShieldCheck className="size-4 text-success" aria-hidden="true" />}
            <h3 id="marketplace-security-title" className="text-sm font-medium">Plugin security and updates</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Signed metadata is matched locally to exact package digests and signing keys. NAD sends no installed-plugin inventory to the Marketplace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{state.mode === 'online' ? 'Online checks' : 'Manual mode'}</Badge>
          <Badge variant={state.freshness === 'current' ? 'secondary' : 'outline'}>
            {state.freshness === 'current' ? `Verified · sequence ${state.sequence}` : state.available ? 'Last snapshot stale' : 'No verified snapshot'}
          </Badge>
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="p-5">
          <p className="text-sm font-medium">No installed release needs attention</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {state.lastSucceededAt
              ? `Last verified ${new Date(state.lastSucceededAt).toLocaleString('en-GB')}.`
              : state.mode === 'manual'
                ? 'Manual mode makes no Marketplace request; locally retained warnings will still appear here.'
                : 'NAD has not retained a verified security snapshot yet.'}
          </p>
        </div>
      ) : findings.map((finding) => (
        <article key={finding.releaseId} className="border-b border-border/50 p-5 last:border-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium">{finding.moduleSlug} {finding.version}</h4>
            <Badge variant="outline" className="capitalize">{finding.releaseState}</Badge>
            {finding.quarantineRequired ? <Badge variant="destructive">Quarantined</Badge> : null}
            {finding.recommendation?.updateAvailable ? (
              <Badge variant="secondary">Update {finding.recommendation.version}</Badge>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">SHA-256 {shortDigest(finding.digest)}…</p>
          <div className="mt-3 space-y-3">
            {finding.revocations.map((revocation) => (
              <div key={revocation.id} className="rounded-lg border border-warning/35 bg-warning/10 p-3 text-xs leading-5">
                <p className="font-medium text-foreground">{revocation.id} · {revocation.action}</p>
                <p className="mt-1 text-muted-foreground">{revocation.summary}</p>
                {revocation.replacementVersion ? <p className="mt-1 text-muted-foreground">Replacement: {revocation.replacementVersion}</p> : null}
              </div>
            ))}
            {finding.advisories.filter(({ status }) => status === 'open').map((advisory) => (
              <div key={advisory.id} className="rounded-lg border border-border/70 bg-background/45 p-3 text-xs leading-5">
                <p className="font-medium text-foreground">{advisory.id} · {advisory.severity}</p>
                <p className="mt-1 text-muted-foreground">{advisory.guidance}</p>
                <a className="mt-2 inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4" href={advisory.url} target="_blank" rel="noreferrer">
                  Advisory details <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </div>
            ))}
          </div>
        </article>
      ))}

      {state.lastErrorCode ? (
        <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground" role="status">
          The latest check did not complete ({state.lastErrorCode}). NAD is retaining the last verified warnings and recommendations.
        </p>
      ) : null}
    </section>
  );
}
