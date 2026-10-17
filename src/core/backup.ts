import { readFile, mkdir, lstat, copyFile, readdir, chmod, unlink, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalizePath, pathsOverlap, home, assertNoSymlinkChain, normalizeDocName, UUID_RE } from './paths.js';
import { withWorkspaceLock, isWorkspaceLocked, atomicWrite } from './lock.js';
import { withDb } from './db.js';
import { projects } from './projects.js';
import { listDocs, documentPath } from './documents.js';
import { ConflictError } from './errors.js';
import type { BackupManifest } from './types.js';

export type { BackupManifest };

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

export async function backupWorkspace(
  targetDir: string
): Promise<{ backupDir: string; projectsCount: number; docsCount: number }> {
  const resolvedTarget = await canonicalizePath(targetDir);
  const canonicalHome = await canonicalizePath(home());
  if (pathsOverlap(resolvedTarget, canonicalHome)) {
    throw new Error('Backup directory cannot overlap with LOCALATLAS_HOME');
  }

  return withWorkspaceLock(async () => {
    const allProjects = await projects();
    for (const p of allProjects) {
      if (pathsOverlap(resolvedTarget, p.sourcePath)) {
        throw new Error(`Backup directory cannot overlap with imported project "${p.name}"`);
      }
    }

    await mkdir(resolvedTarget, { recursive: true, mode: 0o700 });
    const targetDb = join(resolvedTarget, 'atlas.db');
    const targetManifest = join(resolvedTarget, 'manifest.json');
    try {
      await lstat(targetManifest);
      throw new Error('Backup target directory already contains a manifest.json');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    await withDb(db => {
      db.prepare('VACUUM INTO ?').run(targetDb);
    });

    const files: Record<string, string> = {};
    files['atlas.db'] = await sha256File(targetDb);
    let docsCount = 0;

    for (const p of allProjects) {
      const docs = await listDocs(p);
      for (const doc of docs) {
        const srcFile = await documentPath(p, doc);
        const relKey = `projects/${p.id}/docs/${doc}`;
        const destFile = join(resolvedTarget, ...relKey.split('/'));
        await mkdir(dirname(destFile), { recursive: true });
        await copyFile(srcFile, destFile);
        files[relKey] = await sha256File(destFile);
        docsCount++;
      }
    }

    const manifest: BackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      files,
    };
    await atomicWrite(targetManifest, JSON.stringify(manifest, null, 2) + '\n');
    return { backupDir: resolvedTarget, projectsCount: allProjects.length, docsCount };
  });
}

async function listBackupMarkdownFiles(projectsRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in backup archive');
      const rel = `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, rel);
      else if (entry.isFile()) out.push(rel);
    }
  }
  await walk(projectsRoot, 'projects');
  return out;
}

export async function restoreWorkspace(
  backupDir: string,
  options?: { force?: boolean }
): Promise<{ restoredProjects: number; restoredDocs: number }> {
  if (await isWorkspaceLocked()) {
    throw new ConflictError('Cannot restore while another LocalAtlas process is active');
  }

  const resolvedBackup = await canonicalizePath(backupDir);
  const canonicalHome = await canonicalizePath(home());
  if (pathsOverlap(resolvedBackup, canonicalHome)) {
    throw new Error('Backup directory cannot overlap with LOCALATLAS_HOME');
  }

  const manifestPath = join(resolvedBackup, 'manifest.json');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest;
  } catch {
    throw new Error('Invalid or missing backup manifest.json');
  }
  if (
    !manifest ||
    manifest.version !== 1 ||
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    typeof manifest.files['atlas.db'] !== 'string'
  ) {
    throw new Error('Invalid backup manifest format');
  }

  const manifestKeys = Object.keys(manifest.files);
  for (const relKey of manifestKeys) {
    if (relKey !== 'atlas.db') {
      const m = /^projects\/([0-9a-f-]{36})\/docs\/(.+)$/i.exec(relKey);
      if (!m || !UUID_RE.test(m[1])) {
        throw new Error(`Invalid file entry in backup manifest: "${relKey}"`);
      }
      normalizeDocName(m[2]);
    }
    await assertNoSymlinkChain(resolvedBackup, join(resolvedBackup, ...relKey.split('/')));
    const fullPath = join(resolvedBackup, ...relKey.split('/'));
    let actualHash: string;
    try {
      actualHash = await sha256File(fullPath);
    } catch {
      throw new Error(`Missing file in backup: "${relKey}"`);
    }
    if (actualHash !== manifest.files[relKey]) {
      throw new Error(`Checksum mismatch in backup for "${relKey}"`);
    }
  }

  // Ensure no extra unlisted files were injected under projects/
  const onDiskFiles = await listBackupMarkdownFiles(join(resolvedBackup, 'projects'));
  for (const diskRel of onDiskFiles) {
    if (!(diskRel in manifest.files)) {
      throw new Error(`Unexpected file in backup not listed in manifest: "${diskRel}"`);
    }
  }

  const targetHome = home();
  let homeHasContent = false;
  try {
    const entries = (await readdir(targetHome)).filter(e => e !== '.localatlas.lock' && e !== '.localatlas.server.lock');
    homeHasContent = entries.length > 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (homeHasContent && !options?.force) {
    throw new ConflictError('LOCALATLAS_HOME is not empty; pass --force to overwrite');
  }

  const stagingDir = `${targetHome}.restore-${randomUUID()}`;
  const oldBackupDir = `${targetHome}.prev-${randomUUID()}`;
  await mkdir(stagingDir, { recursive: true, mode: 0o700 });
  try {
    for (const relKey of manifestKeys) {
      const src = join(resolvedBackup, ...relKey.split('/'));
      const dest = join(stagingDir, ...relKey.split('/'));
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
    }

    // Update managed_path inside restored atlas.db to match targetHome and verify DB
    const stagedDbPath = join(stagingDir, 'atlas.db');
    try { await chmod(stagedDbPath, 0o600); } catch { /* ignore */ }
    const stagedDb = new DatabaseSync(stagedDbPath);
    let restoredProjects = 0;
    try {
      const rows = stagedDb.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;
      const updateStmt = stagedDb.prepare('UPDATE projects SET managed_path = ? WHERE id = ?');
      for (const r of rows) {
        if (!UUID_RE.test(r.id)) throw new Error('Invalid project id in backup database');
        updateStmt.run(join(targetHome, 'projects', r.id), r.id);
        await mkdir(join(stagingDir, 'projects', r.id, 'docs'), { recursive: true });
      }
      restoredProjects = rows.length;
    } finally {
      stagedDb.close();
    }
    // Remove any WAL/SHM artifacts created while inspecting staged DB before swap
    await unlink(stagedDbPath + '-wal').catch(() => {});
    await unlink(stagedDbPath + '-shm').catch(() => {});

    let movedOld = false;
    try {
      await lstat(targetHome);
      await rename(targetHome, oldBackupDir);
      movedOld = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }

    try {
      await rename(stagingDir, targetHome);
    } catch (e) {
      if (movedOld) {
        await rename(oldBackupDir, targetHome).catch(() => {});
      }
      throw e;
    }

    if (movedOld) {
      await rm(oldBackupDir, { recursive: true, force: true });
    }
    return { restoredProjects, restoredDocs: manifestKeys.length - 1 };
  } catch (e) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}
