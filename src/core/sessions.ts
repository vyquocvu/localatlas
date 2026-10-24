import { randomUUID } from 'node:crypto';
import type { Project } from './types.js';
import { NotFoundError, ValidationError } from './errors.js';
import { getProjectGitStatus } from './git.js';
import { listTasks } from './tasks.js';
import { listDocs, readDocWithMeta, resolveDocSelector, writeDoc } from './documents.js';
import { deriveDocTitle, parseDocument, serializeDocument } from './markdown.js';

export type AgentSessionStatus = 'active' | 'paused' | 'completed';

export type AgentSessionRecord = {
  id: string;
  projectId: string;
  taskId: string | null;
  path: string;
  title: string;
  status: AgentSessionStatus;
  resumeNote: string;
  nextAction: string;
  branch: string | null;
  head: string | null;
  createdAt: string;
  updatedAt: string;
  etag: string;
};

const VALID_SESSION_STATUSES = new Set<AgentSessionStatus>(['active', 'paused', 'completed']);

function linesForSection(body: string, heading: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
  return lines.slice(start + 1, end).join('\n').trim().split('\n').filter(Boolean);
}

function replaceSection(body: string, heading: string, value: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start < 0) return `${body.trimEnd()}\n\n## ${heading}\n${value.trim()}\n`;
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
  lines.splice(start + 1, end - start - 1, value.trim());
  return lines.join('\n');
}

function sessionFromContent(
  p: Project,
  path: string,
  content: string,
  etag: string
): AgentSessionRecord {
  const parsed = parseDocument(content);
  if (parsed.frontmatter.type !== 'agent_session') throw new NotFoundError('Agent session not found in this project');
  const fm = parsed.frontmatter;
  const status = typeof fm.status === 'string' && VALID_SESSION_STATUSES.has(fm.status as AgentSessionStatus)
    ? fm.status as AgentSessionStatus
    : 'active';
  return {
    id: typeof fm.id === 'string' ? fm.id : path,
    projectId: p.id,
    taskId: typeof fm.task === 'string' ? fm.task : null,
    path,
    title: deriveDocTitle(path, parsed),
    status,
    resumeNote: linesForSection(parsed.body, 'Resume note').join('\n'),
    nextAction: linesForSection(parsed.body, 'Next action').join('\n'),
    branch: typeof fm.branch === 'string' ? fm.branch : null,
    head: typeof fm.head === 'string' ? fm.head : null,
    createdAt: typeof fm.createdAt === 'string' ? fm.createdAt : '',
    updatedAt: typeof fm.updatedAt === 'string' ? fm.updatedAt : '',
    etag,
  };
}

async function assertProjectTask(p: Project, taskId: string | null | undefined): Promise<string | null> {
  if (!taskId?.trim()) return null;
  const id = taskId.trim();
  const task = (await listTasks(p)).find(item => item.id === id);
  if (!task) throw new NotFoundError(`Task "${id}" not found in project ${p.key}`);
  return task.id;
}

export async function listAgentSessions(
  p: Project,
  filters?: { taskId?: string; status?: AgentSessionStatus; docPaths?: string[] }
): Promise<AgentSessionRecord[]> {
  if (filters?.status && !VALID_SESSION_STATUSES.has(filters.status)) {
    throw new ValidationError(`Invalid agent session status: "${filters.status}"`);
  }
  const paths = (filters?.docPaths ?? await listDocs(p)).filter(path => path.startsWith('sessions/') && path.endsWith('.md'));
  const sessions: AgentSessionRecord[] = [];
  for (const path of paths) {
    try {
      const doc = await readDocWithMeta(p, path);
      if (doc.frontmatter.type !== 'agent_session') continue;
      const session = sessionFromContent(p, path, doc.content, doc.etag);
      if (filters?.taskId && session.taskId !== filters.taskId) continue;
      if (filters?.status && session.status !== filters.status) continue;
      sessions.push(session);
    } catch (error) {
      if (error instanceof NotFoundError) continue;
      throw error;
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.path.localeCompare(b.path));
}

export async function readAgentSession(p: Project, selector: string): Promise<AgentSessionRecord> {
  let path: string;
  try {
    path = await resolveDocSelector(p, selector);
  } catch {
    throw new NotFoundError('Agent session not found in this project');
  }
  if (!path.startsWith('sessions/')) throw new NotFoundError('Agent session not found in this project');
  const doc = await readDocWithMeta(p, path);
  return sessionFromContent(p, path, doc.content, doc.etag);
}

export async function createAgentSession(
  p: Project,
  input: { taskId?: string | null; title?: string; resumeNote: string; nextAction: string }
): Promise<AgentSessionRecord> {
  const resumeNote = input.resumeNote?.trim();
  const nextAction = input.nextAction?.trim();
  if (!resumeNote) throw new ValidationError('Resume note cannot be empty');
  if (!nextAction) throw new ValidationError('Next action cannot be empty');
  const taskId = await assertProjectTask(p, input.taskId);
  const task = taskId ? (await listTasks(p)).find(item => item.id === taskId) : null;
  const id = randomUUID();
  const path = `sessions/${id}.md`;
  const now = new Date().toISOString();
  const git = await getProjectGitStatus(p);
  const title = input.title?.trim() || (task ? `Session: ${task.title}` : `Project session: ${p.name}`);
  const frontmatter: Record<string, string> = {
    id,
    type: 'agent_session',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const keyOrder = ['id', 'type', 'status'];
  if (taskId) { frontmatter.task = taskId; keyOrder.push('task'); }
  if (git?.branch) { frontmatter.branch = git.branch; keyOrder.push('branch'); }
  if (git?.head?.sha) { frontmatter.head = git.head.sha; keyOrder.push('head'); }
  keyOrder.push('createdAt', 'updatedAt');
  const body = `# ${title}\n\n## Resume note\n${resumeNote}\n\n## Next action\n${nextAction}\n\n## History\n- ${now}: session started${git?.head ? ` at ${git.head.sha.slice(0, 7)}` : ''}\n`;
  const content = serializeDocument(frontmatter, keyOrder, body);
  const saved = await writeDoc(p, path, content, { createOnly: true });
  return sessionFromContent(p, path, content, saved.etag);
}

export async function updateAgentSession(
  p: Project,
  selector: string,
  patch: { status?: AgentSessionStatus; resumeNote?: string; nextAction?: string; ifMatch?: string }
): Promise<AgentSessionRecord> {
  if (patch.status !== undefined && !VALID_SESSION_STATUSES.has(patch.status)) {
    throw new ValidationError(`Invalid agent session status: "${patch.status}"`);
  }
  let currentPath: string;
  try {
    currentPath = await resolveDocSelector(p, selector);
  } catch {
    throw new NotFoundError('Agent session not found in this project');
  }
  if (!currentPath.startsWith('sessions/')) throw new NotFoundError('Agent session not found in this project');
  const current = await readDocWithMeta(p, currentPath);
  if (current.frontmatter.type !== 'agent_session') throw new NotFoundError('Agent session not found in this project');
  const parsed = parseDocument(current.content);
  const now = new Date().toISOString();
  let body = parsed.body;
  const changed: string[] = [];
  if (patch.resumeNote !== undefined) {
    if (!patch.resumeNote.trim()) throw new ValidationError('Resume note cannot be empty');
    body = replaceSection(body, 'Resume note', patch.resumeNote);
    changed.push('resume note');
  }
  if (patch.nextAction !== undefined) {
    if (!patch.nextAction.trim()) throw new ValidationError('Next action cannot be empty');
    body = replaceSection(body, 'Next action', patch.nextAction);
    changed.push('next action');
  }
  const frontmatter = { ...(parsed.frontmatter as Record<string, string | string[]>) };
  const keyOrder = [...parsed.keyOrder];
  const git = await getProjectGitStatus(p);
  if (git) {
    frontmatter.branch = git.branch;
    if (!keyOrder.includes('branch')) keyOrder.push('branch');
    if (git.head?.sha) {
      frontmatter.head = git.head.sha;
      if (!keyOrder.includes('head')) keyOrder.push('head');
    }
  }
  if (patch.status !== undefined && patch.status !== frontmatter.status) {
    frontmatter.status = patch.status;
    if (!keyOrder.includes('status')) keyOrder.push('status');
    changed.push(`status → ${patch.status}`);
  }
  frontmatter.updatedAt = now;
  if (!keyOrder.includes('updatedAt')) keyOrder.push('updatedAt');
  if (changed.length) {
    const history = linesForSection(body, 'History');
    history.push(`- ${now}: updated ${changed.join(', ')}`);
    body = replaceSection(body, 'History', history.join('\n'));
  }
  const savedContent = serializeDocument(frontmatter, keyOrder, body, parsed.lineEnding);
  const saved = await writeDoc(p, currentPath, savedContent, {
    ifMatch: patch.ifMatch ?? current.etag,
  });
  return sessionFromContent(p, currentPath, savedContent, saved.etag);
}
