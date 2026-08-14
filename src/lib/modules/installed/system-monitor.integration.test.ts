import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const packagePath = process.env.NAD_SYSTEM_MONITOR_PACKAGE;
const denoPath = process.env.NAD_DENO_PATH;
// The release gate executes the arm64 image under QEMU on the shared amd64
// runner; Deno startup and native SQLite work are substantially slower there.
const integrationTimeoutMs = 120_000;
const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('official System Monitor package', () => {
  it.skipIf(!packagePath || !denoPath)('installs, runs in Deno without network permission, and uses the core HTTP broker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nad-system-monitor-integration-'));
    directories.push(directory);
    process.env.DATABASE_URL = `file:${join(directory, 'nad.db')}`;
    process.env.NAD_DATA_DIR = directory;
    process.env.NAD_DENO_PATH = denoPath;
    delete process.env.NAD_BUILD_EPHEMERAL_DB;

    const upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end([
        'node_boot_time_seconds 1700000000',
        'node_memory_MemTotal_bytes 1000',
        'node_memory_MemAvailable_bytes 400',
        'node_filesystem_size_bytes{mountpoint="/"} 1000',
        'node_filesystem_avail_bytes{mountpoint="/"} 250',
        'node_cpu_seconds_total{cpu="0",mode="idle"} 75',
        'node_cpu_seconds_total{cpu="0",mode="user"} 25',
      ].join('\n'));
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP.');

    const database = await import('@/lib/db');
    const { installModulePackage } = await import('@/lib/modules/installed/lifecycle');
    const { verifyModulePackage } = await import('@/lib/modules/installed/package-verifier');
    const { getInstalledModule } = await import('@/lib/modules/installed/provider');
    const { createInstalledModuleHandler } = await import('@/lib/modules/installed/runner');
    database.rawDb.prepare(`
      INSERT INTO users
        (id, email, name, password_hash, role, created_at, updated_at)
      VALUES ('admin', 'admin@example.test', 'Admin', 'hash', 'admin', 'now', 'now')
    `).run();
    const archive = readFileSync(packagePath!);
    const verified = await verifyModulePackage(archive);
    await installModulePackage(archive, 'admin', { expectedDigest: verified.digest });
    const definition = getInstalledModule('system-monitor');
    expect(definition?.manifest.source).toBe('installed');
    const entrypoint = definition?.manifest.entrypoints?.metrics;
    if (!definition || !entrypoint) throw new Error('Installed metrics entrypoint was not discovered.');
    const config = {
      hosts: 'fixture|127.0.0.1',
      check_method: 'node_exporter',
      node_exporter_port: String(address.port),
    };
    const response = await createInstalledModuleHandler(definition, entrypoint)(
      new Request('http://nad.test/api/modules/system-monitor/metrics'),
      {
        config,
        moduleSlug: 'system-monitor',
        path: ['metrics'],
        userId: 'admin',
        notify: async () => undefined,
      },
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { totalHosts: number; onlineHosts: number; hosts: Array<{ name: string; status: string }> } };
    expect(payload.data).toMatchObject({ totalHosts: 1, onlineHosts: 1 });
    expect(payload.data.hosts[0]).toMatchObject({ name: 'fixture', status: 'online' });

    const notificationEntrypoint = definition.manifest.entrypoints?.['notification-test'];
    if (!notificationEntrypoint) throw new Error('Installed notification-test entrypoint was not discovered.');
    const notifications: Array<{ title: string; message: string; severity: string }> = [];
    const notificationResponse = await createInstalledModuleHandler(definition, notificationEntrypoint)(
      new Request('http://nad.test/api/modules/system-monitor/notification-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      {
        config,
        moduleSlug: 'system-monitor',
        path: ['notification-test'],
        userId: 'admin',
        notify: async (title, message, severity) => {
          notifications.push({ title, message, severity: severity ?? 'info' });
        },
      },
    );
    expect(notificationResponse.status).toBe(200);
    await expect(notificationResponse.json()).resolves.toEqual({ data: { accepted: true } });
    expect(notifications).toEqual([{
      title: 'System Monitor notification test',
      message: 'This test event was requested by the installed System Monitor Module and delivered by NAD core.',
      severity: 'info',
    }]);
    database.rawDb.close();
  }, integrationTimeoutMs);
});
