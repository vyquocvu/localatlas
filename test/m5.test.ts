import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  importProject,
  createTask,
  createEpic,
  createMilestone,
  writeDoc,
  getProjectGitStatus,
  getProjectStatusWithGit,
  generateAgentContext,
  getAgentsMdSnippet,
} from '../src/core.js';
import { app } from '../src/server.js';

const execFileAsync = promisify(execFile);

async function makeTempEnv() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m5-'));
  const home = path.join(base, 'home');
  const gitRepo = path.join(base, 'git-repo');
  const nonGitRepo = path.join(base, 'non-git-repo');
  const emptyGitRepo = path.join(base, 'empty-git-repo');

  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(gitRepo, { recursive: true });
  await fs.mkdir(nonGitRepo, { recursive: true });
  await fs.mkdir(emptyGitRepo, { recursive: true });

  process.env.LOCALATLAS_HOME = home;

  // Initialize git repo with 1 commit and 1 dirty file
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: gitRepo });
  await execFileAsync('git', ['config', 'user.name', 'Atlas Agent'], { cwd: gitRepo });
  await execFileAsync('git', ['config', 'user.email', 'agent@localatlas.dev'], { cwd: gitRepo });
  await fs.writeFile(path.join(gitRepo, 'README.md'), '# Initial Repo\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: gitRepo });
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: gitRepo });
  // Add an uncommitted dirty file
  await fs.writeFile(path.join(gitRepo, 'uncommitted.txt'), 'dirty work\n');

  // Initialize empty git repo with 0 commits
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: emptyGitRepo });

  return {
    base,
    home,
    gitRepo,
    nonGitRepo,
    emptyGitRepo,
    cleanup: async () => {
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}

test('LA-M5-01: Strictly side-effect-free Git adapter surfaces branch, HEAD, dirtyCount, and commits', async () => {
  const env = await makeTempEnv();
  try {
    const gitProject = await importProject(env.gitRepo, { key: 'GIT' });
    const nonGitProject = await importProject(env.nonGitRepo, { key: 'NOGIT' });
    const emptyGitProject = await importProject(env.emptyGitRepo, { key: 'EMPTY' });

    // 1. Valid Git repository status
    const gitStatus = await getProjectGitStatus(gitProject);
    assert.ok(gitStatus);
    assert.equal(gitStatus.branch, 'main');
    assert.ok(gitStatus.head);
    assert.match(gitStatus.head.sha, /^[0-9a-f]{7,40}$/);
    assert.equal(gitStatus.head.subject, 'Initial commit');
    assert.equal(gitStatus.dirtyCount, 1);
    assert.equal(gitStatus.recentCommits.length, 1);
    assert.equal(gitStatus.recentCommits[0].subject, 'Initial commit');

    // Decisive guarantee: Git status query must never leave lock files or mutate mtimes in repo
    const gitDir = path.join(env.gitRepo, '.git');
    const files = await fs.readdir(gitDir);
    assert.equal(files.includes('index.lock'), false);

    // 2. Non-git repository returns null gracefully
    const nonGitStatus = await getProjectGitStatus(nonGitProject);
    assert.equal(nonGitStatus, null);

    // 3. Empty Git repo with 0 commits returns head: null, recentCommits: []
    const emptyStatus = await getProjectGitStatus(emptyGitProject);
    assert.ok(emptyStatus);
    assert.equal(emptyStatus.head, null);
    assert.deepEqual(emptyStatus.recentCommits, []);

    // 4. Combined project status (API and core)
    const combined = await getProjectStatusWithGit(gitProject);
    assert.equal(combined.id, gitProject.id);
    assert.equal(combined.key, 'GIT');
    assert.ok(combined.git);
    assert.equal(combined.git.branch, 'main');

    // HTTP API GET /api/projects/:id/status
    const res = await app.request(`http://127.0.0.1:4310/api/projects/${gitProject.id}/status`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string; key: string; git: { branch: string } };
    assert.equal(body.key, 'GIT');
    assert.equal(body.git.branch, 'main');
  } finally {
    await env.cleanup();
  }
});

test('LA-M5-02: Bounded context command enforces budget and AGENTS.md snippet outputs instructions', async () => {
  const env = await makeTempEnv();
  try {
    const project = await importProject(env.gitRepo, { key: 'CTX' });
    const ms = await createMilestone(project, { title: 'Q4 Milestone' });
    const epic = await createEpic(project, { title: 'Security Hardening', milestone: ms.id });

    // Create a mix of in_progress, blocked, todo, and done tasks
    await createTask(project, { title: 'Audit Auth tokens', status: 'in_progress', priority: 'critical', epic: epic.id });
    await createTask(project, { title: 'Firewall rules', status: 'blocked', priority: 'high', epic: epic.id });
    await createTask(project, { title: 'Rate limiting', status: 'todo', priority: 'medium', epic: epic.id });
    await createTask(project, { title: 'Setup CI tests', status: 'done', priority: 'low', epic: epic.id });

    // Create several docs
    await writeDoc(project, 'spec/architecture.md', '# System Architecture\nCore design.\n');
    await writeDoc(project, 'spec/security.md', '# Security Threat Model\nStrict boundary.\n');

    // 1. generateAgentContext bounded output
    const ctx = await generateAgentContext(project, { maxBytes: 4096, maxLines: 80 });
    assert.ok(ctx.text.length <= 4096, 'Output exceeds byte limit');
    const lineCount = ctx.text.split('\n').length;
    assert.ok(lineCount <= 80, `Output line count ${lineCount} exceeds 80 lines`);

    assert.match(ctx.text, /Project:\s+CTX/i);
    assert.match(ctx.text, /Branch:\s+main/i);
    assert.match(ctx.text, /Audit Auth tokens/);
    assert.match(ctx.text, /Firewall rules/);

    // Context JSON representation
    assert.equal(ctx.json.project.key, 'CTX');
    assert.equal(ctx.json.git?.branch, 'main');
    assert.ok(ctx.json.tasks.inProgress.length >= 1);
    assert.ok(ctx.json.tasks.blocked.length >= 1);

    // 2. AGENTS.md snippet contains standard workflow guidelines
    const snippet = getAgentsMdSnippet();
    assert.match(snippet, /localatlas context/);
    assert.match(snippet, /localatlas read/);
    assert.match(snippet, /localatlas task update/);
    assert.match(snippet, /--if-match/);

    // 3. CLI execution for `context` and `agents-md`
    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const cliEnv = { ...process.env, LOCALATLAS_HOME: env.home };

    const { stdout: contextOut } = await execFileAsync(
      tsxBin,
      [cliPath, 'context', '--project', project.id, '--json'],
      { cwd: env.gitRepo, env: cliEnv }
    );
    const parsedContext = JSON.parse(contextOut);
    assert.equal(parsedContext.project.key, 'CTX');

    const { stdout: agentsMdOut } = await execFileAsync(
      tsxBin,
      [cliPath, 'agents-md'],
      { cwd: env.gitRepo, env: cliEnv }
    );
    assert.match(agentsMdOut, /localatlas context/);
  } finally {
    await env.cleanup();
  }
});

test('LA-M5 verifier findings: detached HEAD, budget overflow truncation footer, and HTTP context endpoints', async () => {
  const env = await makeTempEnv();
  try {
    const project = await importProject(env.gitRepo, { key: 'VRF', name: 'Verifier Repo' });

    // 1. Detached HEAD verification
    await execFileAsync('git', ['checkout', '--detach'], { cwd: env.gitRepo });
    const gitStatus = await getProjectGitStatus(project);
    assert.ok(gitStatus !== null);
    assert.ok(gitStatus.branch === 'HEAD' || gitStatus.branch.length > 0);
    assert.ok(gitStatus.head !== null);

    // 2. Budget overflow truncation
    for (let i = 1; i <= 20; i++) {
      await createTask(project, { title: `Verifier Task ${i}`, status: 'in_progress', priority: 'high' });
    }
    const truncatedCtx = await generateAgentContext(project, { maxBytes: 600, maxLines: 15 });
    assert.ok(truncatedCtx.text.length <= 600);
    assert.ok(truncatedCtx.text.split('\n').length <= 15);
    assert.ok(truncatedCtx.text.includes('... [truncated to fit agent context budget]'));

    // 3. HTTP status and context endpoints
    const statusRes = await app.request(`/api/projects/${project.id}/status`, {
      headers: { host: '127.0.0.1:3000' },
    });
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json() as any;
    assert.equal(statusBody.key, 'VRF');
    assert.ok(statusBody.git !== null);

    const contextRes = await app.request(`/api/projects/${project.id}/context?maxBytes=5000&maxLines=60`, {
      headers: { host: '127.0.0.1:3000' },
    });
    assert.equal(contextRes.status, 200);
    const contextBody = await contextRes.json() as any;
    assert.equal(contextBody.project.key, 'VRF');
    assert.ok(typeof contextBody.text === 'string');
    assert.ok(contextBody.text.includes('# LocalAtlas Project Context: [VRF]'));
  } finally {
    await env.cleanup();
  }
});

