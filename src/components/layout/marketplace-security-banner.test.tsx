import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketplaceSecurityBanner } from '@/components/layout/marketplace-security-banner';
import type { InstalledMarketplaceSecurityState } from '@/lib/marketplace/security';

const baseState: InstalledMarketplaceSecurityState = {
  mode: 'online',
  available: true,
  freshness: 'current',
  sequence: 7,
  recommendations: [],
  installedFindings: [],
};

describe('MarketplaceSecurityBanner', () => {
  it('stays hidden when verified metadata has no installed findings', () => {
    expect(renderToStaticMarkup(<MarketplaceSecurityBanner state={baseState} />)).toBe('');
  });

  it('keeps an exact-digest quarantine visible to administrators', () => {
    const markup = renderToStaticMarkup(<MarketplaceSecurityBanner state={{
      ...baseState,
      installedFindings: [{
        moduleId: 'dev.robrolabs.example',
        moduleSlug: 'example',
        moduleLifecycleState: 'quarantined',
        releaseId: 'release-1',
        version: '1.0.0',
        digest: 'a'.repeat(64),
        signerKeyId: 'first-party-test',
        releaseState: 'active',
        advisories: [],
        revocations: [{
          id: 'NAD-REV-TEST-001',
          moduleId: 'dev.robrolabs.example',
          targetType: 'artifact',
          targetValue: 'a'.repeat(64),
          moduleSlug: 'example',
          moduleName: 'Example',
          version: '1.0.0',
          severity: 'critical',
          action: 'quarantine',
          publishedAt: '2026-08-12T20:00:00.000Z',
          updatedAt: '2026-08-12T20:00:00.000Z',
          reason: 'test',
          summary: 'A controlled critical fixture.',
        }],
        quarantineRequired: true,
      }],
    }} />);

    expect(markup).toContain('Plugin execution quarantined');
    expect(markup).toContain('retaining settings, artifacts and history');
    expect(markup).toContain('href="/settings/modules"');
  });

  it('reports stale last-known-good metadata without implying plugins stopped', () => {
    const markup = renderToStaticMarkup(<MarketplaceSecurityBanner state={{
      ...baseState,
      freshness: 'stale',
      lastErrorCode: 'MARKETPLACE_SECURITY_UNAVAILABLE',
    }} />);
    expect(markup).toContain('security status is stale');
    expect(markup).toContain('Installed plugins remain available');
  });

  it('keeps a warning visible while an affected rollback artifact is retained', () => {
    const markup = renderToStaticMarkup(<MarketplaceSecurityBanner state={{
      ...baseState,
      installedFindings: [{
        moduleId: 'dev.robrolabs.example',
        moduleSlug: 'example',
        moduleLifecycleState: 'active',
        releaseId: 'release-retained',
        version: '1.0.0',
        digest: 'b'.repeat(64),
        signerKeyId: 'first-party-test',
        releaseState: 'retained',
        advisories: [],
        revocations: [{
          id: 'NAD-REV-TEST-002',
          moduleId: 'dev.robrolabs.example',
          targetType: 'artifact',
          targetValue: 'b'.repeat(64),
          moduleSlug: 'example',
          moduleName: 'Example',
          version: '1.0.0',
          severity: 'moderate',
          action: 'warn',
          publishedAt: '2026-08-12T20:00:00.000Z',
          updatedAt: '2026-08-12T20:00:00.000Z',
          reason: 'test',
          summary: 'Retained rollback release needs attention.',
        }],
        quarantineRequired: false,
      }],
    }} />);

    expect(markup).toContain('Plugin security notice');
    expect(markup).toContain('1 installed plugin has signed advisory or revocation guidance');
  });
});
