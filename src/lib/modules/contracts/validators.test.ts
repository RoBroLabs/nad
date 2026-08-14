import { describe, expect, it } from 'vitest';
import { validateContractDocument } from '@/lib/modules/contracts/validators';

const manifestFixture = {
  schemaVersion: 1,
  id: 'dev.robrolabs.status-demo',
  slug: 'status-demo',
  name: 'Status Demo',
  description: 'A contract fixture.',
  icon: 'activity',
  category: 'monitoring',
  version: '1.0.0',
  publisher: 'Robro Labs',
  compatibility: { core: '>=0.2.0 <1.0.0', hostApi: '1.x', uiApi: '1.x' },
  capabilities: [{ name: 'config.get', reason: 'Read declared configuration.' }],
  permissions: [{ action: 'view', label: 'View', risk: 'read', description: 'View status.' }],
  configSchema: [],
  dataMigrations: [{
    fromVersion: '1.0.0',
    toVersion: '1.0.1',
    config: [{ op: 'rename', from: 'old_key', to: 'new_key' }],
  }],
  entrypoints: {
    summary: {
      method: 'GET',
      kind: 'query',
      permission: 'view',
      handler: 'summary',
      requestSchema: 'schemas/endpoints/summary-input.json',
      responseSchema: 'schemas/endpoints/summary-output.json',
      timeoutClass: 'short',
      maxRequestBytes: 1024,
      maxResponseBytes: 65536,
    },
  },
};

const pagesFixture = {
  schemaVersion: 1,
  pages: [{
    path: '/',
    title: 'Status',
    source: { endpoint: 'summary', refreshIntervalMs: 15_000 },
    body: [{ type: 'metric', label: 'Online', valuePath: 'online' }],
  }],
};

const widgetsFixture = {
  schemaVersion: 1,
  widgets: [{
    id: 'summary',
    name: 'Summary',
    description: 'Current status.',
    defaultSize: { w: 4, h: 3 },
    source: { endpoint: 'summary', refreshIntervalMs: 15_000 },
    body: [{ type: 'status', label: 'State', valuePath: 'status' }],
  }],
};

describe('canonical contract validators', () => {
  it('accepts canonical manifest, pages, and widgets fixtures', () => {
    expect(validateContractDocument('manifest.schema.json', manifestFixture)).toEqual({ valid: true });
    expect(validateContractDocument('ui-pages.schema.json', pagesFixture)).toEqual({ valid: true });
    expect(validateContractDocument('ui-widgets.schema.json', widgetsFixture)).toEqual({ valid: true });
  });

  it('rejects raw manifest permissions that use the legacy defaultRole field', () => {
    const result = validateContractDocument('manifest.schema.json', {
      ...manifestFixture,
      permissions: [{ action: 'view', label: 'View', defaultRole: 'member' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects checksum and signature envelopes that omit canonical metadata', () => {
    expect(validateContractDocument('checksums.schema.json', {
      files: { 'manifest.json': 'a'.repeat(64) },
    }).valid).toBe(false);
    expect(validateContractDocument('signature.schema.json', {
      algorithm: 'Ed25519',
      keyId: 'test',
      signature: 'abc',
    }).valid).toBe(false);
  });

  it('accepts canonical host-call payloads and rejects legacy notification payloads', () => {
    expect(validateContractDocument('host-call.schema.json', {
      method: 'notifications.emit',
      params: {
        key: 'system-monitor.test',
        severity: 'info',
        title: 'System Monitor test',
        body: 'This event came from the installed package.',
      },
    })).toEqual({ valid: true });
    expect(validateContractDocument('host-call.schema.json', {
      method: 'notifications.emit',
      params: {
        title: 'Legacy',
        body: 'Missing key and severity.',
      },
    }).valid).toBe(false);
  });

  it('accepts canonical bounded endpoint schemas and rejects unsupported shapes', () => {
    expect(validateContractDocument('endpoint-schema.v1.schema.json', {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[a-z]+$' },
    })).toEqual({ valid: true });
    expect(validateContractDocument('endpoint-schema.v1.schema.json', {
      type: 'bogus',
    }).valid).toBe(false);
  });
});
