# Vision

LocalAtlas is a local Atlassian-style workspace for individuals managing multiple software projects: project work tracking connected to a durable knowledge base, running on the user's machine. The product direction brings Jira-like backlog, tasks, epics and milestones together with Confluence-like requirements, design notes and decisions. This describes the intended product experience; it does not claim parity with either product. Import existing directories; never clone or mutate repositories as a side effect. Plan and document work through plain Markdown. Humans use a Tauri desktop app or local browser UI; developers and coding agents use a CLI over the same core.

Each project has its own LocalAtlas text workspace with a `project.md` source link, an `AGENTS.md` entry point, and isolated Atlas-managed documents and Markdown tasks. Agents start from this workspace and follow `sourcePath` to the source repo when code work is requested. Coding-agent sessions belong to one project and may link to one task; a task-scoped context request includes only that task, its declared dependencies, explicitly linked Atlas documents, its session notes, and read-only Git evidence. Unregistering a project only removes its registry entry; source files are never deleted. Relinking updates that project's source link without changing the project identity or managed documents.

Developers can open a project-scoped local shell or a separate Codex CLI session in the workspace. Codex starts with bounded project, task, or selected-document context, and LocalAtlas task/document actions use the shared CLI and core. Context can be previewed or copied independently for manual use. LocalAtlas does not host a browser Codex conversation or import a ChatGPT web conversation.

The core workflow connects an idea or requirement to its specification, epic, tasks, milestone, implementation evidence, and final notes. A task should link back to the requirement and decisions that define it; a document should reveal the work that implements it. The portfolio summarizes project health while every action and context bundle stays scoped to one project.

The current implementation contains an experimental HTTP Codex chat manager and an unused browser store, but no UI imports that store. The supported user-facing agent flow is a separate project-scoped Codex CLI PTY launched with bounded context. The experimental chat routes are internal implementation details and are not part of the supported product contract.

## Principles
- Multi-project, single local instance.
- Markdown-first, readable without LocalAtlas.
- Offline by default; no account, hosted service, MCP or Bitbucket clone.
- Editable Atlas documents live separately from imported source. Repository Markdown can be opened explicitly in a read-only view; it is never copied or indexed as Atlas content.
- Import, relink, and LocalAtlas document operations never write to source repositories. A coding agent edits source files only as user-requested code work, under the user's sandbox and approval settings.
- Never include another project's docs, tasks, or sessions in a project's context bundle.

## Non-goals for MVP
Collaboration, authentication for remote deployment, syncing across devices, rich-text WYSIWYG, autonomous agent execution, Git mutations.
