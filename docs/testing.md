# Feature regression tests

Run `npm run test:features` after implementing a feature. This builds the real app and runs desktop and phone browser tests. Backend requests use isolated synthetic fixtures; no production users, data, or paid OCR calls are used.

First setup: `npx playwright install chromium`.

Add or update a case in `tests/features` with each feature: cover the user outcome, an important failure/recovery path, and phone behavior when affected. Keep fixtures explicit; any unmocked backend request fails. Inspect `playwright-report` and retained traces for failures. Run `npm run test:unit` for workbook regressions.

Coverage: sign-in, stored data reload, manual entry approval with saved payroll values, invalid lorry worksheet names, real workbook download, dismissible notification, monthly input/ledger navigation, and phone overflow. SMTP OTP is deferred and is not covered by this release.
