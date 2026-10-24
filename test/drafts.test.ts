import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanupTestDirectory } from './helpers.js';
import { importProject, readDocumentDraft, writeDocumentDraft, deleteDocumentDraft } from '../src/core.js';
import { app } from '../src/server.js';

test('browser drafts persist in project-managed storage, stay scoped, and remain outside the document index', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-drafts-'));
  const home = path.join(root, 'atlas-home');
  const repoA = path.join(root, 'repo-a');
  const repoB = path.join(root, 'repo-b');
  process.env.LOCALATLAS_HOME = home;
  await fs.mkdir(repoA, { recursive: true });
  await fs.mkdir(repoB, { recursive: true });
  try {
    const projectA = await importProject(repoA, { key: 'DRA' });
    const projectB = await importProject(repoB, { key: 'DRB' });
    const created = await writeDocumentDraft(projectA, 'spec/plan.md', {
      content: '# Unsaved plan', baseEtag: 'base-etag', isNewDoc: false,
    });
    assert.equal(created.content, '# Unsaved plan');
    assert.equal((await readDocumentDraft(projectA, 'spec/plan.md'))?.baseEtag, 'base-etag');
    assert.equal(await readDocumentDraft(projectB, 'spec/plan.md'), null);

    const apiRead = await app.request(`/api/projects/${projectA.id}/drafts/spec/plan.md`, {
      headers: { host: '127.0.0.1:3456' },
    });
    assert.equal(apiRead.status, 200);
    assert.equal((await apiRead.json() as { content: string }).content, '# Unsaved plan');

    const apiWrite = await app.request(`/api/projects/${projectA.id}/drafts/spec/plan.md`, {
      method: 'PUT',
      headers: { host: '127.0.0.1:3456', 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# Updated draft', baseEtag: 'next-etag', isNewDoc: true }),
    });
    assert.equal(apiWrite.status, 200, await apiWrite.clone().text());
    assert.equal((await readDocumentDraft(projectA, 'spec/plan.md'))?.content, '# Updated draft');

    const outsideDocs = await fs.readdir(path.join(projectA.managedPath, 'docs'));
    assert.deepEqual(outsideDocs, []);
    const apiDelete = await app.request(`/api/projects/${projectA.id}/drafts/spec/plan.md`, {
      method: 'DELETE',
      headers: { host: '127.0.0.1:3456' },
    });
    assert.equal(apiDelete.status, 200);
    assert.equal(await readDocumentDraft(projectA, 'spec/plan.md'), null);

    await writeDocumentDraft(projectA, 'spec/plan.md', { content: 'temporary' });
    await deleteDocumentDraft(projectA, 'spec/plan.md');
    assert.equal(await readDocumentDraft(projectA, 'spec/plan.md'), null);
  } finally {
    await cleanupTestDirectory(root);
  }
});
