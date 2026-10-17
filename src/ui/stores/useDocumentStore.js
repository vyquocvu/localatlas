import { create } from 'zustand';
import { encPath, setHashRoute, resolveRelativeDocLink } from '../utils/markdown.js';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useProfileStore } from './useProfileStore.js';

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
  mode: 'split',
  collapsed: {},
  conflict: null,
  backlinks: [],
  backlinksOpen: true,
  docFilter: '',

  setDocSource: docSource => set({ docSource }),
  setDocFilter: docFilter => set({ docFilter }),
  setMode: mode => set({ mode }),
  setContent: content => set({ content }),
  setDirty: dirty => set({ dirty }),
  setConflict: conflict => set({ conflict }),
  toggleFolder: path => set(state => ({ collapsed: { ...state.collapsed, [path]: !state.collapsed[path] } })),
  setBacklinksOpen: backlinksOpen => set(typeof backlinksOpen === 'function' ? state => ({ backlinksOpen: backlinksOpen(state.backlinksOpen) }) : { backlinksOpen }),

  clearActiveDoc: () => set({
    sourceDocPath: null,
    sourceDocContent: '',
    activeDoc: null,
    content: '',
    etag: null,
    isNewDoc: false,
    dirty: false,
    conflict: null,
    backlinks: [],
  }),

  canDiscard: () => !get().dirty || window.confirm('Discard unsaved changes?'),

  loadDocs: async projId => {
    if (!projId) return [];
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/docs`);
      if (!r.ok) return [];
      const items = await r.json();
      set({ docsList: items });
      return items;
    } catch {
      return [];
    }
  },

  loadSourceDocs: async projId => {
    if (!projId) return [];
    set({ sourceDocsLoading: true });
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/source-docs`);
      if (!r.ok) {
        set({ sourceDocs: [] });
        return [];
      }
      const items = await r.json();
      set({ sourceDocs: items });
      return items;
    } catch {
      set({ sourceDocs: [] });
      return [];
    } finally {
      set({ sourceDocsLoading: false });
    }
  },

  loadBacklinks: async (projId, docPath) => {
    if (!projId || !docPath) {
      set({ backlinks: [] });
      return;
    }
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/backlinks/${encPath(docPath)}`);
      if (!r.ok) {
        set({ backlinks: [] });
        return;
      }
      const items = await r.json();
      set({ backlinks: items });
    } catch {
      set({ backlinks: [] });
    }
  },

  openDocument: async (proj, docPath) => {
    const r = await fetch(`/api/projects/${encodeURIComponent(proj.id)}/docs/${encPath(docPath)}`);
    if (!r.ok) {
      useWorkspaceStore.getState().setNotice(`Unable to load ${docPath}`);
      return;
    }
    const resolvedDocPath = r.headers.get('x-document-path') || docPath;
    const text = await r.text();
    set({
      activeDoc: resolvedDocPath,
      content: text,
      etag: r.headers.get('etag'),
      isNewDoc: false,
      dirty: false,
      conflict: null,
    });
    await get().loadBacklinks(proj.id, resolvedDocPath);
  },

  openSourceDocument: async (proj, docPath) => {
    const r = await fetch(`/api/projects/${encodeURIComponent(proj.id)}/source-docs/${encPath(docPath)}`);
    if (!r.ok) {
      useWorkspaceStore.getState().setNotice(`Unable to read ${docPath}`);
      return;
    }
    set({
      sourceDocPath: r.headers.get('x-document-path') || docPath,
      sourceDocContent: await r.text(),
      docSource: 'repo',
    });
  },

  saveDocument: async (forceOverwrite = false) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    const { activeDoc, content, isNewDoc, etag } = get();
    if (!activeProject || !activeDoc) return;
    const headers = {};
    if (forceOverwrite) {
      headers['if-match'] = '*';
    } else if (isNewDoc || !etag) {
      headers['if-none-match'] = '*';
    } else {
      headers['if-match'] = etag;
    }
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(activeDoc)}`, {
      method: 'PUT',
      headers,
      body: content,
    });
    if (r.status === 409) {
      const body = await r.json().catch(() => ({}));
      set({ conflict: { message: body.error || 'Document was modified on disk.', currentEtag: body.currentEtag } });
      return;
    }
    if (!r.ok) {
      const body = await r.json().catch(() => ({ error: 'Save failed' }));
      useWorkspaceStore.getState().setNotice(body.error || 'Save failed');
      return;
    }
    const newEtag = r.headers.get('etag');
    set({
      etag: newEtag,
      isNewDoc: false,
      dirty: false,
      conflict: null,
    });
    setHashRoute(activeProject.id, activeDoc);
    useWorkspaceStore.getState().setNotice(`Saved ${activeDoc}`);
    await Promise.all([
      get().loadDocs(activeProject.id),
      useProfileStore.getState().loadProjectHealth(activeProject.id),
      get().loadBacklinks(activeProject.id, activeDoc),
      useWorkspaceStore.getState().loadOverview(),
    ]);
  },

  selectDoc: async docPath => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    if (!activeProject || !get().canDiscard()) return;
    set({ docSource: 'atlas' });
    const expectedHash = `#/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(docPath)}`;
    if (window.location.hash !== expectedHash) {
      setHashRoute(activeProject.id, docPath);
    } else {
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
      etag: null,
      isNewDoc: true,
      dirty: true,
      conflict: null,
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
    await get().loadDocs(activeProject.id);
    if (activeDoc === docPath) {
      set({
        activeDoc: null,
        content: '',
        etag: null,
        dirty: false,
        backlinks: [],
      });
      setHashRoute(activeProject.id, null);
    }
    useWorkspaceStore.getState().setNotice(`Deleted ${docPath}`);
  },

  toggleTaskCheckbox: async (lineIdx, checked) => {
    const activeProject = useWorkspaceStore.getState().activeProject;
    const { content, activeDoc, isNewDoc, etag, dirty } = get();
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    if (lines[lineIdx] === undefined) return;
    lines[lineIdx] = lines[lineIdx].replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+)/, (_m, a, _state, b) => {
      return `${a}${checked ? 'x' : ' '}${b}`;
    });
    const nextContent = lines.join('\n');
    set({ content: nextContent });
    if (activeProject && activeDoc && !isNewDoc && etag && !dirty) {
      const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(activeDoc)}`, {
        method: 'PUT',
        headers: { 'if-match': etag },
        body: nextContent,
      });
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        set({ dirty: true, conflict: { message: body.error || 'Document was modified on disk.', currentEtag: body.currentEtag } });
        return;
      }
      if (r.ok) {
        set({ etag: r.headers.get('etag'), dirty: false });
        useWorkspaceStore.getState().setNotice(`Saved ${activeDoc}`);
        return;
      }
    }
    set({ dirty: true });
  },
}));
