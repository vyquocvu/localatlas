import { useState } from 'react';
import { html, Button, Card, SelectField } from './Common.js';
import { formatDate } from '../utils/markdown.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';

const ITEM_LABELS = {
  task: 'Task needs attention',
  proposal: 'Pending proposal',
  session: 'Session to resume',
  broken_link: 'Broken link',
};

export function AttentionInbox() {
  const [isOpen, setIsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const {
    projectsList,
    portfolioAttention,
    portfolioAttentionLoading,
    loadPortfolioAttention,
    selectProject,
    setActiveModule,
  } = useWorkspaceStore();

  const openItem = async item => {
    const project = projectsList.find(candidate => candidate.id === item.projectId);
    if (!project) return;
    if (!useDocumentStore.getState().canDiscard()) return;
    await selectProject(project);
    if (useWorkspaceStore.getState().activeProject?.id !== project.id) return;
    await useDocumentStore.getState().selectDoc(item.path);
    setActiveModule('documents');
  };

  const visibleProjects = (portfolioAttention?.projects || []).filter(project => statusFilter === 'all' || project.status === statusFilter);
  const visibleProjectIds = new Set(visibleProjects.map(project => project.project.id));
  const items = (portfolioAttention?.items || []).filter(item => visibleProjectIds.has(item.projectId));

  return html`
    <section class="attention-inbox-section">
      <div class="content-section-heading">
        <div><h2>Attention inbox</h2><p>Review work that needs a person. Nothing is changed automatically.</p></div>
        <${Button} onClick=${() => {
          const nextOpen = !isOpen;
          setIsOpen(nextOpen);
          if (nextOpen) loadPortfolioAttention();
        }}>${isOpen ? 'Hide inbox' : 'Review attention'}</${Button}>
      </div>
      ${isOpen && html`
        <div class="attention-inbox">
          <div class="attention-inbox-toolbar">
            <span>Evidence generated ${formatDate(portfolioAttention?.generatedAt)}</span>
            <${SelectField} ariaLabel="Filter projects by status" value=${statusFilter} onChange=${setStatusFilter} options=${[
              { value: 'active', label: 'Active projects' }, { value: 'paused', label: 'Paused projects' }, { value: 'archived', label: 'Archived projects' }, { value: 'all', label: 'All projects' },
            ]} />
            <${Button} isDisabled=${portfolioAttentionLoading} onClick=${loadPortfolioAttention}>${portfolioAttentionLoading ? 'Refreshing…' : 'Refresh inbox'}</${Button}>
          </div>
          ${portfolioAttentionLoading && !portfolioAttention && html`<div class="loading-panel">Collecting task, session, proposal, and link evidence…</div>`}
          ${!portfolioAttentionLoading && portfolioAttention && items.length === 0 && html`<div class="panel-empty">No attention items for these project statuses.</div>`}
          <div class="attention-project-list">
            ${visibleProjects.map(projectSummary => {
              const projectItems = items.filter(item => item.projectId === projectSummary.project.id);
              return html`<${Card} key=${projectSummary.project.id} className="attention-project-card">
                <div class="attention-project-heading">
                  <strong>${projectSummary.project.key} · ${projectSummary.project.name}</strong>
                  <span class="badge">${projectSummary.status}</span>
                  ${projectSummary.healthScore !== null && html`<span class="attention-health-score" title="Heuristic score: link, DoD, orphan, and blocked-task penalties; it is a triage hint, not a quality verdict.">Health hint ${projectSummary.healthScore}/100</span>`}
                </div>
                ${projectSummary.errors.map(error => html`<p class="attention-error" key=${`${projectSummary.project.id}:${error.source}`}>${error.source}: ${error.message}</p>`)}
                ${projectSummary.orphanDocsCount > 0 && html`<p class="attention-info">${projectSummary.orphanDocsCount} unlinked note(s) · informational only; no repair is requested.</p>`}
                ${projectItems.map(item => html`<div class="attention-item" key=${item.id}>
                  <span class=${`attention-severity ${item.severity}`}>${ITEM_LABELS[item.type]}</span>
                  <div class="attention-item-copy"><strong>${item.title}</strong><span>${item.evidence}</span><small>Evidence: ${formatDate(item.updatedAt || projectSummary.generatedAt)} · ${item.path}</small></div>
                  <${Button} className="text-link" onClick=${() => openItem(item)}>Open source</${Button}>
                </div>`)}
              </${Card}>`;
            })}
          </div>
          ${portfolioAttention && html`<p class="attention-method-note">Broken links are actionable; orphan notes are informational. Health scores are heuristic and use the same evidence timestamp shown above.</p>`}
        </div>
      `}
    </section>
  `;
}
