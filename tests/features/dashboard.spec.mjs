import { test, expect } from '@playwright/test';
import XLSX from 'xlsx';
import fs from 'node:fs';

async function fixture(page) {
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.test', aud: 'authenticated', role: 'authenticated' };
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user };
  const sites = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Sample Worksite', rate: 80, rain_min: 4, l_start: '13:00', l_end: '14:00', l_th: '14:00', f_start: '12:30', f_end: '14:30', f_th: '14:30' }];
  const entries = [{ id: '33333333-3333-4333-8333-333333333333', workplace_id: sites[0].id, lori_id: 'LD/2', date: '2026-10-01', time_range: '08:00-17:00', hours: 8, rest: 1, total: 640, is_rain: false }];
  await page.route('**/*.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname.endsWith('/token')) body = session;
    else if (url.pathname.endsWith('/user')) body = user;
    else if (url.pathname.endsWith('/logout')) body = {};
    else if (url.pathname.endsWith('/workplaces')) body = sites;
    else if (url.pathname.endsWith('/entries')) body = entries;
    else throw new Error(`Unmocked backend request: ${url.pathname}`);
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await page.locator('input[type=email]').fill(user.email);
  await page.locator('input[type=password]').fill('TestPassword123!');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.getByText('Sample Worksite', { exact: true }).click();
}

test('export invalid lorry IDs, dismiss notification, and reload saved data', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('button', { name: 'Refresh data' })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel Export' }).click();
  const download = await downloadPromise;
  const workbook = XLSX.read(fs.readFileSync(await download.path()));
  expect(workbook.SheetNames).toEqual(['LD-2']);
  expect(XLSX.utils.sheet_to_json(workbook.Sheets['LD-2'], { header: 1 }).flat()).toContain('LORI ID: LD/2');
  await expect(page.getByRole('status')).toContainText('Your Excel file is ready');
  await page.getByRole('button', { name: 'Close export notification' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Sample Worksite', { exact: true })).toBeVisible();
});

test('monthly input and ledger fit the viewport', async ({ page }, testInfo) => {
  await fixture(page);
  if (testInfo.project.name === 'phone') {
    await page.getByRole('button', { name: 'Ledger', exact: true }).click();
    await expect(page.getByText('640.00', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Monthly entry', exact: true }).click();
  }
  await expect(page.getByPlaceholder('LORRY ID (e.g. LD)')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
