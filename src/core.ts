import { mkdir, readFile, writeFile, rename, realpath, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export type Project = { id: string; name: string; sourcePath: string; managedPath: string; createdAt: string };
export const home = () => process.env.LOCALATLAS_HOME ? resolve(process.env.LOCALATLAS_HOME) : join(homedir(), '.localatlas');
const registryPath = () => join(home(), 'projects.json');
async function atomicWrite(path: string, value: string) {
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, value, { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}
export async function projects(): Promise<Project[]> {
  try { return JSON.parse(await readFile(registryPath(), 'utf8')) as Project[]; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}
export async function importProject(input: string): Promise<Project> {
  const sourcePath = await realpath(resolve(input));
  if (!(await stat(sourcePath)).isDirectory()) throw new Error('Not a directory');
  const all = await projects();
  const existing = all.find(p => p.sourcePath === sourcePath);
  if (existing) return existing;
  const id = randomUUID();
  const project: Project = { id, name: sourcePath.split(sep).filter(Boolean).at(-1) ?? 'project', sourcePath, managedPath: join(home(), 'projects', id), createdAt: new Date().toISOString() };
  await mkdir(join(project.managedPath, 'docs'), { recursive: true });
  await mkdir(home(), { recursive: true });
  await atomicWrite(registryPath(), JSON.stringify([...all, project], null, 2) + '\n');
  return project;
}
export async function selectProject(selector?: string, cwd = process.cwd()): Promise<Project> {
  const all = await projects();
  const project = selector ? all.find(p => p.id === selector || p.name === selector) :
    all.filter(p => cwd === p.sourcePath || cwd.startsWith(p.sourcePath + sep)).sort((a,b) => b.sourcePath.length - a.sourcePath.length)[0];
  if (!project) throw new Error('Project not found; run localatlas import <path> or pass --project <id>');
  return project;
}
export async function documentPath(project: Project, name: string): Promise<string> {
  if (!name || isAbsolute(name) || name.includes('\\')) throw new Error('Invalid document path');
  const root = join(project.managedPath, 'docs');
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !target.endsWith('.md')) throw new Error('Invalid document path');
  // Reject symlinks in each existing path segment, including the target.
  let current = root;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    try { const s = await (await import('node:fs/promises')).lstat(current); if (s.isSymbolicLink()) throw new Error('Symlinks are not allowed in managed documents'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return target;
}
export async function listDocs(project: Project): Promise<string[]> {
  const root = join(project.managedPath, 'docs');
  async function walk(dir: string, prefix = ''): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) out.push(...await walk(join(dir, entry.name), name));
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(name);
    }
    return out;
  }
  return walk(root);
}
export async function readDoc(p: Project, name: string) { return readFile(await documentPath(p, name), 'utf8'); }
export async function writeDoc(p: Project, name: string, content: string) {
  const path = await documentPath(p, name);
  await mkdir(resolve(path, '..'), { recursive: true });
  await atomicWrite(path, content);
}
