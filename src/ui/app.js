import { createElement, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Button as HeroButton } from '@heroui/react/button';
import { Card } from '@heroui/react/card';
import { Checkbox as HeroCheckbox } from '@heroui/react/checkbox';
import { Input as HeroInput } from '@heroui/react/input';
import { ListBox } from '@heroui/react/list-box';
import { Modal } from '@heroui/react/modal';
import { Select } from '@heroui/react/select';
import { TextArea as HeroTextArea } from '@heroui/react/textarea';
import htm from 'htm';
import './styles.css';

function parseInlineStyle(style) {
  if (typeof style !== 'string') return style;
  const result = {};
  for (const rule of style.split(';')) {
    const splitAt = rule.indexOf(':');
    if (splitAt < 0) continue;
    const rawName = rule.slice(0, splitAt).trim();
    const value = rule.slice(splitAt + 1).trim();
    if (!rawName || !value) continue;
    const name = rawName.startsWith('--')
      ? rawName
      : rawName.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    result[name] = value;
  }
  return result;
}

function reactElement(type, props, ...children) {
  const mapped = { ...(props || {}) };
  if (Object.hasOwn(mapped, 'class')) {
    mapped.className = mapped.class;
    delete mapped.class;
  }
  if (Object.hasOwn(mapped, 'autofocus')) {
    mapped.autoFocus = mapped.autofocus;
    delete mapped.autofocus;
  }
  if (Object.hasOwn(mapped, 'spellcheck')) {
    mapped.spellCheck = mapped.spellcheck;
    delete mapped.spellcheck;
  }
  if (typeof mapped.style === 'string') mapped.style = parseInlineStyle(mapped.style);
  return createElement(type, mapped, ...children);
}

function Button({ className = '', onClick, onPress, disabled, isDisabled, variant, size = 'sm', ...props }) {
  const classes = String(className);
  const resolvedVariant = variant || (
    classes.includes('danger') ? 'danger' :
      classes.includes('active') ? 'primary' :
        /project-item|tree-row|tree-folder/.test(classes) ? 'ghost' : 'secondary'
  );
  return createElement(HeroButton, {
    ...props,
    className: `action-button ${classes}`.trim(),
    variant: resolvedVariant,
    size,
    isDisabled: isDisabled ?? disabled,
    onPress: onPress ?? onClick,
  });
}

function TextInput({ className = '', onInput, onChange, variant = 'secondary', ...props }) {
  return createElement(HeroInput, {
    ...props,
    className: `atlas-input ${className}`.trim(),
    variant,
    onChange: onChange ?? onInput,
  });
}

function TextArea({ className = '', onInput, onChange, variant = 'secondary', ...props }) {
  return createElement(HeroTextArea, {
    ...props,
    className: `atlas-textarea ${className}`.trim(),
    variant,
    onChange: onChange ?? onInput,
  });
}

const html = htm.bind(reactElement);

function SelectField({ value, onChange, options, className = '', style, ariaLabel }) {
  const selectedValue = value === '' || value === null || value === undefined ? '__empty__' : String(value);
  return html`
    <${Select}
      className=${className}
      style=${style}
      value=${selectedValue}
      aria-label=${ariaLabel}
      onChange=${next => onChange?.(next === '__empty__' ? '' : String(next))}
    >
      <${Select.Trigger}>
        <${Select.Value} />
        <${Select.Indicator} />
      </${Select.Trigger}>
      <${Select.Popover}>
        <${ListBox}>
          ${options.map(option => html`
            <${ListBox.Item}
              key=${option.value}
              id=${option.value === '' ? '__empty__' : String(option.value)}
              textValue=${option.label}
            >
              ${option.label}
              <${ListBox.ItemIndicator} />
            </${ListBox.Item}>
          `)}
        </${ListBox}>
      </${Select.Popover}>
    </${Select}>
  `;
}

const encPath = s => s.split('/').map(encodeURIComponent).join('/');

export function buildFileTree(paths) {
  const root = [];
  for (const rawPath of paths) {
    const parts = rawPath.split('/').filter(Boolean);
    let level = root;
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (i === parts.length - 1) {
        level.push({ name: part, path: currentPath, type: 'file' });
      } else {
        let folder = level.find(n => n.type === 'folder' && n.name === part);
        if (!folder) {
          folder = { name: part, path: currentPath, type: 'folder', children: [] };
          level.push(folder);
        }
        level = folder.children;
      }
    }
  }
  const sortNodes = nodes => {
    nodes.sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)));
    for (const n of nodes) if (n.children) sortNodes(n.children);
    return nodes;
  };
  return sortNodes(root);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resolveRelativeDocLink(baseDocPath, targetLink) {
  const trimmed = String(targetLink ?? '').trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes('\\')) return null;
  const isExplicitRelative = trimmed.startsWith('./') || trimmed.startsWith('../');
  const baseParts = isExplicitRelative && baseDocPath ? baseDocPath.split('/').filter(Boolean).slice(0, -1) : [];
  const rawSegments = trimmed.split('/');
  const resolved = [...baseParts];
  for (const seg of rawSegments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  if (resolved.length === 0) return null;
  const joined = resolved.join('/');
  return joined.endsWith('.md') ? joined : `${joined}.md`;
}

function sanitizeHref(rawHref) {
  if (/[\u0000-\u001f\u007f\\]/.test(rawHref)) return null;
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;

  const decoded = trimmed
    .replace(/&#(\d+);?/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/[\u0000-\u0020\u007f]+/g, '');

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) {
    if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
      return { href: escapeHtml(trimmed) };
    }
    return null;
  }

  const cleanDoc = trimmed.replace(/^\.\//, '');
  if (cleanDoc.endsWith('.md') && !cleanDoc.startsWith('/')) {
    return { href: `#doc:${escapeHtml(cleanDoc)}`, docLink: escapeHtml(cleanDoc) };
  }
  return { href: escapeHtml(trimmed) };
}

function renderInline(line) {
  const codeSpans = [];
  const withPlaceholders = line.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = codeSpans.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\u0000CODE${idx}\u0000`;
  });
  let strippedHtml = withPlaceholders;
  while (/<\/?[a-zA-Z][^>]*>/.test(strippedHtml)) {
    strippedHtml = strippedHtml.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  }
  let escaped = escapeHtml(strippedHtml);
  escaped = escaped.replace(/\[\[([A-Za-z0-9_./-]+)\]\]/g, (_m, target) => {
    return `<a href="#doc:${target}" data-doc-link="${target}" class="wiki-link">[[${target}]]</a>`;
  });
  escaped = escaped.replace(
    /\[([^\]]+)\]\(([^\u0000()\s]*(?:\([^\u0000()\s]*\)[^\u0000()\s]*)*)\)/g,
    (_m, label, rawUrl) => {
      const unescaped = rawUrl
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const safe = sanitizeHref(unescaped);
      if (!safe) return label;
      const attr = safe.docLink ? ` data-doc-link="${safe.docLink}"` : ' target="_blank" rel="noopener noreferrer"';
      return `<a href="${safe.href}"${attr}>${label}</a>`;
    }
  );
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return escaped.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx) => codeSpans[Number(idx)] ?? '');
}

export function renderMarkdownSafe(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeLines = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      closeList();
      if (!inCode) {
        inCode = true;
        codeLines = [];
      } else {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (/^---\s*$/.test(line)) {
      closeList();
      out.push('<hr>');
      continue;
    }
    const hMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (hMatch) {
      closeList();
      out.push(`<h${hMatch[1].length}>${renderInline(hMatch[2])}</h${hMatch[1].length}>`);
      continue;
    }
    const taskMatch = /^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (taskMatch) {
      if (!inList) {
        out.push('<ul class="task-list">');
        inList = true;
      }
      const selected = taskMatch[2].toLowerCase() === 'x';
      out.push(
        `<li class="task-item"><span class="task-checkbox-host" data-task-checkbox data-line="${i}" data-checked="${selected}" data-label="${escapeHtml(taskMatch[3])}"></span> ${renderInline(taskMatch[3])}</li>`
      );
      continue;
    }
    const lMatch = /^(\s*)[-*]\s+(.+)$/.exec(line);
    if (lMatch) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${renderInline(lMatch[2])}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  return out.join('\n');
}

function parseHashRoute(hash) {
  const clean = (hash || '').replace(/^#\/?/, '');
  const m = /^projects\/([^/]+)(?:\/docs\/(.+))?$/.exec(clean);
  if (!m) return { projectId: null, docPath: null };
  return {
    projectId: decodeURIComponent(m[1]),
    docPath: m[2] ? m[2].split('/').map(decodeURIComponent).join('/') : null,
  };
}

function setHashRoute(projectId, docPath) {
  if (!projectId) {
    window.location.hash = '';
    return;
  }
  const base = `#/projects/${encodeURIComponent(projectId)}`;
  window.location.hash = docPath ? `${base}/docs/${encPath(docPath)}` : base;
}

function parseFrontmatterProperties(markdown) {
  if (!markdown || !markdown.startsWith('---')) return [];
  const endIdx = markdown.indexOf('\n---', 3);
  if (endIdx === -1) return [];
  const fmText = markdown.slice(3, endIdx).trim();
  const props = [];
  for (const line of fmText.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (key && !key.startsWith('#')) {
        props.push({ key, value: val });
      }
    }
  }
  return props;
}

function getDocStats(content) {
  if (!content) return { lines: 0, words: 0, chars: 0 };
  const lines = content.split('\n').length;
  const words = (content.match(/\S+/g) || []).length;
  const chars = content.length;
  return { lines, words, chars };
}

function formatDate(value) {
  if (!value) return 'No commit yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function shortSha(value) {
  return value ? String(value).slice(0, 7) : '—';
}

function TreeView({ nodes, activeDoc, collapsed, toggleFolder, onSelect, onNewInFolder, onRename, onDelete, readOnly = false }) {
  return html`<div>
    ${nodes.map(node =>
      node.type === 'folder'
        ? html`<div key=${node.path}>
            <div class="tree-folder">
              <${Button}
                className="tree-node-trigger"
                onClick=${() => toggleFolder(node.path)}
              >
                <span style="font-size:10px;opacity:0.7">${collapsed[node.path] ? '▸' : '▾'}</span>
                <span>📁</span>
                <span class="tree-label">${node.name}</span>
              </${Button}>
              ${!readOnly && html`<span class="item-actions">
                <${Button} className="tree-item-action" title="New file in folder" onClick=${() => onNewInFolder(node.path)}>+</${Button}>
              </span>`}
            </div>
            ${!collapsed[node.path] &&
            html`<div class="tree-group">
              <${TreeView}
                nodes=${node.children}
                activeDoc=${activeDoc}
                collapsed=${collapsed}
                toggleFolder=${toggleFolder}
                onSelect=${onSelect}
                onNewInFolder=${onNewInFolder}
                onRename=${onRename}
                onDelete=${onDelete}
                readOnly=${readOnly}
              />
            </div>`}
          </div>`
        : html`<div key=${node.path} class=${'tree-file' + (activeDoc === node.path ? ' selected' : '')}>
            <${Button}
              className="tree-node-trigger"
              onClick=${() => onSelect(node.path)}
            >
              <span>📄</span>
              <span class="tree-label">${node.name}</span>
            </${Button}>
            ${!readOnly && html`<span class="item-actions">
              <${Button} className="tree-item-action" title="Rename / Move" onClick=${() => onRename(node.path)}>✎</${Button}>
              <${Button} className="tree-item-action danger" title="Delete" onClick=${() => onDelete(node.path)}>✕</${Button}>
            </span>`}
          </div>`
    )}
  </div>`;
}

function App() {
  const [projectsList, setProjectsList] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [docsList, setDocsList] = useState([]);
  const [sourceDocs, setSourceDocs] = useState([]);
  const [sourceDocPath, setSourceDocPath] = useState(null);
  const [sourceDocContent, setSourceDocContent] = useState('');
  const [sourceDocsLoading, setSourceDocsLoading] = useState(false);
  const [docSource, setDocSource] = useState('atlas');
  const [workspaceProjects, setWorkspaceProjects] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [activeDoc, setActiveDoc] = useState(null);
  const [content, setContent] = useState('');
  const [etag, setEtag] = useState(null);
  const [isNewDoc, setIsNewDoc] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('split');
  const [collapsed, setCollapsed] = useState({});
  const [notice, setNotice] = useState('Local-first · Documents stored outside imported repositories');
  const [conflict, setConflict] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importKey, setImportKey] = useState('');
  const [importError, setImportError] = useState('');
  const [pickingDir, setPickingDir] = useState(false);
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [browseDirData, setBrowseDirData] = useState(null);
  const [browseDirLoading, setBrowseDirLoading] = useState(false);
  const [backlinks, setBacklinks] = useState([]);
  const [activeModule, setActiveModule] = useState('portfolio'); // 'portfolio' | 'project' | 'documents' | 'tasks' | 'activity'
  const [taskSubView, setTaskSubView] = useState('board'); // 'board' | 'list' | 'roadmap'
  const [docFilter, setDocFilter] = useState('');
  const [backlinksOpen, setBacklinksOpen] = useState(true);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [relinkModalOpen, setRelinkModalOpen] = useState(false);
  const [relinkPath, setRelinkPath] = useState('');
  const [relinkError, setRelinkError] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [workspaceView, setWorkspaceView] = useState('documents'); // 'documents' | 'kanban' | 'roadmap'
  const [tasks, setTasks] = useState([]);
  const [taskFilterStatus, setTaskFilterStatus] = useState('');
  const [taskFilterPriority, setTaskFilterPriority] = useState('');
  const [taskFilterEpic, setTaskFilterEpic] = useState('');
  const [taskFilterMilestone, setTaskFilterMilestone] = useState('');
  const [rollupData, setRollupData] = useState({ milestones: [], epics: [], brokenReferences: [] });
  const [cancelledCollapsed, setCancelledCollapsed] = useState(true);
  const [newTaskModalOpen, setNewTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskEpic, setNewTaskEpic] = useState('');
  const [newTaskMilestone, setNewTaskMilestone] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionTaskId, setSessionTaskId] = useState('');
  const [sessionResumeNote, setSessionResumeNote] = useState('');
  const [sessionNextAction, setSessionNextAction] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [codexMessages, setCodexMessages] = useState([]);
  const [codexThreadId, setCodexThreadId] = useState('');
  const [codexLoading, setCodexLoading] = useState(false);
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexDraft, setCodexDraft] = useState('');
  const [codexError, setCodexError] = useState('');
  const [codexActivity, setCodexActivity] = useState('');
  const [codexApproval, setCodexApproval] = useState(null);
  const [codexTaskScope, setCodexTaskScope] = useState('');
  const [profileData, setProfileData] = useState(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileStatusInput, setProfileStatusInput] = useState('active');
  const [profileGoalsInput, setProfileGoalsInput] = useState('');
  const [profileKeyDocsInput, setProfileKeyDocsInput] = useState('');
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [decisionSummary, setDecisionSummary] = useState('');
  const [decisionRationale, setDecisionRationale] = useState('');
  const [decisionLinks, setDecisionLinks] = useState('');
  const [recapDraft, setRecapDraft] = useState(null);
  const [recapModalOpen, setRecapModalOpen] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [proposals, setProposals] = useState([]);
  const [impactModalOpen, setImpactModalOpen] = useState(false);
  const [impactTargetTask, setImpactTargetTask] = useState(null);
  const [impactPriority, setImpactPriority] = useState('medium');
  const [impactStatus, setImpactStatus] = useState('todo');
  const [impactEpic, setImpactEpic] = useState('');
  const [impactMilestone, setImpactMilestone] = useState('');
  const [impactDependsOn, setImpactDependsOn] = useState('');
  const [impactPreview, setImpactPreview] = useState(null);
  const [impactError, setImpactError] = useState('');
  const [portfolioSummary, setPortfolioSummary] = useState(null);
  const [docTemplates, setDocTemplates] = useState([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('prd');
  const [templatePathInput, setTemplatePathInput] = useState('specs/PRD.md');
  const [templateTitleInput, setTemplateTitleInput] = useState('');
  const [templateDocIdInput, setTemplateDocIdInput] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [taskTraceability, setTaskTraceability] = useState({});
  const [projectHealth, setProjectHealth] = useState(null);
  const codexEventSourceRef = useRef(null);
  const codexRequestTokenRef = useRef(0);
  const codexTranscriptRef = useRef(null);

  const canDiscard = useCallback(() => !dirty || window.confirm('Discard unsaved changes?'), [dirty]);

  const loadProjects = useCallback(async () => {
    const r = await fetch('/api/projects');
    const items = await r.json();
    setProjectsList(items);
    return items;
  }, []);

  const loadPortfolioSummary = useCallback(async () => {
    try {
      const r = await fetch('/api/portfolio/summary');
      if (r.ok) {
        const data = await r.json();
        setPortfolioSummary(data);
        return data;
      }
    } catch {
      // ignore
    }
    return null;
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const r = await fetch('/api/templates');
      if (r.ok) {
        const items = await r.json();
        setDocTemplates(items);
        return items;
      }
    } catch {
      // ignore
    }
    return [];
  }, []);

  const loadTraceability = useCallback(async projId => {
    if (!projId) return {};
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/traceability`);
      if (r.ok) {
        const data = await r.json();
        setTaskTraceability(data);
        return data;
      }
    } catch {
      // ignore
    }
    return {};
  }, []);

  const loadProjectHealth = useCallback(async projId => {
    if (!projId) return null;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/health`);
      if (r.ok) {
        const data = await r.json();
        setProjectHealth(data);
        return data;
      }
    } catch {
      // ignore
    }
    return null;
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const [r] = await Promise.all([
        fetch('/api/overview'),
        loadPortfolioSummary(),
        loadTemplates(),
      ]);
      if (!r.ok) throw new Error('Unable to load workspace overview');
      const items = await r.json();
      setWorkspaceProjects(items);
      return items;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to load workspace overview');
      return [];
    } finally {
      setOverviewLoading(false);
    }
  }, [loadPortfolioSummary, loadTemplates]);

  const loadDocs = useCallback(async projId => {
    if (!projId) return [];
    const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/docs`);
    if (!r.ok) return [];
    const items = await r.json();
    setDocsList(items);
    return items;
  }, []);

  const loadSourceDocs = useCallback(async projId => {
    if (!projId) return [];
    setSourceDocsLoading(true);
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/source-docs`);
      if (!r.ok) return [];
      const items = await r.json();
      setSourceDocs(items);
      return items;
    } catch {
      setSourceDocs([]);
      return [];
    } finally {
      setSourceDocsLoading(false);
    }
  }, []);

  const openSourceDocument = useCallback(async (proj, docPath) => {
    const r = await fetch(`/api/projects/${encodeURIComponent(proj.id)}/source-docs/${encPath(docPath)}`);
    if (!r.ok) {
      setNotice(`Unable to read ${docPath}`);
      return;
    }
    setSourceDocPath(r.headers.get('x-document-path') || docPath);
    setSourceDocContent(await r.text());
    setDocSource('repo');
  }, []);

  const loadTasks = useCallback(async projId => {
    if (!projId) return [];
    const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/tasks`);
    if (!r.ok) return [];
    const items = await r.json();
    setTasks(items);
    return items;
  }, []);

  const loadSessions = useCallback(async projId => {
    if (!projId) return [];
    const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/sessions`);
    if (!r.ok) return [];
    const items = await r.json();
    setSessions(items);
    return items;
  }, []);

  const loadProfile = useCallback(async projId => {
    if (!projId) return null;
    const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/profile`);
    if (!r.ok) return null;
    const data = await r.json();
    setProfileData(data);
    return data;
  }, []);

  const loadProposals = useCallback(async projId => {
    if (!projId) return [];
    const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/proposals?status=pending`);
    if (!r.ok) return [];
    const items = await r.json();
    setProposals(items);
    return items;
  }, []);

  const openCodexEventStream = useCallback((projectId, threadId, after = 0) => {
    codexEventSourceRef.current?.close();
    const source = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/codex-chat/${encodeURIComponent(threadId)}/events?after=${encodeURIComponent(after)}`);
    codexEventSourceRef.current = source;
    source.addEventListener('codex', rawEvent => {
      let event;
      try { event = JSON.parse(rawEvent.data); } catch { return; }
      const data = event?.data || {};
      switch (event?.type) {
        case 'assistant-delta': {
          const id = String(data.itemId || data.item?.id || `assistant-${Date.now()}`);
          const delta = String(data.delta || '');
          if (!delta) break;
          setCodexMessages(items => {
            const index = items.findIndex(item => item.id === id);
            if (index < 0) return [...items, { id, role: 'assistant', text: delta }];
            return items.map((item, itemIndex) => itemIndex === index ? { ...item, text: item.text + delta } : item);
          });
          break;
        }
        case 'turn-started':
          setCodexBusy(true);
          setCodexError('');
          break;
        case 'turn-completed':
          setCodexBusy(false);
          setCodexActivity('');
          setCodexApproval(null);
          if (data.status === 'failed' || data.status === 'interrupted') setCodexError(data.error?.message || `Codex turn ${data.status}`);
          break;
        case 'item-started': {
          const item = data;
          setCodexActivity(item.type === 'commandExecution' ? `Running: ${item.command || 'command'}` : item.type === 'fileChange' ? 'Preparing a file change' : item.type === 'reasoning' ? 'Thinking…' : 'Working…');
          break;
        }
        case 'item-completed':
          if (data.type === 'agentMessage' && typeof data.text === 'string') {
            const id = String(data.id || `assistant-${Date.now()}`);
            setCodexMessages(items => {
              const index = items.findIndex(item => item.id === id);
              if (index < 0) return [...items, { id, role: 'assistant', text: data.text }];
              return items.map((item, itemIndex) => itemIndex === index ? { ...item, text: data.text } : item);
            });
          }
          setCodexActivity('');
          break;
        case 'approval-request':
          setCodexApproval(data);
          setCodexActivity('Waiting for your approval');
          break;
        case 'error':
          setCodexError(String(data.message || 'Codex chat encountered an error'));
          setCodexBusy(false);
          break;
        case 'unsupported-request':
          setCodexError(`This Codex action is not supported in the web chat yet (${data.method || 'unknown request'}).`);
          break;
        default:
          break;
      }
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setCodexError('The Codex chat connection closed. Reopen this project chat to reconnect.');
    };
  }, []);

  useEffect(() => {
    const closeStream = () => {
      codexEventSourceRef.current?.close();
      codexEventSourceRef.current = null;
    };
    if (activeModule !== 'codex' || !activeProject) {
      codexRequestTokenRef.current++;
      closeStream();
      setCodexLoading(false);
      return;
    }
    let cancelled = false;
    const token = ++codexRequestTokenRef.current;
    const projectId = activeProject.id;
    const storageKey = `localatlas:codex-thread:${projectId}`;
    setCodexMessages([]);
    setCodexThreadId('');
    setCodexBusy(false);
    setCodexDraft('');
    setCodexError('');
    setCodexActivity('');
    setCodexApproval(null);
    closeStream();
    let savedThreadId = '';
    try { savedThreadId = localStorage.getItem(storageKey) || ''; } catch { /* Browser storage may be disabled. */ }
    if (!savedThreadId) {
      setCodexLoading(false);
      return () => { cancelled = true; };
    }
    setCodexThreadId(savedThreadId);
    setCodexLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/codex-chat/resume`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: savedThreadId }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Unable to reopen this Codex chat');
        if (cancelled || token !== codexRequestTokenRef.current) return;
        setCodexThreadId(body.threadId);
        setCodexMessages(Array.isArray(body.messages) ? body.messages : []);
        setCodexBusy(Boolean(body.busy));
        openCodexEventStream(projectId, body.threadId, Number(body.eventSeq) || 0);
      } catch (error) {
        if (!cancelled && token === codexRequestTokenRef.current) setCodexError(error instanceof Error ? error.message : 'Unable to reopen this Codex chat');
      } finally {
        if (!cancelled && token === codexRequestTokenRef.current) setCodexLoading(false);
      }
    })();
    return () => { cancelled = true; closeStream(); };
  }, [activeModule, activeProject?.id, openCodexEventStream]);

  useEffect(() => {
    const transcript = codexTranscriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [codexMessages, codexActivity, codexApproval]);

  const startCodexConversation = async (overrideTaskId) => {
    if (!activeProject) return;
    if (codexThreadId && !window.confirm('Start a new Codex chat for this project? The existing transcript remains in Codex history.')) return;
    const projectId = activeProject.id;
    const chosenTaskId = typeof overrideTaskId === 'string' ? overrideTaskId : codexTaskScope;
    const token = ++codexRequestTokenRef.current;
    setCodexLoading(true);
    setCodexError('');
    setCodexMessages([]);
    setCodexBusy(false);
    setCodexApproval(null);
    codexEventSourceRef.current?.close();
    codexEventSourceRef.current = null;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/codex-chat/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: chosenTaskId || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to start Codex chat');
      if (token !== codexRequestTokenRef.current) return;
      setCodexThreadId(body.threadId);
      setCodexMessages(Array.isArray(body.messages) ? body.messages : []);
      setCodexBusy(Boolean(body.busy));
      try { localStorage.setItem(`localatlas:codex-thread:${projectId}`, body.threadId); } catch { /* This tab can still use the active chat. */ }
      openCodexEventStream(projectId, body.threadId, Number(body.eventSeq) || 0);
    } catch (error) {
      if (token === codexRequestTokenRef.current) setCodexError(error instanceof Error ? error.message : 'Unable to start Codex chat');
    } finally {
      if (token === codexRequestTokenRef.current) setCodexLoading(false);
    }
  };

  const sendCodexMessage = async () => {
    if (!activeProject || !codexThreadId || codexBusy || !codexDraft.trim()) return;
    const text = codexDraft.trim();
    const messageId = `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setCodexMessages(items => [...items, { id: messageId, role: 'user', text }]);
    setCodexDraft('');
    setCodexBusy(true);
    setCodexError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/codex-chat/${encodeURIComponent(codexThreadId)}/turns`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to send message to Codex');
    } catch (error) {
      setCodexMessages(items => items.filter(item => item.id !== messageId));
      setCodexDraft(text);
      setCodexError(error instanceof Error ? error.message : 'Unable to send message to Codex');
      setCodexBusy(false);
    }
  };

  const respondToCodexApproval = async decision => {
    if (!activeProject || !codexThreadId || !codexApproval) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/codex-chat/${encodeURIComponent(codexApproval.requestId ? codexThreadId : codexThreadId)}/approvals/${encodeURIComponent(codexApproval.requestId)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to respond to approval');
      setCodexApproval(null);
      setCodexActivity(decision === 'decline' || decision === 'cancel' ? 'Approval declined' : 'Approval accepted');
      setCodexError('');
    } catch (error) {
      setCodexError(error instanceof Error ? error.message : 'Unable to respond to approval');
    }
  };

  const loadRollup = useCallback(async projId => {
    if (!projId) return { milestones: [], epics: [], brokenReferences: [] };
    const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/rollup`);
    if (!r.ok) return { milestones: [], epics: [], brokenReferences: [] };
    const data = await r.json();
    setRollupData(data);
    return data;
  }, []);

  const loadBacklinks = useCallback(async (projId, docPath) => {
    if (!projId || !docPath) {
      setBacklinks([]);
      return;
    }
    const r = await fetch(`/api/projects/${encodeURIComponent(projId)}/backlinks/${encPath(docPath)}`);
    if (!r.ok) {
      setBacklinks([]);
      return;
    }
    setBacklinks(await r.json());
  }, []);

  const openDocument = useCallback(async (proj, docPath) => {
    const r = await fetch(`/api/projects/${encodeURIComponent(proj.id)}/docs/${encPath(docPath)}`);
    if (!r.ok) {
      setNotice(`Unable to load ${docPath}`);
      return;
    }
    const resolvedDocPath = r.headers.get('x-document-path') || docPath;
    const text = await r.text();
    setActiveDoc(resolvedDocPath);
    setContent(text);
    setEtag(r.headers.get('etag'));
    setIsNewDoc(false);
    setDirty(false);
    setConflict(null);
    await loadBacklinks(proj.id, resolvedDocPath);
  }, [loadBacklinks]);

  useEffect(() => {
    let mounted = true;
    async function syncFromHash() {
      const items = await loadProjects();
      if (!mounted) return;
      const { projectId, docPath } = parseHashRoute(window.location.hash);
      if (projectId) {
        const found = items.find(p => p.id === projectId || p.key === projectId);
        if (found) {
          setActiveProject(found);
          setActiveModule(docPath ? 'documents' : 'project');
          setDocSource('atlas');
          await loadDocs(found.id);
          await loadSourceDocs(found.id);
          await loadTasks(found.id);
          await loadSessions(found.id);
          await loadRollup(found.id);
          await loadProfile(found.id);
          await loadProposals(found.id);
          await loadTraceability(found.id);
          await loadProjectHealth(found.id);
          if (docPath) await openDocument(found, docPath);
        }
      } else {
        setActiveProject(null);
        setActiveModule('portfolio');
      }
    }
    syncFromHash();
    const onHash = () => syncFromHash();
    window.addEventListener('hashchange', onHash);
    return () => {
      mounted = false;
      window.removeEventListener('hashchange', onHash);
    };
  }, [loadProjects, loadDocs, loadSourceDocs, loadTasks, loadSessions, loadRollup, loadProfile, loadProposals, loadTraceability, loadProjectHealth, openDocument]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Subscribe to SSE live project events
  useEffect(() => {
    if (!activeProject || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/projects/${encodeURIComponent(activeProject.id)}/events`);
    es.onmessage = async e => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'doc_changed' || ev.type === 'reindexed') {
          await loadDocs(activeProject.id);
          await loadTasks(activeProject.id);
          await loadRollup(activeProject.id);
          await loadProfile(activeProject.id);
          await loadProposals(activeProject.id);
          await loadTraceability(activeProject.id);
          await loadProjectHealth(activeProject.id);
          if (activeDoc && (ev.type === 'reindexed' || ev.path === activeDoc)) {
            const currentCleanEtag = (etag || '').replace(/^"|"$/g, '');
            if (ev.etag && ev.etag === currentCleanEtag) return;
            if (dirty) {
              setConflict({
                message: 'File updated on disk while you have unsaved edits.',
                currentEtag: ev.etag || null,
              });
            } else {
              await openDocument(activeProject, activeDoc);
            }
          } else if (activeDoc) {
            await loadBacklinks(activeProject.id, activeDoc);
          }
        }
      } catch {
        // Ignore malformed SSE payload
      }
    };
    return () => es.close();
  }, [activeProject, activeDoc, etag, dirty, loadDocs, loadTasks, loadRollup, loadProfile, loadProposals, loadTraceability, loadProjectHealth, openDocument, loadBacklinks]);

  // Run search when modal is open and query/filters change
  useEffect(() => {
    if (!searchModalOpen) return;
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (searchType) params.set('type', searchType);
    if (searchStatus) params.set('status', searchStatus);
    const searchPath = activeProject
      ? `/api/projects/${encodeURIComponent(activeProject.id)}/search`
      : '/api/search';
    fetch(`${searchPath}?${params.toString()}`)
      .then(r => (r.ok ? r.json() : []))
      .then(items => setSearchResults(items))
      .catch(() => setSearchResults([]));
  }, [searchModalOpen, activeProject, searchQuery, searchType, searchStatus]);

  const saveDocument = useCallback(
    async (forceOverwrite = false) => {
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
        setConflict({ message: body.error || 'Document was modified on disk.', currentEtag: body.currentEtag });
        return;
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: 'Save failed' }));
        setNotice(body.error || 'Save failed');
        return;
      }
      setEtag(r.headers.get('etag'));
      setIsNewDoc(false);
      setDirty(false);
      setConflict(null);
      setNotice(`Saved ${activeDoc}`);
      await loadDocs(activeProject.id);
      await loadProjectHealth(activeProject.id);
      loadOverview();
      await loadBacklinks(activeProject.id, activeDoc);
      setHashRoute(activeProject.id, activeDoc);
    },
    [activeProject, activeDoc, content, etag, isNewDoc, loadDocs, loadProjectHealth, loadBacklinks, loadOverview]
  );

  useEffect(() => {
    const onKeyDown = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDocument(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (activeProject) setSearchModalOpen(v => !v);
      } else if (e.key === 'Escape' && searchModalOpen) {
        setSearchModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveDocument, activeProject, searchModalOpen]);

  const handleSelectProject = async proj => {
    if (!canDiscard()) return;
    setActiveProject(proj);
    setActiveModule('project');
    setDocSource('atlas');
    setSourceDocPath(null);
    setSourceDocContent('');
    setActiveDoc(null);
    setContent('');
    setEtag(null);
    setDirty(false);
    setConflict(null);
    setBacklinks([]);
    await loadDocs(proj.id);
    await loadTasks(proj.id);
    await loadSessions(proj.id);
    await loadRollup(proj.id);
    await loadProfile(proj.id);
    await loadProposals(proj.id);
    await loadTraceability(proj.id);
    await loadProjectHealth(proj.id);
    await loadSourceDocs(proj.id);
    setHashRoute(proj.id, null);
  };

  const handleShowPortfolio = () => {
    if (!canDiscard()) return;
    setActiveProject(null);
    setActiveModule('portfolio');
    setActiveDoc(null);
    setContent('');
    setEtag(null);
    setDirty(false);
    setBacklinks([]);
    setHashRoute(null, null);
  };

  const handleUpdateTaskStatus = async (task, newStatus) => {
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
      await loadTasks(activeProject.id);
      return;
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      window.alert(err.error || 'Failed to update task');
      return;
    }
    await loadTasks(activeProject.id);
    await loadRollup(activeProject.id);
    await loadDocs(activeProject.id);
    await loadTraceability(activeProject.id);
    await loadProjectHealth(activeProject.id);
    loadOverview();
    if (activeDoc === task.path) {
      await openDocument(activeProject, task.path);
    }
  };

  const handleUpdateSessionStatus = async (session, newStatus) => {
    if (!activeProject) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/sessions/${encodeURIComponent(session.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': session.etag },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      setNotice(err.error || 'Unable to update session');
      return;
    }
    await loadSessions(activeProject.id);
    await loadDocs(activeProject.id);
    setNotice(`Session marked ${newStatus}`);
  };

  const handleProfileSave = async e => {
    e.preventDefault();
    if (!activeProject) return;
    const keyDocs = profileKeyDocsInput.split(',').map(s => s.trim()).filter(Boolean);
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: profileStatusInput,
        goals: profileGoalsInput,
        keyDocs,
        ifMatch: profileData?.etag || undefined,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.alert(body.error || 'Unable to save profile');
      return;
    }
    setProfileData(body);
    setProfileModalOpen(false);
    await loadDocs(activeProject.id);
    setNotice('Project profile saved');
  };

  const handleDecisionSave = async e => {
    e.preventDefault();
    if (!activeProject || !decisionSummary.trim()) return;
    const links = decisionLinks.split(',').map(s => s.trim()).filter(Boolean);
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/profile/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: decisionSummary.trim(),
        rationale: decisionRationale.trim(),
        links,
        ifMatch: profileData?.etag || undefined,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.alert(body.error || 'Unable to record decision');
      return;
    }
    setProfileData(body.profile);
    setDecisionModalOpen(false);
    setDecisionSummary('');
    setDecisionRationale('');
    setDecisionLinks('');
    await loadDocs(activeProject.id);
    setNotice(`Recorded decision ${body.decision?.id || ''}`);
  };

  const handleGenerateRecap = async (saveToDisk = false) => {
    if (!activeProject) return;
    setRecapLoading(true);
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/recaps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ save: saveToDisk }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        window.alert(body.error || 'Unable to generate recap');
        return;
      }
      setRecapDraft(body);
      setRecapModalOpen(true);
      if (saveToDisk && body.path) {
        await loadDocs(activeProject.id);
        setNotice(`Saved recap to ${body.path}`);
      }
    } finally {
      setRecapLoading(false);
    }
  };

  const openImpactModalForTask = task => {
    setImpactTargetTask(task);
    setImpactPriority(task.priority || 'medium');
    setImpactStatus(task.status || 'todo');
    setImpactEpic(task.epic || '');
    setImpactMilestone(task.milestone || '');
    setImpactDependsOn('');
    setImpactPreview(null);
    setImpactError('');
    setImpactModalOpen(true);
  };

  const handlePreviewImpact = async e => {
    e.preventDefault();
    if (!activeProject || !impactTargetTask) return;
    setImpactError('');
    const dependsOn = impactDependsOn.trim()
      ? impactDependsOn.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/tasks/${encodeURIComponent(impactTargetTask.id)}/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        priority: impactPriority,
        status: impactStatus,
        epic: impactEpic.trim() || null,
        milestone: impactMilestone.trim() || null,
        dependsOn,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setImpactError(body.error || 'Unable to prepare impact summary');
      return;
    }
    setImpactPreview(body);
    await loadProposals(activeProject.id);
    await loadDocs(activeProject.id);
  };

  const handleConfirmProposal = async proposal => {
    if (!activeProject) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/proposals/${encodeURIComponent(proposal.id)}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, ifMatch: proposal.etag }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.alert(body.error || 'Unable to confirm proposal');
      return;
    }
    setImpactModalOpen(false);
    setImpactPreview(null);
    await loadProposals(activeProject.id);
    await loadTasks(activeProject.id);
    await loadRollup(activeProject.id);
    await loadDocs(activeProject.id);
    loadOverview();
    setNotice(`Confirmed changes for ${proposal.taskId}`);
  };

  const handleRejectProposal = async proposal => {
    if (!activeProject) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/proposals/${encodeURIComponent(proposal.id)}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ifMatch: proposal.etag }),
    });
    if (r.ok) {
      setImpactModalOpen(false);
      setImpactPreview(null);
      await loadProposals(activeProject.id);
      await loadDocs(activeProject.id);
      setNotice(`Rejected proposal for ${proposal.taskId}`);
    }
  };

  const handleCreateTaskSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !newTaskTitle.trim()) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: newTaskTitle.trim(),
        priority: newTaskPriority,
        epic: newTaskEpic.trim() || undefined,
        milestone: newTaskMilestone.trim() || undefined,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      window.alert(err.error || 'Failed to create task');
      return;
    }
    setNewTaskModalOpen(false);
    setNewTaskTitle('');
    setNewTaskPriority('medium');
    setNewTaskEpic('');
    setNewTaskMilestone('');
    await loadTasks(activeProject.id);
    await loadRollup(activeProject.id);
    await loadDocs(activeProject.id);
    loadOverview();
  };

  const handleCreateSessionSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !sessionResumeNote.trim() || !sessionNextAction.trim()) return;
    setSessionError('');
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId: sessionTaskId || null,
        resumeNote: sessionResumeNote.trim(),
        nextAction: sessionNextAction.trim(),
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setSessionError(body.error || 'Unable to create session');
      return;
    }
    setSessionModalOpen(false);
    setSessionTaskId('');
    setSessionResumeNote('');
    setSessionNextAction('');
    await loadSessions(activeProject.id);
    await loadDocs(activeProject.id);
    loadOverview();
  };

  const handleRelinkSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !relinkPath.trim()) return;
    setRelinkError('');
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/relink`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: relinkPath.trim() }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setRelinkError(body.error || 'Unable to relink project');
      return;
    }
    const updated = await r.json();
    setActiveProject(updated);
    setProjectsList(items => items.map(item => item.id === updated.id ? updated : item));
    setRelinkModalOpen(false);
    await loadOverview();
    setNotice('Project path relinked. Atlas documents and tasks were preserved.');
  };

  const handleCopyTaskContext = async task => {
    if (!activeProject) return;
    const params = new URLSearchParams({ task: task.id, format: 'text' });
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/context?${params}`);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setNotice(body.error || 'Unable to load task context');
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
      setNotice(`Copied task context for ${task.id}`);
    } else {
      window.prompt('Copy this task-scoped context:', contextText);
      setNotice(`Task context ready for ${task.id}`);
    }
  };

  const handleSelectDoc = async docPath => {
    if (!activeProject || !canDiscard()) return;
    setDocSource('atlas');
    const expectedHash = `#/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(docPath)}`;
    if (window.location.hash !== expectedHash) {
      setHashRoute(activeProject.id, docPath);
    } else {
      await openDocument(activeProject, docPath);
    }
  };

  const handleSearchResult = async item => {
    const targetProject = projectsList.find(project => project.id === item.projectId);
    if (!targetProject) return;
    if (targetProject.id !== activeProject?.id) await handleSelectProject(targetProject);
    setSearchModalOpen(false);
    setActiveModule('documents');
    await handleSelectDoc(item.path);
  };

  const handleCreateDoc = folderPrefix => {
    if (!activeProject || !canDiscard()) return;
    const promptDefault = folderPrefix ? `${folderPrefix}/` : '';
    const raw = window.prompt('New Markdown path (e.g. spec/PRD.md):', promptDefault);
    if (!raw || !raw.trim()) return;
    const trimmed = raw.trim();
    const name = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    const title = name.split('/').pop().replace(/\.md$/, '');
    setActiveDoc(name);
    setContent(`# ${title}\n`);
    setEtag(null);
    setIsNewDoc(true);
    setDirty(true);
    setConflict(null);
    setBacklinks([]);
  };

  const handleRenameDoc = async fromPath => {
    if (!activeProject) return;
    if (activeDoc === fromPath && !canDiscard()) return;
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
      await loadDocs(activeProject.id);
      if (activeDoc === fromPath) {
        setDirty(false);
        setHashRoute(activeProject.id, toPath);
        await openDocument(activeProject, toPath);
      }
      setNotice(`Moved ${fromPath} -> ${toPath}`);
    };
    await doMove(false);
  };

  const handleDeleteDoc = async docPath => {
    if (!activeProject) return;
    if (activeDoc === docPath && !canDiscard()) return;
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
    await loadDocs(activeProject.id);
    if (activeDoc === docPath) {
      setActiveDoc(null);
      setContent('');
      setEtag(null);
      setDirty(false);
      setBacklinks([]);
      setHashRoute(activeProject.id, null);
    }
    setNotice(`Deleted ${docPath}`);
  };

  const loadBrowseDir = async targetPath => {
    setBrowseDirLoading(true);
    try {
      const q = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
      const r = await fetch(`/api/fs/directories${q}`);
      if (r.ok) {
        const data = await r.json();
        setBrowseDirData(data);
      }
    } catch {
      // ignore
    } finally {
      setBrowseDirLoading(false);
    }
  };

  const selectBrowseDir = dirPath => {
    setImportPath(dirPath);
    if (!importKey) {
      const seg = dirPath.split(/[/\\]/).filter(Boolean).pop() || '';
      const suggested = seg.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
      if (suggested) setImportKey(suggested);
    }
    setShowDirBrowser(false);
  };

  const handlePickFolder = async () => {
    setPickingDir(true);
    setImportError('');
    try {
      const r = await fetch('/api/fs/pick-directory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (r.ok) {
        const data = await r.json();
        if (data.supported && data.path) {
          selectBrowseDir(data.path);
          return;
        } else if (data.supported && data.canceled) {
          return;
        }
      }
      setShowDirBrowser(true);
      await loadBrowseDir(importPath || undefined);
    } catch {
      setShowDirBrowser(true);
      await loadBrowseDir(importPath || undefined);
    } finally {
      setPickingDir(false);
    }
  };

  const toggleDirBrowser = async () => {
    const next = !showDirBrowser;
    setShowDirBrowser(next);
    if (next && !browseDirData) {
      await loadBrowseDir(importPath || undefined);
    }
  };

  const handleImportSubmit = async e => {
    e.preventDefault();
    setImportError('');
    const r = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: importPath, key: importKey || undefined }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setImportError(body.error || 'Import failed');
      return;
    }
    setImportModalOpen(false);
    setShowDirBrowser(false);
    setImportPath('');
    setImportKey('');
    await loadProjects();
    await loadOverview();
    handleSelectProject(body);
  };

  const handlePreviewClick = async e => {
    const link = e.target.closest('a[data-doc-link]');
    if (link && activeProject) {
      e.preventDefault();
      const target = link.getAttribute('data-doc-link');
      if (target) {
        const resolved = resolveRelativeDocLink(activeDoc || '', target);
        if (resolved) handleSelectDoc(resolved);
      }
    }
  };

  const handleToggleTaskCheckbox = useCallback(async (lineIdx, checked) => {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    if (lines[lineIdx] === undefined) return;
    lines[lineIdx] = lines[lineIdx].replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+)/, (_m, a, _state, b) => {
      return `${a}${checked ? 'x' : ' '}${b}`;
    });
    const nextContent = lines.join('\n');
    setContent(nextContent);
    if (activeProject && activeDoc && !isNewDoc && etag && !dirty) {
      const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/docs/${encPath(activeDoc)}`, {
        method: 'PUT',
        headers: { 'if-match': etag },
        body: nextContent,
      });
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        setDirty(true);
        setConflict({ message: body.error || 'Document was modified on disk.', currentEtag: body.currentEtag });
        return;
      }
      if (r.ok) {
        setEtag(r.headers.get('etag'));
        setDirty(false);
        setNotice(`Saved ${activeDoc}`);
        return;
      }
    }
    setDirty(true);
  }, [content, activeProject, activeDoc, isNewDoc, etag, dirty]);

  const docStats = useMemo(() => getDocStats(content), [content]);
  const frontmatterProps = useMemo(() => parseFrontmatterProperties(content), [content]);

  const filteredDocsList = useMemo(() => {
    if (!docFilter.trim()) return docsList;
    const q = docFilter.toLowerCase();
    return docsList.filter(d => d.toLowerCase().includes(q));
  }, [docsList, docFilter]);

  const filteredSourceDocs = useMemo(() => {
    if (!docFilter.trim()) return sourceDocs;
    const q = docFilter.toLowerCase();
    return sourceDocs.filter(doc => doc.path.toLowerCase().includes(q));
  }, [sourceDocs, docFilter]);

  const tree = useMemo(() => buildFileTree(filteredDocsList), [filteredDocsList]);
  const sourceTree = useMemo(() => buildFileTree(filteredSourceDocs.map(doc => doc.path)), [filteredSourceDocs]);
  const selectedProjectSummary = useMemo(
    () => workspaceProjects.find(project => project.id === activeProject?.id) ?? null,
    [workspaceProjects, activeProject]
  );
  const recentWorkspaceCommits = useMemo(() => workspaceProjects
    .flatMap(project => (project.git?.recentCommits ?? []).map(commit => ({ ...commit, projectId: project.id, projectName: project.name, projectKey: project.key, branch: project.git?.branch })))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8), [workspaceProjects]);
  const previewHtml = useMemo(() => ({ __html: renderMarkdownSafe(content) }), [content]);
  const sourcePreviewHtml = useMemo(() => ({ __html: renderMarkdownSafe(sourceDocContent) }), [sourceDocContent]);
  const previewHostRef = useRef(null);

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
          onChange: checked => handleToggleTaskCheckbox(lineIdx, checked),
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
  }, [previewHtml, handleToggleTaskCheckbox]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (taskFilterPriority && t.priority !== taskFilterPriority) return false;
      if (taskFilterStatus && t.status !== taskFilterStatus) return false;
      if (taskSearch) {
        const q = taskSearch.toLowerCase();
        const matchesTitle = t.title?.toLowerCase().includes(q);
        const matchesId = t.id?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesId) return false;
      }
      if (taskFilterEpic && (!t.epic || !t.epic.toLowerCase().includes(taskFilterEpic.toLowerCase()))) return false;
      if (taskFilterMilestone && (!t.milestone || !t.milestone.toLowerCase().includes(taskFilterMilestone.toLowerCase()))) return false;
      return true;
    });
  }, [tasks, taskFilterPriority, taskFilterStatus, taskSearch, taskFilterEpic, taskFilterMilestone]);

  const cancelledTasks = useMemo(() => filteredTasks.filter(t => t.status === 'cancelled'), [filteredTasks]);

  const handleApplyTemplateSubmit = async e => {
    e.preventDefault();
    if (!activeProject || !templatePathInput.trim()) return;
    setTemplateError('');
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/templates/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: selectedTemplateId,
        path: templatePathInput.trim(),
        title: templateTitleInput.trim() || undefined,
        docId: templateDocIdInput.trim() || undefined,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setTemplateError(body.error || 'Unable to create document from template');
      return;
    }
    setTemplateModalOpen(false);
    setTemplateTitleInput('');
    setTemplateDocIdInput('');
    await loadDocs(activeProject.id);
    await loadProjectHealth(activeProject.id);
    setActiveModule('documents');
    await openDocument(activeProject, body.path);
    setNotice(`Created ${body.path} from ${body.template?.name || selectedTemplateId}`);
  };

  const renderKanbanCard = t => {
    const trace = taskTraceability[t.id];
    const hasActiveSession = (trace?.activeSessions?.length || 0) > 0;
    const commitCount = trace?.matchedCommits?.length || 0;
    return html`
      <${Card} key=${t.id} className="kanban-card" variant="secondary">
        <div class="kanban-card-top">
          <span class="issue-key-badge">${t.id}</span>
          <span class=${'priority-pill ' + t.priority}>${t.priority}</span>
        </div>
        <a
          href="#"
          onClick=${e => {
            e.preventDefault();
            handleSelectDoc(t.path);
            setActiveModule('documents');
          }}
          class="kanban-card-title"
          title=${t.path}
        >
          ${t.title}
        </a>
        <div class="kanban-card-meta">
          ${t.checklist?.total > 0
            ? html`<span>☑ ${t.checklist.checked}/${t.checklist.total}</span>`
            : html`<span>${t.epic || ''}</span>`}
          ${t.milestone ? html`<span>${t.milestone}</span>` : html`<span></span>`}
        </div>
        ${(hasActiveSession || commitCount > 0 || trace?.dodWarning) && html`
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0;font-size:11px">
            ${hasActiveSession && html`<span class="badge" title="Active agent session working on this task">⚡ Active session</span>`}
            ${commitCount > 0 && html`<span class="badge" title=${trace.matchedCommits.map(c => `${shortSha(c.sha)} ${c.subject}`).join('\n')}>⑂ ${commitCount} commit${commitCount > 1 ? 's' : ''}</span>`}
            ${trace?.dodWarning && html`<span class="badge" style="color:var(--warning)" title=${trace.dodWarning}>⚠ DoD incomplete</span>`}
          </div>
        `}
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
          <${SelectField}
            className="task-status-select"
            value=${t.status}
            ariaLabel=${`Status for ${t.title}`}
            onChange=${value => handleUpdateTaskStatus(t, value)}
            options=${[
              { value: 'todo', label: 'To Do' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'blocked', label: 'Blocked' },
              { value: 'done', label: 'Done' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <${Button} className="text-link" title="Copy bounded agent prompt & context" onClick=${() => handleCopyTaskContext(t)}>Prompt</${Button}>
        </div>
      </${Card}>
    `;
  };

  return html`
    <div class="app-shell">
      <header class="app-header">
        <div class="header-left">
          <div class="brand">
            <span class="brand-mark">A</span>
            <span>LocalAtlas</span>
          </div>
          <${Button}
            className="project-switcher-btn"
            onClick=${() => setProjectModalOpen(true)}
            title="Switch project or import directory"
          >
            <span class="project-key-tag">${activeProject ? activeProject.key : 'WORKSPACE'}</span>
            <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${activeProject ? activeProject.name : 'All projects'}</span>
            <span style="opacity:0.6;font-size:9px">▾</span>
          </${Button}>
        </div>

        <div class="header-center">
          <nav class="module-switcher" aria-label="Workspace navigation">
            <${Button}
              className=${'module-tab' + (activeModule === 'portfolio' ? ' active' : '')}
              aria-pressed=${activeModule === 'portfolio'}
              onClick=${handleShowPortfolio}
            >All projects</${Button}>
            ${activeProject && html`
              <span class="module-tab-divider" aria-hidden="true"></span>
              <${Button}
                className=${'module-tab' + (activeModule === 'project' ? ' active' : '')}
                aria-pressed=${activeModule === 'project'}
                onClick=${() => setActiveModule('project')}
              >Overview</${Button}>
              <${Button}
                className=${'module-tab' + (activeModule === 'documents' ? ' active' : '')}
                aria-pressed=${activeModule === 'documents'}
                onClick=${async () => {
                  if (!canDiscard()) return;
                  setActiveModule('documents');
                  await loadDocs(activeProject.id);
                  await loadSourceDocs(activeProject.id);
                }}
              >Docs</${Button}>
              <${Button}
                className=${'module-tab' + (activeModule === 'tasks' ? ' active' : '')}
                aria-pressed=${activeModule === 'tasks'}
                onClick=${() => {
                  setActiveModule('tasks');
                  loadTasks(activeProject.id);
                  loadRollup(activeProject.id);
                  loadTraceability(activeProject.id);
                }}
              >Tasks</${Button}>
              <${Button}
                className=${'module-tab' + (activeModule === 'codex' ? ' active' : '')}
                aria-pressed=${activeModule === 'codex'}
                onClick=${() => setActiveModule('codex')}
              >Codex</${Button}>
              <${Button}
                className=${'module-tab' + (activeModule === 'activity' ? ' active' : '')}
                aria-pressed=${activeModule === 'activity'}
                onClick=${() => { setActiveModule('activity'); loadOverview(); }}
              >Git activity</${Button}>
            `}
          </nav>
        </div>

        <div class="header-right">
          <${Button} className="header-refresh" onClick=${loadOverview} isDisabled=${overviewLoading} aria-label="Refresh workspace data">
            ${overviewLoading ? 'Refreshing…' : '↻ Refresh'}
          </${Button}>
          <${Button} class="header-search" onClick=${() => setSearchModalOpen(true)}>
            ⌕ Search <kbd>⌘ K</kbd>
          </${Button}>
          <small class="header-notice">${notice}</small>
        </div>
      </header>

      <main>
        <aside>
          ${['portfolio', 'project', 'activity'].includes(activeModule) && html`
            <div class="portfolio-sidebar">
              <div class="sidebar-section-heading">
                <span>Workspace</span>
              </div>
              <${Button}
                className=${'sidebar-workspace-link' + (activeModule === 'portfolio' ? ' active' : '')}
                onClick=${handleShowPortfolio}
              >
                <span class="sidebar-nav-icon">▦</span><span>All projects</span><span class="sidebar-count">${projectsList.length}</span>
              </${Button}>
              <div class="sidebar-project-heading">
                <span>Projects</span>
                <${Button} className="sidebar-add-project" aria-label="Import project" onClick=${() => { setImportError(''); setImportModalOpen(true); }}>+</${Button}>
              </div>
              <div class="sidebar-project-list">
                ${projectsList.map(project => html`
                  <${Button}
                    key=${project.id}
                    className=${'sidebar-project-link' + (activeProject?.id === project.id ? ' selected' : '')}
                    onClick=${() => handleSelectProject(project)}
                  >
                    <span class="project-avatar">${project.key.slice(0, 1)}</span>
                    <span class="sidebar-project-name">${project.name}</span>
                    ${activeProject?.id === project.id && html`<span class="sidebar-current-dot"></span>`}
                  </${Button}>
                `)}
                ${projectsList.length === 0 && html`<small class="sidebar-empty">Your imported projects will appear here.</small>`}
              </div>
              <${Button} className="sidebar-import-button" onClick=${() => { setImportError(''); setImportModalOpen(true); }}>+ Import a project</${Button}>
              <div class="sidebar-local-note"><span class="local-dot"></span>Local workspace · source repos stay untouched</div>
            </div>
          `}

          ${activeModule === 'documents' && html`
            <div class="obsidian-vault-header">
              <div class="obsidian-vault-title">${docSource === 'atlas' ? 'Atlas docs' : 'Repository docs'}</div>
              <div class="obsidian-vault-actions">
                ${docSource === 'atlas' && html`<${Button} onClick=${() => handleCreateDoc('')} isDisabled=${!activeProject} title="New Markdown document">+ New</${Button}>`}
              </div>
            </div>
            <div class="doc-source-switch" role="tablist" aria-label="Document source">
              <${Button} className=${docSource === 'atlas' ? 'active' : ''} onClick=${async () => { setDocSource('atlas'); await loadDocs(activeProject?.id); }}>Atlas docs <span>${docsList.length}</span></${Button}>
              <${Button} className=${docSource === 'repo' ? 'active' : ''} onClick=${async () => { setDocSource('repo'); await loadSourceDocs(activeProject?.id); }}>Repo docs <span>${sourceDocs.length}</span></${Button}>
            </div>
            ${docSource === 'atlas' ? html`
              <div class="doc-source-note" style="display:flex;justify-content:space-between;align-items:center;gap:6px">
                <span>Markdown kept in LocalAtlas, separate from your source repository.</span>
                <${Button} className="text-link" onClick=${() => { setTemplateError(''); setTemplateModalOpen(true); }} isDisabled=${!activeProject} title="Create from Role Template (PRD, ADR, Bug, Release)">+ Template</${Button}>
              </div>
              <${TextInput}
                className="obsidian-filter-input"
                aria-label="Filter Atlas documents"
                placeholder="Find a document…"
                value=${docFilter}
                onInput=${e => setDocFilter(e.target.value)}
              />
              <div class="tree-view">
                <${TreeView}
                  nodes=${tree}
                  activeDoc=${activeDoc}
                  collapsed=${collapsed}
                  toggleFolder=${path => setCollapsed(c => ({ ...c, [path]: !c[path] }))}
                  onSelect=${handleSelectDoc}
                  onNewInFolder=${handleCreateDoc}
                  onRename=${handleRenameDoc}
                  onDelete=${handleDeleteDoc}
                />
                ${filteredDocsList.length === 0 && html`<small class="tree-empty">No Atlas docs yet. Create a note to start.</small>`}
              </div>
            ` : html`
              <div class="doc-source-note">Read-only Markdown files from the imported repository.</div>
              <${TextInput}
                className="obsidian-filter-input"
                aria-label="Filter repository documents"
                placeholder="Find a repository file…"
                value=${docFilter}
                onInput=${e => setDocFilter(e.target.value)}
              />
              <div class="tree-view">
                ${sourceDocsLoading && html`<small class="tree-empty">Scanning Markdown files…</small>`}
                <${TreeView}
                  nodes=${sourceTree}
                  activeDoc=${sourceDocPath}
                  collapsed=${collapsed}
                  toggleFolder=${path => setCollapsed(c => ({ ...c, [path]: !c[path] }))}
                  onSelect=${path => openSourceDocument(activeProject, path)}
                  onNewInFolder=${() => {}}
                  onRename=${() => {}}
                  onDelete=${() => {}}
                  readOnly
                />
                ${!sourceDocsLoading && filteredSourceDocs.length === 0 && html`<small class="tree-empty">${sourceDocs.length ? 'No repository files match this filter.' : 'No Markdown files found in this repository.'}</small>`}
              </div>
            `}
            ${docSource === 'atlas' && activeDoc && html`
              <div class="obsidian-backlinks-pane">
                <${Button} className="backlinks-header" onClick=${() => setBacklinksOpen(o => !o)}>
                  <span>Linked mentions (${backlinks.length})</span>
                  <span style="font-size:10px">${backlinksOpen ? '▾' : '▸'}</span>
                </${Button}>
                ${backlinksOpen && html`
                  <div class="backlinks-list">
                    ${backlinks.length === 0
                      ? html`<small class="muted" style="padding:4px 6px">No backlinks found</small>`
                      : backlinks.map(b => html`
                        <${Button}
                          key=${b.sourcePath}
                          className="backlink-item"
                          onClick=${() => handleSelectDoc(b.sourcePath)}
                          title=${b.sourcePath}
                        >
                          <span>↩</span><span>${b.sourceId ? `[${b.sourceId}] ` : ''}${b.sourceTitle || b.sourcePath}</span>
                        </${Button}>
                      `)}
                  </div>
                `}
              </div>
            `}
          `}

          ${activeModule === 'tasks' && html`
            <div class="task-sidebar-top">
              <${Button}
                className="button--primary task-new-button"
                onClick=${() => setNewTaskModalOpen(true)}
                disabled=${!activeProject}
              >+ New task</${Button}>
            </div>
            <div class="linear-sidebar-section">
              <div class="section-heading" style="padding:0 6px"><h3>Views</h3></div>
              <${Button} className=${'linear-nav-item' + (taskSubView === 'board' ? ' active' : '')} onClick=${() => setTaskSubView('board')}><span>▦</span><span>Board (Kanban)</span><span class="linear-filter-badge">${tasks.length}</span></${Button}>
              <${Button} className=${'linear-nav-item' + (taskSubView === 'list' ? ' active' : '')} onClick=${() => setTaskSubView('list')}><span>☰</span><span>All tasks</span><span class="linear-filter-badge">${tasks.length}</span></${Button}>
              <${Button} className=${'linear-nav-item' + (taskSubView === 'roadmap' ? ' active' : '')} onClick=${() => { setTaskSubView('roadmap'); if (activeProject) loadRollup(activeProject.id); }}><span>◈</span><span>Roadmap</span></${Button}>
            </div>
            <hr />
            <div class="linear-sidebar-section">
              <div class="section-heading" style="padding:0 6px"><h3>Priority</h3></div>
              ${[
                { id: '', label: 'All priorities' },
                { id: 'critical', label: 'Critical' },
                { id: 'high', label: 'High' },
                { id: 'medium', label: 'Medium' },
                { id: 'low', label: 'Low' },
              ].map(p => html`
                <${Button} key=${p.id} className=${'linear-nav-item' + (taskFilterPriority === p.id ? ' active' : '')} onClick=${() => setTaskFilterPriority(p.id)}>
                  <span>${p.id ? '•' : '○'}</span><span>${p.label}</span><span class="linear-filter-badge">${p.id ? tasks.filter(t => t.priority === p.id).length : tasks.length}</span>
                </${Button}>
              `)}
            </div>
            <hr />
            <div class="linear-sidebar-section">
              <div class="section-heading" style="padding:0 6px"><h3>Status</h3></div>
              ${[
                { id: '', label: 'All statuses' },
                { id: 'todo', label: 'To do' },
                { id: 'in_progress', label: 'In progress' },
                { id: 'blocked', label: 'Blocked' },
                { id: 'done', label: 'Done' },
                { id: 'cancelled', label: 'Cancelled' },
              ].map(s => html`
                <${Button} key=${s.id} className=${'linear-nav-item' + (taskFilterStatus === s.id ? ' active' : '')} onClick=${() => setTaskFilterStatus(s.id)}>
                  <span>${s.id ? '•' : '○'}</span><span>${s.label}</span><span class="linear-filter-badge">${s.id ? tasks.filter(t => t.status === s.id).length : tasks.length}</span>
                </${Button}>
              `)}
            </div>
          `}
        </aside>

        <section class="workspace">
          ${activeModule === 'portfolio' && html`
            <div class="portfolio-scroll">
              <div class="portfolio-intro">
                <div>
                  <div class="eyebrow">LOCAL WORKSPACE</div>
                  <h1>Your projects, in one place.</h1>
                  <p>See project work, documentation, governance proposals, and Git activity without changing your source repositories.</p>
                </div>
                <${Button} className="button--primary import-hero-button" onClick=${() => { setImportError(''); setImportModalOpen(true); }}>+ Import project</${Button}>
              </div>
              <div class="portfolio-metrics">
                <${Card} className="metric-card"><span class="metric-label">Projects</span><strong>${projectsList.length}</strong><small>local repositories</small></${Card}>
                <${Card} className="metric-card"><span class="metric-label">Open tasks</span><strong>${workspaceProjects.reduce((sum, p) => sum + p.tasks.open, 0)}</strong><small>${workspaceProjects.reduce((sum, p) => sum + p.tasks.blocked, 0)} blocked · ${portfolioSummary?.totals?.criticalOpenTasks ?? 0} critical</small></${Card}>
                <${Card} className="metric-card"><span class="metric-label">Governance & Sessions</span><strong>${portfolioSummary?.totals?.pendingProposals ?? 0}</strong><small>pending proposals · ${portfolioSummary?.totals?.activeSessions ?? 0} active sessions</small></${Card}>
                <${Card} className="metric-card"><span class="metric-label">Repositories with changes</span><strong>${workspaceProjects.filter(p => (p.git?.dirtyCount ?? 0) > 0).length}</strong><small>Git working trees</small></${Card}>
              </div>
              <div class="portfolio-content-grid">
                <div class="project-portfolio-column">
                  <div class="content-section-heading"><div><h2>Projects</h2><p>Choose a project to open its docs, tasks, and activity.</p></div><span class="count-pill">${projectsList.length}</span></div>
                  ${overviewLoading && workspaceProjects.length === 0 && html`<div class="loading-panel">Loading your local projects…</div>`}
                  ${projectsList.length === 0 && !overviewLoading && html`
                    <${Card} className="portfolio-empty">
                      <div class="empty-illustration">⌂</div><h2>Bring your projects together</h2>
                      <p>Import a local folder to see its documentation, tasks, and recent Git activity here.</p>
                      <${Button} className="button--primary" onClick=${() => { setImportError(''); setImportModalOpen(true); }}>Import your first project</${Button}>
                    </${Card}>
                  `}
                  <div class="project-card-grid">
                    ${workspaceProjects.map(project => {
                      const pHealth = portfolioSummary?.projects?.find(item => item.project.id === project.id);
                      return html`
                        <${Card} key=${project.id} className="portfolio-project-card">
                          <${Button} className="project-card-button" onClick=${() => {
                            const fullProject = projectsList.find(item => item.id === project.id);
                            if (fullProject) handleSelectProject(fullProject);
                          }}>
                            <div class="project-card-heading">
                              <span class="project-avatar large">${project.key.slice(0, 1)}</span>
                              <div class="project-card-title"><div><span class="project-key-tag">${project.key}</span><span class="project-branch">${project.git?.branch || 'No Git'}</span>${pHealth?.profile?.status && html`<span class="badge" style="margin-left:6px">${pHealth.profile.status}</span>`}</div><h3>${project.name}</h3></div>
                              <span class="project-open-arrow">↗</span>
                            </div>
                            ${pHealth?.profile?.goals && html`<div class="project-source-path" style="opacity:0.9">${pHealth.profile.goals}</div>`}
                            <div class="project-source-path" title=${project.sourcePath}>${project.sourcePath}</div>
                            <div class="project-card-stats">
                              <span><strong>${project.tasks.open}</strong> open</span>
                              <span><strong>${project.tasks.blocked}</strong> blocked</span>
                              ${(pHealth?.pendingProposalsCount ?? 0) > 0 && html`<span style="color:var(--warning)"><strong>${pHealth.pendingProposalsCount}</strong> proposals</span>`}
                              ${(pHealth?.activeSessionsCount ?? 0) > 0 && html`<span><strong>⚡ ${pHealth.activeSessionsCount}</strong> session</span>`}
                              <span><strong>${project.docs.count}</strong> docs</span>
                              <span class=${project.git?.dirtyCount ? 'working-tree dirty' : 'working-tree'}><i></i>${project.git?.dirtyCount ? `${project.git.dirtyCount} changed` : 'Clean'}</span>
                            </div>
                            <div class="project-card-commit">
                              <span class="commit-dot"></span>
                              ${project.git?.head ? html`<span class="commit-subject">${project.git.head.subject}</span><span class="commit-sha">${shortSha(project.git.head.sha)}</span>` : html`<span class="commit-subject">No commits yet</span>`}
                            </div>
                          </${Button}>
                        </${Card}>
                      `;
                    })}
                  </div>
                </div>
                <div class="portfolio-activity-panel">
                  <div class="content-section-heading"><div><h2>Recent Git activity</h2><p>Latest commits across your projects.</p></div></div>
                  ${recentWorkspaceCommits.length === 0 && html`<div class="activity-empty">No Git commits found yet.</div>`}
                  <div class="activity-list">
                    ${recentWorkspaceCommits.map(commit => html`
                      <div key=${`${commit.projectId}-${commit.sha}`} class="activity-item">
                        <span class="activity-rail-dot"></span>
                        <div class="activity-item-body">
                          <div class="activity-project-label"><span>${commit.projectKey}</span><small>${commit.projectName}</small></div>
                          <strong>${commit.subject}</strong>
                          <div class="activity-meta"><span>${commit.author}</span><span>${formatDate(commit.timestamp)}</span><code>${shortSha(commit.sha)}</code></div>
                        </div>
                      </div>
                    `)}
                  </div>
                  <div class="read-only-hint">Git history is shown read-only. LocalAtlas never runs Git mutations.</div>
                </div>
              </div>
            </div>
          `}

          ${activeModule === 'project' && activeProject && html`
            <div class="project-overview-scroll">
              <div class="project-overview-hero">
                <div class="project-avatar jumbo">${activeProject.key.slice(0, 1)}</div>
                <div class="project-overview-title"><div class="eyebrow">PROJECT WORKSPACE · ${activeProject.key}</div><h1>${activeProject.name}</h1><p title=${activeProject.sourcePath}>${activeProject.sourcePath}</p></div>
                <div class="project-overview-actions">
                  <${Button} onClick=${() => { setRelinkPath(activeProject.sourcePath); setRelinkError(''); setRelinkModalOpen(true); }}>Relink path</${Button}>
                  <${Button} onClick=${() => handleGenerateRecap(false)} isDisabled=${recapLoading}>${recapLoading ? 'Drafting recap…' : 'Draft recap'}</${Button}>
                  <${Button} onClick=${() => { setTemplateError(''); setTemplateModalOpen(true); }}>+ Template doc</${Button}>
                  <${Button} onClick=${() => setActiveModule('documents')}>Open docs</${Button}>
                  <${Button} className="button--primary" onClick=${() => { setActiveModule('tasks'); loadTasks(activeProject.id); }}>Open tasks</${Button}>
                  <${Button} onClick=${() => setActiveModule('codex')}>Chat with Codex</${Button}>
                </div>
              </div>
              <div class="project-health-row">
                <${Card} className="project-health-card"><span class="health-icon blue">↗</span><div><small>Open tasks</small><strong>${selectedProjectSummary?.tasks.open ?? tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length}</strong></div><span class="health-footnote">${selectedProjectSummary?.tasks.inProgress ?? tasks.filter(t => t.status === 'in_progress').length} in progress</span></${Card}>
                <${Card} className=${'project-health-card' + ((selectedProjectSummary?.tasks.blocked ?? 0) ? ' warning' : '')}><span class="health-icon orange">!</span><div><small>Blocked</small><strong>${selectedProjectSummary?.tasks.blocked ?? tasks.filter(t => t.status === 'blocked').length}</strong></div><span class="health-footnote">tasks needing attention</span></${Card}>
                <${Card} className="project-health-card"><span class="health-icon violet">▤</span><div><small>Atlas docs</small><strong>${selectedProjectSummary?.docs.count ?? docsList.length}</strong></div><span class="health-footnote">${sourceDocs.length} repo docs read-only</span></${Card}>
                <${Card} className="project-health-card"><span class="health-icon green">⑂</span><div><small>Git branch</small><strong class="branch-value">${selectedProjectSummary?.git?.branch || 'Not a Git repo'}</strong></div><span class="health-footnote">${selectedProjectSummary?.git?.dirtyCount ? `${selectedProjectSummary.git.dirtyCount} working changes` : 'Working tree clean'}</span></${Card}>
              </div>
              <div class="project-overview-grid">
                <div class="project-overview-main">
                  <div class="dashboard-panel">
                    <div class="content-section-heading">
                      <div>
                        <h2>Project profile & decisions</h2>
                        <p>Managed Markdown goals, status (${profileData?.status || 'active'}), key documents, and append-only approved decisions.</p>
                      </div>
                      <div class="btn-group">
                        <${Button} className="text-link" onClick=${() => {
                          setProfileStatusInput(profileData?.status || 'active');
                          setProfileGoalsInput(profileData?.goals || '');
                          setProfileKeyDocsInput((profileData?.keyDocs || []).join(', '));
                          setProfileModalOpen(true);
                        }}>Edit profile</${Button}>
                        <${Button} className="text-link" onClick=${() => {
                          setDecisionSummary('');
                          setDecisionRationale('');
                          setDecisionLinks('');
                          setDecisionModalOpen(true);
                        }}>+ Record decision</${Button}>
                      </div>
                    </div>
                    ${profileData?.goals ? html`<p style="margin:4px 0 8px">${profileData.goals}</p>` : html`<div class="panel-empty compact">No project goals recorded yet. Click "Edit profile" to set goals and key documents.</div>`}
                    ${(profileData?.keyDocs ?? []).length > 0 && html`
                      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
                        ${profileData.keyDocs.map(doc => html`<${Button} key=${doc} className="overview-doc-link" onClick=${() => { setActiveModule('documents'); handleSelectDoc(doc); }}>★ ${doc}</${Button}>`)}
                      </div>
                    `}
                    ${(profileData?.decisions ?? []).length > 0 && html`
                      <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
                        <small class="doc-source-label">APPROVED DECISIONS (${profileData.decisions.length})</small>
                        ${profileData.decisions.slice(-4).map(dec => html`
                          <div key=${dec.id} class="overview-session-row">
                            <div><strong>[${dec.id}] ${dec.summary}</strong><small>${dec.date}${dec.rationale ? ` · ${dec.rationale}` : ''}</small></div>
                          </div>
                        `)}
                      </div>
                    `}
                  </div>
                  ${proposals.length > 0 && html`
                    <div class="dashboard-panel">
                      <div class="content-section-heading">
                        <div><h2>Pending change proposals (${proposals.length})</h2><p>Review impact summaries and confirm before applying scope, priority, or dependency changes.</p></div>
                      </div>
                      ${proposals.map(prop => html`
                        <div key=${prop.id} class="overview-session-row">
                          <div>
                            <strong>Task ${prop.taskId}</strong>
                            <small>${(prop.impact?.changedFields || []).map(f => `${f.field}: ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`).join(' · ')}</small>
                            ${(prop.impact?.warnings || []).length > 0 && html`<small style="color:var(--warning);display:block">⚠ ${prop.impact.warnings.join('; ')}</small>`}
                          </div>
                          <div class="btn-group">
                            <${Button} className="button--primary" onClick=${() => handleConfirmProposal(prop)}>Confirm & apply</${Button}>
                            <${Button} onClick=${() => handleRejectProposal(prop)}>Reject</${Button}>
                          </div>
                        </div>
                      `)}
                    </div>
                  `}
                  <div class="dashboard-panel">
                    <div class="content-section-heading"><div><h2>Work in progress</h2><p>Highest priority open tasks in this project.</p></div><${Button} className="text-link" onClick=${() => setActiveModule('tasks')}>View all →</${Button}></div>
                    ${(selectedProjectSummary?.tasks.active ?? []).length === 0 && html`<div class="panel-empty">No open tasks yet. Add a task to track work here.</div>`}
                    ${(selectedProjectSummary?.tasks.active ?? []).map(task => {
                      const trace = taskTraceability[task.id];
                      return html`
                        <div key=${task.id} class="overview-task-row">
                          <span class=${'priority-mark ' + task.priority}></span>
                          <span class="issue-key-badge">${task.id}</span>
                          <strong>${task.title}</strong>
                          ${(trace?.activeSessions?.length || 0) > 0 && html`<span class="badge" title="Active agent session">⚡ Active</span>`}
                          ${(trace?.matchedCommits?.length || 0) > 0 && html`<span class="badge" title="Linked Git commits">⑂ ${trace.matchedCommits.length}</span>`}
                          <span class=${'task-status-pill ' + task.status}>${task.status.replace('_', ' ')}</span>
                          <div class="btn-group">
                            <${Button} className="text-link" onClick=${() => openImpactModalForTask(task)}>Propose change</${Button}>
                            <${Button} className="text-link" onClick=${() => handleCopyTaskContext(task)}>Copy context</${Button}>
                          </div>
                        </div>
                      `;
                    })}
                  </div>
                  ${projectHealth && html`
                    <div class="dashboard-panel">
                      <div class="content-section-heading">
                        <div>
                          <h2>Workspace & knowledge health (Score: ${projectHealth.score}/100)</h2>
                          <p>Checks for broken wiki-links, orphan documents, bottleneck dependencies, and incomplete DoD checklists.</p>
                        </div>
                        <${Button} className="text-link" onClick=${() => loadProjectHealth(activeProject.id)}>Re-check</${Button}>
                      </div>
                      ${projectHealth.brokenLinks.length === 0 && projectHealth.dodIssues.length === 0 && projectHealth.bottleneckTasks.length === 0 && projectHealth.orphanDocs.length === 0 && html`
                        <div class="panel-empty compact">✓ All wiki-links resolved, task DoD checklists verified, and no orphan docs found.</div>
                      `}
                      ${projectHealth.brokenLinks.map((bl, idx) => html`
                        <div key=${`bl-${idx}`} class="overview-session-row">
                          <div><strong>⚠ Broken link in ${bl.sourcePath}</strong><small>Unresolved target: <code>[[${bl.targetRef}]]</code></small></div>
                          <${Button} className="text-link" onClick=${() => { setActiveModule('documents'); handleSelectDoc(bl.sourcePath); }}>Fix doc</${Button}>
                        </div>
                      `)}
                      ${projectHealth.dodIssues.map(issue => html`
                        <div key=${issue.taskId} class="overview-session-row">
                          <div><strong>⚠ DoD Checklist incomplete: [${issue.taskId}] ${issue.title}</strong><small>Marked done with ${issue.uncheckedCount} of ${issue.totalCount} checklist items unchecked</small></div>
                          <${Button} className="text-link" onClick=${() => { setActiveModule('documents'); handleSelectDoc(issue.path); }}>Open task</${Button}>
                        </div>
                      `)}
                      ${projectHealth.bottleneckTasks.map(bn => html`
                        <div key=${bn.taskId} class="overview-session-row">
                          <div><strong>🚧 Bottleneck task: [${bn.taskId}] ${bn.title} (${bn.status})</strong><small>Blocking ${bn.blockingTaskIds.length} downstream task(s): ${bn.blockingTaskIds.join(', ')}</small></div>
                        </div>
                      `)}
                      ${projectHealth.orphanDocs.slice(0, 4).map(orp => html`
                        <div key=${orp.path} class="overview-session-row">
                          <div><strong>Unlinked note: ${orp.title}</strong><small>${orp.path} (no backlinks or keyDoc reference)</small></div>
                          <${Button} className="text-link" onClick=${() => { setActiveModule('documents'); handleSelectDoc(orp.path); }}>Open</${Button}>
                        </div>
                      `)}
                    </div>
                  `}
                  <div class="dashboard-panel">
                    <div class="content-section-heading"><div><h2>Agent sessions</h2><p>Project-scoped resume notes stored with Atlas documents.</p></div><${Button} className="text-link" onClick=${() => { setSessionError(''); setSessionTaskId(''); setSessionModalOpen(true); }}>+ New session</${Button}></div>
                    ${sessions.length === 0 && html`<div class="panel-empty">No sessions yet. Start one to save a resume note and next action.</div>`}
                    ${sessions.slice(0, 5).map(session => html`
                      <div key=${session.id} class="overview-session-row">
                        <div><${Button} className="overview-doc-link" onClick=${() => { setActiveModule('documents'); handleSelectDoc(session.path); }}><strong>${session.title}</strong></${Button}><small>${session.taskId ? `Task ${session.taskId}` : 'Project session'} · ${session.status}${session.branch ? ` · ${session.branch}` : ''}</small></div>
                        <div style="display:flex;align-items:center;gap:6px">
                          <span>${session.nextAction}</span>
                          ${session.status !== 'paused' && session.status !== 'completed' && html`<${Button} className="text-link" onClick=${() => handleUpdateSessionStatus(session, 'paused')}>Pause</${Button}>`}
                          ${session.status !== 'completed' && html`<${Button} className="text-link" onClick=${() => handleUpdateSessionStatus(session, 'completed')}>Done</${Button}>`}
                        </div>
                      </div>
                    `)}
                  </div>
                  <div class="dashboard-panel">
                    <div class="content-section-heading"><div><h2>Documentation</h2><p>Atlas notes plus Markdown from the imported repository.</p></div><${Button} className="text-link" onClick=${() => setActiveModule('documents')}>Open docs →</${Button}></div>
                    <div class="overview-doc-columns">
                      <div><span class="doc-source-label">ATLAS DOCS · EDITABLE</span>
                        ${(selectedProjectSummary?.docs.paths ?? []).length === 0 && html`<div class="panel-empty compact">No Atlas docs yet.</div>`}
                        ${(selectedProjectSummary?.docs.paths ?? []).slice(0, 4).map(doc => html`<${Button} key=${doc} className="overview-doc-link" onClick=${() => { setActiveModule('documents'); handleSelectDoc(doc); }}>▤ ${doc}</${Button}>`)}
                      </div>
                      <div><span class="doc-source-label">REPOSITORY · READ ONLY</span>
                        ${sourceDocs.length === 0 && html`<div class="panel-empty compact">${sourceDocsLoading ? 'Scanning repository…' : 'No Markdown files found.'}</div>`}
                        ${sourceDocs.slice(0, 4).map(doc => html`<${Button} key=${doc.path} className="overview-doc-link" onClick=${async () => { setActiveModule('documents'); await openSourceDocument(activeProject, doc.path); }}>▤ ${doc.path}</${Button}>`)}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="dashboard-panel project-git-panel">
                  <div class="content-section-heading"><div><h2>Recent commits</h2><p>${selectedProjectSummary?.git?.branch || 'Git history'} · read-only</p></div><${Button} className="text-link" onClick=${() => setActiveModule('activity')}>Full activity →</${Button}></div>
                  ${(selectedProjectSummary?.git?.recentCommits ?? []).length === 0 && html`<div class="panel-empty">No Git history available for this project.</div>`}
                  ${(selectedProjectSummary?.git?.recentCommits ?? []).map(commit => html`
                    <div key=${commit.sha} class="project-commit-row"><span class="activity-rail-dot"></span><div><strong>${commit.subject}</strong><div class="activity-meta"><span>${commit.author}</span><span>${formatDate(commit.timestamp)}</span></div></div><code>${shortSha(commit.sha)}</code></div>
                  `)}
                  <div class="read-only-hint">LocalAtlas reads the branch, working tree status, and recent commit history. It does not create commits or modify Git state.</div>
                </div>
              </div>
            </div>
          `}

          ${activeModule === 'activity' && activeProject && html`
            <div class="activity-page">
              <div class="page-heading"><div class="eyebrow">${activeProject.key} · PROJECT ACTIVITY</div><h1>Git activity</h1><p>Recent commit history for <strong>${activeProject.name}</strong>, shown read-only.</p></div>
              <${Card} className="git-state-card"><div class="git-state-branch"><span class="health-icon green">⑂</span><div><small>Current branch</small><strong>${selectedProjectSummary?.git?.branch || 'Not a Git repository'}</strong></div></div><div class="git-state-dirty"><span class=${selectedProjectSummary?.git?.dirtyCount ? 'status-dot dirty' : 'status-dot'}></span><span>${selectedProjectSummary?.git?.dirtyCount ? `${selectedProjectSummary.git.dirtyCount} changed files` : 'Working tree clean'}</span></div></${Card}>
              <div class="git-history-panel"><div class="content-section-heading"><div><h2>Recent commits</h2><p>Latest 5 commits from the local Git history.</p></div></div>
                ${(selectedProjectSummary?.git?.recentCommits ?? []).length === 0 && html`<div class="panel-empty">No commits found. This repository may not have a Git history yet.</div>`}
                ${(selectedProjectSummary?.git?.recentCommits ?? []).map((commit, index) => html`
                  <div key=${commit.sha} class="git-history-row"><span class="git-history-marker">${index === 0 ? '●' : '○'}</span><div class="git-history-copy"><strong>${commit.subject}</strong><div class="activity-meta"><span>${commit.author}</span><span>${formatDate(commit.timestamp)}</span></div></div><code>${shortSha(commit.sha)}</code></div>
                `)}
              </div>
            </div>
          `}

          ${activeModule === 'codex' && activeProject && html`
            <div class="codex-page">
              <div class="codex-heading">
                <div class="page-heading compact-heading"><div class="eyebrow">${activeProject.key} · PROJECT CHAT</div><h1>Chat with Codex</h1><p>Ask about this project, plan work, or make changes with Codex.</p></div>
                <div style="display:flex;gap:8px;align-items:center">
                  <${SelectField}
                    value=${codexTaskScope}
                    ariaLabel="Chat context scope"
                    onChange=${setCodexTaskScope}
                    options=${[
                      { value: '', label: 'Project-wide context' },
                      ...tasks.map(t => ({ value: t.id, label: `Task ${t.id} · ${t.title}` })),
                    ]}
                  />
                  ${codexThreadId && html`<${Button} onClick=${() => startCodexConversation()} isDisabled=${codexLoading}>New chat</${Button}>`}
                </div>
              </div>
              <div class="codex-local-notice"><span class="local-dot"></span><span>Runs the Codex CLI installed on this machine using your local account and settings. This is a separate Codex conversation; it does not load this ChatGPT chat. Codex may read or change this repository according to its configured permissions. Chat and approvals are available only through localhost.</span></div>
              ${codexError && html`<div class="banner banner-danger codex-error" role="alert"><span>${codexError}</span>${codexThreadId && html`<${Button} onClick=${() => startCodexConversation()} isDisabled=${codexLoading}>Start a new chat</${Button}>`}</div>`}
              ${!codexThreadId ? html`
                <${Card} className="codex-start-card">
                  <div class="codex-start-mark">✳</div>
                  <div><h2>${codexLoading ? 'Connecting to Codex…' : 'Start a project chat'}</h2><p>LocalAtlas gives Codex a short context for <strong>${activeProject.name}</strong>${codexTaskScope ? ` scoped to task ${codexTaskScope}` : ''}. The conversation stays in your Codex history and is linked to this project in this browser.</p></div>
                  <${Button} className="button--primary" onClick=${() => startCodexConversation()} isDisabled=${codexLoading}>${codexLoading ? 'Connecting…' : 'Start chatting'}</${Button}>
                </${Card}>
              ` : html`
                <${Card} className="codex-chat-card">
                  <div class="codex-chat-meta"><span><i class="status-dot"></i> Connected to local Codex</span><code title=${codexThreadId}>${codexThreadId.slice(0, 8)}</code></div>
                  <div class="codex-transcript" ref=${codexTranscriptRef} aria-live="polite" aria-label="Codex conversation">
                    ${codexMessages.length === 0 && !codexLoading && html`<div class="codex-empty"><strong>What would you like to work on?</strong><span>Codex has the selected project folder and a bounded LocalAtlas context.</span></div>`}
                    ${codexMessages.map(message => html`
                      <div key=${message.id} class=${'codex-message ' + message.role}>
                        <div class="codex-message-label">${message.role === 'assistant' ? 'Codex' : 'You'}</div>
                        <div class="codex-message-text">${message.text}</div>
                      </div>
                    `)}
                    ${codexActivity && html`<div class="codex-activity"><span class="codex-activity-dot"></span>${codexActivity}</div>`}
                  </div>
                  ${codexApproval && html`
                    <div class="codex-approval" role="group" aria-label="Codex approval request">
                      <div><strong>${codexApproval.kind === 'file-change' ? 'Codex requests permission to change files' : 'Codex requests permission to run a command'}</strong><p>${codexApproval.reason || 'Review this action before allowing Codex to continue.'}</p>${codexApproval.command && html`<pre>${codexApproval.command}</pre>`}<small>Working directory: ${codexApproval.cwd}</small></div>
                      <div class="codex-approval-actions"><${Button} onClick=${() => respondToCodexApproval('decline')}>Decline</${Button}><${Button} className="button--primary" onClick=${() => respondToCodexApproval('accept')}>Allow once</${Button}></div>
                    </div>
                  `}
                  <div class="codex-composer">
                    <${TextArea}
                      aria-label="Message Codex"
                      placeholder="Ask Codex about this project…"
                      value=${codexDraft}
                      rows="3"
                      onInput=${event => setCodexDraft(event.target.value)}
                      onKeyDown=${event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); sendCodexMessage(); } }}
                      disabled=${codexBusy || codexLoading}
                    ></${TextArea}>
                    <div class="codex-composer-footer"><small>⌘ Enter to send · Codex follows your local approval and sandbox settings</small><${Button} className="button--primary" onClick=${sendCodexMessage} isDisabled=${codexBusy || codexLoading || !codexDraft.trim()}>${codexBusy ? 'Codex is working…' : 'Send'}</${Button}></div>
                  </div>
                </${Card}>
              `}
            </div>
          `}

          ${activeModule === 'documents' && html`
            <div class="obsidian-editor-bar">
              <div class="obsidian-breadcrumb" title=${docSource === 'atlas' ? activeDoc || '' : sourceDocPath || ''}>
                <span class="folder-name">${activeProject ? activeProject.name : 'Workspace'}</span><span>/</span>
                <span>${docSource === 'atlas' ? activeDoc || 'Select an Atlas document' : sourceDocPath || 'Select a repository document'}</span>
                ${dirty && html`<span class="dirty-dot" title="Unsaved changes">●</span>`}
              </div>
              ${docSource === 'atlas' ? html`<div class="document-toolbar-actions">
                <div class="obsidian-mode-tabs">
                  <${Button} className=${'obsidian-mode-tab' + (mode === 'edit' ? ' active' : '')} onClick=${() => setMode('edit')}>Edit</${Button}>
                  <${Button} className=${'obsidian-mode-tab' + (mode === 'split' ? ' active' : '')} onClick=${() => setMode('split')}>Split</${Button}>
                  <${Button} className=${'obsidian-mode-tab' + (mode === 'preview' ? ' active' : '')} onClick=${() => setMode('preview')}>Preview</${Button}>
                </div>
                <${Button} className="button--primary" onClick=${() => saveDocument(false)} disabled=${!activeProject || !activeDoc}>Save changes</${Button}>
              </div>` : html`<span class="read-only-badge">◉ Read only</span>`}
            </div>
            ${docSource === 'repo' && html`<div class="repo-read-only-banner"><span>Repository file · read-only</span><small>This file stays in the imported project. Create or edit a separate Atlas doc from the Docs source switch.</small></div>`}

            ${docSource === 'atlas' && frontmatterProps.length > 0 && html`
              <div class="obsidian-properties-bar">
                ${frontmatterProps.map(p => html`<span key=${p.key} class="property-chip"><span class="property-key">${p.key}:</span><span class="property-value">${p.value}</span></span>`)}
              </div>
            `}

            ${docSource === 'atlas' && conflict && html`
              <div class="banner banner-danger">
                <span>⚠️ Conflict: ${conflict.message}</span>
                <div class="btn-group">
                  <${Button} onClick=${() => openDocument(activeProject, activeDoc)}>Reload disk version</${Button}>
                  <${Button} className="danger" onClick=${() => saveDocument(true)}>Force overwrite</${Button}>
                </div>
              </div>
            `}

            ${docSource === 'atlas' ? html`
              <div class=${'workspace-panes ' + (mode === 'split' ? 'split' : 'single')}>
                ${(mode === 'edit' || mode === 'split') && html`<${TextArea} class="editor" value=${content} disabled=${!activeDoc} placeholder="Select or create a Markdown document" spellcheck="false" onInput=${e => { setContent(e.target.value); setDirty(true); }}></${TextArea}>`}
                ${(mode === 'preview' || mode === 'split') && html`<div ref=${previewHostRef} class="preview-pane" onClick=${handlePreviewClick} dangerouslySetInnerHTML=${previewHtml}></div>`}
              </div>
              <div class="obsidian-status-bar"><div>${docStats.lines} lines · ${docStats.words} words · ${docStats.chars} characters</div><div>${activeDoc ? (dirty ? '● Unsaved changes' : 'Saved') : 'No file'} · UTF-8</div></div>
            ` : html`
              ${sourceDocPath ? html`<div class="repo-doc-meta"><span>📄 ${sourceDocPath}</span><span>${sourceDocs.find(item => item.path === sourceDocPath)?.sizeBytes ?? 0} bytes</span></div>` : html`<div class="repo-doc-empty">Choose a Markdown file from the repository tree.</div>`}
              ${sourceDocPath && html`<div class="workspace-panes single"><div class="preview-pane repo-preview" dangerouslySetInnerHTML=${sourcePreviewHtml}></div></div>`}
            `}
          `}

          ${activeModule === 'tasks' && activeProject && html`
            <div class="linear-toolbar task-page-toolbar">
              <div class="page-heading compact-heading"><div class="eyebrow">${activeProject.key} · PROJECT WORK</div><h1>Tasks</h1><p>Track planned, active, blocked, and completed work.</p></div>
              <div class="task-toolbar-controls">
                <${TextInput} aria-label="Filter title or ID" placeholder="Filter tasks…" value=${taskSearch} onInput=${e => setTaskSearch(e.target.value)} />
                <${Button} className="button--primary" onClick=${() => setNewTaskModalOpen(true)}>+ New task</${Button}>
              </div>
            </div>

            ${taskSubView === 'board' && html`
              <div class="kanban-board">
                ${[
                  { status: 'todo', label: 'To do' },
                  { status: 'in_progress', label: 'In progress' },
                  { status: 'blocked', label: 'Blocked' },
                  { status: 'done', label: 'Done' },
                ].map(column => {
                  const columnTasks = filteredTasks.filter(task => task.status === column.status);
                  return html`<div key=${column.status} class="kanban-column"><div class="kanban-column-header"><span>${column.label}</span><span class="linear-filter-badge">${columnTasks.length}</span></div><div class="kanban-column-cards">${columnTasks.map(task => renderKanbanCard(task))}</div></div>`;
                })}
              </div>
            `}

            ${taskSubView === 'list' && html`
              <div class="task-list-panel">
                <div class="task-list-header"><span>Priority</span><span>Key</span><span>Task</span><span>Status</span><span>Epic / milestone</span></div>
                ${filteredTasks.length === 0 && html`<div class="panel-empty">No tasks match the current filters.</div>`}
                ${filteredTasks.map(task => html`
                  <div key=${task.id} class="task-list-row">
                    <span class=${'priority-pill ' + task.priority}>${task.priority}</span>
                    <span class="issue-key-badge">${task.id}</span>
                    <${Button} className="task-list-title" onClick=${() => { setActiveModule('documents'); handleSelectDoc(task.path); }}>${task.title}</${Button}>
                    <${SelectField} className="task-status-select" value=${task.status} ariaLabel=${`Status for ${task.title}`} onChange=${value => handleUpdateTaskStatus(task, value)} options=${[
                      { value: 'todo', label: 'To do' }, { value: 'in_progress', label: 'In progress' }, { value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' },
                    ]} />
                    <span class="task-list-meta">${task.epic || task.milestone || '—'}</span>
                  </div>
                `)}
              </div>
            `}

            ${taskSubView === 'roadmap' && html`
              <div class="roadmap-container">
                ${rollupData.brokenReferences?.length > 0 && html`<div class="banner banner-danger"><strong>Broken references (${rollupData.brokenReferences.length})</strong><div class="broken-reference-list">${rollupData.brokenReferences.map(item => html`<div key=${item.taskId || item.path}>${item.title} · missing ${item.missingEpic || item.missingMilestone}</div>`)}</div></div>`}
                <div><div class="content-section-heading"><div><h2>Milestones</h2><p>Progress based on linked Markdown tasks.</p></div></div><div class="roadmap-list">
                  ${(rollupData.milestones || []).map(milestone => html`<${Card} key=${milestone.id} className="roadmap-card"><div class="roadmap-heading"><strong>${milestone.title}</strong><span class="badge">${milestone.status}</span></div><div class="roadmap-meta">${milestone.counts.done} of ${milestone.counts.total - milestone.counts.cancelled} tasks complete · ${(milestone.counts.completionRatio * 100).toFixed(0)}%</div><div class="progress-bar"><div class="progress-fill" style=${`width:${(milestone.counts.completionRatio * 100).toFixed(1)}%`}></div></div></${Card}>`)}
                </div></div>
                <div><div class="content-section-heading"><div><h2>Epics</h2><p>Grouped work across this project.</p></div></div><div class="roadmap-list">
                  ${(rollupData.epics || []).map(epic => html`<${Card} key=${epic.id} className="roadmap-card"><div class="roadmap-heading"><strong>${epic.title}</strong><span class="badge">${epic.status}</span></div><div class="roadmap-meta">${epic.counts.done} of ${epic.counts.total - epic.counts.cancelled} tasks complete · ${(epic.counts.completionRatio * 100).toFixed(0)}%</div><div class="progress-bar"><div class="progress-fill" style=${`width:${(epic.counts.completionRatio * 100).toFixed(1)}%`}></div></div></${Card}>`)}
                </div></div>
                ${(rollupData.milestones || []).length === 0 && (rollupData.epics || []).length === 0 && html`<div class="panel-empty">No milestones or epics yet. Add frontmatter to Atlas task documents to organize the roadmap.</div>`}
              </div>
            `}
          `}
        </section>
      </main>


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
                          handleSelectProject(p);
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
                        setImportError('');
                        setShowDirBrowser(false);
                        setImportModalOpen(true);
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
                    <${Button} type="button" onClick=${() => { setImportModalOpen(false); setShowDirBrowser(false); }}>Cancel</${Button}>
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
                    <${TextInput}
                      aria-label="Proposed dependencies"
                      placeholder="DependsOn task IDs, comma-separated (e.g. SAV-001, SAV-002)"
                      value=${impactDependsOn}
                      onInput=${e => setImpactDependsOn(e.target.value)}
                    />
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
                      <${Button} type="button" onClick=${() => handleRejectProposal(impactPreview)}>Reject</${Button}>
                      <${Button} type="button" className="button--primary" onClick=${() => handleConfirmProposal(impactPreview)}>Confirm & apply change</${Button}>
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
                  <${Button} type="button" className="button--primary" onClick=${() => handleGenerateRecap(true)} isDisabled=${recapLoading}>Save recap as Atlas doc</${Button}>
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

if (typeof document !== 'undefined') {
  const root = document.getElementById('app');
  if (root) createRoot(root).render(html`<${App} />`);
}
