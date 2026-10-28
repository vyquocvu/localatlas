import { html, Button, Modal, TextInput, TextArea, SelectField } from './Common.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { useProfileStore } from '../stores/useProfileStore.js';
import { useModalStore } from '../stores/useModalStore.js';

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const linkTokenForPath = path => /^[A-Za-z0-9_./-]+$/.test(path) ? `[[${path}]]` : null;
const bodyHasRef = (body, refs) => (refs || []).some(ref =>
  body.includes(`[[${ref}]]`) || new RegExp(`\\[[^\\]]*\\]\\(${escapeRegExp(ref)}\\)`).test(body));
let pendingSearchTimer;

const removeRefsFromBody = (body, refs) => {
  let removed = false;
  const nextLines = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if ((refs || []).some(ref =>
      trimmed === `[[${ref}]]` || new RegExp(`^\\[[^\\]]*\\]\\(${escapeRegExp(ref)}\\)$`).test(trimmed))) {
      removed = true;
      continue;
    }
    let updated = line;
    for (const ref of refs || []) {
      const wiki = `[[${ref}]]`;
      if (updated.includes(wiki)) {
        updated = updated.split(wiki).join('');
        removed = true;
      }
      const stripped = updated.replace(new RegExp(`\\[[^\\]]*\\]\\(${escapeRegExp(ref)}\\)`, 'g'), '');
      if (stripped !== updated) {
        updated = stripped;
        removed = true;
      }
    }
    nextLines.push(updated);
  }
  return { body: nextLines.join('\n'), removed };
};

export function Modals() {
  const {
    projectsList,
    activeProject,
    selectProject,
    relinkProject,
    importProject,
    setActiveModule,
  } = useWorkspaceStore();

  const { selectDoc, docsList } = useDocumentStore();
  const { createTask, tasks, rollupData, loadTasks, loadRollup } = useTaskStore();
  const { createSession } = useSessionStore();
  const {
    saveProfile,
    recordDecision,
    generateRecap,
    previewImpact,
    confirmProposal,
    rejectProposal,
    applyTemplate,
    recapDraft,
    recapLoading,
    docTemplates,
  } = useProfileStore();

  const {
    projectModalOpen,
    setProjectModalOpen,
    searchModalOpen,
    setSearchModalOpen,
    searchQuery,
    searchType,
    searchStatus,
    searchResults,
    searchLoading,
    setSearchQuery,
    setSearchType,
    setSearchStatus,
    performSearch,
    openImportModal,
    newTaskModalOpen,
    newTaskTitle,
    newTaskPriority,
    newTaskEpic,
    newTaskMilestone,
    setNewTaskModalOpen,
    setNewTaskTitle,
    setNewTaskPriority,
    setNewTaskEpic,
    setNewTaskMilestone,
    resetNewTaskForm,
    sessionModalOpen,
    sessionTaskId,
    sessionResumeNote,
    sessionNextAction,
    sessionError,
    setSessionModalOpen,
    setSessionTaskId,
    setSessionResumeNote,
    setSessionNextAction,
    setSessionError,
    relinkModalOpen,
    relinkPath,
    relinkError,
    setRelinkModalOpen,
    setRelinkPath,
    setRelinkError,
    importModalOpen,
    importPath,
    importKey,
    importError,
    pickingDir,
    showDirBrowser,
    browseDirData,
    browseDirLoading,
    setImportModalOpen,
    setImportPath,
    setImportKey,
    setImportError,
    handlePickFolder,
    toggleDirBrowser,
    loadBrowseDir,
    selectBrowseDir,
    profileModalOpen,
    profileStatusInput,
    profileGoalsInput,
    profileKeyDocsInput,
    setProfileModalOpen,
    setProfileStatusInput,
    setProfileGoalsInput,
    setProfileKeyDocsInput,
    decisionModalOpen,
    decisionSummary,
    decisionRationale,
    decisionLinks,
    setDecisionModalOpen,
    setDecisionSummary,
    setDecisionRationale,
    setDecisionLinks,
    taskDetailModalOpen,
    taskDetailTask,
    taskDetailBody,
    taskDetailLoading,
    taskDetailError,
    setTaskDetailModalOpen,
    impactModalOpen,
    impactTargetTask,
    impactTitle,
    impactBody,
    impactPriority,
    impactStatus,
    impactEpic,
    impactMilestone,
    impactDependsOn,
    impactDependenciesEdited,
    impactPreview,
    impactError,
    impactDocuments,
    impactDocumentsLoading,
    impactDocumentsError,
    impactDocumentsTruncated,
    impactUnresolved,
    impactUnresolvedTruncated,
    impactLinkTarget,
    setImpactModalOpen,
    setImpactPriority,
    setImpactTitle,
    setImpactBody,
    setImpactStatus,
    setImpactEpic,
    setImpactMilestone,
    setImpactDependsOn,
    setImpactLinkTarget,
    setImpactPreview,
    setImpactError,
    structureModalOpen,
    structureType,
    structureRecord,
    structureTitle,
    structureStatus,
    structureMilestone,
    structureTargetDate,
    structureEtag,
    structureError,
    openStructureModal,
    setStructureModalOpen,
    setStructureTitle,
    setStructureStatus,
    setStructureMilestone,
    setStructureTargetDate,
    setStructureError,
    recapModalOpen,
    setRecapModalOpen,
    templateModalOpen,
    selectedTemplateId,
    templatePathInput,
    templateTitleInput,
    templateDocIdInput,
    templateError,
    setTemplateModalOpen,
    setSelectedTemplateId,
    setTemplatePathInput,
    setTemplateTitleInput,
    setTemplateDocIdInput,
    setTemplateError,
  } = useModalStore();

  const handleSearchResult = async item => {
    const targetProject = projectsList.find(project => project.id === item.projectId);
    if (!targetProject) return;
    if (targetProject.id !== activeProject?.id) await selectProject(targetProject);
    setSearchModalOpen(false);
    setActiveModule('documents');
    await selectDoc(item.path);
  };

  const handleSearchInput = (setter, event) => {
    setter(event.target.value);
    clearTimeout(pendingSearchTimer);
    pendingSearchTimer = setTimeout(() => {
      pendingSearchTimer = undefined;
      void performSearch();
    }, 160);
  };

  const handleCreateTaskSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !newTaskTitle.trim()) return;
    try {
      await createTask({
        title: newTaskTitle.trim(),
        priority: newTaskPriority,
        epic: newTaskEpic.trim() || undefined,
        milestone: newTaskMilestone.trim() || undefined,
      });
      resetNewTaskForm();
    } catch (err) {
      window.alert(err.message || 'Failed to create task');
    }
  };

  const optionsWithCurrent = (items, current, currentLabel) => [
    { value: '', label: 'None' },
    ...(items || []).map(item => ({ value: item.id, label: `${item.id} · ${item.title}` })),
    ...(current && !(items || []).some(item => item.id === current)
      ? [{ value: current, label: (items || []).some(item => item.title === current) ? `${current} · ${current}` : `${currentLabel}: ${current}` }]
      : []),
  ];
  const epicOptions = optionsWithCurrent(rollupData.epics, impactEpic, 'Unresolved epic');
  const milestoneOptions = optionsWithCurrent(rollupData.milestones, impactMilestone, 'Unresolved milestone');
  const createEpicOptions = [{ value: '', label: 'None' }, ...(rollupData.epics || []).map(item => ({ value: item.id, label: `${item.id} · ${item.title}` }))];
  const createMilestoneOptions = [{ value: '', label: 'None' }, ...(rollupData.milestones || []).map(item => ({ value: item.id, label: `${item.id} · ${item.title}` }))];
  const structureMilestoneOptions = optionsWithCurrent(rollupData.milestones, structureMilestone, 'Unresolved milestone');
  const currentDependencyIds = impactDependsOn.split(',').map(id => id.trim()).filter(Boolean);
  const hasSearchFilters = Boolean(searchQuery.trim() || searchType.trim() || searchStatus.trim());
  const searchDescriptionQuery = searchQuery.trim() || searchType.trim() || searchStatus.trim();
  const bodyHasLinks = /\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]+\)/.test(impactBody);
  const linkableDocs = (docsList || []).filter(path =>
    typeof path === 'string'
    && path !== impactTargetTask?.path
    && linkTokenForPath(path)
    && !bodyHasRef(impactBody, [path])
    && !impactDocuments.some(doc => doc.path === path));

  const handleAddTaskLink = () => {
    if (!impactLinkTarget) return;
    const token = linkTokenForPath(impactLinkTarget);
    if (!token) {
      setImpactError('This document path cannot be linked automatically. Add a Markdown link manually.');
      return;
    }
    if (impactBody.includes(token)) {
      setImpactError('This document is already linked in the task description.');
      return;
    }
    const trimmed = impactBody.replace(/[ \t]+$/, '');
    setImpactBody(`${trimmed}${trimmed ? '\n\n' : ''}${token}`);
    setImpactLinkTarget('');
    setImpactError('');
  };

  const handleRemoveTaskLink = refs => {
    const result = removeRefsFromBody(impactBody, refs);
    if (!result.removed) {
      setImpactError('The link is no longer present in the task description.');
      return;
    }
    setImpactBody(result.body);
    setImpactError('');
  };

  const handleStructureSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !structureTitle.trim()) return;
    if (structureRecord && !structureEtag) {
      setStructureError('The current document ETag is not available. Close and reopen this editor.');
      return;
    }
    setStructureError('');
    const isEpic = structureType === 'epic';
    const url = `/api/projects/${encodeURIComponent(activeProject.id)}/${isEpic ? 'epics' : 'milestones'}${structureRecord ? `/${encodeURIComponent(structureRecord.id)}` : ''}`;
    const payload = isEpic
      ? { title: structureTitle.trim(), status: structureStatus, milestone: structureMilestone || null, ...(structureRecord ? { ifMatch: structureEtag } : {}) }
      : { title: structureTitle.trim(), status: structureStatus, targetDate: structureTargetDate || null, ...(structureRecord ? { ifMatch: structureEtag } : {}) };
    try {
      const response = await fetch(url, { method: structureRecord ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Unable to save ${isEpic ? 'epic' : 'milestone'}`);
      await loadTasks(activeProject.id);
      await loadRollup(activeProject.id);
      setStructureModalOpen(false);
    } catch (error) {
      setStructureError(error.message || 'Unable to save roadmap item');
    }
  };

  const handleCreateSessionSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !sessionResumeNote.trim() || !sessionNextAction.trim()) return;
    setSessionError('');
    try {
      await createSession({
        taskId: sessionTaskId || null,
        resumeNote: sessionResumeNote.trim(),
        nextAction: sessionNextAction.trim(),
      });
      setSessionModalOpen(false);
      setSessionTaskId('');
      setSessionResumeNote('');
      setSessionNextAction('');
    } catch (err) {
      setSessionError(err.message || 'Unable to create session');
    }
  };

  const handleRelinkSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !relinkPath.trim()) return;
    setRelinkError('');
    try {
      await relinkProject(relinkPath.trim());
      setRelinkModalOpen(false);
    } catch (err) {
      setRelinkError(err.message || 'Unable to relink project');
    }
  };

  const handleImportSubmit = async e => {
    e.preventDefault();
    setImportError('');
    try {
      await importProject({ path: importPath, key: importKey || undefined });
      setImportModalOpen(false);
      setImportPath('');
      setImportKey('');
    } catch (err) {
      setImportError(err.message || 'Import failed');
    }
  };

  const handleProfileSave = async e => {
    e.preventDefault();
    if (!activeProject) return;
    const keyDocs = profileKeyDocsInput.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await saveProfile({
        status: profileStatusInput,
        goals: profileGoalsInput,
        keyDocs,
      });
      setProfileModalOpen(false);
    } catch (err) {
      window.alert(err.message || 'Unable to save profile');
    }
  };

  const handleDecisionSave = async e => {
    e.preventDefault();
    if (!activeProject || !decisionSummary.trim()) return;
    const links = decisionLinks.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await recordDecision({
        summary: decisionSummary.trim(),
        rationale: decisionRationale.trim(),
        links,
      });
      setDecisionModalOpen(false);
      setDecisionSummary('');
      setDecisionRationale('');
      setDecisionLinks('');
    } catch (err) {
      window.alert(err.message || 'Unable to record decision');
    }
  };

  const handlePreviewImpact = async e => {
    e.preventDefault();
    if (!activeProject || !impactTargetTask) return;
    setImpactError('');
    const dependsOn = impactDependenciesEdited
      ? impactDependsOn.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    try {
      const res = await previewImpact(impactTargetTask, {
        title: impactTitle,
        body: impactBody,
        priority: impactPriority,
        status: impactStatus,
        epic: impactEpic.trim() || null,
        milestone: impactMilestone.trim() || null,
        dependsOn,
      });
      setImpactPreview(res);
    } catch (err) {
      setImpactError(err.message || 'Unable to prepare impact summary');
    }
  };

  const handleConfirmImpact = async () => {
    if (!impactPreview) return;
    setImpactError('');
    try {
      await confirmProposal(impactPreview);
      setImpactModalOpen(false);
      setImpactPreview(null);
    } catch (error) {
      setImpactError(error.message || 'Unable to confirm task changes');
    }
  };

  const handleRejectImpact = async () => {
    if (!impactPreview) return;
    setImpactError('');
    try {
      await rejectProposal(impactPreview);
      setImpactModalOpen(false);
      setImpactPreview(null);
    } catch (error) {
      setImpactError(error.message || 'Unable to reject task changes');
    }
  };

  const handleApplyTemplateSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !templatePathInput.trim()) return;
    setTemplateError('');
    try {
      await applyTemplate({
        templateId: selectedTemplateId,
        path: templatePathInput.trim(),
        title: templateTitleInput.trim() || undefined,
        docId: templateDocIdInput.trim() || undefined,
      });
      setTemplateModalOpen(false);
      setTemplateTitleInput('');
      setTemplateDocIdInput('');
    } catch (err) {
      setTemplateError(err.message || 'Unable to create document from template');
    }
  };

  return html`
    <div>
      ${projectModalOpen && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${projectModalOpen} onOpenChange=${setProjectModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content">
                <${Modal.Header}>
                  <${Modal.Heading} className="modal-heading">Workspaces & Projects</${Modal.Heading}>
                </${Modal.Header}>
                <${Modal.Body} className="modal-form-body">
                  <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto">
                    ${projectsList.length === 0 && html`
                      <small class="muted" style="padding:10px;text-align:center">No projects imported yet.</small>
                    `}
                    ${projectsList.map(p => html`
                      <${Button}
                        key=${p.id}
                        className=${'project-item' + (activeProject?.id === p.id ? ' selected' : '')}
                        onClick=${() => {
                          selectProject(p);
                          setProjectModalOpen(false);
                        }}
                        style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;width:100%"
                      >
                        <div style="display:flex;flex-direction:column;gap:2px;text-align:left">
                          <strong style="color:var(--foreground)">[${p.key}] ${p.name}</strong>
                          <small className="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis">${p.sourcePath}</small>
                        </div>
                        ${activeProject?.id === p.id && html`<span style="color:var(--accent);font-size:14px">✓</span>`}
                      </${Button}>
                    `)}
                  </div>
                  <div style="margin-top:6px;display:flex;justify-content:flex-end">
                    <${Button}
                      className="button--primary"
                      onClick=${() => {
                        setProjectModalOpen(false);
                        openImportModal();
                      }}
                    >
                      + Import Project Directory
                    </${Button}>
                  </div>
                </${Modal.Body}>
                <${Modal.Footer} className="modal-actions">
                  <${Button} onClick=${() => setProjectModalOpen(false)}>Close</${Button}>
                </${Modal.Footer}>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>
      `}

      ${searchModalOpen && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${searchModalOpen} onOpenChange=${setSearchModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content wide search-dialog">
                <${Modal.Header} className="search-modal-header">
                  <div className="search-modal-title">
                    <span className="search-modal-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <circle cx="10.8" cy="10.8" r="6.3" />
                        <path d="m15.4 15.4 4.1 4.1" />
                      </svg>
                    </span>
                    <div className="search-modal-copy">
                      <${Modal.Heading} className="modal-heading">Search Atlas documents</${Modal.Heading}>
                      <p className="modal-subtitle">Find documents by title, path, or ID, then narrow by type or status.</p>
                    </div>
                  </div>
                  <span className="search-scope-pill">${activeProject ? `${activeProject.key} · ${activeProject.name}` : 'All projects'}</span>
                </${Modal.Header}>
                <${Modal.Body} className="modal-form search-modal-body">
                  <div className="search-query-wrap">
                    <svg className="search-field-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="10.8" cy="10.8" r="6.3" />
                      <path d="m15.4 15.4 4.1 4.1" />
                    </svg>
                    <${TextInput}
                      className="search-query-input"
                      aria-label="Search documents, titles, or IDs"
                      placeholder="Search documents, titles, or IDs..."
                      value=${searchQuery}
                      onInput=${e => handleSearchInput(setSearchQuery, e)}
                      autoFocus
                    />
                  </div>
                  <div className="filter-row search-filter-row">
                    <${TextInput}
                      className="search-filter-input"
                      aria-label="Filter by document type"
                      placeholder="Type · spec"
                      value=${searchType}
                      onInput=${e => handleSearchInput(setSearchType, e)}
                    />
                    <${TextInput}
                      className="search-filter-input"
                      aria-label="Filter by document status"
                      placeholder="Status · todo"
                      value=${searchStatus}
                      onInput=${e => handleSearchInput(setSearchStatus, e)}
                    />
                  </div>
                  <div className=${'search-results' + (searchResults.length > 0 ? ' has-results' : '')} aria-live="polite">
                    ${searchResults.length > 0 ? searchResults.map(item => html`
                      <${Button}
                        key=${item.path}
                        className="search-result-row"
                        variant="ghost"
                        onClick=${() => handleSearchResult(item)}
                      >
                        <span className="search-result-main">
                          <span className="search-result-title">
                            <strong>${item.docId ? `[${item.docId}] ` : ''}${item.title}</strong>
                            ${item.projectKey && html`<span className="search-result-project">${item.projectKey}</span>`}
                          </span>
                          <small>${item.path}</small>
                          ${item.snippet && item.snippet !== item.title && html`<span className="search-result-snippet">${item.snippet}</span>`}
                        </span>
                        <span className="search-result-meta">
                          <span className="search-result-type">${item.type || 'doc'}</span>
                          ${item.status && html`<span className="search-result-status">${item.status}</span>`}
                        </span>
                      </${Button}>
                    `) : html`
                      <div className=${'search-empty' + (hasSearchFilters ? ' has-search-filters' : '')}>
                        <span className="search-empty-icon" aria-hidden="true">
                          ${searchLoading ? html`<span className="search-loading-dot"></span>` : html`
                            <svg viewBox="0 0 24 24" fill="none">
                              <circle cx="10.8" cy="10.8" r="6.3" />
                              <path d="m15.4 15.4 4.1 4.1" />
                            </svg>
                          `}
                        </span>
                        <strong>${searchLoading ? 'Searching documents…' : hasSearchFilters ? 'No matching documents' : 'Search your Atlas workspace'}</strong>
                        <p>${hasSearchFilters
                          ? `No results for “${searchDescriptionQuery}”. Try another title, path, or ID.`
                          : 'Start typing to find a document by title, path, or ID.'}</p>
                      </div>
                    `}
                  </div>
                </${Modal.Body}>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${newTaskModalOpen && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${newTaskModalOpen} onOpenChange=${setNewTaskModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content">
                <form className="modal-form" onSubmit=${handleCreateTaskSubmit}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Create a task</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <${TextInput}
                      aria-label="Task title"
                      placeholder="Task title (e.g. Implement rate limiter)"
                      value=${newTaskTitle}
                      onInput=${e => setNewTaskTitle(e.target.value)}
                      required
                      autoFocus
                    />
                    <div className="priority-field">
                      <span>Priority</span>
                      <${SelectField}
                        className="priority-choice"
                        value=${newTaskPriority}
                        ariaLabel="Task priority"
                        onChange=${setNewTaskPriority}
                        options=${[
                          { value: 'low', label: 'Low' },
                          { value: 'medium', label: 'Medium' },
                          { value: 'high', label: 'High' },
                          { value: 'critical', label: 'Critical' },
                        ]}
                      />
                    </div>
                    <${SelectField} ariaLabel="Task epic" value=${newTaskEpic} onChange=${setNewTaskEpic} options=${createEpicOptions} />
                    <${SelectField} ariaLabel="Task milestone" value=${newTaskMilestone} onChange=${setNewTaskMilestone} options=${createMilestoneOptions} />
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => setNewTaskModalOpen(false)}>Cancel</${Button}>
                    <${Button} type="submit" className="active">Create Task</${Button}>
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${sessionModalOpen && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${sessionModalOpen} onOpenChange=${setSessionModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content">
                <form className="modal-form" onSubmit=${handleCreateSessionSubmit}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Start an agent session</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <div className="priority-field">
                      <span>Project task</span>
                      <${SelectField}
                        value=${sessionTaskId}
                        ariaLabel="Session task"
                        onChange=${setSessionTaskId}
                        options=${[
                          { value: '', label: 'Project session (no task)' },
                          ...tasks.map(task => ({ value: task.id, label: `${task.id} · ${task.title}` })),
                        ]}
                      />
                    </div>
                    <${TextArea}
                      aria-label="Resume note"
                      placeholder="What should the next agent know?"
                      value=${sessionResumeNote}
                      onInput=${e => setSessionResumeNote(e.target.value)}
                      required
                    />
                    <${TextArea}
                      aria-label="Next action"
                      placeholder="What is the next concrete action?"
                      value=${sessionNextAction}
                      onInput=${e => setSessionNextAction(e.target.value)}
                      required
                    />
                    ${sessionError && html`<div className="form-error" role="alert">${sessionError}</div>`}
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => setSessionModalOpen(false)}>Cancel</${Button}>
                    <${Button} type="submit" className="active">Save session</${Button}>
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${relinkModalOpen && activeProject && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${relinkModalOpen} onOpenChange=${setRelinkModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content">
                <form className="modal-form" onSubmit=${handleRelinkSubmit}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Relink project path</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <p className="muted">Choose the repository's new location. This keeps the project ID, tasks, and Atlas documents.</p>
                    <${TextInput}
                      aria-label="New repository path"
                      placeholder="/absolute/path/to/repository"
                      value=${relinkPath}
                      onInput=${e => setRelinkPath(e.target.value)}
                      required
                      autoFocus
                    />
                    ${relinkError && html`<div className="form-error" role="alert">${relinkError}</div>`}
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => setRelinkModalOpen(false)}>Cancel</${Button}>
                    <${Button} type="submit" className="active">Relink project</${Button}>
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${importModalOpen && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${importModalOpen} onOpenChange=${setImportModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside" size="lg">
              <${Modal.Dialog} className="modal-content wide">
                <form className="modal-form" onSubmit=${handleImportSubmit}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Import a local project</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <div className="import-path-row">
                      <${TextInput}
                        aria-label="Project directory path"
                        placeholder="/absolute/path/to/repo"
                        value=${importPath}
                        onInput=${e => setImportPath(e.target.value)}
                        required
                      />
                      <${Button}
                        type="button"
                        onClick=${handlePickFolder}
                        disabled=${pickingDir}
                        title="Open native folder picker"
                      >
                        ${pickingDir ? 'Choosing...' : 'Browse...'}
                      </${Button}>
                      <${Button}
                        type="button"
                        onClick=${toggleDirBrowser}
                        title="Browse folder list"
                        className=${showDirBrowser ? 'active' : ''}
                      >
                        Folders
                      </${Button}>
                    </div>
                    ${showDirBrowser && html`
                      <div className="directory-browser">
                        <div className="directory-toolbar">
                          <div className="directory-path" title=${browseDirData?.current}>
                            📁 ${browseDirData?.current || 'Loading...'}
                          </div>
                          <div className="btn-group">
                            ${browseDirData?.parent && html`
                              <${Button}
                                type="button"
                                onClick=${() => loadBrowseDir(browseDirData.parent)}
                                title="Go up to parent directory"
                              >
                                ⬆ Up
                              </${Button}>`}
                            <${Button}
                              type="button"
                              onClick=${() => loadBrowseDir(browseDirData?.homedir)}
                              title="Go to user home directory"
                            >
                              ⌂ Home
                            </${Button}>
                          </div>
                        </div>
                        <div className="directory-list">
                          ${browseDirLoading && html`<small className="muted">Loading…</small>`}
                          ${!browseDirLoading && browseDirData?.directories && browseDirData.directories.length === 0 &&
                            html`<small className="muted">No subdirectories found</small>`}
                          ${!browseDirLoading && browseDirData?.directories?.map(d => html`
                            <div key=${d.path} className="directory-entry">
                              <${Button}
                                type="button"
                                className="open-folder"
                                onClick=${() => loadBrowseDir(d.path)}
                                title=${`Open ${d.name}`}
                              >
                                📁 ${d.name}
                              </${Button}>
                              <${Button}
                                type="button"
                                onClick=${() => selectBrowseDir(d.path)}
                                title=${`Select ${d.name}`}
                              >
                                Select
                              </${Button}>
                            </div>
                          `)}
                        </div>
                        ${browseDirData?.current && html`
                          <div className="modal-actions">
                            <${Button}
                              type="button"
                              className="active"
                              onClick=${() => selectBrowseDir(browseDirData.current)}
                            >
                              Use Current Folder
                            </${Button}>
                          </div>`}
                      </div>`}
                    <${TextInput}
                      aria-label="Optional project key"
                      placeholder="Optional key (e.g. SAV)"
                      value=${importKey}
                      onInput=${e => setImportKey(e.target.value)}
                    />
                    ${importError && html`<div className="form-error" role="alert">${importError}</div>`}
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => { setImportModalOpen(false); }}>Cancel</${Button}>
                    <${Button} type="submit" className="active">Import Project</${Button}>
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${profileModalOpen && activeProject && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${profileModalOpen} onOpenChange=${setProfileModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content">
                <form className="modal-form" onSubmit=${handleProfileSave}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Edit project profile</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <div className="priority-field">
                      <span>Project status</span>
                      <${SelectField}
                        value=${profileStatusInput}
                        ariaLabel="Project status"
                        onChange=${setProfileStatusInput}
                        options=${[
                          { value: 'active', label: 'Active' },
                          { value: 'on_track', label: 'On track' },
                          { value: 'paused', label: 'Paused' },
                          { value: 'at_risk', label: 'At risk' },
                          { value: 'completed', label: 'Completed' },
                          { value: 'archived', label: 'Archived' },
                        ]}
                      />
                    </div>
                    <${TextArea}
                      aria-label="Project goals"
                      placeholder="High-level goals and current focus for this project"
                      value=${profileGoalsInput}
                      onInput=${e => setProfileGoalsInput(e.target.value)}
                      rows="4"
                    />
                    <${TextInput}
                      aria-label="Key documents"
                      placeholder="Key Atlas document paths or IDs, comma-separated"
                      value=${profileKeyDocsInput}
                      onInput=${e => setProfileKeyDocsInput(e.target.value)}
                    />
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => setProfileModalOpen(false)}>Cancel</${Button}>
                    <${Button} type="submit" className="active">Save profile</${Button}>
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${decisionModalOpen && activeProject && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${decisionModalOpen} onOpenChange=${setDecisionModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content">
                <form className="modal-form" onSubmit=${handleDecisionSave}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Record approved decision</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <p className="muted">Approved decisions are stored as append-only entries in <code>project/profile.md</code>.</p>
                    <${TextInput}
                      aria-label="Decision summary"
                      placeholder="Decision summary (e.g. Keep SQLite FTS5 as rebuildable index)"
                      value=${decisionSummary}
                      onInput=${e => setDecisionSummary(e.target.value)}
                      required
                      autoFocus
                    />
                    <${TextArea}
                      aria-label="Decision rationale"
                      placeholder="Why was this decision made?"
                      value=${decisionRationale}
                      onInput=${e => setDecisionRationale(e.target.value)}
                      rows="3"
                    />
                    <${TextInput}
                      aria-label="Linked documents"
                      placeholder="Optional linked Atlas doc paths/IDs, comma-separated"
                      value=${decisionLinks}
                      onInput=${e => setDecisionLinks(e.target.value)}
                    />
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => setDecisionModalOpen(false)}>Cancel</${Button}>
                    <${Button} type="submit" className="active">Approve & record</${Button}>
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${taskDetailModalOpen && taskDetailTask && activeProject && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${taskDetailModalOpen} onOpenChange=${setTaskDetailModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content wide task-detail-modal">
                <${Modal.Header}>
                  <${Modal.Heading} className="modal-heading">Task details · ${taskDetailTask.id}</${Modal.Heading}>
                </${Modal.Header}>
                <${Modal.Body} className="modal-form-body">
                  <h2 class="task-detail-title">${taskDetailTask.title}</h2>
                  <dl class="task-detail-grid">
                    <div><dt>Status</dt><dd>${taskDetailTask.status.replaceAll('_', ' ')}</dd></div>
                    <div><dt>Priority</dt><dd>${taskDetailTask.priority}</dd></div>
                    <div><dt>Epic</dt><dd>${taskDetailTask.epic || '—'}</dd></div>
                    <div><dt>Milestone</dt><dd>${taskDetailTask.milestone || '—'}</dd></div>
                    <div><dt>Checklist</dt><dd>${taskDetailTask.checklist?.total ? `${taskDetailTask.checklist.checked}/${taskDetailTask.checklist.total} complete` : 'None'}</dd></div>
                    <div class="task-detail-path"><dt>Markdown</dt><dd>${taskDetailTask.path}</dd></div>
                  </dl>
                  <section class="task-detail-section" aria-label="Dependencies">
                    <h3>Depends on</h3>
                    ${(taskDetailTask.dependsOn || []).length === 0 && html`<p class="muted-text">No dependencies.</p>`}
                    ${(taskDetailTask.dependsOn || []).map(id => {
                      const dependency = tasks.find(task => task.id.toLowerCase() === id.toLowerCase());
                      return html`<p key=${id}><strong>${id}</strong>${dependency ? ` · ${dependency.title} · ${dependency.status.replaceAll('_', ' ')}` : ' · Missing task'}</p>`;
                    })}
                  </section>
                  <section class="task-detail-section" aria-label="Description">
                    <h3>Description</h3>
                    ${taskDetailLoading && html`<p class="muted-text" role="status">Loading task description…</p>`}
                    ${taskDetailError && html`<p class="form-error" role="alert">${taskDetailError}</p>`}
                    ${!taskDetailLoading && !taskDetailError && html`<pre class="task-detail-description">${taskDetailBody || 'No description provided.'}</pre>`}
                  </section>
                </${Modal.Body}>
                <${Modal.Footer} className="modal-actions">
                  <${Button} type="button" onClick=${() => setTaskDetailModalOpen(false)}>Close</${Button}>
                  <${Button} type="button" onClick=${async () => {
                    const task = taskDetailTask;
                    setTaskDetailModalOpen(false);
                    setActiveModule('documents');
                    await selectDoc(task.path);
                  }}>Open Markdown</${Button}>
                </${Modal.Footer}>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${impactModalOpen && activeProject && impactTargetTask && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${impactModalOpen} onOpenChange=${setImpactModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content wide">
                <form className="modal-form" onSubmit=${handlePreviewImpact}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Task details & propose change: ${impactTargetTask.id}</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <div className="priority-field">
                      <span>Title</span>
                      <${TextInput} aria-label="Proposed task title" value=${impactTitle} onInput=${e => setImpactTitle(e.target.value)} />
                    </div>
                    <div className="priority-field">
                      <span>Priority</span>
                      <${SelectField}
                        value=${impactPriority}
                        ariaLabel="Proposed priority"
                        onChange=${setImpactPriority}
                        options=${[
                          { value: 'low', label: 'Low' },
                          { value: 'medium', label: 'Medium' },
                          { value: 'high', label: 'High' },
                          { value: 'critical', label: 'Critical' },
                        ]}
                      />
                    </div>
                    <div className="priority-field">
                      <span>Status</span>
                      <${SelectField}
                        value=${impactStatus}
                        ariaLabel="Proposed status"
                        onChange=${setImpactStatus}
                        options=${[
                          { value: 'todo', label: 'To do' },
                          { value: 'in_progress', label: 'In progress' },
                          { value: 'blocked', label: 'Blocked' },
                          { value: 'done', label: 'Done' },
                          { value: 'cancelled', label: 'Cancelled' },
                        ]}
                      />
                    </div>
                    <${SelectField} ariaLabel="Proposed Epic" value=${impactEpic} onChange=${setImpactEpic} options=${epicOptions} />
                    <${SelectField} ariaLabel="Proposed Milestone" value=${impactMilestone} onChange=${setImpactMilestone} options=${milestoneOptions} />
                    <div className="priority-field"><span>Checklist and task description</span>
                      <${TextArea} aria-label="Proposed task description" value=${impactBody} onInput=${e => setImpactBody(e.target.value)} rows=${4} />
                    </div>
                    <fieldset className="priority-field" aria-label="Task dependencies">
                      <legend>Depends on</legend>
                      <span className="muted-text">Choose tasks in this project. Done and cancelled dependencies are treated as resolved; task status never changes automatically.</span>
                      <div className="dependency-options">
                        ${tasks.filter(task => task.id !== impactTargetTask.id).map(task => {
                          const selected = currentDependencyIds.some(id => id.toLowerCase() === task.id.toLowerCase());
                          return html`<label key=${task.id} className="dependency-option"><input type="checkbox" checked=${selected} onChange=${e => {
                            const selectedIds = impactDependsOn.split(',').map(id => id.trim()).filter(Boolean).filter(id => id.toLowerCase() !== task.id.toLowerCase());
                            if (e.target.checked) selectedIds.push(task.id);
                            setImpactDependsOn(selectedIds.join(', '));
                          }} /> <strong>${task.id}</strong> ${task.title} <span className="badge">${task.status}</span></label>`;
                        })}
                        ${currentDependencyIds.filter(id => !tasks.some(task => task.id.toLowerCase() === id.toLowerCase())).map(id => html`<label key=${`legacy-${id}`} className="dependency-option"><input type="checkbox" checked onChange=${e => {
                          const selectedIds = impactDependsOn.split(',').map(value => value.trim()).filter(value => value && value.toLowerCase() !== id.toLowerCase());
                          setImpactDependsOn(selectedIds.join(', '));
                        }} /> <strong>${id}</strong> <span className="badge" style="color:var(--danger)">Unresolved legacy reference · remove</span></label>`)}
                      </div>
                    </fieldset>
                    <fieldset className="priority-field" aria-label="Linked documents">
                      <legend>Linked documents</legend>
                      <span className="muted-text">Links currently on disk. Add or remove a link, then prepare and confirm the impact summary; the Markdown is unchanged until then.</span>
                      ${impactDocumentsLoading && html`<div className="muted-text" role="status">Loading linked documents…</div>`}
                      ${impactDocumentsError && html`<div className="form-error" role="alert">${impactDocumentsError}</div>`}
                      ${!impactDocumentsLoading && !impactDocumentsError && impactDocuments.length === 0 && !bodyHasLinks && html`
                        <div className="muted-text">No linked documents yet. Add one below or write a Markdown link such as <code>[[specs/plan.md]]</code> in the task description.</div>
                      `}
                      ${!impactDocumentsLoading && !impactDocumentsError && impactDocuments.length === 0 && bodyHasLinks && html`
                        <div className="muted-text">The description now contains links. Confirm the proposal to resolve and list them.</div>
                      `}
                      ${impactDocuments.length > 0 && html`
                        <ul className="linked-documents" aria-label="Linked document list">
                          ${impactDocuments.map(doc => html`
                            <li key=${doc.path}>
                              <${Button}
                                type="button"
                                className="text-link"
                                title=${doc.path}
                                aria-label=${`${doc.title} (${doc.path})`}
                                onClick=${async () => {
                                  setImpactModalOpen(false);
                                  setActiveModule('documents');
                                  await selectDoc(doc.path);
                                }}
                              >
                                ${doc.title}
                              <//>
                              <span className="muted-text"> ${doc.path}${doc.type ? ` · ${doc.type}` : ''}${doc.status ? ` · ${doc.status}` : ''}</span>
                              ${bodyHasRef(impactBody, doc.refs) && html`
                                <${Button} type="button" className="text-link" aria-label=${`Remove link to ${doc.path}`} onClick=${() => handleRemoveTaskLink(doc.refs)}>Remove link</${Button}>
                              `}
                            </li>
                          `)}
                        </ul>
                      `}
                      ${impactDocumentsTruncated && html`<div className="muted-text">Additional linked documents are not shown.</div>`}
                      <div className="linked-document-picker">
                        <${SelectField}
                          ariaLabel="Document to link"
                          className="linked-document-select"
                          value=${impactLinkTarget}
                          onChange=${setImpactLinkTarget}
                          options=${[{ value: '', label: 'Choose a document…' }, ...linkableDocs.map(path => ({ value: path, label: path }))]}
                        />
                        <${Button} type="button" className="text-link" disabled=${!impactLinkTarget} onClick=${handleAddTaskLink}>Add link</${Button}>
                      </div>
                      ${(docsList || []).length > 0 && linkableDocs.length === 0 && html`
                        <div className="muted-text">No unlinked Atlas documents are available; add a Markdown link manually if needed.</div>
                      `}
                      ${impactUnresolved.length > 0 && html`
                        <div className="muted-text" style="color:var(--warning)">
                          Unresolved links stay in the Markdown: ${impactUnresolved.map((ref, index) => html`
                            <span key=${`${ref}-${index}`}>${ref}${bodyHasRef(impactBody, [ref]) ? html` <${Button} type="button" className="text-link" aria-label=${`Remove unresolved link ${ref}`} onClick=${() => handleRemoveTaskLink([ref])}>Remove</${Button}>` : ''}${index < impactUnresolved.length - 1 ? ', ' : ''}</span>
                          `)}${impactUnresolvedTruncated ? ' (more not shown)' : ''}
                        </div>
                      `}
                    </fieldset>
                    ${impactError && html`<div className="form-error" role="alert">${impactError}</div>`}
                    <div className="muted-text">Changes are applied only after reviewing the impact summary and confirming.</div>
                    ${impactPreview && html`
                      <div className="dashboard-panel" style="margin-top:8px">
                        <strong>Impact summary prepared (${impactPreview.path})</strong>
                        <ul style="margin:6px 0;padding-left:18px">
                          ${(impactPreview.impact?.changedFields || []).map(f => html`<li key=${f.field}><strong>${f.field}</strong>: <code>${JSON.stringify(f.before)}</code> → <code>${JSON.stringify(f.after)}</code></li>`)}
                          ${(impactPreview.impact?.affectedDownstreamTasks || []).map(t => html`<li key=${t.id}>Downstream task affected: <strong>${t.id}</strong> (${t.title})</li>`)}
                          ${(impactPreview.impact?.rollupImpact || []).map((r, i) => html`<li key=${i}>${r}</li>`)}
                          ${(impactPreview.impact?.warnings || []).map((w, i) => html`<li key=${`w-${i}`} style="color:var(--warning)">⚠ ${w}</li>`)}
                        </ul>
                      </div>
                    `}
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => setImpactModalOpen(false)}>Close</${Button}>
                    <${Button} type="button" onClick=${async () => { setImpactModalOpen(false); setActiveModule('documents'); await selectDoc(impactTargetTask.path); }}>Open Markdown</${Button}>
                    ${!impactPreview ? html`
                      <${Button} type="submit" className="active">Prepare impact summary</${Button}>
                    ` : html`
                      <${Button} type="button" onClick=${handleRejectImpact}>Reject</${Button}>
                      <${Button} type="button" className="button--primary" onClick=${handleConfirmImpact}>Confirm & apply change</${Button}>
                    `}
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${structureModalOpen && activeProject && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${structureModalOpen} onOpenChange=${setStructureModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content">
                <form className="modal-form" onSubmit=${handleStructureSubmit}>
                  <${Modal.Header}><${Modal.Heading} className="modal-heading">${structureRecord ? 'Edit' : 'Create'} ${structureType}</${Modal.Heading}></${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <${TextInput} aria-label="Roadmap item title" value=${structureTitle} onInput=${e => setStructureTitle(e.target.value)} required />
                    <div className="priority-field"><span>Status</span><${SelectField}
                      ariaLabel="Roadmap item status" value=${structureStatus} onChange=${setStructureStatus}
                      options=${structureType === 'epic'
                        ? [{ value: 'todo', label: 'To do' }, { value: 'in_progress', label: 'In progress' }, { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' }]
                        : [{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }]}
                    /></div>
                    ${structureType === 'epic' ? html`<div className="priority-field"><span>Milestone</span><${SelectField} ariaLabel="Epic milestone" value=${structureMilestone} onChange=${setStructureMilestone} options=${structureMilestoneOptions} /></div>` : html`<div className="priority-field"><span>Target date</span><${TextInput} aria-label="Milestone target date" type="date" value=${structureTargetDate} onInput=${e => setStructureTargetDate(e.target.value)} /></div>`}
                    ${structureError && html`<div className="form-error" role="alert">${structureError}</div>`}
                    ${structureRecord && !structureEtag && !structureError && html`<div className="muted-text">Loading current Markdown version…</div>`}
                    <div className="muted-text">Existing Markdown body and custom frontmatter are preserved. Changes use the document ETag.</div>
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => setStructureModalOpen(false)}>Cancel</${Button}>
                    <${Button} type="submit" className="button--primary" isDisabled=${Boolean(structureRecord && !structureEtag)}>${structureRecord ? 'Save changes' : `Create ${structureType}`}</${Button}>
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${recapModalOpen && recapDraft && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${recapModalOpen} onOpenChange=${setRecapModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside" size="lg">
              <${Modal.Dialog} className="modal-content wide">
                <${Modal.Header}>
                  <${Modal.Heading} className="modal-heading">Project recap draft · ${recapDraft.projectKey}</${Modal.Heading}>
                </${Modal.Header}>
                <${Modal.Body} className="modal-form-body">
                  <pre style="white-space:pre-wrap;font-size:12px;max-height:420px;overflow:auto;padding:12px;background:var(--surface-secondary, #18181b);border-radius:8px">${recapDraft.markdown}</pre>
                </${Modal.Body}>
                <${Modal.Footer} className="modal-actions">
                  <${Button} type="button" onClick=${() => setRecapModalOpen(false)}>Close</${Button}>
                  <${Button} type="button" className="button--primary" onClick=${() => generateRecap(true)} isDisabled=${recapLoading}>Save recap as Atlas doc</${Button}>
                </${Modal.Footer}>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}

      ${templateModalOpen && activeProject && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${templateModalOpen} onOpenChange=${setTemplateModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content">
                <form className="modal-form" onSubmit=${handleApplyTemplateSubmit}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Create document from role template</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
                    <div className="priority-field">
                      <span>Template</span>
                      <${SelectField}
                        value=${selectedTemplateId}
                        ariaLabel="Document template"
                        onChange=${val => {
                          setSelectedTemplateId(val);
                          const defaults = {
                            prd: 'specs/PRD-Feature.md',
                            adr: 'architecture/ADR-001.md',
                            bug_report: 'qa/BUG-001.md',
                            release_checklist: 'releases/Release-v1.md',
                          };
                          if (defaults[val]) setTemplatePathInput(defaults[val]);
                        }}
                        options=${(docTemplates.length > 0 ? docTemplates : [
                          { id: 'prd', name: 'Product Requirements Document (PRD)', role: 'PM' },
                          { id: 'adr', name: 'Architecture Decision Record (ADR)', role: 'Architect' },
                          { id: 'bug_report', name: 'Bug Triage & Reproduction Report', role: 'QA' },
                          { id: 'release_checklist', name: 'Release & Verification Checklist', role: 'Release' },
                        ]).map(t => ({ value: t.id, label: `${t.name} (${t.role})` }))}
                      />
                    </div>
                    <${TextInput}
                      aria-label="Document path"
                      placeholder="Target Markdown path (e.g. specs/PRD-Auth.md)"
                      value=${templatePathInput}
                      onInput=${e => setTemplatePathInput(e.target.value)}
                      required
                    />
                    <${TextInput}
                      aria-label="Document title"
                      placeholder="Document heading title (optional)"
                      value=${templateTitleInput}
                      onInput=${e => setTemplateTitleInput(e.target.value)}
                    />
                    <${TextInput}
                      aria-label="Document ID"
                      placeholder="Optional stable ID (e.g. SPEC-AUTH)"
                      value=${templateDocIdInput}
                      onInput=${e => setTemplateDocIdInput(e.target.value)}
                    />
                    ${templateError && html`<div className="form-error" role="alert">${templateError}</div>`}
                  </${Modal.Body}>
                  <${Modal.Footer} className="modal-actions">
                    <${Button} type="button" onClick=${() => setTemplateModalOpen(false)}>Cancel</${Button}>
                    <${Button} type="submit" className="active">Create document</${Button}>
                  </${Modal.Footer}>
                </form>
              </${Modal.Dialog}>
            </${Modal.Container}>
          </${Modal.Backdrop}>
        </${Modal}>`}
    </div>
  `;
}
