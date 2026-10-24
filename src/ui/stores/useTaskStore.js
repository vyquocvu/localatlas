import { create } from 'zustand';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useDocumentStore } from './useDocumentStore.js';
import { useProfileStore } from './useProfileStore.js';

export const useTaskStore = create((set, get) => ({
  tasks: [],
  taskFilterStatus: '',
  taskFilterPriority: '',
  taskFilterEpic: '',
  taskFilterMilestone: '',
  taskSearch: '',
  taskSort: 'priority',
  taskSubView: 'board', // 'board' | 'list' | 'roadmap'
  savedTaskViews: [],
  savedTaskViewsProjectId: null,
  taskViewNameInput: '',
  rollupData: { milestones: [], epics: [], brokenReferences: [] },
  cancelledCollapsed: true,
  taskTraceability: {},

  setTaskFilterStatus: taskFilterStatus => set({ taskFilterStatus }),
  setTaskFilterPriority: taskFilterPriority => set({ taskFilterPriority }),
  setTaskFilterEpic: taskFilterEpic => set({ taskFilterEpic }),
  setTaskFilterMilestone: taskFilterMilestone => set({ taskFilterMilestone }),
  setTaskSearch: taskSearch => set({ taskSearch }),
  setTaskSort: taskSort => set({ taskSort }),
  setTaskViewNameInput: taskViewNameInput => set({ taskViewNameInput }),
  setTaskSubView: taskSubView => set({ taskSubView }),
  setCancelledCollapsed: cancelledCollapsed => set({ cancelledCollapsed }),
  resetTaskFilters: () => set({ taskFilterStatus: '', taskFilterPriority: '', taskFilterEpic: '', taskFilterMilestone: '', taskSearch: '', taskSort: 'priority' }),
  openReadyTasksView: () => set({ taskSubView: 'ready', taskFilterStatus: '', taskFilterPriority: '', taskFilterEpic: '', taskFilterMilestone: '', taskSearch: '', taskSort: 'priority' }),
  loadSavedTaskViews: projectId => {
    let savedTaskViews = [];
    if (projectId && typeof window !== 'undefined') {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(`localatlas:task-views:${projectId}`) || '[]');
        if (Array.isArray(parsed)) savedTaskViews = parsed.filter(view => view && typeof view.name === 'string' && view.filters && typeof view.filters === 'object');
      } catch { /* Malformed saved-view storage should not block the task workspace. */ }
    }
    set({ savedTaskViews, savedTaskViewsProjectId: projectId || null, taskViewNameInput: '', taskFilterStatus: '', taskFilterPriority: '', taskFilterEpic: '', taskFilterMilestone: '', taskSearch: '', taskSort: 'priority', taskSubView: 'board' });
    return savedTaskViews;
  },
  saveTaskView: (name, projectId) => {
    const cleanName = String(name || '').trim();
    if (!cleanName || !projectId || typeof window === 'undefined') return { ok: false, error: 'Enter a view name first.' };
    const state = get();
    const filters = {
      taskFilterStatus: state.taskFilterStatus,
      taskFilterPriority: state.taskFilterPriority,
      taskFilterEpic: state.taskFilterEpic,
      taskFilterMilestone: state.taskFilterMilestone,
      taskSearch: state.taskSearch,
      taskSort: state.taskSort,
    };
    const savedTaskViews = [...state.savedTaskViews.filter(view => view.name.toLowerCase() !== cleanName.toLowerCase()), { name: cleanName, filters }];
    try {
      window.localStorage.setItem(`localatlas:task-views:${projectId}`, JSON.stringify(savedTaskViews));
      set({ savedTaskViews, savedTaskViewsProjectId: projectId, taskViewNameInput: '' });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Unable to save this view in browser storage.' };
    }
  },
  applySavedTaskView: view => {
    if (!view?.filters) return;
    set({
      taskFilterStatus: view.filters.taskFilterStatus || '',
      taskFilterPriority: view.filters.taskFilterPriority || '',
      taskFilterEpic: view.filters.taskFilterEpic || '',
      taskFilterMilestone: view.filters.taskFilterMilestone || '',
      taskSearch: view.filters.taskSearch || '',
      taskSort: ['priority', 'id', 'title'].includes(view.filters.taskSort) ? view.filters.taskSort : 'priority',
    });
  },
  deleteSavedTaskView: (name, projectId) => {
    if (!projectId || typeof window === 'undefined') return;
    const savedTaskViews = get().savedTaskViews.filter(view => view.name !== name);
    try { window.localStorage.setItem(`localatlas:task-views:${projectId}`, JSON.stringify(savedTaskViews)); } catch {}
    set({ savedTaskViews });
  },

  loadTasks: async projId => {
    if (!projId) return [];
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/tasks`);
      if (!r.ok) return [];
      const items = await r.json();
      const workspace = useWorkspaceStore.getState();
      if (workspace.activeProject?.id === projId && workspace.projectEpoch === projectEpoch) set({ tasks: items });
      return items;
    } catch {
      return [];
    }
  },

  loadRollup: async projId => {
    if (!projId) return { milestones: [], epics: [], brokenReferences: [] };
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/rollup`);
      if (!r.ok) return { milestones: [], epics: [], brokenReferences: [] };
      const data = await r.json();
      const workspace = useWorkspaceStore.getState();
      if (workspace.activeProject?.id === projId && workspace.projectEpoch === projectEpoch) set({ rollupData: data });
      return data;
    } catch {
      return { milestones: [], epics: [], brokenReferences: [] };
    }
  },

  loadTraceability: async projId => {
    if (!projId) return {};
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/traceability`);
      if (r.ok) {
        const data = await r.json();
        const workspace = useWorkspaceStore.getState();
        if (workspace.activeProject?.id === projId && workspace.projectEpoch === projectEpoch) set({ taskTraceability: data });
        return data;
      }
    } catch {}
    return {};
  },

  updateTaskStatus: async (task, newStatus) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
    const projectId = activeProject.id;
    const unchecked = Math.max(0, (task.checklist?.total || 0) - (task.checklist?.checked || 0));
    if (newStatus === 'done' && unchecked > 0) {
      const ok = window.confirm(
        `Definition of Done check: Task ${task.id} still has ${unchecked} unchecked checklist item(s). Mark as done anyway?`
      );
      if (!ok) return;
    }
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'if-match': `"${task.etag}"`,
      },
      body: JSON.stringify({ status: newStatus }),
    });
    if (useWorkspaceStore.getState().activeProject?.id !== projectId) return;
    if (r.status === 409) {
      window.alert('Task was modified concurrently on disk. Reloading tasks...');
      await get().loadTasks(activeProject.id);
      return;
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      window.alert(err.error || 'Failed to update task');
      return;
    }
    await Promise.all([
      get().loadTasks(activeProject.id),
      get().loadRollup(activeProject.id),
      useDocumentStore.getState().loadDocs(activeProject.id),
      get().loadTraceability(activeProject.id),
      useProfileStore.getState().loadProjectHealth(activeProject.id),
      useWorkspaceStore.getState().loadOverview(),
    ]);
    const { activeDoc } = useDocumentStore.getState();
    if (activeDoc === task.path) {
      await useDocumentStore.getState().openDocument(activeProject, task.path);
    }
  },

  createTask: async ({ title, priority, epic, milestone }) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject || !title?.trim()) return;
    const projectId = activeProject.id;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        priority,
        epic: epic?.trim() || undefined,
        milestone: milestone?.trim() || undefined,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create task');
    }
    if (useWorkspaceStore.getState().activeProject?.id !== projectId) return await r.json().catch(() => ({}));
    await Promise.all([
      get().loadTasks(activeProject.id),
      get().loadRollup(activeProject.id),
      useDocumentStore.getState().loadDocs(activeProject.id),
      useWorkspaceStore.getState().loadOverview(),
    ]);
    return await r.json().catch(() => ({}));
  },

  copyTaskContext: async task => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
    const params = new URLSearchParams({ task: task.id, format: 'text' });
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/context?${params}`);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      useWorkspaceStore.getState().setNotice(body.error || 'Unable to load task context');
      return;
    }
    const contextText = await r.text();
    const clipboardWrite = navigator.clipboard?.writeText(contextText)
      .then(() => true)
      .catch(() => false);
    const copied = clipboardWrite
      ? await Promise.race([clipboardWrite, new Promise(resolve => window.setTimeout(() => resolve(false), 1000))])
      : false;
    if (copied) {
      useWorkspaceStore.getState().setNotice(`Copied task context for ${task.id}`);
    } else {
      window.prompt('Copy this task-scoped context:', contextText);
      useWorkspaceStore.getState().setNotice(`Task context ready for ${task.id}`);
    }
  },
}));
