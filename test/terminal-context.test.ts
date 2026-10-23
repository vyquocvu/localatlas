import { cleanupTestDirectory } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createTask,
  importProject,
  onProjectEvent,
  selectProject,
  startWorkspaceWatcher,
  terminalManager,
  updateProjectProfile,
  writeDoc,
} from '../src/core.js';
import { app } from '../src/server.js';

const execFileAsync = promisify(execFile);

test('managed workspaces resolve to their project and Codex starts with task-scoped context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-terminal-context-'));
  const previousHome = process.env.LOCALATLAS_HOME;
  const previousPath = process.env.PATH;
  const previousEntry = process.env.LOCALATLAS_CLI_ENTRY_PATH;
  const home = join(root, "atlas home $cash's");
  const repo = join(root, 'source repo');
  const fakeBin = join(root, 'fake codex');
  const capture = join(root, 'codex args.json');
  process.env.LOCALATLAS_HOME = home;
  await mkdir(repo, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(join(repo, 'README.md'), '# Imported guide\nRepository document context only.\n');
  const fakeCodex = join(fakeBin, 'codex');
  await writeFile(fakeCodex, '#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.LOCALATLAS_TEST_CODEX_CAPTURE, JSON.stringify(process.argv.slice(2)));\nconsole.log("FAKE CODEX READY");\nsetTimeout(() => process.exit(0), 1200);\n');
  await chmod(fakeCodex, 0o700);
  process.env.LOCALATLAS_TEST_CODEX_CAPTURE = capture;
  process.env.LOCALATLAS_CLI_ENTRY_PATH = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;
  let watcher: Awaited<ReturnType<typeof startWorkspaceWatcher>> | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    const project = await importProject(repo, { key: 'CTX', name: 'Context Project' });
    await writeDoc(project, 'spec/important.md', '# Important spec\nThis decision defines the acceptance criteria.\n');
    await updateProjectProfile(project, { goals: 'Ship a reliable local project workspace.', keyDocs: ['spec/important.md'] });
    const task = await createTask(project, { title: 'Use scoped context', priority: 'high', body: 'Acceptance detail: use the linked spec.' });
    await writeDoc(project, task.path, `---\nid: ${task.id}\ntype: task\nstatus: todo\npriority: high\n---\n# Use scoped context\n\nAcceptance detail: use the linked spec.\n\nSee [[../spec/important.md]].\n`);

    const resolved = await selectProject(undefined, project.managedPath);
    assert.equal(resolved.id, project.id);

    const start = await app.request(`/api/projects/${project.id}/terminal/codex/start`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { type: 'task', id: task.id } }),
    });
    assert.equal(start.status, 201, await start.clone().text());
    const started = await start.json() as { sessionId: string; scopeKey: string };
    assert.equal(started.scopeKey, `task:${task.id}`);
    let captured: string | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      captured = await readFile(capture, 'utf8').catch(() => null);
      if (captured) break;
      await delay(20);
    }
    assert.ok(captured, 'fake Codex should receive its argv');
    const argv = JSON.parse(captured) as string[];
    assert.deepEqual(argv.slice(0, 4), ['--sandbox', 'workspace-write', '--add-dir', await realpath(repo)]);
    assert.match(argv.at(-1) ?? '', new RegExp(`Task: ${task.id}`));
    assert.match(argv.at(-1) ?? '', /Acceptance detail: use the linked spec/);
    assert.match(argv.at(-1) ?? '', /This decision defines the acceptance criteria/);
    assert.match(argv.at(-1) ?? '', /localatlas task list/);
    const launcher = join(project.managedPath, '.localatlas', 'bin', 'localatlas');
    const cliResult = await execFileAsync(launcher, ['task', 'list', '--project', project.id], {
      cwd: project.managedPath,
      env: { ...process.env, LOCALATLAS_HOME: home },
    });
    assert.match(cliResult.stdout, new RegExp(task.id));

    const attach = await app.request(`/api/projects/${project.id}/terminal/codex/start`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { type: 'task', id: task.id } }),
    });
    assert.equal((await attach.json() as typeof started).sessionId, started.sessionId);

    for (const scope of [
      { type: 'document', source: 'atlas', path: 'spec/important.md' },
      { type: 'document', source: 'repo', path: 'README.md' },
    ]) {
      const docStart = await app.request(`/api/projects/${project.id}/terminal/codex/start`, {
        method: 'POST',
        headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      assert.equal(docStart.status, 201, await docStart.clone().text());
      const expectedHeader = `## Selected ${scope.source === 'repo' ? 'repository' : 'Atlas'} document: ${scope.path}`;
      let docArgs: string[] | null = null;
      for (let attempt = 0; attempt < 50; attempt++) {
        const latest = await readFile(capture, 'utf8').catch(() => '');
        const parsed = latest ? JSON.parse(latest) as string[] : [];
        if (parsed.at(-1)?.includes(expectedHeader)) { docArgs = parsed; break; }
        await delay(20);
      }
      assert.ok(docArgs, `Codex should receive ${scope.source} document context`);
      assert.match(docArgs.at(-1) ?? '', scope.source === 'repo' ? /Repository document context only/ : /This decision defines the acceptance criteria/);
    }
  } finally {
    terminalManager.closeAll();
    unsubscribe?.();
    await watcher?.close();
    if (previousHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.LOCALATLAS_TEST_CODEX_CAPTURE;
    if (previousEntry === undefined) delete process.env.LOCALATLAS_CLI_ENTRY_PATH;
    else process.env.LOCALATLAS_CLI_ENTRY_PATH = previousEntry;
    await cleanupTestDirectory(root);
  }
});

test('server watcher emits an invalidation when a separate CLI process changes indexed Markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-cross-process-refresh-'));
  const previousHome = process.env.LOCALATLAS_HOME;
  process.env.LOCALATLAS_HOME = join(root, 'home');
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  let watcher: Awaited<ReturnType<typeof startWorkspaceWatcher>> | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    const project = await importProject(repo, { key: 'SSE' });
    watcher = await startWorkspaceWatcher({ intervalMs: 40 });
    const eventPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe?.(); reject(new Error('Timed out waiting for cross-process project invalidation')); }, 2000);
      unsubscribe = onProjectEvent(event => {
        if (event.projectId === project.id && event.type === 'reindexed') {
          clearTimeout(timer);
          unsubscribe?.();
          resolve();
        }
      });
    });
    const loaderPath = fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url));
    const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    await execFileAsync(process.execPath, ['--import', loaderPath, cliEntry, 'task', 'create', 'Created by CLI', '--project', project.id, '--priority', 'high'], {
      cwd: project.managedPath,
      env: { ...process.env, LOCALATLAS_HOME: process.env.LOCALATLAS_HOME },
      timeout: 10_000,
    });
    await eventPromise;
  } finally {
    terminalManager.closeAll();
    unsubscribe?.();
    await watcher?.close();
    if (previousHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = previousHome;
    await cleanupTestDirectory(root);
  }
});
