import { useEffect, useRef } from 'react';
import { html, Button, Card, TextArea, SelectField } from './Common.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useCodexStore } from '../stores/useCodexStore.js';

export function CodexChatView() {
  const { activeProject } = useWorkspaceStore();
  const { tasks } = useTaskStore();
  const {
    codexMessages,
    codexThreadId,
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

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [codexMessages, codexActivity, codexApproval]);

  if (!activeProject) return null;

  return html`
    <div class="codex-page">
      <div class="codex-heading">
        <div class="page-heading compact-heading">
          <div class="eyebrow">${activeProject.key} · PROJECT CHAT</div>
          <h1>Chat with Codex</h1>
          <p>Ask about this project, plan work, or make changes with Codex.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <${SelectField}
            value=${codexTaskScope}
            ariaLabel="Chat context scope"
            onChange=${setCodexTaskScope}
            options=${[
              { value: '', label: 'Project-wide context' },
              ...tasks.map(t => ({ value: t.id, label: `Task ${t.id} · ${t.title}` })),
            ]}
          />
          ${codexThreadId && html`<${Button} onClick=${() => startCodexConversation()} isDisabled=${codexLoading}>New chat</${Button}>`}
        </div>
      </div>
      <div class="codex-local-notice">
        <span class="local-dot"></span>
        <span>Runs the Codex CLI installed on this machine using your local account and settings. This is a separate Codex conversation; it does not load this ChatGPT chat. Codex may read or change this repository according to its configured permissions. Chat and approvals are available only through localhost.</span>
      </div>
      ${codexError && html`
        <div class="banner banner-danger codex-error" role="alert">
          <span>${codexError}</span>
          ${codexThreadId && html`<${Button} onClick=${() => startCodexConversation()} isDisabled=${codexLoading}>Start a new chat</${Button}>`}
        </div>
      `}
      ${!codexThreadId ? html`
        <${Card} className="codex-start-card">
          <div class="codex-start-mark">✳</div>
          <div>
            <h2>${codexLoading ? 'Connecting to Codex…' : 'Start a project chat'}</h2>
            <p>LocalAtlas gives Codex a short context for <strong>${activeProject.name}</strong>${codexTaskScope ? ` scoped to task ${codexTaskScope}` : ''}. The conversation stays in your Codex history and is linked to this project in this browser.</p>
          </div>
          <${Button} className="button--primary" onClick=${() => startCodexConversation()} isDisabled=${codexLoading}>${codexLoading ? 'Connecting…' : 'Start chatting'}</${Button}>
        </${Card}>
      ` : html`
        <${Card} className="codex-chat-card">
          <div class="codex-chat-meta">
            <span><i class="status-dot"></i> Connected to local Codex</span>
            <code title=${codexThreadId}>${codexThreadId.slice(0, 8)}</code>
          </div>
          <div class="codex-transcript" ref=${transcriptRef} aria-live="polite" aria-label="Codex conversation">
            ${codexMessages.length === 0 && !codexLoading && html`<div class="codex-empty"><strong>What would you like to work on?</strong><span>Codex has the selected project folder and a bounded LocalAtlas context.</span></div>`}
            ${codexMessages.map(message => html`
              <div key=${message.id} class=${'codex-message ' + message.role}>
                <div class="codex-message-label">${message.role === 'assistant' ? 'Codex' : 'You'}</div>
                <div class="codex-message-text">${message.text}</div>
              </div>
            `)}
            ${codexActivity && html`<div class="codex-activity"><span class="codex-activity-dot"></span>${codexActivity}</div>`}
          </div>
          ${codexApproval && html`
            <div class="codex-approval" role="group" aria-label="Codex approval request">
              <div>
                <strong>${codexApproval.kind === 'file-change' ? 'Codex requests permission to change files' : 'Codex requests permission to run a command'}</strong>
                <p>${codexApproval.reason || 'Review this action before allowing Codex to continue.'}</p>
                ${codexApproval.command && html`<pre>${codexApproval.command}</pre>`}
                <small>Working directory: ${codexApproval.cwd}</small>
              </div>
              <div class="codex-approval-actions">
                <${Button} onClick=${() => respondToCodexApproval('decline')}>Decline</${Button}>
                <${Button} className="button--primary" onClick=${() => respondToCodexApproval('accept')}>Allow once</${Button}>
              </div>
            </div>
          `}
          <div class="codex-composer">
            <${TextArea}
              aria-label="Message Codex"
              placeholder="Ask Codex about this project…"
              value=${codexDraft}
              rows="3"
              onInput=${event => setCodexDraft(event.target.value)}
              onKeyDown=${event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  sendCodexMessage();
                }
              }}
              disabled=${codexBusy || codexLoading}
            ></${TextArea}>
            <div class="codex-composer-footer">
              <small>⌘ Enter to send · Codex follows your local approval and sandbox settings</small>
              <${Button} className="button--primary" onClick=${sendCodexMessage} isDisabled=${codexBusy || codexLoading || !codexDraft.trim()}>${codexBusy ? 'Codex is working…' : 'Send'}</${Button}>
            </div>
          </div>
        </${Card}>
      `}
    </div>
  `;
}
