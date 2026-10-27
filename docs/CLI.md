# CLI reference

The LocalAtlas CLI works from a registered source repository or managed workspace. When running elsewhere, use `--project <id|key|name>` to choose a project. Add `--json` to commands that support machine-readable output.

Run commands through the repository during development:

```bash
npm run cli -- <command> [options]
```

## Project management and profile

- `localatlas import <path> [--key <KEY>] [--name <name>]`
- `localatlas projects [--json]`
- `localatlas project update <id|key> [--name <name>] [--path <new-path>]`
- `localatlas project remove <id|key> [--purge-docs]`
- `localatlas profile show`
- `localatlas profile update [--status active|paused|completed|archived] [--goals <text>] [--key-doc <doc.md|id>...]`
- `localatlas profile decide <summary> [--rationale <text>] [--link <doc.md|id>...]`
- `localatlas status` — branch, HEAD commit, dirty count, and recent commits; Git is read-only.

## Documents

- `localatlas docs [--type <type>] [--status <status>] [--milestone <id>] [--epic <id>]`
- `localatlas read <file.md|id> [--json]`
- `localatlas write <file.md|id> [--if-match <etag>] [--create-only] [--content <text> | --append <text>]`
- `localatlas move <from.md|id> <to.md> [--overwrite] [--if-match <etag>] [--target-if-match <etag>]`
- `localatlas delete <file.md|id> [--if-match <etag>]`
- `localatlas meta set <file.md|id> <key=val...> [--unset <key>] [--if-match <etag>]`
- `localatlas search <query> [--type <t>] [--status <s>] [--milestone <m>] [--epic <e>] [--all-projects]`
- `localatlas backlinks <doc.md|id>`
- `localatlas reindex`

## Tasks, proposals, epics, and milestones

- `localatlas task create <title> [--priority low|medium|high|critical] [--status todo|in_progress|blocked|done|cancelled] [--epic <id>] [--milestone <id>] [--depends-on <task-id> ...] [--body <markdown>]`
- `localatlas task list [--status <s>] [--priority <p>] [--epic <e>] [--milestone <m>]`
- `localatlas task docs <task-id>` / `GET /api/projects/:id/tasks/:taskId/documents`
- `localatlas task update <task-id> [--status <s>] [--priority <p>] [--epic <e>] [--milestone <m>] [--title <t>] [--body <markdown>] [--if-match <etag>]`
- `localatlas task context <task-id> [--max-bytes <n>] [--max-lines <n>] [--max-items <n>]`
- `localatlas task impact <task-id> [--status <s>] [--priority <p>] [--epic <e>] [--milestone <m>] [--depends-on <task-id> ...] [--clear-dependencies] [--scope-summary <text>]`
- `localatlas task propose <task-id> [--status <s>] [--priority <p>] [--epic <e>] [--milestone <m>] [--depends-on <task-id> ...] [--clear-dependencies] [--scope-summary <text>] [--rationale <text>]`
- `localatlas task proposals [--status pending|confirmed|rejected] [--task <task-id>]`
- `localatlas task confirm <proposal-id> --confirm [--if-match <etag>]`
- `localatlas task reject <proposal-id> [--reason <text>] [--if-match <etag>]`
- `localatlas task promote <note.md> [--priority <p>] [--status <s>] [--epic <e>] [--milestone <m>] [--if-match <etag>]`
- `localatlas epic create <title>` / `localatlas epic list`
- `localatlas milestone create <title>` / `localatlas milestone list`
- `localatlas rollup`

Pass `--project <id|key|name>` explicitly when managing tasks across projects. `task docs` resolves Markdown links in the task body to project documents and returns `task`, `documents` (`path`, `id`, `title`, `type`, `status`, `isTask`, `refs`), `unresolved`, `unresolvedTruncated`, and `truncated`; `refs` preserves the raw wiki-link or Markdown-link targets that resolved to that document. It is read-only, examines at most 100 link candidates, and caps resolved documents and unresolved references at 20 each. `read <id> --json` returns top-level `etag`, `path`, `content` (including frontmatter), `frontmatter`, and `docId`. Task updates do not automatically guard a previous read: pass its fresh `etag` with `--if-match`, then reread and reconcile on conflict. `--body` replaces the whole Markdown body, including its heading; use `write --append` with a fresh ETag for additions. New tasks may be created with same-project dependencies. Dependency changes on existing tasks go through `task propose` and require `task confirm <proposal-id> --confirm`; use `--clear-dependencies` to remove all dependencies. The task `PATCH` endpoint accepts only `status`, `priority`, `epic`, `milestone`, `title`, `body`, and `ifMatch`; unsupported fields return `400`, and dependency changes must use the proposal endpoints. Self, missing/cross-project IDs, and cycles are rejected. `done` and `cancelled` dependencies count as resolved and do not change dependent task status.

See the [contributor task workflow](../.qoder/skills/manage-localatlas-tasks/SKILL.md) for checkout-local commands and safe update examples.

## Agent context, sessions, and recaps

- `localatlas context [--json] [--max-bytes <n>] [--max-lines <n>] [--max-items <n>]`
- `localatlas session start [--task <task-id>] [--title <text>] [--resume <text>] [--next <text>] [--no-git]`
- `localatlas session list [--status active|paused|completed] [--task <task-id>]`
- `localatlas session read <session-id>`
- `localatlas session update <session-id> [--status <s>] [--task <task-id>] [--resume <text>] [--next <text>] [--if-match <etag>]`
- `localatlas recap draft [--title <text>] [--since-days <n>] [--save]`
- `localatlas recap list`
- `localatlas recap read <recap-id|path>`
- `localatlas portfolio [--json]` — cross-project health summary and action queue.
- `localatlas template list` / `localatlas template create <template-id> [--title <text>] [--path <relPath>] [--task <task-id>]`
- `localatlas traceability [--limit <n>]` — Git commit-to-task links, active session claims, and definition-of-done status.
- `localatlas health` — broken wiki links, orphan docs, bottlenecks, checklist audit, and health score.
- `localatlas agents-md` — print standard agent workflow instructions.

## Workspace administration

- `localatlas serve` — start the loopback-only server on port `3456` by default. Set `PORT` to use another port.
- `localatlas backup <dir>`
- `localatlas restore <dir> [--force]`
