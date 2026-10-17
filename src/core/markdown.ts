import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { ParsedDocument, FileTreeNode, ChecklistCounts } from './types.js';

export function computeEtag(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return String(JSON.parse(trimmed));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

export function formatYamlScalar(val: string): string {
  if (val === '' || /[:#[\]{}&*!|>'"%@`\r\n]/.test(val) || /^\s|\s$/.test(val)) {
    return JSON.stringify(val);
  }
  return val;
}

export function parseDocument(raw: string): ParsedDocument & { keyOrder?: string[]; lineEnding?: '\n' | '\r\n' } {
  const clean = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const lineEnding: '\n' | '\r\n' = clean.includes('\r\n') ? '\r\n' : '\n';

  if (!/^---[ \t]*\r?\n/.test(clean)) {
    return {
      frontmatter: Object.create(null) as Record<string, string | string[]>,
      keyOrder: [],
      body: clean,
      hasFrontmatter: false,
      malformedFrontmatter: false,
      lineEnding,
    };
  }

  const lines = clean.split(/\r?\n/);
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) {
      closingIdx = i;
      break;
    }
  }

  if (closingIdx === -1) {
    return {
      frontmatter: Object.create(null) as Record<string, string | string[]>,
      keyOrder: [],
      body: clean,
      hasFrontmatter: false,
      malformedFrontmatter: true,
      parseWarning: 'Unclosed YAML frontmatter fence',
      lineEnding,
    };
  }

  const fm: Record<string, string | string[]> = Object.create(null);
  const keyOrder: string[] = [];
  let currentListKey: string | null = null;

  for (let i = 1; i < closingIdx; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const listMatch = /^\s+-\s+(.*)$/.exec(line);
    if (listMatch) {
      if (!currentListKey) {
        return {
          frontmatter: Object.create(null) as Record<string, string | string[]>,
          keyOrder: [],
          body: clean,
          hasFrontmatter: false,
          malformedFrontmatter: true,
          parseWarning: `Unexpected YAML list item at line ${i + 1}`,
          lineEnding,
        };
      }
      const arr = fm[currentListKey];
      if (Array.isArray(arr)) {
        arr.push(unquoteYamlScalar(listMatch[1]));
      }
      continue;
    }

    const kvMatch = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!kvMatch) {
      return {
        frontmatter: Object.create(null) as Record<string, string | string[]>,
        keyOrder: [],
        body: clean,
        hasFrontmatter: false,
        malformedFrontmatter: true,
        parseWarning: `Invalid YAML frontmatter syntax at line ${i + 1}`,
        lineEnding,
      };
    }

    const key = kvMatch[1];
    if (FORBIDDEN_KEYS.has(key)) {
      return {
        frontmatter: Object.create(null) as Record<string, string | string[]>,
        keyOrder: [],
        body: clean,
        hasFrontmatter: false,
        malformedFrontmatter: true,
        parseWarning: `Forbidden YAML frontmatter key "${key}"`,
        lineEnding,
      };
    }
    if (Object.prototype.hasOwnProperty.call(fm, key)) {
      return {
        frontmatter: Object.create(null) as Record<string, string | string[]>,
        keyOrder: [],
        body: clean,
        hasFrontmatter: false,
        malformedFrontmatter: true,
        parseWarning: `Duplicate YAML frontmatter key "${key}"`,
        lineEnding,
      };
    }

    const rawVal = (kvMatch[2] ?? '').trim();
    keyOrder.push(key);
    if (!rawVal) {
      let hasNextListItem = false;
      for (let j = i + 1; j < closingIdx; j++) {
        if (!lines[j].trim() || /^\s*#/.test(lines[j])) continue;
        hasNextListItem = /^\s+-\s+/.test(lines[j]);
        break;
      }
      if (hasNextListItem) {
        fm[key] = [];
        currentListKey = key;
      } else {
        fm[key] = '';
        currentListKey = null;
      }
    } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      const inner = rawVal.slice(1, -1).trim();
      fm[key] = inner ? inner.split(',').map(s => unquoteYamlScalar(s)) : [];
      currentListKey = null;
    } else {
      fm[key] = unquoteYamlScalar(rawVal);
      currentListKey = null;
    }
  }

  if (closingIdx > 1 && keyOrder.length === 0) {
    return {
      frontmatter: Object.create(null) as Record<string, string | string[]>,
      keyOrder: [],
      body: clean,
      hasFrontmatter: false,
      malformedFrontmatter: false,
      lineEnding,
    };
  }

  let pos = 0;
  for (let i = 0; i <= closingIdx; i++) {
    const nextNl = clean.indexOf('\n', pos);
    if (nextNl === -1) {
      pos = clean.length;
      break;
    }
    pos = nextNl + 1;
  }
  const body = clean.slice(pos);

  return {
    frontmatter: fm,
    keyOrder,
    body,
    hasFrontmatter: true,
    malformedFrontmatter: false,
    lineEnding,
  };
}

export function serializeDocument(
  frontmatter: Record<string, string | string[]>,
  keyOrder: string[],
  body: string,
  lineEnding: '\n' | '\r\n' = '\n'
): string {
  const keys = [...keyOrder];
  for (const k of Object.keys(frontmatter)) {
    if (!keys.includes(k)) keys.push(k);
  }
  const activeKeys = keys.filter(k => Object.prototype.hasOwnProperty.call(frontmatter, k));
  if (activeKeys.length === 0) return body;

  const fmLines: string[] = ['---'];
  for (const k of activeKeys) {
    const val = frontmatter[k];
    if (Array.isArray(val)) {
      if (val.length === 0) {
        fmLines.push(`${k}: []`);
      } else {
        fmLines.push(`${k}:`);
        for (const item of val) {
          fmLines.push(`  - ${formatYamlScalar(String(item))}`);
        }
      }
    } else {
      fmLines.push(`${k}: ${formatYamlScalar(String(val ?? ''))}`);
    }
  }
  fmLines.push('---');
  return fmLines.join(lineEnding) + lineEnding + body;
}

export function deriveDocTitle(path: string, parsed: ParsedDocument): string {
  if (typeof parsed.frontmatter.title === 'string' && parsed.frontmatter.title.trim()) {
    return parsed.frontmatter.title.trim();
  }
  const lines = parsed.body.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#\s+(.+)$/.exec(line.trim());
    if (m) return m[1].trim();
  }
  return basename(path, '.md');
}

export function extractOutboundLinks(
  sourcePath: string,
  markdownBody: string
): Array<{ targetRef: string; targetKind: 'id' | 'path' }> {
  const lines = markdownBody.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  const seen = new Set<string>();
  const links: Array<{ targetRef: string; targetKind: 'id' | 'path' }> = [];

  for (const rawLine of lines) {
    if (rawLine.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const withoutCode = rawLine.replace(/`[^`]*`/g, '');

    // 1. Wiki-links [[ID]]
    const wikiRe = /\[\[([A-Za-z0-9_./-]+)\]\]/g;
    let wm: RegExpExecArray | null;
    while ((wm = wikiRe.exec(withoutCode)) !== null) {
      const target = wm[1].trim();
      if (!target) continue;
      if (target.endsWith('.md') || target.includes('/')) {
        const resolved = resolveRelativeDocLink(sourcePath, target);
        if (resolved && !seen.has(`path:${resolved}`)) {
          seen.add(`path:${resolved}`);
          links.push({ targetRef: resolved, targetKind: 'path' });
        }
      } else if (!seen.has(`id:${target}`)) {
        seen.add(`id:${target}`);
        links.push({ targetRef: target, targetKind: 'id' });
      }
    }

    // 2. Standard Markdown links [label](url)
    const mdLinkRe = /\[([^\]]+)\]\(([^\u0000()\s]*(?:\([^\u0000()\s]*\)[^\u0000()\s]*)*)\)/g;
    let mm: RegExpExecArray | null;
    while ((mm = mdLinkRe.exec(withoutCode)) !== null) {
      const url = mm[2].trim();
      if (!url || url.startsWith('#') || url.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
        continue;
      }
      const cleanUrl = url.split('#')[0].split('?')[0];
      if (!cleanUrl.endsWith('.md')) continue;
      const resolved = resolveRelativeDocLink(sourcePath, cleanUrl);
      if (resolved && !seen.has(`path:${resolved}`)) {
        seen.add(`path:${resolved}`);
        links.push({ targetRef: resolved, targetKind: 'path' });
      }
    }
  }

  return links;
}

export function countMarkdownChecklists(markdownOrBody: string): ChecklistCounts {
  const lines = String(markdownOrBody ?? '').replace(/\r\n/g, '\n').split('\n');
  let inCode = false;
  let codeFence = '';
  let total = 0;
  let checked = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      const fenceMarker = trimmed.slice(0, 3);
      if (!inCode) {
        inCode = true;
        codeFence = fenceMarker;
      } else if (trimmed.startsWith(codeFence)) {
        inCode = false;
        codeFence = '';
      }
      continue;
    }
    if (inCode) continue;

    const match = /^([-*]|\d+\.)\s+\[([ xX])\]/.exec(trimmed);
    if (match) {
      total++;
      if (match[2].toLowerCase() === 'x') {
        checked++;
      }
    }
  }

  return { total, checked };
}

export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const rawPath of paths) {
    const parts = rawPath.split('/').filter(Boolean);
    let currentLevel = root;
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;
      if (isFile) {
        currentLevel.push({ name: part, path: currentPath, type: 'file' });
      } else {
        let folder = currentLevel.find(n => n.type === 'folder' && n.name === part);
        if (!folder) {
          folder = { name: part, path: currentPath, type: 'folder', children: [] };
          currentLevel.push(folder);
        }
        currentLevel = folder.children!;
      }
    }
  }
  function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortNodes(node.children);
    }
    return nodes;
  }
  return sortNodes(root);
}

export function resolveRelativeDocLink(baseDocPath: string, targetLink: string): string | null {
  const trimmed = targetLink.trim();
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHref(rawHref: string): { href: string; docLink?: string } | null {
  if (/[\u0000-\u001f\u007f\\]/.test(rawHref)) return null;
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;

  const decoded = trimmed
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
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

function renderInline(line: string): string {
  const codeSpans: string[] = [];
  const withPlaceholders = line.replace(/`([^`]+)`/g, (_m, code: string) => {
    const idx = codeSpans.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\u0000CODE${idx}\u0000`;
  });

  let strippedHtml = withPlaceholders;
  while (/<\/?[a-zA-Z][^>]*>/.test(strippedHtml)) {
    strippedHtml = strippedHtml.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  }
  let escaped = escapeHtml(strippedHtml);

  escaped = escaped.replace(/\[\[([A-Za-z0-9_./-]+)\]\]/g, (_m, target: string) => {
    return `<a href="#doc:${target}" data-doc-link="${target}" class="wiki-link">[[${target}]]</a>`;
  });

  escaped = escaped.replace(
    /\[([^\]]+)\]\(([^\u0000()\s]*(?:\([^\u0000()\s]*\)[^\u0000()\s]*)*)\)/g,
    (_m, label: string, rawUrl: string) => {
      const unescapedUrl = rawUrl
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const safe = sanitizeHref(unescapedUrl);
      if (!safe) return label;
      const attr = safe.docLink ? ` data-doc-link="${safe.docLink}"` : ' target="_blank" rel="noopener noreferrer"';
      return `<a href="${safe.href}"${attr}>${label}</a>`;
    }
  );

  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return escaped.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx: string) => codeSpans[Number(idx)] ?? '');
}

export function renderMarkdownSafe(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
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
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      } else {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (/^---\s*$/.test(line)) {
      closeList();
      out.push('<hr>');
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    const taskMatch = /^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (taskMatch) {
      if (!inList) {
        out.push('<ul class="task-list">');
        inList = true;
      }
      const checkedAttr = taskMatch[2].toLowerCase() === 'x' ? ' data-checked="true"' : ' data-checked="false"';
      out.push(
        `<li class="task-item"><span class="task-checkbox-host" data-task-checkbox data-line="${i}"${checkedAttr} data-label="${escapeHtml(taskMatch[3])}"></span> ${renderInline(taskMatch[3])}</li>`
      );
      continue;
    }

    const listMatch = /^(\s*)[-*]\s+(.+)$/.exec(line);
    if (listMatch) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${renderInline(listMatch[2])}</li>`);
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
  if (inCodeBlock) {
    out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  return out.join('\n');
}
