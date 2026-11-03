// ==UserScript==
// @name         PokeCatch 经验与整轮日志
// @namespace    local.pokecatch.stats
// @version      0.1.2
// @updateURL    https://raw.githubusercontent.com/awoooochubby/pokecatch-tools/main/pokecatch-stats.meta.js
// @downloadURL  https://raw.githubusercontent.com/awoooochubby/pokecatch-tools/main/pokecatch-stats.user.js
// @homepageURL  https://github.com/awoooochubby/pokecatch-tools
// @description  只读存档与界面，按 adv.runs 保存整轮日志及升级估算
// @match        https://pokecatch-online.netlify.app/*
// @match        https://pokecatch-online.pages.dev/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  if (document.getElementById('pc-stat-host')) return;
  const KEY = 'pc-stat-v1', SAVE = 'gachamon-save-v1';
  let settings;
  try { settings = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { settings = {}; }
  let limit = Math.max(1, Math.min(100, Number(settings.limit) || 20));
  let history = Array.isArray(settings.history) ? settings.history.slice(-limit) : [];
  let previous, current, rawOld, lastSeen = Date.now(), samples = {}, status = '等待游戏存档…';
  const host = document.createElement('div'); host.id = 'pc-stat-host';
  Object.assign(host.style, {position:'fixed',right:'14px',top:'80px',zIndex:'2147483647'});
  document.body.append(host);
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>
    :host{font:13px/1.5 system-ui;color:#edf3ff} *{box-sizing:border-box}
    section{width:350px;max-width:94vw;background:#151e30;border:1px solid #526584;border-radius:12px;box-shadow:0 8px 35px #0008;overflow:hidden}
    header{padding:10px 12px;background:#25344f;cursor:move;touch-action:none;font-weight:bold;display:flex;justify-content:space-between}
    main{padding:12px;max-height:70vh;overflow:auto}button,input{font:inherit;color:inherit;background:#293a56;border:1px solid #536984;border-radius:5px;padding:3px 7px}button{cursor:pointer}input{width:58px}small{color:#aabbd5}p{margin:7px 0}.mon{padding:7px 0;border-bottom:1px solid #344158}details{margin:8px 0;border-top:1px solid #344158;padding-top:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 system-ui}summary{cursor:pointer}
  </style><section><header><span>经验统计 · 整轮日志</span><button id="fold">−</button></header><main>
    <small id="status"></small><div id="mons"></div>
    <p>保留 <input id="limit" type="number" min="1" max="100"> 轮 <button id="export">导出</button> <button id="reset">重测速度</button></p>
    <small>升级估算采用最近 5 分钟、当前等级的样本，含等待时间。经验条推算仅供参考；换等级后重新采样。</small>
    <details open><summary id="live">当前轮实时日志</summary><small>最新记录在上方；无需等本轮结束。</small><pre id="live-log" style="max-height:260px;overflow:auto">等待战斗日志…</pre></details><p>最近已结束的轮次（点击展开）</p><div id="logs"></div>
  </main></section>`;
  const $ = s => root.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Math.round(n).toLocaleString();
  const duration = ms => { const s = Math.max(0,Math.ceil(ms/1000)); return s>=3600 ? `${Math.floor(s/3600)}小时${Math.floor(s%3600/60)}分` : `${Math.floor(s/60)}分${s%60}秒`; };
  function persist() { try { localStorage.setItem(KEY,JSON.stringify({limit,history})); } catch { status = '插件存储已满；本次日志仅保留在内存'; } }
  function start(s, partial) { return {start:Date.now(),run:s.adv.runs,chapter:s.adv.chapter,partial,logs:[],xp:{},levels:{},battles:[]}; }
  function close(note) { if(!current)return; current.end=Date.now();current.note=note;history.push(current);history=history.slice(-limit);persist(); renderLogs(); }
  function renderLogs() {
    $('#logs').innerHTML=history.slice().reverse().map(r=>`<details><summary>${esc(new Date(r.start).toLocaleTimeString())} · 轮 ${esc(r.run+1)} · ${duration(r.end-r.start)} ${r.partial?'（不完整）':''}</summary><small>${esc(r.note)} · 观测到 ${r.battles.length} 场</small><pre>${esc(Object.entries(r.xp).map(([id,x])=>`${id}: 已确认 +${fmt(x)} XP，升级 ${r.levels[id]||0}`).join('\n'))}\n${esc(r.logs.join('\n'))}</pre></details>`).join('');
  }
  $('#limit').value=limit;
  $('#limit').onchange=e=>{limit=Math.max(1,Math.min(100,Math.floor(+e.target.value)||20));e.target.value=limit;history=history.slice(-limit);persist();renderLogs();};
  $('#reset').onclick=()=>{samples={};};
  $('#fold').onclick=()=>{$('main').hidden=!$('main').hidden;$('#fold').textContent=$('main').hidden?'+':'−';};
  $('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,history,current},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pokecatch-rounds.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  let drag;
  $('header').onpointerdown=e=>{if(e.target.tagName==='BUTTON')return;const b=host.getBoundingClientRect();drag={x:e.clientX-b.left,y:e.clientY-b.top};e.currentTarget.setPointerCapture(e.pointerId);};
  $('header').onpointermove=e=>{if(!drag)return;host.style.right='auto';host.style.left=Math.max(0,Math.min(innerWidth-host.offsetWidth,e.clientX-drag.x))+'px';host.style.top=Math.max(0,Math.min(innerHeight-45,e.clientY-drag.y))+'px';};
  $('header').onpointerup=$('header').onpointercancel=()=>{drag=null;};
  function recordLog() {
    const node=document.querySelector('#battle-log');
    const text=node?.textContent?.trim();
    if(current && text && current.logs.at(-1)?.split(' | ').slice(1).join(' | ')!==text){
      if(current.logs.length<3000)current.logs.push(new Date().toLocaleTimeString()+' | '+text);
      else current.partial=true;
      renderLive();
    }
  }
  function renderLive() {
    if(!current)return;
    $('#live').textContent=`当前轮 ${current.run+1} · 已观测 ${current.battles.length} 场 · ${current.logs.length} 条日志`;
    const text=current.logs.length?current.logs.slice().reverse().join('\n'):'等待战斗日志…（只记录插件启用后显示的内容）';
    if($('#live-log').textContent!==text)$('#live-log').textContent=text;
  }
  const observer=new MutationObserver(records=>{if(records.some(r=>r.target.parentElement?.closest('#battle-log')||r.target.id==='battle-log'))recordLog();});
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  function tick() {
    try {
      const now=Date.now(), raw=localStorage.getItem(SAVE);
      if(!raw){$('#status').textContent='等待游戏首次保存…';return;}
      const s=JSON.parse(raw);
      if(!Array.isArray(s.mons)||!Number.isFinite(s.adv?.runs)){ $('#status').textContent='当前存档结构不支持：等待冒险开始';return; }
      if(now-lastSeen>15000){if(current){current.partial=true;close('页面休眠/采样中断');}current=null;previous=null;samples={};}
      lastSeen=now;
      if(!current)current=start(s,true);
      if(raw!==rawOld){
        if(previous){
          const delta=s.adv.runs-previous.adv.runs;
          if(delta!==0||s.adv.chapter!==previous.adv.chapter){
            if(delta!==1)current.partial=true;
            close(delta>1?`漏过 ${delta} 轮；无法还原逐轮明细`:delta===1?'整轮完成（以存档轮次为准）':'切换章节或存档');
            current=start(s,delta!==1);samples={};
          } else {
            for(const m of s.mons){const old=previous.mons.find(x=>x.uid===m.uid);if(!old)continue;
              if(m.level===old.level&&m.xp>=old.xp)current.xp[m.uid]=(current.xp[m.uid]||0)+m.xp-old.xp;
              else if(m.level>old.level){current.levels[m.uid]=(current.levels[m.uid]||0)+m.level-old.level;current.partial=true;}
            }
          }
        }
        const b=s.adv.battle;
        if(b){const id=JSON.stringify([s.adv.node,b.kind,(b.enemies||[]).map(x=>x.uid)]);if(!current.battles.includes(id))current.battles.push(id);}
        previous=s;rawOld=raw;recordLog();
      }
      status=s.adv.paused?'游戏已暂停；恢复后建议重测速度':'已连接 · 按存档轮次分组（保存存在延迟）';
      const cards=[];
      for(const uid of s.team||[]){const m=s.mons.find(x=>x.uid===uid);if(!m)continue;
        const row=[...document.querySelectorAll('#team-rail .tr-row[data-uid]')].find(x=>x.dataset.uid===String(uid));
        const label=row?.title?.split('—')[0]?.trim()||`精灵 #${m.id}`;
        let arr=samples[uid];if(!arr||arr.at(-1).level!==m.level||arr.at(-1).xp>m.xp)arr=samples[uid]=[];
        arr.push({at:now,xp:m.xp,level:m.level});while(arr.length>1&&arr[0].at<now-300000)arr.shift();
        const elapsed=now-arr[0].at,rate=elapsed>10000?(m.xp-arr[0].xp)/(elapsed/1000):0;
        const pct=parseFloat(row?.querySelector('.tr-xp i')?.style.width);
        const remaining=pct>0&&pct<100?m.xp*(100/pct-1):NaN;
        let eta=rate>0&&Number.isFinite(remaining)?'约 '+duration(remaining/rate*1000):'采样中 / 暂无经验增长';
        if(m.level>=100||pct===100)eta='满级或等级上限';if(s.adv.paused)eta='已暂停';
        cards.push(`<div class="mon"><b>${esc(label)}</b> Lv.${m.level}<br>当前 ${fmt(m.xp)} XP · ${fmt(rate*60)} XP/分<br>下一级：${eta}</div>`);
      }
      $('#mons').innerHTML=cards.join('')||'等待队伍数据';$('#status').textContent=status;
      renderLive();
    }catch(e){$('#status').textContent='读取失败：'+e.message;}
  }
  renderLogs();tick();const timer=setInterval(tick,1000);
  window.__pcStatsDispose=()=>{clearInterval(timer);observer.disconnect();if(current){current.partial=true;close('插件更新或停止');}host.remove();delete window.__pcStatsDispose;};
})();