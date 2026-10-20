import { html, Button } from './Common.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useModalStore } from '../stores/useModalStore.js';

export function Header() {
  const { activeProject, activeModule, terminalPanelOpen, toggleTerminalPanel, overviewLoading, notice, showPortfolio, setActiveModule, loadOverview } = useWorkspaceStore();
  const { canDiscard, loadDocs, loadSourceDocs } = useDocumentStore();
  const { loadTasks, loadRollup, loadTraceability } = useTaskStore();
  const { setProjectModalOpen, setSearchModalOpen } = useModalStore();

  return html`
    <header class="app-header">
      <div class="header-left">
        <div class="brand">
          <span class="brand-mark">A</span>
          <span>LocalAtlas</span>
        </div>
        <${Button}
          className="project-switcher-btn"
          onClick=${() => setProjectModalOpen(true)}
          title="Switch project or import directory"
        >
          <span class="project-key-tag">${activeProject ? activeProject.key : 'WORKSPACE'}</span>
          <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${activeProject ? activeProject.name : 'All projects'}</span>
          <span style="opacity:0.6;font-size:9px">▾</span>
        </${Button}>
      </div>

      <div class="header-center">
        <nav class="module-switcher" aria-label="Workspace navigation">
          <${Button}
            className=${'module-tab' + (activeModule === 'portfolio' ? ' active' : '')}
            aria-pressed=${activeModule === 'portfolio'}
            onClick=${showPortfolio}
          >All projects</${Button}>
          ${activeProject && html`
            <span class="module-tab-divider" aria-hidden="true"></span>
            <${Button}
              className=${'module-tab' + (activeModule === 'project' ? ' active' : '')}
              aria-pressed=${activeModule === 'project'}
              onClick=${() => setActiveModule('project')}
            >Overview</${Button}>
            <${Button}
              className=${'module-tab' + (activeModule === 'documents' ? ' active' : '')}
              aria-pressed=${activeModule === 'documents'}
              onClick=${async () => {
                if (!canDiscard()) return;
                setActiveModule('documents');
                await loadDocs(activeProject.id);
                await loadSourceDocs(activeProject.id);
              }}
            >Docs</${Button}>
            <${Button}
              className=${'module-tab' + (activeModule === 'tasks' ? ' active' : '')}
              aria-pressed=${activeModule === 'tasks'}
              onClick=${() => {
                setActiveModule('tasks');
                loadTasks(activeProject.id);
                loadRollup(activeProject.id);
                loadTraceability(activeProject.id);
              }}
            >Tasks</${Button}>
            <${Button}
              className=${'module-tab' + (activeModule === 'codex' ? ' active' : '')}
              aria-pressed=${activeModule === 'codex'}
              onClick=${() => setActiveModule('codex')}
            >Codex</${Button}>
            <${Button}
              className=${'module-tab' + (activeModule === 'activity' ? ' active' : '')}
              aria-pressed=${activeModule === 'activity'}
              onClick=${() => {
                setActiveModule('activity');
                loadOverview();
              }}
            >Git activity</${Button}>
            <${Button}
              className=${'module-tab' + (terminalPanelOpen ? ' active' : '')}
              aria-pressed=${terminalPanelOpen}
              aria-controls="project-terminal-dock"
              onClick=${toggleTerminalPanel}
            >Terminal</${Button}>
          `}
        </nav>
      </div>

      <div class="header-right">
        <${Button}
          className="header-refresh"
          onClick=${loadOverview}
          isDisabled=${overviewLoading}
          aria-label="Refresh workspace data"
        >
          ${overviewLoading ? 'Refreshing…' : '↻ Refresh'}
        </${Button}>
        <${Button}
          class="header-search"
          onClick=${() => setSearchModalOpen(true)}
        >
          ⌕ Search <kbd>⌘ K</kbd>
        </${Button}>
        <small class="header-notice">${notice}</small>
      </div>
    </header>
  `;
}
