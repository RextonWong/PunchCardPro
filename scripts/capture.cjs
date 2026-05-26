require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { chromium } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const BASE  = 'http://localhost:5173';
const EMAIL = process.env.TEST_EMAIL;
const PASS  = process.env.TEST_PASS;
const OUT   = path.join(__dirname, 'screenshots');

if (!EMAIL || !PASS) {
  console.error('Missing TEST_EMAIL or TEST_PASS in .env');
  process.exit(1);
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/01_login.png`, fullPage: true });
  console.log('01_login');

  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/02_dashboard.png`, fullPage: true });
  console.log('02_dashboard');

  const newSiteBtn = page.locator('button', { hasText: '+ New Site' });
  if (await newSiteBtn.isVisible()) {
    await newSiteBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/03_new_site_modal.png`, fullPage: true });
    console.log('03_new_site_modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  const analyticsBtn = page.locator('button', { hasText: 'Analytics' });
  if (await analyticsBtn.isVisible()) {
    await analyticsBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/04_analytics.png`, fullPage: true });
    console.log('04_analytics');
    await page.locator('button', { hasText: '← Dashboard' }).click();
    await page.waitForTimeout(500);
  }

  const siteCards = page.locator('.grid > .bg-white');
  const count = await siteCards.count();
  console.log('Site cards found: ' + count);

  if (count > 0) {
    await siteCards.first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/05_site_ledger.png`, fullPage: true });
    console.log('05_site_ledger');

    const editBtn = page.locator('button', { hasText: 'Edit Site' });
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/06_edit_site_modal.png`, fullPage: true });
      console.log('06_edit_site_modal');
      await page.keyboard.press('Escape');
    }
  }

  await browser.close();
  console.log('Done');
})();
