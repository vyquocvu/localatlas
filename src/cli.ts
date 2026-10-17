#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { app } from './server.js';
import {
  importProject,
  projects,
  selectProject,
  updateProject,
  relinkProject,
  removeProject,
  listDocs,
  listDocsFiltered,
  readDoc,
  readDocWithMeta,
  writeDoc,
  updateFrontmatter,
  moveDoc,
  deleteDoc,
  reindexProject,
  searchDocs,
  getBacklinks,
  startWorkspaceWatcher,
  createTask,
  createEpic,
  createMilestone,
  promoteNoteToTask,
  listTasks,
  updateTask,
  getProjectRollup,
  getProjectStatusWithGit,
  generateAgentContext,
  generateTaskAgentContext,
  createAgentSession,
  listAgentSessions,
  readAgentSession,
  updateAgentSession,
  readProjectProfile,
  updateProjectProfile,
  recordProjectDecision,
  previewTaskImpact,
  createTaskChangeProposal,
  listTaskChangeProposals,
  readTaskChangeProposal,
  confirmTaskChangeProposal,
  rejectTaskChangeProposal,
  generateProjectRecapDraft,
  listProjectRecaps,
  readProjectRecap,
  getPortfolioSummary,
  listDocTemplates,
  createDocFromTemplate,
  getProjectTaskTraceability,
  analyzeProjectHealth,
  getAgentsMdSnippet,
  backupWorkspace,
  restoreWorkspace,
  registerServerLock,
} from './core.js';

const args = process.argv.slice(2);
const command = args.shift() ?? 'help';

const KNOWN_FLAGS = new Set([
  '--project',
  '--task',
  '--json',
  '--key',
  '--name',
  '--reuse-docs',
  '--force',
  '--overwrite',
  '--purge-docs',
  '--if-match',
  '--target-if-match',
  '--task-if-match',
  '--create-only',
  '--content',
  '--append',
  '--unset',
  '--type',
  '--status',
  '--milestone',
  '--epic',
  '--priority',
  '--all-projects',
  '--target-date',
  '--body',
  '--title',
  '--max-bytes',
  '--max-lines',
  '--max-items',
  '--allow-remote',
  '--resume-note',
  '--next-action',
  '--goals',
  '--key-doc',
  '--summary',
  '--rationale',
  '--link',
  '--depends-on',
  '--confirm',
  '--reason',
  '--save',
  '--id',
]);

function option(key: string): string | undefined {
  const inline = args.findIndex(a => a.startsWith(key + '='));
  if (inline >= 0) {
    const value = args[inline].slice(key.length + 1);
    args.splice(inline, 1);
    return value;
  }
  const at = args.indexOf(key);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value === undefined || KNOWN_FLAGS.has(value.split('=')[0])) {
    throw new Error('Missing value for ' + key);
  }
  args.splice(at, 2);
  return value;
}

function optionAll(key: string): string[] {
  const values: string[] = [];
  while (true) {
    const v = option(key);
    if (v === undefined) break;
    values.push(v);
  }
  return values;
}

function integerOption(key: string): number | undefined {
  const value = option(key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${key} must be a safe integer`);
  }
  return parsed;
}

function flag(key: string): boolean {
  const at = args.indexOf(key);
  if (at < 0) return false;
  args.splice(at, 1);
  return true;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const selector = option('--project');
  const json = flag('--json');
  let result: unknown;

  switch (command) {
    case 'import': {
      const key = option('--key');
      const name = option('--name');
      const reuseDocs = option('--reuse-docs');
      if (!args[0]) throw new Error('Usage: localatlas import <directory> [--key <KEY>] [--name <name>] [--reuse-docs <uuid>]');
      result = await importProject(args[0], { key, name, reuseDocs });
      break;
    }
    case 'projects':
      result = await projects();
      break;
    case 'project': {
      const sub = args.shift();
      if (sub === 'update') {
        const name = option('--name');
        const key = option('--key');
        const force = flag('--force');
        result = await updateProject(selector ?? args[0], { name, key }, { force });
      } else if (sub === 'relink') {
        const target = selector ?? args.shift();
        const sourcePath = args[0];
        if (!target || !sourcePath) throw new Error('Usage: localatlas project relink <id|key|name> <new-source-path>');
        result = await relinkProject(target, sourcePath);
      } else if (sub === 'remove') {
        const purgeDocs = flag('--purge-docs');
        const target = args[0] ?? selector;
        if (!target) throw new Error('Usage: localatlas project remove <id|key|name> [--purge-docs]');
        result = await removeProject(target, { purgeDocs });
      } else {
        throw new Error('Usage: localatlas project <update|relink|remove>');
      }
      break;
    }
    case 'status': {
      const proj = await selectProject(selector);
      result = await getProjectStatusWithGit(proj);
      break;
    }
    case 'context': {
      const maxBytes = integerOption('--max-bytes');
      const maxLines = integerOption('--max-lines');
      const maxItems = integerOption('--max-items');
      const taskId = option('--task');
      const proj = await selectProject(selector);
      const ctx = taskId
        ? await generateTaskAgentContext(proj, taskId, { maxBytes, maxLines })
        : await generateAgentContext(proj, { maxBytes, maxLines, maxItems });
      result = json ? ('json' in ctx ? ctx.json : ctx) : ctx.text;
      break;
    }
    case 'session': {
      const sub = args.shift();
      const proj = await selectProject(selector);
      if (sub === 'create') {
        const taskId = option('--task');
        const title = option('--title');
        const resumeNote = option('--resume-note');
        const nextAction = option('--next-action');
        if (!resumeNote || !nextAction) {
          throw new Error('Usage: localatlas session create --resume-note <text> --next-action <text> [--task <id>] [--title <text>]');
        }
        result = await createAgentSession(proj, { taskId, title, resumeNote, nextAction });
      } else if (sub === 'list') {
        const taskId = option('--task');
        const status = option('--status') as any;
        result = await listAgentSessions(proj, { taskId, status });
      } else if (sub === 'read') {
        const target = args[0];
        if (!target) throw new Error('Usage: localatlas session read <id|path>');
        result = await readAgentSession(proj, target);
      } else if (sub === 'update') {
        const status = option('--status') as any;
        const resumeNote = option('--resume-note');
        const nextAction = option('--next-action');
        const ifMatch = option('--if-match');
        const target = args[0];
        if (!target) throw new Error('Usage: localatlas session update <id|path> [--status active|paused|completed] [--resume-note <text>] [--next-action <text>]');
        result = await updateAgentSession(proj, target, { status, resumeNote, nextAction, ifMatch });
      } else {
        throw new Error('Usage: localatlas session <create|list|read|update>');
      }
      break;
    }
    case 'agents-md': {
      result = getAgentsMdSnippet();
      break;
    }
    case 'docs': {
      const type = option('--type');
      const status = option('--status');
      const milestone = option('--milestone');
      const epic = option('--epic');
      const priority = option('--priority');
      const proj = await selectProject(selector);
      if (type || status || milestone || epic || priority) {
        result = await listDocsFiltered(proj, { type, status, milestone, epic, priority });
      } else {
        result = await listDocs(proj);
      }
      break;
    }
    case 'read': {
      if (!args[0]) throw new Error('Usage: localatlas read <document.md|id>');
      const proj = await selectProject(selector);
      result = json ? await readDocWithMeta(proj, args[0]) : await readDoc(proj, args[0]);
      break;
    }
    case 'write': {
      const ifMatch = option('--if-match');
      const contentOpt = option('--content');
      const appendOpt = option('--append');
      const createOnly = flag('--create-only');
      if (!args[0] || (contentOpt !== undefined && appendOpt !== undefined)) {
        throw new Error(
          'Usage: localatlas write <document.md> [--if-match <etag>] [--create-only] [--content <text> | --append <text>]'
        );
      }
      const proj = await selectProject(selector);
      const body = appendOpt !== undefined ? appendOpt : contentOpt !== undefined ? contentOpt : await readStdin();
      const saved = await writeDoc(proj, args[0], body, {
        ifMatch,
        createOnly,
        append: appendOpt !== undefined,
      });
      result = json ? { ok: true, ...saved } : 'Saved ' + saved.path;
      break;
    }
    case 'meta': {
      const sub = args.shift();
      if (sub !== 'set' || !args[0]) {
        throw new Error('Usage: localatlas meta set <doc.md|id> [key=val...] [--unset <key>] [--if-match <etag>]');
      }
      const ifMatch = option('--if-match');
      const unsetKeys = optionAll('--unset');
      const targetDoc = args.shift()!;
      const patch: Record<string, string> = {};
      for (const pair of args) {
        const eq = pair.indexOf('=');
        if (eq <= 0) throw new Error(`Invalid key=value argument "${pair}"`);
        patch[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      const proj = await selectProject(selector);
      const updated = await updateFrontmatter(proj, targetDoc, patch, { ifMatch, unsetKeys });
      result = json ? { ok: true, ...updated } : `Updated frontmatter for ${updated.path}`;
      break;
    }
    case 'reindex': {
      const proj = await selectProject(selector);
      result = await reindexProject(proj);
      break;
    }
    case 'search': {
      const type = option('--type');
      const status = option('--status');
      const milestone = option('--milestone');
      const epic = option('--epic');
      const priority = option('--priority');
      const allProjects = flag('--all-projects');
      const query = args.join(' ');
      const proj = allProjects && !selector ? null : await selectProject(selector);
      result = await searchDocs(proj, query, { type, status, milestone, epic, priority, allProjects });
      break;
    }
    case 'backlinks': {
      if (!args[0]) throw new Error('Usage: localatlas backlinks <doc.md|id>');
      const proj = await selectProject(selector);
      result = await getBacklinks(proj, args[0]);
      break;
    }
    case 'task': {
      const sub = args.shift();
      const proj = await selectProject(selector);
      switch (sub) {
        case 'create': {
          const priority = option('--priority') as any;
          const status = option('--status') as any;
          const epic = option('--epic');
          const milestone = option('--milestone');
          const body = option('--body');
          const title = args.join(' ').trim();
          if (!title) throw new Error('Usage: localatlas task create <title> [--priority ...] [--status ...] [--epic ...] [--milestone ...]');
          result = await createTask(proj, { title, priority, status, epic, milestone, body });
          break;
        }
        case 'promote': {
          const priority = option('--priority') as any;
          const status = option('--status') as any;
          const epic = option('--epic');
          const milestone = option('--milestone');
          const ifMatch = option('--if-match');
          const docPath = args[0];
          if (!docPath) throw new Error('Usage: localatlas task promote <doc.md> [--priority ...] [--status ...] [--epic ...] [--milestone ...]');
          result = await promoteNoteToTask(proj, docPath, { priority, status, epic, milestone, ifMatch });
          break;
        }
        case 'list': {
          const status = option('--status');
          const priority = option('--priority');
          const milestone = option('--milestone');
          const epic = option('--epic');
          result = await listTasks(proj, { status, priority, milestone, epic });
          break;
        }
        case 'update': {
          const status = option('--status') as any;
          const priority = option('--priority') as any;
          const epic = option('--epic');
          const milestone = option('--milestone');
          const title = option('--title');
          const body = option('--body');
          const ifMatch = option('--if-match');
          const id = args[0];
          if (!id) throw new Error('Usage: localatlas task update <id> [--status ...] [--priority ...] [--epic ...] [--milestone ...]');
          result = await updateTask(proj, id, { status, priority, epic, milestone, title, body, ifMatch });
          break;
        }
        case 'impact': {
          const status = option('--status') as any;
          const priority = option('--priority') as any;
          const epic = option('--epic');
          const milestone = option('--milestone');
          const title = option('--title');
          const body = option('--body');
          const dependsOn = optionAll('--depends-on');
          const id = args[0];
          if (!id) throw new Error('Usage: localatlas task impact <id> [--priority ...] [--status ...] [--epic ...] [--milestone ...] [--depends-on <id>]');
          result = await previewTaskImpact(proj, id, {
            status,
            priority,
            epic,
            milestone,
            title,
            body,
            dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
          });
          break;
        }
        case 'propose': {
          const status = option('--status') as any;
          const priority = option('--priority') as any;
          const epic = option('--epic');
          const milestone = option('--milestone');
          const title = option('--title');
          const body = option('--body');
          const dependsOn = optionAll('--depends-on');
          const id = args[0];
          if (!id) throw new Error('Usage: localatlas task propose <id> [--priority ...] [--status ...] [--epic ...] [--milestone ...] [--depends-on <id>]');
          result = await createTaskChangeProposal(proj, id, {
            status,
            priority,
            epic,
            milestone,
            title,
            body,
            dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
          });
          break;
        }
        case 'proposals': {
          const taskId = option('--task');
          const status = option('--status') as any;
          result = await listTaskChangeProposals(proj, { taskId, status });
          break;
        }
        case 'confirm': {
          const confirmed = flag('--confirm');
          const ifMatch = option('--if-match');
          const taskIfMatch = option('--task-if-match');
          const proposalId = args[0];
          if (!proposalId) throw new Error('Usage: localatlas task confirm <proposal-id> --confirm [--if-match <etag>] [--task-if-match <etag>]');
          result = await confirmTaskChangeProposal(proj, proposalId, { confirmed, ifMatch, taskIfMatch });
          break;
        }
        case 'reject': {
          const reason = option('--reason');
          const ifMatch = option('--if-match');
          const proposalId = args[0];
          if (!proposalId) throw new Error('Usage: localatlas task reject <proposal-id> [--reason <text>] [--if-match <etag>]');
          result = await rejectTaskChangeProposal(proj, proposalId, { reason, ifMatch });
          break;
        }
        default:
          throw new Error('Usage: localatlas task <create|promote|list|update|impact|propose|proposals|confirm|reject>');
      }
      break;
    }
    case 'profile': {
      const sub = args.shift() ?? 'show';
      const proj = await selectProject(selector);
      if (sub === 'show' || sub === 'read') {
        result = await readProjectProfile(proj);
      } else if (sub === 'update' || sub === 'set') {
        const status = option('--status') as any;
        const goals = option('--goals');
        const keyDocs = optionAll('--key-doc');
        const ifMatch = option('--if-match');
        result = await updateProjectProfile(proj, {
          status,
          goals,
          keyDocs: keyDocs.length > 0 ? keyDocs : undefined,
          ifMatch,
        });
      } else if (sub === 'decide' || sub === 'decision') {
        const summary = option('--summary') ?? args.join(' ').trim();
        const rationale = option('--rationale');
        const links = optionAll('--link');
        const ifMatch = option('--if-match');
        if (!summary) throw new Error('Usage: localatlas profile decide --summary <text> [--rationale <text>] [--link <doc>]');
        result = await recordProjectDecision(proj, { summary, rationale, links, ifMatch });
      } else {
        throw new Error('Usage: localatlas profile <show|update|decide>');
      }
      break;
    }
    case 'recap': {
      const sub = args.shift() ?? 'draft';
      const proj = await selectProject(selector);
      if (sub === 'draft' || sub === 'generate') {
        const save = flag('--save');
        const draft = await generateProjectRecapDraft(proj, { save });
        result = json ? draft : draft.markdown;
      } else if (sub === 'list') {
        result = await listProjectRecaps(proj);
      } else if (sub === 'read') {
        const id = args[0];
        if (!id) throw new Error('Usage: localatlas recap read <id|path>');
        const rec = await readProjectRecap(proj, id);
        result = json ? rec : rec.body;
      } else {
        throw new Error('Usage: localatlas recap <draft|list|read> [--save]');
      }
      break;
    }
    case 'epic': {
      const sub = args.shift();
      const proj = await selectProject(selector);
      if (sub === 'create') {
        const status = option('--status') as any;
        const milestone = option('--milestone');
        const body = option('--body');
        const title = args.join(' ').trim();
        if (!title) throw new Error('Usage: localatlas epic create <title> [--status ...] [--milestone ...]');
        result = await createEpic(proj, { title, status, milestone, body });
      } else if (sub === 'list') {
        result = (await getProjectRollup(proj)).epics;
      } else {
        throw new Error('Usage: localatlas epic <create|list>');
      }
      break;
    }
    case 'milestone': {
      const sub = args.shift();
      const proj = await selectProject(selector);
      if (sub === 'create') {
        const status = option('--status') as any;
        const targetDate = option('--target-date');
        const body = option('--body');
        const title = args.join(' ').trim();
        if (!title) throw new Error('Usage: localatlas milestone create <title> [--target-date ...] [--status ...]');
        result = await createMilestone(proj, { title, status, targetDate, body });
      } else if (sub === 'list') {
        result = (await getProjectRollup(proj)).milestones;
      } else {
        throw new Error('Usage: localatlas milestone <create|list>');
      }
      break;
    }
    case 'rollup': {
      const proj = await selectProject(selector);
      result = await getProjectRollup(proj);
      break;
    }
    case 'portfolio': {
      result = await getPortfolioSummary();
      break;
    }
    case 'template':
    case 'templates': {
      const sub = args.shift() ?? 'list';
      if (sub === 'list') {
        result = listDocTemplates();
      } else if (sub === 'create' || sub === 'apply') {
        const templateId = args.shift();
        const docPath = args.shift();
        const title = option('--title');
        const docId = option('--id');
        const status = option('--status');
        if (!templateId || !docPath) {
          throw new Error('Usage: localatlas template create <template-id> <path.md> [--title <text>] [--id <doc-id>] [--status <status>]');
        }
        const proj = await selectProject(selector);
        result = await createDocFromTemplate(proj, { templateId, path: docPath, title, docId, status });
      } else {
        throw new Error('Usage: localatlas template <list|create>');
      }
      break;
    }
    case 'traceability': {
      const proj = await selectProject(selector);
      result = await getProjectTaskTraceability(proj);
      break;
    }
    case 'health': {
      const proj = await selectProject(selector);
      result = await analyzeProjectHealth(proj);
      break;
    }
    case 'move':
    case 'mv': {
      const ifMatch = option('--if-match');
      const targetIfMatch = option('--target-if-match');
      const overwrite = flag('--overwrite');
      const force = flag('--force') || overwrite;
      if (!args[0] || !args[1]) {
        throw new Error('Usage: localatlas move <from.md> <to.md> [--overwrite] [--if-match <etag>] [--target-if-match <etag>]');
      }
      const proj = await selectProject(selector);
      const moved = await moveDoc(proj, args[0], args[1], { ifMatch, targetIfMatch, overwrite: force });
      result = json ? { ok: true, ...moved } : `Moved ${moved.from} -> ${moved.path}`;
      break;
    }
    case 'delete':
    case 'rm': {
      const ifMatch = option('--if-match');
      if (!args[0]) throw new Error('Usage: localatlas delete <document.md> [--if-match <etag>]');
      const proj = await selectProject(selector);
      const deleted = await deleteDoc(proj, args[0], { ifMatch });
      result = json ? { ok: true, ...deleted } : `Deleted ${deleted.deleted}`;
      break;
    }
    case 'backup': {
      if (!args[0]) throw new Error('Usage: localatlas backup <target-directory>');
      result = await backupWorkspace(args[0]);
      break;
    }
    case 'restore': {
      const force = flag('--force');
      if (!args[0]) throw new Error('Usage: localatlas restore <backup-directory> [--force]');
      result = await restoreWorkspace(args[0], { force });
      break;
    }
    case 'serve': {
      const allowRemote = flag('--allow-remote') || process.env.LOCALATLAS_ALLOW_REMOTE === 'true';
      if (allowRemote) {
        process.env.LOCALATLAS_ALLOW_REMOTE = 'true';
      }
      const host = '127.0.0.1';
      const port = Number(process.env.PORT ?? 3456);
      const releaseServerLock = await registerServerLock();
      const watcher = await startWorkspaceWatcher();
      const cleanup = () => {
        Promise.all([watcher.close(), releaseServerLock()]).finally(() => process.exit(0));
      };
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
      serve({ fetch: app.fetch, hostname: host, port });
      console.log('LocalAtlas running at http://' + host + ':' + port);
      return;
    }
    default:
      console.log(
        'LocalAtlas CLI\n' +
        '  import <path> | projects | project <update|relink|remove> | profile <show|update|decide> | status | context [--task <id>] | agents-md\n' +
        '  docs | read <file.md|id> | write <file.md> | meta set <doc> <k=v> | move <from.md> <to.md> | delete <file.md>\n' +
        '  search <query> | backlinks <doc|id> | reindex | task <create|promote|list|update|impact|propose|proposals|confirm|reject>\n' +
        '  session <create|list|read|update> | recap <draft|list|read> | epic <create|list> | milestone <create|list> | rollup | backup <dir> | restore <dir> | serve\n' +
        '  Options: --project <id|key|name> --json'
      );
      return;
  }
  console.log(
    json ? JSON.stringify(result, null, 2) : typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  );
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
