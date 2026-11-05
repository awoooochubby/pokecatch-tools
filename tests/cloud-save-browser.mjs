import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import version from '../src/simulation/version.json' with { type: 'json' };
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath()),headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><script type="text/plain" src="${version.url}"></script><button id="save-btn" data-state="ok">保存</button><div id="toasts"></div>`}));
  await page.goto('https://pokecatch-online.pages.dev/');
  await page.evaluate(()=>{
    localStorage.setItem('gachamon-save-v1',JSON.stringify({mons:[{id:445,uid:'a',level:100,xp:0}],team:['a'],adv:{chapter:0,nodes:[],node:0,runs:0},stats:{}}));
    localStorage.setItem('pc-tools-v1',JSON.stringify({schema:1,data:{cloudSave:{enabled:false,minutes:15}}}));
    localStorage.setItem('pokecatch-cloud-user',JSON.stringify({user:'test-account',base:new Date(Date.now()-3600000).toISOString(),print:'old'}));
    window.saveClicks=0;window.saveResult='success';
    document.querySelector('#save-btn').onclick=()=>{
      window.saveClicks++;const button=document.querySelector('#save-btn');button.dataset.state='busy';
      setTimeout(()=>{
        if(window.saveResult==='failure'){button.dataset.state='error';return}
        localStorage.setItem('pokecatch-cloud-user',JSON.stringify({user:'test-account',base:new Date().toISOString(),print:'native-server-snapshot'}));
        localStorage.setItem('pokecatch-save-btn',String(Date.now()));button.dataset.state='ok';
        const toast=document.createElement('div');toast.className='toast';toast.textContent='进度已在线保存！';document.querySelector('#toasts').append(toast);
      },400);
    };
  });
  await page.addScriptTag({content:readFileSync('pokecatch-tools.user.js','utf8')});
  await page.getByRole('button',{name:'关闭刷图浮窗',exact:true}).click();await page.getByRole('tab',{name:'设置',exact:true}).click();
  await page.getByRole('switch',{name:'定期云保存',exact:true}).click();
  await page.getByTestId('cloud-save-status').filter({hasText:'上传已确认'}).waitFor();
  assert.equal(await page.evaluate(()=>window.saveClicks),1);assert.match(await page.getByTestId('cloud-save-summary').innerText(),/已确认在线/);
  await page.getByTestId('cloud-save-now').click();assert.equal(await page.evaluate(()=>window.saveClicks),1);assert.match(await page.getByTestId('cloud-save-status').innerText(),/冷却/);
  await page.evaluate(()=>{localStorage.setItem('pokecatch-save-btn','0');window.saveResult='failure'});
  await page.getByTestId('cloud-save-now').click();await page.getByTestId('cloud-save-status').filter({hasText:'尚未确认上传成功'}).waitFor();
  assert.equal(await page.evaluate(()=>window.saveClicks),2);assert.match(await page.getByTestId('cloud-save-summary').innerText(),/上传未确认/);
  await page.evaluate(()=>{document.querySelector('#save-btn').dataset.state='lost'});await page.getByTestId('cloud-save-now').click();
  assert.equal(await page.evaluate(()=>window.saveClicks),2);assert.match(await page.getByTestId('cloud-save-status').innerText(),/连接已过期/);
  await page.getByRole('switch',{name:'定期云保存',exact:true}).click();await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>window.saveClicks),2);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-tools-v1')).data.cloudSave.enabled),false);
  assert.deepEqual(errors,[]);console.log('PASS: periodic native save, server receipt verification, visible confirmation time, cooldown, failure and expired session without reconnect, persistent opt-out');
}finally{await browser.close()}
