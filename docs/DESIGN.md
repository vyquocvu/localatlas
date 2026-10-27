# Design: LocalAtlas

Status: living document, aligned with the implemented UI in `src/ui` as of 2026-10-26.

## 1. Design principles

1. **Local and calm**: a dense, dark, keyboard-friendly workspace that feels like a developer tool, not a marketing site.
2. **Evidence over assertion**: show paths, ETags, timestamps, Git SHAs, and explicit unavailable/error states.
3. **Markdown is the source of truth**: the UI edits documents through the shared core; it never introduces a hidden second model.
4. **Never surprise the user**: preview risky changes, confirm before applying, preserve drafts, and surface conflicts.
5. **One workspace, many projects**: project context is always visible; cross-project data never leaks into a view.

## 2. Technology and visual system

- React 19 + `htm` templates, Zustand stores, HeroUI components, Tailwind v4 plus project CSS.
- Vite builds `src/ui` into `public/app.js` and `public/app.css`; edit sources, not generated output.
- Dark palette via CSS variables in `src/ui/styles.css`: background `#0c0d10`, surfaces `#121419`/`#171921`, accent `#5e6ad2`, danger `#eb5757`, warning `#f2994a`, success `#6fcf97`.
- Typography: Inter/system sans; monospace for IDs, paths, SHAs, and keys. Base size 12px, dense spacing, minimum viewport width 360px, reduced to 320px below the 640px breakpoint.
- CSP and offline constraints: no external CDN assets; static assets are served locally.

## 3. Information architecture

Workspace-level:
- **All projects / Portfolio**: project cards, portfolio summary, attention inbox, backup/restore.
- **Project switcher** in the header; project selection persists in the workspace store.

Project-level modules:
- **Overview**: project identity, status, goals, key docs, decisions, recent commits, tasks, health, sessions.
- **Docs**: Atlas document tree, repository docs (read-only), editor/preview, drafts, linked mentions.
- **Tasks**: board, list, roadmap, ready-to-start; filters, saved views, task details/proposals, epics, milestones.
- **Git activity**: bounded history, task traceability, evidence labels.
- **Terminal**: project-scoped shell and Codex sessions with bounded context preview.

Dialogs:
- Import/relink project, create task, session, profile, decision, task details/propose change, structure editor.

Workspace-level panels:
- Backup/restore and verification live in the portfolio view rather than a dialog.

## 4. Key flows

### Import and orient
Portfolio → Import project → pick directory → confirm key/name → project overview. Empty state offers "Create first task" and doc entry points. Repositories are labelled read-only.

### Plan and change
Tasks → card → **Propose change** → edit title/priority/status/epic/milestone/body/dependencies → **Prepare impact summary** → review changed fields, downstream tasks, rollup impact, warnings → **Confirm & apply change** or **Reject**. Stale previews and ETags are rejected; users reread rather than overwrite. The CLI/API also support direct status, priority, title, epic, milestone, and body updates with a fresh ETag; dependency changes still require a proposal and confirmation. `PATCH` rejects unsupported fields instead of silently ignoring them and points dependency changes to the proposal route.

### Linked-document navigation (new)
Task details shows **Linked documents** resolved from the task's Markdown body:
- loading indicator while fetching;
- empty guidance with an example wiki link;
- document rows with title, path, type, and status;
- unresolved links listed explicitly;
- truncation notice at 20 documents;
- clicking a row closes the dialog, opens Docs, and selects the document.

### Document → task
The Docs sidebar lists incoming **Linked mentions** for the active Atlas document; clicking a task document opens its Markdown. Backlinks remain generic rather than a separate task graph.

### Agent work and recovery
Task context is bounded and project-scoped. Terminal launch previews context before starting. Sessions carry a resume note and next action. After a CLI update, the watcher invalidates UI state; conflicts show disk content and require a retry against the current ETag.

## 5. Component and state conventions

- Zustand stores per domain: workspace, document, task, session, profile, modal. Terminal panel and Codex session state live in the workspace store; `useCodexStore.js` currently has no consumers.
- Async actions guard against project switches with `projectEpoch`/active-project checks before applying late responses; task-details document fetches also use a request sequence so a stale response cannot populate a newly opened task.
- ETag-bearing mutations send `if-match`; 409 is handled explicitly with reload or conflict UI.
- Modal forms are labelled; destructive or irreversible actions require confirmation.
- Asynchronous form errors use `role="alert"`, loading uses `role="status"`, and backup/restore reports progress through a `role="status"` region. Lists have accessible names.

## 6. Empty, loading, error, and conflict states

| Surface | Empty | Loading | Error/conflict |
| --- | --- | --- | --- |
| Portfolio | Import prompt | Summary placeholders | Per-project stale/error label; partial results preserved |
| Attention inbox | "No attention items" message | Refresh label | Per-project error labels; orphan notes stay informational |
| Import/relink | Directory prompt | Importing state | `role="alert"` error; read-only repository notice |
| Backup/restore | Destination and inspection prompts | Create/verify status | Verification failure, force-needed warning, per-backup result |
| Docs | Create/open prompt | File tree/editor load | Read-only/error banner; draft conflict side-by-side |
| Tasks | Create task prompt | Board load | Missing dependencies, broken references, DoD warning |
| Task details | No linked documents guidance plus add-link picker | Linked-doc status line and pending link edits | Unresolved links and unresolved cap; link add/remove errors; impact error |
| Git activity | No commits/unavailable | Bounded search status | Timeout/missing Git shown as unavailable evidence |
| Terminal | Start shell/Codex | Spawn status | Platform/dependency error with actionable message |

## 7. Accessibility and responsiveness

- All controls have visible labels or `aria-label`; dialogs are keyboard-operable and dismissable.
- Status and alert roles used for asynchronous outcomes.
- Layout is dense but reflows at narrow widths; the document declares a 360px minimum and a 320px minimum below the 640px breakpoint.
- Colour is not the only signal: badges include text such as “Blocked by”, “Unresolved”, “Unavailable”.

## 8. Known design gaps

1. Link add/remove covers wiki-links and standard Markdown links outside the manual textarea; paths containing characters outside the wiki-link grammar must be linked manually.
2. Document backlinks are generic; there is no dedicated “related tasks” grouping.
3. `public/app.js` remains a large bundle; React dependencies are split into an `assets/react-vendor.js` chunk, but further code-splitting needs measurement.
4. No formal browser accessibility audit (screen reader/keyboard sweep) is recorded.
5. Repository documents do not show the backlinks pane.
6. Task context caps linked documents at five without surfacing truncation in the UI.
