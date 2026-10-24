import type {
  Project,
  TaskStatus,
  TaskPriority,
  EpicStatus,
  MilestoneStatus,
  ChecklistCounts,
  TaskRecord,
  EpicRecord,
  MilestoneRecord,
  RollupCounts,
  BrokenReference,
  EpicRollup,
  MilestoneRollup,
  ProjectRollup,
} from './types.js';
import {
  VALID_TASK_STATUSES,
  VALID_TASK_PRIORITIES,
  VALID_EPIC_STATUSES,
  VALID_MILESTONE_STATUSES,
} from './types.js';
import { withWorkspaceLock } from './lock.js';
import { withDb } from './db.js';
import { listDocs, readDoc, readDocWithMeta, writeDoc, resolveDocSelector, updateFrontmatter } from './documents.js';
import { parseDocument, serializeDocument, deriveDocTitle, countMarkdownChecklists } from './markdown.js';
import { reconcileProjectIndex } from './search.js';
import { ValidationError } from './errors.js';

export function normalizeTaskDependencies(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const seen = new Set<string>();
  return values.flatMap(item => {
    if (typeof item !== 'string' || !item.trim()) return [];
    const id = item.trim();
    const key = id.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [id];
  });
}

/** Validate and canonicalize dependencies against tasks in this project only. */
export async function validateTaskDependencies(p: Project, taskId: string, value: unknown): Promise<string[]> {
  const proposed = normalizeTaskDependencies(value);
  const tasks = await listTasks(p);
  const byId = new Map(tasks.map(task => [task.id.toLocaleLowerCase(), task]));
  const canonical = proposed.map(id => {
    if (id.toLocaleLowerCase() === taskId.toLocaleLowerCase()) {
      throw new ValidationError(`Task ${taskId} cannot depend on itself`);
    }
    const task = byId.get(id.toLocaleLowerCase());
    if (!task) throw new ValidationError(`Dependency "${id}" does not exist in project ${p.key}; dependencies must stay in the same project`);
    return task.id;
  });
  const depsById = new Map(tasks.map(task => [task.id.toLocaleLowerCase(), task.dependsOn.map(id => id.toLocaleLowerCase())]));
  for (const dep of canonical) {
    const visited = new Set<string>();
    const stack = [dep.toLocaleLowerCase()];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === taskId.toLocaleLowerCase()) throw new ValidationError(`Dependency cycle detected involving ${taskId}`);
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(depsById.get(current) ?? []));
    }
  }
  return canonical;
}

export {
  VALID_TASK_STATUSES,
  VALID_TASK_PRIORITIES,
  VALID_EPIC_STATUSES,
  VALID_MILESTONE_STATUSES,
  countMarkdownChecklists,
};

export type {
  TaskStatus,
  TaskPriority,
  EpicStatus,
  MilestoneStatus,
  ChecklistCounts,
  TaskRecord,
  EpicRecord,
  MilestoneRecord,
  RollupCounts,
  BrokenReference,
  EpicRollup,
  MilestoneRollup,
  ProjectRollup,
};

export async function allocateNextProjectId(p: Project): Promise<string> {
  const allDocs = await listDocs(p).catch(() => []);
  let highest = 0;
  const idRegex = new RegExp(`^${p.key}-(\\d+)$`, 'i');

  // Check on-disk filenames and content frontmatter
  for (const doc of allDocs) {
    const baseName = doc.split('/').pop()?.replace(/\.md$/, '') || '';
    const nameMatch = idRegex.exec(baseName);
    if (nameMatch) {
      const n = parseInt(nameMatch[1], 10);
      if (n > highest) highest = n;
    }
    try {
      const content = await readDoc(p, doc);
      const parsed = parseDocument(content);
      if (parsed.frontmatter.id && typeof parsed.frontmatter.id === 'string') {
        const fmMatch = idRegex.exec(parsed.frontmatter.id);
        if (fmMatch) {
          const n = parseInt(fmMatch[1], 10);
          if (n > highest) highest = n;
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Also query indexed IDs in SQLite
  return withDb(db => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const rows = db.prepare('SELECT doc_id FROM doc_index WHERE project_id = ? AND doc_id IS NOT NULL').all(p.id) as Array<{ doc_id: string }>;
      for (const r of rows) {
        const m = idRegex.exec(r.doc_id);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > highest) highest = n;
        }
      }

      const pRow = db.prepare('SELECT next_seq FROM projects WHERE id = ?').get(p.id) as { next_seq: number } | undefined;
      const currentSeq = pRow?.next_seq ?? 0;
      const nextNum = Math.max(highest, currentSeq) + 1;

      db.prepare('UPDATE projects SET next_seq = ? WHERE id = ?').run(nextNum, p.id);
      db.exec('COMMIT');
      return `${p.key}-${String(nextNum).padStart(3, '0')}`;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  });
}

export async function createTask(
  p: Project,
  input: {
    title: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    epic?: string | null;
    milestone?: string | null;
    dependsOn?: string[];
    body?: string;
  }
): Promise<TaskRecord> {
  return withWorkspaceLock(async () => {
    const title = (input.title || '').trim();
    if (!title) throw new Error('Task title cannot be empty');

    const status: TaskStatus = input.status ?? 'todo';
    if (!VALID_TASK_STATUSES.has(status)) {
      throw new Error(`Invalid task status: "${status}"`);
    }
    const priority: TaskPriority = input.priority ?? 'medium';
    if (!VALID_TASK_PRIORITIES.has(priority)) {
      throw new Error(`Invalid task priority: "${priority}"`);
    }

    const dependsOn = await validateTaskDependencies(p, '__new_task__', input.dependsOn ?? []);
    const id = await allocateNextProjectId(p);
    const relPath = `tasks/${id}.md`;

    const frontmatter: Record<string, string | string[]> = {
      id,
      type: 'task',
      status,
      priority,
    };
    const keyOrder = ['id', 'type', 'status', 'priority'];
    if (input.epic) {
      frontmatter.epic = input.epic;
      keyOrder.push('epic');
    }
    if (input.milestone) {
      frontmatter.milestone = input.milestone;
      keyOrder.push('milestone');
    }
    if (dependsOn.length) {
      frontmatter.dependsOn = dependsOn;
      keyOrder.push('dependsOn');
    }

    const bodyContent = input.body ? `\n\n${input.body.trimEnd()}\n` : '\n';
    const fullContent = serializeDocument(frontmatter, keyOrder, `# ${title}${bodyContent}`);

    const written = await writeDoc(p, relPath, fullContent, { createOnly: true });
    const checklist = countMarkdownChecklists(input.body || '');

    return {
      id,
      type: 'task',
      path: relPath,
      title,
      status,
      priority,
      epic: input.epic ?? null,
      milestone: input.milestone ?? null,
      etag: written.etag,
      checklist,
      dependsOn,
    };
  });
}

export async function createEpic(
  p: Project,
  input: {
    title: string;
    status?: EpicStatus;
    milestone?: string | null;
    body?: string;
  }
): Promise<EpicRecord> {
  return withWorkspaceLock(async () => {
    const title = (input.title || '').trim();
    if (!title) throw new Error('Epic title cannot be empty');

    const status: EpicStatus = input.status ?? 'todo';
    if (!VALID_EPIC_STATUSES.has(status)) {
      throw new Error(`Invalid epic status: "${status}"`);
    }

    const id = await allocateNextProjectId(p);
    const relPath = `epics/${id}.md`;

    const frontmatter: Record<string, string | string[]> = {
      id,
      type: 'epic',
      status,
    };
    const keyOrder = ['id', 'type', 'status'];
    if (input.milestone) {
      frontmatter.milestone = input.milestone;
      keyOrder.push('milestone');
    }

    const bodyContent = input.body ? `\n\n${input.body.trimEnd()}\n` : '\n';
    const fullContent = serializeDocument(frontmatter, keyOrder, `# ${title}${bodyContent}`);

    const written = await writeDoc(p, relPath, fullContent, { createOnly: true });

    return {
      id,
      type: 'epic',
      path: relPath,
      title,
      status,
      milestone: input.milestone ?? null,
      etag: written.etag,
    };
  });
}

export async function createMilestone(
  p: Project,
  input: {
    title: string;
    status?: MilestoneStatus;
    targetDate?: string | null;
    body?: string;
  }
): Promise<MilestoneRecord> {
  return withWorkspaceLock(async () => {
    const title = (input.title || '').trim();
    if (!title) throw new Error('Milestone title cannot be empty');

    const status: MilestoneStatus = input.status ?? 'open';
    if (!VALID_MILESTONE_STATUSES.has(status)) {
      throw new Error(`Invalid milestone status: "${status}"`);
    }

    if (input.targetDate && !isValidDateOnly(input.targetDate)) {
      throw new Error('Milestone targetDate must be a valid YYYY-MM-DD date');
    }

    const id = await allocateNextProjectId(p);
    const relPath = `milestones/${id}.md`;

    const frontmatter: Record<string, string | string[]> = {
      id,
      type: 'milestone',
      status,
    };
    const keyOrder = ['id', 'type', 'status'];
    if (input.targetDate) {
      frontmatter.targetDate = input.targetDate;
      keyOrder.push('targetDate');
    }

    const bodyContent = input.body ? `\n\n${input.body.trimEnd()}\n` : '\n';
    const fullContent = serializeDocument(frontmatter, keyOrder, `# ${title}${bodyContent}`);

    const written = await writeDoc(p, relPath, fullContent, { createOnly: true });

    return {
      id,
      type: 'milestone',
      path: relPath,
      title,
      status,
      targetDate: input.targetDate ?? null,
      etag: written.etag,
    };
  });
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function promoteNoteToTask(
  p: Project,
  selectorOrPath: string,
  options?: {
    priority?: TaskPriority;
    status?: TaskStatus;
    epic?: string | null;
    milestone?: string | null;
    ifMatch?: string;
  }
): Promise<TaskRecord> {
  const relPath = await resolveDocSelector(p, selectorOrPath);
  const meta = await readDocWithMeta(p, relPath);
  const parsed = parseDocument(meta.content);

  if (options?.status && !VALID_TASK_STATUSES.has(options.status)) {
    throw new Error(`Invalid task status: "${options.status}"`);
  }
  if (options?.priority && !VALID_TASK_PRIORITIES.has(options.priority)) {
    throw new Error(`Invalid task priority: "${options.priority}"`);
  }

  const isAlreadyTask = parsed.frontmatter.type === 'task' && typeof parsed.frontmatter.id === 'string' && parsed.frontmatter.id.trim().length > 0;
  let taskId = isAlreadyTask ? String(parsed.frontmatter.id) : null;

  if (!taskId) {
    taskId = await allocateNextProjectId(p);
  }

  const updates: Record<string, string | string[] | null | undefined> = {
    id: taskId,
    type: 'task',
    status: options?.status ?? (parsed.frontmatter.status as TaskStatus) ?? 'todo',
    priority: options?.priority ?? (parsed.frontmatter.priority as TaskPriority) ?? 'medium',
  };
  if (options?.epic !== undefined) updates.epic = options.epic;
  if (options?.milestone !== undefined) updates.milestone = options.milestone;

  const updated = await updateFrontmatter(p, relPath, updates, { ifMatch: options?.ifMatch ?? meta.etag });
  const rawUpdated = await readDoc(p, relPath);
  const reParsed = parseDocument(rawUpdated);
  const checklist = countMarkdownChecklists(reParsed.body);
  const title = deriveDocTitle(relPath, reParsed);

  return {
    id: taskId,
    type: 'task',
    path: relPath,
    title,
    status: (reParsed.frontmatter.status as TaskStatus) || 'todo',
    priority: (reParsed.frontmatter.priority as TaskPriority) || 'medium',
    epic: (reParsed.frontmatter.epic as string) ?? null,
    milestone: (reParsed.frontmatter.milestone as string) ?? null,
    etag: updated.etag,
    checklist,
    dependsOn: normalizeTaskDependencies(reParsed.frontmatter.dependsOn ?? reParsed.frontmatter.dependencies),
  };
}

export async function listTasks(
  p: Project,
  filters?: {
    status?: string;
    priority?: string;
    milestone?: string;
    epic?: string;
  }
): Promise<TaskRecord[]> {
  await reconcileProjectIndex(p);
  return withDb(async db => {
    const clauses: string[] = ['di.project_id = ?', "di.type = 'task'"];
    const params: string[] = [p.id];

    if (filters?.status) {
      clauses.push('di.status = ?');
      params.push(filters.status);
    }
    if (filters?.priority) {
      clauses.push('di.priority = ?');
      params.push(filters.priority);
    }
    if (filters?.milestone) {
      clauses.push('di.milestone = ?');
      params.push(filters.milestone);
    }
    if (filters?.epic) {
      clauses.push('di.epic = ?');
      params.push(filters.epic);
    }

    const sql = `
      SELECT
        di.doc_id,
        di.path,
        di.title,
        di.status,
        di.priority,
        di.epic,
        di.milestone,
        di.etag,
        COALESCE(df.body, '') AS body
      FROM doc_index di
      LEFT JOIN doc_fts df ON df.project_id = di.project_id AND df.path = di.path
      WHERE ${clauses.join(' AND ')}
      ORDER BY di.doc_id ASC, di.path ASC
    `;
    const rows = db.prepare(sql).all(...params) as Array<{
      doc_id: string | null;
      path: string;
      title: string;
      status: string | null;
      priority: string | null;
      epic: string | null;
      milestone: string | null;
      etag: string;
      body: string;
    }>;

    const records = rows.map(r => ({
      id: r.doc_id || r.path,
      type: 'task' as const,
      path: r.path,
      title: r.title,
      status: (r.status as TaskStatus) || 'todo',
      priority: (r.priority as TaskPriority) || 'medium',
      epic: r.epic,
      milestone: r.milestone,
      etag: r.etag,
      checklist: countMarkdownChecklists(r.body),
      dependsOn: [] as string[],
    }));
    return Promise.all(records.map(async record => {
      try {
        const doc = await readDocWithMeta(p, record.path);
        record.dependsOn = normalizeTaskDependencies(doc.frontmatter.dependsOn ?? doc.frontmatter.dependencies);
      } catch { /* Keep unreadable legacy documents visible without dependencies. */ }
      return record;
    }));
  });
}

export async function updateTask(
  p: Project,
  selector: string,
  patch: {
    status?: TaskStatus;
    priority?: TaskPriority;
    milestone?: string | null;
    epic?: string | null;
    title?: string;
    body?: string;
    ifMatch?: string;
  }
): Promise<TaskRecord> {
  if (patch.status !== undefined && !VALID_TASK_STATUSES.has(patch.status)) {
    throw new Error(`Invalid task status: "${patch.status}"`);
  }
  if (patch.priority !== undefined && !VALID_TASK_PRIORITIES.has(patch.priority)) {
    throw new Error(`Invalid task priority: "${patch.priority}"`);
  }

  const relPath = await resolveDocSelector(p, selector);
  const current = await readDocWithMeta(p, relPath);
  const parsed = parseDocument(current.content);

  const updates: Record<string, unknown> = {};
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.priority !== undefined) updates.priority = patch.priority;
  if (patch.epic !== undefined) updates.epic = patch.epic;
  if (patch.milestone !== undefined) updates.milestone = patch.milestone;

  let newBody = parsed.body;
  if (patch.title !== undefined) {
    const lines = newBody.split('\n');
    let titleReplaced = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^#\s+/.test(lines[i])) {
        lines[i] = `# ${patch.title.trim()}`;
        titleReplaced = true;
        break;
      }
    }
    if (!titleReplaced) {
      lines.unshift(`# ${patch.title.trim()}`);
    }
    newBody = lines.join('\n');
  }
  if (patch.body !== undefined) {
    newBody = patch.body;
  }

  const updatedFrontmatter: Record<string, string | string[]> = {
    ...(parsed.frontmatter as Record<string, string | string[]>),
  };
  const keyOrder = [...parsed.keyOrder];
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined) {
      delete updatedFrontmatter[k];
    } else {
      updatedFrontmatter[k] = v as string | string[];
      if (!keyOrder.includes(k)) keyOrder.push(k);
    }
  }

  const serialized = serializeDocument(updatedFrontmatter, keyOrder, newBody, parsed.lineEnding);

  const written = await writeDoc(p, relPath, serialized, { ifMatch: patch.ifMatch });
  const finalParsed = parseDocument(serialized);
  const derivedTitle = deriveDocTitle(relPath, finalParsed);

  return {
    id: (finalParsed.frontmatter.id as string) || relPath,
    type: 'task',
    path: relPath,
    title: derivedTitle,
    status: (finalParsed.frontmatter.status as TaskStatus) || 'todo',
    priority: (finalParsed.frontmatter.priority as TaskPriority) || 'medium',
    epic: (finalParsed.frontmatter.epic as string) ?? null,
    milestone: (finalParsed.frontmatter.milestone as string) ?? null,
    etag: written.etag,
    checklist: countMarkdownChecklists(finalParsed.body),
    dependsOn: normalizeTaskDependencies(finalParsed.frontmatter.dependsOn ?? finalParsed.frontmatter.dependencies),
  };
}

function computeRollup(tasks: Array<{ status: string }>): RollupCounts {
  let todo = 0;
  let inProgress = 0;
  let blocked = 0;
  let done = 0;
  let cancelled = 0;

  for (const t of tasks) {
    switch (t.status) {
      case 'todo': todo++; break;
      case 'in_progress': inProgress++; break;
      case 'blocked': blocked++; break;
      case 'done': done++; break;
      case 'cancelled': cancelled++; break;
      default: todo++; break;
    }
  }

  const total = tasks.length;
  const activeTotal = total - cancelled;
  const completionRatio = activeTotal > 0 ? Number((done / activeTotal).toFixed(4)) : 0;

  return {
    total,
    todo,
    inProgress,
    blocked,
    done,
    cancelled,
    completionRatio,
  };
}

export async function getProjectRollup(p: Project): Promise<ProjectRollup> {
  await reconcileProjectIndex(p);

  const rollup = await withDb(db => {
    const rows = db.prepare(`
      SELECT
        doc_id,
        path,
        title,
        type,
        status,
        epic,
        milestone
      FROM doc_index
      WHERE project_id = ?
    `).all(p.id) as Array<{
      doc_id: string | null;
      path: string;
      title: string;
      type: string | null;
      status: string | null;
      epic: string | null;
      milestone: string | null;
    }>;

    const milestones: MilestoneRollup[] = [];
    const epics: EpicRollup[] = [];
    const tasks: typeof rows = [];

    const knownEpicKeys = new Set<string>();
    const knownMilestoneKeys = new Set<string>();

    for (const r of rows) {
      if (r.type === 'milestone') {
        if (r.doc_id) knownMilestoneKeys.add(r.doc_id);
        knownMilestoneKeys.add(r.path);
        knownMilestoneKeys.add(r.title);
      } else if (r.type === 'epic') {
        if (r.doc_id) knownEpicKeys.add(r.doc_id);
        knownEpicKeys.add(r.path);
        knownEpicKeys.add(r.title);
      } else if (r.type === 'task') {
        tasks.push(r);
      }
    }

    const epicMap = new Map<string, typeof rows>();
    const milestoneMap = new Map<string, typeof rows>();
    const brokenReferences: BrokenReference[] = [];

    // Map each task
    for (const t of tasks) {
      let missingEpic: string | undefined;
      let missingMilestone: string | undefined;

      if (t.epic) {
        if (!knownEpicKeys.has(t.epic)) {
          missingEpic = t.epic;
        }
      }
      if (t.milestone) {
        if (!knownMilestoneKeys.has(t.milestone)) {
          missingMilestone = t.milestone;
        }
      }

      if (missingEpic || missingMilestone) {
        brokenReferences.push({
          taskId: t.doc_id,
          path: t.path,
          title: t.title,
          missingEpic,
          missingMilestone,
        });
      }
    }

    // Compute epic rollups
    for (const r of rows) {
      if (r.type === 'epic') {
        const matchingTasks = tasks.filter(t => t.epic && (t.epic === r.doc_id || t.epic === r.path || t.epic === r.title));
        epicMap.set(r.doc_id || r.path, matchingTasks);
        epics.push({
          id: r.doc_id || r.path,
          title: r.title,
          status: (r.status as EpicStatus) || 'todo',
          milestone: r.milestone,
          counts: computeRollup(matchingTasks.map(t => ({ status: t.status || 'todo' }))),
        });
      }
    }

    // Compute milestone rollups
    for (const r of rows) {
      if (r.type === 'milestone') {
        const msKey = r.doc_id || r.path;
        // Tasks directly attached or via child epics attached to this milestone
        const childEpicKeys = new Set(
          epics.filter(e => e.milestone && (e.milestone === r.doc_id || e.milestone === r.path || e.milestone === r.title)).map(e => e.id)
        );

        const matchingTasks = tasks.filter(t => {
          if (t.milestone && (t.milestone === r.doc_id || t.milestone === r.path || t.milestone === r.title)) return true;
          if (t.epic && childEpicKeys.has(t.epic)) return true;
          return false;
        });

        milestones.push({
          id: msKey,
          title: r.title,
          status: (r.status as MilestoneStatus) || 'open',
          targetDate: null,
          counts: computeRollup(matchingTasks.map(t => ({ status: t.status || 'todo' }))),
        });
      }
    }

    return {
      milestones,
      epics,
      brokenReferences,
    };
  });

  const dependencyTasks = await listTasks(p);
  const taskIds = new Set(dependencyTasks.map(task => task.id.toLocaleLowerCase()));
  const depsById = new Map(dependencyTasks.map(task => [task.id.toLocaleLowerCase(), task.dependsOn.map(id => id.toLocaleLowerCase())]));
  for (const task of dependencyTasks) {
    const missingDependencies = task.dependsOn.filter(id => !taskIds.has(id.toLocaleLowerCase()));
    let dependencyCycle = false;
    const visited = new Set<string>();
    const stack = task.dependsOn.map(id => id.toLocaleLowerCase());
    while (stack.length) {
      const current = stack.pop()!;
      if (current === task.id.toLocaleLowerCase()) { dependencyCycle = true; break; }
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(depsById.get(current) ?? []));
    }
    if (missingDependencies.length || dependencyCycle) {
      const existing = rollup.brokenReferences.find(ref => ref.taskId === task.id);
      if (existing) {
        if (missingDependencies.length) existing.missingDependencies = missingDependencies;
        if (dependencyCycle) existing.dependencyCycle = true;
      } else {
        rollup.brokenReferences.push({
          taskId: task.id, path: task.path, title: task.title,
          ...(missingDependencies.length ? { missingDependencies } : {}),
          ...(dependencyCycle ? { dependencyCycle: true } : {}),
        });
      }
    }
  }

  const milestonePaths = await withDb(db => db.prepare(`
    SELECT path, doc_id FROM doc_index WHERE project_id = ? AND type = 'milestone'
  `).all(p.id) as Array<{ path: string; doc_id: string | null }>);
  const targetDates = new Map<string, string | null>();
  for (const row of milestonePaths) {
    try {
      const doc = await readDocWithMeta(p, row.path);
      const rawDate = doc.frontmatter.targetDate;
      const targetDate = typeof rawDate === 'string' && isValidDateOnly(rawDate) ? rawDate : null;
      if (row.doc_id) targetDates.set(row.doc_id, targetDate);
      targetDates.set(row.path, targetDate);
      const title = deriveDocTitle(row.path, parseDocument(doc.content));
      targetDates.set(title, targetDate);
    } catch {
      // A malformed/unreadable milestone should not make the project rollup unavailable.
    }
  }
  for (const milestone of rollup.milestones) {
    milestone.targetDate = targetDates.get(milestone.id) ?? null;
  }
  return rollup;
}
