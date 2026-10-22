/* Real browser recording of the actual offline app. No mock UI or simulated success. */
const fs=require('node:fs');
const path=require('node:path');
if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&fs.existsSync('/tmp/vc005-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/tmp/vc005-browsers';
let pw;try{pw=require('playwright');}catch{pw=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');}
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.DAKHL_VIDEO_DIR||'/tmp/vc005-video';
fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browserPath=process.env.CHROMIUM_PATH||'/tmp/vc005-browsers/chrome-headless-shell-linux64/chrome-headless-shell';
async function caption(page,label,text){
  await page.evaluate(({label,text})=>{
    let box=document.getElementById('recording-caption');
    if(!box){box=document.createElement('div');box.id='recording-caption';box.setAttribute('popover','manual');box.style.cssText='position:fixed;inset:auto 246px 23px 24px;margin:0;border:1px solid #5f7966;border-radius:17px;background:#193c31f5;color:#fff;padding:14px 21px;font-family:Estedad,Tahoma,sans-serif;text-align:right;direction:rtl;pointer-events:none;box-shadow:0 8px 32px #193c3133;max-width:none;';document.body.appendChild(box);}
    box.replaceChildren();
    const badge=document.createElement('div');badge.textContent=label;badge.style.cssText='font-size:10px;color:#cde3b4;margin-bottom:4px';
    const line=document.createElement('div');line.textContent=text;line.style.cssText='font-size:15px;font-weight:550;line-height:1.9';
    box.append(badge,line);if(box.matches(':popover-open'))box.hidePopover();box.showPopover();
  },{label,text});
  console.log('CAPTION',label,text);
}
async function click(locator){await locator.scrollIntoViewIfNeeded();const handle=await locator.elementHandle();await handle.evaluate(el=>el.style.boxShadow='0 0 0 4px #bdd9a5');await sleep(280);await locator.click();try{await handle.evaluate(el=>el.style.boxShadow='');}catch{}await handle.dispose();}
async function nav(page,view){await click(page.getByTestId('nav-'+view));await sleep(500);}
async function input(page,testid,text){const el=page.getByTestId(testid);await el.fill('');await el.pressSequentially(text,{delay:65});await sleep(250);}
async function main(){
  const launchOptions={headless:true,args:['--no-sandbox']};if(fs.existsSync(browserPath))launchOptions.executablePath=browserPath;
  const b=await pw.chromium.launch(launchOptions);
  const ctx=await b.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:OUT,size:{width:1440,height:1000}},locale:'fa-IR',timezoneId:'Asia/Tehran',offline:true});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00+03:30'));
  await page.goto('file://'+path.join(ROOT,'index.html'));
  await page.evaluate(()=>document.fonts.ready);
  await caption(page,'دخل · VC-005 · ضبط واقعی برنامه','یک فایل HTML مستقل؛ بدون نصب، سرور یا اینترنت.');await sleep(5000);
  await click(page.getByTestId('load-demo'));await caption(page,'۱ / تصویر ماه','نمونه را خودمان باز می‌کنیم؛ درآمد، هزینه و مانده برای ماه شمسی انتخاب‌شده.');await sleep(6000);
  await page.evaluate(()=>window.scrollTo({top:450,behavior:'smooth'}));await sleep(1500);
  await caption(page,'۲ / پول کجا رفته؟','سهم هر دسته از هزینه‌ها از تراکنش‌های واقعی همین دفتر محاسبه می‌شود.');await sleep(5000);
  await nav(page,'budgets');await click(page.getByTestId('add-category'));
  await caption(page,'۳ / سقف ماهانه','یک دستهٔ تازه می‌سازیم؛ سقف آموزش برای این ماه: یک میلیون تومان.');
  await input(page,'category-name','آموزش');await input(page,'category-budget','۱۰۰۰۰۰۰');await sleep(1800);await click(page.getByTestId('category-save'));
  const categoryId=await page.evaluate(()=>DakhlApp.getState().categories.find(c=>c.name==='آموزش').id);
  await click(page.getByTestId('add-transaction'));
  await caption(page,'۴ / ثبت هزینه با ارقام فارسی','۸۰۰ هزار تومان ثبت می‌کنیم؛ دقیقاً ۸۰٪ سقف، هنوز هشدار ندارد.');
  await input(page,'txn-amount','۸۰۰۰۰۰');await page.getByTestId('txn-category').selectOption(categoryId);await page.getByTestId('txn-date').fill('2026-10-20');await input(page,'txn-note','خرید دورهٔ آموزشی');await sleep(1500);await click(page.getByTestId('txn-save'));
  const catCard=page.locator('.budget-card[data-category-id="'+categoryId+'"]');await catCard.evaluate(el=>el.scrollIntoView({block:'center',behavior:'smooth'}));await sleep(1500);await caption(page,'مرز ۸۰٪ دقیق بررسی می‌شود','۸۰۰٬۰۰۰ از ۱٬۰۰۰٬۰۰۰ تومان: وضعیت عادی، بدون هشدار زودهنگام.');await sleep(5000);
  await nav(page,'transactions');
  const txId=await page.evaluate(()=>DakhlApp.getState().transactions.find(t=>t.note==='خرید دورهٔ آموزشی').id);
  await page.getByTestId('transaction-search').fill('آموزشی');await sleep(1200);
  await click(page.locator('[data-action="edit-transaction"][data-id="'+txId+'"]'));
  await caption(page,'۵ / ویرایش و محاسبهٔ دوباره','همان تراکنش را به ۸۵۰ هزار تومان تغییر می‌دهیم.');
  await input(page,'txn-amount','۸۵۰۰۰۰');await sleep(1500);await click(page.getByTestId('txn-save'));await nav(page,'budgets');await page.locator('.budget-card[data-category-id="'+categoryId+'"]').evaluate(el=>el.scrollIntoView({block:'center',behavior:'smooth'}));await sleep(800);
  await caption(page,'هشدار بعد از عبور از حد','حالا مصرف سقف ۸۵٪ است؛ وضعیت دسته و ماندهٔ سقف فوراً تغییر کرده.');await sleep(6000);
  await click(page.getByTestId('edit-budget-'+categoryId));await input(page,'budget-amount','۱۲۰۰۰۰۰');await caption(page,'سقف هر ماه مستقل است','سقف را به یک میلیون و دویست هزار تومان اصلاح می‌کنیم؛ ماه‌های دیگر تغییر نمی‌کنند.');await sleep(2000);await click(page.getByTestId('budget-save'));await sleep(1500);
  await click(page.getByTestId('add-transaction'));await click(page.getByTestId('txn-type-income'));await caption(page,'۶ / درآمد هم در همان دفتر','ثبت درآمد جدا از هزینه؛ اعداد خلاصه و مانده از نو محاسبه می‌شوند.');await input(page,'txn-amount','۳۰۰۰۰۰۰');await page.getByTestId('txn-category').selectOption('freelance');await input(page,'txn-note','پروژهٔ تدوین');await sleep(1500);await click(page.getByTestId('txn-save'));
  await nav(page,'dashboard');await sleep(2000);await click(page.getByTestId('prev-month'));await caption(page,'۷ / گزارش ماه شمسی','با تغییر ماه، تراکنش‌ها، نمودار و سقف‌های همان ماه نمایش داده می‌شوند.');await sleep(4500);await click(page.getByTestId('next-month'));await sleep(1500);
  const csvPromise=page.waitForEvent('download');await click(page.getByTestId('export-csv'));const csv=await csvPromise;await csv.saveAs(path.join(OUT,'recorded-export.csv'));await caption(page,'۸ / خروجی قابل استفاده','CSV با UTF-8 BOM، متن فارسی و مبلغ عددی برای Excel دانلود می‌شود.');await sleep(4500);
  await click(page.getByTestId('data-manager'));const backupPromise=page.waitForEvent('download');await click(page.getByTestId('export-json'));const backup=await backupPromise;await backup.saveAs(path.join(OUT,'recorded-backup.json'));await caption(page,'۹ / پشتیبان کامل','یک فایل JSON برای تراکنش‌ها، دسته‌ها و سقف همهٔ ماه‌ها.');await sleep(4500);await click(page.locator('[data-action="close-dialog"]'));
  await page.reload();await page.evaluate(()=>document.fonts.ready);await caption(page,'۱۰ / ماندگاری بعد از باز کردن دوباره','صفحه را دوباره باز کردیم؛ تراکنش و سقف جدید همچنان ذخیره‌اند.');await sleep(5500);
  const snapshot=await page.evaluate(()=>DakhlApp.getState());
  const desktop=page.video();await page.close();await desktop.saveAs(path.join(OUT,'desktop.webm'));await ctx.close();
  const mobileCtx=await b.newContext({viewport:{width:390,height:844},recordVideo:{dir:OUT,size:{width:390,height:844}},locale:'fa-IR',timezoneId:'Asia/Tehran',offline:true,isMobile:true,hasTouch:true});
  await mobileCtx.addInitScript(data=>localStorage.setItem('dakhl.vc005.v1',JSON.stringify(data)),snapshot);
  const mobile=await mobileCtx.newPage();await mobile.clock.setFixedTime(new Date('2026-10-22T12:00:00+03:30'));await mobile.goto('file://'+path.join(ROOT,'index.html'));await mobile.evaluate(()=>document.fonts.ready);await sleep(4000);await mobile.evaluate(()=>window.scrollTo({top:650,behavior:'smooth'}));await sleep(4000);await mobile.locator('.mobile-nav [data-view="budgets"]').click();await sleep(4000);await mobile.locator('.mobile-nav [data-view="dashboard"]').click();await sleep(3000);
  const mobileVideo=mobile.video();await mobile.close();await mobileVideo.saveAs(path.join(OUT,'mobile.webm'));await mobileCtx.close();await b.close();
  fs.writeFileSync(path.join(OUT,'recording-evidence.json'),JSON.stringify({kind:'real-browser-recording',date:'2026-10-22',timezone:'Asia/Tehran',offline:true,browser:'Chromium',desktopViewport:[1440,1000],mobileViewport:[390,844],sampleData:true,finalTransactions:snapshot.transactions.length,consoleErrors:errors,notes:'Only captions and click emphasis were added for the recording; all app interactions and downloads are real. Mobile uses an explicit copied sample snapshot, not online synchronization.'},null,2));
  console.log('RECORDING COMPLETE',OUT,'console errors',errors.length);
}
main().catch(e=>{console.error(e);process.exit(1)});
