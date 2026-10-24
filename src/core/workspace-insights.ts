import type { Project, GitState, GitCommitInfo, TaskRecord } from './types.js';
import { NotFoundError, ValidationError } from './errors.js';
import { projects } from './projects.js';
import { readProjectProfile, type ProjectProfileStatus } from './profile.js';
import { listTasks } from './tasks.js';
import { listTaskChangeProposals } from './impact.js';
import { listAgentSessions, type AgentSessionRecord } from './sessions.js';
import { getProjectGitStatus, searchProjectGitHistory } from './git.js';
import { listDocs, readDocWithMeta, resolveDocSelector, writeDoc } from './documents.js';
import { normalizeDocName } from './paths.js';
import { deriveDocTitle, extractOutboundLinks, parseDocument, serializeDocument } from './markdown.js';
import { getBacklinks } from './search.js';

export type PortfolioProjectSummary = {
  project: Project;
  freshness: 'fresh' | 'stale';
  errors: Array<{ source: string; message: string }>;
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
  metrics: {
    durationMs: number;
    projectsProcessed: number;
    projectsFailed: number;
    maxConcurrentProjects: number;
    documentListings: number;
    indexReconciliations: number;
    gitCommands: number;
  };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(limit)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  }));
  return results;
}

export async function getPortfolioSummary(options?: { concurrency?: number }): Promise<PortfolioSummary> {
  const startedAt = performance.now();
  const allProjects = await projects();
  const metrics = { durationMs: 0, projectsProcessed: 0, projectsFailed: 0, maxConcurrentProjects: 0, documentListings: 0, indexReconciliations: 0, gitCommands: 0 };
  const requestedConcurrency = options?.concurrency ?? 4;
  const concurrency = Number.isSafeInteger(requestedConcurrency) && requestedConcurrency > 0 ? Math.min(8, requestedConcurrency) : 4;
  let activeProjects = 0;

  const summaries = await mapWithConcurrency(allProjects, concurrency, async p => {
    activeProjects++;
    metrics.maxConcurrentProjects = Math.max(metrics.maxConcurrentProjects, activeProjects);
    const errors: Array<{ source: string; message: string }> = [];
    metrics.documentListings++;
    const docPaths = await listDocs(p).catch(error => {
      errors.push({ source: 'documents', message: errorMessage(error) });
      return null;
    });
    const readOrFallback = async <T>(source: string, work: Promise<T>, fallback: T): Promise<T> => {
      try { return await work; }
      catch (error) { errors.push({ source, message: errorMessage(error) }); return fallback; }
    };
    const profilePromise = readOrFallback('profile', readProjectProfile(p), {
      projectId: p.id, path: 'project/profile.md', status: 'active' as ProjectProfileStatus, goals: '', keyDocs: [], decisions: [], history: [], updatedAt: '', etag: null,
    });
    const tasksPromise = docPaths
      ? readOrFallback('tasks', listTasks(p, undefined, { docPaths, onReconcile: () => { metrics.indexReconciliations++; } }), [] as TaskRecord[])
      : Promise.resolve([] as TaskRecord[]);
    const proposalsPromise = docPaths
      ? readOrFallback('proposals', listTaskChangeProposals(p, { status: 'pending', docPaths }), [])
      : Promise.resolve([]);
    const sessionsPromise = docPaths
      ? readOrFallback('sessions', listAgentSessions(p, { status: 'active', docPaths }), [])
      : Promise.resolve([]);
    const gitPromise = readOrFallback('git', getProjectGitStatus(p, { onCommand: () => { metrics.gitCommands++; } }), null);
    const [profile, tasks, pendingProposals, activeSessions, git] = await Promise.all([profilePromise, tasksPromise, proposalsPromise, sessionsPromise, gitPromise]);

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

    const summary: PortfolioProjectSummary = {
      project: p,
      freshness: errors.length ? 'stale' : 'fresh',
      errors,
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
    };
    metrics.projectsProcessed++;
    if (errors.length) metrics.projectsFailed++;
    activeProjects--;
    return summary;
  });

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
    metrics: { ...metrics, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 },
    totals,
    projects: summaries,
  };
}

export async function getPortfolioAttention(options?: { concurrency?: number }): Promise<PortfolioAttentionSummary> {
  const generatedAt = new Date().toISOString();
  const allProjects = await projects();
  const requestedConcurrency = options?.concurrency ?? 4;
  const concurrency = Number.isSafeInteger(requestedConcurrency) && requestedConcurrency > 0 ? Math.min(8, requestedConcurrency) : 4;
  const projectResults = await mapWithConcurrency(allProjects, concurrency, async project => {
    const errors: Array<{ source: string; message: string }> = [];
    const settle = async <T>(source: string, work: Promise<T>): Promise<{ value: T; ok: true } | { value: null; ok: false }> => {
      try { return { value: await work, ok: true }; }
      catch (error) { errors.push({ source, message: errorMessage(error) }); return { value: null, ok: false }; }
    };
    const docPathsResult = await settle('documents', listDocs(project));
    const docPaths = docPathsResult.ok ? docPathsResult.value : null;
    const [profileResult, tasksResult, proposalsResult, sessionsResult] = await Promise.all([
      settle('profile', readProjectProfile(project)),
      docPaths ? settle('tasks', listTasks(project, undefined, { docPaths })) : Promise.resolve({ value: null, ok: false } as const),
      docPaths ? settle('proposals', listTaskChangeProposals(project, { status: 'pending', docPaths })) : Promise.resolve({ value: null, ok: false } as const),
      docPaths ? settle('sessions', listAgentSessions(project, { docPaths })) : Promise.resolve({ value: null, ok: false } as const),
    ]);
    const status: ProjectProfileStatus = profileResult.ok ? profileResult.value.status : 'active';
    const tasks = tasksResult.ok ? tasksResult.value : [];
    const proposals = proposalsResult.ok ? proposalsResult.value : [];
    const sessions = sessionsResult.ok ? sessionsResult.value : [];
    if (docPaths && tasksResult.ok) {
      const healthResult = await settle('health', analyzeProjectHealth(project, { docPaths, tasks }));
      const health = healthResult.ok ? healthResult.value : null;
      return {
        project: { project, status, healthScore: health?.score ?? null, brokenLinksCount: health?.brokenLinks.length ?? 0, orphanDocsCount: health?.orphanDocs.length ?? 0, generatedAt, errors },
        items: [
          ...tasks.filter(task => task.status === 'blocked' || (task.priority === 'critical' && task.status !== 'done' && task.status !== 'cancelled')).map(task => ({
            id: `${project.id}:task:${task.id}`, type: 'task' as const, severity: task.priority === 'critical' ? 'critical' as const : 'warning' as const,
            projectId: project.id, projectKey: project.key, projectName: project.name, projectStatus: status, title: task.title,
            evidence: [task.status === 'blocked' ? 'Status: blocked' : null, task.priority === 'critical' ? `Priority: critical · status: ${task.status}` : null].filter(Boolean).join(' · '),
            path: task.path, updatedAt: null,
          })),
          ...proposals.map(proposal => ({
            id: `${project.id}:proposal:${proposal.id}`, type: 'proposal' as const, severity: 'warning' as const,
            projectId: project.id, projectKey: project.key, projectName: project.name, projectStatus: status,
            title: proposal.proposed.title || `Change proposal for ${proposal.taskId}`,
            evidence: `Pending review · task ${proposal.taskId} · ${Object.keys(proposal.proposed).length} proposed field(s)`, path: proposal.path, updatedAt: proposal.updatedAt,
          })),
          ...sessions.filter(session => session.status === 'paused').map(session => ({
            id: `${project.id}:session:${session.id}`, type: 'session' as const, severity: 'warning' as const,
            projectId: project.id, projectKey: project.key, projectName: project.name, projectStatus: status, title: session.title,
            evidence: `Paused; resume needed${session.taskId ? ` · task ${session.taskId}` : ''} · Next: ${session.nextAction}`,
            path: session.path, updatedAt: session.updatedAt,
          })),
          ...(health?.brokenLinks ?? []).map((link, index) => ({
            id: `${project.id}:broken-link:${link.sourcePath}:${link.targetRef}:${index}`, type: 'broken_link' as const, severity: 'warning' as const,
            projectId: project.id, projectKey: project.key, projectName: project.name, projectStatus: status,
            title: `Broken link in ${link.sourceTitle}`, evidence: `Missing target: ${link.targetRef}`, path: link.sourcePath, updatedAt: null,
          })),
        ],
      };
    }
    for (const [source, result] of [['tasks', tasksResult], ['proposals', proposalsResult], ['sessions', sessionsResult]] as const) {
      if (!result.ok && !errors.some(error => error.source === source)) errors.push({ source, message: 'Document inventory unavailable.' });
    }
    return {
      project: { project, status, healthScore: null, brokenLinksCount: 0, orphanDocsCount: 0, generatedAt, errors },
      items: [],
    };
  });
  const items = projectResults.flatMap(result => result.items).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1)
    || a.projectKey.localeCompare(b.projectKey) || a.title.localeCompare(b.title));
  return { generatedAt, projects: projectResults.map(result => result.project), items };
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
  taskIdCommits: GitCommitInfo[];
  sessionStartCommits: GitCommitInfo[];
  recentHistoryScope: { description: string; commitLimit: number; commitsScanned: number };
  /** @deprecated Use taskIdCommits and sessionStartCommits to distinguish evidence types. */
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

    const taskIdCommits = commits.filter(commit => idRegex.test(commit.subject));
    const sessionStartCommits = commits.filter(commit => sessionHeadShas.has(commit.sha));
    const matchedCommits = [...new Map([...taskIdCommits, ...sessionStartCommits].map(commit => [commit.sha, commit])).values()];

    const incompleteChecklistCount = Math.max(0, task.checklist.total - task.checklist.checked);
    const dodWarning =
      task.status === 'done' && incompleteChecklistCount > 0
        ? `Task "${task.id}" is marked done but still has ${incompleteChecklistCount} unchecked checklist item(s).`
        : null;

    result[task.id] = {
      taskId: task.id,
      taskIdCommits,
      sessionStartCommits,
      recentHistoryScope: { description: 'Latest commits from local Git status', commitLimit: 5, commitsScanned: commits.length },
      matchedCommits,
      activeSessions,
      recentSessions: taskSessions.slice(0, 5),
      incompleteChecklistCount,
      dodWarning,
    };
  }

  return result;
}

export async function searchTaskGitHistory(
  p: Project,
  taskId: string,
  options: { sinceDays?: number; limit?: number } = {}
): Promise<{
  taskId: string;
  generatedAt: string;
  available: boolean;
  reason: string | null;
  scope: { revision: 'HEAD'; sinceDays: number; commitLimit: number; commitsScanned: number; truncated: boolean };
  matches: Array<{ commit: GitCommitInfo; evidence: Array<'task_id_in_subject' | 'session_start_head'> }>;
}> {
  const task = (await listTasks(p)).find(item => item.id.toLocaleLowerCase() === taskId.toLocaleLowerCase());
  if (!task) throw new NotFoundError(`Task "${taskId}" not found in project ${p.key}`);
  const [sessions, history] = await Promise.all([
    listAgentSessions(p, { taskId: task.id }),
    searchProjectGitHistory(p, options),
  ]);
  const sessionHeadShas = new Set(sessions.map(session => session.head).filter((sha): sha is string => Boolean(sha)));
  const escapedId = task.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taskIdPattern = new RegExp(`\\b${escapedId}\\b`, 'i');
  const matches = history.commits.flatMap(commit => {
    const evidence: Array<'task_id_in_subject' | 'session_start_head'> = [];
    if (taskIdPattern.test(commit.subject)) evidence.push('task_id_in_subject');
    if (sessionHeadShas.has(commit.sha)) evidence.push('session_start_head');
    return evidence.length ? [{ commit, evidence }] : [];
  });
  return {
    taskId: task.id,
    generatedAt: new Date().toISOString(),
    available: history.available,
    reason: history.reason,
    scope: { revision: history.revision, sinceDays: history.sinceDays, commitLimit: history.limit, commitsScanned: history.commitsScanned, truncated: history.truncated },
    matches,
  };
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

export type PortfolioAttentionItem = {
  id: string;
  type: 'task' | 'proposal' | 'session' | 'broken_link';
  severity: 'critical' | 'warning';
  projectId: string;
  projectKey: string;
  projectName: string;
  projectStatus: ProjectProfileStatus;
  title: string;
  evidence: string;
  path: string;
  updatedAt: string | null;
};

export type PortfolioAttentionProject = {
  project: Project;
  status: ProjectProfileStatus;
  healthScore: number | null;
  brokenLinksCount: number;
  orphanDocsCount: number;
  generatedAt: string;
  errors: Array<{ source: string; message: string }>;
};

export type PortfolioAttentionSummary = {
  generatedAt: string;
  projects: PortfolioAttentionProject[];
  items: PortfolioAttentionItem[];
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

export async function analyzeProjectHealth(p: Project, options?: { docPaths?: string[]; tasks?: TaskRecord[] }): Promise<ProjectHealthReport> {
  const allDocPaths = options?.docPaths ?? await listDocs(p);
  const [profile, tasks] = await Promise.all([
    readProjectProfile(p),
    options?.tasks ? Promise.resolve(options.tasks) : listTasks(p, undefined, { docPaths: allDocPaths }),
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
        const backlinks = await getBacklinks(p, docPath, { skipReconcile: true });
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

    if (task.status === 'done' || task.status === 'cancelled') continue;
    for (const depId of task.dependsOn) {
      const key = depId.toLocaleLowerCase();
      const list = dependentsMap.get(key) ?? [];
      if (!list.includes(task.id)) list.push(task.id);
      dependentsMap.set(key, list);
    }
  }

  const bottleneckTasks: BottleneckTaskEntry[] = [];
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled') continue;
    const blocking = dependentsMap.get(task.id.toLocaleLowerCase()) ?? [];
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
