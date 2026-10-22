# Architecture

- Node.js 22.5+ process serves a loopback-only Hono HTTP API and static UI. The Tauri desktop shell starts this backend on an ephemeral loopback port and opens it in a native WebView; the standalone local web server remains available.
- The offline browser UI is bundled from React and HeroUI into local static assets.
- Tauri, CLI, and local server use the same Node.js core functions. Tauri owns only the native window and backend process lifecycle; it does not expose shell or filesystem plugins to frontend code.
- Workspace registry and index: `~/.localatlas/atlas.db` (SQLite via `node:sqlite` in WAL mode, with verified automatic migration from legacy `projects.json`).
- Each managed project directory is a small text workspace at `~/.localatlas/projects/<uuid>/`. Its root `project.md` stores the canonical source directory link, root `AGENTS.md` gives agents workspace-specific instructions, and Atlas-managed Markdown lives under `docs/**/*.md`.
- Agent-session notes are canonical Markdown under each managed project at `docs/sessions/<uuid>.md`; their task link, resume note, next action, status, and captured Git head/branch stay in that project's managed storage.
- Imported project `sourcePath` is a canonical absolute directory path stored in that project's `project.md` and cannot overlap with `LOCALATLAS_HOME`. Import, relink, and LocalAtlas document operations do not write to the source repo; a coding agent may edit source files when the user asks it to perform code work, subject to the user's Codex sandbox and approvals. SQLite mirrors this link for project lookup.
- Relinking validates and writes a new canonical source path to the project's `project.md` while preserving the project UUID and managed docs. Existing workspaces get the descriptor on first project listing. Unregister only removes registry/index rows; the project directory and managed docs are retained unless the explicit managed-doc purge option is used, and source paths are never deletion targets.
- The portfolio API aggregates project, managed-document, task, and Git summaries with bounded concurrency (four projects at a time).
- The browser can explicitly browse Markdown inside an imported project as read-only source content. It does not copy, index, or write those files; managed Atlas docs remain the canonical editable workspace content.
- The Git adapter reports the current branch, working-tree change count, and latest five commits. Git access stays read-only.
- The interactive shell starts in the managed project directory and exports `LOCALATLAS_SOURCE_PATH` for commands and agents that need the source repo. Its Codex quick-launch selects the `workspace-write` sandbox and adds that path as a writable directory while keeping the LocalAtlas workspace as CWD; Codex's approval policy and other settings remain user-configured. The Context action reads the project's bounded context from the shared core API and prints it in the terminal. Terminal commands run with the user's local account permissions.
- CWD-to-project resolution uses the longest matching registered directory prefix; `--project <id|key|name>` overrides it.
- Project-scoped and task-scoped agent context use shared core services. Task context resolves the task's direct dependency IDs and Markdown links from that task and its direct dependencies only inside that project, includes up to five linked docs and three active/paused matching sessions, and never loads another project's context or full conversation history.
- Markdown is durable content, future search indices are disposable/rebuildable.

## Security and integrity
- Bind HTTP exclusively to 127.0.0.1; enforce strict `Host` header allowlisting (`127.0.0.1`/`localhost`) on all requests and `Origin`/`Sec-Fetch-Site` checks on mutating requests.
- Reject document path traversal, Windows reserved names, case-insensitive path collisions, and symlinks anywhere from `LOCALATLAS_HOME` through managed docs.
- The terminal runs local commands with the user's account permissions. The Codex quick-launch uses the installed CLI's user-configured approval policy and workspace-write sandbox for the registered source directory.
- Tauri packages the bundled server entry point and static UI as application resources, then launches them with Node.js 22.5+ installed on the machine. It checks `LOCALATLAS_NODE_PATH`, `PATH`, and common Node version-manager locations, removes `LOCALATLAS_ALLOW_REMOTE`, and serves the existing UI/API through loopback.
- Repository Markdown browsing skips symlinks and generated/vendor directories, limits previews to 1 MiB, and caps the listing at 500 files.
- Use atomic replacement (`datasync` + `rename`), SHA-256 `ETag` (`If-Match` / `If-None-Match`) precondition checks, and cross-process lockfile coordination (`.localatlas.lock`) when writing documents or running online backups (`VACUUM INTO`).
