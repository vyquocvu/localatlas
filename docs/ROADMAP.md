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

Verified implementation: safe project relinking, managed project profile and append-only decision log (`project/profile.md`), task-scoped session/context flow (`sessions/<uuid>.md`), impact analysis and human-confirmed change proposals (`proposals/<uuid>.md`), evidence-backed project recap drafts (`recaps/<timestamp>.md`), cross-project portfolio health summary, role-based document templates, Git commit-to-task traceability, workspace/knowledge health audit, and project-scoped shell/Codex terminals. Task details now edit title, body/checklist, priority, epic, milestone, status, and dependency through a reviewed proposal that preserves Markdown frontmatter and content; roadmap UI can create and edit epics and milestones against actual project records with ETag preconditions. Task dependencies are normalized same-project task IDs; creation validates references, while changes to existing tasks require a proposal and explicit confirmation. Self-links, missing/cross-project IDs, cycles, stale confirmation targets, and cycles introduced after preview are rejected. Roadmap/board surfaces report legacy broken references; completed and cancelled dependencies count as resolved without automatic task status changes. The task workspace also provides project-local saved filters/sort orders and a priority-ranked “Ready to start” view that explains unresolved prerequisites without claiming or changing tasks. Codex launches with bounded project/task/document context; the shared CLI resolves managed workspace directories and the server watcher invalidates UI state after external CLI changes. All workspace records remain canonical Markdown under `LOCALATLAS_HOME`; imported repositories remain strictly read-only to LocalAtlas project-management operations. Task context follows direct dependencies and explicit links from those task documents, with bounded excerpts.

Git traceability distinguishes task IDs in commit subjects from session-start HEAD snapshots; the Git Activity UI can search bounded history by time window and commit cap, and reports searched scope/truncation while treating Git timeout or missing Git as unavailable evidence. Portfolio summary work is bounded to four projects at a time, reuses one path snapshot for task/proposal/session reads, and reports per-project stale data instead of failing the whole overview. Health analysis reuses its reconciled index for backlink checks. The portfolio attention inbox gathers blocked/critical tasks, pending proposals, paused sessions, and broken links with source paths and evidence timestamps; orphan notes stay informational, health scores are labeled heuristic, and project status filters include paused/archived. Synthetic benchmarks and environment-specific results are recorded in [performance benchmarks](PERFORMANCE_BENCHMARKS.md); rerun with `npm run benchmark:portfolio`.

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
