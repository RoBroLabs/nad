import { describe, expect, it } from 'vitest';
import { createModuleUpdateChanges } from '@/lib/modules/installed/install-review';
import type { ModuleManifest } from '@/lib/modules/types';

function manifest(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    slug: 'status-demo',
    name: 'Status Demo',
    description: 'Review fixture.',
    icon: 'activity',
    category: 'monitoring',
    version: '1.0.0',
    source: 'installed',
    capabilities: [{ name: 'config.get', reason: 'Read settings.' }],
    httpAccess: [{
      scheme: 'https',
      hostConfig: 'host',
      port: 443,
      path: '/metrics',
      methods: ['GET'],
    }],
    configSchema: [
      { key: 'host', label: 'Host', type: 'text', required: true },
      { key: 'legacy_token', label: 'Legacy token', type: 'secret', required: false },
    ],
    widgets: [],
    pages: [],
    permissions: [{
      action: 'view',
      label: 'View',
      description: 'View status.',
      defaultRole: 'member',
    }],
    ...overrides,
  };
}

describe('Module update review', () => {
  it('reports added, removed, and changed access and configuration declarations', () => {
    const current = manifest();
    const next = manifest({
      version: '1.1.0',
      capabilities: [
        { name: 'config.get', reason: 'Read settings and connection details.' },
        { name: 'notifications.emit', reason: 'Ask core to notify administrators.' },
      ],
      httpAccess: [{
        scheme: 'https',
        hostConfig: 'host',
        port: 443,
        path: '/metrics',
        methods: ['GET', 'POST'],
      }],
      configSchema: [
        { key: 'host', label: 'Metrics host', type: 'text', required: true },
        { key: 'interval', label: 'Interval', type: 'number', required: false, defaultValue: 30 },
      ],
      permissions: [
        { action: 'view', label: 'View status', description: 'View all status.', defaultRole: 'member' },
        { action: 'notify', label: 'Send notification', description: 'Send a test notification.', defaultRole: 'admin' },
      ],
    });

    const changes = createModuleUpdateChanges(current, next);

    expect(changes.capabilities.added.map(({ name }) => name)).toEqual(['notifications.emit']);
    expect(changes.capabilities.changed).toHaveLength(1);
    expect(changes.permissions.added.map(({ action }) => action)).toEqual(['notify']);
    expect(changes.permissions.changed).toHaveLength(1);
    expect(changes.configFields.added.map(({ key }) => key)).toEqual(['interval']);
    expect(changes.configFields.removed.map(({ key }) => key)).toEqual(['legacy_token']);
    expect(changes.configFields.changed).toHaveLength(1);
    expect(changes.httpAccess.changed[0]?.after.methods).toEqual(['GET', 'POST']);
    expect(changes.dataMigration).toMatchObject({ mode: 'reuse' });
  });

  it('reports no declaration changes for a version-only update', () => {
    const current = manifest();
    const changes = createModuleUpdateChanges(current, manifest({ version: '1.0.1' }));

    expect(changes.capabilities).toEqual({ added: [], removed: [], changed: [] });
    expect(changes.permissions).toEqual({ added: [], removed: [], changed: [] });
    expect(changes.configFields).toEqual({ added: [], removed: [], changed: [] });
    expect(changes.httpAccess).toEqual({ added: [], removed: [], changed: [] });
  });
});
