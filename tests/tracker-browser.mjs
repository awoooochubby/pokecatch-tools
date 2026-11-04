import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import version from '../src/simulation/version.json' with { type: 'json' };
await build({ entryPoints: ['tests/tracker-fixture.ts'], outfile: '.cache/tracker-browser-fixture.mjs', bundle: true, platform: 'node', format: 'esm' });
const { trackerFixture } = await import('../.cache/tracker-browser-fixture.mjs');
const engine = readFileSync('.cache/engine.js', 'utf8'), save = trackerFixture(engine, Date.now());
save.items = { 'razz-berry': 2, 'golden-razz-berry': 1, 'pinap-berry': 1 }; save.buffs = {};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', r => {
    const url = r.request().url();
    if (url === version.boot) return r.fulfill({ contentType: 'application/javascript', body: `window.BUNDLE=${JSON.stringify(version.url)}` });
    if (url === version.url) return r.fulfill({ contentType: 'application/javascript', body: engine });
    return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script type="text/plain" src="' + version.url + '"></script><style>body{background:#10151d;color:white}.screen{display:none}.screen.active{display:block}</style><div id="tabs"><button data-screen="adventure">冒险</button></div><section id="screen-adventure" class="screen active"><button id="chapter-btn">地图</button><div id="enemy-slot"></div><div id="bag-panel"><button class="bag-cell berry" data-k="razz-berry">蔓莓果</button><button class="bag-cell berry" data-k="golden-razz-berry">金色蔓莓果</button><button class="bag-cell berry" data-k="pinap-berry">凰梨果</button></div></section><section id="screen-map" class="screen"><div id="map-root"></div></section><div id="modal-root"></div>' });
  });
  await page.goto('https://pokecatch-online.pages.dev/');
  // Native map's audited DOM contract; only the fixture handlers write the test
  // save. The production tracker can only click these buttons.
  await page.evaluate(s => {
    localStorage.setItem('gachamon-save-v1', JSON.stringify(s));
    const adventure = document.querySelector('#screen-adventure'), map = document.querySelector('#screen-map'), root = document.querySelector('#map-root');
    const showAdventure = () => { adventure.classList.add('active'); map.classList.remove('active'); };
    document.querySelector('#tabs button').onclick = showAdventure;
    window.huntClicks = []; window.berryClicks = [];
    document.querySelectorAll('#bag-panel [data-k]').forEach(button => { button.onclick = () => {
      const s = JSON.parse(localStorage.getItem('gachamon-save-v1')), key = button.dataset.k;
      if (!(s.items[key] > 0)) return;
      s.items[key]--; s.buffs[key === 'pinap-berry' ? 'xp' : 'capture'] = { key, until: Date.now() + 3600000 };
      window.berryClicks.push(key); localStorage.setItem('gachamon-save-v1', JSON.stringify(s));
    }; });
    document.querySelector('#chapter-btn').onclick = () => {
      adventure.classList.remove('active'); map.classList.add('active');
      root.innerHTML = '<button class="rg open" data-rg="johto">城都</button><button class="rg open" data-rg="sinnoh">神奥</button><button class="rg open" data-rg="kanto">关都</button><button class="rg open" data-rg="hoenn">丰缘</button>';
      root.querySelectorAll('[data-rg]').forEach(button => { button.onclick = () => {
        root.querySelectorAll('[data-ch],.mp-go').forEach(n => n.remove());
        for (let ch = 0; ch <= 65; ch++) {
          const row = Object.assign(document.createElement('button'), { className: 'mp-row', textContent: String(ch) }); row.dataset.ch = ch; root.append(row);
          row.onclick = () => {
            root.querySelector('.mp-go')?.remove(); const go = Object.assign(document.createElement('button'), { className: 'mp-go', textContent: '前往' }); go.dataset.go = ch; root.append(go);
            go.onclick = () => {
              const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); window.huntClicks.push(ch);
              if (s.adv.chapter !== ch) {
                s.adv.chapter = ch; s.adv.node = 0; s.adv.battle = null; s.adv.zone = null;
                const roaming = Object.entries(s.roam.at).find(([id, pos]) => pos.ch === ch);
                s.adv.nodes = [{ type: 'wild', name: 'Route', roamer: roaming ? +roaming[0] : undefined }];
                localStorage.setItem('gachamon-save-v1', JSON.stringify(s));
              }
              showAdventure();
            };
          };
        }
      }; });
    };
  }, save);
  await page.addScriptTag({ content: readFileSync('pokecatch-tools.user.js', 'utf8') });
  await page.getByRole('button', { name: '关闭刷图浮窗', exact: true }).click();
  await page.getByRole('tab', { name: '追踪', exact: true }).click(); await page.getByTestId('tracker-load').click();
  const select = page.locator('.n-select[aria-label="自动捕捉目标"]'); await select.waitFor();
  for (const name of ['雷公', '炎帝']) {
    await select.locator('.n-base-selection').click(); await select.locator('input').fill(name);
    await page.locator('.n-base-select-option').filter({ hasText: name }).click(); await page.keyboard.press('Escape');
  }
  const berries = page.locator('.n-select[aria-label="追踪自动吃果"]');
  for (const name of ['蔓莓果', '金色蔓莓果', '凰梨果']) {
    await berries.locator('.n-base-selection').click();
    await page.locator('.n-base-select-option').filter({ hasText: new RegExp('^' + name + ' ·') }).click();
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pc-tools-v1')).data.tracker.berries), ['golden-razz-berry', 'pinap-berry']);
  assert.deepEqual(await page.evaluate(() => window.berryClicks), []);
  assert.deepEqual(await page.evaluate(() => window.huntClicks), []);
  await page.getByTestId('tracker-start').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('gachamon-save-v1')).adv.chapter === 17);
  await page.waitForFunction(() => window.berryClicks.length === 2);
  assert.deepEqual(await page.evaluate(() => window.berryClicks), ['golden-razz-berry', 'pinap-berry']);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')).items['razz-berry']), 2);
  // A live foe/capture animation must protect against a stale null battle save.
  await page.evaluate(() => {
    document.querySelector('#enemy-slot').innerHTML = '<div class="enemy" data-uid="enemy">雷公</div>';
    const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.roam.at[243].ch = 19;
    localStorage.setItem('gachamon-save-v1', JSON.stringify(s));
  });
  await page.waitForTimeout(3500); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')).adv.chapter), 17);
  await page.evaluate(() => { document.querySelector('#enemy-slot').innerHTML = ''; });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('gachamon-save-v1')).adv.chapter === 19);
  // Simulate native capture settlement, then observe automatic next-target travel.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.mons.push({ id: 243, uid: 'caught-243', level: 100, xp: 0 }); s.roam.caught.push(243);
    delete s.roam.at[243]; localStorage.setItem('gachamon-save-v1', JSON.stringify(s));
    document.querySelector('#modal-root').innerHTML = '<div class="modal dexcard-modal"><div class="modal-body"><div class="dexcard"><span class="dc-new">新捕获</span></div></div><div class="modal-actions"><button class="btn gold">继续</button></div></div>';
    document.querySelector('#modal-root button').onclick = () => { document.querySelector('#modal-root').innerHTML = ''; };
  });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('gachamon-save-v1')).adv.chapter === 18);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('gachamon-save-v1')).team), save.team);
  assert.equal(await page.locator('#modal-root .modal').count(), 0);
  await page.screenshot({ path: 'test-results/tracker.png' });
  await page.getByTestId('tracker-stop').click(); const calls = await page.evaluate(() => window.huntClicks.length);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.roam.at[244].ch = 22; localStorage.setItem('gachamon-save-v1', JSON.stringify(s)); });
  await page.waitForTimeout(3000); assert.equal(await page.evaluate(() => window.huntClicks.length), calls);
  assert.deepEqual(await page.evaluate(() => window.berryClicks), ['golden-razz-berry', 'pinap-berry']);
  await page.reload(); await page.addScriptTag({ content: readFileSync('pokecatch-tools.user.js', 'utf8') });
  if (await page.getByRole('button', { name: '关闭刷图浮窗', exact: true }).count()) await page.getByRole('button', { name: '关闭刷图浮窗', exact: true }).click(); await page.getByRole('tab', { name: '追踪', exact: true }).click();
  assert.equal(await page.getByTestId('tracker-stop').count(), 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pc-tools-v1')).data.tracker.targets), [243, 244]);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pc-tools-v1')).data.tracker.berries), ['golden-razz-berry', 'pinap-berry']);
  assert.deepEqual(errors, []);
  console.log('PASS: real metadata worker, explicit start, moving target, capture protection, automatic next target, retained team, selected native berry clicks without stacking, stop and reload persistence');
} finally { await browser.close(); }
