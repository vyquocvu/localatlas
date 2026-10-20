# File format (proposed, M3)

Documents are UTF-8 Markdown with optional YAML frontmatter. Do not require frontmatter for ordinary notes. Preserve unrecognized keys and text when making structured edits.

## Project source record

Each managed project directory contains a root `project.md` descriptor and an `AGENTS.md` instruction file, both outside `docs/`. `project.md` is the canonical link between the LocalAtlas project and its imported source directory; SQLite mirrors the path for lookups. LocalAtlas creates the default `AGENTS.md` only when it is absent, so project-specific agent instructions can be edited in the managed workspace.

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

The default `AGENTS.md` tells agents to read `project.md`, use `sourcePath` as the source repository, follow that repository's own `AGENTS.md` instructions for code work, and keep LocalAtlas-managed documents under `docs/`. The file is included in workspace backups.

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

Related Atlas documents can be linked from a task body with `[[SAV-010]]` or a relative Markdown link. `dependsOn` is a list of same-project task IDs; readers must ignore unresolved or cross-project references rather than searching another project.
```

Document identity must survive rename/move; IDs are scoped to project. Managed docs are canonical, and a future index may be rebuilt by scanning files. Do not mirror source repository docs into managed storage silently.

Agent sessions are Markdown documents at `sessions/<uuid>.md` with frontmatter `type: agent_session`, `task` (optional same-project task ID), `status` (`active`, `paused`, or `completed`), `branch`, and `head` when Git evidence is available. The body uses `## Resume note` and `## Next action` sections. Update session Markdown with the same ETag protections as other managed documents; session metadata is not stored in a separate database.

Project profiles are stored at `project/profile.md` with frontmatter `type: project_profile`, `status` (`active`, `paused`, `completed`, `archived`), and `keyDocs` (list of resolved project doc paths). The body uses `## Goals`, `## Approved decisions` (append-only `DEC-NNN` entries), and `## History`.

Task change proposals are stored at `proposals/<uuid>.md` with frontmatter `type: task_change_proposal`, `task`, `targetEtag`, and `status` (`pending`, `confirmed`, `rejected`). They record `## Proposed changes`, `## Rationale`, and `## Impact summary` and require explicit human confirmation before applying changes to the target task.

Project recap drafts are stored at `recaps/<timestamp>.md` with frontmatter `type: project_recap`, `branch`, and `head`, comparing task state, recent Git commits, agent sessions, and potentially stale docs (`## Completed work`, `## Blockers`, `## Recent Git changes`, `## Stale docs`, `## Next actions`).
