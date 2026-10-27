---
name: manage-localatlas-tasks
description: Use when creating, listing, promoting, or updating LocalAtlas tasks and managed task documents while developing this repository, especially with multiple projects or concurrent edits.
---

# Manage LocalAtlas tasks

Follow [AGENTS.md](../../../AGENTS.md). Use the CLI to register tasks; never create task Markdown manually or write Atlas task data into the source repository. Ordinary source-document edits are not task operations.

## Select the intended workspace and project

For user-requested task management, use the same `LOCALATLAS_HOME` as their app. Do not silently switch to a temporary home or import/register a project. For smoke tests only, use the disposable setup in [verify-localatlas-changes](../verify-localatlas-changes/SKILL.md).

Run from this checkout's root; the npm script needs no globally installed `localatlas`:

```bash
npm run cli -- projects --json
```

Choose the intended project's actual ID or key from the result and set `PROJECT` to it. Ask if the intended project is absent or ambiguous. Do not infer it from a task prefix or rely on the working directory in a multi-project workspace.

```bash
npm run cli -- context --project "$PROJECT"
npm run cli -- task list --project "$PROJECT"
```

## Create or promote

Use the user's actual title and body for `TITLE` and `BODY`. Check the existing list first to avoid duplicate follow-ups.

```bash
npm run cli -- task create "$TITLE" --project "$PROJECT" --status todo --priority medium --body "$BODY" --json
npm run cli -- task list --project "$PROJECT"
```

For a backlog, create each requested task through the CLI and verify its returned ID in the list. Promote an existing managed note with `task promote <doc.md> --project "$PROJECT" --if-match "$ETAG"` after reading it as below. Do not promote source-repository Markdown directly.

## Read, conditionally update, verify

Set `TASK_ID` to an actual returned task ID. Read immediately before editing:

```bash
npm run cli -- read "$TASK_ID" --project "$PROJECT" --json
```

The JSON has top-level `etag`, `path`, `content`, `frontmatter`, and `docId`. `content` is the complete Markdown including frontmatter. Review it and set `ETAG` to that response's exact `etag`; do not use yesterday's token, an empty value, or `*`.

```bash
npm run cli -- task update "$TASK_ID" --project "$PROJECT" --status in_progress --if-match "$ETAG"
npm run cli -- read "$TASK_ID" --project "$PROJECT" --json
npm run cli -- task list --project "$PROJECT"
```

`--if-match` is optional in the implementation: task updates do not automatically protect a prior read. Always supply it for agent edits. On conflict, reread, review concurrent changes, reconcile the requested edit, and use the new token; never just retry unconditionally.

To append an acceptance bullet, reread first and refresh `ETAG`, then:

```bash
npm run cli -- write "$TASK_ID" --project "$PROJECT" --if-match "$ETAG" --append $'\n\n- [ ] Verify the requested behavior after reload.\n'
```

This quoting example is for bash/zsh; use equivalent newline quoting in other shells. Verify with `read` and `task list` afterward. Appending and status updates are separate writes, so reread between them. Check for an already-applied bullet before retrying.

## Common mistakes

- `task update --body` replaces the entire Markdown body, including its heading. Preserve unrelated body text; do not feed the full frontmatter-bearing `content` into this option. Prefer `write --append` for additions.
- `task create/update` do not implement `--depends-on`; consult the implemented [CLI handlers](../../../src/cli.ts) for dependency/impact/proposal operations rather than assuming flags are shared.
- “Clear tasks” is ambiguous: ask whether it means cancel or permanently delete. Never interpret it as permission to remove source files or purge a workspace.

Report the actual project, affected IDs, and verified status. Do not mark work done solely because a task command succeeded; attach the implementation/test evidence required by the task.
