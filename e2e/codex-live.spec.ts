import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const enabled = process.env.LOCALATLAS_E2E_REAL_CODEX === '1';
test.skip(!enabled, 'Set LOCALATLAS_E2E_REAL_CODEX=1 to run the authenticated, unmocked Codex workflow.');
test.skip(process.platform === 'win32', 'LocalAtlas interactive PTY support is macOS/Linux only.');

function gitStatus(repoPath: string): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' });
}

test('unmocked task-scoped Codex receives context and completes a task', async ({ page }) => {
  test.setTimeout(180_000);
  const repoPath = process.env.LOCALATLAS_E2E_REPO!;
  const sourceStatusBefore = gitStatus(repoPath);
  const taskTitle = 'Real Codex E2E: update task through LocalAtlas CLI';
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your projects, in one place.' })).toBeVisible();
  await page.getByRole('button', { name: /Import project/i }).first().click();
  await page.getByRole('textbox', { name: 'Project directory path' }).fill(repoPath);
  await page.getByRole('textbox', { name: 'Optional project key' }).fill('LIVE');
  await page.getByRole('button', { name: 'Import Project', exact: true }).click();
  await expect(page.locator('.project-overview-title h1')).toHaveText(path.basename(repoPath));

  const projectResponse = await page.request.get('/api/projects');
  expect(projectResponse.ok()).toBeTruthy();
  const [project] = await projectResponse.json();
  expect(project).toBeTruthy();

  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /New task/ }).last().click();
  await page.getByRole('textbox', { name: 'Task title' }).fill(taskTitle);
  await page.getByRole('button', { name: 'Create Task' }).click();
  const taskCard = page.locator('.kanban-card').filter({ hasText: taskTitle });
  await expect(taskCard).toBeVisible();
  const taskId = (await taskCard.locator('.issue-key-badge').innerText()).trim();

  const instruction = [
    'Complete this task using the LocalAtlas CLI only.',
    'Read this task with the command `localatlas read ' + taskId + ' --json --project ' + project.id + '`.',
    'Use the fresh top-level etag from that read to run `localatlas task update ' + taskId + ' --status done --if-match <etag> --project ' + project.id + '`.',
    'Read the task again with the CLI and confirm its status is done.',
    'Do not use HTTP or edit Markdown directly. Do not modify the imported source repository.',
  ].join('\n');
  const taskRead = JSON.parse(execFileSync('npm', [
    'run', 'cli', '--', 'read', taskId, '--json', '--project', project.id,
  ], { encoding: 'utf8' }));
  expect(taskRead.etag).toBeTruthy();
  execFileSync('npm', [
    'run', 'cli', '--', 'task', 'update', taskId,
    '--body', `# ${taskTitle}\n\n${instruction}\n`,
    '--if-match', taskRead.etag,
    '--project', project.id,
  ], { encoding: 'utf8' });
  await expect(taskCard).toBeVisible();

  const startResponse = page.waitForResponse(response =>
    response.url().includes(`/projects/${encodeURIComponent(project.id)}/terminal/codex/start`) && response.status() === 201
  );
  await taskCard.getByRole('button', { name: 'Ask Codex' }).click();
  const codexStart = await startResponse;
  const codexSession = await codexStart.json();
  expect(codexSession.scopeKey).toBe(`task:${taskId}`);
  await expect(page.getByRole('region', { name: 'Project Terminal' })).toBeVisible();
  await expect(page.locator('.codex-terminal-title')).toContainText(`Codex · task:${taskId}`);
  await expect(page.locator('.codex-terminal-state')).toHaveText('RUNNING');

  await expect.poll(async () => {
    const response = await page.request.get(`/api/projects/${encodeURIComponent(project.id)}/tasks`);
    if (!response.ok()) return '';
    const tasks = await response.json();
    return tasks.find((item: { id: string; status: string }) => item.id === taskId)?.status ?? '';
  }, { timeout: 150_000, intervals: [1000, 2000, 4000] }).toBe('done');

  const verifiedTask = JSON.parse(execFileSync('npm', [
    'run', 'cli', '--', 'read', taskId, '--json', '--project', project.id,
  ], { encoding: 'utf8' }));
  expect(verifiedTask.frontmatter.status).toBe('done');

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  const doneColumn = page.locator('.kanban-column').filter({ has: page.locator('.kanban-column-header').getByText('Done', { exact: true }) });
  await expect(doneColumn.locator('.kanban-card')).toContainText(taskTitle);
  const terminalRows = page.locator('.codex-xterm-host .xterm-rows');
  await expect.poll(async () => (await terminalRows.innerText()).replace(/\s+/g, ' '), { timeout: 30_000 })
    .toContain('You are working in LocalAtlas project LIVE');
  await page.screenshot({ path: path.resolve('artifacts/playwright/localatlas-real-codex-terminal.png'), fullPage: true });

  expect(gitStatus(repoPath)).toBe(sourceStatusBefore);
  expect(pageErrors).toEqual([]);
});
