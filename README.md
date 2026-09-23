# Attendance Web V1 — Cloudflare Workers + D1

Attendance Web V1 migrated from the original Python + local SQLite server to **Cloudflare Workers + Cloudflare D1** while preserving the existing V1 frontend and API behavior.

## Architecture

- **Cloudflare Worker** — API, authentication, signed session cookies
- **Cloudflare D1** — persistent attendance records
- **Workers Static Assets** — serves the existing `web/` frontend/PWA
- **GitHub** — source repository and Cloudflare Git deployment
- **No paid service is required** for normal personal use within Cloudflare Free limits.

The original V1 UI files (`index.html`, `styles.css`, `app.js`, `report.js`, PWA manifest/service worker/icon) were not redesigned or rewritten during this migration.

## Project layout

```text
attendance_web_v1/
├── src/index.mjs                 # Cloudflare Worker API/auth
├── migrations/0001_initial.sql   # deterministic D1 schema
├── web/                          # unchanged V1 frontend + PWA
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── report.js
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── icon.svg
│   └── _headers                  # security headers for static assets
├── tests/
├── wrangler.jsonc
├── package.json
├── .dev.vars.example
├── .env.example
└── .gitignore
```

## D1 schema

```sql
CREATE TABLE IF NOT EXISTS attendance (
  date TEXT PRIMARY KEY NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  updated_at TEXT NOT NULL
);
```

`date` is already the primary-key index, so no redundant second date index is added.

## Required Cloudflare secrets

Create these as **Secret** variables in the Cloudflare Worker dashboard. Never commit their real values.

- `ATTENDANCE_PASSWORD`
- `ATTENDANCE_SECRET`

`ATTENDANCE_SECRET` must be at least 32 characters. The app fails closed with HTTP 503 if required production configuration is missing.

Non-secret settings are already in `wrangler.jsonc`:

- `ATTENDANCE_TIMEZONE=Asia/Bangkok`
- `ATTENDANCE_SESSION_HOURS=168`

## iPhone-first deployment using GitHub + Cloudflare dashboard

### A. Put the project in GitHub

1. Download and extract the delivered ZIP in the iPhone **Files** app.
2. In Safari, sign in to GitHub and create a new **private** repository, for example `attendance-web-v1`.
3. Upload the contents of the extracted `attendance_web_v1` folder into the repository. Keep the folder structure exactly as delivered (`src`, `migrations`, `web`, `tests`).
4. Do **not** upload `.dev.vars` or any file containing real passwords/secrets. The included `.gitignore` blocks the normal secret filenames.

> GitHub's mobile upload UI can be awkward with folders. If Safari does not let you select folders directly, create the four folders in the repository first and upload their contained files into the matching folder. Do not flatten the project structure.

### B. Create the free D1 database

1. Open the Cloudflare dashboard.
2. Go to **D1 SQL Database**.
3. Tap **Create Database**.
4. Database name: `attendance-web-v1`.
5. Location: Asia-Pacific is appropriate for Thailand if the dashboard offers a location hint; it is optional.
6. Create the database.
7. Copy the database **ID / UUID** shown by Cloudflare.

### C. Put the D1 ID into GitHub

1. In the GitHub repository, open `wrangler.jsonc`.
2. Tap edit.
3. Replace only:

```text
PASTE_D1_DATABASE_ID_HERE
```

with the D1 database ID copied from Cloudflare.
4. Commit the change to the main branch.

The binding name must remain `DB` because the Worker code and migration command use that binding.

### D. Import the GitHub repository into Cloudflare Workers

1. Cloudflare dashboard → **Workers & Pages**.
2. Tap **Create application**.
3. Choose **Import a repository** / connect GitHub.
4. Select the `attendance-web-v1` repository.
5. Root directory: repository root.
6. Build command: leave blank.
7. Deploy command: `npm run deploy`.
8. Save and deploy.

`npm run deploy` first runs the D1 migration against the `DB` binding and then runs `wrangler deploy`. Re-running it is safe: Wrangler records applied D1 migrations and only applies unapplied files.

### E. Add the two secrets

After the Worker exists:

1. Cloudflare dashboard → **Workers & Pages** → your Worker → **Settings**.
2. Under **Variables and Secrets**, tap **Add**.
3. Choose type **Secret**.
4. Add `ATTENDANCE_PASSWORD` with your private login password.
5. Add `ATTENDANCE_SECRET` with a privately generated random value of at least 32 characters.
6. Tap **Deploy** to apply the secret bindings.

Do not put either value into `wrangler.jsonc`, GitHub, README, screenshots, or chat messages.

### F. Open and verify

1. Open the Worker's `workers.dev` URL shown in Cloudflare.
2. Confirm the login page appears.
3. Log in with your `ATTENDANCE_PASSWORD`.
4. Test Clock In, refresh, Clock Out, edit/delete, range filter, and Copy Report.
5. On iPhone Safari, use **Share → Add to Home Screen** if you want the existing PWA experience.

### G. Future updates

Push/commit a change to the connected GitHub branch. Cloudflare Workers Builds can automatically build/deploy connected repositories. Keep the deployment command as `npm run deploy` so any future D1 migration is applied before Worker deployment.

## Local development (optional, computer)

Install dependencies:

```bash
npm install
```

Copy `.dev.vars.example` to `.dev.vars` and put local-only secret values there. Never commit `.dev.vars`.

Apply migrations and start local Worker/D1:

```bash
npm run db:migrate:local
npm run dev
```

Run deterministic Node tests:

```bash
npm test
```

## Data from the old SQLite deployment

The supplied V1 ZIP did not contain a populated `attendance.db`, so there were no historical rows available to import into D1 during this migration. The D1 schema preserves the V1 fields and API behavior. If an old production SQLite database exists elsewhere, keep it until its records are exported/imported and verified.

## Free-tier design notes

- Static frontend files are served by **Workers Static Assets** and do not invoke the Worker for normal matching asset requests.
- `assets.run_worker_first` is limited to `/api/*`, so only API traffic consumes Worker invocations.
- Attendance is a tiny table keyed by `date`, keeping D1 row reads/writes very low for personal use.
- No Containers, Durable Objects, R2, Queue, external database, VPS, or paid add-on is used.

## Security notes

- Signed HttpOnly + Secure + SameSite=Strict session cookie.
- Password and signing secret are Worker secrets, not source variables.
- API responses and static assets include security headers.
- Duplicate Clock In/Out returns `409 already_exists`; replacement occurs only after the existing V1 confirmation flow sends `replace: true`.
- Manual correction and delete remain available.
