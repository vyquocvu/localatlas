import { isAbsolute, join, resolve } from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { Project } from './types.js';
import { parseDocument, serializeDocument } from './markdown.js';
import { atomicWrite } from './lock.js';
import {
  assertNoSymlinkChain,
  canonicalizePath,
  home,
  pathsOverlap,
  UUID_RE,
  validateProjectPaths,
} from './paths.js';

export const PROJECT_MANIFEST_NAME = 'project.md';
export const PROJECT_AGENT_INSTRUCTIONS_NAME = 'AGENTS.md';

export type ProjectManifest = Pick<Project, 'id' | 'sourcePath'>;

export function projectManifestPath(project: Pick<Project, 'managedPath'>): string {
  return join(project.managedPath, PROJECT_MANIFEST_NAME);
}

export function projectAgentInstructionsPath(project: Pick<Project, 'managedPath'>): string {
  return join(project.managedPath, PROJECT_AGENT_INSTRUCTIONS_NAME);
}

export async function ensureProjectAgentInstructions(project: Project): Promise<void> {
  validateProjectPaths(project);
  await assertNoSymlinkChain(home(), project.managedPath);
  await mkdir(project.managedPath, { recursive: true, mode: 0o700 });
  const path = projectAgentInstructionsPath(project);
  await assertNoSymlinkChain(home(), path);
  const instructions = [
    '# LocalAtlas project workspace instructions',
    '',
    'This directory is the LocalAtlas workspace for this project. The source repository is separate.',
    '',
    '- Read project.md and use its sourcePath as the absolute path to the source repository. Do not change the link unless the user asks to relink the project.',
    '- For source code work, inspect AGENTS.md files inside sourcePath and the relevant subdirectories, then follow those repository instructions. Make source changes under sourcePath; use absolute paths when needed.',
    '- If .codex/skills/ or skills/ exists, use only the skill that matches the requested workflow. If agents/ contains a role guide selected for this work, read and follow that guide.',
    '- Keep LocalAtlas notes, tasks, and project documents under docs/. Do not copy source files into this workspace.',
    '- Keep source changes and LocalAtlas-managed documents separate. Do not write to the source repository as a side effect of reading or importing it.',
    "- Use the source repository's own Git history and tools for code work. Never change branches, create commits, or discard user changes unless the user asks.",
    '',
  ].join('\n');
  try {
    await writeFile(path, instructions, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

function requireManifestString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Invalid ' + PROJECT_MANIFEST_NAME + ': "' + field + '" must be a non-empty string');
  }
  return value;
}

async function validateManifest(manifest: ProjectManifest, expectedId?: string): Promise<ProjectManifest> {
  if (!UUID_RE.test(manifest.id) || (expectedId && manifest.id !== expectedId)) {
    throw new Error('Invalid ' + PROJECT_MANIFEST_NAME + ': project id does not match its folder');
  }
  if (!isAbsolute(manifest.sourcePath) || resolve(manifest.sourcePath) !== manifest.sourcePath) {
    throw new Error('Invalid ' + PROJECT_MANIFEST_NAME + ': sourcePath must be a normalized absolute path');
  }
  const canonicalHome = await canonicalizePath(home());
  if (pathsOverlap(manifest.sourcePath, canonicalHome)) {
    throw new Error('Invalid ' + PROJECT_MANIFEST_NAME + ': sourcePath cannot overlap with LOCALATLAS_HOME');
  }
  const canonicalSource = await canonicalizePath(manifest.sourcePath);
  if (canonicalSource !== manifest.sourcePath) {
    throw new Error('Invalid ' + PROJECT_MANIFEST_NAME + ': sourcePath must not contain symlinked path segments');
  }
  try {
    if (!(await stat(manifest.sourcePath)).isDirectory()) {
      throw new Error('Invalid ' + PROJECT_MANIFEST_NAME + ': sourcePath must point to a directory');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return manifest;
}

export async function readProjectManifest(project: Project): Promise<ProjectManifest | null> {
  validateProjectPaths(project);
  const path = projectManifestPath(project);
  await assertNoSymlinkChain(home(), path);

  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const parsed = parseDocument(content);
  if (!parsed.hasFrontmatter || parsed.malformedFrontmatter) {
    throw new Error('Invalid ' + PROJECT_MANIFEST_NAME + ': ' + (parsed.parseWarning ?? 'frontmatter is required'));
  }
  const frontmatter = parsed.frontmatter;
  if (frontmatter.type !== 'localatlas_project' || frontmatter.schemaVersion !== '1') {
    throw new Error('Unsupported ' + PROJECT_MANIFEST_NAME + ' format');
  }

  const manifest: ProjectManifest = {
    id: requireManifestString(frontmatter.id, 'id'),
    sourcePath: requireManifestString(frontmatter.sourcePath, 'sourcePath'),
  };
  return validateManifest(manifest, project.id);
}

export async function writeProjectManifest(project: Project): Promise<void> {
  validateProjectPaths(project);
  const manifest = await validateManifest({
    id: project.id,
    sourcePath: project.sourcePath,
  }, project.id);

  await assertNoSymlinkChain(home(), project.managedPath);
  await mkdir(project.managedPath, { recursive: true, mode: 0o700 });
  const path = projectManifestPath(project);
  await assertNoSymlinkChain(home(), path);
  const frontmatter: Record<string, string> = {
    type: 'localatlas_project',
    schemaVersion: '1',
    id: manifest.id,
    sourcePath: manifest.sourcePath,
  };
  const content = serializeDocument(frontmatter, Object.keys(frontmatter), '# LocalAtlas project\n');
  await atomicWrite(path, content);
  await ensureProjectAgentInstructions(project);
}
