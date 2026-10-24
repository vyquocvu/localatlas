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

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('textarea').fill('# Checklist\n\nA browser draft that should survive reload.\n');
  await page.reload();
  await expect(page.getByText('A saved browser draft is available.')).toBeVisible();
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await expect(page.locator('textarea')).toContainText('A browser draft that should survive reload.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.draft-conflict-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Save my version on disk' }).click();
  await expect(page.locator('.header-notice')).toContainText('Saved checklist.md');

  await page.locator('textarea').fill('# Local version to keep\n');
  const externalWrite = await page.evaluate(async () => {
    const projects = await fetch('/api/projects').then(response => response.json());
    const url = `/api/projects/${encodeURIComponent(projects[0].id)}/docs/checklist.md`;
    const current = await fetch(url);
    const etag = current.headers.get('etag');
    const response = await fetch(url, { method: 'PUT', headers: { 'if-match': etag }, body: '# External disk version\n' });
    return response.ok;
  });
  expect(externalWrite).toBe(true);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.draft-conflict-banner')).toBeVisible();
  await expect(page.locator('.draft-conflict-banner textarea').nth(1)).toHaveValue('# External disk version\n');
  await page.getByRole('button', { name: 'Save my version on disk' }).click();
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
  await page.getByRole('button', { name: /New task/ }).last().click();
  await page.getByRole('textbox', { name: 'Task title' }).fill('Dependency predecessor');
  await page.getByRole('button', { name: 'Create Task' }).click();
  const predecessor = page.locator('.kanban-card').filter({ hasText: 'Dependency predecessor' });
  await expect(predecessor).toBeVisible();
  await taskCard.getByRole('button', { name: 'Propose change' }).click();
  await page.getByRole('checkbox', { name: /PW-002 Dependency predecessor/ }).check();
  await page.getByRole('textbox', { name: 'Proposed task description' }).fill('- [ ] Browser checklist from task details\n');
  await page.getByRole('button', { name: 'Prepare impact summary' }).click();
  await expect(page.getByText(/Impact summary prepared/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm & apply change' }).click();
  await expect(page.locator('.header-notice')).toContainText('Confirmed changes for PW-001');
  await expect(taskCard.getByText('Blocked by PW-002')).toBeVisible();
  await expect(taskCard).toContainText('0/1');
  const cancelledDependency = await page.evaluate(async () => {
    const project = (await fetch('/api/projects').then(response => response.json()))[0];
    const tasks = await fetch(`/api/projects/${encodeURIComponent(project.id)}/tasks`).then(response => response.json());
    const dependency = tasks.find(task => task.title === 'Dependency predecessor');
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/tasks/${encodeURIComponent(dependency.id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${dependency.etag}"` },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    return response.ok;
  });
  expect(cancelledDependency).toBe(true);
  await page.getByRole('button', { name: 'Refresh workspace data' }).click();
  await expect(taskCard.getByText('Blocked by PW-002')).toHaveCount(0);

  await taskCard.locator('.task-status-select button').click();
  await page.getByRole('option', { name: 'In Progress' }).click();
  await expect(page.locator('.kanban-column').filter({ hasText: 'In progress' }).locator('.kanban-card'))
    .toContainText('Playwright UI task');

  const cancelledTaskUpdate = await page.evaluate(async () => {
    const project = (await fetch('/api/projects').then(response => response.json()))[0];
    const tasks = await fetch(`/api/projects/${encodeURIComponent(project.id)}/tasks`).then(response => response.json());
    const task = tasks.find(item => item.title === 'Playwright UI task');
    const docPath = task.path.split('/').map(encodeURIComponent).join('/');
    const currentDoc = await fetch(`/api/projects/${encodeURIComponent(project.id)}/docs/${docPath}`);
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': currentDoc.headers.get('etag') },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    return { ok: response.ok, status: response.status, error: response.ok ? '' : await response.text() };
  });
  expect(cancelledTaskUpdate.ok, `${cancelledTaskUpdate.status}: ${cancelledTaskUpdate.error}`).toBe(true);
  await page.getByRole('button', { name: 'Refresh workspace data' }).click();
  await expect(page.getByRole('button', { name: /Show cancelled tasks/ })).toBeVisible();
  await page.getByRole('button', { name: /Show cancelled tasks/ }).click();
  const cancelledCard = page.locator('.cancelled-task-cards .kanban-card').filter({ hasText: 'Playwright UI task' });
  await expect(cancelledCard).toBeVisible();
  const restoreTaskStatus = await page.evaluate(async () => {
    const project = (await fetch('/api/projects').then(response => response.json()))[0];
    const tasks = await fetch(`/api/projects/${encodeURIComponent(project.id)}/tasks`).then(response => response.json());
    const task = tasks.find(item => item.title === 'Playwright UI task');
    const docPath = task.path.split('/').map(encodeURIComponent).join('/');
    const currentDoc = await fetch(`/api/projects/${encodeURIComponent(project.id)}/docs/${docPath}`);
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': currentDoc.headers.get('etag') },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    return response.ok;
  });
  expect(restoreTaskStatus).toBe(true);
  await page.getByRole('button', { name: 'Refresh workspace data' }).click();
  await expect(page.locator('.kanban-column').filter({ hasText: 'In progress' }).locator('.kanban-card'))
    .toContainText('Playwright UI task');

  await page.getByRole('button', { name: /Roadmap/ }).click();
  await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
  await page.getByRole('button', { name: '+ New milestone' }).click();
  await page.getByRole('textbox', { name: 'Roadmap item title' }).fill('Browser milestone');
  await page.getByRole('textbox', { name: 'Milestone target date' }).fill('2026-12-31');
  await page.getByRole('button', { name: 'Create milestone' }).click();
  let milestoneCard = page.locator('.roadmap-card').filter({ hasText: 'Browser milestone' });
  await expect(milestoneCard).toContainText('Target date: 2026-12-31');
  await milestoneCard.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Roadmap item title' }).fill('Browser milestone updated');
  await page.getByRole('textbox', { name: 'Milestone target date' }).fill('2027-01-31');
  await page.getByRole('button', { name: 'Save changes' }).click();
  milestoneCard = page.locator('.roadmap-card').filter({ hasText: 'Browser milestone updated' });
  await expect(milestoneCard).toContainText('Target date: 2027-01-31');

  await page.getByRole('button', { name: '+ New epic' }).click();
  await page.getByRole('textbox', { name: 'Roadmap item title' }).fill('Browser epic');
  await page.getByRole('button', { name: 'Epic milestone' }).click();
  await page.getByRole('option', { name: /Browser milestone updated/ }).click();
  await page.getByRole('button', { name: 'Create epic' }).click();
  const epicCard = page.locator('.roadmap-card').filter({ hasText: 'Browser epic' });
  await expect(epicCard).toBeVisible();
  await epicCard.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Roadmap item title' }).fill('Browser epic updated');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.roadmap-card').filter({ hasText: 'Browser epic updated' })).toBeVisible();

  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /Board \(Kanban\)/ }).click();
  await page.getByRole('button', { name: /New task/ }).last().click();
  await page.getByRole('textbox', { name: 'Task title' }).fill('Linked roadmap task');
  await page.getByRole('button', { name: /Task epic/ }).click();
  await page.getByRole('option', { name: /Browser epic updated/ }).click();
  await page.getByRole('button', { name: /Task milestone/ }).click();
  await page.getByRole('option', { name: /Browser milestone updated/ }).click();
  await page.getByRole('button', { name: 'Create Task' }).click();
  const linkedTaskCard = page.locator('.kanban-card').filter({ hasText: 'Linked roadmap task' });
  await expect(linkedTaskCard).toBeVisible();
  const linkedTask = await page.evaluate(async () => {
    const project = (await fetch('/api/projects').then(response => response.json()))[0];
    const tasks = await fetch(`/api/projects/${encodeURIComponent(project.id)}/tasks`).then(response => response.json());
    return tasks.find(task => task.title === 'Linked roadmap task');
  });
  expect(linkedTask.epic).toBeTruthy();
  expect(linkedTask.milestone).toBeTruthy();
  await expect(linkedTaskCard.locator('.kanban-card-meta')).toContainText(linkedTask.epic);

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  let contextPrompt = '';
  page.once('dialog', async dialog => {
    contextPrompt = `${dialog.message()} ${dialog.defaultValue()}`;
    await dialog.dismiss();
  });
  const taskContextResponse = page.waitForResponse(response => response.url().includes('/context?task=PW-001') && response.status() === 200);
  await page.locator('.overview-task-row').filter({ hasText: 'Playwright UI task' }).getByRole('button', { name: 'Copy context' }).click();
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
  const backupPath = path.join(path.dirname(repoPath), `${repoName}-localatlas-backup`);
  await page.getByLabel('Backup destination').fill(backupPath);
  await page.getByRole('button', { name: 'Create and verify backup' }).click();
  await expect(page.getByText(/Backup created and every manifest checksum verified/)).toBeVisible();
  await expect(page.locator('.backup-result').first()).toContainText('checksums verified');
  await page.getByLabel('Inspect a backup before restore').fill(backupPath);
  await page.getByRole('button', { name: 'Verify backup and preflight' }).click();
  await expect(page.getByText('The target workspace contains data. Restore requires --force and replaces that workspace.')).toBeVisible();
  await page.locator('.portfolio-project-card').filter({ hasText: repoName }).getByRole('button').click();
  await expect(page.locator('.project-overview-title h1')).toBeVisible();
  await expect(page.locator('.project-overview-title h1')).toHaveText(repoName);
  await expect(page.getByRole('button', { name: 'Relink path', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Relink path', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Relink project path' })).toBeVisible();
  await page.getByRole('textbox', { name: 'New repository path' }).fill(process.env.LOCALATLAS_E2E_RELINK_REPO!);
  await page.getByRole('button', { name: 'Relink project', exact: true }).click();
  await expect(page.locator('.project-overview-title p')).toContainText('relinked-repo');
  expect(gitStatus(repoPath)).toBe(sourceStatusBeforeImport);
  expect(pageErrors).toEqual([]);
});

test('project terminal previews bounded LocalAtlas context from the shared API', async ({ page }) => {
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
  await page.locator('.portfolio-project-card').first().getByRole('button').click();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Terminal' }).click();
  await expect(page.getByRole('button', { name: 'Preview context', exact: true })).toBeVisible();
  let previewText = '';
  page.once('dialog', async dialog => {
    previewText = dialog.defaultValue();
    await dialog.dismiss();
  });
  const contextResponse = page.waitForResponse(response => response.url().includes('/context?format=text'));
  await page.getByRole('button', { name: 'Preview context', exact: true }).click();
  expect(await (await contextResponse).text()).toContain('# Bounded project context');
  await expect.poll(() => previewText).toContain('# Bounded project context');
  expect(contextUrl).toContain('/context?format=text');
  expect(pageErrors).toEqual([]);
});
