import { useMemo } from 'react';
import { html, Button, Card } from './Common.js';
import { formatDate, shortSha } from '../utils/markdown.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useModalStore } from '../stores/useModalStore.js';
import { BackupRecoveryPanel } from './BackupRecoveryPanel.js';
import { AttentionInbox } from './AttentionInbox.js';

export function PortfolioView() {
  const {
    projectsList,
    workspaceProjects,
    portfolioSummary,
    overviewLoading,
    selectProject,
  } = useWorkspaceStore();

  const { openImportModal } = useModalStore();

  const recentWorkspaceCommits = useMemo(() => workspaceProjects
    .flatMap(project => (project.git?.recentCommits ?? []).map(commit => ({
      ...commit,
      projectId: project.id,
      projectName: project.name,
      projectKey: project.key,
      branch: project.git?.branch,
    })))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8), [workspaceProjects]);

  return html`
    <div class="portfolio-scroll">
      <div class="portfolio-intro">
        <div>
          <div class="eyebrow">LOCAL WORKSPACE</div>
          <h1>Your projects, in one place.</h1>
          <p>See project work, documentation, governance proposals, and Git activity without changing your source repositories.</p>
        </div>
        <${Button} className="button--primary import-hero-button" onClick=${openImportModal}>+ Import project</${Button}>
      </div>
      <div class="portfolio-metrics">
        <${Card} className="metric-card"><span class="metric-label">Projects</span><strong>${projectsList.length}</strong><small>local repositories</small></${Card}>
        <${Card} className="metric-card"><span class="metric-label">Open tasks</span><strong>${workspaceProjects.reduce((sum, p) => sum + p.tasks.open, 0)}</strong><small>${workspaceProjects.reduce((sum, p) => sum + p.tasks.blocked, 0)} blocked · ${portfolioSummary?.totals?.criticalOpenTasks ?? 0} critical</small></${Card}>
        <${Card} className="metric-card"><span class="metric-label">Governance & Sessions</span><strong>${portfolioSummary?.totals?.pendingProposals ?? 0}</strong><small>pending proposals · ${portfolioSummary?.totals?.activeSessions ?? 0} active sessions</small></${Card}>
        <${Card} className="metric-card"><span class="metric-label">Repositories with changes</span><strong>${workspaceProjects.filter(p => (p.git?.dirtyCount ?? 0) > 0).length}</strong><small>Git working trees</small></${Card}>
      </div>
      <${AttentionInbox} />
      <div class="portfolio-content-grid">
        <div class="project-portfolio-column">
          <div class="content-section-heading"><div><h2>Projects</h2><p>Choose a project to open its docs, tasks, and activity.</p></div><span class="count-pill">${projectsList.length}</span></div>
          ${overviewLoading && workspaceProjects.length === 0 && html`<div class="loading-panel">Loading your local projects…</div>`}
          ${projectsList.length === 0 && !overviewLoading && html`
            <${Card} className="portfolio-empty">
              <div class="empty-illustration">⌂</div><h2>Bring your projects together</h2>
              <p>Import a local folder to see its documentation, tasks, and recent Git activity here.</p>
              <${Button} className="button--primary" onClick=${openImportModal}>Import your first project</${Button}>
            </${Card}>
          `}
          <div class="project-card-grid">
            ${workspaceProjects.map(project => {
              const pHealth = portfolioSummary?.projects?.find(item => item.project.id === project.id);
              return html`
                <${Card} key=${project.id} className="portfolio-project-card">
                  <${Button} className="project-card-button" onClick=${() => {
                    const fullProject = projectsList.find(item => item.id === project.id);
                    if (fullProject) selectProject(fullProject);
                  }}>
                    <div class="project-card-heading">
                      <span class="project-avatar large">${project.key.slice(0, 1)}</span>
                      <div class="project-card-title"><div><span class="project-key-tag">${project.key}</span><span class="project-branch">${project.git?.branch || 'No Git'}</span>${pHealth?.profile?.status && html`<span class="badge" style="margin-left:6px">${pHealth.profile.status}</span>`}</div><h3>${project.name}</h3></div>
                      ${pHealth?.freshness === 'stale' && html`<span class="badge" title=${pHealth.errors.map(error => `${error.source}: ${error.message}`).join('\n')}>Some data unavailable</span>`}
                      <span class="project-open-arrow">↗</span>
                    </div>
                    ${pHealth?.profile?.goals && html`<div class="project-source-path" style="opacity:0.9">${pHealth.profile.goals}</div>`}
                    <div class="project-source-path" title=${project.sourcePath}>${project.sourcePath}</div>
                    <div class="project-card-stats">
                      <span><strong>${project.tasks.open}</strong> open</span>
                      <span><strong>${project.tasks.blocked}</strong> blocked</span>
                      ${(pHealth?.pendingProposalsCount ?? 0) > 0 && html`<span style="color:var(--warning)"><strong>${pHealth.pendingProposalsCount}</strong> proposals</span>`}
                      ${(pHealth?.activeSessionsCount ?? 0) > 0 && html`<span><strong>⚡ ${pHealth.activeSessionsCount}</strong> session</span>`}
                      <span><strong>${project.docs.count}</strong> docs</span>
                      <span class=${project.git?.dirtyCount ? 'working-tree dirty' : 'working-tree'}><i></i>${project.git?.dirtyCount ? `${project.git.dirtyCount} changed` : 'Clean'}</span>
                    </div>
                    <div class="project-card-commit">
                      <span class="commit-dot"></span>
                      ${project.git?.head ? html`<span class="commit-subject">${project.git.head.subject}</span><span class="commit-sha">${shortSha(project.git.head.sha)}</span>` : html`<span class="commit-subject">No commits yet</span>`}
                    </div>
                  </${Button}>
                </${Card}>
              `;
            })}
          </div>
        </div>
        <div class="portfolio-activity-panel">
          <div class="content-section-heading"><div><h2>Recent Git activity</h2><p>Latest commits across your projects.</p></div></div>
          ${recentWorkspaceCommits.length === 0 && html`<div class="activity-empty">No Git commits found yet.</div>`}
          <div class="activity-list">
            ${recentWorkspaceCommits.map(commit => html`
              <div key=${`${commit.projectId}-${commit.sha}`} class="activity-item">
                <span class="activity-rail-dot"></span>
                <div class="activity-item-body">
                  <div class="activity-project-label"><span>${commit.projectKey}</span><small>${commit.projectName}</small></div>
                  <strong>${commit.subject}</strong>
                  <div class="activity-meta"><span>${commit.author}</span><span>${formatDate(commit.timestamp)}</span><code>${shortSha(commit.sha)}</code></div>
                </div>
              </div>
            `)}
          </div>
          <div class="read-only-hint">Git history is shown read-only. LocalAtlas never runs Git mutations.</div>
        </div>
      </div>
      <${BackupRecoveryPanel} />
    </div>
  `;
}
