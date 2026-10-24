import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project } from './types.js';
import { NotFoundError, ValidationError } from './errors.js';
import { assertNoSymlinkChain, home, normalizeDocName, validateProjectPaths } from './paths.js';
import { atomicWrite, withWorkspaceLock } from './lock.js';

export type DocumentDraft = {
  path: string;
  content: string;
  baseEtag: string | null;
  isNewDoc: boolean;
  savedAt: string;
};

function draftPath(project: Project, docPath: string): string {
  validateProjectPaths(project);
  try { docPath = normalizeDocName(docPath); } catch { throw new ValidationError('Invalid draft document path'); }
  const name = createHash('sha256').update(docPath).digest('hex') + '.json';
  return join(project.managedPath, '.localatlas', 'drafts', name);
}

export async function readDocumentDraft(project: Project, docPath: string): Promise<DocumentDraft | null> {
  const path = draftPath(project, docPath);
  await assertNoSymlinkChain(home(), path);
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as DocumentDraft;
    return value.path === docPath && typeof value.content === 'string' ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeDocumentDraft(
  project: Project,
  docPath: string,
  input: { content: string; baseEtag?: string | null; isNewDoc?: boolean }
): Promise<DocumentDraft> {
  if (typeof input.content !== 'string') throw new ValidationError('Draft content must be text');
  if (Buffer.byteLength(input.content, 'utf8') > 2 * 1024 * 1024) {
    throw new ValidationError('Draft exceeds the 2 MiB limit');
  }
  const path = draftPath(project, docPath);
  const directory = join(project.managedPath, '.localatlas', 'drafts');
  await assertNoSymlinkChain(home(), directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertNoSymlinkChain(home(), path);
  const draft: DocumentDraft = {
    path: docPath,
    content: input.content,
    baseEtag: typeof input.baseEtag === 'string' ? input.baseEtag : null,
    isNewDoc: Boolean(input.isNewDoc),
    savedAt: new Date().toISOString(),
  };
  await withWorkspaceLock(async () => atomicWrite(path, JSON.stringify(draft)));
  return draft;
}

export async function deleteDocumentDraft(project: Project, docPath: string): Promise<void> {
  const path = draftPath(project, docPath);
  await assertNoSymlinkChain(home(), path);
  await withWorkspaceLock(async () => unlink(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }));
}
