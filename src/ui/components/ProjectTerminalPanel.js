import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { html, Button } from './Common.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';

function InteractivePtyTerminal({ project, initialCommand, codexSession = null }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const sessionRef = useRef(null);
  const esRef = useRef(null);
  const inputQueueRef = useRef(Promise.resolve());
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState('CONNECTING');
  const [error, setError] = useState('');

  const sendInput = data => {
    const sid = sessionRef.current;
    if (!sid || !project) return;
    const url = `/api/projects/${encodeURIComponent(project.id)}/terminal/${encodeURIComponent(sid)}/input`;
    const request = () => fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    inputQueueRef.current = inputQueueRef.current
      .catch(() => {})
      .then(request)
      .catch(() => {});
  };

  const sendResize = (cols, rows) => {
    const sid = sessionRef.current;
    if (!sid || !project) return;
    fetch(`/api/projects/${encodeURIComponent(project.id)}/terminal/${encodeURIComponent(sid)}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    }).catch(() => {});
  };

  const connectPty = async (restart = false, cmd = undefined, attachSession = null) => {
    if (!project || !termRef.current) return;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setError('');
    setStatus('CONNECTING');
    if (restart) {
      termRef.current.clear();
    }

    try {
      const cols = termRef.current.cols || 100;
      const rows = termRef.current.rows || 28;
      let body = attachSession;
      if (!attachSession) {
        const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/terminal/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cols, rows, restart, initialCommand: cmd }),
        });
        body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Failed to start local PTY terminal');
      }

      sessionRef.current = body.sessionId;
      setSessionId(body.sessionId);
      setStatus('RUNNING');

      const es = new EventSource(
        `/api/projects/${encodeURIComponent(project.id)}/terminal/${encodeURIComponent(body.sessionId)}/events?after=0`
      );
      esRef.current = es;

      es.addEventListener('terminal', raw => {
        try {
          const ev = JSON.parse(raw.data);
          if (ev.type === 'output' && typeof ev.data === 'string') {
            termRef.current?.write(ev.data);
          } else if (ev.type === 'exit') {
            setStatus(`EXITED (${ev.exitCode ?? 0})`);
            termRef.current?.writeln(`\r\n\x1b[33m[Process exited with code ${ev.exitCode ?? 0}]\x1b[0m`);
          }
        } catch {}
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setStatus('DISCONNECTED');
        }
      };

      setTimeout(() => {
        fitRef.current?.fit();
        termRef.current?.focus();
      }, 60);
    } catch (err) {
      setStatus('ERROR');
      setError(err instanceof Error ? err.message : 'Unable to start terminal');
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.35,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(56, 139, 253, 0.3)',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    const dataDisposable = term.onData(data => {
      sendInput(data);
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
    });

    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {}
    });
    ro.observe(containerRef.current);

    connectPty(false, initialCommand, codexSession);

    return () => {
      ro.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      term.dispose();
    };
  }, [project?.id, codexSession?.sessionId]);

  useEffect(() => {
    useWorkspaceStore.getState().setTerminalStatus(status);
  }, [status, project?.id]);

  const projectSlug = (project?.key || project?.name || 'project').toLowerCase();

  return html`
    <div class="codex-terminal-window">
      <div class="codex-terminal-titlebar">
        <div class="codex-terminal-dots" aria-hidden="true">
          <span class="dot red"></span>
          <span class="dot yellow"></span>
          <span class="dot green"></span>
        </div>
        <div class="codex-terminal-title">
          <span class="codex-terminal-status-dot ${status === 'RUNNING' ? 'online' : 'busy'}"></span>
          <span>${codexSession ? `codex · ${codexSession.scopeKey}` : `zsh — ${projectSlug}`} (${project.managedPath})</span>
        </div>
        <div class="codex-terminal-meta-right">
          ${!codexSession && html`<button
            type="button"
            class="term-quick-btn"
            title="Open Codex CLI in this project terminal"
            onClick=${() => useWorkspaceStore.getState().launchCodex({ type: 'project' })}
          >
            Open Codex
          </button>`}
          ${codexSession && html`<button
            type="button"
            class="term-quick-btn"
            title="Start a new Codex session with fresh context"
            onClick=${() => {
              const scopeKey = codexSession.scopeKey || 'project';
              const scope = scopeKey.startsWith('task:')
                ? { type: 'task', id: scopeKey.slice(5) }
                : scopeKey.startsWith('document:')
                  ? { type: 'document', source: scopeKey.split(':')[1], path: scopeKey.split(':').slice(2).join(':') }
                  : { type: 'project' };
              useWorkspaceStore.getState().launchCodex(scope, true);
            }}
          >New session</button>`}
          <button
            type="button"
            class="term-quick-btn"
            title="Preview current LocalAtlas project context"
            onClick=${async () => {
              try {
                const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/context?format=text`);
                if (!response.ok) {
                  const body = await response.json().catch(() => ({}));
                  throw new Error(body.error || 'Unable to load project context');
                }
                const context = await response.text();
                window.prompt('LocalAtlas project context (generated now):', context);
              } catch (error) {
                termRef.current?.writeln(`\r\n\x1b[31m[LocalAtlas] ${error instanceof Error ? error.message : 'Unable to load project context'}\x1b[0m`);
              }
            }}
          >
            Preview context
          </button>
          <button type="button" class="term-quick-btn" title="Copy current project context" onClick=${async () => {
            let context = '';
            try {
              const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/context?format=text`);
              if (!response.ok) throw new Error('Unable to load project context');
              context = await response.text();
              if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
              await navigator.clipboard.writeText(context);
              useWorkspaceStore.getState().setNotice('Copied current project context');
            } catch (error) {
              if (context) window.prompt('Copy this project context:', context);
              useWorkspaceStore.getState().setNotice(error instanceof Error ? error.message : 'Unable to copy project context');
            }
          }}>Copy context</button>
          <button
            type="button"
            class="term-quick-btn"
            title="Restart shell process"
            onClick=${() => connectPty(true)}
          >
            ↻ Restart shell
          </button>
          <span class="codex-terminal-state">${status}</span>
          ${sessionId && html`<code title=${`PTY Session: ${sessionId}`}>#${sessionId.slice(0, 8)}</code>`}
        </div>
      </div>
      ${error && html`
        <div class="banner banner-danger codex-error" role="alert">
          <span>${error}</span>
          <${Button} onClick=${() => connectPty(Boolean(codexSession), undefined, codexSession)}>Retry</${Button}>
        </div>
      `}
      <div class="codex-xterm-host" ref=${containerRef} onClick=${() => termRef.current?.focus()}></div>
    </div>
  `;
}

export function ProjectTerminalPanel({ project }) {
  const { terminalPanelOpen, toggleTerminalPanel, terminalMode, codexTerminalSession, openProjectTerminal } = useWorkspaceStore();
  const [hasOpened, setHasOpened] = useState(terminalPanelOpen);
  const dockRef = useRef(null);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  useEffect(() => {
    if (terminalPanelOpen) setHasOpened(true);
  }, [terminalPanelOpen]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!resizingRef.current || !dockRef.current) return;
      const delta = startYRef.current - e.clientY;
      const newHeight = Math.max(120, Math.min(startHeightRef.current + delta, window.innerHeight * 0.85));
      dockRef.current.style.height = `${newHeight}px`;
      dockRef.current.style.flex = 'none';
    };
    const onMouseUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = (e) => {
    e.preventDefault();
    if (!dockRef.current) return;
    resizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = dockRef.current.getBoundingClientRect().height;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  if (!hasOpened) return null;

  return html`
    <section
      id="project-terminal-dock"
      ref=${dockRef}
      class=${'project-terminal-dock' + (terminalPanelOpen ? '' : ' is-closed')}
      aria-label="Project Terminal"
      aria-hidden=${!terminalPanelOpen}
    >
      <div
        class="project-terminal-resize-handle"
        onMouseDown=${startResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        title="Drag to resize"
      ></div>
      <div class="project-terminal-dock-header">
        <div class="project-terminal-dock-heading">
          <button type="button" class="term-quick-btn" aria-pressed=${terminalMode === 'shell'} onClick=${openProjectTerminal}>SHELL</button>
          <button type="button" class="term-quick-btn" aria-pressed=${terminalMode === 'codex'} onClick=${() => useWorkspaceStore.setState({ terminalMode: 'codex' })}>CODEX</button>
          <span class="project-terminal-dock-project">${project.key}</span>
        </div>
        <button
          type="button"
          class="project-terminal-dock-close"
          aria-label="Close Project Terminal"
          title="Close terminal panel"
          onClick=${toggleTerminalPanel}
        >×</button>
      </div>
      <div class="project-terminal-dock-content">
        ${terminalMode === 'codex' && codexTerminalSession
          ? html`<${InteractivePtyTerminal} key=${codexTerminalSession.sessionId} project=${project} codexSession=${codexTerminalSession} />`
          : html`<${InteractivePtyTerminal} key=${`shell-${project.id}`} project=${project} />`}
      </div>
    </section>
  `;
}

