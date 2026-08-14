import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'nad-workspaces-'));
process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;

type WorkspaceService = typeof import('@/lib/workspaces/service');
type Database = typeof import('@/lib/db');
let service: WorkspaceService;
let database: Database;

function insertUser(id: string, role: 'admin' | 'member' | 'restricted', canCreate = true): void {
  database.rawDb.prepare(`
    INSERT INTO users
      (id, email, name, password_hash, role, can_create_personal_workspaces, created_at, updated_at)
    VALUES (?, ?, ?, 'hash', ?, ?, 'now', 'now')
  `).run(id, `${id}@example.test`, id, role, canCreate ? 1 : 0);
}

beforeAll(async () => {
  database = await import('@/lib/db');
  service = await import('@/lib/workspaces/service');
  insertUser('admin', 'admin');
  insertUser('member', 'member');
  insertUser('restricted', 'restricted', false);
});

afterAll(() => {
  database.rawDb.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('Workspace service', () => {
  it('creates a personal Home and keeps its tab/layout model independent', () => {
    const home = service.ensurePersonalWorkspace('member');
    expect(home).toMatchObject({ name: 'Home', kind: 'personal', access: 'edit' });
    expect(home?.tabs).toHaveLength(1);
    expect(service.listWorkspaceNavigation('member').mine.map(({ id }) => id)).toContain(home?.id);
    expect(service.ensurePersonalWorkspace('restricted')).toBeUndefined();
  });

  it('intersects shared Workspace access with user and built-in role assignments', () => {
    const shared = service.createWorkspace('admin', { name: 'Operations', kind: 'shared' });
    expect(service.getWorkspaceDetail('member', shared.id)).toBeUndefined();
    service.replaceWorkspaceAssignments('admin', shared.id, [
      { subjectType: 'role', subjectId: 'member', access: 'view' },
      { subjectType: 'user', subjectId: 'restricted', access: 'edit' },
    ]);
    expect(service.getWorkspaceAccess('member', shared.id)).toBe('view');
    expect(service.getWorkspaceAccess('restricted', shared.id)).toBe('edit');
  });

  it('retains inaccessible Widget references and connection selection in a grid', () => {
    const home = service.ensurePersonalWorkspace('member')!;
    const tab = home.tabs[0];
    const saved = service.saveWorkspaceGrid('member', home.id, tab.id, {
      widgets: [{
        instanceId: 'instance:one',
        moduleSlug: 'unavailable-plugin',
        widgetId: 'status',
        connectionProfileId: null,
        chrome: 'standard',
        settings: {},
      }],
      layouts: { lg: [{ i: 'instance:one', x: 0, y: 0, w: 4, h: 3 }] },
    });
    expect(saved.widgets[0]).toMatchObject({ moduleSlug: 'unavailable-plugin', widgetId: 'status' });
    expect(saved.layouts.lg[0]).toMatchObject({ i: 'instance:one', w: 4 });
  });

  it('clones templates without copying environment-specific connection IDs', () => {
    const template = service.createWorkspace('admin', { name: 'Media stack', kind: 'template' });
    const sourceTab = template.tabs[0];
    service.saveWorkspaceGrid('admin', template.id, sourceTab.id, {
      widgets: [{
        instanceId: 'template-widget',
        moduleSlug: 'plex',
        widgetId: 'now-playing',
        connectionProfileId: null,
        chrome: 'frameless',
        settings: {},
      }],
      layouts: { lg: [{ i: 'template-widget', x: 0, y: 0, w: 6, h: 4 }] },
    });
    const clone = service.cloneWorkspaceTemplate('member', template.id, 'Media room');
    expect(clone.kind).toBe('personal');
    expect(clone.tabs[0].widgets[0]).toMatchObject({
      moduleSlug: 'plex',
      connectionProfileId: null,
      chrome: 'frameless',
    });
    expect(clone.tabs[0].layouts.lg[0].i).toBe(clone.tabs[0].widgets[0].instanceId);
  });
});
