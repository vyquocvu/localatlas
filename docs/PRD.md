# Product Requirements Document: LocalAtlas

Status: living document, grounded in the implemented repository as of 2026-10-26.

## 1. Product vision

LocalAtlas is a local-first, Markdown-native project workspace: a "local Atlassian" for a solo developer, a small team, or a coding agent that needs durable project memory without a hosted account.

One workspace holds many imported repositories. For each project, LocalAtlas keeps goals, decisions, documents, tasks, epics, milestones, agent sessions, proposals, recaps, and evidence-backed Git context. Imported repositories stay read-only to Atlas operations. Canonical data is plain Markdown under `LOCALATLAS_HOME`; indexes are rebuildable.

## 2. Target users

| User | Need |
| --- | --- |
| Solo developer | Plan and track work across several local repositories without paying for or maintaining a hosted tracker. |
| Small team without a tracker | Share a repository-owned workflow with docs and tasks in versionable Markdown. |
| Coding-agent user | Give an agent bounded, project-scoped context and recover work after a session ends. |
| Maintainer/auditor | Verify what happened through Git evidence, task history, proposals, sessions, and health reports. |

## 3. Problem and differentiation

Hosted tools separate planning from the code and the agent. LocalAtlas keeps planning next to the working copy, exposes the same operations through a shared core, CLI, HTTP API, and desktop/web UI, and treats Markdown as canonical. It does not replace Git hosting or add a hosted collaboration service.

## 4. Core user journeys

1. **Import and orient**: import a local repository, review the project overview, recent Git activity, docs, tasks, and health.
2. **Plan**: create or promote documents, edit tasks, epics, milestones, dependencies, and roadmap items; save per-project task views.
3. **Work with an agent**: start a task-scoped shell or Codex session with bounded context; update the task through the CLI using a fresh ETag; see the UI refresh.
4. **Review and decide**: preview impact summaries for dependency changes; confirm or reject proposals. Status, priority, title, epic, milestone, and body edits apply directly under a fresh ETag.
5. **Recover and audit**: use sessions, recaps, traceability, the attention inbox, backup, restore, and health checks to recover and verify work.
6. **Navigate knowledge**: move from a task to its linked documents and from a document to its linked mentions.

## 5. MVP boundary

### In scope and implemented

- Multi-project registry, import, relink, unregister, project-scoped storage and path protections.
- Managed Atlas Markdown: documents, search, backlinks, drafts, conflict handling, ETag preconditions.
- Read-only repository Markdown and Git status/activity.
- Tasks, epics, milestones, checklists, dependencies, proposals, impact summaries, rollup, saved views, ready-to-start queue.
- Task-scoped context bundles, agent sessions, recaps, and project-scoped shell/Codex terminals on macOS/Linux.
- Portfolio summary, attention inbox, workspace/knowledge health, Git-to-task traceability.
- Task details linked-document navigation plus add/remove through the confirmed proposal flow (added 2026-10-27).
- Experimental HTTP Codex chat routes are retained as internal-only implementation details; the unused browser store is not imported, and the supported agent path is the project-scoped Codex CLI PTY.
- Local web UI, CLI, HTTP API, Tauri desktop shell and native macOS build (implemented; clean-machine, upgrade, and signing verification remain release gates), backup/restore.

### Out of scope

- Hosted multi-tenant collaboration, cloud sync, remote accounts.
- Replacing Bitbucket/GitHub hosting.
- MCP or other hosted integrations.
- Bitbucket-style permissions or review workflows.
- Windows terminal support until a PTY backend is implemented and verified.
- Developer ID signing/notarization without founder approval and Apple credentials.

## 6. Measurable acceptance criteria

| ID | Criterion | Evidence required |
| --- | --- | --- |
| PRD-1 | A new user can import a repository and see project overview, docs, tasks, and Git activity. | Browser E2E journey; `npm run test:e2e`. |
| PRD-2 | All workspace data survives restart and can be backed up, verified, and restored. | Backup/restore tests; release smoke record. |
| PRD-3 | Imported repositories remain byte-for-byte untouched by import, relink, task, and document operations. | Import/relink snapshot and Git-status tests; task/document tests use managed Atlas storage only. |
| PRD-4 | Dependency changes require a preview and explicit confirmation; other task fields update directly only with a fresh ETag, and stale ETags are rejected. | Core/API/UI tests; proposal flow E2E. |
| PRD-5 | An agent receives only bounded, project-scoped context; cross-project links do not widen bundles or linked-document lists. | Context tests; project-isolation assertions in `test/task-documents.test.ts`. |
| PRD-6 | Task details show resolved linked documents, broken links, navigation, and add/remove of links without silently changing unrelated body text. | `test/task-documents.test.ts`; browser E2E link picker case. |
| PRD-7 | UI empty, loading, error, and conflict states are explicit; no silent overwrite. | UI-state tests; browser E2E. |
| PRD-8 | Typecheck, build, and the full Node suite pass before merge. | `npm run typecheck`, `npm run build`, `npm test`. |
| PRD-9 | Desktop release is not claimed until clean-machine install, restart, upgrade, and signing/notarization are verified. | `docs/RELEASE_SMOKE.md`; roadmap gates. |

## 7. Non-functional requirements

- **Local by default**: loopback binding, Host/Origin checks, no external CDN assets.
- **Data safety**: atomic writes, locks, ETag preconditions, path/symlink confinement, offline restore semantics.
- **Portability**: Node.js 24.x preferred, 22.13 minimum; macOS/Linux terminals today; native Windows remains a gate.
- **Performance**: portfolio summary processes four projects concurrently by default (maximum eight); benchmarks recorded in `docs/PERFORMANCE_BENCHMARKS.md`.
- **Accessibility**: labelled controls, keyboard-operable dialogs, status/alert roles, usable empty/error states.
- **Auditability**: every claim tied to a source path, timestamp, or Git SHA; health scores labelled heuristic.

## 8. Risks and assumptions

| Risk/assumption | Mitigation |
| --- | --- |
| Markdown edits by external tools can conflict. | Index reconciliation, watcher invalidation, ETag conflicts, draft recovery. |
| Task↔document links are body links; a typo silently breaks navigation. | Linked-document resolution reports unresolved links in task details. |
| Agents may overstate completion. | Traceability distinguishes commit mentions from session HEAD; DoD warnings. |
| Desktop release needs credentials and a clean machine. | Keep gates open; do not advertise signed/installable release until verified. |
| Windows terminal behavior is unverified. | Explicit platform error; roadmap gate before advertising support. |
| Bundle size grows with UI features. | Measure before lazy loading; benchmark evidence required. |

## 9. Decisions requiring founder approval

1. Apple Developer ID signing and notarization (cost, credentials, distribution).
2. Publishing a signed desktop release or any external deployment.
3. Setting a Windows release target and CI budget for a PTY backend.
4. Choosing a documentation/versioning policy for the shared `.qoder/skills` workflow.

## 10. Success metrics for the MVP

- A founder can install dependencies, run `npm run dev`, import a repository, and complete journeys 1–6 without editing Markdown by hand.
- All acceptance criteria above have reproducible evidence in the repository.
- No open defect that risks data loss, silent overwrite, project isolation, or source-repository mutation.
- Release report clearly separates verified behavior from blocked gates.
