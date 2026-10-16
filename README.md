# LocalAtlas

Local-first, multi-project documentation workspace for independent developers. Import folders without copying or modifying their source repositories. Humans use a local browser interface; coding agents and developers can use the CLI.

## Foundation preview (M0)

Requires Node.js 22+.

```bash
npm install
npm run typecheck
npm test
npm run cli -- import /absolute/path/to/project
npm run cli -- projects --json
cd /absolute/path/to/project
/path/to/localatlas/node_modules/.bin/tsx /path/to/localatlas/src/cli.ts docs
npm run dev
# Open http://127.0.0.1:3456
```

CLI commands: `import <path>`, `projects`, `status`, `docs`, `read <file.md>`, `write <file.md>` (content from stdin), `serve`. Use `--project <id|name>` when not inside a registered directory; `--json` for machine-readable output.

App data defaults to `~/.localatlas`; override with `LOCALATLAS_HOME`. Managed Markdown is stored in `projects/<uuid>/docs`, separately from imported source code. The registry is JSON at M0; SQLite, sophisticated editor and task boards remain planned, not implemented. Web currently provides a minimal dependency-free editing shell; Preact is planned for M2.

**Security:** this is a local single-user development preview. The server binds only to loopback. Do not reverse proxy it or expose it to a network. See [architecture](docs/ARCHITECTURE.md).

Read [vision](docs/VISION.md), [file format](docs/FILE_FORMAT.md), [roadmap](docs/ROADMAP.md), and [agent guidelines](AGENTS.md).
