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
  taskSubView: 'board', // 'board' | 'list' | 'roadmap'
  rollupData: { milestones: [], epics: [], brokenReferences: [] },
  cancelledCollapsed: true,
  taskTraceability: {},

  setTaskFilterStatus: taskFilterStatus => set({ taskFilterStatus }),
  setTaskFilterPriority: taskFilterPriority => set({ taskFilterPriority }),
  setTaskFilterEpic: taskFilterEpic => set({ taskFilterEpic }),
  setTaskFilterMilestone: taskFilterMilestone => set({ taskFilterMilestone }),
  setTaskSearch: taskSearch => set({ taskSearch }),
  setTaskSubView: taskSubView => set({ taskSubView }),
  setCancelledCollapsed: cancelledCollapsed => set({ cancelledCollapsed }),

  loadTasks: async projId => {
    if (!projId) return [];
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/tasks`);
      if (!r.ok) return [];
      const items = await r.json();
      set({ tasks: items });
      return items;
    } catch {
      return [];
    }
  },

  loadRollup: async projId => {
    if (!projId) return { milestones: [], epics: [], brokenReferences: [] };
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/rollup`);
      if (!r.ok) return { milestones: [], epics: [], brokenReferences: [] };
      const data = await r.json();
      set({ rollupData: data });
      return data;
    } catch {
      return { milestones: [], epics: [], brokenReferences: [] };
    }
  },

  loadTraceability: async projId => {
    if (!projId) return {};
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/traceability`);
      if (r.ok) {
        const data = await r.json();
        set({ taskTraceability: data });
        return data;
      }
    } catch {}
    return {};
  },

  updateTaskStatus: async (task, newStatus) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
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
