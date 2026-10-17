import { lstat, readdir, realpath, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { Project } from './types.js';
import { ValidationError } from './errors.js';

export type SourceDocumentInfo = {
  path: string;
  sizeBytes: number;
  updatedAt: string;
};

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.cache', 'vendor']);
const MAX_DOCUMENTS = 500;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_DEPTH = 12;

async function sourceRoot(project: Project): Promise<string> {
  const root = resolve(project.sourcePath);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ValidationError('Imported project directory is no longer available');
  }
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== root) {
    throw new ValidationError('Imported project directory changed after import');
  }
  return canonicalRoot;
}

export async function listProjectSourceDocs(project: Project): Promise<SourceDocumentInfo[]> {
  const root = await sourceRoot(project);
  const docs: SourceDocumentInfo[] = [];

  async function walk(directory: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || docs.length >= MAX_DOCUMENTS) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      if (docs.length >= MAX_DOCUMENTS) break;
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(fullPath, relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      const fileStat = await lstat(fullPath).catch(() => null);
      if (!fileStat?.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_DOCUMENT_BYTES) continue;
      const resolvedPath = await realpath(fullPath).catch(() => null);
      if (!resolvedPath || !resolvedPath.startsWith(`${root}${sep}`)) continue;
      docs.push({ path: relativePath, sizeBytes: fileStat.size, updatedAt: fileStat.mtime.toISOString() });
    }
  }

  await walk(root, '', 0);
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readProjectSourceDoc(project: Project, sourceDocPath: string): Promise<string> {
  if (!sourceDocPath || sourceDocPath.startsWith('/') || sourceDocPath.includes('\\') || /[\u0000-\u001f]/.test(sourceDocPath)) {
    throw new ValidationError('Invalid repository document path');
  }
  const segments = sourceDocPath.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new ValidationError('Invalid repository document path');
  }
  if (!MARKDOWN_EXTENSIONS.has(extname(segments.at(-1) ?? '').toLowerCase())) {
    throw new ValidationError('Only Markdown repository documents can be opened');
  }

  const root = await sourceRoot(project);
  let currentPath = root;
  for (const [index, segment] of segments.entries()) {
    currentPath = join(currentPath, segment);
    const currentStat = await lstat(currentPath);
    if (currentStat.isSymbolicLink()) throw new ValidationError('Repository symlinks cannot be opened as documents');
    if (index < segments.length - 1 && !currentStat.isDirectory()) {
      throw new ValidationError('Invalid repository document path');
    }
    if (index === segments.length - 1 && !currentStat.isFile()) {
      throw new ValidationError('Repository document not found');
    }
  }

  const fileStat = await lstat(currentPath);
  if (fileStat.size > MAX_DOCUMENT_BYTES) throw new ValidationError('Repository document is too large to preview');
  const resolvedPath = await realpath(currentPath);
  const fromRoot = relative(root, resolvedPath);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..') {
    throw new ValidationError('Repository document path is outside the imported project');
  }
  return readFile(currentPath, 'utf8');
}
