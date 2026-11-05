import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright';

const engine=JSON.parse(readFileSync('src/simulation/version.json','utf8'));
if(!existsSync('.cache/engine.js'))throw new Error('Run npm run test:engine first');
const executablePath=process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath());
async function setupFlow(scope, title) { const flow = scope.locator(`[data-analysis="${title}"]`); if (await flow.count()) await flow.locator('.flow-nav button').filter({hasText:'任务设置'}).click(); }

const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(url===engine.boot)return route.fulfill({contentType:'application/javascript',body:`window.BUNDLE=${JSON.stringify(engine.url)}`});
    if(url===engine.url)return route.fulfill({contentType:'application/javascript',body:readFileSync('.cache/engine.js','utf8')});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{height:3000px;background:#10151d}</style>'});
  });
  await page.goto('https://pokecatch-online.pages.dev/');
  const save={travel:{to:['sinnoh']},mons:Array.from({length:40},(_,i)=>({uid:`box-${i}`,id:i%2?392:136,level:52,xp:0,reg:'sinnoh'})),team:['box-0'],road:['box-0'],
    adv:{chapter:55,unlocked:59,runs:1,speed:1,layout:6,gifts:{},badges:[],kept:{},loops:[],pending:null,node:0,battle:null,
      nodes:Array.from({length:36},(_,i)=>({type:'wild',name:`Route ${200+i}`,bg:'prairie',pool:[{id:478,min:52,max:52,w:1}]}))}};
  await page.evaluate(s=>localStorage.setItem('gachamon-save-v1',JSON.stringify(s)),save);
  await page.addScriptTag({content:readFileSync('pokecatch-tools.user.js','utf8')});
  async function wheelSelect(label) {
    const select=page.locator(`.n-select[aria-label="${label}"]`);
    await select.scrollIntoViewIfNeeded();await select.locator('.n-base-suffix').click();
    const menu=page.locator('.n-base-select-menu:visible'),list=menu.locator('.v-vl');
    await list.waitFor();
    const metrics=await list.evaluate(el=>({overflow:getComputedStyle(el).overflowY,height:el.clientHeight,content:el.scrollHeight}));
    assert.match(metrics.overflow,/auto|scroll/,`${label}: missing scroll styles in Shadow DOM`);
    assert.ok(metrics.content>metrics.height,`${label}: fixture needs a long menu`);
    await list.evaluate(el=>{el.scrollTop=0;});
    const handle=await list.elementHandle(),box=await list.boundingBox();
    const containers=await select.evaluate(el=>{const panel=el.closest('.tab-content,.farming-content');return {panel:panel.scrollTop,page:window.scrollY};});
    await page.mouse.move(box.x+box.width/2,box.y+Math.min(60,box.height/2));
    await page.mouse.wheel(0,400);
    await page.waitForFunction(el=>el.scrollTop>100,handle);
    const down=await list.evaluate(el=>el.scrollTop);
    await page.mouse.wheel(0,-200);
    await page.waitForFunction(({el,top})=>el.scrollTop<top,{el:handle,top:down});
    // Reaching either end must not scroll the surrounding assistant or game.
    for(const [top,delta]of [[1e9,600],[0,-600]]) {
      await list.evaluate((el,top)=>{el.scrollTop=top;},top);
      await page.mouse.wheel(0,delta);await page.waitForTimeout(100);
      assert.deepEqual(await select.evaluate(el=>({panel:el.closest('.tab-content,.farming-content').scrollTop,page:window.scrollY})),containers,`${label}: scroll escaped the dropdown`);
    }
    await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
    console.log(`PASS: ${label} wheel down/up and boundary isolation`);
  }
  await page.getByRole('tab',{name:'对策',exact:true}).click();await page.getByTestId('load-box').click();
  await page.getByTestId('counter-phase').filter({hasText:'已读取快照'}).waitFor({timeout:30000});
  await page.getByTestId('open-team-planner').click();await wheelSelect('配队目标节点');await page.getByRole('button',{name:'单体对策／路线检查',exact:true}).click();await wheelSelect('副本对策目标');
  await page.getByRole('button',{name:'指定精灵',exact:true}).click();await wheelSelect('指定精灵名称');
  await page.getByRole('button',{name:/高级设置与自选候选/}).click();await wheelSelect('候选精灵');
  await page.getByTestId('load-forecast').click();
  await page.locator('.n-select[aria-label="模拟比较地图"]').waitFor({timeout:30000});await wheelSelect('模拟比较地图');
  // Search and selection must still work after wheel navigation.
  const species=page.locator('.n-select[aria-label="指定精灵名称"]');
  await species.scrollIntoViewIfNeeded();await species.locator('.n-base-selection').click();
  await species.locator('input').fill('雪妖女');await page.locator('.n-base-select-option').filter({hasText:'雪妖女'}).click();
  assert.match(await species.innerText(),/雪妖女/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('gachamon-save-v1')),JSON.stringify(save));
  assert.deepEqual(errors,[]);
  console.log('PASS: searchable selection still works; no browser errors or game-save writes');
}finally{await browser.close();}
