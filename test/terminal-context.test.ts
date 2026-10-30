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
  assertTerminalPlatform,
  updateProjectProfile,
  writeDoc,
} from '../src/core.js';
import { app } from '../src/server.js';

const execFileAsync = promisify(execFile);

test('interactive terminal platform support is explicit', () => {
  assert.doesNotThrow(() => assertTerminalPlatform('darwin'));
  assert.doesNotThrow(() => assertTerminalPlatform('linux'));
  assert.throws(() => assertTerminalPlatform('win32'), /macOS and Linux only/);
});

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
    const started = await start.json() as {
      sessionId: string;
      scopeKey: string;
      contextBounds?: { documentsTruncated: boolean; omittedDocuments: string[]; documentCap: number; sessionsTruncated: boolean; sessionCap: number };
    };
    assert.equal(started.scopeKey, `task:${task.id}`);
    assert.equal(started.contextBounds?.documentsTruncated, false);
    assert.deepEqual(started.contextBounds?.omittedDocuments, []);
    assert.equal(started.contextBounds?.documentCap, 5);
    assert.equal(started.contextBounds?.sessionsTruncated, false);
    assert.equal(started.contextBounds?.sessionCap, 3);
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

    const attach = await app.request(`/api/projects/${project.id}/terminal/codex/start`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
      body: JSON.stringify({ scope: { type: 'task', id: task.id } }),
    });
    assert.equal((await attach.json() as typeof started).sessionId, started.sessionId);

    const launcher = join(project.managedPath, '.localatlas', 'bin', 'localatlas');
    const cliResult = await execFileAsync(launcher, ['task', 'list', '--project', project.id], {
      cwd: project.managedPath,
      env: { ...process.env, LOCALATLAS_HOME: home },
    });
    assert.match(cliResult.stdout, new RegExp(task.id));

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

test('terminal start launches Claude Code and Qoder CLI with agent-specific arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-terminal-agents-'));
  const previousHome = process.env.LOCALATLAS_HOME;
  const previousPath = process.env.PATH;
  const previousEntry = process.env.LOCALATLAS_CLI_ENTRY_PATH;
  const home = join(root, 'home');
  const repo = join(root, 'source repo');
  const fakeBin = join(root, 'fake agents');
  const claudeCapture = join(root, 'claude args.json');
  const qoderCapture = join(root, 'qoder args.json');
  process.env.LOCALATLAS_HOME = home;
  await mkdir(repo, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(join(repo, 'README.md'), '# Imported guide\nRepository document context only.\n');
  const fakeClaude = join(fakeBin, 'claude');
  await writeFile(fakeClaude, '#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.LOCALATLAS_TEST_CLAUDE_CAPTURE, JSON.stringify(process.argv.slice(2)));\nconsole.log("FAKE CLAUDE READY");\nsetTimeout(() => process.exit(0), 1200);\n');
  await chmod(fakeClaude, 0o700);
  const fakeQoder = join(fakeBin, 'qodercli');
  await writeFile(fakeQoder, '#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.LOCALATLAS_TEST_QODER_CAPTURE, JSON.stringify(process.argv.slice(2)));\nconsole.log("FAKE QODER READY");\nsetTimeout(() => process.exit(0), 1200);\n');
  await chmod(fakeQoder, 0o700);
  const fakeCodexShadow = join(fakeBin, 'codex');
  await writeFile(fakeCodexShadow, '#!/usr/bin/env node\nconsole.log("FAKE CODEX SHADOW");\nsetTimeout(() => process.exit(0), 1200);\n');
  await chmod(fakeCodexShadow, 0o700);
  process.env.LOCALATLAS_TEST_CLAUDE_CAPTURE = claudeCapture;
  process.env.LOCALATLAS_TEST_QODER_CAPTURE = qoderCapture;
  process.env.LOCALATLAS_CLI_ENTRY_PATH = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;

  const readArgs = async (file: string): Promise<string[]> => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const raw = await readFile(file, 'utf8').catch(() => null);
      if (raw) return JSON.parse(raw) as string[];
      await delay(20);
    }
    throw new Error(`Timed out waiting for ${file}`);
  };

  try {
    const project = await importProject(repo, { key: 'AGT', name: 'Agent Project' });
    const repoReal = await realpath(repo);

    const claudeStart = await app.request(`/api/projects/${project.id}/terminal/codex/start`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'claude', scope: { type: 'project' } }),
    });
    assert.equal(claudeStart.status, 201, await claudeStart.clone().text());
    const claudeBody = await claudeStart.json() as { sessionId: string; scopeKey: string; agent: string };
    assert.equal(claudeBody.agent, 'claude');
    assert.equal(claudeBody.scopeKey, 'project');
    const claudeArgs = await readArgs(claudeCapture);
    assert.equal(claudeArgs[0], '--add-dir');
    assert.equal(claudeArgs[1], repoReal);
    assert.equal(claudeArgs.length, 3);
    assert.match(claudeArgs[2], /LocalAtlas project AGT/);
    assert.ok(!claudeArgs.includes('--sandbox') && !claudeArgs.includes('--permission-mode'), 'Claude launch must keep the interactive permission default');

    const qoderStart = await app.request(`/api/projects/${project.id}/terminal/codex/start`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'qoder', scope: { type: 'project' } }),
    });
    assert.equal(qoderStart.status, 201, await qoderStart.clone().text());
    const qoderBody = await qoderStart.json() as { sessionId: string; agent: string };
    assert.equal(qoderBody.agent, 'qoder');
    const qoderArgs = await readArgs(qoderCapture);
    assert.deepEqual(qoderArgs.slice(0, 2), ['--add-dir', repoReal]);
    assert.equal(qoderArgs.length, 3);
    assert.ok(!qoderArgs.includes('--permission-mode'), 'Qoder launch must keep the interactive permission default');

    assert.notEqual(claudeBody.sessionId, qoderBody.sessionId, 'distinct agents keep distinct sessions for the same scope');

    const bogus = await app.request(`/api/projects/${project.id}/terminal/codex/start`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'not-an-agent', scope: { type: 'project' } }),
    });
    assert.equal(bogus.status, 400, await bogus.clone().text());
  } finally {
    terminalManager.closeAll();
    if (previousHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.LOCALATLAS_TEST_CLAUDE_CAPTURE;
    delete process.env.LOCALATLAS_TEST_QODER_CAPTURE;
    if (previousEntry === undefined) delete process.env.LOCALATLAS_CLI_ENTRY_PATH;
    else process.env.LOCALATLAS_CLI_ENTRY_PATH = previousEntry;
    await cleanupTestDirectory(root);
  }
});

test('terminal agent launch strips the Qoder SDK harness environment from the child', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-terminal-env-'));
  const previousHome = process.env.LOCALATLAS_HOME;
  const previousPath = process.env.PATH;
  const previousEntry = process.env.LOCALATLAS_CLI_ENTRY_PATH;
  const sdkVars = ['QODER_AGENT_SDK_ENTRYPOINT', 'QODER_AGENT_SDK_VERSION', 'QODER_AGENT_SDK_DAEMON', 'QODER_SDK_AUTH_PAYLOAD_FILE', 'QODER_SDK_CUSTOM_BASE_URL_BYOK'];
  const previousSdk = sdkVars.map(key => [key, process.env[key]] as const);
  const home = join(root, 'home');
  const repo = join(root, 'source repo');
  const fakeBin = join(root, 'fake qoder');
  const capture = join(root, 'qoder env.json');
  process.env.LOCALATLAS_HOME = home;
  await mkdir(repo, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(join(repo, 'README.md'), '# Imported guide\n');
  const fakeQoder = join(fakeBin, 'qodercli');
  await writeFile(fakeQoder, '#!/usr/bin/env node\nconst fs = require("node:fs");\nconst leaked = Object.keys(process.env).filter(k => /^QODER_(?:AGENT_)?SDK_/.test(k));\nfs.writeFileSync(process.env.LOCALATLAS_TEST_QODER_ENV_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), leaked }));\nconsole.log("FAKE QODER READY");\nsetTimeout(() => process.exit(0), 1200);\n');
  await chmod(fakeQoder, 0o700);
  process.env.LOCALATLAS_TEST_QODER_ENV_CAPTURE = capture;
  process.env.LOCALATLAS_CLI_ENTRY_PATH = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;
  for (const key of sdkVars) process.env[key] = `sentinel-${key}`;
  try {
    const project = await importProject(repo, { key: 'ENVQ', name: 'Env Project' });
    const start = await app.request(`/api/projects/${project.id}/terminal/codex/start`, {
      method: 'POST',
      headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'qoder', scope: { type: 'project' } }),
    });
    assert.equal(start.status, 201, await start.clone().text());
    let parsed: { argv: string[]; leaked: string[] } | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      const raw = await readFile(capture, 'utf8').catch(() => null);
      if (raw) { parsed = JSON.parse(raw) as { argv: string[]; leaked: string[] }; break; }
      await delay(20);
    }
    assert.ok(parsed, 'fake qodercli should capture its environment');
    assert.deepEqual(parsed!.leaked, [], 'Qoder SDK harness env must not leak into the spawned agent (causes sdk_invalid_args)');
    assert.equal(parsed!.argv[0], '--add-dir');
  } finally {
    terminalManager.closeAll();
    if (previousHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    for (const [key, value] of previousSdk) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.LOCALATLAS_TEST_QODER_ENV_CAPTURE;
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
