import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTestDirectory } from './helpers.js';
import { ensureProjectPstack, importProject, resolvePstackBundleDir } from '../src/core.js';

const DISCOVERY_DIRS = ['.qoder', '.agents', '.claude'];

async function makeFakeBundle(root: string, version: string): Promise<string> {
  const bundle = join(root, 'bundle');
  await mkdir(join(bundle, 'skills', 'why'), { recursive: true });
  await mkdir(join(bundle, 'agents'), { recursive: true });
  await writeFile(join(bundle, 'plugin.json'), JSON.stringify({ name: 'pstack', version }));
  await writeFile(join(bundle, 'LICENSE'), 'MIT License\n');
  await writeFile(join(bundle, 'skills', 'why', 'SKILL.md'), '---\nname: why\n---\n# why\n');
  await writeFile(join(bundle, 'agents', 'poteto-agent.md'), '# poteto-agent\n');
  return bundle;
}

test('importing a project links pstack into the managed workspace without touching the source repo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-psk-'));
  const repo = join(root, 'source repo');
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'README.md'), '# Imported guide\n');
  const bundle = await makeFakeBundle(root, '9.9.9');
  const previousHome = process.env.LOCALATLAS_HOME;
  const previousBundle = process.env.LOCALATLAS_PSTACK_BUNDLE;
  process.env.LOCALATLAS_HOME = join(root, 'home');
  process.env.LOCALATLAS_PSTACK_BUNDLE = bundle;
  try {
    const project = await importProject(repo, { key: 'PSK', name: 'Pstack Project' });
    const managed = await realpath(project.managedPath);

    assert.equal(
      await readFile(join(managed, '.pstack', 'upstream', 'plugin.json'), 'utf8'),
      JSON.stringify({ name: 'pstack', version: '9.9.9' }),
    );
    assert.ok(existsSync(join(managed, '.pstack', 'upstream', 'skills', 'why', 'SKILL.md')));
    assert.ok(existsSync(join(managed, '.pstack', 'upstream', 'LICENSE')));

    const adapter = await readFile(join(managed, '.pstack', 'skill', 'SKILL.md'), 'utf8');
    assert.match(adapter, /^---\nname: pstack\n/);
    assert.match(adapter, /description: Use when /);
    assert.match(adapter, /source repository is read-only/);
    assert.match(adapter, /\.\.\/upstream\/skills\/poteto-mode\/SKILL\.md/);

    const canonicalAdapter = await realpath(join(managed, '.pstack', 'skill', 'SKILL.md'));
    for (const dir of DISCOVERY_DIRS) {
      const skillMd = join(managed, dir, 'skills', 'pstack', 'SKILL.md');
      assert.ok(existsSync(skillMd), `${dir} discovery SKILL.md should resolve through the link`);
      assert.equal(await realpath(skillMd), canonicalAdapter, `${dir} discovery must point at the shared adapter`);
    }

    for (const dir of [...DISCOVERY_DIRS, '.pstack', 'skills']) {
      assert.ok(!existsSync(join(repo, dir)), `source repository must not receive ${dir}`);
    }

    await ensureProjectPstack(project);
    assert.ok(existsSync(join(managed, '.pstack', 'upstream', 'plugin.json')), 're-running stays idempotent');
    for (const dir of DISCOVERY_DIRS) {
      assert.equal(await realpath(join(managed, dir, 'skills', 'pstack', 'SKILL.md')), canonicalAdapter);
    }
  } finally {
    if (previousHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = previousHome;
    if (previousBundle === undefined) delete process.env.LOCALATLAS_PSTACK_BUNDLE;
    else process.env.LOCALATLAS_PSTACK_BUNDLE = previousBundle;
    await cleanupTestDirectory(root);
  }
});

test('pstack linking is skipped gracefully when no bundle is available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localatlas-psk-nobundle-'));
  const repo = join(root, 'repo');
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'README.md'), '# guide\n');
  const previousHome = process.env.LOCALATLAS_HOME;
  const previousBundle = process.env.LOCALATLAS_PSTACK_BUNDLE;
  process.env.LOCALATLAS_HOME = join(root, 'home');
  process.env.LOCALATLAS_PSTACK_BUNDLE = join(root, 'missing-bundle');
  try {
    const project = await importProject(repo, { key: 'NB', name: 'No Bundle' });
    const managed = await realpath(project.managedPath);
    assert.ok(!existsSync(join(managed, '.pstack')), 'no bundle means no pstack copy');
    for (const dir of DISCOVERY_DIRS) {
      assert.ok(!existsSync(join(managed, dir, 'skills', 'pstack')), `no ${dir} pstack link without a bundle`);
    }
    assert.ok(existsSync(join(managed, 'AGENTS.md')), 'normal workspace scaffolding still runs');
  } finally {
    if (previousHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = previousHome;
    if (previousBundle === undefined) delete process.env.LOCALATLAS_PSTACK_BUNDLE;
    else process.env.LOCALATLAS_PSTACK_BUNDLE = previousBundle;
    await cleanupTestDirectory(root);
  }
});

test('resolvePstackBundleDir honors the override and defaults to the vendored bundle', () => {
  const previous = process.env.LOCALATLAS_PSTACK_BUNDLE;
  try {
    process.env.LOCALATLAS_PSTACK_BUNDLE = '/tmp/custom-pstack-bundle';
    assert.equal(resolvePstackBundleDir(), '/tmp/custom-pstack-bundle');
    delete process.env.LOCALATLAS_PSTACK_BUNDLE;
    const fallback = resolvePstackBundleDir();
    assert.ok(fallback, 'a default bundle path is always returned');
    assert.ok(fallback!.endsWith(join('.pstack', 'upstream')), `unexpected default bundle path: ${fallback}`);
  } finally {
    if (previous === undefined) delete process.env.LOCALATLAS_PSTACK_BUNDLE;
    else process.env.LOCALATLAS_PSTACK_BUNDLE = previous;
  }
});
