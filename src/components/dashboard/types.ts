import type ReactGridLayout from 'react-grid-layout';
import type { InstalledWidgetView } from '@/lib/modules/types';

export interface DashboardWidgetInstance {
  instanceId: string;
  moduleSlug: string;
  widgetId: string;
  connectionProfileId?: string | null;
  chrome?: 'standard' | 'solid' | 'frameless';
  settings?: Record<string, unknown>;
}

export interface DashboardLayoutState {
  widgets: DashboardWidgetInstance[];
  layouts: ReactGridLayout.Layouts;
}

export interface AvailableWidget {
  moduleSlug: string;
  moduleName: string;
  widgetId: string;
  name: string;
  description: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  installedView?: InstalledWidgetView;
  sandboxSurfaceId?: string;
  connectionProfiles?: Array<{ id: string; name: string; isDefault: boolean }>;
}
