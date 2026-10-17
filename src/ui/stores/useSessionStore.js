import { create } from 'zustand';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useDocumentStore } from './useDocumentStore.js';

export const useSessionStore = create((set, get) => ({
  sessions: [],

  loadSessions: async projId => {
    if (!projId) return [];
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/sessions`);
      if (!r.ok) return [];
      const items = await r.json();
      set({ sessions: items });
      return items;
    } catch {
      return [];
    }
  },

  updateSessionStatus: async (session, newStatus) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/sessions/${encodeURIComponent(session.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': session.etag },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      useWorkspaceStore.getState().setNotice(err.error || 'Unable to update session');
      return;
    }
    await Promise.all([
      get().loadSessions(activeProject.id),
      useDocumentStore.getState().loadDocs(activeProject.id),
    ]);
    useWorkspaceStore.getState().setNotice(`Session marked ${newStatus}`);
  },

  createSession: async ({ taskId, resumeNote, nextAction }) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject || !resumeNote?.trim() || !nextAction?.trim()) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId: taskId || null,
        resumeNote: resumeNote.trim(),
        nextAction: nextAction.trim(),
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || 'Unable to create session');
    }
    await Promise.all([
      get().loadSessions(activeProject.id),
      useDocumentStore.getState().loadDocs(activeProject.id),
      useWorkspaceStore.getState().loadOverview(),
    ]);
    return await r.json();
  },
}));
