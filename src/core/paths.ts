import { homedir } from 'node:os';
import { resolve, join, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { realpath, lstat, mkdir, chmod, readdir } from 'node:fs/promises';
import { Project } from './types.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KEY_RE = /^[A-Z][A-Z0-9]{1,4}$/;
export const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export const home = () =>
  process.env.LOCALATLAS_HOME ? resolve(process.env.LOCALATLAS_HOME) : join(homedir(), '.localatlas');

export const dbPath = () => join(home(), 'atlas.db');
export const legacyRegistryPath = () => join(home(), 'projects.json');
export const lockFilePath = () => join(home(), '.localatlas.lock');
export const serverLockPath = () => join(home(), '.localatlas.server.lock');

export function stripQuotes(etag: string): string {
  const trimmed = etag.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
    ? trimmed.slice(1, -1)
    : trimmed;
}

export async function canonicalizePath(input: string): Promise<string> {
  const target = resolve(input);
  const tail: string[] = [];
  let current = target;
  while (true) {
    try {
      const resolved = await realpath(current);
      return tail.length ? join(resolved, ...tail.reverse()) : resolved;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      const parent = dirname(current);
      if (parent === current) return target;
      tail.push(basename(current));
      current = parent;
    }
  }
}

export function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}

export async function ensureHomeDir(): Promise<string> {
  const h = home();
  try {
    const s = await lstat(h);
    if (s.isSymbolicLink()) throw new Error('Symlinks are not allowed for LOCALATLAS_HOME');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await mkdir(h, { recursive: true, mode: 0o700 });
  try { await chmod(h, 0o700); } catch { /* ignore on platforms without chmod */ }
  return h;
}

export function validateProjectPaths(project: { id: string; managedPath: string }): void {
  const expected = join(home(), 'projects', project.id);
  if (resolve(project.managedPath) !== resolve(expected)) {
    throw new Error('Invalid project managedPath: does not match home directory');
  }
}

export async function assertNoSymlinkChain(basePath: string, targetPath: string): Promise<void> {
  const baseResolved = resolve(basePath);
  const targetResolved = resolve(targetPath);
  const rel = relative(baseResolved, targetResolved);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error('Invalid document path');
  }
  const segments = rel ? rel.split(sep) : [];
  let current = baseResolved;
  for (const seg of ['', ...segments]) {
    current = seg ? join(current, seg) : current;
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink()) throw new Error('Symlinks are not allowed in managed documents');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}

export function normalizeDocName(name: string): string {
  if (
    !name ||
    isAbsolute(name) ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.includes('//') ||
    /^[a-zA-Z]:/.test(name)
  ) {
    throw new Error('Invalid document path');
  }
  const segments = name.split('/');
  for (const seg of segments) {
    if (
      !seg ||
      seg === '.' ||
      seg === '..' ||
      seg.endsWith('.') ||
      seg.endsWith(' ') ||
      WINDOWS_RESERVED_RE.test(seg)
    ) {
      throw new Error('Invalid document path');
    }
  }
  const last = segments[segments.length - 1];
  if (!last.endsWith('.md') || last.length <= 3) {
    throw new Error('Invalid document path');
  }
  return segments.join('/');
}

export async function documentPath(project: Project, name: string): Promise<string> {
  validateProjectPaths(project);
  const normalized = normalizeDocName(name);
  const root = join(project.managedPath, 'docs');
  const segments = normalized.split('/');
  const target = join(root, ...segments);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !target.endsWith('.md')) {
    throw new Error('Invalid document path');
  }

  // Verify no symlinks from LOCALATLAS_HOME through projects/<id>/docs
  await assertNoSymlinkChain(home(), root);

  // Check each segment under docs/ for symlinks and case-insensitive collisions
  let current = root;
  for (const segment of segments) {
    try {
      const entries = await readdir(current);
      const lower = segment.toLowerCase();
      const collision = entries.find(e => e !== segment && e.toLowerCase() === lower);
      if (collision) {
        throw new Error(`Invalid document path: case collision with existing "${collision}"`);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    current = join(current, segment);
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink()) throw new Error('Symlinks are not allowed in managed documents');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return target;
}
