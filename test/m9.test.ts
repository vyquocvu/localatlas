import { runTsx, cleanupTestDirectory } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  importProject,
  readDoc,
  writeDoc,
  createTask,
  createEpic,
  createMilestone,
  createAgentSession,
  readProjectProfile,
  updateProjectProfile,
  recordProjectDecision,
  previewTaskImpact,
  createTaskChangeProposal,
  listTaskChangeProposals,
  confirmTaskChangeProposal,
  rejectTaskChangeProposal,
  getProjectRollup,
  generateProjectRecapDraft,
  listProjectRecaps,
  readProjectRecap,
  ConflictError,
  ValidationError,
} from '../src/core.js';
import { app } from '../src/server.js';

const execFileAsync = promisify(execFile);

async function snapshotDirectory(root: string): Promise<string> {
  const items: string[] = [];
  async function visit(dir: string, rel = ''): Promise<void> {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      const st = await fs.lstat(full);
      if (entry.isDirectory()) {
        items.push(`d:${childRel}:${st.mode}`);
        await visit(full, childRel);
      } else {
        const content = await fs.readFile(full);
        items.push(`f:${childRel}:${st.mode}:${createHash('sha256').update(content).digest('hex')}`);
      }
    }
  }
  await visit(root);
  return items.join('\n');
}

test('M9 project profile stores goals, status, key-doc links, and append-only approved decisions in managed Markdown', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m9-profile-'));
  const home = path.join(root, 'home');
  process.env.LOCALATLAS_HOME = home;
  try {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo);
    await fs.writeFile(path.join(repo, 'README.md'), '# Repo readme\n');
    const beforeRepo = await snapshotDirectory(repo);

    const project = await importProject(repo, { key: 'PRF' });
    await writeDoc(project, 'spec/architecture.md', '# Architecture spec\n');
    await writeDoc(project, 'spec/roadmap.md', '# Roadmap spec\n');

    const initial = await readProjectProfile(project);
    assert.equal(initial.status, 'active');
    assert.equal(initial.goals, '');
    assert.equal(initial.etag, null);

    const updated = await updateProjectProfile(project, {
      status: 'on_track',
      goals: 'Deliver local-first project workspace without touching imported repos.',
      keyDocs: ['spec/architecture.md'],
    });
    assert.equal(updated.status, 'on_track');
    assert.deepEqual(updated.keyDocs, ['spec/architecture.md']);
    assert.equal(updated.history.length, 1);

    const dec1 = await recordProjectDecision(project, {
      summary: 'Store decisions in project/profile.md',
      rationale: 'Keeps canonical state in human-readable Markdown.',
      links: ['spec/architecture.md'],
      ifMatch: updated.etag!,
    });
    assert.equal(dec1.decision.id, 'DEC-001');
    assert.equal(dec1.profile.decisions.length, 1);

    // Subsequent profile update must keep approved decisions intact and append history
    const updated2 = await updateProjectProfile(project, {
      status: 'at_risk',
      goals: 'Updated goals while preserving approved decisions.',
      keyDocs: ['spec/architecture.md', 'spec/roadmap.md'],
      ifMatch: dec1.profile.etag!,
    });
    assert.equal(updated2.status, 'at_risk');
    assert.equal(updated2.decisions.length, 1);
    assert.equal(updated2.decisions[0].id, 'DEC-001');
    assert.equal(updated2.decisions[0].summary, 'Store decisions in project/profile.md');
    assert.equal(updated2.history.length, 3);

    // ETag conflict protection
    await assert.rejects(
      recordProjectDecision(project, {
        summary: 'Stale write',
        ifMatch: updated.etag!,
      }),
      (err: unknown) => err instanceof ConflictError
    );

    // HTTP & CLI parity
    const getRes = await app.request(`/api/projects/${project.id}/profile`);
    assert.equal(getRes.status, 200);
    const apiProfile = await getRes.json() as any;
    assert.equal(apiProfile.decisions.length, 1);

    const postDecRes = await app.request(`/api/projects/${project.id}/profile/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: 'Require human confirmation for scope changes',
        rationale: 'Prevents surprise mutations.',
      }),
    });
    assert.equal(postDecRes.status, 201);
    const postDecBody = await postDecRes.json() as any;
    assert.equal(postDecBody.profile.decisions.length, 2);

    const rawMarkdown = await readDoc(project, 'project/profile.md');
    assert.match(rawMarkdown, /DEC-001/);
    assert.match(rawMarkdown, /DEC-002/);
    assert.equal(await snapshotDirectory(repo), beforeRepo);
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('M9 impact summaries and human confirmation for proposed scope, priority, and dependency changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m9-impact-'));
  const home = path.join(root, 'home');
  process.env.LOCALATLAS_HOME = home;
  try {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo);
    const project = await importProject(repo, { key: 'IMP' });

    const ms = await createMilestone(project, { title: 'Release 1.0' });
    const epic = await createEpic(project, { title: 'Core Engine', milestone: ms.id });
    const task1 = await createTask(project, { title: 'Base storage', priority: 'medium', epic: epic.id, milestone: ms.id });
    const task2 = await createTask(project, { title: 'Search indexer', priority: 'medium', epic: epic.id, milestone: ms.id });
    const task3 = await createTask(project, { title: 'UI integration', priority: 'low' });
    const foreignRepo = path.join(root, 'foreign');
    await fs.mkdir(foreignRepo);
    const foreignProject = await importProject(foreignRepo, { key: 'OTH' });
    const foreignTask = await createTask(foreignProject, { title: 'Foreign project task' });

    // task3 depends on task2
    await writeDoc(
      project,
      task3.path,
      `---\nid: ${task3.id}\ntype: task\nstatus: todo\npriority: low\ndependsOn:\n  - ${task2.id}\n---\n# UI integration\n`
    );

    const impactPreview = await previewTaskImpact(project, task2.id, {
      priority: 'critical',
      dependsOn: [task1.id, 'IMP-999'],
    });
    assert.equal(impactPreview.impact.affectedDownstreamTasks.length, 1);
    assert.equal(impactPreview.impact.affectedDownstreamTasks[0].id, task3.id);
    assert.deepEqual(impactPreview.impact.addedDependencies, [task1.id, 'IMP-999']);
    assert.deepEqual(impactPreview.impact.unresolvedDependencies, ['IMP-999']);
    assert.equal(impactPreview.impact.warnings.length >= 2, true);

    await assert.rejects(createTask(project, { title: 'Invalid dependency', dependsOn: ['IMP-999'] }), (err: unknown) => err instanceof ValidationError);
    await assert.rejects(createTaskChangeProposal(project, task2.id, { dependsOn: ['IMP-999'] }), (err: unknown) => err instanceof ValidationError);
    await assert.rejects(createTaskChangeProposal(project, task2.id, { dependsOn: [foreignTask.id] }), (err: unknown) => err instanceof ValidationError);
    await assert.rejects(createTaskChangeProposal(project, task2.id, { dependsOn: [task2.id] }), (err: unknown) => err instanceof ValidationError);
    const apiCreated = await app.request(`/api/projects/${project.id}/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'API dependent task', dependsOn: [task1.id] }),
    });
    assert.equal(apiCreated.status, 201);
    assert.deepEqual((await apiCreated.json() as any).dependsOn, [task1.id]);
    const bypassAttempt = await app.request(`/api/projects/${project.id}/tasks/${task2.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependsOn: [task1.id] }),
    });
    assert.equal(bypassAttempt.status, 200);
    assert.deepEqual((await bypassAttempt.json() as any).dependsOn, []);

    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');
    const cliEnv = { ...process.env, LOCALATLAS_HOME: home };
    const { stdout: createdOut } = await runTsx([cliPath, 'task', 'create', 'CLI dependent task', '--project', 'IMP', '--depends-on', task1.id, '--json'], { cwd: repo, env: cliEnv });
    const cliCreated = JSON.parse(createdOut);
    assert.deepEqual(cliCreated.dependsOn, [task1.id]);
    const { stdout: clearOut } = await runTsx([cliPath, 'task', 'propose', cliCreated.id, '--project', 'IMP', '--clear-dependencies', '--json'], { cwd: repo, env: cliEnv });
    const clearCliProposal = JSON.parse(clearOut);
    assert.deepEqual(clearCliProposal.proposed.dependsOn, []);
    const { stdout: confirmClearOut } = await runTsx([cliPath, 'task', 'confirm', clearCliProposal.id, '--project', 'IMP', '--confirm', '--if-match', clearCliProposal.etag, '--json'], { cwd: repo, env: cliEnv });
    assert.deepEqual(JSON.parse(confirmClearOut).task.dependsOn, []);

    const proposal = await createTaskChangeProposal(project, task2.id, {
      title: 'Search indexer (expanded scope)',
      priority: 'critical',
      dependsOn: [task1.id],
    });
    assert.equal(proposal.status, 'pending');
    assert.equal((await listTaskChangeProposals(project, { status: 'pending' })).length, 1);

    // Cannot apply without explicit confirmed: true
    await assert.rejects(
      confirmTaskChangeProposal(project, proposal.id, { confirmed: false }),
      (err: unknown) => err instanceof ValidationError
    );

    // Confirm and apply via HTTP API
    const confirmRes = await app.request(`/api/projects/${project.id}/proposals/${proposal.id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, ifMatch: proposal.etag }),
    });
    assert.equal(confirmRes.status, 200);
    const confirmedData = await confirmRes.json() as any;
    assert.equal(confirmedData.proposal.status, 'confirmed');
    assert.equal(confirmedData.task.priority, 'critical');
    assert.equal(confirmedData.task.title, 'Search indexer (expanded scope)');
    assert.deepEqual(confirmedData.task.dependsOn, [task1.id]);

    const staleProposal = await createTaskChangeProposal(project, task1.id, { priority: 'high' });
    await writeDoc(project, task1.path, `${await readDoc(project, task1.path)}\nExternal edit after preview\n`);
    await assert.rejects(
      confirmTaskChangeProposal(project, staleProposal.id, { confirmed: true, ifMatch: staleProposal.etag }),
      (err: unknown) => err instanceof ConflictError
    );

    // A dependency cannot be changed into a cycle after its proposal was prepared.
    const cycleA = await createTask(project, { title: 'Cycle A' });
    const cycleB = await createTask(project, { title: 'Cycle B' });
    const cycleProposal = await createTaskChangeProposal(project, cycleA.id, { dependsOn: [cycleB.id] });
    const makeReverse = await createTaskChangeProposal(project, cycleB.id, { dependsOn: [cycleA.id] });
    await confirmTaskChangeProposal(project, makeReverse.id, { confirmed: true, ifMatch: makeReverse.etag });
    await assert.rejects(
      confirmTaskChangeProposal(project, cycleProposal.id, { confirmed: true, ifMatch: cycleProposal.etag }),
      (err: unknown) => err instanceof ValidationError && /cycle/i.test(err.message)
    );

    const clearProposal = await createTaskChangeProposal(project, task2.id, { dependsOn: [] });
    const cleared = await confirmTaskChangeProposal(project, clearProposal.id, { confirmed: true, ifMatch: clearProposal.etag });
    assert.deepEqual(cleared.task.dependsOn, []);
    assert.equal((await readDoc(project, task2.path)).includes('dependsOn:'), false);

    await writeDoc(project, cycleA.path, `---\nid: ${cycleA.id}\ntype: task\nstatus: todo\npriority: medium\ndependsOn:\n  - ${cycleB.id}\n---\n# Cycle A\n`);
    const cycleRollup = await getProjectRollup(project);
    assert.equal(cycleRollup.brokenReferences.find(ref => ref.taskId === cycleA.id)?.dependencyCycle, true);

    // Old malformed Markdown is diagnosed without rewriting its canonical source.
    await writeDoc(project, task3.path, `---\nid: ${task3.id}\ntype: task\nstatus: todo\npriority: low\ndependsOn:\n  - IMP-999\n---\n# UI integration\n`);
    const rollup = await getProjectRollup(project);
    assert.deepEqual(rollup.brokenReferences.find(ref => ref.taskId === task3.id)?.missingDependencies, ['IMP-999']);

    // Reject flow via CLI
    const { stdout: propOut } = await runTsx([cliPath, 'task', 'propose', task1.id, '--project', 'IMP', '--priority', 'high', '--json'],
      { cwd: repo, env: cliEnv }
    );
    const cliProp = JSON.parse(propOut);
    const { stdout: rejOut } = await runTsx([cliPath, 'task', 'reject', cliProp.id, '--project', 'IMP', '--reason', 'Defer priority bump', '--json'],
      { cwd: repo, env: cliEnv }
    );
    assert.equal(JSON.parse(rejOut).status, 'rejected');
  } finally {
    await cleanupTestDirectory(root);
  }
});

test('M9 project recap drafts compare task state, recent Git changes, and project docs with evidence links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-m9-recap-'));
  const home = path.join(root, 'home');
  process.env.LOCALATLAS_HOME = home;
  try {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo);
    await execFileAsync('git', ['init'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'dev@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Local Dev'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'index.ts'), 'export const v = 1;\n');
    await execFileAsync('git', ['add', '.'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'REC-001 Initial implementation'], { cwd: repo });

    const project = await importProject(repo, { key: 'REC' });
    const doneTask = await createTask(project, { title: 'Initial implementation', status: 'done', priority: 'high' });
    const blockedTask = await createTask(project, { title: 'Deploy pipeline', status: 'blocked', priority: 'critical' });
    await writeDoc(
      project,
      blockedTask.path,
      `---\nid: ${blockedTask.id}\ntype: task\nstatus: blocked\npriority: critical\ndependsOn:\n  - REC-999\n---\n# Deploy pipeline\n`
    );
    await writeDoc(project, 'spec/overview.md', `# System Overview\nCovers [[${doneTask.id}]] architecture.\n`);
    await updateProjectProfile(project, {
      status: 'on_track',
      goals: 'Ship verified M9 recap',
      keyDocs: ['spec/overview.md'],
    });
    await createAgentSession(project, {
      taskId: blockedTask.id,
      resumeNote: 'Investigated deployment config.',
      nextAction: 'Resolve missing dependency REC-999.',
    });

    const recap = await generateProjectRecapDraft(project, { save: true });
    assert.equal(recap.completedWork.length, 1);
    assert.match(recap.completedWork[0].evidence, /\[\[REC-001\]\]/);
    assert.equal(recap.blockers.length, 1);
    assert.equal(recap.blockers[0].id, blockedTask.id);
    assert.match(recap.blockers[0].reason, /REC-999/);
    assert.equal(recap.staleDocs.length, 1);
    assert.equal(recap.staleDocs[0].path, 'spec/overview.md');
    assert.equal(recap.nextActions.length >= 2, true);
    assert.equal(Boolean(recap.path?.startsWith('recaps/')), true);

    const listed = await listProjectRecaps(project);
    assert.equal(listed.length, 1);
    const loaded = await readProjectRecap(project, listed[0].id);
    assert.match(loaded.body, /## Completed work/);
    assert.match(loaded.body, /## Blockers/);
    assert.match(loaded.body, /## Stale docs & review candidates/);
    assert.match(loaded.body, /## Next actions/);

    // Verify API endpoint
    const apiRes = await app.request(`/api/projects/${project.id}/recaps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ save: false }),
    });
    assert.equal(apiRes.status, 200);
    const apiRecap = await apiRes.json() as any;
    assert.equal(apiRecap.completedWork.length, 1);
    assert.equal(apiRecap.blockers.length, 1);
  } finally {
    await cleanupTestDirectory(root);
  }
});
