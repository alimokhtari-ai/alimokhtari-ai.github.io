'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const clone = value => JSON.parse(JSON.stringify(value));

function transaction(state, fields) {
  return C.validateTransaction({ type: 'expense', amount: 100, categoryId: 'food', date: '2026-10-22', note: '', ...fields }, state);
}

test('Persian / Arabic digits and correctly grouped integer toman are accepted', () => {
  assert.equal(C.parseAmount('۱۲٬۳۴۵٬۶۷۸'), 12345678);
  assert.equal(C.parseAmount('١٢,٣٤٥'), 12345);
  assert.equal(C.parseAmount('1 234 567'), 1234567);
  assert.equal(C.parseAmount('۰'), 0);
  assert.equal(C.digitsToLatin('۱۴۰۵/٠٧/۳۰'), '1405/07/30');
  assert.equal(C.formatNumber(1234567), '۱٬۲۳۴٬۵۶۷');
});

test('invalid amounts and unsafe integers cannot enter the ledger', () => {
  for (const value of ['', '-1', '+1', '1e6', '۱۲٫۵', '12.5', '12,34', 'Infinity', NaN, Infinity, 1.5, null, {}, '9007199254740992']) {
    assert.throws(() => C.parseAmount(value), undefined, String(value));
  }
  assert.equal(C.parseAmount(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.throws(() => transaction(C.emptyState(), { amount: '۰' }), /بیشتر از صفر/);
});

test('real Gregorian dates are validated without timezone rollover', () => {
  assert.equal(C.validateDateISO('2024-02-29'), true);
  assert.equal(C.validateDateISO('2026-02-29'), false);
  assert.equal(C.validateDateISO('2026-04-31'), false);
  assert.equal(C.validateDateISO('2026-2-2'), false);
  assert.equal(C.validateDateISO('2026-10-22T23:00:00Z'), false);
  assert.deepEqual(C.toJalali('2026-10-22'), { year: 1405, month: 7, day: 30 });
  assert.equal(C.monthKey('2026-10-23'), '1405-08');
});

test('Nowruz, Esfand leap days and Jalali month transitions are exact', () => {
  assert.deepEqual(C.toJalali('2024-03-20'), { year: 1403, month: 1, day: 1 });
  assert.deepEqual(C.toJalali('2025-03-20'), { year: 1403, month: 12, day: 30 });
  assert.deepEqual(C.toJalali('2025-03-21'), { year: 1404, month: 1, day: 1 });
  assert.equal(C.daysInJalaliMonth(1403, 12), 30);
  assert.equal(C.daysInJalaliMonth(1404, 12), 29);
  assert.equal(C.gregorianFromJalali(1403, 12, 30), '2025-03-20');
  assert.throws(() => C.gregorianFromJalali(1404, 12, 30));
  assert.equal(C.shiftMonth('1404-01', -1), '1403-12');
  assert.equal(C.shiftMonth('1403-12', 1), '1404-01');
  assert.equal(C.monthLabel('1405-07'), 'مهر ۱۴۰۵');
  assert.throws(() => C.shiftMonth('1405-13', 1));
  assert.throws(() => C.shiftMonth('1405-07', 0.5));
});

test('every day around leap boundaries round-trips through the Persian calendar', () => {
  const start = new Date('2023-03-01T12:00:00Z');
  for (let index = 0; index < 1150; index += 1) {
    const iso = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
    const p = C.toJalali(iso);
    assert.equal(C.gregorianFromJalali(p.year, p.month, p.day), iso);
  }
});

test('warning starts strictly above 80%, with independent full/exceeded states', () => {
  assert.equal(C.budgetStatus(799, 1000).status, 'ok');
  assert.equal(C.budgetStatus(800, 1000).status, 'ok');
  assert.equal(C.budgetStatus(801, 1000).status, 'warning');
  assert.equal(C.budgetStatus(1000, 1000).status, 'full');
  assert.equal(C.budgetStatus(1001, 1000).status, 'exceeded');
  assert.equal(C.budgetStatus(1001, 1000).remaining, -1);
  assert.equal(C.budgetStatus(100000, 0).status, 'none');
  assert.equal(C.budgetStatus(100000, 0).remaining, null);
  assert.equal(C.budgetStatus(4, 5).status, 'ok');
  assert.equal(C.budgetStatus(3, 3).status, 'full');
  const limit = Number.MAX_SAFE_INTEGER;
  const floor80 = Number(BigInt(limit) * 4n / 5n);
  assert.equal(C.budgetStatus(floor80, limit).status, 'ok');
  assert.equal(C.budgetStatus(floor80 + 1, limit).status, 'warning');
  assert.throws(() => C.budgetStatus(-1, 100));
});

test('a per-month zero ceiling overrides a nonzero default, and never leaks months', () => {
  const category = C.emptyState().categories[0];
  category.budget = 1000;
  category.monthlyBudgets['1405-07'] = 2000;
  category.monthlyBudgets['1405-08'] = 0;
  assert.equal(C.categoryBudget(category, '1405-07'), 2000);
  assert.equal(C.categoryBudget(category, '1405-08'), 0);
  assert.equal(C.categoryBudget(category, '1405-09'), 1000);
});

test('income, expenses, balance, count and category amounts use the selected Jalali month only', () => {
  const state = C.emptyState();
  state.categories[0].budget = 1000;
  state.transactions.push(transaction(state, { id: 'a', amount: 801 }));
  state.transactions.push(transaction(state, { id: 'b', type: 'income', categoryId: 'salary', amount: 5000 }));
  state.transactions.push(transaction(state, { id: 'c', amount: 999, date: '2026-10-23' }));
  const summary = C.summarize(state, '1405-07');
  assert.equal(summary.income, 5000);
  assert.equal(summary.expense, 801);
  assert.equal(summary.balance, 4199);
  assert.equal(summary.count, 2);
  assert.equal(summary.byCategory.find(v => v.category.id === 'food').status, 'warning');
  assert.equal(C.summarize(state, '1405-08').expense, 999);
  assert.equal(C.summarize(state, '1405-06').count, 0);
});

test('editing preserves identity/creation time and updates amounts without double counting', () => {
  const state = C.emptyState();
  const original = transaction(state, { id: 'edit-me', amount: 100 });
  state.transactions.push(original);
  const edited = C.validateTransaction({ ...original, amount: '۲۵۰', note: 'ویرایش', createdAt: '2020-01-01T00:00:00.000Z' }, state);
  assert.equal(edited.id, original.id);
  assert.equal(edited.createdAt, original.createdAt);
  assert.equal(edited.amount, 250);
  state.transactions[0] = edited;
  assert.equal(C.summarize(state, '1405-07').expense, 250);
  assert.throws(() => transaction(state, { categoryId: 'salary' }), /هماهنگ/);
  assert.throws(() => transaction(state, { categoryId: 'missing' }), /پیدا نشد/);
});

test('archived categories retain history and old edits but reject new entries', () => {
  const state = C.emptyState();
  const original = transaction(state, { id: 'old' });
  state.transactions.push(original);
  state.categories[0].archived = true;
  assert.throws(() => transaction(state, { id: 'new' }), /فعال/);
  assert.equal(C.validateTransaction({ ...original, amount: 200 }, state).amount, 200);
  assert.equal(C.validateState(state).transactions[0].categoryId, 'food');
});

test('ledger totals remain inside JavaScript exact-integer range', () => {
  const state = C.emptyState();
  const first = transaction(state, { id: 'huge', amount: Number.MAX_SAFE_INTEGER });
  state.transactions.push(first);
  assert.throws(() => transaction(state, { id: 'extra', amount: 1 }), /دقیق/);
  assert.equal(C.validateTransaction({ ...first, amount: 1 }, state).amount, 1);
  const backup = clone(state);
  backup.transactions.push({ ...first, id: 'overflow' });
  assert.throws(() => C.validateState(backup), /دقیق/);
});

test('backup validation rejects dangling refs, duplicates, invalid types and prototype-like IDs', () => {
  const demo = C.demoState('2026-10-22');
  assert.deepEqual(C.validateState(clone(demo)), demo);
  const cases = [
    s => { s.version = 2; },
    s => { s.transactions[0].categoryId = 'missing'; },
    s => { s.transactions[0].type = 'expense'; },
    s => { s.transactions[0].date = '2026-02-30'; },
    s => { s.transactions[0].amount = -1; },
    s => { s.transactions[0].createdAt = '2026-02-30T12:00:00.000Z'; },
    s => { s.transactions[0].id = '__proto__'; },
    s => { s.transactions.push({ ...s.transactions[0] }); },
    s => { s.categories.push({ ...s.categories[0] }); },
    s => { s.categories[1].name = s.categories[0].name; },
    s => { s.categories[0].monthlyBudgets['1405-13'] = 100; },
    s => { s.categories[0].budget = '1.5'; },
    s => { s.categories[0].color = 'url(javascript:evil)'; },
    s => { s.categories[0].icon = '<img onerror=evil>'; },
    s => { s.meta.demo = 'yes'; }
  ];
  for (const mutate of cases) { const s = clone(demo); mutate(s); assert.throws(() => C.validateState(s)); }
});

test('BOM CSV preserves Persian, valid numbers, quoted multiline text, and formula safety', () => {
  const state = C.emptyState();
  const tx = transaction(state, { id: 'csv', amount: 1234567, note: 'ناهار، "دو نفر"\nروز خوب' });
  const csv = C.exportCSV(state, [tx]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /تاریخ شمسی/);
  assert.match(csv, /۱۴۰۵\/۰۷\/۳۰/);
  assert.match(csv, /,1234567,/);
  assert.match(csv, /"ناهار، ""دو نفر""\nروز خوب"/);
  assert.ok(csv.endsWith('\r\n'));
  const unsafe = { ...tx, note: '=HYPERLINK("https://example.invalid","test")' };
  assert.match(C.exportCSV(state, [unsafe]), /"'=HYPERLINK/);
  for (const lead of ['+', '-', '@', '\t=', ' \ufeff=']) {
    assert.ok(C.exportCSV(state, [{ ...tx, note: lead + '1+1' }]).includes('"\'' + lead));
  }
  state.categories[0].name = '=SUM(1,1)';
  assert.match(C.exportCSV(state, [tx]), /"'=SUM\(1,1\)"/);
});

test('sample data is explicit, reproducible, inside two real Jalali months, and demonstrates alerts', () => {
  const demo = C.demoState('2026-10-22');
  assert.equal(demo.meta.demo, true);
  assert.equal(demo.transactions.length, 20);
  assert.equal(C.summarize(demo, '1405-07').income, 39500000);
  assert.equal(C.summarize(demo, '1405-07').expense, 14880000);
  assert.equal(C.summarize(demo, '1405-07').balance, 24620000);
  assert.ok(C.summarize(demo, '1405-07').byCategory.some(c => c.status === 'warning'));
  assert.ok(C.summarize(demo, '1405-07').byCategory.some(c => c.status === 'exceeded'));
  assert.deepEqual(new Set(demo.transactions.map(t => C.monthKey(t.date))), new Set(['1405-06', '1405-07']));
  const firstDay = C.demoState('2025-03-21');
  assert.ok(firstDay.transactions.every(t => t.date <= '2025-03-21'));
  assert.ok(firstDay.transactions.every(t => C.validateDateISO(t.date)));
});

test('HTML-sensitive user text is escaped, and functions do not mutate source objects', () => {
  assert.equal(C.escapeHtml('<img src="x" onerror=\'x\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;');
  const state = C.demoState('2026-10-22');
  const before = JSON.stringify(state);
  C.summarize(state, '1405-07');
  C.exportCSV(state, state.transactions);
  C.validateState(state);
  assert.equal(JSON.stringify(state), before);
});
