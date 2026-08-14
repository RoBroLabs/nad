import { describe, expect, it } from 'vitest';
import { parseWorkspaceGrid, parseWorkspaceName } from '@/lib/workspaces/validation';

describe('Workspace input validation', () => {
  it('accepts retained inaccessible widget references and connection selections', () => {
    expect(parseWorkspaceGrid({
      widgets: [{
        instanceId: 'instance:1',
        moduleSlug: 'proxmox',
        widgetId: 'guest-controls',
        connectionProfileId: 'profile:lab',
        chrome: 'frameless',
        settings: {},
      }],
      layouts: { lg: [{ i: 'instance:1', x: 0, y: 0, w: 6, h: 4 }] },
    })).toBeDefined();
  });

  it('rejects unknown layout instances and oversized settings', () => {
    expect(parseWorkspaceGrid({ widgets: [], layouts: { lg: [{ i: 'missing', x: 0, y: 0, w: 1, h: 1 }] } })).toBeUndefined();
    expect(parseWorkspaceGrid({
      widgets: [{ instanceId: 'one', moduleSlug: 'app', widgetId: 'widget', settings: { value: 'x'.repeat(8_193) } }],
      layouts: {},
    })).toBeUndefined();
  });

  it('bounds and trims workspace names', () => {
    expect(parseWorkspaceName('  Media room  ')).toBe('Media room');
    expect(parseWorkspaceName('')).toBeUndefined();
    expect(parseWorkspaceName('x'.repeat(81))).toBeUndefined();
  });
});
