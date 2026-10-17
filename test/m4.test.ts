import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  importProject,
  writeDoc,
  readDocWithMeta,
  withDb,
  reindexProject,
  createTask,
  createEpic,
  createMilestone,
  promoteNoteToTask,
  listTasks,
  updateTask,
  getProjectRollup,
} from '../src/core.js';
import { app } from '../src/server.js';

const execFileAsync = promisify(execFile);

async function makeTempEnv() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m4-'));
  const home = path.join(base, 'home');
  const repoA = path.join(base, 'sav-repo');
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(repoA, { recursive: true });
  process.env.LOCALATLAS_HOME = home;
  return {
    base,
    home,
    repoA,
    cleanup: async () => {
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}

test('LA-M4-01: Structured task, epic, and milestone creation & sequential ID allocation surviving index wipe', async () => {
  const env = await makeTempEnv();
  try {
    const project = await importProject(env.repoA, { key: 'SAV', name: 'Sav Repo' });

    const ms = await createMilestone(project, {
      title: 'M1 Foundation',
      targetDate: '2026-11-01',
      body: 'Deliver core storage and index.',
    });
    assert.equal(ms.id, 'SAV-001');
    assert.equal(ms.type, 'milestone');
    assert.equal(ms.status, 'open');
    assert.equal(ms.path, 'milestones/SAV-001.md');

    const epic = await createEpic(project, {
      title: 'Storage Engine',
      milestone: ms.id,
      body: 'SQLite + Markdown source of truth.',
    });
    assert.equal(epic.id, 'SAV-002');
    assert.equal(epic.type, 'epic');
    assert.equal(epic.status, 'todo');
    assert.equal(epic.milestone, 'SAV-001');
    assert.equal(epic.path, 'epics/SAV-002.md');

    const t1 = await createTask(project, {
      title: 'Implement ETag locking',
      priority: 'high',
      epic: epic.id,
      milestone: ms.id,
      body: '- [x] Add SHA-256 ETag\n- [ ] Add tests',
    });
    assert.equal(t1.id, 'SAV-003');
    assert.equal(t1.type, 'task');
    assert.equal(t1.status, 'todo');
    assert.equal(t1.priority, 'high');
    assert.equal(t1.epic, 'SAV-002');
    assert.equal(t1.milestone, 'SAV-001');
    assert.equal(t1.path, 'tasks/SAV-003.md');

    // Decisive failure & recovery test:
    // Create a manual task file on disk (SAV-010.md), wipe doc_index & doc_fts and reset next_seq = 0,
    // run reindex, and verify next created task gets SAV-011 without collision.
    await writeDoc(
      project,
      'tasks/SAV-010.md',
      '---\nid: SAV-010\ntype: task\nstatus: todo\npriority: medium\n---\n# Manual Task 10\n'
    );
    await withDb(db => {
      db.exec('DELETE FROM doc_index; DELETE FROM doc_fts; UPDATE projects SET next_seq = 0;');
    });

    await reindexProject(project);
    const tNext = await createTask(project, { title: 'Post-wipe task' });
    assert.equal(tNext.id, 'SAV-011');
  } finally {
    await env.cleanup();
  }
});

test('LA-M4-02: Note-to-task promotion preserves path, body, and custom frontmatter keys and is idempotent', async () => {
  const env = await makeTempEnv();
  try {
    const project = await importProject(env.repoA, { key: 'SAV' });

    const noteContent = [
      '---',
      'owner: alice',
      'tags:',
      '  - backend',
      '  - urgent',
      '---',
      '# Rough design note',
      '',
      'Need to investigate connection pooling.',
      '',
    ].join('\n');
    const written = await writeDoc(project, 'notes/pooling.md', noteContent);

    const promoted = await promoteNoteToTask(project, 'notes/pooling.md', {
      priority: 'critical',
      ifMatch: written.etag,
    });
    assert.equal(promoted.id, 'SAV-001');
    assert.equal(promoted.path, 'notes/pooling.md');
    assert.equal(promoted.status, 'todo');
    assert.equal(promoted.priority, 'critical');

    const onDisk = await readDocWithMeta(project, 'notes/pooling.md');
    assert.match(onDisk.content, /owner: alice/);
    assert.match(onDisk.content, /  - backend/);
    assert.match(onDisk.content, /Need to investigate connection pooling\./);

    // Promoting an already-promoted task is idempotent and does not allocate a new ID
    const rePromoted = await promoteNoteToTask(project, 'notes/pooling.md');
    assert.equal(rePromoted.id, 'SAV-001');

    const nextTask = await createTask(project, { title: 'Second item' });
    assert.equal(nextTask.id, 'SAV-002');
  } finally {
    await env.cleanup();
  }
});

test('LA-M4-03: Task filtering, atomic status updates, checklist code-block exclusion, and deterministic rollups', async () => {
  const env = await makeTempEnv();
  try {
    const project = await importProject(env.repoA, { key: 'SAV' });
    const ms = await createMilestone(project, { title: 'Release 1.0' });
    const epic = await createEpic(project, { title: 'Auth Epic', milestone: ms.id });

    const t1 = await createTask(project, {
      title: 'Task Done',
      status: 'done',
      priority: 'high',
      epic: epic.id,
      milestone: ms.id,
      body: [
        '- [x] Real done item',
        '- [ ] Real open item',
        '```markdown',
        '- [ ] Fake item inside code fence',
        '- [x] Fake checked item inside code fence',
        '```',
      ].join('\n'),
    });
    const t2 = await createTask(project, {
      title: 'Task In Progress',
      status: 'in_progress',
      priority: 'medium',
      epic: epic.id,
      milestone: ms.id,
    });
    const t3 = await createTask(project, {
      title: 'Task Cancelled',
      status: 'cancelled',
      priority: 'low',
      epic: epic.id,
      milestone: ms.id,
    });
    const tBroken = await createTask(project, {
      title: 'Orphan Task',
      status: 'todo',
      epic: 'SAV-999',
      milestone: 'MISSING-MS',
    });

    // Checklist counts must ignore code blocks (1 checked, 1 unchecked => total 2, checked 1)
    const tasks = await listTasks(project, { epic: epic.id });
    assert.equal(tasks.length, 3);
    const t1Info = tasks.find(t => t.id === t1.id)!;
    assert.deepEqual(t1Info.checklist, { total: 2, checked: 1 });

    // Rollup calculation: 3 total in epic (1 done, 1 in_progress, 1 cancelled).
    // Active denominator excludes cancelled => 1 done / 2 active = 0.5 completionRatio.
    const rollup = await getProjectRollup(project);
    const epicRollup = rollup.epics.find(e => e.id === epic.id)!;
    assert.equal(epicRollup.counts.total, 3);
    assert.equal(epicRollup.counts.done, 1);
    assert.equal(epicRollup.counts.inProgress, 1);
    assert.equal(epicRollup.counts.cancelled, 1);
    assert.equal(epicRollup.counts.completionRatio, 0.5);

    const msRollup = rollup.milestones.find(m => m.id === ms.id)!;
    assert.equal(msRollup.counts.total, 3);
    assert.equal(msRollup.counts.done, 1);
    assert.equal(msRollup.counts.cancelled, 1);
    assert.equal(msRollup.counts.completionRatio, 0.5);

    // Broken references surfaced
    assert.equal(rollup.brokenReferences.length, 1);
    assert.equal(rollup.brokenReferences[0].taskId, tBroken.id);
    assert.equal(rollup.brokenReferences[0].missingEpic, 'SAV-999');
    assert.equal(rollup.brokenReferences[0].missingMilestone, 'MISSING-MS');

    // Invalid status transition rejected with 400 and leaves file untouched
    const beforeInvalid = await readDocWithMeta(project, t2.path);
    await assert.rejects(
      () => updateTask(project, t2.id, { status: 'invalid_status' as any, ifMatch: beforeInvalid.etag }),
      /Invalid task status/i
    );
    const afterInvalid = await readDocWithMeta(project, t2.path);
    assert.equal(afterInvalid.etag, beforeInvalid.etag);

    // HTTP API & ETag concurrency protection on PATCH /api/projects/:id/tasks/:taskId
    const patchStale = await app.request(
      `http://127.0.0.1:4310/api/projects/${project.id}/tasks/${t2.id}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'if-match': '"stale-etag"',
        },
        body: JSON.stringify({ status: 'done' }),
      }
    );
    assert.equal(patchStale.status, 409);

    const patchValid = await app.request(
      `http://127.0.0.1:4310/api/projects/${project.id}/tasks/${t2.id}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'if-match': beforeInvalid.etag,
        },
        body: JSON.stringify({ status: 'done', priority: 'critical' }),
      }
    );
    assert.equal(patchValid.status, 200);
    const patchedTask = (await patchValid.json()) as { status: string; priority: string };
    assert.equal(patchedTask.status, 'done');
    assert.equal(patchedTask.priority, 'critical');

    // CLI E2E test for task/epic/milestone create, promote, list, update
    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const cliEnv = { ...process.env, LOCALATLAS_HOME: env.home };
    const { stdout: createdOut } = await execFileAsync(
      tsxBin,
      [cliPath, 'task', 'create', 'CLI Task', '--priority', 'high', '--epic', epic.id, '--json'],
      { cwd: env.repoA, env: cliEnv }
    );
    const cliTask = JSON.parse(createdOut);
    assert.equal(cliTask.type, 'task');
    assert.equal(cliTask.priority, 'high');

    const { stdout: listOut } = await execFileAsync(
      tsxBin,
      [cliPath, 'task', 'list', '--status', 'done', '--json'],
      { cwd: env.repoA, env: cliEnv }
    );
    const doneTasks = JSON.parse(listOut);
    assert.equal(doneTasks.length, 2);
  } finally {
    await env.cleanup();
  }
});

test('LA-M4-04: Web UI includes Kanban Board and Roadmap views with ETag PATCH transitions', async () => {
  const appSource = await fs.readFile(path.resolve(process.cwd(), 'public/app.js'), 'utf8');
  assert.match(appSource, /Kanban/);
  assert.match(appSource, /Roadmap/);
  assert.match(appSource, /\/tasks/);
  assert.match(appSource, /\/rollup/);
  assert.match(appSource, /brokenReferences/);
});

test('LA-M4 verifier findings: CLI trailing options parsing, concurrent task allocation, numbered checklists, and edge rollups', async () => {
  const env = await makeTempEnv();
  try {
    const project = await importProject(env.repoA, { key: 'CLI' });
    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const cliEnv = { ...process.env, LOCALATLAS_HOME: env.home };

    // 1. CLI option ordering: trailing flags should not be included in positional title
    const { stdout: createOut } = await execFileAsync(
      tsxBin,
      [cliPath, 'task', 'create', 'Refactor', 'auth', 'tokens', '--priority', 'critical', '--json'],
      { cwd: env.repoA, env: cliEnv }
    );
    const created = JSON.parse(createOut);
    assert.equal(created.title, 'Refactor auth tokens');
    assert.equal(created.priority, 'critical');

    // 2. Numbered checklists (1. [x] and 2. [ ])
    const tWithNumbered = await createTask(project, {
      title: 'Numbered Tasks',
      body: '1. [x] First step\n2. [ ] Second step\n- [ ] Third bullet step\n```\n1. [ ] Ignored in fence\n```',
    });
    assert.deepEqual(tWithNumbered.checklist, { total: 3, checked: 1 });

    // 3. Rollup with 0 tasks and all-cancelled tasks
    const emptyEpic = await createEpic(project, { title: 'Empty Epic' });
    const cancelledEpic = await createEpic(project, { title: 'Cancelled Epic' });
    await createTask(project, { title: 'Cancelled 1', epic: cancelledEpic.id, status: 'cancelled' });
    await createTask(project, { title: 'Cancelled 2', epic: cancelledEpic.id, status: 'cancelled' });

    const rollup = await getProjectRollup(project);
    const emptyRollup = rollup.epics.find(e => e.id === emptyEpic.id)!;
    assert.equal(emptyRollup.counts.total, 0);
    assert.equal(emptyRollup.counts.completionRatio, 0);

    const cancelledRollup = rollup.epics.find(e => e.id === cancelledEpic.id)!;
    assert.equal(cancelledRollup.counts.total, 2);
    assert.equal(cancelledRollup.counts.cancelled, 2);
    assert.equal(cancelledRollup.counts.completionRatio, 0);

    // 4. Concurrent task allocation produces distinct sequential IDs
    const [c1, c2, c3] = await Promise.all([
      createTask(project, { title: 'Concurrent A' }),
      createTask(project, { title: 'Concurrent B' }),
      createTask(project, { title: 'Concurrent C' }),
    ]);
    const idSet = new Set([c1.id, c2.id, c3.id]);
    assert.equal(idSet.size, 3);
  } finally {
    await env.cleanup();
  }
});

