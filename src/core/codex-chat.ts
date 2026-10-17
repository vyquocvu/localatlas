import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { Project } from './types.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;
type JsonRpcFrame = JsonObject & { id?: JsonRpcId; method?: string; params?: JsonObject; result?: unknown; error?: { message?: string; code?: number } };
type PendingRpc = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export type CodexChatMessage = { id: string; role: 'user' | 'assistant'; text: string };
export type CodexChatEvent = { id: number; type: string; data: JsonObject; createdAt: string };

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export class JsonRpcPeer {
  private nextId = 1;
  private buffer = '';
  private closed = false;
  private readonly pending = new Map<string, PendingRpc>();
  private notificationHandler: (frame: JsonRpcFrame) => void = () => {};
  private requestHandler: (frame: JsonRpcFrame) => void = () => {};
  private failureHandler: (error: Error) => void = () => {};

  constructor(private readonly sendLine: (line: string) => void) {}

  onNotification(handler: (frame: JsonRpcFrame) => void): void { this.notificationHandler = handler; }
  onServerRequest(handler: (frame: JsonRpcFrame) => void): void { this.requestHandler = handler; }
  onFailure(handler: (error: Error) => void): void { this.failureHandler = handler; }

  request<T = any>(method: string, params: JsonObject = {}, timeoutMs = 60_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Codex app-server is not running'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timer });
      try {
        this.sendLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(String(id));
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: JsonObject): void {
    if (this.closed) throw new Error('Codex app-server is not running');
    this.sendLine(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }));
  }

  respond(id: JsonRpcId, result: JsonObject): void {
    if (this.closed) throw new Error('Codex app-server is not running');
    this.sendLine(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    if (this.closed) return;
    this.sendLine(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  }

  receive(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        let frame: JsonRpcFrame;
        try {
          frame = JSON.parse(line) as JsonRpcFrame;
        } catch {
          this.fail(new Error('Codex app-server sent invalid JSON'));
          return;
        }
        this.dispatch(frame);
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.failureHandler(error);
  }

  private dispatch(frame: JsonRpcFrame): void {
    if (frame.id !== undefined && typeof frame.method === 'string') {
      this.requestHandler(frame);
      return;
    }
    if (frame.id !== undefined) {
      const pending = this.pending.get(String(frame.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(String(frame.id));
      if (frame.error) pending.reject(new Error(frame.error.message || 'Codex app-server request failed'));
      else pending.resolve(frame.result);
      return;
    }
    if (typeof frame.method === 'string') this.notificationHandler(frame);
  }
}

class CodexAppServerProcess {
  readonly peer: JsonRpcPeer;
  private readonly child: ChildProcessWithoutNullStreams;
  private stderr = '';
  private closing = false;

  constructor(cwd: string) {
    this.child = spawn('codex', ['app-server', '--stdio'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.peer = new JsonRpcPeer(line => {
      if (!this.child.stdin.writable) throw new Error('Codex app-server input is closed');
      this.child.stdin.write(`${line}\n`);
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.peer.receive(String(chunk)));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => {
      this.stderr = (this.stderr + String(chunk)).slice(-8_000);
    });
    this.child.once('error', error => {
      const detail = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'Codex CLI was not found on the LocalAtlas server PATH'
        : error.message;
      this.peer.fail(new Error(detail));
    });
    this.child.once('close', code => {
      if (!this.closing) {
        const detail = this.stderr.trim() || `Codex app-server exited with status ${code ?? 'unknown'}`;
        this.peer.fail(new Error(detail));
      }
    });
  }

  async initialize(): Promise<void> {
    await this.peer.request('initialize', {
      clientInfo: { name: 'localatlas', title: 'LocalAtlas', version: '0.1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.peer.notify('initialized');
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.peer.fail(new Error('Codex chat process stopped'));
    this.child.kill();
  }
}

type PendingApproval = { id: JsonRpcId; method: string; params: JsonObject };
type ProjectRuntime = {
  projectId: string;
  sourcePath: string;
  threadId: string;
  server: CodexAppServerProcess;
  sequence: number;
  events: CodexChatEvent[];
  listeners: Set<(event: CodexChatEvent) => void>;
  pendingApprovals: Map<string, PendingApproval>;
  activeTurnId: string | null;
  busy: boolean;
  closed: boolean;
};

function turnsToMessages(turns: unknown): CodexChatMessage[] {
  if (!Array.isArray(turns)) return [];
  const messages: CodexChatMessage[] = [];
  for (const rawTurn of [...turns].reverse()) {
    const turn = asObject(rawTurn);
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const rawItem of items) {
      const item = asObject(rawItem);
      if (item.type === 'userMessage') {
        const content = Array.isArray(item.content) ? item.content : [];
        const text = content.map(part => {
          const input = asObject(part);
          if (input.type === 'text') return String(input.text ?? '');
          if (input.type === 'image' || input.type === 'localImage') return '[image attached]';
          return '';
        }).filter(Boolean).join('\n');
        if (text) messages.push({ id: String(item.id ?? randomUUID()), role: 'user', text });
      } else if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text) {
        messages.push({ id: String(item.id ?? randomUUID()), role: 'assistant', text: item.text });
      }
    }
  }
  return messages.slice(-100);
}

function runtimeHistory(runtime: ProjectRuntime): CodexChatEvent[] {
  return runtime.events.filter(event => event.type !== 'approval-request' || runtime.pendingApprovals.has(String(event.data.requestId)));
}

function publish(runtime: ProjectRuntime, type: string, data: JsonObject): void {
  if (runtime.closed) return;
  const event: CodexChatEvent = {
    id: ++runtime.sequence,
    type,
    data,
    createdAt: new Date().toISOString(),
  };
  runtime.events.push(event);
  if (runtime.events.length > 500) runtime.events.splice(0, runtime.events.length - 500);
  for (const listener of runtime.listeners) listener(event);
}

function attachRuntimeHandlers(runtime: ProjectRuntime): void {
  const peer = runtime.server.peer;
  peer.onNotification(frame => {
    const params = asObject(frame.params);
    if (typeof params.threadId === 'string' && params.threadId !== runtime.threadId) return;
    switch (frame.method) {
      case 'item/agentMessage/delta':
        publish(runtime, 'assistant-delta', params);
        break;
      case 'turn/started': {
        const turn = asObject(params.turn);
        runtime.activeTurnId = typeof turn.id === 'string' ? turn.id : null;
        runtime.busy = true;
        publish(runtime, 'turn-started', { turnId: runtime.activeTurnId ?? '' });
        break;
      }
      case 'turn/completed': {
        const turn = asObject(params.turn);
        runtime.busy = false;
        runtime.activeTurnId = null;
        publish(runtime, 'turn-completed', {
          turnId: typeof turn.id === 'string' ? turn.id : '',
          status: String(turn.status ?? 'completed'),
          error: asObject(turn.error),
        });
        break;
      }
      case 'item/started':
        publish(runtime, 'item-started', asObject(params.item));
        break;
      case 'item/completed':
        publish(runtime, 'item-completed', asObject(params.item));
        break;
      case 'item/commandExecution/outputDelta':
        publish(runtime, 'command-output', params);
        break;
      case 'thread/status/changed': {
        const status = asObject(params.status);
        runtime.busy = status.type === 'active';
        publish(runtime, 'status', { busy: runtime.busy, status: String(status.type ?? 'unknown') });
        break;
      }
      case 'error':
        publish(runtime, 'error', { message: errorText(asObject(params.error).message ?? 'Codex reported an error') });
        break;
      default:
        break;
    }
  });

  peer.onServerRequest(frame => {
    const params = asObject(frame.params);
    if (params.threadId !== runtime.threadId || frame.id === undefined || !frame.method) return;
    if (frame.method === 'item/commandExecution/requestApproval' || frame.method === 'item/fileChange/requestApproval') {
      const key = String(frame.id);
      runtime.pendingApprovals.set(key, { id: frame.id, method: frame.method, params });
      const commandActions = Array.isArray(params.commandActions) ? params.commandActions : [];
      const command = typeof params.command === 'string'
        ? params.command
        : commandActions.map(action => String(asObject(action).command ?? '')).filter(Boolean).join('\n');
      publish(runtime, 'approval-request', {
        requestId: key,
        kind: frame.method === 'item/fileChange/requestApproval' ? 'file-change' : 'command',
        command,
        cwd: String(params.cwd ?? runtime.sourcePath),
        reason: String(params.reason ?? ''),
        availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : ['accept', 'decline'],
      });
      return;
    }
    publish(runtime, 'unsupported-request', { method: frame.method });
    peer.respondError(frame.id, -32601, 'This Codex app-server request is not supported in the LocalAtlas chat yet');
  });

  peer.onFailure(error => {
    if (runtime.closed) return;
    runtime.busy = false;
    runtime.closed = true;
    publish(runtime, 'error', { message: error.message });
  });
}

function extractTurns(response: JsonObject): unknown[] {
  const initial = asObject(response.initialTurnsPage);
  return Array.isArray(initial.data) ? initial.data : [];
}

export class CodexChatManager {
  private readonly byProject = new Map<string, ProjectRuntime>();

  async start(project: Project, contextText: string): Promise<{ threadId: string; messages: CodexChatMessage[]; busy: boolean; eventSeq: number }> {
    const sourcePath = await this.projectSourcePath(project);
    this.stopProject(project.id);
    const server = new CodexAppServerProcess(sourcePath);
    try {
      await server.initialize();
      const context = contextText.trim().slice(0, 16_000);
      const response = asObject(await server.peer.request('thread/start', {
        cwd: sourcePath,
        threadSource: 'localatlas',
        historyMode: 'paginated',
        developerInstructions: [
          `You are chatting with the user in LocalAtlas about project ${project.key} (${project.name}). The working directory is ${sourcePath}. Keep this conversation scoped to this project.`,
          context ? `Bounded project context from LocalAtlas follows. Treat it as a snapshot and inspect current repository files when needed.\n\n${context}` : '',
        ].filter(Boolean).join('\n\n'),
      }));
      const thread = asObject(response.thread);
      const threadId = typeof thread.id === 'string' ? thread.id : '';
      if (!threadId) throw new Error('Codex app-server did not return a thread ID');
      const returnedCwd = typeof thread.cwd === 'string' ? thread.cwd : typeof response.cwd === 'string' ? response.cwd : '';
      if (returnedCwd && await realpath(returnedCwd) !== sourcePath) {
        throw new ValidationError('Codex started this conversation in a different project folder');
      }
      const runtime = this.createRuntime(project, sourcePath, threadId, server, asObject(thread.status).type === 'active');
      this.byProject.set(project.id, runtime);
      return { threadId, messages: turnsToMessages(thread.turns), busy: runtime.busy, eventSeq: runtime.sequence };
    } catch (error) {
      server.close();
      throw error;
    }
  }

  async resume(project: Project, threadId: string): Promise<{ threadId: string; messages: CodexChatMessage[]; busy: boolean; eventSeq: number }> {
    if (!/^[0-9a-f-]{32,40}$/i.test(threadId)) throw new ValidationError('Invalid Codex thread ID');
    const sourcePath = await this.projectSourcePath(project);
    const existing = this.byProject.get(project.id);
    if (existing?.threadId === threadId && existing.sourcePath === sourcePath && !existing.closed) {
      const response = asObject(await existing.server.peer.request('thread/turns/list', {
        threadId,
        limit: 30,
        sortDirection: 'desc',
        itemsView: 'full',
      }));
      return { threadId, messages: turnsToMessages(response.data), busy: existing.busy, eventSeq: existing.sequence };
    }
    if (existing) this.stopProject(project.id);
    const server = new CodexAppServerProcess(sourcePath);
    try {
      await server.initialize();
      const response = asObject(await server.peer.request('thread/resume', {
        threadId,
        initialTurnsPage: { limit: 30, sortDirection: 'desc', itemsView: 'full' },
      }));
      const thread = asObject(response.thread);
      const resolvedCwd = typeof response.cwd === 'string' ? await realpath(response.cwd) : '';
      if (resolvedCwd !== sourcePath) {
        throw new ValidationError('This Codex conversation belongs to a different project folder. Start a new chat for this project.');
      }
      if (typeof thread.id !== 'string' || thread.id !== threadId) throw new NotFoundError('Codex conversation not found');
      const runtime = this.createRuntime(project, sourcePath, threadId, server, asObject(thread.status).type === 'active');
      this.byProject.set(project.id, runtime);
      return { threadId, messages: turnsToMessages(extractTurns(response)), busy: runtime.busy, eventSeq: runtime.sequence };
    } catch (error) {
      server.close();
      throw error;
    }
  }

  async startTurn(project: Project, threadId: string, text: string): Promise<{ turnId: string | null }> {
    const runtime = this.requireRuntime(project, threadId);
    if (runtime.busy) throw new ConflictError('Codex is already working on this project chat');
    const result = asObject(await runtime.server.peer.request('turn/start', {
      threadId,
      input: [{ type: 'text', text, text_elements: [] }],
      turnTrigger: 'user',
    }));
    const turn = asObject(result.turn);
    runtime.activeTurnId = typeof turn.id === 'string' ? turn.id : null;
    runtime.busy = true;
    return { turnId: runtime.activeTurnId };
  }

  approve(project: Project, threadId: string, requestId: string, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel'): void {
    const runtime = this.requireRuntime(project, threadId);
    const approval = runtime.pendingApprovals.get(requestId);
    if (!approval) throw new NotFoundError('Codex approval request is no longer pending');
    runtime.server.peer.respond(approval.id, { decision });
    runtime.pendingApprovals.delete(requestId);
  }

  getRuntime(project: Project, threadId: string): {
    eventsAfter: (id: number) => CodexChatEvent[];
    subscribe: (listener: (event: CodexChatEvent) => void) => () => void;
  } {
    const runtime = this.requireRuntime(project, threadId);
    return {
      eventsAfter: id => runtimeHistory(runtime).filter(event => event.id > id),
      subscribe: listener => {
        runtime.listeners.add(listener);
        return () => runtime.listeners.delete(listener);
      },
    };
  }

  stopProject(projectId: string): void {
    const runtime = this.byProject.get(projectId);
    if (!runtime) return;
    runtime.closed = true;
    this.byProject.delete(projectId);
    runtime.server.close();
  }

  closeAll(): void {
    for (const projectId of this.byProject.keys()) this.stopProject(projectId);
  }

  private requireRuntime(project: Project, threadId: string): ProjectRuntime {
    const runtime = this.byProject.get(project.id);
    if (!runtime || runtime.closed || runtime.threadId !== threadId) {
      throw new NotFoundError('Codex chat is not active. Resume it before sending a message.');
    }
    if (runtime.sourcePath !== project.sourcePath) {
      this.stopProject(project.id);
      throw new ValidationError('Project path changed. Resume the chat from the updated project path.');
    }
    return runtime;
  }

  private async projectSourcePath(project: Project): Promise<string> {
    try {
      const sourcePath = await realpath(project.sourcePath);
      if (!(await stat(sourcePath)).isDirectory()) throw new ValidationError('Registered project path is not a directory');
      return sourcePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new NotFoundError(`Project directory no longer exists: ${project.sourcePath}`);
      }
      throw error;
    }
  }

  private createRuntime(
    project: Project,
    sourcePath: string,
    threadId: string,
    server: CodexAppServerProcess,
    busy: boolean,
  ): ProjectRuntime {
    const runtime: ProjectRuntime = {
      projectId: project.id,
      sourcePath,
      threadId,
      server,
      sequence: 0,
      events: [],
      listeners: new Set(),
      pendingApprovals: new Map(),
      activeTurnId: null,
      busy,
      closed: false,
    };
    attachRuntimeHandlers(runtime);
    return runtime;
  }
}

export const codexChatManager = new CodexChatManager();
process.once('exit', () => codexChatManager.closeAll());

