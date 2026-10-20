# Agent instructions

LocalAtlas is a multi-project, Markdown-first local desktop/web app plus CLI. The Tauri desktop shell and CLI share the Node.js core. Read docs/VISION.md, docs/ARCHITECTURE.md, docs/FILE_FORMAT.md and docs/ROADMAP.md before changing storage or public commands.

Rules:
- Do not introduce MCP, hosted services, or a Bitbucket replacement.
- Never modify an imported repository during import.
- Keep web and CLI on shared core code, and localhost-only by default.
- Treat Markdown as canonical document data and indexing as rebuildable.
- Never report a milestone done without tests and a verifiable implementation.
- Run npm run typecheck and npm test before proposing merge.
