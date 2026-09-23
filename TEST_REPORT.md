# Attendance Web V1 — Test Report

Executed on 2026-09-23 in the build environment.

## PASS — Backend integration (`python -m unittest -v tests.test_app`)

- Unauthorized API access returns HTTP 401.
- Clock In creates today's record.
- Duplicate Clock In returns HTTP 409 and does not silently overwrite.
- Clock Out updates today's record.
- Duplicate Clock Out returns HTTP 409 and does not silently overwrite.
- A second authenticated HTTP client reads the same server-persisted SQLite data.
- Manual edit works.
- Date-range filtering works.
- Delete works.
- Invalid date/time input returns HTTP 400 and the server continues responding.

Result: 4 tests, PASS.

## PASS — Report formatter (`node tests/test_report_format.js`)

Verified exact output contract:

```text
23/9/69 เข้า 11:03น.
23/9/69 ออก 21:18น.

24/9/69 เข้า 11:00น.
24/9/69 ออก 21:22น.
```

Result: PASS.

## PASS — Frontend Chromium smoke (`python tests/test_frontend_smoke.py`)

The real HTML/CSS/JavaScript frontend was executed in headless Chromium with the network layer mocked because the build environment blocks Chromium navigation to localhost.

Verified:

- Thai UI text renders.
- 390×844 mobile viewport has no horizontal overflow.
- Clock In/Out hero buttons render at 100px height.
- Copy Report touch target renders at 48px height.
- Clock In UI updates.
- Duplicate Clock In opens confirmation modal.
- Clock Out UI updates to COMPLETED.
- Copy Report writes the exact Thai report text.
- Edit UI updates a record.
- Delete UI removes a record and shows empty state.
- No JavaScript page errors were emitted during the smoke flow.

Result: PASS.

## Environment limitation

Direct end-to-end Chromium navigation to the local HTTP server was attempted but blocked by the environment with `ERR_BLOCKED_BY_ADMINISTRATOR`. Backend HTTP behavior and frontend browser behavior were therefore tested separately as described above.
