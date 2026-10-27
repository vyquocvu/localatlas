import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';

let repoPath: string;

test.beforeEach(() => {
  repoPath = mkdtempSync(path.join(tmpdir(), 'localatlas-routing-repo-'));
  writeFileSync(path.join(repoPath, 'README.md'), '# Routing fixture\n');
});

test.afterEach(() => {
  if (repoPath) rmSync(repoPath, { recursive: true, force: true });
});

test('project module routes survive reload and browser back/forward', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Import project/i }).first().click();
  await page.getByRole('textbox', { name: 'Project directory path' }).fill(repoPath);
  await page.getByRole('textbox', { name: 'Optional project key' }).fill('RTE');
  await page.getByRole('button', { name: 'Import Project', exact: true }).click();
  await expect(page.locator('.project-overview-title h1')).toHaveText(path.basename(repoPath));

  const projects = await (await page.request.get('/api/projects')).json();
  const project = projects.find((item: { key: string }) => item.key === 'RTE');
  expect(project).toBeTruthy();

  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/projects\\/${project.id}\\/tasks$`));
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Git activity', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/projects\\/${project.id}\\/activity$`));
  await expect(page.getByRole('heading', { name: 'Git activity' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Git activity' })).toBeVisible();

  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/projects\\/${project.id}\\/docs$`));
  await expect(page.getByRole('button', { name: /Atlas docs/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Atlas docs/ })).toBeVisible();

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/projects\\/${project.id}$`));
  await expect(page.locator('.project-overview-title h1')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#\\/projects\\/${project.id}\\/docs$`));
  await expect(page.getByRole('button', { name: /Atlas docs/ })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`#\\/projects\\/${project.id}$`));
  await expect(page.locator('.project-overview-title h1')).toBeVisible();
});
