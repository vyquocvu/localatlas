import { useMemo } from 'react';
import { html, Card } from './Common.js';
import { formatDate, shortSha } from '../utils/markdown.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';

export function GitActivityView() {
  const { activeProject, workspaceProjects } = useWorkspaceStore();

  const selectedProjectSummary = useMemo(
    () => workspaceProjects.find(project => project.id === activeProject?.id) ?? null,
    [workspaceProjects, activeProject]
  );

  if (!activeProject) return null;

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
    </div>
  `;
}
