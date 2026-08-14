import { describe, expect, it } from 'vitest';
import { decodeWorkspaceRouteId, workspacePath } from './route-paths';

describe('Workspace route paths', () => {
  it('encodes persisted legacy identifiers as single URL segments', () => {
    expect(workspacePath('legacy-home-workspace:layout-id', 'legacy-home-tab:layout-id'))
      .toBe('/w/legacy-home-workspace%3Alayout-id/legacy-home-tab%3Alayout-id');
  });

  it('accepts encoded and already-decoded identifiers from Next.js params', () => {
    expect(decodeWorkspaceRouteId('legacy-home-workspace%3Alayout-id'))
      .toBe('legacy-home-workspace:layout-id');
    expect(decodeWorkspaceRouteId('legacy-home-workspace:layout-id'))
      .toBe('legacy-home-workspace:layout-id');
  });

  it('rejects malformed, empty, oversized, or multi-segment values', () => {
    expect(decodeWorkspaceRouteId('')).toBeUndefined();
    expect(decodeWorkspaceRouteId('%')).toBeUndefined();
    expect(decodeWorkspaceRouteId('workspace%2Ftab')).toBeUndefined();
    expect(decodeWorkspaceRouteId(`workspace-${'x'.repeat(256)}`)).toBeUndefined();
  });
});
