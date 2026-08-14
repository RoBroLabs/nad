import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Disposable database pattern: set DATABASE_URL before importing the module.
const dataDirectory = mkdtempSync(join(tmpdir(), 'nad-audit-test-'));
process.env.DATABASE_URL = `file:${join(dataDirectory, 'test.db')}`;

const { db } = await import('@/lib/db');
const { users } = await import('@/lib/db/schema');
const { getAuditLogPage, logAuditEvent } = await import('@/lib/db/audit');

afterAll(() => {
  rmSync(dataDirectory, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  const timestamp = '2026-08-06T10:00:00.000Z';
  await db.insert(users).values({
    id: 'actor-1',
    email: 'actor@example.test',
    name: 'Actor One',
    passwordHash: 'hash',
    role: 'admin',
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();

  for (let index = 0; index < 5; index += 1) {
    await logAuditEvent('actor-1', index % 2 === 0 ? 'enable_module' : 'update_module_config', 'docker', { index });
  }
  await logAuditEvent('actor-1', 'container_recreate', 'docker', { container: 'web' });
  await logAuditEvent(null, 'system_event', undefined, { reason: 'test' });
}

describe('getAuditLogPage', () => {
  it('returns paginated entries newest-first with actor identity and parsed details', async () => {
    await seed();

    const firstPage = await getAuditLogPage({ page: 1, pageSize: 3 });
    expect(firstPage.total).toBe(7);
    expect(firstPage.entries).toHaveLength(3);

    // Entries logged in the same millisecond may tie, so use action-filtered
    // queries for deterministic identity/detail assertions.
    const systemEntry = await getAuditLogPage({ action: 'system_event', page: 1, pageSize: 50 });
    expect(systemEntry.entries[0]?.actorName).toBeNull();
    expect(systemEntry.entries[0]?.userId).toBeNull();

    const actorEntries = await getAuditLogPage({ action: 'enable_module', page: 1, pageSize: 50 });
    const actorEntry = actorEntries.entries[0];
    expect(actorEntry?.userId).toBe('actor-1');
    expect(actorEntry?.actorName).toBe('Actor One');
    expect(actorEntry?.actorEmail).toBe('actor@example.test');
    expect(actorEntry?.details).toEqual({ index: expect.any(Number) });

    const secondPage = await getAuditLogPage({ page: 2, pageSize: 3 });
    expect(secondPage.entries).toHaveLength(3);
    const thirdPage = await getAuditLogPage({ page: 3, pageSize: 3 });
    expect(thirdPage.entries).toHaveLength(1);

    const seen = new Set([
      ...firstPage.entries,
      ...secondPage.entries,
      ...thirdPage.entries,
    ].map((entry) => entry.id));
    expect(seen.size).toBe(7);
  });

  it('filters by module and action', async () => {
    const filtered = await getAuditLogPage({ moduleSlug: 'docker', action: 'container_recreate', page: 1, pageSize: 50 });
    expect(filtered.total).toBe(1);
    expect(filtered.entries[0]?.details).toEqual({ container: 'web' });

    const none = await getAuditLogPage({ moduleSlug: 'network', page: 1, pageSize: 50 });
    expect(none.total).toBe(0);
  });

  it('keeps the opaque actor identifier after the user is deleted', async () => {
    await db.delete(users).run();

    const page = await getAuditLogPage({ action: 'container_recreate', page: 1, pageSize: 50 });
    expect(page.entries[0]?.userId).toBe('actor-1');
    expect(page.entries[0]?.actorName).toBeNull();
    expect(page.entries[0]?.actorEmail).toBeNull();
  });
});
