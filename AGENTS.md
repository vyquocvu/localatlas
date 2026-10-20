# Agent instructions

LocalAtlas is a multi-project, Markdown-first local desktop/web app plus CLI. The Tauri desktop shell and CLI share the Node.js core. Read docs/VISION.md, docs/ARCHITECTURE.md, docs/FILE_FORMAT.md and docs/ROADMAP.md before changing storage or public commands.

Rules:
- Do not introduce MCP, hosted services, or a Bitbucket replacement.
- Never modify an imported repository during import.
- Keep web and CLI on shared core code, and localhost-only by default.
- Treat Markdown as canonical document data and indexing as rebuildable.
- Never report a milestone done without tests and a verifiable implementation.
- Run npm run typecheck and npm test before proposing merge.

## Creating tasks

Always use the LocalAtlas CLI to create, update, or list tasks. Do NOT create task markdown files manually — tasks must be registered through the CLI so they appear in the Tasks workspace.

```
localatlas task create "<title>" [--priority low|medium|high|critical] [--status todo|in_progress|blocked|done|cancelled] [--epic "<epic>"] [--milestone "<milestone>"] [--body "<markdown body>"]
localatlas task list [--status ...] [--priority ...] [--milestone ...] [--epic ...]
localatlas task update <id> [--status ...] [--priority ...] [--title ...] [--body ...]
localatlas task promote <doc.md> [--priority ...] [--status ...]
```

When asked to create tasks from docs or a backlog, run `localatlas task create` for each task. Use `localatlas task list` to verify tasks were created.
