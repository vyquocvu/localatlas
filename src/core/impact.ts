import { randomUUID } from 'node:crypto';
import type { Project, TaskPriority, TaskRecord, TaskStatus } from './types.js';
import { VALID_TASK_PRIORITIES, VALID_TASK_STATUSES } from './types.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { listDocs, readDocWithMeta, resolveDocSelector, writeDoc } from './documents.js';
import { deriveDocTitle, parseDocument, serializeDocument, countMarkdownChecklists } from './markdown.js';
import { listTasks, getProjectRollup, normalizeTaskDependencies, validateTaskDependencies } from './tasks.js';

export type TaskChangeProposalStatus = 'pending' | 'confirmed' | 'rejected';

export type ProposedTaskChange = {
  title?: string;
  body?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  epic?: string | null;
  milestone?: string | null;
  dependsOn?: string[];
};

export type TaskImpactSummary = {
  changedFields: Array<{ field: string; before: unknown; after: unknown }>;
  affectedDownstreamTasks: Array<{ id: string; title: string; status: TaskStatus; path: string }>;
  addedDependencies: string[];
  removedDependencies: string[];
  unresolvedDependencies: string[];
  rollupImpact: string[];
  warnings: string[];
};

export type TaskChangeProposalRecord = {
  id: string;
  projectId: string;
  taskId: string;
  taskPath: string;
  path: string;
  status: TaskChangeProposalStatus;
  baseTaskEtag: string;
  proposed: ProposedTaskChange;
  impact: TaskImpactSummary;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  etag: string;
};

function normalizeDependsOn(value: unknown): string[] {
  return normalizeTaskDependencies(value);
}

function detectCycle(
  startId: string,
  nextDeps: string[],
  depsByTaskId: Map<string, string[]>
): boolean {
  const visited = new Set<string>();
  const stack = [...nextDeps];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === startId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const children = depsByTaskId.get(current) ?? [];
    for (const child of children) {
      stack.push(child);
    }
  }
  return false;
}

export async function previewTaskImpact(
  p: Project,
  selector: string,
  proposed: ProposedTaskChange
): Promise<{
  task: TaskRecord & { dependsOn: string[]; body: string };
  baseTaskEtag: string;
  impact: TaskImpactSummary;
}> {
  if (proposed.status !== undefined && !VALID_TASK_STATUSES.has(proposed.status)) {
    throw new ValidationError(`Invalid task status: "${proposed.status}"`);
  }
  if (proposed.priority !== undefined && !VALID_TASK_PRIORITIES.has(proposed.priority)) {
    throw new ValidationError(`Invalid task priority: "${proposed.priority}"`);
  }
  if (proposed.title !== undefined && !proposed.title.trim()) {
    throw new ValidationError('Task title cannot be empty');
  }

  const taskPath = await resolveDocSelector(p, selector);
  const doc = await readDocWithMeta(p, taskPath);
  if (doc.frontmatter.type !== 'task') {
    throw new NotFoundError(`Task "${selector}" not found in project ${p.key}`);
  }
  const allTasks = await listTasks(p);
  const targetRecord = allTasks.find(t => t.path === taskPath);
  if (!targetRecord) {
    throw new NotFoundError(`Task "${selector}" not found in project ${p.key}`);
  }

  const parsed = parseDocument(doc.content);
  const rawCurrentDependsOn = normalizeDependsOn(parsed.frontmatter.dependsOn ?? parsed.frontmatter.dependencies);

  // Map all tasks and their dependencies in this project
  const taskById = new Map(allTasks.map(t => [t.id.toLocaleLowerCase(), t]));
  const currentDependsOn = rawCurrentDependsOn.map(id => taskById.get(id.toLocaleLowerCase())?.id ?? id);
  const depsByTaskId = new Map<string, string[]>();
  for (const t of allTasks) {
    try {
      const tDoc = t.path === taskPath ? doc : await readDocWithMeta(p, t.path);
      const tParsed = parseDocument(tDoc.content);
      depsByTaskId.set(t.id.toLocaleLowerCase(), normalizeDependsOn(tParsed.frontmatter.dependsOn ?? tParsed.frontmatter.dependencies).map(id => id.toLocaleLowerCase()));
    } catch {
      depsByTaskId.set(t.id, []);
    }
  }

  const changedFields: Array<{ field: string; before: unknown; after: unknown }> = [];
  if (proposed.title !== undefined && proposed.title.trim() !== targetRecord.title) {
    changedFields.push({ field: 'title', before: targetRecord.title, after: proposed.title.trim() });
  }
  if (proposed.body !== undefined && proposed.body.trim() !== parsed.body.trim()) {
    changedFields.push({ field: 'body', before: `${parsed.body.trim().length} chars`, after: `${proposed.body.trim().length} chars` });
  }
  if (proposed.status !== undefined && proposed.status !== targetRecord.status) {
    changedFields.push({ field: 'status', before: targetRecord.status, after: proposed.status });
  }
  if (proposed.priority !== undefined && proposed.priority !== targetRecord.priority) {
    changedFields.push({ field: 'priority', before: targetRecord.priority, after: proposed.priority });
  }
  if (proposed.epic !== undefined && (proposed.epic || null) !== targetRecord.epic) {
    changedFields.push({ field: 'epic', before: targetRecord.epic, after: proposed.epic || null });
  }
  if (proposed.milestone !== undefined && (proposed.milestone || null) !== targetRecord.milestone) {
    changedFields.push({ field: 'milestone', before: targetRecord.milestone, after: proposed.milestone || null });
  }

  const nextDependsOn = proposed.dependsOn !== undefined
    ? normalizeDependsOn(proposed.dependsOn).map(id => taskById.get(id.toLocaleLowerCase())?.id ?? id)
    : currentDependsOn;

  if (proposed.dependsOn !== undefined && JSON.stringify(nextDependsOn) !== JSON.stringify(currentDependsOn)) {
    changedFields.push({ field: 'dependsOn', before: currentDependsOn, after: nextDependsOn });
  }

  const addedDependencies = nextDependsOn.filter(d => !currentDependsOn.includes(d));
  const removedDependencies = currentDependsOn.filter(d => !nextDependsOn.includes(d));
  const unresolvedDependencies = nextDependsOn.filter(d => !taskById.has(d.toLocaleLowerCase()));

  // Find all downstream tasks that directly or transitively depend on targetRecord.id
  const affectedDownstreamIds = new Set<string>();
  const queue = [targetRecord.id.toLocaleLowerCase()];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const [candidateId, candidateDeps] of depsByTaskId.entries()) {
      if (candidateDeps.includes(curr) && !affectedDownstreamIds.has(candidateId)) {
        affectedDownstreamIds.add(candidateId);
        queue.push(candidateId);
      }
    }
  }

  const affectedDownstreamTasks = [...affectedDownstreamIds]
    .map(id => taskById.get(id.toLocaleLowerCase()))
    .filter((t): t is TaskRecord => Boolean(t))
    .map(t => ({ id: t.id, title: t.title, status: t.status, path: t.path }));

  const warnings: string[] = [];
  if (unresolvedDependencies.length > 0) {
    warnings.push(`Unresolved same-project dependencies: ${unresolvedDependencies.join(', ')}`);
  }
  if (detectCycle(targetRecord.id.toLocaleLowerCase(), nextDependsOn.map(id => id.toLocaleLowerCase()), depsByTaskId)) {
    warnings.push(`Dependency cycle detected involving ${targetRecord.id}`);
  }
  if (affectedDownstreamTasks.length > 0 && (proposed.priority || proposed.status || proposed.milestone || proposed.epic !== undefined || proposed.title || proposed.body)) {
    warnings.push(`${affectedDownstreamTasks.length} downstream task(s) depend on ${targetRecord.id}: ${affectedDownstreamTasks.map(t => t.id).join(', ')}`);
  }

  const rollup = await getProjectRollup(p);
  const rollupImpact: string[] = [];
  const beforeMilestone = targetRecord.milestone;
  const afterMilestone = proposed.milestone !== undefined ? (proposed.milestone || null) : beforeMilestone;
  if (beforeMilestone !== afterMilestone) {
    if (beforeMilestone) rollupImpact.push(`Removes task ${targetRecord.id} from milestone ${beforeMilestone}`);
    if (afterMilestone) {
      const knownMs = rollup.milestones.find(m => m.id === afterMilestone || m.title === afterMilestone);
      if (!knownMs) warnings.push(`Milestone "${afterMilestone}" does not exist in project ${p.key}`);
      rollupImpact.push(`Assigns task ${targetRecord.id} to milestone ${afterMilestone}`);
    }
  }
  const beforeEpic = targetRecord.epic;
  const afterEpic = proposed.epic !== undefined ? (proposed.epic || null) : beforeEpic;
  if (beforeEpic !== afterEpic) {
    if (beforeEpic) rollupImpact.push(`Removes task ${targetRecord.id} from epic ${beforeEpic}`);
    if (afterEpic) {
      const knownEp = rollup.epics.find(e => e.id === afterEpic || e.title === afterEpic);
      if (!knownEp) warnings.push(`Epic "${afterEpic}" does not exist in project ${p.key}`);
      rollupImpact.push(`Assigns task ${targetRecord.id} to epic ${afterEpic}`);
    }
  }
  if (proposed.status && proposed.status !== targetRecord.status) {
    if (afterMilestone) rollupImpact.push(`Updates milestone ${afterMilestone} completion counts (${targetRecord.status} → ${proposed.status})`);
    if (afterEpic) rollupImpact.push(`Updates epic ${afterEpic} completion counts (${targetRecord.status} → ${proposed.status})`);
  }

  return {
    task: {
      ...targetRecord,
      dependsOn: currentDependsOn,
      body: parsed.body,
    },
    baseTaskEtag: doc.etag,
    impact: {
      changedFields,
      affectedDownstreamTasks,
      addedDependencies,
      removedDependencies,
      unresolvedDependencies,
      rollupImpact,
      warnings,
    },
  };
}

function extractJsonBlock(body: string, heading: string): unknown {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (start < 0) return {};
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith('```')) i++;
  if (i >= lines.length) return {};
  i++;
  const jsonLines: string[] = [];
  while (i < lines.length && !lines[i].trim().startsWith('```')) {
    jsonLines.push(lines[i]);
    i++;
  }
  try {
    return JSON.parse(jsonLines.join('\n'));
  } catch {
    return {};
  }
}

function proposalFromDoc(p: Project, path: string, content: string, etag: string): TaskChangeProposalRecord {
  const parsed = parseDocument(content);
  if (parsed.frontmatter.type !== 'task_change_proposal') {
    throw new NotFoundError('Task change proposal not found in this project');
  }
  const fm = parsed.frontmatter;
  const status = (fm.status === 'confirmed' || fm.status === 'rejected' ? fm.status : 'pending') as TaskChangeProposalStatus;
  const proposed = extractJsonBlock(parsed.body, 'Proposed change') as ProposedTaskChange;
  const impact = extractJsonBlock(parsed.body, 'Impact data') as TaskImpactSummary;
  return {
    id: typeof fm.id === 'string' ? fm.id : path,
    projectId: p.id,
    taskId: typeof fm.task === 'string' ? fm.task : '',
    taskPath: typeof fm.taskPath === 'string' ? fm.taskPath : '',
    path,
    status,
    baseTaskEtag: typeof fm.baseTaskEtag === 'string' ? fm.baseTaskEtag : '',
    proposed,
    impact: {
      changedFields: impact?.changedFields ?? [],
      affectedDownstreamTasks: impact?.affectedDownstreamTasks ?? [],
      addedDependencies: impact?.addedDependencies ?? [],
      removedDependencies: impact?.removedDependencies ?? [],
      unresolvedDependencies: impact?.unresolvedDependencies ?? [],
      rollupImpact: impact?.rollupImpact ?? [],
      warnings: impact?.warnings ?? [],
    },
    createdAt: typeof fm.createdAt === 'string' ? fm.createdAt : '',
    updatedAt: typeof fm.updatedAt === 'string' ? fm.updatedAt : '',
    confirmedAt: typeof fm.confirmedAt === 'string' ? fm.confirmedAt : null,
    etag,
  };
}

export async function createTaskChangeProposal(
  p: Project,
  selector: string,
  proposed: ProposedTaskChange
): Promise<TaskChangeProposalRecord> {
  if (proposed.dependsOn !== undefined) {
    const targetPath = await resolveDocSelector(p, selector);
    const targetDoc = await readDocWithMeta(p, targetPath);
    const taskId = typeof targetDoc.frontmatter.id === 'string' ? targetDoc.frontmatter.id : selector;
    proposed = { ...proposed, dependsOn: await validateTaskDependencies(p, taskId, proposed.dependsOn) };
  }
  const preview = await previewTaskImpact(p, selector, proposed);
  if (preview.impact.changedFields.length === 0) {
    throw new ValidationError('Proposed task change does not modify any task fields');
  }

  const id = randomUUID();
  const path = `proposals/${id}.md`;
  const now = new Date().toISOString();

  const summaryBullets: string[] = [];
  for (const ch of preview.impact.changedFields) {
    summaryBullets.push(`- **${ch.field}**: \`${JSON.stringify(ch.before)}\` → \`${JSON.stringify(ch.after)}\``);
  }
  if (preview.impact.affectedDownstreamTasks.length > 0) {
    summaryBullets.push(
      `- **Downstream tasks affected (${preview.impact.affectedDownstreamTasks.length})**: ${preview.impact.affectedDownstreamTasks.map(t => `[[${t.id}]] (${t.title})`).join(', ')}`
    );
  }
  for (const r of preview.impact.rollupImpact) {
    summaryBullets.push(`- **Rollup**: ${r}`);
  }
  for (const w of preview.impact.warnings) {
    summaryBullets.push(`- **Warning**: ${w}`);
  }

  const body = [
    `# Impact Summary: ${preview.task.id} (${preview.task.title})`,
    '',
    '## Human review summary',
    ...summaryBullets,
    '',
    '## Proposed change',
    '```json',
    JSON.stringify(proposed, null, 2),
    '```',
    '',
    '## Impact data',
    '```json',
    JSON.stringify(preview.impact, null, 2),
    '```',
    '',
  ].join('\n');

  const frontmatter: Record<string, string> = {
    id,
    type: 'task_change_proposal',
    task: preview.task.id,
    taskPath: preview.task.path,
    status: 'pending',
    baseTaskEtag: preview.baseTaskEtag,
    createdAt: now,
    updatedAt: now,
  };
  const keyOrder = ['id', 'type', 'task', 'taskPath', 'status', 'baseTaskEtag', 'createdAt', 'updatedAt'];
  const content = serializeDocument(frontmatter, keyOrder, body);
  const saved = await writeDoc(p, path, content, { createOnly: true });
  return proposalFromDoc(p, path, content, saved.etag);
}

export async function listTaskChangeProposals(
  p: Project,
  filters?: { taskId?: string; status?: TaskChangeProposalStatus; docPaths?: string[] }
): Promise<TaskChangeProposalRecord[]> {
  const paths = (filters?.docPaths ?? await listDocs(p)).filter(docPath => docPath.startsWith('proposals/') && docPath.endsWith('.md'));
  const items: TaskChangeProposalRecord[] = [];
  for (const docPath of paths) {
    try {
      const doc = await readDocWithMeta(p, docPath);
      if (doc.frontmatter.type !== 'task_change_proposal') continue;
      const record = proposalFromDoc(p, docPath, doc.content, doc.etag);
      if (filters?.taskId && record.taskId !== filters.taskId) continue;
      if (filters?.status && record.status !== filters.status) continue;
      items.push(record);
    } catch {
      // skip invalid
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readTaskChangeProposal(p: Project, selector: string): Promise<TaskChangeProposalRecord> {
  let docPath: string;
  try {
    docPath = await resolveDocSelector(p, selector);
  } catch {
    throw new NotFoundError('Task change proposal not found in this project');
  }
  if (!docPath.startsWith('proposals/')) {
    throw new NotFoundError('Task change proposal not found in this project');
  }
  const doc = await readDocWithMeta(p, docPath);
  return proposalFromDoc(p, docPath, doc.content, doc.etag);
}

export async function confirmTaskChangeProposal(
  p: Project,
  proposalSelector: string,
  options?: { confirmed?: boolean; ifMatch?: string; taskIfMatch?: string }
): Promise<{ proposal: TaskChangeProposalRecord; task: TaskRecord & { dependsOn: string[] } }> {
  if (options?.confirmed !== true) {
    throw new ValidationError('Explicit human confirmation (confirmed: true) is required before applying proposed changes');
  }
  const proposal = await readTaskChangeProposal(p, proposalSelector);
  if (proposal.status !== 'pending') {
    throw new ValidationError(`Task change proposal "${proposal.id}" is already ${proposal.status}`);
  }
  if (options.ifMatch !== undefined && options.ifMatch !== proposal.etag) {
    throw new ConflictError('Proposal ETag mismatch', proposal.etag);
  }

  const currentTaskDoc = await readDocWithMeta(p, proposal.taskPath);
  const expectedTaskEtag = options.taskIfMatch ?? proposal.baseTaskEtag;
  if (currentTaskDoc.etag !== expectedTaskEtag) {
    throw new ConflictError('Target task was modified since the impact summary was prepared; please review a fresh proposal', currentTaskDoc.etag);
  }

  const taskParsed = parseDocument(currentTaskDoc.content);
  const updatedFm: Record<string, string | string[]> = {
    ...(taskParsed.frontmatter as Record<string, string | string[]>),
  };
  const keyOrder = [...taskParsed.keyOrder];
  const setOrDelete = (k: string, v: string | string[] | null | undefined) => {
    if (v === undefined) return;
    if (v === null || (Array.isArray(v) && v.length === 0)) {
      delete updatedFm[k];
    } else {
      updatedFm[k] = v;
      if (!keyOrder.includes(k)) keyOrder.push(k);
    }
  };

  const prop = proposal.proposed;
  if (prop.status !== undefined) setOrDelete('status', prop.status);
  if (prop.priority !== undefined) setOrDelete('priority', prop.priority);
  if (prop.epic !== undefined) setOrDelete('epic', prop.epic);
  if (prop.milestone !== undefined) setOrDelete('milestone', prop.milestone);
  if (prop.dependsOn !== undefined) {
    const validatedDependencies = await validateTaskDependencies(p, proposal.taskId, prop.dependsOn);
    delete updatedFm.dependencies;
    setOrDelete('dependsOn', validatedDependencies);
  }

  let newBody = taskParsed.body;
  if (prop.title !== undefined) {
    const lines = newBody.split('\n');
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^#\s+/.test(lines[i])) {
        lines[i] = `# ${prop.title.trim()}`;
        replaced = true;
        break;
      }
    }
    if (!replaced) lines.unshift(`# ${prop.title.trim()}`);
    newBody = lines.join('\n');
  }
  if (prop.body !== undefined) {
    const titleLine = `# ${(prop.title ?? deriveDocTitle(proposal.taskPath, taskParsed)).trim()}`;
    const trimmedBody = prop.body.trim();
    newBody = trimmedBody.startsWith('# ') ? `${trimmedBody}\n` : `${titleLine}\n\n${trimmedBody}\n`;
  }

  const serializedTask = serializeDocument(updatedFm, keyOrder, newBody, taskParsed.lineEnding);
  const writtenTask = await writeDoc(p, proposal.taskPath, serializedTask, { ifMatch: expectedTaskEtag });
  const finalTaskParsed = parseDocument(serializedTask);
  const taskRecord: TaskRecord & { dependsOn: string[] } = {
    id: (finalTaskParsed.frontmatter.id as string) || proposal.taskId,
    type: 'task',
    path: proposal.taskPath,
    title: deriveDocTitle(proposal.taskPath, finalTaskParsed),
    status: (finalTaskParsed.frontmatter.status as TaskStatus) || 'todo',
    priority: (finalTaskParsed.frontmatter.priority as TaskPriority) || 'medium',
    epic: (finalTaskParsed.frontmatter.epic as string) ?? null,
    milestone: (finalTaskParsed.frontmatter.milestone as string) ?? null,
    etag: writtenTask.etag,
    checklist: countMarkdownChecklists(finalTaskParsed.body),
    dependsOn: normalizeDependsOn(finalTaskParsed.frontmatter.dependsOn),
  };

  // Mark proposal as confirmed
  const now = new Date().toISOString();
  const proposalDoc = await readDocWithMeta(p, proposal.path);
  const proposalParsed = parseDocument(proposalDoc.content);
  const propFm: Record<string, string | string[]> = {
    ...(proposalParsed.frontmatter as Record<string, string | string[]>),
    status: 'confirmed',
    updatedAt: now,
    confirmedAt: now,
    appliedTaskEtag: writtenTask.etag,
  };
  const propKeyOrder = [...proposalParsed.keyOrder];
  for (const k of ['status', 'updatedAt', 'confirmedAt', 'appliedTaskEtag']) {
    if (!propKeyOrder.includes(k)) propKeyOrder.push(k);
  }
  const updatedPropBody = `${proposalParsed.body.trimEnd()}\n\n## Confirmation\n- Confirmed at ${now} (applied task ETag: \`${writtenTask.etag}\`)\n`;
  const serializedProposal = serializeDocument(propFm, propKeyOrder, updatedPropBody, proposalParsed.lineEnding);
  const savedProposal = await writeDoc(p, proposal.path, serializedProposal, { ifMatch: proposalDoc.etag });

  return {
    proposal: proposalFromDoc(p, proposal.path, serializedProposal, savedProposal.etag),
    task: taskRecord,
  };
}

export async function rejectTaskChangeProposal(
  p: Project,
  proposalSelector: string,
  options?: { reason?: string; ifMatch?: string }
): Promise<TaskChangeProposalRecord> {
  const proposal = await readTaskChangeProposal(p, proposalSelector);
  if (proposal.status !== 'pending') {
    throw new ValidationError(`Task change proposal "${proposal.id}" is already ${proposal.status}`);
  }
  if (options?.ifMatch !== undefined && options.ifMatch !== proposal.etag) {
    throw new ConflictError('Proposal ETag mismatch', proposal.etag);
  }
  const now = new Date().toISOString();
  const proposalDoc = await readDocWithMeta(p, proposal.path);
  const proposalParsed = parseDocument(proposalDoc.content);
  const propFm: Record<string, string | string[]> = {
    ...(proposalParsed.frontmatter as Record<string, string | string[]>),
    status: 'rejected',
    updatedAt: now,
  };
  const propKeyOrder = [...proposalParsed.keyOrder];
  if (!propKeyOrder.includes('updatedAt')) propKeyOrder.push('updatedAt');
  const reasonNote = options?.reason?.trim() ? `: ${options.reason.trim()}` : '';
  const updatedPropBody = `${proposalParsed.body.trimEnd()}\n\n## Confirmation\n- Rejected at ${now}${reasonNote}\n`;
  const serializedProposal = serializeDocument(propFm, propKeyOrder, updatedPropBody, proposalParsed.lineEnding);
  const savedProposal = await writeDoc(p, proposal.path, serializedProposal, { ifMatch: proposalDoc.etag });
  return proposalFromDoc(p, proposal.path, serializedProposal, savedProposal.etag);
}
