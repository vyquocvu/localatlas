# Roadmap

## Existing foundation

- [x] M0–M6: multi-project registry, managed Markdown documents, search, task documents, Git read-only status, bounded project context, packaging, and CI. See the backlog for the historical acceptance details.
- [x] M7: multi-project portfolio, per-project overview, editable Atlas docs, read-only repository Markdown, tasks, and recent Git activity.

## Local project workspace

- [x] Preserve a stable project identity when relinking a moved repository; unregister only the registry entry and keep source files untouched.
- [x] Store project goals/status/key-document links and decisions as managed Markdown; keep history visible and approved decisions intact.
- [x] Add task-scoped agent sessions as per-project Markdown, with resume note, next action, and optional Git evidence; expose the flow in the shared core, CLI, API, and project overview.
- [x] Add a bounded task context bundle containing only the task, direct same-project dependencies, linked Atlas docs, relevant sessions, and read-only Git state.
- [x] Add browser chat with the locally installed Codex CLI, scoped to one selected project and its bounded context; resume links are project-local and the browser offers explicit command/file-change approvals.
- [x] Prepare impact summaries for proposed scope/priority/dependency changes and require human confirmation before applying those changes.
- [x] Draft project recaps that compare task state, recent Git changes, and project docs, with blockers, stale docs, completed work, and next actions backed by links/evidence.
- [x] M10 Role-Driven Workspace Improvements: cross-project portfolio command center (`localatlas portfolio`), role-based document templates (`prd`, `adr`, `bug-report`, `release-checklist`), Git commit-to-task traceability & active session claim indicators (`localatlas traceability`), enriched bounded task context with project goals/decisions, and workspace/knowledge health check with Definition of Done (DoD) checklist guard (`localatlas health`).

## Current implementation slice

Verified implementation: safe project relinking, managed project profile and append-only decision log (`project/profile.md`), task-scoped session/context flow (`sessions/<uuid>.md`), impact analysis and human-confirmed change proposals (`proposals/<uuid>.md`), evidence-backed project recap drafts (`recaps/<timestamp>.md`), cross-project portfolio health summary, role-based document templates, Git commit-to-task traceability, workspace/knowledge health audit, and a project/task-scoped browser chat backed by the installed Codex CLI on the existing storage stack. All workspace records remain canonical Markdown under `LOCALATLAS_HOME`; imported repositories remain strictly read-only to LocalAtlas project-management operations. `dependsOn` is a same-project Markdown frontmatter list; task context follows direct dependencies and explicit links from those task documents, with bounded excerpts. The Codex app-server interface is experimental and the current ChatGPT web conversation is not imported.

## Tauri desktop conversion (in progress)

- [ ] Add a native Tauri window that starts and stops the existing Node.js backend on an ephemeral localhost port.
- [ ] Package the backend entry point and static UI as Tauri resources; launch them with a supported Node.js 22.5+ installation while preserving the existing CLI and local web-server entry point.
- [ ] Verify desktop startup, shutdown, and the existing web/CLI workflows before marking the conversion complete.
