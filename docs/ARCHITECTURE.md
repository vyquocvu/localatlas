# Architecture

- Node.js 22+ process serves a loopback-only Hono HTTP API and static browser UI.
- CLI and server import the same framework-independent core functions.
- Global registry: `~/.localatlas/projects.json` (replace with SQLite in the next milestone, after designing migration and locking).
- Managed Markdown: `~/.localatlas/projects/<uuid>/docs/**/*.md`.
- Imported project `sourcePath` is a canonical absolute directory path and remains untouched.
- CWD-to-project resolution uses the longest matching registered directory prefix; `--project` overrides it.
- Markdown is durable content, future search indices are disposable/rebuildable.

## Security and integrity
- Bind HTTP exclusively to 127.0.0.1; no remote/LAN exposure.
- Reject document path traversal and symlinks within managed docs.
- Use atomic replacement when writing registry and Markdown.
- Current foundation is single-user, single-writer oriented. Before concurrent edits, implement revision/ETag checks, request origin protection, atomic coordination and per-project write serialization. Do not expose publicly.
- Git adapter, linked document mounts and task indexing are future milestones.
