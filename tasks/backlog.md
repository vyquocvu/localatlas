# LocalAtlas engineering backlog

This is the repository engineering plan. It is not the LocalAtlas-managed task format. Product tasks that must appear in the LocalAtlas workspace are created through `npm run cli -- task create ...` with an explicit `--project`, per `AGENTS.md`.

Status values: DONE, IN PROGRESS, OPEN, BLOCKED, DECISION.
Priority: P0 (release/data safety), P1 (product value), P2 (improvement).

## Completed in this cycle

### LA-ENG-01 — Track repository-owned agent skills
- Priority: P0
- Status: DONE (2026-10-26)
- Scope: stop ignoring `.qoder`, keep runtime state ignored, ensure `AGENTS.md` and `README.md` links resolve in a fresh clone.
- Acceptance: `.qoder/skills/**/SKILL.md` is trackable; `test/agent-setup.test.ts` passes; no other ignored path changes.
- Verification: `git check-ignore`, focused agent-setup test, full `npm test`.
- Evidence: `.gitignore` negation rules; agent-setup tests pass locally.

### LA-ENG-02 — Task linked documents in core, API, and CLI
- Priority: P1
- Status: DONE (2026-10-26)
- Scope: resolve a task's own Markdown outbound links into project-scoped document metadata; report unresolved refs; cap at 20 with a truncation flag; never widen across projects or link the task to itself.
- Interfaces: `getTaskDocumentLinks`, `GET /api/projects/:id/tasks/:taskId/documents`, `localatlas task docs <id>`.
- Acceptance: links resolve titles/types/status; same-project task links are marked `isTask`; broken refs are listed; project isolation holds; output is bounded.
- Verification: `test/task-documents.test.ts` (core, HTTP, CLI, 404s, cap/isolation).
- Evidence: focused suite 5/5 PASS; full Node suite 62/62.

### LA-ENG-03 — Linked documents in task details UI
- Priority: P1
- Status: DONE (2026-10-26)
- Scope: task details dialog loads linked documents, shows loading/empty/error/unresolved/truncation states, and opens the selected document in Docs.
- Depends on: LA-ENG-02.
- Acceptance: dialog lists resolved docs; unresolved refs are visible; click navigates to the correct document; no console errors.
- Verification: browser E2E case "task details list linked documents and navigate to them"; full typecheck/build/test.
- Evidence: E2E PASS 3/3 (including the new case); Node suite 62/62; the document preview also shows a Linked mentions backlink to the task. Stale responses are guarded by a request sequence.

### LA-ENG-04 — Product documentation set
- Priority: P1
- Status: DONE (2026-10-26)
- Scope: `docs/PRD.md`, `docs/DESIGN.md`, `tasks/backlog.md`, `tasks/progress.md`.
- Acceptance: documents reflect implemented behavior and explicitly separate verified, unverified, and blocked work.
- Evidence: independent product audit corrected proposal gating, evidence mapping, store/panel inventory, ARIA wording, bundle notes, and responsive minimums.

### LA-ENG-15 — Reject unsupported task PATCH fields
- Priority: P1 (data-integrity clarity)
- Status: DONE (2026-10-26)
- Scope: `PATCH /api/projects/:id/tasks/:taskId` now accepts only `status`, `priority`, `epic`, `milestone`, `title`, `body`, and `ifMatch`; dependency changes return `400` with guidance to the proposal endpoint, and unknown fields return `400` without changing the task.
- Acceptance: a dependency change cannot appear successful while leaving the task unchanged; tests cover accepted and rejected fields; docs match behavior.
- Verification: focused M9 test; full typecheck/build/test; full browser suite; `git diff --check`.
- Evidence: M9 focused PASS; Node suite 62/62; E2E 3/3. `docs/CLI.md` and `docs/DESIGN.md` describe the contract.

### LA-ENG-12 — Related-task grouping in document backlinks
- Priority: P2
- Status: DONE (2026-10-26)
- Scope: backlinks now carry `sourceType`/`sourceStatus`, and the Docs sidebar groups linked mentions into Tasks and Documents.
- Verification: M3 backlink test; browser E2E "task details list linked documents and navigate to them".
- Evidence: M3 focused PASS; E2E asserts the "Tasks (1)" group. Link editing is split into LA-ENG-16.

### LA-ENG-13 — Browser performance measurement before code-splitting
- Priority: P2
- Status: DONE (2026-10-26)
- Scope: added `npm run benchmark:ui` with a disposable workspace and three fresh browser contexts; measured load and interactions on the current bundle.
- Acceptance: recorded baseline and a decision; no speculative refactor.
- Evidence: `docs/PERFORMANCE_BENCHMARKS.md`; medians of 419 ms portfolio, 106 ms project overview, 262 ms task board, 84 ms task details with linked documents, 68 ms DOMContentLoaded. Decision: keep panels eager.

### LA-ENG-14 — Synchronize stale milestone documentation
- Priority: P2
- Status: DONE (2026-10-26)
- Scope: reconciled `docs/BACKLOG.md`, `docs/ARCHITECTURE.md`, and `docs/FILE_FORMAT.md` with the shipped M1–M6 implementation.
- Changes: BACKLOG is now an explicit historical delivery record with delivered acceptance boxes; corrected the stale Node minimum (`>=22.5.0` → `>=22.13.0`); ARCHITECTURE no longer calls search indices “future”; FILE_FORMAT now uses `docs/`-qualified session/profile/proposal/recap paths.
- Verification: `git diff --check`; full typecheck/build/test/E2E gate after the edit.

### LA-ENG-16 — Link picker and unlink in task details
- Priority: P2
- Status: DONE (2026-10-27)
- Scope: task details can add a project document link from a picker and remove resolved or unresolved links from the task description draft; both go through the existing preview/confirm proposal flow.
- Interfaces: `task docs` documents now include `refs` so the UI can remove the exact raw wiki-link or Markdown-link target without rewriting unrelated text.
- Guardrails: link edits clear any prepared impact preview; removal only strips matching link tokens (link-only lines are dropped) and leaves the rest of the body unchanged; paths outside the wiki-link grammar must be linked manually.
- Verification: focused `test/task-documents.test.ts` 5/5; focused E2E “task link picker adds and removes links through a confirmed proposal” PASS; full gate below.

### LA-ENG-09 — PTY reattach versus Codex conversation resume
- Priority: P1
- Status: DONE (2026-10-27; real-binary evidence from 2026-10-25)
- Scope: distinguish a live PTY attachment from resuming a Codex conversation after a backend restart.
- Decision: a live PTY is reused only while the same backend process runs. A restart ends the process-local PTY; the next launch starts a fresh Codex session with freshly bounded context. LocalAtlas intentionally does not auto-reattach the old PTY or resume a prior Codex conversation, and the UI must not present a restart as session continuation.
- Evidence: `docs/ARCHITECTURE.md` (live-PTY/restart semantics), `docs/RELEASE_SMOKE.md` (restart check with Codex CLI 0.163.0), `docs/VISION.md` (bounded project/task/document context per launch).

### LA-ENG-11 — Experimental HTTP Codex chat path
- Priority: P2
- Status: DONE (2026-10-27) — decided internal-only
- Decision: keep the `/api/projects/:id/codex-chat/*` routes and `src/ui/stores/useCodexStore.js` as internal implementation details; no UI imports the store. They are not part of the supported agent contract. The supported user-facing path is the project-scoped Codex CLI PTY with bounded context.
- Evidence: `docs/ARCHITECTURE.md`, `docs/VISION.md` (supported agent flow), `docs/PRD.md` (in-scope note; the founder decision was removed because the path is now documented, not pending).

## Open implementation work

### LA-ENG-05 — Add desktop packaging and agent smoke to the release gate
- Priority: P0
- Status: OPEN
- Scope: CI job for `npm run tauri:prepare` and a macOS packaging build, plus a deterministic non-terminal agent smoke. Do not advertise a signed release.
- Depends on: stable Tauri build; LA-ENG-07 for signing.
- Acceptance: CI produces a build artifact and records lifecycle results; failures upload logs.
- Verification: workflow run on macOS; local `npm run tauri:build` parity.
- Risk: long build times and runner limits.

### LA-ENG-06 — Windows PTY backend
- Priority: P1
- Status: BLOCKED (needs Windows environment)
- Scope: implement and verify shell/Codex terminals on Windows; keep the current explicit platform error until then.
- Acceptance: interactive shell works on a supported Windows version; docs and UI stop claiming unsupported platforms.
- Verification: Windows CI or a real Windows machine; not inferable from macOS tests.

### LA-ENG-07 — Developer ID signing and notarization
- Priority: P0 for public macOS distribution
- Status: BLOCKED (founder approval, Apple credentials, cost)
- Scope: configure signing/notarization, verify Gatekeeper, document upgrade behavior.
- Acceptance: `codesign --verify --deep --strict` and notarization succeed; clean-machine install documented.
- Verification: requires credentials; do not spend money or publish without approval.

### LA-ENG-08 — Clean-machine install, restart, and upgrade
- Priority: P0 for desktop release
- Status: BLOCKED (needs clean supported machine and a prior build)
- Scope: install, first launch, backend shutdown, restart, upgrade, backup/restore across upgrade.
- Acceptance: recorded OS/runtime/build version and step-by-step results.

### LA-ENG-10 — Unmocked agent browser workflow
- Priority: P0 for agent-workspace release
- Status: OPEN (partially blocked by Codex availability)
- Scope: import → task-scoped Codex launch → terminal I/O → CLI task update → session restart; confirm the UI context reaches the process.
- Acceptance: a recorded run on a machine with the real agent; the existing browser test only uses a stub.

## Parallelization

Safe to run in parallel now:
- LA-ENG-05 (CI/packaging) is isolated from local documentation work.
- LA-ENG-06 and LA-ENG-10 need separate environments; they should not block local work.

Do not run concurrently:
- Two builds or test suites against the same checkout.
- Two agents editing `src/ui/components/Modals.js`, `src/ui/stores/useModalStore.js`, or `public/app.js`.
- Verification of LA-ENG-03 before LA-ENG-02 is green.
