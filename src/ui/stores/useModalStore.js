import { create } from 'zustand';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useDocumentStore } from './useDocumentStore.js';

let impactRequestSequence = 0;
let taskDetailRequestSequence = 0;

export const useModalStore = create((set, get) => ({
  projectModalOpen: false,
  setProjectModalOpen: projectModalOpen => set({ projectModalOpen }),

  searchModalOpen: false,
  searchQuery: '',
  searchType: '',
  searchStatus: '',
  searchResults: [],
  setSearchModalOpen: searchModalOpen => set(typeof searchModalOpen === 'function' ? state => ({ searchModalOpen: searchModalOpen(state.searchModalOpen) }) : { searchModalOpen }),
  setSearchQuery: searchQuery => set({ searchQuery }),
  setSearchType: searchType => set({ searchType }),
  setSearchStatus: searchStatus => set({ searchStatus }),
  setSearchResults: searchResults => set({ searchResults }),
  performSearch: async () => {
    const { searchQuery, searchType, searchStatus } = get();
    const activeProject = useWorkspaceStore.getState().activeProject;
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (searchType) params.set('type', searchType);
    if (searchStatus) params.set('status', searchStatus);
    const searchPath = activeProject
      ? `/api/projects/${encodeURIComponent(activeProject.id)}/search`
      : '/api/search';
    try {
      const r = await fetch(`${searchPath}?${params.toString()}`);
      if (r.ok) {
        const items = await r.json();
        set({ searchResults: items });
        return items;
      }
    } catch {}
    set({ searchResults: [] });
    return [];
  },

  newTaskModalOpen: false,
  newTaskTitle: '',
  newTaskPriority: 'medium',
  newTaskEpic: '',
  newTaskMilestone: '',
  setNewTaskModalOpen: newTaskModalOpen => set({ newTaskModalOpen }),
  setNewTaskTitle: newTaskTitle => set({ newTaskTitle }),
  setNewTaskPriority: newTaskPriority => set({ newTaskPriority }),
  setNewTaskEpic: newTaskEpic => set({ newTaskEpic }),
  setNewTaskMilestone: newTaskMilestone => set({ newTaskMilestone }),
  resetNewTaskForm: () => set({
    newTaskModalOpen: false,
    newTaskTitle: '',
    newTaskPriority: 'medium',
    newTaskEpic: '',
    newTaskMilestone: '',
  }),

  sessionModalOpen: false,
  sessionTaskId: '',
  sessionResumeNote: '',
  sessionNextAction: '',
  sessionError: '',
  setSessionModalOpen: sessionModalOpen => set({ sessionModalOpen }),
  setSessionTaskId: sessionTaskId => set({ sessionTaskId }),
  setSessionResumeNote: sessionResumeNote => set({ sessionResumeNote }),
  setSessionNextAction: sessionNextAction => set({ sessionNextAction }),
  setSessionError: sessionError => set({ sessionError }),
  openNewSessionModal: (taskId = '') => set({
    sessionModalOpen: true,
    sessionTaskId: taskId,
    sessionResumeNote: '',
    sessionNextAction: '',
    sessionError: '',
  }),

  relinkModalOpen: false,
  relinkPath: '',
  relinkError: '',
  setRelinkModalOpen: relinkModalOpen => set({ relinkModalOpen }),
  setRelinkPath: relinkPath => set({ relinkPath }),
  setRelinkError: relinkError => set({ relinkError }),
  openRelinkModal: path => set({
    relinkModalOpen: true,
    relinkPath: path || '',
    relinkError: '',
  }),

  importModalOpen: false,
  importPath: '',
  importKey: '',
  importError: '',
  pickingDir: false,
  showDirBrowser: false,
  browseDirData: null,
  browseDirLoading: false,
  setImportModalOpen: importModalOpen => set({ importModalOpen }),
  setImportPath: importPath => set({ importPath }),
  setImportKey: importKey => set({ importKey }),
  setImportError: importError => set({ importError }),
  setPickingDir: pickingDir => set({ pickingDir }),
  setShowDirBrowser: showDirBrowser => set({ showDirBrowser }),
  setBrowseDirData: browseDirData => set({ browseDirData }),
  setBrowseDirLoading: browseDirLoading => set({ browseDirLoading }),

  openImportModal: () => set({
    importModalOpen: true,
    importPath: '',
    importKey: '',
    importError: '',
    showDirBrowser: false,
  }),

  loadBrowseDir: async targetPath => {
    set({ browseDirLoading: true });
    try {
      const q = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
      const r = await fetch(`/api/fs/directories${q}`);
      if (r.ok) {
        const data = await r.json();
        set({ browseDirData: data });
      }
    } catch {
    } finally {
      set({ browseDirLoading: false });
    }
  },

  selectBrowseDir: dirPath => {
    const { importKey } = get();
    set({ importPath: dirPath, showDirBrowser: false });
    if (!importKey) {
      const seg = dirPath.split(/[/\\]/).filter(Boolean).pop() || '';
      const suggested = seg.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
      if (suggested) set({ importKey: suggested });
    }
  },

  handlePickFolder: async () => {
    set({ pickingDir: true, importError: '' });
    try {
      const r = await fetch('/api/fs/pick-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (r.ok) {
        const data = await r.json();
        if (data.supported && data.path) {
          get().selectBrowseDir(data.path);
          return;
        } else if (data.supported && data.canceled) {
          return;
        }
      }
      set({ showDirBrowser: true });
      await get().loadBrowseDir(get().importPath || undefined);
    } catch {
      set({ showDirBrowser: true });
      await get().loadBrowseDir(get().importPath || undefined);
    } finally {
      set({ pickingDir: false });
    }
  },

  toggleDirBrowser: async () => {
    const next = !get().showDirBrowser;
    set({ showDirBrowser: next });
    if (next && !get().browseDirData) {
      await get().loadBrowseDir(get().importPath || undefined);
    }
  },

  profileModalOpen: false,
  profileStatusInput: 'active',
  profileGoalsInput: '',
  profileKeyDocsInput: '',
  setProfileModalOpen: profileModalOpen => set({ profileModalOpen }),
  setProfileStatusInput: profileStatusInput => set({ profileStatusInput }),
  setProfileGoalsInput: profileGoalsInput => set({ profileGoalsInput }),
  setProfileKeyDocsInput: profileKeyDocsInput => set({ profileKeyDocsInput }),
  openProfileModal: profile => set({
    profileModalOpen: true,
    profileStatusInput: profile?.status || 'active',
    profileGoalsInput: profile?.goals || '',
    profileKeyDocsInput: (profile?.keyDocs || []).join(', '),
  }),

  decisionModalOpen: false,
  decisionSummary: '',
  decisionRationale: '',
  decisionLinks: '',
  setDecisionModalOpen: decisionModalOpen => set({ decisionModalOpen }),
  setDecisionSummary: decisionSummary => set({ decisionSummary }),
  setDecisionRationale: decisionRationale => set({ decisionRationale }),
  setDecisionLinks: decisionLinks => set({ decisionLinks }),
  openDecisionModal: () => set({
    decisionModalOpen: true,
    decisionSummary: '',
    decisionRationale: '',
    decisionLinks: '',
  }),

  impactModalOpen: false,
  impactTargetTask: null,
  impactTitle: '',
  impactBody: '',
  impactPriority: 'medium',
  impactStatus: 'todo',
  impactEpic: '',
  impactMilestone: '',
  impactDependsOn: '',
  impactDependenciesEdited: false,
  impactPreview: null,
  impactError: '',
  impactDocuments: [],
  impactDocumentsLoading: false,
  impactDocumentsError: '',
  impactDocumentsTruncated: false,
  impactUnresolved: [],
  impactUnresolvedTruncated: false,
  impactLinkTarget: '',
  setImpactModalOpen: impactModalOpen => set({ impactModalOpen }),
  setImpactTargetTask: impactTargetTask => set({ impactTargetTask }),
  setImpactPriority: impactPriority => set({ impactPriority, impactPreview: null }),
  setImpactTitle: impactTitle => set({ impactTitle, impactPreview: null }),
  setImpactBody: impactBody => set({ impactBody, impactPreview: null }),
  setImpactStatus: impactStatus => set({ impactStatus, impactPreview: null }),
  setImpactEpic: impactEpic => set({ impactEpic, impactPreview: null }),
  setImpactMilestone: impactMilestone => set({ impactMilestone, impactPreview: null }),
  setImpactDependsOn: impactDependsOn => set({ impactDependsOn, impactDependenciesEdited: true, impactPreview: null }),
  setImpactLinkTarget: impactLinkTarget => set({ impactLinkTarget }),
  setImpactPreview: impactPreview => set({ impactPreview }),
  setImpactError: impactError => set({ impactError }),
  openImpactModal: async (task, projectId) => {
    const requestId = ++impactRequestSequence;
    const isCurrent = () => requestId === impactRequestSequence
      && useWorkspaceStore.getState().activeProject?.id === projectId
      && get().impactTargetTask?.id === task.id;
    set({
      impactModalOpen: true, impactTargetTask: task,
      impactTitle: task.title || '', impactBody: '',
      impactPriority: task.priority || 'medium', impactStatus: task.status || 'todo',
      impactEpic: task.epic || '', impactMilestone: task.milestone || '',
      impactDependsOn: (task.dependsOn || []).join(', '),
      impactDependenciesEdited: false,
      impactPreview: null, impactError: '',
      impactDocuments: [], impactDocumentsLoading: true, impactDocumentsError: '',
      impactDocumentsTruncated: false, impactUnresolved: [], impactUnresolvedTruncated: false,
      impactLinkTarget: '',
    });
    const documentsRequest = (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}/documents`);
        if (!response.ok) throw new Error('Unable to load linked documents');
        const data = await response.json();
        if (!isCurrent()) return;
        set({
          impactDocuments: Array.isArray(data.documents) ? data.documents : [],
          impactUnresolved: Array.isArray(data.unresolved) ? data.unresolved : [],
          impactDocumentsTruncated: Boolean(data.truncated),
          impactUnresolvedTruncated: Boolean(data.unresolvedTruncated),
          impactDocumentsError: '',
          impactDocumentsLoading: false,
        });
      } catch (error) {
        if (!isCurrent()) return;
        set({ impactDocumentsError: error.message || 'Unable to load linked documents', impactDocumentsLoading: false });
      }
    })();
    try {
      const docUrl = `/api/projects/${encodeURIComponent(projectId)}/docs/${task.path.split('/').map(encodeURIComponent).join('/')}`;
      const response = await fetch(docUrl);
      if (!response.ok) throw new Error('Unable to load task Markdown');
      const markdown = await response.text();
      if (!isCurrent()) return;
      const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      const body = withoutFrontmatter.replace(/^#\s+[^\r\n]*(?:\r?\n|$)\s*/, '');
      set({ impactBody: body });
    } catch (error) {
      if (isCurrent()) set({ impactError: error.message || 'Unable to load task Markdown' });
    }
    await Promise.all([documentsRequest, useDocumentStore.getState().loadDocs(projectId)]);
  },

  taskDetailModalOpen: false,
  taskDetailTask: null,
  taskDetailBody: '',
  taskDetailLoading: false,
  taskDetailError: '',
  setTaskDetailModalOpen: taskDetailModalOpen => set({ taskDetailModalOpen }),
  openTaskDetailModal: async (task, projectId) => {
    const requestId = ++taskDetailRequestSequence;
    set({ taskDetailModalOpen: true, taskDetailTask: task, taskDetailBody: '', taskDetailLoading: true, taskDetailError: '' });
    const isCurrent = () => requestId === taskDetailRequestSequence
      && get().taskDetailTask?.id === task.id
      && useWorkspaceStore.getState().activeProject?.id === projectId;
    try {
      const docUrl = `/api/projects/${encodeURIComponent(projectId)}/docs/${task.path.split('/').map(encodeURIComponent).join('/')}`;
      const response = await fetch(docUrl);
      if (!response.ok) throw new Error('Unable to load task description');
      const markdown = await response.text();
      if (!isCurrent()) return;
      const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      const body = withoutFrontmatter.replace(/^#\s+[^\r\n]*(?:\r?\n|$)\s*/, '').trim();
      set({ taskDetailBody: body, taskDetailLoading: false });
    } catch (error) {
      if (isCurrent()) set({ taskDetailError: error.message || 'Unable to load task description', taskDetailLoading: false });
    }
  },

  structureModalOpen: false,
  structureType: 'epic',
  structureRecord: null,
  structureTitle: '',
  structureStatus: 'todo',
  structureMilestone: '',
  structureTargetDate: '',
  structureEtag: null,
  structureError: '',
  openStructureModal: async (type, record = null, projectId) => {
    set({
      structureModalOpen: true, structureType: type, structureRecord: record,
      structureTitle: record?.title || '', structureStatus: record?.status || (type === 'epic' ? 'todo' : 'open'),
      structureMilestone: record?.milestone || '', structureTargetDate: record?.targetDate || '',
      structureEtag: null, structureError: '',
    });
    if (!record) return;
    try {
      const folder = type === 'epic' ? 'epics' : 'milestones';
      const path = record.id.includes('/') ? record.id : `${folder}/${record.id}.md`;
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/docs/${path.split('/').map(encodeURIComponent).join('/')}`);
      if (!response.ok) throw new Error('Unable to load Markdown metadata');
      const etag = (response.headers.get('etag') || '').replace(/^"|"$/g, '');
      set({ structureEtag: etag });
    } catch (error) {
      set({ structureError: error.message || 'Unable to load Markdown metadata' });
    }
  },
  setStructureModalOpen: structureModalOpen => set({ structureModalOpen }),
  setStructureTitle: structureTitle => set({ structureTitle }),
  setStructureStatus: structureStatus => set({ structureStatus }),
  setStructureMilestone: structureMilestone => set({ structureMilestone }),
  setStructureTargetDate: structureTargetDate => set({ structureTargetDate }),
  setStructureError: structureError => set({ structureError }),

  recapModalOpen: false,
  setRecapModalOpen: recapModalOpen => set({ recapModalOpen }),

  templateModalOpen: false,
  selectedTemplateId: 'prd',
  templatePathInput: 'specs/PRD.md',
  templateTitleInput: '',
  templateDocIdInput: '',
  templateError: '',
  setTemplateModalOpen: templateModalOpen => set({ templateModalOpen }),
  setSelectedTemplateId: selectedTemplateId => set({ selectedTemplateId }),
  setTemplatePathInput: templatePathInput => set({ templatePathInput }),
  setTemplateTitleInput: templateTitleInput => set({ templateTitleInput }),
  setTemplateDocIdInput: templateDocIdInput => set({ templateDocIdInput }),
  setTemplateError: templateError => set({ templateError }),
  openTemplateModal: () => set({
    templateModalOpen: true,
    selectedTemplateId: 'prd',
    templatePathInput: 'specs/PRD.md',
    templateTitleInput: '',
    templateDocIdInput: '',
    templateError: '',
  }),
}));
