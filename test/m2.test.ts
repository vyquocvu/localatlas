import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, rm, readdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  importProject,
  writeDoc,
  readDoc,
  listDocs,
  moveDoc,
  deleteDoc,
  ConflictError,
  buildFileTree,
  renderMarkdownSafe,
  resolveRelativeDocLink,
  listDirectories,
  pickDirectory,
} from '../src/core.js';
import { app } from '../src/server.js';

const execFileAsync = promisify(execFile);

test('LA-M2-01: Core, CLI, and API document move/rename and delete with ETag & empty folder pruning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m2-01-'));
  const appHome = join(root, 'app');
  process.env.LOCALATLAS_HOME = appHome;
  try {
    const repo = join(root, 'repo');
    await mkdir(repo);
    const p = await importProject(repo, { key: 'M2P' });

    const created = await writeDoc(p, 'a/b/c/deep.md', '# Deep doc\n', { createOnly: true });
    const other = await writeDoc(p, 'existing.md', '# Existing\n', { createOnly: true });

    // Stale ifMatch on moveDoc fails with ConflictError
    await assert.rejects(
      moveDoc(p, 'a/b/c/deep.md', 'a/b/moved.md', { ifMatch: '0000' }),
      ConflictError
    );

    // Moving onto an existing destination without overwrite fails with 409 ConflictError and leaves both intact
    await assert.rejects(
      moveDoc(p, 'a/b/c/deep.md', 'existing.md', { ifMatch: created.etag }),
      ConflictError
    );
    assert.equal(await readDoc(p, 'a/b/c/deep.md'), '# Deep doc\n');
    assert.equal(await readDoc(p, 'existing.md'), '# Existing\n');

    // Move to new path succeeds and prunes empty a/b/c, a/b, a directories while keeping docs/
    const moved = await moveDoc(p, 'a/b/c/deep.md', 'specs/PRD.md', { ifMatch: created.etag });
    assert.equal(moved.path, 'specs/PRD.md');
    assert.equal(await readDoc(p, 'specs/PRD.md'), '# Deep doc\n');
    await assert.rejects(lstat(join(p.managedPath, 'docs', 'a')), { code: 'ENOENT' });

    // Overwrite move with targetIfMatch mismatch fails, matching targetIfMatch + overwrite succeeds
    await assert.rejects(
      moveDoc(p, 'specs/PRD.md', 'existing.md', { overwrite: true, targetIfMatch: 'bad-target-etag' }),
      ConflictError
    );
    await moveDoc(p, 'specs/PRD.md', 'existing.md', {
      ifMatch: moved.etag,
      targetIfMatch: other.etag,
      overwrite: true,
    });
    assert.deepEqual(await listDocs(p), ['existing.md']);
    await assert.rejects(lstat(join(p.managedPath, 'docs', 'specs')), { code: 'ENOENT' });

    // HTTP API move & delete
    const putRes = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/docs/nested/dir/item.md`, {
      method: 'PUT',
      headers: { 'if-none-match': '*' },
      body: '# Item\n',
    });
    assert.equal(putRes.status, 200);
    const itemEtag = putRes.headers.get('etag')!;

    const moveRes = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/docs-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'nested/dir/item.md', to: 'nested/renamed.md', ifMatch: itemEtag }),
    });
    assert.equal(moveRes.status, 200);
    await assert.rejects(lstat(join(p.managedPath, 'docs', 'nested', 'dir')), { code: 'ENOENT' });

    // Delete with wrong ETag fails with 409
    const badDel = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/docs/nested/renamed.md`, {
      method: 'DELETE',
      headers: { 'if-match': '"wrong"' },
    });
    assert.equal(badDel.status, 409);

    // Delete with matching ETag succeeds and prunes nested/ while keeping docs/
    const goodDel = await app.request(`http://127.0.0.1:3456/api/projects/${p.id}/docs/nested/renamed.md`, {
      method: 'DELETE',
      headers: { 'if-match': itemEtag },
    });
    assert.equal(goodDel.status, 200);
    await assert.rejects(lstat(join(p.managedPath, 'docs', 'nested')), { code: 'ENOENT' });
    assert.ok((await lstat(join(p.managedPath, 'docs'))).isDirectory());

    // CLI mv and rm E2E
    const cliPath = join(process.cwd(), 'src', 'cli.ts');
    const tsxBin = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const env = { ...process.env, LOCALATLAS_HOME: appHome };

    await execFileAsync(tsxBin, [cliPath, 'mv', 'existing.md', 'folder/final.md', '--project', 'M2P'], { env });
    assert.deepEqual(await listDocs(p), ['folder/final.md']);

    await execFileAsync(tsxBin, [cliPath, 'rm', 'folder/final.md', '--project', 'M2P'], { env });
    assert.deepEqual(await listDocs(p), []);
    assert.ok((await lstat(join(p.managedPath, 'docs'))).isDirectory());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('LA-M2-02 & LA-M2-03: Offline React + HeroUI shell, CSP header, zero external CDN URLs, and hierarchical file tree', async () => {
  const res = await app.request('http://127.0.0.1:3456/');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);

  // Inspect all static files in public/ to ensure zero external http:// or https:// asset references
  async function collectPublicFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await collectPublicFiles(full)));
      } else {
        out.push(full);
      }
    }
    return out;
  }
  const publicFiles = await collectPublicFiles(join(process.cwd(), 'public'));
  for (const file of publicFiles) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org)[a-z0-9.-]+/i);
  }

  // Verify hierarchical folder tree builder sorts folders-first, then alphabetically
  const tree = buildFileTree(['zeta.md', 'adr/002.md', 'adr/001.md', 'spec/nested/api.md', 'alpha.md']);
  assert.deepEqual(
    tree.map(n => `${n.type}:${n.name}`),
    ['folder:adr', 'folder:spec', 'file:alpha.md', 'file:zeta.md']
  );
  assert.deepEqual(
    tree[0].children?.map(n => `${n.type}:${n.path}`),
    ['file:adr/001.md', 'file:adr/002.md']
  );
});

test('LA-M2-04: XSS-safe Markdown preview renderer with checklists and internal link attributes', async () => {
  const maliciousMd = [
    '# Title <script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[bad](javascript:alert(1))',
    '[data](data:text/html,<script>alert(1)</script>)',
    '[spec](spec/PRD.md)',
    'See [[SAV-024]] for details.',
    '- [ ] Todo task',
    '- [x] Done task',
  ].join('\n');

  const html = renderMarkdownSafe(maliciousMd);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /data:text\/html/i);
  assert.match(html, /data-doc-link="spec\/PRD\.md"/);
  assert.match(html, /data-doc-link="SAV-024"/);
  assert.match(html, /data-task-checkbox/);
  assert.doesNotMatch(html, /<input/i);
});

test('LA-M2 verifier findings: directory case-collision on move, live tmp preservation, relative link resolution, strict scheme allowlist, and CLI/UI ETag guards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-m2-ver-'));
  const appHome = join(root, 'app');
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  process.env.LOCALATLAS_HOME = appHome;
  const tsxBin = join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const cliPath = join(process.cwd(), 'src', 'cli.ts');
  const env = { ...process.env, LOCALATLAS_HOME: appHome };

  try {
    const p = await importProject(repo, { key: 'M2V', name: 'M2 Verifier' });
    const r1 = await writeDoc(p, 'dir/sub/a.md', '# A\n');

    // 1. Directory case-change ('dir/sub/a.md' -> 'DIR/sub/a.md') must be rejected as case collision
    await assert.rejects(
      () => moveDoc(p, 'dir/sub/a.md', 'DIR/sub/a.md'),
      /Case collision/i
    );

    // 2. Case-only filename rename in the same directory ('dir/sub/a.md' -> 'dir/sub/A.md') succeeds
    const rCase = await moveDoc(p, 'dir/sub/a.md', 'dir/sub/A.md', { ifMatch: r1.etag });
    assert.equal(rCase.to, 'dir/sub/A.md');

    // 3. Exact self-move is a safe no-op returning current ETag
    const rSelf = await moveDoc(p, 'dir/sub/A.md', 'dir/sub/A.md', { ifMatch: rCase.etag });
    assert.equal(rSelf.etag, rCase.etag);

    // 4. Live .localatlas-tmp-* file prevents pruneEmptyDirsUpward from deleting parent dir
    const subDir = join(p.managedPath, 'docs', 'dir', 'sub');
    const liveTmp = join(subDir, `.localatlas-tmp-${process.pid}-${Date.now()}`);
    await writeFile(liveTmp, 'in-flight', 'utf8');
    await deleteDoc(p, 'dir/sub/A.md', { ifMatch: rSelf.etag });
    assert.ok((await lstat(subDir)).isDirectory(), 'Parent dir with live tmp file must not be pruned');
    await rm(liveTmp, { force: true });

    // 5. CLI mv and rm with --if-match, --target-if-match, --force, --json, and stale ETag failure
    const c1 = await writeDoc(p, 'cli/one.md', '# One\n');
    const c2 = await writeDoc(p, 'cli/two.md', '# Two\n');
    await assert.rejects(
      () => execFileAsync(tsxBin, [cliPath, 'mv', 'cli/one.md', 'cli/three.md', '--project', 'M2V', '--if-match', '"stale"'], { env })
    );
    const { stdout: mvJson } = await execFileAsync(
      tsxBin,
      [cliPath, 'mv', 'cli/one.md', 'cli/two.md', '--project', 'M2V', '--if-match', c1.etag, '--target-if-match', c2.etag, '--force', '--json'],
      { env }
    );
    assert.equal(JSON.parse(mvJson).to, 'cli/two.md');

    await assert.rejects(
      () => execFileAsync(tsxBin, [cliPath, 'rm', 'cli/two.md', '--project', 'M2V', '--if-match', '"stale"'], { env })
    );
    const { stdout: rmJson } = await execFileAsync(
      tsxBin,
      [cliPath, 'rm', 'cli/two.md', '--project', 'M2V', '--if-match', c1.etag, '--json'],
      { env }
    );
    assert.equal(JSON.parse(rmJson).deleted, 'cli/two.md');

    // 6. Advanced XSS & relative link resolution in renderMarkdownSafe & resolveRelativeDocLink
    assert.equal(resolveRelativeDocLink('adr/001.md', '../spec/PRD.md'), 'spec/PRD.md');
    assert.equal(resolveRelativeDocLink('adr/001.md', './002.md'), 'adr/002.md');
    assert.equal(resolveRelativeDocLink('adr/001.md', '../../escape.md'), null);

    const xssVectors = [
      '[ctrl](\u0001javascript:alert(1))',
      '[vb](vbscript:msgbox(1))',
      '[blob](blob:https://evil.example/123)',
      '[proto](//evil.example/xss.js)',
      '<scr<script>ipt>alert(1)</script>',
      '[codeurl](`http://example.com/"onload="alert(1)`)',
      '[parent](../spec/PRD.md)',
    ].join('\n');
    const rendered = renderMarkdownSafe(xssVectors);
    assert.doesNotMatch(rendered, /javascript:/i);
    assert.doesNotMatch(rendered, /vbscript:/i);
    assert.doesNotMatch(rendered, /blob:/i);
    assert.doesNotMatch(rendered, /\/\/evil\.example/i);
    assert.doesNotMatch(rendered, /<script/i);
    assert.doesNotMatch(rendered, /href="<code>/i);
    assert.match(rendered, /data-doc-link="\.\.\/spec\/PRD\.md"/);

    // 7. Verify public/app.js has matching exports and ETag/unsaved-changes guards
    const appJsSource = await readFile(join(process.cwd(), 'public', 'app.js'), 'utf8');
    assert.match(appJsSource, /export function resolveRelativeDocLink/);
    assert.match(appJsSource, /ifMatch/);
    assert.match(appJsSource, /'if-match'/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Folder picker and directory browser APIs (core, HTTP routes, and UI hooks)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-browse-'));
  try {
    const subAlpha = join(root, 'alpha');
    const subBeta = join(root, 'beta');
    const subHidden = join(root, '.hidden');
    const fileTxt = join(root, 'file.txt');
    await mkdir(subAlpha);
    await mkdir(subBeta);
    await mkdir(subHidden);
    await writeFile(fileTxt, 'content');

    // 1. listDirectories core function
    const listRes = await listDirectories(root);
    assert.equal(listRes.current, root);
    assert.ok(listRes.parent !== undefined);
    assert.deepEqual(listRes.directories.map(d => d.name), ['alpha', 'beta']);
    assert.equal(listRes.directories[0].path, subAlpha);
    assert.equal(listRes.directories[1].path, subBeta);

    // Invalid path fallback
    const fallbackRes = await listDirectories('/nonexistent-dir-12345');
    assert.ok(fallbackRes.current);
    assert.ok(Array.isArray(fallbackRes.directories));

    // 2. pickDirectory core function returns structure with supported
    const pickRes = await pickDirectory();
    assert.equal(typeof pickRes.supported, 'boolean');

    // 3. HTTP GET /api/fs/directories
    const getRes = await app.request(`http://127.0.0.1:3456/api/fs/directories?path=${encodeURIComponent(root)}`);
    assert.equal(getRes.status, 200);
    const getBody: any = await getRes.json();
    assert.equal(getBody.current, root);
    assert.deepEqual(getBody.directories.map((d: any) => d.name), ['alpha', 'beta']);

    // 4. HTTP POST /api/fs/pick-directory
    const postRes = await app.request('http://127.0.0.1:3456/api/fs/pick-directory', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3456' },
    });
    assert.equal(postRes.status, 200);
    const postBody: any = await postRes.json();
    assert.equal(typeof postBody.supported, 'boolean');

    // 5. Verify UI markup in public/app.js
    const appJsSource = await readFile(join(process.cwd(), 'public', 'app.js'), 'utf8');
    assert.match(appJsSource, /\/api\/fs\/pick-directory/);
    assert.match(appJsSource, /\/api\/fs\/directories/);
    assert.match(appJsSource, /Browse\.\.\./);
    assert.match(appJsSource, /Folders/);
    assert.match(appJsSource, /Use Current Folder/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
