# LocalAtlas performance benchmarks

## Portfolio summary (2026-10-25)

Measured on macOS 26.6.2, arm64, Node.js v26.5.0 using `npm run benchmark:portfolio`. The script makes temporary source folders and an isolated sibling `LOCALATLAS_HOME`, seeds generic Markdown pages, warms the request once, then reports the median of three summary requests. The 1,000-document fixture is indexed before timing. These numbers include local filesystem and SQLite work, plus Git status checks against empty non-Git source folders. They exclude fixture creation and UI rendering.

| Fixture | Before: median | After: median | Change | Git commands/request | Document tree listings/request | Index reconciliations/request |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 projects | 423 ms | 147 ms | −65% | 10 → 10 | 30 → 10 | 10 → 10 |
| 50 projects | 1,989 ms | 622 ms | −69% | 50 → 50 | 150 → 50 | 50 → 50 |
| 1 project, 1,000 docs | 817 ms | 496 ms | −39% | 1 → 1 | 3 → 1 | 1 → 1 |

Each measurement used three samples. Before values were `[1054, 423, 401]`, `[2348, 1989, 1956]`, and `[794, 817, 857]` ms; after values were `[367, 147, 145]`, `[863, 622, 599]`, and `[496, 486, 499]` ms. The first request includes cold initialization; medians are reported to reduce that effect. Treat these as local comparative baselines, not cross-machine latency budgets.

The summary now shares one document-path snapshot between task reconciliation, pending-proposal listing, and active-session listing. It processes projects with a four-worker default (configurable up to eight), reports per-project fresh/stale status and errors, and exposes request metrics. Reconciliation checks document stats and reads changed files in batches of 16. Health analysis likewise reuses its document snapshot and queries backlinks from the already reconciled index rather than reconciling once per orphan document.

## UI bundle decision

The production build emitted `public/app.js` at 740.48 kB (201.14 kB gzip) and `public/assets/react-vendor.js` at 223.87 kB (69.69 kB gzip). Vite warns on the uncompressed app chunk size. Since LocalAtlas runs locally and this measurement does not establish a user-visible load bottleneck, D1 keeps terminal panels eager; collect browser navigation and interaction timings before adding route-level lazy loading.

## Current bundle after portfolio inbox and Git history UI (2026-10-25)

The production build after D2/D3 emitted `public/app.js` at 748.45 kB (203.40 kB gzip), `public/app.css` at 498.71 kB (53.40 kB gzip), and `public/assets/react-vendor.js` at 223.87 kB (69.69 kB gzip). This updates the bundle observation only; the portfolio timings above remain the D1 benchmark measurements. Vite still reports the app chunk over its 500 kB advisory threshold. No browser timing regression has been established.

## Browser load and interaction baseline (2026-10-26)

Measured on macOS arm64, Node.js v26.5.0, Chromium via Playwright, using `npm run benchmark:ui`. The script creates a disposable source repository and `LOCALATLAS_HOME`, imports one project, seeds one task and one linked document, then measures three fresh browser contexts. Values are per-action wall-clock times from Playwright waits; they include local server work and are not cross-machine budgets.

| Action | Median |
| --- | ---: |
| Portfolio ready (`page.goto` to first project card) | 419 ms |
| Project overview ready after click | 106 ms |
| Tasks board ready after click | 262 ms |
| Task details with linked documents ready | 84 ms |
| Navigation `DOMContentLoaded` | 68 ms |

The same run loaded `app.js` at 752,201 bytes decoded, `app.css` at 498,936 bytes, and `react-vendor.js` at 223,865 bytes.

Decision: keep terminal and other panels eager for now. The local interaction costs are well below a user-visible delay, and the new linked-documents panel adds no measurable bottleneck. Revisit code-splitting only if a future measurement or a slower machine shows a regression; do not split speculatively.

## Bundle after linked documents and backlink grouping (2026-10-26)

The production build emitted `public/app.js` at 751.79 kB (204.00 kB gzip), `public/app.css` at 498.88 kB (53.45 kB gzip), and `public/assets/react-vendor.js` at 223.87 kB (69.69 kB gzip). Vite still warns on the app chunk size; the browser baseline above does not show a user-visible bottleneck.

## Current bundle after task link picker and unlink (2026-10-27)

The production build emits `public/app.js` at 755.34 kB (205.13 kB gzip), `public/app.css` at 499.11 kB (53.49 kB gzip), and `public/assets/react-vendor.js` at 223.87 kB (69.69 kB gzip). The link picker and removal controls add about 3.5 kB to the app chunk; the existing bundle decision is unchanged.
