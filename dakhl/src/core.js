/* Dakhl — dependency-free financial rules. All money is integer toman. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DakhlCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 86400000;
  const MAX_CATEGORIES = 200;
  const MAX_TRANSACTIONS = 20000;
  const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const numberFormatter = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });
  const jalaliFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC'
  });
  const yearStartCache = new Map();
  const reservedIds = new Set(['__proto__', 'prototype', 'constructor']);

  function fail(message) { throw new Error(message); }
  function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function digitsToLatin(value) {
    return String(value == null ? '' : value)
      .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632));
  }

  function parseAmount(value) {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) fail('مبلغ باید یک عدد صحیح و نامنفی باشد.');
      return value;
    }
    if (typeof value !== 'string') fail('مبلغ را به شکل عدد وارد کن.');
    let text = digitsToLatin(value).replace(/[\u200e\u200f\u061c]/g, '').trim();
    if (!text) fail('مبلغ را وارد کن.');
    text = text.replace(/[\u066c\u060c]/g, ',').replace(/[\u0020\u00a0\u202f]/g, ',');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) fail('مبلغ را بدون اعشار، علامت منفی یا حروف وارد کن.');
    const amount = Number(text.replace(/,/g, ''));
    if (!Number.isSafeInteger(amount)) fail('این مبلغ از محدودهٔ عددی امن بزرگ‌تر است.');
    return amount;
  }

  function formatNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '۰';
    return numberFormatter.format(Object.is(value, -0) ? 0 : value);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function validateDateISO(value) {
    if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00.000Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function todayISO() {
    // Date-only input follows the user's own local day, without UTC day shifts.
    const now = new Date();
    return String(now.getFullYear()).padStart(4, '0') + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  function jalaliPartsFromDate(date) {
    const values = {};
    for (const part of jalaliFormatter.formatToParts(date)) {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') values[part.type] = Number(part.value);
    }
    return { year: values.year, month: values.month, day: values.day };
  }

  function toJalali(value) {
    if (!validateDateISO(value)) fail('تاریخ واردشده معتبر نیست.');
    return jalaliPartsFromDate(new Date(value + 'T12:00:00.000Z'));
  }

  function parseMonthKey(key) {
    if (typeof key !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) fail('ماه انتخاب‌شده معتبر نیست.');
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5));
    if (year < 1 || year > 9378) fail('سال انتخاب‌شده معتبر نیست.');
    return { year, month };
  }

  function makeMonthKey(year, month) { return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0'); }
  function monthKey(dateISO) { const p = toJalali(dateISO); return makeMonthKey(p.year, p.month); }
  function monthLabel(key) { const p = parseMonthKey(key); return MONTHS[p.month - 1] + ' ' + String(p.year).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]); }

  function shiftMonth(key, delta) {
    if (!Number.isSafeInteger(delta)) fail('تعداد ماه باید صحیح باشد.');
    const p = parseMonthKey(key);
    const index = p.year * 12 + p.month - 1 + delta;
    const year = Math.floor(index / 12);
    const month = ((index % 12) + 12) % 12 + 1;
    const next = makeMonthKey(year, month);
    parseMonthKey(next);
    return next;
  }

  function startOfJalaliYear(year) {
    if (!Number.isInteger(year) || year < 1 || year > 9379) fail('سال شمسی معتبر نیست.');
    if (yearStartCache.has(year)) return yearStartCache.get(year);
    const gregorianYear = year + 621;
    let lower = Math.floor(Date.UTC(gregorianYear, 0, 1, 12) / DAY);
    let upper = Math.floor(Date.UTC(gregorianYear, 4, 1, 12) / DAY);
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      const p = jalaliPartsFromDate(new Date(middle * DAY + DAY / 2));
      if (p.year < year) lower = middle + 1;
      else upper = middle;
    }
    const date = new Date(lower * DAY + DAY / 2);
    const p = jalaliPartsFromDate(date);
    if (p.year !== year || p.month !== 1 || p.day !== 1) fail('تبدیل تقویم برای این سال در دسترس نیست.');
    yearStartCache.set(year, date.getTime());
    return date.getTime();
  }

  function daysInJalaliMonth(year, month) {
    if (!Number.isInteger(year) || year < 1 || year > 9378 || !Number.isInteger(month) || month < 1 || month > 12) fail('ماه یا سال شمسی معتبر نیست.');
    if (month <= 6) return 31;
    if (month <= 11) return 30;
    const result = Math.round((startOfJalaliYear(year + 1) - startOfJalaliYear(year)) / DAY) - 336;
    if (result !== 29 && result !== 30) fail('طول این ماه قابل محاسبه نیست.');
    return result;
  }

  function gregorianFromJalali(year, month, day) {
    const length = daysInJalaliMonth(year, month);
    if (!Number.isInteger(day) || day < 1 || day > length) fail('روز انتخاب‌شده در این ماه وجود ندارد.');
    const offset = month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30;
    const date = new Date(startOfJalaliYear(year) + (offset + day - 1) * DAY);
    const iso = date.toISOString().slice(0, 10);
    if (!validateDateISO(iso)) fail('این تاریخ خارج از محدودهٔ قابل ثبت است.');
    const roundTrip = toJalali(iso);
    if (roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day) fail('تبدیل تاریخ معتبر نیست.');
    return iso;
  }

  function validId(value, label) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value) || reservedIds.has(value)) fail((label || 'شناسه') + ' معتبر نیست.');
    return value;
  }

  function cleanText(value, maxLength, label, required) {
    if (typeof value !== 'string') fail(label + ' باید متن باشد.');
    const result = value.normalize('NFC').trim();
    if ((required && !result) || result.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) fail(label + ' معتبر نیست یا بیش از حد طولانی است.');
    return result;
  }

  function canonicalName(value) { return value.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').toLocaleLowerCase('fa-IR'); }

  function normalizeCategory(value) {
    if (!plain(value)) fail('اطلاعات دسته معتبر نیست.');
    const id = validId(value.id, 'شناسهٔ دسته');
    const name = cleanText(value.name, 60, 'نام دسته', true);
    if (/[\r\n\t]/.test(name)) fail('نام دسته باید در یک خط باشد.');
    if (value.type !== 'expense' && value.type !== 'income') fail('نوع دسته معتبر نیست.');
    if (typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color)) fail('رنگ دسته معتبر نیست.');
    const icon = value.icon == null ? 'wallet' : cleanText(value.icon, 32, 'نماد دسته', true);
    if (/[<>"'&\r\n\t]/.test(icon)) fail('نماد دسته معتبر نیست.');
    const budget = parseAmount(value.budget == null ? 0 : value.budget);
    const sourceBudgets = value.monthlyBudgets == null ? {} : value.monthlyBudgets;
    if (!plain(sourceBudgets) || Object.keys(sourceBudgets).length > 1200) fail('سقف‌های ماهانه معتبر نیستند.');
    const monthlyBudgets = {};
    for (const key of Object.keys(sourceBudgets)) {
      parseMonthKey(key);
      monthlyBudgets[key] = parseAmount(sourceBudgets[key]);
    }
    if (value.type === 'income' && (budget !== 0 || Object.values(monthlyBudgets).some(n => n !== 0))) fail('سقف ماهانه فقط برای دسته‌های هزینه است.');
    if (value.archived != null && typeof value.archived !== 'boolean') fail('وضعیت دسته معتبر نیست.');
    return { id, name, type: value.type, color: value.color.toLowerCase(), icon, budget, monthlyBudgets, archived: value.archived === true };
  }

  function newId() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return 'tx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function normalizeTransaction(input, categories, existing, imported) {
    if (!plain(input)) fail('اطلاعات تراکنش معتبر نیست.');
    const id = input.id == null && !imported ? newId() : validId(input.id, 'شناسهٔ تراکنش');
    if (input.type !== 'expense' && input.type !== 'income') fail('نوع تراکنش معتبر نیست.');
    const amount = parseAmount(input.amount);
    if (amount <= 0) fail('مبلغ تراکنش باید بیشتر از صفر باشد.');
    const categoryId = validId(input.categoryId, 'شناسهٔ دسته');
    const category = categories.get(categoryId);
    if (!category) fail('دستهٔ این تراکنش پیدا نشد.');
    if (category.type !== input.type) fail('نوع تراکنش با دستهٔ انتخاب‌شده هماهنگ نیست.');
    if (!imported && category.archived && (!existing || existing.categoryId !== categoryId)) fail('برای ثبت جدید، یک دستهٔ فعال انتخاب کن.');
    const date = digitsToLatin(input.date);
    if (!validateDateISO(date)) fail('تاریخ تراکنش معتبر نیست.');
    const note = cleanText(input.note == null && !imported ? '' : input.note, 1000, 'توضیح تراکنش', false);
    const createdAt = existing ? existing.createdAt : input.createdAt == null && !imported ? new Date().toISOString() : input.createdAt;
    if (typeof createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || !Number.isFinite(new Date(createdAt).getTime()) || new Date(createdAt).toISOString() !== createdAt) fail('زمان ثبت تراکنش معتبر نیست.');
    return { id, type: input.type, amount, categoryId, date, note, createdAt };
  }

  function checkedTotal(transactions, excludeId, extraAmount) {
    let total = extraAmount || 0;
    for (const transaction of transactions) {
      if (excludeId != null && transaction.id === excludeId) continue;
      total += transaction.amount;
      if (!Number.isSafeInteger(total)) fail('مجموع مبالغ از محدودهٔ محاسبهٔ دقیق بزرگ‌تر است.');
    }
    return total;
  }

  function validateTransaction(input, state) {
    if (!plain(state) || !Array.isArray(state.categories) || !Array.isArray(state.transactions)) fail('دفتر مالی معتبر نیست.');
    const existing = input && input.id ? state.transactions.find(t => t.id === input.id) : null;
    if (!existing && state.transactions.length >= MAX_TRANSACTIONS) fail('ظرفیت این دفتر پر شده؛ ابتدا خروجی پشتیبان بگیر.');
    const categories = new Map(state.categories.map(c => [c.id, c]));
    const result = normalizeTransaction(input, categories, existing, false);
    checkedTotal(state.transactions, existing ? existing.id : null, result.amount);
    return result;
  }

  function validateState(value) {
    if (!plain(value) || value.version !== 1) fail('این فایل، پشتیبان معتبر نسخهٔ فعلی دخل نیست.');
    if (!Array.isArray(value.categories) || value.categories.length > MAX_CATEGORIES || !Array.isArray(value.transactions) || value.transactions.length > MAX_TRANSACTIONS) fail('تعداد دسته‌ها یا تراکنش‌های فایل معتبر نیست.');
    const categories = value.categories.map(normalizeCategory);
    const categoryMap = new Map();
    const categoryNames = new Set();
    for (const category of categories) {
      if (categoryMap.has(category.id)) fail('شناسهٔ تکراری در دسته‌ها وجود دارد.');
      const nameKey = category.type + ':' + canonicalName(category.name);
      if (categoryNames.has(nameKey)) fail('نام تکراری در دسته‌های هم‌نوع وجود دارد.');
      categoryMap.set(category.id, category);
      categoryNames.add(nameKey);
    }
    const transactionIds = new Set();
    const transactions = value.transactions.map(input => {
      const transaction = normalizeTransaction(input, categoryMap, null, true);
      if (transactionIds.has(transaction.id)) fail('شناسهٔ تکراری در تراکنش‌ها وجود دارد.');
      transactionIds.add(transaction.id);
      return transaction;
    });
    checkedTotal(transactions);
    if (value.meta != null && (!plain(value.meta) || (value.meta.demo != null && typeof value.meta.demo !== 'boolean'))) fail('اطلاعات پشتیبان معتبر نیست.');
    return { version: 1, categories, transactions, meta: { demo: !!(value.meta && value.meta.demo) } };
  }

  function emptyState() {
    const defaults = [
      ['food', 'خوراک', 'expense', '#42846b', 'food'],
      ['transport', 'رفت‌وآمد', 'expense', '#e2ae53', 'transport'],
      ['home', 'خانه و قبوض', 'expense', '#7189bb', 'home'],
      ['shopping', 'خرید شخصی', 'expense', '#b087ad', 'shopping'],
      ['health', 'سلامت', 'expense', '#d88172', 'health'],
      ['entertainment', 'تفریح', 'expense', '#8a9e6a', 'entertainment'],
      ['salary', 'حقوق', 'income', '#42846b', 'salary'],
      ['freelance', 'کار آزاد', 'income', '#7189bb', 'freelance']
    ];
    return {
      version: 1,
      categories: defaults.map(c => ({ id: c[0], name: c[1], type: c[2], color: c[3], icon: c[4], budget: 0, monthlyBudgets: {}, archived: false })),
      transactions: [], meta: { demo: false }
    };
  }

  function demoState(referenceISO) {
    const reference = referenceISO == null ? todayISO() : referenceISO;
    const current = toJalali(reference);
    const currentKey = monthKey(reference);
    const previousKey = shiftMonth(currentKey, -1);
    const previous = parseMonthKey(previousKey);
    const state = emptyState();
    state.meta.demo = true;
    const budgets = { food: 4000000, transport: 1500000, home: 8000000, shopping: 2000000, health: 1000000, entertainment: 1200000 };
    for (const category of state.categories) category.budget = budgets[category.id] || 0;
    const entries = [
      ['salary', 32000000, 1, 'حقوق این ماه'],
      ['home', 6000000, 2, 'اجارهٔ خانه'],
      ['food', 1350000, 4, 'خرید هفتگی خانه'],
      ['transport', 420000, 6, 'تاکسی و مترو'],
      ['food', 750000, 9, 'خرید میوه و سبزیجات'],
      ['health', 450000, 12, 'دارو و ویزیت'],
      ['freelance', 7500000, 14, 'پروژهٔ طراحی'],
      ['shopping', 2450000, 17, 'کفش روزمره'],
      ['food', 860000, 20, 'خرید سوپرمارکت'],
      ['home', 950000, 22, 'قبض‌ها و اینترنت'],
      ['entertainment', 920000, 24, 'سینما و کافه با دوستان'],
      ['transport', 260000, 26, 'رفت‌وآمد هفته'],
      ['food', 470000, 28, 'ناهار بیرون']
    ];
    const previousEntries = [
      ['salary', 30000000, 1, 'حقوق ماه قبل'],
      ['home', 6000000, 2, 'اجارهٔ ماه قبل'],
      ['food', 2870000, 8, 'خریدهای خانه'],
      ['transport', 980000, 12, 'رفت‌وآمد ماه قبل'],
      ['freelance', 4000000, 17, 'پروژهٔ ماه قبل'],
      ['shopping', 1450000, 19, 'خرید لباس'],
      ['entertainment', 780000, 25, 'تفریح آخر هفته']
    ];
    function append(rows, parts, prefix, maxDay) {
      rows.forEach((row, index) => {
        const category = state.categories.find(c => c.id === row[0]);
        const day = Math.min(row[2], maxDay, daysInJalaliMonth(parts.year, parts.month));
        const date = gregorianFromJalali(parts.year, parts.month, day);
        state.transactions.push({ id: 'demo-' + prefix + '-' + String(index + 1).padStart(2, '0'), type: category.type, amount: row[1], categoryId: category.id, date, note: row[3], createdAt: date + 'T12:' + String(index).padStart(2, '0') + ':00.000Z' });
      });
    }
    append(previousEntries, previous, 'previous', 31);
    append(entries, current, 'current', current.day);
    return validateState(state);
  }

  function monthTransactions(state, key) {
    parseMonthKey(key);
    return state.transactions.filter(t => monthKey(t.date) === key);
  }

  function categoryBudget(category, key) {
    parseMonthKey(key);
    if (category.type !== 'expense') return 0;
    return category.monthlyBudgets && own(category.monthlyBudgets, key) ? category.monthlyBudgets[key] : category.budget || 0;
  }

  function budgetStatus(spent, limit) {
    if (!Number.isSafeInteger(spent) || spent < 0 || !Number.isSafeInteger(limit) || limit < 0) fail('مبلغ هزینه یا سقف معتبر نیست.');
    if (limit === 0) return { ratio: 0, percent: 0, status: 'none', remaining: null };
    const ratio = spent / limit;
    // Exact integer comparison avoids rounding around 80%, even near MAX_SAFE_INTEGER.
    const threshold = Math.floor(limit / 5) * 4 + Math.floor((limit % 5) * 4 / 5);
    const status = spent > limit ? 'exceeded' : spent === limit ? 'full' : spent > threshold ? 'warning' : 'ok';
    return { ratio, percent: ratio * 100, status, remaining: limit - spent };
  }

  function summarize(state, key) {
    const transactions = monthTransactions(state, key);
    let income = 0;
    let expense = 0;
    const aggregates = new Map();
    for (const transaction of transactions) {
      if (transaction.type === 'income') income += transaction.amount;
      else {
        expense += transaction.amount;
        const entry = aggregates.get(transaction.categoryId) || { amount: 0, count: 0 };
        entry.amount += transaction.amount;
        entry.count++;
        aggregates.set(transaction.categoryId, entry);
      }
      if (!Number.isSafeInteger(income) || !Number.isSafeInteger(expense)) fail('مجموع مبالغ از محدودهٔ محاسبهٔ دقیق بزرگ‌تر است.');
    }
    const byCategory = state.categories.filter(c => c.type === 'expense').map(category => {
      const entry = aggregates.get(category.id) || { amount: 0, count: 0 };
      const budget = categoryBudget(category, key);
      return { category, amount: entry.amount, count: entry.count, budget, ...budgetStatus(entry.amount, budget) };
    }).sort((a, b) => b.amount - a.amount || a.category.name.localeCompare(b.category.name, 'fa'));
    return { income, expense, balance: income - expense, count: transactions.length, byCategory };
  }

  function csvCell(value, protectFormula) {
    let text = String(value == null ? '' : value);
    if (protectFormula && /^[\s\u0000-\u001f\u007f\u200e\u200f\u061c]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCSV(state, transactions) {
    const rows = transactions == null ? state.transactions : transactions;
    if (!Array.isArray(rows)) fail('تراکنش‌های خروجی معتبر نیستند.');
    const categories = new Map(state.categories.map(c => [c.id, c]));
    const header = ['تاریخ شمسی', 'تاریخ میلادی', 'نوع', 'دسته', 'مبلغ (تومان)', 'توضیح'].map(v => csvCell(v, false)).join(',');
    const lines = rows.map(transaction => {
      const category = categories.get(transaction.categoryId);
      if (!category || !Number.isSafeInteger(transaction.amount) || transaction.amount <= 0) fail('یکی از تراکنش‌های خروجی معتبر نیست.');
      const p = toJalali(transaction.date);
      const jalali = (String(p.year).padStart(4, '0') + '/' + String(p.month).padStart(2, '0') + '/' + String(p.day).padStart(2, '0')).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
      return [csvCell(jalali, true), csvCell(transaction.date, true), csvCell(transaction.type === 'income' ? 'درآمد' : 'هزینه', true), csvCell(category.name, true), String(transaction.amount), csvCell(transaction.note, true)].join(',');
    });
    return '\uFEFF' + header + '\r\n' + lines.join('\r\n') + (lines.length ? '\r\n' : '');
  }

  return Object.freeze({
    digitsToLatin, parseAmount, formatNumber, escapeHtml, todayISO, toJalali,
    monthKey, monthLabel, shiftMonth, gregorianFromJalali, daysInJalaliMonth,
    validateDateISO, validateTransaction, validateState, emptyState, demoState,
    monthTransactions, categoryBudget, budgetStatus, summarize, exportCSV,
    MONTHS: Object.freeze(MONTHS.slice()), MAX_CATEGORIES, MAX_TRANSACTIONS
  });
});
