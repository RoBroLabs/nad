import 'server-only';

import {
  getInstalledMarketplaceSecurityState,
  refreshMarketplaceSecurity,
  type InstalledMarketplaceSecurityState,
} from '@/lib/marketplace/security';
import { quarantineInstalledModule } from '@/lib/modules/installed/lifecycle';

/**
 * Refreshes the bounded signed snapshot, then converges exact active releases
 * to the durable quarantined lifecycle state. Persisted revocation matching in
 * the request path blocks execution immediately, including while an existing
 * short invocation prevents the lifecycle transition from completing.
 */
export async function refreshAndEnforceMarketplaceSecurity(
  options: { force?: boolean; nowMilliseconds?: number } = {},
): Promise<InstalledMarketplaceSecurityState> {
  const state = await refreshMarketplaceSecurity(options);
  const pending = state.installedFindings.filter((finding) =>
    finding.releaseState === 'active'
    && finding.quarantineRequired
    && finding.moduleLifecycleState !== 'quarantined');

  for (const finding of pending) {
    const revocation = finding.revocations.find(({ action }) => action === 'quarantine');
    if (!revocation) continue;
    try {
      await quarantineInstalledModule(finding.moduleSlug, revocation.id, finding.digest);
    } catch (error) {
      // Persisted exact-digest/key matching already blocks new execution. An
      // in-flight request or another lifecycle operation is retried on the next
      // administrator view without making the Dashboard unavailable.
      console.error('Plugin quarantine lifecycle transition is pending', {
        moduleSlug: finding.moduleSlug,
        revocationId: revocation.id,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  return pending.length
    ? getInstalledMarketplaceSecurityState(options.nowMilliseconds)
    : state;
}
