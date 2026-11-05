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

  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('gachamon-save-v1'));
    s.mons.forEach(m => {m.rank=5;m.shiny=true});
    const group=(key, ids)=>({key,name:key,mons:ids.map((id,i)=>({uid:`${key}-${i}`,id,level:100,xp:0,bot:true,statMult:.85}))});
    s.raids={bots:{kanto:[group('a',[445,376]),group('b',[130,143])]},pick:{kanto:['b','a']},done:{},doneBoss:{},botsV:3,timesV:1,pityV:1,paceV:1};
    s.eventTeams={'raid:kanto':s.team.slice(0,2)};
    localStorage.setItem('gachamon-save-v1',JSON.stringify(s));
    localStorage.setItem('pc-tools-v1',JSON.stringify({schema:1,data:{tracker:{targets:[-1,244],teams:{'-1':s.team.slice(0,2)},mode:'ordered',weather:null,berries:[]}}}));
    const raid=document.createElement('section');raid.id='screen-raid';raid.className='screen';raid.innerHTML='<div id="raid-root"></div>';document.body.append(raid);
    const nav=document.createElement('button');nav.dataset.screen='raid';nav.textContent='团战';document.querySelector('#tabs').append(nav);
    const nativeAdventure=document.querySelector('#tabs [data-screen="adventure"]').onclick;
    document.querySelector('#tabs [data-screen="adventure"]').onclick=()=>{nativeAdventure();raid.classList.remove('active')};
    const write=s=>localStorage.setItem('gachamon-save-v1',JSON.stringify(s));
    const render=()=>{
      const s=JSON.parse(localStorage.getItem('gachamon-save-v1')),root=raid.querySelector('#raid-root');
      root.innerHTML='<div class="rc-card" data-rc="kanto"><div class="boss"><img src="assets/pokemon/art/shiny/25.png"></div><div class="mp-chips"><span data-cond="storm"></span></div><button data-raid-go="kanto">开始</button></div>';
      const card=root.firstElementChild;
      for(let i=0;i<2;i++){
        const key=s.raids.pick.kanto[i],bot=s.raids.bots.kanto.find(b=>b.key===key),slot=document.createElement('button');
        slot.className='rc-grp'+(bot?'':' free');slot.dataset.raidSlot=`kanto|${i}`;
        slot.innerHTML=bot?bot.mons.map(m=>`<span class="rc-mon" title="精灵 · Lv.100"><img src="assets/pokemon/${m.id}.png"></span>`).join(''):'选择队友';card.append(slot);
        slot.onclick=()=>{
          const current=JSON.parse(localStorage.getItem('gachamon-save-v1')),modal=document.createElement('div');modal.className='modal dexcard-modal raid-dlg';
          const close=()=>modal.remove();modal.innerHTML='<div><button class="dc-x">关闭</button></div><div class="modal-actions"></div>';
          modal.querySelector('.dc-x').onclick=close;
          const pick=value=>{const live=JSON.parse(localStorage.getItem('gachamon-save-v1'));live.raids.pick.kanto[i]=value;write(live);close();render()};
          if(current.raids.pick.kanto[i]){const remove=document.createElement('button');remove.className='btn ghost';remove.textContent='移除';remove.onclick=()=>pick(null);modal.querySelector('.modal-actions').append(remove)}
          for(const bot of current.raids.bots.kanto){if(current.raids.pick.kanto[1-i]===bot.key)continue;const b=document.createElement('button');b.dataset.pick=bot.key;b.textContent=bot.name;b.onclick=()=>pick(bot.key);modal.firstElementChild.append(b)}
          document.querySelector('#modal-root').append(modal);
        };
      }
      card.querySelector('[data-raid-go]').onclick=()=>{
        const live=JSON.parse(localStorage.getItem('gachamon-save-v1'));
        const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Date.now()).map(p=>[p.type,p.value]));
        const date=`${parts.year}-${parts.month}-${parts.day}`;
        live.adv.event={raid:true,reg:'kanto',id:25,date};live.adv.nodes=[{type:'static',raid:true,id:25,weather:'storm'}];live.adv.node=0;
        live.raids.allies=live.raids.bots.kanto.filter(b=>live.raids.pick.kanto.includes(b.key)).flatMap(b=>b.mons);write(live);window.raidStarts=(window.raidStarts||0)+1;
        document.querySelector('#tabs [data-screen="adventure"]').click();
      };
    };
    nav.onclick=()=>{document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active'));raid.classList.add('active');render()};
  });
  await page.addScriptTag({content:readFileSync('pokecatch-tools.user.js','utf8')});
  await page.getByRole('button',{name:'关闭刷图浮窗',exact:true}).click();await page.getByRole('tab',{name:'追踪',exact:true}).click();
  await page.getByTestId('tracker-load').click();await page.getByTestId('tracker-raids').waitFor();await page.getByTestId('tracker-raids').click();
  await page.getByRole('status').filter({hasText:'已读取 1 场今日团战'}).waitFor();
  assert.equal(await page.evaluate(()=>window.raidStarts||0),0);
  await page.getByTestId('tracker-start').click();
  await page.waitForFunction(()=>window.raidStarts===1,{},{timeout:180000});
  assert.match(await page.getByTestId('tracker-status').innerText(),/团战/);
  const configured=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('gachamon-save-v1'));return{mine:s.eventTeams['raid:kanto'],picks:s.raids.pick.kanto,team:s.team,allies:s.raids.allies.map(m=>m.uid)}});
  assert.deepEqual(configured.mine,save.team.slice(0,2));assert.deepEqual(configured.picks,['a','b']);assert.deepEqual(configured.team,save.team);
  assert.deepEqual(configured.allies,['a-0','a-1','b-0','b-1']);
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('gachamon-save-v1')),e=s.adv.event;s.raids.done[`kanto|${e.date}`]=Date.now();s.raids.doneBoss[`kanto|${e.date}`]=25;s.adv.event=null;s.adv.nodes=[];localStorage.setItem('gachamon-save-v1',JSON.stringify(s))});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gachamon-save-v1')).adv.chapter===18);
  assert.equal(await page.evaluate(()=>window.raidStarts),1);await page.getByTestId('tracker-stop').click();
  const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-tools-v1')).data.tracker.targets.length);
  await page.getByTestId('tracker-fill-dex').click();
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-tools-v1')).data.tracker.targets.length)>queued);
  assert.ok(await page.getByTestId('hunt-target').count()<=12,'Large dex queues must paginate');
  assert.deepEqual(errors,[]);console.log('PASS: raid late-binding, NPC slot swap, exact native ally order, automatic entry, capture completion resumes queue, one-click dex and pagination');
}finally{await browser.close()}
