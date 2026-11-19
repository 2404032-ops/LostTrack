# LostTrack

LostTrack is a responsive campus lost-and-found and environmental issue management prototype based on the supplied proposal and pitch deck. Local development uses a JSON file; the free hosted setup uses Supabase for persistent application data and private image storage, and Brevo's HTTPS API for transactional email. Android and push notifications remain future work.

## Run locally on Windows

Install Node.js 24.22.1 (recommended) or another supported Node.js 20–26 release and npm, then open PowerShell in the project folder. For example:

Before the first start, create `.env` from the example and enter the initial administrator details as described in [First administrator setup](#first-administrator-setup). Keep `.env` private.

```powershell
Set-Location "D:\All Project Proposal Idea\LostTract_Project"
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm ci
npm start
```

In Notepad, set the bootstrap email and password before the first run. For local email delivery, configure either the SMTP fields or Brevo's API key and verified sender.
`LOSTTRACK_REPORT_RETENTION_DAYS` controls how long closed reports and their related data are kept (default: 30 days; allowed values: 1–3650).

Keep that PowerShell window open while using the app, then open **http://localhost:3000** in your browser. To stop the server, return to PowerShell and press **Ctrl+C**. If port 3000 is already in use, choose another port before starting the server:

```powershell
$env:PORT = "3001"
npm start
```

Then open **http://localhost:3001**. The server listens only on `127.0.0.1` by default; set `HOST` explicitly only when you intend to expose it on a trusted network.

Local email verification and password-reset links point to `http://localhost:<PORT>` and work only while the local server is running on the same computer. `localhost` will not work from a phone or another computer. After deployment, Render uses its public service URL automatically; if you use a custom domain, set `APP_BASE_URL` to that HTTPS URL. Do not set `APP_BASE_URL` to localhost in Render.

To check the code or run the automated tests, open another PowerShell window in the project folder and run:

```powershell
npm run check
npm test
```

`npm test` launches an isolated temporary API/database and removes its test data afterwards. It does not change `backend/storage/db.json`.

## Deploy a free live demo with GitHub and Render

GitHub stores the source code; it does not run this Node.js API. GitHub Pages alone cannot run LostTrack sign-in, reports, claims, uploads, or email verification. The included [`render.yaml`](./render.yaml) provisions a Render Free web service; Supabase stores normalized PostgreSQL records and private uploads, so Render's temporary filesystem is not used for user data.

This is a free-tier prototype, not a production service. Render Free services sleep after inactivity, Supabase Free projects may pause after a week without activity, and the free quotas/availability can change. Although the hosted data is normalized, the app still reads and writes a full relational snapshot and is intended for one app instance; Supabase Free has no automatic database backups. Do not use real identity documents or sensitive personal data.

1. Create a free Supabase project. In its **SQL Editor**, run [`backend/migrations/002-normalized-relational-schema.sql`](./backend/migrations/002-normalized-relational-schema.sql). It creates the normalized schema and RPCs used by the app; if the earlier JSONB migration has data, this migration imports that state before removing the old table. Find the project URL and `service_role` key in the Supabase API settings. Keep the key secret; never paste it into chat or commit it. The app creates a private `losttrack-uploads` bucket on first startup.
2. Create a Brevo account, verify a sender email in its sender settings, and create an API key. Brevo is accessed over HTTPS, which works on Render Free; email delivery still depends on the sender being verified and the provider account being approved.
3. Push the updated source to the existing public GitHub repository. Do not add `.env`, `backend/storage/db.json`, or uploaded photos; `.gitignore` excludes them. GitHub Actions runs syntax checks and the backend tests.
4. In Render, choose **New → Blueprint**, connect GitHub, and select `iftiurhossen11/LostTrack`. Review the Blueprint: the web service plan should say **Free**, with no disk. Apply it and enter `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `LOSTTRACK_INITIAL_ADMIN_EMAIL`, and a strong `LOSTTRACK_INITIAL_ADMIN_PASSWORD` directly in Render's secure environment form. Do not send these values to anyone.
5. Wait for the service to become **Live**, open its `onrender.com` URL, and verify `/api/health`. Render supplies the public URL for verification and password-reset links. Test registration, email verification, report creation, image upload, and sign-in with the initial Main Admin account.
6. After confirming admin sign-in, remove `LOSTTRACK_INITIAL_ADMIN_EMAIL` and `LOSTTRACK_INITIAL_ADMIN_PASSWORD` from the Render environment and redeploy; the created account remains in Supabase. Future pushes to the linked branch can trigger deployment automatically.

## First administrator setup

Public registration cannot create an administrator. To initialize a new, empty database, set `LOSTTRACK_INITIAL_ADMIN_EMAIL` to the administrator's `@uftb.ac.bd` address and `LOSTTRACK_INITIAL_ADMIN_PASSWORD` to a strong password in the local `.env` file before the first start. You can optionally change `LOSTTRACK_INITIAL_ADMIN_NAME`. The password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.

On startup, LostTrack creates this verified Main Admin only if the database has no active administrator. The password is stored as a salted hash. After seeing the startup message that confirms provisioning, remove the bootstrap email and password from `.env`; later starts will not recreate or change the administrator. Keep `.env` private and backed up securely.

## Project layout

```text
frontend/pages/index.html
frontend/assets/css/styles.css
frontend/assets/js/app.js
frontend/assets/js/language.js
frontend/assets/data/bangladesh-boundary.json
frontend/assets/vendor/leaflet/
frontend/assets/images/logo-transparent.png
frontend/assets/images/logo-mark.png
backend/src/server.js
backend/migrations/001-create-supabase-state.sql
backend/migrations/002-normalized-relational-schema.sql
backend/test/server.test.js
backend/storage/db.json
backend/storage/uploads/
```

## Proposal features implemented

- Student, approved Staff, and Main Admin role-based navigation and server-side authorization, with role-specific dashboards: students see their reports, claim statuses and next steps; Staff see assigned task progress; administrators can open user and staff lists and click each dashboard metric to inspect the corresponding reports, issues, upvotes, claims, or overdue items.
- Full report CRUD: authorized campus accounts can create and read reports, owners can edit their own open reports, and Main Admins can permanently delete a report and its related claims, clues, tasks, history, and attached images.
- Lost, found, and environmental reports; owner editing; category, colour, date, and location search.
- Searchable report locations for lost items, found items, and campus issues. Suggestions include Hightech, Hightech Railway Station, Latifpur, and locations already used on campus reports; users can also enter another place. The separate, user-triggered OpenStreetMap Nominatim search is restricted to Bangladesh, and place names are displayed in English when available. Selecting a result fills the location and map pin. Queries are not sent until Search is pressed; they are proxied by the LostTrack server, cached for a day, and limited to at most one uncached provider request per second. Search requires internet and Nominatim data may not list every place. The map displays tiles only inside the Bangladesh boundary and lets users select only points inside that boundary; the server applies the same boundary check to saved report coordinates. Map controls, search UI, and Esri World Street Map labels are in English.
- Report map pins are optional and visible to signed-in campus users. The map uses the included Bangladesh boundary data to mask surrounding areas and Esri World Street Map tiles; the map does not send report details to the tile provider. Location search queries are sent to the configured OpenStreetMap Nominatim search service; do not search personal or confidential information. Required Esri, OpenStreetMap, and data-provider attribution is shown on the map.
- Up to three JPG/PNG/WebP uploads per report, max 2 MB each, with local previews and a clear/remove action. Server-side file-signature checks reject renamed non-image files; this is not full image decoding. Photos are stored under `backend/storage/uploads/`.
- Lost/found suggestions use the proposal's 100-point category, colour, location, date, and English/Bangla description-keyword score; only scores of 50 or more are shown, with numeric factor breakdowns and the top three suggestions. Location scores 20 for the same place and 10 for different places in the same campus area; different campus IDs score 0. The campus-area grouping follows the user's clarification that campus buildings are near Hightech, Hightech Railway Station, and Latifpur. Reports without a campus ID default to UFTB's main campus.
- One server-enforced vote per signed-in Student or Staff account for each open environmental issue; repeat attempts return HTTP 409.
- 14-day duplicate detection shows matching open issues with an "Upvote this instead" action, flags reports submitted anyway, and supports administrator merge.
- Priority score based on severity, unique votes, safety risk, and age; high-severity safety risks have the proposal's High-priority floor. Overrides require a reason and enter server-written history.
- Overdue marking for unresolved High-priority issues older than seven days.
- Private claim details are sent directly to the claim API and are not returned in Student/Staff state or saved in their browser cache. Claims require verified university email and separate consent; users get up to three attempts, with one more attempt available only after an administrator reopens the latest rejected claim. Claimants can provide additional details when an administrator requests them without using another attempt. Claimant trust level is advisory; feedback is generic; administrators record decisions and in-app notifications. Only one claimant can be approved per found item; once approved, the item accepts no further claims and cannot be approved again. Approval is blocked once the item is no longer available. Returning an item requires an approved claim and an administrator-confirmed in-person identity check; the check is recorded in report history without storing ID details.
- Registration requires consent to the displayed privacy notice and sends a time-limited university-email verification link. Only server-verified `@uftb.ac.bd` accounts can contribute; the verification token is stored as a hash and can be resent by the signed-in user.
- Verified Students and approved Staff can create and edit reports, upload images, upvote issues, and submit eligible ownership claims. Verified Staff can also advance only their own assigned maintenance tasks from Assigned to In progress to Completed. Administrators assign work to active Staff and verify/resolve reports.
- Server-generated status history, scoped notifications, campus IDs on new records, Bangla/English label toggle, offline report drafts, and automatic retry of queued reports when the connection returns. Queued reports are marked "Pending sync"; images cannot be uploaded offline and must be selected again if the form is reloaded. JSON export is also available.
- Light and dark display modes are available from the language/theme controls on both sign-in and signed-in screens; the selected mode is saved on the current device.
- Closed, returned, or merged reports and their uploaded images are removed after the configured `LOSTTRACK_REPORT_RETENTION_DAYS` period (30 days by default). Open reports remain until resolved.

## Authentication and privacy notes

- Public registration accepts only `@uftb.ac.bd` addresses; Student accounts activate immediately and Staff accounts require administrator approval. Public Main Admin registration is disabled.
- Passwords use salted scrypt hashes. Session tokens expire after eight hours. Password reset invalidates existing sessions.
- University email domain syntax is checked at registration, and mailbox ownership is verified through a 24-hour, one-time email link before a Student or Staff account can submit or edit reports, upload images, vote, update assigned tasks, or claim an item. Existing accounts must verify before contributing.
- Password-reset tokens are never returned by the API. Reset emails require SMTP or Brevo configuration. Without email delivery, the API returns a configuration error instead of exposing a reset token.
- Local Gmail SMTP reads settings from `.env` (copy `.env.example` to `.env`) or from the process environment. Never commit `.env` or share its App Password:

```powershell
Copy-Item .env.example .env
```

- In Google Account settings, enable 2-Step Verification and generate an App Password. Put your Gmail address in `SMTP_USER` and `SMTP_FROM`, and the generated App Password in `SMTP_PASS`. Do not use your regular Google password. Restart the server after editing `.env`.
- Gmail SMTP delivery and the email verification/reset flows require the account's App Password to be created by its owner.
- Hosted email uses Brevo's HTTPS API. Configure `BREVO_API_KEY` and a sender email that is verified in Brevo; keep the API key only in the provider's environment settings. If Render logs show HTTP 401, replace the revoked or incorrect key in Render with a newly generated Brevo API key, then redeploy.

- User-facing report data does not contain private clues or other claimants' details. Staff does not receive other users' claim details or maintenance tasks assigned to other staff. Report attachments can be viewed by anyone who knows an image URL; never upload faces, identity documents, receipts, or personal contact details.
- Signing out clears this device's cached account data and saved report draft. If a report has not synced yet, the app asks before removing it. Saved drafts are associated with the signed-in account and are not restored for a different account.
- Local mode uses a JSON file with atomic file replacement. Hosted mode stores accounts, reports, votes, claims, private clues, notifications, tasks, history, and password resets in normalized PostgreSQL tables, with a private Storage bucket for images. The server-only service role calls transactional RPCs to preserve the app's existing state contract; this prototype still rewrites the relational snapshot on each change and is intended for a single instance, not production-scale concurrency. Row-level security is enabled and direct anon/authenticated table access is revoked. Back up or export data before changes; free tiers do not guarantee backups, uptime, or email delivery.
- The automated suite covers server-side behavior; the offline retry flow was also exercised in a browser with a simulated network failure. The planned 5-8 person usability study and 30-pair match-precision evaluation still require real participants and a recorded sample set; no such results are claimed.

## API overview

- `GET /api/health`
- Student and Staff contribution endpoints require verified university email. `POST /api/claims` also requires explicit claim consent; claim details are omitted from Student/Staff `/api/state` responses and retained only for administrator review.
- `POST /api/admin/claims/reopen` (Main Admin only)
- `POST /api/vote` requires a Bearer token and allows one vote per student per open issue.
- `POST /api/login`, `POST /api/register`, `POST /api/forgot-password`, `POST /api/reset-password`
- `GET /api/state`, `POST /api/state` (Bearer session required; writes are role-filtered and server-validated)
- `POST /api/uploads` (Bearer session required)
- `GET /api/admin/accounts`, `POST /api/admin/accounts/approve` (Main Admin only)
