#!/usr/bin/env node
'use strict';

// Real file:// integration checks. Test dependencies and the browser are
// development-only; the delivered index.html does not depend on them.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const html = path.join(root, 'index.html');
const out = process.env.DAKHL_QA_DIR || '/tmp/vc005-qa';
const storageKey = 'dakhl.vc005.v1';
const C = require('../src/core.js');
const results = [];
fs.mkdirSync(out, { recursive: true });

function playwright() {
  try { return require('playwright'); }
  catch {
    const runtime = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (!runtime) throw new Error('Install Playwright for development or set CODEX_PRIMARY_RUNTIME_NODE_MODULES.');
    return require(path.join(runtime, 'playwright'));
  }
}

async function main() {
  assert.ok(fs.existsSync(html), 'Build index.html before running browser checks.');
  const { chromium } = playwright();
  const options = { headless: true, args: ['--no-sandbox'] };
  const executable = process.env.DAKHL_CHROME_PATH || '/tmp/vc005-browsers/chrome-headless-shell-linux64/chrome-headless-shell';
  if (fs.existsSync(executable)) options.executablePath = executable;
  const browser = await chromium.launch(options);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, locale: 'fa-IR' });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  const requests = [];
  let fontEvidence = null;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => { if (/^https?:/i.test(req.url())) requests.push(req.url()); });

  async function run(name, fn) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, status: 'passed', milliseconds: Date.now() - start });
      console.log('PASS', name);
    } catch (error) {
      results.push({ name, status: 'failed', error: error.message, milliseconds: Date.now() - start });
      console.error('FAIL', name, '\n', error.stack);
      try { await page.screenshot({ path: path.join(out, `failure-${results.length}.png`), fullPage: true }); } catch {}
      try { if (await page.locator('#app-dialog').evaluate(el => el.open)) await page.keyboard.press('Escape'); } catch {}
    }
  }
  async function ready() {
    await page.waitForFunction(() => window.DakhlApp && typeof window.DakhlApp.getState === 'function');
    await page.evaluate(() => document.fonts.ready);
  }
  async function state() { return page.evaluate(() => window.DakhlApp.getState()); }
  async function seed(value) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value });
    await page.reload();
    await ready();
  }
  async function currentMonth() { return page.evaluate(() => window.DakhlApp.currentMonth()); }
  async function addTransaction({ type = 'expense', amount, category = 'food', note = '', date = C.todayISO() }) {
    await page.getByTestId('add-transaction').click();
    await page.getByTestId(`txn-type-${type}`).click();
    await page.getByTestId('txn-amount').fill(String(amount));
    await page.getByTestId('txn-category').selectOption(category);
    await page.getByTestId('txn-date').fill(date);
    await page.getByTestId('txn-note').fill(note);
    await page.getByTestId('txn-save').click();
    await page.waitForFunction(() => !document.getElementById('app-dialog').open);
  }
  async function nav(view) { await page.locator(`.desktop-nav [data-view="${view}"]`).click(); }
  function fixture(amount = 800, limit = 1000, note = 'خرید آزمایشی') {
    const value = C.emptyState();
    value.categories.find(x => x.id === 'food').budget = limit;
    value.transactions.push(C.validateTransaction({ type: 'expense', categoryId: 'food', amount, date: C.todayISO(), note }, value));
    return C.validateState(value);
  }

  await page.goto(pathToFileURL(html).href);
  await ready();

  await run('Fresh file opens offline with empty user ledger', async () => {
    const value = await state();
    assert.equal(value.transactions.length, 0);
    assert.equal(value.meta.demo, false);
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await page.locator('html').getAttribute('lang'), 'fa');
    assert.equal(requests.length, 0, 'A standalone offline app must not request HTTP assets.');
  });

  await run('Sample transactions require explicit opt-in and persist on reload', async () => {
    await page.getByTestId('load-demo').first().click();
    await page.waitForFunction(() => window.DakhlApp.getState().transactions.length > 0);
    const before = await state();
    assert.equal(before.meta.demo, true);
    await page.reload();
    await ready();
    assert.deepEqual(await state(), before);
  });

  await run('Embedded Persian font is actually loaded', async () => {
    const font = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      faces: [...document.fonts].map(x => ({ family: x.family, status: x.status })),
      checked: document.fonts.check('16px Estedad', 'درآمد هزینه تومان'),
    }));
    assert.match(font.body, /Estedad/i);
    assert.ok(font.faces.some(x => /Estedad/i.test(x.family) && x.status === 'loaded'));
    assert.equal(font.checked, true);
    const inspector = await context.newCDPSession(page);
    await inspector.send('DOM.enable');
    await inspector.send('CSS.enable');
    const { root: documentNode } = await inspector.send('DOM.getDocument');
    fontEvidence = {};
    for (const selector of ['h1', '.stat-money strong']) {
      const { nodeId } = await inspector.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector });
      const data = await inspector.send('CSS.getPlatformFontsForNode', { nodeId });
      assert.ok(data.fonts.some(x => /Estedad/i.test(x.familyName) && x.isCustomFont && x.glyphCount > 0), `Actual rendered font differs for ${selector}`);
      fontEvidence[selector] = data.fonts;
    }
    await inspector.detach();
  });

  await run('Responsive dashboard has no page overflow at 360, 390, 768 and 1440', async () => {
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(sizes.scroll <= sizes.width + 1, `Horizontal overflow at ${width}px: ${JSON.stringify(sizes)}`);
      await page.screenshot({ path: path.join(out, `dashboard-${width}.png`), fullPage: true });
    }
  });

  await run('Transaction dialog traps keyboard focus and Escape restores the opener', async () => {
    await page.getByTestId('add-transaction').click();
    await page.waitForFunction(() => document.getElementById('app-dialog').open);
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.getElementById('app-dialog').contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('app-dialog').open), false);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'add-transaction');
  });

  await run('Month navigation changes the selected Persian month and returns to current', async () => {
    const before = await currentMonth();
    await page.getByTestId('prev-month').click();
    const previous = await currentMonth();
    assert.notEqual(previous, before);
    assert.match(previous, /^\d{4}-\d{2}$/);
    await page.getByTestId('next-month').click();
    assert.equal(await currentMonth(), before);
  });

  await run('Income and Persian-digit expense save through the real form and update all totals', async () => {
    await seed(C.emptyState());
    await addTransaction({ type: 'income', amount: '۱۰٬۰۰۰٬۰۰۰', category: 'salary', note: 'حقوق تست' });
    await addTransaction({ amount: '۸۰۰', note: 'خرید تست' });
    assert.equal((await state()).transactions.length, 2);
    assert.equal(await page.getByTestId('summary-income').innerText(), '۱۰٬۰۰۰٬۰۰۰');
    assert.equal(await page.getByTestId('summary-expense').innerText(), '۸۰۰');
    assert.equal(await page.getByTestId('summary-balance').innerText(), '۹٬۹۹۹٬۲۰۰');
    const before = await state();
    await page.reload(); await ready();
    assert.deepEqual(await state(), before);
  });

  await run('Transaction editing, confirmed deletion and undo update persisted amounts', async () => {
    const expense = (await state()).transactions.find(x => x.type === 'expense');
    await page.locator(`[data-action="edit-transaction"][data-id="${expense.id}"]`).click();
    await page.getByTestId('txn-amount').fill('۸۵۰');
    await page.getByTestId('txn-note').fill('خرید اصلاح‌شده');
    await page.getByTestId('txn-save').click();
    assert.equal((await state()).transactions.find(x => x.id === expense.id).amount, 850);
    assert.equal(await page.getByTestId('summary-expense').innerText(), '۸۵۰');
    await page.locator(`[data-action="edit-transaction"][data-id="${expense.id}"]`).click();
    await page.getByTestId('txn-delete').click();
    assert.equal((await state()).transactions.length, 2, 'Deletion must wait for confirmation.');
    await page.getByTestId('confirm-action').click();
    assert.equal((await state()).transactions.length, 1);
    assert.equal(await page.getByTestId('summary-expense').innerText(), '۰');
    await page.locator('[data-action="undo"]').click();
    assert.equal((await state()).transactions.length, 2);
    assert.equal(await page.getByTestId('summary-expense').innerText(), '۸۵۰');
  });

  await run('Invalid money, missing category and missing date are rejected without state mutation', async () => {
    const before = await state();
    await page.getByTestId('add-transaction').click();
    assert.equal(await page.getByTestId('txn-category').inputValue(), '');
    await page.getByTestId('txn-category').selectOption('food');
    for (const invalid of ['-1', '0', '1.5', '1e3', 'عدد']) {
      await page.getByTestId('txn-amount').fill(invalid);
      await page.getByTestId('txn-save').click();
      assert.equal(await page.locator('#form-error').isVisible(), true);
      assert.deepEqual(await state(), before);
    }
    await page.getByTestId('txn-amount').fill('100');
    await page.getByTestId('txn-date').fill('');
    await page.getByTestId('txn-save').click();
    assert.deepEqual(await state(), before);
    await page.getByTestId('txn-date').fill(C.todayISO());
    await page.getByTestId('txn-category').selectOption('');
    await page.getByTestId('txn-save').click();
    assert.deepEqual(await state(), before);
    await page.keyboard.press('Escape');
  });

  await run('Exactly 80% has no warning; 801/1000 warns; monthly cap edit affects only that month', async () => {
    await seed(fixture());
    const month = await currentMonth();
    assert.equal(await page.getByTestId('budget-alert').count(), 0);
    await nav('budgets');
    assert.equal(await page.locator('[data-category-id="food"]').getAttribute('data-budget-status'), 'ok');
    await addTransaction({ amount: '۱', note: 'عبور یک تومان از مرز' });
    assert.equal(await page.locator('[data-category-id="food"]').getAttribute('data-budget-status'), 'warning');
    assert.equal(await page.getByTestId('budget-alert').count(), 1);
    await page.getByTestId('edit-budget-food').click();
    await page.getByTestId('budget-amount').fill('۲٬۰۰۰');
    await page.getByTestId('budget-save').click();
    const category = (await state()).categories.find(x => x.id === 'food');
    assert.equal(category.budget, 1000);
    assert.equal(category.monthlyBudgets[month], 2000);
    assert.equal(await page.locator('[data-category-id="food"]').getAttribute('data-budget-status'), 'ok');
    await page.getByTestId('prev-month').click();
    assert.match(await page.getByTestId('edit-budget-food').innerText(), /۱٬۰۰۰/);
    await page.getByTestId('next-month').click();
    assert.match(await page.getByTestId('edit-budget-food').innerText(), /۲٬۰۰۰/);
  });

  await run('Categories can be added, renamed and safely archived without losing transactions', async () => {
    await nav('budgets');
    await page.getByTestId('add-category').click();
    await page.getByTestId('category-name').fill('آموزش حرفه‌ای');
    await page.getByTestId('category-budget').fill('۲٬۰۰۰٬۰۰۰');
    await page.getByTestId('category-save').click();
    const category = (await state()).categories.find(x => x.name === 'آموزش حرفه‌ای');
    assert.ok(category);
    await page.locator(`[data-action="edit-category"][data-id="${category.id}"]`).click();
    await page.getByTestId('category-name').fill('یادگیری');
    await page.getByTestId('category-save').click();
    await addTransaction({ amount: '۱۰۰', category: category.id, note: 'کتاب آموزشی' });
    const count = (await state()).transactions.length;
    await page.locator(`[data-action="archive-category"][data-id="${category.id}"]`).click();
    await page.getByTestId('confirm-action').click();
    assert.equal((await state()).transactions.length, count);
    assert.equal((await state()).categories.find(x => x.id === category.id).archived, true);
    await page.getByTestId('add-transaction').click();
    assert.equal(await page.getByTestId('txn-category').locator(`option[value="${category.id}"]`).count(), 0);
    await page.keyboard.press('Escape');
    await page.locator('.archived-list summary').click();
    await page.locator(`[data-action="restore-category"][data-id="${category.id}"]`).click();
    assert.equal((await state()).categories.find(x => x.id === category.id).archived, false);
  });

  await run('Month-scoped type, category and text filters select the right transactions', async () => {
    await seed(C.demoState());
    await nav('transactions');
    await page.getByTestId('type-filter').selectOption('income');
    assert.equal(await page.locator('[data-txn-id]').count(), 2);
    await page.getByTestId('type-filter').selectOption('expense');
    await page.getByTestId('category-filter').selectOption('food');
    assert.equal(await page.locator('[data-txn-id]').count(), 4);
    await page.getByTestId('transaction-search').fill('سوپرمارکت');
    assert.equal(await page.locator('[data-txn-id]').count(), 1);
    assert.match(await page.locator('[data-txn-id]').innerText(), /۸۶۰٬۰۰۰/);
    const promise = page.waitForEvent('download');
    await page.getByTestId('export-filtered-csv').click();
    const download = await promise;
    const bytes = fs.readFileSync(await download.path());
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
    assert.equal(bytes.toString('utf8').split('\r\n').filter(Boolean).length, 2);
    assert.match(bytes.toString('utf8'), /860000/);
  });

  await run('Notes render as text; downloaded CSV preserves Persian and neutralizes formulas', async () => {
    await seed(C.emptyState());
    const dangerous = '<img src=x onerror="window.__dakhlXss=1">';
    await addTransaction({ amount: '۱۲۳', note: dangerous });
    await addTransaction({ amount: '۴۵۶', note: '=1+1,"فارسی"\nخط دوم' });
    assert.equal(await page.evaluate(() => window.__dakhlXss), undefined);
    assert.equal(await page.locator('.transaction-title img').count(), 0);
    assert.ok((await page.locator('body').innerText()).includes(dangerous));
    const promise = page.waitForEvent('download');
    await page.getByTestId('export-csv').click();
    const download = await promise;
    const bytes = fs.readFileSync(await download.path());
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
    const csv = bytes.toString('utf8');
    assert.match(csv, /تاریخ شمسی/);
    assert.match(csv, /"'=1\+1,""فارسی""\nخط دوم"/);
    assert.match(csv, /,456,/);
    fs.copyFileSync(await download.path(), path.join(out, 'verified-persian-export.csv'));
  });

  await run('Downloaded JSON restores exactly; malformed and broken-reference imports leave data intact', async () => {
    await page.getByTestId('data-manager').click();
    const promise = page.waitForEvent('download');
    await page.getByTestId('export-json').click();
    const download = await promise;
    const backup = fs.readFileSync(await download.path());
    const before = await state();
    assert.deepEqual(JSON.parse(backup.toString('utf8')), before);
    await page.keyboard.press('Escape');
    for (const bad of ['{invalid', JSON.stringify({ ...before, transactions: [{ ...before.transactions[0], categoryId: 'does-not-exist' }] })]) {
      await page.getByTestId('import-json-input').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(bad) });
      await page.waitForFunction(() => document.getElementById('import-file').value === '');
      assert.deepEqual(await state(), before);
      assert.equal(await page.locator('#app-dialog').evaluate(el => el.open), false);
    }
    await seed(C.emptyState());
    await page.getByTestId('import-json-input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await page.getByTestId('confirm-action').waitFor();
    assert.equal((await state()).transactions.length, 0, 'Restoration must wait for confirmation.');
    await page.getByTestId('confirm-action').click();
    assert.deepEqual(await state(), before);
  });

  await run('Storage failure reports an error and preserves the previous financial state', async () => {
    const before = await state();
    await page.evaluate(() => {
      window.__realStorageSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('Simulated quota failure', 'QuotaExceededError'); };
    });
    await page.getByTestId('add-transaction').click();
    await page.getByTestId('txn-amount').fill('100');
    await page.getByTestId('txn-category').selectOption('food');
    await page.getByTestId('txn-save').click();
    assert.equal(await page.locator('#form-error').isVisible(), true);
    assert.equal(await page.locator('#storage-warning').isVisible(), true);
    assert.deepEqual(await state(), before);
    await page.evaluate(() => { Storage.prototype.setItem = window.__realStorageSet; delete window.__realStorageSet; });
    await page.keyboard.press('Escape');
    await page.reload(); await ready();
  });

  await run('All views and transaction form fit 360, 390, 768 and 1440px; money stays on one line', async () => {
    await seed(C.demoState());
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['dashboard', 'transactions', 'budgets']) {
        const menu = width <= 680 ? '.mobile-nav' : '.desktop-nav';
        await page.locator(`${menu} [data-view="${view}"]`).click();
        const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(size.scroll <= size.width + 1, `${view} overflow at ${width}px`);
        if (view === 'dashboard') {
          const boxes = await page.locator('.stat-money strong').evaluateAll(elements => elements.map(el => {
            const range = document.createRange(); range.selectNodeContents(el);
            const tops = [...range.getClientRects()].map(r => Math.round(r.top));
            const own = el.getBoundingClientRect(); const parent = el.closest('.stat-card').getBoundingClientRect();
            return { text: el.textContent, lines: new Set(tops).size, left: own.left, right: own.right, min: parent.left, max: parent.right };
          }));
          assert.ok(boxes.every(x => x.lines === 1 && x.left >= x.min && x.right <= x.max), `Broken or clipped money at ${width}px: ${JSON.stringify(boxes)}`);
          await page.screenshot({ path: path.join(out, `dashboard-${width}.png`), fullPage: true });
        }
      }
      await page.getByTestId('add-transaction').click();
      const modal = await page.locator('#app-dialog').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, rect: el.getBoundingClientRect().toJSON(), viewport: innerWidth }));
      assert.ok(modal.scroll <= modal.width + 1 && modal.rect.left >= 0 && modal.rect.right <= modal.viewport, `Modal overflow at ${width}px`);
      await page.keyboard.press('Escape');
    }
  });

  await run('Large valid safe-integer amount stays exact and unbroken on a 360px screen', async () => {
    await page.setViewportSize({ width: 360, height: 1000 });
    await seed(fixture(Number.MAX_SAFE_INTEGER - 1, 0, 'مبلغ بزرگ معتبر'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByTestId('summary-expense').innerText(), '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۰');
    const metrics = await page.locator('.stat-money strong').evaluateAll(elements => elements.map(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const own = el.getBoundingClientRect(), parent = el.closest('.stat-card').getBoundingClientRect();
      return { lines: new Set([...range.getClientRects()].map(r => Math.round(r.top))).size, left: own.left, right: own.right, min: parent.left, max: parent.right };
    }));
    assert.ok(metrics.every(x => x.lines === 1 && x.left >= x.min && x.right <= x.max));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });

  await run('No runtime errors or network dependencies', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  });

  const report = {
    timestamp: new Date().toISOString(),
    browser: browser.version(),
    file: html,
    fontEvidence,
    passed: results.filter(x => x.status === 'passed').length,
    failed: results.filter(x => x.status === 'failed').length,
    results,
  };
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, report: path.join(out, 'browser-results.json') }));
  process.exitCode = report.failed ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
