import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModuleInstallReviewDetails } from '@/components/settings/module-install-review';
import type { ModuleInstallReview } from '@/lib/modules/installed/install-review-types';

function updateReview(): ModuleInstallReview {
  return {
    moduleId: 'dev.robrolabs.system-monitor',
    slug: 'system-monitor',
    name: 'System Monitor',
    publisher: 'Robro Labs',
    version: '1.0.2',
    currentVersion: '1.0.1',
    operation: 'update',
    digest: 'a'.repeat(64),
    signatureStatus: 'verified',
    signerKeyId: 'robrolabs-test',
    compatibility: { core: '>=0.2.0', hostApi: '1.x', uiApi: '1.x' },
    capabilities: [
      { name: 'config.get', reason: 'Read settings.' },
      { name: 'notifications.emit', reason: 'Ask NAD to notify an administrator.' },
    ],
    permissions: [
      { action: 'view', label: 'View', description: 'View metrics.', defaultRole: 'member' },
      { action: 'notify', label: 'Notify', description: 'Send a notification.', defaultRole: 'admin' },
    ],
    configFields: [{ key: 'host', label: 'Host', type: 'text', required: true }],
    secretConfigFields: [],
    networkConfigFields: [{ key: 'host', label: 'Host' }],
    httpAccess: [{
      scheme: 'https',
      hostConfig: { key: 'host', label: 'Host' },
      port: 443,
      path: '/metrics',
      methods: ['GET'],
      effect: 'read',
      allowedHeaders: [],
      queryParameters: [],
      pathParameters: {},
    }],
    changes: {
      capabilities: {
        added: [{ name: 'notifications.emit', reason: 'Ask NAD to notify an administrator.' }],
        removed: [],
        changed: [],
      },
      permissions: {
        added: [{ action: 'notify', label: 'Notify', description: 'Send a notification.', defaultRole: 'admin' }],
        removed: [],
        changed: [],
      },
      configFields: { added: [], removed: [], changed: [] },
      httpAccess: { added: [], removed: [], changed: [] },
      dataMigration: { mode: 'reuse', summary: 'Existing settings are reused.' },
    },
  };
}

describe('plugin install review details', () => {
  it('makes new access and data migration behavior visible before update approval', () => {
    const markup = renderToStaticMarkup(<ModuleInstallReviewDetails review={updateReview()} />);

    expect(markup).toContain('Changes from 1.0.1 to 1.0.2');
    expect(markup).toContain('New plugin access or settings');
    expect(markup).toContain('Core service notifications.emit');
    expect(markup).toContain('Permission notify');
    expect(markup).toContain('Data migration:');
    expect(markup).toContain('Existing settings are reused.');
    expect(markup).toContain('Core services this plugin can use');
    expect(markup).toContain('User permissions this plugin adds');
  });
});
