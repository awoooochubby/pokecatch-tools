// ==UserScript==
// @name         PokeCatch 经验与整轮日志
// @namespace    local.pokecatch.stats
// @version      0.2.0
// @updateURL    https://raw.githubusercontent.com/awoooochubby/pokecatch-tools/main/pokecatch-stats.meta.js
// @downloadURL  https://raw.githubusercontent.com/awoooochubby/pokecatch-tools/main/pokecatch-stats.user.js
// @homepageURL  https://github.com/awoooochubby/pokecatch-tools
// @description  只读存档与界面，按 adv.runs 保存整轮日志及升级估算
// @match        https://pokecatch-online.netlify.app/*
// @match        https://pokecatch-online.pages.dev/*
// @noframes
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('pc-stat-host')) return;
  const KEY = 'pc-stat-v1', SAVE = 'gachamon-save-v1';
  let settings;
  try { settings = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { settings = {}; }
  let limit = Math.max(1, Math.min(100, Number(settings.limit) || 20));
  let history = Array.isArray(settings.history) ? settings.history.slice(-limit) : [];
  let previous, current, rawOld, lastSeen = Date.now(), samples = {}, status = '等待游戏存档…';
  const host = document.createElement('div'); host.id = 'pc-stat-host';
  Object.assign(host.style, {display:'block',width:'100%',margin:'16px 0'});
  function mount() { const arena=document.querySelector('#arena'); if(arena && host.previousElementSibling!==arena)arena.after(host); }
  mount();
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>
    :host{font:13px/1.6 system-ui;color:#e5eaf3}*{box-sizing:border-box}
    section{background:#151a25;border:1px solid #30394a;border-radius:14px;overflow:hidden;width:100%}
    header{padding:14px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #30394a}header span{font-size:16px;font-weight:700}
    main{padding:16px 18px}button,input{font:inherit;color:inherit;background:#242c3b;border:1px solid #46516a;border-radius:7px;padding:5px 10px}button{cursor:pointer}input{width:60px}small{color:#91a0b7}p{margin:10px 0}summary{cursor:pointer;font-weight:600;padding:7px 0}details{margin:8px 0}.mon{padding:10px;border:1px solid #30394a;border-radius:8px;margin:6px 0}#mons{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}.feed{max-height:320px;overflow:auto;scrollbar-width:thin}.entry{display:flex;gap:14px;padding:9px 3px;border-bottom:1px solid #242d3d;overflow-wrap:anywhere}.entry time{color:#72829c;font-size:11px;flex-shrink:0;padding-top:3px}.entry span{white-space:pre-wrap}.damage{color:#ffb986}.heal{color:#85d7b1}.empty{padding:20px;color:#91a0b7;text-align:center}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}#status{display:block;margin-bottom:8px}
  </style><section><header><span>战斗记录</span><button id="fold">收起</button></header><main>
    <small id="status"></small>
    <details open><summary id="live">本轮战斗</summary><div id="live-log" class="feed"></div></details>
    <details><summary>升级进度</summary><div id="mons"></div><button id="reset">重新统计</button><p><small>预计时间按近期经验增长估算。</small></p></details>
    <details><summary>最近几轮</summary><div id="logs"></div></details>
    <details><summary>设置</summary><div class="toolbar">保留 <input id="limit" type="number" min="1" max="100"> 轮 <button id="export">导出记录</button></div></details>
  </main></section>`;
  const $ = s => root.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Math.round(n).toLocaleString();
  const duration = ms => { const s = Math.max(0,Math.ceil(ms/1000)); return s>=3600 ? `${Math.floor(s/3600)}小时${Math.floor(s%3600/60)}分` : `${Math.floor(s/60)}分${s%60}秒`; };
  function persist() { try { localStorage.setItem(KEY,JSON.stringify({limit,history})); } catch { status = '插件存储已满；本次日志仅保留在内存'; } }
  function start(s, partial) { return {start:Date.now(),run:s.adv.runs,chapter:s.adv.chapter,partial,logs:[],xp:{},levels:{},battles:[]}; }
  function close(note) { if(!current)return; current.end=Date.now();current.note=note;history.push(current);history=history.slice(-limit);persist(); renderLogs(); }
  function logHtml(logs) {
    return logs.length?logs.slice().reverse().map(line=>{const i=line.indexOf(' | '),time=i<0?'':line.slice(0,i),text=i<0?line:line.slice(i+3);return '<div class="entry '+(text.startsWith('伤害')?'damage':text.startsWith('恢复')?'heal':'')+'"><time>'+esc(time)+'</time><span>'+esc(text)+'</span></div>';}).join(''):'<div class="empty">战斗开始后，记录会显示在这里</div>';
  }
  function renderLogs() {
    $('#logs').innerHTML=history.length?history.slice().reverse().map(r=>'<details><summary>'+esc(new Date(r.start).toLocaleTimeString())+' · '+duration(r.end-r.start)+(r.partial?' · 部分记录':'')+'</summary><div class="feed">'+logHtml(r.logs)+'</div></details>').join(''):'<div class="empty">完成一轮后会保存在这里</div>';
  }
  $('#limit').value=limit;
  $('#limit').onchange=e=>{limit=Math.max(1,Math.min(100,Math.floor(+e.target.value)||20));e.target.value=limit;history=history.slice(-limit);persist();renderLogs();};
  $('#reset').onclick=()=>{samples={};};
  $('#fold').onclick=()=>{$('main').hidden=!$('main').hidden;$('#fold').textContent=$('main').hidden?'展开':'收起';};
  $('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,history,current},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pokecatch-rounds.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  let lastMessage='';
  const seenDamage=new WeakSet();
  function appendLog(text) { if(!current)return; if(current.logs.length<3000)current.logs.push(new Date().toLocaleTimeString()+' | '+text);else current.partial=true;renderLive(); }
  function damageNode(node) {
    if(node.nodeType!==1)return;
    const items=[...(node.matches('.dmg')?[node]:[]),...node.querySelectorAll('.dmg')];
    for(const el of items){if(seenDamage.has(el)||!el.closest('#arena-fx'))continue;seenDamage.add(el);
      const text=el.textContent.trim();const m=/^([+\-−])(\d[\d.,\s]*)(!)?$/.exec(text);if(!m)continue;
      appendLog((m[1]==='+'?'恢复 +':'伤害 −')+m[2].trim()+(el.classList.contains('crit')||m[3]?' · 暴击':'')+(el.classList.contains('super')?' · 效果拔群':'')+(el.classList.contains('st-float')?' · 状态效果':''));
    }
  }
  function recordLog() {
    const node=document.querySelector('#battle-log');
    const text=node?.textContent?.trim();
    if(current && text && text!==lastMessage && text!=='…'){lastMessage=text;appendLog(text);}
  }
  function renderLive() {
    if(!current)return;
    $('#live').textContent='本轮战斗';
    const key=current.start+':'+current.logs.length;
    if($('#live-log').dataset.key!==key){$('#live-log').dataset.key=key;$('#live-log').innerHTML=logHtml(current.logs);}
  }
  const observer=new MutationObserver(records=>{
    for(const r of records){
      if(r.target.parentElement?.closest('#battle-log')||r.target.id==='battle-log')recordLog();
      for(const node of r.addedNodes)damageNode(node);
    }
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  function tick() {
    try {
      mount();
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
      status=s.adv.paused?'已暂停':'记录中 · 最新消息在上方';
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