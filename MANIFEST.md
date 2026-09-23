# Attendance Web V1 — Cloudflare Migration Manifest

## Runtime

- `src/index.mjs` — Cloudflare Worker API, auth, signed sessions, D1 access
- `wrangler.jsonc` — Worker / static assets / D1 binding configuration
- `package.json` — Wrangler dev/test/migration/deploy scripts

## Database

- `migrations/0001_initial.sql` — deterministic D1 attendance schema

## Existing frontend preserved

- `web/index.html`
- `web/styles.css`
- `web/app.js`
- `web/report.js`
- `web/manifest.webmanifest`
- `web/sw.js`
- `web/icon.svg`
- `web/_headers` — new Cloudflare static-asset security headers

## Secrets / local config examples

- `.dev.vars.example`
- `.env.example`
- `.gitignore`

No real secret value is included.

## Tests

- `tests/worker.test.mjs`
- `tests/config.test.mjs`
- `tests/helpers/d1-mock.mjs`
- `tests/test_report_format.cjs`
- `tests/test_frontend_smoke.py`
- `tests/mobile_preview.png`

## Documentation

- `README.md`
- `TEST_REPORT.md`
- `MANIFEST.md`

## Removed obsolete production infrastructure

- `server.py` — replaced by Cloudflare Worker
- `data/` local SQLite production directory — replaced by Cloudflare D1
- `tests/test_app.py` — Python-server-specific integration test replaced by Worker/D1 integration tests
