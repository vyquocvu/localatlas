import { DatabaseSync } from 'node:sqlite';
import { resolve, join, isAbsolute } from 'node:path';
import { readFile, rename, chmod } from 'node:fs/promises';
import { Project } from './types.js';
import {
  home,
  ensureHomeDir,
  dbPath,
  legacyRegistryPath,
  validateProjectPaths,
  UUID_RE,
  KEY_RE,
} from './paths.js';

export interface DbProjectRow {
  id: string;
  key: string;
  name: string;
  source_path: string;
  managed_path: string;
  next_seq?: number;
  needs_reindex?: number;
  created_at: string;
}

export function rowToProject(row: DbProjectRow): Project {
  const project: Project = {
    id: row.id,
    key: row.key,
    name: row.name,
    sourcePath: row.source_path,
    managedPath: row.managed_path,
    createdAt: row.created_at,
  };
  validateProjectPaths(project);
  return project;
}

export function deriveProjectKey(name: string, usedKeys: Set<string>): string {
  const letters = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const rawBase = (letters.slice(0, 3) || 'PRJ').padEnd(2, 'X').slice(0, 4);
  const base = /^[A-Z]/.test(rawBase) ? rawBase : `P${rawBase}`.slice(0, 3);
  if (!usedKeys.has(base) && KEY_RE.test(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const suffix = String(i);
    const prefixLen = Math.min(base.length, 5 - suffix.length);
    const candidate = `${base.slice(0, prefixLen)}${suffix}`;
    if (!usedKeys.has(candidate) && KEY_RE.test(candidate)) return candidate;
  }
  for (let i = 1; i <= 999; i++) {
    const candidate = `P${String(i).padStart(3, '0')}`;
    if (!usedKeys.has(candidate) && KEY_RE.test(candidate)) return candidate;
  }
  throw new Error(`Unable to derive a unique project key for "${name}"`);
}

export function validateProjectKey(key: string): string {
  const trimmed = key.trim().toUpperCase();
  if (!KEY_RE.test(trimmed)) {
    throw new Error('Project key must be 2 to 5 uppercase alphanumeric characters starting with a letter (e.g. SAV)');
  }
  return trimmed;
}

let cachedDb: { path: string; db: DatabaseSync } | null = null;
const initializedPaths = new Set<string>();

export async function openDatabase(): Promise<DatabaseSync> {
  await ensureHomeDir();
  const currentPath = dbPath();

  if (cachedDb && cachedDb.path === currentPath) {
    return cachedDb.db;
  }

  if (cachedDb) {
    try {
      cachedDb.db.close();
    } catch {}
    cachedDb = null;
  }

  const db = new DatabaseSync(currentPath);
  try {
    await chmod(currentPath, 0o600);
  } catch {
    /* ignore */
  }

  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  if (!initializedPaths.has(currentPath)) {
    const hasSchema = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    if (!hasSchema) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          source_path TEXT NOT NULL UNIQUE,
          managed_path TEXT NOT NULL,
          next_seq INTEGER NOT NULL DEFAULT 0,
          needs_reindex INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS doc_index (
          project_id TEXT NOT NULL,
          path TEXT NOT NULL,
          doc_id TEXT,
          title TEXT NOT NULL,
          type TEXT,
          status TEXT,
          priority TEXT,
          epic TEXT,
          milestone TEXT,
          frontmatter_json TEXT NOT NULL,
          etag TEXT NOT NULL,
          mtime_ms INTEGER NOT NULL DEFAULT 0,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (project_id, path)
        );
        CREATE INDEX IF NOT EXISTS idx_doc_index_project_doc_id ON doc_index(project_id, doc_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(
          project_id UNINDEXED,
          path,
          doc_id,
          title,
          body
        );
        CREATE TABLE IF NOT EXISTS doc_links (
          project_id TEXT NOT NULL,
          source_path TEXT NOT NULL,
          target_ref TEXT NOT NULL,
          target_kind TEXT NOT NULL,
          PRIMARY KEY (project_id, source_path, target_ref)
        );
        CREATE INDEX IF NOT EXISTS idx_doc_links_target ON doc_links(project_id, target_ref);
      `);
      try {
        db.exec('ALTER TABLE projects ADD COLUMN needs_reindex INTEGER NOT NULL DEFAULT 0');
      } catch {
        // Column already exists
      }
    }
    await migrateLegacyRegistryIfNeeded(db);
    initializedPaths.add(currentPath);
  }

  cachedDb = { path: currentPath, db };
  return db;
}

export function closeDatabase(): void {
  if (cachedDb) {
    try {
      cachedDb.db.close();
    } catch {}
    cachedDb = null;
  }
}

async function migrateLegacyRegistryIfNeeded(db: DatabaseSync): Promise<void> {
  const jsonPath = legacyRegistryPath();
  let raw: string;
  try {
    raw = await readFile(jsonPath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Failed to migrate projects.json: invalid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Failed to migrate projects.json: root value must be an array');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const existingRows = db.prepare('SELECT * FROM projects').all() as unknown as DbProjectRow[];
    const byId = new Map<string, DbProjectRow>(existingRows.map(r => [r.id, r]));
    const bySource = new Map<string, DbProjectRow>(existingRows.map(r => [r.source_path, r]));
    const usedKeys = new Set<string>(existingRows.map(r => r.key));

    const seenIds = new Map<string, string>();
    const seenSources = new Map<string, string>();

    const toInsert: Array<{
      id: string;
      key: string;
      name: string;
      sourcePath: string;
      managedPath: string;
      createdAt: string;
    }> = [];

    for (let idx = 0; idx < parsed.length; idx++) {
      const item = parsed[idx] as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        throw new Error(`Migration error at index ${idx}: entry must be an object`);
      }
      const id = typeof item.id === 'string' ? item.id : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const sourcePath = typeof item.sourcePath === 'string' ? item.sourcePath : '';
      const managedPath = typeof item.managedPath === 'string' ? item.managedPath : '';
      const createdAt = typeof item.createdAt === 'string' ? item.createdAt : '';

      if (!UUID_RE.test(id) || !name || !sourcePath || !isAbsolute(sourcePath) || !createdAt) {
        throw new Error(`Migration error for record "${id || idx}": missing or invalid required fields`);
      }
      const expectedManaged = join(home(), 'projects', id);
      if (managedPath && resolve(managedPath) !== resolve(expectedManaged)) {
        throw new Error(`Migration error for record "${id}": invalid managedPath "${managedPath}"`);
      }

      if (seenIds.has(id) && seenIds.get(id) !== sourcePath) {
        throw new Error(`Migration conflict in projects.json: duplicate id "${id}"`);
      }
      if (seenSources.has(sourcePath) && seenSources.get(sourcePath) !== id) {
        throw new Error(`Migration conflict in projects.json: duplicate sourcePath "${sourcePath}"`);
      }
      if (seenIds.has(id) && seenSources.has(sourcePath)) {
        throw new Error(`Migration conflict in projects.json: duplicate entry for "${id}"`);
      }
      seenIds.set(id, sourcePath);
      seenSources.set(sourcePath, id);

      const existingById = byId.get(id);
      const existingBySource = bySource.get(sourcePath);
      if (existingById || existingBySource) {
        if (
          !existingById ||
          !existingBySource ||
          existingById.id !== existingBySource.id ||
          existingById.source_path !== sourcePath
        ) {
          throw new Error(
            `Migration conflict with existing SQLite record for id "${id}" or sourcePath "${sourcePath}"`
          );
        }
        continue;
      }

      const key =
        typeof item.key === 'string' && KEY_RE.test(item.key) && !usedKeys.has(item.key)
          ? item.key
          : deriveProjectKey(name, usedKeys);
      usedKeys.add(key);
      toInsert.push({ id, key, name, sourcePath, managedPath: expectedManaged, createdAt });
    }

    const insertStmt = db.prepare(`
      INSERT INTO projects (id, key, name, source_path, managed_path, next_seq, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    for (const row of toInsert) {
      insertStmt.run(row.id, row.key, row.name, row.sourcePath, row.managedPath, row.createdAt);
    }

    // Verify all records from projects.json exist in SQLite
    for (const [id, src] of seenIds.entries()) {
      const check = db
        .prepare('SELECT id, source_path FROM projects WHERE id = ?')
        .get(id) as { id: string; source_path: string } | undefined;
      if (!check || check.source_path !== src) {
        throw new Error(`Migration verification failed for project "${id}"`);
      }
    }

    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(
      new Date().toISOString()
    );
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  try {
    await rename(jsonPath, jsonPath + '.migrated');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

export async function withDb<T>(fn: (db: DatabaseSync) => T | Promise<T>): Promise<T> {
  const start = Date.now();
  let attempt = 0;
  while (true) {
    try {
      const db = await openDatabase();
      return await fn(db);
    } catch (err: any) {
      attempt++;
      const msg = err?.message || '';
      if (
        (msg.includes('database is locked') || msg.includes('busy') || err?.code === 'SQLITE_BUSY') &&
        Date.now() - start < 10000
      ) {
        closeDatabase();
        await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 40) + attempt * 10));
        continue;
      }
      throw err;
    }
  }
}
