import { create } from 'zustand';
import { setHashRoute } from '../utils/markdown.js';
import { useDocumentStore } from './useDocumentStore.js';
import { useTaskStore } from './useTaskStore.js';
import { useSessionStore } from './useSessionStore.js';
import { useProfileStore } from './useProfileStore.js';

export const useWorkspaceStore = create((set, get) => ({
  projectsList: [],
  activeProject: null,
  workspaceProjects: [],
  overviewLoading: true,
  portfolioSummary: null,
  activeModule: 'portfolio',
  terminalPanelOpen: false,
  notice: 'Local-first · Documents stored outside imported repositories',

  setProjectsList: projectsList => set({ projectsList }),
  setActiveProject: activeProject => set({ activeProject }),
  setActiveModule: activeModule => set({ activeModule }),
  toggleTerminalPanel: () => set(state => ({ terminalPanelOpen: !state.terminalPanelOpen })),
  setNotice: notice => set({ notice }),

  loadProjects: async () => {
    try {
      const r = await fetch('/api/projects');
      if (r.ok) {
        const items = await r.json();
        set({ projectsList: items });
        return items;
      }
    } catch {}
    return [];
  },

  loadPortfolioSummary: async () => {
    try {
      const r = await fetch('/api/portfolio/summary');
      if (r.ok) {
        const data = await r.json();
        set({ portfolioSummary: data });
        return data;
      }
    } catch {}
    return null;
  },

  loadOverview: async () => {
    set({ overviewLoading: true });
    try {
      const [r] = await Promise.all([
        fetch('/api/overview'),
        get().loadPortfolioSummary(),
        useProfileStore.getState().loadTemplates(),
      ]);
      if (!r.ok) throw new Error('Unable to load workspace overview');
      const items = await r.json();
      set({ workspaceProjects: items });
      return items;
    } catch (error) {
      set({ notice: error instanceof Error ? error.message : 'Unable to load workspace overview' });
      return [];
    } finally {
      set({ overviewLoading: false });
    }
  },

  selectProject: async proj => {
    if (!useDocumentStore.getState().canDiscard()) return;
    set({
      activeProject: proj,
      activeModule: 'project',
    });
    const docStore = useDocumentStore.getState();
    docStore.setDocSource('atlas');
    docStore.clearActiveDoc();

    const projId = proj.id;
    await Promise.all([
      docStore.loadDocs(projId),
      useTaskStore.getState().loadTasks(projId),
      useSessionStore.getState().loadSessions(projId),
      useTaskStore.getState().loadRollup(projId),
      useProfileStore.getState().loadProfile(projId),
      useProfileStore.getState().loadProposals(projId),
      useTaskStore.getState().loadTraceability(projId),
      useProfileStore.getState().loadProjectHealth(projId),
      docStore.loadSourceDocs(projId),
    ]);
    setHashRoute(projId, null);
  },

  showPortfolio: () => {
    if (!useDocumentStore.getState().canDiscard()) return;
    set({
      activeProject: null,
      activeModule: 'portfolio',
    });
    useDocumentStore.getState().clearActiveDoc();
    setHashRoute(null, null);
  },

  relinkProject: async sourcePath => {
    const { activeProject } = get();
    if (!activeProject || !sourcePath.trim()) throw new Error('No active project or invalid path');
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/relink`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: sourcePath.trim() }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || 'Unable to relink project');
    }
    const updated = await r.json();
    set(state => ({
      activeProject: updated,
      projectsList: state.projectsList.map(item => item.id === updated.id ? updated : item),
      notice: 'Project path relinked. Atlas documents and tasks were preserved.',
    }));
    await get().loadOverview();
    return updated;
  },

  importProject: async ({ path, key }) => {
    const r = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, key: key || undefined }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(body.error || 'Import failed');
    }
    await get().loadProjects();
    await get().loadOverview();
    await get().selectProject(body);
    return body;
  },
}));
