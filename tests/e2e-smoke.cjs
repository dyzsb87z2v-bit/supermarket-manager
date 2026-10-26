// Optional browser test (needs Playwright + Chromium; NOT needed to use the app).
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
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

(async () => {
  const D = (await import('../src/ui/i18n/de.js')).default;
  const TR = (await import('../src/ui/i18n/tr.js')).default;
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, locale: 'de-DE', acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  const tid = (id) => page.getByTestId(id);
  const tab = (k) => tid(`tab-${k}`).click();
  const toast = (re) => page.locator('.toast', { hasText: re }).waitFor();
  const overflow = async (label) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (w[0] > w[1] + 1) {
      const culprits = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 5).map((e) => `${e.tagName}.${e.className} right=${Math.round(e.getBoundingClientRect().right)} "${(e.textContent || '').slice(0, 40)}"`));
      assert.fail(`horizontal overflow on ${label}: ${w[0]} > ${w[1]}\n${culprits.join('\n')}`);
    }
  };
  let step = 'start';
  try {
    await page.goto(url);
    await page.getByText(D['home.startTitle']).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'de');
    assert.equal(await page.title(), D['app.title']);
    await shot('01-empty-home-de');

    step = 'add product (German UI)';
    await tid('start-add-product').click();
    await tid('f-nameDe').fill('ZZ Testkäse 400g');
    await tid('f-nameTr').fill('Beyaz peynir');
    await tid('f-barcode').fill('4001234567890');
    await tid('f-buy').fill('1,89');
    await tid('f-sell').fill('2,79');
    await tid('f-min').fill('5');
    await page.getByText(new RegExp(`${esc('32,3')}`)).waitFor();
    await shot('02-product-form-de');
    await tid('product-save').click();
    await tab('products');
    await page.getByText('ZZ Testkäse 400g').waitFor();

    step = 'invalid barcode shows translated error';
    await page.getByText('ZZ Testkäse 400g').click();
    await tid('f-barcode').fill('12ab');
    await tid('product-save').click();
    await page.locator('.sheet').getByText(D['err.barcode_invalid']).waitFor();
    await page.locator('.sheet').getByRole('button', { name: D['common.close'] }).click();

    step = 'receive and sell';
    await tab('stock');
    await tid('move-search').fill('4001234567890');
    await tid('move-hit').click();
    await tid('type-receive').click();
    await tid('move-qty').fill('20');
    await tid('move-expiry').fill('2099-12-31');
    await tid('move-submit').click();
    await toast(new RegExp(D['move.receive']));
    await tid('move-search').fill('ZZ Test');
    await tid('move-hit').click();
    await tid('type-sale').click();
    await tid('move-qty').fill('99');
    await tid('move-submit').click();
    await page.getByText(D['err.insufficient_stock']).waitFor();
    await shot('03-insufficient-stock-de');
    await tid('move-qty').fill('5');
    await tid('move-submit').click();
    await toast(new RegExp(D['move.sale']));

    step = 'stock shown on products tab';
    await tab('products');
    await page.locator('button.row', { hasText: 'ZZ Testkäse' }).getByText('15 Stk').waitFor();

    step = 'daily report';
    await tab('reports');
    await tid('report-tags').locator('.tag', { hasText: D['reports.units'] }).getByText('5', { exact: true }).waitFor();
    await shot('04-report-de');

    step = 'persistence across reload';
    await page.reload();
    await tab('products');
    await page.getByText('ZZ Testkäse 400g').waitFor();

    step = 'quick daily sales';
    await tab('stock');
    await tid('sub-daily').click();
    const row = page.locator('[data-row]', { hasText: 'ZZ Testkäse' });
    await row.getByText('Bestand 15 Stk').waitFor();
    await row.locator('input.qty').fill('99');
    await tid('daily-submit').click();
    await page.getByText(D['daily.failed']).waitFor();
    await page.getByText(D['err.insufficient_stock'], { exact: false }).first().waitFor();
    await row.locator('input.qty').fill('3');
    await page.getByText(/Artikel: 1 · Menge: 3/).waitFor();
    await shot('05-daily-filled-de');
    await tid('daily-submit').click();
    await toast(/1 Verkauf für den/);
    await tab('products');
    await page.locator('button.row', { hasText: 'ZZ Testkäse' }).getByText('12 Stk').waitFor();

    step = 'CSV import: bad file imports nothing, good file works';
    await tid('open-settings').click();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-'));
    const bad = path.join(tmp, 'bad.csv');
    fs.writeFileSync(bad, 'Barcode;Artikel;EK;VK\n4000000000011;Brot;0,45;0,89\n4000000000028;Kaputt;abc;1\n');
    await tid('file-products').setInputFiles(bad);
    await page.getByText(D['import.failed']).waitFor();
    await page.getByText('Zeile 3: ' + D['err.buy_price_invalid']).waitFor();
    await shot('06-import-error-de');
    const good = path.join(tmp, 'good.csv');
    fs.writeFileSync(good, 'Barcode;Artikel;Ürün;EK;VK;Mindestbestand;stock\n4000000000011;Brot;Ekmek;0,45;0,89;10;7\n');
    await tid('file-products').setInputFiles(good);
    await page.getByText('Neu: 1 · Aktualisiert: 0').waitFor();
    await page.getByText('Bestand gebucht: 1').waitFor();

    step = 'workspace separation';
    await tid('ws-demo').click();
    await page.locator('.banner.demo').waitFor();
    await shot('07-demo-home-de');
    await tab('products');
    assert.equal(await page.getByText('ZZ Testkäse 400g').count(), 0, 'real product must not appear in demo');
    await page.getByText('Fladenbrot').first().waitFor();
    await tab('orders');
    await page.getByText(/Nur ein Vorschlag/).waitFor();
    await shot('08-demo-orders-de');
    await tid('copy-order').first().waitFor();
    await tid('open-settings').click();
    await tid('ws-real').click();
    await tab('products');
    await page.getByText('ZZ Testkäse 400g').waitFor();
    assert.equal(await page.getByText('Fladenbrot').count(), 0, 'demo product must not leak into real');

    step = 'backup download';
    await tid('open-settings').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), tid('backup').click()]);
    const saved = path.join(tmp, 'backup.json');
    await dl.saveAs(saved);
    const backup = JSON.parse(fs.readFileSync(saved, 'utf8'));
    assert.equal(backup.products.length, 2);
    assert.equal(backup.meta.isDemo, false);

    step = 'language switching (TR, FA/RTL, DE) and persistence';
    await tid('header-lang').selectOption('tr');
    await tid('tab-home').waitFor();
    await tid('tab-products').getByText(TR['nav.products']).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'tr');
    assert.equal(await page.title(), TR['app.title']);
    await tab('products');
    await page.locator('button.row', { hasText: 'ZZ Testkäse' }).getByText('12 adet').waitFor();
    await shot('09-products-tr');
    await tab('stock');
    await tid('sub-daily').click();
    await shot('10-daily-tr');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.lang === 'tr', null, { timeout: 5000 }).catch(() => assert.fail('language did not persist across reload'));
    await tid('header-lang').selectOption('fa');
    await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    await tab('home');
    await shot('11-home-fa');
    await overflow('fa home');
    await tid('header-lang').selectOption('de');
    await page.waitForFunction(() => document.documentElement.dir === 'ltr');

    step = 'service worker + manifest + offline';
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return Boolean(r.active); });
    assert.ok(sw, 'service worker active');
    const man = await (await ctx.request.get(`http://127.0.0.1:${PORT}/manifest.webmanifest`)).json();
    for (const i of man.icons) assert.equal((await ctx.request.get(`http://127.0.0.1:${PORT}/${i.src}`)).status(), 200);
    await page.reload();               // second load: everything is cached now
    await page.waitForTimeout(500);
    await ctx.setOffline(true);
    await page.reload();
    await tid('tab-products').getByText(D['nav.products']).waitFor();
    await ctx.setOffline(false);

    step = 'pseudo-locale sweep: every screen shows only pack text and survives +35% length';
    await tid('open-settings').click();
    await tid('ws-demo').click();
    await page.goto(`${url}?lang=en-XA`);
    await tid('tab-home').waitFor(); // first render finished (not the boot placeholder)
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'positive control: pseudo locale active');
    const sweep = async (label) => {
      const bad = await page.evaluate(() => {
        const out = [];
        const hasLetters = (s) => /\p{L}/u.test(s);
        const skip = (el) => el.closest('[data-user],[data-fmt]');
        const scope = [...document.querySelectorAll('#app, .sheet-bg, .toast')];
        for (const root of scope) {
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const text = n.textContent.trim();
            if (!text || !hasLetters(text) || skip(n.parentElement)) continue;
            if (!text.includes('⟦')) out.push(`text: ${text.slice(0, 60)}`);
          }
          for (const el of root.querySelectorAll('[placeholder],[title],[alt],[aria-label]')) {
            if (skip(el)) continue;
            for (const a of ['placeholder', 'title', 'alt', 'aria-label']) {
              const v = el.getAttribute(a);
              if (v && hasLetters(v) && !v.includes('⟦')) out.push(`${a}: ${v.slice(0, 60)}`);
            }
          }
        }
        if (!document.title.includes('⟦')) out.push(`title: ${document.title}`);
        return out;
      });
      assert.deepEqual(bad, [], `unmarked (untranslated) text on ${label}`);
      await overflow(label);
    };
    await sweep('home');
    for (const k of ['products', 'orders', 'reports']) { await tab(k); await sweep(k); }
    await tab('orders'); await tid('sub-suppliers').click(); await sweep('suppliers');
    await tid('new-supplier').click(); await sweep('supplier sheet'); await page.keyboard.press('Escape');
    await tab('reports'); await tid('rep-weekly').click(); await sweep('weekly report'); await shot('12-weekly-pseudo');
    await tab('stock'); await sweep('stock single');
    await tid('sub-daily').click(); await sweep('stock daily');
    await tab('products'); await page.locator('button.row').first().click(); await sweep('product sheet'); await page.keyboard.press('Escape');
    await tid('add-product').click(); await sweep('new product sheet'); await page.keyboard.press('Escape');
    await tid('open-settings').click(); await sweep('settings');

    const real = problems.filter((p) => !/Failed to load resource/.test(p));
    assert.deepEqual(real, [], 'no console errors/warnings (includes missing translation keys)');
    console.log('E2E OK');
  } catch (e) {
    await shot('FAIL').catch(() => {});
    console.error(`E2E FAILED at step "${step}":`, e.message.split('\n').slice(0, 6).join('\n'));
    if (problems.length) console.error(problems.join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
