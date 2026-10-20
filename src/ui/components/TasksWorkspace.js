import { useMemo } from 'react';
import { html, Button, Card, TextInput, SelectField } from './Common.js';
import { shortSha } from '../utils/markdown.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useModalStore } from '../stores/useModalStore.js';

export function TasksWorkspace() {
  const { activeProject, setActiveModule } = useWorkspaceStore();
  const { selectDoc } = useDocumentStore();
  const {
    tasks,
    taskSubView,
    taskFilterPriority,
    taskFilterStatus,
    taskFilterEpic,
    taskFilterMilestone,
    taskSearch,
    rollupData,
    taskTraceability,
    setTaskSearch,
    updateTaskStatus,
    copyTaskContext,
  } = useTaskStore();
  const { setNewTaskModalOpen } = useModalStore();

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (taskFilterPriority && t.priority !== taskFilterPriority) return false;
      if (taskFilterStatus && t.status !== taskFilterStatus) return false;
      if (taskSearch) {
        const q = taskSearch.toLowerCase();
        const matchesTitle = t.title?.toLowerCase().includes(q);
        const matchesId = t.id?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesId) return false;
      }
      if (taskFilterEpic && (!t.epic || !t.epic.toLowerCase().includes(taskFilterEpic.toLowerCase()))) return false;
      if (taskFilterMilestone && (!t.milestone || !t.milestone.toLowerCase().includes(taskFilterMilestone.toLowerCase()))) return false;
      return true;
    });
  }, [tasks, taskFilterPriority, taskFilterStatus, taskSearch, taskFilterEpic, taskFilterMilestone]);

  const renderKanbanCard = t => {
    const trace = taskTraceability[t.id];
    const hasActiveSession = (trace?.activeSessions?.length || 0) > 0;
    const commitCount = trace?.matchedCommits?.length || 0;
    return html`
      <${Card} key=${t.id} className="kanban-card" variant="secondary">
        <div class="kanban-card-top">
          <span class="issue-key-badge">${t.id}</span>
          <span class=${'priority-pill ' + t.priority}>${t.priority}</span>
        </div>
        <a
          href="#"
          onClick=${e => {
            e.preventDefault();
            selectDoc(t.path);
            setActiveModule('documents');
          }}
          class="kanban-card-title"
          title=${t.path}
        >
          ${t.title}
        </a>
        <div class="kanban-card-meta">
          ${t.checklist?.total > 0
            ? html`<span>☑ ${t.checklist.checked}/${t.checklist.total}</span>`
            : html`<span>${t.epic || ''}</span>`}
          ${t.milestone ? html`<span>${t.milestone}</span>` : html`<span></span>`}
        </div>
        ${(hasActiveSession || commitCount > 0 || trace?.dodWarning) && html`
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0;font-size:11px">
            ${hasActiveSession && html`<span class="badge" title="Active agent session working on this task">⚡ Active session</span>`}
            ${commitCount > 0 && html`<span class="badge" title=${trace.matchedCommits.map(c => `${shortSha(c.sha)} ${c.subject}`).join('\n')}>⑂ ${commitCount} commit${commitCount > 1 ? 's' : ''}</span>`}
            ${trace?.dodWarning && html`<span class="badge" style="color:var(--warning)" title=${trace.dodWarning}>⚠ DoD incomplete</span>`}
          </div>
        `}
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
          <${SelectField}
            className="task-status-select"
            value=${t.status}
            ariaLabel=${`Status for ${t.title}`}
            onChange=${value => updateTaskStatus(t, value)}
            options=${[
              { value: 'todo', label: 'To Do' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'blocked', label: 'Blocked' },
              { value: 'done', label: 'Done' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <${Button} className="text-link" title="Copy bounded agent prompt & context" onClick=${() => copyTaskContext(t)}>Prompt</${Button}>
        </div>
      </${Card}>
    `;
  };

  if (!activeProject) return null;

  return html`
    <div class="tasks-page">
      <div class="linear-toolbar task-page-toolbar">
        <div class="page-heading compact-heading">
          <div class="eyebrow">${activeProject.key} · PROJECT WORK</div>
          <h1>Tasks</h1>
          <p>Track planned, active, blocked, and completed work.</p>
        </div>
        <div class="task-toolbar-controls">
          <${TextInput} aria-label="Filter title or ID" placeholder="Filter tasks…" value=${taskSearch} onInput=${e => setTaskSearch(e.target.value)} />
          <${Button} className="button--primary" onClick=${() => setNewTaskModalOpen(true)}>+ New task</${Button}>
        </div>
      </div>

      ${taskSubView === 'board' && html`
        <div class="kanban-board">
          ${[
            { status: 'todo', label: 'To do' },
            { status: 'in_progress', label: 'In progress' },
            { status: 'blocked', label: 'Blocked' },
            { status: 'done', label: 'Done' },
          ].map(column => {
            const columnTasks = filteredTasks.filter(task => task.status === column.status);
            return html`<div key=${column.status} class="kanban-column"><div class="kanban-column-header"><span>${column.label}</span><span class="linear-filter-badge">${columnTasks.length}</span></div><div class="kanban-column-cards">${columnTasks.map(task => renderKanbanCard(task))}</div></div>`;
          })}
        </div>
      `}

      ${taskSubView === 'list' && html`
        <div class="task-list-panel">
          <div class="task-list-header"><span>Priority</span><span>Key</span><span>Task</span><span>Status</span><span>Epic / milestone</span></div>
          ${filteredTasks.length === 0 && html`<div class="panel-empty">No tasks match the current filters.</div>`}
          ${filteredTasks.map(task => html`
            <div key=${task.id} class="task-list-row">
              <span class=${'priority-pill ' + task.priority}>${task.priority}</span>
              <span class="issue-key-badge">${task.id}</span>
              <${Button} className="task-list-title" onClick=${() => { selectDoc(task.path); setActiveModule('documents'); }}>${task.title}</${Button}>
              <${SelectField} className="task-status-select" value=${task.status} ariaLabel=${`Status for ${task.title}`} onChange=${value => updateTaskStatus(task, value)} options=${[
                { value: 'todo', label: 'To do' }, { value: 'in_progress', label: 'In progress' }, { value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' },
              ]} />
              <span class="task-list-meta">${task.epic || task.milestone || '—'}</span>
            </div>
          `)}
        </div>
      `}

      ${taskSubView === 'roadmap' && html`
        <div class="roadmap-container">
          ${rollupData.brokenReferences?.length > 0 && html`<div class="banner banner-danger"><strong>Broken references (${rollupData.brokenReferences.length})</strong><div class="broken-reference-list">${rollupData.brokenReferences.map(item => html`<div key=${item.taskId || item.path}>${item.title} · missing ${item.missingEpic || item.missingMilestone}</div>`)}</div></div>`}
          <div><div class="content-section-heading"><div><h2>Milestones</h2><p>Progress based on linked Markdown tasks.</p></div></div><div class="roadmap-list">
            ${(rollupData.milestones || []).map(milestone => html`<${Card} key=${milestone.id} className="roadmap-card"><div class="roadmap-heading"><strong>${milestone.title}</strong><span class="badge">${milestone.status}</span></div><div class="roadmap-meta">${milestone.counts.done} of ${milestone.counts.total - milestone.counts.cancelled} tasks complete · ${(milestone.counts.completionRatio * 100).toFixed(0)}%</div><div class="progress-bar"><div class="progress-fill" style=${`width:${(milestone.counts.completionRatio * 100).toFixed(1)}%`}></div></div></${Card}>`)}
          </div></div>
          <div><div class="content-section-heading"><div><h2>Epics</h2><p>Grouped work across this project.</p></div></div><div class="roadmap-list">
            ${(rollupData.epics || []).map(epic => html`<${Card} key=${epic.id} className="roadmap-card"><div class="roadmap-heading"><strong>${epic.title}</strong><span class="badge">${epic.status}</span></div><div class="roadmap-meta">${epic.counts.done} of ${epic.counts.total - epic.counts.cancelled} tasks complete · ${(epic.counts.completionRatio * 100).toFixed(0)}%</div><div class="progress-bar"><div class="progress-fill" style=${`width:${(epic.counts.completionRatio * 100).toFixed(1)}%`}></div></div></${Card}>`)}
          </div></div>
          ${(rollupData.milestones || []).length === 0 && (rollupData.epics || []).length === 0 && html`<div class="panel-empty">No milestones or epics yet. Add frontmatter to Atlas task documents to organize the roadmap.</div>`}
        </div>
      `}
    </div>
  `;
}
