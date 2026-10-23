import { runTsx, cleanupTestDirectory } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  importProject,
  relinkProject,
  selectProject,
  removeProject,
  listDocs,
  readDoc,
  createTask,
  createAgentSession,
  listAgentSessions,
  readAgentSession,
  updateAgentSession,
  generateTaskAgentContext,
  writeDoc,
  NotFoundError,
  ConflictError,
} from '../src/core.js';
import { app } from '../src/server.js';

async function snapshotDirectory(root: string): Promise<string> {
  const items: string[] = [];
  async function visit(dir: string, rel = ''): Promise<void> {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      const st = await fs.lstat(full);
      if (entry.isDirectory()) {
        items.push(`d:${childRel}:${st.mode}:${st.mtimeMs}`);
        await visit(full, childRel);
      } else {
        const content = await fs.readFile(full);
        items.push(`f:${childRel}:${st.mode}:${st.mtimeMs}:${createHash('sha256').update(content).digest('hex')}`);
      }
    }
  }
  await visit(root);
  return items.join('\n');
}

test('M8 project relinking preserves identity and Atlas data; unregister never touches source files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m8-relink-'));
  const home = path.join(root, 'home');
  process.env.LOCALATLAS_HOME = home;
  try {
    const oldPath = path.join(root, 'old-location', 'repo');
    const newPath = path.join(root, 'new-location', 'repo');
    await fs.mkdir(oldPath, { recursive: true });
    await fs.writeFile(path.join(oldPath, 'README.md'), '# Source stays read-only\n');
    await fs.mkdir(path.join(oldPath, 'src'));
    await fs.writeFile(path.join(oldPath, 'src', 'code.ts'), 'export const value = 1;\n');
    const project = await importProject(oldPath, { key: 'MOV' });
    await writeDoc(project, 'spec/plan.md', '# Managed plan\n');
    const beforeMove = await snapshotDirectory(oldPath);

    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(oldPath, newPath);
    const beforeRelink = await snapshotDirectory(newPath);
    const response = await app.request(`/api/projects/${project.id}/relink`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: newPath }),
    });
    assert.equal(response.status, 200);
    const relinked = await response.json() as typeof project;
    assert.equal(relinked.id, project.id);
    assert.equal(relinked.managedPath, project.managedPath);
    assert.equal(relinked.sourcePath, await fs.realpath(newPath));
    assert.deepEqual(await listDocs(relinked), ['spec/plan.md']);
    assert.equal(await readDoc(relinked, 'spec/plan.md'), '# Managed plan\n');
    assert.equal(await snapshotDirectory(newPath), beforeRelink);
    assert.equal(beforeMove, beforeRelink);

    const cliRelinkPath = path.join(root, 'cli-relinked-repo');
    await fs.cp(newPath, cliRelinkPath, { recursive: true });
    const cliRelinkSourceSnapshot = await snapshotDirectory(cliRelinkPath);
    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');
    await runTsx([cliPath, 'project', 'relink', 'MOV', cliRelinkPath], {
      cwd: cliRelinkPath,
      env: { ...process.env, LOCALATLAS_HOME: home },
    });
    const cliRelinked = await selectProject('MOV');
    assert.equal(cliRelinked.sourcePath, await fs.realpath(cliRelinkPath));
    assert.equal(cliRelinked.id, project.id);
    assert.deepEqual(await listDocs(cliRelinked), ['spec/plan.md']);

    const otherPath = path.join(root, 'other-repo');
    await fs.mkdir(otherPath);
    const other = await importProject(otherPath, { key: 'OTH' });
    await assert.rejects(relinkProject(other.id, cliRelinkPath), /already registered/);

    await removeProject(cliRelinked.id);
    assert.equal(await snapshotDirectory(cliRelinkPath), cliRelinkSourceSnapshot);
    assert.equal(await snapshotDirectory(newPath), beforeRelink);
    assert.equal(await readDoc({ ...relinked, sourcePath: newPath }, 'spec/plan.md'), '# Managed plan\n');
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('M8 task context and sessions remain project-scoped Markdown with task links and Git evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m8-context-'));
  const home = path.join(root, 'home');
  process.env.LOCALATLAS_HOME = home;
  try {
    const repoA = path.join(root, 'repo-a');
    const repoB = path.join(root, 'repo-b');
    await fs.mkdir(repoA);
    await fs.mkdir(repoB);
    await fs.writeFile(path.join(repoA, 'source.txt'), 'A source fixture\n');
    await fs.writeFile(path.join(repoB, 'source.txt'), 'B source fixture\n');
    const sourceSnapshotA = await snapshotDirectory(repoA);
    const sourceSnapshotB = await snapshotDirectory(repoB);
    const projectA = await importProject(repoA, { key: 'ALP' });
    const projectB = await importProject(repoB, { key: 'BET' });

    const dependency = await createTask(projectA, { title: 'Prepare shared interface', body: 'Agree interface contract.' });
    const task = await createTask(projectA, { title: 'Implement narrow feature' });
    await writeDoc(projectA, 'tasks/ALP-002.md', `---\nid: ${task.id}\ntype: task\nstatus: in_progress\npriority: high\ndependsOn:\n  - ${dependency.id}\n---\n# Implement narrow feature\n\nDesired outcome: preserve one-project context.\n\nSee [[../spec/only-a.md]].\n`);
    await writeDoc(projectA, 'spec/only-a.md', '# Project A private spec\nOnly relevant A detail.\n');
    await writeDoc(projectA, 'notes/unrelated.md', '# Unrelated note\nMust not be loaded into task context.\n');

    const taskB = await createTask(projectB, { title: 'B-only secret task' });
    await writeDoc(projectB, 'spec/b-only.md', '# Project B secret\nNever include this in A context.\n');
    const sessionA = await createAgentSession(projectA, {
      taskId: task.id,
      resumeNote: 'The contract is agreed; implementation is unfinished.',
      nextAction: 'Implement the request handler and add focused coverage.',
    });
    const sessionB = await createAgentSession(projectB, {
      taskId: taskB.id,
      resumeNote: 'Secret B resume detail.',
      nextAction: 'Continue B-only work.',
    });

    assert.equal(sessionA.taskId, task.id);
    assert.equal(sessionA.head, null);
    assert.equal(sessionA.path.startsWith('sessions/'), true);
    assert.deepEqual((await listAgentSessions(projectA)).map(item => item.id), [sessionA.id]);
    await assert.rejects(
      createAgentSession(projectA, { taskId: taskB.id, resumeNote: 'wrong project', nextAction: 'should reject' }),
      (error: unknown) => error instanceof NotFoundError
    );
    await assert.rejects(readAgentSession(projectA, sessionB.id), (error: unknown) => error instanceof NotFoundError);

    const context = await generateTaskAgentContext(projectA, task.id);
    assert.equal(context.project.id, projectA.id);
    assert.equal(context.task.id, task.id);
    assert.deepEqual(context.dependencies.map(item => item.id), [dependency.id]);
    assert.deepEqual(context.documents.map(item => item.path), ['spec/only-a.md']);
    assert.deepEqual(context.sessions.map(item => item.id), [sessionA.id]);
    assert.match(context.text, /Only relevant A detail/);
    assert.doesNotMatch(context.text, /Secret B|B-only secret|Unrelated note/);
    assert.equal(await snapshotDirectory(repoA), sourceSnapshotA);
    assert.equal(await snapshotDirectory(repoB), sourceSnapshotB);
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('M8 session edits keep history and use conditional Markdown writes; CLI and HTTP expose the same core', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m8-session-'));
  const home = path.join(root, 'home');
  process.env.LOCALATLAS_HOME = home;
  try {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo);
    const project = await importProject(repo, { key: 'CLI' });
    const task = await createTask(project, { title: 'CLI session task' });
    const session = await createAgentSession(project, {
      taskId: task.id,
      resumeNote: 'Started the investigation.',
      nextAction: 'Inspect the parser.',
    });
    const updated = await updateAgentSession(project, session.id, {
      status: 'paused',
      resumeNote: 'Found the relevant parser module.',
      nextAction: 'Add a regression case.',
      ifMatch: session.etag,
    });
    assert.equal(updated.status, 'paused');
    assert.match(await readDoc(project, updated.path), /updated resume note, next action, status → paused/);
    await assert.rejects(
      updateAgentSession(project, session.id, { status: 'active', ifMatch: session.etag }),
      (error: unknown) => error instanceof ConflictError
    );

    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');
    const cliEnv = { ...process.env, LOCALATLAS_HOME: home };
    const { stdout: contextOut } = await runTsx([cliPath, 'context', '--project', 'CLI', '--task', task.id, '--json'], { cwd: repo, env: cliEnv });
    const parsedContext = JSON.parse(contextOut);
    assert.equal(parsedContext.task.id, task.id);
    assert.equal(parsedContext.project.key, 'CLI');

    const { stdout: sessionListOut } = await runTsx([cliPath, 'session', 'list', '--project', 'CLI', '--json'], { cwd: repo, env: cliEnv });
    assert.equal(JSON.parse(sessionListOut)[0].id, session.id);

    const { stdout: createdSessionOut } = await runTsx([cliPath, 'session', 'create', '--project', 'CLI', '--task', task.id, '--resume-note', 'CLI created resume note.', '--next-action', 'CLI created next action.', '--json'],
      { cwd: repo, env: cliEnv }
    );
    const cliSession = JSON.parse(createdSessionOut);
    const { stdout: updatedSessionOut } = await runTsx([cliPath, 'session', 'update', cliSession.id, '--project', 'CLI', '--status', 'paused', '--resume-note', 'CLI updated resume note.', '--if-match', cliSession.etag, '--json'],
      { cwd: repo, env: cliEnv }
    );
    assert.equal(JSON.parse(updatedSessionOut).status, 'paused');

    const response = await app.request(`/api/projects/${project.id}/context?task=${task.id}`);
    assert.equal(response.status, 200);
    const apiContext = await response.json() as any;
    assert.equal(apiContext.task.id, task.id);
    const sessionResponse = await app.request(`/api/projects/${project.id}/sessions/${session.id}`);
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json() as any).status, 'paused');
  } finally {
    await cleanupTestDirectory(root);
  }
});
