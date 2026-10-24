import { html, Button, Modal, TextInput, TextArea, SelectField } from './Common.js';
import { useWorkspaceStore } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';
import { useTaskStore } from '../stores/useTaskStore.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { useProfileStore } from '../stores/useProfileStore.js';
import { useModalStore } from '../stores/useModalStore.js';

export function Modals() {
  const {
    projectsList,
    activeProject,
    selectProject,
    relinkProject,
    importProject,
    setActiveModule,
  } = useWorkspaceStore();

  const { selectDoc } = useDocumentStore();
  const { createTask, tasks } = useTaskStore();
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
    setSearchQuery,
    setSearchType,
    setSearchStatus,
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
    impactModalOpen,
    impactTargetTask,
    impactPriority,
    impactStatus,
    impactEpic,
    impactMilestone,
    impactDependsOn,
    impactPreview,
    impactError,
    setImpactModalOpen,
    setImpactPriority,
    setImpactStatus,
    setImpactEpic,
    setImpactMilestone,
    setImpactDependsOn,
    setImpactPreview,
    setImpactError,
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
    const dependsOn = impactDependsOn.trim()
      ? impactDependsOn.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    try {
      const res = await previewImpact(impactTargetTask, {
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
              <${Modal.Dialog} className="modal-content wide">
                <${Modal.Header}>
                  <${Modal.Heading} className="modal-heading">Search Atlas documents</${Modal.Heading}>
                </${Modal.Header}>
                <${Modal.Body} className="modal-form">
                  <${TextInput}
                    aria-label="Search documents, titles, or IDs"
                    placeholder="Search documents, titles, or IDs..."
                    value=${searchQuery}
                    onInput=${e => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  <div className="filter-row">
                    <${TextInput}
                      aria-label="Filter by document type"
                      placeholder="Type (e.g. spec, task)"
                      value=${searchType}
                      onInput=${e => setSearchType(e.target.value)}
                    />
                    <${TextInput}
                      aria-label="Filter by document status"
                      placeholder="Status (e.g. todo, done)"
                      value=${searchStatus}
                      onInput=${e => setSearchStatus(e.target.value)}
                    />
                  </div>
                  <div className="search-results">
                    ${searchResults.map(item => html`
                      <${Button}
                        key=${item.path}
                        className="project-item"
                        onClick=${() => handleSearchResult(item)}
                      >
                        <span className="search-result-main">
                          <strong>${item.docId ? `[${item.docId}] ` : ''}${item.title}</strong>
                          <small className="muted">${item.projectKey ? `[${item.projectKey}] ` : ''}${item.path}</small>
                        </span>
                        <small className="muted">${item.type || 'doc'}${item.status ? ` · ${item.status}` : ''}</small>
                      </${Button}>
                    `)}
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
                    <${TextInput}
                      aria-label="Epic ID or name"
                      placeholder="Optional Epic ID or name (e.g. SAV-002)"
                      value=${newTaskEpic}
                      onInput=${e => setNewTaskEpic(e.target.value)}
                    />
                    <${TextInput}
                      aria-label="Milestone ID or name"
                      placeholder="Optional Milestone ID or name (e.g. SAV-001)"
                      value=${newTaskMilestone}
                      onInput=${e => setNewTaskMilestone(e.target.value)}
                    />
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

      ${impactModalOpen && activeProject && impactTargetTask && html`
        <${Modal}>
          <${Modal.Backdrop} isOpen=${impactModalOpen} onOpenChange=${setImpactModalOpen} isDismissable>
            <${Modal.Container} placement="center" scroll="inside">
              <${Modal.Dialog} className="modal-content wide">
                <form className="modal-form" onSubmit=${handlePreviewImpact}>
                  <${Modal.Header}>
                    <${Modal.Heading} className="modal-heading">Propose change & review impact: ${impactTargetTask.id}</${Modal.Heading}>
                  </${Modal.Header}>
                  <${Modal.Body} className="modal-form-body">
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
                    <${TextInput}
                      aria-label="Proposed Epic"
                      placeholder="Epic ID or name"
                      value=${impactEpic}
                      onInput=${e => setImpactEpic(e.target.value)}
                    />
                    <${TextInput}
                      aria-label="Proposed Milestone"
                      placeholder="Milestone ID or name"
                      value=${impactMilestone}
                      onInput=${e => setImpactMilestone(e.target.value)}
                    />
                    <fieldset className="priority-field" aria-label="Task dependencies">
                      <legend>Depends on</legend>
                      <span className="muted-text">Choose tasks in this project. Done and cancelled dependencies are treated as resolved; task status never changes automatically.</span>
                      <div className="dependency-options">
                        ${tasks.filter(task => task.id !== impactTargetTask.id).map(task => {
                          const selected = impactDependsOn.split(',').map(id => id.trim().toLowerCase()).includes(task.id.toLowerCase());
                          return html`<label key=${task.id} className="dependency-option"><input type="checkbox" checked=${selected} onChange=${e => {
                            const selectedIds = impactDependsOn.split(',').map(id => id.trim()).filter(Boolean).filter(id => id.toLowerCase() !== task.id.toLowerCase());
                            if (e.target.checked) selectedIds.push(task.id);
                            setImpactDependsOn(selectedIds.join(', '));
                          }} /> <strong>${task.id}</strong> ${task.title} <span className="badge">${task.status}</span></label>`;
                        })}
                      </div>
                    </fieldset>
                    ${impactError && html`<div className="form-error" role="alert">${impactError}</div>`}
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
                    ${!impactPreview ? html`
                      <${Button} type="submit" className="active">Prepare impact summary</${Button}>
                    ` : html`
                      <${Button} type="button" onClick=${() => { rejectProposal(impactPreview); setImpactModalOpen(false); setImpactPreview(null); }}>Reject</${Button}>
                      <${Button} type="button" className="button--primary" onClick=${() => { confirmProposal(impactPreview); setImpactModalOpen(false); setImpactPreview(null); }}>Confirm & apply change</${Button}>
                    `}
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
