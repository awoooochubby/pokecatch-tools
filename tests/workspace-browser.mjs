import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import version from '../src/simulation/version.json' with { type: 'json' };
await build({ entryPoints: ['tests/tracker-fixture.ts'], outfile: '.cache/raid-browser-fixture.mjs', bundle: true, platform: 'node', format: 'esm' });
const { trackerFixture } = await import('../.cache/raid-browser-fixture.mjs');
const source = readFileSync('.cache/engine.js', 'utf8'), save = trackerFixture(source, Date.now());
save.eventTeams = Object.fromEntries(['kanto', 'hoenn', 'sinnoh'].map(region => [`raid:${region}`, save.team.slice(0, 2)]));
save.mons.forEach(m => { m.shiny = true; m.rank = 5; });
const group = (key, ids) => ({ key, name: key, mons: ids.map((id, i) => ({ uid: `${key}-${i}`, id, level: 100, xp: 0, bot: true, statMult: .85 })) });
const regional = { kanto: [[149, 143], [130, 65]], hoenn: [[376, 289], [130, 143]], sinnoh: [[445, 376], [130, 143]] };
save.raids = { bots: {}, pick: {}, done: {}, last: [], botsV: 3, timesV: 1, pityV: 1, paceV: 1 };
for (const [region, ids] of Object.entries(regional)) {
  save.raids.bots[region] = [group(`${region}-a`, ids[0]), group(`${region}-b`, ids[1])];
  save.raids.pick[region] = [`${region}-b`, `${region}-a`];
}
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(Date.now()).map(p => [p.type, p.value]));
save.adv.event = { raid: true, reg: 'sinnoh', id: 25, date: `${parts.year}-${parts.month}-${parts.day}` };
save.adv.nodes = [{ type: 'static', raid: true, id: 25, weather: 'storm' }];
save.raids.allies = [...save.raids.bots.sinnoh[1].mons, ...save.raids.bots.sinnoh[0].mons];
save.adv.battle = { kind: 'static', raid: true, enemies: [{ uid: 'live-boss', id: 25, hp: 123 }] };
const mon = id => `<span class="rc-mon" title="精灵 · Lv.100"><img src="assets/pokemon/${id}.png"></span>`;
const cards = ['kanto', 'johto', 'hoenn', 'sinnoh'].map(region => `<div class="rc-card" data-rc="${region}"><div class="mp-chips"><span data-cond="storm">雷暴雨</span></div><div class="boss"><img src="assets/pokemon/art/shiny/25.gif"></div>${region === 'sinnoh' || region === 'johto' ? '' : `<button data-raid-slot="${region}|0">${regional[region][1].map(mon).join('')}</button><button data-raid-slot="${region}|1">${regional[region][0].map(mon).join('')}</button>`}</div>`).join('');
const html = '<!doctype html><meta charset="utf-8"><script type="text/plain" src="' + version.url + '"></script><style>body{background:#10151d;color:white}</style><div id="tabs"><button data-screen="raid">打开团体战</button></div><section id="screen-adventure" class="active"></section><section id="screen-raid"><div id="raid-root">' + cards + '</div></section>';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const setup = () => page.locator('[data-analysis="团体战分析"] .flow-nav button').filter({hasText:'任务设置'}).click();
  await page.route('**/*', r => {
    const url = r.request().url();
    if (url === version.boot) return r.fulfill({ contentType: 'application/javascript', body: `window.BUNDLE=${JSON.stringify(version.url)}` });
    if (url === version.url) return r.fulfill({ contentType: 'application/javascript', body: source });
    if (url.endsWith('.png') || url.endsWith('.gif')) return r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
    return r.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://pokecatch-online.pages.dev/');
  await page.evaluate(s => localStorage.setItem('gachamon-save-v1', JSON.stringify(s)), save);
  await page.evaluate(() => {
    window.raidPageOpens = 0;
    document.querySelector('#tabs [data-screen="raid"]').onclick = () => {
      window.raidPageOpens++; document.querySelector('#screen-adventure').classList.remove('active'); document.querySelector('#screen-raid').classList.add('active');
    };
  });
  const raw = JSON.stringify(save);
  await page.addScriptTag({ content: readFileSync('pokecatch-tools.user.js', 'utf8') });
  await page.getByRole('button', { name: '关闭刷图浮窗', exact: true }).click();

  const panel=page.locator('.assistant'),before=await panel.boundingBox();
  const grip=await page.getByRole('button',{name:'从左侧调整助手大小',exact:true}).boundingBox();
  await page.mouse.move(grip.x+10,grip.y+10);await page.mouse.down();await page.mouse.move(grip.x-160,grip.y+55,{steps:12});await page.mouse.up();
  const after=await panel.boundingBox();assert.ok(after.width>before.width+120);assert.ok(after.height>before.height+30);
  const savedSize=await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-tools-v1')).data.panelSize);assert.ok(savedSize.width>before.width);
  await page.getByTestId('open-farming').click();
  const farming=page.getByTestId('farming-window'),fb=await farming.boundingBox();const fg=await page.getByRole('button',{name:'调整刷图浮窗大小',exact:true}).boundingBox();
  await page.mouse.move(fg.x+9,fg.y+9);await page.mouse.down();await page.mouse.move(fg.x+115,fg.y+65,{steps:10});await page.mouse.up();assert.ok((await farming.boundingBox()).width>fb.width+90);
  await page.getByRole('button',{name:'在分析台查看刷图数据',exact:true}).click();assert.ok((await panel.boundingBox()).width>1000);await page.getByRole('tab',{name:'刷图',exact:true}).waitFor();
  await page.getByRole('tab',{name:'团战',exact:true}).click();
  const flow=page.locator('[data-analysis="团体战分析"]');await flow.locator('.flow-nav button').filter({hasText:'分析结果'}).click();
  await flow.getByText('这里还没有分析结果',{exact:true}).waitFor();assert.equal(await page.getByTestId('raid-load').isVisible(),false);
  await flow.locator('.flow-nav button').filter({hasText:'任务设置'}).click();await page.getByTestId('raid-load').click();await page.getByTestId('raid-row').first().waitFor();
  await page.getByTestId('raid-optimize-kanto').click();await flow.getByText('正在计算',{exact:true}).first().waitFor();assert.equal(await page.getByTestId('raid-load').isVisible(),false);
  await page.getByTestId('raid-candidate').first().waitFor({timeout:90000});await page.screenshot({path:'test-results/ui-raid-progress.png'});
  await page.getByTestId('raid-phase').filter({hasText:'搜索完成'}).waitFor({timeout:180000});
  await page.getByTestId('raid-selection-reason').waitFor();assert.ok(await page.getByTestId('raid-candidate').count()>=3);
  assert.match(await page.getByTestId('raid-comparison').innerText(),/初测|初步筛选/);assert.match(await page.getByTestId('raid-comparison').innerText(),/复核/);
  await page.getByTestId('raid-candidate').first().getByRole('button',{name:'查看',exact:true}).click();await page.getByTestId('raid-candidate-detail').waitFor();
  await page.screenshot({path:'test-results/ui-raid-comparison.png'});await page.locator('.assistant .tab-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'test-results/ui-analysis-desk.png'});
  await page.getByTestId('open-desk').click();const compact=await panel.boundingBox();assert.ok(compact.width<900);
  await page.screenshot({path:'test-results/ui-raid-compact.png'});
  await page.setViewportSize({width:375,height:900});await page.waitForTimeout(150);const mobile=await panel.boundingBox();assert.ok(mobile.x>=0&&mobile.width<=375&&mobile.y+mobile.height<=900);
  assert.equal(await page.locator('.farming-window').count(),0,'Mobile analysis must not be covered by a second floating window');await page.locator('.assistant .tab-content').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'test-results/ui-raid-mobile.png'});
  await page.setViewportSize({width:1280,height:1000});await page.reload();await page.addScriptTag({content:readFileSync('pokecatch-tools.user.js','utf8')});
  const restored=await panel.boundingBox();assert.ok(Math.abs(restored.width-savedSize.width)<2);
  assert.deepEqual(errors,[]);console.log('PASS: resize and persistence, viewport bounds, full analysis desk, separate setup/progress/result, live real candidate trace, comparison details, desktop and mobile layout');
}finally{await browser.close()}
