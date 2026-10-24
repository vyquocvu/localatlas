# Roadmap

## Existing foundation

- [x] M0–M6: multi-project registry, managed Markdown documents, search, task documents, Git read-only status, bounded project context, packaging, and CI. See the backlog for the historical acceptance details.
- [x] M7: multi-project portfolio, per-project overview, editable Atlas docs, read-only repository Markdown, tasks, and recent Git activity.
- [x] Add a Chromium browser E2E job to CI on Ubuntu; upload Playwright traces when it fails. The current workflow still runs typecheck/build/Node tests across the OS matrix.

## Local project workspace

- [x] Preserve a stable project identity when relinking a moved repository; unregister only the registry entry and keep source files untouched.
- [x] Store project goals/status/key-document links and decisions as managed Markdown; keep history visible and approved decisions intact.
- [x] Add task-scoped agent sessions as per-project Markdown, with resume note, next action, and optional Git evidence; expose the flow in the shared core, CLI, API, and project overview.
- [x] Add a bounded task context bundle containing only the task, direct same-project dependencies, linked Atlas docs, relevant sessions, and read-only Git state.
- [x] Prepare impact summaries for proposed scope/priority/dependency changes and require human confirmation before applying those changes.
- [x] Draft project recaps that compare task state, recent Git changes, and project docs, with blockers, stale docs, completed work, and next actions backed by links/evidence.
- [x] M10 Role-Driven Workspace Improvements: cross-project portfolio command center (`localatlas portfolio`), role-based document templates (`prd`, `adr`, `bug-report`, `release-checklist`), Git commit-to-task traceability & active session claim indicators (`localatlas traceability`), enriched bounded task context with project goals/decisions, and workspace/knowledge health check with Definition of Done (DoD) checklist guard (`localatlas health`).

## Current implementation slice

Verified implementation: safe project relinking, managed project profile and append-only decision log (`project/profile.md`), task-scoped session/context flow (`sessions/<uuid>.md`), impact analysis and human-confirmed change proposals (`proposals/<uuid>.md`), evidence-backed project recap drafts (`recaps/<timestamp>.md`), cross-project portfolio health summary, role-based document templates, Git commit-to-task traceability, workspace/knowledge health audit, and project-scoped shell/Codex terminals. Codex launches with bounded project/task/document context; the shared CLI resolves managed workspace directories and the server watcher invalidates UI state after external CLI changes. All workspace records remain canonical Markdown under `LOCALATLAS_HOME`; imported repositories remain strictly read-only to LocalAtlas project-management operations. `dependsOn` is a same-project Markdown frontmatter list; task context follows direct dependencies and explicit links from those task documents, with bounded excerpts.

## Tauri desktop conversion (in progress)

- [x] Implement a native Tauri window that starts the shared Node.js backend on an ephemeral loopback port and stops it when the app exits (`src-tauri/src/main.rs`). The Rust code passes `cargo check --locked` and a macOS release build with `--no-bundle`.
- [x] Prepare Tauri resources for the bundled backend entry point and static UI (`scripts/prepare-tauri.mjs`, `src-tauri/tauri.conf.json`). The desktop launcher requires Node.js 22.13+; the standalone CLI and local web server retain their entry points. `npm run tauri:prepare` and the macOS release build with `--no-bundle` pass.
- [ ] Build an installable desktop bundle and smoke-test installation, first launch, backend shutdown, and restart on a clean supported machine. Verify CLI/web workflows against the same workspace and test backup/restore across an upgrade before marking desktop conversion complete.

Smoke update (2026-10-25): macOS arm64 Tauri `.app`/`.dmg` build, temporary copied-app launch/restart, unmocked task-scoped Codex CLI update, ETag reread, and backup/restore/reindex passed on the development Mac. Clean-machine install, Developer ID signing/notarization, prior-version upgrade, and Codex conversation resume remain unverified; see [desktop release smoke record](RELEASE_SMOKE.md).

## Agent workspace release readiness

- [x] Implement project-scoped shell and Codex PTYs with bounded project, task, or document launch context and a workspace-local CLI launcher. Core/API tests cover scoped launch and CLI resolution; the browser E2E test covers context preview with a stubbed terminal API.
- [ ] Run an unmocked browser workflow from project import through task-scoped Codex launch, terminal input/output, task update via CLI, and session restart. Confirm the context shown in the UI reaches the launched process.
- [ ] Implement and verify a Windows PTY backend before advertising Windows terminal support. Interactive shell and Codex terminals explicitly support macOS/Linux today; the shared core/CLI CI matrix still includes Windows.
- [ ] Add desktop packaging and unmocked agent workflow smoke tests to the release gate. CI now runs browser E2E; it does not package Tauri or verify an installed desktop app/Codex process.
