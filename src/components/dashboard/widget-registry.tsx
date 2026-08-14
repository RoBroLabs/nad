'use client';

import type { AvailableWidget } from '@/components/dashboard/types';
import { InstalledDataView } from '@/components/modules/declarative/installed-data-view';
import { InstalledSandboxSurface } from '@/components/modules/sandbox/installed-sandbox-surface';

export function WidgetRenderer({
  moduleSlug,
  availableDefinition,
  connectionProfileId,
  onConnectionProfileChange,
}: {
  moduleSlug: string;
  availableDefinition?: AvailableWidget;
  connectionProfileId?: string | null;
  onConnectionProfileChange?: (profileId: string) => void;
}): React.JSX.Element {
  if (availableDefinition?.sandboxSurfaceId) {
    return (
      <InstalledSandboxSurface
        moduleSlug={moduleSlug}
        surfaceId={availableDefinition.sandboxSurfaceId}
        title={availableDefinition.name}
        connectionProfileId={connectionProfileId}
        initialHeight={320}
        onPrimaryConnectionChange={onConnectionProfileChange}
      />
    );
  }
  if (availableDefinition?.installedView) {
    return (
      <InstalledDataView
        moduleSlug={moduleSlug}
        view={availableDefinition.installedView}
        compact
        connectionProfileId={connectionProfileId}
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      This plugin no longer provides this Widget.
    </div>
  );
}
