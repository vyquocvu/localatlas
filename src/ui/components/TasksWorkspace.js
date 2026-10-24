import { useMemo } from 'react';
import { html, Button, Card, TextInput, SelectField } from './Common.js';
import { shortSha } from '../utils/markdown.js';
import { getReadyTasks, getTaskReadiness } from '../utils/task-readiness.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useModalStore } from '../stores/useModalStore.js';

export function TasksWorkspace() {
  const { activeProject, setActiveModule, launchCodex, setNotice } = useWorkspaceStore();
  const { selectDoc } = useDocumentStore();
  const {
    tasks,
    taskSubView,
    cancelledCollapsed,
    taskFilterPriority,
    taskFilterStatus,
    taskFilterEpic,
    taskFilterMilestone,
    taskSearch,
    taskSort,
    savedTaskViews,
    taskViewNameInput,
    rollupData,
    taskTraceability,
    setTaskSearch,
    setTaskFilterEpic,
    setTaskFilterMilestone,
    setTaskSort,
    setTaskViewNameInput,
    saveTaskView,
    applySavedTaskView,
    deleteSavedTaskView,
    resetTaskFilters,
    updateTaskStatus,
    copyTaskContext,
    setCancelledCollapsed,
  } = useTaskStore();
  const { setNewTaskModalOpen, openImpactModal, openStructureModal } = useModalStore();

  const filteredTasks = useMemo(() => {
    const matching = tasks.filter(t => {
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
    const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
    return matching.sort((a, b) => taskSort === 'id'
      ? a.id.localeCompare(b.id, undefined, { numeric: true })
      : taskSort === 'title'
        ? a.title.localeCompare(b.title)
        : (priorityRank[a.priority] ?? 4) - (priorityRank[b.priority] ?? 4) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [tasks, taskFilterPriority, taskFilterStatus, taskSearch, taskFilterEpic, taskFilterMilestone, taskSort]);
  const readyTasks = useMemo(() => getReadyTasks(tasks, filteredTasks), [tasks, filteredTasks]);
  const notReadyTasks = useMemo(() => filteredTasks.filter(task => !getTaskReadiness(task, tasks).ready && task.status !== 'done' && task.status !== 'cancelled'), [tasks, filteredTasks]);

  const handleSaveTaskView = () => {
    const result = saveTaskView(taskViewNameInput, activeProject?.id);
    if (!result.ok) setNotice(result.error);
    else setNotice(`Saved task view “${taskViewNameInput.trim()}”`);
  };

  const renderKanbanCard = t => {
    const trace = taskTraceability[t.id];
    const hasActiveSession = (trace?.activeSessions?.length || 0) > 0;
    const taskIdCommitCount = trace?.taskIdCommits?.length || 0;
    const sessionStartCount = trace?.sessionStartCommits?.length || 0;
    const blockers = (t.dependsOn || []).map(id => tasks.find(item => item.id.toLowerCase() === id.toLowerCase())).filter(item => item && item.status !== 'done' && item.status !== 'cancelled');
    const unblocks = tasks.filter(item => item.dependsOn?.some(id => id.toLowerCase() === t.id.toLowerCase()));
    return html`
      <${Card} key=${t.id} className="kanban-card" variant="secondary">
        <div class="kanban-card-top">
          <span class="issue-key-badge">${t.id}</span>
          <span class=${'priority-pill ' + t.priority}>${t.priority}</span>
        </div>
        ${(t.dependsOn?.length || unblocks.length) ? html`<div class="task-dependency-meta">
          ${blockers.map(item => html`<span key=${item.id} class="badge" title="This task is not ready until the dependency is done or cancelled">Blocked by ${item.id}</span>`)}
          ${unblocks.map(item => html`<span key=${item.id} class="badge" title="This task is a dependency for this task">Unblocks ${item.id}</span>`)}
          ${(t.dependsOn || []).filter(id => !tasks.some(item => item.id.toLowerCase() === id.toLowerCase())).map(id => html`<span key=${id} class="badge" style="color:var(--danger)">Missing dependency ${id}</span>`)}
        </div>` : null}
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
        ${(hasActiveSession || taskIdCommitCount > 0 || sessionStartCount > 0 || trace?.dodWarning) && html`
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0;font-size:11px">
            ${hasActiveSession && html`<span class="badge" title="Active agent session working on this task">⚡ Active session</span>`}
            ${taskIdCommitCount > 0 && html`<span class="badge" title=${`Task ID appears in the latest 5 commit subjects; this does not prove completion.\n${trace.taskIdCommits.map(c => `${shortSha(c.sha)} ${c.subject}`).join('\n')}`}>⑂ ${taskIdCommitCount} task-ID commit${taskIdCommitCount > 1 ? 's' : ''}</span>`}
            ${sessionStartCount > 0 && html`<span class="badge" title=${`HEAD from the latest 5 commits was recorded when an agent session started; this is starting repository state, not task completion.\n${trace.sessionStartCommits.map(c => `${shortSha(c.sha)} ${c.subject}`).join('\n')}`}>◷ ${sessionStartCount} session-start HEAD${sessionStartCount > 1 ? 's' : ''}</span>`}
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
          <${Button} className="text-link" title="Open Codex with this task and its linked context" onClick=${() => launchCodex({ type: 'task', id: t.id })}>Ask Codex</${Button}>
          <${Button} className="text-link" title="Copy bounded task context" onClick=${() => copyTaskContext(t)}>Copy context</${Button}>
          <${Button} className="text-link" title="Open task details and propose reviewed changes" onClick=${() => openImpactModal(t, activeProject.id)}>Propose change</${Button}>
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
          <${TextInput} aria-label="Filter title or ID" placeholder="Filter tasks…" value=${taskSearch} onInput=${event => setTaskSearch(event.target.value)} />
          <${Button} className="button--primary" onClick=${() => setNewTaskModalOpen(true)}>+ New task</${Button}>
        </div>
      </div>

      ${taskSubView !== 'roadmap' && html`
        <div class="saved-views-toolbar">
          <div class="saved-views-list"><strong>Saved views</strong>
            ${savedTaskViews.map(view => html`<span key=${view.name} class="saved-view-chip"><${Button} className="text-link" title=${`Apply saved view ${view.name}`} onClick=${() => applySavedTaskView(view)}>${view.name}</${Button}><${Button} className="text-link saved-view-delete" title=${`Delete saved view ${view.name}`} aria-label=${`Delete saved view ${view.name}`} onClick=${() => deleteSavedTaskView(view.name, activeProject.id)}>×</${Button}></span>`)}
          </div>
          <div class="saved-views-actions">
            <${TextInput} aria-label="Saved view name" placeholder="Name current filters" value=${taskViewNameInput} onInput=${event => setTaskViewNameInput(event.target.value)} />
            <${Button} onClick=${handleSaveTaskView} isDisabled=${!taskViewNameInput.trim()}>Save view</${Button}>
            <${SelectField} ariaLabel="Sort tasks" value=${taskSort} onChange=${setTaskSort} options=${[
              { value: 'priority', label: 'Priority: high first' }, { value: 'id', label: 'ID: ascending' }, { value: 'title', label: 'Title: A–Z' },
            ]} />
            <${SelectField} ariaLabel="Filter by epic" value=${taskFilterEpic} onChange=${setTaskFilterEpic} options=${[{ value: '', label: 'All epics' }, ...(rollupData.epics || []).map(item => ({ value: item.id, label: item.title }))]} />
            <${SelectField} ariaLabel="Filter by milestone" value=${taskFilterMilestone} onChange=${setTaskFilterMilestone} options=${[{ value: '', label: 'All milestones' }, ...(rollupData.milestones || []).map(item => ({ value: item.id, label: item.title }))]} />
            <${Button} onClick=${resetTaskFilters}>Reset filters</${Button}>
          </div>
        </div>
      `}

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
        ${filteredTasks.some(task => task.status === 'cancelled') && html`
          <section class="cancelled-tasks-section">
            <div class="kanban-column-header">
              <${Button}
                className="text-link"
                aria-expanded=${!cancelledCollapsed}
                onClick=${() => setCancelledCollapsed(!cancelledCollapsed)}
              >${cancelledCollapsed ? '▸ Show' : '▾ Hide'} cancelled tasks</${Button}>
              <span class="linear-filter-badge">${filteredTasks.filter(task => task.status === 'cancelled').length}</span>
            </div>
            ${!cancelledCollapsed && html`<div class="cancelled-task-cards">${filteredTasks.filter(task => task.status === 'cancelled').map(task => renderKanbanCard(task))}</div>`}
          </section>
        `}
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
              <span class="task-list-meta">${task.epic || task.milestone || '—'}${task.dependsOn?.length ? ` · depends on ${task.dependsOn.join(', ')}` : ''}</span>
              <${Button} className="text-link" title="Open Codex with this task and its linked context" onClick=${() => launchCodex({ type: 'task', id: task.id })}>Ask Codex</${Button}>
            </div>
          `)}
        </div>
      `}

      ${taskSubView === 'ready' && html`
        <section class="ready-tasks-view">
          <div class="content-section-heading"><div><h2>Ready to start</h2><p>Open tasks with all same-project dependencies resolved, ordered by priority. Suggestions do not claim or change tasks.</p></div></div>
          ${readyTasks.length === 0 && html`<div class="panel-empty">No tasks are ready under the current filters. Tasks with missing or unfinished dependencies are excluded.</div>`}
          <div class="ready-task-list">${readyTasks.map((task, index) => html`<div key=${task.id} class="ready-task-entry"><div class="ready-task-reason"><span class="badge">#${index + 1} · ${task.priority}</span><span>${getTaskReadiness(task, tasks).reason}</span></div>${renderKanbanCard(task)}</div>`)}</div>
          ${notReadyTasks.length > 0 && html`<details class="not-ready-tasks"><summary>Not ready yet (${notReadyTasks.length})</summary><div class="not-ready-list">${notReadyTasks.map(task => html`<div key=${task.id}><strong>${task.id}</strong> · ${task.title} <span class="muted-text">${getTaskReadiness(task, tasks).reason}</span></div>`)}</div></details>`}
        </section>
      `}

      ${taskSubView === 'roadmap' && html`
        <div class="roadmap-container">
          ${rollupData.brokenReferences?.length > 0 && html`<div class="banner banner-danger"><strong>Broken references (${rollupData.brokenReferences.length})</strong><div class="broken-reference-list">${rollupData.brokenReferences.map(item => html`<div key=${item.taskId || item.path}>${item.title} · ${[item.missingEpic && `missing epic ${item.missingEpic}`, item.missingMilestone && `missing milestone ${item.missingMilestone}`, item.missingDependencies?.length && `missing dependencies ${item.missingDependencies.join(', ')}`, item.dependencyCycle && 'dependency cycle'].filter(Boolean).join('; ')}</div>`)}</div></div>`}
          <div><div class="content-section-heading"><div><h2>Milestones</h2><p>Progress based on linked Markdown tasks.</p></div><${Button} onClick=${() => openStructureModal('milestone', null, activeProject.id)}>+ New milestone</${Button}></div><div class="roadmap-list">
            ${(rollupData.milestones || []).map(milestone => html`<${Card} key=${milestone.id} className="roadmap-card"><div class="roadmap-heading"><strong>${milestone.title}</strong><span class="badge">${milestone.status}</span><${Button} className="text-link" onClick=${() => openStructureModal('milestone', milestone, activeProject.id)}>Edit</${Button}></div><div class="roadmap-meta">${milestone.targetDate ? `Target date: ${milestone.targetDate} · ` : ''}${milestone.counts.done} of ${milestone.counts.total - milestone.counts.cancelled} tasks complete · ${(milestone.counts.completionRatio * 100).toFixed(0)}%</div><div class="progress-bar"><div class="progress-fill" style=${`width:${(milestone.counts.completionRatio * 100).toFixed(1)}%`}></div></div></${Card}>`)}
          </div></div>
          <div><div class="content-section-heading"><div><h2>Epics</h2><p>Grouped work across this project.</p></div><${Button} onClick=${() => openStructureModal('epic', null, activeProject.id)}>+ New epic</${Button}></div><div class="roadmap-list">
            ${(rollupData.epics || []).map(epic => html`<${Card} key=${epic.id} className="roadmap-card"><div class="roadmap-heading"><strong>${epic.title}</strong><span class="badge">${epic.status}</span><${Button} className="text-link" onClick=${() => openStructureModal('epic', epic, activeProject.id)}>Edit</${Button}></div><div class="roadmap-meta">${epic.counts.done} of ${epic.counts.total - epic.counts.cancelled} tasks complete · ${(epic.counts.completionRatio * 100).toFixed(0)}%</div><div class="progress-bar"><div class="progress-fill" style=${`width:${(epic.counts.completionRatio * 100).toFixed(1)}%`}></div></div></${Card}>`)}
          </div></div>
          ${(rollupData.milestones || []).length === 0 && (rollupData.epics || []).length === 0 && html`<div class="panel-empty">No milestones or epics yet. Add frontmatter to Atlas task documents to organize the roadmap.</div>`}
        </div>
      `}
    </div>
  `;
}
