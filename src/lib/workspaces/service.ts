import 'server-only';

import { rawDb } from '@/lib/db';
import { generateId, now, safeJsonParse } from '@/lib/utils';
import type {
  WorkspaceAccess,
  WorkspaceAssignment,
  WorkspaceAssignmentSubject,
  WorkspaceDetail,
  WorkspaceKind,
  WorkspaceLayoutItem,
  WorkspaceNavigation,
  WorkspaceSummary,
  WorkspaceTab,
  WorkspaceTabKind,
  WorkspaceWidgetInstance,
} from '@/lib/workspaces/types';

const WORKSPACE_LIMITS = {
  personalPerUser: 20,
  global: 500,
  tabsPerWorkspace: 20,
  assignmentsPerWorkspace: 100,
} as const;

interface UserRow {
  id: string;
  role: 'admin' | 'member' | 'restricted';
  can_create_personal_workspaces: number;
}

interface WorkspaceRow {
  id: string;
  name: string;
  kind: WorkspaceKind;
  owner_user_id: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface AssignmentRow {
  id: string;
  workspace_id: string;
  subject_type: WorkspaceAssignmentSubject;
  subject_id: string;
  access: WorkspaceAccess;
}

interface TabRow {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  kind: WorkspaceTabKind;
  surface_module_slug: string | null;
  surface_id: string | null;
  connection_profile_id: string | null;
}

interface WidgetRow {
  id: string;
  tab_id: string;
  instance_id: string;
  module_slug: string;
  widget_id: string;
  connection_profile_id: string | null;
  chrome: WorkspaceWidgetInstance['chrome'];
  settings_json: string;
}

interface LayoutRow {
  tab_id: string;
  breakpoint: string;
  layout_json: string;
}

function getUser(userId: string): UserRow | undefined {
  return rawDb.prepare(`
    SELECT id, role, can_create_personal_workspaces
    FROM users
    WHERE id = ?
  `).get(userId) as UserRow | undefined;
}

function workspaceRow(workspaceId: string): WorkspaceRow | undefined {
  return rawDb.prepare(`
    SELECT id, name, kind, owner_user_id, pinned, created_at, updated_at
    FROM workspaces
    WHERE id = ?
  `).get(workspaceId) as WorkspaceRow | undefined;
}

function assignmentAccess(assignments: AssignmentRow[]): WorkspaceAccess | undefined {
  return assignments.some(({ access }) => access === 'edit')
    ? 'edit'
    : assignments.some(({ access }) => access === 'view')
      ? 'view'
      : undefined;
}

export function getWorkspaceAccess(userId: string, workspaceId: string): WorkspaceAccess | undefined {
  const user = getUser(userId);
  const workspace = workspaceRow(workspaceId);
  if (!user || !workspace) return undefined;
  if (user.role === 'admin') return 'edit';
  if (workspace.kind === 'personal') return workspace.owner_user_id === userId ? 'edit' : undefined;
  if (workspace.kind === 'template') return undefined;
  const assignments = rawDb.prepare(`
    SELECT id, workspace_id, subject_type, subject_id, access
    FROM workspace_assignments
    WHERE workspace_id = ?
      AND (
        subject_type = 'all'
        OR (subject_type = 'user' AND subject_id = ?)
        OR (subject_type = 'role' AND subject_id = ?)
      )
  `).all(workspaceId, userId, user.role) as AssignmentRow[];
  return assignmentAccess(assignments);
}

export function canCreatePersonalWorkspace(userId: string): boolean {
  const user = getUser(userId);
  return Boolean(user && (user.role === 'admin' || user.can_create_personal_workspaces === 1));
}

function tabsForWorkspace(workspaceId: string, includeContent: boolean): WorkspaceTab[] {
  const rows = rawDb.prepare(`
    SELECT id, workspace_id, name, position, kind,
           surface_module_slug, surface_id, connection_profile_id
    FROM workspace_tabs
    WHERE workspace_id = ?
    ORDER BY position, id
  `).all(workspaceId) as TabRow[];
  if (!includeContent) {
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      position: row.position,
      kind: row.kind,
      surfaceModuleSlug: row.surface_module_slug,
      surfaceId: row.surface_id,
      connectionProfileId: row.connection_profile_id,
      widgets: [],
      layouts: {},
    }));
  }
  const widgetStatement = rawDb.prepare(`
    SELECT id, tab_id, instance_id, module_slug, widget_id,
           connection_profile_id, chrome, settings_json
    FROM workspace_widget_instances
    WHERE tab_id = ?
    ORDER BY rowid
  `);
  const layoutStatement = rawDb.prepare(`
    SELECT tab_id, breakpoint, layout_json
    FROM workspace_tab_layouts
    WHERE tab_id = ?
    ORDER BY breakpoint
  `);
  return rows.map((row) => {
    const widgetRows = widgetStatement.all(row.id) as WidgetRow[];
    const layoutRows = layoutStatement.all(row.id) as LayoutRow[];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      position: row.position,
      kind: row.kind,
      surfaceModuleSlug: row.surface_module_slug,
      surfaceId: row.surface_id,
      connectionProfileId: row.connection_profile_id,
      widgets: widgetRows.map((widget) => ({
        instanceId: widget.instance_id,
        moduleSlug: widget.module_slug,
        widgetId: widget.widget_id,
        connectionProfileId: widget.connection_profile_id,
        chrome: widget.chrome,
        settings: safeJsonParse<Record<string, unknown>>(widget.settings_json) ?? {},
      })),
      layouts: Object.fromEntries(layoutRows.map((layout) => [
        layout.breakpoint,
        safeJsonParse<WorkspaceLayoutItem[]>(layout.layout_json) ?? [],
      ])),
    };
  });
}

function summary(row: WorkspaceRow, access: WorkspaceAccess): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ownerUserId: row.owner_user_id,
    pinned: row.pinned === 1,
    access,
    tabs: tabsForWorkspace(row.id, false).map(({ id, name, position, kind }) => ({ id, name, position, kind })),
  };
}

export function listWorkspaceNavigation(userId: string): WorkspaceNavigation {
  const user = getUser(userId);
  if (!user) return { mine: [], shared: [] };
  const rows = rawDb.prepare(`
    SELECT id, name, kind, owner_user_id, pinned, created_at, updated_at
    FROM workspaces
    WHERE kind != 'template'
    ORDER BY pinned DESC, lower(name), id
  `).all() as WorkspaceRow[];
  const visible = rows.flatMap((row) => {
    const access = getWorkspaceAccess(userId, row.id);
    return access ? [summary(row, access)] : [];
  });
  return {
    mine: visible.filter(({ kind, ownerUserId }) => kind === 'personal' && ownerUserId === userId),
    shared: visible.filter(({ kind, ownerUserId }) => kind === 'shared' || ownerUserId !== userId),
  };
}

export function listWorkspaceLibrary(userId: string): WorkspaceSummary[] {
  const user = getUser(userId);
  if (!user || user.role !== 'admin') return [];
  const rows = rawDb.prepare(`
    SELECT id, name, kind, owner_user_id, pinned, created_at, updated_at
    FROM workspaces
    ORDER BY kind, lower(name), id
  `).all() as WorkspaceRow[];
  return rows.map((row) => summary(row, 'edit'));
}

export function getWorkspaceDetail(userId: string, workspaceId: string): WorkspaceDetail | undefined {
  const row = workspaceRow(workspaceId);
  const access = getWorkspaceAccess(userId, workspaceId);
  if (!row || !access) return undefined;
  const assignments = rawDb.prepare(`
    SELECT id, workspace_id, subject_type, subject_id, access
    FROM workspace_assignments
    WHERE workspace_id = ?
    ORDER BY subject_type, subject_id
  `).all(workspaceId) as AssignmentRow[];
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ownerUserId: row.owner_user_id,
    pinned: row.pinned === 1,
    access,
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      subjectType: assignment.subject_type,
      subjectId: assignment.subject_type === 'all' ? null : assignment.subject_id,
      access: assignment.access,
    })),
    tabs: tabsForWorkspace(workspaceId, true),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertWorkspace(
  userId: string,
  name: string,
  kind: WorkspaceKind,
  ownerUserId: string | null,
): WorkspaceDetail {
  const workspaceId = generateId();
  const tabId = generateId();
  const timestamp = now();
  rawDb.transaction(() => {
    rawDb.prepare(`
      INSERT INTO workspaces
        (id, name, kind, owner_user_id, created_by, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(workspaceId, name, kind, ownerUserId, userId, timestamp, timestamp);
    rawDb.prepare(`
      INSERT INTO workspace_tabs
        (id, workspace_id, name, position, kind, surface_module_slug, surface_id, connection_profile_id)
      VALUES (?, ?, 'Overview', 0, 'grid', NULL, NULL, NULL)
    `).run(tabId, workspaceId);
  })();
  return getWorkspaceDetail(userId, workspaceId)!;
}

export function ensurePersonalWorkspace(userId: string): WorkspaceDetail | undefined {
  const user = getUser(userId);
  if (!user) return undefined;
  const existing = rawDb.prepare(`
    SELECT id
    FROM workspaces
    WHERE kind = 'personal' AND owner_user_id = ?
    ORDER BY created_at, id
    LIMIT 1
  `).get(userId) as { id: string } | undefined;
  if (existing) return getWorkspaceDetail(userId, existing.id);
  if (user.role !== 'admin' && user.can_create_personal_workspaces !== 1) return undefined;
  return insertWorkspace(userId, 'Home', 'personal', userId);
}

export function createWorkspace(
  userId: string,
  input: { name: string; kind: WorkspaceKind; ownerUserId?: string | null },
): WorkspaceDetail {
  const user = getUser(userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if ((rawDb.prepare('SELECT count(*) AS count FROM workspaces').get() as { count: number }).count >= WORKSPACE_LIMITS.global) {
    throw new Error('WORKSPACE_LIMIT');
  }
  if (input.kind === 'personal') {
    const ownerUserId = input.ownerUserId ?? userId;
    if (ownerUserId !== userId && user.role !== 'admin') throw new Error('FORBIDDEN');
    const owner = getUser(ownerUserId);
    if (!owner) throw new Error('OWNER_NOT_FOUND');
    if (user.role !== 'admin' && user.can_create_personal_workspaces !== 1) throw new Error('PERSONAL_WORKSPACES_DISABLED');
    const count = (rawDb.prepare(`
      SELECT count(*) AS count FROM workspaces WHERE kind = 'personal' AND owner_user_id = ?
    `).get(ownerUserId) as { count: number }).count;
    if (count >= WORKSPACE_LIMITS.personalPerUser) throw new Error('WORKSPACE_LIMIT');
    return insertWorkspace(userId, input.name, input.kind, ownerUserId);
  }
  if (user.role !== 'admin') throw new Error('FORBIDDEN');
  return insertWorkspace(userId, input.name, input.kind, null);
}

export function updateWorkspace(
  userId: string,
  workspaceId: string,
  input: { name?: string; pinned?: boolean },
): WorkspaceDetail {
  if (getWorkspaceAccess(userId, workspaceId) !== 'edit') throw new Error('FORBIDDEN');
  const current = workspaceRow(workspaceId);
  if (!current) throw new Error('NOT_FOUND');
  rawDb.prepare(`
    UPDATE workspaces
    SET name = ?, pinned = ?, updated_at = ?
    WHERE id = ?
  `).run(input.name ?? current.name, input.pinned === undefined ? current.pinned : input.pinned ? 1 : 0, now(), workspaceId);
  return getWorkspaceDetail(userId, workspaceId)!;
}

export function deleteWorkspace(userId: string, workspaceId: string): void {
  const user = getUser(userId);
  const workspace = workspaceRow(workspaceId);
  if (
    !user
    || !workspace
    || (user.role !== 'admin' && !(workspace.kind === 'personal' && workspace.owner_user_id === userId))
  ) throw new Error('FORBIDDEN');
  rawDb.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
}

export function createWorkspaceTab(
  userId: string,
  workspaceId: string,
  input: {
    name: string;
    kind: WorkspaceTabKind;
    surfaceModuleSlug?: string | null;
    surfaceId?: string | null;
    connectionProfileId?: string | null;
  },
): WorkspaceTab {
  if (getWorkspaceAccess(userId, workspaceId) !== 'edit') throw new Error('FORBIDDEN');
  const count = (rawDb.prepare('SELECT count(*) AS count FROM workspace_tabs WHERE workspace_id = ?').get(workspaceId) as { count: number }).count;
  if (count >= WORKSPACE_LIMITS.tabsPerWorkspace) throw new Error('TAB_LIMIT');
  if (input.kind === 'surface' && (!input.surfaceModuleSlug || !input.surfaceId)) throw new Error('SURFACE_REQUIRED');
  const position = (rawDb.prepare('SELECT coalesce(max(position), -1) + 1 AS position FROM workspace_tabs WHERE workspace_id = ?').get(workspaceId) as { position: number }).position;
  const id = generateId();
  rawDb.prepare(`
    INSERT INTO workspace_tabs
      (id, workspace_id, name, position, kind, surface_module_slug, surface_id, connection_profile_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    input.name,
    position,
    input.kind,
    input.kind === 'surface' ? input.surfaceModuleSlug : null,
    input.kind === 'surface' ? input.surfaceId : null,
    input.kind === 'surface' ? input.connectionProfileId ?? null : null,
  );
  rawDb.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now(), workspaceId);
  return tabsForWorkspace(workspaceId, true).find((tab) => tab.id === id)!;
}

export function updateWorkspaceTab(
  userId: string,
  workspaceId: string,
  tabId: string,
  input: { name?: string; position?: number; connectionProfileId?: string | null },
): WorkspaceTab {
  if (getWorkspaceAccess(userId, workspaceId) !== 'edit') throw new Error('FORBIDDEN');
  const row = rawDb.prepare(`
    SELECT id, workspace_id, name, position, kind, surface_module_slug, surface_id, connection_profile_id
    FROM workspace_tabs WHERE id = ? AND workspace_id = ?
  `).get(tabId, workspaceId) as TabRow | undefined;
  if (!row) throw new Error('NOT_FOUND');
  rawDb.prepare(`
    UPDATE workspace_tabs
    SET name = ?, position = ?, connection_profile_id = ?
    WHERE id = ? AND workspace_id = ?
  `).run(input.name ?? row.name, input.position ?? row.position, input.connectionProfileId === undefined ? row.connection_profile_id : input.connectionProfileId, tabId, workspaceId);
  rawDb.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now(), workspaceId);
  return tabsForWorkspace(workspaceId, true).find((tab) => tab.id === tabId)!;
}

export function deleteWorkspaceTab(userId: string, workspaceId: string, tabId: string): void {
  if (getWorkspaceAccess(userId, workspaceId) !== 'edit') throw new Error('FORBIDDEN');
  const count = (rawDb.prepare('SELECT count(*) AS count FROM workspace_tabs WHERE workspace_id = ?').get(workspaceId) as { count: number }).count;
  if (count <= 1) throw new Error('LAST_TAB');
  rawDb.prepare('DELETE FROM workspace_tabs WHERE id = ? AND workspace_id = ?').run(tabId, workspaceId);
  rawDb.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now(), workspaceId);
}

export function saveWorkspaceGrid(
  userId: string,
  workspaceId: string,
  tabId: string,
  grid: { widgets: WorkspaceWidgetInstance[]; layouts: Record<string, WorkspaceLayoutItem[]> },
): WorkspaceTab {
  if (getWorkspaceAccess(userId, workspaceId) !== 'edit') throw new Error('FORBIDDEN');
  const tab = rawDb.prepare(`
    SELECT id FROM workspace_tabs WHERE id = ? AND workspace_id = ? AND kind = 'grid'
  `).get(tabId, workspaceId) as { id: string } | undefined;
  if (!tab) throw new Error('NOT_FOUND');
  rawDb.transaction(() => {
    rawDb.prepare('DELETE FROM workspace_widget_instances WHERE tab_id = ?').run(tabId);
    rawDb.prepare('DELETE FROM workspace_tab_layouts WHERE tab_id = ?').run(tabId);
    const insertWidget = rawDb.prepare(`
      INSERT INTO workspace_widget_instances
        (id, tab_id, instance_id, module_slug, widget_id, connection_profile_id, chrome, settings_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const widget of grid.widgets) {
      insertWidget.run(
        generateId(),
        tabId,
        widget.instanceId,
        widget.moduleSlug,
        widget.widgetId,
        widget.connectionProfileId,
        widget.chrome,
        JSON.stringify(widget.settings),
      );
    }
    const insertLayout = rawDb.prepare(`
      INSERT INTO workspace_tab_layouts (id, tab_id, breakpoint, layout_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const [breakpoint, layout] of Object.entries(grid.layouts)) {
      insertLayout.run(generateId(), tabId, breakpoint, JSON.stringify(layout));
    }
    rawDb.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now(), workspaceId);
  })();
  return tabsForWorkspace(workspaceId, true).find((candidate) => candidate.id === tabId)!;
}

export function replaceWorkspaceAssignments(
  userId: string,
  workspaceId: string,
  assignments: Array<{ subjectType: WorkspaceAssignmentSubject; subjectId: string | null; access: WorkspaceAccess }>,
): WorkspaceAssignment[] {
  const user = getUser(userId);
  const workspace = workspaceRow(workspaceId);
  if (!user || user.role !== 'admin' || !workspace || workspace.kind !== 'shared') throw new Error('FORBIDDEN');
  if (assignments.length > WORKSPACE_LIMITS.assignmentsPerWorkspace) throw new Error('ASSIGNMENT_LIMIT');
  for (const assignment of assignments) {
    if (assignment.subjectType === 'all' && assignment.subjectId !== null) throw new Error('INVALID_ASSIGNMENT');
    if (assignment.subjectType === 'role' && !['admin', 'member', 'restricted'].includes(assignment.subjectId ?? '')) {
      throw new Error('INVALID_ASSIGNMENT');
    }
    if (assignment.subjectType === 'user') {
      if (!assignment.subjectId || !getUser(assignment.subjectId)) throw new Error('INVALID_ASSIGNMENT');
    }
  }
  rawDb.transaction(() => {
    rawDb.prepare('DELETE FROM workspace_assignments WHERE workspace_id = ?').run(workspaceId);
    const insert = rawDb.prepare(`
      INSERT INTO workspace_assignments (id, workspace_id, subject_type, subject_id, access)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const assignment of assignments) {
      insert.run(generateId(), workspaceId, assignment.subjectType, assignment.subjectType === 'all' ? '' : assignment.subjectId, assignment.access);
    }
    rawDb.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now(), workspaceId);
  })();
  return getWorkspaceDetail(userId, workspaceId)!.assignments;
}

export function cloneWorkspaceTemplate(
  userId: string,
  templateId: string,
  name: string,
): WorkspaceDetail {
  const user = getUser(userId);
  const template = workspaceRow(templateId);
  if (!user || !template || template.kind !== 'template') throw new Error('NOT_FOUND');
  if (user.role !== 'admin' && user.can_create_personal_workspaces !== 1) throw new Error('PERSONAL_WORKSPACES_DISABLED');
  // Templates are admin-library records. Read their content directly after the
  // kind check so non-admins may apply an explicitly selected public template
  // without gaining access to the library itself.
  const sourceTabs = tabsForWorkspace(templateId, true);
  const created = createWorkspace(userId, { name, kind: 'personal', ownerUserId: userId });
  rawDb.transaction(() => {
    rawDb.prepare('DELETE FROM workspace_tabs WHERE workspace_id = ?').run(created.id);
    for (const sourceTab of sourceTabs) {
      const tabId = generateId();
      const instanceIds = new Map<string, string>();
      rawDb.prepare(`
        INSERT INTO workspace_tabs
          (id, workspace_id, name, position, kind, surface_module_slug, surface_id, connection_profile_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(tabId, created.id, sourceTab.name, sourceTab.position, sourceTab.kind, sourceTab.surfaceModuleSlug, sourceTab.surfaceId);
      for (const widget of sourceTab.widgets) {
        const instanceId = generateId();
        instanceIds.set(widget.instanceId, instanceId);
        rawDb.prepare(`
          INSERT INTO workspace_widget_instances
            (id, tab_id, instance_id, module_slug, widget_id, connection_profile_id, chrome, settings_json)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(generateId(), tabId, instanceId, widget.moduleSlug, widget.widgetId, widget.chrome, JSON.stringify(widget.settings));
      }
      for (const [breakpoint, layout] of Object.entries(sourceTab.layouts)) {
        const remapped = layout.flatMap((item) => {
          const instanceId = instanceIds.get(item.i);
          return instanceId ? [{ ...item, i: instanceId }] : [];
        });
        rawDb.prepare(`
          INSERT INTO workspace_tab_layouts (id, tab_id, breakpoint, layout_json)
          VALUES (?, ?, ?, ?)
        `).run(generateId(), tabId, breakpoint, JSON.stringify(remapped));
      }
    }
  })();
  return getWorkspaceDetail(userId, created.id)!;
}
