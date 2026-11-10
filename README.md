# PunchCard Pro

PunchCard Pro records lorry punch-card hours and fees by site and month. Signed-in users can scan cards, review entries, manage site billing rules, and export monthly Excel workbooks.

## Development

```bash
npm install
npm run dev
npm run lint
npm run build
```

The frontend uses Supabase Auth and account-scoped `workplaces` and `entries` tables. Apply the migrations in `supabase/migrations/` to the linked Supabase project before using the corresponding features.

## Settings

Open **Settings** from the dashboard after signing in. Account settings allow email and password changes. Preferences store a display name and an optional default site to open after sign-in.

Spreadsheet settings choose a company heading, a separate worksheet per lorry or one worksheet with lorries stacked vertically, whether to include days without entries, and whether to include a totals summary. In combined mode the summary appears above the lorry tables; in separate mode it has its own worksheet. Existing accounts retain the original separate-tab, full-month export until they change these settings.

The Data section downloads a JSON backup of the currently loaded sites, entries, and settings. It does not include account credentials. The backup button is disabled if data or settings failed to load, to avoid an incomplete export.

Settings are stored per account in `public.user_settings`, added by `20261110151141_user_settings.sql`. Site rates, rain minimums, and rest rules remain in each site's configuration.
