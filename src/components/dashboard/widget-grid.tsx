'use client';

import ReactGridLayout from 'react-grid-layout';
import { WidgetCard } from '@/components/dashboard/widget-card';
import { WidgetRenderer } from '@/components/dashboard/widget-registry';
import type { AvailableWidget, DashboardWidgetInstance } from '@/components/dashboard/types';

const ResponsiveGridLayout = ReactGridLayout.WidthProvider(ReactGridLayout.Responsive);

interface WidgetGridProps {
  widgets: DashboardWidgetInstance[];
  layouts: ReactGridLayout.Layouts;
  editMode: boolean;
  availableWidgets: AvailableWidget[];
  onLayoutsChange: (layouts: ReactGridLayout.Layouts) => void;
  onRemove: (instanceId: string) => void;
  onConnectionProfileChange: (instanceId: string, profileId: string) => void;
}

export function WidgetGrid({
  widgets,
  layouts,
  editMode,
  availableWidgets,
  onLayoutsChange,
  onRemove,
  onConnectionProfileChange,
}: WidgetGridProps): React.JSX.Element {
  const availableByKey = new Map(availableWidgets.map((widget) => [
    `${widget.moduleSlug}:${widget.widgetId}`,
    widget,
  ]));

  return (
    <ResponsiveGridLayout
      className="-mx-3"
      layouts={layouts}
      breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
      cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
      rowHeight={78}
      margin={[16, 16]}
      containerPadding={[12, 0]}
      isDraggable={editMode}
      isResizable={editMode}
      draggableHandle=".widget-drag-handle"
      draggableCancel=".widget-control"
      onLayoutChange={(_layout, allLayouts) => onLayoutsChange(allLayouts)}
    >
      {widgets.map((widget, index) => {
        const availableDefinition = availableByKey.get(`${widget.moduleSlug}:${widget.widgetId}`);
        const allowed = Boolean(availableDefinition);
        return (
          <div
            key={widget.instanceId}
            className="widget-enter"
            style={{ '--enter-index': index } as React.CSSProperties}
          >
            <WidgetCard
              title={allowed ? availableDefinition?.name ?? 'Unknown Widget' : 'Unavailable Widget'}
              moduleName={allowed ? availableDefinition?.moduleName ?? widget.moduleSlug : 'Access unavailable'}
              editMode={editMode}
              chrome={widget.chrome ?? 'standard'}
              onRemove={() => onRemove(widget.instanceId)}
            >
              {allowed ? (
                <WidgetRenderer
                  moduleSlug={widget.moduleSlug}
                  availableDefinition={availableDefinition}
                  connectionProfileId={widget.connectionProfileId}
                  onConnectionProfileChange={(profileId) => onConnectionProfileChange(widget.instanceId, profileId)}
                />
              ) : (
                <div className="flex h-full min-h-24 items-center justify-center text-center text-sm text-muted-foreground">
                  This Widget is unavailable because its plugin is disabled, unconfigured, or no longer permitted.
                </div>
              )}
            </WidgetCard>
          </div>
        );
      })}
    </ResponsiveGridLayout>
  );
}
