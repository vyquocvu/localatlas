import { randomUUID } from 'node:crypto';
import { resolve, join, sep } from 'node:path';
import { realpath, stat, mkdir, rm, readdir, readFile } from 'node:fs/promises';
import { Project } from './types.js';
import { ConflictError, NotFoundError } from './errors.js';
import {
  home,
  canonicalizePath,
  pathsOverlap,
  validateProjectPaths,
  assertNoSymlinkChain,
  UUID_RE,
} from './paths.js';
import { withWorkspaceLock } from './lock.js';
import { withDb, rowToProject, deriveProjectKey, validateProjectKey, DbProjectRow } from './db.js';

export async function projects(): Promise<Project[]> {
  return withDb(db => {
    const rows = db
      .prepare('SELECT * FROM projects ORDER BY created_at ASC, name ASC')
      .all() as unknown as DbProjectRow[];
    return rows.map(rowToProject);
  });
}

export async function importProject(
  input: string,
  options?: { key?: string; name?: string; reuseDocs?: string }
): Promise<Project> {
  const sourcePath = await realpath(resolve(input));
  if (!(await stat(sourcePath)).isDirectory()) throw new Error('Not a directory');
  const canonicalHome = await canonicalizePath(home());
  if (pathsOverlap(sourcePath, canonicalHome)) {
    throw new Error('Project sourcePath cannot overlap with LOCALATLAS_HOME');
  }

  return withWorkspaceLock(async () => {
    return withDb(async db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db
          .prepare('SELECT * FROM projects WHERE source_path = ?')
          .get(sourcePath) as unknown as DbProjectRow | undefined;
        if (existing) {
          db.exec('COMMIT');
          return rowToProject(existing);
        }

        let id: string;
        if (options?.reuseDocs !== undefined) {
          if (!UUID_RE.test(options.reuseDocs)) throw new Error('Invalid reuseDocs UUID');
          const idTaken = db.prepare('SELECT id FROM projects WHERE id = ?').get(options.reuseDocs);
          if (idTaken) throw new ConflictError(`Project id "${options.reuseDocs}" is already registered`);
          const existingDocsDir = join(home(), 'projects', options.reuseDocs, 'docs');
          await assertNoSymlinkChain(home(), existingDocsDir);
          let st;
          try {
            st = await stat(existingDocsDir);
          } catch {
            throw new Error(`Managed docs directory not found for UUID "${options.reuseDocs}"`);
          }
          if (!st.isDirectory()) throw new Error(`Managed docs path is not a directory for UUID "${options.reuseDocs}"`);
          id = options.reuseDocs;
        } else {
          id = randomUUID();
        }

        const allRows = db.prepare('SELECT key FROM projects').all() as Array<{ key: string }>;
        const usedKeys = new Set(allRows.map(r => r.key.toUpperCase()));

        const defaultName = sourcePath.split(sep).filter(Boolean).at(-1) ?? 'project';
        const name = options?.name?.trim() || defaultName;
        let key: string;
        if (options?.key !== undefined) {
          key = validateProjectKey(options.key);
          if (usedKeys.has(key)) throw new ConflictError(`Project key "${key}" is already in use`);
        } else {
          key = deriveProjectKey(name, usedKeys);
        }

        const managedPath = join(home(), 'projects', id);
        const createdAt = new Date().toISOString();

        await mkdir(join(managedPath, 'docs'), { recursive: true });
        db.prepare(`
          INSERT INTO projects (id, key, name, source_path, managed_path, next_seq, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `).run(id, key, name, sourcePath, managedPath, createdAt);
        db.exec('COMMIT');

        return { id, key, name, sourcePath, managedPath, createdAt };
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      }
    });
  });
}

export async function selectProject(selector?: string, cwd = process.cwd()): Promise<Project> {
  const all = await projects();
  if (selector) {
    const byId = all.find(p => p.id === selector);
    if (byId) return byId;
    const upper = selector.toUpperCase();
    const byKey = all.find(p => p.key.toUpperCase() === upper);
    if (byKey) return byKey;
    const byName = all.filter(p => p.name === selector);
    if (byName.length > 1) throw new Error(`Ambiguous project name "${selector}"; pass --project <id|key>`);
    if (byName.length === 1) return byName[0];
    throw new NotFoundError('Project not found; run localatlas import <path> or pass --project <id>');
  }
  const canonicalCwd = await canonicalizePath(cwd);
  const project = all
    .filter(p => canonicalCwd === p.sourcePath || canonicalCwd.startsWith(p.sourcePath + sep))
    .sort((a, b) => b.sourcePath.length - a.sourcePath.length)[0];
  if (!project) throw new NotFoundError('Project not found; run localatlas import <path> or pass --project <id>');
  return project;
}

async function hasExistingPrefixedIds(project: Project): Promise<boolean> {
  const root = join(project.managedPath, 'docs');
  try {
    async function scan(dir: string): Promise<boolean> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (await scan(join(dir, entry.name))) return true;
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = await readFile(join(dir, entry.name), 'utf8').catch(() => '');
          const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
          if (match && new RegExp(`^id:\\s*["']?${project.key}-\\d+["']?\\s*$`, 'm').test(match[1])) {
            return true;
          }
        }
      }
      return false;
    }
    return await scan(root);
  } catch {
    return false;
  }
}

export async function updateProject(
  selector: string | undefined,
  patch: { name?: string; key?: string },
  options?: { force?: boolean; cwd?: string }
): Promise<Project> {
  const current = await selectProject(selector, options?.cwd);
  return withWorkspaceLock(async () => {
    const newName = patch.name !== undefined ? patch.name.trim() : current.name;
    if (!newName) throw new Error('Project name cannot be empty');
    const newKey = patch.key !== undefined ? validateProjectKey(patch.key) : current.key;

    if (newKey !== current.key && !options?.force) {
      if (await hasExistingPrefixedIds(current)) {
        throw new ConflictError(
          `Project key "${current.key}" is already referenced by existing document IDs; pass --force to change key`
        );
      }
    }

    return withDb(db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (newKey !== current.key) {
          const dup = db.prepare('SELECT id FROM projects WHERE UPPER(key) = ? AND id != ?').get(newKey, current.id);
          if (dup) throw new ConflictError(`Project key "${newKey}" is already in use`);
        }
        db.prepare('UPDATE projects SET name = ?, key = ? WHERE id = ?').run(newName, newKey, current.id);
        const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(current.id) as unknown as DbProjectRow;
        db.exec('COMMIT');
        return rowToProject(updated);
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      }
    });
  });
}

export async function relinkProject(selector: string, inputPath: string): Promise<Project> {
  if (!inputPath?.trim()) throw new Error('Project source path cannot be empty');
  const current = await selectProject(selector);
  const sourcePath = await realpath(resolve(inputPath));
  if (!(await stat(sourcePath)).isDirectory()) throw new Error('Not a directory');
  const canonicalHome = await canonicalizePath(home());
  if (pathsOverlap(sourcePath, canonicalHome)) {
    throw new Error('Project sourcePath cannot overlap with LOCALATLAS_HOME');
  }

  return withWorkspaceLock(async () => withDb(db => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = db.prepare('SELECT id FROM projects WHERE source_path = ? AND id != ?').get(sourcePath, current.id) as { id: string } | undefined;
      if (duplicate) throw new ConflictError(`Project source path is already registered to "${duplicate.id}"`);
      db.prepare('UPDATE projects SET source_path = ? WHERE id = ?').run(sourcePath, current.id);
      const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(current.id) as unknown as DbProjectRow;
      db.exec('COMMIT');
      return rowToProject(updated);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  }));
}

export async function removeProject(
  selector: string,
  options?: { purgeDocs?: boolean }
): Promise<{ removed: Project; purgedDocs: boolean }> {
  const target = await selectProject(selector);
  validateProjectPaths(target);
  return withWorkspaceLock(async () => {
    await withDb(db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM doc_index WHERE project_id = ?').run(target.id);
        db.prepare('DELETE FROM doc_fts WHERE project_id = ?').run(target.id);
        db.prepare('DELETE FROM doc_links WHERE project_id = ?').run(target.id);
        db.prepare('DELETE FROM projects WHERE id = ?').run(target.id);
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
    let purgedDocs = false;
    if (options?.purgeDocs) {
      await assertNoSymlinkChain(home(), target.managedPath);
      await rm(target.managedPath, { recursive: true, force: true });
      purgedDocs = true;
    }
    return { removed: target, purgedDocs };
  });
}
