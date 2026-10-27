import { runTsx, cleanupTestDirectory } from './helpers.js';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  importProject,
  writeDoc,
  readDoc,
  readDocWithMeta,
  moveDoc,
  deleteDoc,
  ConflictError,
  ValidationError,
  parseDocument,
  updateFrontmatter,
  reindexProject,
  searchDocs,
  listDocsFiltered,
  getBacklinks,
  createTask,
  reconcileProjectIndex,
  startWorkspaceWatcher,
} from '../src/core.js';
import { app } from '../src/server.js';

test('LA-M3-01: Lossless YAML frontmatter parser and strict structured edit mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m3-01-'));
  const appHome = join(root, 'app');
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  process.env.LOCALATLAS_HOME = appHome;

  try {
    const p = await importProject(repo, { key: 'M3A' });

    // 1. Strips UTF-8 BOM, parses frontmatter, ignores --- horizontal rules in body, preserves CRLF
    const crlfDoc =
      '\uFEFF---\r\nid: M3A-001\r\ntype: spec\r\ncustom_key: keep_me\r\ntags:\r\n  - alpha\r\n  - beta\r\n---\r\n# Spec Title\r\n\r\nParagraph 1\r\n---\r\nParagraph 2 after hr\r\n---\r\n';
    const parsed = parseDocument(crlfDoc);
    assert.equal(parsed.hasFrontmatter, true);
    assert.equal(parsed.malformedFrontmatter, false);
    assert.equal(parsed.lineEnding, '\r\n');
    assert.equal(parsed.frontmatter.id, 'M3A-001');
    assert.equal(parsed.frontmatter.custom_key, 'keep_me');
    assert.deepEqual(parsed.frontmatter.tags, ['alpha', 'beta']);
    assert.match(parsed.body, /Paragraph 1\r\n---\r\nParagraph 2 after hr/);

    await writeDoc(p, 'spec/hr.md', crlfDoc);
    await updateFrontmatter(p, 'spec/hr.md', { status: 'approved' });
    const afterUpdate = await readFile(join(p.managedPath, 'docs', 'spec', 'hr.md'), 'utf8');
    assert.match(afterUpdate, /custom_key: keep_me\r\n/);
    assert.match(afterUpdate, /status: approved\r\n/);
    assert.match(afterUpdate, /Paragraph 1\r\n---\r\nParagraph 2 after hr\r\n---\r\n$/);

    // 2. Rejects prototype pollution keys and duplicate YAML keys
    const dupYaml = '---\nid: M3A-002\nid: M3A-003\n---\n# Dup\n';
    const parsedDup = parseDocument(dupYaml);
    assert.equal(parsedDup.malformedFrontmatter, true);

    // 3. Unclosed/invalid YAML frontmatter is tolerated by readDocWithMeta with parseWarning,
    //    but refused by updateFrontmatter (leaving file byte-for-byte unchanged)
    const malformed = '---\nid: M3A-009\n:bad_yaml_line\n# Missing closing fence\nBody text\n';
    const malPath = join(p.managedPath, 'docs', 'broken.md');
    await writeFile(malPath, malformed, 'utf8');

    const meta = await readDocWithMeta(p, 'broken.md');
    assert.ok(meta.parseWarning, 'Expected parseWarning on malformed frontmatter');

    await assert.rejects(
      () => updateFrontmatter(p, 'broken.md', { status: 'todo' }),
      ValidationError
    );
    const onDiskAfter = await readFile(malPath, 'utf8');
    assert.equal(onDiskAfter, malformed, 'Malformed file must remain byte-for-byte unchanged');
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('LA-M3-02: Project-scoped document identity (id) uniqueness & resolution across moves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m3-02-'));
  const appHome = join(root, 'app');
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  process.env.LOCALATLAS_HOME = appHome;

  try {
    const p = await importProject(repo, { key: 'SAV' });
    await writeDoc(p, 'tasks/SAV-024.md', '---\nid: SAV-024\ntype: task\n---\n# Original Task\n');

    // Writing a second document with duplicate id SAV-024 via writeDoc fails with ConflictError
    await assert.rejects(
      () => writeDoc(p, 'other.md', '---\nid: SAV-024\n---\n# Duplicate\n'),
      ConflictError
    );

    // HTTP PUT with duplicate id returns 409 Conflict
    const dupRes = await app.request(
      `http://127.0.0.1:3456/api/projects/${p.id}/docs/other.md`,
      {
        method: 'PUT',
        body: '---\nid: SAV-024\n---\n# Duplicate\n',
      }
    );
    assert.equal(dupRes.status, 409);

    // Reading by frontmatter ID works before and after moving the file
    assert.match(await readDoc(p, 'SAV-024'), /# Original Task/);
    await moveDoc(p, 'tasks/SAV-024.md', 'archive/SAV-024.md');
    assert.match(await readDoc(p, 'SAV-024'), /# Original Task/);
    const meta = await readDocWithMeta(p, 'SAV-024');
    assert.equal(meta.path, 'archive/SAV-024.md');
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('LA-M3-03 & LA-M3-04: Rebuildable FTS5 index cache, atomic reindex, and safe FTS5/frontmatter search', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m3-03-'));
  const appHome = join(root, 'app');
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  process.env.LOCALATLAS_HOME = appHome;

  try {
    const p = await importProject(repo, { key: 'SRCH' });
    await writeDoc(
      p,
      'spec/auth.md',
      '---\nid: SRCH-001\ntype: spec\nstatus: in_progress\nmilestone: M3\n---\n# OAuth2 Token Rotation\nRefresh tokens must rotate atomically.\n'
    );
    await writeDoc(
      p,
      'tasks/login.md',
      '---\nid: SRCH-002\ntype: task\nstatus: todo\nmilestone: M3\nepic: SRCH-001\n---\n# Login UI\nImplement OAuth2 login button.\n'
    );

    // Wipe disposable tables doc_index, doc_fts, doc_links directly in SQLite
    const db = new DatabaseSync(join(appHome, 'atlas.db'));
    db.exec('DELETE FROM doc_index; DELETE FROM doc_fts; DELETE FROM doc_links;');
    db.close();

    // Reindex reconstructs identical metadata & search results while keeping projects intact
    const reindexed = await reindexProject(p);
    assert.equal(reindexed.indexedDocs, 2);
    assert.equal(reindexed.warnings.length, 0);

    const hits = await searchDocs(p, 'OAuth2', { type: 'spec' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, 'spec/auth.md');
    assert.equal(hits[0].docId, 'SRCH-001');

    // Filtered listDocs
    const todoTasks = await listDocsFiltered(p, { type: 'task', status: 'todo', milestone: 'M3' });
    assert.equal(todoTasks.length, 1);
    assert.equal(todoTasks[0].path, 'tasks/login.md');

    // Malformed FTS5 operator strings never throw SQLite syntax errors
    for (const tricky of ['"unclosed quote', 'AND OR NOT', 'NEAR(a, b)', 'foo* : [bar]', '((()))']) {
      const safeHits = await searchDocs(p, tricky);
      assert.ok(Array.isArray(safeHits));
      const res = await app.request(
        `http://127.0.0.1:3456/api/projects/${p.id}/search?q=${encodeURIComponent(tricky)}`
      );
      assert.equal(res.status, 200);
    }
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('LA-M3-05: Wiki-links, relative links, code-block exclusion, and backlinks graph', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m3-05-'));
  const appHome = join(root, 'app');
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  process.env.LOCALATLAS_HOME = appHome;

  try {
    const p = await importProject(repo, { key: 'LNK' });
    await writeDoc(p, 'spec/PRD.md', '---\nid: LNK-001\ntype: spec\n---\n# Product Requirements\n');
    await writeDoc(
      p,
      'adr/001-storage.md',
      [
        '---',
        'id: LNK-002',
        'type: adr',
        '---',
        '# Storage Decision',
        'Implements [[LNK-001]] and links to [PRD](../spec/PRD.md).',
        'Ignore inline `[[FAKE-001]]` and fenced:',
        '```md',
        '[[FAKE-002]] and [Fake](../spec/FAKE.md)',
        '```',
      ].join('\n')
    );

    // Backlinks by path or by ID find adr/001-storage.md
    const blByPath = await getBacklinks(p, 'spec/PRD.md');
    assert.equal(blByPath.length, 1);
    assert.equal(blByPath[0].sourcePath, 'adr/001-storage.md');
    assert.equal(blByPath[0].sourceType, 'adr');

    const blById = await getBacklinks(p, 'LNK-001');
    assert.equal(blById.length, 1);
    assert.equal(blById[0].sourceId, 'LNK-002');

    const taskSource = await createTask(p, { title: 'Task referencing PRD', body: '# Task referencing PRD\n\nSee [[LNK-001]].\n' });
    const blWithTask = await getBacklinks(p, 'LNK-001');
    const taskBacklink = blWithTask.find(entry => entry.sourcePath === taskSource.path);
    assert.equal(taskBacklink?.sourceType, 'task');
    assert.equal(taskBacklink?.sourceStatus, 'todo');
    assert.equal(blWithTask.some(entry => entry.sourceType === 'adr'), true);

    // Fake links inside code blocks must not produce backlinks
    assert.equal((await getBacklinks(p, 'FAKE-001')).length, 0);
    assert.equal((await getBacklinks(p, 'FAKE-002')).length, 0);

    // Moving spec/PRD.md to archive/PRD.md preserves [[LNK-001]] backlink resolution
    await moveDoc(p, 'spec/PRD.md', 'archive/PRD.md');
    const blAfterMove = await getBacklinks(p, 'archive/PRD.md');
    assert.equal(blAfterMove.some(entry => entry.sourcePath === 'adr/001-storage.md'), true);
    assert.equal(blAfterMove.some(entry => entry.sourcePath === taskSource.path), true);

    // Deleting source document removes its outbound link edges immediately
    await deleteDoc(p, 'adr/001-storage.md');
    const afterDelete = await getBacklinks(p, 'LNK-001');
    assert.equal(afterDelete.some(entry => entry.sourcePath === 'adr/001-storage.md'), false);
    assert.equal(afterDelete.some(entry => entry.sourcePath === taskSource.path), true);
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('LA-M3-06 & LA-M3-07: External edit reconciliation, file watcher, and SSE notifications', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m3-06-'));
  const appHome = join(root, 'app');
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  process.env.LOCALATLAS_HOME = appHome;

  try {
    const p = await importProject(repo, { key: 'WCH' });
    await writeDoc(p, 'notes/first.md', '---\nid: WCH-001\n---\n# Initial Note\n');

    // Simulate external edit & rename while server was stopped
    const docsDir = join(p.managedPath, 'docs');
    await writeFile(join(docsDir, 'notes', 'external.md'), '---\nid: WCH-002\n---\n# External Created\n', 'utf8');
    await rename(join(docsDir, 'notes', 'first.md'), join(docsDir, 'notes', 'renamed.md'));
    // Also create a .localatlas-tmp-* file that must be ignored
    await writeFile(join(docsDir, 'notes', '.localatlas-tmp-999'), 'ignore me', 'utf8');

    const recon = await reconcileProjectIndex(p);
    assert.ok(recon.changed >= 2);

    const hits = await searchDocs(p, 'External Created');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, 'notes/external.md');

    // Renamed file still resolves by ID WCH-001 at notes/renamed.md
    const meta = await readDocWithMeta(p, 'WCH-001');
    assert.equal(meta.path, 'notes/renamed.md');

    // Start and stop workspace watcher cleanly
    const watcher = await startWorkspaceWatcher({ intervalMs: 5000 });
    await watcher.close();

    // Verify SSE endpoint streams initial/live event payload
    const sseRes = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/events?once=1`);
    assert.equal(sseRes.status, 200);
    assert.match(sseRes.headers.get('content-type') ?? '', /text\/event-stream/);
    const sseText = await sseRes.text();
    assert.match(sseText, /data:/);
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('LA-M3 verifier findings: lossless quoted YAML round-trip, HR vs frontmatter guard, LIKE wildcard escaping, moveDoc ID uniqueness, stale index ID check, HTTP & CLI E2E', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m3-ver-'));
  const appHome = join(root, 'app');
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  process.env.LOCALATLAS_HOME = appHome;
  const cliPath = join(process.cwd(), 'src', 'cli.ts');
  const env = { ...process.env, LOCALATLAS_HOME: appHome };

  try {
    const p = await importProject(repo, { key: 'M3V' });

    // 1. Lossless round-trip of double-quoted YAML scalars containing quotes and colons
    await writeDoc(p, 'notes/quote.md', '# Body\n');
    await updateFrontmatter(p, 'notes/quote.md', { title: 'Hello "World": Part 1', status: 'todo' });
    await updateFrontmatter(p, 'notes/quote.md', { priority: 'high' });
    const metaQuote = await readDocWithMeta(p, 'notes/quote.md');
    assert.equal(metaQuote.frontmatter?.title, 'Hello "World": Part 1');

    // 2. Top-of-file horizontal rule followed by # Heading and another --- is NOT swallowed as YAML comments
    const hrDoc = '---\n\n# My Real Heading\n\n---\nBody text\n';
    const parsedHr = parseDocument(hrDoc);
    assert.match(parsedHr.body, /# My Real Heading/);

    // 3. LIKE fallback escapes % and _ wildcards so searching "%" only matches literal "%"
    await writeDoc(p, 'notes/plain.md', '---\nid: M3V-001\ntype: spec\n---\n# Plain Document\nNo percent sign here.\n');
    const pctHits = await searchDocs(p, '%');
    assert.equal(pctHits.length, 0, 'Searching literal "%" must not match every document');

    // 4. Stale index entry when on-disk frontmatter ID was externally changed
    const plainDisk = join(p.managedPath, 'docs', 'notes', 'plain.md');
    await writeFile(plainDisk, '---\nid: M3V-999\ntype: spec\n---\n# Plain Document\n', 'utf8');
    await assert.rejects(() => readDoc(p, 'M3V-001'));
    assert.match(await readDoc(p, 'M3V-999'), /# Plain Document/);

    // 5. moveDoc enforces id uniqueness if an externally edited file introduced a duplicate id
    const dupDisk = join(p.managedPath, 'docs', 'notes', 'ext-dup.md');
    await writeFile(dupDisk, '---\nid: M3V-999\n---\n# External Dup\n', 'utf8');
    await assert.rejects(
      () => moveDoc(p, 'notes/ext-dup.md', 'notes/moved-dup.md'),
      ConflictError
    );
    await rm(dupDisk, { force: true });

    // 6. HTTP endpoints: PATCH /docs/*, POST /reindex, GET /docs?type=..., GET /api/search, GET /backlinks/*, SSE seq
    const patchRes = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/docs/notes/plain.md`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set: { status: 'in_progress', milestone: 'M3' } }),
    });
    assert.equal(patchRes.status, 200);

    const reindexRes = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/reindex`, { method: 'POST' });
    assert.equal(reindexRes.status, 200);
    const reindexBody = (await reindexRes.json()) as { indexedDocs: number };
    assert.equal(reindexBody.indexedDocs, 2);

    const filteredRes = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/docs?type=spec&status=in_progress`);
    assert.equal(filteredRes.status, 200);
    const filteredDocs = (await filteredRes.json()) as Array<{ path: string }>;
    assert.equal(filteredDocs.length, 1);
    assert.equal(filteredDocs[0].path, 'notes/plain.md');

    const globalSearchRes = await app.request('http://127.0.0.1:3456/api/search?q=Plain');
    assert.equal(globalSearchRes.status, 200);
    const globalHits = (await globalSearchRes.json()) as Array<{ path: string }>;
    assert.equal(globalHits.length, 1);

    const sseRes = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/events?once=1`);
    const sseText = await sseRes.text();
    assert.match(sseText, /"seq":\d+/);

    // 7. CLI E2E: meta set, reindex, docs --type, search --all-projects, backlinks
    await runTsx([cliPath, 'meta', 'set', 'M3V-999', 'epic=M3V-EPIC', '--unset', 'milestone', '--project', 'M3V', '--json'],
      { env }
    );
    const { stdout: searchOut } = await runTsx([cliPath, 'search', 'Plain', '--type', 'spec', '--all-projects', '--json'],
      { env }
    );
    assert.equal(JSON.parse(searchOut).length, 1);

    const { stdout: reindexOut } = await runTsx([cliPath, 'reindex', '--project', 'M3V', '--json'],
      { env }
    );
    assert.equal(JSON.parse(reindexOut).indexedDocs, 2);
  } finally {
    await cleanupTestDirectory(root);
  }
});
