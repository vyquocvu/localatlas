import type { Project, GitState, TaskRecord } from './types.js';
import { NotFoundError, ValidationError } from './errors.js';
import { getProjectGitStatus } from './git.js';
import { listTasks } from './tasks.js';
import { listAgentSessions } from './sessions.js';
import { extractOutboundLinks, parseDocument, deriveDocTitle } from './markdown.js';
import { listDocs, readDocWithMeta, resolveDocSelector } from './documents.js';
import { withDb } from './db.js';

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

async function readTaskInProject(
  p: Project,
  selector: string,
  preloadedTasks?: TaskRecord[]
): Promise<{ record: TaskRecord; content: string; body: string }> {
  let path: string;
  try {
    path = await resolveDocSelector(p, selector);
  } catch (e) {
    if (e instanceof Error && e.message === 'Invalid document path') {
      throw new NotFoundError(`Task "${selector}" not found in project ${p.key}`);
    }
    throw e;
  }
  const doc = await readDocWithMeta(p, path);
  if (doc.frontmatter.type !== 'task') throw new NotFoundError(`Task "${selector}" not found in project ${p.key}`);
  const record = (preloadedTasks ?? await listTasks(p)).find(task => task.path === path);
  if (!record) throw new NotFoundError(`Task "${selector}" not found in project ${p.key}`);
  const parsed = parseDocument(doc.content);
  return { record, content: doc.content, body: parsed.body };
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

  const dependsOn = target.record.dependsOn;
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

export type TaskLinkedDocument = {
  path: string;
  id: string | null;
  title: string;
  type: string | null;
  status: string | null;
  isTask: boolean;
  refs: string[];
};

export type TaskDocumentLinks = {
  task: { id: string; path: string; title: string };
  documents: TaskLinkedDocument[];
  unresolved: string[];
  truncated: boolean;
  unresolvedTruncated: boolean;
};

const MAX_TASK_DOCUMENT_LINKS = 20;
const MAX_TASK_LINK_CANDIDATES = 100;
const MAX_UNRESOLVED_LINKS = 20;

export async function getTaskDocumentLinks(p: Project, selector: string): Promise<TaskDocumentLinks> {
  const [availableDocList, allTasks] = await Promise.all([listDocs(p), listTasks(p)]);
  const target = await readTaskInProject(p, selector, allTasks);

  const availableDocs = new Set(availableDocList);
  const pathByLower = new Map<string, string>();
  for (const docPath of availableDocList) {
    const key = docPath.toLowerCase();
    if (!pathByLower.has(key)) pathByLower.set(key, docPath);
  }
  const taskByPath = new Map(allTasks.map(task => [task.path, task]));
  const idToPath = new Map(allTasks.map(task => [task.id, task.path]));
  const indexedIds = await withDb(db => db
    .prepare('SELECT path, doc_id FROM doc_index WHERE project_id = ? AND doc_id IS NOT NULL')
    .all(p.id) as Array<{ path: string; doc_id: string }>);
  for (const row of indexedIds) {
    if (!idToPath.has(row.doc_id)) idToPath.set(row.doc_id, row.path);
  }

  const resolveRef = (ref: { targetRef: string; targetKind: 'id' | 'path' }): string | null => {
    if (ref.targetKind === 'path') {
      const exact = availableDocs.has(ref.targetRef) ? ref.targetRef : pathByLower.get(ref.targetRef.toLowerCase());
      if (exact) return exact;
      if (!ref.targetRef.includes('/')) {
        const stem = ref.targetRef.endsWith('.md') ? ref.targetRef.slice(0, -3) : ref.targetRef;
        const indexed = idToPath.get(stem);
        return indexed && availableDocs.has(indexed) ? indexed : null;
      }
      return null;
    }
    const indexed = idToPath.get(ref.targetRef);
    return indexed && availableDocs.has(indexed) ? indexed : null;
  };

  const refs = extractOutboundLinks(target.record.path, target.body);
  const seen = new Set<string>([target.record.path]);
  const refsByPath = new Map<string, string[]>();
  const documents: TaskLinkedDocument[] = [];
  const unresolved: string[] = [];
  let resolvedCount = 0;
  let unresolvedTruncated = false;

  for (const ref of refs.slice(0, MAX_TASK_LINK_CANDIDATES)) {
    const path = resolveRef(ref);
    if (!path) {
      if (unresolved.length < MAX_UNRESOLVED_LINKS) unresolved.push(ref.rawRef);
      else unresolvedTruncated = true;
      continue;
    }
    const linkedRefs = refsByPath.get(path) ?? [];
    if (!linkedRefs.includes(ref.rawRef)) linkedRefs.push(ref.rawRef);
    refsByPath.set(path, linkedRefs);
    if (seen.has(path)) continue;
    seen.add(path);
    resolvedCount += 1;
    if (documents.length >= MAX_TASK_DOCUMENT_LINKS) continue;

    const doc = await readDocWithMeta(p, path);
    const parsed = parseDocument(doc.content);
    const linkedTask = taskByPath.get(path);
    const type = typeof doc.frontmatter.type === 'string' ? doc.frontmatter.type : null;
    documents.push({
      path,
      id: linkedTask?.id ?? (typeof doc.frontmatter.id === 'string' ? doc.frontmatter.id : null),
      title: deriveDocTitle(path, parsed),
      type,
      status: linkedTask?.status ?? (typeof doc.frontmatter.status === 'string' ? doc.frontmatter.status : null),
      isTask: type === 'task' || Boolean(linkedTask),
      refs: refsByPath.get(path) ?? [],
    });
  }

  return {
    task: { id: target.record.id, path: target.record.path, title: target.record.title },
    documents,
    unresolved,
    truncated: resolvedCount > MAX_TASK_DOCUMENT_LINKS || refs.length > MAX_TASK_LINK_CANDIDATES,
    unresolvedTruncated,
  };
}

