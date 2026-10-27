# LocalAtlas

**A local-first workspace for project documentation, tasks, and coding-agent context.**

Import existing repositories without changing their files. Keep project plans and tasks in readable Markdown, then work with them from the browser app, desktop app, or CLI.

![LocalAtlas task board showing work across four statuses](docs/images/localatlas-task-board.png)

## What you can do

- See projects, open tasks, and recent Git activity in one workspace.
- Keep editable Atlas documents and tasks as Markdown outside imported repositories.
- Browse repository Markdown and Git history as read-only project context.
- Give coding agents bounded, project-scoped context through the shared CLI and core.
- Use the same Node.js core from the local web app, CLI, and Tauri desktop shell.

## Get started

Use Node.js 24.x where possible. The minimum supported runtime is Node.js 22.13; earlier 22.x releases require an experimental flag for `node:sqlite`.

```bash
npm install
npm run build
npm run cli -- import /absolute/path/to/project --key SAV
npm run dev
```

Open [http://127.0.0.1:3456](http://127.0.0.1:3456). LocalAtlas stores its workspace in `~/.localatlas` by default; set `LOCALATLAS_HOME` to use another location.

For a quick CLI check:

```bash
npm run cli -- projects
npm run cli -- task list --project SAV
```

See the [CLI reference](docs/CLI.md) for all commands and options.

## Desktop app

The Tauri v2 shell opens the same local interface and starts the shared Node.js backend. Rust is required for development and packaging. Interactive shell and Codex terminals are currently supported on macOS and Linux; Windows terminal support remains under development.

```bash
npm run tauri:dev
npm run tauri:build
```

The desktop app requires Node.js 22.13 or newer on the machine. Set `LOCALATLAS_NODE_PATH` if Node.js is not available on `PATH`.

## Data and security

- Markdown is the canonical source for Atlas documents, tasks, profiles, and sessions. SQLite stores the project registry and rebuildable indexes.
- Imported source files remain separate from editable Atlas documents. Import, browsing, and LocalAtlas document operations do not write to source repositories.
- The local server binds to `127.0.0.1` and validates request origins and hosts.

## Architecture diagrams

Explore the [system architecture](docs/diagrams/localatlas-system.architecture.html), the [task-scoped Codex flow](docs/diagrams/task-scoped-codex.sequence.html), or the [diagram index](docs/diagrams/README.md).

## Development

Use Node.js 24.x where possible; Node.js 22.13 is the minimum. The full test suite exercises the POSIX terminal bridge on macOS/Linux. Windows terminal support remains a separate release gate documented in [Roadmap](docs/ROADMAP.md).

Use `npm ci` for a fresh development checkout, then verify in this order:

```bash
npm run typecheck
npm run build
npm test
npx playwright install chromium # one-time setup for browser UI tests
npm run test:e2e
```

`npm run dev` builds the UI once and watches the backend. After further UI edits, run `npm run build:ui` and reload the browser. Use disposable workspace data for manual checks, not your default LocalAtlas home.

Read the [vision](docs/VISION.md), [architecture](docs/ARCHITECTURE.md), [file format](docs/FILE_FORMAT.md), and [roadmap](docs/ROADMAP.md).

### Coding-agent setup

Start with [AGENTS.md](AGENTS.md) for bootstrap, code/test routing, architectural boundaries, and completion evidence. Two repository-owned skills provide the detailed workflows:

- [verify-localatlas-changes](.qoder/skills/verify-localatlas-changes/SKILL.md): focused/full tests, isolated browser development, and native verification limits.
- [manage-localatlas-tasks](.qoder/skills/manage-localatlas-tasks/SKILL.md): project selection, checkout-local CLI commands, and conflict-safe task updates.

The skills use the project-local `.qoder/skills/<name>/SKILL.md` layout; no global plugin or configuration change is required. Use the matching skill when it appears in your agent's skill list. If your agent does not discover this layout or load `AGENTS.md`, explicitly ask it to read that file and the linked workflow; automatic loading is agent-dependent.

This setup is for developing LocalAtlas itself, not provisioning agents in imported-project workspaces. Metadata, routing links, and documented npm script names are checked by `npm test`; behavior still needs workflow checks, not just file validation.
