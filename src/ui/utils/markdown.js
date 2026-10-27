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

export function escapeHtml(str) {
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

if (typeof window !== 'undefined') {
  window.__resolveRelativeDocLink = resolveRelativeDocLink;
}

export function sanitizeHref(rawHref) {
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

export function renderInline(line) {
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

export const encPath = s => s.split('/').map(encodeURIComponent).join('/');

export function parseHashRoute(hash) {
  const clean = (hash || '').replace(/^#\/?/, '').replace(/\/$/, '');
  const m = /^projects\/([^/]+)(?:\/(docs(?:\/.+)?|tasks|activity))?$/.exec(clean);
  if (!m) return { projectId: null, docPath: null, module: 'portfolio' };

  try {
    const projectId = decodeURIComponent(m[1]);
    const suffix = m[2] || '';
    if (suffix === 'tasks' || suffix === 'activity') return { projectId, docPath: null, module: suffix };
    if (suffix === 'docs') return { projectId, docPath: null, module: 'documents' };
    if (suffix.startsWith('docs/')) {
      const docPath = suffix.slice(5).split('/').map(decodeURIComponent).join('/');
      return docPath ? { projectId, docPath, module: 'documents' } : { projectId, docPath: null, module: 'documents' };
    }
    return { projectId, docPath: null, module: 'project' };
  } catch {
    return { projectId: null, docPath: null, module: 'portfolio' };
  }
}

export function setHashRoute(projectId, docPath, module = 'project') {
  if (!projectId) {
    window.location.hash = '';
    return;
  }
  const base = `#/projects/${encodeURIComponent(projectId)}`;
  if (docPath) {
    window.location.hash = `${base}/docs/${encPath(docPath)}`;
    return;
  }
  window.location.hash = module === 'documents'
    ? `${base}/docs`
    : ['tasks', 'activity'].includes(module) ? `${base}/${module}` : base;
}

export function parseFrontmatterProperties(markdown) {
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

export function getDocStats(content) {
  if (!content) return { lines: 0, words: 0, chars: 0 };
  const lines = content.split('\n').length;
  const words = (content.match(/\S+/g) || []).length;
  const chars = content.length;
  return { lines, words, chars };
}

export function formatDate(value) {
  if (!value) return 'No commit yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function shortSha(value) {
  return value ? String(value).slice(0, 7) : '—';
}
