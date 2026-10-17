import { dirname, join, resolve, sep } from 'node:path';
import { readFile, stat, mkdir, realpath, rename, unlink, rmdir, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Project, DocMeta } from './types.js';
import { ConflictError, ValidationError } from './errors.js';
import {
  home,
  documentPath,
  normalizeDocName,
  assertNoSymlinkChain,
  stripQuotes,
} from './paths.js';

export { documentPath };
import { atomicWrite, withWorkspaceLock } from './lock.js';
import { withDb } from './db.js';
import {
  computeEtag,
  parseDocument,
  serializeDocument,
  deriveDocTitle,
  extractOutboundLinks,
} from './markdown.js';
import { emitProjectEvent } from './events.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function upsertDocIndexInDb(
  db: DatabaseSync,
  projectId: string,
  docPath: string,
  content: string,
  etag: string,
  mtimeMs: number,
  sizeBytes: number
): { docId: string | null } {
  const parsed = parseDocument(content);
  const fm = parsed.hasFrontmatter && !parsed.malformedFrontmatter ? parsed.frontmatter : {};
  const docId = typeof fm.id === 'string' && fm.id.trim() ? fm.id.trim() : null;
  const title = deriveDocTitle(docPath, parsed);
  const type = typeof fm.type === 'string' ? fm.type : null;
  const status = typeof fm.status === 'string' ? fm.status : null;
  const priority = typeof fm.priority === 'string' ? fm.priority : null;
  const epic = typeof fm.epic === 'string' ? fm.epic : null;
  const milestone = typeof fm.milestone === 'string' ? fm.milestone : null;
  const now = new Date().toISOString();

  db.prepare('DELETE FROM doc_index WHERE project_id = ? AND path = ?').run(projectId, docPath);
  db.prepare('DELETE FROM doc_fts WHERE project_id = ? AND path = ?').run(projectId, docPath);
  db.prepare('DELETE FROM doc_links WHERE project_id = ? AND source_path = ?').run(projectId, docPath);

  db.prepare(`
    INSERT INTO doc_index (
      project_id, path, doc_id, title, type, status, priority, epic, milestone,
      frontmatter_json, etag, mtime_ms, size_bytes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId,
    docPath,
    docId,
    title,
    type,
    status,
    priority,
    epic,
    milestone,
    JSON.stringify(fm),
    etag,
    Math.floor(mtimeMs),
    sizeBytes,
    now
  );

  db.prepare(`
    INSERT INTO doc_fts (project_id, path, doc_id, title, body)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, docPath, docId ?? '', title, parsed.body);

  const links = extractOutboundLinks(docPath, parsed.body);
  const linkStmt = db.prepare(`
    INSERT OR IGNORE INTO doc_links (project_id, source_path, target_ref, target_kind)
    VALUES (?, ?, ?, ?)
  `);
  for (const link of links) {
    linkStmt.run(projectId, docPath, link.targetRef, link.targetKind);
  }

  return { docId };
}

export function removeDocIndexInDb(db: DatabaseSync, projectId: string, docPath: string): void {
  db.prepare('DELETE FROM doc_index WHERE project_id = ? AND path = ?').run(projectId, docPath);
  db.prepare('DELETE FROM doc_fts WHERE project_id = ? AND path = ?').run(projectId, docPath);
  db.prepare('DELETE FROM doc_links WHERE project_id = ? AND source_path = ?').run(projectId, docPath);
}

export async function listDocs(project: Project): Promise<string[]> {
  const root = join(project.managedPath, 'docs');
  await assertNoSymlinkChain(home(), root);
  async function walk(dir: string, prefix = ''): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return out;
      throw e;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.localatlas-tmp-')) continue;
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), name)));
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(name);
    }
    return out;
  }
  return (await walk(root)).sort();
}

async function findDocPathById(p: Project, targetId: string): Promise<string | null> {
  const indexedPath = await withDb(db => {
    const row = db
      .prepare('SELECT path FROM doc_index WHERE project_id = ? AND doc_id = ?')
      .get(p.id, targetId) as { path: string } | undefined;
    return row?.path ?? null;
  });

  if (indexedPath) {
    try {
      const full = await documentPath(p, indexedPath);
      const content = await readFile(full, 'utf8');
      const parsed = parseDocument(content);
      if (
        parsed.hasFrontmatter &&
        !parsed.malformedFrontmatter &&
        typeof parsed.frontmatter.id === 'string' &&
        parsed.frontmatter.id.trim() === targetId
      ) {
        return indexedPath;
      }
    } catch {}
  }

  const allDocs = await listDocs(p);
  for (const doc of allDocs) {
    const full = await documentPath(p, doc);
    const content = await readFile(full, 'utf8').catch(() => '');
    const parsed = parseDocument(content);
    if (
      parsed.hasFrontmatter &&
      !parsed.malformedFrontmatter &&
      typeof parsed.frontmatter.id === 'string' &&
      parsed.frontmatter.id.trim() === targetId
    ) {
      return doc;
    }
  }
  return null;
}

export async function assertUniqueDocId(
  p: Project,
  excludePathOrPaths: string | string[],
  content: string
): Promise<string | null> {
  const excluded = new Set(Array.isArray(excludePathOrPaths) ? excludePathOrPaths : [excludePathOrPaths]);
  const parsed = parseDocument(content);
  if (parsed.hasFrontmatter && Object.prototype.hasOwnProperty.call(parsed.frontmatter, 'id')) {
    const rawId = parsed.frontmatter.id;
    if (typeof rawId !== 'string' || !rawId.trim()) {
      throw new ValidationError('Frontmatter "id" must be a non-empty string');
    }
    const docId = rawId.trim();
    const allDocs = await listDocs(p);
    for (const doc of allDocs) {
      if (excluded.has(doc)) continue;
      const diskPath = await documentPath(p, doc);
      const diskContent = await readFile(diskPath, 'utf8').catch(() => '');
      const diskParsed = parseDocument(diskContent);
      if (
        diskParsed.hasFrontmatter &&
        !diskParsed.malformedFrontmatter &&
        typeof diskParsed.frontmatter.id === 'string' &&
        diskParsed.frontmatter.id.trim() === docId
      ) {
        throw new ConflictError(`Document id "${docId}" is already used by "${doc}"`);
      }
    }
    return docId;
  }
  return null;
}

export async function resolveDocSelector(p: Project, docOrId: string): Promise<string> {
  const trimmed = docOrId.trim();
  if (!trimmed) throw new Error('Invalid document path');

  if (trimmed.endsWith('.md')) {
    const norm = normalizeDocName(trimmed);
    const full = await documentPath(p, norm);
    try {
      await stat(full);
      return norm;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (!norm.includes('/')) {
      const stem = norm.slice(0, -3);
      const byStem = await findDocPathById(p, stem);
      if (byStem) return byStem;
    }
    return norm;
  }

  const foundById = await findDocPathById(p, trimmed);
  if (foundById) return foundById;

  return normalizeDocName(trimmed);
}

export async function readDocWithMeta(p: Project, nameOrId: string): Promise<DocMeta> {
  const normalized = await resolveDocSelector(p, nameOrId);
  const path = await documentPath(p, normalized);
  const content = await readFile(path, 'utf8');
  const parsed = parseDocument(content);
  const docId =
    parsed.hasFrontmatter && !parsed.malformedFrontmatter && typeof parsed.frontmatter.id === 'string'
      ? parsed.frontmatter.id.trim()
      : null;
  return {
    path: normalized,
    etag: computeEtag(content),
    content,
    frontmatter: { ...parsed.frontmatter },
    docId,
    ...(parsed.parseWarning ? { parseWarning: parsed.parseWarning } : {}),
  };
}

export async function readDoc(p: Project, nameOrId: string): Promise<string> {
  return (await readDocWithMeta(p, nameOrId)).content;
}

export async function writeDoc(
  p: Project,
  nameOrId: string,
  content: string,
  options?: { ifMatch?: string; createOnly?: boolean; append?: boolean }
): Promise<{ path: string; etag: string }> {
  return withWorkspaceLock(async () => {
    const normalized = nameOrId.endsWith('.md') ? normalizeDocName(nameOrId) : await resolveDocSelector(p, nameOrId);
    const path = await documentPath(p, normalized);
    let existingContent: string | null = null;
    let currentEtag: string | null = null;
    try {
      existingContent = await readFile(path, 'utf8');
      currentEtag = computeEtag(existingContent);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    if (options?.createOnly && currentEtag !== null) {
      throw new ConflictError(`Document "${normalized}" already exists`, currentEtag);
    }
    if (options?.ifMatch !== undefined) {
      const expected = stripQuotes(options.ifMatch);
      if (expected === '*') {
        if (currentEtag === null) {
          throw new ConflictError(`Document "${normalized}" does not exist`, null);
        }
      } else if (currentEtag !== expected) {
        throw new ConflictError(`Document revision mismatch for "${normalized}"`, currentEtag);
      }
    }

    const finalContent = options?.append && existingContent !== null ? existingContent + content : content;
    await assertUniqueDocId(p, normalized, finalContent);

    const docsRoot = join(p.managedPath, 'docs');
    await mkdir(dirname(path), { recursive: true });
    const realRoot = await realpath(docsRoot);
    const realDir = await realpath(dirname(path));
    if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
      throw new Error('Symlinks are not allowed in managed documents');
    }

    await atomicWrite(path, finalContent);
    const etag = computeEtag(finalContent);
    const st = await stat(path);

    try {
      await withDb(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          upsertDocIndexInDb(db, p.id, normalized, finalContent, etag, st.mtimeMs, st.size);
          db.exec('COMMIT');
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw err;
        }
      });
    } catch {
      await withDb(db => {
        db.prepare('UPDATE projects SET needs_reindex = 1 WHERE id = ?').run(p.id);
      }).catch(() => {});
    }

    emitProjectEvent({ projectId: p.id, type: 'doc_changed', path: normalized, etag });
    return { path: normalized, etag };
  });
}

export async function updateFrontmatter(
  p: Project,
  nameOrId: string,
  patch: Record<string, string | string[] | null | undefined>,
  options?: { ifMatch?: string; unsetKeys?: string[] }
): Promise<{ path: string; etag: string; frontmatter: Record<string, string | string[]> }> {
  return withWorkspaceLock(async () => {
    const normalized = await resolveDocSelector(p, nameOrId);
    const path = await documentPath(p, normalized);
    const existingContent = await readFile(path, 'utf8');
    const currentEtag = computeEtag(existingContent);

    if (options?.ifMatch !== undefined) {
      const expected = stripQuotes(options.ifMatch);
      if (expected !== '*' && currentEtag !== expected) {
        throw new ConflictError(`Document revision mismatch for "${normalized}"`, currentEtag);
      }
    }

    const parsed = parseDocument(existingContent);
    if (parsed.malformedFrontmatter) {
      throw new ValidationError(parsed.parseWarning ?? `Malformed YAML frontmatter in "${normalized}"`);
    }

    const nextFm: Record<string, string | string[]> = Object.create(null);
    for (const k of Object.keys(parsed.frontmatter)) {
      nextFm[k] = parsed.frontmatter[k] as string | string[];
    }
    const nextOrder = [...(parsed.keyOrder ?? Object.keys(parsed.frontmatter))];

    for (const [k, v] of Object.entries(patch)) {
      if (FORBIDDEN_KEYS.has(k) || !/^[A-Za-z0-9_-]+$/.test(k)) {
        throw new ValidationError(`Invalid frontmatter key "${k}"`);
      }
      if (v === null || v === undefined) {
        delete nextFm[k];
      } else {
        nextFm[k] = v;
        if (!nextOrder.includes(k)) nextOrder.push(k);
      }
    }

    for (const unsetKey of options?.unsetKeys ?? []) {
      delete nextFm[unsetKey];
    }

    const serialized = serializeDocument(nextFm, nextOrder, parsed.body, parsed.lineEnding);
    await assertUniqueDocId(p, normalized, serialized);
    await atomicWrite(path, serialized);
    const etag = computeEtag(serialized);
    const st = await stat(path);

    try {
      await withDb(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          upsertDocIndexInDb(db, p.id, normalized, serialized, etag, st.mtimeMs, st.size);
          db.exec('COMMIT');
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw err;
        }
      });
    } catch {
      await withDb(db => {
        db.prepare('UPDATE projects SET needs_reindex = 1 WHERE id = ?').run(p.id);
      }).catch(() => {});
    }

    emitProjectEvent({ projectId: p.id, type: 'doc_changed', path: normalized, etag });
    return { path: normalized, etag, frontmatter: { ...nextFm } };
  });
}

async function pruneEmptyDirsUpward(docsRoot: string, startDir: string): Promise<void> {
  const rootResolved = resolve(docsRoot);
  let current = resolve(startDir);
  while (current !== rootResolved && current.startsWith(rootResolved + sep)) {
    try {
      await rmdir(current);
      current = dirname(current);
    } catch {
      break;
    }
  }
}

export async function moveDoc(
  p: Project,
  fromNameOrId: string,
  toName: string,
  options?: { ifMatch?: string; targetIfMatch?: string; overwrite?: boolean }
): Promise<{ from: string; to: string; path: string; etag: string }> {
  const toNorm = normalizeDocName(toName);
  return withWorkspaceLock(async () => {
    const fromNorm = fromNameOrId.endsWith('.md')
      ? normalizeDocName(fromNameOrId)
      : await resolveDocSelector(p, fromNameOrId);
    const fromPath = await documentPath(p, fromNorm);
    const existingContent = await readFile(fromPath, 'utf8');
    const currentEtag = computeEtag(existingContent);

    if (options?.ifMatch !== undefined) {
      const expected = stripQuotes(options.ifMatch);
      if (expected !== '*' && currentEtag !== expected) {
        throw new ConflictError(`Document revision mismatch for "${fromNorm}"`, currentEtag);
      }
    }

    if (fromNorm === toNorm) {
      await assertUniqueDocId(p, [fromNorm], existingContent);
      return { from: fromNorm, to: toNorm, path: toNorm, etag: currentEtag };
    }

    const docsRoot = join(p.managedPath, 'docs');
    const sameDir = dirname(fromNorm) === dirname(toNorm);
    const sameCaseInsensitive = sameDir && fromNorm.toLowerCase() === toNorm.toLowerCase();
    const toPath = sameCaseInsensitive
      ? join(docsRoot, ...toNorm.split('/'))
      : await documentPath(p, toNorm);

    if (sameCaseInsensitive) {
      await assertNoSymlinkChain(docsRoot, toPath);
    } else {
      let targetEtag: string | null = null;
      try {
        const targetContent = await readFile(toPath, 'utf8');
        targetEtag = computeEtag(targetContent);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }

      if (targetEtag !== null) {
        if (!options?.overwrite) {
          throw new ConflictError(`Destination document "${toNorm}" already exists`, targetEtag);
        }
        if (options?.targetIfMatch !== undefined) {
          const expectedTarget = stripQuotes(options.targetIfMatch);
          if (expectedTarget !== '*' && targetEtag !== expectedTarget) {
            throw new ConflictError(`Destination revision mismatch for "${toNorm}"`, targetEtag);
          }
        }
      }
    }

    await assertUniqueDocId(p, [fromNorm, toNorm], existingContent);

    await mkdir(dirname(toPath), { recursive: true });
    const realRoot = await realpath(docsRoot);
    const realDir = await realpath(dirname(toPath));
    if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
      throw new Error('Symlinks are not allowed in managed documents');
    }

    await rename(fromPath, toPath);
    await pruneEmptyDirsUpward(docsRoot, dirname(fromPath));
    const st = await stat(toPath);

    try {
      await withDb(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          removeDocIndexInDb(db, p.id, fromNorm);
          upsertDocIndexInDb(db, p.id, toNorm, existingContent, currentEtag, st.mtimeMs, st.size);
          db.exec('COMMIT');
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw err;
        }
      });
    } catch {
      await withDb(db => {
        db.prepare('UPDATE projects SET needs_reindex = 1 WHERE id = ?').run(p.id);
      }).catch(() => {});
    }

    emitProjectEvent({ projectId: p.id, type: 'doc_changed', path: toNorm, etag: currentEtag });
    return { from: fromNorm, to: toNorm, path: toNorm, etag: currentEtag };
  });
}

export async function deleteDoc(
  p: Project,
  nameOrId: string,
  options?: { ifMatch?: string }
): Promise<{ deleted: string; etag: string }> {
  return withWorkspaceLock(async () => {
    const normalized = nameOrId.endsWith('.md')
      ? normalizeDocName(nameOrId)
      : await resolveDocSelector(p, nameOrId);
    const path = await documentPath(p, normalized);
    const existingContent = await readFile(path, 'utf8');
    const currentEtag = computeEtag(existingContent);

    if (options?.ifMatch !== undefined) {
      const expected = stripQuotes(options.ifMatch);
      if (expected !== '*' && currentEtag !== expected) {
        throw new ConflictError(`Document revision mismatch for "${normalized}"`, currentEtag);
      }
    }

    await unlink(path);
    await pruneEmptyDirsUpward(join(p.managedPath, 'docs'), dirname(path));

    try {
      await withDb(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          removeDocIndexInDb(db, p.id, normalized);
          db.exec('COMMIT');
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw err;
        }
      });
    } catch {
      await withDb(db => {
        db.prepare('UPDATE projects SET needs_reindex = 1 WHERE id = ?').run(p.id);
      }).catch(() => {});
    }

    emitProjectEvent({ projectId: p.id, type: 'doc_changed', path: normalized, etag: currentEtag });
    return { deleted: normalized, etag: currentEtag };
  });
}
