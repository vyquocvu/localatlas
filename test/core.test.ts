import { runTsx, cleanupTestDirectory } from './helpers.js';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, symlink, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  importProject,
  projects,
  updateProject,
  removeProject,
  listDocs,
  readDoc,
  readDocWithMeta,
  writeDoc,
  documentPath,
  selectProject,
  backupWorkspace,
  restoreWorkspace,
  registerServerLock,
  ConflictError,
} from '../src/core.js';
import { app } from '../src/server.js';

test('LA-M1-01: canonical path rules, non-overlapping storage, case collision, and symlink confinement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m1-01-'));
  process.env.LOCALATLAS_HOME = join(root, 'workspace', 'app-home');
  try {
    await mkdir(process.env.LOCALATLAS_HOME, { recursive: true });

    // Reject importing an ancestor of LOCALATLAS_HOME or a child inside LOCALATLAS_HOME
    await assert.rejects(importProject(join(root, 'workspace')), /cannot overlap with LOCALATLAS_HOME/);
    const insideHome = join(process.env.LOCALATLAS_HOME, 'nested-repo');
    await mkdir(insideHome, { recursive: true });
    await assert.rejects(importProject(insideHome), /cannot overlap with LOCALATLAS_HOME/);

    const repoA = join(root, 'project-a');
    await mkdir(repoA);
    const a = await importProject(repoA);

    // Reject Windows reserved device names, drive letters, trailing dots/spaces, backslashes
    for (const bad of ['../escape.md', 'notes.txt', 'CON.md', 'sub/aux.md', 'C:/foo.md', 'dir./doc.md', 'dir\\doc.md']) {
      await assert.rejects(documentPath(a, bad), /Invalid document path/);
    }

    // Reject tampered managedPath
    await assert.rejects(
      documentPath({ ...a, managedPath: join(root, 'elsewhere') }, 'PRD.md'),
      /Invalid project managedPath/
    );

    // Reject case-insensitive file collision
    await writeDoc(a, 'spec/Readme.md', '# Readme');
    await assert.rejects(writeDoc(a, 'spec/readme.md', '# lower'), /case collision/);

    // Reject symlinks inside managed docs
    const outsideFile = join(root, 'secret.md');
    await writeFile(outsideFile, '# Secret');
    await symlink(outsideFile, join(a.managedPath, 'docs', 'linked.md'));
    await assert.rejects(readDoc(a, 'linked.md'), /Symlinks are not allowed/);
    assert.deepEqual(await listDocs(a), ['spec/Readme.md']);
  } finally {
    await cleanupTestDirectory(root);
  }
});
test('LA-M1-02: SQLite registry and verified all-or-nothing projects.json migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m1-02-'));
  const appHome = join(root, 'app');
  process.env.LOCALATLAS_HOME = appHome;
  try {
    await mkdir(appHome, { recursive: true });
    const repo1 = join(root, 'repo-1');
    const repo2 = join(root, 'repo-2');
    await mkdir(repo1);
    await mkdir(repo2);

    const id1 = randomUUID();
    const id2 = randomUUID();

    // 1. Conflicting projects.json (duplicate id with different sourcePath) must abort and keep projects.json intact
    const conflictingJson = [
      { id: id1, name: 'repo-1', sourcePath: repo1, managedPath: join(appHome, 'projects', id1), createdAt: '2026-01-01T00:00:00.000Z' },
      { id: id1, name: 'repo-2', sourcePath: repo2, managedPath: join(appHome, 'projects', id1), createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    await writeFile(join(appHome, 'projects.json'), JSON.stringify(conflictingJson));
    await assert.rejects(projects(), /Migration conflict/);
    // Verify projects.json was NOT renamed or deleted
    const stillThere = await readFile(join(appHome, 'projects.json'), 'utf8');
    assert.ok(stillThere.includes(id1));

    // 2. Valid projects.json migrates cleanly and renames to projects.json.migrated
    const validJson = [
      { id: id1, name: 'repo-1', sourcePath: repo1, managedPath: join(appHome, 'projects', id1), createdAt: '2026-01-01T00:00:00.000Z' },
      { id: id2, name: 'repo-2', sourcePath: repo2, managedPath: join(appHome, 'projects', id2), createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    await writeFile(join(appHome, 'projects.json'), JSON.stringify(validJson));
    const migrated = await projects();
    assert.equal(migrated.length, 2);
    assert.equal(migrated[0].id, id1);
    assert.equal(migrated[0].key, 'REP');
    assert.equal(migrated[1].id, id2);
    assert.equal(migrated[1].key, 'REP2');

    const homeEntries = await readdir(appHome);
    assert.ok(homeEntries.includes('projects.json.migrated'));
    assert.ok(!homeEntries.includes('projects.json'));

    // 3. Simulate crash recovery where projects.json still exists after rows were already committed
    await writeFile(join(appHome, 'projects.json'), JSON.stringify(validJson));
    const recovered = await projects();
    assert.equal(recovered.length, 2);
  } finally {
    await cleanupTestDirectory(root);
  }
});
test('LA-M1-03: project keys, disambiguation, key immutability policy, and remove without purging docs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m1-03-'));
  process.env.LOCALATLAS_HOME = join(root, 'app');
  try {
    const aDir = join(root, 'client-1', 'service');
    const bDir = join(root, 'client-2', 'service');
    await mkdir(aDir, { recursive: true });
    await mkdir(bDir, { recursive: true });

    const a = await importProject(aDir, { key: 'SAV' });
    const b = await importProject(bDir);
    assert.equal(a.key, 'SAV');
    assert.equal(b.key, 'SER');

    // Ambiguous name requires id or key
    await assert.rejects(selectProject('service'), /Ambiguous project name/);
    assert.equal((await selectProject('sav')).id, a.id);
    assert.equal((await selectProject('SER')).id, b.id);
    assert.equal((await selectProject(undefined, join(aDir, 'src'))).id, a.id);

    // Key can be updated before any <KEY>-<NNN> doc exists
    const renamed = await updateProject('SAV', { name: 'sav-service', key: 'SVS' });
    assert.equal(renamed.key, 'SVS');
    assert.equal(renamed.name, 'sav-service');

    // Once a document has frontmatter id: SVS-001, changing key without force is rejected
    await writeDoc(renamed, 'tasks/SVS-001.md', '---\nid: SVS-001\ntype: task\n---\n# Task 1\n');
    await assert.rejects(updateProject('SVS', { key: 'NEWK' }), /already referenced by existing document IDs/);
    const forced = await updateProject('SVS', { key: 'NEWK' }, { force: true });
    assert.equal(forced.key, 'NEWK');

    // Remove project without purgeDocs leaves .md files intact on disk
    const docDiskPath = await documentPath(forced, 'tasks/SVS-001.md');
    const remResult = await removeProject(forced.id);
    assert.equal(remResult.purgedDocs, false);
    assert.equal((await projects()).length, 1);
    assert.match(await readFile(docDiskPath, 'utf8'), /SVS-001/);
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('LA-M1-04: ETag conditional writes (If-Match, createOnly) and concurrent write serialization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m1-04-'));
  process.env.LOCALATLAS_HOME = join(root, 'app');
  try {
    const repo = join(root, 'repo');
    await mkdir(repo);
    const p = await importProject(repo);

    const first = await writeDoc(p, 'PRD.md', '# v1\n', { createOnly: true });
    await assert.rejects(writeDoc(p, 'PRD.md', '# dup\n', { createOnly: true }), ConflictError);

    const second = await writeDoc(p, 'PRD.md', '# v2\n', { ifMatch: first.etag });
    assert.notEqual(second.etag, first.etag);

    // Stale ETag must fail with ConflictError and preserve v2 on disk
    await assert.rejects(
      async () => {
        await writeDoc(p, 'PRD.md', '# stale overwrite\n', { ifMatch: first.etag });
      },
      (err: unknown) => {
        assert.ok(err instanceof ConflictError);
        assert.equal(err.currentEtag, second.etag);
        return true;
      }
    );
    assert.equal(await readDoc(p, 'PRD.md'), '# v2\n');

    // 10 concurrent writes serialize cleanly without leaving .localatlas-tmp-* files
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => writeDoc(p, 'concurrent.md', `# Content iteration ${i}\n`))
    );
    const meta = await readDocWithMeta(p, 'concurrent.md');
    assert.match(meta.content, /^# Content iteration \d\n$/);
    const rawEntries = await readdir(join(p.managedPath, 'docs'));
    assert.ok(rawEntries.every(e => !e.startsWith('.localatlas-tmp-')));
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('LA-M1-05: HTTP server Host/Origin/Sec-Fetch-Site guards, payload limit, ETag, and URL encoding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m1-05-'));
  process.env.LOCALATLAS_HOME = join(root, 'app');
  const prevCwd = process.cwd();
  try {
    const repoDir = join(root, 'my-repo');
    await mkdir(repoDir);

    // DNS rebinding Host guard on GET
    const badHost = await app.request('http://127.0.0.1:3456/api/projects', {
      headers: { host: 'evil.rebind.network:3456' },
    });
    assert.equal(badHost.status, 403);

    // CSRF Origin & Sec-Fetch-Site guards on POST
    const badOrigin = await app.request('http://127.0.0.1:3456/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ path: repoDir }),
    });
    assert.equal(badOrigin.status, 403);

    const crossSite = await app.request('http://127.0.0.1:3456/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ path: repoDir }),
    });
    assert.equal(crossSite.status, 403);

    // Valid import
    const createdRes = await app.request('http://127.0.0.1:3456/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3456' },
      body: JSON.stringify({ path: repoDir, key: 'MYR' }),
    });
    assert.equal(createdRes.status, 201);
    const created = (await createdRes.json()) as { id: string; key: string };
    assert.equal(created.key, 'MYR');

    // Create doc with If-None-Match: * and update with If-Match
    const encodedPath = 'guides/Getting%20Started.md';
    const putRes = await app.request(`http://127.0.0.1:3456/api/projects/${created.id}/docs/${encodedPath}`, {
      method: 'PUT',
      headers: { 'if-none-match': '*' },
      body: '# Getting Started\n',
    });
    assert.equal(putRes.status, 200);
    const etag1 = putRes.headers.get('etag');
    assert.ok(etag1);

    // Duplicate create with If-None-Match: * returns 409
    const dupCreate = await app.request(`http://127.0.0.1:3456/api/projects/${created.id}/docs/${encodedPath}`, {
      method: 'PUT',
      headers: { 'if-none-match': '*' },
      body: '# Dup\n',
    });
    assert.equal(dupCreate.status, 409);

    // Stale If-Match returns 409
    const stalePut = await app.request(`http://127.0.0.1:3456/api/projects/${created.id}/docs/${encodedPath}`, {
      method: 'PUT',
      headers: { 'if-match': '"00000000"' },
      body: '# Stale\n',
    });
    assert.equal(stalePut.status, 409);

    // Matching If-Match succeeds
    const putRes2 = await app.request(`http://127.0.0.1:3456/api/projects/${created.id}/docs/${encodedPath}`, {
      method: 'PUT',
      headers: { 'if-match': etag1! },
      body: '# Updated Guide\n',
    });
    assert.equal(putRes2.status, 200);

    // Encoded slash (%2f) and malformed percent encoding (%E0%A4%A) return 400
    const encodedSlash = await app.request(`http://127.0.0.1:3456/api/projects/${created.id}/docs/..%2fsecret.md`);
    assert.equal(encodedSlash.status, 400);
    const malformedUri = await app.request(`http://127.0.0.1:3456/api/projects/${created.id}/docs/bad%E0%A4%A.md`);
    assert.equal(malformedUri.status, 400);

    // Oversized payload (> 5 MB) returns 413
    const hugeRes = await app.request(`http://127.0.0.1:3456/api/projects/${created.id}/docs/huge.md`, {
      method: 'PUT',
      headers: { 'content-length': String(6 * 1024 * 1024) },
      body: 'x',
    });
    assert.equal(hugeRes.status, 413);

    // Static shell resolves when cwd is outside the LocalAtlas repo
    process.chdir(repoDir);
    const indexRes = await app.request('http://127.0.0.1:3456/');
    assert.equal(indexRes.status, 200);
    assert.match(await indexRes.text(), /LocalAtlas/);
  } finally {
    process.chdir(prevCwd);
    await cleanupTestDirectory(root);
  }
});

test('LA-M1-06: coordinated workspace backup and offline restore verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m1-06-'));
  const homeA = join(root, 'home-a');
  const homeB = join(root, 'home-b');
  const backupDir = join(root, 'backup-1');
  process.env.LOCALATLAS_HOME = homeA;
  try {
    const repo = join(root, 'alpha-repo');
    await mkdir(repo);
    const p = await importProject(repo, { key: 'ALP' });
    await writeDoc(p, 'arch/overview.md', '# Architecture Overview\n');
    await writeDoc(p, 'README.md', '# Readme\n');

    const backupSummary = await backupWorkspace(backupDir);
    assert.equal(backupSummary.projectsCount, 1);
    assert.equal(backupSummary.docsCount, 2);

    // Restore into a fresh LOCALATLAS_HOME (homeB) and verify byte-for-byte parity
    process.env.LOCALATLAS_HOME = homeB;
    const restoreSummary = await restoreWorkspace(backupDir);
    assert.equal(restoreSummary.restoredProjects, 1);
    assert.equal(restoreSummary.restoredDocs, 2);

    const restoredProjects = await projects();
    assert.equal(restoredProjects.length, 1);
    assert.equal(restoredProjects[0].id, p.id);
    assert.equal(restoredProjects[0].key, 'ALP');
    assert.equal(await readDoc(restoredProjects[0], 'arch/overview.md'), '# Architecture Overview\n');
    assert.equal(await readDoc(restoredProjects[0], 'README.md'), '# Readme\n');

    // Restore into non-empty home without force fails with ConflictError
    await assert.rejects(restoreWorkspace(backupDir), /not empty; pass --force/);

    // Restore while server lock is active fails with ConflictError
    const releaseServer = await registerServerLock();
    try {
      await assert.rejects(restoreWorkspace(backupDir, { force: true }), /while another LocalAtlas process is active/);
    } finally {
      await releaseServer();
    }

    // Tampering with a backed-up .md file aborts restore before modifying homeB
    await writeDoc(restoredProjects[0], 'README.md', '# Untouched HomeB\n');
    const backedUpReadme = join(backupDir, 'projects', p.id, 'docs', 'README.md');
    await writeFile(backedUpReadme, '# Tampered content\n');
    await assert.rejects(restoreWorkspace(backupDir, { force: true }), /Checksum mismatch/);
    assert.equal(await readDoc(restoredProjects[0], 'README.md'), '# Untouched HomeB\n');
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('LA-M1 verifier findings: --reuse-docs, If-Match: *, frontmatter boundary, HTTP PATCH/DELETE, and CLI E2E', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m1-verify-'));
  const appHome = join(root, 'app');
  process.env.LOCALATLAS_HOME = appHome;
  try {
    const repo = join(root, 'verify-repo');
    await mkdir(repo);

    // 1. Frontmatter boundary: id: VER-001 in body before a --- rule must NOT block key update
    const p = await importProject(repo, { key: 'VER' });
    await writeDoc(p, 'notes.md', '---\ntitle: Plain Note\n---\nBody mentions\nid: VER-001\n---\nFooter\n');
    const updated = await updateProject('VER', { key: 'VRX' });
    assert.equal(updated.key, 'VRX');

    // 2. If-Match: "*" on non-existent file must throw ConflictError
    await assert.rejects(writeDoc(updated, 'missing.md', '# New\n', { ifMatch: '*' }), ConflictError);

    // 3. Remove without purgeDocs, then re-import with reuseDocs re-attaches existing docs
    await removeProject(updated.id, { purgeDocs: false });
    const reattached = await importProject(repo, { key: 'VRX', reuseDocs: updated.id });
    assert.equal(reattached.id, updated.id);
    assert.deepEqual(await listDocs(reattached), ['notes.md']);

    // 4. HTTP Origin port mismatch when Host has no port -> 403, plus PATCH & DELETE /api/projects/:id
    const portMismatch = await app.request('http://127.0.0.1/api/projects', {
      method: 'POST',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1:9999', 'content-type': 'application/json' },
      body: JSON.stringify({ path: repo }),
    });
    assert.equal(portMismatch.status, 403);

    const patchRes = await app.request(`http://127.0.0.1:3456/api/projects/${reattached.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'verified-name', key: 'VRF' }),
    });
    assert.equal(patchRes.status, 200);
    assert.equal(((await patchRes.json()) as { key: string }).key, 'VRF');

    // 5. CLI E2E: write --content starting with "---" and --append starting with "- [ ]"
    const cliPath = join(process.cwd(), 'src', 'cli.ts');
    const env = { ...process.env, LOCALATLAS_HOME: appHome };

    const { stdout: writeOut } = await runTsx([cliPath, 'write', 'tasks/VRF-001.md', '--project', 'VRF', '--create-only', '--content', '---\nid: VRF-001\n---\n# Task\n', '--json'],
      { env }
    );
    const writeJson = JSON.parse(writeOut) as { ok: boolean; etag: string };
    assert.equal(writeJson.ok, true);

    const { stdout: appendOut } = await runTsx([cliPath, 'write', 'tasks/VRF-001.md', '--project', 'VRF', '--if-match', writeJson.etag, '--append', '- [ ] checklist item\n', '--json'],
      { env }
    );
    const appendJson = JSON.parse(appendOut) as { ok: boolean; etag: string };
    assert.equal(appendJson.ok, true);

    const { stdout: readOut } = await runTsx([cliPath, 'read', 'tasks/VRF-001.md', '--project', 'VRF', '--json'],
      { env }
    );
    const readJson = JSON.parse(readOut) as { content: string; etag: string };
    assert.equal(readJson.etag, appendJson.etag);
    assert.match(readJson.content, /- \[ \] checklist item/);

    // 6. HTTP DELETE with purgeDocs=true deletes the managed directory
    const delRes = await app.request(`http://127.0.0.1:3456/api/projects/${reattached.id}?purgeDocs=true`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    assert.equal(((await delRes.json()) as { purgedDocs: boolean }).purgedDocs, true);
  } finally {
    await cleanupTestDirectory(root);
  }
});
