# LocalAtlas Markdown file format

Documents are UTF-8 Markdown with optional YAML frontmatter. Do not require frontmatter for ordinary notes. Preserve unrecognized keys and text when making structured edits.

## Project source record

Each managed project directory contains a root `project.md` descriptor and an `AGENTS.md` instruction file, both outside `docs/`. The `agents/` directory contains role guides for BA, PO, QA, and DEV. `project.md` is the canonical link between the LocalAtlas project and its imported source directory; SQLite mirrors the path for lookups. LocalAtlas creates default agent instructions and role guides only when each file is absent, so they can be edited in the managed workspace.

```markdown
---
type: localatlas_project
schemaVersion: 1
id: 2f42c1a0-6c3e-4e31-98b3-01c7e2b57152
sourcePath: /absolute/path/to/source
---
# LocalAtlas project
```

`sourcePath` must be a normalized absolute path outside `LOCALATLAS_HOME`. Import and relink write this descriptor under LocalAtlas-managed storage and never write to the imported repository. Older workspaces create the descriptor from their registered path when a project is first listed.

The default `AGENTS.md` tells agents to read `project.md`, use `sourcePath` as the source repository, follow that repository's own `AGENTS.md` instructions for code work, and keep LocalAtlas-managed documents under `docs/`. It routes role-based work to the relevant guide in `agents/`. The root instructions and role guides are included in version 2 workspace backups; restore continues to accept version 1 backups and recreates any missing default role guides when the project is listed.

## Recoverable editor drafts

Unsaved Atlas document edits are kept in the browser's local storage and, while the LocalAtlas server is reachable, in `.localatlas/drafts/` inside the managed project workspace. Draft files use a SHA-256 filename derived from the normalized document path; each record stores the path, text, base ETag, new-document flag, and save time. Drafts are transient recovery data: they are not listed, indexed, or treated as canonical documents, and workspace backups omit them. Saving the document clears its draft. If the on-disk document changed meanwhile, the editor shows both versions and requires an explicit save against the latest ETag.

Example:

```markdown
---
id: SAV-024
type: task
status: todo
priority: high
milestone: MVP
dependsOn:
  - SAV-023
---
# Implement comparison

- [ ] Implement logic
- [ ] Add tests

Related Atlas documents can be linked from a task body with `[[SAV-010]]` or a relative Markdown link. `dependsOn` is a normalized, de-duplicated list of same-project task IDs; the legacy `dependencies` key is read for compatibility. New dependency references must resolve inside the same project and must not form a cycle. Existing unresolved references and cycles remain visible to health/roadmap diagnostics and are never used to search another project. A dependency in `done` or `cancelled` status is resolved for readiness; task status is never changed automatically. Changes to dependencies on existing tasks require an impact proposal and explicit confirmation.
```

Document identity must survive rename/move; IDs are scoped to project. Managed docs are canonical, and indexes are rebuildable by scanning files. Do not mirror source repository docs into managed storage silently.

Tasks, epics, milestones, profiles, sessions, proposals and recaps are implemented as managed Markdown records. The M1–M6 shapes described here are shipped; [BACKLOG.md](BACKLOG.md) is a historical delivery record. The current CLI/API/UI support matrix and remaining release checks are tracked in the [Roadmap](ROADMAP.md); this file documents the durable on-disk shapes.

Agent sessions are Markdown documents at `docs/sessions/<uuid>.md` with frontmatter `type: agent_session`, `task` (optional same-project task ID), `status` (`active`, `paused`, or `completed`), `branch`, and `head` when Git evidence is available. The body uses `## Resume note` and `## Next action` sections. Update session Markdown with the same ETag protections as other managed documents; session metadata is not stored in a separate database.

Project profiles are stored at `docs/project/profile.md` with frontmatter `type: project_profile`, `status` (`active`, `paused`, `completed`, `archived`), and `keyDocs` (list of resolved project doc paths). The body uses `## Goals`, `## Approved decisions` (append-only `DEC-NNN` entries), and `## History`.

Task change proposals are stored at `docs/proposals/<uuid>.md` with frontmatter `type: task_change_proposal`, `task`, `targetEtag`, and `status` (`pending`, `confirmed`, `rejected`). They record `## Proposed changes`, `## Rationale`, and `## Impact summary` and require explicit human confirmation before applying changes to the target task.

Project recap drafts are stored at `docs/recaps/<timestamp>.md` with frontmatter `type: project_recap`, `branch`, and `head`, comparing task state, recent Git commits, agent sessions, and potentially stale docs (`## Completed work`, `## Blockers`, `## Recent Git changes`, `## Stale docs`, `## Next actions`).
