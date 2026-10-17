import type { Project, GitState, GitCommitInfo, TaskRecord } from './types.js';
import { NotFoundError, ValidationError } from './errors.js';
import { projects } from './projects.js';
import { readProjectProfile, type ProjectProfileStatus } from './profile.js';
import { listTasks } from './tasks.js';
import { listTaskChangeProposals } from './impact.js';
import { listAgentSessions, type AgentSessionRecord } from './sessions.js';
import { getProjectGitStatus } from './git.js';
import { listDocs, readDocWithMeta, resolveDocSelector, writeDoc } from './documents.js';
import { normalizeDocName } from './paths.js';
import { deriveDocTitle, extractOutboundLinks, parseDocument, serializeDocument } from './markdown.js';
import { getBacklinks } from './search.js';

export type PortfolioProjectSummary = {
  project: Project;
  profile: {
    status: ProjectProfileStatus;
    goals: string;
    decisionsCount: number;
    keyDocsCount: number;
  };
  tasks: {
    total: number;
    todo: number;
    in_progress: number;
    blocked: number;
    done: number;
    cancelled: number;
    criticalOpen: number;
    completionPct: number;
  };
  pendingProposalsCount: number;
  activeSessionsCount: number;
  git: {
    branch: string;
    dirtyCount: number;
    head: GitCommitInfo | null;
  } | null;
};

export type PortfolioSummary = {
  generatedAt: string;
  totals: {
    projectsCount: number;
    totalTasks: number;
    blockedTasks: number;
    criticalOpenTasks: number;
    pendingProposals: number;
    activeSessions: number;
    dirtyRepos: number;
  };
  projects: PortfolioProjectSummary[];
};

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const allProjects = await projects();
  const summaries: PortfolioProjectSummary[] = [];

  for (const p of allProjects) {
    const [profile, tasks, pendingProposals, activeSessions, git] = await Promise.all([
      readProjectProfile(p),
      listTasks(p),
      listTaskChangeProposals(p, { status: 'pending' }),
      listAgentSessions(p, { status: 'active' }),
      getProjectGitStatus(p),
    ]);

    let todo = 0;
    let in_progress = 0;
    let blocked = 0;
    let done = 0;
    let cancelled = 0;
    let criticalOpen = 0;

    for (const t of tasks) {
      if (t.status === 'todo') todo++;
      else if (t.status === 'in_progress') in_progress++;
      else if (t.status === 'blocked') blocked++;
      else if (t.status === 'done') done++;
      else if (t.status === 'cancelled') cancelled++;

      if (t.priority === 'critical' && t.status !== 'done' && t.status !== 'cancelled') {
        criticalOpen++;
      }
    }

    const activeTotal = tasks.length - cancelled;
    const completionPct = activeTotal > 0 ? Math.round((done / activeTotal) * 100) : 0;

    summaries.push({
      project: p,
      profile: {
        status: profile.status,
        goals: profile.goals,
        decisionsCount: profile.decisions.length,
        keyDocsCount: profile.keyDocs.length,
      },
      tasks: {
        total: tasks.length,
        todo,
        in_progress,
        blocked,
        done,
        cancelled,
        criticalOpen,
        completionPct,
      },
      pendingProposalsCount: pendingProposals.length,
      activeSessionsCount: activeSessions.length,
      git: git
        ? {
            branch: git.branch,
            dirtyCount: git.dirtyCount,
            head: git.head,
          }
        : null,
    });
  }

  const totals = summaries.reduce(
    (acc, item) => {
      acc.projectsCount += 1;
      acc.totalTasks += item.tasks.total;
      acc.blockedTasks += item.tasks.blocked;
      acc.criticalOpenTasks += item.tasks.criticalOpen;
      acc.pendingProposals += item.pendingProposalsCount;
      acc.activeSessions += item.activeSessionsCount;
      if (item.git && item.git.dirtyCount > 0) acc.dirtyRepos += 1;
      return acc;
    },
    {
      projectsCount: 0,
      totalTasks: 0,
      blockedTasks: 0,
      criticalOpenTasks: 0,
      pendingProposals: 0,
      activeSessions: 0,
      dirtyRepos: 0,
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    totals,
    projects: summaries,
  };
}

export type DocTemplateDefinition = {
  id: 'prd' | 'adr' | 'bug_report' | 'release_checklist';
  name: string;
  role: string;
  description: string;
  defaultFolder: string;
  frontmatterType: string;
};

const DOC_TEMPLATES: DocTemplateDefinition[] = [
  {
    id: 'prd',
    name: 'Product Requirements Document (PRD)',
    role: 'Product Manager',
    description: 'Structured product spec with problem statement, goals, non-goals, user stories, and acceptance criteria.',
    defaultFolder: 'specs',
    frontmatterType: 'prd',
  },
  {
    id: 'adr',
    name: 'Architecture Decision Record (ADR)',
    role: 'Tech Lead / Architect',
    description: 'Technical decision record with context, considered options, chosen architecture, and consequences.',
    defaultFolder: 'architecture',
    frontmatterType: 'adr',
  },
  {
    id: 'bug_report',
    name: 'Bug Triage & Reproduction Report',
    role: 'QA / Developer',
    description: 'Reproducible bug report with environment, steps to reproduce, expected vs actual behavior, and root cause.',
    defaultFolder: 'qa',
    frontmatterType: 'bug_report',
  },
  {
    id: 'release_checklist',
    name: 'Release & Verification Checklist',
    role: 'PM / QA / Release Lead',
    description: 'Pre-release verification gate covering tests, docs freshness, migrations, and rollback plan.',
    defaultFolder: 'releases',
    frontmatterType: 'release_checklist',
  },
];

export function listDocTemplates(): DocTemplateDefinition[] {
  return DOC_TEMPLATES.map(item => ({ ...item }));
}

export function renderDocTemplateContent(
  templateId: string,
  title: string,
  options?: { docId?: string; status?: string }
): { content: string; template: DocTemplateDefinition } {
  const template = DOC_TEMPLATES.find(item => item.id === templateId);
  if (!template) {
    throw new ValidationError(
      `Unknown template "${templateId}". Available templates: ${DOC_TEMPLATES.map(t => t.id).join(', ')}`
    );
  }
  const cleanTitle = title.trim();
  if (!cleanTitle) {
    throw new ValidationError('Document title cannot be empty');
  }

  const now = new Date().toISOString().slice(0, 10);
  const frontmatter: Record<string, string> = {
    type: template.frontmatterType,
    status: options?.status?.trim() || 'draft',
    createdAt: now,
  };
  const keyOrder = ['type', 'status', 'createdAt'];
  if (options?.docId?.trim()) {
    frontmatter.id = options.docId.trim();
    keyOrder.unshift('id');
  }

  let body = '';
  if (template.id === 'prd') {
    body = [
      `# ${cleanTitle}`,
      '',
      '## Problem statement',
      '- What user or workflow pain point does this solve?',
      '',
      '## Goals',
      '- Primary measurable outcome',
      '',
      '## Non-goals',
      '- Explicitly out-of-scope items',
      '',
      '## User stories & requirements',
      '- [ ] Story 1:',
      '- [ ] Story 2:',
      '',
      '## Acceptance criteria (Definition of Done)',
      '- [ ] All unit and integration tests pass',
      '- [ ] Documentation updated',
      '',
    ].join('\n');
  } else if (template.id === 'adr') {
    body = [
      `# ${cleanTitle}`,
      '',
      '## Context',
      'Describe the architectural forces and constraints at play.',
      '',
      '## Options considered',
      '1. **Option A**: Pros / Cons',
      '2. **Option B**: Pros / Cons',
      '',
      '## Decision',
      'State the chosen approach clearly.',
      '',
      '## Consequences',
      '- **Positive**:',
      '- **Trade-offs / Risks**:',
      '',
    ].join('\n');
  } else if (template.id === 'bug_report') {
    body = [
      `# ${cleanTitle}`,
      '',
      '## Summary',
      'Brief description of the defect and affected component.',
      '',
      '## Steps to reproduce',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Expected vs. Actual behavior',
      '- **Expected**:',
      '- **Actual**:',
      '',
      '## Verification checklist',
      '- [ ] Regression test added',
      '- [ ] Fix verified locally',
      '',
    ].join('\n');
  } else {
    body = [
      `# ${cleanTitle}`,
      '',
      '## Pre-release verification',
      '- [ ] `npm run typecheck` passes with 0 errors',
      '- [ ] `npm test` passes all unit and integration suites',
      '- [ ] Key documents and roadmap updated',
      '',
      '## Key changes included',
      '- ',
      '',
      '## Rollback & recovery plan',
      '- Workspace backup verified prior to release',
      '',
    ].join('\n');
  }

  return {
    content: serializeDocument(frontmatter, keyOrder, body),
    template,
  };
}

export async function createDocFromTemplate(
  p: Project,
  input: {
    templateId: string;
    path: string;
    title?: string;
    docId?: string;
    status?: string;
  }
): Promise<{ path: string; etag: string; content: string; template: DocTemplateDefinition }> {
  const normPath = normalizeDocName(input.path);
  const derivedTitle =
    input.title?.trim() ||
    normPath
      .replace(/\.md$/i, '')
      .split('/')
      .pop()
      ?.replace(/[-_]+/g, ' ') ||
    'Untitled';

  const rendered = renderDocTemplateContent(input.templateId, derivedTitle, {
    docId: input.docId,
    status: input.status,
  });

  const saved = await writeDoc(p, normPath, rendered.content, { createOnly: true });
  return {
    path: saved.path,
    etag: saved.etag,
    content: rendered.content,
    template: rendered.template,
  };
}

export type TaskTraceabilityItem = {
  taskId: string;
  matchedCommits: GitCommitInfo[];
  activeSessions: AgentSessionRecord[];
  recentSessions: AgentSessionRecord[];
  incompleteChecklistCount: number;
  dodWarning: string | null;
};

export async function getProjectTaskTraceability(
  p: Project
): Promise<Record<string, TaskTraceabilityItem>> {
  const [tasks, sessions, git] = await Promise.all([
    listTasks(p),
    listAgentSessions(p),
    getProjectGitStatus(p),
  ]);

  const commits = git?.recentCommits ?? [];
  const result: Record<string, TaskTraceabilityItem> = {};

  for (const task of tasks) {
    const taskSessions = sessions.filter(s => s.taskId === task.id);
    const activeSessions = taskSessions.filter(s => s.status === 'active');
    const sessionHeadShas = new Set(
      taskSessions.map(s => s.head).filter((h): h is string => Boolean(h))
    );

    const escapedId = task.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const idRegex = new RegExp(`\\b${escapedId}\\b`, 'i');

    const matchedCommits = commits.filter(
      c => idRegex.test(c.subject) || sessionHeadShas.has(c.sha)
    );

    const incompleteChecklistCount = Math.max(0, task.checklist.total - task.checklist.checked);
    const dodWarning =
      task.status === 'done' && incompleteChecklistCount > 0
        ? `Task "${task.id}" is marked done but still has ${incompleteChecklistCount} unchecked checklist item(s).`
        : null;

    result[task.id] = {
      taskId: task.id,
      matchedCommits,
      activeSessions,
      recentSessions: taskSessions.slice(0, 5),
      incompleteChecklistCount,
      dodWarning,
    };
  }

  return result;
}

export type BrokenLinkEntry = {
  sourcePath: string;
  sourceTitle: string;
  targetRef: string;
};

export type OrphanDocEntry = {
  path: string;
  title: string;
  type: string | null;
};

export type BottleneckTaskEntry = {
  taskId: string;
  title: string;
  status: string;
  blockingTaskIds: string[];
};

export type TaskDodIssue = {
  taskId: string;
  title: string;
  path: string;
  uncheckedCount: number;
  totalCount: number;
};

export type ProjectHealthReport = {
  projectId: string;
  projectKey: string;
  generatedAt: string;
  score: number;
  brokenLinks: BrokenLinkEntry[];
  orphanDocs: OrphanDocEntry[];
  dodIssues: TaskDodIssue[];
  bottleneckTasks: BottleneckTaskEntry[];
};

const STRUCTURED_SYSTEM_TYPES = new Set([
  'task',
  'epic',
  'milestone',
  'agent_session',
  'project_profile',
  'task_change_proposal',
  'project_recap',
]);

export async function analyzeProjectHealth(p: Project): Promise<ProjectHealthReport> {
  const [allDocPaths, profile, tasks] = await Promise.all([
    listDocs(p),
    readProjectProfile(p),
    listTasks(p),
  ]);

  const keyDocsSet = new Set(profile.keyDocs);
  const brokenLinks: BrokenLinkEntry[] = [];
  const orphanDocs: OrphanDocEntry[] = [];

  for (const docPath of allDocPaths) {
    let doc;
    try {
      doc = await readDocWithMeta(p, docPath);
    } catch (err) {
      if (err instanceof NotFoundError) continue;
      throw err;
    }
    const parsed = parseDocument(doc.content);
    const title = deriveDocTitle(docPath, parsed);
    const fmType = typeof parsed.frontmatter.type === 'string' ? parsed.frontmatter.type : null;

    const outbound = extractOutboundLinks(docPath, parsed.body);
    for (const link of outbound) {
      try {
        await resolveDocSelector(p, link.targetRef);
      } catch {
        brokenLinks.push({
          sourcePath: docPath,
          sourceTitle: title,
          targetRef: link.targetRef,
        });
      }
    }

    const isSystemFolder =
      docPath.startsWith('tasks/') ||
      docPath.startsWith('epics/') ||
      docPath.startsWith('milestones/') ||
      docPath.startsWith('sessions/') ||
      docPath.startsWith('proposals/') ||
      docPath.startsWith('recaps/') ||
      docPath === 'project/profile.md';

    if (!isSystemFolder && (!fmType || !STRUCTURED_SYSTEM_TYPES.has(fmType))) {
      if (!keyDocsSet.has(docPath)) {
        const backlinks = await getBacklinks(p, docPath);
        if (backlinks.length === 0) {
          orphanDocs.push({
            path: docPath,
            title,
            type: fmType,
          });
        }
      }
    }
  }

  const dodIssues: TaskDodIssue[] = [];
  const dependentsMap = new Map<string, string[]>();

  for (const task of tasks) {
    const unchecked = Math.max(0, task.checklist.total - task.checklist.checked);
    if (task.status === 'done' && unchecked > 0) {
      dodIssues.push({
        taskId: task.id,
        title: task.title,
        path: task.path,
        uncheckedCount: unchecked,
        totalCount: task.checklist.total,
      });
    }

    try {
      const doc = await readDocWithMeta(p, task.path);
      const rawDeps = doc.frontmatter.dependsOn ?? doc.frontmatter.dependencies;
      const deps = Array.isArray(rawDeps)
        ? rawDeps
        : typeof rawDeps === 'string'
        ? [rawDeps]
        : [];
      for (const dep of deps) {
        if (typeof dep !== 'string' || !dep.trim()) continue;
        const depId = dep.trim();
        const list = dependentsMap.get(depId) ?? [];
        if (!list.includes(task.id)) list.push(task.id);
        dependentsMap.set(depId, list);
      }
    } catch {
      // Ignore unreadable task
    }
  }

  const bottleneckTasks: BottleneckTaskEntry[] = [];
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled') continue;
    const blocking = dependentsMap.get(task.id) ?? [];
    if (blocking.length > 0) {
      bottleneckTasks.push({
        taskId: task.id,
        title: task.title,
        status: task.status,
        blockingTaskIds: blocking,
      });
    }
  }
  bottleneckTasks.sort((a, b) => b.blockingTaskIds.length - a.blockingTaskIds.length);

  const penalty =
    brokenLinks.length * 10 +
    dodIssues.length * 15 +
    orphanDocs.length * 5 +
    bottleneckTasks.filter(b => b.status === 'blocked').length * 10;
  const score = Math.max(0, 100 - penalty);

  return {
    projectId: p.id,
    projectKey: p.key,
    generatedAt: new Date().toISOString(),
    score,
    brokenLinks,
    orphanDocs,
    dodIssues,
    bottleneckTasks,
  };
}
