# Architecture

- Node.js 22+ process serves a loopback-only Hono HTTP API and static browser UI.
- The offline browser UI is bundled from React and HeroUI into local static assets.
- CLI and server import the same framework-independent core functions.
- Global registry: `~/.localatlas/atlas.db` (SQLite via `node:sqlite` in WAL mode, with verified automatic migration from legacy `projects.json`).
- Managed Markdown: `~/.localatlas/projects/<uuid>/docs/**/*.md`.
- Agent-session notes are canonical Markdown under each managed project at `docs/sessions/<uuid>.md`; their task link, resume note, next action, status, and captured Git head/branch stay in that project's managed storage.
- Imported project `sourcePath` is a canonical absolute directory path, cannot overlap with `LOCALATLAS_HOME`, and remains untouched.
- Relinking validates and stores a new canonical source path while preserving the project UUID and managed docs. Unregister only removes registry/index rows; managed docs are retained unless the explicit managed-doc purge option is used, and source paths are never deletion targets.
- The portfolio API aggregates project, managed-document, task, and Git summaries with bounded concurrency (four projects at a time).
- The browser can explicitly browse Markdown inside an imported project as read-only source content. It does not copy, index, or write those files; managed Atlas docs remain the canonical editable workspace content.
- The Git adapter reports the current branch, working-tree change count, and latest five commits. Git access stays read-only.
- The project-scoped web chat connects to the locally installed Codex CLI through its app-server stdio protocol. LocalAtlas supplies a bounded context bundle for the selected project; Codex owns and persists its transcript in its own local storage. The browser stores only a thread ID per LocalAtlas project, and LocalAtlas verifies the resumed thread's working directory against that project's registered source path. This creates a separate Codex conversation; it does not import a ChatGPT web conversation. Chat and approval routes remain localhost-only even when remote UI access is explicitly enabled.
- CWD-to-project resolution uses the longest matching registered directory prefix; `--project <id|key|name>` overrides it.
- Project-scoped and task-scoped agent context use shared core services. Task context resolves the task's direct dependency IDs and Markdown links from that task and its direct dependencies only inside that project, includes up to five linked docs and three active/paused matching sessions, and never loads another project's context or full conversation history.
- Markdown is durable content, future search indices are disposable/rebuildable.

## Security and integrity
- Bind HTTP exclusively to 127.0.0.1; enforce strict `Host` header allowlisting (`127.0.0.1`/`localhost`) on all requests and `Origin`/`Sec-Fetch-Site` checks on mutating requests.
- Reject document path traversal, Windows reserved names, case-insensitive path collisions, and symlinks anywhere from `LOCALATLAS_HOME` through managed docs.
- Web Codex chat accepts text turns and explicit command/file-change approvals only; it inherits the user's local Codex model, authentication, sandbox, and approval configuration. It does not expose Codex app-server as a network service.
- Codex CLI currently labels its app-server interface experimental. Keep the integration behind the project chat UI and expect compatibility to depend on the installed Codex CLI version.
- Repository Markdown browsing skips symlinks and generated/vendor directories, limits previews to 1 MiB, and caps the listing at 500 files.
- Use atomic replacement (`datasync` + `rename`), SHA-256 `ETag` (`If-Match` / `If-None-Match`) precondition checks, and cross-process lockfile coordination (`.localatlas.lock`) when writing documents or running online backups (`VACUUM INTO`).
