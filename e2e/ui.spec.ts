import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

function gitStatus(repoPath: string): string {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' });
  } catch {
    return '';
  }
}

test('portfolio brings project docs, tasks, and read-only Git activity together', async ({ page }) => {
  const pageErrors: string[] = [];
  const repoPath = process.env.LOCALATLAS_E2E_REPO!;
  const repoName = path.basename(repoPath);
  const sourceStatusBeforeImport = gitStatus(repoPath);
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your projects, in one place.' })).toBeVisible();
  await page.getByRole('button', { name: /Import project/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Import a local project' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Project directory path' }).fill(repoPath);
  await page.getByRole('textbox', { name: 'Optional project key' }).fill('PW');
  await page.getByRole('button', { name: 'Import Project', exact: true }).click();

  await expect(page.locator('.project-overview-title h1')).toHaveText(repoName);
  await expect(page.getByText('Recent commits')).toBeVisible();
  await expect(page.locator('.project-commit-row').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
  await page.getByRole('button', { name: 'Create first task' }).click();
  await expect(page.getByRole('heading', { name: 'Create a task' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('button', { name: /Repo docs/ }).click();
  const readme = page.getByRole('button', { name: /README\.md/ }).first();
  await expect(readme).toBeVisible();
  await readme.click();
  await expect(page.getByText('Repository file · read-only')).toBeVisible();
  await expect(page.getByText('This file stays in the imported project.')).toBeVisible();

  await page.getByRole('button', { name: /Atlas docs/ }).click();
  page.once('dialog', dialog => dialog.accept('checklist.md'));
  await page.locator('.obsidian-vault-actions button').click();
  await expect(page.locator('textarea')).toBeVisible();
  await page.locator('textarea').fill('# Checklist\n\n- [ ] Playwright checkbox item\n');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const markdownCheckbox = page.getByRole('checkbox', { name: 'Playwright checkbox item' });
  await expect(markdownCheckbox).not.toBeChecked();
  await page.locator('.task-checkbox-host [data-slot="checkbox-content"]').click();
  await expect(markdownCheckbox).toBeChecked();
  await expect(page.locator('.header-notice')).toContainText('Saved checklist.md');

  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /New task/ }).last().click();
  await expect(page.getByRole('heading', { name: 'Create a task' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Task title' }).fill('Playwright UI task');
  await page.locator('.priority-choice button').click();
  await page.getByRole('option', { name: 'High' }).click();
  await page.getByRole('button', { name: 'Create Task' }).click();

  const taskCard = page.locator('.kanban-card').filter({ hasText: 'Playwright UI task' });
  await expect(taskCard).toBeVisible();
  await taskCard.locator('.task-status-select button').click();
  await page.getByRole('option', { name: 'In Progress' }).click();
  await expect(page.locator('.kanban-column').filter({ hasText: 'In progress' }).locator('.kanban-card'))
    .toContainText('Playwright UI task');

  await page.getByRole('button', { name: /Roadmap/ }).click();
  await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  let contextPrompt = '';
  page.once('dialog', async dialog => {
    contextPrompt = `${dialog.message()} ${dialog.defaultValue()}`;
    await dialog.dismiss();
  });
  const taskContextResponse = page.waitForResponse(response => response.url().includes('/context?task=PW-001') && response.status() === 200);
  await page.getByRole('button', { name: 'Copy context' }).click();
  expect(await (await taskContextResponse).text()).toContain('# LocalAtlas Task Context: [PW]');
  await expect(page.locator('.header-notice')).toContainText(/(Copied task context|Task context ready) for PW-001/);
  if (contextPrompt) expect(contextPrompt).toContain('# LocalAtlas Task Context: [PW]');
  await page.getByRole('button', { name: /New session/ }).click();
  await expect(page.getByRole('heading', { name: 'Start an agent session' })).toBeVisible();
  await page.locator('.modal-form-body .priority-field button').click();
  await page.getByRole('option', { name: /Playwright UI task/ }).click();
  await page.getByRole('textbox', { name: 'Resume note' }).fill('The task is in progress and the current behavior is mapped.');
  await page.getByRole('textbox', { name: 'Next action' }).fill('Implement the acceptance case and capture Git evidence.');
  await page.getByRole('button', { name: 'Save session' }).click();
  await expect(page.getByRole('heading', { name: 'Agent sessions' })).toBeVisible();
  await expect(page.getByText(/Task PW-\d+/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh workspace data' })).toBeEnabled();
  await page.screenshot({ path: path.resolve('node_modules/.cache/playwright-results/localatlas-m8-project-overview.png'), fullPage: true });

  await page.getByRole('button', { name: 'Git activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Git activity' })).toBeVisible();
  await expect(page.locator('.git-history-row').first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'All projects' }).click();
  await expect(page.locator('.portfolio-project-card').filter({ hasText: repoName })).toBeVisible();
  await expect(page.locator('.activity-item').first()).toBeVisible();
  await page.locator('.portfolio-project-card').filter({ hasText: repoName }).click();
  await expect(page.locator('.project-overview-title h1')).toHaveText(repoName);
  await page.getByRole('button', { name: 'Relink path', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Relink project path' })).toBeVisible();
  await page.getByRole('textbox', { name: 'New repository path' }).fill(process.env.LOCALATLAS_E2E_RELINK_REPO!);
  await page.getByRole('button', { name: 'Relink project', exact: true }).click();
  await expect(page.locator('.project-overview-title p')).toContainText('relinked-repo');
  expect(gitStatus(repoPath)).toBe(sourceStatusBeforeImport);
  expect(pageErrors).toEqual([]);
});

test('project terminal prints bounded LocalAtlas context from the shared API', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let contextUrl = '';
  await page.route('**/terminal/start', async route => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: 'terminal-e2e-session', cwd: '/managed/project', cols: 100, rows: 28, eventSeq: 0 }),
    });
  });
  await page.route('**/terminal/*/events**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: '',
    });
  });
  await page.route('**/context**', async route => {
    contextUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: '# Bounded project context\n' });
  });

  await page.goto('/');
  const registered = await page.request.get('/api/projects');
  let projects = await registered.json();
  if (projects.length === 0) {
    const imported = await page.request.post('/api/projects', {
      data: { path: process.env.LOCALATLAS_E2E_REPO, key: 'CXT', name: 'Terminal Context Fixture' },
    });
    expect(imported.ok()).toBeTruthy();
    projects = [await imported.json()];
    await page.reload();
  }
  await page.locator('.portfolio-project-card').first().click();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Terminal' }).click();
  await expect(page.getByRole('button', { name: '⚡ Context' })).toBeVisible();
  const contextResponse = page.waitForResponse(response => response.url().includes('/context?format=text'));
  await page.getByRole('button', { name: '⚡ Context' }).click();
  expect(await (await contextResponse).text()).toContain('# Bounded project context');
  expect(contextUrl).toContain('/context?format=text');
  expect(pageErrors).toEqual([]);
});
