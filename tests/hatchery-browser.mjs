import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import version from '../src/simulation/version.json' with { type: 'json' };
await build({ entryPoints: ['tests/tracker-fixture.ts'], outfile: '.cache/hatchery-browser-fixture.mjs', bundle: true, platform: 'node', format: 'esm' });
const { trackerFixture } = await import('../.cache/hatchery-browser-fixture.mjs');
const source = readFileSync('.cache/engine.js', 'utf8'), now = Date.now(), save = trackerFixture(source, now);
save.adv.paused = true;
save.pension = { mons: [], eggs: [{ uid: 'shiny-ready', id: 175, shiny: true, laidAt: now - 120000, hatchAt: now - 60000 }, { uid: 'ordinary-ready', id: 172, shiny: false, laidAt: now - 120000, hatchAt: now - 60000 }, { uid: 'shiny-pending', id: 173, shiny: true, laidAt: now, hatchAt: now + 3600000 }, { uid: 'unknown', id: 174, laidAt: now, hatchAt: now + 3600000 }] };
const html = `<!doctype html><meta charset="utf-8"><script type="text/plain" src="${version.url}"></script><style>body{background:#10151d;color:white}.modal{position:fixed;inset:30px;background:#222}.lk-hatch{position:fixed;inset:10px;background:#222}</style><div id="tabs"><button data-screen="adventure">冒险</button><button data-screen="pension">培育屋</button></div><section id="screen-adventure" class="active"><div id="enemy-slot"></div></section><section id="screen-pension"><div id="pen-tabs"><button data-pen-tab="egg">孵蛋栏</button></div><div id="pen-eggs"></div></section><div id="modal-root"></div>`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', r => r.fulfill({ contentType: r.request().url().endsWith('.png') ? 'image/png' : 'text/html', body: r.request().url().endsWith('.png') ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') : html }));
  await page.goto('https://pokecatch-online.pages.dev/');
  await page.evaluate(s => {
    localStorage.setItem('gachamon-save-v1', JSON.stringify(s));
    window.hatchClicks = []; window.restoreCount = 0;
    const render = () => {
      const raw = JSON.parse(localStorage.getItem('gachamon-save-v1'));
      document.querySelector('#pen-eggs').innerHTML = raw.pension.eggs.map(e => `<button class="pen-egg ${Date.now() >= e.hatchAt ? 'ready' : ''}" data-egg="${e.uid}" ${Date.now() < e.hatchAt ? 'disabled' : ''}>蛋</button>`).join('');
      for (const button of document.querySelectorAll('#pen-eggs [data-egg]')) button.onclick = () => {
        if (window.fixtureFull) return;
        const s = JSON.parse(localStorage.getItem('gachamon-save-v1')), egg = s.pension.eggs.find(e => e.uid === button.dataset.egg);
        window.hatchClicks.push(egg.uid); s.pension.eggs = s.pension.eggs.filter(e => e.uid !== egg.uid);
        s.mons.push({ uid: 'hatched-' + egg.uid, id: egg.id, level: 1, xp: 0, shiny: egg.shiny });
        localStorage.setItem('gachamon-save-v1', JSON.stringify(s)); render();
        const fx = document.createElement('div'); fx.className = 'rc-fx lk-fx lk-hatch'; fx.innerHTML = '<div class="rc-tap" style="opacity:0">继续</div>'; document.body.append(fx);
        setTimeout(() => { fx.querySelector('.rc-tap').style.opacity = '1'; fx.addEventListener('pointerdown', () => {
          fx.remove(); const modal = document.createElement('div'); modal.className = 'modal dexcard-modal';
          // Previously seen mons also have this acknowledgement; no dc-new.
          modal.innerHTML = `<div class="dexcard"><img src="assets/pokemon/${egg.shiny ? 'shiny/' : ''}${egg.id}.png"></div><div class="modal-actions"><button class="btn gold">确定</button></div>`;
          modal.querySelector('button').onclick = () => modal.remove(); document.querySelector('#modal-root').append(modal);
        }, { once: true }); }, 400);
      };
    };
    for (const nav of document.querySelectorAll('#tabs [data-screen]')) nav.onclick = () => {
      for (const section of document.querySelectorAll('section[id^="screen-"]')) section.classList.toggle('active', section.id === 'screen-' + nav.dataset.screen);
      if (nav.dataset.screen === 'adventure') window.restoreCount++;
      render();
    };
    render();
  }, save);
  const raw = JSON.stringify(save);
  await page.addScriptTag({ content: readFileSync('pokecatch-tools.user.js', 'utf8') });
  await page.getByRole('button', { name: '关闭刷图浮窗', exact: true }).click();
  await page.getByRole('tab', { name: '追踪', exact: true }).click(); await page.getByTestId('hatchery-tab').click();
  await page.getByTestId('egg-row').first().waitFor();
  assert.equal(await page.locator('.tracker-views').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 4);
  assert.equal(await page.locator('.shiny-egg').first().evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(214, 180, 93)');
  assert.equal(await page.getByTestId('egg-row').count(), 4); assert.equal(await page.getByTestId('egg-shiny-count').innerText(), '2');
  assert.deepEqual(await page.getByTestId('egg-shiny').allTextContents(), ['★ 闪光蛋', '普通蛋', '★ 闪光蛋', '闪光信息缺失']);
  assert.equal(await page.evaluate(() => localStorage.getItem('gachamon-save-v1')), raw, 'Display/default-off must not change eggs');
  await page.screenshot({ path: 'test-results/hatchery.png' });
  await page.getByTestId('eggs-collect').click(); await page.getByTestId('eggs-status').filter({ hasText: '领取完成' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.hatchClicks), ['shiny-ready', 'ordinary-ready']); assert.equal(await page.getByTestId('egg-row').count(), 2);
  assert.ok(await page.evaluate(() => document.querySelector('#screen-adventure.active') && window.restoreCount === 1));
  assert.equal(await page.locator('.modal,.lk-hatch').count(), 0);
  await page.getByRole('switch', { name: '成熟后自动收蛋' }).click();
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.pension.eggs[0].hatchAt = Date.now(); s.adv.battle = { enemies: [{ uid: 'test-foe', id: 25, hp: 10 }] }; localStorage.setItem('gachamon-save-v1', JSON.stringify(s));
  });
  await page.getByTestId('eggs-status').filter({ hasText: '等待战斗' }).waitFor(); assert.equal(await page.evaluate(() => window.hatchClicks.length), 2);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.adv.battle = null; localStorage.setItem('gachamon-save-v1', JSON.stringify(s)); });
  await page.getByTestId('eggs-status').filter({ hasText: '领取完成' }).waitFor(); assert.equal(await page.getByTestId('egg-row').count(), 1);
  await page.evaluate(() => { window.fixtureFull = true; const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.pension.eggs[0].hatchAt = Date.now(); localStorage.setItem('gachamon-save-v1', JSON.stringify(s)); document.querySelector('#tabs [data-screen="pension"]').click(); });
  await page.getByRole('alert').filter({ hasText: 'PC 空位' }).waitFor(); assert.equal(await page.getByRole('switch', { name: '成熟后自动收蛋' }).getAttribute('aria-checked'), 'false');
  assert.equal(await page.getByTestId('egg-row').count(), 1); assert.equal(await page.evaluate(() => window.hatchClicks.length), 3);
  await page.setViewportSize({ width: 375, height: 900 }); await page.screenshot({ path: 'test-results/hatchery-mobile.png' });
  assert.deepEqual(errors, []); console.log('PASS: stored shiny flags before hatch, manual/automatic mature-only pickup, native animation/result acknowledgement, restore page, wait for battle, and stop on full PC');
} finally { await browser.close(); }
