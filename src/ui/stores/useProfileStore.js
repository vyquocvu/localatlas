import { create } from 'zustand';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useDocumentStore } from './useDocumentStore.js';
import { useTaskStore } from './useTaskStore.js';

export const useProfileStore = create((set, get) => ({
  profileData: null,
  proposals: [],
  projectHealth: null,
  recapDraft: null,
  recapLoading: false,
  docTemplates: [],

  setProfileData: profileData => set({ profileData }),
  setRecapDraft: recapDraft => set({ recapDraft }),
  setRecapLoading: recapLoading => set({ recapLoading }),

  loadProfile: async projId => {
    if (!projId) return null;
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/profile`);
      if (!r.ok) return null;
      const data = await r.json();
      const workspace = useWorkspaceStore.getState();
      if (workspace.activeProject?.id === projId && workspace.projectEpoch === projectEpoch) set({ profileData: data });
      return data;
    } catch {
      return null;
    }
  },

  loadProposals: async projId => {
    if (!projId) return [];
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/proposals?status=pending`);
      if (!r.ok) return [];
      const items = await r.json();
      const workspace = useWorkspaceStore.getState();
      if (workspace.activeProject?.id === projId && workspace.projectEpoch === projectEpoch) set({ proposals: items });
      return items;
    } catch {
      return [];
    }
  },

  loadProjectHealth: async projId => {
    if (!projId) return null;
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/health`);
      if (r.ok) {
        const data = await r.json();
        const workspace = useWorkspaceStore.getState();
        if (workspace.activeProject?.id === projId && workspace.projectEpoch === projectEpoch) set({ projectHealth: data });
        return data;
      }
    } catch {}
    return null;
  },

  loadTemplates: async () => {
    try {
      const r = await fetch('/api/templates');
      if (r.ok) {
        const items = await r.json();
        set({ docTemplates: items });
        return items;
      }
    } catch {}
    return [];
  },

  saveProfile: async ({ status, goals, keyDocs }) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
    const projectId = activeProject.id;
    const { profileData } = get();
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status,
        goals,
        keyDocs,
        ifMatch: profileData?.etag || undefined,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Unable to save profile');
    if (useWorkspaceStore.getState().activeProject?.id !== projectId) return body;
    set({ profileData: body });
    await useDocumentStore.getState().loadDocs(activeProject.id);
    useWorkspaceStore.getState().setNotice('Project profile saved');
    return body;
  },

  recordDecision: async ({ summary, rationale, links }) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject || !summary.trim()) return;
    const projectId = activeProject.id;
    const { profileData } = get();
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/profile/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: summary.trim(),
        rationale: rationale.trim(),
        links,
        ifMatch: profileData?.etag || undefined,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Unable to record decision');
    if (useWorkspaceStore.getState().activeProject?.id !== projectId) return body;
    set({ profileData: body.profile });
    await useDocumentStore.getState().loadDocs(activeProject.id);
    useWorkspaceStore.getState().setNotice(`Recorded decision ${body.decision?.id || ''}`);
    return body;
  },

  generateRecap: async (saveToDisk = false) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return null;
    const projectId = activeProject.id;
    set({ recapLoading: true });
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/recaps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ save: saveToDisk }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Unable to generate recap');
      if (useWorkspaceStore.getState().activeProject?.id === projectId) set({ recapDraft: body });
      if (saveToDisk && body.path) {
        await useDocumentStore.getState().loadDocs(activeProject.id);
        useWorkspaceStore.getState().setNotice(`Saved recap to ${body.path}`);
      }
      return body;
    } finally {
      if (useWorkspaceStore.getState().activeProject?.id === projectId) set({ recapLoading: false });
    }
  },

  previewImpact: async (targetTask, { priority, status, epic, milestone, dependsOn }) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject || !targetTask) return null;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/tasks/${encodeURIComponent(targetTask.id)}/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        priority,
        status,
        epic: epic?.trim() || null,
        milestone: milestone?.trim() || null,
        dependsOn,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Unable to prepare impact summary');
    await Promise.all([
      get().loadProposals(activeProject.id),
      useDocumentStore.getState().loadDocs(activeProject.id),
    ]);
    return body;
  },

  confirmProposal: async proposal => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/proposals/${encodeURIComponent(proposal.id)}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, ifMatch: proposal.etag }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Unable to confirm proposal');
    await Promise.all([
      get().loadProposals(activeProject.id),
      useTaskStore.getState().loadTasks(activeProject.id),
      useTaskStore.getState().loadRollup(activeProject.id),
      useDocumentStore.getState().loadDocs(activeProject.id),
      useWorkspaceStore.getState().loadOverview(),
    ]);
    useWorkspaceStore.getState().setNotice(`Confirmed changes for ${proposal.taskId}`);
  },

  rejectProposal: async proposal => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/proposals/${encodeURIComponent(proposal.id)}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ifMatch: proposal.etag }),
    });
    if (r.ok) {
      await Promise.all([
        get().loadProposals(activeProject.id),
        useDocumentStore.getState().loadDocs(activeProject.id),
      ]);
      useWorkspaceStore.getState().setNotice(`Rejected proposal for ${proposal.taskId}`);
    }
  },

  applyTemplate: async ({ templateId, path, title, docId }) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject || !path.trim()) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/templates/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId,
        path: path.trim(),
        title: title?.trim() || undefined,
        docId: docId?.trim() || undefined,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Unable to create document from template');
    await Promise.all([
      useDocumentStore.getState().loadDocs(activeProject.id),
      get().loadProjectHealth(activeProject.id),
    ]);
    useWorkspaceStore.getState().setActiveModule('documents');
    await useDocumentStore.getState().openDocument(activeProject, body.path);
    useWorkspaceStore.getState().setNotice(`Created ${body.path} from ${body.template?.name || templateId}`);
    return body;
  },
}));
