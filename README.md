# hl-radar

A one-page, read-only Hyperliquid funding and open-interest dashboard. The deployable site is **`dist/`**; the site name, package name, favicon and document title identify **hl-radar**. Built with React, TypeScript and Vite. No backend, credentials, wallet connection, analytics, or remote runtime assets.

## Install, develop and preview

Use Node.js **22.12+** and npm (validated with Node 22.22.1 / npm 9.2.0).

```sh
npm ci
npm run dev
```

The finished export can be previewed without rebuilding:

```sh
npm run preview -- --port 4173
```

Open the URL printed by Vite. Use HTTP(S), not `file://`, for module loading. An internet connection is needed for live market data; static assets load independently and API failures have a retry state.

## Rebuild and check

```sh
npm run typecheck
npm test
npm run build
npm run preview -- --port 4173
```

`npm test` compiles the independent data/API modules into an automatically cleaned OS temporary directory and runs 19 Node tests. Production output is regenerated in `dist/`. Vite’s `base: './'` keeps asset URLs relative, so the export can be served from a directory such as `/preview/`, an ENS gateway path, or a hosting root. There is only one page and no server-side route rewrites.

A deterministic Playwright interaction function is delivered at [`artifacts/interaction-checks.js`](artifacts/interaction-checks.js). Serve the export at `http://127.0.0.1:4173/preview/` (or adjust that URL) and execute the function with a Playwright `page`, for example through the browser tool’s `browser_run_code_unsafe` `filename` argument. It intercepts only the public API for tests and validates 48 browser assertions. The app itself contains no fixture data.

## Publish

1. Run the checks and rebuild after any source change.
2. Publish the **contents of `dist/`** to your static host; set its site/project name to **hl-radar**. Preserve `assets/`, `favicon.svg`, `licenses.txt`, and `index.html` together.
3. For a subpath, put the entire export in that directory and open its trailing-slash URL. Permit browser requests to `https://api.hyperliquid.xyz/info` if your hosting platform adds a Content Security Policy.
4. Include `dist/` alongside `src/`, `public/`, package manifests/lockfile, configuration and documentation in the submission. The publisher serves the checked-in export and need not build it.

No hosting account or public deployment URL was supplied, so this deliverable is the ready-to-publish static export, not a claimed external deployment. No `.git` or `.github` files were changed. No ignore file was created or changed, so no ignore-path budget is consumed. Dependency directories, caches and archives are absent from the delivered tree; all worker dependency installation and builds ran in `/tmp/hl-radar-build`. Keep generated `node_modules` and caches out of future submissions at every nesting level. Do not exclude `dist/`.

## Data and behavior

All requests are browser `POST`s to the [Hyperliquid public info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint). Market coverage includes active native and builder-deployed (HIP-3) perpetuals: the required bare `metaAndAssetCtxs` request supplies native markets; `perpDexs` discovers other DEXs, each queried with `metaAndAssetCtxs` plus `dex`. Delisted assets are excluded. DEX discovery is cached for five minutes; at most four market requests run concurrently.

- Refreshes every 30 seconds, plus manual refresh. Requests time out after 12 seconds. A failed DEX/discovery request rejects that complete refresh: previous successful data stays visible, labeled stale, rather than silently reducing totals. No sample prices replace API failures.
- Hourly funding is a decimal rate. APR = hourly rate × 24 × 365 × 100%. This is simple annualization, not compounding or a prediction. Positive = longs pay shorts; negative = shorts pay longs.
- Open interest USD = `openInterest × markPx`. 24h change = `(markPx / prevDayPx − 1) × 100%`. Volume uses `dayNtlVlm`; premium = `premium × 100%`. Invalid/missing fields show `—`; totals sum available values.
- Summary totals and top/bottom-five funding ranks use the entire active universe before filtering. Ties use alphabetical coin order. Default filters: minimum $1M volume, all funding; initial sort is funding APR descending. Clear filters removes the minimum volume too. Every column is sortable; 20 results appear per page. The mobile card view has equivalent fields and sort controls.
- Funding and hourly closing-price histories request the last seven days on detail open or retry. The available funding observations are averaged arithmetically. Missing or shorter histories are permitted; one failed chart does not hide the other. Times are UTC. The last hourly candle can still be forming. History is a snapshot; current price/APR follow the 30-second market refresh while the panel stays open.
- Theme follows the system initially, with dark as the fallback. The theme button cycles System → Dark → Light → System; explicit choices persist locally. No market data or wallet information is stored.

API definitions are documented in Hyperliquid’s [perpetual info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals). With the ten builder DEXs observed during validation, a refresh makes eleven market requests, approximately 440 weighted requests/minute at the 30-second cadence, plus discovery/history. Hyperliquid documents a [1,200 weight/minute IP limit](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits); concurrent tabs or shared-IP clients can encounter rate limits. The dashboard reports them and offers retry.

## Actual verification

Completed 2026-10-01 against the served production export at `/preview/`:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed, TypeScript 5.9.3 |
| `npm test` | 19 passed, 0 failed |
| `npm run build` | Passed, Vite 7.1.12; relative assets exported |
| Playwright primary interactions | 48 assertions passed, 0 failed |
| Live public API | 330 active markets; BTC and `xyz:XYZ100` each returned 168 funding and 168 candle observations |
| Responsive layout | 1440, 1024, 960, 768, 390 and 320 CSS-pixel widths inspected; no measured page overflow |
| Better Interface review | All six domains reviewed; applicable findings fixed; details and evidence in [`artifacts/validation.md`](artifacts/validation.md) |

Worker equivalent commands used the isolated build directory, for example `npm --prefix /tmp/hl-radar-build run typecheck`, `npm --prefix /tmp/hl-radar-build test`, and `npm --prefix /tmp/hl-radar-build run build`; the complete final source and configuration were copied there and the resulting `dist/` copied back. The first dependency install hit an unwritable default npm cache; rerunning with `--cache /tmp/hl-radar-npm-cache` succeeded. Builds have no dependency on `test/scratch/` or any `/tmp` path.

These are worker checks, not independent certification. Physical devices, Safari/Firefox, actual assistive-technology sessions and browser-native zoom were not tested. See the validation record for automated accessibility results, measured color pairs, screenshots, and further limits. [`DESIGN.md`](DESIGN.md) documents the implemented design system; [`artifacts/NOTICE.md`](artifacts/NOTICE.md) retains reference attribution.

Data: Hyperliquid public API. Not financial advice.
