import { useEffect, useMemo, useState } from 'react';
import { html, Button, Card, SelectField } from './Common.js';
import { formatDate, shortSha } from '../utils/markdown.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';

export function GitActivityView() {
  const { activeProject, workspaceProjects } = useWorkspaceStore();
  const { tasks } = useTaskStore();
  const [historyTaskId, setHistoryTaskId] = useState('');
  const [historyDays, setHistoryDays] = useState('365');
  const [historyLimit, setHistoryLimit] = useState('50');
  const [historyResult, setHistoryResult] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    if (!tasks.some(task => task.id === historyTaskId)) setHistoryTaskId(tasks[0]?.id || '');
  }, [tasks, historyTaskId]);

  const selectedProjectSummary = useMemo(
    () => workspaceProjects.find(project => project.id === activeProject?.id) ?? null,
    [workspaceProjects, activeProject]
  );

  if (!activeProject) return null;

  const searchTaskHistory = async () => {
    if (!historyTaskId) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const query = new URLSearchParams({ task: historyTaskId, days: historyDays, limit: historyLimit });
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/traceability/history?${query}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to search task history');
      setHistoryResult(body);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Unable to search task history');
    } finally {
      setHistoryLoading(false);
    }
  };

  return html`
    <div class="activity-page">
      <div class="page-heading">
        <div class="eyebrow">${activeProject.key} · PROJECT ACTIVITY</div>
        <h1>Git activity</h1>
        <p>Recent commit history for <strong>${activeProject.name}</strong>, shown read-only.</p>
      </div>
      <${Card} className="git-state-card">
        <div class="git-state-branch">
          <span class="health-icon green">⑂</span>
          <div>
            <small>Current branch</small>
            <strong>${selectedProjectSummary?.git?.branch || 'Not a Git repository'}</strong>
          </div>
        </div>
        <div class="git-state-dirty">
          <span class=${selectedProjectSummary?.git?.dirtyCount ? 'status-dot dirty' : 'status-dot'}></span>
          <span>${selectedProjectSummary?.git?.dirtyCount ? `${selectedProjectSummary.git.dirtyCount} changed files` : 'Working tree clean'}</span>
        </div>
      </${Card}>
      <div class="git-history-panel">
        <div class="content-section-heading">
          <div>
            <h2>Recent commits</h2>
            <p>Latest 5 commits from the local Git history.</p>
          </div>
        </div>
        ${(selectedProjectSummary?.git?.recentCommits ?? []).length === 0 && html`<div class="panel-empty">No commits found. This repository may not have a Git history yet.</div>`}
        ${(selectedProjectSummary?.git?.recentCommits ?? []).map((commit, index) => html`
          <div key=${commit.sha} class="git-history-row">
            <span class="git-history-marker">${index === 0 ? '●' : '○'}</span>
            <div class="git-history-copy">
              <strong>${commit.subject}</strong>
              <div class="activity-meta">
                <span>${commit.author}</span>
                <span>${formatDate(commit.timestamp)}</span>
              </div>
            </div>
            <code>${shortSha(commit.sha)}</code>
          </div>
        `)}
      </div>
      <div class="git-history-panel task-history-search">
        <div class="content-section-heading"><div><h2>Task history search</h2><p>Search current HEAD history with an explicit time window and commit cap. Git stops after 3 seconds or 1 MiB of output.</p></div></div>
        <div class="task-history-controls">
          <${SelectField} ariaLabel="Task for Git history" value=${historyTaskId} onChange=${setHistoryTaskId} options=${[
            { value: '', label: tasks.length ? 'Choose a task' : 'No tasks in this project' },
            ...tasks.map(task => ({ value: task.id, label: `${task.id} · ${task.title}` })),
          ]} />
          <${SelectField} ariaLabel="Git history time window" value=${historyDays} onChange=${setHistoryDays} options=${[
            { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last 365 days' }, { value: '1825', label: 'Last 5 years' },
          ]} />
          <${SelectField} ariaLabel="Git history commit limit" value=${historyLimit} onChange=${setHistoryLimit} options=${[
            { value: '50', label: 'Up to 50 commits' }, { value: '100', label: 'Up to 100 commits' }, { value: '200', label: 'Up to 200 commits' },
          ]} />
          <${Button} isDisabled=${!historyTaskId || historyLoading} onClick=${searchTaskHistory}>${historyLoading ? 'Searching…' : 'Search history'}</${Button}>
        </div>
        ${historyError && html`<div class="form-error" role="alert">${historyError}</div>`}
        ${historyResult && html`
          <div class="task-history-results">
            ${!historyResult.available && html`<div class="banner banner-warning">${historyResult.reason || 'Git history is unavailable.'}</div>`}
            ${historyResult.available && html`<p class="task-history-scope">Searched ${historyResult.scope.commitsScanned} commit(s) reachable from ${historyResult.scope.revision} in the last ${historyResult.scope.sinceDays} days (cap ${historyResult.scope.commitLimit}) · ${formatDate(historyResult.generatedAt)}.${historyResult.scope.truncated ? ' More history exists beyond this cap; narrow the time window or raise the limit.' : ' Search completed within the selected scope.'}</p>`}
            ${historyResult.available && historyResult.matches.length === 0 && html`<div class="panel-empty">No task-ID or session-start HEAD matches in this search scope.</div>`}
            ${historyResult.matches.map(match => html`<div class="git-history-row task-history-match" key=${match.commit.sha}>
              <div class="git-history-copy"><strong>${match.commit.subject}</strong><div class="activity-meta"><span>${match.commit.author}</span><span>${formatDate(match.commit.timestamp)}</span></div><div class="task-history-evidence">${match.evidence.map(evidence => html`<span class="badge" key=${evidence}>${evidence === 'task_id_in_subject' ? 'Task ID in commit subject · no completion claim' : 'HEAD recorded at session start · starting state'}</span>`)}</div></div>
              <code>${shortSha(match.commit.sha)}</code>
            </div>`)}
          </div>
        `}
      </div>
    </div>
  `;
}
