# Execution progress

Last updated: 2026-10-27 (session in progress).

## Baseline before changes

| Check | Command | Result |
| --- | --- | --- |
| Runtime | `node --version` / `npm --version` | Node v26.5.0, npm 12.0.2 |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS; `public/app.js` 748.45 kB (203.40 kB gzip) with the existing >500 kB warning |
| Node tests | `npm test` | PASS 57/57, no skips, ~10.8 s (includes the 3 pre-existing agent-setup tests) |
| Browser E2E | `npm run test:e2e` | Not run in this session yet |
| Native packaging | `npm run tauri:build` | Not run in this session; previous smoke record exists in `docs/RELEASE_SMOKE.md` |

Environment: macOS arm64, Python 3.9.6, Rust 1.97.1. Node v26.5.0 is outside the documented supported line (24.x preferred, 22.13 minimum), so this evidence does not replace a supported-runtime CI run.

## Work completed this session

### 1. Repository-owned agent skills
- Changed `.gitignore` to ignore `.qoder/*` except `.qoder/skills/**`.
- Why: `AGENTS.md` and `README.md` link to those skills, and `test/agent-setup.test.ts` asserts they exist. A fresh clone previously could not satisfy either.
- Status: DONE.
- Evidence: agent-setup tests pass; ignore rules still apply to future runtime state.

### 2. Task linked-document navigation
- Core: `getTaskDocumentLinks` in `src/core/context.ts` resolves the task's own Markdown links using one precomputed path/ID lookup, keeps project scope, excludes the task itself, reports unresolved refs, examines at most 100 candidates, caps resolved documents and unresolved refs at 20 each, and reports `truncated` / `unresolvedTruncated`.
- API: `GET /api/projects/:id/tasks/:taskId/documents`; unknown or non-task selectors return 404.
- CLI: `localatlas task docs <id>`.
- UI: task details dialog loads and renders linked documents with loading, empty, error, unresolved, and truncation states; clicking a document opens it in Docs. A request sequence prevents a stale response from populating another task.
- Docs: `docs/CLI.md` updated with the bounded contract.
- Status: DONE (2026-10-26).

### 3. Independent review and audit corrections
- Security: removed per-link full-project scans and added candidate/unresolved caps.
- Architecture: eliminated duplicate task reconciliation and guarded late task-detail responses.
- Product/docs: corrected PRD-4 to dependency-only proposal gating, split PRD-3/PRD-5 evidence, and corrected store/panel/ARIA/bundle claims.

### 4. PATCH contract hardening
- `PATCH /api/projects/:id/tasks/:taskId` accepts only `status`, `priority`, `epic`, `milestone`, `title`, `body`, and `ifMatch`.
- `dependsOn` / `dependencies` and unknown fields now return `400`; dependency changes point to the proposal endpoint.
- Status: DONE (2026-10-26).

### 5. Backlink grouping, UI benchmark, and milestone documentation sync
- Backlinks carry `sourceType` / `sourceStatus`; the Docs sidebar groups linked mentions into Tasks and Documents with M3/E2E coverage.
- Added `npm run benchmark:ui` and recorded the browser baseline; decision is to keep panels eager.
- `docs/BACKLOG.md` is now an explicit historical M1–M6 delivery record; corrected the stale Node minimum, removed the “future” index claim from ARCHITECTURE, and qualified session/profile/proposal/recap paths under `docs/` in FILE_FORMAT.
- Status: DONE (2026-10-27).

### 6. Task link picker and unlink
- `getTaskDocumentLinks` now returns the raw `refs` that resolved to each document, so the UI can remove the exact link token.
- Task details can add a safe Atlas document path as a wiki-link and remove resolved or unresolved links from the description draft; both still require the impact preview and confirmation.
- Link edits clear a previously prepared preview, so confirmation cannot apply a stale proposal. Removing a whole link-only line drops that line; unrelated body text is preserved.
- Status: DONE (2026-10-27).

### 7. Codex restart semantics and the experimental chat path
- LA-ENG-09 decided: a live PTY is reused only within one backend process. A restart ends it, and the next launch starts a fresh Codex session with freshly bounded context. There is no auto-reattach or conversation resume, and the UI must not describe a restart as continuation. Evidence: `docs/ARCHITECTURE.md`, `docs/RELEASE_SMOKE.md` (Codex CLI 0.163.0 restart check), `docs/VISION.md`.
- LA-ENG-11 decided: the `/api/projects/:id/codex-chat/*` routes and the unused `useCodexStore.js` stay as internal-only implementation details; they are not a supported agent path. The supported path remains the project-scoped Codex CLI PTY. Evidence: `docs/ARCHITECTURE.md`, `docs/PRD.md`, `docs/VISION.md`.
- Status: DONE (2026-10-27). No real-model session was run for these decisions; they document existing behavior and scope.

## Verification log for this session

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | PASS after the final core/UI edits |
| Build | `npm run build` | PASS; `public/app.js` 755.34 kB (205.13 kB gzip), `public/app.css` 499.11 kB, `react-vendor` 223.87 kB, existing size warning |
| Focused core/API/CLI tests | `npm exec -- node --import tsx --test test/task-documents.test.ts` | PASS 5/5 (link kinds, isolation, 404s, 20-link boundary, unresolved cap, stale index) |
| Focused proposal/PATCH test | `npm exec -- node --import tsx --test --test-name-pattern='M9 impact summaries' test/m9.test.ts` | PASS 1/1 |
| Full Node suite | `npm test` | PASS 62/62, no skips, 8.1 s |
| Focused browser tests | `npm run test:e2e -- --grep "task details list linked documents"` and `--grep "task link picker"` | PASS 1/1 each |
| Full browser suite | `npm run test:e2e` | PASS 4/4, 18.8 s |
| Whitespace | `git diff --check` | PASS |
| Ignore rules | `git ls-files --others --exclude-standard .qoder` | Both SKILL.md files trackable; `.qoder/settings.json` ignored |

The browser test proves both directions: task details → linked document, and the document's “Linked mentions” back to the task. It also verifies the unresolved-link message.

## Unverified in this session

- Native Tauri build and lifecycle: not rerun. Previous evidence is in `docs/RELEASE_SMOKE.md`.
- Real Codex process, clean-machine install, upgrade, signing/notarization: not run; see blocked items.
- CI matrix on Node 22/24 and Windows: not run; local runtime is Node v26.5.0.
- Manual browser session beyond the automated E2E: not performed; E2E covers the new flow.

## Known unverified or blocked work

See `tasks/backlog.md` for details:
- LA-ENG-05: desktop packaging/agent smoke in CI — OPEN.
- LA-ENG-06: Windows PTY — BLOCKED (no Windows environment).
- LA-ENG-07: Developer ID signing/notarization — BLOCKED (founder approval/credentials).
- LA-ENG-08: clean-machine install/restart/upgrade — BLOCKED (no clean machine).
- LA-ENG-10: unmocked agent browser workflow — OPEN (needs real Codex; current E2E uses a stub).

## Next steps

1. Founder decisions: signing/notarization, external distribution, and Windows targeting. The Codex chat-path question is resolved as internal-only.
2. Release-gate work: LA-ENG-05/08/10 need CI, a clean machine, and a real Codex executable. LA-ENG-09 is documented and closed; its real-binary restart evidence is recorded.
3. All locally actionable feature and documentation work in the current backlog is complete. Remaining items need founder decisions or external environments: packaging/CI, Windows PTY, signing, clean-machine upgrade, and the unmocked agent workflow.
