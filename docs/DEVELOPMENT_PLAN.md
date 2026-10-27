# Kế hoạch phát triển tiếp theo

Ngày đánh giá ban đầu: 2026-10-24; triển khai checkpoint bắt đầu 2026-10-25. Đây là kế hoạch và nhật ký checkpoint; chưa phải task được tạo trong workspace.

## 1. Hướng sản phẩm: local Atlassian

Định vị cập nhật ngày 2026-10-25: **LocalAtlas là workspace quản lý dự án phần mềm chạy cục bộ, kết nối công việc và tri thức trong cùng một nơi.** Người dùng lên kế hoạch bằng backlog, task, epic và milestone; viết yêu cầu, thiết kế và quyết định bằng Markdown; theo dõi tiến độ và kết quả qua các liên kết giữa tài liệu, công việc và bằng chứng Git.

“Local Atlassian” là cách mô tả trải nghiệm sản phẩm mong muốn: quản lý công việc kiểu Jira và không gian tri thức kiểu Confluence, được thiết kế cùng nhau cho cá nhân quản lý nhiều dự án. Đây là định vị đề xuất cho LocalAtlas, không phải tuyên bố đã có đầy đủ tính năng tương đương.

### Ba phần của trải nghiệm

| Phần | Người dùng cần làm được | Trọng tâm phát triển |
| --- | --- | --- |
| Quản lý công việc | Thu thập ý tưởng, sắp backlog, chia epic/task, lập milestone, xử lý blocker và theo dõi hoàn tất | Task detail, dependency, epic/milestone editor, filter và saved views |
| Không gian tri thức | Viết PRD, thiết kế, ADR, hướng dẫn; tìm lại và biết tài liệu liên quan công việc nào | Điều hướng docs, template, search/backlinks, draft recovery và conflict diff |
| Tổng quan và bàn giao | Biết dự án nào cần chú ý, việc nào tiếp theo, yêu cầu nào đã được thực hiện và vì sao có quyết định | Portfolio, recap, liên kết task–doc–Git, ghi chú tiếp tục công việc |

### Luồng cốt lõi cần hoàn thiện

**Ý tưởng / yêu cầu → tài liệu đặc tả → epic và task → milestone → thực hiện → kiểm chứng → ghi nhận kết quả.**

Ví dụ: viết PRD cho tính năng export, liên kết PRD với epic và các task, khai báo dependency, đưa vào milestone; khi làm mở đúng tài liệu từ task; khi xong lưu bằng chứng kiểm chứng và cập nhật tài liệu. Từ PRD phải thấy công việc liên quan, từ task phải thấy yêu cầu và quyết định liên quan, từ milestone phải thấy tiến độ và blocker.

Ưu tiên liên kết hai chiều có thể điều hướng và trạng thái rõ ràng trước khi thêm dashboard. Tận dụng ID, Markdown links và backlinks hiện có; chỉ mở rộng schema khi một luồng cụ thể cần đến. Giữ dependency thực thi trong cùng project; portfolio tổng hợp nhiều project mà không trộn context của chúng.

CLI và Codex là các cách thao tác trên workspace này. Luồng quản lý dự án, tài liệu và kiểm chứng phải sử dụng được độc lập với agent; đầu tư agent phục vụ việc thực hiện và bàn giao task.

### Thước đo để nghiệm thu sản phẩm

- Hoàn thành một luồng từ PRD đến milestone có task và bằng chứng kết quả bằng UI; CLI đọc/cập nhật cùng dữ liệu.
- Đi từ task đến tài liệu yêu cầu, dependency và milestone bằng liên kết trực tiếp; đi từ tài liệu đến task liên quan qua backlinks.
- Mở lại dự án và xác định được mục tiêu, công việc đang làm, blocker và bước tiếp theo mà không cần nhớ lịch sử hội thoại.
- Reload hoặc external edit không làm mất bản nháp hay âm thầm ghi đè nội dung.

Giữ các ràng buộc trong [Vision](VISION.md): local-first, Markdown canonical, core dùng chung cho CLI/API/desktop, project isolation, Git chỉ đọc và không sửa source repo khi quản lý workspace. Chưa mở rộng sang cloud sync, collaboration, MCP hoặc agent tự chạy nền.

## 2. Hiện trạng và khoảng trống có bằng chứng

| Phần | Đã có | Khoảng trống / tác động |
| --- | --- | --- |
| Nền tảng | Registry, atomic writes, lock, ETag, search/backlinks, backup/restore | Cần đưa recovery và giới hạn nền tảng vào luồng release thực tế |
| Tasks | Task/epic/milestone, board/list/roadmap, proposal có xác nhận | Board chỉ render bốn trạng thái, thiếu `cancelled` dù store có `cancelledCollapsed`: `src/ui/components/TasksWorkspace.js`, `src/ui/stores/useTaskStore.js` |
| Milestones | `createMilestone` lưu `targetDate` | `getProjectRollup` luôn trả `targetDate: null`; roadmap UI chưa thể hiện ngày đích: `src/core/tasks.ts` |
| Dependencies | Context và impact đọc `dependsOn`; health đếm bottleneck | `createTask`/`updateTask` chưa có trường dependency; cần luồng chỉnh sửa có validation và chẩn đoán cycle/missing reference |
| Editor | ETag conflict, bảo vệ response cũ, giữ keystroke phát sinh trong lúc save | Conflict UI chỉ có reload/force overwrite; chưa thấy persistent draft hay diff: `DocumentWorkspace.js`, `useDocumentStore.js` |
| Portfolio | Hai nguồn tổng hợp: workspace overview và portfolio summary | `getPortfolioSummary` duyệt project tuần tự; nhiều nơi đọc/reconcile lại docs và Git: `workspace-insights.ts`, `useTaskStore.js` |
| Traceability | Match task ID trong commit subject và SHA từ session | Bản ban đầu chỉ xem năm commit gần nhất; D3 đã thêm phạm vi lịch sử có giới hạn, ghi rõ HEAD/time/output cap và phân biệt evidence (xem nhật ký) |
| Health | Broken links, orphan docs, DoD issues, bottlenecks | Score dùng penalty cố định; orphan note chưa chắc là lỗi. Cần hiển thị nguyên nhân và hành động thay vì coi score là chất lượng dự án |
| Agent | PTY shell/Codex với context project/task/document | PTY phụ thuộc Python + Unix modules; roadmap còn gate Codex thật. HTTP `codex-chat` và manager cũ được giữ làm nội bộ, không phải đường tích hợp được hỗ trợ (xem ARCHITECTURE) |
| Release | CI typecheck/build/Node tests trên ba OS | CI chưa có browser E2E/native packaging; installable desktop và native Windows terminal chưa được xác minh |
| Tài liệu/runtime | Roadmap phản ánh M7–M10 | Backlog chủ yếu M1–M6; File Format vẫn ghi proposed/M3. Engine, Tauri check và tài liệu trước đây chưa thống nhất runtime minimum |

Các mục trên là quan sát code; chưa coi chúng là bug đã tái hiện nếu chưa có regression test. Backlog cũ có checkbox chưa đánh dấu không có nghĩa tính năng chưa tồn tại.

## 3. Thứ tự thực hiện

Ước lượng là ngày làm việc của một developer quen repo, gồm code, kiểm thử và docs. Không phải cam kết lịch; điều chỉnh sau đợt đầu.

### Đợt A — Củng cố bản hiện tại (P0, khoảng 5–8 ngày)

**A1. Khép các thiếu sót task/roadmap (1–2 ngày).**

- Hiển thị nhóm cancelled có thể thu gọn; filter cancelled phải cho kết quả trên board và list.
- Đưa `targetDate` từ Markdown qua rollup đến UI; quy định rõ date-only và kiểm tra ngày hợp lệ, tránh lệch ngày theo timezone.
- Kiểm tra rollup milestone khi task liên kết epic bằng ID, path hoặc title; có regression nếu phát hiện lệch.
- Nghiệm thu: tạo/cập nhật bằng CLI/API, reload UI vẫn đúng; không đổi completion denominator của task cancelled; concurrent update trả conflict.

**A2. Đưa browser verification vào CI (1–2 ngày).**

- Dùng `e2e/run.mjs` với workspace disposable; chạy Chromium trên Linux trước, lưu trace/screenshot khi fail.
- Bổ sung browser case cho cancelled, target date, dirty editor nhận external CLI update, conflict task và đổi project khi request còn pending.
- Nghiệm thu: CI thực thi browser thật; test không đọc/ghi workspace mặc định. UI source là JavaScript nên typecheck không thay thế bước này.

**A3. Chốt runtime và phạm vi release (1–2 ngày).**

- Đồng bộ engine, launcher, docs và thông báo lỗi với Node được hỗ trợ; ưu tiên Node 24, mức tối thiểu Node 22.13+.
- Giữ kiểm tra core/CLI đa nền tảng; tách capability terminal để không báo Windows terminal đã hỗ trợ khi chỉ core pass.
- Thêm kiểm tra khả dụng Node/Python/PTY/Codex khi mở terminal, kèm hướng xử lý tại chỗ. Không thay approval/sandbox của người dùng.
- Nghiệm thu: thiếu dependency cho lỗi dễ hiểu; CLI/docs/context vẫn dùng được; có platform support matrix dựa trên bằng chứng. Implemented 2026-10-25: engine and Tauri checks now require Node 22.13+; shell/Codex PTYs reject non-macOS/Linux with a clear error.

**A4. Thống nhất đường tích hợp agent và docs (1–2 ngày).**

- Đã quyết định 2026-10-27: giữ `codex-chat` routes/manager làm chi tiết nội bộ, không có UI consumer; đường được hỗ trợ là Codex CLI PTY theo project. Không thêm chat UI trái Vision.
- Cập nhật Roadmap/File Format và liên kết backlog mới, phân biệt implementation với release verification.
- Nghiệm thu: một luồng agent chính được mô tả rõ, các public command/route bị ảnh hưởng có ghi chú tương thích và regression phù hợp.

### Đợt B — Bảo vệ và khôi phục công việc (P1, khoảng 6–9 ngày)

**B1. Draft recovery và conflict diff (3–4 ngày).**

- Lưu bản nháp cục bộ theo workspace/project/document, gồm base ETag và thời điểm lưu; hiển thị trạng thái chưa lưu rõ ràng.
- Khi reload/crash, cho người dùng xem và khôi phục draft. Kiểm tra lại disk ETag trước khi ghi.
- Hiển thị bản local và disk cạnh nhau; cho copy/export draft và chọn nội dung để lưu bằng ETag mới. Nếu disk đổi tiếp, quay lại conflict.
- Quyết định vị trí lưu draft trước khi code: browser storage có quota và có thể mất theo origin/port Tauri; managed draft storage cần API, confinement và chính sách cleanup. Draft không được lẫn vào index tài liệu canonical.
- Nghiệm thu: draft của project A không xuất hiện ở B; reload giữ được nội dung; không tự merge hay force overwrite; lỗi quota/storage không làm mất buffer hiện tại.

**B2. Backup/recovery dễ sử dụng (2–3 ngày).**

- Bổ sung entry point UI cho backup trên shared core đang có; hiển thị đích, số project/docs và kết quả xác minh manifest/checksum.
- Restore có preflight, nêu workspace đích và trạng thái conflict trước xác nhận; giữ semantics an toàn hiện tại, chưa thêm restore ghi đè tùy tiện.
- Nghiệm thu: restore vào workspace disposable, reindex và đọc lại docs/tasks/profile/session; backup hỏng và đường dẫn overlap bị từ chối; source repo không đổi.

**B3. Hoàn thiện release smoke (1–2 ngày cộng thời gian máy sạch).**

- Đóng gói desktop trên nền tảng đã chọn; kiểm tra install, first launch, shutdown/restart và upgrade với backup/restore.
- Chạy browser → task-scoped Codex thật → CLI task update có ETag → UI refresh → restart. Phân biệt attach PTY còn sống với resume hội thoại sau backend restart.
- Nghiệm thu: ghi lại OS/runtime/Codex version và kết quả từng bước. Môi trường thiếu Codex hoặc máy sạch phải để gate chưa đạt.

### Đợt C — Lập kế hoạch công việc tốt hơn (P1, khoảng 6–9 ngày)

**C1. Dependency có thể quản lý và kiểm tra (3–4 ngày).**

- Chuẩn hóa đọc/ghi `dependsOn` dùng chung core; CLI/API/UI thêm, bỏ và xóa toàn bộ dependency với ETag.
- Chỉnh dependency của task hiện có đi qua impact/proposal và xác nhận theo policy đang có; không tạo đường UI bypass xác nhận.
- Từ chối self-dependency, cycle và tham chiếu sang project khác khi ghi; dữ liệu cũ có lỗi được health chẩn đoán mà không phá nội dung.
- Hiển thị “blocked by” và “unblocks”; xác định rõ dependency cancelled được xử lý thế nào, chưa tự đổi status task.
- Nghiệm thu: graph A → B → C, cycle, missing ID, dependency đã done/cancelled, stale ETag và giới hạn project có test core/CLI/API/browser.

**C2. Task detail và milestone editor (2–3 ngày).**

- Task detail chỉnh title, priority, epic/milestone, checklist và dependency, vẫn cho mở Markdown gốc; reuse shared operations.
- UI tạo/sửa epic và milestone với lựa chọn từ dữ liệu có thật, giảm nhập sai reference.
- Nghiệm thu: unknown frontmatter và body được giữ; không làm mất draft khi chuyển view; proposal preview cho thay đổi cần xác nhận.

**C3. Saved views và danh sách việc có thể bắt đầu (1–2 ngày).**

- Lưu filter/sort theo project: priority cao, blocked, đang làm, chưa hoàn tất dependency; có reset.
- “Ready to start” dựa trên trạng thái và dependency, hiển thị lý do xếp hạng; đây là gợi ý, không tự claim/chạy agent.
- Nghiệm thu: kết quả ổn định, filter không rò giữa project; task thiếu dependency không bị gợi ý là sẵn sàng.

### Đợt D — Portfolio nhanh và có hành động (P2, khoảng 4–7 ngày)

**D1. Hợp nhất tổng hợp và đo hiệu năng (2–3 ngày).**

- Đo trước với fixture 10/50 project và project 1.000 docs; ghi latency, số lần Git chạy và số lần reconcile, không import repo thật để benchmark.
- Reuse snapshot trong cùng request, bounded concurrency và phân biệt kết quả stale/fresh; lỗi một project không làm mất toàn portfolio.
- Tối ưu health/backlinks để tránh đọc lặp; cache chỉ được dùng khi có invalidation watcher/SSE và đường reconcile phục hồi.
- Nghiệm thu: giữ nguyên kết quả, giảm tác vụ lặp; chốt ngân sách latency sau khi có baseline. Build hiện cảnh báo `app.js` >500 kB: đo load rồi mới chọn lazy loading terminal/panel.

**D2. Attention inbox và health có hành động (1–2 ngày).**

- Gom task blocked/critical, proposal pending, session cần tiếp tục và broken links thành danh sách có deep link.
- Tách informational orphan note khỏi lỗi cần sửa; hiển thị bằng chứng, thời điểm tính và giới hạn của health score.
- Nghiệm thu: click đến đúng project/task/doc, không đổi dữ liệu tự động; project paused/archived có filter rõ ràng.

**D3. Traceability trung thực hơn (1–2 ngày).**

- Phân biệt “commit chứa task ID” với “HEAD được ghi nhận khi session bắt đầu”; không gán cả hai cùng ý nghĩa chứng minh hoàn tất.
- Cho truy vấn lịch sử Git sâu hơn với giới hạn thời gian/output; hiển thị phạm vi đã tìm và truncation, không load toàn bộ repo mặc định.
- Nghiệm thu: task cũ ngoài năm commit gần nhất vẫn có thể tìm trong phạm vi chọn; Git timeout/missing binary không làm hỏng workspace.

## 4. Phụ thuộc và cách chia PR

Trình tự đề xuất: A1 → A2 → A3/A4 → B1 → C1 → C2/C3 → D. B2/B3 cần hoàn tất trước khi công bố desktop release; không nhất thiết chặn mọi cải tiến web/CLI.

Mỗi PR là một lát cắt có thể kiểm chứng: core → CLI/API → UI nếu liên quan → regression → docs. A1 nên tách cancelled board và milestone dates thành hai PR nhỏ. Chưa cần thêm framework hay tách service.

Đợt nên bắt đầu ngay: **A1 + A2**. Sau đó ưu tiên **B1 + C1 + C2**, bổ sung điều hướng task–doc hai chiều trên backlinks hiện có và kiểm thử luồng PRD → epic/task → milestone → kết quả. Đây là lát cắt sản phẩm đầu tiên cho định vị local Atlassian; C3 và D mở rộng sau khi luồng này dùng được trọn vẹn. B1 bảo vệ nội dung trong suốt luồng. A3/A4 và B2/B3 tiếp tục là điều kiện release theo phạm vi liên quan.

## 5. Tiêu chí hoàn tất và bằng chứng đánh giá

- Với thay đổi implementation: regression tái hiện vấn đề trước khi sửa; `npm run typecheck`, `npm run build`, `npm test` theo thứ tự. UI thêm `npm run test:e2e` và thao tác browser thực tế theo verification skill.
- Storage/format/public command changes phải cập nhật Architecture/File Format/CLI tương ứng. Backup, lock, ETag, project isolation và source-path protection giữ nguyên.
- Chưa tạo task trong LocalAtlas. Khi triển khai kế hoạch thành task, phải chọn workspace/project đích và dùng CLI theo task skill; không viết tay task Markdown.
- Baseline tại checkout ngày đánh giá: typecheck PASS, build PASS, Node tests **49/49 PASS**, không skip. Runtime thực tế Node **v26.5.0**, nên kết quả này chưa thay thế kiểm tra Node 24/22 được hỗ trợ.
- Build có cảnh báo bundle lớn: `public/app.js` khoảng 716 kB trước gzip. Chưa đo hiệu năng browser để kết luận ảnh hưởng thực tế.
- `npm run test:e2e`: **2/2 PASS** trên browser với fixture cô lập; case terminal dùng stub nên chưa chứng minh Codex thật hoạt động. `git diff --check`: PASS. Chưa thao tác browser thủ công hoặc kiểm tra desktop install/Codex thật.

## Nhật ký checkpoint triển khai

| Checkpoint | Kết quả | Bằng chứng |
| --- | --- | --- |
| A1 · Board cancelled và ngày đích milestone | Hoàn tất, commit `f665f19` | typecheck/build PASS; `npm test` 49/49; `npm run test:e2e` 2/2; ngày đích sai định dạng bị từ chối |
| A2 · Browser E2E trong CI | Hoàn tất, commit `9df24c1` | workflow thêm Chromium job trên Ubuntu và tải trace khi fail; local E2E 2/2 PASS |
| A3 · Runtime và giới hạn terminal theo platform | Hoàn tất, commit `67276af` | Node minimum nâng lên 22.13; POSIX PTY báo lỗi rõ trên platform ngoài macOS/Linux; typecheck/build và `npm test` 50/50 PASS; `cargo check --locked` PASS. Chưa chạy CI matrix trên Node 22/24 hoặc Windows |
| A4 · Tài liệu, Vision và đường agent | Hoàn tất, commit kế tiếp | `rg` xác nhận không có UI import `useCodexStore`; PTY project-scoped là luồng agent được tài liệu hóa. Các route chat HTTP còn lại chỉ có server/test consumer nội bộ và được ghi là API nội bộ chưa cam kết. Vision, File Format và Roadmap đã được đồng bộ. |
| B1 · Phục hồi draft và xử lý xung đột tài liệu | Hoàn tất | Draft lưu browser và project-managed `.localatlas/drafts`, không vào index; khi conflict hiển thị nội dung trên đĩa và yêu cầu retry theo ETag hiện hành. typecheck/build PASS; `npm test` 53/53; `npm run test:e2e` 2/2; Node v26.5.0. |
| B2 · Backup/recovery trong Portfolio | Hoàn tất | UI tạo backup và verify manifest/checksum; preflight restore hiển thị project/docs, trạng thái target và yêu cầu `--force`. Restore giữ nguyên semantics offline và hướng dẫn dừng server + CLI. typecheck/build PASS; `npm test` 53/53; `npm run test:e2e` 2/2; Node v26.5.0. |
| B3 · Desktop release smoke | Smoke cục bộ PASS; release gate còn mở | macOS arm64 `.app`/`.dmg` build và launch copy tạm PASS; đóng/mở app tạo backend port mới; Codex thật xử lý task-scoped context và cập nhật `B3-001` theo ETag; UI hiển thị Done; backup → restore → reindex → đọc task PASS, source Git clean. Chưa xác minh clean-machine install, Developer ID/notarization, nâng cấp từ bản cũ hoặc resume hội thoại Codex; strict codesign verification lỗi. Xem `docs/RELEASE_SMOKE.md`. |
| C1 · Dependency có thể quản lý và kiểm tra | Hoàn tất | Task records/API expose dependencies; CLI tạo task và propose/clear; UI chọn task cùng project, review rồi xác nhận thay đổi. Core từ chối missing/cross-project/self/cycle, xác thực lại cycle sau preview, giữ ETag precondition; health báo missing refs/cycle legacy; done/cancelled được xử lý như resolved. `npm run typecheck`, `npm run build`, `npm test` 53/53, `npm run test:e2e` 2/2 PASS trên Node v26.5.0. Browser test xác nhận proposal UI và cancelled predecessor không còn hiện là blocker. |
| C2 · Task detail và milestone editor | Hoàn tất | Task details tải Markdown, proposal cập nhật title/body/checklist/priority/epic/milestone/status/dependency và chỉ đóng sau confirm thành công; unresolved legacy dependency được giữ khi sửa trường khác. Epic/milestone có form tạo/sửa, lựa chọn liên kết từ records thật và ETag; unknown frontmatter/body được giữ, target date được validate. `npm run typecheck`, `npm run build`, `npm test` 53/53, `npm run test:e2e` 2/2 PASS trên Node v26.5.0; browser flow tạo/sửa epic/milestone rồi tạo task liên kết thành công. |
| C3 · Saved views và task sẵn sàng | Hoàn tất | Bộ lọc/sort được lưu theo project trong localStorage, áp dụng/xóa được; đổi project reset filters và nạp đúng saved views. Ready-to-start chỉ nhận todo với dependency cùng project đã done/cancelled hoặc không có; missing/unfinished bị loại và giải thích, ưu tiên xếp trước; không tự claim/chạy. E2E browser xác nhận save, reset, apply và storage snapshot; test unit bao phủ project isolation, priority, missing, unfinished, done/cancelled. `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e` và `git diff --check` PASS trên Node v26.5.0. |
| D1 · Portfolio tổng hợp và đo hiệu năng | Hoàn tất | Portfolio summary dùng một document-path snapshot/project, giới hạn 4 worker (tối đa 8), giữ summary các project khỏe khi project khác lỗi và gắn freshness/errors theo project. Metrics trả thời gian, project lỗi, concurrency, listing/reconcile, Git command counts. Health analysis không reconcile lặp khi kiểm tra backlinks từng orphan; reconcile kiểm tra stat/read theo batch 16. `npm run benchmark:portfolio`: median 10 project **423→147 ms**, 50 project **1.989→622 ms**, 1 project/1.000 docs **817→496 ms**; Git commands không đổi, document listings giảm 3×N→N. Test kiểm chứng giới hạn concurrency, số lượt đọc/reconcile, freshness và partial failure. Bundle 740.48 kB/201.14 kB gzip; chưa có bằng chứng browser đủ để lazy-load terminal. Xem [performance benchmark](PERFORMANCE_BENCHMARKS.md). |
| D2 · Attention inbox có evidence và deep link | Hoàn tất | Inbox tải theo yêu cầu, gộp task blocked/critical, proposal pending, paused session cần resume và broken link; mỗi item lưu project, source path, evidence và thời điểm. Click mở đúng Atlas Markdown trong project. Orphan note chỉ là thông tin riêng; health score có mô tả heuristic/giới hạn. Filter active/paused/archived/all rõ ràng, không tự sửa dữ liệu. Core/API test xác nhận categories, project pause, score/orphan distinction; browser E2E tạo broken link, lọc project paused rồi mở đúng source doc. `npm run typecheck`, `npm run build`, `npm test` và `npm run test:e2e` PASS trên Node v26.5.0. |
| D3 · Traceability Git có phạm vi và phân biệt evidence | Hoàn tất | Core/API cho phép chọn lịch sử 1–3650 ngày, 1–200 commit và chỉ rõ HEAD, số commit đã quét, truncation; UI phân biệt task ID trong subject với HEAD lúc session bắt đầu và giữ caveat không chứng minh hoàn tất. Timeout, thiếu Git hoặc giới hạn output trả unavailable thay vì làm hỏng workspace. Core test tạo commit task-ID riêng, session HEAD riêng, task cũ trong lịch sử sâu và kiểm tra cap; PATH rỗng vẫn cho workspace traceability hoạt động. Browser E2E tìm lịch sử và xác nhận loại evidence. `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e`, `git diff --check` PASS trên Node v26.5.0. |
