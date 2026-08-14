import { describe, expect, it } from 'vitest';
import { validateModuleConfig } from '@/lib/modules/config-validation';
import type { ModuleManifest } from '@/lib/modules/types';

const manifest: ModuleManifest = {
  slug: 'fixture',
  name: 'Fixture',
  description: 'Portable config validation fixture.',
  icon: 'box',
  category: 'tools',
  version: '1.0.0',
  configSchema: [
    { key: 'endpoint', label: 'Endpoint', type: 'url', required: true },
    { key: 'port', label: 'Port', type: 'number', required: false, min: 1, max: 65535 },
    { key: 'mode', label: 'Mode', type: 'select', required: false, options: [{ label: 'Read', value: 'read' }] },
  ],
  widgets: [],
  pages: [],
  permissions: [{ action: 'view', label: 'View', description: 'View.', defaultRole: 'member' }],
};

describe('validateModuleConfig', () => {
  it('validates portable required, URL, numeric, and select fields without Module imports', () => {
    expect(validateModuleConfig(manifest, {})).toMatchObject({ valid: false });
    expect(validateModuleConfig(manifest, { endpoint: 'http://user:pass@example.test' })).toMatchObject({ valid: false });
    expect(validateModuleConfig(manifest, { endpoint: 'https://example.test', port: '70000' })).toMatchObject({ valid: false });
    expect(validateModuleConfig(manifest, { endpoint: 'https://example.test', port: '9100', mode: 'read' })).toEqual({ valid: true });
  });
});
