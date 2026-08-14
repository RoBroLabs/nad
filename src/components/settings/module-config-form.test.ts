import { describe, expect, it } from 'vitest';
import { normalizeConfigValues, supportsConnectionTest } from '@/components/settings/module-config-form';
import type { ConfigField } from '@/lib/modules/types';

const fields: ConfigField[] = [{
  key: 'verify_ssl',
  label: 'Verify SSL',
  type: 'boolean',
  required: true,
  defaultValue: true,
}];

describe('normalizeConfigValues', () => {
  it('uses the returned boolean value instead of a previous/default value', () => {
    expect(normalizeConfigValues(fields, {
      verify_ssl: { value: 'false', masked: false, isSecret: false },
    })).toEqual({ verify_ssl: 'false' });
    expect(normalizeConfigValues(fields, {
      verify_ssl: { value: 'true', masked: false, isSecret: false },
    })).toEqual({ verify_ssl: 'true' });
  });
});

describe('supportsConnectionTest', () => {
  it('hides the action when the plugin does not declare a test endpoint', () => {
    expect(supportsConnectionTest()).toBe(false);
    expect(supportsConnectionTest('test')).toBe(true);
  });
});
