# LocalAtlas

Local-first, multi-project documentation workspace for independent developers. Import folders without copying or modifying their source repositories. Humans can use a Tauri desktop app or local browser interface; coding agents and developers can use the CLI.

## Current status (M0–M7 foundation; local project workspace in progress)

Requires Node.js 22.5+.

```bash
npm install
npm run build
npm run typecheck
npm test
npx playwright install chromium # one-time setup for the browser UI test
npm run test:e2e

# Run CLI directly or via npm
npm run cli -- import /absolute/path/to/project --key SAV
npm run cli -- status
npm run cli -- context
npm run dev # or npm start
# Open http://127.0.0.1:3456

# Tauri desktop app (requires Rust; the Tauri CLI is installed with npm dependencies)
npm run tauri:dev
npm run tauri:build
```

### CLI Commands

- **Project Management & Profile**:
  - `localatlas import <path> [--key <KEY>] [--name <name>]`
  - `localatlas projects [--json]`
  - `localatlas project update <id|key> [--name <name>] [--path <new-path>]`
  - `localatlas project remove <id|key> [--purge-docs]`
  - `localatlas profile show`
  - `localatlas profile update [--status active|paused|completed|archived] [--goals <text>] [--key-doc <doc.md|id>...]`
  - `localatlas profile decide <summary> [--rationale <text>] [--link <doc.md|id>...]`
  - `localatlas status` (includes branch, HEAD commit, dirty count, recent commits without repository mutation)
- **Document Management**:
  - `localatlas docs [--type <type>] [--status <status>] [--milestone <id>] [--epic <id>]`
  - `localatlas read <file.md|id> [--json]`
  - `localatlas write <file.md|id> [--if-match <etag>] [--create-only] [--content <text> | --append <text>]`
  - `localatlas move <from.md|id> <to.md> [--overwrite] [--if-match <etag>] [--target-if-match <etag>]`
  - `localatlas delete <file.md|id> [--if-match <etag>]`
  - `localatlas meta set <file.md|id> <key=val...> [--unset <key>] [--if-match <etag>]`
  - `localatlas search <query> [--type <t>] [--status <s>] [--milestone <m>] [--epic <e>] [--all-projects]`
  - `localatlas backlinks <doc.md|id>`
  - `localatlas reindex`
- **Structured Tasks, Change Proposals, Epics & Milestones**:
  - `localatlas task create <title> [--priority low|medium|high|critical] [--status todo|in_progress|blocked|done|cancelled] [--epic <id>] [--milestone <id>] [--depends-on <id,id>]`
  - `localatlas task list [--status <s>] [--priority <p>] [--epic <e>] [--milestone <m>]`
  - `localatlas task update <task-id> [--status <s>] [--priority <p>] [--epic <e>] [--milestone <m>] [--title <t>] [--depends-on <id,id>] [--if-match <etag>]`
  - `localatlas task context <task-id> [--max-bytes <n>] [--max-lines <n>] [--max-items <n>]`
  - `localatlas task impact <task-id> [--status <s>] [--priority <p>] [--epic <e>] [--milestone <m>] [--depends-on <id,id>] [--scope-summary <text>]`
  - `localatlas task propose <task-id> [--status <s>] [--priority <p>] [--epic <e>] [--milestone <m>] [--depends-on <id,id>] [--scope-summary <text>] [--rationale <text>]`
  - `localatlas task proposals [--status pending|confirmed|rejected] [--task <task-id>]`
  - `localatlas task confirm <proposal-id> --confirm [--if-match <etag>]`
  - `localatlas task reject <proposal-id> [--reason <text>] [--if-match <etag>]`
  - `localatlas task promote <note.md>`
  - `localatlas epic create <title>` / `localatlas epic list`
  - `localatlas milestone create <title>` / `localatlas milestone list`
  - `localatlas rollup`
- **Coding Agent DX, Sessions & Project Recaps**:
  - `localatlas context [--json] [--max-bytes <n>] [--max-lines <n>] [--max-items <n>]`
  - `localatlas session start [--task <task-id>] [--title <text>] [--resume <text>] [--next <text>] [--no-git]`
  - `localatlas session list [--status active|paused|completed] [--task <task-id>]`
  - `localatlas session read <session-id>`
  - `localatlas session update <session-id> [--status <s>] [--task <task-id>] [--resume <text>] [--next <text>] [--if-match <etag>]`
  - `localatlas recap draft [--title <text>] [--since-days <n>] [--save]`
  - `localatlas recap list`
  - `localatlas recap read <recap-id|path>`
  - `localatlas portfolio [--json]` (cross-project health summary and action queue)
  - `localatlas template list` / `localatlas template create <template-id> [--title <text>] [--path <relPath>] [--task <task-id>]`
  - `localatlas traceability [--limit <n>]` (Git commit-to-task traceability, active session claims, DoD status)
  - `localatlas health` (broken wiki-links, orphan docs, bottleneck tasks, DoD audit, health score)
  - `localatlas agents-md` (prints standard agent workflow instructions)
- **Workspace Administration**:
  - `localatlas serve [--port <3456>] [--host <127.0.0.1>]`
  - `localatlas backup <dir>`
  - `localatlas restore <dir> [--force]`

Use `--project <id|key|name>` when running outside a registered repository; use `--json` for structured machine-readable JSON.

### Architecture & Storage

App data defaults to `~/.localatlas`; override with `LOCALATLAS_HOME`.
- **Database**: `~/.localatlas/atlas.db` (SQLite in WAL mode, busy timeout resilience, rebuildable FTS5 index, backlink graph, and task caches).
- **Projects & documents**: each `~/.localatlas/projects/<uuid>/` folder contains `project.md` (the source-path record), `AGENTS.md` (agent entry instructions), and a `docs/` tree of canonical Markdown files with YAML frontmatter. The SQLite registry indexes each project's source path from its record.
- **Web UI**: Offline React + HeroUI portfolio for multiple projects, with project overviews, separate editable Atlas docs and read-only repository Markdown, task board/list/roadmap, and recent Git activity.
- **Desktop app**: Tauri v2 opens the existing local UI in a native window and starts the shared backend with Node.js 22.5+ installed on the machine. Set `LOCALATLAS_NODE_PATH` if Node is not on `PATH`. CLI and web-server use remain available.
- **Coding-agent terminal**: Open a project-scoped local shell in the Terminal panel, launch Codex CLI with the registered source directory available for code work, and print the bounded project context from the Context button.
- **Security**: Loopback-only (`127.0.0.1`), `Host`/`Origin`/`Sec-Fetch-Site` header enforcement, strictly side-effect-free Git adapter (`--no-optional-locks -c core.fsmonitor=false -c gc.auto=0`).

Read [vision](docs/VISION.md), [architecture](docs/ARCHITECTURE.md), [file format](docs/FILE_FORMAT.md), [roadmap](docs/ROADMAP.md), and [agent guidelines](AGENTS.md).
