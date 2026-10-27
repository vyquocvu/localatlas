import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  projects,
  importProject,
  selectProject,
  updateProject,
  relinkProject,
  removeProject,
  listDocs,
  listDocsFiltered,
  readDocWithMeta,
  resolveDocSelector,
  writeDoc,
  updateFrontmatter,
  moveDoc,
  deleteDoc,
  reindexProject,
  searchDocs,
  getBacklinks,
  onProjectEvent,
  currentEventSeq,
  createTask,
  createEpic,
  updateEpic,
  createMilestone,
  updateMilestone,
  promoteNoteToTask,
  listTasks,
  updateTask,
  getProjectRollup,
  getProjectStatusWithGit,
  listProjectSourceDocs,
  readProjectSourceDoc,
  generateAgentContext,
  generateTaskAgentContext,
  getTaskDocumentLinks,
  listAgentSessions,
  readAgentSession,
  createAgentSession,
  updateAgentSession,
  readProjectProfile,
  updateProjectProfile,
  recordProjectDecision,
  previewTaskImpact,
  createTaskChangeProposal,
  listTaskChangeProposals,
  readTaskChangeProposal,
  confirmTaskChangeProposal,
  rejectTaskChangeProposal,
  generateProjectRecapDraft,
  listProjectRecaps,
  readProjectRecap,
  getPortfolioSummary,
  getPortfolioAttention,
  listDocTemplates,
  createDocFromTemplate,
  getProjectTaskTraceability,
  searchTaskGitHistory,
  analyzeProjectHealth,
  getAgentsMdSnippet,
  pickDirectory,
  listDirectories,
  codexChatManager,
  readDocumentDraft,
  writeDocumentDraft,
  deleteDocumentDraft,
  backupWorkspace,
  inspectBackupWorkspace,
  terminalManager,
  ConflictError,
  ValidationError,
  NotFoundError,
} from './core.js';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const ALLOWED_HOST_RE = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const TASK_PATCH_FIELDS = new Set(['status', 'priority', 'epic', 'milestone', 'title', 'body', 'ifMatch']);
const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'";

function utf8Excerpt(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

type CodexEvent = ReturnType<ReturnType<typeof codexChatManager.getRuntime>['eventsAfter']>[number];

function isLocalBrowserHost(host: string): boolean {
  return ALLOWED_HOST_RE.test(host);
}

function isLocalCodexOrigin(origin: string, host: string): boolean {
  try {
    const url = new URL(origin);
    if (!isLocalBrowserHost(host) || url.protocol !== 'http:') return false;
    const [hostName, hostPort = '80'] = host.split(':');
    return url.hostname.toLowerCase() === hostName.toLowerCase() && (url.port || '80') === hostPort;
  } catch {
    return false;
  }
}

function isLocalCodexRequest(host: string, origin: string | undefined): boolean {
  return isLocalBrowserHost(host) && (origin === undefined || isLocalCodexOrigin(origin, host));
}

function createCodexEventQueue() {
  const events: CodexEvent[] = [];
  const waiters = new Set<{ resolve: (event: CodexEvent | null) => void; timer: NodeJS.Timeout }>();
  let closed = false;
  return {
    push(event: CodexEvent) {
      const waiter = waiters.values().next().value as { resolve: (event: CodexEvent | null) => void; timer: NodeJS.Timeout } | undefined;
      if (waiter) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      } else if (!closed) events.push(event);
    },
    next(timeoutMs: number): Promise<CodexEvent | null> {
      const event = events.shift();
      if (event) return Promise.resolve(event);
      if (closed) return Promise.resolve(null);
      return new Promise(resolve => {
        const waiter = { resolve, timer: setTimeout(() => {
          waiters.delete(waiter);
          resolve(null);
        }, timeoutMs) };
        waiters.add(waiter);
      });
    },
    close() {
      closed = true;
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(null);
      }
      waiters.clear();
    },
  };
}

function extractWildcard(reqPath: string, marker: string): string {
  const raw = reqPath.split(marker).slice(1).join(marker);
  if (!raw || /%2f|%5c|%00/i.test(raw)) {
    throw new Error('Invalid document path');
  }
  return raw.split('/').map(s => decodeURIComponent(s)).join('/');
}

function docName(reqPath: string): string {
  return extractWildcard(reqPath, '/docs/');
}

function draftName(reqPath: string): string {
  return extractWildcard(reqPath, '/drafts/');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errorStatus(e: unknown): 400 | 404 | 409 {
  if (e instanceof ConflictError) return 409;
  if (e instanceof ValidationError) return 400;
  if (e instanceof NotFoundError) return 404;
  if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return 404;
  return errorMessage(e).startsWith('Project not found') ? 404 : 400;
}

function errorResponse(c: { json: (body: unknown, status: 400 | 404 | 409) => Response }, e: unknown): Response {
  const status = errorStatus(e);
  if (e instanceof ConflictError) {
    return c.json({ error: e.message, currentEtag: e.currentEtag }, 409);
  }
  return c.json({ error: errorMessage(e) }, status);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function isAllowedHost(host: string): boolean {
  if (ALLOWED_HOST_RE.test(host)) return true;
  if (process.env.LOCALATLAS_ALLOW_REMOTE === 'true') {
    return true;
  }
  return false;
}

function isAllowedOrigin(origin: string, hostHeader: string): boolean {
  try {
    const url = new URL(origin);
    if (process.env.LOCALATLAS_ALLOW_REMOTE === 'true') {
      const hostNameOnly = hostHeader.split(':')[0].toLowerCase();
      if (url.hostname.toLowerCase() === hostNameOnly) return true;
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return true;
      if (
        url.hostname.endsWith('.trycloudflare.com') ||
        url.hostname.endsWith('.ngrok-free.app') ||
        url.hostname.endsWith('.ngrok.app') ||
        url.hostname.endsWith('.loca.lt')
      ) {
        return true;
      }
    }
    if (url.protocol !== 'http:') return false;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return false;
    const hostPort = hostHeader.includes(':') ? hostHeader.split(':')[1] : '';
    if (url.port !== hostPort) return false;
    return true;
  } catch {
    return false;
  }
}

export const app = new Hono();

app.onError((err, c) => {
  return errorResponse(c, err);
});

app.use('*', async (c, next) => {
  const host = c.req.header('host') ?? new URL(c.req.url).host;
  if (!host || !isAllowedHost(host)) {
    return c.json({ error: 'Forbidden host' }, 403);
  }
  if (MUTATING_METHODS.has(c.req.method.toUpperCase())) {
    const secFetchSite = c.req.header('sec-fetch-site');
    if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') {
      return c.json({ error: 'Cross-site requests are forbidden' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && !isAllowedOrigin(origin, host)) {
      return c.json({ error: 'Forbidden origin' }, 403);
    }
    const contentLength = c.req.header('content-length');
    if (contentLength !== undefined) {
      const len = Number(contentLength);
      if (!Number.isFinite(len) || len > MAX_BODY_BYTES) {
        return c.json({ error: 'Payload too large' }, 413);
      }
    }
  }
  c.header('Content-Security-Policy', CSP_HEADER);
  return next();
});

app.get('/api/projects', async c => c.json(await projects()));

app.get('/api/overview', async c => {
  const registeredProjects = await projects();
  const overview = await mapWithConcurrency(registeredProjects, 4, async project => {
    const [status, docs, tasks] = await Promise.all([
      getProjectStatusWithGit(project),
      listDocs(project),
      listTasks(project),
    ]);
    const counts = {
      total: tasks.length,
      open: tasks.filter(task => task.status !== 'done' && task.status !== 'cancelled').length,
      blocked: tasks.filter(task => task.status === 'blocked').length,
      inProgress: tasks.filter(task => task.status === 'in_progress').length,
      todo: tasks.filter(task => task.status === 'todo').length,
      done: tasks.filter(task => task.status === 'done').length,
      cancelled: tasks.filter(task => task.status === 'cancelled').length,
    };
    const priorityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const activeTasks = tasks
      .filter(task => task.status !== 'done' && task.status !== 'cancelled')
      .sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority])
      .slice(0, 4)
      .map(task => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, path: task.path }));
    return {
      id: project.id,
      key: project.key,
      name: project.name,
      sourcePath: project.sourcePath,
      createdAt: project.createdAt,
      git: status.git,
      docs: { count: docs.length, paths: docs.slice(0, 5) },
      tasks: { ...counts, active: activeTasks },
    };
  });
  return c.json(overview);
});

app.post('/api/workspace/backup', async c => {
  try {
    const body = await c.req.json() as { targetDir?: string };
    if (typeof body.targetDir !== 'string' || !body.targetDir.trim()) return c.json({ error: 'Backup target directory is required' }, 400);
    const result = await backupWorkspace(body.targetDir.trim());
    const verification = await inspectBackupWorkspace(result.backupDir);
    return c.json({ ...result, verification });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/workspace/backup/inspect', async c => {
  try {
    const body = await c.req.json() as { backupDir?: string };
    if (typeof body.backupDir !== 'string' || !body.backupDir.trim()) return c.json({ error: 'Backup directory is required' }, 400);
    return c.json(await inspectBackupWorkspace(body.backupDir.trim()));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { path?: string; key?: string; name?: string; reuseDocs?: string };
    if (typeof body?.path !== 'string' || !body.path.trim()) return c.json({ error: 'path required' }, 400);
    return c.json(await importProject(body.path, { key: body.key, name: body.name, reuseDocs: body.reuseDocs }), 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/fs/pick-directory', async c => {
  try {
    return c.json(await pickDirectory());
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/fs/directories', async c => {
  try {
    const p = c.req.query('path');
    return c.json(await listDirectories(p));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.patch('/api/projects/:id', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { name?: string; key?: string; force?: boolean };
    return c.json(await updateProject(c.req.param('id'), { name: body.name, key: body.key }, { force: Boolean(body.force) }));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.patch('/api/projects/:id/relink', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { sourcePath?: string };
    if (typeof body?.sourcePath !== 'string') return c.json({ error: 'sourcePath required' }, 400);
    return c.json(await relinkProject(c.req.param('id'), body.sourcePath));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.delete('/api/projects/:id', async c => {
  try {
    const purgeDocs = c.req.query('purgeDocs') === 'true';
    return c.json(await removeProject(c.req.param('id'), { purgeDocs }));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/status', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const status = await getProjectStatusWithGit(proj);
    return c.json(status);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/source-docs', async c => {
  try {
    return c.json(await listProjectSourceDocs(await selectProject(c.req.param('id'))));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/source-docs/*', async c => {
  try {
    const project = await selectProject(c.req.param('id'));
    const sourceDocPath = extractWildcard(c.req.path, '/source-docs/');
    const content = await readProjectSourceDoc(project, sourceDocPath);
    c.header('X-Document-Path', sourceDocPath);
    return c.text(content);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/context', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const maxBytes = c.req.query('maxBytes') ? Number(c.req.query('maxBytes')) : undefined;
    const maxLines = c.req.query('maxLines') ? Number(c.req.query('maxLines')) : undefined;
    const maxItems = c.req.query('maxItems') ? Number(c.req.query('maxItems')) : undefined;
    const taskId = c.req.query('task');
    const ctx = taskId
      ? await generateTaskAgentContext(proj, taskId, { maxBytes, maxLines })
      : await generateAgentContext(proj, { maxBytes, maxLines, maxItems });
    if (c.req.query('format') === 'text') {
      return c.text(ctx.text);
    }
    return c.json('json' in ctx ? { ...ctx.json, text: ctx.text } : ctx);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/codex-chat/start', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Codex chat is available only through localhost' }, 403);
    }
    const raw = await c.req.text();
    let taskId: string | undefined;
    if (raw.trim()) {
      const parsed = JSON.parse(raw) as { taskId?: string };
      if (typeof parsed?.taskId === 'string' && parsed.taskId.trim()) {
        taskId = parsed.taskId.trim();
      }
    }
    const project = await selectProject(c.req.param('id'));
    const context = taskId
      ? await generateTaskAgentContext(project, taskId, { maxBytes: 12_000, maxLines: 120 })
      : await generateAgentContext(project, { maxBytes: 12_000, maxLines: 120, maxItems: 4 });
    return c.json(await codexChatManager.start(project, context.text), 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/codex-chat/resume', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Codex chat is available only through localhost' }, 403);
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > 16_000) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { threadId?: string };
    if (typeof body?.threadId !== 'string') return c.json({ error: 'threadId required' }, 400);
    return c.json(await codexChatManager.resume(await selectProject(c.req.param('id')), body.threadId));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/codex-chat/:threadId/turns', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Codex chat is available only through localhost' }, 403);
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > 64_000) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { text?: string };
    if (typeof body?.text !== 'string' || !body.text.trim()) return c.json({ error: 'Message text required' }, 400);
    if (body.text.length > 40_000) return c.json({ error: 'Message is too long' }, 400);
    const project = await selectProject(c.req.param('id'));
    return c.json(await codexChatManager.startTurn(project, c.req.param('threadId'), body.text.trim()), 202);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/codex-chat/:threadId/approvals/:requestId', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Codex chat is available only through localhost' }, 403);
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > 4_000) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { decision?: string };
    const decision = body?.decision;
    if (decision !== 'accept' && decision !== 'acceptForSession' && decision !== 'decline' && decision !== 'cancel') {
      return c.json({ error: 'Invalid approval decision' }, 400);
    }
    const project = await selectProject(c.req.param('id'));
    codexChatManager.approve(project, c.req.param('threadId'), c.req.param('requestId'), decision);
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/codex-chat/:threadId/events', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Codex chat is available only through localhost' }, 403);
    }
    const project = await selectProject(c.req.param('id'));
    const runtime = codexChatManager.getRuntime(project, c.req.param('threadId'));
    const rawCursor = c.req.header('last-event-id') ?? c.req.query('after') ?? '0';
    const parsedCursor = Number(rawCursor);
    if (!Number.isSafeInteger(parsedCursor) || parsedCursor < 0) return c.json({ error: 'Invalid event cursor' }, 400);
    return streamSSE(c, async stream => {
      const queue = createCodexEventQueue();
      const unsubscribe = runtime.subscribe(event => queue.push(event));
      let cursor = parsedCursor;
      stream.onAbort(() => {
        unsubscribe();
        queue.close();
      });
      for (const event of runtime.eventsAfter(cursor)) {
        await stream.writeSSE({ id: String(event.id), event: 'codex', data: JSON.stringify(event) });
        cursor = event.id;
      }
      while (!stream.aborted) {
        const event = await queue.next(15_000);
        if (stream.aborted) break;
        if (!event) {
          await stream.writeSSE({ event: 'keepalive', data: '{}' });
          continue;
        }
        if (event.id <= cursor) continue;
        await stream.writeSSE({ id: String(event.id), event: 'codex', data: JSON.stringify(event) });
        cursor = event.id;
      }
      unsubscribe();
      queue.close();
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/terminal/start', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Terminal is available only through localhost' }, 403);
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > 8_000) return c.json({ error: 'Payload too large' }, 413);
    const body = raw.trim()
      ? (JSON.parse(raw) as { cols?: number; rows?: number; restart?: boolean; initialCommand?: string })
      : {};
    const project = await selectProject(c.req.param('id'));
    const session = await terminalManager.startOrAttach(project, {
      cols: body.cols,
      rows: body.rows,
      restart: Boolean(body.restart),
      initialCommand: typeof body.initialCommand === 'string' ? body.initialCommand : undefined,
    });
    return c.json(session, 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/terminal/codex/start', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Codex terminal is available only through localhost' }, 403);
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > 16_000) return c.json({ error: 'Payload too large' }, 413);
    const body = raw.trim() ? JSON.parse(raw) as {
      scope?: { type?: string; id?: string; path?: string; source?: string };
      cols?: number; rows?: number; newSession?: boolean;
    } : {};
    const project = await selectProject(c.req.param('id'));
    const scope = body.scope ?? { type: 'project' };
    const projectContext = await generateAgentContext(project, { maxBytes: 8192, maxLines: 120, maxItems: 6 });
    let scopeKey = 'project';
    let scopeDescription = `project ${project.key} (${project.name})`;
    let scopeContext = projectContext.text;
    if (scope.type === 'task') {
      if (!scope.id?.trim()) throw new ValidationError('A task ID is required for task-scoped Codex');
      const taskContext = await generateTaskAgentContext(project, scope.id.trim(), { maxBytes: 8192, maxLines: 120 });
      scopeKey = `task:${taskContext.task.id}`;
      scopeDescription = `task ${taskContext.task.id}: ${taskContext.task.title}`;
      scopeContext = taskContext.text;
    } else if (scope.type === 'document') {
      if (!scope.path?.trim() || !['atlas', 'repo'].includes(scope.source ?? '')) {
        throw new ValidationError('A document path and source (atlas or repo) are required');
      }
      let content: string;
      let canonicalPath: string;
      if (scope.source === 'repo') {
        content = await readProjectSourceDoc(project, scope.path);
        canonicalPath = scope.path;
      } else {
        canonicalPath = await resolveDocSelector(project, scope.path);
        content = (await readDocWithMeta(project, canonicalPath)).content;
      }
      const clipped = utf8Excerpt(content, 8192);
      scopeKey = `document:${scope.source}:${canonicalPath}`;
      scopeDescription = `${scope.source === 'repo' ? 'repository' : 'Atlas'} document ${canonicalPath}`;
      scopeContext = `${projectContext.text}\n\n## Selected ${scope.source === 'repo' ? 'repository' : 'Atlas'} document: ${canonicalPath}\n\n${clipped}${Buffer.byteLength(clipped, 'utf8') < Buffer.byteLength(content, 'utf8') ? '\n… [document excerpt]' : ''}`;
    } else if (scope.type !== 'project') {
      throw new ValidationError('Unsupported Codex scope');
    }
    const prompt = [
      `You are working in LocalAtlas project ${project.key} (${project.id}). Current scope: ${scopeDescription}.`,
      `LocalAtlas workspace: ${project.managedPath}`,
      `Source repository: ${project.sourcePath}`,
      'Use LocalAtlas CLI for Atlas tasks and documents. Refresh current state before changes, pass --project with this project UUID, use ETags when writing, and verify updates afterward.',
      'Never create task Markdown manually. For “clear tasks”, list this project’s tasks, then ask whether the user means cancel or permanently delete before acting.',
      'Repository documents are read-only context for LocalAtlas operations. Before source-code work, inspect AGENTS.md under the source repository and relevant subdirectories, then follow those instructions.',
      `LocalAtlas CLI launcher: ${join(project.managedPath, '.localatlas', 'bin', process.platform === 'win32' ? 'localatlas.cmd' : 'localatlas')}`,
      '',
      getAgentsMdSnippet(),
      '',
      '## Context at session start',
      scopeContext,
      '',
      'Check the live Markdown records with the CLI before making a task or document change; this launch context may become stale.',
    ].join('\n');
    const result = await terminalManager.startCodexOrAttach(project, {
      scopeKey,
      prompt,
      cols: body.cols,
      rows: body.rows,
      newSession: Boolean(body.newSession),
    });
    return c.json(result, 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/terminal/:sessionId/input', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Terminal is available only through localhost' }, 403);
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > 64_000) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { data?: string };
    if (typeof body?.data !== 'string' || !body.data) return c.json({ ok: true });
    const project = await selectProject(c.req.param('id'));
    terminalManager.write(project, c.req.param('sessionId'), body.data);
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/terminal/:sessionId/resize', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Terminal is available only through localhost' }, 403);
    }
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > 4_000) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { cols?: number; rows?: number };
    const project = await selectProject(c.req.param('id'));
    terminalManager.resize(project, c.req.param('sessionId'), Number(body.cols) || 100, Number(body.rows) || 28);
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/terminal/:sessionId/events', async c => {
  try {
    if (!isLocalCodexRequest(c.req.header('host') ?? '', c.req.header('origin'))) {
      return c.json({ error: 'Terminal is available only through localhost' }, 403);
    }
    const project = await selectProject(c.req.param('id'));
    const runtime = terminalManager.getRuntime(project, c.req.param('sessionId'));
    const rawCursor = c.req.header('last-event-id') ?? c.req.query('after') ?? '0';
    const parsedCursor = Number(rawCursor);
    if (!Number.isSafeInteger(parsedCursor) || parsedCursor < 0) return c.json({ error: 'Invalid event cursor' }, 400);
    return streamSSE(c, async stream => {
      type TermEv = ReturnType<typeof runtime.eventsAfter>[number];
      const events: TermEv[] = [];
      const waiters = new Set<{ resolve: (ev: TermEv | null) => void; timer: NodeJS.Timeout }>();
      let closed = false;
      const unsubscribe = runtime.subscribe(ev => {
        const waiter = waiters.values().next().value;
        if (waiter) {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(ev);
        } else if (!closed) {
          events.push(ev);
        }
      });
      const nextEvent = (timeoutMs: number): Promise<TermEv | null> => {
        const ev = events.shift();
        if (ev) return Promise.resolve(ev);
        if (closed) return Promise.resolve(null);
        return new Promise(resolve => {
          const waiter = {
            resolve,
            timer: setTimeout(() => {
              waiters.delete(waiter);
              resolve(null);
            }, timeoutMs),
          };
          waiters.add(waiter);
        });
      };
      let cursor = parsedCursor;
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        for (const w of waiters) {
          clearTimeout(w.timer);
          w.resolve(null);
        }
        waiters.clear();
      });
      for (const ev of runtime.eventsAfter(cursor)) {
        await stream.writeSSE({ id: String(ev.id), event: 'terminal', data: JSON.stringify(ev) });
        cursor = ev.id;
      }
      while (!stream.aborted) {
        const ev = await nextEvent(15_000);
        if (stream.aborted) break;
        if (!ev) {
          await stream.writeSSE({ event: 'keepalive', data: '{}' });
          continue;
        }
        if (ev.id <= cursor) continue;
        await stream.writeSSE({ id: String(ev.id), event: 'terminal', data: JSON.stringify(ev) });
        cursor = ev.id;
      }
      unsubscribe();
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/sessions', async c => {
  try {
    const project = await selectProject(c.req.param('id'));
    return c.json(await listAgentSessions(project, {
      taskId: c.req.query('task'),
      status: c.req.query('status') as any,
    }));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/sessions', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { taskId?: string | null; title?: string; resumeNote?: string; nextAction?: string };
    if (typeof body?.resumeNote !== 'string' || typeof body?.nextAction !== 'string') {
      return c.json({ error: 'resumeNote and nextAction required' }, 400);
    }
    return c.json(await createAgentSession(await selectProject(c.req.param('id')), body as { resumeNote: string; nextAction: string }), 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/sessions/:sessionId', async c => {
  try {
    return c.json(await readAgentSession(await selectProject(c.req.param('id')), c.req.param('sessionId')));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.patch('/api/projects/:id/sessions/:sessionId', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { status?: any; resumeNote?: string; nextAction?: string; ifMatch?: string };
    return c.json(await updateAgentSession(
      await selectProject(c.req.param('id')),
      c.req.param('sessionId'),
      { ...body, ifMatch: body.ifMatch ?? c.req.header('if-match') }
    ));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/docs', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const type = c.req.query('type');
    const status = c.req.query('status');
    const milestone = c.req.query('milestone');
    const epic = c.req.query('epic');
    if (type || status || milestone || epic || c.req.query('meta') === '1') {
      return c.json(await listDocsFiltered(proj, { type, status, milestone, epic }));
    }
    return c.json(await listDocs(proj));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/reindex', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    return c.json({ ok: true, ...(await reindexProject(proj)) });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/search', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const q = c.req.query('q') ?? '';
    const type = c.req.query('type');
    const status = c.req.query('status');
    const milestone = c.req.query('milestone');
    const epic = c.req.query('epic');
    const allProjects = c.req.query('allProjects') === 'true';
    return c.json(await searchDocs(proj, q, { type, status, milestone, epic, allProjects }));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/search', async c => {
  try {
    const q = c.req.query('q') ?? '';
    const type = c.req.query('type');
    const status = c.req.query('status');
    const milestone = c.req.query('milestone');
    const epic = c.req.query('epic');
    return c.json(await searchDocs(null, q, { type, status, milestone, epic, allProjects: true }));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/backlinks/*', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const target = extractWildcard(c.req.path, '/backlinks/');
    return c.json(await getBacklinks(proj, target));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/events', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const once = c.req.query('once') === '1';
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const initPayload = JSON.stringify({ type: 'connected', projectId: proj.id, seq: currentEventSeq() });
        controller.enqueue(encoder.encode(`data: ${initPayload}\n\n`));
        if (once) {
          controller.close();
          return;
        }
        unsubscribe = onProjectEvent(ev => {
          if (ev.projectId !== proj.id) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          } catch {
            unsubscribe?.();
          }
        });
      },
      cancel() {
        unsubscribe?.();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Content-Security-Policy': CSP_HEADER,
      },
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/docs-move', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as {
      from?: string;
      to?: string;
      ifMatch?: string;
      targetIfMatch?: string;
      overwrite?: boolean;
    };
    if (typeof body?.from !== 'string' || typeof body?.to !== 'string') {
      return c.json({ error: 'from and to paths required' }, 400);
    }
    const ifMatch = body.ifMatch ?? c.req.header('if-match');
    const proj = await selectProject(c.req.param('id'));
    const moved = await moveDoc(proj, body.from, body.to, {
      ifMatch,
      targetIfMatch: body.targetIfMatch,
      overwrite: Boolean(body.overwrite),
    });
    c.header('ETag', `"${moved.etag}"`);
    return c.json({ ok: true, ...moved });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/docs/*', async c => {
  try {
    const meta = await readDocWithMeta(await selectProject(c.req.param('id')), docName(c.req.path));
    c.header('ETag', `"${meta.etag}"`);
    c.header('X-Document-Path', meta.path);
    return c.text(meta.content);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/drafts/*', async c => {
  try {
    const project = await selectProject(c.req.param('id'));
    const draft = await readDocumentDraft(project, draftName(c.req.path));
    return draft ? c.json(draft) : c.json({ error: 'Draft not found' }, 404);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.put('/api/projects/:id/drafts/*', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024 + 4096) return c.json({ error: 'Draft exceeds the 2 MiB limit' }, 413);
    const body = JSON.parse(raw) as { content?: string; baseEtag?: string | null; isNewDoc?: boolean };
    const content = body.content;
    if (typeof content !== 'string') return c.json({ error: 'Draft content must be text' }, 400);
    const project = await selectProject(c.req.param('id'));
    return c.json(await writeDocumentDraft(project, draftName(c.req.path), { ...body, content }));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.delete('/api/projects/:id/drafts/*', async c => {
  try {
    const project = await selectProject(c.req.param('id'));
    await deleteDocumentDraft(project, draftName(c.req.path));
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.put('/api/projects/:id/docs/*', async c => {
  try {
    const text = await c.req.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const ifMatch = c.req.header('if-match');
    const ifNoneMatch = c.req.header('if-none-match');
    const createOnly = ifNoneMatch !== undefined && ifNoneMatch.trim() === '*';
    const result = await writeDoc(
      await selectProject(c.req.param('id')),
      docName(c.req.path),
      text,
      { ifMatch, createOnly }
    );
    c.header('ETag', `"${result.etag}"`);
    return c.json({ ok: true, etag: result.etag });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.patch('/api/projects/:id/docs/*', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as {
      set?: Record<string, string | string[] | null>;
      unset?: string[];
      ifMatch?: string;
    };
    const ifMatch = body.ifMatch ?? c.req.header('if-match');
    const proj = await selectProject(c.req.param('id'));
    const updated = await updateFrontmatter(proj, docName(c.req.path), body.set ?? {}, {
      ifMatch,
      unsetKeys: body.unset,
    });
    c.header('ETag', `"${updated.etag}"`);
    return c.json({ ok: true, ...updated });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.delete('/api/projects/:id/docs/*', async c => {
  try {
    const ifMatch = c.req.header('if-match');
    const proj = await selectProject(c.req.param('id'));
    const deleted = await deleteDoc(proj, docName(c.req.path), { ifMatch });
    return c.json({ ok: true, ...deleted });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/tasks', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const status = c.req.query('status');
    const priority = c.req.query('priority');
    const milestone = c.req.query('milestone');
    const epic = c.req.query('epic');
    const tasks = await listTasks(proj, { status, priority, milestone, epic });
    return c.json(tasks);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/tasks', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as {
      title?: string;
      status?: any;
      priority?: any;
      epic?: string | null;
      milestone?: string | null;
      dependsOn?: string[];
      body?: string;
      promotePath?: string;
      ifMatch?: string;
    };
    const proj = await selectProject(c.req.param('id'));
    if (body.promotePath) {
      const ifMatch = body.ifMatch ?? c.req.header('if-match');
      const promoted = await promoteNoteToTask(proj, body.promotePath, {
        priority: body.priority,
        status: body.status,
        epic: body.epic,
        milestone: body.milestone,
        ifMatch,
      });
      c.header('ETag', `"${promoted.etag}"`);
      return c.json(promoted, 201);
    }
    if (!body.title) return c.json({ error: 'Task title is required' }, 400);
    const created = await createTask(proj, {
      title: body.title,
      status: body.status,
      priority: body.priority,
      epic: body.epic,
      milestone: body.milestone,
      dependsOn: body.dependsOn,
      body: body.body,
    });
    c.header('ETag', `"${created.etag}"`);
    return c.json(created, 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/tasks/:taskId/documents', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    return c.json(await getTaskDocumentLinks(proj, c.req.param('taskId')));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.patch('/api/projects/:id/tasks/:taskId', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const parsedBody = JSON.parse(raw) as unknown;
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }
    const body = parsedBody as {
      status?: any;
      priority?: any;
      epic?: string | null;
      milestone?: string | null;
      title?: string;
      body?: string;
      ifMatch?: string;
    };
    const unsupported = Object.keys(body).filter(key => !TASK_PATCH_FIELDS.has(key));
    if (unsupported.length > 0) {
      const dependencyChange = unsupported.some(key => key === 'dependsOn' || key === 'dependencies');
      return c.json({
        error: dependencyChange
          ? 'Dependency changes must use POST /api/projects/:id/tasks/:taskId/proposals and be confirmed.'
          : `Unsupported task field(s): ${unsupported.join(', ')}`,
      }, 400);
    }
    const ifMatch = body.ifMatch ?? c.req.header('if-match');
    const proj = await selectProject(c.req.param('id'));
    const updated = await updateTask(proj, c.req.param('taskId'), {
      status: body.status,
      priority: body.priority,
      epic: body.epic,
      milestone: body.milestone,
      title: body.title,
      body: body.body,
      ifMatch,
    });
    c.header('ETag', `"${updated.etag}"`);
    return c.json(updated);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/rollup', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const rollup = await getProjectRollup(proj);
    return c.json(rollup);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/epics', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { title?: string; status?: any; milestone?: string | null; body?: string };
    if (!body?.title?.trim()) return c.json({ error: 'Epic title is required' }, 400);
    const proj = await selectProject(c.req.param('id'));
    const created = await createEpic(proj, {
      title: body.title,
      status: body.status,
      milestone: body.milestone,
      body: body.body,
    });
    c.header('ETag', `"${created.etag}"`);
    return c.json(created, 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.patch('/api/projects/:id/epics/:epicId', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { title?: string; status?: any; milestone?: string | null; ifMatch?: string };
    const proj = await selectProject(c.req.param('id'));
    const updated = await updateEpic(proj, c.req.param('epicId'), {
      title: body.title, status: body.status, milestone: body.milestone,
      ifMatch: body.ifMatch ?? c.req.header('if-match'),
    });
    c.header('ETag', `"${updated.etag}"`);
    return c.json(updated);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/milestones', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { title?: string; status?: any; targetDate?: string | null; body?: string };
    if (!body?.title?.trim()) return c.json({ error: 'Milestone title is required' }, 400);
    const proj = await selectProject(c.req.param('id'));
    const created = await createMilestone(proj, {
      title: body.title,
      status: body.status,
      targetDate: body.targetDate,
      body: body.body,
    });
    c.header('ETag', `"${created.etag}"`);
    return c.json(created, 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.patch('/api/projects/:id/milestones/:milestoneId', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { title?: string; status?: any; targetDate?: string | null; ifMatch?: string };
    const proj = await selectProject(c.req.param('id'));
    const updated = await updateMilestone(proj, c.req.param('milestoneId'), {
      title: body.title, status: body.status, targetDate: body.targetDate,
      ifMatch: body.ifMatch ?? c.req.header('if-match'),
    });
    c.header('ETag', `"${updated.etag}"`);
    return c.json(updated);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/profile', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const profile = await readProjectProfile(proj);
    if (profile.etag) c.header('ETag', `"${profile.etag}"`);
    return c.json(profile);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.put('/api/projects/:id/profile', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { status?: any; goals?: string; keyDocs?: string[]; ifMatch?: string };
    const ifMatch = body.ifMatch ?? c.req.header('if-match');
    const proj = await selectProject(c.req.param('id'));
    const updated = await updateProjectProfile(proj, {
      status: body.status,
      goals: body.goals,
      keyDocs: body.keyDocs,
      ifMatch,
    });
    if (updated.etag) c.header('ETag', `"${updated.etag}"`);
    return c.json(updated);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/profile/decisions', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { summary?: string; rationale?: string; links?: string[]; ifMatch?: string };
    const ifMatch = body.ifMatch ?? c.req.header('if-match');
    const proj = await selectProject(c.req.param('id'));
    const recorded = await recordProjectDecision(proj, {
      summary: body.summary ?? '',
      rationale: body.rationale,
      links: body.links,
      ifMatch,
    });
    if (recorded.profile.etag) c.header('ETag', `"${recorded.profile.etag}"`);
    return c.json(recorded, 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/tasks/:taskId/impact', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const proj = await selectProject(c.req.param('id'));
    const preview = await previewTaskImpact(proj, c.req.param('taskId'), body as any);
    return c.json(preview);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/tasks/:taskId/proposals', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const proj = await selectProject(c.req.param('id'));
    const proposal = await createTaskChangeProposal(proj, c.req.param('taskId'), body as any);
    c.header('ETag', `"${proposal.etag}"`);
    return c.json(proposal, 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/proposals', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    const taskId = c.req.query('task');
    const status = c.req.query('status') as any;
    return c.json(await listTaskChangeProposals(proj, { taskId, status }));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/proposals/:proposalId', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    return c.json(await readTaskChangeProposal(proj, c.req.param('proposalId')));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/proposals/:proposalId/confirm', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = raw.trim() ? (JSON.parse(raw) as { confirmed?: boolean; ifMatch?: string; taskIfMatch?: string }) : {};
    const proj = await selectProject(c.req.param('id'));
    const confirmed = await confirmTaskChangeProposal(proj, c.req.param('proposalId'), {
      confirmed: body.confirmed,
      ifMatch: body.ifMatch ?? c.req.header('if-match'),
      taskIfMatch: body.taskIfMatch,
    });
    return c.json(confirmed);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/proposals/:proposalId/reject', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = raw.trim() ? (JSON.parse(raw) as { reason?: string; ifMatch?: string }) : {};
    const proj = await selectProject(c.req.param('id'));
    const rejected = await rejectTaskChangeProposal(proj, c.req.param('proposalId'), {
      reason: body.reason,
      ifMatch: body.ifMatch ?? c.req.header('if-match'),
    });
    return c.json(rejected);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/recaps', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    return c.json(await listProjectRecaps(proj));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/projects/:id/recaps', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = raw.trim() ? (JSON.parse(raw) as { save?: boolean }) : {};
    const proj = await selectProject(c.req.param('id'));
    const draft = await generateProjectRecapDraft(proj, { save: Boolean(body.save) });
    if (draft.etag) c.header('ETag', `"${draft.etag}"`);
    return c.json(draft, body.save ? 201 : 200);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/recaps/:recapId', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    return c.json(await readProjectRecap(proj, c.req.param('recapId')));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/portfolio/summary', async c => {
  try {
    return c.json(await getPortfolioSummary());
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/portfolio/attention', async c => {
  try {
    return c.json(await getPortfolioAttention());
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/templates', c => {
  return c.json(listDocTemplates());
});

app.post('/api/projects/:id/templates/apply', async c => {
  try {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const body = JSON.parse(raw) as { templateId?: string; path?: string; title?: string; docId?: string; status?: string };
    if (typeof body?.templateId !== 'string' || typeof body?.path !== 'string') {
      return c.json({ error: 'templateId and path required' }, 400);
    }
    const proj = await selectProject(c.req.param('id'));
    const created = await createDocFromTemplate(proj, {
      templateId: body.templateId,
      path: body.path,
      title: body.title,
      docId: body.docId,
      status: body.status,
    });
    c.header('ETag', `"${created.etag}"`);
    return c.json(created, 201);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/traceability', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    return c.json(await getProjectTaskTraceability(proj));
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/projects/:id/traceability/history', async c => {
  try {
    const taskId = c.req.query('task');
    if (!taskId) return c.json({ error: 'task query parameter is required' }, 400);
    const parseInteger = (value: string | undefined, fallback: number, name: string): number => {
      if (value === undefined) return fallback;
      if (!/^\d+$/.test(value)) throw new ValidationError(`${name} must be an integer`);
      return Number(value);
    };
    const sinceDays = parseInteger(c.req.query('days'), 365, 'days');
    const limit = parseInteger(c.req.query('limit'), 50, 'limit');
    const project = await selectProject(c.req.param('id'));
    return c.json(await searchTaskGitHistory(project, taskId, { sinceDays, limit }));
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.get('/api/projects/:id/health', async c => {
  try {
    const proj = await selectProject(c.req.param('id'));
    return c.json(await analyzeProjectHealth(proj));
  } catch (e) {
    return errorResponse(c, e);
  }
});

const publicRoot = fileURLToPath(new URL('../public', import.meta.url));
app.use('/*', serveStatic({ root: publicRoot }));
