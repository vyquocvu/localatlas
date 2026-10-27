---
name: verify-localatlas-changes
description: Use when implementing, debugging, reviewing, or validating LocalAtlas source changes, including storage, CLI, browser UI, terminal integration, or desktop packaging.
---

# Verify LocalAtlas changes

Follow [AGENTS.md](../../../AGENTS.md). Match evidence to the changed surface; a passing TypeScript check is not browser or native verification. Run commands from the repository root.

## Choose the checks

| Surface | Evidence |
| --- | --- |
| Storage, CLI, API | Regression in `test/`; exercise shared core and the affected adapter. Use real temporary Markdown/SQLite storage. |
| UI or state | [UI-state tests](../../../test/ui-state.test.ts), isolated browser tests, and actual browser use after rebuilding. |
| Packaging | [M6 tests](../../../test/m6.test.ts); native changes also need Tauri build/lifecycle checks. |
| Terminal/Codex | Relevant Node tests plus a real process smoke test when available; the browser terminal fixture is mocked. |
| Agent instructions/skills | [Setup tests](../../../test/agent-setup.test.ts) plus read-only agent scenarios before and after the instruction change. |

Reproduce bugs with a failing regression before changing implementation. Keep fixtures outside real workspaces; reuse [test helpers](../../../test/helpers.ts) to close databases and clean up owned temporary directories. Stop watchers and child processes before cleanup.

## Node verification

Use Node.js 24.x or, on the 22.x line, 22.13+ for unflagged `node:sqlite`. The full suite needs `python3` with `pty`, `fcntl`, and `termios` on macOS/Linux: [terminal tests](../../../test/terminal-context.test.ts) launch a real PTY despite mocking Codex. Do not promise a passing full gate on native Windows; terminal portability remains an open release gate.

Before completion, run the full gate in order:

```bash
npm run typecheck
npm run build
npm test
```

Build first because tests inspect generated assets. For focused iteration, run the Node test runner through npm so packaging helpers receive `npm_execpath`:

```bash
npm exec -- node --import tsx --test --test-name-pattern='LA-M6-01' test/m6.test.ts
```

Substitute an existing test name/file for other cases. Confirm a nonzero executed-test count; a pattern matching nothing is not evidence. Do not run concurrent builds against the same checkout.

## Browser development

For an interactive check on macOS/Linux, run this in a dedicated shell; select a free loopback port instead of reusing another app instance:

```bash
TEST_ROOT="$(mktemp -d)"
mkdir "$TEST_ROOT/source"
export LOCALATLAS_HOME="$TEST_ROOT/home"
export PORT=3457
unset LOCALATLAS_ALLOW_REMOTE
npm run cli -- import "$TEST_ROOT/source" --key DEV
npm run cli -- task create "Browser smoke check" --project DEV
npm run dev
```

On Windows, create equivalent sibling temporary directories and process-local environment variables. Never point smoke checks at `~/.localatlas`. Stop only your own server and remove only your disposable fixtures afterward.

Open the server's loopback address, confirm the disposable project, and exercise save/reload plus relevant empty/error states. Check console/network failures. After each subsequent UI edit, run `npm run build:ui` from another shell in this checkout and reload: `dev` watches the backend, not the UI bundle.

For automated browser checks:

```bash
npx playwright install chromium
npm run build:ui
npm run test:e2e
```

Install Chromium only if missing. Use the [E2E wrapper](../../../e2e/run.mjs), not bare Playwright: it supplies isolated storage, fixture repositories, a free port, and cleanup. Leave `LOCALATLAS_E2E_REPO` unset for disposable fixtures. Forward filters with `npm run test:e2e -- --grep '<existing test title>'`.

## Native checks and reporting

For native changes, use `npm run tauri:dev` or `npm run tauri:build`; both prepare resources automatically. Consult [Roadmap](../../../docs/ROADMAP.md) for installation, shutdown/restart, platform, and unmocked Codex release gates. Never infer release readiness from a web build or mocked terminal test.

Report commands and observed results, browser evidence when relevant, and checks not performed. If a browser, Rust toolchain, or Codex executable is unavailable, state the unverified scope instead of claiming success.
