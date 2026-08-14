import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

const admin = {
  email: 'admin@example.test',
  password: 'phase8-admin-password',
};
const restricted = {
  email: 'restricted@example.test',
  password: 'phase8-restricted-password',
};

async function expectNoSeriousAccessibilityViolations(page: Page): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  const violations = scan.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function createRestrictedUser(page: Page): Promise<void> {
  const response = await page.request.post('/api/settings/users', {
    headers: { origin: 'http://127.0.0.1:3210' },
    data: {
      name: 'Restricted User',
      email: restricted.email,
      password: restricted.password,
      passwordConfirmation: restricted.password,
      role: 'restricted',
    },
  });
  expect(response.status()).toBe(201);
}

async function proveRestrictedIsolation(browser: Browser): Promise<void> {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3210' });
  try {
    const page = await context.newPage();
    await signIn(page, restricted.email, restricted.password);
    await expect(page.getByText('Settings', { exact: true })).toHaveCount(0);
    const usersResponse = await page.request.get('/api/settings/users');
    expect(usersResponse.status()).toBe(403);
    await page.goto('/settings/users');
    await expect(page).not.toHaveURL(/\/settings/);
    await expectNoSeriousAccessibilityViolations(page);
  } finally {
    await context.close();
  }
}

async function replacePersonalWorkspaceWithLegacyRouteIds(): Promise<void> {
  const dataDirectory = resolve(process.cwd(), 'test-results/e2e-data');
  const rawDb = new Database(resolve(dataDirectory, 'nad.db'));
  rawDb.pragma('foreign_keys = ON');
  try {
    const user = rawDb.prepare('SELECT id FROM users WHERE email = ?').get(admin.email) as { id: string } | undefined;
    if (!user) throw new Error('Phase 8 administrator is missing.');
    const timestamp = new Date().toISOString();
    rawDb.transaction(() => {
      rawDb.prepare("DELETE FROM workspaces WHERE kind = 'personal' AND owner_user_id = ?").run(user.id);
      rawDb.prepare(`
        INSERT INTO workspaces
          (id, name, kind, owner_user_id, created_by, pinned, created_at, updated_at)
        VALUES (?, 'Home', 'personal', ?, ?, 1, ?, ?)
      `).run('legacy-home-workspace:browser-gate', user.id, user.id, timestamp, timestamp);
      rawDb.prepare(`
        INSERT INTO workspace_tabs
          (id, workspace_id, name, position, kind, surface_module_slug, surface_id, connection_profile_id)
        VALUES (?, ?, 'Overview', 0, 'grid', NULL, NULL, NULL)
      `).run('legacy-home-tab:browser-gate', 'legacy-home-workspace:browser-gate');
    })();
  } finally {
    rawDb.close();
  }
}

test('fresh setup, authentication, RBAC, security headers and responsive accessibility', async ({ page, browser }) => {
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({
    data: { status: 'ok', database: 'ok', migrationVersion: 10 },
  });

  const unauthenticatedUsers = await page.request.get('/api/settings/users');
  expect(unauthenticatedUsers.status()).toBe(401);
  await expect(unauthenticatedUsers.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });

  const loginResponse = await page.request.get('/login');
  expect(loginResponse.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(loginResponse.headers()['x-content-type-options']).toBe('nosniff');
  expect(loginResponse.headers()['x-frame-options']).toBe('DENY');
  expect(loginResponse.headers()['x-powered-by']).toBeUndefined();

  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Set up NAD' })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByLabel('Your name').fill('Phase 8 Admin');
  await page.getByLabel('Email address').fill(admin.email);
  await page.getByLabel('Admin password').fill(admin.password);
  await page.getByLabel('Dashboard name').fill('NAD Phase 8');
  await page.getByRole('button', { name: 'Create dashboard' }).click();
  await expect(page).toHaveURL(/\/login\?setup=complete/);

  const repeatedSetup = await page.request.post('/api/setup', {
    data: {
      name: 'Second Admin',
      email: 'second@example.test',
      password: 'second-admin-password',
      dashboardName: 'Wrong dashboard',
    },
  });
  expect(repeatedSetup.status()).toBe(409);
  await expect(repeatedSetup.json()).resolves.toMatchObject({ code: 'SETUP_COMPLETE' });

  await page.getByLabel('Email address').fill(admin.email);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('The email or password is incorrect.', { exact: true })).toBeVisible();

  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText('Settings', { exact: true })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await replacePersonalWorkspaceWithLegacyRouteIds();
  await page.goto('/');
  await expect(page).toHaveURL(/\/w\/legacy-home-workspace%3Abrowser-gate\/legacy-home-tab%3Abrowser-gate$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await createRestrictedUser(page);
  await expectNoSeriousAccessibilityViolations(page);
  await proveRestrictedIsolation(browser);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/modules');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expectNoSeriousAccessibilityViolations(page);
});
