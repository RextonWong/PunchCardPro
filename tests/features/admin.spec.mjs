import { test, expect } from '@playwright/test';
async function login(page, allowed) {
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.test', aud: 'authenticated', role: 'authenticated' };
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
  const account = { id: '22222222-2222-4222-8222-222222222222', email: 'user@example.test', created_at: '2026-10-01', last_sign_in_at: null, email_confirmed_at: '2026-10-01', suspended: false, is_admin: false, usage: { requests: 3, attempts: 4, errors: 1, input_tokens: 100, output_tokens: 50, estimated_usd: 0, unpriced: 4, models: ['gemini/gemini-3.8-flash'] } };
  const actions = [];
  await page.route('**/*.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`, refresh_token: 'test', expires_in: 3600, token_type: 'bearer', user } });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: user });
    if (url.pathname.endsWith('/admin-api')) {
      if (!allowed) return route.fulfill({ status: 403, json: { error: 'Administrator access required' } });
      const body = route.request().postDataJSON();
      if (body.action === 'users') return route.fulfill({ json: { users: [account], total: 1 } });
      actions.push(body.action); account.suspended = body.action === 'suspend';
      return route.fulfill({ json: { success: true } });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  await page.goto('/admin');
  await page.locator('input[type=email]').fill(user.email);
  await page.locator('input[type=password]').fill('TestPassword123!');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  return actions;
}
test('non-admin sees denial and no user details', async ({ page }) => {
  await login(page, false);
  await expect(page.getByRole('alert')).toContainText('Administrator access required');
  await expect(page.getByRole('heading', { name: 'user@example.test' })).toHaveCount(0);
});
test('admin reviews usage, cancels suspension, then suspends and restores', async ({ page }, testInfo) => {
  const actions = await login(page, true);
  await expect(page.getByRole('heading', { name: 'user@example.test' })).toBeVisible();
  await expect(page.getByText('$0.0000 · 4 unpriced')).toBeVisible();
  if (process.env.UPDATE_PROOF) await page.screenshot({ path: `docs/proof/admin-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Suspend account', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(actions).toEqual([]);
  await page.getByRole('button', { name: 'Suspend account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm suspend' }).click();
  await expect(page.getByRole('button', { name: 'Restore account' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore account' }).click();
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.getByRole('button', { name: 'Suspend account', exact: true })).toBeVisible();
  expect(actions).toEqual(['suspend','restore']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
