import { randomUUID } from 'node:crypto';
import type { Project, GitCommitInfo } from './types.js';
import { NotFoundError } from './errors.js';
import { getProjectGitStatus } from './git.js';
import { listTasks, getProjectRollup } from './tasks.js';
import { listDocs, readDocWithMeta, resolveDocSelector, writeDoc } from './documents.js';
import { listAgentSessions } from './sessions.js';
import { readProjectProfile } from './profile.js';
import { deriveDocTitle, parseDocument, serializeDocument } from './markdown.js';
import { withDb } from './db.js';
import { reconcileProjectIndex } from './search.js';

export type RecapCompletedItem = {
  id: string;
  title: string;
  path: string;
  evidence: string;
};

export type RecapBlockerItem = {
  id: string;
  title: string;
  path: string;
  reason: string;
  evidenceLinks: string[];
};

export type RecapStaleDocItem = {
  path: string;
  title: string;
  docId: string | null;
  reason: string;
  evidence: string;
};

export type RecapNextActionItem = {
  action: string;
  source: string;
  evidenceLink: string;
};

export type ProjectRecapDraft = {
  id: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  generatedAt: string;
  path: string | null;
  etag: string | null;
  git: {
    branch: string;
    headSha: string | null;
    dirtyCount: number;
    recentCommits: GitCommitInfo[];
  } | null;
  completedWork: RecapCompletedItem[];
  blockers: RecapBlockerItem[];
  staleDocs: RecapStaleDocItem[];
  nextActions: RecapNextActionItem[];
  markdown: string;
};

function normalizeDependsOn(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(arr.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean))];
}

export async function generateProjectRecapDraft(
  p: Project,
  options?: { save?: boolean }
): Promise<ProjectRecapDraft> {
  await reconcileProjectIndex(p);
  const [git, allTasks, rollup, sessions, profile, allDocPaths] = await Promise.all([
    getProjectGitStatus(p),
    listTasks(p),
    getProjectRollup(p),
    listAgentSessions(p),
    readProjectProfile(p),
    listDocs(p),
  ]);

  const docMtimes = await withDb(db => {
    const rows = db.prepare('SELECT path, mtime_ms, updated_at, doc_id, title, type FROM doc_index WHERE project_id = ?').all(p.id) as Array<{
      path: string;
      mtime_ms: number;
      updated_at: string;
      doc_id: string | null;
      title: string;
      type: string | null;
    }>;
    return new Map(rows.map(r => [r.path, r]));
  });

  const taskById = new Map(allTasks.map(t => [t.id, t]));
  const completedWork: RecapCompletedItem[] = [];
  const blockers: RecapBlockerItem[] = [];
  const staleDocs: RecapStaleDocItem[] = [];
  const nextActions: RecapNextActionItem[] = [];

  const latestGitCommit = git?.head ?? null;
  const latestCommitTimeMs = latestGitCommit?.timestamp ? Date.parse(latestGitCommit.timestamp) : null;

  // 1. Completed work backed by task links and Git evidence
  for (const t of allTasks.filter(task => task.status === 'done')) {
    const matchingCommit = git?.recentCommits.find(
      c => c.subject.toLowerCase().includes(t.id.toLowerCase()) || c.subject.toLowerCase().includes(t.title.toLowerCase())
    );
    const commitNote = matchingCommit
      ? ` + commit \`${matchingCommit.sha.slice(0, 7)}\` ("${matchingCommit.subject}")`
      : '';
    completedWork.push({
      id: t.id,
      title: t.title,
      path: t.path,
      evidence: `[[${t.id}]] (${t.path})${commitNote}`,
    });
  }

  // 2. Blockers: tasks with status=blocked, or tasks with unresolved/unmet dependencies, or broken epic/milestone references
  for (const t of allTasks.filter(task => task.status !== 'done' && task.status !== 'cancelled')) {
    let deps: string[] = [];
    try {
      const doc = await readDocWithMeta(p, t.path);
      const parsed = parseDocument(doc.content);
      deps = normalizeDependsOn(parsed.frontmatter.dependsOn ?? parsed.frontmatter.dependencies);
    } catch {
      deps = [];
    }

    const unresolvedDeps = deps.filter(d => !taskById.has(d));
    const blockedOrIncompleteDeps = deps
      .map(d => taskById.get(d))
      .filter((dep): dep is NonNullable<ReturnType<typeof taskById.get>> => dep !== undefined && dep.status !== 'done');

    if (t.status === 'blocked' || unresolvedDeps.length > 0 || blockedOrIncompleteDeps.length > 0) {
      const reasons: string[] = [];
      const evidenceLinks: string[] = [`[[${t.id}]]`];
      if (t.status === 'blocked') reasons.push('marked status: blocked');
      if (unresolvedDeps.length > 0) reasons.push(`unresolved dependencies (${unresolvedDeps.join(', ')})`);
      if (blockedOrIncompleteDeps.length > 0) {
        reasons.push(`waiting on ${blockedOrIncompleteDeps.map(d => `${d.id} (${d.status})`).join(', ')}`);
        for (const d of blockedOrIncompleteDeps) evidenceLinks.push(`[[${d.id}]]`);
      }
      blockers.push({
        id: t.id,
        title: t.title,
        path: t.path,
        reason: reasons.join('; '),
        evidenceLinks,
      });
    }
  }

  for (const broken of rollup.brokenReferences) {
    const missing = broken.missingEpic ? `missing epic "${broken.missingEpic}"` : `missing milestone "${broken.missingMilestone}"`;
    blockers.push({
      id: broken.taskId || broken.path,
      title: broken.title,
      path: broken.path,
      reason: `Broken roadmap reference: ${missing}`,
      evidenceLinks: [`[[${broken.taskId || broken.path}]]`],
    });
  }

  // 3. Stale docs: compare doc modification timestamps against recent Git commits, Done tasks, and keyDocs
  const nonSystemDocs = allDocPaths.filter(
    docPath =>
      !docPath.startsWith('tasks/') &&
      !docPath.startsWith('sessions/') &&
      !docPath.startsWith('proposals/') &&
      !docPath.startsWith('recaps/')
  );

  for (const docPath of nonSystemDocs) {
    const idx = docMtimes.get(docPath);
    let title = idx?.title || docPath;
    let docId = idx?.doc_id ?? null;
    let body = '';
    try {
      const meta = await readDocWithMeta(p, docPath);
      const parsed = parseDocument(meta.content);
      title = deriveDocTitle(docPath, parsed);
      docId = (parsed.frontmatter.id as string) || docId;
      body = parsed.body;
    } catch {
      continue;
    }

    // Check 1: Doc references a task that is now 'done', or is a keyDoc older than the latest Git commit
    const referencedDoneTasks = allTasks.filter(
      t => t.status === 'done' && (body.includes(`[[${t.id}]]`) || body.includes(t.path))
    );
    const isKeyDoc = profile.keyDocs.includes(docPath);
    const docMtime = idx?.mtime_ms ?? 0;

    if (referencedDoneTasks.length > 0) {
      staleDocs.push({
        path: docPath,
        title,
        docId,
        reason: `References completed task(s) ${referencedDoneTasks.map(t => `[[${t.id}]]`).join(', ')}; review if spec needs updating`,
        evidence: `[[${docPath}]] ↔ ${referencedDoneTasks.map(t => `[[${t.id}]]`).join(', ')}`,
      });
    } else if (latestCommitTimeMs && docMtime > 0 && docMtime + 1000 < latestCommitTimeMs && latestGitCommit) {
      staleDocs.push({
        path: docPath,
        title,
        docId,
        reason: `${isKeyDoc ? 'Key document' : 'Project doc'} last updated before recent commit \`${latestGitCommit.sha.slice(0, 7)}\` ("${latestGitCommit.subject}")`,
        evidence: `[[${docPath}]] vs commit \`${latestGitCommit.sha.slice(0, 7)}\``,
      });
    }
  }

  // 4. Next actions: from active/paused agent sessions, blocked tasks, and top in_progress/todo tasks
  for (const session of sessions.filter(s => s.status !== 'completed').slice(0, 5)) {
    if (session.nextAction) {
      const taskRef = session.taskId ? ` (task [[${session.taskId}]])` : '';
      nextActions.push({
        action: session.nextAction,
        source: `Session ${session.status}${taskRef}`,
        evidenceLink: `[[${session.path}]]`,
      });
    }
  }

  for (const b of blockers.slice(0, 5)) {
    nextActions.push({
      action: `Unblock ${b.id} (${b.title}): ${b.reason}`,
      source: 'Blocker resolution',
      evidenceLink: `[[${b.id}]]`,
    });
  }

  const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const activeCandidates = allTasks
    .filter(t => t.status === 'in_progress' || t.status === 'todo')
    .sort((a, b) => (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0));

  for (const t of activeCandidates.slice(0, 5)) {
    if (!nextActions.some(na => na.evidenceLink === `[[${t.id}]]`)) {
      nextActions.push({
        action: `${t.status === 'in_progress' ? 'Finish in-progress' : 'Start high-priority'} task [${t.id}] ${t.title} (${t.priority})`,
        source: `Task ${t.status}`,
        evidenceLink: `[[${t.id}]]`,
      });
    }
  }

  for (const sd of staleDocs.slice(0, 3)) {
    nextActions.push({
      action: `Review and refresh document "${sd.title}" (${sd.path})`,
      source: 'Stale documentation check',
      evidenceLink: `[[${sd.path}]]`,
    });
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const lines: string[] = [
    `# Project Recap: [${p.key}] ${p.name}`,
    '',
    `Generated: ${now}`,
  ];

  if (profile.goals) {
    lines.push(`Project Status: \`${profile.status}\` · Goals: ${profile.goals.split('\n')[0]}`);
  }

  if (git) {
    lines.push('');
    lines.push(`## Recent Git Activity (${git.branch})`);
    lines.push(`- Working tree dirty files: ${git.dirtyCount}`);
    if (git.head) {
      lines.push(`- HEAD: \`${git.head.sha.slice(0, 7)}\` ${git.head.subject} (${git.head.author})`);
    }
    for (const c of git.recentCommits.slice(0, 5)) {
      lines.push(`- Commit \`${c.sha.slice(0, 7)}\`: ${c.subject}`);
    }
  }

  lines.push('');
  lines.push('## Completed work');
  if (completedWork.length === 0) {
    lines.push('- No completed tasks recorded yet.');
  } else {
    for (const item of completedWork) {
      lines.push(`- **${item.title}** — Evidence: ${item.evidence}`);
    }
  }

  lines.push('');
  lines.push('## Blockers');
  if (blockers.length === 0) {
    lines.push('- No active blockers detected.');
  } else {
    for (const b of blockers) {
      lines.push(`- **[${b.id}] ${b.title}**: ${b.reason} — Evidence: ${b.evidenceLinks.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('## Stale docs & review candidates');
  if (staleDocs.length === 0) {
    lines.push('- All managed documents are up to date with current task and Git state.');
  } else {
    for (const sd of staleDocs) {
      lines.push(`- **${sd.title}** (\`${sd.path}\`): ${sd.reason} — Evidence: ${sd.evidence}`);
    }
  }

  lines.push('');
  lines.push('## Next actions');
  if (nextActions.length === 0) {
    lines.push('- No pending next actions.');
  } else {
    for (const na of nextActions) {
      lines.push(`- ${na.action} *(Source: ${na.source}, Evidence: ${na.evidenceLink})*`);
    }
  }
  lines.push('');

  const body = lines.join('\n');
  let savedPath: string | null = null;
  let savedEtag: string | null = null;

  if (options?.save) {
    savedPath = `recaps/${id}.md`;
    const frontmatter: Record<string, string> = {
      id,
      type: 'project_recap',
      status: 'draft',
      generatedAt: now,
    };
    const keyOrder = ['id', 'type', 'status', 'generatedAt'];
    if (git?.branch) {
      frontmatter.branch = git.branch;
      keyOrder.push('branch');
    }
    if (git?.head?.sha) {
      frontmatter.gitHead = git.head.sha;
      keyOrder.push('gitHead');
    }
    const fullContent = serializeDocument(frontmatter, keyOrder, body);
    const written = await writeDoc(p, savedPath, fullContent, { createOnly: true });
    savedEtag = written.etag;
  }

  return {
    id,
    projectId: p.id,
    projectKey: p.key,
    projectName: p.name,
    generatedAt: now,
    path: savedPath,
    etag: savedEtag,
    git: git
      ? {
          branch: git.branch,
          headSha: git.head?.sha ?? null,
          dirtyCount: git.dirtyCount,
          recentCommits: git.recentCommits,
        }
      : null,
    completedWork,
    blockers,
    staleDocs,
    nextActions,
    markdown: body,
  };
}

export async function listProjectRecaps(p: Project): Promise<Array<{
  id: string;
  path: string;
  title: string;
  generatedAt: string;
  gitHead: string | null;
  etag: string;
}>> {
  const paths = (await listDocs(p)).filter(docPath => docPath.startsWith('recaps/') && docPath.endsWith('.md'));
  const items: Array<{
    id: string;
    path: string;
    title: string;
    generatedAt: string;
    gitHead: string | null;
    etag: string;
  }> = [];
  for (const docPath of paths) {
    try {
      const doc = await readDocWithMeta(p, docPath);
      if (doc.frontmatter.type !== 'project_recap') continue;
      const parsed = parseDocument(doc.content);
      items.push({
        id: typeof doc.frontmatter.id === 'string' ? doc.frontmatter.id : docPath,
        path: docPath,
        title: deriveDocTitle(docPath, parsed),
        generatedAt: typeof doc.frontmatter.generatedAt === 'string' ? doc.frontmatter.generatedAt : '',
        gitHead: typeof doc.frontmatter.gitHead === 'string' ? doc.frontmatter.gitHead : null,
        etag: doc.etag,
      });
    } catch {
      // ignore
    }
  }
  return items.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function readProjectRecap(p: Project, selector: string): Promise<{
  id: string;
  path: string;
  title: string;
  generatedAt: string;
  gitHead: string | null;
  etag: string;
  content: string;
  body: string;
}> {
  let docPath: string;
  try {
    docPath = await resolveDocSelector(p, selector);
  } catch {
    throw new NotFoundError('Project recap not found in this project');
  }
  if (!docPath.startsWith('recaps/')) {
    throw new NotFoundError('Project recap not found in this project');
  }
  const doc = await readDocWithMeta(p, docPath);
  if (doc.frontmatter.type !== 'project_recap') {
    throw new NotFoundError('Project recap not found in this project');
  }
  const parsed = parseDocument(doc.content);
  return {
    id: typeof doc.frontmatter.id === 'string' ? doc.frontmatter.id : docPath,
    path: docPath,
    title: deriveDocTitle(docPath, parsed),
    generatedAt: typeof doc.frontmatter.generatedAt === 'string' ? doc.frontmatter.generatedAt : '',
    gitHead: typeof doc.frontmatter.gitHead === 'string' ? doc.frontmatter.gitHead : null,
    etag: doc.etag,
    content: doc.content,
    body: parsed.body,
  };
}
