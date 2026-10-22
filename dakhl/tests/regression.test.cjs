#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
let pw;try{pw=require('playwright');}catch{pw=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');}
const C=require('../src/core');
const root=path.resolve(__dirname,'..');const key='dakhl.vc005.v1';
(async()=>{
 const options={headless:true,args:['--no-sandbox']};const executable=process.env.DAKHL_CHROME_PATH||'/tmp/vc005-browsers/chrome-headless-shell-linux64/chrome-headless-shell';if(fs.existsSync(executable))options.executablePath=executable;
 const b=await pw.chromium.launch(options);const ctx=await b.newContext({viewport:{width:1440,height:1000}});const p=await ctx.newPage();const other=await ctx.newPage();const url=pathToFileURL(path.join(root,'index.html')).href;
 await p.goto(url);await other.goto(url);
 const results=[];
 async function seed(s){await p.evaluate(({key,s})=>localStorage.setItem(key,JSON.stringify(s)),{key,s});await p.reload();}
 const demo=C.demoState();
 await seed(demo);await p.getByTestId('add-transaction').click();await p.getByTestId('txn-amount').fill('123');await p.getByTestId('txn-category').selectOption('food');await p.getByTestId('txn-note').fill('new after external clear');
 await other.evaluate(key=>localStorage.removeItem(key),key);await p.getByTestId('txn-save').click();
 const after=await p.evaluate(()=>DakhlApp.getState());assert.equal(after.transactions.length,1);assert.equal(after.transactions[0].amount,123);results.push({name:'A stale open form does not resurrect a ledger removed by another tab',status:'passed'});
 await seed(demo);const tx=demo.transactions.find(t=>t.type==='expense'&&C.monthKey(t.date)===C.monthKey(C.todayISO()));await p.getByTestId('nav-transactions').click();await p.locator('[data-action="edit-transaction"][data-id="'+tx.id+'"]').click();await p.getByTestId('txn-delete').click();
 await other.evaluate(({key,id})=>{const s=JSON.parse(localStorage.getItem(key));s.transactions.find(t=>t.id===id).amount=777777;localStorage.setItem(key,JSON.stringify(s));},{key,id:tx.id});
 await p.getByTestId('confirm-action').click();await p.locator('[data-action="undo"]').click();const restored=await p.evaluate(id=>DakhlApp.getState().transactions.find(t=>t.id===id),tx.id);assert.equal(restored.amount,777777);results.push({name:'Undo restores the latest transaction actually deleted after a concurrent edit',status:'passed'});
 const custom=C.emptyState();custom.categories[0].monthlyBudgets[C.monthKey(C.todayISO())]=1000000;await seed(custom);await p.getByTestId('load-demo').click();assert.equal(await p.locator('#dialog-title').textContent(),'دفتر نمونه جایگزین بشه؟');assert.deepEqual(await p.evaluate(()=>DakhlApp.getState()),C.validateState(custom));await p.keyboard.press('Escape');assert.deepEqual(await p.evaluate(()=>DakhlApp.getState()),C.validateState(custom));results.push({name:'Custom budgets in an otherwise empty ledger require confirmation before loading demo',status:'passed'});
 await b.close();fs.mkdirSync(path.join(root,'tests/evidence'),{recursive:true});fs.writeFileSync(path.join(root,'tests/evidence/regression-results.json'),JSON.stringify({passed:results.length,failed:0,results},null,2));console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
