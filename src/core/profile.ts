import { randomUUID } from 'node:crypto';
import type { Project } from './types.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { listDocs, readDocWithMeta, resolveDocSelector, writeDoc } from './documents.js';
import { deriveDocTitle, parseDocument, serializeDocument } from './markdown.js';

export type ProjectProfileStatus = 'active' | 'on_track' | 'paused' | 'at_risk' | 'completed' | 'archived';

export const VALID_PROFILE_STATUSES = new Set<ProjectProfileStatus>([
  'active',
  'on_track',
  'paused',
  'at_risk',
  'completed',
  'archived',
]);

export type ProjectDecisionEntry = {
  id: string;
  date: string;
  summary: string;
  rationale: string;
  links: string[];
};

export type ProjectProfileRecord = {
  projectId: string;
  path: string;
  status: ProjectProfileStatus;
  goals: string;
  keyDocs: string[];
  decisions: ProjectDecisionEntry[];
  history: string[];
  updatedAt: string;
  etag: string | null;
};

const PROFILE_PATH = 'project/profile.md';

function extractSection(body: string, heading: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
  return lines.slice(start + 1, end).join('\n').trim();
}

function replaceSection(body: string, heading: string, value: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  const content = value.trim();
  if (start < 0) {
    return `${body.trimEnd()}\n\n## ${heading}\n${content ? `${content}\n` : ''}`;
  }
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
  const replacement = content ? [content] : [];
  lines.splice(start + 1, end - start - 1, ...replacement);
  return lines.join('\n');
}

function parseDecisionsSection(raw: string): ProjectDecisionEntry[] {
  if (!raw.trim()) return [];
  const entries: ProjectDecisionEntry[] = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- [')) continue;
    // Format: - [DEC-ID] YYYY-MM-DD: Summary — Rationale (links: [[A]], [[B]])
    const match = /^-\s+\[([^\]]+)\]\s+(\S+):\s+(.+)$/.exec(trimmed);
    if (!match) continue;
    const [, id, date, rest] = match;
    let mainPart = rest;
    const links: string[] = [];
    const linksMatch = /\s+\(links:\s*(.+)\)$/.exec(rest);
    if (linksMatch) {
      mainPart = rest.slice(0, linksMatch.index).trim();
      const rawLinks = linksMatch[1];
      for (const linkMatch of rawLinks.matchAll(/\[\[([^\]]+)\]\]/g)) {
        links.push(linkMatch[1].trim());
      }
    }
    const rationaleSplit = mainPart.indexOf(' — ');
    const summary = rationaleSplit >= 0 ? mainPart.slice(0, rationaleSplit).trim() : mainPart.trim();
    const rationale = rationaleSplit >= 0 ? mainPart.slice(rationaleSplit + 3).trim() : '';
    entries.push({ id, date, summary, rationale, links });
  }
  return entries;
}

function serializeDecisionsSection(entries: ProjectDecisionEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map(entry => {
      const rationalePart = entry.rationale ? ` — ${entry.rationale}` : '';
      const linksPart = entry.links.length > 0
        ? ` (links: ${entry.links.map(l => `[[${l}]]`).join(', ')})`
        : '';
      return `- [${entry.id}] ${entry.date}: ${entry.summary}${rationalePart}${linksPart}`;
    })
    .join('\n');
}

function normalizeStringList(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(arr.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean))];
}

function parseProfileFromDoc(p: Project, content: string, etag: string): ProjectProfileRecord {
  const parsed = parseDocument(content);
  const fm = parsed.frontmatter;
  const rawStatus = typeof fm.status === 'string' && VALID_PROFILE_STATUSES.has(fm.status as ProjectProfileStatus)
    ? (fm.status as ProjectProfileStatus)
    : 'active';
  const keyDocs = normalizeStringList(fm.keyDocs);
  const goals = extractSection(parsed.body, 'Goals');
  const decisionsRaw = extractSection(parsed.body, 'Approved decisions');
  const historyRaw = extractSection(parsed.body, 'History');
  const history = historyRaw
    ? historyRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    : [];
  return {
    projectId: p.id,
    path: PROFILE_PATH,
    status: rawStatus,
    goals,
    keyDocs,
    decisions: parseDecisionsSection(decisionsRaw),
    history,
    updatedAt: typeof fm.updatedAt === 'string' ? fm.updatedAt : '',
    etag,
  };
}

function isMissingFileError(err: unknown): boolean {
  return err instanceof NotFoundError || (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function readProjectProfile(p: Project): Promise<ProjectProfileRecord> {
  try {
    const doc = await readDocWithMeta(p, PROFILE_PATH);
    return parseProfileFromDoc(p, doc.content, doc.etag);
  } catch (err) {
    if (isMissingFileError(err)) {
      return {
        projectId: p.id,
        path: PROFILE_PATH,
        status: 'active',
        goals: '',
        keyDocs: [],
        decisions: [],
        history: [],
        updatedAt: '',
        etag: null,
      };
    }
    throw err;
  }
}

async function validateKeyDocs(p: Project, keyDocs: string[]): Promise<string[]> {
  const available = new Set(await listDocs(p));
  const resolved: string[] = [];
  for (const ref of keyDocs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    try {
      const docPath = await resolveDocSelector(p, trimmed);
      if (!available.has(docPath)) {
        throw new ValidationError(`Key document "${trimmed}" does not exist in project ${p.key}`);
      }
      if (!resolved.includes(docPath)) resolved.push(docPath);
    } catch (e) {
      if (e instanceof ValidationError) throw e;
      throw new ValidationError(`Key document "${trimmed}" does not exist in project ${p.key}`);
    }
  }
  return resolved;
}

export async function updateProjectProfile(
  p: Project,
  patch: {
    status?: ProjectProfileStatus;
    goals?: string;
    keyDocs?: string[];
    ifMatch?: string;
  }
): Promise<ProjectProfileRecord> {
  if (patch.status !== undefined && !VALID_PROFILE_STATUSES.has(patch.status)) {
    throw new ValidationError(`Invalid project profile status: "${patch.status}"`);
  }

  let existingDoc: { content: string; etag: string } | null = null;
  try {
    existingDoc = await readDocWithMeta(p, PROFILE_PATH);
  } catch (err) {
    if (!isMissingFileError(err)) throw err;
  }

  if (existingDoc && patch.ifMatch !== undefined && patch.ifMatch !== existingDoc.etag) {
    throw new ConflictError('Profile ETag mismatch', existingDoc.etag);
  }

  const current = existingDoc
    ? parseProfileFromDoc(p, existingDoc.content, existingDoc.etag)
    : await readProjectProfile(p);

  const status = patch.status ?? current.status;
  const goals = patch.goals !== undefined ? patch.goals.trim() : current.goals;
  const keyDocs = patch.keyDocs !== undefined ? await validateKeyDocs(p, patch.keyDocs) : current.keyDocs;

  const now = new Date().toISOString();
  const changes: string[] = [];
  if (patch.status !== undefined && patch.status !== current.status) changes.push(`status → ${status}`);
  if (patch.goals !== undefined && goals !== current.goals) changes.push('updated goals');
  if (patch.keyDocs !== undefined && JSON.stringify(keyDocs) !== JSON.stringify(current.keyDocs)) {
    changes.push(`keyDocs (${keyDocs.length})`);
  }
  if (!existingDoc && changes.length === 0) {
    changes.push('initialized project profile');
  }

  const history = [...current.history];
  if (changes.length > 0) {
    history.push(`- ${now}: ${changes.join(', ')}`);
  }

  // Approved decisions are strictly preserved intact on profile updates.
  const decisionsSection = serializeDecisionsSection(current.decisions);
  const historySection = history.join('\n');

  let body: string;
  if (existingDoc) {
    const parsed = parseDocument(existingDoc.content);
    body = parsed.body;
    body = replaceSection(body, 'Goals', goals);
    body = replaceSection(body, 'Approved decisions', decisionsSection);
    body = replaceSection(body, 'History', historySection);
  } else {
    body = [
      `# Project Profile: ${p.name}`,
      '',
      '## Goals',
      goals,
      '',
      '## Approved decisions',
      decisionsSection,
      '',
      '## History',
      historySection,
      '',
    ].join('\n');
  }

  const frontmatter: Record<string, string | string[]> = {
    id: `${p.key}-PROFILE`,
    type: 'project_profile',
    status,
    updatedAt: now,
  };
  const keyOrder = ['id', 'type', 'status'];
  if (keyDocs.length > 0) {
    frontmatter.keyDocs = keyDocs;
    keyOrder.push('keyDocs');
  }
  keyOrder.push('updatedAt');

  const content = serializeDocument(frontmatter, keyOrder, body);
  const saved = await writeDoc(p, PROFILE_PATH, content, {
    ifMatch: existingDoc ? (patch.ifMatch ?? existingDoc.etag) : undefined,
    createOnly: !existingDoc,
  });

  return parseProfileFromDoc(p, content, saved.etag);
}

export async function recordProjectDecision(
  p: Project,
  input: {
    summary: string;
    rationale?: string;
    links?: string[];
    ifMatch?: string;
  }
): Promise<{ profile: ProjectProfileRecord; decision: ProjectDecisionEntry }> {
  const summary = (input.summary || '').trim().replace(/\r?\n+/g, ' ');
  if (!summary) throw new ValidationError('Decision summary cannot be empty');
  const rationale = (input.rationale || '').trim().replace(/\r?\n+/g, ' ');

  let existingDoc: { content: string; etag: string } | null = null;
  try {
    existingDoc = await readDocWithMeta(p, PROFILE_PATH);
  } catch (err) {
    if (!isMissingFileError(err)) throw err;
  }

  if (existingDoc && input.ifMatch !== undefined && input.ifMatch !== existingDoc.etag) {
    throw new ConflictError('Profile ETag mismatch', existingDoc.etag);
  }

  const current = existingDoc
    ? parseProfileFromDoc(p, existingDoc.content, existingDoc.etag)
    : await readProjectProfile(p);

  const links = input.links ? await validateKeyDocs(p, input.links) : [];
  const now = new Date().toISOString();
  const nextIdx = current.decisions.length + 1;
  const decision: ProjectDecisionEntry = {
    id: `DEC-${String(nextIdx).padStart(3, '0')}`,
    date: now.slice(0, 10),
    summary,
    rationale,
    links,
  };

  // Append-only: all existing approved decisions remain untouched
  const decisions = [...current.decisions, decision];
  const history = [...current.history, `- ${now}: approved decision ${decision.id} (${summary})`];

  const decisionsSection = serializeDecisionsSection(decisions);
  const historySection = history.join('\n');

  let body: string;
  if (existingDoc) {
    const parsed = parseDocument(existingDoc.content);
    body = parsed.body;
    body = replaceSection(body, 'Goals', current.goals);
    body = replaceSection(body, 'Approved decisions', decisionsSection);
    body = replaceSection(body, 'History', historySection);
  } else {
    body = [
      `# Project Profile: ${p.name}`,
      '',
      '## Goals',
      current.goals,
      '',
      '## Approved decisions',
      decisionsSection,
      '',
      '## History',
      historySection,
      '',
    ].join('\n');
  }

  const frontmatter: Record<string, string | string[]> = {
    id: `${p.key}-PROFILE`,
    type: 'project_profile',
    status: current.status,
    updatedAt: now,
  };
  const keyOrder = ['id', 'type', 'status'];
  if (current.keyDocs.length > 0) {
    frontmatter.keyDocs = current.keyDocs;
    keyOrder.push('keyDocs');
  }
  keyOrder.push('updatedAt');

  const content = serializeDocument(frontmatter, keyOrder, body);
  const saved = await writeDoc(p, PROFILE_PATH, content, {
    ifMatch: existingDoc ? (input.ifMatch ?? existingDoc.etag) : undefined,
    createOnly: !existingDoc,
  });

  return {
    profile: parseProfileFromDoc(p, content, saved.etag),
    decision,
  };
}
