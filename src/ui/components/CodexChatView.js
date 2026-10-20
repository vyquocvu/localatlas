import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { html, Button, SelectField } from './Common.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useCodexStore } from '../stores/useCodexStore.js';

function InteractivePtyTerminal({ project, initialCommand }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const sessionRef = useRef(null);
  const esRef = useRef(null);
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState('CONNECTING');
  const [error, setError] = useState('');

  const sendInput = data => {
    const sid = sessionRef.current;
    if (!sid || !project) return;
    fetch(`/api/projects/${encodeURIComponent(project.id)}/terminal/${encodeURIComponent(sid)}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    }).catch(() => {});
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

  const connectPty = async (restart = false, cmd = undefined) => {
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
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/terminal/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols, rows, restart, initialCommand: cmd }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to start local PTY terminal');

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

    connectPty(false, initialCommand);

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
  }, [project?.id]);

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
          <span>zsh — ${projectSlug} (${project.managedPath})</span>
        </div>
        <div class="codex-terminal-meta-right">
          <button
            type="button"
            class="term-quick-btn"
            title="Run Codex with workspace-write access to the LocalAtlas workspace and source repository"
            onClick=${() => {
              sendInput('codex --sandbox workspace-write --add-dir "$LOCALATLAS_SOURCE_PATH"\r');
              termRef.current?.focus();
            }}
          >
            ▶ Run codex
          </button>
          <button
            type="button"
            class="term-quick-btn"
            title="Print LocalAtlas project context in terminal"
            onClick=${() => {
              sendInput('npx tsx src/cli.ts context\r');
              termRef.current?.focus();
            }}
          >
            ⚡ Context
          </button>
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
          <${Button} onClick=${() => connectPty(true)}>Retry</${Button}>
        </div>
      `}
      <div class="codex-xterm-host" ref=${containerRef} onClick=${() => termRef.current?.focus()}></div>
    </div>
  `;
}

export function ProjectTerminalPanel({ project }) {
  const { terminalPanelOpen, toggleTerminalPanel } = useWorkspaceStore();
  const [hasOpened, setHasOpened] = useState(terminalPanelOpen);

  useEffect(() => {
    if (terminalPanelOpen) setHasOpened(true);
  }, [terminalPanelOpen]);

  if (!hasOpened) return null;

  return html`
    <section
      id="project-terminal-dock"
      class=${'project-terminal-dock' + (terminalPanelOpen ? '' : ' is-closed')}
      aria-label="Project Terminal"
      aria-hidden=${!terminalPanelOpen}
    >
      <div class="project-terminal-dock-header">
        <div class="project-terminal-dock-heading">
          <span>TERMINAL</span>
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
        <${InteractivePtyTerminal} project=${project} />
      </div>
    </section>
  `;
}

export function CodexChatView() {
  const { activeProject } = useWorkspaceStore();
  const { tasks } = useTaskStore();
  const {
    codexMessages,
    codexThreadId,
    codexCwd,
    codexLoading,
    codexBusy,
    codexDraft,
    codexError,
    codexActivity,
    codexApproval,
    codexTaskScope,
    setCodexDraft,
    setCodexTaskScope,
    startCodexConversation,
    sendCodexMessage,
    respondToCodexApproval,
  } = useCodexStore();

  const transcriptRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [codexMessages, codexActivity, codexApproval]);

  useEffect(() => {
    if (codexThreadId && !codexBusy && !codexLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [codexThreadId, codexBusy, codexLoading]);

  if (!activeProject) return null;

  const projectSlug = (activeProject.key || activeProject.name || 'project').toLowerCase();

  return html`
    <div class="codex-page">
      <div class="codex-heading">
        <div class="page-heading compact-heading">
          <div class="eyebrow">${activeProject.key} · CODEX AGENT</div>
          <h1>Codex Agent Console</h1>
          <p>Codex works in the LocalAtlas workspace (${activeProject.managedPath}) with repository source at ${activeProject.sourcePath}.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <${SelectField}
            value=${codexTaskScope}
            ariaLabel="Chat context scope"
            onChange=${setCodexTaskScope}
            options=${[
              { value: '', label: 'Project-wide context' },
              ...tasks.map(t => ({ value: t.id, label: `Task ${t.id} · ${t.title}` })),
            ]}
          />
          <${Button} onClick=${() => startCodexConversation()} isDisabled=${codexLoading}>New session</${Button}>
        </div>
      </div>

        ${codexError && html`
          <div class="banner banner-danger codex-error" role="alert">
            <span>${codexError}</span>
            <${Button} onClick=${() => startCodexConversation()} isDisabled=${codexLoading}>Restart session</${Button}>
          </div>
        `}
        <div class="codex-terminal-window" onClick=${event => {
          if (window.getSelection()?.toString()) return;
          if (event.target.closest('button, textarea, a, pre')) return;
          inputRef.current?.focus();
        }}>
          <div class="codex-terminal-titlebar">
            <div class="codex-terminal-dots" aria-hidden="true">
              <span class="dot red"></span>
              <span class="dot yellow"></span>
              <span class="dot green"></span>
            </div>
            <div class="codex-terminal-title">
              <span class="codex-terminal-status-dot ${codexBusy || codexLoading ? 'busy' : 'online'}"></span>
              <span>codex@${projectSlug}:${codexCwd || activeProject.managedPath}</span>
              ${codexTaskScope && html`<span class="codex-terminal-scope-pill">--task ${codexTaskScope}</span>`}
            </div>
            <div class="codex-terminal-meta-right">
              <span class="codex-terminal-state">${codexLoading ? 'CONNECTING' : codexBusy ? 'RUNNING' : 'IDLE'}</span>
              ${codexThreadId && html`<code title=${`Session ID: ${codexThreadId}`}>#${codexThreadId.slice(0, 8)}</code>`}
            </div>
          </div>

          <div class="codex-terminal-viewport" ref=${transcriptRef} aria-live="polite" aria-label="Codex terminal session">
            <div class="codex-terminal-banner">
              <div><span class="term-accent">LocalAtlas Codex Agent Console</span> · ${codexThreadId ? html`session <code>${codexThreadId}</code>` : 'initializing…'}</div>
              <div class="term-dim">cwd: ${codexCwd || activeProject.managedPath} · source: ${activeProject.sourcePath} · scope: ${codexTaskScope ? `task ${codexTaskScope}` : 'project-wide'} · enter to send, shift+enter for newline</div>
            </div>

            ${codexLoading && codexMessages.length === 0 && html`
              <div class="codex-term-activity">
                <span class="codex-term-spinner">⠋</span>
                <span>Spawning local Codex app-server and injecting project context…</span>
              </div>
            `}

            ${codexMessages.length === 0 && !codexLoading && html`
              <div class="codex-terminal-welcome">
                <span class="term-green">➜</span> Ready. Type a prompt or command instruction below to begin working with Codex.
              </div>
            `}

            ${codexMessages.map(message => {
              if (message.role === 'user') {
                return html`
                  <div key=${message.id} class="codex-term-entry user">
                    <div class="codex-term-prompt-line">
                      <span class="term-user">you@${projectSlug}</span>
                      <span class="term-sep">:</span>
                      <span class="term-path">~</span>
                      <span class="term-dollar">$</span>
                      <span class="codex-term-user-text">${message.text}</span>
                    </div>
                  </div>
                `;
              }
              if (message.role === 'command') {
                const isRunning = message.status === 'inProgress';
                const isError = typeof message.exitCode === 'number' && message.exitCode !== 0;
                return html`
                  <div key=${message.id} class=${`codex-term-entry command ${isRunning ? 'running' : ''} ${isError ? 'failed' : ''}`}>
                    <div class="codex-term-cmd-header">
                      <span class="term-cmd-badge">${isRunning ? '⟳ EXEC' : isError ? `✖ EXIT ${message.exitCode}` : '✔ EXEC'}</span>
                      <code class="term-cmd-string">$ ${message.command || message.text}</code>
                    </div>
                    ${message.output && html`<pre class="codex-term-cmd-output">${message.output}</pre>`}
                  </div>
                `;
              }
              return html`
                <div key=${message.id} class="codex-term-entry assistant">
                  <div class="codex-term-agent-header">
                    <span class="term-agent-badge">codex</span>
                  </div>
                  <div class="codex-term-agent-body">${message.text}</div>
                </div>
              `;
            })}

            ${codexActivity && html`
              <div class="codex-term-activity">
                <span class="codex-term-spinner">⠋</span>
                <span>${codexActivity}</span>
              </div>
            `}

            ${codexApproval && html`
              <div class="codex-term-approval" role="group" aria-label="Codex approval request">
                <div class="codex-term-approval-header">
                  <span class="term-warn-badge">! PERMISSION REQUIRED</span>
                  <strong>${codexApproval.kind === 'file-change' ? 'Modify workspace files' : 'Execute shell command'}</strong>
                </div>
                <p>${codexApproval.reason || 'Review this operation before allowing Codex to proceed.'}</p>
                ${codexApproval.command && html`<pre class="codex-term-approval-cmd">$ ${codexApproval.command}</pre>`}
                <div class="codex-term-approval-footer">
                  <small>cwd: ${codexApproval.cwd}</small>
                  <div class="codex-approval-actions">
                    <button type="button" class="term-btn decline" onClick=${() => respondToCodexApproval('decline')}>[n] Decline</button>
                    <button type="button" class="term-btn accept" onClick=${() => respondToCodexApproval('accept')}>[y] Allow once</button>
                  </div>
                </div>
              </div>
            `}
          </div>

          <div class="codex-terminal-inputbar">
            <div class="codex-terminal-prompt-prefix">
              <span class="term-green">➜</span>
              <span class="term-cyan">${projectSlug}</span>
              <span class="term-dollar">$</span>
            </div>
            <textarea
              ref=${inputRef}
              class="codex-terminal-input"
              aria-label="Message Codex"
              placeholder=${codexLoading ? 'Connecting to local Codex…' : codexBusy ? 'Codex is executing…' : 'Type a prompt or instruction for Codex… (Enter to run, Shift+Enter for newline)'}
              value=${codexDraft}
              rows=${Math.min(6, Math.max(1, (codexDraft.match(/\n/g)?.length ?? 0) + 1))}
              onInput=${event => setCodexDraft(event.target.value)}
              onKeyDown=${event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendCodexMessage();
                }
              }}
              disabled=${codexBusy || codexLoading || !codexThreadId}
            ></textarea>
            <button
              type="button"
              class="codex-terminal-send"
              onClick=${sendCodexMessage}
              disabled=${codexBusy || codexLoading || !codexThreadId || !codexDraft.trim()}
            >
              ${codexBusy ? 'Running…' : 'Run ↵'}
            </button>
          </div>
        </div>
    </div>
  `;
}
