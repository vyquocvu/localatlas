import { create } from 'zustand';
import { encPath, setHashRoute, resolveRelativeDocLink } from '../utils/markdown.js';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useProfileStore } from './useProfileStore.js';

let documentLoadSequence = 0;
let sourceDocumentLoadSequence = 0;
let backlinksLoadSequence = 0;
const draftSaveTimers = new Map();
const draftSaveQueues = new Map();

function enqueueDraftRequest(timerKey, request) {
  const previous = draftSaveQueues.get(timerKey) || Promise.resolve();
  const next = previous.catch(() => {}).then(request).finally(() => {
    if (draftSaveQueues.get(timerKey) === next) draftSaveQueues.delete(timerKey);
  });
  draftSaveQueues.set(timerKey, next);
  return next;
}

function isActiveProject(projId, projectEpoch) {
  const workspace = useWorkspaceStore.getState();
  return workspace.activeProject?.id === projId && (projectEpoch === undefined || workspace.projectEpoch === projectEpoch);
}

function draftStorageKey(projectId, docPath) {
  return `localatlas:draft:${encodeURIComponent(projectId)}:${encodeURIComponent(docPath)}`;
}

function readDraft(projectId, docPath) {
  try {
    const raw = window.localStorage?.getItem(draftStorageKey(projectId, docPath));
    if (!raw) return null;
    const value = JSON.parse(raw);
    return typeof value.content === 'string' ? value : null;
  } catch {
    return null;
  }
}

function persistDraft(projectId, docPath, content, baseEtag, isNewDoc = false) {
  try {
    window.localStorage?.setItem(draftStorageKey(projectId, docPath), JSON.stringify({
      content,
      baseEtag: baseEtag ?? null,
      isNewDoc,
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

function clearDraft(projectId, docPath) {
  try { window.localStorage?.removeItem(draftStorageKey(projectId, docPath)); } catch {}
  const timerKey = `${projectId}:${docPath}`;
  const timer = draftSaveTimers.get(timerKey);
  if (timer) clearTimeout(timer);
  draftSaveTimers.delete(timerKey);
  enqueueDraftRequest(timerKey, () => fetch(`/api/projects/${encodeURIComponent(projectId)}/drafts/${encPath(docPath)}`, { method: 'DELETE' })).catch(() => {});
}

function queueDraftSave(projectId, docPath, content, baseEtag, isNewDoc) {
  const timerKey = `${projectId}:${docPath}`;
  const previous = draftSaveTimers.get(timerKey);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    draftSaveTimers.delete(timerKey);
    enqueueDraftRequest(timerKey, () => fetch(`/api/projects/${encodeURIComponent(projectId)}/drafts/${encPath(docPath)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, baseEtag, isNewDoc }),
    })).catch(() => {});
  }, 300);
  draftSaveTimers.set(timerKey, timer);
}

async function readPersistentDraft(projectId, docPath) {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/drafts/${encPath(docPath)}`);
    if (!response.ok) return null;
    const draft = await response.json();
    return typeof draft.content === 'string' ? draft : null;
  } catch {
    return null;
  }
}

function newestDraft(persistentDraft, localDraft) {
  if (!persistentDraft) return localDraft;
  if (!localDraft) return persistentDraft;
  return Date.parse(localDraft.savedAt || '') > Date.parse(persistentDraft.savedAt || '') ? localDraft : persistentDraft;
}

export const useDocumentStore = create((set, get) => ({
  docsList: [],
  sourceDocs: [],
  sourceDocPath: null,
  sourceDocContent: '',
  sourceDocsLoading: false,
  docSource: 'atlas',
  activeDoc: null,
  content: '',
  etag: null,
  isNewDoc: false,
  dirty: false,
  saving: false,
  mode: 'preview',
  collapsed: {},
  conflict: null,
  recoveryDraft: null,
  backlinks: [],
  backlinksOpen: true,
  docFilter: '',

  setDocSource: docSource => set({ docSource }),
  setDocFilter: docFilter => set({ docFilter }),
  setMode: mode => set({ mode }),
  setContent: content => {
    const state = get();
    const projectId = useWorkspaceStore.getState().activeProject?.id;
    if (projectId && state.activeDoc && content !== state.content) {
      if (!persistDraft(projectId, state.activeDoc, content, state.etag, state.isNewDoc)) {
        useWorkspaceStore.getState().setNotice('Draft could not be saved in browser storage; keep this tab open and copy your text.');
      }
      queueDraftSave(projectId, state.activeDoc, content, state.etag, state.isNewDoc);
    }
    set({ content, dirty: state.dirty || content !== state.content, recoveryDraft: null });
  },
  restoreDraft: () => {
    const draft = get().recoveryDraft;
    if (!draft) return;
    set({ content: draft.content, etag: draft.baseEtag, dirty: true, isNewDoc: Boolean(draft.isNewDoc), mode: 'edit', recoveryDraft: null });
  },
  discardDraft: () => {
    const { activeDoc } = get();
    const projectId = useWorkspaceStore.getState().activeProject?.id;
    if (projectId && activeDoc) clearDraft(projectId, activeDoc);
    set({ recoveryDraft: null });
  },
  saveLocalVersion: async () => {
    const { conflict } = get();
    if (!conflict?.currentEtag) return;
    set({ etag: conflict.currentEtag, conflict: null });
    await get().saveDocument();
  },
  setDirty: dirty => set({ dirty }),
  setConflict: conflict => {
    set({ conflict });
    const activeProject = useWorkspaceStore.getState().activeProject;
    const activeDoc = get().activeDoc;
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    if (!conflict || !activeProject || !activeDoc || conflict.diskContent !== undefined) return;
    fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(activeDoc)}`)
      .then(async response => {
        if (!response.ok) return;
        const diskContent = await response.text();
        const currentEtag = response.headers.get('etag') || conflict.currentEtag;
        if (!isActiveProject(activeProject.id, projectEpoch) || get().activeDoc !== activeDoc) return;
        if (get().conflict?.message !== conflict.message) return;
        set({ conflict: { ...conflict, currentEtag, diskContent } });
      })
      .catch(() => {});
  },
  toggleFolder: path => set(state => ({ collapsed: { ...state.collapsed, [path]: !state.collapsed[path] } })),
  setBacklinksOpen: backlinksOpen => set(typeof backlinksOpen === 'function' ? state => ({ backlinksOpen: backlinksOpen(state.backlinksOpen) }) : { backlinksOpen }),

  clearActiveDoc: () => {
    documentLoadSequence++;
    sourceDocumentLoadSequence++;
    backlinksLoadSequence++;
    set({
      sourceDocPath: null,
      sourceDocContent: '',
      activeDoc: null,
      content: '',
      etag: null,
      isNewDoc: false,
      dirty: false,
      saving: false,
      conflict: null,
      recoveryDraft: null,
      backlinks: [],
    });
  },

  canDiscard: () => !get().dirty || window.confirm('Discard unsaved changes?'),

  loadDocs: async projId => {
    if (!projId) return [];
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/docs`);
      if (!r.ok) return [];
      const items = await r.json();
      if (isActiveProject(projId, projectEpoch)) set({ docsList: items });
      return items;
    } catch {
      return [];
    }
  },

  loadSourceDocs: async projId => {
    if (!projId) return [];
    const requestId = ++sourceDocumentLoadSequence;
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    if (isActiveProject(projId, projectEpoch)) set({ sourceDocsLoading: true });
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/source-docs`);
      if (!r.ok) {
        if (isActiveProject(projId, projectEpoch) && requestId === sourceDocumentLoadSequence) set({ sourceDocs: [] });
        return [];
      }
      const items = await r.json();
      if (isActiveProject(projId, projectEpoch) && requestId === sourceDocumentLoadSequence) set({ sourceDocs: items });
      return items;
    } catch {
      if (isActiveProject(projId, projectEpoch) && requestId === sourceDocumentLoadSequence) set({ sourceDocs: [] });
      return [];
    } finally {
      if (isActiveProject(projId, projectEpoch) && requestId === sourceDocumentLoadSequence) set({ sourceDocsLoading: false });
    }
  },

  loadBacklinks: async (projId, docPath) => {
    const requestId = ++backlinksLoadSequence;
    if (!projId || !docPath) {
      set({ backlinks: [] });
      return;
    }
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/backlinks/${encPath(docPath)}`);
      if (!r.ok) {
        if (isActiveProject(projId, projectEpoch) && requestId === backlinksLoadSequence) set({ backlinks: [] });
        return;
      }
      const items = await r.json();
      if (isActiveProject(projId, projectEpoch) && get().activeDoc === docPath && requestId === backlinksLoadSequence) set({ backlinks: items });
    } catch {
      if (isActiveProject(projId, projectEpoch) && get().activeDoc === docPath && requestId === backlinksLoadSequence) set({ backlinks: [] });
    }
  },

  openDocument: async (proj, docPath) => {
    const requestId = ++documentLoadSequence;
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    const r = await fetch(`/api/projects/${encodeURIComponent(proj.id)}/docs/${encPath(docPath)}`);
    if (!r.ok) {
      if (isActiveProject(proj.id, projectEpoch) && requestId === documentLoadSequence) {
        const draft = newestDraft(await readPersistentDraft(proj.id, docPath), readDraft(proj.id, docPath));
        if (!isActiveProject(proj.id, projectEpoch) || requestId !== documentLoadSequence) return;
        if (draft?.isNewDoc) {
          set({ activeDoc: docPath, content: '', etag: null, isNewDoc: true, dirty: false, conflict: null, recoveryDraft: draft });
        } else {
          useWorkspaceStore.getState().setNotice(`Unable to load ${docPath}`);
        }
      }
      return;
    }
    const resolvedDocPath = r.headers.get('x-document-path') || docPath;
    const text = await r.text();
    if (!isActiveProject(proj.id, projectEpoch) || requestId !== documentLoadSequence) return;
    const draft = newestDraft(await readPersistentDraft(proj.id, resolvedDocPath), readDraft(proj.id, resolvedDocPath));
    if (!isActiveProject(proj.id, projectEpoch) || requestId !== documentLoadSequence) return;
    if (draft && draft.content === text) clearDraft(proj.id, resolvedDocPath);
    set({
      activeDoc: resolvedDocPath,
      content: text,
      etag: r.headers.get('etag'),
      isNewDoc: false,
      dirty: false,
      conflict: null,
      recoveryDraft: draft && draft.content !== text ? draft : null,
    });
    await get().loadBacklinks(proj.id, resolvedDocPath);
  },

  openSourceDocument: async (proj, docPath) => {
    const requestId = ++sourceDocumentLoadSequence;
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    const r = await fetch(`/api/projects/${encodeURIComponent(proj.id)}/source-docs/${encPath(docPath)}`);
    if (!r.ok) {
      if (isActiveProject(proj.id, projectEpoch) && requestId === sourceDocumentLoadSequence) useWorkspaceStore.getState().setNotice(`Unable to read ${docPath}`);
      return;
    }
    const text = await r.text();
    if (!isActiveProject(proj.id, projectEpoch) || requestId !== sourceDocumentLoadSequence) return;
    set({
      sourceDocPath: r.headers.get('x-document-path') || docPath,
      sourceDocContent: text,
      docSource: 'repo',
    });
  },

  saveDocument: async () => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    const { activeDoc, content, isNewDoc, etag } = get();
    if (!activeProject || !activeDoc) return;
    const projectId = activeProject.id;
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    const headers = {};
    if (isNewDoc || !etag) {
      headers['if-none-match'] = '*';
    } else {
      headers['if-match'] = etag;
    }
    set({ saving: true });
    let r;
    try {
      r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(activeDoc)}`, {
        method: 'PUT',
        headers,
        body: content,
      });
    } catch (error) {
      if (isActiveProject(projectId, projectEpoch) && get().activeDoc === activeDoc) set({ saving: false });
      throw error;
    }
    if (r.status === 409) {
      const body = await r.json().catch(() => ({}));
      let diskContent = null;
      let currentEtag = body.currentEtag;
      let diskLoadError = null;
      try {
        const disk = await fetch(`/api/projects/${encodeURIComponent(projectId)}/docs/${encPath(activeDoc)}`);
        if (disk.ok) {
          diskContent = await disk.text();
          currentEtag = disk.headers.get('etag') || currentEtag;
        } else diskLoadError = `HTTP ${disk.status}`;
      } catch (error) { diskLoadError = error instanceof Error ? error.message : String(error); }
      if (isActiveProject(projectId, projectEpoch) && get().activeDoc === activeDoc) set({ saving: false, conflict: { message: body.error || 'Document was modified on disk.', currentEtag, diskContent, diskLoadError } });
      return;
    }
    if (!r.ok) {
      const body = await r.json().catch(() => ({ error: 'Save failed' }));
      if (isActiveProject(projectId, projectEpoch) && get().activeDoc === activeDoc) set({ saving: false });
      if (isActiveProject(projectId, projectEpoch)) useWorkspaceStore.getState().setNotice(body.error || 'Save failed');
      return;
    }
    const newEtag = r.headers.get('etag');
    if (!isActiveProject(projectId, projectEpoch) || get().activeDoc !== activeDoc) return;
    const contentStillMatches = get().content === content;
    set({ etag: newEtag, isNewDoc: false, dirty: !contentStillMatches, saving: false, conflict: null });
    if (contentStillMatches) clearDraft(projectId, activeDoc);
    else persistDraft(projectId, activeDoc, get().content, newEtag, false);
    if (contentStillMatches) setHashRoute(activeProject.id, activeDoc);
    useWorkspaceStore.getState().setNotice(contentStillMatches ? `Saved ${activeDoc}` : `Saved an earlier version of ${activeDoc}; newer edits are still unsaved`);
    await Promise.all([
      get().loadDocs(projectId),
      useProfileStore.getState().loadProjectHealth(activeProject.id),
      get().loadBacklinks(projectId, activeDoc),
      useWorkspaceStore.getState().loadOverview(),
    ]);
  },

  selectDoc: async docPath => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject) return;
    set({ docSource: 'atlas' });
    const expectedHash = `#/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(docPath)}`;
    if (window.location.hash !== expectedHash) {
      setHashRoute(activeProject.id, docPath);
    } else {
      if (!get().canDiscard()) return;
      await get().openDocument(activeProject, docPath);
    }
  },

  createDoc: folderPrefix => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject || !get().canDiscard()) return;
    const promptDefault = folderPrefix ? `${folderPrefix}/` : '';
    const raw = window.prompt('New Markdown path (e.g. spec/PRD.md):', promptDefault);
    if (!raw || !raw.trim()) return;
    const trimmed = raw.trim();
    const name = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    const title = name.split('/').pop().replace(/\.md$/, '');
    set({
      activeDoc: name,
      content: `# ${title}\n`,
      mode: 'edit',
      etag: null,
      isNewDoc: true,
      dirty: true,
      saving: false,
      conflict: null,
      recoveryDraft: null,
      backlinks: [],
    });
  },

  renameDoc: async fromPath => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    const { activeDoc, etag } = get();
    if (!activeProject) return;
    if (activeDoc === fromPath && !get().canDiscard()) return;
    const raw = window.prompt(`Move / rename "${fromPath}" to:`, fromPath);
    if (!raw || !raw.trim() || raw.trim() === fromPath) return;
    const toPath = raw.trim().endsWith('.md') ? raw.trim() : `${raw.trim()}.md`;
    const ifMatch = activeDoc === fromPath && etag ? etag : '*';
    const doMove = async overwrite => {
      const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/docs-move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: fromPath, to: toPath, ifMatch, overwrite }),
      });
      if (r.status === 409) {
        const err = await r.json().catch(() => ({}));
        if (!overwrite && /Destination document .* already exists/i.test(err.error || '')) {
          if (window.confirm(`"${toPath}" already exists. Overwrite it?`)) {
            return doMove(true);
          }
          return;
        }
        window.alert(err.error || 'Document move conflict');
        return;
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: 'Move failed' }));
        window.alert(err.error || 'Move failed');
        return;
      }
      clearDraft(activeProject.id, fromPath);
      await get().loadDocs(activeProject.id);
      if (activeDoc === fromPath) {
        set({ dirty: false });
        setHashRoute(activeProject.id, toPath);
        await get().openDocument(activeProject, toPath);
      }
      useWorkspaceStore.getState().setNotice(`Moved ${fromPath} -> ${toPath}`);
    };
    await doMove(false);
  },

  deleteDoc: async docPath => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    const { activeDoc, etag } = get();
    if (!activeProject) return;
    if (activeDoc === docPath && !get().canDiscard()) return;
    if (!window.confirm(`Delete "${docPath}"?`)) return;
    const ifMatch = activeDoc === docPath && etag ? etag : '*';
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(docPath)}`, {
      method: 'DELETE',
      headers: { 'if-match': ifMatch },
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Delete failed' }));
      window.alert(err.error || 'Delete failed');
      return;
    }
    clearDraft(activeProject.id, docPath);
    await get().loadDocs(activeProject.id);
    if (activeDoc === docPath) {
      set({
        activeDoc: null,
        content: '',
        etag: null,
        dirty: false,
        backlinks: [],
      });
      setHashRoute(activeProject.id, null, 'documents');
    }
    useWorkspaceStore.getState().setNotice(`Deleted ${docPath}`);
  },

  toggleTaskCheckbox: async (lineIdx, checked) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    const { content, activeDoc, isNewDoc, etag, dirty } = get();
    const projectEpoch = useWorkspaceStore.getState().projectEpoch;
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    if (lines[lineIdx] === undefined) return;
    lines[lineIdx] = lines[lineIdx].replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+)/, (_m, a, _state, b) => {
      return `${a}${checked ? 'x' : ' '}${b}`;
    });
    const nextContent = lines.join('\n');
    get().setContent(nextContent);
    if (activeProject && activeDoc && !isNewDoc && etag && !dirty) {
      const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(activeDoc)}`, {
        method: 'PUT',
        headers: { 'if-match': etag },
        body: nextContent,
      });
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        if (isActiveProject(activeProject.id, projectEpoch) && get().activeDoc === activeDoc) {
          set({ dirty: true, conflict: { message: body.error || 'Document was modified on disk.', currentEtag: body.currentEtag } });
        }
        return;
      }
      if (r.ok) {
        if (!isActiveProject(activeProject.id, projectEpoch) || get().activeDoc !== activeDoc) return;
        const contentStillMatches = get().content === nextContent;
        set({ etag: r.headers.get('etag'), dirty: !contentStillMatches });
        useWorkspaceStore.getState().setNotice(`Saved ${activeDoc}`);
        return;
      }
    }
    set({ dirty: true });
  },
}));
