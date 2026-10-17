import { stat, readFile } from 'node:fs/promises';
import { Project, DocSearchFilter, DocSearchResult, BacklinkEntry } from './types.js';
import { documentPath, normalizeDocName } from './paths.js';
import { computeEtag, parseDocument } from './markdown.js';
import { withWorkspaceLock } from './lock.js';
import { withDb } from './db.js';
import { projects } from './projects.js';
import { listDocs, upsertDocIndexInDb, removeDocIndexInDb } from './documents.js';
import { emitProjectEvent } from './events.js';

export function sanitizeFtsQuery(rawQuery: string): { ftsMatch: string | null; fallbackLike: string | null } {
  const trimmed = rawQuery.trim();
  if (!trimmed) return { ftsMatch: null, fallbackLike: null };
  const rawTokens = trimmed.match(/[A-Za-z0-9_-]+/g) ?? [];
  const safeTokens = rawTokens.filter(t => !/^(AND|OR|NOT|NEAR)$/i.test(t));
  if (safeTokens.length === 0) {
    return { ftsMatch: null, fallbackLike: trimmed };
  }
  const ftsMatch = safeTokens.map(t => `"${t.replace(/"/g, '""')}"*`).join(' AND ');
  return { ftsMatch, fallbackLike: trimmed };
}

export async function reindexProject(
  p: Project
): Promise<{ indexedDocs: number; warnings: string[] }> {
  return withWorkspaceLock(async () => {
    const docs = await listDocs(p);
    const warnings: string[] = [];
    const seenIds = new Map<string, string>();
    const scanned: Array<{ path: string; content: string; etag: string; mtimeMs: number; size: number }> = [];

    for (const docPath of docs) {
      const full = await documentPath(p, docPath);
      const st = await stat(full);
      const content = await readFile(full, 'utf8');
      const parsed = parseDocument(content);
      if (parsed.parseWarning) {
        warnings.push(`${docPath}: ${parsed.parseWarning}`);
      }
      if (parsed.hasFrontmatter && !parsed.malformedFrontmatter && typeof parsed.frontmatter.id === 'string') {
        const id = parsed.frontmatter.id.trim();
        if (id) {
          if (seenIds.has(id)) {
            warnings.push(`Duplicate frontmatter id "${id}" in "${docPath}" and "${seenIds.get(id)}"`);
          } else {
            seenIds.set(id, docPath);
          }
        }
      }
      scanned.push({
        path: docPath,
        content,
        etag: computeEtag(content),
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    }

    await withDb(db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM doc_index WHERE project_id = ?').run(p.id);
        db.prepare('DELETE FROM doc_fts WHERE project_id = ?').run(p.id);
        db.prepare('DELETE FROM doc_links WHERE project_id = ?').run(p.id);
        for (const item of scanned) {
          upsertDocIndexInDb(db, p.id, item.path, item.content, item.etag, item.mtimeMs, item.size);
        }
        db.prepare('UPDATE projects SET needs_reindex = 0 WHERE id = ?').run(p.id);
        db.exec('COMMIT');
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      }
    });

    emitProjectEvent({ projectId: p.id, type: 'reindexed' });
    return { indexedDocs: scanned.length, warnings };
  });
}

export async function reconcileProjectIndex(
  p: Project
): Promise<{ changed: number }> {
  return withWorkspaceLock(async () => {
    const docs = await listDocs(p);
    const diskSet = new Set(docs);

    const indexedRows = await withDb(db => {
      const projRow = db
        .prepare('SELECT needs_reindex FROM projects WHERE id = ?')
        .get(p.id) as { needs_reindex: number } | undefined;
      const rows = db
        .prepare('SELECT path, etag, mtime_ms, size_bytes FROM doc_index WHERE project_id = ?')
        .all(p.id) as Array<{ path: string; etag: string; mtime_ms: number; size_bytes: number }>;
      return { needsReindex: Boolean(projRow?.needs_reindex), rows };
    });

    if (indexedRows.needsReindex) {
      const res = await reindexProject(p);
      return { changed: res.indexedDocs };
    }

    const byPath = new Map(indexedRows.rows.map(r => [r.path, r]));
    const toUpsert: Array<{ path: string; content: string; etag: string; mtimeMs: number; size: number }> = [];
    const toRemove: string[] = [];

    for (const row of indexedRows.rows) {
      if (!diskSet.has(row.path)) {
        toRemove.push(row.path);
      }
    }

    for (const docPath of docs) {
      const full = await documentPath(p, docPath);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      const existing = byPath.get(docPath);
      if (existing && existing.mtime_ms === Math.floor(st.mtimeMs) && existing.size_bytes === st.size) {
        continue;
      }
      const content = await readFile(full, 'utf8');
      const etag = computeEtag(content);
      if (existing && existing.etag === etag) {
        continue;
      }
      toUpsert.push({ path: docPath, content, etag, mtimeMs: st.mtimeMs, size: st.size });
    }

    const changed = toRemove.length + toUpsert.length;
    if (changed === 0) return { changed: 0 };

    await withDb(db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const rem of toRemove) {
          removeDocIndexInDb(db, p.id, rem);
        }
        for (const item of toUpsert) {
          upsertDocIndexInDb(db, p.id, item.path, item.content, item.etag, item.mtimeMs, item.size);
        }
        db.exec('COMMIT');
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      }
    });

    for (const rem of toRemove) {
      emitProjectEvent({ projectId: p.id, type: 'doc_changed', path: rem });
    }
    for (const item of toUpsert) {
      emitProjectEvent({ projectId: p.id, type: 'doc_changed', path: item.path, etag: item.etag });
    }

    return { changed };
  });
}

export async function listDocsFiltered(
  p: Project,
  filters?: DocSearchFilter
): Promise<DocSearchResult[]> {
  await reconcileProjectIndex(p);
  return withDb(db => {
    const clauses: string[] = ['project_id = ?'];
    const params: Array<string> = [p.id];
    if (filters?.type) {
      clauses.push('type = ?');
      params.push(filters.type);
    }
    if (filters?.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.milestone) {
      clauses.push('milestone = ?');
      params.push(filters.milestone);
    }
    if (filters?.epic) {
      clauses.push('epic = ?');
      params.push(filters.epic);
    }
    const rows = db
      .prepare(`SELECT * FROM doc_index WHERE ${clauses.join(' AND ')} ORDER BY path ASC`)
      .all(...params) as Array<{
      project_id: string;
      path: string;
      doc_id: string | null;
      title: string;
      type: string | null;
      status: string | null;
      priority: string | null;
      epic: string | null;
      milestone: string | null;
      etag: string;
    }>;
    return rows.map(r => ({
      projectId: r.project_id,
      projectKey: p.key,
      projectName: p.name,
      path: r.path,
      docId: r.doc_id,
      title: r.title,
      type: r.type,
      status: r.status,
      etag: r.etag,
      snippet: r.title,
    }));
  });
}

export async function searchDocs(
  p: Project | null,
  query: string,
  filters?: DocSearchFilter
): Promise<DocSearchResult[]> {
  if (p && !filters?.allProjects) {
    await reconcileProjectIndex(p);
  } else {
    const all = await projects();
    for (const proj of all) {
      await reconcileProjectIndex(proj);
    }
  }

  const { ftsMatch, fallbackLike } = sanitizeFtsQuery(query);
  if (!ftsMatch && !fallbackLike && p && !filters?.allProjects) {
    return listDocsFiltered(p, filters);
  }

  const allProjectsList = await projects();
  const projMap = new Map(allProjectsList.map(pr => [pr.id, pr]));

  return withDb(db => {
    const clauses: string[] = [];
    const params: Array<string> = [];

    if (p && !filters?.allProjects) {
      clauses.push('di.project_id = ?');
      params.push(p.id);
    }
    if (filters?.type) {
      clauses.push('di.type = ?');
      params.push(filters.type);
    }
    if (filters?.status) {
      clauses.push('di.status = ?');
      params.push(filters.status);
    }
    if (filters?.milestone) {
      clauses.push('di.milestone = ?');
      params.push(filters.milestone);
    }
    if (filters?.epic) {
      clauses.push('di.epic = ?');
      params.push(filters.epic);
    }

    if (ftsMatch) {
      const ftsClauses = ['doc_fts MATCH ?', ...clauses];
      const ftsParams = [ftsMatch, ...params];
      const sql = `
        SELECT
          di.project_id,
          di.path,
          di.doc_id,
          di.title,
          di.type,
          di.status,
          di.etag,
          snippet(doc_fts, 4, '[', ']', '...', 16) AS snippet
        FROM doc_fts
        JOIN doc_index di ON di.project_id = doc_fts.project_id AND di.path = doc_fts.path
        WHERE ${ftsClauses.join(' AND ')}
        ORDER BY bm25(doc_fts) ASC, di.path ASC
        LIMIT 50
      `;
      const rows = db.prepare(sql).all(...ftsParams) as Array<{
        project_id: string;
        path: string;
        doc_id: string | null;
        title: string;
        type: string | null;
        status: string | null;
        etag: string;
        snippet: string | null;
      }>;
      return rows.map(r => {
        const pr = projMap.get(r.project_id);
        return {
          projectId: r.project_id,
          projectKey: pr ? pr.key : '',
          projectName: pr ? pr.name : '',
          path: r.path,
          docId: r.doc_id,
          title: r.title,
          type: r.type,
          status: r.status,
          etag: r.etag,
          snippet: r.snippet || r.title,
        };
      });
    }

    if (fallbackLike) {
      const escapedLike = fallbackLike.replace(/[\\%_]/g, '\\$&');
      const likeClauses = [
        "(doc_fts.body LIKE ? ESCAPE '\\' OR di.title LIKE ? ESCAPE '\\' OR di.path LIKE ? ESCAPE '\\')",
        ...clauses,
      ];
      const pattern = `%${escapedLike}%`;
      const likeParams = [pattern, pattern, pattern, ...params];
      const sql = `
        SELECT
          di.project_id,
          di.path,
          di.doc_id,
          di.title,
          di.type,
          di.status,
          di.etag
        FROM doc_fts
        JOIN doc_index di ON di.project_id = doc_fts.project_id AND di.path = doc_fts.path
        WHERE ${likeClauses.join(' AND ')}
        ORDER BY di.path ASC
        LIMIT 50
      `;
      const rows = db.prepare(sql).all(...likeParams) as Array<{
        project_id: string;
        path: string;
        doc_id: string | null;
        title: string;
        type: string | null;
        status: string | null;
        etag: string;
      }>;
      return rows.map(r => {
        const pr = projMap.get(r.project_id);
        return {
          projectId: r.project_id,
          projectKey: pr ? pr.key : '',
          projectName: pr ? pr.name : '',
          path: r.path,
          docId: r.doc_id,
          title: r.title,
          type: r.type,
          status: r.status,
          etag: r.etag,
          snippet: r.title,
        };
      });
    }

    return [];
  });
}

export async function getBacklinks(p: Project, docOrId: string): Promise<BacklinkEntry[]> {
  await reconcileProjectIndex(p);
  const trimmed = docOrId.trim();
  if (!trimmed) return [];

  return withDb(db => {
    const refs = new Set<string>([trimmed]);
    if (trimmed.endsWith('.md')) {
      try {
        const norm = normalizeDocName(trimmed);
        refs.add(norm);
        const row = db
          .prepare('SELECT doc_id FROM doc_index WHERE project_id = ? AND path = ?')
          .get(p.id, norm) as { doc_id: string | null } | undefined;
        if (row?.doc_id) refs.add(row.doc_id);
      } catch {
        // Ignore invalid path
      }
    } else {
      const row = db
        .prepare('SELECT path FROM doc_index WHERE project_id = ? AND doc_id = ?')
        .get(p.id, trimmed) as { path: string } | undefined;
      if (row?.path) refs.add(row.path);
    }

    const refList = [...refs];
    const placeholders = refList.map(() => '?').join(', ');
    const sql = `
      SELECT DISTINCT
        dl.source_path,
        di.doc_id AS source_id,
        COALESCE(di.title, dl.source_path) AS source_title,
        dl.target_ref
      FROM doc_links dl
      LEFT JOIN doc_index di ON di.project_id = dl.project_id AND di.path = dl.source_path
      WHERE dl.project_id = ? AND dl.target_ref IN (${placeholders})
      ORDER BY dl.source_path ASC
    `;
    const rows = db.prepare(sql).all(p.id, ...refList) as Array<{
      source_path: string;
      source_id: string | null;
      source_title: string;
      target_ref: string;
    }>;

    const seen = new Set<string>();
    const out: BacklinkEntry[] = [];
    for (const r of rows) {
      if (seen.has(r.source_path)) continue;
      seen.add(r.source_path);
      out.push({
        sourcePath: r.source_path,
        sourceId: r.source_id,
        sourceTitle: r.source_title,
        snippet: r.source_title,
      });
    }
    return out;
  });
}
