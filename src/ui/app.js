import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from './components/Common.js';
import { Header } from './components/Header.js';
import { Sidebar } from './components/Sidebar.js';
import { PortfolioView } from './components/PortfolioView.js';
import { ProjectOverview } from './components/ProjectOverview.js';
import { GitActivityView } from './components/GitActivityView.js';
import { ProjectTerminalPanel } from './components/ProjectTerminalPanel.js';
import { DocumentWorkspace } from './components/DocumentWorkspace.js';
import { TasksWorkspace } from './components/TasksWorkspace.js';
import { Modals } from './components/Modals.js';

import { useWorkspaceStore } from './stores/useWorkspaceStore.js';
import { useDocumentStore } from './stores/useDocumentStore.js';
import { useTaskStore } from './stores/useTaskStore.js';
import { useSessionStore } from './stores/useSessionStore.js';
import { useProfileStore } from './stores/useProfileStore.js';
import { useModalStore } from './stores/useModalStore.js';

import {
  parseHashRoute,
  setHashRoute,
  buildFileTree,
  resolveRelativeDocLink,
  renderMarkdownSafe,
} from './utils/markdown.js';

import './styles.css';

export { buildFileTree, resolveRelativeDocLink, renderMarkdownSafe };

export function App() {
  const {
    activeProject,
    activeModule,
    sidebarCollapsed,
    loadProjects,
    loadOverview,
    setActiveProject,
  } = useWorkspaceStore();

  const {
    activeDoc,
    etag,
    dirty,
    loadDocs,
    loadSourceDocs,
    openDocument,
    saveDocument,
    loadBacklinks,
    setConflict,
    setDocSource,
  } = useDocumentStore();

  const { loadTasks, loadRollup, loadTraceability } = useTaskStore();
  const { loadSessions } = useSessionStore();
  const { loadProfile, loadProposals, loadProjectHealth } = useProfileStore();
  const {
    searchModalOpen,
    searchQuery,
    searchType,
    searchStatus,
    setSearchModalOpen,
    performSearch,
  } = useModalStore();

  // Hash-based routing synchronization
  useEffect(() => {
    let mounted = true;
    let lastSyncedHash = null;
    async function syncFromHash() {
      if (window.location.hash === lastSyncedHash) return;
      const syncingHash = window.location.hash;
      lastSyncedHash = syncingHash;
      const items = await loadProjects();
      if (!mounted || window.location.hash !== syncingHash) return;
      const { projectId, docPath, module: routeModule } = parseHashRoute(syncingHash);
      const currentProject = useWorkspaceStore.getState().activeProject;
      const currentModule = useWorkspaceStore.getState().activeModule;
      const currentDoc = useDocumentStore.getState().activeDoc;
      const routeProject = projectId ? items.find(p => p.id === projectId || p.key === projectId) : null;
      const routeChangesSelection = (routeProject?.id ?? null) !== (currentProject?.id ?? null)
        || (routeProject?.id === currentProject?.id && routeModule === 'documents' && docPath !== currentDoc);
      if (routeChangesSelection && !useDocumentStore.getState().canDiscard()) {
        setHashRoute(currentProject?.id ?? null, currentDoc, currentModule);
        return;
      }
      if (projectId) {
        const found = routeProject;
        if (found) {
          if (currentProject?.id === found.id && routeModule === currentModule
            && (routeModule !== 'documents' || docPath === currentDoc)) {
            return;
          }
          setActiveProject(found);
          useWorkspaceStore.setState({ activeModule: routeModule });
          setDocSource('atlas');
          await Promise.all([
            loadDocs(found.id),
            loadSourceDocs(found.id),
            loadTasks(found.id),
            loadSessions(found.id),
            loadRollup(found.id),
            loadProfile(found.id),
            loadProposals(found.id),
            loadTraceability(found.id),
            loadProjectHealth(found.id),
          ]);
          if (!mounted || window.location.hash !== syncingHash) return;
          if (routeModule === 'documents') {
            if (docPath) await openDocument(found, docPath);
            else useDocumentStore.getState().clearActiveDoc();
          }
        }
      } else {
        setActiveProject(null);
        useWorkspaceStore.setState({ activeModule: 'portfolio' });
      }
    }

    syncFromHash();
    const onHash = () => syncFromHash();
    window.addEventListener('hashchange', onHash);
    return () => {
      mounted = false;
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  // Initial overview load
  useEffect(() => {
    loadOverview();
  }, []);

  // SSE live project updates
  useEffect(() => {
    if (!activeProject || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/projects/${encodeURIComponent(activeProject.id)}/events`);
    es.onmessage = async e => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'doc_changed' || ev.type === 'reindexed') {
          await Promise.all([
            loadDocs(activeProject.id),
            loadTasks(activeProject.id),
            loadRollup(activeProject.id),
            loadProfile(activeProject.id),
            loadProposals(activeProject.id),
            loadTraceability(activeProject.id),
            loadProjectHealth(activeProject.id),
          ]);
          if (activeDoc && (ev.type === 'reindexed' || ev.path === activeDoc)) {
            const currentCleanEtag = (etag || '').replace(/^"|"$/g, '');
            if (ev.etag && ev.etag === currentCleanEtag) return;
            if (dirty) {
            if (useDocumentStore.getState().saving) return;
              setConflict({
                message: 'File updated on disk while you have unsaved edits.',
                currentEtag: ev.etag || null,
              });
            } else {
              await openDocument(activeProject, activeDoc);
            }
          } else if (activeDoc) {
            await loadBacklinks(activeProject.id, activeDoc);
          }
        }
      } catch {}
    };
    return () => es.close();
  }, [activeProject, activeDoc, etag, dirty]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDocument();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (activeProject) setSearchModalOpen(v => !v);
      } else if (e.key === 'Escape' && searchModalOpen) {
        setSearchModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeProject, searchModalOpen, saveDocument]);

  // Search execution when modal or query changes
  useEffect(() => {
    if (searchModalOpen) {
      performSearch();
    }
  }, [searchModalOpen, searchQuery, searchType, searchStatus, activeProject]);

  return html`
    <div class="app-shell">
      <${Header} />
      <main className=${sidebarCollapsed ? 'sidebar-collapsed' : ''}>
        <${Sidebar} />
        <div class="workspace-column">
          <section class="workspace">
            ${activeModule === 'portfolio' && html`<${PortfolioView} />`}
            ${activeModule === 'project' && activeProject && html`<${ProjectOverview} />`}
            ${activeModule === 'activity' && activeProject && html`<${GitActivityView} />`}
            ${activeModule === 'documents' && html`<${DocumentWorkspace} />`}
            ${activeModule === 'tasks' && activeProject && html`<${TasksWorkspace} />`}
          </section>
          ${activeProject && html`<${ProjectTerminalPanel} key=${activeProject.id} project=${activeProject} />`}
        </div>
      </main>
      <${Modals} />
    </div>
  `;
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('app');
  if (root) createRoot(root).render(html`<${App} />`);
}
