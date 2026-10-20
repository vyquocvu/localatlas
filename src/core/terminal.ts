import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { Project } from './types.js';
import { NotFoundError, ValidationError } from './errors.js';

export type TerminalEvent = {
  id: number;
  type: 'output' | 'exit';
  data: string;
  exitCode?: number | null;
  createdAt: string;
};

type TerminalSession = {
  sessionId: string;
  projectId: string;
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

  async startOrAttach(
    project: Project,
    options?: { cols?: number; rows?: number; restart?: boolean; initialCommand?: string }
  ): Promise<{ sessionId: string; cwd: string; cols: number; rows: number; eventSeq: number }> {
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
    const child = spawn(
      'python3',
      ['-u', '-c', PTY_BRIDGE_SCRIPT, String(cols), String(rows), shell, '-l'],
      {
        cwd: directories.managedPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          LOCALATLAS_PROJECT_ID: project.id,
          LOCALATLAS_PROJECT_KEY: project.key,
          LOCALATLAS_PROJECT_NAME: project.name,
          LOCALATLAS_SOURCE_PATH: directories.sourcePath,
        },
      }
    ) as ChildProcessWithoutNullStreams;

    const session: TerminalSession = {
      sessionId: randomUUID(),
      projectId: project.id,
      managedPath: directories.managedPath,
      sourcePath: directories.sourcePath,
      child,
      cols,
      rows,
      sequence: 0,
      events: [],
      listeners: new Set(),
      closed: false,
    };

    let buffer = '';
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
              const decoded = Buffer.from(msg.data, 'base64').toString('utf8');
              publish(session, 'output', decoded);
            } else if (msg.type === 'exit') {
              session.closed = true;
              publish(session, 'exit', '', msg.exitCode ?? 0);
            }
          } catch {
            // ignore malformed lines
          }
        }
        newline = buffer.indexOf('\n');
      }
    });

    child.once('close', code => {
      if (!session.closed) {
        session.closed = true;
        publish(session, 'exit', '', code ?? 0);
      }
    });

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
    const session = this.byProject.get(projectId);
    if (!session) return;
    session.closed = true;
    this.byProject.delete(projectId);
    try {
      session.child.kill();
    } catch {}
  }

  closeAll(): void {
    for (const projectId of this.byProject.keys()) {
      this.stopProject(projectId);
    }
  }

  private requireSession(project: Project, sessionId: string): TerminalSession {
    const session = this.byProject.get(project.id);
    if (!session || session.closed || session.sessionId !== sessionId) {
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
