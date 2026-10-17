import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function findFreePort() {
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

const testRoot = mkdtempSync(path.join(tmpdir(), 'localatlas-playwright-'));
const fixtureRepo = path.join(testRoot, 'fixture-repo');
mkdirSync(fixtureRepo, { recursive: true });
writeFileSync(path.join(fixtureRepo, 'README.md'), '# Playwright fixture\n\nA temporary imported project.\n');
spawnSync('git', ['init', '-b', 'main'], { cwd: fixtureRepo, stdio: 'ignore' });
spawnSync('git', ['config', 'user.name', 'Playwright User'], { cwd: fixtureRepo, stdio: 'ignore' });
spawnSync('git', ['config', 'user.email', 'playwright@example.test'], { cwd: fixtureRepo, stdio: 'ignore' });
spawnSync('git', ['add', 'README.md'], { cwd: fixtureRepo, stdio: 'ignore' });
spawnSync('git', ['commit', '-m', 'Add demo project overview'], { cwd: fixtureRepo, stdio: 'ignore' });

const relinkRepo = path.join(testRoot, 'relinked-repo');
mkdirSync(relinkRepo, { recursive: true });
writeFileSync(path.join(relinkRepo, 'README.md'), '# Relink target\n');

const port = await findFreePort();
const env = {
  ...process.env,
  LOCALATLAS_E2E_PORT: String(port),
  LOCALATLAS_E2E_REPO: process.env.LOCALATLAS_E2E_REPO || fixtureRepo,
  LOCALATLAS_E2E_RELINK_REPO: relinkRepo,
  LOCALATLAS_HOME: path.join(testRoot, 'localatlas-home'),
  PORT: String(port),
};

let status = 1;
try {
  const cli = path.resolve('node_modules/playwright/cli.js');
  const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

process.exitCode = status;
