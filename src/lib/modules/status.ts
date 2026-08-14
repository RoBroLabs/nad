import type { ModuleStatus } from '@/lib/modules/types';

/** Human-readable installed-plugin lifecycle labels for core-owned UI. */
export function moduleStatusLabel(status: ModuleStatus): string {
  if (status === 'quarantined') return 'Quarantined';
  if (status === 'discovered') return 'Disabled';
  if (status === 'enabled') return 'Needs configuration';
  return 'Configured';
}
