import type { Project, GitState, TaskRecord } from './types.js';
import { NotFoundError, ValidationError } from './errors.js';
import { getProjectGitStatus } from './git.js';
import { listTasks } from './tasks.js';
import { listAgentSessions } from './sessions.js';
import { extractOutboundLinks, parseDocument, deriveDocTitle } from './markdown.js';
import { listDocs, readDocWithMeta, resolveDocSelector } from './documents.js';

import { readProjectProfile, type ProjectDecisionEntry } from './profile.js';

const CONTEXT_TRUNCATION_MARKER = '... [truncated to fit agent context budget]';

export type TaskContextDocument = { path: string; title: string; content: string };

export type TaskAgentContextJson = {
  project: { id: string; key: string; name: string; sourcePath: string };
  profile: { status: string; goals: string; decisions: ProjectDecisionEntry[] };
  git: GitState | null;
  task: TaskRecord & { body: string; dependsOn: string[] };
  dependencies: Array<TaskRecord & { body: string }>;
  unresolvedDependencies: string[];
  documents: TaskContextDocument[];
  sessions: Array<{
    id: string; path: string; status: string; resumeNote: string; nextAction: string; branch: string | null; head: string | null;
  }>;
  text: string;
};

function limit(value: number | undefined, fallback: number, name: string, minimum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ValidationError(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value;
}

function dependenciesFrom(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(values.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))];
}

function markdownExcerpt(content: string, maxChars: number): string {
  const text = content.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n… [excerpt]`;
}

function boundedText(lines: string[], maxBytes: number, maxLines: number): string {
  const raw = lines.join('\n');
  if (raw.split('\n').length <= maxLines && Buffer.byteLength(raw, 'utf8') <= maxBytes) return raw;
  const footer = `\n${CONTEXT_TRUNCATION_MARKER}`;
  const footerBytes = Buffer.byteLength(footer, 'utf8');
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (kept.length >= maxLines - 1) break;
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8');
    if (bytes + lineBytes + footerBytes > maxBytes) break;
    kept.push(line);
    bytes += lineBytes;
  }
  return `${kept.join('\n')}${footer}`;
}

async function readTaskInProject(p: Project, selector: string): Promise<{ record: TaskRecord; content: string; frontmatter: Record<string, unknown>; body: string }> {
  const path = await resolveDocSelector(p, selector);
  const doc = await readDocWithMeta(p, path);
  if (doc.frontmatter.type !== 'task') throw new NotFoundError(`Task "${selector}" not found in project ${p.key}`);
  const record = (await listTasks(p)).find(task => task.path === path);
  if (!record) throw new NotFoundError(`Task "${selector}" not found in project ${p.key}`);
  const parsed = parseDocument(doc.content);
  return { record, content: doc.content, frontmatter: parsed.frontmatter, body: parsed.body };
}

export async function generateTaskAgentContext(
  p: Project,
  selector: string,
  options?: { maxBytes?: number; maxLines?: number }
): Promise<TaskAgentContextJson> {
  const maxBytes = limit(options?.maxBytes, 8192, 'maxBytes', Buffer.byteLength(`\n${CONTEXT_TRUNCATION_MARKER}`, 'utf8'));
  const maxLines = limit(options?.maxLines, 120, 'maxLines', 2);
  const [target, git, allTasks, profileRecord] = await Promise.all([
    readTaskInProject(p, selector),
    getProjectGitStatus(p),
    listTasks(p),
    readProjectProfile(p),
  ]);

  const dependsOn = dependenciesFrom(target.frontmatter.dependsOn ?? target.frontmatter.dependencies);
  const taskById = new Map(allTasks.map(task => [task.id, task]));
  const dependencies: Array<TaskRecord & { body: string }> = [];
  const dependencyBodies: Array<{ path: string; body: string }> = [];
  const unresolvedDependencies: string[] = [];
  for (const dependencyId of dependsOn) {
    const dependency = taskById.get(dependencyId);
    if (!dependency) {
      unresolvedDependencies.push(dependencyId);
      continue;
    }
    const doc = await readDocWithMeta(p, dependency.path);
    const parsed = parseDocument(doc.content);
    dependencies.push({ ...dependency, body: markdownExcerpt(parsed.body, 1200) });
    dependencyBodies.push({ path: dependency.path, body: parsed.body });
  }

  // Resolve explicit Markdown links from the task and its direct dependencies only.
  const relatedRefs = [
    ...extractOutboundLinks(target.record.path, target.body),
    ...dependencyBodies.flatMap(dependency => extractOutboundLinks(dependency.path, dependency.body)),
  ];
  const taskPaths = new Set([target.record.path, ...dependencies.map(dependency => dependency.path)]);
  const relatedPaths = new Set<string>();
  const availableDocs = new Set(await listDocs(p));
  for (const ref of relatedRefs) {
    try {
      const path = await resolveDocSelector(p, ref.targetRef);
      if (availableDocs.has(path) && !taskPaths.has(path)) relatedPaths.add(path);
    } catch {
      // Broken and cross-project links do not widen the bundle.
    }
  }

  const documents: TaskContextDocument[] = [];
  for (const path of [...relatedPaths].slice(0, 5)) {
    const doc = await readDocWithMeta(p, path);
    const parsed = parseDocument(doc.content);
    documents.push({
      path,
      title: deriveDocTitle(path, parsed),
      content: markdownExcerpt(parsed.body, 900),
    });
  }

  const sessions = (await listAgentSessions(p, { taskId: target.record.id }))
    .filter(session => session.status !== 'completed')
    .slice(0, 3)
    .map(session => ({
      id: session.id,
      path: session.path,
      status: session.status,
      resumeNote: session.resumeNote,
      nextAction: session.nextAction,
      branch: session.branch,
      head: session.head,
    }));

  const bodyLimit = Math.max(500, Math.floor(maxBytes / 4));
  const task = { ...target.record, body: markdownExcerpt(target.body, bodyLimit), dependsOn };
  const lines = [
    `# LocalAtlas Task Context: [${p.key}] ${target.record.id}`,
    `Project: [${p.key}] ${p.name}`,
    `Source: ${p.sourcePath}`,
    `Task: ${target.record.id} · ${target.record.title}`,
    `Status: ${target.record.status} · Priority: ${target.record.priority} · Checklist: ${target.record.checklist.checked}/${target.record.checklist.total}`,
    `Task document: ${target.record.path}`,
    '',
    '## Task details',
    task.body || '(No task details recorded.)',
  ];
  if (profileRecord.goals || profileRecord.decisions.length > 0) {
    lines.push('', '## Project goals & approved decisions');
    if (profileRecord.goals) lines.push(`Goals: ${profileRecord.goals}`);
    for (const dec of profileRecord.decisions.slice(-5)) {
      lines.push(`- [${dec.id}] ${dec.summary}${dec.rationale ? ` — Rationale: ${dec.rationale}` : ''}`);
    }
  }
  if (dependencies.length || unresolvedDependencies.length) {
    lines.push('', '## Dependencies');
    for (const dependency of dependencies) lines.push(`- [${dependency.id}] ${dependency.title} (${dependency.status}) — ${dependency.path}`);
    for (const dependencyId of unresolvedDependencies) lines.push(`- Unresolved same-project dependency: ${dependencyId}`);
  }
  if (documents.length) {
    lines.push('', '## Linked documents');
    for (const doc of documents) lines.push(`### ${doc.title} (${doc.path})`, doc.content);
  }
  if (sessions.length) {
    lines.push('', '## Active agent sessions');
    for (const session of sessions) {
      lines.push(`- ${session.status} ${session.path}${session.branch ? ` · branch ${session.branch}` : ''}${session.head ? ` · ${session.head.slice(0, 7)}` : ''}`);
      lines.push(`  Resume: ${session.resumeNote}`, `  Next: ${session.nextAction}`);
    }
  }
  if (git) {
    lines.push('', `## Read-only Git evidence (${git.branch})`);
    lines.push(`HEAD: ${git.head ? `${git.head.sha} ${git.head.subject}` : 'no commits'}`);
    lines.push(`Dirty files: ${git.dirtyCount}`);
    for (const commit of git.recentCommits.slice(0, 3)) lines.push(`- ${commit.sha.slice(0, 7)} ${commit.subject}`);
  }

  const profile = {
    status: profileRecord.status,
    goals: profileRecord.goals,
    decisions: profileRecord.decisions,
  };

  const result: Omit<TaskAgentContextJson, 'text'> = {
    project: { id: p.id, key: p.key, name: p.name, sourcePath: p.sourcePath },
    profile,
    git,
    task,
    dependencies,
    unresolvedDependencies,
    documents,
    sessions,
  };
  return { ...result, text: boundedText(lines, maxBytes, maxLines) };
}

