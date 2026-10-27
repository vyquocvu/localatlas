import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importProject,
  writeDoc,
  createTask,
  updateTask,
  getTaskDocumentLinks,
} from '../src/core.js';
import { app } from '../src/server.js';
import { withDb } from '../src/core/db.js';
import { runTsx, cleanupTestDirectory } from './helpers.js';

async function makeProject(root: string, name: string, key: string) {
  const repo = join(root, name);
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'README.md'), `# ${name}\n`, 'utf8');
  return importProject(repo, { key });
}

async function withTempHome(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-task-docs-'));
  const previousHome = process.env.LOCALATLAS_HOME;
  process.env.LOCALATLAS_HOME = join(root, 'home');
  try {
    await run(root);
  } finally {
    if (previousHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = previousHome;
    await cleanupTestDirectory(root);
  }
}

test('task linked documents resolve Markdown links, task links, broken references, and project isolation', async () => {
  await withTempHome(async root => {
    const project = await makeProject(root, 'repo-a', 'TD');
    const otherProject = await makeProject(root, 'repo-b', 'OT');
    await writeDoc(project, 'docs/plan.md', '# Delivery plan\n\nScope and milestones.\n');
    await writeDoc(project, 'docs/shared.md', '# Shared doc in TD\n');
    await writeDoc(otherProject, 'docs/shared.md', '# Shared doc in OT\n');
    await writeDoc(otherProject, 'docs/other-only.md', '# Other project only\n');

    const relatedTask = await createTask(project, { title: 'Related work', body: '# Related work\n' });
    const task = await createTask(project, { title: 'Ship the feature', body: '# Ship the feature\n' });
    await updateTask(project, task.id, {
      body: [
        '# Ship the feature',
        '',
        'Read [[docs/plan.md]] and [[docs/shared.md]].',
        `Also [[${relatedTask.id}]].`,
        'Broken: [[docs/missing.md]] and [[missing.md]].',
        'Cross-project: [[docs/other-only.md]].',
        `Self: [[${task.path}]].`,
      ].join('\n'),
    });

    const links = await getTaskDocumentLinks(project, task.id);
    assert.equal(links.task.id, task.id);
    assert.equal(links.truncated, false);
    assert.equal(links.unresolvedTruncated, false);

    const byPath = new Map(links.documents.map(doc => [doc.path, doc]));
    assert.equal(byPath.get('docs/plan.md')?.title, 'Delivery plan');
    assert.equal(byPath.get('docs/plan.md')?.type, null);
    assert.equal(byPath.get('docs/plan.md')?.isTask, false);
    assert.deepEqual(byPath.get('docs/plan.md')?.refs, ['docs/plan.md']);
    assert.equal(byPath.get('docs/shared.md')?.title, 'Shared doc in TD');
    const related = byPath.get(relatedTask.path);
    assert.equal(related?.id, relatedTask.id);
    assert.equal(related?.isTask, true);
    assert.equal(related?.status, 'todo');
    assert.deepEqual(related?.refs, [relatedTask.id]);
    assert.equal(byPath.has(task.path), false, 'the task must not link to itself');
    assert.equal(byPath.has('docs/other-only.md'), false, 'documents from other projects must not resolve');

    assert.deepEqual(links.unresolved.sort(), ['docs/missing.md', 'docs/other-only.md', 'missing.md']);

    const otherTask = await createTask(otherProject, { title: 'Other project task', body: '# Other\n\n[[docs/shared.md]]\n' });
    const otherLinks = await getTaskDocumentLinks(otherProject, otherTask.id);
    assert.deepEqual(otherLinks.documents.map(doc => doc.title), ['Shared doc in OT']);

    const response = await app.request(`/api/projects/${project.id}/tasks/${task.id}/documents`);
    assert.equal(response.status, 200);
    const overHttp = await response.json() as typeof links;
    assert.deepEqual(overHttp.documents.map(doc => doc.path).sort(), links.documents.map(doc => doc.path).sort());
    assert.deepEqual(overHttp.unresolved.sort(), links.unresolved.sort());

    const missingTask = await app.request(`/api/projects/${project.id}/tasks/NO-SUCH-TASK/documents`);
    assert.equal(missingTask.status, 404);
    const notATask = await app.request(`/api/projects/${project.id}/tasks/${encodeURIComponent('docs/plan.md')}/documents`);
    assert.equal(notATask.status, 404);

    const cli = await runTsx(['src/cli.ts', 'task', 'docs', task.id, '--project', project.key, '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, LOCALATLAS_HOME: process.env.LOCALATLAS_HOME },
    });
    const fromCli = JSON.parse(cli.stdout) as typeof links;
    assert.deepEqual(fromCli.documents.map(doc => doc.path).sort(), links.documents.map(doc => doc.path).sort());
    assert.deepEqual(fromCli.unresolved.sort(), ['docs/missing.md', 'docs/other-only.md', 'missing.md']);
  });
});

test('task linked documents truncate above twenty resolved links', async () => {
  await withTempHome(async root => {
    const project = await makeProject(root, 'repo-cap', 'CP');
    const refs: string[] = [];
    for (let i = 1; i <= 21; i += 1) {
      const path = `docs/doc-${String(i).padStart(2, '0')}.md`;
      await writeDoc(project, path, `# Doc ${i}\n`);
      refs.push(`[[${path}]]`);
    }
    const task = await createTask(project, { title: 'Many links', body: `# Many links\n\n${refs.join(' ')}\n` });

    const links = await getTaskDocumentLinks(project, task.id);
    assert.equal(links.documents.length, 20);
    assert.equal(links.truncated, true);
    assert.deepEqual(links.unresolved, []);
  });
});

test('task linked documents report exactly twenty resolved links without truncation', async () => {
  await withTempHome(async root => {
    const project = await makeProject(root, 'repo-boundary', 'BD');
    const refs: string[] = [];
    for (let i = 1; i <= 20; i += 1) {
      const path = `docs/doc-${String(i).padStart(2, '0')}.md`;
      await writeDoc(project, path, `# Doc ${i}\n`);
      refs.push(`[[${path}]]`);
    }
    refs.push('[[docs/doc-01.md]]');
    const task = await createTask(project, { title: 'Boundary links', body: `# Boundary links\n\n${refs.join(' ')}\n` });

    const links = await getTaskDocumentLinks(project, task.id);
    assert.equal(links.documents.length, 20);
    assert.equal(links.truncated, false);
    assert.deepEqual(links.unresolved, []);
  });
});

test('stale index entries do not resolve or throw', async () => {
  await withTempHome(async root => {
    const project = await makeProject(root, 'repo-stale', 'ST');
    await withDb(db => db.prepare(`
      INSERT INTO doc_index (project_id, path, doc_id, title, frontmatter_json, etag, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(project.id, 'docs/ghost.md', 'GHOST-1', 'Ghost', '{}', 'etag', new Date().toISOString()));

    const task = await createTask(project, {
      title: 'Stale references',
      body: '# Stale references\n\n[[GHOST-1]] and [[docs/ghost.md]].\n',
    });

    const links = await getTaskDocumentLinks(project, task.id);
    assert.deepEqual(links.documents, []);
    assert.deepEqual(links.unresolved.sort(), ['GHOST-1', 'docs/ghost.md']);
  });
});

test('task linked documents cap unresolved references and flag the truncation', async () => {
  await withTempHome(async root => {
    const project = await makeProject(root, 'repo-unresolved', 'UR');
    const refs = Array.from({ length: 25 }, (_, index) => `[[docs/missing-${String(index + 1).padStart(2, '0')}.md]]`);
    const task = await createTask(project, { title: 'Broken links', body: `# Broken links\n\n${refs.join(' ')}\n` });

    const links = await getTaskDocumentLinks(project, task.id);
    assert.equal(links.documents.length, 0);
    assert.equal(links.unresolved.length, 20);
    assert.equal(links.unresolvedTruncated, true);
    assert.equal(links.truncated, false);
  });
});
