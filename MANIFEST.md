# Attendance Web V1 — Package Manifest

## Runtime
- `server.py` — standard-library HTTP server, signed session auth, SQLite API
- `web/index.html` — mobile-first UI
- `web/styles.css` — futuristic dark/glass visual system and responsive layout
- `web/app.js` — attendance UI behavior and API integration
- `web/report.js` — Thai LINE report formatter
- `web/manifest.webmanifest` — PWA metadata
- `web/sw.js` — static asset service worker
- `web/icon.svg` — app icon

## Configuration / docs
- `.env.example` — environment variable template (contains no real credentials)
- `.gitignore` — excludes local secrets/database/cache
- `README.md` — setup, deployment, backup, and test instructions
- `TEST_REPORT.md` — checks actually executed for this delivery

## Tests
- `tests/test_app.py` — backend HTTP/SQLite integration tests
- `tests/test_report_format.js` — exact LINE copy-format test
- `tests/test_frontend_smoke.py` — real Chromium frontend smoke test with mocked HTTP layer
- `tests/mobile_preview.png` — 390px-wide rendered mobile test capture

## Data
- `data/.gitkeep` — database directory placeholder
- No live database is included.
- No real password, secret, API key, or credential is included.
