import { expect, test } from '@playwright/test';

test('terminal dock offers Codex, Claude Code, and Qoder CLI and sends the selected agent', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const startBodies: Array<{ agent?: string; scope?: { type?: string } }> = [];
  await page.route('**/terminal/*/events**', async route => {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: '' });
  });
  await page.route('**/terminal/start', async route => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: 'shell-e2e', cwd: '/managed/project', cols: 100, rows: 28, eventSeq: 0 }),
    });
  });
  await page.route('**/terminal/codex/start', async route => {
    const body = route.request().postDataJSON();
    startBodies.push(body);
    if (body?.agent === 'claude') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Claude Code CLI was not found. Install Claude Code (`claude`) or add it to the app PATH, then restart LocalAtlas.' }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: `stub-${body?.agent}`, cwd: '/managed/project', cols: 100, rows: 28, eventSeq: 0, scopeKey: 'project', agent: body?.agent }),
    });
  });

  await page.goto('/');
  const registered = await page.request.get('/api/projects');
  const projects = await registered.json();
  if (projects.length === 0) {
    const imported = await page.request.post('/api/projects', {
      data: { path: process.env.LOCALATLAS_E2E_REPO, key: 'AGT', name: 'Agent Fixture' },
    });
    expect(imported.ok()).toBeTruthy();
    await page.reload();
  }
  await page.locator('.portfolio-project-card').first().getByRole('button').click();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Terminal' }).click();

  const heading = page.locator('.project-terminal-dock-heading');
  await expect(heading.getByRole('button', { name: 'CODEX', exact: true })).toBeVisible();
  await expect(heading.getByRole('button', { name: 'CLAUDE', exact: true })).toBeVisible();
  await expect(heading.getByRole('button', { name: 'QODER', exact: true })).toBeVisible();

  await heading.getByRole('button', { name: 'QODER', exact: true }).click();
  await expect(page.locator('.codex-terminal-title')).toContainText('Qoder CLI · project');
  expect(startBodies.at(-1)).toMatchObject({ agent: 'qoder', scope: { type: 'project' } });

  await heading.getByRole('button', { name: 'CLAUDE', exact: true }).click();
  await expect(page.locator('.header-notice')).toContainText('Claude Code CLI was not found');
  expect(startBodies.at(-1)).toMatchObject({ agent: 'claude' });
  await expect(page.locator('.codex-terminal-title')).toContainText('zsh');

  expect(pageErrors).toEqual([]);
});
