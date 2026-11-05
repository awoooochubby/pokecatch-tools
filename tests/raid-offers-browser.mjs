import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installRaidOfferPickers } from './raid-offer-fixture.mjs';
await build({ stdin: { contents: "import {collectRaidOffers} from './src/raid/offers'; import {allyPairs} from './src/raid/planner'; Object.assign(window,{collectRaidOffers,allyPairs});", resolveDir: process.cwd() }, outfile: '.cache/raid-offers-fixture.js', bundle: true, platform: 'browser', format: 'iife' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="raid-root"><button data-raid-slot="kanto|0">一</button><button data-raid-slot="kanto|1">二</button></div>' }));
  await page.goto('https://pokecatch-online.pages.dev/');
  await page.evaluate(() => {
    const group = (key, friend) => ({ key, name: key, mons: [0, 1].map(i => ({ uid: `${key}-${i}`, id: i ? 130 : 445, level: 100, xp: 0, shiny: i === 0, bot: true, ...(friend ? { owner: key } : { statMult: .9 }) })) });
    const bots = Array.from({ length: 6 }, (_, i) => group('npc-' + i, false));
    window.fixtureFriends = ['f-one', 'f-two', 'f-three'].map(k => group(k, true));
    localStorage.setItem('gachamon-save-v1', JSON.stringify({ raids: { bots: { kanto: bots }, pick: { kanto: ['f-one', 'f-two'] } } }));
  });
  await page.evaluate(installRaidOfferPickers); await page.addScriptTag({ path: '.cache/raid-offers-fixture.js' });
  const result = await page.evaluate(async () => {
    const raw = localStorage.getItem('gachamon-save-v1'), offers = await window.collectRaidOffers(document, 'kanto', raw, () => true);
    const pairs = window.allyPairs(offers);
    return { unchanged: raw === localStorage.getItem('gachamon-save-v1'), offers, pairs, modals: document.querySelectorAll('.modal').length };
  });
  assert.equal(result.unchanged, true); assert.equal(result.modals, 0); assert.equal(result.offers.length, 9); assert.equal(result.pairs.length, 36);
  assert.equal(result.pairs.filter(p => p.keys.every(k => k.startsWith('f-'))).length, 3);
  assert.equal(result.pairs.filter(p => p.keys.every(k => k.startsWith('npc-'))).length, 15);
  assert.equal(result.pairs.filter(p => p.keys.some(k => k.startsWith('f-')) && p.keys.some(k => k.startsWith('npc-'))).length, 18);
  const friends = result.offers.filter(o => o.friend); assert.equal(friends.length, 3); assert.equal(friends[0].mons[0].statMult, undefined); assert.equal(friends[0].mons[0].shiny, true);
  assert.ok(result.pairs.find(p => p.keys.includes('f-one') && p.keys.includes('f-two')).alternate);
  assert.equal(result.pairs.find(p => p.keys.includes('f-one') && p.keys.includes('f-three')).alternate, undefined);
  const npc = result.pairs.find(p => p.keys.includes('npc-0') && p.keys.includes('npc-5')); assert.deepEqual(npc.keys, ['npc-0', 'npc-5']); assert.equal(npc.mons[0].statMult, .9);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gachamon-save-v1')); s.raids.bots.kanto[0].mons[0].level = 99; localStorage.setItem('gachamon-save-v1', JSON.stringify(s)); });
  const mismatch = await page.evaluate(async () => {
    const raw = localStorage.getItem('gachamon-save-v1'), s = JSON.parse(raw); s.raids.bots.kanto[0].mons[0].level = 100;
    try { await window.collectRaidOffers(document, 'kanto', JSON.stringify(s), () => true); } catch (e) { return { error: e.message, modals: document.querySelectorAll('.modal').length }; }
  });
  assert.match(mismatch.error, /不一致/); assert.equal(mismatch.modals, 0);
  console.log('PASS: native picker union includes all friends/NPCs, masked selected friends, all 36 pairs, preserved native stats/order, two ambiguous friend orders, no save changes, and mismatch rejection');
} finally { await browser.close(); }
