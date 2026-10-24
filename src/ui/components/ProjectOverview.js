import { useMemo } from 'react';
import { html, Button, Card } from './Common.js';
import { formatDate, shortSha } from '../utils/markdown.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { useProfileStore } from '../stores/useProfileStore.js';
import { useModalStore } from '../stores/useModalStore.js';

export function ProjectOverview() {
  const {
    activeProject,
    workspaceProjects,
    overviewLoading,
    setActiveModule,
  } = useWorkspaceStore();

  const {
    docsList,
    sourceDocs,
    sourceDocsLoading,
    selectDoc,
    openSourceDocument,
  } = useDocumentStore();

  const {
    tasks,
    taskTraceability,
    copyTaskContext,
    loadTasks,
  } = useTaskStore();

  const {
    sessions,
    updateSessionStatus,
  } = useSessionStore();

  const {
    profileData,
    proposals,
    projectHealth,
    recapLoading,
    generateRecap,
    confirmProposal,
    rejectProposal,
    loadProjectHealth,
  } = useProfileStore();

  const {
    openRelinkModal,
    setNewTaskModalOpen,
    openTemplateModal,
    openProfileModal,
    openDecisionModal,
    openImpactModal,
    openNewSessionModal,
  } = useModalStore();

  const selectedProjectSummary = useMemo(
    () => workspaceProjects.find(project => project.id === activeProject?.id) ?? null,
    [workspaceProjects, activeProject]
  );

  if (!activeProject) return null;

  return html`
    <div class="project-overview-scroll">
      <div class="project-overview-hero">
        <div class="project-avatar jumbo">${activeProject.key.slice(0, 1)}</div>
        <div class="project-overview-title"><div class="eyebrow">PROJECT WORKSPACE · ${activeProject.key}</div><h1>${activeProject.name}</h1><p title=${activeProject.sourcePath}>${activeProject.sourcePath}</p></div>
        <div class="project-overview-actions">
          <${Button} onClick=${() => openRelinkModal(activeProject.sourcePath)}>Relink path</${Button}>
          <${Button} onClick=${() => generateRecap(false)} isDisabled=${recapLoading}>${recapLoading ? 'Drafting recap…' : 'Draft recap'}</${Button}>
          <${Button} onClick=${openTemplateModal}>+ Template doc</${Button}>
          <${Button} onClick=${() => setActiveModule('documents')}>Open docs</${Button}>
          <${Button} className="button--primary" onClick=${() => { setActiveModule('tasks'); loadTasks(activeProject.id); }}>Open tasks</${Button}>
        </div>
      </div>
      <div class="project-health-row">
        <${Card} className="project-health-card"><span class="health-icon blue">↗</span><div><small>Open tasks</small><strong>${selectedProjectSummary?.tasks.open ?? tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length}</strong></div><span class="health-footnote">${selectedProjectSummary?.tasks.inProgress ?? tasks.filter(t => t.status === 'in_progress').length} in progress</span></${Card}>
        <${Card} className=${'project-health-card' + ((selectedProjectSummary?.tasks.blocked ?? 0) ? ' warning' : '')}><span class="health-icon orange">!</span><div><small>Blocked</small><strong>${selectedProjectSummary?.tasks.blocked ?? tasks.filter(t => t.status === 'blocked').length}</strong></div><span class="health-footnote">tasks needing attention</span></${Card}>
        <${Card} className="project-health-card"><span class="health-icon violet">▤</span><div><small>Atlas docs</small><strong>${selectedProjectSummary?.docs.count ?? docsList.length}</strong></div><span class="health-footnote">${sourceDocs.length} repo docs read-only</span></${Card}>
        <${Card} className="project-health-card"><span class="health-icon green">⑂</span><div><small>Git branch</small><strong class="branch-value">${selectedProjectSummary?.git?.branch || 'Not a Git repo'}</strong></div><span class="health-footnote">${selectedProjectSummary?.git?.dirtyCount ? `${selectedProjectSummary.git.dirtyCount} working changes` : 'Working tree clean'}</span></${Card}>
      </div>
      <div class="project-overview-grid">
        <div class="project-overview-main">
          ${(selectedProjectSummary?.tasks.total ?? tasks.length) === 0
            && (selectedProjectSummary?.docs.count ?? docsList.length) === 0
            && !profileData?.goals
            && !overviewLoading && html`
            <div class="dashboard-panel onboarding-panel">
              <div class="content-section-heading">
                <div><h2>Start here</h2><p>Set a direction, track the first piece of work, or create a project document.</p></div>
              </div>
              <div class="btn-group">
                <${Button} className="button--primary" onClick=${() => openProfileModal(profileData)}>Set project goals</${Button}>
                <${Button} onClick=${() => setNewTaskModalOpen(true)}>Create first task</${Button}>
                <${Button} onClick=${openTemplateModal}>Create a project document</${Button}>
              </div>
            </div>
          `}
          <div class="dashboard-panel">
            <div class="content-section-heading">
              <div><h2>Work in progress</h2><p>Highest priority open tasks in this project.</p></div>
              <div class="btn-group">
                <${Button} onClick=${() => setNewTaskModalOpen(true)}>+ New task</${Button}>
                <${Button} className="text-link" onClick=${() => setActiveModule('tasks')}>View all →</${Button}>
              </div>
            </div>
            ${(selectedProjectSummary?.tasks.active ?? []).length === 0 && html`<div class="panel-empty">No open tasks yet. Add a task to track work here.</div>`}
            ${(selectedProjectSummary?.tasks.active ?? []).map(task => {
              const trace = taskTraceability[task.id];
              return html`
                <div key=${task.id} class="overview-task-row">
                  <span class=${'priority-mark ' + task.priority}></span>
                  <span class="issue-key-badge">${task.id}</span>
                  <strong>${task.title}</strong>
                  ${(trace?.activeSessions?.length || 0) > 0 && html`<span class="badge" title="Active agent session">⚡ Active</span>`}
                  ${(trace?.matchedCommits?.length || 0) > 0 && html`<span class="badge" title="Linked Git commits">⑂ ${trace.matchedCommits.length}</span>`}
                  <span class=${'task-status-pill ' + task.status}>${task.status.replace('_', ' ')}</span>
                  <div class="btn-group">
                    <${Button} className="text-link" onClick=${() => openImpactModal(task, activeProject.id)}>Task details</${Button}>
                    <${Button} className="text-link" onClick=${() => copyTaskContext(task)}>Copy context</${Button}>
                  </div>
                </div>
              `;
            })}
          </div>
          <div class="dashboard-panel">
            <div class="content-section-heading">
              <div>
                <h2>Project profile & decisions</h2>
                <p>Managed Markdown goals, status (${profileData?.status || 'active'}), key documents, and append-only approved decisions.</p>
              </div>
              <div class="btn-group">
                <${Button} className="text-link" onClick=${() => openProfileModal(profileData)}>Edit profile</${Button}>
                <${Button} className="text-link" onClick=${openDecisionModal}>+ Record decision</${Button}>
              </div>
            </div>
            ${profileData?.goals ? html`<p style="margin:4px 0 8px">${profileData.goals}</p>` : html`<div class="panel-empty compact">No project goals recorded yet. Click "Edit profile" to set goals and key documents.</div>`}
            ${(profileData?.keyDocs ?? []).length > 0 && html`
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
                ${profileData.keyDocs.map(doc => html`<${Button} key=${doc} className="overview-doc-link" onClick=${() => { setActiveModule('documents'); selectDoc(doc); }}>★ ${doc}</${Button}>`)}
              </div>
            `}
            ${(profileData?.decisions ?? []).length > 0 && html`
              <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
                <small class="doc-source-label">APPROVED DECISIONS (${profileData.decisions.length})</small>
                ${profileData.decisions.slice(-4).map(dec => html`
                  <div key=${dec.id} class="overview-session-row">
                    <div><strong>[${dec.id}] ${dec.summary}</strong><small>${dec.date}${dec.rationale ? ` · ${dec.rationale}` : ''}</small></div>
                  </div>
                `)}
              </div>
            `}
          </div>
          ${proposals.length > 0 && html`
            <div class="dashboard-panel">
              <div class="content-section-heading">
                <div><h2>Pending change proposals (${proposals.length})</h2><p>Review impact summaries and confirm before applying scope, priority, or dependency changes.</p></div>
              </div>
              ${proposals.map(prop => html`
                <div key=${prop.id} class="overview-session-row">
                  <div>
                    <strong>Task ${prop.taskId}</strong>
                    <small>${(prop.impact?.changedFields || []).map(f => `${f.field}: ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join(' · ')}</small>
                    ${(prop.impact?.warnings || []).length > 0 && html`<small style="color:var(--warning);display:block">⚠ ${prop.impact.warnings.join('; ')}</small>`}
                  </div>
                  <div class="btn-group">
                    <${Button} className="button--primary" onClick=${() => confirmProposal(prop)}>Confirm & apply</${Button}>
                    <${Button} onClick=${() => rejectProposal(prop)}>Reject</${Button}>
                  </div>
                </div>
              `)}
            </div>
          `}
          ${projectHealth && html`
            <div class="dashboard-panel">
              <div class="content-section-heading">
                <div>
                  <h2>Workspace & knowledge health (Score: ${projectHealth.score}/100)</h2>
                  <p>Checks for broken wiki-links, orphan documents, bottleneck dependencies, and incomplete DoD checklists.</p>
                </div>
                <${Button} className="text-link" onClick=${() => loadProjectHealth(activeProject.id)}>Re-check</${Button}>
              </div>
              ${projectHealth.brokenLinks.length === 0 && projectHealth.dodIssues.length === 0 && projectHealth.bottleneckTasks.length === 0 && projectHealth.orphanDocs.length === 0 && html`
                <div class="panel-empty compact">✓ All wiki-links resolved, task DoD checklists verified, and no orphan docs found.</div>
              `}
              ${projectHealth.brokenLinks.map((bl, idx) => html`
                <div key=${`bl-${idx}`} class="overview-session-row">
                  <div><strong>⚠ Broken link in ${bl.sourcePath}</strong><small>Unresolved target: <code>[[${bl.targetRef}]]</code></small></div>
                  <${Button} className="text-link" onClick=${() => { setActiveModule('documents'); selectDoc(bl.sourcePath); }}>Fix doc</${Button}>
                </div>
              `)}
              ${projectHealth.dodIssues.map(issue => html`
                <div key=${issue.taskId} class="overview-session-row">
                  <div><strong>⚠ DoD Checklist incomplete: [${issue.taskId}] ${issue.title}</strong><small>Marked done with ${issue.uncheckedCount} of ${issue.totalCount} checklist items unchecked</small></div>
                  <${Button} className="text-link" onClick=${() => { setActiveModule('documents'); selectDoc(issue.path); }}>Open task</${Button}>
                </div>
              `)}
              ${projectHealth.bottleneckTasks.map(bn => html`
                <div key=${bn.taskId} class="overview-session-row">
                  <div><strong>🚧 Bottleneck task: [${bn.taskId}] ${bn.title} (${bn.status})</strong><small>Blocking ${bn.blockingTaskIds.length} downstream task(s): ${bn.blockingTaskIds.join(', ')}</small></div>
                </div>
              `)}
              ${projectHealth.orphanDocs.slice(0, 4).map(orp => html`
                <div key=${orp.path} class="overview-session-row">
                  <div><strong>Unlinked note: ${orp.title}</strong><small>${orp.path} (no backlinks or keyDoc reference)</small></div>
                  <${Button} className="text-link" onClick=${() => { setActiveModule('documents'); selectDoc(orp.path); }}>Open</${Button}>
                </div>
              `)}
            </div>
          `}
          <div class="dashboard-panel">
            <div class="content-section-heading"><div><h2>Agent sessions</h2><p>Project-scoped resume notes stored with Atlas documents.</p></div><${Button} className="text-link" onClick=${() => openNewSessionModal('')}>+ New session</${Button}></div>
            ${sessions.length === 0 && html`<div class="panel-empty">No sessions yet. Start one to save a resume note and next action.</div>`}
            ${sessions.slice(0, 5).map(session => html`
              <div key=${session.id} class="overview-session-row">
                <div><${Button} className="overview-doc-link" onClick=${() => { setActiveModule('documents'); selectDoc(session.path); }}><strong>${session.title}</strong></${Button}><small>${session.taskId ? `Task ${session.taskId}` : 'Project session'} · ${session.status}${session.branch ? ` · ${session.branch}` : ''}</small></div>
                <div style="display:flex;align-items:center;gap:6px">
                  <span>${session.nextAction}</span>
                  ${session.status !== 'paused' && session.status !== 'completed' && html`<${Button} className="text-link" onClick=${() => updateSessionStatus(session, 'paused')}>Pause</${Button}>`}
                  ${session.status !== 'completed' && html`<${Button} className="text-link" onClick=${() => updateSessionStatus(session, 'completed')}>Done</${Button}>`}
                </div>
              </div>
            `)}
          </div>
          <div class="dashboard-panel">
            <div class="content-section-heading"><div><h2>Documentation</h2><p>Atlas notes plus Markdown from the imported repository.</p></div><${Button} className="text-link" onClick=${() => setActiveModule('documents')}>Open docs →</${Button}></div>
            <div class="overview-doc-columns">
              <div><span class="doc-source-label">ATLAS DOCS · EDITABLE</span>
                ${(selectedProjectSummary?.docs.paths ?? []).length === 0 && html`<div class="panel-empty compact">No Atlas docs yet.</div>`}
                ${(selectedProjectSummary?.docs.paths ?? []).slice(0, 4).map(doc => html`<${Button} key=${doc} className="overview-doc-link" onClick=${() => { setActiveModule('documents'); selectDoc(doc); }}>▤ ${doc}</${Button}>`)}
              </div>
              <div><span class="doc-source-label">REPOSITORY · READ ONLY</span>
                ${sourceDocs.length === 0 && html`<div class="panel-empty compact">${sourceDocsLoading ? 'Scanning repository…' : 'No Markdown files found.'}</div>`}
                ${sourceDocs.slice(0, 4).map(doc => html`<${Button} key=${doc.path} className="overview-doc-link" onClick=${async () => { setActiveModule('documents'); await openSourceDocument(activeProject, doc.path); }}>▤ ${doc.path}</${Button}>`)}
              </div>
            </div>
          </div>
        </div>
        <div class="dashboard-panel project-git-panel">
          <div class="content-section-heading"><div><h2>Recent commits</h2><p>${selectedProjectSummary?.git?.branch || 'Git history'} · read-only</p></div><${Button} className="text-link" onClick=${() => setActiveModule('activity')}>Full activity →</${Button}></div>
          ${(selectedProjectSummary?.git?.recentCommits ?? []).length === 0 && html`<div class="panel-empty">No Git history available for this project.</div>`}
          ${(selectedProjectSummary?.git?.recentCommits ?? []).map(commit => html`
            <div key=${commit.sha} class="project-commit-row"><span class="activity-rail-dot"></span><div><strong>${commit.subject}</strong><div class="activity-meta"><span>${commit.author}</span><span>${formatDate(commit.timestamp)}</span></div></div><code>${shortSha(commit.sha)}</code></div>
          `)}
          <div class="read-only-hint">LocalAtlas reads the branch, working tree status, and recent commit history. It does not create commits or modify Git state.</div>
        </div>
      </div>
    </div>
  `;
}
