import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  Project,
  GitCommitInfo,
  GitState,
  ProjectStatus,
  AgentContextJson,
} from './types.js';
import { ValidationError } from './errors.js';
import { getProjectRollup, listTasks } from './tasks.js';
import { listDocs, readDoc } from './documents.js';
import { parseDocument, deriveDocTitle } from './markdown.js';
import { readProjectProfile } from './profile.js';

const execFileAsync = promisify(execFile);

export type {
  GitCommitInfo,
  GitState,
  ProjectStatus,
  AgentContextJson,
};

export type GitHistorySearch = {
  available: boolean;
  reason: string | null;
  sinceDays: number;
  limit: number;
  revision: 'HEAD';
  commitsScanned: number;
  truncated: boolean;
  commits: GitCommitInfo[];
};

async function runGit(sourcePath: string, args: string[], onCommand?: (args: string[]) => void): Promise<string> {
  const gitArgs = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', ...args];
  onCommand?.(args);
  const { stdout } = await execFileAsync('git', gitArgs, {
    cwd: sourcePath,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    timeout: 3000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

export async function getProjectGitStatus(p: Project, options?: { onCommand?: (args: string[]) => void }): Promise<GitState | null> {
  try {
    const isGit = (await runGit(p.sourcePath, ['rev-parse', '--is-inside-work-tree'], options?.onCommand)).trim();
    if (isGit !== 'true') return null;
  } catch {
    return null;
  }

  try {
    const [branchOut, statusOut, logOut] = await Promise.all([
      runGit(p.sourcePath, ['branch', '--show-current'], options?.onCommand).catch(() => ''),
      runGit(p.sourcePath, ['status', '--porcelain'], options?.onCommand).catch(() => ''),
      runGit(p.sourcePath, ['log', '-n', '5', '--format=%H%x1f%s%x1f%an%x1f%aI'], options?.onCommand).catch(() => ''),
    ]);
    let branch = branchOut.trim();
    if (!branch) {
      try {
        branch = (await runGit(p.sourcePath, ['rev-parse', '--abbrev-ref', 'HEAD'], options?.onCommand)).trim();
      } catch {}
    }
    if (!branch) branch = 'HEAD';

    const statusLines = statusOut.split('\n').filter(l => l.trim().length > 0);
    const dirtyCount = statusLines.length;
    const recentCommits: GitCommitInfo[] = [];
    const logLines = logOut.split('\n').filter(l => l.trim().length > 0);
    for (const line of logLines) {
      const [sha, subject, author, timestamp] = line.split('\x1f');
      if (sha && subject) {
        recentCommits.push({ sha, subject, author: author || '', timestamp: timestamp || '' });
      }
    }

    const head = recentCommits[0] ?? null;

    return {
      branch,
      head,
      dirtyCount,
      recentCommits,
    };
  } catch {
    return null;
  }
}

export async function searchProjectGitHistory(
  p: Project,
  options: { sinceDays?: number; limit?: number } = {}
): Promise<GitHistorySearch> {
  const sinceDays = options.sinceDays ?? 365;
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(sinceDays) || sinceDays < 1 || sinceDays > 3650) {
    throw new ValidationError('sinceDays must be an integer from 1 to 3650');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new ValidationError('limit must be an integer from 1 to 200');
  }
  const unavailable = (reason: string): GitHistorySearch => ({ available: false, reason, sinceDays, limit, revision: 'HEAD', commitsScanned: 0, truncated: false, commits: [] });
  try {
    const isGit = (await runGit(p.sourcePath, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (isGit !== 'true') return unavailable('This project is not a Git repository.');
    const logOut = await runGit(p.sourcePath, [
      'log', '--no-show-signature', `--since=${sinceDays} days ago`, '-n', String(limit + 1),
      '--format=%H%x1f%s%x1f%an%x1f%aI',
    ]);
    const allCommits: GitCommitInfo[] = logOut.split('\n').filter(line => line.trim()).flatMap(line => {
      const [sha, subject, author, timestamp] = line.split('\x1f');
      return sha && subject ? [{ sha, subject, author: author || '', timestamp: timestamp || '' }] : [];
    });
    const truncated = allCommits.length > limit;
    return { available: true, reason: null, sinceDays, limit, revision: 'HEAD', commitsScanned: Math.min(allCommits.length, limit), truncated, commits: allCommits.slice(0, limit) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return unavailable('Git is not installed or could not be started.');
    if (code === 'ETIMEDOUT') return unavailable('Git history search exceeded the 3 second time limit.');
    if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return unavailable('Git history output exceeded the 1 MiB limit.');
    return unavailable(error instanceof Error ? error.message : 'Git history is unavailable.');
  }
}

export async function getProjectStatusWithGit(p: Project): Promise<ProjectStatus> {
  const git = await getProjectGitStatus(p);
  return {
    ...p,
    git,
  };
}

const CONTEXT_TRUNCATION_MARKER = '... [truncated to fit agent context budget]';

function contextLimit(value: number | undefined, fallback: number, name: string, minimum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ValidationError(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value;
}

export async function generateAgentContext(
  p: Project,
  options?: { maxBytes?: number; maxLines?: number; maxItems?: number }
): Promise<{ text: string; json: AgentContextJson }> {
  const maxBytes = contextLimit(
    options?.maxBytes,
    8192,
    'maxBytes',
    Buffer.byteLength(`\n${CONTEXT_TRUNCATION_MARKER}`, 'utf8')
  );
  const maxLines = contextLimit(options?.maxLines, 120, 'maxLines', 2);
  const maxItems = contextLimit(options?.maxItems, 10, 'maxItems', 0);

  const git = await getProjectGitStatus(p);
  const rollup = await getProjectRollup(p);
  const allTasks = await listTasks(p);
  const allDocs = await listDocs(p);
  const profile = await readProjectProfile(p);

  const priorityWeight: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const inProgress = allTasks.filter(t => t.status === 'in_progress').sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0));
  const blocked = allTasks.filter(t => t.status === 'blocked').sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0));
  const todo = allTasks.filter(t => t.status === 'todo').sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0));
  const doneCount = allTasks.filter(t => t.status === 'done').length;
  const cancelledCount = allTasks.filter(t => t.status === 'cancelled').length;

  const keyDocs: Array<{ path: string; title: string; docId: string | null }> = [];
  for (const doc of [...new Set([...profile.keyDocs, ...allDocs])].slice(0, 15)) {
    try {
      const parsed = parseDocument(await readDoc(p, doc));
      keyDocs.push({ path: doc, title: deriveDocTitle(doc, parsed), docId: (parsed.frontmatter.id as string) || null });
    } catch {}
  }

  const json: AgentContextJson = {
    project: {
      id: p.id,
      key: p.key,
      name: p.name,
      sourcePath: p.sourcePath,
    },
    profile: {
      status: profile.status,
      goals: profile.goals,
      keyDocs: profile.keyDocs,
      decisions: profile.decisions,
    },
    git,
    rollup: {
      milestones: rollup.milestones.map(m => ({ id: m.id, title: m.title, status: m.status, completionRatio: m.counts.completionRatio, total: m.counts.total, done: m.counts.done })),
      epics: rollup.epics.map(e => ({ id: e.id, title: e.title, status: e.status, completionRatio: e.counts.completionRatio, total: e.counts.total, done: e.counts.done })),
    },
    tasks: {
      inProgress: inProgress.slice(0, maxItems).map(t => ({ id: t.id, title: t.title, priority: t.priority, epic: t.epic, milestone: t.milestone })),
      blocked: blocked.slice(0, maxItems).map(t => ({ id: t.id, title: t.title, priority: t.priority, epic: t.epic, milestone: t.milestone })),
      todo: todo.slice(0, maxItems).map(t => ({ id: t.id, title: t.title, priority: t.priority, epic: t.epic, milestone: t.milestone })),
      doneCount,
      cancelledCount,
    },
    docs: keyDocs.slice(0, maxItems),
  };

  const lines: string[] = [
    `# LocalAtlas Project Context: [${p.key}] ${p.name}`,
    `Project: ${p.key} (${p.name})`,
    `Source: ${p.sourcePath}`,
    `Workspace: ${p.managedPath}`,
    `Project ID: ${p.id}`,
  ];
  if (profile.status) lines.push(`Project status: ${profile.status}`);
  if (profile.goals) lines.push(`Project goals: ${profile.goals}`);
  if (profile.decisions.length) {
    lines.push('Approved decisions:');
    for (const decision of profile.decisions.slice(-5)) lines.push(`- [${decision.id}] ${decision.summary}${decision.rationale ? ` — ${decision.rationale}` : ''}`);
  }

  if (git) {
    lines.push('');
    lines.push(`## Git State (${git.branch})`);
    lines.push(`Branch: ${git.branch}`);
    if (git.head) {
      lines.push(`HEAD: ${git.head.sha.slice(0, 7)} "${git.head.subject}" (${git.head.author}, ${git.head.timestamp.slice(0, 10)})`);
    } else {
      lines.push('HEAD: (unborn repository, 0 commits)');
    }
    lines.push(`Dirty Files: ${git.dirtyCount}`);
    if (git.recentCommits.length > 0) {
      lines.push('Recent Commits:');
      for (const c of git.recentCommits.slice(0, 3)) {
        lines.push(`- ${c.sha.slice(0, 7)} ${c.subject}`);
      }
    }
  }

  if (rollup.milestones.length > 0 || rollup.epics.length > 0) {
    lines.push('');
    lines.push('## Milestones & Epics');
    for (const m of rollup.milestones.slice(0, 5)) {
      lines.push(`- Milestone [${m.id}] ${m.title} (${(m.counts.completionRatio * 100).toFixed(0)}% done - ${m.counts.done}/${m.counts.total - m.counts.cancelled} active)`);
    }
    for (const e of rollup.epics.slice(0, 5)) {
      lines.push(`- Epic [${e.id}] ${e.title} (${(e.counts.completionRatio * 100).toFixed(0)}% done - ${e.counts.done}/${e.counts.total - e.counts.cancelled} active)`);
    }
  }

  lines.push('');
  lines.push(`## Active Tasks (${inProgress.length} in_progress, ${blocked.length} blocked, ${todo.length} todo, ${doneCount} done)`);
  if (inProgress.length > 0) {
    lines.push('### In Progress');
    for (const t of inProgress.slice(0, 5)) {
      lines.push(`- [${t.id}] ${t.title} (${t.priority})`);
    }
  }
  if (blocked.length > 0) {
    lines.push('### Blocked');
    for (const t of blocked.slice(0, 5)) {
      lines.push(`- [${t.id}] ${t.title} (${t.priority})`);
    }
  }
  if (todo.length > 0) {
    lines.push('### Top Todo');
    for (const t of todo.slice(0, 5)) {
      lines.push(`- [${t.id}] ${t.title} (${t.priority})`);
    }
  }

  if (keyDocs.length > 0) {
    lines.push('');
    lines.push('## Documentation');
    for (const d of keyDocs.slice(0, 5)) {
      lines.push(`- ${d.docId ? `[${d.docId}] ` : ''}${d.title} (${d.path})`);
    }
  }

  lines.push('');
  lines.push('## LocalAtlas CLI (use these commands — do NOT create task files manually)');
  lines.push(getAgentsMdSnippet().split('\n').filter(l => !l.startsWith('<!--') && !l.startsWith('## Working')).map(l => l.startsWith('###') ? l.replace('###', '>') : l).join('\n'));

  // Budget enforcement
  let outputText = lines.join('\n');
  const rawLines = outputText.split('\n');
  if (rawLines.length > maxLines || Buffer.byteLength(outputText, 'utf8') > maxBytes) {
    const truncatedLines: string[] = [];
    let currentBytes = 0;
    const footer = `\n${CONTEXT_TRUNCATION_MARKER}`;
    const footerBytes = Buffer.byteLength(footer, 'utf8');

    for (let i = 0; i < rawLines.length && i < maxLines - 2; i++) {
      const lineBytes = Buffer.byteLength(rawLines[i] + '\n', 'utf8');
      if (currentBytes + lineBytes + footerBytes > maxBytes) break;
      truncatedLines.push(rawLines[i]);
      currentBytes += lineBytes;
    }
    outputText = truncatedLines.join('\n') + footer;
  }

  return { text: outputText, json };
}

export function getAgentsMdSnippet(): string {
  return [
    '<!-- LocalAtlas Coding Agent Guidelines -->',
    '## Working with LocalAtlas',
    'LocalAtlas provides project-scoped specifications, structured tasks, and search over local Markdown documents.',
    '',
    '### Core Rules:',
    '- Markdown files under LocalAtlas are canonical; SQLite is disposable and rebuildable.',
    '- Never write files directly inside imported repo directories during indexing.',
    '- Use sequential IDs (<KEY>-<NNN>) allocated by LocalAtlas for tracking tasks and epics.',
    '',
    '### Standard Agent Workflow Commands:',
    '- Pass `--project <PROJECT_ID>` when your current directory is outside the registered project.',
    '- Refresh project state before acting: `localatlas context --project <PROJECT_ID>` and `localatlas task list --project <PROJECT_ID>`.',
    '- Get a bounded task bundle: `localatlas context --project <PROJECT_ID> --task <ID>`.',
    '- List/search/read Atlas documents: `localatlas docs --project <PROJECT_ID>`, `localatlas search --project <PROJECT_ID> "<query>"`, `localatlas read <ID|docs/path.md> --project <PROJECT_ID> --json`.',
    '- Create tasks with `localatlas task create`; update them with `localatlas task update <ID> --project <PROJECT_ID> --if-match <ETAG>`; never create task Markdown by hand.',
    '- Write Atlas documents with `localatlas write <docs/path.md> --project <PROJECT_ID> --if-match <ETAG>`; keep paths under `docs/` and use ETags from the latest read.',
    '- After changes, re-list tasks or read the document to verify the saved result.',
    '- For “clear tasks”, inspect the list, then ask whether to cancel or permanently delete before changing anything.',
    '- Treat repository Markdown as read-only context; LocalAtlas operations only change managed workspace Markdown.',
  ].join('\n');
}
