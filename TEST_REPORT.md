# Attendance Web V1 — Cloudflare Migration Test Report

Date: 2026-09-23

## Executed

### Worker/D1 compatibility tests

Command:

```bash
node --test tests/*.test.mjs
```

Result: **PASS — 8/8 tests**

Verified:

- D1-compatible migration schema and required columns
- unauthorized API access blocked
- invalid login rejected
- valid login creates Secure / HttpOnly / SameSite=Strict session
- authenticated session recognized
- Clock In creates attendance row
- duplicate Clock In returns 409 unless explicit replace is sent
- Clock Out updates the row
- duplicate Clock Out returns 409
- persistence across subsequent authenticated requests using the same database
- Today API shape and Asia/Bangkok server timestamp
- manual edit
- history retrieval
- date-range filtering
- delete
- invalid action / invalid date range / invalid record handling
- missing secrets fail closed
- Wrangler config does not commit secret values
- no paid-only service binding introduced

The D1 test adapter executes the production SQL against SQLite using Node's built-in `node:sqlite`. Cloudflare D1 uses SQLite's query engine, but these are not remote Cloudflare D1 production tests.

### Thai LINE report formatter

Command:

```bash
node tests/test_report_format.cjs
```

Result: **PASS**

Exact verified output:

```text
23/9/69 เข้า 11:03น.
23/9/69 ออก 21:18น.

24/9/69 เข้า 11:00น.
24/9/69 ออก 21:22น.
```

### Frontend mobile smoke test

Command executed in the build environment:

```bash
python tests/test_frontend_smoke.py
```

Result: **PASS**

Chromium viewport: 390 × 844

- no horizontal overflow (`scrollWidth=390`, `clientWidth=390`)
- Clock In button height 100 px
- Clock Out button height 100 px
- Copy button height 48 px
- Clock In frontend flow
- duplicate confirmation modal
- Clock Out frontend flow
- completed status
- Thai copy report
- edit
- delete
- no frontend page errors in the smoke scenario

### Original UI preservation

SHA-256 comparison against the supplied V1 ZIP: **PASS / UNCHANGED** for:

- `web/index.html`
- `web/styles.css`
- `web/app.js`
- `web/report.js`
- `web/manifest.webmanifest`
- `web/sw.js`
- `web/icon.svg`

Only `web/_headers` was added for Cloudflare static-asset security headers.

## Not executed

- `wrangler dev` with the real Cloudflare runtime: unavailable because Wrangler could not be downloaded in this execution environment.
- remote D1 migration against the Owner's Cloudflare account: not executed because no Owner Cloudflare credentials/database ID were provided.
- production deployment to `workers.dev`: not executed.
- live production login/Clock In/Clock Out on Cloudflare: not executed.

Production deployment must therefore **not** be labeled PASS until the Owner performs the README deployment steps and exercises the deployed URL.
