import { create } from 'zustand';
import { setHashRoute } from '../utils/markdown.js';
import { useDocumentStore } from './useDocumentStore.js';
import { useTaskStore } from './useTaskStore.js';
import { useSessionStore } from './useSessionStore.js';
import { useProfileStore } from './useProfileStore.js';

export const useWorkspaceStore = create((set, get) => ({
  projectsList: [],
  activeProject: null,
  projectEpoch: 0,
  workspaceProjects: [],
  overviewLoading: true,
  portfolioSummary: null,
  portfolioAttention: null,
  portfolioAttentionLoading: false,
  activeModule: 'portfolio',
  terminalPanelOpen: false,
  terminalMode: 'shell',
  terminalStatus: 'NOT STARTED',
  codexTerminalSession: null,
  sidebarCollapsed: false,
  notice: 'Local-first · Documents stored outside imported repositories',

  setProjectsList: projectsList => set({ projectsList }),
  setActiveProject: activeProject => {
    const projectChanged = get().activeProject?.id !== activeProject?.id;
    set(state => ({
      activeProject,
      projectEpoch: projectChanged ? state.projectEpoch + 1 : state.projectEpoch,
      ...(projectChanged ? { terminalMode: 'shell', terminalStatus: 'NOT STARTED', codexTerminalSession: null } : {}),
    }));
    if (!projectChanged) return;
    useDocumentStore.getState().clearActiveDoc();
    useDocumentStore.setState({ docsList: [], sourceDocs: [], sourceDocsLoading: false });
    useTaskStore.setState({ tasks: [], rollupData: { milestones: [], epics: [], brokenReferences: [] }, taskTraceability: {} });
    useTaskStore.getState().loadSavedTaskViews(activeProject?.id);
    useSessionStore.setState({ sessions: [] });
    useProfileStore.setState({ profileData: null, proposals: [], projectHealth: null, recapDraft: null, recapLoading: false });
  },
  setActiveModule: activeModule => {
    set({ activeModule });
    const project = get().activeProject;
    if (!project) return;
    const docPath = activeModule === 'documents' ? useDocumentStore.getState().activeDoc : null;
    setHashRoute(project.id, docPath, activeModule);
  },
  toggleTerminalPanel: () => set(state => ({ terminalPanelOpen: !state.terminalPanelOpen })),
  openTerminalPanel: () => set({ terminalPanelOpen: true }),
  setTerminalStatus: terminalStatus => set({ terminalStatus }),
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  openProjectTerminal: () => set({ terminalPanelOpen: true, terminalMode: 'shell' }),
  launchCodex: async (scope, newSession = false) => {
    const project = get().activeProject;
    if (!project) return;
    set({ notice: 'Preparing scoped Codex context…' });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/terminal/codex/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope, newSession }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to start Codex');
      if (get().activeProject?.id !== project.id) return;
      set({
        terminalPanelOpen: true,
        terminalMode: 'codex',
        codexTerminalSession: body,
        notice: `Codex opened with ${body.scopeKey === 'project' ? 'project' : body.scopeKey} context`,
      });
    } catch (error) {
      set({ notice: error instanceof Error ? error.message : 'Unable to start Codex' });
    }
  },
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

  loadPortfolioAttention: async () => {
    set({ portfolioAttentionLoading: true });
    try {
      const response = await fetch('/api/portfolio/attention');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to load attention inbox');
      set({ portfolioAttention: data });
      return data;
    } catch (error) {
      set({ notice: error instanceof Error ? error.message : 'Unable to load attention inbox' });
      return null;
    } finally {
      set({ portfolioAttentionLoading: false });
    }
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
    set({ activeModule: 'project' });
    get().setActiveProject(proj);
    setHashRoute(proj.id, null);
    const docStore = useDocumentStore.getState();
    docStore.setDocSource('atlas');

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
  },

  showPortfolio: () => {
    if (!useDocumentStore.getState().canDiscard()) return;
    set({ activeModule: 'portfolio' });
    get().setActiveProject(null);
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
