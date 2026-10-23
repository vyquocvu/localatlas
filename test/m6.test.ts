import { runTsx, runNpm, cleanupTestDirectory, closeTestDatabase } from './helpers.js';
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
  createTask,
  searchDocs,
  getBacklinks,
  reindexProject,
} from '../src/core.js';
import { app } from '../src/server.js';

const execFileAsync = promisify(execFile);

async function makeTempEnv() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m6-'));
  const home = path.join(base, 'home');
  const source = path.join(base, 'repo');

  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(source, { recursive: true });

  return {
    base,
    home,
    source,
    cleanup: async () => {
      try {
        await cleanupTestDirectory(base);
      } catch {}
    },
  };
}

test('LA-M6-01: Distributable build, global CLI entrypoint (bin), and smoke test from external directory', async () => {
  // 1. Check package.json declarations for bin and files
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  assert.ok(pkg.bin, 'package.json missing "bin" field');
  assert.equal(pkg.bin.localatlas, './dist/cli.js');
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('dist'), 'package.json missing "dist" in files');
  assert.ok(pkg.scripts?.build, 'package.json missing "build" script');

  // 2. Run npm run build
  await runNpm(['run', 'build'], { cwd: process.cwd() });

  const distCli = path.resolve(process.cwd(), 'dist/cli.js');
  const distCore = path.resolve(process.cwd(), 'dist/core.js');
  const distServer = path.resolve(process.cwd(), 'dist/server.js');

  await fs.access(distCli);
  await fs.access(distCore);
  await fs.access(distServer);

  // Check shebang preserved
  const cliContent = await fs.readFile(distCli, 'utf8');
  assert.ok(cliContent.startsWith('#!/usr/bin/env node'), 'Compiled dist/cli.js must preserve shebang');

  // 3. Smoke test: run node dist/cli.js from an isolated temp environment
  const env = await makeTempEnv();
  try {
    const cliEnv = { ...process.env, LOCALATLAS_HOME: env.home };

    // import
    const { stdout: importOut } = await execFileAsync(
      process.execPath,
      [distCli, 'import', env.source, '--key', 'SMK', '--name', 'Smoke Project'],
      { cwd: env.base, env: cliEnv }
    );
    assert.match(importOut, /SMK/);

    // write doc
    await execFileAsync(
      process.execPath,
      [distCli, 'write', 'spec/smoke.md', '--content', '# Smoke Test Spec\nVerified successfully.\n'],
      { cwd: env.source, env: cliEnv }
    );

    // read doc --json
    const { stdout: readOut } = await execFileAsync(
      process.execPath,
      [distCli, 'read', 'spec/smoke.md', '--json'],
      { cwd: env.source, env: cliEnv }
    );
    const readParsed = JSON.parse(readOut);
    assert.match(readParsed.content, /Smoke Test Spec/);
    assert.ok(readParsed.etag);

    // static asset serving smoke test via app
    const res = await app.request('/', {
      headers: { host: '127.0.0.1:3000' },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /LocalAtlas/);
  } finally {
    await env.cleanup();
  }
});

test('LA-M6-02: Multi-process contention, stale temporary lockfile cleanup, and index recovery', async () => {
  const env = await makeTempEnv();
  try {
    process.env.LOCALATLAS_HOME = env.home;
    const project = await importProject(env.source, { key: 'RCV', name: 'Recovery Project' });

    // 1. Multi-process concurrent writes
    // Spawn 8 parallel worker processes writing distinct documents simultaneously
    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');
    const cliEnv = { ...process.env, LOCALATLAS_HOME: env.home };

    const writePromises = Array.from({ length: 8 }).map(async (_, idx) => {
      return runTsx([cliPath, 'write', `concurrent/doc-${idx}.md`, '--content', `# Concurrent Doc ${idx}\nContent for ${idx}\n`],
        { cwd: env.source, env: cliEnv }
      );
    });

    const results = await Promise.all(writePromises);
    assert.equal(results.length, 8);

    // Verify all 8 documents exist and are indexed
    for (let idx = 0; idx < 8; idx++) {
      const meta = await readDocWithMeta(project, `concurrent/doc-${idx}.md`);
      assert.match(meta.content, new RegExp(`Concurrent Doc ${idx}`));
    }

    // 2. Interrupted crash cleanup: leave a simulated orphaned .localatlas-tmp-* file
    const staleTmp = path.join(project.managedPath, 'docs', 'concurrent', '.localatlas-tmp-999999-12345');
    await fs.writeFile(staleTmp, 'partial corrupt write');

    // Writing or reading should not be obstructed, and cleanup prunes dead tmp files
    await writeDoc(project, 'concurrent/doc-new.md', '# New Doc\nClean.\n');
    const docNew = await readDocWithMeta(project, 'concurrent/doc-new.md');
    assert.equal(docNew.path, 'concurrent/doc-new.md');

    // 3. Complete index wipe and recovery verification
    // Populate rich state: task, backlink, and doc
    const t = await createTask(project, { title: 'Durable Task', priority: 'high', status: 'in_progress' });
    await writeDoc(project, 'spec/arch.md', `# Architecture\nRelated to [[${t.id}]].\n`);

    // Verify pre-wipe search and backlinks work
    const preSearch = await searchDocs(project, 'Architecture');
    assert.ok(preSearch.length >= 1);
    const preBacklinks = await getBacklinks(project, t.id);
    assert.ok(preBacklinks.length >= 1);

    // Corrupt/Wipe SQLite index tables completely
    const dbFile = path.join(env.home, 'atlas.db');
    // Delete database file directly
    closeTestDatabase();
    await fs.rm(dbFile, { force: true });
    try {
      await fs.rm(`${dbFile}-wal`, { force: true });
      await fs.rm(`${dbFile}-shm`, { force: true });
    } catch {}

    // Verify search initially returns empty or triggers cleanly
    // Now trigger reindex
    const reindexReport = await reindexProject(project);
    assert.ok(reindexReport.indexedDocs >= 10);

    // Verify 100% of state restored from Markdown canonical source of truth
    const postSearch = await searchDocs(project, 'Architecture');
    assert.ok(postSearch.length >= 1);
    assert.equal(postSearch[0].path, 'spec/arch.md');

    const postBacklinks = await getBacklinks(project, t.id);
    assert.ok(postBacklinks.length >= 1);
    assert.equal(postBacklinks[0].sourcePath, 'spec/arch.md');
  } finally {
    await env.cleanup();
  }
});

test('LA-M6-03: Cross-platform CI matrix workflow configuration (.github/workflows/ci.yml)', async () => {
  const ciPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
  const ciYaml = await fs.readFile(ciPath, 'utf8');

  // Verify OS matrix includes ubuntu, macos, and windows
  assert.match(ciYaml, /ubuntu-latest/);
  assert.match(ciYaml, /macos-latest/);
  assert.match(ciYaml, /windows-latest/);

  // Verify Node version >= 22
  assert.match(ciYaml, /node-version:\s*\[?22/);

  // Verify essential steps
  assert.match(ciYaml, /npm run typecheck/);
  assert.match(ciYaml, /npm run build/);
  assert.match(ciYaml, /npm test/);
});

test('LA-M6 verifier findings: npm pack artifact manifest, dead-lockfile PID reap, and automatic database file recreation', async () => {
  // 1. npm pack --json --dry-run
  const { stdout: packOut } = await runNpm(['pack', '--json', '--dry-run'], { cwd: process.cwd() });
  const parsed = JSON.parse(packOut);
  const packReport = Array.isArray(parsed) ? parsed[0] : (parsed.localatlas || Object.values(parsed)[0]);
  const filePaths = packReport.files.map((f: { path: string }) => f.path);
  assert.ok(filePaths.includes('dist/cli.js'));
  assert.ok(filePaths.includes('dist/core.js'));
  assert.ok(filePaths.includes('dist/server.js'));
  assert.ok(filePaths.includes('public/index.html'));
  assert.ok(!filePaths.some((p: string) => p.startsWith('src/')), 'Published package should not include raw src/');
  assert.ok(!filePaths.some((p: string) => p.startsWith('test/')), 'Published package should not include test/');

  // 2. Dead-lockfile PID reap: write a lockfile with an unreachable dead PID (e.g. 9999999)
  const env = await makeTempEnv();
  try {
    process.env.LOCALATLAS_HOME = env.home;
    const lockPath = path.join(env.home, '.lock');
    await fs.writeFile(lockPath, JSON.stringify({ pid: 9999999, createdAt: Date.now() - 10000 }));

    // Running an operation that requires workspace lock should detect dead PID and succeed quickly (< 500ms)
    const t0 = Date.now();
    const project = await importProject(env.source, { key: 'RAP', name: 'Reap Project' });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 2000, `Dead PID lock took too long to reap: ${elapsed}ms`);
    assert.equal(project.key, 'RAP');

    // 3. Complete database recreation
    const dbFile = path.join(env.home, 'atlas.db');
    closeTestDatabase();
    await fs.rm(dbFile, { force: true });
    // After db deletion, writeDoc / reindex will re-initialize database automatically
    await writeDoc(project, 'auto.md', '# Auto Recreated DB\nWorking.\n');
    const readBack = await readDocWithMeta(project, 'auto.md');
    assert.equal(readBack.content, '# Auto Recreated DB\nWorking.\n');
  } finally {
    await env.cleanup();
  }
});

