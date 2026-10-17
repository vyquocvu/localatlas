# Vision

LocalAtlas is a lightweight local-first workspace for individuals managing multiple software projects. Import existing directories; never clone or mutate repositories as a side effect. Plan and document work through plain Markdown. Humans use a browser UI; developers and coding agents use a CLI over the same core.

Each project has isolated Atlas-managed documents and Markdown tasks. Coding-agent sessions belong to one project and may link to one task; a task-scoped context request includes only that task, its declared dependencies, explicitly linked Atlas documents, its session notes, and read-only Git evidence. Unregistering a project only removes its registry entry; source files are never deleted. Relinking changes the registered source path without changing the project identity or managed documents.

LocalAtlas can host a project-scoped Codex conversation in the browser by connecting to the user's installed local Codex CLI. The conversation stays linked to the selected project and uses the user's Codex configuration and local transcript storage. It starts a separate Codex conversation and does not import the current ChatGPT web conversation.

## Principles
- Multi-project, single local instance.
- Markdown-first, readable without LocalAtlas.
- Offline by default; no account, cloud, Tauri, MCP or Bitbucket clone.
- Editable Atlas documents live separately from imported source. Repository Markdown can be opened explicitly in a read-only view; it is never copied or indexed as Atlas content.
- No surprise writes to source repositories.
- Never include another project's docs, tasks, or sessions in a project's context bundle.

## Non-goals for MVP
Collaboration, authentication for remote deployment, syncing across devices, rich-text WYSIWYG, autonomous agent execution, Git mutations.
