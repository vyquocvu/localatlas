import { useMemo, useEffect, useRef, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { html, Button, TextArea, Checkbox as HeroCheckbox } from './Common.js';
import { renderMarkdownSafe, resolveRelativeDocLink, parseFrontmatterProperties, getDocStats } from '../utils/markdown.js';
import { useWorkspaceStore, AGENT_LABELS, AGENT_SHORT_LABELS } from '../stores/useWorkspaceStore.js';
import { useDocumentStore } from '../stores/useDocumentStore.js';

export function DocumentWorkspace() {
  const { activeProject, launchAgent, terminalAgent } = useWorkspaceStore();
  const {
    docSource,
    activeDoc,
    sourceDocPath,
    sourceDocContent,
    sourceDocs,
    content,
    dirty,
    mode,
    conflict,
    recoveryDraft,
    setMode,
    setContent,
    saveDocument,
    openDocument,
    restoreDraft,
    discardDraft,
    saveLocalVersion,
    selectDoc,
    toggleTaskCheckbox,
  } = useDocumentStore();

  const previewHostRef = useRef(null);

  const docStats = useMemo(() => getDocStats(content), [content]);
  const frontmatterProps = useMemo(() => parseFrontmatterProperties(content), [content]);
  const previewHtml = useMemo(() => ({ __html: renderMarkdownSafe(content) }), [content]);
  const sourcePreviewHtml = useMemo(() => ({ __html: renderMarkdownSafe(sourceDocContent) }), [sourceDocContent]);

  const handlePreviewClick = async e => {
    const link = e.target.closest('a[data-doc-link]');
    if (link && activeProject) {
      e.preventDefault();
      const target = link.getAttribute('data-doc-link');
      if (target) {
        const resolved = resolveRelativeDocLink(activeDoc || '', target);
        if (resolved) selectDoc(resolved);
      }
    }
  };

  useEffect(() => {
    const previewHost = previewHostRef.current;
    if (!previewHost) return;
    const checkboxRoots = [];
    for (const checkboxHost of previewHost.querySelectorAll('[data-task-checkbox]')) {
      const lineIdx = Number(checkboxHost.getAttribute('data-line'));
      if (!Number.isInteger(lineIdx)) continue;
      const checkboxRoot = createRoot(checkboxHost);
      checkboxRoot.render(createElement(
        HeroCheckbox,
        {
          className: 'markdown-checkbox',
          isSelected: checkboxHost.getAttribute('data-checked') === 'true',
          'aria-label': checkboxHost.getAttribute('data-label') || `Checklist item ${lineIdx + 1}`,
          onChange: checked => toggleTaskCheckbox(lineIdx, checked),
        },
        createElement(
          HeroCheckbox.Content,
          null,
          createElement(HeroCheckbox.Control, null, createElement(HeroCheckbox.Indicator))
        )
      ));
      checkboxRoots.push(checkboxRoot);
    }
    return () => checkboxRoots.forEach(root => root.unmount());
  }, [previewHtml, mode, toggleTaskCheckbox]);

  return html`
    <div class="document-workspace">
      <div class="obsidian-editor-bar">
        <div class="obsidian-breadcrumb" title=${docSource === 'atlas' ? activeDoc || '' : sourceDocPath || ''}>
          <span class="folder-name">${activeProject ? activeProject.name : 'Workspace'}</span><span>/</span>
          <span>${docSource === 'atlas' ? activeDoc || 'Select an Atlas document' : sourceDocPath || 'Select a repository document'}</span>
          ${dirty && html`<span class="dirty-dot" title="Unsaved changes">●</span>`}
        </div>
        ${docSource === 'atlas' ? html`
          <div class="document-toolbar-actions">
            <div class="obsidian-mode-tabs">
              <${Button} className=${'obsidian-mode-tab' + (mode === 'edit' ? ' active' : '')} onClick=${() => setMode('edit')}>Edit</${Button}>
              <${Button} className=${'obsidian-mode-tab' + (mode === 'split' ? ' active' : '')} onClick=${() => setMode('split')}>Split</${Button}>
              <${Button} className=${'obsidian-mode-tab' + (mode === 'preview' ? ' active' : '')} onClick=${() => setMode('preview')}>Preview</${Button}>
            </div>
            <${Button}
              className="text-link"
              disabled=${dirty || !activeDoc}
              title=${dirty ? `Save changes before sending this document to ${AGENT_LABELS[terminalAgent]}` : `Open ${AGENT_LABELS[terminalAgent]} with this Atlas document`}
              onClick=${() => launchAgent({ type: 'document', source: 'atlas', path: activeDoc })}
            >Ask ${AGENT_SHORT_LABELS[terminalAgent]}</${Button}>
            <${Button} className="button--primary" onClick=${() => saveDocument(false)} disabled=${!activeProject || !activeDoc}>Save changes</${Button}>
          </div>
        ` : html`<div style="display:flex;align-items:center;gap:10px"><span class="read-only-badge">◉ Read only</span>
          <${Button}
            className="text-link"
            disabled=${!sourceDocPath}
            title=${`Open ${AGENT_LABELS[terminalAgent]} with this read-only repository document`}
            onClick=${() => launchAgent({ type: 'document', source: 'repo', path: sourceDocPath })}
          >Ask ${AGENT_SHORT_LABELS[terminalAgent]}</${Button}>
        </div>`}
      </div>

      ${docSource === 'repo' && html`
        <div class="repo-read-only-banner">
          <span>Repository file · read-only</span>
          <small>This file stays in the imported project. Create or edit a separate Atlas doc from the Docs source switch.</small>
        </div>
      `}

      ${docSource === 'atlas' && frontmatterProps.length > 0 && html`
        <div class="obsidian-properties-bar">
          ${frontmatterProps.map(p => html`<span key=${p.key} class="property-chip"><span class="property-key">${p.key}:</span><span class="property-value">${p.value}</span></span>`)}
        </div>
      `}

      ${docSource === 'atlas' && recoveryDraft && html`
        <div class="banner banner-warning draft-recovery-banner">
          <div><strong>A saved browser draft is available.</strong><small>Saved ${recoveryDraft.savedAt || 'before the last reload'}; restoring it keeps this text unsaved until you save.</small></div>
          <div class="btn-group"><${Button} onClick=${restoreDraft}>Restore draft</${Button}><${Button} onClick=${discardDraft}>Discard draft</${Button}></div>
        </div>
      `}

      ${docSource === 'atlas' && conflict && html`
        <div class="banner banner-danger draft-conflict-banner">
          <span>⚠️ Conflict: ${conflict.message}</span>
          <div class="draft-comparison">
            <label>Local version<${TextArea} value=${content} readOnly=${true} spellcheck="false" /></label>
            <label>Version on disk<${TextArea} value=${conflict.diskContent ?? `Unable to load the current disk version. ${conflict.diskLoadError || ''}`} readOnly=${true} spellcheck="false" /></label>
          </div>
          <small>Saving your local version replaces the displayed disk version only if its ETag stays current.</small>
          <div class="btn-group">
            <${Button} onClick=${() => openDocument(activeProject, activeDoc)}>Reload disk version</${Button}>
            <${Button} className="danger" disabled=${!conflict.currentEtag} onClick=${saveLocalVersion}>Save my version on disk</${Button}>
          </div>
        </div>
      `}

      ${docSource === 'atlas' ? html`
        <div class=${'workspace-panes ' + (mode === 'split' ? 'split' : 'single')}>
          ${(mode === 'edit' || mode === 'split') && html`
            <${TextArea}
              class="editor"
              value=${content}
              disabled=${!activeDoc}
              placeholder="Select or create a Markdown document"
              spellcheck="false"
              onInput=${e => setContent(e.target.value)}
            ></${TextArea}>
          `}
          ${(mode === 'preview' || mode === 'split') && html`
            <div ref=${previewHostRef} class="preview-pane" onClick=${handlePreviewClick} dangerouslySetInnerHTML=${previewHtml}></div>
          `}
        </div>
        <div class="obsidian-status-bar">
          <div>${docStats.lines} lines · ${docStats.words} words · ${docStats.chars} characters</div>
          <div>${activeDoc ? (dirty ? '● Unsaved changes' : 'Saved') : 'No file'} · UTF-8</div>
        </div>
      ` : html`
        ${sourceDocPath ? html`
          <div class="repo-doc-meta">
            <span>📄 ${sourceDocPath}</span>
            <span>${sourceDocs.find(item => item.path === sourceDocPath)?.sizeBytes ?? 0} bytes</span>
          </div>
        ` : html`<div class="repo-doc-empty">Choose a Markdown file from the repository tree.</div>`}
        ${sourceDocPath && html`
          <div class="workspace-panes single">
            <div class="preview-pane repo-preview" dangerouslySetInnerHTML=${sourcePreviewHtml}></div>
          </div>
        `}
      `}
    </div>
  `;
}
