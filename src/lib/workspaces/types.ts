export type WorkspaceKind = 'personal' | 'shared' | 'template';
export type WorkspaceAccess = 'view' | 'edit';
export type WorkspaceTabKind = 'grid' | 'surface';
export type WorkspaceAssignmentSubject = 'user' | 'role' | 'all';
export type WorkspaceWidgetChrome = 'standard' | 'solid' | 'frameless';

export interface WorkspaceAssignment {
  id: string;
  subjectType: WorkspaceAssignmentSubject;
  subjectId: string | null;
  access: WorkspaceAccess;
}
export interface WorkspaceLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface WorkspaceWidgetInstance {
  instanceId: string;
  moduleSlug: string;
  widgetId: string;
  connectionProfileId: string | null;
  chrome: WorkspaceWidgetChrome;
  settings: Record<string, unknown>;
}

export interface WorkspaceTab {
  id: string;
  workspaceId: string;
  name: string;
  position: number;
  kind: WorkspaceTabKind;
  surfaceModuleSlug: string | null;
  surfaceId: string | null;
  connectionProfileId: string | null;
  widgets: WorkspaceWidgetInstance[];
  layouts: Record<string, WorkspaceLayoutItem[]>;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  ownerUserId: string | null;
  access: WorkspaceAccess;
  pinned: boolean;
  tabs: Array<Pick<WorkspaceTab, 'id' | 'name' | 'position' | 'kind'>>;
}

export interface WorkspaceDetail extends Omit<WorkspaceSummary, 'tabs'> {
  assignments: WorkspaceAssignment[];
  tabs: WorkspaceTab[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNavigation {
  mine: WorkspaceSummary[];
  shared: WorkspaceSummary[];
}
