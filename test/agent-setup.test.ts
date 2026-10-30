import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from '../src/core/markdown.js';

const root = new URL('../', import.meta.url);
const skills = ['verify-localatlas-changes', 'manage-localatlas-tasks'];

for (const name of skills) {
  test(`agent setup: ${name} is discoverable and valid`, async () => {
    const relativePath = `.qoder/skills/${name}/SKILL.md`;
    const file = new URL(relativePath, root);
    assert.ok(existsSync(file), `Missing project skill: ${relativePath}`);

    const content = await readFile(file, 'utf8');
    const parsed = parseDocument(content);
    assert.ok(parsed.hasFrontmatter, 'Skill needs YAML frontmatter');
    assert.equal(parsed.malformedFrontmatter, false);
    assert.equal(parsed.frontmatter.name, name);
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(typeof parsed.frontmatter.description, 'string');
    const description = parsed.frontmatter.description as string;
    assert.match(description, /^Use when /);
    assert.ok(description.length <= 1024);
    assert.doesNotMatch(description, /[\r\n]/);
    assert.ok(parsed.body.trim().length > 0);
    assert.ok(parsed.body.split('\n').length < 500);
    assert.doesNotMatch(content, /\b(?:TODO|TBD)\b/);

    for (const entry of ['AGENTS.md', 'README.md']) {
      const instructions = await readFile(new URL(entry, root), 'utf8');
      assert.ok(instructions.includes(`](${relativePath})`), `${entry} must link ${name}`);
    }
  });
}

test('agent setup: pstack has one shared entry point for Qoder', async () => {
  const canonical = new URL('skills/pstack/SKILL.md', root);
  const discovery = new URL('.qoder/skills/pstack/SKILL.md', root);
  assert.ok(existsSync(canonical), 'Missing shared pstack skill');
  assert.ok(existsSync(discovery), 'Missing Qoder pstack discovery entry');
  assert.equal(await realpath(discovery), await realpath(canonical));

  const content = await readFile(canonical, 'utf8');
  const parsed = parseDocument(content);
  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(parsed.malformedFrontmatter, false);
  assert.equal(parsed.frontmatter.name, 'pstack');
  assert.match(String(parsed.frontmatter.description), /^Use when /);
  assert.ok(String(parsed.frontmatter.description).length <= 1024);
  assert.ok(parsed.body.trim().length > 0);
  assert.ok(parsed.body.split('\n').length < 500);
  assert.doesNotMatch(content, /\b(?:TODO|TBD)\b/);

  for (const entry of ['AGENTS.md', 'README.md']) {
    const instructions = await readFile(new URL(entry, root), 'utf8');
    assert.ok(instructions.includes('](skills/pstack/SKILL.md)'), `${entry} must link the shared pstack skill`);
  }
});

test('agent setup: pstack upstream is pinned and unmodified', async () => {
  const lockFile = new URL('skills/pstack/upstream.json', root);
  assert.ok(existsSync(lockFile), 'Missing pstack provenance');
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  assert.equal(lock.repository, 'https://github.com/cursor/plugins');
  assert.equal(lock.commit, '1ba91fc25c0977741dd0e267849e6234b037ed0a');
  assert.equal(lock.version, '0.15.36');
  assert.ok(Object.keys(lock.files).length > 0);

  const upstream = fileURLToPath(new URL('.pstack/upstream/', root));
  const entries = await readdir(upstream, { recursive: true, withFileTypes: true });
  assert.ok(entries.every(entry => !entry.isSymbolicLink()), 'Unexpected upstream symlink');
  const paths = entries.filter(entry => entry.isFile())
    .map(entry => relative(upstream, join(entry.parentPath, entry.name)).split(sep).join('/')).sort();
  assert.deepEqual(paths, Object.keys(lock.files).sort(), 'Upstream files differ from the pinned inventory');

  for (const [path, sha256] of Object.entries(lock.files)) {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'), `Invalid upstream path: ${path}`);
    const content = await readFile(new URL(`.pstack/upstream/${path}`, root));
    assert.equal(createHash('sha256').update(content).digest('hex'), sha256, `Modified upstream file: ${path}`);
  }
  const manifest = JSON.parse(await readFile(new URL('.pstack/upstream/plugin.json', root), 'utf8'));
  assert.equal(manifest.version, lock.version);
  assert.ok(lock.files.LICENSE, 'The upstream license must be retained');
  assert.ok(lock.files['skills/why/SKILL.md']);
  assert.ok(lock.files['skills/poteto-help/SKILL.md']);
});

test('agent setup: local documentation links and npm scripts resolve', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const files = ['AGENTS.md', 'README.md', 'docs/CLI.md', 'skills/pstack/SKILL.md', '.qoder/skills/pstack/SKILL.md', ...skills.map(name => `.qoder/skills/${name}/SKILL.md`)];

  for (const relativePath of files) {
    const file = new URL(relativePath, root);
    assert.ok(existsSync(file), `Missing guide: ${relativePath}`);
    const content = await readFile(file, 'utf8');
    const canonicalFile = pathToFileURL(await realpath(file));
    const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
    assert.ok(links.length > 0, `${relativePath} must link its reference material`);
    for (const [, target] of links) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const linkedFile = new URL(target.split('#')[0], canonicalFile);
      assert.ok(existsSync(linkedFile), `${relativePath}: missing ${fileURLToPath(linkedFile)}`);
    }
    for (const [, script] of content.matchAll(/\bnpm (?:--silent )?run ([\w:-]+)/g)) {
      assert.ok(Object.hasOwn(pkg.scripts, script), `${relativePath}: unknown npm script ${script}`);
    }
  }
});
