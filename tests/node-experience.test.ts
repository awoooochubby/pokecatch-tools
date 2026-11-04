import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {createForecast} from '../src/simulation/forecast';
import {referenceEngine} from './reference-engine';
const native=existsSync('.cache/engine.js')?describe:describe.skip,now=Date.UTC(2026,10,4,12);
native('native XP by saved node',()=>{
  const source=existsSync('.cache/engine.js')?readFileSync('.cache/engine.js','utf8'):'';
  function snapshot(level=68,id=136){const t=referenceEngine(source,now),s:any=t.Game.freshState();s.travel={to:['sinnoh']};s.trainer={};
    s.mons=[{id,uid:'0',level,xp:0,reg:'sinnoh'}];s.team=['0'];s.road=['0'];s.adv={chapter:59,unlocked:59,runs:1,speed:4,layout:6,gifts:{},badges:[],kept:{},loops:[],node:0,battle:null,pending:null,
      nodes:[{type:'trainer',name:'同名路段',trainer:'测试',sprite:'youngster',team:[[10,1]],bg:'cave'},{type:'heal',name:'Frimapic',bg:'town'},
        {type:'trainer',name:'同名路段',trainer:'测试',sprite:'youngster',team:[[10,1]],bg:'cave'}]};return s;}
  const options={trials:128,seed:1729,scope:'full'} as const;
  it('uses the exact saved nodes, conserves XP and attributes private buddy reward to its triggering node',async()=>{
    const s=snapshot(),t=referenceEngine(source,now);
    t.Game.sandbox(s,()=>{s.buddy={uid:'0',ko:t.Game.buddyGoal(s.mons[0])-1};});
    const raw=JSON.stringify(s),engine=await createForecast(source,raw,now),r=await engine.runNodes(options,()=>{});
    expect(r.rows.map(n=>[n.index,n.name])).toEqual([[0,'同名路段'],[1,'Frimapic'],[2,'同名路段']]);
    expect(r.rows[0].metric!.xp.mean).toBeGreaterThan(r.rows[2].metric!.xp.mean);
    expect(r.rows[1].metric!.xp.mean).toBe(0);
    expect(r.rows.reduce((sum,n)=>sum+(n.metric?.xp.mean||0),0)).toBeCloseTo(r.xp.mean,8);
    expect(r.rows.at(-1)!.members['0'].cumulative.mean).toBeCloseTo(r.members['0'].mean,8);
    expect(r.complete!.mean).toBe(1);expect(JSON.stringify(s)).toBe(raw);
    expect(await engine.runNodes(options,()=>{})).toEqual(r);
  },30000);
  it('retains the live battle, omits defeated enemies, and leaves passed nodes unknown instead of zero',async()=>{
    const s=snapshot();s.adv.node=2;s.adv.nodes[2].team=[[10,1],[10,1]];
    const t=referenceEngine(source,now);t.Game.sandbox(s,()=>{t.Adventure.step();s.adv.battle.enemies[0].hp=0;});
    const engine=await createForecast(source,JSON.stringify(s),now),r=await engine.runNodes({...options,scope:'remaining'},()=>{}),full=await engine.runNodes(options,()=>{});
    expect(r.rows[0].state).toBe('past');expect(r.rows[0].metric).toBeNull();expect(r.rows[1].metric).toBeNull();
    expect(r.rows[2].metric!.xp.mean).toBeGreaterThan(0);
    expect(full.rows[2].metric!.xp.mean).toBeCloseTo(r.rows[2].metric!.xp.mean*2,8);
    expect(r.xp.mean).toBeCloseTo(r.rows[2].metric!.xp.mean,8);
  },30000);
  it('includes defeats and zero contribution for unreachable future nodes, separately from conditional rewards',async()=>{
    const s=snapshot(5,129);s.adv.nodes[0].team=[[478,52]];
    const engine=await createForecast(source,JSON.stringify(s),now),r=await engine.runNodes(options,()=>{});
    expect(r.complete!.mean).toBe(0);expect(r.rows[0].reached.mean).toBe(1);
    expect(r.rows[2].reached.mean).toBe(0);expect(r.rows[2].metric!.xp.mean).toBe(0);expect(r.rows[2].metric!.conditionalXp).toBeNull();
    expect(r.xp.mean).toBe(0);
  },30000);
  it('counts only the XP needed to hit cap at the correct node',async()=>{
    const s=snapshot(71),t=referenceEngine(source,now);
    t.Game.sandbox(s,()=>{s.mons[0].xp=t.Game.xpForNext(71,s.mons[0])-1;});
    const engine=await createForecast(source,JSON.stringify(s),now),r=await engine.runNodes(options,()=>{});
    expect(r.rows[0].metric!.xp.mean).toBe(1);expect(r.rows[2].metric!.xp.mean).toBe(0);expect(r.xp.mean).toBe(1);
  },30000);
  it('keeps a valid prefix when a manual choice blocks the remaining route',async()=>{
    const s=snapshot();s.adv.nodes[1]={type:'gift',name:'手动选择',gift:{key:'test-gift',ids:[1,4,7],level:5}};
    const engine=await createForecast(source,JSON.stringify(s),now),r=await engine.runNodes(options,()=>{});
    expect(r.rows[0].metric!.xp.mean).toBeGreaterThan(0);expect(r.rows[1].state).toBe('unavailable');expect(r.rows[2].metric).toBeNull();
    expect(r.xp.mean).toBeCloseTo(r.rows[0].metric!.xp.mean,8);expect(r.complete).toBeNull();
  },30000);
  it('refuses to invent a saved route when none exists',async()=>{
    const s=snapshot();s.adv.nodes=[];
    const engine=await createForecast(source,JSON.stringify(s),now);
    await expect(engine.runNodes(options,()=>{})).rejects.toThrow('已保存');
  });
});
