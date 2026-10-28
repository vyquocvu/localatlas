import { useMemo } from 'react';
import { html, Button, TextInput, TreeView } from './Common.js';
import { buildFileTree } from '../utils/markdown.js';
import { getReadyTasks } from '../utils/task-readiness.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useModalStore } from '../stores/useModalStore.js';

export function Sidebar() {
  const {
    activeModule,
    projectsList,
    activeProject,
    selectProject,
    showPortfolio,
    sidebarCollapsed,
    toggleSidebar,
  } = useWorkspaceStore();

  const {
    docSource,
    docsList,
    sourceDocs,
    sourceDocsLoading,
    sourceDocPath,
    activeDoc,
    docFilter,
    collapsed,
    backlinks,
    backlinksOpen,
    setDocSource,
    setDocFilter,
    toggleFolder,
    setBacklinksOpen,
    selectDoc,
    openSourceDocument,
    createDoc,
    renameDoc,
    deleteDoc,
    loadDocs,
    loadSourceDocs,
  } = useDocumentStore();

  const {
    tasks,
    taskSubView,
    taskFilterPriority,
    taskFilterStatus,
    openReadyTasksView,
    setTaskSubView,
    setTaskFilterPriority,
    setTaskFilterStatus,
    loadRollup,
  } = useTaskStore();
  const readyTaskCount = getReadyTasks(tasks).length;

  const {
    openImportModal,
    setNewTaskModalOpen,
    openTemplateModal,
  } = useModalStore();

  const filteredDocsList = useMemo(() => {
    if (!docFilter.trim()) return docsList;
    const q = docFilter.toLowerCase();
    return docsList.filter(d => d.toLowerCase().includes(q));
  }, [docsList, docFilter]);

  const backlinkGroups = useMemo(() => {
    const tasks = [];
    const documents = [];
    for (const backlink of backlinks) {
      (backlink.sourceType === 'task' ? tasks : documents).push(backlink);
    }
    return { tasks, documents };
  }, [backlinks]);

  const filteredSourceDocs = useMemo(() => {
    if (!docFilter.trim()) return sourceDocs;
    const q = docFilter.toLowerCase();
    return sourceDocs.filter(doc => doc.path.toLowerCase().includes(q));
  }, [sourceDocs, docFilter]);

  const tree = useMemo(() => buildFileTree(filteredDocsList), [filteredDocsList]);
  const sourceTree = useMemo(() => buildFileTree(filteredSourceDocs.map(doc => doc.path)), [filteredSourceDocs]);

  const renderBacklink = backlink => html`
    <${Button}
      key=${backlink.sourcePath}
      className="backlink-item"
      onClick=${() => selectDoc(backlink.sourcePath)}
      title=${backlink.sourcePath}
    >
      <span>↩</span><span>${backlink.sourceId ? `[${backlink.sourceId}] ` : ''}${backlink.sourceTitle || backlink.sourcePath}</span>
    </${Button}>
  `;

  if (sidebarCollapsed) {
    return html`
      <aside class="sidebar-rail" aria-label="Sidebar (collapsed)">
        <${Button}
          className="sidebar-rail-toggle"
          onClick=${toggleSidebar}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >»</${Button}>
      </aside>
    `;
  }

  return html`
    <aside>
      ${['portfolio', 'project', 'activity'].includes(activeModule) && html`
        <div class="portfolio-sidebar">
          <div class="sidebar-section-heading">
            <span>Workspace</span>
          </div>
          <${Button}
            className=${'sidebar-workspace-link' + (activeModule === 'portfolio' ? ' active' : '')}
            onClick=${showPortfolio}
          >
            <span class="sidebar-nav-icon">▦</span><span>All projects</span><span class="sidebar-count">${projectsList.length}</span>
          </${Button}>
          <div class="sidebar-project-heading">
            <span>Projects</span>
            <${Button} className="sidebar-add-project" aria-label="Import project" onClick=${openImportModal}>+</${Button}>
          </div>
          <div class="sidebar-project-list">
            ${projectsList.map(project => html`
              <${Button}
                key=${project.id}
                className=${'sidebar-project-link' + (activeProject?.id === project.id ? ' selected' : '')}
                onClick=${() => selectProject(project)}
              >
                <span class="project-avatar">${project.key.slice(0, 1)}</span>
                <span class="sidebar-project-name">${project.name}</span>
                ${activeProject?.id === project.id && html`<span class="sidebar-current-dot"></span>`}
              </${Button}>
            `)}
            ${projectsList.length === 0 && html`<small class="sidebar-empty">Your imported projects will appear here.</small>`}
          </div>
          <${Button} className="sidebar-import-button" onClick=${openImportModal}>+ Import a project</${Button}>
          <div class="sidebar-local-note"><span class="local-dot"></span>Local workspace · source repos stay untouched</div>
        </div>
      `}

      ${activeModule === 'documents' && html`
        <div class="obsidian-vault-header">
          <div class="obsidian-vault-title">${docSource === 'atlas' ? 'Atlas docs' : 'Repository docs'}</div>
          <div class="obsidian-vault-actions">
            ${docSource === 'atlas' && html`<${Button} onClick=${() => createDoc('')} isDisabled=${!activeProject} title="New Markdown document">+ New</${Button}>`}
          </div>
        </div>
        <div class="doc-source-switch" role="tablist" aria-label="Document source">
          <${Button} className=${docSource === 'atlas' ? 'active' : ''} onClick=${async () => { setDocSource('atlas'); await loadDocs(activeProject?.id); }}>Atlas docs <span>${docsList.length}</span></${Button}>
          <${Button} className=${docSource === 'repo' ? 'active' : ''} onClick=${async () => { setDocSource('repo'); await loadSourceDocs(activeProject?.id); }}>Repo docs <span>${sourceDocs.length}</span></${Button}>
        </div>
        ${docSource === 'atlas' ? html`
          <div class="doc-source-note" style="display:flex;justify-content:space-between;align-items:center;gap:6px">
            <span>Markdown kept in LocalAtlas, separate from your source repository.</span>
            <${Button} className="text-link" onClick=${openTemplateModal} isDisabled=${!activeProject} title="Create from Role Template (PRD, ADR, Bug, Release)">+ Template</${Button}>
          </div>
          <${TextInput}
            className="obsidian-filter-input"
            aria-label="Filter Atlas documents"
            placeholder="Find a document…"
            value=${docFilter}
            onInput=${e => setDocFilter(e.target.value)}
          />
          <div class="tree-view">
            <${TreeView}
              nodes=${tree}
              activeDoc=${activeDoc}
              collapsed=${collapsed}
              toggleFolder=${toggleFolder}
              onSelect=${selectDoc}
              onNewInFolder=${createDoc}
              onRename=${renameDoc}
              onDelete=${deleteDoc}
            />
            ${filteredDocsList.length === 0 && html`<small class="tree-empty">No Atlas docs yet. Create a note to start.</small>`}
          </div>
        ` : html`
          <div class="doc-source-note">Read-only Markdown files from the imported repository.</div>
          <${TextInput}
            className="obsidian-filter-input"
            aria-label="Filter repository documents"
            placeholder="Find a repository file…"
            value=${docFilter}
            onInput=${e => setDocFilter(e.target.value)}
          />
          <div class="tree-view">
            ${sourceDocsLoading && html`<small class="tree-empty">Scanning Markdown files…</small>`}
            <${TreeView}
              nodes=${sourceTree}
              activeDoc=${sourceDocPath}
              collapsed=${collapsed}
              toggleFolder=${toggleFolder}
              onSelect=${path => openSourceDocument(activeProject, path)}
              onNewInFolder=${() => {}}
              onRename=${() => {}}
              onDelete=${() => {}}
              readOnly
            />
            ${!sourceDocsLoading && filteredSourceDocs.length === 0 && html`<small class="tree-empty">${sourceDocs.length ? 'No repository files match this filter.' : 'No Markdown files found in this repository.'}</small>`}
          </div>
        `}
        ${docSource === 'atlas' && activeDoc && html`
          <div class="obsidian-backlinks-pane">
            <${Button} className="backlinks-header" onClick=${() => setBacklinksOpen(o => !o)}>
              <span>Linked mentions (${backlinks.length})</span>
              <span style="font-size:10px">${backlinksOpen ? '▾' : '▸'}</span>
            </${Button}>
            ${backlinksOpen && html`
              <div class="backlinks-list">
                ${backlinks.length === 0
                  ? html`<small class="muted" style="padding:4px 6px">No backlinks found</small>`
                  : html`
                    ${backlinkGroups.tasks.length > 0 && html`
                      <small class="backlink-group-label">Tasks (${backlinkGroups.tasks.length})</small>
                      ${backlinkGroups.tasks.map(renderBacklink)}
                    `}
                    ${backlinkGroups.documents.length > 0 && html`
                      <small class="backlink-group-label">Documents (${backlinkGroups.documents.length})</small>
                      ${backlinkGroups.documents.map(renderBacklink)}
                    `}
                  `}
              </div>
            `}
          </div>
        `}
      `}

      ${activeModule === 'tasks' && html`
        <div class="task-sidebar-top">
          <${Button}
            className="button--primary task-new-button"
            onClick=${() => setNewTaskModalOpen(true)}
            disabled=${!activeProject}
          >+ New task</${Button}>
        </div>
        <div class="linear-sidebar-section">
          <div class="section-heading" style="padding:0 6px"><h3>Views</h3></div>
          <${Button} className=${'linear-nav-item' + (taskSubView === 'board' ? ' active' : '')} onClick=${() => setTaskSubView('board')}><span>▦</span><span>Board (Kanban)</span><span class="linear-filter-badge">${tasks.length}</span></${Button}>
          <${Button} className=${'linear-nav-item' + (taskSubView === 'list' ? ' active' : '')} onClick=${() => setTaskSubView('list')}><span>☰</span><span>All tasks</span><span class="linear-filter-badge">${tasks.length}</span></${Button}>
          <${Button} className=${'linear-nav-item' + (taskSubView === 'ready' ? ' active' : '')} onClick=${openReadyTasksView}><span>▶</span><span>Ready to start</span><span class="linear-filter-badge">${readyTaskCount}</span></${Button}>
          <${Button} className=${'linear-nav-item' + (taskSubView === 'roadmap' ? ' active' : '')} onClick=${() => { setTaskSubView('roadmap'); if (activeProject) loadRollup(activeProject.id); }}><span>◈</span><span>Roadmap</span></${Button}>
        </div>
        <hr />
        <div class="linear-sidebar-section">
          <div class="section-heading" style="padding:0 6px"><h3>Priority</h3></div>
          ${[
            { id: '', label: 'All priorities' },
            { id: 'critical', label: 'Critical' },
            { id: 'high', label: 'High' },
            { id: 'medium', label: 'Medium' },
            { id: 'low', label: 'Low' },
          ].map(p => html`
            <${Button} key=${p.id} className=${'linear-nav-item' + (taskFilterPriority === p.id ? ' active' : '')} onClick=${() => setTaskFilterPriority(p.id)}>
              <span>${p.id ? '•' : '○'}</span><span>${p.label}</span><span class="linear-filter-badge">${p.id ? tasks.filter(t => t.priority === p.id).length : tasks.length}</span>
            </${Button}>
          `)}
        </div>
        <hr />
        <div class="linear-sidebar-section">
          <div class="section-heading" style="padding:0 6px"><h3>Status</h3></div>
          ${[
            { id: '', label: 'All statuses' },
            { id: 'todo', label: 'To do' },
            { id: 'in_progress', label: 'In progress' },
            { id: 'blocked', label: 'Blocked' },
            { id: 'done', label: 'Done' },
            { id: 'cancelled', label: 'Cancelled' },
          ].map(s => html`
            <${Button} key=${s.id} className=${'linear-nav-item' + (taskFilterStatus === s.id ? ' active' : '')} onClick=${() => setTaskFilterStatus(s.id)}>
              <span>${s.id ? '•' : '○'}</span><span>${s.label}</span><span class="linear-filter-badge">${s.id ? tasks.filter(t => t.status === s.id).length : tasks.length}</span>
            </${Button}>
          `)}
        </div>
      `}
    </aside>
  `;
}
