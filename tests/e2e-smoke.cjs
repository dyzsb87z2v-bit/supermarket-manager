// Optional browser smoke test (needs Playwright + Chromium; NOT needed to use the app).
// Run: node tests/e2e-smoke.cjs     Screenshots go to $SHOTS (default ./e2e-shots)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 8123;
const SHOTS = process.env.SHOTS || path.join(__dirname, '..', 'e2e-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const root = path.join(__dirname, '..');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, locale: 'fa-IR', acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  const tab = (label) => page.locator('nav.tabs button', { hasText: label }).click();
  let step = 'start';
  try {
    await page.goto(url);
    await page.getByText('شروع کار').waitFor();
    await shot('01-empty-home');

    step = 'add product';
    await page.getByRole('button', { name: 'ثبت اولین کالا' }).click();
    const sheet = page.locator('.sheet');
    const inputs = sheet.locator('input');
    await inputs.nth(0).fill('ZZ Testkäse 400g');
    await inputs.nth(1).fill('Beyaz peynir');
    await inputs.nth(2).fill('4001234567890');
    await sheet.locator('input').nth(4).fill('1,89');
    await sheet.locator('input').nth(5).fill('2,79');
    await sheet.locator('input').nth(6).fill('5');
    await shot('02-product-form');
    await sheet.getByRole('button', { name: 'ذخیره' }).click();
    await tab('کالاها');
    await page.getByText('ZZ Testkäse 400g').waitFor();

    step = 'invalid barcode shows error';
    await page.getByText('ZZ Testkäse 400g').click();
    await sheet.locator('input').nth(2).fill('12ab');
    await sheet.getByRole('button', { name: 'ذخیره' }).click();
    await sheet.getByText('بارکد باید فقط عدد').waitFor();
    await sheet.getByRole('button', { name: 'بستن' }).click();

    step = 'receive and sell';
    await tab('موجودی');
    const stockForm = page.locator('.card.form');
    await stockForm.locator('input[type=search]').fill('4001234567890');
    await stockForm.locator('button.row').click();
    await stockForm.getByRole('button', { name: 'ورود کالا' }).click();
    await stockForm.locator('input[aria-label="مقدار"]').fill('20');
    await stockForm.locator('input[type=date]').nth(1).fill('2099-12-31');
    await stockForm.getByRole('button', { name: 'ثبت', exact: true }).click();
    await page.getByText('ورود کالا ثبت شد').waitFor();

    await stockForm.locator('input[type=search]').fill('ZZ Test');
    await stockForm.locator('button.row').click();
    await stockForm.getByRole('button', { name: 'فروش', exact: true }).click();
    await stockForm.locator('input[aria-label="مقدار"]').fill('99');
    await stockForm.getByRole('button', { name: 'ثبت', exact: true }).click();
    await page.getByText('موجودی کافی نیست').waitFor();
    await shot('03-insufficient-stock');
    await stockForm.locator('input[aria-label="مقدار"]').fill('5');
    await stockForm.getByRole('button', { name: 'ثبت', exact: true }).click();
    await page.getByText('فروش ثبت شد').waitFor();

    step = 'stock value shown on products tab';
    await tab('کالاها');
    await page.locator('button.row', { hasText: 'ZZ Testkäse' }).getByText(/^15 Stk$/).waitFor();

    step = 'daily report';
    await tab('گزارش');
    await page.locator('.stat', { hasText: 'تعداد فروش' }).getByText('5', { exact: true }).waitFor();
    await shot('04-report');

    step = 'persistence across reload';
    await page.reload();
    await tab('کالاها');
    await page.getByText('ZZ Testkäse 400g').waitFor();

    step = 'quick daily sales';
    await tab('موجودی');
    await page.getByRole('button', { name: 'ثبت سریع فروش روزانه' }).click();
    const row = page.locator('[data-row]', { hasText: 'ZZ Testkäse' });
    await row.getByText('موجودی 15 Stk').waitFor();
    await row.locator('input.qty').fill('99');
    await page.getByRole('button', { name: 'ثبت همه' }).click();
    await page.getByText('هیچ فروشی ثبت نشد').waitFor();
    await page.getByText(/موجودی کافی نیست/).waitFor();
    await shot('04b-daily-error');
    await row.locator('input.qty').fill('3');
    await page.getByText(/1 کالا · 3 عدد/).waitFor();
    await shot('04c-daily-filled');
    await page.getByRole('button', { name: 'ثبت همه' }).click();
    await page.getByText('1 فروش برای').waitFor();
    await tab('کالاها');
    await page.locator('button.row', { hasText: 'ZZ Testkäse' }).getByText(/^12 Stk$/).waitFor();

    step = 'CSV import: bad file imports nothing';
    await page.locator('header.top button[aria-label="تنظیمات"]').click();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-'));
    const bad = path.join(tmp, 'bad.csv');
    fs.writeFileSync(bad, 'Barcode;Artikel;EK;VK\n4000000000011;Brot;0,45;0,89\n4000000000028;Kaputt;abc;1\n');
    const pickers = page.locator('input[type=file]');
    await pickers.nth(0).setInputFiles(bad);
    await page.getByText('هیچ چیزی وارد نشد').waitFor();
    await page.getByText('ردیف 3').waitFor();
    await shot('05-import-error');
    const good = path.join(tmp, 'good.csv');
    fs.writeFileSync(good, 'Barcode;Artikel;Ürün;EK;VK;Mindestbestand\n4000000000011;Brot;Ekmek;0,45;0,89;10\n');
    await pickers.nth(0).setInputFiles(good);
    await page.getByText('1 کالای جدید').waitFor();

    step = 'workspace separation';
    await page.getByRole('button', { name: 'نمونه (ساختگی)' }).click();
    await page.locator('.banner.demo').waitFor();
    await shot('06-demo-home');
    await tab('کالاها');
    assert.equal(await page.getByText('ZZ Testkäse 400g').count(), 0, 'real product must not appear in demo');
    await page.getByText('Fladenbrot').first().waitFor();
    await tab('سفارش');
    await page.getByText('فقط پیشنهاد است').waitFor();
    await shot('07-demo-orders');
    await page.getByRole('button', { name: 'کپی متن سفارش' }).first().waitFor();
    await tab('گزارش');
    await page.getByRole('button', { name: 'هفتگی (۷ روز تا تاریخ)' }).click();
    await shot('08-demo-weekly');
    await page.locator('header.top button[aria-label="تنظیمات"]').click();
    await page.getByRole('button', { name: 'واقعی' }).click();
    await tab('کالاها');
    await page.getByText('ZZ Testkäse 400g').waitFor();
    assert.equal(await page.getByText('Fladenbrot').count(), 0, 'demo product must not leak into real');
    await page.getByText('Brot', { exact: true }).waitFor();

    step = 'backup download';
    await page.locator('header.top button[aria-label="تنظیمات"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'دریافت فایل پشتیبان' }).click()]);
    const saved = path.join(tmp, 'backup.json');
    await dl.saveAs(saved);
    const backup = JSON.parse(fs.readFileSync(saved, 'utf8'));
    assert.equal(backup.products.length, 2);
    assert.equal(backup.meta.isDemo, false);

    step = 'service worker + manifest reachable';
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return Boolean(r.active); });
    assert.ok(sw, 'service worker active');
    const man = await (await ctx.request.get(`http://127.0.0.1:${PORT}/manifest.webmanifest`)).json();
    assert.equal(man.display, 'standalone');
    for (const i of man.icons) assert.equal((await ctx.request.get(`http://127.0.0.1:${PORT}/${i.src}`)).status(), 200);

    step = 'offline reload works';
    await ctx.setOffline(true);
    await page.reload();
    await page.getByText('مدیریت سوپرمارکت').first().waitFor();
    await ctx.setOffline(false);

    assert.deepEqual(problems, [], 'no console errors');
    console.log('E2E OK');
  } catch (e) {
    await shot('FAIL').catch(() => {});
    console.error(`E2E FAILED at step "${step}":`, e.message.split('\n')[0]);
    if (problems.length) console.error(problems.join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
