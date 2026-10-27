# Agent instructions

## Scope and startup

These instructions govern agents developing the LocalAtlas repository. They are not the instructions generated for imported projects by [project-manifest.ts](src/core/project-manifest.ts).

1. Read this file and any instructions in the directories you will change. Check `git status --short`; preserve unrelated work. Do not switch branches, commit, push, or discard changes without a user request.
2. Confirm the requested outcome and read the relevant code and tests before editing. Keep fixes scoped; do not install global skills, change agent permissions, or add hosted integrations as setup shortcuts.
3. Prefer Node.js 24.x; on the 22.x line, use 22.13+ for unflagged `node:sqlite` support. Run `npm ci` for a fresh checkout or changed lockfile; use [package.json](package.json) as the command source of truth. The full test suite also needs `python3` and POSIX modules on macOS/Linux; native Windows terminal verification remains an open [release gate](docs/ROADMAP.md). Rust is additionally required for Tauri work.
4. Select only the relevant workflow below. All commands run from the repository root unless stated otherwise.

## Workflow routing

| Work | Read before acting |
| --- | --- |
| Implement, debug, review, or verify a change | [verify-localatlas-changes](.qoder/skills/verify-localatlas-changes/SKILL.md) |
| Create, list, update, or promote LocalAtlas tasks while developing this repo | [manage-localatlas-tasks](.qoder/skills/manage-localatlas-tasks/SKILL.md) |
| Change storage, project boundaries, file formats, or public commands | [Vision](docs/VISION.md), [Architecture](docs/ARCHITECTURE.md), [File format](docs/FILE_FORMAT.md), and [Roadmap](docs/ROADMAP.md), then the verification skill |
| Change UI behavior | Verification skill's browser section and the relevant [browser tests](e2e/ui.spec.ts) |
| Change native packaging or terminal/Codex integration | Verification skill and the open release gates in [Roadmap](docs/ROADMAP.md) |

Project skills live in `.qoder/skills/`. Use the matching skill if the agent exposes it; otherwise read its linked `SKILL.md` directly. Do not assume global plugins, slash commands, or automatic discovery in another agent. These files are the shared workflow source; do not copy them into tool-specific variants.

## Code and test map

| Area | Entry points | Checks |
| --- | --- | --- |
| Shared business logic and persistence | [Core exports](src/core/index.ts), [compatibility facade](src/core.ts) | [Core tests](test/core.test.ts), milestone suites in `test/` |
| CLI and HTTP adapters | [CLI](src/cli.ts), [server](src/server.ts) | CLI/core/API cases in `test/` |
| React UI, state, styles | [UI entry](src/ui/app.js), [Vite config](vite.config.js) | [UI-state tests](test/ui-state.test.ts), [browser tests](e2e/ui.spec.ts), actual browser use |
| Desktop lifecycle and packaging | [Rust launcher](src-tauri/src/main.rs), [preparation script](scripts/prepare-tauri.mjs) | [Packaging tests](test/m6.test.ts), native build and smoke checks |
| Contributor agent setup | This file and `.qoder/skills/` | [Setup checks](test/agent-setup.test.ts), read-only agent workflow scenarios |

`src/ui` is JavaScript: TypeScript checks do not validate it. Edit UI sources, not generated `public/app.js` or `dist/` output. `npm run dev` builds the UI once and watches the backend; run `npm run build:ui` and reload after subsequent UI edits.

## Architectural boundaries

- Do not introduce MCP, hosted services, or a Bitbucket replacement.
- Keep Tauri, web, and CLI on the shared Node.js core. Keep localhost-only defaults and existing Host/Origin checks; do not relax security to make a test pass.
- Never modify an imported repository during import, relink, or Atlas document operations. User-requested source edits are separate from Atlas workspace operations.
- Treat Markdown as canonical document data and indexes as rebuildable. Preserve unknown frontmatter and unrelated body content.
- Preserve project-scoped context, path/symlink protections, atomic writes, locks, and ETag preconditions. Reuse core operations rather than bypassing them in an adapter.

## Tasks and data safety

- Always use the LocalAtlas CLI to create, update, or list tasks. Never handwrite task Markdown, including when converting a backlog into tasks; create each task through the CLI and verify the list.
- In this checkout use `npm run cli -- <command>`; no global `localatlas` executable is required. Explicitly pass `--project` for task/document operations.
- Read a task with `read <id> --json` and pass its fresh `etag` to `task update --if-match`. On conflict, reread and reconcile rather than dropping the precondition. Follow the task skill for exact commands.
- For requested real task management, use the intended workspace. For tests and manual smoke checks, set an absolute, disposable `LOCALATLAS_HOME` outside fixture source repositories; keep home and source as siblings. Never experiment against the default `~/.localatlas` or import the user's repositories just for a test. Even project listing can initialize workspace metadata.

## Completion evidence

Run `npm run typecheck`, `npm run build`, then `npm test` before proposing merge. Add the workflow-specific browser or native checks from the verification skill; focused tests alone do not replace the full gate.

Report the changed behavior, commands actually run and their results, and any unverified checks or blockers. Never report a milestone, UI workflow, packaging target, or real Codex integration done based only on compilation or mocks. Do not claim a skill was automatically loaded merely because its file exists.
