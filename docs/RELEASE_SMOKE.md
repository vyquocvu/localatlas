# Desktop release smoke record

Recorded 2026-10-25 on one development Mac. This is implementation evidence, not a clean-machine release sign-off.

## Environment

- macOS Darwin 25.6, Apple Silicon arm64
- Node.js v26.5.0; Rust 1.97.1; Xcode 27.1
- Codex CLI 0.163.0, logged in through ChatGPT
- Tauri 2.12.4

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Prepare and package | PASS | `npm run tauri:prepare` and `npm run tauri:build`; produced `LocalAtlas.app` (11.76 MiB) and `LocalAtlas_0.1.0_aarch64.dmg` (3.28 MiB). |
| DMG integrity and copy | PASS | `hdiutil attach` verified the image checksums; copied its app into `/tmp/localatlas-b3-install/LocalAtlas.app`. |
| Launch and first-run UI | PASS | Opened the copied app with a disposable `LOCALATLAS_HOME`; bundled backend reported loopback URLs and the Portfolio UI loaded. |
| Shutdown and restart | PASS | Cmd+Q made each previous loopback port fail to connect; reopening the copied app started a new backend on another ephemeral port. The project and task records persisted. |
| Task-scoped Codex | PASS | The installed app's task card launched Codex CLI 0.163.0 with `task:B3-001`; its terminal showed the bounded LocalAtlas task context and real CLI launcher activity. |
| ETag-protected task update and UI refresh | PASS | Codex changed `B3-001` from `in_progress` to `done` using the current ETag `2bc70faa3dcfe0453c211d10295b436661cc035be33a5bdfe88111c01c1ba8ff`. The board moved the task to Done. CLI reread returned ETag `b5a030e35dafe0fc9b28b7584397846790dcca1cbaa0839f3766f52a67bf6d81`; the restarted app still showed zero open tasks. |
| Backup and offline restore | PASS | Created a backup from the installed app; UI reported 1 project, 1 document, and 4 verified checksums. Restored to a second disposable home, reindexed (`indexedDocs: 1`, no warnings), and read `B3-001` as `done` with the same ETag. The imported fixture Git status stayed clean. |

## Open release gates

- This was not a clean supported machine or a system-level installation into `/Applications`; it was a copied app under `/tmp` on the build host.
- The app reports an ad-hoc linker signature. `codesign --verify --deep --strict` on the copied bundle failed with “code has no resources but signature indicates they must be present”; the app launched through LaunchServices, but Developer ID signing, notarization, and Gatekeeper behavior remain unverified.
- Backend restart ended the old process-local PTY. LocalAtlas intentionally does not auto-reattach it or resume the prior Codex conversation; the next launch starts a fresh Codex session with freshly bounded context. This is the documented semantics, not an outstanding resume feature.
- Upgrade from an earlier installed version was not exercised.

The desktop distribution and unmocked agent release gates remain open until those checks pass on a clean supported machine with the intended signing identity.

## Unmocked web Codex workflow (2026-10-30)

Recorded on the same development Mac. This is not a desktop-install check and is not CI.

- Codex CLI 0.165.0
- Command: `LOCALATLAS_E2E_REAL_CODEX=1 npm run test:e2e -- --grep 'unmocked task-scoped Codex'`
- Result: PASS (~50s after adding New session). Import → task-scoped Ask Codex → Codex marked `LIVE-001` done via CLI → **New session** started a distinct PTY that still showed `You are working in LocalAtlas project LIVE`. Fixture git status unchanged.
- Limits: dirty working tree (not a commit SHA); Playwright web server, not the packaged app; backend process was not killed/restarted; CI still skips the spec.
