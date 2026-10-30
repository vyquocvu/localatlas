import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import type { Project } from './types.js';
import { NotFoundError, ValidationError } from './errors.js';
import { assertNoSymlinkChain, home } from './paths.js';
import { atomicWrite } from './lock.js';

export type TerminalEvent = {
  id: number;
  type: 'output' | 'exit';
  data: string;
  exitCode?: number | null;
  createdAt: string;
};

export function assertTerminalPlatform(platform = process.platform): void {
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new ValidationError('Interactive terminals are currently supported on macOS and Linux only.');
  }
}

export type TerminalAgentId = 'codex' | 'claude' | 'qoder';

export const TERMINAL_AGENTS: readonly TerminalAgentId[] = ['codex', 'claude', 'qoder'];

export function isTerminalAgentId(value: unknown): value is TerminalAgentId {
  return typeof value === 'string' && (TERMINAL_AGENTS as readonly string[]).includes(value);
}

type AgentSpec = {
  label: string;
  bin: string;
  buildArgs: (sourcePath: string, prompt: string) => string[];
  notFound: string;
};

const AGENT_SPECS: Record<TerminalAgentId, AgentSpec> = {
  codex: {
    label: 'Codex',
    bin: 'codex',
    buildArgs: (sourcePath, prompt) => ['--sandbox', 'workspace-write', '--add-dir', sourcePath, prompt],
    notFound: 'Codex CLI was not found. Install Codex CLI or add it to the app PATH, then restart LocalAtlas.',
  },
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    buildArgs: (sourcePath, prompt) => ['--add-dir', sourcePath, prompt],
    notFound: 'Claude Code CLI was not found. Install Claude Code (`claude`) or add it to the app PATH, then restart LocalAtlas.',
  },
  qoder: {
    label: 'Qoder CLI',
    bin: 'qodercli',
    buildArgs: (sourcePath, prompt) => ['--add-dir', sourcePath, prompt],
    notFound: 'Qoder CLI was not found. Install Qoder CLI (`qodercli`) or add it to the app PATH, then restart LocalAtlas.',
  },
};

function ptyLocaleEnvironment(): NodeJS.ProcessEnv {
  const isUtf8Locale = (value: string | undefined) => Boolean(value && /UTF-?8/i.test(value));
  const locale = [process.env.LC_ALL, process.env.LC_CTYPE, process.env.LANG].find(isUtf8Locale)
    ?? (process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8');
  return { LANG: locale, LC_CTYPE: locale, LC_ALL: locale };
}

// When LocalAtlas runs under the Qoder Desktop agent runtime, these harness vars are
// inherited. Leaking them into a spawned `qodercli` makes it expect SDK stream-json flags
// and abort with `sdk_invalid_args` instead of starting interactively.
const QODER_SDK_ENV_PATTERN = /^QODER_(?:AGENT_)?SDK_/;

function withoutQoderSdkHarness(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(cleaned)) {
    if (QODER_SDK_ENV_PATTERN.test(key)) delete cleaned[key];
  }
  return cleaned;
}

type TerminalSession = {
  sessionId: string;
  projectId: string;
  kind: 'shell' | 'agent';
  agent?: TerminalAgentId;
  scopeKey: string;
  managedPath: string;
  sourcePath: string;
  child: ChildProcessWithoutNullStreams;
  cols: number;
  rows: number;
  sequence: number;
  events: TerminalEvent[];
  listeners: Set<(event: TerminalEvent) => void>;
  closed: boolean;
};

const PTY_BRIDGE_SCRIPT = `
import os, sys, pty, select, struct, fcntl, termios, json, base64, signal

cols = int(sys.argv[1]) if len(sys.argv) > 1 else 100
rows = int(sys.argv[2]) if len(sys.argv) > 2 else 28
cmd = sys.argv[3:] if len(sys.argv) > 3 else [os.environ.get("SHELL", "/bin/zsh"), "-l"]

pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.environ["COLORTERM"] = "truecolor"
    try:
        os.execvp(cmd[0], cmd)
    except Exception as e:
        os.write(2, f"Failed to exec {cmd[0]}: {e}\\r\\n".encode("utf-8"))
        os._exit(1)

def set_winsize(f, r, c):
    try:
        fcntl.ioctl(f, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
    except Exception:
        pass

set_winsize(fd, rows, cols)

stdin_fd = sys.stdin.fileno()
in_buf = b""

while True:
    try:
        rlist, _, _ = select.select([fd, stdin_fd], [], [])
    except Exception:
        break

    if fd in rlist:
        try:
            data = os.read(fd, 8192)
            if not data:
                break
            msg = json.dumps({"type": "output", "data": base64.b64encode(data).decode("ascii")}) + "\\n"
            sys.stdout.write(msg)
            sys.stdout.flush()
        except OSError:
            break

    if stdin_fd in rlist:
        try:
            chunk = os.read(stdin_fd, 8192)
            if not chunk:
                break
            in_buf += chunk
            while b"\\n" in in_buf:
                line, in_buf = in_buf.split(b"\\n", 1)
                if not line:
                    continue
                try:
                    pkt = json.loads(line.decode("utf-8"))
                    ptype = pkt.get("type")
                    if ptype == "input":
                        raw = base64.b64decode(pkt.get("data", ""))
                        if raw:
                            os.write(fd, raw)
                    elif ptype == "resize":
                        c = max(20, min(400, int(pkt.get("cols", 100))))
                        r = max(5, min(200, int(pkt.get("rows", 28))))
                        set_winsize(fd, r, c)
                        try:
                            os.kill(pid, signal.SIGWINCH)
                        except Exception:
                            pass
                except Exception:
                    pass
        except OSError:
            break

try:
    os.close(fd)
except Exception:
    pass

exit_code = 0
try:
    _, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        exit_code = os.WEXITSTATUS(status)
except Exception:
    pass

sys.stdout.write(json.dumps({"type": "exit", "exitCode": exit_code}) + "\\n")
sys.stdout.flush()
`;

function publish(session: TerminalSession, type: 'output' | 'exit', data: string, exitCode?: number | null): void {
  if (session.closed && type !== 'exit') return;
  const event: TerminalEvent = {
    id: ++session.sequence,
    type,
    data,
    exitCode,
    createdAt: new Date().toISOString(),
  };
  session.events.push(event);
  if (session.events.length > 600) {
    session.events.splice(0, session.events.length - 600);
  }
  for (const listener of session.listeners) {
    listener(event);
  }
}

export class TerminalManager {
  private readonly byProject = new Map<string, TerminalSession>();
  private readonly bySession = new Map<string, TerminalSession>();
  private readonly agentByScope = new Map<string, TerminalSession>();

  constructor(private readonly executableOverrides: Partial<Record<TerminalAgentId, string>> = {}) {}

  async startOrAttach(
    project: Project,
    options?: { cols?: number; rows?: number; restart?: boolean; initialCommand?: string }
  ): Promise<{ sessionId: string; cwd: string; cols: number; rows: number; eventSeq: number }> {
    assertTerminalPlatform();
    const directories = await this.projectDirectories(project);
    const existing = this.byProject.get(project.id);
    const cols = Math.max(20, Math.min(400, Number(options?.cols) || 100));
    const rows = Math.max(5, Math.min(200, Number(options?.rows) || 28));

    if (existing && !existing.closed && existing.sourcePath === directories.sourcePath && existing.managedPath === directories.managedPath && !options?.restart) {
      if (options?.cols && options?.rows) {
        this.resize(project, existing.sessionId, cols, rows);
      }
      if (options?.initialCommand) {
        this.write(project, existing.sessionId, `${options.initialCommand}\r`);
      }
      return {
        sessionId: existing.sessionId,
        cwd: existing.managedPath,
        cols: existing.cols,
        rows: existing.rows,
        eventSeq: existing.sequence,
      };
    }

    if (existing) {
      this.stopProject(project.id);
    }

    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const launcher = await this.ensureCliLauncher(project, directories.managedPath);
    const env = {
      ...withoutQoderSdkHarness(process.env),
      ...ptyLocaleEnvironment(),
      PATH: `${join(directories.managedPath, '.localatlas', 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LOCALATLAS_PROJECT_ID: project.id,
      LOCALATLAS_PROJECT_KEY: project.key,
      LOCALATLAS_PROJECT_NAME: project.name,
      LOCALATLAS_SOURCE_PATH: directories.sourcePath,
      LOCALATLAS_CLI: launcher,
    };
    const session = this.spawnPty(project, directories, cols, rows, [shell, '-l'], env, 'shell', 'project');
    this.byProject.set(project.id, session);

    if (options?.initialCommand) {
      setTimeout(() => {
        if (!session.closed) {
          this.write(project, session.sessionId, `${options.initialCommand}\r`);
        }
      }, 250);
    }

    return {
      sessionId: session.sessionId,
      cwd: session.managedPath,
      cols: session.cols,
      rows: session.rows,
      eventSeq: 0,
    };
  }

  async startAgentOrAttach(
    project: Project,
    options: { agent: TerminalAgentId; scopeKey: string; prompt: string; cols?: number; rows?: number; newSession?: boolean }
  ): Promise<{ sessionId: string; cwd: string; cols: number; rows: number; eventSeq: number; scopeKey: string; agent: TerminalAgentId }> {
    assertTerminalPlatform();
    const spec = AGENT_SPECS[options.agent];
    if (!spec) throw new ValidationError('Unsupported terminal agent');
    const directories = await this.projectDirectories(project);
    const scopeId = `${project.id}:${options.agent}:${options.scopeKey}`;
    const existing = this.agentByScope.get(scopeId);
    if (existing && !existing.closed && !options.newSession) {
      return { sessionId: existing.sessionId, cwd: existing.managedPath, cols: existing.cols, rows: existing.rows, eventSeq: existing.sequence, scopeKey: options.scopeKey, agent: options.agent };
    }
    if (existing) this.stopSession(existing);
    const executable = await this.findAgentExecutable(options.agent);
    const launcher = await this.ensureCliLauncher(project, directories.managedPath);
    const cols = Math.max(20, Math.min(400, Number(options.cols) || 100));
    const rows = Math.max(5, Math.min(200, Number(options.rows) || 28));
    const env = {
      ...withoutQoderSdkHarness(process.env),
      ...ptyLocaleEnvironment(),
      PATH: `${join(directories.managedPath, '.localatlas', 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      LOCALATLAS_PROJECT_ID: project.id,
      LOCALATLAS_PROJECT_KEY: project.key,
      LOCALATLAS_PROJECT_NAME: project.name,
      LOCALATLAS_SOURCE_PATH: directories.sourcePath,
      LOCALATLAS_CLI: launcher,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };
    const args = spec.buildArgs(directories.sourcePath, options.prompt);
    const session = this.spawnPty(project, directories, cols, rows, [executable, ...args], env, 'agent', options.scopeKey, options.agent);
    this.agentByScope.set(scopeId, session);
    return { sessionId: session.sessionId, cwd: session.managedPath, cols, rows, eventSeq: 0, scopeKey: options.scopeKey, agent: options.agent };
  }

  private spawnPty(
    project: Project,
    directories: { managedPath: string; sourcePath: string },
    cols: number,
    rows: number,
    command: string[],
    env: NodeJS.ProcessEnv,
    kind: 'shell' | 'agent',
    scopeKey: string,
    agent?: TerminalAgentId,
  ): TerminalSession {
    const child = spawn('python3', ['-u', '-c', PTY_BRIDGE_SCRIPT, String(cols), String(rows), ...command], {
      cwd: directories.managedPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    }) as ChildProcessWithoutNullStreams;
    const session: TerminalSession = {
      sessionId: randomUUID(), projectId: project.id, kind, agent, scopeKey,
      managedPath: directories.managedPath, sourcePath: directories.sourcePath,
      child, cols, rows, sequence: 0, events: [], listeners: new Set(), closed: false,
    };
    let buffer = '';
    const outputDecoder = new StringDecoder('utf8');
    let outputDecoderEnded = false;
    const flushOutputDecoder = () => {
      if (outputDecoderEnded) return;
      outputDecoderEnded = true;
      const remainder = outputDecoder.end();
      if (remainder) publish(session, 'output', remainder);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += String(chunk);
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const msg = JSON.parse(line) as { type?: string; data?: string; exitCode?: number };
            if (msg.type === 'output' && typeof msg.data === 'string') {
              const decoded = outputDecoder.write(Buffer.from(msg.data, 'base64'));
              if (decoded) publish(session, 'output', decoded);
            } else if (msg.type === 'exit') {
              flushOutputDecoder();
              session.closed = true;
              publish(session, 'exit', '', msg.exitCode ?? 0);
            }
          } catch { /* ignore malformed PTY bridge frames */ }
        }
        newline = buffer.indexOf('\n');
      }
    });
    child.once('close', code => {
      if (!session.closed) {
        flushOutputDecoder();
        session.closed = true;
        publish(session, 'exit', '', code ?? 0);
      }
    });
    this.bySession.set(session.sessionId, session);
    return session;
  }

  private async findAgentExecutable(agent: TerminalAgentId): Promise<string> {
    const override = this.executableOverrides[agent];
    if (override) return override;
    const spec = AGENT_SPECS[agent];
    const names = process.platform === 'win32' ? [`${spec.bin}.exe`, `${spec.bin}.cmd`] : [spec.bin];
    const directories = [...(process.env.PATH ?? '').split(delimiter), join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
    for (const dir of directories) for (const name of names) {
      const candidate = join(dir, name);
      try {
        await access(candidate, constants.X_OK);
        if ((await stat(candidate)).isFile()) return candidate;
      } catch { /* try next candidate */ }
    }
    throw new NotFoundError(spec.notFound);
  }

  private async ensureCliLauncher(project: Project, managedPath: string): Promise<string> {
    const binDir = join(managedPath, '.localatlas', 'bin');
    await mkdir(binDir, { recursive: true, mode: 0o700 });
    const launcher = join(binDir, process.platform === 'win32' ? 'localatlas.cmd' : 'localatlas');
    await assertNoSymlinkChain(await realpath(home()), launcher);
    const entryArg = process.env.LOCALATLAS_CLI_ENTRY_PATH || process.argv[1];
    if (!entryArg) throw new ValidationError('Unable to locate the LocalAtlas CLI entry point');
    const entry = resolve(entryArg);
    const atlasHome = process.env.LOCALATLAS_HOME ?? join(homedir(), '.localatlas');
    const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
    const runtimeRequire = createRequire(entry);
    const runtimeArgs = process.execArgv.map(argument => {
      if (argument === 'tsx' || argument === 'tsx/esm') return runtimeRequire.resolve(argument);
      if (argument === '--import=tsx') return `--import=${runtimeRequire.resolve('tsx')}`;
      return argument;
    });
    const invocation = [process.execPath, ...runtimeArgs, entry].map(shellQuote).join(' ');
    const body = process.platform === 'win32'
      ? `@echo off\r\nset LOCALATLAS_HOME=${atlasHome}\r\n${process.execPath} ${entry} %*\r\n`
      : `#!/bin/sh\nLOCALATLAS_HOME=${shellQuote(atlasHome)} export LOCALATLAS_HOME\nexec ${invocation} "$@"\n`;
    const previous = await readFile(launcher, 'utf8').catch(() => null);
    if (previous !== body) await atomicWrite(launcher, body);
    if (process.platform !== 'win32') await chmod(launcher, 0o700);
    return launcher;
  }

  write(project: Project, sessionId: string, data: string): void {
    const session = this.requireSession(project, sessionId);
    if (!session.child.stdin.writable) throw new ValidationError('Terminal input is closed');
    const payload = JSON.stringify({
      type: 'input',
      data: Buffer.from(data, 'utf8').toString('base64'),
    });
    session.child.stdin.write(`${payload}\n`);
  }

  resize(project: Project, sessionId: string, cols: number, rows: number): void {
    const session = this.requireSession(project, sessionId);
    if (!session.child.stdin.writable) return;
    session.cols = Math.max(20, Math.min(400, Number(cols) || 100));
    session.rows = Math.max(5, Math.min(200, Number(rows) || 28));
    const payload = JSON.stringify({
      type: 'resize',
      cols: session.cols,
      rows: session.rows,
    });
    session.child.stdin.write(`${payload}\n`);
  }

  getRuntime(project: Project, sessionId: string): {
    eventsAfter: (id: number) => TerminalEvent[];
    subscribe: (listener: (event: TerminalEvent) => void) => () => void;
  } {
    const session = this.requireSession(project, sessionId);
    return {
      eventsAfter: id => session.events.filter(ev => ev.id > id),
      subscribe: listener => {
        session.listeners.add(listener);
        return () => session.listeners.delete(listener);
      },
    };
  }

  stopProject(projectId: string): void {
    const shell = this.byProject.get(projectId);
    if (shell) this.stopSession(shell);
    for (const session of this.agentByScope.values()) if (session.projectId === projectId) this.stopSession(session);
  }

  closeAll(): void {
    for (const session of this.bySession.values()) this.stopSession(session);
  }

  private stopSession(session: TerminalSession): void {
    session.closed = true;
    this.bySession.delete(session.sessionId);
    if (this.byProject.get(session.projectId) === session) this.byProject.delete(session.projectId);
    if (session.kind === 'agent' && session.agent) {
      const scopeId = `${session.projectId}:${session.agent}:${session.scopeKey}`;
      if (this.agentByScope.get(scopeId) === session) this.agentByScope.delete(scopeId);
    }
    try { session.child.kill(); } catch { /* ignore */ }
  }

  private requireSession(project: Project, sessionId: string): TerminalSession {
    const session = this.bySession.get(sessionId);
    if (!session || session.closed || session.projectId !== project.id) {
      throw new NotFoundError('Terminal session is not active');
    }
    return session;
  }

  private async projectDirectories(project: Project): Promise<{ managedPath: string; sourcePath: string }> {
    try {
      const sourcePath = await realpath(project.sourcePath);
      if (!(await stat(sourcePath)).isDirectory()) {
        throw new ValidationError('Registered project path is not a directory');
      }
      const managedPath = await realpath(project.managedPath);
      if (!(await stat(managedPath)).isDirectory()) {
        throw new ValidationError('LocalAtlas project workspace is not a directory');
      }
      return { managedPath, sourcePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        const sourceExists = await realpath(project.sourcePath).then(() => true).catch(() => false);
        throw new NotFoundError(sourceExists
          ? `LocalAtlas project workspace no longer exists: ${project.managedPath}`
          : `Project directory no longer exists: ${project.sourcePath}`);
      }
      throw error;
    }
  }
}

export const terminalManager = new TerminalManager();
process.once('exit', () => terminalManager.closeAll());
