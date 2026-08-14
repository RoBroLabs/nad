import { describe, expect, it } from 'vitest';
import { moduleStatusLabel } from '@/lib/modules/status';

describe('moduleStatusLabel', () => {
  it('uses plain-language plugin lifecycle labels', () => {
    expect(moduleStatusLabel('discovered')).toBe('Disabled');
    expect(moduleStatusLabel('enabled')).toBe('Needs configuration');
    expect(moduleStatusLabel('configured')).toBe('Configured');
    expect(moduleStatusLabel('quarantined')).toBe('Quarantined');
  });
});
