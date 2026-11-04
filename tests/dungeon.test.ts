import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {createSimulator} from '../src/simulation/engine';
import {createForecast} from '../src/simulation/forecast';
import {leagueFixture} from './dungeon-fixture';
import type {Options} from '../src/simulation/types';
const native=existsSync('.cache/engine.js')?describe:describe.skip,now=Date.UTC(2026,10,4,12);
native('league dungeon boundaries',()=>{
  const source=existsSync('.cache/engine.js')?readFileSync('.cache/engine.js','utf8'):'';
  const opts=(node:number):Options=>({mode:'route',candidateUids:['0','1','2','3','4','5'],targetKeys:[],trials:128,seed:1729,start:'full',scanLevels:false,sequence:false,autoSwitch:'current',minWin:.95,maxLoss:1,goal:{node,objective:'clear',from:'chapter'}});
  it('keeps dungeon identity and semantic targets across internal stage progress',async()=>{
    const {entry,next}=leagueFixture(source,now),first=await createSimulator(source,JSON.stringify(entry),now),second=await createSimulator(source,JSON.stringify(next),now);
    expect(first.catalog.chapter).toBe('神奥联盟');expect(first.catalog.dungeon!.chapters).toEqual([60,61,62,63,64]);
    expect(second.catalog.dungeon!.id).toBe(first.catalog.dungeon!.id);
    expect(second.catalog.nodes!.map(n=>n.key)).toEqual(first.catalog.nodes!.map(n=>n.key));
    expect(second.catalog.nodeIndex).toBeGreaterThan(first.catalog.nodeIndex!);
    expect(first.catalog.targets.some(t=>t.chapterIndex===64&&t.source==='boss')).toBe(true);
  },30000);
  it('executes the approach trainers and later stages instead of checking the champion in isolation',async()=>{
    const {entry}=leagueFixture(source,now),engine=await createSimulator(source,JSON.stringify(entry),now),end=engine.catalog.nodes!.at(-1)!.index;
    const safe=await engine.run(opts(end),()=>{});
    expect(safe.routes[0].win.mean).toBeGreaterThan(.9);
    const championOffset=engine.catalog.nodes!.find(n=>n.chapter===64)!.index;
    expect(safe.routes[0].reachedNodes!.some(t=>t.node>=championOffset)).toBe(true);
    const firstTrainer=entry.adv.nodes.find((n:any)=>n.type==='trainer');firstTrainer.team=[[150,100]];firstTrainer.statMult=100;
    const unsafe=await createSimulator(source,JSON.stringify(entry),now),failed=await unsafe.run(opts(unsafe.catalog.nodes!.at(-1)!.index),()=>{});
    expect(failed.routes[0].win.mean).toBe(0);expect(failed.routes[0].failures![0].node).toBeLessThan(championOffset);
  },60000);
  it('reports every league stage in one node-XP report and one map-efficiency unit',async()=>{
    const {entry}=leagueFixture(source,now),engine=await createForecast(source,JSON.stringify(entry),now);
    const r=await engine.runNodes({scope:'full',trials:128,seed:1729},()=>{});
    expect([...new Set(r.rows.map(n=>n.chapter))]).toEqual([60,61,62,63,64]);expect(r.complete).not.toBeNull();
    expect(r.rows.some(n=>n.chapter===64&&(n.metric?.xp.mean||0)>0)).toBe(true);
    expect(r.rows.filter(n=>n.type==='transition')).toHaveLength(4);
    expect(r.rows.reduce((sum,n)=>sum+(n.metric?.xp.mean||0),0)).toBeCloseTo(r.xp.mean,7);
    const map=await engine.run({chapters:[60],unit:'dungeon',trials:128,seed:1729,start:'full'},()=>{});
    expect(map.rows[0].name).toBe('神奥联盟');expect(map.rows[0].battles.mean).toBeGreaterThan(20);expect(map.rows[0].error).toBeUndefined();
  },120000);
});
