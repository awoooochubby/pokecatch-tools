import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import version from '../src/simulation/version.json' with { type: 'json' };
await build({ entryPoints: ['tests/tracker-fixture.ts'], outfile: '.cache/raid-browser-fixture.mjs', bundle: true, platform: 'node', format: 'esm' });
const { trackerFixture } = await import('../.cache/raid-browser-fixture.mjs');
const source = readFileSync('.cache/engine.js', 'utf8'), save = trackerFixture(source, Date.now());
save.eventTeams = { 'raid:sinnoh': save.team.slice(0, 2) };
save.mons.forEach(m => { m.shiny = true; m.rank = 5; });
const group = (key, ids) => ({ key, name: key, mons: ids.map((id, i) => ({ uid: `${key}-${i}`, id, level: 100, xp: 0, bot: true, statMult: .85 })) });
save.raids = { bots: { sinnoh: [group('bot-a', [445, 376]), group('bot-b', [130, 143])] }, pick: { sinnoh: ['bot-b', 'bot-a'] }, done: {}, last: [], botsV: 3, timesV: 1, pityV: 1, paceV: 1 };
const mon = id => `<span class="rc-mon" title="精灵 · Lv.100"><img src="assets/pokemon/${id}.png"></span>`;
const html = '<!doctype html><meta charset="utf-8"><script type="text/plain" src="' + version.url + '"></script><style>body{background:#10151d;color:white}</style><section id="screen-raid" class="active"><div id="raid-root"><div class="rc-card" data-rc="sinnoh"><div class="mp-chips"><span data-cond="storm">雷暴雨</span></div><div class="boss"><img src="assets/pokemon/art/shiny/25.gif"></div><button data-raid-slot="sinnoh|0">' + mon(130) + mon(143) + '</button><button data-raid-slot="sinnoh|1">' + mon(445) + mon(376) + '</button></div></div></section>';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', r => {
    const url = r.request().url();
    if (url === version.boot) return r.fulfill({ contentType: 'application/javascript', body: `window.BUNDLE=${JSON.stringify(version.url)}` });
    if (url === version.url) return r.fulfill({ contentType: 'application/javascript', body: source });
    if (url.endsWith('.png') || url.endsWith('.gif')) return r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
    return r.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://pokecatch-online.pages.dev/');
  await page.evaluate(s => localStorage.setItem('gachamon-save-v1', JSON.stringify(s)), save);
  const raw = JSON.stringify(save);
  await page.addScriptTag({ content: readFileSync('pokecatch-tools.user.js', 'utf8') });
  await page.getByRole('button', { name: '关闭刷图浮窗', exact: true }).click();
  const settingsTab = await page.getByRole('tab', { name: '设置', exact: true }).boundingBox(), panel = await page.locator('.assistant').boundingBox();
  assert.ok(settingsTab.x + settingsTab.width <= panel.x + panel.width, 'All eight assistant tabs must fit');
  await page.setViewportSize({ width: 375, height: 900 }); await page.waitForTimeout(200);
  const mobileTab = await page.getByRole('tab', { name: '设置', exact: true }).boundingBox(), mobilePanel = await page.locator('.assistant').boundingBox();
  assert.ok(mobileTab.x + mobileTab.width <= mobilePanel.x + mobilePanel.width, 'All eight tabs must fit on a 375px screen');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('tab', { name: '团战', exact: true }).click(); await page.getByTestId('raid-load').click();
  await page.getByTestId('raid-run').waitFor(); await page.getByTestId('raid-run').click();
  await page.getByRole('button', { name: '取消预测', exact: true }).click();
  await page.getByTestId('raid-phase').filter({ hasText: '已取消预测' }).waitFor();
  await page.getByTestId('raid-run').click();
  await page.getByTestId('raid-win').waitFor({ timeout: 60000 });
  assert.match(await page.getByTestId('raid-win').innerText(), /100\.0%/);
  const team = await page.locator('#pc-tools .hunt-target').allTextContents();
  assert.equal(team.length, 6);
  assert.match(team[2], /烈咬陆鲨/); assert.match(team[3], /巨金怪/); assert.match(team[4], /暴鲤龙/); assert.match(team[5], /卡比兽/);
  assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), raw);
  await page.screenshot({ path: 'test-results/raid.png' });
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.mons[0].rank = 0; localStorage.setItem('gachamon-save-v1', JSON.stringify(s)); });
  await page.getByText('配置或日期已变化，请重新预测').waitFor();
  // Two friends have a native offer order unavailable in the pre-battle save;
  // fail explicitly instead of predicting from visual slot order.
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.raids.pick.sinnoh = ['f-one', 'f-two']; localStorage.setItem('gachamon-save-v1', JSON.stringify(s)); });
  await page.getByTestId('raid-load').click(); await page.getByRole('alert').filter({ hasText: '两名好友' }).waitFor();
  // Once entered, the native save contains the exact order, independent of UI.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('gachamon-save-v1'));
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(Date.now()).map(p => [p.type, p.value]));
    s.adv.event = { raid: true, reg: 'sinnoh', id: 25, date: `${parts.year}-${parts.month}-${parts.day}` };
    s.adv.nodes = [{ type: 'static', raid: true, id: 25, weather: 'storm' }];
    s.raids.allies = [...s.raids.bots.sinnoh[1].mons, ...s.raids.bots.sinnoh[0].mons];
    localStorage.setItem('gachamon-save-v1', JSON.stringify(s));
  });
  await page.getByTestId('raid-load').click(); await page.getByTestId('raid-run').click();
  await page.getByTestId('raid-win').waitFor({ timeout: 60000 });
  const activeTeam = await page.locator('#pc-tools .hunt-target').allTextContents(); assert.match(activeTeam[2], /暴鲤龙/); assert.match(activeTeam[4], /烈咬陆鲨/);
  assert.deepEqual(errors, []);
  console.log('PASS: configured raid snapshot, real 512-trial worker, native ally order, full-run win rate, stale configuration, exact active-raid order and unchanged save');
} finally { await browser.close(); }
