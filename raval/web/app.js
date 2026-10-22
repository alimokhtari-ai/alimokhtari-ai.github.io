'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const fa = new Intl.NumberFormat('fa-IR');
const stageTitles = ['دریافت پیام', 'تشخیص مدل و سال', 'خواندن ردیف منبع', 'محاسبهٔ اقساط', 'ساخت پیام مؤدبانه', 'کنترل نهایی'];
const stageHints = ['پیام و شناسهٔ درخواست', 'ابهام و سابقهٔ همین گفت‌وگو', 'تطبیق دقیق با فایل CSV', 'محاسبهٔ قطعی با Decimal', 'عبارت‌های تأییدشده + دادهٔ جدول', 'قیمت، منبع و جمع بازپرداخت'];
const statusLabels = {quote: 'پیش‌فاکتور آماده', clarify: 'منتظر پاسخ مشتری', alternatives: 'گزینه‌های جایگزین', blocked: 'صدور متوقف شد', welcome: 'آمادهٔ گفت‌وگو'};
const stateLabels = {passed: 'انجام شد', waiting: 'نیاز به پاسخ', blocked: 'متوقف', skipped: 'اجرا نشد'};
let config = null;
let catalog = null;
let latest = null;
let busy = false;
let editing = false;
let editVersion = null;
let draft = [];
let pending = null;
let toastTimer;
let chatId;
try {
  chatId = localStorage.getItem('raval.chat.v1');
  if (!chatId || !/^web:[a-zA-Z0-9_-]+$/.test(chatId)) {
    chatId = 'web:' + crypto.randomUUID();
    localStorage.setItem('raval.chat.v1', chatId);
  }
} catch (_) { chatId = 'web:' + crypto.randomUUID(); }

function node(tag, cls, text) {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text !== undefined && text !== null) item.textContent = text;
  return item;
}
function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + id);
  svg.append(use);
  return svg;
}
function digits(value) { return String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]); }
function latin(value) { return String(value).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٬,\s]/g, ''); }
function money(value) {
  try { return fa.format(BigInt(latin(value))); } catch (_) { return '—'; }
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
async function api(path, data) {
  const options = data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)};
  const response = await fetch(path, {...options, signal: AbortSignal.timeout(65000)});
  let payload;
  try { payload = await response.json(); } catch (_) { throw new Error('پاسخ سرویس قابل خواندن نیست.'); }
  if (!response.ok) {
    const error = new Error(payload.error || 'درخواست انجام نشد.');
    error.status = response.status;
    throw error;
  }
  return payload;
}
function networkMessage(error) {
  return error.status ? error.message : 'ارتباط با سرویس محلی قطع شد. Python را باز نگه دار و همین پیام را دوباره بفرست.';
}
function showView(view) {
  if (!['run', 'catalog', 'about'].includes(view)) return;
  $$('.view').forEach(section => { section.hidden = section.id !== 'view-' + view; });
  $$('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    if (button.classList.contains('tab')) {
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  });
  if (view === 'catalog' && !editing) loadCatalog().catch(error => toast(networkMessage(error)));
}
function renderTrace(response = null) {
  const list = $('#traceList');
  list.replaceChildren();
  const stages = response?.trace || stageTitles.map((title, index) => ({title, detail: stageHints[index], state: '', elapsed_ms: null}));
  stages.forEach((stage, index) => {
    const item = node('li', 'trace-step ' + (stage.state || ''));
    const number = node('span', 'step-number');
    if (stage.state === 'passed') number.append(icon('check'));
    else number.textContent = fa.format(index + 1);
    const text = node('div', 'step-text');
    text.append(node('strong', '', stage.title || stageTitles[index]), node('p', '', stage.detail || stageHints[index]));
    item.append(number, text, node('span', 'step-state', stateLabels[stage.state] || 'آماده'));
    list.append(item);
  });
  const badge = $('#traceStatus');
  badge.textContent = response ? (statusLabels[response.status] || 'اجرا شد') : 'آمادهٔ شروع';
  badge.className = 'badge ' + (!response ? 'neutral' : response.status === 'quote' ? 'success' : response.status === 'blocked' ? 'blocked' : 'waiting');
  if (response) {
    const total = response.trace.reduce((sum, stage) => sum + (Number(stage.elapsed_ms) || 0), 0);
    const duration = total < 1 ? 'کمتر از ۱' : fa.format(Math.round(total));
    $('#traceTime').textContent = `زمان مراحل: ${duration} میلی‌ثانیه${response.cached ? ' · نتیجهٔ ذخیره‌شدهٔ همین درخواست' : ''}`;
  } else $('#traceTime').textContent = 'زمان هر مرحله بعد از اجرا ثبت می‌شود.';
  $('#exportTrace').disabled = !response;
}
function financeItem(label, amount) {
  const item = node('div', 'finance-item');
  const value = node('strong', '', money(amount));
  value.append(node('small', '', ' تومان'));
  item.append(node('span', '', label), value);
  return item;
}
function renderQuote(response) {
  const container = $('#quoteContent');
  container.replaceChildren();
  const quote = response?.quote;
  if (!quote) {
    container.className = 'quote-empty';
    const explanation = !response ? 'با مشخص‌شدن مدل و سال، مبلغ دقیق و ردیف منبع اینجا نمایش داده می‌شود.' : response.status === 'clarify' ? 'فعلاً پیش‌فاکتوری صادر نشده. منتظر مشخص‌شدن مدل، سال یا تأیید مشتری هستیم.' : response.status === 'alternatives' ? 'برای این درخواست تطبیق دقیق نداریم. مشتری باید یکی از گزینه‌های واقعی جدول را انتخاب کند.' : response.status === 'blocked' ? 'کنترل‌های اعتبارسنجی اجازهٔ صدور پیش‌فاکتور ندادند. جزئیات در مسیر اجرای درخواست آمده است.' : 'برای شروع، مدل و سال خودرو را بنویس.';
    const assurance = node('div', 'assurance');
    assurance.append(icon('lock'), document.createTextNode('مدل به قیمت و شرایط اقساط دسترسی ندارد.'));
    container.append(node('p', '', explanation), assurance);
    return;
  }
  container.className = 'quote-details';
  const name = node('div', 'quote-car');
  name.append(icon('car'), document.createTextNode(`${digits(quote.model)} · مدل ${fa.format(quote.year).replace(/٬/g, '')}`));
  const price = node('div', 'quote-price', money(quote.price_toman));
  price.id = 'exactPrice';
  price.append(node('small', '', 'تومان'));
  const provenance = node('div', 'quote-provenance');
  provenance.append(icon('check'), document.createTextNode(`عین قیمت ردیف ${fa.format(quote.source_row)} در CSV`), node('bdi', 'hash', String(quote.source_version).slice(0, 12)));
  const grid = node('div', 'finance-grid');
  grid.append(financeItem(`پیش‌پرداخت · ${digits(quote.down_payment_percent)}٪`, quote.down_payment_toman), financeItem(`قسط ماهانه · ${fa.format(quote.installments)} ماه`, quote.monthly_payment_toman), financeItem('قسط آخر پس از تسویهٔ مانده', quote.final_payment_toman), financeItem('جمع کل با پیش‌پرداخت', quote.total_paid_toman));
  const note = node('p', 'quote-note', `نرخ سالانهٔ اسمی ${digits(quote.annual_rate_percent)}٪، ماندهٔ نزولی؛ فقط مبالغ محاسبه‌شده گرد می‌شوند. هزینهٔ بیمه و کارمزد لحاظ نشده است.${quote.condition_note ? ' ' + quote.condition_note : ''}`);
  const actions = node('div', 'quote-actions');
  const schedule = node('button', 'text-btn', 'جدول بازپرداخت');
  schedule.type = 'button'; schedule.id = 'showSchedule'; schedule.append(icon('arrow')); schedule.addEventListener('click', () => showSchedule(quote));
  const copy = node('button', 'text-btn', 'کپی پیش‌فاکتور');
  copy.type = 'button'; copy.id = 'copyQuote'; copy.append(icon('copy')); copy.addEventListener('click', () => copyText(response.reply));
  actions.append(schedule, copy);
  container.append(name, price, provenance, grid, note, actions);
}
function showSchedule(quote) {
  const body = $('#scheduleBody'); body.replaceChildren();
  quote.payment_schedule.forEach(payment => {
    const row = node('tr');
    row.append(node('td', '', fa.format(payment.number)), ...['payment_toman', 'interest_toman', 'principal_toman', 'balance_toman'].map(field => node('td', 'numeric', money(payment[field]))));
    body.append(row);
  });
  $('#scheduleSummary').textContent = `اصل تسهیلات: ${money(quote.principal_toman)} · کل سود: ${money(quote.total_interest_toman)} · جمع اقساط: ${money(quote.total_installments_toman)} تومان`;
  $('#scheduleDialog').showModal();
}
function formatTime(timestamp) {
  try { return new Intl.DateTimeFormat('fa-IR', {hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran'}).format(new Date(timestamp)); }
  catch (_) { return ''; }
}
function appendMessage(role, text, response) {
  $('#chatEmpty')?.remove();
  const element = node('article', 'message ' + role);
  element.dataset.role = role;
  if (response) element.dataset.status = response.status;
  const meta = node('div', 'message-meta');
  meta.append(node('span', '', role === 'user' ? 'مشتری · شبیه‌ساز' : 'روال'));
  if (response) meta.append(node('span', '', response.mode === 'live' ? 'حالت Groq' : response.mode === 'fallback' ? 'مسیر جایگزین' : 'حالت نمونه'));
  if (response?.timestamp) meta.append(node('span', '', formatTime(response.timestamp)));
  const bubble = node('div', 'bubble', text);
  element.append(meta, bubble);
  if (response?.options?.length) {
    const options = node('div', 'message-options');
    response.options.forEach(option => {
      const button = node('button', 'option-btn', digits(option.label));
      button.type = 'button';
      button.addEventListener('click', () => send(option.text));
      options.append(button);
    });
    element.append(options);
  }
  $('#chatLog').append(element);
  return element;
}
function scrollChat() { $('#chatLog').scrollTo({top: $('#chatLog').scrollHeight, behavior: 'instant'}); }
function refreshMode(response) {
  if (!response) return;
  if (response.mode === 'fallback') toast('مدل در دسترس نبود یا خروجی معتبر نداد؛ این پاسخ با مسیر جایگزین ساخته شد.');
}
function setBusy(value) {
  busy = value;
  $('#sendBtn').disabled = value || !config;
  $('#resetChat').disabled = value;
  $$('[data-query]').forEach(button => { button.disabled = value || !config; });
  $('#message').setAttribute('aria-busy', String(value));
  if (value) {
    renderTrace();
    $('#traceStatus').textContent = 'در حال پردازش';
    $('#traceTime').textContent = 'منتظر پاسخ واقعی سرویس Python…';
    renderQuote(null);
  }
}
async function send(text) {
  text = String(text || '').trim();
  if (busy || !config || !text) return;
  if (text.length > 2000) { toast('پیام باید حداکثر ۲۰۰۰ نویسه باشد.'); return; }
  showView('run');
  $$('.option-btn').forEach(button => { button.disabled = true; });
  if (!pending || pending.text !== text) {
    pending = {text, request_id: crypto.randomUUID()};
    appendMessage('user', text);
  }
  setBusy(true);
  scrollChat();
  try {
    const response = await api('/api/message', {text, chat_id: chatId, request_id: pending.request_id});
    latest = response;
    appendMessage('assistant', response.reply, response);
    renderTrace(response);
    renderQuote(response);
    refreshMode(response);
    pending = null;
    $('#message').value = '';
    scrollChat();
  } catch (error) {
    toast(networkMessage(error));
    $('#message').value = text;
    $('#traceStatus').textContent = 'پاسخ دریافت نشد';
    $('#traceStatus').className = 'badge blocked';
    $('#traceTime').textContent = 'این درخواست نتیجهٔ تأییدشده ندارد؛ دوباره تلاش کن.';
    if (error.status) pending = null;
  } finally {
    setBusy(false);
    if (window.matchMedia('(min-width: 651px)').matches) $('#message').focus({preventScroll: true});
  }
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('متن پیش‌فاکتور کپی شد.'); }
  catch (_) { download('RAVAL-quote.txt', text, 'text/plain;charset=utf-8'); toast('دسترسی کپی نبود؛ فایل متن دریافت شد.'); }
}
function download(name, content, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const anchor = node('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderCatalog() {
  if (!catalog) return;
  $('#editCatalog').disabled = false;
  const body = $('#catalogBody'); body.replaceChildren();
  const rows = editing ? draft : catalog.rows;
  rows.forEach((row, index) => {
    const tr = node('tr');
    tr.append(node('td', 'row-number', fa.format(index + 2)));
    const fields = ['model', 'year', 'price_toman', 'down_payment_percent', 'installments'];
    fields.forEach(field => {
      const cell = node('td', field === 'model' ? 'model-name' : 'numeric');
      if (editing) {
        const input = node('input');
        input.type = 'text'; input.value = field === 'model' ? row[field] : digits(row[field]);
        input.dataset.field = field;
        input.setAttribute('aria-label', `${field === 'model' ? 'خودرو' : field === 'year' ? 'سال' : field === 'price_toman' ? 'قیمت' : field === 'down_payment_percent' ? 'درصد پیش‌پرداخت' : 'تعداد اقساط'} ردیف ${index + 2}`);
        if (field !== 'model') input.inputMode = field === 'down_payment_percent' ? 'decimal' : 'numeric';
        input.maxLength = field === 'model' ? 80 : 22;
        input.addEventListener('input', () => { draft[index][field] = field === 'model' ? input.value : latin(input.value).replace('٫', '.'); });
        cell.append(input);
      } else {
        cell.textContent = field === 'price_toman' ? money(row[field]) : field === 'year' ? digits(row[field]) : field === 'down_payment_percent' ? digits(row[field]) + '٪' : field === 'installments' ? fa.format(row[field]) + ' ماه' : digits(row[field]);
      }
      tr.append(cell);
    });
    const action = node('td');
    const button = node('button', editing ? 'remove-row' : 'table-query', editing ? 'حذف' : 'استعلام ←');
    button.type = 'button';
    if (editing) button.addEventListener('click', () => { draft.splice(index, 1); renderCatalog(); });
    else button.addEventListener('click', () => send(`${row.model} مدل ${row.year} قیمت و اقساطش چقدر است؟`));
    action.append(button); tr.append(action); body.append(tr);
  });
  $('#catalogVersion').textContent = catalog.version.slice(0, 16);
  $('#editorActions').hidden = !editing;
  $('#editCatalog').hidden = editing;
  $('#rowCount').textContent = fa.format(catalog.rows.length);
}
async function loadCatalog() { catalog = await api('/api/catalog'); renderCatalog(); }
async function saveCatalog() {
  if (!editing || !editVersion) return;
  $('#saveCatalog').disabled = true;
  $$('#catalogBody input, #catalogBody button, #cancelEdit, #addRow').forEach(control => { control.disabled = true; });
  $('#catalogError').hidden = true;
  try {
    catalog = await api('/api/catalog', {rows: draft, expected_version: editVersion});
    editing = false; editVersion = null; draft = []; renderCatalog();
    toast('جدول ذخیره شد. درخواست بعدی قیمت تازه را از همین فایل می‌خواند.');
  } catch (error) {
    $('#catalogError').textContent = networkMessage(error) + (error.status === 409 ? ' برای بارگیری نسخهٔ تازه، انصراف را بزن.' : '');
    $('#catalogError').hidden = false;
  } finally { $('#saveCatalog').disabled = false; $$('#catalogBody input, #catalogBody button, #cancelEdit, #addRow').forEach(control => { control.disabled = false; }); }
}
async function resetChat() {
  if (busy) return;
  try {
    await api('/api/reset', {chat_id: chatId});
    $('#chatLog').replaceChildren();
    const empty = node('div', 'chat-empty'); empty.id = 'chatEmpty';
    const symbol = node('span', 'empty-symbol'); symbol.append(icon('car'));
    empty.append(symbol, node('h3', '', 'از یک سؤال تازه شروع کن'), node('p', '', 'سابقه و زمینهٔ این گفت‌وگو پاک شد. جدول قیمت تغییری نکرده است.'));
    $('#chatLog').append(empty);
    latest = null; pending = null; renderTrace(); renderQuote(null); $('#message').value = '';
    toast('گفت‌وگوی تازه آماده است.');
  } catch (error) { toast(networkMessage(error)); }
}
async function initialize() {
  setBusy(false);
  try {
    const [cfg, cat, history] = await Promise.all([api('/api/config'), api('/api/catalog'), api('/api/history?chat_id=' + encodeURIComponent(chatId))]);
    config = cfg; catalog = cat;
    $('#connectionError').hidden = true;
    $('#serverStatus').className = 'server-status ready';
    $('#serverStatus span:last-child').textContent = 'سرویس محلی فعال';
    $('#annualRate').textContent = digits(cfg.rate) + '٪';
    $('#aboutRate').textContent = digits(cfg.rate) + '٪';
    $('#aboutModel').textContent = cfg.mode === 'live' ? 'Groq · فعال در تنظیمات' : cfg.mode === 'fallback' ? 'مسیر جایگزین · تنظیم مدل نامعتبر' : 'خروجی نمونه و قواعد';
    if (cfg.mode === 'live') {
      $('#modeNotice').classList.add('live');
      $('#modeNotice p').textContent = 'اتصال Groq در تنظیمات فعال است. وضعیت واقعی هر فراخوانی در مسیر اجرا ثبت می‌شود. این صفحه همچنان شبیه‌ساز پیام تلگرام است.';
    } else if (cfg.mode === 'fallback') {
      $('#modeNotice p').textContent = 'تنظیم مدل آماده نیست؛ مسیر جایگزینِ قواعد فعال است. منطق، CSV و محاسبات واقعی‌اند. این صفحه شبیه‌ساز تلگرام است.';
    }
    renderCatalog();
    if (history.history.length) {
      $('#chatLog').replaceChildren();
      history.history.forEach(entry => { appendMessage('user', entry.text); appendMessage('assistant', entry.response.reply, entry.response); });
      $$('.option-btn').forEach(button => { button.disabled = true; });
      const lastMessage = $$('.message.assistant').at(-1);
      $$('.option-btn', lastMessage).forEach(button => { button.disabled = false; });
      latest = history.history.at(-1).response; renderTrace(latest); renderQuote(latest); scrollChat();
    }
    setBusy(false);
  } catch (_) {
    config = null;
    $('#connectionError').hidden = false;
    $('#serverStatus').className = 'server-status error';
    $('#serverStatus span:last-child').textContent = 'سرویس در دسترس نیست';
    setBusy(false);
  }
}

$$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$$('[data-query]').forEach(button => button.addEventListener('click', () => send(button.dataset.query)));
$('#messageForm').addEventListener('submit', event => { event.preventDefault(); send($('#message').value); });
$('#message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send($('#message').value); } });
$('#resetChat').addEventListener('click', resetChat);
$('#reconnect').addEventListener('click', initialize);
$('#exportTrace').addEventListener('click', () => { if (latest) download('RAVAL-execution.json', JSON.stringify(latest, null, 2), 'application/json;charset=utf-8'); });
$('#editCatalog').disabled = true;
$('#editCatalog').addEventListener('click', () => { if (!catalog) { toast('جدول قیمت هنوز بارگیری نشده است.'); return; } editing = true; editVersion = catalog.version; draft = catalog.rows.map(row => ({...row})); $('#catalogError').hidden = true; renderCatalog(); });
$('#cancelEdit').addEventListener('click', async () => { editing = false; editVersion = null; draft = []; $('#catalogError').hidden = true; renderCatalog(); try { await loadCatalog(); } catch (error) { toast(networkMessage(error)); } });
$('#saveCatalog').addEventListener('click', saveCatalog);
$('#addRow').addEventListener('click', () => { if (draft.length >= 200) { toast('حداکثر ۲۰۰ ردیف پشتیبانی می‌شود.'); return; } draft.push({model: '', year: '', price_toman: '', down_payment_percent: '', installments: ''}); renderCatalog(); $$('#catalogBody input').at(-5)?.focus(); });
$('#closeSchedule').addEventListener('click', () => $('#scheduleDialog').close());
$('#scheduleDialog').addEventListener('click', event => { if (event.target === $('#scheduleDialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
renderTrace();
initialize();
