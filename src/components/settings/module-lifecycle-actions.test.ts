import { describe, expect, it } from 'vitest';
import { canConfirmUninstall } from '@/components/settings/module-lifecycle-actions';

describe('plugin lifecycle actions', () => {
  it('requires the exact plugin name before enabling uninstall confirmation', () => {
    expect(canConfirmUninstall('System Monitor', '')).toBe(false);
    expect(canConfirmUninstall('System Monitor', 'system monitor')).toBe(false);
    expect(canConfirmUninstall('System Monitor', 'System Monitor ')).toBe(false);
    expect(canConfirmUninstall('System Monitor', 'System Monitor')).toBe(true);
  });
});
