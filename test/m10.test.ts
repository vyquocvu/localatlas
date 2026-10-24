import { cleanupTestDirectory } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  importProject,
  writeDoc,
  createTask,
  updateTask,
  updateProjectProfile,
  recordProjectDecision,
  createTaskChangeProposal,
  createAgentSession,
  generateTaskAgentContext,
  getPortfolioSummary,
  listDocTemplates,
  createDocFromTemplate,
  getProjectTaskTraceability,
  analyzeProjectHealth,
} from '../src/core.js';
import { app } from '../src/server.js';

const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string) {
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# Repo\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: dir });
}

test('M10 portfolio summary aggregates multi-project health, pending proposals, active sessions, and Git state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-m10-portfolio-home-'));
  const repoA = await mkdtemp(join(tmpdir(), 'atlas-m10-repo-a-'));
  const repoB = await mkdtemp(join(tmpdir(), 'atlas-m10-repo-b-'));
  const prevHome = process.env.LOCALATLAS_HOME;
  process.env.LOCALATLAS_HOME = home;

  try {
    await initGitRepo(repoA);
    await initGitRepo(repoB);
    // Make repoB dirty
    await writeFile(join(repoB, 'README.md'), '# Repo B modified\n', 'utf8');

    const projA = await importProject(repoA, { key: 'PA', name: 'Project Alpha' });
    const projB = await importProject(repoB, { key: 'PB', name: 'Project Beta' });

    await writeDoc(projA, 'Spec.md', '# Spec\n');
    await updateProjectProfile(projA, {
      status: 'active',
      goals: 'Deliver Alpha MVP',
      keyDocs: ['Spec.md'],
    });
    await recordProjectDecision(projA, {
      summary: 'Keep storage in Markdown',
      rationale: 'Transparency',
    });

    const t1 = await createTask(projA, { title: 'Critical Auth', priority: 'critical', status: 'blocked' });
    await createTaskChangeProposal(projA, t1.id, { priority: 'high' });
    await createAgentSession(projA, {
      taskId: t1.id,
      resumeNote: 'Investigating auth blocker',
      nextAction: 'Unblock token flow',
    });

    await createTask(projB, { title: 'Setup CI', priority: 'medium', status: 'done' });

    const summary = await getPortfolioSummary({ concurrency: 2 });
    assert.equal(summary.totals.projectsCount, 2);
    assert.equal(summary.totals.totalTasks, 2);
    assert.equal(summary.totals.blockedTasks, 1);
    assert.equal(summary.totals.criticalOpenTasks, 1);
    assert.equal(summary.totals.pendingProposals, 1);
    assert.equal(summary.totals.activeSessions, 1);
    assert.equal(summary.totals.dirtyRepos, 1);
    assert.equal(summary.metrics.projectsProcessed, 2);
    assert.equal(summary.metrics.maxConcurrentProjects, 2);
    assert.equal(summary.metrics.documentListings, 2);
    assert.equal(summary.metrics.indexReconciliations, 2);
    assert.equal(summary.metrics.gitCommands, 8);

    const alphaSummary = summary.projects.find(item => item.project.key === 'PA');
    assert.ok(alphaSummary);
    assert.equal(alphaSummary.profile.goals, 'Deliver Alpha MVP');
    assert.equal(alphaSummary.profile.decisionsCount, 1);
    assert.equal(alphaSummary.pendingProposalsCount, 1);
    assert.equal(alphaSummary.activeSessionsCount, 1);

    // Verify HTTP route
    const res = await app.request('http://127.0.0.1:3456/api/portfolio/summary', {
      headers: { host: '127.0.0.1:3456' },
    });
    assert.equal(res.status, 200);
    const httpBody = (await res.json()) as any;
    assert.equal(httpBody.totals.projectsCount, 2);
  } finally {
    if (prevHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = prevHome;
    await cleanupTestDirectory(home);
    await cleanupTestDirectory(repoA);
    await cleanupTestDirectory(repoB);
  }
});

test('M10 portfolio isolates project document failures and marks the affected summary stale', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-m10-partial-home-'));
  const repoA = await mkdtemp(join(tmpdir(), 'atlas-m10-partial-repo-a-'));
  const repoB = await mkdtemp(join(tmpdir(), 'atlas-m10-partial-repo-b-'));
  const prevHome = process.env.LOCALATLAS_HOME;
  process.env.LOCALATLAS_HOME = home;

  try {
    await initGitRepo(repoA);
    await initGitRepo(repoB);
    const healthy = await importProject(repoA, { key: 'HA', name: 'Healthy project' });
    const unavailable = await importProject(repoB, { key: 'UB', name: 'Unavailable docs project' });
    await createTask(healthy, { title: 'Visible task' });
    await rm(join(home, 'projects', unavailable.id, 'docs'), { recursive: true, force: true });
    await writeFile(join(home, 'projects', unavailable.id, 'docs'), 'not a directory', 'utf8');

    const summary = await getPortfolioSummary({ concurrency: 2 });
    assert.equal(summary.totals.projectsCount, 2);
    assert.equal(summary.totals.totalTasks, 1);
    assert.equal(summary.metrics.projectsFailed, 1);
    assert.equal(summary.metrics.indexReconciliations, 1);
    assert.equal(summary.projects.find(item => item.project.id === healthy.id)?.freshness, 'fresh');
    const stale = summary.projects.find(item => item.project.id === unavailable.id);
    assert.equal(stale?.freshness, 'stale');
    assert.ok(stale?.errors.some(error => error.source === 'documents'));
  } finally {
    if (prevHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = prevHome;
    await cleanupTestDirectory(home);
    await cleanupTestDirectory(repoA);
    await cleanupTestDirectory(repoB);
  }
});

test('M10 role-based document templates, Git-to-task traceability, and enhanced task context with decisions', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-m10-trace-home-'));
  const repo = await mkdtemp(join(tmpdir(), 'atlas-m10-trace-repo-'));
  const prevHome = process.env.LOCALATLAS_HOME;
  process.env.LOCALATLAS_HOME = home;

  try {
    await initGitRepo(repo);
    const proj = await importProject(repo, { key: 'TR', name: 'Trace Project' });

    const templates = listDocTemplates();
    assert.ok(templates.some(t => t.id === 'prd'));
    assert.ok(templates.some(t => t.id === 'adr'));
    assert.ok(templates.some(t => t.id === 'bug_report'));
    assert.ok(templates.some(t => t.id === 'release_checklist'));

    const createdPrd = await createDocFromTemplate(proj, {
      templateId: 'prd',
      path: 'specs/Auth-PRD.md',
      title: 'Authentication PRD',
      docId: 'TR-PRD-01',
    });
    assert.equal(createdPrd.path, 'specs/Auth-PRD.md');
    assert.match(createdPrd.content, /# Authentication PRD/);
    assert.match(createdPrd.content, /id: TR-PRD-01/);

    await updateProjectProfile(proj, {
      status: 'active',
      goals: 'Ship zero-trust local auth',
      keyDocs: ['specs/Auth-PRD.md'],
    });
    await recordProjectDecision(proj, {
      summary: 'Enforce loopback Host and Origin checks',
      rationale: 'Prevent DNS rebinding and CSRF',
    });

    const task = await createTask(proj, {
      title: 'Implement loopback guard',
      priority: 'critical',
      body: '# Implement loopback guard\n\nSee [[TR-PRD-01]].\n\n- [x] Add Host check\n- [ ] Add Origin check\n',
    });

    // Make a Git commit referencing the task ID
    await writeFile(join(repo, 'auth.txt'), 'guard\n', 'utf8');
    await execFileAsync('git', ['add', 'auth.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', `feat(${task.id}): add loopback host guard`], { cwd: repo });

    await createAgentSession(proj, {
      taskId: task.id,
      resumeNote: 'Host guard committed',
      nextAction: 'Complete Origin check',
    });

    const traceability = await getProjectTaskTraceability(proj);
    const taskTrace = traceability[task.id];
    assert.ok(taskTrace);
    assert.equal(taskTrace.matchedCommits.length, 1);
    assert.match(taskTrace.matchedCommits[0].subject, new RegExp(task.id));
    assert.equal(taskTrace.activeSessions.length, 1);
    assert.equal(taskTrace.incompleteChecklistCount, 1);

    // Verify enhanced task context includes project goals and approved decisions
    const ctx = await generateTaskAgentContext(proj, task.id);
    assert.equal(ctx.profile.goals, 'Ship zero-trust local auth');
    assert.equal(ctx.profile.decisions.length, 1);
    assert.match(ctx.text, /## Project goals & approved decisions/);
    assert.match(ctx.text, /Enforce loopback Host and Origin checks/);

    // Verify HTTP template and traceability routes
    const tplRes = await app.request(
      `http://127.0.0.1:3456/api/projects/${encodeURIComponent(proj.id)}/templates/apply`,
      {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3456',
          origin: 'http://127.0.0.1:3456',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          templateId: 'adr',
          path: 'architecture/ADR-001.md',
          title: 'Storage Engine ADR',
        }),
      }
    );
    assert.equal(tplRes.status, 201);

    const traceRes = await app.request(
      `http://127.0.0.1:3456/api/projects/${encodeURIComponent(proj.id)}/traceability`,
      { headers: { host: '127.0.0.1:3456' } }
    );
    assert.equal(traceRes.status, 200);
    const traceJson = (await traceRes.json()) as any;
    assert.equal(traceJson[task.id].matchedCommits.length, 1);
  } finally {
    if (prevHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = prevHome;
    await cleanupTestDirectory(home);
    await cleanupTestDirectory(repo);
  }
});

test('M10 workspace and knowledge health check detects broken links, orphan docs, bottlenecks, and DoD issues', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-m10-health-home-'));
  const repo = await mkdtemp(join(tmpdir(), 'atlas-m10-health-repo-'));
  const prevHome = process.env.LOCALATLAS_HOME;
  process.env.LOCALATLAS_HOME = home;

  try {
    await initGitRepo(repo);
    const proj = await importProject(repo, { key: 'HL', name: 'Health Project' });

    // Create a keyDoc that has a broken wiki-link
    await writeDoc(proj, 'Architecture.md', '# Architecture\n\nReferences missing [[HL-999]].\n');
    await updateProjectProfile(proj, {
      keyDocs: ['Architecture.md'],
    });

    // Create an unlinked orphan note
    await writeDoc(proj, 'notes/Random-Scratch.md', '# Random Scratch\n\nNo incoming links.\n');

    // Create a bottleneck task and a dependent task
    const blockerTask = await createTask(proj, {
      title: 'Core schema migration',
      status: 'blocked',
      priority: 'critical',
    });
    await createTask(proj, {
      title: 'UI dashboard',
      status: 'todo',
      priority: 'high',
    });
    await writeDoc(
      proj,
      'tasks/HL-002.md',
      `---\nid: HL-002\ntype: task\nstatus: todo\npriority: high\ndependsOn:\n  - ${blockerTask.id}\n---\n# UI dashboard\n`
    );

    // Create a task marked done with unchecked checklist items (DoD violation)
    const dodTask = await createTask(proj, {
      title: 'Release verification',
      status: 'in_progress',
      body: '# Release verification\n\n- [x] Build passes\n- [ ] E2E suite passes\n',
    });
    await updateTask(proj, dodTask.id, { status: 'done' });

    const health = await analyzeProjectHealth(proj);
    assert.equal(health.brokenLinks.length, 1);
    assert.equal(health.brokenLinks[0].sourcePath, 'Architecture.md');
    assert.equal(health.brokenLinks[0].targetRef, 'HL-999');

    assert.equal(health.orphanDocs.length, 1);
    assert.equal(health.orphanDocs[0].path, 'notes/Random-Scratch.md');

    assert.equal(health.dodIssues.length, 1);
    assert.equal(health.dodIssues[0].taskId, dodTask.id);
    assert.equal(health.dodIssues[0].uncheckedCount, 1);

    assert.equal(health.bottleneckTasks.length, 1);
    assert.equal(health.bottleneckTasks[0].taskId, blockerTask.id);
    assert.deepEqual(health.bottleneckTasks[0].blockingTaskIds, ['HL-002']);

    // Verify HTTP endpoint
    const res = await app.request(
      `http://127.0.0.1:3456/api/projects/${encodeURIComponent(proj.id)}/health`,
      { headers: { host: '127.0.0.1:3456' } }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.brokenLinks.length, 1);
    assert.equal(body.dodIssues.length, 1);
  } finally {
    if (prevHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = prevHome;
    await cleanupTestDirectory(home);
    await cleanupTestDirectory(repo);
  }
});
