/* Dakhl UI. No network, no third-party code. Plain DOM + native dialog. */
(function () {
  'use strict';
  const C = window.DakhlCore;
  const KEY = 'dakhl.vc005.v1';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const E = C.escapeHtml;
  const N = C.formatNumber;
  const icons = {
    wallet:'<path d="M4 7h15v13H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13v3M15 11h7v6h-7z"/><path d="M18 14h.01"/>',
    overview:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="11" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="18" width="7" height="3" rx="1.5"/>',
    list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
    database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
    upload:'<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01"/>',
    'chevron-right':'<path d="m9 5 7 7-7 7"/>', 'chevron-left':'<path d="m15 5-7 7 7 7"/>', 'chevron-down':'<path d="m6 9 6 6 6-6"/>',
    'arrow-up-left':'<path d="M17 17 7 7m0 9V7h9"/>',
    'arrow-down-left':'<path d="M17 7 7 17m0-9v9h9"/>',
    'arrow-up-right':'<path d="M7 17 17 7m0 9V7H8"/>',
    minus:'<path d="M5 12h14"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    edit:'<path d="m14 5 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14z"/>',
    trash:'<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    alert:'<path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
    food:'<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M18 3c-3 3-3 7 0 9h2V3zM20 12v9"/>',
    transport:'<path d="m4 9 2-5h12l2 5M3 9h18v9H3zM6 18v3M18 18v3M6 13h2M16 13h2"/>',
    home:'<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
    shopping:'<path d="M5 7h14l2 14H3zM8 8V6a4 4 0 0 1 8 0v2"/>',
    health:'<rect x="3" y="6" width="18" height="15" rx="3"/><path d="M8 6V3h8v3M9 13h6M12 10v6"/>',
    entertainment:'<path d="M4 5h16v10a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM20 7h2v6h-2M8 2v1M12 2v1M16 2v1"/>',
    salary:'<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V3h8v4M3 12a24 24 0 0 0 18 0M10 13h4v3h-4z"/>',
    freelance:'<path d="M4 4h16v12H4zM2 20h20M8 16v4M16 16v4M9 8l-2 2 2 2M15 8l2 2-2 2"/>',
    archive:'<path d="M4 8v13h16V8M2 3h20v5H2zM9 12h6"/>',
    refresh:'<path d="M20 6v6h-6M4 18v-6h6M5 7a8 8 0 0 1 14-1M19 17A8 8 0 0 1 5 18"/>',
    chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    file:'<path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h8"/>',
    spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>'
  };
  function icon(name) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.wallet) + '</svg>'; }
  function fillIcons(root = document) { $$('[data-icon]', root).forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  let state = C.emptyState();
  let storageAvailable = true;
  let corruptData = null;
  let selectedMonth = C.monthKey(C.todayISO());
  let activeView = 'dashboard';
  let filters = { search: '', type: 'all', category: 'all' };
  let visibleLimit = 100;
  let dialogReturnFocus = null;
  let dialogMode = null;
  let currentEditId = null;
  let transactionType = 'expense';
  let categoryColor = '#42846b';
  let categoryType = 'expense';
  let confirmCallback = null;
  let toastTimer;
  let undoAction = null;
  let importPending = null;
  let lastSavedRaw = null;

  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
      if (raw) {
        try { state = C.validateState(JSON.parse(raw)); lastSavedRaw = raw; }
        catch (error) { corruptData = raw; state = C.emptyState(); }
      }
      const probe = KEY + '.probe'; localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
    } catch (error) { storageAvailable = false; }
  }
  function storageNotice(message) {
    const el = $('#storage-warning');
    if (message) { el.hidden = false; el.innerHTML = icon('alert') + '<span>' + E(message) + '</span>'; }
    else el.hidden = true;
  }
  function refreshStorageNotice() {
    $('#storage-status').textContent = storageAvailable ? 'ذخیره در مرورگر' : 'ذخیرهٔ مرورگر در دسترس نیست';
    if (corruptData !== null) storageNotice('اطلاعات قبلی قابل خواندن نیست و دست‌نخورده نگه داشته شده. از «خروجی و پشتیبان» فایل قبلی رو بگیر و پشتیبان سالم رو برگردون یا دفتر خالی بساز.');
    else if (!storageAvailable) storageNotice('مرورگر اجازهٔ ذخیره نمی‌ده یا فضای آن پر شده. تغییر جدید ذخیره نمی‌شه؛ از اطلاعات فعلی پشتیبان بگیر و تنظیمات مرورگر رو بررسی کن.');
    else storageNotice('');
  }
  function commit(mutator, options = {}) {
    if (corruptData !== null && !options.recovery) throw new Error('اول اطلاعات قبلی رو از بخش خروجی و پشتیبان بازیابی کن.');
    let working = clone(state);
    // Merge operations against the latest persisted state to avoid stale tab overwrites.
    if (!options.replace && corruptData === null) {
      try {
        const latest = localStorage.getItem(KEY);
        if (latest !== lastSavedRaw) working = latest === null ? C.emptyState() : C.validateState(JSON.parse(latest));
      } catch (error) { if (error.name !== 'SecurityError') throw new Error('اطلاعات مرورگر در تب دیگری تغییر کرده یا معتبر نیست. صفحه رو دوباره باز کن.'); }
    }
    const replacement = mutator(working);
    const next = C.validateState(replacement || working);
    const raw = JSON.stringify(next);
    try { localStorage.setItem(KEY, raw); }
    catch (error) { storageAvailable = false; refreshStorageNotice(); throw new Error('ذخیره انجام نشد؛ فضای مرورگر یا اجازهٔ ذخیره رو بررسی کن. اطلاعات قبلی حفظ شده.'); }
    state = next; lastSavedRaw = raw; storageAvailable = true; corruptData = null;
    refreshStorageNotice();
    return next;
  }
  function setMonth(key) { selectedMonth = key; filters = { search:'', type:'all', category:'all' }; visibleLimit = 100; render(); }
  function nav(view) { activeView = view; visibleLimit = 100; render(); window.scrollTo({top:0,behavior:'instant'}); }
  function dateText(iso, full = false) {
    const p = C.toJalali(iso);
    return N(p.day) + ' ' + C.MONTHS[p.month - 1] + (full ? ' ' + String(p.year).replace(/\d/g, n => '۰۱۲۳۴۵۶۷۸۹'[+n]) : '');
  }
  function percentage(value) { return N(Math.round(value * 10) / 10) + '٪'; }
  function budgetStatusText(row) {
    if (row.status === 'none') return 'هنوز سقفی مشخص نکردی';
    if (row.status === 'exceeded') return N(-row.remaining) + ' تومان بیشتر از سقف';
    if (row.status === 'full') return 'تمام سقف این ماه استفاده شده';
    if (row.status === 'warning') return 'از ۸۰٪ سقف گذشتی · ' + N(row.remaining) + ' تومان باقی مونده';
    return N(row.remaining) + ' تومان تا سقف باقی مونده';
  }
  function categoryIcon(category) { return '<span class="category-icon" style="--cat-color:' + category.color + ';--cat-soft:' + category.color + '13">' + icon(category.icon) + '</span>'; }
  function getMonthRows() { return C.monthTransactions(state, selectedMonth).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)); }
  function filteredRows() {
    const term = filters.search.trim().normalize('NFC').replace(/ي/g,'ی').replace(/ك/g,'ک').toLocaleLowerCase('fa');
    return getMonthRows().filter(t => {
      const cat = state.categories.find(c => c.id === t.categoryId);
      const text = (t.note + ' ' + (cat ? cat.name : '') + ' ' + t.amount + ' ' + N(t.amount)).normalize('NFC').replace(/ي/g,'ی').replace(/ك/g,'ک').toLocaleLowerCase('fa');
      return (filters.type === 'all' || t.type === filters.type) && (filters.category === 'all' || t.categoryId === filters.category) && (!term || text.includes(term));
    });
  }
  function updateMonthSelect() {
    const current = C.monthKey(C.todayISO());
    const keys = new Set([selectedMonth,current]);
    for (let offset=-36; offset<=24; offset++) keys.add(C.shiftMonth(current,offset));
    state.transactions.forEach(t => keys.add(C.monthKey(t.date)));
    state.categories.forEach(c => Object.keys(c.monthlyBudgets).forEach(k => keys.add(k)));
    $('#month-select').innerHTML = [...keys].sort().reverse().map(k => '<option value="'+k+'"'+(k===selectedMonth?' selected':'')+'>'+E(C.monthLabel(k))+'</option>').join('');
    $('#current-month-button').hidden = selectedMonth === current;
    $('#period-description').textContent = N(C.monthTransactions(state,selectedMonth).length) + ' تراکنش در این ماه';
  }
  function statsHtml(s) {
    const incomeCount = C.monthTransactions(state,selectedMonth).filter(t=>t.type==='income').length;
    const expenseCount = s.count-incomeCount;
    const balanceNote = s.balance < 0 ? 'هزینه از درآمد این ماه بیشتره' : s.income ? percentage((s.balance / s.income)*100) + ' از درآمد این ماه مونده' : 'درآمد منهای هزینهٔ همین ماه';
    return '<section class="stats-grid" aria-label="خلاصهٔ ماه">' +
      '<article class="stat-card"><div class="stat-top">کل درآمد<span class="stat-icon">'+icon('arrow-down-left')+'</span></div><div class="stat-money"><strong data-testid="summary-income">'+N(s.income)+'</strong><span>تومان</span></div><div class="stat-bottom">'+N(incomeCount)+' تراکنش درآمد</div></article>' +
      '<article class="stat-card"><div class="stat-top">کل هزینه<span class="stat-icon">'+icon('arrow-up-left')+'</span></div><div class="stat-money"><strong data-testid="summary-expense">'+N(s.expense)+'</strong><span>تومان</span></div><div class="stat-bottom">'+N(expenseCount)+' تراکنش هزینه</div></article>' +
      '<article class="stat-card balance"><span class="balance-pattern"></span><div class="stat-top">ماندهٔ این ماه<span class="stat-icon">'+icon('wallet')+'</span></div><div class="stat-money"><strong data-testid="summary-balance">'+N(s.balance)+'</strong><span>تومان</span></div><div class="stat-bottom">'+E(balanceNote)+'</div></article></section>';
  }
  function alertsHtml(s) {
    const alerts=s.byCategory.filter(r=>!r.category.archived && ['warning','full','exceeded'].includes(r.status));
    if (!alerts.length) return '';
    alerts.sort((a,b)=>b.ratio-a.ratio);
    const lead=alerts[0];
    const title=lead.status==='exceeded' ? 'هزینهٔ '+lead.category.name+' از سقف گذشته' : 'حواست به سقف '+lead.category.name+' باشه';
    const detail=budgetStatusText(lead)+(alerts.length>1?' · '+N(alerts.length-1)+' دستهٔ دیگه هم نیاز به توجه دارن':'');
    return '<section class="notice '+(lead.status==='exceeded'?'danger-notice':'')+'" data-testid="budget-alert" aria-label="هشدار سقف ماهانه"><span class="notice-symbol">'+icon('alert')+'</span><div><strong>'+E(title)+'</strong><p>'+E(detail)+'</p></div><button class="link-button notice-action" data-action="nav" data-view="budgets">بررسی سقف‌ها '+icon('chevron-left')+'</button></section>';
  }
  function chartHtml(s) {
    const rows=s.byCategory.filter(r=>r.amount>0);
    let offset=0;
    const arcs=rows.map(r=>{const p=r.amount/s.expense*100; const result='<circle cx="100" cy="100" r="77" pathLength="100" fill="none" stroke="'+r.category.color+'" stroke-width="24" stroke-dasharray="'+p+' '+(100-p)+'" stroke-dashoffset="'+(-offset)+'"><title>'+E(r.category.name+': '+N(r.amount)+' تومان')+'</title></circle>';offset+=p;return result;}).join('');
    const legend=rows.map(r=>'<button class="legend-row" data-action="filter-category" data-id="'+r.category.id+'" aria-label="تراکنش‌های '+E(r.category.name)+'"><span class="legend-dot" style="background:'+r.category.color+'"></span><span class="legend-name">'+E(r.category.name)+'</span><span class="legend-amount">'+N(r.amount)+'</span><span class="legend-percent">'+N(Math.round(r.amount/s.expense*100))+'٪</span></button>').join('');
    const largest=rows[0];
    const insight=largest ? '<strong>'+E(largest.category.name)+'</strong> با '+percentage(largest.amount/s.expense*100)+'، بیشترین سهم از هزینه‌های این ماه رو داره.' : 'با ثبت اولین هزینه، سهم هر دسته رو اینجا می‌بینی.';
    return '<section class="card chart-card"><div class="card-heading"><div><h2 id="expense-chart-title">سهم هر دسته از هزینه‌ها</h2><p>'+E(C.monthLabel(selectedMonth))+' · به تومان</p></div><span class="subtle-icon">'+icon('chart')+'</span></div><div class="chart-wrap"><svg class="donut-svg" viewBox="0 0 200 200" role="img" aria-labelledby="expense-chart-title" aria-describedby="chart-details"><circle cx="100" cy="100" r="77" fill="none" stroke="#f0f3ea" stroke-width="24"/>'+arcs+'</svg><div class="donut-center"><span class="chart-label">جمع هزینه‌ها</span><strong>'+N(s.expense)+'</strong><span class="chart-unit">تومان</span></div></div><div id="chart-details" class="category-legend">'+(legend||'<p class="small-empty">هنوز هزینه‌ای در این ماه ثبت نشده.</p>')+'</div><p class="chart-insight">'+insight+'</p></section>';
  }
  function transactionRowsHtml(rows, expanded=false) {
    return rows.map(t=>{
      const cat=state.categories.find(c=>c.id===t.categoryId);
      const title=t.note || cat.name;
      const amount='<div class="transaction-money '+t.type+'"><bdi>'+ (t.type==='income'?'+':'−') +' '+N(t.amount)+'</bdi><span class="transaction-currency">تومان</span></div>';
      const edit='<button class="row-edit" data-action="edit-transaction" data-id="'+t.id+'" aria-label="ویرایش '+E(title)+'">'+icon('edit')+'</button>';
      return '<article class="transaction-row" data-txn-id="'+t.id+'">'+categoryIcon(cat)+'<div class="transaction-main"><div class="transaction-title" dir="auto" title="'+E(title)+'">'+E(title)+'</div><div class="transaction-meta"><span>'+E(cat.name)+'</span><span>·</span><span>'+E(dateText(t.date))+'</span></div></div>'+(expanded?amount+edit:'<div class="transaction-more">'+amount+edit+'</div>')+'</article>';
    }).join('');
  }
  function welcomeHtml() {
    return '<section class="card welcome-card"><div class="empty-state"><span class="empty-icon">'+icon('wallet')+'</span><h2>از اولین تراکنش شروع کنیم.</h2><p>یک درآمد یا هزینه ثبت کن تا تصویر این ماه شکل بگیره.<br>برای یک دور آشنایی، می‌تونی دفتر نمونه رو ببینی.</p><div class="empty-actions"><button class="button primary" data-action="add-transaction">'+icon('plus')+'اولین تراکنش</button><button class="button" data-action="load-demo" data-testid="load-demo">'+icon('spark')+'دیدن دفتر نمونه</button></div><p class="empty-hint">بدون حساب کاربری، بدون اینترنت. فقط دفتر خودت.</p></div></section>';
  }
  function dashboardHtml(s) {
    if(!state.transactions.length) return statsHtml(s)+welcomeHtml();
    const recent=getMonthRows().slice(0,6);
    const capped=s.byCategory.filter(r=>!r.category.archived && r.budget>0).sort((a,b)=>b.ratio-a.ratio).slice(0,3);
    const recentContent=recent.length?transactionRowsHtml(recent):'<div class="small-empty">'+icon('calendar')+'<p>در این ماه هنوز تراکنشی نداری.</p><button class="link-button" data-action="add-transaction">ثبت برای این ماه</button></div>';
    const quick=capped.length?'<section class="card quick-budget"><div class="card-heading"><div><h2>نگاهی به سقف‌ها</h2><p>هشدار، بعد از عبور از ۸۰٪</p></div><button class="link-button" data-action="nav" data-view="budgets">همهٔ دسته‌ها '+icon('chevron-left')+'</button></div><div class="budget-preview-grid">'+capped.map(r=>'<div class="mini-budget" data-category-id="'+r.category.id+'" data-budget-status="'+r.status+'"><div class="mini-budget-title"><span>'+E(r.category.name)+'</span><span class="budget-percent">'+percentage(r.percent)+'</span></div><div class="progress-track"><div class="progress-fill '+r.status+'" style="width:'+Math.min(100,r.percent)+'%"></div></div><div class="mini-budget-note">'+N(r.amount)+' از '+N(r.budget)+' تومان</div></div>').join('')+'</div></section>':'';
    return statsHtml(s)+alertsHtml(s)+'<div class="dashboard-grid">'+chartHtml(s)+'<section class="card activity-card"><div class="card-heading"><div><h2>آخرین رفت‌وآمدهای پول</h2><p>تراکنش‌های ماه انتخابی</p></div><button class="link-button" data-action="nav" data-view="transactions">همه '+icon('chevron-left')+'</button></div><div class="transaction-list">'+recentContent+'</div><div class="transaction-list-footer"><button class="link-button" data-action="add-transaction">'+icon('plus')+'ثبت یک تراکنش دیگه</button></div></section></div>'+quick;
  }
  function transactionViewHtml() {
    const cats=state.categories.filter(c=>filters.type==='all'||c.type===filters.type);
    return '<div class="filters"><div class="search-field"><span data-icon="search"></span><label for="transaction-search" class="sr-only">جست‌وجوی تراکنش‌ها</label><input id="transaction-search" class="field-input" placeholder="جست‌وجو در توضیح، دسته یا مبلغ..." value="'+E(filters.search)+'" autocomplete="off" maxlength="200" data-testid="transaction-search"></div><label for="type-filter" class="sr-only">نوع تراکنش</label><select id="type-filter" class="filter-select" data-testid="type-filter"><option value="all">همهٔ تراکنش‌ها</option><option value="expense"'+(filters.type==='expense'?' selected':'')+'>هزینه‌ها</option><option value="income"'+(filters.type==='income'?' selected':'')+'>درآمدها</option></select><label for="category-filter" class="sr-only">دستهٔ تراکنش</label><select id="category-filter" class="filter-select" data-testid="category-filter"><option value="all">همهٔ دسته‌ها</option>'+cats.map(c=>'<option value="'+c.id+'"'+(filters.category===c.id?' selected':'')+'>'+E(c.name)+(c.archived?' · بایگانی':'')+'</option>').join('')+'</select></div><section class="card transactions-card"><div class="card-heading"><div><h2>تراکنش‌های '+E(C.monthLabel(selectedMonth))+'</h2><p id="transaction-count"></p></div><button class="link-button" data-action="export-csv" data-testid="export-filtered-csv">'+icon('download')+'خروجی این لیست</button></div><div id="transaction-results"></div></section>';
  }
  function renderTransactionResults() {
    const rows=filteredRows();
    const income=rows.filter(t=>t.type==='income').reduce((sum,t)=>sum+t.amount,0);
    const expense=rows.filter(t=>t.type==='expense').reduce((sum,t)=>sum+t.amount,0);
    $('#transaction-count').textContent=N(rows.length)+' تراکنش'+(rows.length>visibleLimit?' · نمایش '+N(visibleLimit)+' مورد':'');
    const empty='<div class="empty-state"><span class="empty-icon">'+icon('search')+'</span><h2>این لیست هنوز خالیه.</h2><p>'+(filters.search||filters.type!=='all'||filters.category!=='all'?'با این فیلترها موردی پیدا نشد. فیلتر رو عوض کن یا جست‌وجو رو پاک کن.':'برای این ماه یک درآمد یا هزینه ثبت کن.')+'</p><div class="empty-actions"><button class="button secondary" data-action="'+(filters.search||filters.type!=='all'||filters.category!=='all'?'reset-filters':'add-transaction')+'">'+(filters.search||filters.type!=='all'||filters.category!=='all'?'پاک کردن فیلترها':'ثبت تراکنش')+'</button></div></div>';
    $('#transaction-results').innerHTML=rows.length?'<div class="transaction-list">'+transactionRowsHtml(rows.slice(0,visibleLimit),true)+'</div>'+(rows.length>visibleLimit?'<div class="transaction-list-footer"><button class="button small" data-action="show-more">نمایش '+N(Math.min(100,rows.length-visibleLimit))+' مورد بعدی</button></div>':'')+'<div class="filtered-totals"><span>درآمد این لیست: <strong>'+N(income)+'</strong></span><span>هزینهٔ این لیست: <strong>'+N(expense)+'</strong></span><span>مانده: <strong>'+N(income-expense)+'</strong> تومان</span></div>':empty;
    requestAnimationFrame(fitMoney);
  }
  function budgetCardHtml(r) {
    const c=r.category;
    return '<article class="card budget-card'+(c.archived?' archived':'')+'" data-category-id="'+c.id+'" data-budget-status="'+r.status+'"><div class="budget-header">'+categoryIcon(c)+'<div><h3>'+E(c.name)+'</h3><p>'+E(C.monthLabel(selectedMonth))+(c.archived?' · بایگانی‌شده':'')+'</p></div><div class="budget-edit"><button class="row-edit" data-action="edit-category" data-id="'+c.id+'" aria-label="ویرایش دستهٔ '+E(c.name)+'">'+icon('edit')+'</button><button class="row-edit" data-action="'+(c.archived?'restore-category':'archive-category')+'" data-id="'+c.id+'" aria-label="'+(c.archived?'برگرداندن ':'بایگانی یا حذف ')+E(c.name)+'">'+icon(c.archived?'refresh':'archive')+'</button></div></div><div class="budget-amounts"><div class="budget-spent">'+N(r.amount)+' <small>تومان</small></div><button class="link-button budget-cap" data-action="edit-budget" data-id="'+c.id+'" data-testid="edit-budget-'+c.id+'">'+(r.budget?'سقف '+N(r.budget):'تعیین سقف ماهانه')+'</button></div><div class="progress-track"><div class="progress-fill '+r.status+'" style="width:'+Math.min(100,r.percent)+'%"></div></div><div class="budget-status-line '+r.status+'">'+icon(['warning','full','exceeded'].includes(r.status)?'alert':r.status==='none'?'info':'check')+'<span>'+E(budgetStatusText(r))+'</span><span class="percent">'+(r.budget?percentage(r.percent):'—')+'</span></div></article>';
  }
  function budgetsHtml(s) {
    const active=s.byCategory.filter(r=>!r.category.archived);
    const archived=s.byCategory.filter(r=>r.category.archived);
    const income=state.categories.filter(c=>c.type==='income');
    return '<div class="view-toolbar"><p>سقف‌ها برای '+E(C.monthLabel(selectedMonth))+' تنظیم می‌شن.<br>صفر یعنی بدون سقف؛ هشدار فقط بعد از عبور از ۸۰٪.</p><button class="button secondary" data-action="add-category" data-testid="add-category">'+icon('plus')+'دستهٔ جدید</button></div>'+alertsHtml(s)+'<div class="budgets-grid">'+active.map(budgetCardHtml).join('')+'</div>'+(archived.length?'<details class="archived-list"><summary>'+N(archived.length)+' دستهٔ هزینهٔ بایگانی‌شده</summary><div class="budgets-grid">'+archived.map(budgetCardHtml).join('')+'</div></details>':'')+'<h2 class="income-categories-title">دسته‌های درآمد</h2><div class="income-categories">'+income.map(c=>'<div class="income-chip'+(c.archived?' archived':'')+'">'+categoryIcon(c)+'<span>'+E(c.name)+(c.archived?' · بایگانی':'')+'</span><button class="row-edit" data-action="edit-category" data-id="'+c.id+'" aria-label="ویرایش '+E(c.name)+'">'+icon('edit')+'</button><button class="row-edit" data-action="'+(c.archived?'restore-category':'archive-category')+'" data-id="'+c.id+'" aria-label="'+(c.archived?'برگرداندن ':'بایگانی یا حذف ')+E(c.name)+'">'+icon(c.archived?'refresh':'archive')+'</button></div>').join('')+'</div><p class="archive-note">دستهٔ استفاده‌شده بایگانی می‌شه تا تراکنش‌های قبلی باقی بمونن.</p>';
  }
  function render() {
    updateMonthSelect();
    $('#demo-label').hidden=!state.meta.demo;
    const today=C.toJalali(C.todayISO());
    $('#today-label').textContent='امروز، '+dateText(C.todayISO(),true);
    const titles={dashboard:['هر ماه، یک تصویر روشن‌تر','پولت کجا می‌ره؟','دخل‌وخرجت رو ببین، قبل از اینکه آخر ماه برسه.'],transactions:['ریز حساب، با جزئیات','هر تراکنش، سر جای خودش.','ثبت کن، پیدا کن و هر وقت لازم بود اصلاح کن.'],budgets:['قبل از خرج بعدی','برای هزینه‌هات مرز بذار.','یک سقف مشخص، یک هشدار به‌موقع.']};
    const title=titles[activeView];
    $('#page-eyebrow').textContent=title[0];$('#page-title').textContent=title[1];$('#page-subtitle').textContent=title[2];
    $$('[data-action="nav"]').forEach(btn=>{const active=btn.dataset.view===activeView;btn.classList.toggle('active',active);if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');});
    const summary=C.summarize(state,selectedMonth);
    $('#content').innerHTML=activeView==='dashboard'?dashboardHtml(summary):activeView==='transactions'?transactionViewHtml():budgetsHtml(summary);
    if(activeView==='transactions')renderTransactionResults();
    fillIcons();refreshStorageNotice();
    requestAnimationFrame(fitMoney);
  }
  function fitMoney() {
    $$('.stat-money strong,.donut-center strong,.budget-spent,.transaction-money bdi').forEach(el=>{
      el.style.fontSize='';
      const parent=el.parentElement;
      const parentWidth=parent.clientWidth;
      let available=parentWidth;
      if(el.matches('.stat-money strong')){const unit=parent.querySelector('span');available=parentWidth-(unit?unit.getBoundingClientRect().width:0)-8;}
      if(el.matches('.donut-center strong'))available=parentWidth-parseFloat(getComputedStyle(parent).paddingLeft)-parseFloat(getComputedStyle(parent).paddingRight);
      if(el.matches('.transaction-money bdi'))available=Math.min(available,Math.max(95,window.innerWidth<681?window.innerWidth*.3:210));
      const size=parseFloat(getComputedStyle(el).fontSize);
      const natural=el.getBoundingClientRect().width;
      if(natural>available&&available>0)el.style.fontSize=Math.max(10,size*available/natural-.3)+'px';
    });
  }
  function modal(title,subtitle,body,mode) {
    const dialog=$('#app-dialog');
    if(!dialog.open)dialogReturnFocus=document.activeElement;
    dialogMode=mode;
    $('#dialog-content').innerHTML='<div class="dialog-header"><div><h2 id="dialog-title">'+E(title)+'</h2>'+(subtitle?'<p>'+E(subtitle)+'</p>':'')+'</div><button class="icon-button" data-action="close-dialog" aria-label="بستن">'+icon('close')+'</button></div><div class="dialog-body">'+body+'</div>';
    if(!dialog.open)dialog.showModal();
    document.body.style.overflow='hidden';
    const initial=$('[autofocus]',dialog)||$('input,select,textarea,button', $('.dialog-body',dialog));
    if(initial)initial.focus();
  }
  function closeDialog() {
    $('#app-dialog').close();
  }
  function errorInForm(error) {
    const el=$('#form-error');
    if(el){el.textContent=error.message||String(error);el.hidden=false;el.scrollIntoView({block:'nearest'});}else toast(error.message||String(error),true);
  }
  function toast(message,warn=false,undo=null) {
    clearTimeout(toastTimer);undoAction=undo;
    $('#toasts').innerHTML='<div class="toast'+(warn?' warn':'')+'">'+icon(warn?'alert':'check')+'<span>'+E(message)+'</span>'+(undo?'<button data-action="undo">برگردون</button>':'')+'</div>';
    toastTimer=setTimeout(()=>{$('#toasts').innerHTML='';undoAction=null;},undo?12000:5000);
  }
  function transactionCategoryOptions(type,selection) {
    const options=state.categories.filter(c=>c.type===type&&(!c.archived||c.id===selection));
    return '<option value="">انتخاب دسته</option>'+options.map(c=>'<option value="'+c.id+'"'+(c.id===selection?' selected':'')+'>'+E(c.name)+(c.archived?' · بایگانی':'')+'</option>').join('');
  }
  function openTransaction(txnId) {
    const tx=txnId?state.transactions.find(t=>t.id===txnId):null;
    if(txnId&&!tx){toast('این تراکنش پیدا نشد.',true);return;}
    currentEditId=txnId||null;transactionType=tx?tx.type:'expense';
    const currentKey=C.monthKey(C.todayISO());
    let initialDate=C.todayISO();
    if(selectedMonth!==currentKey){const [y,m]=selectedMonth.split('-').map(Number);initialDate=C.gregorianFromJalali(y,m,1);}
    if(tx)initialDate=tx.date;
    const body='<form id="transaction-form" data-testid="txn-form" novalidate><div class="type-toggle" role="group" aria-label="نوع تراکنش"><button type="button" data-action="transaction-type" data-type="expense" data-testid="txn-type-expense" class="'+(transactionType==='expense'?'selected':'')+'" aria-pressed="'+(transactionType==='expense')+'">'+icon('arrow-up-left')+'هزینه</button><button type="button" data-action="transaction-type" data-type="income" data-testid="txn-type-income" class="'+(transactionType==='income'?'selected':'')+'" aria-pressed="'+(transactionType==='income')+'">'+icon('arrow-down-left')+'درآمد</button></div><div id="form-error" class="form-error" role="alert" hidden></div><div class="field"><label for="txn-amount">مبلغ<span class="label-sub">به تومان</span></label><div class="amount-wrap"><input class="field-input" id="txn-amount" name="amount" inputmode="numeric" autocomplete="off" maxlength="24" placeholder="۰" required autofocus data-testid="txn-amount" value="'+(tx?N(tx.amount):'')+'"><span>تومان</span></div><div class="field-hint">ارقام فارسی و انگلیسی هر دو پذیرفته می‌شن.</div></div><div class="field-grid"><div class="field"><label for="txn-category">دسته</label><select class="field-input" id="txn-category" required data-testid="txn-category">'+transactionCategoryOptions(transactionType,tx?tx.categoryId:'')+'</select></div><div class="field"><label for="txn-date">تاریخ</label><input class="field-input" type="date" id="txn-date" required data-testid="txn-date" value="'+initialDate+'" min="1000-01-01" max="9999-12-31"><div id="date-preview" class="field-hint">'+E(dateText(initialDate,true))+'</div></div></div><div class="field"><label for="txn-note">توضیح<span class="label-sub">اختیاری</span></label><textarea class="field-input" id="txn-note" maxlength="1000" rows="2" data-testid="txn-note" placeholder="مثلاً خرید هفتگی خانه">'+(tx?E(tx.note):'')+'</textarea></div><div class="dialog-actions"><button class="button cancel-button" type="button" data-action="close-dialog">انصراف</button><button class="button primary" type="submit" data-testid="txn-save">'+icon('check')+(tx?'ذخیرهٔ تغییرات':'ثبت تراکنش')+'</button></div>'+(tx?'<button type="button" class="delete-inline" data-action="delete-transaction" data-id="'+tx.id+'" data-testid="txn-delete">'+icon('trash')+'حذف این تراکنش</button>':'')+'</form>';
    modal(tx?'ویرایش تراکنش':'یک تراکنش تازه',tx?'تغییرات در نمودار و جمع ماه هم اعمال می‌شن.':'درآمده یا هزینه؟ جزئیاتش رو اینجا ثبت کن.',body,'transaction');
  }
  function saveTransaction(event) {
    event.preventDefault();
    const payload={type:transactionType,amount:$('#txn-amount').value,categoryId:$('#txn-category').value,date:$('#txn-date').value,note:$('#txn-note').value};
    if(currentEditId)payload.id=currentEditId;
    let saved;
    try {
      if(!payload.categoryId)throw new Error('یک دسته برای این تراکنش انتخاب کن.');
      commit(draft=>{
        if(currentEditId&&!draft.transactions.some(t=>t.id===currentEditId))throw new Error('این تراکنش در تب دیگری حذف شده.');
        saved=C.validateTransaction(payload,draft);
        const index=draft.transactions.findIndex(t=>t.id===saved.id);
        if(index>=0)draft.transactions[index]=saved;else draft.transactions.push(saved);
      });
      const edited=!!currentEditId;
      const monthChanged=C.monthKey(saved.date)!==selectedMonth;
      selectedMonth=C.monthKey(saved.date);filters={search:'',type:'all',category:'all'};
      closeDialog();render();
      toast((edited?'تغییرات ذخیره شد.':'تراکنش ثبت شد.')+(monthChanged?' رفتیم به '+C.monthLabel(selectedMonth)+'.':''));
    }catch(error){errorInForm(error);}
  }
  function confirm(title,description,action,label='تأیید',details='',danger=false) {
    confirmCallback=action;
    modal(title,'','<p class="confirm-copy">'+E(description)+'</p>'+(details?'<div class="confirm-details">'+E(details)+'</div>':'')+'<div id="form-error" class="form-error" role="alert" hidden></div><div class="dialog-actions"><button class="button cancel-button" data-action="close-dialog">انصراف</button><button class="button '+(danger?'danger':'primary')+'" data-action="confirm" data-testid="confirm-action">'+E(label)+'</button></div>','confirm');
  }
  function deleteTransaction(txnId) {
    let removed=clone(state.transactions.find(t=>t.id===txnId));
    if(!removed)return;
    confirm('این تراکنش حذف بشه؟','جمع ماه، نمودار و وضعیت سقف این دسته دوباره محاسبه می‌شن.',()=>{
      commit(draft=>{const latest=draft.transactions.find(t=>t.id===txnId);if(!latest)throw new Error('این تراکنش در تب دیگری حذف شده.');removed=clone(latest);draft.transactions=draft.transactions.filter(t=>t.id!==txnId);});
      closeDialog();render();
      toast('تراکنش حذف شد.',false,()=>{
        try{commit(draft=>{if(draft.transactions.some(t=>t.id===removed.id))throw new Error('این تراکنش قبلاً برگشته.');draft.transactions.push(removed);});render();toast('تراکنش برگشت.');}catch(e){toast(e.message,true);}
      });
    },'حذف تراکنش',N(removed.amount)+' تومان · '+(removed.note||state.categories.find(c=>c.id===removed.categoryId).name),true);
  }
  const palette=['#42846b','#7189bb','#e2ae53','#b087ad','#d88172','#8a9e6a','#4c9a9a','#a27852'];
  function openCategory(categoryId) {
    const cat=categoryId?state.categories.find(c=>c.id===categoryId):null;
    currentEditId=categoryId||null;categoryColor=cat?cat.color:palette[0];categoryType=cat?cat.type:'expense';
    const used=cat&&state.transactions.some(t=>t.categoryId===cat.id);
    const amount=cat?C.categoryBudget(cat,selectedMonth):0;
    const body='<form id="category-form" novalidate><div id="form-error" class="form-error" role="alert" hidden></div><div class="field"><label for="category-name">نام دسته</label><input class="field-input" id="category-name" data-testid="category-name" maxlength="60" required autofocus placeholder="مثلاً آموزش" value="'+(cat?E(cat.name):'')+'"></div><div class="field"><label for="category-type">نوع دسته</label><select class="field-input" id="category-type" data-testid="category-type" '+(used?'disabled':'')+'><option value="expense"'+(categoryType==='expense'?' selected':'')+'>هزینه</option><option value="income"'+(categoryType==='income'?' selected':'')+'>درآمد</option></select>'+(used?'<p class="field-hint">برای حفظ تراکنش‌های قبلی، نوع این دسته ثابت می‌مونه.</p>':'')+'</div><div class="field"><label>رنگ دسته</label><div class="color-options" role="group" aria-label="رنگ دسته">'+palette.map((color,i)=>'<button type="button" class="color-option'+(color===categoryColor?' selected':'')+'" style="--swatch:'+color+'" data-action="category-color" data-color="'+color+'" aria-label="رنگ '+['سبز','آبی','کهربایی','بنفش','مرجانی','زیتونی','فیروزه‌ای','قهوه‌ای'][i]+'" aria-pressed="'+(color===categoryColor)+'"></button>').join('')+'</div></div><div class="field" id="category-budget-field"'+(categoryType==='income'?' hidden':'')+'><label for="category-budget">سقف '+E(C.monthLabel(selectedMonth))+'<span class="label-sub">تومان</span></label><input id="category-budget" data-testid="category-budget" class="field-input" inputmode="numeric" maxlength="24" value="'+N(amount)+'"><p class="field-hint">فقط سقف همین ماه تغییر می‌کنه. صفر یعنی بدون سقف.</p></div><div class="dialog-actions"><button type="button" class="button cancel-button" data-action="close-dialog">انصراف</button><button class="button primary" type="submit" data-testid="category-save">'+icon('check')+(cat?'ذخیرهٔ دسته':'ساخت دسته')+'</button></div></form>';
    modal(cat?'ویرایش دسته':'دستهٔ جدید','دسته‌ها رو مطابق زندگی خودت بچین.',body,'category');
  }
  function saveCategory(event) {
    event.preventDefault();
    const name=$('#category-name').value.trim();
    const type=$('#category-type').value;
    try{
      if(!name)throw new Error('نام دسته رو وارد کن.');
      const cap=type==='expense'?C.parseAmount($('#category-budget').value||'0'):0;
      commit(draft=>{
        const found=currentEditId?draft.categories.find(c=>c.id===currentEditId):null;
        if(currentEditId&&!found)throw new Error('این دسته در تب دیگری حذف شده.');
        const category=found||{id:id(),name:'',type,icon:type==='income'?'salary':'wallet',color:categoryColor,budget:0,monthlyBudgets:{},archived:false};
        if(found&&type!==found.type&&draft.transactions.some(t=>t.categoryId===found.id))throw new Error('نوع دستهٔ استفاده‌شده قابل تغییر نیست.');
        category.name=name;category.color=categoryColor;category.type=type;
        if(type==='expense')category.monthlyBudgets[selectedMonth]=cap;
        else{category.budget=0;category.monthlyBudgets={};}
        if(!found)draft.categories.push(category);
      });
      closeDialog();render();toast('دسته ذخیره شد.');
    }catch(error){errorInForm(error);}
  }
  function openBudget(categoryId) {
    const cat=state.categories.find(c=>c.id===categoryId);
    if(!cat)return;
    currentEditId=cat.id;
    const row=C.summarize(state,selectedMonth).byCategory.find(r=>r.category.id===cat.id);
    modal('سقف '+cat.name,C.monthLabel(selectedMonth),'<form id="budget-form" novalidate><div class="budget-context">هزینهٔ ثبت‌شدهٔ این ماه: <strong>'+N(row.amount)+' تومان</strong></div><div id="form-error" class="form-error" role="alert" hidden></div><div class="field"><label for="budget-amount">سقف ماهانه<span class="label-sub">تومان</span></label><div class="amount-wrap"><input id="budget-amount" class="field-input" inputmode="numeric" data-testid="budget-amount" autofocus maxlength="24" value="'+N(row.budget)+'"><span>تومان</span></div><p class="field-hint">صفر یعنی بدون سقف. این تغییر فقط برای '+E(C.monthLabel(selectedMonth))+' ذخیره می‌شه.</p></div><div class="dialog-actions"><button class="button cancel-button" type="button" data-action="close-dialog">انصراف</button><button class="button primary" type="submit" data-testid="budget-save">'+icon('check')+'ذخیرهٔ سقف</button></div></form>','budget');
  }
  function saveBudget(event){
    event.preventDefault();
    try{const amount=C.parseAmount($('#budget-amount').value||'0');commit(draft=>{const cat=draft.categories.find(c=>c.id===currentEditId);if(!cat)throw new Error('این دسته پیدا نشد.');cat.monthlyBudgets[selectedMonth]=amount;});closeDialog();render();toast('سقف '+C.monthLabel(selectedMonth)+' ذخیره شد.');}catch(error){errorInForm(error);}
  }
  function archiveCategory(categoryId){
    const cat=state.categories.find(c=>c.id===categoryId);
    if(!cat)return;
    const used=state.transactions.some(t=>t.categoryId===categoryId);
    confirm(used?'این دسته بایگانی بشه؟':'این دسته حذف بشه؟',used?'تراکنش‌های قبلی در جمع و نمودار باقی می‌مونن، ولی این دسته برای تراکنش جدید نمایش داده نمی‌شه. بعداً می‌تونی برش گردونی.':'این دسته هنوز تراکنشی نداره و از دفتر حذف می‌شه.',()=>{
      commit(draft=>{const found=draft.categories.find(c=>c.id===categoryId);if(!found)return;if(draft.transactions.some(t=>t.categoryId===categoryId))found.archived=true;else draft.categories=draft.categories.filter(c=>c.id!==categoryId);});closeDialog();render();toast(used?'دسته بایگانی شد.':'دسته حذف شد.');
    },used?'بایگانی دسته':'حذف دسته',cat.name,!used);
  }
  function restoreCategory(categoryId){try{commit(draft=>{const cat=draft.categories.find(c=>c.id===categoryId);if(cat)cat.archived=false;});render();toast('دسته دوباره فعال شد.');}catch(error){toast(error.message,true);}}
  function download(name,text,type){
    const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function exportCSV(all=false){
    const rows=all?state.transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)):activeView==='transactions'?filteredRows():getMonthRows();
    if(!rows.length){toast('این لیست تراکنشی برای خروجی گرفتن نداره.',true);return;}
    download('dakhl-'+(all?'all':selectedMonth)+'.csv',C.exportCSV(state,rows),'text/csv;charset=utf-8;');toast('فایل CSV آمادهٔ دانلود شد.');
  }
  function exportJSON(){download('dakhl-backup-'+C.todayISO()+'.json',JSON.stringify(state,null,2),'application/json;charset=utf-8');toast('پشتیبان کامل آمادهٔ دانلود شد.');}
  function openData(){
    const option=(action,title,subtitle,symbol,testid='',danger=false)=>'<button class="data-option'+(danger?' danger-option':'')+'" data-action="'+action+'"'+(testid?' data-testid="'+testid+'"':'')+'><span class="option-icon">'+icon(symbol)+'</span><span><strong>'+title+'</strong><small>'+subtitle+'</small></span>'+icon('chevron-left')+'</button>';
    const details='<div class="data-summary"><strong>'+N(state.transactions.length)+' تراکنش</strong> و <strong>'+N(state.categories.length)+' دسته</strong> در این دفتر داری.<br>قبل از پاک کردن داده‌های مرورگر یا جابه‌جا کردن فایل، پشتیبان بگیر.</div>';
    const body=details+option('export-all-csv','خروجی همهٔ تراکنش‌ها','CSV با متن فارسی و مبلغ‌های قابل محاسبه در Excel','file','export-all-csv')+option('export-json','پشتیبان کامل دفتر','تراکنش‌ها، دسته‌ها و سقف همهٔ ماه‌ها در یک فایل JSON','download','export-json')+option('import-json','برگرداندن پشتیبان','فایل قبل از جایگزینی بررسی می‌شه','upload','import-json')+(corruptData!==null?option('export-corrupt','دریافت اطلاعات خوانده‌نشده','نسخهٔ اولیه برای بررسی و بازیابی حفظ شده','file','export-corrupt'):'')+option('load-demo','دیدن دفتر نمونه','اطلاعات آزمایشی برای آشنایی با نمودار و هشدارها','spark','load-demo-settings')+option('reset','شروع با دفتر خالی','اطلاعات فعلی پس از تأیید حذف می‌شه','refresh','reset-data',true);
    modal('خروجی و پشتیبان','اطلاعاتت رو همیشه در اختیار خودت نگه دار.',body,'data');
  }
  function loadDemo(){
    const doLoad=()=>{commit(()=>C.demoState(),{replace:true,recovery:true});selectedMonth=C.monthKey(C.todayISO());filters={search:'',type:'all',category:'all'};activeView='dashboard';closeDialog();render();toast('دفتر نمونه باز شد؛ همهٔ اعداد این دفتر آزمایشی‌ان.');};
    if(JSON.stringify(state)!==JSON.stringify(C.emptyState())||corruptData!==null)confirm('دفتر نمونه جایگزین بشه؟','با این کار اطلاعات فعلی با داده‌های آزمایشی جایگزین می‌شه. اگر دسته، سقف یا تراکنش خودت رو ثبت کردی، اول از بخش پشتیبان خروجی بگیر.',doLoad,'باز کردن نمونه','این کار فقط روی همین مرورگر انجام می‌شه.');
    else{try{doLoad();}catch(error){toast(error.message,true);}}
  }
  function resetData(){confirm('از دفتر خالی شروع کنیم؟','همهٔ تراکنش‌ها و دسته‌های شخصی این دفتر حذف می‌شن و دسته‌های اولیه برمی‌گردن. قبلش از دفترت پشتیبان بگیر.',()=>{commit(()=>C.emptyState(),{replace:true,recovery:true});activeView='dashboard';selectedMonth=C.monthKey(C.todayISO());filters={search:'',type:'all',category:'all'};closeDialog();render();toast('دفتر خالی آماده‌ست.');},'پاک کردن و شروع دوباره','این کار با پشتیبان JSON قابل برگشت است.',true);}
  async function readImport(file){
    if(!file)return;
    try{
      if(file.size>10*1024*1024)throw new Error('فایل پشتیبان باید کمتر از ۱۰ مگابایت باشه.');
      const text=await file.text();
      importPending=C.validateState(JSON.parse(text.replace(/^\uFEFF/,'')));
      confirm('این پشتیبان برگرده؟','اطلاعات فعلی با محتوای این فایل جایگزین می‌شه. اگر لازم داری، قبلش از دفتر فعلی پشتیبان بگیر.',()=>{
        commit(()=>importPending,{replace:true,recovery:true});importPending=null;selectedMonth=C.monthKey(C.todayISO());activeView='dashboard';filters={search:'',type:'all',category:'all'};closeDialog();render();toast('پشتیبان با موفقیت برگشت.');
      },'برگرداندن پشتیبان',N(importPending.transactions.length)+' تراکنش · '+N(importPending.categories.length)+' دسته');
    }catch(error){importPending=null;toast(error instanceof SyntaxError?'ساختار فایل JSON معتبر نیست. اطلاعات فعلی تغییری نکرد.':error.message+' اطلاعات فعلی تغییری نکرد.',true);}
    $('#import-file').value='';
  }
  function showHelp(){modal('یک راهنمای کوتاه','برای اینکه حساب دفترت همیشه روشن بمونه.','<div class="help-copy"><h3>عددها چه چیزی رو نشون می‌دن؟</h3><p>همهٔ مبلغ‌ها تومان‌اند. ماندهٔ هر ماه برابر درآمد منهای هزینهٔ همون ماهه و موجودی حساب بانکی نیست. ثبت تاریخ با تقویم مرورگر انجام می‌شه و تاریخ شمسی زیرش نمایش داده می‌شه.</p><h3>سقف هر دسته</h3><p>در «دسته‌ها و سقف‌ها»، سقف ماه انتخابی رو تعیین کن. بیشتر از ۸۰٪ هشدار می‌گیره، ۱۰۰٪ یعنی سقف کامل شده و بیشتر از ۱۰۰٪ یعنی از سقف گذشتی. صفر یعنی بدون سقف.</p><h3>دفتر کجا ذخیره می‌شه؟</h3><p>در همین مرورگر و روی همین دستگاه. پاک کردن داده‌های مرورگر یا جابه‌جا کردن فایل ممکنه دسترسی به دفتر رو قطع کنه؛ پشتیبان JSON رو نگه دار. این نسخه همگام‌سازی آنلاین نداره.</p><h3>خروجی Excel</h3><p>CSV با UTF-8 و BOM ساخته می‌شه. مبلغ‌ها در فایل به صورت عدد ذخیره می‌شن. اگر Excel ستون‌ها رو جدا نکرد، از Data → From Text/CSV وارد کن و UTF-8 و جداکنندهٔ Comma رو انتخاب کن.</p><h3>دفتر نمونه</h3><p>نمونه شامل داده‌های آزمایشیه و با برچسب مشخص می‌شه. برای ثبت اطلاعات خودت، از «خروجی و پشتیبان» دفتر خالی بساز.</p></div>','help');}

  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');
    if(!button)return;
    event.preventDefault();
    const action=button.dataset.action;
    try{
      if(action==='nav')nav(button.dataset.view);
      else if(action==='add-transaction')openTransaction();
      else if(action==='edit-transaction')openTransaction(button.dataset.id);
      else if(action==='close-dialog')closeDialog();
      else if(action==='transaction-type'){
        transactionType=button.dataset.type;
        $$('[data-action="transaction-type"]').forEach(b=>{b.classList.toggle('selected',b.dataset.type===transactionType);b.setAttribute('aria-pressed',b.dataset.type===transactionType);});
        const previous=$('#txn-category').value;
        $('#txn-category').innerHTML=transactionCategoryOptions(transactionType,previous);
      }
      else if(action==='delete-transaction')deleteTransaction(button.dataset.id);
      else if(action==='confirm'&&confirmCallback)confirmCallback();
      else if(action==='prev-month')setMonth(C.shiftMonth(selectedMonth,-1));
      else if(action==='next-month')setMonth(C.shiftMonth(selectedMonth,1));
      else if(action==='current-month')setMonth(C.monthKey(C.todayISO()));
      else if(action==='filter-category'){filters={search:'',type:'expense',category:button.dataset.id};nav('transactions');}
      else if(action==='reset-filters'){filters={search:'',type:'all',category:'all'};render();}
      else if(action==='show-more'){visibleLimit+=100;renderTransactionResults();}
      else if(action==='add-category')openCategory();
      else if(action==='edit-category')openCategory(button.dataset.id);
      else if(action==='edit-budget')openBudget(button.dataset.id);
      else if(action==='archive-category')archiveCategory(button.dataset.id);
      else if(action==='restore-category')restoreCategory(button.dataset.id);
      else if(action==='category-color'){categoryColor=button.dataset.color;$$('.color-option').forEach(b=>{b.classList.toggle('selected',b.dataset.color===categoryColor);b.setAttribute('aria-pressed',b.dataset.color===categoryColor);});}
      else if(action==='data')openData();
      else if(action==='export-csv')exportCSV();
      else if(action==='export-all-csv')exportCSV(true);
      else if(action==='export-json')exportJSON();
      else if(action==='import-json')$('#import-file').click();
      else if(action==='export-corrupt'&&corruptData!==null)download('dakhl-recovery-'+C.todayISO()+'.txt',corruptData,'text/plain;charset=utf-8');
      else if(action==='load-demo')loadDemo();
      else if(action==='reset')resetData();
      else if(action==='help')showHelp();
      else if(action==='undo'&&undoAction){const fn=undoAction;undoAction=null;fn();}
    }catch(error){errorInForm(error);}
  });
  document.addEventListener('submit',event=>{
    if(event.target.id==='transaction-form')saveTransaction(event);
    else if(event.target.id==='category-form')saveCategory(event);
    else if(event.target.id==='budget-form')saveBudget(event);
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.id==='month-select')setMonth(el.value);
    else if(el.id==='txn-date')$('#date-preview').textContent=C.validateDateISO(el.value)?dateText(el.value,true):'یک تاریخ معتبر انتخاب کن.';
    else if(el.id==='type-filter'){filters.type=el.value;filters.category='all';visibleLimit=100;render();}
    else if(el.id==='category-filter'){filters.category=el.value;visibleLimit=100;renderTransactionResults();}
    else if(el.id==='category-type'){categoryType=el.value;$('#category-budget-field').hidden=categoryType==='income';}
    else if(el.id==='import-file')readImport(el.files[0]);
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.id==='transaction-search'){filters.search=el.value;visibleLimit=100;renderTransactionResults();}
    if(el.id==='txn-date'&&$('#date-preview'))$('#date-preview').textContent=C.validateDateISO(el.value)?dateText(el.value,true):'یک تاریخ معتبر انتخاب کن.';
  });
  document.addEventListener('focusout',event=>{
    const el=event.target;
    if(['txn-amount','budget-amount','category-budget'].includes(el.id)&&el.value.trim()){
      try{el.value=N(C.parseAmount(el.value));}catch(error){/* Keep the user's original invalid value for a clear form error. */}
    }
  });
  $('#app-dialog').addEventListener('close',()=>{
    document.body.style.overflow='';dialogMode=null;confirmCallback=null;
    if(dialogReturnFocus&&dialogReturnFocus.isConnected)dialogReturnFocus.focus();
    else $('[data-testid="add-transaction"]').focus();
  });
  $('#app-dialog').addEventListener('click',event=>{
    if(event.target===$('#app-dialog')){
      const rect=event.target.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();
    }
  });
  $('#app-dialog').addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=$$('button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',event.currentTarget).filter(el=>el.getClientRects().length);
    if(!controls.length){event.preventDefault();return;}
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  window.addEventListener('resize',()=>requestAnimationFrame(fitMoney));
  window.addEventListener('storage',event=>{
    if(event.key!==KEY)return;
    if($('#app-dialog').open){toast('دفتر در تب دیگری تغییر کرده؛ موقع ذخیره، آخرین اطلاعات بررسی می‌شن.',true);return;}
    try{state=event.newValue?C.validateState(JSON.parse(event.newValue)):C.emptyState();lastSavedRaw=event.newValue;corruptData=null;render();toast('تغییرات تب دیگه دریافت شد.');}
    catch(error){corruptData=event.newValue;refreshStorageNotice();}
  });
  // Read-only diagnostics for transparent, repeatable UI tests.
  window.DakhlApp=Object.freeze({getState:()=>clone(state),currentMonth:()=>selectedMonth,storageKey:KEY});
  load();fillIcons();render();
  document.fonts.ready.then(fitMoney);
})();
