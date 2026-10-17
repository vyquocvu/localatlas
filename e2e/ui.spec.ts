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

  await expect(page.getByRole('heading', { name: repoName, exact: true })).toBeVisible();
  await expect(page.getByText('Recent commits')).toBeVisible();
  await expect(page.locator('.project-commit-row').first()).toBeVisible();

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
  await page.locator('textarea').fill('# Checklist\n\n- [ ] Playwright checkbox item\n');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const markdownCheckbox = page.getByRole('checkbox', { name: 'Playwright checkbox item' });
  await expect(markdownCheckbox).not.toBeChecked();
  await page.locator('.task-checkbox-host [data-slot="checkbox-content"]').click();
  await expect(markdownCheckbox).toBeChecked();

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
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Relink path', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Relink project path' })).toBeVisible();
  await page.getByRole('textbox', { name: 'New repository path' }).fill(process.env.LOCALATLAS_E2E_RELINK_REPO!);
  await page.getByRole('button', { name: 'Relink project', exact: true }).click();
  await expect(page.locator('.project-overview-title p')).toContainText('relinked-repo');
  expect(gitStatus(repoPath)).toBe(sourceStatusBeforeImport);
  expect(pageErrors).toEqual([]);
});

test('Codex tab starts a project chat and sends messages through mocked local API routes', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let startRequests = 0;
  let sentMessage: unknown;
  const threadId = '44444444-4444-4444-8444-444444444444';
  await page.route('**/codex-chat/start', async route => {
    startRequests++;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ threadId, messages: [], busy: false, eventSeq: 0 }),
    });
  });
  await page.route('**/codex-chat/*/events**', async route => {
    const event = { id: 1, type: 'assistant-delta', data: { itemId: 'assistant-mock-1', delta: 'Mock Codex reply from a project-scoped thread.' }, createdAt: new Date().toISOString() };
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: `id: 1\nevent: codex\ndata: ${JSON.stringify(event)}\n\n`,
    });
  });
  await page.route('**/codex-chat/*/turns', async route => {
    sentMessage = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ turnId: 'mock-turn-1' }) });
  });

  await page.goto('/');
  const registered = await page.request.get('/api/projects');
  let projects = await registered.json();
  if (projects.length === 0) {
    const imported = await page.request.post('/api/projects', {
      data: { path: process.env.LOCALATLAS_E2E_REPO, key: 'CXT', name: 'Codex Chat Fixture' },
    });
    expect(imported.ok()).toBeTruthy();
    projects = [await imported.json()];
    await page.reload();
  }
  await page.locator('.portfolio-project-card').first().click();
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Chat with Codex' })).toBeVisible();
  await expect(page.getByText('Start a project chat')).toBeVisible();
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await expect(page.getByText('Connected to local Codex')).toBeVisible();
  await expect(page.getByText('Mock Codex reply from a project-scoped thread.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Codex' }).fill('Summarize the latest project changes.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Summarize the latest project changes.')).toBeVisible();
  expect(startRequests).toBe(1);
  expect(sentMessage).toEqual({ text: 'Summarize the latest project changes.' });
  await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
