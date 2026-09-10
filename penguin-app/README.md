# Penguin Maintenance @ Versant Media

Parts and air-filter inventory tracker for the Local 68 crew. Next.js 15 + Supabase, built to run on
phones in the field (works with no service, syncs when it comes back) and on a PC.

This folder is a self-contained app. The rest of the repository is the older Railway portal; nothing
here depends on it except the two data files the import script reads.

## What it does

| Area | Details |
|---|---|
| Sign-in | Username + password (Supabase Auth under the hood). Admins create logins; every new login must change its password on first sign-in. "Forgot password" emails a reset link. **Sessions never time out** — a phone or PC stays signed in until someone taps Sign Out, so long paperwork sessions are never interrupted. Several people (and several devices per person) can be signed in at once. |
| Inventory | Group cards → spreadsheet rows with +/−, tap-to-type qty, inline edit, full edit, delete, low-stock alerts, search, sort. Air-filter groups keep the Unit ID / Units / Per Unit / Total / Stock / Order layout with subtotals. On phones the tables collapse to the columns that matter (Stock and +/− always on screen); the rest shows when a row is tapped. On a PC the full table shows with a sidebar. |
| Photos | Any crew member can attach a photo from the camera. It is resized on the phone (small thumbnail + larger view), stored in Supabase Storage, and tapping the thumbnail pops it up full size. |
| Reports | "Export & Email Report" builds the CSV and emails it with the file attached straight from the phone (Resend). A download button is there too. |
| Real-time | Every phone sees qty changes within a second (Supabase Realtime). |
| Offline | The app opens from cache with no service. Every edit is saved locally and queued; the header shows "Offline · N queued" and the queue uploads by itself when service returns — even after closing the app. Qty changes are stored as +/− deltas so two people editing the same part offline both land correctly. |
| Users | Admin-only. Username auto-generates as first initial + last name, email as firstname.lastname@versantmedia.com. Reset a password, edit, delete. |
| Logs | Admin-only activity log (logins, qty changes, edits, user changes, restores). |
| Backups | A full snapshot is taken **every hour** inside the database (pg_cron). Admins can back up now, download any snapshot as JSON, or restore one (a safety snapshot is taken first, so a restore is itself undoable). |

## 1. Create the Supabase project

1. <https://supabase.com/dashboard> → **New project**. Pick a strong database password and a US-East region.
2. **Project Settings → API**: copy the Project URL, the `anon` key and the `service_role` key.
3. **Authentication → Providers → Email**: leave *Enable email provider* on. Turn **off** "Confirm email"
   (accounts are created by admins, not self-signup).
4. **Authentication → URL Configuration**: set *Site URL* to your Vercel URL (e.g. `https://penguin.vercel.app`)
   and add `https://penguin.vercel.app/auth/confirm` to *Redirect URLs*.
5. **Authentication → Email Templates → Reset password**: replace the link with
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
   so the reset email lands on the app's own reset page.

## 2. Apply the database schema

Either with the Supabase CLI:

```bash
cd penguin-app
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push                 # runs supabase/migrations/*.sql
npx supabase db query < supabase/seed.sql   # or paste seed.sql into the SQL editor
```

…or paste, in order, into **SQL Editor** in the dashboard:

1. `supabase/migrations/20260910000000_init.sql` – tables, RLS, functions, realtime
2. `supabase/migrations/20260910000001_photos_backups.sql` – photo bucket, backups, hourly job
3. `supabase/seed.sql` – the 398 seed items (Plumbing 238, Faucet Parts 98, Air Filters 900 51, Air Filters 904 11)

Then check **Database → Extensions** shows `pg_cron` enabled and **Integrations → Cron** lists
`penguin-hourly-backup`. (If pg_cron is off in your plan, enable it there and re-run the last block of
migration 2.)

## 3. Create the logins

```bash
cd penguin-app
npm install
cp .env.example .env.local        # fill in the three Supabase values

# default admin — username: admin  password: admin123$
npm run seed:users

# also create the whole crew from the old portal's data/pm_users.json
# (temporary password Penguin2026$, everyone must change it on first sign-in)
npm run seed:users -- --team
```

Give a specific person a known password instead of the temporary one:

```bash
SEED_USER_PASSWORDS='{"mtargosz":"their-password"}' npm run seed:users -- --team
```

## 4. Bring over the live inventory (optional but recommended)

`seed.sql` holds the original spreadsheet counts. The Railway portal has the *current* counts, photos
and activity log in `data/pm_inventory.json` and `data/pm_logs.json`:

```bash
npm run import:live                 # fills gaps only
npm run import:live -- --overwrite  # live JSON wins for every item it contains
```

## 5. Deploy to Vercel

1. **New Project → Import** this GitHub repo.
2. **Root Directory**: `penguin-app`. Framework preset: Next.js.
3. Environment variables (Production + Preview):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server only) |
   | `RESEND_API_KEY` | from resend.com (same account the Railway portal uses) |
   | `EMAIL_FROM` | `Penguin Maintenance <noreply@coldbreezellc.com>` (a verified Resend domain) |
   | `NEXT_PUBLIC_REPORT_RECIPIENTS` | default "To:" for reports |

4. Deploy. Open the URL on a phone → **Add to Home Screen** to install it like an app.

## Local development

```bash
npm run dev          # http://localhost:3000
npm run typecheck
npm run lint
npm run build
```

The service worker only registers in production builds (`npm run build && npm start`), or in dev with
`NEXT_PUBLIC_ENABLE_SW=true`.

## How offline works

- `lib/offline.ts` keeps an IndexedDB cache (items, users, logs, your profile) and an **outbox**.
- `lib/store.ts` applies every edit to the screen immediately, appends an op to the outbox, and flushes
  the outbox in order whenever `navigator.onLine` is true (on reconnect, when the app comes to the
  foreground, and every 20 s). Network failures pause the queue; a server rejection is retried 3× then dropped
  with a toast so one bad op can't block the rest.
- `public/sw.js` caches the app shell so the page itself loads with no service.
- Sign-in, password changes, user management and backups need a connection; everything else works offline.

## Security model (Row Level Security)

| Table | admin | crew | anon |
|---|---|---|---|
| `users` | read/write | read | – (`email_for_username()` only) |
| `inventory_items` | read/write | read/write | – |
| `activity_logs` | read/insert/delete | insert (as self) | – |
| `backups` | read + `take_backup()` / `restore_backup()` | – | – |
| Storage `item-photos` | upload/replace/delete | upload/replace/delete | read (public URLs) |

User creation/deletion and password resets go through `/api/admin/*` route handlers that verify the caller
is an admin and then use the service-role key server-side. The key never reaches the browser.

## Files

```
app/                     Next.js App Router (page, reset-password, API routes)
components/              UI, ported 1:1 from inventories/penguin-inventory.html
lib/store.ts             state + auth + outbox + realtime
lib/offline.ts           IndexedDB cache/outbox
lib/images.ts            phone-side photo resizing
public/sw.js             offline app shell
supabase/migrations/     schema, RLS, functions, storage, backups, cron
supabase/seed.sql        398 seed items (generated from supabase/seed-data.json)
scripts/                 seed-users, import-live, gen-seed-sql
```
