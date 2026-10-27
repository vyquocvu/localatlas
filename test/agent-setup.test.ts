import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

test('agent setup: local documentation links and npm scripts resolve', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const files = ['AGENTS.md', 'README.md', 'docs/CLI.md', ...skills.map(name => `.qoder/skills/${name}/SKILL.md`)];

  for (const relativePath of files) {
    const file = new URL(relativePath, root);
    assert.ok(existsSync(file), `Missing guide: ${relativePath}`);
    const content = await readFile(file, 'utf8');
    const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
    assert.ok(links.length > 0, `${relativePath} must link its reference material`);
    for (const [, target] of links) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const linkedFile = new URL(target.split('#')[0], file);
      assert.ok(existsSync(linkedFile), `${relativePath}: missing ${fileURLToPath(linkedFile)}`);
    }
    for (const [, script] of content.matchAll(/\bnpm (?:--silent )?run ([\w:-]+)/g)) {
      assert.ok(Object.hasOwn(pkg.scripts, script), `${relativePath}: unknown npm script ${script}`);
    }
  }
});
