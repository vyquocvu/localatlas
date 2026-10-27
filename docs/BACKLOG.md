# LocalAtlas historical milestone backlog (M1–M6)

> **Status: historical delivery record.** The M1–M6 stories below shipped; their original acceptance criteria are retained for reference and are no longer an open-work tracker. Current status lives in the [Roadmap](ROADMAP.md), and evidence for the shipped behavior is in [`test/`](../test) and [`e2e/`](../e2e). Later work (M7–M10 and the engineering backlog) is tracked in [tasks/backlog.md](../tasks/backlog.md). Checked boxes mark criteria delivered during M0–M6; where a criterion changed after delivery, the current contract is documented in the linked product docs rather than rewritten here.

This historical backlog translated the [Roadmap](ROADMAP.md), [Vision](VISION.md), [Architecture](ARCHITECTURE.md), and [File Format](FILE_FORMAT.md) into small, INVEST-compliant, vertically verifiable **User Stories**.

---

## 1. Personas, Runtime & Global Guardrails

### Personas
- **Solo Developer (Human UI/CLI User)**: Manages multiple local software repositories, writes specs/notes/tasks in browser or terminal, and expects zero unwanted modifications to source repos.
- **Coding Agent (CLI/JSON Consumer)**: Queries project context, reads specs, and updates task status deterministically via the CLI using `--json`, document IDs (`SAV-024`), and CWD resolution.
- **Local Operator (Self-Host / Maintainer)**: Needs reliable local storage, multi-process crash-safe writes, online backups, schema migrations, and strict localhost security boundaries.

### Runtime & Trust Boundary
- **Node.js Runtime**: Pin `engines.node` to `>=22.13.0` (unflagged built-in `node:sqlite`; Node 24.x is preferred).
- **Filesystem Trust Boundary**: Defends against untrusted document paths, accidental or pre-existing symlinks, overlapping `sourcePath` / `LOCALATLAS_HOME` directories, and cross-origin browser requests (`127.0.0.1`). Assumes no hostile local root process is actively mutating `~/.localatlas` in parallel.

### Global Definition of Done (DoD)
Per [AGENTS.md](../AGENTS.md), every story must satisfy:
1. Shared business logic implemented in `src/core.ts` (or core modules) and consumed by both `src/cli.ts` and `src/server.ts`.
2. Never mutate an imported project's `sourcePath`.
3. Markdown files on disk remain the canonical document data; SQLite search/link/task **index tables** are disposable and rebuildable without losing registered projects.
4. Automated positive and decisive negative tests added in `test/*.test.ts` and passing `npm run typecheck && npm test`.

---

## 2. Explicit Dependency Chain

`M1 Path & Overlap Invariants` → `M1 SQLite Schema & Migration` → `M1 Project Keys & Lifecycle` → `M1 Conditional Revision Writes` → `M1 HTTP Hardening & Backup` → `M2 File Move/Delete` → `M2 Offline React + HeroUI Shell, Explorer & Editor` → `M3 Frontmatter Parser & Document IDs` → `M3 Transactional FTS5 Index, Search, Backlinks, Watcher & SSE` → `M4 Task/Epic/Milestone Schema, Promotion, Rollups & Kanban` → `M5 Read-Only Git Adapter & Agent Context` → `M6 Packaging & Cross-Platform Verification`.

---

## 3. Epic M1: Durable SQLite Registry, Concurrency & Security Foundation
**Goal**: Establish cross-platform path and non-overlapping storage invariants first, replace `projects.json` with a multi-process-safe `node:sqlite` (`DatabaseSync`) registry, enforce revision-checked writes, harden the loopback HTTP threat model, and provide consistent backup/restore.

### `LA-M1-01` — Canonical Path Rules, Non-Overlapping Storage & Symlink Confinement
- **As a** Local Operator,
- **I want** strict cross-platform path validation and non-overlapping `sourcePath` / `LOCALATLAS_HOME` invariants enforced on every project and document operation,
- **So that** managed storage can never be placed inside an imported repository and malformed/platform-specific paths are rejected from day one.
- **Acceptance Criteria**:
  - [x] **Non-Overlapping Storage Invariant**: `importProject` resolves `realpath` for both `sourcePath` and `LOCALATLAS_HOME` and rejects any import where `sourcePath` equals, contains, or is contained within `LOCALATLAS_HOME`.
  - [x] **Derived `managedPath` Validation**: Validates `project.id` is a canonical UUID and verifies `project.managedPath` is strictly `join(home(), 'projects', project.id)` (never trusting arbitrary paths loaded from disk).
  - [x] **Cross-Platform Document Path Rules**: Normalizes relative document paths to POSIX `/`, rejects backslashes (`\`), null bytes, drive-letter/UNC prefixes (`C:`, `//`), trailing dots/spaces, and Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with or without `.md`), and detects case-insensitive path collisions (`README.md` vs `readme.md`).
  - [x] **Full-Chain Symlink Check**: Verifies no symlink exists in any existing segment from `LOCALATLAS_HOME` through `projects/<id>/docs/**` and verifies `realpath(dirname(target))` stays confined inside `realpath(docsRoot)`.
- **Decisive Failure & Recovery Tests**:
  - [x] Importing a directory that is an ancestor of `LOCALATLAS_HOME` (or inside `LOCALATLAS_HOME`) fails with `400` and creates zero files.
  - [x] `documentPath` rejects `CON.md`, `sub/aux.md`, `C:/foo.md`, and symlinked ancestor directories across all OSes.

### `LA-M1-02` — SQLite Registry Schema, Multi-Process PRAGMAs & Verified `projects.json` Migration
- **As a** Local Operator,
- **I want** `~/.localatlas/atlas.db` initialized via `node:sqlite` (`DatabaseSync`) with WAL mode and verified all-or-nothing migration from `projects.json`,
- **So that** concurrent CLI and server processes share an ACID registry without silently dropping or duplicating M0 projects.
- **Acceptance Criteria**:
  - [x] Pins `engines.node` to `>=22.13.0` in `package.json`.
  - [x] Every `DatabaseSync` connection executes `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA busy_timeout = 5000`, and `PRAGMA foreign_keys = ON`.
  - [x] Creates `schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)` and `projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, source_path TEXT NOT NULL UNIQUE, managed_path TEXT NOT NULL, next_seq INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`.
  - [x] Enforces `0o700` permissions on `LOCALATLAS_HOME` and `0o600` on `atlas.db`.
  - [x] **Verified Migration**: When `projects.json` exists, validates all entries inside a `BEGIN IMMEDIATE` transaction. If any entry has malformed fields or conflicting `id`/`sourcePath` with a different record, rolls back, reports the exact conflicting record, and leaves `projects.json` untouched. Only after verifying all rows exist in `projects` and recording migration completion does it rename `projects.json` to `projects.json.migrated`.
- **Decisive Failure & Recovery Tests**:
  - [x] If `projects.json` contains a corrupted or conflicting entry, migration aborts with zero partial writes and `projects.json` remains intact.
  - [x] If a crash occurs after the DB commit but before renaming `projects.json`, the next startup detects that all rows match and completes the rename idempotently.

### `LA-M1-03` — Project Key Policy & Project Lifecycle CLI (`update`, `remove`)
- **As a** Solo Developer or Coding Agent,
- **I want** each project to have a unique 2–5 uppercase letter `key` (e.g., `SAV`) and CLI commands to update project display names or unregister projects safely,
- **So that** duplicate directory basenames are disambiguated and task IDs (`SAV-024`) remain stable.
- **Acceptance Criteria**:
  - [x] Auto-derives a unique 2–5 uppercase alphanumeric `key` on `importProject(path, { key?, name? })`; `selectProject(selector)` resolves by `id`, `key` (case-insensitive), or unambiguous `name`.
  - [x] **Key Immutability Policy**: A project's `key` can be customized via `localatlas project update --key <NEW>` only while the project has no documents with `<KEY>-<NNN>` frontmatter IDs (unless `--force` is passed, which keeps existing document IDs untouched).
  - [x] `localatlas project remove <selector> [--purge-docs]` removes the project row from SQLite while keeping `~/.localatlas/projects/<uuid>/docs` intact by default (or deleting managed docs only when `--purge-docs` is explicitly specified). Re-importing a previously unpurged directory re-attaches its existing managed docs if `--reuse-docs <uuid>` is passed or creates a fresh UUID.
- **Decisive Failure & Recovery Tests**:
  - [x] `localatlas project remove` without `--purge-docs` unregisters the project while leaving 100% of `.md` files intact on disk.

### `LA-M1-04` — Conditional Revision Writes (`ETag` / `If-Match`) & Lockfile Coordination
- **As a** Solo Developer using both the Web UI and a Coding Agent in the CLI,
- **I want** document reads to return a quoted SHA-256 `ETag` and writes to enforce conditional `If-Match` / `If-None-Match` checks when provided (and automatically in Web UI / structured updates),
- **So that** concurrent CLI and browser edits never silently overwrite each other while keeping simple CLI piping (`localatlas write`) frictionless.
- **Acceptance Criteria**:
  - [x] `readDoc` remains backward-compatible while `readDocWithMeta` (and `localatlas read <doc> --json` / `GET /api/projects/:id/docs/*` `ETag: "<sha256>"` header) exposes `{ path, etag, content }`.
  - [x] **Pragmatic Write Contract**: Direct `writeDoc(project, name, content)` and raw CLI `localatlas write <file.md>` work without requiring `--if-match` (preserving M0 ergonomics), while passing `If-Match: "<etag>"` (`--if-match <etag>`) or `If-None-Match: *` (`--create-only`) enforces conditional precondition checks (`409 Conflict` with `{ error, currentEtag }`). Web UI saves and structured read-modify-write commands (`task update`, `meta set`) always pass `If-Match` automatically.
  - [x] **Lockfile Coordination**: Uses a simple cross-process lockfile (`.localatlas.lock`) around: read current file → verify `ETag` precondition → write `.localatlas-tmp-<pid>-<uuid>` → `fileHandle.datasync()` → `rename` over target.
  - [x] CLI `write` supports `--if-match <etag>`, `--create-only`, and `--content <text>` / `--append <text>` in addition to `stdin`.
- **Decisive Failure & Recovery Tests**:
  - [x] Client A reads `etag1`, Client B writes `etag2`, Client A writes with `If-Match: "etag1"` → rejected with `409 Conflict` (`{ error, currentEtag: "etag2" }`) and Client B's content remains untouched.
  - [x] Parallel writes targeting the same `.md` file serialize cleanly with zero corrupted files and zero leftover `.localatlas-tmp-*` files.

### `LA-M1-05` — Loopback HTTP Security Hardening (DNS Rebinding, CSRF & Payload Limits)
- **As a** Local Operator,
- **I want** the loopback server to enforce `Host`, `Origin`, `Sec-Fetch-Site`, URL encoding, and body size guards on requests,
- **So that** websites visited in my browser cannot read or mutate local documentation via `127.0.0.1`.
- **Acceptance Criteria**:
  - [x] **DNS Rebinding Guard (All Requests)**: Every HTTP request (`GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `PATCH`) validates `Host` against `127.0.0.1`, `localhost`, `127.0.0.1:<port>`, or `localhost:<port>`; any other `Host` returns `403 Forbidden`.
  - [x] **CSRF Guard (Mutating Requests)**: Rejects mutating requests when `Sec-Fetch-Site` is `cross-site` or when `Origin` is present and not `http://127.0.0.1:<port>` or `http://localhost:<port>` (`403 Forbidden`).
  - [x] **Payload & URL Hardening**: Rejects request bodies `> 5 MB` with `413 Payload Too Large`; rejects encoded path separators (`%2f`, `%5c`, `%00`) before URL decoding and returns `400 Bad Request` on malformed percent-encoding (`URIError`).
- **Decisive Failure & Recovery Tests**:
  - [x] `GET /api/projects` with `Host: attacker.dns-rebind.test:3456` returns `403 Forbidden`.
  - [x] `PUT /api/projects/:id/docs/PRD.md` with `Origin: https://evil.example` or `Sec-Fetch-Site: cross-site` returns `403 Forbidden`.

### `LA-M1-06` — Coordinated Workspace Backup & Offline Restore CLI
- **As a** Local Operator,
- **I want** `localatlas backup <target-dir>` and `localatlas restore <backup-dir> [--force]` commands with a workspace write barrier and round-trip verification,
- **So that** backups capture a mutually consistent SQLite + Markdown state and restores never corrupt a running server.
- **Acceptance Criteria**:
  - [x] **Coordinated Backup**: Acquires the cross-process workspace write lock while executing `VACUUM INTO '<target>/atlas.db'` and copying all `projects/<uuid>/docs/**/*.md` files, writes `manifest.json` with SHA-256 checksums for `atlas.db` and every `.md` file, and releases the lock.
  - [x] **Safe Offline Restore**: Refuses to run if `localatlas serve` or another writer holds an active workspace lock (`409` / exit code `1`). Validates all `manifest.json` SHA-256 checksums and path confinement in a staging directory first, then swaps into `LOCALATLAS_HOME` (requiring `--force` if non-empty) with automatic rollback if swap fails.
- **Decisive Failure & Recovery Tests**:
  - [x] Restoring into a fresh `LOCALATLAS_HOME` and comparing all projects and `.md` files matches the source workspace byte-for-byte.
  - [x] Attempting `localatlas restore` while `localatlas serve` holds the server lock fails immediately without modifying `LOCALATLAS_HOME`.
  - [x] Tampering with a single byte in a backed-up `.md` file causes `restore` to fail checksum verification before touching `LOCALATLAS_HOME`.

---

## 4. Epic M2: React + HeroUI Web UI, File Lifecycle & Document Previews
**Goal**: Add revision-safe document rename/delete lifecycle support and upgrade the HTML shell to an offline React interface built with HeroUI, with a folder tree explorer, split editor/preview, and XSS protection.

### `LA-M2-01` — Core, CLI & API Document Rename/Move and Delete
- **As a** Solo Developer or Coding Agent,
- **I want** to rename/move and delete managed Markdown documents with revision checks via Core, CLI (`mv`, `rm`), and HTTP API,
- **So that** I can reorganize documentation folders safely without losing concurrent edits.
- **Acceptance Criteria**:
  - [x] `moveDoc(project, fromPath, toPath, { ifMatch?, targetIfMatch?, overwrite? })` and `deleteDoc(project, path, { ifMatch? })` validate paths via `documentPath` and hold the cross-process write lock.
  - [x] Moving onto an existing destination fails with `409 Conflict` unless `overwrite: true` (`--force`) is passed (and optional `targetIfMatch` matches).
  - [x] After `moveDoc` or `deleteDoc`, empty parent directories inside `docs/` are pruned upward using non-recursive `rmdir` (never deleting active `.localatlas-tmp-*` files belonging to live processes) and stopping strictly at `docs/`.
  - [x] CLI adds `localatlas mv <from.md> <to.md> [--if-match <etag>] [--force]` and `localatlas rm <file.md> [--if-match <etag>]`; Server adds `POST /api/projects/:id/docs-move` and `DELETE /api/projects/:id/docs/*`.
- **Decisive Failure & Recovery Tests**:
  - [x] `moveDoc` to an existing file without `overwrite` fails with `409` and leaves both source and destination intact.
  - [x] Deleting the last file in `docs/a/b/c.md` removes `docs/a/b` and `docs/a` while preserving `docs/`.

### `LA-M2-02` — Offline React + HeroUI Application Shell & Hash Router
- **As a** Solo Developer,
- **I want** a zero-CDN React interface built with HeroUI (`public/`) with URL hash routing (`#/projects/:id/docs/:path`),
- **So that** LocalAtlas works without internet access and preserves my active project and document across page refreshes.
- **Acceptance Criteria**:
  - [x] Serves the bundled React + HeroUI application directly from local static assets with `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'`.
  - [x] Deep-linking and refreshing `#/projects/:id/docs/spec/PRD.md` restores the exact project and document view.
  - [x] Project switcher displays project `key`, `name`, and `sourcePath`, with an import modal surfacing inline API validation errors.
- **Decisive Failure & Recovery Tests**:
  - [x] Static asset inspection and HTTP response headers confirm zero external `http://` or `https://` URLs and presence of the restrictive CSP header.

### `LA-M2-03` — Hierarchical File Explorer UI with Create, Rename & Delete
- **As a** Solo Developer,
- **I want** a collapsible folder tree in the sidebar with inline create, rename/move, and delete actions,
- **So that** I can browse and manage nested documentation (`spec/`, `adr/`, `tasks/`) from the browser.
- **Acceptance Criteria**:
  - [x] Renders nested folders and `.md` files sorted folders-first, then alphabetically.
  - [x] Supports creating a new `.md` file (`If-None-Match: *`), renaming/moving a file (`If-Match`), and deleting a file (`If-Match`) with confirmation.

### `LA-M2-04` — Markdown Editor with XSS-Safe Live Preview & ETag Conflict Resolution
- **As a** Solo Developer,
- **I want** a split/tabbed Markdown editor and preview with `Cmd/Ctrl+S` conditional save, interactive checklists, and conflict resolution,
- **So that** I can write and preview Markdown safely without overwriting concurrent CLI edits.
- **Acceptance Criteria**:
  - [x] Toggle between `Edit`, `Split`, and `Preview` modes; displays dirty indicator (`●`) and prompts before discarding unsaved edits on navigation.
  - [x] Markdown preview sanitizes HTML (stripping `<script>`, event handlers like `onerror`/`onload`, and `javascript:`/`vbscript:`/`data:` URLs) and intercepts internal `.md` links to navigate via the hash router.
  - [x] Tracks the loaded `ETag` and sends `If-Match: "<etag>"` on every save; on `409 Conflict`, displays a conflict banner allowing the user to inspect/reload the disk version or explicitly force overwrite.
- **Decisive Failure & Recovery Tests**:
  - [x] Saving from a stale editor state after a CLI edit returns `409` and surfaces the conflict prompt without overwriting disk content.
  - [x] Rendering `<img src=x onerror=alert(1)>` or `[x](javascript:alert(1))` in preview strips executable attributes/schemes.

---

## 5. Epic M3: Frontmatter, Document Identity, FTS5 Search, Backlinks & Watcher
**Goal**: Parse YAML frontmatter losslessly per [FILE_FORMAT.md](FILE_FORMAT.md), enforce project-scoped document IDs, maintain a rebuildable SQLite FTS5 & backlinks cache, and keep it synchronized via CLI hooks, file watching, and SSE notifications.

### `LA-M3-01` — Lossless YAML Frontmatter Parser & Strict Structured Edit Mode
- **As a** Coding Agent or Solo Developer,
- **I want** optional YAML frontmatter parsed safely and updated losslessly while refusing structured edits on malformed frontmatter,
- **So that** ordinary notes require no frontmatter and structured updates never corrupt or double-insert YAML blocks.
- **Acceptance Criteria**:
  - [x] Strips optional UTF-8 BOM, detects top-of-file `--- ... ---` frontmatter (ignoring `---` horizontal rules in the body), and parses key-value pairs safely (no prototype pollution via `__proto__`/`constructor`, rejecting duplicate YAML keys).
  - [x] **Strict Failure Mode for Structured Edits**: While `readDoc` and `listDocs` tolerate malformed frontmatter by treating the file as plain Markdown with a `parseWarning`, structured frontmatter mutations (`updateFrontmatter`, `localatlas meta set <doc> key=val`) refuse to modify a file with malformed YAML frontmatter (`400 Bad Request` / exit code `1`) rather than prepending a second frontmatter block.
  - [x] Updating valid frontmatter preserves unrecognized keys, key ordering, line endings (`LF`/`CRLF`), and exact Markdown body text.
- **Decisive Failure & Recovery Tests**:
  - [x] Calling `meta set` on a document with unclosed/invalid YAML frontmatter fails with `400` and leaves the file byte-for-byte unchanged.
  - [x] Updating frontmatter on a document with multiple `---` horizontal rules in the body preserves the exact body and unrecognized YAML keys.

### `LA-M3-02` — Project-Scoped Document Identity (`id`) & Generic Write Enforcement
- **As a** Coding Agent or Solo Developer,
- **I want** frontmatter `id` (as a non-empty string, e.g., `SAV-024`) enforced as unique per project across all writes and resolvable in place of file paths,
- **So that** document references survive file renames and moves.
- **Acceptance Criteria**:
  - [x] Validates that when frontmatter contains `id`, it is a non-empty string (coercing or rejecting non-string YAML scalars) and is unique across all documents within the same project.
  - [x] Enforces `id` uniqueness on **every** `writeDoc`, `moveDoc`, and `updateFrontmatter` call (not only `meta set`).
  - [x] `readDoc`, `writeDoc`, `moveDoc`, and `deleteDoc` accept either a relative path (`tasks/SAV-024.md`) or a frontmatter `id` (`SAV-024`).
- **Decisive Failure & Recovery Tests**:
  - [x] Writing a second document with `id: SAV-024` via generic `PUT /api/projects/:id/docs/other.md` or `localatlas write` fails with `409 Conflict`.
  - [x] Moving `tasks/SAV-024.md` to `archive/SAV-024.md` preserves `localatlas read SAV-024`.

### `LA-M3-03` — Rebuildable SQLite FTS5 Index Cache & Atomic `reindex`
- **As a** Local Operator,
- **I want** a disposable SQLite FTS5 and metadata index cache updated on writes and atomically rebuildable via `localatlas reindex`,
- **So that** search and metadata queries remain fast and self-healing after any crash or external edit.
- **Acceptance Criteria**:
  - [x] Creates disposable cache tables `doc_index` and `doc_fts` (keeping the `projects` registry table separate and durable).
  - [x] Core write operations (`writeDoc`, `moveDoc`, `deleteDoc`) update `doc_index` and `doc_fts`; if an index update fails after a successful file write, sets a persistent `needs_reindex = 1` flag on the project and reconciles automatically on next read/search.
  - [x] `localatlas reindex [--project <selector>]` and `POST /api/projects/:id/reindex` rebuild the project's index rows inside a single transaction (without dropping live tables mid-request) by scanning `.md` files on disk, reporting any duplicate frontmatter `id` conflicts discovered among external edits as warnings/diagnostics without crashing.
- **Decisive Failure & Recovery Tests**:
  - [x] Deleting all rows in `doc_index` and `doc_fts` and running `localatlas reindex` reconstructs identical metadata and search results while keeping all registered `projects` intact.

### `LA-M3-04` — Full-Text & Frontmatter Search in CLI, API, and Web UI
- **As a** Solo Developer or Coding Agent,
- **I want** to search documents by full-text query and frontmatter filters (`--type`, `--status`, `--milestone`, `--epic`) in the CLI and via a `Cmd/Ctrl+K` modal in the Web UI,
- **So that** I can locate relevant specs and tasks immediately.
- **Acceptance Criteria**:
  - [x] `localatlas search <query> [--type ...] [--status ...] [--milestone ...] [--all-projects] [--json]` and `GET /api/projects/:id/search` return ranked results with snippet highlights.
  - [x] `localatlas docs` supports `--type`, `--status`, `--milestone`, and `--epic` filters.
  - [x] Escapes/tokenizes user FTS5 queries so arbitrary strings (`"unclosed`, `AND`, `NEAR`, `*`, `:`, `[`) never throw SQLite syntax errors.
  - [x] Web UI provides a `Cmd/Ctrl+K` quick-open & search modal.
- **Decisive Failure & Recovery Tests**:
  - [x] Malformed FTS5 operator strings return `200` / exit code `0` with safe literal token matching.

### `LA-M3-05` — Wiki-Links / Relative Links & Backlinks Graph
- **As a** Solo Developer or Coding Agent,
- **I want** internal wiki-links (`[[SAV-024]]`) and relative Markdown links (`[PRD](../spec/PRD.md)`) indexed into a backlinks graph,
- **So that** I can see every document or task that references a given specification or epic.
- **Acceptance Criteria**:
  - [x] Extracts outbound links outside fenced (` ``` `) and inline (`` ` ``) code spans and stores `(project_id, source_path, target_ref)` edges in SQLite on write/reindex.
  - [x] Resolves `[[ID]]` links by frontmatter `id` (surviving file moves) and relative path links by normalized POSIX path.
  - [x] Exposes backlinks via `localatlas backlinks <doc-or-id> [--json]`, `GET /api/projects/:id/backlinks/*`, and a Backlinks panel in the Web UI.
- **Decisive Failure & Recovery Tests**:
  - [x] Links inside fenced or inline code blocks are ignored, and deleting a source document removes its outbound link edges immediately.

### `LA-M3-06` — Managed Directory File Watcher & Periodic Reconciliation
- **As a** Solo Developer editing managed `.md` files in an external editor,
- **I want** `localatlas serve` to watch managed `docs/` directories and run startup/periodic reconciliation against on-disk files,
- **So that** external file creates, edits, renames, and deletes update the SQLite index cache reliably even if OS watcher events are coalesced or missed.
- **Acceptance Criteria**:
  - [x] Performs a fast `(path, mtime, size, etag)` reconciliation scan on server startup and periodically (e.g., every 30s or on watcher overflow) in addition to debounced `fs.watch` events.
  - [x] Ignores `.localatlas-tmp-*` files and symlinks, handles newly created subdirectories and rename pairs, and suppresses self-write echoes when on-disk `etag` already matches `doc_index.etag`.
  - [x] Runs exclusively in `serve` mode and closes all watcher handles cleanly on shutdown (`SIGINT`/`SIGTERM`).
- **Decisive Failure & Recovery Tests**:
  - [x] External file edits and renames made while the server was stopped (or when watcher events are dropped) are reconciled into `doc_index` on startup/reconciliation tick.

### `LA-M3-07` — Server-Sent Events (SSE) Live UI Notification Channel
- **As a** Solo Developer running CLI agents alongside the Web UI,
- **I want** the browser UI to receive lightweight change notifications via `GET /api/projects/:id/events` (SSE) and re-fetch canonical state from the API,
- **So that** clean views update live and dirty editors warn me without treating SSE as the source of truth.
- **Acceptance Criteria**:
  - [x] Emits `{ type: 'doc_changed' | 'reindexed', path, etag }` over SSE whenever a project's documents change via HTTP, CLI/watcher, or reindex, plus a sequence counter so reconnects trigger a full list/doc refresh.
  - [x] Clean document/board views automatically re-fetch updated data; a dirty editor displays a non-destructive "File updated on disk — Reload / Diff" banner.

---

## 6. Epic M4: Structured Tasks, Epics, Milestones & Kanban over Markdown
**Goal**: Model `task`, `epic`, and `milestone` documents over canonical Markdown with deterministic `<KEY>-<NNN>` ID allocation, note promotion, well-defined progress rollups, and interactive List/Kanban views.

### `LA-M4-01` — Structured `task`, `epic`, and `milestone` Schemas & Sequential ID Allocation
- **As a** Coding Agent or Solo Developer,
- **I want** to create structured `task`, `epic`, and `milestone` Markdown documents with sequential `<KEY>-<NNN>` IDs,
- **So that** work items have durable project-scoped IDs stored in Markdown frontmatter.
- **Acceptance Criteria**:
  - [x] Defines frontmatter schemas:
    - `type: task` (`id`, `status: todo | in_progress | blocked | done | cancelled`, `priority: low | medium | high | critical`, optional `epic`, optional `milestone`).
    - `type: epic` (`id`, `status: todo | in_progress | done | cancelled`, optional `milestone`).
    - `type: milestone` (`id`, `status: open | completed`, optional `targetDate`).
  - [x] Allocates next `<KEY>-<NNN>` ID inside a `BEGIN IMMEDIATE` transaction by taking `max(highest numeric suffix for <KEY> across indexed/on-disk docs, projects.next_seq) + 1` and updating `projects.next_seq`.
  - [x] CLI adds `localatlas task create <title> [--priority ...] [--milestone ...] [--epic ...]`, `localatlas epic create <title>`, and `localatlas milestone create <title>`.
- **Decisive Failure & Recovery Tests**:
  - [x] Wiping the disposable index tables (`doc_index`, `doc_fts`), running `reindex`, and creating a new task continues numbering past the highest existing `<KEY>-<NNN>` file on disk without collision.

### `LA-M4-02` — Note-to-Task Promotion (`task promote`)
- **As a** Solo Developer or Coding Agent,
- **I want** `localatlas task promote <path.md> [--priority ...] [--milestone ...] [--epic ...]` to upgrade an existing Markdown note into a structured task,
- **So that** rough notes can become tracked tasks without losing their file path, body, or custom frontmatter keys.
- **Acceptance Criteria**:
  - [x] Allocates the next `<KEY>-<NNN>` ID (if the note lacks an `id`), sets `type: task` and default `status: todo` / `priority: medium` in frontmatter, and preserves 100% of existing body and unrecognized frontmatter keys using `If-Match`.
- **Decisive Failure & Recovery Tests**:
  - [x] Promoting a note that already has a valid `type: task` and `id` is rejected or no-ops cleanly without allocating a duplicate ID.

### `LA-M4-03` — Task/Epic/Milestone Querying, Rollup Semantics & Status Transitions
- **As a** Coding Agent or Solo Developer,
- **I want** CLI and API commands to filter tasks, transition task status atomically, and compute deterministic Epic/Milestone completion rollups,
- **So that** progress reporting handles cancelled tasks, code-block checkboxes, and broken references predictably.
- **Acceptance Criteria**:
  - [x] CLI adds `localatlas task list [--status ...] [--priority ...] [--milestone ...] [--epic ...] [--json]` and `localatlas task update <id> [--status ...] [--priority ...] [--milestone ...] [--epic ...] [--if-match <etag>]`.
  - [x] **Deterministic Rollup Rules**:
    - Epic and Milestone progress reports `{ total, todo, inProgress, blocked, done, cancelled, completionRatio }` where `cancelled` tasks are tracked separately and excluded from the `done / activeTotal` completion denominator.
    - Checklist item counts (`- [ ]` vs `- [x]`) ignore lines inside fenced code blocks (` ``` `).
    - Tasks referencing a non-existent `epic` or `milestone` ID/name are surfaced under an `"unlinked / broken reference"` diagnostic warning rather than silently dropped or crashing.
  - [x] HTTP API adds `GET /api/projects/:id/tasks`, `POST /api/projects/:id/tasks`, and `PATCH /api/projects/:id/tasks/:taskId` (requiring `If-Match`).
- **Decisive Failure & Recovery Tests**:
  - [x] Updating a task with an invalid status (`--status invalid`) fails with `400` and leaves the `.md` file untouched.
  - [x] Markdown code blocks containing `- [ ] example` are excluded from checklist progress rollups.

### `LA-M4-04` — Web Task List, Roadmap Rollup & Kanban Board View
- **As a** Solo Developer,
- **I want** project workspace views for **Documents**, **Kanban Board**, and **Roadmap / List**,
- **So that** I can visually filter and move tasks across statuses while the underlying `.md` files update on disk with ETag concurrency protection.
- **Acceptance Criteria**:
  - [x] Kanban Board displays columns for `todo`, `in_progress`, `blocked`, `done`, and a collapsible `cancelled` column, with filter controls for `milestone`, `epic`, and `priority`, plus a `+ New Task` action.
  - [x] Moving a card sends `PATCH /api/projects/:id/tasks/:taskId` with `If-Match: "<etag>"`; clicking a card opens its full Markdown body and interactive checklist.
  - [x] Roadmap view displays Milestones and Epics with completion progress bars and surfaces any broken epic/milestone references.
- **Decisive Failure & Recovery Tests**:
  - [x] Moving a card whose underlying `.md` file was concurrently modified triggers the `409 Conflict` prompt instead of clobbering disk changes.

---

## 7. Epic M5: Read-Only Git Adapter & Agent Context Command
**Goal**: Provide strictly side-effect-free awareness of the imported repository's Git state (including disabling background Git monitors/hooks) and a byte/token-bounded context command for coding agents.

### `LA-M5-01` — Strictly Side-Effect-Free Git CLI Adapter
- **As a** Solo Developer or Coding Agent,
- **I want** `localatlas status` and `GET /api/projects/:id/status` to include the imported repository's Git state alongside all existing project identity fields without ever mutating `.git` or spawning background daemons,
- **So that** LocalAtlas surfaces live repo context while honoring the zero-repo-mutation guarantee.
- **Acceptance Criteria**:
  - [x] Preserves all existing M0 project identity fields (`id`, `key`, `name`, `sourcePath`, `managedPath`, `createdAt`) and adds `git: { branch, head: { sha, subject, timestamp } | null, dirtyCount, recentCommits } | null`.
  - [x] Invokes `git` with `--no-optional-locks -c core.fsmonitor=false -c gc.auto=0` (and `GIT_OPTIONAL_LOCKS=0`), a 3s timeout, and output buffer cap so Git never writes index locks, triggers auto-gc, or spawns an `fsmonitor` daemon/hook inside `sourcePath`.
  - [x] Gracefully handles non-Git directories (`git: null`), missing `git` binary, detached `HEAD`, and unborn `HEAD` (`git init` with 0 commits).
- **Decisive Failure & Recovery Tests**:
  - [x] In a repository configured with `core.fsmonitor`, running `localatlas status` spawns zero fsmonitor processes and leaves `.git` and working tree files/mtimes 100% untouched.
  - [x] Running `localatlas status` on a `git init` repo with 0 commits returns `head: null` and `recentCommits: []` with exit code `0`.

### `LA-M5-02` — Byte- and Line-Bounded Agent Context Command (`localatlas context`) & `AGENTS.md` Snippet
- **As a** Coding Agent,
- **I want** `localatlas context [--json]` to output a strictly bounded project briefing and `localatlas agents-md` to print a ready-to-paste `AGENTS.md` workflow snippet,
- **So that** I can bootstrap full project context in one command without overflowing my context window.
- **Acceptance Criteria**:
  - [x] Resolves active project from `process.cwd()` and enforces both a line cap (`<= 120 lines`) and byte cap (`<= 8 KB` by default, configurable via `--max-bytes` / `--max-items`):
    1. Project identity (`name`, `key`, `id`, `sourcePath`).
    2. Read-only Git summary (branch, HEAD, dirty count, up to 5 recent commits).
    3. Active Milestones & Epics progress rollups.
    4. Active Tasks (`in_progress` and `blocked` first, then top high-priority `todo`, plus overflow count).
    5. Key root/recent documentation paths and titles.
  - [x] `localatlas agents-md` outputs a standardized snippet teaching coding agents how to run `localatlas context`, read specs by ID (`localatlas read SAV-024`), and update tasks (`localatlas task update SAV-024 --status in_progress --if-match <etag>`).
- **Decisive Failure & Recovery Tests**:
  - [x] In a project with 200 documents, 100 tasks, and long titles, `localatlas context` output never exceeds `8 KB` or `120 lines` and includes a deterministic truncation footer.

---

## 8. Epic M6: Packaging, Cross-Platform CI & Recovery Verification
**Goal**: Package LocalAtlas as an installable global CLI/server binary and verify multi-process and cross-platform resilience across macOS, Linux, and Windows.

### `LA-M6-01` — Distributable Build, Global CLI Binary (`bin`) & Installed Smoke Test
- **As a** Solo Developer,
- **I want** `npm run build` to produce a compiled `dist/` package with a `localatlas` `bin` entrypoint verified from an external working directory,
- **So that** I can install LocalAtlas globally and run `localatlas` from any repository without `tsx`.
- **Acceptance Criteria**:
  - [x] Compiles TypeScript to `dist/` and configures `"bin": { "localatlas": "./dist/cli.js" }` and `"files": ["dist", "public"]` in `package.json`.
  - [x] Automated smoke test runs the compiled `dist/cli.js` from an isolated temp directory (`import`, `write`, `read`, and `GET /` static UI asset check).

### `LA-M6-02` — Multi-Process Contention & Crash-Recovery Verification Suite
- **As a** Local Operator,
- **I want** automated stress tests simulating concurrent CLI/server writes, interrupted writes, and corrupted index recovery,
- **So that** race conditions and crash scenarios are continuously verified.
- **Acceptance Criteria**:
  - [x] Spawns parallel CLI writer subprocesses alongside an active HTTP server instance, verifying zero `SQLITE_BUSY` crashes, accurate `409 Conflict` enforcement, and cleanup of stale `.localatlas-tmp-*` files from simulated dead PIDs.
  - [x] Simulates index corruption / deletion and verifies `localatlas reindex` restores 100% of search, backlink, and task state from canonical Markdown files.

### `LA-M6-03` — Cross-Platform CI Matrix (macOS, Linux, Windows)
- **As a** Local Operator,
- **I want** a GitHub Actions CI workflow running `npm run typecheck`, `npm run build`, and `npm test` across `ubuntu-latest`, `macos-latest`, and `windows-latest`,
- **So that** OS-specific filesystem and path regressions are caught automatically on every push.
- **Acceptance Criteria**:
  - [x] `.github/workflows/ci.yml` executes typecheck, build, and full test suite on Node 22+ across Linux, macOS, and Windows.
