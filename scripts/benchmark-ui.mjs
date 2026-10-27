import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_COUNT = 3;

async function freePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

function cli(args, env) {
  return execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/projects`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the benchmark server');
}

async function timed(label, action) {
  const start = performance.now();
  await action();
  return { label, ms: Math.round((performance.now() - start) * 10) / 10 };
}

const root = await mkdtemp(path.join(tmpdir(), 'localatlas-ui-bench-'));
const source = path.join(root, 'source');
const home = path.join(root, 'home');
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const env = { ...process.env, LOCALATLAS_HOME: home, PORT: String(port) };
let server;

try {
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'README.md'), '# UI benchmark source\n');
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.name', 'UI Benchmark'],
    ['config', 'user.email', 'benchmark@example.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'Benchmark fixture'],
  ]) execFileSync('git', args, { cwd: source, stdio: 'ignore' });

  const project = JSON.parse(cli(['import', source, '--key', 'PERF', '--json'], env));
  cli(['task', 'create', 'Benchmark task', '--project', 'PERF', '--body', '# Benchmark task\n\nSee [[perf-spec.md]].\n', '--json'], env);

  server = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'serve'], {
    cwd: repoRoot,
    env,
    stdio: 'ignore',
  });
  await waitForServer(baseUrl, server);

  await fetch(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}/docs/perf-spec.md`, {
    method: 'PUT',
    headers: { 'content-type': 'text/markdown' },
    body: '# Benchmark spec\n\nLinked document for UI timing.\n',
  });

  const browser = await chromium.launch();
  const samples = [];
  try {
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const timings = [];
      timings.push(await timed('portfolio-ready', async () => {
        await page.goto(baseUrl);
        await page.locator('.portfolio-project-card').first().waitFor();
      }));
      timings.push(await timed('project-overview', async () => {
        await page.locator('.portfolio-project-card').first().getByRole('button').first().click();
        await page.locator('.project-overview-title h1').waitFor();
      }));
      timings.push(await timed('tasks-board', async () => {
        await page.getByRole('button', { name: 'Tasks', exact: true }).click();
        await page.locator('.kanban-card').first().waitFor();
      }));
      timings.push(await timed('task-details-linked-docs', async () => {
        await page.locator('.kanban-card').filter({ hasText: 'Benchmark task' }).getByRole('button', { name: 'Propose change' }).click();
        await page.locator('.linked-documents button').first().waitFor();
      }));
      const navigation = await page.evaluate(() => {
        const entry = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource')
          .filter(item => /app\.(js|css)$|react-vendor\.js$/.test(item.name))
          .map(item => ({ name: item.name.split('/').pop(), decodedBodySize: item.decodedBodySize }));
        return {
          domContentLoadedMs: entry ? Math.round(entry.domContentLoadedEventEnd * 10) / 10 : null,
          loadMs: entry ? Math.round(entry.loadEventEnd * 10) / 10 : null,
          resources,
        };
      });
      samples.push({ timings, navigation });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    samples,
    decision: 'Keep terminal and panels eager until a user-visible bottleneck is measured; no code-splitting in this cycle.',
  }, null, 2));
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(root, { recursive: true, force: true });
}
